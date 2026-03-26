const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { processDocument } = require('../services/geminiService');
const { getOrCreateClientFolder, uploadFile, getSubfolderInUserFolder } = require('../services/googleDriveService');
const { upsertClient } = require('../services/googleSheetsService');
const { findCliente, createCliente, updateCliente, getNextFileNumber, findClientesSimilares } = require('../services/clienteService');
const { getUser, registerUser, getPendingUsers, getSubfolder } = require('../services/userService');
const { chat } = require('../services/chatService');
const { checkRequestLimit, checkDocumentLimit } = require('../services/rateLimiter');
const { generateLegalText } = require('../services/legalTextService');
const {
  orquestrar,
  transcribeAudio,
  getContext,
  addAssistantResponse,
  setPastaAtiva,
  setSubpastaAtiva,
  setClienteAtivo,
  getTargetFolderId,
  getDestinoLabel,
} = require('../services/orquestradorService');

const greetingPath = path.join(__dirname, '../../../prompts/greeting_start.txt');
const GREETING = fs.existsSync(greetingPath)
  ? fs.readFileSync(greetingPath, 'utf-8')
  : '👋 Olá! Envie uma foto ou PDF para classificar.';

const MAX_BATCH = 10;
const MAX_FILE_SIZE_MB = 20;
const BATCH_WAIT_MS = 5000;

const pendingDocs = new Map();
const batchBuffer = new Map();
const batchTimers = new Map();

function createProcessor(pool) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    const sendMessage = async (chatId, text, extra = {}) => {
        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId, text, parse_mode: 'Markdown', ...extra
            });
        } catch (error) {
            console.error('Erro envio:', error.response?.data || error.message);
        }
    };

    const answerCallback = async (cbId, text) => {
        try { await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: cbId, text }); } catch (e) {}
    };

    const getFileUrl = async (fileId) => {
        try {
            const res = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
            return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${res.data.result.file_path}`;
        } catch (e) { return null; }
    };

    const downloadFileAsBase64 = async (url, originalFileName) => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        let mimeType = response.headers['content-type'];
        const base64Data = Buffer.from(response.data, 'binary').toString('base64');
        if (mimeType === 'application/octet-stream' && originalFileName) {
            const ext = originalFileName.toLowerCase().split('.').pop();
            const mimeMap = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
            if (mimeMap[ext]) mimeType = mimeMap[ext];
        }
        return { base64Data, mimeType };
    };

    // ── Finalizar um documento: pasta do cliente → upload direto ──
    async function finalizarUmDocumento(remetenteNumero, remetenteNome, docData, clienteNome, chatId) {
        const { aiResult, base64Data, mimeType, fileName } = docData;
        const clientName = clienteNome || aiResult.nome_cliente || remetenteNome;

        let cliente, clienteStatus;
        const clienteExistente = await findCliente(pool, { nome_cliente: clientName, cpf: aiResult.cpf });

        if (clienteExistente) {
            cliente = clienteExistente;
            clienteStatus = 'existente';
            await updateCliente(pool, cliente.id, aiResult);
        } else {
            clienteStatus = 'novo';
            const clientFolder = await getOrCreateClientFolder(clientName);
            cliente = await createCliente(pool, { ...aiResult, nome_cliente: clientName }, clientFolder.id, clientFolder.webViewLink);
        }

        const tipoDoc = aiResult.tipo_documento || 'Outro';

        // Usar pasta ativa do contexto se disponível, senão pasta do cliente
        const contextFolderId = chatId ? getTargetFolderId(chatId) : null;
        let targetFolderId = contextFolderId || cliente.drive_folder_id;

        // Organizar em subpasta por tipo de documento (Contrato → Contratos, RG → Documentos Pessoais, etc.)
        if (!contextFolderId && targetFolderId) {
            try {
                const subfolderName = getSubfolder(tipoDoc);
                const subId = await getSubfolderInUserFolder(targetFolderId, subfolderName);
                targetFolderId = subId;
                console.log(`[+] Subpasta por tipo: ${tipoDoc} → ${subfolderName}`);
            } catch (e) {
                console.warn(`[!] Erro ao criar subpasta por tipo: ${e.message}. Salvando na pasta do cliente.`);
            }
        }

        const nextNum = await getNextFileNumber(pool, cliente.id);
        const numStr = String(nextNum).padStart(3, '0');
        const cleanName = clientName.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
        const cleanType = tipoDoc.replace(/\s+/g, '_');
        const finalFileName = `${numStr}_${cleanType}_${cleanName}`;

        const fileResult = await uploadFile(targetFolderId, finalFileName, base64Data, mimeType);

        await pool.query(
            `INSERT INTO documentos (cliente_id, remetente_numero, remetente_nome, nome_arquivo_original, nome_arquivo_salvo, tipo_documento, descricao_gemini, link_drive, pasta_drive, numero_arquivo, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [cliente.id, remetenteNumero, remetenteNome, fileName, fileResult.name, tipoDoc, aiResult.descricao, fileResult.webViewLink, targetFolderId, nextNum, 'processado']
        );

        try {
            await upsertClient({ nome: clientName, cpf: aiResult.cpf, rg: aiResult.rg, telefone: aiResult.telefone, email: aiResult.email, endereco: aiResult.endereco }, fileResult.webViewLink);
        } catch (e) { console.error('[!] Erro planilha:', e.message); }

        return {
            clientName, clienteStatus, tipoDoc,
            descricao: aiResult.descricao, dataDoc: aiResult.data_documento,
            fileName: fileResult.name, link: fileResult.webViewLink,
            cpf: aiResult.cpf, rg: aiResult.rg, endereco: aiResult.endereco
        };
    }

    // ── Finalizar doc único ─────────────────────────────────
    async function finalizarDocumento(chatId, remetenteNumero, remetenteNome, pending, clienteNome) {
        const result = await finalizarUmDocumento(remetenteNumero, remetenteNome, pending, clienteNome, chatId);
        await enviarConfirmacao(chatId, [result]);
        pendingDocs.delete(chatId);
    }

    // ── Finalizar lote ──────────────────────────────────────
    async function finalizarLote(chatId, remetenteNumero, remetenteNome, docs, clienteNome) {
        await sendMessage(chatId, `⏳ _Processando ${docs.length} documento(s)..._`);

        const resultados = [];
        for (let i = 0; i < docs.length; i++) {
            try {
                console.log(`[+] Lote: processando ${i + 1}/${docs.length}: ${docs[i].fileName}`);
                const r = await finalizarUmDocumento(remetenteNumero, remetenteNome, docs[i], clienteNome, chatId);
                resultados.push(r);
            } catch (err) {
                console.error(`[!] Erro no doc ${i + 1}:`, err.message);
                resultados.push({ fileName: docs[i].fileName, tipoDoc: 'Erro', descricao: err.message, link: null });
            }
        }

        await enviarConfirmacao(chatId, resultados);
        batchBuffer.delete(chatId);
        pendingDocs.delete(chatId);
    }

    // ── Confirmação (1 ou vários docs) ──────────────────────
    async function enviarConfirmacao(chatId, resultados) {
        const destino = getDestinoLabel(chatId);

        if (resultados.length === 1) {
            const r = resultados[0];
            const statusEmoji = r.clienteStatus === 'novo' ? '🆕 Cliente Novo — Pasta criada' : '🔄 Cliente Existente';
            const lines = [
                `✅ *Documento Salvo com Sucesso!*`,
                ``,
                `👤 *Cliente:* ${r.clientName}`,
                `${statusEmoji}`,
                ``,
                `📁 Tipo: *${r.tipoDoc}*`,
                `🗂 Descrição: ${r.descricao || '—'}`,
                `📅 Data: ${r.dataDoc || '—'}`,
                `💾 Arquivo: \`${r.fileName}\``,
            ];
            if (destino) lines.push(`📂 *Salvo em:* ${destino}`);
            if (r.cpf) lines.push(`🪪 CPF: ${r.cpf}`);
            if (r.rg) lines.push(`🪪 RG: ${r.rg}`);
            if (r.link) lines.push(``, `🔗 [Abrir no Google Drive](${r.link})`);
            await sendMessage(chatId, lines.join('\n'));
        } else {
            const lines = [
                `✅ *${resultados.length} Documentos Salvos com Sucesso!*`,
                `👤 *Cliente:* ${resultados[0]?.clientName || '—'}`,
                ``,
            ];
            for (let i = 0; i < resultados.length; i++) {
                const r = resultados[i];
                if (r.link) {
                    lines.push(`${i + 1}. *${r.tipoDoc}* — \`${r.fileName}\``);
                    lines.push(`   🗂 ${r.descricao || '—'} — [Drive](${r.link})`);
                } else {
                    lines.push(`${i + 1}. ❌ *${r.tipoDoc}* — ${r.descricao}`);
                }
            }
            await sendMessage(chatId, lines.join('\n'));
        }
    }

    // ── Fechar lote e perguntar cliente ──────────────────────
    async function fecharLote(chatId, remetenteNumero, remetenteNome) {
        const batch = batchBuffer.get(chatId);
        if (!batch || batch.docs.length === 0) return;

        console.log(`[+] Lote fechado: ${batch.docs.length} doc(s) de ${remetenteNome}`);

        let clienteEncontrado = null;
        let nomeIA = null;
        let cpfIA = null;

        for (const doc of batch.docs) {
            if (doc.aiResult.nome_cliente) nomeIA = doc.aiResult.nome_cliente;
            if (doc.aiResult.cpf) cpfIA = doc.aiResult.cpf;
        }

        if (nomeIA || cpfIA) {
            clienteEncontrado = await findCliente(pool, { nome_cliente: nomeIA, cpf: cpfIA });
        }

        if (clienteEncontrado) {
            console.log(`[+] Lote: cliente auto-identificado: ${clienteEncontrado.nome}`);
            await finalizarLote(chatId, remetenteNumero, remetenteNome, batch.docs, clienteEncontrado.nome);
        } else {
            pendingDocs.set(chatId, { isLote: true, docs: batch.docs, remetenteNumero, remetenteNome });

            const buttons = [];
            if (nomeIA) {
                buttons.push([{ text: `🆕 Criar pasta: ${nomeIA}`, callback_data: 'lote_novo' }]);
                const similar = await findClientesSimilares(pool, nomeIA, 3);
                for (const c of similar) {
                    const label = c.cpf ? `${c.nome} (${c.cpf})` : c.nome;
                    buttons.push([{ text: `📂 Existente: ${label}`, callback_data: `lote_cliente_${c.id}` }]);
                }
            } else {
                buttons.push([{ text: '🆕 Cadastrar cliente novo', callback_data: 'lote_novo' }]);
            }

            const info = [`📦 *${batch.docs.length} documento(s) recebido(s):*`, ``];
            for (let i = 0; i < batch.docs.length; i++) {
                info.push(`${i + 1}. *${batch.docs[i].aiResult.tipo_documento || '—'}* — ${batch.docs[i].fileName}`);
            }
            if (nomeIA) info.push(``, `👤 Nome encontrado: *${nomeIA}*`);
            if (cpfIA) info.push(`🪪 CPF: ${cpfIA}`);
            info.push('', '👇 *A quem pertencem estes documentos?*');

            await sendMessage(chatId, info.join('\n'), {
                reply_markup: JSON.stringify({ inline_keyboard: buttons })
            });
        }

        batchBuffer.delete(chatId);
    }

    // ── Auxiliar: dividir texto longo para Telegram (max 4096) ──
    function splitText(text, maxLen) {
        const parts = [];
        let remaining = text;
        while (remaining.length > maxLen) {
            let splitAt = remaining.lastIndexOf('\n', maxLen);
            if (splitAt < maxLen * 0.5) splitAt = maxLen;
            parts.push(remaining.substring(0, splitAt));
            remaining = remaining.substring(splitAt).trimStart();
        }
        if (remaining.length > 0) parts.push(remaining);
        return parts;
    }

    // ── EXECUTOR — recebe decisão do orquestrador e executa ──
    async function executeDecision(chatId, decision, originalText, remetenteNumero, remetenteNome, user) {
        const { user_intent, executor, extracted_entities, resposta_usuario, needs_clarification, clarification_question } = decision;
        let resposta = resposta_usuario;

        console.log(`[orq] Executando: intent=${user_intent} executor=${executor} entities=${JSON.stringify(extracted_entities)}`);

        // Se precisa esclarecimento, perguntar
        if (needs_clarification && clarification_question) {
            await sendMessage(chatId, clarification_question);
            addAssistantResponse(chatId, clarification_question);
            return;
        }

        // ── DRIVE: criar pasta ──
        if (user_intent === 'criar_pasta' && (executor === 'DRIVE' || executor === 'N8N_DRIVE')) {
            const nomePasta = (extracted_entities.folder_name || '').trim();
            if (!nomePasta) {
                await sendMessage(chatId, 'Qual nome deseja dar para a pasta?');
                return;
            }
            try {
                const folder = await getOrCreateClientFolder(nomePasta, null, null);
                setPastaAtiva(chatId, nomePasta, folder.id);
                let msg = `Pasta *'${nomePasta}'* criada com sucesso.`;
                if (folder.webViewLink) msg += `\n🔗 [Abrir no Drive](${folder.webViewLink})`;
                msg += '\n\nDeseja que eu crie alguma subpasta dentro dela?';
                await sendMessage(chatId, msg);
                resposta = msg;
            } catch (e) {
                console.error('[orq] Erro criar pasta:', e.message);
                await sendMessage(chatId, `Não consegui criar a pasta '${nomePasta}'. Verifique a conexão com o Drive.`);
                resposta = 'Erro ao criar pasta';
            }

        // ── DRIVE: criar subpasta ──
        } else if (user_intent === 'criar_subpasta' && (executor === 'DRIVE' || executor === 'N8N_DRIVE')) {
            const nomeSubpasta = (extracted_entities.subfolder_name || '').trim();
            const ctx = getContext(chatId);
            let pastaPai = extracted_entities.parent_folder || ctx.pasta_ativa;
            let pastaPaiId = ctx.pasta_ativa_id;

            if (!nomeSubpasta) {
                await sendMessage(chatId, 'Qual nome deseja dar para a subpasta?');
                return;
            }
            if (!pastaPai) {
                await sendMessage(chatId, 'Em qual pasta devo criar essa subpasta? Informe o nome da pasta principal ou crie uma antes.');
                return;
            }
            try {
                if (!pastaPaiId || pastaPai !== ctx.pasta_ativa) {
                    const parent = await getOrCreateClientFolder(pastaPai, null, null);
                    pastaPaiId = parent.id;
                    setPastaAtiva(chatId, pastaPai, pastaPaiId);
                }
                const subfolder = await getOrCreateClientFolder(nomeSubpasta, null, pastaPaiId);
                setSubpastaAtiva(chatId, nomeSubpasta, subfolder.id);

                let msg = `Subpasta *'${nomeSubpasta}'* criada dentro de *'${pastaPai}'*.`;
                if (subfolder.webViewLink) msg += `\n🔗 [Abrir no Drive](${subfolder.webViewLink})`;
                msg += '\n\nAgora você pode me enviar documentos para salvar nela.';
                await sendMessage(chatId, msg);
                resposta = msg;
            } catch (e) {
                console.error('[orq] Erro criar subpasta:', e.message);
                await sendMessage(chatId, `Não consegui criar a subpasta '${nomeSubpasta}'. Verifique a conexão com o Drive.`);
                resposta = 'Erro ao criar subpasta';
            }

        // ── DB: buscar cliente ──
        } else if (user_intent === 'buscar_cliente' && (executor === 'DB' || executor === 'DIRETO')) {
            const nomeCliente = (extracted_entities.client_name || '').trim();
            if (!nomeCliente) {
                await sendMessage(chatId, 'Qual o nome do cliente que deseja buscar?');
                return;
            }
            const cliente = await findCliente(pool, { nome_cliente: nomeCliente });
            if (cliente) {
                setClienteAtivo(chatId, cliente.nome);
                const lines = [
                    `*Cliente encontrado:*`,
                    `👤 ${cliente.nome}`,
                    `🪪 CPF: ${cliente.cpf || '—'}`,
                    `📱 Tel: ${cliente.telefone || '—'}`,
                    `📧 Email: ${cliente.email || '—'}`,
                    `📍 ${cliente.endereco || '—'}`,
                ];
                if (cliente.drive_folder_url) lines.push(`📂 [Pasta no Drive](${cliente.drive_folder_url})`);
                await sendMessage(chatId, lines.join('\n'));
                resposta = lines.join('\n');
            } else {
                await sendMessage(chatId, `Nenhum cliente encontrado com o nome *${nomeCliente}*.\nEnvie um documento desse cliente e eu crio o cadastro automaticamente.`);
                resposta = 'Cliente não encontrado';
            }

        // ── DIRETO: listar contexto ──
        } else if (user_intent === 'listar_contexto') {
            const ctx = getContext(chatId);
            const lines = ['*Contexto atual:*'];
            if (ctx.pasta_ativa) lines.push(`📂 Pasta ativa: *${ctx.pasta_ativa}*`);
            else lines.push('Nenhuma pasta ativa no momento.');
            if (ctx.subpasta_ativa) lines.push(`📁 Subpasta ativa: *${ctx.subpasta_ativa}*`);
            if (ctx.cliente_ativo) lines.push(`👤 Cliente ativo: *${ctx.cliente_ativo}*`);
            if (ctx.ultimo_executor) lines.push(`⚙️ Último executor: ${ctx.ultimo_executor}`);
            await sendMessage(chatId, lines.join('\n'));
            resposta = lines.join('\n');

        // ── DIRETO: saudação ──
        } else if (user_intent === 'saudacao') {
            const ctx = getContext(chatId);
            const lines = ['Olá! Sou o assistente do escritório *Meneses e Teixeira*.', ''];
            lines.push('Posso ajudá-lo com:');
            lines.push('• Criar e organizar pastas no Drive');
            lines.push('• Classificar e salvar documentos');
            lines.push('• Buscar clientes cadastrados');
            lines.push('• Responder dúvidas jurídicas');
            lines.push('• Ouvir seus áudios e executar comandos por voz');
            lines.push('');
            if (ctx.pasta_ativa) {
                lines.push(`📂 Pasta ativa: *${ctx.pasta_ativa}*`);
                if (ctx.subpasta_ativa) lines.push(`📁 Subpasta: *${ctx.subpasta_ativa}*`);
                lines.push('');
            }
            lines.push('O que deseja fazer?');
            await sendMessage(chatId, lines.join('\n'));
            resposta = lines.join('\n');

        // ── DIRETO: continuar fluxo ──
        } else if (user_intent === 'continuar_fluxo') {
            if (resposta) {
                await sendMessage(chatId, resposta);
            } else {
                await sendMessage(chatId, 'Entendi. O que gostaria de fazer agora?');
                resposta = 'Aguardando instrução';
            }

        // ── IA_JURIDICA: gerar texto jurídico estruturado ──
        } else if (['gerar_texto_juridico', 'revisar_texto'].includes(user_intent)) {
            await sendMessage(chatId, '⚖️ _Gerando documento jurídico..._');
            try {
                const ctx = getContext(chatId);
                const legalContext = {
                    cliente_ativo: ctx.cliente_ativo,
                    pasta_ativa: ctx.pasta_ativa,
                };
                const legalText = await generateLegalText(originalText, legalContext);

                // Telegram limita mensagens a 4096 chars, dividir se necessário
                if (legalText.length <= 4000) {
                    await sendMessage(chatId, legalText);
                } else {
                    const parts = splitText(legalText, 4000);
                    for (const part of parts) {
                        await sendMessage(chatId, part);
                    }
                }
                resposta = legalText.substring(0, 200) + '...';
            } catch (e) {
                console.error('[!] Erro geração jurídica:', e.message);
                await sendMessage(chatId, 'Desculpe, não consegui gerar o texto jurídico. Tente novamente.');
                resposta = 'Erro na geração';
            }

        // ── IA_JURIDICA: chat geral / dúvidas jurídicas ──
        } else if (executor === 'IA_JURIDICA' || user_intent === 'responder_duvida') {
            if (resposta) {
                await sendMessage(chatId, resposta);
            } else {
                try {
                    const reply = await chat(chatId, originalText);
                    await sendMessage(chatId, reply);
                    resposta = reply;
                } catch (chatErr) {
                    console.error('[!] Erro chat Claude:', chatErr.message);
                    await sendMessage(chatId, 'Desculpe, não consegui processar sua pergunta no momento. Tente novamente.');
                    resposta = 'Erro no chat';
                }
            }

        // ── Fallback: se o orquestrador deu uma resposta, usar ──
        } else if (resposta) {
            await sendMessage(chatId, resposta);

        // ── Fallback final: chat com Claude ──
        } else {
            try {
                const reply = await chat(chatId, originalText);
                await sendMessage(chatId, reply);
                resposta = reply;
            } catch (e) {
                await sendMessage(chatId, 'O que deseja fazer? Posso criar pastas, salvar documentos ou responder dúvidas.');
                resposta = 'Fallback';
            }
        }

        addAssistantResponse(chatId, resposta || 'OK');
    }

    // ── Processar update ────────────────────────────────────
    async function processUpdate(update) {
        try {
            // ── Callbacks (botões) ──────────────────────────
            if (update.callback_query) {
                const cb = update.callback_query;
                const chatId = cb.message.chat.id;
                const data = cb.data;

                if (data.startsWith('register_')) {
                    const folderId = data.replace('register_', '');
                    const pending = getPendingUsers();
                    let nomePasta = null;
                    for (const [name, id] of Object.entries(pending)) {
                        if (id === folderId) { nomePasta = name; break; }
                    }
                    if (nomePasta) {
                        registerUser(String(cb.from.id), nomePasta, folderId);
                        await answerCallback(cb.id, `Registrado como ${nomePasta}!`);
                        await sendMessage(chatId, `✅ *Bem-vindo, ${nomePasta}!*\n\nSua pasta no Drive está configurada. Agora é só enviar documentos que eu organizo tudo pra você.`);
                    }
                    return;
                }

                const pendingDoc = pendingDocs.get(chatId);
                if (!pendingDoc) {
                    await answerCallback(cb.id, 'Sessão expirada. Envie o documento novamente.');
                    return;
                }

                await answerCallback(cb.id, 'Processando...');

                // Callbacks de LOTE
                if (pendingDoc.isLote) {
                    if (data === 'lote_novo') {
                        let nomeIA = null;
                        for (const d of pendingDoc.docs) {
                            if (d.aiResult.nome_cliente) { nomeIA = d.aiResult.nome_cliente; break; }
                        }
                        if (nomeIA) {
                            await finalizarLote(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc.docs, nomeIA);
                        } else {
                            pendingDoc.waitingForName = true;
                            pendingDocs.set(chatId, pendingDoc);
                            await sendMessage(chatId, "✏️ *Digite o nome completo do cliente:*");
                        }
                    } else if (data.startsWith('lote_cliente_')) {
                        const clienteId = data.replace('lote_cliente_', '');
                        const result = await pool.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
                        await finalizarLote(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc.docs, result.rows[0]?.nome);
                    }
                    return;
                }

                // Callbacks de doc único
                await sendMessage(chatId, '⏳ _Salvando documento..._');

                if (data === 'cliente_novo') {
                    if (pendingDoc.aiResult.nome_cliente) {
                        await finalizarDocumento(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc, null);
                    } else {
                        pendingDoc.waitingForName = true;
                        pendingDocs.set(chatId, pendingDoc);
                        await sendMessage(chatId, "✏️ *Digite o nome completo do cliente:*");
                    }
                } else if (data.startsWith('cliente_')) {
                    const clienteId = data.replace('cliente_', '');
                    const result = await pool.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
                    await finalizarDocumento(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc, result.rows[0]?.nome);
                }
                return;
            }

            if (!update.message) return;

            const message = update.message;
            const chatId = message.chat.id;
            const remetenteNumero = message.from.id.toString();
            const remetenteNome = message.from.first_name || message.from.username || 'Desconhecido';
            const user = getUser(remetenteNumero);

            let fileId = null;
            let fileName = 'documento_telegram';
            let fileSize = 0;
            let isVoice = false;

            if (message.voice) {
                isVoice = true;
                fileId = message.voice.file_id;
                fileName = `audio_${Date.now()}.ogg`;
                fileSize = message.voice.file_size || 0;
            } else if (message.audio) {
                isVoice = true;
                fileId = message.audio.file_id;
                fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
                fileSize = message.audio.file_size || 0;
            } else if (message.document) {
                fileId = message.document.file_id;
                fileName = message.document.file_name || fileName;
                fileSize = message.document.file_size || 0;
            } else if (message.photo && message.photo.length > 0) {
                const photo = message.photo[message.photo.length - 1];
                fileId = photo.file_id;
                fileName = `foto_${Date.now()}.jpg`;
                fileSize = photo.file_size || 0;
            }

            // ── Áudio recebido — transcrever e executar ─────
            if (isVoice && fileId) {
                if (!user) {
                    return await sendMessage(chatId, "⚠️ Você ainda não está registrado. Use /start para se identificar primeiro.");
                }

                await axios.post(`${TELEGRAM_API}/sendChatAction`, { chat_id: chatId, action: 'typing' });
                await sendMessage(chatId, '🎙️ _Ouvindo seu áudio..._');

                try {
                    const fileUrl = await getFileUrl(fileId);
                    if (!fileUrl) return await sendMessage(chatId, "❌ Erro ao baixar o áudio.");

                    const { base64Data, mimeType } = await downloadFileAsBase64(fileUrl, fileName);
                    console.log(`[orq] Áudio recebido de ${user.nome}: ${fileName} (${Math.round(base64Data.length/1024)}KB)`);

                    const { transcription, decision, error } = await transcribeAudio(chatId, base64Data, mimeType);

                    if (error || !transcription) {
                        return await sendMessage(chatId, `❌ ${error || 'Não consegui entender o áudio. Tente novamente.'}`);
                    }

                    await sendMessage(chatId, `🎙️ _"${transcription}"_`);

                    // Executar a decisão do orquestrador com o texto transcrito
                    await executeDecision(chatId, decision, transcription, remetenteNumero, remetenteNome, user);
                } catch (err) {
                    console.error('[!] Erro áudio:', err.message, err.stack);
                    await sendMessage(chatId, 'Desculpe, não consegui processar o áudio. Tente enviar como texto.');
                }
                return;
            }

            // ── Documento recebido ──────────────────────────
            if (fileId) {
                if (!user) {
                    return await sendMessage(chatId, "⚠️ Você ainda não está registrado. Use /start para se identificar primeiro.");
                }

                const sizeMB = fileSize / (1024 * 1024);
                if (sizeMB > MAX_FILE_SIZE_MB) {
                    return await sendMessage(chatId, `❌ Arquivo muito grande (${sizeMB.toFixed(1)}MB). Máximo: ${MAX_FILE_SIZE_MB}MB.`);
                }

                // Rate limit: documentos por hora
                const docLimit = checkDocumentLimit(chatId);
                if (!docLimit.allowed) {
                    return await sendMessage(chatId, `⚠️ Limite de documentos atingido (${docLimit.count}/hora). Aguarde ${docLimit.retryAfterMin} minuto(s).`);
                }

                // Informar destino se houver pasta ativa no contexto
                const destinoLabel = getDestinoLabel(chatId);
                if (destinoLabel) {
                    console.log(`[assistente] Documento será salvo em: ${destinoLabel}`);
                }

                const fileUrl = await getFileUrl(fileId);
                if (!fileUrl) return await sendMessage(chatId, "❌ Erro ao baixar o arquivo.");

                const { base64Data, mimeType } = await downloadFileAsBase64(fileUrl, fileName);
                console.log(`[+] Recebido de ${user.nome}: ${fileName} (${Math.round(base64Data.length/1024)}KB)`);

                const aiResult = await processDocument(base64Data, mimeType, fileName);
                console.log('[+] IA resultado:', JSON.stringify(aiResult).substring(0, 200));

                const docData = { aiResult, base64Data, mimeType, fileName, remetenteNumero, remetenteNome };

                // Acumular no lote
                let batch = batchBuffer.get(chatId);
                if (!batch) {
                    batch = { docs: [], remetenteNumero, remetenteNome };
                    batchBuffer.set(chatId, batch);
                }

                if (batch.docs.length >= MAX_BATCH) {
                    return await sendMessage(chatId, `⚠️ Limite de ${MAX_BATCH} documentos por lote atingido. Aguarde o processamento.`);
                }

                batch.docs.push(docData);
                const count = batch.docs.length;

                if (batchTimers.has(chatId)) clearTimeout(batchTimers.get(chatId));

                const destinoMsg = destinoLabel ? ` Destino: *${destinoLabel}*.` : '';
                if (count === 1) {
                    await sendMessage(chatId, `📄 _1 documento recebido (${aiResult.tipo_documento || '—'}).${destinoMsg} Envie mais ou aguarde 5s para processar._`);
                } else {
                    await sendMessage(chatId, `📄 _${count} documentos no lote (máx. ${MAX_BATCH}).${destinoMsg} Envie mais ou aguarde 5s._`);
                }

                const timer = setTimeout(() => {
                    batchTimers.delete(chatId);
                    if (batch.docs.length === 1) {
                        const singleDoc = batch.docs[0];
                        batchBuffer.delete(chatId);
                        handleSingleDoc(chatId, remetenteNumero, remetenteNome, singleDoc);
                    } else {
                        fecharLote(chatId, remetenteNumero, remetenteNome);
                    }
                }, BATCH_WAIT_MS);

                batchTimers.set(chatId, timer);
                return;
            }

            // ── Texto ───────────────────────────────────────
            if (message.text) {
                const text = message.text;

                const pendingDoc = pendingDocs.get(chatId);
                if (pendingDoc && pendingDoc.waitingForName && !text.startsWith('/')) {
                    const nomeDigitado = text.trim();

                    if (pendingDoc.isLote) {
                        for (const d of pendingDoc.docs) d.aiResult.nome_cliente = nomeDigitado;
                        await sendMessage(chatId, `⏳ _Criando pasta para *${nomeDigitado}* e salvando ${pendingDoc.docs.length} documento(s)..._`);
                        await finalizarLote(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc.docs, nomeDigitado);
                    } else {
                        pendingDoc.aiResult.nome_cliente = nomeDigitado;
                        pendingDoc.waitingForName = false;
                        await sendMessage(chatId, `⏳ _Criando pasta para *${nomeDigitado}* e salvando..._`);
                        await finalizarDocumento(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc, null);
                    }
                    return;
                }

                if (text === '/start') {
                    if (user) {
                        await sendMessage(chatId, `👋 *Olá, ${user.nome}!*\n\n${GREETING}`);
                    } else {
                        const pending = getPendingUsers();
                        const names = Object.entries(pending);
                        if (names.length === 0) {
                            return await sendMessage(chatId, "⚠️ Não há vagas de registro disponíveis. Contate o administrador.");
                        }
                        const buttons = names.map(([name, folderId]) => ([
                            { text: `👤 ${name}`, callback_data: `register_${folderId}` }
                        ]));
                        await sendMessage(chatId, `👋 *Bem-vindo ao Bot Jurídico!*\n\n🔐 Para começar, selecione seu nome:`, {
                            reply_markup: JSON.stringify({ inline_keyboard: buttons })
                        });
                    }
                } else {
                    // Rate limit: requisições por minuto
                    const reqLimit = checkRequestLimit(chatId);
                    if (!reqLimit.allowed) {
                        return await sendMessage(chatId, `⚠️ Muitas mensagens seguidas. Aguarde ${reqLimit.retryAfterSec}s.`);
                    }

                    // ── ORQUESTRADOR CENTRAL — roteia texto para executor correto ──
                    try {
                        await axios.post(`${TELEGRAM_API}/sendChatAction`, { chat_id: chatId, action: 'typing' });

                        const decision = await orquestrar(chatId, { type: 'texto', text });
                        await executeDecision(chatId, decision, text, remetenteNumero, remetenteNome, user);

                    } catch (err) {
                        console.error('[!] Erro orquestrador:', err.message, err.stack);
                        await sendMessage(chatId, 'Desculpe, não consegui processar sua mensagem. Tente novamente.');
                    }
                }
            }

        } catch (error) {
            console.error('Erro:', error.message, error.stack);
        }
    }

    // ── Doc único: buscar cliente ou perguntar ──────────────
    async function handleSingleDoc(chatId, remetenteNumero, remetenteNome, docData) {
        const { aiResult } = docData;
        let clienteEncontrado = await findCliente(pool, aiResult);

        if (clienteEncontrado) {
            console.log(`[+] Cliente auto-identificado: ${clienteEncontrado.nome}`);
            await sendMessage(chatId, `⏳ _Cliente identificado: *${clienteEncontrado.nome}*. Salvando..._`);
            await finalizarDocumento(chatId, remetenteNumero, remetenteNome, docData, clienteEncontrado.nome);
        } else {
            pendingDocs.set(chatId, { ...docData, remetenteNumero, remetenteNome });

            const buttons = [];
            const clientNameIA = aiResult.nome_cliente || null;

            if (clientNameIA) {
                buttons.push([{ text: `🆕 Criar pasta: ${clientNameIA}`, callback_data: 'cliente_novo' }]);
                const similar = await findClientesSimilares(pool, clientNameIA, 3);
                for (const c of similar) {
                    const label = c.cpf ? `${c.nome} (${c.cpf})` : c.nome;
                    buttons.push([{ text: `📂 Existente: ${label}`, callback_data: `cliente_${c.id}` }]);
                }
            } else {
                buttons.push([{ text: '🆕 Cadastrar cliente novo', callback_data: 'cliente_novo' }]);
            }

            const info = [
                `📋 *Documento analisado:*`,
                `📁 Tipo: *${aiResult.tipo_documento || '—'}*`,
                `🗂 ${aiResult.descricao || '—'}`,
            ];
            if (clientNameIA) info.push(`👤 Nome encontrado: *${clientNameIA}*`);
            if (aiResult.cpf) info.push(`🪪 CPF: ${aiResult.cpf}`);
            info.push('', '👇 *A quem pertence este documento?*');

            await sendMessage(chatId, info.join('\n'), {
                reply_markup: JSON.stringify({ inline_keyboard: buttons })
            });
        }
    }

    return processUpdate;
}

module.exports = (pool) => {
    const router = express.Router();
    const processUpdate = createProcessor(pool);
    router.post('/process-message', async (req, res) => {
        res.status(200).send('OK');
        await processUpdate(req.body);
    });
    return router;
};
module.exports.createProcessor = createProcessor;

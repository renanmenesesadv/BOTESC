const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { processDocument } = require('../services/geminiService');
const { getOrCreateClientFolder, uploadFile, getSubfolderInUserFolder } = require('../services/googleDriveService');
const { upsertClient } = require('../services/googleSheetsService');
const { findCliente, createCliente, updateCliente, getNextFileNumber, listClientes } = require('../services/clienteService');
const { getUser, registerUser, getPendingUsers, getSubfolder } = require('../services/userService');

const greetingPath = path.join(__dirname, '../../../prompts/greeting_start.txt');
const GREETING = fs.existsSync(greetingPath)
  ? fs.readFileSync(greetingPath, 'utf-8')
  : '👋 Olá! Envie uma foto ou PDF para classificar.';

const pendingDocs = new Map();

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

    // ── Finalizar: upload + banco + planilha + confirmação ──
    async function finalizarDocumento(chatId, remetenteNumero, remetenteNome, pending, clienteNome) {
        const { aiResult, base64Data, mimeType, fileName } = pending;
        const user = getUser(remetenteNumero);

        if (!user) {
            await sendMessage(chatId, "❌ Você não está registrado. Use /start para se registrar.");
            return;
        }

        let cliente, clienteStatus;
        const clientName = clienteNome || aiResult.nome_cliente || remetenteNome;

        // Buscar ou criar cliente
        const clienteExistente = await findCliente(pool, { nome_cliente: clientName, cpf: aiResult.cpf });
        if (clienteExistente) {
            cliente = clienteExistente;
            clienteStatus = 'existente';
            await updateCliente(pool, cliente.id, aiResult);
        } else {
            clienteStatus = 'novo';
            // Criar pasta do cliente dentro de Clientes/ do usuário
            const clientesFolderId = await getSubfolderInUserFolder(user.drive_folder_id, 'Clientes');
            const clientFolder = await getOrCreateClientFolder(clientName, null, clientesFolderId);
            cliente = await createCliente(pool, { ...aiResult, nome_cliente: clientName }, clientFolder.id, clientFolder.webViewLink);
        }

        // Determinar subpasta pelo tipo de documento
        const tipoDoc = aiResult.tipo_documento || 'Outro';
        const subfolderName = getSubfolder(tipoDoc);
        const targetFolderId = await getSubfolderInUserFolder(user.drive_folder_id, subfolderName);

        // Nome do arquivo: NNN_Tipo_NomeCliente
        const nextNum = await getNextFileNumber(pool, cliente.id);
        const numStr = String(nextNum).padStart(3, '0');
        const cleanName = clientName.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
        const cleanType = tipoDoc.replace(/\s+/g, '_');
        const finalFileName = `${numStr}_${cleanType}_${cleanName}`;

        // Upload
        const fileResult = await uploadFile(targetFolderId, finalFileName, base64Data, mimeType);

        // Salvar no banco
        await pool.query(
            `INSERT INTO documentos (cliente_id, remetente_numero, remetente_nome, nome_arquivo_original, nome_arquivo_salvo, tipo_documento, descricao_gemini, link_drive, pasta_drive, numero_arquivo, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [cliente.id, remetenteNumero, remetenteNome, fileName, fileResult.name, tipoDoc, aiResult.descricao, fileResult.webViewLink, targetFolderId, nextNum, 'processado']
        );

        // Planilha
        try {
            await upsertClient({ nome: clientName, cpf: aiResult.cpf, rg: aiResult.rg, telefone: aiResult.telefone, email: aiResult.email, endereco: aiResult.endereco }, fileResult.webViewLink);
        } catch (e) { console.error('[!] Erro planilha:', e.message); }

        // ── Mensagem de confirmação detalhada ──
        const statusEmoji = clienteStatus === 'novo' ? '🆕 Cliente Novo — Pasta criada' : '🔄 Cliente Existente';
        const lines = [
            `✅ *Documento Salvo com Sucesso!*`,
            ``,
            `👤 *Cliente:* ${clientName}`,
            `${statusEmoji}`,
            ``,
            `📋 *Detalhes do documento:*`,
            `📁 Tipo: *${tipoDoc}*`,
            `🗂 Descrição: ${aiResult.descricao || '—'}`,
            `📅 Data: ${aiResult.data_documento || '—'}`,
            ``,
            `💾 *Arquivo salvo como:*`,
            `\`${fileResult.name}\``,
            `📂 Pasta: *${user.nome} → ${subfolderName}*`,
        ];
        if (aiResult.cpf) lines.push(`🪪 CPF: ${aiResult.cpf}`);
        if (aiResult.rg) lines.push(`🪪 RG: ${aiResult.rg}`);
        if (aiResult.endereco) lines.push(`📍 Endereço: ${aiResult.endereco}`);
        if (fileResult.webViewLink) {
            lines.push(``, `🔗 [Abrir no Google Drive](${fileResult.webViewLink})`);
        }

        await sendMessage(chatId, lines.join('\n'));
        pendingDocs.delete(chatId);
    }

    // ── Processar update ────────────────────────────────────
    async function processUpdate(update) {
        try {
            // ── Callbacks (botões) ──────────────────────────
            if (update.callback_query) {
                const cb = update.callback_query;
                const chatId = cb.message.chat.id;
                const data = cb.data;

                // Registro de usuário
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
                    const nome = result.rows[0]?.nome;
                    await finalizarDocumento(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc, nome);
                }
                return;
            }

            if (!update.message) return;

            const message = update.message;
            const chatId = message.chat.id;
            const remetenteNumero = message.from.id.toString();
            const remetenteNome = message.from.first_name || message.from.username || 'Desconhecido';

            // Verificar se usuário está registrado
            const user = getUser(remetenteNumero);

            let fileId = null;
            let fileName = 'documento_telegram';

            if (message.document) {
                fileId = message.document.file_id;
                fileName = message.document.file_name || fileName;
            } else if (message.photo && message.photo.length > 0) {
                fileId = message.photo[message.photo.length - 1].file_id;
                fileName = `foto_${Date.now()}.jpg`;
            }

            // ── Documento recebido ──────────────────────────
            if (fileId) {
                if (!user) {
                    await sendMessage(chatId, "⚠️ Você ainda não está registrado. Use /start para se identificar primeiro.");
                    return;
                }

                console.log(`[+] Documento de ${user.nome}: ${fileName}`);
                await sendMessage(chatId, `⏳ _Recebido, ${user.nome}! Analisando documento..._`);

                const fileUrl = await getFileUrl(fileId);
                if (!fileUrl) return await sendMessage(chatId, "❌ Erro ao baixar o arquivo.");

                const { base64Data, mimeType } = await downloadFileAsBase64(fileUrl, fileName);
                console.log(`[+] MIME: ${mimeType}, Tamanho: ${Math.round(base64Data.length/1024)}KB`);

                const aiResult = await processDocument(base64Data, mimeType, fileName);
                console.log('[+] IA resultado:', JSON.stringify(aiResult));

                // Buscar cliente automaticamente
                let clienteEncontrado = await findCliente(pool, aiResult);

                if (clienteEncontrado) {
                    console.log(`[+] Cliente auto-identificado: ${clienteEncontrado.nome}`);
                    await sendMessage(chatId, `⏳ _Cliente identificado: *${clienteEncontrado.nome}*. Salvando..._`);
                    await finalizarDocumento(chatId, remetenteNumero, remetenteNome,
                        { aiResult, base64Data, mimeType, fileName, remetenteNumero, remetenteNome },
                        clienteEncontrado.nome);
                } else {
                    // Perguntar ao usuário
                    pendingDocs.set(chatId, { aiResult, base64Data, mimeType, fileName, remetenteNumero, remetenteNome });

                    const clientes = await listClientes(pool, 8);
                    const buttons = [];
                    const clientNameIA = aiResult.nome_cliente || null;

                    if (clientNameIA) {
                        buttons.push([{ text: `🆕 Criar: ${clientNameIA}`, callback_data: 'cliente_novo' }]);
                    } else {
                        buttons.push([{ text: '🆕 Cadastrar cliente novo', callback_data: 'cliente_novo' }]);
                    }

                    for (const c of clientes) {
                        const label = c.cpf ? `${c.nome} (${c.cpf})` : c.nome;
                        buttons.push([{ text: `📂 ${label}`, callback_data: `cliente_${c.id}` }]);
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

            } else if (message.text) {
                const text = message.text;

                // Esperando nome do cliente
                const pendingDoc = pendingDocs.get(chatId);
                if (pendingDoc && pendingDoc.waitingForName && !text.startsWith('/')) {
                    const nomeDigitado = text.trim();
                    pendingDoc.aiResult.nome_cliente = nomeDigitado;
                    pendingDoc.waitingForName = false;
                    await sendMessage(chatId, `⏳ _Criando pasta para *${nomeDigitado}* e salvando..._`);
                    await finalizarDocumento(chatId, pendingDoc.remetenteNumero, pendingDoc.remetenteNome, pendingDoc, null);
                    return;
                }

                if (text === '/start') {
                    if (user) {
                        await sendMessage(chatId, `👋 *Olá, ${user.nome}!*\n\n${GREETING}`);
                    } else {
                        // Registro: mostrar botões com usuários pendentes
                        const pending = getPendingUsers();
                        const names = Object.entries(pending);

                        if (names.length === 0) {
                            await sendMessage(chatId, "⚠️ Não há vagas de registro disponíveis. Contate o administrador.");
                            return;
                        }

                        const buttons = names.map(([name, folderId]) => ([
                            { text: `👤 ${name}`, callback_data: `register_${folderId}` }
                        ]));

                        await sendMessage(chatId, `👋 *Bem-vindo ao Bot Jurídico!*\n\n🔐 Para começar, selecione seu nome:`, {
                            reply_markup: JSON.stringify({ inline_keyboard: buttons })
                        });
                    }
                } else {
                    await sendMessage(chatId, "📎 Envie um documento em formato de *Imagem* ou *PDF* para processá-lo.");
                }
            }

        } catch (error) {
            console.error('Erro:', error.message, error.stack);
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

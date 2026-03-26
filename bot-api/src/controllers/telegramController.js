const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getOrCreateClientFolder, uploadFile, getSubfolderInUserFolder } = require('../services/googleDriveService');
const { chat, getTargetFolder } = require('../services/chatService');
const { transcribeAudio, parseIntent } = require('../services/audioService');
const { checkLimit, getRemainingTime } = require('../services/rateLimiter');
const { getUser, registerUser, getPendingUsers } = require('../services/userService');
const { initContext, getContext, setContext, generateBatchId, addPendingFile, countPendingFiles } = require('../services/contextService');
const { processBatch } = require('../services/batchProcessor');

const greetingPath = path.join(__dirname, '../../../prompts/greeting_start.txt');
const GREETING = fs.existsSync(greetingPath)
  ? fs.readFileSync(greetingPath, 'utf-8')
  : '👋 Olá! Envie documentos, fotos, áudios ou me diga o que precisa.';

const BATCH_WAIT_MS = 8000; // 8 segundos de janela para acumular
const MAX_FILE_SIZE_MB = 20;

// Estado em memória (leve — só timers e batch IDs)
const batchTimers = new Map();   // chatId → timer
const activeBatches = new Map(); // chatId → batchId

function createProcessor(pool) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    // Inicializar contexto
    initContext(pool);

    // ── Helpers ──────────────────────────────────────────────
    const sendMessage = async (chatId, text, extra = {}) => {
        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId, text, parse_mode: 'Markdown', ...extra
            });
        } catch (error) {
            if (error.response?.data?.error_code === 400) {
                try {
                    await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text, ...extra });
                } catch (e2) {
                    console.error('Erro envio:', e2.response?.data || e2.message);
                }
            } else {
                console.error('Erro envio:', error.response?.data || error.message);
            }
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

    // ── Fechar lote e processar ──────────────────────────────
    async function closeBatch(chatId, convId) {
        const batchId = activeBatches.get(chatId);
        if (!batchId) return;

        activeBatches.delete(chatId);
        batchTimers.delete(chatId);

        const count = await countPendingFiles(convId, batchId);
        if (count === 0) return;

        await sendMessage(chatId, `⏳ _Processando ${count} documento(s)... Aguarde._`);

        try {
            const result = await processBatch(pool, convId, batchId);
            if (!result) return;

            // Verificar conflito
            if (result.confidence < 0.6 && count > 1) {
                // Há possível conflito — informar mas processar mesmo assim
                console.log(`[BATCH] Confiança baixa: ${result.confidence}`);
            }

            // Montar resposta única
            const okCount = result.results.filter(r => r.ok).length;
            const lines = [
                `✅ *Lote processado com sucesso!*`,
                ``,
                `📂 *Caso:* ${result.caseName}`,
            ];
            if (result.hospital) lines.push(`🏥 *Hospital:* ${result.hospital}`);
            if (result.owner) lines.push(`👤 *Proprietário:* ${result.owner}`);
            lines.push(`📁 *Destino:* ${result.folderPath}`);
            lines.push(`📊 *Total:* ${okCount}/${count} documentos salvos`);
            lines.push(``);

            for (let i = 0; i < result.results.length; i++) {
                const r = result.results[i];
                if (r.ok) {
                    lines.push(`${i + 1}. ${r.tipoDoc} - \`${r.fileName}\``);
                } else {
                    lines.push(`${i + 1}. ❌ ${r.tipoDoc} - ${r.descricao}`);
                }
            }

            // Primeiro link do Drive
            const firstLink = result.results.find(r => r.ok && r.link);
            if (firstLink) {
                lines.push(``, `🔗 [Abrir pasta no Drive](${firstLink.link})`);
            }

            await sendMessage(chatId, lines.join('\n'));

        } catch (err) {
            console.error('[BATCH] Erro fatal:', err.message, err.stack);
            await sendMessage(chatId, `❌ Erro ao processar o lote: ${err.message}`);
        }
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
                        await sendMessage(chatId, `✅ *Bem-vindo, ${nomePasta}!*\n\nSua pasta no Drive está configurada. Agora é só enviar documentos ou me dizer o que precisa.`);
                    }
                    return;
                }

                await answerCallback(cb.id, 'OK');
                return;
            }

            if (!update.message) return;

            const message = update.message;
            const chatId = message.chat.id;
            const convId = message.from.id.toString();
            const userName = message.from.first_name || message.from.username || 'Desconhecido';
            const user = getUser(convId);

            // Rate limiting
            if (!checkLimit(convId)) {
                const secs = getRemainingTime(convId);
                return await sendMessage(chatId, `⏳ Muitas requisições. Aguarde ${secs}s.`);
            }

            // ── Detectar tipo de entrada ────────────────────
            let fileId = null;
            let fileName = 'documento';
            let fileSize = 0;

            if (message.document) {
                fileId = message.document.file_id;
                fileName = message.document.file_name || fileName;
                fileSize = message.document.file_size || 0;
            } else if (message.photo && message.photo.length > 0) {
                const photo = message.photo[message.photo.length - 1];
                fileId = photo.file_id;
                fileName = `foto_${Date.now()}.jpg`;
                fileSize = photo.file_size || 0;
            }

            // ── ARQUIVO (PDF, foto, documento) ──────────────
            if (fileId) {
                if (!user) {
                    return await sendMessage(chatId, "⚠️ Use /start para se registrar primeiro.");
                }

                const sizeMB = fileSize / (1024 * 1024);
                if (sizeMB > MAX_FILE_SIZE_MB) {
                    return await sendMessage(chatId, `❌ Arquivo muito grande (${sizeMB.toFixed(1)}MB). Máximo: ${MAX_FILE_SIZE_MB}MB.`);
                }

                // Baixar arquivo
                const fileUrl = await getFileUrl(fileId);
                if (!fileUrl) return await sendMessage(chatId, "❌ Erro ao baixar o arquivo.");

                const { base64Data, mimeType } = await downloadFileAsBase64(fileUrl, fileName);
                console.log(`[+] Arquivo: ${fileName} (${Math.round(base64Data.length/1024)}KB) de ${user.nome}`);

                // Criar ou reusar batch
                let batchId = activeBatches.get(chatId);
                if (!batchId) {
                    batchId = generateBatchId();
                    activeBatches.set(chatId, batchId);
                }

                // Salvar no banco como pendente
                await addPendingFile(convId, batchId, fileName, mimeType, base64Data);
                const count = await countPendingFiles(convId, batchId);

                // Cancelar timer anterior
                if (batchTimers.has(chatId)) {
                    clearTimeout(batchTimers.get(chatId));
                }

                // Feedback mínimo (só no 1o arquivo e a cada 5)
                if (count === 1) {
                    await sendMessage(chatId, `📄 _Recebido. Aguardando mais arquivos (8s)..._`);
                } else if (count % 5 === 0) {
                    await sendMessage(chatId, `📄 _${count} documentos no lote. Aguardando..._`);
                }

                // Timer: fecha lote após 8s sem novo arquivo
                const timer = setTimeout(() => {
                    closeBatch(chatId, convId);
                }, BATCH_WAIT_MS);
                batchTimers.set(chatId, timer);

                return;
            }

            // ── ÁUDIO / VOZ ─────────────────────────────────
            if (message.voice || message.audio) {
                if (!user) return await sendMessage(chatId, "⚠️ Use /start para se registrar primeiro.");

                const audioFileId = message.voice?.file_id || message.audio?.file_id;
                await axios.post(`${TELEGRAM_API}/sendChatAction`, { chat_id: chatId, action: 'typing' });

                try {
                    const audioUrl = await getFileUrl(audioFileId);
                    if (!audioUrl) return await sendMessage(chatId, "❌ Erro ao baixar o áudio.");

                    const transcription = await transcribeAudio(audioUrl);
                    console.log(`[+] Áudio de ${user.nome}: ${transcription.substring(0, 100)}`);

                    // Tratar como texto — o chat interpreta a intenção
                    const reply = await chat(chatId, transcription);
                    await sendMessage(chatId, `🎙️ _"${transcription}"_\n\n${reply}`);
                } catch (err) {
                    console.error('[!] Erro áudio:', err.message);
                    await sendMessage(chatId, "❌ Não consegui processar o áudio. Tente enviar como texto.");
                }
                return;
            }

            // ── TEXTO ───────────────────────────────────────
            if (message.text) {
                const text = message.text;

                if (text === '/start') {
                    if (user) {
                        await sendMessage(chatId, `👋 *Olá, ${user.nome}!*\n\n${GREETING}`);
                    } else {
                        const pending = getPendingUsers();
                        const names = Object.entries(pending);
                        if (names.length === 0) {
                            return await sendMessage(chatId, "⚠️ Não há vagas de registro. Contate o administrador.");
                        }
                        const buttons = names.map(([name, folderId]) => ([
                            { text: `👤 ${name}`, callback_data: `register_${folderId}` }
                        ]));
                        await sendMessage(chatId, `👋 *Bem-vindo ao Bot Jurídico!*\n\n🔐 Selecione seu nome:`, {
                            reply_markup: JSON.stringify({ inline_keyboard: buttons })
                        });
                    }
                    return;
                }

                if (text === '/limpar') {
                    await setContext(convId, {
                        active_root_folder: null, active_hospital: null,
                        active_patient: null, active_owner: null,
                        active_folder_id: null, destination_locked: false
                    });
                    return await sendMessage(chatId, "🧹 Contexto limpo. Pode definir novo destino.");
                }

                if (!user) {
                    return await sendMessage(chatId, "⚠️ Use /start para se registrar primeiro.");
                }

                // Chat inteligente — Claude interpreta e executa
                await axios.post(`${TELEGRAM_API}/sendChatAction`, { chat_id: chatId, action: 'typing' });

                try {
                    const reply = await chat(chatId, text);

                    // Verificar se o chat definiu destino
                    const target = getTargetFolder(chatId);
                    if (target) {
                        // Sincronizar com contexto persistente
                        await setContext(convId, {
                            active_folder_id: target.folderId,
                            destination_locked: true
                        });
                    }

                    await sendMessage(chatId, reply);
                } catch (err) {
                    console.error('[!] Erro chat:', err.message);
                    await sendMessage(chatId, "❌ Erro ao processar. Tente novamente.");
                }
            }

        } catch (error) {
            console.error('Erro geral:', error.message, error.stack);
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

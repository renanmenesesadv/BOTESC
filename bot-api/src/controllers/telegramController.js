const express = require('express');
const axios = require('axios');
const { processDocument } = require('../services/geminiService');
const { getOrCreateClientFolder, uploadFile } = require('../services/googleDriveService');
const { upsertClient } = require('../services/googleSheetsService');
const { findCliente, createCliente, updateCliente, getNextFileNumber } = require('../services/clienteService');

// Lógica de processamento separada (usada por HTTP e polling)
function createProcessor(pool) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    const sendMessage = async (chatId, text) => {
        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error('Erro ao enviar mensagem para o Telegram:', error.response?.data || error.message);
        }
    };

    const getFileUrl = async (fileId) => {
        try {
            const res = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
            const filePath = res.data.result.file_path;
            return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
        } catch (error) {
            console.error('Erro ao obter caminho do arquivo no Telegram:', error.response?.data || error.message);
            return null;
        }
    };

    const downloadFileAsBase64 = async (url, originalFileName) => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        let mimeType = response.headers['content-type'];
        const base64Data = Buffer.from(response.data, 'binary').toString('base64');

        // Telegram retorna application/octet-stream para PDFs — corrigir pelo nome do arquivo
        if (mimeType === 'application/octet-stream' && originalFileName) {
            const ext = originalFileName.toLowerCase().split('.').pop();
            const mimeMap = {
                pdf: 'application/pdf',
                jpg: 'image/jpeg', jpeg: 'image/jpeg',
                png: 'image/png', gif: 'image/gif',
                webp: 'image/webp', doc: 'application/msword',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            };
            if (mimeMap[ext]) mimeType = mimeMap[ext];
        }

        return { base64Data, mimeType };
    };

    // ── Processar um update do Telegram ──────────────────
    async function processUpdate(update) {
        try {
            if (!update.message) return;

            const message = update.message;
            const chatId = message.chat.id;
            const remetenteNumero = message.from.id.toString();
            const remetenteNome = message.from.first_name || message.from.username || 'Desconhecido';

            let fileId = null;
            let fileName = 'documento_telegram';

            if (message.document) {
                fileId = message.document.file_id;
                fileName = message.document.file_name || fileName;
            } else if (message.photo && message.photo.length > 0) {
                fileId = message.photo[message.photo.length - 1].file_id;
                fileName = `foto_${Date.now()}.jpg`;
            }

            if (fileId) {
                console.log(`[+] Midia recebida de ${remetenteNome}. Baixando...`);
                await sendMessage(chatId, "⏳ _Recebido! A IA está analisando seu documento..._");

                const fileUrl = await getFileUrl(fileId);
                if (!fileUrl) {
                    return await sendMessage(chatId, "❌ Erro ao baixar o arquivo do Telegram.");
                }
                const { base64Data, mimeType } = await downloadFileAsBase64(fileUrl, fileName);

                console.log('[+] Transmitindo para a IA...');
                const aiResult = await processDocument(base64Data, mimeType, fileName);
                console.log('[+] IA resultado:', JSON.stringify(aiResult));

                let cliente = await findCliente(pool, aiResult);
                let clienteStatus;
                let folder;

                const clientName = aiResult.nome_cliente || remetenteNome;

                if (cliente) {
                    clienteStatus = 'existente';
                    console.log(`[+] Cliente existente: ${cliente.nome} (ID ${cliente.id})`);
                    await updateCliente(pool, cliente.id, aiResult);

                    if (cliente.drive_folder_id) {
                        folder = { id: cliente.drive_folder_id, webViewLink: cliente.drive_folder_url };
                    } else {
                        folder = await getOrCreateClientFolder(clientName);
                        await pool.query(
                            `UPDATE clientes SET drive_folder_id = $1, drive_folder_url = $2 WHERE id = $3`,
                            [folder.id, folder.webViewLink, cliente.id]
                        );
                    }
                } else {
                    clienteStatus = 'novo';
                    console.log(`[+] Novo cliente detectado: ${clientName}`);
                    folder = await getOrCreateClientFolder(clientName);
                    cliente = await createCliente(pool, {
                        ...aiResult,
                        nome_cliente: clientName
                    }, folder.id, folder.webViewLink);
                }

                const fileResult = await uploadFile(
                    folder.id,
                    aiResult.nome_sugerido || fileName,
                    base64Data,
                    mimeType
                );

                const nextNum = await getNextFileNumber(pool, cliente.id);
                await pool.query(
                    `INSERT INTO documentos
                    (cliente_id, remetente_numero, remetente_nome, nome_arquivo_original, nome_arquivo_salvo, tipo_documento, descricao_gemini, link_drive, pasta_drive, numero_arquivo, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        cliente.id, remetenteNumero, remetenteNome, fileName,
                        fileResult.name, aiResult.tipo_documento, aiResult.descricao,
                        fileResult.webViewLink, folder.id, nextNum, 'processado'
                    ]
                );

                try {
                    await upsertClient({
                        nome: clientName, cpf: aiResult.cpf, rg: aiResult.rg,
                        telefone: aiResult.telefone, email: aiResult.email,
                        endereco: aiResult.endereco
                    }, folder.webViewLink);
                } catch (sheetsErr) {
                    console.error('[!] Erro ao atualizar planilha:', sheetsErr.message);
                }

                const statusEmoji = clienteStatus === 'novo' ? '🆕 Cliente Novo' : '🔄 Cliente Existente';
                const responseText = [
                    `✅ *Documento Processado!*`, ``,
                    `👤 *Cliente:* ${clientName}`,
                    `${statusEmoji}`,
                    `📁 *Tipo:* ${aiResult.tipo_documento}`,
                    `🗂 *Descrição:* ${aiResult.descricao}`,
                    `💾 *Arquivo:* ${fileResult.name}`,
                    aiResult.cpf ? `🪪 *CPF:* ${aiResult.cpf}` : '',
                    fileResult.webViewLink ? `🔗 [Ver no Drive](${fileResult.webViewLink})` : ''
                ].filter(Boolean).join('\n');

                await sendMessage(chatId, responseText);

            } else if (message.text) {
                const text = message.text;
                if (text === '/start') {
                    await sendMessage(chatId, "👋 Olá! Sou o assistente de documentos do escritório.\n\nEnvie uma *foto* ou *PDF* e eu irei:\n📋 Classificar o documento\n👤 Identificar o cliente\n📂 Arquivar no Google Drive\n📊 Registrar na planilha");
                } else {
                    await sendMessage(chatId, "📎 Por favor, me envie o documento em formato de *Imagem* ou *PDF* para que eu possa processá-lo.");
                }
            }

        } catch (error) {
            console.error('Erro ao processar mensagem do Telegram:', error.message);
        }
    }

    return processUpdate;
}

// Exporta o router HTTP (para uso via n8n/webhook)
module.exports = (pool) => {
    const router = express.Router();
    const processUpdate = createProcessor(pool);

    router.post('/process-message', async (req, res) => {
        res.status(200).send('OK');
        await processUpdate(req.body);
    });

    return router;
};

// Exporta o processador para uso com polling
module.exports.createProcessor = createProcessor;

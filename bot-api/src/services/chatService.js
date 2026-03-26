const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getOrCreateClientFolder, getSubfolderInUserFolder } = require('./googleDriveService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const promptPath = path.join(__dirname, '../../../prompts/assistant_chat.txt');
const SYSTEM_PROMPT = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : 'Você é um assistente jurídico. Responda de forma clara e objetiva.';

const MAX_HISTORY = 10;
let _pool = null;

function initChat(pool) {
  _pool = pool;
  pool.query(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      role VARCHAR(10) NOT NULL,
      content TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
  pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_history_chat ON chat_history(chat_id)`).catch(() => {});
}

async function getHistory(chatId) {
  if (!_pool) return [];
  const res = await _pool.query(
    `SELECT role, content FROM chat_history WHERE chat_id = $1 ORDER BY id DESC LIMIT $2`,
    [chatId, MAX_HISTORY]
  );
  return res.rows.reverse();
}

async function addToHistory(chatId, role, content) {
  if (!_pool) return;
  await _pool.query(
    `INSERT INTO chat_history (chat_id, role, content) VALUES ($1, $2, $3)`,
    [chatId, role, content]
  );
  await _pool.query(
    `DELETE FROM chat_history WHERE chat_id = $1 AND id NOT IN (
       SELECT id FROM chat_history WHERE chat_id = $1 ORDER BY id DESC LIMIT $2
     )`,
    [chatId, MAX_HISTORY * 2]
  ).catch(() => {});
}

// Extrai blocos [ACAO]...[/ACAO] da resposta do Claude
function extractActions(text) {
  const actions = [];
  const regex = /\[ACAO\](.*?)\[\/ACAO\]/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      actions.push(JSON.parse(match[1]));
    } catch (e) {
      console.error('[!] Erro parsing ação:', match[1]);
    }
  }
  // Limpar ações do texto visível
  const cleanText = text.replace(/\[ACAO\].*?\[\/ACAO\]/gs, '').trim();
  return { cleanText, actions };
}

// Executa ações retornadas pelo Claude
async function executeActions(actions) {
  const results = [];

  for (const action of actions) {
    try {
      if (action.tipo === 'criar_pasta') {
        const folder = await getOrCreateClientFolder(action.nome);
        console.log(`[+] Chat: Pasta criada: ${action.nome} (${folder.id})`);
        results.push({ ok: true, tipo: 'pasta', nome: action.nome, link: folder.webViewLink });

      } else if (action.tipo === 'criar_subpasta') {
        // Primeiro encontra a pasta pai
        const parentFolder = await getOrCreateClientFolder(action.pasta_pai);
        const subId = await getSubfolderInUserFolder(parentFolder.id, action.nome);
        console.log(`[+] Chat: Subpasta criada: ${action.nome} dentro de ${action.pasta_pai}`);
        results.push({ ok: true, tipo: 'subpasta', nome: action.nome, pai: action.pasta_pai });

      } else {
        console.log(`[!] Ação desconhecida: ${action.tipo}`);
      }
    } catch (err) {
      console.error(`[!] Erro executando ação ${action.tipo}:`, err.message);
      results.push({ ok: false, tipo: action.tipo, nome: action.nome, erro: err.message });
    }
  }

  return results;
}

async function chat(chatId, userMessage) {
  await addToHistory(chatId, 'user', userMessage);

  const history = await getHistory(chatId);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: history
  });

  const rawReply = response.content[0].text;
  const { cleanText, actions } = extractActions(rawReply);

  // Executar ações operacionais (criar pasta, subpasta, etc)
  let actionResults = [];
  if (actions.length > 0) {
    console.log(`[+] Chat: ${actions.length} ação(ões) detectada(s)`);
    actionResults = await executeActions(actions);
  }

  // Salvar a resposta limpa no histórico
  await addToHistory(chatId, 'assistant', cleanText);

  // Adicionar links das pastas criadas na resposta
  let finalReply = cleanText;
  for (const r of actionResults) {
    if (r.ok && r.link) {
      finalReply += `\n🔗 [Abrir pasta "${r.nome}" no Drive](${r.link})`;
    }
    if (!r.ok) {
      finalReply += `\n❌ Erro ao ${r.tipo}: ${r.erro}`;
    }
  }

  return finalReply;
}

module.exports = { chat, initChat };

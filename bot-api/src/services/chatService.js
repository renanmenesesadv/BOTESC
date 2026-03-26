const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const promptPath = path.join(__dirname, '../../../prompts/assistant_chat.txt');
const SYSTEM_PROMPT = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : 'Você é um assistente jurídico. Responda de forma clara e objetiva.';

const MAX_HISTORY = 10;
let _pool = null;

function initChat(pool) {
  _pool = pool;
  // Criar tabela se não existir (idempotente)
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
  return res.rows.reverse(); // mais antigo primeiro
}

async function addToHistory(chatId, role, content) {
  if (!_pool) return;
  await _pool.query(
    `INSERT INTO chat_history (chat_id, role, content) VALUES ($1, $2, $3)`,
    [chatId, role, content]
  );
  // Limpar mensagens antigas (manter só as últimas MAX_HISTORY * 2)
  await _pool.query(
    `DELETE FROM chat_history WHERE chat_id = $1 AND id NOT IN (
       SELECT id FROM chat_history WHERE chat_id = $1 ORDER BY id DESC LIMIT $2
     )`,
    [chatId, MAX_HISTORY * 2]
  ).catch(() => {});
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

  const reply = response.content[0].text;
  await addToHistory(chatId, 'assistant', reply);

  return reply;
}

module.exports = { chat, initChat };

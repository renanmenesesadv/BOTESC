const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const promptPath = path.join(__dirname, '../../../prompts/assistant_chat.txt');
const SYSTEM_PROMPT = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : 'Você é um assistente jurídico. Responda de forma clara e objetiva.';

// Histórico por chat (últimas 10 mensagens para contexto)
const chatHistory = new Map();
const MAX_HISTORY = 10;

function getHistory(chatId) {
  return chatHistory.get(chatId) || [];
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Manter só as últimas MAX_HISTORY mensagens
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  chatHistory.set(chatId, history);
}

async function chat(chatId, userMessage) {
  addToHistory(chatId, 'user', userMessage);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId)
  });

  const reply = response.content[0].text;
  addToHistory(chatId, 'assistant', reply);

  return reply;
}

module.exports = { chat };

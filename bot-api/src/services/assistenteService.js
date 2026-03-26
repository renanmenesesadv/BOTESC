/**
 * Assistente Jurídico Inteligente — interpreta intenções do usuário
 * e gerencia contexto operacional (pasta ativa, subpasta, cliente).
 *
 * Usa Gemini (primário) + Claude (fallback) para interpretar texto livre.
 */
const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Prompt de interpretação de intenção
const intentPromptPath = path.join(__dirname, '../../../prompts/assistente_intent.txt');
const INTENT_PROMPT_TEMPLATE = fs.existsSync(intentPromptPath)
  ? fs.readFileSync(intentPromptPath, 'utf-8')
  : '';

// Contexto por chat (Map<chatId, contextObj>)
const chatContexts = new Map();

function getContext(chatId) {
  if (!chatContexts.has(chatId)) {
    chatContexts.set(chatId, {
      pasta_ativa: null,
      pasta_ativa_id: null,
      subpasta_ativa: null,
      subpasta_ativa_id: null,
      cliente_ativo: null,
      historico: [],
    });
  }
  return chatContexts.get(chatId);
}

function addToHistory(ctx, role, text) {
  ctx.historico.push({ role, text });
  if (ctx.historico.length > 10) {
    ctx.historico = ctx.historico.slice(-10);
  }
}

/**
 * Interpreta a intenção do usuário usando IA.
 */
async function interpretIntent(userMessage, chatId) {
  const ctx = getContext(chatId);
  addToHistory(ctx, 'user', userMessage);

  const contextoIA = {
    pasta_ativa: ctx.pasta_ativa,
    subpasta_ativa: ctx.subpasta_ativa,
    cliente_ativo: ctx.cliente_ativo,
    ultimas_mensagens: ctx.historico.slice(-6),
  };

  const prompt = INTENT_PROMPT_TEMPLATE.replace(
    '{contexto}',
    JSON.stringify(contextoIA, null, 2)
  );
  const fullMessage = `Mensagem do usuário: "${userMessage}"`;

  let intent = null;

  // Tentativa 1: Gemini
  try {
    intent = await tryGeminiIntent(prompt, fullMessage);
    console.log(`[assistente] Gemini interpretou: ${intent.intencao}`);
  } catch (e) {
    console.warn(`[assistente] Gemini falhou: ${e.message}`);
  }

  // Tentativa 2: Claude
  if (!intent) {
    try {
      intent = await tryClaudeIntent(prompt, fullMessage);
      console.log(`[assistente] Claude interpretou: ${intent.intencao}`);
    } catch (e) {
      console.warn(`[assistente] Claude falhou: ${e.message}`);
    }
  }

  // Tentativa 3: Fallback local
  if (!intent) {
    intent = localFallback(userMessage, ctx);
    console.log(`[assistente] Fallback local: ${intent.intencao}`);
  }

  return intent;
}

async function tryGeminiIntent(systemPrompt, userMessage) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
    },
  });

  const rawText = typeof response.text === 'function' ? response.text() : response.text;
  return JSON.parse(rawText);
}

async function tryClaudeIntent(systemPrompt, userMessage) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: systemPrompt + '\nRetorne APENAS JSON válido, sem markdown.',
    messages: [{ role: 'user', content: userMessage }],
  });

  const rawText = response.content[0].text;
  const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

function localFallback(userMessage, ctx) {
  const msg = userMessage.toLowerCase().trim();

  // Criar pasta
  const pastaPatterns = [
    /(?:crie|criar|cria|abra|abrir|nova)\s+(?:uma\s+)?pasta\s+(?:chamada\s+|do\s+|da\s+|de\s+)?(.+)/i,
    /(?:crie|criar|cria)\s+(?:a\s+)?pasta\s+(.+)/i,
  ];
  for (const pattern of pastaPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const nome = match[1].trim().replace(/['"]/g, '');
      return {
        intencao: 'criar_pasta',
        campos: { nome_pasta: nome },
        resposta_sugerida: `Pasta '${nome}' criada com sucesso.`,
      };
    }
  }

  // Criar subpasta
  const subPatterns = [
    /(?:crie|criar|cria|abra|abrir|nova)\s+(?:uma\s+)?subpasta\s+(?:chamada\s+)?(.+?)(?:\s+dentro\s+d[ea]\s+(.+))?$/i,
    /dentro\s+d[ea]\s+(?:pasta\s+)?(.+?),?\s+(?:crie|criar|cria)\s+(?:uma\s+)?(?:subpasta|pasta)\s+(.+)/i,
  ];
  for (const pattern of subPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      let nome, pai;
      if (pattern === subPatterns[1]) {
        pai = match[1].trim().replace(/['"]/g, '');
        nome = match[2].trim().replace(/['"]/g, '');
      } else {
        nome = match[1].trim().replace(/['"]/g, '');
        pai = match[2] ? match[2].trim().replace(/['"]/g, '') : ctx.pasta_ativa;
      }
      return {
        intencao: 'criar_subpasta',
        campos: { nome_subpasta: nome, pasta_pai: pai },
        resposta_sugerida: null,
      };
    }
  }

  // Saudações
  const greetings = ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hello', 'hey', 'hi'];
  if (greetings.some(g => msg === g || msg.startsWith(g + ' ') || msg.startsWith(g + '!'))) {
    return {
      intencao: 'conversa_geral',
      campos: {},
      resposta_sugerida: null,
    };
  }

  return {
    intencao: 'conversa_geral',
    campos: {},
    resposta_sugerida: null,
  };
}

/**
 * Registra a resposta do assistente no histórico.
 */
function addAssistantResponse(chatId, text) {
  const ctx = getContext(chatId);
  addToHistory(ctx, 'assistant', text);
}

/**
 * Atualiza o contexto da pasta ativa.
 */
function setPastaAtiva(chatId, nome, id) {
  const ctx = getContext(chatId);
  ctx.pasta_ativa = nome;
  ctx.pasta_ativa_id = id;
  ctx.subpasta_ativa = null;
  ctx.subpasta_ativa_id = null;
}

/**
 * Atualiza o contexto da subpasta ativa.
 */
function setSubpastaAtiva(chatId, nome, id) {
  const ctx = getContext(chatId);
  ctx.subpasta_ativa = nome;
  ctx.subpasta_ativa_id = id;
}

/**
 * Atualiza o contexto do cliente ativo.
 */
function setClienteAtivo(chatId, nome) {
  const ctx = getContext(chatId);
  ctx.cliente_ativo = nome;
}

/**
 * Retorna o folder ID de destino ativo (subpasta > pasta > null).
 */
function getTargetFolderId(chatId) {
  const ctx = getContext(chatId);
  return ctx.subpasta_ativa_id || ctx.pasta_ativa_id || null;
}

/**
 * Retorna descrição do destino ativo para mensagens.
 */
function getDestinoLabel(chatId) {
  const ctx = getContext(chatId);
  if (!ctx.pasta_ativa) return null;
  if (ctx.subpasta_ativa) return `${ctx.pasta_ativa} > ${ctx.subpasta_ativa}`;
  return ctx.pasta_ativa;
}

module.exports = {
  interpretIntent,
  getContext,
  addAssistantResponse,
  setPastaAtiva,
  setSubpastaAtiva,
  setClienteAtivo,
  getTargetFolderId,
  getDestinoLabel,
};

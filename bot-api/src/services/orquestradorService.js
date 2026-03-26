/**
 * ORQUESTRADOR CENTRAL — Classifica entrada, decide executor, gerencia contexto.
 *
 * Substitui o assistenteService com arquitetura de roteamento inteligente.
 * Usa Gemini (primário) + Claude (fallback) + regex local (emergência).
 */
const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Prompt do orquestrador ──────────────────────────────────
const promptPath = path.join(__dirname, '../../../prompts/orquestrador.txt');
const ORCH_PROMPT_TEMPLATE = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : '';

// ── Contexto por chat ───────────────────────────────────────
const chatContexts = new Map();

function getContext(chatId) {
  if (!chatContexts.has(chatId)) {
    chatContexts.set(chatId, {
      pasta_ativa: null,
      pasta_ativa_id: null,
      subpasta_ativa: null,
      subpasta_ativa_id: null,
      cliente_ativo: null,
      ultimo_executor: null,
      ultimo_fluxo: null,
      documento_atual: null,
      historico: [],
    });
  }
  return chatContexts.get(chatId);
}

function addToHistory(ctx, role, text) {
  ctx.historico.push({ role, text, ts: Date.now() });
  if (ctx.historico.length > 12) {
    ctx.historico = ctx.historico.slice(-12);
  }
}

// ── Orquestrar entrada ──────────────────────────────────────
/**
 * Ponto de entrada principal. Recebe qualquer input e retorna decisão estruturada.
 *
 * @param {string} chatId
 * @param {object} input - { type: 'texto'|'audio'|'imagem'|'pdf'|'documento', text?, fileName?, mimeType? }
 * @returns {object} decisão do orquestrador
 */
async function orquestrar(chatId, input) {
  const ctx = getContext(chatId);
  const inputDesc = input.text || `[${input.type}: ${input.fileName || ''}]`;
  addToHistory(ctx, 'user', inputDesc);

  // Para áudio — rota direta sem IA de orquestração (Gemini transcreve)
  if (input.type === 'audio') {
    return {
      input_type: 'audio',
      user_intent: 'transcrever_audio',
      executor: 'GEMINI',
      confidence: 1.0,
      extracted_entities: {},
      next_action: 'transcribe_audio_then_reorchestrate',
      needs_clarification: false,
      clarification_question: null,
      context_updates: {},
      resposta_usuario: null,
    };
  }

  // Para imagem/PDF/documento sem texto — rota direta para classificação
  if (['imagem', 'pdf', 'documento'].includes(input.type) && !input.text) {
    const destino = getDestinoLabel(chatId);
    return {
      input_type: input.type,
      user_intent: 'classificar_documento',
      executor: 'GEMINI',
      confidence: 0.95,
      extracted_entities: {
        folder_name: ctx.pasta_ativa,
        subfolder_name: ctx.subpasta_ativa,
      },
      next_action: destino ? `classify_and_save_to_${destino}` : 'classify_and_identify_client',
      needs_clarification: false,
      clarification_question: null,
      context_updates: {},
      resposta_usuario: null,
    };
  }

  // Para texto — usar IA para classificar intenção
  const contextoIA = {
    pasta_ativa: ctx.pasta_ativa,
    subpasta_ativa: ctx.subpasta_ativa,
    cliente_ativo: ctx.cliente_ativo,
    ultimo_executor: ctx.ultimo_executor,
    ultimas_mensagens: ctx.historico.slice(-6),
  };

  const prompt = ORCH_PROMPT_TEMPLATE.replace(
    '{contexto}',
    JSON.stringify(contextoIA, null, 2)
  );
  const userMsg = `Entrada do usuário (tipo: ${input.type}): "${input.text}"`;

  let decision = null;

  // Tentativa 1: Gemini
  try {
    decision = await _tryGemini(prompt, userMsg);
    console.log(`[orq] Gemini: intent=${decision.user_intent} executor=${decision.executor} conf=${decision.confidence}`);
  } catch (e) {
    console.warn(`[orq] Gemini falhou: ${e.message}`);
  }

  // Tentativa 2: Claude
  if (!decision) {
    try {
      decision = await _tryClaude(prompt, userMsg);
      console.log(`[orq] Claude: intent=${decision.user_intent} executor=${decision.executor} conf=${decision.confidence}`);
    } catch (e) {
      console.warn(`[orq] Claude falhou: ${e.message}`);
    }
  }

  // Tentativa 3: Fallback local (regex)
  if (!decision) {
    decision = _localFallback(input.text || '', ctx);
    console.log(`[orq] Fallback: intent=${decision.user_intent} executor=${decision.executor}`);
  }

  // Aplicar atualizações de contexto
  if (decision.context_updates) {
    if (decision.context_updates.active_folder) {
      ctx.pasta_ativa = decision.context_updates.active_folder;
    }
    if (decision.context_updates.active_subfolder) {
      ctx.subpasta_ativa = decision.context_updates.active_subfolder;
    }
    if (decision.context_updates.active_client) {
      ctx.cliente_ativo = decision.context_updates.active_client;
    }
  }
  ctx.ultimo_executor = decision.executor;
  ctx.ultimo_fluxo = decision.user_intent;

  return decision;
}

// ── Gemini ─────────────────────────────────────────────────
async function _tryGemini(systemPrompt, userMessage) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
    },
  });

  const rawText = typeof response.text === 'function' ? response.text() : response.text;
  return _parseAndValidate(rawText);
}

// ── Claude ──────────────────────────────────────────────────
async function _tryClaude(systemPrompt, userMessage) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: systemPrompt + '\nRetorne APENAS JSON válido, sem markdown.',
    messages: [{ role: 'user', content: userMessage }],
  });

  const rawText = response.content[0].text;
  return _parseAndValidate(rawText);
}

// ── Parse e validação ───────────────────────────────────────
function _parseAndValidate(rawText) {
  const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : cleaned);

  // Garantir campos obrigatórios
  return {
    input_type: parsed.input_type || 'texto',
    user_intent: parsed.user_intent || 'responder_duvida',
    executor: parsed.executor || 'IA_JURIDICA',
    confidence: parsed.confidence || 0.5,
    extracted_entities: parsed.extracted_entities || {},
    next_action: parsed.next_action || null,
    needs_clarification: parsed.needs_clarification || false,
    clarification_question: parsed.clarification_question || null,
    context_updates: parsed.context_updates || {},
    resposta_usuario: parsed.resposta_usuario || null,
  };
}

// ── Fallback local (regex) ──────────────────────────────────
function _localFallback(text, ctx) {
  const msg = text.toLowerCase().trim();

  // ─ Criar pasta ─
  const pastaMatch = text.match(
    /(?:crie|criar|cria|abra|abrir|nova)\s+(?:uma\s+)?pasta\s+(?:chamada\s+|d[oae]\s+)?(.+)/i
  );
  if (pastaMatch) {
    const nome = pastaMatch[1].trim().replace(/['"]/g, '');
    return _buildDecision('comando', 'criar_pasta', 'DRIVE', 0.9, {
      folder_name: nome,
    }, { active_folder: nome }, `Pasta '${nome}' criada com sucesso.\n\nDeseja que eu crie alguma subpasta dentro dela?`);
  }

  // ─ Criar subpasta ─
  const subMatch = text.match(
    /(?:crie|criar|cria|abra|abrir|nova)\s+(?:uma\s+)?subpasta\s+(?:chamada\s+)?(.+?)(?:\s+dentro\s+d[ea]\s+(.+))?$/i
  );
  if (subMatch) {
    const nome = subMatch[1].trim().replace(/['"]/g, '');
    const pai = subMatch[2] ? subMatch[2].trim().replace(/['"]/g, '') : ctx.pasta_ativa;
    return _buildDecision('comando', 'criar_subpasta', 'DRIVE', 0.9, {
      subfolder_name: nome,
      parent_folder: pai,
    }, { active_subfolder: nome }, null);
  }

  // ─ Buscar cliente ─
  const clienteMatch = text.match(
    /(?:busca|buscar|procura|procurar|encontra|encontrar)\s+(?:o\s+)?cliente\s+(.+)/i
  );
  if (clienteMatch) {
    const nome = clienteMatch[1].trim().replace(/['"]/g, '');
    return _buildDecision('texto', 'buscar_cliente', 'DB', 0.85, {
      client_name: nome,
    }, { active_client: nome }, null);
  }

  // ─ Saudações ─
  const greetings = ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hello', 'hey', 'hi'];
  if (greetings.some(g => msg === g || msg.startsWith(g + ' ') || msg.startsWith(g + '!'))) {
    return _buildDecision('texto', 'saudacao', 'DIRETO', 0.95, {}, {}, null);
  }

  // ─ Fallback → IA jurídica para chat geral ─
  return _buildDecision('texto', 'responder_duvida', 'IA_JURIDICA', 0.5, {}, {}, null);
}

function _buildDecision(inputType, intent, executor, confidence, entities, ctxUpdates, resposta) {
  return {
    input_type: inputType,
    user_intent: intent,
    executor,
    confidence,
    extracted_entities: entities,
    next_action: intent,
    needs_clarification: false,
    clarification_question: null,
    context_updates: ctxUpdates,
    resposta_usuario: resposta,
  };
}

// ── Transcrição de áudio via Gemini ─────────────────────────
/**
 * Transcreve áudio usando Gemini e depois re-orquestra o texto resultante.
 */
async function transcribeAudio(chatId, base64Audio, mimeType) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcreva este áudio em português. Retorne APENAS o texto transcrito, sem explicações.' },
          { inlineData: { data: base64Audio, mimeType } },
        ],
      }],
    });

    const transcription = (typeof response.text === 'function' ? response.text() : response.text).trim();
    console.log(`[orq] Áudio transcrito: "${transcription.substring(0, 100)}..."`);

    if (!transcription || transcription.length < 2) {
      return { transcription: null, decision: null, error: 'Não consegui entender o áudio.' };
    }

    // Re-orquestrar com o texto transcrito
    const decision = await orquestrar(chatId, { type: 'texto', text: transcription });

    return { transcription, decision, error: null };
  } catch (e) {
    console.error(`[orq] Erro na transcrição: ${e.message}`);
    return { transcription: null, decision: null, error: 'Erro ao transcrever o áudio.' };
  }
}

// ── Funções de contexto (mantidas da versão anterior) ───────
function addAssistantResponse(chatId, text) {
  const ctx = getContext(chatId);
  addToHistory(ctx, 'assistant', text || 'OK');
}

function setPastaAtiva(chatId, nome, id) {
  const ctx = getContext(chatId);
  ctx.pasta_ativa = nome;
  ctx.pasta_ativa_id = id;
  ctx.subpasta_ativa = null;
  ctx.subpasta_ativa_id = null;
}

function setSubpastaAtiva(chatId, nome, id) {
  const ctx = getContext(chatId);
  ctx.subpasta_ativa = nome;
  ctx.subpasta_ativa_id = id;
}

function setClienteAtivo(chatId, nome) {
  const ctx = getContext(chatId);
  ctx.cliente_ativo = nome;
}

function getTargetFolderId(chatId) {
  const ctx = getContext(chatId);
  return ctx.subpasta_ativa_id || ctx.pasta_ativa_id || null;
}

function getDestinoLabel(chatId) {
  const ctx = getContext(chatId);
  if (!ctx.pasta_ativa) return null;
  if (ctx.subpasta_ativa) return `${ctx.pasta_ativa} > ${ctx.subpasta_ativa}`;
  return ctx.pasta_ativa;
}

module.exports = {
  orquestrar,
  transcribeAudio,
  getContext,
  addAssistantResponse,
  setPastaAtiva,
  setSubpastaAtiva,
  setClienteAtivo,
  getTargetFolderId,
  getDestinoLabel,
};

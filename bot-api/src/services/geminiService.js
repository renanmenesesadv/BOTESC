const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Carrega prompt do arquivo externo (editável sem mexer no código)
const promptPath = path.join(__dirname, '../../../prompts/classify_document.txt');
const PROMPT = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : 'Analise o documento e extraia dados em JSON.';

// ── Tentativa 1: Gemini ──────────────────────────────────
async function tryGemini(base64String, mimeType) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          { inlineData: { data: base64String, mimeType } }
        ]
      }
    ],
    config: {
      systemInstruction: "Retorne apenas um object JSON válido e sem formatação Markdown.",
      responseMimeType: "application/json"
    }
  });

  return JSON.parse(response.text());
}

// ── Tentativa 2: Claude (Fallback) ───────────────────────
async function tryClaude(base64String, mimeType) {
  const content = [];

  if (mimeType.includes('pdf')) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64String }
    });
  } else {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64String }
    });
  }

  content.push({ type: 'text', text: PROMPT });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: "Retorne apenas um object JSON válido e sem formatação Markdown.",
    messages: [{ role: 'user', content }]
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}

// ── Função principal com fallback ────────────────────────
async function processDocument(base64String, mimeType, fileName) {
  try {
    console.log('[+] Processando com Gemini...');
    const result = await tryGemini(base64String, mimeType);
    console.log('[+] Gemini respondeu com sucesso.');
    return result;
  } catch (geminiError) {
    console.warn('[!] Gemini falhou:', geminiError.message);
  }

  try {
    console.log('[+] Tentando fallback com Claude...');
    const result = await tryClaude(base64String, mimeType);
    console.log('[+] Claude respondeu com sucesso (fallback).');
    return result;
  } catch (claudeError) {
    console.error('[X] Claude também falhou:', claudeError.message);
  }

  return {
    tipo_documento: 'Desconhecido',
    data_documento: new Date().toISOString().split('T')[0],
    descricao: 'Não foi possível classificar este documento.',
    nome_sugerido: `Unclassified_${fileName}`,
    nome_cliente: null, cpf: null, rg: null,
    telefone: null, email: null, endereco: null
  };
}

module.exports = { processDocument };

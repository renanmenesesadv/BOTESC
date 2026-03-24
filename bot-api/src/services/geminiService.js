const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `Você é um assistente jurídico de triagem de documentos de um escritório.
Analise o documento enviado e extraia TODOS os dados possíveis.

Retorne um JSON estruturado com as chaves exatas:
- "tipo_documento": tipo do documento (ex: RG, CPF, CNH, Contrato, Nota Fiscal, Procuração, Comprovante de Residência, Certidão, etc)
- "data_documento": data encontrada no documento no formato YYYY-MM-DD (ou null se não encontrar)
- "descricao": breve resumo de 1 linha do conteúdo
- "nome_sugerido": nome descritivo para o arquivo (ex: "RG_Joao_Silva", "Contrato_Locacao_Maria")

Dados do CLIENTE (extraia tudo que encontrar no documento):
- "nome_cliente": nome completo da pessoa principal do documento (null se não encontrar)
- "cpf": CPF encontrado no formato 000.000.000-00 (null se não encontrar)
- "rg": RG / identidade encontrado (null se não encontrar)
- "telefone": telefone encontrado (null se não encontrar)
- "email": email encontrado (null se não encontrar)
- "endereco": endereço completo encontrado (null se não encontrar)

IMPORTANTE: Extraia o máximo de informações possível. Se o documento for um RG, extraia nome e RG. Se for CPF, extraia nome e CPF. Se for um contrato, extraia nome, CPF, endereço, etc.

Retorne APENAS o JSON válido.`;

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

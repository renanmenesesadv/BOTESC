const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Carrega prompt do arquivo externo
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
      systemInstruction: "Retorne APENAS um JSON plano com estas 10 chaves: tipo_documento, data_documento, descricao, nome_sugerido, nome_cliente, cpf, rg, telefone, email, endereco. Sem campos extras, sem objetos aninhados.",
      responseMimeType: "application/json"
    }
  });

  const rawText = typeof response.text === 'function' ? response.text() : response.text;
  console.log('[+] Gemini raw:', rawText.substring(0, 300));
  return normalizeResult(JSON.parse(cleanJsonResponse(rawText)));
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
    system: "Retorne APENAS um JSON plano com estas 10 chaves: tipo_documento, data_documento, descricao, nome_sugerido, nome_cliente, cpf, rg, telefone, email, endereco. Sem blocos de código, sem markdown.",
    messages: [{ role: 'user', content }]
  });

  const rawText = response.content[0].text;
  console.log('[+] Claude raw:', rawText.substring(0, 300));
  return normalizeResult(JSON.parse(cleanJsonResponse(rawText)));
}

// ── Limpa markdown da resposta ───────────────────────────
function cleanJsonResponse(text) {
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

// ── Normaliza resultado da IA ────────────────────────────
// Se a IA ignorou o formato e retornou JSON aninhado,
// tenta encontrar os campos dentro da estrutura
function normalizeResult(raw) {
  // Se já tem os campos esperados no nível raiz, retorna
  if (raw.tipo_documento && raw.nome_cliente) return raw;

  // Busca profunda por campos conhecidos
  const flat = flattenObject(raw);

  const result = {
    tipo_documento: findValue(flat, raw, ['tipo_documento', 'type', 'tipo', 'document_type']) || guessDocType(raw),
    data_documento: findValue(flat, raw, ['data_documento', 'date', 'report_date', 'issue_date', 'data']) || null,
    descricao: findValue(flat, raw, ['descricao', 'description', 'resumo', 'summary', 'main_diagnosis.description', 'clinical_history']) || guessDescription(raw),
    nome_sugerido: findValue(flat, raw, ['nome_sugerido', 'suggested_name']) || null,
    nome_cliente: findValue(flat, raw, ['nome_cliente', 'name', 'client_name', 'patient.name', 'customer_info.client_name', 'patient_name']) || findFirstName(raw),
    cpf: findValue(flat, raw, ['cpf', 'customer_info.cpf']) || null,
    rg: findValue(flat, raw, ['rg', 'identity']) || null,
    telefone: findValue(flat, raw, ['telefone', 'phone', 'tel']) || null,
    email: findValue(flat, raw, ['email', 'e-mail']) || null,
    endereco: findValue(flat, raw, ['endereco', 'address', 'endereco_completo']) || findAddress(raw),
  };

  // Gerar nome_sugerido se não veio
  if (!result.nome_sugerido && result.tipo_documento && result.nome_cliente) {
    const cleanName = result.nome_cliente.replace(/\s+/g, '_').substring(0, 30);
    const cleanType = result.tipo_documento.replace(/\s+/g, '_');
    result.nome_sugerido = `${cleanType}_${cleanName}`;
  }

  console.log('[+] Resultado normalizado:', JSON.stringify(result));
  return result;
}

// Achata objeto aninhado em chaves tipo "patient.name"
function flattenObject(obj, prefix = '') {
  const flat = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flattenObject(value, fullKey));
    } else {
      flat[fullKey] = value;
    }
  }
  return flat;
}

// Procura valor por lista de possíveis chaves
function findValue(flat, raw, keys) {
  for (const key of keys) {
    // Chave exata no flat
    if (flat[key] && typeof flat[key] === 'string' && flat[key].length > 1) return flat[key];
    // Chave parcial
    for (const [fk, fv] of Object.entries(flat)) {
      if (fk.endsWith('.' + key) && fv && typeof fv === 'string' && fv.length > 1) return fv;
    }
  }
  return null;
}

// Tenta adivinhar o tipo do documento pela estrutura
function guessDocType(raw) {
  const str = JSON.stringify(raw).toLowerCase();
  if (str.includes('laudo') || str.includes('medical_report')) return 'Laudo Médico';
  if (str.includes('receita') || str.includes('prescription')) return 'Receita Médica';
  if (str.includes('solicitação') || str.includes('solicitacao')) return 'Solicitação Médica';
  if (str.includes('conta') || str.includes('fatura') || str.includes('invoice') || str.includes('neoenergia') || str.includes('cosern')) return 'Conta de Energia';
  if (str.includes('contrato') || str.includes('contract')) return 'Contrato';
  if (str.includes('procura') || str.includes('power_of_attorney')) return 'Procuração';
  if (str.includes('certidão') || str.includes('certidao')) return 'Certidão';
  if (str.includes('nota fiscal') || str.includes('danfe')) return 'Nota Fiscal';
  return 'Documento';
}

// Tenta encontrar um nome de pessoa dentro do JSON
function findFirstName(raw) {
  const flat = flattenObject(raw);
  const nameKeys = ['name', 'patient_name', 'client_name', 'nome', 'titular'];
  for (const [key, value] of Object.entries(flat)) {
    for (const nk of nameKeys) {
      if (key.toLowerCase().includes(nk) && typeof value === 'string' && value.length > 3 && value.length < 100) {
        return value;
      }
    }
  }
  return null;
}

// Tenta encontrar endereço
function findAddress(raw) {
  const flat = flattenObject(raw);
  for (const [key, value] of Object.entries(flat)) {
    if ((key.toLowerCase().includes('address') || key.toLowerCase().includes('endereco') || key.toLowerCase().includes('street'))
        && typeof value === 'string' && value.length > 5) {
      return value;
    }
  }
  return null;
}

// Tenta gerar descrição
function guessDescription(raw) {
  const flat = flattenObject(raw);
  for (const [key, value] of Object.entries(flat)) {
    if ((key.includes('description') || key.includes('descricao') || key.includes('resumo') || key.includes('diagnosis') || key.includes('conclusion'))
        && typeof value === 'string' && value.length > 10 && value.length < 200) {
      return value;
    }
  }
  return 'Documento processado pela IA';
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

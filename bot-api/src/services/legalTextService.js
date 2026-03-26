/**
 * Geração de Texto Jurídico Estruturado — usa Claude para gerar petições,
 * contratos, notificações e outros documentos jurídicos.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const promptPath = path.join(__dirname, '../../../prompts/gerar_texto_juridico.txt');
const LEGAL_PROMPT_TEMPLATE = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, 'utf-8')
  : 'Você é um assistente jurídico. Gere o documento solicitado.';

/**
 * Gera texto jurídico estruturado.
 * @param {string} userRequest - O que o usuário pediu
 * @param {object} context - Contexto do cliente/caso (nome, cpf, etc.)
 * @returns {string} Texto jurídico formatado
 */
async function generateLegalText(userRequest, context = {}) {
  const contextStr = JSON.stringify(context, null, 2);
  const systemPrompt = LEGAL_PROMPT_TEMPLATE.replace('{contexto}', contextStr);

  // Tentativa 1: Claude (melhor para textos longos e raciocínio jurídico)
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userRequest }],
    });

    const text = response.content[0].text;
    console.log(`[legal] Claude gerou texto jurídico (${text.length} chars)`);
    return text;
  } catch (e) {
    console.warn(`[legal] Claude falhou: ${e.message}`);
  }

  // Tentativa 2: Gemini (fallback)
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: userRequest }] }],
      config: { systemInstruction: systemPrompt },
    });

    const text = typeof response.text === 'function' ? response.text() : response.text;
    console.log(`[legal] Gemini gerou texto jurídico (${text.length} chars)`);
    return text;
  } catch (e) {
    console.error(`[legal] Gemini também falhou: ${e.message}`);
  }

  return 'Desculpe, não consegui gerar o texto jurídico no momento. Tente novamente.';
}

module.exports = { generateLegalText };

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const intentPromptPath = path.join(__dirname, '../../../prompts/parse_audio_intent.txt');
const INTENT_PROMPT = fs.existsSync(intentPromptPath)
  ? fs.readFileSync(intentPromptPath, 'utf-8')
  : 'Identifique a intenção do usuário na transcrição.';

// Transcreve áudio usando OpenAI Whisper
async function transcribeAudio(fileUrl) {
  // Baixar o arquivo de áudio
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const tempFile = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
  fs.writeFileSync(tempFile, Buffer.from(response.data));

  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFile));
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const result = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 30000
    });

    return result.data.text;
  } finally {
    fs.unlinkSync(tempFile);
  }
}

// Analisa intenção da transcrição usando Claude
async function parseIntent(transcription) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: 'Retorne APENAS JSON válido, sem markdown.',
    messages: [{
      role: 'user',
      content: `${INTENT_PROMPT}\n\nTranscrição: "${transcription}"`
    }]
  });

  const text = response.content[0].text
    .replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : { intencao: 'outro', resumo: transcription };
}

module.exports = { transcribeAudio, parseIntent };

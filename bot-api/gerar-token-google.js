/**
 * Script para gerar o GOOGLE_REFRESH_TOKEN.
 * Rode UMA VEZ no Mac: node gerar-token-google.js
 * Ele abre o navegador para autorizar, e imprime o refresh_token para colar no .env
 */
require('dotenv').config({ path: '../.env' });
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES
});

console.log('\n=== AUTORIZAÇÃO GOOGLE ===\n');
console.log('1. Abra este link no navegador:\n');
console.log(authUrl);
console.log('\n2. Autorize o acesso e aguarde o redirecionamento...\n');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/oauth/callback') {
    const code = parsed.query.code;

    try {
      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>✅ Sucesso!</h1><p>Pode fechar esta aba e voltar ao terminal.</p>');

      console.log('✅ TOKEN GERADO COM SUCESSO!\n');
      console.log('Cole esta linha no seu arquivo .env:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('');

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500);
      res.end('Erro ao obter token');
      console.error('Erro:', err.message);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3000, () => {
  console.log('Servidor temporário ouvindo em http://localhost:3000 ...');
  // Tentar abrir o navegador automaticamente no Mac
  require('child_process').exec(`open "${authUrl}"`);
});

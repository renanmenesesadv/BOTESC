const { google } = require('googleapis');
const { Readable } = require('stream');

function getAuth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/oauth/callback'
  );
}

function getDrive() {
  const auth = getAuth();
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

// Pasta raiz onde ficam todas as pastas de clientes
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

// ── Buscar pasta do cliente pelo nome ────────────────────
async function findClientFolder(clientName) {
  const drive = getDrive();
  const query = `name = '${clientName.replace(/'/g, "\\'")}' and '${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive'
  });

  return res.data.files.length > 0 ? res.data.files[0] : null;
}

// ── Criar pasta do cliente ───────────────────────────────
async function createClientFolder(clientName) {
  const drive = getDrive();

  const res = await drive.files.create({
    requestBody: {
      name: clientName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [ROOT_FOLDER_ID]
    },
    fields: 'id, name, webViewLink'
  });

  console.log(`[+] Pasta criada no Drive: ${clientName} (${res.data.id})`);
  return res.data;
}

// ── Buscar ou criar pasta do cliente ─────────────────────
async function getOrCreateClientFolder(clientName) {
  const existing = await findClientFolder(clientName);
  if (existing) {
    console.log(`[+] Pasta existente encontrada: ${clientName}`);
    return existing;
  }
  return await createClientFolder(clientName);
}

// ── Contar arquivos na pasta (para numeração) ────────────
async function countFilesInFolder(folderId) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
    spaces: 'drive'
  });
  return res.data.files.length;
}

// ── Upload de arquivo para a pasta do cliente ────────────
async function uploadFile(folderId, fileName, base64Data, mimeType) {
  const drive = getDrive();

  const fileCount = await countFilesInFolder(folderId);
  const numero = fileCount + 1;
  const numberedName = `${String(numero).padStart(3, '0')}_${fileName}`;

  const buffer = Buffer.from(base64Data, 'base64');
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: numberedName,
      parents: [folderId]
    },
    media: {
      mimeType: mimeType,
      body: stream
    },
    fields: 'id, name, webViewLink'
  });

  console.log(`[+] Arquivo enviado ao Drive: ${numberedName}`);
  return { ...res.data, numero };
}

module.exports = {
  getOrCreateClientFolder,
  uploadFile,
  getAuth
};

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
async function getOrCreateClientFolder(clientName, existingId = null, parentId = null) {
  const drive = getDrive();
  const parent = parentId || ROOT_FOLDER_ID;

  // Se já tem ID, verificar se existe
  if (existingId) {
    try {
      const res = await drive.files.get({ fileId: existingId, fields: 'id, name, webViewLink' });
      return res.data;
    } catch (e) {} // pasta deletada, criar nova
  }

  // Buscar por nome dentro do parent
  const query = `name = '${clientName.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existing = await drive.files.list({ q: query, fields: 'files(id, name, webViewLink)' });
  if (existing.data.files.length > 0) {
    console.log(`[+] Pasta existente: ${clientName}`);
    return existing.data.files[0];
  }

  // Criar nova
  const res = await drive.files.create({
    requestBody: { name: clientName, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
    fields: 'id, name, webViewLink'
  });
  console.log(`[+] Pasta criada: ${clientName} em ${parent}`);
  return res.data;
}

// ── Buscar subpasta dentro da pasta do usuário ──────────
async function getSubfolderInUserFolder(userFolderId, subfolderName) {
  const drive = getDrive();
  const query = `name = '${subfolderName.replace(/'/g, "\\'")}' and '${userFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q: query, fields: 'files(id)' });
  if (res.data.files.length > 0) return res.data.files[0].id;

  // Criar se não existe
  const created = await drive.files.create({
    requestBody: { name: subfolderName, mimeType: 'application/vnd.google-apps.folder', parents: [userFolderId] },
    fields: 'id'
  });
  console.log(`[+] Subpasta criada: ${subfolderName} em ${userFolderId}`);
  return created.data.id;
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
  const numberedName = fileName;

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
  getSubfolderInUserFolder,
  getAuth
};

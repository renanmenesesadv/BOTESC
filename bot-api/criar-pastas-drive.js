require('dotenv').config({ path: '../.env' });
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

const USUARIOS = [
  'Renan Meneses',
  'Beatriz Ribeiro',
  'Joaquim Teixeira',
  'Esther Alana',
  'Agatha Randria',
  'Guilherme Vale',
];

const SUBPASTAS = [
  'Clientes',
  'Contratos',
  'Procurações',
  'Documentos Pessoais',
  'Processos',
  'Financeiro',
  'Laudos e Atestados',
  'Correspondências',
];

async function createFolder(name, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

async function main() {
  console.log(`\nCriando estrutura dentro de: ${ROOT_FOLDER_ID}\n`);

  for (const usuario of USUARIOS) {
    // Verificar se pasta do usuário já existe
    const existing = await drive.files.list({
      q: `name='${usuario}' and '${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    let userFolder;
    if (existing.data.files.length > 0) {
      userFolder = existing.data.files[0];
      console.log(`📂 ${usuario} — já existe (${userFolder.id})`);
    } else {
      userFolder = await createFolder(usuario, ROOT_FOLDER_ID);
      console.log(`✅ ${usuario} — criada (${userFolder.id})`);
    }

    // Criar subpastas
    for (const sub of SUBPASTAS) {
      const subExisting = await drive.files.list({
        q: `name='${sub}' and '${userFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
      });

      if (subExisting.data.files.length > 0) {
        console.log(`   📁 ${sub} — já existe`);
      } else {
        await createFolder(sub, userFolder.id);
        console.log(`   ✅ ${sub} — criada`);
      }
    }
    console.log('');
  }

  console.log('🎉 Estrutura completa!');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});

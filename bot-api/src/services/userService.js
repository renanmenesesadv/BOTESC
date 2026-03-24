const fs = require('fs');
const path = require('path');

const USERS_PATH = path.join(__dirname, '../../../config/users.json');

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Retorna o usuário pelo Telegram ID
function getUser(telegramId) {
  const data = loadUsers();
  return data.users[String(telegramId)] || null;
}

// Registra usuário: associa Telegram ID a uma pasta pendente
function registerUser(telegramId, nome, driveFolderId) {
  const data = loadUsers();
  data.users[String(telegramId)] = { nome, drive_folder_id: driveFolderId };
  // Remove do pending se existir
  for (const [pendingName, folderId] of Object.entries(data.pending_registration || {})) {
    if (folderId === driveFolderId) {
      delete data.pending_registration[pendingName];
      break;
    }
  }
  saveUsers(data);
  console.log(`[+] Usuário registrado: ${nome} (${telegramId}) → ${driveFolderId}`);
}

// Retorna lista de usuários pendentes (para botões de registro)
function getPendingUsers() {
  const data = loadUsers();
  return data.pending_registration || {};
}

// Retorna a subpasta correta pelo tipo de documento
function getSubfolder(tipoDocumento) {
  const data = loadUsers();
  const map = data.subfolder_map || {};
  return map[tipoDocumento] || data.default_subfolder || 'Correspondências';
}

module.exports = { getUser, registerUser, getPendingUsers, getSubfolder };

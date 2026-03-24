const { google } = require('googleapis');

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/oauth/callback'
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// ── Garantir que o cabeçalho existe ──────────────────────
async function ensureHeader(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clientes!A1:H1'
  }).catch(() => null);

  if (!res || !res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Clientes!A1:H1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Nome', 'CPF', 'RG', 'Telefone', 'Email', 'Endereco', 'Pasta Drive', 'Data Cadastro']]
      }
    });
  }
}

// ── Buscar cliente na planilha pelo CPF ──────────────────
async function findClientInSheet(sheets, cpf) {
  if (!cpf) return null;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clientes!A:H'
  }).catch(() => null);

  if (!res || !res.data.values) return null;

  const rows = res.data.values;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === cpf) {
      return { row: i + 1, data: rows[i] };
    }
  }
  return null;
}

// ── Adicionar ou atualizar cliente na planilha ───────────
async function upsertClient(clientData, driveFolderUrl) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureHeader(sheets);

  const existing = await findClientInSheet(sheets, clientData.cpf);
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (existing) {
    // Atualizar dados que antes estavam vazios
    const row = existing.data;
    const updated = [
      clientData.nome || row[0],
      clientData.cpf || row[1],
      clientData.rg || row[2] || '',
      clientData.telefone || row[3] || '',
      clientData.email || row[4] || '',
      clientData.endereco || row[5] || '',
      driveFolderUrl || row[6] || '',
      row[7] // mantém data original
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Clientes!A${existing.row}:H${existing.row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [updated] }
    });

    console.log(`[+] Cliente atualizado na planilha: ${clientData.nome}`);
    return 'atualizado';
  }

  // Novo cliente
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clientes!A:H',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        clientData.nome || '',
        clientData.cpf || '',
        clientData.rg || '',
        clientData.telefone || '',
        clientData.email || '',
        clientData.endereco || '',
        driveFolderUrl || '',
        now
      ]]
    }
  });

  console.log(`[+] Novo cliente adicionado na planilha: ${clientData.nome}`);
  return 'novo';
}

module.exports = { upsertClient };

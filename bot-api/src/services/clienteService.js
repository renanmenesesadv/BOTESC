// ── Buscar cliente existente por CPF ou nome ────────────
async function findCliente(pool, aiResult) {
  // Primeiro tenta por CPF (mais confiável)
  if (aiResult.cpf) {
    const cpfClean = aiResult.cpf.replace(/\D/g, '');
    const res = await pool.query(
      `SELECT * FROM clientes WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = $1 LIMIT 1`,
      [cpfClean]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  // Depois tenta por nome (busca parcial)
  if (aiResult.nome_cliente) {
    const res = await pool.query(
      `SELECT * FROM clientes WHERE LOWER(nome) = LOWER($1) LIMIT 1`,
      [aiResult.nome_cliente.trim()]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  return null;
}

// ── Criar novo cliente ───────────────────────────────────
async function createCliente(pool, aiResult, driveFolderId, driveFolderUrl) {
  const res = await pool.query(
    `INSERT INTO clientes (nome, cpf, rg, telefone, email, endereco, drive_folder_id, drive_folder_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      aiResult.nome_cliente,
      aiResult.cpf || null,
      aiResult.rg || null,
      aiResult.telefone || null,
      aiResult.email || null,
      aiResult.endereco || null,
      driveFolderId,
      driveFolderUrl
    ]
  );
  console.log(`[+] Novo cliente criado no banco: ${aiResult.nome_cliente}`);
  return res.rows[0];
}

// ── Atualizar dados do cliente (preenche campos vazios) ──
async function updateCliente(pool, clienteId, aiResult) {
  const fields = [];
  const values = [];
  let idx = 1;

  const updates = {
    cpf: aiResult.cpf,
    rg: aiResult.rg,
    telefone: aiResult.telefone,
    email: aiResult.email,
    endereco: aiResult.endereco
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      fields.push(`${key} = COALESCE(NULLIF(${key}, ''), $${idx})`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length > 0) {
    fields.push(`atualizado_em = NOW()`);
    values.push(clienteId);
    await pool.query(
      `UPDATE clientes SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );
    console.log(`[+] Dados do cliente atualizados: ID ${clienteId}`);
  }
}

// ── Próximo número de arquivo do cliente ─────────────────
async function getNextFileNumber(pool, clienteId) {
  const res = await pool.query(
    `SELECT COALESCE(MAX(numero_arquivo), 0) + 1 as proximo FROM documentos WHERE cliente_id = $1`,
    [clienteId]
  );
  return res.rows[0].proximo;
}

// ── Listar últimos clientes (para botões de seleção) ────
async function listClientes(pool, limit = 8) {
  const res = await pool.query(
    `SELECT id, nome, cpf FROM clientes ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  findCliente,
  createCliente,
  updateCliente,
  getNextFileNumber,
  listClientes
};

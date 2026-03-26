// Memória curta da conversa — contexto por conversation_id
let _pool = null;

function initContext(pool) {
  _pool = pool;
  // Criar tabelas se não existirem
  pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_context (
      conversation_id VARCHAR(50) PRIMARY KEY,
      active_root_folder VARCHAR(200),
      active_hospital VARCHAR(200),
      active_patient VARCHAR(200),
      active_owner VARCHAR(200),
      active_folder_id VARCHAR(100),
      destination_locked BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});

  pool.query(`
    CREATE TABLE IF NOT EXISTS pending_files (
      id SERIAL PRIMARY KEY,
      conversation_id VARCHAR(50) NOT NULL,
      batch_id VARCHAR(50) NOT NULL,
      file_name VARCHAR(200),
      mime_type VARCHAR(50),
      base64_data TEXT,
      received_at TIMESTAMP DEFAULT NOW(),
      status VARCHAR(20) DEFAULT 'pending'
    )
  `).catch(() => {});
}

// ── Contexto ────────────────────────────────────────────
async function getContext(convId) {
  const res = await _pool.query(
    `SELECT * FROM conversation_context WHERE conversation_id = $1`,
    [convId]
  );
  return res.rows[0] || null;
}

async function setContext(convId, updates) {
  const ctx = await getContext(convId);
  if (ctx) {
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(convId);
      await _pool.query(
        `UPDATE conversation_context SET ${fields.join(', ')} WHERE conversation_id = $${idx}`,
        values
      );
    }
  } else {
    await _pool.query(
      `INSERT INTO conversation_context (conversation_id, active_root_folder, active_hospital, active_patient, active_owner, active_folder_id, destination_locked)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        convId,
        updates.active_root_folder || null,
        updates.active_hospital || null,
        updates.active_patient || null,
        updates.active_owner || null,
        updates.active_folder_id || null,
        updates.destination_locked || false
      ]
    );
  }
}

async function clearContext(convId) {
  await _pool.query(`DELETE FROM conversation_context WHERE conversation_id = $1`, [convId]);
}

// ── Lote Pendente ───────────────────────────────────────
function generateBatchId() {
  const now = new Date();
  return `batch_${now.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14)}_${Math.random().toString(36).substring(2, 6)}`;
}

async function addPendingFile(convId, batchId, fileName, mimeType, base64Data) {
  await _pool.query(
    `INSERT INTO pending_files (conversation_id, batch_id, file_name, mime_type, base64_data) VALUES ($1, $2, $3, $4, $5)`,
    [convId, batchId, fileName, mimeType, base64Data]
  );
}

async function getPendingFiles(convId, batchId) {
  const res = await _pool.query(
    `SELECT * FROM pending_files WHERE conversation_id = $1 AND batch_id = $2 AND status = 'pending' ORDER BY received_at`,
    [convId, batchId]
  );
  return res.rows;
}

async function clearPendingFiles(convId, batchId) {
  await _pool.query(
    `DELETE FROM pending_files WHERE conversation_id = $1 AND batch_id = $2`,
    [convId, batchId]
  );
}

async function countPendingFiles(convId, batchId) {
  const res = await _pool.query(
    `SELECT COUNT(*) as count FROM pending_files WHERE conversation_id = $1 AND batch_id = $2 AND status = 'pending'`,
    [convId, batchId]
  );
  return parseInt(res.rows[0].count);
}

module.exports = {
  initContext,
  getContext,
  setContext,
  clearContext,
  generateBatchId,
  addPendingFile,
  getPendingFiles,
  clearPendingFiles,
  countPendingFiles
};

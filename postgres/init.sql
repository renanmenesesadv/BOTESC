-- ── Tabela de Clientes ────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id                SERIAL PRIMARY KEY,
  nome              VARCHAR(200) NOT NULL,
  cpf               VARCHAR(14) UNIQUE,
  rg                VARCHAR(20),
  telefone          VARCHAR(20),
  email             VARCHAR(100),
  endereco          TEXT,
  drive_folder_id   VARCHAR(100),
  drive_folder_url  TEXT,
  criado_em         TIMESTAMP DEFAULT NOW(),
  atualizado_em     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON clientes(cpf);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);

-- ── Tabela de Documentos ─────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos (
  id                   SERIAL PRIMARY KEY,
  cliente_id           INTEGER REFERENCES clientes(id),
  batch_id             VARCHAR(50),
  data_recebimento     TIMESTAMP DEFAULT NOW(),
  remetente_numero     VARCHAR(20),
  remetente_nome       VARCHAR(100),
  nome_arquivo_original TEXT,
  nome_arquivo_salvo   TEXT,
  tipo_documento       VARCHAR(50),
  descricao_gemini     TEXT,
  patient_name         VARCHAR(200),
  owner_name           VARCHAR(200),
  hospital_name        VARCHAR(200),
  link_drive           TEXT,
  pasta_drive          VARCHAR(100),
  numero_arquivo       INTEGER DEFAULT 1,
  status               VARCHAR(20) DEFAULT 'recebido'
);

CREATE INDEX IF NOT EXISTS idx_tipo ON documentos(tipo_documento);
CREATE INDEX IF NOT EXISTS idx_data ON documentos(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_remetente ON documentos(remetente_numero);
CREATE INDEX IF NOT EXISTS idx_cliente ON documentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_batch ON documentos(batch_id);

-- ── Tabela de Histórico de Chat ──────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
  id          SERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL,
  role        VARCHAR(10) NOT NULL,
  content     TEXT NOT NULL,
  criado_em   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_chat ON chat_history(chat_id);

-- ── Contexto de Conversa (memória curta) ─────────────────
CREATE TABLE IF NOT EXISTS conversation_context (
  conversation_id    VARCHAR(50) PRIMARY KEY,
  active_root_folder VARCHAR(200),
  active_hospital    VARCHAR(200),
  active_patient     VARCHAR(200),
  active_owner       VARCHAR(200),
  active_folder_id   VARCHAR(100),
  destination_locked BOOLEAN DEFAULT FALSE,
  updated_at         TIMESTAMP DEFAULT NOW()
);

-- ── Arquivos Pendentes do Lote ───────────────────────────
CREATE TABLE IF NOT EXISTS pending_files (
  id                SERIAL PRIMARY KEY,
  conversation_id   VARCHAR(50) NOT NULL,
  batch_id          VARCHAR(50) NOT NULL,
  file_id           VARCHAR(200),
  file_name         VARCHAR(200),
  mime_type         VARCHAR(50),
  base64_data       TEXT,
  received_at       TIMESTAMP DEFAULT NOW(),
  status            VARCHAR(20) DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_pending_conv ON pending_files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pending_batch ON pending_files(batch_id);

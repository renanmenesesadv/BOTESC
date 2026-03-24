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
  data_recebimento     TIMESTAMP DEFAULT NOW(),
  remetente_numero     VARCHAR(20),
  remetente_nome       VARCHAR(100),
  nome_arquivo_original TEXT,
  nome_arquivo_salvo   TEXT,
  tipo_documento       VARCHAR(50),
  descricao_gemini     TEXT,
  link_drive           TEXT,
  pasta_drive          VARCHAR(100),
  numero_arquivo       INTEGER DEFAULT 1,
  status               VARCHAR(20) DEFAULT 'recebido'
);

CREATE INDEX IF NOT EXISTS idx_tipo ON documentos(tipo_documento);
CREATE INDEX IF NOT EXISTS idx_data ON documentos(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_remetente ON documentos(remetente_numero);
CREATE INDEX IF NOT EXISTS idx_cliente ON documentos(cliente_id);

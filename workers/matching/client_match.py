"""
Lógica de identificação de cliente — novo vs. existente.
Busca por CPF (exato) e nome (similaridade).
"""
import os
import logging
import psycopg2

logger = logging.getLogger("workers.matching")


def _get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "postgres"),
        port=os.getenv("DB_PORT", 5432),
        database=os.getenv("POSTGRES_DB", "n8n_docs"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


async def find_client_by_name(nome: str) -> dict | None:
    """Busca cliente por nome (case-insensitive, parcial)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, nome, cpf, rg, telefone, email, endereco, drive_folder_id, drive_folder_url "
                "FROM clientes WHERE LOWER(nome) LIKE LOWER(%s) LIMIT 1",
                (f"%{nome}%",),
            )
            row = cur.fetchone()
            if row:
                return dict(zip(
                    ["id", "nome", "cpf", "rg", "telefone", "email", "endereco", "drive_folder_id", "drive_folder_url"],
                    row,
                ))
            return None
    finally:
        conn.close()


async def find_or_create_client(nome: str, ai_result: dict) -> tuple[dict, bool]:
    """Encontra cliente existente ou cria novo.

    Returns:
        (cliente_dict, is_new)
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # 1. Buscar por CPF (match exato)
            cpf = ai_result.get("cpf")
            if cpf:
                cur.execute("SELECT * FROM clientes WHERE cpf = %s LIMIT 1", (cpf,))
                row = cur.fetchone()
                if row:
                    cols = [desc[0] for desc in cur.description]
                    cliente = dict(zip(cols, row))
                    # Atualizar dados faltantes
                    _update_missing(cur, cliente["id"], ai_result)
                    conn.commit()
                    return cliente, False

            # 2. Buscar por nome (similaridade)
            cur.execute(
                "SELECT * FROM clientes WHERE LOWER(nome) = LOWER(%s) LIMIT 1", (nome,)
            )
            row = cur.fetchone()
            if row:
                cols = [desc[0] for desc in cur.description]
                cliente = dict(zip(cols, row))
                _update_missing(cur, cliente["id"], ai_result)
                conn.commit()
                return cliente, False

            # 3. Criar novo
            cur.execute(
                "INSERT INTO clientes (nome, cpf, rg, telefone, email, endereco) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                (nome, cpf, ai_result.get("rg"), ai_result.get("telefone"),
                 ai_result.get("email"), ai_result.get("endereco")),
            )
            row = cur.fetchone()
            cols = [desc[0] for desc in cur.description]
            conn.commit()
            logger.info(f"Novo cliente criado: {nome}")
            return dict(zip(cols, row)), True
    finally:
        conn.close()


def _update_missing(cur, client_id: int, ai_result: dict):
    """Preenche campos vazios do cliente com dados novos da IA."""
    fields = ["cpf", "rg", "telefone", "email", "endereco"]
    updates = []
    values = []
    for f in fields:
        val = ai_result.get(f)
        if val:
            updates.append(f"{f} = COALESCE(NULLIF({f}, ''), %s)")
            values.append(val)
    if updates:
        values.append(client_id)
        cur.execute(
            f"UPDATE clientes SET {', '.join(updates)}, atualizado_em = NOW() WHERE id = %s",
            values,
        )

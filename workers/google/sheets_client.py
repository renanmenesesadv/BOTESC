"""
Google Sheets — Registra e atualiza dados de clientes na planilha.
"""
import os
import logging
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger("workers.google.sheets")

COLUMNS = ["Nome", "CPF", "RG", "Telefone", "Email", "Endereço", "Pasta Drive", "Última Atualização"]


def _get_service():
    creds = Credentials(
        token=None,
        refresh_token=os.getenv("GOOGLE_REFRESH_TOKEN"),
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        token_uri="https://oauth2.googleapis.com/token",
    )
    return build("sheets", "v4", credentials=creds)


async def upsert_client(
    nome: str, cpf: str = None, rg: str = None,
    telefone: str = None, email: str = None,
    endereco: str = None, drive_url: str = None,
):
    """Insere ou atualiza cliente na planilha."""
    sheet_id = os.getenv("GOOGLE_SHEET_ID")
    service = _get_service()
    sheet = service.spreadsheets()
    range_name = "Clientes!A:H"

    # Buscar dados existentes
    result = sheet.values().get(spreadsheetId=sheet_id, range=range_name).execute()
    rows = result.get("values", [])

    # Criar cabeçalho se planilha vazia
    if not rows:
        sheet.values().update(
            spreadsheetId=sheet_id, range="Clientes!A1",
            valueInputOption="RAW", body={"values": [COLUMNS]},
        ).execute()
        rows = [COLUMNS]

    # Buscar cliente existente por CPF ou nome
    target_row = None
    for i, row in enumerate(rows[1:], start=2):  # pula cabeçalho
        row_nome = row[0] if len(row) > 0 else ""
        row_cpf = row[1] if len(row) > 1 else ""
        if (cpf and row_cpf == cpf) or (nome and row_nome.lower() == nome.lower()):
            target_row = i
            break

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    new_row = [nome or "", cpf or "", rg or "", telefone or "", email or "", endereco or "", drive_url or "", now]

    if target_row:
        # Atualizar existente (mescla dados — não sobrescreve com vazio)
        existing = rows[target_row - 1] if target_row - 1 < len(rows) else []
        merged = []
        for j, val in enumerate(new_row):
            old = existing[j] if j < len(existing) else ""
            merged.append(val if val else old)
        merged[-1] = now  # sempre atualiza timestamp

        sheet.values().update(
            spreadsheetId=sheet_id, range=f"Clientes!A{target_row}",
            valueInputOption="RAW", body={"values": [merged]},
        ).execute()
        logger.info(f"Cliente atualizado na linha {target_row}: {nome}")
    else:
        # Inserir novo
        sheet.values().append(
            spreadsheetId=sheet_id, range=range_name,
            valueInputOption="RAW", body={"values": [new_row]},
        ).execute()
        logger.info(f"Novo cliente inserido: {nome}")

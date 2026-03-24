"""
Handlers de cliente — /start e /cliente
"""
import os
import logging
from pathlib import Path
from telegram import Update
from telegram.ext import ContextTypes

from workers.google.drive_client import get_or_create_client_folder
from workers.google.sheets_client import upsert_client
from workers.matching.client_match import find_client_by_name

logger = logging.getLogger("bot.cliente")

# Carrega saudação do arquivo externo
_greeting_path = Path(__file__).resolve().parents[2] / "prompts" / "greeting_start.txt"
GREETING = _greeting_path.read_text(encoding="utf-8") if _greeting_path.exists() else (
    "👋 Olá! Envie uma foto ou PDF para classificar."
)


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Responde ao /start com a saudação personalizada."""
    await update.message.reply_text(GREETING, parse_mode="Markdown")


async def cliente_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Busca cliente pelo nome.

    Uso: /cliente João Silva
    """
    args = context.args
    if not args:
        await update.message.reply_text(
            "Use assim: `/cliente João Silva`", parse_mode="Markdown"
        )
        return

    nome = " ".join(args)
    await update.message.reply_text(f"🔍 Buscando cliente *{nome}*...", parse_mode="Markdown")

    cliente = await find_client_by_name(nome)

    if cliente:
        lines = [
            f"✅ *Cliente encontrado:*",
            f"👤 {cliente['nome']}",
            f"🪪 CPF: {cliente.get('cpf', '—')}",
            f"📱 Tel: {cliente.get('telefone', '—')}",
            f"📧 Email: {cliente.get('email', '—')}",
            f"📍 {cliente.get('endereco', '—')}",
        ]
        if cliente.get("drive_folder_url"):
            lines.append(f"📂 [Pasta no Drive]({cliente['drive_folder_url']})")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            f"❌ Nenhum cliente encontrado com o nome *{nome}*.\n\n"
            "Envie um documento desse cliente e eu crio o cadastro automaticamente.",
            parse_mode="Markdown",
        )

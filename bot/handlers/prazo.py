"""
Handler de prazos — /prazo
Placeholder para evolução futura: consulta de prazos no DJEN/PJe.
"""
import logging
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("bot.prazo")


async def prazo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Placeholder para consulta de prazos."""
    await update.message.reply_text(
        "⏰ *Módulo de Prazos*\n\n"
        "Em breve você poderá consultar prazos processuais por aqui.\n"
        "Uso futuro: `/prazo 0001234-56.2026.8.13.0001`",
        parse_mode="Markdown",
    )

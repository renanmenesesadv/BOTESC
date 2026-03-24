"""
Handler de agenda — /agendar
Placeholder para evolução futura: criar eventos no Google Calendar.
"""
import logging
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("bot.agenda")


async def agendar_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Placeholder para agendamento."""
    await update.message.reply_text(
        "📅 *Módulo de Agenda*\n\n"
        "Em breve você poderá criar eventos diretamente por aqui.\n"
        "Uso futuro: `/agendar 2026-04-01 14:00 Audiência João Silva`",
        parse_mode="Markdown",
    )

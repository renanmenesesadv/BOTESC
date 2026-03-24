"""
Ponto de entrada do Bot Telegram — Escritório Meneses e Teixeira
"""
import os
import logging
from dotenv import load_dotenv
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters

from bot.handlers.cliente import start_handler, cliente_handler
from bot.handlers.documento import documento_handler, photo_handler
from bot.handlers.agenda import agendar_handler

load_dotenv()
logging.basicConfig(
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("bot")


def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN não definido no .env")

    app = ApplicationBuilder().token(token).build()

    # ── Comandos ─────────────────────────────────────────
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("cliente", cliente_handler))
    app.add_handler(CommandHandler("agendar", agendar_handler))

    # ── Documentos (fotos e arquivos) ────────────────────
    app.add_handler(MessageHandler(filters.Document.ALL, documento_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))

    # ── Texto livre (fallback) ───────────────────────────
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, fallback_text))

    logger.info("Bot iniciado com polling...")
    app.run_polling(drop_pending_updates=True)


async def fallback_text(update, context):
    await update.message.reply_text(
        "📎 Envie um *documento* (foto ou PDF) para que eu possa processá-lo.\n\n"
        "Ou use um comando:\n"
        "/cliente — Buscar cliente\n"
        "/agendar — Criar evento na agenda",
        parse_mode="Markdown",
    )


if __name__ == "__main__":
    main()

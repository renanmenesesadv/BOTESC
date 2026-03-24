"""
Funções auxiliares do Telegram (download, helpers).
"""
import logging
from telegram import Bot

logger = logging.getLogger("bot.services")

# Correção de MIME types que o Telegram retorna errado
MIME_MAP = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


async def download_file_as_bytes(bot: Bot, file_id: str, file_name: str) -> tuple[bytes, str]:
    """Baixa arquivo do Telegram e retorna (bytes, mime_type)."""
    tg_file = await bot.get_file(file_id)
    file_bytes = await tg_file.download_as_bytearray()

    # Detectar MIME type pela extensão (Telegram às vezes retorna octet-stream)
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    mime_type = MIME_MAP.get(ext, "application/octet-stream")

    return bytes(file_bytes), mime_type

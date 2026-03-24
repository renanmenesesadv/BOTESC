"""
Middleware de autenticação — controla quem pode usar o bot.
"""
import json
import logging
from pathlib import Path
from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("bot.auth")

_rules_path = Path(__file__).resolve().parents[2] / "config" / "security_rules.json"


def _load_rules() -> dict:
    if _rules_path.exists():
        return json.loads(_rules_path.read_text())
    return {"require_auth": False, "allowed_users": [], "admin_users": []}


async def check_auth(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Verifica se o usuário está autorizado.

    Retorna True se autorizado, False se bloqueado.
    """
    rules = _load_rules()

    if not rules.get("require_auth"):
        return True  # Sem restrição

    user_id = str(update.effective_user.id)
    allowed = rules.get("allowed_users", []) + rules.get("admin_users", [])

    if user_id in [str(uid) for uid in allowed]:
        return True

    logger.warning(f"Acesso negado para user_id={user_id}")
    await update.message.reply_text("⛔ Acesso não autorizado. Contate o administrador.")
    return False

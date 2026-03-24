"""
Teclados inline reutilizáveis para o bot Telegram.
"""
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


def confirm_keyboard(action: str = "confirmar") -> InlineKeyboardMarkup:
    """Teclado Sim/Não genérico."""
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Sim", callback_data=f"{action}_sim"),
            InlineKeyboardButton("❌ Não", callback_data=f"{action}_nao"),
        ]
    ])


def client_type_keyboard() -> InlineKeyboardMarkup:
    """Quando a IA não identifica com certeza se é cliente novo/existente."""
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🆕 Cliente Novo", callback_data="cliente_novo")],
        [InlineKeyboardButton("🔄 Cliente Existente", callback_data="cliente_existente")],
        [InlineKeyboardButton("📋 Intimação de Audiência", callback_data="intimacao_audiencia")],
        [InlineKeyboardButton("📎 Outro / Complemento", callback_data="outro_complemento")],
    ])


def document_actions_keyboard(drive_url: str = None) -> InlineKeyboardMarkup:
    """Ações após processar documento."""
    buttons = [
        [InlineKeyboardButton("📋 Ver detalhes", callback_data="doc_detalhes")],
    ]
    if drive_url:
        buttons.append([InlineKeyboardButton("📂 Abrir no Drive", url=drive_url)])
    return InlineKeyboardMarkup(buttons)

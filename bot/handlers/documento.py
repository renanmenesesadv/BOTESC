"""
Handlers de documento — recebe fotos e PDFs, classifica com IA e organiza.
"""
import logging
from telegram import Update
from telegram.ext import ContextTypes

from workers.ai.claude_client import classify_document
from workers.google.drive_client import get_or_create_client_folder, upload_file
from workers.google.sheets_client import upsert_client
from workers.matching.client_match import find_or_create_client
from bot.services.telegram_service import download_file_as_bytes

logger = logging.getLogger("bot.documento")


async def documento_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Recebe um documento (PDF, DOC, etc.) e processa."""
    doc = update.message.document
    file_name = doc.file_name or "documento"
    await _process_file(update, context, doc.file_id, file_name)


async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Recebe uma foto e processa."""
    photo = update.message.photo[-1]  # melhor resolução
    file_name = f"foto_{update.message.date.strftime('%Y%m%d_%H%M%S')}.jpg"
    await _process_file(update, context, photo.file_id, file_name)


async def _process_file(
    update: Update, context: ContextTypes.DEFAULT_TYPE,
    file_id: str, file_name: str
):
    """Fluxo principal: download → IA → Drive → Sheets → resposta.

    Se existir contexto de pasta/subpasta ativa, salva diretamente ali.
    """
    sender_name = update.effective_user.first_name or "Desconhecido"

    # Contexto do assistente (pasta/subpasta ativa)
    assistente_ctx = context.chat_data.get("assistente", {})
    pasta_ativa = assistente_ctx.get("pasta_ativa")
    subpasta_ativa = assistente_ctx.get("subpasta_ativa")
    target_folder_id = (
        assistente_ctx.get("subpasta_ativa_id")
        or assistente_ctx.get("pasta_ativa_id")
    )

    # Mensagem de status contextual
    if pasta_ativa:
        destino = pasta_ativa
        if subpasta_ativa:
            destino = f"{pasta_ativa} > {subpasta_ativa}"
        status_msg = f"Recebido! Analisando e salvando em *{destino}*..."
    else:
        status_msg = "Recebido! A IA está analisando seu documento..."

    await update.message.reply_text(
        f"⏳ _{status_msg}_", parse_mode="Markdown",
    )

    try:
        # 1. Download do arquivo
        file_bytes, mime_type = await download_file_as_bytes(context.bot, file_id, file_name)
        logger.info(f"Arquivo baixado: {file_name} ({mime_type})")

        # 2. Classificação pela IA (Gemini → Claude fallback)
        ai_result = await classify_document(file_bytes, mime_type, file_name)
        logger.info(f"IA resultado: {ai_result}")

        # 3. Identificar ou criar cliente
        client_name = ai_result.get("nome_cliente") or sender_name
        cliente, is_new = await find_or_create_client(client_name, ai_result)
        status_emoji = "🆕 Cliente Novo" if is_new else "🔄 Cliente Existente"

        # 4. Pasta no Drive — usar contexto ativo ou criar pasta do cliente
        if target_folder_id:
            folder_id = target_folder_id
            folder_link = None
        else:
            folder = await get_or_create_client_folder(client_name, cliente.get("drive_folder_id"))
            folder_id = folder["id"]
            folder_link = folder.get("webViewLink")

        # 5. Upload do arquivo
        file_result = await upload_file(
            folder_id,
            ai_result.get("nome_sugerido", file_name),
            file_bytes,
            mime_type,
        )

        # 6. Atualizar planilha
        drive_url = folder_link or file_result.get("webViewLink")
        await upsert_client(
            nome=client_name,
            cpf=ai_result.get("cpf"),
            rg=ai_result.get("rg"),
            telefone=ai_result.get("telefone"),
            email=ai_result.get("email"),
            endereco=ai_result.get("endereco"),
            drive_url=drive_url,
        )

        # 7. Resposta ao usuário
        lines = [
            "✅ *Documento Processado!*", "",
            f"👤 *Cliente:* {client_name}",
            status_emoji,
            f"📁 *Tipo:* {ai_result.get('tipo_documento', '—')}",
            f"🗂 *Descrição:* {ai_result.get('descricao', '—')}",
            f"💾 *Arquivo:* {file_result.get('name', file_name)}",
        ]
        if pasta_ativa:
            destino = pasta_ativa
            if subpasta_ativa:
                destino = f"{pasta_ativa} > {subpasta_ativa}"
            lines.append(f"📂 *Salvo em:* {destino}")
        if ai_result.get("cpf"):
            lines.append(f"🪪 *CPF:* {ai_result['cpf']}")
        if file_result.get("webViewLink"):
            lines.append(f"🔗 [Ver no Drive]({file_result['webViewLink']})")

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    except Exception as e:
        logger.error(f"Erro ao processar documento: {e}", exc_info=True)
        await update.message.reply_text(
            "❌ Ocorreu um erro ao processar o documento. Tente novamente."
        )

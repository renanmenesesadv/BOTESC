"""
Handler do Assistente Jurídico Inteligente — interpreta texto livre do usuário.

Gerencia contexto de conversa por chat (pasta ativa, subpasta, cliente, etc.)
e executa ações operacionais (criar pasta, subpasta, salvar documento, etc.)
sem exigir etapas desnecessárias.
"""
import logging
from telegram import Update
from telegram.ext import ContextTypes

from workers.ai.assistente_ai import interpret_intent
from workers.google.drive_client import (
    create_named_folder,
    create_subfolder,
    get_or_create_client_folder,
)

logger = logging.getLogger("bot.assistente")


def _get_contexto(context: ContextTypes.DEFAULT_TYPE) -> dict:
    """Recupera o contexto operacional da conversa."""
    if "assistente" not in context.chat_data:
        context.chat_data["assistente"] = {
            "pasta_ativa": None,
            "pasta_ativa_id": None,
            "subpasta_ativa": None,
            "subpasta_ativa_id": None,
            "cliente_ativo": None,
            "historico": [],
        }
    return context.chat_data["assistente"]


def _add_historico(ctx: dict, role: str, text: str):
    """Adiciona mensagem ao histórico, mantendo as últimas 10."""
    ctx["historico"].append({"role": role, "text": text})
    if len(ctx["historico"]) > 10:
        ctx["historico"] = ctx["historico"][-10:]


async def assistente_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler principal para mensagens de texto livre."""
    user_message = update.message.text.strip()
    if not user_message:
        return

    ctx = _get_contexto(context)
    _add_historico(ctx, "user", user_message)

    # Contexto para a IA interpretar
    contexto_ia = {
        "pasta_ativa": ctx["pasta_ativa"],
        "subpasta_ativa": ctx["subpasta_ativa"],
        "cliente_ativo": ctx["cliente_ativo"],
        "ultimas_mensagens": ctx["historico"][-6:],
    }

    try:
        intent = await interpret_intent(user_message, contexto_ia)
    except Exception as e:
        logger.error(f"Erro ao interpretar intenção: {e}", exc_info=True)
        await update.message.reply_text(
            "Desculpe, não consegui processar sua mensagem. Tente novamente."
        )
        return

    intencao = intent.get("intencao", "conversa_geral")
    campos = intent.get("campos", {})
    resposta = intent.get("resposta_sugerida")

    logger.info(f"Intenção detectada: {intencao} | Campos: {campos}")

    if intencao == "criar_pasta":
        await _handle_criar_pasta(update, ctx, campos, resposta)
    elif intencao == "criar_subpasta":
        await _handle_criar_subpasta(update, ctx, campos, resposta)
    elif intencao == "buscar_cliente":
        await _handle_buscar_cliente(update, ctx, campos)
    elif intencao == "listar_pastas":
        await _handle_listar_pastas(update, ctx)
    elif intencao == "continuar_contexto":
        await _handle_continuar(update, ctx, campos, resposta)
    elif intencao == "conversa_geral":
        await _handle_conversa_geral(update, ctx, resposta, user_message)
    else:
        if resposta:
            await update.message.reply_text(resposta)
        else:
            await _handle_conversa_geral(update, ctx, None, user_message)

    _add_historico(ctx, "assistant", resposta or "OK")


async def _handle_criar_pasta(update: Update, ctx: dict, campos: dict, resposta: str):
    """Cria uma pasta no Google Drive."""
    nome_pasta = campos.get("nome_pasta", "").strip()
    if not nome_pasta:
        await update.message.reply_text("Qual nome deseja dar para a pasta?")
        return

    try:
        folder = await create_named_folder(nome_pasta)
        ctx["pasta_ativa"] = nome_pasta
        ctx["pasta_ativa_id"] = folder["id"]
        ctx["subpasta_ativa"] = None
        ctx["subpasta_ativa_id"] = None

        msg = f"Pasta *'{nome_pasta}'* criada com sucesso."
        if folder.get("webViewLink"):
            msg += f"\n[Abrir no Drive]({folder['webViewLink']})"
        msg += "\n\nDeseja que eu crie alguma subpasta dentro dela?"

        await update.message.reply_text(msg, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Erro ao criar pasta: {e}", exc_info=True)
        await update.message.reply_text(
            f"Não consegui criar a pasta '{nome_pasta}'. Verifique a conexão com o Drive."
        )


async def _handle_criar_subpasta(update: Update, ctx: dict, campos: dict, resposta: str):
    """Cria uma subpasta dentro de uma pasta existente."""
    nome_subpasta = campos.get("nome_subpasta", "").strip()
    pasta_pai = campos.get("pasta_pai") or ctx.get("pasta_ativa")
    pasta_pai_id = ctx.get("pasta_ativa_id")

    if not nome_subpasta:
        await update.message.reply_text("Qual nome deseja dar para a subpasta?")
        return

    if not pasta_pai:
        await update.message.reply_text(
            "Em qual pasta devo criar essa subpasta? "
            "Informe o nome da pasta principal ou crie uma antes."
        )
        return

    try:
        # Se não temos o ID da pasta pai ou o nome da pasta pai mudou, buscar/criar
        if not pasta_pai_id or pasta_pai != ctx.get("pasta_ativa"):
            parent = await create_named_folder(pasta_pai)
            pasta_pai_id = parent["id"]
            ctx["pasta_ativa"] = pasta_pai
            ctx["pasta_ativa_id"] = pasta_pai_id

        subfolder = await create_subfolder(pasta_pai_id, nome_subpasta)
        ctx["subpasta_ativa"] = nome_subpasta
        ctx["subpasta_ativa_id"] = subfolder["id"]

        msg = f"Subpasta *'{nome_subpasta}'* criada dentro de *'{pasta_pai}'*."
        if subfolder.get("webViewLink"):
            msg += f"\n[Abrir no Drive]({subfolder['webViewLink']})"
        msg += "\n\nAgora você pode me enviar documentos para salvar nela."

        await update.message.reply_text(msg, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Erro ao criar subpasta: {e}", exc_info=True)
        await update.message.reply_text(
            f"Não consegui criar a subpasta '{nome_subpasta}'. Verifique a conexão com o Drive."
        )


async def _handle_buscar_cliente(update: Update, ctx: dict, campos: dict):
    """Busca cliente no banco de dados."""
    from workers.matching.client_match import find_client_by_name

    nome = campos.get("nome_cliente", "").strip()
    if not nome:
        await update.message.reply_text("Qual o nome do cliente que deseja buscar?")
        return

    cliente = await find_client_by_name(nome)
    if cliente:
        ctx["cliente_ativo"] = cliente["nome"]
        lines = [
            f"*Cliente encontrado:*",
            f"Nome: {cliente['nome']}",
            f"CPF: {cliente.get('cpf') or '—'}",
            f"Telefone: {cliente.get('telefone') or '—'}",
            f"Email: {cliente.get('email') or '—'}",
            f"Endereço: {cliente.get('endereco') or '—'}",
        ]
        if cliente.get("drive_folder_url"):
            lines.append(f"[Pasta no Drive]({cliente['drive_folder_url']})")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            f"Nenhum cliente encontrado com o nome *{nome}*.\n"
            "Envie um documento desse cliente e eu crio o cadastro automaticamente.",
            parse_mode="Markdown",
        )


async def _handle_listar_pastas(update: Update, ctx: dict):
    """Informa as pastas no contexto atual."""
    lines = ["*Contexto atual:*"]
    if ctx.get("pasta_ativa"):
        lines.append(f"Pasta ativa: *{ctx['pasta_ativa']}*")
    else:
        lines.append("Nenhuma pasta ativa no momento.")
    if ctx.get("subpasta_ativa"):
        lines.append(f"Subpasta ativa: *{ctx['subpasta_ativa']}*")
    if ctx.get("cliente_ativo"):
        lines.append(f"Cliente ativo: *{ctx['cliente_ativo']}*")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _handle_continuar(update: Update, ctx: dict, campos: dict, resposta: str):
    """Trata continuações contextuais."""
    acao = campos.get("acao_inferida", "")
    if resposta:
        await update.message.reply_text(resposta, parse_mode="Markdown")
    else:
        await update.message.reply_text(
            "Entendi. O que gostaria de fazer agora?"
        )


async def _handle_conversa_geral(update: Update, ctx: dict, resposta: str, user_message: str):
    """Responde conversas gerais e saudações."""
    if resposta:
        await update.message.reply_text(resposta, parse_mode="Markdown")
        return

    # Resposta padrão contextual
    lines = ["Olá! Sou o assistente do escritório *Meneses e Teixeira*.", ""]
    lines.append("Posso ajudá-lo com:")
    lines.append("- Criar e organizar pastas no Drive")
    lines.append("- Classificar e salvar documentos")
    lines.append("- Buscar clientes cadastrados")
    lines.append("")
    if ctx.get("pasta_ativa"):
        lines.append(f"Pasta ativa no momento: *{ctx['pasta_ativa']}*")
        if ctx.get("subpasta_ativa"):
            lines.append(f"Subpasta ativa: *{ctx['subpasta_ativa']}*")
        lines.append("")
    lines.append("O que deseja fazer?")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

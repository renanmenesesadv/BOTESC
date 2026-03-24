"""
Cliente de IA — Gemini (primário) + Claude (fallback).
Classifica documentos jurídicos extraindo dados do cliente.
"""
import os
import json
import base64
import logging
from pathlib import Path

logger = logging.getLogger("workers.ai")

# Carrega prompt externo
_prompt_path = Path(__file__).resolve().parents[2] / "prompts" / "classify_document.txt"
PROMPT = _prompt_path.read_text(encoding="utf-8") if _prompt_path.exists() else (
    "Analise o documento e extraia dados em JSON."
)

FALLBACK_RESULT = {
    "tipo_documento": "Desconhecido",
    "data_documento": None,
    "descricao": "Não foi possível classificar este documento.",
    "nome_sugerido": None,
    "nome_cliente": None,
    "cpf": None,
    "rg": None,
    "telefone": None,
    "email": None,
    "endereco": None,
}


async def classify_document(file_bytes: bytes, mime_type: str, file_name: str) -> dict:
    """Tenta Gemini primeiro, fallback para Claude."""
    b64 = base64.b64encode(file_bytes).decode()

    # Tentativa 1: Gemini
    try:
        result = await _try_gemini(b64, mime_type)
        logger.info("Gemini respondeu com sucesso.")
        return result
    except Exception as e:
        logger.warning(f"Gemini falhou: {e}")

    # Tentativa 2: Claude
    try:
        result = await _try_claude(b64, mime_type)
        logger.info("Claude respondeu com sucesso (fallback).")
        return result
    except Exception as e:
        logger.error(f"Claude também falhou: {e}")

    # Ambos falharam
    return {**FALLBACK_RESULT, "nome_sugerido": f"Unclassified_{file_name}"}


async def _try_gemini(b64: str, mime_type: str) -> dict:
    from google.genai import GoogleGenAI

    ai = GoogleGenAI(api_key=os.getenv("GEMINI_API_KEY"))
    response = await ai.models.generate_content_async(
        model="gemini-2.5-flash",
        contents=[{
            "role": "user",
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"data": b64, "mime_type": mime_type}},
            ],
        }],
        config={
            "system_instruction": "Retorne apenas um object JSON válido e sem formatação Markdown.",
            "response_mime_type": "application/json",
        },
    )
    return json.loads(response.text)


async def _try_claude(b64: str, mime_type: str) -> dict:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    content = []
    if "pdf" in mime_type:
        content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        })
    else:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        })
    content.append({"type": "text", "text": PROMPT})

    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="Retorne apenas um object JSON válido e sem formatação Markdown.",
        messages=[{"role": "user", "content": content}],
    )
    return json.loads(response.content[0].text)

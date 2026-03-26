"""
IA do Assistente — interpreta intenção do usuário usando Gemini/Claude.
"""
import os
import json
import logging
from pathlib import Path

logger = logging.getLogger("workers.ai.assistente")

_prompt_path = Path(__file__).resolve().parents[2] / "prompts" / "assistente_intent.txt"
INTENT_PROMPT_TEMPLATE = _prompt_path.read_text(encoding="utf-8") if _prompt_path.exists() else ""

FALLBACK_INTENT = {
    "intencao": "conversa_geral",
    "campos": {},
    "resposta_sugerida": None,
}


async def interpret_intent(user_message: str, contexto: dict) -> dict:
    """Interpreta a intenção do usuário usando IA."""
    contexto_str = json.dumps(contexto, ensure_ascii=False, indent=2)
    prompt = INTENT_PROMPT_TEMPLATE.replace("{contexto}", contexto_str)
    full_message = f"Mensagem do usuário: \"{user_message}\""

    # Tentativa 1: Gemini
    try:
        result = await _try_gemini(prompt, full_message)
        logger.info(f"Gemini interpretou intenção: {result.get('intencao')}")
        return result
    except Exception as e:
        logger.warning(f"Gemini falhou na interpretação: {e}")

    # Tentativa 2: Claude
    try:
        result = await _try_claude(prompt, full_message)
        logger.info(f"Claude interpretou intenção: {result.get('intencao')}")
        return result
    except Exception as e:
        logger.error(f"Claude também falhou na interpretação: {e}")

    # Fallback: tentativa de interpretação local simples
    return _local_fallback(user_message, contexto)


async def _try_gemini(system_prompt: str, user_message: str) -> dict:
    from google.genai import GoogleGenAI

    ai = GoogleGenAI(api_key=os.getenv("GEMINI_API_KEY"))
    response = await ai.models.generate_content_async(
        model="gemini-2.5-flash",
        contents=[{"role": "user", "parts": [{"text": user_message}]}],
        config={
            "system_instruction": system_prompt,
            "response_mime_type": "application/json",
        },
    )
    return json.loads(response.text)


async def _try_claude(system_prompt: str, user_message: str) -> dict:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        system=system_prompt + "\nRetorne APENAS JSON válido, sem markdown.",
        messages=[{"role": "user", "content": user_message}],
    )
    return json.loads(response.content[0].text)


def _local_fallback(user_message: str, contexto: dict) -> dict:
    """Interpretação local básica quando a IA não está disponível."""
    msg = user_message.lower().strip()

    # Detectar criação de pasta
    pasta_keywords = ["crie uma pasta", "criar pasta", "criar a pasta", "abra uma pasta",
                      "crie pasta", "nova pasta", "abrir pasta"]
    for kw in pasta_keywords:
        if kw in msg:
            nome = msg.split(kw)[-1].strip().strip('"\'').strip()
            if nome:
                return {
                    "intencao": "criar_pasta",
                    "campos": {"nome_pasta": nome.title()},
                    "resposta_sugerida": f"Pasta '{nome.title()}' criada com sucesso.",
                }

    # Detectar criação de subpasta
    sub_keywords = ["crie uma subpasta", "criar subpasta", "criar a subpasta",
                    "abra uma subpasta", "crie subpasta", "nova subpasta"]
    for kw in sub_keywords:
        if kw in msg:
            nome = msg.split(kw)[-1].strip().strip('"\'').strip()
            pasta_pai = contexto.get("pasta_ativa")
            # Tentar extrair "dentro de X"
            if "dentro de" in nome:
                parts = nome.split("dentro de")
                nome = parts[0].strip()
                pasta_pai = parts[1].strip()
            if nome:
                return {
                    "intencao": "criar_subpasta",
                    "campos": {
                        "nome_subpasta": nome.title(),
                        "pasta_pai": pasta_pai,
                    },
                    "resposta_sugerida": f"Subpasta '{nome.title()}' criada.",
                }

    # Saudações
    greetings = ["olá", "oi", "bom dia", "boa tarde", "boa noite", "hello", "hey"]
    if msg in greetings or any(msg.startswith(g) for g in greetings):
        return {
            "intencao": "conversa_geral",
            "campos": {},
            "resposta_sugerida": None,
        }

    return {**FALLBACK_INTENT}

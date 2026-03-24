"""
Parsers de resposta da IA — limpa e normaliza JSON.
"""
import json
import re
import logging

logger = logging.getLogger("workers.ai.parsers")


def parse_ai_json(text: str) -> dict:
    """Tenta extrair JSON da resposta da IA, mesmo com formatação markdown."""
    # Remove blocos de código markdown
    text = re.sub(r"```json?\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Tenta encontrar JSON dentro do texto
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

    logger.warning(f"Não foi possível parsear JSON: {text[:200]}")
    return {}

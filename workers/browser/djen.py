"""
Automação DJEN — Consulta de prazos e publicações.
Placeholder para evolução futura com Playwright.
"""
import logging

logger = logging.getLogger("workers.browser.djen")


async def consultar_publicacoes(numero_processo: str) -> list[dict]:
    """Placeholder: consulta publicações no DJEN via Playwright."""
    logger.info(f"[TODO] Consultar DJEN para processo: {numero_processo}")
    raise NotImplementedError("Módulo DJEN ainda não implementado.")

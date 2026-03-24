"""
Utilitários para automação de navegador com Playwright.
"""
import logging

logger = logging.getLogger("workers.browser.utils")


async def get_browser():
    """Inicializa e retorna instância do Playwright browser."""
    try:
        from playwright.async_api import async_playwright

        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True)
        return browser, pw
    except ImportError:
        logger.error("Playwright não instalado. Execute: pip install playwright && playwright install")
        raise

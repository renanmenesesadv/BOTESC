"""
Google Calendar — Placeholder para criação de eventos.
Será implementado quando o módulo /agendar for ativado.
"""
import logging

logger = logging.getLogger("workers.google.calendar")


async def create_event(title: str, date: str, time: str, description: str = ""):
    """Placeholder: cria evento no Google Calendar."""
    logger.info(f"[TODO] Criar evento: {title} em {date} {time}")
    raise NotImplementedError("Módulo de agenda ainda não implementado.")

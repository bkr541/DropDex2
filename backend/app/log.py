"""
Structured logging configuration for the DropDex backend.

Configures structlog to route through stdlib logging so all existing
handlers (including the rotating rekordbox file handler in main.py) capture
structured output. Output is newline-delimited JSON in production; a
human-readable key=value format when DROPDEX_LOG_FORMAT=console.

Usage:
    from .log import get_logger
    logger = get_logger(__name__)

    # Bind once per job / request — context travels with every subsequent call.
    job_log = logger.bind(import_id=import_id, user_id=user_id)
    job_log.info("import.start", track_count=500)
    job_log.error("import.failed", error=str(exc))
"""
from __future__ import annotations

import logging
import os

import structlog


def _configure() -> None:
    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.ExceptionRenderer(),
    ]

    use_console = os.getenv("DROPDEX_LOG_FORMAT", "json").lower() == "console"
    renderer = structlog.dev.ConsoleRenderer() if use_console else structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


_configure()


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog BoundLogger backed by the stdlib logger at *name*."""
    return structlog.get_logger(name)

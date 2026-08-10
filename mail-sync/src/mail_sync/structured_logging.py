# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.5, docs/DAT.md §14 — JSONL
# sans données sensibles ; ce commentaire de portée couvre le formateur et la configuration.

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Final


SERVICE_NAME: Final = "mail-sync"
SAFE_FIELDS: Final = (
    "correlation_id",
    "method",
    "path",
    "status_code",
    "boot_id",
    "boot_count",
    # Construit par `config._describe` : noms de variables et règles, jamais de valeur.
    "reason",
)


class JsonFormatter(logging.Formatter):
    """Transforme chaque record en un objet JSON autonome et borné."""

    def format(self, record: logging.LogRecord) -> str:
        event = getattr(record, "event", None)
        if not isinstance(event, str) or not event:
            event = record.getMessage() or "runtime_log"

        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "service": SERVICE_NAME,
            "event": event,
        }
        for field in SAFE_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str) -> logging.Logger:
    """Pose une unique sortie JSON commune à l'application et à Uvicorn."""

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)
    root.addHandler(handler)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True

    return logging.getLogger(SERVICE_NAME)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    **fields: object,
) -> None:
    """Journalise seulement les champs explicitement admis par le formateur."""

    logger.log(level, event, extra={"event": event, **fields})


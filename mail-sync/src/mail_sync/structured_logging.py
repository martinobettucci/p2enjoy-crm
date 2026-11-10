# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.5, docs/DAT.md §14 — JSONL
# sans données sensibles ; ce commentaire de portée couvre le formateur et la configuration.
# @spec CRM-135 (docs/BACKLOG.md) — `SAFE_FIELDS` admet le compte, le motif et les compteurs de la veille
#       (docs/SPEC-mail-subsystem.md §24.2, docs/DAT.md §14 ; INC-349, décisions 873 et 874)

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
    # `CRM-074` T2 (docs/SPEC-pieces-jointes.md §4.3) : une pièce se nomme par son identifiant et son statut d'extraction,
    # jamais par son nom de fichier ni son texte.
    "attachment_id",
    "text_status",
    # `CRM-135` (docs/SPEC-mail-subsystem.md §24.2) : la veille, et les lignes qui passaient déjà ces champs sans qu'ils
    # sortent (INC-349). Chacun est sûr PAR CONSTRUCTION — un UUID interne, un code d'un vocabulaire fermé, un NOM de
    # classe d'exception, un entier. Jamais le texte d'une exception : un serveur IMAP peut y recopier l'identifiant de
    # connexion.
    "account_id",
    "error",
    "panne",
    "postgrest_status",
    "releves",
    "echecs",
    "ignores",
    "espaces",
    "intervalle_secondes",
    "refus_consecutifs",
    "retry_in_seconds",
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


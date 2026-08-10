# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.5 — JSONL UTC et liste
# blanche des métadonnées ; la portée couvre tous les cas de ce fichier.

from __future__ import annotations

import json
import logging

from mail_sync.structured_logging import JsonFormatter


def test_formateur_json_emet_les_champs_surs_et_ignore_les_autres() -> None:
    record = logging.LogRecord(
        name="mail-sync",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="message ignored when event exists",
        args=(),
        exc_info=None,
    )
    record.created = 0
    record.event = "request_completed"
    record.correlation_id = "correlation-1"
    record.method = "GET"
    record.path = "/health/live"
    record.status_code = 200
    record.authorization = "Bearer secret"
    record.body = "private body"

    payload = json.loads(JsonFormatter().format(record))

    assert payload == {
        "timestamp": "1970-01-01T00:00:00.000Z",
        "level": "INFO",
        "service": "mail-sync",
        "event": "request_completed",
        "correlation_id": "correlation-1",
        "method": "GET",
        "path": "/health/live",
        "status_code": 200,
    }


def test_formateur_convertit_un_log_runtime_en_evenement_json() -> None:
    record = logging.LogRecord(
        name="uvicorn.error",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Application startup complete.",
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonFormatter().format(record))

    assert payload["event"] == "Application startup complete."
    assert payload["level"] == "INFO"

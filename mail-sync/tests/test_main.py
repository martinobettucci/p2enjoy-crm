# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.2 et §12.5 — le point
# d'entrée refuse une configuration invalide avant d'écouter, et son journal ne fuit pas.

from __future__ import annotations

import io
import json
import logging
from pathlib import Path

import pytest

from mail_sync.__main__ import EXIT_CONFIGURATION, main


BAD_TOKEN = "jeton-gabarit-trop-court"


@pytest.fixture(autouse=True)
def _journal_capture(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    """Rend la sortie standard des journaux observable sans toucher au formateur réel."""

    stream = io.StringIO()
    original = logging.StreamHandler.__init__

    def capturing_init(self, stream_argument=None):  # type: ignore[no-untyped-def]
        original(self, stream)

    monkeypatch.setattr(logging.StreamHandler, "__init__", capturing_init)
    yield stream
    logging.getLogger().handlers.clear()


def test_une_configuration_refusee_arrete_le_processus_sans_ecouter(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    _journal_capture: io.StringIO,
) -> None:
    monkeypatch.setenv("P2ENJOY_ENV_PROFILE", "dev")
    monkeypatch.setenv("MAIL_SYNC_INTERNAL_TOKEN", BAD_TOKEN)
    monkeypatch.setenv("MAIL_SYNC_STATE_PATH", str(tmp_path / "runtime.json"))
    # CRM-052 : les deux variables du service sont fournies VALIDES, pour que le refus mesuré
    # reste celui du jeton — sans elles, le message porterait trois causes et ce cas ne prouverait
    # plus rien de précis.
    monkeypatch.setenv("SUPABASE_URL", "http://kong-de-preuve:8000")
    monkeypatch.setenv("SERVICE_ROLE_KEY", "cle-de-service-de-preuve-0123456789")

    def refuse_to_listen(*args: object, **kwargs: object) -> None:
        raise AssertionError("uvicorn.run ne doit pas être atteint")

    monkeypatch.setattr("mail_sync.__main__.uvicorn.run", refuse_to_listen)

    assert main() == EXIT_CONFIGURATION

    lines = [json.loads(line) for line in _journal_capture.getvalue().splitlines()]
    assert [line["event"] for line in lines] == ["configuration_rejected"]
    assert lines[0]["level"] == "CRITICAL"
    assert lines[0]["service"] == "mail-sync"
    assert lines[0]["reason"] == "MAIL_SYNC_INTERNAL_TOKEN: must contain at least 32 characters"
    assert BAD_TOKEN not in _journal_capture.getvalue()
    # Aucun état n'est créé : le processus n'a jamais dépassé sa configuration.
    assert not (tmp_path / "runtime.json").exists()

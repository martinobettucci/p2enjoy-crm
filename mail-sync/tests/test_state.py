# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.4 — reprise réelle,
# atomicité et refus des états invalides ; la portée couvre tous les cas de ce fichier.

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest

from mail_sync.state import StateError, StateStore


def test_etat_survit_a_un_nouveau_demarrage(tmp_path: Path) -> None:
    path = tmp_path / "state" / "runtime.json"
    first_store = StateStore(path)
    first = first_store.start()
    checkpoint = uuid4()
    written = first_store.set_dev_checkpoint(checkpoint)

    second = StateStore(path).start()

    assert first.boot_count == 1
    assert written.dev_checkpoint == checkpoint
    assert second.boot_count == 2
    assert second.boot_id != first.boot_id
    assert second.dev_checkpoint == checkpoint
    assert path.stat().st_mode & 0o777 == 0o600
    assert set(json.loads(path.read_text(encoding="utf-8"))) == {
        "schema_version",
        "boot_count",
        "boot_id",
        "dev_checkpoint",
    }


@pytest.mark.parametrize(
    "content",
    [
        "not-json",
        '{"schema_version":2,"boot_count":1,"boot_id":"00000000-0000-0000-0000-000000000001","dev_checkpoint":null}',
        '{"schema_version":1,"boot_count":0,"boot_id":"00000000-0000-0000-0000-000000000001","dev_checkpoint":null}',
        '{"schema_version":1,"boot_count":1,"boot_id":"bad","dev_checkpoint":null}',
        '{"schema_version":1,"boot_count":1,"boot_id":"00000000-0000-0000-0000-000000000001","dev_checkpoint":null,"secret":"interdit"}',
    ],
)
def test_etat_invalide_bloque_sans_etre_ecrase(tmp_path: Path, content: str) -> None:
    path = tmp_path / "runtime.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(StateError, match="runtime state is invalid"):
        StateStore(path).start()

    assert path.read_text(encoding="utf-8") == content


def test_echec_du_remplacement_conserve_le_dernier_etat_valide(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "runtime.json"
    store = StateStore(path)
    initial = store.start()
    before = path.read_bytes()

    def fail_replace(_source: str, _target: Path) -> None:
        raise OSError("simulated disk failure")

    monkeypatch.setattr(os, "replace", fail_replace)

    with pytest.raises(StateError, match="could not be persisted"):
        store.set_dev_checkpoint(uuid4())

    assert store.read() == initial
    assert path.read_bytes() == before
    assert list(tmp_path.glob(".runtime-*.tmp")) == []


def test_lecture_avant_initialisation_est_refusee(tmp_path: Path) -> None:
    with pytest.raises(StateError, match="not initialized"):
        StateStore(tmp_path / "runtime.json").read()


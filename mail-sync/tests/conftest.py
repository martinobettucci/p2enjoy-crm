# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.2 et §12.6 — fixtures
# déterministes de configuration ; la portée couvre tous les auxiliaires de test de ce fichier.

from __future__ import annotations

from pathlib import Path

import pytest

from mail_sync.config import Settings


TEST_TOKEN = "test-token-0123456789abcdef-0123456789abcdef"
# CRM-052 : la clé de service est obligatoire depuis que le service consomme une table mail. Elle
# n'est pas un JWT ici — le service ne la juge pas, il la transmet (§13.5).
TEST_SERVICE_KEY = "cle-de-service-de-preuve-0123456789"
TEST_SUPABASE_URL = "http://kong-de-preuve:8000"


@pytest.fixture
def settings_factory(tmp_path: Path):  # type: ignore[no-untyped-def]
    def make_settings(profile: str = "dev", **overrides: object) -> Settings:
        values: dict[str, object] = {
            "P2ENJOY_ENV_PROFILE": profile,
            "MAIL_SYNC_INTERNAL_TOKEN": TEST_TOKEN,
            "MAIL_SYNC_LOG_LEVEL": "INFO",
            "MAIL_SYNC_HOST": "127.0.0.1",
            "MAIL_SYNC_PORT": 8080,
            "MAIL_SYNC_STATE_PATH": tmp_path / f"runtime-{profile}.json",
            "SUPABASE_URL": TEST_SUPABASE_URL,
            "SERVICE_ROLE_KEY": TEST_SERVICE_KEY,
        }
        values.update(overrides)
        return Settings(**values)  # type: ignore[arg-type]

    return make_settings


# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.2 — configuration
# nominale, limites et erreurs sans fuite ; la portée couvre tous les cas de ce fichier.

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from mail_sync.config import ConfigurationError, Settings, load_settings


VALID_TOKEN = "0123456789abcdef0123456789abcdef"
# CRM-052 : deux variables de plus sont OBLIGATOIRES depuis que le service consomme une table
# mail. Les omettre ici ferait échouer chaque cas sur « Field required » au lieu de la règle
# qu'il vise (docs/SPEC-mail-subsystem.md §13.5).
VALID_SERVICE_KEY = "cle-de-service-de-preuve-0123456789"
VALID_SUPABASE_URL = "http://kong-de-preuve:8000"


def valid_values(tmp_path: Path) -> dict[str, object]:
    return {
        "P2ENJOY_ENV_PROFILE": "dev",
        "MAIL_SYNC_INTERNAL_TOKEN": VALID_TOKEN,
        "MAIL_SYNC_STATE_PATH": tmp_path / "runtime.json",
        "SUPABASE_URL": VALID_SUPABASE_URL,
        "SERVICE_ROLE_KEY": VALID_SERVICE_KEY,
    }


def test_configuration_nominale_et_defauts(tmp_path: Path) -> None:
    settings = Settings(**valid_values(tmp_path))  # type: ignore[arg-type]

    assert settings.P2ENJOY_ENV_PROFILE == "dev"
    assert settings.MAIL_SYNC_INTERNAL_TOKEN.get_secret_value() == VALID_TOKEN
    assert "**********" in repr(settings)
    assert VALID_TOKEN not in repr(settings)
    assert settings.MAIL_SYNC_LOG_LEVEL == "INFO"
    assert settings.MAIL_SYNC_HOST == "0.0.0.0"
    assert settings.MAIL_SYNC_PORT == 8080
    # CRM-052 : la clé de service est un secret, et son `repr` ne doit pas plus la publier que
    # celui du jeton interne.
    assert settings.SERVICE_ROLE_KEY.get_secret_value() == VALID_SERVICE_KEY
    assert VALID_SERVICE_KEY not in repr(settings)
    assert settings.MAIL_SYNC_IMAP_TIMEOUT_SECONDS == 10.0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("P2ENJOY_ENV_PROFILE", "staging"),
        ("MAIL_SYNC_LOG_LEVEL", "WARN"),
        ("MAIL_SYNC_HOST", "mail-sync"),
        ("MAIL_SYNC_PORT", 0),
        ("MAIL_SYNC_PORT", 65_536),
        ("MAIL_SYNC_STATE_PATH", Path("relative.json")),
        ("MAIL_SYNC_STATE_PATH", Path("/tmp/runtime.txt")),
        # CRM-052 — les deux variables du service, et leurs bornes.
        ("SUPABASE_URL", "kong:8000"),
        ("SUPABASE_URL", "ftp://kong:8000"),
        ("SERVICE_ROLE_KEY", "trop-court"),
        ("MAIL_SYNC_IMAP_TIMEOUT_SECONDS", 0),
        ("MAIL_SYNC_IMAP_TIMEOUT_SECONDS", 121),
    ],
)
def test_configuration_refuse_les_valeurs_hors_contrat(
    tmp_path: Path,
    field: str,
    value: object,
) -> None:
    values = valid_values(tmp_path)
    values[field] = value

    with pytest.raises(ValidationError):
        Settings(**values)  # type: ignore[arg-type]


def test_jeton_trop_court_est_refuse_et_masque(tmp_path: Path) -> None:
    """§12.2 : le refus nomme la variable et la règle, jamais la valeur fautive.

    `ValidationError` reproduit l'entrée dans son texte ; `load_settings` est donc le seul
    chemin de démarrage, et sa trace ne doit pas non plus rechaîner l'erreur d'origine.
    """

    values = valid_values(tmp_path)
    values["MAIL_SYNC_INTERNAL_TOKEN"] = "secret-beaucoup-trop-court"

    with pytest.raises(ConfigurationError) as captured:
        load_settings(**values)

    rendered = str(captured.value)
    assert "MAIL_SYNC_INTERNAL_TOKEN: must contain at least 32 characters" == rendered
    assert "secret-beaucoup-trop-court" not in rendered
    assert captured.value.__cause__ is None
    assert captured.value.__context__ is None


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("P2ENJOY_ENV_PROFILE", "staging", "P2ENJOY_ENV_PROFILE: Input should be 'dev' or 'prod'"),
        ("MAIL_SYNC_HOST", "mail-sync", "MAIL_SYNC_HOST: must be a valid IP address"),
        ("MAIL_SYNC_STATE_PATH", Path("/tmp/runtime.txt"), "MAIL_SYNC_STATE_PATH: must point to a JSON file"),
        # CRM-052 : la clé de service est un SECRET, et son refus ne doit pas plus la publier que
        # celui du jeton interne — c'est le cas où une fuite serait la plus coûteuse.
        ("SERVICE_ROLE_KEY", "cle-trop-courte", "SERVICE_ROLE_KEY: must contain at least 16 characters"),
        ("SUPABASE_URL", "kong-interne:8000", "SUPABASE_URL: must start with http:// or https://"),
    ],
)
def test_le_refus_de_configuration_ne_cite_jamais_la_valeur(
    tmp_path: Path,
    field: str,
    value: object,
    expected: str,
) -> None:
    values = valid_values(tmp_path)
    values[field] = value

    with pytest.raises(ConfigurationError) as captured:
        load_settings(**values)

    rendered = str(captured.value)
    assert rendered == expected
    assert str(value) not in rendered


# @verifies CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.3 à §12.6 — parcours API
# nominal, autorisations, environnement et bornes ; la portée couvre tous les cas de ce fichier.

from __future__ import annotations

import json
import logging
from io import StringIO
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_TOKEN
from mail_sync.app import create_app
from mail_sync.state import StateError, StateStore
from mail_sync.structured_logging import JsonFormatter


AUTHORIZATION = {"Authorization": f"Bearer {TEST_TOKEN}"}
SECURITY_HEADERS = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
}


def test_sante_statut_et_headers(settings_factory) -> None:  # type: ignore[no-untyped-def]
    app = create_app(settings_factory())

    with TestClient(app) as client:
        live = client.get("/health/live", headers={"X-Request-ID": "probe-health_1"})
        ready = client.get("/health/ready")
        status_response = client.get("/internal/v1/status", headers=AUTHORIZATION)

    assert live.status_code == 200
    assert live.json() == {"status": "alive"}
    assert live.headers["x-request-id"] == "probe-health_1"
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["service"] == "mail-sync"
    assert body["version"] == "0.1.0"
    assert body["profile"] == "dev"
    assert body["schema_version"] == 1
    assert body["boot_count"] == 1
    UUID(body["boot_id"])
    assert body["workers"] == {
        "imap": {"state": "waiting_for_configuration"},
        "smtp": {"state": "waiting_for_configuration"},
    }
    for response in (live, ready, status_response):
        for header, value in SECURITY_HEADERS.items():
            assert response.headers[header] == value
    # Seul l'appelant qui fournit un identifiant borné le retrouve ; les autres en reçoivent un.
    for response in (ready, status_response):
        UUID(response.headers["x-request-id"])


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Basic Zm9vOmJhcg=="},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer wrong-token-0123456789abcdef0123456789"},
        {"Authorization": f"Bearer {TEST_TOKEN} suffix"},
    ],
)
def test_statut_refuse_toutes_les_authentifications_invalides_de_la_meme_facon(
    settings_factory,  # type: ignore[no-untyped-def]
    headers: dict[str, str],
) -> None:
    app = create_app(settings_factory())

    with TestClient(app) as client:
        response = client.get("/internal/v1/status", headers=headers)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise"}
    assert response.headers["www-authenticate"] == "Bearer"


def test_checkpoint_developpement_est_ecrit_et_relu(settings_factory) -> None:  # type: ignore[no-untyped-def]
    app = create_app(settings_factory())
    checkpoint = uuid4()

    with TestClient(app) as client:
        initial = client.get("/internal/v1/dev/checkpoint", headers=AUTHORIZATION)
        written = client.put(
            "/internal/v1/dev/checkpoint",
            headers=AUTHORIZATION,
            json={"checkpoint": str(checkpoint)},
        )
        read_back = client.get("/internal/v1/dev/checkpoint", headers=AUTHORIZATION)

    assert initial.json() == {"checkpoint": None}
    assert written.status_code == 200
    assert written.json() == {"checkpoint": str(checkpoint)}
    assert read_back.json() == written.json()


@pytest.mark.parametrize(
    "payload",
    [
        {"checkpoint": "not-a-uuid"},
        {"checkpoint": str(uuid4()), "unexpected": True},
        {},
    ],
)
def test_checkpoint_refuse_les_corps_hors_contrat(
    settings_factory,  # type: ignore[no-untyped-def]
    payload: dict[str, object],
) -> None:
    app = create_app(settings_factory())

    with TestClient(app) as client:
        response = client.put(
            "/internal/v1/dev/checkpoint",
            headers=AUTHORIZATION,
            json=payload,
        )

    assert response.status_code == 422


def test_checkpoint_refuse_un_corps_depassant_la_borne(settings_factory) -> None:  # type: ignore[no-untyped-def]
    app = create_app(settings_factory())

    with TestClient(app) as client:
        response = client.put(
            "/internal/v1/dev/checkpoint",
            headers={**AUTHORIZATION, "Content-Type": "application/json"},
            content=json.dumps({"checkpoint": str(uuid4()), "padding": "x" * 1_024}),
        )

    assert response.status_code == 413
    assert response.json() == {"detail": "Corps trop volumineux"}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("headers", [{}, AUTHORIZATION])
def test_checkpoint_est_absent_en_production(
    settings_factory,  # type: ignore[no-untyped-def]
    headers: dict[str, str],
) -> None:
    app = create_app(settings_factory(profile="prod"))

    with TestClient(app) as client:
        get_response = client.get("/internal/v1/dev/checkpoint", headers=headers)
        put_response = client.put(
            "/internal/v1/dev/checkpoint",
            headers=headers,
            json={"checkpoint": str(uuid4())},
        )

    assert get_response.status_code == 404
    assert put_response.status_code == 404
    assert get_response.json() == put_response.json() == {"detail": "Not Found"}


def test_le_client_de_test_entre_et_sort_sur_l_application_reelle(settings_factory) -> None:  # type: ignore[no-untyped-def]
    """Contre-preuve de la décision 313 : aucun blocage, aucun lifespan applicatif.

    L'application réelle est construite, puis le contexte du `TestClient` est ouvert et refermé.
    Un blocage amont se manifesterait ici, avant les comportements exercés par les autres cas.
    """

    app = create_app(settings_factory())

    with TestClient(app) as client:
        entered = client.get("/health/live")

    assert entered.status_code == 200
    assert app.router.lifespan_context is not None


def test_readiness_est_vraie_des_la_construction(settings_factory) -> None:  # type: ignore[no-untyped-def]
    """§12.3 : l'état est ouvert avant l'écoute, donc `ready` ne peut pas être négatif."""

    client = TestClient(create_app(settings_factory()))
    response = client.get("/health/ready")
    client.close()

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_etat_corrompu_empeche_le_demarrage(settings_factory, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "corrupt.json"
    path.write_text("{truncated", encoding="utf-8")
    settings = settings_factory(MAIL_SYNC_STATE_PATH=path)

    # L'ouverture est synchrone : l'application n'est jamais construite sur un état illisible.
    with pytest.raises(StateError, match="runtime state is invalid"):
        create_app(settings, store=StateStore(path))

    assert path.read_text(encoding="utf-8") == "{truncated"


def test_journaux_api_sont_json_et_ne_fuient_ni_jeton_ni_corps(settings_factory) -> None:  # type: ignore[no-untyped-def]
    output = StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(JsonFormatter())
    logger = logging.Logger("mail-sync-test", level=logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False
    app = create_app(settings_factory(), logger=logger)
    checkpoint = uuid4()

    with TestClient(app) as client:
        response = client.put(
            "/internal/v1/dev/checkpoint",
            headers={**AUTHORIZATION, "X-Request-ID": "mail-sync-proof"},
            json={"checkpoint": str(checkpoint)},
        )

    assert response.status_code == 200
    lines = [json.loads(line) for line in output.getvalue().splitlines()]
    assert [line["event"] for line in lines] == [
        "service_started",
        "request_completed",
    ]
    assert all(line["service"] == "mail-sync" for line in lines)
    assert all(line["level"] == "INFO" for line in lines)
    assert lines[1]["correlation_id"] == "mail-sync-proof"
    serialized = output.getvalue()
    assert TEST_TOKEN not in serialized
    assert str(checkpoint) not in serialized
    assert "authorization" not in serialized.lower()



# =================================================================================================
# CRM-052 — la route de test de connexion d'un compte entrant
# =================================================================================================
#
# @verifies CRM-052 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §13.5 et §13.7
#
# LA SESSION IMAP EST LA SEULE CHOSE SUBSTITUÉE, ET C'EST DÉLIBÉRÉ : un serveur IMAP ne se simule
# pas honnêtement en mémoire, et le succès contre le vrai Stalwart est prouvé par
# `e2e/mail/mail-inbound.spec.ts`. Ce que ces cas éprouvent est ce que la ROUTE fait du verdict :
# quel statut elle écrit, quel code elle rend, et ce qu'elle refuse.

from mail_sync import app as module_app  # noqa: E402
from mail_sync.imap_probe import ProbeResult  # noqa: E402
from mail_sync.postgrest import InboundCredentials, PostgrestError  # noqa: E402


COMPTE = "5eed0000-0000-4000-8000-0000000000a1"


class FauxPostgrest:
    """Journalise ce que la route lui demande, sans jamais parler à PostgreSQL."""

    def __init__(self, identifiants: InboundCredentials | None, erreur: PostgrestError | None = None):
        self.identifiants = identifiants
        self.erreur = erreur
        self.ecritures: list[tuple[str, str, str | None]] = []

    def read_credentials(self, account_id: str) -> InboundCredentials | None:
        if self.erreur is not None:
            raise self.erreur
        return self.identifiants

    def record_check(self, account_id: str, status: str, error: str | None) -> str:
        self.ecritures.append((account_id, status, error))
        return "2026-08-10T18:00:00+00:00"


def _identifiants(password: str | None = "motdepasse") -> InboundCredentials:
    return InboundCredentials(
        account_id=COMPTE,
        workspace_id="5eed0000-0000-4000-8000-000000000001",
        host="stalwart",
        port=143,
        security="none",
        username="systeme@crm.p2enjoy.test",
        password=password,
    )


def _brancher(monkeypatch, faux: FauxPostgrest, verdict: ProbeResult) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(module_app, "PostgrestClient", lambda *_a, **_k: faux)
    monkeypatch.setattr(module_app, "probe_inbound_account", lambda **_k: verdict)


def test_un_test_de_connexion_reussi_ecrit_ok_et_rend_le_compte_de_dossiers(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    faux = FauxPostgrest(_identifiants())
    _brancher(monkeypatch, faux, ProbeResult(ok=True, folders=4))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        reponse = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["status"] == "ok"
    assert corps["error"] is None
    # Une session qui s'ouvre puis ne sait rien lister n'est pas une session utilisable : le
    # nombre de dossiers est ce qui distingue les deux.
    assert corps["folders"] == 4
    assert faux.ecritures == [(COMPTE, "ok", None)]


def test_un_echec_ecrit_le_CODE_et_jamais_la_phrase_du_serveur(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    faux = FauxPostgrest(_identifiants())
    _brancher(monkeypatch, faux, ProbeResult(ok=False, error="auth_failed"))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        reponse = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    assert reponse.status_code == 200
    assert reponse.json()["status"] == "error"
    assert reponse.json()["error"] == "auth_failed"
    assert faux.ecritures == [(COMPTE, "error", "auth_failed")]


def test_la_route_exige_le_jeton_interne(settings_factory, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    faux = FauxPostgrest(_identifiants())
    _brancher(monkeypatch, faux, ProbeResult(ok=True, folders=1))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        sans = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test")
        faux_jeton = client.post(
            f"/internal/v1/inbound-accounts/{COMPTE}/test",
            headers={"Authorization": "Bearer faux"},
        )

    assert sans.status_code == 401
    assert faux_jeton.status_code == 401
    # AUCUNE écriture : un appel refusé ne doit pas laisser de trace dans l'état d'un compte.
    assert faux.ecritures == []


def test_un_compte_inconnu_rend_404_sans_rien_ecrire(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    faux = FauxPostgrest(None)
    _brancher(monkeypatch, faux, ProbeResult(ok=True, folders=1))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        reponse = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    assert reponse.status_code == 404
    assert faux.ecritures == []


def test_un_compte_sans_secret_rend_409_plutot_qu_un_faux_auth_failed(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    """Le taire ferait rendre `auth_failed` pour une cause qui n'est pas celle-là, et l'exploitant
    ressaisirait un mot de passe correct."""

    faux = FauxPostgrest(_identifiants(password=None))
    _brancher(monkeypatch, faux, ProbeResult(ok=True, folders=1))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        reponse = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    assert reponse.status_code == 409
    assert faux.ecritures == []


def test_une_base_indisponible_rend_502_et_ne_publie_aucun_corps(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    faux = FauxPostgrest(None, erreur=PostgrestError(503))
    _brancher(monkeypatch, faux, ProbeResult(ok=True, folders=1))
    app = create_app(settings_factory())

    with TestClient(app) as client:
        reponse = client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    assert reponse.status_code == 502
    assert "503" not in reponse.text


def test_le_journal_du_test_ne_porte_ni_identifiant_de_connexion_ni_hote(
    settings_factory, monkeypatch  # type: ignore[no-untyped-def]
) -> None:
    """§8 : le service journalise l'identifiant du compte et le code, jamais le nom d'utilisateur,
    jamais l'hôte, jamais le texte du serveur."""

    flux = StringIO()
    handler = logging.StreamHandler(flux)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("mail-sync-preuve-052")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    faux = FauxPostgrest(_identifiants())
    _brancher(monkeypatch, faux, ProbeResult(ok=False, error="tls_failed"))
    app = create_app(settings_factory(), logger=logger)

    with TestClient(app) as client:
        client.post(f"/internal/v1/inbound-accounts/{COMPTE}/test", headers=AUTHORIZATION)

    journal = flux.getvalue()
    evenements = [json.loads(ligne)["event"] for ligne in journal.splitlines()]
    assert "inbound_account_checked" in evenements
    assert "systeme@crm.p2enjoy.test" not in journal
    assert "stalwart" not in journal
    assert "motdepasse" not in journal

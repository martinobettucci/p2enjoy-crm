# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires de l'assemblage et des sondes
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §11 (`/pret` : découverte OIDC et `rest` à travers Kong, contrôle en défaut
#           nommé), §2 (consignes au modèle : point de départ `crm_workspace_list`, refus uniforme, pagination)
# @verifies CRM-102 T6 — docs/SPEC-mcp.md §2.2 (`/plateforme` et `/admin` en `302` vers la plateforme de la webapp, sans
#           chaîne de requête ; aucun autre chemin). L'enregistrement dans le service réel est prouvé par l'intégration.
from __future__ import annotations

import httpx2
import pytest

from crm_mcp import application
from starlette.applications import Starlette
from starlette.routing import Route

from crm_mcp.application import CHEMINS_ADMINISTRATION, INSTRUCTIONS, disponibilite, vers_l_administration
from crm_mcp.crm import ClientCrm

from .conftest import CLE_ANONYME, CLE_SERVICE


class _Decouverte(httpx2.AsyncClient):
    """La découverte OIDC simulée : le statut voulu, ou une connexion refusée."""

    statut: int | None = 200

    def __init__(self, *args, **kwargs) -> None:
        statut = type(self).statut

        def repondre(requete: httpx2.Request) -> httpx2.Response:
            if statut is None:
                raise httpx2.ConnectError("refusé", request=requete)
            return httpx2.Response(statut, json={})

        super().__init__(transport=httpx2.MockTransport(repondre))


@pytest.fixture
async def crm(transport_crm):
    client = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=transport_crm)
    yield client
    await client.fermer()


@pytest.mark.parametrize(
    ("statut_sso", "crm_indisponible", "attendu"),
    [
        (200, False, (True, {"sso": "ok", "crm": "ok"})),
        (503, False, (False, {"sso": "HTTP 503", "crm": "ok"})),
        (None, False, (False, {"sso": "injoignable (ConnectError)", "crm": "ok"})),
        (200, True, (False, {"sso": "ok", "crm": "HTTP 503"})),
    ],
)
async def test_pret_nomme_le_controle_en_defaut(monkeypatch, crm, crm_simule, statut_sso, crm_indisponible, attendu):
    monkeypatch.setattr(_Decouverte, "statut", statut_sso)
    monkeypatch.setattr(application.httpx2, "AsyncClient", _Decouverte)
    crm_simule.indisponible = crm_indisponible
    assert await disponibilite("https://sso.exemple.test/.well-known/openid-configuration", crm) == attendu


async def test_crm_injoignable():
    def refuser(requete: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refusé", request=requete)

    crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.MockTransport(refuser))
    ok, controles = await disponibilite("http://127.0.0.1:9/.well-known/openid-configuration", crm)
    assert not ok and controles["crm"] == "injoignable"
    await crm.fermer()


def test_consignes_au_modele():
    assert "crm_workspace_list" in INSTRUCTIONS
    assert "Introuvable ou hors de votre périmètre" in INSTRUCTIONS
    assert "limit (max 100) and offset" in INSTRUCTIONS


async def test_les_chemins_de_l_administration_redirigent_vers_la_webapp():
    assert CHEMINS_ADMINISTRATION == ("/plateforme", "/admin")
    cible = "https://crm.exemple.test/plateforme"
    point = vers_l_administration(cible)
    routes = [Route(chemin, point, methods=["GET"]) for chemin in CHEMINS_ADMINISTRATION]
    transport = httpx2.ASGITransport(app=Starlette(routes=routes))
    async with httpx2.AsyncClient(transport=transport, base_url="https://crm.mcp.exemple.test") as http:
        for chemin in ("/plateforme", "/admin", "/plateforme?onglet=espaces"):
            reponse = await http.get(chemin)
            assert (reponse.status_code, reponse.headers["location"]) == (302, cible), chemin
        assert (await http.get("/plateforme/espaces")).status_code == 404
        assert (await http.post("/plateforme")).status_code == 405

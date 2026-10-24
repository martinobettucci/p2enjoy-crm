# @verifies CRM-104 (docs/BACKLOG.md) — tranche T3 : les quatre outils de contact contre le vrai Keycloak, la vraie base et
#           le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 quinquies
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Les cases de la preuve sont posées par la clé de service et retirées à la fin ; le contact créé est effacé."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

LEO = "5eed0000-0000-4000-8000-000000000091"
SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"
NOM = "Contact MCP intégration"
CASES = [("contacts", a) for a in ("consulter", "ajouter", "modifier")]


async def _poser(qui, cases) -> None:
    lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
    assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(qui, cases) -> None:
    for famille, action in cases:
        await _service(
            "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"}
        )


async def _nettoyer() -> None:
    await _service("DELETE", "/contacts", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "full_name": f"eq.{NOM}"})


async def test_lire_creer_et_modifier_un_contact():
    await _nettoyer()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_contact_update")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            liste = await appeler("crm_contact_list", {"workspace": "p2enjoy", "query": "Marchand"})
            assert [c["id"] for c in liste["contacts"]] == [LEO]
            organisation = liste["contacts"][0]["organization"]
            par_org = await appeler("crm_contact_list", {"workspace": "p2enjoy", "organization_id": organisation["id"]})
            assert LEO in {c["id"] for c in par_org["contacts"]}
            fiche = await appeler("crm_contact_get", {"contact_id": LEO})
            assert {"id": SOGEXIA, "role": "decideur"}.items() <= next(a for a in fiche["affaires"] if a["id"] == SOGEXIA).items()

            cree = (await appeler("crm_contact_create", {
                "workspace": "p2enjoy", "full_name": NOM, "role_title": "Acheteuse", "email": "mcp@exemple.test",
                "organization_id": organisation["id"],
            }))["contact"]
            assert cree["organization"]["id"] == organisation["id"]
            modifie = (await appeler("crm_contact_update", {
                "contact_id": cree["id"], "email": "", "detach_organization": True,
            }))["contact"]
            assert modifie["email"] is None and modifie["organization"] is None
            enBase = (await _service("GET", "/contacts", params={"id": f"eq.{cree['id']}", "select": "role_title,email,organization_id"})).json()
            assert enBase == [{"role_title": "Acheteuse", "email": None, "organization_id": None}]
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_et_la_matrice_ferme_l_ecriture():
    await _nettoyer()
    await _poser(FARIDA, [("contacts", "consulter"), ("contacts", "ajouter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_contact_create" in noms and "crm_contact_update" not in noms, "matrice attendue"
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_contact_create", {"workspace": "p2enjoy", "full_name": NOM})
            assert await _dernier_journal(FARIDA[1]) == ("crm_contact_create", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_contact_update", {"contact_id": LEO, "phone": "00"})
        assert (await _service("GET", "/contacts", params={"full_name": f"eq.{NOM}", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, [("contacts", "consulter"), ("contacts", "ajouter")])
        await _nettoyer()

# @verifies CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations` contre le vrai
#           Keycloak, la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 sexies (dont la décision 666 : `crm_search` filtre les organisations par leur famille) ;
#           docs/SPEC-organisations.md §3, §5
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Les cases de la preuve sont posées par la clé de service et retirées à la fin ; l'organisation créée est effacée."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

VASSEUR = "5eed0000-0000-4000-8000-000000000083"
SOGEXIA = "5eed0000-0000-4000-8000-000000000081"
NOM = "Organisation MCP intégration"
CASES = [("organizations", a) for a in ("consulter", "ajouter", "modifier")]


async def _nettoyer() -> None:
    await _service("DELETE", "/organizations", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "name": f"like.{NOM}*"})


async def test_lister_lire_creer_et_modifier_une_organisation():
    await _nettoyer()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_organization_update")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            liste = await appeler("crm_organization_list", {"workspace": "p2enjoy"})
            par_id = {o["id"]: o for o in liste["organizations"]}
            assert par_id[VASSEUR] == {"id": VASSEUR, "name": "Comptoir Vasseur", "domain": "comptoir-vasseur.example",
                                       "website": None, "contacts": 0}
            assert par_id[SOGEXIA]["contacts"] == 1
            assert [o["id"] for o in (await appeler("crm_organization_list", {"workspace": "p2enjoy", "query": "vasseur"}))["organizations"]] == [VASSEUR]
            fiche = await appeler("crm_organization_get", {"organization_id": SOGEXIA})
            assert [c["full_name"] for c in fiche["contacts"]] == ["Léo Marchand"]

            cree = (await appeler("crm_organization_create", {
                "workspace": "p2enjoy", "name": NOM, "domain": "MCP-Integration.Example", "website": "https://mcp.example",
            }))["organization"]
            assert cree["domain"] == "mcp-integration.example"
            modifie = (await appeler("crm_organization_update", {
                "organization_id": cree["id"], "name": f"{NOM} renommée", "website": "",
            }))["organization"]
            assert modifie["website"] is None
            en_base = (await _service("GET", "/organizations", params={"id": f"eq.{cree['id']}", "select": "name,domain,website"})).json()
            assert en_base == [{"name": f"{NOM} renommée", "domain": "mcp-integration.example", "website": None}]

            with pytest.raises(ToolError, match="domain_taken"):
                await client.call_tool("crm_organization_create", {"workspace": "p2enjoy", "name": NOM, "domain": "sogexia.example"})
            assert await _dernier_journal(DRISS[1]) == ("crm_organization_create", "refus_crm")
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_et_la_matrice_ferme_la_modification():
    await _nettoyer()
    cases = [("organizations", "consulter"), ("organizations", "ajouter")]
    await _poser(FARIDA, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_organization_create" in noms and "crm_organization_update" not in noms,
                "matrice attendue",
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_organization_create", {"workspace": "p2enjoy", "name": NOM})
            assert await _dernier_journal(FARIDA[1]) == ("crm_organization_create", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_organization_update", {"organization_id": VASSEUR, "name": "Réécrite"})
        assert (await _service("GET", "/organizations", params={"name": f"like.{NOM}*", "select": "id"})).json() == []
        assert (await _service("GET", "/organizations", params={"id": f"eq.{VASSEUR}", "select": "name"})).json() == [
            {"name": "Comptoir Vasseur"}
        ]
    finally:
        await _retirer(FARIDA, cases)
        await _nettoyer()


async def test_la_recherche_ne_rend_les_organisations_qu_a_leur_famille():
    """Décision 666 : `contacts:consulter` n'ouvre plus les organisations de `crm_search`."""
    await _poser(DRISS, [("contacts", "consulter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_search")
            sans = (await client.call_tool("crm_search", {"query": "Comptoir Vasseur"})).structured_content
            assert [r for r in sans["results"] if r["kind"] == "organisation"] == []
        await _poser(DRISS, [("organizations", "consulter")])
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_organization_get")
            avec = (await client.call_tool("crm_search", {"query": "Comptoir Vasseur"})).structured_content
            assert VASSEUR in {r["id"] for r in avec["results"] if r["kind"] == "organisation"}
    finally:
        await _retirer(DRISS, [("contacts", "consulter"), ("organizations", "consulter")])

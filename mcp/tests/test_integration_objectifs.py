# @verifies CRM-104 (docs/BACKLOG.md) — tranche T6 : les six outils de la famille `objectifs` contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 nonies ; docs/SPEC-goals.md §2.4 (une flèche par paire de blocs)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LE SEED : « Objectifs du trimestre » (ouvert, six blocs, dont « Doubler le pipeline commercial ») et « Objectifs 2025
(clos) », archivé. Le bloc créé et ses flèches sont effacés ; l'horodatage d'archive du tableau clos est remis tel quel ;
les cases de la matrice que le seed n'accorde pas sont posées puis retirées."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

TRIMESTRE = "5eed0000-0000-4000-8000-0000000000e1"
CLOS = "5eed0000-0000-4000-8000-0000000000e2"
PIPELINE = "5eed0000-0000-4000-8000-0000000000e1"
NOM = "Bloc MCP intégration"
TOUTES = [("objectifs", a) for a in ("consulter", "ajouter", "modifier", "supprimer")]


async def _nettoyer() -> None:
    blocs = (await _service("GET", "/goal_blocks", params={"title": f"eq.{NOM}", "select": "id"})).json()
    for bloc in blocs:
        await _service("DELETE", "/goal_links", params={"or": f"(source_block_id.eq.{bloc['id']},target_block_id.eq.{bloc['id']})"})
    await _service("DELETE", "/goal_blocks", params={"title": f"eq.{NOM}"})


async def test_lire_composer_et_archiver_un_canevas():
    await _nettoyer()
    archive = (await _service("GET", "/goal_boards", params={"id": f"eq.{CLOS}", "select": "archived_at"})).json()[0]["archived_at"]
    posees = await _manquantes(DRISS, TOUTES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_goal_board_archive")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            ouverts = [t["id"] for t in (await appeler("crm_goal_board_list", {"workspace": "p2enjoy"}))["boards"]]
            assert TRIMESTRE in ouverts and CLOS not in ouverts
            fiche = await appeler("crm_goal_board_get", {"board_id": TRIMESTRE})
            assert fiche["can_write"] is True
            assert {"title": "Doubler le pipeline commercial", "fill_percent": 25}.items() <= next(
                b for b in fiche["blocks"] if b["id"] == PIPELINE
            ).items()

            bloc = (await appeler("crm_goal_block_add", {"board_id": TRIMESTRE, "title": NOM, "fill_percent": 30}))["block"]
            droite = max(float(b["pos_x"]) + float(b["width"]) for b in (await _service("GET", "/goal_blocks", params={
                "board_id": f"eq.{TRIMESTRE}", "id": f"neq.{bloc['id']}", "select": "pos_x,width"})).json())
            assert float(bloc["pos_x"]) > droite
            await appeler("crm_goal_link_add", {"board_id": TRIMESTRE, "source_block_id": PIPELINE, "target_block_id": bloc["id"]})
            with pytest.raises(ToolError, match="link_exists"):
                await client.call_tool("crm_goal_link_add", {"board_id": TRIMESTRE, "source_block_id": PIPELINE,
                                                             "target_block_id": bloc["id"]})
            assert await _dernier_journal(DRISS[1]) == ("crm_goal_link_add", "refus_crm")
            await appeler("crm_goal_block_update", {"block_id": bloc["id"], "fill_percent": 55, "body": "Par le connecteur"})
            relu = (await _service("GET", "/goal_blocks", params={"id": f"eq.{bloc['id']}", "select": "fill_percent,body"})).json()
            assert relu == [{"fill_percent": 55, "body": "Par le connecteur"}]

            restaure = (await appeler("crm_goal_board_archive", {"board_id": CLOS, "archived": False}))["board"]
            assert restaure["archived"] is False
            assert (await appeler("crm_goal_board_archive", {"board_id": CLOS}))["board"]["archived"] is True
    finally:
        await _service("PATCH", "/goal_boards", params={"id": f"eq.{CLOS}"}, json={"archived_at": archive})
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_et_la_matrice_ferme_la_modification():
    await _nettoyer()
    posees = await _manquantes(FARIDA, [("objectifs", "consulter"), ("objectifs", "ajouter")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_goal_block_add" in noms and "crm_goal_block_update" not in noms, "matrice attendue"
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_goal_block_add", {"board_id": TRIMESTRE, "title": NOM})
            assert await _dernier_journal(FARIDA[1]) == ("crm_goal_block_add", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_goal_block_update", {"block_id": PIPELINE, "fill_percent": 99})
        assert (await _service("GET", "/goal_blocks", params={"title": f"eq.{NOM}", "select": "id"})).json() == []
        assert (await _service("GET", "/goal_blocks", params={"id": f"eq.{PIPELINE}", "select": "fill_percent"})).json() == [
            {"fill_percent": 25}
        ]
    finally:
        await _retirer(FARIDA, posees)
        await _nettoyer()

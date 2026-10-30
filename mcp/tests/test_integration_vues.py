# @verifies CRM-071 (docs/BACKLOG.md) — tranche T3 : les vues sauvegardées par le connecteur contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §13 (succès, refus par la matrice, journal écrit), §9.2 quattuordecies (la RLS de `saved_views` :
#           la vue privée d'autrui n'est jamais rendue ; les affaires d'une vue sont celles que la base retient pour ses
#           filtres) ; docs/SPEC-seed.md §32 (les deux vues du jeu)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Les vues sont celles du jeu (« Mes négociations », privée de Driss ; « Secteur public, par échéance », de l'espace) : la
preuve n'en écrit aucune. Les cases de la matrice posées pour la preuve sont retirées."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

REFONTE = "5eed0000-0000-4000-8000-000000000034"
NEGOCIATION = "5eed0000-0000-4000-8000-000000000063"
CASE = ("affaires", "consulter")


async def _poser(qui) -> None:
    ligne = {"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": CASE[0], "action": CASE[1]}
    assert (await _service("POST", "/mcp_droits", json=ligne)).status_code == 201


async def _retirer(qui) -> None:
    await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{CASE[0]}", "action": f"eq.{CASE[1]}"})


async def test_sans_la_case_consulter_les_vues_n_existent_pas():
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        await _attendre_outils(client, lambda noms: "crm_view_list" not in noms, "crm_view_list visible sans droit")
        with pytest.raises(ToolError):
            await client.call_tool("crm_view_list", {"channel_id": REFONTE})


async def test_driss_lit_sa_vue_et_celle_de_l_espace_et_liste_les_affaires_de_sa_vue():
    await _poser(DRISS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_view_list")
            vues = (await client.call_tool("crm_view_list", {"channel_id": REFONTE})).structured_content["views"]
            assert await _dernier_journal(DRISS[1]) == ("crm_view_list", "ok")
            par_nom = {v["name"]: v for v in vues}
            assert par_nom["Mes négociations"]["visibility"] == "private"
            assert par_nom["Mes négociations"]["filters"]["step"] == "Négociation"
            assert par_nom["Secteur public, par échéance"]["visibility"] == "workspace"
            assert par_nom["Secteur public, par échéance"]["filters"]["label"] == "Secteur public"

            liste = (await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "view": "mes négociations"})).structured_content
            assert liste["view"]["name"] == "Mes négociations"
            # Les mêmes affaires que la base retient pour les filtres de la vue : le channel, l'étape, éveillées.
            attendues = (await _service("GET", "/card_placements", params={
                "channel_id": f"eq.{REFONTE}", "current_step_id": f"eq.{NEGOCIATION}", "archived_at": "is.null",
                "snoozed_until": "is.null", "select": "card_id",
            })).json()
            assert sorted(c["id"] for c in liste["cards"]) == sorted(a["card_id"] for a in attendues)
            assert liste["cards"], "le jeu porte au moins une affaire en négociation sur « Refonte de site »"

            with pytest.raises(ToolError, match="No saved view named 'Revue du lundi'"):
                await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "view": "Revue du lundi"})
    finally:
        await _retirer(DRISS)


async def test_la_lectrice_ne_lit_jamais_la_vue_privee_de_driss():
    await _poser(FARIDA)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_view_list")
            vues = (await client.call_tool("crm_view_list", {"channel_id": REFONTE})).structured_content["views"]
            assert [v["name"] for v in vues] == ["Secteur public, par échéance"]
            with pytest.raises(ToolError, match="No saved view named 'Mes négociations'"):
                await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "view": "Mes négociations"})
    finally:
        await _retirer(FARIDA)

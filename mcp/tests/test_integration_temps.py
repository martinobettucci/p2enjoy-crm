# @verifies CRM-104 (docs/BACKLOG.md) — tranche T5 : les trois outils de la famille `temps` contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 octies ; docs/SPEC-temps.md (plafond journalier, saisie permise à soi ou à
#           l'administrateur)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LE JOUR DE PREUVE EST EN 2030 : le seed ne pose du temps que sur des jours passés (`docs/SPEC-seed.md` §17.1), si bien
qu'aucune saisie du jeu n'est touchée. Les cases de la matrice que le seed n'accorde pas sont posées puis retirées ;
celles qu'il accorde restent intactes. Les saisies du jour de preuve sont effacées avant et après."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"
CONSEIL_IA = "5eed0000-0000-4000-8000-000000000021"
JOUR = "2030-01-14"


async def _nettoyer() -> None:
    await _service("DELETE", "/saisies_temps", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "jour": f"eq.{JOUR}"})


async def test_poser_lire_et_vider_une_case_et_les_refus_du_crm():
    await _nettoyer()
    posees = await _manquantes(DRISS, [("temps", "consulter"), ("temps", "modifier")])
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_time_entry_set")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            pose = await appeler("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 120, "card_id": SOGEXIA})
            assert pose["entry"]["minutes"] == 120 and pose["entry"]["person_id"] == DRISS[1]
            await appeler("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 300, "card_id": SOGEXIA})
            liste = await appeler("crm_time_entry_list", {"workspace": "p2enjoy", "date_from": JOUR, "date_to": "2030-01-20"})
            assert [(s["minutes"], s["target"]["kind"], s["target"]["name"]) for s in liste["entries"]] == [
                (300, "card", "Migration ERP Sogexia")
            ]
            rapport = await appeler("crm_time_report", {"workspace": "p2enjoy", "date_from": JOUR, "date_to": JOUR})
            assert rapport["total_minutes"] == 300

            with pytest.raises(ToolError, match="daily_limit"):
                await client.call_tool("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 180,
                                                              "track_id": CONSEIL_IA})
            assert await _dernier_journal(DRISS[1]) == ("crm_time_entry_set", "refus_crm")
            with pytest.raises(ToolError, match="entry_not_allowed"):
                await client.call_tool("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 15,
                                                              "card_id": SOGEXIA, "person": "Camille Aubert"})
            assert await _dernier_journal(DRISS[1]) == ("crm_time_entry_set", "refus_crm")

            vide = await appeler("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 0, "card_id": SOGEXIA})
            assert vide == {"cleared": True, "entry": None}
        restantes = (await _service("GET", "/saisies_temps", params={"jour": f"eq.{JOUR}", "select": "id"})).json()
        assert restantes == []
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_la_matrice_ferme_la_saisie_a_qui_ne_tient_que_la_lecture():
    posees = await _manquantes(FARIDA, [("temps", "consulter")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_time_entry_list" in noms and "crm_time_entry_set" not in noms, "matrice attendue"
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_time_entry_set", {"workspace": "p2enjoy", "day": JOUR, "minutes": 15,
                                                              "track_id": CONSEIL_IA})
        assert (await _service("GET", "/saisies_temps", params={"jour": f"eq.{JOUR}", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, posees)
        await _nettoyer()

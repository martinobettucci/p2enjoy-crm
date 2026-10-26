# @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.a : les sept outils de lecture des affaires contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies CRM-067 (docs/BACKLOG.md) — tranche T4 : `crm_card_activity_list` lit les activités du seed (docs/SPEC-seed.md
#           §23)
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 bis (ancre `channel` facultative, filtres réels), §6.2 (refus uniforme)
# @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé rendus par la vraie base, `None` pour une
#           affaire gagnée ; docs/SPEC-analytique.md §13.4, §13.7 ; décision 708 (M4 B)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Chaque preuve pose dans `mcp_droits`, par la clé de service, la case `affaires:consulter` dont elle a besoin, et la retire
à la fin : la matrice du seed (§21.4, §22) est rendue telle qu'elle était."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import CONSULTATIONS_AFFAIRES, ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"  # « Migration ERP Sogexia », Léo Marchand lié, trois activités (§23)
GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"
OUTILS = tuple(sorted(CONSULTATIONS_AFFAIRES))


async def _ouvrir(qui) -> None:
    case = {"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": "affaires", "action": "consulter"}
    assert (await _service("POST", "/mcp_droits", json=case)).status_code == 201


async def _fermer(qui) -> None:
    await _service(
        "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": "eq.affaires", "action": "eq.consulter"}
    )


async def test_fermes_par_la_matrice_du_seed():
    """La matrice du seed n'ouvre pas `affaires` au business developer : les sept outils n'existent pas pour lui."""
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        await _attendre_outils(client, lambda noms: not noms & set(OUTILS), "un outil « affaires » visible sans droit")
        with pytest.raises(ToolError):
            await client.call_tool("crm_card_get", {"card_id": SOGEXIA})


async def test_chaque_outil_reussit_contre_la_vraie_base_et_le_journal_le_nomme():
    await _ouvrir(DRISS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_mine")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            # « Sogexia » est aussi dans le titre d'affaires de volume du seed : chaque ligne rendue le porte.
            liste = await appeler("crm_card_list", {"workspace": "p2enjoy", "query": "Sogexia", "limit": 100})
            assert SOGEXIA in {c["id"] for c in liste["cards"]}
            assert all("sogexia" in c["title"].lower() for c in liste["cards"])
            sogexia = next(c for c in liste["cards"] if c["id"] == SOGEXIA)
            assert sogexia["channel"]["name"] == "Grands comptes" and sogexia["step"]["name"]

            # L'ancre facultative, présente : le channel est lu sous le jeton, et le filtre porte.
            par_channel = await appeler("crm_card_list", {"workspace": "p2enjoy", "channel_id": GRANDS_COMPTES, "limit": 100})
            assert SOGEXIA in {c["id"] for c in par_channel["cards"]}
            assert {c["channel"]["id"] for c in par_channel["cards"]} == {GRANDS_COMPTES}

            # Le filtre d'étape traverse deux embarquements imbriqués : la base le rend, ou rien.
            etape = sogexia["step"]["name"]
            par_etape = await appeler("crm_card_list", {"workspace": "p2enjoy", "step": etape, "limit": 100})
            assert par_etape["cards"] and {c["step"]["name"] for c in par_etape["cards"]} == {etape}

            fiche = await appeler("crm_card_get", {"card_id": SOGEXIA})
            enBase = (await _service("GET", "/cards", params={"id": f"eq.{SOGEXIA}", "select": "title,description,amount"})).json()[0]
            assert (fiche["title"], fiche["description"], fiche["amount"]) == (enBase["title"], enBase["description"], enBase["amount"])
            assert fiche["can_write"] is True
            assert {"name": "Léo Marchand", "role": "decideur"}.items() <= next(
                c for c in fiche["contacts"] if c["name"] == "Léo Marchand"
            ).items()
            assert fiche["workflow"]["name"] and fiche["probability"]["source"] in ("card", "step", "node", None)

            fil = await appeler("crm_card_timeline", {"card_id": SOGEXIA, "limit": 100})
            activites_du_fil = [e for e in fil["entries"] if e["kind"] == "activity"]
            assert len(activites_du_fil) == 3
            instants = [e["at"] for e in fil["entries"]]
            # Le fil de Sogexia grandit à chaque campagne E2E : la page en rend au plus 100, le total les compte tous.
            assert fil["entries"][0]["kind"] in ("event", "comment", "activity")
            assert len(instants) == min(fil["total"], 100) and instants == sorted(instants)

            await appeler("crm_card_comment_list", {"card_id": SOGEXIA})

            activites = await appeler("crm_card_activity_list", {"card_id": SOGEXIA})
            assert [a["type"] for a in activites["activities"]] == ["call", "meeting", "call"]
            assert activites["activities"][0]["retired"] and activites["activities"][0]["retired_by_moderation"]
            assert activites["activities"][0]["subject"] is None
            assert activites["activities"][2]["subject"] == "Appel de qualification"
            assert "Léo Marchand" in activites["activities"][2]["contacts"]

            figees = await appeler("crm_stale_card_list", {"workspace": "p2enjoy"})
            attendues = (await _service("POST", "/rpc/cards_figees", json={})).json()
            assert figees["total"] == len([l for l in attendues if l["workspace_id"] == ESPACE_SEEDE])
            retards = [c["overdue_days"] for c in figees["cards"]]
            assert retards == sorted(retards, reverse=True)

            journee = await appeler("crm_card_mine", {"workspace": "p2enjoy", "scope": "all"})
            assert set(journee) >= {"overdue", "today", "upcoming"}
    finally:
        await _fermer(DRISS)


async def test_refuses_par_le_crm_malgre_la_matrice_ouverte():
    """La lectrice, matrice ouverte, ne lit pas « Grands comptes », que son track lui ferme : l'affaire et le channel sont
    introuvables pour elle, et le journal le nomme `refus_crm`. La RLS a le dernier mot."""
    await _ouvrir(FARIDA)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_get")
            for outil in ("crm_card_get", "crm_card_timeline", "crm_card_comment_list", "crm_card_activity_list"):
                with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                    await client.call_tool(outil, {"card_id": SOGEXIA})
                assert await _dernier_journal(FARIDA[1]) == (outil, "refus_crm"), outil
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "channel_id": GRANDS_COMPTES})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_list", "refus_crm")
            # Ses propres listes ne portent aucune affaire de ce track.
            liste = (await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "limit": 100})).structured_content
            assert SOGEXIA not in {c["id"] for c in liste["cards"]}
            for outil in ("crm_stale_card_list", "crm_card_mine"):
                with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                    await client.call_tool(outil, {"workspace": "espace-inconnu"})
                assert await _dernier_journal(FARIDA[1]) == (outil, "refus_crm"), outil
    finally:
        await _fermer(FARIDA)


async def test_les_scores_de_sante_viennent_de_la_vraie_base():
    """« Migration ERP Sogexia » est ouverte : ses deux scores sont rendus avec leur palier et leurs composantes, et ce sont
    ceux que la base calcule pour la clé de service ; « Socle analytique — Vertuo » est gagnée : aucun score."""
    await _ouvrir(DRISS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_get")
            fiche = (await client.call_tool("crm_card_get", {"card_id": SOGEXIA})).structured_content
            attendu = (await _service("GET", "/cards", params={
                "id": f"eq.{SOGEXIA}", "select": "health_momentum,health_commercial",
            })).json()[0]
            assert fiche["health_momentum"] == attendu["health_momentum"]
            assert fiche["health_commercial"] == attendu["health_commercial"]
            assert fiche["health_momentum"]["tier"] in {"healthy", "watch", "danger"}
            assert {s["code"] for s in fiche["health_commercial"]["signals"]} == {
                "probability", "contact_freshness", "next_action_timeliness", "step_age"}
            gagnee = (await client.call_tool("crm_card_get", {"card_id": "5eed0000-0000-4000-8000-0000000000cd"})).structured_content
            assert gagnee["health_momentum"] is None and gagnee["health_commercial"] is None
    finally:
        await _fermer(DRISS)

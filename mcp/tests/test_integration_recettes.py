# @verifies CRM-108 (docs/BACKLOG.md) — tranche T4 : les outils `recettes` contre le vrai Keycloak, la vraie base et le vrai
#           service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-recettes.md §7 (visibilité par la matrice de démonstration du seed §21.4 ; succès ; refus par la
#           matrice ; refus par le CRM malgré la matrice ouverte — rapport `rentabilite_reservee`, lectrice qui écrit ;
#           journal écrit) ; docs/SPEC-mcp.md §6.2, §7.1, §13 (preuves par outil)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le business developer porte la matrice du seed §21.4 — `recettes` consulter et ajouter, `budgets` et `temps` consulter.
Chaque écriture de la preuve est retirée par la clé de service à la fin."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from crm_mcp.politique import DUREE_VISIBILITE_S

from .test_integration_oauth import ESPACE_SEEDE, EXPLOITANTE, FARIDA, MCP, _jetons, _parcours, _service, pytestmark  # noqa: F401

DRISS = ("bizdev", "5eed0000-0000-4000-8000-000000000012")
CARTE = "5eed0000-0000-4000-8000-0000000000c4"
NATURE = "Ligne MCP intégration"
LIGNE_SEEDEE = "5eed0000-0000-4000-8000-0000000000f3"  # « Lot 1 — conception », ouverte, un réel (seed §21)
INCONNUE = "5eed0000-0000-4000-8000-00000000ffff"
OUTILS = (
    "crm_card_revenue_list", "crm_revenues_to_enter", "crm_profitability_report", "crm_card_revenue_add",
    "crm_card_revenue_actual_add", "crm_card_revenue_update", "crm_card_revenue_actual_update", "crm_card_revenue_settle",
)


async def _jeton(qui) -> str:
    reponse, contexte = await _parcours(qui)
    return (await _jetons(contexte, reponse))["access_token"]


async def _dernier_journal(sub: str) -> tuple[str, str]:
    lignes = (await _service("GET", "/mcp_journal", params={"sub": f"eq.{sub}", "order": "id.desc", "limit": "1"})).json()
    return lignes[0]["outil"], lignes[0]["issue"]


async def _attendre_outils(client: Client, vu: Callable[[set[str]], bool], attendu: str) -> None:
    """Un droit posé ou retiré se voit au plus tard quand la visibilité retenue par le service expire
    (`DUREE_VISIBILITE_S`) : on attend l'état dans `tools/list`, borné à trois fois cette durée, plutôt qu'une pause
    arbitraire."""
    echeance = time.monotonic() + 3 * DUREE_VISIBILITE_S
    while not vu({o.name for o in await client.list_tools()}):
        assert time.monotonic() < echeance, attendu
        await asyncio.sleep(0.2)


async def _attendre_visible(client: Client, outil: str) -> None:
    await _attendre_outils(client, lambda noms: outil in noms, f"{outil} reste invisible après le droit posé")


async def _nettoyer() -> None:
    await _service("DELETE", "/card_revenues", params={"card_id": f"eq.{CARTE}", "label": f"eq.{NATURE}"})


async def test_la_matrice_du_seed_ouvre_les_consultations_et_les_ajouts_seulement():
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        outils = {o.name for o in await client.list_tools()}
    assert {"crm_card_revenue_list", "crm_revenues_to_enter", "crm_profitability_report",
            "crm_card_revenue_add", "crm_card_revenue_actual_add"} <= outils
    assert not outils & {"crm_card_revenue_update", "crm_card_revenue_actual_update", "crm_card_revenue_settle"}


async def test_ajouter_une_ligne_et_un_reel_puis_les_lire_et_le_journal():
    await _nettoyer()
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            ligne = (await client.call_tool(
                "crm_card_revenue_add", {"card_id": CARTE, "label": NATURE, "estimated_amount": 1000}
            )).structured_content["revenue_line"]
            assert ligne["actual_amount"] is None
            await client.call_tool("crm_card_revenue_actual_add", {"revenue_id": ligne["id"], "amount": 250})
            lu = (await client.call_tool("crm_card_revenue_list", {"card_id": CARTE})).structured_content
        assert lu["currency"] == "EUR"
        mienne = [l for l in lu["revenue_lines"] if l["id"] == ligne["id"]]
        assert mienne and mienne[0]["actual_amount"] == 250
        # L'effet, dans la table que lit la webapp (docs/SPEC-mcp.md §9.1 : aucun chemin parallèle).
        enBase = (await _service("GET", "/card_revenues", params={"id": f"eq.{ligne['id']}", "select": "actual_amount,created_by"})).json()
        assert enBase == [{"actual_amount": 250, "created_by": DRISS[1]}]
        assert await _dernier_journal(DRISS[1]) == ("crm_card_revenue_list", "ok")
    finally:
        await _nettoyer()


async def test_un_outil_que_la_matrice_ferme_n_existe_pas():
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        with pytest.raises(ToolError):
            await client.call_tool("crm_card_revenue_settle", {"revenue_id": "5eed0000-0000-4000-8000-0000000000f3", "settled": True})


async def test_le_rapport_est_refuse_par_le_crm_malgre_la_matrice_ouverte():
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        with pytest.raises(ToolError, match="rentabilite_reservee"):
            await client.call_tool("crm_profitability_report", {"workspace": "p2enjoy"})
    assert await _dernier_journal(DRISS[1]) == ("crm_profitability_report", "refus_crm")


async def test_le_rapport_rendu_a_qui_administre_l_espace():
    async with Client(f"{MCP}/mcp", auth=await _jeton(EXPLOITANTE)) as client:
        rapport = (await client.call_tool("crm_profitability_report", {"workspace": "p2enjoy", "state": "won"})).structured_content
    assert rapport["total"] >= 1
    assert all(r["state"] == "won" for r in rapport["rows"])


async def test_la_lectrice_qui_ajoute_est_refusee_par_le_crm():
    droits = [{"sub": FARIDA[1], "workspace_id": ESPACE_SEEDE, "famille": "recettes", "action": a} for a in ("consulter", "ajouter")]
    assert (await _service("POST", "/mcp_droits", json=droits)).status_code == 201
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_revenue_add")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_card_revenue_add", {"card_id": CARTE, "label": NATURE, "estimated_amount": 1})
        assert await _dernier_journal(FARIDA[1]) == ("crm_card_revenue_add", "refus_crm")
    finally:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{FARIDA[1]}"})
        await _nettoyer()


async def test_a_saisir_puis_corriger_et_solder_quand_la_matrice_ouvre_modifier():
    """Les trois outils de `modifier` et « à saisir », chacun réussi contre la vraie base."""
    await _nettoyer()
    case = {"sub": DRISS[1], "workspace_id": ESPACE_SEEDE, "famille": "recettes", "action": "modifier"}
    assert (await _service("POST", "/mcp_droits", json=case)).status_code == 201
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_revenue_settle")
            ligne = (await client.call_tool(
                "crm_card_revenue_add", {"card_id": CARTE, "label": NATURE, "estimated_amount": 1000}
            )).structured_content["revenue_line"]
            reel = (await client.call_tool(
                "crm_card_revenue_actual_add", {"revenue_id": ligne["id"], "amount": 100, "received_on": "2026-03-15"}
            )).structured_content["actual"]
            attente = (await client.call_tool("crm_revenues_to_enter", {"workspace": "p2enjoy", "limit": 100})).structured_content
            assert any(l["id"] == ligne["id"] and l["you_can_enter"] for l in attente["revenue_lines"])
            await client.call_tool("crm_card_revenue_update", {"revenue_id": ligne["id"], "estimated_amount": 1200})
            await client.call_tool("crm_card_revenue_actual_update", {"revenue_actual_id": reel["id"], "amount": 150})
            solde = (await client.call_tool(
                "crm_card_revenue_settle", {"revenue_id": ligne["id"], "settled": True}
            )).structured_content["revenue_line"]
        assert solde["actual_amount"] == 150 and solde["settled_at"] is not None
        enBase = (await _service("GET", "/card_revenues", params={"id": f"eq.{ligne['id']}", "select": "estimated_amount,settled_by"})).json()
        assert enBase == [{"estimated_amount": 1200, "settled_by": DRISS[1]}]
    finally:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{DRISS[1]}", "famille": "eq.recettes", "action": "eq.modifier"})
        await _nettoyer()


async def test_chaque_outil_est_ferme_par_la_matrice_puis_refuse_par_le_crm_malgre_la_matrice_ouverte():
    """Pour CHACUN des huit outils (docs/SPEC-recettes.md §11) : la lectrice sans droit ne le voit pas ; matrice
    entièrement ouverte, le CRM refuse — la RLS cache l'objet ou refuse l'écriture, la fonction n'est pas à elle — et le
    journal le nomme `refus_crm`. Aucune écriture n'aboutit : la ligne seedée est relue inchangée. Sans aucun droit, le
    compte resterait « en attente » (docs/SPEC-mcp.md §7.3) : une case d'une autre famille lui ouvre le connecteur."""
    autre = {"sub": FARIDA[1], "workspace_id": ESPACE_SEEDE, "famille": "affaires", "action": "consulter"}
    assert (await _service("POST", "/mcp_droits", json=autre)).status_code == 201
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(client, lambda noms: not noms & set(OUTILS), "un outil « recettes » reste visible sans droit")
    except BaseException:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{FARIDA[1]}"})
        raise
    reel = (await _service("GET", "/card_revenue_actuals", params={"card_revenue_id": f"eq.{LIGNE_SEEDEE}", "select": "id"})).json()[0]["id"]
    avant = (await _service("GET", "/card_revenues", params={"id": f"eq.{LIGNE_SEEDEE}", "select": "*"})).json()
    appels = {
        "crm_card_revenue_list": {"card_id": INCONNUE},
        "crm_revenues_to_enter": {"workspace": "espace-inconnu"},
        "crm_profitability_report": {"workspace": "p2enjoy"},
        "crm_card_revenue_add": {"card_id": CARTE, "label": NATURE, "estimated_amount": 1},
        "crm_card_revenue_actual_add": {"revenue_id": LIGNE_SEEDEE, "amount": 1},
        "crm_card_revenue_update": {"revenue_id": LIGNE_SEEDEE, "estimated_amount": 1},
        "crm_card_revenue_actual_update": {"revenue_actual_id": reel, "amount": 1},
        "crm_card_revenue_settle": {"revenue_id": LIGNE_SEEDEE, "settled": True},
    }
    assert set(appels) == set(OUTILS)
    droits = [{"sub": FARIDA[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a}
              for f, a in [("recettes", a) for a in ("consulter", "ajouter", "modifier")] + [("budgets", "consulter"), ("temps", "consulter")]]
    try:
        assert (await _service("POST", "/mcp_droits", json=droits)).status_code == 201
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_revenue_settle")
            for outil, arguments in appels.items():
                with pytest.raises(ToolError):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(FARIDA[1]) == (outil, "refus_crm"), outil
        assert (await _service("GET", "/card_revenues", params={"id": f"eq.{LIGNE_SEEDEE}", "select": "*"})).json() == avant
    finally:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{FARIDA[1]}"})
        await _nettoyer()

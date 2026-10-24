# @verifies CRM-104 (docs/BACKLOG.md) — tranche T4 : les neuf outils de la famille `budgets` contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 septies ; docs/SPEC-costs.md §2.3 (occurrence d'un budget récurrent), §2.3 bis (réel
#           dérivé, ligne soldée)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Les cases de la preuve sont posées par la clé de service et retirées à la fin ; la ligne de coût créée, et ses réels,
sont effacés. LE SEED : « Suisse romande » (ouvert, track Formation, que la lectrice lit), « Prospection sortante » (budget ouvert, non récurrent, track Conseil & IA), « Publicité 2026 »
(récurrent), « Salon du web 2025 » (clôturé) ; la ligne « Achat d'espace » soldée sur l'affaire MGEN."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"
MGEN = "5eed0000-0000-4000-8000-0000000000cc"
PROSPECTION = "5eed0000-0000-4000-8000-0000000000c1"
PUBLICITE = "5eed0000-0000-4000-8000-0000000000c2"
SALON = "5eed0000-0000-4000-8000-0000000000c3"
ACHAT_ESPACE = "5eed0000-0000-4000-8000-0000000000e3"
FORMATION_DATA = "5eed0000-0000-4000-8000-0000000000c7"
SUISSE_ROMANDE = "5eed0000-0000-4000-8000-0000000000c4"
NOM = "Coût MCP intégration"
CASES = [("budgets", a) for a in ("consulter", "ajouter", "modifier")]


async def _manquantes(qui, cases) -> list[tuple[str, str]]:
    """Les cases que la personne n'a pas déjà : le seed en accorde (`docs/SPEC-seed.md` §22), et la preuve ne pose ni ne
    retire que les siennes — le seed reste intact."""
    tenues = (await _service("GET", "/mcp_droits", params={
        "sub": f"eq.{qui[1]}", "workspace_id": f"eq.{ESPACE_SEEDE}", "select": "famille,action",
    })).json()
    deja = {(d["famille"], d["action"]) for d in tenues}
    return [c for c in cases if c not in deja]


async def _nettoyer() -> None:
    lignes = (await _service("GET", "/card_costs", params={"label": f"eq.{NOM}", "select": "id"})).json()
    for ligne in lignes:
        await _service("DELETE", "/card_cost_actuals", params={"card_cost_id": f"eq.{ligne['id']}"})
    await _service("DELETE", "/card_costs", params={"label": f"eq.{NOM}"})


async def test_lire_les_budgets_et_tenir_une_ligne_de_cout():
    await _nettoyer()
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_cost_settle")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            ouverts = {b["id"] for b in (await appeler("crm_budget_list", {"workspace": "p2enjoy"}))["budgets"]}
            assert PROSPECTION in ouverts and SALON not in ouverts
            tous = await appeler("crm_budget_list", {"workspace": "p2enjoy", "include_closed": True})
            assert SALON in {b["id"] for b in tous["budgets"]}

            publicite = await appeler("crm_budget_get", {"budget_id": PUBLICITE})
            assert publicite["is_recurrent"] is True and publicite["occurrences"]
            assert ACHAT_ESPACE in {l["id"] for l in publicite["lines"]}

            mgen = await appeler("crm_card_cost_list", {"card_id": MGEN})
            achat = next(l for l in mgen["cost_lines"] if l["id"] == ACHAT_ESPACE)
            assert achat["settled"] is True and float(achat["actual_cost"]) == 880

            a_saisir = await appeler("crm_costs_to_enter", {"workspace": "p2enjoy", "limit": 100})
            assert ACHAT_ESPACE not in {l["id"] for l in a_saisir["cost_lines"]}

            ligne = (await appeler("crm_card_cost_add", {
                "card_id": SOGEXIA, "budget_id": PROSPECTION, "label": NOM, "estimated_cost": 120,
            }))["cost_line"]
            reel = (await appeler("crm_card_cost_actual_add", {"cost_id": ligne["id"], "amount": 50, "label": "F-1"}))["actual"]
            await appeler("crm_card_cost_actual_update", {"cost_actual_id": reel["id"], "amount": 60})
            await appeler("crm_card_cost_update", {"cost_id": ligne["id"], "estimated_cost": 130})
            solde = (await appeler("crm_card_cost_settle", {"cost_id": ligne["id"], "settled": True}))["cost_line"]
            assert float(solde["actual_cost"]) == 60 and solde["settled_at"] is not None

            with pytest.raises(ToolError, match="ligne soldée"):
                await client.call_tool("crm_card_cost_actual_add", {"cost_id": ligne["id"], "amount": 1})
            assert await _dernier_journal(DRISS[1]) == ("crm_card_cost_actual_add", "refus_crm")
            await appeler("crm_card_cost_settle", {"cost_id": ligne["id"], "settled": False})

            with pytest.raises(ToolError, match="occurrence_required"):
                await client.call_tool("crm_card_cost_add", {
                    "card_id": SOGEXIA, "budget_id": PUBLICITE, "label": NOM, "estimated_cost": 1,
                })

            en_base = (await _service("GET", "/card_costs", params={
                "id": f"eq.{ligne['id']}", "select": "estimated_cost,actual_cost,settled_at,card_cost_actuals(amount,label)",
            })).json()
            assert en_base == [{"estimated_cost": 130, "actual_cost": 60, "settled_at": None,
                                "card_cost_actuals": [{"amount": 60, "label": "F-1"}]}]
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_et_la_matrice_ferme_la_modification():
    await _nettoyer()
    cases = await _manquantes(FARIDA, [("budgets", "consulter"), ("budgets", "ajouter")])
    await _poser(FARIDA, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_card_cost_add" in noms and "crm_card_cost_settle" not in noms, "matrice attendue"
            )
            # Une affaire et un budget qu'elle LIT (track Formation) : c'est l'écriture que la base lui refuse.
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_cost_add", {
                    "card_id": FORMATION_DATA, "budget_id": SUISSE_ROMANDE, "label": NOM, "estimated_cost": 1,
                })
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_cost_add", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_cost_settle", {"cost_id": ACHAT_ESPACE, "settled": False})
        assert (await _service("GET", "/card_costs", params={"label": f"eq.{NOM}", "select": "id"})).json() == []
        assert (await _service("GET", "/card_costs", params={"id": f"eq.{ACHAT_ESPACE}", "select": "settled_at"})).json()[0][
            "settled_at"
        ] is not None
    finally:
        await _retirer(FARIDA, cases)
        await _nettoyer()

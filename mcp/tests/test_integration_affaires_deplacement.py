# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `affaires` inscrit `crm_card_move`
#           (docs/SPEC-mcp.md §9.2 ter)
# @verifies CRM-150 (docs/BACKLOG.md) — l'issue d'audit de chaque refus d'un déplacement, contre le vrai Keycloak, la vraie
#           base et le vrai service `mcp` : transition absente, motif exigé, champ exigé, checklist exigée, étape inconnue,
#           rattachement archivé, affaire à la corbeille — jamais `erreur` pour un refus
# @verifies docs/SPEC-mcp.md §9.3 (traduction des refus), §7.1 (`mcp_journal.issue`) ; docs/JOURNAL.md décision 928
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le business developer reçoit les cases `affaires` (consulter, ajouter, modifier) ; les affaires créées par la preuve
portent un titre marqué, et sont effacées à la fin par la clé de service avec la matrice rendue."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_visible, _dernier_journal, _jeton

GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"
CHECKLISTS = "5eed0000-0000-4000-8000-0000000c6841"  # Relance → Négociation exige des points de checklist
TITRE = "Affaire MCP déplacement CRM-150"
CASES = [("affaires", a) for a in ("consulter", "ajouter", "modifier", "supprimer")]


async def _manquantes(cases) -> list[tuple[str, str]]:
    tenues = (await _service("GET", "/mcp_droits", params={
        "sub": f"eq.{DRISS[1]}", "workspace_id": f"eq.{ESPACE_SEEDE}", "select": "famille,action"})).json()
    return [c for c in cases if {"famille": c[0], "action": c[1]} not in tenues]


async def _poser(cases) -> None:
    if cases:
        lignes = [{"sub": DRISS[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
        assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(cases) -> None:
    for famille, action in cases:
        await _service("DELETE", "/mcp_droits", params={
            "sub": f"eq.{DRISS[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"})


async def _nettoyer() -> None:
    await _service("DELETE", "/cards", params={"title": f"like.{TITRE}*"})


async def test_chaque_refus_d_un_deplacement_est_un_refus_jamais_une_erreur():
    await _nettoyer()
    posees = await _manquantes(CASES)
    await _poser(posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_move")

            async def creer(channel: str, suffixe: str) -> str:
                carte = (await client.call_tool("crm_card_create", {"channel_id": channel, "title": f"{TITRE} {suffixe}"}))
                return carte.structured_content["card"]["id"]

            async def refuse(arguments: dict, motif: str) -> str:
                with pytest.raises(ToolError, match=motif):
                    await client.call_tool("crm_card_move", arguments)
                outil, issue = await _dernier_journal(DRISS[1])
                assert outil == "crm_card_move"
                return issue

            issues: dict[str, str] = {}
            ident = await creer(GRANDS_COMPTES, "A")
            issues["transition absente"] = await refuse({"card_id": ident, "to_step": "Négociation"}, "transition_not_allowed")
            issues["motif exigé"] = await refuse({"card_id": ident, "to_step": "Perdu"}, "comment_required")
            issues["motif trop long"] = await refuse(
                {"card_id": ident, "to_step": "Perdu", "comment": "x" * 10_001}, "comment_too_long")
            issues["étape inconnue"] = await refuse({"card_id": ident, "to_step": "Gagné"}, "Gagné")
            await client.call_tool("crm_card_move", {"card_id": ident, "to_step": "Relance"})
            issues["champ exigé"] = await refuse({"card_id": ident, "to_step": "Négociation"}, "missing_required_fields")

            liste = await creer(CHECKLISTS, "B")
            await client.call_tool("crm_card_move", {"card_id": liste, "to_step": "Relance"})
            issues["checklist exigée"] = await refuse({"card_id": liste, "to_step": "Négociation"}, "checklist_incomplete")

            # Le rattachement archivé, puis l'affaire à la corbeille : le refus uniforme, l'objet étant hors de portée.
            archivee = await creer(GRANDS_COMPTES, "C")
            await _service("PATCH", "/card_placements", params={"card_id": f"eq.{archivee}"},
                           json={"archived_at": "now"})
            issues["rattachement archivé"] = await refuse({"card_id": archivee, "to_step": "Relance"}, "Introuvable")
            corbeille = await creer(GRANDS_COMPTES, "D")
            await client.call_tool("crm_card_trash", {"card_id": corbeille})
            issues["affaire à la corbeille"] = await refuse({"card_id": corbeille, "to_step": "Relance"}, "Introuvable")

            fautives = {cas: issue for cas, issue in issues.items() if issue != "refus_crm"}
            assert fautives == {}, f"refus journalisés autrement que refus_crm : {fautives}"
    finally:
        await _retirer(posees)
        await _nettoyer()

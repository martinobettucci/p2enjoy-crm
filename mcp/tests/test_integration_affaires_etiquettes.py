# @verifies CRM-069 (docs/BACKLOG.md) — tranche T3 : les étiquettes par le connecteur contre le vrai Keycloak, la vraie base
#           et le vrai service `mcp`, par le parcours OAuth réel
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.5 : l'affaire jetable posée puis rattachée (révisé le 2026-10-30, migration 0134)
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §13 (succès, refus par la matrice, refus par le CRM malgré la matrice ouverte, journal écrit ;
#           l'effet dans les tables que lit la webapp), §9.2 tredecies ; docs/SPEC-etiquettes-digest.md §2.2, §4
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Deux étiquettes de preuve sont posées au catalogue par la clé de service, et une affaire jetable dans le channel
« Checklists », que Driss écrit ; toutes sont retirées à la fin, l'affaire avec ses poses et son fil — le fil est en ajout
seul, même pour la clé de service : une pose sur une affaire du jeu y laisserait ses lignes. Les cases de la matrice posées
pour la preuve sont retirées."""

from __future__ import annotations

import uuid

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

# Le channel « Checklists » de Studio web, que Driss écrit et que Farida lit, son workflow et son étape initiale
# (docs/SPEC-seed.md).
CHANNEL_CHECKLISTS = "5eed0000-0000-4000-8000-0000000c6841"
WORKFLOW_CHECKLISTS = "5eed0000-0000-4000-8000-0000000c6801"
ETAPE_INITIALE = "5eed0000-0000-4000-8000-0000000c6811"
TITRE = "ZZ MCP Etiquettes"
PREUVES = ("ZZ MCP Prioritaire", "ZZ MCP Archivée")
CASES = [("affaires", "consulter"), ("affaires", "modifier")]


async def _poser(qui, cases) -> None:
    lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
    assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(qui, cases) -> None:
    for famille, action in cases:
        await _service(
            "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"}
        )


async def _nettoyer() -> None:
    await _service("DELETE", "/labels", params={"name": "like.ZZ MCP*"})
    await _service("DELETE", "/cards", params={"title": f"like.{TITRE}*"})


async def _catalogue() -> str:
    """Le catalogue de la preuve et l'affaire jetable ; rend l'identifiant de l'affaire."""
    await _nettoyer()
    # Un envoi groupé exige les mêmes clés dans chaque objet (PostgREST, sinon 400).
    lignes = [{"workspace_id": ESPACE_SEEDE, "name": PREUVES[0], "color": "danger", "archived_at": None},
              {"workspace_id": ESPACE_SEEDE, "name": PREUVES[1], "color": "neutral", "archived_at": "2026-01-15T09:00:00Z"}]
    assert (await _service("POST", "/labels", json=lignes)).status_code == 201
    # L'affaire, puis son rattachement : depuis la migration 0134, le channel, le workflow et l'étape vivent sur le
    # rattachement (`CRM-111` T2.4.5) ; la clé de service est exemptée de l'invariant différé « au moins un rattachement ».
    identifiant = str(uuid.uuid4())
    creee = await _service("POST", "/cards", json={"id": identifiant, "workspace_id": ESPACE_SEEDE, "title": f"{TITRE} Cerfrance"})
    assert creee.status_code == 201, creee.text
    pose = await _service("POST", "/card_placements", json={
        "card_id": identifiant, "workspace_id": ESPACE_SEEDE, "channel_id": CHANNEL_CHECKLISTS,
        "workflow_id": WORKFLOW_CHECKLISTS, "current_step_id": ETAPE_INITIALE,
    })
    assert pose.status_code == 201, pose.text
    return identifiant


async def test_sans_la_case_modifier_la_pose_n_existe_pas():
    await _poser(DRISS, [("affaires", "consulter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(client, lambda noms: "crm_card_list" in noms and "crm_card_label_set" not in noms,
                                   "la pose d'étiquette reste visible")
    finally:
        await _retirer(DRISS, [("affaires", "consulter")])


async def test_poser_lire_filtrer_retirer_par_le_connecteur():
    carte = await _catalogue()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_label_set")
            pose = (await client.call_tool("crm_card_label_set", {"card_id": carte, "add": ["zz mcp prioritaire"]})).structured_content
            assert await _dernier_journal(DRISS[1]) == ("crm_card_label_set", "ok")
            assert [e["name"] for e in pose["labels"]] == [PREUVES[0]]
            # La base a posé l'espace et l'auteur, et le fil le dit au nom de la personne.
            en_base = (await _service("GET", "/card_labels", params={"card_id": f"eq.{carte}", "select": "created_by,workspace_id"})).json()
            assert en_base == [{"created_by": DRISS[1], "workspace_id": ESPACE_SEEDE}]
            fil = (await _service("GET", "/card_events", params={"card_id": f"eq.{carte}", "type": "eq.label_added", "select": "actor_id,payload"})).json()
            assert fil == [{"actor_id": DRISS[1], "payload": {"label_id": fil[0]["payload"]["label_id"], "name": PREUVES[0]}}]

            fiche = (await client.call_tool("crm_card_get", {"card_id": carte})).structured_content
            assert [e["name"] for e in fiche["labels"]] == [PREUVES[0]]
            liste = (await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "label": PREUVES[0].upper()})).structured_content
            assert [c["id"] for c in liste["cards"]] == [carte]

            # Une archivée ne se pose plus, et le refus vient avant toute écriture.
            with pytest.raises(ToolError, match="ZZ MCP Archivée"):
                await client.call_tool("crm_card_label_set", {"card_id": carte, "add": [PREUVES[1]]})

            retrait = (await client.call_tool("crm_card_label_set", {"card_id": carte, "remove": [PREUVES[0]]})).structured_content
            assert retrait["labels"] == []
            assert (await _service("GET", "/card_labels", params={"card_id": f"eq.{carte}", "select": "card_id"})).json() == []
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    carte = await _catalogue()
    await _poser(FARIDA, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_label_set")
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_label_set", {"card_id": carte, "add": [PREUVES[0]]})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_label_set", "refus_crm")
        assert (await _service("GET", "/card_labels", params={"card_id": f"eq.{carte}", "select": "card_id"})).json() == []
    finally:
        await _retirer(FARIDA, CASES)
        await _nettoyer()

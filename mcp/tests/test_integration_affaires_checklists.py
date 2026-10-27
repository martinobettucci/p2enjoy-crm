# @verifies CRM-068 (docs/BACKLOG.md) — tranche T5 : `crm_card_checklist_list` et `crm_card_checklist_set` contre le vrai
#           Keycloak, la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §13 (succès, refus par la matrice, refus par le CRM malgré la matrice ouverte, journal écrit ;
#           l'effet dans les tables que lit la webapp), §9.2 duodecies ; docs/SPEC-checklists.md §3.2, §5
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le business developer reçoit, par la clé de service, les cases `affaires` consulter, ajouter et modifier ; la lectrice,
consulter et modifier. Elles sont retirées à la fin, et l'affaire créée par la preuve est effacée par la clé de service."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

CHECKLISTS = "5eed0000-0000-4000-8000-0000000c6841"  # channel « Checklists » du seed (docs/SPEC-seed.md §28)
TITRE = "Affaire MCP checklist"
CASES_DRISS = [("affaires", a) for a in ("consulter", "ajouter", "modifier")]
CASES_FARIDA = [("affaires", a) for a in ("consulter", "modifier")]


async def _poser(qui, cases) -> None:
    lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
    assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(qui, cases) -> None:
    for famille, action in cases:
        await _service(
            "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"}
        )


async def _nettoyer() -> None:
    await _service("DELETE", "/cards", params={"title": f"like.{TITRE}*"})


async def _point_du_seed(libelle: str) -> dict:
    """Un point d'étape de « Formation IA — Cerfrance » (§28), lu par la clé de service."""
    lignes = (
        await _service(
            "GET",
            "/card_checklist_items",
            params={"label": f"eq.{libelle}", "select": "id,card_id,checked,checked_by,affaire:cards!inner(title)",
                    "affaire.title": "eq.Formation IA — Cerfrance"},
        )
    ).json()
    assert len(lignes) == 1, lignes
    return lignes[0]


async def test_sans_la_case_modifier_le_cochage_n_existe_pas():
    await _poser(DRISS, [("affaires", "consulter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_card_checklist_list" in noms and "crm_card_checklist_set" not in noms,
                "le cochage reste visible",
            )
    finally:
        await _retirer(DRISS, [("affaires", "consulter")])


async def test_lire_et_cocher_par_le_connecteur():
    await _nettoyer()
    await _poser(DRISS, CASES_DRISS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_checklist_set")
            carte = (await client.call_tool("crm_card_create", {"channel_id": CHECKLISTS, "title": TITRE})).structured_content
            ident = carte["card"]["id"]

            liste = (await client.call_tool("crm_card_checklist_list", {"card_id": ident})).structured_content
            assert await _dernier_journal(DRISS[1]) == ("crm_card_checklist_list", "ok")
            assert liste["current_step_count"] == {"checked": 0, "total": 2}
            [etape] = liste["step_items"]
            assert etape["current"] and [p["label"] for p in etape["items"]] == ["Besoin confirmé", "Décideur identifié"]

            point = etape["items"][0]
            coche = (
                await client.call_tool("crm_card_checklist_set", {"card_id": ident, "item_id": point["item_id"], "checked": True})
            ).structured_content
            assert coche["item"]["checked"] is True
            assert await _dernier_journal(DRISS[1]) == ("crm_card_checklist_set", "ok")
            # La base a posé l'auteur et l'heure, et le fil le dit au nom de la personne.
            en_base = (await _service("GET", "/card_checklist_items", params={
                "id": f"eq.{point['item_id']}", "select": "checked,checked_by,checked_at"})).json()[0]
            assert en_base["checked"] is True and en_base["checked_by"] == DRISS[1] and en_base["checked_at"]
            fil = (await _service("GET", "/card_events", params={
                "card_id": f"eq.{ident}", "type": "eq.checklist_checked", "select": "actor_id"})).json()
            assert fil == [{"actor_id": DRISS[1]}]

            # Relu, le point dit qui l'a coché.
            relue = (await client.call_tool("crm_card_checklist_list", {"card_id": ident})).structured_content
            assert relue["current_step_count"] == {"checked": 1, "total": 2}
            assert relue["step_items"][0]["items"][0]["checked_by"] == "Driss Lemoine"

            # Un point d'une AUTRE affaire, sous l'affaire de la preuve : zéro ligne, donc un refus ; rien n'est écrit.
            ailleurs = await _point_du_seed("Décideur identifié")
            with pytest.raises(ToolError, match="point de checklist"):
                await client.call_tool("crm_card_checklist_set", {"card_id": ident, "item_id": ailleurs["id"], "checked": True})
            assert (await _point_du_seed("Décideur identifié"))["checked"] is False
    finally:
        await _retirer(DRISS, CASES_DRISS)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    """La lectrice lit le channel sans l'écrire : la RLS ne lui ouvre pas le point en écriture. Le refus est uniforme et
    nommé `refus_crm` au journal ; le point reste tel qu'il était."""
    await _poser(FARIDA, CASES_FARIDA)
    point = await _point_du_seed("Décideur identifié")
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_checklist_set")
            liste = (await client.call_tool("crm_card_checklist_list", {"card_id": point["card_id"]})).structured_content
            assert liste["current_step_count"]["total"] == 2
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_checklist_set", {"card_id": point["card_id"], "item_id": point["id"], "checked": True})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_checklist_set", "refus_crm")
        assert await _point_du_seed("Décideur identifié") == point
    finally:
        await _retirer(FARIDA, CASES_FARIDA)

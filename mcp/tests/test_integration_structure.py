# @verifies CRM-104 (docs/BACKLOG.md) — tranche T1 : les outils de structure et la recherche contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 quater (recherche filtrée par la matrice, ni slug ni workflow modifiés)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

L'administratrice (Camille) et le business developer reçoivent, par la clé de service, les cases de la preuve ; elles sont
retirées à la fin, et le track créé par la preuve est effacé par la clé de service."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import EXPLOITANTE, ESPACE_SEEDE, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

CAMILLE = ("admin", "5eed0000-0000-4000-8000-000000000011")
CONSEIL = "5eed0000-0000-4000-8000-000000000021"
GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"
SLUG = "mcp-integration"
STRUCTURE = [("structure", a) for a in ("consulter", "ajouter", "modifier", "supprimer")]


async def _poser(qui, cases) -> None:
    lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
    assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(qui, cases) -> None:
    for famille, action in cases:
        await _service(
            "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"}
        )


async def _nettoyer() -> None:
    await _service("DELETE", "/tracks", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "slug": f"eq.{SLUG}"})


async def test_l_arborescence_lue_creee_modifiee_et_mise_a_la_corbeille_par_l_administratrice():
    await _nettoyer()
    await _poser(CAMILLE, STRUCTURE)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_track_trash")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            tracks = await appeler("crm_track_list", {"workspace": "p2enjoy"})
            assert "conseil-ia" in {t["slug"] for t in tracks["tracks"]}
            track = await appeler("crm_track_get", {"track_id": CONSEIL})
            assert GRANDS_COMPTES in {c["id"] for c in track["channels"]}
            channels = await appeler("crm_channel_list", {"workspace": "p2enjoy", "track_id": CONSEIL})
            assert {c["track_id"] for c in channels["channels"]} == {CONSEIL}
            channel = await appeler("crm_channel_get", {"channel_id": GRANDS_COMPTES})
            assert channel["can_write"] is True and channel["active_cards"] >= 1
            workflow = await appeler("crm_workflow_get", {"workflow_id": channel["workflow"]["id"]})
            assert [e["name"] for e in workflow["steps"]][:3] == ["Prospection", "Relance", "Négociation"]
            perdu = [t for t in workflow["transitions"] if t["to_step"] == "Perdu"]
            assert perdu and all(t["requires_comment"] for t in perdu)

            cree = (await appeler("crm_track_create", {
                "workspace": "p2enjoy", "name": "Track MCP", "slug": SLUG, "color": "accent", "icon": "sparkles",
            }))["track"]
            with pytest.raises(ToolError, match="slug_taken"):
                await client.call_tool("crm_track_create", {
                    "workspace": "p2enjoy", "name": "Doublon", "slug": SLUG, "color": "accent", "icon": "sparkles",
                })
            canal = (await appeler("crm_channel_create", {
                "track_id": cree["id"], "workflow_id": channel["workflow"]["id"], "name": "Channel MCP", "slug": "canal",
            }))["channel"]
            await appeler("crm_track_update", {"track_id": cree["id"], "description": "Créé par le connecteur"})
            await appeler("crm_channel_update", {"channel_id": canal["id"], "name": "Channel MCP renommé"})
            enBase = (await _service("GET", "/channels", params={"id": f"eq.{canal['id']}", "select": "name,workflow_id"})).json()
            assert enBase == [{"name": "Channel MCP renommé", "workflow_id": channel["workflow"]["id"]}]
            await appeler("crm_channel_trash", {"channel_id": canal["id"]})
            await appeler("crm_track_trash", {"track_id": cree["id"]})
            assert (await _service("GET", "/tracks", params={"id": f"eq.{cree['id']}", "select": "deleted_by"})).json() == [
                {"deleted_by": CAMILLE[1]}
            ]
    finally:
        await _retirer(CAMILLE, STRUCTURE)
        await _nettoyer()


async def test_la_recherche_suit_la_matrice_de_chaque_famille():
    await _poser(CAMILLE, [("structure", "consulter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_search")
            # Camille porte `recettes:consulter` (seed §22) et la structure : aucune famille de la recherche n'est ouverte.
            assert (await client.call_tool("crm_search", {"query": "Sogexia"})).structured_content["results"] == []
            await _poser(CAMILLE, [("affaires", "consulter")])
            resultats = (await client.call_tool("crm_search", {"query": "Sogexia"})).structured_content["results"]
            assert resultats and {r["kind"] for r in resultats} <= {"affaire", "commentaire"}
            assert await _dernier_journal(CAMILLE[1]) == ("crm_search", "ok")
    finally:
        await _retirer(CAMILLE, [("structure", "consulter"), ("affaires", "consulter")])


async def test_le_business_developer_est_refuse_par_le_crm_et_la_corbeille_fermee_par_la_matrice():
    cases = [("structure", "consulter"), ("structure", "ajouter"), ("structure", "modifier")]
    await _nettoyer()
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_track_create" in noms and "crm_track_trash" not in noms, "matrice attendue"
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_track_create", {
                    "workspace": "p2enjoy", "name": "Refusé", "slug": SLUG, "color": "accent", "icon": "sparkles",
                })
            assert await _dernier_journal(DRISS[1]) == ("crm_track_create", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_track_update", {"track_id": CONSEIL, "name": "Renommé"})
            assert await _dernier_journal(DRISS[1]) == ("crm_track_update", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_track_trash", {"track_id": CONSEIL})
        assert (await _service("GET", "/tracks", params={"id": f"eq.{CONSEIL}", "select": "name,deleted_at"})).json() == [
            {"name": "Conseil & IA", "deleted_at": None}
        ]
    finally:
        await _retirer(DRISS, cases)
        await _nettoyer()

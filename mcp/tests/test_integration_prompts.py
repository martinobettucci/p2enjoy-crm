# @verifies CRM-102 (docs/BACKLOG.md) — le socle du connecteur, auquel `CRM-149` ajoute la capacité `prompts` (docs/SPEC-mcp.md §2.1)
# @verifies CRM-149 (docs/BACKLOG.md) — tranche T2 : les prompts du connecteur contre le vrai Keycloak, la vraie base et le
#           vrai service `mcp`, par le parcours OAuth réel — `prompts/list` rend les cinq défauts de l'espace du seed,
#           `prompts/get` rend le texte de la base avec son en-tête d'espace, un prompt ajouté puis modifié en base est relu
#           à l'appel suivant, la ligne `prompt:<clé>` est inscrite au journal ; la superadministratrice, qui n'est membre
#           d'aucun espace, n'en voit aucun
# @verifies docs/SPEC-mcp.md §17.5, §17.9 (ligne « Intégration MCP ») ; docs/JOURNAL.md décision 930
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

La preuve pose son propre prompt sous la clé de service, dans l'espace du seed, et le retire à la fin."""

from __future__ import annotations

import uuid

from fastmcp import Client

from .parcours_oauth import CAMILLE, SABINE
from .test_integration_oauth import MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import _dernier_journal, _jeton

ESPACE = "5eed0000-0000-4000-8000-000000000001"
DEFAUTS = {"creer-une-affaire", "faire-le-point", "faire-avancer", "retrouver-une-affaire", "enregistrer-une-recette-reelle"}


async def _espace() -> tuple[str, str]:
    [ligne] = (await _service("GET", "/workspaces", params={"id": f"eq.{ESPACE}", "select": "slug,name"})).json()
    return ligne["slug"], ligne["name"]


async def _corps(cle: str) -> str:
    [ligne] = (await _service("GET", "/mcp_prompts", params={
        "workspace_id": f"eq.{ESPACE}", "key": f"eq.{cle}", "select": "body"})).json()
    return ligne["body"]


async def test_camille_liste_et_obtient_les_prompts_de_son_espace():
    slug, nom = await _espace()
    async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
        assert client.server_capabilities is not None and client.server_capabilities.prompts is not None
        liste = {p.name: p for p in await client.list_prompts()}
        assert DEFAUTS <= set(liste)
        assert liste["faire-le-point"].title == "Faire le point sur une affaire"
        assert liste["faire-le-point"].description.startswith("Résume une affaire")
        assert not liste["faire-le-point"].arguments

        resultat = await client.get_prompt("faire-le-point")
        [message] = resultat.messages
        assert message.role == "user"
        assert message.content.text == f"Espace : {nom} (workspace : {slug})\n\n{await _corps('faire-le-point')}"
        assert "crm_card_revenue_list" in message.content.text
    assert await _dernier_journal(CAMILLE[1]) == ("prompt:faire-le-point", "ok")


async def test_un_prompt_ajoute_puis_modifie_en_base_est_relu():
    cle = f"zz-integration-{uuid.uuid4().hex[:8]}"
    pose = await _service("POST", "/mcp_prompts", json={
        "workspace_id": ESPACE, "key": cle, "title": "Preuve d'intégration", "description": "Un prompt de la preuve.",
        "body": "Première version."})
    assert pose.status_code == 201, pose.text
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            assert cle in {p.name for p in await client.list_prompts()}
            assert (await client.get_prompt(cle)).messages[0].content.text.endswith("\n\nPremière version.")

            revue = await _service("PATCH", "/mcp_prompts", params={"workspace_id": f"eq.{ESPACE}", "key": f"eq.{cle}"},
                                   json={"body": "Deuxième version.\n1. Une étape."})
            assert revue.status_code == 204, revue.text
            assert (await client.get_prompt(cle)).messages[0].content.text.endswith("\n\nDeuxième version.\n1. Une étape.")
        assert await _dernier_journal(CAMILLE[1]) == (f"prompt:{cle}", "ok")
    finally:
        await _service("DELETE", "/mcp_prompts", params={"workspace_id": f"eq.{ESPACE}", "key": f"eq.{cle}"})


async def test_la_superadministratrice_non_membre_ne_voit_aucun_prompt():
    # Sabine franchit la matrice, jamais la RLS : membre d'aucun espace, elle ne lit aucun prompt (§17.5).
    async with Client(f"{MCP}/mcp", auth=await _jeton(SABINE)) as client:
        assert await client.list_prompts() == []

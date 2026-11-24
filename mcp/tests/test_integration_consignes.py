# @verifies CRM-165 (docs/BACKLOG.md) — tranche T2 : les consignes de la plateforme contre la vraie base et le vrai service
#           `mcp`, par le parcours OAuth réel — le texte écrit par la super-administratrice (par la vraie fonction) suit le
#           socle à la connexion suivante ; un texte changé vaut à la connexion d'après ; vide, le socle part seul ; le
#           service a publié son socle au démarrage
# @verifies docs/SPEC-mcp.md §18.1, §18.3, §18.4 ; décisions 980 et 983
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le texte d'origine de la plateforme (celui du seed, docs/SPEC-seed.md §56) est relu avant, et rendu à la fin."""

from __future__ import annotations

import os
import time

import httpx2
from fastmcp import Client

from crm_mcp.application import INSTRUCTIONS
from crm_mcp.consignes import assembler
from crm_mcp.jeton_interne import Identite, frapper

from .parcours_oauth import API, SABINE
from .test_integration_oauth import MCP, pytestmark  # noqa: F401
from .test_integration_recettes import _jeton


async def _rpc_sabine(fonction: str, arguments: dict | None = None) -> httpx2.Response:
    """La vraie fonction de la plateforme, sous le jeton de la super-administratrice : jamais la table."""
    jeton = frapper(os.environ["JWT_SECRET"], Identite(SABINE[1], None, None, True, False, None), int(time.time()))
    async with httpx2.AsyncClient(base_url=f"{API}/rest/v1", timeout=10) as http:
        return await http.post(f"/rpc/{fonction}", json=arguments or {}, headers={
            "apikey": os.environ["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {jeton}"})


async def _etat() -> dict:
    reponse = await _rpc_sabine("platform_connector_instructions")
    assert reponse.status_code == 200, reponse.text
    [ligne] = reponse.json()
    return ligne


async def _poser(texte: str) -> None:
    reponse = await _rpc_sabine("platform_set_connector_instructions", {"p_body": texte})
    assert reponse.status_code in (200, 204), reponse.text


async def _consignes_recues() -> str:
    async with Client(f"{MCP}/mcp", auth=await _jeton(SABINE)) as client:
        assert client.instructions is not None
        return client.instructions


async def test_le_service_a_publie_son_socle_au_demarrage():
    etat = await _etat()
    assert etat["base"] == INSTRUCTIONS
    assert etat["base_published_at"] is not None


async def test_le_texte_de_la_plateforme_suit_le_socle_et_vaut_a_la_connexion_suivante():
    origine = (await _etat())["body"]
    try:
        await _poser("Preuve d'intégration : répondez en français.\nCitez toujours l'affaire.")
        assert await _consignes_recues() == assembler(
            INSTRUCTIONS, "Preuve d'intégration : répondez en français.\nCitez toujours l'affaire.")

        await _poser("Preuve d'intégration : seconde version.")
        recues = await _consignes_recues()
        assert recues == assembler(INSTRUCTIONS, "Preuve d'intégration : seconde version.")
        assert "Citez toujours l'affaire." not in recues

        await _poser("")
        assert await _consignes_recues() == INSTRUCTIONS
    finally:
        await _poser(origine)

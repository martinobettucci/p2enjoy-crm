# @verifies CRM-112 (docs/BACKLOG.md) — tranche T9 : les champs de l'affaire par le connecteur contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp` — `crm_common_field_list`, la partie commune de `crm_card_get`, l'écriture
#           de `crm_card_update` (insertion puis mise à jour, sous les politiques et `app.validate_field_value`), le filtre
#           de `crm_card_list`, les refus nommés et le refus uniforme de la lectrice (docs/SPEC-mcp.md §9.2 sexdecies, §13 ;
#           docs/SPEC-champs-communs.md §7, §8, §11 ; décision 846)
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue de la famille `affaires` (docs/SPEC-mcp.md §9.2 bis), où T9 inscrit
#           `crm_common_field_list`
# @verifies CRM-112 T9, correctif (docs/BACKLOG.md) — la preuve attend tous ses outils, et ne dépend plus de l'ordre des
#           fichiers de `scripts/verify-mcp.sh` (docs/SPEC-mcp.md §13 ; la visibilité retenue, `DUREE_VISIBILITE_S`)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le seed ne définit pas encore de champ de l'affaire (`CRM-112` T8) : la preuve pose les siens par la clé de service, sous
des clés `mcp-t9-*` qu'aucun écran ni aucune autre preuve n'emploie, et les efface à la fin avec l'affaire qu'elle crée ;
la cascade emporte leurs valeurs. La matrice est rendue telle qu'elle était."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _dernier_journal, _jeton

GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"
SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"
TITRE = "Affaire MCP champs communs"
CASES = [("affaires", a) for a in ("consulter", "ajouter", "modifier", "supprimer")]
#: Les outils que la preuve appelle sous le jeton de Driss : elle attend qu'ils soient tous visibles avant le premier appel.
OUTILS_DRISS = {"crm_common_field_list", "crm_card_create", "crm_card_update", "crm_card_get", "crm_card_list"}
CHAMPS = [
    {"key": "mcp-t9-siret", "label": "SIRET (preuve MCP)", "type": "text", "position": 9001},
    {"key": "mcp-t9-segment", "label": "Segment (preuve MCP)", "type": "select", "position": 9002,
     "options": {"choices": [{"key": "pme", "label": "PME"}, {"key": "eti", "label": "ETI"}]}},
    {"key": "mcp-t9-ancien", "label": "Ancien code (preuve MCP)", "type": "text", "position": 9003},
]


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
    await _service("DELETE", "/card_common_fields", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "key": "like.mcp-t9-*"})


async def _definir() -> dict[str, str]:
    reponse = await _service(
        "POST", "/card_common_fields", json=[{"workspace_id": ESPACE_SEEDE, "options": {}, **c} for c in CHAMPS]
    )
    assert reponse.status_code == 201, reponse.text
    lus = await _service("GET", "/card_common_fields", params={
        "workspace_id": f"eq.{ESPACE_SEEDE}", "key": "like.mcp-t9-*", "select": "id,key"})
    return {c["key"]: c["id"] for c in lus.json()}


async def _valeurs(card_id: str) -> dict[str, object]:
    lignes = (await _service("GET", "/card_common_field_values", params={
        "card_id": f"eq.{card_id}", "select": "value,champ:card_common_fields(key)"})).json()
    return {l["champ"]["key"]: l["value"] for l in lignes}


async def test_lire_ecrire_et_filtrer_les_champs_de_l_affaire_par_le_connecteur():
    await _nettoyer()
    ids = await _definir()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            # Tous les outils de la preuve, et non le premier : la visibilité retenue par le service (`DUREE_VISIBILITE_S`)
            # peut encore porter la matrice d'une preuve précédente, qui ouvrait la consultation sans l'ajout — la liste
            # montrait alors `crm_common_field_list` sans `crm_card_create` (défaut trouvé par la campagne complète).
            await _attendre_outils(client, lambda noms: OUTILS_DRISS <= noms, "outils de la preuve invisibles")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            ident = (await appeler("crm_card_create", {"channel_id": GRANDS_COMPTES, "title": TITRE}))["card"]["id"]
            # Une valeur posée avant l'archivage, qui reste lisible ensuite (§9.2 sexdecies).
            await appeler("crm_card_update", {"card_id": ident, "common_fields": {"mcp-t9-ancien": "X-12"}})
            assert (await _service("PATCH", "/card_common_fields", params={"id": f"eq.{ids['mcp-t9-ancien']}"},
                                   json={"archived_at": "2026-11-01T00:00:00+00:00"})).status_code == 204

            definis = await appeler("crm_common_field_list", {"workspace": "p2enjoy"})
            cles = [c["key"] for c in definis["fields"] if c["key"].startswith("mcp-t9-")]
            assert cles == ["mcp-t9-siret", "mcp-t9-segment"]
            segment = next(c for c in definis["fields"] if c["key"] == "mcp-t9-segment")
            assert segment["choices"] == [{"key": "pme", "label": "PME"}, {"key": "eti", "label": "ETI"}]
            tous = await appeler("crm_common_field_list", {"workspace": "p2enjoy", "include_archived": True})
            assert {"mcp-t9-ancien": True} == {c["key"]: c["archived"] for c in tous["fields"] if c["key"] == "mcp-t9-ancien"}

            # L'insertion, puis la mise à jour de la même ligne, sous les politiques de l'écran.
            await appeler("crm_card_update", {"card_id": ident, "common_fields": {"mcp-t9-siret": "55210055400013",
                                                                                  "mcp-t9-segment": "pme"}})
            await appeler("crm_card_update", {"card_id": ident, "common_fields": {"mcp-t9-siret": "11122233300044"}})
            assert await _valeurs(ident) == {"mcp-t9-siret": "11122233300044", "mcp-t9-segment": "pme", "mcp-t9-ancien": "X-12"}

            fiche = await appeler("crm_card_get", {"card_id": ident})
            miennes = [(l["key"], l["value"], l["archived"]) for l in fiche["common_fields"] if l["key"].startswith("mcp-t9-")]
            assert miennes == [
                ("mcp-t9-siret", "11122233300044", False), ("mcp-t9-segment", "pme", False), ("mcp-t9-ancien", "X-12", True)
            ]
            assert next(l for l in fiche["common_fields"] if l["key"] == "mcp-t9-segment")["value_label"] == "PME"

            trouvees = await appeler("crm_card_list", {"workspace": "p2enjoy", "common_fields": {
                "mcp-t9-segment": {"any_of": ["pme"]}, "mcp-t9-siret": {"contains": "2223"}}})
            assert [c["id"] for c in trouvees["cards"]] == [ident]
            aucune = await appeler("crm_card_list", {"workspace": "p2enjoy", "common_fields": {
                "mcp-t9-segment": {"any_of": ["eti"]}}})
            assert aucune["cards"] == []

            # Les refus nommés : la base pour une valeur hors choix, le connecteur pour un champ archivé ou inconnu.
            with pytest.raises(ToolError, match="invalid_field_value — the value of 'mcp-t9-segment'"):
                await client.call_tool("crm_card_update", {"card_id": ident, "common_fields": {"mcp-t9-segment": "geant"}})
            assert await _dernier_journal(DRISS[1]) == ("crm_card_update", "refus_crm")
            with pytest.raises(ToolError, match="common_field_archived"):
                await client.call_tool("crm_card_update", {"card_id": ident, "title": f"{TITRE} renommée",
                                                           "common_fields": {"mcp-t9-ancien": "Y"}})
            with pytest.raises(ToolError, match="Unknown or archived field key 'mcp-t9-ancien'"):
                await client.call_tool("crm_card_list", {"workspace": "p2enjoy", "common_fields": {
                    "mcp-t9-ancien": {"contains": "X"}}})
            assert await _valeurs(ident) == {"mcp-t9-siret": "11122233300044", "mcp-t9-segment": "pme", "mcp-t9-ancien": "X-12"}
            titre = (await _service("GET", "/cards", params={"id": f"eq.{ident}", "select": "title"})).json()
            assert titre == [{"title": TITRE}]

            # `null` vide la valeur.
            await appeler("crm_card_update", {"card_id": ident, "common_fields": {"mcp-t9-siret": None}})
            assert (await _valeurs(ident))["mcp-t9-siret"] is None
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_la_lectrice_ne_peut_pas_ecrire_un_champ_de_l_affaire_malgre_la_matrice_ouverte():
    """Farida, la famille ouverte : « Sogexia » ne s'écrit pas pour elle ; le refus est uniforme, rien n'est écrit."""
    await _nettoyer()
    await _definir()
    await _poser(FARIDA, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(client, lambda noms: "crm_card_update" in noms, "crm_card_update reste invisible")
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_update", {"card_id": SOGEXIA, "common_fields": {"mcp-t9-siret": "1"}})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_update", "refus_crm")
        assert not [k for k in await _valeurs(SOGEXIA) if k.startswith("mcp-t9-")]
    finally:
        await _retirer(FARIDA, CASES)
        await _nettoyer()

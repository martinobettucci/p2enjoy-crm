# @verifies CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations` contre le vrai
#           Keycloak, la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 sexies (dont la décision 666 : `crm_search` filtre les organisations par leur famille) ;
#           docs/SPEC-organisations.md §3, §5
# @verifies CRM-152 (docs/BACKLOG.md) — tranche T3 : `crm_organization_list` sur la vraie base — les tracks de chaque
#           organisation par ses contacts, le filtre par track (l'un d'eux), la recherche dans le site web, `total`
#           (docs/SPEC-mcp.md §9.2 tervicies ; docs/SPEC-organisations.md §8.1, §8.4)
# @verifies CRM-153 (docs/BACKLOG.md) — tranche T5 : le catalogue, poser et retirer (l'archivée nommée), la liste filtrée par
#           catégorie, la fiche, le fil — publier, mentionner (la notification posée), lire — sur la vraie base et le vrai
#           service, par le parcours OAuth réel ; la lectrice refusée par le CRM (docs/SPEC-mcp.md §9.2 quatervicies ;
#           docs/SPEC-organisations.md §9.4). L'attente exacte de Comptoir Vasseur est RÉVISÉE le 2026-11-18 : `categories`.
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Les cases de la preuve sont posées par la clé de service et retirées à la fin ; l'organisation créée est effacée."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

VASSEUR = "5eed0000-0000-4000-8000-000000000083"
FORMATION = "5eed0000-0000-4000-8000-000000000023"
SOGEXIA = "5eed0000-0000-4000-8000-000000000081"
NOM = "Organisation MCP intégration"
CASES = [("organizations", a) for a in ("consulter", "ajouter", "modifier")]


async def _nettoyer() -> None:
    await _service("DELETE", "/organizations", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "name": f"like.{NOM}*"})


async def test_lister_lire_creer_et_modifier_une_organisation():
    await _nettoyer()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_organization_update")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            liste = await appeler("crm_organization_list", {"workspace": "p2enjoy"})
            par_id = {o["id"]: o for o in liste["organizations"]}
            # RÉVISÉE par `CRM-152` T3 : chaque organisation rend ses tracks — aucun pour une organisation sans contact.
            assert par_id[VASSEUR] == {"id": VASSEUR, "name": "Comptoir Vasseur", "domain": "comptoir-vasseur.example",
                                       "website": None, "contacts": 0, "tracks": [], "categories": []}
            assert liste["total"] == len(liste["organizations"]) and liste["has_more"] is False
            vertigo = next(o for o in liste["organizations"] if o["name"] == "Vertigo Conseil")
            assert [t["slug"] for t in vertigo["tracks"]] == ["conseil-ia", "formation"]
            assert [t["slug"] for t in par_id[SOGEXIA]["tracks"]] == ["conseil-ia"]
            # `CRM-152` : l'un des tracks donnés, et la recherche dans le site web.
            par_track = await appeler("crm_organization_list", {"workspace": "p2enjoy", "tracks": [FORMATION]})
            assert [o["name"] for o in par_track["organizations"]] == ["Vertigo Conseil"] and par_track["total"] == 1
            par_site = await appeler("crm_organization_list", {"workspace": "p2enjoy", "query": "www.sogexia"})
            assert [o["id"] for o in par_site["organizations"]] == [SOGEXIA]
            # Deux depuis CRM-071 T5 (décision 51) : Lucas Fontaine, importé par le seed (docs/SPEC-seed.md §33), rejoint Léo.
            assert par_id[SOGEXIA]["contacts"] == 2
            assert [o["id"] for o in (await appeler("crm_organization_list", {"workspace": "p2enjoy", "query": "vasseur"}))["organizations"]] == [VASSEUR]
            fiche = await appeler("crm_organization_get", {"organization_id": SOGEXIA})
            assert sorted(c["full_name"] for c in fiche["contacts"]) == ["Lucas Fontaine", "Léo Marchand"]  # ordre non promis

            cree = (await appeler("crm_organization_create", {
                "workspace": "p2enjoy", "name": NOM, "domain": "MCP-Integration.Example", "website": "https://mcp.example",
            }))["organization"]
            assert cree["domain"] == "mcp-integration.example"
            modifie = (await appeler("crm_organization_update", {
                "organization_id": cree["id"], "name": f"{NOM} renommée", "website": "",
            }))["organization"]
            assert modifie["website"] is None
            en_base = (await _service("GET", "/organizations", params={"id": f"eq.{cree['id']}", "select": "name,domain,website"})).json()
            assert en_base == [{"name": f"{NOM} renommée", "domain": "mcp-integration.example", "website": None}]

            with pytest.raises(ToolError, match="domain_taken"):
                await client.call_tool("crm_organization_create", {"workspace": "p2enjoy", "name": NOM, "domain": "sogexia.example"})
            assert await _dernier_journal(DRISS[1]) == ("crm_organization_create", "refus_crm")
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_la_lectrice_est_refusee_par_le_crm_et_la_matrice_ferme_la_modification():
    await _nettoyer()
    cases = [("organizations", "consulter"), ("organizations", "ajouter")]
    await _poser(FARIDA, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_organization_create" in noms and "crm_organization_update" not in noms,
                "matrice attendue",
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_organization_create", {"workspace": "p2enjoy", "name": NOM})
            assert await _dernier_journal(FARIDA[1]) == ("crm_organization_create", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_organization_update", {"organization_id": VASSEUR, "name": "Réécrite"})
        assert (await _service("GET", "/organizations", params={"name": f"like.{NOM}*", "select": "id"})).json() == []
        assert (await _service("GET", "/organizations", params={"id": f"eq.{VASSEUR}", "select": "name"})).json() == [
            {"name": "Comptoir Vasseur"}
        ]
    finally:
        await _retirer(FARIDA, cases)
        await _nettoyer()


async def test_la_recherche_ne_rend_les_organisations_qu_a_leur_famille():
    """Décision 666 : `contacts:consulter` n'ouvre plus les organisations de `crm_search`."""
    await _poser(DRISS, [("contacts", "consulter")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_search")
            sans = (await client.call_tool("crm_search", {"query": "Comptoir Vasseur"})).structured_content
            assert [r for r in sans["results"] if r["kind"] == "organisation"] == []
        await _poser(DRISS, [("organizations", "consulter")])
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_organization_get")
            avec = (await client.call_tool("crm_search", {"query": "Comptoir Vasseur"})).structured_content
            assert VASSEUR in {r["id"] for r in avec["results"] if r["kind"] == "organisation"}
    finally:
        await _retirer(DRISS, [("contacts", "consulter"), ("organizations", "consulter")])


# --- `CRM-153` T5 : les catégories et le fil d'une organisation ---------------------------------------------------------

PREFIXE_T5 = "ZZ 153 MCP"
CAMILLE_ID = "5eed0000-0000-4000-8000-000000000011"


async def _nettoyer_t5() -> None:
    commentaires = (await _service("GET", "/organization_comments", params={
        "organization_id": f"eq.{VASSEUR}", "select": "id"})).json()
    if commentaires:
        ids = ",".join(c["id"] for c in commentaires)
        await _service("DELETE", "/notifications", params={"payload->>comment_id": f"in.({ids})"})
        await _service("DELETE", "/organization_comments", params={"organization_id": f"eq.{VASSEUR}"})
    await _service("DELETE", "/organization_categories", params={"name": f"like.{PREFIXE_T5}*"})


async def _categorie(nom: str, archivee: bool = False) -> str:
    corps = {"workspace_id": ESPACE_SEEDE, "name": nom, "color": "brand"}
    assert (await _service("POST", "/organization_categories", json=corps)).status_code == 201
    if archivee:
        await _service("PATCH", "/organization_categories", params={"name": f"eq.{nom}"},
                       json={"archived_at": "2026-11-18T00:00:00Z"})
    return (await _service("GET", "/organization_categories", params={"name": f"eq.{nom}", "select": "id"})).json()[0]["id"]


async def test_categories_et_fil_d_une_organisation():
    await _nettoyer_t5()
    client_id = await _categorie(f"{PREFIXE_T5} Client")
    ancien = await _categorie(f"{PREFIXE_T5} Ancien", archivee=True)
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_organization_categories_set")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            catalogue = await appeler("crm_organization_category_list", {"workspace": "p2enjoy"})
            nos = [c for c in catalogue["categories"] if c["name"].startswith(PREFIXE_T5)]
            assert nos == [{"id": client_id, "name": f"{PREFIXE_T5} Client", "archived": False},
                           {"id": ancien, "name": f"{PREFIXE_T5} Ancien", "archived": True}]

            pose = await appeler("crm_organization_categories_set",
                                 {"organization_id": VASSEUR, "add": [client_id, ancien]})
            assert pose["categories"] == [{"id": client_id, "name": f"{PREFIXE_T5} Client", "archived": False}]
            assert pose["refused"] == [{"id": ancien, "action": "add", "refused": "category_archived"}]
            en_base = (await _service("GET", "/organization_category_links", params={
                "organization_id": f"eq.{VASSEUR}", "select": "category_id,created_by"})).json()
            assert en_base == [{"category_id": client_id, "created_by": DRISS[1]}]

            filtree = await appeler("crm_organization_list", {"workspace": "p2enjoy", "categories": [client_id]})
            assert [o["id"] for o in filtree["organizations"]] == [VASSEUR]
            assert (await appeler("crm_organization_get", {"organization_id": VASSEUR}))["categories"][0]["id"] == client_id

            publie = await appeler("crm_organization_comment_add", {
                "organization_id": VASSEUR, "body": "Relance par l'assistant.", "mentions": [CAMILLE_ID]})
            assert publie["mentions"] == [{"profile_id": CAMILLE_ID, "ok": True}]
            notification = (await _service("GET", "/notifications", params={
                "payload->>comment_id": f"eq.{publie['comment']['id']}", "select": "recipient_id,subject_organization_id,type"})).json()
            assert notification == [{"recipient_id": CAMILLE_ID, "subject_organization_id": VASSEUR, "type": "mention"}]
            fil = await appeler("crm_organization_comment_list", {"organization_id": VASSEUR})
            assert [(c["body"], c["author"]["id"], c["deleted"]) for c in fil["comments"]] == [
                ("Relance par l'assistant.", DRISS[1], False)]

            retrait = await appeler("crm_organization_categories_set", {"organization_id": VASSEUR, "remove": [client_id]})
            assert retrait == {"categories": [], "refused": []}
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer_t5()


async def test_la_lectrice_lit_le_fil_mais_le_crm_refuse_qu_elle_commente():
    await _nettoyer_t5()
    cases = [("organizations", "consulter"), ("organizations", "ajouter")]
    await _poser(FARIDA, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_organization_comment_add")
            assert (await client.call_tool("crm_organization_comment_list", {"organization_id": VASSEUR})).structured_content[
                "comments"] == []
            with pytest.raises(ToolError):
                await client.call_tool("crm_organization_comment_add", {"organization_id": VASSEUR, "body": "Lectrice."})
            assert await _dernier_journal(FARIDA[1]) == ("crm_organization_comment_add", "refus_crm")
        assert (await _service("GET", "/organization_comments", params={
            "organization_id": f"eq.{VASSEUR}", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, cases)
        await _nettoyer_t5()


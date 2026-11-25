# @verifies CRM-161 (docs/BACKLOG.md) — tranche T4 : le connecteur contre la vraie base, le vrai Keycloak et le vrai service
#           `mcp`, avec Camille, membre des DEUX espaces du seed (« P2Enjoy SAS » et « Studio Lumen », docs/SPEC-seed.md §55) :
#           le mail préparé dans chaque espace rend `{origine}/<slug>/inbox?brouillon=…` ; la liste des mails préparés d'un
#           espace ne rend que les siens ; les listes d'un espace ne rendent aucune ligne de l'autre ; `crm_search` rend le
#           `workspace_id` de chaque résultat (les deux espaces pour un nom partagé) ;
#           docs/SPEC-espace-courant.md §11, §17.2, §17.3, §17.4 ; docs/SPEC-mcp.md §9.2 « L'espace courant » ;
#           docs/SPEC-mails-prepares.md §6.1 ; décisions 965 et 998
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2, §13) : les outils d'un espace nommé
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LE SEED : « Studio Lumen » (§55) porte le track « Productions », le contact « Inès Arlo », l'organisation « Maison Arlo »
et l'affaire « Clip — Maison Arlo » ; « Vertigo Conseil » existe dans les deux espaces (homonyme, §54). Camille reçoit, par
la clé de service, les cases de la preuve dans chaque espace, et une identité d'envoi prêtée dans « Studio Lumen » (qui n'en
a pas) ; tout est retiré à la fin, ainsi que les mails préparés."""

from __future__ import annotations

from fastmcp import Client

from .parcours_oauth import CAMILLE
from .test_integration_oauth import ESPACE_SEEDE, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import _attendre_outils, _dernier_journal, _jeton

CARD_P2ENJOY = "5eed0000-0000-4000-8000-0000000000c1"
CORPS = "Preuve d'intégration CRM-161 T4."
LIBELLE_IDENTITE = "preuve-161-t4"
CASES = [
    ("messagerie", "consulter"), ("messagerie", "ajouter"), ("messagerie", "supprimer"), ("affaires", "consulter"),
    ("structure", "consulter"),
    ("contacts", "consulter"), ("organizations", "consulter"),
]


async def _espace_lumen() -> str:
    lignes = (await _service("GET", "/workspaces", params={"slug": "eq.studio-lumen", "select": "id"})).json()
    assert len(lignes) == 1, "le seed §55 (« Studio Lumen ») manque : rejouer le seed"
    return lignes[0]["id"]


async def _carte_lumen(espace: str) -> str:
    lignes = (await _service("GET", "/cards", params={
        "workspace_id": f"eq.{espace}", "title": "eq.Clip — Maison Arlo", "select": "id"})).json()
    assert len(lignes) == 1
    return lignes[0]["id"]


async def _poser(espaces: list[str]) -> list[tuple[str, str, str]]:
    """Les cases de la preuve que Camille n'a pas déjà dans chaque espace ; rendues pour être retirées."""
    posees: list[tuple[str, str, str]] = []
    for espace in espaces:
        tenues = (await _service("GET", "/mcp_droits", params={
            "sub": f"eq.{CAMILLE[1]}", "workspace_id": f"eq.{espace}", "select": "famille,action"})).json()
        deja = {(d["famille"], d["action"]) for d in tenues}
        for famille, action in CASES:
            if (famille, action) not in deja:
                posees.append((espace, famille, action))
    if posees:
        lignes = [{"sub": CAMILLE[1], "workspace_id": e, "famille": f, "action": a} for e, f, a in posees]
        assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201
    return posees


async def _retirer(posees: list[tuple[str, str, str]]) -> None:
    for espace, famille, action in posees:
        await _service("DELETE", "/mcp_droits", params={
            "sub": f"eq.{CAMILLE[1]}", "workspace_id": f"eq.{espace}", "famille": f"eq.{famille}", "action": f"eq.{action}"})


async def _nettoyer() -> None:
    await _service("DELETE", "/mail_drafts", params={"body_text": f"like.{CORPS}*"})
    await _service("DELETE", "/mail_outbound_identities", params={"label": f"eq.{LIBELLE_IDENTITE}"})


async def test_le_lien_de_relecture_porte_le_slug_de_l_espace_du_mail_prepare():
    await _nettoyer()
    lumen = await _espace_lumen()
    carte_lumen = await _carte_lumen(lumen)
    posees = await _poser([ESPACE_SEEDE, lumen])
    # « Studio Lumen » n'a pas d'identité d'envoi pour Camille : la preuve lui en prête une, retirée à la fin.
    reponse = await _service("POST", "/mail_outbound_identities", json={
        "workspace_id": lumen, "owner_id": CAMILLE[1], "label": LIBELLE_IDENTITE, "smtp_host": "smtp.exemple.test",
        "smtp_port": 587, "smtp_username": "preuve-161-t4", "from_address": "preuve-161-t4@exemple.test"})
    assert reponse.status_code == 201
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_outils(
                client, lambda noms: {"crm_mail_prepare", "crm_mail_draft_list", "crm_mail_draft_discard"} <= noms, "les outils de messagerie restent invisibles"
            )

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            chez_p2enjoy = await appeler("crm_mail_prepare", {
                "card_id": CARD_P2ENJOY, "to": ["client@exterieur.test"], "subject": "T4 P2Enjoy", "body": CORPS})
            chez_lumen = await appeler("crm_mail_prepare", {
                "card_id": carte_lumen, "to": ["client@exterieur.test"], "subject": "T4 Lumen", "body": CORPS})
            for rendu, slug in ((chez_p2enjoy, "p2enjoy"), (chez_lumen, "studio-lumen")):
                assert rendu["review_url"].endswith(f"/{slug}/inbox?brouillon={rendu['draft_id']}"), rendu["review_url"]
                assert "/inbox?brouillon=" in rendu["review_url"] and rendu["review_url"].count("/inbox") == 1
            # L'ESPACE DU LIEN EST CELUI DU MAIL PRÉPARÉ EN BASE.
            lignes = (await _service("GET", "/mail_drafts", params={
                "id": f"in.({chez_p2enjoy['draft_id']},{chez_lumen['draft_id']})", "select": "id,workspace_id"})).json()
            assert {l["id"]: l["workspace_id"] for l in lignes} == {
                chez_p2enjoy["draft_id"]: ESPACE_SEEDE, chez_lumen["draft_id"]: lumen}

            # LA LISTE D'UN ESPACE NE RENDE QUE LES SIENS, avec le lien de SON espace.
            liste_p2enjoy = await appeler("crm_mail_draft_list", {"workspace": "p2enjoy"})
            liste_lumen = await appeler("crm_mail_draft_list", {"workspace": "studio-lumen"})
            assert chez_p2enjoy["draft_id"] in {d["id"] for d in liste_p2enjoy["drafts"]}
            assert chez_lumen["draft_id"] not in {d["id"] for d in liste_p2enjoy["drafts"]}
            assert [d["id"] for d in liste_lumen["drafts"]] == [chez_lumen["draft_id"]]
            assert all("/p2enjoy/inbox?" in d["review_url"] for d in liste_p2enjoy["drafts"])
            assert liste_lumen["drafts"][0]["review_url"] == chez_lumen["review_url"]

            await appeler("crm_mail_draft_discard", {"draft_id": chez_p2enjoy["draft_id"]})
            await appeler("crm_mail_draft_discard", {"draft_id": chez_lumen["draft_id"]})
    finally:
        await _nettoyer()
        await _retirer(posees)


async def test_les_listes_d_un_espace_ne_rendent_aucune_ligne_de_l_autre_et_la_recherche_dit_l_espace_de_chaque_resultat():
    lumen = await _espace_lumen()
    posees = await _poser([ESPACE_SEEDE, lumen])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_outils(client, lambda noms: "crm_track_list" in noms, "crm_track_list reste invisible")

            async def appeler(outil: str, arguments: dict) -> dict:
                return (await client.call_tool(outil, arguments)).structured_content

            # (outil, argument, clé de la liste, champ du libellé, ce qui n'existe que dans « Studio Lumen »)
            for outil, cle, champ, propre_a_lumen in (
                ("crm_track_list", "tracks", "name", "Productions"),
                ("crm_contact_list", "contacts", "full_name", "Inès Arlo"),
                ("crm_organization_list", "organizations", "name", "Maison Arlo"),
                ("crm_card_list", "cards", "title", "Clip — Maison Arlo"),
            ):
                chez_lumen = [r[champ] for r in (await appeler(outil, {"workspace": "studio-lumen"}))[cle]]
                chez_p2enjoy = [r[champ] for r in (await appeler(outil, {"workspace": "p2enjoy"}))[cle]]
                assert propre_a_lumen in chez_lumen, (outil, chez_lumen)
                assert propre_a_lumen not in chez_p2enjoy, (outil, chez_p2enjoy)

            # LES DEUX OUTILS MULTI-ESPACES : chaque résultat porte son espace ; un nom partagé rend les deux espaces.
            recherche = await appeler("crm_search", {"query": "Vertigo Conseil"})
            assert {r["workspace_id"] for r in recherche["results"]} == {ESPACE_SEEDE, lumen}
            assert all(isinstance(r["workspace_id"], str) for r in recherche["results"])
            espaces = {e["slug"]: e["id"] for e in (await appeler("crm_workspace_list", {}))["workspaces"]}
            assert espaces["p2enjoy"] == ESPACE_SEEDE and espaces["studio-lumen"] == lumen
    finally:
        await _retirer(posees)

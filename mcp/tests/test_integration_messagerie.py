# @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : les trois outils de la famille `messagerie` contre le vrai Keycloak,
#           la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 decies (le fil dans l'ordre ; l'envoi, révisé par `CRM-128` : préparé, jamais en file)
# @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : `read` est l'état DE LA PERSONNE, lu dans la vraie base, et lire par le
#           connecteur n'écrit aucune lecture ; docs/SPEC-mail-subsystem.md §18 bis.5 ; décision 708 (M1 B)
# @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : la copie cachée du connecteur arrive dans la vraie file ;
#           docs/SPEC-mail-subsystem.md §19 bis.2 point 9 ; décision 708 (M2 B)
# @verifies CRM-074 (docs/BACKLOG.md) — tranche T4 : une pièce saine lue en binaire par Driss sous son propre jeton, par la
#           vraie API de stockage et sa politique (migration 0029) ; une pièce infectée refusée ; la lectrice, à qui la RLS
#           cache l'affaire, refusée ; docs/SPEC-pieces-jointes.md §6 ; décisions 788 et 789
# @verifies CRM-128 (docs/BACKLOG.md) — tranche T3 : préparer ne fait rien partir (le mail préparé en base, aucune ligne en
#           file), lister et écarter, la personne seule ; et, EN CONTOURNANT LE CATALOGUE, le jeton frappé par le code du
#           connecteur refusé par la base sur `queue_outbound_email`, `send_email_draft` et `armer_sequence_relance`
#           (`review_required`, rien d'écrit) ; docs/SPEC-mails-prepares.md §4.2, §5, §8 ; décision 829 ; CLAUDE.md §10
# @verifies CRM-137 (docs/BACKLOG.md) — les deux outils du classement, `crm_mail_classification_candidates` et
#           `crm_mail_classify` : succès et journal, refus par la matrice, refus par le CRM malgré la matrice ouverte ;
#           docs/SPEC-mcp.md §9.2 septendecies, §13 ; docs/SPEC-mail-subsystem.md §26.2, §26.5 ; décision 891
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LE SEED : l'affaire « Refonte du site vitrine » (`c1`) porte deux messages reçus, « Demande de devis — refonte » puis sa
réponse ; Driss, business developer, emprunte sa propre identité « Envoi de Driss Lemoine ». Les mails préparés et
les envois éventuels sont effacés ; les cases de la matrice que le seed n'accorde pas sont posées puis retirées."""

from __future__ import annotations

import base64
import hashlib
import os
import time

import httpx2
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from crm_mcp.jeton_interne import Identite, frapper

from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .parcours_oauth import API, CLE_SERVICE
from .test_integration_oauth import FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

CARD = "5eed0000-0000-4000-8000-0000000000c1"
ESPACE = "5eed0000-0000-4000-8000-000000000001"
#: « Piste entrante à qualifier », que la lectrice lit ; `c1` est dans « Grands comptes », channel qu'elle ne lit pas.
CARD_LUE = "5eed0000-0000-4000-8000-0000000000c6"
OBJET = "Demande de devis — refonte"
CORPS = "Envoi d'intégration du connecteur MCP."
TOUTES = [("messagerie", "consulter"), ("messagerie", "ajouter"), ("affaires", "consulter")]
#: « Refonte intranet Ville de Lyon », figée, écrite par Driss, sans cadence active : armer y passerait tous les contrôles.
CARD_FIGEE = "5eed0000-0000-4000-8000-0000000000c4"
SEQUENCE = "5e900000-0000-4000-8000-000000000001"


async def _nettoyer() -> None:
    await _service("DELETE", "/mail_outbox", params={"card_id": f"eq.{CARD}", "body_text": f"like.{CORPS}*"})
    await _service("DELETE", "/mail_drafts", params={"body_text": f"like.{CORPS}*"})


async def _identite_de_driss() -> dict:
    return (await _service("GET", "/mail_outbound_identities", params={
        "owner_id": f"eq.{DRISS[1]}", "select": "id,from_address,daily_quota",
    })).json()[0]


async def _rien_en_file(card_id: str) -> None:
    assert (await _service("GET", "/mail_outbox", params={
        "card_id": f"eq.{card_id}", "body_text": f"like.{CORPS}*", "select": "id"})).json() == []


async def test_lire_le_fil_et_preparer_une_reponse_qui_ne_part_pas():
    await _nettoyer()
    identite = await _identite_de_driss()
    posees = await _manquantes(DRISS, TOUTES + [("messagerie", "supprimer")])
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_prepare")
            # `crm_mail_send` N'EXISTE PLUS, toutes les cases de la famille ouvertes (docs/SPEC-mails-prepares.md §5).
            assert "crm_mail_send" not in {o.name for o in await client.list_tools()}

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            fil = (await appeler("crm_card_mail_list", {"card_id": CARD}))["messages"]
            assert [m["subject"] for m in fil][:2] == [OBJET, f"Re: {OBJET}"]
            assert all(m["direction"] == "inbound" and m["attachments"] == [] for m in fil[:2])
            premier = fil[0]
            lu = await appeler("crm_mail_get", {"message_id": premier["id"]})
            assert (lu["card_id"], lu["subject"]) == (CARD, OBJET)
            assert lu["body"] and lu["body_from_html"] is False

            prepare = await appeler("crm_mail_prepare", {
                "card_id": CARD, "to": ["client@exterieur.test"], "body": CORPS,
                "in_reply_to_message_id": premier["id"], "bcc": ["direction@exterieur.test"],
            })
            assert (prepare["status"], prepare["from_address"], prepare["subject"]) == (
                "pending_review", identite["from_address"], f"Re: {OBJET}"
            )
            assert prepare["review_url"].endswith(f"/inbox?brouillon={prepare['draft_id']}")
            # LE MAIL PRÉPARÉ EST EN BASE, AU NOM DE DRISS, D'ORIGINE `mcp` — ET RIEN N'EST EN FILE D'ENVOI.
            ligne = (await _service("GET", "/mail_drafts", params={
                "id": f"eq.{prepare['draft_id']}",
                "select": "status,origin,created_by,card_id,identity_id,in_reply_to_message_id,to_addrs,bcc_addrs",
            })).json()
            assert ligne == [{"status": "pending", "origin": "mcp", "created_by": DRISS[1], "card_id": CARD,
                              "identity_id": identite["id"], "in_reply_to_message_id": premier["id"],
                              "to_addrs": ["client@exterieur.test"], "bcc_addrs": ["direction@exterieur.test"]}]
            await _rien_en_file(CARD)

            liste = await appeler("crm_mail_draft_list", {"workspace": "p2enjoy", "card_id": CARD})
            assert prepare["draft_id"] in [d["id"] for d in liste["drafts"]]
            ecarte = await appeler("crm_mail_draft_discard", {"draft_id": prepare["draft_id"]})
            assert ecarte["status"] == "discarded"
            assert (await _service("GET", "/mail_drafts", params={
                "id": f"eq.{prepare['draft_id']}", "select": "status"})).json() == [{"status": "discarded"}]
            with pytest.raises(ToolError, match="draft_not_pending"):
                await client.call_tool("crm_mail_draft_discard", {"draft_id": prepare["draft_id"]})
            await _rien_en_file(CARD)
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_un_mail_prepare_ne_se_lit_ni_ne_s_ecarte_par_une_autre_personne():
    await _nettoyer()
    posees = await _manquantes(DRISS, TOUTES)
    await _poser(DRISS, posees)
    posees_farida = await _manquantes(FARIDA, [("messagerie", "consulter"), ("messagerie", "supprimer")])
    await _poser(FARIDA, posees_farida)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_prepare")
            prepare = (await client.call_tool("crm_mail_prepare", {
                "card_id": CARD, "to": ["client@exterieur.test"], "subject": "À relire", "body": CORPS,
            })).structured_content
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_draft_discard")
            liste = (await client.call_tool("crm_mail_draft_list", {"workspace": "p2enjoy"})).structured_content
            assert prepare["draft_id"] not in [d["id"] for d in liste["drafts"]]
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : mail préparé"):
                await client.call_tool("crm_mail_draft_discard", {"draft_id": prepare["draft_id"]})
        assert (await _service("GET", "/mail_drafts", params={
            "id": f"eq.{prepare['draft_id']}", "select": "status"})).json() == [{"status": "pending"}]
    finally:
        await _retirer(DRISS, posees)
        await _retirer(FARIDA, posees_farida)
        await _nettoyer()


async def test_le_catalogue_contourne_le_jeton_du_connecteur_n_envoie_rien():
    """`CLAUDE.md` §10 : la règle se prouve par une requête qui contourne l'interface. Le jeton est frappé par le code même
    du connecteur (`jeton_interne.frapper`), pour Driss, et appelle PostgREST directement : les trois voies qui feraient
    partir un courrier sont refusées par la base (docs/SPEC-mails-prepares.md §4.2, §8), et rien n'est écrit."""
    await _nettoyer()
    identite = await _identite_de_driss()
    jeton = frapper(os.environ["JWT_SECRET"], Identite(DRISS[1], None, None, True, False, None), int(time.time()))
    placement = (await _service("GET", "/card_placements", params={
        "card_id": f"eq.{CARD_FIGEE}", "select": "id", "limit": "1"})).json()[0]["id"]
    await _service("POST", "/mail_drafts", json={
        "workspace_id": ESPACE, "card_id": CARD, "to_addrs": ["client@exterieur.test"], "body_text": CORPS,
        "origin": "mcp", "created_by": DRISS[1]})
    brouillon = (await _service("GET", "/mail_drafts", params={
        "body_text": f"like.{CORPS}*", "select": "id"})).json()[0]["id"]
    entetes = {"apikey": os.environ["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {jeton}"}
    appels = {
        "queue_outbound_email": {"p_card_id": CARD, "p_identity_id": identite["id"], "p_to": ["client@exterieur.test"],
                                 "p_subject": "Contournement", "p_body_text": CORPS},
        "send_email_draft": {"p_draft_id": brouillon, "p_identity_id": identite["id"],
                             "p_to": ["client@exterieur.test"], "p_body_text": CORPS},
        "armer_sequence_relance": {"p_placement": placement, "p_sequence_id": SEQUENCE, "p_identity_id": identite["id"]},
    }
    try:
        async with httpx2.AsyncClient(timeout=10) as http:
            for fonction, arguments in appels.items():
                reponse = await http.post(f"{API}/rest/v1/rpc/{fonction}", headers=entetes, json=arguments)
                assert reponse.status_code == 403, (fonction, reponse.status_code, reponse.text)
                assert reponse.json()["message"] == "review_required", (fonction, reponse.text)
        await _rien_en_file(CARD)
        assert (await _service("GET", "/card_sequence_enrollments", params={
            "placement_id": f"eq.{placement}", "status": "eq.active", "select": "id"})).json() == []
        assert (await _service("GET", "/mail_drafts", params={
            "id": f"eq.{brouillon}", "select": "status"})).json() == [{"status": "pending"}]
    finally:
        await _nettoyer()


async def test_la_lectrice_lit_le_fil_et_la_matrice_lui_ferme_la_preparation():
    posees = await _manquantes(FARIDA, [("messagerie", "consulter"), ("affaires", "consulter")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_card_mail_list" in noms and "crm_mail_prepare" not in noms, "matrice attendue"
            )
            fil = (await client.call_tool("crm_card_mail_list", {"card_id": CARD_LUE})).structured_content
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_mail_list", "ok")
            assert fil["messages"] == [] and fil["has_more"] is False
            # La RLS lui cache `c1` et son fil : le refus uniforme, que la matrice soit ouverte ou non.
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
                await client.call_tool("crm_card_mail_list", {"card_id": CARD})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_mail_list", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_mail_prepare", {"card_id": CARD_LUE, "to": ["client@exterieur.test"],
                                                            "subject": "Interdit", "body": CORPS})
        await _rien_en_file(CARD_LUE)
    finally:
        await _retirer(FARIDA, posees)


async def test_la_lectrice_qui_prepare_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    # La RLS ne lui montre aucune identité : elle n'en a pas. Le refus vient donc de ce que le CRM lui rend, et rien
    # n'est préparé ni envoyé.
    posees = await _manquantes(FARIDA, TOUTES)
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_prepare")
            with pytest.raises(ToolError, match="no_sending_identity"):
                await client.call_tool("crm_mail_prepare", {"card_id": CARD_LUE, "to": ["client@exterieur.test"],
                                                            "subject": "Interdit", "body": CORPS})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_prepare", "refus_crm")
        await _rien_en_file(CARD_LUE)
        assert (await _service("GET", "/mail_drafts", params={
            "body_text": f"like.{CORPS}*", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, posees)


async def test_l_etat_lu_est_celui_de_la_personne_et_lire_ne_marque_pas():
    """Les lectures de Driss sur les deux messages de `c1` sont relevées, remplacées par une seule — la première —, puis
    rendues telles quelles. La ligne est posée par la clé de service : c'est la DONNÉE de départ du test, pas le geste
    éprouvé ; le geste de marquage est éprouvé par pgTAP 0095 et `e2e/api/inbox-lecture.spec.ts`."""
    messages = (await _service("GET", "/mail_messages", params={
        "card_id": f"eq.{CARD}", "select": "id", "order": "received_at.asc,id.asc",
    })).json()
    ids = [m["id"] for m in messages][:2]
    filtre = {"user_id": f"eq.{DRISS[1]}", "message_id": f"in.({','.join(ids)})"}
    avant = (await _service("GET", "/mail_message_reads", params={**filtre, "select": "message_id,user_id,read_at"})).json()
    await _service("DELETE", "/mail_message_reads", params=filtre)
    await _service("POST", "/mail_message_reads", json={"message_id": ids[0], "user_id": DRISS[1]})
    posees = await _manquantes(DRISS, [("messagerie", "consulter")])
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_get")
            fil = (await client.call_tool("crm_card_mail_list", {"card_id": CARD})).structured_content["messages"]
            assert [(m["id"], m["read"]) for m in fil[:2]] == [(ids[0], True), (ids[1], False)]
            lu = (await client.call_tool("crm_mail_get", {"message_id": ids[1]})).structured_content
            assert lu["read"] is False
            # LIRE PAR LE CONNECTEUR N'ÉCRIT RIEN : la seule lecture de Driss reste celle du départ.
            apres = (await _service("GET", "/mail_message_reads", params={**filtre, "select": "message_id"})).json()
            assert apres == [{"message_id": ids[0]}]
    finally:
        await _retirer(DRISS, posees)
        await _service("DELETE", "/mail_message_reads", params=filtre)
        if avant:
            await _service("POST", "/mail_message_reads", json=avant)


CONTENU_PIECE = "Note d'intégration du connecteur : la pièce lue en binaire.\n".encode()


async def _sous_cle_de_service(methode: str, url: str, entetes: dict[str, str] | None = None, **options) -> httpx2.Response:
    """Le stockage, ou une écriture qui demande un en-tête de plus, sous la clé de service — la mise en place de la preuve."""
    async with httpx2.AsyncClient(timeout=10) as http:
        return await http.request(methode, url, headers={
            "apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", **(entetes or {})}, **options)


async def test_driss_lit_une_piece_saine_en_binaire_et_ni_une_infectee_ni_la_lectrice_ne_passent():
    message = (await _service("GET", "/mail_messages", params={
        "card_id": f"eq.{CARD}", "subject": f"eq.{OBJET}", "select": "id", "limit": "1"})).json()[0]["id"]
    empreinte = hashlib.sha256(CONTENU_PIECE).hexdigest()
    chemin = f"{ESPACE}/{message}/{empreinte}"
    depot = await _sous_cle_de_service("POST", f"{API}/storage/v1/object/mail-attachments/{chemin}", content=CONTENU_PIECE,
                                       entetes={"Content-Type": "text/plain", "x-upsert": "true"})
    assert depot.status_code in (200, 201), depot.text
    lignes = (await _sous_cle_de_service("POST", f"{API}/rest/v1/mail_attachments",
                                         entetes={"Prefer": "return=representation"}, json=[
        {"message_id": message, "card_id": CARD, "filename": "tst-crm074-note.txt", "mime_type": "text/plain",
         "size_bytes": len(CONTENU_PIECE), "storage_path": chemin, "sha256": empreinte, "av_status": "clean"},
        {"message_id": message, "card_id": CARD, "filename": "tst-crm074-virus.txt", "mime_type": "text/plain",
         "size_bytes": len(CONTENU_PIECE), "storage_path": chemin, "sha256": empreinte, "av_status": "infected"},
    ])).json()
    saine, infectee = (next(l["id"] for l in lignes if l["filename"] == nom)
                       for nom in ("tst-crm074-note.txt", "tst-crm074-virus.txt"))
    posees = await _manquantes(DRISS, [("messagerie", "consulter")])
    await _poser(DRISS, posees)
    posees_farida = await _manquantes(FARIDA, [("messagerie", "consulter")])
    await _poser(FARIDA, posees_farida)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_attachment_get")
            lu = (await client.call_tool("crm_mail_get", {"message_id": message})).structured_content
            par_nom = {p["filename"]: p for p in lu["attachments"]}
            assert par_nom["tst-crm074-note.txt"]["status"] == "available"
            assert par_nom["tst-crm074-virus.txt"]["status"] == "infected"
            resultat = await client.call_tool("crm_mail_attachment_get", {"attachment_id": saine})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_attachment_get", "ok")
            ressource = next(b for b in resultat.content if b.type == "resource").resource
            assert base64.b64decode(ressource.blob) == CONTENU_PIECE
            assert resultat.structured_content["filename"] == "tst-crm074-note.txt"
            with pytest.raises(ToolError, match="attachment_not_available"):
                await client.call_tool("crm_mail_attachment_get", {"attachment_id": infectee})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_attachment_get", "refus_crm")
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_attachment_get")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_mail_attachment_get", {"attachment_id": saine})
    finally:
        await _retirer(DRISS, posees)
        await _retirer(FARIDA, posees_farida)
        await _service("DELETE", "/mail_attachments", params={"filename": "like.tst-crm074*"})
        await _sous_cle_de_service("DELETE", f"{API}/storage/v1/object/mail-attachments", json={"prefixes": [chemin]})


#: « Demande de devis — refonte », classé dans `c1` par le seed : Driss le lit, la lectrice non (`CRM-137`).
MSGID_CLASSE = "<seed-inbox-classe@p2enjoy.test>"


async def _message_classe() -> dict:
    return (await _service("GET", "/mail_messages", params={
        "rfc822_message_id": f"eq.{MSGID_CLASSE}", "select": "id,card_id,classification,classified_by,classified_at",
    })).json()[0]


async def test_driss_liste_les_affaires_candidates_puis_classe_et_rien_ne_change_deux_fois():
    """`CRM-137` : la liste par la vraie fonction et sous la RLS de Driss, puis le classement dans l'affaire qui porte déjà
    le message. `classify_message` est IDEMPOTENTE dans ce cas (`0028`) : le geste réussit réellement, et la ligne du
    message sort identique — la preuve ne laisse rien derrière elle."""
    avant = await _message_classe()
    assert avant["card_id"] == CARD
    posees = await _manquantes(DRISS, [("messagerie", "consulter"), ("messagerie", "modifier")])
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_classify")
            liste = (await client.call_tool("crm_mail_classification_candidates", {
                "message_id": avant["id"], "known_sender": False, "search": "VITRÎNE",
            })).structured_content
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_classification_candidates", "ok")
            # SANS CASSE NI ACCENTS, sur le titre : « Refonte du site vitrine » est rendue, avec son chemin.
            vitrine = [a for a in liste["affaires"] if a["card_id"] == CARD]
            assert len(vitrine) == 1 and " › " in vitrine[0]["path"]
            assert liste["known_sender"] is False and "note" not in liste

            classe = (await client.call_tool("crm_mail_classify", {
                "message_id": avant["id"], "card_id": CARD,
            })).structured_content
            assert classe == {"message_id": avant["id"], "card_id": CARD, "status": "filed"}
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_classify", "ok")
        assert await _message_classe() == avant
    finally:
        await _retirer(DRISS, posees)


async def test_sans_la_case_modifier_le_classement_n_est_pas_offert():
    posees = await _manquantes(DRISS, [("messagerie", "consulter")])
    await _poser(DRISS, posees)
    # La case `modifier` de la famille est retirée le temps de la preuve, si le seed l'accorde, puis rendue.
    tenue = ("messagerie", "modifier") not in await _manquantes(DRISS, [("messagerie", "modifier")])
    if tenue:
        await _retirer(DRISS, [("messagerie", "modifier")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_mail_classification_candidates" in noms and "crm_mail_classify" not in noms,
                "la matrice ferme le classement et ouvre la liste",
            )
            message = await _message_classe()
            with pytest.raises(ToolError):
                await client.call_tool("crm_mail_classify", {"message_id": message["id"], "card_id": CARD})
    finally:
        if tenue:
            await _poser(DRISS, [("messagerie", "modifier")])
        await _retirer(DRISS, posees)


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    """La RLS cache `c1` et son courrier à la lectrice : la liste et le classement rendent le refus uniforme, que la
    matrice ouvre pourtant, et rien n'est écrit."""
    avant = await _message_classe()
    posees = await _manquantes(FARIDA, [("messagerie", "consulter"), ("messagerie", "modifier")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_classify")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_mail_classification_candidates", {"message_id": avant["id"]})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_classification_candidates", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_mail_classify", {"message_id": avant["id"], "card_id": CARD_LUE})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_classify", "refus_crm")
        assert await _message_classe() == avant
    finally:
        await _retirer(FARIDA, posees)

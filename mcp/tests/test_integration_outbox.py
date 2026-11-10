# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-144 (docs/BACKLOG.md) — tranche T2 : la course entre l'annulation et la passe d'envoi, EN PARALLÈLE, contre
#           la vraie base, à travers PostgREST — chaque envoi finit soit annulé et jamais réservé, soit réservé et son
#           annulation refusée ; jamais les deux, jamais aucun ; une ligne `mail_cancelled` par annulation réussie, et
#           aucune autre
# @verifies docs/SPEC-mail-subsystem.md §28.3, §28.5 (la preuve pytest), §28.11 ; docs/SCHEMA.md « Migration `0176` »
# @verifies CRM-144 (docs/BACKLOG.md) — tranche T4 : les trois outils de l'outbox contre le vrai Keycloak, la vraie base et le
#           vrai service `mcp`, par le parcours OAuth réel — lister, annuler et réessayer sous le jeton de Driss (succès et
#           journal), la matrice qui ferme annuler et réessayer sans la case `modifier`, la lectrice refusée par le CRM
#           malgré la matrice ouverte (refus uniforme, rien n'est écrit) ; docs/SPEC-mcp.md §9.2 undevicies, §13
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LES DEUX PARTIES DE LA COURSE. Les annulations passent par `cancel_outbound_email` sous le jeton de Driss, l'auteur des
envois — le jeton frappé par le code même du connecteur (`jeton_interne.frapper`), qui appelle PostgREST directement.
Les passes jouent `reserver_envois` sous la clé de service, comme `mail-sync`. Toutes partent ensemble (`asyncio.gather`),
dans un ordre mélangé, et PostgREST les sert sur plusieurs connexions : la base les arbitre réellement.

LE WORKER LOCAL joue lui aussi `reserver_envois`, chaque minute : il est alors une passe de plus, et l'invariant le couvre
— un envoi qu'il prend n'est jamais dit annulé. Les envois de la preuve naissent dus et les plus anciens (`created_at`
en 2000), pour que les passes les choisissent avant toute autre ligne. Si une passe prend malgré tout une ligne qui n'est
pas de la preuve (toutes les siennes étant verrouillées à cet instant), elle la REND à la file aussitôt
(`queued`, `reserved_at` nul), telle qu'elle était : la preuve ne retient jamais un courrier d'autrui.

LA PREUVE N'EST PAS VACANTE : une manche ne compte que si elle a vu les deux issues (au moins un envoi annulé ET au moins
un réservé par une passe) ; au plus cinq manches sont jouées pour les voir. Chaque envoi de la preuve est retiré ; la
ligne `mail_cancelled` de chaque annulation réussie reste au fil de c1, l'historique ne se corrigeant pas (`CRM-044`)."""

from __future__ import annotations

import asyncio
import os
import random
import time

import httpx2
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from crm_mcp.jeton_interne import Identite, frapper

from .parcours_oauth import API, CLE_SERVICE
from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

CARD = "5eed0000-0000-4000-8000-0000000000c1"
ESPACE = "5eed0000-0000-4000-8000-000000000001"
CORPS = "Course de l'outbox CRM-144."
ENVOIS_PAR_MANCHE = 12
PASSES_PAR_MANCHE = 8
MANCHES = 5


async def _nettoyer() -> None:
    # Les envois seuls : la ligne `mail_cancelled` d'une annulation réussie reste au fil, `card_events` n'accordant aucun
    # privilège d'écriture, `service_role` compris (`CRM-044`) — l'historique ne se corrige pas.
    await _service("DELETE", "/mail_outbox", params={"body_text": f"eq.{CORPS}"})


async def _creer_envois(identite: str, manche: int) -> list[str]:
    lignes = [{
        "workspace_id": ESPACE, "identity_id": identite, "card_id": CARD, "to_addrs": ["client@exterieur.test"],
        "subject": f"Course {manche}-{rang}", "body_text": CORPS, "status": "queued", "created_by": DRISS[1],
        "next_attempt_at": "2000-01-01T00:00:00Z", "created_at": f"2000-01-01T00:00:{rang:02d}Z",
    } for rang in range(ENVOIS_PAR_MANCHE)]
    async with httpx2.AsyncClient(timeout=10) as http:
        reponse = await http.post(f"{API}/rest/v1/mail_outbox", json=lignes, headers={
            "apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"})
    assert reponse.status_code == 201, reponse.text
    return [ligne["id"] for ligne in reponse.json()]


async def _manche(http: httpx2.AsyncClient, entetes_driss: dict[str, str], identite: str, manche: int) -> dict:
    envois = await _creer_envois(identite, manche)
    a_nous = set(envois)
    reservations: list[str] = []
    rendues: list[str] = []
    annulations: dict[str, httpx2.Response] = {}
    service = {"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}"}

    async def annuler(envoi: str) -> None:
        annulations[envoi] = await http.post(
            f"{API}/rest/v1/rpc/cancel_outbound_email", headers=entetes_driss, json={"p_outbox_id": envoi})

    async def passe() -> None:
        reponse = await http.post(f"{API}/rest/v1/rpc/reserver_envois", headers=service, json={"p_limite": 2})
        assert reponse.status_code == 200, reponse.text
        for ligne in reponse.json():
            if ligne["outbox_id"] in a_nous:
                reservations.append(ligne["outbox_id"])
            else:
                # Une ligne d'autrui : rendue à la file telle qu'elle était, sans délai.
                rendue = await http.patch(
                    f"{API}/rest/v1/mail_outbox", headers=service,
                    params={"id": f"eq.{ligne['outbox_id']}", "status": "eq.sending"},
                    json={"status": "queued", "reserved_at": None})
                assert rendue.status_code in (200, 204), rendue.text
                rendues.append(ligne["outbox_id"])

    taches = [lambda e=e: annuler(e) for e in envois] + [passe for _ in range(PASSES_PAR_MANCHE)]
    random.shuffle(taches)
    await asyncio.gather(*(tache() for tache in taches))

    etats = {ligne["id"]: ligne for ligne in (await _service("GET", "/mail_outbox", params={
        "id": f"in.({','.join(envois)})", "select": "id,status,cancelled_by,last_error"})).json()}
    evenements = (await _service("GET", "/card_events", params={
        "type": "eq.mail_cancelled", "card_id": f"eq.{CARD}", "select": "payload"})).json()
    return {"envois": envois, "reservations": reservations, "rendues": rendues, "annulations": annulations,
            "etats": etats, "evenements": [e["payload"]["outbox_id"] for e in evenements
                                           if e["payload"].get("outbox_id") in a_nous]}


async def test_la_course_en_parallele_n_annule_jamais_un_envoi_parti_ni_ne_fait_partir_un_annule():
    await _nettoyer()
    identite = (await _service("GET", "/mail_outbound_identities", params={
        "owner_id": f"eq.{DRISS[1]}", "select": "id", "order": "created_at", "limit": "1"})).json()[0]["id"]
    jeton = frapper(os.environ["JWT_SECRET"], Identite(DRISS[1], None, None, True, False, None), int(time.time()))
    entetes_driss = {"apikey": os.environ["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {jeton}"}
    deux_issues_vues = False
    try:
        async with httpx2.AsyncClient(timeout=20, limits=httpx2.Limits(max_connections=32)) as http:
            for manche in range(MANCHES):
                r = await _manche(http, entetes_driss, identite, manche)
                annulees = set()
                for envoi in r["envois"]:
                    reponse = r["annulations"][envoi]
                    etat = r["etats"][envoi]
                    if reponse.status_code == 200:
                        # ANNULÉ : jamais réservé par une passe, et dit annulé par la base, par Driss.
                        annulees.add(envoi)
                        assert envoi not in r["reservations"], ("annulé ET réservé", envoi, etat)
                        assert etat["status"] == "cancelled", ("annulation rendue mais ligne non annulée", envoi, etat)
                        assert etat["cancelled_by"] == DRISS[1], etat
                    else:
                        # REFUSÉ : parce qu'une passe (la nôtre, ou le worker) l'a pris — et alors jamais « annulé ».
                        assert reponse.status_code == 409, (envoi, reponse.status_code, reponse.text)
                        motif = reponse.json()["message"]
                        assert motif in ("outbox_sending", "outbox_sent", "outbox_failed"), (envoi, motif)
                        assert etat["status"] != "cancelled", ("refusée mais annulée", envoi, etat)
                        assert etat["cancelled_by"] is None, etat
                # JAMAIS AUCUN : chaque envoi a une issue — annulé, ou pris par une passe.
                for envoi in r["envois"]:
                    assert envoi in annulees or r["etats"][envoi]["status"] != "queued" \
                        or r["etats"][envoi]["last_error"] is not None, ("ni annulé ni pris", r["etats"][envoi])
                # UNE ligne `mail_cancelled` par annulation réussie, et aucune autre.
                assert sorted(r["evenements"]) == sorted(annulees), (r["evenements"], annulees)
                # Les envois réservés par nos passes ne l'ont été qu'une fois chacun.
                assert len(r["reservations"]) == len(set(r["reservations"])), r["reservations"]
                await _nettoyer()
                if annulees and r["reservations"]:
                    deux_issues_vues = True
                    break
        assert deux_issues_vues, f"en {MANCHES} manches, la course n'a jamais vu les deux issues : preuve vacante"
    finally:
        await _nettoyer()


# --- `CRM-144` T4 : les trois outils, par le vrai connecteur -------------------------------------------------------------

CORPS_OUTILS = "Outils de l'outbox CRM-144."


async def _poser_envoi(statut: str, motif: str | None = None) -> str:
    identite = (await _service("GET", "/mail_outbound_identities", params={
        "owner_id": f"eq.{DRISS[1]}", "select": "id", "order": "created_at", "limit": "1"})).json()[0]["id"]
    async with httpx2.AsyncClient(timeout=10) as http:
        reponse = await http.post(f"{API}/rest/v1/mail_outbox", headers={
            "apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"}, json={
            "workspace_id": ESPACE, "identity_id": identite, "card_id": CARD, "to_addrs": ["client@exterieur.test"],
            "subject": f"Outils outbox {statut}", "body_text": CORPS_OUTILS, "status": statut, "last_error": motif,
            "created_by": DRISS[1], "next_attempt_at": "2099-01-01T00:00:00Z"})
    assert reponse.status_code == 201, reponse.text
    return reponse.json()[0]["id"]


async def _nettoyer_outils() -> None:
    await _service("DELETE", "/mail_outbox", params={"body_text": f"eq.{CORPS_OUTILS}"})


async def _statut(identifiant: str) -> str:
    return (await _service("GET", "/mail_outbox", params={"id": f"eq.{identifiant}", "select": "status"})).json()[0]["status"]


async def test_driss_liste_annule_et_reessaie_par_le_connecteur():
    await _nettoyer_outils()
    en_file = await _poser_envoi("queued")
    echec = await _poser_envoi("failed", "auth_failed")
    posees = await _manquantes(DRISS, [("messagerie", "consulter"), ("messagerie", "modifier")])
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_outbox_retry")
            liste = (await client.call_tool("crm_mail_outbox_list", {
                "workspace": ESPACE, "box": "queued", "card_id": CARD})).structured_content
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_outbox_list", "ok")
            [ligne] = [e for e in liste["sends"] if e["id"] == en_file]
            assert ligne["cancellable"] is True and ligne["from_address"]
            assert "body_text" not in ligne
            echecs = (await client.call_tool("crm_mail_outbox_list", {"workspace": ESPACE, "box": "failed"})).structured_content
            [ligne_echec] = [e for e in echecs["sends"] if e["id"] == echec]
            assert ligne_echec["error"]["code"] == "auth_failed" and ligne_echec["retryable"] is True

            annule = (await client.call_tool("crm_mail_outbox_cancel", {"outbox_id": en_file})).structured_content
            assert annule["status"] == "cancelled" and annule["cancelled_at"]
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_outbox_cancel", "ok")
            assert await _statut(en_file) == "cancelled"
            with pytest.raises(ToolError, match="outbox_cancelled"):
                await client.call_tool("crm_mail_outbox_cancel", {"outbox_id": en_file})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_outbox_cancel", "refus_crm")

            reessaye = (await client.call_tool("crm_mail_outbox_retry", {"outbox_id": echec})).structured_content
            assert reessaye["outbox_id"] == echec and reessaye["status"] in ("queued", "sending", "sent")
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_outbox_retry", "ok")
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer_outils()


async def test_sans_la_case_modifier_annuler_et_reessayer_ne_sont_pas_offerts():
    posees = await _manquantes(DRISS, [("messagerie", "consulter")])
    await _poser(DRISS, posees)
    tenue = ("messagerie", "modifier") not in await _manquantes(DRISS, [("messagerie", "modifier")])
    if tenue:
        await _retirer(DRISS, [("messagerie", "modifier")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_mail_outbox_list" in noms and "crm_mail_outbox_cancel" not in noms
                and "crm_mail_outbox_retry" not in noms,
                "la matrice ferme annuler et réessayer, et ouvre la liste",
            )
    finally:
        if tenue:
            await _poser(DRISS, [("messagerie", "modifier")])
        await _retirer(DRISS, posees)


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte_et_rien_n_est_annule():
    await _nettoyer_outils()
    en_file = await _poser_envoi("queued")
    posees = await _manquantes(FARIDA, [("messagerie", "consulter"), ("messagerie", "modifier")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_outbox_cancel")
            # La RLS cache `c1` et ses envois à la lectrice : l'ancre ne se résout pas, le refus est uniforme.
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_mail_outbox_cancel", {"outbox_id": en_file})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_outbox_cancel", "refus_crm")
        assert await _statut(en_file) == "queued"
    finally:
        await _retirer(FARIDA, posees)
        await _nettoyer_outils()


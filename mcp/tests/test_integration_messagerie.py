# @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : les trois outils de la famille `messagerie` contre le vrai Keycloak,
#           la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 decies (le fil dans l'ordre, la réponse par la file de l'écran, l'envoi constaté dans
#           `mail_outbox` sans relève réelle) ; docs/SPEC-mail-subsystem.md §19.4 (le quota de l'identité)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

LE SEED : l'affaire « Refonte du site vitrine » (`c1`) porte deux messages reçus, « Demande de devis — refonte » puis sa
réponse ; Driss, business developer, emprunte sa propre identité « Envoi de Driss Lemoine ». L'envoi en file est effacé,
le quota de l'identité remis tel quel ; les cases de la matrice que le seed n'accorde pas sont posées puis retirées."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

CARD = "5eed0000-0000-4000-8000-0000000000c1"
#: « Piste entrante à qualifier », que la lectrice lit ; `c1` est dans « Grands comptes », channel qu'elle ne lit pas.
CARD_LUE = "5eed0000-0000-4000-8000-0000000000c6"
OBJET = "Demande de devis — refonte"
CORPS = "Envoi d'intégration du connecteur MCP."
TOUTES = [("messagerie", "consulter"), ("messagerie", "ajouter"), ("affaires", "consulter")]


async def _nettoyer() -> None:
    await _service("DELETE", "/mail_outbox", params={"card_id": f"eq.{CARD}", "body_text": f"like.{CORPS}*"})


async def _identite_de_driss() -> dict:
    return (await _service("GET", "/mail_outbound_identities", params={
        "owner_id": f"eq.{DRISS[1]}", "select": "id,from_address,daily_quota",
    })).json()[0]


async def test_lire_le_fil_et_repondre_par_la_file_de_l_ecran():
    await _nettoyer()
    identite = await _identite_de_driss()
    posees = await _manquantes(DRISS, TOUTES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_send")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            fil = (await appeler("crm_card_mail_list", {"card_id": CARD}))["messages"]
            assert [m["subject"] for m in fil][:2] == [OBJET, f"Re: {OBJET}"]
            assert all(m["direction"] == "inbound" and m["attachment_count"] == 0 for m in fil[:2])
            premier = fil[0]
            lu = await appeler("crm_mail_get", {"message_id": premier["id"]})
            assert (lu["card_id"], lu["subject"]) == (CARD, OBJET)
            assert lu["body"] and lu["body_from_html"] is False

            envoi = await appeler("crm_mail_send", {
                "card_id": CARD, "to": ["client@exterieur.test"], "body": CORPS,
                "in_reply_to_message_id": premier["id"],
            })
            assert (envoi["status"], envoi["from_address"], envoi["subject"]) == (
                "queued", identite["from_address"], f"Re: {OBJET}"
            )
            # L'ENVOI EST CONSTATÉ EN FILE, SANS RELÈVE RÉELLE : la ligne que l'écran aurait écrite, au nom de Driss.
            ligne = (await _service("GET", "/mail_outbox", params={
                "id": f"eq.{envoi['outbox_id']}", "select": "status,created_by,card_id,identity_id,in_reply_to_message_id,to_addrs",
            })).json()
            assert ligne == [{"status": "queued", "created_by": DRISS[1], "card_id": CARD, "identity_id": identite["id"],
                              "in_reply_to_message_id": premier["id"], "to_addrs": ["client@exterieur.test"]}]
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_le_quota_de_l_identite_est_un_refus_du_crm_malgre_la_matrice():
    await _nettoyer()
    identite = await _identite_de_driss()
    posees = await _manquantes(DRISS, TOUTES)
    await _poser(DRISS, posees)
    await _service("PATCH", "/mail_outbound_identities", params={"id": f"eq.{identite['id']}"}, json={"daily_quota": 0})
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_send")
            with pytest.raises(ToolError, match="quota_exceeded"):
                await client.call_tool("crm_mail_send", {"card_id": CARD, "to": ["client@exterieur.test"],
                                                         "subject": "Quota", "body": CORPS})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_send", "refus_crm")
        assert (await _service("GET", "/mail_outbox", params={
            "card_id": f"eq.{CARD}", "body_text": f"like.{CORPS}*", "select": "id"})).json() == []
    finally:
        await _service("PATCH", "/mail_outbound_identities", params={"id": f"eq.{identite['id']}"},
                       json={"daily_quota": identite["daily_quota"]})
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_la_lectrice_lit_le_fil_et_la_matrice_lui_ferme_l_envoi():
    posees = await _manquantes(FARIDA, [("messagerie", "consulter"), ("affaires", "consulter")])
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_card_mail_list" in noms and "crm_mail_send" not in noms, "matrice attendue"
            )
            fil = (await client.call_tool("crm_card_mail_list", {"card_id": CARD_LUE})).structured_content
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_mail_list", "ok")
            assert fil["messages"] == [] and fil["has_more"] is False
            # La RLS lui cache `c1` et son fil : le refus uniforme, que la matrice soit ouverte ou non.
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
                await client.call_tool("crm_card_mail_list", {"card_id": CARD})
            assert await _dernier_journal(FARIDA[1]) == ("crm_card_mail_list", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_mail_send", {"card_id": CARD_LUE, "to": ["client@exterieur.test"],
                                                         "subject": "Interdit", "body": CORPS})
        assert (await _service("GET", "/mail_outbox", params={
            "card_id": f"eq.{CARD_LUE}", "body_text": f"like.{CORPS}*", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, posees)


async def test_la_lectrice_qui_envoie_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    # La RLS ne lui montre aucune identité : ni la sienne, qu'elle n'a pas, ni celle du service, réservée aux
    # administrateurs. Le refus vient donc de ce que le CRM lui rend, et rien ne part.
    posees = await _manquantes(FARIDA, TOUTES)
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_send")
            with pytest.raises(ToolError, match="no_sending_identity"):
                await client.call_tool("crm_mail_send", {"card_id": CARD_LUE, "to": ["client@exterieur.test"],
                                                         "subject": "Interdit", "body": CORPS})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_send", "refus_crm")
        assert (await _service("GET", "/mail_outbox", params={
            "card_id": f"eq.{CARD_LUE}", "body_text": f"like.{CORPS}*", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, posees)

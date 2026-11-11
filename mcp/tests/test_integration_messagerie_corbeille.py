# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-138 (docs/BACKLOG.md) — tranche T4 : les cinq outils contre le vrai Keycloak, la vraie base et le vrai service
#           `mcp`, par le parcours OAuth réel — lu et non lu, le sommeil et le réveil, effacer (la case refusée par la base à
#           qui n'écrit aucune boîte, puis l'effacement), la corbeille, restaurer ; l'ancre `trashed_message` qui ne rend pas
#           un message de la corbeille d'autrui ; la matrice qui ferme l'effacement sans la case `supprimer` ; la lectrice
#           refusée par le CRM malgré la matrice ouverte
# @verifies docs/SPEC-mcp.md §9.2 (CRM-138), §13 ; docs/SPEC-mail-subsystem.md §29.3, §29.4, §29.8 précisé ;
#           docs/SCHEMA.md « Migration `0182` »
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

La preuve pose son propre message, classé dans l'affaire c1 (que Driss écrit), présent dans la seule boîte de Camille
(l'administratrice), sous la clé de service, et le retire à la fin. Les lignes `mail_deleted` et `mail_restored` qu'elle
écrit au fil de c1 restent : `card_events` n'accorde aucune écriture, `service_role` compris (`CRM-044`)."""

from __future__ import annotations

import os
import time
import uuid

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
CAMILLE = "5eed0000-0000-4000-8000-000000000011"
MARQUE = "crm138-mcp"
CASES = [("messagerie", "consulter"), ("messagerie", "modifier"), ("messagerie", "supprimer")]


async def _poser_message() -> tuple[str, str]:
    """Un message classé dans c1, présent dans la boîte de Camille ; rend son identifiant et sa clé de fil."""
    rfc = f"<{MARQUE}-{uuid.uuid4()}@exemple.test>"
    service = {"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"}
    boite = (await _service("GET", "/mail_inbound_accounts", params={
        "owner_id": f"eq.{CAMILLE}", "select": "id", "order": "created_at", "limit": "1"})).json()[0]["id"]
    async with httpx2.AsyncClient(timeout=10) as http:
        pose = await http.post(f"{API}/rest/v1/mail_messages", headers=service, json={
            "workspace_id": ESPACE, "rfc822_message_id": rfc, "card_id": CARD, "classification": "manual",
            "direction": "inbound", "from_address": "client@exemple.test", "subject": "Preuve connecteur CRM-138",
            "received_at": "2026-11-11T09:00:00Z"})
        assert pose.status_code == 201, pose.text
        identifiant = pose.json()[0]["id"]
        occurrence = await http.post(f"{API}/rest/v1/mail_message_occurrences", headers=service, json={
            "message_id": identifiant, "account_id": boite, "folder": "INBOX", "uid": 930_001})
        assert occurrence.status_code == 201, occurrence.text
    return identifiant, rfc


async def _nettoyer(rfc: str | None = None) -> None:
    await _service("DELETE", "/mail_messages", params={"rfc822_message_id": f"like.<{MARQUE}-*"})
    if rfc is not None:
        await _service("DELETE", "/mail_thread_snoozes", params={"thread_key": f"eq.{rfc}"})


async def _ligne(identifiant: str) -> dict:
    return (await _service("GET", "/mail_messages", params={
        "id": f"eq.{identifiant}", "select": "deleted_at,deleted_by"})).json()[0]


async def _lu_par_driss(identifiant: str) -> bool:
    lignes = (await _service("GET", "/mail_message_reads", params={
        "message_id": f"eq.{identifiant}", "user_id": f"eq.{DRISS[1]}", "select": "message_id"})).json()
    return len(lignes) == 1


async def test_driss_lit_endort_efface_et_restaure_par_le_connecteur():
    await _nettoyer()
    message, rfc = await _poser_message()
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_delete")
            # LU, PUIS NON LU : l'état personnel de Driss, constaté en base.
            await client.call_tool("crm_mail_set_read", {"message_id": message, "read": True})
            assert await _lu_par_driss(message)
            await client.call_tool("crm_mail_set_read", {"message_id": message, "read": False})
            assert not await _lu_par_driss(message)
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_set_read", "ok")

            # LE SOMMEIL porte sur le fil du message — sa clé est son propre Message-ID, sans References.
            dort = (await client.call_tool("crm_mail_snooze", {
                "message_id": message, "until": "2099-01-01T09:00:00Z"})).structured_content
            assert dort["snoozed_until"].startswith("2099-01-01")
            sommeils = (await _service("GET", "/mail_thread_snoozes", params={
                "workspace_id": f"eq.{ESPACE}", "thread_key": f"eq.{rfc}", "select": "thread_key"})).json()
            assert sommeils == [{"thread_key": rfc}]
            with pytest.raises(ToolError, match="snooze_date_in_past"):
                await client.call_tool("crm_mail_snooze", {"message_id": message, "until": "2000-01-01T00:00:00Z"})
            reveil = (await client.call_tool("crm_mail_snooze", {"message_id": message})).structured_content
            assert reveil["woken"] is True

            # LA CASE « boîte mail » : Driss n'écrit aucune boîte où le message figure — la base refuse, rien n'est effacé.
            with pytest.raises(ToolError, match="no_writable_mailbox"):
                await client.call_tool("crm_mail_delete", {"message_id": message, "also_mailbox": True})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_delete", "refus_crm")
            assert (await _ligne(message))["deleted_at"] is None

            efface = (await client.call_tool("crm_mail_delete", {"message_id": message})).structured_content
            assert efface["mailbox_moves"] == 0 and efface["restorable_for_days"] == 30
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_delete", "ok")
            ligne = await _ligne(message)
            assert ligne["deleted_at"] is not None and ligne["deleted_by"] == DRISS[1]

            corbeille = (await client.call_tool("crm_mail_trash_list", {"workspace": ESPACE})).structured_content
            [vu] = [m for m in corbeille["messages"] if m["message_id"] == message]
            assert vu["can_restore"] is True and vu["mailbox_move"] == {"state": "none"}

            restaure = (await client.call_tool("crm_mail_restore", {"message_id": message})).structured_content
            assert restaure == {"message_id": message, "restored": True, "cancelled_moves": 0}
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_restore", "ok")
            assert (await _ligne(message))["deleted_at"] is None
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer(rfc)


async def test_un_message_de_la_corbeille_d_autrui_ne_se_restaure_pas():
    await _nettoyer()
    message, _rfc = await _poser_message()
    # CAMILLE L'EFFACE, sous son jeton frappé comme le connecteur le frappe : il est dans SA corbeille, pas dans celle de Driss.
    jeton = frapper(os.environ["JWT_SECRET"], Identite(CAMILLE, None, None, True, False, None), int(time.time()))
    async with httpx2.AsyncClient(timeout=10) as http:
        reponse = await http.post(f"{API}/rest/v1/rpc/delete_message", json={"p_message_id": message}, headers={
            "apikey": os.environ["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {jeton}"})
    assert reponse.status_code == 200, reponse.text
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_restore")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : message de la corbeille"):
                await client.call_tool("crm_mail_restore", {"message_id": message})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_restore", "refus_crm")
            corbeille = (await client.call_tool("crm_mail_trash_list", {"workspace": ESPACE})).structured_content
            assert message not in [m["message_id"] for m in corbeille["messages"]]
        assert (await _ligne(message))["deleted_by"] == CAMILLE
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_sans_la_case_supprimer_effacer_n_est_pas_offert():
    posees = await _manquantes(DRISS, [("messagerie", "consulter"), ("messagerie", "modifier")])
    await _poser(DRISS, posees)
    tenue = ("messagerie", "supprimer") not in await _manquantes(DRISS, [("messagerie", "supprimer")])
    if tenue:
        await _retirer(DRISS, [("messagerie", "supprimer")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_mail_restore" in noms and "crm_mail_delete" not in noms,
                "la matrice ferme l'effacement, et ouvre la restauration",
            )
    finally:
        if tenue:
            await _poser(DRISS, [("messagerie", "supprimer")])
        await _retirer(DRISS, posees)


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte_et_rien_n_est_efface():
    await _nettoyer()
    message, _rfc = await _poser_message()
    posees = await _manquantes(FARIDA, CASES)
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_delete")
            # La RLS cache c1 et ses messages à la lectrice : l'ancre ne se résout pas, le refus est uniforme.
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_mail_delete", {"message_id": message})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_delete", "refus_crm")
        assert (await _ligne(message))["deleted_at"] is None
    finally:
        await _retirer(FARIDA, posees)
        await _nettoyer()

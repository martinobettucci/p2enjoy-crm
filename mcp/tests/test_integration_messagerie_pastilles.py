# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-141 (docs/BACKLOG.md) — tranche T5 : les pastilles d'un mail contre le vrai Keycloak, la vraie base et le
#           vrai service `mcp`, par le parcours OAuth réel — lire les pastilles de l'espace et leur descriptif, poser et
#           retirer (la base constate la ligne `manual`), une réévaluation qui ne défait pas la pose de l'assistant, la
#           matrice qui ferme la pose sans la case `modifier`, la lectrice refusée par le CRM malgré la matrice ouverte, le
#           journal écrit
# @verifies docs/SPEC-mcp.md §9.2 duovicies, §13 ; docs/SPEC-mail-subsystem.md §31.4, §31.5 ; docs/JOURNAL.md décision 924
# @verifies CRM-155 (docs/BACKLOG.md) — tranche T2 : `labels` sur `crm_card_mail_list` contre la vraie base — l'une des
#           pastilles, en OU, chaque message une fois, la retirée à la main qui ne retient rien, les pastilles de chaque
#           message rendues, l'identifiant mal formé refusé et journalisé `refus_crm` (docs/SPEC-mcp.md §9.2 duovicies,
#           révisé ; docs/SPEC-mail-subsystem.md §31.12.5)
# @verifies CRM-159 (docs/BACKLOG.md) — tranche T3 : contre la vraie base, `crm_mail_label_list` rend Spam cachée, `crm_search`
#           ne rend pas le mail masqué et le compte dans `hidden_mails`, `crm_card_mail_list` le garde (docs/SPEC-mcp.md §9.2
#           duovicies, révisé ; docs/SPEC-mail-subsystem.md §31.13.7 ; décision 958)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

La preuve pose ses propres messages sous la clé de service — l'un dans c1, que Driss écrit, l'autre dans c7, que la
lectrice lit —, et les retire à la fin. La réévaluation est jouée comme la passe la joue : `record_label_evaluation`, sous
la clé de service, avec les pastilles qu'aurait rendues le modèle."""

from __future__ import annotations

import uuid

import httpx2
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .parcours_oauth import API, CLE_SERVICE
from .test_integration_budgets import _manquantes
from .test_integration_contacts import _poser, _retirer
from .test_integration_oauth import FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

ESPACE = "5eed0000-0000-4000-8000-000000000001"
CARD_C1 = "5eed0000-0000-4000-8000-0000000000c1"
CARD_C7 = "5eed0000-0000-4000-8000-0000000000c7"
MARQUE = "crm141-mcp"
CASES = [("messagerie", "consulter"), ("messagerie", "modifier")]


async def _poser_message(card: str) -> str:
    service = {"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"}
    async with httpx2.AsyncClient(timeout=10) as http:
        pose = await http.post(f"{API}/rest/v1/mail_messages", headers=service, json={
            "workspace_id": ESPACE, "rfc822_message_id": f"<{MARQUE}-{uuid.uuid4()}@exemple.test>", "card_id": card,
            "classification": "manual", "direction": "inbound", "from_address": "client@exemple.test",
            "subject": "Preuve connecteur CRM-141", "body_text": "Bonjour, nous voulons un devis."})
        assert pose.status_code == 201, pose.text
        return pose.json()[0]["id"]


async def _nettoyer() -> None:
    await _service("DELETE", "/mail_messages", params={"rfc822_message_id": f"like.<{MARQUE}-*"})


async def _pastille(nom: str) -> str:
    return (await _service("GET", "/mail_labels", params={
        "workspace_id": f"eq.{ESPACE}", "name": f"eq.{nom}", "select": "id"})).json()[0]["id"]


async def _lignes(message: str) -> dict[str, tuple[str, bool]]:
    lignes = (await _service("GET", "/mail_message_labels", params={
        "message_id": f"eq.{message}", "select": "label_id,source,applied"})).json()
    return {ligne["label_id"]: (ligne["source"], ligne["applied"]) for ligne in lignes}


async def test_driss_lit_pose_et_retire_et_la_reevaluation_ne_defait_pas_sa_pose():
    await _nettoyer()
    message = await _poser_message(CARD_C1)
    spam, lead = await _pastille("Spam"), await _pastille("Lead")
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_label_set")
            liste = (await client.call_tool("crm_mail_label_list", {"workspace": ESPACE})).structured_content
            [vue] = [p for p in liste["labels"] if p["id"] == lead]
            assert vue["description"] and vue["archived"] is False
            # Les archivées en dernier : Newsletter, archivée par le seed.
            assert liste["labels"][-1]["name"] == "Newsletter" and liste["labels"][-1]["archived"] is True

            pose = (await client.call_tool("crm_mail_label_set", {"message_id": message, "label_id": spam})).structured_content
            assert {"label_id": spam, "name": "Spam", "source": "manual", "archived": False} in pose["labels"]
            assert (await _lignes(message))[spam] == ("manual", True)
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_label_set", "ok")

            # LA RÉÉVALUATION, comme la passe la joue : la prise (`claimed_at`, que `claim_label_evaluations` pose), puis la
            # clôture où le modèle rend Lead seul ; la pose de l'assistant tient.
            prise = await _service("PATCH", "/mail_label_evaluations", params={"message_id": f"eq.{message}"}, json={
                "claimed_at": "now", "leased_until": None})
            assert prise.status_code == 204, prise.text
            cloture = await _service("POST", "/rpc/record_label_evaluation", json={
                "p_message_id": message, "p_label_ids": [lead], "p_error": None})
            assert cloture.status_code == 204, cloture.text
            assert await _lignes(message) == {spam: ("manual", True), lead: ("llm", True)}
            lu = (await client.call_tool("crm_mail_get", {"message_id": message})).structured_content
            assert [(p["name"], p["source"]) for p in lu["labels"]] == [("Lead", "llm"), ("Spam", "manual")]
            assert lu["labels_state"] == "done"

            retrait = (await client.call_tool(
                "crm_mail_label_set", {"message_id": message, "label_id": spam, "applied": False})).structured_content
            assert spam not in [p["label_id"] for p in retrait["labels"]]
            assert (await _lignes(message))[spam] == ("manual", False)

            with pytest.raises(ToolError, match="label_archived"):
                await client.call_tool("crm_mail_label_set", {"message_id": message, "label_id": await _pastille("Newsletter")})
            assert await _dernier_journal(DRISS[1]) == ("crm_mail_label_set", "refus_crm")
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_sans_la_case_modifier_la_pose_n_est_pas_offerte():
    posees = await _manquantes(DRISS, [("messagerie", "consulter")])
    await _poser(DRISS, posees)
    tenue = ("messagerie", "modifier") not in await _manquantes(DRISS, [("messagerie", "modifier")])
    if tenue:
        await _retirer(DRISS, [("messagerie", "modifier")])
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_mail_label_list" in noms and "crm_mail_label_set" not in noms,
                "la matrice ferme la pose, et ouvre la lecture",
            )
    finally:
        if tenue:
            await _poser(DRISS, [("messagerie", "modifier")])
        await _retirer(DRISS, posees)


async def test_la_lectrice_est_refusee_par_le_crm_malgre_la_matrice_ouverte():
    await _nettoyer()
    message = await _poser_message(CARD_C7)
    lead = await _pastille("Lead")
    posees = await _manquantes(FARIDA, CASES)
    await _poser(FARIDA, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_mail_label_set")
            # Elle lit le message (c7) : l'ancre se résout, et c'est la base qui refuse — `forbidden`, nommé.
            with pytest.raises(ToolError, match="forbidden — reserved to whoever edits the workspace"):
                await client.call_tool("crm_mail_label_set", {"message_id": message, "label_id": lead})
            assert await _dernier_journal(FARIDA[1]) == ("crm_mail_label_set", "refus_crm")
        # Rien n'est écrit à la main ; la passe de la minute a pu, elle, évaluer le message.
        assert all(source != "manual" for source, _ in (await _lignes(message)).values())
    finally:
        await _retirer(FARIDA, posees)
        await _nettoyer()


async def _poser_message_neutre(card: str) -> str:
    """Un message sans aucun mot d'un nom de pastille : le simulateur de la passe ne lui en pose aucune."""
    service = {"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"}
    async with httpx2.AsyncClient(timeout=10) as http:
        pose = await http.post(f"{API}/rest/v1/mail_messages", headers=service, json={
            "workspace_id": ESPACE, "rfc822_message_id": f"<{MARQUE}-{uuid.uuid4()}@exemple.test>", "card_id": card,
            "classification": "manual", "direction": "inbound", "from_address": "client@exemple.test",
            "subject": "Preuve connecteur CRM-155", "body_text": "Bonjour, une question."})
        assert pose.status_code == 201, pose.text
        return pose.json()[0]["id"]


async def test_crm_155_la_liste_filtre_par_pastilles_en_ou_et_rend_les_pastilles_de_chaque_message():
    await _nettoyer()
    avec_spam = await _poser_message_neutre(CARD_C1)
    avec_lead = await _poser_message_neutre(CARD_C1)
    retiree = await _poser_message_neutre(CARD_C1)
    sans = await _poser_message_neutre(CARD_C1)
    spam, lead = await _pastille("Spam"), await _pastille("Lead")
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_label_set")
            for message, pastille in ((avec_spam, spam), (avec_lead, lead), (retiree, lead)):
                await client.call_tool("crm_mail_label_set", {"message_id": message, "label_id": pastille})
            await client.call_tool("crm_mail_label_set", {"message_id": retiree, "label_id": lead, "applied": False})
            mes = {avec_spam, avec_lead, retiree, sans}

            async def lister(labels: list[str] | None) -> list[dict]:
                arguments = {"card_id": CARD_C1, "limit": 100} | ({} if labels is None else {"labels": labels})
                rendu = (await client.call_tool("crm_card_mail_list", arguments)).structured_content
                return [m for m in rendu["messages"] if m["id"] in mes]

            tous = {m["id"]: m for m in await lister(None)}
            assert set(tous) == mes
            assert tous[avec_spam]["labels"] == [{"label_id": spam, "name": "Spam", "source": "manual", "archived": False}]
            assert tous[retiree]["labels"] == [] and tous[sans]["labels"] == []

            union = [m["id"] for m in await lister([spam, lead])]
            assert sorted(union) == sorted([avec_spam, avec_lead]), "l'une des pastilles, chaque message une fois"
            assert [m["id"] for m in await lister([lead.upper()])] == [avec_lead]
            assert await _dernier_journal(DRISS[1]) == ("crm_card_mail_list", "ok")

            with pytest.raises(ToolError, match="labels must be label ids"):
                await client.call_tool("crm_card_mail_list", {"card_id": CARD_C1, "labels": ["Spam"]})
            assert await _dernier_journal(DRISS[1]) == ("crm_card_mail_list", "refus_crm")
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()


async def test_crm159_spam_cachee_la_recherche_le_tait_et_le_compte_la_liste_de_l_affaire_le_garde():
    await _nettoyer()
    mot = "zelvor" + uuid.uuid4().hex[:6].translate(str.maketrans("0123456789", "ghijklmnop"))
    service = {"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}", "Prefer": "return=representation"}
    async with httpx2.AsyncClient(timeout=10) as http:
        pose = await http.post(f"{API}/rest/v1/mail_messages", headers=service, json={
            "workspace_id": ESPACE, "rfc822_message_id": f"<{MARQUE}-{uuid.uuid4()}@exemple.test>", "card_id": CARD_C1,
            "classification": "manual", "direction": "inbound", "from_address": "client@exemple.test",
            "subject": f"Preuve connecteur {mot}", "body_text": "Bonjour."})
        assert pose.status_code == 201, pose.text
        message = pose.json()[0]["id"]
    spam, lead = await _pastille("Spam"), await _pastille("Lead")
    posees = await _manquantes(DRISS, CASES)
    await _poser(DRISS, posees)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_mail_label_set")
            liste = (await client.call_tool("crm_mail_label_list", {"workspace": ESPACE})).structured_content
            drapeaux = {p["id"]: p["hidden"] for p in liste["labels"]}
            assert drapeaux[spam] is True and drapeaux[lead] is False, "Spam cachée d'office par la migration 0193"

            avant = (await client.call_tool("crm_search", {"query": mot})).structured_content
            assert [r["id"] for r in avant["results"]] == [message]
            assert "hidden_mails" not in avant

            await client.call_tool("crm_mail_label_set", {"message_id": message, "label_id": spam})
            apres = (await client.call_tool("crm_search", {"query": mot})).structured_content
            assert apres["results"] == []
            assert apres["hidden_mails"] == [{"label_id": spam, "label_name": "Spam", "count": 1}]

            # La liste d'une affaire ne masque rien, comme l'onglet Mails de la fiche (décision 958).
            fil = (await client.call_tool("crm_card_mail_list", {"card_id": CARD_C1, "limit": 100})).structured_content
            assert message in [m["id"] for m in fil["messages"]]
    finally:
        await _retirer(DRISS, posees)
        await _nettoyer()

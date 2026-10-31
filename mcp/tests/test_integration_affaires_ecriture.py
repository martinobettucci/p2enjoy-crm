# @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — le channel, la probabilité et le responsable se lisent sur le rattachement
#           (migration 0134, docs/SPEC-rattachements.md §3.2)
# @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.b : les douze outils d'écriture des affaires contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies CRM-067 (docs/BACKLOG.md) — tranche T4 : consigner et corriger une activité par le connecteur
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit ; l'effet dans les tables que lit la webapp), §9.2 ter
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Le business developer reçoit, par la clé de service, les cases `affaires` (ajouter, modifier, supprimer, consulter) et
`contacts:consulter` ; elles sont retirées à la fin, et l'affaire créée par la preuve est effacée par la clé de service —
la matrice et le jeu de démonstration sont rendus tels qu'ils étaient."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton

GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"  # workflow global ; Driss y écrit
PROSPECTION = "5eed0000-0000-4000-8000-000000000031"  # workflow dérivé
REFONTE = "5eed0000-0000-4000-8000-000000000034"  # la lectrice le lit, sans l'écrire
SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"
LEO = "5eed0000-0000-4000-8000-000000000091"
CAMILLE = "5eed0000-0000-4000-8000-000000000011"
TITRE = "Affaire MCP intégration"
CASES = [("affaires", a) for a in ("consulter", "ajouter", "modifier", "supprimer")] + [("contacts", "consulter")]


async def _poser(qui, cases) -> None:
    lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in cases]
    assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201


async def _retirer(qui, cases) -> None:
    for famille, action in cases:
        await _service(
            "DELETE", "/mcp_droits", params={"sub": f"eq.{qui[1]}", "famille": f"eq.{famille}", "action": f"eq.{action}"}
        )


async def _nettoyer() -> None:
    # Une affaire créée par la preuve, à la corbeille ou non : la cascade emporte ses lignes satellites.
    await _service("DELETE", "/cards", params={"title": f"like.{TITRE}*"})


async def test_la_matrice_du_seed_ferme_l_ecriture():
    async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
        await _attendre_outils(
            client, lambda noms: not noms & {"crm_card_create", "crm_card_trash", "crm_card_move"}, "écriture visible"
        )


async def test_le_parcours_complet_d_une_affaire_par_le_connecteur():
    await _nettoyer()
    await _poser(DRISS, CASES)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_trash")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(DRISS[1]) == (outil, "ok"), outil
                return resultat

            carte = (await appeler("crm_card_create", {"channel_id": GRANDS_COMPTES, "title": TITRE}))["card"]
            ident = carte["id"]
            assert carte["step"]["name"] == "Prospection" and carte["channel"]["id"] == GRANDS_COMPTES
            enBase = (await _service("GET", "/cards", params={"id": f"eq.{ident}", "select": "created_by,workspace_id"})).json()
            assert enBase == [{"created_by": DRISS[1], "workspace_id": ESPACE_SEEDE}]

            await appeler("crm_card_comment_add", {"card_id": ident, "body": "Ouverte par l'assistant."})
            await appeler("crm_card_contact_link", {"card_id": ident, "contact_id": LEO, "role": "décideur"})
            activite = await appeler("crm_card_activity_add", {
                "card_id": ident, "type": "call", "subject": "Appel MCP", "duration_minutes": 20,
                "participant_contact_ids": [LEO], "participant_member_ids": [CAMILLE],
            })
            assert activite["participants_refused"] == []
            corrigee = await appeler(
                "crm_card_activity_update", {"activity_id": activite["activity"]["id"], "subject": "Appel MCP corrigé",
                                             "participant_member_ids": []},
            )
            assert corrigee["activity"]["edited_at"] is not None
            participants = (await _service("GET", "/card_activity_participants", params={
                "activity_id": f"eq.{activite['activity']['id']}", "select": "contact_id,profile_id"})).json()
            assert participants == [{"contact_id": LEO, "profile_id": None}]

            await appeler("crm_card_update", {
                "card_id": ident, "description": "Créée par le connecteur", "probability": 30, "owner": "Camille Aubert",
                "next_action": "Rappeler", "next_action_at": "2030-01-15T09:00:00+01:00", "answers": {"budget": 45000},
            })
            fiche = (await _service("GET", "/cards", params={"id": f"eq.{ident}", "select": "description"})).json()[0]
            assert fiche == {"description": "Créée par le connecteur"}
            # La probabilité et le responsable vivent sur le rattachement depuis la migration 0134 (`CRM-111` T2.4.5).
            rattachement = (await _service("GET", "/card_placements", params={
                "card_id": f"eq.{ident}", "select": "probability_override,owner_id"})).json()
            assert rattachement == [{"probability_override": 30, "owner_id": CAMILLE}]
            # La même écriture que le formulaire de la fiche (`ecrireValeur`), qui ne pose pas `updated_by` non plus.
            valeur = (await _service("GET", "/card_field_values", params={"card_id": f"eq.{ident}", "select": "value"})).json()
            assert valeur == [{"value": 45000}]

            # Le déplacement, et les deux refus nommés que la base garde.
            with pytest.raises(ToolError, match="transition_not_allowed"):
                await client.call_tool("crm_card_move", {"card_id": ident, "to_step": "Négociation"})
            assert await _dernier_journal(DRISS[1]) == ("crm_card_move", "refus_crm")
            with pytest.raises(ToolError, match="comment_required"):
                await client.call_tool("crm_card_move", {"card_id": ident, "to_step": "Perdu"})
            deplacee = await appeler("crm_card_move", {"card_id": ident, "to_step": "Relance"})
            assert deplacee["card"]["step"]["name"] == "Relance"

            await appeler("crm_card_snooze", {"card_id": ident, "until": "2030-02-01"})
            await appeler("crm_card_wake", {"card_id": ident})
            await appeler("crm_card_contact_unlink", {"card_id": ident, "contact_id": LEO})

            # Vers le workflow dérivé : l'étape nommée et la perte des réponses acceptée, sinon refus nommé.
            with pytest.raises(ToolError, match="field_values_would_be_lost|step_mapping_required"):
                await client.call_tool("crm_card_move_to_channel", {"card_id": ident, "to_channel_id": PROSPECTION})
            arrivee = await appeler("crm_card_move_to_channel", {
                "card_id": ident, "to_channel_id": PROSPECTION, "to_step": "Prospection", "discard_field_values": True,
            })
            assert arrivee["card"]["channel"]["id"] == PROSPECTION

            await appeler("crm_card_trash", {"card_id": ident})
            assert (await _service("GET", "/cards", params={"id": f"eq.{ident}", "select": "deleted_by"})).json() == [
                {"deleted_by": DRISS[1]}
            ]
            # Le fil de l'affaire nomme la personne pour ce que le connecteur a fait.
            acteurs = (await _service("GET", "/card_events", params={"card_id": f"eq.{ident}", "select": "type,actor_id"})).json()
            assert {"type": "created", "actor_id": DRISS[1]} in acteurs
    finally:
        await _retirer(DRISS, CASES)
        await _nettoyer()


async def test_refuses_par_le_crm_malgre_la_matrice_ouverte():
    """La lectrice, toute la famille ouverte : « Grands comptes » lui est fermé, « Refonte » ne s'écrit pas. Chaque refus
    est uniforme et nommé `refus_crm` au journal ; rien n'est écrit."""
    await _poser(FARIDA, CASES)
    avant = (await _service("GET", "/cards", params={"id": f"eq.{SOGEXIA}", "select": "*"})).json()
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_trash")
            appels = {
                "crm_card_create": {"channel_id": REFONTE, "title": TITRE},
                "crm_card_comment_add": {"card_id": SOGEXIA, "body": "x"},
                "crm_card_update": {"card_id": SOGEXIA, "title": "x"},
                "crm_card_move": {"card_id": SOGEXIA, "to_step": "Relance"},
                "crm_card_snooze": {"card_id": SOGEXIA, "until": "2030-01-01"},
                "crm_card_trash": {"card_id": SOGEXIA},
            }
            for outil, arguments in appels.items():
                with pytest.raises(ToolError):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(FARIDA[1]) == (outil, "refus_crm"), outil
        assert (await _service("GET", "/cards", params={"id": f"eq.{SOGEXIA}", "select": "*"})).json() == avant
        assert (await _service("GET", "/cards", params={"title": f"like.{TITRE}*", "select": "id"})).json() == []
    finally:
        await _retirer(FARIDA, CASES)
        await _nettoyer()


async def test_sans_la_case_supprimer_la_corbeille_n_existe_pas():
    cases = [c for c in CASES if c != ("affaires", "supprimer")]
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            # La visibilité retenue par le service expire en deux secondes : on attend l'état, borné.
            await _attendre_outils(
                client, lambda noms: "crm_card_move" in noms and "crm_card_trash" not in noms, "la corbeille reste visible"
            )
            with pytest.raises(ToolError):
                await client.call_tool("crm_card_trash", {"card_id": SOGEXIA})
    finally:
        await _retirer(DRISS, cases)

# @spec CRM-104 (docs/BACKLOG.md) — tranche T2.b : les douze outils d'ÉCRITURE de la famille `affaires` (décision 655)
# @spec CRM-067 (docs/BACKLOG.md) — tranche T4 : `crm_card_activity_add`, `crm_card_activity_update` (docs/SPEC-activites.md
#       §6, décision 653 ; aucun retrait, décision 648)
# @spec docs/SPEC-mcp.md §9.2 ter (la liste, les ancres, les identifiants jugés dans l'affaire), §9.1 (aucun chemin
#       parallèle : `creer_affaire`, `move_card`, `move_card_to_channel`, `snooze_card`, `wake_card` et les tables de la
#       webapp ; `destructiveHint` sur le déplacement et la corbeille), §9.3 (refus nommés traduits, zéro ligne = refus)
# @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3 : les gestes désignent le rattachement, résolu depuis `card_id`
#       (docs/SPEC-rattachements.md §5, §11)
"""Écrire sur les affaires, sous l'identité de la personne.

Chaque outil appelle la fonction ou la table que la webapp appelle pour le même geste ; la base garde ses règles —
transitions déclarées, motif exigé, champs exigés, perte des réponses acceptée, date d'activité, participants — et l'outil
traduit ses refus en une phrase pour le modèle. Une écriture que la politique de la base filtre rend zéro ligne : c'est
un refus, jamais un succès.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires import COLONNES_LISTE, resume_carte
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

TYPES_ACTIVITE = ("call", "meeting", "visio")
LONGUEUR_MAX_COMMENTAIRE = 10_000

#: Les refus nommés de la base, en une phrase pour le modèle (docs/SPEC-mcp.md §9.3) : le code, puis ce qu'il faut faire.
REFUS_NOMMES = {
    "transition_not_allowed": "transition_not_allowed — the workflow declares no move from the current step to this "
    "one; read the current step with crm_card_get.",
    "comment_required": "comment_required — this move requires a reason (FR: motif): give `comment`.",
    "step_not_in_workflow": "step_not_in_workflow — that step is not in the affaire's workflow.",
    "step_mapping_required": "step_mapping_required — the target channel uses another workflow: name the arrival step "
    "(`to_step`).",
    "same_channel": "same_channel — the affaire is already in that channel.",
    "snooze_date_in_past": "snooze_date_in_past — the wake-up date must be in the future.",
    "snooze_date_required": "snooze_date_required — give the wake-up date `until`.",
    "aucune etape initiale": "aucune_etape_initiale — the channel's workflow has no initial step; an administrator "
    "must set one in the workflow editor.",
    "comment_too_long": "comment_too_long — a comment holds 10 000 characters at most.",
    "invalid_field_value": "invalid_field_value — the value does not fit the field's type or choices.",
    "activity_in_future": "activity_in_future — an activity is something that took place: its date cannot be in the "
    "future.",
    "participant_outside_card": "participant_outside_card — a participant must be a contact linked to the affaire or a "
    "member of the workspace.",
    "activity_deleted": "activity_deleted — a retired activity cannot be changed.",
    "activity_moderation_limited": "activity_moderation_limited — only its author corrects an activity.",
}
#: Les contraintes `CHECK` d'une activité, nommées dans le message de la base.
CONTRAINTES = {
    "card_activities_subject_check": "subject — 1 to 200 characters.",
    "card_activities_duration_check": "duration_minutes — 1 to 1440.",
    "card_activities_body_check": "body — 20 000 characters at most.",
    "card_activities_type_check": "type — call, meeting or visio.",
}


def refus(reponse: Reponse, genre: str, valeur: Any, champs: dict[str, str] | None = None) -> ToolError:
    """Un refus de la base pour le modèle : le symbole et une phrase. Un refus d'accès reste le refus uniforme."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = corps.get("message")
    if message in ("channel introuvable", "channel_not_found", "card_not_found", "channel ferme", "forbidden"):
        return RefusCrm(introuvable(genre, valeur))
    if message == "missing_required_fields":
        cles = [c.strip() for c in str(corps.get("details") or "").split(",") if c.strip()]
        noms = ", ".join((champs or {}).get(c, c) for c in cles)
        return RefusCrm(
            f"Refusé par le CRM : missing_required_fields — answer these form fields first (crm_card_update, answers): "
            f"{noms}."
        )
    if message == "field_values_would_be_lost":
        nombre = re.match(r"\d+", str(corps.get("details") or ""))
        return RefusCrm(
            "Refusé par le CRM : field_values_would_be_lost — the target channel uses another workflow, and "
            f"{nombre.group(0) if nombre else 'some'} form answer(s) would be lost; set discard_field_values=true to "
            "accept the loss."
        )
    if isinstance(message, str) and message in REFUS_NOMMES:
        return RefusCrm(f"Refusé par le CRM : {REFUS_NOMMES[message]}")
    if isinstance(message, str):
        for contrainte, phrase in CONTRAINTES.items():
            if contrainte in message:
                return RefusCrm(f"Refusé par le CRM : {phrase}")
    return traduire_refus(reponse, genre, valeur)


def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    """L'unique ligne touchée ; zéro ligne est le refus silencieux d'une politique, rendu comme le refus uniforme."""
    if not reponse.reussie:
        raise refus(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def choisir_par_nom(candidats: list[dict[str, Any]], nom: str, quoi: str) -> str:
    """L'identifiant du seul candidat qui porte ce nom, sans tenir compte de la casse ; sinon une erreur qui dit les noms
    possibles. Un nom ambigu n'est jamais tranché au hasard."""
    cible = nom.strip().casefold()
    trouves = [c for c in candidats if str(c.get("nom") or "").strip().casefold() == cible]
    if len(trouves) == 1:
        return str(trouves[0]["id"])
    possibles = ", ".join(sorted({str(c.get("nom")) for c in candidats if c.get("nom")}))
    if not trouves:
        raise ToolError(f"No {quoi} named {nom!r}. Known: {possibles}.")
    raise ToolError(f"Several {quoi}s are named {nom!r}; ask the user which one.")


def instant(valeur: str, nom: str) -> str:
    """Une date `YYYY-MM-DD` ou un instant ISO 8601 ; un instant sans fuseau est refusé plutôt que deviné."""
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", valeur):
            return date.fromisoformat(valeur).isoformat()
        lu = datetime.fromisoformat(valeur.replace("Z", "+00:00"))
    except ValueError as erreur:
        raise ToolError(f"{nom} must be YYYY-MM-DD or an ISO 8601 instant with its offset.") from erreur
    if lu.tzinfo is None:
        raise ToolError(f"{nom} needs a time zone offset, e.g. 2026-10-23T14:00:00+02:00.")
    return lu.isoformat()


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, table, parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus(reponse, genre, valeur)
        return reponse.corps

    async def carte(jeton: str, card_id: str, colonnes: str = "id,workflow_id,workspace_id") -> dict[str, Any]:
        lignes = await lire(jeton, "cards", {"id": f"eq.{card_id}", "select": colonnes}, "card", card_id)
        if len(lignes) != 1:
            raise RefusCrm(introuvable("card", card_id))
        return lignes[0]

    async def rattachement(jeton: str, card_id: str) -> str:
        """Le rattachement de l'affaire que le geste désigne (`CRM-111` T2.3, docs/SPEC-mcp.md §9.2 ter).

        Le contrat de l'outil garde `card_id` pendant la bascule (docs/SPEC-rattachements.md §11) : il prend le plus
        ancien rattachement que l'appelant lit, comme `app.card_first_placement` en base. Aucun : l'affaire est absente
        pour lui, et le refus le dit sans en révéler davantage.
        """
        lignes = await lire(
            jeton,
            "card_placements",
            {"card_id": f"eq.{card_id}", "select": "id", "order": "created_at.asc,id.asc", "limit": "1"},
            "card",
            card_id,
        )
        if len(lignes) != 1:
            raise RefusCrm(introuvable("card", card_id))
        return str(lignes[0]["id"])

    async def etapes(jeton: str, workflow_id: str, genre: str, valeur: Any) -> list[dict[str, Any]]:
        lignes = await lire(
            jeton,
            "workflow_steps",
            {"workflow_id": f"eq.{workflow_id}", "select": "id,noeud:workflow_nodes_catalog(label)"},
            genre,
            valeur,
        )
        return [{"id": e["id"], "nom": (e.get("noeud") or {}).get("label")} for e in lignes]

    async def champs_du_workflow(jeton: str, workflow_id: str, card_id: str) -> list[dict[str, Any]]:
        return await lire(
            jeton,
            "form_fields",
            {"workflow_id": f"eq.{workflow_id}", "select": "id,key,label", "archived_at": "is.null"},
            "card",
            card_id,
        )

    async def resume(jeton: str, card_id: str) -> dict[str, Any]:
        return resume_carte(await carte(jeton, card_id, COLONNES_LISTE))

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_card_create(
        channel_id: Annotated[str, Field(description="The channel id where the affaire is created")],
        title: Annotated[str, Field(description="Title of the affaire", min_length=1, max_length=200)],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "creer_affaire", {"p_channel": channel_id, "p_titre": title})
        if not reponse.reussie or not isinstance(reponse.corps, str):
            raise refus(reponse, "channel", channel_id)
        return {"card": await resume(appel.jeton, reponse.corps)}

    moteur.enregistrer(
        serveur,
        crm_card_create,
        Declaration(famille="affaires", action="ajouter", espace="channel:channel_id"),
        titre="Create an affaire (card)",
        description=(
            "Creates an affaire (card) in a channel with its title, as the board's « Nouvelle affaire » button: it starts "
            "at the workflow's initial step. Refused when the channel's workflow has no initial step or is closed to you."
        ),
    )

    async def crm_card_comment_add(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        body: Annotated[str, Field(description="Plain text", min_length=1, max_length=LONGUEUR_MAX_COMMENTAIRE)],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "card_comments",
            parametres={"select": "id,body,created_at"},
            # `workspace_id` : le trigger le remplace par celui de l'affaire (décision 200) ; c'est l'espace résolu.
            corps={"card_id": card_id, "workspace_id": appel.espace, "body": body},
        )
        return {"comment": une_ligne(reponse, "card", card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_comment_add,
        Declaration(famille="affaires", action="ajouter", espace="card:card_id"),
        titre="Comment on an affaire (commentaire)",
        description="Adds a plain-text comment to an affaire (card), signed with your name, as in its timeline.",
    )

    async def ecrire_participants(
        jeton: str, activite: str, ajouts: list[tuple[str, str]], retraits: list[tuple[str, str]]
    ) -> list[str]:
        refuses: list[str] = []
        for colonne, ident in retraits:
            reponse = await crm.ecrire(
                jeton,
                "DELETE",
                "card_activity_participants",
                parametres={"activity_id": f"eq.{activite}", colonne: f"eq.{ident}", "select": "activity_id"},
            )
            if not reponse.reussie or not reponse.corps:
                refuses.append(ident)
        for colonne, ident in ajouts:
            reponse = await crm.ecrire(
                jeton, "POST", "card_activity_participants", parametres={"select": "activity_id"},
                corps={"activity_id": activite, colonne: ident},
            )
            if not reponse.reussie:
                refuses.append(ident)
        return refuses

    def cibles(contacts: list[str] | None, membres: list[str] | None) -> list[tuple[str, str]]:
        return [("contact_id", c) for c in contacts or []] + [("profile_id", m) for m in membres or []]

    async def crm_card_activity_add(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        type: Annotated[str, Field(description="call, meeting or visio")],
        subject: Annotated[str, Field(description="Subject (FR: sujet)", min_length=1, max_length=200)],
        occurred_at: Annotated[str | None, Field(description="When it took place, ISO 8601 with offset; now by default")] = None,
        duration_minutes: Annotated[int | None, Field(ge=1, le=1440)] = None,
        body: Annotated[str | None, Field(description="Report (FR: compte rendu)", max_length=20000)] = None,
        participant_contact_ids: Annotated[list[str] | None, Field(description="Contacts linked to the affaire")] = None,
        participant_member_ids: Annotated[list[str] | None, Field(description="Members of the workspace (profile ids)")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if type not in TYPES_ACTIVITE:
            raise ToolError("type must be call, meeting or visio.")
        corps: dict[str, Any] = {
            "card_id": card_id,
            "type": type,
            "subject": subject,
            "occurred_at": instant(occurred_at, "occurred_at") if occurred_at else datetime.now(UTC).isoformat(),
            "duration_minutes": duration_minutes,
            "body": body.strip() if body and body.strip() else None,
        }
        reponse = await crm.ecrire(
            appel.jeton, "POST", "card_activities", parametres={"select": "id,type,occurred_at,subject"}, corps=corps
        )
        activite = une_ligne(reponse, "card", card_id)
        refuses = await ecrire_participants(
            appel.jeton, str(activite["id"]), cibles(participant_contact_ids, participant_member_ids), []
        )
        return {
            "activity": activite,
            # Un participant refusé n'annule pas l'activité (docs/DESIGN_SYSTEM.md §5.63) : l'issue le compte.
            "participants_refused": refuses,
        }

    moteur.enregistrer(
        serveur,
        crm_card_activity_add,
        Declaration(famille="affaires", action="ajouter", espace="card:card_id"),
        titre="Record an activity (appel, réunion, visio)",
        description=(
            "Records an activity that TOOK PLACE on an affaire (card): call, meeting or visio, with its subject, date "
            "(never in the future), duration, report and participants — contacts linked to the affaire, members of the "
            "workspace. Its duration does not count as time spent. A refused participant does not cancel the activity."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_card_update(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        title: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        description: Annotated[str | None, Field(description="Empty string clears it", max_length=20000)] = None,
        amount: Annotated[float | None, Field(description="In the affaire's currency")] = None,
        probability: Annotated[int | None, Field(ge=0, le=100, description="The affaire's own probability, %")] = None,
        next_action: Annotated[str | None, Field(description="Empty string clears it", max_length=500)] = None,
        next_action_at: Annotated[str | None, Field(description="ISO 8601 with offset; empty string clears it")] = None,
        owner: Annotated[str | None, Field(description="Full name of a workspace member who becomes the owner")] = None,
        answers: Annotated[dict[str, Any] | None, Field(description="Form answers by field key, e.g. {\"budget\": 45000}")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        fiche = await carte(appel.jeton, card_id)
        # DEUX ÉCRITURES, UNE PAR TABLE (`CRM-111` T2.3.2, docs/SPEC-rattachements.md §3.2, §11) : le titre et la
        # description appartiennent à l'affaire ; le montant, la probabilité, la prochaine action et le responsable, à son
        # rattachement. Le compromis est assumé : si la seconde est refusée, la première reste écrite — chacune est jugée
        # par sa propre règle (écrire un channel de l'affaire, écrire celui du rattachement), et le refus le dit.
        entete: dict[str, Any] = {}
        rattache: dict[str, Any] = {}
        if title is not None:
            entete["title"] = title
        if description is not None:
            entete["description"] = description.strip() or None
        if amount is not None:
            rattache["amount"] = amount
        if probability is not None:
            rattache["probability_override"] = probability
        if next_action is not None:
            rattache["next_action"] = next_action.strip() or None
        if next_action_at is not None:
            rattache["next_action_at"] = instant(next_action_at, "next_action_at") if next_action_at.strip() else None
        if owner is not None:
            membres = await lire(
                appel.jeton,
                "workspace_members",
                {"workspace_id": f"eq.{appel.espace}", "select": "user_id,profiles(full_name)"},
                "card",
                card_id,
            )
            rattache["owner_id"] = choisir_par_nom(
                [{"id": m["user_id"], "nom": (m.get("profiles") or {}).get("full_name")} for m in membres], owner, "member"
            )
        if not entete and not rattache and not answers:
            raise ToolError("Give at least one field to change.")
        if entete:
            reponse = await crm.ecrire(
                appel.jeton, "PATCH", "cards", parametres={"id": f"eq.{card_id}", "select": "id"}, corps=entete
            )
            une_ligne(reponse, "card", card_id)
        if rattache:
            reponse = await crm.ecrire(
                appel.jeton,
                "PATCH",
                "card_placements",
                parametres={"id": f"eq.{await rattachement(appel.jeton, card_id)}", "select": "id"},
                corps=rattache,
            )
            une_ligne(reponse, "card", card_id)
        if answers:
            champs = {str(c["key"]): c for c in await champs_du_workflow(appel.jeton, fiche["workflow_id"], card_id)}
            inconnues = sorted(set(answers) - set(champs))
            if inconnues:
                raise ToolError(f"Unknown field key(s): {', '.join(inconnues)}. Known: {', '.join(sorted(champs))}.")
            for cle, valeur in answers.items():
                reponse = await crm.ecrire(
                    appel.jeton,
                    "POST",
                    "card_field_values",
                    parametres={"on_conflict": "card_id,field_id", "select": "field_id"},
                    corps={
                        "card_id": card_id,
                        "field_id": champs[cle]["id"],
                        "workflow_id": fiche["workflow_id"],
                        "workspace_id": appel.espace,
                        "value": valeur,
                    },
                    fusion=True,
                )
                une_ligne(reponse, "card", card_id)
        return {"card": await resume(appel.jeton, card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_update,
        Declaration(famille="affaires", action="modifier", espace="card:card_id"),
        titre="Update an affaire (card)",
        description=(
            "Changes an affaire's header — title, description, amount, its own probability, next action and due date, "
            "owner (by full name among the workspace members) — and/or its form answers by field key. Only the fields "
            "given are written. Moving to another step is crm_card_move."
        ),
    )

    async def crm_card_move(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        to_step: Annotated[str, Field(description="Name of the arrival step (FR: étape), e.g. Négociation")],
        comment: Annotated[str | None, Field(description="Reason (FR: motif), when the move requires one")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        fiche = await carte(appel.jeton, card_id)
        cible = choisir_par_nom(await etapes(appel.jeton, fiche["workflow_id"], "card", card_id), to_step, "step")
        arguments: dict[str, Any] = {"card_id": card_id, "to_step_id": cible}
        if comment and comment.strip():
            arguments["comment"] = comment.strip()
        reponse = await crm.rpc(appel.jeton, "move_card", arguments)
        if not reponse.reussie:
            champs = {str(c["key"]): str(c["label"]) for c in await champs_du_workflow(appel.jeton, fiche["workflow_id"], card_id)}
            raise refus(reponse, "card", card_id, champs)
        return {"card": await resume(appel.jeton, card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_move,
        Declaration(famille="affaires", action="modifier", espace="card:card_id"),
        titre="Move an affaire to another step (étape)",
        description=(
            "Moves an affaire (card) to another step of its workflow, by the step's name, as on the board. Only declared "
            "moves pass; some need a reason (comment) or answered form fields — the refusal names them."
        ),
        destructif=True,
    )

    async def crm_card_move_to_channel(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        to_channel_id: Annotated[str, Field(description="The target channel id")],
        to_step: Annotated[str | None, Field(description="Arrival step name, required when the workflow changes")] = None,
        discard_field_values: Annotated[bool, Field(description="Accept losing the form answers if the workflow changes")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        arguments: dict[str, Any] = {
            "card_id": card_id, "to_channel_id": to_channel_id, "discard_field_values": discard_field_values,
        }
        if to_step is not None:
            canal = await lire(
                appel.jeton, "channels", {"id": f"eq.{to_channel_id}", "select": "workflow_id"}, "channel", to_channel_id
            )
            if len(canal) != 1:
                raise RefusCrm(introuvable("channel", to_channel_id))
            arguments["to_step_id"] = choisir_par_nom(
                await etapes(appel.jeton, canal[0]["workflow_id"], "channel", to_channel_id), to_step, "step"
            )
        reponse = await crm.rpc(appel.jeton, "move_card_to_channel", arguments)
        if not reponse.reussie:
            raise refus(reponse, "card", card_id)
        return {"card": await resume(appel.jeton, card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_move_to_channel,
        Declaration(
            famille="affaires", action="modifier", espace="card:card_id", autres=("channel:to_channel_id",)
        ),
        titre="Move an affaire to another channel",
        description=(
            "Moves an affaire (card) to another channel. When that channel follows another workflow, name the arrival "
            "step and set discard_field_values=true: the form answers of the old workflow are DESTROYED (the history "
            "keeps them). The refusal says how many answers would be lost."
        ),
        destructif=True,
    )

    async def crm_card_snooze(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        until: Annotated[str, Field(description="Wake-up date YYYY-MM-DD or ISO 8601 instant with offset")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(
            appel.jeton,
            "snooze_card",
            {"p_placement": await rattachement(appel.jeton, card_id), "until": instant(until, "until")},
        )
        if not reponse.reussie:
            raise refus(reponse, "card", card_id)
        return {"card": await resume(appel.jeton, card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_snooze,
        Declaration(famille="affaires", action="modifier", espace="card:card_id"),
        titre="Put an affaire to sleep (mettre en sommeil)",
        description="Puts an affaire (card) to sleep until a future date: it leaves the default views until then.",
    )

    async def crm_card_wake(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "wake_card", {"p_placement": await rattachement(appel.jeton, card_id)})
        if not reponse.reussie:
            raise refus(reponse, "card", card_id)
        return {"card": await resume(appel.jeton, card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_wake,
        Declaration(famille="affaires", action="modifier", espace="card:card_id"),
        titre="Wake an affaire up (réveiller)",
        description="Wakes a sleeping affaire (card) up now.",
    )

    async def crm_card_contact_link(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        contact_id: Annotated[str, Field(description="The contact id, from the address book")],
        role: Annotated[str | None, Field(description="Free role, e.g. décideur", max_length=100)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "card_contacts",
            parametres={"select": "contact_id,role"},
            corps={
                "workspace_id": appel.espace,
                "card_id": card_id,
                "contact_id": contact_id,
                "role": role.strip() if role and role.strip() else None,
            },
        )
        if reponse.statut == 409:
            raise RefusCrm("Refusé par le CRM : already_linked — this contact is already linked to the affaire.")
        return {"link": une_ligne(reponse, "card", card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_contact_link,
        Declaration(
            famille="affaires",
            action="modifier",
            espace="card:card_id",
            aussi=(("contacts", "consulter"),),
            autres=("contact:contact_id",),
        ),
        titre="Link a contact to an affaire",
        description="Links a contact of the address book to an affaire (card), with an optional free role.",
    )

    async def crm_card_contact_unlink(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        contact_id: Annotated[str, Field(description="The linked contact id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "DELETE",
            "card_contacts",
            parametres={"card_id": f"eq.{card_id}", "contact_id": f"eq.{contact_id}", "select": "contact_id"},
        )
        return {"unlinked": une_ligne(reponse, "contact", contact_id)}

    moteur.enregistrer(
        serveur,
        crm_card_contact_unlink,
        Declaration(
            famille="affaires",
            action="modifier",
            espace="card:card_id",
            aussi=(("contacts", "consulter"),),
            autres=("contact:contact_id",),
        ),
        titre="Unlink a contact from an affaire",
        description="Unlinks a contact from an affaire (card); the contact stays in the address book.",
    )

    async def crm_card_activity_update(
        activity_id: Annotated[str, Field(description="The activity id, from crm_card_activity_list")],
        type: Annotated[str | None, Field(description="call, meeting or visio")] = None,
        subject: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        occurred_at: Annotated[str | None, Field(description="ISO 8601 with offset")] = None,
        duration_minutes: Annotated[int | None, Field(ge=1, le=1440)] = None,
        body: Annotated[str | None, Field(description="Empty string clears it", max_length=20000)] = None,
        participant_contact_ids: Annotated[list[str] | None, Field(description="The FULL new list; omit to keep")] = None,
        participant_member_ids: Annotated[list[str] | None, Field(description="The FULL new list; omit to keep")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if type is not None and type not in TYPES_ACTIVITE:
            raise ToolError("type must be call, meeting or visio.")
        corps: dict[str, Any] = {}
        for cle, valeur in (("type", type), ("subject", subject), ("duration_minutes", duration_minutes)):
            if valeur is not None:
                corps[cle] = valeur
        if occurred_at is not None:
            corps["occurred_at"] = instant(occurred_at, "occurred_at")
        if body is not None:
            corps["body"] = body.strip() or None
        if not corps and participant_contact_ids is None and participant_member_ids is None:
            raise ToolError("Give at least one field to change.")
        colonnes = "id,type,occurred_at,subject,edited_at"
        if corps:
            reponse = await crm.ecrire(
                appel.jeton, "PATCH", "card_activities", parametres={"id": f"eq.{activity_id}", "select": colonnes}, corps=corps
            )
            # Zéro ligne : la politique a filtré — la personne n'est pas l'auteur, ou n'écrit plus sur l'affaire.
            activite = une_ligne(reponse, "activity", activity_id)
        else:
            # Les participants seuls : l'activité est relue, et la politique des participants juge chaque écriture
            # (« écrits par qui peut corriger l'activité », docs/SPEC-activites.md §3) ; un refus est compté.
            lignes = await lire(appel.jeton, "card_activities", {"id": f"eq.{activity_id}", "select": colonnes}, "activity", activity_id)
            if len(lignes) != 1:
                raise RefusCrm(introuvable("activity", activity_id))
            activite = lignes[0]
        refuses: list[str] = []
        if participant_contact_ids is not None or participant_member_ids is not None:
            actuels = await lire(
                appel.jeton,
                "card_activity_participants",
                {"activity_id": f"eq.{activity_id}", "select": "contact_id,profile_id"},
                "activity",
                activity_id,
            )
            avant = {("contact_id", p["contact_id"]) for p in actuels if p.get("contact_id")}
            avant |= {("profile_id", p["profile_id"]) for p in actuels if p.get("profile_id")}
            apres = set(avant)
            if participant_contact_ids is not None:
                apres = {c for c in apres if c[0] != "contact_id"} | {("contact_id", c) for c in participant_contact_ids}
            if participant_member_ids is not None:
                apres = {c for c in apres if c[0] != "profile_id"} | {("profile_id", m) for m in participant_member_ids}
            refuses = await ecrire_participants(
                appel.jeton, activity_id, sorted(apres - avant), sorted(avant - apres)
            )
        return {"activity": activite, "participants_refused": refuses}

    moteur.enregistrer(
        serveur,
        crm_card_activity_update,
        Declaration(famille="affaires", action="modifier", espace="activity:activity_id"),
        titre="Correct an activity (appel, réunion, visio)",
        description=(
            "Corrects an activity you recorded: type, subject, date, duration, report, and — when given — the FULL list "
            "of contact or member participants. Only its author can; a retired activity cannot be changed. There is no "
            "tool to retire one: that stays a gesture of the web app."
        ),
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_card_trash(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "cards",
            parametres={"id": f"eq.{card_id}", "select": "id,title"},
            corps={"deleted_at": datetime.now(UTC).isoformat()},
        )
        return {"trashed": une_ligne(reponse, "card", card_id), "note": "An administrator can restore it from the trash."}

    moteur.enregistrer(
        serveur,
        crm_card_trash,
        Declaration(famille="affaires", action="supprimer", espace="card:card_id"),
        titre="Move an affaire to the trash (corbeille)",
        description=(
            "Moves an affaire (card) to the trash, as the button at the bottom of its page: it disappears from the views, "
            "and an administrator can restore it. Nothing is purged."
        ),
        destructif=True,
    )

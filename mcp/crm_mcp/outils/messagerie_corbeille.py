# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @spec CRM-138 (docs/BACKLOG.md) — tranche T4 : lu / non lu, le sommeil, effacer, restaurer et lire la corbeille d'un message
#       depuis le connecteur, famille `messagerie`, cases existantes — `crm_mail_set_read` et `crm_mail_snooze` (`modifier`),
#       `crm_mail_delete` (`supprimer`, `destructiveHint`), `crm_mail_restore` (`modifier`, ancre `trashed_message`),
#       `crm_mail_trash_list` (`consulter`) ; docs/SPEC-mcp.md §9.2 (CRM-138, contrats précisés avant le code) ;
#       docs/SPEC-mail-subsystem.md §29.3 à §29.5, §29.8 ; docs/SPEC-cards.md §16.14 (le sommeil d'un fil) ; décisions 878 et 917
#
# CE MODULE N'OUVRE AUCUNE RÈGLE. Chaque outil appelle, sous le jeton de la personne, la fonction de la base que l'écran
# appelle : `mark_messages_read`, `mark_message_unread`, `snooze_thread`, `wake_thread`, `delete_message`, `restore_message`,
# `trashed_messages`. Elles tiennent les droits ; leurs refus sont nommés pour le modèle.

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

#: Les refus nommés de la corbeille et du sommeil (§29.3, §29.4 ; docs/SPEC-cards.md §16.14.4).
REFUS = {
    "forbidden": "only a person who can write on the email may do this: on its affaire, or on a mailbox it is in",
    "no_writable_mailbox": (
        "the person can write none of the mailboxes this email is in: delete it without also_mailbox"
    ),
    "snooze_date_required": "a snooze needs a date",
    "snooze_date_in_past": "the snooze date must be in the future",
}

#: Les motifs d'un déplacement IMAP impossible (`mail-sync`, `corbeille.py`), pour le modèle. Un code inconnu n'est jamais
#: traduit au hasard.
MOTIFS_DEPLACEMENT = {
    "no_trash_folder": "the mailbox announces no trash folder",
    "move_unsupported": "the mailbox server cannot move a message",
    "account_not_found": "the mailbox is no longer configured",
    "auth_failed": "the mailbox refused the connection",
    "timeout": "the mailbox did not answer in time",
    "tls_failed": "the secure connection to the mailbox failed",
    "connection_failed": "the mailbox is unreachable",
}


def cle_de_fil(references: list[str] | None, rfc822_message_id: str) -> str:
    """La racine RFC 5322 d'un fil — miroir exact de `app.cle_fil` et de `cleFil` de la webapp (docs/SPEC-cards.md
    §16.14.2, §16.15.2) : le premier `References`, à défaut le `Message-ID` propre."""
    if references:
        return references[0]
    return rfc822_message_id


def deplacement_lu(ligne: dict[str, Any]) -> dict[str, Any]:
    """L'état agrégé des déplacements IMAP d'un message effacé : un échec se dit d'abord, puis l'attente, puis le fait —
    la règle de l'écran (`etatDeplacement`, docs/DESIGN_SYSTEM.md §5.102)."""
    if (ligne.get("moves_failed") or 0) > 0:
        code = ligne.get("last_move_error") or ""
        return {
            "state": "failed",
            "error": {"code": code, "text": MOTIFS_DEPLACEMENT.get(code, "unrecognised cause")},
        }
    if (ligne.get("moves_pending") or 0) > 0:
        return {"state": "pending"}
    if (ligne.get("moves_done") or 0) > 0:
        return {"state": "done"}
    return {"state": "none"}


def message_en_corbeille(ligne: dict[str, Any]) -> dict[str, Any]:
    """Une ligne de `trashed_messages` telle que le modèle la voit : jamais le corps."""
    return {
        "message_id": ligne["message_id"],
        "subject": ligne.get("subject"),
        "from_address": ligne.get("from_address"),
        "from_name": ligne.get("from_name"),
        "card_id": ligne.get("card_id"),
        "deleted_at": ligne.get("deleted_at"),
        "deleted_by": ligne.get("deleted_by_name"),
        "purge_at": ligne.get("purge_at"),
        "can_restore": ligne.get("can_restore") is True,
        "mailbox_move": deplacement_lu(ligne),
    }


def refus(reponse: Reponse, genre: str, valeur: str) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    code = str(corps.get("message") or "")
    if code in REFUS:
        return RefusCrm(f"Refusé par le CRM : {code} — {REFUS[code]}.")
    if code in ("message_not_found", "thread_not_found") or reponse.statut == 404:
        return RefusCrm(introuvable(genre, valeur))
    return traduire_refus(reponse, genre, valeur)


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_mail_set_read(
        message_id: Annotated[str, Field(description="The email message id, from crm_card_mail_list or crm_search")],
        read: Annotated[bool, Field(description="true marks it read, false marks it unread")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        if read:
            reponse = await crm.rpc(appel.jeton, "mark_messages_read", {"p_message_ids": [message_id]})
        else:
            reponse = await crm.rpc(appel.jeton, "mark_message_unread", {"p_message_id": message_id})
        if not reponse.reussie:
            raise refus(reponse, "message", message_id)
        return {"message_id": message_id, "read": read}

    moteur.enregistrer(
        serveur,
        crm_mail_set_read,
        Declaration(famille="messagerie", action="modifier", espace="message:message_id"),
        titre="Mark an email read or unread",
        description=(
            "Marks one email read or unread FOR THE PERSON only, as in the CRM inbox: the reading state is personal, "
            "nobody else's changes."
        ),
    )

    async def crm_mail_snooze(
        message_id: Annotated[str, Field(description="The email message id, from crm_card_mail_list or crm_search")],
        until: Annotated[
            str | None,
            Field(description="ISO 8601 date-time in the future; omit it to wake the email up now"),
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        lue = await crm.lire(
            appel.jeton,
            "mail_messages",
            {"id": f"eq.{message_id}", "select": "id,workspace_id,references_ids,rfc822_message_id"},
        )
        lignes = lue.corps if lue.reussie and isinstance(lue.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable("message", message_id))
        m = lignes[0]
        cle = cle_de_fil(m.get("references_ids"), str(m.get("rfc822_message_id") or ""))
        if until is None:
            reponse = await crm.rpc(appel.jeton, "wake_thread", {"workspace": m["workspace_id"], "thread_key": cle})
            if not reponse.reussie:
                raise refus(reponse, "message", message_id)
            return {"message_id": message_id, "snoozed_until": None, "woken": reponse.corps is True}
        reponse = await crm.rpc(
            appel.jeton, "snooze_thread", {"workspace": m["workspace_id"], "thread_key": cle, "until": until}
        )
        if not reponse.reussie:
            raise refus(reponse, "message", message_id)
        ligne = reponse.corps if isinstance(reponse.corps, dict) else {}
        return {
            "message_id": message_id,
            "snoozed_until": ligne.get("snoozed_until", until),
            "thread": "the whole thread sleeps, with its replies",
        }

    moteur.enregistrer(
        serveur,
        crm_mail_snooze,
        Declaration(famille="messagerie", action="modifier", espace="message:message_id"),
        titre="Snooze an email until a date, or wake it up",
        description=(
            "Puts an email to sleep until a future date, as « Mettre le message en sommeil » does in the CRM: it leaves "
            "the inbox with its replies (the whole thread sleeps) and comes back at that date. Without until, wakes it "
            "up now. Snoozing again moves the date."
        ),
    )

    async def crm_mail_delete(
        message_id: Annotated[str, Field(description="The email message id, from crm_card_mail_list or crm_search")],
        also_mailbox: Annotated[
            bool,
            Field(description="Also move it to the trash folder of the person's mailboxes it is in (restoring will not undo that)"),
        ] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(
            appel.jeton, "delete_message", {"p_message_id": message_id, "p_also_mailbox": also_mailbox}
        )
        if not reponse.reussie:
            raise refus(reponse, "message", message_id)
        corps = reponse.corps if isinstance(reponse.corps, dict) else {}
        jours = await crm.rpc(appel.jeton, "trash_retention_days", {}, idempotent=True)
        resultat: dict[str, Any] = {
            "message_id": message_id,
            "deleted_at": corps.get("deleted_at"),
            "mailbox_moves": corps.get("mailbox_moves", 0),
        }
        if jours.reussie and isinstance(jours.corps, int):
            resultat["restorable_for_days"] = jours.corps
        return resultat

    moteur.enregistrer(
        serveur,
        crm_mail_delete,
        Declaration(famille="messagerie", action="supprimer", espace="message:message_id"),
        titre="Delete an email (to the inbox trash)",
        description=(
            "Moves one email to the CRM inbox trash, as « Effacer » does: it disappears from the inbox, the affaire and "
            "the search, and can be restored with crm_mail_restore until it is purged (restorable_for_days). Its other "
            "messages in the thread stay. With also_mailbox, it is also moved to the trash folder of the person's "
            "mailboxes it is in — restoring will not take it out of there. Confirm with the person first. Only a person "
            "who can write on its affaire (or, unfiled, on one of its mailboxes) may delete it."
        ),
        destructif=True,
    )

    async def crm_mail_restore(
        message_id: Annotated[str, Field(description="A deleted email, from crm_mail_trash_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "restore_message", {"p_message_id": message_id})
        if not reponse.reussie:
            raise refus(reponse, "trashed_message", message_id)
        corps = reponse.corps if isinstance(reponse.corps, dict) else {}
        return {"message_id": message_id, "restored": True, "cancelled_moves": corps.get("cancelled_moves", 0)}

    moteur.enregistrer(
        serveur,
        crm_mail_restore,
        # UN MESSAGE EFFACÉ N'EST PLUS LISIBLE : l'ancre `trashed_message` se résout par la base, dans la corbeille visible
        # de la personne (§29.8 précisé, migration 0182).
        Declaration(famille="messagerie", action="modifier", espace="trashed_message:message_id"),
        titre="Restore a deleted email",
        description=(
            "Brings a deleted email back from the CRM inbox trash, where it was: in its affaire, or unfiled. Pending moves "
            "to a mailbox trash are cancelled; a move already done is not undone. The person sees their own deletions, "
            "and the whole workspace trash if they administer it."
        ),
    )

    async def crm_mail_trash_list(
        workspace: Annotated[str, Field(description="Workspace slug or id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "trashed_messages", {"p_workspace_id": appel.espace}, idempotent=True)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise traduire_refus(reponse, "workspace", workspace)
        lignes = sorted(reponse.corps, key=lambda ligne: str(ligne.get("deleted_at") or ""), reverse=True)
        return {"messages": [message_en_corbeille(ligne) for ligne in lignes]}

    moteur.enregistrer(
        serveur,
        crm_mail_trash_list,
        Declaration(famille="messagerie", action="consulter", espace="workspace:workspace"),
        titre="List the inbox trash",
        description=(
            "Lists the deleted emails the person can see, latest deletion first: their own, or the whole workspace's if "
            "they administer it. Each gives its subject, sender, affaire, who deleted it and when, the date it will be "
            "purged, whether the person may restore it, and the state of its move to a mailbox trash (none, pending, "
            "done, or failed with the cause). Never the body."
        ),
    )

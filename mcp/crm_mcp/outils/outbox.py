# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @spec CRM-144 (docs/BACKLOG.md) — tranche T4 : l'outbox dans le connecteur, famille `messagerie`, cases existantes —
#       `crm_mail_outbox_list` (`consulter`), `crm_mail_outbox_cancel` (`modifier`, `destructiveHint`) et
#       `crm_mail_outbox_retry` (`modifier`), ancre `outbox` ; docs/SPEC-mcp.md §9.2 undevicies ;
#       docs/SPEC-mail-subsystem.md §28.3, §28.4, §28.7, §28.8 ; décisions 898 et 906
#
# CE MODULE N'OUVRE AUCUNE RÈGLE. La liste est ce que la RLS de `mail_outbox` rend sous le jeton de la personne (les envois
# des affaires qu'elle lit ; jamais le récapitulatif quotidien, sans affaire). Annuler et réessayer sont les fonctions de la
# base, `cancel_outbound_email` et `retry_outbound_email`, qui tiennent les droits (l'auteur, ou un administrateur qui
# écrit l'affaire), l'état et la course contre la passe d'envoi. `cancellable` et `retryable` ne sont qu'une aide au
# modèle, calculée sur la colonne `outbox_gestes_permis` que la base rend : la base refuse de toute façon.

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

#: Les états que chaque boîte rend (docs/SPEC-mail-subsystem.md §28.6).
BOITES: dict[str, tuple[str, ...]] = {"queued": ("queued", "sending"), "sent": ("sent",), "failed": ("failed",)}
#: L'ordre de chaque boîte : la file du plus proche départ, les deux autres du plus récent.
ORDRES = {"queued": "next_attempt_at.asc,id.asc", "sent": "sent_at.desc.nullslast,id.desc", "failed": "updated_at.desc,id.desc"}

COLONNES = (
    "id,status,card_id,to_addrs,cc_addrs,subject,from_address,next_attempt_at,sent_at,attempts,last_error,"
    "outbox_gestes_permis,card:cards(title),author:profiles!mail_outbox_created_by_fkey(full_name)"
)

#: Le dictionnaire des motifs (§28.7), pour le modèle. Un code inconnu rend « unrecognised cause », jamais deviné.
MOTIFS = {
    "auth_failed": "the sending server refused the username or password",
    "tls_failed": "the secure connection to the sending server failed",
    "timeout": "the sending server did not answer in time",
    "host_unreachable": "the sending server is unreachable",
    "connection_refused": "the sending server refused the connection",
    "protocol_error": "the sending server answered unexpectedly",
    "quota_exceeded": "the daily sending quota of this address was reached",
    "credentials_missing": "the password of the sending address is not stored",
    "storage_unavailable": "the attachments could not be read",
    "attachment_infected": "an attachment was rejected by the antivirus",
    "attachment_missing": "an attachment is no longer available",
    "worker_interrompu": "a first attempt was interrupted: the message may have been sent",
}

#: La phrase de la décision 906 (Q3), donnée telle quelle à la personne.
INCERTAIN = "a first attempt was interrupted: the message may have been sent, so it cannot be cancelled"

#: Les refus nommés de §28.3 et §28.4.
REFUS_OUTBOX = {
    "forbidden": "only the author of the send, or a workspace administrator who can write on the affaire, may do this",
    "outbox_sending": "the message is being sent right now: it can no longer be cancelled",
    "outbox_sent": "the message has already been sent",
    "outbox_failed": "the send has failed: there is nothing to cancel (retry it instead)",
    "outbox_cancelled": "the send has already been cancelled",
    "outbox_queued": "the send is already queued",
    "outbox_uncertain": INCERTAIN,
    "card_not_available": "the affaire is archived, in the trash, or has no email address",
    "quota_exceeded": "the daily sending quota of this address is reached; retry tomorrow",
}


def erreur_de(code: str | None) -> dict[str, str] | None:
    """Le motif d'un envoi : son code et sa phrase ; un code inconnu n'est jamais traduit au hasard."""
    if not code:
        return None
    return {"code": code, "text": MOTIFS.get(code, "unrecognised cause")}


def envoi_lu(e: dict[str, Any]) -> dict[str, Any]:
    """Un envoi tel que le modèle le voit (§9.2 undevicies) : jamais le corps, jamais les pièces."""
    affaire = e.get("card") if isinstance(e.get("card"), dict) else {}
    auteur = e.get("author") if isinstance(e.get("author"), dict) else {}
    permis = e.get("outbox_gestes_permis") is True
    statut = e.get("status")
    incertain = statut == "queued" and e.get("last_error") == "worker_interrompu"
    return {
        "id": e["id"],
        "status": statut,
        "card_id": e.get("card_id"),
        "card_title": affaire.get("title"),
        "to": e.get("to_addrs") or [],
        "cc": e.get("cc_addrs") or [],
        "subject": e.get("subject"),
        "from_address": e.get("from_address"),
        "created_by": auteur.get("full_name"),
        "next_attempt_at": e.get("next_attempt_at"),
        "sent_at": e.get("sent_at"),
        "attempts": e.get("attempts") or 0,
        "error": erreur_de(e.get("last_error")),
        "cancellable": permis and statut == "queued" and not incertain,
        "retryable": permis and statut == "failed",
        **({"note": INCERTAIN} if incertain else {}),
    }


def refus_outbox(reponse: Reponse, valeur: str) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    code = str(corps.get("message") or "")
    if code in REFUS_OUTBOX:
        return RefusCrm(f"Refusé par le CRM : {code} — {REFUS_OUTBOX[code]}.")
    if code == "outbox_not_found" or reponse.statut == 404:
        return RefusCrm(introuvable("outbox", valeur))
    return traduire_refus(reponse, "outbox", valeur)


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_mail_outbox_list(
        workspace: Annotated[str, Field(description="Workspace slug or id")],
        box: Annotated[
            Literal["queued", "sent", "failed"],
            Field(description="queued: waiting to leave (or being sent); sent: delivered to the server; failed: given up"),
        ],
        card_id: Annotated[str | None, Field(description="Only the sends of this affaire")] = None,
        limit: Annotated[int, Field(ge=1, le=100)] = 25,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "status": f"in.({','.join(BOITES[box])})",
            "select": COLONNES,
            "order": ORDRES[box],
            "limit": str(limit + 1),
            "offset": str(offset),
        }
        if card_id is not None:
            parametres["card_id"] = f"eq.{card_id}"
        reponse = await crm.lire(appel.jeton, "mail_outbox", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise traduire_refus(reponse, "workspace", workspace)
        lignes = reponse.corps
        return {
            "box": box,
            "offset": offset,
            "has_more": len(lignes) > limit,
            "sends": [envoi_lu(e) for e in lignes[:limit]],
        }

    moteur.enregistrer(
        serveur,
        crm_mail_outbox_list,
        Declaration(famille="messagerie", action="consulter", espace="workspace:workspace", autres=("card:card_id",)),
        titre="List the outbox: queued, sent or failed emails",
        description=(
            "Lists the emails of the workspace that the person can read, in one box: queued (soonest departure first, "
            "including those being sent), sent (latest first) or failed (latest first), optionally for one affaire. "
            "Each send gives its recipients, subject, sending address, author, scheduled or sent time, attempts, the "
            "error (code and plain sentence) and whether the person may cancel or retry it. Never the body nor the "
            "attachments; the daily digest is not listed."
        ),
    )

    async def crm_mail_outbox_cancel(
        outbox_id: Annotated[str, Field(description="A queued send, from crm_mail_outbox_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "cancel_outbound_email", {"p_outbox_id": outbox_id})
        if not reponse.reussie:
            raise refus_outbox(reponse, outbox_id)
        return {"outbox_id": outbox_id, "status": "cancelled", "cancelled_at": reponse.corps}

    moteur.enregistrer(
        serveur,
        crm_mail_outbox_cancel,
        Declaration(famille="messagerie", action="modifier", espace="outbox:outbox_id"),
        titre="Cancel a queued email",
        description=(
            "Cancels a queued email before it leaves: it will never be sent, and the affaire's history records "
            "« Envoi annulé ». IRREVERSIBLE: confirm with the person first. Only its author or a workspace administrator "
            "who can write on the affaire may cancel. An email being sent, already sent, failed, or whose first attempt "
            "was interrupted (it may have been sent) cannot be cancelled; the refusal says why."
        ),
        destructif=True,
    )

    async def crm_mail_outbox_retry(
        outbox_id: Annotated[str, Field(description="A failed send, from crm_mail_outbox_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "retry_outbound_email", {"p_outbox_id": outbox_id})
        if not reponse.reussie:
            raise refus_outbox(reponse, outbox_id)
        relue = await crm.lire(
            appel.jeton, "mail_outbox", {"id": f"eq.{outbox_id}", "select": "status,next_attempt_at"}
        )
        ligne = relue.corps[0] if relue.reussie and isinstance(relue.corps, list) and len(relue.corps) == 1 else {}
        return {
            "outbox_id": outbox_id,
            # La passe d'envoi a pu le prendre entre-temps : l'état relu est rendu tel quel, et `queued` à défaut.
            "status": ligne.get("status", "queued"),
            "next_attempt_at": ligne.get("next_attempt_at"),
        }

    moteur.enregistrer(
        serveur,
        crm_mail_outbox_retry,
        Declaration(famille="messagerie", action="modifier", espace="outbox:outbox_id"),
        titre="Retry a failed email",
        description=(
            "Puts a failed email back in the queue, to be sent at the next pass, from the sending address chosen at "
            "first. THIS SENDS A MESSAGE: tell the person before calling. It is the same send, not a new email. Only its "
            "author or a workspace administrator who can write on the affaire may retry; the daily quota and the "
            "affaire's availability are checked again."
        ),
    )

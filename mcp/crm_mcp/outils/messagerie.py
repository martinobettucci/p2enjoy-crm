# @spec CRM-104 (docs/BACKLOG.md) — tranche T7 : les trois outils de la famille `messagerie` (décisions 676 et 684)
# @spec docs/SPEC-mcp.md §9.2 decies (la liste et ses précisions : corps affichable, nombre de pièces jointes, identité
#       désignée par son adresse, réponse limitée à l'affaire, refus nommés, ancre `message`), §9.1 (la file de l'écran,
#       `queue_outbound_email`, `destructiveHint` sur l'envoi), §9.3 ; docs/SPEC-cards.md §18 (le fil d'une affaire) ;
#       webapp/src/lib/inbox.ts (`corpsAffichable`, `reduireHtmlEnTexte`) et envoi.ts (`lireIdentitesDisponibles`,
#       `objetDeReponse`), dont les règles sont reprises à l'identique
# @spec CRM-057 (docs/BACKLOG.md) — tranche 2 : l'état lu dans les deux lectures, `read` (décision 708, M1 B) ;
#       docs/SPEC-mail-subsystem.md §18 bis.5 (l'état de la personne, aucun outil pour marquer, lire ne marque pas) ;
#       docs/SPEC-mcp.md §9.2 decies
# @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : `bcc` dans `crm_mail_send`, la copie cachée seule, aucune pièce jointe
#       (décision 708, M2 B) ; docs/SPEC-mail-subsystem.md §19 bis.2 point 9
# @spec CRM-074 (docs/BACKLOG.md) — tranche T4 : les pièces jointes listées dans les deux lectures, et
#       `crm_mail_attachment_get`, qui rend la pièce elle-même en binaire (décisions 788 et 789 ; docs/SPEC-pieces-jointes.md
#       §6, qui révise la ligne « ni lues ni envoyées » de docs/SPEC-mcp.md §9.2 decies : elles se lisent, l'envoi reste exclu)
# @spec INC-335 (docs/BACKLOG.md, correctif de la décision 805, T3) — `crm_mail_send` n'emprunte que les identités de la
#       personne, jamais celle du service ; sans `from_address`, il prend son identité par défaut, à défaut l'unique —
#       docs/SPEC-mcp.md §9.2 decies (famille `messagerie`, action `ajouter`) ; docs/SPEC-mail-subsystem.md §14.2, §19.4
# @spec CRM-128 (docs/BACKLOG.md) — tranche T3 : le connecteur prépare et n'envoie jamais — `crm_mail_prepare`
#       (successeur de `crm_mail_send`, retiré sans alias), `crm_mail_draft_list`, `crm_mail_draft_discard`, ancre `draft`,
#       le lien de relecture ; docs/SPEC-mails-prepares.md §5 ; docs/SPEC-mcp.md §9.2 decies (révisée) ; décision 829
# @spec CRM-137 (docs/BACKLOG.md) — classer un message : `crm_mail_classification_candidates` (`consulter`, les affaires
#       candidates par `classification_candidates`, l'expéditeur connu d'abord) et `crm_mail_classify` (`modifier`, par
#       `classify_message` inchangée) ; docs/SPEC-mcp.md §9.2 septendecies ; docs/SPEC-mail-subsystem.md §26 ;
#       décisions 877, 891 et 893
"""La messagerie d'une affaire, sous l'identité de la personne : lire son fil, lire un message, PRÉPARER un email.

Le connecteur n'envoie jamais (`CRM-128`, décision 829) : `public.prepare_email` écrit un mail préparé, que seule la
personne relit et envoie depuis l'interface web ; la base refuse tout envoi sous le jeton du connecteur. Les lectures
sont celles de l'écran : `mail_messages`, `mail_outbound_identities`, `mail_drafts`.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Annotated, Any
from urllib.parse import quote

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.tools.base import ToolResult
from mcp.types import BlobResourceContents, EmbeddedResource, ImageContent, TextContent
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

#: La longueur de l'extrait d'un message dans le fil (docs/SPEC-mcp.md §9.2 decies).
LONGUEUR_EXTRAIT = 280
#: Le plafond de destinataires d'un envoi, en `to` comme en `cc`.
DESTINATAIRES_MAX = 50
COLONNES_FIL = (
    "id,direction,sent_at,received_at,from_address,from_name,to_addresses,cc_addresses,subject,body_text,body_html,"
    "mail_attachments(id,filename,mime_type,size_bytes,av_status),is_read"
)
#: La borne d'une pièce rendue au connecteur (décision 789 : tout fichier sain jusqu'à 25 Mo).
PIECE_MAX_OCTETS = 25 * 1024 * 1024
#: Le statut d'une pièce, dans le vocabulaire du connecteur : seule `available` se lit.
STATUTS_PIECE = {"clean": "available", "pending": "scanning", "infected": "infected", "skipped": "not_scanned"}
#: Les types rendus comme contenu image ; tout autre fichier est une ressource binaire embarquée.
TYPES_IMAGE = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
COLONNES_MESSAGE = f"{COLONNES_FIL},card_id,classification"

# La réduction du HTML de l'écran (`reduireHtmlEnTexte`, webapp/src/lib/inbox.ts), reprise à l'identique : deux surfaces
# qui montrent le même message en montrent le même texte.
_SCRIPTS_ET_STYLES = re.compile(r"<(script|style)\b[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_BALISES = re.compile(r"<[^>]+>")
_ENTITES = (
    (re.compile(r"&nbsp;", re.IGNORECASE), " "),
    (re.compile(r"&amp;", re.IGNORECASE), "&"),
    (re.compile(r"&lt;", re.IGNORECASE), "<"),
    (re.compile(r"&gt;", re.IGNORECASE), ">"),
    (re.compile(r"&quot;", re.IGNORECASE), '"'),
    (re.compile(r"&#0*39;|&apos;", re.IGNORECASE), "'"),
)
# Les codes de `queue_outbound_email` (migration 0030) puis de `prepare_email` (0162), nommés plutôt que fondus dans le refus uniforme : l'affaire est
# lisible, la personne doit savoir pourquoi l'envoi échoue (décision 684).
REFUS_ENVOI = {
    "forbidden": "you may read this affaire but not write on it, so you cannot send from it",
    "identity_not_available": "this sending identity is not yours to use",
    "card_not_available": "the affaire is archived, in the trash, or has no email address",
    "recipient_required": "give at least one recipient",
    "body_required": "the message text is empty",
    "quota_exceeded": "the daily sending quota of this identity is reached; try again tomorrow",
    # `CRM-128` (migration 0162, docs/SPEC-mails-prepares.md §3.3 à §3.5, §5).
    "reply_outside_card": "you can only reply to an email of this affaire",
    "draft_limit_reached": "200 prepared emails already await your review in this workspace; review or discard some first",
    "draft_not_pending": "this prepared email was already sent or discarded",
    "review_required": "an email prepared through the connector is sent from the CRM, after review",
}
#: Les refus de `classify_message` (`CRM-137`, docs/SPEC-mail-subsystem.md §16) : une phrase par code, jamais le message
#: brut de la base (docs/SPEC-mcp.md §9.3).
REFUS_CLASSEMENT = {
    "forbidden": "you may not file this email in this affaire: writing on it is not open to you",
    "card_not_available": "the affaire is archived or in the trash: it receives no email",
}
#: La phrase de l'état vide de l'écran, pour l'assistant (docs/SPEC-mcp.md §9.2 septendecies).
NOTE_EXPEDITEUR_INCONNU = (
    "The sender is a contact of no affaire. Call again with known_sender: false to list every affaire you may read."
)
#: Ce que l'assistant doit dire à la personne : rien n'est parti (docs/SPEC-mails-prepares.md §5).
NOTE_RELECTURE = "This email is NOT sent. It awaits your review in the CRM: open review_url to review and send it."
COLONNES_BROUILLON = "id,card_id,to_addrs,cc_addrs,subject,body_text,origin,created_at,card:cards(title)"


def reduire_html_en_texte(html: str) -> str:
    texte = _SCRIPTS_ET_STYLES.sub("", html)
    texte = re.sub(r"<br\s*/?>", "\n", texte, flags=re.IGNORECASE)
    texte = re.sub(r"</(p|div|tr|li|h[1-6]|blockquote)\s*>", "\n", texte, flags=re.IGNORECASE)
    texte = _BALISES.sub("", texte)
    for motif, remplacement in _ENTITES:
        texte = motif.sub(remplacement, texte)
    lignes = [re.sub(r"[ \t ]+", " ", ligne).strip() for ligne in texte.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lignes)).strip()


def corps_affichable(texte: str | None, html: str | None) -> tuple[str, bool]:
    """Le corps que l'écran montre, et s'il vient du HTML (`corpsAffichable`) : le texte composé par l'expéditeur
    d'abord, le HTML réduit sinon."""
    if texte is not None and texte.strip():
        return texte.strip(), False
    if html is not None and html.strip():
        return reduire_html_en_texte(html), True
    return "", False


def extrait(corps: str) -> str:
    resserre = re.sub(r"\s+", " ", corps).strip()
    return resserre if len(resserre) <= LONGUEUR_EXTRAIT else resserre[: LONGUEUR_EXTRAIT - 1].rstrip() + "…"


def objet_de_reponse(objet: str | None) -> str:
    """L'objet d'une réponse, préfixé une seule fois (`objetDeReponse`)."""
    propre = (objet or "").strip()
    return propre if re.match(r"^re\s*:", propre, re.IGNORECASE) else f"Re: {propre}"


def pieces(m: dict[str, Any]) -> list[dict[str, Any]]:
    """Les pièces d'un message, par nom : de quoi les demander à `crm_mail_attachment_get`, jamais leur contenu."""
    return [
        {
            "id": p["id"],
            "filename": p.get("filename"),
            "mime_type": p.get("mime_type"),
            "size_bytes": p.get("size_bytes"),
            "status": STATUTS_PIECE.get(p.get("av_status") or "", "not_scanned"),
        }
        for p in sorted(m.get("mail_attachments") or [], key=lambda p: (p.get("filename") or "", p.get("id") or ""))
        if isinstance(p, dict) and "id" in p
    ]


def message_lu(m: dict[str, Any]) -> dict[str, Any]:
    corps, _ = corps_affichable(m.get("body_text"), m.get("body_html"))
    return {
        "id": m["id"],
        "direction": m.get("direction"),
        "sent_at": m.get("sent_at"),
        "received_at": m.get("received_at"),
        "from": {"address": m.get("from_address"), "name": m.get("from_name")},
        "to": m.get("to_addresses") or [],
        "cc": m.get("cc_addresses") or [],
        "subject": m.get("subject"),
        "excerpt": extrait(corps),
        "attachments": pieces(m),
        # L'état lu DE LA PERSONNE que le connecteur représente (`is_read`, §18 bis.5). Le lire n'écrit rien : seul l'écran
        # de l'inbox marque. Une valeur absente n'est pas « lu ».
        "read": m.get("is_read") is True,
    }


def identites_empruntables(lignes: list[dict[str, Any]], sujet: str) -> list[dict[str, Any]]:
    """Celles que la personne peut EMPLOYER, plus étroites que celles qu'elle LIT : les siennes, et elles seules
    (`lireIdentitesDisponibles`). L'identité de service ne sert qu'aux envois automatiques, et la garde la refuse à tous,
    administrateur compris (décision 805, INC-335). Le filtre est une aide ; la garde de la fonction reste la règle."""
    return [i for i in lignes if i.get("owner_id") == sujet]


def choisir_identite(possibles: list[dict[str, Any]], adresse: str | None) -> dict[str, Any]:
    """L'identité désignée par son adresse, sans la casse. Sans adresse : l'identité PAR DÉFAUT de la personne, choisie
    par elle dans les réglages, à défaut l'unique possible (décision 805, qui révise la décision 684 : le défaut n'est
    pas un choix implicite). Plusieurs sans défaut : refus qui nomme les adresses."""
    adresses = ", ".join(sorted(i["from_address"] for i in possibles))
    if not possibles:
        raise RefusCrm("Refusé par le CRM : no_sending_identity — no sending identity is available to you in this workspace.")
    if adresse is None:
        par_defaut = [i for i in possibles if i.get("is_default") is True]
        if len(par_defaut) == 1:
            return par_defaut[0]
        if len(possibles) == 1:
            return possibles[0]
        raise ToolError(f"Several sending identities are available and none is your default; give from_address, one of: {adresses}.")
    voulue = adresse.strip().lower()
    for identite in possibles:
        if identite["from_address"].lower() == voulue:
            return identite
    raise ToolError(f"Unknown sending address {adresse!r}; give one of: {adresses}.")


def _refus_envoi(reponse: Reponse, valeur: str, genre: str = "card") -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    code = str(corps.get("message") or "")
    if code in REFUS_ENVOI:
        return RefusCrm(f"Refusé par le CRM : {code} — {REFUS_ENVOI[code]}.")
    return traduire_refus(reponse, genre, valeur)


def lien_de_relecture(origine_webapp: str, brouillon: str) -> str:
    """L'adresse qui ouvre la relecture d'un mail préparé dans l'inbox (docs/SPEC-mails-prepares.md §6.1)."""
    return f"{origine_webapp}/inbox?brouillon={quote(brouillon, safe='')}"


def brouillon_lu(b: dict[str, Any], origine_webapp: str) -> dict[str, Any]:
    affaire = b.get("card") if isinstance(b.get("card"), dict) else {}
    return {
        "id": b["id"],
        "card_id": b.get("card_id"),
        "card_title": affaire.get("title"),
        "to": b.get("to_addrs") or [],
        "cc": b.get("cc_addrs") or [],
        "subject": b.get("subject"),
        "excerpt": extrait(b.get("body_text") or ""),
        "origin": b.get("origin"),
        "created_at": b.get("created_at"),
        "review_url": lien_de_relecture(origine_webapp, b["id"]),
    }


def _lignes(reponse: Reponse, genre: str, valeur: Any) -> list[dict[str, Any]]:
    if not reponse.reussie or not isinstance(reponse.corps, list):
        raise traduire_refus(reponse, genre, valeur)
    return reponse.corps


def _une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    lignes = _lignes(reponse, genre, valeur)
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm, origine_webapp: str) -> None:
    async def crm_card_mail_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        limit: Annotated[int, Field(ge=1, le=100)] = 25,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        # Ordre total, terminé par `id` : deux messages reçus dans la même milliseconde ne changent pas de place d'une
        # page à l'autre (décision 185).
        lignes = _lignes(
            await crm.lire(
                appel.jeton,
                "mail_messages",
                {
                    "card_id": f"eq.{card_id}",
                    "select": COLONNES_FIL,
                    "order": "received_at.asc,id.asc",
                    "limit": str(limit),
                    "offset": str(offset),
                },
            ),
            "card",
            card_id,
        )
        return {
            "messages": [message_lu(m) for m in lignes],
            "note": "Read an attachment whose status is available with crm_mail_attachment_get.",
            "limit": limit,
            "offset": offset,
            "has_more": len(lignes) == limit,
        }

    moteur.enregistrer(
        serveur,
        crm_card_mail_list,
        Declaration(famille="messagerie", action="consulter", espace="card:card_id"),
        titre="List the emails of an affaire",
        description=(
            "Lists the emails filed in an affaire (card), oldest first: direction, dates, sender, recipients, subject, a "
            "short excerpt, its attachments (id, file name, type, size and status — never their content) and whether the "
            "person has read it in the inbox (read; reading here does not mark it). Read one in full with crm_mail_get, "
            "and an available attachment with crm_mail_attachment_get."
        ),
    )

    async def crm_mail_get(
        message_id: Annotated[str, Field(description="The email message id, from crm_card_mail_list or crm_search")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        m = _une_ligne(
            await crm.lire(appel.jeton, "mail_messages", {"id": f"eq.{message_id}", "select": COLONNES_MESSAGE}),
            "message",
            message_id,
        )
        corps, depuis_html = corps_affichable(m.get("body_text"), m.get("body_html"))
        lu = message_lu(m)
        del lu["excerpt"]
        return {**lu, "card_id": m.get("card_id"), "classification": m.get("classification"), "body": corps,
                "body_from_html": depuis_html}

    moteur.enregistrer(
        serveur,
        crm_mail_get,
        Declaration(famille="messagerie", action="consulter", espace="message:message_id"),
        titre="Read an email",
        description=(
            "Reads one email: headers, the affaire it is filed in, and its text. When the sender wrote only HTML, the "
            "text is reduced from it as the web app does (body_from_html). Its attachments are listed (id, file name, "
            "type, size, status); read an available one with crm_mail_attachment_get. read tells whether the person has "
            "read it in the inbox; reading it here does not mark it read."
        ),
    )

    async def crm_mail_classification_candidates(
        message_id: Annotated[str, Field(description="The email message id, from crm_search or crm_mail_get")],
        known_sender: Annotated[
            bool,
            Field(description="Only the affaires where a contact has the sender's address (true by default, like the CRM)"),
        ] = True,
        search: Annotated[
            str | None, Field(max_length=200, description="Part of the affaire title or of its Track › Channel path")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=100)] = 50,
    ) -> dict[str, Any]:
        appel = appel_courant()
        arguments: dict[str, Any] = {"p_message_id": message_id, "p_known_sender": known_sender, "p_limit": limit}
        if search is not None and search.strip() != "":
            arguments["p_search"] = search.strip()
        reponse = await crm.rpc(appel.jeton, "classification_candidates", arguments)
        lignes = _lignes(reponse, "message", message_id)
        resultat: dict[str, Any] = {
            "message_id": message_id,
            "known_sender": known_sender,
            "affaires": [
                {
                    "card_id": ligne["card_id"],
                    "title": ligne.get("title"),
                    "path": ligne.get("path") or "",
                    "known_sender": ligne.get("known_sender") is True,
                }
                for ligne in lignes
            ],
        }
        if known_sender and not lignes and (search is None or search.strip() == ""):
            resultat["note"] = NOTE_EXPEDITEUR_INCONNU
        return resultat

    moteur.enregistrer(
        serveur,
        crm_mail_classification_candidates,
        Declaration(famille="messagerie", action="consulter", espace="message:message_id"),
        titre="List the affaires an email can be filed in",
        description=(
            "Lists the affaires where an email can be filed, as the CRM proposes them: by default only those where a "
            "contact has the sender's address (known_sender), known ones first, then by title. Archived affaires and "
            "affaires in the trash are never proposed. search narrows by title or Track › Channel path, ignoring case "
            "and accents. File the email with crm_mail_classify."
        ),
    )

    async def crm_mail_classify(
        message_id: Annotated[str, Field(description="The email message id")],
        card_id: Annotated[str, Field(description="The affaire to file it in, from crm_mail_classification_candidates")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "classify_message", {"p_message_id": message_id, "p_card_id": card_id})
        if not reponse.reussie:
            corps = reponse.corps if isinstance(reponse.corps, dict) else {}
            code = str(corps.get("message") or "")
            if code in REFUS_CLASSEMENT:
                raise RefusCrm(f"Refusé par le CRM : {code} — {REFUS_CLASSEMENT[code]}.")
            raise traduire_refus(reponse, "message", message_id)
        return {"message_id": message_id, "card_id": card_id, "status": "filed"}

    moteur.enregistrer(
        serveur,
        crm_mail_classify,
        Declaration(famille="messagerie", action="modifier", espace="message:message_id", autres=("card:card_id",)),
        titre="File an email in an affaire",
        description=(
            "Files an email in an affaire, as the CRM's inbox does: the email then belongs to the affaire's thread. You "
            "must be able to write on the affaire; archived affaires and affaires in the trash are refused. Filing an "
            "email already in that affaire changes nothing."
        ),
    )

    async def crm_mail_attachment_get(
        attachment_id: Annotated[str, Field(description="The attachment id, from crm_mail_get or crm_card_mail_list")],
    ) -> ToolResult:
        appel = appel_courant()
        p = _une_ligne(
            await crm.lire(
                appel.jeton,
                "mail_attachments",
                {"id": f"eq.{attachment_id}", "select": "id,message_id,filename,mime_type,size_bytes,av_status,storage_path"},
            ),
            "attachment",
            attachment_id,
        )
        statut = STATUTS_PIECE.get(p.get("av_status") or "", "not_scanned")
        if statut != "available":
            raise RefusCrm(
                f"Refusé par le CRM : attachment_not_available — this attachment is {statut}; only an attachment the "
                "antivirus found clean can be read."
            )
        trop_grande = (
            "Refusé par le CRM : attachment_too_large — this attachment is larger than 25 MB; ask the person to open it in "
            "the CRM."
        )
        if int(p.get("size_bytes") or 0) > PIECE_MAX_OCTETS:
            raise RefusCrm(trop_grande)
        # SOUS LE JETON DE LA PERSONNE : la politique de stockage de la migration 0029 (pièce saine, message lisible)
        # s'applique telle quelle, sans accès de service.
        code, contenu = await crm.lire_objet(appel.jeton, "mail-attachments", p["storage_path"], PIECE_MAX_OCTETS)
        if code == 413:
            raise RefusCrm(trop_grande)
        if contenu is None:
            raise RefusCrm(introuvable("attachment", attachment_id))
        type_ = (p.get("mime_type") or "application/octet-stream").split(";", 1)[0].strip().lower()
        nom = p.get("filename") or "attachment"
        metadonnees = {"id": p["id"], "message_id": p.get("message_id"), "filename": nom, "mime_type": type_,
                       "size_bytes": len(contenu)}
        donnees = base64.b64encode(contenu).decode("ascii")
        if type_ in TYPES_IMAGE:
            bloc: ImageContent | EmbeddedResource = ImageContent(type="image", data=donnees, mime_type=type_)
        else:
            bloc = EmbeddedResource(
                type="resource",
                resource=BlobResourceContents(uri=f"crm://attachments/{p['id']}/{quote(nom)}", mime_type=type_, blob=donnees),
            )
        return ToolResult(
            content=[TextContent(type="text", text=json.dumps(metadonnees, ensure_ascii=False)), bloc],
            structured_content=metadonnees,
        )

    moteur.enregistrer(
        serveur,
        crm_mail_attachment_get,
        Declaration(famille="messagerie", action="consulter", espace="attachment:attachment_id"),
        titre="Read an email attachment",
        description=(
            "Returns one attachment of an email, the file itself: an image as image content, any other file as an "
            "embedded binary resource with its type and file name, so you can read it your own way. Only an attachment "
            "whose status is available (found clean by the antivirus) can be read, up to 25 MB. Find attachment ids "
            "with crm_mail_get or crm_card_mail_list."
        ),
    )

    async def crm_mail_prepare(
        card_id: Annotated[str, Field(description="The affaire (card) the email will be sent from")],
        to: Annotated[list[str], Field(min_length=1, max_length=DESTINATAIRES_MAX, description="Recipient addresses")],
        body: Annotated[str, Field(min_length=1, max_length=100_000, description="Plain text; the signature is added")],
        subject: Annotated[str | None, Field(max_length=998, description="Required unless replying")] = None,
        cc: Annotated[list[str] | None, Field(max_length=DESTINATAIRES_MAX, description="Copy addresses")] = None,
        bcc: Annotated[
            list[str] | None,
            Field(max_length=DESTINATAIRES_MAX, description="Blind copy addresses: delivered, never shown to recipients"),
        ] = None,
        from_address: Annotated[
            str | None, Field(description="Sending address; defaults to your default sending identity")
        ] = None,
        in_reply_to_message_id: Annotated[
            str | None, Field(description="An email of this affaire you are replying to")
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        destinataires = [a.strip() for a in to if a.strip()]
        copies = [a.strip() for a in (cc or []) if a.strip()]
        copies_cachees = [a.strip() for a in (bcc or []) if a.strip()]
        if in_reply_to_message_id is not None:
            # La base le vérifie aussi (`reply_outside_card`, migration 0162) ; l'outil le dit avant l'appel, et en tire
            # l'objet de la réponse (décision 684).
            origine = _une_ligne(
                await crm.lire(
                    appel.jeton,
                    "mail_messages",
                    {"id": f"eq.{in_reply_to_message_id}", "select": "id,card_id,subject"},
                ),
                "message",
                in_reply_to_message_id,
            )
            if origine.get("card_id") != card_id:
                raise RefusCrm("Refusé par le CRM : reply_outside_card — you can only reply to an email of this affaire.")
            if subject is None or not subject.strip():
                subject = objet_de_reponse(origine.get("subject"))
        if subject is None or not subject.strip():
            raise ToolError("Give a subject.")
        identites = _lignes(
            await crm.lire(
                appel.jeton,
                "mail_outbound_identities",
                {"workspace_id": f"eq.{appel.espace}", "select": "id,label,from_address,owner_id,is_default", "order": "label.asc"},
            ),
            "card",
            card_id,
        )
        identite = choisir_identite(identites_empruntables(identites, appel.sujet), from_address)
        arguments: dict[str, Any] = {
            "p_card_id": card_id,
            "p_identity_id": identite["id"],
            "p_to": destinataires,
            "p_subject": subject.strip(),
            "p_body_text": body,
            "p_cc": copies,
            "p_bcc": copies_cachees,
        }
        if in_reply_to_message_id is not None:
            arguments["p_in_reply_to_message_id"] = in_reply_to_message_id
        reponse = await crm.rpc(appel.jeton, "prepare_email", arguments)
        if not reponse.reussie:
            raise _refus_envoi(reponse, card_id)
        return {
            "draft_id": reponse.corps,
            "status": "pending_review",
            "from_address": identite["from_address"],
            "to": destinataires,
            "cc": copies,
            "bcc": copies_cachees,
            "subject": subject.strip(),
            "review_url": lien_de_relecture(origine_webapp, str(reponse.corps)),
            "note": NOTE_RELECTURE,
        }

    moteur.enregistrer(
        serveur,
        crm_mail_prepare,
        Declaration(
            famille="messagerie",
            action="ajouter",
            espace="card:card_id",
            aussi=(("affaires", "consulter"),),
            autres=("message:in_reply_to_message_id",),
        ),
        titre="Prepare an email from an affaire, for the person to review and send",
        description=(
            "Prepares an email from an affaire (card). NOTHING IS SENT: the email waits in the person's prepared emails, "
            "and only the person, in the CRM's web interface, reviews it, may change it, and sends it. Give the person "
            "the returned review_url. from_address picks one of YOUR sending identities; without it, your default "
            "identity is proposed. in_reply_to_message_id replies to an email of this affaire; bcc adds blind copies. "
            "No attachments: the person may add them while reviewing."
        ),
    )

    async def crm_mail_draft_list(
        workspace: Annotated[str, Field(description="Workspace slug or id")],
        card_id: Annotated[str | None, Field(description="Only the prepared emails of this affaire")] = None,
        limit: Annotated[int, Field(ge=1, le=100)] = 25,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "status": "eq.pending",
            "select": COLONNES_BROUILLON,
            "order": "created_at.asc,id.asc",
            "limit": str(limit + 1),
            "offset": str(offset),
        }
        if card_id is not None:
            parametres["card_id"] = f"eq.{card_id}"
        lignes = _lignes(await crm.lire(appel.jeton, "mail_drafts", parametres), "workspace", workspace)
        return {
            "offset": offset,
            "has_more": len(lignes) > limit,
            "drafts": [brouillon_lu(b, origine_webapp) for b in lignes[:limit]],
        }

    moteur.enregistrer(
        serveur,
        crm_mail_draft_list,
        Declaration(famille="messagerie", action="consulter", espace="workspace:workspace", autres=("card:card_id",)),
        titre="List your prepared emails awaiting review",
        description=(
            "Lists YOUR prepared emails that still await review in the CRM, oldest first, optionally for one affaire: "
            "recipients, subject, an excerpt, and the review_url to give the person. Sent or discarded ones are not listed; "
            "nobody else's prepared emails are ever visible."
        ),
    )

    async def crm_mail_draft_discard(
        draft_id: Annotated[str, Field(description="A prepared email awaiting review")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "discard_email_draft", {"p_draft_id": draft_id})
        if not reponse.reussie:
            raise _refus_envoi(reponse, draft_id, genre="draft")
        return {"draft_id": draft_id, "status": "discarded"}

    moteur.enregistrer(
        serveur,
        crm_mail_draft_discard,
        Declaration(famille="messagerie", action="supprimer", espace="draft:draft_id"),
        titre="Discard a prepared email",
        description=(
            "Discards one of YOUR prepared emails that still awaits review: it will never be sent and leaves the review "
            "list. A prepared email already sent or discarded cannot be discarded."
        ),
        destructif=True,
    )

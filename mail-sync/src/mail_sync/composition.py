# @spec CRM-069 (docs/BACKLOG.md) — tranche T6 : le CRM n'ingère pas ses propres courriels (docs/SPEC-etiquettes-digest.md §5.3 bis,
#       INC-321, décision 780)
# @spec CRM-069 (docs/BACKLOG.md) — tranche T4 : le digest sans affaire — aucun `Reply-To`, le jeton `{site}` remplacé par `SITE_URL`
#       (docs/SPEC-etiquettes-digest.md §5.3, décision 772)
# @spec CRM-058 (docs/BACKLOG.md) — composition d'un message sortant
# @spec docs/SPEC-mail-subsystem.md §5 (envoi), §19.1 (ce que le serveur ne fait pas), §19.5 (ce
#       que le worker compose)
# @spec docs/JOURNAL.md décision 330
# @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : les pièces jointes composées, la copie cachée dans l'enveloppe seule —
#       docs/SPEC-mail-subsystem.md §19 bis.2 points 1 et 7, §19 bis.4 ; décisions 719 et 720
#
# CE MODULE NE PARLE À PERSONNE : ni SMTP, ni HTTP, ni SQL. Il compose un message et rend ses
# en-têtes, ce qui rend la règle du fil éprouvable **sans serveur** — comme l'analyse MIME de
# `CRM-054`, et pour la même raison : le jour où un en-tête sera faux, la preuve le dira sans
# qu'on ait à envoyer quoi que ce soit.
#
# TROIS GARANTIES SONT ICI, ET AUCUNE N'EST TENUE PAR LE TRANSPORT (mesuré, §19.1) :
#   * le `Message-ID` est CHOISI par le produit — le serveur ne le réécrit pas, et c'est lui que
#     le destinataire citera dans sa réponse ;
#   * le `Reply-To` porte l'adresse de la CARD — c'est ce qui ramène les réponses dans le CRM ;
#   * `References` porte la chaîne COMPLÈTE — le parent seul couperait le fil au deuxième
#     aller-retour.

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage


@dataclass(frozen=True)
class PieceEnvoi:
    """Une pièce à joindre : son nom, son type relu en base à la mise en file, son contenu lu dans le stockage."""

    filename: str
    mime_type: str
    contenu: bytes


@dataclass(frozen=True)
class Envoi:
    """Ce que la base rend pour composer un message — `public.reserver_envois`."""

    outbox_id: str
    from_address: str
    #: `None` pour un digest (`CRM-069` T4) : il n'appartient à aucune affaire, et aucune réponse n'a de dossier où revenir.
    reply_to: str | None
    to_addrs: tuple[str, ...]
    cc_addrs: tuple[str, ...] = ()
    subject: str | None = None
    body_text: str = ""
    in_reply_to: str | None = None
    references_ids: tuple[str, ...] = field(default_factory=tuple)
    #: La copie cachée — dans l'ENVELOPPE seulement (§19 bis.2 point 1).
    bcc_addrs: tuple[str, ...] = ()
    pieces: tuple[PieceEnvoi, ...] = ()
    #: Vrai pour un envoi que le CRM écrit seul — le digest (`CRM-069` T6) : il porte `Auto-Submitted: auto-generated`.
    automatique: bool = False


#: Objet de repli. Un message sans objet arrive chez le destinataire sous une ligne vide, que la
#: plupart des clients affichent « (aucun objet) » : le produit choisit plutôt que de subir.
OBJET_PAR_DEFAUT = "(sans objet)"


def identifiant_message(domaine: str, jeton: str | None = None) -> str:
    """Un `Message-ID` du produit, sur le domaine de l'expéditeur.

    LE DOMAINE VIENT DE L'ADRESSE D'EXPÉDITION, jamais d'une constante : un `Message-ID` posé sur
    un domaine que l'expéditeur ne contrôle pas est un identifiant usurpé, et certains filtres le
    traitent comme tel.
    """

    partie = jeton if jeton is not None else uuid.uuid4().hex
    return f"<{partie}@{domaine}>"


def chaine_references(envoi: Envoi) -> tuple[str, ...]:
    """La chaîne `References` à écrire, dédoublonnée et dans l'ordre.

    LE DÉDOUBLONNAGE N'EST PAS COSMÉTIQUE : un fil qui répète un identifiant fait grossir l'en-tête
    à chaque aller-retour, et certains serveurs refusent au-delà d'une taille. L'ORDRE, lui, est
    celui du fil — du plus ancien au plus récent —, et l'inverser désorganiserait l'affichage chez
    tous les clients qui s'y fient.
    """

    chaine: list[str] = []
    for identifiant in (*envoi.references_ids, envoi.in_reply_to):
        if identifiant is None or identifiant == "":
            continue
        if identifiant not in chaine:
            chaine.append(identifiant)
    return tuple(chaine)


def composer(envoi: Envoi, identifiant: str) -> EmailMessage:
    """Compose le message à soumettre, en-têtes de fil compris.

    `In-Reply-To` et `References` ne sont écrits QUE s'il s'agit d'une réponse : un message
    initial qui les porterait vides annoncerait un fil qui n'existe pas.
    """

    message = EmailMessage()
    message["From"] = envoi.from_address
    message["To"] = ", ".join(envoi.to_addrs)
    if envoi.cc_addrs:
        message["Cc"] = ", ".join(envoi.cc_addrs)
    message["Subject"] = envoi.subject if envoi.subject else OBJET_PAR_DEFAUT
    message["Message-ID"] = identifiant
    # LE `Reply-To` DE LA CARD — le mécanisme qui ramène les réponses dans le CRM, quel que soit le
    # serveur d'où le destinataire répond (§5).
    if envoi.reply_to is not None:
        message["Reply-To"] = envoi.reply_to
    # UN COURRIEL DU CRM SE DÉCLARE AUTOMATIQUE (RFC 3834) : la relève d'une boîte synchronisée le reconnaît et ne le
    # réingère pas (§5.3 bis), et un répondeur bien élevé ne lui répond pas.
    if envoi.automatique:
        message["Auto-Submitted"] = "auto-generated"

    references = chaine_references(envoi)
    if envoi.in_reply_to:
        message["In-Reply-To"] = envoi.in_reply_to
    if references:
        message["References"] = " ".join(references)

    message.set_content(envoi.body_text)
    # LES PIÈCES APRÈS LE CORPS : `add_attachment` fait du message un `multipart/mixed` dont le texte reste la première
    # partie, celle que tout client affiche. AUCUN EN-TÊTE `Bcc` n'est écrit, nulle part : c'est la définition même
    # d'une copie cachée, et un en-tête la révélerait à chaque destinataire.
    for piece in envoi.pieces:
        principal, _, secondaire = (piece.mime_type or "application/octet-stream").partition("/")
        message.add_attachment(
            piece.contenu,
            maintype=principal or "application",
            subtype=secondaire or "octet-stream",
            filename=piece.filename,
        )
    return message


def destinataires(envoi: Envoi) -> tuple[str, ...]:
    """Les adresses de l'enveloppe : `To`, `Cc` et la copie cachée.

    LA COPIE CACHÉE N'EXISTE QU'ICI (§19 bis.2 point 1) : `composer` n'en écrit aucun en-tête, et c'est l'enveloppe qui
    la fait remettre. Une adresse répétée n'est donnée qu'une fois — un serveur qui la recevrait deux fois livrerait deux
    copies.
    """

    vues: list[str] = []
    for adresse in (*envoi.to_addrs, *envoi.cc_addrs, *envoi.bcc_addrs):
        if adresse and adresse not in vues:
            vues.append(adresse)
    return tuple(vues)

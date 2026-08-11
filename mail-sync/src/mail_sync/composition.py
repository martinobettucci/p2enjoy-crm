# @spec CRM-058 (docs/BACKLOG.md) — composition d'un message sortant
# @spec docs/SPEC-mail-subsystem.md §5 (envoi), §19.1 (ce que le serveur ne fait pas), §19.5 (ce
#       que le worker compose)
# @spec docs/JOURNAL.md décision 330
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
class Envoi:
    """Ce que la base rend pour composer un message — `public.reserver_envois`."""

    outbox_id: str
    from_address: str
    reply_to: str
    to_addrs: tuple[str, ...]
    cc_addrs: tuple[str, ...] = ()
    subject: str | None = None
    body_text: str = ""
    in_reply_to: str | None = None
    references_ids: tuple[str, ...] = field(default_factory=tuple)


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
    message["Reply-To"] = envoi.reply_to

    references = chaine_references(envoi)
    if envoi.in_reply_to:
        message["In-Reply-To"] = envoi.in_reply_to
    if references:
        message["References"] = " ".join(references)

    message.set_content(envoi.body_text)
    return message


def destinataires(envoi: Envoi) -> tuple[str, ...]:
    """Les adresses de l'enveloppe : `To` et `Cc`.

    LE `Bcc` N'EST PAS LIVRÉ, et son absence est nommée plutôt que silencieuse : la file ne porte
    pas de colonne pour lui, et un champ d'interface sans destination serait un mensonge.
    """

    return (*envoi.to_addrs, *envoi.cc_addrs)

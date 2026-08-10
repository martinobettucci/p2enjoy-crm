# @spec CRM-054 (docs/BACKLOG.md) — relève, dédoublonnage, occurrences, pièces jointes
# @spec CRM-055 (docs/BACKLOG.md) — le classement suit l'ingestion, et ne la conditionne pas
# @spec docs/SPEC-mail-subsystem.md §4.1 (boucle), §4.2 (dédoublonnage), §4.3 (pièces jointes),
#       §15.1 (IDLE annoncé APRÈS authentification), §15.4 (dossiers surveillés),
#       §15.5 (ordre dépôt → analyse, chemin sans nom de fichier)
# @spec docs/JOURNAL.md décision 320
#
# CE MODULE ORCHESTRE, IL NE DÉCIDE PAS. L'analyse MIME vit dans `mime_analyse`, l'antivirus dans
# `antivirus`, l'accès à la base dans `postgrest` : ce fichier enchaîne, et c'est tout. La
# séparation est ce qui rend chaque règle éprouvable sans serveur.
#
# CE QU'IL NE DÉCIDE PAS : le classement. Depuis `CRM-055`, la relève APPELLE la règle — qui vit en
# base, avec toutes les autres —, mais elle ne la porte pas. Un message qu'on ne sait pas classer est
# ingéré quand même et reste « non classé » (§4.4, règle 4).
#
# Il ne crée ni ne renomme aucun dossier IMAP — `CRM-056` —, et ne supprime jamais un message
# d'`INBOX` : il lit, il copie l'information, il laisse la boîte intacte (§4.5).

from __future__ import annotations

import ssl
from dataclasses import dataclass

from imapclient import IMAPClient

from mail_sync import antivirus
from mail_sync.dossiers import (
    copier_message,
    creer_arborescence,
    renommer_dossier,
    supporte_les_dossiers,
)
from mail_sync.mime_analyse import analyser
from mail_sync.postgrest import PostgrestClient


@dataclass(frozen=True)
class ResultatReleve:
    """Ce qu'une relève a produit, en faits comptables."""

    dossiers: int = 0
    messages_vus: int = 0
    messages_nouveaux: int = 0
    messages_classes: int = 0
    occurrences: int = 0
    pieces: int = 0
    pieces_infectees: int = 0
    dossiers_crees: int = 0
    dossiers_renommes: int = 0


def chemin_de_depot(workspace_id: str, message_id: str, sha256: str) -> str:
    """`<workspace_id>/<message_id>/<sha256>` — et JAMAIS le nom du fichier (§15.5).

    Un nom d'origine dans un chemin de stockage est une traversée de répertoire qui attend son
    heure ; l'empreinte suffit à distinguer deux pièces, et deux pièces identiques partagent alors
    le même objet, ce qui est exactement le comportement voulu.
    """

    return f"{workspace_id}/{message_id}/{sha256}"


def _connecter(compte, timeout: float) -> IMAPClient:  # type: ignore[no-untyped-def]
    client = IMAPClient(
        host=compte.host,
        port=compte.port,
        use_uid=True,
        ssl=compte.security == "ssl",
        ssl_context=ssl.create_default_context() if compte.security == "ssl" else None,
        timeout=timeout,
    )
    if compte.security == "starttls":
        client.starttls(ssl.create_default_context())
    client.login(compte.username, compte.password or "")
    return client


def ranger_dans_dossier(
    *,
    imap,  # IMAPClient
    client_base: PostgrestClient,
    account_id: str,
    card_id: str,
    dossier_source: str,
    uid: int,
) -> bool:
    """Crée `CRM/<Track>/<Channel>/<Card>` s'il le faut, y COPIE le message, et mémorise le chemin.

    Le chemin RÉEL est relu après création — le serveur ré-encode les noms (§17.1) — et c'est lui
    qui sert de cible à la copie comme de valeur à la correspondance. Le dossier source est
    resélectionné ensuite : `copier_message` a changé de dossier courant, et la boucle de relève
    poursuit sur celui qu'elle croyait ouvert.
    """

    chemin = client_base.chemin_dossier_card(card_id)
    if chemin is None:
        return False

    cree = creer_arborescence(imap, chemin)
    client_base.enregistrer_dossier(
        account_id=account_id,
        entity_type="card",
        entity_id=card_id,
        requested_path=cree.requested_path,
        actual_path=cree.actual_path,
    )
    copie = copier_message(imap, dossier_source, uid, cree.actual_path)
    imap.select_folder(dossier_source, readonly=True)
    return copie


def relever_compte(
    *,
    client_base: PostgrestClient,
    compte,  # InboundCredentials
    workspace_id: str,
    dossiers: list[str],
    clamav_hote: str,
    clamav_port: int,
    taille_max_octets: int,
    timeout: float = 30.0,
) -> ResultatReleve:
    """Relève un compte une fois, et rend ce qu'elle a produit.

    LA RELÈVE EST IDEMPOTENTE, et c'est le dédoublonnage qui le garantit : un message déjà connu
    n'est pas réinséré, seule une **occurrence** est ajoutée (§4.2). Rejouer une relève ne crée
    donc rien de neuf, ce qui rend la preuve rejouable sans nettoyage.
    """

    vus = nouveaux = classes = occurrences = pieces = infectees = ranges = renommes = 0
    imap = _connecter(compte, timeout)
    try:
        # LA CAPACITÉ EST RELUE APRÈS AUTHENTIFICATION (§15.1) : `IDLE` n'est pas annoncé avant, et
        # un client qui lirait la capacité initiale conclurait à tort que le serveur ne sait pas
        # veiller. La valeur n'est pas employée ici — la relève est explicite — mais elle est
        # journalisable, et `CRM-059` s'en servira.
        capacites = imap.capabilities()
        # LE MODÈLE DE DOSSIERS EST ÉCARTÉ SUR UN SERVEUR À LABELS (§4.5) : copier dans un dossier
        # y créerait un doublon visible. La détection est positive sur l'inadaptation.
        dossiers_utilisables = supporte_les_dossiers(tuple(capacites))

        # LE RENOMMAGE PRÉCÈDE LA RELÈVE, et l'ordre compte : un dossier renommé après coup
        # laisserait les messages de ce passage dans l'ancien chemin, et l'arborescence
        # divergerait pour de bon (§4.5).
        if dossiers_utilisables:
            for divergence in client_base.dossiers_a_renommer(compte.account_id):
                nouveau = renommer_dossier(
                    imap, divergence["actual_path"], divergence["nouveau_chemin"]
                )
                if nouveau is None:
                    continue
                client_base.enregistrer_dossier(
                    account_id=compte.account_id,
                    entity_type="card",
                    entity_id=divergence["entity_id"],
                    requested_path=divergence["nouveau_chemin"],
                    actual_path=nouveau,
                )
                renommes += 1

        for dossier in dossiers:
            try:
                imap.select_folder(dossier, readonly=True)
            except Exception:  # noqa: BLE001
                # Un dossier absent d'une boîte n'arrête pas la relève des autres : `Junk Mail`
                # n'existe pas sur tous les serveurs, et l'exiger rendrait le produit dépendant
                # d'une convention qui n'est pas universelle.
                continue

            uids = imap.search(["ALL"])
            for uid, donnees in imap.fetch(uids, ["RFC822"]).items():
                brut = donnees.get(b"RFC822")
                if not brut:
                    continue
                vus += 1
                analyse = analyser(brut)

                message_id, cree = client_base.enregistrer_message(
                    workspace_id=workspace_id,
                    analyse=analyse,
                )
                if cree:
                    nouveaux += 1

                if cree:
                    # LE CLASSEMENT SUIT L'INGESTION, ET NE LA CONDITIONNE PAS : un message qu'on
                    # ne sait pas classer est ingéré quand même, et reste « non classé » (§4.4,
                    # règle 4). L'inverse perdrait du courrier faute d'une adresse reconnue.
                    carte = client_base.classer_automatiquement(
                        message_id, analyse.in_reply_to, analyse.references
                    )
                    if carte is not None:
                        classes += 1
                        # LE DOSSIER SUIT LE CLASSEMENT, ET NE LE CONDITIONNE PAS : un dossier
                        # qu'on ne sait pas créer ne doit pas empêcher un message d'être rangé en
                        # base. La copie est un confort d'exploitation, le classement est le fait.
                        if dossiers_utilisables and ranger_dans_dossier(
                            imap=imap,
                            client_base=client_base,
                            account_id=compte.account_id,
                            card_id=carte,
                            dossier_source=dossier,
                            uid=int(uid),
                        ):
                            ranges += 1

                if client_base.enregistrer_occurrence(
                    message_id=message_id,
                    account_id=compte.account_id,
                    folder=dossier,
                    uid=int(uid),
                ):
                    occurrences += 1

                if not cree:
                    # Les pièces d'un message déjà connu ont déjà été déposées et analysées :
                    # les redéposer produirait le même objet et une seconde ligne, sans rien
                    # apprendre.
                    continue

                for piece in analyse.pieces:
                    pieces += 1
                    if piece.size_bytes > taille_max_octets:
                        # LA PIÈCE NE DISPARAÎT JAMAIS SILENCIEUSEMENT (§4.3) : elle est
                        # enregistrée `skipped`, donc non téléchargeable, et visible.
                        client_base.enregistrer_piece(
                            message_id=message_id,
                            filename=piece.filename,
                            original_name=piece.original_name,
                            mime_type=piece.mime_type,
                            size_bytes=piece.size_bytes,
                            storage_path=chemin_de_depot(workspace_id, message_id, piece.sha256),
                            sha256=piece.sha256,
                            av_status=antivirus.SKIPPED,
                        )
                        continue

                    chemin = chemin_de_depot(workspace_id, message_id, piece.sha256)
                    # LE DÉPÔT PRÉCÈDE L'ANALYSE (§15.5) : une pièce infectée est conservée pour
                    # investigation, ce qui serait impossible si le dépôt attendait un verdict.
                    client_base.deposer_objet(chemin, piece.contenu, piece.mime_type)
                    verdict = antivirus.analyser_contenu(
                        piece.contenu, hote=clamav_hote, port=clamav_port, timeout=timeout
                    )
                    if verdict.statut == antivirus.INFECTED:
                        infectees += 1
                    client_base.enregistrer_piece(
                        message_id=message_id,
                        filename=piece.filename,
                        original_name=piece.original_name,
                        mime_type=piece.mime_type,
                        size_bytes=piece.size_bytes,
                        storage_path=chemin,
                        sha256=piece.sha256,
                        av_status=verdict.statut,
                    )
    finally:
        try:
            imap.logout()
        except Exception:  # noqa: BLE001
            pass

    return ResultatReleve(
        dossiers=len(dossiers),
        messages_vus=vus,
        messages_nouveaux=nouveaux,
        messages_classes=classes,
        occurrences=occurrences,
        pieces=pieces,
        pieces_infectees=infectees,
        dossiers_crees=ranges,
        dossiers_renommes=renommes,
    )

# @spec CRM-056 (docs/BACKLOG.md) — dossiers IMAP imbriqués
# @spec docs/SPEC-mail-subsystem.md §4.5 (dossiers, labels Gmail, jamais de suppression),
#       §17.1 (le nom créé n'est pas le nom demandé), §17.2 (ce que l'unité livre)
# @spec docs/JOURNAL.md décision 323
#
# LE WORKER NE SUPPRIME JAMAIS UN MESSAGE D'`INBOX` : IL COPIE (§4.5). Décider à la place de
# l'utilisateur de retirer un message de sa boîte serait destructif, et rien dans le produit ne le
# lui a demandé.
#
# LE NOM CRÉÉ N'EST PAS LE NOM DEMANDÉ, ET C'EST MESURÉ : `Conseil & IA` revient `Conseil &- IA`,
# en UTF-7 modifié de la RFC 3501. Le chemin réel est donc RELU après création, jamais supposé.

from __future__ import annotations

from dataclasses import dataclass


#: Capacité annoncée par Gmail. Le modèle de dossiers y est inadapté — un message y porte des
#: LABELS, et copier dans un dossier créerait un doublon visible (§4.5).
CAPACITE_GMAIL = b"X-GM-EXT-1"


@dataclass(frozen=True)
class DossierCree:
    """Ce qu'une création a réellement produit."""

    requested_path: str
    actual_path: str


def supporte_les_dossiers(capacites: tuple[bytes, ...]) -> bool:
    """Vrai lorsque le modèle de dossiers convient, faux pour un serveur à labels.

    La détection est POSITIVE sur l'inadaptation, non sur l'adaptation : un serveur inconnu est
    traité comme un serveur à dossiers, ce qui est le cas général. Supposer l'inverse priverait de
    classement tout serveur que le produit ne connaît pas encore.
    """

    return CAPACITE_GMAIL not in capacites


def segments(chemin: str) -> list[str]:
    """Les chemins intermédiaires à créer, du plus court au plus long.

    Chaque niveau se crée séparément — mesuré (§17.1) —, et un `CREATE` sur un dossier existant
    n'est pas une erreur pour le produit : c'est l'état voulu.
    """

    morceaux = [morceau for morceau in chemin.split("/") if morceau]
    return ["/".join(morceaux[: rang + 1]) for rang in range(len(morceaux))]


def creer_arborescence(imap, chemin: str) -> DossierCree:  # type: ignore[no-untyped-def]
    """Crée le chemin niveau par niveau et RELIT ce que le serveur a retenu.

    LE CHEMIN RÉEL EST RELU, JAMAIS SUPPOSÉ. Sans cette relecture, `mail_folder_map` porterait le
    nom demandé des deux côtés, et le dossier deviendrait introuvable au premier caractère
    ré-encodé (§17.1).
    """

    # LA LISTE EST LUE D'ABORD, ET C'EST UNE CORRECTION MESURÉE. La version précédente appelait
    # `CREATE` sur chaque niveau à CHAQUE relève : le serveur répondait « Mailbox … already
    # exists », l'erreur était avalée, mais la bibliothèque la journalisait en AVERTISSEMENT dès
    # que le nom portait un caractère non ASCII — « An error occurred while decoding … in ASCII
    # 'strict' mode ». Un fonctionnement normal ne doit pas produire d'avertissement (CLAUDE.md
    # §20), et une erreur attendue à chaque passage finit par masquer celles qui ne le sont pas.
    existants = _noms_existants(imap)
    souscrits = _noms_souscrits(imap)

    for niveau in segments(chemin):
        if niveau not in existants and niveau.replace("&", "&-") not in existants:
            try:
                imap.create_folder(niveau)
            except Exception:  # noqa: BLE001
                # Une course entre deux relèves peut encore faire échouer la création ; c'est
                # l'état voulu, et s'y arrêter empêcherait le classement du message en cours.
                pass
        # CRÉER NE SUFFIT PAS : IL FAUT S'ABONNER. Mesuré dans Roundcube — un dossier créé mais
        # non abonné n'apparaît PAS dans la liste d'un client de messagerie, qui n'affiche par
        # défaut que les dossiers souscrits (RFC 3501 §6.3.6). L'arborescence existait donc côté
        # serveur et restait invisible pour l'utilisateur : un rangement que personne ne voit ne
        # range rien. Défaut trouvé par l'observation visuelle, pas par l'API.
        #
        # La souscription est vérifiée séparément de l'existence : un dossier créé AVANT cette
        # correction existe sans être souscrit, et doit le devenir sans qu'on le recrée.
        if niveau not in souscrits and niveau.replace("&", "&-") not in souscrits:
            try:
                imap.subscribe_folder(niveau)
            except Exception:  # noqa: BLE001
                # Un serveur sans souscription n'empêche pas le rangement : le dossier existe, et
                # c'est le fait principal.
                pass

    reel = chemin
    demande_normalise = chemin.replace("&", "&-")
    for candidat in _noms_existants(imap):
        if candidat in (chemin, demande_normalise):
            reel = candidat
            break

    return DossierCree(requested_path=chemin, actual_path=reel)


def _texte(nom) -> str:  # type: ignore[no-untyped-def]
    """Un nom de dossier, quelle que soit la forme rendue par la bibliothèque."""

    return nom if isinstance(nom, str) else nom.decode("utf-8", errors="replace")


def _noms_existants(imap) -> list[str]:  # type: ignore[no-untyped-def]
    try:
        return [_texte(nom) for _drapeaux, _delimiteur, nom in imap.list_folders()]
    except Exception:  # noqa: BLE001
        # Une liste illisible ne doit pas empêcher le classement : on retombe sur l'ancien
        # comportement — tenter la création —, jamais sur un abandon silencieux.
        return []


def _noms_souscrits(imap) -> list[str]:  # type: ignore[no-untyped-def]
    lister = getattr(imap, "list_sub_folders", None)
    if lister is None:
        return []
    try:
        return [_texte(nom) for _drapeaux, _delimiteur, nom in lister()]
    except Exception:  # noqa: BLE001
        return []


def copier_message(imap, dossier_source: str, uid: int, dossier_cible: str) -> bool:  # type: ignore[no-untyped-def]
    """Copie un message vers son dossier de card. Rend `False` si le serveur a refusé.

    COPIE, ET NON DÉPLACEMENT : le message reste dans la boîte où l'utilisateur l'attend. Le §4.5
    l'écrit, et ce n'est pas une précaution — c'est la différence entre ranger et faire disparaître.
    """

    try:
        imap.select_folder(dossier_source, readonly=True)
        imap.copy([uid], dossier_cible)
        return True
    except Exception:  # noqa: BLE001
        # Une copie refusée n'annule pas l'ingestion : le message est en base, classé, et seule sa
        # présence dans un dossier manque. Le taire serait pire ; l'appelant journalise.
        return False


def renommer_dossier(imap, ancien: str, nouveau: str) -> str | None:  # type: ignore[no-untyped-def]
    """Renomme un dossier et rend son nouveau chemin réel, ou `None` si le serveur a refusé.

    LE RENOMMAGE EMPORTE LES ENFANTS — mesuré (§17.1) —, ce qui évite de reconstruire une
    arborescence et, surtout, d'y perdre les messages déjà rangés. Créer un nouveau dossier puis y
    recopier serait destructif au premier échec partiel.

    Les niveaux intermédiaires du NOUVEAU chemin sont créés d'abord : `RENAME` vers
    `CRM/Nouveau track/Channel/Card` échoue si `CRM/Nouveau track` n'existe pas.
    """

    if ancien == nouveau:
        return ancien
    parents = segments(nouveau)[:-1]
    for niveau in parents:
        try:
            imap.create_folder(niveau)
        except Exception:  # noqa: BLE001
            pass
    try:
        imap.rename_folder(ancien, nouveau)
    except Exception:  # noqa: BLE001
        return None
    # LE RENOMMAGE NE TRANSPORTE PAS LA SOUSCRIPTION sur tous les serveurs : le dossier renommé
    # redeviendrait invisible dans un client, alors même que le produit vient de le ranger.
    try:
        imap.subscribe_folder(nouveau)
    except Exception:  # noqa: BLE001
        pass
    return nouveau

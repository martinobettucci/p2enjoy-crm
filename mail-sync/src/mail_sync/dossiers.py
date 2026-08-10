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

    for niveau in segments(chemin):
        try:
            imap.create_folder(niveau)
        except Exception:  # noqa: BLE001
            # Un dossier déjà présent rend une erreur chez la plupart des serveurs ; c'est l'état
            # voulu, et s'y arrêter empêcherait toute seconde relève.
            pass

    reel = chemin
    demande_normalise = chemin.replace("&", "&-")
    for _drapeaux, _delimiteur, nom in imap.list_folders():
        candidat = nom if isinstance(nom, str) else nom.decode("utf-8", errors="replace")
        if candidat in (chemin, demande_normalise):
            reel = candidat
            break

    return DossierCree(requested_path=chemin, actual_path=reel)


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

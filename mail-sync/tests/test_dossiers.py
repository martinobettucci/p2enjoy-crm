# @verifies CRM-056 (docs/BACKLOG.md) — dossiers IMAP imbriqués
# @verifies docs/SPEC-mail-subsystem.md §4.5 (dossiers, labels Gmail, copie et non déplacement),
#           §17.1 (le nom créé n'est pas le nom demandé)

from __future__ import annotations

import pytest

from mail_sync.dossiers import (
    CAPACITE_GMAIL,
    DossierCree,
    copier_message,
    creer_arborescence,
    segments,
    supporte_les_dossiers,
)


def test_chaque_niveau_est_cree_separement() -> None:
    """Mesuré (§17.1) : `CREATE` ne crée pas les parents. Un chemin de trois niveaux en demande
    trois."""

    assert segments("CRM/Track/Channel") == ["CRM", "CRM/Track", "CRM/Track/Channel"]


def test_un_chemin_a_segments_vides_ne_produit_pas_de_niveau_fantome() -> None:
    assert segments("CRM//Track/") == ["CRM", "CRM/Track"]


@pytest.mark.parametrize(
    ("capacites", "attendu"),
    [
        ((b"IMAP4rev2", b"IDLE"), True),
        ((b"IMAP4rev2", CAPACITE_GMAIL), False),
        ((), True),
    ],
)
def test_les_labels_gmail_ecartent_le_modele_de_dossiers(
    capacites: tuple[bytes, ...], attendu: bool
) -> None:
    """La détection est POSITIVE sur l'inadaptation : un serveur inconnu est traité comme un
    serveur à dossiers, ce qui est le cas général."""

    assert supporte_les_dossiers(capacites) is attendu


class FauxImap:
    """Un serveur qui RÉ-ENCODE les noms, comme Stalwart le fait — mesuré (§17.1)."""

    def __init__(self, refuse_existants: bool = True) -> None:
        self.dossiers: list[str] = []
        self.copies: list[tuple[str, int, str]] = []
        self.selectionne: str | None = None
        self.refuse_existants = refuse_existants

    def create_folder(self, nom: str) -> None:
        if nom in self.dossiers and self.refuse_existants:
            raise RuntimeError("ALREADYEXISTS")
        # LE RÉ-ENCODAGE : `&` s'écrit `&-` en UTF-7 modifié (RFC 3501).
        self.dossiers.append(nom.replace("&", "&-"))

    def list_folders(self) -> list[tuple[tuple[()], str, str]]:
        return [((), "/", nom) for nom in self.dossiers]

    def select_folder(self, nom: str, readonly: bool = False) -> None:
        self.selectionne = nom

    def copy(self, uids: list[int], cible: str) -> None:
        self.copies.append((self.selectionne or "", uids[0], cible))


def test_le_chemin_REEL_est_relu_et_non_suppose() -> None:
    """LE CŒUR DE LA DÉCISION 323 : sans relecture, la correspondance porterait le nom demandé des
    deux côtés, et le dossier deviendrait introuvable au premier caractère ré-encodé."""

    imap = FauxImap()
    resultat = creer_arborescence(imap, "CRM/Conseil & IA")

    assert resultat == DossierCree(
        requested_path="CRM/Conseil & IA", actual_path="CRM/Conseil &- IA"
    )
    assert resultat.requested_path != resultat.actual_path


def test_un_dossier_deja_present_n_arrete_pas_la_creation() -> None:
    """Un `CREATE` sur un dossier existant rend une erreur chez la plupart des serveurs, et c'est
    l'état voulu : s'y arrêter empêcherait toute seconde relève."""

    imap = FauxImap()
    creer_arborescence(imap, "CRM/Track")
    resultat = creer_arborescence(imap, "CRM/Track")
    assert resultat.actual_path == "CRM/Track"


def test_le_message_est_COPIE_et_jamais_deplace() -> None:
    """§4.5 : décider à la place de l'utilisateur de retirer un message de sa boîte serait
    destructif. Le faux serveur n'expose d'ailleurs aucun `move`."""

    imap = FauxImap()
    assert copier_message(imap, "INBOX", 42, "CRM/Track/Channel/Card") is True
    assert imap.copies == [("INBOX", 42, "CRM/Track/Channel/Card")]
    assert not hasattr(imap, "move")


def test_une_copie_refusee_est_dite_et_n_interrompt_rien() -> None:
    class ImapQuiRefuse(FauxImap):
        def copy(self, uids: list[int], cible: str) -> None:
            raise RuntimeError("NO permission denied")

    assert copier_message(ImapQuiRefuse(), "INBOX", 1, "CRM/x") is False

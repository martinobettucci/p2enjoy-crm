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
        self.souscrits: list[str] = []
        self.creations: list[str] = []
        self.copies: list[tuple[str, int, str]] = []
        self.selectionne: str | None = None
        self.refuse_existants = refuse_existants

    def subscribe_folder(self, nom: str) -> None:
        self.souscrits.append(nom)

    def create_folder(self, nom: str) -> None:
        self.creations.append(nom)
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


def test_une_seconde_releve_ne_recree_AUCUN_dossier() -> None:
    """LA CORRECTION MESURÉE : recréer un dossier existant à chaque relève faisait répondre au
    serveur « Mailbox … already exists », et la bibliothèque journalisait un AVERTISSEMENT en
    tentant de décoder ce message quand le nom portait un caractère non ASCII. Un fonctionnement
    normal ne produit pas d'avertissement (CLAUDE.md §20)."""

    imap = FauxImap()
    creer_arborescence(imap, "CRM/Track/Channel")
    creations_initiales = list(imap.creations)
    assert creations_initiales == ["CRM", "CRM/Track", "CRM/Track/Channel"]

    imap.creations.clear()
    creer_arborescence(imap, "CRM/Track/Channel")
    assert imap.creations == []


def test_un_dossier_deja_SOUSCRIT_n_est_pas_re_souscrit() -> None:
    """La souscription est vérifiée séparément de l'existence : un dossier créé avant la
    correction existe sans être souscrit et doit le devenir, tandis qu'un dossier déjà souscrit
    n'a pas à l'être une seconde fois à chaque relève."""

    class ImapAvecSouscriptions(FauxImap):
        def list_sub_folders(self) -> list[tuple[tuple[()], str, str]]:
            return [((), "/", nom) for nom in self.souscrits]

    imap = ImapAvecSouscriptions()
    creer_arborescence(imap, "CRM/Track")
    assert imap.souscrits == ["CRM", "CRM/Track"]

    creer_arborescence(imap, "CRM/Track")
    assert imap.souscrits == ["CRM", "CRM/Track"]


def test_un_dossier_existant_mais_NON_souscrit_le_devient() -> None:
    """Le cas de reprise : l'arborescence posée avant `CRM-056` existe côté serveur sans être
    souscrite, donc invisible dans un client. Une relève suffit à la rendre visible, sans rien
    recréer."""

    class ImapAvecSouscriptions(FauxImap):
        def list_sub_folders(self) -> list[tuple[tuple[()], str, str]]:
            return [((), "/", nom) for nom in self.souscrits]

    imap = ImapAvecSouscriptions()
    imap.dossiers.extend(["CRM", "CRM/Track"])
    imap.creations.clear()

    creer_arborescence(imap, "CRM/Track")

    assert imap.creations == []
    assert imap.souscrits == ["CRM", "CRM/Track"]


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


# =================================================================================================
# Le renommage propagé — §4.5
# =================================================================================================


class ImapAvecRenommage(FauxImap):
    def __init__(self) -> None:
        super().__init__()
        self.renommages: list[tuple[str, str]] = []

    def rename_folder(self, ancien: str, nouveau: str) -> None:
        if ancien not in self.dossiers:
            raise RuntimeError("NONEXISTENT")
        self.renommages.append((ancien, nouveau))
        # LE RENOMMAGE EMPORTE LES ENFANTS — mesuré contre le vrai serveur (§17.1).
        self.dossiers = [
            nouveau + d[len(ancien) :] if d == ancien or d.startswith(ancien + "/") else d
            for d in self.dossiers
        ]


def test_le_renommage_emporte_les_enfants() -> None:
    """C'est ce qui rend le §4.5 tenable : renommer un track renomme ses channels et ses cards sans
    reconstruire l'arborescence — donc sans risquer d'y perdre les messages déjà rangés."""

    imap = ImapAvecRenommage()
    creer_arborescence(imap, "CRM/Ancien/Channel/Card")

    from mail_sync.dossiers import renommer_dossier

    assert renommer_dossier(imap, "CRM/Ancien", "CRM/Nouveau") == "CRM/Nouveau"
    assert "CRM/Nouveau/Channel/Card" in imap.dossiers
    assert "CRM/Ancien/Channel/Card" not in imap.dossiers


def test_les_parents_du_nouveau_chemin_sont_crees_avant_le_renommage() -> None:
    """`RENAME` vers `CRM/Nouveau track/Channel/Card` échoue si `CRM/Nouveau track` n'existe pas."""

    imap = ImapAvecRenommage()
    creer_arborescence(imap, "CRM/T/C/Ancienne card")

    from mail_sync.dossiers import renommer_dossier

    assert (
        renommer_dossier(imap, "CRM/T/C/Ancienne card", "CRM/T2/C2/Nouvelle card")
        == "CRM/T2/C2/Nouvelle card"
    )
    assert "CRM/T2" in imap.dossiers and "CRM/T2/C2" in imap.dossiers


def test_un_renommage_sans_changement_ne_touche_a_rien() -> None:
    imap = ImapAvecRenommage()
    creer_arborescence(imap, "CRM/T")

    from mail_sync.dossiers import renommer_dossier

    assert renommer_dossier(imap, "CRM/T", "CRM/T") == "CRM/T"
    assert imap.renommages == []


def test_un_renommage_refuse_est_dit_et_n_ecrase_pas_la_correspondance() -> None:
    """Rendre `None` plutôt qu'un chemin optimiste : écrire une correspondance vers un dossier qui
    n'existe pas rendrait tout classement ultérieur silencieusement inutile."""

    from mail_sync.dossiers import renommer_dossier

    imap = ImapAvecRenommage()
    assert renommer_dossier(imap, "CRM/Inexistant", "CRM/Autre") is None


def test_chaque_niveau_est_SOUSCRIT_et_pas_seulement_cree() -> None:
    """DÉFAUT TROUVÉ DANS ROUNDCUBE, PAS PAR L'API : un dossier créé mais non souscrit n'apparaît
    pas dans la liste d'un client de messagerie, qui n'affiche par défaut que les dossiers
    souscrits. L'arborescence existait côté serveur et restait invisible pour l'utilisateur."""

    imap = FauxImap()
    creer_arborescence(imap, "CRM/Track/Channel/Card")
    assert imap.souscrits == ["CRM", "CRM/Track", "CRM/Track/Channel", "CRM/Track/Channel/Card"]


def test_le_dossier_renomme_est_souscrit_a_son_tour() -> None:
    """Le renommage ne transporte pas la souscription sur tous les serveurs : le dossier
    redeviendrait invisible alors même que le produit vient de l'y ranger."""

    from mail_sync.dossiers import renommer_dossier

    imap = ImapAvecRenommage()
    creer_arborescence(imap, "CRM/Ancien")
    imap.souscrits.clear()
    renommer_dossier(imap, "CRM/Ancien", "CRM/Nouveau")
    assert "CRM/Nouveau" in imap.souscrits

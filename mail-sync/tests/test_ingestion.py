# @verifies CRM-059 (docs/BACKLOG.md) — la reprise d'un rangement manqué, dette de `CRM-056`
# @verifies docs/SPEC-mail-subsystem.md §20.5 (la dette) ; docs/JOURNAL.md décision 342
#
# CE QUE CETTE SUITE MESURE. La DÉCISION de `reprendre_rangements_manques` — quels messages
# reprendre, quand marquer le fait fermé, quand ne pas le marquer — sans jamais parler à un vrai
# serveur IMAP ni à une vraie base : les deux sont des doublures qui enregistrent ce qu'on leur
# demande.

from __future__ import annotations

from mail_sync.ingestion import reprendre_rangements_manques


class FauxImapRangement:
    """Un serveur minimal : `select_folder` et `copy` réussissent toujours, sauf indication
    contraire — le refus d'une copie précise est ce que `test_dossiers.py` éprouve déjà."""

    def __init__(self, refuse_copie_pour: set[int] | None = None) -> None:
        self.refuse_copie_pour = refuse_copie_pour or set()
        self.copies: list[tuple[str, int, str]] = []
        self.selectionne: str | None = None
        self.dossiers: list[str] = []
        self.souscrits: list[str] = []
        self.creations: list[str] = []

    def list_folders(self):
        return [((), "/", nom) for nom in self.dossiers]

    def create_folder(self, nom: str) -> None:
        self.creations.append(nom)
        self.dossiers.append(nom)

    def subscribe_folder(self, nom: str) -> None:
        self.souscrits.append(nom)

    def select_folder(self, nom: str, readonly: bool = False) -> None:
        self.selectionne = nom

    def copy(self, uids: list[int], cible: str) -> None:
        if uids[0] in self.refuse_copie_pour:
            raise RuntimeError("NO permission denied")
        self.copies.append((self.selectionne or "", uids[0], cible))


class FauxClientBaseRangement:
    """Un `PostgrestClient` minimal : rend une liste de rangements manqués fixée d'avance, et
    enregistre chaque appel plutôt que de parler à une vraie base."""

    def __init__(self, a_ranger: list[dict]) -> None:
        self._a_ranger = a_ranger
        self.marques: list[str] = []
        self.dossiers_enregistres: list[dict] = []

    def messages_a_ranger(self, account_id: str) -> list[dict]:
        assert account_id == "compte-1"
        return self._a_ranger

    def marquer_message_range(self, message_id: str) -> None:
        self.marques.append(message_id)

    def chemin_dossier_card(self, card_id: str) -> str | None:
        if card_id == "card-sans-chemin":
            return None
        return f"CRM/Track/Channel/{card_id}"

    def parents_de_card(self, card_id: str) -> list[dict]:
        return []

    def enregistrer_dossier(self, **kwargs) -> None:
        self.dossiers_enregistres.append(kwargs)


def test_un_message_repris_avec_succes_est_marque() -> None:
    imap = FauxImapRangement()
    base = FauxClientBaseRangement(
        [{"message_id": "m1", "card_id": "card-1", "folder": "INBOX", "uid": 42}]
    )

    assert reprendre_rangements_manques(imap=imap, client_base=base, account_id="compte-1") == 1
    assert base.marques == ["m1"]
    assert imap.copies == [("INBOX", 42, "CRM/Track/Channel/card-1")]


def test_un_rangement_qui_echoue_encore_n_est_pas_marque() -> None:
    """LE POINT CENTRAL DE LA DETTE : une copie qui échoue une seconde fois reste reprenable. La
    marquer quand même la ferait disparaître de la sélection pour toujours (§20.5)."""

    imap = FauxImapRangement(refuse_copie_pour={42})
    base = FauxClientBaseRangement(
        [{"message_id": "m1", "card_id": "card-1", "folder": "INBOX", "uid": 42}]
    )

    assert reprendre_rangements_manques(imap=imap, client_base=base, account_id="compte-1") == 0
    assert base.marques == []


def test_une_card_sans_chemin_n_est_pas_marquee_non_plus() -> None:
    """Un dossier introuvable — la card a changé entre le classement et la reprise — n'est pas un
    succès déguisé : `ranger_dans_dossier` rend `False`, et la reprise ne ment pas dessus."""

    imap = FauxImapRangement()
    base = FauxClientBaseRangement(
        [{"message_id": "m1", "card_id": "card-sans-chemin", "folder": "INBOX", "uid": 42}]
    )

    assert reprendre_rangements_manques(imap=imap, client_base=base, account_id="compte-1") == 0
    assert base.marques == []
    assert imap.copies == []


def test_plusieurs_messages_sont_tous_repris_dans_le_meme_tour() -> None:
    imap = FauxImapRangement()
    base = FauxClientBaseRangement(
        [
            {"message_id": "m1", "card_id": "card-1", "folder": "INBOX", "uid": 1},
            {"message_id": "m2", "card_id": "card-2", "folder": "Archive", "uid": 2},
        ]
    )

    assert reprendre_rangements_manques(imap=imap, client_base=base, account_id="compte-1") == 2
    assert base.marques == ["m1", "m2"]


def test_aucun_rangement_manque_ne_touche_ni_imap_ni_la_base() -> None:
    imap = FauxImapRangement()
    base = FauxClientBaseRangement([])

    assert reprendre_rangements_manques(imap=imap, client_base=base, account_id="compte-1") == 0
    assert base.marques == []
    assert imap.copies == []

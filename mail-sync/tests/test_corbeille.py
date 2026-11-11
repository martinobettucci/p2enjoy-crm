# @verifies CRM-138 (docs/BACKLOG.md) — tranche T2 : le déplacement vers la corbeille d'une boîte (`MOVE`, `COPY` puis
#           `EXPUNGE`, `\Trash` absent, UID absent, essai à reprendre) et la purge (les objets d'abord, puis la ligne)
# @verifies docs/SPEC-mail-subsystem.md §29.5, §29.6 ; CLAUDE.md §18 (aucun succès simulé), §20 (aucun secret au journal)
"""Le module se prouve sans base et sans serveur : une boîte simulée enregistre ce que le serveur aurait reçu, et une source
simulée ce que la base aurait reçu. Le vrai serveur IMAP de dev est éprouvé par la preuve `mail` de la tranche."""

from __future__ import annotations

import socket
from contextlib import contextmanager

from imapclient.exceptions import LoginError

from mail_sync import corbeille
from mail_sync.corbeille import BilanDeplacements, BilanPurge, deplacer, deplacer_lot, purger_lot
from mail_sync.postgrest import PostgrestError


class Boite:
    def __init__(self, *, dossiers=None, uids=(42,), capacites=(b"IMAP4REV1", b"MOVE", b"UIDPLUS")) -> None:
        self.dossiers = dossiers if dossiers is not None else [((b"\\HasNoChildren",), b"/", "INBOX"),
                                                                ((b"\\Trash",), b"/", "Corbeille")]
        self.uids = set(uids)
        self.capacites = capacites
        self.gestes: list[tuple] = []

    def list_folders(self):
        return self.dossiers

    def has_capability(self, nom):
        # La boîte simulée n'annonce pas SPECIAL-USE : la voie du LIST simple. Le LIST étendu est éprouvé contre le vrai
        # serveur de dev par la preuve `mail` de la tranche.
        return False

    def select_folder(self, nom):
        self.gestes.append(("select", nom))

    def search(self, critere):
        return [u for u in self.uids if str(u) == critere[1]]

    def capabilities(self):
        return self.capacites

    def move(self, uids, dossier):
        self.gestes.append(("move", tuple(uids), dossier))

    def copy(self, uids, dossier):
        self.gestes.append(("copy", tuple(uids), dossier))

    def add_flags(self, uids, drapeaux):
        self.gestes.append(("flags", tuple(uids), tuple(drapeaux)))

    def uid_expunge(self, uids):
        self.gestes.append(("expunge", tuple(uids)))


class Source:
    def __init__(self, deplacements=(), a_purger=(), objet_en_echec=None) -> None:
        self.deplacements = list(deplacements)
        self.a_purger = list(a_purger)
        self.objet_en_echec = objet_en_echec
        self.issues: list[tuple[str, str, str | None]] = []
        self.objets: list[str] = []
        self.purges: list[str] = []

    def deplacements_a_faire(self, limite):
        return self.deplacements[:limite]

    def enregistrer_deplacement(self, move_id, issue, erreur):
        self.issues.append((move_id, issue, erreur))
        return {"retry": "pending"}.get(issue, issue)

    def messages_a_purger(self, limite):
        return self.a_purger[:limite]

    def supprimer_objet_piece(self, chemin):
        if chemin == self.objet_en_echec:
            raise PostgrestError(500)
        self.objets.append(chemin)

    def purger_message(self, message_id):
        self.purges.append(message_id)
        return True


def ouvrir(boite):
    @contextmanager
    def session():
        yield boite

    return lambda _compte: session()


LIGNE = {"move_id": "d1", "account_id": "a1", "folder": "INBOX", "uid": 42}


def test_move_quand_le_serveur_le_sait():
    boite = Boite()
    assert deplacer(boite, "INBOX", 42) == ("done", None)
    assert ("move", (42,), "Corbeille") in boite.gestes


def test_copy_puis_expunge_sans_move():
    boite = Boite(capacites=(b"IMAP4REV1", b"UIDPLUS"))
    assert deplacer(boite, "INBOX", 42) == ("done", None)
    assert [g[0] for g in boite.gestes] == ["select", "copy", "flags", "expunge"]


def test_ni_move_ni_uidplus_est_un_echec_definitif():
    assert deplacer(Boite(capacites=(b"IMAP4REV1",)), "INBOX", 42) == ("failed", "move_unsupported")


def test_sans_dossier_trash_rien_n_est_devine():
    boite = Boite(dossiers=[((b"\\HasNoChildren",), b"/", "INBOX"), ((), b"/", "Trash")])
    assert deplacer(boite, "INBOX", 42) == ("failed", "no_trash_folder")
    assert boite.gestes == []


def test_uid_absent_du_dossier_est_fait_avec_sa_note():
    boite = Boite(uids=())
    assert deplacer(boite, "INBOX", 42) == ("done", "absent_from_folder")
    assert not [g for g in boite.gestes if g[0] in ("move", "copy")]


def test_le_lot_rend_l_issue_reelle_a_la_base():
    source = Source([LIGNE, {**LIGNE, "move_id": "d2"}])
    bilan = deplacer_lot(source, ouvrir_boite=ouvrir(Boite()))
    assert bilan == BilanDeplacements(faits=2, echoues=0, reessayes=0)
    assert source.issues == [("d1", "done", None), ("d2", "done", None)]


def test_une_boite_muette_est_reessayee_jamais_declaree_faite():
    def muette(_compte):
        raise socket.timeout("délai")

    source = Source([LIGNE])
    bilan = deplacer_lot(source, ouvrir_boite=muette)
    assert bilan == BilanDeplacements(faits=0, echoues=0, reessayes=1)
    assert source.issues == [("d1", "retry", "timeout")]


def test_un_refus_d_authentification_est_reessaye_et_nomme():
    def refusee(_compte):
        raise LoginError("[AUTHENTICATIONFAILED] mot-de-passe-tres-secret")

    source = Source([LIGNE])
    deplacer_lot(source, ouvrir_boite=refusee)
    assert source.issues == [("d1", "retry", "auth_failed")]


def test_un_compte_disparu_est_un_echec_definitif():
    source = Source([LIGNE])
    deplacer_lot(source, ouvrir_boite=lambda _compte: None)
    assert source.issues == [("d1", "failed", "account_not_found")]


def test_le_journal_ne_porte_aucun_secret():
    evenements: list[tuple[str, dict]] = []

    def refusee(_compte):
        raise LoginError("[AUTHENTICATIONFAILED] mot-de-passe-tres-secret")

    deplacer_lot(Source([LIGNE]), ouvrir_boite=refusee, journal=lambda e, **d: evenements.append((e, d)))
    assert "mot-de-passe-tres-secret" not in repr(evenements)
    assert evenements == [("corbeille_deplacement", {"move_id": "d1", "issue": "pending", "motif": "auth_failed"})]


def test_la_purge_efface_les_objets_puis_la_ligne():
    source = Source(a_purger=[{"message_id": "m1", "storage_paths": ["ws/m1/a.pdf", "ws/m1/b.png"]}])
    assert purger_lot(source) == BilanPurge(purges=1, objets=2, echoues=0)
    assert source.objets == ["ws/m1/a.pdf", "ws/m1/b.png"] and source.purges == ["m1"]


def test_un_objet_qui_ne_s_efface_pas_garde_le_message():
    source = Source(a_purger=[{"message_id": "m1", "storage_paths": ["ws/m1/a.pdf"]},
                              {"message_id": "m2", "storage_paths": []}], objet_en_echec="ws/m1/a.pdf")
    bilan = purger_lot(source)
    assert bilan == BilanPurge(purges=1, objets=0, echoues=1)
    assert source.purges == ["m2"]


def test_les_bornes_du_pilote():
    assert corbeille.INTERVALLE_DEPLACEMENTS_SECONDES == 60
    assert corbeille.INTERVALLE_PURGE_SECONDES == 3600

# @verifies INC-266 (docs/INCONSISTENCY_REPORT.md, décision 619) — deux relèves d'un même compte ne se chevauchent pas
# @verifies docs/SPEC-mail-subsystem.md §4.5 (le renommage précède la relève, sur une liste relue à chaque tour)
#
# LE DÉFAUT, MESURÉ LE 2026-10-02 : pendant une campagne `e2e:mail`, `mail-sync` a écrit `folder_rename_refused`,
# précédé de « [NONEXISTENT] Mailbox 'CRM/Conseil & IA (renommé …)' not found ». La veille (un fil de fond) et la
# route interne `/poll` appellent toutes deux `relever_compte` dans le même processus, sans verrou : deux relèves du
# même compte lisaient la même divergence, la première renommait, la seconde renommait un dossier qui n'existait
# plus. Ce test rejoue ce chevauchement de façon DÉTERMINISTE — sans temporisation : la seconde relève part pendant
# que le serveur factice tient la réponse du premier renommage, et elle est libérée par un événement.

from __future__ import annotations

import threading

from mail_sync import ingestion
from mail_sync.postgrest import InboundCredentials


COMPTE = InboundCredentials(
    account_id="acc-concurrence",
    workspace_id="ws-1",
    host="imap.exemple",
    port=993,
    security="tls",
    username="boite@exemple",
    password="secret",
)

ANCIEN = "CRM/Conseil & IA"
NOUVEAU = "CRM/Conseil & IA (renommé)"


class Serveur:
    """L'état du serveur IMAP, partagé par les deux connexions."""

    def __init__(self) -> None:
        self.dossiers = {ANCIEN}
        self.renommages: list[tuple[str, str]] = []
        self.premier_renommage_fait = threading.Event()
        self.liberer_premiere_reponse = threading.Event()


class ImapFactice:
    def __init__(self, serveur: Serveur) -> None:
        self._serveur = serveur

    def capabilities(self):
        return (b"IMAP4rev2", b"IDLE")

    def create_folder(self, chemin):
        self._serveur.dossiers.add(chemin)

    def rename_folder(self, ancien, nouveau):
        if ancien not in self._serveur.dossiers:
            raise RuntimeError(f"[NONEXISTENT] Mailbox '{ancien}' not found")
        self._serveur.dossiers.discard(ancien)
        self._serveur.dossiers.add(nouveau)
        self._serveur.renommages.append((ancien, nouveau))
        if len(self._serveur.renommages) == 1:
            # Le serveur a déplacé le dossier, mais sa réponse n'est pas encore partie : c'est l'instant où une
            # seconde relève, sans verrou, lit encore la divergence en base.
            self._serveur.premier_renommage_fait.set()
            self._serveur.liberer_premiere_reponse.wait(timeout=5)

    def subscribe_folder(self, _chemin):
        return None

    def select_folder(self, _dossier, readonly=True):
        return {}

    def search(self, _criteres):
        return []

    def fetch(self, _uids, _champs):
        return {}

    def logout(self):
        return None


class Base:
    """La base factice : la divergence existe tant que le nouveau chemin n'est pas enregistré."""

    def __init__(self) -> None:
        self._verrou = threading.Lock()
        self.chemin_enregistre = ANCIEN

    def dossiers_a_renommer(self, _account_id):
        with self._verrou:
            if self.chemin_enregistre == NOUVEAU:
                return []
            return [
                {
                    "entity_type": "track",
                    "entity_id": "t-1",
                    "actual_path": self.chemin_enregistre,
                    "nouveau_chemin": NOUVEAU,
                }
            ]

    def enregistrer_dossier(self, **champs):
        with self._verrou:
            self.chemin_enregistre = champs["actual_path"]

    def reparenter_dossiers(self, _account_id, _ancien, _nouveau):
        return None

    def lire_progression(self, _account_id):
        return 0, {}

    def enregistrer_progression(self, _account_id, _sync_state):
        return None

    def messages_a_ranger(self, _account_id):
        return []


def test_deux_releves_du_meme_compte_ne_renomment_qu_une_fois_et_ne_sont_jamais_refusees(monkeypatch):
    serveur = Serveur()
    base = Base()
    evenements: list[str] = []
    monkeypatch.setattr(ingestion, "_connecter", lambda _compte, _timeout: ImapFactice(serveur))

    def relever() -> None:
        ingestion.relever_compte(
            journal=lambda evenement, **_details: evenements.append(evenement),
            client_base=base,
            compte=COMPTE,
            workspace_id="ws-1",
            dossiers=["INBOX"],
            clamav_hote="clamav",
            clamav_port=3310,
            taille_max_octets=1024,
        )

    premiere = threading.Thread(target=relever)
    premiere.start()
    assert serveur.premier_renommage_fait.wait(timeout=5), "le premier renommage n'a pas eu lieu"
    # La veille et la route `/poll` : la seconde relève part PENDANT la première.
    seconde = threading.Thread(target=relever)
    seconde.start()
    # Sans verrou, la seconde a eu le temps d'échouer ici ; avec, elle attend son tour.
    seconde.join(timeout=0.5)
    serveur.liberer_premiere_reponse.set()
    premiere.join(timeout=5)
    seconde.join(timeout=5)

    assert "folder_rename_refused" not in evenements
    assert serveur.renommages == [(ANCIEN, NOUVEAU)]
    assert base.chemin_enregistre == NOUVEAU


def test_deux_comptes_DIFFERENTS_ne_s_attendent_pas(monkeypatch):
    # Le verrou est PAR COMPTE : sérialiser toutes les relèves ferait attendre une boîte derrière une autre.
    verrou_a = ingestion._verrou_du_compte("acc-a")
    verrou_b = ingestion._verrou_du_compte("acc-b")
    assert verrou_a is not verrou_b
    assert ingestion._verrou_du_compte("acc-a") is verrou_a

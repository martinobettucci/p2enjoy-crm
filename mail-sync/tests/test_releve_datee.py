# @verifies CRM-127 (docs/BACKLOG.md) — tranche T2 : la relève allée au bout écrit `last_sync_at`
# @verifies docs/SPEC-mail-subsystem.md §23.2 (une relève allée au bout se date, dossier absent compris ; jamais une
#           relève qui lève ; un échec de l'écriture remonte) ; INC-340 ; docs/JOURNAL.md décision 816
#
# La fonction de base elle-même — horloge de la base, réservée à `service_role` — est éprouvée par pgTAP
# (`supabase/tests/0139_tester_connexion_et_releve.test.sql`). Ce fichier éprouve QUAND le service l'appelle.

from __future__ import annotations

import pytest

from mail_sync import ingestion
from mail_sync.postgrest import InboundCredentials, PostgrestClient, PostgrestError


COMPTE = InboundCredentials(
    account_id="acc-1",
    workspace_id="ws-1",
    host="imap.exemple",
    port=993,
    security="tls",
    username="boite@exemple",
    password="secret",
)


class ImapFactice:
    def __init__(self, uids: list[int] | None = None) -> None:
        self._uids = uids or []

    def capabilities(self):
        return (b"IMAP4rev2", b"IDLE")

    def select_folder(self, _dossier, readonly=True):
        return {}

    def search(self, _criteres):
        return list(self._uids)

    def fetch(self, _uids, _champs):
        return {}

    def logout(self):
        return None


class BaseFactice:
    """Note dans l'ordre chaque écriture que la relève demande."""

    def __init__(self, echec_datation: bool = False, sync_state: dict | None = None) -> None:
        self._echec_datation = echec_datation
        self._sync_state = sync_state or {}
        self.ecritures: list[tuple[str, str]] = []

    def adresses_de_service(self, _workspace_id):
        return frozenset()

    def lire_progression(self, _account_id):
        return 0, dict(self._sync_state)

    def enregistrer_progression(self, account_id, _sync_state):
        self.ecritures.append(("progression", account_id))

    def record_sync(self, account_id):
        if self._echec_datation:
            raise PostgrestError(503)
        self.ecritures.append(("datation", account_id))
        return "2026-11-02T10:00:00+00:00"

    def dossiers_a_renommer(self, _account_id):
        return []

    def messages_a_ranger(self, _account_id):
        return []


def relever(monkeypatch, connecter, base):
    monkeypatch.setattr(ingestion, "_connecter", connecter)
    return ingestion.relever_compte(
        client_base=base,
        compte=COMPTE,
        workspace_id="ws-1",
        dossiers=["INBOX"],
        clamav_hote="clamav",
        clamav_port=3310,
        taille_max_octets=1024,
    )


def test_une_releve_allee_au_bout_se_date_meme_sans_message_nouveau(monkeypatch):
    # Une boîte vide a bel et bien été relevée : c'est ce que l'écran d'état doit dire (§20.7).
    base = BaseFactice()
    relever(monkeypatch, lambda _c, _t: ImapFactice(), base)
    assert base.ecritures == [("datation", "acc-1")]


def test_un_dossier_absent_n_empeche_pas_la_datation(monkeypatch):
    # §15.4 : un dossier surveillé absent est écarté, et la relève des autres va au bout.
    class ImapDossierAbsent(ImapFactice):
        def select_folder(self, dossier, readonly=True):
            if dossier == "Absent":
                raise RuntimeError("NO Mailbox does not exist")
            return {}

    base = BaseFactice()
    monkeypatch.setattr(ingestion, "_connecter", lambda _c, _t: ImapDossierAbsent())
    ingestion.relever_compte(
        client_base=base,
        compte=COMPTE,
        workspace_id="ws-1",
        dossiers=["Absent", "INBOX"],
        clamav_hote="clamav",
        clamav_port=3310,
        taille_max_octets=1024,
    )
    assert base.ecritures == [("datation", "acc-1")]


def test_une_releve_dont_la_session_imap_ne_s_ouvre_pas_ne_se_date_pas(monkeypatch):
    def connexion_refusee(_compte, _timeout):
        raise ConnectionRefusedError("refusé")

    base = BaseFactice()
    with pytest.raises(ConnectionRefusedError):
        relever(monkeypatch, connexion_refusee, base)
    assert base.ecritures == []


def test_un_echec_de_la_datation_remonte_et_n_est_pas_avale(monkeypatch):
    # CLAUDE.md §18 : la veille le journalisera (`veille_compte_echoue`) et `/poll` rendra 502 ; la relève suivante,
    # idempotente, réessaiera.
    base = BaseFactice(echec_datation=True)
    with pytest.raises(PostgrestError):
        relever(monkeypatch, lambda _c, _t: ImapFactice(), base)


def test_le_client_appelle_la_fonction_reservee_au_service(monkeypatch):
    client = PostgrestClient("http://kong:8000", "cle-de-service")
    appels: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "_rpc", lambda nom, corps: appels.append((nom, corps)) or "2026-11-02T10:00:00+00:00")
    assert client.record_sync("acc-1") == "2026-11-02T10:00:00+00:00"
    assert appels == [("mail_inbound_account_record_sync", {"p_account_id": "acc-1"})]

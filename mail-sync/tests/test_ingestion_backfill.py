# @verifies CRM-059 (docs/BACKLOG.md) — la relève cesse de redescendre la boîte entière
# @verifies docs/SPEC-mail-subsystem.md §20.6 bis.1 (`search(["ALL"])` disparaît), §20.6 bis.3
#           (le courant d'abord), §20.6 bis.4 (premier contact), §20.6 bis.2 (la progression n'est
#           écrite qu'après un rapatriement réel)
# @verifies docs/JOURNAL.md décision 342
#
# CE FICHIER EST LE PREMIER TEST UNITAIRE DE `relever_compte`, qui n'était jusqu'ici prouvée que
# par l'E2E. Il n'exerce PAS le traitement d'un message — ingestion, dédoublonnage, classement,
# pièces jointes restent prouvés par `e2e/mail`. Il exerce ce que `CRM-059` change : la façon dont
# les UID sont CHOISIS, et l'enregistrement de la progression.

from __future__ import annotations

from datetime import date

from mail_sync import ingestion
from mail_sync.postgrest import InboundCredentials


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
    def __init__(self, reponses_par_recherche: list[list[int]]) -> None:
        self._reponses = list(reponses_par_recherche)
        self.recherches: list[list] = []
        self.fetchs: list[list[int]] = []
        self.deconnecte = False

    def capabilities(self):
        # Ni `X-GM-EXT-1` ni label : le modèle de dossiers est utilisable, mais aucune divergence
        # n'est rendue par la base factice, donc aucun renommage n'a lieu.
        return (b"IMAP4rev2", b"IDLE")

    def select_folder(self, _dossier, readonly=True):
        return {}

    def search(self, criteres):
        self.recherches.append(list(criteres))
        return self._reponses.pop(0) if self._reponses else []

    def fetch(self, uids, _champs):
        self.fetchs.append(list(uids))
        # Aucun message rendu : ce fichier n'exerce pas le traitement, seulement la sélection.
        return {}

    def logout(self):
        self.deconnecte = True


class BaseFactice:
    def __init__(self, backfill_months: int = 0, sync_state: dict | None = None) -> None:
        self._backfill_months = backfill_months
        self._sync_state = sync_state or {}
        self.progressions_ecrites: list[dict] = []

    def lire_progression(self, _account_id):
        return self._backfill_months, dict(self._sync_state)

    def enregistrer_progression(self, _account_id, sync_state):
        self.progressions_ecrites.append(sync_state)

    def dossiers_a_renommer(self, _account_id):
        return []

    def messages_a_ranger(self, _account_id):
        # `CRM-059` §20.5 : la reprise d'un rangement manqué suit la relève sur un compte à
        # dossiers. Ce fichier n'exerce pas la reprise elle-même — `test_ingestion.py` le fait —,
        # une liste vide suffit à laisser `relever_compte` traverser l'appel.
        return []


def relever(monkeypatch, imap, base, dossiers=("INBOX",)):
    monkeypatch.setattr(ingestion, "_connecter", lambda _compte, _timeout: imap)
    return ingestion.relever_compte(
        client_base=base,
        compte=COMPTE,
        workspace_id="ws-1",
        dossiers=list(dossiers),
        clamav_hote="clamav",
        clamav_port=3310,
        taille_max_octets=1024,
    )


def test_la_releve_n_emet_plus_JAMAIS_une_recherche_ALL(monkeypatch):
    # C'était la dette du §20.6 bis.1 : `search(["ALL"])` redescendait la boîte à chaque tour.
    imap = ImapFactice([[]])
    relever(monkeypatch, imap, BaseFactice())
    assert imap.recherches != []
    for recherche in imap.recherches:
        assert "ALL" not in recherche


def test_un_premier_contact_ne_demande_que_le_courrier_du_jour(monkeypatch):
    imap = ImapFactice([[]])
    relever(monkeypatch, imap, BaseFactice(backfill_months=0))
    assert imap.recherches == [["SINCE", date.today()]]


def test_une_boite_deja_connue_repart_du_dernier_uid(monkeypatch):
    imap = ImapFactice([[]])
    base = BaseFactice(sync_state={"INBOX": {"uid_min": 10, "uid_max": 42}})
    relever(monkeypatch, imap, base)
    assert imap.recherches == [["UID", "43:*"]]


def test_l_historique_est_demande_quand_la_profondeur_est_declaree(monkeypatch):
    imap = ImapFactice([[], []])
    base = BaseFactice(backfill_months=6, sync_state={"INBOX": {"uid_min": 10, "uid_max": 42}})
    relever(monkeypatch, imap, base)
    assert len(imap.recherches) == 2
    assert imap.recherches[0] == ["UID", "43:*"]
    assert imap.recherches[1][0] == "SINCE"
    assert imap.recherches[1][2:] == ["UID", "1:9"]


def test_aucun_fetch_n_est_emis_quand_il_n_y_a_rien_a_relever(monkeypatch):
    # Un `FETCH` sur une liste vide est une requête pour rien, à chaque tour et par dossier.
    imap = ImapFactice([[]])
    relever(monkeypatch, imap, BaseFactice())
    assert imap.fetchs == []


def test_la_progression_n_est_PAS_ecrite_quand_rien_n_a_ete_rapatrie(monkeypatch):
    # Le serveur rend des UID, mais `fetch` ne rend aucun corps : rien n'a été traité. Enregistrer
    # une plage ici ferait croire à un historique descendu qui ne l'est pas, et le trou ne serait
    # jamais comblé.
    imap = ImapFactice([[7, 8]])
    base = BaseFactice()
    relever(monkeypatch, imap, base)
    assert imap.fetchs == [[7, 8]]
    assert base.progressions_ecrites == []


def test_chaque_dossier_a_sa_propre_progression(monkeypatch):
    imap = ImapFactice([[], []])
    base = BaseFactice(
        sync_state={"INBOX": {"uid_min": 10, "uid_max": 42}, "Junk": {"uid_min": 1, "uid_max": 5}}
    )
    relever(monkeypatch, imap, base, dossiers=("INBOX", "Junk"))
    # Deux dossiers, deux plages distinctes : la progression de l'un ne gouverne pas l'autre.
    assert imap.recherches == [["UID", "43:*"], ["UID", "6:*"]]


def test_un_dossier_absent_n_arrete_pas_les_autres(monkeypatch):
    class ImapDossierAbsent(ImapFactice):
        def select_folder(self, dossier, readonly=True):
            if dossier == "Absent":
                raise RuntimeError("NO Mailbox does not exist")
            return {}

    imap = ImapDossierAbsent([[]])
    relever(monkeypatch, imap, BaseFactice(), dossiers=("Absent", "INBOX"))
    # Une seule recherche : celle du dossier qui existe.
    assert imap.recherches == [["SINCE", date.today()]]


def test_la_session_imap_est_toujours_refermee(monkeypatch):
    imap = ImapFactice([[]])
    relever(monkeypatch, imap, BaseFactice())
    assert imap.deconnecte is True

# @verifies CRM-143 (docs/BACKLOG.md) — tranche T2 : la reprise des pièces non analysées, et la raison d'un `skipped`
# @verifies docs/SPEC-pieces-jointes.md §17.3 (`av_skip_reason`), §17.5 (le lot, son arrêt au premier silence, son
#           journal sans nom de fichier), §17.9 (preuves pytest) ; docs/JOURNAL.md décision 892 ; CLAUDE.md §18
#
# Aucune base, aucun antivirus : la source et l'analyse sont des doubles. Le vrai ClamAV et la vraie base sont exercés par
# l'E2E `mail` (`e2e/mail/pieces-non-analysees.spec.ts`).

from __future__ import annotations

import io
import json
import logging

import pytest

from mail_sync import antivirus, ingestion
from mail_sync.postgrest import PostgrestClient
from mail_sync.reprise import BilanReprise, PiloteReprise, reprendre_lot
from mail_sync.structured_logging import JsonFormatter, log_event

NOM_SECRET = "contrat-confidentiel.pdf"


class Source:
    def __init__(self, pieces: list[dict], contenus: dict[str, bytes | None]) -> None:
        self.pieces = pieces
        self.contenus = contenus
        self.verdicts: list[tuple[str, str]] = []

    def pieces_a_reprendre(self, limite: int) -> list[dict]:
        return self.pieces[:limite]

    def lire_piece(self, chemin: str) -> bytes | None:
        return self.contenus.get(chemin)

    def enregistrer_verdict(self, attachment_id: str, statut: str) -> None:
        self.verdicts.append((attachment_id, statut))


def piece(n: int) -> dict:
    return {"id": f"p{n}", "storage_path": f"ws/msg/{n:064x}", "mime_type": "application/pdf"}


def analyse_par_contenu(contenu: bytes) -> antivirus.VerdictAntivirus:
    if contenu == b"EICAR":
        return antivirus.VerdictAntivirus(statut=antivirus.INFECTED, signature="Eicar-Test-Signature")
    if contenu == b"MUET":
        return antivirus.VerdictAntivirus(statut=antivirus.SKIPPED)
    return antivirus.VerdictAntivirus(statut=antivirus.CLEAN)


def test_un_lot_rend_saine_ou_infectee_chaque_piece_analysee() -> None:
    source = Source([piece(1), piece(2)], {piece(1)["storage_path"]: b"sain", piece(2)["storage_path"]: b"EICAR"})
    bilan = reprendre_lot(source, analyser=analyse_par_contenu)
    assert source.verdicts == [("p1", "clean"), ("p2", "infected")]
    assert bilan == BilanReprise(analysees=2, saines=1, infectees=1, restees=0)


def test_un_antivirus_muet_arrete_le_lot_et_n_ecrit_rien() -> None:
    pieces = [piece(1), piece(2), piece(3)]
    contenus = {pieces[0]["storage_path"]: b"sain", pieces[1]["storage_path"]: b"MUET", pieces[2]["storage_path"]: b"sain"}
    source = Source(pieces, contenus)
    bilan = reprendre_lot(source, analyser=analyse_par_contenu)
    # La première est jugée ; la deuxième trouve l'antivirus muet : elle et la suivante restent non analysées.
    assert source.verdicts == [("p1", "clean")]
    assert bilan == BilanReprise(analysees=1, saines=1, infectees=0, restees=2, antivirus_muet=True)


def test_un_objet_disparu_reste_non_analyse_sans_arreter_le_lot() -> None:
    source = Source([piece(1), piece(2)], {piece(2)["storage_path"]: b"sain"})
    bilan = reprendre_lot(source, analyser=analyse_par_contenu)
    assert source.verdicts == [("p2", "clean")]
    assert (bilan.restees, bilan.analysees) == (1, 1)


def test_la_limite_borne_le_lot() -> None:
    pieces = [piece(n) for n in range(5)]
    source = Source(pieces, {p["storage_path"]: b"sain" for p in pieces})
    assert reprendre_lot(source, analyser=analyse_par_contenu, limite=2).analysees == 2


def test_le_journal_nomme_la_piece_infectee_par_son_identifiant_jamais_par_son_nom() -> None:
    tampon = io.StringIO()
    gestionnaire = logging.StreamHandler(tampon)
    gestionnaire.setFormatter(JsonFormatter())
    logger = logging.getLogger("mail-sync-test-reprise")
    logger.handlers = [gestionnaire]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)

    infectee = dict(piece(1), filename=NOM_SECRET)
    source = Source([infectee], {infectee["storage_path"]: b"EICAR"})
    reprendre_lot(
        source,
        analyser=analyse_par_contenu,
        journal=lambda evenement, **details: log_event(logger, logging.WARNING, evenement, **details),
    )
    [ligne] = [json.loads(l) for l in tampon.getvalue().splitlines()]
    assert (ligne["event"], ligne["attachment_id"]) == ("reprise_antivirus_infectee", "p1")
    assert NOM_SECRET not in tampon.getvalue()
    assert "Eicar" not in tampon.getvalue()


def test_le_pilote_joue_un_lot_au_demarrage() -> None:
    appels: list[int] = []

    def executer() -> BilanReprise:
        appels.append(1)
        return BilanReprise()

    pilote = PiloteReprise(executer=executer, logger=logging.getLogger("t"), intervalle=3600)
    pilote.demarrer()
    pilote.arreter(timeout=2.0)
    assert appels, "le premier lot part au démarrage, sans attendre l'intervalle"


def test_le_client_appelle_les_deux_fonctions_reservees_au_service(monkeypatch) -> None:
    client = PostgrestClient("http://kong:8000", "cle-de-service")
    appels: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "_rpc", lambda nom, corps: appels.append((nom, corps)) or [])
    client.pieces_a_reprendre(20)
    client.enregistrer_verdict("p1", "clean")
    assert appels == [
        ("mail_attachments_to_rescan", {"p_limit": 20}),
        ("mail_attachment_record_scan", {"p_attachment_id": "p1", "p_status": "clean"}),
    ]


# --- La raison d'un `skipped`, écrite par l'ingestion (§17.3) ---------------------------------------------------------


def courrier_avec_piece(taille: int) -> bytes:
    from email.message import EmailMessage

    message = EmailMessage()
    message["From"] = "client@exemple.fr"
    message["To"] = "bizdev@p2enjoy.test"
    message["Subject"] = "Devis"
    message["Message-ID"] = f"<piece-{taille}@exemple.fr>"
    message.set_content("Ci-joint le devis.")
    message.add_attachment(b"%PDF-1.4 " + b"x" * taille, maintype="application", subtype="pdf", filename="devis.pdf")
    return bytes(message)


def relever_avec_piece(monkeypatch, verdict: str, taille: int, taille_max: int) -> list[dict]:
    from tests.test_courriels_automatiques import COMPTE, BaseFactice, ImapFactice

    ecrites: list[dict] = []

    class Base(BaseFactice):
        def deposer_objet(self, *_):
            return None

        def enregistrer_piece(self, **champs):
            ecrites.append(champs)

    monkeypatch.setattr(ingestion, "_connecter", lambda _c, _t: ImapFactice({1: courrier_avec_piece(taille)}))
    monkeypatch.setattr(
        ingestion.antivirus, "analyser_contenu", lambda *_a, **_k: antivirus.VerdictAntivirus(statut=verdict)
    )
    ingestion.relever_compte(
        client_base=Base(), compte=COMPTE, workspace_id="ws-1", dossiers=["INBOX"],
        clamav_hote="clamav", clamav_port=3310, taille_max_octets=taille_max,
    )
    return ecrites


@pytest.mark.parametrize(
    ("verdict", "attendu"),
    [(antivirus.SKIPPED, "scanner_unavailable"), (antivirus.CLEAN, None), (antivirus.INFECTED, None)],
)
def test_l_ingestion_ecrit_la_raison_d_un_antivirus_muet(monkeypatch, verdict, attendu) -> None:
    [ecrite] = relever_avec_piece(monkeypatch, verdict, taille=100, taille_max=10_000)
    assert ecrite["av_status"] == verdict
    assert ecrite.get("av_skip_reason") == attendu


def test_l_ingestion_ecrit_la_raison_d_une_piece_trop_volumineuse(monkeypatch) -> None:
    [ecrite] = relever_avec_piece(monkeypatch, antivirus.CLEAN, taille=5_000, taille_max=1_000)
    assert (ecrite["av_status"], ecrite["av_skip_reason"]) == ("skipped", "too_large")

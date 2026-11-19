# @verifies CRM-158 (docs/BACKLOG.md) — la boucle d'envoi de `mail-sync` : une passe dès le démarrage, une passe pleine
#           enchaînée, l'intervalle sinon, la panne absorbée et dite, l'arrêt qui interrompt l'attente, `outbox_stale` au-delà
#           de cinq minutes ; la retenue de développement (§34.7 bis) ; `executer_passe` partagée par la route (docs/SPEC-mail-subsystem.md §34.3 à §34.6, §34.11 ;
#           docs/DAT.md §3.3, §14 ; docs/JOURNAL.md décision 954)
#
# SANS SERVEUR : la passe et la mesure sont des doubles. Le départ réel d'un envoi mis en file, sans aucun appel à la route,
# est prouvé par `e2e/mail/envoi-automatique.spec.ts`.

from __future__ import annotations

import io
import json
import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_TOKEN
from mail_sync import envoi as module_envoi
from mail_sync.app import create_app
from mail_sync.envoi import (
    INTERVALLE_SECONDES,
    LOT,
    SEUIL_RETARD,
    PiloteEnvoi,
    ResultatEnvoi,
    RetenueEnvoi,
    executer_passe,
    mesurer_retard,
)
from mail_sync.postgrest import PostgrestClient, PostgrestError
from mail_sync.structured_logging import JsonFormatter


def journal_capture() -> tuple[logging.Logger, io.StringIO]:
    """Un journal propre au test, formaté par le VRAI formateur : ce qui sort est ce que la production lirait."""

    flux = io.StringIO()
    gestionnaire = logging.StreamHandler(flux)
    gestionnaire.setFormatter(JsonFormatter())
    logger = logging.getLogger(f"test-envoi-{uuid4()}")
    logger.handlers = [gestionnaire]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger, flux


def lignes(flux: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(ligne) for ligne in flux.getvalue().splitlines() if ligne.strip()]


def sans_retard() -> tuple[int, int | None]:
    return 0, None


# --- La cadence — §34.3 ------------------------------------------------------------------------------------------------


def test_la_cadence_est_de_trente_secondes_par_lots_de_dix():
    assert INTERVALLE_SECONDES == 30
    assert LOT == 10
    assert SEUIL_RETARD == timedelta(minutes=5)


def test_une_passe_part_des_le_demarrage_puis_la_boucle_attend_son_intervalle():
    appels: list[float] = []
    premiere = threading.Event()

    def executer() -> ResultatEnvoi:
        appels.append(time.monotonic())
        premiere.set()
        return ResultatEnvoi(reserves=1, envoyes=1)

    logger, flux = journal_capture()
    pilote = PiloteEnvoi(executer=executer, mesurer=sans_retard, logger=logger, intervalle=60)
    pilote.demarrer()
    assert premiere.wait(5), "la première passe part au démarrage, sans attendre l'intervalle"
    time.sleep(0.2)
    pilote.arreter()
    assert len(appels) == 1, "une passe partielle est suivie de l'intervalle, non d'une autre passe"
    depart = lignes(flux)[0]
    assert depart["event"] == "outbox_loop_started"
    assert depart["intervalle_secondes"] == 60


def test_une_passe_pleine_est_suivie_d_une_autre_sans_attendre():
    appels: list[int] = []
    deux = threading.Event()

    def executer() -> ResultatEnvoi:
        appels.append(1)
        if len(appels) >= 2:
            deux.set()
        return ResultatEnvoi(reserves=LOT if len(appels) == 1 else 3)

    pilote = PiloteEnvoi(executer=executer, mesurer=sans_retard, logger=journal_capture()[0], intervalle=60)
    pilote.demarrer()
    assert deux.wait(5), "une passe pleine enchaîne aussitôt : un arriéré s'écoule au rythme du SMTP"
    time.sleep(0.2)
    pilote.arreter()
    assert len(appels) == 2, "après une passe partielle, la boucle retombe à son intervalle"


def test_l_arret_interrompt_l_attente():
    premiere = threading.Event()

    def executer() -> ResultatEnvoi:
        premiere.set()
        return ResultatEnvoi()

    pilote = PiloteEnvoi(executer=executer, mesurer=sans_retard, logger=journal_capture()[0], intervalle=3600)
    pilote.demarrer()
    assert premiere.wait(5)
    debut = time.monotonic()
    pilote.arreter()
    assert time.monotonic() - debut < 2, "un service qui met une heure à s'arrêter finit tué par l'orchestrateur"


# --- La boucle survit à tout, et le dit — §34.5 ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("panne", "champ", "valeur"),
    [(PostgrestError(503), "postgrest_status", 503), (RuntimeError("smtp.exemple.test: mot de passe de u@x"), "error", "RuntimeError")],
)
def test_une_passe_en_panne_est_dite_puis_rejouee(panne: Exception, champ: str, valeur: object):
    appels: list[int] = []
    deux = threading.Event()

    def executer() -> ResultatEnvoi:
        appels.append(1)
        if len(appels) == 1:
            raise panne
        deux.set()
        return ResultatEnvoi()

    logger, flux = journal_capture()
    pilote = PiloteEnvoi(executer=executer, mesurer=sans_retard, logger=logger, intervalle=0.05)
    pilote.demarrer()
    assert deux.wait(5), "le fil survit à la panne, et la passe suivante rejoue"
    pilote.arreter()
    echecs = [ligne for ligne in lignes(flux) if ligne["event"] == "outbox_loop_failed"]
    assert echecs and echecs[0][champ] == valeur
    # LE TEXTE D'UNE EXCEPTION NE SORT JAMAIS : il peut recopier un hôte ou un identifiant de connexion (§20.10.3).
    assert "mot de passe" not in flux.getvalue() and "smtp.exemple.test" not in flux.getvalue()


# --- La supervision — §34.6 --------------------------------------------------------------------------------------------


def test_mesurer_retard_compte_et_date_le_plus_ancien():
    maintenant = datetime(2026, 11, 19, 14, 0, tzinfo=UTC)
    assert mesurer_retard([], maintenant) == (0, None)
    echeances = [maintenant - timedelta(minutes=6), maintenant - timedelta(minutes=15, seconds=30)]
    assert mesurer_retard(echeances, maintenant) == (2, 930)


def test_une_file_qui_vieillit_est_dite_et_une_file_a_jour_ne_dit_rien():
    for retard, attendu in (((3, 930), True), ((0, None), False)):
        mesure = threading.Event()

        def mesurer(retard: tuple[int, int | None] = retard) -> tuple[int, int | None]:
            mesure.set()
            return retard

        logger, flux = journal_capture()
        pilote = PiloteEnvoi(executer=lambda: ResultatEnvoi(), mesurer=mesurer, logger=logger, intervalle=60)
        pilote.demarrer()
        assert mesure.wait(5), "la file est mesurée après chaque passe partielle"
        time.sleep(0.1)
        pilote.arreter()
        vieillies = [ligne for ligne in lignes(flux) if ligne["event"] == "outbox_stale"]
        if attendu:
            assert vieillies == [
                {**vieillies[0], "level": "WARNING", "count": 3, "overdue_seconds": 930},
            ]
        else:
            assert vieillies == []


def test_une_mesure_en_panne_n_arrete_pas_la_boucle():
    appels: list[int] = []
    deux = threading.Event()

    def executer() -> ResultatEnvoi:
        appels.append(1)
        if len(appels) >= 2:
            deux.set()
        return ResultatEnvoi()

    def mesurer() -> tuple[int, int | None]:
        raise PostgrestError(0)

    logger, flux = journal_capture()
    pilote = PiloteEnvoi(executer=executer, mesurer=mesurer, logger=logger, intervalle=0.05)
    pilote.demarrer()
    assert deux.wait(5)
    pilote.arreter()
    assert any(ligne["event"] == "outbox_loop_failed" and ligne["postgrest_status"] == 0 for ligne in lignes(flux))


def test_la_lecture_des_echeances_ne_demande_que_les_envois_dus_en_file(monkeypatch: pytest.MonkeyPatch):
    demandes: list[str] = []
    client = PostgrestClient("http://kong:8000", "cle-de-service-de-preuve-0123456789")

    def rest(methode: str, chemin: str, *_a: Any, **_k: Any) -> tuple[int, bytes]:
        demandes.append(f"{methode} {chemin}")
        return 200, json.dumps([{"next_attempt_at": "2026-11-19T13:45:00.5+00:00"}, {"next_attempt_at": None}]).encode()

    monkeypatch.setattr(client, "_rest", rest)
    echeances = client.echeances_en_retard(datetime(2026, 11, 19, 13, 55, tzinfo=UTC))
    assert echeances == [datetime(2026, 11, 19, 13, 45, 0, 500000, tzinfo=UTC)]
    assert demandes == [
        "GET /rest/v1/mail_outbox?select=next_attempt_at&status=eq.queued"
        "&next_attempt_at=lt.2026-11-19T13%3A55%3A00%2B00%3A00&order=next_attempt_at.asc&limit=1000"
    ]


# --- `executer_passe`, la passe de la boucle ET de la route — §34.4 ----------------------------------------------------


class FauxClient:
    def __init__(self, *, panne: bool = False, abandonnes: list[str] | None = None) -> None:
        self.panne = panne
        self.abandonnes = abandonnes or []
        self.effaces: list[str] = []

    def reprendre_envois_orphelins(self) -> int:
        if self.panne:
            raise PostgrestError(0)
        return 2

    def reserver_envois(self, _limite: int) -> list[dict[str, Any]]:
        return []

    def depots_envoi_abandonnes(self) -> list[str]:
        return list(self.abandonnes)

    def effacer_objets_envoi(self, chemins: list[str]) -> None:
        self.effaces.extend(chemins)


def test_la_passe_purge_les_depots_et_sort_ses_compteurs(settings_factory, monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    faux = FauxClient(abandonnes=["w/u/x/devis.pdf"])
    monkeypatch.setattr(module_envoi, "PostgrestClient", lambda *_a, **_k: faux)
    logger, flux = journal_capture()
    resultat = executer_passe(settings_factory(), logger)
    assert resultat == ResultatEnvoi(orphelins=2)
    assert faux.effaces == ["w/u/x/devis.pdf"]
    evenements = {ligne["event"]: ligne for ligne in lignes(flux)}
    assert evenements["envois_orphelins_repris"]["count"] == 2
    assert evenements["outbound_attachments_purged"]["count"] == 1
    # LES COMPTEURS SORTENT : avant `CRM-158`, le formateur les jetait (§34.5).
    vidage = evenements["outbox_flushed"]
    assert (vidage["reserved"], vidage["sent"], vidage["failed"], vidage["rescheduled"], vidage["orphans"]) == (0, 0, 0, 0, 2)


def test_la_route_appelle_la_meme_passe_et_traduit_une_base_injoignable(settings_factory, monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    en_tetes = {"Authorization": f"Bearer {TEST_TOKEN}"}
    monkeypatch.setattr(module_envoi, "PostgrestClient", lambda *_a, **_k: FauxClient())
    with TestClient(create_app(settings_factory())) as client:
        reponse = client.post("/internal/v1/outbox/flush", headers=en_tetes)
        assert reponse.status_code == 200
        assert reponse.json() == {"reserved": 0, "sent": 0, "failed": 0, "rescheduled": 0, "orphans": 2}

        monkeypatch.setattr(module_envoi, "PostgrestClient", lambda *_a, **_k: FauxClient(panne=True))
        assert client.post("/internal/v1/outbox/flush", headers=en_tetes).status_code == 502
        assert client.post("/internal/v1/outbox/flush").status_code == 401


# --- La retenue, en développement seulement — §34.7 bis ----------------------------------------------------------------


def test_la_retenue_expire_seule_et_se_borne_a_dix_minutes():
    maintenant = [1000.0]
    retenue = RetenueEnvoi(horloge=lambda: maintenant[0])
    assert retenue.restante() == 0
    assert retenue.retenir(3600) == 600, "une retenue ne dure jamais plus de dix minutes"
    maintenant[0] += 599
    assert retenue.restante() == pytest.approx(1)
    maintenant[0] += 2
    assert retenue.restante() == 0, "une preuve interrompue ne laisse pas la file muette"
    retenue.retenir(60)
    retenue.liberer()
    assert retenue.restante() == 0


def test_la_boucle_retenue_ne_passe_pas_puis_reprend_a_la_liberation():
    retenue = RetenueEnvoi()
    retenue.retenir(600)
    appels: list[int] = []
    mesures: list[int] = []
    reprise = threading.Event()

    def executer() -> ResultatEnvoi:
        appels.append(1)
        reprise.set()
        return ResultatEnvoi()

    def mesurer() -> tuple[int, int | None]:
        mesures.append(1)
        return 0, None

    pilote = PiloteEnvoi(executer=executer, mesurer=mesurer, logger=journal_capture()[0], intervalle=0.05, retenue=retenue)
    pilote.demarrer()
    time.sleep(0.3)
    assert appels == [] and mesures == [], "retenue, la boucle ne passe pas et ne mesure rien"
    retenue.liberer()
    assert reprise.wait(5), "libérée, la boucle reprend à son intervalle"
    pilote.arreter()


def test_les_routes_de_retenue_n_existent_qu_en_developpement(settings_factory):  # type: ignore[no-untyped-def]
    en_tetes = {"Authorization": f"Bearer {TEST_TOKEN}"}
    retenue = RetenueEnvoi()
    with TestClient(create_app(settings_factory("dev"), retenue=retenue)) as client:
        assert client.post("/internal/v1/dev/outbox-loop/hold?seconds=120").status_code == 401
        reponse = client.post("/internal/v1/dev/outbox-loop/hold?seconds=120", headers=en_tetes)
        assert reponse.status_code == 200 and reponse.json() == {"held_seconds": 120}
        assert retenue.restante() > 100, "la route retient LA boucle du service, non une copie"
        assert client.post("/internal/v1/dev/outbox-loop/hold?seconds=601", headers=en_tetes).status_code == 422
        assert client.delete("/internal/v1/dev/outbox-loop/hold", headers=en_tetes).json() == {"held_seconds": 0}
        assert retenue.restante() == 0
    with TestClient(create_app(settings_factory("prod"))) as client:
        assert client.post("/internal/v1/dev/outbox-loop/hold?seconds=120", headers=en_tetes).status_code == 404
        assert client.delete("/internal/v1/dev/outbox-loop/hold", headers=en_tetes).status_code == 404

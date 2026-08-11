# @verifies CRM-059 (docs/BACKLOG.md) — boucle de veille et `MAIL_SYNC_POLL_INTERVAL`
# @verifies docs/SPEC-mail-subsystem.md §20.10.2 (la décision est pure), §20.10.3 (un compte en
#           panne n'arrête pas le tour, et l'absorption n'est pas un silence), §20.10.4 (aucun
#           chevauchement), §20.10.5 (zéro désactive, bornes), §20.10.6 (quels comptes, dans quel
#           ordre), §13.7 (un type de panne, jamais le texte)
# @verifies docs/JOURNAL.md décision 341
#
# AUCUNE DE CES PREUVES NE DORT, et c'est la raison d'être de la séparation du §20.10.2 :
# `CLAUDE.md` §18 proscrit la temporisation arbitraire, et attendre soixante secondes pour observer
# un second tour en serait une. Le pilote lui-même est éprouvé avec un intervalle réel mais un
# `Event` déclenché depuis le rappel de relève, jamais par une attente d'horloge.

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest

from mail_sync.veille import (
    INTERVALLE_MAXIMAL_SECONDES,
    INTERVALLE_MINIMAL_SECONDES,
    VEILLE_DESACTIVEE,
    CompteAVeiller,
    PiloteVeille,
    delai_avant_prochain_tour,
    executer_un_tour,
    normaliser_intervalle,
    ordonner_comptes,
)


MAINTENANT = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)


def compte(identifiant: str, *, releve_il_y_a: timedelta | None = None, secret: bool = True):
    derniere = None if releve_il_y_a is None else MAINTENANT - releve_il_y_a
    return CompteAVeiller(identifiant=identifiant, derniere_releve=derniere, secret_present=secret)


class SourceFactice:
    def __init__(self, comptes, erreur: Exception | None = None) -> None:
        self._comptes = comptes
        self._erreur = erreur
        self.appels = 0

    def lire_comptes_a_veiller(self):
        self.appels += 1
        if self._erreur is not None:
            raise self._erreur
        return self._comptes


class JournalFactice:
    """Enregistre les événements pour que les preuves observent CE QUI EST DIT, pas seulement l'effet."""

    def __init__(self) -> None:
        self.evenements: list[tuple[str, dict]] = []

    def __call__(self, evenement: str, **details) -> None:
        self.evenements.append((evenement, details))

    def noms(self) -> list[str]:
        return [nom for nom, _ in self.evenements]


# ---------------------------------------------------------------------------------------------
# §20.10.5 — l'intervalle et ses bornes
# ---------------------------------------------------------------------------------------------


def test_zero_desactive_la_veille_et_n_est_pas_une_borne_violee():
    # Zéro n'est PAS « aussi vite que possible » : c'est « aucune veille ».
    assert normaliser_intervalle(0) == VEILLE_DESACTIVEE


def test_l_intervalle_nominal_passe_inchange():
    assert normaliser_intervalle(60) == 60
    assert normaliser_intervalle(INTERVALLE_MINIMAL_SECONDES) == INTERVALLE_MINIMAL_SECONDES
    assert normaliser_intervalle(INTERVALLE_MAXIMAL_SECONDES) == INTERVALLE_MAXIMAL_SECONDES


@pytest.mark.parametrize("valeur", [1, 2, 4])
def test_un_intervalle_trop_court_est_refuse_avec_sa_regle(valeur: int):
    # Refusé, et non ramené silencieusement à la borne : un exploitant qui écrit 1 doit apprendre
    # que ce n'est pas appliqué, plutôt que de croire à une scrutation à la seconde.
    with pytest.raises(ValueError) as echec:
        normaliser_intervalle(valeur)
    assert "at least 5 seconds" in str(echec.value)


def test_un_intervalle_trop_long_est_refuse():
    with pytest.raises(ValueError) as echec:
        normaliser_intervalle(INTERVALLE_MAXIMAL_SECONDES + 1)
    assert "3600" in str(echec.value)


def test_le_message_de_refus_ne_contient_jamais_la_valeur_fautive():
    # Même discipline que `config.py` : le refus nomme la variable et la règle, jamais la valeur.
    with pytest.raises(ValueError) as echec:
        normaliser_intervalle(999_999)
    assert "999999" not in str(echec.value)


# ---------------------------------------------------------------------------------------------
# §20.10.4 — aucun chevauchement
# ---------------------------------------------------------------------------------------------


def test_le_delai_ne_se_reduit_pas_de_la_duree_du_tour():
    # C'est TOUTE la règle : l'intervalle court depuis la fin du tour, pas depuis son début.
    assert delai_avant_prochain_tour(0.0, 60) == 60.0
    assert delai_avant_prochain_tour(59.0, 60) == 60.0


def test_un_tour_plus_long_que_l_intervalle_n_ecrase_pas_le_delai():
    # L'écriture « à fréquence fixe » — `intervalle - duree` — rendrait ici -40, donc un tour
    # suivant immédiat, donc deux relèves simultanées du même compte quand le serveur est déjà lent.
    assert delai_avant_prochain_tour(100.0, 60) == 60.0
    assert delai_avant_prochain_tour(3_600.0, 5) == 5.0


def test_le_delai_est_toujours_positif_quelle_que_soit_la_duree():
    for duree in (0.0, 1.5, 10_000.0):
        assert delai_avant_prochain_tour(duree, 30) > 0


# ---------------------------------------------------------------------------------------------
# §20.10.6 — quels comptes, dans quel ordre
# ---------------------------------------------------------------------------------------------


def test_les_jamais_releves_passent_en_tete():
    comptes = [
        compte("ancien", releve_il_y_a=timedelta(hours=5)),
        compte("neuf"),
        compte("recent", releve_il_y_a=timedelta(minutes=1)),
    ]
    assert [c.identifiant for c in ordonner_comptes(comptes)] == ["neuf", "ancien", "recent"]


def test_le_plus_en_retard_passe_devant():
    comptes = [
        compte("b", releve_il_y_a=timedelta(minutes=1)),
        compte("a", releve_il_y_a=timedelta(hours=9)),
    ]
    assert [c.identifiant for c in ordonner_comptes(comptes)] == ["a", "b"]


def test_un_compte_sans_secret_est_ecarte_et_non_releve_en_echec():
    # Le garder ferait un échec par tour et par compte incomplet : un journal qui crie sans rien
    # apprendre à personne. La route `poll` rend déjà 409 pour ce cas.
    comptes = [compte("avec"), compte("sans", secret=False)]
    assert [c.identifiant for c in ordonner_comptes(comptes)] == ["avec"]


def test_l_ordre_est_stable_a_date_egale():
    # Sans départage, deux comptes relevés dans la même seconde changeraient d'ordre d'un tour à
    # l'autre, et un journal comparé d'une exécution à l'autre paraîtrait incohérent sans l'être.
    meme = timedelta(minutes=3)
    comptes = [compte("z", releve_il_y_a=meme), compte("a", releve_il_y_a=meme)]
    assert [c.identifiant for c in ordonner_comptes(comptes)] == ["a", "z"]
    assert [c.identifiant for c in ordonner_comptes(list(reversed(comptes)))] == ["a", "z"]


def test_une_liste_vide_ne_leve_pas():
    assert ordonner_comptes([]) == []


# ---------------------------------------------------------------------------------------------
# §20.10.3 — un compte en panne n'arrête pas le tour
# ---------------------------------------------------------------------------------------------


def test_un_compte_en_panne_n_empeche_pas_les_suivants():
    source = SourceFactice([compte("a"), compte("b"), compte("c")])
    vus: list[str] = []

    def relever(c: CompteAVeiller) -> None:
        vus.append(c.identifiant)
        if c.identifiant == "a":
            raise TimeoutError("imap timeout")

    journal = JournalFactice()
    resultat = executer_un_tour(source=source, relever=relever, journal=journal)

    # Les trois comptes ont bien été tentés : l'échec du premier n'a rien interrompu.
    assert vus == ["a", "b", "c"]
    assert resultat.releves == 2
    assert resultat.echecs == 1


def test_l_absorption_n_est_pas_un_silence():
    source = SourceFactice([compte("a")])

    def relever(_c: CompteAVeiller) -> None:
        raise TimeoutError("imap timeout")

    journal = JournalFactice()
    executer_un_tour(source=source, relever=relever, journal=journal)

    assert journal.noms() == ["veille_compte_echoue"]
    _, details = journal.evenements[0]
    assert details["account_id"] == "a"
    assert details["panne"] == "TimeoutError"


def test_le_journal_porte_le_TYPE_de_la_panne_et_jamais_son_texte():
    # §13.7 : le texte d'une exception peut porter un identifiant de connexion, ou un mot de passe
    # reflété par un serveur bavard. Il ne doit atteindre aucun journal.
    secret = "motdepasse-tres-secret"
    source = SourceFactice([compte("a")])

    def relever(_c: CompteAVeiller) -> None:
        raise RuntimeError(f"LOGIN failed for user with password {secret}")

    journal = JournalFactice()
    executer_un_tour(source=source, relever=relever, journal=journal)

    aplati = repr(journal.evenements)
    assert secret not in aplati
    assert "LOGIN failed" not in aplati
    assert "RuntimeError" in aplati


def test_une_source_indisponible_est_un_echec_et_non_un_parc_vide():
    # Rendre « réussi à zéro compte » ferait passer une base injoignable pour un parc sans compte.
    source = SourceFactice([], erreur=ConnectionError("postgrest down"))
    journal = JournalFactice()
    resultat = executer_un_tour(source=source, relever=lambda _c: None, journal=journal)

    assert resultat == type(resultat)(releves=0, echecs=1, ignores=0)
    assert journal.noms() == ["veille_source_indisponible"]
    assert journal.evenements[0][1]["panne"] == "ConnectionError"
    assert "postgrest down" not in repr(journal.evenements)


def test_les_comptes_sans_secret_sont_comptes_comme_ignores_et_non_comme_echecs():
    source = SourceFactice([compte("a"), compte("b", secret=False)])
    journal = JournalFactice()
    resultat = executer_un_tour(source=source, relever=lambda _c: None, journal=journal)

    assert (resultat.releves, resultat.echecs, resultat.ignores) == (1, 0, 1)
    # Un compte ignoré ne produit AUCUN événement d'échec : ce n'est pas une panne.
    assert journal.noms() == []


def test_l_ordre_du_tour_est_celui_du_tri():
    source = SourceFactice(
        [compte("ancien", releve_il_y_a=timedelta(hours=5)), compte("neuf")]
    )
    vus: list[str] = []
    executer_un_tour(
        source=source, relever=lambda c: vus.append(c.identifiant), journal=JournalFactice()
    )
    assert vus == ["neuf", "ancien"]


# ---------------------------------------------------------------------------------------------
# §20.10.1 et §20.10.5 — le pilote
# ---------------------------------------------------------------------------------------------


def test_le_pilote_desactive_ne_demarre_aucun_fil_et_le_dit(caplog):
    pilote = PiloteVeille(
        intervalle=0,
        source=SourceFactice([compte("a")]),
        relever=lambda _c: None,
        logger=logging.getLogger("test-veille-off"),
    )
    assert pilote.active is False
    with caplog.at_level(logging.INFO):
        pilote.demarrer()
    assert "veille_desactivee" in caplog.text
    # Rien n'a été relevé : la veille est éteinte, pas ralentie.
    pilote.arreter()


def test_le_pilote_actif_releve_puis_s_arrete_sans_attendre_l_intervalle():
    # L'intervalle est RÉEL (60 s) et la preuve dure quelques millisecondes : l'arrêt interrompt
    # l'attente au lieu de retenir le fil jusqu'à son terme (§20.10.1). Si `Event.wait` était
    # remplacé par `time.sleep`, ce test prendrait une minute — c'est ainsi qu'il l'atteste.
    source = SourceFactice([compte("a")])
    vus: list[str] = []
    pilote: PiloteVeille

    def relever(c: CompteAVeiller) -> None:
        vus.append(c.identifiant)
        # L'arrêt est demandé DEPUIS le tour : au retour, le pilote entre dans son attente et en
        # sort immédiatement, sans qu'aucune horloge n'ait été avancée artificiellement.
        pilote.arreter(timeout=0)

    pilote = PiloteVeille(
        intervalle=60,
        source=source,
        relever=relever,
        logger=logging.getLogger("test-veille-on"),
    )
    assert pilote.active is True
    pilote.demarrer()
    pilote.arreter(timeout=5)

    assert vus == ["a"]
    assert source.appels >= 1


def test_le_pilote_refuse_un_intervalle_hors_bornes_a_la_construction():
    with pytest.raises(ValueError):
        PiloteVeille(
            intervalle=1,
            source=SourceFactice([]),
            relever=lambda _c: None,
            logger=logging.getLogger("test-veille-borne"),
        )


def test_arreter_un_pilote_jamais_demarre_ne_leve_pas():
    pilote = PiloteVeille(
        intervalle=0,
        source=SourceFactice([]),
        relever=lambda _c: None,
        logger=logging.getLogger("test-veille-idempotent"),
    )
    pilote.arreter()
    pilote.arreter()

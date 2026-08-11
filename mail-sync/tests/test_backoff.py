# @verifies CRM-059 (docs/BACKLOG.md) — « pytest sur le backoff », premier point de la DoD
# @verifies docs/SPEC-mail-subsystem.md §20.3 (le backoff, sa borne, et ce qui ne se rejoue pas)
# @verifies docs/JOURNAL.md décision 331
#
# LA RÈGLE EST ÉPROUVÉE SANS SERVEUR : c'est tout l'objet d'un module qui ne parle à personne. Une
# preuve qui aurait besoin d'un SMTP en panne pour vérifier un délai mesurerait la panne, pas la
# règle.

from __future__ import annotations

import pytest

from mail_sync.backoff import (
    DELAI_INITIAL_SECONDES,
    PANNES_REJOUABLES,
    TENTATIVES_MAX,
    decider,
    delais_prevus,
)


@pytest.mark.parametrize("code", sorted(PANNES_REJOUABLES))
def test_une_panne_de_transport_se_rejoue(code: str) -> None:
    """Un serveur injoignable reviendra : perdre le message serait perdre ce qu'un délai sauve."""

    decision = decider(code, tentatives=1)
    assert decision.rejouer is True
    assert decision.delai_secondes == DELAI_INITIAL_SECONDES


@pytest.mark.parametrize(
    "code", ["auth_failed", "sender_rejected", "recipient_rejected", "unknown_host"]
)
def test_un_refus_ne_se_rejoue_JAMAIS(code: str) -> None:
    """LA DISTINCTION QUI GOUVERNE TOUT (décision 331) : attendre ne rend pas juste un mot de passe
    faux. Rejouer un refus, c'est répéter une erreur en espérant un autre résultat."""

    decision = decider(code, tentatives=1)
    assert decision.rejouer is False
    assert decision.delai_secondes == 0
    # LE CODE D'ORIGINE EST CONSERVÉ : l'exploitant doit lire la cause, pas un verdict générique.
    assert decision.code == code


def test_la_progression_est_GEOMETRIQUE() -> None:
    """Sans progression, un serveur en panne serait interrogé toutes les minutes."""

    assert delais_prevus() == (60, 240, 960, 3840)


def test_la_progression_est_BORNEE() -> None:
    """Sans borne, un message adressé à un domaine disparu resterait en file pour toujours, et
    l'exploitant croirait qu'il finira par partir."""

    assert decider("timeout", tentatives=TENTATIVES_MAX).rejouer is False
    assert decider("timeout", tentatives=TENTATIVES_MAX + 5).rejouer is False


def test_la_borne_conserve_la_CAUSE_et_non_un_verdict() -> None:
    """« Trop de tentatives » ferait perdre le motif réel de l'échec."""

    decision = decider("connection_refused", tentatives=TENTATIVES_MAX)
    assert decision.code == "connection_refused"


def test_un_compte_de_tentatives_aberrant_ne_produit_pas_de_delai_negatif() -> None:
    """La valeur vient de la base, et une colonne ne garantit jamais une valeur : un zéro — voire
    un compte incohérent — doit produire une attente, jamais une régression dans le passé."""

    assert decider("timeout", tentatives=0).delai_secondes == DELAI_INITIAL_SECONDES
    assert decider("timeout", tentatives=-3).delai_secondes == DELAI_INITIAL_SECONDES


def test_les_quatre_pannes_rejouables_sont_celles_de_la_sonde() -> None:
    """LE VOCABULAIRE EST COMMUN À LA SONDE ET AU WORKER (§13.7) : deux listes pour une seule
    réalité obligeraient à les rapprocher de tête, et l'une divergerait."""

    assert PANNES_REJOUABLES == {"connection_refused", "timeout", "tls_failed", "protocol_error"}

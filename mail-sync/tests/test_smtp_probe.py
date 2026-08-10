# @verifies CRM-053 (docs/BACKLOG.md) — test de connexion d'une identité sortante
# @verifies docs/SPEC-mail-subsystem.md §14.4 (le test), §14.5 (le délai de pénalité mesuré),
#           §13.7 (les six codes, partagés avec IMAP)
# @verifies docs/JOURNAL.md décision 318

from __future__ import annotations

import smtplib
import socket
import ssl
from errno import EHOSTUNREACH

import pytest

from mail_sync import smtp_probe
from mail_sync.imap_probe import (
    AUTH_FAILED,
    CONNECTION_REFUSED,
    ERROR_CODES,
    HOST_UNREACHABLE,
    PROTOCOL_ERROR,
    TIMEOUT,
    TLS_FAILED,
    ProbeResult,
)
from mail_sync.smtp_probe import DEFAULT_TIMEOUT_SECONDS, probe_outbound_identity


@pytest.mark.parametrize(
    ("exception", "attendu"),
    [
        (smtplib.SMTPAuthenticationError(535, b"5.7.8 Authentication credentials invalid."), AUTH_FAILED),
        (ssl.SSLCertVerificationError("self-signed certificate"), TLS_FAILED),
        (socket.timeout("timed out"), TIMEOUT),
        (socket.gaierror(-2, "Name or service not known"), HOST_UNREACHABLE),
        (ConnectionRefusedError(111, "Connection refused"), CONNECTION_REFUSED),
        (OSError(EHOSTUNREACH, "No route to host"), HOST_UNREACHABLE),
        # `SMTPServerDisconnected` est exactement ce que rendait un délai trop court avant la
        # décision 318. Le compter comme `auth_failed` ferait ressaisir un mot de passe correct ;
        # le compter comme `timeout` inventerait une panne de réseau. `protocol_error` dit la
        # vérité : le serveur a coupé sans se prononcer.
        (smtplib.SMTPServerDisconnected("Connection unexpectedly closed"), PROTOCOL_ERROR),
        (smtplib.SMTPResponseException(451, b"try again"), PROTOCOL_ERROR),
    ],
)
def test_chaque_panne_smtp_a_son_code(exception: BaseException, attendu: str) -> None:
    assert smtp_probe._translate(exception) == attendu
    assert attendu in ERROR_CODES


def test_le_delai_par_defaut_depasse_le_delai_de_penalite_mesure() -> None:
    """LE CŒUR DE LA DÉCISION 318, en une assertion.

    Stalwart applique dix secondes de pénalité sur un échec d'authentification, puis rend
    `535 5.7.8`. Un délai de test inférieur ou égal transformerait un mot de passe faux en
    `timeout` : le diagnostic mentirait. Cette assertion tombera si quelqu'un ramène le délai SMTP
    à celui d'IMAP.
    """

    from mail_sync.imap_probe import DEFAULT_TIMEOUT_SECONDS as DELAI_IMAP

    penalite_mesuree = 10.0
    assert DEFAULT_TIMEOUT_SECONDS > penalite_mesuree
    assert DEFAULT_TIMEOUT_SECONDS > DELAI_IMAP


def test_un_mode_de_securite_inconnu_ne_tente_aucune_connexion(monkeypatch: pytest.MonkeyPatch) -> None:
    def interdit(*_args: object, **_kwargs: object) -> None:  # pragma: no cover
        raise AssertionError("aucune connexion ne doit être tentée")

    monkeypatch.setattr(smtp_probe.smtplib, "SMTP", interdit)
    verdict = probe_outbound_identity(
        host="stalwart", port=587, security="smtps", username="u", password="p"
    )
    assert verdict == ProbeResult(ok=False, error=PROTOCOL_ERROR)


def test_un_hote_qui_ne_se_resout_pas_rend_host_unreachable() -> None:
    verdict = probe_outbound_identity(
        host="hote-qui-nexiste-pas.invalid",
        port=587,
        security="none",
        username="u",
        password="p",
        timeout=2.0,
    )
    assert verdict.ok is False
    assert verdict.error == HOST_UNREACHABLE


def test_un_port_ferme_rend_connection_refused() -> None:
    with socket.socket() as sonde:
        sonde.bind(("127.0.0.1", 0))
        port_ferme = sonde.getsockname()[1]

    verdict = probe_outbound_identity(
        host="127.0.0.1",
        port=port_ferme,
        security="none",
        username="u",
        password="p",
        timeout=2.0,
    )
    assert verdict.ok is False
    assert verdict.error == CONNECTION_REFUSED


def test_le_verdict_sortant_ne_porte_pas_de_dossiers() -> None:
    """`folders` n'a pas de sens en SMTP : le champ reste à zéro plutôt que d'être détourné."""

    verdict = probe_outbound_identity(
        host="hote-qui-nexiste-pas.invalid", port=587, security="none",
        username="u", password="p", timeout=2.0,
    )
    assert verdict.folders == 0

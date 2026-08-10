# @verifies CRM-052 (docs/BACKLOG.md) — test de connexion d'un compte entrant
# @verifies docs/SPEC-mail-subsystem.md §13.5 (le test de connexion), §13.6 (ce que le
#           développement peut prouver), §13.7 (le message d'erreur est un CODE)
# @verifies docs/JOURNAL.md décision 316
#
# CE QUE CES CAS ÉPROUVENT : la TRADUCTION d'une panne en code stable, et le fait qu'aucune phrase
# de serveur distant ne franchit cette frontière. Le succès contre un vrai serveur relève de
# `e2e/mail/mail-inbound.spec.ts` : un serveur IMAP ne se simule pas honnêtement ici.

from __future__ import annotations

import socket
import ssl
from errno import EHOSTUNREACH, ENETUNREACH

import pytest
from imapclient.exceptions import IMAPClientError, LoginError

from mail_sync import imap_probe
from mail_sync.imap_probe import (
    AUTH_FAILED,
    CONNECTION_REFUSED,
    ERROR_CODES,
    HOST_UNREACHABLE,
    PROTOCOL_ERROR,
    TIMEOUT,
    TLS_FAILED,
    ProbeResult,
    probe_inbound_account,
)


@pytest.mark.parametrize(
    ("exception", "attendu"),
    [
        (LoginError("[AUTHENTICATIONFAILED] Authentication failed"), AUTH_FAILED),
        (ssl.SSLCertVerificationError("self-signed certificate"), TLS_FAILED),
        (ssl.SSLError("handshake failure"), TLS_FAILED),
        (socket.timeout("timed out"), TIMEOUT),
        (TimeoutError(), TIMEOUT),
        (socket.gaierror(-2, "Name or service not known"), HOST_UNREACHABLE),
        (ConnectionRefusedError(111, "Connection refused"), CONNECTION_REFUSED),
        (OSError(EHOSTUNREACH, "No route to host"), HOST_UNREACHABLE),
        (OSError(ENETUNREACH, "Network is unreachable"), HOST_UNREACHABLE),
        (IMAPClientError("BAD unexpected"), PROTOCOL_ERROR),
        (OSError(32, "Broken pipe"), PROTOCOL_ERROR),
    ],
)
def test_chaque_panne_a_son_code(exception: BaseException, attendu: str) -> None:
    assert imap_probe._translate(exception) == attendu
    assert attendu in ERROR_CODES


def test_aucune_phrase_de_serveur_ne_franchit_la_frontiere() -> None:
    """Le §13.7 en une assertion : le texte distant ne ressort jamais du module."""

    phrase = "[AUTHENTICATIONFAILED] user=victime@exemple.tld ticket=42"
    code = imap_probe._translate(LoginError(phrase))
    assert code == AUTH_FAILED
    assert "victime" not in code
    assert "ticket" not in code


def test_un_mode_de_securite_inconnu_ne_tente_aucune_connexion(monkeypatch: pytest.MonkeyPatch) -> None:
    """Une valeur hors vocabulaire vient d'un appelant fautif, pas de la table : sa contrainte
    l'interdit. Le dire vaut mieux que d'ouvrir une session dont le mode est indéfini."""

    def interdit(*_args: object, **_kwargs: object) -> None:  # pragma: no cover - ne doit pas courir
        raise AssertionError("aucune connexion ne doit être tentée")

    monkeypatch.setattr(imap_probe, "IMAPClient", interdit)
    verdict = probe_inbound_account(
        host="stalwart", port=143, security="imaps", username="u", password="p"
    )
    assert verdict == ProbeResult(ok=False, error=PROTOCOL_ERROR)


def test_un_hote_qui_ne_se_resout_pas_rend_host_unreachable() -> None:
    """Contre un nom réellement inexistant : aucune simulation, et aucun réseau atteint."""

    verdict = probe_inbound_account(
        host="hote-qui-nexiste-pas.invalid",
        port=143,
        security="none",
        username="u",
        password="p",
        timeout=2.0,
    )
    assert verdict.ok is False
    assert verdict.error == HOST_UNREACHABLE
    assert verdict.folders == 0


def test_un_port_ferme_rend_connection_refused() -> None:
    """Un port réellement fermé sur la boucle locale : la panne est provoquée, pas décrite."""

    with socket.socket() as sonde:
        sonde.bind(("127.0.0.1", 0))
        port_ferme = sonde.getsockname()[1]
    # La sonde est refermée : plus rien n'écoute sur ce port.

    verdict = probe_inbound_account(
        host="127.0.0.1",
        port=port_ferme,
        security="none",
        username="u",
        password="p",
        timeout=2.0,
    )
    assert verdict.ok is False
    assert verdict.error == CONNECTION_REFUSED


def test_le_verdict_ne_porte_que_des_codes_du_catalogue() -> None:
    """La contrainte `CHECK` de la migration 22 refuse tout le reste : les deux listes doivent
    coïncider, sans quoi le service écrirait une valeur que la base rejette."""

    assert ERROR_CODES == {
        "auth_failed",
        "host_unreachable",
        "connection_refused",
        "tls_failed",
        "timeout",
        "protocol_error",
    }

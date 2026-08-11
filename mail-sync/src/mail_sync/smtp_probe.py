# @spec CRM-053 (docs/BACKLOG.md) — test de connexion réel d'une identité sortante
# @spec docs/SPEC-mail-subsystem.md §14.4 (le test de connexion), §14.5 (le délai de pénalité),
#       §13.7 (les six codes, partagés avec IMAP), §10 arbitrage n° 1 (TLS toujours vérifié)
# @spec docs/JOURNAL.md décision 318
#
# CE MODULE OUVRE UNE VRAIE SESSION SMTP, ET N'ENVOIE AUCUN MESSAGE.
#
# Une unité qui n'a pas de destinataire n'a pas à en inventer un, et un test qui écrirait dans une
# boîte laisserait une trace que personne n'a demandée (§14.4). La session s'authentifie, émet un
# `NOOP`, et referme.
#
# LE CATALOGUE DE CODES EST CELUI D'IMAP, et c'est voulu : une panne réseau est une panne réseau,
# qu'elle survienne d'un côté ou de l'autre. Inventer un second vocabulaire pour les mêmes causes
# obligerait l'exploitant à en apprendre deux.

from __future__ import annotations

import smtplib
import socket
import ssl
from errno import EHOSTUNREACH, ENETUNREACH

from mail_sync.imap_probe import (
    AUTH_FAILED,
    CONNECTION_REFUSED,
    HOST_UNREACHABLE,
    PROTOCOL_ERROR,
    SECURITY_MODES,
    TIMEOUT,
    TLS_FAILED,
    ProbeResult,
)


#: TRENTE SECONDES, ET NON DIX. MESURÉ (décision 318) : Stalwart applique un délai de pénalité de
#: **dix secondes** sur un échec d'authentification SMTP, puis rend `535 5.7.8`. Avec le délai
#: d'IMAP, un mot de passe faux serait rapporté comme un `timeout` — le diagnostic mentirait, et
#: l'exploitant chercherait une panne de réseau là où il n'y a qu'un mot de passe erroné.
DEFAULT_TIMEOUT_SECONDS = 30.0


def classer_panne_smtp(exception: BaseException) -> str:
    """Alias public de la traduction des pannes — employé par le worker d'envoi (`CRM-058`).

    LA TRADUCTION EST LA MÊME QUE CELLE DU TEST DE CONNEXION, ET C'EST VOULU : un exploitant qui
    lit `auth_failed` dans l'état d'une identité doit lire le même code lorsqu'un envoi échoue
    pour la même raison. Deux vocabulaires pour une seule panne obligeraient à les rapprocher de
    tête (docs/SPEC-mail-subsystem.md §13.7).
    """

    return _translate(exception)


def _translate(exception: BaseException) -> str:
    """Traduit une panne SMTP en code stable.

    L'ORDRE COMPTE, comme pour IMAP. `SMTPAuthenticationError` descend de `SMTPResponseException`,
    qui descend de `SMTPException` : les tester après leurs parents rendrait la branche
    inatteignable.
    """

    if isinstance(exception, smtplib.SMTPAuthenticationError):
        return AUTH_FAILED
    if isinstance(exception, ssl.SSLError):
        return TLS_FAILED
    if isinstance(exception, (socket.timeout, TimeoutError)):
        return TIMEOUT
    if isinstance(exception, socket.gaierror):
        return HOST_UNREACHABLE
    if isinstance(exception, ConnectionRefusedError):
        return CONNECTION_REFUSED
    if isinstance(exception, OSError) and exception.errno in (EHOSTUNREACH, ENETUNREACH):
        return HOST_UNREACHABLE
    # `SMTPServerDisconnected` tombe ici, et c'est exact : le serveur a coupé sans se prononcer.
    # Le compter comme `auth_failed` ferait ressaisir un mot de passe correct — c'est précisément
    # ce que produisait un délai trop court avant la décision 318.
    return PROTOCOL_ERROR


def probe_outbound_identity(
    *,
    host: str,
    port: int,
    security: str,
    username: str,
    password: str,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> ProbeResult:
    """Ouvre une session SMTP réelle, s'authentifie, émet `NOOP`, et referme.

    La vérification TLS n'a aucun mode dégradé, exactement comme en IMAP : le contexte vient de
    `ssl.create_default_context()`, et aucun paramètre du produit ne permet de le désactiver.
    """

    if security not in SECURITY_MODES:
        return ProbeResult(ok=False, error=PROTOCOL_ERROR)

    session: smtplib.SMTP | None = None
    try:
        if security == "ssl":
            session = smtplib.SMTP_SSL(
                host, port, timeout=timeout, context=ssl.create_default_context()
            )
        else:
            session = smtplib.SMTP(host, port, timeout=timeout)
            session.ehlo()
            if security == "starttls":
                session.starttls(context=ssl.create_default_context())
                session.ehlo()
        session.login(username, password)
        session.noop()
        # `folders` n'a pas de sens en SMTP ; le champ reste à zéro plutôt que d'être détourné.
        return ProbeResult(ok=True)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exception:
        return ProbeResult(ok=False, error=_translate(exception))
    finally:
        if session is not None:
            try:
                session.quit()
            except Exception:  # noqa: BLE001
                # Le verdict est déjà établi ; une déconnexion ratée ne le change pas.
                pass

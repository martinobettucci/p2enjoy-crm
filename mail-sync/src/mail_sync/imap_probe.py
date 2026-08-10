# @spec CRM-052 (docs/BACKLOG.md) — test de connexion réel d'un compte entrant
# @spec docs/SPEC-mail-subsystem.md §13.5 (le test de connexion), §13.6 (ce que le développement
#       peut prouver), §13.7 (le message d'erreur est un CODE), §10 arbitrage n° 1 (IMAPClient,
#       et un contexte TLS qui vérifie toujours)
# @spec docs/JOURNAL.md décision 316
#
# CE MODULE OUVRE UNE VRAIE SESSION IMAP, ET N'ÉCRIT NULLE PART.
#
# Il ne connaît ni PostgREST, ni Vault, ni la table : il reçoit des paramètres de connexion, il
# essaie, et il rend un verdict. Cette séparation est ce qui le rend éprouvable sans base — les
# tests unitaires exercent la traduction des pannes en codes contre un serveur qui n'existe pas,
# et l'E2E exerce le succès contre le vrai Stalwart.
#
# LA BIBLIOTHÈQUE EST CELLE QUE `CRM-054` EMPLOIERA. L'arbitrage n° 1 du §10 a retenu IMAPClient
# 3.1.0 et a écrit qu'il n'entrerait dans l'image qu'avec son premier consommateur : c'est cette
# unité. Éprouver la connexion avec `imaplib` pendant que le worker emploierait IMAPClient
# prouverait un chemin que le produit n'emprunte pas.

from __future__ import annotations

import socket
import ssl
from dataclasses import dataclass
from errno import EHOSTUNREACH, ENETUNREACH

from imapclient import IMAPClient
from imapclient.exceptions import IMAPClientError, LoginError


#: Délai par défaut d'un test de connexion. Un compte injoignable ne doit pas retenir un appelant
#: plus longtemps qu'il ne faut pour conclure.
DEFAULT_TIMEOUT_SECONDS = 10.0

#: Les six codes du §13.7, et rien d'autre. La contrainte `CHECK` de la migration 22 les répète :
#: une valeur absente de cette liste ne peut pas être écrite en base.
AUTH_FAILED = "auth_failed"
HOST_UNREACHABLE = "host_unreachable"
CONNECTION_REFUSED = "connection_refused"
TLS_FAILED = "tls_failed"
TIMEOUT = "timeout"
PROTOCOL_ERROR = "protocol_error"

ERROR_CODES = frozenset(
    {AUTH_FAILED, HOST_UNREACHABLE, CONNECTION_REFUSED, TLS_FAILED, TIMEOUT, PROTOCOL_ERROR}
)

SECURITY_MODES = frozenset({"ssl", "starttls", "none"})


@dataclass(frozen=True)
class ProbeResult:
    """Verdict d'un test de connexion.

    `error` est toujours l'un des six codes, jamais la phrase du serveur distant : celle-ci est
    une entrée non maîtrisée qui finirait affichée puis capturée (§13.7).
    """

    ok: bool
    error: str | None = None
    #: Nombre de dossiers rendus par `LIST`, quand la connexion aboutit. Il n'est pas décoratif :
    #: une session qui s'ouvre puis ne sait rien lister n'est pas une session utilisable.
    folders: int = 0


def _translate(exception: BaseException) -> str:
    """Traduit une panne en code stable.

    L'ORDRE COMPTE. `LoginError` et `socket.timeout` descendent l'un d'`IMAPClientError`, l'autre
    d'`OSError` : les tester après leurs parents rendrait la branche inatteignable, et le verdict
    serait juste par accident.
    """

    if isinstance(exception, LoginError):
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
    # Un serveur qui répond sans parler IMAP, et toute défaillance qu'aucune des cinq causes
    # précédentes n'explique. Le repli est NOMMÉ plutôt que silencieux : le confondre avec
    # `auth_failed` ferait ressaisir un mot de passe correct.
    return PROTOCOL_ERROR


def probe_inbound_account(
    *,
    host: str,
    port: int,
    security: str,
    username: str,
    password: str,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> ProbeResult:
    """Ouvre une session IMAP réelle, liste les dossiers, et referme.

    LA VÉRIFICATION TLS N'A AUCUN MODE DÉGRADÉ (arbitrage n° 1 du §10). Le contexte vient de
    `ssl.create_default_context()`, qui vérifie certificat **et** nom d'hôte, et aucun paramètre du
    produit ne permet de le désactiver. C'est pourquoi le Stalwart de développement, dont le
    certificat est auto-signé, rend `tls_failed` en `starttls` : le refus est la bonne réponse, et
    le §13.6 l'écrit plutôt que de le contourner.

    `security='none'` n'est pas une exception à cette règle : aucun TLS n'est négocié, donc rien
    n'est vérifié à tort. C'est le mode que la pile locale peut prouver en succès.
    """

    if security not in SECURITY_MODES:
        # Une valeur hors vocabulaire ne peut pas venir de la table — sa contrainte l'interdit —,
        # donc elle vient d'un appelant fautif. Le dire vaut mieux que de tenter une connexion
        # dont le mode est indéfini.
        return ProbeResult(ok=False, error=PROTOCOL_ERROR)

    client: IMAPClient | None = None
    try:
        client = IMAPClient(
            host=host,
            port=port,
            use_uid=True,
            ssl=security == "ssl",
            ssl_context=ssl.create_default_context() if security == "ssl" else None,
            timeout=timeout,
        )
        if security == "starttls":
            client.starttls(ssl.create_default_context())
        client.login(username, password)
        folders = client.list_folders()
        return ProbeResult(ok=True, folders=len(folders))
    except (IMAPClientError, OSError, ssl.SSLError) as exception:
        return ProbeResult(ok=False, error=_translate(exception))
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:  # noqa: BLE001
                # Une déconnexion ratée ne change RIEN au verdict : la session a réussi ou
                # échoué avant. L'ignorer ici n'est pas un `except` vide qui masque une erreur
                # (CLAUDE.md §18) — c'est le seul cas où le résultat est déjà établi.
                pass

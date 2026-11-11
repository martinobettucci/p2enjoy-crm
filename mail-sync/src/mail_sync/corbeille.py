# @spec CRM-138 (docs/BACKLOG.md) — tranche T2 : le déplacement d'un message effacé dans la corbeille de sa boîte, et la
#       purge à 30 jours
# @spec docs/SPEC-mail-subsystem.md §29.5 (le dossier `\Trash`, `MOVE` ou `COPY` puis `EXPUNGE`, l'UID absent, les
#       essais espacés), §29.6 (la purge : les objets des pièces, puis la ligne) ; docs/JOURNAL.md décisions 878 et 917 ;
#       CLAUDE.md §18 (aucune simulation de succès), §20 (aucun secret au journal)
#
# LE MESSAGE EST DÉJÀ DANS LA CORBEILLE DU CRM : ce module ne décide jamais de ce que l'écran montre. Il exécute ce que la
# base a demandé (`trash_moves_to_process`) et lui rend l'issue RÉELLE de chaque essai (`trash_move_record`) : `done`
# seulement quand le serveur a déplacé le message — ou ne l'a plus dans ce dossier —, `failed` quand le serveur ne sait pas
# le faire, `retry` quand il n'a pas répondu. La base compte les essais et espace les suivants (`0180`).

from __future__ import annotations

import logging
import ssl
import threading
from dataclasses import dataclass
from typing import Any, Callable, ContextManager, Protocol

from imapclient import DELETED
from imapclient.exceptions import IMAPClientError, LoginError

from mail_sync.postgrest import PostgrestError
from mail_sync.structured_logging import log_event

#: Un lot de déplacements : vingt, le patron de la reprise des pièces (`reprise.py`).
LOT_DEPLACEMENTS = 20
#: Un lot de purge : cinquante messages.
LOT_PURGE = 50
#: Les déplacements se tentent chaque minute ; la base décide lesquels sont échus (1, 5, 15, 60 puis 240 minutes).
INTERVALLE_DEPLACEMENTS_SECONDES = 60
#: La purge passe au plus une fois par heure (§29.6).
INTERVALLE_PURGE_SECONDES = 60 * 60


class SourceCorbeille(Protocol):
    """Ce que le module attend de la base et du stockage — réduit au strict nécessaire, pour se prouver sans eux."""

    def deplacements_a_faire(self, limite: int) -> list[dict[str, Any]]: ...

    def enregistrer_deplacement(self, move_id: str, issue: str, erreur: str | None) -> str: ...

    def messages_a_purger(self, limite: int) -> list[dict[str, Any]]: ...

    def supprimer_objet_piece(self, chemin: str) -> None: ...

    def purger_message(self, message_id: str) -> bool: ...


#: Ouvre la boîte d'un compte et rend le client IMAP, ou `None` pour un compte disparu.
OuvrirBoite = Callable[[str], ContextManager[Any] | None]


@dataclass(frozen=True)
class BilanDeplacements:
    faits: int = 0
    echoues: int = 0
    reessayes: int = 0


@dataclass(frozen=True)
class BilanPurge:
    purges: int = 0
    objets: int = 0
    echoues: int = 0


def _dossiers_et_usages(imap: Any) -> list[tuple[Any, Any, Any]]:
    """Les dossiers avec leurs attributs d'usage spécial.

    MESURÉ sur le serveur de dev (2026-11-11) : un `LIST` simple ne rend AUCUN attribut d'usage — « Deleted Items » y paraît
    sans `\\Trash`. RFC 6154 : un serveur qui annonce `SPECIAL-USE` les rend sur `LIST "" "*" RETURN (SPECIAL-USE)`.
    IMAPClient 3.1 n'expose pas cette forme ; elle passe par sa connexion `imaplib` sous-jacente et son analyseur de
    réponse, exactement comme son `_do_list`. Sans `SPECIAL-USE`, les attributs d'un `LIST` simple, s'il y en a.
    `find_special_folder` d'IMAPClient est écarté : il retombe sur des noms courants, et la spécification interdit de
    deviner (§29.5)."""

    if not imap.has_capability("SPECIAL-USE"):
        return list(imap.list_folders())
    typ, dat = imap._imap._simple_command("LIST", '""', '"*"', "RETURN", "(SPECIAL-USE)")
    imap._checkok("list", typ, dat)
    typ, dat = imap._imap._untagged_response(typ, dat, "LIST")
    return list(imap._proc_folder_list(dat))


def _dossier_corbeille(imap: Any) -> str | None:
    """Le dossier annoncé `\\Trash` (RFC 6154) ; aucun : `None`, jamais un nom deviné."""

    for drapeaux, _delimiteur, nom in _dossiers_et_usages(imap):
        if any(bytes(d).lower() == b"\\trash" for d in drapeaux):
            return nom if isinstance(nom, str) else bytes(nom).decode("utf-8", "replace")
    return None


def deplacer(imap: Any, dossier: str, uid: int) -> tuple[str, str | None]:
    """Un essai sur une boîte ouverte. Rend `(issue, motif)` — `done`, `failed` ou une exception à réessayer."""

    corbeille = _dossier_corbeille(imap)
    if corbeille is None:
        return "failed", "no_trash_folder"
    imap.select_folder(dossier)
    if uid not in set(imap.search(["UID", str(uid)])):
        # Déjà déplacé, ou effacé sur le serveur : il n'est plus dans ce dossier, rien à faire.
        return "done", "absent_from_folder"
    capacites = {bytes(c).upper() for c in imap.capabilities()}
    if b"MOVE" in capacites:
        imap.move([uid], corbeille)
    elif b"UIDPLUS" in capacites:
        imap.copy([uid], corbeille)
        imap.add_flags([uid], [DELETED])
        imap.uid_expunge([uid])
    else:
        return "failed", "move_unsupported"
    return "done", None


def _motif_reseau(erreur: BaseException) -> str:
    if isinstance(erreur, LoginError):
        return "auth_failed"
    if isinstance(erreur, (TimeoutError,)):
        return "timeout"
    if isinstance(erreur, ssl.SSLError):
        return "tls_failed"
    return "connection_failed"


def deplacer_lot(
    source: SourceCorbeille,
    *,
    ouvrir_boite: OuvrirBoite,
    journal: Callable[..., None] = lambda _evenement, **_details: None,
    limite: int = LOT_DEPLACEMENTS,
) -> BilanDeplacements:
    """Un lot de déplacements échus. Chaque essai rend son issue réelle à la base, qui compte et espace."""

    faits = echoues = reessayes = 0
    for ligne in source.deplacements_a_faire(limite):
        move_id = str(ligne["move_id"])
        try:
            boite = ouvrir_boite(str(ligne["account_id"]))
            if boite is None:
                issue, motif = "failed", "account_not_found"
            else:
                with boite as imap:
                    issue, motif = deplacer(imap, str(ligne["folder"]), int(ligne["uid"]))
        except (IMAPClientError, OSError, ssl.SSLError) as erreur:
            issue, motif = "retry", _motif_reseau(erreur)
        etat = source.enregistrer_deplacement(move_id, issue, motif)
        if etat == "done":
            faits += 1
        elif etat == "failed":
            echoues += 1
        else:
            reessayes += 1
        journal("corbeille_deplacement", move_id=move_id, issue=etat, motif=motif)
    return BilanDeplacements(faits, echoues, reessayes)


def purger_lot(
    source: SourceCorbeille,
    *,
    journal: Callable[..., None] = lambda _evenement, **_details: None,
    limite: int = LOT_PURGE,
) -> BilanPurge:
    """La purge à 30 jours : les objets des pièces d'abord, puis la ligne (§29.6). Un objet qui ne s'efface pas garde le
    message : il sera repris au passage suivant, plutôt que de laisser un fichier sans ligne qui le nomme."""

    purges = objets = echoues = 0
    for ligne in source.messages_a_purger(limite):
        message_id = str(ligne["message_id"])
        try:
            for chemin in ligne.get("storage_paths") or []:
                source.supprimer_objet_piece(str(chemin))
                objets += 1
            if source.purger_message(message_id):
                purges += 1
        except PostgrestError as erreur:
            echoues += 1
            journal("corbeille_purge_echouee", message_id=message_id, statut=erreur.status_code)
    if purges or echoues:
        journal("corbeille_purge", purges=purges, objets=objets, echoues=echoues)
    return BilanPurge(purges, objets, echoues)


def ouvrir_boite_depuis(client: Any, timeout: float) -> OuvrirBoite:
    """Ouvre la boîte d'un compte avec ses identifiants lus sous la clé de service (`read_credentials`), comme la veille ;
    la session est close en sortie. Un compte disparu rend `None`."""

    from contextlib import contextmanager

    from mail_sync.ingestion import _connecter

    def ouvrir(account_id: str) -> ContextManager[Any] | None:
        compte = client.read_credentials(account_id)
        if compte is None:
            return None

        @contextmanager
        def session():  # type: ignore[no-untyped-def]
            imap = _connecter(compte, timeout)
            try:
                yield imap
            finally:
                try:
                    imap.logout()
                except (IMAPClientError, OSError):
                    pass  # la session est déjà rompue : rien à rendre, le résultat de l'essai est déjà connu

        return session()

    return ouvrir


def executer_passes(settings: Any, logger: logging.Logger) -> tuple[Callable[[], BilanDeplacements], Callable[[], BilanPurge]]:
    """Les deux passes du pilote et de la route interne, chacune avec un client neuf — le même chemin des deux côtés."""

    from mail_sync.postgrest import PostgrestClient

    def client():  # type: ignore[no-untyped-def]
        return PostgrestClient(settings.SUPABASE_URL, settings.SERVICE_ROLE_KEY.get_secret_value(), timeout=60.0)

    def journal(evenement: str, **details: Any) -> None:
        log_event(logger, logging.INFO, evenement, **details)

    def deplacements(limite: int = LOT_DEPLACEMENTS) -> BilanDeplacements:
        c = client()
        return deplacer_lot(c, ouvrir_boite=ouvrir_boite_depuis(c, settings.MAIL_SYNC_IMAP_TIMEOUT_SECONDS),
                            journal=journal, limite=limite)

    def purge(limite: int = LOT_PURGE) -> BilanPurge:
        return purger_lot(client(), journal=journal, limite=limite)

    return deplacements, purge


class PiloteCorbeille:
    """Deux passes en fil d'exécution : les déplacements chaque minute, la purge chaque heure. S'arrête net."""

    def __init__(
        self,
        *,
        deplacer: Callable[[], object],
        purger: Callable[[], object],
        logger: logging.Logger,
        intervalle_deplacements: float = INTERVALLE_DEPLACEMENTS_SECONDES,
        intervalle_purge: float = INTERVALLE_PURGE_SECONDES,
    ) -> None:
        self._deplacer = deplacer
        self._purger = purger
        self._logger = logger
        self._intervalle_deplacements = intervalle_deplacements
        self._intervalle_purge = intervalle_purge
        self._arret = threading.Event()
        self._fil: threading.Thread | None = None

    def demarrer(self) -> None:
        self._fil = threading.Thread(target=self._tourner, name="corbeille", daemon=True)
        self._fil.start()

    def arreter(self) -> None:
        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=10)

    def _tourner(self) -> None:
        depuis_purge = self._intervalle_purge  # la première passe purge aussi
        while not self._arret.is_set():
            for etape, appel in (("deplacements", self._deplacer), ("purge", self._purger)):
                if etape == "purge" and depuis_purge < self._intervalle_purge:
                    continue
                try:
                    appel()
                except Exception as erreur:  # une passe en échec n'arrête pas le service ; elle se dit au journal
                    log_event(self._logger, logging.ERROR, "corbeille_passe_echouee", etape=etape,
                              erreur=type(erreur).__name__)
                if etape == "purge":
                    depuis_purge = 0
            self._arret.wait(self._intervalle_deplacements)
            depuis_purge += self._intervalle_deplacements

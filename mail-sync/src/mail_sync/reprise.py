# @spec CRM-143 (docs/BACKLOG.md) — tranche T2 : la reprise des pièces non analysées par l'antivirus
# @spec docs/SPEC-pieces-jointes.md §17.5 (la reprise, son lot, son arrêt au premier silence, son journal), §17.3 (« non
#       analysée ») ; docs/SPEC-mail-subsystem.md §4.3 (révisé), §15.5 (l'antivirus) ; docs/JOURNAL.md décisions 889 et 892 ;
#       CLAUDE.md §18 (aucune simulation de succès)
#
# LA REPRISE N'ÉCRIT QU'UN VERDICT RÉEL. Une pièce que l'antivirus juge saine devient `clean`, et son texte sera extrait
# (le déclencheur de `0141`) ; infectée, elle devient `infected` et reste bloquée. Si l'antivirus ne répond toujours pas, le
# lot s'arrête au premier silence et n'écrit RIEN : la pièce reste non analysée, et le lot suivant réessaiera. Écrire
# `skipped` une seconde fois n'apprendrait rien, et écrire `clean` serait la valeur par défaut trompeuse que `CLAUDE.md`
# §18 interdit.

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from mail_sync import antivirus
from mail_sync.postgrest import PostgrestError
from mail_sync.structured_logging import log_event

#: Un lot : vingt pièces (§17.5).
LOT = 20

#: Une reprise toutes les quinze minutes : l'antivirus revient rarement plus vite qu'un redémarrage de service, et la
#: reprise est un rattrapage, pas un flux.
INTERVALLE_SECONDES = 15 * 60


class SourcePieces(Protocol):
    """Ce que la reprise attend de la base, réduit au strict nécessaire — la décision se prouve sans base."""

    def pieces_a_reprendre(self, limite: int) -> list[dict[str, Any]]: ...

    def lire_piece(self, chemin: str) -> bytes | None: ...

    def enregistrer_verdict(self, attachment_id: str, statut: str) -> None: ...


@dataclass(frozen=True)
class BilanReprise:
    """Ce qu'un lot a fait, tel que le journal et les preuves l'observent."""

    analysees: int = 0
    saines: int = 0
    infectees: int = 0
    #: Restées non analysées : l'antivirus s'est tu, ou l'objet a disparu.
    restees: int = 0
    #: Vrai quand le lot s'est arrêté sur le silence de l'antivirus.
    antivirus_muet: bool = False


def reprendre_lot(
    source: SourcePieces,
    *,
    analyser: Callable[[bytes], antivirus.VerdictAntivirus],
    journal: Callable[..., None] = lambda _evenement, **_details: None,
    limite: int = LOT,
) -> BilanReprise:
    """Reprend un lot de pièces non analysées, et rend ce qu'il a fait.

    `analyser` est injecté : la preuve sans serveur passe un double, le service la fonction réelle sur `clamd`.
    """

    pieces = source.pieces_a_reprendre(limite)
    saines = infectees = restees = analysees = 0
    for rang, piece in enumerate(pieces):
        contenu = source.lire_piece(str(piece["storage_path"]))
        if contenu is None:
            # L'objet a disparu : rien à analyser, la pièce reste non analysée, sans que le lot s'arrête.
            restees += 1
            continue
        verdict = analyser(contenu)
        if verdict.statut == antivirus.SKIPPED:
            # LE PREMIER SILENCE ARRÊTE LE LOT : les suivantes se heurteraient au même antivirus muet. Elles restent
            # toutes non analysées, celle-ci comprise.
            restees += len(pieces) - rang
            return BilanReprise(analysees, saines, infectees, restees, antivirus_muet=True)
        source.enregistrer_verdict(str(piece["id"]), verdict.statut)
        analysees += 1
        if verdict.statut == antivirus.INFECTED:
            infectees += 1
            # L'identifiant de la pièce, jamais son nom ni la signature : le nom est une donnée de la boîte (§4.3).
            journal("reprise_antivirus_infectee", attachment_id=str(piece["id"]))
        else:
            saines += 1
    return BilanReprise(analysees, saines, infectees, restees)


class PiloteReprise:
    """La boucle du §17.5, sur le modèle de `PiloteExtraction` : un `threading.Event`, jamais `time.sleep`.

    Un lot est joué au démarrage, puis toutes les quinze minutes ; un lot revenu plein est suivi d'un autre sans attendre,
    pour que le stock de production s'écoule au rythme de l'antivirus.
    """

    def __init__(
        self,
        *,
        executer: Callable[[], BilanReprise],
        logger: logging.Logger,
        intervalle: float = INTERVALLE_SECONDES,
        limite: int = LOT,
    ) -> None:
        self._executer = executer
        self._logger = logger
        self._intervalle = intervalle
        self._limite = limite
        self._arret = threading.Event()
        self._fil: threading.Thread | None = None

    def demarrer(self) -> None:
        log_event(self._logger, logging.INFO, "reprise_antivirus_demarree", intervalle_secondes=int(self._intervalle))
        self._fil = threading.Thread(target=self._boucler, name="reprise-antivirus", daemon=True)
        self._fil.start()

    def _boucler(self) -> None:
        while not self._arret.is_set():
            plein = False
            try:
                bilan = self._executer()
                plein = bilan.analysees >= self._limite
                if bilan.analysees or bilan.restees:
                    log_event(
                        self._logger,
                        logging.WARNING if bilan.antivirus_muet else logging.INFO,
                        "reprise_antivirus_lot",
                        analysees=bilan.analysees,
                        saines=bilan.saines,
                        infectees=bilan.infectees,
                        restees=bilan.restees,
                    )
            except PostgrestError as erreur:
                log_event(self._logger, logging.WARNING, "reprise_antivirus_echouee", postgrest_status=erreur.status_code)
            except Exception as erreur:  # noqa: BLE001 — la boucle survit à tout : un lot raté se rejoue au suivant
                log_event(self._logger, logging.ERROR, "reprise_antivirus_echouee", panne=type(erreur).__name__)
            if self._arret.wait(0 if plein else self._intervalle):
                return

    def arreter(self, timeout: float = 5.0) -> None:
        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=timeout)
            self._fil = None

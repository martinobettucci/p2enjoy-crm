# @spec CRM-059 (docs/BACKLOG.md) — boucle de veille consommant `MAIL_SYNC_POLL_INTERVAL`
# @spec docs/SPEC-mail-subsystem.md §20.10 (forme de la boucle), §20.10.1 (un fil, pas asyncio),
#       §20.10.2 (la décision est pure), §20.10.3 (un compte en panne n'arrête rien),
#       §20.10.4 (aucun chevauchement), §20.10.5 (zéro désactive), §20.10.6 (quels comptes)
# @spec docs/SPEC-mail-subsystem.md §13.7 (un code, jamais le texte du serveur)
# @spec docs/JOURNAL.md décision 341
#
# CE MODULE SÉPARE CE QUI SE DÉCIDE DE CE QUI ATTEND, et ce n'est pas une préférence de style.
# `CLAUDE.md` §18 proscrit la « temporisation arbitraire » : une preuve qui devrait dormir soixante
# secondes pour observer un second tour en serait une. L'ordre des comptes et l'échéance du prochain
# tour sont donc des fonctions **pures** de l'horloge et de l'état, vérifiables sans dormir ; seul
# `PiloteVeille` dort, et il dort sur un `Event` qu'un arrêt interrompt.

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Iterable, Protocol, Sequence

from mail_sync.structured_logging import log_event


#: Bornes de `MAIL_SYNC_POLL_INTERVAL`, hors le zéro qui désactive (§20.10.5).
#:
#: Elles ne sont pas des réglages de confort. En deçà de cinq secondes, la scrutation devient une
#: charge constante sur Stalwart et PostgREST sans faire arriver le courrier plus vite ; au-delà
#: d'une heure, `last_sync_at` vieillit au point que l'écran d'état du §20.7 ne distingue plus une
#: veille lente d'un service arrêté.
INTERVALLE_MINIMAL_SECONDES = 5
INTERVALLE_MAXIMAL_SECONDES = 3_600

#: Valeur qui désactive la veille. Zéro n'est PAS « aussi vite que possible » : c'est « aucune
#: veille », la relève restant déclenchable par l'API interne comme `CRM-054` l'a livrée.
VEILLE_DESACTIVEE = 0


@dataclass(frozen=True)
class CompteAVeiller:
    """Ce que la veille a besoin de savoir d'un compte, et rien de plus.

    `last_sync_at` est `None` pour un compte jamais relevé — ce n'est pas une absence de donnée à
    corriger, c'est un fait, et le tri du §20.10.6 s'appuie dessus.
    """

    identifiant: str
    #: `None` = jamais relevé.
    derniere_releve: datetime | None
    #: Un compte sans secret ne PEUT pas être relevé : la route `poll` rend déjà `409`.
    secret_present: bool


class SourceComptes(Protocol):
    """Ce que le pilote attend de la base, réduit au strict nécessaire.

    Un `Protocol` plutôt que `PostgrestClient` : la décision se prouve alors sans base, et le module
    ne dépend pas de la couche qui l'alimente.
    """

    def lire_comptes_a_veiller(self) -> Sequence[CompteAVeiller]: ...


def normaliser_intervalle(valeur: int) -> int:
    """Rend l'intervalle réellement appliqué, ou lève si la valeur est inexploitable.

    La borne est appliquée **ici** et non par une contrainte de champ, parce que le zéro fait
    exception aux deux bornes : `Field(ge=5)` refuserait la désactivation, et `ge=0` laisserait
    passer un intervalle d'une seconde. Une seule fonction porte donc les trois cas, et le test
    unitaire les couvre tous.
    """

    if valeur == VEILLE_DESACTIVEE:
        return VEILLE_DESACTIVEE
    if valeur < INTERVALLE_MINIMAL_SECONDES:
        raise ValueError(
            f"must be 0 (disabled) or at least {INTERVALLE_MINIMAL_SECONDES} seconds"
        )
    if valeur > INTERVALLE_MAXIMAL_SECONDES:
        raise ValueError(f"must not exceed {INTERVALLE_MAXIMAL_SECONDES} seconds")
    return valeur


def ordonner_comptes(comptes: Iterable[CompteAVeiller]) -> list[CompteAVeiller]:
    """Le compte le plus en retard passe en tête — §20.10.6.

    Deux règles, et chacune a son motif :

      * **les comptes sans secret sont écartés** — la relève rendrait `409`, et les garder ferait un
        échec par tour et par compte incomplet, c'est-à-dire un journal qui crie sans rien apprendre
        à personne ;
      * **les jamais relevés d'abord**, puis `last_sync_at` croissante. Trier par date de création
        ferait attendre un compte neuf derrière tous les anciens.

    Le tri est **stable** et se départage par l'identifiant à date égale : sans cela, deux comptes
    relevés dans la même seconde changeraient d'ordre d'un tour à l'autre, et un journal comparé
    d'une exécution à l'autre paraîtrait incohérent sans l'être.
    """

    retenus = [compte for compte in comptes if compte.secret_present]
    return sorted(
        retenus,
        key=lambda compte: (
            compte.derniere_releve is not None,
            compte.derniere_releve or datetime.min.replace(tzinfo=timezone.utc),
            compte.identifiant,
        ),
    )


def delai_avant_prochain_tour(duree_du_tour: float, intervalle: int) -> float:
    """Le délai d'attente, qui NE se réduit PAS de la durée du tour — §20.10.4.

    C'est toute la règle, et elle tient en une ligne parce qu'elle est une décision et non un calcul :
    l'intervalle court à partir de la **fin** du tour précédent, jamais de son début.

    L'écriture naturelle — `intervalle - duree` — serait une scrutation « à fréquence fixe », et elle
    a deux défauts qui se manifestent exactement quand le serveur va mal. Un tour plus long que
    l'intervalle rendrait un délai négatif, donc un tour suivant immédiat, donc deux relèves
    simultanées du même compte au moment précis où le serveur est déjà lent. Et une série de tours
    lents produirait une rafale de rattrapage, la charge augmentant à mesure que le serveur ralentit.

    Aucun message ne serait perdu — le dédoublonnage est tenu par la base depuis `CRM-054` — mais la
    charge IMAP doublerait sans rien apporter. Le paramètre `duree_du_tour` est donc reçu et
    **délibérément ignoré** : il est là pour que cette décision soit visible et vérifiable, plutôt
    que tenue par l'absence d'une soustraction que personne ne remarquerait.
    """

    del duree_du_tour
    return float(intervalle)


@dataclass(frozen=True)
class ResultatTour:
    """Ce qu'un tour a fait, tel que le journal et les preuves l'observent."""

    releves: int
    echecs: int
    ignores: int


def executer_un_tour(
    *,
    source: SourceComptes,
    relever: Callable[[CompteAVeiller], None],
    journal: Callable[..., None],
) -> ResultatTour:
    """Relève chaque compte éligible, dans l'ordre, sans qu'un échec n'arrête le tour — §20.10.3.

    L'`except Exception` est large, et c'est **le seul du service à l'être** hors des frontières
    d'API. La solution de rechange — laisser remonter — arrêterait le fil de veille, et un seul
    compte mal configuré priverait de courrier tous les autres.

    CE N'EST PAS LE `try/except` VIDE QUE `CLAUDE.md` §18 PROSCRIT : celui-là ne dit rien, celui-ci
    journalise l'identifiant du compte et le **type** de la panne. Le texte de l'exception n'est
    jamais journalisé — il peut porter un identifiant de connexion ou un mot de passe reflété par un
    serveur bavard (docs/SPEC-mail-subsystem.md §13.7).
    """

    try:
        tous = list(source.lire_comptes_a_veiller())
    except Exception as erreur:  # noqa: BLE001
        # La source elle-même est indisponible : le tour n'a rien fait, et il le dit. Rendre un
        # tour « réussi à zéro compte » ferait passer une base injoignable pour un parc vide.
        journal("veille_source_indisponible", panne=type(erreur).__name__)
        return ResultatTour(releves=0, echecs=1, ignores=0)

    eligibles = ordonner_comptes(tous)
    ignores = len(tous) - len(eligibles)
    releves = 0
    echecs = 0

    for compte in eligibles:
        try:
            relever(compte)
        except Exception as erreur:  # noqa: BLE001
            echecs += 1
            journal(
                "veille_compte_echoue",
                account_id=compte.identifiant,
                panne=type(erreur).__name__,
            )
        else:
            releves += 1

    return ResultatTour(releves=releves, echecs=echecs, ignores=ignores)


class PiloteVeille:
    """Le seul objet de ce module qui attende — §20.10.1.

    Il s'appuie sur un `threading.Event` et non sur `time.sleep` : un arrêt interrompt l'attente au
    lieu de retenir le conteneur jusqu'à la fin de l'intervalle. Un service qui met soixante
    secondes à s'arrêter est un service qu'un orchestrateur finit par tuer.
    """

    def __init__(
        self,
        *,
        intervalle: int,
        source: SourceComptes,
        relever: Callable[[CompteAVeiller], None],
        logger: logging.Logger,
        horloge: Callable[[], float] | None = None,
    ) -> None:
        self._intervalle = normaliser_intervalle(intervalle)
        self._source = source
        self._relever = relever
        self._logger = logger
        # L'horloge est injectable pour que la preuve mesure l'échéance sans dépendre du temps réel.
        self._horloge = horloge or time.monotonic
        self._arret = threading.Event()
        self._fil: threading.Thread | None = None

    @property
    def active(self) -> bool:
        return self._intervalle != VEILLE_DESACTIVEE

    def _journal(self, evenement: str, **details: object) -> None:
        log_event(self._logger, logging.WARNING, evenement, **details)

    def demarrer(self) -> None:
        """Démarre le fil, ou dit explicitement que la veille est désactivée — §20.10.5.

        Le journal de démarrage dit **laquelle des deux** situations est en vigueur : un service dont
        on ne sait pas s'il relève tout seul est un service qu'on interroge en le regardant tourner.
        """

        if not self.active:
            log_event(self._logger, logging.INFO, "veille_desactivee")
            return
        log_event(
            self._logger,
            logging.INFO,
            "veille_demarree",
            intervalle_secondes=self._intervalle,
        )
        # `daemon=True` : un fil de veille ne doit jamais retenir l'arrêt du processus si `arreter`
        # n'a pas été appelé — par exemple lors d'un arrêt brutal de l'orchestrateur.
        self._fil = threading.Thread(target=self._boucler, name="veille", daemon=True)
        self._fil.start()

    def _boucler(self) -> None:
        while not self._arret.is_set():
            debut = self._horloge()
            resultat = executer_un_tour(
                source=self._source,
                relever=self._relever,
                journal=self._journal,
            )
            duree = self._horloge() - debut
            log_event(
                self._logger,
                logging.INFO,
                "veille_tour_termine",
                releves=resultat.releves,
                echecs=resultat.echecs,
                ignores=resultat.ignores,
            )
            # L'attente part d'ICI, donc de la fin du tour (§20.10.4). `Event.wait` rend `True`
            # lorsqu'un arrêt est demandé, et la boucle s'achève sans attendre l'intervalle entier.
            if self._arret.wait(delai_avant_prochain_tour(duree, self._intervalle)):
                return

    def arreter(self, timeout: float = 5.0) -> None:
        """Demande l'arrêt et attend le fil, sans jamais bloquer indéfiniment."""

        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=timeout)
            self._fil = None

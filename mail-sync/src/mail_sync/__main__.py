# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.1, §12.2 et §12.5 — point
# d'entrée unique du conteneur ; la portée couvre le chargement, les logs et l'écoute Uvicorn.
# @spec CRM-059 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §20.10 — démarrage et arrêt de la
#       boucle de veille ; `docs/JOURNAL.md` décision 341.
#
# LA VEILLE EST DÉMARRÉE ICI, ET NON DANS `create_app`, délibérément. `create_app` est construite
# par chaque preuve d'API ; y démarrer un fil ferait tourner une veille dans des dizaines de tests
# qui ne la concernent pas, et une preuve qui échouerait laisserait un fil derrière elle. La veille
# est un service, pas une propriété de l'application HTTP.

from __future__ import annotations

import logging

import uvicorn

from mail_sync.app import create_app
from mail_sync.config import ConfigurationError, load_settings
from mail_sync.postgrest import PostgrestClient
from mail_sync.structured_logging import configure_logging, log_event
from mail_sync.veille import CompteAVeiller, PiloteVeille


# `sysexits.h` : une configuration refusée n'est pas un plantage, c'est un contrat non tenu.
EXIT_CONFIGURATION = 78


def _source_comptes(settings) -> object:
    """Un client PostgREST neuf par tour, pour ne pas garder une connexion ouverte entre deux.

    Le service n'a pas de pool : `PostgrestClient` ouvre une requête HTTP et la referme. Construire
    le client au moment du tour évite de conserver un objet dont l'état survivrait à une panne
    réseau sans que rien ne l'observe.
    """

    class _Source:
        def lire_comptes_a_veiller(self):
            client = PostgrestClient(
                settings.SUPABASE_URL,
                settings.SERVICE_ROLE_KEY.get_secret_value(),
                timeout=30.0,
            )
            return client.lire_comptes_a_veiller()

    return _Source()


def _relever_via_api_interne(settings, logger):
    """Relève un compte en passant par le MÊME chemin que la route interne de `CRM-054`.

    C'est le point important, et il est délibéré : la veille n'invente pas une seconde façon de
    relever un compte. Elle appelle `relever_compte` avec les mêmes arguments que
    `poll_inbound_account`, de sorte qu'un défaut corrigé d'un côté l'est des deux, et qu'aucun
    chemin ne diverge en silence (`CLAUDE.md` §3, « éviter les dépendances circulaires » et
    « préférer les contrats explicites »).
    """

    from mail_sync.ingestion import relever_compte

    def relever(compte_a_veiller: CompteAVeiller) -> None:
        client = PostgrestClient(
            settings.SUPABASE_URL,
            settings.SERVICE_ROLE_KEY.get_secret_value(),
            timeout=60.0,
        )
        compte = client.read_credentials(compte_a_veiller.identifiant)
        if compte is None or compte.password is None:
            # Ni une panne ni un silence : le compte a changé entre la lecture du tour et sa
            # relève. Le tour suivant le reverra, et `ordonner_comptes` l'écartera s'il n'a
            # toujours pas de secret.
            return
        relever_compte(
            journal=lambda evenement, **details: log_event(
                logger, logging.WARNING, evenement, **details
            ),
            client_base=client,
            compte=compte,
            workspace_id=compte.workspace_id,
            dossiers=client.lire_dossiers_surveilles(compte_a_veiller.identifiant),
            clamav_hote=settings.CLAMAV_HOST,
            clamav_port=settings.CLAMAV_PORT,
            taille_max_octets=settings.MAIL_MAX_ATTACHMENT_MB * 1024 * 1024,
            timeout=settings.MAIL_SYNC_IMAP_TIMEOUT_SECONDS,
        )

    return relever


def main() -> int:
    try:
        settings = load_settings()
    except ConfigurationError as error:
        log_event(
            configure_logging("INFO"),
            logging.CRITICAL,
            "configuration_rejected",
            reason=str(error),
        )
        return EXIT_CONFIGURATION

    logger = configure_logging(settings.MAIL_SYNC_LOG_LEVEL)
    application = create_app(settings, logger=logger)

    pilote = PiloteVeille(
        intervalle=settings.MAIL_SYNC_POLL_INTERVAL,
        source=_source_comptes(settings),
        relever=_relever_via_api_interne(settings, logger),
        logger=logger,
    )
    pilote.demarrer()
    try:
        uvicorn.run(
            application,
            host=settings.MAIL_SYNC_HOST,
            port=settings.MAIL_SYNC_PORT,
            access_log=False,
            log_config=None,
            use_colors=False,
        )
    finally:
        # `finally` et non un simple appel après : un `SIGTERM` traité par Uvicorn rend la main par
        # une exception dans certains cas, et un fil de veille laissé derrière retiendrait le
        # processus jusqu'à ce que l'orchestrateur le tue.
        pilote.arreter()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

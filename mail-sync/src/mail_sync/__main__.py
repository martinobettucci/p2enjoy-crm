# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.1, §12.2 et §12.5 — point
# d'entrée unique du conteneur ; la portée couvre le chargement, les logs et l'écoute Uvicorn.

from __future__ import annotations

import logging

import uvicorn

from mail_sync.app import create_app
from mail_sync.config import ConfigurationError, load_settings
from mail_sync.structured_logging import configure_logging, log_event


# `sysexits.h` : une configuration refusée n'est pas un plantage, c'est un contrat non tenu.
EXIT_CONFIGURATION = 78


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
    uvicorn.run(
        application,
        host=settings.MAIL_SYNC_HOST,
        port=settings.MAIL_SYNC_PORT,
        access_log=False,
        log_config=None,
        use_colors=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le point d'entrée du connecteur
# @spec docs/SPEC-mcp.md §10 (configuration refusée si incomplète, variables nommées), §11 (journaux JSON) ;
#       modèle : `evoliz_mcp/__main__.py` (p2enjoy-evoliz, révision 80a3e27)
"""Point d'entrée : ``python -m crm_mcp``."""

from __future__ import annotations

import os
import sys

import uvicorn

from crm_mcp import journalisation
from crm_mcp.reglages import Reglages, ReglagesIncomplets


def main() -> None:
    try:
        reglages = Reglages.depuis_environnement(os.environ)
    except (ReglagesIncomplets, ValueError) as erreur:
        print(erreur, file=sys.stderr)
        sys.exit(2)
    journalisation.configurer(reglages.journal_niveau)

    from crm_mcp.application import application_asgi

    uvicorn.run(
        application_asgi(reglages),
        host="0.0.0.0",
        port=reglages.port,
        # Caddy (et la Forge en production) termine le TLS et fait suivre X-Forwarded-Proto.
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_config=None,
        server_header=False,
    )


if __name__ == "__main__":
    main()

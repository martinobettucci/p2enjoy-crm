# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : les journaux JSON du connecteur
# @spec docs/SPEC-mcp.md §11 (une ligne par événement ; jamais de jeton, de code, d'adresse ni d'argument d'outil)
# @spec Repris du connecteur Evoliz (p2enjoy-evoliz, `evoliz_mcp/journalisation.py`, révision 80a3e27), sans écart.
"""Journaux JSON, une ligne par événement, sur la sortie standard.

Les champs passés par ``extra=`` deviennent des clés de la ligne. Rien de ce qui
passe ici ne doit contenir de secret : les appelants ne journalisent ni clé, ni
jeton, ni argument d'outil.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

_CHAMPS_STANDARD = set(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"message", "asctime", "taskName", "color_message"}  # color_message : doublon ANSI d'uvicorn


class FormatJSON(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ligne = {
            "horodatage": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "niveau": record.levelname.lower(),
            "source": record.name,
            "evenement": record.getMessage(),
        }
        for cle, valeur in record.__dict__.items():
            if cle not in _CHAMPS_STANDARD and not cle.startswith("_"):
                ligne[cle] = valeur
        if record.exc_info:
            ligne["exception"] = self.formatException(record.exc_info)
        return json.dumps(ligne, ensure_ascii=False, default=str)


def configurer(niveau: str) -> None:
    gestionnaire = logging.StreamHandler(sys.stdout)
    gestionnaire.setFormatter(FormatJSON())
    racine = logging.getLogger()
    racine.handlers[:] = [gestionnaire]
    racine.setLevel(niveau.upper())
    # Les bibliothèques bavardes restent au niveau avertissement : leurs traces
    # de requêtes pourraient porter des en-têtes.
    for bavard in ("httpx2", "httpcore2", "httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(bavard).setLevel(logging.WARNING)
    # FastMCP écrit par défaut sur la sortie d'erreur, au format Rich : ses
    # événements (refus de consentement, liaison de navigateur manquante…)
    # rejoignent le journal JSON. Jamais en dessous d'info : à debug, FastMCP
    # écrit les arguments des outils.
    fastmcp = logging.getLogger("fastmcp")
    fastmcp.handlers[:] = []
    fastmcp.propagate = True
    fastmcp.setLevel(max(logging.INFO, racine.level))

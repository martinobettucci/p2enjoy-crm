# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : l'audit des appels d'outils et la garde de taille
# @spec docs/SPEC-mcp.md §7.1 (`mcp_journal` : sujet, outil, espace, issue, durée — jamais un argument), §9.3 (garde de
#       taille), §11 (une ligne par appel, à la sortie standard ET au journal ; jamais un jeton ni une adresse)
# @spec Repris du connecteur Evoliz (p2enjoy-evoliz, `evoliz_mcp/audit.py`, révision 80a3e27). Écarts : la ligne part
#       aussi au registre, l'issue suit la liste fermée du `check` de `mcp_journal`, l'adresse n'est pas journalisée.
"""Audit nominatif des appels d'outils et garde de taille des réponses.

La garde refuse une réponse trop longue pour le contexte d'un modèle, en disant sa taille et comment la réduire, plutôt
que de la tronquer : un JSON coupé est un JSON faux.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastmcp.exceptions import NotFoundError, ToolError
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.tools.base import ToolResult

from crm_mcp.crm import CrmIndisponible
from crm_mcp.politique import APPEL, Appel
from crm_mcp.registre import Registre

journal = logging.getLogger("crm_mcp.audit")


def taille(resultat: Any) -> int:
    """Taille de ce que le modèle reçoit : le JSON structuré s'il existe, sinon le texte — jamais les deux additionnés."""
    if isinstance(resultat, ToolResult):
        if resultat.structured_content is not None:
            return len(json.dumps(resultat.structured_content, ensure_ascii=False, default=str))
        return sum(
            len(texte) for bloc in resultat.content or [] if isinstance(texte := getattr(bloc, "text", None), str)
        )
    return len(json.dumps(resultat, ensure_ascii=False, default=str))


class AuditOutils(Middleware):
    def __init__(self, registre: Registre, taille_max: int) -> None:
        self.registre = registre
        self.taille_max = taille_max

    async def _inscrire(self, appel: Appel, nom: str, issue: str, debut: float, **extra: Any) -> None:
        duree_ms = round((time.perf_counter() - debut) * 1000)
        journal.info(
            "outil",
            extra={"sujet": appel.sujet, "outil": nom, "espace": appel.espace, "issue": issue, "duree_ms": duree_ms, **extra},
        )
        if appel.sujet is None:
            # Sans identité vérifiée, rien ne s'inscrit au registre : `mcp_journal.sub` n'est jamais deviné.
            return
        try:
            await self.registre.journaliser(appel.sujet, nom, appel.espace, issue, duree_ms)
        except CrmIndisponible:
            # La sortie standard garde la trace ; l'appel lui-même n'échoue pas pour un journal injoignable.
            journal.warning("journal_indisponible", extra={"outil": nom})

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        nom = str(getattr(context.message, "name", None))
        debut = time.perf_counter()
        appel = Appel()
        jeton_pose = APPEL.set(appel)
        try:
            try:
                resultat = await call_next(context)
            except NotFoundError:
                # Un outil inconnu ou fermé pour ce compte n'a pas de ligne : il n'existe pas pour lui.
                raise
            except Exception as erreur:
                await self._inscrire(appel, nom, getattr(erreur, "issue_audit", None) or "erreur", debut)
                raise
            mesure = taille(resultat)
            if mesure > self.taille_max:
                await self._inscrire(appel, nom, "trop_volumineux", debut, taille=mesure)
                raise ToolError(
                    f"Réponse trop volumineuse : {mesure} caractères, au-delà de la limite de {self.taille_max}. "
                    "Réduisez-la : limit plus petit et offset suivant, ou filtres plus précis."
                )
            await self._inscrire(appel, nom, "ok", debut, taille=mesure)
            return resultat
        finally:
            APPEL.reset(jeton_pose)

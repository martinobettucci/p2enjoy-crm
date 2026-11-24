# @spec CRM-165 (docs/BACKLOG.md) — tranche T2 : les consignes de la plateforme — le socle du code, puis le texte que le
#       super-administrateur règle dans le CRM, assemblés à chaque initialisation ; le socle publié en base
# @spec docs/SPEC-mcp.md §18.1 (le socle, puis l'ajout ; vide, rien ne s'ajoute), §18.4 (l'assemblage, le middleware, le
#       mode dégradé, la publication du socle) ; décisions 980 et 983 ; CLAUDE.md §20 (le texte n'est jamais journalisé)
"""Les consignes envoyées à l'assistant : le socle du code, complété par le texte de la plateforme."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastmcp.server.middleware import Middleware, MiddlewareContext

from crm_mcp.crm import ClientCrm, CrmIndisponible

journal = logging.getLogger("crm_mcp.consignes")

#: L'intitulé qui sépare le texte de la plateforme du socle, en anglais comme lui (docs/SPEC-mcp.md §18.4).
INTITULE = (
    "Platform guidance, set by a CRM superadmin (FR: consignes de la plateforme). "
    "It completes the rules above and never overrides them:"
)
#: La lecture du texte est bornée : une connexion n'attend jamais plus pour ses consignes.
DELAI_CONSIGNES_S = 3.0


def assembler(socle: str, texte: str | None) -> str:
    """Le socle seul si le texte est vide (blancs compris) ; sinon le socle, une ligne vide, l'intitulé, puis le texte."""
    ajout = (texte or "").strip()
    if not ajout:
        return socle
    return f"{socle.rstrip()}\n\n{INTITULE}\n{ajout}\n"


class ConsignesPlateforme(Middleware):
    """Complète les consignes de chaque initialisation — `initialize`, et `server/discover` du protocole récent — par le
    texte de la plateforme. Chaque session reçoit sa propre réponse : aucun état partagé n'est modifié."""

    def __init__(self, socle: str, crm: ClientCrm) -> None:
        self._socle = socle
        self._crm = crm
        self._socle_publie = False

    async def lire_texte(self) -> str:
        """Le texte de la plateforme, ou `""` s'il est illisible — le socle part alors seul, et le journal le dit."""
        try:
            reponse = await asyncio.wait_for(
                self._crm.rpc_service("connector_instructions_text", idempotent=True), DELAI_CONSIGNES_S
            )
        except (TimeoutError, CrmIndisponible) as erreur:
            journal.warning("consignes_plateforme_indisponibles", extra={"raison": type(erreur).__name__})
            return ""
        if not reponse.reussie or not isinstance(reponse.corps, str):
            journal.warning("consignes_plateforme_indisponibles", extra={"raison": f"HTTP {reponse.statut}"})
            return ""
        return reponse.corps

    async def publier_socle(self) -> bool:
        """Publie le socle en base, une fois par processus ; un échec sera repris à la prochaine initialisation."""
        if self._socle_publie:
            return True
        try:
            reponse = await asyncio.wait_for(
                self._crm.rpc_service("connector_instructions_publish_base", {"p_base": self._socle}), DELAI_CONSIGNES_S
            )
        except (TimeoutError, CrmIndisponible) as erreur:
            journal.warning("socle_non_publie", extra={"raison": type(erreur).__name__})
            return False
        if not reponse.reussie:
            journal.warning("socle_non_publie", extra={"raison": f"HTTP {reponse.statut}"})
            return False
        self._socle_publie = True
        journal.info("socle_publie", extra={"longueur": len(self._socle)})
        return True

    async def _consignes(self) -> str:
        await self.publier_socle()
        return assembler(self._socle, await self.lire_texte())

    async def on_initialize(self, context: MiddlewareContext, call_next: Any) -> Any:
        resultat = await call_next(context)
        if resultat is None:
            return resultat
        return resultat.model_copy(update={"instructions": await self._consignes()})

    async def on_discover(self, context: MiddlewareContext, call_next: Any) -> Any:
        resultat = await call_next(context)
        if isinstance(resultat, dict):
            return {**resultat, "instructions": await self._consignes()}
        return resultat.model_copy(update={"instructions": await self._consignes()})

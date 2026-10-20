# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : la garde d'entrée du connecteur
# @spec docs/SPEC-mcp.md §3.5 (corps bornés, débit des points OAuth, enregistrements, purge)
# @spec Repris du connecteur Evoliz (p2enjoy-evoliz, `evoliz_mcp/garde.py`, révision 80a3e27). Écarts : corps MCP borné à
#       1 Mio (aucun outil n'accepte de fichier, docs/SPEC-mcp.md §3.5) ; aucun point d'administration — elle vit dans la
#       webapp du CRM (arbitrage A3).
"""Garde d'entrée : taille des corps, débit des points OAuth, purge de l'état.

Les points du serveur d'autorisation (enregistrement, autorisation,
consentement, jeton, retour du SSO) sont publics par construction : un client
MCP doit pouvoir s'y présenter sans compte. Sans garde, un anonyme pourrait :

- envoyer un corps géant que le serveur lit en entier (mémoire du conteneur) ;
- enregistrer des clients ou ouvrir des transactions sans fin (disque de la
  cellule, partagé avec le système) ;
- laisser s'accumuler des entrées expirées, que le magasin de fichiers ne
  supprime qu'à la purge.

La garde borne les corps (petits partout, un peu plus larges sur ``/mcp``), limite le débit des points OAuth par adresse et
l'enregistrement de clients au total, et purge l'état expiré toutes les heures.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable

from mcp.server.transport_security import RequestBodyLimitMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

journal = logging.getLogger("crm_mcp.garde")

#: Corps des points OAuth et des pages : un formulaire ou un JSON de quelques Ko.
TAILLE_CORPS_OAUTH = 64 * 1024
#: Corps MCP : un appel d'outil, sans pièce jointe.
TAILLE_CORPS_MCP = 1024 * 1024

#: Points du serveur d'autorisation soumis au débit par adresse.
POINTS_OAUTH = (
    "/register",
    "/authorize",
    "/consent",
    "/token",
    "/auth/callback",
    "/revoke",
)
DEBIT_OAUTH_PAR_MINUTE = 60
#: Enregistrements de clients : par adresse et par heure, puis au total par heure.
ENREGISTREMENTS_PAR_ADRESSE_HEURE = 20
ENREGISTREMENTS_TOTAL_HEURE = 200
#: Purge de l'état expiré.
INTERVALLE_PURGE_S = 3600
#: Au-delà, les adresses les plus anciennes sont oubliées (mémoire bornée).
ADRESSES_SUIVIES_MAX = 10_000


class _Fenetre:
    """Compteurs à fenêtre glissante, par clé."""

    def __init__(self, limite: int, duree_s: float) -> None:
        self.limite, self.duree = limite, duree_s
        self._instants: dict[str, deque[float]] = {}

    def accepter(self, cle: str, maintenant: float) -> bool:
        file = self._instants.get(cle)
        if file is None:
            if len(self._instants) >= ADRESSES_SUIVIES_MAX:
                self._instants.pop(next(iter(self._instants)))
            file = self._instants[cle] = deque()
        while file and file[0] <= maintenant - self.duree:
            file.popleft()
        if len(file) >= self.limite:
            return False
        file.append(maintenant)
        return True


class GardeEntree:
    """Middleware ASGI placé devant toute l'application."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        purger: Callable[[], Awaitable[None]] | None = None,
        horloge: Callable[[], float] = time.monotonic,
        debit_par_minute: int = DEBIT_OAUTH_PAR_MINUTE,
        enregistrements_par_heure: int = ENREGISTREMENTS_PAR_ADRESSE_HEURE,
    ) -> None:
        self._oauth = RequestBodyLimitMiddleware(app, TAILLE_CORPS_OAUTH)
        self._mcp = RequestBodyLimitMiddleware(app, TAILLE_CORPS_MCP)
        self._purger = purger
        self._horloge = horloge
        self._derniere_purge = horloge()
        self._purge_en_cours: asyncio.Task | None = None
        # Les limites de production sont les défauts ; la pile de développement, où
        # toute une campagne de tests vient d'une seule adresse, les relève (docs/SPEC-mcp.md §10).
        self._debit = _Fenetre(debit_par_minute, 60)
        self._enregistrements_adresse = _Fenetre(enregistrements_par_heure, 3600)
        self._enregistrements_total = _Fenetre(
            max(ENREGISTREMENTS_TOTAL_HEURE, enregistrements_par_heure * 10), 3600
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._oauth(scope, receive, send)
            return
        chemin = scope.get("path", "")
        maintenant = self._horloge()
        self._planifier_purge(maintenant)

        if chemin in POINTS_OAUTH:
            client = scope.get("client")
            adresse = client[0] if client else "inconnue"
            refus = None
            if not self._debit.accepter(adresse, maintenant):
                refus = 60
            elif chemin == "/register" and scope.get("method") == "POST":
                if not self._enregistrements_adresse.accepter(adresse, maintenant):
                    refus = 3600
                elif not self._enregistrements_total.accepter("*", maintenant):
                    refus = 3600
            if refus is not None:
                journal.warning("debit_oauth_depasse", extra={"chemin": chemin, "adresse": adresse})
                reponse = JSONResponse(
                    {"error": "slow_down", "error_description": "Trop de requêtes : réessayez plus tard."},
                    status_code=429,
                    headers={"Retry-After": str(refus)},
                )
                await reponse(scope, receive, send)
                return

        cible = self._mcp if chemin == "/mcp" or chemin.startswith("/mcp/") else self._oauth
        await cible(scope, receive, send)

    def _planifier_purge(self, maintenant: float) -> None:
        if self._purger is None or maintenant - self._derniere_purge < INTERVALLE_PURGE_S:
            return
        if self._purge_en_cours is not None and not self._purge_en_cours.done():
            return
        self._derniere_purge = maintenant
        self._purge_en_cours = asyncio.ensure_future(self._purge())

    async def _purge(self) -> None:
        try:
            await self._purger()  # type: ignore[misc]
            journal.info("etat_purge")
        except Exception:  # la purge ne doit jamais faire tomber une requête
            journal.exception("etat_purge_echec")

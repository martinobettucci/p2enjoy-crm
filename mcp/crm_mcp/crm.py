# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le client du CRM, sous le jeton de la personne ou la clé de service
# @spec CRM-108 (docs/BACKLOG.md) — tranche T4 : `ecrire`, la première écriture de table du connecteur (docs/SPEC-mcp.md
#       §9.1 : les mêmes tables que la webapp ; docs/SPEC-recettes.md §7)
# @spec docs/SPEC-mcp.md §5 (toute donnée sous le jeton interne ; la clé de service pour le seul registre), §9.3
#       (traduction des refus), §11 (aucun jeton journalisé) ; CLAUDE.md §19 (délai, erreurs, aucun secret dans les traces)
"""Appels HTTP vers PostgREST, par Kong, sur le réseau Compose.

Deux identités, jamais mélangées : le jeton interne de la personne pour toute donnée métier — la RLS s'applique —, et la
clé de service pour les seules fonctions du registre, réservées à `service_role`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx2

journal = logging.getLogger("crm_mcp.crm")

DELAI_S = 10.0
#: Une reprise, une seule, après une erreur de TRANSPORT, et pour un appel IDEMPOTENT seulement : une écriture
#: n'est jamais rejouée, elle a peut-être abouti.
TENTATIVES_IDEMPOTENTES = 2


class CrmIndisponible(Exception):
    """Le CRM n'a pas répondu dans le délai, ou la connexion a échoué."""


@dataclass(frozen=True)
class Reponse:
    statut: int
    corps: Any

    @property
    def reussie(self) -> bool:
        return 200 <= self.statut < 300

    @property
    def message(self) -> str | None:
        """Le message que PostgREST rend pour un refus — le code levé par une fonction, ou le texte de l'erreur."""
        return self.corps.get("message") if isinstance(self.corps, dict) else None


class ClientCrm:
    def __init__(self, api: str, cle_anonyme: str, cle_service: str, transport: httpx2.AsyncBaseTransport | None = None) -> None:
        self._cle_anonyme = cle_anonyme
        self._cle_service = cle_service
        self.http = httpx2.AsyncClient(base_url=f"{api}/rest/v1", timeout=DELAI_S, transport=transport)

    async def fermer(self) -> None:
        await self.http.aclose()

    def _entetes(self, jeton: str | None) -> dict[str, str]:
        if jeton is None:
            return {"apikey": self._cle_service, "Authorization": f"Bearer {self._cle_service}"}
        return {"apikey": self._cle_anonyme, "Authorization": f"Bearer {jeton}"}

    async def _envoyer(
        self,
        methode: str,
        chemin: str,
        jeton: str | None,
        *,
        idempotent: bool = False,
        entetes: dict[str, str] | None = None,
        **options: Any,
    ) -> Reponse:
        tentatives = TENTATIVES_IDEMPOTENTES if idempotent else 1
        for tentative in range(1, tentatives + 1):
            try:
                reponse = await self.http.request(
                    methode, chemin, headers={**self._entetes(jeton), **(entetes or {})}, **options
                )
                break
            except httpx2.HTTPError as erreur:
                # Le type seul : un message de transport peut porter une adresse interne.
                journal.warning(
                    "crm_injoignable", extra={"chemin": chemin, "erreur": type(erreur).__name__, "tentative": tentative}
                )
                if tentative == tentatives:
                    raise CrmIndisponible() from erreur
        texte = reponse.text
        try:
            corps = reponse.json() if texte else None
        except ValueError:
            corps = texte
        return Reponse(reponse.status_code, corps)

    async def rpc(
        self, jeton: str, fonction: str, arguments: dict[str, Any] | None = None, *, idempotent: bool = False
    ) -> Reponse:
        """Une RPC sous le jeton interne de la personne : la base l'évalue comme pour la webapp. `idempotent` ne se
        déclare que pour une fonction qui n'écrit rien."""
        return await self._envoyer("POST", f"/rpc/{fonction}", jeton, idempotent=idempotent, json=arguments or {})

    async def lire(self, jeton: str, table: str, parametres: dict[str, str]) -> Reponse:
        """Une lecture PostgREST sous le jeton interne de la personne : la RLS rend ce qu'elle consent."""
        return await self._envoyer("GET", f"/{table}", jeton, idempotent=True, params=parametres)

    async def ecrire(
        self,
        jeton: str,
        methode: str,
        table: str,
        *,
        parametres: dict[str, str] | None = None,
        corps: dict[str, Any] | None = None,
    ) -> Reponse:
        """Une écriture PostgREST sous le jeton de la personne — `POST`, `PATCH` ou `DELETE` —, qui rend les lignes
        touchées (`return=representation`) : zéro ligne est le refus silencieux d'une clause `USING`, jamais un succès.
        Jamais rejouée : une écriture n'est pas idempotente."""
        if methode not in ("POST", "PATCH", "DELETE"):
            raise ValueError(f"méthode d'écriture inconnue {methode!r}")
        options: dict[str, Any] = {"params": parametres or {}}
        if corps is not None:
            options["json"] = corps
        return await self._envoyer(
            methode, f"/{table}", jeton, entetes={"Prefer": "return=representation"}, **options
        )

    async def rpc_service(
        self, fonction: str, arguments: dict[str, Any] | None = None, *, idempotent: bool = False
    ) -> Reponse:
        """Une RPC du REGISTRE, sous la clé de service. Jamais une donnée métier (docs/SPEC-mcp.md §5)."""
        return await self._envoyer("POST", f"/rpc/{fonction}", None, idempotent=idempotent, json=arguments or {})

    async def sonder(self) -> int:
        """Le statut de `rest` à travers Kong, sous la clé anonyme, pour `/pret` (docs/SPEC-mcp.md §11).

        Le point sondé est celui de `scripts/spark/verifier.sh` : le catalogue des nœuds, lisible par la clé anonyme.
        La racine `/rest/v1/` ne convient pas — Kong la refuse en `403` à cette clé, mesuré contre la pile de
        développement."""
        reponse = await self._envoyer(
            "GET", "/workflow_nodes_catalog", self._cle_anonyme, idempotent=True, params={"limit": "0"}
        )
        return reponse.statut

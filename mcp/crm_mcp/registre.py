# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le registre du connecteur, côté service
# @spec docs/SPEC-mcp.md §7.2 (inscription et amorçage), §7.3 (RPC réservées au service : état d'un compte, journal) ;
#       docs/SCHEMA.md §9 quinquies
"""Le registre vit en PostgreSQL (`mcp_comptes`, `mcp_droits`, `mcp_journal`), fermé à l'API : le service y accède
par trois fonctions réservées à la clé de service. Il n'y garde rien lui-même."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from crm_mcp.crm import ClientCrm
from crm_mcp.jeton_interne import Identite

journal = logging.getLogger("crm_mcp.registre")

#: Une case de la matrice : espace, famille, action.
Case = tuple[str, str, str]


class RegistreIndisponible(Exception):
    """Le registre a refusé ou n'a pas répondu : l'accès est refusé, jamais accordé par défaut."""


@dataclass(frozen=True)
class EtatCompte:
    superadmin: bool
    droits: frozenset[Case]

    @property
    def peut_entrer(self) -> bool:
        """Un superadministrateur, ou au moins un droit : sinon, « Droits en attente » (docs/SPEC-mcp.md §4)."""
        return self.superadmin or bool(self.droits)

    def ouvre(self, famille: str, action: str, aussi: tuple[tuple[str, str], ...] = ()) -> bool:
        """VISIBILITÉ d'un outil : au moins un espace ouvre la famille et l'action, et ses cases `aussi`
        (docs/SPEC-mcp.md §6.2, point 1). Le contrôle de l'appel, lui, se fait espace par espace."""
        if self.superadmin:
            return True
        espaces = {espace for espace, f, a in self.droits if (f, a) == (famille, action)}
        return any(all((espace, f, a) in self.droits for f, a in aussi) for espace in espaces)


class Registre:
    def __init__(self, crm: ClientCrm, superadmins_initiaux: tuple[str, ...]) -> None:
        self.crm = crm
        self.superadmins_initiaux = superadmins_initiaux

    async def inscrire(self, identite: Identite) -> EtatCompte:
        """Inscrit le compte ou relève son adresse et son nom, applique l'amorçage, puis rend son état."""
        reponse = await self.crm.rpc_service(
            "mcp_inscrire_compte",
            {
                "p_sub": identite.sujet,
                "p_email": identite.courriel,
                "p_nom": identite.nom,
                "p_superadmins_initiaux": list(self.superadmins_initiaux),
                "p_admin_lelabs": identite.admin_lelabs,
            },
        )
        if not reponse.reussie:
            raise RegistreIndisponible(reponse.message or str(reponse.statut))
        return await self.etat(identite)

    async def etat(self, identite: Identite) -> EtatCompte:
        """Le drapeau et la matrice d'un compte, relus à chaque `tools/list` et à chaque appel."""
        reponse = await self.crm.rpc_service(
            "mcp_etat_compte", {"p_sub": identite.sujet, "p_admin_lelabs": identite.admin_lelabs}, idempotent=True
        )
        if not reponse.reussie or not isinstance(reponse.corps, dict):
            raise RegistreIndisponible(reponse.message or str(reponse.statut))
        cases = frozenset(
            (str(c["workspace_id"]), str(c["famille"]), str(c["action"]))
            for c in reponse.corps.get("droits") or []
            if isinstance(c, dict)
        )
        return EtatCompte(superadmin=reponse.corps.get("superadmin") is True, droits=cases)

    async def journaliser(self, sujet: str, outil: str, espace: str | None, issue: str, duree_ms: int) -> None:
        """Une ligne au journal des appels ; jamais d'argument ni de contenu (docs/SPEC-mcp.md §7.1)."""
        reponse = await self.crm.rpc_service(
            "mcp_journaliser",
            {"p_sub": sujet, "p_outil": outil, "p_ws": espace, "p_issue": issue, "p_duree_ms": duree_ms},
        )
        if not reponse.reussie:
            # La ligne de la sortie standard reste la trace ; le refus est dit, jamais tu.
            journal.warning("journal_refuse", extra={"outil": outil, "statut": reponse.statut})

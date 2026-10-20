# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : l'assemblage du connecteur
# @spec docs/SPEC-mcp.md §2 (un service, un hôte, `/mcp`), §3 (mandataire OAuth, état chiffré), §6.2 (audit puis
#       politique, avant l'outil), §11 (`/sante`, `/pret`) ; docs/JOURNAL.md décision 627 (D1, D5, D8)
# @spec Modèle : `evoliz_mcp/application.py` (p2enjoy-evoliz, révision 80a3e27). Écarts : aucune administration
#       (arbitrage A3), registre en PostgreSQL, sonde `/pret` sur `rest` à travers Kong.
"""Assemblage : mandataire OAuth, outils, audit, politique, pages et sondes."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import fastmcp
import httpx2
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from crm_mcp import pages
from crm_mcp.audit import AuditOutils
from crm_mcp.autorisation import MandataireLelabs, construire_stockage
from crm_mcp.crm import ClientCrm, CrmIndisponible
from crm_mcp.garde import GardeEntree
from crm_mcp.outils import reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre
from crm_mcp.reglages import Reglages

journal = logging.getLogger("crm_mcp.application")

#: Consignes transmises au modèle à l'initialisation de la session MCP.
INSTRUCTIONS = """\
P2Enjoy CRM, operated by verified lelabs SSO users. Every action runs under YOUR identity in the CRM:
you see and change exactly what you could in the CRM web app, never more.
- A superadmin grants this connector rights per workspace (FR: espace), by family (structure, affaires,
  contacts, budgets, temps, objectifs, messagerie) and action (consulter, ajouter, modifier, supprimer).
  The tools offered depend on those rights; a right changed during the conversation reaches the tool list
  at the next connection.
- Start with crm_workspace_list: it returns the workspaces open to you and the slug to pass as `workspace`.
- Outside your rights or the CRM's, a call is refused with "Introuvable ou hors de votre périmètre"
  (FR: not found or outside your perimeter), whether the object exists or not.
- Lists are paginated: use limit (max 100) and offset.
- Nothing is ever purged through this connector: "supprimer" moves to the trash or archives.
"""


@dataclass
class Serveur:
    mcp: FastMCP
    crm: ClientCrm
    moteur: MoteurPolitique
    purger: object  # coroutine sans argument : purge de l'état OAuth expiré


async def disponibilite(decouverte: str, crm: ClientCrm) -> tuple[bool, dict[str, str]]:
    """`/pret` : la découverte OIDC et `rest` à travers Kong ; le contrôle en défaut est nommé (§11)."""
    controles: dict[str, str] = {}
    try:
        async with httpx2.AsyncClient(timeout=5.0) as http:
            reponse = await http.get(decouverte)
        controles["sso"] = "ok" if reponse.status_code == 200 else f"HTTP {reponse.status_code}"
    except httpx2.HTTPError as erreur:
        controles["sso"] = f"injoignable ({type(erreur).__name__})"
    try:
        statut = await crm.sonder()
        controles["crm"] = "ok" if statut == 200 else f"HTTP {statut}"
    except CrmIndisponible:
        controles["crm"] = "injoignable"
    return all(v == "ok" for v in controles.values()), controles


def construire(reglages: Reglages, *, transport_crm: httpx2.AsyncBaseTransport | None = None) -> Serveur:
    """Le serveur MCP complet. ``transport_crm`` sert aux tests."""
    # L'état chiffré du mandataire vit sous ce répertoire (volume `mcp-etat`, décision 627 D8).
    reglages.chemin_etat.mkdir(parents=True, exist_ok=True)
    fastmcp.settings.home = reglages.chemin_etat
    stockage = construire_stockage(reglages.chemin_etat, reglages.oidc_client_secret)
    crm = ClientCrm(reglages.api_crm, reglages.cle_anonyme, reglages.cle_service, transport=transport_crm)
    registre = Registre(crm, reglages.superadmins_initiaux)
    mandataire = MandataireLelabs(
        decouverte=reglages.decouverte,
        client_id=reglages.oidc_client_id,
        client_secret=reglages.oidc_client_secret,
        origine=reglages.origine_publique,
        redirections_clients=list(reglages.redirections_clients),
        registre=registre,
        stockage=stockage.chiffre,
    )
    serveur = FastMCP(name="P2Enjoy CRM", instructions=INSTRUCTIONS, auth=mandataire)
    moteur = MoteurPolitique(registre=registre, crm=crm, jwt_secret=reglages.jwt_secret)
    reference.ajouter(serveur, moteur, crm)
    # L'ordre compte : l'audit enveloppe la politique, qui précède l'outil (docs/SPEC-mcp.md §6.2).
    serveur.add_middleware(AuditOutils(registre, reglages.taille_max_reponse))
    serveur.add_middleware(PolitiqueOutils(moteur))

    @serveur.custom_route("/", methods=["GET"])
    async def accueil(_: Request) -> HTMLResponse:
        return HTMLResponse(pages.accueil(reglages.url_mcp))

    @serveur.custom_route("/sante", methods=["GET"])
    async def sante(_: Request) -> JSONResponse:
        return JSONResponse({"statut": "ok"})

    @serveur.custom_route("/pret", methods=["GET"])
    async def pret(_: Request) -> JSONResponse:
        ok, controles = await disponibilite(reglages.decouverte, crm)
        return JSONResponse({"pret": ok, "controles": controles}, status_code=200 if ok else 503)

    async def purger() -> None:
        await stockage.arbre.cull()

    return Serveur(mcp=serveur, crm=crm, moteur=moteur, purger=purger)


def application_asgi(reglages: Reglages, **options) -> GardeEntree:
    serveur = construire(reglages, **options)
    return GardeEntree(
        serveur.mcp.http_app(path="/mcp"),
        purger=serveur.purger,
        debit_par_minute=reglages.debit_oauth_minute,
        enregistrements_par_heure=reglages.enregistrements_heure,
    )

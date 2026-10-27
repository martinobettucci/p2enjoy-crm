# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : l'assemblage du connecteur
# @spec CRM-102 tranche T3 — docs/DESIGN_SYSTEM.md §5.57 (l’icône du serveur, monogramme du CRM, sur la page de consentement)
# @spec CRM-102 tranche T6 — docs/SPEC-mcp.md §2.2 (`/plateforme` et `/admin` mènent à l'administration de la webapp)
# @spec CRM-108 (docs/BACKLOG.md) tranche T4 — la famille `recettes` enregistrée et nommée au modèle (docs/SPEC-recettes.md §7)
# @spec CRM-104 (docs/BACKLOG.md) tranches T4 à T6 — les familles `budgets`, `temps` et `objectifs` enregistrées
#       (docs/SPEC-mcp.md §9.2 septies à nonies)
# @spec CRM-104 (docs/BACKLOG.md) tranche T7 — la famille `messagerie` enregistrée, sa consigne au modèle
#       (docs/SPEC-mcp.md §9.2 decies, décision 684)
# @spec CRM-114 (docs/BACKLOG.md) tranche T4 — la famille `organizations` enregistrée et nommée au modèle
#       (docs/SPEC-mcp.md §9.2 sexies)
# @spec CRM-104 (docs/BACKLOG.md) tranches T2.a, T2.b, T1 et T3 — les affaires, la structure, la recherche et les contacts
#       enregistrés et nommés au modèle (docs/SPEC-mcp.md §9.2 bis à quinquies)
# @spec CRM-118 (docs/BACKLOG.md) tranches T2.a à T2.d — la famille `workflows` enregistrée, sa ligne dans les consignes au
#       modèle (docs/SPEC-mcp.md §9.2 undecies)
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
from mcp_types import Icon
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

from crm_mcp import pages
from crm_mcp.audit import AuditOutils
from crm_mcp.autorisation import MandataireLelabs, construire_stockage
from crm_mcp.crm import ClientCrm, CrmIndisponible
from crm_mcp.garde import GardeEntree
from crm_mcp.outils import (
    affaires,
    affaires_ecriture,
    budgets,
    contacts,
    messagerie,
    objectifs,
    organisations,
    recettes,
    reference,
    structure,
    temps,
    workflows,
    workflows_formulaire,
    workflows_noeuds,
    workflows_versions,
)
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre
from crm_mcp.reglages import Reglages

journal = logging.getLogger("crm_mcp.application")

#: Consignes transmises au modèle à l'initialisation de la session MCP.
INSTRUCTIONS = """\
P2Enjoy CRM, operated by verified lelabs SSO users. Every action runs under YOUR identity in the CRM:
you see and change exactly what you could in the CRM web app, never more.
- A superadmin grants this connector rights per workspace (FR: espace), by family (structure, workflows,
  affaires, contacts, organizations, budgets, recettes, temps, objectifs, messagerie) and action (consulter, ajouter, modifier, supprimer).
  The tools offered depend on those rights; a right changed during the conversation reaches the tool list
  at the next connection.
- Start with crm_workspace_list: it returns the workspaces open to you and the slug to pass as `workspace`.
- Affaires (cards): start with crm_card_list or crm_card_mine; crm_card_get gives the header, contacts and form
  answers; crm_card_timeline the history. Read crm_workflow_get before crm_card_move.
- Workflows: read one with crm_workflow_get before changing it and tell the person what will change. Only declared
  moves let an affaire change step.
- crm_search finds affaires, contacts, organisations, comments and messages by words.
- Costs: crm_card_cost_list for an affaire, crm_budget_list then crm_budget_get for a budget; a cost line needs a
  budget (and an occurrence when the budget is recurrent). Amounts are never added across currencies.
- Time: crm_time_entry_set sets one cell of the time grid (a person, a day, one target); 0 clears it.
- Goals: crm_goal_board_get reads a goal board as text; a block's progress (fill_percent) is entered, never computed.
- Email: read crm_card_mail_list (then crm_mail_get) before replying. crm_mail_send is irreversible: confirm the
  recipients, subject and text with the person before sending.
- Outside your rights or the CRM's, a call is refused with "Introuvable ou hors de votre périmètre"
  (FR: not found or outside your perimeter), whether the object exists or not.
- Lists are paginated: use limit (max 100) and offset.
- "supprimer" moves to the trash or archives, with one exception: removing a workflow step or move (family
  workflows) deletes it for good, as the workflow editor does. Confirm such a removal with the person first.
"""


#: Chemins de l'hôte du connecteur qui mènent à l'administration, dans la webapp : celui que le responsable a tapé, et
#: celui de l'administration d'Evoliz (docs/SPEC-mcp.md §2.2). Aucun autre chemin n'est redirigé.
CHEMINS_ADMINISTRATION = ("/plateforme", "/admin")


def vers_l_administration(url_plateforme: str):
    """Le point qui répond `302` vers la plateforme de la webapp. `302` et non `301` : la destination changera avec
    `CRM-103`. La chaîne de requête n'est pas transmise."""

    async def rediriger(_: Request) -> RedirectResponse:
        return RedirectResponse(url_plateforme, status_code=302)

    return rediriger


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
    # L'icône du serveur est le monogramme du CRM : les clients MCP l'affichent, et la page de consentement aussi, au lieu
    # du logo de FastMCP chargé depuis un domaine tiers (docs/DESIGN_SYSTEM.md §5.57 ; CLAUDE.md §11).
    serveur = FastMCP(
        name="P2Enjoy CRM",
        instructions=INSTRUCTIONS,
        auth=mandataire,
        icons=[Icon(src=pages.FAVICON, mime_type="image/svg+xml", sizes=["any"])],
    )
    moteur = MoteurPolitique(registre=registre, crm=crm, jwt_secret=reglages.jwt_secret)
    reference.ajouter(serveur, moteur, crm)
    # `CRM-108` : la famille `recettes` (docs/SPEC-recettes.md §7).
    recettes.ajouter(serveur, moteur, crm)
    # `CRM-104` T2.a : la lecture des affaires (docs/SPEC-mcp.md §9.2 bis).
    affaires.ajouter(serveur, moteur, crm)
    # `CRM-104` T2.b : l'écriture des affaires (docs/SPEC-mcp.md §9.2 ter).
    affaires_ecriture.ajouter(serveur, moteur, crm)
    # `CRM-104` T1 : la structure et la recherche globale (docs/SPEC-mcp.md §9.2 quater).
    structure.ajouter(serveur, moteur, crm)
    # `CRM-118` T2.a : la famille `workflows`, le workflow, ses étapes et ses transitions (docs/SPEC-mcp.md §9.2 undecies).
    workflows.ajouter(serveur, moteur, crm)
    # `CRM-118` T2.b : le formulaire, la visibilité et les exigences d'un workflow (docs/SPEC-mcp.md §9.2 undecies).
    workflows_formulaire.ajouter(serveur, moteur, crm)
    # `CRM-118` T2.c : les versions, les comparaisons, le remappage (docs/SPEC-mcp.md §9.2 undecies).
    workflows_versions.ajouter(serveur, moteur, crm)
    # `CRM-118` T2.d : le catalogue de nœuds (docs/SPEC-mcp.md §9.2 undecies).
    workflows_noeuds.ajouter(serveur, moteur, crm)
    # `CRM-104` T3 : les contacts (docs/SPEC-mcp.md §9.2 quinquies).
    contacts.ajouter(serveur, moteur, crm)
    # `CRM-114` T4 : les organisations (docs/SPEC-mcp.md §9.2 sexies).
    organisations.ajouter(serveur, moteur, crm)
    # `CRM-104` T4 : les budgets et les lignes de coût (docs/SPEC-mcp.md §9.2 septies).
    budgets.ajouter(serveur, moteur, crm)
    # `CRM-104` T5 : le temps passé (docs/SPEC-mcp.md §9.2 octies).
    temps.ajouter(serveur, moteur, crm)
    # `CRM-104` T6 : les canevas d'objectifs (docs/SPEC-mcp.md §9.2 nonies).
    objectifs.ajouter(serveur, moteur, crm)
    # `CRM-104` T7 : la messagerie d'une affaire (docs/SPEC-mcp.md §9.2 decies).
    messagerie.ajouter(serveur, moteur, crm)
    # L'ordre compte : l'audit enveloppe la politique, qui précède l'outil (docs/SPEC-mcp.md §6.2).
    serveur.add_middleware(AuditOutils(registre, reglages.taille_max_reponse))
    serveur.add_middleware(PolitiqueOutils(moteur))

    @serveur.custom_route("/", methods=["GET"])
    async def accueil(_: Request) -> HTMLResponse:
        return HTMLResponse(pages.accueil(reglages.url_mcp, reglages.url_plateforme))

    rediriger = vers_l_administration(reglages.url_plateforme)
    for chemin in CHEMINS_ADMINISTRATION:
        serveur.custom_route(chemin, methods=["GET"])(rediriger)

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

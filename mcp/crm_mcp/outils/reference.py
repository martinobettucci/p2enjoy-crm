# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le seul outil du socle, la liste des espaces accessibles
# @spec docs/SPEC-mcp.md §6.1 (outil de référence : visible dès qu'un droit existe, résultats filtrés par la matrice),
#       §9.1 (déclaration, `readOnlyHint`, aucun chemin parallèle : la table `workspaces` que lit la webapp), §9.3
#       (JSON structuré, identifiants et libellés, `limit` borné à 100 et `offset`)
"""Outils de référence : sans espace unique, filtrés par la matrice du compte."""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field

from crm_mcp.crm import ClientCrm
from crm_mcp.politique import REFERENCE, Declaration, MoteurPolitique, appel_courant, traduire_refus

LIMITE_MAX = 100


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_workspace_list(
        limit: Annotated[int, Field(description="Maximum number of workspaces returned", ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(description="Number of workspaces skipped, for the next page", ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        espaces = await crm.lire(appel.jeton, "workspaces", {"select": "id,slug,name", "order": "name.asc,id.asc"})
        if not espaces.reussie or not isinstance(espaces.corps, list):
            raise traduire_refus(espaces, "workspace", "")
        membres = await crm.lire(
            appel.jeton, "workspace_members", {"user_id": f"eq.{appel.sujet}", "select": "workspace_id,role"}
        )
        if not membres.reussie or not isinstance(membres.corps, list):
            raise traduire_refus(membres, "workspace", "")
        roles = {str(m["workspace_id"]): m["role"] for m in membres.corps}
        droits: dict[str, list[str]] = {}
        for espace, famille, action in sorted(appel.etat.droits):
            droits.setdefault(espace, []).append(f"{famille}:{action}")
        # Ce que la RLS rend, restreint à ce que la matrice ouvre ; le superadministrateur franchit la matrice.
        lignes = [
            {
                "id": e["id"],
                "slug": e["slug"],
                "name": e["name"],
                "role": roles.get(str(e["id"])),
                "rights": "all" if appel.etat.superadmin else droits[str(e["id"])],
            }
            for e in espaces.corps
            if appel.etat.superadmin or str(e["id"]) in droits
        ]
        return {"total": len(lignes), "offset": offset, "workspaces": lignes[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_workspace_list,
        Declaration(famille=REFERENCE, action="consulter", espace=REFERENCE),
        titre="List workspaces (espaces)",
        description=(
            "Lists the CRM workspaces (FR: espaces) this connector may act on for you: the ones you can read in the CRM "
            "and where a superadmin granted you connector rights. Each row gives the id and slug to pass as `workspace` "
            "to other tools, your CRM role there (null if you are not a member), and your connector rights as "
            "family:action pairs (or \"all\" for a superadmin). A workspace missing here is closed to the connector."
        ),
    )

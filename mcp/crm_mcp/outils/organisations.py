# @spec CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations` (décisions 660, 663)
# @spec docs/SPEC-mcp.md §9.2 sexies (la liste fixée, les refus nommés, aucune suppression), §9.1 (les lectures et
#       écritures de l'onglet « Organisations » de la webapp, `organisations.ts`), §9.3 ; docs/SPEC-organisations.md §3
#       (droits de la base, refus), §5 (la famille et ses outils)
"""Les organisations du carnet, sous l'identité de la personne : les lister, en lire une, en créer, en modifier.

Les mêmes lectures que l'onglet « Organisations » et la fiche d'organisation, les mêmes écritures que leur formulaire.
La base réserve l'écriture au business developer et à l'administrateur ; un refus est traduit, une ligne filtrée est le
refus uniforme.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires import nettoyer_texte
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.outils.contacts import facultatif
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

LIMITE_MAX = 100
COLONNES_ORGANISATION = "id,name,domain,website"
#: Le compte embarqué de PostgREST, lu sous la même RLS que la ligne : celui de l'onglet de la webapp.
COLONNES_LISTE = f"{COLONNES_ORGANISATION},contacts(count)"
COLONNES_FICHE = f"{COLONNES_ORGANISATION},contacts(id,full_name,role_title,email,phone)"


def refus_organisation(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Le domaine déjà pris, une contrainte de forme nommée ; le reste comme partout (`refus`)."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    if corps.get("code") == "23505":
        return RefusCrm("Refusé par le CRM : domain_taken — another organization of the workspace has this domain.")
    contrainte = re.search(r'constraint "([a-z_]+_check)"', str(corps.get("message") or ""))
    if corps.get("code") == "23514" and contrainte:
        return RefusCrm(
            f"Refusé par le CRM : {contrainte.group(1)} — a value is not allowed (name required; domain in lowercase "
            "letters, digits, hyphens and dots; website starting with http:// or https://)."
        )
    return refus(reponse, genre, valeur)


def domaine(valeur: str | None) -> str | None:
    """Comme l'écran : blanc efface, et la casse d'un domaine ne porte aucune information (DESIGN_SYSTEM §5.64)."""
    nettoye = facultatif(valeur)
    return None if nettoye is None else nettoye.lower()


def organisation_lue(o: dict[str, Any]) -> dict[str, Any]:
    return {"id": o["id"], "name": o["name"], "domain": o.get("domain"), "website": o.get("website")}


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
        if not reponse.reussie:
            raise refus_organisation(reponse, genre, valeur)
        lignes = reponse.corps if isinstance(reponse.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable(genre, valeur))
        return lignes[0]

    async def crm_organization_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        query: Annotated[str | None, Field(description="Optional words of the name or domain", max_length=100)] = None,
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "select": COLONNES_LISTE,
            "order": "name.asc,id.asc",
            "limit": str(limit + 1),
            "offset": str(offset),
        }
        texte = nettoyer_texte(query or "")
        if texte:
            parametres["or"] = f"(name.ilike.*{texte}*,domain.ilike.*{texte}*)"
        reponse = await crm.lire(appel.jeton, "organizations", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_organisation(reponse, "workspace", workspace)
        return {
            "offset": offset,
            "has_more": len(reponse.corps) > limit,
            "organizations": [
                {**organisation_lue(o), "contacts": ((o.get("contacts") or [{}])[0] or {}).get("count", 0)}
                for o in reponse.corps[:limit]
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_organization_list,
        Declaration(famille="organizations", action="consulter", espace="workspace:workspace"),
        titre="List organizations",
        description=(
            "Lists the organizations of a workspace's address book, by name: domain, website and number of contacts, "
            "including organizations without any contact. Filter: words of the name or domain. Paginated."
        ),
    )

    async def crm_organization_get(
        organization_id: Annotated[str, Field(description="The organization id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(
            appel.jeton, "organizations", {"id": f"eq.{organization_id}", "select": COLONNES_FICHE}
        )
        fiche = une_ligne(reponse, "organisation", organization_id)
        liste = sorted(fiche.get("contacts") or [], key=lambda c: (str(c.get("full_name")), str(c.get("id"))))
        return {
            **organisation_lue(fiche),
            "contacts": [
                {k: c.get(k) for k in ("id", "full_name", "role_title", "email", "phone")} for c in liste
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_organization_get,
        Declaration(famille="organizations", action="consulter", espace="organisation:organization_id"),
        titre="Read an organization",
        description="Reads an organization: domain, website, and its contacts (name, job title, email, phone).",
    )

    async def crm_organization_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
        name: Annotated[str, Field(min_length=1, max_length=200)],
        domain: Annotated[str | None, Field(description="Email domain, e.g. sogexia.fr; stored in lowercase", max_length=253)] = None,
        website: Annotated[str | None, Field(description="Starting with http:// or https://", max_length=2048)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "organizations",
            parametres={"select": COLONNES_ORGANISATION},
            corps={
                "workspace_id": appel.espace,
                "name": name.strip(),
                "domain": domaine(domain),
                "website": facultatif(website),
            },
        )
        return {"organization": organisation_lue(une_ligne(reponse, "workspace", workspace))}

    moteur.enregistrer(
        serveur,
        crm_organization_create,
        Declaration(famille="organizations", action="ajouter", espace="workspace:workspace"),
        titre="Create an organization",
        description=(
            "Creates an organization in the workspace's address book, as the « Nouvelle organisation » form: name, and "
            "optional domain (unique in the workspace) and website. Contacts are then attached with crm_contact_update."
        ),
    )

    async def crm_organization_update(
        organization_id: Annotated[str, Field(description="The organization id")],
        name: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        domain: Annotated[str | None, Field(description="Empty string clears it; stored in lowercase", max_length=253)] = None,
        website: Annotated[str | None, Field(description="Empty string clears it", max_length=2048)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {}
        if name is not None:
            corps["name"] = name.strip()
        if domain is not None:
            corps["domain"] = domaine(domain)
        if website is not None:
            corps["website"] = facultatif(website)
        if not corps:
            raise ToolError("Give at least one field to change.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "organizations",
            parametres={"id": f"eq.{organization_id}", "select": COLONNES_ORGANISATION},
            corps=corps,
        )
        return {"organization": organisation_lue(une_ligne(reponse, "organisation", organization_id))}

    moteur.enregistrer(
        serveur,
        crm_organization_update,
        Declaration(famille="organizations", action="modifier", espace="organisation:organization_id"),
        titre="Update an organization",
        description=(
            "Changes an organization's name, domain or website, as the organization page's form. Only the fields given "
            "are written; an empty string clears the domain or the website. There is no tool to delete an "
            "organization: its contacts would lose it without a trace."
        ),
    )

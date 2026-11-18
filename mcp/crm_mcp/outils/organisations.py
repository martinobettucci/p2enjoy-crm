# @spec CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations` (décisions 660, 663)
# @spec docs/SPEC-mcp.md §9.2 sexies (la liste fixée, les refus nommés, aucune suppression), §9.1 (les lectures et
#       écritures de l'onglet « Organisations » de la webapp, `organisations.ts`), §9.3 ; docs/SPEC-organisations.md §3
#       (droits de la base, refus), §5 (la famille et ses outils)
# @spec CRM-150 (docs/BACKLOG.md) — tranche T1 : les refus que l'outil fait lui-même sont des `RefusArgument`, journalisés
#       `refus_crm` (docs/SPEC-mcp.md §9.3, décision 933)
# @spec CRM-152 (docs/BACKLOG.md) — tranche T3 : `crm_organization_list` appelle `organization_list` puis
#       `organization_tracks`, la lecture de l'onglet de la webapp — `query` cherche aussi dans le site web, `tracks` filtre
#       sur l'un d'eux, chaque organisation rend ses tracks, la réponse rend `total` (docs/SPEC-mcp.md §9.2 tervicies ;
#       docs/SPEC-organisations.md §8.1, §8.2, §8.4 ; décisions 931 et 936)
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
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.outils.contacts import facultatif
from crm_mcp.politique import Declaration, MoteurPolitique, RefusArgument, RefusCrm, appel_courant, introuvable

LIMITE_MAX = 100
COLONNES_ORGANISATION = "id,name,domain,website"
COLONNES_FICHE = f"{COLONNES_ORGANISATION},contacts(id,full_name,role_title,email,phone)"
#: Au plus tant de tracks dans un filtre : bien au-delà des tracks d'un espace, en deçà d'une liste forgée.
TRACKS_MAX = 50
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def tracks_du_filtre(tracks: list[str] | None) -> list[str] | None:
    """Les identifiants du filtre, dédoublonnés ; un identifiant mal formé est refusé par l'outil, nommé (§9.3). Ce ne
    sont pas des ancres : la fonction filtre dans l'espace de l'appel, et un track d'ailleurs ne rend rien de plus."""
    if not tracks:
        return None
    mal_formes = [t for t in tracks if not _UUID.match(t.strip())]
    if mal_formes:
        raise RefusArgument(f"tracks must be track ids from crm_track_list; not an id: {', '.join(map(repr, mal_formes[:3]))}.")
    return list(dict.fromkeys(t.strip().lower() for t in tracks))


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
        query: Annotated[
            str | None, Field(description="Optional words of the name, domain or website", max_length=100)
        ] = None,
        tracks: Annotated[
            list[str] | None,
            Field(
                description="Optional track ids, from crm_track_list: keeps the organizations attached to ANY of them, "
                "through a contact linked to a deal of the track",
                max_length=TRACKS_MAX,
            ),
        ] = None,
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        texte = (query or "").strip()
        filtre = tracks_du_filtre(tracks)
        # LA LECTURE DE L'ONGLET : `organization_list` cherche, filtre et compte en base, sous la RLS de la personne ; la
        # recherche y est échappée, elle n'a pas à être nettoyée ici.
        reponse = await crm.rpc(
            appel.jeton,
            "organization_list",
            {
                "p_workspace_id": appel.espace,
                "p_search": texte or None,
                "p_track_ids": filtre,
                "p_limit": limit,
                "p_offset": offset,
            },
            idempotent=True,
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_organisation(reponse, "workspace", workspace)
        lignes = reponse.corps
        total = int(lignes[0]["total_count"]) if lignes else 0
        tracks_de: dict[str, list[dict[str, Any]]] = {}
        if lignes:
            lus = await crm.rpc(
                appel.jeton, "organization_tracks", {"p_organization_ids": [o["id"] for o in lignes]}, idempotent=True
            )
            if not lus.reussie or not isinstance(lus.corps, list):
                raise refus_organisation(lus, "workspace", workspace)
            for t in lus.corps:
                tracks_de.setdefault(t["organization_id"], []).append(
                    {"id": t["track_id"], "name": t["name"], "slug": t["slug"]}
                )
        return {
            "offset": offset,
            "total": total,
            "has_more": offset + len(lignes) < total,
            "organizations": [
                {**organisation_lue(o), "contacts": o.get("contacts", 0), "tracks": tracks_de.get(o["id"], [])}
                for o in lignes
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_organization_list,
        Declaration(famille="organizations", action="consulter", espace="workspace:workspace"),
        titre="List organizations",
        description=(
            "Lists the organizations of a workspace's address book, by name: domain, website, number of contacts and "
            "tracks (where a contact of the organization is linked to a deal), including organizations without any "
            "contact. Filters: words of the name, domain or website; track ids (any of them). Paginated, with the total."
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
            raise RefusArgument("Give at least one field to change.")
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

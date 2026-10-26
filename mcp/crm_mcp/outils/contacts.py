# @spec CRM-104 (docs/BACKLOG.md) — tranche T3 : les quatre outils de contact de la famille `contacts` (décision 660)
# @spec docs/SPEC-mcp.md §9.2 quinquies (la liste fixée, l'ancre `organisation` facultative, aucune suppression : le CRM
#       ne sait que détruire, A4 ; les organisations à `CRM-114`), §9.1 (les lectures et écritures du carnet de la webapp,
#       `contacts.ts`), §9.3 ; docs/SPEC-contacts.md §14 (création), §15 (fiche), §16 (modification)
# @spec CRM-111 T2.4.2 (docs/BACKLOG.md) — une affaire liée est archivée quand tous ses rattachements le sont (docs/SPEC-rattachements.md §5, §11)
"""Le carnet de contacts, sous l'identité de la personne : lire, créer, modifier un contact.

Les mêmes lectures que le carnet et la fiche d'un contact, les mêmes écritures que leurs formulaires. La base réserve
l'écriture à qui édite l'espace ; un refus est traduit, une ligne filtrée est le refus uniforme.
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
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

LIMITE_MAX = 100
COLONNES_CONTACT = "id,full_name,email,phone,role_title,organization_id,organizations(id,name,domain)"
COLONNES_FICHE = (
    f"{COLONNES_CONTACT},card_contacts(role,cards!inner(id,title,card_placements!card_placements_card_fk(archived_at)))"
)


def refus_contact(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Un doublon, une contrainte nommée ; le reste comme partout (`refus`)."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    if corps.get("code") == "23505":
        return RefusCrm("Refusé par le CRM : duplicate_contact — a contact with this value already exists in the workspace.")
    contrainte = re.search(r'constraint "([a-z_]+_check)"', str(corps.get("message") or ""))
    if corps.get("code") == "23514" and contrainte:
        return RefusCrm(f"Refusé par le CRM : {contrainte.group(1)} — a value is not allowed (name, email or phone).")
    return refus(reponse, genre, valeur)


def contact_lu(c: dict[str, Any]) -> dict[str, Any]:
    organisation = c.get("organizations") or {}
    return {
        "id": c["id"],
        "full_name": c["full_name"],
        "role_title": c.get("role_title"),
        "email": c.get("email"),
        "phone": c.get("phone"),
        "organization": None if not organisation else {"id": organisation.get("id"), "name": organisation.get("name")},
    }


def facultatif(valeur: str | None) -> str | None:
    """Une chaîne vide ou blanche efface le champ, comme `normaliserFacultatif` du carnet."""
    return None if valeur is None or not valeur.strip() else valeur.strip()


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
        if not reponse.reussie:
            raise refus_contact(reponse, genre, valeur)
        lignes = reponse.corps if isinstance(reponse.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable(genre, valeur))
        return lignes[0]

    async def crm_contact_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        query: Annotated[str | None, Field(description="Optional words of the name, email or job title", max_length=100)] = None,
        organization_id: Annotated[str | None, Field(description="Optional organization id: only its contacts")] = None,
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "select": COLONNES_CONTACT,
            "order": "full_name.asc,id.asc",
            "limit": str(limit + 1),
            "offset": str(offset),
        }
        texte = nettoyer_texte(query or "")
        if texte:
            parametres["or"] = f"(full_name.ilike.*{texte}*,email.ilike.*{texte}*,role_title.ilike.*{texte}*)"
        if organization_id is not None:
            parametres["organization_id"] = f"eq.{organization_id}"
        reponse = await crm.lire(appel.jeton, "contacts", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_contact(reponse, "workspace", workspace)
        return {
            "offset": offset,
            "has_more": len(reponse.corps) > limit,
            "contacts": [contact_lu(c) for c in reponse.corps[:limit]],
        }

    moteur.enregistrer(
        serveur,
        crm_contact_list,
        Declaration(
            famille="contacts", action="consulter", espace="workspace:workspace", autres=("organisation:organization_id",)
        ),
        titre="List contacts (carnet)",
        description=(
            "Lists the contacts of a workspace's address book, by name: job title, email, phone and organization. "
            "Filters: words of the name, email or job title; one organization. Paginated."
        ),
    )

    async def crm_contact_get(
        contact_id: Annotated[str, Field(description="The contact id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(
            appel.jeton,
            "contacts",
            {
                "id": f"eq.{contact_id}",
                "select": COLONNES_FICHE,
                # Une affaire de la corbeille n'est pas listée : c'est la règle de la fiche (`CHEMIN_FILTRE_CORBEILLE`).
                "card_contacts.cards.deleted_at": "is.null",
            },
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_contact(reponse, "contact", contact_id)
        if len(reponse.corps) != 1:
            raise RefusCrm(introuvable("contact", contact_id))
        fiche = reponse.corps[0]
        affaires = sorted(
            (
                {
                    "id": (lien.get("cards") or {}).get("id"),
                    "title": (lien.get("cards") or {}).get("title"),
                    # `CRM-111` T2.4.2 : archivée quand TOUS ses rattachements le sont, la règle de la fiche contact.
                    "archived": bool((lien.get("cards") or {}).get("card_placements"))
                    and all(r.get("archived_at") is not None for r in (lien.get("cards") or {}).get("card_placements") or []),
                    "role": lien.get("role"),
                }
                for lien in fiche.get("card_contacts") or []
                if lien.get("cards")
            ),
            key=lambda a: str(a["title"]),
        )
        return {**contact_lu(fiche), "affaires": affaires}

    moteur.enregistrer(
        serveur,
        crm_contact_get,
        Declaration(famille="contacts", action="consulter", espace="contact:contact_id"),
        titre="Read a contact",
        description="Reads a contact: job title, email, phone, organization, and the affaires (cards) it is linked to, with its role in each.",
    )

    async def crm_contact_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
        full_name: Annotated[str, Field(min_length=1, max_length=200)],
        role_title: Annotated[str | None, Field(description="Job title", max_length=200)] = None,
        email: Annotated[str | None, Field(max_length=320)] = None,
        phone: Annotated[str | None, Field(max_length=50)] = None,
        organization_id: Annotated[str | None, Field(description="An existing organization of the workspace")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "contacts",
            parametres={"select": COLONNES_CONTACT},
            corps={
                "workspace_id": appel.espace,
                "full_name": full_name.strip(),
                "organization_id": organization_id,
                "role_title": facultatif(role_title),
                "email": facultatif(email),
                "phone": facultatif(phone),
            },
        )
        return {"contact": contact_lu(une_ligne(reponse, "workspace", workspace))}

    moteur.enregistrer(
        serveur,
        crm_contact_create,
        Declaration(
            famille="contacts", action="ajouter", espace="workspace:workspace", autres=("organisation:organization_id",)
        ),
        titre="Create a contact",
        description=(
            "Creates a contact in the workspace's address book, as the « Nouveau contact » form: full name, and optional "
            "job title, email, phone and existing organization."
        ),
    )

    async def crm_contact_update(
        contact_id: Annotated[str, Field(description="The contact id")],
        full_name: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        role_title: Annotated[str | None, Field(description="Empty string clears it", max_length=200)] = None,
        email: Annotated[str | None, Field(description="Empty string clears it", max_length=320)] = None,
        phone: Annotated[str | None, Field(description="Empty string clears it", max_length=50)] = None,
        organization_id: Annotated[str | None, Field(description="Move to another existing organization")] = None,
        detach_organization: Annotated[bool, Field(description="Remove its organization")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if organization_id is not None and detach_organization:
            raise ToolError("Give organization_id or detach_organization, not both.")
        corps: dict[str, Any] = {}
        if full_name is not None:
            corps["full_name"] = full_name.strip()
        for cle, valeur in (("role_title", role_title), ("email", email), ("phone", phone)):
            if valeur is not None:
                corps[cle] = facultatif(valeur)
        if organization_id is not None:
            corps["organization_id"] = organization_id
        if detach_organization:
            corps["organization_id"] = None
        if not corps:
            raise ToolError("Give at least one field to change.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "contacts", parametres={"id": f"eq.{contact_id}", "select": COLONNES_CONTACT}, corps=corps
        )
        return {"contact": contact_lu(une_ligne(reponse, "contact", contact_id))}

    moteur.enregistrer(
        serveur,
        crm_contact_update,
        Declaration(
            famille="contacts", action="modifier", espace="contact:contact_id", autres=("organisation:organization_id",)
        ),
        titre="Update a contact",
        description=(
            "Changes a contact's name, job title, email, phone or organization, as the contact page's form. Only the "
            "fields given are written; an empty string clears an optional one. There is no tool to delete a contact: "
            "the CRM can only destroy it, which stays a gesture of the web app."
        ),
    )

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
# @spec CRM-153 (docs/BACKLOG.md) — tranche T5 : les catégories et le fil de commentaires d'une organisation — `categories`
#       dans la liste (filtre et rendu) et la fiche ; `crm_organization_category_list`, `crm_organization_comment_list`,
#       `crm_organization_comment_add` (mentions nommées une à une), `crm_organization_categories_set` (retire puis pose,
#       l'archivée nommée) ; sous les cases existantes de la famille (docs/SPEC-mcp.md §9.2 quatervicies ;
#       docs/SPEC-organisations.md §9.1, §9.2, §9.4 ; décision 932). Ni modification ni suppression d'un commentaire, ni
#       administration du catalogue.
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


def ids_du_filtre(valeurs: list[str] | None, champ: str, attendu: str) -> list[str] | None:
    """Les identifiants d'un filtre, dédoublonnés ; un identifiant mal formé est refusé par l'outil, nommé (§9.3). Ce ne
    sont pas des ancres : la fonction filtre dans l'espace de l'appel, et un identifiant d'ailleurs ne rend rien de plus."""
    if not valeurs:
        return None
    mal_formes = [v for v in valeurs if not _UUID.match(v.strip())]
    if mal_formes:
        raise RefusArgument(f"{champ} must be {attendu}; not an id: {', '.join(map(repr, mal_formes[:3]))}.")
    return list(dict.fromkeys(v.strip().lower() for v in valeurs))


def tracks_du_filtre(tracks: list[str] | None) -> list[str] | None:
    return ids_du_filtre(tracks, "tracks", "track ids from crm_track_list")


#: Au plus tant de catégories, de mentions ou d'identifiants dans un appel : bien au-delà d'un usage, en deçà d'un forgé.
IDS_MAX = 50
LONGUEUR_MAX_COMMENTAIRE = 10_000
COLONNES_COMMENTAIRE = (
    "id,body,author_id,created_at,edited_at,deleted_at,deleted_by,"
    "auteur:profiles!organization_comments_author_id_fkey(full_name)"
)


def categorie_lue(c: dict[str, Any]) -> dict[str, Any]:
    """Une catégorie telle que l'outil la rend : son nom, et si elle est archivée (§9.1)."""
    return {"id": c["id"], "name": c["name"], "archived": c.get("archived_at") is not None}


def rangees(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Les actives d'abord, puis les archivées, chacune par nom — l'ordre de l'écran (DESIGN_SYSTEM §5.107)."""
    return sorted(categories, key=lambda c: (c["archived"], str(c["name"]).casefold(), c["id"]))


def commentaire_lu(c: dict[str, Any]) -> dict[str, Any]:
    """Un commentaire du fil ; une pierre tombale rend `deleted: true`, sans corps, et dit si un tiers l'a posée."""
    supprime = c.get("deleted_at") is not None
    return {
        "id": c["id"],
        "author": {"id": c.get("author_id"), "name": (c.get("auteur") or {}).get("full_name")},
        "body": None if supprime else c.get("body"),
        "created_at": c.get("created_at"),
        "edited_at": c.get("edited_at"),
        "deleted": supprime,
        "moderated": supprime and c.get("deleted_by") is not None and c.get("deleted_by") != c.get("author_id"),
    }


def symbole(reponse: Reponse) -> str:
    """Le refus nommé d'une écriture : le symbole que lève le déclencheur, ou le code, ou le statut."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    if re.fullmatch(r"[a-z_]+", message):
        return message
    if corps.get("code") == "23505":
        return "already_set"
    if reponse.statut in (401, 403) or corps.get("code") == "42501":
        return "forbidden"
    return str(corps.get("code") or reponse.statut)


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

    async def categories_des(jeton: str, ids: list[str], genre: str, valeur: Any) -> dict[str, list[dict[str, Any]]]:
        """`CRM-153` T5 — les catégories de chaque organisation donnée, par leurs poses embarquant le catalogue : une
        lecture, comme l'écran (§9.1), jamais une par organisation."""
        if not ids:
            return {}
        lus = await crm.lire(
            jeton,
            "organization_category_links",
            {
                "organization_id": f"in.({','.join(ids)})",
                "select": "organization_id,categorie:organization_categories(id,name,archived_at)",
            },
        )
        if not lus.reussie or not isinstance(lus.corps, list):
            raise refus_organisation(lus, genre, valeur)
        groupes: dict[str, list[dict[str, Any]]] = {}
        for pose in lus.corps:
            if pose.get("categorie"):
                groupes.setdefault(pose["organization_id"], []).append(categorie_lue(pose["categorie"]))
        return {o: rangees(c) for o, c in groupes.items()}

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
        categories: Annotated[
            list[str] | None,
            Field(
                description="Optional category ids, from crm_organization_category_list: keeps the organizations that "
                "carry ANY of them, archived categories included",
                max_length=IDS_MAX,
            ),
        ] = None,
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        texte = (query or "").strip()
        filtre = tracks_du_filtre(tracks)
        filtre_categories = ids_du_filtre(categories, "categories", "category ids from crm_organization_category_list")
        # LA LECTURE DE L'ONGLET : `organization_list` cherche, filtre et compte en base, sous la RLS de la personne ; la
        # recherche y est échappée, elle n'a pas à être nettoyée ici.
        reponse = await crm.rpc(
            appel.jeton,
            "organization_list",
            {
                "p_workspace_id": appel.espace,
                "p_search": texte or None,
                "p_track_ids": filtre,
                "p_category_ids": filtre_categories,
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
        categories_de = await categories_des(appel.jeton, [o["id"] for o in lignes], "workspace", workspace)
        return {
            "offset": offset,
            "total": total,
            "has_more": offset + len(lignes) < total,
            "organizations": [
                {
                    **organisation_lue(o),
                    "contacts": o.get("contacts", 0),
                    "tracks": tracks_de.get(o["id"], []),
                    "categories": categories_de.get(o["id"], []),
                }
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
            "tracks (where a contact of the organization is linked to a deal), categories (archived ones flagged), "
            "including organizations without any contact. Filters: words of the name, domain or website; track ids (any "
            "of them); category ids (any of them, archived included). Paginated, with the total."
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
        categories_de = await categories_des(appel.jeton, [organization_id], "organisation", organization_id)
        return {
            **organisation_lue(fiche),
            "contacts": [
                {k: c.get(k) for k in ("id", "full_name", "role_title", "email", "phone")} for c in liste
            ],
            "categories": categories_de.get(organization_id, []),
        }

    moteur.enregistrer(
        serveur,
        crm_organization_get,
        Declaration(famille="organizations", action="consulter", espace="organisation:organization_id"),
        titre="Read an organization",
        description=(
            "Reads an organization: domain, website, its contacts (name, job title, email, phone) and its categories "
            "(archived ones flagged)."
        ),
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

    # --- `CRM-153` T5 : les catégories et le fil d'une organisation (docs/SPEC-mcp.md §9.2 quatervicies) ------------------

    async def crm_organization_category_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(
            appel.jeton,
            "organization_categories",
            {"workspace_id": f"eq.{appel.espace}", "select": "id,name,archived_at", "order": "name.asc,id.asc"},
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_organisation(reponse, "workspace", workspace)
        return {"categories": rangees([categorie_lue(c) for c in reponse.corps])}

    moteur.enregistrer(
        serveur,
        crm_organization_category_list,
        Declaration(famille="organizations", action="consulter", espace="workspace:workspace"),
        titre="List organization categories",
        description=(
            "Lists the categories an administrator defined for the workspace's organizations (client, partner…): "
            "active ones by name, then archived ones, flagged. An archived category is no longer set, but still "
            "filters the list and stays on the organizations that carry it."
        ),
    )

    async def crm_organization_comment_list(
        organization_id: Annotated[str, Field(description="The organization id")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        # L'organisation d'abord : illisible ou inconnue, le refus uniforme — jamais un fil vide qui le tairait.
        une_ligne(
            await crm.lire(appel.jeton, "organizations", {"id": f"eq.{organization_id}", "select": "id"}),
            "organisation",
            organization_id,
        )
        reponse = await crm.lire(
            appel.jeton,
            "organization_comments",
            {
                "organization_id": f"eq.{organization_id}",
                "select": COLONNES_COMMENTAIRE,
                "order": "created_at.asc,id.asc",
                "limit": str(limit + 1),
                "offset": str(offset),
            },
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_organisation(reponse, "organisation", organization_id)
        lignes = reponse.corps
        return {
            "offset": offset,
            "has_more": len(lignes) > limit,
            "comments": [commentaire_lu(c) for c in lignes[:limit]],
        }

    moteur.enregistrer(
        serveur,
        crm_organization_comment_list,
        Declaration(famille="organizations", action="consulter", espace="organisation:organization_id"),
        titre="Read an organization's comments",
        description=(
            "Reads the comment thread of an organization, oldest first, as on its page: author, body, dates. A deleted "
            "comment keeps its place with deleted: true and no body; moderated: true when someone else removed it."
        ),
    )

    async def crm_organization_comment_add(
        organization_id: Annotated[str, Field(description="The organization id")],
        body: Annotated[str, Field(description="Plain text", min_length=1, max_length=LONGUEUR_MAX_COMMENTAIRE)],
        mentions: Annotated[
            list[str] | None,
            Field(
                description="Optional profile ids of workspace members to notify (e.g. author ids from "
                "crm_organization_comment_list)",
                max_length=IDS_MAX,
            ),
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        personnes = ids_du_filtre(mentions, "mentions", "profile ids of workspace members") or []
        # Ni l'espace ni l'auteur ne sont envoyés : la 0188 n'accorde l'insertion que sur `organization_id`, `author_id`
        # et `body`, l'auteur est la personne (`auth.uid()` par défaut, exigé par la politique) et le déclencheur pose
        # l'espace. La lectrice est refusée par la base.
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "organization_comments",
            parametres={"select": "id,body,created_at"},
            corps={"organization_id": organization_id, "body": body},
        )
        commentaire = une_ligne(reponse, "organisation", organization_id)
        resultats: list[dict[str, Any]] = []
        for profil in personnes:
            pose = await crm.ecrire(
                appel.jeton,
                "POST",
                "organization_comment_mentions",
                parametres={"select": "profile_id"},
                corps={"comment_id": commentaire["id"], "profile_id": profil},
            )
            # LE COMMENTAIRE PUBLIÉ N'EST JAMAIS RETIRÉ : chaque mention dit son issue, nommée (§9.2).
            resultats.append({"profile_id": profil, "ok": True} if pose.reussie else
                             {"profile_id": profil, "ok": False, "refused": symbole(pose)})
        return {"comment": commentaire, "mentions": resultats}

    moteur.enregistrer(
        serveur,
        crm_organization_comment_add,
        Declaration(famille="organizations", action="ajouter", espace="organisation:organization_id"),
        titre="Comment on an organization",
        description=(
            "Adds a plain-text comment to an organization's thread, signed with your name, as on its page; business "
            "developers and administrators may comment. Optional mentions notify those members; each mention reports "
            "ok, or its refusal by name (e.g. mention_destinataire_sans_acces), the comment staying published."
        ),
    )

    async def crm_organization_categories_set(
        organization_id: Annotated[str, Field(description="The organization id")],
        add: Annotated[
            list[str] | None, Field(description="Category ids to set, from crm_organization_category_list", max_length=IDS_MAX)
        ] = None,
        remove: Annotated[list[str] | None, Field(description="Category ids to remove", max_length=IDS_MAX)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        poser = ids_du_filtre(add, "add", "category ids from crm_organization_category_list") or []
        retirer = ids_du_filtre(remove, "remove", "category ids from crm_organization_category_list") or []
        if not poser and not retirer:
            raise RefusArgument("Give at least one category id to add or to remove.")
        une_ligne(
            await crm.lire(appel.jeton, "organizations", {"id": f"eq.{organization_id}", "select": "id"}),
            "organisation",
            organization_id,
        )
        refusees: list[dict[str, Any]] = []
        # RETIRER PUIS POSER : retirer une catégorie et la reposer dans le même appel la laisse posée.
        for categorie in retirer:
            retrait = await crm.ecrire(
                appel.jeton,
                "DELETE",
                "organization_category_links",
                parametres={
                    "organization_id": f"eq.{organization_id}",
                    "category_id": f"eq.{categorie}",
                    "select": "category_id",
                },
            )
            if not retrait.reussie or not retrait.corps:
                refusees.append({"id": categorie, "action": "remove",
                                 "refused": symbole(retrait) if not retrait.reussie else "not_set_or_forbidden"})
        for categorie in poser:
            pose = await crm.ecrire(
                appel.jeton,
                "POST",
                "organization_category_links",
                parametres={"select": "category_id"},
                corps={"organization_id": organization_id, "category_id": categorie},
            )
            if not pose.reussie:
                refusees.append({"id": categorie, "action": "add", "refused": symbole(pose)})
        obtenues = await categories_des(appel.jeton, [organization_id], "organisation", organization_id)
        return {"categories": obtenues.get(organization_id, []), "refused": refusees}

    moteur.enregistrer(
        serveur,
        crm_organization_categories_set,
        Declaration(famille="organizations", action="modifier", espace="organisation:organization_id"),
        titre="Set an organization's categories",
        description=(
            "Removes then adds categories on an organization, as its page's « Catégories » panel; business developers "
            "and administrators may. An archived category cannot be added (category_archived) but can be removed. "
            "Returns the categories the organization now carries, and each refusal by name."
        ),
    )


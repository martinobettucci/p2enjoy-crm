# @spec CRM-114 (docs/BACKLOG.md) tranche T4 — un résultat `organisation` filtré par `organizations` (décision 666)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T1 : la famille `structure` et la recherche globale de référence (décision 656)
# @spec docs/SPEC-mcp.md §9.2 quater (la liste fixée, les ancres, le genre `workflow`, ce que la tranche ne fait pas), §6.1
#       (`crm_search`, outil de référence filtré par la matrice), §9.1 (les tables et fonctions de la webapp :
#       `administration-arborescence.ts`, `recherche.ts`), §9.3 ; docs/SPEC-recherche.md §6 (`recherche_globale`)
"""Tracks, channels et workflows, et la recherche globale, sous l'identité de la personne.

Les écritures sont celles de l'arborescence de la webapp ; la base les réserve à qui administre l'espace. La recherche
est celle de la palette ; chaque ligne n'est rendue que si la matrice ouvre la famille de son objet dans son espace.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

import re

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

LIMITE_RECHERCHE = 50
COLONNES_TRACK = "id,name,slug,description,color,icon,position,archived_at"
COLONNES_CHANNEL = "id,track_id,name,slug,description,workflow_id,position,archived_at,ecriture_permise,workflow:workflows(id,name)"

#: La famille de la matrice qui ouvre chaque genre de résultat de `recherche_globale` (docs/SPEC-mcp.md §9.2 quater).
FAMILLE_DU_RESULTAT = {
    "affaire": "affaires",
    "commentaire": "affaires",
    "contact": "contacts",
    # `CRM-114` : la famille distincte des organisations (décision 666, docs/SPEC-mcp.md §9.2 sexies).
    "organisation": "organizations",
    "message": "messagerie",
}


def refus_structure(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Les refus d'une écriture d'arborescence : un slug déjà pris, une valeur hors de la liste d'une contrainte —
    nommée — ; le reste comme partout (`refus`)."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    if corps.get("code") == "23505":
        return RefusCrm("Refusé par le CRM : slug_taken — this slug is already used here; choose another.")
    contrainte = re.search(r'constraint "([a-z_]+_check)"', message)
    if corps.get("code") == "23514" and contrainte:
        return RefusCrm(f"Refusé par le CRM : {contrainte.group(1)} — a value is not allowed (slug format, color or icon).")
    return refus(reponse, genre, valeur)


def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    """L'unique ligne touchée ; zéro ligne est le refus silencieux d'une politique, rendu comme le refus uniforme."""
    if not reponse.reussie:
        raise refus_structure(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def channel_lu(c: dict[str, Any]) -> dict[str, Any]:
    workflow = c.get("workflow") or {}
    return {
        "id": c["id"],
        "track_id": c.get("track_id"),
        "name": c["name"],
        "slug": c["slug"],
        "description": c.get("description"),
        "workflow": {"id": c.get("workflow_id"), "name": workflow.get("name")},
        "position": c.get("position"),
        "archived": c.get("archived_at") is not None,
        # La capacité rendue par la base (`CRM-093`) : ce que la personne peut écrire dans ce channel.
        "can_write": c.get("ecriture_permise") is True,
    }


def track_lu(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t["id"],
        "name": t["name"],
        "slug": t["slug"],
        "description": t.get("description"),
        "color": t.get("color"),
        "icon": t.get("icon"),
        "position": t.get("position"),
        "archived": t.get("archived_at") is not None,
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, table, parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus(reponse, genre, valeur)
        return reponse.corps

    # --- référence -------------------------------------------------------------------------------------------------

    async def crm_search(
        query: Annotated[str, Field(description="Words to search", min_length=2, max_length=200)],
        limit: Annotated[int, Field(ge=1, le=LIMITE_RECHERCHE)] = 20,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "recherche_globale", {"p_terme": query, "p_limite": limit}, idempotent=True)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise ToolError(f"Le CRM n'a pas pu chercher (HTTP {reponse.statut}).")
        ouvertes: dict[tuple[str, str], bool] = {}
        resultats = []
        for ligne in reponse.corps:
            famille = FAMILLE_DU_RESULTAT.get(str(ligne.get("objet")))
            espace = ligne.get("workspace_id")
            if famille is None or not isinstance(espace, str):
                # Un genre que le contrat ne nomme pas n'est rattaché à aucune famille : il n'est pas rendu.
                continue
            cle = (espace, famille)
            if cle not in ouvertes:
                ouvertes[cle] = await moteur.autorise(appel.jeton, espace, famille, "consulter")
            if ouvertes[cle]:
                resultats.append({
                    "kind": ligne["objet"], "id": ligne["id"], "workspace_id": espace, "title": ligne.get("titre"),
                    "subtitle": ligne.get("sous_titre"), "excerpt": ligne.get("extrait"),
                })
        return {"query": query, "results": resultats}

    moteur.enregistrer(
        serveur,
        crm_search,
        Declaration(famille="reference", action="consulter", espace="reference"),
        titre="Search the CRM (recherche)",
        description=(
            "Searches affaires, contacts, organisations, comments and messages, as the web app's search box. A result is "
            "returned only where the connector may read its family (affaires, contacts, messagerie) in its workspace."
        ),
    )

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_track_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        tracks = await lire(
            appel.jeton,
            "tracks",
            {"workspace_id": f"eq.{appel.espace}", "deleted_at": "is.null", "select": COLONNES_TRACK, "order": "position.asc,name.asc"},
            "workspace",
            workspace,
        )
        return {"tracks": [track_lu(t) for t in tracks]}

    moteur.enregistrer(
        serveur,
        crm_track_list,
        Declaration(famille="structure", action="consulter", espace="workspace:workspace"),
        titre="List tracks",
        description="Lists the tracks of a workspace you can read, in their order: name, slug, description, color, icon.",
    )

    async def crm_track_get(
        track_id: Annotated[str, Field(description="The track id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        tracks = await lire(appel.jeton, "tracks", {"id": f"eq.{track_id}", "select": COLONNES_TRACK}, "track", track_id)
        if len(tracks) != 1:
            raise RefusCrm(introuvable("track", track_id))
        channels = await lire(
            appel.jeton,
            "channels",
            {"track_id": f"eq.{track_id}", "deleted_at": "is.null", "select": COLONNES_CHANNEL, "order": "position.asc,name.asc"},
            "track",
            track_id,
        )
        return {**track_lu(tracks[0]), "channels": [channel_lu(c) for c in channels]}

    moteur.enregistrer(
        serveur,
        crm_track_get,
        Declaration(famille="structure", action="consulter", espace="track:track_id"),
        titre="Read a track",
        description="Reads a track and its channels, each with its workflow and whether you can write in it (can_write).",
    )

    async def crm_channel_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        track_id: Annotated[str | None, Field(description="Optional track id: only its channels")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}", "deleted_at": "is.null", "select": COLONNES_CHANNEL,
            "order": "position.asc,name.asc",
        }
        if track_id is not None:
            parametres["track_id"] = f"eq.{track_id}"
        channels = await lire(appel.jeton, "channels", parametres, "workspace", workspace)
        return {"channels": [channel_lu(c) for c in channels]}

    moteur.enregistrer(
        serveur,
        crm_channel_list,
        Declaration(famille="structure", action="consulter", espace="workspace:workspace", autres=("track:track_id",)),
        titre="List channels",
        description="Lists the channels of a workspace you can read, optionally of one track, with their workflow.",
    )

    async def crm_channel_get(
        channel_id: Annotated[str, Field(description="The channel id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        channels = await lire(appel.jeton, "channels", {"id": f"eq.{channel_id}", "select": COLONNES_CHANNEL}, "channel", channel_id)
        if len(channels) != 1:
            raise RefusCrm(introuvable("channel", channel_id))
        actives = await lire(
            appel.jeton,
            "cards",
            {"channel_id": f"eq.{channel_id}", "archived_at": "is.null", "deleted_at": "is.null", "select": "id", "limit": "1000"},
            "channel",
            channel_id,
        )
        return {**channel_lu(channels[0]), "active_cards": len(actives), "active_cards_capped_at": 1000}

    moteur.enregistrer(
        serveur,
        crm_channel_get,
        Declaration(famille="structure", action="consulter", espace="channel:channel_id"),
        titre="Read a channel",
        description="Reads a channel: description, workflow, whether you can write in it, and how many active affaires it holds.",
    )

    async def crm_workflow_get(
        workflow_id: Annotated[str, Field(description="The workflow id, from crm_channel_get")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        workflows = await lire(
            appel.jeton, "workflows", {"id": f"eq.{workflow_id}", "select": "id,name,scope,is_default,archived_at"},
            "workflow", workflow_id,
        )
        if len(workflows) != 1:
            raise RefusCrm(introuvable("workflow", workflow_id))
        etapes = await lire(
            appel.jeton,
            "workflow_steps",
            {
                "workflow_id": f"eq.{workflow_id}",
                "select": "id,position,is_initial,probability_override,stale_after_days,"
                "noeud:workflow_nodes_catalog(label,kind,default_probability,default_stale_after_days)",
                "order": "position.asc",
            },
            "workflow",
            workflow_id,
        )
        noms = {str(e["id"]): (e.get("noeud") or {}).get("label") for e in etapes}
        champs = await lire(
            appel.jeton,
            "form_fields",
            {"workflow_id": f"eq.{workflow_id}", "archived_at": "is.null", "select": "id,key,label,type,position", "order": "position.asc"},
            "workflow",
            workflow_id,
        )
        libelles = {str(c["id"]): c["label"] for c in champs}
        transitions = await lire(
            appel.jeton,
            "workflow_transitions",
            {"workflow_id": f"eq.{workflow_id}", "select": "id,from_step_id,to_step_id,label,require_comment"},
            "workflow",
            workflow_id,
        )
        exiges: dict[str, list[str]] = {}
        if transitions:
            liens = await lire(
                appel.jeton,
                "workflow_transition_required_fields",
                {"transition_id": "in.(" + ",".join(str(t["id"]) for t in transitions) + ")", "select": "transition_id,field_id"},
                "workflow",
                workflow_id,
            )
            for lien in liens:
                if str(lien["field_id"]) in libelles:
                    exiges.setdefault(str(lien["transition_id"]), []).append(libelles[str(lien["field_id"])])
        return {
            "id": workflows[0]["id"],
            "name": workflows[0]["name"],
            "scope": workflows[0].get("scope"),
            "steps": [
                {
                    "id": e["id"],
                    "name": (e.get("noeud") or {}).get("label"),
                    "kind": (e.get("noeud") or {}).get("kind"),
                    "initial": e.get("is_initial") is True,
                    # L'étape surcharge le nœud : la valeur rendue est celle qui s'applique.
                    "probability": e.get("probability_override")
                    if e.get("probability_override") is not None
                    else (e.get("noeud") or {}).get("default_probability"),
                    "stale_after_days": e.get("stale_after_days")
                    if e.get("stale_after_days") is not None
                    else (e.get("noeud") or {}).get("default_stale_after_days"),
                }
                for e in etapes
            ],
            "transitions": [
                {
                    "from_step": noms.get(str(t["from_step_id"])),
                    "to_step": noms.get(str(t["to_step_id"])),
                    "label": t.get("label") or noms.get(str(t["to_step_id"])),
                    "requires_comment": t.get("require_comment") is True,
                    "required_fields": sorted(exiges.get(str(t["id"]), [])),
                }
                for t in transitions
            ],
            "form_fields": [{"key": c["key"], "label": c["label"], "type": c["type"]} for c in champs],
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_get,
        Declaration(famille="structure", action="consulter", espace="workflow:workflow_id"),
        titre="Read a workflow",
        description=(
            "Reads a workflow: its steps in order (initial, kind, probability, reminder threshold), the declared moves "
            "between them — with the reason they require and the form fields they demand, by label — and its form "
            "fields. Read it before crm_card_move."
        ),
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_track_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
        name: Annotated[str, Field(min_length=1, max_length=100)],
        slug: Annotated[str, Field(description="Lowercase letters, digits and hyphens; part of the track's address", min_length=1, max_length=63)],
        color: Annotated[str, Field(description="One of the CRM's track colors, e.g. brand, success, accent")],
        icon: Annotated[str, Field(description="A Lucide icon name known to the CRM, e.g. sparkles")],
        description: Annotated[str | None, Field(max_length=2000)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "tracks",
            parametres={"select": COLONNES_TRACK},
            corps={
                "workspace_id": appel.espace, "name": name, "slug": slug, "color": color, "icon": icon,
                "description": description.strip() if description and description.strip() else None,
            },
        )
        return {"track": track_lu(une_ligne(reponse, "workspace", workspace))}

    moteur.enregistrer(
        serveur,
        crm_track_create,
        Declaration(famille="structure", action="ajouter", espace="workspace:workspace"),
        titre="Create a track",
        description="Creates a track in a workspace, as the tree editor does. Reserved by the CRM to workspace administrators.",
    )

    async def crm_channel_create(
        track_id: Annotated[str, Field(description="The track id")],
        workflow_id: Annotated[str, Field(description="The workflow its affaires follow")],
        name: Annotated[str, Field(min_length=1, max_length=100)],
        slug: Annotated[str, Field(description="Lowercase letters, digits and hyphens, unique in the track", min_length=1, max_length=63)],
        description: Annotated[str | None, Field(max_length=2000)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "channels",
            parametres={"select": COLONNES_CHANNEL},
            corps={
                "workspace_id": appel.espace, "track_id": track_id, "workflow_id": workflow_id, "name": name, "slug": slug,
                "description": description.strip() if description and description.strip() else None,
            },
        )
        return {"channel": channel_lu(une_ligne(reponse, "track", track_id))}

    moteur.enregistrer(
        serveur,
        crm_channel_create,
        Declaration(famille="structure", action="ajouter", espace="track:track_id", autres=("workflow:workflow_id",)),
        titre="Create a channel",
        description="Creates a channel in a track with its workflow, as the tree editor does. Reserved to administrators.",
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_track_update(
        track_id: Annotated[str, Field(description="The track id")],
        name: Annotated[str | None, Field(min_length=1, max_length=100)] = None,
        color: Annotated[str | None, Field()] = None,
        icon: Annotated[str | None, Field()] = None,
        description: Annotated[str | None, Field(description="Empty string clears it", max_length=2000)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {k: v for k, v in (("name", name), ("color", color), ("icon", icon)) if v is not None}
        if description is not None:
            corps["description"] = description.strip() or None
        if not corps:
            raise ToolError("Give at least one field to change; the slug never changes.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "tracks", parametres={"id": f"eq.{track_id}", "select": COLONNES_TRACK}, corps=corps
        )
        return {"track": track_lu(une_ligne(reponse, "track", track_id))}

    moteur.enregistrer(
        serveur,
        crm_track_update,
        Declaration(famille="structure", action="modifier", espace="track:track_id"),
        titre="Update a track",
        description="Renames a track or changes its color, icon or description. Its slug — its address — never changes.",
    )

    async def crm_channel_update(
        channel_id: Annotated[str, Field(description="The channel id")],
        name: Annotated[str | None, Field(min_length=1, max_length=100)] = None,
        description: Annotated[str | None, Field(description="Empty string clears it", max_length=2000)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {} if name is None else {"name": name}
        if description is not None:
            corps["description"] = description.strip() or None
        if not corps:
            raise ToolError("Give name and/or description; the workflow changes only in the web app.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "channels", parametres={"id": f"eq.{channel_id}", "select": COLONNES_CHANNEL}, corps=corps
        )
        return {"channel": channel_lu(une_ligne(reponse, "channel", channel_id))}

    moteur.enregistrer(
        serveur,
        crm_channel_update,
        Declaration(famille="structure", action="modifier", espace="channel:channel_id"),
        titre="Update a channel",
        description=(
            "Renames a channel or changes its description. Changing its workflow remaps its affaires and stays a gesture "
            "of the web app."
        ),
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_track_trash(
        track_id: Annotated[str, Field(description="The track id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "tracks", parametres={"id": f"eq.{track_id}", "select": "id,name"},
            corps={"deleted_at": datetime.now(UTC).isoformat()},
        )
        return {"trashed": une_ligne(reponse, "track", track_id), "note": "An administrator can restore it from the trash."}

    moteur.enregistrer(
        serveur,
        crm_track_trash,
        Declaration(famille="structure", action="supprimer", espace="track:track_id"),
        titre="Move a track to the trash (corbeille)",
        description="Moves a track, with its channels and affaires, to the trash; an administrator can restore it.",
        destructif=True,
    )

    async def crm_channel_trash(
        channel_id: Annotated[str, Field(description="The channel id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "channels", parametres={"id": f"eq.{channel_id}", "select": "id,name"},
            corps={"deleted_at": datetime.now(UTC).isoformat()},
        )
        return {"trashed": une_ligne(reponse, "channel", channel_id), "note": "An administrator can restore it from the trash."}

    moteur.enregistrer(
        serveur,
        crm_channel_trash,
        Declaration(famille="structure", action="supprimer", espace="channel:channel_id"),
        titre="Move a channel to the trash (corbeille)",
        description="Moves a channel, with its affaires, to the trash; an administrator can restore it.",
        destructif=True,
    )

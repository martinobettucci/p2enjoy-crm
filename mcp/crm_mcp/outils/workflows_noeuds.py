# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.d : le catalogue de nœuds, famille `workflows` (décisions 752, 754 et 756)
# @spec docs/SPEC-mcp.md §9.2 undecies (la liste T2.d ; `crm_channel_workflow_change` attend T1.b et n'est pas déclaré ;
#       le type d'un nœud se modifie, comme à l'écran), §9.1 (les tables de l'écran : `administration-catalogue.ts`),
#       §9.3 ; docs/SPEC-workflow-engine.md §2.2 (modèle), §2.3 (la clé stable, jamais modifiée), §2.4 (l'ordre, le milieu
#       de deux voisines), §2.5 (`0` n'est pas `null`), §2.6 (la garde d'un nœud occupé), §2 bis (l'écran), §2 ter
#       (le réordonnancement, archivés compris)
"""Le vocabulaire des workflows — le catalogue de nœuds —, écrit sous l'identité de la personne.

Chaque outil fait l'écriture que l'écran « Catalogue de nœuds » fait pour le même geste ; la base réserve ces écritures
à qui administre l'espace, et l'outil traduit son refus.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.workflows import position_apres, refus_workflow
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

COLONNES_NOEUD = "id,key,label,kind,color,default_probability,default_stale_after_days,position,archived_at"
TYPES = Literal["open", "won", "lost"]
COULEURS = Literal["brand", "success", "accent", "danger", "neutral"]
#: La garde du §2.6 partage son code (`42501`) avec le refus d'accès ; seul son message la distingue (§2 bis.5).
OCCUPE = re.compile(r"node_occupied\D*(\d+)")


def refus_noeud(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    occupe = OCCUPE.search(message)
    if occupe:
        return RefusCrm(f"Refusé par le CRM : node_occupied — {occupe.group(1)} active affaire(s) stand on steps of this "
                        "node; move them before archiving it.")
    if '"workflow_nodes_catalog_workspace_id_key_key"' in message:
        return RefusCrm("Refusé par le CRM : node_key_taken — this key is already used in the catalogue.")
    return refus_workflow(reponse, genre, valeur)


def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    if not reponse.reussie:
        raise refus_noeud(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def noeud_lu(n: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": n["id"], "key": n["key"], "label": n["label"], "kind": n.get("kind"), "color": n.get("color"),
        "default_probability": n.get("default_probability"), "default_stale_after_days": n.get("default_stale_after_days"),
        "position": n.get("position"), "archived": n.get("archived_at") is not None,
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, "workflow_nodes_catalog", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_noeud(reponse, genre, valeur)
        return reponse.corps

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_workflow_node_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        include_archived: Annotated[bool, Field(description="Also list archived nodes")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {"workspace_id": f"eq.{appel.espace}", "select": COLONNES_NOEUD, "order": "position.asc,label.asc"}
        if not include_archived:
            parametres["archived_at"] = "is.null"
        return {"nodes": [noeud_lu(n) for n in await lire(appel.jeton, parametres, "workspace", workspace)]}

    moteur.enregistrer(
        serveur,
        crm_workflow_node_list,
        Declaration(famille="workflows", action="consulter", espace="workspace:workspace"),
        titre="List the catalogue of nodes",
        description="Lists the nodes workflow steps are made from, in order: key, label, kind (open, won, lost), color, "
        "default probability and reminder threshold. A step instantiates a node; won and lost feed the conversion figures.",
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_workflow_node_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
        key: Annotated[str, Field(description="Lowercase letters, digits and single hyphens; never changes", min_length=1, max_length=100)],
        label: Annotated[str, Field(min_length=1, max_length=200)],
        kind: Annotated[TYPES, Field(description="open, won or lost")] = "open",
        color: Annotated[COULEURS, Field(description="One of the CRM's colors")] = "neutral",
        default_probability: Annotated[float | None, Field(ge=0, le=100)] = None,
        default_stale_after_days: Annotated[int | None, Field(ge=1)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        # Comme `creerNoeud` : la position à `null`, le trigger place le nœud en fin de catalogue (§2.4).
        reponse = await crm.ecrire(
            appel.jeton, "POST", "workflow_nodes_catalog", parametres={"select": COLONNES_NOEUD},
            corps={
                "workspace_id": appel.espace, "key": key.strip(), "label": label.strip(), "kind": kind, "color": color,
                "default_probability": default_probability, "default_stale_after_days": default_stale_after_days,
                "position": None,
            },
        )
        return {"node": noeud_lu(une_ligne(reponse, "workspace", workspace))}

    moteur.enregistrer(
        serveur,
        crm_workflow_node_create,
        Declaration(famille="workflows", action="ajouter", espace="workspace:workspace"),
        titre="Add a node to the catalogue",
        description="Adds a node to the catalogue, at the end: a key that never changes, a label, a kind, a color, an "
        "optional default probability and reminder threshold. Reserved to administrators.",
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_workflow_node_update(
        node_id: Annotated[str, Field(description="The node id, from crm_workflow_node_list")],
        label: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        kind: Annotated[TYPES | None, Field()] = None,
        color: Annotated[COULEURS | None, Field()] = None,
        default_probability: Annotated[float | None, Field(ge=0, le=100)] = None,
        default_stale_after_days: Annotated[int | None, Field(ge=1)] = None,
        reset: Annotated[
            list[Literal["default_probability", "default_stale_after_days"]] | None,
            Field(description="Defaults to clear: the node no longer states one"),
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        effaces = set(reset or [])
        corps: dict[str, Any] = {k: v for k, v in (("label", label.strip() if label else None), ("kind", kind), ("color", color))
                                 if v is not None}
        for colonne, valeur in (("default_probability", default_probability),
                                ("default_stale_after_days", default_stale_after_days)):
            if colonne in effaces and valeur is not None:
                raise ToolError(f"{colonne} is both given and reset; choose one.")
            if colonne in effaces:
                # Une valeur absente vaut « ne se prononce pas », jamais zéro (§2.5).
                corps[colonne] = None
            elif valeur is not None:
                corps[colonne] = valeur
        if not corps:
            raise ToolError("Give a field to change or one to reset; a node's key never changes.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_nodes_catalog", parametres={"id": f"eq.{node_id}", "select": COLONNES_NOEUD},
            corps=corps,
        )
        return {"node": noeud_lu(une_ligne(reponse, "node", node_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_node_update,
        Declaration(famille="workflows", action="modifier", espace="node:node_id"),
        titre="Update a catalogue node",
        description="Changes a node's label, kind, color or default probability and reminder threshold, as the catalogue "
        "screen does; the steps that instantiate it follow unless they override the value. Its key never changes.",
    )

    async def crm_workflow_node_move(
        node_id: Annotated[str, Field(description="The node to move")],
        after_node_id: Annotated[str | None, Field(description="Place it right after this node; omit to place it first")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if after_node_id == node_id:
            raise ToolError("A node cannot be placed after itself.")
        # La liste du calcul compte les nœuds archivés : ils occupent une place à l'œil (§2 ter.3).
        voisins = [n for n in await lire(appel.jeton, {
            "workspace_id": f"eq.{appel.espace}", "select": "id,position", "order": "position.asc,label.asc",
        }, "node", node_id) if n["id"] != node_id]
        rang = None
        if after_node_id is not None:
            rangs = [i for i, n in enumerate(voisins) if n["id"] == after_node_id]
            if not rangs:
                raise ToolError("after_node_id is not a node of the same catalogue.")
            rang = rangs[0]
        position = position_apres([float(n["position"]) for n in voisins], rang)
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_nodes_catalog", parametres={"id": f"eq.{node_id}", "select": COLONNES_NOEUD},
            corps={"position": position},
        )
        return {"node": noeud_lu(une_ligne(reponse, "node", node_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_node_move,
        Declaration(famille="workflows", action="modifier", espace="node:node_id", autres=("node:after_node_id",)),
        titre="Reorder a catalogue node",
        description="Moves a node in the catalogue's order, right after another node or first — the order of the conversion "
        "funnel.",
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_workflow_node_archive(
        node_id: Annotated[str, Field(description="The node id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_nodes_catalog", parametres={"id": f"eq.{node_id}", "select": COLONNES_NOEUD},
            corps={"archived_at": datetime.now(UTC).isoformat()},
        )
        return {
            "node": noeud_lu(une_ligne(reponse, "node", node_id)),
            "note": "An archived node can no longer be added as a step; existing steps keep it. An administrator can "
            "restore it in the web app.",
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_node_archive,
        Declaration(famille="workflows", action="supprimer", espace="node:node_id"),
        titre="Archive a catalogue node",
        description="Archives a node, as the catalogue screen does — a node is never deleted. The CRM refuses while active "
        "affaires stand on a step made from it.",
        destructif=True,
    )

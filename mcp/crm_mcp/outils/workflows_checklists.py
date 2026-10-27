# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.b, les points de checklist d'une étape, après l'éditeur de `CRM-068` T3b
#       (décisions 756, 759 et 761)
# @spec docs/SPEC-mcp.md §9.2 undecies (la liste T2.b : `crm_step_checklist_item_add` sous `ajouter`,
#       `crm_step_checklist_item_update` et `crm_transition_required_checklist_item_set` sous `modifier`,
#       `crm_step_checklist_item_archive` sous `supprimer` ; le genre d'ancre `checklist_item`), §9.3 ;
#       docs/SPEC-checklists.md §3.1 (l'archive : plus ajouté aux affaires qui entrent), §3.2 (un renommage ne touche pas
#       les points déjà copiés), §3.4 (seul un point de l'étape de départ s'exige), §4 ; docs/DESIGN_SYSTEM.md §5.70 bis
#       et §5.18 (la position d'un point ajouté compte les archivés ; un point archivé ne se déplace pas)
"""Les points de checklist d'une étape, et ceux qu'une transition exige, écrits sous l'identité de la personne.

Chaque outil fait l'écriture de `administration-checklists.ts`, la bibliothèque du bloc « Checklists des étapes » de
l'éditeur. La lecture est celle de `crm_workflow_form_get`. Désarchiver un point reste un geste de l'écran, comme
restaurer un champ.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.workflows import position_apres, refus_workflow
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

COLONNES_POINT = "id,workflow_id,step_id,label,position,archived_at"
#: La longueur d'un libellé, celle de `LONGUEUR_MAX_POINT_ETAPE` et de `workflow_step_checklist_items_label_check`.
LONGUEUR_MAX = 200


def refus_checklist(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Les refus de `classerRefusChecklistsWorkflow`, nommés pour le modèle ; le reste comme les autres écritures."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    code = corps.get("code")
    if code == "23514" and "workflow_step_checklist_items_label_check" in message:
        return RefusCrm(f"Refusé par le CRM : label — 1 to {LONGUEUR_MAX} characters.")
    if code == "22023" and message == "checklist_item_not_from_source_step":
        return RefusCrm(
            "Refusé par le CRM : checklist_item_not_from_source_step — a move can only require an item of its departure step."
        )
    if code == "23505":
        return RefusCrm("Refusé par le CRM : checklist_item_already_required — the move already requires this item.")
    return refus_workflow(reponse, genre, valeur)


def point_lu(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p["id"],
        "workflow_id": p.get("workflow_id"),
        "step_id": p.get("step_id"),
        "label": p.get("label"),
        "position": p.get("position"),
        "archived": p.get("archived_at") is not None,
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, table, parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_checklist(reponse, genre, valeur)
        return reponse.corps

    async def lire_point(jeton: str, item_id: str) -> dict[str, Any]:
        points = await lire(jeton, "workflow_step_checklist_items", {"id": f"eq.{item_id}", "select": COLONNES_POINT},
                            "checklist_item", item_id)
        if len(points) != 1:
            raise RefusCrm(introuvable("checklist_item", item_id))
        return points[0]

    def un_point(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
        """L'unique ligne touchée ; zéro ligne est le refus silencieux d'une politique (décision 70)."""
        if not reponse.reussie:
            raise refus_checklist(reponse, genre, valeur)
        lignes = reponse.corps if isinstance(reponse.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable(genre, valeur))
        return lignes[0]

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_step_checklist_item_add(
        step_id: Annotated[str, Field(description="The step id, from crm_workflow_get or crm_workflow_form_get")],
        label: Annotated[str, Field(min_length=1, max_length=LONGUEUR_MAX)],
    ) -> dict[str, Any]:
        appel = appel_courant()
        if not label.strip():
            raise ToolError("The label cannot be blank.")
        etapes = await lire(appel.jeton, "workflow_steps", {"id": f"eq.{step_id}", "select": "id,workflow_id"}, "step", step_id)
        if len(etapes) != 1:
            raise RefusCrm(introuvable("step", step_id))
        # `positionNouveauPoint` : après le dernier point de l'étape, archivés compris — ils occupent leur place (§5.18).
        points = await lire(appel.jeton, "workflow_step_checklist_items",
                            {"step_id": f"eq.{step_id}", "select": "position"}, "step", step_id)
        position = max([0.0, *(float(p["position"]) for p in points)]) + 1
        reponse = await crm.ecrire(
            appel.jeton, "POST", "workflow_step_checklist_items", parametres={"select": COLONNES_POINT},
            corps={"workspace_id": appel.espace, "workflow_id": etapes[0]["workflow_id"], "step_id": step_id,
                   "label": label.strip(), "position": position},
        )
        return {
            "checklist_item": point_lu(un_point(reponse, "step", step_id)),
            "note": "Affaires entering this step from now on get the item; those already there do not.",
        }

    moteur.enregistrer(
        serveur,
        crm_step_checklist_item_add,
        Declaration(famille="workflows", action="ajouter", espace="step:step_id"),
        titre="Add a checklist item to a workflow step",
        description=(
            "Adds a checklist item at the end of a step's checklist, as the editor's « Checklists des étapes » block does. "
            "Affaires that enter the step afterwards receive it. Reserved by the CRM to workspace administrators."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_step_checklist_item_update(
        item_id: Annotated[str, Field(description="The step checklist item id, from crm_workflow_form_get")],
        label: Annotated[str | None, Field(description="The new label", min_length=1, max_length=LONGUEUR_MAX)] = None,
        after_item_id: Annotated[
            str | None, Field(description="Move it right after this item of the same step")
        ] = None,
        move_to_top: Annotated[bool, Field(description="Move it first in its step")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if label is None and after_item_id is None and not move_to_top:
            raise ToolError("Give a new label, after_item_id, or move_to_top.")
        if after_item_id is not None and move_to_top:
            raise ToolError("after_item_id and move_to_top are exclusive; choose one.")
        corps: dict[str, Any] = {}
        if label is not None:
            if not label.strip():
                raise ToolError("The label cannot be blank.")
            # Les points déjà copiés sur les affaires gardent leur libellé (docs/SPEC-checklists.md §3.2).
            corps["label"] = label.strip()
        if after_item_id is not None or move_to_top:
            if after_item_id == item_id:
                raise ToolError("An item cannot be placed after itself.")
            point = await lire_point(appel.jeton, item_id)
            if point.get("archived_at") is not None:
                raise ToolError("An archived item does not move (it keeps its place).")
            # `deplacementPoint` : parmi les points NON archivés de l'étape, le point déplacé retiré.
            voisins = [
                p for p in await lire(appel.jeton, "workflow_step_checklist_items", {
                    "step_id": f"eq.{point['step_id']}", "archived_at": "is.null", "select": "id,position",
                    "order": "position.asc",
                }, "checklist_item", item_id)
                if p["id"] != item_id
            ]
            rang = None
            if after_item_id is not None:
                rangs = [i for i, p in enumerate(voisins) if p["id"] == after_item_id]
                if not rangs:
                    raise ToolError("after_item_id is not an active item of the same step.")
                rang = rangs[0]
            corps["position"] = position_apres([float(p["position"]) for p in voisins], rang)
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_step_checklist_items",
            parametres={"id": f"eq.{item_id}", "select": COLONNES_POINT}, corps=corps,
        )
        return {"checklist_item": point_lu(un_point(reponse, "checklist_item", item_id))}

    moteur.enregistrer(
        serveur,
        crm_step_checklist_item_update,
        Declaration(famille="workflows", action="modifier", espace="checklist_item:item_id",
                    autres=("checklist_item:after_item_id",)),
        titre="Rename or reorder a step checklist item",
        description=(
            "Renames a step's checklist item, and/or moves it in its step's order. Items already copied onto affaires keep "
            "their former label. An archived item does not move."
        ),
    )

    async def crm_transition_required_checklist_item_set(
        transition_id: Annotated[str, Field(description="The move (transition) id")],
        item_id: Annotated[str, Field(description="A checklist item of the move's departure step")],
        required: Annotated[bool, Field(description="true: the move requires the item checked; false: it no longer does")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        if required:
            # `exigerPoint` : un `POST` simple ; la base refuse un point d'une autre étape que celle de départ (§3.4).
            reponse = await crm.ecrire(
                appel.jeton, "POST", "workflow_transition_required_checklist_items",
                parametres={"select": "transition_id,step_item_id"},
                corps={"transition_id": transition_id, "step_item_id": item_id},
            )
            un_point(reponse, "transition", transition_id)
        else:
            reponse = await crm.ecrire(
                appel.jeton, "DELETE", "workflow_transition_required_checklist_items",
                parametres={"transition_id": f"eq.{transition_id}", "step_item_id": f"eq.{item_id}",
                            "select": "transition_id"},
            )
            if not reponse.reussie:
                raise refus_checklist(reponse, "transition", transition_id)
            if not (isinstance(reponse.corps, list) and reponse.corps):
                raise RefusCrm("Refusé par le CRM : not_required — the move does not require this item, or you may not "
                               "change it.")
        return {"transition_id": transition_id, "checklist_item_id": item_id, "required": required}

    moteur.enregistrer(
        serveur,
        crm_transition_required_checklist_item_set,
        Declaration(famille="workflows", action="modifier", espace="transition:transition_id",
                    autres=("checklist_item:item_id",)),
        titre="Require a checklist item for a move, or stop requiring it",
        description=(
            "Makes a move (transition) require a checklist item of its departure step to be checked, or stops requiring "
            "it — a setting of the move. An affaire then cannot take the move until the item is checked."
        ),
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_step_checklist_item_archive(
        item_id: Annotated[str, Field(description="The step checklist item id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_step_checklist_items",
            parametres={"id": f"eq.{item_id}", "select": COLONNES_POINT},
            corps={"archived_at": datetime.now(UTC).isoformat()},
        )
        return {
            "checklist_item": point_lu(un_point(reponse, "checklist_item", item_id)),
            "note": "Affaires entering the step no longer get it; a move that required it still does. Unarchiving is done "
                    "on screen.",
        }

    moteur.enregistrer(
        serveur,
        crm_step_checklist_item_archive,
        Declaration(famille="workflows", action="supprimer", espace="checklist_item:item_id"),
        titre="Archive a step checklist item",
        description=(
            "Archives a step's checklist item: affaires entering the step no longer receive it; items already on affaires "
            "stay. A move that required it keeps requiring it until told otherwise. Unarchiving is done on screen."
        ),
        destructif=True,
    )

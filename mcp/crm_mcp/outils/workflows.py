# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.a : la famille `workflows`, le workflow, ses étapes et ses transitions
#       (décisions 752, 754 et 756)
# @spec docs/SPEC-mcp.md §9.2 undecies (la liste fixée T2.a, ses ancres, ses refus nommés ; le connecteur suit strictement
#       l'écran : `crm_workflow_update` et `crm_workflow_archive` attendent T1.b), §9.1 (les tables de la webapp :
#       `administration-workflows.ts`, `demarrage.ts`), §9.3 ; docs/SPEC-workflow-engine.md §3.2 à §3.7 (modèle,
#       étape initiale, ordre, écriture réservée à l'administrateur, étape occupée), §3 bis (création), §7 bis.4 et
#       §7 bis.9 (les gestes de l'éditeur), §7 quater (le workflow de départ) ; docs/SPEC-administration-arborescence.md
#       §6.2 (le déplacement en une écriture, le milieu de deux voisines)
"""Le workflow, ses étapes et ses transitions, écrits sous l'identité de la personne.

Chaque outil fait l'écriture que l'éditeur de workflows de la webapp fait pour le même geste ; la base réserve ces
écritures à qui administre l'espace, et l'outil traduit son refus. La lecture de la composition reste à `structure`
(`crm_workflow_get`, décision 754).
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

COLONNES_WORKFLOW = "id,name,scope,track_id,is_default,archived_at,derived_from_workflow_id,track:tracks(name)"
COLONNES_ETAPE = (
    "id,workflow_id,position,is_initial,label_override,probability_override,stale_after_days,"
    "noeud:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(key,label,kind)"
)
COLONNES_TRANSITION = "id,workflow_id,from_step_id,to_step_id,label,require_comment"

#: Les unicités et les clés étrangères que la base oppose à une écriture de workflow, et ce qu'elles veulent dire
#: (docs/SPEC-workflow-engine.md §3.3 à §3.5, mesurés par `CRM-031`).
CONTRAINTES_NOMMEES = {
    "workflow_steps_workflow_id_node_id_key": "node_already_in_workflow — this node is already a step of the workflow.",
    "workflow_steps_workflow_initial_uk": "initial_step_exists — the workflow already has its initial step.",
    "workflow_transitions_workflow_from_to_key": "transition_already_declared — this move is already declared.",
    "workflow_transitions_from_step_fkey": "step_outside_workflow — both steps must belong to this workflow.",
    "workflow_transitions_to_step_fkey": "step_outside_workflow — both steps must belong to this workflow.",
    "workflow_transitions_distinct_check": "same_step — a move goes from one step to another one.",
    "workflows_scope_track_check": "workflows_scope_track_check — scope `track` needs track_id; scope `global` takes none.",
}
#: Une étape que des affaires occupent : la clé étrangère de leurs rattachements refuse le retrait (§3.7).
OCCUPATION = re.compile(r'on table "(card_placements|cards)"')


def refus_workflow(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Les refus d'une écriture de workflow, nommés ; le reste comme partout (`refus`)."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    code = corps.get("code")
    if code == "23503" and OCCUPATION.search(message):
        return RefusCrm("Refusé par le CRM : step_occupied — affaires stand on this step; move them before removing it.")
    for contrainte, phrase in CONTRAINTES_NOMMEES.items():
        if f'"{contrainte}"' in message:
            return RefusCrm(f"Refusé par le CRM : {phrase}")
    contrainte = re.search(r'constraint "([a-z_]+_check)"', message)
    if code == "23514" and contrainte:
        return RefusCrm(f"Refusé par le CRM : {contrainte.group(1)} — a value is not allowed.")
    if message == "workflow existant":
        return RefusCrm("Refusé par le CRM : workflow_exists — the workspace already has a workflow; create one by name.")
    archive = re.fullmatch(r"noeud archive : (.+)", message)
    if archive:
        return RefusCrm(f"Refusé par le CRM : node_archived — the catalogue node `{archive.group(1)}` is archived.")
    return refus(reponse, genre, valeur)


def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    """L'unique ligne touchée ; zéro ligne est le refus silencieux d'une politique, rendu comme le refus uniforme."""
    if not reponse.reussie:
        raise refus_workflow(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def workflow_lu(w: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": w["id"],
        "name": w["name"],
        "scope": w.get("scope"),
        "track": {"id": w.get("track_id"), "name": (w.get("track") or {}).get("name")} if w.get("track_id") else None,
        "default": w.get("is_default") is True,
        "archived": w.get("archived_at") is not None,
        "copied_from_workflow_id": w.get("derived_from_workflow_id"),
    }


def etape_lue(e: dict[str, Any]) -> dict[str, Any]:
    noeud = e.get("noeud") or {}
    return {
        "id": e["id"],
        "workflow_id": e.get("workflow_id"),
        "node": {"key": noeud.get("key"), "label": noeud.get("label"), "kind": noeud.get("kind")},
        # La surcharge prime sur le libellé du nœud ; absente, c'est celui du catalogue (§3.3).
        "name": e.get("label_override") or noeud.get("label"),
        "position": e.get("position"),
        "initial": e.get("is_initial") is True,
        "overrides": {
            "label": e.get("label_override"),
            "probability": e.get("probability_override"),
            "stale_after_days": e.get("stale_after_days"),
        },
    }


def transition_lue(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t["id"],
        "workflow_id": t.get("workflow_id"),
        "from_step_id": t.get("from_step_id"),
        "to_step_id": t.get("to_step_id"),
        "label": t.get("label"),
        "requires_comment": t.get("require_comment") is True,
    }


def position_apres(positions: list[float], rang: int | None) -> float:
    """La position qui place une étape juste après celle de rang `rang` (en tête si `None`), l'étape déplacée retirée
    de la liste : le milieu de deux voisines, une écriture, jamais une permutation — le calcul de
    `calculerDeplacement` (docs/SPEC-administration-arborescence.md §6.2). Une position que l'arithmétique ne peut pas
    distinguer de ses voisines est refusée plutôt qu'écrite sans effet (`CLAUDE.md` §18)."""
    if rang is None:
        if not positions:
            raise ToolError("Nothing to reorder: the step is alone in its workflow.")
        premiere = positions[0]
        if premiere <= 0:
            raise RefusCrm("Refusé par le CRM : positions_indistinct — no position is free before the first step.")
        return premiere / 2
    avant = positions[rang]
    if rang + 1 >= len(positions):
        # En queue : l'incrément du trigger d'insertion, plutôt qu'un pas inventé.
        return avant + 1
    apres = positions[rang + 1]
    milieu = (avant + apres) / 2
    if not (avant < milieu < apres):
        raise RefusCrm("Refusé par le CRM : positions_indistinct — the two neighbouring steps share their position.")
    return milieu


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, table, parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_workflow(reponse, genre, valeur)
        return reponse.corps

    async def lire_etape(jeton: str, step_id: str) -> dict[str, Any]:
        etapes = await lire(jeton, "workflow_steps", {"id": f"eq.{step_id}", "select": COLONNES_ETAPE}, "step", step_id)
        if len(etapes) != 1:
            raise RefusCrm(introuvable("step", step_id))
        return etapes[0]

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_workflow_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        include_archived: Annotated[bool, Field(description="Also list archived workflows")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {"workspace_id": f"eq.{appel.espace}", "select": COLONNES_WORKFLOW, "order": "is_default.desc,name.asc"}
        if not include_archived:
            parametres["archived_at"] = "is.null"
        workflows = await lire(appel.jeton, "workflows", parametres, "workspace", workspace)
        return {"workflows": [workflow_lu(w) for w in workflows]}

    moteur.enregistrer(
        serveur,
        crm_workflow_list,
        Declaration(famille="workflows", action="consulter", espace="workspace:workspace"),
        titre="List workflows",
        description=(
            "Lists the workflows of a workspace, the default one first: scope (global or one track), default, archived, "
            "and the workflow a copy came from. Read one with crm_workflow_get."
        ),
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_workflow_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
        name: Annotated[str, Field(min_length=1, max_length=200)],
        scope: Annotated[Literal["global", "track"], Field(description="global: any track; track: one track only")] = "global",
        track_id: Annotated[str | None, Field(description="The track, required when scope is track")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "workflows",
            parametres={"select": COLONNES_WORKFLOW},
            # Comme `creerWorkflow` : le nom `trim`é, le track oublié sous `global`, `is_default` jamais envoyé (§3 bis).
            corps={
                "workspace_id": appel.espace, "name": name.strip(), "scope": scope,
                "track_id": track_id if scope == "track" else None,
            },
        )
        return {
            "workflow": workflow_lu(une_ligne(reponse, "workspace", workspace)),
            "note": "A new workflow has no step: add steps (crm_workflow_step_add), mark one initial, then declare moves.",
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_create,
        Declaration(famille="workflows", action="ajouter", espace="workspace:workspace", autres=("track:track_id",)),
        titre="Create a workflow",
        description=(
            "Creates an empty workflow, global or for one track, as the workflow editor does. It is a draft until it has "
            "steps and an initial step. Reserved by the CRM to workspace administrators."
        ),
    )

    async def crm_workflow_starter_create(
        workspace: Annotated[str, Field(description="Workspace id or slug")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "creer_workflow_de_depart", {"p_workspace": appel.espace})
        if not reponse.reussie:
            raise refus_workflow(reponse, "workspace", workspace)
        return {"workflow_id": reponse.corps, "note": "The seven-step sales cycle, with its catalogue nodes and moves."}

    moteur.enregistrer(
        serveur,
        crm_workflow_starter_create,
        Declaration(famille="workflows", action="ajouter", espace="workspace:workspace"),
        titre="Create the starter workflow (workflow de départ)",
        description=(
            "Creates the ready-made sales cycle (seven steps, from Prospection to Livré and Perdu) in a workspace that has "
            "no workflow yet, as the getting-started panel does. Reserved to administrators."
        ),
    )

    async def crm_workflow_step_add(
        workflow_id: Annotated[str, Field(description="The workflow id, from crm_workflow_list")],
        node_id: Annotated[str, Field(description="The catalogue node the step instantiates")],
        label: Annotated[str | None, Field(description="Overrides the node's label", max_length=200)] = None,
        probability: Annotated[float | None, Field(description="Overrides the node's probability", ge=0, le=100)] = None,
        stale_after_days: Annotated[int | None, Field(description="Overrides the node's reminder threshold", ge=1)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {"workflow_id": workflow_id, "workspace_id": appel.espace, "node_id": node_id}
        # La position est omise : le trigger place l'étape en fin de workflow (§3.6), comme `ajouterEtape`.
        for colonne, valeur in (("label_override", label.strip() if label else None),
                                ("probability_override", probability), ("stale_after_days", stale_after_days)):
            if valeur is not None:
                corps[colonne] = valeur
        reponse = await crm.ecrire(appel.jeton, "POST", "workflow_steps", parametres={"select": COLONNES_ETAPE}, corps=corps)
        return {"step": etape_lue(une_ligne(reponse, "workflow", workflow_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_step_add,
        Declaration(famille="workflows", action="ajouter", espace="workflow:workflow_id", autres=("node:node_id",)),
        titre="Add a step to a workflow",
        description=(
            "Adds a step at the end of a workflow from a catalogue node, optionally overriding its label, probability or "
            "reminder threshold. A node appears once per workflow."
        ),
    )

    async def crm_workflow_transition_add(
        workflow_id: Annotated[str, Field(description="The workflow id")],
        from_step_id: Annotated[str, Field(description="The departure step")],
        to_step_id: Annotated[str, Field(description="The arrival step")],
        label: Annotated[str | None, Field(description="The move's button label", max_length=200)] = None,
        require_comment: Annotated[bool, Field(description="The move demands a reason (motif)")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "workflow_transitions",
            parametres={"select": COLONNES_TRANSITION},
            corps={
                "workflow_id": workflow_id, "workspace_id": appel.espace, "from_step_id": from_step_id,
                "to_step_id": to_step_id, "label": label.strip() if label and label.strip() else None,
                "require_comment": require_comment,
            },
        )
        return {"transition": transition_lue(une_ligne(reponse, "workflow", workflow_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_transition_add,
        Declaration(
            famille="workflows", action="ajouter", espace="workflow:workflow_id",
            autres=("step:from_step_id", "step:to_step_id"),
        ),
        titre="Declare a move between two steps",
        description=(
            "Declares a move (transition) from one step to another of the same workflow: only declared moves let an "
            "affaire change step. Optionally a button label and a required reason."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_workflow_step_update(
        step_id: Annotated[str, Field(description="The step id, from crm_workflow_get")],
        label: Annotated[str | None, Field(description="New label override", min_length=1, max_length=200)] = None,
        probability: Annotated[float | None, Field(description="New probability override", ge=0, le=100)] = None,
        stale_after_days: Annotated[int | None, Field(description="New reminder threshold override", ge=1)] = None,
        reset: Annotated[
            list[Literal["label", "probability", "stale_after_days"]] | None,
            Field(description="Overrides to drop: the step takes the catalogue node's value again"),
        ] = None,
        make_initial: Annotated[bool, Field(description="Make this the workflow's initial step")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        effaces = set(reset or [])
        corps: dict[str, Any] = {}
        for nom, colonne, valeur in (("label", "label_override", label), ("probability", "probability_override", probability),
                                     ("stale_after_days", "stale_after_days", stale_after_days)):
            if nom in effaces and valeur is not None:
                raise ToolError(f"{nom} is both given and reset; choose one.")
            if nom in effaces:
                # `null` n'est pas `0` : il rend la valeur du catalogue (§2.5).
                corps[colonne] = None
            elif valeur is not None:
                corps[colonne] = valeur.strip() if isinstance(valeur, str) else valeur
        if not corps and not make_initial:
            raise ToolError("Give an override to change, one to reset, or make_initial.")
        if corps:
            reponse = await crm.ecrire(
                appel.jeton, "PATCH", "workflow_steps", parametres={"id": f"eq.{step_id}", "select": "id"}, corps=corps
            )
            une_ligne(reponse, "step", step_id)
        if make_initial:
            etape = await lire_etape(appel.jeton, step_id)
            # `designerEtapeInitiale` : éteindre d'abord, allumer ensuite — le seul ordre qui ne heurte jamais l'index
            # « au plus une initiale » (§3.5). Zéro ligne éteinte est un succès : aucune n'était initiale.
            eteinte = await crm.ecrire(
                appel.jeton, "PATCH", "workflow_steps",
                parametres={"workflow_id": f"eq.{etape['workflow_id']}", "is_initial": "is.true", "select": "id"},
                corps={"is_initial": False},
            )
            if not eteinte.reussie:
                raise refus_workflow(eteinte, "step", step_id)
            allumee = await crm.ecrire(
                appel.jeton, "PATCH", "workflow_steps", parametres={"id": f"eq.{step_id}", "select": "id"},
                corps={"is_initial": True},
            )
            une_ligne(allumee, "step", step_id)
        return {"step": etape_lue(await lire_etape(appel.jeton, step_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_step_update,
        Declaration(famille="workflows", action="modifier", espace="step:step_id"),
        titre="Update a step",
        description=(
            "Changes a step's label, probability or reminder threshold overrides, drops some of them (reset) so the "
            "catalogue node's value applies, or makes it the initial step — the step a new affaire starts on."
        ),
    )

    async def crm_workflow_step_move(
        step_id: Annotated[str, Field(description="The step to move")],
        after_step_id: Annotated[str | None, Field(description="Place it right after this step; omit to place it first")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if after_step_id == step_id:
            raise ToolError("A step cannot be placed after itself.")
        etape = await lire_etape(appel.jeton, step_id)
        voisines = [
            e for e in await lire(
                appel.jeton, "workflow_steps",
                {"workflow_id": f"eq.{etape['workflow_id']}", "select": "id,position", "order": "position.asc"},
                "step", step_id,
            )
            if e["id"] != step_id
        ]
        rang = None
        if after_step_id is not None:
            rangs = [i for i, e in enumerate(voisines) if e["id"] == after_step_id]
            if not rangs:
                raise ToolError("after_step_id is not a step of the same workflow.")
            rang = rangs[0]
        position = position_apres([float(e["position"]) for e in voisines], rang)
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_steps", parametres={"id": f"eq.{step_id}", "select": COLONNES_ETAPE},
            corps={"position": position},
        )
        return {"step": etape_lue(une_ligne(reponse, "step", step_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_step_move,
        Declaration(famille="workflows", action="modifier", espace="step:step_id", autres=("step:after_step_id",)),
        titre="Reorder a step",
        description=(
            "Moves a step in the board's column order, right after another step or first. The order is display only: "
            "only declared moves let an affaire change step."
        ),
    )

    async def crm_workflow_transition_update(
        transition_id: Annotated[str, Field(description="The transition id")],
        label: Annotated[str | None, Field(description="New button label; empty string clears it", max_length=200)] = None,
        require_comment: Annotated[bool | None, Field(description="Whether the move demands a reason")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {}
        if label is not None:
            corps["label"] = label.strip() or None
        if require_comment is not None:
            corps["require_comment"] = require_comment
        if not corps:
            raise ToolError("Give label and/or require_comment; a move's steps never change — remove it and declare another.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflow_transitions",
            parametres={"id": f"eq.{transition_id}", "select": COLONNES_TRANSITION}, corps=corps,
        )
        return {"transition": transition_lue(une_ligne(reponse, "transition", transition_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_transition_update,
        Declaration(famille="workflows", action="modifier", espace="transition:transition_id"),
        titre="Update a move",
        description="Changes a move's button label or whether it demands a reason. Its departure and arrival never change.",
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_workflow_step_remove(
        step_id: Annotated[str, Field(description="The step id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "DELETE", "workflow_steps", parametres={"id": f"eq.{step_id}", "select": "id"}
        )
        return {
            "removed": une_ligne(reponse, "step", step_id),
            "note": "The step and the moves to and from it are removed; this cannot be undone.",
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_step_remove,
        Declaration(famille="workflows", action="supprimer", espace="step:step_id"),
        titre="Remove a step from a workflow",
        description=(
            "Removes a step and every move to or from it, for good — a step has no trash. The CRM refuses while affaires "
            "stand on it."
        ),
        destructif=True,
    )

    async def crm_workflow_transition_remove(
        transition_id: Annotated[str, Field(description="The transition id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "DELETE", "workflow_transitions", parametres={"id": f"eq.{transition_id}", "select": "id"}
        )
        return {"removed": une_ligne(reponse, "transition", transition_id), "note": "This cannot be undone."}

    moteur.enregistrer(
        serveur,
        crm_workflow_transition_remove,
        Declaration(famille="workflows", action="supprimer", espace="transition:transition_id"),
        titre="Remove a move",
        description="Removes a declared move, for good: affaires can no longer go from its departure to its arrival.",
        destructif=True,
    )

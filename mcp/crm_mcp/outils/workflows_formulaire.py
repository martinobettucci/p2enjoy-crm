# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.b : le formulaire d'un workflow, la visibilité de ses champs étape par
#       étape et les exigences de ses transitions, famille `workflows` (décisions 752, 754 et 756)
# @spec docs/SPEC-mcp.md §9.2 undecies (la liste T2.b, ses ancres ; les outils de checklist d'étape vivent dans
#       `workflows_checklists.py` ; exiger ou ne plus exiger relève de `modifier`), §9.1 (les tables de l'éditeur :
#       `administration-workflows.ts`), §9.3 ; docs/SPEC-workflow-engine.md §7 bis.10 (les champs : déclarer, modifier,
#       déplacer, archiver ; ni la clé ni le type), §7 bis.11 (la grille champ × étape : régler par `upsert`, rendre au
#       défaut par retrait), §7 bis.12 (exiger un champ pour une transition : `POST` simple, retrait), §7 bis.13 (la
#       prévisualisation des effets) ; docs/SPEC-form-composer.md §2.2 à §2.7, §3.1 à §3.3 ;
#       docs/SPEC-transition-required-fields.md §1, §2, §4
"""Le formulaire d'un workflow, écrit sous l'identité de la personne.

Chaque outil fait l'écriture que l'éditeur de workflows fait pour le même geste ; la base réserve ces écritures à qui
administre l'espace, et l'outil traduit son refus.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.workflows import position_apres, refus_workflow
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

#: Les quinze types d'un champ (docs/SPEC-form-composer.md §2.3), dans l'ordre du sélecteur de l'éditeur.
TYPES_CHAMP = Literal[
    "text", "textarea", "number", "money", "date", "datetime", "select", "multiselect", "checkbox", "url", "email",
    "phone", "user", "contact", "file",
]
TYPES_A_CHOIX = ("select", "multiselect")
COLONNES_CHAMP = "id,workflow_id,key,label,type,options,help_text,position,archived_at"

#: Les refus propres au formulaire (docs/SPEC-workflow-engine.md §7 bis.10.5, §7 bis.11.5, §7 bis.12.5).
CONTRAINTES_FORMULAIRE = {
    "form_fields_workflow_id_key_key": "field_key_taken — this key is already used by a field of the workflow.",
    "workflow_transition_required_fields_pkey": "already_required — this move already requires this field.",
    "form_field_rules_step_id_workflow_id_fkey": "step_outside_workflow — the field and the step must belong to the "
    "same workflow.",
    "form_field_rules_field_id_workflow_id_fkey": "step_outside_workflow — the field and the step must belong to the "
    "same workflow.",
}
MESSAGES_FORMULAIRE = {
    "required_field_workflow_mismatch": "required_field_workflow_mismatch — the field and the move must belong to the "
    "same workflow.",
    "previsualisation_cible": "preview_target — give exactly one of step_id or transition_id.",
}


class Choix(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)


def refus_formulaire(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    for contrainte, phrase in CONTRAINTES_FORMULAIRE.items():
        if f'"{contrainte}"' in message:
            return RefusCrm(f"Refusé par le CRM : {phrase}")
    if message in MESSAGES_FORMULAIRE:
        return RefusCrm(f"Refusé par le CRM : {MESSAGES_FORMULAIRE[message]}")
    return refus_workflow(reponse, genre, valeur)


def une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    if not reponse.reussie:
        raise refus_formulaire(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def options_du_type(type_: str, choix: list[Choix] | None, devise: str | None) -> dict[str, Any]:
    """L'objet `options` selon le type, comme `composerOptions` : les choix d'un champ à choix, la devise d'un montant,
    `{}` sinon. Les choix sont vérifiés comme l'éditeur les vérifie (`refusDesChoix`) : la base n'exige qu'un tableau
    non vide, et la forme `{key, label}` comme l'unicité des clés ne sont tenues que par ce contrôle (§7 bis.10.4)."""
    if type_ in TYPES_A_CHOIX:
        if not choix:
            raise ToolError(f"A {type_} field needs choices: a non-empty list of {{key, label}}.")
        cles = [c.key.strip() for c in choix]
        if any(not c for c in cles) or any(not c.label.strip() for c in choix):
            raise ToolError("Every choice needs a non-blank key and label.")
        if len(set(cles)) != len(cles):
            raise ToolError("Two choices share the same key.")
        return {"choices": [{"key": c.key.strip(), "label": c.label.strip()} for c in choix]}
    if choix:
        raise ToolError(f"A {type_} field takes no choices.")
    if type_ == "money":
        if not devise or not devise.strip():
            raise ToolError("A money field needs its currency, three letters such as EUR.")
        return {"currency": devise.strip().upper()}
    if devise:
        raise ToolError(f"A {type_} field takes no currency.")
    return {}


def champ_lu(c: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": c["id"],
        "key": c["key"],
        "label": c["label"],
        "type": c["type"],
        "options": c.get("options") or {},
        "help_text": c.get("help_text"),
        "position": c.get("position"),
        "archived": c.get("archived_at") is not None,
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def lire(jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(jeton, table, parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_formulaire(reponse, genre, valeur)
        return reponse.corps

    async def lire_champ(jeton: str, field_id: str) -> dict[str, Any]:
        champs = await lire(jeton, "form_fields", {"id": f"eq.{field_id}", "select": COLONNES_CHAMP + ",workspace_id"},
                            "field", field_id)
        if len(champs) != 1:
            raise RefusCrm(introuvable("field", field_id))
        return champs[0]

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_workflow_form_get(
        workflow_id: Annotated[str, Field(description="The workflow id, from crm_workflow_list")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        filtre = {"workflow_id": f"eq.{workflow_id}"}
        workflows = await lire(appel.jeton, "workflows", {"id": f"eq.{workflow_id}", "select": "id,name"}, "workflow",
                               workflow_id)
        if len(workflows) != 1:
            raise RefusCrm(introuvable("workflow", workflow_id))
        etapes = await lire(appel.jeton, "workflow_steps", {
            **filtre, "order": "position.asc",
            "select": "id,label_override,noeud:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(label)",
        }, "workflow", workflow_id)
        champs = await lire(appel.jeton, "form_fields", {**filtre, "select": COLONNES_CHAMP, "order": "position.asc"},
                            "workflow", workflow_id)
        regles = await lire(appel.jeton, "form_field_rules", {**filtre, "select": "field_id,step_id,visibility"},
                            "workflow", workflow_id)
        transitions = await lire(appel.jeton, "workflow_transitions", {
            **filtre, "select": "id,from_step_id,to_step_id,label",
        }, "workflow", workflow_id)
        points = await lire(appel.jeton, "workflow_step_checklist_items", {
            **filtre, "select": "id,step_id,label,position,archived_at", "order": "position.asc",
        }, "workflow", workflow_id)
        exiges: list[dict[str, Any]] = []
        points_exiges: list[dict[str, Any]] = []
        if transitions:
            ids = "in.(" + ",".join(str(t["id"]) for t in transitions) + ")"
            exiges = await lire(appel.jeton, "workflow_transition_required_fields",
                                {"transition_id": ids, "select": "transition_id,field_id"}, "workflow", workflow_id)
            points_exiges = await lire(appel.jeton, "workflow_transition_required_checklist_items",
                                       {"transition_id": ids, "select": "transition_id,step_item_id"}, "workflow",
                                       workflow_id)
        visibilite = {(str(r["field_id"]), str(r["step_id"])): r["visibility"] for r in regles}
        return {
            "workflow": {"id": workflows[0]["id"], "name": workflows[0]["name"]},
            "steps": [
                {
                    "id": e["id"],
                    "name": e.get("label_override") or (e.get("noeud") or {}).get("label"),
                    "checklist_items": [
                        {"id": p["id"], "label": p["label"], "archived": p.get("archived_at") is not None}
                        for p in points if p.get("step_id") == e["id"]
                    ],
                }
                for e in etapes
            ],
            "fields": [
                {
                    **champ_lu(c),
                    # Une case sans règle vaut « default » : le champ suit sa visibilité par défaut (§3.1 du composeur).
                    "visibility_by_step": {
                        str(e["id"]): visibilite.get((str(c["id"]), str(e["id"])), "default") for e in etapes
                    },
                }
                for c in champs
            ],
            "transitions": [
                {
                    "id": t["id"], "from_step_id": t["from_step_id"], "to_step_id": t["to_step_id"], "label": t.get("label"),
                    "required_field_ids": [x["field_id"] for x in exiges if x["transition_id"] == t["id"]],
                    "required_checklist_item_ids": [x["step_item_id"] for x in points_exiges if x["transition_id"] == t["id"]],
                }
                for t in transitions
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_form_get,
        Declaration(famille="workflows", action="consulter", espace="workflow:workflow_id"),
        titre="Read a workflow's form",
        description=(
            "Reads a workflow's form as the workflow editor shows it: every field, archived ones included, each field's "
            "visibility at each step (hidden, visible, required, or default), the fields and checklist items each move "
            "requires, and each step's checklist items."
        ),
    )

    async def crm_transition_requirement_preview(
        field_id: Annotated[str, Field(description="The field you consider requiring")],
        step_id: Annotated[str | None, Field(description="Required at this step (give this or transition_id)")] = None,
        transition_id: Annotated[str | None, Field(description="Required by this move (give this or step_id)")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if (step_id is None) == (transition_id is None):
            raise ToolError("Give exactly one of step_id or transition_id.")
        arguments: dict[str, Any] = {"p_field_id": field_id}
        arguments["p_step_id" if step_id is not None else "p_transition_id"] = step_id or transition_id
        reponse = await crm.rpc(appel.jeton, "previsualiser_exigence", arguments, idempotent=True)
        lignes = reponse.corps if isinstance(reponse.corps, list) else []
        if not reponse.reussie or len(lignes) != 1:
            # Un compte qui n'a pas pu être fait n'est jamais un zéro rassurant (§7 bis.13.4).
            raise refus_formulaire(reponse, "field", field_id) if not reponse.reussie else ToolError(
                "The CRM could not measure the effect.")
        return {
            "affaires_already_there": int(lignes[0]["sur_place"]),
            "affaires_blocked_at_entry": int(lignes[0]["a_l_entree"]),
            "note": "Affaires already at the step keep their place but show the missing answer; the others cannot enter "
            "until the field is answered.",
        }

    moteur.enregistrer(
        serveur,
        crm_transition_requirement_preview,
        Declaration(
            famille="workflows", action="consulter", espace="field:field_id",
            autres=("step:step_id", "transition:transition_id"),
        ),
        titre="Preview what requiring a field would do",
        description=(
            "Counts the current affaires a requirement would affect — those already at the step, and those that could no "
            "longer enter it — before you make a field required at a step or by a move. Changes nothing."
        ),
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_form_field_add(
        workflow_id: Annotated[str, Field(description="The workflow id")],
        key: Annotated[str, Field(description="Lowercase letters, digits and single hyphens; never changes", min_length=1, max_length=100)],
        label: Annotated[str, Field(min_length=1, max_length=200)],
        type: Annotated[TYPES_CHAMP, Field(description="The field's type; never changes")],
        help_text: Annotated[str | None, Field(max_length=2000)] = None,
        choices: Annotated[list[Choix] | None, Field(description="For select and multiselect: the choices")] = None,
        currency: Annotated[str | None, Field(description="For money: three letters, such as EUR")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        options = options_du_type(type, choices, currency)
        # Comme `declarerChamp` : la position omise — le trigger la met en fin de formulaire —, l'aide absente à `null`.
        reponse = await crm.ecrire(
            appel.jeton, "POST", "form_fields", parametres={"select": COLONNES_CHAMP},
            corps={
                "workflow_id": workflow_id, "workspace_id": appel.espace, "key": key.strip(), "label": label.strip(),
                "type": type, "help_text": help_text.strip() if help_text and help_text.strip() else None,
                "options": options,
            },
        )
        return {"field": champ_lu(une_ligne(reponse, "workflow", workflow_id))}

    moteur.enregistrer(
        serveur,
        crm_form_field_add,
        Declaration(famille="workflows", action="ajouter", espace="workflow:workflow_id"),
        titre="Add a field to a workflow's form",
        description=(
            "Adds a question to the form of every affaire following the workflow, at the end: a key (never changes), a "
            "label, one of the fifteen types (never changes), an optional help text, choices for a select, a currency for "
            "money. Reserved to administrators."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_form_field_update(
        field_id: Annotated[str, Field(description="The field id, from crm_workflow_form_get")],
        label: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        help_text: Annotated[str | None, Field(description="Empty string clears it", max_length=2000)] = None,
        choices: Annotated[list[Choix] | None, Field(description="For select and multiselect: replaces the choices")] = None,
        currency: Annotated[str | None, Field(description="For money: the new currency")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {}
        if label is not None:
            corps["label"] = label.strip()
        if help_text is not None:
            corps["help_text"] = help_text.strip() or None
        if choices is not None or currency is not None:
            champ = await lire_champ(appel.jeton, field_id)
            corps["options"] = options_du_type(str(champ["type"]), choices, currency)
        if not corps:
            raise ToolError("Give label, help_text, choices or currency; a field's key and type never change.")
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "form_fields", parametres={"id": f"eq.{field_id}", "select": COLONNES_CHAMP}, corps=corps
        )
        return {"field": champ_lu(une_ligne(reponse, "field", field_id))}

    moteur.enregistrer(
        serveur,
        crm_form_field_update,
        Declaration(famille="workflows", action="modifier", espace="field:field_id"),
        titre="Update a form field",
        description=(
            "Changes a field's label, help text, choices or currency, as the workflow editor does. Its key and its type "
            "never change: archive it and add another instead."
        ),
    )

    async def crm_form_field_move(
        field_id: Annotated[str, Field(description="The field to move")],
        after_field_id: Annotated[str | None, Field(description="Place it right after this field; omit to place it first")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if after_field_id == field_id:
            raise ToolError("A field cannot be placed after itself.")
        champ = await lire_champ(appel.jeton, field_id)
        # L'ordre affiché par l'éditeur compte les champs archivés : ils occupent leur place (§7 bis.10).
        voisins = [
            c for c in await lire(appel.jeton, "form_fields", {
                "workflow_id": f"eq.{champ['workflow_id']}", "select": "id,position", "order": "position.asc",
            }, "field", field_id)
            if c["id"] != field_id
        ]
        rang = None
        if after_field_id is not None:
            rangs = [i for i, c in enumerate(voisins) if c["id"] == after_field_id]
            if not rangs:
                raise ToolError("after_field_id is not a field of the same workflow.")
            rang = rangs[0]
        position = position_apres([float(c["position"]) for c in voisins], rang)
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "form_fields", parametres={"id": f"eq.{field_id}", "select": COLONNES_CHAMP},
            corps={"position": position},
        )
        return {"field": champ_lu(une_ligne(reponse, "field", field_id))}

    moteur.enregistrer(
        serveur,
        crm_form_field_move,
        Declaration(famille="workflows", action="modifier", espace="field:field_id", autres=("field:after_field_id",)),
        titre="Reorder a form field",
        description="Moves a field in the form's order, right after another field or first.",
    )

    async def crm_form_field_visibility_set(
        field_id: Annotated[str, Field(description="The field id")],
        step_id: Annotated[str, Field(description="The step id, of the same workflow")],
        visibility: Annotated[
            Literal["hidden", "visible", "required", "default"],
            Field(description="default removes the step's rule: the field follows its default visibility"),
        ],
    ) -> dict[str, Any]:
        appel = appel_courant()
        if visibility == "default":
            # `rendreAuDefaut` : le seul retrait de l'éditeur de formulaire ; rendre une case au défaut est un réglage.
            reponse = await crm.ecrire(
                appel.jeton, "DELETE", "form_field_rules",
                parametres={"field_id": f"eq.{field_id}", "step_id": f"eq.{step_id}", "select": "field_id"},
            )
            if not reponse.reussie:
                raise refus_formulaire(reponse, "field", field_id)
            return {"field_id": field_id, "step_id": step_id, "visibility": "default",
                    "changed": bool(isinstance(reponse.corps, list) and reponse.corps)}
        champ = await lire_champ(appel.jeton, field_id)
        # `reglerVisibilite` : un `upsert` sur la clé (champ, étape) ; une case est une ligne entière (§7 bis.11.3).
        reponse = await crm.ecrire(
            appel.jeton, "POST", "form_field_rules",
            parametres={"on_conflict": "field_id,step_id", "select": "field_id,step_id,visibility"},
            corps={"field_id": field_id, "step_id": step_id, "workflow_id": champ["workflow_id"],
                   "workspace_id": champ["workspace_id"], "visibility": visibility},
            fusion=True,
        )
        ligne = une_ligne(reponse, "field", field_id)
        return {"field_id": ligne["field_id"], "step_id": ligne["step_id"], "visibility": ligne["visibility"], "changed": True}

    moteur.enregistrer(
        serveur,
        crm_form_field_visibility_set,
        Declaration(famille="workflows", action="modifier", espace="field:field_id", autres=("step:step_id",)),
        titre="Set a field's visibility at a step",
        description=(
            "Sets whether a field is hidden, visible or required at one step, or returns the cell to its default. Before "
            "making a field required, call crm_transition_requirement_preview and tell the person how many affaires it "
            "affects."
        ),
    )

    async def crm_transition_required_field_set(
        transition_id: Annotated[str, Field(description="The move (transition) id")],
        field_id: Annotated[str, Field(description="The field id, of the same workflow")],
        required: Annotated[bool, Field(description="true: the move requires the field; false: it no longer does")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        if required:
            # `exigerChamp` : un `POST` simple — la table n'accorde ni `UPDATE` ni donc d'`upsert` (§7 bis.12.3).
            reponse = await crm.ecrire(
                appel.jeton, "POST", "workflow_transition_required_fields",
                parametres={"select": "transition_id,field_id"},
                corps={"transition_id": transition_id, "field_id": field_id},
            )
            une_ligne(reponse, "transition", transition_id)
        else:
            reponse = await crm.ecrire(
                appel.jeton, "DELETE", "workflow_transition_required_fields",
                parametres={"transition_id": f"eq.{transition_id}", "field_id": f"eq.{field_id}", "select": "field_id"},
            )
            if not reponse.reussie:
                raise refus_formulaire(reponse, "transition", transition_id)
            if not (isinstance(reponse.corps, list) and reponse.corps):
                raise RefusCrm("Refusé par le CRM : not_required — the move does not require this field, or you may not "
                               "change it.")
        return {"transition_id": transition_id, "field_id": field_id, "required": required}

    moteur.enregistrer(
        serveur,
        crm_transition_required_field_set,
        Declaration(famille="workflows", action="modifier", espace="transition:transition_id", autres=("field:field_id",)),
        titre="Require a field for a move, or stop requiring it",
        description=(
            "Makes a move (transition) require a form field to be answered, or stops requiring it — a setting of the move. "
            "Call crm_transition_requirement_preview first and tell the person what it would block."
        ),
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_form_field_archive(
        field_id: Annotated[str, Field(description="The field id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "form_fields", parametres={"id": f"eq.{field_id}", "select": COLONNES_CHAMP},
            corps={"archived_at": datetime.now(UTC).isoformat()},
        )
        return {
            "field": champ_lu(une_ligne(reponse, "field", field_id)),
            "note": "Archived fields leave the form; their answers are kept and an administrator can restore it.",
        }

    moteur.enregistrer(
        serveur,
        crm_form_field_archive,
        Declaration(famille="workflows", action="supprimer", espace="field:field_id"),
        titre="Archive a form field",
        description=(
            "Archives a field, as the workflow editor does — a field is never deleted: it leaves the form, its answers are "
            "kept, and an administrator can restore it in the web app."
        ),
        destructif=True,
    )

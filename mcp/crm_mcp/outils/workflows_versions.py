# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.c : les versions d'un workflow, leurs comparaisons, le plan de remappage
#       des affaires et la restauration, famille `workflows` (décisions 752, 754 et 756)
# @spec docs/SPEC-mcp.md §9.2 undecies (la liste T2.c ; `crm_workflow_copy_to_track` attend T1.b et n'est pas déclaré ;
#       la restauration ne transmet pas d'empreinte vivante, comme l'écran), §9.1 (les fonctions de l'écran :
#       `versions-workflow.ts`, `administration-workflows.ts`), §9.3 ; docs/SPEC-workflow-engine.md §4 ter (comparer une
#       copie à sa source), §4.6 (la vue `workflow_derivations`), §7 ter.5 (publier), §7 ter.11 (comparer deux
#       versions), §7 ter.12 (le plan de remappage), §7 ter.13 (la restauration transactionnelle, le plan rejoué),
#       §7 ter.14.7 (les refus, dictionnaire fermé), §7 ter.14.8 (aucune empreinte vivante n'est transmise)
"""Les versions d'un workflow, sous l'identité de la personne.

Chaque outil appelle la fonction que le bloc « Versions » de l'éditeur appelle pour le même geste. Publier, planifier
et restaurer sont réservés aux administrateurs par la base ; comparer est une lecture ouverte aux membres.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.workflows import refus_workflow
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

#: Les refus des quatre fonctions de version, tels que la base les écrit (`classerRefusVersion`, §7 ter.14.7). Les
#: refus d'accès restent le refus uniforme ; les autres sont nommés.
REFUS_VERSION = {
    "composition inchangee": "composition_unchanged — the workflow has not changed since its last version.",
    "workflow archive": "workflow_archived — an archived workflow is not published.",
    "versions de workflows differents": "versions_of_different_workflows — compare two versions of the same workflow.",
    "plan non applicable": "plan_not_ready — some affaires have no destination: give step_overrides for the removed "
    "steps (crm_workflow_remap_plan says which).",
    "structure modifiee depuis le plan": "structure_changed — the workflow changed meanwhile: ask for the plan again.",
    "remappage invalide": "remap_invalid — each override needs from_step_id and to_step_id.",
    "remappage ambigu": "remap_ambiguous — a removed step is given two destinations.",
    "origine de remappage inconnue": "remap_unknown_origin — an override starts from a step that is not removed.",
    "cible de remappage absente de la version": "remap_target_not_in_version — a destination must be a step of the "
    "version.",
    "limite invalide": "limit_invalid — the card limit is out of bounds.",
}
REFUS_ACCES = {
    "workflow introuvable", "version introuvable", "publication reservee aux administrateurs",
    "plan reserve aux administrateurs", "restauration reservee aux administrateurs", "authentification requise",
}


class Remappage(BaseModel):
    from_step_id: str = Field(description="A step the version removes")
    to_step_id: str = Field(description="A step of the version, where its affaires go")


def refus_version(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "").strip().lower()
    if message in REFUS_ACCES:
        return RefusCrm(introuvable(genre, valeur))
    if message in REFUS_VERSION:
        return RefusCrm(f"Refusé par le CRM : {REFUS_VERSION[message]}")
    return refus_workflow(reponse, genre, valeur)


def remappages(overrides: list[Remappage] | None) -> dict[str, Any]:
    """Les instructions telles que les deux fonctions les attendent, ordonnées comme `composerInstructions` ; aucune
    instruction n'est inventée pour une étape sans choix (§7 ter.14.5)."""
    if not overrides:
        return {}
    return {"step_overrides": sorted(
        ({"from_step_id": o.from_step_id, "to_step_id": o.to_step_id} for o in overrides),
        key=lambda o: o["from_step_id"],
    )}


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def appeler(jeton: str, fonction: str, arguments: dict[str, Any], genre: str, valeur: Any, *, lecture: bool) -> Any:
        reponse = await crm.rpc(jeton, fonction, arguments, idempotent=lecture)
        if not reponse.reussie:
            raise refus_version(reponse, genre, valeur)
        return reponse.corps

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_workflow_version_list(
        workflow_id: Annotated[str, Field(description="The workflow id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(appel.jeton, "workflow_versions", {
            "workflow_id": f"eq.{workflow_id}", "order": "version_number.desc",
            "select": "id,version_number,note,published_at,composition_fingerprint,"
            "auteur:profiles!workflow_versions_published_by_fkey(full_name)",
        })
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus_version(reponse, "workflow", workflow_id)
        return {"versions": [
            {
                "id": v["id"], "version_number": v["version_number"], "note": v.get("note"),
                "published_at": v.get("published_at"), "published_by": (v.get("auteur") or {}).get("full_name"),
                "fingerprint": v.get("composition_fingerprint"),
            }
            for v in reponse.corps
        ]}

    moteur.enregistrer(
        serveur,
        crm_workflow_version_list,
        Declaration(famille="workflows", action="consulter", espace="workflow:workflow_id"),
        titre="List a workflow's versions",
        description="Lists the published versions of a workflow, newest first: number, note, author, date. A version is "
        "an immutable snapshot of the workflow's steps, moves and form.",
    )

    async def crm_workflow_version_compare(
        base_version_id: Annotated[str, Field(description="The older version")],
        target_version_id: Annotated[str, Field(description="The newer version, of the same workflow")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        document = await appeler(appel.jeton, "compare_workflow_versions",
                                 {"base_version_id": base_version_id, "target_version_id": target_version_id},
                                 "version", base_version_id, lecture=True)
        return {"comparison": document}

    moteur.enregistrer(
        serveur,
        crm_workflow_version_compare,
        Declaration(famille="workflows", action="consulter", espace="version:base_version_id",
                    autres=("version:target_version_id",)),
        titre="Compare two versions of a workflow",
        description="Compares two versions of the same workflow: steps, moves, fields, visibility rules and requirements "
        "added, removed or changed, as the Versions block of the workflow editor does.",
    )

    async def crm_workflow_source_compare(
        workflow_id: Annotated[str, Field(description="A workflow copied from another one")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        derivation = await crm.lire(appel.jeton, "workflow_derivations", {
            "workflow_id": f"eq.{workflow_id}",
            "select": "source_workflow_id,source_name,derived_at,source_archived_at,source_modified_since_copy",
        })
        lignes = derivation.corps if derivation.reussie and isinstance(derivation.corps, list) else []
        if not lignes:
            raise ToolError("This workflow is not a copy of another workflow: there is no source to compare with.")
        document = await appeler(appel.jeton, "compare_workflow_with_source", {"workflow_id": workflow_id},
                                 "workflow", workflow_id, lecture=True)
        source = lignes[0]
        return {
            "source": {
                "workflow_id": source.get("source_workflow_id"), "name": source.get("source_name"),
                "copied_at": source.get("derived_at"), "archived": source.get("source_archived_at") is not None,
                "changed_since_copy": source.get("source_modified_since_copy"),
            },
            "comparison": document,
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_source_compare,
        Declaration(famille="workflows", action="consulter", espace="workflow:workflow_id"),
        titre="Compare a copied workflow with its source",
        description="For a workflow copied to a track, says whether its source changed since the copy and lists how the "
        "copy and its source differ. Nothing is synchronised: a copy lives its own life.",
    )

    async def crm_workflow_remap_plan(
        version_id: Annotated[str, Field(description="The version you consider restoring")],
        step_overrides: Annotated[
            list[Remappage] | None,
            Field(description="Where the affaires of each removed step should go"),
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        plan = await appeler(appel.jeton, "plan_card_remapping", {"target_version_id": version_id, **remappages(step_overrides)},
                             "version", version_id, lecture=True)
        return {"plan": plan, "note": "Nothing changed. Show the person this plan before crm_workflow_version_restore."}

    moteur.enregistrer(
        serveur,
        crm_workflow_remap_plan,
        Declaration(famille="workflows", action="consulter", espace="version:version_id"),
        titre="Plan where affaires would go if a version were restored",
        description="Computes, without changing anything, where each affaire would land if the workflow were restored to "
        "this version: steps removed or restored, affaires unchanged, remapped or without destination. Give "
        "step_overrides for the removed steps until the plan is ready. Reserved to administrators.",
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_workflow_version_publish(
        workflow_id: Annotated[str, Field(description="The workflow id")],
        note: Annotated[str | None, Field(description="What this version is", max_length=2000)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        arguments: dict[str, Any] = {"target_workflow_id": workflow_id}
        if note and note.strip():
            arguments["note"] = note.strip()
        version = await appeler(appel.jeton, "publish_workflow_version", arguments, "workflow", workflow_id, lecture=False)
        if not isinstance(version, dict):
            raise ToolError("The CRM did not return the published version.")
        return {"version": {"id": version.get("id"), "version_number": version.get("version_number"),
                            "note": version.get("note"), "published_at": version.get("published_at")}}

    moteur.enregistrer(
        serveur,
        crm_workflow_version_publish,
        Declaration(famille="workflows", action="ajouter", espace="workflow:workflow_id"),
        titre="Publish a version of a workflow",
        description="Takes an immutable snapshot of the workflow as it is now, with an optional note — a point to compare "
        "with or to return to. Refused when nothing changed since the last version. Reserved to administrators.",
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_workflow_version_restore(
        version_id: Annotated[str, Field(description="The version to return to")],
        step_overrides: Annotated[
            list[Remappage] | None,
            Field(description="Where the affaires of each removed step go, as in crm_workflow_remap_plan"),
        ] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        # Comme `restaurerVersion` : aucune empreinte vivante n'est transmise — aucune fonction publique ne la rend
        # (§7 ter.14.8) ; la restauration rejoue le plan dans sa propre transaction et exige qu'il soit applicable.
        resultat = await appeler(appel.jeton, "restore_workflow_version",
                                 {"target_version_id": version_id, **remappages(step_overrides)},
                                 "version", version_id, lecture=False)
        return {"restoration": resultat}

    moteur.enregistrer(
        serveur,
        crm_workflow_version_restore,
        Declaration(famille="workflows", action="modifier", espace="version:version_id"),
        titre="Restore a workflow to a version",
        description="Rewrites the workflow's steps, moves and form to match the version, and moves the affaires of removed "
        "steps where step_overrides say, in one transaction — after publishing the current state as a return point. "
        "Show the person crm_workflow_remap_plan and get their agreement first. Reserved to administrators.",
        destructif=True,
    )

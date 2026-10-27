# @spec CRM-118 (docs/BACKLOG.md) — tranche T2.e : les quatre outils qui suivent leur écran — renommer un workflow et le
#       désigner par défaut, l'archiver, le copier vers un track, changer le workflow d'un channel (décisions 756 et 758)
# @spec docs/SPEC-mcp.md §9.2 undecies (les lignes de T2.a, T2.c et T2.d, et T2.e : `crm_workflow_update`,
#       `crm_workflow_archive`, `crm_workflow_copy_to_track`, `crm_channel_workflow_change`), §9.3 (refus traduits) ;
#       docs/SPEC-workflow-engine.md §7 quinquies.1 (`set_default_workflow`, la garde d'archivage), §7 quinquies.2 (les
#       gestes de l'en-tête), §7 quinquies.3 (le changement de workflow d'un channel), §4.2 et §4.3 (la copie) ;
#       docs/SPEC-change-channel-workflow.md §2 (le mapping exhaustif, aucune source devinée), §3 (les refus), §5 (la
#       perte explicite des réponses)
"""Les gestes de l'en-tête d'un workflow, et le changement de workflow d'un channel, sous l'identité de la personne.

Chaque outil fait ce que l'écran fait pour le même geste — `entete-workflow.ts` et `changement-workflow-channel.ts` de la
webapp. Rétablir un workflow archivé reste un geste d'écran (décision 758, point 4) : aucun outil ne le fait.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.outils.workflows import COLONNES_WORKFLOW, refus_workflow, une_ligne, workflow_lu
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

#: Les refus de `set_default_workflow`, de la garde d'archivage et de `copy_workflow_to_track`
#: (docs/SPEC-workflow-engine.md §7 quinquies.1, §4.3) — un refus d'accès reste le refus uniforme.
REFUS_ACCES_WORKFLOW = {
    "authentification requise", "workflow introuvable", "reserve aux administrateurs", "workflow_not_found", "forbidden",
}
REFUS_WORKFLOW = {
    "workflow archive": "workflow_archived — an archived workflow cannot become the default; restore it on screen first.",
    "workflow non global": "workflow_not_global — only a global workflow can be the default.",
    "workflow_not_global": "workflow_not_global — only a global workflow can be copied to a track.",
    "workflow_is_default": (
        "workflow_is_default — the default workflow cannot be archived; make another one the default first "
        "(crm_workflow_update, make_default)."
    ),
}
EMPLOYE = re.compile(r"workflow_in_use : (\d+) channel")

#: Les refus de `change_channel_workflow` (docs/SPEC-change-channel-workflow.md §3).
REFUS_CHANGEMENT = {
    "same_workflow": "same_workflow — the channel already follows this workflow.",
    "step_mapping_duplicate": "step_mapping_duplicate — a step appears twice as from_step_id.",
    "invalid_step_mapping": "invalid_step_mapping — each instruction needs a from_step_id and a to_step_id.",
    "step_not_in_workflow": (
        "step_not_in_workflow — a to_step_id is not a step of the new workflow, or a from_step_id not one of the current "
        "workflow."
    ),
    "workflow_not_compatible": "workflow_not_compatible — this workflow belongs to another track than the channel's.",
}


class Correspondance(BaseModel):
    from_step_id: str = Field(description="An occupied step of the channel's current workflow")
    to_step_id: str = Field(description="The step of the new workflow where its affaires go")


def refus_entete(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "").strip()
    employe = EMPLOYE.match(message)
    if employe:
        return RefusCrm(
            f"Refusé par le CRM : workflow_in_use — {employe.group(1)} channel(s) still follow this workflow (archived "
            "channels included); change their workflow first (crm_channel_workflow_change)."
        )
    if message in REFUS_ACCES_WORKFLOW:
        return RefusCrm(introuvable(genre, valeur))
    if message in REFUS_WORKFLOW:
        return RefusCrm(f"Refusé par le CRM : {REFUS_WORKFLOW[message]}")
    if message == "track_not_found":
        return RefusCrm(introuvable("track", valeur))
    return refus_workflow(reponse, genre, valeur)


def mapping(correspondances: list[Correspondance]) -> list[dict[str, str]]:
    """Le mapping tel que la fonction l'attend, ordonné comme `composerMapping` : aucune instruction inventée."""
    return sorted(
        ({"from_step_id": c.from_step_id, "to_step_id": c.to_step_id} for c in correspondances),
        key=lambda c: c["from_step_id"],
    )


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def relire(jeton: str, workflow_id: str) -> dict[str, Any]:
        reponse = await crm.lire(jeton, "workflows", {"id": f"eq.{workflow_id}", "select": COLONNES_WORKFLOW})
        lignes = reponse.corps if reponse.reussie and isinstance(reponse.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable("workflow", workflow_id))
        return lignes[0]

    async def etapes_occupees(jeton: str, channel_id: str) -> dict[str, dict[str, Any]]:
        """Les étapes occupées du channel et leur nombre de rattachements, comme `lireEtapesOccupees` : tous les
        rattachements, affaires archivées et en corbeille comprises — la fonction les compte (§3)."""
        reponse = await crm.lire(jeton, "card_placements", {
            "channel_id": f"eq.{channel_id}",
            "select": (
                "current_step_id,etape:workflow_steps!card_placements_step_fk(label_override,"
                "noeud:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(label))"
            ),
        })
        occupees: dict[str, dict[str, Any]] = {}
        for ligne in reponse.corps if reponse.reussie and isinstance(reponse.corps, list) else []:
            etape = ligne.get("etape") or {}
            nom = etape.get("label_override") or (etape.get("noeud") or {}).get("label") or ligne["current_step_id"]
            avant = occupees.setdefault(ligne["current_step_id"], {"step_id": ligne["current_step_id"], "name": nom, "affaires": 0})
            avant["affaires"] += 1
        return occupees

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_workflow_update(
        workflow_id: Annotated[str, Field(description="The workflow id, from crm_workflow_list")],
        name: Annotated[str | None, Field(description="The new name", min_length=1, max_length=200)] = None,
        make_default: Annotated[
            bool, Field(description="Make this global workflow the workspace's default (the former default stops being it)")
        ] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if name is None and not make_default:
            raise ToolError("Give a new name, or make_default=true.")
        if name is not None:
            if not name.strip():
                raise ToolError("The name cannot be blank.")
            # Comme `renommerWorkflow` : le nom `trim`é (§3 bis.4).
            reponse = await crm.ecrire(
                appel.jeton, "PATCH", "workflows",
                parametres={"id": f"eq.{workflow_id}", "select": "id"}, corps={"name": name.strip()},
            )
            if not reponse.reussie:
                raise refus_entete(reponse, "workflow", workflow_id)
            une_ligne(reponse, "workflow", workflow_id)
        if make_default:
            # La fonction atomique de la migration `0130` : l'ancien défaut s'éteint et le nouveau s'allume ensemble.
            reponse = await crm.rpc(appel.jeton, "set_default_workflow", {"p_workflow": workflow_id})
            if not reponse.reussie:
                raise refus_entete(reponse, "workflow", workflow_id)
        return {"workflow": workflow_lu(await relire(appel.jeton, workflow_id))}

    moteur.enregistrer(
        serveur,
        crm_workflow_update,
        Declaration(famille="workflows", action="modifier", espace="workflow:workflow_id"),
        titre="Rename a workflow, or make it the default",
        description=(
            "Renames a workflow, and/or makes it the workspace's default workflow (the one proposed first when a channel "
            "is created) — as the workflow editor's header does. Only a global, non-archived workflow can be the default; "
            "there is always exactly one. Reserved by the CRM to workspace administrators."
        ),
    )

    async def crm_channel_workflow_change(
        channel_id: Annotated[str, Field(description="The channel id, from crm_channel_list")],
        workflow_id: Annotated[str, Field(description="The new workflow: global, or the channel's track's own")],
        step_mapping: Annotated[
            list[Correspondance],
            Field(description="One instruction per occupied step of the current workflow; nothing is guessed"),
        ],
        discard_field_values: Annotated[
            bool, Field(description="Accept losing the form answers the new workflow does not know")
        ] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "change_channel_workflow", {
            "channel_id": channel_id, "workflow_id": workflow_id, "step_mapping": mapping(step_mapping),
            "discard_field_values": discard_field_values,
        })
        if not reponse.reussie:
            corps = reponse.corps if isinstance(reponse.corps, dict) else {}
            message = str(corps.get("message") or "")
            if message in ("channel_not_found", "forbidden"):
                raise RefusCrm(introuvable("channel", channel_id))
            if message == "workflow_not_found":
                raise RefusCrm(introuvable("workflow", workflow_id))
            if message == "step_mapping_incomplete":
                # La fonction ne nomme pas les étapes : l'outil les relit, comme le panneau les liste avant l'envoi.
                donnees = {c.from_step_id for c in step_mapping}
                manquantes = [e for e in (await etapes_occupees(appel.jeton, channel_id)).values() if e["step_id"] not in donnees]
                noms = ", ".join(f"{e['name']} ({e['step_id']}, {e['affaires']} affaire(s))" for e in manquantes) or "unknown"
                raise RefusCrm(
                    f"Refusé par le CRM : step_mapping_incomplete — give a destination to every occupied step: {noms}."
                )
            if message in REFUS_CHANGEMENT:
                raise RefusCrm(f"Refusé par le CRM : {REFUS_CHANGEMENT[message]}")
            raise refus(reponse, "channel", channel_id)
        remappes = reponse.corps if isinstance(reponse.corps, list) else []
        return {
            "channel_id": channel_id,
            "workflow": workflow_lu(await relire(appel.jeton, workflow_id)),
            "placements_moved": len(remappes),
        }

    moteur.enregistrer(
        serveur,
        crm_channel_workflow_change,
        Declaration(famille="workflows", action="modifier", espace="channel:channel_id", autres=("workflow:workflow_id",)),
        titre="Change the workflow of a channel",
        description=(
            "Moves a channel, and every affaire in it, to another workflow at once, as the « Changer de workflow » panel "
            "does. Give one step_mapping instruction per occupied step of the current workflow (archived and trashed "
            "affaires count): nothing is guessed, and the refusal names the steps left out. When affaires answered form "
            "questions the new workflow does not have, the CRM refuses and says how many answers would be lost; set "
            "discard_field_values=true only after the person has accepted that loss — the answers are DESTROYED."
        ),
        destructif=True,
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_workflow_copy_to_track(
        workflow_id: Annotated[str, Field(description="A global workflow id")],
        track_id: Annotated[str, Field(description="The track the copy will belong to")],
        new_name: Annotated[str | None, Field(description="The copy's name; by default the workflow's", max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        arguments: dict[str, Any] = {"workflow_id": workflow_id, "track_id": track_id}
        # Comme `copierVersTrack` : un nom blanc n'est pas envoyé, la fonction reprend celui du workflow.
        if new_name is not None and new_name.strip():
            arguments["new_name"] = new_name.strip()
        reponse = await crm.rpc(appel.jeton, "copy_workflow_to_track", arguments)
        if not reponse.reussie:
            corps = reponse.corps if isinstance(reponse.corps, dict) else {}
            if str(corps.get("message") or "") == "track_not_found":
                raise RefusCrm(introuvable("track", track_id))
            raise refus_entete(reponse, "workflow", workflow_id)
        return {
            "workflow": workflow_lu(await relire(appel.jeton, str(reponse.corps))),
            "note": "The copy has the steps, moves and form of its source, belongs to the track, then evolves on its own.",
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_copy_to_track,
        Declaration(famille="workflows", action="ajouter", espace="workflow:workflow_id", autres=("track:track_id",)),
        titre="Copy a workflow to a track",
        description=(
            "Copies a global workflow — steps, moves, form, visibility and requirements — into a workflow of one track, "
            "as the editor's « Copier vers un track » does. The copy remembers its source. Reserved to administrators."
        ),
    )

    # --- supprimer -------------------------------------------------------------------------------------------------

    async def crm_workflow_archive(
        workflow_id: Annotated[str, Field(description="The workflow id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        avant = await relire(appel.jeton, workflow_id)
        if avant.get("archived_at") is not None:
            return {"workflow": workflow_lu(avant), "note": "Already archived."}
        reponse = await crm.ecrire(
            appel.jeton, "PATCH", "workflows",
            parametres={"id": f"eq.{workflow_id}", "select": "id"},
            corps={"archived_at": datetime.now(UTC).isoformat()},
        )
        if not reponse.reussie:
            raise refus_entete(reponse, "workflow", workflow_id)
        une_ligne(reponse, "workflow", workflow_id)
        return {
            "workflow": workflow_lu(await relire(appel.jeton, workflow_id)),
            "note": "No channel can choose it any more; its structure and versions are kept. Restoring it is done on screen.",
        }

    moteur.enregistrer(
        serveur,
        crm_workflow_archive,
        Declaration(famille="workflows", action="supprimer", espace="workflow:workflow_id"),
        titre="Archive a workflow",
        description=(
            "Archives a workflow: no channel can choose it any more; its structure and versions are kept. The CRM refuses "
            "for a workflow that channels still follow (archived channels included) and for the default workflow, and "
            "names the way out. Restoring an archived workflow is done on screen only."
        ),
        destructif=True,
    )

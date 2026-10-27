# @spec CRM-068 (docs/BACKLOG.md) — tranche T5 : `crm_card_checklist_list` et `crm_card_checklist_set`, famille `affaires`
# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où ces deux outils s'inscrivent (docs/SPEC-mcp.md §9.2)
# @spec docs/SPEC-mcp.md §9.2 duodecies (la liste, les ancres, le genre `card_checklist_item` ; décisions 747, 748, 767),
#       §9.1 (aucun chemin parallèle : la table que la fiche lit et écrit), §9.3 (zéro ligne = refus) ;
#       docs/SPEC-checklists.md §2 (points d'étape et points libres), §3.2 (qui coche), §3.4 (exigences), §5
"""La checklist d'une affaire, sous l'identité de la personne.

Les deux outils lisent et écrivent `card_checklist_items`, comme le bloc « Checklist » de la fiche : la RLS décide de ce
qui est rendu et de qui coche, et le déclencheur de la base pose l'heure, l'auteur et la ligne du fil. Aucun ajout, aucun
renommage, aucun retrait : ce sont des gestes d'écran (décision 747).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field

from crm_mcp.crm import ClientCrm
from crm_mcp.outils.affaires_ecriture import refus, une_ligne
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable

#: Une étape nommée : sa surcharge de libellé, sinon le libellé de son nœud.
_ETAPE = "position,label_override,workflow_nodes_catalog(label)"
#: Les colonnes d'un point, celles de `COLONNES_POINT_CHECKLIST` de la webapp (`webapp/src/lib/checklists.ts`) : les deux
#: relations vers `profiles` et l'étape d'arrivée d'une transition sont nommées par leur contrainte.
COLONNES_POINT = (
    "id,placement_id,step_item_id,label,position,checked,checked_at,"
    "cocheur:profiles!card_checklist_items_checked_by_fkey(full_name),"
    f"origine:workflow_step_checklist_items(step_id,etape:workflow_steps({_ETAPE}),"
    "exigences:workflow_transition_required_checklist_items(transition:workflow_transitions("
    f"vers:workflow_steps!workflow_transitions_to_step_fkey({_ETAPE}))))"
)
COLONNES_POINT_ECRIT = "id,card_id,label,checked,checked_at"


def nom_etape(etape: dict[str, Any] | None) -> str | None:
    if not etape:
        return None
    return etape.get("label_override") or (etape.get("workflow_nodes_catalog") or {}).get("label")


def ligne_point(point: dict[str, Any]) -> dict[str, Any]:
    """Un point tel que le modèle le lit : son état, qui l'a coché et quand ; jamais un identifiant à la place d'un nom."""
    cocheur = (point.get("cocheur") or {}).get("full_name") if point.get("checked") else None
    origine = point.get("origine") or {}
    exige_pour = sorted(
        {
            nom
            for e in origine.get("exigences") or []
            if (nom := nom_etape(((e or {}).get("transition") or {}).get("vers"))) is not None
        }
    )
    ligne: dict[str, Any] = {
        "item_id": point["id"],
        "label": point["label"],
        "checked": bool(point.get("checked")),
        "checked_by": cocheur,
        "checked_at": point.get("checked_at") if point.get("checked") else None,
    }
    if exige_pour:
        ligne["required_to_move_to"] = exige_pour
    return ligne


def projeter_checklist(points: list[dict[str, Any]], rattachement: str, etape_courante: str | None) -> dict[str, Any]:
    """Les points libres, puis ceux de l'étape courante, puis ceux des étapes traversées (docs/SPEC-mcp.md §9.2 duodecies).

    Seuls comptent les points libres et ceux du rattachement désigné : la fiche montre le même périmètre.
    """
    tri = lambda p: (p.get("position") or 0, str(p.get("id")))  # noqa: E731 — l'ordre de la fiche, stable
    libres = sorted((p for p in points if p.get("placement_id") is None), key=tri)
    d_etape = [p for p in points if p.get("placement_id") == rattachement and p.get("origine")]
    groupes: dict[str, list[dict[str, Any]]] = {}
    for point in d_etape:
        groupes.setdefault(str(point["origine"]["step_id"]), []).append(point)

    def rang(step_id: str) -> tuple[int, int]:
        etape = (groupes[step_id][0]["origine"] or {}).get("etape") or {}
        return (0 if step_id == etape_courante else 1, etape.get("position") or 0)

    etapes = []
    for step_id in sorted(groupes, key=rang):
        lignes = sorted(groupes[step_id], key=tri)
        etapes.append(
            {
                "step": nom_etape((lignes[0]["origine"] or {}).get("etape")),
                "current": step_id == etape_courante,
                "items": [ligne_point(p) for p in lignes],
            }
        )
    courants = groupes.get(etape_courante or "", [])
    return {
        "current_step_count": {"checked": sum(1 for p in courants if p.get("checked")), "total": len(courants)},
        "free_items": [ligne_point(p) for p in libres],
        "step_items": etapes,
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def rattachement(jeton: str, card_id: str) -> dict[str, Any]:
        """Le plus ancien rattachement que l'appelant lit, et son étape courante (`CRM-111` T2.3, comme la fiche)."""
        reponse = await crm.lire(
            jeton,
            "card_placements",
            {"card_id": f"eq.{card_id}", "select": "id,current_step_id", "order": "created_at.asc,id.asc", "limit": "1"},
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus(reponse, "card", card_id)
        if len(reponse.corps) != 1:
            raise RefusCrm(introuvable("card", card_id))
        return reponse.corps[0]

    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_card_checklist_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        place = await rattachement(appel.jeton, card_id)
        reponse = await crm.lire(appel.jeton, "card_checklist_items", {"card_id": f"eq.{card_id}", "select": COLONNES_POINT})
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus(reponse, "card", card_id)
        return {"card_id": card_id, **projeter_checklist(reponse.corps, str(place["id"]), place.get("current_step_id"))}

    moteur.enregistrer(
        serveur,
        crm_card_checklist_list,
        Declaration(famille="affaires", action="consulter", espace="card:card_id"),
        titre="Checklist of an affaire (points à cocher)",
        description=(
            "Lists the checklist of an affaire (card), as on its page: free items first, then the items of the current "
            "step, then those of steps already passed. Each item says whether it is checked, by whom and when, and the "
            "steps a move to which requires it (FR: « Exigé pour passer à … »). Use item_id with crm_card_checklist_set."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_card_checklist_set(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        item_id: Annotated[str, Field(description="The checklist item id, from crm_card_checklist_list")],
        checked: Annotated[bool, Field(description="true checks the item, false unchecks it")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_checklist_items",
            # Filtré sur l'affaire : un point d'une autre affaire rend zéro ligne, donc le refus uniforme.
            parametres={"id": f"eq.{item_id}", "card_id": f"eq.{card_id}", "select": COLONNES_POINT_ECRIT},
            corps={"checked": checked},
        )
        point = une_ligne(reponse, "card_checklist_item", item_id)
        return {
            "item": {
                "item_id": point["id"],
                "label": point["label"],
                "checked": bool(point.get("checked")),
                "checked_at": point.get("checked_at"),
            }
        }

    moteur.enregistrer(
        serveur,
        crm_card_checklist_set,
        Declaration(famille="affaires", action="modifier", espace="card:card_id", autres=("card_checklist_item:item_id",)),
        titre="Check or uncheck a checklist item (cocher)",
        description=(
            "Checks or unchecks one checklist item of an affaire (card), as its page does: the CRM records who and when, "
            "and the timeline says so. It does not add, rename or remove items. Refused when you may not write on the "
            "affaire, or when the item is not one of its items."
        ),
    )

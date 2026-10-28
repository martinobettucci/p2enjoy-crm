# @spec CRM-069 (docs/BACKLOG.md) — tranche T3 : `crm_card_label_set`, poser et retirer des étiquettes sur une affaire
# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où cet outil s'inscrit (docs/SPEC-mcp.md §9.2)
# @spec docs/SPEC-mcp.md §9.2 tredecies (noms résolus dans l'espace de l'affaire, refus avant écriture d'un nom inconnu ou
#       archivé ; décisions 769 et 771), §9.1 (aucun chemin parallèle : la table que la fiche écrit), §9.3 ;
#       docs/SPEC-etiquettes-digest.md §2.2, §4
"""Poser et retirer des étiquettes sur une affaire, sous l'identité de la personne.

L'outil écrit `card_labels`, comme le panneau « Étiquettes » de la fiche : la RLS décide de qui écrit, et la base pose
l'espace, l'auteur et la ligne du fil. Le catalogue n'a pas d'outil (décision 769) : il reste un geste des Réglages.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm
from crm_mcp.outils.affaires import etiquettes
from crm_mcp.outils.affaires_ecriture import refus
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable


def resoudre_noms(catalogue: list[dict[str, Any]], noms: list[str], pose: bool) -> list[dict[str, Any]]:
    """Les étiquettes désignées par leurs noms, sans tenir compte de la casse. Un nom inconnu — ou archivé, pour une pose —
    est refusé AVANT toute écriture, et le refus nomme les étiquettes possibles (§9.2 tredecies)."""
    par_nom = {str(e.get("name") or "").strip().casefold(): e for e in catalogue}
    retenues: list[dict[str, Any]] = []
    for nom in noms:
        etiquette = par_nom.get(nom.strip().casefold())
        if etiquette is None or (pose and etiquette.get("archived_at") is not None):
            possibles = ", ".join(sorted(str(e["name"]) for e in catalogue if e.get("archived_at") is None))
            raise ToolError(f"No label named {nom!r} can be {'added' if pose else 'removed'}. Labels: {possibles}.")
        if etiquette not in retenues:
            retenues.append(etiquette)
    return retenues


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def etiquettes_de(jeton: str, card_id: str) -> list[dict[str, Any]]:
        reponse = await crm.lire(
            jeton,
            "cards",
            {"id": f"eq.{card_id}", "select": "id,etiquettes:card_labels(etiquette:labels(name,color,archived_at))"},
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise refus(reponse, "card", card_id)
        if len(reponse.corps) != 1:
            raise RefusCrm(introuvable("card", card_id))
        return etiquettes(reponse.corps[0])

    async def crm_card_label_set(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        add: Annotated[list[str] | None, Field(description="Label names to put on the affaire (FR: étiquettes)")] = None,
        remove: Annotated[list[str] | None, Field(description="Label names to take off the affaire")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if not add and not remove:
            raise ToolError("Give at least one label name in `add` or `remove`.")
        # L'affaire d'abord, sous le jeton : son espace borne le catalogue, et une affaire illisible est le refus uniforme.
        avant = await etiquettes_de(appel.jeton, card_id)
        lu = await crm.lire(
            appel.jeton, "labels", {"workspace_id": f"eq.{appel.espace}", "select": "id,name,archived_at"}
        )
        if not lu.reussie or not isinstance(lu.corps, list):
            raise refus(lu, "card", card_id)
        a_poser = resoudre_noms(lu.corps, list(add or []), pose=True)
        a_retirer = resoudre_noms(lu.corps, list(remove or []), pose=False)
        deja = {e["name"].casefold() for e in avant}
        inchangees: list[str] = []
        for etiquette in a_poser:
            if str(etiquette["name"]).casefold() in deja:
                inchangees.append(str(etiquette["name"]))
                continue
            reponse = await crm.ecrire(
                appel.jeton, "POST", "card_labels", parametres={"select": "card_id"},
                corps={"card_id": card_id, "label_id": etiquette["id"]},
            )
            if not reponse.reussie or not reponse.corps:
                raise refus(reponse, "card", card_id)
        for etiquette in a_retirer:
            if str(etiquette["name"]).casefold() not in deja:
                inchangees.append(str(etiquette["name"]))
                continue
            reponse = await crm.ecrire(
                appel.jeton, "DELETE", "card_labels",
                parametres={"card_id": f"eq.{card_id}", "label_id": f"eq.{etiquette['id']}", "select": "card_id"},
            )
            # Zéro ligne : la politique a filtré le retrait — un refus, jamais un succès (§9.3).
            if not reponse.reussie or not reponse.corps:
                raise refus(reponse, "card", card_id) if not reponse.reussie else RefusCrm(introuvable("card", card_id))
        return {"labels": await etiquettes_de(appel.jeton, card_id), "unchanged": inchangees}

    moteur.enregistrer(
        serveur,
        crm_card_label_set,
        Declaration(famille="affaires", action="modifier", espace="card:card_id"),
        titre="Put or take labels on an affaire (étiquettes)",
        description=(
            "Puts labels on an affaire (card) and takes others off, by NAME, from the labels of its workspace — as the "
            "« Étiquettes » panel of its page. An unknown name, or an archived one to add, is refused before anything is "
            "written, and the refusal lists the labels. A label already on (or already off) is left unchanged and reported "
            "in `unchanged`. The timeline records each change with your name. It does not create or edit labels."
        ),
    )

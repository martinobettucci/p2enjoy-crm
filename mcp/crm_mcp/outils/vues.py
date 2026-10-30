# @spec CRM-071 (docs/BACKLOG.md) — tranche T3 : les vues sauvegardées dans le connecteur — `crm_view_list`, et la vue que
#       `crm_card_list` applique par son argument `view`
# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où ces outils s'inscrivent (docs/SPEC-mcp.md §9.2)
# @spec docs/SPEC-mcp.md §9.2 quattuordecies (famille `affaires`, `consulter` ; filtres en clair ; une vue inconnue refusée
#       avant toute lecture des affaires ; étape ou étiquette disparues ignorées ; les filtres appliqués comme la vue liste),
#       §9.1 (aucun chemin parallèle : la table que l'écran lit), §9.3 ; docs/SPEC-vues-import-export.md §2.2, §4 ;
#       docs/JOURNAL.md décision 775
"""Les vues sauvegardées d'un channel, lues sous l'identité de la personne.

La RLS de `saved_views` ne rend que les vues privées de la personne et les vues de l'espace sur les channels qu'elle lit :
aucune règle n'est recalculée ici. Aucune écriture de vue : enregistrer, publier et supprimer restent des gestes de l'écran
(décision 775).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm
from crm_mcp.politique import Declaration, MoteurPolitique, appel_courant, traduire_refus

COLONNES_VUE = "id,name,channel_id,visibility,filters"
#: Les tris de la vue liste (`webapp/src/lib/liste-cards.ts`, `TRIS`) et leur sens par défaut.
SENS_PAR_DEFAUT = {"title": "asc", "amount": "desc", "next_action_at": "asc", "created_at": "desc"}
#: La configuration de la recherche plein texte de la vue liste : la même requête que l'écran.
CONFIGURATION_RECHERCHE = "francais_sans_accent"


async def _lire(crm: ClientCrm, jeton: str, table: str, parametres: dict[str, str], genre: str, valeur: Any) -> list[dict[str, Any]]:
    reponse = await crm.lire(jeton, table, parametres)
    if not reponse.reussie or not isinstance(reponse.corps, list):
        raise traduire_refus(reponse, genre, valeur)
    return reponse.corps


async def lire_vues(crm: ClientCrm, jeton: str, espace: str, channel_id: str | None) -> list[dict[str, Any]]:
    """Les vues de l'espace — d'un channel si donné — que la RLS rend à la personne, par nom."""
    parametres = {"workspace_id": f"eq.{espace}", "select": COLONNES_VUE, "order": "name.asc,id.asc"}
    if channel_id is not None:
        parametres["channel_id"] = f"eq.{channel_id}"
    return await _lire(crm, jeton, "saved_views", parametres, "channel" if channel_id else "workspace", channel_id or espace)


def choisir_vue(vues: list[dict[str, Any]], view: str) -> dict[str, Any]:
    """La vue désignée par son identifiant ou son nom, sans tenir compte de la casse. Inconnue ou ambiguë : un refus qui
    nomme les vues possibles, avant toute lecture des affaires (§9.2 quattuordecies)."""
    cherche = view.strip().casefold()
    trouvees = [v for v in vues if v.get("id") == view.strip()] or [
        v for v in vues if str(v.get("name") or "").strip().casefold() == cherche
    ]
    if len(trouvees) == 1:
        return trouvees[0]
    connues = ", ".join(sorted({str(v["name"]) for v in vues})) or "none"
    if not trouvees:
        raise ToolError(f"No saved view named {view!r} you can read here. Views: {connues}.")
    raise ToolError(f"Several channels have a view named {view!r}: give channel_id, or the view id. Views: {connues}.")


def filtres(vue: dict[str, Any]) -> dict[str, Any]:
    brut = vue.get("filters")
    return brut if isinstance(brut, dict) else {}


async def noms_des_filtres(crm: ClientCrm, jeton: str, espace: str, vues: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    """Le nom de chaque étape et de chaque étiquette que les vues citent : l'étape par le libellé de son nœud, comme
    partout dans le produit ; l'étiquette par son nom, archivées comprises (une étiquette archivée reste nommée)."""
    etapes = sorted({str(filtres(v)["step_id"]) for v in vues if isinstance(filtres(v).get("step_id"), str)})
    etiquettes = sorted({str(filtres(v)["label_id"]) for v in vues if isinstance(filtres(v).get("label_id"), str)})
    noms_etapes: dict[str, str] = {}
    noms_etiquettes: dict[str, str] = {}
    if etapes:
        lignes = await _lire(
            crm, jeton, "workflow_steps",
            {"id": f"in.({','.join(etapes)})", "select": "id,noeud:workflow_nodes_catalog(label)"}, "workspace", espace,
        )
        noms_etapes = {str(l["id"]): str((l.get("noeud") or {}).get("label") or "") for l in lignes}
    if etiquettes:
        lignes = await _lire(
            crm, jeton, "labels", {"workspace_id": f"eq.{espace}", "id": f"in.({','.join(etiquettes)})", "select": "id,name"},
            "workspace", espace,
        )
        noms_etiquettes = {str(l["id"]): str(l["name"]) for l in lignes}
    return noms_etapes, noms_etiquettes


def en_clair(vue: dict[str, Any], noms_etapes: dict[str, str], noms_etiquettes: dict[str, str]) -> dict[str, Any]:
    """Une vue telle que le modèle la lit : ses filtres traduits, une valeur absente valant son défaut."""
    f = filtres(vue)
    tri = f.get("sort") if f.get("sort") in SENS_PAR_DEFAUT else "title"
    return {
        "id": vue["id"],
        "name": vue["name"],
        "channel_id": vue["channel_id"],
        "visibility": "workspace" if vue.get("visibility") == "workspace" else "private",
        "filters": {
            "sort": tri,
            "direction": f.get("direction") if f.get("direction") in ("asc", "desc") else SENS_PAR_DEFAUT[tri],
            "step": noms_etapes.get(str(f.get("step_id"))) if f.get("step_id") else None,
            "label": noms_etiquettes.get(str(f.get("label_id"))) if f.get("label_id") else None,
            "search": f.get("search") or None,
            "include_snoozed": f.get("snoozed") == "shown",
        },
    }


def ordre(tri: str, sens: str) -> str:
    """L'ordre de la vue liste (`ordreDe`, `colonneTriee`) : le titre et la date de création de l'AFFAIRE, le montant et
    l'échéance du rattachement, les valeurs nulles en dernier, puis le titre et l'identifiant pour un ordre total."""
    colonne = f"affaire({tri})" if tri in ("title", "created_at") else tri
    principal = f"{colonne}.{sens}.nullslast"
    suite = "affaire(id).asc.nullslast" if tri == "title" else "affaire(title).asc.nullslast,affaire(id).asc.nullslast"
    return f"{principal},{suite}"


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_view_list(
        channel_id: Annotated[str, Field(description="The channel id: its saved views (FR: vues sauvegardées)")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        vues = await lire_vues(crm, appel.jeton, appel.espace, channel_id)
        noms_etapes, noms_etiquettes = await noms_des_filtres(crm, appel.jeton, appel.espace, vues)
        return {"views": [en_clair(v, noms_etapes, noms_etiquettes) for v in vues]}

    moteur.enregistrer(
        serveur,
        crm_view_list,
        Declaration(famille="affaires", action="consulter", espace="channel:channel_id"),
        titre="List saved views of a channel (vues sauvegardées)",
        description=(
            "Lists the saved views (FR: vues sauvegardées) of a channel's list that you can read: yours, and those published "
            "for the workspace. Each view gives its filters in clear: sort, direction, step name, label name, search words, "
            "include_snoozed. Use a view's name as `view` in crm_card_list to list its affaires. Views are created and "
            "edited on screen only."
        ),
    )

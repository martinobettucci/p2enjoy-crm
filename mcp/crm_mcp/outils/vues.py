# @spec CRM-071 (docs/BACKLOG.md) — tranche T3 : les vues sauvegardées dans le connecteur — `crm_view_list`, et la vue que
#       `crm_card_list` applique par son argument `view`
# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où ces outils s'inscrivent (docs/SPEC-mcp.md §9.2)
# @spec docs/SPEC-mcp.md §9.2 quattuordecies (famille `affaires`, `consulter` ; filtres en clair ; une vue inconnue refusée
#       avant toute lecture des affaires ; étape ou étiquette disparues ignorées ; les filtres appliqués comme la vue liste),
#       §9.1 (aucun chemin parallèle : la table que l'écran lit), §9.3 ; docs/SPEC-vues-import-export.md §2.2, §4 ;
#       docs/JOURNAL.md décision 775
# @spec CRM-112 (docs/BACKLOG.md) — tranche T4.d.3 : les filtres des champs de l'affaire d'une vue — rendus par
#       `crm_view_list`, appliqués par `crm_card_list(view=…)` comme la vue liste les applique (docs/SPEC-champs-communs.md
#       §8, précision T4.d ; décisions 837 et 838 ; famille `affaires`, `consulter`)
"""Les vues sauvegardées d'un channel, lues sous l'identité de la personne.

La RLS de `saved_views` ne rend que les vues privées de la personne et les vues de l'espace sur les channels qu'elle lit :
aucune règle n'est recalculée ici. Aucune écriture de vue : enregistrer, publier et supprimer restent des gestes de l'écran
(décision 775).
"""

from __future__ import annotations

import json
import unicodedata

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


# --- Les filtres des champs de l'affaire d'une vue (`CRM-112` T4.d.3) ------------------------------------------------

#: L'alias du plongement d'un filtre de champ, suivi de son rang — celui de la webapp (`ALIAS_FILTRE_COMMUN`).
ALIAS_FILTRE_COMMUN = "fc"
_TEXTES = {"text", "textarea", "email", "phone", "url"}


def filtres_communs(vue: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Les filtres de champ d'une vue (`common_fields`), sous leur forme structurée ; ce qui n'est pas un objet est ignoré."""
    brut = filtres(vue).get("common_fields")
    if not isinstance(brut, dict):
        return {}
    return {str(cle): valeur for cle, valeur in brut.items() if isinstance(valeur, dict)}


async def champs_des_filtres(crm: ClientCrm, jeton: str, espace: str, vues: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Les champs ACTIFS de l'espace que les vues filtrent, par clé : un champ archivé ou inconnu est ignoré (§8)."""
    cles = sorted({cle for v in vues for cle in filtres_communs(v)})
    if not cles:
        return {}
    lignes = await _lire(
        crm, jeton, "card_common_fields",
        {"workspace_id": f"eq.{espace}", "archived_at": "is.null", "key": f"in.({','.join(cles)})", "select": "id,key,label,type"},
        "workspace", espace,
    )
    return {str(l["key"]): l for l in lignes}


def _quoter(valeur: str) -> str:
    """Un opérande de la syntaxe logique de PostgREST, entre guillemets — `operandeOu` de la webapp."""
    return '"' + valeur.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _sans_accents(texte: str) -> str:
    """La forme de `value_search` : minuscules, sans accents — `motifContient` de la webapp."""
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn").lower().strip()


def _nombre(valeur: Any) -> bool:
    return isinstance(valeur, (int, float)) and not isinstance(valeur, bool)


def _jour(valeur: Any) -> bool:
    return isinstance(valeur, str) and len(valeur) == 10 and valeur[4] == "-" and valeur[7] == "-"


def conditions_filtres_communs(
    communs: dict[str, dict[str, Any]], champs: dict[str, dict[str, Any]]
) -> tuple[list[str], dict[str, str]]:
    """Les plongements et les paramètres PostgREST qui appliquent les filtres de champ d'une vue, comme la vue liste
    (`lirePageCards`) : un plongement par filtre sous l'affaire, `!inner` sauf pour une case « vide », borné à son champ
    et à sa condition. Une forme qui ne convient pas au type du champ est ignorée. Un jour d'une date et heure se lit en
    UTC : le connecteur n'a pas de fuseau d'appareil."""
    plongements: list[str] = []
    parametres: dict[str, str] = {}
    for cle in sorted(communs):
        champ, f = champs.get(cle), communs[cle]
        if champ is None:
            continue
        type_, rang = str(champ["type"]), len(plongements)
        alias = f"affaire.{ALIAS_FILTRE_COMMUN}{rang}"
        conditions = [f"field_id.eq.{champ['id']}"]
        vide = False
        if type_ in _TEXTES and isinstance(f.get("contains"), str) and f["contains"].strip():
            conditions.append(f"value_search.like.{_quoter('*' + _sans_accents(f['contains']) + '*')}")
        elif type_ == "select" and isinstance(f.get("any_of"), list) and f["any_of"]:
            conditions.append(f"value.cd.{_quoter(json.dumps([str(c) for c in f['any_of']], ensure_ascii=False))}")
        elif type_ == "multiselect" and isinstance(f.get("any_of"), list) and f["any_of"]:
            conditions.append(
                "or(" + ",".join(f"value.cs.{_quoter(json.dumps([str(c)], ensure_ascii=False))}" for c in f["any_of"]) + ")"
            )
        elif type_ in ("number", "money") and (_nombre(f.get("min")) or _nombre(f.get("max"))):
            if _nombre(f.get("min")):
                conditions.append(f"value.gte.{f['min']}")
            if _nombre(f.get("max")):
                conditions.append(f"value.lte.{f['max']}")
        elif type_ == "date" and (_jour(f.get("from")) or _jour(f.get("to"))):
            if _jour(f.get("from")):
                conditions.append(f"value_date.gte.{f['from']}")
            if _jour(f.get("to")):
                conditions.append(f"value_date.lte.{f['to']}")
        elif type_ == "datetime" and (_jour(f.get("from")) or _jour(f.get("to"))):
            if _jour(f.get("from")):
                conditions.append(f"value_timestamp.gte.{f['from']}T00:00:00Z")
            if _jour(f.get("to")):
                conditions.append(f"value_timestamp.lte.{f['to']}T23:59:59.999999Z")
        elif type_ == "checkbox" and f.get("is") in ("yes", "no"):
            conditions.append(f"value.eq.{'true' if f['is'] == 'yes' else 'false'}")
        elif type_ == "checkbox" and f.get("is") == "empty":
            conditions += ["value.not.is.null", "value.neq.null"]
            vide = True
        else:
            continue
        plongements.append(f"{ALIAS_FILTRE_COMMUN}{rang}:card_common_field_values{'' if vide else '!inner'}(field_id)")
        parametres[f"{alias}.and"] = "(" + ",".join(conditions) + ")"
        if vide:
            parametres[alias] = "is.null"
    return plongements, parametres


def filtres_communs_en_clair(vue: dict[str, Any], champs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Les filtres de champ d'une vue tels que le modèle les lit : le champ par son libellé et sa clé, et la condition."""
    return [
        {"field": str(champs[cle]["label"]), "key": cle, **condition}
        for cle, condition in sorted(filtres_communs(vue).items())
        if cle in champs
    ]


def en_clair(
    vue: dict[str, Any], noms_etapes: dict[str, str], noms_etiquettes: dict[str, str], champs: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
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
            # `CRM-112` T4.d.3 : les filtres des champs de l'affaire ; une liste vide quand la vue n'en porte pas.
            "fields": filtres_communs_en_clair(vue, champs or {}),
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
        champs = await champs_des_filtres(crm, appel.jeton, appel.espace, vues)
        return {"views": [en_clair(v, noms_etapes, noms_etiquettes, champs) for v in vues]}

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

# @spec CRM-112 (docs/BACKLOG.md) — tranche T9 : les champs de l'affaire dans le connecteur — `crm_common_field_list`, la
#       partie commune rendue par `crm_card_get`, les valeurs écrites par `crm_card_update`, les filtres directs de
#       `crm_card_list` contrôlés et nommés (docs/SPEC-mcp.md §9.2 sexdecies ; docs/SPEC-champs-communs.md §7, §8, §11 ;
#       décisions 664, 837 et 846)
"""Les champs de l'affaire — champs communs de portée espace — sous l'identité de la personne.

Le connecteur ne définit pas les champs : il les lit, lit et écrit leurs valeurs, et filtre les affaires. Les tables sont
celles de l'écran — `card_common_fields`, `card_common_field_values` — sous leurs politiques ; la base valide chaque
valeur par `app.validate_field_value`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.vues import conditions_filtres_communs
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

COLONNES_CHAMP = "id,key,label,type,options,help_text,is_listed,position,archived_at"
#: La forme de condition attendue par type, telle que le modèle doit l'écrire (docs/SPEC-champs-communs.md §8).
FORMES = {
    "text": '{"contains": "<texte>"}',
    "textarea": '{"contains": "<texte>"}',
    "email": '{"contains": "<texte>"}',
    "phone": '{"contains": "<texte>"}',
    "url": '{"contains": "<texte>"}',
    "select": '{"any_of": ["<clé de choix>", …]}',
    "multiselect": '{"any_of": ["<clé de choix>", …]}',
    "user": '{"any_of": ["<identifiant de personne>"]}',
    "contact": '{"any_of": ["<identifiant de contact>"]}',
    "number": '{"min": <nombre>, "max": <nombre>} (one at least)',
    "money": '{"min": <nombre>, "max": <nombre>} (one at least)',
    "date": '{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"} (one at least)',
    "datetime": '{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"} (one at least)',
    "checkbox": '{"is": "yes" | "no" | "empty"}',
    "file": '{"is": "filled" | "empty"}',
}


def _lignes(reponse: Reponse, genre: str, valeur: Any) -> list[dict[str, Any]]:
    if not reponse.reussie or not isinstance(reponse.corps, list):
        raise traduire_refus(reponse, genre, valeur)
    return reponse.corps


def _choix(champ: dict[str, Any]) -> list[dict[str, Any]]:
    options = champ.get("options")
    brut = options.get("choices") if isinstance(options, dict) else None
    return [{"key": c.get("key"), "label": c.get("label")} for c in (brut or []) if isinstance(c, dict)]


def champ_en_clair(champ: dict[str, Any]) -> dict[str, Any]:
    """Une définition telle que le modèle la lit : ce qu'il faut pour écrire une valeur ou un filtre juste."""
    rendu: dict[str, Any] = {
        "key": champ["key"],
        "label": champ["label"],
        "type": champ["type"],
        "help": champ.get("help_text") or None,
        "listed": champ.get("is_listed") is True,
        "archived": champ.get("archived_at") is not None,
    }
    if champ["type"] in ("select", "multiselect"):
        rendu["choices"] = _choix(champ)
    options = champ.get("options")
    if champ["type"] == "money" and isinstance(options, dict) and options.get("currency"):
        rendu["currency"] = options["currency"]
    return rendu


async def lire_champs_communs(crm: ClientCrm, jeton: str, espace: str, avec_archives: bool) -> list[dict[str, Any]]:
    """Les champs de l'affaire de l'espace, dans l'ordre de la partie commune (`position`, puis la clé)."""
    parametres = {"workspace_id": f"eq.{espace}", "select": COLONNES_CHAMP, "order": "position.asc,key.asc"}
    if not avec_archives:
        parametres["archived_at"] = "is.null"
    return _lignes(await crm.lire(jeton, "card_common_fields", parametres), "workspace", espace)


def partie_commune(champs: list[dict[str, Any]], valeurs: dict[str, Any]) -> list[dict[str, Any]]:
    """La partie commune d'une affaire, comme la fiche la rend (`docs/DESIGN_SYSTEM.md` §5.88) : chaque champ actif, valeur
    comprise ou `null`, puis les archivés qui portent une valeur."""
    def ligne(champ: dict[str, Any]) -> dict[str, Any]:
        valeur = valeurs.get(str(champ["id"]))
        rendu: dict[str, Any] = {
            "field": champ["label"],
            "key": champ["key"],
            "type": champ["type"],
            "value": valeur,
            "archived": champ.get("archived_at") is not None,
        }
        libelles = {c["key"]: c["label"] for c in _choix(champ)}
        if isinstance(valeur, str) and valeur in libelles:
            rendu["value_label"] = libelles[valeur]
        return rendu

    actifs = [ligne(c) for c in champs if c.get("archived_at") is None]
    archives = [ligne(c) for c in champs if c.get("archived_at") is not None and valeurs.get(str(c["id"])) is not None]
    return actifs + archives


def _cles_connues(champs: dict[str, dict[str, Any]]) -> str:
    return ", ".join(sorted(champs)) or "none"


def controler_filtres(direct: dict[str, Any], actifs: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Les filtres directs de `crm_card_list`, contrôlés : une clé inconnue ou archivée, ou une condition qui ne convient
    pas au type du champ, est REFUSÉE et nommée — là où une vue sauvegardée les ignore, un appel du modèle doit apprendre
    son erreur (§9.2 sexdecies)."""
    retenus: dict[str, dict[str, Any]] = {}
    for cle, condition in direct.items():
        champ = actifs.get(cle)
        if champ is None:
            raise ToolError(f"Unknown or archived field key {cle!r}. Active keys: {_cles_connues(actifs)}.")
        if not isinstance(condition, dict):
            raise ToolError(f"The condition for {cle!r} must be an object: {FORMES.get(str(champ['type']), '?')}.")
        plongements, _ = conditions_filtres_communs({cle: condition}, {cle: champ})
        if not plongements:
            raise ToolError(
                f"The condition for {cle!r} does not fit its type {champ['type']}: give {FORMES.get(str(champ['type']), '?')}."
            )
        retenus[cle] = condition
    return retenus


def verifier_cles(valeurs: dict[str, Any], champs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Les clés des valeurs à écrire, jugées AVANT tout geste : une clé inconnue est nommée, celle d'un champ archivé est
    refusée (`common_field_archived`) — l'en-tête de l'affaire n'est donc jamais écrit à moitié (§9.2 sexdecies)."""
    par_cle = {str(c["key"]): c for c in champs}
    actifs = {cle: c for cle, c in par_cle.items() if c.get("archived_at") is None}
    for cle in valeurs:
        if cle not in par_cle:
            raise ToolError(f"Unknown field key {cle!r}. Active keys: {_cles_connues(actifs)}.")
        if par_cle[cle].get("archived_at") is not None:
            raise RefusCrm(f"Refusé par le CRM : common_field_archived — {cle!r} is archived: its value is read-only.")
    return par_cle


async def ecrire_valeurs(
    crm: ClientCrm, jeton: str, espace: str, card_id: str, valeurs: dict[str, Any], champs: list[dict[str, Any]]
) -> None:
    """Écrit les valeurs communes d'une affaire, désignées par leur clé : une MISE À JOUR de la ligne si elle existe, une
    INSERTION sinon — comme l'écran (`ecrireValeurCommune`), sans `upsert`, le privilège de colonne n'accordant la mise à
    jour que de `value`. `null` vide la valeur. Une valeur d'un champ archivé ne s'écrit pas (§9.2 sexdecies)."""
    par_cle = verifier_cles(valeurs, champs)
    for cle, valeur in valeurs.items():
        champ = par_cle[cle]
        filtre = {"card_id": f"eq.{card_id}", "field_id": f"eq.{champ['id']}", "select": "field_id"}
        mise_a_jour = await crm.ecrire(jeton, "PATCH", "card_common_field_values", parametres=filtre, corps={"value": valeur})
        if mise_a_jour.reussie and isinstance(mise_a_jour.corps, list) and mise_a_jour.corps:
            continue
        if not mise_a_jour.reussie:
            raise _refus_valeur(mise_a_jour, cle, card_id)
        insertion = await crm.ecrire(
            jeton,
            "POST",
            "card_common_field_values",
            parametres={"select": "field_id"},
            corps={"card_id": card_id, "field_id": champ["id"], "workspace_id": espace, "value": valeur},
        )
        if insertion.reussie and isinstance(insertion.corps, list) and insertion.corps:
            continue
        if insertion.statut == 409:
            # Née entre-temps : la mise à jour est reprise, comme l'écran le fait.
            reprise = await crm.ecrire(jeton, "PATCH", "card_common_field_values", parametres=filtre, corps={"value": valeur})
            if reprise.reussie and isinstance(reprise.corps, list) and reprise.corps:
                continue
            raise _refus_valeur(reprise, cle, card_id)
        raise _refus_valeur(insertion, cle, card_id)


def _refus_valeur(reponse: Reponse, cle: str, card_id: str) -> ToolError:
    """Le refus d'une valeur : `invalid_field_value` nommé avec sa clé ; un refus de droit, ou zéro ligne, est le refus
    uniforme de l'affaire."""
    if reponse.message == "invalid_field_value":
        return RefusCrm(f"Refusé par le CRM : invalid_field_value — the value of {cle!r} does not fit its type or choices.")
    if reponse.reussie:
        return RefusCrm(introuvable("card", card_id))
    return traduire_refus(reponse, "card", card_id)


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_common_field_list(
        workspace: Annotated[str, Field(description="Workspace slug or id")],
        include_archived: Annotated[bool, Field(description="Also list archived fields")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        champs = await lire_champs_communs(crm, appel.jeton, appel.espace, include_archived)
        return {"fields": [champ_en_clair(c) for c in champs]}

    moteur.enregistrer(
        serveur,
        crm_common_field_list,
        Declaration(famille="affaires", action="consulter", espace="workspace:workspace"),
        titre="List the affaire fields (FR: champs de l'affaire)",
        description=(
            "Lists the fields every affaire of the workspace carries, whatever its channel (FR: champs de l'affaire): key, "
            "label, type, help, choices for a choice field, currency for an amount. Read their values with crm_card_get, "
            "write them with crm_card_update (common_fields), filter crm_card_list by them. Fields are defined by an "
            "administrator in the CRM, never by the connector."
        ),
    )

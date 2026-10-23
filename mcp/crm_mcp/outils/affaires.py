# @spec CRM-104 (docs/BACKLOG.md) — tranche T2.a : les sept outils de LECTURE de la famille `affaires` (décisions 652 à 654)
# @spec CRM-067 (docs/BACKLOG.md) — tranche T4 : `crm_card_activity_list` (docs/SPEC-activites.md §6, décision 653)
# @spec docs/SPEC-mcp.md §9.2 bis (la liste fixée, les ancres, l'ancre `channel` facultative), §9.1 (aucun chemin
#       parallèle : les tables et fonctions de la webapp), §9.3 (JSON structuré, `limit` ≤ 100, refus traduits), §16
#       (inventaire : description, probabilité, capacité d'écrire, activités) ; docs/SPEC-cards.md §14.10 (le fil unifié
#       à la lecture, décision 209), §15 (l'en-tête) ; docs/SPEC-relances.md §9 (`cards_figees`) ; docs/SPEC-cards.md §17
#       (« Ma journée », `CRM-061`)
"""Lecture des affaires, sous l'identité de la personne.

Les mêmes lectures que la webapp — la vue liste, la fiche, le fil unifié, « Ma journée », les affaires figées —, sous
le jeton interne : la RLS rend ce qu'elle consent, et un objet qu'elle cache est « introuvable ». Aucune règle métier
n'est recalculée ici, sauf la fusion du fil et le découpage de la journée, qui sont des RANGEMENTS de ce que la base a
rendu, écrits comme ceux de `webapp/src/lib/timeline.ts` et `webapp/src/lib/ma-journee.ts`.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

LIMITE_MAX = 100
ECHEANCES = ("overdue", "today", "week")
PORTEES = ("mine", "all")
HORIZON_JOURS = 7

#: Les trois relations embarquées d'une affaire, par leur clé NOMMÉE : `cards` porte deux clés composites vers
#: `channels` et vers `workflow_steps`, et un embarquement nu serait ambigu (`PGRST201`, `card-costs.ts`).
CHANNEL = "channel:channels!cards_channel_id_workspace_id_fkey(id,name,slug,track:tracks(id,name,slug))"
ETAPE = "etape:workflow_steps!cards_current_step_id_workflow_id_fkey(id,probability_override,noeud:workflow_nodes_catalog(label,default_probability))"
RESPONSABLE = "responsable:profiles!cards_owner_id_fkey(id,full_name)"
COLONNES_LISTE = f"id,title,amount,currency,next_action,next_action_at,snoozed_until,{RESPONSABLE},{CHANNEL},{ETAPE}"
COLONNES_FICHE = (
    "id,title,description,amount,currency,probability_override,next_action,next_action_at,snoozed_until,archived_at,"
    f"email_local_part,workflow_id,entered_step_at,created_at,updated_at,ecriture_permise,{RESPONSABLE},{CHANNEL},{ETAPE}"
)
COLONNES_EVENEMENT = "id,type,payload,created_at,acteur:profiles!card_events_actor_id_fkey(full_name)"
COLONNES_COMMENTAIRE = (
    "id,body,author_id,created_at,edited_at,deleted_at,deleted_by,auteur:profiles!card_comments_author_id_fkey(full_name)"
)
COLONNES_ACTIVITE = (
    "id,type,occurred_at,duration_minutes,subject,body,author_id,created_at,edited_at,deleted_at,deleted_by,"
    "auteur:profiles!card_activities_author_id_fkey(full_name),"
    "participants:card_activity_participants(contact_id,profile_id,contact:contacts(full_name),profil:profiles(full_name))"
)


# ---------------------------------------------------------------------------------------------------------------------
# Rangements purs — vérifiables sans CRM
# ---------------------------------------------------------------------------------------------------------------------


def nettoyer_texte(texte: str) -> str:
    """Le texte d'un filtre `ilike` : les caractères qui ont un sens pour PostgREST (`*`, `,`, `(`, `)`, `.`) sont
    retirés plutôt qu'échappés — un titre se cherche par ses mots, et un filtre forgé ne doit pas élargir la requête."""
    return re.sub(r"[*,().%\\\"]", " ", texte).strip()


def probabilite(fiche: dict[str, Any]) -> dict[str, Any]:
    """La probabilité effective et sa source : la surcharge de l'affaire, puis celle de l'étape, puis le défaut du nœud —
    le `coalesce` de `entonnoir_conversion` (migration 73), rendu tel quel, jamais inventé."""
    etape = fiche.get("etape") or {}
    noeud = etape.get("noeud") or {}
    for source, valeur in (
        ("card", fiche.get("probability_override")),
        ("step", etape.get("probability_override")),
        ("node", noeud.get("default_probability")),
    ):
        if valeur is not None:
            return {"value": valeur, "source": source}
    return {"value": None, "source": None}


def resume_carte(ligne: dict[str, Any]) -> dict[str, Any]:
    """Une affaire nommée : identifiants ET libellés utiles (docs/SPEC-mcp.md §9.3)."""
    channel = ligne.get("channel") or {}
    track = channel.get("track") or {}
    etape = ligne.get("etape") or {}
    responsable = ligne.get("responsable") or {}
    return {
        "id": ligne["id"],
        "title": ligne["title"],
        "track": {"id": track.get("id"), "name": track.get("name")},
        "channel": {"id": channel.get("id"), "name": channel.get("name")},
        "step": {"id": etape.get("id"), "name": (etape.get("noeud") or {}).get("label")},
        "owner": responsable.get("full_name"),
        "amount": ligne.get("amount"),
        "currency": ligne.get("currency"),
        "next_action": ligne.get("next_action"),
        "next_action_at": ligne.get("next_action_at"),
        "snoozed_until": ligne.get("snoozed_until"),
    }


def detail_evenement(
    type_: str,
    payload: dict[str, Any],
    etapes: dict[str, str],
    champs: dict[str, str],
    contacts: dict[str, str],
) -> dict[str, Any]:
    """Le détail RÉSOLU d'un événement, comme `resoudreDetail` de la webapp : un libellé lu à la lecture, jamais dans le
    `payload` (§14.6), sauf les valeurs mêmes du fait — date du sommeil, retard d'une relance, rôle, objet d'un départ.
    Un libellé non résolu est absent, jamais remplacé par l'identifiant."""

    def texte(cle: str) -> str | None:
        v = payload.get(cle)
        return v if isinstance(v, str) else None

    if type_ == "moved":
        de, vers = etapes.get(texte("from_step_id") or ""), etapes.get(texte("to_step_id") or "")
        return {"from_step": de, "to_step": vers} if de is not None and vers is not None else {}
    if type_ == "field_changed":
        champ = champs.get(texte("field_id") or "")
        return {"field": champ} if champ is not None else {}
    if type_ in ("snoozed", "woken"):
        cle = "until" if type_ == "snoozed" else "from"
        return {cle: texte(cle)} if texte(cle) is not None else {}
    if type_ == "stalled":
        seuil, retard = payload.get("seuil_jours"), payload.get("retard_jours")
        if isinstance(seuil, int) and isinstance(retard, int):
            return {"threshold_days": seuil, "overdue_days": retard}
        return {}
    if type_ == "mail_unclassified":
        return {"subject": texte("subject")} if texte("subject") is not None else {}
    if type_ in ("contact_linked", "contact_unlinked", "contact_role_changed"):
        nom = contacts.get(texte("contact_id") or "")
        if nom is None:
            return {}
        if type_ == "contact_role_changed":
            return {"contact": nom, "from_role": texte("from"), "to_role": texte("to")}
        return {"contact": nom, "role": texte("role")}
    return {}


def ligne_commentaire(c: dict[str, Any]) -> dict[str, Any]:
    retire = c.get("deleted_at") is not None
    return {
        "id": c["id"],
        "author": None if c.get("author_id") is None else (c.get("auteur") or {}).get("full_name"),
        "author_deleted": c.get("author_id") is None,
        "body": None if retire else c.get("body"),
        "created_at": c["created_at"],
        "edited_at": c.get("edited_at"),
        "deleted": retire,
        # Un tiers a retiré : l'écran le dit, sans nommer qui (docs/DESIGN_SYSTEM.md §5.10).
        "removed_by_moderation": retire and c.get("deleted_by") is not None and c.get("deleted_by") != c.get("author_id"),
    }


def ligne_activite(a: dict[str, Any]) -> dict[str, Any]:
    retiree = a.get("deleted_at") is not None
    participants = a.get("participants") or []
    return {
        "id": a["id"],
        "type": a["type"],
        "occurred_at": a["occurred_at"],
        "duration_minutes": None if retiree else a.get("duration_minutes"),
        "subject": None if retiree else a.get("subject"),
        "body": None if retiree else a.get("body"),
        "author": None if a.get("author_id") is None else (a.get("auteur") or {}).get("full_name"),
        "edited_at": a.get("edited_at"),
        "retired": retiree,
        "retired_by_moderation": retiree and a.get("deleted_by") is not None and a.get("deleted_by") != a.get("author_id"),
        # Un participant que la base ne rend pas nommé n'est pas cité : jamais un identifiant à la place d'un nom.
        "contacts": [
            (p.get("contact") or {}).get("full_name")
            for p in participants
            if p.get("contact_id") and (p.get("contact") or {}).get("full_name")
        ],
        "members": [
            (p.get("profil") or {}).get("full_name")
            for p in participants
            if p.get("profile_id") and (p.get("profil") or {}).get("full_name")
        ],
    }


def fusionner_fil(
    evenements: list[dict[str, Any]],
    commentaires: list[dict[str, Any]],
    activites: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Les trois sources en un fil, du plus ancien au plus récent, d'un ordre TOTAL sur `(date, clé)` — la règle de
    `fusionnerFil` (décision 209). Une activité se range à `occurred_at` (décision 651)."""
    lignes = [
        *({"kind": "event", "_cle": f"e:{e['id']}", "at": e["at"], **{k: v for k, v in e.items() if k != "at"}} for e in evenements),
        *({"kind": "comment", "_cle": f"c:{c['id']}", "at": c["created_at"], **c} for c in commentaires),
        *({"kind": "activity", "_cle": f"a:{a['id']}", "at": a["occurred_at"], **a} for a in activites),
    ]
    # L'instant est comparé en tant qu'INSTANT : PostgREST rend `+00:00` partout, mais une comparaison de chaînes
    # rangerait mal deux écritures différentes du même fuseau.
    lignes.sort(key=lambda l: (_instant(l["at"]), l["_cle"]))
    for ligne in lignes:
        del ligne["_cle"]
    return lignes


def _instant(texte: str) -> datetime:
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)


def bornes_journee(maintenant: datetime, fuseau: ZoneInfo) -> tuple[datetime, datetime, datetime]:
    """Début d'aujourd'hui, début de demain et horizon à sept jours, dans le fuseau donné — `bornesJournee` de la
    webapp, qui prend celui de l'appareil ; ici, la personne le donne."""
    local = maintenant.astimezone(fuseau)
    debut = local.replace(hour=0, minute=0, second=0, microsecond=0)
    demain = (debut + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    horizon = (debut + timedelta(days=HORIZON_JOURS + 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return debut.astimezone(UTC), demain.astimezone(UTC), horizon.astimezone(UTC)


def section_echeance(echeance: str, bornes: tuple[datetime, datetime, datetime]) -> str | None:
    debut, demain, horizon = bornes
    instant = _instant(echeance)
    if instant < debut:
        return "overdue"
    if instant < demain:
        return "today"
    if instant < horizon:
        return "upcoming"
    return None


# ---------------------------------------------------------------------------------------------------------------------
# Lectures
# ---------------------------------------------------------------------------------------------------------------------


def _lignes(reponse: Reponse, genre: str, valeur: Any) -> list[dict[str, Any]]:
    if not reponse.reussie or not isinstance(reponse.corps, list):
        raise traduire_refus(reponse, genre, valeur)
    return reponse.corps


async def _fiche(crm: ClientCrm, jeton: str, card_id: str, colonnes: str) -> dict[str, Any]:
    lignes = _lignes(await crm.lire(jeton, "cards", {"id": f"eq.{card_id}", "select": colonnes}), "card", card_id)
    if len(lignes) != 1:
        raise RefusCrm(introuvable("card", card_id))
    return lignes[0]


def _liste_ids(ids: set[str]) -> str:
    return "in.(" + ",".join(sorted(ids)) + ")"


def _fuseau(nom: str) -> ZoneInfo:
    try:
        return ZoneInfo(nom)
    except (ZoneInfoNotFoundError, ValueError) as erreur:
        raise ToolError("timezone must be an IANA name, e.g. Europe/Paris.") from erreur


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_card_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        channel_id: Annotated[str | None, Field(description="Optional channel id: only its affaires")] = None,
        query: Annotated[str | None, Field(description="Optional words of the title", max_length=100)] = None,
        step: Annotated[str | None, Field(description="Optional step name (FR: étape), exact, e.g. Négociation")] = None,
        due: Annotated[str | None, Field(description="Optional next action due: overdue, today or week")] = None,
        include_snoozed: Annotated[bool, Field(description="Include affaires put to sleep (FR: en sommeil)")] = False,
        timezone: Annotated[str, Field(description="IANA time zone for `today`")] = "Europe/Paris",
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if due is not None and due not in ECHEANCES:
            raise ToolError("due must be one of overdue, today, week.")
        maintenant = datetime.now(UTC)
        colonnes = COLONNES_LISTE
        parametres: dict[str, str] = {
            "workspace_id": f"eq.{appel.espace}",
            "archived_at": "is.null",
            "deleted_at": "is.null",
            "order": "title.asc,id.asc",
            # Une ligne de plus que demandé : elle dit s'il en reste, sans `count=exact` à chaque appel.
            "limit": str(limit + 1),
            "offset": str(offset),
        }
        if channel_id is not None:
            parametres["channel_id"] = f"eq.{channel_id}"
        if query is not None and nettoyer_texte(query):
            parametres["title"] = f"ilike.*{nettoyer_texte(query)}*"
        if step is not None:
            # Le libellé est celui du NŒUD, comme partout dans le produit : le filtre porte sur la relation embarquée,
            # qui devient obligatoire (`!inner`) pour que la ligne sans cette étape soit écartée par la base.
            colonnes = colonnes.replace(
                "noeud:workflow_nodes_catalog(label,default_probability))",
                "noeud:workflow_nodes_catalog!inner(label,default_probability))",
            ).replace("cards_current_step_id_workflow_id_fkey(", "cards_current_step_id_workflow_id_fkey!inner(")
            parametres["etape.noeud.label"] = f"eq.{step}"
        if due is not None:
            debut, demain, _ = bornes_journee(maintenant, _fuseau(timezone))
            fin = {"overdue": maintenant, "today": demain, "week": maintenant + timedelta(days=HORIZON_JOURS)}[due]
            parametres["next_action_at"] = f"lt.{fin.isoformat()}"
            if due == "today":
                parametres["and"] = f"(next_action_at.gte.{debut.isoformat()})"
        if not include_snoozed:
            # La règle de la webapp (`filtreExclusionSommeil`) : une affaire endormie sort des vues par défaut.
            parametres["or"] = f"(snoozed_until.is.null,snoozed_until.lte.{maintenant.isoformat()})"
        parametres["select"] = colonnes
        lignes = _lignes(await crm.lire(appel.jeton, "cards", parametres), "workspace", workspace)
        return {
            "offset": offset,
            "has_more": len(lignes) > limit,
            "cards": [resume_carte(l) for l in lignes[:limit]],
        }

    moteur.enregistrer(
        serveur,
        crm_card_list,
        Declaration(famille="affaires", action="consulter", espace="workspace:workspace", autres=("channel:channel_id",)),
        titre="List affaires (cards)",
        description=(
            "Lists the active affaires (FR: affaires, cards) of a workspace you can read, by title: track, channel, step, "
            "owner, amount, next action and its due date. Filters: channel, words of the title, step name, next action "
            "due (overdue, today, week). Sleeping affaires are left out unless include_snoozed. Paginated."
        ),
    )

    async def crm_card_get(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        fiche = await _fiche(crm, appel.jeton, card_id, COLONNES_FICHE)
        workflow = _lignes(
            await crm.lire(appel.jeton, "workflows", {"id": f"eq.{fiche['workflow_id']}", "select": "id,name"}),
            "card",
            card_id,
        )
        contacts = _lignes(
            await crm.lire(
                appel.jeton,
                "card_contacts",
                {
                    "card_id": f"eq.{card_id}",
                    "select": "contact_id,role,contacts(id,full_name,organizations(id,name))",
                    "order": "created_at.asc",
                },
            ),
            "card",
            card_id,
        )
        valeurs = _lignes(
            await crm.lire(appel.jeton, "card_field_values", {"card_id": f"eq.{card_id}", "select": "field_id,value"}),
            "card",
            card_id,
        )
        champs: dict[str, dict[str, Any]] = {}
        if valeurs:
            lus = _lignes(
                await crm.lire(
                    appel.jeton,
                    "form_fields",
                    {"id": _liste_ids({str(v["field_id"]) for v in valeurs}), "select": "id,key,label,type,options"},
                ),
                "card",
                card_id,
            )
            champs = {str(c["id"]): c for c in lus}
        reponses = []
        for v in valeurs:
            champ = champs.get(str(v["field_id"]))
            if champ is None:
                continue
            reponse: dict[str, Any] = {"field": champ["label"], "key": champ["key"], "type": champ["type"], "value": v["value"]}
            choix = ((champ.get("options") or {}).get("choices") or []) if isinstance(champ.get("options"), dict) else []
            libelles = {c.get("key"): c.get("label") for c in choix if isinstance(c, dict)}
            if isinstance(v["value"], str) and v["value"] in libelles:
                reponse["value_label"] = libelles[v["value"]]
            reponses.append(reponse)
        resume = resume_carte(fiche)
        return {
            **resume,
            "description": fiche.get("description"),
            "probability": probabilite(fiche),
            "workflow": {"id": fiche["workflow_id"], "name": workflow[0]["name"] if workflow else None},
            "entered_step_at": fiche.get("entered_step_at"),
            "archived": fiche.get("archived_at") is not None,
            "email_local_part": fiche.get("email_local_part"),
            # La capacité rendue par la base (`CRM-093`) : ce que la personne peut écrire sur cette affaire.
            "can_write": fiche.get("ecriture_permise") is True,
            "created_at": fiche.get("created_at"),
            "updated_at": fiche.get("updated_at"),
            "contacts": [
                {
                    "id": c["contact_id"],
                    "name": (c.get("contacts") or {}).get("full_name"),
                    "organization": ((c.get("contacts") or {}).get("organizations") or {}).get("name"),
                    "role": c.get("role"),
                }
                for c in contacts
            ],
            "form_answers": reponses,
        }

    moteur.enregistrer(
        serveur,
        crm_card_get,
        Declaration(famille="affaires", action="consulter", espace="card:card_id"),
        titre="Read an affaire (card)",
        description=(
            "Reads one affaire (card): title, description, track, channel, workflow and step, owner, amount and currency, "
            "probability (the affaire's own, else its step's, else its node's), next action and due date, sleep, the "
            "linked contacts with their role, the form answers by label, and can_write — whether the CRM lets you change "
            "it."
        ),
    )

    async def crm_card_timeline(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        fiche = await _fiche(crm, appel.jeton, card_id, "id,workflow_id")
        parametres = {"card_id": f"eq.{card_id}", "order": "created_at.asc,id.asc"}
        evenements = _lignes(
            await crm.lire(appel.jeton, "card_events", {**parametres, "select": COLONNES_EVENEMENT}), "card", card_id
        )
        commentaires = _lignes(
            await crm.lire(appel.jeton, "card_comments", {**parametres, "select": COLONNES_COMMENTAIRE}), "card", card_id
        )
        activites = _lignes(
            await crm.lire(appel.jeton, "card_activities", {"card_id": f"eq.{card_id}", "select": COLONNES_ACTIVITE}),
            "card",
            card_id,
        )
        etapes = {
            str(e["id"]): (e.get("noeud") or {}).get("label")
            for e in _lignes(
                await crm.lire(
                    appel.jeton,
                    "workflow_steps",
                    {"workflow_id": f"eq.{fiche['workflow_id']}", "select": "id,noeud:workflow_nodes_catalog(label)"},
                ),
                "card",
                card_id,
            )
        }
        ids_champs = {str(e["payload"].get("field_id")) for e in evenements if isinstance(e.get("payload"), dict) and e["payload"].get("field_id")}
        ids_contacts = {str(e["payload"].get("contact_id")) for e in evenements if isinstance(e.get("payload"), dict) and e["payload"].get("contact_id")}
        champs: dict[str, str] = {}
        if ids_champs:
            champs = {
                str(c["id"]): c["label"]
                for c in _lignes(
                    await crm.lire(appel.jeton, "form_fields", {"id": _liste_ids(ids_champs), "select": "id,label"}),
                    "card",
                    card_id,
                )
            }
        noms: dict[str, str] = {}
        if ids_contacts:
            # Un contact supprimé ou caché n'est pas rendu : la ligne garde son type, sans nom (§14.6).
            noms = {
                str(c["id"]): c["full_name"]
                for c in _lignes(
                    await crm.lire(appel.jeton, "contacts", {"id": _liste_ids(ids_contacts), "select": "id,full_name"}),
                    "card",
                    card_id,
                )
            }
        fil = fusionner_fil(
            [
                {
                    "id": e["id"],
                    "at": e["created_at"],
                    "type": e["type"],
                    "actor": (e.get("acteur") or {}).get("full_name"),
                    "detail": detail_evenement(
                        e["type"], e["payload"] if isinstance(e.get("payload"), dict) else {}, etapes, champs, noms
                    ),
                }
                for e in evenements
            ],
            [ligne_commentaire(c) for c in commentaires],
            [ligne_activite(a) for a in activites],
        )
        return {"total": len(fil), "offset": offset, "order": "oldest first", "entries": fil[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_card_timeline,
        Declaration(famille="affaires", action="consulter", espace="card:card_id"),
        titre="Timeline of an affaire (historique)",
        description=(
            "The history of an affaire (card), oldest first, as in the web app: events written by the CRM (created, "
            "moved with both step names, field changed, contact linked, snoozed, stalled…), comments, and activities "
            "(calls, meetings, visios) placed at the date they happened. Names are resolved; a name the CRM no longer "
            "shows is left out. Paginated."
        ),
    )

    async def crm_card_comment_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        await _fiche(crm, appel.jeton, card_id, "id")
        commentaires = _lignes(
            await crm.lire(
                appel.jeton,
                "card_comments",
                {"card_id": f"eq.{card_id}", "select": COLONNES_COMMENTAIRE, "order": "created_at.asc,id.asc"},
            ),
            "card",
            card_id,
        )
        lignes = [ligne_commentaire(c) for c in commentaires]
        return {"total": len(lignes), "offset": offset, "order": "oldest first", "comments": lignes[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_card_comment_list,
        Declaration(famille="affaires", action="consulter", espace="card:card_id"),
        titre="Comments of an affaire (commentaires)",
        description=(
            "Lists the comments of an affaire (card), oldest first. A deleted comment keeps its place without its text, "
            "and says when it was removed by a workspace administrator (moderation). Paginated."
        ),
    )

    async def crm_card_activity_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        await _fiche(crm, appel.jeton, card_id, "id")
        activites = _lignes(
            await crm.lire(
                appel.jeton,
                "card_activities",
                {"card_id": f"eq.{card_id}", "select": COLONNES_ACTIVITE, "order": "occurred_at.desc,id.desc"},
            ),
            "card",
            card_id,
        )
        lignes = [ligne_activite(a) for a in activites]
        return {"total": len(lignes), "offset": offset, "order": "most recent first", "activities": lignes[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_card_activity_list,
        Declaration(famille="affaires", action="consulter", espace="card:card_id"),
        titre="Activities of an affaire (appels, réunions, visios)",
        description=(
            "Lists the activities that took place on an affaire (card), most recent first: type (call, meeting, visio), "
            "date, duration, subject, report (FR: compte rendu), author, participants (contacts and members). A retired "
            "activity keeps its date only. Paginated."
        ),
    )

    async def crm_stale_card_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(appel.jeton, "cards_figees", {}, idempotent=True)
        lignes = [l for l in _lignes(reponse, "workspace", workspace) if l.get("workspace_id") == appel.espace]
        # Le rang de l'écran « Affaires figées » : du plus gros retard au plus petit, puis le titre.
        lignes.sort(key=lambda l: (-int(l.get("retard_jours") or 0), str(l.get("title")), str(l.get("card_id"))))
        page = lignes[offset : offset + limit]
        etapes: dict[str, str] = {}
        channels: dict[str, str] = {}
        if page:
            etapes = {
                str(e["id"]): (e.get("noeud") or {}).get("label")
                for e in _lignes(
                    await crm.lire(
                        appel.jeton,
                        "workflow_steps",
                        {"id": _liste_ids({str(l["step_id"]) for l in page}), "select": "id,noeud:workflow_nodes_catalog(label)"},
                    ),
                    "workspace",
                    workspace,
                )
            }
            channels = {
                str(c["id"]): c["name"]
                for c in _lignes(
                    await crm.lire(
                        appel.jeton, "channels", {"id": _liste_ids({str(l["channel_id"]) for l in page}), "select": "id,name"}
                    ),
                    "workspace",
                    workspace,
                )
            }
        return {
            "total": len(lignes),
            "offset": offset,
            "cards": [
                {
                    "id": l["card_id"],
                    "title": l["title"],
                    "channel": {"id": l["channel_id"], "name": channels.get(str(l["channel_id"]))},
                    "step": {"id": l["step_id"], "name": etapes.get(str(l["step_id"]))},
                    "entered_step_at": l["entered_step_at"],
                    "threshold_days": l["seuil_jours"],
                    "days_in_step": l["jours_dans_etape"],
                    "overdue_days": l["retard_jours"],
                }
                for l in page
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_stale_card_list,
        Declaration(famille="affaires", action="consulter", espace="workspace:workspace"),
        titre="Stale affaires (affaires figées)",
        description=(
            "Lists the affaires (cards) of the workspace that stayed in their step longer than the step's reminder "
            "threshold (FR: affaires figées), biggest delay first, with the threshold and the delay in days. Archived, "
            "trashed and sleeping affaires are not stale."
        ),
    )

    async def crm_card_mine(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        scope: Annotated[str, Field(description="mine (affaires you own) or all (all you can read)")] = "mine",
        timezone: Annotated[str, Field(description="IANA time zone that decides what « today » is")] = "Europe/Paris",
    ) -> dict[str, Any]:
        appel = appel_courant()
        if scope not in PORTEES:
            raise ToolError("scope must be mine or all.")
        maintenant = datetime.now(UTC)
        bornes = bornes_journee(maintenant, _fuseau(timezone))
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "next_action_at": f"lt.{bornes[2].isoformat()}",
            "archived_at": "is.null",
            "deleted_at": "is.null",
            "or": f"(snoozed_until.is.null,snoozed_until.lte.{maintenant.isoformat()})",
            "order": "next_action_at.asc,title.asc,id.asc",
            "select": COLONNES_LISTE,
        }
        if scope == "mine":
            parametres["owner_id"] = f"eq.{appel.sujet}"
        lignes = _lignes(await crm.lire(appel.jeton, "cards", parametres), "workspace", workspace)
        sections: dict[str, list[dict[str, Any]]] = {"overdue": [], "today": [], "upcoming": []}
        for ligne in lignes:
            section = section_echeance(str(ligne["next_action_at"]), bornes)
            if section is not None:
                sections[section].append(resume_carte(ligne))
        return {"timezone": timezone, "horizon_days": HORIZON_JOURS, "scope": scope, **sections}

    moteur.enregistrer(
        serveur,
        crm_card_mine,
        Declaration(famille="affaires", action="consulter", espace="workspace:workspace"),
        titre="My day (Ma journée)",
        description=(
            "The affaires (cards) whose next action is due, in three groups: overdue, today, and upcoming within seven "
            "days — for the affaires you own (scope mine) or all you can read (scope all). Archived, trashed and sleeping "
            "affaires are left out."
        ),
    )

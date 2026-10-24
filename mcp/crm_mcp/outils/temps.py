# @spec CRM-104 (docs/BACKLOG.md) — tranche T5 : les trois outils de la famille `temps` (décisions 671 et 672)
# @spec docs/SPEC-mcp.md §9.2 octies (la liste fixée, la personne nommée faute d'ancre « profil », 0 qui vide la case
#       sous `modifier`, les refus nommés), §9.1 (les lectures et écritures de la webapp : `saisie-temps.ts`,
#       `rapport-temps.ts`), §9.3 ; docs/SPEC-temps.md (la grille, le plafond journalier, `temps_valorise`)
"""Le temps passé, sous l'identité de la personne : lire ses saisies et le rapport valorisé, poser une case.

Les mêmes tables et la même fonction que la webapp (`saisies_temps`, `temps_valorise`) ; la base tient l'unicité de la
case, la forme des minutes, le plafond journalier et `app.saisie_temps_permise`.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.outils.affaires_ecriture import choisir_par_nom
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus
from crm_mcp.rentabilite import au_centime

PERIODE_MAX_JOURS = 93
COLONNES_SAISIE = (
    "id,profile_id,jour,minutes,track_id,channel_id,card_id,"
    "track:tracks!saisies_temps_track_fkey(name),channel:channels!saisies_temps_channel_fkey(name),"
    "card:cards!saisies_temps_card_fkey(title)"
)
COLONNES_ECRITE = "id,profile_id,jour,minutes,track_id,channel_id,card_id"


def _refus(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    if "plafond journalier" in message:
        return RefusCrm(
            "Refusé par le CRM : daily_limit — this day's total would exceed the daily limit for this person."
        )
    if corps.get("code") == "23514" and "saisies_temps_minutes_check" in message:
        return RefusCrm("Refusé par le CRM : saisies_temps_minutes_check — minutes must be quarter hours, up to 420.")
    if corps.get("code") == "42501":
        return RefusCrm(
            "Refusé par le CRM : entry_not_allowed — you may enter your own time, or an administrator for a member, on "
            "a target that person can read."
        )
    return traduire_refus(reponse, genre, valeur)


def periode(debut: str, fin: str) -> tuple[str, str]:
    """Deux dates `YYYY-MM-DD`, dans l'ordre, sur 93 jours au plus — la borne d'une lecture que rien d'autre ne pagine."""
    try:
        d, f = date.fromisoformat(debut), date.fromisoformat(fin)
    except ValueError as erreur:
        raise ToolError("date_from and date_to must be dates YYYY-MM-DD.") from erreur
    if f < d:
        raise ToolError("date_to must not be before date_from.")
    if (f - d).days >= PERIODE_MAX_JOURS:
        raise ToolError(f"The period is limited to {PERIODE_MAX_JOURS} days.")
    return d.isoformat(), f.isoformat()


def cible_unique(track_id: str | None, channel_id: str | None, card_id: str | None) -> tuple[str, str]:
    """La colonne et l'identifiant de l'unique cible donnée (`saisies_temps_cible_check`)."""
    donnees = [(c, v) for c, v in (("track_id", track_id), ("channel_id", channel_id), ("card_id", card_id)) if v]
    if len(donnees) != 1:
        raise ToolError("Give exactly one target: track_id, channel_id or card_id.")
    return donnees[0]


def saisie_lue(s: dict[str, Any]) -> dict[str, Any]:
    if s.get("card_id"):
        cible = {"kind": "card", "id": s["card_id"], "name": (s.get("card") or {}).get("title")}
    elif s.get("channel_id"):
        cible = {"kind": "channel", "id": s["channel_id"], "name": (s.get("channel") or {}).get("name")}
    else:
        cible = {"kind": "track", "id": s.get("track_id"), "name": (s.get("track") or {}).get("name")}
    return {"id": s["id"], "person_id": s["profile_id"], "date": s["jour"], "minutes": s["minutes"], "target": cible}


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def membres(jeton: str, espace: str, genre: str, valeur: Any) -> list[dict[str, Any]]:
        reponse = await crm.lire(
            jeton, "workspace_members", {"workspace_id": f"eq.{espace}", "select": "user_id,profiles(full_name)"}
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, genre, valeur)
        return [{"id": m["user_id"], "nom": (m.get("profiles") or {}).get("full_name")} for m in reponse.corps]

    async def personne(jeton: str, espace: str, sujet: str | None, nom: str | None, workspace: str) -> str:
        """Vous par défaut ; sinon le seul membre de l'espace qui porte ce nom."""
        if nom is None or not nom.strip():
            if not sujet:
                raise ToolError("Your identity is unknown to the connector.")
            return sujet
        return choisir_par_nom(await membres(jeton, espace, "workspace", workspace), nom, "member")

    async def crm_time_entry_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        date_from: Annotated[str, Field(description="YYYY-MM-DD")],
        date_to: Annotated[str, Field(description="YYYY-MM-DD; at most 93 days after date_from")],
        person: Annotated[str | None, Field(description="Full name of a member; you by default")] = None,
        everyone: Annotated[bool, Field(description="All members' entries the CRM lets you read")] = False,
        track_id: Annotated[str | None, Field(description="Optional: only entries on this track")] = None,
        channel_id: Annotated[str | None, Field(description="Optional: only entries on this channel")] = None,
        card_id: Annotated[str | None, Field(description="Optional: only entries on this affaire")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        debut, fin = periode(date_from, date_to)
        if everyone and person is not None:
            raise ToolError("Give person or everyone, not both.")
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "and": f"(jour.gte.{debut},jour.lte.{fin})",
            "select": COLONNES_SAISIE,
            "order": "jour.asc,id.asc",
        }
        if not everyone:
            parametres["profile_id"] = f"eq.{await personne(appel.jeton, appel.espace, appel.sujet, person, workspace)}"
        for colonne, valeur in (("track_id", track_id), ("channel_id", channel_id), ("card_id", card_id)):
            if valeur is not None:
                parametres[colonne] = f"eq.{valeur}"
        reponse = await crm.lire(appel.jeton, "saisies_temps", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        saisies = [saisie_lue(s) for s in reponse.corps]
        return {
            "date_from": debut,
            "date_to": fin,
            "total_minutes": sum(int(s["minutes"]) for s in saisies),
            "entries": saisies,
        }

    moteur.enregistrer(
        serveur,
        crm_time_entry_list,
        Declaration(
            famille="temps",
            action="consulter",
            espace="workspace:workspace",
            autres=("track:track_id", "channel:channel_id", "card:card_id"),
        ),
        titre="List time entries (temps)",
        description=(
            "Lists time entries (FR: saisies de temps) over a period of at most 93 days: yours by default, a named "
            "member's, or everyone's the CRM lets you read (only administrators read others'). Each entry gives its day, "
            "minutes and target (track, channel or affaire). Optional filter on one target."
        ),
    )

    async def crm_time_report(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        date_from: Annotated[str, Field(description="YYYY-MM-DD")],
        date_to: Annotated[str, Field(description="YYYY-MM-DD; at most 93 days after date_from")],
        person: Annotated[str | None, Field(description="Optional full name of a member")] = None,
        track_id: Annotated[str | None, Field(description="Optional track id")] = None,
        card_id: Annotated[str | None, Field(description="Optional affaire (card) id")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        debut, fin = periode(date_from, date_to)
        arguments: dict[str, Any] = {"p_debut": debut, "p_fin": fin}
        if person is not None:
            arguments["p_profile"] = await personne(appel.jeton, appel.espace, appel.sujet, person, workspace)
        if track_id is not None:
            arguments["p_track"] = track_id
        if card_id is not None:
            arguments["p_card"] = card_id
        reponse = await crm.rpc(appel.jeton, "temps_valorise", arguments, idempotent=True)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        # La fonction couvre tous les espaces lisibles ; chaque ligne porte son track, et le track dit l'espace.
        tracks = await crm.lire(appel.jeton, "tracks", {"workspace_id": f"eq.{appel.espace}", "select": "id"})
        if not tracks.reussie or not isinstance(tracks.corps, list):
            raise _refus(tracks, "workspace", workspace)
        de_l_espace = {t["id"] for t in tracks.corps}
        lignes = [l for l in reponse.corps if l.get("track_id") in de_l_espace]
        totaux: dict[str, float] = {}
        non_valorisees = 0
        for l in lignes:
            if l.get("montant") is None:
                non_valorisees += int(l["minutes"])
            else:
                totaux[str(l["devise"])] = au_centime(totaux.get(str(l["devise"]), 0.0) + float(l["montant"]))
        return {
            "date_from": debut,
            "date_to": fin,
            "notes": [
                "Amounts are never added across currencies.",
                "Minutes without a staff cost rate are counted apart (unvalued_minutes), never as zero.",
            ],
            "total_minutes": sum(int(l["minutes"]) for l in lignes),
            "unvalued_minutes": non_valorisees,
            "amounts_by_currency": totaux,
            "rows": [
                {
                    "person_id": l["profile_id"],
                    "track_id": l["track_id"],
                    "channel_id": l.get("channel_id"),
                    "card_id": l.get("card_id"),
                    "minutes": int(l["minutes"]),
                    "amount": None if l.get("montant") is None else float(l["montant"]),
                    "currency": l.get("devise"),
                }
                for l in lignes
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_time_report,
        Declaration(
            famille="temps", action="consulter", espace="workspace:workspace", autres=("track:track_id", "card:card_id")
        ),
        titre="Valued time report (temps valorisé)",
        description=(
            "Time spent over a period of at most 93 days, by person and target, with its staff cost where a rate exists "
            "— the monthly report of the web app, within what the CRM lets you read. Optional filters: a named member, "
            "a track, an affaire."
        ),
    )

    async def crm_time_entry_set(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        day: Annotated[str, Field(description="YYYY-MM-DD")],
        minutes: Annotated[int, Field(description="Quarter hours: 0, 15, 30… up to 420; 0 clears the cell", ge=0, le=420)],
        track_id: Annotated[str | None, Field(description="The target: a track…")] = None,
        channel_id: Annotated[str | None, Field(description="…or a channel…")] = None,
        card_id: Annotated[str | None, Field(description="…or an affaire (card)")] = None,
        person: Annotated[str | None, Field(description="Full name of a member; you by default")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if minutes % 15 != 0:
            raise ToolError("minutes must be a multiple of 15.")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise ToolError("day must be a date YYYY-MM-DD.")
        colonne, cible = cible_unique(track_id, channel_id, card_id)
        qui = await personne(appel.jeton, appel.espace, appel.sujet, person, workspace)
        existante = await crm.lire(
            appel.jeton,
            "saisies_temps",
            {"profile_id": f"eq.{qui}", "jour": f"eq.{day}", colonne: f"eq.{cible}", "select": "id"},
        )
        if not existante.reussie or not isinstance(existante.corps, list):
            raise _refus(existante, "workspace", workspace)
        if existante.corps:
            ident = existante.corps[0]["id"]
            if minutes == 0:
                reponse = await crm.ecrire(
                    appel.jeton, "DELETE", "saisies_temps", parametres={"id": f"eq.{ident}", "select": COLONNES_ECRITE}
                )
            else:
                reponse = await crm.ecrire(
                    appel.jeton,
                    "PATCH",
                    "saisies_temps",
                    parametres={"id": f"eq.{ident}", "select": COLONNES_ECRITE},
                    corps={"minutes": minutes},
                )
        elif minutes == 0:
            return {"cleared": True, "entry": None}
        else:
            reponse = await crm.ecrire(
                appel.jeton,
                "POST",
                "saisies_temps",
                parametres={"select": COLONNES_ECRITE},
                corps={
                    "workspace_id": appel.espace,
                    "profile_id": qui,
                    "jour": day,
                    "minutes": minutes,
                    "track_id": track_id,
                    "channel_id": channel_id,
                    "card_id": card_id,
                },
            )
        if not reponse.reussie:
            raise _refus(reponse, "workspace", workspace)
        lignes = reponse.corps if isinstance(reponse.corps, list) else []
        if len(lignes) != 1:
            raise RefusCrm(introuvable("workspace", workspace))
        if minutes == 0:
            return {"cleared": True, "entry": None}
        ligne = lignes[0]
        return {
            "cleared": False,
            "entry": {"id": ligne["id"], "person_id": ligne["profile_id"], "date": ligne["jour"], "minutes": ligne["minutes"],
                      "target": {"kind": colonne.removesuffix("_id"), "id": cible}},
        }

    moteur.enregistrer(
        serveur,
        crm_time_entry_set,
        Declaration(
            famille="temps",
            action="modifier",
            espace="workspace:workspace",
            autres=("track:track_id", "channel:channel_id", "card:card_id"),
        ),
        titre="Set a time entry (saisie de temps)",
        description=(
            "Sets the minutes a person (you by default, or a named member — administrators only) spent one day on one "
            "target (a track, a channel or an affaire), as one cell of the time grid: the cell is created or replaced, "
            "and 0 clears it. Quarter hours only; the CRM refuses a day over the daily limit."
        ),
    )

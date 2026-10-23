# @spec CRM-108 (docs/BACKLOG.md) — tranche T4 : les huit outils de la famille `recettes`
# @spec docs/SPEC-recettes.md §2 (lignes, réels, réel dérivé, soldée, devise de l'affaire), §4 (la règle de rentabilité,
#       appliquée par `crm_mcp/rentabilite.py`), §5 (`rentabilite_affaires`, réservée aux administrateurs), §6.4 (« à
#       saisir »), §7 (catalogue, ancres, cases `aussi`, aucun outil de suppression) ; docs/SPEC-mcp.md §9.1 (déclaration,
#       `readOnlyHint`, aucun chemin parallèle), §9.3 (JSON structuré, `limit` ≤ 100, refus traduits)
"""Recettes d'une affaire et rentabilité, sous l'identité de la personne.

Les mêmes tables et la même fonction que la webapp (`card_revenues`, `card_revenue_actuals`, `rentabilite_affaires`) ;
la base tient le réel dérivé, la ligne soldée figée, la devise verrouillée et la garde des administrateurs.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus
from crm_mcp.rentabilite import au_centime, calculer_rentabilite

LIMITE_MAX = 100
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ETATS = {"all": None, "won": "won", "open": "open", "lost": "lost"}

#: Les refus nommés de la base, traduits pour le modèle (docs/SPEC-mcp.md §9.3) : le code et une phrase.
REFUS_NOMMES = {
    "ligne soldee": "Refusé par le CRM : ligne soldée — rouvrez-la (crm_card_revenue_settle, settled=false) avant d'y "
    "ajouter, modifier ou retirer une recette réelle.",
    "reel derive": "Refusé par le CRM : la recette réelle d'une ligne est la somme de ses recettes réelles ; ajoutez-en "
    "une (crm_card_revenue_actual_add) au lieu de l'écrire.",
    "un reel ne change pas de ligne": "Refusé par le CRM : une recette réelle ne change pas de ligne.",
}
RAPPORT_RESERVE = (
    "Refusé par le CRM : rentabilite_reservee — the profitability report (FR: rentabilité) is reserved to workspace "
    "administrators, because it subtracts the whole team's staff cost."
)

COLONNES_LIGNE = "id,label,estimated_amount,actual_amount,settled_at,position,card_revenue_actuals(id,amount,received_on,label)"


def _refus(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    message = reponse.message
    if isinstance(message, str) and message in REFUS_NOMMES:
        return RefusCrm(REFUS_NOMMES[message])
    if isinstance(message, str) and message == "rentabilite_reservee":
        return RefusCrm(RAPPORT_RESERVE)
    return traduire_refus(reponse, genre, valeur)


def _une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    """L'unique ligne touchée par une écriture ; zéro ligne est le refus silencieux d'une clause `USING`."""
    if not reponse.reussie:
        raise _refus(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def _date(valeur: str | None, nom: str) -> str | None:
    if valeur is None:
        return None
    if not _DATE.match(valeur):
        raise ToolError(f"{nom} must be a date YYYY-MM-DD.")
    return valeur


def _montants(ligne: dict[str, Any]) -> dict[str, Any]:
    """Une ligne de `rentabilite_affaires`, aux noms de la règle partagée (`tests/rentabilite_cas.json`)."""

    def n(cle: str) -> float | None:
        v = ligne.get(cle)
        return None if v is None else float(v)

    return {
        "recettesPrevues": n("recettes_prevues"),
        "recettesReelles": n("recettes_reelles"),
        "lignesRecette": int(ligne.get("lignes_recette") or 0),
        "lignesRecetteSansReel": int(ligne.get("lignes_recette_sans_reel") or 0),
        "coutsPrevus": n("couts_prevus"),
        "coutsReels": n("couts_reels"),
        "lignesCout": int(ligne.get("lignes_cout") or 0),
        "lignesCoutSansReel": int(ligne.get("lignes_cout_sans_reel") or 0),
        "personnel": n("personnel"),
        "minutes": int(ligne.get("minutes") or 0),
        "minutesNonValorisees": int(ligne.get("minutes_non_valorisees") or 0),
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_card_revenue_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        carte = await crm.lire(appel.jeton, "cards", {"id": f"eq.{card_id}", "select": "id,title,currency"})
        cartes = carte.corps if carte.reussie and isinstance(carte.corps, list) else []
        if len(cartes) != 1:
            raise RefusCrm(introuvable("card", card_id))
        lignes = await crm.lire(
            appel.jeton,
            "card_revenues",
            {"card_id": f"eq.{card_id}", "select": COLONNES_LIGNE, "order": "position.asc,created_at.asc"},
        )
        if not lignes.reussie or not isinstance(lignes.corps, list):
            raise _refus(lignes, "card", card_id)
        return {
            "card": {"id": cartes[0]["id"], "title": cartes[0]["title"]},
            "currency": cartes[0]["currency"],
            "note": "actual_amount null means unknown (not zero); a settled line without actuals is 0.",
            "revenue_lines": lignes.corps,
        }

    moteur.enregistrer(
        serveur,
        crm_card_revenue_list,
        Declaration(famille="recettes", action="consulter", espace="card:card_id"),
        titre="List revenue lines of an affaire (recettes)",
        description=(
            "Lists the revenue lines (FR: lignes de recette) of an affaire (card): label, estimated amount, actual amount "
            "(the sum of its actuals, kept by the CRM), settled state, and each actual (amount, received_on, label). "
            "Amounts are in the affaire's currency, returned once."
        ),
    )

    async def crm_revenues_to_enter(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(
            appel.jeton,
            "card_revenues",
            {
                "settled_at": "is.null",
                "cards.deleted_at": "is.null",
                "cards.workspace_id": f"eq.{appel.espace}",
                "select": "id,label,estimated_amount,actual_amount,created_at,recette_saisissable,"
                "cards!inner(id,title,currency,workspace_id,deleted_at)",
                "order": "created_at.asc,label.asc",
            },
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        lignes = [
            {
                "id": l["id"],
                "label": l["label"],
                "estimated_amount": l["estimated_amount"],
                "already_entered": l["actual_amount"],
                "created_at": l["created_at"],
                "you_can_enter": l.get("recette_saisissable") is True,
                "card": {"id": l["cards"]["id"], "title": l["cards"]["title"]},
                "currency": l["cards"]["currency"],
            }
            for l in reponse.corps
        ]
        return {"total": len(lignes), "offset": offset, "revenue_lines": lignes[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_revenues_to_enter,
        Declaration(famille="recettes", action="consulter", espace="workspace:workspace"),
        titre="Revenue lines awaiting actuals (recettes à saisir)",
        description=(
            "Lists the unsettled revenue lines of the workspace you can read, oldest first — the « À saisir » tab. "
            "`you_can_enter` says whether the CRM lets you add actuals to that line."
        ),
    )

    async def crm_profitability_report(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        date_from: Annotated[str | None, Field(description="Optional YYYY-MM-DD; filters actuals and time by date")] = None,
        date_to: Annotated[str | None, Field(description="Optional YYYY-MM-DD")] = None,
        state: Annotated[str, Field(description="all, won, open or lost")] = "all",
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if state not in ETATS:
            raise ToolError("state must be one of all, won, open, lost.")
        arguments = {
            k: v
            for k, v in (("p_debut", _date(date_from, "date_from")), ("p_fin", _date(date_to, "date_to")))
            if v is not None
        }
        reponse = await crm.rpc(appel.jeton, "rentabilite_affaires", arguments, idempotent=True)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        lignes = [
            l
            for l in reponse.corps
            if l.get("workspace_id") == appel.espace and (ETATS[state] is None or l.get("node_kind") == ETATS[state])
        ]
        devises: dict[str, set[str]] = {}
        for l in lignes:
            devises.setdefault(str(l["card_id"]), set()).add(str(l["currency"]))
        rangs = []
        totaux: dict[str, dict[str, float]] = {}
        for l in lignes:
            calculable = len(devises[str(l["card_id"])]) <= 1
            m = _montants(l)
            reel = calculer_rentabilite(m, "reel", calculable)
            prevu = calculer_rentabilite(m, "prevu", calculable)
            rangs.append(
                {
                    "card_id": l["card_id"],
                    "track_id": l["track_id"],
                    "channel_id": l["channel_id"],
                    "state": l["node_kind"],
                    "archived": l.get("archivee") is True,
                    "currency": l["currency"],
                    "actual": reel,
                    "planned": prevu,
                }
            )
            t = totaux.setdefault(str(l["currency"]), {"revenues": 0.0, "costs": 0.0, "staff": 0.0})
            t["revenues"] = au_centime(t["revenues"] + (reel["recettes"] or 0))
            t["costs"] = au_centime(t["costs"] + (reel["couts"] or 0))
            t["staff"] = au_centime(t["staff"] + (reel["personnel"] or 0))
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "notes": [
                "Currencies are never added together: one row per affaire and currency.",
                "margin = revenues − costs − staff cost; `partielle` lists what is still unknown.",
                "The planned margin subtracts the staff time already spent: the CRM does not forecast time.",
                "With a period, actuals and time are filtered by date; planned amounts cover the whole affaire.",
            ],
            "total": len(rangs),
            "offset": offset,
            "actual_totals_by_currency": totaux,
            "rows": rangs[offset : offset + limit],
        }

    moteur.enregistrer(
        serveur,
        crm_profitability_report,
        Declaration(
            famille="recettes",
            action="consulter",
            espace="workspace:workspace",
            aussi=(("budgets", "consulter"), ("temps", "consulter")),
        ),
        titre="Profitability report (rentabilité)",
        description=(
            "Profitability of the workspace's affaires (FR: rentabilité): revenues, costs and staff cost per affaire and "
            "currency, actual and planned margins, margin rate, and whether a margin is partial. Reserved by the CRM to "
            "workspace administrators."
        ),
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_card_revenue_add(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        label: Annotated[str, Field(description="Nature of the line, e.g. Acompte, Solde", min_length=1, max_length=200)],
        estimated_amount: Annotated[float, Field(description="Planned revenue, in the affaire's currency")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "card_revenues",
            parametres={"select": "id,label,estimated_amount,actual_amount,settled_at,position"},
            corps={"card_id": card_id, "label": label, "estimated_amount": estimated_amount},
        )
        return {"revenue_line": _une_ligne(reponse, "card", card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_revenue_add,
        Declaration(famille="recettes", action="ajouter", espace="card:card_id"),
        titre="Add a revenue line (ligne de recette)",
        description=(
            "Adds a revenue line to an affaire (card) with its label and planned amount, in the affaire's currency. "
            "Actual revenues are added afterwards with crm_card_revenue_actual_add."
        ),
    )

    async def crm_card_revenue_actual_add(
        revenue_id: Annotated[str, Field(description="The revenue line id")],
        amount: Annotated[float, Field(description="Amount received or invoiced; 0 allowed, negative for a credit note")],
        received_on: Annotated[str | None, Field(description="YYYY-MM-DD; today by default")] = None,
        label: Annotated[str | None, Field(description="Optional, e.g. an invoice number", max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {"card_revenue_id": revenue_id, "amount": amount}
        if _date(received_on, "received_on") is not None:
            corps["received_on"] = received_on
        if label is not None and label.strip():
            corps["label"] = label.strip()
        reponse = await crm.ecrire(
            appel.jeton, "POST", "card_revenue_actuals", parametres={"select": "id,amount,received_on,label"}, corps=corps
        )
        return {"actual": _une_ligne(reponse, "revenue", revenue_id)}

    moteur.enregistrer(
        serveur,
        crm_card_revenue_actual_add,
        Declaration(famille="recettes", action="ajouter", espace="revenue:revenue_id"),
        titre="Add an actual revenue (recette réelle)",
        description=(
            "Adds an actual revenue (invoice or payment) to a revenue line; the line's actual amount becomes the sum of "
            "its actuals. Refused on a settled line."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_card_revenue_update(
        revenue_id: Annotated[str, Field(description="The revenue line id")],
        label: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        estimated_amount: Annotated[float | None, Field()] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps = {k: v for k, v in (("label", label), ("estimated_amount", estimated_amount)) if v is not None}
        if not corps:
            raise ToolError("Give label and/or estimated_amount.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_revenues",
            parametres={"id": f"eq.{revenue_id}", "select": "id,label,estimated_amount,actual_amount,settled_at"},
            corps=corps,
        )
        return {"revenue_line": _une_ligne(reponse, "revenue", revenue_id)}

    moteur.enregistrer(
        serveur,
        crm_card_revenue_update,
        Declaration(famille="recettes", action="modifier", espace="revenue:revenue_id"),
        titre="Update a revenue line (ligne de recette)",
        description="Changes the label and/or the planned amount of a revenue line. Its actual amount is not writable.",
    )

    async def crm_card_revenue_actual_update(
        revenue_actual_id: Annotated[str, Field(description="The actual revenue id")],
        amount: Annotated[float | None, Field()] = None,
        received_on: Annotated[str | None, Field(description="YYYY-MM-DD")] = None,
        label: Annotated[str | None, Field(max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {}
        if amount is not None:
            corps["amount"] = amount
        if _date(received_on, "received_on") is not None:
            corps["received_on"] = received_on
        if label is not None:
            corps["label"] = label.strip() or None
        if not corps:
            raise ToolError("Give amount, received_on and/or label.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_revenue_actuals",
            parametres={"id": f"eq.{revenue_actual_id}", "select": "id,amount,received_on,label"},
            corps=corps,
        )
        return {"actual": _une_ligne(reponse, "revenue_actual", revenue_actual_id)}

    moteur.enregistrer(
        serveur,
        crm_card_revenue_actual_update,
        Declaration(famille="recettes", action="modifier", espace="revenue_actual:revenue_actual_id"),
        titre="Correct an actual revenue (recette réelle)",
        description="Corrects the amount, date or label of an actual revenue. Refused on a settled line.",
    )

    async def crm_card_revenue_settle(
        revenue_id: Annotated[str, Field(description="The revenue line id")],
        settled: Annotated[bool, Field(description="true to settle (FR: soldé), false to reopen")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_revenues",
            parametres={"id": f"eq.{revenue_id}", "select": "id,label,actual_amount,settled_at"},
            # Un drapeau : la base pose l'horodatage et l'auteur (docs/SPEC-recettes.md §2.3).
            corps={"settled_at": datetime.now(UTC).isoformat() if settled else None},
        )
        return {"revenue_line": _une_ligne(reponse, "revenue", revenue_id)}

    moteur.enregistrer(
        serveur,
        crm_card_revenue_settle,
        Declaration(famille="recettes", action="modifier", espace="revenue:revenue_id"),
        titre="Settle or reopen a revenue line (soldé)",
        description=(
            "Settles a revenue line (no more actuals; with none, its actual amount becomes 0) or reopens it."
        ),
    )

# @spec CRM-104 (docs/BACKLOG.md) — tranche T4 : les neuf outils de la famille `budgets` (décisions 668 et 669)
# @spec docs/SPEC-mcp.md §9.2 septies (la liste fixée, les ancres `cost`, `cost_actual` et `occurrence`, les refus nommés, aucune
#       suppression, l'administration des budgets laissée à l'écran), §9.1 (les lectures et écritures de la webapp :
#       `budgets.ts`, `couts-ecrans.ts`, `card-costs.ts`, `reels-ligne.ts`, `couts-a-saisir.ts`), §9.3 ;
#       docs/SPEC-costs.md §2.3 (ligne, occurrence, clôture), §2.3 bis (réels multiples, réel dérivé, ligne soldée)
"""Budgets et lignes de coût d'une affaire, sous l'identité de la personne.

Les mêmes tables que la webapp (`budgets`, `budget_occurrences`, `card_costs`, `card_cost_actuals`) ; la base tient le
réel dérivé, la ligne soldée figée, l'occurrence exigée d'un budget récurrent, le rattachement refusé à ce qui est
clôturé, et la garde d'écriture de l'affaire. Deux devises ne s'additionnent jamais : un budget n'en a qu'une.
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
from crm_mcp.rentabilite import au_centime

LIMITE_MAX = 100
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: Les refus nommés de la base (migration 0088), traduits pour le modèle comme pour les recettes.
REFUS_NOMMES = {
    "ligne soldee": "Refusé par le CRM : ligne soldée — rouvrez-la (crm_card_cost_settle, settled=false) avant d'y "
    "ajouter, modifier ou retirer un coût réel.",
    "reel derive": "Refusé par le CRM : le coût réel d'une ligne est la somme de ses coûts réels ; ajoutez-en un "
    "(crm_card_cost_actual_add) au lieu de l'écrire.",
    "un reel ne change pas de ligne": "Refusé par le CRM : un coût réel ne change pas de ligne.",
}
#: Les contraintes de rattachement de la migration 0051 (`FRAGMENTS_REFUS_COUT` de la webapp), par fragment du message.
FRAGMENTS_RATTACHEMENT = (
    ("doit citer une occurrence", "occurrence_required — this budget is recurrent: give occurrence_id."),
    ("ne cite aucune occurrence", "occurrence_forbidden — this budget is not recurrent: give no occurrence."),
    ("appartient à un autre budget", "occurrence_of_another_budget — the occurrence belongs to another budget."),
    # « clôturée » AVANT « clôturé », qui en est un préfixe : sinon une occurrence close se dirait un budget clos.
    ("est clôturée", "occurrence_closed — a closed occurrence accepts no new attachment."),
    ("est clôturé", "budget_closed — a closed budget accepts no new attachment."),
)

COLONNES_BUDGET = "id,name,currency,is_recurrent,planned_amount,closed_at,stale_after_days,position"
COLONNES_LIGNE = (
    "id,label,estimated_cost,actual_cost,settled_at,budget_id,occurrence_id,"
    "budgets(id,name,currency,is_recurrent,closed_at),budget_occurrences(id,label,closed_at),"
    "card_cost_actuals(id,amount,spent_on,label)"
)
COLONNES_ECRITE = "id,label,estimated_cost,actual_cost,settled_at,budget_id,occurrence_id"
COLONNES_REEL = "id,amount,spent_on,label"


def _refus(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    if message in REFUS_NOMMES:
        return RefusCrm(REFUS_NOMMES[message])
    if corps.get("code") == "23514":
        for fragment, phrase in FRAGMENTS_RATTACHEMENT:
            if fragment in message:
                return RefusCrm(f"Refusé par le CRM : {phrase}")
    if corps.get("code") == "23503":
        return RefusCrm("Refusé par le CRM : missing_reference — the budget or occurrence does not exist.")
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
    if valeur is not None and not _DATE.match(valeur):
        raise ToolError(f"{nom} must be a date YYYY-MM-DD.")
    return valeur


def cumuler(lignes: list[dict[str, Any]]) -> dict[str, Any]:
    """Prévu et réel d'un ensemble de lignes d'une même devise. Un réel nul est INCONNU, jamais zéro : il est compté à
    part (`lines_without_actual`), et le réel cumulé ne somme que les réels connus."""
    prevu = au_centime(sum(float(l.get("estimated_cost") or 0) for l in lignes))
    connus = [float(l["actual_cost"]) for l in lignes if l.get("actual_cost") is not None]
    return {
        "lines": len(lignes),
        "planned": prevu,
        "actual_known": au_centime(sum(connus)),
        "lines_without_actual": len(lignes) - len(connus),
    }


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    # --- consulter -------------------------------------------------------------------------------------------------

    async def crm_budget_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        track_id: Annotated[str | None, Field(description="Optional track id: only its budgets")] = None,
        include_closed: Annotated[bool, Field(description="Also list closed budgets")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "select": f"{COLONNES_BUDGET},track:tracks!inner(id,name,workspace_id)",
            "track.workspace_id": f"eq.{appel.espace}",
            "order": "position.asc,name.asc,id.asc",
        }
        if track_id is not None:
            parametres["track_id"] = f"eq.{track_id}"
        if not include_closed:
            parametres["closed_at"] = "is.null"
        budgets = await crm.lire(appel.jeton, "budgets", parametres)
        if not budgets.reussie or not isinstance(budgets.corps, list):
            raise _refus(budgets, "workspace", workspace)
        ids = [b["id"] for b in budgets.corps]
        par_budget: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
        if ids:
            lignes = await crm.lire(
                appel.jeton,
                "card_costs",
                {"budget_id": f"in.({','.join(ids)})", "select": "budget_id,estimated_cost,actual_cost"},
            )
            if not lignes.reussie or not isinstance(lignes.corps, list):
                raise _refus(lignes, "workspace", workspace)
            for l in lignes.corps:
                par_budget.setdefault(l["budget_id"], []).append(l)
        return {
            "note": "Each budget has one currency; amounts are never added across budgets. A null actual is unknown.",
            "budgets": [
                {
                    **{k: b.get(k) for k in COLONNES_BUDGET.split(",") if k != "position"},
                    "track": {"id": b["track"]["id"], "name": b["track"]["name"]},
                    "costs": cumuler(par_budget.get(b["id"], [])),
                }
                for b in budgets.corps
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_budget_list,
        Declaration(famille="budgets", action="consulter", espace="workspace:workspace", autres=("track:track_id",)),
        titre="List budgets (coûts)",
        description=(
            "Lists the budgets of the workspace's tracks you can read: name, currency, recurrent or not, planned "
            "envelope, closed state, and the planned and known actual costs of their lines. Open budgets only unless "
            "include_closed; optionally one track."
        ),
    )

    async def crm_budget_get(
        budget_id: Annotated[str, Field(description="The budget id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        budget = await crm.lire(
            appel.jeton,
            "budgets",
            {"id": f"eq.{budget_id}", "select": f"{COLONNES_BUDGET},track:tracks(id,name)"},
        )
        fiche = _une_ligne(budget, "budget", budget_id)
        occurrences = await crm.lire(
            appel.jeton,
            "budget_occurrences",
            {
                "budget_id": f"eq.{budget_id}",
                "select": "id,label,period_start,period_end,planned_amount,closed_at",
                "order": "period_start.asc.nullslast,label.asc",
            },
        )
        lignes = await crm.lire(
            appel.jeton,
            "card_costs",
            {
                "budget_id": f"eq.{budget_id}",
                "select": "id,occurrence_id,label,estimated_cost,actual_cost,settled_at,cards(id,title)",
                "order": "created_at.asc,label.asc",
            },
        )
        for reponse in (occurrences, lignes):
            if not reponse.reussie or not isinstance(reponse.corps, list):
                raise _refus(reponse, "budget", budget_id)
        rendues = [
            {
                "id": l["id"],
                "occurrence_id": l.get("occurrence_id"),
                "label": l["label"],
                "estimated_cost": l.get("estimated_cost"),
                "actual_cost": l.get("actual_cost"),
                "settled": l.get("settled_at") is not None,
                "card": None if not l.get("cards") else {"id": l["cards"]["id"], "title": l["cards"]["title"]},
            }
            for l in lignes.corps
        ]
        return {
            **{k: fiche.get(k) for k in COLONNES_BUDGET.split(",") if k != "position"},
            "track": fiche.get("track"),
            "costs": cumuler(lignes.corps),
            "occurrences": [
                {**o, "costs": cumuler([l for l in lignes.corps if l.get("occurrence_id") == o["id"]])}
                for o in occurrences.corps
            ],
            "lines": rendues,
        }

    moteur.enregistrer(
        serveur,
        crm_budget_get,
        Declaration(famille="budgets", action="consulter", espace="budget:budget_id"),
        titre="Read a budget",
        description=(
            "Reads a budget: its envelope, its occurrences (period, planned amount, closed) with planned and known actual "
            "costs each, and its cost lines with their affaire."
        ),
    )

    async def crm_card_cost_list(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        carte = await crm.lire(appel.jeton, "cards", {"id": f"eq.{card_id}", "select": "id,title"})
        cartes = carte.corps if carte.reussie and isinstance(carte.corps, list) else []
        if len(cartes) != 1:
            raise RefusCrm(introuvable("card", card_id))
        lignes = await crm.lire(
            appel.jeton,
            "card_costs",
            {"card_id": f"eq.{card_id}", "select": COLONNES_LIGNE, "order": "created_at.asc,label.asc"},
        )
        if not lignes.reussie or not isinstance(lignes.corps, list):
            raise _refus(lignes, "card", card_id)
        return {
            "card": {"id": cartes[0]["id"], "title": cartes[0]["title"]},
            "note": "Amounts are in each line's budget currency; actual_cost null means unknown (not zero).",
            "cost_lines": [
                {
                    "id": l["id"],
                    "label": l["label"],
                    "estimated_cost": l.get("estimated_cost"),
                    "actual_cost": l.get("actual_cost"),
                    "settled": l.get("settled_at") is not None,
                    "budget": l.get("budgets"),
                    "occurrence": l.get("budget_occurrences"),
                    "actuals": sorted(l.get("card_cost_actuals") or [], key=lambda r: (str(r["spent_on"]), str(r["id"]))),
                }
                for l in lignes.corps
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_card_cost_list,
        Declaration(famille="budgets", action="consulter", espace="card:card_id"),
        titre="List cost lines of an affaire (coûts)",
        description=(
            "Lists the cost lines (FR: lignes de coût) of an affaire (card): label, planned cost, actual cost (the sum of "
            "its actuals, kept by the CRM), settled state, budget and occurrence, and each actual (amount, spent_on, "
            "label)."
        ),
    )

    async def crm_costs_to_enter(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        track_id: Annotated[str | None, Field(description="Optional track id: only lines of its budgets")] = None,
        limit: Annotated[int, Field(ge=1, le=LIMITE_MAX)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "settled_at": "is.null",
            "cards.deleted_at": "is.null",
            "cards.workspace_id": f"eq.{appel.espace}",
            "select": "id,label,estimated_cost,actual_cost,created_at,reel_saisissable,"
            "budgets!inner(id,name,currency,track_id,closed_at),budget_occurrences(id,label,closed_at),"
            "cards!inner(id,title,workspace_id,deleted_at)",
            "order": "created_at.asc,label.asc",
        }
        if track_id is not None:
            parametres["budgets.track_id"] = f"eq.{track_id}"
        reponse = await crm.lire(appel.jeton, "card_costs", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        lignes = [
            {
                "id": l["id"],
                "label": l["label"],
                "estimated_cost": l.get("estimated_cost"),
                "already_entered": l.get("actual_cost"),
                "created_at": l["created_at"],
                "you_can_enter": l.get("reel_saisissable") is True,
                "budget": {"id": l["budgets"]["id"], "name": l["budgets"]["name"], "closed": l["budgets"]["closed_at"] is not None},
                "occurrence": l.get("budget_occurrences"),
                "currency": l["budgets"]["currency"],
                "card": {"id": l["cards"]["id"], "title": l["cards"]["title"]},
            }
            for l in reponse.corps
        ]
        return {"total": len(lignes), "offset": offset, "cost_lines": lignes[offset : offset + limit]}

    moteur.enregistrer(
        serveur,
        crm_costs_to_enter,
        Declaration(famille="budgets", action="consulter", espace="workspace:workspace", autres=("track:track_id",)),
        titre="Cost lines awaiting actuals (coûts à saisir)",
        description=(
            "Lists the unsettled cost lines of the workspace you can read, oldest first — the « À saisir » tab. "
            "`you_can_enter` says whether the CRM lets you add actuals to that line."
        ),
    )

    # --- ajouter ---------------------------------------------------------------------------------------------------

    async def crm_card_cost_add(
        card_id: Annotated[str, Field(description="The affaire (card) id")],
        budget_id: Annotated[str, Field(description="An open budget, from crm_budget_list")],
        label: Annotated[str, Field(description="Nature of the cost, e.g. Licences, Sous-traitance", min_length=1, max_length=200)],
        estimated_cost: Annotated[float, Field(description="Planned cost, in the budget's currency", ge=0)],
        occurrence_id: Annotated[str | None, Field(description="Required if the budget is recurrent, forbidden otherwise")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "POST",
            "card_costs",
            parametres={"select": COLONNES_ECRITE},
            corps={
                "card_id": card_id,
                "budget_id": budget_id,
                "occurrence_id": occurrence_id,
                "label": label.strip(),
                "estimated_cost": estimated_cost,
            },
        )
        return {"cost_line": _une_ligne(reponse, "card", card_id)}

    moteur.enregistrer(
        serveur,
        crm_card_cost_add,
        Declaration(
            famille="budgets",
            action="ajouter",
            espace="card:card_id",
            autres=("budget:budget_id", "occurrence:occurrence_id"),
        ),
        titre="Add a cost line (ligne de coût)",
        description=(
            "Adds a cost line to an affaire (card), attached to a budget (and to one of its occurrences when the budget "
            "is recurrent), with its label and planned cost. Actual costs are added afterwards with "
            "crm_card_cost_actual_add."
        ),
    )

    async def crm_card_cost_actual_add(
        cost_id: Annotated[str, Field(description="The cost line id")],
        amount: Annotated[float, Field(description="Amount spent; 0 allowed, negative for a refund")],
        spent_on: Annotated[str | None, Field(description="YYYY-MM-DD; today by default")] = None,
        label: Annotated[str | None, Field(description="Optional, e.g. an invoice number", max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {"card_cost_id": cost_id, "amount": amount}
        if _date(spent_on, "spent_on") is not None:
            corps["spent_on"] = spent_on
        if label is not None and label.strip():
            corps["label"] = label.strip()
        reponse = await crm.ecrire(
            appel.jeton, "POST", "card_cost_actuals", parametres={"select": COLONNES_REEL}, corps=corps
        )
        return {"actual": _une_ligne(reponse, "cost", cost_id)}

    moteur.enregistrer(
        serveur,
        crm_card_cost_actual_add,
        Declaration(famille="budgets", action="ajouter", espace="cost:cost_id"),
        titre="Add an actual cost (coût réel)",
        description=(
            "Adds an actual cost (an invoice, an expense) to a cost line; the line's actual cost becomes the sum of its "
            "actuals. Refused on a settled line."
        ),
    )

    # --- modifier --------------------------------------------------------------------------------------------------

    async def crm_card_cost_update(
        cost_id: Annotated[str, Field(description="The cost line id")],
        label: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        estimated_cost: Annotated[float | None, Field(ge=0)] = None,
        budget_id: Annotated[str | None, Field(description="Move the line to another open budget")] = None,
        occurrence_id: Annotated[str | None, Field(description="Attach to this occurrence of the (new) budget")] = None,
        no_occurrence: Annotated[bool, Field(description="Remove the occurrence (non-recurrent budget)")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if occurrence_id is not None and no_occurrence:
            raise ToolError("Give occurrence_id or no_occurrence, not both.")
        corps: dict[str, Any] = {}
        if label is not None:
            corps["label"] = label.strip()
        if estimated_cost is not None:
            corps["estimated_cost"] = estimated_cost
        if budget_id is not None:
            corps["budget_id"] = budget_id
        if occurrence_id is not None:
            corps["occurrence_id"] = occurrence_id
        if no_occurrence:
            corps["occurrence_id"] = None
        if not corps:
            raise ToolError("Give at least one field to change.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_costs",
            parametres={"id": f"eq.{cost_id}", "select": COLONNES_ECRITE},
            corps=corps,
        )
        return {"cost_line": _une_ligne(reponse, "cost", cost_id)}

    moteur.enregistrer(
        serveur,
        crm_card_cost_update,
        Declaration(
            famille="budgets",
            action="modifier",
            espace="cost:cost_id",
            autres=("budget:budget_id", "occurrence:occurrence_id"),
        ),
        titre="Update a cost line (ligne de coût)",
        description=(
            "Changes the label, the planned cost, the budget or the occurrence of a cost line; only the fields given are "
            "written. Its actual cost is not writable: it is the sum of its actuals."
        ),
    )

    async def crm_card_cost_actual_update(
        cost_actual_id: Annotated[str, Field(description="The actual cost id")],
        amount: Annotated[float | None, Field()] = None,
        spent_on: Annotated[str | None, Field(description="YYYY-MM-DD")] = None,
        label: Annotated[str | None, Field(description="Empty string clears it", max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {}
        if amount is not None:
            corps["amount"] = amount
        if _date(spent_on, "spent_on") is not None:
            corps["spent_on"] = spent_on
        if label is not None:
            corps["label"] = label.strip() or None
        if not corps:
            raise ToolError("Give amount, spent_on and/or label.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_cost_actuals",
            parametres={"id": f"eq.{cost_actual_id}", "select": COLONNES_REEL},
            corps=corps,
        )
        return {"actual": _une_ligne(reponse, "cost_actual", cost_actual_id)}

    moteur.enregistrer(
        serveur,
        crm_card_cost_actual_update,
        Declaration(famille="budgets", action="modifier", espace="cost_actual:cost_actual_id"),
        titre="Correct an actual cost (coût réel)",
        description="Corrects the amount, date or label of an actual cost. Refused on a settled line.",
    )

    async def crm_card_cost_settle(
        cost_id: Annotated[str, Field(description="The cost line id")],
        settled: Annotated[bool, Field(description="true to settle (FR: soldé), false to reopen")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "card_costs",
            parametres={"id": f"eq.{cost_id}", "select": COLONNES_ECRITE},
            # Un drapeau : la base pose l'horodatage et l'auteur (docs/SPEC-costs.md §2.3 bis).
            corps={"settled_at": datetime.now(UTC).isoformat() if settled else None},
        )
        return {"cost_line": _une_ligne(reponse, "cost", cost_id)}

    moteur.enregistrer(
        serveur,
        crm_card_cost_settle,
        Declaration(famille="budgets", action="modifier", espace="cost:cost_id"),
        titre="Settle or reopen a cost line (soldé)",
        description="Settles a cost line (no more actuals; with none, its actual cost becomes 0) or reopens it.",
    )

# @verifies CRM-104 (docs/BACKLOG.md) — tranche T4 : les neuf outils de la famille `budgets`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 septies (liste, ancres `cost` et `cost_actual`, ancre `track` facultative, cumuls sans
#           mélange de devises, refus nommés, aucune suppression), §9.3 (zéro ligne = refus) ; docs/SPEC-costs.md §2.3,
#           §2.3 bis
"""Le CRM simulé rend deux budgets, une ligne de coût de chaque espace et une ligne soldée ; la vraie base est éprouvée
par `tests/test_integration_budgets.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.jeton_interne import Identite
from crm_mcp.outils import budgets, reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import BUDGET_A, CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, TRACK_A, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
CARD_A = "a0000000-0000-4000-8000-0000000000e1"
CARD_B = "b0000000-0000-4000-8000-0000000000e2"
BUDGET_R = "a0000000-0000-4000-8000-0000000000a3"
OCC_1 = "a0000000-0000-4000-8000-0000000000f1"
COUT_A = "a0000000-0000-4000-8000-0000000000c1"
COUT_SOLDE = "a0000000-0000-4000-8000-0000000000c2"
COUT_B = "b0000000-0000-4000-8000-0000000000c3"
REEL_A = "a0000000-0000-4000-8000-0000000000d1"
OUTILS = {
    "crm_budget_list", "crm_budget_get", "crm_card_cost_list", "crm_costs_to_enter", "crm_card_cost_add",
    "crm_card_cost_actual_add", "crm_card_cost_update", "crm_card_cost_actual_update", "crm_card_cost_settle",
}


class CrmBudgets(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[tuple[str, str, dict[str, str], Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.forcee: tuple[int, Any] | None = None

    def budgets(self) -> list[dict[str, Any]]:
        commun = {"currency": "EUR", "planned_amount": 1000, "closed_at": None, "stale_after_days": 30, "position": 1}
        return [
            {**commun, "id": BUDGET_A, "track_id": TRACK_A, "name": "Licences", "is_recurrent": False,
             "track": {"id": TRACK_A, "name": "Studio", "workspace_id": ESPACE_A}},
            {**commun, "id": BUDGET_R, "track_id": TRACK_A, "name": "Hébergement", "is_recurrent": True, "position": 2,
             "track": {"id": TRACK_A, "name": "Studio", "workspace_id": ESPACE_A}},
        ]

    def couts(self) -> list[dict[str, Any]]:
        def ligne(i: str, carte: str, ws: str, budget: str, occ: str | None, prevu: float, reel: float | None,
                  solde: str | None, cree: str) -> dict[str, Any]:
            return {"id": i, "card_id": carte, "budget_id": budget, "occurrence_id": occ, "label": f"L-{i[-2:]}",
                    "estimated_cost": prevu, "actual_cost": reel, "settled_at": solde, "created_at": cree,
                    "reel_saisissable": False, "card": {"workspace_id": ws},
                    "cards": {"id": carte, "title": f"Affaire {carte[-2:]}", "workspace_id": ws, "deleted_at": None},
                    "budgets": {"id": budget, "name": "B", "currency": "EUR", "track_id": TRACK_A, "closed_at": None,
                                "is_recurrent": occ is not None},
                    "budget_occurrences": None if occ is None else {"id": occ, "label": "Octobre", "closed_at": None},
                    "card_cost_actuals": [] if reel is None else [
                        {"id": "r1", "amount": reel, "spent_on": "2026-10-20", "label": None},
                        {"id": "r2", "amount": 0, "spent_on": "2026-10-02", "label": "Avoir"},
                    ]}
        return [
            ligne(COUT_A, CARD_A, ESPACE_A, BUDGET_A, None, 100.105, None, None, "2026-10-01"),
            ligne(COUT_SOLDE, CARD_A, ESPACE_A, BUDGET_R, OCC_1, 50, 40, "2026-10-10", "2026-10-02"),
            ligne(COUT_B, CARD_B, ESPACE_B, BUDGET_A, None, 999, 999, None, "2026-09-01"),
        ]

    async def table_budgets(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json()
            self.ecritures.append((requete.method, nom, parametres, corps))
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            if nom == "card_cost_actuals" and corps.get("card_cost_id") == COUT_SOLDE:
                return JSONResponse({"code": "P0001", "message": "ligne soldee"}, status_code=400)
            return JSONResponse([{"id": "nouvelle", **corps}], status_code=201)
        self.lectures.append((nom, parametres))
        if nom == "budgets":
            lignes = [b for b in self.budgets() if b["track"]["workspace_id"] in lisibles]
            if parametres.get("closed_at") == "is.null":
                lignes = [b for b in lignes if b["closed_at"] is None]
        elif nom == "budget_occurrences" and "budget:budgets" in parametres.get("select", ""):
            lignes = [{"id": OCC_1, "budget": {"track": {"workspace_id": ESPACE_A}}}]
        elif nom == "budget_occurrences":
            lignes = [{"id": OCC_1, "budget_id": BUDGET_R, "label": "Octobre", "period_start": "2026-10-01",
                       "period_end": "2026-10-31", "planned_amount": 60, "closed_at": None},
                      {"id": "occ-2", "budget_id": BUDGET_R, "label": "Novembre", "period_start": "2026-11-01",
                       "period_end": "2026-11-30", "planned_amount": 60, "closed_at": None}]
        elif nom == "card_costs":
            lignes = [l for l in self.couts() if l["card"]["workspace_id"] in lisibles]
            if parametres.get("settled_at") == "is.null":
                lignes = [l for l in lignes if l["settled_at"] is None]
            if parametres.get("budget_id", "").startswith("in.("):
                ids = parametres["budget_id"][4:-1].split(",")
                lignes = [l for l in lignes if l["budget_id"] in ids]
        elif nom == "card_cost_actuals":
            lignes = [{"id": REEL_A, "card_cost_id": COUT_A, "ligne": {"card": {"workspace_id": ESPACE_A}}}]
        elif nom == "cards":
            lignes = [c for c in ({"id": CARD_A, "title": "Affaire A", "workspace_id": ESPACE_A},
                                  {"id": CARD_B, "title": "Affaire B", "workspace_id": ESPACE_B}) if c["workspace_id"] in lisibles]
        else:
            return await self.table(requete)
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.") and "." not in k}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_budgets, methods=["GET", "POST", "PATCH"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmBudgets()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        budgets.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "budgets", a) for a in ("consulter", "ajouter", "modifier")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_neuf_outils_leurs_ancres_et_aucune_suppression(monde: Monde) -> None:
    declares = {n: (d.action, d.espace, d.autres) for n, d in monde.moteur.declarations.items() if d.famille == "budgets"}
    assert set(declares) == OUTILS
    assert declares["crm_card_cost_actual_add"] == ("ajouter", "cost:cost_id", ())
    assert declares["crm_card_cost_actual_update"] == ("modifier", "cost_actual:cost_actual_id", ())
    assert declares["crm_card_cost_add"] == ("ajouter", "card:card_id", ("budget:budget_id", "occurrence:occurrence_id"))
    assert all(a != "supprimer" for a, _e, _o in declares.values())
    assert monde.moteur.facultatives["crm_budget_list"] == frozenset({"track_id"})


async def test_la_liste_des_budgets_cumule_par_budget_sans_compter_l_inconnu(monde: Monde) -> None:
    resultat = await monde.appel("crm_budget_list", {"workspace": "atelier", "track_id": TRACK_A})
    envoye = next(p for n, p in monde.simule.lectures if n == "budgets")
    assert envoye["track.workspace_id"] == f"eq.{ESPACE_A}" and envoye["track_id"] == f"eq.{TRACK_A}"
    assert envoye["closed_at"] == "is.null"
    licences, hebergement = resultat["budgets"]
    assert licences["costs"] == {"lines": 1, "planned": 100.11, "actual_known": 0, "lines_without_actual": 1}
    assert hebergement["costs"] == {"lines": 1, "planned": 50, "actual_known": 40, "lines_without_actual": 0}
    assert licences["track"] == {"id": TRACK_A, "name": "Studio"} and "position" not in licences
    await monde.appel("crm_budget_list", {"workspace": "atelier", "include_closed": True})
    assert "closed_at" not in [p for n, p in monde.simule.lectures if n == "budgets"][-1]


async def test_le_budget_range_ses_lignes_par_occurrence(monde: Monde) -> None:
    fiche = await monde.appel("crm_budget_get", {"budget_id": BUDGET_R})
    assert [(o["costs"]["lines"], o["costs"]["actual_known"]) for o in fiche["occurrences"]] == [(1, 40), (0, 0)]
    assert fiche["lines"][0] == {"id": COUT_SOLDE, "occurrence_id": OCC_1, "label": "L-c2", "estimated_cost": 50,
                                 "actual_cost": 40, "settled": True, "card": {"id": CARD_A, "title": "Affaire e1"}}


async def test_les_couts_d_une_affaire_et_leurs_reels_par_date(monde: Monde) -> None:
    resultat = await monde.appel("crm_card_cost_list", {"card_id": CARD_A})
    solde = next(l for l in resultat["cost_lines"] if l["id"] == COUT_SOLDE)
    assert [r["id"] for r in solde["actuals"]] == ["r2", "r1"] and solde["settled"] is True
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
        await monde.appel("crm_card_cost_list", {"card_id": CARD_B})


async def test_a_saisir_filtre_l_espace_et_le_track(monde: Monde) -> None:
    resultat = await monde.appel("crm_costs_to_enter", {"workspace": "atelier", "track_id": TRACK_A})
    envoye = monde.simule.lectures[-1][1]
    assert envoye["cards.workspace_id"] == f"eq.{ESPACE_A}" and envoye["budgets.track_id"] == f"eq.{TRACK_A}"
    assert envoye["settled_at"] == "is.null" and envoye["cards.deleted_at"] == "is.null"
    # `you_can_enter` est la capacité que la base calcule (`reel_saisissable`), jamais une supposition.
    assert [l["id"] for l in resultat["cost_lines"]] == [COUT_A] and resultat["cost_lines"][0]["you_can_enter"] is False


async def test_ecrire_envoie_ce_que_la_fiche_envoie(monde: Monde) -> None:
    await monde.appel("crm_card_cost_add", {"card_id": CARD_A, "budget_id": BUDGET_A, "label": " Licences ", "estimated_cost": 12})
    assert monde.simule.ecritures[-1][1:] == ("card_costs", {"select": "id,label,estimated_cost,actual_cost,settled_at,budget_id,occurrence_id"},
                                              {"card_id": CARD_A, "budget_id": BUDGET_A, "occurrence_id": None,
                                               "label": "Licences", "estimated_cost": 12})
    await monde.appel("crm_card_cost_actual_add", {"cost_id": COUT_A, "amount": 9.5, "label": " "})
    assert monde.simule.ecritures[-1][3] == {"card_cost_id": COUT_A, "amount": 9.5}
    await monde.appel("crm_card_cost_update", {"cost_id": COUT_A, "budget_id": BUDGET_R, "occurrence_id": OCC_1})
    assert monde.simule.ecritures[-1][3] == {"budget_id": BUDGET_R, "occurrence_id": OCC_1}
    await monde.appel("crm_card_cost_update", {"cost_id": COUT_A, "no_occurrence": True})
    assert monde.simule.ecritures[-1][3] == {"occurrence_id": None}
    await monde.appel("crm_card_cost_actual_update", {"cost_actual_id": REEL_A, "label": ""})
    assert monde.simule.ecritures[-1][3] == {"label": None}
    await monde.appel("crm_card_cost_settle", {"cost_id": COUT_A, "settled": False})
    assert monde.simule.ecritures[-1][3] == {"settled_at": None}
    with pytest.raises(ToolError, match="not both"):
        await monde.appel("crm_card_cost_update", {"cost_id": COUT_A, "occurrence_id": OCC_1, "no_occurrence": True})
    with pytest.raises(ToolError, match="at least one field"):
        await monde.appel("crm_card_cost_update", {"cost_id": COUT_A})


async def test_les_refus_de_la_base_sont_nommes(monde: Monde) -> None:
    with pytest.raises(ToolError, match="ligne soldée"):
        await monde.appel("crm_card_cost_actual_add", {"cost_id": COUT_SOLDE, "amount": 1})
    monde.simule.forcee = (400, {"code": "23514", "message": "ce budget est récurrent : une ligne de coût doit citer une occurrence"})
    with pytest.raises(ToolError, match="occurrence_required"):
        await monde.appel("crm_card_cost_add", {"card_id": CARD_A, "budget_id": BUDGET_R, "label": "x", "estimated_cost": 1})
    monde.simule.forcee = (400, {"code": "23514", "message": "cette occurrence est clôturée : elle n'accepte aucun rattachement"})
    with pytest.raises(ToolError, match="occurrence_closed"):
        await monde.appel("crm_card_cost_update", {"cost_id": COUT_A, "occurrence_id": OCC_1})
    monde.simule.forcee = (409, {"code": "23503", "message": "le budget « x » n'existe pas"})
    with pytest.raises(ToolError, match="missing_reference"):
        await monde.appel("crm_card_cost_update", {"cost_id": COUT_A, "label": "y"})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : ligne de coût"):
        await monde.appel("crm_card_cost_settle", {"cost_id": COUT_A, "settled": True})


async def test_une_ligne_d_un_autre_espace_est_le_refus_uniforme(monde: Monde) -> None:
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : ligne de coût"):
        await monde.appel("crm_card_cost_settle", {"cost_id": COUT_B, "settled": True})
    assert not monde.simule.ecritures

# @verifies CRM-108 (docs/BACKLOG.md) — tranche T4 : les outils de la famille `recettes`, devant un CRM simulé
# @verifies docs/SPEC-recettes.md §7 (catalogue, ancres `card`, `revenue`, `revenue_actual`, `workspace` ; cases `aussi`
#           du rapport ; aucun outil de suppression), §5 (refus `rentabilite_reservee` traduit), §2.3 (« ligne soldee »
#           traduit ; zéro ligne touchée = refus) ; docs/SPEC-mcp.md §6.2 (visibilité par la matrice, refus uniforme),
#           §9.1 (déclarations vérifiées au démarrage), §9.3
"""Le CRM simulé étend celui de `conftest.py` avec les tables des recettes et la fonction de rentabilité ; la RLS y est
réduite à « l'espace est lisible », la matrice est celle du simulateur partagé."""

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
from crm_mcp.outils import recettes, reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

CARD_A = "c0000000-0000-4000-8000-0000000000c1"
CARD_B = "c0000000-0000-4000-8000-0000000000c2"
REV_A = "r0000000-0000-4000-8000-0000000000a1".replace("r", "e", 1)
REV_SOLDEE = "e0000000-0000-4000-8000-0000000000a2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)

OUTILS = {
    "crm_card_revenue_list",
    "crm_revenues_to_enter",
    "crm_profitability_report",
    "crm_card_revenue_add",
    "crm_card_revenue_actual_add",
    "crm_card_revenue_update",
    "crm_card_revenue_actual_update",
    "crm_card_revenue_settle",
}


class CrmRecettes(CrmSimule):
    ecritures: list[tuple[str, str, Any]]
    rapport: tuple[int, Any]

    def __init__(self) -> None:
        super().__init__()
        self.ecritures = []
        self.rapport = (200, [])

    def _cards(self) -> list[dict[str, Any]]:
        return [
            {"id": CARD_A, "title": "Refonte", "currency": "EUR", "workspace_id": ESPACE_A},
            {"id": CARD_B, "title": "Autre espace", "currency": "EUR", "workspace_id": ESPACE_B},
        ]

    def _lignes(self) -> list[dict[str, Any]]:
        return [
            {"id": REV_A, "card_id": CARD_A, "label": "Acompte", "estimated_amount": 6000, "actual_amount": None,
             "settled_at": None, "card": {"workspace_id": ESPACE_A}},
            {"id": REV_SOLDEE, "card_id": CARD_A, "label": "Solde", "estimated_amount": 1, "actual_amount": 0,
             "settled_at": "2026-10-01", "card": {"workspace_id": ESPACE_A}},
        ]

    async def table_recettes(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        if requete.method != "GET":
            corps = await requete.json() if requete.method != "DELETE" else None
            self.ecritures.append((requete.method, nom, corps))
            if nom == "card_revenue_actuals" and corps and corps.get("card_revenue_id") == REV_SOLDEE:
                return JSONResponse({"code": "P0001", "message": "ligne soldee"}, status_code=400)
            return JSONResponse([{"id": "nouvelle", **(corps or {})}], status_code=201)
        filtres = {k: v.removeprefix("eq.") for k, v in requete.query_params.items() if v.startswith("eq.")}
        if nom == "cards":
            lignes = [c for c in self._cards() if c["workspace_id"] in lisibles]
        elif nom == "card_revenues":
            lignes = [l for l in self._lignes() if l["card"]["workspace_id"] in lisibles]
            filtres.pop("cards.workspace_id", None)
        else:
            return await self.table(requete)
        lignes = [l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items())]
        return JSONResponse(lignes)

    async def rpc_recettes(self, requete: Request) -> Response:
        if requete.path_params["fonction"] == "rentabilite_affaires":
            if self._personne(requete) is None:
                return JSONResponse({"message": "JWT invalide"}, status_code=401)
            statut, corps = self.rapport
            return JSONResponse(corps, status_code=statut)
        return await self.rpc(requete)

    def application(self) -> Starlette:
        return Starlette(
            routes=[
                Route("/rest/v1/rpc/{fonction}", self.rpc_recettes, methods=["POST"]),
                Route("/rest/v1/{table}", self.table_recettes, methods=["GET", "POST", "PATCH", "DELETE"]),
            ]
        )


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmRecettes()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.registre = Registre(self.crm, ())
        self.moteur = MoteurPolitique(
            registre=self.registre, crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        recettes.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}

    def ouvrir(self, *cases: tuple[str, str]) -> None:
        self.simule.droits |= {("sujet-thomas", ESPACE_A, f, a) for f, a in cases}

    async def outils(self) -> set[str]:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name for o in await client.list_tools()}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_les_huit_outils_sont_declares_et_aucun_ne_supprime(monde: Monde) -> None:
    declares = {n for n, d in monde.moteur.declarations.items() if d.famille == "recettes"}
    assert declares == OUTILS
    assert all(d.action != "supprimer" for n, d in monde.moteur.declarations.items() if n in OUTILS)


async def test_visibles_seulement_par_la_matrice_et_le_rapport_exige_budgets_et_temps(monde: Monde) -> None:
    assert not (await monde.outils()) & OUTILS
    monde.ouvrir(("recettes", "consulter"))
    visibles = await monde.outils()
    assert {"crm_card_revenue_list", "crm_revenues_to_enter"} <= visibles
    assert "crm_profitability_report" not in visibles
    monde.ouvrir(("budgets", "consulter"), ("temps", "consulter"))
    assert "crm_profitability_report" in await monde.outils()


async def test_ajouter_une_ligne_envoie_nature_et_prevu_jamais_le_reel(monde: Monde) -> None:
    monde.ouvrir(("recettes", "ajouter"))
    resultat = await monde.appel(
        "crm_card_revenue_add", {"card_id": CARD_A, "label": "Acompte", "estimated_amount": 6000}
    )
    assert resultat["revenue_line"]["label"] == "Acompte"
    methode, table, corps = monde.simule.ecritures[-1]
    assert (methode, table) == ("POST", "card_revenues")
    assert corps == {"card_id": CARD_A, "label": "Acompte", "estimated_amount": 6000}


async def test_une_affaire_d_un_autre_espace_rend_le_refus_uniforme(monde: Monde) -> None:
    monde.ouvrir(("recettes", "ajouter"))
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
        await monde.appel("crm_card_revenue_add", {"card_id": CARD_B, "label": "x", "estimated_amount": 1})
    assert monde.simule.ecritures == []


async def test_une_ligne_soldee_est_un_refus_nomme(monde: Monde) -> None:
    monde.ouvrir(("recettes", "ajouter"))
    with pytest.raises(ToolError, match="ligne soldée"):
        await monde.appel("crm_card_revenue_actual_add", {"revenue_id": REV_SOLDEE, "amount": 10})


async def test_le_rapport_refuse_par_le_crm_dit_qu_il_est_reserve(monde: Monde) -> None:
    monde.ouvrir(("recettes", "consulter"), ("budgets", "consulter"), ("temps", "consulter"))
    monde.simule.rapport = (403, {"code": "42501", "message": "rentabilite_reservee"})
    with pytest.raises(ToolError, match="rentabilite_reservee"):
        await monde.appel("crm_profitability_report", {"workspace": "atelier"})


async def test_le_rapport_applique_la_regle_partagee_et_garde_l_espace_demande(monde: Monde) -> None:
    monde.ouvrir(("recettes", "consulter"), ("budgets", "consulter"), ("temps", "consulter"))
    ligne = {
        "workspace_id": ESPACE_A, "track_id": "t", "channel_id": "h", "card_id": CARD_A, "node_kind": "open",
        "archivee": False, "currency": "EUR", "recettes_prevues": 72000, "recettes_reelles": 4000, "lignes_recette": 2,
        "lignes_recette_sans_reel": 1, "couts_prevus": 450, "couts_reels": 375, "lignes_cout": 2,
        "lignes_cout_sans_reel": 1, "personnel": 4800, "minutes": 4200, "minutes_non_valorisees": 0,
    }
    monde.simule.rapport = (200, [ligne, {**ligne, "workspace_id": ESPACE_B, "card_id": CARD_B}])
    rapport = await monde.appel("crm_profitability_report", {"workspace": "atelier", "state": "open"})
    assert rapport["total"] == 1
    assert rapport["rows"][0]["actual"]["marge"] == -1175
    assert rapport["rows"][0]["actual"]["partielle"] == {
        "recettesSansReel": 1, "coutsSansReel": 1, "minutesNonValorisees": 0
    }
    assert rapport["rows"][0]["planned"]["marge"] == 66750

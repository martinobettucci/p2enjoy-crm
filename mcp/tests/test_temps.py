# @verifies CRM-104 (docs/BACKLOG.md) — tranche T5 : les trois outils de la famille `temps`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 octies (liste, personne nommée, période bornée, une seule cible, 0 qui vide la case,
#           rapport ramené aux tracks de l'espace sans mélange de devises, refus nommés), §9.3 ; docs/SPEC-temps.md
"""Le CRM simulé rend deux membres, une saisie existante et un rapport qui déborde sur un autre espace ; la vraie base est
éprouvée par `tests/test_integration_temps.py`."""

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
from crm_mcp.outils import reference, temps
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET, TRACK_A, TRACK_B, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
LINA = "sujet-lina"
SAISIE = "a0000000-0000-4000-8000-0000000000e9"
CARTE = "a0000000-0000-4000-8000-0000000000e1"
OUTILS = {"crm_time_entry_list", "crm_time_report", "crm_time_entry_set"}


class CrmTemps(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[tuple[str, dict[str, str], Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.rpcs: list[dict[str, Any]] = []
        self.forcee: tuple[int, Any] | None = None

    async def table_temps(self, requete: Request) -> Response:
        nom = requete.path_params["table"]
        if nom not in ("saisies_temps", "workspace_members", "tracks", "cards"):
            return await self.table(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json() if requete.method != "DELETE" else None
            self.ecritures.append((requete.method, parametres, corps))
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            return JSONResponse([{"id": SAISIE, "profile_id": "sujet-thomas", "jour": "2026-10-20", "minutes": 0,
                                  **(corps or {})}], status_code=201)
        self.lectures.append((nom, parametres))
        if nom == "workspace_members":
            return JSONResponse([{"user_id": "sujet-thomas", "profiles": {"full_name": "Thomas Roux"}},
                                 {"user_id": LINA, "profiles": {"full_name": "Lina Moreau"}}])
        if nom == "tracks":
            return JSONResponse([{"id": TRACK_A, "workspace_id": ESPACE_A}])
        if nom == "cards":
            return JSONResponse([{"id": CARTE, "workspace_id": ESPACE_A}])
        if parametres.get("select") == "id":
            existe = parametres.get("jour") == "eq.2026-10-20"
            return JSONResponse([{"id": SAISIE}] if existe else [])
        return JSONResponse([
            {"id": SAISIE, "profile_id": "sujet-thomas", "jour": "2026-10-20", "minutes": 90, "track_id": None,
             "channel_id": None, "card_id": CARTE, "track": None, "channel": None, "card": {"title": "Migration ERP"}},
            {"id": "s2", "profile_id": "sujet-thomas", "jour": "2026-10-21", "minutes": 30, "track_id": TRACK_A,
             "channel_id": None, "card_id": None, "track": {"name": "Studio"}, "channel": None, "card": None},
        ])

    async def rpc_temps(self, requete: Request) -> Response:
        if requete.path_params["fonction"] != "temps_valorise":
            return await self.rpc(requete)
        self.rpcs.append(await requete.json())
        return JSONResponse([
            {"profile_id": "sujet-thomas", "track_id": TRACK_A, "channel_id": None, "card_id": CARTE, "minutes": 105,
             "montant": 87.505, "devise": "EUR"},
            {"profile_id": LINA, "track_id": TRACK_A, "channel_id": None, "card_id": None, "minutes": 60,
             "montant": None, "devise": None},
            {"profile_id": LINA, "track_id": TRACK_A, "channel_id": None, "card_id": None, "minutes": 15,
             "montant": 20, "devise": "CHF"},
            {"profile_id": LINA, "track_id": TRACK_B, "channel_id": None, "card_id": None, "minutes": 999,
             "montant": 999, "devise": "EUR"},
        ])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_temps, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_temps, methods=["GET", "POST", "PATCH", "DELETE"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmTemps()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        temps.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "temps", a) for a in ("consulter", "modifier")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_trois_outils_et_leurs_actions(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "temps"}
    assert declares == {
        "crm_time_entry_list": ("consulter", "workspace:workspace"),
        "crm_time_report": ("consulter", "workspace:workspace"),
        "crm_time_entry_set": ("modifier", "workspace:workspace"),
    }
    assert monde.moteur.facultatives["crm_time_entry_set"] == frozenset({"track_id", "channel_id", "card_id"})


async def test_la_liste_est_la_votre_par_defaut_bornee_et_nomme_ses_cibles(monde: Monde) -> None:
    resultat = await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-10-19", "date_to": "2026-10-25"})
    envoye = next(p for n, p in monde.simule.lectures if n == "saisies_temps")
    assert envoye["profile_id"] == "eq.sujet-thomas" and envoye["and"] == "(jour.gte.2026-10-19,jour.lte.2026-10-25)"
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}"
    assert resultat["total_minutes"] == 120
    assert [s["target"] for s in resultat["entries"]] == [
        {"kind": "card", "id": CARTE, "name": "Migration ERP"}, {"kind": "track", "id": TRACK_A, "name": "Studio"}
    ]
    await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-10-19", "date_to": "2026-10-25",
                                              "person": "lina moreau"})
    assert [p for n, p in monde.simule.lectures if n == "saisies_temps"][-1]["profile_id"] == f"eq.{LINA}"
    await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-10-19", "date_to": "2026-10-25",
                                              "everyone": True})
    assert "profile_id" not in [p for n, p in monde.simule.lectures if n == "saisies_temps"][-1]
    with pytest.raises(ToolError, match="limited to 93 days"):
        await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-01-01", "date_to": "2026-04-04"})
    # 92 jours d'écart : la borne est atteinte sans être franchie.
    await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-01-01", "date_to": "2026-04-03"})
    with pytest.raises(ToolError, match="must not be before"):
        await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-10-25", "date_to": "2026-10-19"})
    with pytest.raises(ToolError, match="No member named"):
        await monde.appel("crm_time_entry_list", {"workspace": "atelier", "date_from": "2026-10-19", "date_to": "2026-10-25",
                                                  "person": "Inconnu"})


async def test_le_rapport_reste_dans_l_espace_et_ne_melange_pas_les_devises(monde: Monde) -> None:
    rapport = await monde.appel("crm_time_report", {"workspace": "atelier", "date_from": "2026-10-01", "date_to": "2026-10-31",
                                                    "person": "Lina Moreau", "card_id": CARTE})
    assert monde.simule.rpcs[-1] == {"p_debut": "2026-10-01", "p_fin": "2026-10-31", "p_profile": LINA, "p_card": CARTE}
    assert rapport["total_minutes"] == 180 and rapport["unvalued_minutes"] == 60
    assert rapport["amounts_by_currency"] == {"EUR": 87.51, "CHF": 20}
    assert all(r["track_id"] == TRACK_A for r in rapport["rows"])


async def test_poser_cree_remplace_ou_vide_la_case(monde: Monde) -> None:
    pose = await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 45, "card_id": CARTE})
    assert monde.simule.ecritures[-1][0] == "POST" and monde.simule.ecritures[-1][2] == {
        "workspace_id": ESPACE_A, "profile_id": "sujet-thomas", "jour": "2026-10-22", "minutes": 45,
        "track_id": None, "channel_id": None, "card_id": CARTE}
    assert pose["entry"]["target"] == {"kind": "card", "id": CARTE}
    await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-20", "minutes": 60, "card_id": CARTE})
    assert monde.simule.ecritures[-1][:3:2] == ("PATCH", {"minutes": 60})
    vide = await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-20", "minutes": 0, "card_id": CARTE})
    assert monde.simule.ecritures[-1][0] == "DELETE" and monde.simule.ecritures[-1][1]["id"] == f"eq.{SAISIE}"
    assert vide == {"cleared": True, "entry": None}
    avant = len(monde.simule.ecritures)
    assert (await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 0,
                                                     "card_id": CARTE}))["cleared"] is True
    assert len(monde.simule.ecritures) == avant
    with pytest.raises(ToolError, match="exactly one target"):
        await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 15,
                                                 "card_id": CARTE, "track_id": TRACK_A})
    with pytest.raises(ToolError, match="multiple of 15"):
        await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 20, "card_id": CARTE})


async def test_les_refus_de_la_base_sont_nommes(monde: Monde) -> None:
    monde.simule.forcee = (400, {"code": "P0001", "message": "plafond journalier"})
    with pytest.raises(ToolError, match="daily_limit"):
        await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 420, "card_id": CARTE})
    monde.simule.forcee = (403, {"code": "42501", "message": "new row violates row-level security policy"})
    with pytest.raises(ToolError, match="entry_not_allowed"):
        await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-22", "minutes": 15, "card_id": CARTE,
                                                 "person": "Lina Moreau"})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
        await monde.appel("crm_time_entry_set", {"workspace": "atelier", "day": "2026-10-20", "minutes": 30, "card_id": CARTE})

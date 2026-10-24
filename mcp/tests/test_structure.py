# @verifies CRM-104 (docs/BACKLOG.md) — tranche T1 : les douze outils de structure et la recherche de référence, devant un
#           CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 quater (liste, ancres, genre `workflow`, ancre `track` facultative, ni slug ni workflow
#           modifiés), §6.1 (recherche filtrée par la matrice de chaque famille), §9.1 (`destructiveHint` de la corbeille),
#           §9.3 (refus traduits)
"""Le CRM simulé rend l'arborescence d'un espace et une recherche qui mêle trois familles ; la RLS y est réduite à
« l'espace est lisible ». La vraie base est éprouvée par `tests/test_integration_structure.py`."""

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
from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.jeton_interne import Identite
from crm_mcp.outils import reference, structure
from crm_mcp.outils.structure import refus_structure
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, TRACK_A, TRACK_B, CrmSimule

CHANNEL_A = "d0000000-0000-4000-8000-0000000000d1"
WORKFLOW_A = "f0000000-0000-4000-8000-0000000000f1"
WORKFLOW_B = "f0000000-0000-4000-8000-0000000000f2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)

OUTILS = {
    "crm_search", "crm_track_list", "crm_track_get", "crm_channel_list", "crm_channel_get", "crm_workflow_get",
    "crm_track_create", "crm_channel_create", "crm_track_update", "crm_channel_update", "crm_track_trash",
    "crm_channel_trash",
}


class CrmStructure(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.forcee: tuple[int, Any] | None = None

    def tracks(self) -> list[dict[str, Any]]:
        return [
            {"id": TRACK_A, "workspace_id": ESPACE_A, "name": "Conseil", "slug": "conseil", "description": None,
             "color": "brand", "icon": "sparkles", "position": 1, "archived_at": None},
            {"id": TRACK_B, "workspace_id": ESPACE_B, "name": "Ailleurs", "slug": "ailleurs", "description": None,
             "color": "brand", "icon": "x", "position": 1, "archived_at": None},
        ]

    async def table_structure(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            self.ecritures.append({"methode": requete.method, "table": nom, "parametres": parametres,
                                   "corps": await requete.json()})
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            return JSONResponse([{"id": "neuf", "name": "x", "slug": "x", "position": 1, **(await requete.json())}],
                                status_code=201 if requete.method == "POST" else 200)
        self.lectures.append((nom, parametres))
        tables: dict[str, list[dict[str, Any]]] = {
            "tracks": [t for t in self.tracks() if t["workspace_id"] in lisibles],
            "channels": [{"id": CHANNEL_A, "workspace_id": ESPACE_A, "track_id": TRACK_A, "name": "Grands comptes",
                          "slug": "gc", "description": None, "workflow_id": WORKFLOW_A, "position": 1, "archived_at": None,
                          "ecriture_permise": False, "workflow": {"id": WORKFLOW_A, "name": "Cycle"}}],
            "workflows": [{"id": WORKFLOW_A, "workspace_id": ESPACE_A, "name": "Cycle", "scope": "global",
                           "is_default": True, "archived_at": None},
                          {"id": WORKFLOW_B, "workspace_id": ESPACE_B, "name": "Autre", "scope": "global",
                           "is_default": True, "archived_at": None}],
            "workflow_steps": [
                {"id": "s1", "position": 1, "is_initial": True, "probability_override": None, "stale_after_days": None,
                 "noeud": {"label": "Prospection", "kind": "open", "default_probability": 10, "default_stale_after_days": 14}},
                {"id": "s2", "position": 2, "is_initial": False, "probability_override": 65, "stale_after_days": 5,
                 "noeud": {"label": "Négociation", "kind": "open", "default_probability": 50, "default_stale_after_days": None}},
            ],
            "form_fields": [{"id": "f1", "key": "budget", "label": "Budget estimé", "type": "amount", "position": 1}],
            "workflow_transitions": [{"id": "t1", "from_step_id": "s1", "to_step_id": "s2", "label": None, "require_comment": True}],
            "workflow_transition_required_fields": [{"transition_id": "t1", "field_id": "f1"}],
            "cards": [{"id": "c1"}, {"id": "c2"}],
        }
        if nom not in tables:
            return await self.table(requete)
        lignes = tables[nom]
        if nom in ("channels", "workflows"):
            lignes = [l for l in lignes if l["workspace_id"] in lisibles]
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    async def rpc_structure(self, requete: Request) -> Response:
        if requete.path_params["fonction"] == "recherche_globale":
            return JSONResponse([
                {"objet": "affaire", "id": "a1", "workspace_id": ESPACE_A, "titre": "Migration ERP", "sous_titre": "GC",
                 "extrait": None, "rang": 1},
                {"objet": "contact", "id": "k1", "workspace_id": ESPACE_A, "titre": "Léo", "sous_titre": None,
                 "extrait": None, "rang": 0.9},
                {"objet": "message", "id": "m1", "workspace_id": ESPACE_A, "titre": "Devis", "sous_titre": None,
                 "extrait": "…", "rang": 0.8},
                {"objet": "inconnu", "id": "z", "workspace_id": ESPACE_A, "titre": "?", "sous_titre": None,
                 "extrait": None, "rang": 0.1},
            ])
        return await self.rpc(requete)

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_structure, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_structure, methods=["GET", "POST", "PATCH"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmStructure()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        structure.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "admin"}}

    def ouvrir(self, *cases: tuple[str, str]) -> None:
        self.simule.droits |= {("sujet-thomas", ESPACE_A, f, a) for f, a in cases}

    async def outils(self) -> dict[str, Any]:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name: o for o in await client.list_tools()}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


TOUT = tuple(("structure", a) for a in ("consulter", "ajouter", "modifier", "supprimer"))


async def test_les_douze_outils_et_leurs_annotations(monde: Monde) -> None:
    assert OUTILS <= set(monde.moteur.declarations)
    assert monde.moteur.declarations["crm_search"].famille == "reference"
    assert monde.moteur.declarations["crm_workflow_get"].espace == "workflow:workflow_id"
    assert monde.moteur.facultatives["crm_channel_list"] == frozenset({"track_id"})
    monde.ouvrir(*TOUT)
    outils = await monde.outils()
    assert {n for n in OUTILS if outils[n].annotations.destructive_hint} == {"crm_track_trash", "crm_channel_trash"}


async def test_la_recherche_ne_rend_que_les_familles_que_la_matrice_ouvre(monde: Monde) -> None:
    monde.ouvrir(("structure", "consulter"), ("affaires", "consulter"))
    resultats = (await monde.appel("crm_search", {"query": "erp"}))["results"]
    assert [r["kind"] for r in resultats] == ["affaire"]
    monde.ouvrir(("contacts", "consulter"), ("messagerie", "consulter"))
    resultats = (await monde.appel("crm_search", {"query": "erp"}))["results"]
    assert [r["kind"] for r in resultats] == ["affaire", "contact", "message"]


async def test_le_workflow_nomme_ses_etapes_ses_transitions_et_les_champs_exiges(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    workflow = await monde.appel("crm_workflow_get", {"workflow_id": WORKFLOW_A})
    assert [(e["name"], e["initial"], e["probability"], e["stale_after_days"]) for e in workflow["steps"]] == [
        ("Prospection", True, 10, 14), ("Négociation", False, 65, 5)
    ]
    assert workflow["transitions"] == [{"from_step": "Prospection", "to_step": "Négociation", "label": "Négociation",
                                        "requires_comment": True, "required_fields": ["Budget estimé"]}]
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_workflow_get", {"workflow_id": WORKFLOW_B})


async def test_la_liste_des_tracks_filtre_par_l_espace_et_tait_la_corbeille(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    tracks = await monde.appel("crm_track_list", {"workspace": "atelier"})
    assert [t["slug"] for t in tracks["tracks"]] == ["conseil"]
    envoye = next(p for n, p in reversed(monde.simule.lectures) if n == "tracks")
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}" and envoye["deleted_at"] == "is.null"


async def test_track_et_channels_avec_la_capacite_d_ecrire(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    track = await monde.appel("crm_track_get", {"track_id": TRACK_A})
    assert track["name"] == "Conseil" and track["channels"][0]["workflow"]["name"] == "Cycle"
    assert track["channels"][0]["can_write"] is False
    channel = await monde.appel("crm_channel_get", {"channel_id": CHANNEL_A})
    assert channel["active_cards"] == 2
    await monde.appel("crm_channel_list", {"workspace": "atelier"})
    assert "track_id" not in monde.simule.lectures[-1][1]
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : track"):
        await monde.appel("crm_channel_list", {"workspace": "atelier", "track_id": TRACK_B})


async def test_creer_modifier_et_corbeille_envoient_ce_que_l_arborescence_envoie(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_track_create", {"workspace": "atelier", "name": "Neuf", "slug": "neuf", "color": "brand",
                                           "icon": "sparkles", "description": " "})
    assert monde.simule.ecritures[-1]["corps"] == {"workspace_id": ESPACE_A, "name": "Neuf", "slug": "neuf",
                                                   "color": "brand", "icon": "sparkles", "description": None}
    await monde.appel("crm_channel_create", {"track_id": TRACK_A, "workflow_id": WORKFLOW_A, "name": "Neuf", "slug": "neuf"})
    assert monde.simule.ecritures[-1]["corps"]["workflow_id"] == WORKFLOW_A
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_channel_create", {"track_id": TRACK_A, "workflow_id": WORKFLOW_B, "name": "x", "slug": "x"})
    await monde.appel("crm_track_update", {"track_id": TRACK_A, "description": ""})
    assert monde.simule.ecritures[-1]["corps"] == {"description": None}
    with pytest.raises(ToolError, match="slug never changes"):
        await monde.appel("crm_track_update", {"track_id": TRACK_A})
    await monde.appel("crm_channel_trash", {"channel_id": CHANNEL_A})
    assert list(monde.simule.ecritures[-1]["corps"]) == ["deleted_at"]


async def test_zero_ligne_et_refus_d_ecriture_sont_traduits(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : track"):
        await monde.appel("crm_track_trash", {"track_id": TRACK_A})
    monde.simule.forcee = (409, {"code": "23505", "message": "duplicate key value"})
    with pytest.raises(ToolError, match="slug_taken"):
        await monde.appel("crm_track_create", {"workspace": "atelier", "name": "x", "slug": "x", "color": "c", "icon": "i"})


def test_les_refus_de_contrainte_sont_nommes() -> None:
    assert "tracks_color_check" in str(refus_structure(Reponse(400, {
        "code": "23514", "message": 'new row for relation "tracks" violates check constraint "tracks_color_check"'
    }), "track", "t"))
    assert "Introuvable" in str(refus_structure(Reponse(403, {"code": "42501", "message": "denied"}), "track", "t"))

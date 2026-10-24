# @verifies CRM-104 (docs/BACKLOG.md) — tranche T6 : les six outils de la famille `objectifs`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 nonies (liste, bloc placé à droite, jamais la géométrie, ancre `block`, archive sous
#           « supprimer », aucune suppression), §9.3 ; docs/SPEC-goals.md §1 (avancement lu, jamais calculé), §4.1 (bloc
#           invisible si son channel l'est)
"""Le CRM simulé rend un tableau de trois blocs, dont un lié à un channel illisible, et deux flèches ; la vraie base est
éprouvée par `tests/test_integration_objectifs.py`."""

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
from crm_mcp.outils import objectifs, reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
TABLEAU = "a0000000-0000-4000-8000-0000000000b1"
TABLEAU_B = "b0000000-0000-4000-8000-0000000000b2"
BLOC_1 = "a0000000-0000-4000-8000-0000000000d1"
BLOC_2 = "a0000000-0000-4000-8000-0000000000d2"
BLOC_CACHE = "a0000000-0000-4000-8000-0000000000d3"
CHANNEL = "a0000000-0000-4000-8000-0000000000f1"
OUTILS = {"crm_goal_board_list", "crm_goal_board_get", "crm_goal_block_add", "crm_goal_link_add",
          "crm_goal_block_update", "crm_goal_board_archive"}


class CrmObjectifs(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[tuple[str, str, dict[str, str], Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.forcee: tuple[int, Any] | None = None
        self.blocs_du_tableau = True

    async def table_objectifs(self, requete: Request) -> Response:
        nom = requete.path_params["table"]
        if nom not in ("goal_boards", "goal_blocks", "goal_links", "channels"):
            return await self.table(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json()
            self.ecritures.append((requete.method, nom, parametres, corps))
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            return JSONResponse([{"id": "nouveau", "name": "Plan 2027", "archived_at": None, **corps}], status_code=201)
        self.lectures.append((nom, parametres))
        if nom == "channels":
            return JSONResponse([{"id": CHANNEL, "workspace_id": ESPACE_A}])
        if nom == "goal_boards":
            lignes = [
                {"id": TABLEAU, "workspace_id": ESPACE_A, "name": "Plan 2026", "description": None, "position": 1,
                 "archived_at": None, "ecriture_permise": False},
                {"id": "archive", "workspace_id": ESPACE_A, "name": "Plan 2025", "description": None, "position": 2,
                 "archived_at": "2026-01-01", "ecriture_permise": True},
                {"id": TABLEAU_B, "workspace_id": ESPACE_B, "name": "Ailleurs", "position": 1, "archived_at": None},
            ]
            lignes = [l for l in lignes if l["workspace_id"] in lisibles]
            if parametres.get("archived_at") == "is.null":
                lignes = [l for l in lignes if l["archived_at"] is None]
        elif nom == "goal_blocks":
            if "board:goal_boards" in parametres.get("select", ""):
                return JSONResponse([{"id": parametres["id"].removeprefix("eq."), "board": {"workspace_id": ESPACE_A}}])
            lignes = [] if not self.blocs_du_tableau else [
                {"id": BLOC_1, "board_id": TABLEAU, "title": "CA", "body": None, "fill_percent": 40, "channel_id": None,
                 "pos_x": 0, "pos_y": 10, "width": 220, "height": 120, "channels": None},
                {"id": BLOC_2, "board_id": TABLEAU, "title": "Leads", "body": "x", "fill_percent": 70, "channel_id": CHANNEL,
                 "pos_x": 300, "pos_y": 50, "width": 250, "height": 120,
                 "channels": {"id": CHANNEL, "name": "Prospection", "deleted_at": None}},
                {"id": BLOC_CACHE, "board_id": TABLEAU, "title": "Secret", "body": None, "fill_percent": 10,
                 "channel_id": "illisible", "pos_x": 900, "pos_y": 0, "width": 220, "height": 120, "channels": None},
            ]
        else:
            lignes = [
                {"id": "f1", "board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_2, "direction": "forward",
                 "label": None},
                {"id": "f2", "board_id": TABLEAU, "source_block_id": BLOC_2, "target_block_id": BLOC_CACHE,
                 "direction": "both", "label": "?"},
            ]
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.") and "." not in k}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_objectifs, methods=["GET", "POST", "PATCH"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmObjectifs()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        objectifs.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "objectifs", a) for a in ("consulter", "ajouter", "modifier", "supprimer")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_six_outils_l_archive_sous_supprimer_et_aucune_destruction(monde: Monde) -> None:
    declares = {n: (d.action, d.espace, d.autres) for n, d in monde.moteur.declarations.items() if d.famille == "objectifs"}
    assert set(declares) == OUTILS
    assert declares["crm_goal_board_archive"] == ("supprimer", "board:board_id", ())
    assert declares["crm_goal_block_update"] == ("modifier", "block:block_id", ("channel:channel_id",))
    assert declares["crm_goal_link_add"][2] == ("block:source_block_id", "block:target_block_id")


async def test_la_liste_tait_les_archives_sauf_demande(monde: Monde) -> None:
    assert [t["name"] for t in (await monde.appel("crm_goal_board_list", {"workspace": "atelier"}))["boards"]] == ["Plan 2026"]
    tous = await monde.appel("crm_goal_board_list", {"workspace": "atelier", "include_archived": True})
    assert [(t["name"], t["archived"]) for t in tous["boards"]] == [("Plan 2026", False), ("Plan 2025", True)]


async def test_le_canevas_en_texte_tait_le_bloc_invisible_et_ses_fleches(monde: Monde) -> None:
    fiche = await monde.appel("crm_goal_board_get", {"board_id": TABLEAU})
    # `can_write` est la capacité que la base calcule (`ecriture_permise`), jamais une supposition.
    assert fiche["can_write"] is False
    assert [(b["title"], b["fill_percent"], b["channel"]) for b in fiche["blocks"]] == [
        ("CA", 40, None), ("Leads", 70, {"id": CHANNEL, "name": "Prospection"})
    ]
    assert [l["id"] for l in fiche["links"]] == ["f1"]
    assert next(p for n, p in monde.simule.lectures if n == "goal_blocks" and "order" in p)["order"] == "pos_y.asc,pos_x.asc,id.asc"


async def test_un_bloc_neuf_se_pose_a_droite_et_a_la_taille_d_un_bloc_de_l_ecran(monde: Monde) -> None:
    await monde.appel("crm_goal_block_add", {"board_id": TABLEAU, "title": " Marge ", "fill_percent": 25, "channel_id": CHANNEL,
                                             "body": " "})
    assert monde.simule.ecritures[-1][3] == {"board_id": TABLEAU, "title": "Marge", "fill_percent": 25, "pos_x": 1160,
                                             "pos_y": 0, "width": 220, "height": 120, "channel_id": CHANNEL}
    monde.simule.blocs_du_tableau = False
    await monde.appel("crm_goal_block_add", {"board_id": TABLEAU, "title": "Premier"})
    assert (monde.simule.ecritures[-1][3]["pos_x"], monde.simule.ecritures[-1][3]["pos_y"]) == (0, 0)


async def test_fleche_modification_et_archive_envoient_ce_que_le_canevas_envoie(monde: Monde) -> None:
    await monde.appel("crm_goal_link_add", {"board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_2,
                                            "direction": "both", "label": " dépend de "})
    assert monde.simule.ecritures[-1][3] == {"board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_2,
                                             "direction": "both", "label": "dépend de"}
    await monde.appel("crm_goal_block_update", {"block_id": BLOC_1, "fill_percent": 80, "body": "", "unlink_channel": True})
    assert monde.simule.ecritures[-1][3] == {"body": None, "fill_percent": 80, "channel_id": None}
    assert "pos_x" not in monde.simule.ecritures[-1][3]
    await monde.appel("crm_goal_board_archive", {"board_id": TABLEAU, "archived": False})
    assert monde.simule.ecritures[-1][3] == {"archived_at": None}
    with pytest.raises(ToolError, match="not both"):
        await monde.appel("crm_goal_block_update", {"block_id": BLOC_1, "channel_id": CHANNEL, "unlink_channel": True})
    with pytest.raises(ToolError, match="at least one field"):
        await monde.appel("crm_goal_block_update", {"block_id": BLOC_1})


async def test_les_refus_de_la_base_sont_nommes(monde: Monde) -> None:
    monde.simule.forcee = (409, {"code": "23505", "message": "duplicate key"})
    with pytest.raises(ToolError, match="link_exists"):
        await monde.appel("crm_goal_link_add", {"board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_2})
    monde.simule.forcee = (400, {"code": "23514", "message": "Une flèche relie deux blocs du même tableau (docs/SPEC-goals.md §2.4)."})
    with pytest.raises(ToolError, match="blocks_of_another_board"):
        await monde.appel("crm_goal_link_add", {"board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_2})
    monde.simule.forcee = (400, {"code": "23514", "message": 'new row violates check constraint "goal_links_boucle_check"'})
    with pytest.raises(ToolError, match="goal_links_boucle_check"):
        await monde.appel("crm_goal_link_add", {"board_id": TABLEAU, "source_block_id": BLOC_1, "target_block_id": BLOC_1})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : bloc d'objectif"):
        await monde.appel("crm_goal_block_update", {"block_id": BLOC_1, "title": "x"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : tableau d'objectifs"):
        await monde.appel("crm_goal_board_get", {"board_id": TABLEAU_B})

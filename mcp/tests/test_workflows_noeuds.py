# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.d : les cinq outils du catalogue de nœuds, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (la liste T2.d, ses ancres et ses actions, l'archive seule destructive,
#           `crm_channel_workflow_change` absent avant T1.b, les refus nommés), §9.3 ; docs/SPEC-workflow-engine.md §2.3
#           (jamais la clé), §2.5 (`null` n'est pas `0`), §2.6 (le nœud occupé), §2 ter.3 (les archivés comptés)
"""Le CRM simulé rend trois nœuds de l'espace A, dont un archivé, et un de l'espace B ; la vraie base est éprouvée par
`tests/test_integration_workflows.py`."""

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
from crm_mcp.outils import reference, workflows_noeuds
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

N1 = "a0000000-0000-4000-8000-0000000000d1"
N2 = "a0000000-0000-4000-8000-0000000000d2"
N3 = "a0000000-0000-4000-8000-0000000000d3"
NB = "b0000000-0000-4000-8000-0000000000d9"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {
    "crm_workflow_node_list": ("consulter", "workspace:workspace"),
    "crm_workflow_node_create": ("ajouter", "workspace:workspace"),
    "crm_workflow_node_update": ("modifier", "node:node_id"),
    "crm_workflow_node_move": ("modifier", "node:node_id"),
    "crm_workflow_node_archive": ("supprimer", "node:node_id"),
}


class CrmNoeuds(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[dict[str, str]] = []
        self.forcee: tuple[int, Any] | None = None
        self.noeuds = [
            {"id": N1, "workspace_id": ESPACE_A, "key": "prospection", "label": "Prospection", "kind": "open", "color": "neutral",
             "default_probability": 10, "default_stale_after_days": 14, "position": 1, "archived_at": None},
            {"id": N2, "workspace_id": ESPACE_A, "key": "relance", "label": "Relance", "kind": "open", "color": "accent",
             "default_probability": 20, "default_stale_after_days": 7, "position": 2, "archived_at": None},
            {"id": N3, "workspace_id": ESPACE_A, "key": "qualification", "label": "Qualification", "kind": "open",
             "color": "brand", "default_probability": None, "default_stale_after_days": None, "position": 4,
             "archived_at": "2026-10-01T00:00:00Z"},
            {"id": NB, "workspace_id": ESPACE_B, "key": "x", "label": "X", "position": 1, "archived_at": None},
        ]

    async def catalogue(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        lisibles = self._lisibles(personne)
        if requete.method == "GET":
            self.lectures.append(parametres)
            lignes = [n for n in self.noeuds if n["workspace_id"] in lisibles]
            for cle, valeur in parametres.items():
                if valeur.startswith("eq.") and "." not in cle:
                    lignes = [n for n in lignes if str(n.get(cle)) == valeur.removeprefix("eq.")]
                elif valeur == "is.null":
                    lignes = [n for n in lignes if n.get(cle) is None]
            return JSONResponse(sorted(lignes, key=lambda n: n["position"]))
        corps = await requete.json()
        self.ecritures.append({"methode": requete.method, "parametres": parametres, "corps": corps})
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        if requete.method == "POST":
            return JSONResponse([{"id": "nouveau", "archived_at": None, **corps}], status_code=201)
        cible = [n for n in self.noeuds if n["workspace_id"] in lisibles and f"eq.{n['id']}" == parametres.get("id")]
        for n in cible:
            n.update(corps)
        return JSONResponse(cible)

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
            Route("/rest/v1/workflow_nodes_catalog", self.catalogue, methods=["GET", "POST", "PATCH"]),
            Route("/rest/v1/{table}", self.table, methods=["GET"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmNoeuds()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows_noeuds.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "admin"}}
        self.simule.droits |= {
            ("sujet-thomas", ESPACE_A, "workflows", a) for a in ("consulter", "ajouter", "modifier", "supprimer")
        }

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content

    def derniere(self) -> dict[str, Any]:
        return self.simule.ecritures[-1]


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_cinq_outils_l_archive_seule_destructive_aucun_changement_de_channel(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS and "crm_channel_workflow_change" not in declares
    async with Client(monde.mcp) as client:
        annotations = {o.name: o.annotations for o in await client.list_tools()}
    assert {n for n in OUTILS if annotations[n].destructive_hint} == {"crm_workflow_node_archive"}


async def test_la_liste_tait_les_archives_par_defaut(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_node_list", {"workspace": "atelier"})
    assert monde.simule.lectures[-1]["archived_at"] == "is.null" and monde.simule.lectures[-1]["workspace_id"] == f"eq.{ESPACE_A}"
    assert [n["key"] for n in lu["nodes"]] == ["prospection", "relance"]
    tout = await monde.appel("crm_workflow_node_list", {"workspace": "atelier", "include_archived": True})
    assert [n["archived"] for n in tout["nodes"]] == [False, False, True]


async def test_creer_envoie_ce_que_l_ecran_envoie(monde: Monde) -> None:
    await monde.appel("crm_workflow_node_create", {"workspace": "atelier", "key": " demo ", "label": " Démo ", "kind": "won",
                                                   "color": "success", "default_probability": 0})
    assert monde.derniere()["corps"] == {
        "workspace_id": ESPACE_A, "key": "demo", "label": "Démo", "kind": "won", "color": "success",
        "default_probability": 0, "default_stale_after_days": None, "position": None,
    }


async def test_modifier_garde_la_cle_et_distingue_null_de_zero(monde: Monde) -> None:
    await monde.appel("crm_workflow_node_update", {"node_id": N2, "kind": "lost", "default_probability": 0,
                                                   "reset": ["default_stale_after_days"]})
    assert monde.derniere()["corps"] == {"kind": "lost", "default_probability": 0, "default_stale_after_days": None}
    with pytest.raises(ToolError, match="both given and reset"):
        await monde.appel("crm_workflow_node_update", {"node_id": N2, "default_probability": 5, "reset": ["default_probability"]})
    with pytest.raises(ToolError, match="key never changes"):
        await monde.appel("crm_workflow_node_update", {"node_id": N2})


async def test_deplacer_compte_les_archives_et_tait_l_autre_espace(monde: Monde) -> None:
    await monde.appel("crm_workflow_node_move", {"node_id": N1, "after_node_id": N2})
    # N1 retiré : N2 (2) puis N3 archivé (4) ; le milieu, 3.
    assert monde.derniere()["corps"] == {"position": 3.0}
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : nœud du catalogue"):
        await monde.appel("crm_workflow_node_move", {"node_id": N1, "after_node_id": NB})


async def test_le_noeud_deplace_n_est_pas_son_propre_voisin(monde: Monde) -> None:
    await monde.appel("crm_workflow_node_move", {"node_id": N2, "after_node_id": N1})
    assert monde.derniere()["corps"] == {"position": 2.5}


async def test_les_refus_du_catalogue_sont_nommes(monde: Monde) -> None:
    monde.simule.forcee = (403, {"code": "42501", "message": "node_occupied : 4 card(s) active(s) se trouvent encore sur ce nœud"})
    with pytest.raises(ToolError, match="node_occupied — 4 active affaire"):
        await monde.appel("crm_workflow_node_archive", {"node_id": N1})
    monde.simule.forcee = (409, {"code": "23505", "message": 'duplicate key value violates unique constraint "workflow_nodes_catalog_workspace_id_key_key"'})
    with pytest.raises(ToolError, match="node_key_taken"):
        await monde.appel("crm_workflow_node_create", {"workspace": "atelier", "key": "relance", "label": "R"})
    monde.simule.forcee = (403, {"code": "42501", "message": "new row violates row-level security policy"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : nœud du catalogue"):
        await monde.appel("crm_workflow_node_update", {"node_id": N1, "label": "Refusé"})


async def test_archiver_horodate_et_la_matrice_le_ferme(monde: Monde) -> None:
    await monde.appel("crm_workflow_node_archive", {"node_id": N2})
    assert monde.derniere()["corps"]["archived_at"] is not None
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "supprimer"))
    monde.simule.ecritures.clear()
    with pytest.raises(ToolError):
        await monde.appel("crm_workflow_node_archive", {"node_id": N1})
    assert monde.simule.ecritures == []

# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.a : les dix outils de la famille `workflows`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (la liste T2.a, ses ancres et ses actions, les deux retraits destructifs,
#           `crm_workflow_update` et `crm_workflow_archive` absents avant T1.b, les refus nommés), §9.1 (les écritures de
#           l'éditeur), §9.3 (zéro ligne = refus) ; docs/SPEC-workflow-engine.md §3.5 (éteindre puis allumer l'initiale),
#           §3.6 et docs/SPEC-administration-arborescence.md §6.2 (le milieu de deux voisines) ; décisions 754 et 756
"""Le CRM simulé rend un workflow de l'espace A et un de l'espace B ; la vraie base est éprouvée par
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
from crm_mcp.outils import reference, workflows
from crm_mcp.outils.workflows import position_apres
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, TRACK_A, CrmSimule

WF_A = "a0000000-0000-4000-8000-0000000000f1"
WF_B = "b0000000-0000-4000-8000-0000000000f2"
ETAPE_1 = "a0000000-0000-4000-8000-0000000000e1"
ETAPE_2 = "a0000000-0000-4000-8000-0000000000e2"
ETAPE_3 = "a0000000-0000-4000-8000-0000000000e3"
ETAPE_B = "b0000000-0000-4000-8000-0000000000e9"
NOEUD_A = "a0000000-0000-4000-8000-0000000000d1"
TRANSITION_A = "a0000000-0000-4000-8000-0000000000c1"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {
    "crm_workflow_list": ("consulter", "workspace:workspace"),
    "crm_workflow_create": ("ajouter", "workspace:workspace"),
    "crm_workflow_starter_create": ("ajouter", "workspace:workspace"),
    "crm_workflow_step_add": ("ajouter", "workflow:workflow_id"),
    "crm_workflow_transition_add": ("ajouter", "workflow:workflow_id"),
    "crm_workflow_step_update": ("modifier", "step:step_id"),
    "crm_workflow_step_move": ("modifier", "step:step_id"),
    "crm_workflow_transition_update": ("modifier", "transition:transition_id"),
    "crm_workflow_step_remove": ("supprimer", "step:step_id"),
    "crm_workflow_transition_remove": ("supprimer", "transition:transition_id"),
}


class CrmWorkflows(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.rpcs: list[tuple[str, Any]] = []
        #: Une réponse imposée à la prochaine écriture : (statut, corps).
        self.forcee: tuple[int, Any] | None = None
        self.lignes: dict[str, list[dict[str, Any]]] = {
            "workflows": [
                {"id": WF_A, "workspace_id": ESPACE_A, "name": "Cycle", "scope": "global", "track_id": None,
                 "is_default": True, "archived_at": None, "derived_from_workflow_id": None},
                {"id": WF_B, "workspace_id": ESPACE_B, "name": "Ailleurs", "scope": "global", "track_id": None,
                 "is_default": True, "archived_at": None, "derived_from_workflow_id": None},
            ],
            "workflow_steps": [
                {"id": ETAPE_1, "workspace_id": ESPACE_A, "workflow_id": WF_A, "position": 1, "is_initial": True},
                {"id": ETAPE_2, "workspace_id": ESPACE_A, "workflow_id": WF_A, "position": 2, "is_initial": False},
                {"id": ETAPE_3, "workspace_id": ESPACE_A, "workflow_id": WF_A, "position": 4, "is_initial": False},
                {"id": ETAPE_B, "workspace_id": ESPACE_B, "workflow_id": WF_B, "position": 1, "is_initial": True},
            ],
            "workflow_transitions": [
                {"id": TRANSITION_A, "workspace_id": ESPACE_A, "workflow_id": WF_A, "from_step_id": ETAPE_1,
                 "to_step_id": ETAPE_2, "label": None, "require_comment": False},
            ],
            "workflow_nodes_catalog": [{"id": NOEUD_A, "workspace_id": ESPACE_A}],
            "tracks": [{"id": TRACK_A, "workspace_id": ESPACE_A}],
        }

    def _visibles(self, table: str, personne: dict[str, Any], parametres: dict[str, str]) -> list[dict[str, Any]]:
        lisibles = self._lisibles(personne)
        lignes = [l for l in self.lignes[table] if l["workspace_id"] in lisibles]
        for cle, valeur in parametres.items():
            if valeur.startswith("eq.") and "." not in cle:
                lignes = [l for l in lignes if str(l.get(cle)) == valeur.removeprefix("eq.")]
            elif valeur == "is.true":
                lignes = [l for l in lignes if l.get(cle) is True]
        if parametres.get("order", "").startswith("position"):
            lignes = sorted(lignes, key=lambda l: l["position"])
        return lignes

    async def tables(self, requete: Request) -> Response:
        table = requete.path_params["table"]
        if table not in self.lignes:
            return await self.table(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        if requete.method == "GET":
            self.lectures.append((table, parametres))
            return JSONResponse([{**l, "noeud": {"key": "k", "label": "Nœud", "kind": "open"}} for l in
                                 self._visibles(table, personne, parametres)])
        corps = await requete.json() if requete.method != "DELETE" else None
        self.ecritures.append({"table": table, "methode": requete.method, "parametres": parametres, "corps": corps})
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        if requete.method == "POST":
            return JSONResponse([{"id": "nouveau", **corps}], status_code=201)
        touchees = self._visibles(table, personne, parametres)
        if requete.method == "PATCH":
            for ligne in touchees:
                ligne.update(corps)
        return JSONResponse([{"id": l["id"]} for l in touchees])

    async def rpc_workflows(self, requete: Request) -> Response:
        if requete.path_params["fonction"] != "creer_workflow_de_depart":
            return await self.rpc(requete)
        corps = await requete.json()
        self.rpcs.append(("creer_workflow_de_depart", corps))
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        return JSONResponse("wf-depart")

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_workflows, methods=["POST"]),
            Route("/rest/v1/{table}", self.tables, methods=["GET", "POST", "PATCH", "DELETE"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmWorkflows()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows.ajouter(self.mcp, self.moteur, self.crm)
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


async def test_dix_outils_deux_retraits_destructifs_aucun_avant_t1b(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS
    # Le connecteur suit strictement l'écran (décision 756) : renommer et archiver attendent T1.b.
    assert "crm_workflow_update" not in declares and "crm_workflow_archive" not in declares
    async with Client(monde.mcp) as client:
        annotations = {o.name: o.annotations for o in await client.list_tools()}
    destructifs = {n for n in OUTILS if annotations[n].destructive_hint}
    assert destructifs == {"crm_workflow_step_remove", "crm_workflow_transition_remove"}
    assert annotations["crm_workflow_list"].read_only_hint is True


async def test_la_liste_lit_l_espace_et_tait_les_archives(monde: Monde) -> None:
    resultat = await monde.appel("crm_workflow_list", {"workspace": "atelier"})
    table, envoye = monde.simule.lectures[-1]
    assert table == "workflows" and envoye["workspace_id"] == f"eq.{ESPACE_A}"
    assert envoye["archived_at"] == "is.null" and envoye["order"] == "is_default.desc,name.asc"
    assert [w["name"] for w in resultat["workflows"]] == ["Cycle"]
    await monde.appel("crm_workflow_list", {"workspace": "atelier", "include_archived": True})
    assert "archived_at" not in monde.simule.lectures[-1][1]


async def test_creer_envoie_ce_que_l_ecran_envoie(monde: Monde) -> None:
    await monde.appel("crm_workflow_create", {"workspace": "atelier", "name": "  Cycle court ", "track_id": TRACK_A})
    # Sous `global`, le track est oublié ; `is_default` n'est jamais envoyé (`creerWorkflow`).
    assert monde.derniere()["corps"] == {"workspace_id": ESPACE_A, "name": "Cycle court", "scope": "global", "track_id": None}
    await monde.appel("crm_workflow_create", {"workspace": "atelier", "name": "Du track", "scope": "track", "track_id": TRACK_A})
    assert monde.derniere()["corps"]["track_id"] == TRACK_A
    depart = await monde.appel("crm_workflow_starter_create", {"workspace": "atelier"})
    assert monde.simule.rpcs[-1] == ("creer_workflow_de_depart", {"p_workspace": ESPACE_A})
    assert depart["workflow_id"] == "wf-depart"


async def test_ajouter_une_etape_omet_la_position_et_les_surcharges_absentes(monde: Monde) -> None:
    await monde.appel("crm_workflow_step_add", {"workflow_id": WF_A, "node_id": NOEUD_A})
    assert monde.derniere()["corps"] == {"workflow_id": WF_A, "workspace_id": ESPACE_A, "node_id": NOEUD_A}
    await monde.appel("crm_workflow_step_add", {"workflow_id": WF_A, "node_id": NOEUD_A, "label": " Relance ", "probability": 0})
    # `0` n'est pas `null` : une probabilité nulle est une surcharge (§2.5).
    assert monde.derniere()["corps"]["label_override"] == "Relance"
    assert monde.derniere()["corps"]["probability_override"] == 0
    await monde.appel("crm_workflow_transition_add", {"workflow_id": WF_A, "from_step_id": ETAPE_2, "to_step_id": ETAPE_3,
                                                      "label": " ", "require_comment": True})
    assert monde.derniere()["corps"] == {"workflow_id": WF_A, "workspace_id": ESPACE_A, "from_step_id": ETAPE_2,
                                         "to_step_id": ETAPE_3, "label": None, "require_comment": True}


async def test_modifier_une_etape_rend_au_catalogue_et_designe_l_initiale_dans_l_ordre(monde: Monde) -> None:
    await monde.appel("crm_workflow_step_update", {"step_id": ETAPE_2, "probability": 35, "reset": ["label", "stale_after_days"]})
    assert monde.derniere()["corps"] == {"probability_override": 35, "label_override": None, "stale_after_days": None}
    with pytest.raises(ToolError, match="both given and reset"):
        await monde.appel("crm_workflow_step_update", {"step_id": ETAPE_2, "label": "x", "reset": ["label"]})
    with pytest.raises(ToolError, match="make_initial"):
        await monde.appel("crm_workflow_step_update", {"step_id": ETAPE_2})
    monde.simule.ecritures.clear()
    await monde.appel("crm_workflow_step_update", {"step_id": ETAPE_3, "make_initial": True})
    eteindre, allumer = monde.simule.ecritures
    # Éteindre d'abord, dans le workflow de l'étape, puis allumer : jamais deux initiales (§3.5).
    assert eteindre["parametres"]["workflow_id"] == f"eq.{WF_A}" and eteindre["parametres"]["is_initial"] == "is.true"
    assert eteindre["corps"] == {"is_initial": False}
    assert allumer["parametres"]["id"] == f"eq.{ETAPE_3}" and allumer["corps"] == {"is_initial": True}


def test_position_apres_prend_le_milieu_et_refuse_l_indistinct() -> None:
    assert position_apres([1.0, 2.0, 4.0], None) == 0.5
    assert position_apres([1.0, 2.0, 4.0], 1) == 3.0
    assert position_apres([1.0, 2.0, 4.0], 2) == 5.0
    with pytest.raises(ToolError, match="positions_indistinct"):
        position_apres([1.0, 1.0], 0)
    with pytest.raises(ToolError, match="positions_indistinct"):
        position_apres([0.0, 1.0], None)
    with pytest.raises(ToolError, match="alone"):
        position_apres([], None)


async def test_deplacer_une_etape_ecrit_une_seule_position(monde: Monde) -> None:
    await monde.appel("crm_workflow_step_move", {"step_id": ETAPE_1, "after_step_id": ETAPE_2})
    # L'étape 1 retirée, ses voisines sont 2 (position 2) et 3 (position 4) : le milieu, 3.
    assert monde.derniere()["corps"] == {"position": 3.0}
    with pytest.raises(ToolError, match="after itself"):
        await monde.appel("crm_workflow_step_move", {"step_id": ETAPE_1, "after_step_id": ETAPE_1})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : étape"):
        await monde.appel("crm_workflow_step_move", {"step_id": ETAPE_1, "after_step_id": ETAPE_B})


async def test_l_etape_deplacee_n_est_pas_sa_propre_voisine(monde: Monde) -> None:
    # 2 après 1 tombe entre 1 et 4 (2,5), et non entre 1 et sa propre place (1,5).
    await monde.appel("crm_workflow_step_move", {"step_id": ETAPE_2, "after_step_id": ETAPE_1})
    assert monde.derniere()["corps"] == {"position": 2.5}


async def test_une_transition_change_de_libelle_jamais_d_extremites(monde: Monde) -> None:
    await monde.appel("crm_workflow_transition_update", {"transition_id": TRANSITION_A, "label": "", "require_comment": True})
    assert monde.derniere()["corps"] == {"label": None, "require_comment": True}
    with pytest.raises(ToolError, match="never change"):
        await monde.appel("crm_workflow_transition_update", {"transition_id": TRANSITION_A})


async def test_les_refus_de_la_base_sont_nommes(monde: Monde) -> None:
    monde.simule.forcee = (409, {"code": "23503", "message":
        'update or delete on table "workflow_steps" violates foreign key constraint "card_placements_step_fk" on table "card_placements"'})
    with pytest.raises(ToolError, match="step_occupied"):
        await monde.appel("crm_workflow_step_remove", {"step_id": ETAPE_1})
    monde.simule.forcee = (409, {"code": "23505", "message":
        'duplicate key value violates unique constraint "workflow_steps_workflow_id_node_id_key"'})
    with pytest.raises(ToolError, match="node_already_in_workflow"):
        await monde.appel("crm_workflow_step_add", {"workflow_id": WF_A, "node_id": NOEUD_A})
    monde.simule.forcee = (409, {"code": "23503", "message":
        'insert or update on table "workflow_transitions" violates foreign key constraint "workflow_transitions_to_step_fkey"'})
    with pytest.raises(ToolError, match="step_outside_workflow"):
        await monde.appel("crm_workflow_transition_add", {"workflow_id": WF_A, "from_step_id": ETAPE_1, "to_step_id": ETAPE_2})
    monde.simule.forcee = (400, {"code": "P0001", "message": "workflow existant"})
    with pytest.raises(ToolError, match="workflow_exists"):
        await monde.appel("crm_workflow_starter_create", {"workspace": "atelier"})
    monde.simule.forcee = (400, {"code": "P0001", "message": "noeud archive : relance"})
    with pytest.raises(ToolError, match="node_archived — the catalogue node `relance`"):
        await monde.appel("crm_workflow_starter_create", {"workspace": "atelier"})
    monde.simule.forcee = (403, {"code": "42501", "message": "new row violates row-level security policy"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : espace"):
        await monde.appel("crm_workflow_create", {"workspace": "atelier", "name": "x"})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : transition"):
        await monde.appel("crm_workflow_transition_remove", {"transition_id": TRANSITION_A})


async def test_un_objet_d_un_autre_espace_n_est_jamais_ecrit(monde: Monde) -> None:
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_workflow_step_add", {"workflow_id": WF_B, "node_id": NOEUD_A})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : étape"):
        await monde.appel("crm_workflow_step_remove", {"step_id": ETAPE_B})
    assert monde.simule.ecritures == []


async def test_la_matrice_ferme_le_retrait_sans_sa_case(monde: Monde) -> None:
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "supprimer"))
    with pytest.raises(ToolError):
        await monde.appel("crm_workflow_step_remove", {"step_id": ETAPE_1})
    assert monde.simule.ecritures == []

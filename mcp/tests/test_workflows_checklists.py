# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.b, les points de checklist d'une étape, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (les quatre outils de checklist : `ajouter` pour l'ajout — décision 761 —,
#           `modifier` pour renommer, réordonner et exiger, `supprimer` destructif pour l'archive ; le genre d'ancre
#           `checklist_item`), §9.3 ; docs/SPEC-checklists.md §3.1, §3.4 ; docs/DESIGN_SYSTEM.md §5.18 (la position d'un
#           ajout compte les archivés ; un point archivé ne se déplace pas)
"""Le CRM simulé est celui de T2.a, augmenté des points d'étape et des exigences ; la vraie base est éprouvée par
`tests/test_integration_workflows.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import reference, workflows_checklists
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET
from .test_workflows import ETAPE_1, ETAPE_2, THOMAS, TRANSITION_A, WF_A, CrmWorkflows

P1 = "a0000000-0000-4000-8000-0000000000a1"
P2 = "a0000000-0000-4000-8000-0000000000a2"
P3 = "a0000000-0000-4000-8000-0000000000a3"
PB = "b0000000-0000-4000-8000-0000000000a9"
OUTILS = {
    "crm_step_checklist_item_add": ("ajouter", "step:step_id"),
    "crm_step_checklist_item_update": ("modifier", "checklist_item:item_id"),
    "crm_transition_required_checklist_item_set": ("modifier", "transition:transition_id"),
    "crm_step_checklist_item_archive": ("supprimer", "checklist_item:item_id"),
}


class CrmChecklists(CrmWorkflows):
    def __init__(self) -> None:
        super().__init__()
        point = {"workspace_id": ESPACE_A, "workflow_id": WF_A, "step_id": ETAPE_1, "archived_at": None}
        self.lignes["workflow_step_checklist_items"] = [
            {**point, "id": P1, "label": "Besoin confirmé", "position": 1},
            {**point, "id": P2, "label": "Décideur identifié", "position": 2},
            {**point, "id": P3, "label": "Ancien point", "position": 5, "archived_at": "2026-10-27T09:00:00Z"},
            {"workspace_id": ESPACE_B, "workflow_id": "wf-b", "step_id": "e-b", "archived_at": None, "id": PB,
             "label": "Ailleurs", "position": 1},
        ]
        self.lignes["workflow_transition_required_checklist_items"] = [
            {"workspace_id": ESPACE_A, "transition_id": TRANSITION_A, "step_item_id": P2},
        ]

    async def tables(self, requete: Request) -> Response:
        table = requete.path_params["table"]
        if table not in ("workflow_step_checklist_items", "workflow_transition_required_checklist_items") or (
            requete.method not in ("PATCH", "DELETE")
        ):
            return await super().tables(requete)
        # Comme PostgREST avec `select` : les lignes touchées, entières ; un retrait les ôte.
        personne = self._personne(requete)
        parametres = dict(requete.query_params)
        corps = await requete.json() if requete.method == "PATCH" else None
        self.ecritures.append({"table": table, "methode": requete.method, "parametres": parametres, "corps": corps})
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        touchees = self._visibles(table, personne, parametres)
        for ligne in touchees:
            if corps is not None:
                ligne.update(corps)
            else:
                self.lignes[table].remove(ligne)
        return JSONResponse(touchees)

    def _visibles(self, table: str, personne: dict[str, Any], parametres: dict[str, str]) -> list[dict[str, Any]]:
        lignes = super()._visibles(table, personne, parametres)
        if parametres.get("archived_at") == "is.null":
            lignes = [l for l in lignes if l.get("archived_at") is None]
        return lignes


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmChecklists()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows_checklists.ajouter(self.mcp, self.moteur, self.crm)
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


async def test_quatre_outils_l_ajout_sous_ajouter_l_archive_seule_destructive(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS
    assert monde.moteur.declarations["crm_transition_required_checklist_item_set"].autres == ("checklist_item:item_id",)
    async with Client(monde.mcp) as client:
        outils = {o.name: o for o in await client.list_tools()}
    assert {n for n in OUTILS if outils[n].annotations.destructive_hint} == {"crm_step_checklist_item_archive"}
    assert not any("unarchive" in n for n in outils)


async def test_ajouter_place_apres_le_dernier_archives_compris_et_trime(monde: Monde) -> None:
    lu = await monde.appel("crm_step_checklist_item_add", {"step_id": ETAPE_1, "label": "  Proposition envoyée  "})
    assert monde.derniere()["corps"] == {
        "workspace_id": ESPACE_A, "workflow_id": WF_A, "step_id": ETAPE_1, "label": "Proposition envoyée", "position": 6.0,
    }
    assert lu["checklist_item"]["label"] == "Proposition envoyée"
    await monde.appel("crm_step_checklist_item_add", {"step_id": ETAPE_2, "label": "Premier point"})
    assert monde.derniere()["corps"]["position"] == 1.0
    with pytest.raises(ToolError, match="cannot be blank"):
        await monde.appel("crm_step_checklist_item_add", {"step_id": ETAPE_1, "label": "   "})


async def test_renommer_et_deplacer_parmi_les_points_actifs(monde: Monde) -> None:
    await monde.appel("crm_step_checklist_item_update", {"item_id": P2, "label": " Décideur rencontré "})
    assert monde.derniere()["corps"] == {"label": "Décideur rencontré"}
    await monde.appel("crm_step_checklist_item_update", {"item_id": P2, "move_to_top": True})
    # P2 retiré, l'archivé écarté : P1 (1) seul ; en tête, la moitié.
    assert monde.derniere()["corps"] == {"position": 0.5}
    # P2 est désormais à 0,5 ; P1 retiré, P2 est seul et le dernier : P1 se place un cran après.
    await monde.appel("crm_step_checklist_item_update", {"item_id": P1, "after_item_id": P2})
    assert monde.derniere()["corps"] == {"position": 1.5}
    with pytest.raises(ToolError, match="archived item does not move"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": P3, "move_to_top": True})
    with pytest.raises(ToolError, match="not an active item of the same step"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": P1, "after_item_id": P3})
    with pytest.raises(ToolError, match="Give a new label"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": P1})
    with pytest.raises(ToolError, match="exclusive"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": P1, "after_item_id": P2, "move_to_top": True})


async def test_exiger_et_ne_plus_exiger_un_point(monde: Monde) -> None:
    lu = await monde.appel("crm_transition_required_checklist_item_set", {"transition_id": TRANSITION_A, "item_id": P1, "required": True})
    assert monde.derniere()["methode"] == "POST" and monde.derniere()["corps"] == {"transition_id": TRANSITION_A, "step_item_id": P1}
    assert lu == {"transition_id": TRANSITION_A, "checklist_item_id": P1, "required": True}
    await monde.appel("crm_transition_required_checklist_item_set", {"transition_id": TRANSITION_A, "item_id": P2, "required": False})
    retrait = monde.derniere()
    assert retrait["methode"] == "DELETE"
    assert retrait["parametres"]["transition_id"] == f"eq.{TRANSITION_A}" and retrait["parametres"]["step_item_id"] == f"eq.{P2}"
    with pytest.raises(ToolError, match="not_required"):
        await monde.appel("crm_transition_required_checklist_item_set", {"transition_id": TRANSITION_A, "item_id": P1, "required": False})


async def test_les_refus_des_checklists_sont_nommes(monde: Monde) -> None:
    monde.simule.forcee = (400, {"code": "22023", "message": "checklist_item_not_from_source_step"})
    with pytest.raises(ToolError, match="checklist_item_not_from_source_step — a move can only require an item of its departure"):
        await monde.appel("crm_transition_required_checklist_item_set", {"transition_id": TRANSITION_A, "item_id": P1, "required": True})
    monde.simule.forcee = (409, {"code": "23505", "message": "duplicate key value violates unique constraint"})
    with pytest.raises(ToolError, match="checklist_item_already_required"):
        await monde.appel("crm_transition_required_checklist_item_set", {"transition_id": TRANSITION_A, "item_id": P2, "required": True})
    monde.simule.forcee = (400, {"code": "23514", "message": 'new row violates check constraint "workflow_step_checklist_items_label_check"'})
    with pytest.raises(ToolError, match="label — 1 to 200 characters"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": P1, "label": "x"})
    monde.simule.forcee = (403, {"code": "42501", "message": "new row violates row-level security policy"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : étape"):
        await monde.appel("crm_step_checklist_item_add", {"step_id": ETAPE_1, "label": "Refusé"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : point de checklist d'étape"):
        await monde.appel("crm_step_checklist_item_update", {"item_id": PB, "label": "Ailleurs"})


async def test_archiver_horodate_et_la_matrice_le_ferme(monde: Monde) -> None:
    lu = await monde.appel("crm_step_checklist_item_archive", {"item_id": P1})
    assert monde.derniere()["corps"]["archived_at"] is not None and lu["checklist_item"]["archived"] is True
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "supprimer"))
    monde.simule.ecritures.clear()
    with pytest.raises(ToolError):
        await monde.appel("crm_step_checklist_item_archive", {"item_id": P2})
    assert monde.simule.ecritures == []

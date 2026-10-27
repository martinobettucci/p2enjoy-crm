# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.b : les huit outils du formulaire d'un workflow, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (la liste T2.b, ses ancres et ses actions, l'archive seule destructive, les
#           outils de checklist absents avant `CRM-068` T3b, les refus nommés), §9.3 ; docs/SPEC-workflow-engine.md
#           §7 bis.10 (options du type, ni clé ni type modifiés), §7 bis.11 (`upsert` de la case, retrait au défaut),
#           §7 bis.12 (`POST` simple, retrait), §7 bis.13 (la prévisualisation, exactement une cible) ; décision 756
"""Le CRM simulé rend un workflow de l'espace A, deux étapes, deux champs, une transition ; la vraie base est éprouvée par
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
from crm_mcp.outils import reference, workflows_formulaire
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

WF = "a0000000-0000-4000-8000-0000000000f1"
E1 = "a0000000-0000-4000-8000-0000000000e1"
E2 = "a0000000-0000-4000-8000-0000000000e2"
C1 = "a0000000-0000-4000-8000-0000000000a1"
C2 = "a0000000-0000-4000-8000-0000000000a2"
C3 = "a0000000-0000-4000-8000-0000000000a3"
CB = "b0000000-0000-4000-8000-0000000000a9"
TR = "a0000000-0000-4000-8000-0000000000c1"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {
    "crm_workflow_form_get": ("consulter", "workflow:workflow_id"),
    "crm_transition_requirement_preview": ("consulter", "field:field_id"),
    "crm_form_field_add": ("ajouter", "workflow:workflow_id"),
    "crm_form_field_update": ("modifier", "field:field_id"),
    "crm_form_field_move": ("modifier", "field:field_id"),
    "crm_form_field_visibility_set": ("modifier", "field:field_id"),
    "crm_transition_required_field_set": ("modifier", "transition:transition_id"),
    "crm_form_field_archive": ("supprimer", "field:field_id"),
}


class CrmFormulaire(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.rpcs: list[tuple[str, Any]] = []
        self.forcee: tuple[int, Any] | None = None
        a = {"workspace_id": ESPACE_A, "workflow_id": WF}
        self.lignes: dict[str, list[dict[str, Any]]] = {
            "workflows": [{"id": WF, "workspace_id": ESPACE_A, "name": "Cycle"}],
            "workflow_steps": [{"id": E1, "position": 1, "label_override": None, "noeud": {"label": "Prospection"}, **a},
                               {"id": E2, "position": 2, "label_override": "Relance client", "noeud": {"label": "Relance"}, **a}],
            "form_fields": [
                {"id": C1, "key": "budget", "label": "Budget", "type": "money", "options": {"currency": "EUR"},
                 "help_text": None, "position": 1, "archived_at": None, **a},
                {"id": C2, "key": "source", "label": "Source", "type": "select",
                 "options": {"choices": [{"key": "web", "label": "Web"}]}, "help_text": None, "position": 2,
                 "archived_at": None, **a},
                {"id": C3, "key": "ancien", "label": "Ancien", "type": "text", "options": {}, "help_text": None,
                 "position": 4, "archived_at": "2026-10-01T00:00:00Z", **a},
                {"id": CB, "key": "x", "label": "X", "type": "text", "options": {}, "position": 1, "archived_at": None,
                 "workspace_id": ESPACE_B, "workflow_id": "autre"},
            ],
            "form_field_rules": [{"field_id": C1, "step_id": E2, "visibility": "required", **a}],
            "workflow_transitions": [{"id": TR, "from_step_id": E1, "to_step_id": E2, "label": None, **a}],
            "workflow_transition_required_fields": [{"transition_id": TR, "field_id": C2, "workspace_id": ESPACE_A}],
            "workflow_step_checklist_items": [{"id": "p1", "step_id": E1, "label": "Appel", "position": 1,
                                               "archived_at": None, **a}],
            "workflow_transition_required_checklist_items": [{"transition_id": TR, "step_item_id": "p1",
                                                              "workspace_id": ESPACE_A}],
        }

    def _visibles(self, table: str, personne: dict[str, Any], parametres: dict[str, str]) -> list[dict[str, Any]]:
        lisibles = self._lisibles(personne)
        lignes = [l for l in self.lignes[table] if l["workspace_id"] in lisibles]
        for cle, valeur in parametres.items():
            if valeur.startswith("eq.") and "." not in cle:
                lignes = [l for l in lignes if str(l.get(cle)) == valeur.removeprefix("eq.")]
            elif valeur.startswith("in.("):
                ids = valeur[4:-1].split(",")
                lignes = [l for l in lignes if str(l.get(cle)) in ids]
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
            return JSONResponse(self._visibles(table, personne, parametres))
        corps = await requete.json() if requete.method != "DELETE" else None
        self.ecritures.append({"table": table, "methode": requete.method, "parametres": parametres, "corps": corps,
                               "prefer": requete.headers.get("prefer")})
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        if requete.method == "POST":
            return JSONResponse([{"id": "nouveau", "position": 9, "archived_at": None, **corps}], status_code=201)
        touchees = self._visibles(table, personne, parametres)
        if requete.method == "PATCH":
            for ligne in touchees:
                ligne.update(corps)
        return JSONResponse([dict(l) for l in touchees])

    async def rpc_formulaire(self, requete: Request) -> Response:
        if requete.path_params["fonction"] != "previsualiser_exigence":
            return await self.rpc(requete)
        corps = await requete.json()
        self.rpcs.append(("previsualiser_exigence", corps))
        return JSONResponse([{"sur_place": 3, "a_l_entree": 2}])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_formulaire, methods=["POST"]),
            Route("/rest/v1/{table}", self.tables, methods=["GET", "POST", "PATCH", "DELETE"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmFormulaire()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows_formulaire.ajouter(self.mcp, self.moteur, self.crm)
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


async def test_huit_outils_l_archive_seule_destructive_aucun_outil_de_checklist(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS
    assert not any("checklist" in n for n in declares)
    async with Client(monde.mcp) as client:
        annotations = {o.name: o.annotations for o in await client.list_tools()}
    assert {n for n in OUTILS if annotations[n].destructive_hint} == {"crm_form_field_archive"}


async def test_le_formulaire_rend_la_grille_avec_le_defaut_et_les_exigences(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_form_get", {"workflow_id": WF})
    assert [e["name"] for e in lu["steps"]] == ["Prospection", "Relance client"]
    assert lu["steps"][0]["checklist_items"] == [{"id": "p1", "label": "Appel", "archived": False}]
    budget, source, ancien = lu["fields"]
    assert budget["visibility_by_step"] == {E1: "default", E2: "required"}
    assert ancien["archived"] is True and source["options"]["choices"][0]["key"] == "web"
    assert lu["transitions"][0]["required_field_ids"] == [C2]
    assert lu["transitions"][0]["required_checklist_item_ids"] == ["p1"]


async def test_la_previsualisation_exige_une_seule_cible(monde: Monde) -> None:
    effets = await monde.appel("crm_transition_requirement_preview", {"field_id": C1, "step_id": E2})
    assert monde.simule.rpcs[-1] == ("previsualiser_exigence", {"p_field_id": C1, "p_step_id": E2})
    assert effets["affaires_already_there"] == 3 and effets["affaires_blocked_at_entry"] == 2
    with pytest.raises(ToolError, match="exactly one"):
        await monde.appel("crm_transition_requirement_preview", {"field_id": C1})
    with pytest.raises(ToolError, match="exactly one"):
        await monde.appel("crm_transition_requirement_preview", {"field_id": C1, "step_id": E2, "transition_id": TR})


async def test_declarer_compose_les_options_du_type(monde: Monde) -> None:
    await monde.appel("crm_form_field_add", {"workflow_id": WF, "key": "taille", "label": " Taille ", "type": "select",
                                             "choices": [{"key": " s ", "label": "Petite"}, {"key": "m", "label": "Moyenne"}]})
    assert monde.derniere()["corps"] == {
        "workflow_id": WF, "workspace_id": ESPACE_A, "key": "taille", "label": "Taille", "type": "select",
        "help_text": None, "options": {"choices": [{"key": "s", "label": "Petite"}, {"key": "m", "label": "Moyenne"}]},
    }
    await monde.appel("crm_form_field_add", {"workflow_id": WF, "key": "prix", "label": "Prix", "type": "money", "currency": "chf"})
    assert monde.derniere()["corps"]["options"] == {"currency": "CHF"}
    await monde.appel("crm_form_field_add", {"workflow_id": WF, "key": "note", "label": "Note", "type": "text", "help_text": " "})
    assert monde.derniere()["corps"]["options"] == {} and monde.derniere()["corps"]["help_text"] is None
    for arguments, motif in (
        ({"type": "select"}, "needs choices"),
        ({"type": "select", "choices": [{"key": "a", "label": "A"}, {"key": "a", "label": "B"}]}, "same key"),
        ({"type": "text", "choices": [{"key": "a", "label": "A"}]}, "takes no choices"),
        ({"type": "money"}, "needs its currency"),
        ({"type": "date", "currency": "EUR"}, "takes no currency"),
    ):
        with pytest.raises(ToolError, match=motif):
            await monde.appel("crm_form_field_add", {"workflow_id": WF, "key": "k", "label": "L", **arguments})


async def test_modifier_garde_la_cle_et_le_type(monde: Monde) -> None:
    await monde.appel("crm_form_field_update", {"field_id": C1, "label": "Budget estimé", "help_text": ""})
    assert monde.derniere()["corps"] == {"label": "Budget estimé", "help_text": None}
    await monde.appel("crm_form_field_update", {"field_id": C2, "choices": [{"key": "web", "label": "Site"}]})
    assert monde.derniere()["corps"] == {"options": {"choices": [{"key": "web", "label": "Site"}]}}
    with pytest.raises(ToolError, match="takes no choices"):
        await monde.appel("crm_form_field_update", {"field_id": C1, "choices": [{"key": "a", "label": "A"}]})
    with pytest.raises(ToolError, match="never change"):
        await monde.appel("crm_form_field_update", {"field_id": C1})


async def test_deplacer_compte_les_archives_et_n_est_pas_son_propre_voisin(monde: Monde) -> None:
    await monde.appel("crm_form_field_move", {"field_id": C1, "after_field_id": C2})
    # C1 retiré : C2 (2) puis C3 archivé (4) ; le milieu, 3.
    assert monde.derniere()["corps"] == {"position": 3.0}
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : champ"):
        await monde.appel("crm_form_field_move", {"field_id": C1, "after_field_id": CB})


async def test_le_champ_deplace_n_est_pas_son_propre_voisin(monde: Monde) -> None:
    # C2 après C1 tombe entre C1 (1) et C3 (4), soit 2,5 — et non entre C1 et sa propre place (1,5).
    await monde.appel("crm_form_field_move", {"field_id": C2, "after_field_id": C1})
    assert monde.derniere()["corps"] == {"position": 2.5}


async def test_la_visibilite_est_un_upsert_et_le_defaut_un_retrait(monde: Monde) -> None:
    await monde.appel("crm_form_field_visibility_set", {"field_id": C2, "step_id": E1, "visibility": "hidden"})
    ecriture = monde.derniere()
    assert ecriture["methode"] == "POST" and ecriture["parametres"]["on_conflict"] == "field_id,step_id"
    assert "merge-duplicates" in ecriture["prefer"]
    assert ecriture["corps"] == {"field_id": C2, "step_id": E1, "workflow_id": WF, "workspace_id": ESPACE_A, "visibility": "hidden"}
    rendu = await monde.appel("crm_form_field_visibility_set", {"field_id": C1, "step_id": E2, "visibility": "default"})
    assert monde.derniere()["methode"] == "DELETE" and rendu["changed"] is True


async def test_exiger_est_un_post_simple_et_le_retrait_absent_est_nomme(monde: Monde) -> None:
    await monde.appel("crm_transition_required_field_set", {"transition_id": TR, "field_id": C1, "required": True})
    assert monde.derniere()["methode"] == "POST" and monde.derniere()["corps"] == {"transition_id": TR, "field_id": C1}
    assert "merge-duplicates" not in (monde.derniere()["prefer"] or "")
    await monde.appel("crm_transition_required_field_set", {"transition_id": TR, "field_id": C2, "required": False})
    assert monde.derniere()["parametres"]["field_id"] == f"eq.{C2}"
    with pytest.raises(ToolError, match="not_required"):
        await monde.appel("crm_transition_required_field_set", {"transition_id": TR, "field_id": C1, "required": False})


async def test_les_refus_du_formulaire_sont_nommes(monde: Monde) -> None:
    for (statut, corps), outil, arguments, motif in (
        ((409, {"code": "23505", "message": 'duplicate key value violates unique constraint "form_fields_workflow_id_key_key"'}),
         "crm_form_field_add", {"workflow_id": WF, "key": "budget", "label": "B", "type": "text"}, "field_key_taken"),
        ((409, {"code": "23505", "message": 'duplicate key value violates unique constraint "workflow_transition_required_fields_pkey"'}),
         "crm_transition_required_field_set", {"transition_id": TR, "field_id": C2, "required": True}, "already_required"),
        ((400, {"code": "P0001", "message": "required_field_workflow_mismatch"}),
         "crm_transition_required_field_set", {"transition_id": TR, "field_id": C1, "required": True}, "required_field_workflow_mismatch"),
        ((400, {"code": "23514", "message": 'new row violates check constraint "form_fields_key_check"'}),
         "crm_form_field_add", {"workflow_id": WF, "key": "Mauvaise", "label": "B", "type": "text"}, "form_fields_key_check"),
        ((200, []), "crm_form_field_archive", {"field_id": C1}, "Introuvable ou hors de votre périmètre : champ"),
    ):
        monde.simule.forcee = (statut, corps)
        with pytest.raises(ToolError, match=motif):
            await monde.appel(outil, arguments)


async def test_archiver_ne_detruit_rien_et_la_matrice_le_ferme(monde: Monde) -> None:
    await monde.appel("crm_form_field_archive", {"field_id": C1})
    assert monde.derniere()["methode"] == "PATCH" and monde.derniere()["corps"]["archived_at"] is not None
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "supprimer"))
    monde.simule.ecritures.clear()
    with pytest.raises(ToolError):
        await monde.appel("crm_form_field_archive", {"field_id": C2})
    assert monde.simule.ecritures == []

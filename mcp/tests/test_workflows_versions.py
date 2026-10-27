# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.c : les six outils de version de la famille `workflows`, devant un CRM
#           simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (la liste T2.c, ses ancres et ses actions, la restauration destructive,
#           `crm_workflow_copy_to_track` absent avant T1.b, aucune empreinte vivante transmise), §9.3 ;
#           docs/SPEC-workflow-engine.md §7 ter.12 (les instructions ordonnées, aucune inventée), §7 ter.14.7 (les refus
#           nommés, les refus d'accès uniformes), §7 ter.14.8 ; décision 756
"""Le CRM simulé rend deux versions d'un workflow de l'espace A et une version de l'espace B ; la vraie base est éprouvée
par `tests/test_integration_workflows.py`."""

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
from crm_mcp.outils import reference, workflows_versions
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

WF = "a0000000-0000-4000-8000-0000000000f1"
COPIE = "a0000000-0000-4000-8000-0000000000f3"
V1 = "a0000000-0000-4000-8000-0000000000b1"
V2 = "a0000000-0000-4000-8000-0000000000b2"
VB = "b0000000-0000-4000-8000-0000000000b9"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {
    "crm_workflow_version_list": ("consulter", "workflow:workflow_id"),
    "crm_workflow_version_compare": ("consulter", "version:base_version_id"),
    "crm_workflow_source_compare": ("consulter", "workflow:workflow_id"),
    "crm_workflow_remap_plan": ("consulter", "version:version_id"),
    "crm_workflow_version_publish": ("ajouter", "workflow:workflow_id"),
    "crm_workflow_version_restore": ("modifier", "version:version_id"),
}


class CrmVersions(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.forcee: tuple[int, Any] | None = None
        self.lignes: dict[str, list[dict[str, Any]]] = {
            "workflows": [{"id": WF, "workspace_id": ESPACE_A}, {"id": COPIE, "workspace_id": ESPACE_A}],
            "workflow_versions": [
                {"id": V2, "workspace_id": ESPACE_A, "workflow_id": WF, "version_number": 2, "note": "Après refonte",
                 "published_at": "2026-10-26T10:00:00Z", "composition_fingerprint": "f2", "auteur": {"full_name": "Camille"}},
                {"id": V1, "workspace_id": ESPACE_A, "workflow_id": WF, "version_number": 1, "note": None,
                 "published_at": "2026-10-20T10:00:00Z", "composition_fingerprint": "f1", "auteur": None},
                {"id": VB, "workspace_id": ESPACE_B, "workflow_id": "autre", "version_number": 1},
            ],
            "workflow_derivations": [{"workflow_id": COPIE, "workspace_id": ESPACE_A, "source_workflow_id": WF,
                                      "source_name": "Cycle", "derived_at": "2026-10-01", "source_archived_at": None,
                                      "source_modified_since_copy": True}],
        }

    async def tables(self, requete: Request) -> Response:
        table = requete.path_params["table"]
        if table not in self.lignes:
            return await self.table(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        self.lectures.append((table, parametres))
        lisibles = self._lisibles(personne)
        lignes = [l for l in self.lignes[table] if l["workspace_id"] in lisibles]
        for cle, valeur in parametres.items():
            if valeur.startswith("eq.") and "." not in cle:
                lignes = [l for l in lignes if str(l.get(cle)) == valeur.removeprefix("eq.")]
        return JSONResponse(lignes)

    async def rpc_versions(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction not in ("compare_workflow_versions", "compare_workflow_with_source", "plan_card_remapping",
                            "publish_workflow_version", "restore_workflow_version"):
            return await self.rpc(requete)
        corps = await requete.json()
        self.rpcs.append((fonction, corps))
        if self.forcee is not None:
            statut, reponse = self.forcee
            self.forcee = None
            return JSONResponse(reponse, status_code=statut)
        if fonction == "publish_workflow_version":
            return JSONResponse({"id": "v3", "version_number": 3, "note": corps.get("note"), "published_at": "maintenant"})
        return JSONResponse({"fonction": fonction, "ready": True})

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_versions, methods=["POST"]),
            Route("/rest/v1/{table}", self.tables, methods=["GET"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmVersions()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows_versions.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "admin"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "workflows", a) for a in ("consulter", "ajouter", "modifier")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_six_outils_la_restauration_destructive_aucune_copie_avant_t1b(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS and "crm_workflow_copy_to_track" not in declares
    async with Client(monde.mcp) as client:
        annotations = {o.name: o.annotations for o in await client.list_tools()}
    assert {n for n in OUTILS if annotations[n].destructive_hint} == {"crm_workflow_version_restore"}


async def test_la_liste_des_versions_nomme_l_auteur_et_tait_l_autre_espace(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_version_list", {"workflow_id": WF})
    table, parametres = monde.simule.lectures[-1]
    assert table == "workflow_versions" and parametres["order"] == "version_number.desc"
    assert "workflow_versions_published_by_fkey" in parametres["select"]
    assert [(v["version_number"], v["published_by"]) for v in lu["versions"]] == [(2, "Camille"), (1, None)]


async def test_comparer_et_planifier_appellent_les_fonctions_de_l_ecran(monde: Monde) -> None:
    await monde.appel("crm_workflow_version_compare", {"base_version_id": V1, "target_version_id": V2})
    assert monde.simule.rpcs[-1] == ("compare_workflow_versions", {"base_version_id": V1, "target_version_id": V2})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : version de workflow"):
        await monde.appel("crm_workflow_version_compare", {"base_version_id": V1, "target_version_id": VB})
    await monde.appel("crm_workflow_remap_plan", {"version_id": V1})
    assert monde.simule.rpcs[-1] == ("plan_card_remapping", {"target_version_id": V1})
    await monde.appel("crm_workflow_remap_plan", {"version_id": V1, "step_overrides": [
        {"from_step_id": "z", "to_step_id": "b"}, {"from_step_id": "a", "to_step_id": "c"}]})
    # Ordonnées par étape de départ, comme `composerInstructions` : deux compositions des mêmes choix sont égales.
    assert monde.simule.rpcs[-1][1]["step_overrides"] == [{"from_step_id": "a", "to_step_id": "c"},
                                                          {"from_step_id": "z", "to_step_id": "b"}]


async def test_comparer_a_la_source_exige_une_copie(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_source_compare", {"workflow_id": COPIE})
    assert lu["source"] == {"workflow_id": WF, "name": "Cycle", "copied_at": "2026-10-01", "archived": False,
                            "changed_since_copy": True}
    assert monde.simule.rpcs[-1] == ("compare_workflow_with_source", {"workflow_id": COPIE})
    with pytest.raises(ToolError, match="not a copy"):
        await monde.appel("crm_workflow_source_compare", {"workflow_id": WF})


async def test_publier_et_restaurer_sans_empreinte_vivante(monde: Monde) -> None:
    publiee = await monde.appel("crm_workflow_version_publish", {"workflow_id": WF, "note": "  Avant essai "})
    assert monde.simule.rpcs[-1] == ("publish_workflow_version", {"target_workflow_id": WF, "note": "Avant essai"})
    assert publiee["version"]["version_number"] == 3
    await monde.appel("crm_workflow_version_publish", {"workflow_id": WF, "note": " "})
    assert monde.simule.rpcs[-1] == ("publish_workflow_version", {"target_workflow_id": WF})
    await monde.appel("crm_workflow_version_restore", {"version_id": V1, "step_overrides": [{"from_step_id": "a", "to_step_id": "b"}]})
    nom, arguments = monde.simule.rpcs[-1]
    assert nom == "restore_workflow_version" and "expected_live_fingerprint" not in arguments
    assert arguments == {"target_version_id": V1, "step_overrides": [{"from_step_id": "a", "to_step_id": "b"}]}


async def test_les_refus_de_version_sont_nommes_et_l_acces_reste_uniforme(monde: Monde) -> None:
    for message, outil, arguments, motif in (
        ("composition inchangee", "crm_workflow_version_publish", {"workflow_id": WF}, "composition_unchanged"),
        ("plan non applicable", "crm_workflow_version_restore", {"version_id": V1}, "plan_not_ready"),
        ("remappage ambigu", "crm_workflow_remap_plan", {"version_id": V1}, "remap_ambiguous"),
        ("versions de workflows differents", "crm_workflow_version_compare", {"base_version_id": V1, "target_version_id": V2},
         "versions_of_different_workflows"),
        ("restauration reservee aux administrateurs", "crm_workflow_version_restore", {"version_id": V1},
         "Introuvable ou hors de votre périmètre : version de workflow"),
    ):
        monde.simule.forcee = (400, {"code": "P0001", "message": message})
        with pytest.raises(ToolError, match=motif):
            await monde.appel(outil, arguments)

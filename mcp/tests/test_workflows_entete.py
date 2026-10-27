# @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.e : les quatre outils qui suivent leur écran, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 undecies (les lignes `crm_workflow_update`, `crm_workflow_archive`,
#           `crm_workflow_copy_to_track`, `crm_channel_workflow_change` : actions, ancres, destructifs, refus nommés ; rien
#           pour rétablir), §9.3 ; docs/SPEC-workflow-engine.md §7 quinquies ; docs/SPEC-change-channel-workflow.md §2
#           (mapping ordonné, rien de deviné), §3, §5 (la perte explicite)
"""Le CRM simulé est celui de T2.a, augmenté des channels, des rattachements et des trois fonctions ; la vraie base est
éprouvée par `tests/test_integration_workflows.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import reference, workflows_entete
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET, TRACK_A
from .test_workflows import ETAPE_1, ETAPE_2, THOMAS, WF_A, WF_B, CrmWorkflows

WF_LIBRE = "a0000000-0000-4000-8000-0000000000f3"
CHANNEL_A = "a0000000-0000-4000-8000-0000000000b1"
OUTILS = {
    "crm_workflow_update": ("modifier", "workflow:workflow_id"),
    "crm_workflow_archive": ("supprimer", "workflow:workflow_id"),
    "crm_workflow_copy_to_track": ("ajouter", "workflow:workflow_id"),
    "crm_channel_workflow_change": ("modifier", "channel:channel_id"),
}


class CrmEntete(CrmWorkflows):
    def __init__(self) -> None:
        super().__init__()
        self.lignes["workflows"].append(
            {"id": WF_LIBRE, "workspace_id": ESPACE_A, "name": "Libre", "scope": "global", "track_id": None,
             "is_default": False, "archived_at": None, "derived_from_workflow_id": None},
        )
        self.lignes["channels"] = [{"id": CHANNEL_A, "workspace_id": ESPACE_A, "workflow_id": WF_A}]
        self.lignes["card_placements"] = [
            {"id": "p1", "workspace_id": ESPACE_A, "channel_id": CHANNEL_A, "current_step_id": ETAPE_1},
            {"id": "p2", "workspace_id": ESPACE_A, "channel_id": CHANNEL_A, "current_step_id": ETAPE_2},
            {"id": "p3", "workspace_id": ESPACE_A, "channel_id": CHANNEL_A, "current_step_id": ETAPE_2},
        ]
        #: Les réponses imposées aux prochains appels de fonction, dans l'ordre.
        self.reponses_rpc: list[tuple[int, Any]] = []

    async def tables(self, requete: Request) -> Response:
        reponse = await super().tables(requete)
        if requete.path_params["table"] == "card_placements" and requete.method == "GET":
            # La lecture embarque l'étape et son nœud, comme la vraie (`card_placements_step_fk`).
            import json

            lignes = json.loads(bytes(reponse.body))
            return JSONResponse([{**l, "etape": {"label_override": None, "noeud": {"label": f"Étape {l['current_step_id'][-2:]}"}}}
                                 for l in lignes])
        return reponse

    async def rpc_workflows(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction not in ("set_default_workflow", "copy_workflow_to_track", "change_channel_workflow"):
            return await super().rpc_workflows(requete)
        self.rpcs.append((fonction, await requete.json()))
        if self.reponses_rpc:
            statut, corps = self.reponses_rpc.pop(0)
            return JSONResponse(corps, status_code=statut)
        return JSONResponse({"copy_workflow_to_track": WF_LIBRE, "change_channel_workflow": [{"id": "p1"}, {"id": "p2"}]}
                            .get(fonction, {"id": WF_LIBRE}))


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmEntete()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        workflows_entete.ajouter(self.mcp, self.moteur, self.crm)
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


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_quatre_outils_deux_destructifs_aucun_pour_retablir(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "workflows"}
    assert declares == OUTILS
    assert monde.moteur.declarations["crm_workflow_copy_to_track"].autres == ("track:track_id",)
    assert monde.moteur.declarations["crm_channel_workflow_change"].autres == ("workflow:workflow_id",)
    async with Client(monde.mcp) as client:
        outils = {o.name: o for o in await client.list_tools()}
    assert {n for n in OUTILS if outils[n].annotations.destructive_hint} == {"crm_workflow_archive", "crm_channel_workflow_change"}
    assert not any("restore" in n or "unarchive" in n for n in outils)


async def test_renommer_trime_et_definir_par_defaut_passe_par_la_fonction_atomique(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE, "name": "  Cycle long  ", "make_default": True})
    patch = monde.simule.ecritures[-1]
    assert patch["methode"] == "PATCH" and patch["corps"] == {"name": "Cycle long"} and patch["parametres"]["id"] == f"eq.{WF_LIBRE}"
    assert monde.simule.rpcs[-1] == ("set_default_workflow", {"p_workflow": WF_LIBRE})
    assert lu["workflow"]["name"] == "Cycle long"
    with pytest.raises(ToolError, match="Give a new name, or make_default"):
        await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE})
    with pytest.raises(ToolError, match="cannot be blank"):
        await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE, "name": "   "})


async def test_les_refus_du_defaut_sont_nommes_et_l_acces_reste_uniforme(monde: Monde) -> None:
    monde.simule.reponses_rpc = [
        (400, {"code": "P0001", "message": "workflow non global"}),
        (400, {"code": "P0001", "message": "workflow archive"}),
        (403, {"code": "42501", "message": "reserve aux administrateurs"}),
    ]
    with pytest.raises(ToolError, match="workflow_not_global — only a global workflow can be the default"):
        await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE, "make_default": True})
    with pytest.raises(ToolError, match="workflow_archived"):
        await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE, "make_default": True})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_workflow_update", {"workflow_id": WF_LIBRE, "make_default": True})


async def test_archiver_horodate_et_nomme_les_deux_refus_de_la_garde(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_archive", {"workflow_id": WF_LIBRE})
    assert monde.simule.ecritures[-1]["corps"]["archived_at"] is not None
    assert lu["workflow"]["archived"] is True
    # Déjà archivé : rien n'est réécrit.
    ecritures = len(monde.simule.ecritures)
    assert (await monde.appel("crm_workflow_archive", {"workflow_id": WF_LIBRE}))["note"] == "Already archived."
    assert len(monde.simule.ecritures) == ecritures
    monde.simule.forcee = (400, {"code": "P0001", "message": "workflow_in_use : 3 channel(s)"})
    with pytest.raises(ToolError, match=r"workflow_in_use — 3 channel\(s\) still follow.*crm_channel_workflow_change"):
        await monde.appel("crm_workflow_archive", {"workflow_id": WF_A})
    monde.simule.forcee = (400, {"code": "P0001", "message": "workflow_is_default"})
    with pytest.raises(ToolError, match="workflow_is_default.*make_default"):
        await monde.appel("crm_workflow_archive", {"workflow_id": WF_A})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_workflow_archive", {"workflow_id": WF_B})


async def test_copier_n_envoie_pas_un_nom_blanc_et_rend_la_copie(monde: Monde) -> None:
    lu = await monde.appel("crm_workflow_copy_to_track", {"workflow_id": WF_A, "track_id": TRACK_A, "new_name": "  "})
    assert monde.simule.rpcs[-1] == ("copy_workflow_to_track", {"workflow_id": WF_A, "track_id": TRACK_A})
    assert lu["workflow"]["id"] == WF_LIBRE
    await monde.appel("crm_workflow_copy_to_track", {"workflow_id": WF_A, "track_id": TRACK_A, "new_name": " Copie "})
    assert monde.simule.rpcs[-1][1]["new_name"] == "Copie"
    monde.simule.reponses_rpc = [(400, {"code": "P0001", "message": "workflow_not_global"}),
                                 (400, {"code": "P0001", "message": "track_not_found"})]
    with pytest.raises(ToolError, match="workflow_not_global — only a global workflow can be copied"):
        await monde.appel("crm_workflow_copy_to_track", {"workflow_id": WF_A, "track_id": TRACK_A})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : track"):
        await monde.appel("crm_workflow_copy_to_track", {"workflow_id": WF_A, "track_id": TRACK_A})


async def test_changer_de_workflow_ordonne_le_mapping_et_n_accepte_la_perte_que_demandee(monde: Monde) -> None:
    lu = await monde.appel("crm_channel_workflow_change", {
        "channel_id": CHANNEL_A, "workflow_id": WF_LIBRE,
        "step_mapping": [{"from_step_id": ETAPE_2, "to_step_id": "x"}, {"from_step_id": ETAPE_1, "to_step_id": "y"}],
    })
    nom, corps = monde.simule.rpcs[-1]
    assert nom == "change_channel_workflow"
    assert corps == {
        "channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "discard_field_values": False,
        "step_mapping": [{"from_step_id": ETAPE_1, "to_step_id": "y"}, {"from_step_id": ETAPE_2, "to_step_id": "x"}],
    }
    assert lu["placements_moved"] == 2 and lu["workflow"]["id"] == WF_LIBRE
    monde.simule.reponses_rpc = [
        (400, {"code": "P0001", "message": "field_values_would_be_lost", "details": "4 réponse(s) de formulaire seraient perdues."}),
    ]
    with pytest.raises(ToolError, match="field_values_would_be_lost — .*4 form answer"):
        await monde.appel("crm_channel_workflow_change", {"channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "step_mapping": []})
    await monde.appel("crm_channel_workflow_change", {
        "channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "step_mapping": [], "discard_field_values": True,
    })
    assert monde.simule.rpcs[-1][1]["discard_field_values"] is True


async def test_un_mapping_incomplet_nomme_les_etapes_occupees_oubliees(monde: Monde) -> None:
    monde.simule.reponses_rpc = [(400, {"code": "P0001", "message": "step_mapping_incomplete"})]
    with pytest.raises(ToolError) as erreur:
        await monde.appel("crm_channel_workflow_change", {
            "channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "step_mapping": [{"from_step_id": ETAPE_1, "to_step_id": "y"}],
        })
    message = str(erreur.value)
    assert "step_mapping_incomplete" in message and f"({ETAPE_2}, 2 affaire(s))" in message and ETAPE_1 not in message


async def test_les_refus_du_changement_sont_nommes_et_l_acces_reste_uniforme(monde: Monde) -> None:
    monde.simule.reponses_rpc = [
        (400, {"code": "P0001", "message": "same_workflow"}),
        (400, {"code": "23514", "message": "workflow_not_compatible"}),
        (403, {"code": "42501", "message": "forbidden"}),
        (400, {"code": "P0001", "message": "workflow_not_found"}),
    ]
    arguments = {"channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "step_mapping": []}
    with pytest.raises(ToolError, match="same_workflow"):
        await monde.appel("crm_channel_workflow_change", arguments)
    with pytest.raises(ToolError, match="workflow_not_compatible"):
        await monde.appel("crm_channel_workflow_change", arguments)
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : channel"):
        await monde.appel("crm_channel_workflow_change", arguments)
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : workflow"):
        await monde.appel("crm_channel_workflow_change", arguments)


async def test_la_matrice_ferme_chaque_outil_avant_le_crm(monde: Monde) -> None:
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "supprimer"))
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "workflows", "modifier"))
    with pytest.raises(ToolError):
        await monde.appel("crm_workflow_archive", {"workflow_id": WF_LIBRE})
    with pytest.raises(ToolError):
        await monde.appel("crm_channel_workflow_change", {"channel_id": CHANNEL_A, "workflow_id": WF_LIBRE, "step_mapping": []})
    assert monde.simule.ecritures == [] and monde.simule.rpcs == []

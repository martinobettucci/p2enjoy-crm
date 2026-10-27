# @verifies CRM-118 (docs/BACKLOG.md) — tranches T2.a et T2.b : les outils de la famille `workflows` contre le vrai Keycloak,
#           la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 undecies (T2.a : le workflow, ses étapes, ses transitions ; T2.b : le formulaire, la
#           visibilité, les exigences ; les refus nommés) ; docs/SPEC-workflow-engine.md §7 bis.10 à §7 bis.13 ;
#           docs/SPEC-workflow-engine.md §3.4, §3.5, §3.7 ; décisions 754 et 756
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

L'administratrice (Camille) et le business developer (Driss) reçoivent, par la clé de service, les cases de la preuve ;
elles sont retirées à la fin, et le workflow créé par la preuve est effacé par la clé de service, ses étapes et ses
transitions en cascade."""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import EXPLOITANTE, ESPACE_SEEDE, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_outils, _attendre_visible, _dernier_journal, _jeton
from .test_integration_structure import CAMILLE, _poser, _retirer

NOM = "Workflow MCP intégration"
PROSPECTION = "5eed0000-0000-4000-8000-000000000041"
RELANCE = "5eed0000-0000-4000-8000-000000000042"
#: L'étape Prospection du workflow par défaut, occupée par des affaires du seed.
ETAPE_OCCUPEE = "5eed0000-0000-4000-8000-000000000061"
WORKFLOW_DEFAUT = "5eed0000-0000-4000-8000-000000000051"
WORKFLOWS = [("workflows", a) for a in ("consulter", "ajouter", "modifier", "supprimer")]


async def _nettoyer() -> None:
    await _service("DELETE", "/workflows", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "name": f"eq.{NOM}"})


async def test_un_workflow_compose_par_l_administratrice_outil_par_outil():
    await _nettoyer()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_workflow_transition_remove")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            async def refuse(outil: str, arguments: dict, motif: str) -> None:
                with pytest.raises(ToolError, match=motif):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(CAMILLE[1]) == (outil, "refus_crm"), outil

            liste = await appeler("crm_workflow_list", {"workspace": "p2enjoy"})
            assert liste["workflows"][0]["id"] == WORKFLOW_DEFAUT and liste["workflows"][0]["default"] is True
            await refuse("crm_workflow_starter_create", {"workspace": "p2enjoy"}, "workflow_exists")

            cree = (await appeler("crm_workflow_create", {"workspace": "p2enjoy", "name": f"  {NOM} "}))["workflow"]
            assert cree["name"] == NOM and cree["default"] is False and cree["scope"] == "global"
            wf = cree["id"]
            premiere = (await appeler("crm_workflow_step_add", {"workflow_id": wf, "node_id": PROSPECTION}))["step"]
            seconde = (await appeler("crm_workflow_step_add", {
                "workflow_id": wf, "node_id": RELANCE, "label": "Relance client", "probability": 0,
            }))["step"]
            assert seconde["name"] == "Relance client" and seconde["overrides"]["probability"] == 0
            await refuse("crm_workflow_step_add", {"workflow_id": wf, "node_id": PROSPECTION}, "node_already_in_workflow")

            await appeler("crm_workflow_step_update", {"step_id": premiere["id"], "make_initial": True})
            await appeler("crm_workflow_step_update", {"step_id": seconde["id"], "make_initial": True})
            reglee = (await appeler("crm_workflow_step_update", {
                "step_id": seconde["id"], "stale_after_days": 5, "reset": ["label", "probability"],
            }))["step"]
            assert reglee["initial"] is True and reglee["overrides"] == {"label": None, "probability": None, "stale_after_days": 5}
            initiales = (await _service("GET", "/workflow_steps", params={"workflow_id": f"eq.{wf}", "is_initial": "is.true", "select": "id"})).json()
            assert initiales == [{"id": seconde["id"]}]

            await appeler("crm_workflow_step_move", {"step_id": seconde["id"]})
            ordre = (await _service("GET", "/workflow_steps", params={"workflow_id": f"eq.{wf}", "select": "id", "order": "position.asc"})).json()
            assert [e["id"] for e in ordre] == [seconde["id"], premiere["id"]]

            arete = (await appeler("crm_workflow_transition_add", {
                "workflow_id": wf, "from_step_id": seconde["id"], "to_step_id": premiere["id"], "label": "Relancer",
            }))["transition"]
            await refuse("crm_workflow_transition_add", {
                "workflow_id": wf, "from_step_id": seconde["id"], "to_step_id": premiere["id"],
            }, "transition_already_declared")
            await refuse("crm_workflow_transition_add", {
                "workflow_id": wf, "from_step_id": seconde["id"], "to_step_id": ETAPE_OCCUPEE,
            }, "step_outside_workflow")
            modifiee = (await appeler("crm_workflow_transition_update", {
                "transition_id": arete["id"], "label": "", "require_comment": True,
            }))["transition"]
            assert modifiee["label"] is None and modifiee["requires_comment"] is True
            # `crm_workflow_get` reste à `structure` (décision 754) : la famille `workflows` seule ne l'ouvre pas.
            assert "crm_workflow_get" not in {o.name for o in await client.list_tools()}

            await refuse("crm_workflow_step_remove", {"step_id": ETAPE_OCCUPEE}, "step_occupied")
            await appeler("crm_workflow_transition_remove", {"transition_id": arete["id"]})
            await appeler("crm_workflow_step_remove", {"step_id": premiere["id"]})
            assert (await _service("GET", "/workflow_steps", params={"workflow_id": f"eq.{wf}", "select": "id"})).json() == [
                {"id": seconde["id"]}
            ]
        assert (await _service("GET", "/workflow_steps", params={"id": f"eq.{ETAPE_OCCUPEE}", "select": "id"})).json() == [
            {"id": ETAPE_OCCUPEE}
        ]
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer()


async def test_le_business_developer_est_refuse_par_le_crm_et_le_retrait_ferme_par_la_matrice():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _nettoyer()
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_workflow_step_update" in noms and "crm_workflow_step_remove" not in noms,
                "matrice attendue",
            )
            assert (await client.call_tool("crm_workflow_list", {"workspace": "p2enjoy"})).structured_content["workflows"]
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_list", "ok")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_create", {"workspace": "p2enjoy", "name": NOM})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_create", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_step_update", {"step_id": ETAPE_OCCUPEE, "probability": 99})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_step_update", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_workflow_step_remove", {"step_id": ETAPE_OCCUPEE})
        assert (await _service("GET", "/workflow_steps", params={"id": f"eq.{ETAPE_OCCUPEE}", "select": "probability_override"})).json() == [
            {"probability_override": None}
        ]
        assert (await _service("GET", "/workflows", params={"name": f"eq.{NOM}", "select": "id"})).json() == []
    finally:
        await _retirer(DRISS, cases)
        await _nettoyer()


# --- T2.b — le formulaire, la visibilité, les exigences ---------------------------------------------------------------

CHAMP_DEFAUT = "5eed0000-0000-4000-8000-000000000081"  # « budget », du workflow par défaut


async def test_le_formulaire_compose_par_l_administratrice_outil_par_outil():
    await _nettoyer()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_form_field_archive")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            async def refuse(outil: str, arguments: dict, motif: str) -> None:
                with pytest.raises(ToolError, match=motif):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(CAMILLE[1]) == (outil, "refus_crm"), outil

            wf = (await appeler("crm_workflow_create", {"workspace": "p2enjoy", "name": NOM}))["workflow"]["id"]
            depart = (await appeler("crm_workflow_step_add", {"workflow_id": wf, "node_id": PROSPECTION}))["step"]["id"]
            arrivee = (await appeler("crm_workflow_step_add", {"workflow_id": wf, "node_id": RELANCE}))["step"]["id"]
            arete = (await appeler("crm_workflow_transition_add", {
                "workflow_id": wf, "from_step_id": depart, "to_step_id": arrivee,
            }))["transition"]["id"]

            source = (await appeler("crm_form_field_add", {
                "workflow_id": wf, "key": "source-mcp", "label": "Source", "type": "select",
                "choices": [{"key": "web", "label": "Web"}, {"key": "salon", "label": "Salon"}],
            }))["field"]
            montant = (await appeler("crm_form_field_add", {
                "workflow_id": wf, "key": "montant-mcp", "label": "Montant", "type": "money", "currency": "eur",
            }))["field"]
            assert montant["options"] == {"currency": "EUR"}
            await refuse("crm_form_field_add", {"workflow_id": wf, "key": "source-mcp", "label": "X", "type": "text"},
                         "field_key_taken")
            await appeler("crm_form_field_update", {"field_id": source["id"], "label": "Origine", "help_text": "Où l'avez-vous connu ?"})
            await appeler("crm_form_field_move", {"field_id": montant["id"]})
            ordre = (await _service("GET", "/form_fields", params={"workflow_id": f"eq.{wf}", "select": "key", "order": "position.asc"})).json()
            assert [c["key"] for c in ordre] == ["montant-mcp", "source-mcp"]

            effets = await appeler("crm_transition_requirement_preview", {"field_id": source["id"], "step_id": arrivee})
            assert effets == {**effets, "affaires_already_there": 0, "affaires_blocked_at_entry": 0}
            await appeler("crm_form_field_visibility_set", {"field_id": source["id"], "step_id": arrivee, "visibility": "required"})
            await appeler("crm_form_field_visibility_set", {"field_id": source["id"], "step_id": arrivee, "visibility": "hidden"})
            assert (await _service("GET", "/form_field_rules", params={"field_id": f"eq.{source['id']}", "select": "visibility"})).json() == [
                {"visibility": "hidden"}
            ]
            await appeler("crm_form_field_visibility_set", {"field_id": source["id"], "step_id": arrivee, "visibility": "default"})
            assert (await _service("GET", "/form_field_rules", params={"field_id": f"eq.{source['id']}", "select": "visibility"})).json() == []

            await appeler("crm_transition_required_field_set", {"transition_id": arete, "field_id": source["id"], "required": True})
            await refuse("crm_transition_required_field_set", {"transition_id": arete, "field_id": source["id"], "required": True},
                         "already_required")
            await refuse("crm_transition_required_field_set", {"transition_id": arete, "field_id": CHAMP_DEFAUT, "required": True},
                         "required_field_workflow_mismatch")
            formulaire = await appeler("crm_workflow_form_get", {"workflow_id": wf})
            assert formulaire["transitions"][0]["required_field_ids"] == [source["id"]]
            assert [c["label"] for c in formulaire["fields"]] == ["Montant", "Origine"]
            await appeler("crm_transition_required_field_set", {"transition_id": arete, "field_id": source["id"], "required": False})
            await refuse("crm_transition_required_field_set", {"transition_id": arete, "field_id": source["id"], "required": False},
                         "not_required")
            await appeler("crm_form_field_archive", {"field_id": montant["id"]})
            assert (await _service("GET", "/form_fields", params={"id": f"eq.{montant['id']}", "select": "archived_at"})).json()[0]["archived_at"]
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer()


async def test_le_business_developer_ne_compose_pas_le_formulaire():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_form_field_add" in noms and "crm_form_field_archive" not in noms, "matrice attendue"
            )
            assert (await client.call_tool("crm_workflow_form_get", {"workflow_id": WORKFLOW_DEFAUT})).structured_content["fields"]
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_form_field_add", {"workflow_id": WORKFLOW_DEFAUT, "key": "refuse", "label": "R", "type": "text"})
            assert await _dernier_journal(DRISS[1]) == ("crm_form_field_add", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_form_field_update", {"field_id": CHAMP_DEFAUT, "label": "Réécrit"})
            assert await _dernier_journal(DRISS[1]) == ("crm_form_field_update", "refus_crm")
        assert (await _service("GET", "/form_fields", params={"id": f"eq.{CHAMP_DEFAUT}", "select": "label"})).json()[0]["label"] != "Réécrit"
    finally:
        await _retirer(DRISS, cases)

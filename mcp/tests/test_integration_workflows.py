# @verifies CRM-111 T2.4.5 (docs/BACKLOG.md) — l'affaire de la preuve est posée par son rattachement (migration 0134)
# @verifies CRM-118 (docs/BACKLOG.md) — tranches T2.a à T2.d : les outils de la famille `workflows` contre le vrai Keycloak,
#           la vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-mcp.md §13 (par outil : succès, refus par la matrice, refus par le CRM malgré la matrice ouverte,
#           journal écrit), §9.2 undecies (T2.a : le workflow, ses étapes, ses transitions ; T2.b : le formulaire, la
#           visibilité, les exigences ; T2.c : les versions et le remappage ; T2.d : le catalogue de nœuds ; les refus nommés) ;
#           docs/SPEC-workflow-engine.md §7 bis.10 à §7 bis.13, §7 ter.5, §7 ter.11 à §7 ter.13, §2.3 à §2.6 ;
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


# --- T2.c — les versions, les comparaisons, le remappage --------------------------------------------------------------

NEGOCIATION = "5eed0000-0000-4000-8000-000000000043"


async def test_les_versions_publiees_comparees_et_restaurees_par_l_administratrice():
    await _nettoyer()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_workflow_version_restore")

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
            await appeler("crm_workflow_step_update", {"step_id": depart, "make_initial": True})
            v1 = (await appeler("crm_workflow_version_publish", {"workflow_id": wf, "note": "Deux étapes"}))["version"]
            await refuse("crm_workflow_version_publish", {"workflow_id": wf}, "composition_unchanged")
            troisieme = (await appeler("crm_workflow_step_add", {"workflow_id": wf, "node_id": NEGOCIATION}))["step"]["id"]
            await appeler("crm_workflow_transition_add", {"workflow_id": wf, "from_step_id": arrivee, "to_step_id": troisieme})
            v2 = (await appeler("crm_workflow_version_publish", {"workflow_id": wf}))["version"]
            assert v2["version_number"] == v1["version_number"] + 1

            versions = (await appeler("crm_workflow_version_list", {"workflow_id": wf}))["versions"]
            assert [v["version_number"] for v in versions] == [v2["version_number"], v1["version_number"]]
            assert versions[1]["note"] == "Deux étapes" and versions[1]["published_by"] == "Camille Aubert"
            comparaison = (await appeler("crm_workflow_version_compare", {
                "base_version_id": v1["id"], "target_version_id": v2["id"],
            }))["comparison"]
            assert comparaison and comparaison != {}

            plan = (await appeler("crm_workflow_remap_plan", {"version_id": v1["id"]}))["plan"]
            assert plan["ready"] is True and plan["summary"]["steps_removed"] == 1
            restauration = (await appeler("crm_workflow_version_restore", {"version_id": v1["id"]}))["restoration"]
            assert restauration["matches_version"] is True
            etapes = (await _service("GET", "/workflow_steps", params={"workflow_id": f"eq.{wf}", "select": "id"})).json()
            assert {e["id"] for e in etapes} == {depart, arrivee}
            # L'état d'avant était déjà la version 2 : elle est le point de retour, rien n'est republié (§7 ter.13).
            assert restauration["rollback_version"]["version_number"] == v2["version_number"]
            assert restauration["rollback_version"]["published"] is False
            assert len((await appeler("crm_workflow_version_list", {"workflow_id": wf}))["versions"]) == 2

            copie = (await _service("GET", "/workflows", params={
                "workspace_id": f"eq.{ESPACE_SEEDE}", "derived_from_workflow_id": f"eq.{WORKFLOW_DEFAUT}", "select": "id",
            })).json()[0]["id"]
            source = await appeler("crm_workflow_source_compare", {"workflow_id": copie})
            assert source["source"]["workflow_id"] == WORKFLOW_DEFAUT and source["comparison"]
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer()


async def test_le_business_developer_compare_mais_ne_publie_ni_ne_restaure():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(client, lambda noms: "crm_workflow_version_restore" in noms, "matrice attendue")
            versions = (await client.call_tool("crm_workflow_version_list", {"workflow_id": WORKFLOW_DEFAUT})).structured_content["versions"]
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_version_publish", {"workflow_id": WORKFLOW_DEFAUT, "note": "refusée"})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_version_publish", "refus_crm")
            if versions:
                with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                    await client.call_tool("crm_workflow_version_restore", {"version_id": versions[-1]["id"]})
                assert await _dernier_journal(DRISS[1]) == ("crm_workflow_version_restore", "refus_crm")
        apres = (await _service("GET", "/workflow_versions", params={"workflow_id": f"eq.{WORKFLOW_DEFAUT}", "select": "id"})).json()
        assert len(apres) == len(versions)
    finally:
        await _retirer(DRISS, cases)


# --- T2.d — le catalogue de nœuds -------------------------------------------------------------------------------------

CLE_NOEUD = "mcp-noeud-integration"


async def _nettoyer_noeud() -> None:
    await _service("DELETE", "/workflow_nodes_catalog", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "key": f"eq.{CLE_NOEUD}"})


async def test_le_catalogue_tenu_par_l_administratrice_outil_par_outil():
    await _nettoyer_noeud()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_workflow_node_archive")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            async def refuse(outil: str, arguments: dict, motif: str) -> None:
                with pytest.raises(ToolError, match=motif):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(CAMILLE[1]) == (outil, "refus_crm"), outil

            noeuds = (await appeler("crm_workflow_node_list", {"workspace": "p2enjoy"}))["nodes"]
            assert "prospection" in {n["key"] for n in noeuds} and not any(n["archived"] for n in noeuds)
            cree = (await appeler("crm_workflow_node_create", {
                "workspace": "p2enjoy", "key": CLE_NOEUD, "label": "Nœud MCP", "default_probability": 30,
            }))["node"]
            await refuse("crm_workflow_node_create", {"workspace": "p2enjoy", "key": CLE_NOEUD, "label": "Doublon"}, "node_key_taken")
            modifie = (await appeler("crm_workflow_node_update", {
                "node_id": cree["id"], "label": "Nœud MCP gagné", "kind": "won", "color": "success",
                "reset": ["default_probability"],
            }))["node"]
            assert (modifie["kind"], modifie["default_probability"]) == ("won", None)
            await appeler("crm_workflow_node_move", {"node_id": cree["id"]})
            premier = (await _service("GET", "/workflow_nodes_catalog", params={
                "workspace_id": f"eq.{ESPACE_SEEDE}", "select": "key", "order": "position.asc", "limit": "1",
            })).json()
            assert premier == [{"key": CLE_NOEUD}]
            await refuse("crm_workflow_node_archive", {"node_id": PROSPECTION}, "node_occupied")
            await appeler("crm_workflow_node_archive", {"node_id": cree["id"]})
            assert (await _service("GET", "/workflow_nodes_catalog", params={"id": f"eq.{cree['id']}", "select": "archived_at"})).json()[0]["archived_at"]
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer_noeud()


async def test_le_business_developer_lit_le_catalogue_sans_l_ecrire():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _nettoyer_noeud()
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_workflow_node_create" in noms and "crm_workflow_node_archive" not in noms, "matrice attendue"
            )
            assert (await client.call_tool("crm_workflow_node_list", {"workspace": "p2enjoy"})).structured_content["nodes"]
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_node_create", {"workspace": "p2enjoy", "key": CLE_NOEUD, "label": "Refusé"})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_node_create", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_node_update", {"node_id": PROSPECTION, "label": "Réécrit"})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_node_update", "refus_crm")
        assert (await _service("GET", "/workflow_nodes_catalog", params={"id": f"eq.{PROSPECTION}", "select": "label"})).json() == [
            {"label": "Prospection"}
        ]
    finally:
        await _retirer(DRISS, cases)
        await _nettoyer_noeud()


# --- T2.e — les quatre outils qui suivent leur écran ------------------------------------------------------------------

NOM_ANCIEN = "Workflow MCP T2.e ancien"
NOM_NOUVEAU = "Workflow MCP T2.e nouveau"
NOM_COPIE = "Workflow MCP T2.e copie"
TRACK_CONSEIL = "5eed0000-0000-4000-8000-000000000021"
QUALIFICATION = "5eed0000-0000-4000-8000-000000000048"
CHANNEL_T2E = "e1180000-0000-4000-8000-0000000000f1"
CARD_T2E = "e1180000-0000-4000-8000-0000000000f2"


async def _nettoyer_t2e() -> None:
    # Le défaut d'abord : la garde refuse d'archiver un défaut, et d'autres preuves l'attendent.
    await _service("PATCH", "/workflows", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "is_default": "is.true",
                                                  "id": f"neq.{WORKFLOW_DEFAUT}"}, json={"is_default": False})
    await _service("PATCH", "/workflows", params={"id": f"eq.{WORKFLOW_DEFAUT}"}, json={"is_default": True})
    await _service("DELETE", "/cards", params={"id": f"eq.{CARD_T2E}"})
    await _service("DELETE", "/channels", params={"id": f"eq.{CHANNEL_T2E}"})
    # La copie d'abord : elle désigne l'ancien (`copied_from_workflow_id`), qui ne s'efface pas tant qu'elle existe — dans
    # l'ordre inverse, l'ancien restait en base et faussait les gardes des workflows globaux du seed.
    for nom in (NOM_COPIE, NOM_NOUVEAU, NOM_ANCIEN):
        reponse = await _service("DELETE", "/workflows", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "name": f"eq.{nom}"})
        assert reponse.status_code == 204, reponse.text


async def test_l_entete_et_le_changement_de_workflow_par_l_administratrice():
    await _nettoyer_t2e()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_channel_workflow_change")

            async def appeler(outil: str, arguments: dict) -> dict:
                resultat = (await client.call_tool(outil, arguments)).structured_content
                assert await _dernier_journal(CAMILLE[1]) == (outil, "ok"), outil
                return resultat

            async def refuse(outil: str, arguments: dict, motif: str) -> None:
                with pytest.raises(ToolError, match=motif):
                    await client.call_tool(outil, arguments)
                assert await _dernier_journal(CAMILLE[1]) == (outil, "refus_crm"), outil

            ancien = (await appeler("crm_workflow_create", {"workspace": "p2enjoy", "name": "Brouillon T2.e"}))["workflow"]["id"]
            relance = (await appeler("crm_workflow_step_add", {"workflow_id": ancien, "node_id": RELANCE}))["step"]["id"]
            await appeler("crm_workflow_step_update", {"step_id": relance, "make_initial": True})
            nouveau = (await appeler("crm_workflow_create", {"workspace": "p2enjoy", "name": NOM_NOUVEAU}))["workflow"]["id"]
            qualif = (await appeler("crm_workflow_step_add", {"workflow_id": nouveau, "node_id": QUALIFICATION}))["step"]["id"]

            # Renommer, définir par défaut : la fonction atomique, un seul défaut.
            renomme = (await appeler("crm_workflow_update", {"workflow_id": ancien, "name": f"  {NOM_ANCIEN} "}))["workflow"]
            assert renomme["name"] == NOM_ANCIEN
            assert (await appeler("crm_workflow_update", {"workflow_id": nouveau, "make_default": True}))["workflow"]["default"] is True
            defauts = (await _service("GET", "/workflows", params={"workspace_id": f"eq.{ESPACE_SEEDE}", "is_default": "is.true", "select": "id"})).json()
            assert defauts == [{"id": nouveau}]
            await refuse("crm_workflow_archive", {"workflow_id": nouveau}, "workflow_is_default")
            await appeler("crm_workflow_update", {"workflow_id": WORKFLOW_DEFAUT, "make_default": True})
            await refuse("crm_workflow_archive", {"workflow_id": WORKFLOW_DEFAUT}, r"workflow_in_use — \d+ channel")

            # Copier vers un track.
            copie = (await appeler("crm_workflow_copy_to_track", {
                "workflow_id": ancien, "track_id": TRACK_CONSEIL, "new_name": NOM_COPIE,
            }))["workflow"]
            assert copie["scope"] == "track" and copie["track"]["id"] == TRACK_CONSEIL and copie["copied_from_workflow_id"] == ancien
            await refuse("crm_workflow_copy_to_track", {"workflow_id": copie["id"], "track_id": TRACK_CONSEIL}, "workflow_not_global")

            # Un channel occupé change de workflow : le mapping incomplet nomme l'étape oubliée.
            assert (await _service("POST", "/channels", json={
                "id": CHANNEL_T2E, "workspace_id": ESPACE_SEEDE, "track_id": TRACK_CONSEIL, "workflow_id": ancien,
                "name": "Channel MCP T2.e", "slug": "mcp-t2e",
            })).status_code == 201
            # L'affaire, puis son rattachement : depuis la migration 0134, le channel, le workflow et l'étape vivent sur le
            # rattachement (`CRM-111` T2.4.5) ; la clé de service est exemptée de l'invariant différé.
            creee = await _service("POST", "/cards", json={"id": CARD_T2E, "workspace_id": ESPACE_SEEDE, "title": "Affaire MCP T2.e"})
            assert creee.status_code == 201, creee.text
            pose = await _service("POST", "/card_placements", json={
                "card_id": CARD_T2E, "workspace_id": ESPACE_SEEDE, "channel_id": CHANNEL_T2E, "workflow_id": ancien,
                "current_step_id": relance,
            })
            assert pose.status_code == 201, pose.text
            await refuse("crm_channel_workflow_change", {
                "channel_id": CHANNEL_T2E, "workflow_id": nouveau, "step_mapping": [],
            }, rf"step_mapping_incomplete — .*\({relance}, 1 affaire")
            change = await appeler("crm_channel_workflow_change", {
                "channel_id": CHANNEL_T2E, "workflow_id": nouveau,
                "step_mapping": [{"from_step_id": relance, "to_step_id": qualif}],
            })
            assert change["placements_moved"] == 1
            rattachement = (await _service("GET", "/card_placements", params={"card_id": f"eq.{CARD_T2E}", "select": "workflow_id,current_step_id"})).json()
            assert rattachement == [{"workflow_id": nouveau, "current_step_id": qualif}]
            await refuse("crm_channel_workflow_change", {
                "channel_id": CHANNEL_T2E, "workflow_id": nouveau, "step_mapping": [],
            }, "same_workflow")

            # Libre et non défaut, l'ancien s'archive ; rétablir n'existe pas au connecteur.
            archive = (await appeler("crm_workflow_archive", {"workflow_id": ancien}))["workflow"]
            assert archive["archived"] is True
            noms = {o.name for o in await client.list_tools()}
            assert not noms & {"crm_workflow_restore", "crm_workflow_unarchive"} and "crm_workflow_version_restore" in noms
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer_t2e()


async def test_le_business_developer_ne_change_ni_l_entete_ni_le_workflow_d_un_channel():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client, lambda noms: "crm_workflow_update" in noms and "crm_workflow_archive" not in noms, "matrice attendue"
            )
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_update", {"workflow_id": WORKFLOW_DEFAUT, "name": "Réécrit"})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_update", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_workflow_update", {"workflow_id": WORKFLOW_DEFAUT, "make_default": True})
            assert await _dernier_journal(DRISS[1]) == ("crm_workflow_update", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_channel_workflow_change", {
                    "channel_id": "5eed0000-0000-4000-8000-000000000031", "workflow_id": WORKFLOW_DEFAUT, "step_mapping": [],
                })
            assert await _dernier_journal(DRISS[1]) == ("crm_channel_workflow_change", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_workflow_archive", {"workflow_id": WORKFLOW_DEFAUT})
        assert (await _service("GET", "/workflows", params={"id": f"eq.{WORKFLOW_DEFAUT}", "select": "name,archived_at"})).json() == [
            {"name": "Cycle commercial standard", "archived_at": None}
        ]
    finally:
        await _retirer(DRISS, cases)


# --- T2.b, après `CRM-068` T3b — les points de checklist d'une étape ---------------------------------------------------

#: Un point du workflow par défaut, posé par le seed sur Prospection (docs/SPEC-seed.md §28).
POINT_SEED = "5eed0000-0000-4000-8000-0000000c6861"


async def test_les_checklists_d_etape_composees_par_l_administratrice():
    await _nettoyer()
    await _poser(CAMILLE, WORKFLOWS)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_step_checklist_item_archive")

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

            premier = (await appeler("crm_step_checklist_item_add", {"step_id": depart, "label": " Besoin confirmé "}))["checklist_item"]
            second = (await appeler("crm_step_checklist_item_add", {"step_id": depart, "label": "Décideur identifié"}))["checklist_item"]
            ailleurs = (await appeler("crm_step_checklist_item_add", {"step_id": arrivee, "label": "Proposition envoyée"}))["checklist_item"]
            assert premier["label"] == "Besoin confirmé" and second["position"] > premier["position"]
            await appeler("crm_step_checklist_item_update", {"item_id": second["id"], "label": "Décideur rencontré", "move_to_top": True})
            ordre = (await _service("GET", "/workflow_step_checklist_items", params={
                "step_id": f"eq.{depart}", "select": "label", "order": "position.asc",
            })).json()
            assert [p["label"] for p in ordre] == ["Décideur rencontré", "Besoin confirmé"]

            await appeler("crm_transition_required_checklist_item_set", {"transition_id": arete, "item_id": premier["id"], "required": True})
            await refuse("crm_transition_required_checklist_item_set", {
                "transition_id": arete, "item_id": premier["id"], "required": True,
            }, "checklist_item_already_required")
            await refuse("crm_transition_required_checklist_item_set", {
                "transition_id": arete, "item_id": ailleurs["id"], "required": True,
            }, "checklist_item_not_from_source_step")
            # `crm_workflow_form_get` relit ce que l'outil a écrit.
            formulaire = await appeler("crm_workflow_form_get", {"workflow_id": wf})
            exiges = {t["id"]: t["required_checklist_item_ids"] for t in formulaire["transitions"]}
            assert exiges[arete] == [premier["id"]]
            await appeler("crm_transition_required_checklist_item_set", {"transition_id": arete, "item_id": premier["id"], "required": False})
            await refuse("crm_transition_required_checklist_item_set", {
                "transition_id": arete, "item_id": premier["id"], "required": False,
            }, "not_required")

            archive = (await appeler("crm_step_checklist_item_archive", {"item_id": premier["id"]}))["checklist_item"]
            assert archive["archived"] is True
    finally:
        await _retirer(CAMILLE, WORKFLOWS)
        await _nettoyer()


async def test_le_business_developer_ne_compose_pas_les_checklists():
    cases = [("workflows", "consulter"), ("workflows", "ajouter"), ("workflows", "modifier")]
    await _poser(DRISS, cases)
    try:
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_outils(
                client,
                lambda noms: "crm_step_checklist_item_add" in noms and "crm_step_checklist_item_archive" not in noms,
                "matrice attendue",
            )
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_step_checklist_item_add", {"step_id": ETAPE_OCCUPEE, "label": "Refusé"})
            assert await _dernier_journal(DRISS[1]) == ("crm_step_checklist_item_add", "refus_crm")
            with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
                await client.call_tool("crm_step_checklist_item_update", {"item_id": POINT_SEED, "label": "Réécrit"})
            assert await _dernier_journal(DRISS[1]) == ("crm_step_checklist_item_update", "refus_crm")
            with pytest.raises(ToolError):
                await client.call_tool("crm_step_checklist_item_archive", {"item_id": POINT_SEED})
        assert (await _service("GET", "/workflow_step_checklist_items", params={
            "id": f"eq.{POINT_SEED}", "select": "label,archived_at",
        })).json() == [{"label": "Besoin confirmé", "archived_at": None}]
        assert (await _service("GET", "/workflow_step_checklist_items", params={"label": "eq.Refusé", "select": "id"})).json() == []
    finally:
        await _retirer(DRISS, cases)

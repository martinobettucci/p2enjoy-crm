# @verifies CRM-068 (docs/BACKLOG.md) — tranche T5 : `crm_card_checklist_list` et `crm_card_checklist_set`, devant un CRM
#           simulé qui enregistre chaque écriture
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §9.2 duodecies (actions, ancres, genre `card_checklist_item`, écriture filtrée sur l'affaire ;
#           décision 767), §9.1 (déclarations vérifiées), §9.3 (zéro ligne = refus) ; docs/SPEC-checklists.md §5
"""Le CRM simulé rend ce que PostgREST rendrait ; la RLS, le déclencheur du cochage et la ligne du fil sont prouvés
contre la vraie base par `tests/test_integration_affaires_checklists.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import affaires_checklists, reference
from crm_mcp.outils.affaires_checklists import projeter_checklist
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET
from .test_affaires_ecriture import CARD_A, RATTACHEMENT_A, THOMAS, CrmEcriture

POINT_LIBRE = "b0000000-0000-4000-8000-000000000001"
POINT_COURANT = "b0000000-0000-4000-8000-000000000002"
POINT_PASSE = "b0000000-0000-4000-8000-000000000003"
POINT_AILLEURS = "b0000000-0000-4000-8000-000000000009"
ETAPE_PROSPECTION = "s1"
ETAPE_RELANCE = "s2"


def etape(position: int, nom: str) -> dict[str, Any]:
    return {"position": position, "label_override": None, "workflow_nodes_catalog": {"label": nom}}


POINTS = [
    {"id": POINT_COURANT, "card_id": CARD_A, "workspace_id": ESPACE_A, "placement_id": RATTACHEMENT_A,
     "step_item_id": "i2", "label": "Proposition envoyée", "position": 1, "checked": False, "checked_at": None,
     "cocheur": None, "origine": {"step_id": ETAPE_RELANCE, "etape": etape(2, "Relance"),
                                  "exigences": [{"transition": {"vers": etape(3, "Négociation")}}]}},
    {"id": POINT_LIBRE, "card_id": CARD_A, "workspace_id": ESPACE_A, "placement_id": None, "step_item_id": None,
     "label": "Relancer la DAF", "position": 1, "checked": True, "checked_at": "2026-10-27T09:00:00+00:00",
     "cocheur": {"full_name": "Driss Lemoine"}, "origine": None},
    {"id": POINT_PASSE, "card_id": CARD_A, "workspace_id": ESPACE_A, "placement_id": RATTACHEMENT_A,
     "step_item_id": "i1", "label": "Besoin confirmé", "position": 1, "checked": True,
     "checked_at": "2026-10-26T09:00:00+00:00", "cocheur": {"full_name": "Driss Lemoine"},
     "origine": {"step_id": ETAPE_PROSPECTION, "etape": etape(1, "Prospection"), "exigences": []}},
    {"id": POINT_AILLEURS, "card_id": "autre", "workspace_id": ESPACE_B, "placement_id": None, "step_item_id": None,
     "label": "Ailleurs", "position": 1, "checked": False, "checked_at": None, "cocheur": None, "origine": None},
]


class CrmChecklists(CrmEcriture):
    def lignes(self, nom: str, parametres: dict[str, str], lisibles: set[str]) -> list[dict[str, Any]] | None:
        if nom == "card_checklist_items":
            filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
            return [p for p in POINTS if p["workspace_id"] in lisibles and all(str(p.get(k)) == v for k, v in filtres.items())]
        lignes = super().lignes(nom, parametres, lisibles)
        if nom == "card_placements" and lignes is not None:
            return [{**r, "current_step_id": ETAPE_RELANCE} for r in lignes]
        return lignes


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmChecklists()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.moteur = MoteurPolitique(
            registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires_checklists.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}

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


TOUT = (("affaires", "consulter"), ("affaires", "modifier"))


async def test_deux_outils_leurs_actions_et_leurs_ancres(monde: Monde) -> None:
    declarations = monde.moteur.declarations
    assert declarations["crm_card_checklist_list"].action == "consulter"
    assert declarations["crm_card_checklist_set"].action == "modifier"
    assert declarations["crm_card_checklist_set"].espace == "card:card_id"
    assert declarations["crm_card_checklist_set"].autres == ("card_checklist_item:item_id",)
    monde.ouvrir(*TOUT)
    outils = await monde.outils()
    assert outils["crm_card_checklist_list"].annotations.read_only_hint
    assert not outils["crm_card_checklist_set"].annotations.read_only_hint
    assert not outils["crm_card_checklist_set"].annotations.destructive_hint


async def test_la_matrice_ferme_le_cochage_sans_fermer_la_lecture(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    outils = await monde.outils()
    assert "crm_card_checklist_list" in outils
    assert "crm_card_checklist_set" not in outils


async def test_la_liste_dit_libres_puis_etape_courante_puis_etapes_passees(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    resultat = await monde.appel("crm_card_checklist_list", {"card_id": CARD_A})
    assert resultat["current_step_count"] == {"checked": 0, "total": 1}
    assert [p["label"] for p in resultat["free_items"]] == ["Relancer la DAF"]
    assert resultat["free_items"][0]["checked_by"] == "Driss Lemoine"
    assert [(e["step"], e["current"]) for e in resultat["step_items"]] == [("Relance", True), ("Prospection", False)]
    courant = resultat["step_items"][0]["items"][0]
    assert courant == {
        "item_id": POINT_COURANT, "label": "Proposition envoyée", "checked": False, "checked_by": None,
        "checked_at": None, "required_to_move_to": ["Négociation"],
    }


async def test_cocher_patche_le_point_filtre_sur_l_affaire(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["card_checklist_items"] = (
        200, [{"id": POINT_COURANT, "card_id": CARD_A, "label": "Proposition envoyée", "checked": True, "checked_at": "t"}]
    )
    resultat = await monde.appel("crm_card_checklist_set", {"card_id": CARD_A, "item_id": POINT_COURANT, "checked": True})
    [ecriture] = [e for e in monde.simule.ecritures if e["table"] == "card_checklist_items"]
    assert ecriture["methode"] == "PATCH"
    assert ecriture["corps"] == {"checked": True}
    assert ecriture["parametres"]["id"] == f"eq.{POINT_COURANT}"
    assert ecriture["parametres"]["card_id"] == f"eq.{CARD_A}"
    assert resultat["item"] == {"item_id": POINT_COURANT, "label": "Proposition envoyée", "checked": True, "checked_at": "t"}


async def test_zero_ligne_rendue_est_un_refus_jamais_un_succes(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["card_checklist_items"] = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : point de checklist"):
        await monde.appel("crm_card_checklist_set", {"card_id": CARD_A, "item_id": POINT_COURANT, "checked": True})


async def test_un_point_d_un_autre_espace_n_est_jamais_ecrit(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
        await monde.appel("crm_card_checklist_set", {"card_id": CARD_A, "item_id": POINT_AILLEURS, "checked": True})
    assert [e for e in monde.simule.ecritures if e["table"] == "card_checklist_items"] == []


def test_la_projection_ignore_les_points_d_un_autre_rattachement() -> None:
    autre = {**POINTS[0], "id": "x", "placement_id": "autre-rattachement"}
    projete = projeter_checklist([autre, POINTS[1]], RATTACHEMENT_A, ETAPE_RELANCE)
    assert projete["step_items"] == []
    assert projete["current_step_count"] == {"checked": 0, "total": 0}

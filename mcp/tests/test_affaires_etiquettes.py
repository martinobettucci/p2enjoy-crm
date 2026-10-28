# @verifies CRM-069 (docs/BACKLOG.md) — tranche T3 : les étiquettes dans le connecteur — `crm_card_label_set`, la lecture par
#           `crm_card_get` et `crm_card_list`, le filtre `label`, devant un CRM simulé qui enregistre chaque écriture
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §9.2 tredecies (noms résolus dans l'espace, refus avant écriture, `unchanged`), §9.1, §9.3
"""Le CRM simulé rend ce que PostgREST rendrait ; la RLS, l'auteur et la ligne du fil sont prouvés contre la vraie base par
`tests/test_integration_affaires_etiquettes.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import affaires, affaires_etiquettes, reference
from crm_mcp.outils.affaires import detail_evenement, etiquettes, resume_carte
from crm_mcp.outils.affaires_etiquettes import resoudre_noms
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET
from .test_affaires_ecriture import CARD_A, THOMAS, CrmEcriture

CATALOGUE = [
    {"id": "l-prio", "workspace_id": ESPACE_A, "name": "Prioritaire", "archived_at": None},
    {"id": "l-public", "workspace_id": ESPACE_A, "name": "Secteur public", "archived_at": None},
    {"id": "l-salon", "workspace_id": ESPACE_A, "name": "Salon 2025", "archived_at": "2026-01-15T09:00:00+00:00"},
]


class CrmEtiquettes(CrmEcriture):
    def __init__(self) -> None:
        super().__init__()
        #: les étiquettes posées sur CARD_A, que la lecture de `cards` plonge
        self.posees: list[dict[str, Any]] = [{"name": "Salon 2025", "color": "neutral", "archived_at": "t"}]

    def lignes(self, nom: str, parametres: dict[str, str], lisibles: set[str]) -> list[dict[str, Any]] | None:
        if nom == "labels":
            return [e for e in CATALOGUE if e["workspace_id"] in lisibles]
        lignes = super().lignes(nom, parametres, lisibles)
        if nom == "cards" and lignes is not None:
            return [{**c, "etiquettes": [{"etiquette": e} for e in self.posees]} for c in lignes]
        return lignes


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmEtiquettes()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.moteur = MoteurPolitique(
            registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires.ajouter(self.mcp, self.moteur, self.crm)
        affaires_etiquettes.ajouter(self.mcp, self.moteur, self.crm)
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

    def ecritures(self) -> list[dict[str, Any]]:
        return [e for e in self.simule.ecritures if e["table"] == "card_labels"]


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


TOUT = (("affaires", "consulter"), ("affaires", "modifier"))


def test_les_etiquettes_d_une_ligne_triees_par_nom_l_illisible_ecartee() -> None:
    ligne = {"etiquettes": [{"etiquette": {"name": "public", "color": "brand", "archived_at": None}}, {"etiquette": None},
                            {"etiquette": {"name": "Prioritaire", "color": "danger", "archived_at": "t"}}]}
    assert etiquettes(ligne) == [
        {"name": "Prioritaire", "color": "danger", "archived": True},
        {"name": "public", "color": "brand", "archived": False},
    ]
    assert resume_carte({"id": "c", "title": "T"})["labels"] == []
    assert detail_evenement("label_added", {"name": "Prioritaire"}, {}, {}, {}) == {"label": "Prioritaire"}


def test_resoudre_les_noms_a_la_casse_pres_et_refuser_avant_ecriture() -> None:
    assert [e["id"] for e in resoudre_noms(CATALOGUE, ["prioritaire", "PRIORITAIRE"], pose=True)] == ["l-prio"]
    with pytest.raises(ToolError, match="No label named 'Inconnue'.*Labels: Prioritaire, Secteur public"):
        resoudre_noms(CATALOGUE, ["Inconnue"], pose=True)
    with pytest.raises(ToolError, match="Salon 2025"):
        resoudre_noms(CATALOGUE, ["Salon 2025"], pose=True)
    assert [e["id"] for e in resoudre_noms(CATALOGUE, ["salon 2025"], pose=False)] == ["l-salon"]


async def test_l_outil_modifier_sans_destruction_ferme_sans_la_case(monde: Monde) -> None:
    declaration = monde.moteur.declarations["crm_card_label_set"]
    assert (declaration.famille, declaration.action, declaration.espace) == ("affaires", "modifier", "card:card_id")
    monde.ouvrir(("affaires", "consulter"))
    assert "crm_card_label_set" not in await monde.outils()
    monde.ouvrir(("affaires", "modifier"))
    outil = (await monde.outils())["crm_card_label_set"]
    assert not outil.annotations.destructive_hint and not outil.annotations.read_only_hint


async def test_poser_et_retirer_par_nom_l_inchange_dit(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    resultat = await monde.appel(
        "crm_card_label_set", {"card_id": CARD_A, "add": ["secteur PUBLIC"], "remove": ["Salon 2025", "Prioritaire"]}
    )
    poses = monde.ecritures()
    assert [(e["methode"], e["corps"] or e["parametres"].get("label_id")) for e in poses] == [
        ("POST", {"card_id": CARD_A, "label_id": "l-public"}),
        ("DELETE", "eq.l-salon"),
    ]
    assert resultat["unchanged"] == ["Prioritaire"]


async def test_un_nom_inconnu_n_ecrit_rien(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError, match="No label named 'Événementiel'"):
        await monde.appel("crm_card_label_set", {"card_id": CARD_A, "add": ["Secteur public", "Événementiel"]})
    assert monde.ecritures() == []
    with pytest.raises(ToolError, match="at least one label"):
        await monde.appel("crm_card_label_set", {"card_id": CARD_A})


async def test_zero_ligne_au_retrait_est_un_refus(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["card_labels"] = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
        await monde.appel("crm_card_label_set", {"card_id": CARD_A, "remove": ["Salon 2025"]})

# @verifies CRM-071 (docs/BACKLOG.md) — tranche T3 : les vues sauvegardées dans le connecteur — `crm_view_list` et l'argument
#           `view` de `crm_card_list`, devant un CRM simulé qui garde chaque lecture
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2)
# @verifies docs/SPEC-mcp.md §9.2 quattuordecies (famille `affaires`, `consulter`, ancre `channel` ; filtres en clair ; une
#           vue inconnue refusée avant toute lecture des affaires ; étape disparue ignorée ; l'argument de l'appel l'emporte ;
#           la recherche plein texte et l'ordre de la vue liste) ; docs/JOURNAL.md décision 775
"""Le CRM simulé rend ce que PostgREST rendrait ; la RLS de `saved_views` et les mêmes affaires qu'à l'écran sont prouvées
contre la vraie base par `tests/test_integration_vues.py` et par l'E2E `e2e/ui/connecteur-vues.spec.ts`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import affaires, reference, vues
from crm_mcp.outils.vues import choisir_vue, en_clair, ordre
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET
from .test_affaires_ecriture import CHANNEL_A, THOMAS, CrmEcriture

ETAPE = "e0000000-0000-4000-8000-0000000000e1"
ETAPE_DISPARUE = "e0000000-0000-4000-8000-0000000000e9"
ETIQUETTE = "f0000000-0000-4000-8000-0000000000f1"
VUES = [
    {"id": "v-1", "name": "Mes négociations", "channel_id": CHANNEL_A, "workspace_id": ESPACE_A, "visibility": "private",
     "filters": {"step_id": ETAPE, "sort": "next_action_at", "search": "lyon", "snoozed": "shown"}},
    {"id": "v-2", "name": "Secteur public", "channel_id": CHANNEL_A, "workspace_id": ESPACE_A, "visibility": "workspace",
     "filters": {"label_id": ETIQUETTE, "sort": "amount"}},
    {"id": "v-3", "name": "Ancienne", "channel_id": CHANNEL_A, "workspace_id": ESPACE_A, "visibility": "private",
     "filters": {"step_id": ETAPE_DISPARUE}},
]


class CrmVues(CrmEcriture):
    def __init__(self) -> None:
        super().__init__()
        self.lectures: list[tuple[str, dict[str, str]]] = []

    def lignes(self, nom: str, parametres: dict[str, str], lisibles: set[str]) -> list[dict[str, Any]] | None:
        self.lectures.append((nom, dict(parametres)))
        if nom == "saved_views":
            canal = parametres.get("channel_id")
            return [v for v in VUES if v["workspace_id"] in lisibles and (canal is None or canal == f"eq.{v['channel_id']}")]
        if nom == "workflow_steps":
            return [{"id": ETAPE, "noeud": {"label": "Négociation"}}] if ETAPE in parametres.get("id", "") else []
        if nom == "labels":
            return [{"id": ETIQUETTE, "name": "Secteur public"}]
        return super().lignes(nom, parametres, lisibles)

    def lecture(self, table: str) -> dict[str, str]:
        return [p for n, p in self.lectures if n == table][-1]


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmVues()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.moteur = MoteurPolitique(
            registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires.ajouter(self.mcp, self.moteur, self.crm)
        vues.ajouter(self.mcp, self.moteur, self.crm)
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


def test_choisir_une_vue_par_nom_sans_casse_ou_par_identifiant() -> None:
    assert choisir_vue(VUES, "mes NÉGOCIATIONS ")["id"] == "v-1"
    assert choisir_vue(VUES, "v-2")["name"] == "Secteur public"
    with pytest.raises(ToolError, match="No saved view named 'Revue'.*Views: Ancienne, Mes négociations, Secteur public"):
        choisir_vue(VUES, "Revue")
    deux = [*VUES, {**VUES[0], "id": "v-9", "channel_id": "autre"}]
    with pytest.raises(ToolError, match="Several channels have a view named"):
        choisir_vue(deux, "Mes négociations")


def test_une_vue_en_clair_et_l_ordre_de_la_vue_liste() -> None:
    assert en_clair(VUES[0], {ETAPE: "Négociation"}, {})["filters"] == {
        "sort": "next_action_at", "direction": "asc", "step": "Négociation", "label": None, "search": "lyon",
        "include_snoozed": True,
    }
    vide = en_clair({**VUES[0], "filters": None}, {}, {})
    assert vide["filters"] == {"sort": "title", "direction": "asc", "step": None, "label": None, "search": None,
                               "include_snoozed": False}
    assert ordre("title", "asc") == "affaire(title).asc.nullslast,affaire(id).asc.nullslast"
    assert ordre("amount", "desc") == "amount.desc.nullslast,affaire(title).asc.nullslast,affaire(id).asc.nullslast"
    assert ordre("created_at", "desc").startswith("affaire(created_at).desc.nullslast,")


async def test_crm_view_list_est_une_consultation_ancree_au_channel(monde: Monde) -> None:
    declaration = monde.moteur.declarations["crm_view_list"]
    assert (declaration.famille, declaration.action, declaration.espace) == ("affaires", "consulter", "channel:channel_id")
    assert "crm_view_list" not in await monde.outils()
    monde.ouvrir(("affaires", "consulter"))
    outil = (await monde.outils())["crm_view_list"]
    assert outil.annotations.read_only_hint


async def test_crm_view_list_rend_les_vues_en_clair(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    rendu = await monde.appel("crm_view_list", {"channel_id": CHANNEL_A})
    assert [(v["name"], v["visibility"], v["filters"]["step"], v["filters"]["label"]) for v in rendu["views"]] == [
        ("Mes négociations", "private", "Négociation", None),
        ("Secteur public", "workspace", None, "Secteur public"),
        ("Ancienne", "private", None, None),
    ]


async def test_crm_card_list_applique_la_vue_comme_la_vue_liste(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    rendu = await monde.appel("crm_card_list", {"workspace": ESPACE_A, "view": "mes négociations"})
    assert rendu["view"] == {"id": "v-1", "name": "Mes négociations"}
    envoye = monde.simule.lecture("card_placements")
    assert envoye["channel_id"] == f"eq.{CHANNEL_A}"
    assert envoye["current_step_id"] == f"eq.{ETAPE}"
    assert envoye["affaire.search_tsv"] == "plfts(francais_sans_accent).lyon"
    assert envoye["order"].startswith("next_action_at.asc.nullslast,")
    # La vue montre les affaires en sommeil : aucun filtre d'exclusion n'est envoyé.
    assert "or" not in envoye


async def test_les_arguments_de_l_appel_l_emportent_sur_la_vue(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    await monde.appel(
        "crm_card_list", {"workspace": ESPACE_A, "view": "Mes négociations", "step": "Relance", "query": "erp", "include_snoozed": False}
    )
    envoye = monde.simule.lecture("card_placements")
    assert envoye["etape.noeud.label"] == "eq.Relance" and "current_step_id" not in envoye
    assert envoye["affaire.title"] == "ilike.*erp*" and "affaire.search_tsv" not in envoye
    assert "or" in envoye


async def test_l_etiquette_d_une_vue_et_une_etape_disparue_ignoree(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    await monde.appel("crm_card_list", {"workspace": ESPACE_A, "view": "Secteur public"})
    envoye = monde.simule.lecture("card_placements")
    assert envoye["affaire.filtre.label_id"] == f"eq.{ETIQUETTE}"
    assert envoye["order"].startswith("amount.desc.nullslast,")
    await monde.appel("crm_card_list", {"workspace": ESPACE_A, "view": "Ancienne"})
    assert "current_step_id" not in monde.simule.lecture("card_placements")


async def test_une_vue_inconnue_est_refusee_avant_toute_lecture_des_affaires(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    with pytest.raises(ToolError, match="No saved view named 'Revue du lundi'"):
        await monde.appel("crm_card_list", {"workspace": ESPACE_A, "view": "Revue du lundi"})
    assert not [n for n, _ in monde.simule.lectures if n == "card_placements"]

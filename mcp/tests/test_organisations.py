# @verifies CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 sexies (liste avec compte de contacts, fiche avec contacts, domaine en minuscules,
#           effacement, refus nommés, aucune suppression), §9.3 (zéro ligne = refus) ; docs/SPEC-organisations.md §3, §5
"""Le CRM simulé rend deux organisations, l'une d'un autre espace ; la vraie base est éprouvée par
`tests/test_integration_organisations.py`."""

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
from crm_mcp.outils import organisations, reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

ORG_A = "a0000000-0000-4000-8000-0000000000c1"
ORG_B = "b0000000-0000-4000-8000-0000000000c2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {"crm_organization_list", "crm_organization_get", "crm_organization_create", "crm_organization_update"}


class CrmOrganisations(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[dict[str, str]] = []
        self.forcee: tuple[int, Any] | None = None

    async def table_organisations(self, requete: Request) -> Response:
        if requete.path_params["table"] != "organizations":
            return await self.table(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json()
            self.ecritures.append({"methode": requete.method, "parametres": parametres, "corps": corps})
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            return JSONResponse([{"id": ORG_A, "name": "Sogexia", "domain": None, "website": None, **corps}], status_code=201)
        self.lectures.append(parametres)
        lignes = [
            {"id": ORG_A, "workspace_id": ESPACE_A, "name": "Sogexia", "domain": "sogexia.example", "website": None,
             "contacts": [{"count": 2}] if "contacts(count)" in parametres.get("select", "") else [
                 {"id": "k2", "full_name": "Zoé", "role_title": None, "email": None, "phone": "06"},
                 {"id": "k9", "full_name": "Léo", "role_title": "DSI", "email": "leo@sogexia.example", "phone": None},
             ]},
            {"id": ORG_B, "workspace_id": ESPACE_B, "name": "Ailleurs", "contacts": []},
        ]
        lisibles = self._lisibles(personne)
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.") and "." not in k}
        return JSONResponse([
            l for l in lignes if l["workspace_id"] in lisibles and all(str(l.get(k)) == v for k, v in filtres.items())
        ])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_organisations, methods=["GET", "POST", "PATCH"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmOrganisations()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        organisations.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "organizations", a) for a in ("consulter", "ajouter", "modifier")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


async def test_quatre_outils_aucune_suppression(monde: Monde) -> None:
    declares = {n: (d.action, d.espace) for n, d in monde.moteur.declarations.items() if d.famille == "organizations"}
    assert declares == {
        "crm_organization_list": ("consulter", "workspace:workspace"),
        "crm_organization_get": ("consulter", "organisation:organization_id"),
        "crm_organization_create": ("ajouter", "workspace:workspace"),
        "crm_organization_update": ("modifier", "organisation:organization_id"),
    }
    assert set(declares) == OUTILS


async def test_la_liste_filtre_par_espace_et_mots_et_compte_les_contacts(monde: Monde) -> None:
    resultat = await monde.appel("crm_organization_list", {"workspace": "atelier", "query": "sog*", "limit": 1})
    envoye = monde.simule.lectures[-1]
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}" and envoye["order"] == "name.asc,id.asc"
    assert envoye["or"] == "(name.ilike.*sog*,domain.ilike.*sog*)" and envoye["limit"] == "2"
    assert resultat == {"offset": 0, "has_more": False, "organizations": [
        {"id": ORG_A, "name": "Sogexia", "domain": "sogexia.example", "website": None, "contacts": 2}
    ]}


async def test_la_fiche_range_ses_contacts_et_tait_l_autre_espace(monde: Monde) -> None:
    fiche = await monde.appel("crm_organization_get", {"organization_id": ORG_A})
    assert [c["full_name"] for c in fiche["contacts"]] == ["Léo", "Zoé"]
    assert fiche["contacts"][0] == {"id": "k9", "full_name": "Léo", "role_title": "DSI", "email": "leo@sogexia.example",
                                    "phone": None}
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : organisation"):
        await monde.appel("crm_organization_get", {"organization_id": ORG_B})


async def test_creer_et_modifier_envoient_ce_que_l_ecran_envoie(monde: Monde) -> None:
    cree = await monde.appel("crm_organization_create", {"workspace": "atelier", "name": " Vasseur ", "domain": " Vasseur.FR ",
                                                         "website": " "})
    assert monde.simule.ecritures[-1]["corps"] == {"workspace_id": ESPACE_A, "name": "Vasseur", "domain": "vasseur.fr",
                                                   "website": None}
    assert cree["organization"]["domain"] == "vasseur.fr"
    await monde.appel("crm_organization_update", {"organization_id": ORG_A, "domain": "", "website": "https://x.example"})
    assert monde.simule.ecritures[-1]["corps"] == {"domain": None, "website": "https://x.example"}
    assert monde.simule.ecritures[-1]["parametres"]["id"] == f"eq.{ORG_A}"
    with pytest.raises(ToolError, match="at least one field"):
        await monde.appel("crm_organization_update", {"organization_id": ORG_A})


async def test_domaine_pris_forme_et_zero_ligne_sont_des_refus(monde: Monde) -> None:
    monde.simule.forcee = (409, {"code": "23505", "message": "duplicate key"})
    with pytest.raises(ToolError, match="domain_taken"):
        await monde.appel("crm_organization_create", {"workspace": "atelier", "name": "x", "domain": "sogexia.example"})
    monde.simule.forcee = (400, {"code": "23514", "message": 'new row violates check constraint "organizations_website_check"'})
    with pytest.raises(ToolError, match="organizations_website_check"):
        await monde.appel("crm_organization_update", {"organization_id": ORG_A, "website": "ftp://x"})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : organisation"):
        await monde.appel("crm_organization_update", {"organization_id": ORG_A, "name": "y"})

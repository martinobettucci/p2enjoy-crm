# @verifies CRM-104 (docs/BACKLOG.md) — tranche T3 : les quatre outils de contact, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 quinquies (liste, ancre `organisation` facultative, aucune suppression), §9.3 (refus
#           traduits, zéro ligne = refus) ; docs/SPEC-contacts.md §14 à §16 (ce que le carnet lit et écrit)
# @verifies CRM-111 T2.4.2 (docs/BACKLOG.md) — une affaire liée est archivée quand tous ses rattachements le sont (docs/SPEC-rattachements.md §5, §11)
"""Le CRM simulé rend un carnet et deux organisations, l'une d'un autre espace ; la vraie base est éprouvée par
`tests/test_integration_contacts.py`."""

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
from crm_mcp.outils import contacts, reference
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

CONTACT_A = "a0000000-0000-4000-8000-0000000000b1"
CONTACT_B = "b0000000-0000-4000-8000-0000000000b2"
ORG_A = "a0000000-0000-4000-8000-0000000000c1"
ORG_B = "b0000000-0000-4000-8000-0000000000c2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {"crm_contact_list", "crm_contact_get", "crm_contact_create", "crm_contact_update"}


class CrmContacts(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.forcee: tuple[int, Any] | None = None

    async def table_contacts(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json()
            self.ecritures.append({"methode": requete.method, "table": nom, "parametres": parametres, "corps": corps})
            if self.forcee is not None:
                return JSONResponse(self.forcee[1], status_code=self.forcee[0])
            return JSONResponse([{"id": CONTACT_A, "full_name": "Léo", **corps}], status_code=201)
        self.lectures.append((nom, parametres))
        tables = {
            "contacts": [
                {"id": CONTACT_A, "workspace_id": ESPACE_A, "full_name": "Léo Marchand", "email": None, "phone": None,
                 "role_title": "DSI", "organization_id": ORG_A, "organizations": {"id": ORG_A, "name": "Sogexia"},
                 "card_contacts": [
                     {"role": "prescripteur", "cards": {"id": "c2", "title": "Zèbre", "card_placements": [{"archived_at": None}]}},
                     {"role": "decideur", "cards": {"id": "c9", "title": "Audit", "card_placements": [{"archived_at": "2026-01-01"}]}},
                 ]},
                {"id": CONTACT_B, "workspace_id": ESPACE_B, "full_name": "Ailleurs", "organizations": None},
            ],
            "organizations": [{"id": ORG_A, "workspace_id": ESPACE_A}, {"id": ORG_B, "workspace_id": ESPACE_B}],
        }
        if nom not in tables:
            return await self.table(requete)
        lignes = [l for l in tables[nom] if l["workspace_id"] in lisibles]
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.") and "." not in k}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_contacts, methods=["GET", "POST", "PATCH"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmContacts()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        contacts.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "contacts", a) for a in ("consulter", "ajouter", "modifier")}

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
    declares = {n for n, d in monde.moteur.declarations.items() if d.famille == "contacts"}
    assert declares == OUTILS
    assert all(monde.moteur.facultatives[n] == frozenset({"organization_id"})
               for n in ("crm_contact_list", "crm_contact_create", "crm_contact_update"))


async def test_la_liste_filtre_par_espace_mots_et_organisation(monde: Monde) -> None:
    resultat = await monde.appel("crm_contact_list", {"workspace": "atelier", "query": "dsi*", "organization_id": ORG_A})
    envoye = monde.simule.lectures[-1][1]
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}" and envoye["organization_id"] == f"eq.{ORG_A}"
    assert envoye["or"] == "(full_name.ilike.*dsi*,email.ilike.*dsi*,role_title.ilike.*dsi*)"
    assert resultat["contacts"][0]["organization"] == {"id": ORG_A, "name": "Sogexia"}
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : organisation"):
        await monde.appel("crm_contact_list", {"workspace": "atelier", "organization_id": ORG_B})


async def test_la_fiche_range_ses_affaires_et_tait_la_corbeille(monde: Monde) -> None:
    fiche = await monde.appel("crm_contact_get", {"contact_id": CONTACT_A})
    assert [(a["title"], a["role"], a["archived"]) for a in fiche["affaires"]] == [
        ("Audit", "decideur", True), ("Zèbre", "prescripteur", False)
    ]
    assert monde.simule.lectures[-1][1]["card_contacts.cards.deleted_at"] == "is.null"
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : contact"):
        await monde.appel("crm_contact_get", {"contact_id": CONTACT_B})


async def test_creer_et_modifier_envoient_ce_que_le_carnet_envoie(monde: Monde) -> None:
    await monde.appel("crm_contact_create", {"workspace": "atelier", "full_name": " Élise Fabre ", "email": " ", "phone": "06"})
    assert monde.simule.ecritures[-1]["corps"] == {"workspace_id": ESPACE_A, "full_name": "Élise Fabre",
                                                   "organization_id": None, "role_title": None, "email": None, "phone": "06"}
    await monde.appel("crm_contact_update", {"contact_id": CONTACT_A, "email": "", "detach_organization": True})
    assert monde.simule.ecritures[-1]["corps"] == {"email": None, "organization_id": None}
    with pytest.raises(ToolError, match="not both"):
        await monde.appel("crm_contact_update", {"contact_id": CONTACT_A, "organization_id": ORG_A, "detach_organization": True})
    with pytest.raises(ToolError, match="at least one field"):
        await monde.appel("crm_contact_update", {"contact_id": CONTACT_A})


async def test_doublon_et_zero_ligne_sont_des_refus(monde: Monde) -> None:
    monde.simule.forcee = (409, {"code": "23505", "message": "duplicate key"})
    with pytest.raises(ToolError, match="duplicate_contact"):
        await monde.appel("crm_contact_create", {"workspace": "atelier", "full_name": "x"})
    monde.simule.forcee = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : contact"):
        await monde.appel("crm_contact_update", {"contact_id": CONTACT_A, "phone": "07"})

# @verifies CRM-114 (docs/BACKLOG.md) — tranche T4 : les quatre outils de la famille `organizations`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 sexies (liste avec compte de contacts, fiche avec contacts, domaine en minuscules,
#           effacement, refus nommés, aucune suppression), §9.3 (zéro ligne = refus) ; docs/SPEC-organisations.md §3, §5
# @verifies CRM-152 (docs/BACKLOG.md) — tranche T3 : `crm_organization_list` par `organization_list` puis
#           `organization_tracks` — la recherche aussi dans le site web, l'un des tracks, les tracks de chaque
#           organisation, `total` et `has_more`, un identifiant de track mal formé refusé par l'outil (docs/SPEC-mcp.md §9.2
#           tervicies ; docs/SPEC-organisations.md §8.4)
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
ORG_C = "a0000000-0000-4000-8000-0000000000c3"
TRACK_IA = "a0000000-0000-4000-8000-0000000000a1"
TRACK_FORMATION = "a0000000-0000-4000-8000-0000000000a2"
#: La liste que `organization_list` filtre : deux organisations de l'espace A, une de l'espace B.
LISTE = [
    {"id": ORG_A, "workspace_id": ESPACE_A, "name": "Sogexia", "domain": "sogexia.example", "website": None, "contacts": 2,
     "has_revenues": False, "tracks": [TRACK_IA]},
    {"id": ORG_C, "workspace_id": ESPACE_A, "name": "Vertigo", "domain": None, "website": "https://vertigo.example",
     "contacts": 0, "has_revenues": True, "tracks": [TRACK_IA, TRACK_FORMATION]},
    {"id": ORG_B, "workspace_id": ESPACE_B, "name": "Ailleurs", "domain": None, "website": None, "contacts": 1,
     "has_revenues": False, "tracks": []},
]
NOMS_TRACKS = {TRACK_IA: ("Conseil & IA", "conseil-ia"), TRACK_FORMATION: ("Formation", "formation")}
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
OUTILS = {"crm_organization_list", "crm_organization_get", "crm_organization_create", "crm_organization_update"}


class CrmOrganisations(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.lectures: list[dict[str, str]] = []
        self.forcee: tuple[int, Any] | None = None
        self.appels_rpc: list[tuple[str, dict[str, Any]]] = []

    async def rpc(self, requete: Request) -> Response:
        """`organization_list` et `organization_tracks` comme la base les rend, sous la lecture de la personne ; le reste
        à la simulation commune."""
        fonction = requete.path_params["fonction"]
        if fonction not in ("organization_list", "organization_tracks"):
            return await super().rpc(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"code": "PGRST301", "message": "JWT invalide"}, status_code=401)
        corps = await requete.json()
        self.appels_rpc.append((fonction, corps))
        lisibles = [o for o in LISTE if o["workspace_id"] in self._lisibles(personne)]
        if fonction == "organization_tracks":
            return JSONResponse([
                {"organization_id": o["id"], "track_id": t, "name": NOMS_TRACKS[t][0], "slug": NOMS_TRACKS[t][1],
                 "color": "brand", "icon": "Folder"}
                for o in lisibles if o["id"] in corps["p_organization_ids"] for t in o["tracks"]
            ])
        mot = (corps.get("p_search") or "").lower()
        retenues = [
            o for o in lisibles
            if o["workspace_id"] == corps["p_workspace_id"]
            and (not mot or any(mot in (o.get(c) or "").lower() for c in ("name", "domain", "website")))
            and (not corps.get("p_track_ids") or set(corps["p_track_ids"]) & set(o["tracks"]))
        ]
        page = retenues[corps["p_offset"]:corps["p_offset"] + corps["p_limit"]]
        return JSONResponse([
            {k: o[k] for k in ("id", "name", "domain", "website", "contacts", "has_revenues")} | {"total_count": len(retenues)}
            for o in page
        ])

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


async def test_la_liste_lit_la_base_puis_les_tracks_et_rend_le_total(monde: Monde) -> None:
    resultat = await monde.appel("crm_organization_list", {"workspace": "atelier", "limit": 1})
    assert monde.simule.appels_rpc == [
        ("organization_list", {"p_workspace_id": ESPACE_A, "p_search": None, "p_track_ids": None, "p_limit": 1,
                               "p_offset": 0}),
        ("organization_tracks", {"p_organization_ids": [ORG_A]}),
    ]
    assert resultat == {"offset": 0, "total": 2, "has_more": True, "organizations": [
        {"id": ORG_A, "name": "Sogexia", "domain": "sogexia.example", "website": None, "contacts": 2,
         "tracks": [{"id": TRACK_IA, "name": "Conseil & IA", "slug": "conseil-ia"}]},
    ]}
    suite = await monde.appel("crm_organization_list", {"workspace": "atelier", "limit": 1, "offset": 1})
    assert suite["has_more"] is False and [o["name"] for o in suite["organizations"]] == ["Vertigo"]


async def test_la_recherche_porte_aussi_sur_le_site_web_et_n_est_pas_nettoyee(monde: Monde) -> None:
    resultat = await monde.appel("crm_organization_list", {"workspace": "atelier", "query": " vertigo.example "})
    assert monde.simule.appels_rpc[0][1]["p_search"] == "vertigo.example"
    assert [o["name"] for o in resultat["organizations"]] == ["Vertigo"]
    assert resultat["organizations"][0]["tracks"] == [
        {"id": TRACK_IA, "name": "Conseil & IA", "slug": "conseil-ia"},
        {"id": TRACK_FORMATION, "name": "Formation", "slug": "formation"},
    ]


async def test_le_filtre_par_track_garde_l_un_d_eux_et_dedoublonne(monde: Monde) -> None:
    resultat = await monde.appel(
        "crm_organization_list",
        {"workspace": "atelier", "tracks": [TRACK_FORMATION, TRACK_FORMATION.upper()]},
    )
    assert monde.simule.appels_rpc[0][1]["p_track_ids"] == [TRACK_FORMATION]
    assert [o["name"] for o in resultat["organizations"]] == ["Vertigo"] and resultat["total"] == 1


async def test_une_page_vide_n_appelle_pas_les_tracks(monde: Monde) -> None:
    resultat = await monde.appel("crm_organization_list", {"workspace": "atelier", "query": "introuvable"})
    assert resultat == {"offset": 0, "total": 0, "has_more": False, "organizations": []}
    assert [f for f, _ in monde.simule.appels_rpc] == ["organization_list"]


async def test_un_track_mal_forme_est_refuse_par_l_outil(monde: Monde) -> None:
    with pytest.raises(ToolError, match="tracks must be track ids"):
        await monde.appel("crm_organization_list", {"workspace": "atelier", "tracks": ["conseil-ia"]})
    assert monde.simule.appels_rpc == []


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

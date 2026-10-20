# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires de la garde d'entrée
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §3.5 (corps bornés, 1 Mio sur `/mcp` ; débit des points OAuth par adresse ;
#           enregistrements bornés ; purge horaire ; limites relevées en développement)
# @verifies Repris des preuves d'Evoliz (p2enjoy-evoliz, `tests/test_garde.py`, révision 80a3e27), sans les points
#           d'administration, absents du connecteur du CRM.
from __future__ import annotations

import asyncio

import httpx2
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from crm_mcp import garde
from crm_mcp.garde import GardeEntree


async def _echo(requete: Request) -> JSONResponse:
    return JSONResponse({"taille": len(await requete.body())})


def _app() -> Starlette:
    return Starlette(routes=[Route(c, _echo, methods=["GET", "POST"]) for c in ("/register", "/authorize", "/mcp", "/")])


def _client(app, adresse="203.0.113.7") -> httpx2.AsyncClient:
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app, client=(adresse, 1234)), base_url="http://t")


async def test_corps_borne_sur_les_points_oauth_et_sur_mcp():
    async with _client(GardeEntree(_app())) as http:
        assert (await http.post("/register", content=b"x" * (garde.TAILLE_CORPS_OAUTH + 1))).status_code == 413
        assert (await http.post("/register", content=b"x" * 1000)).status_code == 200
        assert (await http.post("/mcp", content=b"x" * (512 * 1024))).json() == {"taille": 512 * 1024}
        assert (await http.post("/mcp", content=b"x" * (garde.TAILLE_CORPS_MCP + 1))).status_code == 413
    assert garde.TAILLE_CORPS_MCP == 1024 * 1024


async def test_debit_oauth_par_adresse():
    instant = [0.0]
    app = GardeEntree(_app(), horloge=lambda: instant[0])
    async with _client(app) as http:
        codes = [(await http.get("/authorize")).status_code for _ in range(garde.DEBIT_OAUTH_PAR_MINUTE + 1)]
        assert codes[:-1] == [200] * garde.DEBIT_OAUTH_PAR_MINUTE
        refus = await http.get("/authorize")
        assert refus.status_code == 429 and refus.headers["retry-after"] == "60"
        assert (await http.get("/")).status_code == 200  # hors points OAuth : non limité
    async with _client(app, adresse="198.51.100.9") as autre:
        assert (await autre.get("/authorize")).status_code == 200  # une autre adresse passe
    instant[0] = 61
    async with _client(app) as http:
        assert (await http.get("/authorize")).status_code == 200


async def test_enregistrements_bornes_par_adresse():
    app = GardeEntree(_app())
    async with _client(app) as http:
        codes = [(await http.post("/register", json={})).status_code for _ in range(garde.ENREGISTREMENTS_PAR_ADRESSE_HEURE + 1)]
    assert codes.count(200) == garde.ENREGISTREMENTS_PAR_ADRESSE_HEURE and codes[-1] == 429


async def test_purge_horaire_de_l_etat():
    instant = [0.0]
    purges = []

    async def purger():
        purges.append(instant[0])

    app = GardeEntree(_app(), purger=purger, horloge=lambda: instant[0])
    async with _client(app) as http:
        await http.get("/")
        instant[0] = garde.INTERVALLE_PURGE_S + 1
        await http.get("/")
        await asyncio.sleep(0)
        await http.get("/")
    assert purges == [garde.INTERVALLE_PURGE_S + 1]


async def test_limites_relevees_pour_le_developpement():
    async with _client(GardeEntree(_app(), debit_par_minute=1000, enregistrements_par_heure=1000)) as http:
        statuts = {(await http.post("/register", content=b"{}")).status_code for _ in range(50)}
    assert statuts == {200}

# @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — le channel, la probabilité et le responsable se lisent sur le rattachement
#           (migration 0134, docs/SPEC-rattachements.md §3.2)
# @verifies CRM-119 (docs/BACKLOG.md) — tranche T3 : le connecteur MCP face aux droits fins, contre le vrai Keycloak, la
#           vraie base et le vrai service `mcp`, par le parcours OAuth réel
# @verifies docs/SPEC-permissions-rls.md §7.5 (M1 un droit qui rouvre, M2 un droit qui restreint, M3 la fraîcheur en
#           session ouverte, M4 l'administratrice jamais restreinte, M5 la recherche), §2.2 et §3.3 bis (« le plus
#           spécifique gagne ») ; docs/SPEC-mcp.md §1 (droit effectif = matrice ∩ CRM), §6.2 (sous le jeton de la personne,
#           refus uniforme) ; docs/SPEC-seed.md §2.11 (les quatre droits fins du seed)
"""Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré sinon.

Chaque preuve ouvre dans `mcp_droits`, par la clé de service, les seules cases qui manquaient, et les retire à la fin ; le
droit fin temporaire de M3 est retiré de même. Après chaque preuve, la clé de service constate que la matrice et les droits
fins sont ceux du seed."""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from .test_integration_oauth import ESPACE_SEEDE, FARIDA, MCP, _service, pytestmark  # noqa: F401
from .test_integration_recettes import DRISS, _attendre_visible, _dernier_journal, _jeton

CAMILLE = ("admin", "5eed0000-0000-4000-8000-000000000011")
PROSPECTION = "5eed0000-0000-4000-8000-000000000031"  # Conseil & IA ; `member` pour la lectrice, dont le track est `none`
GRANDS_COMPTES = "5eed0000-0000-4000-8000-000000000032"  # Conseil & IA ; aucun droit de channel
MAINTENANCE = "5eed0000-0000-4000-8000-000000000035"  # Studio web ; `viewer` pour le business developer
SOGEXIA = "5eed0000-0000-4000-8000-0000000000c2"  # « Migration ERP Sogexia », dans « Grands comptes »
MEUNIER = "5eed0000-0000-4000-8000-0000000000c5"  # « Support niveau 2 — Atelier Meunier », dans « Maintenance »
TITRE = "Affaire MCP droits fins"
REFUS = "Introuvable ou hors de votre périmètre"
AFFAIRES = [("affaires", a) for a in ("consulter", "ajouter", "modifier")]


async def _etat() -> tuple:
    """Ce que les preuves ne doivent pas laisser changé : la matrice des trois comptes et les droits fins de l'espace."""
    subs = ",".join(q[1] for q in (CAMILLE, DRISS, FARIDA))
    matrice = (await _service("GET", "/mcp_droits", params={
        "sub": f"in.({subs})", "workspace_id": f"eq.{ESPACE_SEEDE}", "select": "sub,famille,action", "order": "sub,famille,action",
    })).json()
    tracks = (await _service("GET", "/track_members", params={"select": "track_id,user_id,access", "order": "track_id,user_id"})).json()
    channels = (await _service("GET", "/channel_members", params={"select": "channel_id,user_id,access", "order": "channel_id,user_id"})).json()
    return matrice, tracks, channels


@pytest.fixture(autouse=True)
async def etat_du_seed_rendu():
    avant = await _etat()
    yield
    await _service("DELETE", "/cards", params={"title": f"like.{TITRE}*"})
    assert await _etat() == avant, "la preuve n'a pas rendu la matrice ou les droits fins du seed"


@asynccontextmanager
async def _cases(qui, cases):
    """Ouvre les cases qui manquent, et ne retire que celles-là : une case du seed reste posée."""
    deja = {(l["famille"], l["action"]) for l in (await _service("GET", "/mcp_droits", params={
        "sub": f"eq.{qui[1]}", "workspace_id": f"eq.{ESPACE_SEEDE}", "select": "famille,action",
    })).json()}
    ajoutees = [c for c in cases if c not in deja]
    if ajoutees:
        lignes = [{"sub": qui[1], "workspace_id": ESPACE_SEEDE, "famille": f, "action": a} for f, a in ajoutees]
        assert (await _service("POST", "/mcp_droits", json=lignes)).status_code == 201
    try:
        yield
    finally:
        for famille, action in ajoutees:
            await _service("DELETE", "/mcp_droits", params={
                "sub": f"eq.{qui[1]}", "workspace_id": f"eq.{ESPACE_SEEDE}", "famille": f"eq.{famille}", "action": f"eq.{action}",
            })


async def _refuse(client: Client, qui, outil: str, arguments: dict, *, uniforme: bool = True) -> None:
    """Refusé par le CRM malgré la matrice ouverte. Une affaire que la personne ne lit pas rend le refus uniforme ; une
    écriture sur une affaire qu'elle lit peut être nommée par la base (§9.3) : seul le journal est alors affirmé."""
    with pytest.raises(ToolError, match=REFUS if uniforme else None):
        await client.call_tool(outil, arguments)
    assert await _dernier_journal(qui[1]) == (outil, "refus_crm"), outil


async def _rend(client: Client, qui, outil: str, arguments: dict) -> dict:
    resultat = (await client.call_tool(outil, arguments)).structured_content
    assert await _dernier_journal(qui[1]) == (outil, "ok"), outil
    return resultat


async def _carte(ident: str) -> dict:
    return (await _service("GET", "/cards", params={"id": f"eq.{ident}", "select": "*"})).json()[0]


async def test_m1_un_droit_member_rouvre_en_ecriture_a_la_lectrice():
    """Farida est lectrice et son track « Conseil & IA » lui est fermé ; son `member` sur « Prospection » l'y fait lire et
    écrire par le connecteur. « Grands comptes », du même track et sans droit de channel, lui reste fermé."""
    async with _cases(FARIDA, AFFAIRES):
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_create")
            creee = (await _rend(client, FARIDA, "crm_card_create", {"channel_id": PROSPECTION, "title": f"{TITRE} rouverte"}))["card"]
            enBase = await _carte(creee["id"])
            # Depuis la migration 0134, le channel vit sur le rattachement (`CRM-111` T2.4.5).
            rattachement = (await _service("GET", "/card_placements", params={
                "card_id": f"eq.{creee['id']}", "select": "channel_id"})).json()
            assert (rattachement[0]["channel_id"], enBase["created_by"]) == (PROSPECTION, FARIDA[1])

            liste = await _rend(client, FARIDA, "crm_card_list", {"workspace": "p2enjoy", "channel_id": PROSPECTION, "limit": 100})
            assert creee["id"] in {c["id"] for c in liste["cards"]}
            assert (await _rend(client, FARIDA, "crm_card_get", {"card_id": creee["id"]}))["can_write"] is True

            await _refuse(client, FARIDA, "crm_card_create", {"channel_id": GRANDS_COMPTES, "title": f"{TITRE} fermée"})
    assert (await _service("GET", "/cards", params={"title": f"eq.{TITRE} fermée", "select": "id"})).json() == []


async def test_m2_un_droit_viewer_restreint_le_business_developer_en_lecture():
    """Driss écrit par son rôle ; son `viewer` sur « Maintenance » l'y laisse lire, et le connecteur n'y écrit rien."""
    avant = await _carte(MEUNIER)
    async with _cases(DRISS, AFFAIRES):
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_update")
            fiche = await _rend(client, DRISS, "crm_card_get", {"card_id": MEUNIER})
            assert fiche["can_write"] is False
            await _refuse(client, DRISS, "crm_card_update", {"card_id": MEUNIER, "title": f"{TITRE} restreinte"}, uniforme=False)
            await _refuse(client, DRISS, "crm_card_create", {"channel_id": MAINTENANCE, "title": f"{TITRE} restreinte"}, uniforme=False)
            # Contre-épreuve : la même écriture, sur un channel où son rôle décide, passe.
            ailleurs = await _rend(client, DRISS, "crm_card_get", {"card_id": SOGEXIA})
            assert ailleurs["can_write"] is True
    assert await _carte(MEUNIER) == avant
    assert (await _service("GET", "/cards", params={"title": f"like.{TITRE}*", "select": "id"})).json() == []


async def test_m3_un_droit_pose_pendant_la_session_s_applique_a_l_appel_suivant():
    """Une seule session MCP : le droit fin posé par la clé de service ferme l'affaire dès l'appel suivant, et son retrait
    la rouvre. Aucun cache du connecteur ne retient un droit fin."""
    droit = {"channel_id": f"eq.{GRANDS_COMPTES}", "user_id": f"eq.{DRISS[1]}"}
    assert (await _service("GET", "/channel_members", params=droit)).json() == [], "le seed ne pose aucun droit de Driss ici"
    async with _cases(DRISS, AFFAIRES):
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_get")
            assert (await _rend(client, DRISS, "crm_card_get", {"card_id": SOGEXIA}))["id"] == SOGEXIA
            pose = {"channel_id": GRANDS_COMPTES, "user_id": DRISS[1], "access": "none"}
            assert (await _service("POST", "/channel_members", json=pose)).status_code == 201
            try:
                await _refuse(client, DRISS, "crm_card_get", {"card_id": SOGEXIA})
                liste = await _rend(client, DRISS, "crm_card_list", {"workspace": "p2enjoy", "query": "Sogexia", "limit": 100})
                assert SOGEXIA not in {c["id"] for c in liste["cards"]}
            finally:
                await _service("DELETE", "/channel_members", params=droit)
            assert (await _rend(client, DRISS, "crm_card_get", {"card_id": SOGEXIA}))["id"] == SOGEXIA


async def test_m4_l_administratrice_n_est_jamais_restreinte():
    """Camille porte le même `none` que la lectrice sur « Conseil & IA », et lit pourtant Sogexia par le connecteur."""
    porte = (await _service("GET", "/track_members", params={"user_id": f"eq.{CAMILLE[1]}", "access": "eq.none", "select": "track_id"})).json()
    assert porte, "le seed pose un `none` sur un track de l'administratrice"
    async with _cases(CAMILLE, [("affaires", "consulter")]):
        async with Client(f"{MCP}/mcp", auth=await _jeton(CAMILLE)) as client:
            await _attendre_visible(client, "crm_card_get")
            fiche = await _rend(client, CAMILLE, "crm_card_get", {"card_id": SOGEXIA})
            assert fiche["id"] == SOGEXIA and fiche["can_write"] is True


async def test_m5_la_recherche_ne_rend_rien_de_ce_qu_un_droit_fin_ferme():
    """`crm_search` « Sogexia » : la lectrice ne reçoit pas l'affaire de « Grands comptes » ; le business developer, qui la
    lit, la reçoit — la recherche n'est donc pas vide par hasard."""
    async with _cases(FARIDA, [("affaires", "consulter")]), _cases(DRISS, [("affaires", "consulter")]):
        async with Client(f"{MCP}/mcp", auth=await _jeton(FARIDA)) as client:
            await _attendre_visible(client, "crm_card_get")
            trouve = await _rend(client, FARIDA, "crm_search", {"query": "Sogexia", "limit": 50})
            assert SOGEXIA not in {r["id"] for r in trouve["results"]}
        async with Client(f"{MCP}/mcp", auth=await _jeton(DRISS)) as client:
            await _attendre_visible(client, "crm_card_get")
            trouve = await _rend(client, DRISS, "crm_search", {"query": "Sogexia", "limit": 50})
            assert SOGEXIA in {r["id"] for r in trouve["results"]}

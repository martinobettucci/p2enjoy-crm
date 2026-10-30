# @verifies CRM-071 (docs/BACKLOG.md) — tranche T3 : `crm_view_list` dans les consultations de la famille `affaires` (révision)
# @spec CRM-102 (docs/BACKLOG.md) — tranche T3 : le parcours OAuth complet, contre la vraie pile de développement
# @verifies CRM-102 T3 — docs/SPEC-mcp.md §3.1 (flux : 401, métadonnées, enregistrement, consentement, SSO, retour,
#           échange), §3.3 (connexion longue : `offline_access` si et seulement si la case est cochée, et le
#           renouvellement qui survit à la fin de la session du SSO), §3.4 (adresses de retour restreintes), §4 (qui
#           entre : superadministratrice en base, `admin` LeLabs, un droit ; « Droits en attente » ; vérification
#           attendue ; aucun code sur un refus), §5 (la donnée lue sous la RLS), §7.1 (une ligne au journal), §11 (`/pret`)
# @verifies CRM-102 T6 — docs/SPEC-mcp.md §2.2 : le service en route redirige `/plateforme` et `/admin` vers la plateforme
#           de la webapp (`SITE_URL`), et son accueil porte le lien ; en direct comme à travers le Caddy de la cellule
# @verifies Modèle : `tests/test_integration_oauth.py` d'Evoliz (p2enjoy-evoliz, révision 80a3e27). Écarts : les comptes
#           du realm du CRM ; `sso.localhost` est le même dedans et dehors (décision 568), seule l'origine publique du
#           connecteur est réécrite ; le registre est lu en base par la clé de service.
# @verifies CRM-103 T3.b — le parcours vit dans `parcours_oauth.py`, partagé avec le seed ; « Droits en attente » se
#           prouve sur la lectrice, que le seed laisse sans matrice (docs/SPEC-seed.md §22.5)
"""Ce que fait un client MCP et son navigateur, en requêtes HTTP directes : enregistrement dynamique, autorisation
PKCE, consentement, connexion au vrai Keycloak, retour, échange du code, appels MCP.

Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré
sinon : la suite unitaire n'a besoin d'aucune pile.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
from fastmcp import Client

from crm_mcp.autorisation import VerificateurRole

from .parcours_oauth import (  # noqa: F401 — réexportés pour `test_integration_recettes.py`
    ADMIN_SSO,
    API,
    CAMILLE,
    CLE_SERVICE,
    CLIENT_SSO,
    DOMAINE,
    DRISS,
    EMETTEUR,
    ESPACE_SEEDE,
    EXPLOITANTE,
    FARIDA,
    MCP,
    MOT_DE_PASSE,
    ORIGINE,
    RETOUR_CLIENT,
    SABINE,
    SITE,
    SSO,
    _adresse,
    _formulaire,
    _interne,
    _jetons,
    _navigateur,
    _parcours,
    _service,
    _suivre,
)

#: Les sept consultations de la famille `affaires`, livrées par `CRM-104` T2.a (docs/SPEC-mcp.md §9.2 bis).
# Révisé par `CRM-068` T5 (décision 51) : la lecture de la checklist d'une affaire est une consultation de la famille
# (docs/SPEC-mcp.md §9.2 duodecies).
# Révisé par `CRM-071` T3 (décision 51) : la liste des vues sauvegardées d'un channel est une consultation de la famille
# (docs/SPEC-mcp.md §9.2 quattuordecies).
CONSULTATIONS_AFFAIRES = frozenset({
    "crm_card_list", "crm_card_get", "crm_card_timeline", "crm_card_comment_list", "crm_card_activity_list",
    "crm_stale_card_list", "crm_card_mine", "crm_card_checklist_list", "crm_view_list",
})

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("CRM_MCP_INTEGRATION") != "1", reason="exige la pile (scripts/verify-mcp.sh)"),
]


async def _espaces(jeton: str, *, outils_exacts: frozenset[str] | None = None) -> dict:
    """La liste des espaces, par un vrai client MCP. Les outils visibles suivent la matrice (D5) : un compte qui la
    franchit (superadministratrice, `admin` LeLabs) voit aussi ceux des familles livrées depuis (`recettes`,
    `CRM-108`), d'où l'inclusion ; l'égalité stricte n'est affirmée que pour un compte dont on connaît la matrice."""
    async with Client(f"{MCP}/mcp", auth=jeton) as client:
        visibles = {o.name for o in await client.list_tools()}
        assert "crm_workspace_list" in visibles
        if outils_exacts is not None:
            assert visibles == outils_exacts
        return (await client.call_tool("crm_workspace_list", {})).structured_content


async def _admin_sso(methode: str, chemin: str, **options) -> httpx2.Response:
    async with httpx2.AsyncClient(timeout=10) as http:
        jeton = (
            await http.post(
                f"{SSO}/realms/master/protocol/openid-connect/token",
                data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": ADMIN_SSO},
            )
        ).json()["access_token"]
        return await http.request(
            methode, f"{SSO}/admin/realms/lelabs{chemin}", headers={"Authorization": f"Bearer {jeton}"}, **options
        )


# --- Le connecteur se présente ------------------------------------------------------------------------------------------


async def test_sans_jeton_401_et_metadonnees():
    async with httpx2.AsyncClient() as http:
        reponse = await http.post(f"{MCP}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert reponse.status_code == 401
        assert f'resource_metadata="{ORIGINE}/.well-known/oauth-protected-resource/mcp"' in reponse.headers["www-authenticate"]
        ressource = (await http.get(f"{MCP}/.well-known/oauth-protected-resource/mcp")).json()
        assert ressource["resource"] == f"{ORIGINE}/mcp"
        serveur = (await http.get(f"{MCP}/.well-known/oauth-authorization-server")).json()
        assert serveur["issuer"].rstrip("/") == ORIGINE
        assert serveur["code_challenge_methods_supported"] == ["S256"]


async def test_pret_dit_sso_et_crm():
    async with httpx2.AsyncClient() as http:
        reponse = await http.get(f"{MCP}/pret")
    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["controles"] == {"sso": "ok", "crm": "ok"}


async def test_plateforme_et_admin_menent_a_la_webapp():
    async with httpx2.AsyncClient() as http:
        for chemin in ("/plateforme", "/admin"):
            reponse = await http.get(f"{MCP}{chemin}")
            assert (reponse.status_code, reponse.headers.get("location")) == (302, f"{SITE}/plateforme"), chemin
        accueil = (await http.get(f"{MCP}/")).text
    assert f'class="bouton bouton-secondaire" href="{SITE}/plateforme"' in accueil


async def test_adresse_de_retour_hors_liste_refusee():
    async with httpx2.AsyncClient() as http:
        reponse = await http.post(
            f"{MCP}/register",
            json={"client_name": "Redirecteur", "redirect_uris": ["https://malveillant.exemple.test/cb"],
                  "token_endpoint_auth_method": "none"},
        )
    assert reponse.status_code == 400, reponse.text


# --- Qui entre (§4) ---------------------------------------------------------------------------------------------------------


async def test_superadministratrice_entre_et_la_rls_reste_juge():
    """Sabine franchit la matrice, pas la RLS : membre d'aucun espace, elle n'en lit aucun (D7)."""
    reponse, contexte = await _parcours(SABINE)
    jetons = await _jetons(contexte, reponse)
    assert 0 < jetons["expires_in"] <= 300
    assert await _espaces(jetons["access_token"]) == {"total": 0, "offset": 0, "workspaces": []}
    journal = (await _service("GET", "/mcp_journal", params={"sub": f"eq.{SABINE[1]}", "order": "id.desc", "limit": "1"})).json()
    assert [(l["outil"], l["issue"]) for l in journal] == [("crm_workspace_list", "ok")]


async def test_admin_lelabs_entre_et_lit_tout_espace():
    reponse, contexte = await _parcours(EXPLOITANTE)
    espaces = await _espaces((await _jetons(contexte, reponse))["access_token"])
    seede = [e for e in espaces["workspaces"] if e["id"] == ESPACE_SEEDE]
    assert seede and seede[0]["rights"] == "all" and seede[0]["role"] is None


async def test_un_droit_suffit_pour_entrer_dans_la_matrice_et_la_rls():
    """Farida, vérifiée et sans droit, attend ; un droit sur l'espace seedé la fait entrer, et lui seul est rendu."""
    reponse, _ = await _parcours(FARIDA)
    assert reponse.status_code == 403 and "Droits en attente" in reponse.text
    droit = {"sub": FARIDA[1], "workspace_id": ESPACE_SEEDE, "famille": "affaires", "action": "consulter"}
    assert (await _service("POST", "/mcp_droits", json=droit)).status_code == 201
    try:
        reponse, contexte = await _parcours(FARIDA)
        # `affaires:consulter` seul : aucun outil d'une autre famille n'est montré (visibilité de D5). Depuis `CRM-104`
        # T2.a, les sept consultations de la famille le sont, et elles seules (docs/SPEC-mcp.md §9.2 bis) ; depuis T1, la
        # recherche aussi, outil de référence visible dès qu'un droit existe (§9.2 quater).
        espaces = await _espaces(
            (await _jetons(contexte, reponse))["access_token"],
            outils_exacts=frozenset({"crm_workspace_list", "crm_search", *CONSULTATIONS_AFFAIRES}),
        )
        assert [(e["slug"], e["role"], e["rights"]) for e in espaces["workspaces"]] == [
            ("p2enjoy", "viewer", ["affaires:consulter"])
        ]
    finally:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{FARIDA[1]}"})


@pytest.mark.parametrize(("qui", "titre"), [("viewer", "Droits en attente"), ("attendu", "Compte en attente de vérification")])
async def test_refus_page_d_attente_et_aucun_code(qui, titre):
    reponse, _ = await _parcours(qui)
    assert reponse.status_code == 403
    assert titre in reponse.text and _adresse(qui) in reponse.text
    assert "location" not in reponse.headers


async def test_adresse_non_prouvee_attend_sa_verification():
    """Le realm exige la vérification d'adresse : la preuve la lève le temps d'une connexion, comme celles de la
    session (e2e/api/session.spec.ts), puis la rétablit et efface l'action requise posée sur le compte."""
    adresse = _adresse("adresse-non-verifiee")
    [compte] = (await _admin_sso("GET", "/users", params={"email": adresse, "exact": "true"})).json()
    await _admin_sso("PUT", f"/users/{compte['id']}", json={"requiredActions": []})
    assert (await _admin_sso("PUT", "", json={"verifyEmail": False})).status_code == 204
    try:
        reponse, _ = await _parcours("adresse-non-verifiee")
        assert reponse.status_code == 403
        assert "Compte en attente de vérification" in reponse.text and "location" not in reponse.headers
    finally:
        await _admin_sso("PUT", "", json={"verifyEmail": True})
        await _admin_sso("PUT", f"/users/{compte['id']}", json={"requiredActions": []})


# --- Jetons refusés -------------------------------------------------------------------------------------------------------


async def _statut_mcp(jeton: str) -> int:
    async with httpx2.AsyncClient() as http:
        reponse = await http.post(
            f"{MCP}/mcp",
            headers={"Authorization": f"Bearer {jeton}", "Accept": "application/json, text/event-stream"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
    return reponse.status_code


async def test_jeton_forge_refuse():
    assert await _statut_mcp("eyJhbGciOiJIUzI1NiJ9.e30.forge") == 401


async def test_vrai_jeton_du_realm_pour_un_autre_client_refuse():
    """Un vrai jeton de Keycloak, émis pour `crm-audience-etrangere` (client public, PKCE) : `azp` le refuse."""
    verificateur_pkce = secrets.token_urlsafe(48)
    defi = base64.urlsafe_b64encode(hashlib.sha256(verificateur_pkce.encode()).digest()).rstrip(b"=").decode()
    retour = f"{SITE}/auth/retour"
    async with _navigateur() as navigateur:
        page = await navigateur.get(
            f"{EMETTEUR}/protocol/openid-connect/auth",
            params={"client_id": "crm-audience-etrangere", "response_type": "code", "scope": "openid", "redirect_uri": retour,
                    "code_challenge": defi, "code_challenge_method": "S256", "state": "x"},
        )
        action, champs = _formulaire(page.text, "kc-form-login")
        connexion = await navigateur.post(action, data={**champs, "username": _adresse(SABINE), "password": MOT_DE_PASSE})
        assert connexion.status_code == 302, connexion.text[:300]
        code = parse_qs(urlsplit(connexion.headers["location"]).query)["code"][0]
        jeton = (
            await navigateur.post(
                f"{EMETTEUR}/protocol/openid-connect/token",
                data={"grant_type": "authorization_code", "client_id": "crm-audience-etrangere", "code": code,
                      "redirect_uri": retour, "code_verifier": verificateur_pkce},
            )
        ).json()["access_token"]
    verificateur = VerificateurRole(
        jwks_uri=f"{EMETTEUR}/protocol/openid-connect/certs", emetteur=EMETTEUR, client_id=CLIENT_SSO
    )
    assert (await verificateur.examiner(jeton)).motif == "azp"
    assert await _statut_mcp(jeton) == 401


# --- Connexion longue (§3.3) ----------------------------------------------------------------------------------------------


async def _fermer_les_sessions_sso(sub: str) -> int:
    """Ce que fait l'expiration de la session du SSO après une longue pause : les sessions EN LIGNE disparaissent, une
    à une ; rend leur nombre. Pas `POST /users/{sub}/logout` : il pose aussi le `notBefore` de la personne, qui révoque
    les jetons hors ligne émis dans une seconde antérieure (« Stale token », mesuré avec une pause de 1,2 s) — la preuve
    ne passait que si connexion et fermeture tombaient dans la même seconde. Une expiration ne pose aucun `notBefore`.
    Avec `offline_access`, la session en ligne peut avoir déjà disparu : zéro est alors le cas réel."""
    sessions = await _admin_sso("GET", f"/users/{sub}/sessions")
    assert sessions.status_code == 200
    for session in sessions.json():
        assert (await _admin_sso("DELETE", f"/sessions/{session['id']}")).status_code == 204
    assert (await _admin_sso("GET", f"/users/{sub}/sessions")).json() == []
    return len(sessions.json())


@pytest.mark.parametrize("longue", [True, False])
async def test_connexion_longue_survit_a_la_fin_de_la_session_sso(longue):
    reponse, contexte = await _parcours(SABINE, connexion_longue=longue)
    portees = parse_qs(urlsplit(contexte["vers_sso"]).query)["scope"][0].split()
    assert ("offline_access" in portees) is longue
    jetons = await _jetons(contexte, reponse)
    fermees = await _fermer_les_sessions_sso(SABINE[1])
    # Sans connexion longue, la preuve n'a de sens que si une session en ligne existait et a pris fin.
    assert longue or fermees >= 1
    async with httpx2.AsyncClient() as http:
        renouvele = await http.post(
            f"{MCP}/token",
            data={"grant_type": "refresh_token", "refresh_token": jetons["refresh_token"], "client_id": contexte["client_id"]},
        )
    if longue:
        assert renouvele.status_code == 200, renouvele.text
        assert (await _espaces(renouvele.json()["access_token"]))["total"] == 0
    else:
        assert renouvele.status_code in (400, 401), "sans connexion longue, la fin de la session du SSO l'emporte"

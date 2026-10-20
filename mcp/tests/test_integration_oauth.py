# @spec CRM-102 (docs/BACKLOG.md) — tranche T3 : le parcours OAuth complet, contre la vraie pile de développement
# @verifies CRM-102 T3 — docs/SPEC-mcp.md §3.1 (flux : 401, métadonnées, enregistrement, consentement, SSO, retour,
#           échange), §3.3 (connexion longue : `offline_access` si et seulement si la case est cochée, et le
#           renouvellement qui survit à la fin de la session du SSO), §3.4 (adresses de retour restreintes), §4 (qui
#           entre : superadministratrice en base, `admin` LeLabs, un droit ; « Droits en attente » ; vérification
#           attendue ; aucun code sur un refus), §5 (la donnée lue sous la RLS), §7.1 (une ligne au journal), §11 (`/pret`)
# @verifies Modèle : `tests/test_integration_oauth.py` d'Evoliz (p2enjoy-evoliz, révision 80a3e27). Écarts : les comptes
#           du realm du CRM ; `sso.localhost` est le même dedans et dehors (décision 568), seule l'origine publique du
#           connecteur est réécrite ; le registre est lu en base par la clé de service.
"""Ce que fait un client MCP et son navigateur, en requêtes HTTP directes : enregistrement dynamique, autorisation
PKCE, consentement, connexion au vrai Keycloak, retour, échange du code, appels MCP.

Joué par `scripts/verify-mcp.sh` dans l'image `dev`, sur le réseau Compose (`CRM_MCP_INTEGRATION=1`) ; ignoré
sinon : la suite unitaire n'a besoin d'aucune pile.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
from html import unescape
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx2
import pytest
from fastmcp import Client

from crm_mcp.autorisation import VerificateurRole

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("CRM_MCP_INTEGRATION") != "1", reason="exige la pile (scripts/verify-mcp.sh)"),
]

MCP = os.environ.get("CRM_MCP_URL", "http://mcp:8080")
ORIGINE = os.environ.get("CRM_MCP_ORIGINE", "http://localhost:18490")
EMETTEUR = os.environ.get("SSO_OIDC_ISSUER", "http://sso.localhost:18480/realms/lelabs")
SSO = EMETTEUR.rsplit("/realms/", 1)[0]
CLIENT_SSO = os.environ.get("SSO_OIDC_CLIENT_ID", "lelabs-crm")
API = os.environ.get("SUPABASE_URL", "http://kong:8000")
CLE_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_SSO = os.environ.get("SSO_DEV_ADMIN_PASSWORD", "")
SITE = os.environ.get("SITE_URL", "http://127.0.0.1:5173")
DOMAINE = os.environ.get("DOMAINE", "p2enjoy.test")
#: Le mot de passe PUBLIÉ des comptes du realm de développement (keycloak/README.md) : pas un secret.
MOT_DE_PASSE = "SeedDev2026Local"
RETOUR_CLIENT = "http://127.0.0.1:9999/callback"

SABINE = ("plateforme", "5eed0000-0000-4000-8000-000000000018")
EXPLOITANTE = ("exploitante", "5eed0000-0000-4000-8000-000000000017")
DRISS = ("bizdev", "5eed0000-0000-4000-8000-000000000012")
ESPACE_SEEDE = "5eed0000-0000-4000-8000-000000000001"


class _TransportCommeUnNavigateur(httpx2.AsyncHTTPTransport):
    """Les cookies du realm sont `Secure` même en `http` ; un navigateur les rend sur `*.localhost`, un client HTTP
    non. La preuve ôte `Secure` des `Set-Cookie` reçus, dans ce réseau de développement seulement (décision 578, K2 ;
    même report à la main que `e2e/api/sso.ts`). Au transport : `httpx` recopie les cookies dans un bocal neuf à
    chaque requête, et une politique de bocal ne survivrait pas — mesuré."""

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        reponse = await super().handle_async_request(request)
        entetes = [
            (nom, re.sub(rb";\s*Secure(?=;|$)", b"", valeur, flags=re.I) if nom.lower() == b"set-cookie" else valeur)
            for nom, valeur in reponse.headers.raw
        ]
        return httpx2.Response(reponse.status_code, headers=entetes, stream=reponse.stream, extensions=reponse.extensions)


def _navigateur() -> httpx2.AsyncClient:
    return httpx2.AsyncClient(timeout=20, transport=_TransportCommeUnNavigateur())


def _adresse(qui: tuple[str, str] | str) -> str:
    return f"{qui[0] if isinstance(qui, tuple) else qui}@{DOMAINE}"


def _interne(url: str) -> str:
    """Le navigateur joint le connecteur par son origine publique ; depuis ce conteneur, c'est `mcp:8080`."""
    parties = urlsplit(url)
    if f"{parties.scheme}://{parties.netloc}" == ORIGINE:
        return urlunsplit(parties._replace(scheme=urlsplit(MCP).scheme, netloc=urlsplit(MCP).netloc))
    return url


async def _suivre(navigateur: httpx2.AsyncClient, reponse: httpx2.Response) -> httpx2.Response:
    """Suit les redirections jusqu'au retour vers le client MCP, qui n'est pas suivi."""
    while reponse.status_code in (301, 302, 303, 307):
        cible = reponse.headers["location"]
        if cible.startswith(RETOUR_CLIENT):
            return reponse
        if cible.startswith("/"):
            cible = str(reponse.url.copy_with(raw_path=cible.encode()))
        reponse = await navigateur.get(_interne(cible))
    return reponse


def _formulaire(html: str, identifiant: str) -> tuple[str, dict[str, str]]:
    bloc = re.search(rf'<form[^>]*id="{identifiant}"[^>]*>(.*?)</form>', html, flags=re.S)
    assert bloc, f"formulaire {identifiant!r} introuvable"
    action = re.search(r'action="([^"]*)"', re.search(r"<form[^>]*>", bloc.group(0)).group(0))
    # Comme un navigateur : une case non cochée ne part pas.
    champs = {
        m.group(1): unescape(m.group(2))
        for m in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', bloc.group(1))
        if 'type="checkbox"' not in m.group(0) or "checked" in m.group(0)
    }
    return unescape(action.group(1)) if action else "", champs


async def _parcours(qui: tuple[str, str] | str, *, connexion_longue: bool = False) -> tuple[httpx2.Response, dict[str, str]]:
    """Enregistre un client MCP, puis joue autorisation, consentement et connexion au SSO."""
    verificateur_pkce = secrets.token_urlsafe(48)
    defi = base64.urlsafe_b64encode(hashlib.sha256(verificateur_pkce.encode()).digest()).rstrip(b"=").decode()
    etat = secrets.token_urlsafe(16)
    async with _navigateur() as navigateur:
        inscription = await navigateur.post(
            f"{MCP}/register",
            json={
                "client_name": "Preuves d'intégration du CRM",
                "redirect_uris": [RETOUR_CLIENT],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",
            },
        )
        assert inscription.status_code in (200, 201), inscription.text
        client_id = inscription.json()["client_id"]

        reponse = await navigateur.get(
            f"{MCP}/authorize?"
            + urlencode(
                {
                    "response_type": "code",
                    "client_id": client_id,
                    "redirect_uri": RETOUR_CLIENT,
                    "code_challenge": defi,
                    "code_challenge_method": "S256",
                    "state": etat,
                    "resource": f"{ORIGINE}/mcp",
                }
            )
        )
        reponse = await _suivre(navigateur, reponse)
        assert reponse.status_code == 200 and "consentForm" in reponse.text, reponse.text[:500]
        assert 'src="https://gofastmcp' not in reponse.text, "la page de consentement ne charge rien d'un domaine tiers"
        _, champs = _formulaire(reponse.text, "consentForm")
        consentement = {**champs, "action": "approve"}
        if connexion_longue:
            consentement["connexion_longue"] = "oui"
        reponse = await navigateur.post(str(reponse.url), data=consentement)
        vers_sso = reponse.headers.get("location", "")
        reponse = await _suivre(navigateur, reponse)
        assert "kc-form-login" in reponse.text, reponse.text[:500]

        action, champs = _formulaire(reponse.text, "kc-form-login")
        reponse = await navigateur.post(action, data={**champs, "username": _adresse(qui), "password": MOT_DE_PASSE})
        reponse = await _suivre(navigateur, reponse)
        return reponse, {"client_id": client_id, "verificateur": verificateur_pkce, "etat": etat, "vers_sso": vers_sso}


async def _jetons(contexte: dict[str, str], reponse: httpx2.Response) -> dict:
    assert reponse.status_code == 302, reponse.text[:500]
    retour = parse_qs(urlsplit(reponse.headers["location"]).query)
    assert retour["state"] == [contexte["etat"]]
    async with httpx2.AsyncClient() as http:
        jetons = await http.post(
            f"{MCP}/token",
            data={
                "grant_type": "authorization_code",
                "code": retour["code"][0],
                "redirect_uri": RETOUR_CLIENT,
                "client_id": contexte["client_id"],
                "code_verifier": contexte["verificateur"],
            },
        )
    assert jetons.status_code == 200, jetons.text
    return jetons.json()


async def _espaces(jeton: str) -> dict:
    async with Client(f"{MCP}/mcp", auth=jeton) as client:
        assert {o.name for o in await client.list_tools()} == {"crm_workspace_list"}
        return (await client.call_tool("crm_workspace_list", {})).structured_content


async def _service(methode: str, chemin: str, **options) -> httpx2.Response:
    """Le registre, lu ou réglé en base sous la clé de service : jamais une donnée métier."""
    async with httpx2.AsyncClient(base_url=f"{API}/rest/v1", timeout=10) as http:
        return await http.request(
            methode, chemin, headers={"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}"}, **options
        )


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
    """Driss, vérifié et sans droit, attend ; un droit sur l'espace seedé le fait entrer, et lui seul est rendu."""
    reponse, _ = await _parcours(DRISS)
    assert reponse.status_code == 403 and "Droits en attente" in reponse.text
    droit = {"sub": DRISS[1], "workspace_id": ESPACE_SEEDE, "famille": "affaires", "action": "consulter"}
    assert (await _service("POST", "/mcp_droits", json=droit)).status_code == 201
    try:
        reponse, contexte = await _parcours(DRISS)
        espaces = await _espaces((await _jetons(contexte, reponse))["access_token"])
        assert [(e["slug"], e["role"], e["rights"]) for e in espaces["workspaces"]] == [
            ("p2enjoy", "business_developer", ["affaires:consulter"])
        ]
    finally:
        await _service("DELETE", "/mcp_droits", params={"sub": f"eq.{DRISS[1]}"})


@pytest.mark.parametrize(("qui", "titre"), [("admin", "Droits en attente"), ("attendu", "Compte en attente de vérification")])
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


async def _fermer_les_sessions_sso(sub: str) -> None:
    """Ce que fait l'expiration de la session du SSO après une longue pause."""
    assert (await _admin_sso("POST", f"/users/{sub}/logout")).status_code == 204


@pytest.mark.parametrize("longue", [True, False])
async def test_connexion_longue_survit_a_la_fin_de_la_session_sso(longue):
    reponse, contexte = await _parcours(SABINE, connexion_longue=longue)
    portees = parse_qs(urlsplit(contexte["vers_sso"]).query)["scope"][0].split()
    assert ("offline_access" in portees) is longue
    jetons = await _jetons(contexte, reponse)
    await _fermer_les_sessions_sso(SABINE[1])
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

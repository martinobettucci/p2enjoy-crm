# @spec CRM-103 (docs/BACKLOG.md) — tranche T3.b : le parcours OAuth d'un client MCP, partagé par les preuves
#       d'intégration et par le seed du connecteur (docs/SPEC-seed.md §22.2)
# @spec CRM-102 (docs/BACKLOG.md) — tranche T3 : extrait de `test_integration_oauth.py`, sans changement de conduite
# @spec docs/SPEC-mcp.md §3.1 (flux : enregistrement, autorisation, consentement, SSO, retour, échange), §3.4 (adresse de
#       retour), §12 (le seed par les vrais chemins) ; docs/SPEC-session-sso.md (décision 568 : `sso.localhost`)
"""Ce que fait un client MCP et son navigateur, en requêtes HTTP directes, contre la pile de développement.

Aucune dépendance de test : le seed le joue dans l'image du service `mcp`, qui n'a pas `pytest`. Les échecs sont des
`AssertionError` qui nomment l'étape.
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

MCP = os.environ.get("CRM_MCP_URL", "http://mcp:8080")
#: L'origine publique du connecteur : celle des preuves, ou celle du service quand le seed joue dans son image.
ORIGINE = os.environ.get("CRM_MCP_ORIGINE") or os.environ.get("CRM_MCP_ORIGINE_PUBLIQUE", "http://localhost:18490")
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
#: La lectrice, membre de l'espace seedé SANS matrice (docs/SPEC-seed.md §22) : le compte « en attente ».
FARIDA = ("viewer", "5eed0000-0000-4000-8000-000000000013")
#: L'administratrice de l'espace seedé, `recettes:consulter` seule au seed (docs/SPEC-seed.md §22).
CAMILLE = ("admin", "5eed0000-0000-4000-8000-000000000011")
#: Le business developer, et la matrice de démonstration de `CRM-108` (docs/SPEC-seed.md §21.4).
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


async def _service(methode: str, chemin: str, **options) -> httpx2.Response:
    """Le registre, lu ou réglé en base sous la clé de service : jamais une donnée métier."""
    async with httpx2.AsyncClient(base_url=f"{API}/rest/v1", timeout=10) as http:
        return await http.request(
            methode, chemin, headers={"apikey": CLE_SERVICE, "Authorization": f"Bearer {CLE_SERVICE}"}, **options
        )

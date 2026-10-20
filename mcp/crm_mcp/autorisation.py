# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le mandataire OAuth du connecteur, adossé au realm `lelabs`
# @spec docs/SPEC-mcp.md §3 (flux, client `lelabs-crm` réutilisé, connexion longue, clients acceptés, état chiffré),
#       §4 (qui entre : `verified` au retour, à l'échange et à chaque requête ; adresse vérifiée ; inscription ;
#       « Droits en attente ») ; docs/SSO.md (les deux règles du domaine) ; docs/JOURNAL.md décision 627 (D1, D3, D8)
# @spec Repris du connecteur Evoliz (p2enjoy-evoliz, `evoliz_mcp/autorisation.py`, révision 80a3e27, en production depuis
#       le 2026-10-06) : vérificateur, magasin chiffré, case « Stay signed in », contrôles au retour et à l'échange. Écarts :
#       registre asynchrone (PostgreSQL derrière la clé de service), adresse vérifiée exigée, rôle `admin` lu (il vaut
#       superadministrateur, arbitrage A1, là où Evoliz l'ignore).
"""Serveur d'autorisation MCP adossé au realm ``lelabs`` : plancher ``verified``.

Le mandataire (``MandataireLelabs``) présente aux clients MCP le serveur d'autorisation qu'ils attendent et délègue
l'authentification au realm avec le client confidentiel du CRM. Le plancher est vérifié à trois endroits :

1. au retour du SSO — page d'attente, aucun code émis ; c'est là que le compte s'inscrit au registre, que l'amorçage de
   la plateforme s'applique, et qu'un compte sans aucun droit reçoit « Droits en attente » ;
2. à l'échange du code — ``invalid_grant`` ;
3. à chaque requête — ``VerificateurRole``, sur le jeton Keycloak conservé.

Les points 1 et 2 surchargent des méthodes de ``OAuthProxy`` et lisent son magasin de codes : FastMCP est épinglé à la
version dont ces points ont été lus (docs/SPEC-mcp.md §14), et les tests d'intégration les éprouvent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from cryptography.fernet import Fernet
from fastmcp.server.auth import AccessToken
from fastmcp.server.auth.jwt_issuer import derive_jwt_key
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
from fastmcp.server.auth.providers.jwt import JWTVerifier
from key_value.aio.protocols import AsyncKeyValue
from key_value.aio.stores.filetree import (
    FileTreeStore,
    FileTreeV1CollectionSanitizationStrategy,
    FileTreeV1KeySanitizationStrategy,
)
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from mcp.server.auth.provider import AuthorizationCode, TokenError
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from crm_mcp import pages
from crm_mcp.jeton_interne import Identite
from crm_mcp.registre import Registre, RegistreIndisponible

journal = logging.getLogger("crm_mcp.autorisation")

#: Portées que le realm accepte de transmettre (docs/SSO.md) : rien au-delà.
PORTEES = ["openid", "profile", "email"]

#: Plancher du domaine lelabs : un compte sans ce rôle n'ouvre aucune application.
ROLE_PLANCHER = "verified"
#: Le rôle d'exploitation du domaine : il vaut superadministrateur de la plateforme (arbitrage A1).
ROLE_ADMIN = "admin"

#: Connexion longue : la case de la page de consentement, et la portée qu'elle ajoute à la demande faite au SSO.
CHAMP_CONNEXION_LONGUE = "connexion_longue"
PORTEE_HORS_LIGNE = "offline_access"
#: Durée du jeton de rafraîchissement remis au client quand le SSO n'en donne pas (jeton hors ligne) : le SSO reste
#: juge, ceci borne seulement l'état gardé.
DUREE_CONNEXION_LONGUE_S = 30 * 24 * 3600

#: La case, insérée dans le formulaire de consentement de FastMCP, en anglais comme le reste de la page (écart nommé au
#: design system, comme dans Evoliz). Décochée par défaut.
CASE_CONNEXION_LONGUE = f"""
            <div class="connexion-longue">
                <label for="{CHAMP_CONNEXION_LONGUE}">
                    <input type="checkbox" id="{CHAMP_CONNEXION_LONGUE}" name="{CHAMP_CONNEXION_LONGUE}" value="oui"
                        aria-describedby="{CHAMP_CONNEXION_LONGUE}-aide" />
                    <span>Stay signed in</span>
                </label>
                <p id="{CHAMP_CONNEXION_LONGUE}-aide">Keeps this assistant connected through breaks. It ends after a long
                inactivity, or when you revoke it from your lelabs account (Applications).</p>
            </div>
            <style>
                .connexion-longue {{ margin: 16px 0; text-align: left; }}
                .connexion-longue label {{ display: flex; gap: 8px; align-items: center; min-height: 40px;
                    cursor: pointer; font-weight: 600; }}
                .connexion-longue input {{ width: 24px; height: 24px; margin: 0; accent-color: #23468C; }}
                .connexion-longue input:focus-visible {{ outline: 2px solid #23468C; outline-offset: 2px; }}
                .connexion-longue p {{ margin: 0 0 0 32px; font-size: 13px; line-height: 1.5; color: #4B5563; }}
            </style>
"""
_GROUPE_BOUTONS = '<div class="button-group">'


def inserer_case_connexion_longue(page: str) -> str | None:
    """La page de consentement avec la case, ou None si sa forme a changé."""
    if page.count(_GROUPE_BOUTONS) != 1:
        return None
    return page.replace(_GROUPE_BOUTONS, CASE_CONNEXION_LONGUE + "            " + _GROUPE_BOUTONS)


def demander_hors_ligne(adresse: str) -> str:
    """L'adresse d'autorisation du SSO, avec ``offline_access`` dans ses portées."""
    parties = urlsplit(adresse)
    parametres = parse_qs(parties.query, keep_blank_values=True)
    portees = (parametres.get("scope") or [""])[0].split()
    if PORTEE_HORS_LIGNE not in portees:
        portees.append(PORTEE_HORS_LIGNE)
    parametres["scope"] = [" ".join(portees)]
    return urlunsplit(parties._replace(query=urlencode(parametres, doseq=True)))


def roles_de(revendications: dict[str, Any]) -> list[str]:
    """Rôles de realm portés par un jeton Keycloak (``realm_access.roles``) ; un rôle se teste par PRÉSENCE."""
    acces = revendications.get("realm_access")
    if not isinstance(acces, dict):
        return []
    roles = acces.get("roles")
    return [r for r in roles if isinstance(r, str)] if isinstance(roles, list) else []


def identite_de(jeton: AccessToken | None) -> Identite | None:
    """L'identité d'un jeton Keycloak vérifié ; None sans `sub`."""
    revendications = (jeton.claims or {}) if jeton else {}
    sujet = revendications.get("sub")
    if not isinstance(sujet, str) or not sujet:
        return None
    return Identite(
        sujet=sujet,
        courriel=revendications.get("email"),
        nom=revendications.get("name") or revendications.get("preferred_username"),
        courriel_verifie=revendications.get("email_verified") is True,
        admin_lelabs=ROLE_ADMIN in roles_de(revendications),
        expire_a=jeton.expires_at if jeton is not None else None,
    )


@dataclass(frozen=True)
class Verdict:
    """Issue de l'examen d'un jeton d'accès Keycloak."""

    jeton: AccessToken | None
    #: None si accepté ; sinon « jeton_invalide », « azp », « verification_absente ».
    motif: str | None

    @property
    def accepte(self) -> bool:
        return self.motif is None

    @property
    def identite(self) -> Identite | None:
        return identite_de(self.jeton)


class VerificateurRole(JWTVerifier):
    """Vérifie un jeton d'accès Keycloak ET la présence du plancher ``verified``.

    Signature contre les clés publiées (``jwks_uri``), ``iss`` exact, ``RS256`` seul (jamais un algorithme
    symétrique), ``exp``, ``azp`` égal au client du CRM, portée ``openid``, rôle ``verified``.
    """

    def __init__(
        self,
        *,
        emetteur: str,
        client_id: str,
        jwks_uri: str | None = None,
        cle_publique: str | None = None,
        base_url: str | None = None,
    ) -> None:
        # ``cle_publique`` ne sert qu'aux tests unitaires, qui signent leurs jetons localement.
        super().__init__(
            jwks_uri=jwks_uri,
            public_key=cle_publique,
            issuer=emetteur,
            algorithm="RS256",
            required_scopes=["openid"],
            base_url=base_url,
        )
        self.client_id = client_id

    async def examiner(self, jeton: str | None) -> Verdict:
        if not jeton:
            return Verdict(None, "jeton_invalide")
        valide = await super().load_access_token(jeton)
        if valide is None:
            return Verdict(None, "jeton_invalide")
        revendications = valide.claims or {}
        if revendications.get("azp") != self.client_id:
            return Verdict(valide, "azp")
        if ROLE_PLANCHER not in roles_de(revendications):
            return Verdict(valide, "verification_absente")
        return Verdict(valide, None)

    async def load_access_token(self, token: str) -> AccessToken | None:  # type: ignore[override]
        verdict = await self.examiner(token)
        if not verdict.accepte:
            journal.info("jeton_refuse", extra={"motif": verdict.motif})
            return None
        return verdict.jeton


@dataclass(frozen=True)
class Stockage:
    """État du mandataire : magasin chiffré, et son arbre de fichiers à purger."""

    chiffre: AsyncKeyValue
    arbre: FileTreeStore


def construire_stockage(dossier: Path, client_secret: str) -> Stockage:
    """Magasin de l'état OAuth : fichiers chiffrés (Fernet) sous ``dossier`` (docs/SPEC-mcp.md §3.4).

    Mêmes dérivations que le magasin par défaut de FastMCP (HKDF depuis le secret du client), construit ici pour garder
    la main sur l'arbre de fichiers : ses entrées expirées ne disparaissent que si on les purge (``garde.py``).
    """
    cle_jetons = derive_jwt_key(high_entropy_material=client_secret, salt="fastmcp-jwt-signing-key")
    cle_stockage = derive_jwt_key(high_entropy_material=cle_jetons.decode(), salt="fastmcp-storage-encryption-key")
    racine = dossier / "oauth"
    racine.mkdir(parents=True, exist_ok=True)
    arbre = FileTreeStore(
        data_directory=racine,
        key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(racine),
        collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(racine),
    )
    chiffre = FernetEncryptionWrapper(key_value=arbre, fernet=Fernet(key=cle_stockage), raise_on_decryption_error=False)
    return Stockage(chiffre=chiffre, arbre=arbre)


async def admettre(registre: Registre, verdict: Verdict) -> str | None:
    """Ce que le registre dit d'un compte vérifié qui revient du SSO (docs/SPEC-mcp.md §4).

    Rend ``None`` s'il entre ; « adresse_non_verifiee », « droits_absents » ou « registre_indisponible » sinon.
    """
    identite = verdict.identite
    if identite is None:
        return "jeton_invalide"
    if not identite.courriel or not identite.courriel_verifie:
        return "adresse_non_verifiee"
    try:
        etat = await registre.inscrire(identite)
    except RegistreIndisponible:
        journal.warning("registre_indisponible")
        return "registre_indisponible"
    return None if etat.peut_entrer else "droits_absents"


def _code_emis(reponse: Response) -> str | None:
    """Code d'autorisation porté par la redirection vers le client MCP, s'il y en a un."""
    if not isinstance(reponse, RedirectResponse):
        return None
    codes = parse_qs(urlsplit(reponse.headers.get("location", "")).query).get("code")
    return codes[0] if codes else None


class MandataireLelabs(OIDCProxy):
    """``OIDCProxy`` qui exige ``verified`` au retour du SSO et à l'échange du code, et n'émet de code qu'à un compte
    que le registre admet."""

    def __init__(
        self,
        *,
        decouverte: str,
        client_id: str,
        client_secret: str,
        origine: str,
        redirections_clients: list[str],
        registre: Registre,
        stockage: AsyncKeyValue | None = None,
    ) -> None:
        configuration = OIDCConfiguration.get_oidc_configuration(decouverte, strict=None, timeout_seconds=10)
        emetteur = str(configuration.issuer).rstrip("/")
        self.verificateur = VerificateurRole(
            jwks_uri=str(configuration.jwks_uri), emetteur=emetteur, client_id=client_id, base_url=origine
        )
        self.registre = registre
        self.compte_url = f"{emetteur}/account"
        super().__init__(
            config_url=decouverte,
            client_id=client_id,
            client_secret=client_secret,
            base_url=origine,
            token_verifier=self.verificateur,
            valid_scopes=PORTEES,
            # Le realm ne transmet que ces portées : on les demande exactement, quelles que soient celles du client MCP.
            extra_authorize_params={"scope": " ".join(PORTEES)},
            token_endpoint_auth_method="client_secret_basic",
            # Adresses de retour des clients MCP : boucle locale et clients connus seulement. Sans cette liste, le serveur
            # servirait de redirecteur ouvert (docs/SPEC-mcp.md §3.4).
            allowed_client_redirect_uris=redirections_clients,
            client_storage=stockage,
            require_authorization_consent=True,
            fallback_refresh_token_expiry_seconds=DUREE_CONNEXION_LONGUE_S,
        )
        #: Transactions dont le consentement a coché la connexion longue ; lues dans la même requête, puis oubliées.
        self._connexions_longues: set[str] = set()

    # --- Connexion longue (docs/SPEC-mcp.md §3.3) -------------------------------------------------------------------

    async def _show_consent_page(self, request: Request):  # type: ignore[override]
        reponse = await super()._show_consent_page(request)
        if not isinstance(reponse, HTMLResponse) or reponse.status_code != 200:
            return reponse
        page = inserer_case_connexion_longue(bytes(reponse.body).decode())
        if page is None:
            journal.warning("case_connexion_longue_absente")
            return reponse
        corps = page.encode()
        reponse.body = corps
        reponse.headers["content-length"] = str(len(corps))
        return reponse

    async def _submit_consent(self, request: Request):  # type: ignore[override]
        formulaire = await request.form()  # mis en cache : FastMCP le relit
        transaction = str(formulaire.get("txn_id", ""))
        longue = formulaire.get("action") == "approve" and formulaire.get(CHAMP_CONNEXION_LONGUE) == "oui" and transaction
        if longue:
            self._connexions_longues.add(transaction)
        try:
            return await super()._submit_consent(request)
        finally:
            self._connexions_longues.discard(transaction)

    def _build_upstream_authorize_url(self, txn_id: str, transaction: dict[str, Any]) -> str:  # type: ignore[override]
        adresse = super()._build_upstream_authorize_url(txn_id, transaction)
        if txn_id not in self._connexions_longues:
            return adresse
        journal.info("connexion_longue_demandee")
        return demander_hors_ligne(adresse)

    # --- Retour du SSO et échange du code (docs/SPEC-mcp.md §4) ---------------------------------------------------

    async def _handle_idp_callback(self, request: Request) -> HTMLResponse | RedirectResponse:
        reponse = await super()._handle_idp_callback(request)
        code = _code_emis(reponse)
        if code is None:
            return reponse
        modele = await self._code_store.get(key=code)
        jeton = (modele.idp_tokens or {}).get("access_token") if modele else None
        verdict = await self.verificateur.examiner(jeton)
        motif = verdict.motif
        if verdict.accepte:
            motif = await admettre(self.registre, verdict)
            if motif is None:
                journal.info("connexion_acceptee")
                return reponse
        await self._code_store.delete(key=code)
        journal.warning("connexion_refusee", extra={"motif": motif})
        courriel = verdict.identite.courriel if verdict.identite else None
        if motif in ("verification_absente", "adresse_non_verifiee"):
            html = pages.verification_attendue(courriel=courriel, compte_url=self.compte_url)
        elif motif == "droits_absents":
            html = pages.droits_en_attente(courriel=courriel)
        else:
            html = pages.erreur_connexion()
        return HTMLResponse(html, status_code=403)

    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode):  # type: ignore[override]
        modele = await self._code_store.get(key=authorization_code.code)
        if modele is not None:
            jeton = (modele.idp_tokens or {}).get("access_token")
            verdict = await self.verificateur.examiner(jeton)
            if not verdict.accepte:
                await self._code_store.delete(key=authorization_code.code)
                journal.warning("echange_refuse", extra={"motif": verdict.motif})
                raise TokenError("invalid_grant", f"Le rôle « {ROLE_PLANCHER} » du SSO lelabs est requis")
        return await super().exchange_authorization_code(client, authorization_code)

# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : la configuration du connecteur
# @spec docs/SPEC-mcp.md §10 (variables, formats, caractère obligatoire), §2.2 (adresses) ; docs/SPEC-plateforme.md §3
#       (la liste d'amorçage, normalisée comme par la fonction `session`)
# @spec CRM-102 tranche T6 — docs/SPEC-mcp.md §2.2, §10 : `SITE_URL` réutilisée, l'adresse de la plateforme de la webapp
"""Réglages lus dans l'environnement, une fois, au démarrage.

Le démarrage refuse une configuration incomplète en NOMMANT chaque variable manquante : un service qui partirait
avec un secret vide ouvrirait des sessions qu'il ne saurait pas vérifier.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

#: Adresses de retour acceptées par défaut : boucle locale (Claude Code, Claude Desktop, ChatGPT Desktop, VS Code…)
#: et les deux clients web connus (docs/SPEC-mcp.md §3.4).
REDIRECTIONS_PAR_DEFAUT = (
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
)

_ADRESSE = re.compile(r"^[^@\s]+@[^@\s]+$")


class ReglagesIncomplets(Exception):
    """Variables obligatoires absentes ou vides ; le message les nomme toutes."""

    def __init__(self, manquantes: list[str]) -> None:
        super().__init__("Variables d'environnement manquantes : " + ", ".join(manquantes))
        self.manquantes = manquantes


def liste_superadmins(valeur: str | None) -> tuple[str, ...]:
    """La liste d'amorçage : casse et espaces ignorés, doublons et entrées mal formées écartés — la même règle que
    `listeSuperadminsInitiaux` de la fonction `session` (docs/SPEC-plateforme.md §3)."""
    vues: list[str] = []
    for entree in (valeur or "").split(","):
        adresse = entree.strip().lower()
        if _ADRESSE.match(adresse) and adresse not in vues:
            vues.append(adresse)
    return tuple(vues)


def _entier(valeur: str | None, defaut: int) -> int:
    if valeur is None or valeur.strip() == "":
        return defaut
    nombre = int(valeur)
    if nombre <= 0:
        raise ValueError(f"entier strictement positif attendu, reçu {valeur!r}")
    return nombre


@dataclass(frozen=True)
class Reglages:
    origine_publique: str
    origine_webapp: str
    oidc_emetteur: str
    oidc_client_id: str
    oidc_client_secret: str
    jwt_secret: str
    api_crm: str
    cle_anonyme: str
    cle_service: str
    superadmins_initiaux: tuple[str, ...]
    redirections_clients: tuple[str, ...]
    taille_max_reponse: int
    debit_oauth_minute: int
    enregistrements_heure: int
    journal_niveau: str
    chemin_etat: Path
    port: int

    @property
    def decouverte(self) -> str:
        return f"{self.oidc_emetteur}/.well-known/openid-configuration"

    @property
    def url_mcp(self) -> str:
        return f"{self.origine_publique}/mcp"

    @property
    def url_plateforme(self) -> str:
        """L'administration du connecteur, dans la webapp (arbitrage A3, docs/SPEC-mcp.md §2.2)."""
        return f"{self.origine_webapp}/plateforme"

    @classmethod
    def depuis_environnement(cls, env: Mapping[str, str]) -> Reglages:
        obligatoires = {
            "CRM_MCP_ORIGINE_PUBLIQUE": env.get("CRM_MCP_ORIGINE_PUBLIQUE", "").strip().rstrip("/"),
            "SSO_OIDC_ISSUER": env.get("SSO_OIDC_ISSUER", "").strip().rstrip("/"),
            "SSO_OIDC_CLIENT_ID": env.get("SSO_OIDC_CLIENT_ID", "").strip(),
            "OIDC_CLIENT_SECRET": env.get("OIDC_CLIENT_SECRET", ""),
            "JWT_SECRET": env.get("JWT_SECRET", ""),
            "SUPABASE_URL": env.get("SUPABASE_URL", "").strip().rstrip("/"),
            "SUPABASE_ANON_KEY": env.get("SUPABASE_ANON_KEY", ""),
            "SUPABASE_SERVICE_ROLE_KEY": env.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            "SITE_URL": env.get("SITE_URL", "").strip().rstrip("/"),
        }
        manquantes = [nom for nom, valeur in obligatoires.items() if not valeur]
        if manquantes:
            raise ReglagesIncomplets(manquantes)
        redirections = tuple(
            motif.strip() for motif in env.get("CRM_MCP_REDIRECTIONS_CLIENTS", "").split(",") if motif.strip()
        )
        return cls(
            origine_publique=obligatoires["CRM_MCP_ORIGINE_PUBLIQUE"],
            origine_webapp=obligatoires["SITE_URL"],
            oidc_emetteur=obligatoires["SSO_OIDC_ISSUER"],
            oidc_client_id=obligatoires["SSO_OIDC_CLIENT_ID"],
            oidc_client_secret=obligatoires["OIDC_CLIENT_SECRET"],
            jwt_secret=obligatoires["JWT_SECRET"],
            api_crm=obligatoires["SUPABASE_URL"],
            cle_anonyme=obligatoires["SUPABASE_ANON_KEY"],
            cle_service=obligatoires["SUPABASE_SERVICE_ROLE_KEY"],
            superadmins_initiaux=liste_superadmins(env.get("CRM_SUPERADMINS_INITIAUX")),
            redirections_clients=redirections or REDIRECTIONS_PAR_DEFAUT,
            taille_max_reponse=_entier(env.get("CRM_MCP_TAILLE_MAX_REPONSE"), 200_000),
            debit_oauth_minute=_entier(env.get("CRM_MCP_DEBIT_OAUTH_MINUTE"), 60),
            enregistrements_heure=_entier(env.get("CRM_MCP_ENREGISTREMENTS_HEURE"), 20),
            journal_niveau=(env.get("CRM_MCP_JOURNAL_NIVEAU") or "info").strip().lower(),
            chemin_etat=Path(env.get("CRM_MCP_CHEMIN_ETAT") or "/var/lib/crm-mcp"),
            port=_entier(env.get("CRM_MCP_PORT"), 8080),
        )

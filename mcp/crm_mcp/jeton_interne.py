# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : le jeton interne du connecteur
# @spec docs/SPEC-mcp.md §5 (revendications, durée, aucune mise en cache) ; docs/SPEC-session-sso.md §5.4 (le jeton
#       interne de l'échangeur, dont celui-ci reprend la forme) ; docs/JOURNAL.md décision 627 (D2, compromis nommé :
#       une seconde entité détient `JWT_SECRET`)
"""Le jeton que le connecteur présente à PostgREST pour agir AU NOM de la personne.

Il porte le `sub` LeLabs : la RLS l'applique exactement comme à la webapp, et la matrice du connecteur ne peut donc
jamais ouvrir ce que le CRM ferme (arbitrage A2). Il vit 300 s au plus, jamais au-delà du jeton LeLabs vérifié dont
il dérive, et il ne quitte pas le service : il n'est ni journalisé, ni rendu au client MCP.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt

EMETTEUR = "p2enjoy-crm/mcp"
DUREE_MAX_S = 300


class JetonExpire(Exception):
    """Le jeton LeLabs dont dériverait le jeton interne est déjà échu."""


@dataclass(frozen=True)
class Identite:
    """Ce que le jeton LeLabs vérifié dit de la personne (docs/SPEC-mcp.md §4)."""

    sujet: str
    courriel: str | None
    nom: str | None
    courriel_verifie: bool
    admin_lelabs: bool
    expire_a: int | None


def frapper(secret: str, identite: Identite, maintenant: int) -> str:
    """Le jeton interne, HS256, signé par `JWT_SECRET` (docs/SPEC-mcp.md §5)."""
    echeance = maintenant + DUREE_MAX_S
    if identite.expire_a is not None:
        echeance = min(echeance, identite.expire_a)
    if echeance <= maintenant:
        raise JetonExpire()
    revendications: dict[str, object] = {
        "iss": EMETTEUR,
        "sub": identite.sujet,
        "role": "authenticated",
        "aud": "authenticated",
        "iat": maintenant,
        "exp": echeance,
        "canal": "mcp",
    }
    # Présente si et seulement si le jeton LeLabs porte `admin` : absente, elle ne dit rien (décision 597).
    if identite.admin_lelabs:
        revendications["lelabs_admin"] = True
    return jwt.encode(revendications, secret, algorithm="HS256")

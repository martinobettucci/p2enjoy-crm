# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : montages des tests unitaires du connecteur
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §5 (jeton interne accepté par PostgREST : HS256, `aud`, `role`), §6.3
#           (`mcp_autorise` sous le jeton de la personne), §7.2 et §7.3 (RPC du registre réservées à la clé de service)
"""Un CRM simulé, en mémoire, derrière un transport ASGI.

Il modèle le CONTRAT que le service attend de PostgREST, et seulement lui : clé de service pour le registre, jeton
interne vérifié pour la donnée, RLS « membre de l'espace » (tout espace pour `lelabs_admin`), refus `42501`. Le contrat
réel est prouvé par pgTAP (`0085_connecteur_mcp.test.sql`) et par l'intégration contre la vraie pile (tranche T3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx2
import jwt
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

SECRET = "secret-jwt-de-test-assez-long-pour-hs256-000000"
CLE_ANONYME = "cle-anonyme-de-test"
CLE_SERVICE = "cle-service-de-test"

ESPACE_A = "a0000000-0000-4000-8000-00000000000a"
ESPACE_B = "b0000000-0000-4000-8000-00000000000b"
TRACK_A = "a0000000-0000-4000-8000-0000000000a1"
TRACK_B = "b0000000-0000-4000-8000-0000000000b1"
BUDGET_A = "a0000000-0000-4000-8000-0000000000a2"

ENV_COMPLET = {
    "CRM_MCP_ORIGINE_PUBLIQUE": "https://crm.mcp.exemple.test/",
    "SSO_OIDC_ISSUER": "https://sso.exemple.test/realms/lelabs/",
    "SSO_OIDC_CLIENT_ID": "lelabs-crm",
    "OIDC_CLIENT_SECRET": "secret-client-de-test",
    "JWT_SECRET": SECRET,
    "SUPABASE_URL": "http://kong:8000/",
    "SUPABASE_ANON_KEY": CLE_ANONYME,
    "SUPABASE_SERVICE_ROLE_KEY": CLE_SERVICE,
}


@dataclass
class CrmSimule:
    espaces: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"id": ESPACE_A, "slug": "atelier", "name": "Atelier"},
            {"id": ESPACE_B, "slug": "bureau", "name": "Bureau"},
        ]
    )
    #: sub → {espace: rôle}
    membres: dict[str, dict[str, str]] = field(default_factory=dict)
    comptes: dict[str, dict[str, Any]] = field(default_factory=dict)
    superadmins: set[str] = field(default_factory=set)
    droits: set[tuple[str, str, str, str]] = field(default_factory=set)
    journal: list[dict[str, Any]] = field(default_factory=list)
    jetons: list[dict[str, Any]] = field(default_factory=list)
    indisponible: bool = False

    def tracks(self) -> list[dict[str, Any]]:
        return [{"id": TRACK_A, "workspace_id": ESPACE_A}, {"id": TRACK_B, "workspace_id": ESPACE_B}]

    def budgets(self) -> list[dict[str, Any]]:
        return [{"id": BUDGET_A, "track": {"workspace_id": ESPACE_A}}]

    # --- Identités ----------------------------------------------------------------------------------------------

    def _service(self, requete: Request) -> bool:
        return requete.headers.get("authorization") == f"Bearer {CLE_SERVICE}" and requete.headers.get("apikey") == CLE_SERVICE

    def _personne(self, requete: Request) -> dict[str, Any] | None:
        if requete.headers.get("apikey") != CLE_ANONYME:
            return None
        jeton = requete.headers.get("authorization", "").removeprefix("Bearer ")
        try:
            revendications = jwt.decode(jeton, SECRET, algorithms=["HS256"], audience="authenticated")
        except jwt.PyJWTError:
            return None
        if revendications.get("role") != "authenticated":
            return None
        self.jetons.append(revendications)
        return revendications

    def _lisibles(self, personne: dict[str, Any]) -> set[str]:
        if personne.get("lelabs_admin") is True:
            return {e["id"] for e in self.espaces}
        return set(self.membres.get(personne["sub"], {}))

    # --- Points ---------------------------------------------------------------------------------------------------

    async def racine(self, requete: Request) -> Response:
        # Comme le vrai Kong : la racine de l'API est refusée à la clé anonyme (mesuré le 2026-10-20).
        return JSONResponse({"message": "forbidden"}, status_code=403)

    async def catalogue(self, requete: Request) -> Response:
        if requete.headers.get("apikey") != CLE_ANONYME:
            return JSONResponse({"message": "clé absente"}, status_code=401)
        return JSONResponse([], status_code=503 if self.indisponible else 200)

    async def rpc(self, requete: Request) -> Response:
        if self.indisponible:
            return JSONResponse({"message": "indisponible"}, status_code=503)
        fonction = requete.path_params["fonction"]
        corps = await requete.json()
        if fonction in ("mcp_inscrire_compte", "mcp_etat_compte", "mcp_journaliser"):
            if not self._service(requete):
                return JSONResponse({"code": "42501", "message": "permission denied"}, status_code=403)
            return getattr(self, f"_{fonction}")(corps)
        if fonction == "mcp_autorise":
            personne = self._personne(requete)
            if personne is None:
                return JSONResponse({"code": "PGRST301", "message": "JWT invalide"}, status_code=401)
            sub = personne["sub"]
            ouvert = (
                personne.get("lelabs_admin") is True
                or sub in self.superadmins
                or (sub, corps["p_ws"], corps["p_famille"], corps["p_action"]) in self.droits
            )
            return JSONResponse(ouvert)
        return JSONResponse({"message": "fonction inconnue"}, status_code=404)

    def _etat(self, sub: str, admin: bool) -> dict[str, Any]:
        return {
            "superadmin": admin or sub in self.superadmins,
            "droits": [{"workspace_id": w, "famille": f, "action": a} for s, w, f, a in sorted(self.droits) if s == sub],
        }

    def _mcp_inscrire_compte(self, corps: dict[str, Any]) -> Response:
        sub = corps["p_sub"]
        self.comptes.setdefault(sub, {"inscriptions": 0})
        self.comptes[sub].update(email=corps["p_email"], nom=corps["p_nom"])
        self.comptes[sub]["inscriptions"] += 1
        if not self.superadmins and (corps["p_email"] or "").lower() in corps["p_superadmins_initiaux"]:
            self.superadmins.add(sub)
        etat = self._etat(sub, corps["p_admin_lelabs"])
        return JSONResponse({"superadmin": etat["superadmin"], "droits": len(etat["droits"])})

    def _mcp_etat_compte(self, corps: dict[str, Any]) -> Response:
        return JSONResponse(self._etat(corps["p_sub"], corps["p_admin_lelabs"]))

    def _mcp_journaliser(self, corps: dict[str, Any]) -> Response:
        self.journal.append(corps)
        return Response(status_code=204)

    async def table(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"code": "PGRST301", "message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        filtres = {k: v.removeprefix("eq.") for k, v in requete.query_params.items() if v.startswith("eq.")}
        if nom == "workspaces":
            lignes = [e for e in self.espaces if e["id"] in lisibles]
        elif nom == "workspace_members":
            lignes = [
                {"workspace_id": w, "role": r, "user_id": s}
                for s, roles in self.membres.items()
                for w, r in roles.items()
                if w in lisibles
            ]
        elif nom == "tracks":
            lignes = [t for t in self.tracks() if t["workspace_id"] in lisibles]
        elif nom == "budgets":
            lignes = [b for b in self.budgets() if b["track"]["workspace_id"] in lisibles]
        else:
            return JSONResponse({"message": "table inconnue"}, status_code=404)
        lignes = [l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items())]
        selection = requete.query_params.get("select", "")
        if nom == "workspace_members":
            lignes = [{k: l[k] for k in ("workspace_id", "role")} for l in lignes]
        elif selection and "(" not in selection:
            lignes = [{k: l[k] for k in selection.split(",") if k in l} for l in lignes]
        return JSONResponse(lignes)

    def application(self) -> Starlette:
        return Starlette(
            routes=[
                Route("/rest/v1/", self.racine, methods=["GET"]),
                Route("/rest/v1/workflow_nodes_catalog", self.catalogue, methods=["GET"]),
                Route("/rest/v1/rpc/{fonction}", self.rpc, methods=["POST"]),
                Route("/rest/v1/{table}", self.table, methods=["GET"]),
            ]
        )


@pytest.fixture
def crm_simule() -> CrmSimule:
    return CrmSimule()


@pytest.fixture
def transport_crm(crm_simule: CrmSimule) -> httpx2.ASGITransport:
    return httpx2.ASGITransport(app=crm_simule.application())


@pytest.fixture
def env_complet() -> dict[str, str]:
    return dict(ENV_COMPLET)

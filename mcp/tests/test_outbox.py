# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-144 (docs/BACKLOG.md) — tranche T4 : les trois outils de l'outbox — leur déclaration (famille `messagerie`,
#           `consulter` pour lire, `modifier` pour annuler et réessayer, ancre `outbox`, `destructiveHint` sur l'annulation),
#           la liste par boîte sous la RLS (jamais le corps, le motif en code et en phrase, `cancellable` et `retryable`
#           tirés de la capacité rendue par la base, l'issue incertaine dite), les deux appels à la base et leurs refus
#           nommés, le refus uniforme d'un envoi illisible sans appel
# @verifies docs/SPEC-mcp.md §9.2 undevicies, §9.1 ; docs/SPEC-mail-subsystem.md §28.3, §28.4, §28.7 ; décision 906
"""Le CRM simulé rend quatre envois d'un espace — en file, en file à l'issue incertaine, parti, en échec — et les deux
fonctions de la base ; la vraie base est éprouvée par `tests/test_integration_outbox.py`."""

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
from crm_mcp.outils import outbox, reference
from crm_mcp.outils.outbox import MOTIFS, erreur_de, envoi_lu
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
CARD = "a0000000-0000-4000-8000-0000000000c1"
EN_FILE = "a0000000-0000-4000-8000-0000000000a1"
INCERTAIN = "a0000000-0000-4000-8000-0000000000a2"
PARTI = "a0000000-0000-4000-8000-0000000000a3"
ECHEC = "a0000000-0000-4000-8000-0000000000a4"
OUTILS = {"crm_mail_outbox_list", "crm_mail_outbox_cancel", "crm_mail_outbox_retry"}


def envoi(identifiant: str, statut: str, motif: str | None = None, permis: bool = True) -> dict[str, Any]:
    return {
        "id": identifiant, "workspace_id": ESPACE_A, "status": statut, "card_id": CARD, "to_addrs": ["client@exemple.test"],
        "cc_addrs": None, "subject": f"Envoi {statut}", "from_address": "thomas@atelier.test",
        "next_attempt_at": "2026-11-10T10:00:00Z", "sent_at": None, "attempts": 1 if motif else 0, "last_error": motif,
        "outbox_gestes_permis": permis, "card": {"title": "Refonte"}, "author": {"full_name": "Thomas"},
        # Ce que la base porte et que le connecteur ne rend JAMAIS au modèle.
        "body_text": "corps confidentiel",
    }


class CrmOutbox(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.lectures: list[dict[str, str]] = []
        self.appels: list[tuple[str, dict[str, Any]]] = []
        self.refus: tuple[int, Any] | None = None
        self.envois = [
            envoi(EN_FILE, "queued", "timeout"),
            envoi(INCERTAIN, "queued", "worker_interrompu"),
            envoi(PARTI, "sent"),
            envoi(ECHEC, "failed", "auth_failed", permis=False),
        ]

    async def table_outbox(self, requete: Request) -> Response:
        nom = requete.path_params["table"]
        if nom not in ("mail_outbox", "cards"):
            return await self.table(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        if nom == "cards":
            return JSONResponse([{"id": CARD, "workspace_id": ESPACE_A}])
        self.lectures.append(parametres)
        lignes = self.envois
        statuts = parametres.get("status", "")
        if statuts.startswith("in.("):
            permis = statuts.removeprefix("in.(").removesuffix(")").split(",")
            lignes = [l for l in lignes if l["status"] in permis]
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    async def rpc_outbox(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction not in ("cancel_outbound_email", "retry_outbound_email"):
            return await self.rpc(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        corps = await requete.json()
        self.appels.append((fonction, corps))
        if self.refus is not None:
            return JSONResponse(self.refus[1], status_code=self.refus[0])
        if fonction == "cancel_outbound_email":
            return JSONResponse("2026-11-10T12:00:00+00:00")
        for ligne in self.envois:
            if ligne["id"] == corps["p_outbox_id"]:
                ligne["status"] = "queued"
        return JSONResponse(corps["p_outbox_id"])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_outbox, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_outbox, methods=["GET"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmOutbox()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        outbox.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", a) for a in ("consulter", "modifier")}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "affaires", "consulter")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content

    async def outils(self) -> dict[str, Any]:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name: o for o in await client.list_tools()}


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


def test_les_trois_outils_sont_declares_dans_la_famille_messagerie(monde: Monde) -> None:
    declares = monde.moteur.declarations
    assert OUTILS <= set(declares)
    assert (declares["crm_mail_outbox_list"].famille, declares["crm_mail_outbox_list"].action) == ("messagerie", "consulter")
    assert declares["crm_mail_outbox_list"].espace == "workspace:workspace"
    assert declares["crm_mail_outbox_list"].autres == ("card:card_id",)
    for nom in ("crm_mail_outbox_cancel", "crm_mail_outbox_retry"):
        assert (declares[nom].famille, declares[nom].action, declares[nom].espace) == ("messagerie", "modifier", "outbox:outbox_id")


async def test_annuler_porte_destructivehint_et_lire_est_en_lecture_seule(monde: Monde) -> None:
    outils = await monde.outils()
    assert OUTILS <= set(outils)
    assert outils["crm_mail_outbox_cancel"].annotations.destructive_hint is True
    assert outils["crm_mail_outbox_list"].annotations.read_only_hint is True
    assert outils["crm_mail_outbox_retry"].annotations.destructive_hint is not True


async def test_sans_la_case_modifier_seule_la_lecture_est_offerte(monde: Monde) -> None:
    monde.simule.droits -= {("sujet-thomas", ESPACE_A, "messagerie", "modifier")}
    outils = await monde.outils()
    assert "crm_mail_outbox_list" in outils
    assert "crm_mail_outbox_cancel" not in outils
    assert "crm_mail_outbox_retry" not in outils


async def test_la_boite_en_file_rend_queued_et_sending_sans_corps(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_outbox_list", {"workspace": ESPACE_A, "box": "queued"})
    lecture = monde.simule.lectures[-1]
    assert lecture["status"] == "in.(queued,sending)"
    assert lecture["workspace_id"] == f"eq.{ESPACE_A}"
    assert lecture["order"].startswith("next_attempt_at.asc")
    assert "body_text" not in lecture["select"]
    assert [e["id"] for e in rendu["sends"]] == [EN_FILE, INCERTAIN]
    premier, incertain = rendu["sends"]
    assert "body_text" not in premier and "body" not in premier
    assert premier["error"] == {"code": "timeout", "text": MOTIFS["timeout"]}
    assert premier["cancellable"] is True and premier["retryable"] is False
    # L'ISSUE INCERTAINE (décision 906, Q3) : jamais « cancellable », et la phrase est dite au modèle.
    assert incertain["cancellable"] is False
    assert "may have been sent" in incertain["note"]
    assert rendu["has_more"] is False


async def test_la_boite_des_echecs_et_le_droit_rendu_par_la_base(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_outbox_list", {"workspace": ESPACE_A, "box": "failed", "card_id": CARD})
    assert monde.simule.lectures[-1]["card_id"] == f"eq.{CARD}"
    [echec] = rendu["sends"]
    # La base rend `outbox_gestes_permis` faux : ni annulable ni réessayable pour Thomas.
    assert echec["retryable"] is False and echec["cancellable"] is False
    assert echec["error"]["text"] == MOTIFS["auth_failed"]


def test_un_motif_inconnu_n_est_jamais_devine_et_une_capacite_absente_n_ouvre_rien() -> None:
    assert erreur_de("smtp_421") == {"code": "smtp_421", "text": "unrecognised cause"}
    assert erreur_de(None) is None
    sans_capacite = envoi(EN_FILE, "queued")
    del sans_capacite["outbox_gestes_permis"]
    assert envoi_lu(sans_capacite)["cancellable"] is False


async def test_annuler_passe_par_la_base_et_rend_la_date(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_outbox_cancel", {"outbox_id": EN_FILE})
    assert rendu == {"outbox_id": EN_FILE, "status": "cancelled", "cancelled_at": "2026-11-10T12:00:00+00:00"}
    assert monde.simule.appels == [("cancel_outbound_email", {"p_outbox_id": EN_FILE})]


async def test_reessayer_passe_par_la_base_et_rend_l_etat_relu(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_outbox_retry", {"outbox_id": ECHEC})
    assert monde.simule.appels == [("retry_outbound_email", {"p_outbox_id": ECHEC})]
    assert rendu == {"outbox_id": ECHEC, "status": "queued", "next_attempt_at": "2026-11-10T10:00:00Z"}


@pytest.mark.parametrize(
    ("statut", "code", "attendu"),
    [
        (409, "outbox_sending", "being sent right now"),
        (409, "outbox_sent", "already been sent"),
        (409, "outbox_uncertain", "may have been sent"),
        (409, "outbox_cancelled", "already been cancelled"),
        (403, "forbidden", "only the author"),
        (400, "card_not_available", "archived, in the trash"),
        (409, "quota_exceeded", "daily sending quota"),
    ],
)
async def test_les_refus_de_la_base_sont_nommes(monde: Monde, statut: int, code: str, attendu: str) -> None:
    monde.simule.refus = (statut, {"code": "P0002", "message": code})
    with pytest.raises(ToolError, match=f"Refusé par le CRM : {code} — .*{attendu}"):
        await monde.appel("crm_mail_outbox_cancel", {"outbox_id": EN_FILE})


async def test_un_envoi_disparu_apres_l_ancre_est_le_refus_uniforme(monde: Monde) -> None:
    monde.simule.refus = (404, {"code": "P0002", "message": "outbox_not_found"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : envoi"):
        await monde.appel("crm_mail_outbox_retry", {"outbox_id": ECHEC})


async def test_un_envoi_illisible_est_le_refus_uniforme_sans_appel(monde: Monde) -> None:
    monde.simule.envois = []
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : envoi"):
        await monde.appel("crm_mail_outbox_cancel", {"outbox_id": EN_FILE})
    assert monde.simule.appels == []

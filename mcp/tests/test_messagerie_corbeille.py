# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-138 (docs/BACKLOG.md) — tranche T4 : les cinq outils — leur déclaration (famille `messagerie`, `modifier`,
#           `supprimer` avec `destructiveHint`, `consulter` en lecture seule, l'ancre `trashed_message` résolue par une
#           fonction de la base), la clé de fil miroir de `app.cle_fil`, les appels envoyés à la base, les refus nommés, la
#           corbeille sans corps et l'état du déplacement en code et en phrase
# @verifies docs/SPEC-mcp.md §9.2 (CRM-138), §9.1 ; docs/SPEC-mail-subsystem.md §29.3 à §29.5, §29.8 précisé ;
#           docs/SPEC-cards.md §16.14.2
"""Le CRM simulé rend un message vivant et un message effacé d'un espace, et les fonctions de la base ; la vraie base est
éprouvée par `tests/test_integration_messagerie_corbeille.py`."""

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
from crm_mcp.outils import messagerie_corbeille, reference
from crm_mcp.outils.messagerie_corbeille import MOTIFS_DEPLACEMENT, cle_de_fil, deplacement_lu, message_en_corbeille
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
VIVANT = "b0000000-0000-4000-8000-0000000000b1"
EFFACE = "b0000000-0000-4000-8000-0000000000b2"
INCONNU = "b0000000-0000-4000-8000-0000000000b9"
OUTILS = {"crm_mail_set_read", "crm_mail_snooze", "crm_mail_delete", "crm_mail_restore", "crm_mail_trash_list"}

CORBEILLE = [
    {
        "message_id": EFFACE, "subject": "Devis", "from_address": "client@exemple.test", "from_name": "Client",
        "card_id": None, "deleted_at": "2026-11-11T09:00:00Z", "deleted_by": "x", "deleted_by_name": "Thomas",
        "purge_at": "2026-12-11T09:00:00Z", "can_restore": True, "moves_pending": 0, "moves_done": 0, "moves_failed": 1,
        "last_move_error": "no_trash_folder",
        # Ce que la base pourrait porter et que le connecteur ne rend JAMAIS au modèle.
        "body_text": "corps confidentiel",
    }
]


#: Les fonctions de la base que ce CRM simulé sert ; les autres (matrice, registre) sont celles du simulateur commun.
FONCTIONS = {
    "trashed_message_workspace", "trash_retention_days", "mark_messages_read", "mark_message_unread", "snooze_thread",
    "wake_thread", "delete_message", "restore_message", "trashed_messages",
}


class CrmCorbeille(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.appels: list[tuple[str, dict[str, Any]]] = []
        self.refus: tuple[int, Any] | None = None
        self.message = {
            "id": VIVANT, "workspace_id": ESPACE_A, "references_ids": ["<racine@exemple.test>", "<suite@exemple.test>"],
            "rfc822_message_id": "<propre@exemple.test>",
        }

    async def table_messages(self, requete: Request) -> Response:
        if requete.path_params["table"] != "mail_messages":
            return await self.table(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        # La politique de lecture : seul le message vivant se lit ; l'effacé n'est rendu à personne.
        if requete.query_params.get("id") == f"eq.{VIVANT}":
            selection = requete.query_params.get("select", "").split(",")
            return JSONResponse([{k: v for k, v in self.message.items() if k in selection}])
        return JSONResponse([])

    async def rpc_messages(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction not in FONCTIONS:
            return await self.rpc(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        corps = await requete.json()
        if fonction == "trashed_message_workspace":
            # L'ANCRE `trashed_message` : l'espace d'un message de la corbeille visible, rien sinon (migration 0182).
            return JSONResponse(ESPACE_A if corps["p_message_id"] == EFFACE else None)
        if fonction == "trash_retention_days":
            return JSONResponse(30)
        self.appels.append((fonction, corps))
        if self.refus is not None:
            return JSONResponse(self.refus[1], status_code=self.refus[0])
        rendus: dict[str, Any] = {
            "mark_messages_read": 1,
            "mark_message_unread": True,
            "snooze_thread": {"workspace_id": ESPACE_A, "thread_key": "x", "snoozed_until": "2026-12-01T09:00:00+00:00"},
            "wake_thread": True,
            "delete_message": {"message_id": VIVANT, "deleted_at": "2026-11-11T10:00:00+00:00", "mailbox_moves": 1},
            "restore_message": {"message_id": EFFACE, "cancelled_moves": 0},
            "trashed_messages": CORBEILLE,
        }
        return JSONResponse(rendus[fonction])

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_messages, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_messages, methods=["GET"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmCorbeille()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        messagerie_corbeille.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {
            ("sujet-thomas", ESPACE_A, "messagerie", a) for a in ("consulter", "modifier", "supprimer")
        }

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


def test_les_cinq_outils_sont_declares_dans_la_famille_messagerie(monde: Monde) -> None:
    d = monde.moteur.declarations
    assert OUTILS <= set(d)
    attendus = {
        "crm_mail_set_read": ("modifier", "message:message_id"),
        "crm_mail_snooze": ("modifier", "message:message_id"),
        "crm_mail_delete": ("supprimer", "message:message_id"),
        "crm_mail_restore": ("modifier", "trashed_message:message_id"),
        "crm_mail_trash_list": ("consulter", "workspace:workspace"),
    }
    for nom, (action, ancre) in attendus.items():
        assert (d[nom].famille, d[nom].action, d[nom].espace) == ("messagerie", action, ancre), nom


async def test_effacer_porte_destructivehint_et_lire_la_corbeille_est_en_lecture_seule(monde: Monde) -> None:
    outils = await monde.outils()
    assert OUTILS <= set(outils)
    assert outils["crm_mail_delete"].annotations.destructive_hint is True
    assert outils["crm_mail_trash_list"].annotations.read_only_hint is True
    assert outils["crm_mail_restore"].annotations.destructive_hint is not True


async def test_sans_la_case_supprimer_l_effacement_n_est_pas_offert(monde: Monde) -> None:
    monde.simule.droits -= {("sujet-thomas", ESPACE_A, "messagerie", "supprimer")}
    outils = await monde.outils()
    assert "crm_mail_delete" not in outils
    assert {"crm_mail_set_read", "crm_mail_restore", "crm_mail_trash_list"} <= set(outils)


def test_la_cle_de_fil_est_le_miroir_de_app_cle_fil() -> None:
    assert cle_de_fil(["<racine@x>", "<suite@x>"], "<propre@x>") == "<racine@x>"
    assert cle_de_fil([], "<propre@x>") == "<propre@x>"
    assert cle_de_fil(None, "<propre@x>") == "<propre@x>"


@pytest.mark.parametrize(("lu", "appel"), [
    (True, ("mark_messages_read", {"p_message_ids": [VIVANT]})),
    (False, ("mark_message_unread", {"p_message_id": VIVANT})),
])
async def test_lu_et_non_lu_passent_par_la_base(monde: Monde, lu: bool, appel: tuple[str, dict[str, Any]]) -> None:
    rendu = await monde.appel("crm_mail_set_read", {"message_id": VIVANT, "read": lu})
    assert rendu == {"message_id": VIVANT, "read": lu}
    assert monde.simule.appels == [appel]


async def test_endormir_porte_sur_le_fil_du_message_et_reveiller_sans_date(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_snooze", {"message_id": VIVANT, "until": "2026-12-01T09:00:00Z"})
    assert monde.simule.appels[-1] == (
        "snooze_thread", {"workspace": ESPACE_A, "thread_key": "<racine@exemple.test>", "until": "2026-12-01T09:00:00Z"}
    )
    assert rendu["snoozed_until"] == "2026-12-01T09:00:00+00:00"
    assert "with its replies" in rendu["thread"]
    reveil = await monde.appel("crm_mail_snooze", {"message_id": VIVANT})
    assert monde.simule.appels[-1] == ("wake_thread", {"workspace": ESPACE_A, "thread_key": "<racine@exemple.test>"})
    assert reveil == {"message_id": VIVANT, "snoozed_until": None, "woken": True}


async def test_effacer_passe_par_la_base_avec_la_case_et_dit_la_duree(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_delete", {"message_id": VIVANT, "also_mailbox": True})
    assert monde.simule.appels == [("delete_message", {"p_message_id": VIVANT, "p_also_mailbox": True})]
    assert rendu == {
        "message_id": VIVANT, "deleted_at": "2026-11-11T10:00:00+00:00", "mailbox_moves": 1, "restorable_for_days": 30,
    }


async def test_restaurer_un_message_efface_se_resout_par_la_corbeille(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_restore", {"message_id": EFFACE})
    assert rendu == {"message_id": EFFACE, "restored": True, "cancelled_moves": 0}
    assert monde.simule.appels == [("restore_message", {"p_message_id": EFFACE})]


async def test_un_message_hors_de_la_corbeille_visible_est_le_refus_uniforme_sans_appel(monde: Monde) -> None:
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : message de la corbeille"):
        await monde.appel("crm_mail_restore", {"message_id": INCONNU})
    assert monde.simule.appels == []


async def test_un_message_efface_ne_se_lit_plus_par_l_ancre_message(monde: Monde) -> None:
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : message"):
        await monde.appel("crm_mail_delete", {"message_id": EFFACE})
    assert monde.simule.appels == []


async def test_la_corbeille_rend_l_etat_du_deplacement_et_jamais_le_corps(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_trash_list", {"workspace": ESPACE_A})
    assert monde.simule.appels == [("trashed_messages", {"p_workspace_id": ESPACE_A})]
    [ligne] = rendu["messages"]
    assert "body_text" not in ligne and "body" not in ligne
    assert ligne["deleted_by"] == "Thomas" and ligne["can_restore"] is True
    assert ligne["mailbox_move"] == {
        "state": "failed", "error": {"code": "no_trash_folder", "text": MOTIFS_DEPLACEMENT["no_trash_folder"]},
    }


def test_l_etat_du_deplacement_suit_la_regle_de_l_ecran() -> None:
    assert deplacement_lu({"moves_pending": 1, "moves_done": 1, "moves_failed": 0}) == {"state": "pending"}
    assert deplacement_lu({"moves_done": 2}) == {"state": "done"}
    assert deplacement_lu({}) == {"state": "none"}
    assert deplacement_lu({"moves_failed": 1, "last_move_error": "imap_boum"})["error"]["text"] == "unrecognised cause"
    assert message_en_corbeille({**CORBEILLE[0], "can_restore": None})["can_restore"] is False


@pytest.mark.parametrize(
    ("outil", "arguments", "statut", "code", "attendu"),
    [
        ("crm_mail_delete", {"message_id": VIVANT, "also_mailbox": True}, 400, "no_writable_mailbox", "without also_mailbox"),
        ("crm_mail_delete", {"message_id": VIVANT}, 403, "forbidden", "only a person who can write"),
        ("crm_mail_snooze", {"message_id": VIVANT, "until": "2000-01-01T00:00:00Z"}, 400, "snooze_date_in_past", "future"),
    ],
)
async def test_les_refus_de_la_base_sont_nommes(
    monde: Monde, outil: str, arguments: dict[str, Any], statut: int, code: str, attendu: str
) -> None:
    monde.simule.refus = (statut, {"code": "P0001", "message": code})
    with pytest.raises(ToolError, match=f"Refusé par le CRM : {code} — .*{attendu}"):
        await monde.appel(outil, arguments)


async def test_un_message_disparu_apres_l_ancre_est_le_refus_uniforme(monde: Monde) -> None:
    monde.simule.refus = (404, {"code": "PGRST", "message": "message_not_found"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : message"):
        await monde.appel("crm_mail_delete", {"message_id": VIVANT})

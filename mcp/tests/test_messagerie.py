# @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : les trois outils de la famille `messagerie`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 decies (liste, ancre `message`, corps affichable et HTML réduit, nombre de pièces
#           jointes, identité désignée par son adresse sans choix implicite, réponse limitée à l'affaire, refus nommés,
#           `destructiveHint` et case `aussi` de l'envoi), §9.3 ; webapp/src/lib/inbox.ts (`reduireHtmlEnTexte`)
# @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : `read` dans les deux lectures, demandé avec la ligne, sans marquer ;
#           docs/SPEC-mail-subsystem.md §18 bis.5 ; décision 708 (M1 B)
# @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : `bcc` transmis à la file, rendu, jamais une pièce jointe ;
#           docs/SPEC-mail-subsystem.md §19 bis.2 point 9 ; décision 708 (M2 B)
"""Le CRM simulé rend le fil d'une affaire (un message texte, un message HTML seul, une pièce jointe), un message d'une
autre affaire, et trois identités dont celle d'une collègue ; la vraie base est éprouvée par
`tests/test_integration_messagerie.py`."""

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
from crm_mcp.outils import messagerie, reference
from crm_mcp.outils.messagerie import corps_affichable, extrait, objet_de_reponse, reduire_html_en_texte
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, SECRET, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
CARD = "a0000000-0000-4000-8000-0000000000c1"
AUTRE_CARD = "a0000000-0000-4000-8000-0000000000c2"
MESSAGE_TEXTE = "a0000000-0000-4000-8000-0000000000e1"
MESSAGE_HTML = "a0000000-0000-4000-8000-0000000000e2"
MESSAGE_AILLEURS = "a0000000-0000-4000-8000-0000000000e3"
OUTILS = {"crm_card_mail_list", "crm_mail_get", "crm_mail_send"}


class CrmMessagerie(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.envois: list[dict[str, Any]] = []
        self.refus_envoi: tuple[int, Any] | None = None
        self.identites = [
            {"id": "id-thomas", "workspace_id": ESPACE_A, "label": "Thomas", "from_address": "Thomas@Atelier.test",
             "owner_id": "sujet-thomas"},
            {"id": "id-sabine", "workspace_id": ESPACE_A, "label": "Sabine", "from_address": "sabine@atelier.test",
             "owner_id": "sujet-sabine"},
        ]

    def messages(self) -> list[dict[str, Any]]:
        return [
            {"id": MESSAGE_TEXTE, "workspace_id": ESPACE_A, "card_id": CARD, "classification": "manual",
             "direction": "inbound", "sent_at": None, "received_at": "2026-10-01T09:00:00Z",
             "from_address": "client@exemple.test", "from_name": "Client", "to_addresses": ["c1@atelier.test"],
             "cc_addresses": [], "subject": "Devis", "body_text": "  Bonjour,\n\n  voici   le devis.  " + "x" * 400,
             "body_html": None, "mail_attachments": [{"count": 2}], "is_read": False},
            {"id": MESSAGE_HTML, "workspace_id": ESPACE_A, "card_id": CARD, "classification": "outbound",
             "direction": "outbound", "sent_at": "2026-10-02T10:00:00Z", "received_at": "2026-10-02T10:00:01Z",
             "from_address": "thomas@atelier.test", "from_name": None, "to_addresses": ["client@exemple.test"],
             "cc_addresses": ["chef@exemple.test"], "subject": "Re: Devis", "body_text": " ",
             "body_html": "<style>p{}</style><p>Merci&nbsp;&amp; à bientôt</p><br>Thomas",
             "mail_attachments": [{"count": 0}], "is_read": True},
            {"id": MESSAGE_AILLEURS, "workspace_id": ESPACE_A, "card_id": AUTRE_CARD, "classification": "manual",
             "direction": "inbound", "sent_at": None, "received_at": "2026-10-03T10:00:00Z",
             "from_address": "x@exemple.test", "from_name": None, "to_addresses": [], "cc_addresses": [],
             "subject": "Autre", "body_text": "autre", "body_html": None, "mail_attachments": []},
        ]

    async def table_messagerie(self, requete: Request) -> Response:
        nom = requete.path_params["table"]
        if nom not in ("mail_messages", "mail_outbound_identities", "cards"):
            return await self.table(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        self.lectures.append((nom, parametres))
        if nom == "cards":
            lignes = [{"id": CARD, "workspace_id": ESPACE_A}, {"id": AUTRE_CARD, "workspace_id": ESPACE_A}]
        elif nom == "mail_messages":
            lignes = self.messages()
        else:
            lignes = self.identites
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    async def rpc_messagerie(self, requete: Request) -> Response:
        if requete.path_params["fonction"] != "queue_outbound_email":
            return await self.rpc(requete)
        corps = await requete.json()
        self.envois.append(corps)
        if self.refus_envoi is not None:
            return JSONResponse(self.refus_envoi[1], status_code=self.refus_envoi[0])
        return JSONResponse("outbox-1")

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_messagerie, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_messagerie, methods=["GET"]),
        ])


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmMessagerie()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: THOMAS)
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        messagerie.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", a) for a in ("consulter", "ajouter")}
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


def test_le_html_est_reduit_comme_a_l_ecran() -> None:
    assert reduire_html_en_texte("<script>x()</script><div>Un&nbsp;&lt;b&gt;</div><div>Deux &#39;q&#39;</div>") == (
        "Un <b>\nDeux 'q'"
    )
    assert reduire_html_en_texte("<p>a</p>\n\n\n\n<p>b</p>") == "a\n\nb"
    assert corps_affichable("  texte  ", "<p>html</p>") == ("texte", False)
    assert corps_affichable("   ", "<p>html</p>") == ("html", True)
    assert corps_affichable(None, None) == ("", False)
    assert extrait("a  \n b") == "a b"
    assert len(extrait("y" * 1000)) == 280 and extrait("y" * 1000).endswith("…")
    assert objet_de_reponse("Devis") == "Re: Devis"
    assert objet_de_reponse(" RE : Devis ") == "RE : Devis"


async def test_trois_outils_l_envoi_destructif_avec_sa_case_aussi(monde: Monde) -> None:
    declares = {n: d for n, d in monde.moteur.declarations.items() if d.famille == "messagerie"}
    assert set(declares) == OUTILS
    assert (declares["crm_mail_get"].action, declares["crm_mail_get"].espace) == ("consulter", "message:message_id")
    envoi = declares["crm_mail_send"]
    assert (envoi.action, envoi.espace, envoi.aussi, envoi.autres) == (
        "ajouter", "card:card_id", (("affaires", "consulter"),), ("message:in_reply_to_message_id",)
    )
    outils = await monde.outils()
    assert outils["crm_mail_send"].annotations.destructive_hint is True
    assert outils["crm_mail_send"].annotations.read_only_hint is False
    assert outils["crm_card_mail_list"].annotations.read_only_hint is True


async def test_le_fil_dans_l_ordre_avec_extrait_et_nombre_de_pieces(monde: Monde) -> None:
    fil = await monde.appel("crm_card_mail_list", {"card_id": CARD, "limit": 2})
    assert [(m["id"], m["attachment_count"]) for m in fil["messages"]] == [(MESSAGE_TEXTE, 2), (MESSAGE_HTML, 0)]
    assert fil["messages"][0]["excerpt"].startswith("Bonjour, voici le devis. xxx")
    assert fil["messages"][1]["excerpt"] == "Merci & à bientôt Thomas"
    assert fil["messages"][1]["cc"] == ["chef@exemple.test"]
    assert fil["has_more"] is True
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_messages" and "order" in p)
    assert (lecture["order"], lecture["limit"], lecture["offset"]) == ("received_at.asc,id.asc", "2", "0")
    assert "mail_attachments(count)" in lecture["select"]


async def test_un_message_rend_son_corps_affichable_jamais_le_html(monde: Monde) -> None:
    lu = await monde.appel("crm_mail_get", {"message_id": MESSAGE_HTML})
    assert (lu["body"], lu["body_from_html"], lu["card_id"], lu["classification"]) == (
        "Merci & à bientôt\n\nThomas", True, CARD, "outbound"
    )
    assert "body_html" not in lu and "excerpt" not in lu
    texte = await monde.appel("crm_mail_get", {"message_id": MESSAGE_TEXTE})
    assert texte["body_from_html"] is False and texte["attachment_count"] == 2


async def test_l_envoi_passe_par_la_file_avec_l_identite_designee(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_send", {"card_id": CARD, "to": [" client@exemple.test ", ""], "subject": " Suite ",
                                               "body": "Bonjour", "cc": ["chef@exemple.test"]})
    # L'identité de Sabine, lisible par la RLS (supervision), n'est pas empruntable : l'unique possible est prise.
    assert monde.simule.envois[-1] == {"p_card_id": CARD, "p_identity_id": "id-thomas", "p_to": ["client@exemple.test"],
                                       "p_subject": "Suite", "p_body_text": "Bonjour", "p_cc": ["chef@exemple.test"],
                                       "p_bcc": []}
    assert (rendu["outbox_id"], rendu["status"], rendu["from_address"]) == ("outbox-1", "queued", "Thomas@Atelier.test")
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_outbound_identities")
    assert lecture["workspace_id"] == f"eq.{ESPACE_A}"


async def test_plusieurs_identites_exigent_une_adresse_jamais_un_choix_implicite(monde: Monde) -> None:
    monde.simule.identites.append({"id": "id-service", "workspace_id": ESPACE_A, "label": "Service",
                                   "from_address": "contact@atelier.test", "owner_id": None})
    with pytest.raises(ToolError, match="give from_address, one of: Thomas@Atelier.test, contact@atelier.test"):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})
    assert monde.simule.envois == []
    await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                        "from_address": "CONTACT@atelier.test"})
    assert monde.simule.envois[-1]["p_identity_id"] == "id-service"
    with pytest.raises(ToolError, match="Unknown sending address 'sabine@atelier.test'"):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "from_address": "sabine@atelier.test"})
    monde.simule.identites = [i for i in monde.simule.identites if i["owner_id"] == "sujet-sabine"]
    with pytest.raises(ToolError, match="no_sending_identity"):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})


async def test_une_reponse_vise_un_message_de_l_affaire_et_prefixe_l_objet(monde: Monde) -> None:
    await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["client@exemple.test"], "body": "Merci",
                                        "in_reply_to_message_id": MESSAGE_TEXTE})
    assert monde.simule.envois[-1]["p_subject"] == "Re: Devis"
    assert monde.simule.envois[-1]["p_in_reply_to_message_id"] == MESSAGE_TEXTE
    with pytest.raises(ToolError, match="reply_outside_card"):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["x@y.test"], "body": "b",
                                            "in_reply_to_message_id": MESSAGE_AILLEURS})
    with pytest.raises(ToolError, match="Give a subject"):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["x@y.test"], "body": "b"})
    assert len(monde.simule.envois) == 1


async def test_les_refus_de_la_file_sont_nommes(monde: Monde) -> None:
    arguments = {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"}
    for statut, code, attendu in (
        (403, {"code": "42501", "message": "forbidden"}, "forbidden — you may read this affaire but not write"),
        (403, {"code": "42501", "message": "identity_not_available"}, "identity_not_available"),
        (400, {"code": "23514", "message": "card_not_available"}, "card_not_available — the affaire is archived"),
        (409, {"code": "23505", "message": "quota_exceeded"}, "quota_exceeded — the daily sending quota"),
    ):
        monde.simule.refus_envoi = (statut, code)
        with pytest.raises(ToolError, match=attendu):
            await monde.appel("crm_mail_send", arguments)
    monde.simule.refus_envoi = (403, {"code": "42501", "message": "permission denied for table"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
        await monde.appel("crm_mail_send", arguments)


async def test_un_message_illisible_est_le_refus_uniforme(monde: Monde) -> None:
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : message"):
        await monde.appel("crm_mail_get", {"message_id": "a0000000-0000-4000-8000-0000000000ff"})


async def test_l_etat_lu_est_rendu_par_les_deux_lectures_sans_marquer(monde: Monde) -> None:
    fil = await monde.appel("crm_card_mail_list", {"card_id": CARD, "limit": 2})
    assert [(m["id"], m["read"]) for m in fil["messages"]] == [(MESSAGE_TEXTE, False), (MESSAGE_HTML, True)]
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_messages" and "order" in p)
    assert lecture["select"].endswith(",is_read")
    assert (await monde.appel("crm_mail_get", {"message_id": MESSAGE_TEXTE}))["read"] is False
    # UNE VALEUR ABSENTE N'EST PAS « LU » : le message d'une autre affaire ne porte pas `is_read` dans le simulé.
    assert (await monde.appel("crm_mail_get", {"message_id": MESSAGE_AILLEURS}))["read"] is False
    # LIRE NE MARQUE PAS : aucune des deux fonctions de marquage n'est appelée (§18 bis.5).
    assert not any("mark_message" in str(n) or "mark_message" in str(p) for n, p in monde.simule.lectures)


async def test_la_copie_cachee_est_transmise_a_la_file_et_rendue(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["client@exemple.test"], "subject": "s",
                                               "body": "b", "bcc": [" direction@exemple.test ", ""]})
    assert monde.simule.envois[-1]["p_bcc"] == ["direction@exemple.test"]
    assert rendu["bcc"] == ["direction@exemple.test"]
    # AUCUNE PIÈCE JOINTE PAR LE CONNECTEUR (décision 708) : l'outil n'a pas de paramètre pour elles, et la file n'en reçoit
    # aucune.
    assert "p_attachments" not in monde.simule.envois[-1]
    with pytest.raises(ToolError):
        await monde.appel("crm_mail_send", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": ["x"]})

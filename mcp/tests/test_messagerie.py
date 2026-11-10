# @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : les trois outils de la famille `messagerie`, devant un CRM simulé
# @verifies docs/SPEC-mcp.md §9.2 decies (liste, ancre `message`, corps affichable et HTML réduit, nombre de pièces
#           jointes, identité désignée par son adresse sans choix implicite, réponse limitée à l'affaire, refus nommés,
#           `destructiveHint` et case `aussi` de l'envoi), §9.3 ; webapp/src/lib/inbox.ts (`reduireHtmlEnTexte`)
# @verifies INC-335 (docs/BACKLOG.md, correctif de la décision 805, T3) — l'identité de service n'est jamais empruntée ;
#           sans adresse, l'identité par défaut de la personne, à défaut l'unique ; plusieurs sans défaut : refus nommé
#           (docs/SPEC-mcp.md §9.2 decies, révision de la décision 684)
# @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : `read` dans les deux lectures, demandé avec la ligne, sans marquer ;
#           docs/SPEC-mail-subsystem.md §18 bis.5 ; décision 708 (M1 B)
# @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : `bcc` transmis à la file, rendu, jamais une pièce jointe ;
#           docs/SPEC-mail-subsystem.md §19 bis.2 point 9 ; décision 708 (M2 B)
# @verifies CRM-074 (docs/BACKLOG.md) — tranche T4 : les pièces listées dans les deux lectures, `crm_mail_attachment_get`
#           (ancre `attachment`, la pièce rendue en binaire — image ou ressource embarquée —, lue sous le jeton de la
#           personne, refus d'une pièce non saine, trop grande, absente) ; docs/SPEC-pieces-jointes.md §6 ; décisions 788, 789
# @verifies CRM-128 (docs/BACKLOG.md) — tranche T3 : le connecteur prépare et n'envoie jamais — `crm_mail_prepare` appelle
#           `prepare_email` (jamais `queue_outbound_email`), sans `destructiveHint`, rend le lien de relecture ;
#           `crm_mail_draft_list` (ses mails en attente, par espace et par affaire) ; `crm_mail_draft_discard` (ancre
#           `draft`, `destructiveHint`) ; `crm_mail_send` absent ; refus nommés (docs/SPEC-mails-prepares.md §5 ; décision 829)
# @verifies CRM-137 (docs/BACKLOG.md) — `crm_mail_classification_candidates` (`consulter`, ancre `message`, la case
#           « expéditeur connu » vraie par défaut, le terme rogné, la note de l'état vide) et `crm_mail_classify` (`modifier`,
#           ancre `message` et `card`, `classify_message`, refus nommés) ; docs/SPEC-mcp.md §9.2 septendecies ; décision 893
# @verifies CRM-143 (docs/BACKLOG.md) — tranche T5 : les statuts précis d'une pièce (`statut_piece`, le repli jamais
#           permissif), `crm_mail_attachment_get` qui refuse une pièce non analysée sans accusé et la lit avec, la
#           confirmation posée sous le jeton de la personne AVANT la lecture ; `crm_mail_prepare` qui joint des fichiers
#           — décodés et bornés avant tout dépôt, déposés sous le jeton au chemin `<espace>/<personne>/<aléa>/<nom>`, leurs
#           chemins passés à `prepare_email`, retirés si rien n'est préparé (docs/SPEC-pieces-jointes.md §17.6)
"""Le CRM simulé rend le fil d'une affaire (un message texte, un message HTML seul, une pièce jointe), un message d'une
autre affaire, et trois identités dont celle d'une collègue ; la vraie base est éprouvée par
`tests/test_integration_messagerie.py`."""

from __future__ import annotations

import base64
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
from crm_mcp.outils.messagerie import PIECE_MAX_OCTETS, nom_de_depot, statut_piece
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
OUTILS = {"crm_card_mail_list", "crm_mail_get", "crm_mail_prepare", "crm_mail_draft_list", "crm_mail_draft_discard",
          "crm_mail_attachment_get", "crm_mail_classification_candidates", "crm_mail_classify"}
WEBAPP = "https://crm.exemple.test"
BROUILLON = "a0000000-0000-4000-8000-0000000000d1"
PIECE_PDF = "a0000000-0000-4000-8000-0000000000f1"
PIECE_IMAGE = "a0000000-0000-4000-8000-0000000000f2"
PIECE_INFECTEE = "a0000000-0000-4000-8000-0000000000f3"
PIECE_ENORME = "a0000000-0000-4000-8000-0000000000f4"
PIECE_ORPHELINE = "a0000000-0000-4000-8000-0000000000f5"
PIECE_NON_ANALYSEE = "a0000000-0000-4000-8000-0000000000f6"
PIECE_LOURDE = "a0000000-0000-4000-8000-0000000000f7"
OCTETS_PDF = b"%PDF-1.4 devis"
OCTETS_PNG = b"\x89PNG\r\n\x1a\nimage"


class CrmMessagerie(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.lectures: list[tuple[str, dict[str, str]]] = []
        self.envois: list[dict[str, Any]] = []
        self.fonctions: list[str] = []
        self.ecartes: list[dict[str, Any]] = []
        self.refus_envoi: tuple[int, Any] | None = None
        self.classements: list[dict[str, Any]] = []
        self.objets_lus: list[tuple[str, str]] = []
        self.objets = {"ws/m1/pdf": OCTETS_PDF, "ws/m1/png": OCTETS_PNG, "ws/m1/nonanalyse": OCTETS_PDF}
        self.accuses: list[str] = []
        self.refus_accuse: tuple[int, Any] | None = None
        self.depots: list[tuple[str, str, bytes, str, str]] = []
        self.refus_depot: int | None = None
        self.retraits: list[list[str]] = []
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
             "body_html": None, "is_read": False,
             "mail_attachments": [
                 {"id": PIECE_INFECTEE, "filename": "virus.exe", "mime_type": "application/x-msdownload", "size_bytes": 9,
                  "av_status": "infected"},
                 {"id": PIECE_PDF, "filename": "devis.pdf", "mime_type": "application/pdf", "size_bytes": 14,
                  "av_status": "clean"},
             ]},
            {"id": MESSAGE_HTML, "workspace_id": ESPACE_A, "card_id": CARD, "classification": "outbound",
             "direction": "outbound", "sent_at": "2026-10-02T10:00:00Z", "received_at": "2026-10-02T10:00:01Z",
             "from_address": "thomas@atelier.test", "from_name": None, "to_addresses": ["client@exemple.test"],
             "cc_addresses": ["chef@exemple.test"], "subject": "Re: Devis", "body_text": " ",
             "body_html": "<style>p{}</style><p>Merci&nbsp;&amp; à bientôt</p><br>Thomas",
             "mail_attachments": [], "is_read": True},
            {"id": MESSAGE_AILLEURS, "workspace_id": ESPACE_A, "card_id": AUTRE_CARD, "classification": "manual",
             "direction": "inbound", "sent_at": None, "received_at": "2026-10-03T10:00:00Z",
             "from_address": "x@exemple.test", "from_name": None, "to_addresses": [], "cc_addresses": [],
             "subject": "Autre", "body_text": "autre", "body_html": None, "mail_attachments": []},
        ]

    def pieces(self) -> list[dict[str, Any]]:
        commun = {"message_id": MESSAGE_TEXTE, "message": {"workspace_id": ESPACE_A}}
        return [
            {**commun, "id": PIECE_PDF, "filename": "devis.pdf", "mime_type": "application/pdf", "size_bytes": 14,
             "av_status": "clean", "storage_path": "ws/m1/pdf"},
            {**commun, "id": PIECE_IMAGE, "filename": "maquette.png", "mime_type": "image/png", "size_bytes": 13,
             "av_status": "clean", "storage_path": "ws/m1/png"},
            {**commun, "id": PIECE_INFECTEE, "filename": "virus.exe", "mime_type": "application/x-msdownload",
             "size_bytes": 9, "av_status": "infected", "storage_path": "ws/m1/exe"},
            {**commun, "id": PIECE_ENORME, "filename": "video.mp4", "mime_type": "video/mp4",
             "size_bytes": PIECE_MAX_OCTETS + 1, "av_status": "clean", "storage_path": "ws/m1/mp4"},
            {**commun, "id": PIECE_ORPHELINE, "filename": "perdu.pdf", "mime_type": "application/pdf", "size_bytes": 5,
             "av_status": "clean", "storage_path": "ws/m1/perdu"},
            {**commun, "id": PIECE_NON_ANALYSEE, "filename": "releve.pdf", "mime_type": "application/pdf", "size_bytes": 14,
             "av_status": "skipped", "av_skip_reason": "scanner_unavailable", "created_at": "2026-11-10T08:00:00Z",
             "storage_path": "ws/m1/nonanalyse"},
            {**commun, "id": PIECE_LOURDE, "filename": "film.mov", "mime_type": "video/quicktime", "size_bytes": 99,
             "av_status": "skipped", "av_skip_reason": "too_large", "created_at": "2026-11-10T08:00:00Z",
             "storage_path": "ws/m1/lourde"},
        ]

    async def deposer(self, requete: Request) -> Response:
        if self._personne(requete) is None:
            return JSONResponse({"message": "refusé"}, status_code=403)
        self.depots.append((requete.path_params["bucket"], requete.path_params["chemin"], await requete.body(),
                            requete.headers.get("content-type", ""), requete.headers.get("authorization", "")))
        if self.refus_depot is not None:
            return JSONResponse({"message": "refusé"}, status_code=self.refus_depot)
        return JSONResponse({"Key": requete.path_params["chemin"]})

    async def retirer(self, requete: Request) -> Response:
        self.retraits.append((await requete.json())["prefixes"])
        return JSONResponse([])

    async def objet(self, requete: Request) -> Response:
        jeton = requete.headers.get("authorization", "")
        chemin = requete.path_params["chemin"]
        self.objets_lus.append((requete.path_params["bucket"], chemin))
        if self._personne(requete) is None or jeton.endswith(CLE_SERVICE):
            return JSONResponse({"message": "refusé"}, status_code=400)
        if chemin not in self.objets:
            return JSONResponse({"statusCode": "404", "error": "not_found"}, status_code=400)
        return Response(self.objets[chemin], media_type="application/octet-stream")

    async def table_messagerie(self, requete: Request) -> Response:
        nom = requete.path_params["table"]
        if nom not in ("mail_messages", "mail_outbound_identities", "cards", "mail_attachments", "mail_drafts"):
            return await self.table(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        parametres = dict(requete.query_params)
        self.lectures.append((nom, parametres))
        if nom == "cards":
            lignes = [{"id": CARD, "workspace_id": ESPACE_A}, {"id": AUTRE_CARD, "workspace_id": ESPACE_A}]
        elif nom == "mail_messages":
            lignes = self.messages()
        elif nom == "mail_attachments":
            lignes = self.pieces()
        elif nom == "mail_drafts":
            lignes = self.brouillons()
        else:
            lignes = self.identites
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
        return JSONResponse([l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)])

    def brouillons(self) -> list[dict[str, Any]]:
        return [
            {"id": BROUILLON, "workspace_id": ESPACE_A, "card_id": CARD, "status": "pending", "to_addrs": ["a@b.test"],
             "cc_addrs": [], "subject": "Proposition", "body_text": "Bonjour,   voici " + "y" * 400, "origin": "mcp",
             "created_at": "2026-11-03T10:00:00Z", "card": {"title": "Refonte"}},
        ]

    async def rpc_messagerie(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction in ("classification_candidates", "classify_message"):
            if self._personne(requete) is None:
                return JSONResponse({"message": "JWT invalide"}, status_code=401)
            self.fonctions.append(fonction)
            corps = await requete.json()
            self.classements.append(corps)
            if self.refus_envoi is not None:
                return JSONResponse(self.refus_envoi[1], status_code=self.refus_envoi[0])
            if fonction == "classify_message":
                return JSONResponse(corps["p_card_id"])
            connues = [{"card_id": CARD, "title": "Refonte", "path": "Conseil IA › Grands comptes", "known_sender": True}]
            autres = [{"card_id": AUTRE_CARD, "title": "Audit", "path": "", "known_sender": False}]
            if corps.get("p_known_sender") is False:
                return JSONResponse(connues + autres)
            return JSONResponse(connues if corps["p_message_id"] == MESSAGE_TEXTE else [])
        if fonction == "acknowledge_unscanned_attachment":
            if self._personne(requete) is None:
                return JSONResponse({"message": "JWT invalide"}, status_code=401)
            self.fonctions.append(fonction)
            self.accuses.append((await requete.json())["p_attachment_id"])
            if self.refus_accuse is not None:
                return JSONResponse(self.refus_accuse[1], status_code=self.refus_accuse[0])
            return JSONResponse("2026-11-10T12:00:00+00:00")
        if fonction not in ("queue_outbound_email", "prepare_email", "discard_email_draft"):
            return await self.rpc(requete)
        self.fonctions.append(fonction)
        corps = await requete.json()
        (self.ecartes if fonction == "discard_email_draft" else self.envois).append(corps)
        if self.refus_envoi is not None:
            return JSONResponse(self.refus_envoi[1], status_code=self.refus_envoi[0])
        return JSONResponse(None if fonction == "discard_email_draft" else "draft-1")

    def application(self) -> Starlette:
        return Starlette(routes=[
            Route("/rest/v1/rpc/{fonction}", self.rpc_messagerie, methods=["POST"]),
            Route("/rest/v1/{table}", self.table_messagerie, methods=["GET"]),
            Route("/storage/v1/object/authenticated/{bucket}/{chemin:path}", self.objet, methods=["GET"]),
            Route("/storage/v1/object/{bucket}/{chemin:path}", self.deposer, methods=["POST"]),
            Route("/storage/v1/object/{bucket}", self.retirer, methods=["DELETE"]),
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
        messagerie.ajouter(self.mcp, self.moteur, self.crm, WEBAPP)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", a) for a in ("consulter", "ajouter", "supprimer")}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "affaires", "consulter")}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content

    async def appel_complet(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return await client.call_tool(outil, arguments)

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


async def test_le_connecteur_prepare_et_n_envoie_jamais(monde: Monde) -> None:
    declares = {n: d for n, d in monde.moteur.declarations.items() if d.famille == "messagerie"}
    assert set(declares) == OUTILS
    assert "crm_mail_send" not in monde.moteur.declarations
    assert (declares["crm_mail_get"].action, declares["crm_mail_get"].espace) == ("consulter", "message:message_id")
    preparation = declares["crm_mail_prepare"]
    assert (preparation.action, preparation.espace, preparation.aussi, preparation.autres) == (
        "ajouter", "card:card_id", (("affaires", "consulter"),), ("message:in_reply_to_message_id",)
    )
    assert (declares["crm_mail_draft_list"].action, declares["crm_mail_draft_list"].espace,
            declares["crm_mail_draft_list"].autres) == ("consulter", "workspace:workspace", ("card:card_id",))
    assert (declares["crm_mail_draft_discard"].action, declares["crm_mail_draft_discard"].espace) == (
        "supprimer", "draft:draft_id"
    )
    outils = await monde.outils()
    assert "crm_mail_send" not in outils
    # PRÉPARER NE SORT RIEN DU CRM : pas d'annonce destructive ; écarter est définitif, et le dit.
    assert outils["crm_mail_prepare"].annotations.destructive_hint is not True
    assert outils["crm_mail_prepare"].annotations.read_only_hint is False
    assert outils["crm_mail_draft_discard"].annotations.destructive_hint is True
    assert outils["crm_mail_draft_list"].annotations.read_only_hint is True
    assert outils["crm_card_mail_list"].annotations.read_only_hint is True


async def test_le_fil_dans_l_ordre_avec_extrait_et_nombre_de_pieces(monde: Monde) -> None:
    fil = await monde.appel("crm_card_mail_list", {"card_id": CARD, "limit": 2})
    assert [(m["id"], len(m["attachments"])) for m in fil["messages"]] == [(MESSAGE_TEXTE, 2), (MESSAGE_HTML, 0)]
    # Par nom, avec leur statut dans le vocabulaire du connecteur — jamais leur contenu ni leur chemin de stockage.
    assert fil["messages"][0]["attachments"] == [
        {"id": PIECE_PDF, "filename": "devis.pdf", "mime_type": "application/pdf", "size_bytes": 14, "status": "available"},
        {"id": PIECE_INFECTEE, "filename": "virus.exe", "mime_type": "application/x-msdownload", "size_bytes": 9,
         "status": "infected"},
    ]
    assert fil["messages"][0]["excerpt"].startswith("Bonjour, voici le devis. xxx")
    assert fil["messages"][1]["excerpt"] == "Merci & à bientôt Thomas"
    assert fil["messages"][1]["cc"] == ["chef@exemple.test"]
    assert fil["has_more"] is True
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_messages" and "order" in p)
    assert (lecture["order"], lecture["limit"], lecture["offset"]) == ("received_at.asc,id.asc", "2", "0")
    # `CRM-143` T5 : la raison et la réception de la pièce, d'où son statut précis.
    assert "mail_attachments(id,filename,mime_type,size_bytes,av_status,av_skip_reason,created_at)" in lecture["select"]
    assert "storage_path" not in lecture["select"]


async def test_un_message_rend_son_corps_affichable_jamais_le_html(monde: Monde) -> None:
    lu = await monde.appel("crm_mail_get", {"message_id": MESSAGE_HTML})
    assert (lu["body"], lu["body_from_html"], lu["card_id"], lu["classification"]) == (
        "Merci & à bientôt\n\nThomas", True, CARD, "outbound"
    )
    assert "body_html" not in lu and "excerpt" not in lu
    texte = await monde.appel("crm_mail_get", {"message_id": MESSAGE_TEXTE})
    assert texte["body_from_html"] is False and [p["id"] for p in texte["attachments"]] == [PIECE_PDF, PIECE_INFECTEE]


async def test_la_preparation_passe_par_prepare_email_avec_l_identite_designee(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": [" client@exemple.test ", ""], "subject": " Suite ",
                                               "body": "Bonjour", "cc": ["chef@exemple.test"]})
    # L'identité de Sabine, lisible par la RLS (supervision), n'est pas empruntable : l'unique possible est prise.
    assert monde.simule.envois[-1] == {"p_card_id": CARD, "p_identity_id": "id-thomas", "p_to": ["client@exemple.test"],
                                       "p_subject": "Suite", "p_body_text": "Bonjour", "p_cc": ["chef@exemple.test"],
                                       "p_bcc": []}
    assert (rendu["draft_id"], rendu["status"], rendu["from_address"]) == ("draft-1", "pending_review", "Thomas@Atelier.test")
    # LE LIEN DE RELECTURE, et la phrase qui dit que rien n'est parti (docs/SPEC-mails-prepares.md §5).
    assert rendu["review_url"] == "https://crm.exemple.test/inbox?brouillon=draft-1"
    assert rendu["note"].startswith("This email is NOT sent.")
    # JAMAIS LA FILE D'ENVOI.
    assert monde.simule.fonctions == ["prepare_email"]
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_outbound_identities")
    assert lecture["workspace_id"] == f"eq.{ESPACE_A}"


async def test_plusieurs_identites_sans_defaut_exigent_une_adresse(monde: Monde) -> None:
    monde.simule.identites.append({"id": "id-thomas-2", "workspace_id": ESPACE_A, "label": "Thomas bis",
                                   "from_address": "devis@atelier.test", "owner_id": "sujet-thomas"})
    with pytest.raises(ToolError, match="none is your default; give from_address, one of: Thomas@Atelier.test, devis@atelier.test"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})
    assert monde.simule.envois == []
    await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                        "from_address": "DEVIS@atelier.test"})
    assert monde.simule.envois[-1]["p_identity_id"] == "id-thomas-2"
    with pytest.raises(ToolError, match="Unknown sending address 'sabine@atelier.test'"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "from_address": "sabine@atelier.test"})
    monde.simule.identites = [i for i in monde.simule.identites if i["owner_id"] == "sujet-sabine"]
    with pytest.raises(ToolError, match="no_sending_identity"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})


async def test_sans_adresse_l_identite_par_defaut_de_la_personne(monde: Monde) -> None:
    # Décision 805 : le défaut est le choix explicite de la personne, fait dans les réglages ; il n'est pas le premier
    # par libellé (« Thomas » précède « Thomas bis »).
    monde.simule.identites.append({"id": "id-thomas-2", "workspace_id": ESPACE_A, "label": "Thomas bis",
                                   "from_address": "devis@atelier.test", "owner_id": "sujet-thomas", "is_default": True})
    rendu = await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})
    assert monde.simule.envois[-1]["p_identity_id"] == "id-thomas-2"
    assert rendu["from_address"] == "devis@atelier.test"
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_outbound_identities")
    assert "is_default" in lecture["select"].split(",")


async def test_l_identite_de_service_n_est_jamais_empruntee(monde: Monde) -> None:
    # Décision 805 : même par défaut pour le service, même désignée par son adresse, elle n'est pas proposée — la garde la
    # refuserait (`identity_not_available`), et l'outil ne tente pas un envoi voué au refus.
    monde.simule.identites.append({"id": "id-service", "workspace_id": ESPACE_A, "label": "Service",
                                   "from_address": "contact@atelier.test", "owner_id": None, "is_default": True})
    await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"})
    assert monde.simule.envois[-1]["p_identity_id"] == "id-thomas"
    with pytest.raises(ToolError, match="Unknown sending address 'contact@atelier.test'; give one of: Thomas@Atelier.test"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "from_address": "contact@atelier.test"})
    assert len(monde.simule.envois) == 1


async def test_une_reponse_vise_un_message_de_l_affaire_et_prefixe_l_objet(monde: Monde) -> None:
    await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["client@exemple.test"], "body": "Merci",
                                        "in_reply_to_message_id": MESSAGE_TEXTE})
    assert monde.simule.envois[-1]["p_subject"] == "Re: Devis"
    assert monde.simule.envois[-1]["p_in_reply_to_message_id"] == MESSAGE_TEXTE
    with pytest.raises(ToolError, match="reply_outside_card"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["x@y.test"], "body": "b",
                                            "in_reply_to_message_id": MESSAGE_AILLEURS})
    with pytest.raises(ToolError, match="Give a subject"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["x@y.test"], "body": "b"})
    assert len(monde.simule.envois) == 1


async def test_les_refus_de_la_preparation_sont_nommes(monde: Monde) -> None:
    arguments = {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b"}
    for statut, code, attendu in (
        (403, {"code": "42501", "message": "forbidden"}, "forbidden — you may read this affaire but not write"),
        (403, {"code": "42501", "message": "identity_not_available"}, "identity_not_available"),
        (400, {"code": "23514", "message": "card_not_available"}, "card_not_available — the affaire is archived"),
        (400, {"code": "23514", "message": "draft_limit_reached"}, "draft_limit_reached — 200 prepared emails"),
        (403, {"code": "42501", "message": "review_required"}, "review_required — an email prepared through the connector"),
    ):
        monde.simule.refus_envoi = (statut, code)
        with pytest.raises(ToolError, match=attendu):
            await monde.appel("crm_mail_prepare", arguments)
    monde.simule.refus_envoi = (403, {"code": "42501", "message": "permission denied for table"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
        await monde.appel("crm_mail_prepare", arguments)


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


async def test_la_copie_cachee_est_transmise_et_rendue(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["client@exemple.test"], "subject": "s",
                                               "body": "b", "bcc": [" direction@exemple.test ", ""]})
    assert monde.simule.envois[-1]["p_bcc"] == ["direction@exemple.test"]
    assert rendu["bcc"] == ["direction@exemple.test"]
    # AUCUNE PIÈCE JOINTE PAR LE CONNECTEUR (décision 708) : l'outil n'a pas de paramètre pour elles, et la file n'en reçoit
    # aucune.
    assert "p_attachments" not in monde.simule.envois[-1]
    with pytest.raises(ToolError):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": ["x"]})


async def test_la_piece_s_ancre_a_son_message_et_se_lit_en_consulter(monde: Monde) -> None:
    declaration = monde.moteur.declarations["crm_mail_attachment_get"]
    assert (declaration.famille, declaration.action, declaration.espace) == ("messagerie", "consulter", "attachment:attachment_id")
    assert (await monde.outils())["crm_mail_attachment_get"].annotations.read_only_hint is True


async def test_un_pdf_sain_est_rendu_en_ressource_binaire_lue_sous_le_jeton_de_la_personne(monde: Monde) -> None:
    resultat = await monde.appel_complet("crm_mail_attachment_get", {"attachment_id": PIECE_PDF})
    assert resultat.structured_content == {"id": PIECE_PDF, "message_id": MESSAGE_TEXTE, "filename": "devis.pdf",
                                           "mime_type": "application/pdf", "size_bytes": len(OCTETS_PDF)}
    ressource = next(b for b in resultat.content if b.type == "resource").resource
    assert ressource.mime_type == "application/pdf"
    assert str(ressource.uri) == f"crm://attachments/{PIECE_PDF}/devis.pdf"
    assert base64.b64decode(ressource.blob) == OCTETS_PDF
    assert monde.simule.objets_lus == [("mail-attachments", "ws/m1/pdf")]


async def test_une_image_saine_est_rendue_en_contenu_image(monde: Monde) -> None:
    resultat = await monde.appel_complet("crm_mail_attachment_get", {"attachment_id": PIECE_IMAGE})
    image = next(b for b in resultat.content if b.type == "image")
    assert image.mime_type == "image/png" and base64.b64decode(image.data) == OCTETS_PNG


async def test_une_piece_non_saine_trop_grande_absente_ou_inconnue_est_refusee_sans_lecture_inutile(monde: Monde) -> None:
    with pytest.raises(ToolError, match="attachment_not_available — this attachment is infected"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_INFECTEE})
    with pytest.raises(ToolError, match="attachment_too_large"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_ENORME})
    assert monde.simule.objets_lus == [], "ni une pièce infectée ni une pièce trop grande ne sont lues au stockage"
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : pièce jointe"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_ORPHELINE})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": "a0000000-0000-4000-8000-0000000000ff"})


async def test_un_objet_plus_grand_que_sa_ligne_ne_le_dit_est_interrompu(monde: Monde, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(messagerie, "PIECE_MAX_OCTETS", 8)
    monkeypatch.setattr(monde.simule, "pieces", lambda: [
        {"id": PIECE_PDF, "message_id": MESSAGE_TEXTE, "message": {"workspace_id": ESPACE_A}, "filename": "devis.pdf",
         "mime_type": "application/pdf", "size_bytes": 4, "av_status": "clean", "storage_path": "ws/m1/pdf"}])
    with pytest.raises(ToolError, match="attachment_too_large"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_PDF})


async def test_la_liste_rend_ses_mails_en_attente_avec_leur_lien(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_draft_list", {"workspace": ESPACE_A, "card_id": CARD, "limit": 5})
    assert rendu["has_more"] is False
    (brouillon,) = rendu["drafts"]
    assert (brouillon["id"], brouillon["card_id"], brouillon["card_title"], brouillon["to"], brouillon["origin"]) == (
        BROUILLON, CARD, "Refonte", ["a@b.test"], "mcp"
    )
    assert brouillon["excerpt"].startswith("Bonjour, voici yyy") and len(brouillon["excerpt"]) == 280
    assert brouillon["review_url"] == f"https://crm.exemple.test/inbox?brouillon={BROUILLON}"
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_drafts")
    # SEULS LES MAILS EN ATTENTE, de l'espace résolu, de l'affaire demandée, du plus ancien au plus récent ; la RLS fait
    # le reste (la personne seule).
    assert (lecture["workspace_id"], lecture["status"], lecture["card_id"], lecture["order"], lecture["limit"]) == (
        f"eq.{ESPACE_A}", "eq.pending", f"eq.{CARD}", "created_at.asc,id.asc", "6"
    )


async def test_ecarter_un_mail_prepare(monde: Monde) -> None:
    monde.simule.brouillons = lambda: [{"id": BROUILLON, "workspace_id": ESPACE_A}]  # l'ancre se résout par l'espace
    rendu = await monde.appel("crm_mail_draft_discard", {"draft_id": BROUILLON})
    assert rendu == {"draft_id": BROUILLON, "status": "discarded"}
    assert monde.simule.ecartes == [{"p_draft_id": BROUILLON}]
    monde.simule.refus_envoi = (400, {"code": "23514", "message": "draft_not_pending"})
    with pytest.raises(ToolError, match="draft_not_pending — this prepared email was already sent or discarded"):
        await monde.appel("crm_mail_draft_discard", {"draft_id": BROUILLON})
    # Résolu par l'ancre puis disparu (envoyé et purgé entre-temps) : le 404 de la base, nommé comme tout 404 (CRM-120).
    monde.simule.refus_envoi = (404, {"code": "P0002", "message": "draft_not_found"})
    with pytest.raises(ToolError, match="Refusé par le CRM : draft_not_found"):
        await monde.appel("crm_mail_draft_discard", {"draft_id": BROUILLON})


async def test_un_mail_prepare_d_autrui_est_le_refus_uniforme_sans_appel(monde: Monde) -> None:
    monde.simule.brouillons = lambda: []
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : mail préparé"):
        await monde.appel("crm_mail_draft_discard", {"draft_id": BROUILLON})
    assert monde.simule.ecartes == []


async def test_les_affaires_candidates_d_un_message_par_la_base(monde: Monde) -> None:
    declaration = monde.moteur.declarations["crm_mail_classification_candidates"]
    assert (declaration.famille, declaration.action, declaration.espace) == ("messagerie", "consulter", "message:message_id")
    rendu = await monde.appel("crm_mail_classification_candidates", {"message_id": MESSAGE_TEXTE, "search": "  refo "})
    assert monde.simule.classements[-1] == {
        "p_message_id": MESSAGE_TEXTE, "p_known_sender": True, "p_limit": 50, "p_search": "refo",
    }
    assert rendu["affaires"] == [
        {"card_id": CARD, "title": "Refonte", "path": "Conseil IA › Grands comptes", "known_sender": True},
    ]
    assert "note" not in rendu
    tout = await monde.appel(
        "crm_mail_classification_candidates", {"message_id": MESSAGE_TEXTE, "known_sender": False, "limit": 10}
    )
    assert monde.simule.classements[-1] == {"p_message_id": MESSAGE_TEXTE, "p_known_sender": False, "p_limit": 10}
    assert [a["known_sender"] for a in tout["affaires"]] == [True, False]
    outils = await monde.outils()
    assert outils["crm_mail_classification_candidates"].annotations.read_only_hint is True


async def test_un_expediteur_inconnu_rend_la_note_de_l_etat_vide(monde: Monde) -> None:
    rendu = await monde.appel("crm_mail_classification_candidates", {"message_id": MESSAGE_HTML})
    assert rendu["affaires"] == []
    assert "known_sender: false" in rendu["note"]


async def test_classer_passe_par_classify_message_en_modifier(monde: Monde) -> None:
    declaration = monde.moteur.declarations["crm_mail_classify"]
    assert (declaration.famille, declaration.action, declaration.espace, declaration.autres) == (
        "messagerie", "modifier", "message:message_id", ("card:card_id",)
    )
    # Sans la case `modifier`, l'outil n'est même pas offert : la matrice le retient avant tout appel.
    with pytest.raises(ToolError):
        await monde.appel("crm_mail_classify", {"message_id": MESSAGE_TEXTE, "card_id": CARD})
    assert "classify_message" not in monde.simule.fonctions
    monde.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", "modifier")}
    rendu = await monde.appel("crm_mail_classify", {"message_id": MESSAGE_TEXTE, "card_id": AUTRE_CARD})
    assert rendu == {"message_id": MESSAGE_TEXTE, "card_id": AUTRE_CARD, "status": "filed"}
    assert monde.simule.classements[-1] == {"p_message_id": MESSAGE_TEXTE, "p_card_id": AUTRE_CARD}
    outils = await monde.outils()
    assert outils["crm_mail_classify"].annotations.destructive_hint is not True


async def test_les_refus_du_classement_sont_nommes(monde: Monde) -> None:
    monde.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", "modifier")}
    arguments = {"message_id": MESSAGE_TEXTE, "card_id": CARD}
    for statut, code, attendu in (
        (403, {"code": "42501", "message": "forbidden"}, "forbidden — you may not file this email"),
        (400, {"code": "23514", "message": "card_not_available"}, "card_not_available — the affaire is archived"),
    ):
        monde.simule.refus_envoi = (statut, code)
        with pytest.raises(ToolError, match=attendu):
            await monde.appel("crm_mail_classify", arguments)


# =================================================================================================
# CRM-143 T5 — les pièces non analysées, et les pièces d'un mail préparé (docs/SPEC-pieces-jointes.md §17.6)
# =================================================================================================


def test_le_statut_d_une_piece_est_precis_et_son_repli_jamais_permissif() -> None:
    from datetime import datetime, timezone

    maintenant = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    assert statut_piece({"av_status": "clean"}) == "available"
    assert statut_piece({"av_status": "infected"}) == "infected"
    assert statut_piece({"av_status": "skipped", "av_skip_reason": "scanner_unavailable"}) == "not_scanned_unavailable"
    assert statut_piece({"av_status": "skipped", "av_skip_reason": "too_large"}) == "not_scanned_too_large"
    assert statut_piece({"av_status": "pending", "created_at": "2026-11-10T11:50:00Z"}, maintenant) == "scanning"
    assert statut_piece({"av_status": "pending", "created_at": "2026-11-10T11:44:00Z"}, maintenant) == "not_scanned_unavailable"
    # LE REPLI : un statut inconnu, un `skipped` sans raison, une date illisible ou sans fuseau ne se lisent jamais.
    assert statut_piece({"av_status": "quarantined"}) == "not_scanned"
    assert statut_piece({"av_status": "skipped"}) == "not_scanned"
    assert statut_piece({"av_status": "pending", "created_at": "hier"}, maintenant) == "not_scanned"
    assert statut_piece({"av_status": "pending", "created_at": "2026-11-10T08:00:00"}, maintenant) == "not_scanned"


def test_le_nom_de_depot_est_celui_de_la_webapp() -> None:
    assert nom_de_depot("Proposition révisée.pdf") == "Proposition revisee.pdf"
    assert nom_de_depot("a/b\\c?.txt") == "a_b_c_.txt"
    assert nom_de_depot("  ") == "piece" and nom_de_depot("..") == "piece"
    assert len(nom_de_depot("x" * 300)) == 200


async def test_une_piece_non_analysee_est_refusee_sans_accuse_et_lue_avec_la_confirmation_d_abord(monde: Monde) -> None:
    with pytest.raises(ToolError, match="attachment_not_scanned — the antivirus could not scan this attachment"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_NON_ANALYSEE})
    assert monde.simule.accuses == [] and monde.simule.objets_lus == [], "sans accusé, rien n'est confirmé ni lu"

    resultat = await monde.appel_complet(
        "crm_mail_attachment_get", {"attachment_id": PIECE_NON_ANALYSEE, "acknowledge_unscanned": True}
    )
    assert resultat.structured_content["filename"] == "releve.pdf"
    # LA CONFIRMATION, SOUS LE JETON DE LA PERSONNE, AVANT LA LECTURE AU STOCKAGE.
    assert monde.simule.accuses == [PIECE_NON_ANALYSEE]
    assert monde.simule.objets_lus == [("mail-attachments", "ws/m1/nonanalyse")]


async def test_l_accuse_ne_vaut_ni_pour_une_infectee_ni_pour_une_trop_volumineuse(monde: Monde) -> None:
    for piece, statut in ((PIECE_INFECTEE, "infected"), (PIECE_LOURDE, "not_scanned_too_large")):
        with pytest.raises(ToolError, match=f"attachment_not_available — this attachment is {statut}"):
            await monde.appel("crm_mail_attachment_get", {"attachment_id": piece, "acknowledge_unscanned": True})
    assert monde.simule.accuses == [] and monde.simule.objets_lus == []


async def test_un_refus_de_la_confirmation_est_traduit_et_rien_n_est_lu(monde: Monde) -> None:
    monde.simule.refus_accuse = (400, {"code": "P0001", "message": "attachment_scanning"})
    with pytest.raises(ToolError, match="Refusé par le CRM : attachment_scanning"):
        await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_NON_ANALYSEE, "acknowledge_unscanned": True})
    assert monde.simule.objets_lus == []
    # UNE PIÈCE DEVENUE SAINE ENTRE-TEMPS n'a plus rien à confirmer : elle se lit.
    monde.simule.refus_accuse = (400, {"code": "22023", "message": "attachment_clean"})
    await monde.appel("crm_mail_attachment_get", {"attachment_id": PIECE_NON_ANALYSEE, "acknowledge_unscanned": True})
    assert monde.simule.objets_lus == [("mail-attachments", "ws/m1/nonanalyse")]


async def test_les_listes_rendent_les_statuts_precis(monde: Monde) -> None:
    monde.simule.messages = lambda: [{**CrmMessagerie.messages(monde.simule)[0], "mail_attachments": [
        {"id": PIECE_NON_ANALYSEE, "filename": "releve.pdf", "mime_type": "application/pdf", "size_bytes": 14,
         "av_status": "skipped", "av_skip_reason": "scanner_unavailable", "created_at": "2026-11-10T08:00:00Z"}]}]
    lu = await monde.appel("crm_mail_get", {"message_id": MESSAGE_TEXTE})
    assert [p["status"] for p in lu["attachments"]] == ["not_scanned_unavailable"]
    lecture = next(p for n, p in monde.simule.lectures if n == "mail_messages" and "mail_attachments" in p.get("select", ""))
    assert "av_skip_reason" in lecture["select"] and "created_at" in lecture["select"]


async def test_preparer_avec_des_pieces_les_depose_sous_le_jeton_puis_passe_leurs_chemins(monde: Monde) -> None:
    pdf = base64.b64encode(b"%PDF-1.4 devis").decode()
    rendu = await monde.appel("crm_mail_prepare", {
        "card_id": CARD, "to": ["client@exemple.test"], "subject": "Devis", "body": "Bonjour",
        "attachments": [{"filename": "Devis révisé.pdf", "content_base64": pdf, "mime_type": "application/pdf"},
                        {"filename": "note.txt", "content_base64": base64.b64encode(b"note").decode()}],
    })
    assert [(b, c.split("/")[0], c.split("/")[1], c.split("/")[3], o, ty) for b, c, o, ty, _ in monde.simule.depots] == [
        ("mail-outbound-attachments", ESPACE_A, "sujet-thomas", "Devis revise.pdf", b"%PDF-1.4 devis", "application/pdf"),
        ("mail-outbound-attachments", ESPACE_A, "sujet-thomas", "note.txt", b"note", "application/octet-stream"),
    ]
    # SOUS LE JETON DE LA PERSONNE, jamais la clé de service.
    assert all(not jeton.endswith(CLE_SERVICE) for *_, jeton in monde.simule.depots)
    assert monde.simule.envois[-1]["p_attachments"] == [c for _, c, *_ in monde.simule.depots]
    assert rendu["attachments"] == [{"filename": "Devis revise.pdf", "size_bytes": 14}, {"filename": "note.txt", "size_bytes": 4}]
    assert monde.simule.retraits == []


async def test_les_pieces_sont_bornees_avant_tout_depot(monde: Monde, monkeypatch: pytest.MonkeyPatch) -> None:
    un = base64.b64encode(b"x").decode()
    monkeypatch.setattr(messagerie, "PIECES_OCTETS_MAX", 3)
    with pytest.raises(ToolError, match="attachments_too_large"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": f"f{i}", "content_base64": un} for i in range(4)]})
    with pytest.raises(ToolError, match="content_base64 is not valid base64"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": "f", "content_base64": "pas du base64 !"}]})
    with pytest.raises(ToolError, match="give a filename"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": " ", "content_base64": un}]})
    with pytest.raises(ToolError):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": f"f{i}", "content_base64": un} for i in range(11)]})
    assert monde.simule.depots == [] and monde.simule.envois == [], "aucun dépôt, aucune préparation"


async def test_un_depot_refuse_ou_une_preparation_refusee_retire_ce_qui_a_ete_depose(monde: Monde) -> None:
    un = base64.b64encode(b"x").decode()
    monde.simule.refus_envoi = (400, {"code": "23514", "message": "attachment_not_available"})
    with pytest.raises(ToolError, match="attachment_not_available"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": "a.txt", "content_base64": un}]})
    assert monde.simule.retraits == [[monde.simule.depots[0][1]]]
    monde.simule.refus_envoi = None
    monde.simule.refus_depot = 403
    monde.simule.depots.clear()
    monde.simule.retraits.clear()
    with pytest.raises(ToolError, match="could not be stored"):
        await monde.appel("crm_mail_prepare", {"card_id": CARD, "to": ["a@b.test"], "subject": "s", "body": "b",
                                            "attachments": [{"filename": "a.txt", "content_base64": un}]})
    assert monde.simule.fonctions.count("prepare_email") == 1, "rien n'est préparé quand un dépôt est refusé"

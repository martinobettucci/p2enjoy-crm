# @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.b : les douze outils d'écriture de la famille `affaires`, devant un CRM
#           simulé qui enregistre chaque écriture
# @verifies CRM-067 (docs/BACKLOG.md) — tranche T4 : `crm_card_activity_add` et `crm_card_activity_update`
#           (docs/SPEC-activites.md §6, décision 653 ; aucun outil de retrait, décision 648)
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3 : le sommeil, `move_card`, `move_card_to_channel` et les colonnes de
#           rattachement désignent le rattachement de l'affaire, résolu depuis `card_id` ; `already_attached` est traduit
#           (docs/SPEC-rattachements.md §3.2, §5, §11)
# @verifies docs/SPEC-mcp.md §9.2 ter (liste, ancres, `aussi`, identifiants jugés dans l'affaire), §9.1 (déclarations
#           vérifiées, `destructiveHint`), §9.3 (refus nommés traduits, zéro ligne = refus)
"""Le CRM simulé rend ce que PostgREST rendrait pour chaque écriture, et la note : les tests prouvent la requête émise et
l'issue rendue. Les règles elles-mêmes — transitions, participants, politiques — sont prouvées contre la vraie base par
`tests/test_integration_affaires_ecriture.py`."""

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
from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.jeton_interne import Identite
from crm_mcp.outils import affaires_ecriture, reference
from crm_mcp.outils.affaires_ecriture import choisir_par_nom, instant, refus
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

CARD_A = "c0000000-0000-4000-8000-0000000000c1"
CARD_B = "c0000000-0000-4000-8000-0000000000c2"
RATTACHEMENT_A = "e0000000-0000-4000-8000-0000000000e1"
RATTACHEMENT_B = "e0000000-0000-4000-8000-0000000000e2"
CHANNEL_A = "d0000000-0000-4000-8000-0000000000d1"
CHANNEL_A2 = "d0000000-0000-4000-8000-0000000000d3"
CHANNEL_B = "d0000000-0000-4000-8000-0000000000d2"
CONTACT_A = "a0000000-0000-4000-8000-0000000000b1"
ACTIVITE_A = "a0000000-0000-4000-8000-0000000000aa"
WORKFLOW = "f0000000-0000-4000-8000-0000000000f1"
WORKFLOW_2 = "f0000000-0000-4000-8000-0000000000f2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)

OUTILS = {
    "crm_card_create", "crm_card_comment_add", "crm_card_activity_add", "crm_card_update", "crm_card_move",
    "crm_card_move_to_channel", "crm_card_snooze", "crm_card_wake", "crm_card_contact_link", "crm_card_contact_unlink",
    "crm_card_activity_update", "crm_card_trash",
}


class CrmEcriture(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.ecritures: list[dict[str, Any]] = []
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        #: réponse forcée par table ou fonction : (statut, corps)
        self.forcees: dict[str, tuple[int, Any]] = {}

    def lignes(self, nom: str, parametres: dict[str, str], lisibles: set[str]) -> list[dict[str, Any]] | None:
        cartes = [
            {"id": CARD_A, "workspace_id": ESPACE_A, "workflow_id": WORKFLOW, "title": "Migration ERP"},
            {"id": CARD_B, "workspace_id": ESPACE_B, "workflow_id": WORKFLOW, "title": "Ailleurs"},
        ]
        tables = {
            "cards": [c for c in cartes if c["workspace_id"] in lisibles],
            # `CRM-111` T2.3 : le rattachement unique de chaque affaire, lisible comme elle.
            "card_placements": [r for r in [
                {"id": RATTACHEMENT_A, "card_id": CARD_A, "workspace_id": ESPACE_A},
                {"id": RATTACHEMENT_B, "card_id": CARD_B, "workspace_id": ESPACE_B},
            ] if r["workspace_id"] in lisibles],
            "channels": [c for c in [
                {"id": CHANNEL_A, "workspace_id": ESPACE_A, "workflow_id": WORKFLOW},
                {"id": CHANNEL_A2, "workspace_id": ESPACE_A, "workflow_id": WORKFLOW_2},
                {"id": CHANNEL_B, "workspace_id": ESPACE_B, "workflow_id": WORKFLOW},
            ] if c["workspace_id"] in lisibles],
            "contacts": [{"id": CONTACT_A, "workspace_id": ESPACE_A}] if ESPACE_A in lisibles else [],
            "card_activities": [{"id": ACTIVITE_A, "workspace_id": ESPACE_A, "type": "call", "occurred_at": "t",
                                 "subject": "Appel", "edited_at": None}] if ESPACE_A in lisibles else [],
            "card_activity_participants": [{"activity_id": ACTIVITE_A, "contact_id": CONTACT_A, "profile_id": None}],
            "workflow_steps": [
                {"id": "s1", "workflow_id": WORKFLOW, "noeud": {"label": "Prospection"}},
                {"id": "s2", "workflow_id": WORKFLOW, "noeud": {"label": "Négociation"}},
                {"id": "s9", "workflow_id": WORKFLOW_2, "noeud": {"label": "Accueil"}},
            ],
            "form_fields": [
                {"id": "f1", "workflow_id": WORKFLOW, "key": "budget", "label": "Budget estimé"},
                {"id": "f2", "workflow_id": WORKFLOW, "key": "origine", "label": "Origine du contact"},
            ],
            "workspace_members": [
                {"user_id": "p-camille", "workspace_id": ESPACE_A, "profiles": {"full_name": "Camille Aubert"}},
                {"user_id": "p-driss", "workspace_id": ESPACE_A, "profiles": {"full_name": "Driss Lemoine"}},
            ],
        }
        if nom not in tables:
            return None
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.")}
        return [l for l in tables[nom] if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)]

    async def table_ecriture(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        nom = requete.path_params["table"]
        parametres = dict(requete.query_params)
        if requete.method != "GET":
            corps = await requete.json() if requete.method in ("POST", "PATCH") else None
            self.ecritures.append(
                {"methode": requete.method, "table": nom, "parametres": parametres, "corps": corps,
                 "prefer": requete.headers.get("prefer")}
            )
            if nom in self.forcees:
                statut, rendu = self.forcees[nom]
                return JSONResponse(rendu, status_code=statut)
            return JSONResponse([{"id": "neuf", **(corps or {})}], status_code=201 if requete.method == "POST" else 200)
        lignes = self.lignes(nom, parametres, self._lisibles(personne))
        if lignes is None:
            return await self.table(requete)
        return JSONResponse(lignes)

    async def rpc_ecriture(self, requete: Request) -> Response:
        fonction = requete.path_params["fonction"]
        if fonction in ("creer_affaire", "move_card", "move_card_to_channel", "snooze_card", "wake_card"):
            if self._personne(requete) is None:
                return JSONResponse({"message": "JWT invalide"}, status_code=401)
            self.rpcs.append((fonction, await requete.json()))
            if fonction in self.forcees:
                statut, rendu = self.forcees[fonction]
                return JSONResponse(rendu, status_code=statut)
            return JSONResponse(CARD_A if fonction == "creer_affaire" else {"id": CARD_A})
        return await self.rpc(requete)

    def application(self) -> Starlette:
        return Starlette(
            routes=[
                Route("/rest/v1/rpc/{fonction}", self.rpc_ecriture, methods=["POST"]),
                Route("/rest/v1/{table}", self.table_ecriture, methods=["GET", "POST", "PATCH", "DELETE"]),
            ]
        )


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmEcriture()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.moteur = MoteurPolitique(
            registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires_ecriture.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}

    def ouvrir(self, *cases: tuple[str, str]) -> None:
        self.simule.droits |= {("sujet-thomas", ESPACE_A, f, a) for f, a in cases}

    async def outils(self) -> dict[str, Any]:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name: o for o in await client.list_tools()}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content

    def ecritures(self, table: str) -> list[dict[str, Any]]:
        return [e for e in self.simule.ecritures if e["table"] == table]


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


TOUT = (("affaires", "ajouter"), ("affaires", "modifier"), ("affaires", "supprimer"), ("contacts", "consulter"))


# --- Déclarations ------------------------------------------------------------------------------------------------------


async def test_les_douze_outils_leurs_actions_et_leurs_annotations(monde: Monde) -> None:
    declarations = {n: d for n, d in monde.moteur.declarations.items() if n in OUTILS}
    assert set(declarations) == OUTILS
    assert {n for n, d in declarations.items() if d.action == "ajouter"} == {
        "crm_card_create", "crm_card_comment_add", "crm_card_activity_add"
    }
    assert {n for n, d in declarations.items() if d.action == "supprimer"} == {"crm_card_trash"}
    assert declarations["crm_card_activity_update"].espace == "activity:activity_id"
    assert declarations["crm_card_move_to_channel"].autres == ("channel:to_channel_id",)
    assert declarations["crm_card_contact_link"].aussi == (("contacts", "consulter"),)
    monde.ouvrir(*TOUT)
    outils = await monde.outils()
    destructifs = {n for n in OUTILS if outils[n].annotations.destructive_hint}
    assert destructifs == {"crm_card_move", "crm_card_move_to_channel", "crm_card_trash"}
    assert not any(outils[n].annotations.read_only_hint for n in OUTILS)


async def test_lier_un_contact_exige_aussi_de_consulter_les_contacts(monde: Monde) -> None:
    monde.ouvrir(("affaires", "modifier"))
    assert "crm_card_contact_link" not in await monde.outils()
    monde.ouvrir(("contacts", "consulter"))
    assert "crm_card_contact_link" in await monde.outils()


# --- Les outils -------------------------------------------------------------------------------------------------------


async def test_creer_passe_par_creer_affaire(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    resultat = await monde.appel("crm_card_create", {"channel_id": CHANNEL_A, "title": "Nouvelle piste"})
    assert monde.simule.rpcs == [("creer_affaire", {"p_channel": CHANNEL_A, "p_titre": "Nouvelle piste"})]
    assert resultat["card"]["id"] == CARD_A


async def test_creer_dans_un_channel_d_un_autre_espace_est_le_refus_uniforme(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : channel"):
        await monde.appel("crm_card_create", {"channel_id": CHANNEL_B, "title": "x"})
    assert monde.simule.rpcs == []


async def test_commenter_envoie_l_espace_resolu(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_card_comment_add", {"card_id": CARD_A, "body": "Relance faite"})
    assert monde.ecritures("card_comments")[0]["corps"] == {"card_id": CARD_A, "workspace_id": ESPACE_A, "body": "Relance faite"}


async def test_modifier_n_ecrit_que_les_champs_donnes_nomme_le_responsable_et_fusionne_les_reponses(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel(
        "crm_card_update",
        {"card_id": CARD_A, "description": "", "probability": 60, "owner": "camille aubert", "answers": {"budget": 45000}},
    )
    # `CRM-111` T2.3.2 : la description va à l'affaire, la probabilité et le responsable à son RATTACHEMENT.
    patch = monde.ecritures("cards")[0]
    assert patch["methode"] == "PATCH" and patch["parametres"]["id"] == f"eq.{CARD_A}"
    assert patch["corps"] == {"description": None}
    rattache = monde.ecritures("card_placements")[0]
    assert rattache["methode"] == "PATCH" and rattache["parametres"]["id"] == f"eq.{RATTACHEMENT_A}"
    assert rattache["corps"] == {"probability_override": 60, "owner_id": "p-camille"}
    valeur = monde.ecritures("card_field_values")[0]
    assert valeur["corps"] == {"card_id": CARD_A, "field_id": "f1", "workflow_id": WORKFLOW, "workspace_id": ESPACE_A, "value": 45000}
    assert valeur["parametres"]["on_conflict"] == "card_id,field_id"
    assert "resolution=merge-duplicates" in valeur["prefer"]


async def test_modifier_refuse_un_responsable_inconnu_ou_une_cle_inconnue_avant_d_ecrire(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError, match="No member named"):
        await monde.appel("crm_card_update", {"card_id": CARD_A, "owner": "Personne"})
    with pytest.raises(ToolError, match="Unknown field key"):
        await monde.appel("crm_card_update", {"card_id": CARD_A, "answers": {"inconnue": 1}})
    assert monde.ecritures("card_field_values") == []


async def test_deplacer_resout_l_etape_par_son_nom_et_nomme_les_champs_manquants(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_card_move", {"card_id": CARD_A, "to_step": "négociation", "comment": " Accord "})
    assert monde.simule.rpcs[-1] == ("move_card", {"p_placement": RATTACHEMENT_A, "to_step_id": "s2", "comment": "Accord"})
    monde.simule.forcees["move_card"] = (400, {"code": "P0001", "message": "missing_required_fields", "details": "budget, origine"})
    with pytest.raises(ToolError, match="Budget estimé, Origine du contact"):
        await monde.appel("crm_card_move", {"card_id": CARD_A, "to_step": "Négociation"})
    with pytest.raises(ToolError, match="No step named"):
        await monde.appel("crm_card_move", {"card_id": CARD_A, "to_step": "Accueil"})


async def test_changer_de_channel_cherche_l_etape_dans_le_workflow_d_arrivee(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel(
        "crm_card_move_to_channel",
        {"card_id": CARD_A, "to_channel_id": CHANNEL_A2, "to_step": "Accueil", "discard_field_values": True},
    )
    # `CRM-111` T2.3.4 : l'outil garde `card_id`, et le geste désigne le rattachement de l'affaire.
    assert monde.simule.rpcs[-1] == ("move_card_to_channel", {
        "p_placement": RATTACHEMENT_A, "to_channel_id": CHANNEL_A2, "discard_field_values": True, "to_step_id": "s9"
    })
    monde.simule.forcees["move_card_to_channel"] = (
        400, {"code": "P0001", "message": "field_values_would_be_lost", "details": "3 réponse(s) de formulaire seraient perdues."}
    )
    with pytest.raises(ToolError, match="3 form answer"):
        await monde.appel("crm_card_move_to_channel", {"card_id": CARD_A, "to_channel_id": CHANNEL_A2, "to_step": "Accueil"})
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : channel"):
        await monde.appel("crm_card_move_to_channel", {"card_id": CARD_A, "to_channel_id": CHANNEL_B})
    monde.simule.forcees["move_card_to_channel"] = (400, {"code": "P0001", "message": "already_attached"})
    with pytest.raises(ToolError, match="already attached to that channel"):
        await monde.appel("crm_card_move_to_channel", {"card_id": CARD_A, "to_channel_id": CHANNEL_A2})


async def test_sommeil_et_reveil(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_card_snooze", {"card_id": CARD_A, "until": "2026-12-01"})
    # `CRM-111` T2.3.1 : l'outil garde `card_id`, et le geste désigne le rattachement de l'affaire.
    assert monde.simule.rpcs[-1] == ("snooze_card", {"p_placement": RATTACHEMENT_A, "until": "2026-12-01"})
    await monde.appel("crm_card_wake", {"card_id": CARD_A})
    assert monde.simule.rpcs[-1] == ("wake_card", {"p_placement": RATTACHEMENT_A})
    with pytest.raises(ToolError, match="time zone offset"):
        await monde.appel("crm_card_snooze", {"card_id": CARD_A, "until": "2026-12-01T09:00:00"})


async def test_lier_puis_delier_un_contact(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_card_contact_link", {"card_id": CARD_A, "contact_id": CONTACT_A, "role": " décideur "})
    assert monde.ecritures("card_contacts")[0]["corps"] == {
        "workspace_id": ESPACE_A, "card_id": CARD_A, "contact_id": CONTACT_A, "role": "décideur"
    }
    monde.simule.forcees["card_contacts"] = (409, {"code": "23505", "message": "duplicate key"})
    with pytest.raises(ToolError, match="already_linked"):
        await monde.appel("crm_card_contact_link", {"card_id": CARD_A, "contact_id": CONTACT_A})
    monde.simule.forcees["card_contacts"] = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : contact"):
        await monde.appel("crm_card_contact_unlink", {"card_id": CARD_A, "contact_id": CONTACT_A})


async def test_consigner_une_activite_et_compter_les_participants_refuses(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["card_activity_participants"] = (400, {"code": "23514", "message": "participant_outside_card"})
    resultat = await monde.appel(
        "crm_card_activity_add",
        {"card_id": CARD_A, "type": "meeting", "subject": "Cadrage", "occurred_at": "2026-10-20T10:00:00+02:00",
         "duration_minutes": 45, "participant_contact_ids": ["x"], "participant_member_ids": ["p-camille"]},
    )
    activite = monde.ecritures("card_activities")[0]["corps"]
    assert activite == {"card_id": CARD_A, "type": "meeting", "subject": "Cadrage",
                        "occurred_at": "2026-10-20T10:00:00+02:00", "duration_minutes": 45, "body": None}
    assert resultat["participants_refused"] == ["x", "p-camille"]
    with pytest.raises(ToolError, match="call, meeting or visio"):
        await monde.appel("crm_card_activity_add", {"card_id": CARD_A, "type": "note", "subject": "x"})


async def test_corriger_une_activite_et_ses_participants_par_difference(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel(
        "crm_card_activity_update", {"activity_id": ACTIVITE_A, "subject": "Appel corrigé", "participant_contact_ids": []}
    )
    patch = monde.ecritures("card_activities")[0]
    assert patch["methode"] == "PATCH" and patch["corps"] == {"subject": "Appel corrigé"}
    retrait = monde.ecritures("card_activity_participants")[0]
    assert retrait["methode"] == "DELETE" and retrait["parametres"]["contact_id"] == f"eq.{CONTACT_A}"
    # Les participants seuls : aucun PATCH, l'activité est relue.
    monde.simule.ecritures.clear()
    await monde.appel("crm_card_activity_update", {"activity_id": ACTIVITE_A, "participant_member_ids": ["p-driss"]})
    assert [(e["methode"], e["table"]) for e in monde.simule.ecritures] == [("POST", "card_activity_participants")]


async def test_une_activite_que_la_politique_filtre_est_le_refus_uniforme(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["card_activities"] = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : activité"):
        await monde.appel("crm_card_activity_update", {"activity_id": ACTIVITE_A, "subject": "x"})


async def test_la_corbeille_pose_deleted_at_et_zero_ligne_est_un_refus(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    await monde.appel("crm_card_trash", {"card_id": CARD_A})
    patch = monde.ecritures("cards")[0]
    assert list(patch["corps"]) == ["deleted_at"] and patch["parametres"]["id"] == f"eq.{CARD_A}"
    monde.simule.forcees["cards"] = (200, [])
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
        await monde.appel("crm_card_trash", {"card_id": CARD_A})


# --- Rangements purs --------------------------------------------------------------------------------------------------


def test_les_refus_nommes_et_les_contraintes_sont_traduits() -> None:
    assert "comment_required" in str(refus(Reponse(400, {"code": "P0001", "message": "comment_required"}), "card", "c"))
    assert "Introuvable" in str(refus(Reponse(400, {"code": "P0001", "message": "forbidden"}), "card", "c"))
    assert "subject — 1 to 200" in str(refus(Reponse(400, {
        "code": "23514", "message": 'new row violates check constraint "card_activities_subject_check"'
    }), "card", "c"))
    assert "Introuvable" in str(refus(Reponse(403, {"code": "42501", "message": "denied"}), "card", "c"))


def test_un_nom_ambigu_n_est_jamais_tranche() -> None:
    candidats = [{"id": "1", "nom": "Relance"}, {"id": "2", "nom": "relance"}]
    with pytest.raises(ToolError, match="Several"):
        choisir_par_nom(candidats, "Relance", "step")
    assert choisir_par_nom([{"id": "1", "nom": "Relance"}], " relance ", "step") == "1"


def test_un_instant_sans_fuseau_est_refuse() -> None:
    assert instant("2026-10-23", "x") == "2026-10-23"
    assert instant("2026-10-23T10:00:00Z", "x") == "2026-10-23T10:00:00+00:00"
    with pytest.raises(ToolError):
        instant("23/10/2026", "x")
    with pytest.raises(ToolError):
        instant("2026-10-23T10:00:00", "x")

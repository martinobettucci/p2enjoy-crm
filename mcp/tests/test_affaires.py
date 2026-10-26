# @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.a : les sept outils de lecture de la famille `affaires`, devant un CRM
# @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé rendus tels quels par crm_card_list et
#           crm_card_get, et demandés avec la ligne ; docs/SPEC-analytique.md §13.7 ; décision 708 (M4 B)
#           simulé, et leurs rangements purs
# @verifies CRM-067 (docs/BACKLOG.md) — tranche T4 : `crm_card_activity_list` (docs/SPEC-activites.md §6, décision 653)
# @verifies docs/SPEC-mcp.md §9.2 bis (liste fixée, ancres, ancre `channel` facultative), §6.2 (visibilité par la matrice,
#           refus uniforme), §9.1 (déclarations vérifiées au démarrage), §9.3 (identifiants ET libellés) ;
#           docs/SPEC-cards.md §14.10 (fusion du fil, ordre total), §14.6 (libellés résolus, jamais lus dans le payload)
"""Le CRM simulé étend celui de `conftest.py` avec les tables d'une affaire ; la RLS y est réduite à « l'espace est
lisible ». Les lectures réelles — embarquements nommés, filtres imbriqués, RLS — sont prouvées contre la vraie base par
`tests/test_integration_affaires.py`."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

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
from crm_mcp.outils import affaires, reference
from crm_mcp.outils.affaires import (
    bornes_journee,
    detail_evenement,
    fusionner_fil,
    ligne_activite,
    ligne_commentaire,
    nettoyer_texte,
    probabilite,
    section_echeance,
)
from crm_mcp.politique import Declaration, DeclarationInvalide, MoteurPolitique, PolitiqueOutils
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

CARD_A = "c0000000-0000-4000-8000-0000000000c1"
CARD_B = "c0000000-0000-4000-8000-0000000000c2"
CHANNEL_A = "d0000000-0000-4000-8000-0000000000d1"
CHANNEL_B = "d0000000-0000-4000-8000-0000000000d2"
WORKFLOW = "f0000000-0000-4000-8000-0000000000f1"
ETAPE_1 = "e0000000-0000-4000-8000-0000000000e1"
ETAPE_2 = "e0000000-0000-4000-8000-0000000000e2"
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)

OUTILS = {
    "crm_card_list",
    "crm_card_get",
    "crm_card_timeline",
    "crm_card_comment_list",
    "crm_card_activity_list",
    "crm_stale_card_list",
    "crm_card_mine",
}


class CrmAffaires(CrmSimule):
    requetes: list[tuple[str, dict[str, str]]]

    def __init__(self) -> None:
        super().__init__()
        self.requetes = []

    def _cards(self) -> list[dict[str, Any]]:
        etape = {"id": ETAPE_1, "probability_override": None, "noeud": {"label": "Prospection", "default_probability": 20}}
        canal = {"id": CHANNEL_A, "name": "Grands comptes", "slug": "gc", "track": {"id": "t", "name": "Conseil", "slug": "c"}}
        return [
            {
                "id": CARD_A, "title": "Migration ERP", "workspace_id": ESPACE_A, "workflow_id": WORKFLOW,
                "description": "Reprise des achats", "amount": 125000, "currency": "EUR", "probability_override": None,
                "next_action": "Cadrage", "next_action_at": "2026-10-22T08:00:00+00:00", "snoozed_until": None,
                "archived_at": None, "email_local_part": "c-x", "entered_step_at": "2026-10-01T00:00:00+00:00",
                "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-02T00:00:00+00:00",
                "ecriture_permise": True, "responsable": {"id": "p", "full_name": "Driss Lemoine"}, "channel": canal,
                "etape": etape,
                "health_momentum": {"score": 85, "tier": "healthy", "penalties": [{"code": "next_action_missing", "points": 15}]},
                "health_commercial": {"score": 62, "tier": "watch", "signals": [
                    {"code": "probability", "weight": 40, "value": 20},
                    {"code": "step_age", "weight": 15, "value": None, "status": "unknown"}]},
            },
            {"id": CARD_B, "title": "Autre espace", "workspace_id": ESPACE_B, "workflow_id": WORKFLOW},
        ]

    async def table_affaires(self, requete: Request) -> Response:
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        lisibles = self._lisibles(personne)
        nom = requete.path_params["table"]
        parametres = dict(requete.query_params)
        self.requetes.append((nom, parametres))
        filtres = {k: v.removeprefix("eq.") for k, v in parametres.items() if v.startswith("eq.") and "." not in k}
        if nom == "cards":
            lignes = [c for c in self._cards() if c["workspace_id"] in lisibles]
        elif nom == "channels":
            lignes = [{"id": CHANNEL_A, "name": "Grands comptes", "workspace_id": ESPACE_A},
                      {"id": CHANNEL_B, "name": "Ailleurs", "workspace_id": ESPACE_B}]
            lignes = [c for c in lignes if c["workspace_id"] in lisibles]
            if parametres.get("id", "").startswith("in."):
                return JSONResponse(lignes)
        elif nom == "workflows":
            lignes = [{"id": WORKFLOW, "name": "Cycle de vente"}]
        elif nom == "workflow_steps":
            return JSONResponse([
                {"id": ETAPE_1, "noeud": {"label": "Prospection"}}, {"id": ETAPE_2, "noeud": {"label": "Négociation"}}
            ])
        elif nom == "card_contacts":
            lignes = [{"card_id": CARD_A, "contact_id": "k1", "role": "decideur",
                       "contacts": {"id": "k1", "full_name": "Léo Marchand", "organizations": {"id": "o", "name": "Sogexia"}}}]
        elif nom == "card_field_values":
            lignes = [{"card_id": CARD_A, "field_id": "f1", "value": "salon"}, {"card_id": CARD_A, "field_id": "f2", "value": 45000}]
        elif nom == "form_fields":
            return JSONResponse([
                {"id": "f1", "key": "origine", "label": "Origine du contact", "type": "select",
                 "options": {"choices": [{"key": "salon", "label": "Salon"}]}},
                {"id": "f2", "key": "budget", "label": "Budget estimé", "type": "amount", "options": None},
            ])
        elif nom == "contacts":
            return JSONResponse([{"id": "k1", "full_name": "Léo Marchand"}])
        elif nom == "card_events":
            lignes = [
                {"card_id": CARD_A, "id": "e1", "type": "created", "payload": {}, "created_at": "2026-10-01T09:00:00+00:00",
                 "acteur": {"full_name": "Camille Aubert"}},
                {"card_id": CARD_A, "id": "e2", "type": "moved",
                 "payload": {"from_step_id": ETAPE_1, "to_step_id": ETAPE_2}, "created_at": "2026-10-03T09:00:00+00:00",
                 "acteur": None},
            ]
        elif nom == "card_comments":
            lignes = [{"card_id": CARD_A, "id": "c1", "body": "Bonjour", "author_id": "p", "created_at": "2026-10-02T09:00:00+00:00",
                       "edited_at": None, "deleted_at": None, "deleted_by": None, "auteur": {"full_name": "Driss Lemoine"}}]
        elif nom == "card_activities":
            lignes = [{"card_id": CARD_A, "id": "a1", "type": "call", "occurred_at": "2026-10-02T15:00:00+00:00",
                       "duration_minutes": 30, "subject": "Appel", "body": None, "author_id": "p",
                       "created_at": "2026-10-05T09:00:00+00:00", "edited_at": None, "deleted_at": None, "deleted_by": None,
                       "auteur": {"full_name": "Driss Lemoine"}, "participants": []}]
        else:
            return await self.table(requete)
        lignes = [l for l in lignes if all(str(l.get(k)) == v for k, v in filtres.items() if k in l)]
        return JSONResponse(lignes)

    async def rpc_affaires(self, requete: Request) -> Response:
        if requete.path_params["fonction"] == "cards_figees":
            if self._personne(requete) is None:
                return JSONResponse({"message": "JWT invalide"}, status_code=401)
            base = {"channel_id": CHANNEL_A, "owner_id": None, "step_id": ETAPE_1, "entered_step_at": "2026-09-01",
                    "seuil_jours": 14, "jours_dans_etape": 20}
            return JSONResponse([
                {**base, "card_id": "x1", "workspace_id": ESPACE_A, "title": "Petit retard", "retard_jours": 6},
                {**base, "card_id": "x2", "workspace_id": ESPACE_A, "title": "Gros retard", "retard_jours": 30},
                {**base, "card_id": "x3", "workspace_id": ESPACE_B, "title": "Autre espace", "retard_jours": 99},
            ])
        return await self.rpc(requete)

    def application(self) -> Starlette:
        return Starlette(
            routes=[
                Route("/rest/v1/rpc/{fonction}", self.rpc_affaires, methods=["POST"]),
                Route("/rest/v1/{table}", self.table_affaires, methods=["GET"]),
            ]
        )


class Monde:
    def __init__(self) -> None:
        import httpx2

        self.simule = CrmAffaires()
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=self.simule.application())
        )
        self.registre = Registre(self.crm, ())
        self.moteur = MoteurPolitique(
            registre=self.registre, crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}

    def ouvrir(self, *cases: tuple[str, str]) -> None:
        self.simule.droits |= {("sujet-thomas", ESPACE_A, f, a) for f, a in cases}

    async def outils(self) -> set[str]:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name for o in await client.list_tools()}

    async def appel(self, outil: str, arguments: dict[str, Any]) -> Any:
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments)).structured_content

    def requetes(self, table: str) -> list[dict[str, str]]:
        return [p for n, p in self.simule.requetes if n == table]


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


# --- Déclarations et visibilité ----------------------------------------------------------------------------------------


async def test_les_sept_outils_sont_declares_en_consultation_et_lecture_seule(monde: Monde) -> None:
    declares = {n for n, d in monde.moteur.declarations.items() if d.famille == "affaires"}
    assert declares == OUTILS
    assert all(monde.moteur.declarations[n].action == "consulter" for n in OUTILS)
    assert monde.moteur.declarations["crm_card_list"].autres == ("channel:channel_id",)
    assert monde.moteur.facultatives["crm_card_list"] == frozenset({"channel_id"})


async def test_visibles_seulement_quand_la_matrice_ouvre_affaires_consulter(monde: Monde) -> None:
    assert not (await monde.outils()) & OUTILS
    monde.ouvrir(("affaires", "ajouter"))
    assert not (await monde.outils()) & OUTILS
    monde.ouvrir(("affaires", "consulter"))
    assert OUTILS <= await monde.outils()


def test_l_ancre_d_espace_ne_peut_pas_etre_facultative() -> None:
    with pytest.raises(DeclarationInvalide, match="ancre d'espace est obligatoire"):
        Declaration(famille="affaires", action="consulter", espace="workspace:workspace").verifier(
            "x", {"workspace"}, False, frozenset({"workspace"})
        )


# --- Les outils -------------------------------------------------------------------------------------------------------


async def test_une_affaire_d_un_autre_espace_rend_le_refus_uniforme(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    for outil in ("crm_card_get", "crm_card_timeline", "crm_card_comment_list", "crm_card_activity_list"):
        with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
            await monde.appel(outil, {"card_id": CARD_B})


async def test_la_liste_sans_channel_ne_resout_aucune_ancre_et_filtre_par_l_espace(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    resultat = await monde.appel("crm_card_list", {"workspace": "atelier"})
    assert [c["title"] for c in resultat["cards"]] == ["Migration ERP"]
    assert resultat["cards"][0]["step"] == {"id": ETAPE_1, "name": "Prospection"}
    assert monde.requetes("channels") == []
    envoye = monde.requetes("cards")[-1]
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}"
    assert envoye["archived_at"] == "is.null" and envoye["deleted_at"] == "is.null"
    assert envoye["or"].startswith("(snoozed_until.is.null,snoozed_until.lte.")


async def test_un_channel_d_un_autre_espace_est_lu_et_refuse(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : channel"):
        await monde.appel("crm_card_list", {"workspace": "atelier", "channel_id": CHANNEL_B})
    resultat = await monde.appel("crm_card_list", {"workspace": "atelier", "channel_id": CHANNEL_A})
    assert monde.requetes("cards")[-1]["channel_id"] == f"eq.{CHANNEL_A}"
    assert resultat["has_more"] is False


async def test_la_liste_traduit_ses_filtres_pour_postgrest(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    await monde.appel(
        "crm_card_list",
        {"workspace": "atelier", "query": "ERP*,(x)", "step": "Négociation", "due": "today", "include_snoozed": True},
    )
    envoye = monde.requetes("cards")[-1]
    assert envoye["title"] == "ilike.*ERP   x*"
    assert envoye["etape.noeud.label"] == "eq.Négociation"
    assert "cards_current_step_id_workflow_id_fkey!inner(" in envoye["select"]
    assert "workflow_nodes_catalog!inner(" in envoye["select"]
    assert envoye["next_action_at"].startswith("lt.") and envoye["and"].startswith("(next_action_at.gte.")
    assert "or" not in envoye
    with pytest.raises(ToolError, match="due must be"):
        await monde.appel("crm_card_list", {"workspace": "atelier", "due": "hier"})


async def test_la_fiche_nomme_tout_et_rend_la_capacite_d_ecrire(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    fiche = await monde.appel("crm_card_get", {"card_id": CARD_A})
    assert fiche["title"] == "Migration ERP" and fiche["description"] == "Reprise des achats"
    assert fiche["channel"]["name"] == "Grands comptes" and fiche["workflow"]["name"] == "Cycle de vente"
    assert fiche["probability"] == {"value": 20, "source": "node"}
    assert fiche["can_write"] is True
    assert fiche["contacts"] == [{"id": "k1", "name": "Léo Marchand", "organization": "Sogexia", "role": "decideur"}]
    assert fiche["form_answers"] == [
        {"field": "Origine du contact", "key": "origine", "type": "select", "value": "salon", "value_label": "Salon"},
        {"field": "Budget estimé", "key": "budget", "type": "amount", "value": 45000},
    ]


async def test_le_fil_fusionne_trois_sources_dans_l_ordre_ou_l_histoire_s_est_ecrite(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    fil = await monde.appel("crm_card_timeline", {"card_id": CARD_A})
    assert [(e["kind"], e["at"][:10]) for e in fil["entries"]] == [
        ("event", "2026-10-01"), ("comment", "2026-10-02"), ("activity", "2026-10-02"), ("event", "2026-10-03")
    ]
    assert fil["entries"][3]["detail"] == {"from_step": "Prospection", "to_step": "Négociation"}
    assert fil["entries"][0]["actor"] == "Camille Aubert"
    page = await monde.appel("crm_card_timeline", {"card_id": CARD_A, "limit": 2, "offset": 2})
    assert page["total"] == 4 and [e["kind"] for e in page["entries"]] == ["activity", "event"]


async def test_les_affaires_figees_restent_dans_l_espace_et_se_rangent_par_retard(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    figees = await monde.appel("crm_stale_card_list", {"workspace": "atelier"})
    assert [c["title"] for c in figees["cards"]] == ["Gros retard", "Petit retard"]
    assert figees["cards"][0]["step"]["name"] == "Prospection" and figees["cards"][0]["channel"]["name"] == "Grands comptes"


async def test_ma_journee_filtre_par_la_personne_sous_la_portee_mine(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    journee = await monde.appel("crm_card_mine", {"workspace": "atelier"})
    assert monde.requetes("cards")[-1]["owner_id"] == "eq.sujet-thomas"
    assert [c["title"] for c in journee["overdue"]] == ["Migration ERP"]
    await monde.appel("crm_card_mine", {"workspace": "atelier", "scope": "all"})
    assert "owner_id" not in monde.requetes("cards")[-1]
    with pytest.raises(ToolError, match="timezone"):
        await monde.appel("crm_card_mine", {"workspace": "atelier", "timezone": "Mars/Olympus"})


# --- Rangements purs --------------------------------------------------------------------------------------------------


def test_la_probabilite_suit_la_carte_puis_l_etape_puis_le_noeud() -> None:
    etape = {"probability_override": 40, "noeud": {"default_probability": 20}}
    assert probabilite({"probability_override": 70, "etape": etape}) == {"value": 70, "source": "card"}
    assert probabilite({"probability_override": None, "etape": etape}) == {"value": 40, "source": "step"}
    assert probabilite({"probability_override": None, "etape": {"noeud": {"default_probability": 0}}}) == {
        "value": 0, "source": "node"
    }
    assert probabilite({}) == {"value": None, "source": None}


def test_un_libelle_non_resolu_est_absent_jamais_un_identifiant() -> None:
    assert detail_evenement("moved", {"from_step_id": "a", "to_step_id": "b"}, {"a": "Un"}, {}, {}) == {}
    assert detail_evenement("field_changed", {"field_id": "f"}, {}, {}, {}) == {}
    assert detail_evenement("contact_linked", {"contact_id": "k", "role": "x"}, {}, {}, {"k": "Léo"}) == {
        "contact": "Léo", "role": "x"
    }
    assert detail_evenement("contact_role_changed", {"contact_id": "k", "from": "a", "to": "b"}, {}, {}, {"k": "Léo"}) == {
        "contact": "Léo", "from_role": "a", "to_role": "b"
    }
    assert detail_evenement("stalled", {"seuil_jours": 14, "retard_jours": 2}, {}, {}, {}) == {
        "threshold_days": 14, "overdue_days": 2
    }
    assert detail_evenement("stalled", {"seuil_jours": "14"}, {}, {}, {}) == {}
    assert detail_evenement("snoozed", {"until": "2026-11-01"}, {}, {}, {}) == {"until": "2026-11-01"}


def test_la_fusion_est_totale_et_compare_des_instants() -> None:
    fil = fusionner_fil(
        [{"id": "x", "at": "2026-10-01T10:00:00+02:00"}],
        [{"id": "x", "created_at": "2026-10-01T08:00:00Z"}],
        [{"id": "x", "occurred_at": "2026-10-01T08:00:00+00:00"}],
    )
    # Trois écritures du MÊME instant : la clé départage, `a:` < `c:` < `e:`.
    assert [l["kind"] for l in fil] == ["activity", "comment", "event"]


def test_pierres_tombales_et_moderation() -> None:
    retire = ligne_commentaire({"id": "c", "body": "", "author_id": "a", "created_at": "t", "deleted_at": "t", "deleted_by": "m"})
    assert retire["deleted"] and retire["removed_by_moderation"] and retire["body"] is None
    propre = ligne_commentaire({"id": "c", "body": "", "author_id": "a", "created_at": "t", "deleted_at": "t", "deleted_by": "a"})
    assert not propre["removed_by_moderation"]
    activite = ligne_activite({
        "id": "a", "type": "call", "occurred_at": "t", "duration_minutes": 30, "subject": "", "body": None,
        "author_id": "a", "deleted_at": "t", "deleted_by": "m",
        "participants": [{"contact_id": "k", "profile_id": None, "contact": None, "profil": None}],
    })
    assert activite["retired_by_moderation"] and activite["subject"] is None and activite["duration_minutes"] is None
    assert activite["contacts"] == []


def test_le_texte_d_un_filtre_perd_les_caracteres_de_postgrest() -> None:
    assert nettoyer_texte("a*b,c(d).e%f\"g") == "a b c d  e f g"
    assert nettoyer_texte("  ***  ") == ""


def test_les_bornes_de_la_journee_suivent_le_fuseau() -> None:
    maintenant = datetime(2026, 10, 23, 22, 30, tzinfo=UTC)  # le 24 à 0 h 30 à Paris
    bornes = bornes_journee(maintenant, ZoneInfo("Europe/Paris"))
    assert bornes[0] == datetime(2026, 10, 23, 22, 0, tzinfo=UTC)
    assert section_echeance("2026-10-23T21:59:00+00:00", bornes) == "overdue"
    assert section_echeance("2026-10-24T12:00:00+00:00", bornes) == "today"
    assert section_echeance("2026-10-30T12:00:00+00:00", bornes) == "upcoming"
    assert section_echeance("2026-11-02T12:00:00+00:00", bornes) is None


async def test_les_deux_scores_de_sante_sont_rendus_par_la_liste_et_la_fiche(monde: Monde) -> None:
    monde.ouvrir(("affaires", "consulter"))
    fiche = await monde.appel("crm_card_get", {"card_id": CARD_A})
    assert fiche["health_momentum"] == {"score": 85, "tier": "healthy",
                                        "penalties": [{"code": "next_action_missing", "points": 15}]}
    assert fiche["health_commercial"]["signals"][1] == {"code": "step_age", "weight": 15, "value": None, "status": "unknown"}
    liste = await monde.appel("crm_card_list", {"workspace": "atelier"})
    assert liste["cards"][0]["health_commercial"]["score"] == 62
    # LES DEUX COLONNES CALCULÉES SONT DEMANDÉES À LA BASE, avec la ligne : l'outil ne calcule rien.
    # (La résolution de l'ancre lit aussi `cards`, sans le titre : elle n'est pas une lecture de l'affaire.)
    demandes = [p["select"] for p in monde.requetes("cards") if "title" in p.get("select", "")]
    assert len(demandes) == 2 and all("health_momentum" in s and "health_commercial" in s for s in demandes)

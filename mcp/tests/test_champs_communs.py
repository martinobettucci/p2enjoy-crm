# @verifies CRM-112 (docs/BACKLOG.md) — tranche T9 : les champs de l'affaire dans le connecteur — `crm_common_field_list`
#           (famille `affaires`, consulter), la partie commune de `crm_card_get`, `common_fields` de `crm_card_update` (mise
#           à jour, puis insertion, reprise sur conflit, clé inconnue ou champ archivé refusés avant tout geste,
#           `invalid_field_value` nommé) et les filtres directs de `crm_card_list`, contrôlés et nommés
#           (docs/SPEC-mcp.md §9.2 sexdecies ; docs/SPEC-champs-communs.md §7, §8, §11 ; décisions 664, 837 et 846)
"""Devant les CRM simulés de `test_affaires.py` (lecture) et `test_affaires_ecriture.py` (écriture), garnis de champs de
l'affaire. Les vraies tables, leurs politiques et `app.validate_field_value` sont prouvées par
`tests/test_integration_champs_communs.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm
from crm_mcp.outils import affaires, affaires_ecriture, champs_communs, reference
from crm_mcp.outils.champs_communs import champ_en_clair, controler_filtres, partie_commune, verifier_cles
from crm_mcp.politique import MoteurPolitique, PolitiqueOutils, RefusCrm
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET
from .test_affaires import CARD_A, THOMAS, CrmAffaires
from .test_affaires_ecriture import CrmEcriture

ARCHIVE = "2026-10-01T00:00:00+00:00"
CHAMPS = [
    {"id": "cf1", "workspace_id": ESPACE_A, "key": "siret", "label": "SIRET", "type": "text", "options": None,
     "help_text": "Quatorze chiffres", "is_listed": True, "position": 1, "archived_at": None},
    {"id": "cf2", "workspace_id": ESPACE_A, "key": "segment", "label": "Segment", "type": "select",
     "options": {"choices": [{"key": "pme", "label": "PME"}, {"key": "eti", "label": "ETI"}]}, "help_text": None,
     "is_listed": False, "position": 2, "archived_at": None},
    {"id": "cf3", "workspace_id": ESPACE_A, "key": "budget", "label": "Budget", "type": "money",
     "options": {"currency": "EUR"}, "help_text": None, "is_listed": False, "position": 3, "archived_at": None},
    {"id": "cf4", "workspace_id": ESPACE_A, "key": "ancien-code", "label": "Ancien code", "type": "text", "options": None,
     "help_text": None, "is_listed": False, "position": 4, "archived_at": ARCHIVE},
    {"id": "cf5", "workspace_id": ESPACE_A, "key": "abandonne", "label": "Abandonné", "type": "text", "options": None,
     "help_text": None, "is_listed": False, "position": 5, "archived_at": ARCHIVE},
    {"id": "cfb", "workspace_id": ESPACE_B, "key": "ailleurs", "label": "Ailleurs", "type": "text", "options": None,
     "help_text": None, "is_listed": False, "position": 1, "archived_at": None},
]
VALEURS = [
    {"card_id": CARD_A, "field_id": "cf1", "workspace_id": ESPACE_A, "value": "55210055400013"},
    {"card_id": CARD_A, "field_id": "cf2", "workspace_id": ESPACE_A, "value": "pme"},
    {"card_id": CARD_A, "field_id": "cf4", "workspace_id": ESPACE_A, "value": "X-12"},
]


class Monde:
    def __init__(self, simule: CrmAffaires | CrmEcriture) -> None:
        import httpx2

        self.simule = simule
        simule.communs = {"card_common_fields": list(CHAMPS), "card_common_field_values": list(VALEURS)}
        self.crm = ClientCrm(
            "http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=httpx2.ASGITransport(app=simule.application())
        )
        self.moteur = MoteurPolitique(
            registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _j: THOMAS
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        affaires.ajouter(self.mcp, self.moteur, self.crm)
        affaires_ecriture.ajouter(self.mcp, self.moteur, self.crm)
        champs_communs.ajouter(self.mcp, self.moteur, self.crm)
        self.mcp.add_middleware(AuditOutils(self.moteur.registre, 200_000))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        simule.membres = {"sujet-thomas": {ESPACE_A: "editor"}}

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


@pytest.fixture
async def lecture():
    m = Monde(CrmAffaires())
    yield m
    await m.crm.fermer()


@pytest.fixture
async def ecriture():
    m = Monde(CrmEcriture())
    yield m
    await m.crm.fermer()


def ecrites(monde: Monde) -> list[dict[str, Any]]:
    assert isinstance(monde.simule, CrmEcriture)
    return [e for e in monde.simule.ecritures if e["table"] == "card_common_field_values"]


ECRIRE = (("affaires", "consulter"), ("affaires", "modifier"))


# --- Fonctions pures --------------------------------------------------------------------------------------------------


def test_une_definition_en_clair_porte_ses_choix_sa_devise_et_son_aide() -> None:
    assert champ_en_clair(CHAMPS[0]) == {
        "key": "siret", "label": "SIRET", "type": "text", "help": "Quatorze chiffres", "listed": True, "archived": False
    }
    assert champ_en_clair(CHAMPS[1])["choices"] == [{"key": "pme", "label": "PME"}, {"key": "eti", "label": "ETI"}]
    assert champ_en_clair(CHAMPS[2])["currency"] == "EUR"
    assert champ_en_clair(CHAMPS[3])["archived"] is True and "choices" not in champ_en_clair(CHAMPS[3])


def test_la_partie_commune_rend_les_actifs_puis_les_archives_qui_portent_une_valeur() -> None:
    rendu = partie_commune(CHAMPS[:5], {"cf1": "552", "cf2": "pme", "cf4": "X-12"})
    assert [(l["key"], l["value"], l["archived"]) for l in rendu] == [
        ("siret", "552", False), ("segment", "pme", False), ("budget", None, False), ("ancien-code", "X-12", True)
    ]
    assert rendu[1]["value_label"] == "PME" and "value_label" not in rendu[0]
    assert partie_commune([], {}) == []


def test_les_filtres_directs_nomment_la_cle_inconnue_ou_archivee_et_la_forme_qui_ne_convient_pas() -> None:
    actifs = {c["key"]: c for c in CHAMPS[:3]}
    assert controler_filtres({"siret": {"contains": "552"}, "budget": {"min": 1000}}, actifs) == {
        "siret": {"contains": "552"}, "budget": {"min": 1000}
    }
    with pytest.raises(ToolError, match=r"Unknown or archived field key 'ancien-code'\. Active keys: budget, segment, siret"):
        controler_filtres({"ancien-code": {"contains": "X"}}, actifs)
    with pytest.raises(ToolError, match=r"does not fit its type select: give \{\"any_of\""):
        controler_filtres({"segment": {"contains": "pme"}}, actifs)
    with pytest.raises(ToolError, match="must be an object"):
        controler_filtres({"budget": 1000}, actifs)
    with pytest.raises(ToolError, match="does not fit its type money"):
        controler_filtres({"budget": {}}, actifs)


def test_les_cles_a_ecrire_sont_jugees_avant_tout_geste() -> None:
    assert set(verifier_cles({"siret": "1"}, CHAMPS[:5])) == {"siret", "segment", "budget", "ancien-code", "abandonne"}
    with pytest.raises(ToolError, match=r"Unknown field key 'inconnue'\. Active keys: budget, segment, siret"):
        verifier_cles({"inconnue": 1}, CHAMPS[:5])
    with pytest.raises(RefusCrm, match="common_field_archived — 'ancien-code' is archived"):
        verifier_cles({"ancien-code": "Y"}, CHAMPS[:5])


# --- crm_common_field_list --------------------------------------------------------------------------------------------


async def test_la_liste_est_declaree_en_consultation_des_affaires_et_n_apparait_qu_ouverte(lecture: Monde) -> None:
    declaration = lecture.moteur.declarations["crm_common_field_list"]
    assert (declaration.famille, declaration.action, declaration.espace) == ("affaires", "consulter", "workspace:workspace")
    assert "crm_common_field_list" not in await lecture.outils()
    lecture.ouvrir(("affaires", "modifier"))
    assert "crm_common_field_list" not in await lecture.outils()
    lecture.ouvrir(("affaires", "consulter"))
    assert "crm_common_field_list" in await lecture.outils()


async def test_la_liste_rend_les_champs_de_l_espace_et_les_archives_sur_demande(lecture: Monde) -> None:
    lecture.ouvrir(("affaires", "consulter"))
    actifs = await lecture.appel("crm_common_field_list", {"workspace": "atelier"})
    assert [c["key"] for c in actifs["fields"]] == ["siret", "segment", "budget"]
    tous = await lecture.appel("crm_common_field_list", {"workspace": "atelier", "include_archived": True})
    assert [(c["key"], c["archived"]) for c in tous["fields"]][-2:] == [("ancien-code", True), ("abandonne", True)]
    envoye = [p for n, p in lecture.simule.requetes if n == "card_common_fields"][0]
    assert envoye["workspace_id"] == f"eq.{ESPACE_A}" and envoye["archived_at"] == "is.null"
    assert envoye["order"] == "position.asc,key.asc"


# --- crm_card_get -----------------------------------------------------------------------------------------------------


async def test_la_fiche_rend_la_partie_commune_de_l_affaire(lecture: Monde) -> None:
    lecture.ouvrir(("affaires", "consulter"))
    fiche = await lecture.appel("crm_card_get", {"card_id": CARD_A})
    assert [(l["key"], l["value"]) for l in fiche["common_fields"]] == [
        ("siret", "55210055400013"), ("segment", "pme"), ("budget", None), ("ancien-code", "X-12")
    ]
    assert fiche["common_fields"][1]["value_label"] == "PME" and fiche["common_fields"][3]["archived"] is True
    valeurs = [p for n, p in lecture.simule.requetes if n == "card_common_field_values"][0]
    assert valeurs["card_id"] == f"eq.{CARD_A}"


# --- crm_card_list ----------------------------------------------------------------------------------------------------


async def test_la_liste_des_affaires_filtre_par_les_champs_et_nomme_la_cle_inconnue(lecture: Monde) -> None:
    lecture.ouvrir(("affaires", "consulter"))
    await lecture.appel("crm_card_list", {"workspace": "atelier", "common_fields": {"segment": {"any_of": ["pme"]}}})
    envoye = [p for n, p in lecture.simule.requetes if n == "card_placements"][-1]
    assert "fc0:card_common_field_values!inner(field_id)" in envoye["select"]
    assert envoye["affaire.fc0.and"] == '(field_id.eq.cf2,value.cd."[\\"pme\\"]")'
    with pytest.raises(ToolError, match="Unknown or archived field key 'ancien-code'"):
        await lecture.appel("crm_card_list", {"workspace": "atelier", "common_fields": {"ancien-code": {"contains": "X"}}})
    with pytest.raises(ToolError, match="does not fit its type select"):
        await lecture.appel("crm_card_list", {"workspace": "atelier", "common_fields": {"segment": {"min": 1}}})


# --- crm_card_update --------------------------------------------------------------------------------------------------


async def test_modifier_met_a_jour_la_valeur_existante_par_sa_cle(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    await ecriture.appel("crm_card_update", {"card_id": CARD_A, "common_fields": {"siret": "11122233300044"}})
    [patch] = ecrites(ecriture)
    assert patch["methode"] == "PATCH" and patch["corps"] == {"value": "11122233300044"}
    assert patch["parametres"]["card_id"] == f"eq.{CARD_A}" and patch["parametres"]["field_id"] == "eq.cf1"


async def test_modifier_insere_la_valeur_absente_et_null_la_vide(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    assert isinstance(ecriture.simule, CrmEcriture)
    ecriture.simule.forcees[("card_common_field_values", "PATCH")] = (200, [])
    await ecriture.appel("crm_card_update", {"card_id": CARD_A, "common_fields": {"budget": None}})
    patch, post = ecrites(ecriture)
    assert patch["methode"] == "PATCH" and patch["corps"] == {"value": None}
    assert post["methode"] == "POST"
    assert post["corps"] == {"card_id": CARD_A, "field_id": "cf3", "workspace_id": ESPACE_A, "value": None}


async def test_modifier_reprend_la_mise_a_jour_quand_la_ligne_est_nee_entre_temps(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    assert isinstance(ecriture.simule, CrmEcriture)
    ecriture.simule.forcees[("card_common_field_values", "PATCH")] = [(200, []), (200, [{"field_id": "cf3"}])]
    ecriture.simule.forcees[("card_common_field_values", "POST")] = (409, {"code": "23505", "message": "duplicate key"})
    await ecriture.appel("crm_card_update", {"card_id": CARD_A, "common_fields": {"budget": 12000}})
    assert [e["methode"] for e in ecrites(ecriture)] == ["PATCH", "POST", "PATCH"]


async def test_modifier_refuse_une_cle_inconnue_ou_archivee_avant_d_ecrire_l_en_tete(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    assert isinstance(ecriture.simule, CrmEcriture)
    with pytest.raises(ToolError, match="Unknown field key 'inconnue'"):
        await ecriture.appel("crm_card_update", {"card_id": CARD_A, "title": "Neuf", "common_fields": {"inconnue": 1}})
    with pytest.raises(ToolError, match="common_field_archived"):
        await ecriture.appel("crm_card_update", {"card_id": CARD_A, "title": "Neuf", "common_fields": {"ancien-code": "Y"}})
    assert ecriture.simule.ecritures == []


async def test_modifier_nomme_la_valeur_refusee_par_le_crm(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    assert isinstance(ecriture.simule, CrmEcriture)
    ecriture.simule.forcees[("card_common_field_values", "PATCH")] = (400, {"code": "22023", "message": "invalid_field_value"})
    with pytest.raises(ToolError, match="invalid_field_value — the value of 'segment' does not fit"):
        await ecriture.appel("crm_card_update", {"card_id": CARD_A, "common_fields": {"segment": "inconnu"}})


async def test_modifier_une_affaire_d_un_autre_espace_rend_le_refus_uniforme(ecriture: Monde) -> None:
    ecriture.ouvrir(*ECRIRE)
    with pytest.raises(ToolError, match="Introuvable ou hors de votre périmètre : affaire"):
        await ecriture.appel(
            "crm_card_update", {"card_id": "c0000000-0000-4000-8000-0000000000c2", "common_fields": {"siret": "1"}}
        )

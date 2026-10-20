# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires du registre, côté service
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §4 (« Droits en attente » sans droit), §6.2 point 1 (visibilité : un espace
#           ouvre la famille, l'action et les cases `aussi`), §7.2 et §7.3 (RPC sous la clé de service, refus = pas
#           d'accès) ; docs/SPEC-plateforme.md §3 (amorçage appliqué à l'inscription)
from __future__ import annotations

import pytest

from crm_mcp.crm import ClientCrm
from crm_mcp.jeton_interne import Identite
from crm_mcp.registre import EtatCompte, Registre, RegistreIndisponible

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B

ANA = Identite("sujet-ana", "ana@exemple.test", "Ana", True, False, None)


@pytest.fixture
async def registre(transport_crm):
    crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=transport_crm)
    yield Registre(crm, ("ana@exemple.test",))
    await crm.fermer()


def test_etat_ouvre_par_espace_avec_ses_cases_aussi():
    etat = EtatCompte(False, frozenset({(ESPACE_A, "affaires", "modifier"), (ESPACE_B, "contacts", "consulter")}))
    assert etat.peut_entrer
    assert etat.ouvre("affaires", "modifier")
    assert not etat.ouvre("affaires", "ajouter")
    # La case `aussi` doit être ouverte DANS LE MÊME espace que la case principale.
    assert not etat.ouvre("affaires", "modifier", aussi=(("contacts", "consulter"),))
    etat_complet = EtatCompte(False, etat.droits | {(ESPACE_A, "contacts", "consulter")})
    assert etat_complet.ouvre("affaires", "modifier", aussi=(("contacts", "consulter"),))


def test_sans_droit_ni_drapeau_le_compte_attend():
    assert not EtatCompte(False, frozenset()).peut_entrer
    assert EtatCompte(True, frozenset()).peut_entrer
    assert EtatCompte(True, frozenset()).ouvre("budgets", "supprimer")


async def test_inscription_amorce_puis_etat(registre, crm_simule):
    etat = await registre.inscrire(ANA)
    assert etat.superadmin and etat.peut_entrer
    assert crm_simule.comptes["sujet-ana"]["email"] == "ana@exemple.test"
    crm_simule.droits.add(("sujet-ana", ESPACE_A, "temps", "ajouter"))
    assert (await registre.etat(ANA)).droits == frozenset({(ESPACE_A, "temps", "ajouter")})


async def test_registre_refuse_donne_registre_indisponible(registre, crm_simule):
    crm_simule.indisponible = True
    with pytest.raises(RegistreIndisponible):
        await registre.inscrire(ANA)
    with pytest.raises(RegistreIndisponible):
        await registre.etat(ANA)


async def test_registre_sans_cle_de_service_refuse(transport_crm):
    crm = ClientCrm("http://kong:8000", CLE_ANONYME, "cle-erronee", transport=transport_crm)
    with pytest.raises(RegistreIndisponible):
        await Registre(crm, ()).etat(ANA)
    await crm.fermer()


async def test_journal_sans_argument(registre, crm_simule):
    await registre.journaliser("sujet-ana", "crm_workspace_list", None, "ok", 12)
    assert crm_simule.journal == [
        {"p_sub": "sujet-ana", "p_outil": "crm_workspace_list", "p_ws": None, "p_issue": "ok", "p_duree_ms": 12}
    ]


async def test_journal_refuse_est_dit(registre, crm_simule, caplog):
    crm_simule.indisponible = True
    with caplog.at_level("WARNING", logger="crm_mcp.registre"):
        await registre.journaliser("sujet-ana", "crm_workspace_list", None, "ok", 12)
    assert [(r.getMessage(), r.statut) for r in caplog.records] == [("journal_refuse", 503)]

# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires des réglages
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §10 (variables, formats, défauts, refus nommé d'une configuration
#           incomplète) ; docs/SPEC-plateforme.md §3 (liste d'amorçage normalisée comme par la fonction `session`)
# @verifies CRM-102 T6 — docs/SPEC-mcp.md §2.2, §10 (`SITE_URL` obligatoire, l'adresse de la plateforme de la webapp)
from __future__ import annotations

from pathlib import Path

import pytest

from crm_mcp.reglages import REDIRECTIONS_PAR_DEFAUT, Reglages, ReglagesIncomplets, liste_superadmins


def test_configuration_complete_et_defauts(env_complet):
    r = Reglages.depuis_environnement(env_complet)
    assert r.origine_publique == "https://crm.mcp.exemple.test"
    assert r.url_mcp == "https://crm.mcp.exemple.test/mcp"
    assert r.origine_webapp == "https://crm.exemple.test"
    assert r.url_plateforme == "https://crm.exemple.test/plateforme"
    assert r.oidc_emetteur == "https://sso.exemple.test/realms/lelabs"
    assert r.decouverte == "https://sso.exemple.test/realms/lelabs/.well-known/openid-configuration"
    assert r.api_crm == "http://kong:8000"
    assert r.superadmins_initiaux == ()
    assert r.redirections_clients == REDIRECTIONS_PAR_DEFAUT
    assert (r.taille_max_reponse, r.debit_oauth_minute, r.enregistrements_heure) == (200_000, 60, 20)
    assert (r.journal_niveau, r.chemin_etat, r.port) == ("info", Path("/var/lib/crm-mcp"), 8080)


def test_chaque_variable_manquante_est_nommee(env_complet):
    del env_complet["JWT_SECRET"]
    env_complet["SUPABASE_SERVICE_ROLE_KEY"] = ""
    env_complet["SSO_OIDC_CLIENT_ID"] = "   "
    with pytest.raises(ReglagesIncomplets) as erreur:
        Reglages.depuis_environnement(env_complet)
    assert erreur.value.manquantes == ["SSO_OIDC_CLIENT_ID", "JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]
    assert "JWT_SECRET" in str(erreur.value)


def test_site_url_manquante_est_nommee(env_complet):
    """Sans l'origine de la webapp, l'accueil et `/plateforme` ne sauraient où mener : le démarrage refuse."""
    env_complet["SITE_URL"] = " / "
    with pytest.raises(ReglagesIncomplets) as erreur:
        Reglages.depuis_environnement(env_complet)
    assert erreur.value.manquantes == ["SITE_URL"]


def test_valeurs_facultatives_lues(env_complet):
    env_complet.update(
        CRM_SUPERADMINS_INITIAUX=" Resp@Exemple.test, resp@exemple.test,pas-une-adresse,autre@exemple.test",
        CRM_MCP_REDIRECTIONS_CLIENTS="http://localhost:*, https://claude.ai/api/mcp/auth_callback ,",
        CRM_MCP_TAILLE_MAX_REPONSE="5000",
        CRM_MCP_DEBIT_OAUTH_MINUTE="1000",
        CRM_MCP_JOURNAL_NIVEAU="WARNING",
        CRM_MCP_PORT="9000",
    )
    r = Reglages.depuis_environnement(env_complet)
    assert r.superadmins_initiaux == ("resp@exemple.test", "autre@exemple.test")
    assert r.redirections_clients == ("http://localhost:*", "https://claude.ai/api/mcp/auth_callback")
    assert (r.taille_max_reponse, r.debit_oauth_minute, r.journal_niveau, r.port) == (5000, 1000, "warning", 9000)


@pytest.mark.parametrize("valeur", ["0", "-3", "beaucoup"])
def test_entier_invalide_refuse(env_complet, valeur):
    env_complet["CRM_MCP_TAILLE_MAX_REPONSE"] = valeur
    with pytest.raises(ValueError):
        Reglages.depuis_environnement(env_complet)


def test_liste_superadmins():
    assert liste_superadmins(None) == ()
    assert liste_superadmins("") == ()
    assert liste_superadmins("a@b, A@B ,c@d,@x,y@,un espace@b") == ("a@b", "c@d")

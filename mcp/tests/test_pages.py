# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires des pages publiques du connecteur
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §4 (« Droits en attente » et « Compte en attente de vérification » sont des
#           attentes, pas des erreurs ; la connexion refusée est une alerte), §3.3 (« Stay signed in » expliqué)
# @verifies Repris des preuves d'Evoliz (p2enjoy-evoliz, `tests/test_pages.py`, révision 80a3e27) ; l'administration vit
#           dans la webapp du CRM (arbitrage A3).
from __future__ import annotations

from crm_mcp import pages


def test_accueil_donne_l_adresse_et_la_regle():
    html = pages.accueil("https://crm.mcp.exemple.test/mcp")
    assert 'value="https://crm.mcp.exemple.test/mcp"' in html
    assert "comptes vérifiés du SSO lelabs" in html and "superadministrateur" in html
    assert "« Stay signed in »" in html and "« Plateforme »" in html
    assert "/admin" not in html
    assert 'lang="fr"' in html and 'rel="icon"' in html


def test_droits_en_attente_est_une_attente_qui_dit_quoi_faire():
    html = pages.droits_en_attente(courriel="vera@exemple.test")
    assert "<h1>Droits en attente</h1>" in html
    assert 'role="status"' in html and 'role="alert"' not in html
    assert "vera@exemple.test" in html and "espace par espace" in html
    assert "relancez\nla connexion depuis votre client MCP" in html


def test_valeurs_echappees():
    assert "<script>alert(1)</script>" not in pages.droits_en_attente(courriel='"><script>alert(1)</script>')
    html = pages.verification_attendue(courriel="<b>", compte_url='javascript:x"')
    assert "&lt;b&gt;" in html and 'javascript:x"' not in html
    assert '"><img' not in pages.accueil('https://x/"><img src=x>')


def test_erreur_connexion_est_une_alerte():
    html = pages.erreur_connexion()
    assert "La connexion n'a pas abouti" in html and 'role="alert"' in html


def test_verification_attendue_est_une_attente():
    html = pages.verification_attendue(courriel="noa@exemple.test", compte_url="https://sso/account")
    assert "Compte en attente de vérification" in html
    assert 'role="status"' in html and 'role="alert"' not in html
    assert "noa@exemple.test" in html and 'href="https://sso/account"' in html

# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires du mandataire OAuth
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §3.3 (case « Stay signed in » décochée, `offline_access` ajoutée une fois),
#           §4 (signature, émetteur, `azp`, RS256, portée, `verified` ; adresse vérifiée ; « Droits en attente » ;
#           registre injoignable = refus ; `admin` lu) ; docs/SSO.md (les deux règles du domaine)
# @verifies Repris des preuves d'Evoliz (p2enjoy-evoliz, `tests/test_autorisation.py`, révision 80a3e27), adaptées au
#           registre PostgreSQL du CRM.
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from urllib.parse import parse_qs, urlsplit

import pytest
from fastmcp.server.auth.providers.jwt import RSAKeyPair

from crm_mcp.autorisation import VerificateurRole, Verdict, admettre, identite_de, roles_de
from crm_mcp.crm import ClientCrm
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A

EMETTEUR = "https://sso.exemple.test/realms/lelabs"
CLIENT = "lelabs-crm"


@pytest.fixture(scope="module")
def cles() -> RSAKeyPair:
    return RSAKeyPair.generate()


@pytest.fixture
def verificateur(cles) -> VerificateurRole:
    return VerificateurRole(emetteur=EMETTEUR, client_id=CLIENT, cle_publique=cles.public_key)


@pytest.fixture
async def registre(transport_crm):
    crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=transport_crm)
    yield Registre(crm, ("resp@exemple.test",))
    await crm.fermer()


def _jeton(cles, *, sujet="sujet-1", roles=("verified",), azp=CLIENT, emetteur=EMETTEUR, expire=300, scope=True,
           courriel="ana@exemple.test", verifie=True, extra=None):
    revendications = {"azp": azp, "email": courriel, "email_verified": verifie, "name": "Ana Lyse"}
    if roles is not None:
        revendications["realm_access"] = {"roles": ["offline_access", "default-roles-lelabs", *roles]}
    revendications.update(extra or {})
    return cles.create_token(
        subject=sujet,
        issuer=emetteur,
        scopes=["openid", "profile", "email"] if scope else None,
        expires_in_seconds=expire,
        additional_claims=revendications,
    )


@pytest.mark.parametrize("roles", [("verified",), ("verified", "admin")])
async def test_compte_verifie_accepte(verificateur, cles, roles):
    jeton = await verificateur.load_access_token(_jeton(cles, roles=roles))
    assert jeton is not None and jeton.claims["sub"] == "sujet-1"


@pytest.mark.parametrize(
    ("options", "motif"),
    [
        ({"roles": ("admin",)}, "verification_absente"),
        ({"roles": ()}, "verification_absente"),
        ({"roles": None}, "verification_absente"),
        ({"azp": "lelabs-autre-application"}, "azp"),
        ({"emetteur": "https://autre.exemple.test/realms/lelabs"}, "jeton_invalide"),
        ({"expire": -10}, "jeton_invalide"),
        ({"scope": False}, "jeton_invalide"),
    ],
)
async def test_refus(verificateur, cles, options, motif):
    assert (await verificateur.examiner(_jeton(cles, **options))).motif == motif
    assert await verificateur.load_access_token(_jeton(cles, **options)) is None


async def test_algorithme_symetrique_refuse(verificateur, cles):
    """Un jeton HS256 signé avec la clé PUBLIQUE comme secret (confusion d'algorithme)."""

    def b64(d: bytes) -> str:
        return base64.urlsafe_b64encode(d).rstrip(b"=").decode()

    entete = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    corps = b64(json.dumps({
        "sub": "x", "iss": EMETTEUR, "azp": CLIENT, "exp": int(time.time()) + 300,
        "scope": "openid", "realm_access": {"roles": ["verified", "admin"]},
    }).encode())
    signature = hmac.new(cles.public_key.encode(), f"{entete}.{corps}".encode(), hashlib.sha256).digest()
    assert (await verificateur.examiner(f"{entete}.{corps}.{b64(signature)}")).motif == "jeton_invalide"


async def test_jeton_absent_ou_illisible(verificateur):
    assert (await verificateur.examiner(None)).motif == "jeton_invalide"
    assert (await verificateur.examiner("pas.un.jeton")).motif == "jeton_invalide"


def test_roles_de():
    assert roles_de({"realm_access": {"roles": ["admin", 3, None]}}) == ["admin"]
    assert roles_de({"realm_access": []}) == []
    assert roles_de({}) == []


async def test_identite_lit_admin_et_echeance(verificateur, cles):
    admin = identite_de(await verificateur.load_access_token(_jeton(cles, roles=("verified", "admin"))))
    simple = identite_de(await verificateur.load_access_token(_jeton(cles)))
    assert admin.admin_lelabs and not simple.admin_lelabs
    assert (simple.sujet, simple.courriel, simple.nom, simple.courriel_verifie) == ("sujet-1", "ana@exemple.test", "Ana Lyse", True)
    assert isinstance(simple.expire_a, int) and simple.expire_a > time.time()
    assert identite_de(None) is None


# --- Admission par le registre (docs/SPEC-mcp.md §4) ----------------------------------------------------------------


async def _verdict(verificateur, cles, **options) -> Verdict:
    verdict = await verificateur.examiner(_jeton(cles, **options))
    assert verdict.accepte
    return verdict


async def test_compte_sans_droit_inscrit_puis_en_attente(verificateur, cles, registre, crm_simule):
    assert await admettre(registre, await _verdict(verificateur, cles, sujet="sujet-vera")) == "droits_absents"
    assert crm_simule.comptes["sujet-vera"]["email"] == "ana@exemple.test"


async def test_adresse_non_verifiee_ni_inscrite_ni_amorcee(verificateur, cles, registre, crm_simule):
    verdict = await _verdict(verificateur, cles, sujet="sujet-resp", courriel="resp@exemple.test", verifie=False)
    assert await admettre(registre, verdict) == "adresse_non_verifiee"
    assert crm_simule.comptes == {} and crm_simule.superadmins == set()


async def test_amorcage_par_la_premiere_connexion_puis_liste_sans_effet(verificateur, cles, registre, crm_simule):
    resp = await _verdict(verificateur, cles, sujet="sujet-resp", courriel="resp@exemple.test")
    assert await admettre(registre, resp) is None
    assert crm_simule.superadmins == {"sujet-resp"}


async def test_admin_lelabs_entre_sans_droit(verificateur, cles, registre):
    verdict = await _verdict(verificateur, cles, sujet="sujet-ops", roles=("verified", "admin"))
    assert await admettre(registre, verdict) is None


async def test_un_droit_suffit_pour_entrer(verificateur, cles, registre, crm_simule):
    verdict = await _verdict(verificateur, cles, sujet="sujet-thomas")
    assert await admettre(registre, verdict) == "droits_absents"
    crm_simule.droits.add(("sujet-thomas", ESPACE_A, "affaires", "consulter"))
    assert await admettre(registre, verdict) is None


async def test_registre_injoignable_refuse(verificateur, cles, registre, crm_simule):
    crm_simule.indisponible = True
    verdict = await _verdict(verificateur, cles, sujet="sujet-thomas")
    assert await admettre(registre, verdict) == "registre_indisponible"


async def test_verdict_sans_sujet_refuse(registre):
    assert await admettre(registre, Verdict(None, None)) == "jeton_invalide"


# --- Connexion longue (docs/SPEC-mcp.md §3.3) -----------------------------------------------------------------------


def test_case_inseree_dans_le_formulaire_decochee():
    from fastmcp.server.auth.oauth_proxy.ui import create_consent_html

    from crm_mcp.autorisation import inserer_case_connexion_longue

    page = create_consent_html(client_id="c", redirect_uri="http://127.0.0.1:9/cb", scopes=["openid"],
                               txn_id="t", csrf_token="x")
    avec = inserer_case_connexion_longue(page)
    formulaire = avec[avec.index('<form id="consentForm"'):avec.index("</form>")]
    assert 'name="connexion_longue" value="oui"' in formulaire, "la case part avec le formulaire"
    [case] = re.findall(r'<input[^>]*name="connexion_longue"[^>]*>', formulaire)
    assert "checked" not in case, "décochée par défaut"
    assert formulaire.index("connexion_longue") < formulaire.index('class="button-group"')
    assert '<label for="connexion_longue">' in formulaire and "Stay signed in" in formulaire
    assert inserer_case_connexion_longue("<html>sans formulaire</html>") is None


def test_portee_hors_ligne_ajoutee_une_fois():
    from crm_mcp.autorisation import demander_hors_ligne

    adresse = "https://sso.exemple.test/auth?client_id=c&scope=openid+profile+email&state=s"
    une = demander_hors_ligne(adresse)
    parametres = parse_qs(urlsplit(une).query)
    assert parametres["scope"] == ["openid profile email offline_access"]
    assert parametres["state"] == ["s"] and parametres["client_id"] == ["c"]
    assert parse_qs(urlsplit(demander_hors_ligne(une)).query)["scope"] == ["openid profile email offline_access"]

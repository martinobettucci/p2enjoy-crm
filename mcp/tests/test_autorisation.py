# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires du mandataire OAuth
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §3.3 (case « Stay signed in » décochée, `offline_access` ajoutée une fois),
#           §4 (signature, émetteur, `azp`, RS256, portée, `verified` ; adresse vérifiée ; « Droits en attente » ;
#           registre injoignable = refus ; `admin` lu) ; docs/SSO.md (les deux règles du domaine)
# @verifies CRM-164 (docs/BACKLOG.md) — la fenêtre de renouvellement : dans la fenêtre, le jeton remplacé rend la même paire sans
#           rien renouveler ; deux renouvellements simultanés n'en font qu'un ; hors de la fenêtre, pour un autre client, ou
#           si la paire rendue est morte, le refus reste ; la mémoire bornée (docs/SPEC-mcp.md §3.3 bis ; décision 979)
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

from crm_mcp.autorisation import (
    Fenetres,
    MandataireLelabs,
    VerificateurRole,
    Verdict,
    admettre,
    empreinte,
    identite_de,
    roles_de,
)
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
    # La charte P2Enjoy (docs/DESIGN_SYSTEM.md §5.57) : accord primaire en bleu de marque, refus secondaire.
    assert ".btn-approve { background: var(--color-brand)" in avec and "--color-brand: #23468c" in avec
    assert ".btn-deny { background: var(--color-surface)" in avec


def test_consentement_sans_ressource_tierce():
    """Avec l'icône du serveur, la page ne charge plus le logo de FastMCP depuis un domaine tiers (CLAUDE.md §11)."""
    from fastmcp.server.auth.oauth_proxy.ui import create_consent_html

    from html import escape

    from crm_mcp.pages import FAVICON

    page = create_consent_html(client_id="c", redirect_uri="http://127.0.0.1:9/cb", scopes=["openid"], txn_id="t",
                               csrf_token="x", server_name="P2Enjoy CRM", server_icon_url=FAVICON)
    assert 'src="https://gofastmcp' not in page, "aucune ressource chargée d'un domaine tiers ; un lien d'aide n'en est pas une"
    assert f'src="{escape(FAVICON)}"' in page, "le monogramme du CRM, en URI data:"
    assert FAVICON.startswith("data:image/svg+xml,") and "img-src https: data:" in page


def test_portee_hors_ligne_ajoutee_une_fois():
    from crm_mcp.autorisation import demander_hors_ligne

    adresse = "https://sso.exemple.test/auth?client_id=c&scope=openid+profile+email&state=s"
    une = demander_hors_ligne(adresse)
    parametres = parse_qs(urlsplit(une).query)
    assert parametres["scope"] == ["openid profile email offline_access"]
    assert parametres["state"] == ["s"] and parametres["client_id"] == ["c"]
    assert parse_qs(urlsplit(demander_hors_ligne(une)).query)["scope"] == ["openid profile email offline_access"]


# --- La fenêtre de renouvellement (docs/SPEC-mcp.md §3.3 bis, `CRM-164`) ---------------------------------------------------

import asyncio  # noqa: E402
import logging  # noqa: E402
import weakref  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from fastmcp.server.auth.oauth_proxy import OAuthProxy  # noqa: E402
from mcp.server.auth.provider import RefreshToken  # noqa: E402
from mcp.shared.auth import OAuthToken  # noqa: E402


class _Horloge:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class _Magasin:
    """Le magasin des jetons de renouvellement de FastMCP, réduit à ce que la fenêtre lit : vivant ou non, par empreinte."""

    def __init__(self) -> None:
        self.vivants: set[str] = set()

    async def get(self, key: str):
        return object() if key in self.vivants else None


@pytest.fixture
def proxy(monkeypatch):
    """Le mandataire sans découverte OIDC, et un FastMCP simulé qui fait tourner le jeton comme le vrai : la paire neuve vit,
    l'ancien jeton meurt, et chaque renouvellement est compté."""
    horloge = _Horloge()
    magasin = _Magasin()
    mandataire = MandataireLelabs.__new__(MandataireLelabs)
    mandataire.fenetres = Fenetres(horloge=horloge)
    mandataire._verrous = weakref.WeakValueDictionary()
    mandataire._refresh_token_store = magasin
    compte = {"renouvellements": 0, "chargements_fastmcp": 0}

    async def charger(self, client, jeton):
        compte["chargements_fastmcp"] += 1
        if empreinte(jeton) not in magasin.vivants:
            return None
        return RefreshToken(token=jeton, client_id="client-a", scopes=["openid"], expires_at=int(time.time()) + 600)

    async def renouveler(self, client, jeton, portees):
        compte["renouvellements"] += 1
        await asyncio.sleep(0.01)  # le SSO répond : un second appel concurrent a le temps d'arriver
        n = compte["renouvellements"]
        paire = OAuthToken(access_token=f"acces-{n}", token_type="Bearer", expires_in=300, refresh_token=f"renouv-{n}")
        magasin.vivants.discard(empreinte(jeton.token))
        magasin.vivants.add(empreinte(paire.refresh_token))
        return paire

    monkeypatch.setattr(OAuthProxy, "load_refresh_token", charger)
    monkeypatch.setattr(OAuthProxy, "exchange_refresh_token", renouveler)
    magasin.vivants.add(empreinte("renouv-0"))
    return SimpleNamespace(mandataire=mandataire, horloge=horloge, magasin=magasin, compte=compte)


CLIENT_A = SimpleNamespace(client_id="client-a")


async def _renouveler(proxy, jeton: str, client=CLIENT_A) -> OAuthToken | None:
    """Ce que fait le gestionnaire `/token` du SDK : charger, puis échanger ; None pour `invalid_grant`."""
    charge = await proxy.mandataire.load_refresh_token(client, jeton)
    if charge is None:
        return None
    return await proxy.mandataire.exchange_refresh_token(client, charge, charge.scopes)


async def test_dans_la_fenetre_le_jeton_remplace_rend_la_meme_paire_sans_rien_renouveler(proxy, caplog):
    caplog.set_level(logging.INFO)
    premier = await _renouveler(proxy, "renouv-0")
    proxy.horloge.t += 5  # le rejeu mesuré le 2026-11-23 : 5 s après la rotation
    second = await _renouveler(proxy, "renouv-0")
    assert second == premier, "la même paire, au caractère près"
    assert proxy.compte["renouvellements"] == 1, "rien n'est demandé au SSO"
    [ligne] = [r for r in caplog.records if r.getMessage() == "renouvellement_rejoue"]
    assert ligne.delai_ms == 5000
    assert proxy.compte["chargements_fastmcp"] == 1, "FastMCP n'est pas interrogé pour un rejeu : il écrirait un faux refus"
    assert "renouv-" not in json.dumps(ligne.__dict__, default=str), "ni jeton ni empreinte au journal"


async def test_deux_renouvellements_simultanes_n_en_font_qu_un(proxy):
    a, b = await asyncio.gather(_renouveler(proxy, "renouv-0"), _renouveler(proxy, "renouv-0"))
    assert a == b and a is not None
    assert proxy.compte["renouvellements"] == 1


async def test_hors_de_la_fenetre_le_refus_reste(proxy):
    await _renouveler(proxy, "renouv-0")
    proxy.horloge.t += 30
    assert await _renouveler(proxy, "renouv-0") is None
    assert len(proxy.mandataire.fenetres) == 0, "la fenêtre échue est oubliée"


async def test_un_autre_client_ne_rejoue_pas(proxy):
    await _renouveler(proxy, "renouv-0")
    assert await _renouveler(proxy, "renouv-0", client=SimpleNamespace(client_id="client-b")) is None


async def test_la_fenetre_se_ferme_quand_la_paire_rendue_meurt(proxy, caplog):
    caplog.set_level(logging.INFO)
    premier = await _renouveler(proxy, "renouv-0")
    # Révoquée, ou renouvelée à son tour : la paire rendue n'est plus vivante.
    proxy.magasin.vivants.discard(empreinte(premier.refresh_token))
    assert await _renouveler(proxy, "renouv-0") is None
    assert any(r.getMessage() == "renouvellement_rejeu_refuse" for r in caplog.records)


async def test_la_paire_renouvelee_ferme_la_fenetre_du_jeton_d_avant(proxy):
    premier = await _renouveler(proxy, "renouv-0")
    suivant = await _renouveler(proxy, premier.refresh_token)
    assert suivant is not None and suivant != premier
    assert await _renouveler(proxy, "renouv-0") is None


def test_la_memoire_des_fenetres_est_bornee():
    fenetres = Fenetres(taille_max=3)
    paire = OAuthToken(access_token="a", token_type="Bearer", refresh_token="r")
    for n in range(5):
        fenetres.ouvrir(f"jeton-{n}", "client-a", ["openid"], None, paire)
    assert len(fenetres) == 3
    assert fenetres.lire("jeton-0") is None and fenetres.lire("jeton-4") is not None

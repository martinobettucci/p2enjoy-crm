# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires du jeton interne
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §5 (revendications, échéance bornée par 300 s et par le jeton LeLabs,
#           `lelabs_admin` présente si et seulement si `admin`) ; docs/SPEC-session-sso.md §5.4 (forme reprise)
from __future__ import annotations

import jwt
import pytest

from crm_mcp.jeton_interne import DUREE_MAX_S, EMETTEUR, Identite, JetonExpire, frapper

from .conftest import SECRET

MAINTENANT = 1_800_000_000


def _identite(**options) -> Identite:
    valeurs = dict(sujet="5eed0000-0000-4000-8000-000000000001", courriel="ana@exemple.test", nom="Ana",
                   courriel_verifie=True, admin_lelabs=False, expire_a=MAINTENANT + 3600)
    valeurs.update(options)
    return Identite(**valeurs)


def _lire(jeton: str) -> dict:
    return jwt.decode(jeton, SECRET, algorithms=["HS256"], audience="authenticated", options={"verify_exp": False, "verify_iat": False})


def test_revendications_du_jeton():
    revendications = _lire(frapper(SECRET, _identite(), MAINTENANT))
    assert revendications == {
        "iss": EMETTEUR,
        "sub": "5eed0000-0000-4000-8000-000000000001",
        "role": "authenticated",
        "aud": "authenticated",
        "iat": MAINTENANT,
        "exp": MAINTENANT + DUREE_MAX_S,
        "canal": "mcp",
    }
    assert EMETTEUR == "p2enjoy-crm/mcp" and DUREE_MAX_S == 300


def test_echeance_bornee_par_le_jeton_lelabs():
    assert _lire(frapper(SECRET, _identite(expire_a=MAINTENANT + 42), MAINTENANT))["exp"] == MAINTENANT + 42
    assert _lire(frapper(SECRET, _identite(expire_a=None), MAINTENANT))["exp"] == MAINTENANT + DUREE_MAX_S


@pytest.mark.parametrize("expire_a", [MAINTENANT, MAINTENANT - 1])
def test_jeton_lelabs_echu_refuse(expire_a):
    with pytest.raises(JetonExpire):
        frapper(SECRET, _identite(expire_a=expire_a), MAINTENANT)


def test_lelabs_admin_si_et_seulement_si_admin():
    assert _lire(frapper(SECRET, _identite(admin_lelabs=True), MAINTENANT))["lelabs_admin"] is True
    assert "lelabs_admin" not in _lire(frapper(SECRET, _identite(admin_lelabs=False), MAINTENANT))


def test_signe_hs256_par_le_secret():
    jeton = frapper(SECRET, _identite(), MAINTENANT)
    assert jwt.get_unverified_header(jeton)["alg"] == "HS256"
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(jeton, "un-autre-secret-assez-long-pour-hs256-0000000", algorithms=["HS256"], audience="authenticated",
                   options={"verify_exp": False, "verify_iat": False})

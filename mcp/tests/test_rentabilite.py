# @verifies CRM-108 (docs/BACKLOG.md) — tranche T4 : la règle de rentabilité du connecteur
# @verifies docs/SPEC-recettes.md §4.1 à §4.4, §7 (la même règle que la webapp) — les cas sont lus dans
#           tests/rentabilite_cas.json, que webapp/src/lib/rentabilite.test.ts rejoue aussi
"""Une divergence entre la webapp et le connecteur fait rougir l'une des deux suites."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from crm_mcp.rentabilite import au_centime, calculer_rentabilite

CAS = json.loads((Path(__file__).parent / "rentabilite_cas.json").read_text(encoding="utf-8"))["cas"]


def test_les_cas_partages_sont_lus() -> None:
    assert len(CAS) >= 7


@pytest.mark.parametrize("cas", CAS, ids=[c["nom"] for c in CAS])
def test_regle(cas: dict) -> None:
    r = calculer_rentabilite(cas["montants"], cas["vue"], cas["calculable"])
    assert {k: r[k] for k in ("recettes", "couts", "personnel", "marge", "taux", "partielle")} == cas["attendu"]
    assert r["calculable"] is cas["calculable"]


def test_arrondi_au_plus_proche_par_exces_et_non_bancaire() -> None:
    assert au_centime(0.125) == 0.13
    assert au_centime(-1175.0) == -1175.0

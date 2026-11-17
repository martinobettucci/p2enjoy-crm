# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, dont l'audit inscrit l'issue de chaque appel
#           (docs/SPEC-mcp.md §7.1)
# @verifies CRM-150 (docs/BACKLOG.md) — tranche T1 : un refus fait par le connecteur est journalisé `refus_crm` ; `erreur`
#           ne garde que les pannes ; aucun refus d'argument ne reste une `ToolError` simple dans les outils
# @verifies docs/SPEC-mcp.md §9.3 (« Un refus fait par le connecteur ») ; docs/JOURNAL.md décision 928 ; INC-357
"""Le monde simulé de `test_affaires_ecriture.py` ; la vraie base est éprouvée par
`tests/test_integration_affaires_deplacement.py`."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from fastmcp.exceptions import ToolError

from crm_mcp.outils.affaires_ecriture import choisir_par_nom
from crm_mcp.politique import RefusArgument, RefusCrm

from .test_affaires_ecriture import CARD_A, TOUT, Monde

OUTILS = Path(__file__).resolve().parent.parent / "crm_mcp" / "outils"
#: Les seules `ToolError` simples des outils : des pannes, que l'audit inscrit `erreur` (décision 928).
PANNES = {
    ("structure.py", "Le CRM n'a pas pu chercher (HTTP"),
    ("temps.py", "Your identity is unknown to the connector."),
    ("workflows_versions.py", "The CRM did not return the published version."),
    ("workflows_formulaire.py", "The CRM could not measure the effect."),
}


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


def test_un_refus_d_argument_est_un_refus_du_crm_pour_l_audit() -> None:
    assert issubclass(RefusArgument, RefusCrm) and issubclass(RefusArgument, ToolError)
    assert RefusArgument("x").issue_audit == "refus_crm"
    candidats = [{"id": "s1", "nom": "Relance"}, {"id": "s2", "nom": "Signature"}, {"id": "s3", "nom": "signature"}]
    with pytest.raises(RefusArgument, match="No step named 'Gagné'. Known: Relance, Signature, signature"):
        choisir_par_nom(candidats, "Gagné", "step")
    with pytest.raises(RefusArgument, match="Several steps are named"):
        choisir_par_nom(candidats, "SIGNATURE", "step")


async def test_une_etape_inconnue_est_journalisee_refus_crm(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError, match="No step named 'Gagné'"):
        await monde.appel("crm_card_move", {"card_id": CARD_A, "to_step": "Gagné"})
    assert monde.simule.journal[-1]["p_outil"] == "crm_card_move"
    assert monde.simule.journal[-1]["p_issue"] == "refus_crm"
    # Rien n'est demandé à la base : le refus est fait avant tout appel de `move_card`.
    assert all(nom != "move_card" for nom, _ in monde.simule.rpcs)


async def test_une_panne_du_crm_reste_une_erreur(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    monde.simule.forcees["move_card"] = (500, {"message": "boom"})
    with pytest.raises(ToolError, match="n'a pas pu traiter la demande"):
        await monde.appel("crm_card_move", {"card_id": CARD_A, "to_step": "Négociation"})
    assert monde.simule.journal[-1]["p_issue"] == "erreur"


async def test_un_argument_mal_forme_est_un_refus(monde: Monde) -> None:
    monde.ouvrir(*TOUT)
    with pytest.raises(ToolError):
        await monde.appel("crm_card_move", {"card_id": CARD_A})
    assert monde.simule.journal[-1]["p_issue"] == "refus_crm"


def test_aucun_refus_d_argument_ne_reste_une_tool_error_simple() -> None:
    """La garde de la décision 928 : dans les outils, une `ToolError` simple n'est qu'une panne, nommée ici."""
    trouvees: set[tuple[str, str]] = set()
    for fichier in sorted(OUTILS.glob("*.py")):
        for noeud in ast.walk(ast.parse(fichier.read_text(encoding="utf-8"))):
            if isinstance(noeud, ast.Call) and getattr(noeud.func, "id", None) == "ToolError":
                texte = ast.get_source_segment(fichier.read_text(encoding="utf-8"), noeud) or ""
                panne = next((m for f, m in PANNES if f == fichier.name and m in texte), None)
                assert panne is not None, f"{fichier.name} : une ToolError simple qui n'est pas une panne nommée — {texte}"
                trouvees.add((fichier.name, panne))
    assert trouvees == PANNES

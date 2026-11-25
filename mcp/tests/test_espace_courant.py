# @verifies CRM-161 (docs/BACKLOG.md) — tranche T4 : l'audit du connecteur outil par outil, rendu AUTOMATIQUE — chaque outil du
#           catalogue porte une ancre ; un outil ancré sur un espace nommé n'agit qu'avec l'espace résolu par la politique
#           (`appel.espace`) ; les deux seuls outils multi-espaces sont `crm_workspace_list` et `crm_search` ; aucun outil
#           ne compose une adresse de la webapp, sauf le lien de relecture, qui porte le slug de l'espace ;
#           docs/SPEC-espace-courant.md §6, §11, §17.2, §17.3, §17.4 ; décisions 965 et 998
# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur (docs/SPEC-mcp.md §9.2, §6.2) : une déclaration, donc une
#           ancre, par outil
# @verifies docs/SPEC-mcp.md §9.2 « L'espace courant » ; docs/DAT.md (connecteur MCP)
"""La garde de l'audit : le catalogue est lu dans le CODE (l'arbre syntaxique de chaque module d'outils), sans monter
le serveur — un outil ajouté demain y est audité sans qu'on ait à y penser. Aucune base, aucun service."""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import crm_mcp
from crm_mcp.outils import messagerie

OUTILS = Path(crm_mcp.__file__).parent / "outils"
#: Les seuls outils multi-espaces par nature (docs/SPEC-espace-courant.md §6, §11, §17.2 classe C).
MULTI_ESPACES = {"crm_workspace_list", "crm_search"}


def _catalogue() -> tuple[dict[str, dict[str, str]], dict[str, str], int]:
    """(déclarations par outil, code source de chaque outil, nombre d'appels à `enregistrer`)."""
    declarations: dict[str, dict[str, str]] = {}
    sources: dict[str, str] = {}
    appels = 0
    for fichier in sorted(OUTILS.glob("*.py")):
        texte = fichier.read_text(encoding="utf-8")
        arbre = ast.parse(texte)
        fonctions = {
            n.name: ast.get_source_segment(texte, n)
            for n in ast.walk(arbre)
            if isinstance(n, ast.AsyncFunctionDef) and n.name.startswith("crm_")
        }
        for n in ast.walk(arbre):
            if not (isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "enregistrer"):
                continue
            appels += 1
            nom = next((a.id for a in n.args if isinstance(a, ast.Name) and a.id.startswith("crm_")), None)
            declaration = next(
                (c for c in [*n.args, *[k.value for k in n.keywords]]
                 if isinstance(c, ast.Call) and getattr(c.func, "id", None) == "Declaration"),
                None,
            )
            assert nom is not None and declaration is not None, f"{fichier.name} : un appel à `enregistrer` sans outil ni déclaration"
            assert nom not in declarations, f"l'outil {nom} est déclaré deux fois"
            declarations[nom] = {k.arg: ast.unparse(k.value) for k in declaration.keywords if k.arg is not None}
            sources[nom] = fonctions.get(nom) or ""
    return declarations, sources, appels


DECLARATIONS, SOURCES, APPELS = _catalogue()


def test_la_garde_voit_tous_les_outils() -> None:
    # Elle compte les appels à `enregistrer` : un outil que l'extraction manquerait fait rougir, au lieu d'échapper à l'audit.
    assert len(DECLARATIONS) == APPELS and APPELS >= 135
    assert all(SOURCES[nom] for nom in DECLARATIONS), "un outil dont le code n'a pas été trouvé"


def test_chaque_outil_porte_une_ancre() -> None:
    sans = sorted(n for n, d in DECLARATIONS.items() if not d.get("espace"))
    assert sans == [], f"outils sans ancre d'espace : {sans}"


def test_un_outil_ancre_sur_un_espace_nomme_n_agit_qu_avec_l_espace_resolu() -> None:
    """Classe A (docs/SPEC-espace-courant.md §17.2) : l'espace est celui que l'argument `workspace` nomme, résolu par la
    politique ; chaque lecture ou écriture le passe — jamais un filtre oublié, que la seule RLS laisserait rendre tous les
    espaces de la personne."""
    classe_a = sorted(n for n, d in DECLARATIONS.items() if d.get("espace") == "'workspace:workspace'")
    assert len(classe_a) >= 29
    sans_espace = [n for n in classe_a if "appel.espace" not in SOURCES[n]]
    assert sans_espace == [], f"outils ancrés sur un espace qui n'utilisent pas l'espace résolu : {sans_espace}"


def test_les_deux_seuls_outils_multi_espaces() -> None:
    """Classe C : `crm_workspace_list` rend les espaces eux-mêmes, `crm_search` le `workspace_id` de chaque résultat."""
    multi = {n for n, d in DECLARATIONS.items() if d.get("espace") in ("REFERENCE", "'reference'")}
    assert multi == MULTI_ESPACES
    assert '"workspace_id"' in SOURCES["crm_search"]


def test_un_outil_sur_un_objet_ne_lit_pas_un_espace_nomme() -> None:
    """Classe B : l'espace est celui de l'objet, résolu par la politique avant l'outil ; l'outil n'a donc pas d'argument
    `workspace` (qui pourrait diverger de l'espace de l'objet)."""
    classe_b = [n for n, d in DECLARATIONS.items() if d.get("espace") not in ("'workspace:workspace'", "REFERENCE", "'reference'")]
    assert len(classe_b) >= 104
    avec_argument = [n for n in classe_b if "workspace:" in SOURCES[n].split(") ->", 1)[0].replace(" ", "")]
    assert avec_argument == [], f"outils sur un objet qui prennent un argument `workspace` : {avec_argument}"


def test_le_lien_de_relecture_est_la_seule_adresse_de_la_webapp_composee_et_porte_le_slug() -> None:
    for fichier in sorted(OUTILS.glob("*.py")):
        if fichier.name == "messagerie.py":
            continue
        assert "origine_webapp" not in fichier.read_text(encoding="utf-8"), f"{fichier.name} compose une adresse de la webapp"
    assert list(inspect.signature(messagerie.lien_de_relecture).parameters) == ["origine_webapp", "slug_espace", "brouillon"]
    assert messagerie.lien_de_relecture("https://crm.test", "studio-lumen", "d 1") == "https://crm.test/studio-lumen/inbox?brouillon=d%201"
    # L'ancienne adresse n'est plus composée nulle part dans le code du connecteur.
    for fichier in sorted(OUTILS.glob("*.py")):
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if "/inbox" in ligne and "{origine_webapp}" in ligne:
                assert "{quote(slug_espace" in ligne, f"{fichier.name} : {ligne.strip()}"

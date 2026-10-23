# @spec CRM-108 (docs/BACKLOG.md) — tranche T4 : la règle de rentabilité, côté connecteur
# @spec docs/SPEC-recettes.md §4.1 à §4.4 (marge réelle et prévue, taux, partielle, plusieurs devises), §5 (la base rend
#       des sommes), §7 (aucun chemin parallèle : la même règle que webapp/src/lib/rentabilite.ts, prouvée par les mêmes
#       cas, mcp/tests/rentabilite_cas.json)
"""La rentabilité d'une affaire, tirée des sommes de `public.rentabilite_affaires`.

« Nul n'est pas zéro » : une recette ou un coût réel inconnu vaut `None`, jamais 0 ; seule la marge combine ce qui est
connu, et c'est pourquoi elle dit quand elle est partielle.
"""

from __future__ import annotations

import math
from typing import Any


def au_centime(x: float) -> float:
    """Au centime, arrondi au plus proche par excès — le `Math.round` de la webapp, jamais l'arrondi bancaire de Python."""
    return math.floor(x * 100 + 0.5) / 100


def _arrondi_dixieme(x: float) -> float:
    return math.floor(x * 10 + 0.5) / 10


def calculer_rentabilite(m: dict[str, Any], vue: str, calculable: bool) -> dict[str, Any]:
    """La règle du §4, sur les montants d'une affaire (clés en camelCase, comme les cas partagés).

    `vue` vaut `reel` ou `prevu` ; `calculable` est faux pour une affaire qui mêle plusieurs devises.
    """
    reel = vue == "reel"
    recettes = m.get("recettesReelles") if reel else m.get("recettesPrevues")
    couts = m.get("coutsReels") if reel else m.get("coutsPrevus")
    personnel = m.get("personnel")
    rien = recettes is None and couts is None and personnel is None
    marge = None if (not calculable or rien) else au_centime((recettes or 0) - (couts or 0) - (personnel or 0))
    taux = (
        _arrondi_dixieme(marge / recettes * 100)
        if reel and marge is not None and recettes not in (None, 0)
        else None
    )
    causes = {
        "recettesSansReel": int(m.get("lignesRecetteSansReel") or 0) if reel else 0,
        "coutsSansReel": int(m.get("lignesCoutSansReel") or 0) if reel else 0,
        "minutesNonValorisees": int(m.get("minutesNonValorisees") or 0),
    }
    partielle = causes if any(v > 0 for v in causes.values()) else None
    return {
        "recettes": recettes,
        "couts": couts,
        "personnel": personnel,
        "marge": marge,
        "taux": taux,
        "calculable": calculable,
        "partielle": partielle,
    }

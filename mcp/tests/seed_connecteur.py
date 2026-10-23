# @spec CRM-103 (docs/BACKLOG.md) — tranche T3.b : le seed du connecteur, par de vraies connexions OAuth et de vrais
#       appels MCP (docs/SPEC-seed.md §22 : comptes, journal, convergence, constat)
# @spec docs/SPEC-mcp.md §12 (le seed par les vrais chemins), §7.1 (issues du journal), §6.2 (un outil fermé est
#       invisible, cases `aussi` comprises) ; CLAUDE.md §8 (aucune trace fabriquée : chaque ligne du registre naît d'un vrai appel)
"""Le seed du connecteur MCP, joué par `supabase/seed/apply-seed.sh` dans l'image du service `mcp`.

    python -m tests.seed_connecteur

La matrice de Camille et celle de Driss sont posées AVANT, par `mcp_poser_droits` sous le jeton de la
superadministratrice. Ce module ne fait que ce qu'un client MCP fait : se connecter, puis appeler. Un appel n'est rejoué
que si le journal ne porte pas déjà sa ligne `(compte, outil, issue)` ; le registre n'est lu que par la clé de service,
et jamais écrit. Code de sortie non nul, avec la cause, dès qu'une attente manque.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from fastmcp import Client
from fastmcp.exceptions import ToolError

from .parcours_oauth import CAMILLE, DRISS, FARIDA, MCP, _jetons, _parcours, _service

#: « Lot 1 — conception » de la refonte intranet (docs/SPEC-seed.md §21.1) : une affaire que Camille et Driss lisent.
CARTE = "5eed0000-0000-4000-8000-0000000000c4"

#: Ce que chaque compte connecté appelle, et l'issue que le journal doit en garder (docs/SPEC-seed.md §22.1).
APPELS: dict[tuple[str, str], list[tuple[str, dict[str, Any], str]]] = {
    CAMILLE: [
        ("crm_workspace_list", {}, "ok"),
        ("crm_card_revenue_list", {"card_id": CARTE}, "ok"),
    ],
    DRISS: [
        ("crm_card_revenue_list", {"card_id": CARTE}, "ok"),
        # Matrice ouverte, mais le rapport est réservé aux administrateurs : `42501 rentabilite_reservee`.
        ("crm_profitability_report", {"workspace": "p2enjoy"}, "refus_crm"),
    ],
}


async def _journalise(sub: str, outil: str, issue: str) -> bool:
    lignes = await _service(
        "GET", "/mcp_journal", params={"sub": f"eq.{sub}", "outil": f"eq.{outil}", "issue": f"eq.{issue}", "limit": "1"}
    )
    assert lignes.status_code == 200, f"lecture du journal : HTTP {lignes.status_code}"
    return bool(lignes.json())


async def _au_registre(sub: str) -> bool:
    lignes = await _service("GET", "/mcp_comptes", params={"sub": f"eq.{sub}", "select": "sub"})
    assert lignes.status_code == 200, f"lecture du registre : HTTP {lignes.status_code}"
    return bool(lignes.json())


async def _compte_en_attente() -> str:
    """Farida, vérifiée et sans matrice, se connecte : « Droits en attente », et son compte entre au registre."""
    if await _au_registre(FARIDA[1]):
        return "Farida : déjà au registre"
    reponse, _ = await _parcours(FARIDA)
    assert reponse.status_code == 403 and "Droits en attente" in reponse.text, (
        f"Farida devait attendre ses droits (HTTP {reponse.status_code}) : sa matrice n'est-elle pas vide ?"
    )
    return "Farida : connexion refusée, « Droits en attente »"


#: Un outil que la matrice ferme est INVISIBLE, cases `aussi` comprises (docs/SPEC-seed.md §22.1) : Camille, qui n'a que
#: `recettes:consulter`, ne voit pas le rapport de rentabilité, qui exige aussi `budgets` et `temps`.
INVISIBLES = {CAMILLE: {"crm_profitability_report"}}


async def _appels(qui: tuple[str, str]) -> str:
    manquants = [a for a in APPELS[qui] if not await _journalise(qui[1], a[0], a[2])]
    if not manquants and qui not in INVISIBLES:
        return f"{qui[0]} : appels déjà au journal"
    reponse, contexte = await _parcours(qui)
    jeton = (await _jetons(contexte, reponse))["access_token"]
    async with Client(f"{MCP}/mcp", auth=jeton) as client:
        visibles = {o.name for o in await client.list_tools()}
        caches = INVISIBLES.get(qui, set()) & visibles
        assert not caches, f"{qui[0]} voit {sorted(caches)}, que sa matrice ferme"
        for outil, arguments, issue in manquants:
            try:
                await client.call_tool(outil, arguments)
                obtenue = "ok"
            except ToolError as refus:
                obtenue = f"refus ({refus})"
            assert (obtenue == "ok") == (issue == "ok"), f"{qui[0]} · {outil} : attendu {issue}, obtenu {obtenue}"
    return f"{qui[0]} : {len(manquants)} appel(s) joué(s)"


async def _constater() -> None:
    for qui in (FARIDA, CAMILLE, DRISS):
        assert await _au_registre(qui[1]), f"{qui[0]} n'est pas au registre du connecteur"
    for qui, appels in APPELS.items():
        for outil, _, issue in appels:
            assert await _journalise(qui[1], outil, issue), f"le journal ne porte pas ({qui[0]}, {outil}, {issue})"


async def principal() -> None:
    print(await _compte_en_attente())
    for qui in APPELS:
        print(await _appels(qui))
    await _constater()
    print("Constat : trois comptes au registre, quatre lignes attendues au journal (docs/SPEC-seed.md §22.1)")


if __name__ == "__main__":
    try:
        asyncio.run(principal())
    except AssertionError as erreur:
        print(f"seed du connecteur : {erreur}", file=sys.stderr)
        sys.exit(1)

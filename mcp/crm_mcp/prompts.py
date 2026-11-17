# @spec CRM-102 (docs/BACKLOG.md) — le socle du connecteur, auquel ce module ajoute la capacité `prompts` (docs/SPEC-mcp.md §2.1)
# @spec CRM-149 (docs/BACKLOG.md) — tranche T2 : les prompts du connecteur — le fournisseur FastMCP qui lit `mcp_prompts`
#       sous le jeton de la personne à chaque `prompts/list`, le nom suffixé du slug quand deux espaces portent le même
#       identifiant, le message rendu avec son en-tête d'espace, la ligne du journal à chaque `prompts/get`
# @spec docs/SPEC-mcp.md §17.1 (texte seul, aucune case de la matrice), §17.5 (le serveur), §5 (le jeton interne, qui ne
#       survit pas à la lecture), §7.1 et §11 (le journal, jamais le texte) ; docs/JOURNAL.md décision 930
"""Les prompts du connecteur.

Un prompt N'OUVRE RIEN : il guide l'assistant vers les outils, qui restent soumis à la matrice et à la RLS. Il n'a donc
aucune déclaration de politique ; sa seule règle est celle de la table, que la RLS tient : on ne lit que les prompts des
espaces dont on est membre. Le compte doit pouvoir entrer (un droit ou le drapeau), comme pour un outil de référence.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from fastmcp.prompts.base import Message, Prompt, PromptResult
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.providers import Provider
from pydantic import PrivateAttr

from crm_mcp.crm import ClientCrm, CrmIndisponible
from crm_mcp.jeton_interne import JetonExpire, frapper
from crm_mcp.politique import MoteurPolitique
from crm_mcp.registre import RegistreIndisponible

journal = logging.getLogger("crm_mcp.prompts")

#: Ce que la lecture demande : le prompt et le nom de son espace, dans l'ordre que la liste montre.
SELECTION = "id,key,title,description,body,workspace_id,workspace:workspaces(slug,name)"
ORDRE = "title.asc,key.asc"
#: Le séparateur du nom suffixé : il ne peut pas apparaître dans un identifiant (`^[a-z0-9]+(-[a-z0-9]+)*$`).
SEPARATEUR = "__"


@dataclass(frozen=True)
class PromptLu:
    """Une ligne de `mcp_prompts`, telle que la personne la lit."""

    cle: str
    titre: str
    description: str
    texte: str
    espace_id: str
    espace_slug: str
    espace_nom: str


def lire_lignes(lignes: Sequence[Any]) -> list[PromptLu]:
    """Les lignes lisibles ; une ligne incomplète (espace absent) est écartée plutôt que de casser la liste."""
    lus: list[PromptLu] = []
    for ligne in lignes:
        if not isinstance(ligne, dict):
            continue
        espace = ligne.get("workspace")
        if not isinstance(espace, dict):
            continue
        champs = (ligne.get("key"), ligne.get("title"), ligne.get("description"), ligne.get("body"),
                  ligne.get("workspace_id"), espace.get("slug"), espace.get("name"))
        if not all(isinstance(v, str) and v for v in champs):
            continue
        lus.append(PromptLu(*champs))  # type: ignore[arg-type]
    return lus


def nommer(lus: Sequence[PromptLu]) -> list[tuple[str, str, PromptLu]]:
    """Le nom MCP et le titre de chaque prompt (§17.5) : la clé nue si un seul espace la porte, sinon `clé__slug`, et le
    titre complété du nom de l'espace."""
    porteurs = Counter(p.cle for p in lus)
    noms: list[tuple[str, str, PromptLu]] = []
    for p in lus:
        if porteurs[p.cle] == 1:
            noms.append((p.cle, p.titre, p))
        else:
            noms.append((f"{p.cle}{SEPARATEUR}{p.espace_slug}", f"{p.titre} — {p.espace_nom}", p))
    return noms


def message(p: PromptLu) -> str:
    """Le texte inséré : l'en-tête dit à l'assistant quel `workspace` passer aux outils (§17.5)."""
    return f"Espace : {p.espace_nom} (workspace : {p.espace_slug})\n\n{p.texte}"


class PromptEspace(Prompt):
    """Un prompt d'un espace. Son rendu inscrit la ligne du journal : c'est le `prompts/get`."""

    _lu: PromptLu | None = PrivateAttr(default=None)
    _journaliser: Callable[[PromptLu, float], Awaitable[None]] | None = PrivateAttr(default=None)

    async def render(self, arguments: dict[str, Any] | None = None) -> PromptResult:
        debut = time.perf_counter()
        assert self._lu is not None
        resultat = PromptResult([Message(message(self._lu))], description=self.description)
        if self._journaliser is not None:
            await self._journaliser(self._lu, debut)
        return resultat


class FournisseurPrompts(Provider):
    """Lit les prompts sous le jeton de la personne, à chaque liste ; FastMCP cherche un `prompts/get` dans cette liste."""

    def __init__(self, moteur: MoteurPolitique, crm: ClientCrm) -> None:
        super().__init__()
        self.moteur = moteur
        self.crm = crm

    async def _list_prompts(self) -> Sequence[Prompt]:
        identite = self.moteur.identite_du_jeton(get_access_token())
        if identite is None:
            # Hors d'une requête authentifiée — au démarrage, par exemple —, il n'y a personne pour qui lire.
            return []
        try:
            etat = await self.moteur.etat(identite)
        except (RegistreIndisponible, CrmIndisponible):
            journal.warning("prompts_indisponibles", extra={"cause": "registre"})
            return []
        if not etat.peut_entrer:
            return []
        try:
            jeton = frapper(self.moteur.jwt_secret, identite, int(self.moteur.horloge()))
        except JetonExpire:
            return []
        # Le jeton interne ne sert qu'à cette lecture : une variable locale, jamais gardée ni journalisée (§5).
        try:
            reponse = await self.crm.lire(jeton, "mcp_prompts", {"select": SELECTION, "order": ORDRE})
        except CrmIndisponible:
            journal.warning("prompts_indisponibles", extra={"cause": "crm"})
            return []
        if not reponse.reussie or not isinstance(reponse.corps, list):
            journal.warning("prompts_indisponibles", extra={"cause": "crm", "statut": reponse.statut})
            return []
        sujet = identite.sujet

        async def journaliser(lu: PromptLu, debut: float) -> None:
            outil = f"prompt:{lu.cle}"
            duree_ms = round((time.perf_counter() - debut) * 1000)
            journal.info("prompt", extra={"sujet": sujet, "outil": outil, "espace": lu.espace_id, "issue": "ok",
                                          "duree_ms": duree_ms})
            try:
                await self.moteur.registre.journaliser(sujet, outil, lu.espace_id, "ok", duree_ms)
            except CrmIndisponible:
                journal.warning("journal_indisponible", extra={"outil": outil})

        prompts: list[Prompt] = []
        for nom, titre, lu in nommer(lire_lignes(reponse.corps)):
            prompt = PromptEspace(name=nom, title=titre, description=lu.description, arguments=[])
            prompt._lu = lu
            prompt._journaliser = journaliser
            prompts.append(prompt)
        return prompts


def ajouter(serveur: Any, moteur: MoteurPolitique, crm: ClientCrm) -> FournisseurPrompts:
    """Inscrit le fournisseur au serveur ; rendu pour les tests."""
    fournisseur = FournisseurPrompts(moteur, crm)
    serveur.add_provider(fournisseur)
    return fournisseur

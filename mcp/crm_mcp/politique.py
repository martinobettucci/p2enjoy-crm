# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : la matrice appliquée par le service, à la visibilité et à chaque appel
# @spec CRM-108 (docs/BACKLOG.md) — tranche T4 : la famille `recettes`, les ancres `revenue` et `revenue_actual`
#       (docs/SPEC-recettes.md §7, docs/SPEC-mcp.md §6.1, §9.1)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T6 : le genre d'ancre `block` (docs/SPEC-mcp.md §9.2 nonies)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T4 : les genres d'ancre `cost`, `cost_actual` et `occurrence` (docs/SPEC-mcp.md §9.2 septies)
# @spec CRM-114 (docs/BACKLOG.md) tranche T4 — la famille `organizations` dans la liste fermée (docs/SPEC-organisations.md §5)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T1 : le genre d'ancre `workflow` (docs/SPEC-mcp.md §9.2 quater, décision 656)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T2.b : le genre d'ancre `activity` (docs/SPEC-mcp.md §9.2 ter, décision 655)
# @spec CRM-104 (docs/BACKLOG.md) — tranche T2.a : l'ancre `autres` FACULTATIVE, permise si son argument vaut `None` par
#       défaut, et pour elle seule (docs/SPEC-mcp.md §9.2 bis, décision 654)
# @spec docs/SPEC-mcp.md §5 (le jeton interne frappé à chaque appel), §6.1 (familles et actions), §6.2 (visibilité,
#       résolution de l'espace, `mcp_autorise`, refus uniforme), §9.1 (déclaration vérifiée au démarrage), §9.3
#       (traduction des refus du CRM), §14 (la matrice tenue par le service, jamais sans la RLS) ;
#       docs/JOURNAL.md décision 627 (A2, D2, D5, D6)
# @spec Modèle : `evoliz_mcp/politique.py` (p2enjoy-evoliz, révision 80a3e27) — contrôle d'accès par outil, moteur placé
#       après l'audit. Écart : le périmètre n'est pas tenu par le service ; c'est la RLS du CRM, sous le jeton interne.
"""La politique du connecteur.

Chaque outil DÉCLARE sa famille, son action, ses cases `aussi` et la façon de résoudre son espace. Deux contrôles en
découlent, tous deux côté serveur :

1. la **visibilité** (`Tool.auth`) : un outil n'existe, pour un compte, que si au moins un espace ouvre sa famille et
   son action ;
2. **chaque appel** : l'espace de l'objet visé est lu SOUS LE JETON DE LA PERSONNE, puis `public.mcp_autorise` est
   appelée sous ce même jeton. Un objet qu'elle ne lit pas est « introuvable », quelle qu'en soit la cause.

Le superadministrateur franchit la matrice ; personne ne franchit la RLS.
"""

from __future__ import annotations

import inspect
import logging
import re
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from fastmcp.exceptions import NotFoundError, ToolError
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.utilities.authorization import AuthContext

from crm_mcp.autorisation import identite_de
from crm_mcp.crm import ClientCrm, CrmIndisponible, Reponse
from crm_mcp.jeton_interne import Identite, JetonExpire, frapper
from crm_mcp.registre import EtatCompte, Registre, RegistreIndisponible

journal = logging.getLogger("crm_mcp.politique")

#: Les familles de la matrice (docs/SPEC-mcp.md §6.1) — la même liste fermée que le `check` de `mcp_droits` ;
#: `recettes` depuis `CRM-108` (docs/SPEC-recettes.md §7, migration 0095) ; `organizations` depuis `CRM-114`, après
#: `contacts` (docs/SPEC-organisations.md §5, migration 0101).
FAMILLES = (
    "structure", "affaires", "contacts", "organizations", "budgets", "recettes", "temps", "objectifs", "messagerie"
)
ACTIONS = ("consulter", "ajouter", "modifier", "supprimer")
#: Un outil de référence : pas d'espace unique, visible dès qu'un droit existe, résultats filtrés par la matrice.
REFERENCE = "reference"

#: Où lire l'espace d'un objet, sous le jeton de la personne : table, sélection, chemin jusqu'à `workspace_id`.
RESOLUTIONS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "track": ("tracks", "workspace_id", ("workspace_id",)),
    "channel": ("channels", "workspace_id", ("workspace_id",)),
    "card": ("cards", "workspace_id", ("workspace_id",)),
    "contact": ("contacts", "workspace_id", ("workspace_id",)),
    "organisation": ("organizations", "workspace_id", ("workspace_id",)),
    "budget": ("budgets", "track:tracks(workspace_id)", ("track", "workspace_id")),
    "board": ("goal_boards", "workspace_id", ("workspace_id",)),
    # `CRM-108` : une ligne de recette, et un réel de recette, résolus jusqu'à l'espace par leur affaire.
    "revenue": ("card_revenues", "card:cards(workspace_id)", ("card", "workspace_id")),
    "revenue_actual": (
        "card_revenue_actuals",
        "ligne:card_revenues(card:cards(workspace_id))",
        ("ligne", "card", "workspace_id"),
    ),
    # `CRM-104` T2.b : une activité d'affaire, qui porte son espace (`CRM-067`, migration 0100).
    "activity": ("card_activities", "workspace_id", ("workspace_id",)),
    # `CRM-104` T1 : un workflow porte son espace.
    "workflow": ("workflows", "workspace_id", ("workspace_id",)),
    # `CRM-104` T4 : une ligne de coût, et un coût réel, résolus jusqu'à l'espace par leur affaire (décision 669).
    "cost": ("card_costs", "card:cards(workspace_id)", ("card", "workspace_id")),
    "cost_actual": ("card_cost_actuals", "ligne:card_costs(card:cards(workspace_id))", ("ligne", "card", "workspace_id")),
    # `CRM-104` T6 : un bloc d'objectif, résolu par son tableau (décision 674).
    "block": ("goal_blocks", "board:goal_boards(workspace_id)", ("board", "workspace_id")),
    # Une occurrence de budget, résolue par son budget puis son track : tout identifiant passé à un outil est une ancre.
    "occurrence": (
        "budget_occurrences",
        "budget:budgets(track:tracks(workspace_id))",
        ("budget", "track", "workspace_id"),
    ),
}
#: Le libellé d'un objet dans un refus : le terme métier français.
LIBELLES = {
    "workspace": "espace",
    "track": "track",
    "channel": "channel",
    "card": "affaire",
    "contact": "contact",
    "organisation": "organisation",
    "budget": "budget",
    "board": "tableau d'objectifs",
    "revenue": "ligne de recette",
    "revenue_actual": "recette réelle",
    "activity": "activité",
    "workflow": "workflow",
    "cost": "ligne de coût",
    "cost_actual": "coût réel",
    "occurrence": "occurrence de budget",
    "block": "bloc d'objectif",
}

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

#: Une visibilité calculée sert le temps d'un `tools/list` (un contrôle par outil), pas davantage.
DUREE_VISIBILITE_S = 2.0
#: Comptes dont l'inscription récente est retenue (relève de `derniere_activite` à chaque jeton LeLabs renouvelé).
INSCRITS_MAX = 10_000


class DeclarationInvalide(Exception):
    """Une déclaration d'outil absente ou incohérente : le service ne démarre pas (docs/SPEC-mcp.md §9.1)."""


class RefusMatrice(ToolError):
    """La matrice ferme l'appel ; l'audit le nomme `refus_matrice`."""

    issue_audit = "refus_matrice"


class RefusCrm(ToolError):
    """Le CRM refuse ou cache l'objet (RLS, règle métier) ; l'audit le nomme `refus_crm`."""

    issue_audit = "refus_crm"


@dataclass(frozen=True)
class Declaration:
    """Ce que chaque outil dit de lui-même (docs/SPEC-mcp.md §9.1).

    `espace` vaut `reference`, `workspace:<argument>` ou `<genre>:<argument>` (genre de `RESOLUTIONS`). `autres` nomme
    les AUTRES arguments d'identifiant (même forme) : chacun est résolu et soumis à la même matrice.
    """

    famille: str
    action: str
    espace: str
    aussi: tuple[tuple[str, str], ...] = ()
    autres: tuple[str, ...] = ()

    @property
    def ancres(self) -> tuple[str, ...]:
        return () if self.espace == REFERENCE else (self.espace, *self.autres)

    def verifier(self, nom: str, parametres: set[str], destructif: bool, facultatifs: frozenset[str] = frozenset()) -> None:
        """Refuse une déclaration incohérente avec la liste fermée, avec la signature ou avec les annotations.

        `facultatifs` nomme les arguments qui valent `None` par défaut. Seule une ancre `autres` peut en être un : un
        identifiant absent n'a rien à résoudre, mais l'espace de l'appel, lui, est toujours donné (§9.2 bis)."""
        defauts: list[str] = []
        if self.famille == REFERENCE:
            if self.espace != REFERENCE or self.action != "consulter" or self.aussi or self.autres:
                defauts.append("un outil de référence consulte, sans espace, sans case `aussi` ni autre ancre")
        elif self.famille not in FAMILLES:
            defauts.append(f"famille inconnue {self.famille!r}")
        if self.action not in ACTIONS:
            defauts.append(f"action inconnue {self.action!r}")
        for famille, action in self.aussi:
            if famille not in FAMILLES or action not in ACTIONS:
                defauts.append(f"case `aussi` inconnue {famille}:{action}")
        if self.famille != REFERENCE and self.espace == REFERENCE:
            defauts.append("un outil de famille résout son espace")
        ancrees: set[str] = set()
        for ancre in self.ancres:
            genre, _, argument = ancre.partition(":")
            if genre != "workspace" and genre not in RESOLUTIONS:
                defauts.append(f"genre d'ancre inconnu {genre!r}")
            if argument not in parametres:
                defauts.append(f"ancre {ancre!r} : argument absent de la signature")
            ancrees.add(argument)
        if self.espace != REFERENCE and self.espace.partition(":")[2] in facultatifs:
            defauts.append("l'ancre d'espace est obligatoire : son argument n'a pas de valeur par défaut")
        # Complétude : tout argument d'identifiant est une ancre — sinon un identifiant d'un autre espace passerait
        # la matrice sans être lu (docs/SPEC-mcp.md §9.1, modèle : `tests/test_politique.py` d'Evoliz).
        for parametre in sorted(parametres):
            if (parametre == "workspace" or parametre.endswith("_id")) and parametre not in ancrees:
                defauts.append(f"argument d'identifiant {parametre!r} non déclaré")
        # `readOnlyHint` découle de l'action ; `destructiveHint` est exigé d'une mise à la corbeille ou d'un archivage,
        # et refusé à une consultation (docs/SPEC-mcp.md §9.1).
        if self.action == "supprimer" and not destructif:
            defauts.append("une suppression porte `destructiveHint`")
        if self.action == "consulter" and destructif:
            defauts.append("une consultation ne porte pas `destructiveHint`")
        if defauts:
            raise DeclarationInvalide(f"{nom} : " + " ; ".join(defauts))


@dataclass
class Appel:
    """L'appel en cours : créé par l'audit, rempli par la politique, lu par l'outil et relu par l'audit."""

    sujet: str | None = None
    identite: Identite | None = None
    jeton: str | None = None
    espace: str | None = None
    etat: EtatCompte | None = None


APPEL: ContextVar[Appel | None] = ContextVar("crm_mcp_appel", default=None)


def appel_courant() -> Appel:
    """L'appel en cours, rempli par la politique ; un outil appelé hors de la chaîne est une erreur de montage."""
    appel = APPEL.get()
    if appel is None or appel.jeton is None or appel.identite is None or appel.etat is None or appel.sujet is None:
        raise RuntimeError("outil appelé hors de la politique")
    return appel


def introuvable(genre: str, valeur: Any) -> str:
    """LE refus uniforme : inexistant, fermé par la matrice ou caché par la RLS (docs/SPEC-mcp.md §6.2)."""
    return f"Introuvable ou hors de votre périmètre : {LIBELLES.get(genre, genre)} {valeur}."


def traduire_refus(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    """Un refus du CRM en message pour le modèle : le code et une phrase, jamais un détail technique (§9.3)."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    if reponse.statut in (401, 403) or corps.get("code") == "42501":
        return RefusCrm(introuvable(genre, valeur))
    message = corps.get("message")
    if reponse.statut < 500 and isinstance(message, str) and re.fullmatch(r"[a-z_]{3,64}", message):
        return RefusCrm(f"Refusé par le CRM : {message}.")
    return ToolError(f"Le CRM n'a pas pu traiter la demande (HTTP {reponse.statut}).")


def _parametres(fonction: Callable[..., Any]) -> set[str]:
    return set(inspect.signature(fonction).parameters)


def _facultatifs(fonction: Callable[..., Any]) -> frozenset[str]:
    """Les arguments dont la valeur par défaut est `None`."""
    return frozenset(n for n, p in inspect.signature(fonction).parameters.items() if p.default is None)


@dataclass
class MoteurPolitique:
    registre: Registre
    crm: ClientCrm
    jwt_secret: str
    horloge: Callable[[], float] = time.time
    #: L'identité d'un jeton LeLabs vérifié ; les tests l'injectent, comme le mandataire le fait en service.
    identite_du_jeton: Callable[[Any], Identite | None] = identite_de
    declarations: dict[str, Declaration] = field(default_factory=dict)
    #: Par outil, les arguments d'ancre `autres` facultatifs (valeur par défaut `None`) : absents, ils ne sont pas résolus.
    facultatives: dict[str, frozenset[str]] = field(default_factory=dict)
    _visibilites: dict[tuple[str, bool], tuple[float, EtatCompte]] = field(default_factory=dict)
    _inscrits: dict[str, int | None] = field(default_factory=dict)

    # --- Déclaration -----------------------------------------------------------------------------------------------

    def enregistrer(
        self,
        serveur: Any,
        fonction: Callable[..., Awaitable[Any]],
        declaration: Declaration,
        *,
        titre: str,
        description: str,
        destructif: bool = False,
    ) -> None:
        """Enregistre un outil AVEC sa déclaration, vérifiée ici : sans elle, le service ne démarre pas."""
        nom = fonction.__name__
        lecture_seule = declaration.action == "consulter"
        facultatifs = _facultatifs(fonction)
        declaration.verifier(nom, _parametres(fonction), destructif, facultatifs)
        if nom in self.declarations:
            raise DeclarationInvalide(f"{nom} : déclaré deux fois")
        self.declarations[nom] = declaration
        self.facultatives[nom] = frozenset(
            a.partition(":")[2] for a in declaration.autres if a.partition(":")[2] in facultatifs
        )
        serveur.tool(
            fonction,
            name=nom,
            title=titre,
            description=description,
            annotations={"readOnlyHint": lecture_seule, "destructiveHint": destructif, "openWorldHint": False},
            tags={declaration.famille},
            auth=self.controle(nom),
        )

    # --- Qui appelle -----------------------------------------------------------------------------------------------

    async def etat(self, identite: Identite) -> EtatCompte:
        """Le drapeau et la matrice ; inscrit d'abord le compte à chaque nouveau jeton LeLabs (docs/SPEC-mcp.md §7.3).

        L'inscription relève `derniere_activite` et applique l'amorçage, que la première connexion ait eu lieu ou non
        par ce service."""
        if self._inscrits.get(identite.sujet, -1) != identite.expire_a:
            etat = await self.registre.inscrire(identite)
            if len(self._inscrits) >= INSCRITS_MAX:
                self._inscrits.clear()
            self._inscrits[identite.sujet] = identite.expire_a
            return etat
        return await self.registre.etat(identite)

    async def _etat_visible(self, identite: Identite) -> EtatCompte:
        cle = (identite.sujet, identite.admin_lelabs)
        maintenant = self.horloge()
        memo = self._visibilites.get(cle)
        if memo is not None and maintenant - memo[0] < DUREE_VISIBILITE_S:
            return memo[1]
        etat = await self.etat(identite)
        if len(self._visibilites) >= INSCRITS_MAX:
            self._visibilites.clear()
        self._visibilites[cle] = (maintenant, etat)
        return etat

    @staticmethod
    def visible(etat: EtatCompte, declaration: Declaration) -> bool:
        if declaration.famille == REFERENCE:
            return etat.peut_entrer
        return etat.ouvre(declaration.famille, declaration.action, declaration.aussi)

    def controle(self, nom: str) -> Callable[[AuthContext], Awaitable[bool]]:
        """Le contrôle FastMCP d'un outil : évalué à `tools/list` et à la résolution d'un appel (§6.2, point 1)."""

        async def controle_politique(contexte: AuthContext) -> bool:
            identite = self.identite_du_jeton(contexte.token)
            declaration = self.declarations.get(nom)
            if identite is None or declaration is None:
                return False
            try:
                etat = await self._etat_visible(identite)
            except (RegistreIndisponible, CrmIndisponible):
                # Refusé, jamais accordé par défaut.
                journal.warning("registre_indisponible", extra={"outil": nom})
                return False
            return self.visible(etat, declaration)

        controle_politique.__name__ = f"politique_{nom}"
        return controle_politique

    # --- Chaque appel ----------------------------------------------------------------------------------------------

    async def resoudre(self, jeton: str, ancre: str, arguments: dict[str, Any]) -> tuple[str, bool, str]:
        """L'espace d'une ancre, lu sous le jeton de la personne : (identifiant, nommé par elle, libellé du refus)."""
        genre, _, argument = ancre.partition(":")
        valeur = arguments.get(argument)
        if not isinstance(valeur, str) or not valeur:
            raise RefusCrm(introuvable(genre, valeur))
        if genre == "workspace":
            if _UUID.match(valeur):
                filtre = {"id": f"eq.{valeur}"}
            elif _SLUG.match(valeur):
                filtre = {"slug": f"eq.{valeur}"}
            else:
                raise RefusCrm(introuvable(genre, valeur))
            reponse = await self.crm.lire(jeton, "workspaces", {**filtre, "select": "id,slug"})
            lignes = reponse.corps if reponse.reussie and isinstance(reponse.corps, list) else []
            if len(lignes) != 1:
                raise RefusCrm(introuvable(genre, valeur))
            return str(lignes[0]["id"]), True, str(lignes[0]["slug"])
        if not _UUID.match(valeur):
            raise RefusCrm(introuvable(genre, valeur))
        table, selection, chemin = RESOLUTIONS[genre]
        reponse = await self.crm.lire(jeton, table, {"id": f"eq.{valeur}", "select": selection})
        lignes = reponse.corps if reponse.reussie and isinstance(reponse.corps, list) else []
        espace: Any = lignes[0] if len(lignes) == 1 else None
        for cle in chemin:
            espace = espace.get(cle) if isinstance(espace, dict) else None
        if not isinstance(espace, str):
            raise RefusCrm(introuvable(genre, valeur))
        return espace, False, f"{genre}:{valeur}"

    async def autorise(self, jeton: str, espace: str, famille: str, action: str) -> bool:
        """`public.mcp_autorise` sous le jeton de la personne (docs/SPEC-mcp.md §6.3)."""
        reponse = await self.crm.rpc(
            jeton, "mcp_autorise", {"p_ws": espace, "p_famille": famille, "p_action": action}, idempotent=True
        )
        if not reponse.reussie or not isinstance(reponse.corps, bool):
            raise ToolError(f"Le CRM n'a pas pu vérifier les droits du connecteur (HTTP {reponse.statut}).")
        return reponse.corps

    async def verifier_appel(self, nom: str, arguments: dict[str, Any], appel: Appel) -> None:
        """Visibilité, jeton interne, espace, matrice — dans cet ordre, avant toute donnée (§6.2, point 2)."""
        declaration = self.declarations.get(nom)
        identite = self.identite_du_jeton(get_access_token())
        if declaration is None:
            raise NotFoundError(f"Unknown tool: {nom!r}")
        if identite is None:
            raise RefusCrm("Appel sans identité : reconnectez votre client MCP.")
        appel.sujet = identite.sujet
        appel.identite = identite
        try:
            appel.etat = await self.etat(identite)
        except (RegistreIndisponible, CrmIndisponible) as erreur:
            raise ToolError("Le registre du connecteur est indisponible ; réessayez dans un instant.") from erreur
        if not self.visible(appel.etat, declaration):
            # Un outil fermé n'existe pas pour ce compte : même réponse que FastMCP pour un outil inconnu.
            raise NotFoundError(f"Unknown tool: {nom!r}")
        try:
            appel.jeton = frapper(self.jwt_secret, identite, int(self.horloge()))
        except JetonExpire as erreur:
            raise RefusCrm("Session échue : reconnectez votre client MCP.") from erreur
        cases = ((declaration.famille, declaration.action), *declaration.aussi)
        facultatives = self.facultatives.get(nom, frozenset())
        for ancre in declaration.ancres:
            argument = ancre.partition(":")[2]
            if argument in facultatives and arguments.get(argument) is None:
                # Une ancre `autres` facultative et absente : aucun identifiant, rien à lire ni à autoriser de plus.
                continue
            espace, nomme, libelle = await self.resoudre(appel.jeton, ancre, arguments)
            appel.espace = appel.espace or espace
            for famille, action in cases:
                if await self.autorise(appel.jeton, espace, famille, action):
                    continue
                if nomme:
                    raise RefusMatrice(
                        f"Le connecteur n'a pas le droit « {action} » sur « {famille} » dans l'espace {libelle}."
                    )
                genre, _, valeur = libelle.partition(":")
                raise RefusMatrice(introuvable(genre, valeur))


class PolitiqueOutils(Middleware):
    """Applique la politique à chaque appel ; placé après l'audit, avant l'outil."""

    def __init__(self, moteur: MoteurPolitique) -> None:
        self.moteur = moteur

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        nom = getattr(context.message, "name", None)
        arguments = dict(getattr(context.message, "arguments", None) or {})
        appel = APPEL.get()
        jeton_pose = None
        if appel is None:
            appel = Appel()
            jeton_pose = APPEL.set(appel)
        try:
            await self.moteur.verifier_appel(str(nom), arguments, appel)
            return await call_next(context)
        finally:
            # Le jeton interne ne survit pas à l'appel qui l'a frappé (docs/SPEC-mcp.md §5).
            appel.jeton = None
            if jeton_pose is not None:
                APPEL.reset(jeton_pose)

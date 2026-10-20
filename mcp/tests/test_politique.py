# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires de la politique, par un vrai client MCP en mémoire
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §5 (le jeton interne porte l'appel jusqu'au CRM et ne lui survit pas), §6.2
#           (visibilité par la matrice ; espace lu sous le jeton de la personne ; `mcp_autorise` pour l'action et chaque
#           case `aussi` ; refus uniforme ; refus nommé sur un espace donné ; outil caché = outil inconnu ; superadmin
#           franchit la matrice), §7.1 (journal : sujet, outil, espace, issue — jamais un argument), §9.1 (déclaration
#           vérifiée : liste fermée, complétude des identifiants, annotations), §9.3 (garde de taille, traduction des
#           refus du CRM)
"""Trois comptes devant le CRM simulé : Ana (superadministratrice amorcée), Thomas (membre des deux espaces, droits
du connecteur sur « atelier » seulement) et Vera (aucun droit). L'identité de l'appel est injectée dans le moteur :
c'est ce que le mandataire OAuth fait en service."""

from __future__ import annotations

from typing import Annotated

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.audit import AuditOutils
from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.jeton_interne import EMETTEUR, Identite
from crm_mcp.outils import reference
from crm_mcp.politique import (
    APPEL,
    REFERENCE,
    Declaration,
    DeclarationInvalide,
    MoteurPolitique,
    PolitiqueOutils,
    RefusCrm,
    appel_courant,
    traduire_refus,
)
from crm_mcp.registre import Registre

from .conftest import BUDGET_A, CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, TRACK_A, TRACK_B

ANA = Identite("sujet-ana", "ana@exemple.test", "Ana", True, False, 4_000_000_000)
THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)
VERA = Identite("sujet-vera", "vera@exemple.test", "Vera", True, False, 4_000_000_000)
OPS = Identite("sujet-ops", "ops@exemple.test", "Ops", True, True, 4_000_000_000)


def _outils_de_test(serveur: FastMCP, moteur: MoteurPolitique) -> None:
    """Des outils d'épreuve, un par forme d'ancre ; les vrais outils de famille viennent avec `CRM-104`."""

    async def epreuve_track_get(track_id: Annotated[str, Field()]) -> dict:
        appel = appel_courant()
        return {"track": track_id, "espace": appel.espace}

    async def epreuve_card_create(workspace: str, titre: str) -> dict:
        return {"cree": titre}

    async def epreuve_card_link(workspace: str, contact_id: str) -> dict:
        return {"lie": contact_id}

    async def epreuve_budget_get(budget_id: str) -> dict:
        return {"budget": budget_id}

    async def epreuve_gros(workspace: str) -> dict:
        return {"texte": "x" * 5000}

    moteur.enregistrer(serveur, epreuve_track_get, Declaration("structure", "consulter", "track:track_id"),
                       titre="t", description="d")
    moteur.enregistrer(serveur, epreuve_card_create, Declaration("affaires", "ajouter", "workspace:workspace"),
                       titre="t", description="d")
    moteur.enregistrer(serveur, epreuve_card_link,
                       Declaration("affaires", "modifier", "workspace:workspace", aussi=(("contacts", "consulter"),),
                                   autres=("track:contact_id",)),
                       titre="t", description="d")
    moteur.enregistrer(serveur, epreuve_budget_get, Declaration("budgets", "consulter", "budget:budget_id"),
                       titre="t", description="d")
    moteur.enregistrer(serveur, epreuve_gros, Declaration("structure", "consulter", "workspace:workspace"),
                       titre="t", description="d")


class Monde:
    def __init__(self, crm_simule, transport, taille_max: int = 200_000) -> None:
        self.simule = crm_simule
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE, transport=transport)
        self.registre = Registre(self.crm, ("ana@exemple.test",))
        self.identite: Identite | None = None
        self.moteur = MoteurPolitique(
            registre=self.registre, crm=self.crm, jwt_secret=SECRET, identite_du_jeton=lambda _jeton: self.identite
        )
        self.mcp = FastMCP("test")
        reference.ajouter(self.mcp, self.moteur, self.crm)
        _outils_de_test(self.mcp, self.moteur)
        self.mcp.add_middleware(AuditOutils(self.registre, taille_max))
        self.mcp.add_middleware(PolitiqueOutils(self.moteur))
        crm_simule.membres = {"sujet-thomas": {ESPACE_A: "editor", ESPACE_B: "viewer"}, "sujet-ana": {ESPACE_A: "admin"}}
        crm_simule.droits |= {
            ("sujet-thomas", ESPACE_A, "structure", "consulter"),
            ("sujet-thomas", ESPACE_A, "affaires", "ajouter"),
            ("sujet-thomas", ESPACE_A, "affaires", "modifier"),
            ("sujet-thomas", ESPACE_A, "budgets", "consulter"),
        }

    async def appel(self, qui: Identite, outil: str, arguments: dict | None = None):
        self.identite = qui
        # La visibilité est mémorisée le temps d'un `tools/list` : chaque épreuve repart d'un état relu.
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return (await client.call_tool(outil, arguments or {})).structured_content

    async def outils(self, qui: Identite) -> set[str]:
        self.identite = qui
        self.moteur._visibilites.clear()
        async with Client(self.mcp) as client:
            return {o.name for o in await client.list_tools()}


@pytest.fixture
async def monde(crm_simule, transport_crm):
    m = Monde(crm_simule, transport_crm)
    yield m
    await m.crm.fermer()


async def refus(coroutine, attendu: str) -> str:
    with pytest.raises(ToolError) as erreur:
        await coroutine
    assert attendu in str(erreur.value), str(erreur.value)
    return str(erreur.value)


# --- La déclaration est vérifiée à l'enregistrement --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("declaration", "signature", "destructif", "attendu"),
    [
        (Declaration("finances", "consulter", "workspace:workspace"), "workspace", False, "famille inconnue"),
        (Declaration("affaires", "lire", "workspace:workspace"), "workspace", False, "action inconnue"),
        (Declaration("affaires", "consulter", "facture:facture_id"), "facture_id", False, "genre d'ancre inconnu"),
        (Declaration("affaires", "consulter", "card:card_id"), "autre", False, "argument absent"),
        (Declaration("affaires", "consulter", "card:card_id"), "card_id,channel_id", False, "'channel_id' non déclaré"),
        (Declaration("affaires", "consulter", "card:card_id"), "card_id,workspace", False, "'workspace' non déclaré"),
        (Declaration("affaires", "consulter", REFERENCE), "", False, "résout son espace"),
        (Declaration(REFERENCE, "ajouter", REFERENCE), "", False, "un outil de référence consulte"),
        (Declaration("affaires", "consulter", "card:card_id", aussi=(("x", "y"),)), "card_id", False, "case `aussi`"),
        (Declaration("affaires", "supprimer", "card:card_id"), "card_id", False, "porte `destructiveHint`"),
        (Declaration("affaires", "consulter", "card:card_id"), "card_id", True, "ne porte pas `destructiveHint`"),
    ],
)
def test_declaration_invalide_refusee(declaration, signature, destructif, attendu):
    with pytest.raises(DeclarationInvalide) as erreur:
        declaration.verifier("outil", {p for p in signature.split(",") if p}, destructif)
    assert attendu in str(erreur.value)


async def test_outil_declare_deux_fois_refuse(monde):
    async def crm_workspace_list() -> dict:
        return {}

    with pytest.raises(DeclarationInvalide, match="déclaré deux fois"):
        monde.moteur.enregistrer(monde.mcp, crm_workspace_list, Declaration(REFERENCE, "consulter", REFERENCE),
                                 titre="t", description="d")


async def test_annotations_posees(monde):
    monde.identite = ANA
    async with Client(monde.mcp) as client:
        outils = {o.name: o for o in await client.list_tools()}
    liste = outils["crm_workspace_list"].annotations
    assert (liste.read_only_hint, liste.destructive_hint, liste.open_world_hint) == (True, False, False)
    assert outils["epreuve_card_create"].annotations.read_only_hint is False


# --- Visibilité (§6.2, point 1) ------------------------------------------------------------------------------------------


async def test_visibilite_par_la_matrice(monde):
    assert await monde.outils(VERA) == set(), "sans droit : aucun outil, pas même la référence"
    assert await monde.outils(THOMAS) == {
        "crm_workspace_list", "epreuve_track_get", "epreuve_card_create", "epreuve_budget_get", "epreuve_gros",
    }, "`epreuve_card_link` exige aussi contacts:consulter dans le même espace"
    monde.simule.droits.add(("sujet-thomas", ESPACE_A, "contacts", "consulter"))
    assert "epreuve_card_link" in await monde.outils(THOMAS)


async def test_superadmin_et_admin_lelabs_voient_tout(monde):
    tout = set(monde.moteur.declarations)
    await monde.registre.inscrire(ANA)
    assert await monde.outils(ANA) == tout
    assert await monde.outils(OPS) == tout


async def test_registre_injoignable_cache_tout(monde):
    monde.simule.indisponible = True
    assert await monde.outils(THOMAS) == set()


async def test_outil_cache_repond_outil_inconnu_sans_journal(monde):
    await refus(monde.appel(VERA, "crm_workspace_list"), "Unknown tool")
    await refus(monde.appel(THOMAS, "epreuve_card_link", {"workspace": "atelier", "contact_id": TRACK_A}), "Unknown tool")
    assert monde.simule.journal == []


# --- Chaque appel (§6.2, point 2) ----------------------------------------------------------------------------------------


async def test_succes_sous_le_jeton_de_la_personne(monde):
    assert await monde.appel(THOMAS, "epreuve_track_get", {"track_id": TRACK_A}) == {"track": TRACK_A, "espace": ESPACE_A}
    jetons = monde.simule.jetons
    assert jetons and all(j["sub"] == "sujet-thomas" and j["iss"] == EMETTEUR and j["canal"] == "mcp" for j in jetons)
    assert all("lelabs_admin" not in j for j in jetons)
    assert monde.simule.journal[-1] == {
        "p_sub": "sujet-thomas", "p_outil": "epreuve_track_get", "p_ws": ESPACE_A, "p_issue": "ok",
        "p_duree_ms": monde.simule.journal[-1]["p_duree_ms"],
    }
    assert APPEL.get() is None, "l'appel et son jeton interne ne survivent pas à la requête"


async def test_objet_cache_par_le_crm_refus_uniforme(monde):
    monde.simule.membres["sujet-thomas"].pop(ESPACE_B)
    texte = await refus(monde.appel(THOMAS, "epreuve_track_get", {"track_id": TRACK_B}), "Introuvable ou hors de votre")
    assert texte.endswith(f"track {TRACK_B}.")
    assert monde.simule.journal[-1]["p_issue"] == "refus_crm"


async def test_objet_ferme_par_la_matrice_meme_refus(monde):
    """Thomas LIT le track de « bureau » dans le CRM, mais la matrice ferme cet espace : même texte qu'introuvable."""
    texte = await refus(monde.appel(THOMAS, "epreuve_track_get", {"track_id": TRACK_B}), "Introuvable ou hors de votre")
    assert texte.endswith(f"track {TRACK_B}.")
    assert (monde.simule.journal[-1]["p_issue"], monde.simule.journal[-1]["p_ws"]) == ("refus_matrice", ESPACE_B)


async def test_identifiant_inexistant_ou_mal_forme_meme_refus(monde):
    for valeur in ("c0000000-0000-4000-8000-0000000000c1", "pas-un-uuid", "' or 1=1 --"):
        await refus(monde.appel(THOMAS, "epreuve_track_get", {"track_id": valeur}), f"track {valeur}.")


async def test_espace_nomme_refus_nomme(monde):
    await refus(
        monde.appel(THOMAS, "epreuve_card_create", {"workspace": "bureau", "titre": "x"}),
        "Le connecteur n'a pas le droit « ajouter » sur « affaires » dans l'espace bureau.",
    )
    assert await monde.appel(THOMAS, "epreuve_card_create", {"workspace": "atelier", "titre": "x"}) == {"cree": "x"}
    assert await monde.appel(THOMAS, "epreuve_card_create", {"workspace": ESPACE_A, "titre": "y"}) == {"cree": "y"}


async def test_espace_inconnu_ou_non_lisible(monde):
    await refus(monde.appel(THOMAS, "epreuve_card_create", {"workspace": "inconnu", "titre": "x"}), "espace inconnu.")
    await refus(monde.appel(THOMAS, "epreuve_card_create", {"workspace": "Atelier!", "titre": "x"}), "espace Atelier!.")
    await refus(monde.appel(VERA, "epreuve_card_create", {"workspace": "atelier", "titre": "x"}), "Unknown tool")


async def test_case_aussi_et_ancre_secondaire_verifiees(monde):
    monde.simule.droits |= {
        ("sujet-thomas", ESPACE_A, "contacts", "consulter"),
    }
    assert await monde.appel(THOMAS, "epreuve_card_link", {"workspace": "atelier", "contact_id": TRACK_A}) == {"lie": TRACK_A}
    # L'ancre secondaire est lue et soumise à la même matrice : un objet de « bureau » est refusé.
    texte = await refus(monde.appel(THOMAS, "epreuve_card_link", {"workspace": "atelier", "contact_id": TRACK_B}),
                        "Introuvable ou hors de votre")
    assert texte.endswith(f"track {TRACK_B}.")
    # La case `aussi` est vérifiée dans l'espace de l'appel.
    monde.simule.droits.add(("sujet-thomas", ESPACE_B, "affaires", "modifier"))
    await refus(monde.appel(THOMAS, "epreuve_card_link", {"workspace": "bureau", "contact_id": TRACK_B}),
                "Le connecteur n'a pas le droit « consulter » sur « contacts » dans l'espace bureau.")


async def test_espace_lu_par_une_relation(monde):
    assert await monde.appel(THOMAS, "epreuve_budget_get", {"budget_id": BUDGET_A}) == {"budget": BUDGET_A}
    assert monde.simule.journal[-1]["p_ws"] == ESPACE_A


async def test_superadmin_franchit_la_matrice_pas_la_rls(monde):
    await monde.registre.inscrire(ANA)
    assert monde.simule.superadmins == {"sujet-ana"}
    assert await monde.appel(ANA, "epreuve_track_get", {"track_id": TRACK_A}) == {"track": TRACK_A, "espace": ESPACE_A}
    # Ana n'est pas membre de « bureau » : la RLS lui cache le track, superadministratrice ou non.
    await refus(monde.appel(ANA, "epreuve_track_get", {"track_id": TRACK_B}), "Introuvable ou hors de votre")


async def test_admin_lelabs_porte_la_revendication(monde):
    assert await monde.appel(OPS, "epreuve_track_get", {"track_id": TRACK_B}) == {"track": TRACK_B, "espace": ESPACE_B}
    assert monde.simule.jetons and all(j["lelabs_admin"] is True for j in monde.simule.jetons)


async def test_inscription_a_chaque_nouveau_jeton_lelabs(monde):
    await monde.appel(THOMAS, "crm_workspace_list")
    await monde.appel(THOMAS, "crm_workspace_list")
    assert monde.simule.comptes["sujet-thomas"]["inscriptions"] == 1
    renouvele = Identite(THOMAS.sujet, THOMAS.courriel, THOMAS.nom, True, False, THOMAS.expire_a + 300)
    await monde.appel(renouvele, "crm_workspace_list")
    assert monde.simule.comptes["sujet-thomas"]["inscriptions"] == 2


async def test_jeton_lelabs_echu_refuse(monde):
    echu = Identite(THOMAS.sujet, THOMAS.courriel, THOMAS.nom, True, False, 1)
    await refus(monde.appel(echu, "epreuve_track_get", {"track_id": TRACK_A}), "Session échue")


async def test_journal_sans_argument(monde):
    await monde.appel(THOMAS, "epreuve_card_create", {"workspace": "atelier", "titre": "Titre confidentiel"})
    assert "Titre confidentiel" not in repr(monde.simule.journal)
    assert set(monde.simule.journal[-1]) == {"p_sub", "p_outil", "p_ws", "p_issue", "p_duree_ms"}


async def test_garde_de_taille(crm_simule, transport_crm):
    monde = Monde(crm_simule, transport_crm, taille_max=1000)
    await refus(monde.appel(THOMAS, "epreuve_gros", {"workspace": "atelier"}), "Réponse trop volumineuse")
    assert crm_simule.journal[-1]["p_issue"] == "trop_volumineux"
    await monde.crm.fermer()


# --- crm_workspace_list -----------------------------------------------------------------------------------------------


async def test_liste_des_espaces_restreinte_par_la_matrice(monde):
    assert await monde.appel(THOMAS, "crm_workspace_list") == {
        "total": 1,
        "offset": 0,
        "workspaces": [
            {
                "id": ESPACE_A,
                "slug": "atelier",
                "name": "Atelier",
                "role": "editor",
                "rights": ["affaires:ajouter", "affaires:modifier", "budgets:consulter", "structure:consulter"],
            }
        ],
    }


async def test_liste_des_espaces_du_superadmin_dans_la_rls(monde):
    await monde.registre.inscrire(ANA)
    resultat = await monde.appel(ANA, "crm_workspace_list")
    assert [(e["slug"], e["role"], e["rights"]) for e in resultat["workspaces"]] == [("atelier", "admin", "all")]
    tout = await monde.appel(OPS, "crm_workspace_list")
    assert [(e["slug"], e["role"]) for e in tout["workspaces"]] == [("atelier", None), ("bureau", None)]


async def test_liste_des_espaces_paginee(monde):
    page = await monde.appel(OPS, "crm_workspace_list", {"limit": 1, "offset": 1})
    assert (page["total"], page["offset"], [e["slug"] for e in page["workspaces"]]) == (2, 1, ["bureau"])
    await refus(monde.appel(OPS, "crm_workspace_list", {"limit": 101}), "less than or equal to 100")


# --- Traduction des refus du CRM (§9.3) -----------------------------------------------------------------------------------


def test_traduction_des_refus():
    assert str(traduire_refus(Reponse(403, {"code": "42501"}), "card", "c1")) == "Introuvable ou hors de votre périmètre : affaire c1."
    assert isinstance(traduire_refus(Reponse(401, None), "card", "c1"), RefusCrm)
    assert str(traduire_refus(Reponse(400, {"code": "P0001", "message": "transition_not_allowed"}), "card", "c1")) == (
        "Refusé par le CRM : transition_not_allowed."
    )
    generique = traduire_refus(Reponse(400, {"message": "duplicate key value violates unique constraint \"x\""}), "card", "c")
    assert str(generique) == "Le CRM n'a pas pu traiter la demande (HTTP 400)." and not isinstance(generique, RefusCrm)
    assert str(traduire_refus(Reponse(500, {"message": "boom"}), "card", "c")) == "Le CRM n'a pas pu traiter la demande (HTTP 500)."

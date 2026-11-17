# @verifies CRM-102 (docs/BACKLOG.md) — le socle du connecteur, auquel `CRM-149` ajoute la capacité `prompts` (docs/SPEC-mcp.md §2.1)
# @verifies CRM-149 (docs/BACKLOG.md) — tranche T2 : le fournisseur des prompts du connecteur — liste vide sans identité ou
#           sans droit ; la lecture sous le jeton interne de la personne, bornée par la RLS aux espaces dont elle est
#           membre ; le nom nu, ou suffixé du slug quand deux espaces portent le même identifiant, et le titre complété ;
#           le message rendu avec son en-tête d'espace ; la ligne `prompt:<clé>` au journal à chaque `prompts/get`, jamais
#           à la liste ; une base injoignable qui rend une liste vide ; la capacité `prompts` annoncée
# @verifies docs/SPEC-mcp.md §17.5 (le serveur), §17.1 (texte seul : aucun argument) ; docs/JOURNAL.md décision 930
"""Un CRM simulé qui rend `mcp_prompts` sous la RLS « membre de l'espace » ; la vraie base est éprouvée par
`tests/test_integration_prompts.py`."""

from __future__ import annotations

from typing import Any

import httpx2
import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import McpError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from crm_mcp import prompts
from crm_mcp.crm import ClientCrm
from crm_mcp.jeton_interne import Identite
from crm_mcp.politique import MoteurPolitique
from crm_mcp.prompts import PromptLu, lire_lignes, message, nommer
from crm_mcp.registre import Registre

from .conftest import CLE_ANONYME, CLE_SERVICE, ESPACE_A, ESPACE_B, SECRET, CrmSimule

THOMAS = Identite("sujet-thomas", "thomas@exemple.test", "Thomas", True, False, 4_000_000_000)


def ligne(espace: str, slug: str, nom: str, cle: str, titre: str) -> dict[str, Any]:
    return {"id": f"{espace}-{cle}", "key": cle, "title": titre, "description": f"Description de {cle}.",
            "body": f"Texte de {cle}.\n2. Deuxième étape.", "workspace_id": espace,
            "workspace": {"slug": slug, "name": nom}}


class CrmPrompts(CrmSimule):
    def __init__(self) -> None:
        super().__init__()
        self.lignes = [
            ligne(ESPACE_A, "atelier", "Atelier", "faire-le-point", "Faire le point sur une affaire"),
            ligne(ESPACE_A, "atelier", "Atelier", "creer-une-affaire", "Créer une affaire complète"),
            ligne(ESPACE_B, "bureau", "Bureau", "faire-le-point", "Faire le point sur une affaire"),
            ligne(ESPACE_B, "bureau", "Bureau", "propre-au-bureau", "Propre au bureau"),
        ]
        self.lectures: list[dict[str, str]] = []
        self.prompts_en_panne = False

    async def table(self, requete: Request) -> Response:
        if requete.path_params["table"] != "mcp_prompts":
            return await super().table(requete)
        personne = self._personne(requete)
        if personne is None:
            return JSONResponse({"code": "PGRST301", "message": "JWT invalide"}, status_code=401)
        self.lectures.append(dict(requete.query_params))
        if self.prompts_en_panne:
            return JSONResponse({"message": "indisponible"}, status_code=503)
        lisibles = self._lisibles(personne)
        return JSONResponse([l for l in self.lignes if l["workspace_id"] in lisibles])


class Monde:
    def __init__(self, identite: Identite | None = THOMAS) -> None:
        self.simule = CrmPrompts()
        self.crm = ClientCrm("http://kong:8000", CLE_ANONYME, CLE_SERVICE,
                             transport=httpx2.ASGITransport(app=self.simule.application()))
        self.moteur = MoteurPolitique(registre=Registre(self.crm, ()), crm=self.crm, jwt_secret=SECRET,
                                      identite_du_jeton=lambda _j: identite)
        self.mcp = FastMCP("test")
        prompts.ajouter(self.mcp, self.moteur, self.crm)
        self.simule.membres = {"sujet-thomas": {ESPACE_A: "admin"}}
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "affaires", "consulter")}

    async def liste(self) -> dict[str, Any]:
        async with Client(self.mcp) as client:
            return {p.name: p for p in await client.list_prompts()}

    async def obtenir(self, nom: str) -> Any:
        async with Client(self.mcp) as client:
            return await client.get_prompt(nom)


@pytest.fixture
async def monde():
    m = Monde()
    yield m
    await m.crm.fermer()


def test_le_nom_nu_ou_suffixe_et_le_titre() -> None:
    lus = lire_lignes(CrmPrompts().lignes)
    noms = {nom: titre for nom, titre, _ in nommer(lus)}
    assert noms == {
        "faire-le-point__atelier": "Faire le point sur une affaire — Atelier",
        "creer-une-affaire": "Créer une affaire complète",
        "faire-le-point__bureau": "Faire le point sur une affaire — Bureau",
        "propre-au-bureau": "Propre au bureau",
    }


def test_une_ligne_incomplete_est_ecartee() -> None:
    complete = ligne(ESPACE_A, "atelier", "Atelier", "faire-le-point", "T")
    sans_espace = {**complete, "workspace": None}
    titre_vide = {**complete, "title": ""}
    assert [p.cle for p in lire_lignes([complete, sans_espace, titre_vide, "pas une ligne"])] == ["faire-le-point"]


def test_le_message_porte_son_en_tete_d_espace() -> None:
    lu = PromptLu("faire-le-point", "T", "D", "1. Lire.\n2. Résumer.", ESPACE_A, "atelier", "Atelier")
    assert message(lu) == "Espace : Atelier (workspace : atelier)\n\n1. Lire.\n2. Résumer."


async def test_la_liste_sous_la_rls_et_sans_argument(monde: Monde) -> None:
    liste = await monde.liste()
    # Membre de l'Atelier seulement : la RLS ne rend que ses deux prompts, et aucun ne collisionne.
    assert set(liste) == {"faire-le-point", "creer-une-affaire"}
    assert liste["faire-le-point"].title == "Faire le point sur une affaire"
    assert liste["faire-le-point"].description == "Description de faire-le-point."
    assert not liste["faire-le-point"].arguments
    # La lecture est faite sous le JETON INTERNE de Thomas (§5), avec l'espace embarqué.
    assert monde.simule.jetons[-1]["sub"] == "sujet-thomas"
    assert monde.simule.lectures[-1]["select"] == prompts.SELECTION
    # La liste n'écrit rien au journal : seul un `prompts/get` en écrit.
    assert monde.simule.journal == []


async def test_deux_espaces_le_meme_identifiant(monde: Monde) -> None:
    monde.simule.membres["sujet-thomas"][ESPACE_B] = "viewer"
    assert set(await monde.liste()) == {
        "faire-le-point__atelier", "creer-une-affaire", "faire-le-point__bureau", "propre-au-bureau",
    }


async def test_obtenir_rend_le_message_et_journalise(monde: Monde) -> None:
    resultat = await monde.obtenir("faire-le-point")
    assert len(resultat.messages) == 1
    assert resultat.messages[0].role == "user"
    assert resultat.messages[0].content.text == (
        "Espace : Atelier (workspace : atelier)\n\nTexte de faire-le-point.\n2. Deuxième étape."
    )
    assert [(j["p_outil"], j["p_ws"], j["p_issue"]) for j in monde.simule.journal] == [
        ("prompt:faire-le-point", ESPACE_A, "ok")
    ]
    assert monde.simule.journal[0]["p_sub"] == "sujet-thomas"


async def test_un_prompt_hors_de_l_espace_est_inconnu(monde: Monde) -> None:
    with pytest.raises(McpError):
        await monde.obtenir("propre-au-bureau")
    assert monde.simule.journal == []


async def test_sans_droit_la_liste_est_vide(monde: Monde) -> None:
    monde.simule.droits.clear()
    assert await monde.liste() == {}
    assert monde.simule.lectures == []


async def test_sans_identite_la_liste_est_vide() -> None:
    m = Monde(identite=None)
    try:
        assert await m.liste() == {}
        assert m.simule.lectures == []
    finally:
        await m.crm.fermer()


async def test_une_base_injoignable_rend_une_liste_vide(monde: Monde) -> None:
    # Le registre répond ; la table, non : l'assistant garde ses outils, sans prompt.
    monde.simule.prompts_en_panne = True
    assert await monde.liste() == {}
    # La lecture a bien été tentée — le client la reprend une fois, une lecture étant idempotente.
    assert monde.simule.lectures


async def test_la_capacite_prompts_est_annoncee(monde: Monde) -> None:
    async with Client(monde.mcp) as client:
        assert client.server_capabilities is not None
        assert client.server_capabilities.prompts is not None

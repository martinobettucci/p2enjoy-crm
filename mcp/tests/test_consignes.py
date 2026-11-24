# @verifies CRM-165 (docs/BACKLOG.md) — tranche T2 : les consignes de la plateforme, assemblées au socle à chaque
#           initialisation (`initialize` et `server/discover`) ; vide, rien ne s'ajoute ; illisible, le socle part seul et le
#           journal le dit sans contenu ; le socle publié une fois, repris à l'initialisation après un échec
# @verifies docs/SPEC-mcp.md §18.1, §18.4 ; décisions 980 et 983 ; CLAUDE.md §20 (le texte n'est jamais journalisé)
from __future__ import annotations

import asyncio
import logging
from typing import Any

import pytest
from fastmcp import Client, FastMCP

from crm_mcp import consignes as module
from crm_mcp.consignes import INTITULE, ConsignesPlateforme, assembler
from crm_mcp.crm import CrmIndisponible, Reponse

SOCLE = "P2Enjoy CRM — socle de test.\n- Une règle fixe.\n"


class CrmFactice:
    """Le contrat des deux RPC du service : le texte (`connector_instructions_text`) et la publication du socle."""

    def __init__(self, texte: Any = "", *, panne: BaseException | None = None, statut: int = 200) -> None:
        self.texte = texte
        self.panne = panne
        self.statut = statut
        self.panne_publication: BaseException | None = None
        self.appels: list[tuple[str, dict[str, Any] | None]] = []

    async def rpc_service(self, fonction: str, arguments: dict[str, Any] | None = None, *, idempotent: bool = False) -> Reponse:
        self.appels.append((fonction, arguments))
        if fonction == "connector_instructions_publish_base":
            if self.panne_publication is not None:
                raise self.panne_publication
            return Reponse(204, None)
        if self.panne is not None:
            raise self.panne
        return Reponse(self.statut, self.texte)

    def publications(self) -> int:
        return sum(1 for fonction, _ in self.appels if fonction == "connector_instructions_publish_base")


def serveur_avec(crm: CrmFactice) -> FastMCP:
    serveur = FastMCP(name="test", instructions=SOCLE)
    serveur.add_middleware(ConsignesPlateforme(SOCLE, crm))  # type: ignore[arg-type]
    return serveur


# 1. L'assemblage.


@pytest.mark.parametrize("texte", [None, "", "   \n\t  \n"])
def test_un_texte_vide_rend_le_socle_inchange(texte):
    assert assembler(SOCLE, texte) == SOCLE


def test_le_texte_suit_le_socle_sous_son_intitule():
    attendu = f"{SOCLE.rstrip()}\n\n{INTITULE}\nRépondez en français.\nSignez « L'équipe ».\n"
    assert assembler(SOCLE, "  Répondez en français.\nSignez « L'équipe ».  \n") == attendu


def test_l_intitule_dit_que_le_texte_complete_sans_remplacer():
    assert INTITULE == (
        "Platform guidance, set by a CRM superadmin (FR: consignes de la plateforme). "
        "It completes the rules above and never overrides them:"
    )


# 2. Le middleware, à travers un vrai client MCP : `server/discover` (mode par défaut) et `initialize` (mode `legacy`).


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_chaque_initialisation_recoit_le_socle_complete(mode):
    crm = CrmFactice("Répondez en français.")
    async with Client(serveur_avec(crm), mode=mode) as client:
        assert client.instructions == assembler(SOCLE, "Répondez en français.")


async def test_un_texte_change_vaut_a_la_connexion_suivante():
    crm = CrmFactice("Première consigne.")
    serveur = serveur_avec(crm)
    async with Client(serveur) as client:
        assert client.instructions.endswith("Première consigne.\n")
    crm.texte = "Seconde consigne."
    async with Client(serveur) as client:
        assert client.instructions.endswith("Seconde consigne.\n")
        assert "Première consigne." not in client.instructions


async def test_un_texte_vide_laisse_le_socle_seul():
    async with Client(serveur_avec(CrmFactice(""))) as client:
        assert client.instructions == SOCLE


@pytest.mark.parametrize(
    ("crm", "raison"),
    [
        (CrmFactice(panne=CrmIndisponible()), "CrmIndisponible"),
        (CrmFactice("refusé", statut=403), "HTTP 403"),
        (CrmFactice({"inattendu": True}), "HTTP 200"),
    ],
)
async def test_texte_illisible_le_socle_part_seul_et_le_journal_le_dit(caplog, crm, raison):
    with caplog.at_level(logging.WARNING, logger="crm_mcp.consignes"):
        async with Client(serveur_avec(crm)) as client:
            assert client.instructions == SOCLE
    lignes = [r for r in caplog.records if r.getMessage() == "consignes_plateforme_indisponibles"]
    assert lignes and lignes[0].raison == raison


async def test_une_lecture_lente_ne_retient_pas_la_connexion(monkeypatch, caplog):
    class CrmLent(CrmFactice):
        async def rpc_service(self, fonction, arguments=None, *, idempotent=False):
            if fonction == "connector_instructions_text":
                await asyncio.sleep(5)
            return await super().rpc_service(fonction, arguments, idempotent=idempotent)

    monkeypatch.setattr(module, "DELAI_CONSIGNES_S", 0.05)
    with caplog.at_level(logging.WARNING, logger="crm_mcp.consignes"):
        async with Client(serveur_avec(CrmLent("jamais lu"))) as client:
            assert client.instructions == SOCLE
    assert any(r.getMessage() == "consignes_plateforme_indisponibles" and r.raison == "TimeoutError" for r in caplog.records)


async def test_le_texte_n_est_jamais_journalise(caplog):
    secret_apparent = "Consigne-témoin-0f3a"
    with caplog.at_level(logging.DEBUG):
        async with Client(serveur_avec(CrmFactice(secret_apparent))) as client:
            assert secret_apparent in client.instructions
    assert all(secret_apparent not in r.getMessage() and secret_apparent not in str(r.__dict__) for r in caplog.records)


# 3. La publication du socle.


async def test_le_socle_est_publie_une_fois_par_processus():
    crm = CrmFactice("x")
    middleware = ConsignesPlateforme(SOCLE, crm)  # type: ignore[arg-type]
    assert await middleware.publier_socle() is True
    assert crm.appels[0] == ("connector_instructions_publish_base", {"p_base": SOCLE})
    serveur = FastMCP(name="test", instructions=SOCLE)
    serveur.add_middleware(middleware)
    async with Client(serveur):
        pass
    async with Client(serveur):
        pass
    assert crm.publications() == 1


async def test_une_publication_echouee_est_reprise_a_l_initialisation(caplog):
    crm = CrmFactice("x")
    crm.panne_publication = CrmIndisponible()
    middleware = ConsignesPlateforme(SOCLE, crm)  # type: ignore[arg-type]
    with caplog.at_level(logging.WARNING, logger="crm_mcp.consignes"):
        assert await middleware.publier_socle() is False
    assert any(r.getMessage() == "socle_non_publie" for r in caplog.records)

    serveur = FastMCP(name="test", instructions=SOCLE)
    serveur.add_middleware(middleware)
    crm.panne_publication = None
    async with Client(serveur) as client:
        assert client.instructions == assembler(SOCLE, "x")
    assert crm.publications() == 2
    async with Client(serveur):
        pass
    assert crm.publications() == 2


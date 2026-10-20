# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : preuves unitaires du client du CRM
# @verifies CRM-102 T2 — docs/SPEC-mcp.md §2.1 (délais et reprises : une seule, pour un appel idempotent ; une écriture
#           n'est jamais rejouée), §5 (deux identités jamais mêlées : le jeton de la personne avec la clé anonyme, la
#           clé de service pour le seul registre), §11 (aucune adresse interne journalisée)
from __future__ import annotations

import httpx2
import pytest

from crm_mcp.crm import ClientCrm, CrmIndisponible


class Rejoue:
    """Un transport qui échoue `echecs` fois, puis répond ; il garde les requêtes reçues."""

    def __init__(self, echecs: int, reponse: httpx2.Response | None = None) -> None:
        self.echecs = echecs
        self.reponse = reponse or httpx2.Response(200, json=[{"id": 1}])
        self.requetes: list[httpx2.Request] = []

    def __call__(self, requete: httpx2.Request) -> httpx2.Response:
        self.requetes.append(requete)
        if len(self.requetes) <= self.echecs:
            raise httpx2.ConnectError("connexion refusée à http://10.0.0.7:8000", request=requete)
        return self.reponse


def _client(transport: Rejoue) -> ClientCrm:
    return ClientCrm("http://kong:8000", "cle-anonyme", "cle-service", transport=httpx2.MockTransport(transport))


async def test_lecture_reprise_une_fois():
    rejoue = Rejoue(echecs=1)
    reponse = await _client(rejoue).lire("jeton-personne", "workspaces", {"select": "id"})
    assert (reponse.statut, reponse.corps, len(rejoue.requetes)) == (200, [{"id": 1}], 2)


async def test_lecture_abandonnee_apres_la_reprise(caplog):
    rejoue = Rejoue(echecs=5)
    with caplog.at_level("WARNING", logger="crm_mcp.crm"), pytest.raises(CrmIndisponible):
        await _client(rejoue).lire("jeton-personne", "workspaces", {})
    assert len(rejoue.requetes) == 2
    assert [r.tentative for r in caplog.records] == [1, 2]
    assert "10.0.0.7" not in caplog.text, "le message de transport, qui porte une adresse interne, n'est pas journalisé"


async def test_ecriture_jamais_rejouee():
    rejoue = Rejoue(echecs=1)
    with pytest.raises(CrmIndisponible):
        await _client(rejoue).rpc("jeton-personne", "creer_affaire", {"p_titre": "x"})
    assert len(rejoue.requetes) == 1
    with pytest.raises(CrmIndisponible):
        await _client(Rejoue(echecs=1)).rpc_service("mcp_journaliser", {})


async def test_rpc_declaree_idempotente_reprise():
    rejoue = Rejoue(echecs=1, reponse=httpx2.Response(200, json=True))
    assert (await _client(rejoue).rpc("jeton", "mcp_autorise", {}, idempotent=True)).corps is True
    assert len(rejoue.requetes) == 2


async def test_deux_identites_jamais_melees():
    rejoue = Rejoue(echecs=0)
    client = _client(rejoue)
    await client.lire("jeton-personne", "cards", {"id": "eq.x"})
    await client.rpc_service("mcp_etat_compte", {"p_sub": "s"})
    personne, service = rejoue.requetes
    assert (personne.headers["apikey"], personne.headers["authorization"]) == ("cle-anonyme", "Bearer jeton-personne")
    assert (service.headers["apikey"], service.headers["authorization"]) == ("cle-service", "Bearer cle-service")
    assert str(personne.url) == "http://kong:8000/rest/v1/cards?id=eq.x"
    assert str(service.url) == "http://kong:8000/rest/v1/rpc/mcp_etat_compte"


async def test_corps_vide_ou_illisible():
    vide = await _client(Rejoue(0, httpx2.Response(204))).rpc_service("mcp_journaliser", {})
    assert (vide.statut, vide.corps, vide.reussie) == (204, None, True)
    texte = await _client(Rejoue(0, httpx2.Response(502, text="<html>Bad gateway</html>"))).lire("j", "cards", {})
    assert (texte.corps, texte.reussie, texte.message) == ("<html>Bad gateway</html>", False, None)
    refus = await _client(Rejoue(0, httpx2.Response(400, json={"message": "transition_not_allowed"}))).rpc("j", "f")
    assert refus.message == "transition_not_allowed"


async def test_sonde_sur_le_catalogue_des_noeuds():
    rejoue = Rejoue(echecs=0, reponse=httpx2.Response(200, json=[]))
    assert await _client(rejoue).sonder() == 200
    [requete] = rejoue.requetes
    assert str(requete.url) == "http://kong:8000/rest/v1/workflow_nodes_catalog?limit=0"
    assert requete.headers["apikey"] == "cle-anonyme"

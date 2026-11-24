# @verifies CRM-164 (docs/BACKLOG.md) — le journal des erreurs de protocole : un `-32603` dans un corps JSON et dans un événement
#           SSE, une session inconnue, un `invalid_grant` de `/token`, une exception non rattrapée, chacun journalisé avec ses
#           champs ; jamais le message d'erreur, un argument ni un jeton ; une réponse sans erreur n'écrit rien ; un `401` sans
#           jeton au niveau `info` (docs/SPEC-mcp.md §11 ; décisions 978 et 979 ; CLAUDE.md §20)
from __future__ import annotations

import json
import logging

import pytest

from crm_mcp.journal_protocole import JournalProtocole, codes_jsonrpc, demande

SECRET = "jeton-secret-ne-pas-journaliser"
APPEL = json.dumps(
    {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "crm_organization_list", "arguments": {"q": SECRET}}}
).encode()


def _application(statut: int, corps: bytes, type_contenu: str = "application/json", *, morceaux: int = 1, leve: bool = False):
    async def application(scope, receive, send):
        while (await receive()).get("more_body"):
            pass
        if leve:
            raise RuntimeError(f"panne qui cite {SECRET}")
        await send({"type": "http.response.start", "status": statut, "headers": [(b"content-type", type_contenu.encode())]})
        taille = max(1, len(corps) // morceaux)
        for debut in range(0, len(corps), taille):
            fin = debut + taille
            await send({"type": "http.response.body", "body": corps[debut:fin], "more_body": fin < len(corps)})

    return application


async def _jouer(application, chemin: str = "/mcp", corps: bytes = APPEL, methode: str = "POST") -> None:
    envoyes = []
    recu = {"fait": False}

    async def receive():
        if recu["fait"]:
            return {"type": "http.disconnect"}
        recu["fait"] = True
        return {"type": "http.request", "body": corps, "more_body": False}

    async def send(message):
        envoyes.append(message)

    await JournalProtocole(application)({"type": "http", "path": chemin, "method": methode}, receive, send)
    return envoyes


def _lignes(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "crm_mcp.protocole"]


def _sans_secret(caplog) -> None:
    for ligne in _lignes(caplog):
        assert SECRET not in json.dumps(ligne.__dict__, default=str)


async def test_un_32603_dans_un_corps_json_est_journalise_avec_l_outil_et_sans_message(caplog):
    caplog.set_level(logging.INFO)
    erreur = json.dumps({"jsonrpc": "2.0", "id": 7, "error": {"code": -32603, "message": f"Internal error: {SECRET}"}}).encode()
    envoyes = await _jouer(_application(200, erreur))
    [ligne] = _lignes(caplog)
    assert ligne.getMessage() == "protocole_erreur" and ligne.levelno == logging.WARNING
    assert (ligne.code, ligne.statut, ligne.methode, ligne.outil, ligne.octets) == (
        -32603, 200, "tools/call", "crm_organization_list", len(erreur))
    assert isinstance(ligne.duree_ms, int)
    assert b"".join(m.get("body", b"") for m in envoyes) == erreur, "l'enveloppe ne change rien à la réponse"
    _sans_secret(caplog)


async def test_un_32603_dans_un_evenement_sse_en_plusieurs_morceaux(caplog):
    caplog.set_level(logging.INFO)
    evenement = (
        b"event: message\ndata: "
        + json.dumps({"jsonrpc": "2.0", "id": 7, "error": {"code": -32603, "message": SECRET}}).encode()
        + b"\n\n"
    )
    await _jouer(_application(200, evenement, "text/event-stream", morceaux=3))
    [ligne] = _lignes(caplog)
    assert (ligne.code, ligne.outil) == (-32603, "crm_organization_list")
    _sans_secret(caplog)


async def test_une_session_inconnue(caplog):
    caplog.set_level(logging.INFO)
    corps = json.dumps({"jsonrpc": "2.0", "id": "server-error", "error": {"code": -32600, "message": "Session not found"}}).encode()
    await _jouer(_application(404, corps))
    [ligne] = _lignes(caplog)
    assert (ligne.statut, ligne.code, ligne.levelno) == (404, -32600, logging.WARNING)


async def test_un_invalid_grant_de_token_dit_son_code_et_jamais_le_jeton(caplog):
    caplog.set_level(logging.INFO)
    corps = json.dumps({"error": "invalid_grant", "error_description": f"refresh token {SECRET} does not exist"}).encode()
    await _jouer(_application(401, corps), chemin="/token", corps=f"grant_type=refresh_token&refresh_token={SECRET}".encode())
    [ligne] = _lignes(caplog)
    assert (ligne.chemin, ligne.statut, ligne.erreur_oauth, ligne.levelno) == ("/token", 401, "invalid_grant", logging.WARNING)
    assert not hasattr(ligne, "methode") and not hasattr(ligne, "outil")
    _sans_secret(caplog)


async def test_une_exception_non_rattrapee_est_journalisee_puis_relevee(caplog):
    caplog.set_level(logging.INFO)
    with pytest.raises(RuntimeError):
        await _jouer(_application(200, b"", leve=True))
    [ligne] = _lignes(caplog)
    assert (ligne.getMessage(), ligne.levelno, ligne.type, ligne.outil) == (
        "protocole_exception", logging.ERROR, "RuntimeError", "crm_organization_list")
    _sans_secret(caplog)


async def test_un_401_sans_jeton_est_ecrit_en_info(caplog):
    caplog.set_level(logging.INFO)
    await _jouer(_application(401, b'{"error":"invalid_token"}'))
    [ligne] = _lignes(caplog)
    assert (ligne.statut, ligne.levelno) == (401, logging.INFO)


@pytest.mark.parametrize(
    ("chemin", "statut", "corps"),
    [
        ("/mcp", 200, json.dumps({"jsonrpc": "2.0", "id": 7, "result": {"content": []}}).encode()),
        ("/token", 200, b'{"access_token":"x"}'),
        ("/sante", 500, b"panne"),  # hors du protocole : ni /mcp ni un point OAuth
    ],
)
async def test_rien_n_est_ecrit_sans_erreur_de_protocole(caplog, chemin, statut, corps):
    caplog.set_level(logging.INFO)
    await _jouer(_application(statut, corps), chemin=chemin)
    assert _lignes(caplog) == []


def test_un_nom_libre_venu_d_un_client_n_est_jamais_repris():
    appel = json.dumps({"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "nom avec espaces et un e-mail@x"}}).encode()
    assert demande(appel) == ("tools/call", None)
    assert demande(b"pas du json") == (None, None)
    assert codes_jsonrpc(b'[{"error":{"code":-32601}},{"result":1}]', "application/json") == [-32601]
    assert codes_jsonrpc(b'{"error":{"code":true}}', "application/json") == []

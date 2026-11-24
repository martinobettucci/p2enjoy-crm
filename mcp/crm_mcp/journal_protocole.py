# @spec CRM-164 (docs/BACKLOG.md) — le journal des erreurs de protocole : une enveloppe ASGI autour de toute l'application,
#       garde d'entrée comprise, qui écrit une ligne pour chaque réponse en erreur sur `/mcp` et sur les points OAuth — statut
#       HTTP de 400 ou plus, `error` JSON-RPC dans un corps JSON ou un événement SSE, exception non rattrapée — avec la
#       méthode, l'outil, le code, la durée et la taille, jamais le message, un argument, un résultat, un jeton ni une adresse
#       (docs/SPEC-mcp.md §11 ; décisions 978 et 979 ; CLAUDE.md §20)
"""Journal des erreurs de protocole du connecteur.

Le `-32603` rendu à Claude le 2026-11-24 n'avait laissé aucune trace : l'audit (``audit.py``) n'écrit qu'une ligne par appel
d'outil, et une erreur produite avant l'outil, après lui ou par le transport n'en a pas. Cette enveloppe lit ce qui sort : le
statut, et le corps jusqu'à ``LIMITE_ANALYSE`` octets, pour en tirer des **codes** et des **noms**, jamais des textes.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Iterable
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from crm_mcp.garde import POINTS_OAUTH

journal = logging.getLogger("crm_mcp.protocole")

#: Au-delà, le corps n'est plus lu, seulement compté (docs/SPEC-mcp.md §11).
LIMITE_ANALYSE = 1024 * 1024
#: Les noms qu'une ligne peut porter : ceux du protocole et du catalogue, jamais un texte libre venu d'un client.
_NOM = re.compile(r"^[A-Za-z0-9_/.\-]{1,64}$")


def suivi(chemin: str) -> bool:
    """`/mcp` et les points OAuth (§3.5) : les seuls chemins où une erreur est une erreur de protocole."""
    return chemin == "/mcp" or chemin.startswith("/mcp/") or chemin in POINTS_OAUTH


def _nom(valeur: Any) -> str | None:
    return valeur if isinstance(valeur, str) and _NOM.match(valeur) else None


def _json(octets: bytes) -> Any:
    try:
        return json.loads(octets)
    except (ValueError, UnicodeDecodeError):
        return None


def demande(corps: bytes) -> tuple[str | None, str | None]:
    """La méthode JSON-RPC demandée et, pour un ``tools/call``, le nom de l'outil ; le premier message d'un lot."""
    message = _json(corps)
    if isinstance(message, list):
        message = message[0] if message else None
    if not isinstance(message, dict):
        return None, None
    methode = _nom(message.get("method"))
    parametres = message.get("params")
    outil = _nom(parametres.get("name")) if methode == "tools/call" and isinstance(parametres, dict) else None
    return methode, outil


def _messages(corps: bytes, type_contenu: str) -> Iterable[Any]:
    """Les messages JSON d'un corps : le corps entier, ou chaque ligne ``data:`` d'un flux SSE."""
    if "text/event-stream" in type_contenu:
        for ligne in corps.split(b"\n"):
            if ligne.startswith(b"data:"):
                yield _json(ligne[5:].strip())
        return
    message = _json(corps)
    if isinstance(message, list):
        yield from message
    else:
        yield message


def codes_jsonrpc(corps: bytes, type_contenu: str) -> list[int]:
    """Les codes des réponses JSON-RPC en erreur — le code seul, jamais le message ni les données."""
    codes: list[int] = []
    for message in _messages(corps, type_contenu):
        erreur = message.get("error") if isinstance(message, dict) else None
        code = erreur.get("code") if isinstance(erreur, dict) else None
        if isinstance(code, int) and not isinstance(code, bool):
            codes.append(code)
    return codes


def erreur_oauth(corps: bytes) -> str | None:
    """Le champ ``error`` d'une réponse OAuth (``invalid_grant``…) — jamais sa description."""
    message = _json(corps)
    return _nom(message.get("error")) if isinstance(message, dict) else None


class JournalProtocole:
    """L'enveloppe : elle ne change rien à la réponse, elle la lit en passant."""

    def __init__(self, app: ASGIApp, *, horloge=time.perf_counter) -> None:
        self.app = app
        self.horloge = horloge

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not suivi(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        debut = self.horloge()
        requete = bytearray()
        reponse = bytearray()
        etat: dict[str, Any] = {"statut": None, "type": "", "octets": 0, "conclu": False}

        async def recevoir() -> Message:
            message = await receive()
            if message["type"] == "http.request" and len(requete) < LIMITE_ANALYSE:
                requete.extend(message.get("body", b"")[: LIMITE_ANALYSE - len(requete)])
            return message

        async def envoyer(message: Message) -> None:
            if message["type"] == "http.response.start":
                etat["statut"] = message["status"]
                for cle, valeur in message.get("headers", []):
                    if cle.lower() == b"content-type":
                        etat["type"] = valeur.decode("latin-1").lower()
            elif message["type"] == "http.response.body":
                corps = message.get("body", b"")
                etat["octets"] += len(corps)
                if len(reponse) < LIMITE_ANALYSE:
                    reponse.extend(corps[: LIMITE_ANALYSE - len(reponse)])
                if not message.get("more_body", False):
                    self._conclure(scope, etat, bytes(requete), bytes(reponse), debut)
            await send(message)

        try:
            await self.app(scope, recevoir, envoyer)
        except Exception as erreur:
            etat["conclu"] = True
            methode, outil = demande(bytes(requete))
            journal.error(
                "protocole_exception",
                extra={
                    "chemin": scope.get("path"),
                    "methode_http": scope.get("method"),
                    "methode": methode,
                    "outil": outil,
                    "type": type(erreur).__name__,
                    "duree_ms": round((self.horloge() - debut) * 1000),
                },
            )
            raise
        finally:
            # Un flux fermé sans dernier morceau (client parti) est conclu sur ce qu'il a rendu.
            if not etat["conclu"] and etat["statut"] is not None:
                self._conclure(scope, etat, bytes(requete), bytes(reponse), debut)

    def _conclure(self, scope: Scope, etat: dict[str, Any], requete: bytes, reponse: bytes, debut: float) -> None:
        if etat["conclu"]:
            return
        etat["conclu"] = True
        statut = etat["statut"] or 0
        chemin = scope.get("path", "")
        codes = codes_jsonrpc(reponse, etat["type"]) if chemin.startswith("/mcp") else []
        if statut < 400 and not codes:
            return
        methode, outil = demande(requete) if chemin.startswith("/mcp") else (None, None)
        champs = {
            "chemin": chemin,
            "methode_http": scope.get("method"),
            "statut": statut,
            "methode": methode,
            "outil": outil,
            "code": codes[0] if codes else None,
            "erreur_oauth": erreur_oauth(reponse) if chemin in POINTS_OAUTH and statut >= 400 else None,
            "duree_ms": round((self.horloge() - debut) * 1000),
            "octets": etat["octets"],
        }
        # Un `401` sans jeton sur `/mcp` est la première étape de toute connexion (§3.1) : écrit, mais pas en avertissement.
        niveau = logging.INFO if statut == 401 and chemin.startswith("/mcp") and not codes else logging.WARNING
        journal.log(niveau, "protocole_erreur", extra={k: v for k, v in champs.items() if v is not None})

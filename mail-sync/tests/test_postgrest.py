# @verifies CRM-059 (docs/BACKLOG.md) — boucle de veille, source réelle des comptes à relever
# @verifies docs/SPEC-mail-subsystem.md §20.10.6 (quels comptes, dans quel ordre)
# @verifies docs/JOURNAL.md décision 348 bis (nom réel de la colonne, mesuré contre la vraie base)
#
# CE FICHIER N'EXISTAIT PAS : `test_veille.py` alimente `executer_un_tour` par un double de
# `SourceComptes` qui n'appelle jamais `PostgrestClient` — la DÉCISION de la veille est éprouvée,
# sa SOURCE réelle ne l'était par aucun test. `PostgrestClient.lire_comptes_a_veiller()` a donc pu
# interroger une colonne qui n'existe dans aucune migration (`password_secret_id`, au lieu de
# `secret_id` — migration `0024`) sans qu'aucune suite ne rougisse : la panne n'était visible qu'en
# exécutant la boucle contre la vraie base, ce qu'aucune session précédente n'avait fait
# (docs/JOURNAL.md décision 343). Ce fichier ferme cet angle mort en interceptant l'appel HTTP
# réel, sans dépendre d'un serveur.

from __future__ import annotations

import json
from typing import Any
from urllib.request import Request

import pytest

from mail_sync.postgrest import PostgrestClient


class FausseReponse:
    def __init__(self, corps: bytes, status: int = 200) -> None:
        self._corps = corps
        self.status = status

    def read(self) -> bytes:
        return self._corps

    def __enter__(self) -> "FausseReponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def _client() -> PostgrestClient:
    return PostgrestClient(base_url="http://kong-de-preuve:8000", service_role_key="cle-de-preuve")


def test_lire_comptes_a_veiller_interroge_la_vraie_colonne_secret_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LA COLONNE EST `secret_id`, JAMAIS `password_secret_id` — mesuré contre `supabase/migrations/
    0024_ingestion_messages.sql`, qui ne déclare que la première. Une requête vers la seconde reçoit
    `42703` de PostgREST à chaque tour, et c'est exactement le défaut trouvé et corrigé ici."""

    requetes: list[Request] = []

    def faux_urlopen(requete: Request, timeout: float) -> FausseReponse:  # noqa: ARG001
        requetes.append(requete)
        return FausseReponse(b"[]")

    monkeypatch.setattr("mail_sync.postgrest.urllib.request.urlopen", faux_urlopen)

    _client().lire_comptes_a_veiller()

    assert len(requetes) == 1
    url = requetes[0].full_url
    assert "select=id,last_sync_at,secret_id" in url
    assert "password_secret_id" not in url
    assert "order=last_sync_at.asc.nullsfirst" in url


def test_lire_comptes_a_veiller_traduit_la_presence_du_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    corps: list[dict[str, Any]] = [
        {"id": "c1", "last_sync_at": None, "secret_id": "un-identifiant-de-secret"},
        {"id": "c2", "last_sync_at": "2026-08-11T08:00:00Z", "secret_id": None},
    ]

    def faux_urlopen(requete: Request, timeout: float) -> FausseReponse:  # noqa: ARG001
        return FausseReponse(json.dumps(corps).encode("utf-8"))

    monkeypatch.setattr("mail_sync.postgrest.urllib.request.urlopen", faux_urlopen)

    comptes = _client().lire_comptes_a_veiller()

    assert [c.identifiant for c in comptes] == ["c1", "c2"]
    assert [c.secret_present for c in comptes] == [True, False]

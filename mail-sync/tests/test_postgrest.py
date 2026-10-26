# @verifies CRM-059 (docs/BACKLOG.md) — boucle de veille, source réelle des comptes à relever
# @verifies docs/SPEC-mail-subsystem.md §20.10.6 (quels comptes, dans quel ordre)
# @verifies docs/JOURNAL.md décision 348 bis (nom réel de la colonne, mesuré contre la vraie base)
# @verifies CRM-111 T2.4.2 (docs/BACKLOG.md) — le channel d'une card se lit sur son plus ancien rattachement (docs/SPEC-rattachements.md §7)
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


# =================================================================================================
# La charge d'insertion d'un message reçu — docs/SPEC-cards.md §16.16.2
# =================================================================================================
#
# @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 f, préalable mesuré du groupement
# @verifies docs/SPEC-cards.md §16.16.2 (la chaîne `References` est persistée à l'ingestion),
#           §16.16.1 mesures 3 à 5 ; docs/SPEC-mail-subsystem.md §19.3 (la colonne et son rôle)
#
# CE QUE CES DEUX TESTS ÉPROUVENT, ET QU'AUCUNE AUTRE PREUVE N'ÉPROUVAIT : la charge envoyée à
# PostgREST, et non le résultat visible d'une ingestion. Le défaut du §16.16.2 était INVISIBLE à
# toute assertion portant sur le message ingéré — la colonne existe, elle est `not null default
# '{}'`, donc l'insertion réussissait et rendait une ligne parfaitement valide. Seul le CONTENU de
# la charge dit si la chaîne de références a été transmise ou silencieusement perdue.


class _AnalyseDePreuve:
    """Le strict nécessaire de `MessageAnalyse` pour composer une charge d'insertion."""

    def __init__(self, references: list[str]) -> None:
        self.rfc822_message_id = "<reponse@client.test>"
        self.from_address = "solene@client.test"
        self.from_name = "Solène Ferrand"
        self.to_addresses = ["c-abc@crm.p2enjoy.test"]
        self.cc_addresses: list[str] = []
        self.subject = "Re: Demande de devis"
        self.body_text = "Merci."
        self.body_html = None
        self.sent_at = None
        self.references = references


def _charge_insertion(
    monkeypatch: pytest.MonkeyPatch, references: list[str]
) -> dict[str, Any]:
    charges: list[dict[str, Any]] = []

    def faux_urlopen(requete: Request, timeout: float) -> FausseReponse:  # noqa: ARG001
        donnees = requete.data
        if donnees:
            charges.append(json.loads(donnees.decode()))
        return FausseReponse(b'[{"id":"11111111-1111-4111-8111-111111111111"}]')

    monkeypatch.setattr("mail_sync.postgrest.urllib.request.urlopen", faux_urlopen)
    _client().enregistrer_message(
        workspace_id="5eed0000-0000-4000-8000-000000000001",
        analyse=_AnalyseDePreuve(references),
    )
    assert len(charges) == 1
    return charges[0]


def test_enregistrer_message_persiste_la_chaine_de_references(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SANS CETTE COLONNE DANS LA CHARGE, AUCUN FIL NE SE FORME À PARTIR DE COURRIER REÇU.

    Mesuré le 2026-08-19 (§16.16.1, mesures 3 et 4) : un message portant
    `References: <parent>` était ingéré avec `references_ids` = `[]`, et `app.cle_fil` rendait
    alors son `Message-ID` PROPRE — donc deux fils là où il n'y en avait qu'un.
    """

    charge = _charge_insertion(monkeypatch, ["<racine@client.test>", "<milieu@client.test>"])

    # L'ORDRE EST CELUI DE L'EN-TÊTE, et il compte : `app.cle_fil` prend le PREMIER élément
    # (§16.14.2). Le renverser rattacherait la réponse à son parent immédiat plutôt qu'à la
    # racine du fil, et le fil se couperait au deuxième aller-retour.
    assert charge["references_ids"] == ["<racine@client.test>", "<milieu@client.test>"]


def test_enregistrer_message_envoie_un_tableau_VIDE_et_jamais_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Un message sans `References` porte `[]`, jamais `null`.

    LA DISTINCTION N'EST PAS COSMÉTIQUE : la colonne est `not null`, et un `null` explicite serait
    refusé par la base alors que le défaut par défaut est précisément `'{}'`. C'est aussi la forme
    que la mesure A du §16.15.1 a relevée sur les messages du seed, et sur laquelle `cleFil` au
    client comme `coalesce` au serveur s'accordent.
    """

    charge = _charge_insertion(monkeypatch, [])

    assert charge["references_ids"] == []
    assert charge["references_ids"] is not None


def test_parents_de_card_lit_le_channel_du_plus_ancien_rattachement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`CRM-111` T2.4.2 : le channel d'une card n'est plus une colonne de `cards` ; il se lit sur son plus ancien
    rattachement, ordonné par création puis identifiant, comme `app.card_first_placement`."""

    requetes: list[Request] = []

    def faux_urlopen(requete: Request, timeout: float) -> FausseReponse:  # noqa: ARG001
        requetes.append(requete)
        url = requete.full_url
        if "/rest/v1/card_placements" in url:
            return FausseReponse(json.dumps([{"channel_id": "ch-1"}]).encode())
        if "/rest/v1/channels" in url:
            return FausseReponse(json.dumps([{"track_id": "tr-1"}]).encode())
        return FausseReponse(json.dumps("CRM/Conseil").encode())

    monkeypatch.setattr("mail_sync.postgrest.urllib.request.urlopen", faux_urlopen)

    parents = _client().parents_de_card("card-1")

    url = requetes[0].full_url
    assert "/rest/v1/card_placements?card_id=eq.card-1" in url
    assert "select=channel_id" in url and "order=created_at.asc,id.asc" in url and "limit=1" in url
    assert not any("/rest/v1/cards" in r.full_url for r in requetes)
    assert [(p["entity_type"], p["entity_id"]) for p in parents] == [("track", "tr-1"), ("channel", "ch-1")]


def test_parents_de_card_sans_rattachement_lisible_ne_rend_rien(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "mail_sync.postgrest.urllib.request.urlopen", lambda requete, timeout: FausseReponse(b"[]")  # noqa: ARG005
    )
    assert _client().parents_de_card("card-1") == []

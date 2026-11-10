# @verifies CRM-135 (docs/BACKLOG.md) — la veille dit pourquoi elle échoue, l'écrit, espace les refus d'authentification
#           et ignore une boîte désactivée
# @verifies docs/SPEC-mail-subsystem.md §24.2 (le journal, ses champs sûrs), §24.3 (le classement et l'écriture de
#           l'échec), §24.4 (l'espacement), §24.5 (`disabled`), §24.7 (preuves pytest) ; docs/DAT.md §14 ; INC-349 ;
#           docs/JOURNAL.md décisions 873 et 874
#
# Aucune base, aucun serveur IMAP : la décision est pure (§20.10.2) et l'horloge est avancée, jamais attendue. L'écriture
# réelle en base est prouvée par pgTAP (`supabase/tests/0159_releve_echec_ecrit.test.sql`) et par l'intégration contre
# la pile (`e2e/mail/releve-echec-ecrite.spec.ts`, joué par `scripts/verify-mail-inbound.sh` §4 bis).

from __future__ import annotations

import io
import json
import logging
import socket
import ssl

import pytest
from imapclient.exceptions import IMAPClientError, LoginError

from mail_sync import ingestion
from mail_sync.ingestion import classer_echec_releve
from mail_sync.postgrest import InboundCredentials, PostgrestClient, PostgrestError
from mail_sync.structured_logging import JsonFormatter, log_event
from mail_sync.veille import (
    CompteAVeiller,
    RegistreEspacements,
    delai_apres_refus,
    executer_un_tour,
    ordonner_comptes,
)

IDENTIFIANT_DE_CONNEXION = "contact@boite.exemple"
MOT_DE_PASSE = "mot-de-passe-tres-secret"
HOTE = "imap.boite.exemple"


# --- Le journal (§24.2) ------------------------------------------------------------------------


class JournalCapture:
    """Le vrai chemin d'une ligne : `log_event`, puis le formateur JSON du service, dans un tampon."""

    def __init__(self) -> None:
        self.tampon = io.StringIO()
        gestionnaire = logging.StreamHandler(self.tampon)
        gestionnaire.setFormatter(JsonFormatter())
        self.logger = logging.getLogger(f"mail-sync-test-{id(self)}")
        self.logger.handlers = [gestionnaire]
        self.logger.propagate = False
        self.logger.setLevel(logging.DEBUG)

    def __call__(self, evenement: str, **details: object) -> None:
        log_event(self.logger, logging.WARNING, evenement, **details)

    def lignes(self) -> list[dict]:
        return [json.loads(ligne) for ligne in self.tampon.getvalue().splitlines()]

    def brut(self) -> str:
        return self.tampon.getvalue()


class Source:
    def __init__(self, comptes: list[CompteAVeiller]) -> None:
        self.comptes = comptes

    def lire_comptes_a_veiller(self):
        return list(self.comptes)


def compte(identifiant: str = "acc-1", statut: str = "ok", secret: bool = True) -> CompteAVeiller:
    return CompteAVeiller(identifiant=identifiant, derniere_releve=None, secret_present=secret, statut=statut)


def refus_login(_compte: CompteAVeiller) -> None:
    # Un serveur bavard recopie l'identifiant de connexion dans son refus : le texte NE DOIT sortir nulle part.
    raise LoginError(f"[AUTHENTICATIONFAILED] Authentication failed for {IDENTIFIANT_DE_CONNEXION}")


def test_une_ligne_d_echec_porte_le_compte_le_motif_et_le_code() -> None:
    journal = JournalCapture()
    resultat = executer_un_tour(
        source=Source([compte()]), relever=refus_login, journal=journal, classer=classer_echec_releve
    )

    assert resultat.echecs == 1
    [ligne] = journal.lignes()
    assert ligne["event"] == "veille_compte_echoue"
    assert ligne["account_id"] == "acc-1"
    assert ligne["panne"] == "LoginError"
    assert ligne["error"] == "auth_failed"
    assert ligne["refus_consecutifs"] == 1
    assert ligne["retry_in_seconds"] == 300


def test_le_texte_d_un_refus_qui_recopie_l_identifiant_ne_sort_jamais() -> None:
    journal = JournalCapture()
    executer_un_tour(source=Source([compte()]), relever=refus_login, journal=journal, classer=classer_echec_releve)
    assert IDENTIFIANT_DE_CONNEXION not in journal.brut()
    assert "AUTHENTICATIONFAILED" not in journal.brut()


def test_un_champ_hors_liste_n_est_jamais_emis() -> None:
    # La garde du formateur reste : passer l'hôte, l'identifiant ou le mot de passe ne les fait pas sortir.
    journal = JournalCapture()
    journal(
        "veille_compte_echoue",
        account_id="acc-1",
        host=HOTE,
        username=IDENTIFIANT_DE_CONNEXION,
        password=MOT_DE_PASSE,
        detail=f"Login failed for {IDENTIFIANT_DE_CONNEXION}",
    )
    brut = journal.brut()
    for interdit in (HOTE, IDENTIFIANT_DE_CONNEXION, MOT_DE_PASSE):
        assert interdit not in brut
    assert journal.lignes()[0]["account_id"] == "acc-1"


def test_les_compteurs_du_tour_sortent_au_journal() -> None:
    journal = JournalCapture()
    journal("veille_tour_termine", releves=2, echecs=1, ignores=3, espaces=4)
    ligne = journal.lignes()[0]
    assert (ligne["releves"], ligne["echecs"], ligne["ignores"], ligne["espaces"]) == (2, 1, 3, 4)


def test_une_base_injoignable_dit_son_statut_postgrest_et_n_a_pas_de_code() -> None:
    journal = JournalCapture()

    def base_en_panne(_compte):
        raise PostgrestError(503)

    executer_un_tour(source=Source([compte()]), relever=base_en_panne, journal=journal, classer=classer_echec_releve)
    [ligne] = journal.lignes()
    assert ligne["panne"] == "PostgrestError"
    assert ligne["postgrest_status"] == 503
    assert "error" not in ligne


def test_une_source_indisponible_dit_son_statut_postgrest() -> None:
    class SourceEnPanne:
        def lire_comptes_a_veiller(self):
            raise PostgrestError(0)

    journal = JournalCapture()
    executer_un_tour(source=SourceEnPanne(), relever=refus_login, journal=journal)
    [ligne] = journal.lignes()
    assert ligne["event"] == "veille_source_indisponible"
    assert ligne["postgrest_status"] == 0


# --- Le classement (§24.3) ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("erreur", "attendu"),
    [
        (LoginError("[AUTHENTICATIONFAILED] for someone"), "auth_failed"),
        (ssl.SSLError("certificate verify failed"), "tls_failed"),
        (socket.timeout("timed out"), "timeout"),
        (socket.gaierror("Name or service not known"), "host_unreachable"),
        (ConnectionRefusedError("refused"), "connection_refused"),
        (IMAPClientError("BAD unexpected"), "protocol_error"),
        (PostgrestError(503), None),
        (PostgrestError(0), None),
        (KeyError("uid"), None),
        (ValueError("défaut du service"), None),
    ],
)
def test_le_classement_ne_nomme_que_les_pannes_de_la_boite(erreur, attendu) -> None:
    assert classer_echec_releve(erreur) == attendu


# --- L'écriture de l'échec dans `relever_compte` (§24.3) ---------------------------------------

COMPTE = InboundCredentials(
    account_id="acc-1",
    workspace_id="ws-1",
    host=HOTE,
    port=993,
    security="ssl",
    username=IDENTIFIANT_DE_CONNEXION,
    password=MOT_DE_PASSE,
)


class BaseFactice:
    def __init__(self, echec_ecriture: BaseException | None = None) -> None:
        self.echec_ecriture = echec_ecriture
        self.echecs: list[tuple[str, str]] = []

    def adresses_de_service(self, _workspace_id):
        return frozenset()

    def record_poll_failure(self, account_id, code):
        if self.echec_ecriture is not None:
            raise self.echec_ecriture
        self.echecs.append((account_id, code))


def relever(monkeypatch, erreur: BaseException, base: BaseFactice, journal=None):
    def connecter(_compte, _timeout):
        raise erreur

    monkeypatch.setattr(ingestion, "_connecter", connecter)
    arguments = dict(
        client_base=base,
        compte=COMPTE,
        workspace_id="ws-1",
        dossiers=["INBOX"],
        clamav_hote="clamav",
        clamav_port=3310,
        taille_max_octets=1024,
    )
    if journal is not None:
        arguments["journal"] = journal
    return ingestion.relever_compte(**arguments)


def test_un_refus_de_login_s_ecrit_puis_l_exception_d_origine_remonte(monkeypatch) -> None:
    base = BaseFactice()
    with pytest.raises(LoginError):
        relever(monkeypatch, LoginError("refusé"), base)
    assert base.echecs == [("acc-1", "auth_failed")]


def test_un_echec_de_la_base_n_est_pas_ecrit_sur_la_boite(monkeypatch) -> None:
    base = BaseFactice()
    with pytest.raises(PostgrestError):
        relever(monkeypatch, PostgrestError(503), base)
    assert base.echecs == []


def test_un_defaut_du_service_n_est_pas_ecrit_sur_la_boite(monkeypatch) -> None:
    base = BaseFactice()
    with pytest.raises(KeyError):
        relever(monkeypatch, KeyError("uid"), base)
    assert base.echecs == []


def test_une_ecriture_qui_echoue_est_dite_et_n_efface_pas_l_exception_d_origine(monkeypatch) -> None:
    journal = JournalCapture()
    base = BaseFactice(echec_ecriture=PostgrestError(502))
    with pytest.raises(socket.timeout):
        relever(monkeypatch, socket.timeout("timed out"), base, journal=journal)
    [ligne] = journal.lignes()
    assert ligne["event"] == "releve_echec_non_ecrit"
    assert (ligne["account_id"], ligne["error"], ligne["postgrest_status"]) == ("acc-1", "timeout", 502)


def test_le_client_appelle_la_fonction_reservee_au_service(monkeypatch) -> None:
    client = PostgrestClient("http://kong:8000", "cle-de-service")
    appels: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "_rpc", lambda nom, corps: appels.append((nom, corps)))
    client.record_poll_failure("acc-1", "auth_failed")
    assert appels == [
        ("mail_inbound_account_record_poll_failure", {"p_account_id": "acc-1", "p_error": "auth_failed"})
    ]


# --- L'espacement (§24.4) -----------------------------------------------------------------------


def test_la_suite_des_attentes_double_jusqu_au_plafond_d_une_heure() -> None:
    assert [delai_apres_refus(n) for n in range(1, 7)] == [300, 600, 1_200, 2_400, 3_600, 3_600]


class Releveur:
    def __init__(self, erreur: BaseException | None = None) -> None:
        self.erreur = erreur
        self.appels: list[str] = []

    def __call__(self, compte_a_veiller: CompteAVeiller) -> None:
        self.appels.append(compte_a_veiller.identifiant)
        if self.erreur is not None:
            raise self.erreur


def tour(source, releveur, registre, maintenant):
    return executer_un_tour(
        source=source,
        relever=releveur,
        journal=lambda *_a, **_k: None,
        classer=classer_echec_releve,
        espacements=registre,
        maintenant=maintenant,
    )


def test_une_boite_refusee_n_est_pas_retentee_avant_l_echeance_et_l_est_apres() -> None:
    source = Source([compte(statut="ok")])
    registre = RegistreEspacements()
    releveur = Releveur(LoginError("refusé"))

    tour(source, releveur, registre, maintenant=1_000.0)
    # La base dit désormais `error` : c'est l'écriture de l'échec qui l'a posé.
    source.comptes = [compte(statut="error")]

    resultat = tour(source, releveur, registre, maintenant=1_000.0 + 299)
    assert (resultat.espaces, resultat.echecs, releveur.appels) == (1, 0, ["acc-1"])

    tour(source, releveur, registre, maintenant=1_000.0 + 300)
    assert releveur.appels == ["acc-1", "acc-1"]
    # Le second refus double l'attente.
    assert registre.par_compte["acc-1"].refus_consecutifs == 2
    assert tour(source, releveur, registre, maintenant=1_300.0 + 599).espaces == 1
    assert tour(source, releveur, registre, maintenant=1_300.0 + 600).echecs == 1


@pytest.mark.parametrize("statut", ["pending", "ok"])
def test_un_nouveau_mot_de_passe_ou_un_test_reussi_oublie_l_espacement(statut) -> None:
    source = Source([compte(statut="ok")])
    registre = RegistreEspacements()
    releveur = Releveur(LoginError("refusé"))
    tour(source, releveur, registre, maintenant=0.0)

    # `pending` : la connexion a été modifiée ; `ok` : un test a réussi. La boîte est relevée au tour même.
    source.comptes = [compte(statut=statut)]
    releveur.erreur = None
    resultat = tour(source, releveur, registre, maintenant=10.0)
    assert (resultat.releves, resultat.espaces) == (1, 0)
    assert registre.par_compte == {}


def test_une_panne_de_transport_n_espace_pas() -> None:
    source = Source([compte(statut="error")])
    registre = RegistreEspacements()
    releveur = Releveur(socket.timeout("timed out"))
    tour(source, releveur, registre, maintenant=0.0)
    resultat = tour(source, releveur, registre, maintenant=1.0)
    assert (resultat.espaces, resultat.echecs) == (0, 1)
    assert releveur.appels == ["acc-1", "acc-1"]


def test_une_releve_reussie_oublie_l_espacement() -> None:
    registre = RegistreEspacements()
    registre.refuser("acc-1", maintenant=0.0)
    resultat = tour(Source([compte(statut="error")]), Releveur(), registre, maintenant=10_000.0)
    assert resultat.releves == 1
    assert registre.par_compte == {}


def test_un_espacement_ne_retient_que_sa_boite() -> None:
    source = Source([compte("acc-1", statut="error"), compte("acc-2", statut="ok")])
    registre = RegistreEspacements()
    registre.refuser("acc-1", maintenant=0.0)
    releveur = Releveur()
    resultat = tour(source, releveur, registre, maintenant=1.0)
    assert (resultat.releves, resultat.espaces, releveur.appels) == (1, 1, ["acc-2"])


# --- `disabled` (§24.5) -------------------------------------------------------------------------


def test_une_boite_desactivee_est_ecartee_et_comptee_en_ignores() -> None:
    comptes = [compte("acc-1", statut="disabled"), compte("acc-2", statut="ok"), compte("acc-3", secret=False)]
    assert [c.identifiant for c in ordonner_comptes(comptes)] == ["acc-2"]

    releveur = Releveur()
    resultat = executer_un_tour(source=Source(comptes), relever=releveur, journal=lambda *_a, **_k: None)
    assert (resultat.releves, resultat.ignores, releveur.appels) == (1, 2, ["acc-2"])


def test_la_source_demande_au_serveur_d_ecarter_les_boites_desactivees(monkeypatch) -> None:
    client = PostgrestClient("http://kong:8000", "cle-de-service")
    chemins: list[str] = []

    def rest(_methode, chemin, *_args, **_kwargs):
        chemins.append(chemin)
        return 200, json.dumps(
            [{"id": "acc-1", "last_sync_at": None, "secret_id": "s", "status": "error"}]
        ).encode()

    monkeypatch.setattr(client, "_rest", rest)
    [lu] = client.lire_comptes_a_veiller()
    assert "status=neq.disabled" in chemins[0]
    assert "status" in chemins[0].split("select=")[1].split("&")[0]
    assert lu.statut == "error"

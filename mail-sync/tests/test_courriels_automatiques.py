# @verifies CRM-069 (docs/BACKLOG.md) — tranche T6 : le CRM n'ingère pas ses propres courriels — le digest se déclare
#           automatique, la relève écarte un courriel automatique de l'identité de service et garde tout le reste
# @verifies docs/SPEC-etiquettes-digest.md §5.3 bis (en-tête et identité de service, en conjonction) ; INC-321 ;
#           docs/JOURNAL.md décision 780

from __future__ import annotations

from email.message import EmailMessage

from mail_sync import ingestion
from mail_sync.composition import Envoi, composer
from mail_sync.mime_analyse import analyser, est_automatique
from mail_sync.postgrest import InboundCredentials

SERVICE = "systeme@crm.p2enjoy.test"
COMPTE = InboundCredentials(
    account_id="acc-1",
    workspace_id="ws-1",
    host="imap.exemple",
    port=993,
    security="tls",
    username="bizdev@p2enjoy.test",
    password="secret",
)


def brut(expediteur: str, auto_submitted: str | None, identifiant: str) -> bytes:
    message = EmailMessage()
    message["From"] = expediteur
    message["To"] = "bizdev@p2enjoy.test"
    message["Subject"] = "Votre journée"
    message["Message-ID"] = identifiant
    if auto_submitted is not None:
        message["Auto-Submitted"] = auto_submitted
    message.set_content("Bonjour")
    return bytes(message)


def test_auto_submitted_absent_ou_no_est_humain_toute_autre_valeur_est_automatique() -> None:
    assert est_automatique(None) is False
    assert est_automatique("no") is False
    assert est_automatique(" No ") is False
    assert est_automatique("auto-generated") is True
    assert est_automatique("auto-replied; owner-email=x@y.example") is True


def test_l_analyse_lit_l_entete() -> None:
    assert analyser(brut(SERVICE, "auto-generated", "<a@crm.p2enjoy.test>")).automatique is True
    assert analyser(brut(SERVICE, None, "<b@crm.p2enjoy.test>")).automatique is False


def test_un_envoi_automatique_se_declare_un_envoi_d_affaire_jamais() -> None:
    commun = dict(outbox_id="o", from_address=SERVICE, to_addrs=("bizdev@p2enjoy.test",), subject="s", body_text="b")
    digest = composer(Envoi(reply_to=None, automatique=True, **commun), "<d@crm.p2enjoy.test>")
    affaire = composer(Envoi(reply_to="c-abcdefgh@crm.p2enjoy.test", **commun), "<e@crm.p2enjoy.test>")
    assert digest["Auto-Submitted"] == "auto-generated"
    assert affaire["Auto-Submitted"] is None


def test_seule_la_conjonction_de_l_entete_et_de_l_identite_de_service_ecarte() -> None:
    adresses = frozenset({SERVICE})
    assert ingestion.ecarter(analyser(brut("Systeme@CRM.p2enjoy.test", "auto-generated", "<1@x>")), adresses) is True
    # L'identité de service envoie aussi des courriels écrits par une personne : ils restent dans le fil.
    assert ingestion.ecarter(analyser(brut(SERVICE, None, "<2@x>")), adresses) is False
    # Le répondeur d'absence d'un contact est un vrai message de l'échange.
    assert ingestion.ecarter(analyser(brut("contact@client.example", "auto-replied", "<3@x>")), adresses) is False
    # Un espace sans identité de service n'écarte rien.
    assert ingestion.ecarter(analyser(brut(SERVICE, "auto-generated", "<4@x>")), frozenset()) is False


class ImapFactice:
    def __init__(self, messages: dict[int, bytes]) -> None:
        self._messages = messages

    def capabilities(self):
        return (b"IMAP4rev2",)

    def select_folder(self, _dossier, readonly=True):
        return {}

    def search(self, _criteres):
        return list(self._messages)

    def fetch(self, uids, _champs):
        return {uid: {b"RFC822": self._messages[uid]} for uid in uids}

    def logout(self):
        return None


class BaseFactice:
    def __init__(self) -> None:
        self.enregistres: list[str] = []
        self.progressions: list[dict] = []

    def adresses_de_service(self, workspace_id):
        assert workspace_id == "ws-1"
        return frozenset({SERVICE})

    def dossiers_a_renommer(self, _account_id):
        return []

    def lire_progression(self, _account_id):
        return 0, {}

    def enregistrer_progression(self, _account_id, sync_state):
        self.progressions.append(sync_state)

    def enregistrer_message(self, *, workspace_id, analyse):
        self.enregistres.append(analyse.rfc822_message_id)
        return f"m-{len(self.enregistres)}", True

    def classer_automatiquement(self, _message_id, _in_reply_to, _references):
        return None

    def enregistrer_occurrence(self, **_champs):
        return True

    def messages_a_ranger(self, _account_id):
        return []


def test_la_releve_n_enregistre_pas_le_digest_mais_le_tient_pour_releve(monkeypatch) -> None:
    imap = ImapFactice({
        7: brut(SERVICE, "auto-generated", "<digest@crm.p2enjoy.test>"),
        8: brut(SERVICE, None, "<envoi-affaire@crm.p2enjoy.test>"),
    })
    base = BaseFactice()
    monkeypatch.setattr(ingestion, "_connecter", lambda _compte, _timeout: imap)
    resultat = ingestion.relever_compte(
        client_base=base, compte=COMPTE, workspace_id="ws-1", dossiers=["INBOX"],
        clamav_hote="clamav", clamav_port=3310, taille_max_octets=1024,
    )
    assert base.enregistres == ["<envoi-affaire@crm.p2enjoy.test>"]
    assert resultat.messages_vus == 2 and resultat.messages_nouveaux == 1 and resultat.messages_ecartes == 1
    # L'UID du digest entre dans la progression : il ne sera pas relu au tour suivant.
    assert base.progressions and base.progressions[-1]["INBOX"]["uid_max"] == 8

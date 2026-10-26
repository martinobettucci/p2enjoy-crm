# @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : le worker joint les pièces, archive avant d'envoyer, refuse une pièce
#           absente ou infectée, remet la copie cachée par l'enveloppe
# @verifies docs/SPEC-mail-subsystem.md §19 bis.2 points 6 et 7, §19 bis.4 ; docs/JOURNAL.md décisions 719 et 720
#
# SANS SERVEUR : le client de base et la session SMTP sont des doubles qui journalisent ce qu'on leur demande. L'aller
# réel — remise, pièce intacte, copie cachée reçue sans en-tête — est prouvé par `e2e/mail/envoi-pieces-jointes.spec.ts`.

from __future__ import annotations

import hashlib
import re
from typing import Any

import pytest

from mail_sync import antivirus, envoi as module_envoi
from mail_sync.envoi import vider_la_file
from mail_sync.postgrest import OutboundCredentials, PostgrestError


class FausseSession:
    def __init__(self, journal: list[Any]) -> None:
        self.journal = journal

    def login(self, *_a: Any) -> None:
        self.journal.append("login")

    def send_message(self, message: Any, to_addrs: list[str]) -> None:
        self.journal.append(("send", message, list(to_addrs)))

    def quit(self) -> None:
        pass


class FauxClient:
    def __init__(self, ligne: dict[str, Any], objets: dict[str, bytes], panne_stockage: bool = False) -> None:
        self.ligne = ligne
        self.objets = objets
        self.panne_stockage = panne_stockage
        self.journal: list[Any] = []

    def reprendre_envois_orphelins(self) -> int:
        return 0

    def reserver_envois(self, _limite: int) -> list[dict[str, Any]]:
        return [self.ligne]

    def read_outbound_credentials(self, _identite: str) -> OutboundCredentials:
        return OutboundCredentials(
            identity_id="i1", workspace_id="w1", host="smtp", port=587, security="none", username="u",
            from_address="systeme@crm.p2enjoy.test", password="p",
        )

    def lire_objet_envoi(self, chemin: str) -> bytes | None:
        if self.panne_stockage:
            raise PostgrestError(503)
        return self.objets.get(chemin)

    def deposer_objet(self, chemin: str, contenu: bytes, mime: str) -> None:
        self.journal.append(("depot", chemin, contenu, mime))

    def marquer_envoi_reussi(self, outbox_id: str, identifiant: str, references: list[str], pieces: list[Any]) -> str:
        self.journal.append(("reussi", outbox_id, pieces))
        return "m1"

    def marquer_envoi_echoue(self, outbox_id: str, code: str) -> None:
        self.journal.append(("echoue", outbox_id, code))

    def reprogrammer_envoi(self, outbox_id: str, code: str, delai: int) -> int:
        self.journal.append(("reprogramme", outbox_id, code))
        return 1


def ligne(**surcharges: Any) -> dict[str, Any]:
    base = {
        "outbox_id": "00000000-0000-4000-8000-0000000000b1",
        "card_id": "5eed0000-0000-4000-8000-0000000000c1",
        "identity_id": "i1",
        "from_address": "systeme@crm.p2enjoy.test",
        "reply_to": "c-1@crm.p2enjoy.test",
        "to_addrs": ["client@exterieur.test"],
        "cc_addrs": [],
        "bcc_addrs": ["direction@exterieur.test"],
        "subject": "Proposition",
        "body_text": "Bonjour.",
        "attempts": 0,
        "attachments": [{"path": "e/u/x/devis.pdf", "filename": "devis.pdf", "mime_type": "application/pdf"}],
    }
    base.update(surcharges)
    return base


@pytest.fixture()
def smtp(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    journal: list[Any] = []
    monkeypatch.setattr(module_envoi, "_ouvrir", lambda *_a, **_k: FausseSession(journal))
    return journal


def test_la_piece_est_archivee_AVANT_l_envoi_puis_jointe_et_declaree(smtp: list[Any]) -> None:
    """LE CHEMIN D'ARCHIVE A LA FORME QUE LA BASE EXIGE (`mail_attachments_chemin_sans_nom`) : deux UUID puis l'empreinte."""
    contenu = b"%PDF-1.4 devis"
    client = FauxClient(ligne(), {"e/u/x/devis.pdf": contenu})
    resultat = vider_la_file(client, clamav_hote=None)

    assert resultat.envoyes == 1
    empreinte = hashlib.sha256(contenu).hexdigest()
    depot, reussi = client.journal
    assert depot == ("depot", f"5eed0000-0000-4000-8000-0000000000c1/00000000-0000-4000-8000-0000000000b1/{empreinte}", contenu, "application/pdf")
    assert re.fullmatch(r"[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}", depot[1])
    assert reussi == (
        "reussi",
        "00000000-0000-4000-8000-0000000000b1",
        [
            {
                "filename": "devis.pdf",
                "mime_type": "application/pdf",
                "size_bytes": len(contenu),
                "storage_path": f"5eed0000-0000-4000-8000-0000000000c1/00000000-0000-4000-8000-0000000000b1/{empreinte}",
                "sha256": empreinte,
                # SANS ANTIVIRUS, LA PIÈCE PART ET SON ARCHIVE EST `skipped` — la règle de la réception (§4.3).
                "av_status": "skipped",
            }
        ],
    )
    _, message, enveloppe = smtp[1]
    assert enveloppe == ["client@exterieur.test", "direction@exterieur.test"]
    assert message["Bcc"] is None
    assert [p.get_filename() for p in list(message.iter_parts())[1:]] == ["devis.pdf"]


def test_une_piece_absente_fait_echouer_l_envoi_sans_rien_envoyer(smtp: list[Any]) -> None:
    client = FauxClient(ligne(), {})
    resultat = vider_la_file(client, clamav_hote=None)
    assert (resultat.envoyes, resultat.echoues) == (0, 1)
    assert client.journal == [("echoue", "00000000-0000-4000-8000-0000000000b1", "attachment_missing")]
    assert smtp == []


def test_une_piece_infectee_fait_echouer_l_envoi_sans_rien_envoyer(
    smtp: list[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        antivirus, "analyser_contenu", lambda *_a, **_k: antivirus.VerdictAntivirus(statut=antivirus.INFECTED)
    )
    client = FauxClient(ligne(), {"e/u/x/devis.pdf": b"X5O!P%@AP"})
    resultat = vider_la_file(client, clamav_hote="clamav")
    assert client.journal == [("echoue", "00000000-0000-4000-8000-0000000000b1", "attachment_infected")]
    assert (resultat.envoyes, smtp) == (0, [])


def test_une_piece_saine_est_archivee_clean(smtp: list[Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        antivirus, "analyser_contenu", lambda *_a, **_k: antivirus.VerdictAntivirus(statut=antivirus.CLEAN)
    )
    client = FauxClient(ligne(), {"e/u/x/devis.pdf": b"sain"})
    vider_la_file(client, clamav_hote="clamav")
    assert client.journal[-1][2][0]["av_status"] == "clean"


def test_le_stockage_injoignable_est_une_panne_qui_se_rejoue(smtp: list[Any]) -> None:
    client = FauxClient(ligne(), {}, panne_stockage=True)
    resultat = vider_la_file(client, clamav_hote=None)
    assert client.journal == [("reprogramme", "00000000-0000-4000-8000-0000000000b1", "storage_unavailable")]
    assert (resultat.reprogrammes, smtp) == (1, [])


def test_sans_piece_ni_cci_l_envoi_d_avant_est_inchange(smtp: list[Any]) -> None:
    client = FauxClient(ligne(attachments=[], bcc_addrs=[]), {})
    vider_la_file(client, clamav_hote=None)
    assert client.journal == [("reussi", "00000000-0000-4000-8000-0000000000b1", [])]
    _, message, enveloppe = smtp[1]
    assert enveloppe == ["client@exterieur.test"]
    assert message.get_content_type() == "text/plain"

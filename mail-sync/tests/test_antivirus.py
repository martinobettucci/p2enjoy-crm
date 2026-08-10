# @verifies CRM-054 (docs/BACKLOG.md) — soumission à ClamAV et statuts
# @verifies docs/SPEC-mail-subsystem.md §4.3 (les quatre statuts), §15.1 (mesure EICAR)

from __future__ import annotations

import socket
import threading

from mail_sync.antivirus import CLEAN, INFECTED, SKIPPED, analyser_contenu


def _serveur_factice(reponse: bytes) -> tuple[str, int, threading.Thread]:
    """Un `clamd` qui ne sait dire qu'une phrase. Le vrai est exercé par la preuve `mail`."""

    ecoute = socket.socket()
    ecoute.bind(("127.0.0.1", 0))
    ecoute.listen(1)
    hote, port = ecoute.getsockname()

    def servir() -> None:
        connexion, _ = ecoute.accept()
        with connexion:
            # LE FLUX EST LU JUSQU'À SON TERMINATEUR, ET C'EST NÉCESSAIRE : un `recv` unique
            # rendait la main avant la fin de l'envoi, le serveur répondait puis fermait, et le
            # client recevait un `BrokenPipeError` en poursuivant son `sendall` — donc `skipped`
            # au lieu du verdict attendu. Défaut de la preuve, pas du produit : mesuré une fois
            # sur trois.
            recu = b""
            while not recu.endswith(b"\x00\x00\x00\x00"):
                morceau = connexion.recv(65536)
                if not morceau:
                    break
                recu += morceau
            connexion.sendall(reponse)
        ecoute.close()

    fil = threading.Thread(target=servir, daemon=True)
    fil.start()
    return hote, port, fil


def test_une_signature_trouvee_rend_infected_et_nomme_la_signature() -> None:
    hote, port, _ = _serveur_factice(b"stream: Eicar-Test-Signature FOUND\x00")
    verdict = analyser_contenu(b"peu importe", hote=hote, port=port, timeout=5)
    assert verdict.statut == INFECTED
    assert verdict.signature == "Eicar-Test-Signature"


def test_un_contenu_anodin_rend_clean() -> None:
    hote, port, _ = _serveur_factice(b"stream: OK\x00")
    assert analyser_contenu(b"anodin", hote=hote, port=port, timeout=5).statut == CLEAN


def test_une_reponse_incomprise_rend_skipped_et_jamais_clean() -> None:
    """Le §4.3 range `skipped` parmi les statuts NON téléchargeables : un fichier non analysé
    n'est pas un fichier sain."""

    hote, port, _ = _serveur_factice(b"ERROR: quelque chose\x00")
    assert analyser_contenu(b"x", hote=hote, port=port, timeout=5).statut == SKIPPED


def test_un_antivirus_injoignable_rend_skipped_et_jamais_clean() -> None:
    with socket.socket() as sonde:
        sonde.bind(("127.0.0.1", 0))
        port_ferme = sonde.getsockname()[1]

    assert analyser_contenu(b"x", hote="127.0.0.1", port=port_ferme, timeout=2).statut == SKIPPED

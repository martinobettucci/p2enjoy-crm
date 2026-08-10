# @spec CRM-054 (docs/BACKLOG.md) — soumission des pièces jointes à ClamAV
# @spec docs/SPEC-mail-subsystem.md §4.3 (les quatre statuts), §15.5 (l'ordre dépôt → analyse)
# @spec docs/JOURNAL.md décision 320
#
# `clamd` PARLE UN PROTOCOLE SIMPLE, ET AUCUNE BIBLIOTHÈQUE N'EST NÉCESSAIRE : `zINSTREAM` suivi de
# blocs préfixés par leur longueur, terminés par un bloc vide. `CLAUDE.md` §19 demande de vérifier
# qu'une dépendance est nécessaire ; celle-ci ne l'est pas.
#
# MESURÉ depuis le réseau Compose (§15.1) : la chaîne de test EICAR rend
# `stream: Eicar-Test-Signature FOUND`, et un contenu anodin rend `stream: OK`.

from __future__ import annotations

import socket
from dataclasses import dataclass


CLEAN = "clean"
INFECTED = "infected"
SKIPPED = "skipped"

#: Taille d'un bloc de flux. ClamAV borne lui-même la taille acceptée (`StreamMaxLength`) ; ce
#: découpage n'est qu'une politesse envers la mémoire du service.
TAILLE_BLOC = 64 * 1024


@dataclass(frozen=True)
class VerdictAntivirus:
    """Ce que l'antivirus a répondu, réduit à ce que la base accepte.

    `signature` n'est PAS écrite en base : c'est une information de diagnostic, et la table ne
    porte qu'un statut. La conserver ici permet de la journaliser sans la publier.
    """

    statut: str
    signature: str | None = None


def analyser_contenu(
    contenu: bytes, *, hote: str, port: int, timeout: float = 30.0
) -> VerdictAntivirus:
    """Soumet un contenu à `clamd` et rend l'un des trois statuts terminaux.

    UNE PANNE D'ANTIVIRUS NE REND JAMAIS `clean`. Elle rend `skipped`, que le §4.3 range
    explicitement parmi les statuts **non téléchargeables** : un fichier non analysé n'est pas un
    fichier sain, et le traiter comme tel serait la valeur par défaut trompeuse que `CLAUDE.md`
    §18 proscrit.
    """

    try:
        with socket.create_connection((hote, port), timeout=timeout) as prise:
            prise.settimeout(timeout)
            prise.sendall(b"zINSTREAM\0")
            for debut in range(0, len(contenu), TAILLE_BLOC):
                bloc = contenu[debut : debut + TAILLE_BLOC]
                prise.sendall(len(bloc).to_bytes(4, "big") + bloc)
            prise.sendall((0).to_bytes(4, "big"))

            reponse = b""
            while b"\0" not in reponse:
                morceau = prise.recv(4096)
                if not morceau:
                    break
                reponse += morceau
    except OSError:
        return VerdictAntivirus(statut=SKIPPED)

    texte = reponse.decode("utf-8", errors="replace").strip("\x00\n ")
    if texte.endswith("FOUND"):
        # `stream: Eicar-Test-Signature FOUND` → la signature est le milieu.
        signature = texte[len("stream: ") : -len(" FOUND")] if ": " in texte else None
        return VerdictAntivirus(statut=INFECTED, signature=signature)
    if texte.endswith("OK"):
        return VerdictAntivirus(statut=CLEAN)
    # Une réponse que le service ne comprend pas — `ERROR`, un flux tronqué, une version future —
    # n'autorise pas à conclure. `skipped` dit exactement cela.
    return VerdictAntivirus(statut=SKIPPED)

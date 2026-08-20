#!/usr/bin/env python3
# @spec CRM-087 (docs/BACKLOG.md) — simulation d'un terminal interactif pour la confirmation
#       d'instantané de « ./runProd.sh --migrate »
# @spec docs/JOURNAL.md décision 489 (garde --migrate + confirmation d'instantané au terminal),
#       décision 490 (livraison initiale de CRM-087 et reste sur la couverture du refus au terminal)
# @spec docs/PROD_MIGRATIONS.md §3.1 (fenêtre de maintenance ouverte par --migrate)
#
# Petit utilitaire portable : lance une commande dans un pseudo-terminal, attend que sa sortie
# contienne un marqueur, écrit une réponse (avec « \n » ajouté), puis rend le code de sortie de
# l'enfant. La sortie fusionnée stdout+stderr — telle qu'un opérateur la verrait — est écrite dans
# le fichier de journal indiqué. Sur dépassement du délai, l'enfant est tué (SIGKILL) et le
# processus rend 124.
#
# Ce module est appelé par « scripts/verify-scripts.sh » pour éprouver deux cas que la garde du
# §3.1 ne peut pas prouver hors TTY (le refus au terminal sur une saisie autre que « oui », et
# l'acceptation qui laisse la garde libérer le geste vers Docker). Il n'a AUCUNE dépendance
# extérieure au-delà de la bibliothèque standard de Python 3, et il n'est utilisé que par le
# harnais : ni le produit ni la pile n'en dépendent.
#
# Usage :
#   spawn-pty.py TIMEOUT LOG MARKER RESPONSE CMD [ARGS...]
#
#   TIMEOUT  : secondes (nombre décimal accepté)
#   LOG      : chemin du fichier qui recevra la sortie fusionnée telle que vue dans le PTY
#   MARKER   : sous-chaîne à attendre sur la sortie avant d'écrire RESPONSE (UTF-8)
#   RESPONSE : chaîne écrite au PTY, terminée par « \n » ajouté par ce script
#   CMD ...  : commande et arguments à exécuter dans l'enfant

import os
import pty
import select
import sys
import time


def _write_log(path: str, data: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(data)


def main() -> None:
    if len(sys.argv) < 6:
        print(
            "usage: spawn-pty.py TIMEOUT LOG MARKER RESPONSE CMD [ARGS...]",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        timeout = float(sys.argv[1])
    except ValueError:
        print(f"spawn-pty: TIMEOUT invalide « {sys.argv[1]} »", file=sys.stderr)
        sys.exit(2)

    log_path = sys.argv[2]
    marker = sys.argv[3].encode("utf-8")
    response = sys.argv[4].encode("utf-8") + b"\n"
    command = sys.argv[5:]

    pid, fd = pty.fork()
    if pid == 0:
        # Enfant : remplacer par la commande, avec le PTY comme stdin/stdout/stderr.
        os.execvp(command[0], command)
        os._exit(127)  # jamais atteint sauf si execvp échoue silencieusement

    buffer = b""
    sent = False
    started_at = time.monotonic()
    child_exited = False
    status = 0

    try:
        while True:
            if time.monotonic() - started_at > timeout:
                try:
                    os.kill(pid, 9)
                except ProcessLookupError:
                    pass
                try:
                    os.waitpid(pid, 0)
                except ChildProcessError:
                    pass
                buffer += b"\n<timeout>\n"
                _write_log(log_path, buffer)
                sys.exit(124)

            readable, _, _ = select.select([fd], [], [], 0.1)
            if fd in readable:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    # Le côté « esclave » a été fermé (enfant terminé).
                    chunk = b""
                if not chunk:
                    break
                buffer += chunk
                if not sent and marker in buffer:
                    try:
                        os.write(fd, response)
                    except OSError:
                        pass
                    sent = True

            # Sonde non bloquante : détecter la fin de l'enfant sans attendre.
            try:
                exited_pid, exited_status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                exited_pid, exited_status = pid, 0
            if exited_pid == pid:
                child_exited = True
                status = exited_status
                # Drainer ce qui reste dans le tampon du PTY avant de sortir.
                while True:
                    remaining, _, _ = select.select([fd], [], [], 0.05)
                    if not remaining:
                        break
                    try:
                        tail = os.read(fd, 4096)
                    except OSError:
                        tail = b""
                    if not tail:
                        break
                    buffer += tail
                break
    finally:
        try:
            os.close(fd)
        except OSError:
            pass

    if not child_exited:
        try:
            _, status = os.waitpid(pid, 0)
        except ChildProcessError:
            status = 0

    _write_log(log_path, buffer)
    sys.exit(os.waitstatus_to_exitcode(status))


if __name__ == "__main__":
    main()

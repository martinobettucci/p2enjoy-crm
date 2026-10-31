# @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : le récepteur local des webhooks, pendant de Stalwart pour la messagerie
# @spec docs/SPEC-webhooks.md §8 (un service HTTPS de développement qui garde les requêtes reçues, les rend en lecture et
#       répond un code choisi), §12 (son autorité, produite au démarrage, servie en clair sur le réseau interne)
#
# DÉVELOPPEMENT SEULEMENT : aucun assemblage de staging ou de production ne le porte. Rien n'est rangé dans le dépôt : à
# chaque démarrage, une autorité et un certificat `webhook-sink` neufs sont produits par `openssl`, dans un dossier
# temporaire du conteneur. Les requêtes reçues vivent en mémoire et disparaissent avec lui.
#
# - HTTPS, port 8443 : tout `POST` est gardé et reçoit `200` ; un chemin `/statut/<code>/…` fait répondre ce code (de 200
#   à 599), un chemin `/lent/…` attend 12 s avant de répondre — au-delà du délai de 10 s d'une remise.
# - HTTP, port 8080, réseau interne seulement : `GET /sante`, `GET /ca.pem` (l'autorité), `GET /requetes[?remise=<id>]`
#   (les requêtes gardées, la plus récente en dernier) et `DELETE /requetes`.

import json
import re
import ssl
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DOSSIER = Path(tempfile.mkdtemp(prefix="webhook-sink-"))
REQUETES: list[dict] = []
VERROU = threading.Lock()
LIMITE = 500


def produire_certificats() -> None:
    """Une autorité locale, puis un certificat `webhook-sink` qu'elle signe (SAN obligatoire pour rustls)."""
    def openssl(*arguments: str) -> None:
        subprocess.run(["openssl", *arguments], check=True, cwd=DOSSIER, capture_output=True)

    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-subj", "/CN=Recepteur local P2Enjoy",
            "-keyout", "ca.key", "-out", "ca.pem", "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=webhook-sink", "-keyout", "serveur.key",
            "-out", "serveur.csr")
    (DOSSIER / "extensions.cnf").write_text(
        "subjectAltName=DNS:webhook-sink\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n")
    openssl("x509", "-req", "-in", "serveur.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "30",
            "-extfile", "extensions.cnf", "-out", "serveur.pem")


class Recepteur(BaseHTTPRequestHandler):
    """HTTPS : garde chaque `POST` et répond le code que le chemin demande."""

    def log_message(self, *_args) -> None:  # aucun corps ni en-tête dans le journal du conteneur
        return

    def do_POST(self) -> None:
        longueur = int(self.headers.get("content-length") or 0)
        corps = self.rfile.read(longueur).decode("utf-8", "replace")
        statut = 200
        trouve = re.match(r"^/statut/(\d{3})(/|$)", self.path)
        if trouve and 200 <= int(trouve.group(1)) <= 599:
            statut = int(trouve.group(1))
        with VERROU:
            REQUETES.append({
                "chemin": self.path,
                "entetes": {cle.lower(): valeur for cle, valeur in self.headers.items()},
                "corps": corps,
                "recu_le": datetime.now(timezone.utc).isoformat(),
                "statut_rendu": statut,
            })
            del REQUETES[:-LIMITE]
        if self.path.startswith("/lent/"):
            time.sleep(12)
        self.send_response(statut)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"recu":true}')


class Lecture(BaseHTTPRequestHandler):
    """HTTP interne : la santé, l'autorité et la lecture des requêtes gardées."""

    def log_message(self, *_args) -> None:
        return

    def repondre(self, statut: int, corps: bytes, type_contenu: str = "application/json") -> None:
        self.send_response(statut)
        self.send_header("content-type", type_contenu)
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/sante":
            self.repondre(200, b'{"status":"ok"}')
        elif url.path == "/ca.pem":
            self.repondre(200, (DOSSIER / "ca.pem").read_bytes(), "application/x-pem-file")
        elif url.path == "/requetes":
            remise = parse_qs(url.query).get("remise", [None])[0]
            with VERROU:
                choisies = [r for r in REQUETES if remise is None or r["entetes"].get("x-p2enjoy-delivery") == remise]
            self.repondre(200, json.dumps(choisies).encode("utf-8"))
        else:
            self.repondre(404, b'{"error":"not_found"}')

    def do_DELETE(self) -> None:
        if urlparse(self.path).path != "/requetes":
            self.repondre(404, b'{"error":"not_found"}')
            return
        with VERROU:
            REQUETES.clear()
        self.repondre(200, b'{"vide":true}')


def main() -> None:
    produire_certificats()
    securise = ThreadingHTTPServer(("0.0.0.0", 8443), Recepteur)
    contexte = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    contexte.load_cert_chain(DOSSIER / "serveur.pem", DOSSIER / "serveur.key")
    securise.socket = contexte.wrap_socket(securise.socket, server_side=True)
    threading.Thread(target=securise.serve_forever, daemon=True).start()
    print("webhook-sink : HTTPS 8443, lecture HTTP 8080", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Lecture).serve_forever()


if __name__ == "__main__":
    main()

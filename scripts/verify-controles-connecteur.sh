#!/usr/bin/env bash
# @verifies CRM-102 (docs/BACKLOG.md) — tranche T5 : les contrôles du connecteur MCP portés dans scripts/spark/verifier.sh
# @verifies docs/SPEC-deploiement-spark.md §7 (point 7) ; docs/SPEC-mcp.md §2.1, §2.2, §3.4, §11 ;
#           docs/PROD_MIGRATIONS.md §2.14 (geste 5) ; docs/JOURNAL.md décision 683 ; CLAUDE.md §15, §18 (preuves non
#           complaisantes)
#
# Éprouve `scripts/lib/connecteur-mcp.sh`, que `scripts/spark/verifier.sh` emploie dans la cellule :
#
#   1. traçabilité et branchement : la bibliothèque et `verifier.sh` citent la tranche ; `verifier.sh` lit
#      `CRM_MCP_HOTE` et `SITE_URL` dans `/etc/spark/env` et appelle le contrôle de la cellule ;
#   2. les quatre contrôles publics contre le VRAI service `mcp` de développement : tous verts ;
#   3. contre-épreuves : origine fausse, `SITE_URL` fausse, serveur complaisant qui rend `200` à tout — `"pret": false`
#      sur `/pret` —, port fermé — chacune rougit exactement les contrôles qu'elle doit rougir ;
#   4. une cellule SIMULÉE : `distant` exécute localement, `/etc/spark` redirigé vers des fichiers jetables, et un VRAI
#      Caddy de la cellule (`Caddyfile.spark`, `routes.caddy`) devant le service de développement — connecteur éteint,
#      conteneur orphelin, hôte aiguillé, hôte inconnu de Caddy, route proposée, conteneur absent, route publique.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), service `mcp` compris. Il n'écrit rien
# dans la pile : un enregistrement refusé n'écrit rien (décision 683).
#
# Usage :
#   scripts/verify-controles-connecteur.sh
#   scripts/verify-controles-connecteur.sh --help

set -uo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
	--help | -h)
		sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
		exit 0
		;;
	'') ;;
	*)
		echo "option inconnue : $1" >&2
		exit 2
		;;
esac

checks=0
failures=0
pass() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
valeur() { sed -n "s/^$1=//p" .env | tail -n 1; }

RESEAU=p2enjoy-crm_default
CADDY=p2enjoy-verif-controles-caddy
HOTE=crm.mcp.exemple.test
PORT_DEV=$(valeur MCP_DEV_PORT)
PORT_DEV=${PORT_DEV:-18490}
ORIGINE="http://localhost:$PORT_DEV"
SITE=$(valeur SITE_URL)
TRAVAIL=$(mktemp -d)
STUB_PID=
nettoyer() {
	[ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
	docker rm -f "$CADDY" >/dev/null 2>&1 || true
	rm -rf "$TRAVAIL"
}
trap nettoyer EXIT

# shellcheck source=scripts/lib/connecteur-mcp.sh
source scripts/lib/connecteur-mcp.sh

# Les contrôles de la bibliothèque sont capturés, une ligne par contrôle rendu, pour compter ce qu'un scénario rougit.
ok() { printf 'OK|%s\n' "$1" >>"$TRAVAIL/rendu"; }
echec() { printf 'ECHEC|%s\n' "$1" >>"$TRAVAIL/rendu"; }
attente() { printf 'ATTENTE|%s\n' "$1" >>"$TRAVAIL/rendu"; }
compte() { grep -c "^$1|" "$TRAVAIL/rendu" || true; }
# rendu_attendu <libellé> <OK> <ECHEC> <ATTENTE> [motif qu'un ECHEC doit porter]
rendu_attendu() {
	local libelle=$1 n_ok=$2 n_echec=$3 n_attente=$4 motif=${5:-}
	local mesure="$(compte OK)/$(compte ECHEC)/$(compte ATTENTE)"
	if [ "$mesure" = "$n_ok/$n_echec/$n_attente" ] && { [ -z "$motif" ] || grep -q "^ECHEC|.*$motif" "$TRAVAIL/rendu"; }; then
		pass "$libelle : $n_ok OK, $n_echec échec(s), $n_attente en attente"
	else
		fail "$libelle : attendu $n_ok/$n_echec/$n_attente${motif:+ (échec sur « $motif »)}, mesuré $mesure — $(tr '\n' ';' <"$TRAVAIL/rendu" | head -c 400)"
	fi
	: >"$TRAVAIL/rendu"
}
: >"$TRAVAIL/rendu"

printf '\033[1mPreuves de CRM-102 T5 — les contrôles du connecteur dans verifier.sh\033[0m\n'

titre '1. Traçabilité et branchement'
for fichier in scripts/lib/connecteur-mcp.sh scripts/spark/verifier.sh; do
	head -12 "$fichier" | grep -q '@spec CRM-102 (docs/BACKLOG.md) — tranche T5' \
		&& pass "$fichier cite CRM-102 T5" || fail "$fichier ne cite pas CRM-102 T5"
done
grep -q 'source "$(dirname "${BASH_SOURCE\[0\]}")/../lib/connecteur-mcp.sh"' scripts/spark/verifier.sh \
	&& pass 'verifier.sh inclut la bibliothèque' || fail 'verifier.sh n’inclut pas scripts/lib/connecteur-mcp.sh'
grep -q '^SITE=$(env_get "$variables" SITE_URL)$' scripts/spark/verifier.sh \
	&& grep -q '^HOTE_MCP=$(env_get "$variables" CRM_MCP_HOTE)$' scripts/spark/verifier.sh \
	&& pass 'verifier.sh lit CRM_MCP_HOTE et SITE_URL dans /etc/spark/env' || fail 'verifier.sh ne lit pas CRM_MCP_HOTE et SITE_URL'
grep -q '^verifier_connecteur_cellule "$HOTE_MCP" "$PORT" "$SITE" "$etats"$' scripts/spark/verifier.sh \
	&& pass 'verifier.sh appelle le contrôle de la cellule avec les états des conteneurs' \
	|| fail 'verifier.sh n’appelle pas verifier_connecteur_cellule'
bash -n scripts/spark/verifier.sh && bash -n scripts/lib/connecteur-mcp.sh \
	&& pass 'syntaxe de verifier.sh et de la bibliothèque' || fail 'erreur de syntaxe'

titre '2. Les contrôles publics contre le vrai service de développement'
[ "$(docker inspect -f '{{.State.Health.Status}}' p2enjoy-mcp 2>/dev/null)" = healthy ] \
	&& pass 'conteneur p2enjoy-mcp sain' || fail 'conteneur p2enjoy-mcp absent ou malade (./runDev.sh)'
[ -n "$SITE" ] && pass "SITE_URL lue dans .env : $SITE" || fail 'SITE_URL absente de .env'
controler_connecteur "$ORIGINE" "$ORIGINE" "$SITE"
rendu_attendu "service réel, $ORIGINE" 4 0 0

titre '3. Contre-épreuves'
controler_connecteur "$ORIGINE" 'http://autre.exemple.test' "$SITE"
rendu_attendu 'origine publique fausse : seul resource_metadata rougit' 3 1 0 '/mcp sans jeton'
controler_connecteur "$ORIGINE" "$ORIGINE" 'https://autre.exemple.test'
rendu_attendu 'SITE_URL fausse : seule la redirection /plateforme rougit' 3 1 0 '/plateforme'

# Un serveur complaisant : 200 à toute requête, et `"pret": false` sur `/pret`. Le code seul ne suffit à aucun contrôle :
# `/pret` doit lire son corps, les trois autres leur en-tête, leur refus ou leur destination.
PORT_STUB=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
python3 - "$PORT_STUB" >/dev/null 2>&1 <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class Complaisant(BaseHTTPRequestHandler):
    def repondre(self):
        corps = b'{"pret": false, "controles": {"sso": "ok", "crm": "injoignable"}}' if self.path == '/pret' else b'{}'
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)
    do_GET = do_POST = repondre
    def log_message(self, *args):
        pass
HTTPServer(('127.0.0.1', int(sys.argv[1])), Complaisant).serve_forever()
PY
STUB_PID=$!
for _ in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT_STUB/" && break; sleep 0.2; done
controler_connecteur "http://127.0.0.1:$PORT_STUB" "http://127.0.0.1:$PORT_STUB" "$SITE"
rendu_attendu 'serveur complaisant (200 à tout, « pret » faux) : les quatre contrôles rougissent' 0 4 0 'injoignable'
kill "$STUB_PID" 2>/dev/null
wait "$STUB_PID" 2>/dev/null
STUB_PID=
controler_connecteur "http://127.0.0.1:$PORT_STUB" "http://127.0.0.1:$PORT_STUB" "$SITE"
rendu_attendu 'port fermé : les quatre contrôles rougissent' 0 4 0

titre '4. Cellule simulée, devant un vrai Caddy de la cellule'
# La cellule : `/etc/spark` redirigé vers des fichiers jetables ; le Caddy de la cellule publié sur un port local,
# aiguillant HOTE vers le service `mcp` de développement, comme `scripts/verify-mcp.sh` le fait sur le réseau Compose.
# Une webapp minimale est montée : comme en production, un hôte que Caddy n'aiguille pas reçoit l'`index.html` en 200
# (repli de l'application monopage), et seul le corps de `/pret` le distingue du connecteur.
CELLULE="$TRAVAIL/etc-spark"
mkdir -p "$CELLULE" "$TRAVAIL/www"
printf '<!doctype html><div id="root"></div>\n' >"$TRAVAIL/www/index.html"
chmod -R a+rX "$TRAVAIL"
distant() { bash -c "${1//\/etc\/spark/$CELLULE}"; }
PORT_CADDY=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
docker rm -f "$CADDY" >/dev/null 2>&1 || true
docker run -d --name "$CADDY" --network "$RESEAU" -p "127.0.0.1:$PORT_CADDY:8080" -e MCP_HOTE="$HOTE" \
	-v "$PWD/caddy/Caddyfile.spark:/etc/caddy/Caddyfile:ro,z" -v "$PWD/caddy/routes.caddy:/etc/caddy/routes.caddy:ro,z" \
	-v "$TRAVAIL/www:/srv/www:ro,z" caddy:2.9-alpine >/dev/null
for _ in $(seq 1 40); do
	[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOTE" "http://127.0.0.1:$PORT_CADDY/sante")" = 200 ] && break
	sleep 0.5
done
ETATS_SANS='p2enjoy-caddy|Up 2 hours (healthy)
p2enjoy-db|Up 2 hours (healthy)'
ETATS_AVEC="$ETATS_SANS
p2enjoy-mcp|Up 2 hours (healthy)"

: >"$CELLULE/routes"
verifier_connecteur_cellule '' "$PORT_CADDY" "$SITE" "$ETATS_SANS"
rendu_attendu 'connecteur éteint, aucun conteneur mcp' 1 0 0
verifier_connecteur_cellule '' "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
rendu_attendu 'connecteur éteint, mais un conteneur mcp subsiste' 0 1 0 'subsiste'

printf 'crm.lelabs.tech 8080 tls\n%s 8080 tls\n' "$HOTE" >"$CELLULE/routes"
verifier_connecteur_cellule "$HOTE" "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
rendu_attendu "allumé, aiguillé par Caddy, route tls, $HOTE ne résout pas" 3 0 1
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: inconnu.exemple.test' "http://127.0.0.1:$PORT_CADDY/pret")" = 200 ] \
	&& pass 'témoin : un hôte non aiguillé reçoit la webapp en 200, comme en production' \
	|| fail 'témoin : le Caddy simulé ne sert pas la webapp aux hôtes non aiguillés'
verifier_connecteur_cellule 'inconnu.exemple.test' "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
rendu_attendu 'hôte que Caddy n’aiguille pas, sans route' 1 2 1 'Caddy, hôte inconnu'
verifier_connecteur_cellule "$HOTE" "$PORT_CADDY" "$SITE" "$ETATS_SANS"
rendu_attendu 'allumé, mais aucun conteneur mcp' 2 1 1 'aucun conteneur p2enjoy-mcp'

printf 'crm.lelabs.tech 8080 tls\n%s 8080 clair\n' "$HOTE" >"$CELLULE/routes"
printf '# proposé\n%s 8080 tls\n' "$HOTE" >"$CELLULE/routes.?"
verifier_connecteur_cellule "$HOTE" "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
rendu_attendu 'route active en clair, tls proposée' 2 0 2
rm -f "$CELLULE/routes.?"
verifier_connecteur_cellule "$HOTE" "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
rendu_attendu 'route active en clair, rien de proposé' 2 1 1 'non publié'

# La route publique : le nom résout (getent simulé), et les contrôles publics visent https://HOTE, origine comprise.
printf '%s 8080 tls\n' "$HOTE" >"$CELLULE/routes"
getent() { return 0; }
controler_connecteur() { printf 'OK|appel %s\n' "$*" >>"$TRAVAIL/rendu"; }
verifier_connecteur_cellule "$HOTE" "$PORT_CADDY" "$SITE" "$ETATS_AVEC"
grep -qxF "OK|appel https://$HOTE https://$HOTE $SITE" "$TRAVAIL/rendu" \
	&& pass "route tls et nom résolu : les contrôles publics visent https://$HOTE et $SITE" \
	|| fail "route publique : appel inattendu — $(tr '\n' ';' <"$TRAVAIL/rendu")"
: >"$TRAVAIL/rendu"
unset -f getent controler_connecteur

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

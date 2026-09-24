#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — vérifications après déploiement dans la cellule Spark
# @spec CRM-091 (docs/BACKLOG.md) — sonde du client OIDC en production
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §12 (points 5 et 7) — tranche T6 : GoTrue
#       retiré — `/auth/v1/health` rend 404, aucun conteneur `auth` ne subsiste, l'échangeur de session
#       répond (docs/JOURNAL.md décision 589)
# @spec docs/SPEC-deploiement-spark.md §7 (vérifications) ; docs/SPEC-auth.md §10.8 (sonde)
# @spec docs/PROD_MIGRATIONS.md §2.4 (étape 6), §5 (vérifications après déploiement)
# @spec docs/JOURNAL.md décision 576 (une route `clair` n'est publiée qu'en http://)
#
# S'exécute sur le POSTE, en LECTURE SEULE : aucune commande n'écrit, ni dans la cellule, ni dans la
# base, ni au SSO. Chaque contrôle rend OK ou ECHEC ; ce qui ne peut pas encore être vérifié — route
# absente, client non déclaré — est dit « EN ATTENTE », jamais compté comme un succès.
#
#   1. la révision livrée est celle attendue (`REVISION`) ;
#   2. chaque service est sain, aucun n'a été tué par manque de mémoire ni redémarré ;
#   3. seul SPARK_HTTP_PORT est publié ;
#   4. depuis la cellule, par Caddy : webapp, `/auth/v1/health` en 404 (GoTrue retiré), PostgREST,
#      fonction edge ;
#   5. l'échangeur de session répond, et rend 204 sans session (décision 587) ;
#   6. il reste au moins 2 Gio de disque ;
#   7. la route active est en `tls` ; depuis Internet, si le domaine résout : webapp et API en
#      https:// par la route publique ;
#   8. au SSO réel : le client existe, l'URL de retour est acceptée et PKCE est exigé.
#
# Usage :
#   scripts/spark/verifier.sh [--revision <commit>]      défaut : HEAD du poste
#   scripts/spark/verifier.sh --help
#
# Variables : SPARK_SSH_HOTE, SPARK_SSH_UTILISATEUR, SPARK_REPERTOIRE — comme livrer.sh.

set -uo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"
set +e

SPARK_SSH_HOTE="${SPARK_SSH_HOTE:-crm}"
SPARK_SSH_UTILISATEUR="${SPARK_SSH_UTILISATEUR:-spark-docker}"
SPARK_REPERTOIRE="${SPARK_REPERTOIRE:-/srv/crm}"
REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)

usage() { print_header_help "${BASH_SOURCE[0]}"; }
while [ $# -gt 0 ]; do
	case "$1" in
		--revision) REVISION=${2:?--revision exige une valeur}; shift ;;
		--help|-h)  usage; exit 0 ;;
		*)          die "option inconnue « $1 ». Voir scripts/spark/verifier.sh --help." ;;
	esac
	shift
done

cible="$SPARK_SSH_UTILISATEUR@$SPARK_SSH_HOTE"
distant() { ssh -o BatchMode=yes "$cible" "$@"; }

echecs=0; controles=0; attentes=0
ok()      { controles=$((controles + 1)); printf '  \033[32mOK\033[0m         %s\n' "$1"; }
echec()   { controles=$((controles + 1)); echecs=$((echecs + 1)); printf '  \033[31mECHEC\033[0m      %s\n' "$1"; }
attente() { attentes=$((attentes + 1)); printf '  \033[33mEN ATTENTE\033[0m %s\n' "$1"; }

variables=$(mktemp)
trap 'rm -f "$variables"' EXIT
distant "cat /etc/spark/env" > "$variables" 2>/dev/null || die "/etc/spark/env illisible dans la cellule."
DOMAINE=$(env_get "$variables" APP_DOMAIN)
PORT=$(env_get "$variables" SPARK_HTTP_PORT)
ANON=$(env_get "$variables" ANON_KEY)
EMETTEUR=$(env_get "$variables" SSO_OIDC_ISSUER)
CLIENT=$(env_get "$variables" SSO_OIDC_CLIENT_ID)
[ -n "$DOMAINE" ] && [ -n "$PORT" ] && [ -n "$ANON" ] || die "variables publiques non importées en console : rien à vérifier."

say "Vérification de la cellule — $cible:$SPARK_REPERTOIRE, domaine $DOMAINE"

# --- 1. Révision ---------------------------------------------------------------------------------
deployee=$(distant "cat '$SPARK_REPERTOIRE/REVISION' 2>/dev/null")
[ "$deployee" = "$REVISION" ] && ok "révision livrée : $REVISION" || echec "révision : cellule « $deployee », attendue « $REVISION »"

# --- 2. Santé, mémoire, redémarrages ---------------------------------------------------------------
etats=$(distant "docker ps -a --filter label=com.docker.compose.project=p2enjoy-crm --format '{{.Names}}|{{.Status}}'")
while IFS='|' read -r nom statut; do
	[ -n "$nom" ] || continue
	case "$nom:$statut" in
		p2enjoy-migrations:Exited\ \(0\)*|p2enjoy-minio-createbucket:Exited\ \(0\)*) ok "$nom : passage terminé en 0" ;;
		*"(healthy)"*) ok "$nom : sain" ;;
		*) echec "$nom : $statut" ;;
	esac
done <<< "$etats"
# `CRM-092` T6 : onze conteneurs — `auth` et `auth-templates` ont quitté la pile, et leur arrêt est
# une opération du §12 (point 5) que rien d'autre ne fait : `./runProd.sh` ne retire pas d'orphelin.
[ "$(printf '%s\n' "$etats" | grep -c .)" -ge 11 ] && ok "onze conteneurs de l'assemblage présents" || echec "conteneurs présents : $(printf '%s\n' "$etats" | grep -c .) sur 11"
orphelins=$(printf '%s\n' "$etats" | cut -d'|' -f1 | grep -xE 'p2enjoy-auth|p2enjoy-auth-templates|p2enjoy-inbucket')
[ -z "$orphelins" ] && ok "aucun conteneur de GoTrue ne subsiste" || echec "conteneurs retirés de la pile encore présents : $(printf '%s' "$orphelins" | tr '\n' ' ')"
tues=$(distant "for c in \$(docker ps -aq --filter label=com.docker.compose.project=p2enjoy-crm); do docker inspect -f '{{.Name}} {{.State.OOMKilled}} {{.RestartCount}}' \$c; done" | awk '$2 == "true" || $3 != 0')
[ -z "$tues" ] && ok "aucun arrêt par manque de mémoire, aucun redémarrage" || echec "arrêts ou redémarrages : $(printf '%s' "$tues" | tr '\n' ';')"

# --- 3. Ports publiés ------------------------------------------------------------------------------
publies=$(distant "docker ps --filter label=com.docker.compose.project=p2enjoy-crm --format '{{.Names}} {{.Ports}}'" | grep -- '->' | sort -u)
[ "$(printf '%s\n' "$publies" | grep -c .)" = 1 ] && printf '%s' "$publies" | grep -q "p2enjoy-caddy .*:$PORT->8080/tcp" \
	&& ok "seul Caddy publie un port : $PORT" || echec "ports publiés : $(printf '%s' "$publies" | tr '\n' ';')"

# --- 4. Depuis la cellule, par Caddy --------------------------------------------------------------
local_http() { distant "curl -s -o /dev/null -w '%{http_code}' $* 'http://127.0.0.1:$PORT$CHEMIN'"; }
CHEMIN=/; [ "$(local_http)" = 200 ] && distant "curl -s http://127.0.0.1:$PORT/" | grep -q 'id="root"' \
	&& ok "webapp servie par Caddy" || echec "webapp non servie sur :$PORT"
CHEMIN=/auth/v1/health; code=$(local_http -H "'apikey: $ANON'"); [ "$code" = 404 ] && ok "/auth/v1/health rend 404 : GoTrue retiré" || echec "/auth/v1/health : HTTP $code, 404 attendu"
CHEMIN=/rest/v1/workflow_nodes_catalog; code=$(local_http -H "'apikey: $ANON'"); [ "$code" = 200 ] && ok "PostgREST répond à la clé anonyme" || echec "PostgREST : HTTP $code"
CHEMIN=/functions/v1/example; code=$(local_http -X POST -H "'apikey: $ANON'" -H "'Authorization: Bearer $ANON'" -H "'content-type: application/json'" -d "'{}'"); [ "$code" = 200 ] && ok "fonction edge traversant Kong" || echec "fonction edge : HTTP $code"

# --- 5. Échangeur de session ----------------------------------------------------------------------
# RÉVISÉ par `CRM-092` T6 : GoTrue n'annonce plus rien, il est retiré. La session s'ouvre par la
# fonction `session` ; sans poignée, prolonger rend 204 et aucun corps (décision 587).
CHEMIN=/functions/v1/session/prolonger; code=$(local_http -X POST -H "'apikey: $ANON'"); [ "$code" = 204 ] \
	&& ok "échangeur de session : 204 sans session" || echec "échangeur de session : HTTP $code, 204 attendu"

# --- 6. Disque -------------------------------------------------------------------------------------
libre=$(distant "df -BG --output=avail / | tail -n 1 | tr -dc 0-9")
[ "${libre:-0}" -ge 2 ] && ok "disque : ${libre} Gio libres" || echec "disque : ${libre:-?} Gio libres, moins de 2"

# --- 7. Route et accès depuis Internet -------------------------------------------------------------
# Le mode d'une route dit ce que la Forge PUBLIE : `clair` ne sert que http://, que le SSO refuse.
mode=$(distant "awk -v d='$DOMAINE' '\$1 == d { print \$3 }' /etc/spark/routes")
propose=$(distant "awk -v d='$DOMAINE' '/^#/ { next } \$1 == d { print \$3 }' '/etc/spark/routes.?'")
if [ "$mode" = tls ]; then
	ok "route $DOMAINE active en tls"
elif [ "$propose" = tls ]; then
	attente "route $DOMAINE active en « ${mode:-aucune} » ; la route tls est proposée, à accepter par le propriétaire du Spark"
else
	echec "route $DOMAINE active en « ${mode:-aucune} » : https:// non publié — scripts/spark/proposer.sh --route-seule"
fi
if [ "$mode" != tls ]; then
	attente "https://$DOMAINE/ non vérifiable tant que la route n'est pas en tls"
elif getent ahostsv4 "$DOMAINE" >/dev/null; then
	page=$(curl -s -m 20 "https://$DOMAINE/")
	printf '%s' "$page" | grep -q 'id="root"' && ok "https://$DOMAINE/ sert la webapp" || echec "https://$DOMAINE/ ne sert pas la webapp"
	code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "apikey: $ANON" "https://$DOMAINE/rest/v1/workflow_nodes_catalog")
	[ "$code" = 200 ] && ok "API joignable par la route publique" || echec "API publique : HTTP $code"
else
	attente "$DOMAINE ne résout pas : enregistrement DNS et route à poser par le propriétaire du Spark"
fi

# --- 8. Client OIDC au SSO réel --------------------------------------------------------------------
retour=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "https://$DOMAINE/auth/retour")
sonde=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' "$EMETTEUR/protocol/openid-connect/auth?client_id=$CLIENT&response_type=code&scope=openid&redirect_uri=$retour")
case "$sonde" in
	"302 https://$DOMAINE/auth/retour?"*code_challenge_method*) ok "client $CLIENT déclaré, URL de retour acceptée, PKCE exigé" ;;
	400*) attente "client $CLIENT absent du realm, ou URL de retour différente : déclaration à coller (docs/SPEC-auth.md §10.8)" ;;
	*) echec "sonde du client : $sonde" ;;
esac

echo
if [ "$echecs" -gt 0 ]; then echo "Bilan : $controles contrôles, $echecs échec(s), $attentes en attente." >&2; exit 1; fi
if [ "$attentes" -gt 0 ]; then echo "Bilan : $controles contrôles, aucun échec, mais $attentes EN ATTENTE d'un geste extérieur." >&2; exit 2; fi
echo "Bilan : $controles contrôles, aucune anomalie."

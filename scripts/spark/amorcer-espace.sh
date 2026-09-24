#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — amorçage du premier espace de travail et de son administrateur
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §6.3 (qui inscrit une attente), §12 (point 6)
#       — tranche T4 : plus aucun compte n'est créé ; une ATTENTE administratrice est inscrite
# @spec docs/SPEC-deploiement-spark.md §6 (ce qui n'appartient pas au dépôt), §7 (vérifications)
# @spec docs/PROD_MIGRATIONS.md §2.4 (étape 8), §7 (opération d'exploitation encadrée)
# @spec docs/JOURNAL.md décisions 265 (chemin d'administration encadré), 573, 579 (admission) et 587
#
# S'exécute DANS la cellule, sous `spark-docker`, la pile démarrée. Opération d'EXPLOITATION : elle
# écrit en production et suppose une instruction humaine explicite, dont elle ne dispense pas.
#
# Un espace de travail naît sans aucun écran : ce script en pose le premier, et ATTEND son
# administrateur. Depuis `CRM-092`, le CRM ne crée aucune identité : le compte existe chez LeLabs.
#   1. l'espace est créé s'il manque, désigné par son identifiant court ;
#   2. s'il n'a encore aucun administrateur, une ATTENTE `admin` est inscrite à l'adresse donnée
#      (`workspace_invitations`). La personne devient administratrice à sa première connexion
#      LeLabs — adresse vérifiée ET rôle `verified` (docs/SPEC-session-sso.md §6) ;
#   3. un espace qui a déjà un administrateur n'est pas touché : l'amorçage est fait, et inscrire les
#      personnes suivantes appartient à un administrateur de l'espace (`CRM-070`).
# Chaque étape est idempotente : relancer le script ne crée rien deux fois.
#
# Usage :
#   scripts/spark/amorcer-espace.sh --email <adresse> --espace "<nom>" --slug <identifiant>
#                                   [--domaine-entrant <domaine>]
#   scripts/spark/amorcer-espace.sh --help
#
# Variables, pour les preuves seulement :
#   P2ENJOY_AMORCAGE_API   base de l'API, défaut http://127.0.0.1:<SPARK_HTTP_PORT> (Caddy)
#   P2ENJOY_ENV_FILE       fichier d'environnement ; défaut : fusion des fichiers de la cellule

set -euo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"

EMAIL=""
ESPACE=""
SLUG=""
DOMAINE=""

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--email)           EMAIL=${2:?--email exige une valeur}; shift ;;
		--espace)          ESPACE=${2:?--espace exige une valeur}; shift ;;
		--slug)            SLUG=${2:?--slug exige une valeur}; shift ;;
		--domaine-entrant) DOMAINE=${2:?--domaine-entrant exige une valeur}; shift ;;
		--help|-h)         usage; exit 0 ;;
		*)                 die "option inconnue « $1 ». Voir scripts/spark/amorcer-espace.sh --help." ;;
	esac
	shift
done

[ -n "$EMAIL" ] && [ -n "$ESPACE" ] && [ -n "$SLUG" ] || die "--email, --espace et --slug sont obligatoires."
case "$EMAIL" in *@*.*) ;; *) die "adresse « $EMAIL » hors forme." ;; esac
# L'attente porte l'adresse sous sa forme normalisée, celle que la base exige (docs/SCHEMA.md §1).
EMAIL=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')
case "$SLUG" in *[!a-z0-9-]* | -* | *-) die "identifiant court « $SLUG » : minuscules, chiffres et tirets." ;; esac
command -v python3 >/dev/null 2>&1 || die "python3 est requis (la cellule n'a pas jq)."

if [ -z "${P2ENJOY_ENV_FILE:-}" ]; then
	ENV_FILE=$(spark_env_merge)
fi
env_validate
env_require_profile prod
API="${P2ENJOY_AMORCAGE_API:-http://127.0.0.1:$(env_get "$ENV_FILE" SPARK_HTTP_PORT)}"
SERVICE=$(env_get "$ENV_FILE" SERVICE_ROLE_KEY)

REPONSE=$(mktemp)
trap 'rm -f "$REPONSE"' EXIT

# Appel de l'API avec la clé de service ; le corps de la réponse va dans $REPONSE, jamais à l'écran.
#   appel <méthode> <chemin> [corps JSON]
appel() {
	local methode=$1 chemin=$2 corps=${3:-}
	curl -sS -o "$REPONSE" -w '%{http_code}' -X "$methode" "$API$chemin" \
		-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
		-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
		${corps:+-d "$corps"}
}

# Lecture d'un champ JSON de $REPONSE. Python, jamais le shell : aucune valeur n'est interprétée.
#   champ <expression python sur d>
champ() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print($1)" "$REPONSE"; }
json() { python3 -c 'import json,sys; print(json.dumps(dict(zip(sys.argv[1::2], sys.argv[2::2]))))' "$@"; }

say "Amorçage de l'espace « $ESPACE » ($SLUG) — administrateur attendu : $EMAIL"
info "API : $API"

# --- 1. L'espace ------------------------------------------------------------------------------------

code=$(appel GET "/rest/v1/workspaces?slug=eq.$SLUG&select=id,name")
[ "$code" = 200 ] || die "lecture des espaces refusée (HTTP $code)."
ESPACE_ID=$(champ "d[0]['id'] if d else ''")
if [ -n "$ESPACE_ID" ]; then
	info "espace déjà présent : $ESPACE_ID ($(champ "d[0]['name']"))"
else
	corps=$(python3 -c 'import json,sys; c={"name": sys.argv[1], "slug": sys.argv[2], "settings": {}}; c.update({"inbound_domain": sys.argv[3]} if sys.argv[3] else {}); print(json.dumps(c))' "$ESPACE" "$SLUG" "$DOMAINE")
	code=$(appel POST /rest/v1/workspaces "$corps")
	[ "$code" = 201 ] || die "création de l'espace refusée (HTTP $code)."
	ESPACE_ID=$(champ "d[0]['id']")
	info "espace créé : $ESPACE_ID"
fi

# --- 2. L'administrateur, attendu ---------------------------------------------------------------------
#
# Un espace qui a déjà un administrateur est amorcé : rien n'est inscrit. Sinon, l'attente `admin` est
# posée par l'upsert natif de PostgREST, mesuré comme tel par le seed (décision 34) — relancer le
# script la rétablit, sans la dupliquer. Elle doit être ADMINISTRATRICE : la première appartenance
# d'un espace l'est, et la garde du dernier administrateur refuserait toute autre (INC-249).

code=$(appel GET "/rest/v1/workspace_members?workspace_id=eq.$ESPACE_ID&role=eq.admin&select=user_id")
[ "$code" = 200 ] || die "lecture des administrateurs refusée (HTTP $code)."
if [ "$(champ "len(d)")" != 0 ]; then
	info "espace déjà amorcé : il a un administrateur ; aucune attente n'est inscrite"
	echo
	say "Rien à faire — inscrire d'autres personnes appartient à un administrateur de l'espace"
	exit 0
fi

corps=$(json workspace_id "$ESPACE_ID" email "$EMAIL" role admin)
code=$(curl -sS -o "$REPONSE" -w '%{http_code}' -X POST "$API/rest/v1/workspace_invitations" \
	-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation,resolution=merge-duplicates' -d "$corps")
case "$code" in 200|201) ;; *) die "attente administratrice refusée (HTTP $code)." ;; esac
info "attente inscrite : $EMAIL deviendra administrateur de « $ESPACE » à sa première connexion"

echo
say "Amorçage terminé — à consigner dans docs/PROD_MIGRATIONS.md §8 (date, motif, adresse)"
info "La personne se connecte avec LeLabs à $EMAIL : adresse vérifiée et rôle « verified » exigés."

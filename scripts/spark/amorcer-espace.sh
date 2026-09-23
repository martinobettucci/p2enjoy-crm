#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — amorçage du premier espace de travail et de son administrateur
# @spec docs/SPEC-deploiement-spark.md §6 (ce qui n'appartient pas au dépôt), §7 (vérifications)
# @spec docs/PROD_MIGRATIONS.md §2.4 (étape 8), §7 (opération d'exploitation encadrée)
# @spec docs/SPEC-auth.md §3.2 (invitation), §10.6 (une invitation s'accepte par le SSO)
# @spec docs/JOURNAL.md décisions 265 (chemin d'administration encadré) et 573
#
# S'exécute DANS la cellule, sous `spark-docker`, la pile démarrée. Opération d'EXPLOITATION : elle
# écrit en production et suppose une instruction humaine explicite, dont elle ne dispense pas.
#
# Un espace de travail naît sans aucun écran : ce script en pose le premier, et son administrateur.
#   1. le compte est créé INVITÉ, sans mot de passe, par `POST /auth/v1/admin/generate_link` de type
#      `invite` — mesuré : le compte naît avec `invited_at` et SANS courriel envoyé. Le chemin qui
#      contourne la politique de mot de passe (décision 265) n'est donc pas emprunté : aucun mot de
#      passe n'existe. Le lien d'action rendu est une crédentielle : il n'est ni affiché, ni écrit ;
#   2. la personne accepte l'invitation en se connectant avec LeLabs à la même adresse, vérifiée
#      (docs/SPEC-auth.md §10.6, mesure M6) — ou, si le relais SMTP est en place, par une
#      réinitialisation de mot de passe ;
#   3. l'espace est créé s'il manque, désigné par son identifiant court ;
#   4. l'appartenance `admin` est posée, ou rétablie.
# Chaque étape est idempotente : relancer le script ne crée rien deux fois.
#
# Usage :
#   scripts/spark/amorcer-espace.sh --email <adresse> --espace "<nom>" --slug <identifiant>
#                                   [--nom "<nom affiché>"] [--domaine-entrant <domaine>]
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
NOM=""
DOMAINE=""

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--email)           EMAIL=${2:?--email exige une valeur}; shift ;;
		--espace)          ESPACE=${2:?--espace exige une valeur}; shift ;;
		--slug)            SLUG=${2:?--slug exige une valeur}; shift ;;
		--nom)             NOM=${2:?--nom exige une valeur}; shift ;;
		--domaine-entrant) DOMAINE=${2:?--domaine-entrant exige une valeur}; shift ;;
		--help|-h)         usage; exit 0 ;;
		*)                 die "option inconnue « $1 ». Voir scripts/spark/amorcer-espace.sh --help." ;;
	esac
	shift
done

[ -n "$EMAIL" ] && [ -n "$ESPACE" ] && [ -n "$SLUG" ] || die "--email, --espace et --slug sont obligatoires."
case "$EMAIL" in *@*.*) ;; *) die "adresse « $EMAIL » hors forme." ;; esac
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

say "Amorçage de l'espace « $ESPACE » ($SLUG) — administrateur $EMAIL"
info "API : $API"

# --- 1. Le compte ---------------------------------------------------------------------------------

code=$(appel GET "/auth/v1/admin/users?per_page=1000")
[ "$code" = 200 ] || die "lecture des comptes refusée (HTTP $code)."
UTILISATEUR=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(next((u['id'] for u in d.get('users', []) if u.get('email') == sys.argv[2]), ''))" "$REPONSE" "$EMAIL")

if [ -n "$UTILISATEUR" ]; then
	info "compte déjà présent : $UTILISATEUR"
else
	donnees=$(json full_name "${NOM:-${EMAIL%%@*}}")
	corps=$(python3 -c 'import json,sys; print(json.dumps({"type": "invite", "email": sys.argv[1], "data": json.loads(sys.argv[2])}))' "$EMAIL" "$donnees")
	code=$(appel POST /auth/v1/admin/generate_link "$corps")
	[ "$code" = 200 ] || die "création du compte invité refusée (HTTP $code)."
	UTILISATEUR=$(champ "d['id']")
	# Le lien d'action est une crédentielle : effacé du fichier avant toute autre lecture.
	: > "$REPONSE"
	info "compte invité créé, sans courriel envoyé : $UTILISATEUR"
fi

# --- 2. L'espace ------------------------------------------------------------------------------------

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

# --- 3. L'appartenance --------------------------------------------------------------------------------
#
# Upsert natif de PostgREST, mesuré comme tel par le seed (décision 34) : une appartenance existante
# est RÉTABLIE à `admin`, jamais dupliquée.

corps=$(json workspace_id "$ESPACE_ID" user_id "$UTILISATEUR" role admin)
code=$(curl -sS -o "$REPONSE" -w '%{http_code}' -X POST "$API/rest/v1/workspace_members" \
	-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation,resolution=merge-duplicates' -d "$corps")
case "$code" in 200|201) ;; *) die "appartenance administrateur refusée (HTTP $code)." ;; esac
info "appartenance : $EMAIL est administrateur de « $ESPACE »"

echo
say "Amorçage terminé — à consigner dans docs/PROD_MIGRATIONS.md §8 (date, motif, adresse)"
info "La personne se connecte avec LeLabs à $EMAIL, adresse vérifiée : l'invitation est acceptée."

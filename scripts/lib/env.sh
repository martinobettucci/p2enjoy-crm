#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — socle commun des scripts de lancement et d'environnement
# @spec docs/JOURNAL.md décision 16 (amorçage automatique des secrets, gardes de profil)
# @spec docs/DAT.md §13 (commandes de lancement) ; docs/PROD_MIGRATIONS.md §2.3
# @spec README.md §4 (installation), §5 (commandes principales), §9 (variables d'environnement)
#
# Bibliothèque partagée par `runDev.sh`, `runProd.sh`, `resetMe.sh` et
# `scripts/verify-scripts.sh`. Elle n'exécute rien à l'inclusion : elle ne définit que des
# fonctions.
#
# Le fichier d'environnement visé est `.env` à la racine du dépôt, ou le chemin indiqué par la
# variable `P2ENJOY_ENV_FILE` — ce qui permet aux preuves de travailler sur un fichier jetable
# sans jamais toucher au `.env` du poste.

set -euo pipefail

# --- Chemins -----------------------------------------------------------------------------------

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ENV_FILE="${P2ENJOY_ENV_FILE:-$REPO_ROOT/.env}"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

DEV_COMPOSE=(-f "$REPO_ROOT/docker-compose.yml" -f "$REPO_ROOT/docker-compose.dev.yml")
PROD_COMPOSE=(-f "$REPO_ROOT/docker-compose.yml" -f "$REPO_ROOT/docker-compose.prod.yml")

# --- Affichage ---------------------------------------------------------------------------------

# Aide en ligne : le bloc de commentaires de tête du script est la seule source, de sorte que
# l'aide ne puisse pas diverger de la documentation du fichier. Les lignes de traçabilité en
# sont retirées, et la lecture s'arrête à la première ligne qui n'est pas un commentaire.
print_header_help() {
	awk 'NR == 1 { next }
	     /^#/ {
	        line = substr($0, 2)
	        sub(/^ /, "", line)
	        if (line ~ /^@(spec|verifies)/) next
	        print line
	        next
	     }
	     { exit }' "$1"
}

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33mAVERTISSEMENT\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31mERREUR\033[0m %s\n' "$*" >&2; exit 1; }

# --- Lecture d'un fichier d'environnement ------------------------------------------------------
# Un fichier d'environnement n'est pas un script : il n'est jamais interprété par le shell, ce
# qui casserait sur toute valeur contenant un espace ou un caractère spécial.

# Noms de variables déclarés dans un fichier, dans l'ordre d'apparition.
env_names() {
	sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1"
}

# Valeur d'une variable, guillemets encadrants retirés. Chaîne vide si absente ou vide.
env_get() {
	sed -n "s/^$2=//p" "$1" | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Vrai si la variable est déclarée, même vide.
env_has() {
	grep -q "^$2=" "$1"
}

# Remplace la valeur d'une variable déjà déclarée, sur place.
env_set() {
	local file=$1 name=$2 value=$3
	env_has "$file" "$name" || die "variable '$name' absente de $file : remplacement impossible."
	# La valeur passe par awk plutôt que par sed : elle peut contenir des barres obliques.
	awk -v name="$name" -v value="$value" \
		'BEGIN { FS = "="; OFS = "=" }
		 $0 ~ "^" name "=" { print name "=" value; next }
		 { print }' "$file" > "$file.tmp"
	# Le contenu est recopié dans le fichier d'origine plutôt que substitué par `mv` : un
	# renommage remplacerait l'inode, et le fichier perdrait ses droits restreints.
	cat "$file.tmp" > "$file"
	rm -f "$file.tmp"
}

# --- Fabrication des secrets -------------------------------------------------------------------
# Hexadécimal uniquement : aucune valeur produite ne contient d'espace, de guillemet ou de
# caractère d'échappement, donc aucune ne peut casser la lecture d'un fichier d'environnement.

gen_hex() { openssl rand -hex "$1"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Jeton HS256 au format attendu par GoTrue, PostgREST et Kong.
#   jwt_hs256 <secret> <rôle>
jwt_hs256() {
	local secret=$1 role=$2 iat exp header payload signing signature
	iat=$(date +%s)
	exp=$((iat + 10 * 365 * 24 * 3600))
	header='{"alg":"HS256","typ":"JWT"}'
	payload="{\"iss\":\"supabase\",\"role\":\"$role\",\"iat\":$iat,\"exp\":$exp}"
	signing="$(printf '%s' "$header" | b64url).$(printf '%s' "$payload" | b64url)"
	signature=$(printf '%s' "$signing" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
	printf '%s.%s' "$signing" "$signature"
}

# --- Amorçage ----------------------------------------------------------------------------------

# Descripteurs de fichiers réellement accordés par l'hôte. Realtime et le pooler redémarrent en
# boucle si la valeur demandée dépasse la limite dure (docs/JOURNAL.md décision 14).
host_nofile_limit() {
	local hard
	hard=$(ulimit -Hn 2>/dev/null || echo unlimited)
	[ "$hard" = unlimited ] && hard=1048576
	printf '%s' "$hard"
}

# Crée le fichier d'environnement de développement à partir du gabarit, en tirant au hasard
# chaque secret. N'écrase jamais un fichier existant.
env_bootstrap_dev() {
	[ -f "$ENV_EXAMPLE" ] || die "gabarit $ENV_EXAMPLE introuvable."
	if [ -f "$ENV_FILE" ]; then
		return 1
	fi

	say "Amorçage de $(basename "$ENV_FILE") depuis .env.example"
	cp "$ENV_EXAMPLE" "$ENV_FILE"
	chmod 600 "$ENV_FILE"

	local jwt_secret minio_user minio_password
	jwt_secret=$(gen_hex 32)
	minio_user="dev$(gen_hex 8)"
	minio_password=$(gen_hex 20)

	env_set "$ENV_FILE" P2ENJOY_ENV_PROFILE dev

	env_set "$ENV_FILE" POSTGRES_PASSWORD "$(gen_hex 24)"
	env_set "$ENV_FILE" JWT_SECRET "$jwt_secret"
	env_set "$ENV_FILE" ANON_KEY "$(jwt_hs256 "$jwt_secret" anon)"
	env_set "$ENV_FILE" SERVICE_ROLE_KEY "$(jwt_hs256 "$jwt_secret" service_role)"
	# Longueurs imposées par les composants : 64, 32 et 16 caractères exactement.
	env_set "$ENV_FILE" SECRET_KEY_BASE "$(gen_hex 32)"
	env_set "$ENV_FILE" VAULT_ENC_KEY "$(gen_hex 16)"
	env_set "$ENV_FILE" REALTIME_DB_ENC_KEY "$(gen_hex 8)"
	env_set "$ENV_FILE" PG_META_CRYPTO_KEY "$(gen_hex 16)"

	# Le stockage de développement vise MinIO : les accès S3 du service Storage sont donc ceux
	# de MinIO, et l'endpoint est local (docs/JOURNAL.md décision 13).
	env_set "$ENV_FILE" MINIO_ROOT_USER "$minio_user"
	env_set "$ENV_FILE" MINIO_ROOT_PASSWORD "$minio_password"
	env_set "$ENV_FILE" AWS_ACCESS_KEY_ID "$minio_user"
	env_set "$ENV_FILE" AWS_SECRET_ACCESS_KEY "$minio_password"
	env_set "$ENV_FILE" GLOBAL_S3_ENDPOINT "http://minio:9000"
	env_set "$ENV_FILE" GLOBAL_S3_PROTOCOL http
	env_set "$ENV_FILE" S3_PROTOCOL_ACCESS_KEY_ID "$(gen_hex 16)"
	env_set "$ENV_FILE" S3_PROTOCOL_ACCESS_KEY_SECRET "$(gen_hex 32)"

	# Caddy n'appartient qu'à l'assemblage de production ; ces deux valeurs ne sont là que pour
	# qu'aucun `CHANGE_ME_` ne subsiste. Passer en production impose de les remplacer.
	env_set "$ENV_FILE" APP_DOMAIN localhost
	env_set "$ENV_FILE" CADDY_ACME_EMAIL "dev@localhost"

	local wanted hard
	wanted=$(env_get "$ENV_FILE" STACK_RLIMIT_NOFILE)
	hard=$(host_nofile_limit)
	if [ "$hard" -lt "$wanted" ]; then
		env_set "$ENV_FILE" STACK_RLIMIT_NOFILE "$hard"
		warn "STACK_RLIMIT_NOFILE abaissé de $wanted à $hard : limite dure de cet hôte."
		warn "Sans cela, Realtime et le pooler redémarreraient en boucle (README.md §11)."
	fi

	info "Secrets tirés au hasard : aucun n'est repris du dépôt."
	info "Fichier créé en mode 600. Il n'est pas versionné."
	return 0
}

# --- Validation ---------------------------------------------------------------------------------
# Le gabarit est le contrat : toute variable qu'il déclare doit exister dans le fichier
# d'environnement, et toute variable dont l'exemple est non vide doit y être renseignée.

env_validate() {
	[ -f "$ENV_FILE" ] || die "fichier d'environnement $ENV_FILE absent. Lancez ./runDev.sh, ou copiez .env.example."
	[ -f "$ENV_EXAMPLE" ] || die "gabarit $ENV_EXAMPLE introuvable."

	local problems=0 name example_value actual_value
	while IFS= read -r name; do
		if ! env_has "$ENV_FILE" "$name"; then
			printf '\033[31m  manquante\033[0m %s\n' "$name" >&2
			problems=$((problems + 1))
			continue
		fi
		example_value=$(env_get "$ENV_EXAMPLE" "$name")
		actual_value=$(env_get "$ENV_FILE" "$name")
		if [ -n "$example_value" ] && [ -z "$actual_value" ]; then
			printf '\033[31m  vide\033[0m      %s (obligatoire)\n' "$name" >&2
			problems=$((problems + 1))
		fi
		case "$actual_value" in
			CHANGE_ME_*)
				printf '\033[31m  à définir\033[0m %s vaut encore « %s »\n' "$name" "$actual_value" >&2
				problems=$((problems + 1))
				;;
		esac
	done < <(env_names "$ENV_EXAMPLE")

	if [ "$problems" -gt 0 ]; then
		die "$problems variable(s) à corriger dans $ENV_FILE. Le contrat est .env.example."
	fi
}

# Impose le profil attendu. C'est la garde qui empêche de démarrer la production avec les
# secrets de développement, et d'effacer une base de production par mégarde.
env_require_profile() {
	local expected=$1 actual
	actual=$(env_get "$ENV_FILE" P2ENJOY_ENV_PROFILE)
	if [ "$actual" != "$expected" ]; then
		die "P2ENJOY_ENV_PROFILE vaut « ${actual:-<vide>} », or cette commande exige « $expected ».
        $ENV_FILE décrit un autre environnement : refus d'agir dessus."
	fi
}

# --- Docker ------------------------------------------------------------------------------------

require_docker() {
	command -v docker >/dev/null 2>&1 || die "Docker est introuvable (README.md §3)."
	docker info >/dev/null 2>&1 || die "le démon Docker ne répond pas. Démarrez-le, puis relancez."
	docker compose version >/dev/null 2>&1 || die "le greffon Docker Compose v2 est absent."
}

compose_dev()  { docker compose --env-file "$ENV_FILE" "${DEV_COMPOSE[@]}" "$@"; }
compose_prod() { docker compose --env-file "$ENV_FILE" "${PROD_COMPOSE[@]}" "$@"; }

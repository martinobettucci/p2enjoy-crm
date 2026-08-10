#!/usr/bin/env bash
# @verifies CRM-001 (docs/BACKLOG.md) — Definition of Done de la pile Supabase self-hosted
# @verifies CRM-016 (docs/BACKLOG.md), docs/SPEC-edge-functions.md §2, §5, §7.2
# @verifies docs/DAT.md §3 (composants), §3.6 (composants de développement uniquement), §9
# @verifies README.md §6 (services exposés en développement)
#
# Rejoue les quatre preuves exigées par la Definition of Done de `CRM-001` :
#
#   1. tous les services de l'assemblage de développement sont sains ;
#   2. Kong répond, et applique bien l'authentification par clé d'API ;
#   3. Studio est accessible en développement ;
#   4. aucun service de développement n'est présent dans l'assemblage de production.
#
# Le script échoue au premier écart, avec un message nommant le service en cause. Il ne
# démarre ni n'arrête rien : la pile doit déjà tourner (`docker compose ... up -d`).
#
# Usage :
#   scripts/verify-stack.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example," >&2
	echo "        où chaque variable est documentée." >&2
	exit 1
fi

# Lecture des variables sans interprétation : un fichier d'environnement n'est pas un script,
# et le faire exécuter par le shell casse sur toute valeur contenant un espace.
env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

require_env() {
	local name value
	name=$1
	value=$(env_value "$name")
	if [ -z "$value" ]; then
		echo "ERREUR : variable '$name' absente ou vide dans .env." >&2
		exit 1
	fi
	printf '%s' "$value"
}

KONG_HTTP_PORT=$(require_env KONG_HTTP_PORT)
STUDIO_PORT=$(require_env STUDIO_PORT)
ANON_KEY=$(require_env ANON_KEY)
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)

DEV_COMPOSE=(-f docker-compose.yml -f docker-compose.dev.yml)
PROD_COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml)

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

# --- 1. Santé des services de l'assemblage de développement ------------------------------------
# Services de longue durée porteurs d'un healthcheck : doivent être `running` ET `healthy`.
LONG_RUNNING_HEALTHY="p2enjoy-db p2enjoy-auth-templates p2enjoy-auth p2enjoy-rest realtime-dev.p2enjoy-realtime \
p2enjoy-storage p2enjoy-functions p2enjoy-pooler p2enjoy-kong p2enjoy-studio p2enjoy-meta p2enjoy-minio \
p2enjoy-inbucket p2enjoy-webapp p2enjoy-stalwart p2enjoy-roundcube p2enjoy-clamav"
# Conteneurs éphémères : doivent s'être terminés avec le code 0.
ONE_SHOT="p2enjoy-migrations p2enjoy-minio-createbucket p2enjoy-stalwart-init"

echo "1. Santé des services (assemblage de développement)"

for container in $LONG_RUNNING_HEALTHY; do
	status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo absent)
	health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sans-sonde{{end}}' \
		"$container" 2>/dev/null || echo absent)
	if [ "$status" = running ] && [ "$health" = healthy ]; then
		ok "$container : running / healthy"
	else
		fail "$container : status=$status health=$health (attendu running/healthy)"
	fi
done

for container in $ONE_SHOT; do
	status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo absent)
	code=$(docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || echo -1)
	if [ "$status" = exited ] && [ "$code" = 0 ]; then
		ok "$container : terminé avec le code 0"
	else
		fail "$container : status=$status code=$code (attendu exited/0)"
	fi
done

# --- 2. Kong répond et applique l'authentification par clé d'API -------------------------------
echo
echo "2. Passerelle Kong (http://127.0.0.1:${KONG_HTTP_PORT})"

KONG_URL="http://127.0.0.1:${KONG_HTTP_PORT}"

# Sans clé d'API, la passerelle doit refuser : c'est la preuve qu'elle filtre réellement.
code=$(curl -s -o /dev/null -w '%{http_code}' "$KONG_URL/rest/v1/" || echo 000)
if [ "$code" = 401 ]; then
	ok "REST sans clé d'API : refusé ($code)"
else
	fail "REST sans clé d'API : $code (attendu 401)"
fi

# Avec la clé de service, PostgREST répond son document OpenAPI.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${SERVICE_ROLE_KEY}" \
	-H "Authorization: Bearer ${SERVICE_ROLE_KEY}" "$KONG_URL/rest/v1/" || echo 000)
if [ "$code" = 200 ]; then
	ok "REST avec clé de service : $code"
else
	fail "REST avec clé de service : $code (attendu 200)"
fi

# La clé anonyme ne doit pas atteindre la racine OpenAPI, réservée au rôle de service.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${ANON_KEY}" \
	-H "Authorization: Bearer ${ANON_KEY}" "$KONG_URL/rest/v1/" || echo 000)
if [ "$code" = 403 ]; then
	ok "REST racine OpenAPI avec clé anonyme : refusé ($code)"
else
	fail "REST racine OpenAPI avec clé anonyme : $code (attendu 403)"
fi

# GoTrue est joignable au travers de la passerelle.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${ANON_KEY}" \
	"$KONG_URL/auth/v1/health" || echo 000)
if [ "$code" = 200 ]; then
	ok "Auth /health au travers de Kong : $code"
else
	fail "Auth /health au travers de Kong : $code (attendu 200)"
fi

# Storage est joignable au travers de la passerelle.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${SERVICE_ROLE_KEY}" \
	-H "Authorization: Bearer ${SERVICE_ROLE_KEY}" "$KONG_URL/storage/v1/bucket" || echo 000)
if [ "$code" = 200 ]; then
	ok "Storage /bucket au travers de Kong : $code"
else
	fail "Storage /bucket au travers de Kong : $code (attendu 200)"
fi

# La nouvelle route est réellement soumise à key-auth : sans clé, elle ne doit jamais atteindre
# le runtime, même si la fonction elle-même est publique derrière la clé anonyme.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$KONG_URL/functions/v1/example" || echo 000)
if [ "$code" = 401 ]; then
	ok "Functions /example sans clé d'API : refusé ($code)"
else
	fail "Functions /example sans clé d'API : $code (attendu 401)"
fi

function_body=$(mktemp)
trap 'rm -f "$function_body"' EXIT
code=$(curl -s -o "$function_body" -w '%{http_code}' -X POST \
	-H "apikey: ${ANON_KEY}" "$KONG_URL/functions/v1/example" || echo 000)
expected_function='{"function":"example","runtime":"edge-runtime","message":"Fonction edge opérationnelle"}'
if [ "$code" = 200 ] && [ "$(cat "$function_body")" = "$expected_function" ]; then
	ok "Functions /example avec clé anonyme : vrai worker et JSON exact"
else
	fail "Functions /example : statut=$code ou corps inattendu"
fi

revision=$(docker inspect -f '{{index .Config.Labels "com.p2enjoy.kong-config-revision"}}' \
	p2enjoy-kong 2>/dev/null || true)
if [ "$revision" = crm-016 ]; then
	ok "Kong exécute la révision déclarative crm-016"
else
	fail "révision Kong active : '$revision' (attendu crm-016)"
fi

# --- 3. Studio accessible en développement -----------------------------------------------------
echo
echo "3. Supabase Studio (http://127.0.0.1:${STUDIO_PORT})"

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${STUDIO_PORT}/api/platform/profile" || echo 000)
if [ "$code" = 200 ]; then
	ok "Studio répond : $code"
else
	fail "Studio répond : $code (attendu 200)"
fi

# Studio ne doit pas être atteignable au travers de la passerelle : la configuration
# déclarative de Kong ne connaît aucun service de développement.
code=$(curl -s -o /dev/null -w '%{http_code}' "$KONG_URL/" || echo 000)
if [ "$code" = 404 ]; then
	ok "Studio non exposé par Kong : $code"
else
	fail "Studio non exposé par Kong : $code (attendu 404)"
fi

# --- 4. Aucun service de développement dans l'assemblage de production -------------------------
echo
echo "4. Assemblage de production"

prod_services=$(docker compose "${PROD_COMPOSE[@]}" config --services | sort)
if echo "$prod_services" | grep -qx functions; then
	ok "service commun 'functions' présent en production"
else
	fail "service commun 'functions' absent de l'assemblage de production"
fi
for dev_only in studio meta minio minio-createbucket inbucket webapp stalwart stalwart-init roundcube clamav; do
	if echo "$prod_services" | grep -qx "$dev_only"; then
		fail "service de développement '$dev_only' présent en production"
	else
		ok "service de développement '$dev_only' absent de la production"
	fi
done

# Seul Caddy publie des ports en production.
published=$(docker compose "${PROD_COMPOSE[@]}" config --format json \
	| tr -d ' \n' | grep -o '"published":"[0-9]*"' | sort -u | tr '\n' ' ')
if [ "$published" = '"published":"443" "published":"80" ' ] || \
   [ "$published" = '"published":"80" "published":"443" ' ]; then
	ok "ports publiés en production : 80 et 443 uniquement"
else
	fail "ports publiés en production : $published (attendus 80 et 443 uniquement)"
fi

# L'assemblage de développement, lui, doit bien déclarer l'outillage.
dev_services=$(docker compose "${DEV_COMPOSE[@]}" config --services | sort)
for dev_only in studio meta minio minio-createbucket inbucket webapp stalwart stalwart-init roundcube clamav; do
	if echo "$dev_services" | grep -qx "$dev_only"; then
		ok "service de développement '$dev_only' présent en développement"
	else
		fail "service de développement '$dev_only' absent de l'assemblage de développement"
	fi
done

# --- 5. Chaîne de stockage : Storage écrit réellement dans MinIO -------------------------------
# Preuve que `STORAGE_BACKEND=s3` vise bien l'équivalent local et non un repli sur disque : un
# objet déposé par l'API doit se retrouver dans le bucket MinIO, puis être relu à l'identique.
echo
echo "5. Chaîne de stockage S3 (Storage -> MinIO)"

GLOBAL_S3_BUCKET=$(require_env GLOBAL_S3_BUCKET)
MINIO_ROOT_USER=$(require_env MINIO_ROOT_USER)
MINIO_ROOT_PASSWORD=$(require_env MINIO_ROOT_PASSWORD)

probe_bucket=verify-stack
probe_body="preuve $(date -u +%Y-%m-%dT%H:%M:%SZ) — chaine de stockage S3"
auth=(-H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}")

curl -s -o /dev/null -X POST "$KONG_URL/storage/v1/bucket" "${auth[@]}" \
	-H 'Content-Type: application/json' \
	-d "{\"id\":\"$probe_bucket\",\"name\":\"$probe_bucket\",\"public\":false}" || true
curl -s -o /dev/null -X DELETE "$KONG_URL/storage/v1/object/$probe_bucket/sonde.txt" "${auth[@]}" || true

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
	"$KONG_URL/storage/v1/object/$probe_bucket/sonde.txt" "${auth[@]}" \
	-H 'Content-Type: text/plain' --data-binary "$probe_body" || echo 000)
if [ "$code" = 200 ]; then
	ok "dépôt d'un objet par l'API Storage : $code"
else
	fail "dépôt d'un objet par l'API Storage : $code (attendu 200)"
fi

read_back=$(curl -s "$KONG_URL/storage/v1/object/authenticated/$probe_bucket/sonde.txt" "${auth[@]}" || true)
if [ "$read_back" = "$probe_body" ]; then
	ok "relecture de l'objet : contenu identique"
else
	fail "relecture de l'objet : contenu différent de celui déposé"
fi

# L'octet doit exister côté MinIO, sous le préfixe du tenant de stockage. Le filtrage se fait
# ici et non dans le conteneur : l'image du client MinIO ne contient que `mc`, pas `grep`.
minio_listing=$(docker run --rm --network "${COMPOSE_NETWORK:-p2enjoy-crm_default}" \
	--entrypoint sh minio/mc:RELEASE.2025-04-16T18-13-26Z -ec \
	"mc alias set probe http://minio:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
	 && mc ls --recursive probe/$GLOBAL_S3_BUCKET/" 2>/dev/null || true)
if printf '%s' "$minio_listing" | grep -q "$probe_bucket/sonde.txt"; then
	ok "objet présent dans le bucket MinIO '$GLOBAL_S3_BUCKET'"
else
	fail "objet absent du bucket MinIO '$GLOBAL_S3_BUCKET' (le stockage ne vise pas MinIO)"
fi

curl -s -o /dev/null -X DELETE "$KONG_URL/storage/v1/object/$probe_bucket/sonde.txt" "${auth[@]}" || true
curl -s -o /dev/null -X DELETE "$KONG_URL/storage/v1/bucket/$probe_bucket" "${auth[@]}" || true

# --- Bilan -------------------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

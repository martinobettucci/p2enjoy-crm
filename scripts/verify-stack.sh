#!/usr/bin/env bash
# @verifies CRM-001 (docs/BACKLOG.md) — Definition of Done de la pile Supabase self-hosted
# @verifies CRM-016 (docs/BACKLOG.md), docs/SPEC-edge-functions.md §2, §5, §7.2
# @verifies docs/DAT.md §3 (composants), §3.6 (composants de développement uniquement), §9
# @verifies README.md §6 (services exposés en développement)
# @verifies docs/INCONSISTENCY_REPORT.md INC-290, docs/JOURNAL.md décision 681 — le client MinIO de la sonde est l'image du service `minio`, Chainguard épinglé par empreinte
# @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §2, §13 — tranche T6 : GoTrue, ses
#           gabarits et Inbucket sont absents des deux assemblages, et `/auth/v1/*` rend 404
# @verifies CRM-001, docs/DAT.md §3.5 bis, INC-299 (décision 696) — section 6 : Kong et Caddy ferment une connexion amont
#           inactive avant leur amont
#
# Rejoue les quatre preuves exigées par la Definition of Done de `CRM-001` (1 à 4), et deux de plus (5, 6) :
#
#   1. tous les services de l'assemblage de développement sont sains ;
#   2. Kong répond, et applique bien l'authentification par clé d'API ;
#   3. Studio est accessible en développement ;
#   4. aucun service de développement n'est présent dans l'assemblage de production ;
#   5. (au-delà de la DoD) Storage écrit réellement dans MinIO ;
#   6. chaque relais — Kong, Caddy — ferme une connexion amont inactive avant son amont (INC-299, décision 696).
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
# `CRM-092` T6 : `p2enjoy-auth`, `p2enjoy-auth-templates` et `p2enjoy-inbucket` ne sont plus de la pile.
LONG_RUNNING_HEALTHY="p2enjoy-db p2enjoy-rest realtime-dev.p2enjoy-realtime \
p2enjoy-storage p2enjoy-functions p2enjoy-kong p2enjoy-studio p2enjoy-meta p2enjoy-minio \
p2enjoy-webapp p2enjoy-stalwart p2enjoy-roundcube p2enjoy-clamav"
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

# RÉVISÉ par `CRM-092` T6 (docs/SPEC-session-sso.md §13, décision 589) : GoTrue est retiré, et la
# passerelle n'a plus aucune route vers lui. `/auth/v1/health` doit rendre 404 — un 200 dirait qu'un
# service d'authentification répond encore à côté du SSO.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${ANON_KEY}" \
	"$KONG_URL/auth/v1/health" || echo 000)
if [ "$code" = 404 ]; then
	ok "Auth /health au travers de Kong : $code — GoTrue retiré, aucune route"
else
	fail "Auth /health au travers de Kong : $code (attendu 404 : GoTrue est retiré)"
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
if [ "$revision" = crm-092 ]; then
	ok "Kong exécute la révision déclarative crm-092"
else
	fail "révision Kong active : '$revision' (attendu crm-092)"
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
for dev_only in studio meta minio minio-createbucket webapp stalwart stalwart-init roundcube clamav; do
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

# `CRM-092` T6 : GoTrue, ses gabarits et Inbucket — son seul client — n'existent dans AUCUN assemblage.
for retire in auth auth-templates inbucket; do
	if echo "$prod_services" | grep -qx "$retire" || echo "$dev_services" | grep -qx "$retire"; then
		fail "service retiré '$retire' encore déclaré (CRM-092)"
	else
		ok "service retiré '$retire' absent des deux assemblages (CRM-092)"
	fi
done
for dev_only in studio meta minio minio-createbucket webapp stalwart stalwart-init roundcube clamav; do
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
# ici et non dans le conteneur. L'image est celle du service `minio`, lue dans le fichier Compose et jamais recopiée
# (décision 681) : elle porte `mc` et `/bin/sh`.
image_minio=$(awk '/^  minio:/{d=1} d && /^    image:/{print $2; exit}' docker-compose.dev.yml)
minio_listing=$(docker run --rm --network "${COMPOSE_NETWORK:-p2enjoy-crm_default}" \
	--entrypoint sh "$image_minio" -ec \
	"mc alias set probe http://minio:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
	 && mc ls --recursive probe/$GLOBAL_S3_BUCKET/" 2>/dev/null || true)
if printf '%s' "$minio_listing" | grep -q "$probe_bucket/sonde.txt"; then
	ok "objet présent dans le bucket MinIO '$GLOBAL_S3_BUCKET'"
else
	fail "objet absent du bucket MinIO '$GLOBAL_S3_BUCKET' (le stockage ne vise pas MinIO)"
fi

curl -s -o /dev/null -X DELETE "$KONG_URL/storage/v1/object/$probe_bucket/sonde.txt" "${auth[@]}" || true
curl -s -o /dev/null -X DELETE "$KONG_URL/storage/v1/bucket/$probe_bucket" "${auth[@]}" || true

# --- 6. Un relais ferme une connexion amont inactive avant son amont ------------------------------
# @verifies CRM-001 (docs/BACKLOG.md), docs/DAT.md §3.5 bis, INC-299 (décision 696) — Kong gardait 60 s une connexion
# que PostgREST ferme entre 30 et 60 s : une requête écrite à l'instant de la fermeture rendait `502`. Les délais sont
# lus dans les fichiers du dépôt et dans la configuration rendue de Kong, jamais recopiés ici.
echo
echo "6. Connexions maintenues : chaque relais ferme avant son amont"

reseau="${COMPOSE_NETWORK:-p2enjoy-crm_default}"
image_sonde=$(awk '/^FROM /{print $2; exit}' mail-sync/Dockerfile)
image_caddy=$(awk '/^  caddy:/{d=1} d && /^    image:/{print $2; exit}' docker-compose.prod.yml)
delai_declare=$(sed -n 's/^[[:space:]]*KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT:[[:space:]]*"\{0,1\}\([0-9]*\)"\{0,1\}[[:space:]]*$/\1/p' \
	docker-compose.yml)
delai_kong=$(docker exec p2enjoy-kong sed -n 's/^upstream_keepalive_idle_timeout = //p' /usr/local/kong/.kong_env \
	2>/dev/null || true)
delais_caddy=$(sed -n 's/^[[:space:]]*keepalive[[:space:]]*\([0-9]*\)s[[:space:]]*$/\1/p' caddy/routes.caddy | sort -u)
nb_proxies_caddy=$(grep -c 'reverse_proxy ' caddy/routes.caddy)
nb_keepalive_caddy=$(grep -c '^[[:space:]]*keepalive[[:space:]]' caddy/routes.caddy)

if [ -n "$delai_declare" ] && [ "$delai_kong" = "$delai_declare" ]; then
	ok "Kong applique le délai déclaré par docker-compose.yml : ${delai_kong} s"
else
	fail "délai de maintien de Kong : effectif '$delai_kong', déclaré '$delai_declare' (attendus égaux)"
fi
if [ "$nb_keepalive_caddy" = "$nb_proxies_caddy" ] && [ "$delais_caddy" = "$delai_declare" ]; then
	ok "Caddy : les $nb_proxies_caddy reverse_proxy de routes.caddy déclarent le même délai, ${delais_caddy} s"
else
	fail "Caddy : $nb_keepalive_caddy délai(s) pour $nb_proxies_caddy reverse_proxy, valeur(s) '$delais_caddy' (attendu '$delai_declare' partout)"
fi

# Amonts de Kong (lus dans kong.yml) et de Caddy (lus dans routes.caddy) : chacun doit garder une connexion inactive
# plus longtemps que le délai du relais augmenté d'une seconde.
amonts=$( { sed -n 's#^[[:space:]]*url: http://\([^/:]*\):\([0-9]*\)/.*#\1:\2#p' supabase/docker/volumes/api/kong.yml;
	sed -n 's/^[[:space:]]*reverse_proxy \([^ ]*\):\([0-9]*\) .*/\1:\2/p' caddy/routes.caddy; } | sort -u | tr '\n' ' ')
attente=$(( ${delai_declare:-0} + 1 ))
sonde_amonts=$(docker run --rm --network "$reseau" "$image_sonde" python -I -c '
import socket, sys, time, threading
attente = float(sys.argv[1]); res = {}
def sonde(cible):
    hote, port = cible.rsplit(":", 1)
    try:
        s = socket.create_connection((hote, int(port)), timeout=5)
        s.sendall(f"GET / HTTP/1.1\r\nHost: {hote}\r\n\r\n".encode()); d = b""
        while b"\r\n\r\n" not in d:
            x = s.recv(65536)
            if not x: raise OSError("fermée avant la réponse")
            d += x
        fin = time.monotonic() + attente
        while True:
            reste = fin - time.monotonic()
            if reste <= 0: res[cible] = "ouverte"; break
            s.settimeout(reste)
            try:
                if not s.recv(65536): res[cible] = "fermée après %.1f s" % (attente - reste); break
            except socket.timeout: res[cible] = "ouverte"; break
    except Exception as e: res[cible] = "erreur " + type(e).__name__
ts = [threading.Thread(target=sonde, args=(c,)) for c in sys.argv[2:]]
[t.start() for t in ts]; [t.join() for t in ts]
for c in sys.argv[2:]: print(c, res[c])
' "$attente" $amonts 2>&1 || true)
for cible in $amonts; do
	etat=$(printf '%s\n' "$sonde_amonts" | sed -n "s/^$cible //p")
	if [ "$etat" = ouverte ]; then
		ok "amont $cible : connexion inactive encore ouverte après ${attente} s"
	else
		fail "amont $cible : '${etat:-aucune mesure}' — le relais la garderait ${delai_declare} s, l'amont la ferme avant"
	fi
done

# Connexions établies d'un conteneur vers un hôte:port, lues dans /proc/net/tcp (adresse locale, triée).
connexions_vers() {
	local conteneur=$1 ip=$2 port=$3 hex
	hex=$(printf '%02X%02X%02X%02X:%04X' $(echo "$ip" | awk -F. '{print $4, $3, $2, $1}') "$port")
	docker exec "$conteneur" cat /proc/net/tcp 2>/dev/null | awk -v r="$hex" '$3 == r && $4 == "01" {print $2}' | sort
}

# Kong : des requêtes passées par la passerelle laissent des connexions vers `rest` ; délai + 1 s plus tard, aucune
# n'existe encore. Avec le défaut de 60 s, les six de la mesure du 2026-10-25 étaient toutes là.
ip_rest=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' p2enjoy-rest)
for _ in 1 2 3 4 5 6; do
	curl -s -o /dev/null "${auth[@]}" "$KONG_URL/rest/v1/workspaces?select=id&limit=1" &
done
wait
avant=$(connexions_vers p2enjoy-kong "$ip_rest" 3000)
sleep "$attente"
apres=$(connexions_vers p2enjoy-kong "$ip_rest" 3000)
restees=$(comm -12 <(printf '%s\n' "$avant") <(printf '%s\n' "$apres") | grep -c . || true)
if [ -n "$avant" ] && [ "$restees" -eq 0 ]; then
	ok "Kong → rest : $(printf '%s\n' "$avant" | grep -c .) connexion(s) ouverte(s), aucune encore là ${attente} s plus tard"
else
	fail "Kong → rest : $(printf '%s\n' "$avant" | grep -c .) connexion(s) après les requêtes, $restees encore là ${attente} s plus tard"
fi

# Caddy : la configuration de production est acceptée, et un Caddy jetable monté sur la configuration de la cellule
# (`caddy/Caddyfile.spark`, sans TLS) relaie vers Kong puis a fermé sa connexion délai + 1 s plus tard.
for caddyfile in Caddyfile Caddyfile.spark; do
	if docker run --rm -e APP_DOMAIN=crm.invalid -e MCP_SITE= -e CADDY_ACME_EMAIL=sonde@crm.invalid \
		-v "$PWD/caddy:/etc/caddy:ro" "$image_caddy" caddy validate --adapter caddyfile \
		--config "/etc/caddy/$caddyfile" >/dev/null 2>&1; then
		ok "caddy validate accepte caddy/$caddyfile"
	else
		fail "caddy validate refuse caddy/$caddyfile"
	fi
done
sonde_caddy=p2enjoy-sonde-caddy-verify-stack
docker rm -f "$sonde_caddy" >/dev/null 2>&1 || true
if docker run -d --name "$sonde_caddy" --network "$reseau" -v "$PWD/caddy:/etc/caddy:ro" "$image_caddy" \
	caddy run --adapter caddyfile --config /etc/caddy/Caddyfile.spark >/dev/null 2>&1; then
	code=000
	for _ in $(seq 1 20); do
		code=$(docker exec "$sonde_caddy" wget -q -S -O /dev/null --header "apikey: ${SERVICE_ROLE_KEY}" \
			--header "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
			"http://127.0.0.1:8080/rest/v1/workspaces?select=id&limit=1" 2>&1 | awk '/HTTP\//{print $2; exit}')
		[ "${code:-000}" = 200 ] && break
		sleep 0.5
	done
	ip_kong=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' p2enjoy-kong)
	avant=$(connexions_vers "$sonde_caddy" "$ip_kong" 8000)
	sleep "$attente"
	apres=$(connexions_vers "$sonde_caddy" "$ip_kong" 8000)
	if [ "$code" = 200 ] && [ -n "$avant" ] && [ -z "$apres" ]; then
		ok "Caddy → Kong : relais 200, connexion fermée par Caddy ${attente} s plus tard"
	else
		fail "Caddy → Kong : relais '$code', $(printf '%s\n' "$avant" | grep -c .) connexion(s) puis $(printf '%s\n' "$apres" | grep -c .) ${attente} s plus tard (attendu 200, ≥ 1 puis 0)"
	fi
else
	fail "Caddy jetable : démarrage impossible sur caddy/Caddyfile.spark"
fi
docker rm -f "$sonde_caddy" >/dev/null 2>&1 || true

# --- Bilan -------------------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

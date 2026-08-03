#!/usr/bin/env bash
# @verifies CRM-002 (docs/BACKLOG.md) — Definition of Done des scripts de lancement et du gabarit
# @verifies docs/JOURNAL.md décision 15 (liste exhaustive des variables), décision 16 (gardes)
# @verifies docs/PROD_MIGRATIONS.md §2.3 ; README.md §4, §5, §9
#
# Rejoue les preuves de `CRM-002` :
#
#   1. `.env.example` est le contrat exact de l'assemblage, et il ne contient aucun secret ;
#   2. chaque variable y est documentée : rôle, format, caractère obligatoire ;
#   3. l'amorçage produit un environnement complet, avec des secrets tirés au hasard ;
#   4. les jetons dérivés sont réellement valides pour le secret produit ;
#   5. les gardes refusent ce qu'elles doivent refuser — profil, migrations, destruction.
#
# Aucune preuve ne touche au `.env` du poste : chaque scénario travaille sur un fichier jetable
# désigné par `P2ENJOY_ENV_FILE`.
#
# Usage :
#   scripts/verify-scripts.sh

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

ENV_EXAMPLE="$REPO_ROOT/.env.example"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
checks=0
skips=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
skip() { skips=$((skips + 1)); printf '  \033[33mIGNORE\033[0m %s\n' "$1"; }

env_names() { sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1"; }
env_get()   { sed -n "s/^$2=//p" "$1" | tail -n 1; }

# Variables déclarées par le gabarit sans être interpolées par les fichiers Compose. Chacune est
# justifiée ici : la liste est volontairement courte, et toute nouveauté doit y être ajoutée
# consciemment plutôt que tolérée en silence.
ALLOWED_ORPHANS="
P2ENJOY_ENV_PROFILE      garde de profil, lue par les scripts et non par Compose
CRM_INBOUND_DOMAIN       consommée à partir de CRM-051 (docs/PROD_MIGRATIONS.md §2.3)
MAIL_SYNC_POLL_INTERVAL  consommée à partir de CRM-054 (README.md §9)
MAIL_MAX_ATTACHMENT_MB   consommée à partir de CRM-054 (README.md §9)
"

# --- 1. Le gabarit est le contrat exact de l'assemblage ----------------------------------------

echo "1. .env.example contre les fichiers Compose"

compose_vars=$(grep -ohE '\$\{[A-Z0-9_]+' docker-compose.yml docker-compose.dev.yml \
	docker-compose.prod.yml | sed 's/^\${//' | sort -u)
example_vars=$(env_names "$ENV_EXAMPLE" | sort -u)

missing=$(comm -23 <(printf '%s\n' "$compose_vars") <(printf '%s\n' "$example_vars"))
if [ -z "$missing" ]; then
	ok "toutes les variables des fichiers Compose sont documentées ($(printf '%s\n' "$compose_vars" | wc -l))"
else
	fail "variables consommées par Compose et absentes du gabarit : $(echo "$missing" | tr '\n' ' ')"
fi

orphans=$(comm -13 <(printf '%s\n' "$compose_vars") <(printf '%s\n' "$example_vars"))
unexpected=""
for name in $orphans; do
	echo "$ALLOWED_ORPHANS" | grep -q "^$name " || unexpected="$unexpected $name"
done
if [ -z "$unexpected" ]; then
	ok "aucune variable orpheline non justifiée dans le gabarit"
else
	fail "variables du gabarit que rien ne consomme et qui ne sont pas justifiées :$unexpected"
fi

# --- 2. Aucun secret dans le dépôt, et chaque variable documentée ------------------------------

echo
echo "2. Contenu du gabarit"

SENSITIVE="POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE VAULT_ENC_KEY
REALTIME_DB_ENC_KEY PG_META_CRYPTO_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET MINIO_ROOT_USER MINIO_ROOT_PASSWORD"

not_placeholder=""
for name in $SENSITIVE; do
	case "$(env_get "$ENV_EXAMPLE" "$name")" in
		CHANGE_ME_*) ;;
		*) not_placeholder="$not_placeholder $name" ;;
	esac
done
if [ -z "$not_placeholder" ]; then
	ok "les $(echo $SENSITIVE | wc -w) variables sensibles valent toutes un marqueur CHANGE_ME_"
else
	fail "valeur non neutre dans le gabarit pour :$not_placeholder"
fi

# Chaque variable doit être précédée d'un commentaire disant son format et son caractère
# obligatoire : c'est l'exigence de CLAUDE.md §3 sur la documentation des variables.
undocumented=""
while IFS= read -r name; do
	block=$(awk -v target="$name" '
		/^[A-Za-z_][A-Za-z0-9_]*=/ {
			if (substr($0, 1, length(target) + 1) == target "=") { print buf; exit }
			buf = ""; next
		}
		/^#/ { buf = buf " " $0; next }
		/^$/ { next }
		{ buf = "" }
	' "$ENV_EXAMPLE")
	case "$block" in
		*"Format :"*"Requise :"*) ;;
		*) undocumented="$undocumented $name" ;;
	esac
done < <(env_names "$ENV_EXAMPLE")
if [ -z "$undocumented" ]; then
	ok "les $(env_names "$ENV_EXAMPLE" | wc -l) variables déclarent leur format et leur obligation"
else
	fail "variables sans commentaire « Format / Requise » :$undocumented"
fi

if git check-ignore -q .env; then
	ok ".env est ignoré par git : aucun secret ne peut être versionné par mégarde"
else
	fail ".env n'est PAS ignoré par git"
fi

# --- 3. Amorçage ------------------------------------------------------------------------------

echo
echo "3. Amorçage de l'environnement de développement"

BOOT1="$WORK/env.boot1"
if P2ENJOY_ENV_FILE="$BOOT1" ./runDev.sh --bootstrap >"$WORK/boot1.log" 2>&1; then
	ok "runDev.sh --bootstrap sur un dépôt sans .env : succès"
else
	fail "runDev.sh --bootstrap a échoué : $(tail -n 3 "$WORK/boot1.log" | tr '\n' ' ')"
fi

if [ -f "$BOOT1" ]; then
	remaining=$(grep -c '=CHANGE_ME_' "$BOOT1" || true)
	if [ "$remaining" = 0 ]; then
		ok "aucun marqueur CHANGE_ME_ ne subsiste dans le fichier amorcé"
	else
		fail "$remaining marqueur(s) CHANGE_ME_ subsistent dans le fichier amorcé"
	fi

	if [ "$(env_get "$BOOT1" P2ENJOY_ENV_PROFILE)" = dev ]; then
		ok "profil du fichier amorcé : dev"
	else
		fail "profil du fichier amorcé : $(env_get "$BOOT1" P2ENJOY_ENV_PROFILE) (attendu dev)"
	fi

	perms=$(stat -c '%a' "$BOOT1")
	if [ "$perms" = 600 ]; then
		ok "fichier amorcé en mode 600"
	else
		fail "fichier amorcé en mode $perms (attendu 600)"
	fi

	# Longueurs imposées par Realtime, le pooler et postgres-meta : une erreur ici se traduit
	# par un service qui refuse de démarrer.
	length_errors=""
	check_len() {
		local value
		value=$(env_get "$BOOT1" "$1")
		[ "${#value}" = "$2" ] || length_errors="$length_errors $1(${#value}≠$2)"
	}
	check_len SECRET_KEY_BASE 64
	check_len VAULT_ENC_KEY 32
	check_len REALTIME_DB_ENC_KEY 16
	check_len PG_META_CRYPTO_KEY 32
	if [ -z "$length_errors" ]; then
		ok "longueurs imposées respectées : SECRET_KEY_BASE 64, VAULT_ENC_KEY 32, REALTIME_DB_ENC_KEY 16, PG_META_CRYPTO_KEY 32"
	else
		fail "longueurs de secrets incorrectes :$length_errors"
	fi
else
	fail "aucun fichier produit par l'amorçage"
fi

# Les jetons doivent réellement valider contre le secret produit : c'est ce qui distingue une
# dérivation correcte d'une chaîne quelconque.
b64url_decode() {
	local data=$1
	case $(( ${#data} % 4 )) in 2) data="$data==" ;; 3) data="$data=" ;; esac
	printf '%s' "$data" | tr '_-' '/+' | openssl base64 -d -A 2>/dev/null
}
verify_jwt() {
	local token=$1 secret=$2 expected_role=$3 header payload signature expected
	header=${token%%.*}
	payload=${token#*.}; payload=${payload%%.*}
	signature=${token##*.}
	expected=$(printf '%s.%s' "$header" "$payload" \
		| openssl dgst -sha256 -hmac "$secret" -binary \
		| openssl base64 -A | tr '+/' '-_' | tr -d '=')
	[ "$signature" = "$expected" ] || return 1
	b64url_decode "$payload" | grep -q "\"role\":\"$expected_role\"" || return 2
	return 0
}

if [ -f "$BOOT1" ]; then
	secret=$(env_get "$BOOT1" JWT_SECRET)
	for pair in "ANON_KEY:anon" "SERVICE_ROLE_KEY:service_role"; do
		name=${pair%%:*}; role=${pair##*:}
		if verify_jwt "$(env_get "$BOOT1" "$name")" "$secret" "$role"; then
			ok "$name : JWT HS256 valide pour JWT_SECRET, rôle « $role »"
		else
			fail "$name : signature invalide ou rôle inattendu (attendu « $role »)"
		fi
	done
fi

# Un second amorçage doit produire d'autres secrets : aucune valeur n'est figée dans le dépôt.
BOOT2="$WORK/env.boot2"
P2ENJOY_ENV_FILE="$BOOT2" ./runDev.sh --bootstrap >/dev/null 2>&1 || true
if [ -f "$BOOT1" ] && [ -f "$BOOT2" ]; then
	if [ "$(env_get "$BOOT1" JWT_SECRET)" != "$(env_get "$BOOT2" JWT_SECRET)" ] \
	   && [ "$(env_get "$BOOT1" POSTGRES_PASSWORD)" != "$(env_get "$BOOT2" POSTGRES_PASSWORD)" ]; then
		ok "deux amorçages produisent des secrets différents"
	else
		fail "deux amorçages produisent les mêmes secrets"
	fi
fi

# Un fichier existant ne doit jamais être écrasé.
fingerprint_before=$(env_get "$BOOT1" JWT_SECRET)
P2ENJOY_ENV_FILE="$BOOT1" ./runDev.sh --bootstrap >/dev/null 2>&1 || true
if [ "$(env_get "$BOOT1" JWT_SECRET)" = "$fingerprint_before" ]; then
	ok "un fichier d'environnement existant n'est pas écrasé"
else
	fail "l'amorçage a écrasé un fichier existant"
fi

# --- 4. Validation contre le gabarit -----------------------------------------------------------

echo
echo "4. Refus d'un environnement incomplet"

BROKEN="$WORK/env.broken"
sed 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=/' "$BOOT1" > "$BROKEN"
if P2ENJOY_ENV_FILE="$BROKEN" ./runDev.sh --bootstrap >"$WORK/broken.log" 2>&1; then
	fail "runDev.sh accepte un environnement dont POSTGRES_PASSWORD est vide"
else
	ok "runDev.sh refuse un environnement dont une variable obligatoire est vide"
fi

TRUNCATED="$WORK/env.truncated"
grep -v '^KONG_HTTP_PORT=' "$BOOT1" > "$TRUNCATED"
if P2ENJOY_ENV_FILE="$TRUNCATED" ./runDev.sh --bootstrap >/dev/null 2>&1; then
	fail "runDev.sh accepte un environnement auquel il manque une variable"
else
	ok "runDev.sh refuse un environnement auquel il manque une variable du gabarit"
fi

PLACEHOLDER="$WORK/env.placeholder"
sed 's/^VAULT_ENC_KEY=.*/VAULT_ENC_KEY=CHANGE_ME_VAULT_ENC_KEY/' "$BOOT1" > "$PLACEHOLDER"
if P2ENJOY_ENV_FILE="$PLACEHOLDER" ./runDev.sh --bootstrap >/dev/null 2>&1; then
	fail "runDev.sh accepte un marqueur CHANGE_ME_ non remplacé"
else
	ok "runDev.sh refuse un marqueur CHANGE_ME_ non remplacé"
fi

# --- 5. Gardes de profil -----------------------------------------------------------------------

echo
echo "5. Gardes de profil et d'opération destructive"

AS_PROD="$WORK/env.prod"
sed -e 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=prod/' \
	-e 's/^APPLY_MIGRATIONS=.*/APPLY_MIGRATIONS=false/' "$BOOT1" > "$AS_PROD"

if P2ENJOY_ENV_FILE="$AS_PROD" ./runDev.sh --bootstrap >/dev/null 2>&1; then
	fail "runDev.sh accepte un environnement de profil prod"
else
	ok "runDev.sh refuse un environnement de profil prod"
fi

if P2ENJOY_ENV_FILE="$BOOT1" ./runProd.sh >"$WORK/prod-dev.log" 2>&1; then
	fail "runProd.sh accepte un environnement de profil dev"
else
	if grep -q "P2ENJOY_ENV_PROFILE" "$WORK/prod-dev.log"; then
		ok "runProd.sh refuse un environnement de profil dev, en nommant la garde"
	else
		fail "runProd.sh a refusé, mais sans nommer la garde de profil"
	fi
fi

AS_PROD_MIGRATE="$WORK/env.prod-migrate"
sed 's/^APPLY_MIGRATIONS=.*/APPLY_MIGRATIONS=true/' "$AS_PROD" > "$AS_PROD_MIGRATE"
if P2ENJOY_ENV_FILE="$AS_PROD_MIGRATE" ./runProd.sh >"$WORK/prod-migrate.log" 2>&1; then
	fail "runProd.sh accepte APPLY_MIGRATIONS=true"
else
	if grep -q "APPLY_MIGRATIONS" "$WORK/prod-migrate.log"; then
		ok "runProd.sh refuse APPLY_MIGRATIONS=true, en renvoyant au contrat de déploiement"
	else
		fail "runProd.sh a refusé, mais sans nommer APPLY_MIGRATIONS"
	fi
fi

if P2ENJOY_ENV_FILE="$WORK/env.inexistant" ./runProd.sh >/dev/null 2>&1; then
	fail "runProd.sh démarre sans fichier d'environnement"
else
	ok "runProd.sh refuse de démarrer sans fichier d'environnement, et n'en amorce aucun"
fi
if [ -f "$WORK/env.inexistant" ]; then
	fail "runProd.sh a amorcé un fichier d'environnement de production"
else
	ok "aucun fichier de production n'a été fabriqué par le script"
fi

if P2ENJOY_ENV_FILE="$AS_PROD" ./resetMe.sh --yes >"$WORK/reset-prod.log" 2>&1; then
	fail "resetMe.sh accepte de détruire un environnement de profil prod"
else
	ok "resetMe.sh refuse de détruire un environnement de profil prod"
fi

if P2ENJOY_ENV_FILE="$BOOT1" ./resetMe.sh </dev/null >"$WORK/reset-noconfirm.log" 2>&1; then
	fail "resetMe.sh détruit sans confirmation hors terminal interactif"
else
	ok "resetMe.sh exige --yes hors terminal interactif"
fi

# --- 6. Syntaxe et droits ----------------------------------------------------------------------

echo
echo "6. Scripts"

for script in runDev.sh runProd.sh resetMe.sh scripts/verify-stack.sh scripts/verify-scripts.sh scripts/lib/env.sh; do
	if [ -x "$script" ]; then
		ok "$script exécutable"
	else
		fail "$script n'est pas exécutable"
	fi
	if bash -n "$script" 2>/dev/null; then
		ok "$script : syntaxe valide"
	else
		fail "$script : erreur de syntaxe"
	fi
done

# --- 7. Le fichier amorcé satisfait réellement Compose ------------------------------------------

echo
echo "7. Interpolation des fichiers Compose"

if docker info >/dev/null 2>&1; then
	for overlay in dev prod; do
		env_for_overlay="$BOOT1"
		[ "$overlay" = prod ] && env_for_overlay="$AS_PROD"
		out=$(docker compose --env-file "$env_for_overlay" -f docker-compose.yml \
			-f "docker-compose.$overlay.yml" config 2>&1 >/dev/null)
		if [ -z "$out" ]; then
			ok "assemblage $overlay : aucune variable non résolue"
		else
			fail "assemblage $overlay : $(printf '%s' "$out" | head -n 2 | tr '\n' ' ')"
		fi
	done
else
	skip "interpolation Compose : le démon Docker ne répond pas"
	skip "interpolation Compose (production) : le démon Docker ne répond pas"
fi

# --- Bilan --------------------------------------------------------------------------------------

echo
if [ "$skips" -gt 0 ]; then
	echo "$skips vérification(s) non exécutée(s), faute de démon Docker."
fi
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

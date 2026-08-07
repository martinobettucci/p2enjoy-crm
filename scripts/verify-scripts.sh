#!/usr/bin/env bash
# @verifies CRM-002 (docs/BACKLOG.md) — Definition of Done des scripts de lancement et du gabarit
# @verifies docs/JOURNAL.md décision 15 (liste exhaustive des variables), décision 16 (gardes),
#           décision 251 (`MAIL_TEAM_DOMAIN` déclaré avant son consommateur CRM-051)
# @verifies docs/JOURNAL.md décisions 98 et 99 (gardes d'hôte : identifiants Docker, ports pris),
#           décision 247 (contexte de build sans secrets ni données locales), décision 272
#           (origine webapp joignable depuis les emails transactionnels)
# @verifies docs/DAT.md §3.8 (contraintes d'exécution de l'hôte)
# @verifies docs/PROD_MIGRATIONS.md §2.3 ; README.md §4, §5, §9, §11
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
CRM_INBOUND_DOMAIN       lue par les gardes de développement depuis CRM-050 (décision 245)
MAIL_TEAM_DOMAIN         réservée au routage des boîtes personnelles de CRM-051 (décision 251)
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

DOCKERIGNORE_REQUIS=(
	.git
	.env
	node_modules
	webapp/dist
	e2e/test-results
	supabase/docker/volumes
)
dockerignore_manquants=""
for chemin in "${DOCKERIGNORE_REQUIS[@]}"; do
	grep -Fxq "$chemin" .dockerignore 2>/dev/null \
		|| dockerignore_manquants="$dockerignore_manquants $chemin"
done
if [ -z "$dockerignore_manquants" ]; then
	ok ".dockerignore écarte secrets, métadonnées, dépendances, preuves et volumes locaux"
else
	fail ".dockerignore ne couvre pas :$dockerignore_manquants"
fi

if grep -Fxq '!.env.example' .dockerignore; then
	ok "le gabarit non sensible reste dans le contexte Docker"
else
	fail ".env.example est exclu avec les secrets au lieu d'être réinclus"
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

DOMAINE_DIVERGENT="$WORK/env.domaine-divergent"
sed 's/^CRM_INBOUND_DOMAIN=.*/CRM_INBOUND_DOMAIN=crm.exemple.tld/' "$BOOT1" > "$DOMAINE_DIVERGENT"
if P2ENJOY_ENV_FILE="$DOMAINE_DIVERGENT" ./runDev.sh --bootstrap >"$WORK/domaine-dev.log" 2>&1; then
	fail "runDev.sh accepte un domaine entrant différent de celui du seed"
elif grep -q 'CRM_INBOUND_DOMAIN.*crm.p2enjoy.test' "$WORK/domaine-dev.log"; then
	ok "runDev.sh refuse le mauvais domaine avant Docker et nomme la valeur du seed"
else
	fail "runDev.sh refuse le mauvais domaine sans expliquer la valeur attendue"
fi

if P2ENJOY_ENV_FILE="$DOMAINE_DIVERGENT" ./resetMe.sh --yes >"$WORK/domaine-reset.log" 2>&1; then
	fail "resetMe.sh accepte de détruire avec un domaine entrant incohérent"
elif grep -q 'CRM_INBOUND_DOMAIN.*crm.p2enjoy.test' "$WORK/domaine-reset.log"; then
	ok "resetMe.sh refuse le mauvais domaine avant toute destruction"
else
	fail "resetMe.sh refuse le mauvais domaine sans expliquer la valeur attendue"
fi

if P2ENJOY_ENV_FILE="$BOOT1" ./runDev.sh --bootstrap >"$WORK/origine-ok.log" 2>&1; then
	ok "runDev.sh accepte l'origine webapp qui correspond exactement au port publié"
else
	fail "runDev.sh refuse une origine webapp cohérente : $(tail -n 2 "$WORK/origine-ok.log" | tr '\n' ' ')"
fi

SITE_DIVERGENT="$WORK/env.site-divergent"
sed 's#^SITE_URL=.*#SITE_URL=http://127.0.0.1:5999#' "$BOOT1" > "$SITE_DIVERGENT"
if P2ENJOY_ENV_FILE="$SITE_DIVERGENT" ./runDev.sh --bootstrap >"$WORK/site-divergent.log" 2>&1; then
	fail "runDev.sh accepte SITE_URL sur un autre port que WEBAPP_DEV_PORT"
elif grep -q 'SITE_URL' "$WORK/site-divergent.log" \
	&& grep -q 'DEV_BIND_ADDRESS.*WEBAPP_DEV_PORT' "$WORK/site-divergent.log"; then
	ok "runDev.sh refuse un SITE_URL incohérent avant Docker et nomme les trois variables"
else
	fail "runDev.sh refuse SITE_URL sans expliquer l'origine attendue"
fi

REDIRECT_DIVERGENT="$WORK/env.redirect-divergent"
sed 's#^ADDITIONAL_REDIRECT_URLS=.*#ADDITIONAL_REDIRECT_URLS=http://127.0.0.1:5999#' \
	"$BOOT1" > "$REDIRECT_DIVERGENT"
if P2ENJOY_ENV_FILE="$REDIRECT_DIVERGENT" ./runDev.sh --bootstrap >"$WORK/redirect-divergent.log" 2>&1; then
	fail "runDev.sh accepte une origine absente de ADDITIONAL_REDIRECT_URLS"
elif grep -q 'ADDITIONAL_REDIRECT_URLS.*origine webapp' "$WORK/redirect-divergent.log"; then
	ok "runDev.sh refuse une redirection incohérente avant Docker et nomme sa correction"
else
	fail "runDev.sh refuse ADDITIONAL_REDIRECT_URLS sans expliquer l'origine attendue"
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

	if docker compose --env-file "$BOOT1" -f docker-compose.yml -f docker-compose.dev.yml \
		build webapp >"$WORK/build-webapp.log" 2>&1; then
		ok "l'image webapp se reconstruit avec un cluster PostgreSQL local fermé"
	else
		fail "la reconstruction réelle de webapp échoue"
		tail -n 12 "$WORK/build-webapp.log" | sed 's/^/        /'
	fi

	if docker image inspect p2enjoy-crm-webapp >/dev/null 2>&1 \
		&& docker run --rm --entrypoint sh p2enjoy-crm-webapp -c \
			'test ! -e /app/.env && test ! -e /app/.git && test ! -e /app/supabase/docker/volumes && test -f /app/.env.example'; then
		ok "l'image construite exclut .env, .git et les volumes, mais conserve le gabarit"
	else
		fail "l'image construite contient un chemin sensible ou a perdu .env.example"
	fi
else
	skip "interpolation Compose : le démon Docker ne répond pas"
	skip "interpolation Compose (production) : le démon Docker ne répond pas"
	skip "reconstruction et inspection réelles de l'image webapp : le démon Docker ne répond pas"
fi

# --- 8. Robustesse face à l'hôte ----------------------------------------------------------------
# Causes d'échec mesurées sur un poste WSL, invisibles dans le code du dépôt et pourtant
# suffisantes pour que `./runDev.sh` ne démarre jamais : un magasin d'identifiants Docker qui
# échoue en rafale, des ports déjà tenus par un autre projet du même poste, et un point de montage
# que le démon crée en `root` dans le dépôt de l'utilisateur.
# Voir docs/JOURNAL.md, décisions 98, 99 et 101.
#
# Deux gardes de la même famille sont prouvées ailleurs, faute de pouvoir l'être ici sans détruire
# ou sans démarrer : le contrôle de santé de `storage` par `scripts/verify-stack.sh`, qui exige la
# pile entière saine (décision 100), et la destruction du cluster PostgreSQL par conteneur jetable
# par un `./resetMe.sh --yes` réel.

echo
echo "8. Robustesse face à l'hôte"

# Rend la valeur de DOCKER_CONFIG après passage de la garde, sans jamais toucher à celle du poste.
#   derive <répertoire source> <répertoire dérivé>
derive() {
	(
		P2ENJOY_DOCKER_CONFIG_DIR=$2
		DOCKER_CONFIG=$1
		# shellcheck source=scripts/lib/env.sh
		. "$REPO_ROOT/scripts/lib/env.sh"
		docker_drop_windows_credential_helpers 2>/dev/null
		printf '%s' "$DOCKER_CONFIG"
	)
}

WIN_HOME="$WORK/docker-windows"
DERIVED="$WORK/docker-derived"
mkdir -p "$WIN_HOME/contexts/meta"
printf '%s\n' '{"auths":{},"credsStore":"desktop.exe","currentContext":"default"}' \
	> "$WIN_HOME/config.json"
echo repere > "$WIN_HOME/contexts/meta/repere.txt"

if [ "$(derive "$WIN_HOME" "$DERIVED")" = "$DERIVED" ]; then
	ok "assistant d'identifiants Windows : DOCKER_CONFIG dérivé vers une configuration propre"
else
	fail "assistant d'identifiants Windows : DOCKER_CONFIG laissé sur la configuration fautive"
fi

if [ -f "$DERIVED/config.json" ] && ! grep -q 'desktop.exe' "$DERIVED/config.json"; then
	ok "la configuration dérivée ne nomme plus aucun assistant .exe"
else
	fail "la configuration dérivée nomme encore un assistant .exe, ou n'existe pas"
fi

if [ -f "$DERIVED/config.json" ] && grep -q '"currentContext"' "$DERIVED/config.json"; then
	ok "la configuration dérivée conserve le contexte Docker du poste"
else
	fail "la configuration dérivée a perdu le contexte Docker du poste"
fi

if [ -r "$DERIVED/contexts/meta/repere.txt" ]; then
	ok "les fichiers voisins de la configuration d'origine restent joignables"
else
	fail "les fichiers voisins de la configuration d'origine ne sont plus joignables"
fi

if [ -f "$DERIVED/config.json" ] && [ "$(stat -c '%a' "$DERIVED/config.json")" = 600 ]; then
	ok "la configuration dérivée est écrite en mode 600"
else
	fail "la configuration dérivée n'est pas en mode 600"
fi

MIXED_HOME="$WORK/docker-mixed"
mkdir -p "$MIXED_HOME"
printf '%s\n' '{"credHelpers":{"reg.example":"desktop.exe","autre.example":"pass"}}' \
	> "$MIXED_HOME/config.json"
derive "$MIXED_HOME" "$WORK/docker-mixed-derived" >/dev/null
if grep -q '"autre.example"' "$WORK/docker-mixed-derived/config.json" 2>/dev/null \
   && ! grep -q 'desktop.exe' "$WORK/docker-mixed-derived/config.json" 2>/dev/null; then
	ok "seuls les assistants .exe sont retirés : un assistant natif est conservé"
else
	fail "le tri des assistants d'identifiants est faux"
fi

CLEAN_HOME="$WORK/docker-clean"
mkdir -p "$CLEAN_HOME"
printf '%s\n' '{"auths":{},"credsStore":"pass"}' > "$CLEAN_HOME/config.json"
if [ "$(derive "$CLEAN_HOME" "$WORK/docker-clean-derived")" = "$CLEAN_HOME" ] \
   && [ ! -e "$WORK/docker-clean-derived" ]; then
	ok "configuration Docker saine : aucune dérivation, aucun répertoire créé"
else
	fail "une configuration Docker saine a tout de même été détournée"
fi

# Le contrôle des ports est éprouvé sur des observations injectées : l'écoute de l'hôte et la
# table des ports publiés sont remplacées par des valeurs connues, de sorte que le verdict soit
# reproductible et qu'aucune pile ne soit démarrée par la preuve.
#   port_verdict <ports en écoute> <table port détenteur> [port ignoré...]
# Les deux variables portent un préfixe : `require_free_ports` déclare `listening` et `published`
# en `local`, et le nommage dynamique de bash les masquerait à l'intérieur des doublures.
port_verdict() {
	local fixture_listening=$1 fixture_published=$2
	shift 2
	(
		# shellcheck source=scripts/lib/env.sh
		. "$REPO_ROOT/scripts/lib/env.sh"
		ENV_FILE="$BOOT1"
		host_listening_ports()  { printf '%s\n' "$fixture_listening"; }
		docker_published_ports() { printf '%s\n' "$fixture_published"; }
		compose_fixture() {
			case "$1" in
				config) printf '        published: "%s"\n' 54322 5173 ;;
				ps)     printf 'p2enjoy-db\n' ;;
			esac
		}
		require_free_ports compose_fixture "$@" 2>&1
	)
}

if verdict=$(port_verdict '54322' '54322 supabase_db_autre_projet'); then
	fail "un port tenu par un conteneur étranger n'arrête pas le démarrage"
else
	if printf '%s' "$verdict" | grep -q 'POSTGRES_DIRECT_PORT' \
	   && printf '%s' "$verdict" | grep -q 'supabase_db_autre_projet'; then
		ok "port pris par un tiers : refus, en nommant la variable et le détenteur"
	else
		fail "port pris par un tiers : refus, mais sans nommer la variable ou le détenteur"
	fi
fi

if verdict=$(port_verdict '5173' ''); then
	fail "un port tenu par un programme hors Docker n'arrête pas le démarrage"
else
	printf '%s' "$verdict" | grep -q 'WEBAPP_DEV_PORT' \
		&& ok "port pris hors Docker : refus, en nommant la variable" \
		|| fail "port pris hors Docker : refus, mais sans nommer la variable"
fi

if port_verdict '54322' '54322 p2enjoy-db' >/dev/null; then
	ok "port tenu par la pile elle-même : relancer reste permis"
else
	fail "un port tenu par la pile elle-même bloque son propre redémarrage"
fi

if port_verdict '5173' '' 5173 >/dev/null; then
	ok "port explicitement écarté — cas de runDev.sh --dev — : démarrage permis"
else
	fail "runDev.sh --dev serait refusé à cause du port laissé au Vite de l'IDE"
fi

if port_verdict '' '' >/dev/null; then
	ok "aucun port en écoute : aucun refus"
else
	fail "un hôte sans port en écoute est tout de même refusé"
fi

if ( . "$REPO_ROOT/scripts/lib/env.sh"
     REPO_ROOT="$WORK/faux-depot"
     mkdir -p "$REPO_ROOT"
     ensure_host_mountpoints
     [ -d "$WORK/faux-depot/node_modules" ] ); then
	ok "le point de montage node_modules est créé avant Compose, donc par l'utilisateur"
else
	fail "node_modules n'est pas créé avant Compose : le démon le créerait en root"
fi

# La liste réelle des ports de l'hôte n'est pas simulable : elle est éprouvée contre un port dont
# Docker affirme par ailleurs qu'il est publié.
if docker info >/dev/null 2>&1; then
	# shellcheck source=scripts/lib/env.sh
	( . "$REPO_ROOT/scripts/lib/env.sh"
	  reference=$(docker_published_ports | awk 'NR == 1 { print $1 }')
	  [ -n "$reference" ] || exit 2
	  host_listening_ports | grep -qx "$reference" )
	case $? in
		0) ok "les ports réellement en écoute sont bien vus par la garde" ;;
		2) skip "aucun conteneur ne publie de port : lecture réelle non éprouvée" ;;
		*) fail "un port publié par un conteneur n'apparaît pas dans les ports en écoute" ;;
	esac
else
	skip "lecture réelle des ports de l'hôte : le démon Docker ne répond pas"
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

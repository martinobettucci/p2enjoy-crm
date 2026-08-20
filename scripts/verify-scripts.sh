#!/usr/bin/env bash
# @verifies CRM-002 (docs/BACKLOG.md) — Definition of Done des scripts de lancement et du gabarit
# @verifies CRM-015 (docs/BACKLOG.md) — secret BuildKit npm_ca facultatif et sans fuite
# @verifies CRM-017 (docs/BACKLOG.md) — rôle propriétaire explicite des migrations d'extension
# @verifies docs/JOURNAL.md décision 15 (liste exhaustive des variables), décision 16 (gardes),
#           décision 251 (`MAIL_TEAM_DOMAIN` déclaré avant son consommateur CRM-051)
# @verifies docs/JOURNAL.md décisions 98 et 99 (gardes d'hôte : identifiants Docker, ports pris),
#           décision 257 (lecture de secours des ports par /proc, ouverte et fermée),
#           décision 247 (contexte de build sans secrets ni données locales), décision 272
#           (origine webapp joignable depuis les emails transactionnels), décision 280
#           (chemin PEM effectif, ancien `.env`, deux branches de build et absence dans l'image)
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

# @spec CRM-001, CRM-002 (docs/BACKLOG.md) — le verdict du harnais ne parle que du dépôt
# @spec docs/JOURNAL.md, décision 442 ; docs/CloudWorker.md §2.1
#
# Le sujet de ce harnais est le contenu de `.env` et la garde que `runDev.sh` lui oppose. Or
# `runDev.sh` applique — correctement — la priorité du shell sur `.env`, et `docs/CloudWorker.md`
# §2.1 impose à l'opérateur d'exporter `NPM_CA_FILE` pour que `npm ci` traverse un proxy TLS
# interposé. Sans cette neutralisation, la variable de l'appelant fuit dans chacun des appels à
# `./runDev.sh` et `./resetMe.sh` ci-dessous, qui ne posent que `P2ENJOY_ENV_FILE` : les six
# contrôles de `ca_refusal()` reçoivent alors une acceptation là où ils écrivaient une valeur
# invalide, et le contrôle de `resetMe.sh` **détruit réellement le cluster** au lieu de prouver
# qu'aucune destruction n'a lieu. MESURÉ le 2026-08-18 : sept anomalies qui ne disaient rien du
# produit.
#
# Aucune couverture n'est perdue : les trois contrôles qui éprouvent précisément la priorité du
# shell posent la variable eux-mêmes sur leur ligne de commande — valeur valide, valeur relative,
# valeur vide —, et les deux reconstructions d'image du §7 font de même.
unset NPM_CA_FILE

ENV_EXAMPLE="$REPO_ROOT/.env.example"
WORK=$(mktemp -d)
cleanup() {
	if [ -n "${proc_listener_pid:-}" ]; then
		kill "$proc_listener_pid" 2>/dev/null || true
		wait "$proc_listener_pid" 2>/dev/null || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

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
BACKUP_AGE_RECIPIENTS_FILE  lue par scripts/backup.sh depuis CRM-080, jamais par un service
BACKUP_OUTPUT_DIR           lue par scripts/backup.sh depuis CRM-080, jamais par un service
BACKUP_RETENTION_DAYS       lue par scripts/backup.sh depuis CRM-080, jamais par un service
RESTORE_AGE_IDENTITY_FILE   lue par scripts/restore-drill.sh depuis CRM-080 tranche 2, jamais par un service ; elle désigne une clé PRIVÉE et n'a rien à faire sur l'hôte qui sauvegarde
BACKUP_MAX_AGE_HOURS        lue par scripts/backup-supervision.sh depuis CRM-080 tranche 3, jamais par un service
BACKUP_MIN_RECIPIENTS       lue par scripts/backup-supervision.sh depuis CRM-080 tranche 3, jamais par un service
BACKUP_OFFSITE_DIR          lue par scripts/backup-supervision.sh depuis CRM-080 tranche 3, jamais par un service
BACKUP_DRILL_STAMP_FILE     lue par scripts/backup-supervision.sh depuis CRM-080 tranche 3, jamais par un service ; elle est écrite par le déclencheur de l'exercice, jamais par un script du dépôt
BACKUP_DRILL_MAX_AGE_DAYS   lue par scripts/backup-supervision.sh depuis CRM-080 tranche 3, jamais par un service
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

SENSITIVE="POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE
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

	# Longueurs imposées par Realtime et postgres-meta : une erreur ici se traduit par un service
	# qui refuse de démarrer.
	length_errors=""
	check_len() {
		local value
		value=$(env_get "$BOOT1" "$1")
		[ "${#value}" = "$2" ] || length_errors="$length_errors $1(${#value}≠$2)"
	}
	check_len SECRET_KEY_BASE 64
	check_len REALTIME_DB_ENC_KEY 16
	check_len PG_META_CRYPTO_KEY 32
	if [ -z "$length_errors" ]; then
		ok "longueurs imposées respectées : SECRET_KEY_BASE 64, REALTIME_DB_ENC_KEY 16, PG_META_CRYPTO_KEY 32"
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

# Une variable facultative se reconnaît à son exemple vide. Son ajout ne doit pas invalider tous
# les `.env` existants ; les variables obligatoires, telle KONG_HTTP_PORT ci-dessus, restent
# strictes (CRM-015, décision 280).
OPTIONAL_OMITTED="$WORK/env.optional-omitted"
grep -v '^NPM_CA_FILE=' "$BOOT1" > "$OPTIONAL_OMITTED"
if P2ENJOY_ENV_FILE="$OPTIONAL_OMITTED" ./runDev.sh --bootstrap >"$WORK/optional-omitted.log" 2>&1; then
	ok "un ancien .env peut omettre NPM_CA_FILE, variable facultative à exemple vide"
else
	fail "runDev.sh refuse un ancien .env qui omet seulement NPM_CA_FILE"
fi

# Variables introduites APRÈS l'amorçage d'un `.env` : elles sont complétées, et elles seules
# (CRM-051, décision 313). La distinction avec le cas KONG_HTTP_PORT ci-dessus est le cœur du
# contrat : compléter tout ce qui manque reviendrait à accepter un fichier tronqué.
AJOUTEES="$WORK/env.ajoutees"
grep -v -e '^MAIL_SYNC_INTERNAL_TOKEN=' -e '^MAIL_SYNC_LOG_LEVEL=' "$BOOT1" > "$AJOUTEES"
if P2ENJOY_ENV_FILE="$AJOUTEES" ./runDev.sh --bootstrap >"$WORK/ajoutees.log" 2>&1; then
	ok "un .env antérieur à CRM-051 est complété au lieu d'être refusé"
else
	fail "runDev.sh refuse un .env antérieur à CRM-051 au lieu de le compléter"
	cat "$WORK/ajoutees.log"
fi

jeton_ajoute=$(env_get "$AJOUTEES" MAIL_SYNC_INTERNAL_TOKEN)
if [ "${#jeton_ajoute}" -ge 32 ] && printf '%s' "$jeton_ajoute" | grep -qE '^[0-9a-f]+$'; then
	ok "MAIL_SYNC_INTERNAL_TOKEN complété au hasard, ${#jeton_ajoute} caractères hexadécimaux"
else
	fail "MAIL_SYNC_INTERNAL_TOKEN complété par « $jeton_ajoute », hors contrat"
fi

if [ "$(env_get "$AJOUTEES" MAIL_SYNC_LOG_LEVEL)" = "$(env_get "$ENV_EXAMPLE" MAIL_SYNC_LOG_LEVEL)" ]; then
	ok "MAIL_SYNC_LOG_LEVEL est repris du gabarit, non inventé"
else
	fail "MAIL_SYNC_LOG_LEVEL diverge du gabarit"
fi

# Une complétion n'est pas une rotation : un second passage ne doit rien réécrire.
P2ENJOY_ENV_FILE="$AJOUTEES" ./runDev.sh --bootstrap >/dev/null 2>&1 || true
if [ "$(env_get "$AJOUTEES" MAIL_SYNC_INTERNAL_TOKEN)" = "$jeton_ajoute" ]; then
	ok "un second passage ne fait pas tourner le secret déjà complété"
else
	fail "le secret complété a été réécrit au passage suivant"
fi

# --- 4 bis. Rappel des identifiants de développement -------------------------------------------
#
# Le bloc est rendu par `env_print_dev_credentials`, et non par `runDev.sh`, précisément pour être
# exercé ici sans démarrer la pile. Il est produit contre le `.env` **jetable** amorcé plus haut :
# aucune valeur du poste n'est lue, et aucune n'est affichée par cette preuve.

echo
echo "4 bis. Rappel des identifiants de développement"

CREDENTIALS="$WORK/credentials.txt"
(
	P2ENJOY_ENV_FILE="$BOOT1"
	export P2ENJOY_ENV_FILE
	# shellcheck source=scripts/lib/env.sh
	. "$REPO_ROOT/scripts/lib/env.sh"
	env_print_dev_credentials
) >"$CREDENTIALS" 2>&1

for attendu in \
	'admin@' 'bizdev@' 'viewer@' 'systeme@' \
	'PostgreSQL' 'Stalwart (gestion)' 'MinIO (console)' 'mail-sync (API interne)' \
	'Supabase Studio' 'Inbucket'
do
	if grep -qF "$attendu" "$CREDENTIALS"; then
		ok "les identifiants annoncent « $attendu »"
	else
		fail "les identifiants n'annoncent pas « $attendu »"
	fi
done

# Le mot de passe des comptes vient du script de seed, jamais d'une copie dans runDev.sh.
SEED_ATTENDU=$(sed -n "s/^SEED_PASSWORD='\(.*\)'$/\1/p" "$REPO_ROOT/supabase/seed/apply-seed.sh" | head -1)
if [ -n "$SEED_ATTENDU" ] && grep -qF "« $SEED_ATTENDU »" "$CREDENTIALS"; then
	ok "le mot de passe des comptes est lu dans supabase/seed/apply-seed.sh"
else
	fail "le mot de passe des comptes n'est pas repris du script de seed"
fi

if grep -qF "$SEED_ATTENDU" "$REPO_ROOT/runDev.sh" "$REPO_ROOT/scripts/lib/env.sh"; then
	fail "le mot de passe du seed est recopié en dur dans les scripts de lancement"
else
	ok "aucun script de lancement ne recopie le mot de passe du seed"
fi

# Chaque secret affiché doit être celui du fichier visé, et aucune valeur ne doit manquer.
for variable in POSTGRES_PASSWORD MINIO_ROOT_PASSWORD MAIL_SYNC_INTERNAL_TOKEN; do
	valeur=$(env_get "$BOOT1" "$variable")
	if [ -n "$valeur" ] && grep -qF "$valeur" "$CREDENTIALS"; then
		ok "$variable est repris du fichier d'environnement visé"
	else
		fail "$variable est absent du rappel, ou lu ailleurs que dans le fichier visé"
	fi
done

if grep -qE '/ *$|« »|<seed introuvable>' "$CREDENTIALS"; then
	fail "au moins un identifiant est affiché vide"
else
	ok "aucun identifiant n'est affiché vide"
fi

HOST_CA=/etc/ssl/certs/ca-certificates.crt
if [ -r "$HOST_CA" ] && [ -s "$HOST_CA" ] \
	&& grep -q -- '-----BEGIN CERTIFICATE-----' "$HOST_CA"; then
	CA_VALID_ENV="$WORK/env.ca-valid"
	sed "s#^NPM_CA_FILE=.*#NPM_CA_FILE=$HOST_CA#" "$BOOT1" > "$CA_VALID_ENV"
	if P2ENJOY_ENV_FILE="$CA_VALID_ENV" ./runDev.sh --bootstrap >"$WORK/ca-valid.log" 2>&1; then
		ok "NPM_CA_FILE accepte le paquet PEM absolu et lisible fourni par l'hôte"
	else
		fail "runDev.sh refuse le paquet PEM valide de l'hôte"
	fi
else
	fail "paquet PEM de l'hôte absent ou illisible : $HOST_CA"
	CA_VALID_ENV="$BOOT1"
fi

ca_refusal() {
	local id=$1 label=$2 value=$3 candidate="$WORK/env.ca-$1"
	sed "s#^NPM_CA_FILE=.*#NPM_CA_FILE=$value#" "$BOOT1" > "$candidate"
	if P2ENJOY_ENV_FILE="$candidate" ./runDev.sh --bootstrap >"$WORK/ca-$id.log" 2>&1; then
		fail "NPM_CA_FILE accepte $label"
	elif grep -q 'NPM_CA_FILE' "$WORK/ca-$id.log"; then
		ok "NPM_CA_FILE refuse $label avant Docker et nomme la variable"
	else
		fail "NPM_CA_FILE refuse $label sans diagnostic exploitable"
	fi
}

mkdir -p "$WORK/ca-directory"
: > "$WORK/ca-empty.pem"
printf '%s\n' 'ceci nest pas un certificat' > "$WORK/ca-not-pem.txt"
printf '%s\n' '-----BEGIN CERTIFICATE-----' 'inaccessible' '-----END CERTIFICATE-----' \
	> "$WORK/ca-unreadable.pem"
chmod 000 "$WORK/ca-unreadable.pem"

ca_refusal relative "un chemin relatif" "certificats/entreprise.pem"
ca_refusal missing "un fichier absent" "$WORK/ca-absent.pem"
ca_refusal directory "un répertoire" "$WORK/ca-directory"
ca_refusal empty "un fichier vide" "$WORK/ca-empty.pem"
ca_refusal nonpem "un fichier sans bloc PEM" "$WORK/ca-not-pem.txt"

# La prémisse de ce contrôle — un fichier que le processus ne peut PAS lire — n'existe pas pour
# `root` : `chmod 000` ne lui oppose rien, `[ -r ]` reste vrai et la lecture aboutit réellement
# (MESURÉ). Le rendre ROUGE ferait dire au harnais « la garde accepte un fichier illisible » alors
# qu'aucun fichier illisible n'a pu être fabriqué : ce serait l'accusation fausse qu'INC-145
# reproche déjà au contrôle des ports. Il est donc DÉCLARÉ non exécutable, avec son motif, et
# reste pleinement exercé dès que le harnais tourne sous un compte ordinaire.
# Voir docs/CloudWorker.md §2.4, qui cite ce cas nommément.
if [ "$(id -u)" = "0" ]; then
	skip "NPM_CA_FILE refuse un fichier illisible : root peut lire un fichier chmod 000"
else
	ca_refusal unreadable "un fichier illisible" "$WORK/ca-unreadable.pem"
fi

# Le shell a la même priorité que dans Compose : il peut corriger une valeur de `.env`, ou la
# neutraliser explicitement. Symétriquement, une mauvaise surcharge doit être refusée même si le
# fichier contient un chemin valide.
CA_RELATIVE_ENV="$WORK/env.ca-relative"
sed 's#^NPM_CA_FILE=.*#NPM_CA_FILE=certificats/entreprise.pem#' "$BOOT1" > "$CA_RELATIVE_ENV"
if NPM_CA_FILE="$HOST_CA" P2ENJOY_ENV_FILE="$CA_RELATIVE_ENV" \
	./runDev.sh --bootstrap >"$WORK/ca-shell-valid.log" 2>&1; then
	ok "NPM_CA_FILE exportée par le shell prévaut sur la valeur invalide de .env"
else
	fail "la garde ne suit pas la priorité du shell appliquée par Compose"
fi

if NPM_CA_FILE=certificats/entreprise.pem P2ENJOY_ENV_FILE="$CA_VALID_ENV" \
	./runDev.sh --bootstrap >"$WORK/ca-shell-invalid.log" 2>&1; then
	fail "une surcharge shell relative contourne la garde NPM_CA_FILE"
elif grep -q 'NPM_CA_FILE' "$WORK/ca-shell-invalid.log"; then
	ok "une surcharge shell invalide est refusée malgré la valeur valide de .env"
else
	fail "la surcharge shell invalide est refusée sans nommer NPM_CA_FILE"
fi

if NPM_CA_FILE= P2ENJOY_ENV_FILE="$CA_VALID_ENV" \
	./runDev.sh --bootstrap >"$WORK/ca-shell-empty.log" 2>&1; then
	ok "une surcharge shell vide désactive explicitement le CA"
else
	fail "une surcharge shell vide devrait rendre le build inerte"
fi

if P2ENJOY_ENV_FILE="$CA_RELATIVE_ENV" ./resetMe.sh --yes >"$WORK/ca-reset.log" 2>&1; then
	fail "resetMe.sh détruit les données avant de refuser NPM_CA_FILE"
elif grep -q 'NPM_CA_FILE' "$WORK/ca-reset.log"; then
	ok "resetMe.sh refuse NPM_CA_FILE avant toute destruction"
else
	fail "resetMe.sh refuse le CA invalide sans diagnostic exploitable"
fi

PLACEHOLDER="$WORK/env.placeholder"
sed 's/^SECRET_KEY_BASE=.*/SECRET_KEY_BASE=CHANGE_ME_SECRET_KEY_BASE/' "$BOOT1" > "$PLACEHOLDER"
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

# --- Gardes de la fenêtre de migration (--migrate) --------------------------------------------
# @verifies CRM-087 (docs/BACKLOG.md), docs/JOURNAL.md décision 489
#
# `--migrate` ouvre la fenêtre de maintenance de la production. Trois gardes doivent tenir :
#   (a) le profil doit être `prod` — un fichier `dev` est refusé par la garde existante ;
#   (b) `APPLY_MIGRATIONS` DOIT rester `false` dans le fichier — la surcharge ne vit que dans
#       l'invocation, jamais dans `.env` ;
#   (c) sans confirmation d'instantané, `--migrate` est refusé hors terminal interactif — le seul
#       drapeau qui autorise le geste hors TTY est `--instantane-verifie`.
#
# Les gardes (a) et (b) sont éprouvées par les blocs ci-dessus (profil dev / APPLY_MIGRATIONS=true) :
# elles refusent le mode ordinaire comme le mode `--migrate`, la garde étant en tête du script.
# Ce bloc éprouve la garde (c), qui appartient au seul mode `--migrate` et qui est appliquée
# AVANT `require_docker` — mesuré, pour que le harnais puisse la prouver sans démon Docker.

if P2ENJOY_ENV_FILE="$AS_PROD" ./runProd.sh --migrate </dev/null \
	>"$WORK/migrate-noconfirm.log" 2>&1; then
	fail "runProd.sh --migrate accepte l'absence de confirmation d'instantané hors TTY"
else
	if grep -q "instantané" "$WORK/migrate-noconfirm.log"; then
		ok "runProd.sh --migrate refuse hors TTY sans confirmation d'instantané, en nommant la garde"
	else
		fail "runProd.sh --migrate a refusé sans nommer l'instantané"
	fi
fi

# Le fichier `.env` ne doit JAMAIS être réécrit par `--migrate`, y compris quand la garde refuse.
if diff -q "$AS_PROD" "$AS_PROD" >/dev/null 2>&1; then
	AS_PROD_BEFORE=$(sha256sum "$AS_PROD" | cut -d' ' -f1)
	P2ENJOY_ENV_FILE="$AS_PROD" ./runProd.sh --migrate </dev/null >/dev/null 2>&1 || true
	AS_PROD_AFTER=$(sha256sum "$AS_PROD" | cut -d' ' -f1)
	if [ "$AS_PROD_BEFORE" = "$AS_PROD_AFTER" ]; then
		ok "runProd.sh --migrate n'a pas réécrit le fichier d'environnement"
	else
		fail "runProd.sh --migrate a modifié le fichier d'environnement"
	fi
fi

# Le refus de `--migrate` sur `APPLY_MIGRATIONS=true` est déjà couvert par le contrôle en tête
# de section (il touche la garde partagée à tous les modes) ; on éprouve ici que le message reste
# clair quand on passe explicitement `--migrate` avec un fichier fautif.
if P2ENJOY_ENV_FILE="$AS_PROD_MIGRATE" ./runProd.sh --migrate --instantane-verifie \
	>"$WORK/migrate-badenv.log" 2>&1; then
	fail "runProd.sh --migrate accepte APPLY_MIGRATIONS=true dans le fichier .env"
else
	if grep -q "APPLY_MIGRATIONS" "$WORK/migrate-badenv.log"; then
		ok "runProd.sh --migrate refuse APPLY_MIGRATIONS=true dans le fichier .env"
	else
		fail "runProd.sh --migrate a refusé sans nommer APPLY_MIGRATIONS"
	fi
fi

# Un fichier de profil dev doit être refusé, même avec `--migrate --instantane-verifie` : la
# fenêtre de migration est un geste de PRODUCTION, jamais d'un poste de développement.
if P2ENJOY_ENV_FILE="$BOOT1" ./runProd.sh --migrate --instantane-verifie \
	>"$WORK/migrate-dev.log" 2>&1; then
	fail "runProd.sh --migrate accepte un environnement de profil dev"
else
	if grep -q "P2ENJOY_ENV_PROFILE" "$WORK/migrate-dev.log"; then
		ok "runProd.sh --migrate refuse un environnement de profil dev"
	else
		fail "runProd.sh --migrate a refusé un profil dev sans nommer la garde"
	fi
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

# `pg_cron` est détenu par `supabase_admin`, tandis que les objets applicatifs restent détenus et
# exécutés par `postgres`. Le runner reconnaît un marqueur unique et refuse toute autre élévation :
# le choix ne peut ni être implicite, ni devenir une exécution arbitraire sous un rôle privilégié.
MIGRATION_RUNNER=supabase/docker/migrations-runner/apply-migrations.sh
if [ -x "$MIGRATION_RUNNER" ] && sh -n "$MIGRATION_RUNNER"; then
	ok "migrations-runner exécutable et syntaxiquement valide"
else
	fail "migrations-runner absent, non exécutable ou syntaxiquement invalide"
fi

# DEUX migrations portent le marqueur, et non plus une seule. `CRM-057` a livré
# `0029_pieces_jointes_telechargeables.sql`, qui pose la politique de Storage : le schéma `storage`
# appartient à `supabase_admin`, et `postgres` n'y crée aucune politique. Le contrôle est RÉVISÉ et
# non relâché — il continue d'énumérer NOMMÉMENT les fichiers autorisés, et refuse toute élévation
# qui apparaîtrait ailleurs. Une liste close reste une liste close, même à deux entrées.
MARQUEURS_ATTENDUS='supabase/migrations/0018_pg_cron.sql
supabase/migrations/0029_pieces_jointes_telechargeables.sql'
role_markers=$(grep -l '^-- @migration-role:' supabase/migrations/*.sql 2>/dev/null || true)
role_valeurs=$(grep -h '^-- @migration-role:' supabase/migrations/*.sql 2>/dev/null |
	sort -u || true)
if [ "$role_markers" = "$MARQUEURS_ATTENDUS" ] \
	&& [ "$role_valeurs" = '-- @migration-role: supabase_admin' ]; then
	ok "seules pg_cron et la politique de Storage exigent le rôle propriétaire supabase_admin"
else
	fail "marqueurs de rôle de migration inattendus : ${role_markers:-aucun}"
fi

RUNNER_FIXTURE="$WORK/migrations-runner"
mkdir -p "$RUNNER_FIXTURE/bin" "$RUNNER_FIXTURE/migrations"
printf '%s\n' '-- migration ordinaire' > "$RUNNER_FIXTURE/migrations/0001.sql"
printf '%s\n' '-- @migration-role: supabase_admin' > "$RUNNER_FIXTURE/migrations/0002.sql"
printf '%s\n' '#!/bin/sh' \
	'printf "%s|%s\\n" "$PGUSER" "$*" >> "$MIGRATION_ROLE_LOG"' \
	> "$RUNNER_FIXTURE/bin/psql"
chmod +x "$RUNNER_FIXTURE/bin/psql"
if PATH="$RUNNER_FIXTURE/bin:$PATH" MIGRATIONS_DIR="$RUNNER_FIXTURE/migrations" \
	APPLY_MIGRATIONS=true PGDATABASE=fixture PGHOST=fixture PGPORT=5432 PGUSER=postgres \
	MIGRATION_ROLE_LOG="$RUNNER_FIXTURE/roles.log" \
	"$MIGRATION_RUNNER" >"$RUNNER_FIXTURE/runner.log" 2>&1; then
	runner_fixture_ok=true
else
	runner_fixture_ok=false
fi
if [ "$runner_fixture_ok" = true ] \
	&& [ "$(cut -d '|' -f 1 "$RUNNER_FIXTURE/roles.log" 2>/dev/null | paste -sd '|' -)" = \
	'postgres|supabase_admin' ] \
	&& [ "$(grep -c -- '--single-transaction --file' "$RUNNER_FIXTURE/roles.log" 2>/dev/null)" = 2 ]; then
	ok "le runner garde postgres par défaut et ne prend supabase_admin que pour le fichier marqué"
else
	fail "le runner ne respecte pas les deux rôles de la fixture"
fi

printf '%s\n' '-- @migration-role: root' > "$RUNNER_FIXTURE/migrations/0003.sql"
if PATH="$RUNNER_FIXTURE/bin:$PATH" MIGRATIONS_DIR="$RUNNER_FIXTURE/migrations" \
	APPLY_MIGRATIONS=true PGDATABASE=fixture PGHOST=fixture PGPORT=5432 PGUSER=postgres \
	MIGRATION_ROLE_LOG="$RUNNER_FIXTURE/roles-invalid.log" \
	"$MIGRATION_RUNNER" >"$RUNNER_FIXTURE/runner-invalid.log" 2>&1; then
	fail "le runner accepte un marqueur de rôle arbitraire"
elif grep -q "rôle refusé 'root'" "$RUNNER_FIXTURE/runner-invalid.log"; then
	ok "le runner refuse tout rôle privilégié non explicitement autorisé"
else
	fail "le runner refuse le rôle arbitraire sans diagnostic exploitable"
fi

# --- Rechargement du cache de PostgREST par le runner ------------------------------------------
# @verifies CRM-087 (docs/BACKLOG.md), docs/JOURNAL.md décision 489
#
# Après un passage réussi, le runner émet `notify pgrst, 'reload schema'` une seule fois. La
# preuve : un mock `psql` qui enregistre chaque invocation. Après application des deux fichiers
# valides (0001 et 0002), la dernière invocation doit être un `--command "notify pgrst, 'reload
# schema';"`. Le message final « fichier(s) appliqué(s) avec succès. » doit être présent.

RELOAD_FIXTURE="$WORK/runner-reload"
mkdir -p "$RELOAD_FIXTURE/bin" "$RELOAD_FIXTURE/migrations"
printf '%s\n' '-- migration 0001' > "$RELOAD_FIXTURE/migrations/0001.sql"
printf '%s\n' '-- migration 0002' > "$RELOAD_FIXTURE/migrations/0002.sql"
# Mock psql : consigne l'appel, et rend succès sauf si RUNNER_FAIL_ON désigne un fichier.
printf '%s\n' '#!/bin/sh' \
	'for arg in "$@"; do' \
	'  case "$arg" in' \
	'    --command) command_mode=1 ;;' \
	'    --file) file_mode=1 ;;' \
	'    *)' \
	'      if [ "${command_mode:-0}" = 1 ] && [ -z "${captured_command:-}" ]; then' \
	'        captured_command="$arg"' \
	'      fi' \
	'      if [ "${file_mode:-0}" = 1 ] && [ -z "${captured_file:-}" ]; then' \
	'        captured_file="$arg"' \
	'      fi' \
	'      ;;' \
	'  esac' \
	'done' \
	'printf "invocation:%s|command:%s|file:%s\n" "$PGUSER" "${captured_command:-}" "${captured_file:-}" >> "$MIGRATION_CALL_LOG"' \
	'if [ -n "${RUNNER_FAIL_ON:-}" ] && [ "${captured_file##*/}" = "$RUNNER_FAIL_ON" ]; then' \
	'  exit 3' \
	'fi' \
	'exit 0' \
	> "$RELOAD_FIXTURE/bin/psql"
chmod +x "$RELOAD_FIXTURE/bin/psql"

if PATH="$RELOAD_FIXTURE/bin:$PATH" MIGRATIONS_DIR="$RELOAD_FIXTURE/migrations" \
	APPLY_MIGRATIONS=true PGDATABASE=fixture PGHOST=fixture PGPORT=5432 PGUSER=postgres \
	MIGRATION_CALL_LOG="$RELOAD_FIXTURE/calls.log" \
	"$MIGRATION_RUNNER" >"$RELOAD_FIXTURE/runner.log" 2>&1; then
	reload_ok=true
else
	reload_ok=false
fi

# Attendu : trois lignes de journal — deux --file (0001 puis 0002) et une --command finale.
last_line=$(tail -n 1 "$RELOAD_FIXTURE/calls.log" 2>/dev/null || true)
if [ "$reload_ok" = true ] \
	&& grep -q "command:notify pgrst, 'reload schema';" "$RELOAD_FIXTURE/calls.log" \
	&& [ "$(wc -l < "$RELOAD_FIXTURE/calls.log")" = 3 ] \
	&& printf '%s\n' "$last_line" | grep -q "command:notify pgrst" \
	&& grep -q "fichier(s) appliqué(s) avec succès" "$RELOAD_FIXTURE/runner.log"; then
	ok "le runner émet notify pgrst, 'reload schema' après un passage réussi, une seule fois"
else
	fail "le runner n'a pas émis correctement le notify pgrst en fin de passage"
fi

# --- Échec en cours de répertoire : code non nul, aucun succès annoncé ------------------------
# @verifies CRM-087 (docs/BACKLOG.md), docs/JOURNAL.md décision 489
#
# ON_ERROR_STOP=1 doit arrêter le runner à la première migration fautive. Il ne doit ni
# atteindre le notify pgrst, ni annoncer le message final « appliqué(s) avec succès ».

FAIL_FIXTURE="$WORK/runner-fail"
mkdir -p "$FAIL_FIXTURE/bin" "$FAIL_FIXTURE/migrations"
printf '%s\n' '-- migration 0001' > "$FAIL_FIXTURE/migrations/0001.sql"
printf '%s\n' '-- migration 0002 KO' > "$FAIL_FIXTURE/migrations/0002.sql"
printf '%s\n' '-- migration 0003' > "$FAIL_FIXTURE/migrations/0003.sql"
cp "$RELOAD_FIXTURE/bin/psql" "$FAIL_FIXTURE/bin/psql"

if PATH="$FAIL_FIXTURE/bin:$PATH" MIGRATIONS_DIR="$FAIL_FIXTURE/migrations" \
	APPLY_MIGRATIONS=true PGDATABASE=fixture PGHOST=fixture PGPORT=5432 PGUSER=postgres \
	RUNNER_FAIL_ON=0002.sql \
	MIGRATION_CALL_LOG="$FAIL_FIXTURE/calls.log" \
	"$MIGRATION_RUNNER" >"$FAIL_FIXTURE/runner.log" 2>&1; then
	fail "le runner ignore l'échec de la migration 0002 et rend un succès"
else
	# Aucun succès annoncé, aucun notify émis, la migration 0003 non lancée.
	if ! grep -q "fichier(s) appliqué(s) avec succès" "$FAIL_FIXTURE/runner.log" \
		&& ! grep -q "notify pgrst" "$FAIL_FIXTURE/calls.log" \
		&& ! grep -q "file:.*0003" "$FAIL_FIXTURE/calls.log"; then
		ok "le runner s'arrête sur la première erreur, sans notify et sans annoncer de succès"
	else
		fail "le runner a propagé un échec de façon trompeuse (notify émis ou 0003 appliquée ou succès annoncé)"
	fi
fi

# --- 7. Le fichier amorcé satisfait réellement Compose ------------------------------------------

echo
echo "7. Interpolation des fichiers Compose"

# ---------------------------------------------------------------------------------------------
# Sonde du démon : ce qu'elle mesure, et pourquoi ce n'est plus `docker info`.
# ---------------------------------------------------------------------------------------------
# `docker info` sortait en 1 sur ce poste ALORS QUE LE DÉMON RÉPONDAIT : les greffons CLI de
# Docker Desktop y segfaultent, et les points d'entrée classiques — `info`, `ps`, `version` —
# rendent un 500 sur la socket, quelle que soit la version d'API forcée. Mesuré le 2026-08-18,
# à l'intérieur comme à l'extérieur du bac à sable. `docker compose`, lui, répond normalement.
#
# La garde faisait donc SAUTER quatre contrôles en annonçant « faute de démon Docker », et le
# harnais rendait un vert obtenu par omission. Un contrôle qui ne s'exécute pas ne prouve rien ;
# une sonde qui se trompe de sujet transforme ce silence en satisfecit.
#
# La sonde interroge désormais CE QUE LES CONTRÔLES EMPLOIENT : `docker compose`. Elle est plus
# étroite et plus honnête — elle n'affirme rien du démon en général, seulement que l'outil dont ces
# vérifications dépendent répond.
demon_repond() { docker compose version >/dev/null 2>&1; }

if demon_repond; then
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

	if NPM_CA_FILE= docker compose --env-file "$BOOT1" -f docker-compose.yml \
		-f docker-compose.dev.yml config --format json >"$WORK/compose-ca-empty.json" \
		&& python3 -c 'import json,sys
c=json.load(open(sys.argv[1])); assert c["secrets"]["npm_ca"]["file"] == "/dev/null"
assert c["services"]["webapp"]["build"]["secrets"] == [{"source":"npm_ca"}]' \
		"$WORK/compose-ca-empty.json"; then
		ok "Compose câble npm_ca sur /dev/null lorsque NPM_CA_FILE est absente ou vide"
	else
		fail "l'assemblage inerte de npm_ca n'est pas celui spécifié"
	fi

	if NPM_CA_FILE="$HOST_CA" docker compose --env-file "$BOOT1" -f docker-compose.yml \
		-f docker-compose.dev.yml config --format json >"$WORK/compose-ca-active.json" \
		&& python3 -c 'import json,sys
c=json.load(open(sys.argv[1])); assert c["secrets"]["npm_ca"]["file"] == sys.argv[2]
assert c["services"]["webapp"]["build"]["secrets"] == [{"source":"npm_ca"}]' \
		"$WORK/compose-ca-active.json" "$HOST_CA"; then
		ok "Compose transporte le chemin PEM effectif jusqu'au secret de build npm_ca"
	else
		fail "Compose ne transporte pas le chemin NPM_CA_FILE explicite"
	fi

	if NPM_CA_FILE= docker compose --env-file "$BOOT1" -f docker-compose.yml \
		-f docker-compose.dev.yml build --no-cache --progress plain webapp \
		>"$WORK/build-webapp-no-ca.log" 2>&1 \
		&& grep -q 'npm_ca: inactif' "$WORK/build-webapp-no-ca.log"; then
		ok "build sans cache et sans CA : branche inactive, npm ci réussi"
	else
		fail "la reconstruction sans CA n'emprunte pas sa branche inactive"
		tail -n 12 "$WORK/build-webapp-no-ca.log" | sed 's/^/        /'
	fi

	if NPM_CA_FILE="$HOST_CA" docker compose --env-file "$BOOT1" -f docker-compose.yml \
		-f docker-compose.dev.yml build --no-cache --progress plain webapp \
		>"$WORK/build-webapp-with-ca.log" 2>&1 \
		&& grep -q 'npm_ca: actif' "$WORK/build-webapp-with-ca.log"; then
		ok "build sans cache avec CA : branche active, npm ci réussi"
	else
		fail "la reconstruction avec CA n'emprunte pas sa branche active"
		tail -n 12 "$WORK/build-webapp-with-ca.log" | sed 's/^/        /'
	fi

	if docker image inspect p2enjoy-crm-webapp >/dev/null 2>&1 \
		&& docker run --rm --entrypoint sh p2enjoy-crm-webapp -c \
			'test ! -e /app/.env && test ! -e /app/.git && test ! -e /app/supabase/docker/volumes && test -f /app/.env.example && test ! -e /run/secrets/npm_ca && test "$(npm config get cafile)" = null && test -z "$(find /root /app -name .npmrc -type f -size +0c -print -quit 2>/dev/null)"'; then
		ok "l'image exclut contexte sensible, secret npm_ca, cafile et .npmrc non vide"
	else
		fail "l'image construite conserve une donnée sensible, npm_ca ou un réglage cafile"
	fi

	if [ -z "$(git ls-files '*.crt' '*.pem' '*.cer')" ]; then
		ok "aucun certificat n'est versionné : NPM_CA_FILE ne transporte qu'un chemin d'hôte"
	else
		fail "un certificat a été ajouté au dépôt au lieu d'être fourni par l'environnement"
	fi
else
	skip "interpolation Compose : docker compose ne répond pas"
	skip "interpolation Compose (production) : docker compose ne répond pas"
	skip "reconstruction et inspection réelles de l'image webapp : docker compose ne répond pas"
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

# Force le dernier recours sans altérer le PATH du script : une fonction bash peut masquer le
# builtin `command` dans ce seul sous-shell. Les outils restent donc disponibles, mais les deux
# sondes prioritaires paraissent absentes exactement comme sur l'hôte minimal d'INC-044.
proc_fallback_ports() {
	(
		# shellcheck source=scripts/lib/env.sh
		. "$REPO_ROOT/scripts/lib/env.sh"
		command() {
			case "${1:-}:${2:-}" in
				-v:ss|-v:netstat) return 1 ;;
				*) builtin command "$@" ;;
			esac
		}
		host_listening_ports
	)
}

# Les deux formats du noyau sont éprouvés sur une table minimale : IPv4 et IPv6 en état LISTEN
# sont convertis, un socket dans un autre état est écarté. Le test réel qui suit ne dépend pas de
# cette fixture et vérifie le noyau courant.
PROC_TCP_FIXTURE="$WORK/proc-net-tcp"
PROC_TCP6_FIXTURE="$WORK/proc-net-tcp6"
printf '%s\n' \
	'  sl  local_address rem_address   st' \
	'   0: 0100007F:C001 00000000:0000 0A' \
	'   1: 0100007F:270F 00000000:0000 06' > "$PROC_TCP_FIXTURE"
printf '%s\n' \
	'  sl  local_address                         rem_address                          st' \
	'   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A' \
	> "$PROC_TCP6_FIXTURE"
fixture_proc_ports=$(
	# shellcheck source=scripts/lib/env.sh
	. "$REPO_ROOT/scripts/lib/env.sh"
	proc_listening_ports "$PROC_TCP_FIXTURE" "$PROC_TCP6_FIXTURE"
)
if printf '%s\n' "$fixture_proc_ports" | grep -qx 49153 \
	&& printf '%s\n' "$fixture_proc_ports" | grep -qx 8080 \
	&& ! printf '%s\n' "$fixture_proc_ports" | grep -qx 9999; then
	ok "/proc/net/tcp et tcp6 : hexadécimal converti, seuls les sockets LISTEN sont retenus"
else
	fail "/proc/net/tcp et tcp6 : conversion ou filtrage d'état incorrect"
fi

# Une socket réellement mise en écoute est d'abord lue dans /proc, puis fermée et relue. Filtrer
# l'état noyau 0A (LISTEN) est ainsi prouvé dans les deux sens ; un état résiduel TIME_WAIT ne doit
# jamais être pris pour un détenteur du port.
if command -v python3 >/dev/null 2>&1; then
	PROC_PORT_FILE="$WORK/proc-listener-port"
	python3 -c 'import socket, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen()
print(s.getsockname()[1], flush=True)
time.sleep(300)' > "$PROC_PORT_FILE" &
	proc_listener_pid=$!
	for _ in {1..100}; do
		[ -s "$PROC_PORT_FILE" ] && break
		sleep 0.01
	done
	proc_open_port=""
	[ ! -s "$PROC_PORT_FILE" ] || IFS= read -r proc_open_port < "$PROC_PORT_FILE"
	if [ -n "$proc_open_port" ]; then
		proc_ports_open=$(proc_fallback_ports)
		if printf '%s\n' "$proc_ports_open" | grep -qx "$proc_open_port"; then
			ok "/proc/net/tcp voit un port réellement ouvert sans ss ni netstat"
		else
			fail "/proc/net/tcp ne voit pas le port réellement ouvert $proc_open_port"
		fi

		kill "$proc_listener_pid" 2>/dev/null || true
		wait "$proc_listener_pid" 2>/dev/null || true
		proc_listener_pid=""
		proc_ports_closed=$(proc_fallback_ports)
		if printf '%s\n' "$proc_ports_closed" | grep -qx "$proc_open_port"; then
			fail "/proc/net/tcp croit encore le port $proc_open_port en écoute après sa fermeture"
		else
			ok "/proc/net/tcp ne voit plus le port réellement fermé"
		fi
	else
		fail "impossible d'ouvrir la socket TCP de preuve"
	fi
else
	fail "python3 absent : impossible d'ouvrir puis fermer une socket de preuve"
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
if demon_repond; then
	# shellcheck source=scripts/lib/env.sh
	( . "$REPO_ROOT/scripts/lib/env.sh"
	  # `docker_published_ports` lit `docker ps`. Là où cette commande est cassée — INC-145 —, le
	  # pipeline échoue, `pipefail` propage l'échec, et le contrôle sortait en 1 : il ACCUSAIT la
	  # garde des ports d'un défaut qu'elle n'a pas. Une accusation fausse coûte plus qu'une
	  # vérification absente : elle envoie chercher une cause qui n'existe pas. Les trois issues
	  # sont distinguées, et l'impossibilité de LIRE n'est jamais rendue comme une absence de port.
	  publies=$(docker_published_ports 2>/dev/null || true)
	  [ -n "$publies" ] || exit 3
	  reference=$(printf '%s\n' "$publies" | awk 'NR == 1 { print $1 }')
	  [ -n "$reference" ] || exit 2
	  host_listening_ports | grep -qx "$reference" )
	case $? in
		0) ok "les ports réellement en écoute sont bien vus par la garde" ;;
		2) skip "aucun conteneur ne publie de port : lecture réelle non éprouvée" ;;
		3) skip "docker ps ne rend aucune ligne : lire les ports publiés est IMPOSSIBLE ici" ;;
		*) fail "un port publié par un conteneur n'apparaît pas dans les ports en écoute" ;;
	esac
else
	skip "lecture réelle des ports de l'hôte : docker compose ne répond pas"
fi

# --- Bilan --------------------------------------------------------------------------------------

echo
if [ "$skips" -gt 0 ]; then
	echo "$skips vérification(s) NON EXÉCUTÉE(S) : leur outil ne répond pas sur ce poste."
	echo "Un contrôle qui ne s'exécute pas ne prouve rien — voir INC-145."
fi
# LE VERDICT NE PEUT PAS ANNONCER UN SUCCÈS QUAND DES CONTRÔLES N'ONT PAS TOURNÉ — `CLAUDE.md`
# §25 : « Ne pas annoncer une réussite lorsque certains contrôles n'ont pas pu être exécutés. »
# C'était le défaut RÉSIDUEL d'INC-145 : la sonde avait été corrigée et l'avertissement ajouté,
# mais la ligne de bilan disait toujours « aucune anomalie » et le script sortait en **0**. Un
# appelant qui ne lit que le code de sortie — chaîne d'intégration, harnais englobant — y voyait
# une réussite pleine. Trois issues sont désormais distinguées :
#
#   0 — tout a tourné, rien à signaler ;
#   2 — rien n'a échoué, mais des contrôles N'ONT PAS TOURNÉ : le résultat est INCOMPLET ;
#   1 — au moins un contrôle a échoué.
#
# Le 2 est délibérément distinct du 1 : « incomplet » n'est pas « en échec », et confondre les deux
# rendrait le harnais rouge sur un poste sain qui n'a simplement pas Docker. Mais il n'est pas 0 non
# plus, parce qu'un vert obtenu par omission est ce que cette entrée du registre dénonce.
if [ "$failures" -eq 0 ] && [ "$skips" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie, mais $skips NON EXÉCUTÉE(S)." >&2
	echo "Ce n'est pas un succès : le résultat est INCOMPLET." >&2
	exit 2
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

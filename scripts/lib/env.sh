#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — socle commun des scripts de lancement et d'environnement
# @spec CRM-015 (docs/BACKLOG.md) — validation du CA facultatif avant Docker
# @spec docs/JOURNAL.md décision 16 (amorçage automatique des secrets, gardes de profil)
# @spec docs/JOURNAL.md décision 98 (identifiants Docker), décision 99 (ports déjà pris),
#       décision 101 (ce que la pile crée sur l'hôte appartient à l'hôte), décision 257
#       (lecture de secours des ports par /proc), décision 272 (origine webapp de développement
#       cohérente avec le port publié)
# @spec docs/DAT.md §3.8 (contraintes d'exécution de l'hôte), §13 (commandes de lancement)
# @spec docs/PROD_MIGRATIONS.md §2.3
# @spec README.md §4 (installation), §5 (commandes principales), §9 (variables d'environnement),
#       §11 (limites connues)
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

# --- Crochets Git ---------------------------------------------------------------------------
#
# CLAUDE.md §13 : un agent ne s'attribue jamais un commit, et pourtant deux l'ont fait
# (docs/JOURNAL.md décisions 340 et 344) — la configuration Git de chaque environnement
# d'exécution automatisé est réinitialisée à l'identité de l'agent, et rien n'empêchait le commit
# suivant. `.githooks/pre-commit` refuse un commit dont l'identité n'est pas celle du responsable ;
# encore faut-il que Git sache le trouver. `core.hooksPath` est un réglage LOCAL au clone, jamais
# versionné dans `.git/`, donc réglé ici plutôt que supposé.

git_hooks_ensure() {
	command -v git >/dev/null 2>&1 || return 0
	[ -d "$REPO_ROOT/.git" ] || return 0
	if [ "$(git -C "$REPO_ROOT" config --local core.hooksPath || true)" != ".githooks" ]; then
		git -C "$REPO_ROOT" config --local core.hooksPath .githooks
	fi
}

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

# Ajoute une variable absente, en fin de fichier. L'écriture est faite en `>>` plutôt que par un
# fichier temporaire renommé : l'inode est conservé, et avec lui les droits 600 du fichier.
#   env_append <fichier> <nom> <valeur>
env_append() {
	local file=$1 name=$2 value=$3
	env_has "$file" "$name" && die "variable '$name' déjà présente dans $file : ajout impossible."
	printf '%s=%s\n' "$name" "$value" >> "$file"
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

	# Administrateur de repli de Stalwart (CRM-050). Il n'a pas de boîte : il n'existe que pour
	# l'API de gestion, par laquelle les boîtes sont provisionnées. Son mot de passe est tiré au
	# hasard comme les autres secrets — le mot de passe des **boîtes**, lui, est stable et publié
	# dans le README, exactement comme celui des comptes seedés
	# (docs/SPEC-mail-subsystem.md §11.4).
	env_set "$ENV_FILE" STALWART_ADMIN_PASSWORD "$(gen_hex 20)"

	# Jeton de l'API interne de `mail-sync` (CRM-051). Il n'est pas dérivé de `JWT_SECRET` : ce
	# service ne parle pas à PostgreSQL, et un secret partagé étendrait sa portée sans besoin.
	env_set "$ENV_FILE" MAIL_SYNC_INTERNAL_TOKEN "$(gen_hex 32)"

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

# Variables introduites APRÈS `env_bootstrap_dev`, et elles seules. Chaque entrée est
# « NOM:origine » : `alea:<longueur>` tire un secret comme au premier amorçage, `gabarit` recopie
# le défaut documenté de `.env.example`.
#
# Cette liste est **explicite, et doit le rester**. Compléter automatiquement toute variable
# absente du fichier reviendrait à accepter un `.env` tronqué en lui substituant des défauts : un
# port ou un domaine effacé par mégarde repartirait alors sur la valeur du gabarit, au lieu d'être
# refusé. La garde de `env_validate` n'existe que pour cela, et cette liste ne l'affaiblit que là
# où le développeur ne pouvait pas connaître la variable.
DEV_VARIABLES_AJOUTEES="
MAIL_SYNC_INTERNAL_TOKEN:alea:32
MAIL_SYNC_LOG_LEVEL:gabarit
MAIL_SYNC_IMAP_TIMEOUT_SECONDS:gabarit
MAIL_SYNC_SMTP_TIMEOUT_SECONDS:gabarit
"

# Complète un `.env` amorcé **avant** l'unité qui a introduit une variable. Sans cela, toute unité
# qui ajoute une variable au gabarit casserait le fichier de quiconque a démarré la pile plus tôt :
# la variable serait absente, présente dans le contrat, et `env_validate` refuserait de démarrer
# sans autre recours qu'une intervention manuelle non documentée.
#
# Une valeur déjà renseignée n'est jamais réécrite : ce n'est ni une rotation, ni une remise à zéro.
env_ensure_dev_completions() {
	local entry name origine example added=0
	for entry in $DEV_VARIABLES_AJOUTEES; do
		name=${entry%%:*}
		origine=${entry#*:}
		env_has "$ENV_FILE" "$name" && continue

		case "$origine" in
			alea:*)
				env_append "$ENV_FILE" "$name" "$(gen_hex "${origine#alea:}")"
				info "$name amorcé au hasard : secret introduit après $(basename "$ENV_FILE")."
				;;
			gabarit)
				example=$(env_get "$ENV_EXAMPLE" "$name")
				# Un gabarit qui ne porte pas de défaut exploitable ne peut pas décider à la
				# place de l'humain : la variable reste absente, et `env_validate` la réclame.
				case "$example" in
					"" | CHANGE_ME_*) continue ;;
				esac
				env_append "$ENV_FILE" "$name" "$example"
				info "$name repris du gabarit ($example) : variable introduite après $(basename "$ENV_FILE")."
				;;
			*)
				die "origine « $origine » inconnue pour $name dans DEV_VARIABLES_AJOUTEES."
				;;
		esac
		added=$((added + 1))
	done

	[ "$added" -eq 0 ] && return 1
	return 0
}

# --- Identifiants de développement ----------------------------------------------------------------
#
# @spec CRM-002 (docs/BACKLOG.md) — rappel des comptes de démonstration au démarrage
# @spec docs/SPEC-seed.md §2 (comptes du seed socle), docs/SPEC-mail-subsystem.md §11.4 (boîtes)
# @spec README.md §6 (développement), §8 (données de développement)
#
# Ce que ce bloc affiche est **local et jetable** : les comptes vivent sous des TLD réservés par
# la RFC 2606 donc non routables, les ports ne sont publiés que sur la boucle locale, et l'appelant
# a déjà exigé le profil `dev`. Le rendu vit ici, et non dans `runDev.sh`, pour être exercé sans
# démarrer la pile.

# Mot de passe des comptes seedés, lu dans le script de seed — seule source de vérité. Le recopier
# ici en ferait une copie de plus, muette le jour où elle divergerait.
env_seed_password() {
	sed -n "s/^SEED_PASSWORD='\(.*\)'\$/\1/p" "$REPO_ROOT/supabase/seed/apply-seed.sh" | head -1
}

# Les adresses n'ont pas toutes la même longueur : la colonne est posée, pas devinée.
env_credential_line() { info "$(printf '  %-26s %s' "$1" "$2")"; }

env_print_dev_credentials() {
	local mdp_seed mdp_boites domaine_perso domaine_cards
	mdp_seed=$(env_seed_password)
	mdp_boites=$(env_get "$ENV_FILE" STALWART_MAILBOX_PASSWORD)
	domaine_perso=$(env_get "$ENV_FILE" MAIL_DEV_PERSONAL_DOMAIN)
	domaine_cards=$(env_get "$ENV_FILE" CRM_INBOUND_DOMAIN)

	echo
	say "Comptes de démonstration"
	warn "Secrets de développement, affichés à dessein : ne les recopiez pas hors de ce poste."

	echo
	info "Webapp et API — mot de passe commun « ${mdp_seed:-<seed introuvable>} »"
	env_credential_line "admin@${domaine_perso}"  "Camille Aubert — administrateur"
	env_credential_line "bizdev@${domaine_perso}" "Driss Lemoine — business developer"
	env_credential_line "viewer@${domaine_perso}" "Farida Nowak — lecteur seul"

	echo
	info "Roundcube, IMAP et SMTP — mot de passe commun « ${mdp_boites} »"
	env_credential_line "systeme@${domaine_cards}" "boîte système, catch-all des adresses de cards"
	env_credential_line "admin@${domaine_perso}"   "boîte personnelle de Camille Aubert"
	env_credential_line "bizdev@${domaine_perso}"  "boîte personnelle de Driss Lemoine"
	info "  Farida Nowak n'a pas de boîte : un lecteur ne correspond pas (décision 239)."

	echo
	info "Administration des services"
	env_credential_line "PostgreSQL" "postgres / $(env_get "$ENV_FILE" POSTGRES_PASSWORD)"
	env_credential_line "Stalwart (gestion)" \
		"$(env_get "$ENV_FILE" STALWART_ADMIN_USER) / $(env_get "$ENV_FILE" STALWART_ADMIN_PASSWORD)"
	env_credential_line "MinIO (console)" \
		"$(env_get "$ENV_FILE" MINIO_ROOT_USER) / $(env_get "$ENV_FILE" MINIO_ROOT_PASSWORD)"
	env_credential_line "mail-sync (API interne)" \
		"Authorization: Bearer $(env_get "$ENV_FILE" MAIL_SYNC_INTERNAL_TOKEN)"
	env_credential_line "Supabase Studio" "sans authentification en développement"
	env_credential_line "Inbucket" "sans authentification : puits des emails transactionnels"
}

# --- Validation ---------------------------------------------------------------------------------
# Le gabarit est le contrat : toute variable dont l'exemple est non vide doit exister et être
# renseignée. Une variable à exemple vide est facultative et peut manquer d'un ancien `.env`.

env_validate() {
	[ -f "$ENV_FILE" ] || die "fichier d'environnement $ENV_FILE absent. Lancez ./runDev.sh, ou copiez .env.example."
	[ -f "$ENV_EXAMPLE" ] || die "gabarit $ENV_EXAMPLE introuvable."

	local problems=0 name example_value actual_value
	while IFS= read -r name; do
		example_value=$(env_get "$ENV_EXAMPLE" "$name")
		if ! env_has "$ENV_FILE" "$name"; then
			if [ -n "$example_value" ]; then
				printf '\033[31m  manquante\033[0m %s\n' "$name" >&2
				problems=$((problems + 1))
			fi
			continue
		fi
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

# Valeur réellement interpolée par Compose : une variable exportée par le shell prévaut sur le
# fichier passé par `--env-file`, y compris lorsqu'elle est explicitement vide.
env_effective_npm_ca_file() {
	if [ "${NPM_CA_FILE+x}" = x ]; then
		printf '%s' "$NPM_CA_FILE"
	else
		env_get "$ENV_FILE" NPM_CA_FILE
	fi
}

# Refuse une configuration CA inutilisable avant toute requête au démon. Le certificat n'est
# jamais affiché ni copié : seule sa forme de fichier PEM est vérifiée (décision 280).
env_require_dev_npm_ca_file() {
	local ca_file
	ca_file=$(env_effective_npm_ca_file)
	[ -z "$ca_file" ] && return 0
	case "$ca_file" in
		/*) ;;
		*) die "NPM_CA_FILE doit être un chemin absolu vers un fichier PEM lisible ; valeur relative refusée." ;;
	esac
	[ -f "$ca_file" ] || die "NPM_CA_FILE ne désigne pas un fichier régulier lisible."
	[ -r "$ca_file" ] || die "NPM_CA_FILE désigne un fichier qui n'est pas lisible."
	[ -s "$ca_file" ] || die "NPM_CA_FILE désigne un fichier vide ; laissez plutôt la variable vide."
	grep -q -- '-----BEGIN CERTIFICATE-----' "$ca_file" \
		|| die "NPM_CA_FILE ne contient aucun bloc PEM BEGIN CERTIFICATE."
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

# Le seed de développement porte un domaine entrant fixe. Stalwart provisionne son catch-all à
# partir de `.env` : accepter une autre valeur produirait deux mondes sains séparément, mais aucun
# message adressé par le CRM n'atteindrait la boîte système (docs/JOURNAL.md décision 245).
env_require_dev_inbound_domain() {
	local expected=crm.p2enjoy.test actual
	actual=$(env_get "$ENV_FILE" CRM_INBOUND_DOMAIN)
	if [ "$actual" != "$expected" ]; then
		die "CRM_INBOUND_DOMAIN vaut « ${actual:-<vide>} », or le seed de développement porte « $expected ».
        Corrigez $ENV_FILE explicitement : le catch-all Stalwart viserait sinon le mauvais domaine."
	fi
}

# Les liens transactionnels de GoTrue reviennent vers SITE_URL. En développement, cette origine
# doit donc désigner exactement le Vite publié par l'overlay et faire partie des redirections
# autorisées. La garde est indépendante de Docker afin que `runDev.sh --bootstrap` puisse révéler
# une configuration inutilisable sans démarrer ni interroger la pile (décision 272).
env_require_dev_webapp_origin() {
	local bind port expected site redirects
	bind=$(env_get "$ENV_FILE" DEV_BIND_ADDRESS)
	port=$(env_get "$ENV_FILE" WEBAPP_DEV_PORT)
	expected="http://${bind}:${port}"
	site=$(env_get "$ENV_FILE" SITE_URL)
	redirects=$(env_get "$ENV_FILE" ADDITIONAL_REDIRECT_URLS)

	if [ "$site" != "$expected" ]; then
		die "SITE_URL vaut « ${site:-<vide>} », or la webapp de développement est publiée à « $expected ».
        Alignez SITE_URL sur DEV_BIND_ADDRESS et WEBAPP_DEV_PORT dans $ENV_FILE avant de démarrer."
	fi

	if ! printf '%s' "$redirects" | awk -v want="$expected" '
		BEGIN { RS = ","; found = 0 }
		{ gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if ($0 == want) found = 1 }
		END { exit found ? 0 : 1 }
	'; then
		die "ADDITIONAL_REDIRECT_URLS n'autorise pas l'origine webapp de développement « $expected ».
        Ajoutez cette origine comme entrée entière dans $ENV_FILE avant de démarrer."
	fi
}

# --- Identifiants de registre Docker -------------------------------------------------------------
# Sous WSL, `~/.docker/config.json` désigne fréquemment `desktop.exe` comme magasin
# d'identifiants. Chaque interrogation du registre traverse alors l'interopérabilité Windows.
# Isolé, l'appel répond ; en rafale, il rend une sortie vide — mesuré sur ce poste : 52 réponses
# vides sur 150 appels simultanés. Compose tirant ses images en parallèle, le client Docker lit
# cette sortie vide comme une erreur et abandonne le démarrage, sur ce message :
#
#     error getting credentials - err: exit status 1, out: ``
#
# La pile n'emploie que des images publiques : aucun identifiant ne lui est nécessaire. Les
# scripts dérivent donc une configuration Docker privée de ses assistants Windows, et n'y touchent
# rien d'autre — contexte courant, proxies, greffons restent ceux du poste, faute de quoi la
# commande viserait un autre démon que celui de l'utilisateur. Sur un hôte sans assistant Windows,
# conteneur d'intégration compris, ces fonctions ne font rien.
#
# Le répertoire dérivé vit hors du dépôt : il recopie la configuration du poste, qui peut porter
# des identifiants, et rien de tel n'a sa place dans un arbre versionné.

# `HOME` a un repli : `set -u` ferait échouer l'inclusion de cette bibliothèque dans un
# environnement qui ne le définit pas, alors qu'elle n'en a besoin que si la garde se déclenche.
DOCKER_CONFIG_DERIVED="${P2ENJOY_DOCKER_CONFIG_DIR:-${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/p2enjoy-crm/docker}"

# Rend la configuration Docker débarrassée de ses assistants d'identifiants `.exe`.
# Sortie vide si rien n'est à retirer ; code 1 si aucun outil ne sait relire du JSON sans risque.
# Le fichier d'origine n'est jamais modifié.
docker_config_without_exe_helpers() {
	local file=$1
	if command -v jq >/dev/null 2>&1; then
		jq '
			def is_exe: (type == "string") and endswith(".exe");
			. as $original
			| (if (.credsStore? | is_exe) then del(.credsStore) else . end)
			| (if (.credHelpers? | type) == "object"
			   then .credHelpers |= with_entries(select(.value | is_exe | not))
			   else . end)
			| (if has("credHelpers") and (.credHelpers == {}) then del(.credHelpers) else . end)
			| if . == $original then empty else . end
		' "$file"
	elif command -v python3 >/dev/null 2>&1; then
		python3 - "$file" <<-'PY'
			import json, sys

			with open(sys.argv[1], encoding="utf-8") as handle:
			    text = handle.read()
			original = json.loads(text)
			config = json.loads(text)

			def is_exe(value):
			    return isinstance(value, str) and value.endswith(".exe")

			if is_exe(config.get("credsStore")):
			    config.pop("credsStore")
			helpers = config.get("credHelpers")
			if isinstance(helpers, dict):
			    kept = {name: value for name, value in helpers.items() if not is_exe(value)}
			    if kept:
			        config["credHelpers"] = kept
			    else:
			        config.pop("credHelpers")

			if config != original:
			    json.dump(config, sys.stdout, indent=2)
			    sys.stdout.write("\n")
		PY
	else
		return 1
	fi
}

# Écarte les assistants d'identifiants Windows pour la durée du script, en exportant
# `DOCKER_CONFIG` vers une configuration dérivée. N'exporte rien s'il n'y avait rien à écarter.
docker_drop_windows_credential_helpers() {
	local source_dir source_file rewritten entry name
	source_dir="${DOCKER_CONFIG:-${HOME:-}/.docker}"
	source_file="$source_dir/config.json"

	[ -f "$source_file" ] || return 0
	# Filtre bon marché : sans binaire Windows nommé dans le fichier, il n'y a rien à faire.
	grep -q '\.exe"' "$source_file" || return 0

	if ! rewritten=$(docker_config_without_exe_helpers "$source_file"); then
		warn "assistant d'identifiants Windows nommé par $source_file, et aucun outil pour l'écarter."
		warn "Installez « jq » ou « python3 », ou retirez « credsStore » de ce fichier (README.md §11)."
		return 0
	fi
	[ -n "$rewritten" ] || return 0

	# Garde-fou avant un effacement récursif : le chemin est calculé, donc il se vérifie.
	[ -n "$DOCKER_CONFIG_DERIVED" ] && [ "$DOCKER_CONFIG_DERIVED" != / ] \
		|| die "chemin de configuration Docker dérivée invalide : « $DOCKER_CONFIG_DERIVED »."
	rm -rf "$DOCKER_CONFIG_DERIVED"
	mkdir -p "$DOCKER_CONFIG_DERIVED"
	chmod 700 "$DOCKER_CONFIG_DERIVED"
	# Le reste de la configuration d'origine demeure joignable — contextes, greffons, caches :
	# seul `config.json` est remplacé. Sans les contextes, un `currentContext` du poste
	# désignerait un démon introuvable.
	for entry in "$source_dir"/* "$source_dir"/.[!.]*; do
		[ -e "$entry" ] || continue
		name=$(basename "$entry")
		if [ "$name" != config.json ]; then
			ln -sfn "$entry" "$DOCKER_CONFIG_DERIVED/$name"
		fi
	done
	printf '%s\n' "$rewritten" > "$DOCKER_CONFIG_DERIVED/config.json"
	chmod 600 "$DOCKER_CONFIG_DERIVED/config.json"
	export DOCKER_CONFIG="$DOCKER_CONFIG_DERIVED"

	warn "assistant d'identifiants Windows écarté : il échoue en rafale sous WSL (README.md §11)."
	warn "Configuration Docker de cette exécution : $DOCKER_CONFIG"
	return 0
}

# --- Docker ------------------------------------------------------------------------------------

require_docker() {
	command -v docker >/dev/null 2>&1 || die "Docker est introuvable (README.md §3)."
	docker_drop_windows_credential_helpers
	docker info >/dev/null 2>&1 || die "le démon Docker ne répond pas. Démarrez-le, puis relancez."
	docker compose version >/dev/null 2>&1 || die "le greffon Docker Compose v2 est absent."
}

compose_dev()  { docker compose --env-file "$ENV_FILE" "${DEV_COMPOSE[@]}" "$@"; }
compose_prod() { docker compose --env-file "$ENV_FILE" "${PROD_COMPOSE[@]}" "$@"; }

# Points de montage que l'hôte doit posséder avant que Compose ne démarre.
# Le service `webapp` monte un volume nommé sur `/app/node_modules`, chemin situé à l'intérieur du
# dépôt lui-même monté en `/app`. Si ce répertoire n'existe pas sur l'hôte, c'est le démon Docker
# qui le crée — donc `root`, sur un poste où le démon ne pratique pas de `userns-remap`. Le compte
# de l'utilisateur ne peut alors plus écrire dans son propre dépôt, et `npm install` échoue en
# `EACCES`. Le créer d'avance le laisse à son propriétaire légitime.
ensure_host_mountpoints() {
	mkdir -p "$REPO_ROOT/node_modules"
}

# --- Ports de l'hôte -----------------------------------------------------------------------------
# Compose ne découvre un port déjà pris qu'au moment de créer le conteneur concerné : la moitié de
# la pile est alors démarrée, et le démon ne rend qu'un numéro de port, sans dire à qui il est ni
# quelle variable le porte. Sur un poste qui héberge d'autres projets, c'est le mode d'échec le
# plus fréquent — mesuré ici : trois ports tenus par la pile Supabase d'un autre dépôt.
# Le contrôle ci-dessous a lieu avant tout démarrage, et nomme le port, son détenteur et la
# variable du fichier d'environnement à changer. Il ne choisit jamais un port à la place de
# l'opérateur : les URL documentées et les preuves en dépendent.

# Ports TCP en écoute d'après les tables du noyau Linux. Le convertisseur hexadécimal est écrit en
# awk portable : `strtonum()` n'existe ni dans toutes les implémentations d'awk, ni dans BusyBox.
# Les deux tables sont lues séparément afin qu'un hôte sans IPv6 reste inspectable par IPv4.
proc_listening_ports() {
	local file readable=false status=0
	local -a files=("$@")
	if [ "${#files[@]}" -eq 0 ]; then
		files=(/proc/net/tcp /proc/net/tcp6)
	fi
	for file in "${files[@]}"; do
		[ -r "$file" ] || continue
		readable=true
		awk '
			function hex_to_decimal(hex, result, digit, i) {
				hex = toupper(hex)
				result = 0
				for (i = 1; i <= length(hex); i++) {
					digit = index("0123456789ABCDEF", substr(hex, i, 1)) - 1
					if (digit < 0) return -1
					result = result * 16 + digit
				}
				return result
			}
			$4 == "0A" {
				split($2, address, ":")
				port = hex_to_decimal(address[2])
				if (port >= 0) print port
			}
		' "$file" || status=1
	done
	[ "$readable" = true ] && [ "$status" -eq 0 ]
}

# Ports TCP en écoute sur l'hôte, un par ligne. `ss` et `netstat` restent prioritaires ; les
# tables du noyau ferment leur angle mort sur une installation Linux minimale. Le code de retour
# distingue une source valide ne portant aucun listener (succès, sortie vide) d'un hôte réellement
# impossible à inspecter (échec).
host_listening_ports() {
	if command -v ss >/dev/null 2>&1; then
		ss -ltn 2>/dev/null | tail -n +2 | awk '{ n = split($4, a, ":"); print a[n] }' | sort -un
	elif command -v netstat >/dev/null 2>&1; then
		netstat -ltn 2>/dev/null | awk '/^tcp/ { n = split($4, a, ":"); print a[n] }' | sort -un
	elif proc_listening_ports; then
		return 0
	else
		return 1
	fi
}

# Ports publiés sur l'hôte par un assemblage, d'après Compose lui-même : la liste ne peut pas
# diverger des fichiers Compose.
#   compose_published_ports compose_dev
compose_published_ports() {
	"$@" config 2>/dev/null \
		| sed -n 's/^ *published: "\{0,1\}\([0-9][0-9]*\)"\{0,1\} *$/\1/p' | sort -un
}

# Table « port détenteur » des ports publiés par les conteneurs en marche, un par ligne. Les
# plages annoncées par Docker — « 127.0.0.1:9000-9001->9000-9001/tcp » — sont développées port par
# port : sans cela, un port de la pile passerait pour tenu par un tiers.
docker_published_ports() {
	docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | awk -F'\t' '
		{
			count = split($2, entries, ", ")
			for (i = 1; i <= count; i++) {
				if (match(entries[i], /:[0-9]+(-[0-9]+)?->/)) {
					spec = substr(entries[i], RSTART + 1, RLENGTH - 3)
					if (split(spec, bounds, "-") == 2) {
						for (p = bounds[1]; p <= bounds[2]; p++) print p, $1
					} else {
						print spec, $1
					}
				}
			}
		}'
}

# Variables du fichier d'environnement qui portent cette valeur de port, séparées par des virgules.
env_names_for_port() {
	awk -F= -v want="$2" '
		$1 ~ /^[A-Za-z_][A-Za-z0-9_]*$/ && $2 == want { printf "%s%s", sep, $1; sep = ", " }
		END { print "" }' "$1"
}

# Refuse de démarrer si un port publié par l'assemblage est déjà tenu par un autre programme.
# Les ports tenus par la pile elle-même sont ignorés : relancer une pile en marche reste permis.
# Les ports passés en arguments le sont également : c'est ce que fait `runDev.sh --dev`, qui
# écarte la webapp conteneurisée justement parce qu'un Vite de l'IDE tient déjà ce port.
#   require_free_ports compose_dev [port_ignoré...]
require_free_ports() {
	local compose_fn=$1 listening ours published port owner names busy=""
	shift
	local ignored=" $* "

	if ! listening=$(host_listening_ports); then
		warn "ports de l'hôte non inspectables (ni « ss », ni « netstat », ni tables /proc) : un conflit de port"
		warn "resterait invisible jusqu'à l'échec de Compose."
		return 0
	fi
	ours=$("$compose_fn" ps -a --format '{{.Name}}' 2>/dev/null || true)
	published=$(docker_published_ports)

	while IFS= read -r port; do
		[ -n "$port" ] || continue
		case "$ignored" in *" $port "*) continue ;; esac
		printf '%s\n' "$listening" | grep -qx "$port" || continue
		owner=$(printf '%s\n' "$published" | awk -v want="$port" '$1 == want { print $2; exit }')
		if [ -n "$owner" ] && printf '%s\n' "$ours" | grep -qx "$owner"; then
			continue
		fi
		[ -n "$owner" ] || owner="un programme hors Docker"
		names=$(env_names_for_port "$ENV_FILE" "$port")
		busy="$busy
  port $port tenu par $owner — variable ${names:-aucune}"
	done <<-EOF
		$(compose_published_ports "$compose_fn")
	EOF

	[ -z "$busy" ] || die "port(s) déjà pris sur cet hôte, la pile ne peut pas démarrer :$busy

        Changez ces valeurs dans $(basename "$ENV_FILE"), ou libérez les ports, puis relancez.
        Le fichier d'environnement est propre au poste : le modifier ne change rien au dépôt."
}

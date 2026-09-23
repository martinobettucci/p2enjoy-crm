#!/usr/bin/env bash
# @verifies CRM-090 (docs/BACKLOG.md) — production sur la cellule Spark : fusion, gardes, assemblage,
#           propositions et livraison
# @verifies docs/SPEC-deploiement-spark.md §3 (assemblage), §4.1 (fusion), §4.2 (variables sans
#           objet), §4.4 (proposer), §5.1 (livrer), §5.2 (premier déploiement), §9 (preuves)
# @verifies docs/JOURNAL.md décisions 567, 570, 571, 575 et 577 (image Realtime dérivée)
#
# Rejoue les preuves de `CRM-090` qui ne demandent PAS la cellule :
#
#   1. la fusion des fichiers injectés — ordre des sources, `$` littéral, guillemets, variables sans
#      objet, refus nommés sans jamais afficher une valeur ;
#   2. les gardes de `./runProd.sh --spark`, qui doivent toutes précéder Docker ;
#   3. l'assemblage résolu par Compose — un seul port publié, aucun 80/443, aucune valeur de
#      remplissage consommée, une limite mémoire partout ;
#   4. les deux Caddyfile, validés par le binaire épinglé ; l'image Realtime dérivée, construite
#      puis inspectée — aucun identifiant hors de la plage de la cellule ;
#   5. `scripts/spark/proposer.sh` sur des fichiers `.?` jetables — propositions complètes au regard
#      du contrat, secrets jamais affichés, refus sans écriture ;
#   6. `scripts/spark/livrer.sh` contre une cellule SIMULÉE — faux `ssh` qui exécute localement,
#      faux `npm` qui enregistre ce que le build a reçu ;
#   7. des dégradations volontaires, qui doivent chacune faire rougir le contrôle qu'elles visent.
#
# La preuve dans la cellule elle-même est le §7 de la spécification, relevé dans
# docs/PROD_MIGRATIONS.md. Aucun contrôle ne touche au `.env` du poste ni à /etc/spark.
#
# Usage :
#   scripts/verify-spark.sh

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

# Rien de l'appelant ne doit fuir dans les scénarios : chacun pose ses propres chemins.
unset SPARK_ENV_FILE SPARK_SECRETS_FILE P2ENJOY_SPARK_RUNTIME_DIR P2ENJOY_ENV_FILE \
	SPARK_ENV_PROPOSAL SPARK_SECRETS_PROPOSAL SPARK_ROUTES_PROPOSAL COMPOSE_PROJECT_NAME

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
checks=0
skips=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
skip() { skips=$((skips + 1)); printf '  \033[33mIGNORE\033[0m %s\n' "$1"; }

# shellcheck source=lib/env.sh
source "$REPO_ROOT/scripts/lib/env.sh"
# `env.sh` pose `set -e` ; un harnais doit survivre à ses propres échecs.
set +e

MARQUE="# --- fin du bloc posé par sparkd, écrivez ci-dessous ---"
FAUX_DOCKER="unix://$WORK/aucun-demon.sock"

# Un couple de fichiers injectés CONFORME, tiré au hasard, tel que la console le poserait.
#   fichiers_conformes <répertoire>
fichiers_conformes() {
	local dir=$1 jwt
	mkdir -p "$dir"
	jwt=$(gen_hex 32)
	cat > "$dir/env" <<-EOF
		P2ENJOY_ENV_PROFILE=prod
		APPLY_MIGRATIONS=false
		APP_DOMAIN=crm.exemple.tld
		API_EXTERNAL_URL=https://crm.exemple.tld
		SUPABASE_PUBLIC_URL=https://crm.exemple.tld
		SITE_URL=https://crm.exemple.tld
		ADDITIONAL_REDIRECT_URLS=https://crm.exemple.tld
		SPARK_HTTP_PORT=8080
		ANON_KEY=$(jwt_hs256 "$jwt" anon)
		SSO_OIDC_ISSUER=https://oauth.exemple.tld/realms/lelabs
		SSO_OIDC_CLIENT_ID=lelabs-crm-serveur
		SMTP_HOST=smtp.exemple.tld
		SMTP_PORT=2587
		SMTP_ADMIN_EMAIL=no-reply@exemple.tld
	EOF
	cat > "$dir/secrets" <<-EOF
		POSTGRES_PASSWORD=$(gen_hex 24)
		JWT_SECRET=$jwt
		SERVICE_ROLE_KEY=$(jwt_hs256 "$jwt" service_role)
		SECRET_KEY_BASE=$(gen_hex 32)
		REALTIME_DB_ENC_KEY=$(gen_hex 8)
		MAIL_SYNC_INTERNAL_TOKEN=$(gen_hex 32)
		MINIO_ROOT_USER=crm$(gen_hex 8)
		MINIO_ROOT_PASSWORD=$(gen_hex 20)
		S3_PROTOCOL_ACCESS_KEY_ID=$(gen_hex 16)
		S3_PROTOCOL_ACCESS_KEY_SECRET=$(gen_hex 32)
		SSO_OIDC_CLIENT_SECRET=$(gen_hex 32)
	EOF
}

# Fusion dans un sous-shell : `die` y sort sans emporter le harnais.
#   fusion <env> <secrets> <runtime>  — rend le chemin produit, code non nul sur refus
fusion() {
	( SPARK_ENV_FILE=$1 SPARK_SECRETS_FILE=$2 P2ENJOY_SPARK_RUNTIME_DIR=$3
	  source "$REPO_ROOT/scripts/lib/env.sh"; spark_env_merge )
}

# `./runProd.sh --spark` sur des fichiers jetables, sans démon : une configuration conforme doit
# franchir toutes les gardes et n'échouer QUE sur `require_docker`.
#   prod_spark <env> <secrets> <runtime> [options...]
prod_spark() {
	local env=$1 secrets=$2 runtime=$3
	shift 3
	SPARK_ENV_FILE=$env SPARK_SECRETS_FILE=$secrets P2ENJOY_SPARK_RUNTIME_DIR=$runtime \
		DOCKER_HOST=$FAUX_DOCKER "$REPO_ROOT/runProd.sh" --spark "$@" 2>&1
}

# --- 1. Fusion ---------------------------------------------------------------------------------

echo "1. Fusion des fichiers injectés"

F="$WORK/f1"
fichiers_conformes "$F"
printf 'APP_DOMAIN="dans.env.tld"\nSMTP_SENDER_NAME=Nom avec $LITTERAL\n' >> "$F/env"
printf 'APP_DOMAIN=gagnant.exemple.tld\nAWS_ACCESS_KEY_ID=fournie\n' >> "$F/secrets"
if sortie=$(fusion "$F/env" "$F/secrets" "$F/run"); then
	ok "fusion d'un couple conforme"
	[ "$(stat -c %a "$sortie")" = 600 ] && [ "$(stat -c %a "$F/run")" = 700 ] \
		&& ok "fichier en 600, répertoire en 700" || fail "droits : $(stat -c %a "$sortie") / $(stat -c %a "$F/run")"
	[ "$(env_get "$sortie" APP_DOMAIN)" = gagnant.exemple.tld ] \
		&& ok "les secrets l'emportent sur les variables, qui l'emportent sur le gabarit" \
		|| fail "ordre des sources : APP_DOMAIN = $(env_get "$sortie" APP_DOMAIN)"
	[ "$(env_get "$sortie" SMTP_SENDER_NAME)" = 'Nom avec $LITTERAL' ] \
		&& ok "« \$ » reste littéral, espaces conservés" || fail "valeur altérée : $(env_get "$sortie" SMTP_SENDER_NAME)"
	[ "$(env_get "$sortie" POSTGRES_PORT)" = "$(env_get "$ENV_EXAMPLE" POSTGRES_PORT)" ] \
		&& ok "une valeur non injectée vient du gabarit" || fail "POSTGRES_PORT non repris du gabarit"
	[ "$(env_get "$sortie" CADDY_ACME_EMAIL)" = "$SPARK_SANS_OBJET_VALEUR" ] \
		&& [ "$(env_get "$sortie" AWS_ACCESS_KEY_ID)" = fournie ] \
		&& ok "variable sans objet remplie si absente, conservée si fournie" \
		|| fail "variables sans objet : $(env_get "$sortie" CADDY_ACME_EMAIL) / $(env_get "$sortie" AWS_ACCESS_KEY_ID)"
	manquantes=$(LC_ALL=C comm -23 <(env_names "$ENV_EXAMPLE" | LC_ALL=C sort -u) <(env_names "$sortie" | LC_ALL=C sort -u))
	[ -z "$manquantes" ] && ok "toutes les variables du gabarit sont présentes" \
		|| fail "variables perdues par la fusion : $manquantes"
	[ "$(env_names "$sortie" | sort | uniq -d)" = "" ] && ok "aucun nom en double" || fail "noms en double"
else
	fail "fusion d'un couple conforme refusée"
fi

F2="$WORK/f2"
fichiers_conformes "$F2"
fusion "$F2/env" "$F2/secrets" "$F2/run" >/dev/null
if out=$(fusion "$F2/env" "$F2/absent" "$F2/run" 2>&1); then
	fail "fichier de secrets absent accepté"
else
	case "$out" in *"$F2/absent absent"*) ok "fichier de secrets absent refusé, chemin nommé" ;;
		*) fail "refus sans le chemin : $out" ;; esac
fi
if fusion "$F2/absent" "$F2/secrets" "$F2/run" >/dev/null 2>&1; then
	fail "fichier de variables absent accepté"
else
	ok "fichier de variables absent refusé"
fi
printf 'ligne sans signe egal\n' >> "$F2/env"
if out=$(fusion "$F2/env" "$F2/secrets" "$F2/run" 2>&1); then
	fail "ligne hors grammaire acceptée"
else
	case "$out" in *"hors grammaire"*) ok "ligne hors grammaire refusée, ligne nommée" ;; *) fail "refus muet : $out" ;; esac
	[ ! -e "$F2/run/spark.env" ] && ok "l'environnement d'une invocation précédente ne survit pas au refus" \
		|| fail "environnement périmé laissé en place après refus"
fi
fichiers_conformes "$F2"
printf "SMTP_PASS=secret'apostrophe-TEMOIN\n" >> "$F2/secrets"
if out=$(fusion "$F2/env" "$F2/secrets" "$F2/run" 2>&1); then
	fail "valeur à apostrophe acceptée"
else
	case "$out" in *SMTP_PASS*) ok "valeur à apostrophe refusée, variable nommée" ;; *) fail "refus sans nom : $out" ;; esac
	case "$out" in *TEMOIN*) fail "le refus affiche la valeur du secret" ;; *) ok "le refus n'affiche aucune valeur" ;; esac
fi

# --- 2. Gardes de ./runProd.sh --spark ---------------------------------------------------------------

echo
echo "2. Gardes de ./runProd.sh --spark — toutes avant Docker"

G="$WORK/g"
fichiers_conformes "$G"
out=$(prod_spark "$G/env" "$G/secrets" "$G/run")
case "$out" in *"démon Docker ne répond pas"*) ok "configuration conforme : toutes les gardes franchies, arrêt sur le seul démon absent" ;;
	*) fail "configuration conforme refusée avant Docker : $(printf '%s' "$out" | head -n 3 | tr '\n' ' ')" ;; esac

garde() {
	local libelle=$1 attendu=$2 fichier=$3 ligne=$4
	shift 4
	fichiers_conformes "$G"
	if [ -n "$ligne" ]; then printf '%s\n' "$ligne" >> "$G/$fichier"; fi
	out=$(prod_spark "$G/env" "$G/secrets" "$G/run" "$@")
	case "$out" in
		*"démon Docker"*) fail "$libelle : garde franchie jusqu'à Docker" ;;
		*"$attendu"*) ok "$libelle" ;;
		*) fail "$libelle : message inattendu — $(printf '%s' "$out" | head -n 2 | tr '\n' ' ')" ;;
	esac
}
garde "profil dev refusé" "P2ENJOY_ENV_PROFILE" env "P2ENJOY_ENV_PROFILE=dev"
garde "APPLY_MIGRATIONS=true refusé" "APPLY_MIGRATIONS" env "APPLY_MIGRATIONS=true"
garde "secret non importé refusé, nommé" "POSTGRES_PASSWORD" secrets "POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_PASSWORD"
garde "variable obligatoire vide refusée" "SMTP_HOST" env "SMTP_HOST="
garde "--premier-deploiement sans --migrate refusé" "n'a de sens qu'avec --migrate" env "" --premier-deploiement
out=$(SPARK_ENV_FILE="$G/env" SPARK_SECRETS_FILE="$G/aucun" P2ENJOY_SPARK_RUNTIME_DIR="$G/run" \
	DOCKER_HOST=$FAUX_DOCKER ./runProd.sh --spark 2>&1)
case "$out" in *"$G/aucun absent"*) ok "secrets non reposés après redémarrage : refus nommé" ;;
	*) fail "secrets absents : $(printf '%s' "$out" | head -n 2 | tr '\n' ' ')" ;; esac

# --- 3. Assemblage résolu ------------------------------------------------------------------------

echo
echo "3. Assemblage résolu de la cellule"

# Vérifie un assemblage à trois fichiers ; rend le nombre d'écarts, et n'imprime que s'il est bavard.
#   verifier_assemblage <répertoire des fichiers Compose> <environnement fusionné> <bavard 0|1>
verifier_assemblage() {
	local dir=$1 env=$2 bavard=$3 json erreurs
	if ! json=$(docker compose --env-file "$env" -f "$dir/docker-compose.yml" \
		-f "$dir/docker-compose.prod.yml" -f "$dir/docker-compose.spark.yml" config --format json 2>"$WORK/config.err"); then
		[ "$bavard" = 1 ] && fail "docker compose config : $(head -n 2 "$WORK/config.err" | tr '\n' ' ')"
		return 1
	fi
	[ -s "$WORK/config.err" ] && [ "$bavard" = 1 ] && fail "avertissements de Compose : $(head -n 2 "$WORK/config.err" | tr '\n' ' ')"
	erreurs=$(printf '%s' "$json" | SPARK_HTTP_PORT=$(env_get "$env" SPARK_HTTP_PORT) ENVF=$env \
		REMPLISSAGE=$SPARK_SANS_OBJET_VALEUR MINIO_USER=$(env_get "$env" MINIO_ROOT_USER) python3 -c '
import json, os, sys
d = json.load(sys.stdin)
valeurs = {}
for l in open(os.environ["ENVF"]):
    k, _, v = l.rstrip("\n").partition("=")
    valeurs[k] = v[1:-1] if v[:1] == v[-1:] == chr(39) else v
s = d["services"]
port = os.environ["SPARK_HTTP_PORT"]
e = []
publies = {n: [str(p.get("published")) for p in v.get("ports", [])] for n, v in s.items() if v.get("ports")}
if publies != {"caddy": [port]}:
    e.append(f"ports publiés {publies}, attendu caddy:{port} seul")
cibles = [p.get("target") for p in s.get("caddy", {}).get("ports", [])]
if cibles != [8080]:
    e.append(f"cible du port de caddy {cibles}")
texte = json.dumps(d)
if os.environ["REMPLISSAGE"] in texte:
    e.append("valeur de remplissage consommée par la configuration")
sans_limite = sorted(n for n, v in s.items() if not v.get("mem_limit"))
if sans_limite:
    e.append(f"services sans limite mémoire : {sans_limite}")
if s.get("kong", {}).get("environment", {}).get("KONG_NGINX_WORKER_PROCESSES") != "1":
    e.append("Kong sans KONG_NGINX_WORKER_PROCESSES=1")
if not s.get("minio", {}).get("image", "").startswith("quay.io/minio/minio:"):
    e.append("image MinIO hors quay.io")
rt = s.get("realtime", {})
image_rt = rt.get("image")
tirage_rt = rt.get("pull_policy")
if image_rt != "p2enjoy/realtime-spark:v2.102.3" or tirage_rt != "never":
    e.append(f"realtime : image {image_rt}, pull_policy {tirage_rt} ; attendu : image dérivée, jamais tirée")
st = s.get("storage", {}).get("environment", {})
if st.get("GLOBAL_S3_ENDPOINT") != "http://minio:9000" or st.get("AWS_ACCESS_KEY_ID") != os.environ["MINIO_USER"]:
    e.append("storage ne vise pas le MinIO interne avec ses identifiants")
montages = {v.get("target"): os.path.basename(v.get("source", "")) for v in s.get("caddy", {}).get("volumes", [])}
if montages.get("/etc/caddy/Caddyfile") != "Caddyfile.spark" or montages.get("/etc/caddy/routes.caddy") != "routes.caddy":
    e.append(f"montages de caddy {montages}")
if s.get("caddy", {}).get("environment"):
    e.append("caddy reçoit encore un environnement")
# Moindre privilège, mesuré le 2026-09-23 (docs/SPEC-deploiement-spark.md §3, décision 567) :
# chaque secret atteint SEULEMENT les services qui le consomment. Un env_file posé sur un service
# le remettrait à tous ; Compose le résout dans environment, et cette comparaison le voit.
attendus = {
    # functions depuis CRM-092 (décision 584) : son échangeur de session signe le jeton interne.
    "JWT_SECRET": ["auth", "db", "functions", "realtime", "rest", "storage"],
    "POSTGRES_PASSWORD": ["auth", "db", "migrations-runner", "realtime", "rest", "storage"],
    "SERVICE_ROLE_KEY": ["functions", "kong", "mail-sync", "storage"],
    "MINIO_ROOT_PASSWORD": ["minio", "minio-createbucket", "storage"],
    "MAIL_SYNC_INTERNAL_TOKEN": ["mail-sync"],
}
for nom, qui in attendus.items():
    recu = sorted(n for n, v in s.items() if valeurs[nom] in json.dumps(v))
    if recu != qui:
        e.append(f"{nom} atteint {recu}, attendu {qui}")
print("\n".join(e))
')
	if [ -n "$erreurs" ]; then
		[ "$bavard" = 1 ] && printf '%s\n' "$erreurs" | while IFS= read -r l; do fail "$l"; done
		return 1
	fi
	return 0
}

if docker compose version >/dev/null 2>&1; then
	A="$WORK/a"
	fichiers_conformes "$A"
	ENV_A=$(fusion "$A/env" "$A/secrets" "$A/run")
	if verifier_assemblage "$REPO_ROOT" "$ENV_A" 1; then
		ok "un seul port publié (caddy, SPARK_HTTP_PORT → 8080), aucun 80/443, MinIO sans port"
		ok "aucune valeur de remplissage consommée ; Kong à un processus ; limite mémoire partout"
		ok "Caddy monte Caddyfile.spark et routes.caddy, sans environnement"
		ok "chaque secret n'atteint que les services qui le consomment — Caddy n'en reçoit aucun"
	fi
else
	skip "docker compose indisponible : assemblage non résolu"
fi

# --- 4. Caddyfile ------------------------------------------------------------------------------------

echo
echo "4. Caddyfile, validés par le binaire épinglé"

if docker info >/dev/null 2>&1; then
	for cf in Caddyfile Caddyfile.spark; do
		if docker run --rm -v "$REPO_ROOT/caddy:/etc/caddy:ro" -e APP_DOMAIN=crm.exemple.tld \
			-e CADDY_ACME_EMAIL=a@exemple.tld caddy:2.9-alpine \
			caddy validate --config "/etc/caddy/$cf" --adapter caddyfile >"$WORK/caddy.out" 2>&1; then
			ok "caddy validate $cf"
		else
			fail "caddy validate $cf : $(tail -n 1 "$WORK/caddy.out")"
		fi
	done
else
	skip "démon Docker indisponible : Caddyfile non validés"
fi
grep -q 'import /etc/caddy/routes.caddy' caddy/Caddyfile && grep -q 'import /etc/caddy/routes.caddy' caddy/Caddyfile.spark \
	&& ok "les deux Caddyfile importent le même fragment de routes" || fail "un Caddyfile n'importe pas routes.caddy"
grep -q '/functions/v1/\*' caddy/routes.caddy && ok "/functions/v1/* relayé vers Kong" || fail "/functions/v1/* non relayé"
grep -q 'auto_https off' caddy/Caddyfile.spark && ok "Caddyfile.spark sans ACME" || fail "Caddyfile.spark tente ACME"

# L'image Realtime dérivée (décision 571) : sa source suit l'assemblage commun, et son étiquette est
# la même dans l'overlay et dans le script qui la transfère — trois endroits, une seule valeur.
source_commune=$(sed -n 's/^    image: \(supabase\/realtime:.*\)$/\1/p' docker-compose.yml)
source_derivee=$(sed -n 's/^FROM \(supabase\/realtime:[^ ]*\) AS source$/\1/p' supabase/docker/realtime-spark/Dockerfile)
etiquette_livrer=$(sed -n 's/^IMAGE_REALTIME_SPARK=//p' scripts/spark/livrer.sh)
etiquette_overlay=$(sed -n '/^  realtime:/,/^  [a-z]/s/^    image: //p' docker-compose.spark.yml)
[ -n "$source_commune" ] && [ "$source_commune" = "$source_derivee" ] \
	&& ok "l'image Realtime dérivée part de la version de l'assemblage commun ($source_commune)" \
	|| fail "image Realtime : assemblage commun « $source_commune », image dérivée « $source_derivee »"
[ -n "$etiquette_overlay" ] && [ "$etiquette_overlay" = "$etiquette_livrer" ] \
	&& ok "même étiquette dérivée dans l'overlay et dans livrer.sh ($etiquette_overlay)" \
	|| fail "étiquette dérivée : overlay « $etiquette_overlay », livrer.sh « $etiquette_livrer »"

# L'image dérivée dans sa forme LIVRÉE (décisions 571 et 575), construite comme livrer.sh la
# construit : aucun identifiant que la cellule ne sait pas représenter, ni dans ses couches, ni parmi
# les comptes vers lesquels `run.sh` bascule par `sudo` — ce second point a fait redémarrer Realtime
# en boucle dans la cellule, alors que le poste, qui a tous ses UID, le démarrait sain.
BORNE_UID_CELLULE=64534
if docker info >/dev/null 2>&1; then
	if docker build -q -t "$etiquette_livrer" supabase/docker/realtime-spark >"$WORK/rt-build.out" 2>&1; then
		docker save "$etiquette_livrer" > "$WORK/rt.tar"
		releve=$(python3 - "$WORK/rt.tar" "$BORNE_UID_CELLULE" <<'PY'
import json, sys, tarfile
borne = int(sys.argv[2])
entrees, hors = 0, []
with tarfile.open(sys.argv[1]) as image:
    for chemin in json.load(image.extractfile("manifest.json"))[0]["Layers"]:
        with tarfile.open(fileobj=image.extractfile(chemin)) as couche:
            for m in couche:
                entrees += 1
                if m.uid > borne or m.gid > borne:
                    hors.append(f"{m.name}={m.uid}:{m.gid}")
print(entrees, len(hors), " ".join(hors[:3]))
PY
)
		read -r entrees hors exemples <<< "$releve"
		[ "${entrees:-0}" -gt 0 ] && [ "$hors" = 0 ] \
			&& ok "image dérivée : $entrees entrées de couche, aucune au-delà de l'UID/GID $BORNE_UID_CELLULE" \
			|| fail "image dérivée : ${hors:-?} entrée(s) hors de la plage de la cellule — $exemples"
		comptes=$(docker run --rm --entrypoint sh "$etiquette_livrer" -c \
			'for u in $(sed -n "s/.*sudo -E -u \([a-z_]*\) .*/\1/p" /app/run.sh | sort -u); do echo "$u $(id -u "$u") $(id -g "$u")"; done')
		hors_comptes=$(printf '%s\n' "$comptes" | awk -v b="$BORNE_UID_CELLULE" 'NF && ($2 > b || $3 > b)')
		[ -n "$comptes" ] && [ -z "$hors_comptes" ] \
			&& ok "comptes cibles du sudo de run.sh dans la plage : $(printf '%s' "$comptes" | tr '\n' ';')" \
			|| fail "comptes cibles du sudo de run.sh : « $(printf '%s' "${hors_comptes:-aucun trouvé}" | tr '\n' ';') » hors de la plage"
		docker run --rm --entrypoint sh "$etiquette_livrer" -c 'sudo -E -u nobody sh -c "test -O /app/bin/migrate && test -w /app && test -w /app/.pgdelta-cache"' \
			&& ok "nobody possède /app et peut y écrire, comme dans l'image d'origine" \
			|| fail "nobody ne possède pas /app ou ne peut pas y écrire"
		config_rt() { docker image inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}} {{json .Config.WorkingDir}} {{json .Config.User}} {{json .Config.Env}}' "$1"; }
		[ "$(config_rt "$etiquette_livrer")" = "$(config_rt "$source_derivee")" ] \
			&& ok "configuration d'exécution identique à l'image d'origine" \
			|| fail "configuration d'exécution : dérivée « $(config_rt "$etiquette_livrer") », origine « $(config_rt "$source_derivee") »"
		rm -f "$WORK/rt.tar"
	else
		fail "construction de l'image dérivée : $(tail -n 1 "$WORK/rt-build.out")"
	fi
else
	skip "démon Docker indisponible : image Realtime dérivée non inspectée"
fi

# --- 5. proposer.sh ----------------------------------------------------------------------------------

echo
echo "5. scripts/spark/proposer.sh sur des fichiers .? jetables"

cellule_vierge() {
	local dir=$1 f
	rm -rf "$dir"; mkdir -p "$dir"
	for f in env.? secrets.? routes.?; do
		printf '# spark:suggestion — gabarit posé par le plan de contrôle\n#\n%s\n' "$MARQUE" > "$dir/$f"
	done
}
proposer() {
	local dir=$1
	shift
	SPARK_ENV_PROPOSAL="$dir/env.?" SPARK_SECRETS_PROPOSAL="$dir/secrets.?" \
		SPARK_ROUTES_PROPOSAL="$dir/routes.?" SPARK_SECRETS_FILE="$dir/secrets" \
		"$REPO_ROOT/scripts/spark/proposer.sh" "$@" 2>&1
}
empreintes() { sha256sum "$1/env.?" "$1/secrets.?" "$1/routes.?" | awk '{print $1}' | tr '\n' ' '; }

P="$WORK/p"
cellule_vierge "$P"
if out=$(proposer "$P"); then
	ok "propositions déposées dans une cellule vierge"
	fuite=""
	while IFS= read -r l; do
		valeur=${l#*=}
		[ -n "$valeur" ] && case "$out" in *"$valeur"*) fuite="$fuite ${l%%=*}" ;; esac
	done < <(grep -E '^[A-Z0-9_]+=' "$P/secrets.?")
	[ -z "$fuite" ] && ok "aucune valeur de secret sur la sortie du script" || fail "secrets affichés :$fuite"
	etiquettes=$(awk '/^[A-Z0-9_]+=/ { if (prec !~ /^# / || length(prec) > 120) print $0 } { prec = $0 }' "$P/env.?" "$P/secrets.?")
	[ -z "$etiquettes" ] && ok "chaque déclaration porte une étiquette d'une ligne, 120 caractères au plus" \
		|| fail "déclarations sans étiquette conforme : $(printf '%s' "$etiquettes" | cut -d= -f1 | tr '\n' ' ')"
	# `tls` : ce que la Forge expose au public. Une route `clair` n'est servie qu'en http:// (décision 576).
	[ "$(grep -vE '^#|^$' "$P/routes.?")" = "crm.lelabs.tech 8080 tls" ] \
		&& ok "route proposée : crm.lelabs.tech 8080 tls" || fail "route : $(grep -vE '^#|^$' "$P/routes.?")"
	demandes=$(grep -hE '^SMTP_(HOST|PORT|ADMIN_EMAIL|USER|PASS)=$' "$P/env.?" "$P/secrets.?" | wc -l)
	[ "$demandes" = 5 ] && ok "les cinq valeurs SMTP inconnues sont des DEMANDES vides" || fail "demandes SMTP : $demandes sur 5"
	jwt=$(env_get "$P/secrets.?" JWT_SECRET)
	verifier_jeton() {
		local jeton=$1 role=$2 signe
		signe=$(printf '%s' "${jeton%.*}" | openssl dgst -sha256 -hmac "$jwt" -binary | b64url)
		[ "$signe" = "${jeton##*.}" ] && printf '%s' "${jeton#*.}" | cut -d. -f1 | tr '_-' '/+' \
			| base64 -d 2>/dev/null | grep -q "\"role\":\"$role\""
	}
	verifier_jeton "$(env_get "$P/env.?" ANON_KEY)" anon && verifier_jeton "$(env_get "$P/secrets.?" SERVICE_ROLE_KEY)" service_role \
		&& ok "ANON_KEY et SERVICE_ROLE_KEY signées par le JWT_SECRET proposé, rôles justes" \
		|| fail "jetons proposés incohérents avec JWT_SECRET"

	# Le secret du client confidentiel est une DEMANDE, jamais un tirage : LeLabs l'émet, et seul
	# l'administrateur du realm le saisit (`CRM-092`, décision 586).
	if grep -q '^SSO_OIDC_CLIENT_SECRET=$' "$P/secrets.?" && ! grep -q '^SSO_OIDC_CLIENT_SECRET=$' "$P/env.?"; then
		ok "secret du client SSO laissé en demande, parmi les secrets, sans valeur tirée"
	else
		fail "secret du client SSO tiré, absent, ou proposé hors des secrets"
	fi
	[ "$(env_get "$P/env.?" SSO_OIDC_CLIENT_ID)" = lelabs-crm-serveur ] \
		&& ok "client SSO proposé : le client confidentiel lelabs-crm-serveur" \
		|| fail "client SSO proposé : « $(env_get "$P/env.?" SSO_OIDC_CLIENT_ID) »"

	# Les propositions, importées telles quelles et complétées des seules valeurs demandées — relais
	# SMTP et secret du client SSO —, doivent franchir toutes les gardes : c'est la preuve qu'elles
	# couvrent le contrat.
	I="$WORK/importe"
	mkdir -p "$I"
	sed -n "/^$MARQUE\$/,\$p" "$P/env.?" | grep -E '^[A-Z0-9_]+=' \
		| sed -e 's/^SMTP_HOST=$/SMTP_HOST=smtp.exemple.tld/' -e 's/^SMTP_PORT=$/SMTP_PORT=2587/' \
		      -e 's/^SMTP_ADMIN_EMAIL=$/SMTP_ADMIN_EMAIL=no-reply@exemple.tld/' > "$I/env"
	sed -n "/^$MARQUE\$/,\$p" "$P/secrets.?" | grep -E '^[A-Z0-9_]+=' \
		| sed -e 's/^SSO_OIDC_CLIENT_SECRET=$/SSO_OIDC_CLIENT_SECRET=secret-saisi-par-le-realm/' > "$I/secrets"
	out=$(prod_spark "$I/env" "$I/secrets" "$I/run")
	case "$out" in *"démon Docker ne répond pas"*) ok "propositions importées : toutes les gardes franchies" ;;
		*) fail "propositions incomplètes au regard du contrat : $(printf '%s' "$out" | grep -E 'manquante|vide|définir|ERREUR' | head -n 3 | tr '\n' ' ')" ;; esac

	avant=$(empreintes "$P")
	if proposer "$P" >/dev/null; then fail "proposition pendante écrasée"
	else [ "$(empreintes "$P")" = "$avant" ] && ok "proposition pendante : refus, fichiers inchangés" || fail "refus, mais fichiers modifiés"; fi
else
	fail "proposer.sh refuse une cellule vierge : $(printf '%s' "$out" | head -n 2 | tr '\n' ' ')"
fi
cellule_vierge "$P"
printf 'JWT_SECRET=en-service\n' > "$P/secrets"
avant=$(empreintes "$P")
if proposer "$P" >/dev/null; then fail "secrets en service remplacés"
else [ "$(empreintes "$P")" = "$avant" ] && ok "JWT_SECRET déjà en service : refus, fichiers inchangés" || fail "refus, mais fichiers modifiés"; fi
# La route seule reste proposable quand les secrets sont en service, sans toucher au reste.
env_avant=$(sha256sum "$P/env.?" "$P/secrets.?" "$P/secrets")
if out=$(proposer "$P" --route-seule); then
	[ "$(grep -vE '^#|^$' "$P/routes.?")" = "crm.lelabs.tech 8080 tls" ] \
		&& [ "$(sha256sum "$P/env.?" "$P/secrets.?" "$P/secrets")" = "$env_avant" ] \
		&& ok "--route-seule avec des secrets en service : route tls proposée, variables et secrets intacts" \
		|| fail "--route-seule : route « $(grep -vE '^#|^$' "$P/routes.?" | tr '\n' ';') » ou autres fichiers modifiés"
	avant=$(empreintes "$P")
	if proposer "$P" --route-seule >/dev/null; then fail "--route-seule : proposition de route pendante écrasée"
	else [ "$(empreintes "$P")" = "$avant" ] && ok "--route-seule : route pendante, refus, fichiers inchangés" || fail "--route-seule : refus, mais fichiers modifiés"; fi
else
	fail "--route-seule refusé avec des secrets en service : $(printf '%s' "$out" | head -n 1)"
fi
cellule_vierge "$P"
proposer "$P" --port 443 >/dev/null && fail "port 443 proposé" || ok "port inférieur à 1024 refusé"
cellule_vierge "$P"
proposer "$P" --smtp-port 587 >/dev/null && fail "port SMTP 587 proposé" || ok "port SMTP fermé par la Forge refusé"
cellule_vierge "$P"
if proposer "$P" --smtp-hote smtp.exemple.tld --smtp-port 2587 --smtp-expediteur no-reply@exemple.tld >/dev/null; then
	[ "$(env_get "$P/env.?" SMTP_HOST)|$(env_get "$P/env.?" SMTP_PORT)|$(env_get "$P/env.?" SMTP_ADMIN_EMAIL)" = "smtp.exemple.tld|2587|no-reply@exemple.tld" ] \
		&& [ -z "$(env_get "$P/secrets.?" SMTP_USER)" ] && [ -z "$(env_get "$P/secrets.?" SMTP_PASS)" ] \
		&& ok "relais proposé par option ; identifiants toujours laissés en demande" \
		|| fail "options SMTP mal reportées"
	# Propositions importées telles quelles, identifiants du relais ABSENTS : la pile doit démarrer,
	# car la connexion par le SSO ne dépend d'aucun courriel.
	I2="$WORK/importe-smtp"; mkdir -p "$I2"
	sed -n "/^$MARQUE\$/,\$p" "$P/env.?" | grep -E '^[A-Z0-9_]+=' > "$I2/env"
	sed -n "/^$MARQUE\$/,\$p" "$P/secrets.?" | grep -E '^[A-Z0-9_]+=' | grep -v '^SMTP_' \
		| sed -e 's/^SSO_OIDC_CLIENT_SECRET=$/SSO_OIDC_CLIENT_SECRET=secret-saisi-par-le-realm/' > "$I2/secrets"
	out=$(prod_spark "$I2/env" "$I2/secrets" "$I2/run")
	case "$out" in *"démon Docker ne répond pas"*) ok "sans identifiants SMTP, toutes les gardes sont franchies" ;;
		*) fail "identifiants SMTP exigés : $(printf '%s' "$out" | grep -E 'manquante|vide|définir' | head -n 2 | tr '\n' ' ')" ;; esac
else
	fail "proposer.sh refuse les options SMTP"
fi

# --- 6. livrer.sh contre une cellule simulée --------------------------------------------------------

echo
echo "6. scripts/spark/livrer.sh contre une cellule simulée"

L="$WORK/l"
mkdir -p "$L/bin" "$L/cellule/etc"
# Le clone porte l'état COURANT du poste — fichiers suivis et nouveaux —, committé dans le clone
# seul : le harnais éprouve ce qui va être livré, pas le dernier commit. Son « origin » est lui-même,
# pour que la garde « HEAD dans origin/main » porte sur ce clone et jamais sur le dépôt réel.
git clone -q --no-hardlinks "$REPO_ROOT" "$L/clone" 2>/dev/null
( cd "$REPO_ROOT" && git ls-files -co --exclude-standard -z | tar --null -T - -cf - 2>/dev/null ) \
	| tar -x -C "$L/clone"
( cd "$L/clone" && git config user.email verify@exemple.tld && git config user.name verify \
	&& git config core.hooksPath /dev/null && git add -A && git commit -q -m "état du poste" --allow-empty \
	&& git remote set-url origin "$L/clone" && git fetch -q origin )
fichiers_conformes "$L/injecte"
cp "$L/injecte/env" "$L/cellule/etc/env"
# Faux ssh : exécute localement la commande distante, /etc/spark/env étant redirigé vers la cellule
# simulée. Il journalise chaque commande reçue. L'image Realtime de la cellule est celle qu'étiquette
# $L/image-cellule, quand il existe ; un `docker load` n'est pas exécuté mais consigné.
cat > "$L/bin/ssh" <<EOF
#!/usr/bin/env bash
commande="\${@: -1}"
printf '%s\n' "\$commande" >> "$L/ssh.log"
commande="\${commande//\/etc\/spark\/env/$L/cellule/etc/env}"
case "\$commande" in
	*"docker image inspect"*) motif='$etiquette_livrer'
		[ -f "$L/image-cellule" ] && commande="\${commande//"\$motif"/\$(cat "$L/image-cellule")}" ;;
	*"docker load"*) commande="cat >/dev/null; echo chargement >> '$L/charges.log'" ;;
esac
exec bash -c "\$commande"
EOF
# Faux npm : consigne les variables reçues par le build et produit un index.html.
cat > "$L/bin/npm" <<EOF
#!/usr/bin/env bash
env | grep '^VITE_' | sort > "$L/build.env"
mkdir -p webapp/dist && echo "<!doctype html><title>build \$(date +%s%N)</title>" > webapp/dist/index.html
EOF
chmod +x "$L/bin/ssh" "$L/bin/npm"
livrer() { ( cd "$L/clone" && PATH="$L/bin:$PATH" SPARK_REPERTOIRE="$L/cellule/srv" \
	./scripts/spark/livrer.sh --sans-lancer "$@" 2>&1 ); }

out=$(livrer)
case "$out" in *"absent ou non inscriptible"*) ok "répertoire de l'application absent : refus nommant le geste de root" ;;
	*) fail "répertoire absent : $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')" ;; esac
mkdir -p "$L/cellule/srv"
mv "$L/cellule/etc/env" "$L/cellule/etc/env.attente"
if out=$(livrer --archive-seule); then
	[ -f "$L/cellule/srv/scripts/spark/proposer.sh" ] && [ ! -e "$L/build.env" ] && [ ! -e "$L/cellule/srv/webapp/dist/index.html" ] \
		&& ok "--archive-seule : dépôt livré sans variables importées, sans build ni webapp" \
		|| fail "--archive-seule a construit ou n'a rien livré"
else
	fail "--archive-seule refusé sans variables : $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
fi
mv "$L/cellule/etc/env.attente" "$L/cellule/etc/env"
mkdir -p "$L/cellule/srv/webapp/dist" && echo perime > "$L/cellule/srv/webapp/dist/perime.js"
if out=$(livrer); then
	ok "première livraison aboutie"
	[ "$(cat "$L/cellule/srv/REVISION")" = "$(git -C "$L/clone" rev-parse HEAD)" ] && ok "REVISION = HEAD livré" || fail "REVISION erronée"
	[ -f "$L/cellule/srv/runProd.sh" ] && [ -f "$L/cellule/srv/docker-compose.spark.yml" ] && ok "archive extraite dans le répertoire de l'application" || fail "archive non extraite"
	[ ! -e "$L/cellule/srv/webapp/dist/perime.js" ] && [ -f "$L/cellule/srv/webapp/dist/index.html" ] \
		&& ok "contenu de webapp/dist remplacé, le répertoire monté conservé" || fail "webapp/dist non remplacé"
	grep -q "^VITE_SUPABASE_URL=https://crm.exemple.tld$" "$L/build.env" \
		&& grep -q "^VITE_SUPABASE_ANON_KEY=$(env_get "$L/injecte/env" ANON_KEY)$" "$L/build.env" \
		&& grep -q "^VITE_SSO_ISSUER=https://oauth.exemple.tld/realms/lelabs$" "$L/build.env" \
		&& grep -q "^VITE_SSO_CLIENT_ID=lelabs-crm-serveur$" "$L/build.env" \
		&& ok "le build a reçu les variables publiques relues dans la cellule" || fail "variables du build : $(tr '\n' ' ' < "$L/build.env")"
	grep -q 'JWT_SECRET\|SERVICE_ROLE_KEY' "$L/build.env" && fail "un secret a atteint le build" || ok "aucun secret dans le build"
else
	fail "première livraison refusée : $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
fi
# L'image Realtime n'est transférée que si son CONTENU diffère de celui de la cellule (décision 577) :
# une reconstruction change l'identifiant, jamais les couches ni la configuration.
if docker info >/dev/null 2>&1; then
	docker build -q -t "$etiquette_livrer" supabase/docker/realtime-spark >/dev/null
	docker tag "$etiquette_livrer" verify-spark/realtime-cellule:simulee
	echo verify-spark/realtime-cellule:simulee > "$L/image-cellule"
	id_cellule=$(docker image inspect --format '{{.Id}}' verify-spark/realtime-cellule:simulee)
	rm -f "$L/charges.log"
	out=$(livrer)
	id_livre=$(docker image inspect --format '{{.Id}}' "$etiquette_livrer")
	[ "$id_livre" != "$id_cellule" ] && [ ! -e "$L/charges.log" ] && case "$out" in *"déjà présente"*) true ;; *) false ;; esac \
		&& ok "image reconstruite, identifiant nouveau, contenu égal : aucun transfert" \
		|| fail "image au contenu égal : $( [ -e "$L/charges.log" ] && echo transférée || echo 'non transférée') (identifiants $( [ "$id_livre" = "$id_cellule" ] && echo égaux || echo différents))"
	docker tag "$source_derivee" verify-spark/realtime-cellule:simulee
	rm -f "$L/charges.log"
	out=$(livrer)
	[ -s "$L/charges.log" ] && ok "image au contenu différent dans la cellule : transférée" || fail "image au contenu différent non transférée"
	docker rmi -f verify-spark/realtime-cellule:simulee >/dev/null 2>&1
	rm -f "$L/image-cellule" "$L/charges.log"
else
	skip "démon Docker indisponible : comparaison de l'image Realtime non éprouvée"
fi
( cd "$L/clone" && git rm -q docs/SSO.md && git commit -q -m "retrait" )
if out=$(livrer); then
	[ ! -e "$L/cellule/srv/docs/SSO.md" ] && ok "seconde livraison : fichier supprimé par Git retiré dans la cellule" \
		|| fail "fichier supprimé laissé dans la cellule"
else
	fail "seconde livraison refusée : $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
fi
echo modifie >> "$L/clone/README.md"
out=$(livrer)
case "$out" in *"modifications"*) ok "arbre modifié : livraison refusée" ;; *) fail "arbre modifié accepté" ;; esac
git -C "$L/clone" checkout -q README.md
sed -i '/^SSO_OIDC_CLIENT_ID=/d' "$L/cellule/etc/env"
out=$(livrer)
case "$out" in *"SSO_OIDC_CLIENT_ID absente"*) ok "variable publique non importée : refus nommé" ;; *) fail "variable manquante : $(printf '%s' "$out" | tail -n 1)" ;; esac

# --- 7. Dégradations ---------------------------------------------------------------------------------

echo
echo "7. Dégradations volontaires — chacune doit rougir"

if docker compose version >/dev/null 2>&1; then
	D="$WORK/d"
	degrader() {
		local libelle=$1 script=$2
		rm -rf "$D"; mkdir -p "$D"
		cp "$REPO_ROOT"/docker-compose.yml "$REPO_ROOT"/docker-compose.prod.yml "$REPO_ROOT"/docker-compose.spark.yml "$D/"
		ln -s "$REPO_ROOT/caddy" "$D/caddy"
		python3 -c "$script" "$D/docker-compose.spark.yml"
		if verifier_assemblage "$D" "$ENV_A" 0; then fail "dégradation non détectée : $libelle"
		else ok "détectée : $libelle"; fi
	}
	# Témoin : la copie non dégradée doit être VERTE, sinon les rouges ci-dessous ne prouvent rien.
	degrader_temoin() {
		rm -rf "$D"; mkdir -p "$D"
		cp "$REPO_ROOT"/docker-compose.yml "$REPO_ROOT"/docker-compose.prod.yml "$REPO_ROOT"/docker-compose.spark.yml "$D/"
		ln -s "$REPO_ROOT/caddy" "$D/caddy"
		verifier_assemblage "$D" "$ENV_A" 0 && ok "témoin : la copie intacte est verte" || fail "témoin rouge : les dégradations ne prouvent rien"
	}
	degrader_temoin
	degrader "Caddy publie 443" 'import sys; p=sys.argv[1]; s=open(p).read(); s=s.replace("      - \"${SPARK_HTTP_PORT}:8080\"", "      - \"${SPARK_HTTP_PORT}:8080\"\n      - \"443:443\"",1); open(p,"w").write(s)'
	degrader "limite mémoire retirée de storage" 'import sys; p=sys.argv[1]; s=open(p).read(); s=s.replace("  storage:\n    mem_limit: 512m\n","  storage:\n",1); open(p,"w").write(s)'
	degrader "environnement de Caddy hérité" 'import sys; p=sys.argv[1]; s=open(p).read(); s=s.replace("    environment: !reset {}\n","",1); open(p,"w").write(s)'
	degrader "env_file des secrets posé sur Caddy" "import sys; p=sys.argv[1]; s=open(p).read(); s=s.replace('  caddy:\n    mem_limit: 128m\n','  caddy:\n    mem_limit: 128m\n    env_file:\n      - $ENV_A\n',1); open(p,'w').write(s)"
	degrader "Kong sans borne de processus" 'import sys; p=sys.argv[1]; s=open(p).read(); s=s.replace("KONG_NGINX_WORKER_PROCESSES: \"1\"","KONG_NGINX_WORKER_PROCESSES: \"auto\"",1); open(p,"w").write(s)'
else
	skip "docker compose indisponible : dégradations d'assemblage non exécutées"
fi

# --- 8. amorcer-espace.sh contre la pile de développement ---------------------------------------------
#
# L'opération écrit en production ; elle s'éprouve donc ici, sur la pile locale, avec un fichier
# d'environnement de profil `prod` dérivé du `.env` du poste. Les lignes créées sont retirées.

echo
echo "8. scripts/spark/amorcer-espace.sh contre la pile de développement"

API_DEV="http://127.0.0.1:$(env_get "$REPO_ROOT/.env" KONG_HTTP_PORT 2>/dev/null)"
if [ -f "$REPO_ROOT/.env" ] && curl -sf -o /dev/null "$API_DEV/auth/v1/health" -H "apikey: $(env_get "$REPO_ROOT/.env" ANON_KEY)"; then
	E="$WORK/amorcage.env"
	sed -e 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=prod/' "$REPO_ROOT/.env" > "$E"
	SR=$(env_get "$E" SERVICE_ROLE_KEY)
	ADRESSE="amorcage-$(gen_hex 4)@exemple.test"
	SLUG_ESSAI="amorcage-$(gen_hex 4)"
	amorcer() { P2ENJOY_ENV_FILE=$E P2ENJOY_AMORCAGE_API=$API_DEV "$REPO_ROOT/scripts/spark/amorcer-espace.sh" \
		--email "$ADRESSE" --espace "Espace d'amorçage" --slug "$SLUG_ESSAI" --nom "Amorçage Preuve" 2>&1; }
	lire() { curl -s "$API_DEV$1" -H "apikey: $SR" -H "Authorization: Bearer $SR"; }
	if out=$(amorcer); then
		ok "premier passage abouti"
		case "$out" in *"compte invité créé"*"espace créé"*"administrateur"*) ok "compte invité, espace et appartenance créés" ;;
			*) fail "premier passage incomplet : $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')" ;; esac
		case "$out" in *verify*|*token=*|*action_link*) fail "le lien d'action apparaît dans la sortie" ;; *) ok "aucun lien d'action dans la sortie" ;; esac
		id_ws=$(lire "/rest/v1/workspaces?slug=eq.$SLUG_ESSAI&select=id" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')
		id_u=$(lire "/auth/v1/admin/users?per_page=1000" | python3 -c 'import json,sys; print(next((u["id"] for u in json.load(sys.stdin)["users"] if u["email"]==sys.argv[1]), ""))' "$ADRESSE")
		etat=$(lire "/auth/v1/admin/users/$id_u" | python3 -c 'import json,sys; u=json.load(sys.stdin); print(bool(u.get("invited_at")), u.get("email_confirmed_at") is None)')
		[ "$etat" = "True True" ] && ok "le compte est INVITÉ, non confirmé : aucun mot de passe n'existe" || fail "état du compte : $etat"
		role=$(lire "/rest/v1/workspace_members?workspace_id=eq.$id_ws&user_id=eq.$id_u&select=role" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["role"] if d else "")')
		[ "$role" = admin ] && ok "appartenance administrateur posée" || fail "appartenance : « $role »"
		out2=$(amorcer)
		case "$out2" in *"compte déjà présent"*"espace déjà présent"*) ok "second passage idempotent : rien n'est créé deux fois" ;;
			*) fail "second passage : $(printf '%s' "$out2" | tail -n 3 | tr '\n' ' ')" ;; esac
		n=$(lire "/rest/v1/workspace_members?workspace_id=eq.$id_ws&select=user_id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
		[ "$n" = 1 ] && ok "une seule appartenance après deux passages" || fail "$n appartenances"
		curl -s -o /dev/null -X DELETE "$API_DEV/rest/v1/workspace_members?workspace_id=eq.$id_ws" -H "apikey: $SR" -H "Authorization: Bearer $SR"
		curl -s -o /dev/null -X DELETE "$API_DEV/rest/v1/workspaces?id=eq.$id_ws" -H "apikey: $SR" -H "Authorization: Bearer $SR"
		curl -s -o /dev/null -X DELETE "$API_DEV/auth/v1/admin/users/$id_u" -H "apikey: $SR" -H "Authorization: Bearer $SR"
		# `CRM-092` (décisions 583 et 587) : sans la clé `profiles.id → auth.users`, retirée par 0075, le
		# profil ne suit plus le compte. La preuve retire le sien, faute de quoi chaque passage en
		# laissait un, orphelin, dans la base de développement. L'amorçage passe au SSO en T4.
		curl -s -o /dev/null -X DELETE "$API_DEV/rest/v1/profiles?id=eq.$id_u" -H "apikey: $SR" -H "Authorization: Bearer $SR"
	else
		fail "premier passage refusé : $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
	fi
	sed -i 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=dev/' "$E"
	out=$(P2ENJOY_ENV_FILE=$E P2ENJOY_AMORCAGE_API=$API_DEV "$REPO_ROOT/scripts/spark/amorcer-espace.sh" --email a@b.test --espace x --slug x 2>&1)
	case "$out" in *"P2ENJOY_ENV_PROFILE"*) ok "profil dev refusé : l'amorçage n'agit que sur une production" ;; *) fail "profil dev accepté" ;; esac
else
	skip "pile de développement injoignable : amorçage non éprouvé"
fi

# --- Bilan -------------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ] && [ "$skips" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie, mais $skips NON EXÉCUTÉE(S)." >&2
	exit 2
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

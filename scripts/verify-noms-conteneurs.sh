#!/usr/bin/env bash
# @verifies CRM-115 (docs/BACKLOG.md) — tranche T2 : plus aucun nom de conteneur en développement
# @verifies docs/SPEC-pile-par-session.md §6 (un conteneur se désigne par son service ; la garde et ses exceptions),
#           §6 bis (la production et la cellule gardent leurs noms) ; docs/JOURNAL.md décisions 702 et 703
#
# La garde de la tranche. Elle échoue dès qu'un nom de conteneur de la pile (`p2enjoy-db`, `p2enjoy-kong`…) réapparaît
# en littéral dans le code de développement, et elle prouve ce que la tranche promet d'autre :
#
#   1. aucun nom littéral hors des exceptions NOMMÉES ci-dessous ;
#   2. l'assemblage de développement ne fixe aucun `container_name`, Realtime porte son alias réseau ;
#   3. la production et la cellule rendent exactement les noms d'avant la tranche (§6 bis) ;
#   4. `conteneur_en_marche` suit le service en développement, et le nom de production sous tout autre profil ;
#   5. non-complaisance : deux mutations — un nom réintroduit dans un harnais, un `container_name` dans le fichier de
#      base — sont dénoncées.
#
# Le harnais ne démarre ni n'arrête rien ; la section 4 exige la pile de développement debout (`./runDev.sh`).
#
# Usage :
#   scripts/verify-noms-conteneurs.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh

failures=0
checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT

# Les noms que la pile a portés : ceux du fichier de base et de l'overlay de développement avant la tranche, plus ceux
# de la production (Caddy) et de la cellule.
MOTIF='p2enjoy-(db|rest|kong|storage|functions|mail-sync|mcp|studio|meta|minio|minio-createbucket|keycloak|webapp|stalwart|stalwart-init|roundcube|clamav|migrations|ollama-simule|caddy)\b|p2enjoy-realtime'

# LES EXCEPTIONS, et elles seules (docs/SPEC-pile-par-session.md §6, §6 bis ; décision 703) :
# - les fichiers que seule la production exécute, ou qui la décrivent : ses noms y restent ;
# - les états simulés de `scripts/spark/verifier.sh` dans le harnais qui l'éprouve : ce sont des sorties de production ;
# - l'appel `conteneur_en_marche <service> <nom de production>` des scripts que la production exécute aussi ;
# - le chemin `/var/lib/p2enjoy-mail-sync`, qui n'est pas un nom de conteneur ;
# - ce harnais, qui porte le motif.
FICHIERS_PRODUCTION='^(docker-compose\.prod\.yml|docker-compose\.spark\.yml|runProd\.sh|scripts/spark/.*|scripts/lib/connecteur-mcp\.sh|scripts/verify-noms-conteneurs\.sh)$'

# scanner <racine> <fichier>... — écrit `fichier:ligne:texte` pour chaque littéral hors exception.
scanner() {
	local racine=$1 fichier
	shift
	for fichier in "$@"; do
		[[ "$fichier" =~ $FICHIERS_PRODUCTION ]] && continue
		case "$fichier" in *.md|*.jpg|*.png|*.webm|*.zip|*.pyc) continue ;; esac
		[ -f "$racine/$fichier" ] || continue
		grep -nE "$MOTIF" "$racine/$fichier" 2>/dev/null \
			| sed 's|/var/lib/p2enjoy-mail-sync||g' \
			| grep -E "$MOTIF" \
			| grep -vE 'conteneur_en_marche [a-z-]+ p2enjoy-' \
			| { if [ "$fichier" = scripts/verify-controles-connecteur.sh ]; then grep -vE "\|Up |rendu_attendu"; else cat; fi; } \
			| sed "s|^|$fichier:|" || true
	done
}

titre "1. Aucun nom de conteneur littéral dans le code de développement"

mapfile -t SUIVIS < <(git ls-files)
scanner "$PWD" "${SUIVIS[@]}" > "$TRAVAIL/violations"
if [ -s "$TRAVAIL/violations" ]; then
	fail "$(wc -l < "$TRAVAIL/violations") nom(s) littéral(aux) hors exception :"
	sed 's/^/        /' "$TRAVAIL/violations" | head -20
else
	ok "aucun nom littéral dans ${#SUIVIS[@]} fichiers suivis, exceptions nommées comprises"
fi

titre "2. L'assemblage de développement ne nomme aucun conteneur"

dev_json=$(docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml config --format json)
nommes=$(printf '%s' "$dev_json" | python3 -c "import json,sys; d=json.load(sys.stdin)['services']; print(' '.join(sorted(k for k,v in d.items() if 'container_name' in v)))")
[ -z "$nommes" ] && ok "aucun container_name parmi les services de développement" \
	|| fail "services de développement encore nommés : $nommes"
alias=$(printf '%s' "$dev_json" | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin)['services']['realtime'].get('networks',{}).get('default',{}).get('aliases') or []))")
[ "$alias" = realtime-dev.realtime ] && ok "Realtime porte l'alias réseau realtime-dev.realtime (son tenant)" \
	|| fail "alias réseau de Realtime : « $alias », attendu « realtime-dev.realtime »"
grep -q 'http://realtime-dev.realtime:4000' supabase/docker/volumes/api/kong.yml \
	&& ok "kong.yml joint Realtime par son alias" || fail "kong.yml ne joint pas Realtime par son alias"

titre "3. La production et la cellule gardent leurs noms (§6 bis)"

noms_de() {
	docker compose --env-file .env "$@" --profile mcp config --format json \
		| python3 -c "import json,sys; d=json.load(sys.stdin)['services']; print(' '.join(sorted(f\"{k}={v.get('container_name','-')}\" for k,v in d.items())))"
}
# Relevés le 2026-10-25 AVANT la tranche, par la même commande (docs/JOURNAL.md décision 703).
PROD_ATTENDU='caddy=p2enjoy-caddy db=p2enjoy-db functions=p2enjoy-functions kong=p2enjoy-kong mail-sync=p2enjoy-mail-sync mcp=p2enjoy-mcp migrations-runner=p2enjoy-migrations realtime=realtime-dev.p2enjoy-realtime rest=p2enjoy-rest storage=p2enjoy-storage'
SPARK_ATTENDU='caddy=p2enjoy-caddy db=p2enjoy-db functions=p2enjoy-functions kong=p2enjoy-kong mail-sync=p2enjoy-mail-sync mcp=p2enjoy-mcp migrations-runner=p2enjoy-migrations minio-createbucket=p2enjoy-minio-createbucket minio=p2enjoy-minio realtime=realtime-dev.p2enjoy-realtime rest=p2enjoy-rest storage=p2enjoy-storage'
prod=$(noms_de -f docker-compose.yml -f docker-compose.prod.yml)
[ "$prod" = "$PROD_ATTENDU" ] && ok "production : les dix noms d'avant la tranche, à l'identique" \
	|| fail "production : « $prod »"
spark=$(noms_de -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.spark.yml)
[ "$spark" = "$SPARK_ATTENDU" ] && ok "cellule : les douze noms d'avant la tranche, à l'identique" \
	|| fail "cellule : « $spark »"

titre "4. conteneur_en_marche : le service en développement, le nom de production ailleurs"

nom_dev=$(conteneur db)
[ "$(conteneur_en_marche db p2enjoy-db)" = "$nom_dev" ] \
	&& ok "profil dev : le conteneur du service db ($nom_dev)" \
	|| fail "profil dev : « $(conteneur_en_marche db p2enjoy-db) », attendu « $nom_dev »"
printf 'P2ENJOY_ENV_PROFILE=prod\n' > "$TRAVAIL/env-prod"
cible=$(P2ENJOY_ENV_FILE="$TRAVAIL/env-prod" conteneur_en_marche db "$nom_dev-temoin-absent")
[ -z "$cible" ] && ok "profil prod : le nom de production est employé tel quel, jamais le service" \
	|| fail "profil prod : « $cible » rendu, alors que le nom de production demandé n'existe pas"
cible=$(P2ENJOY_ENV_FILE="$TRAVAIL/env-prod" conteneur_en_marche db "$nom_dev")
[ "$cible" = "$nom_dev" ] && ok "profil prod : un nom de production en marche est rendu, comme avant la tranche" \
	|| fail "profil prod : « $cible » au lieu de « $nom_dev »"

titre "5. Non-complaisance : la garde dénonce un nom réintroduit"

# Mutation a — un harnais qui nomme de nouveau un conteneur.
mkdir -p "$TRAVAIL/racine/scripts"
cp scripts/verify-stack.sh "$TRAVAIL/racine/scripts/verify-stack.sh"
printf '\ndocker exec -i p2enjoy-db psql -c "select 1"\n' >> "$TRAVAIL/racine/scripts/verify-stack.sh"
[ -n "$(scanner "$TRAVAIL/racine" scripts/verify-stack.sh)" ] \
	&& ok "mutation a : « docker exec -i p2enjoy-db » ajouté à un harnais est dénoncé" \
	|| fail "mutation a : le nom réintroduit dans un harnais passe inaperçu"
# Mutation b — un container_name rendu au fichier de base.
sed 's|^  db:$|  db:\n    container_name: p2enjoy-db|' docker-compose.yml > "$TRAVAIL/racine/docker-compose.yml"
[ -n "$(scanner "$TRAVAIL/racine" docker-compose.yml)" ] \
	&& ok "mutation b : un container_name rendu au fichier de base est dénoncé" \
	|| fail "mutation b : le container_name rendu au fichier de base passe inaperçu"
# Témoin : les fichiers non mutés ne sont pas dénoncés — la garde ne rougit pas sur tout.
cp docker-compose.yml "$TRAVAIL/racine/docker-compose.yml"
cp scripts/verify-stack.sh "$TRAVAIL/racine/scripts/verify-stack.sh"
[ -z "$(scanner "$TRAVAIL/racine" docker-compose.yml scripts/verify-stack.sh)" ] \
	&& ok "témoin : les mêmes fichiers, non mutés, ne sont pas dénoncés" \
	|| fail "témoin : la garde dénonce des fichiers conformes"

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi

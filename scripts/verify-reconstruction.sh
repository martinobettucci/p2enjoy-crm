#!/usr/bin/env bash
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T1 bis : restaurer par reconstruction (INC-289)
# @verifies docs/SPEC-test-harness.md §3.6 (le mode opératoire et sa preuve) ; docs/DAT.md §3.2 (invariant
#           révisé : une base neuve se construit dans l'ordre), §3.2 bis ; docs/JOURNAL.md décisions 675 et 682
#
# Éprouve `reconstruire_base_dev` (`scripts/lib/reconstruction.sh`) sur la pile de développement réelle :
#
#   1. les refus ne touchent à rien : profil autre que `dev`, option inconnue, verrou tenu par une autre
#      session — le conteneur `db` reste le même, en marche ;
#   2. une reconstruction efface ce qu'une dégradation a posé (table sentinelle dans `public`), construit le
#      répertoire dans l'ordre (une ligne d'adoption par fichier), et rend une pile entièrement `healthy` ;
#   3. elle recrée la base et ses seuls dérivés, et rien d'autre : les conteneurs et volumes conservés gardent
#      leur identifiant, ceux du tableau du §3.6 en changent ;
#   3 bis. la sortie de la remontée et du seed est gardée dans un journal (INC-298) ;
#   4. le seed y est convergent (`scripts/verify-seed.sh` sans anomalie), et chaque conteneur cite les deux
#      fichiers Compose (docs/CloudWorker.md §2.2 bis).
#
# DESTRUCTIF POUR LA BASE DE DÉVELOPPEMENT, comme tout harnais qui restaure : elle est reconstruite et
# seedée. La pile doit tourner (`./runDev.sh`).
#
# Usage :
#   scripts/verify-reconstruction.sh

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/reconstruction.sh
source scripts/lib/reconstruction.sh

DB_CONTAINER=p2enjoy-db
COMPOSE=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml)
TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi
if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

failures=0
checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }
id_conteneur() { docker inspect -f '{{.Id}}' "$1" 2>/dev/null || echo absent; }
etat_db() { echo "$(id_conteneur "$DB_CONTAINER") $(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")"; }
projet=$("${COMPOSE[@]}" config --format json | jq -r '.name')
# `CreatedAt` d'un volume change quand il est détruit puis recréé, et seulement alors.
cree_le() { docker volume inspect -f '{{.CreatedAt}}' "${projet}_$1" 2>/dev/null || echo absent; }

echo
echo "Preuves de CRM-111 T1 bis — reconstruire la base de développement"

# --- 1. Les refus ne touchent à rien ---------------------------------------------------------------

echo
echo "1. Refus, sans rien arrêter (docs/SPEC-test-harness.md §3.6, étapes 1 et 2)"

avant=$(etat_db)
sed 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=prod/' .env > "$TRAVAIL/env-prod"
if ENV_FILE="$TRAVAIL/env-prod" reconstruire_base_dev >"$TRAVAIL/refus.log" 2>&1; then
	fail "un fichier d'environnement de profil prod est accepté"
elif grep -q "« dev » exigé" "$TRAVAIL/refus.log" && [ "$(etat_db)" = "$avant" ]; then
	ok "profil prod : refus nommé, et la base est le même conteneur, toujours en marche"
else
	fail "profil prod : refus sans motif, ou la base a été touchée — $(cat "$TRAVAIL/refus.log")"
fi

if reconstruire_base_dev --tout >"$TRAVAIL/option.log" 2>&1; then
	fail "une option inconnue est acceptée"
elif grep -q "option inconnue" "$TRAVAIL/option.log" && [ "$(etat_db)" = "$avant" ]; then
	ok "option inconnue : refus nommé, rien n'est arrêté"
else
	fail "option inconnue : refus sans motif, ou la base a été touchée"
fi

# Une autre session tient le verrou : la reconstruction attend, puis renonce sans rien détruire.
flock "$TRAVAIL/verrou" sleep 30 &
porteur=$!
sleep 1
if RECONSTRUCTION_VERROU="$TRAVAIL/verrou" RECONSTRUCTION_ATTENTE=2 reconstruire_base_dev >"$TRAVAIL/verrou.log" 2>&1; then
	fail "la reconstruction passe outre un verrou tenu"
elif grep -q "non obtenu" "$TRAVAIL/verrou.log" && [ "$(etat_db)" = "$avant" ]; then
	ok "verrou tenu par une autre session : renonce après l'attente, rien n'est arrêté"
else
	fail "verrou tenu : échec sans motif, ou la base a été touchée — $(cat "$TRAVAIL/verrou.log")"
fi
kill "$porteur" 2>/dev/null || true
wait "$porteur" 2>/dev/null || true

# --- 2. Une reconstruction efface la dégradation et construit dans l'ordre --------------------------

echo
echo "2. Reconstruction (§3.6, étapes 3 à 7)"

CONSERVES=(p2enjoy-keycloak p2enjoy-kong p2enjoy-minio p2enjoy-webapp p2enjoy-mcp p2enjoy-functions)
declare -A id_avant
for c in "${CONSERVES[@]}" "$DB_CONTAINER" p2enjoy-stalwart p2enjoy-mail-sync; do id_avant[$c]=$(id_conteneur "$c"); done
declare -A vol_avant
for v in minio-data clamav-data mcp-etat webapp-node-modules "${RECONSTRUCTION_VOLUMES[@]}"; do vol_avant[$v]=$(cree_le "$v"); done

# La dégradation : une table que ni le répertoire ni le seed ne créent.
psql_db -v ON_ERROR_STOP=1 -c "create table public.reconstruction_sentinelle (id int); insert into public.reconstruction_sentinelle values (1);"
[ "$(psql_db -c "select to_regclass('public.reconstruction_sentinelle') is not null")" = t ] \
	&& ok "dégradation posée : public.reconstruction_sentinelle existe avant la reconstruction" \
	|| fail "la table sentinelle n'a pas pu être posée"

debut=$(date +%s)
if reconstruire_base_dev >"$TRAVAIL/reconstruction.log" 2>&1; then
	ok "reconstruire_base_dev se termine en 0, en $(( $(date +%s) - debut )) s"
else
	fail "reconstruire_base_dev échoue : $(cat "$TRAVAIL/reconstruction.log")"
fi

# INC-298 : la sortie de la remontée et du seed est gardée, pour qu'un échec intermittent reste diagnosticable.
grep -q "Container p2enjoy-db" "$RECONSTRUCTION_JOURNAL" && grep -q "verify-seed.sh" "$RECONSTRUCTION_JOURNAL" \
	&& ok "le journal $RECONSTRUCTION_JOURNAL garde la sortie de la remontée et du seed (INC-298)" \
	|| fail "le journal de reconstruction ne garde pas la sortie de la remontée et du seed (INC-298)"

[ "$(psql_db -c "select to_regclass('public.reconstruction_sentinelle') is null")" = t ] \
	&& ok "la table sentinelle a disparu : la base est neuve, pas rejouée" \
	|| fail "la table sentinelle subsiste : la base n'a pas été reconstruite"

attendus=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
inscrits=$(psql_db -c "select count(*) filter (where mode = 'adoption') || ':' || count(*) from app.migrations_appliquees")
[ "$inscrits" = "$attendus:$attendus" ] \
	&& ok "le registre porte les $attendus fichiers du répertoire, tous en adoption : construits dans l'ordre sur une base vide" \
	|| fail "registre « $inscrits » (adoption:total) pour $attendus fichiers"
grep -q "registre absent ou vide — adoption" <(docker logs p2enjoy-migrations 2>&1) \
	&& ok "le journal du runner nomme l'adoption sur base vide" \
	|| fail "le journal du runner ne nomme pas l'adoption"

hors_sante=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" {print $1}' | tr '\n' ' ')
[ -z "$hors_sante" ] && ok "tous les services de la pile sont healthy" || fail "services hors d'état healthy : $hors_sante"

# --- 3. La base et ses seuls dérivés ------------------------------------------------------------------

echo
echo "3. Ce qui est recréé, et ce qui ne l'est pas"

for c in "${CONSERVES[@]}"; do
	[ "$(id_conteneur "$c")" = "${id_avant[$c]}" ] && ok "$c conservé : même conteneur" || fail "$c a été recréé"
done
for c in "$DB_CONTAINER" p2enjoy-stalwart p2enjoy-mail-sync; do
	[ "$(id_conteneur "$c")" != "${id_avant[$c]}" ] && ok "$c recréé" || fail "$c n'a pas été recréé"
done
for v in minio-data clamav-data mcp-etat webapp-node-modules; do
	[ "$(cree_le "$v")" = "${vol_avant[$v]}" ] && ok "volume $v conservé" || fail "volume $v détruit"
done
for v in "${RECONSTRUCTION_VOLUMES[@]}"; do
	[ "$(cree_le "$v")" != "${vol_avant[$v]}" ] && [ "$(cree_le "$v")" != absent ] \
		&& ok "volume dérivé $v détruit puis recréé" || fail "volume dérivé $v non recréé"
done

# --- 4. Seed convergent et composition intacte --------------------------------------------------------

echo
echo "4. Seed convergent, deux fichiers Compose"

if scripts/verify-seed.sh >"$TRAVAIL/seed.log" 2>&1; then
	ok "scripts/verify-seed.sh : $(grep -o '[0-9]* contrôles, aucune anomalie' "$TRAVAIL/seed.log" | tail -n 1)"
else
	fail "scripts/verify-seed.sh rougit sur la base reconstruite"
	grep -E 'ECHEC' "$TRAVAIL/seed.log" | sed 's/^/        /' | head -10
fi

nus=''
for c in $(docker ps --format '{{.Names}}'); do
	n=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' | tr ',' '\n' | grep -c .)
	[ "$n" = 2 ] || nus="$nus $c"
done
[ -z "$nus" ] && ok "chaque conteneur cite les deux fichiers Compose" || fail "conteneurs recréés nus :$nus"

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

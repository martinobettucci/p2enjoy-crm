#!/usr/bin/env bash
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T1 ter.1 : la garde d'empreinte (INC-304, décision 701)
# @verifies docs/SPEC-test-harness.md §3.8 (la garde d'empreinte), §3.6 (la reconstruction qu'elle déclenche)
#
# Éprouve `scripts/lib/empreinte.sh` sur la pile de développement réelle :
#
#   1. le filtre est nécessaire et suffisant : deux `pg_dump` bruts de la même base diffèrent (la clé de `\restrict`),
#      deux relevés filtrés sont égaux ;
#   2. une écriture de DONNÉES ne change pas l'empreinte, et `empreinte_garantir` n'y reconstruit rien ;
#   3. une fonction REDÉFINIE change l'empreinte, et la rétablir à l'identique la rend égale ;
#   4. une structure posée pendant le harnais — une table sentinelle — fait reconstruire la base par
#      `empreinte_garantir`, qui le dit, garde le différentiel, et rend l'empreinte d'ouverture.
#
# DESTRUCTIF POUR LA BASE DE DÉVELOPPEMENT au point 4 : elle est reconstruite et seedée, comme par tout harnais qui
# restaure (docs/SPEC-test-harness.md §3.6). La pile doit tourner (`./runDev.sh`).
#
# Usage :
#   scripts/verify-empreinte.sh

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/empreinte.sh
source scripts/lib/empreinte.sh
# shellcheck source=scripts/lib/degradation.sh
source scripts/lib/degradation.sh

DB_CONTAINER=$(conteneur db)
TRAVAIL=$(mktemp -d)
SENTINELLE=zz_empreinte_sentinelle
nettoyer() {
	degradations_restaurer
	psql_db -c "drop table if exists public.$SENTINELLE;" >/dev/null 2>&1 || true
	rm -rf -- "$TRAVAIL" "${DEGRADATIONS_DOSSIER:-}"
}
trap nettoyer EXIT

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
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
brut() { docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --schema-only -n public -n app | sha256sum; }

echo "1. Le filtre des lignes \\restrict"
if [ "$(brut)" != "$(brut)" ]; then
	ok "deux pg_dump BRUTS de la même base diffèrent : sans filtre, la garde reconstruirait à chaque passage"
else
	fail "deux pg_dump bruts sont égaux : le filtre n'a plus d'objet, ou pg_dump ne pose plus de clé"
fi
if [ "$(empreinte_schema "$TRAVAIL/a.sql")" = "$(empreinte_schema "$TRAVAIL/b.sql")" ]; then
	ok "deux relevés filtrés de la même base sont égaux"
else
	fail "deux relevés filtrés diffèrent : $(diff "$TRAVAIL/a.sql" "$TRAVAIL/b.sql" | head -n 3 | tr '\n' ' ')"
fi

echo "2. Une écriture de données ne touche pas l'empreinte"
empreinte_relever
dossier=$EMPREINTE_DOSSIER
titre=$(psql_db -c "select title from public.cards where id = '5eed0000-0000-4000-8000-0000000000c6';")
psql_db -c "update public.cards set title = 'Sonde empreinte' where id = '5eed0000-0000-4000-8000-0000000000c6';" >/dev/null
db_avant=$(docker inspect -f '{{.Id}}' "$DB_CONTAINER")
if empreinte_garantir 2>"$TRAVAIL/garantir-donnees.log" && [ ! -s "$TRAVAIL/garantir-donnees.log" ]; then
	ok "empreinte inchangée après une mise à jour de ligne : la garde se tait"
else
	fail "la garde a réagi à une écriture de données : $(head -c 300 "$TRAVAIL/garantir-donnees.log")"
fi
[ "$(docker inspect -f '{{.Id}}' "$DB_CONTAINER")" = "$db_avant" ] \
	&& ok "et rien n'a été reconstruit : le conteneur db est le même" \
	|| fail "le conteneur db a changé : la garde a reconstruit sans motif"
[ ! -e "$dossier" ] \
	&& ok "ses deux relevés sont retirés quand rien n'a changé" \
	|| fail "le dossier de relevés subsiste sans écart : $dossier"
psql_db -c "update public.cards set title = '$titre' where id = '5eed0000-0000-4000-8000-0000000000c6';" >/dev/null

echo "3. Une fonction redéfinie change l'empreinte"
empreinte_schema "$TRAVAIL/ouverture.sql" > "$TRAVAIL/ouverture.sha"
if degradation_fonction 'app.btrim_blancs(text)' '-- impose déjà.' '-- impose déjà. (sonde de la garde d’empreinte)'; then
	[ "$(empreinte_schema "$TRAVAIL/degradee.sql")" != "$(cat "$TRAVAIL/ouverture.sha")" ] \
		&& ok "le corps de app.btrim_blancs changé d'un commentaire : l'empreinte diffère" \
		|| fail "la redéfinition d'une fonction n'a pas changé l'empreinte : la garde ne verrait pas INC-304"
	degradations_restaurer
	DEGRADATIONS_ORIGINES=()
	[ "$(empreinte_schema "$TRAVAIL/restauree.sql")" = "$(cat "$TRAVAIL/ouverture.sha")" ] \
		&& ok "la définition d'origine réappliquée : l'empreinte redevient celle d'ouverture" \
		|| fail "la restauration à l'identique laisse une empreinte différente"
else
	fail "la sonde de fonction n'a pas pu être posée : contrôle non concluant"
fi

echo "4. Une structure posée pendant le harnais fait reconstruire"
empreinte_relever
psql_db -c "create table public.$SENTINELLE (id integer);" >/dev/null
if empreinte_garantir 2>"$TRAVAIL/garantir-structure.log"; then
	ok "empreinte_garantir rend 0 : la reconstruction a rétabli la base"
else
	fail "empreinte_garantir rend un échec — voir $TRAVAIL/garantir-structure.log"
fi
grep -q 'a changé pendant le harnais' "$TRAVAIL/garantir-structure.log" \
	&& ok "elle le DIT, avec le nombre de lignes et le chemin du différentiel" \
	|| fail "la reconstruction s'est faite sans le dire"
difference=$(grep -oE '[^ ]+/difference\.diff' "$TRAVAIL/garantir-structure.log" | head -n 1)
[ -n "$difference" ] && grep -q "$SENTINELLE" "$difference" \
	&& ok "le différentiel gardé nomme la table sentinelle" \
	|| fail "le différentiel est absent ou ne nomme pas la sentinelle"
[ -n "$difference" ] && rm -rf -- "$(dirname "$difference")"
[ "$(psql_db -c "select count(*) from pg_tables where schemaname = 'public' and tablename = '$SENTINELLE';")" = 0 ] \
	&& ok "la table sentinelle a disparu avec la reconstruction" \
	|| fail "la table sentinelle subsiste"
[ "$(empreinte_schema "$TRAVAIL/apres.sql")" = "$(cat "$TRAVAIL/ouverture.sha")" ] \
	&& ok "l'empreinte après reconstruction est celle d'ouverture du point 3 : la base est rendue" \
	|| fail "l'empreinte après reconstruction diffère : $(diff "$TRAVAIL/ouverture.sql" "$TRAVAIL/apres.sql" | head -n 4 | tr '\n' ' ')"

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

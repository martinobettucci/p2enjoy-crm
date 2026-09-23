#!/usr/bin/env bash
# @verifies CRM-092 (docs/BACKLOG.md) — le SSO, seule source d'identité : harnais de l'unité
# @verifies docs/SPEC-session-sso.md §7.1 (fonctions auth.*), §7.2 (modèle), §13 (preuves), §14 (T1)
# @verifies docs/JOURNAL.md décisions 580 (K11, K12) et 581 (migration élevée, harnais de l'unité)
# @verifies CLAUDE.md §15 (tests non complaisants), §18 (un défaut se reproduit avant sa correction)
#
# Harnais de `CRM-092`, qui grandit à chaque tranche (décision 581). Tranche T1 :
#
#   1. BASE NEUVE, SANS GoTrue : un cluster `supabase/postgres` jetable, sans réseau. Le témoin
#      reproduit K11 — `auth.uid()` rend NULL sous `request.jwt.claims` — AVANT la migration 0074 ;
#      après elle, rejouée deux fois, il rend le `sub`, et le propriétaire reste celui de GoTrue ;
#   2. BASE DE DÉVELOPPEMENT : 0074 puis 0075 rejouées deux fois chacune, sous leur rôle ;
#   3. la suite pgTAP de l'unité, verte à son nombre exact d'assertions ;
#   4. NON-COMPLAISANCE : quatre dégradations, chacune doit rendre la suite rouge. Le `trap`
#      réapplique toujours les deux migrations, qui restaurent tout ce qui a été dégradé.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
IMAGE_DB=$(sed -n 's/^[[:space:]]*image: \(supabase\/postgres:[^[:space:]]*\)$/\1/p' docker-compose.yml | head -n 1)
MIGRATION_CLAIMS=supabase/migrations/0074_revendications_du_jeton.sql
MIGRATION_MODELE=supabase/migrations/0075_identite_sso.sql
TEST_SQL=supabase/tests/0069_identite_sso.test.sql
ASSERTIONS_T1=58
BASE_NEUVE=verify-session-sso-base-neuve
SUB_PREUVE=0c920000-0000-4000-8000-0000000000bb

checks=0
failures=0
restore_needed=false
WORK=$(mktemp -d)

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_dev()   { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"; }
psql_admin() { docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 "$@"; }

appliquer_migrations_dev() {
	psql_admin --single-transaction -f - < "$MIGRATION_CLAIMS" >/dev/null 2>&1 \
		&& psql_dev --single-transaction -f - < "$MIGRATION_MODELE" >/dev/null 2>&1
}

cleanup() {
	local status=$?
	trap - EXIT
	if [ "$restore_needed" = true ]; then
		appliquer_migrations_dev || { echo "RESTAURATION IMPOSSIBLE : rejouer $MIGRATION_CLAIMS et $MIGRATION_MODELE" >&2; status=1; }
	fi
	docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

suite_verte() {
	scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap.log" 2>&1 \
		&& grep -q "1 fichiers, $ASSERTIONS_T1 assertions, aucune anomalie" "$WORK/tap.log"
}

suite_rouge() {
	if scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap-rouge.log" 2>&1; then
		return 1
	fi
	grep -Eq 'ECHEC|not ok|psql a échoué' "$WORK/tap-rouge.log"
}

echo
echo "CRM-092 — le SSO, seule source d'identité (docs/SPEC-session-sso.md)"
echo

# =================================================================================================
# 1. Base neuve, sans GoTrue — K11 reproduite, puis levée par 0074
# =================================================================================================
echo "1. Base neuve sans GoTrue ($IMAGE_DB)"

[ -n "$IMAGE_DB" ] || { fail "image de la base introuvable dans docker-compose.yml"; exit 1; }
docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true
docker run -d --rm --name "$BASE_NEUVE" --network none \
	-e POSTGRES_PASSWORD="preuve-jetable-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
	-e JWT_SECRET="preuve-jetable-secret-de-trente-deux-caracteres" \
	"$IMAGE_DB" >/dev/null
pret=false
for _ in $(seq 1 90); do
	if docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc 'select 1' >/dev/null 2>&1 \
		&& [ "$(docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc \
			"select count(*) from pg_proc where pronamespace = 'auth'::regnamespace and proname = 'uid'" 2>/dev/null)" = 1 ]; then
		pret=true
		break
	fi
	sleep 1
done
# L'image redémarre le serveur après ses scripts d'initialisation : on attend la stabilité.
sleep 3
for _ in $(seq 1 30); do
	docker exec "$BASE_NEUVE" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
	sleep 1
done
[ "$pret" = true ] || { fail "la base jetable n'a pas démarré"; exit 1; }

uid_neuve() {
	docker exec -i "$BASE_NEUVE" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$SUB_PREUVE","role":"authenticated"}', true) is null;
select coalesce(auth.uid()::text, 'NULL');
rollback;
SQL
}

avant=$(uid_neuve | tail -n 1)
if [ "$avant" = NULL ]; then
	ok "témoin : sans GoTrue ni 0074, auth.uid() rend NULL sous request.jwt.claims (K11 reproduite)"
else
	fail "témoin : auth.uid() rend « $avant » avant 0074 — K11 n'est plus reproduite, la preuve ne vaut rien"
fi

for passage in premier second; do
	if docker exec -i "$BASE_NEUVE" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 \
		--single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/neuve-$passage.log" 2>&1; then
		ok "0074 appliquée sur la base neuve ($passage passage)"
	else
		fail "0074 refusée sur la base neuve ($passage passage) : $(tail -n 2 "$WORK/neuve-$passage.log")"
	fi
done

apres=$(uid_neuve | tail -n 1)
if [ "$apres" = "$SUB_PREUVE" ]; then
	ok "après 0074, auth.uid() rend le sub de request.jwt.claims (K11 levée)"
else
	fail "après 0074, auth.uid() rend « $apres » au lieu du sub"
fi

proprietaires=$(docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc \
	"select string_agg(proname || ':' || pg_get_userbyid(proowner), ' ' order by proname)
	   from pg_proc where pronamespace = 'auth'::regnamespace and proname in ('uid','role','email','jwt')")
if [ "$proprietaires" = "email:supabase_auth_admin jwt:supabase_auth_admin role:supabase_auth_admin uid:supabase_auth_admin" ]; then
	ok "les quatre fonctions existent et appartiennent à supabase_auth_admin, comme sous GoTrue"
else
	fail "fonctions auth.* inattendues sur la base neuve : $proprietaires"
fi
docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true

# =================================================================================================
# 2. Base de développement — rejeu convergent sous le rôle de chaque migration
# =================================================================================================
echo
echo "2. Base de développement : rejeu des migrations 0074 et 0075"

for passage in premier second; do
	if psql_admin --single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/dev-claims-$passage.log" 2>&1; then
		ok "0074 rejouée sous supabase_admin ($passage passage)"
	else
		fail "0074 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-claims-$passage.log")"
	fi
	if psql_dev --single-transaction -f - < "$MIGRATION_MODELE" >"$WORK/dev-modele-$passage.log" 2>&1; then
		ok "0075 rejouée sous postgres ($passage passage)"
	else
		fail "0075 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-modele-$passage.log")"
	fi
done

if psql_dev --single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/dev-claims-postgres.log" 2>&1; then
	fail "0074 acceptée sous postgres : sa garde de rôle ne refuse plus rien"
elif grep -q 'migration_role_inattendu' "$WORK/dev-claims-postgres.log"; then
	ok "0074 refusée sous postgres par sa garde de rôle, avant toute écriture"
else
	fail "0074 refusée sous postgres, mais pas par sa garde : $(tail -n 1 "$WORK/dev-claims-postgres.log")"
fi

# =================================================================================================
# 3. Suite pgTAP de l'unité
# =================================================================================================
echo
echo "3. pgTAP : $TEST_SQL"

if suite_verte; then
	ok "suite verte, $ASSERTIONS_T1 assertions"
else
	fail "suite non verte ou nombre d'assertions différent de $ASSERTIONS_T1 : $(tail -n 3 "$WORK/tap.log")"
fi

# =================================================================================================
# 4. Non-complaisance : chaque dégradation doit rendre la suite rouge
# =================================================================================================
echo
echo "4. Non-complaisance (chaque dégradation est restaurée par le rejeu des migrations)"

degrader() {
	local libelle=$1 role=$2 sql=$3
	restore_needed=true
	if [ "$role" = supabase_admin ]; then
		printf '%s\n' "$sql" | psql_admin >/dev/null
	else
		printf '%s\n' "$sql" | psql_dev >/dev/null
	fi
	if suite_rouge; then
		ok "dégradation détectée : $libelle"
	else
		fail "dégradation NON détectée : $libelle"
	fi
	appliquer_migrations_dev || { fail "restauration impossible après : $libelle"; exit 1; }
	restore_needed=false
}

degrader "auth.uid() revenue à la forme de l'image, qui ignore request.jwt.claims (K11)" supabase_admin \
	"create or replace function auth.uid() returns uuid language sql stable as
	 \$\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;"

degrader "inscription d'une attente permise au nom d'un autre administrateur" postgres \
	"alter policy workspace_invitations_insertion_admin on public.workspace_invitations
	 with check (app.is_workspace_admin(workspace_id));"

degrader "ouverture de session exécutable par authenticated" postgres \
	"grant execute on function public.ouvrir_session_sso(uuid, text, text) to authenticated;"

degrader "profiles.id rattaché de nouveau à auth.users" postgres \
	"alter table public.profiles add constraint profiles_id_fkey
	 foreign key (id) references auth.users (id) on delete cascade;"

if suite_verte; then
	ok "après restauration, la suite est de nouveau verte"
else
	fail "après restauration, la suite n'est pas verte : $(tail -n 3 "$WORK/tap.log")"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d vérifications, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d vérifications, %d anomalie(s).\033[0m\n' "$checks" "$failures"
	exit 1
fi

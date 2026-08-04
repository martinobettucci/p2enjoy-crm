#!/usr/bin/env bash
# @verifies CRM-021 (docs/BACKLOG.md) — Definition of Done des channels
# @verifies docs/SPEC-channels.md §2 (modèle), §2.4 (cloisonnement), §3 (ordre), §4 (archivage),
#           §6 (autorisations), §7 (contrat d'API mesuré), §8 (seed), §9 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et n° 11)
# @verifies docs/SCHEMA.md §2 (organisation) ; docs/PROD_MIGRATIONS.md §3
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-021` :
#
#   1. la suite pgTAP `supabase/tests/0005_channels.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la structure de la table, ses politiques ni ses privilèges ;
#   3. le cloisonnement est garanti **en base** : un `workspace_id` incohérent avec le track est
#      refusé, y compris à `postgres`, donc indépendamment de toute politique RLS ;
#   4. le seed est **convergent** : rejoué, il laisse exactement six channels, dont un archivé,
#      répartis sur trois tracks, et tous rattachés au workflow par défaut depuis `CRM-031`
#      (INC-029, dont la moitié « clé étrangère » est levée) ;
#   5. les scénarios d'API et d'interface sont verts, ainsi que les tests unitaires et le build ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve pas qu'un onglet s'affiche à un utilisateur connecté : la webapp n'a aucun parcours
# de connexion (`docs/INCONSISTENCY_REPORT.md`, INC-021), son client est anonyme, et la politique
# de lecture ne lui consent aucune ligne. C'est une limite du **produit**, pas du harnais, et elle
# est nommée dans `docs/BACKLOG.md` plutôt que masquée par une preuve qui n'en serait pas une.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-channels.sh
#   scripts/verify-channels.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0005_channels.test.sql
MIGRATION_FILE=supabase/migrations/0004_channels.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
TRACK_STUDIO=5eed0000-0000-4000-8000-000000000022
MAIL_ADMIN=admin@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,35p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
	esac
	shift
done

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi

env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

require_env() {
	local value
	value=$(env_value "$1")
	if [ -z "$value" ]; then
		echo "ERREUR : variable '$1' absente ou vide dans .env." >&2
		exit 1
	fi
	printf '%s' "$value"
}

KONG_HTTP_PORT=$(require_env KONG_HTTP_PORT)
ANON_KEY=$(require_env ANON_KEY)
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-channels-body
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

jeton_de() {
	curl -s -X POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg m "$1" --arg p "$MDP_SEED" '{email: $m, password: $p}')" \
		| jq -r '.access_token // empty'
}

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un workspace
# de preuve ni un channel de preuve derrière elle.
menage() {
	psql_db -c "
		delete from public.channels where slug like 'tst-crm021-%';
		delete from public.tracks   where slug like 'tst-crm021-%';
		delete from public.workspaces where slug like 'tst-crm021-%';
	" >/dev/null 2>&1 || true
}
trap 'menage; rm -f "$CORPS"' EXIT
menage

titre "1. Suite pgTAP"

sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
if printf '%s' "$sortie" | grep -q '^not ok'; then
	fail "la suite pgTAP signale au moins une anomalie"
	printf '%s\n' "$sortie" | grep '^not ok' | head -5
else
	assertions=$(printf '%s' "$sortie" | grep -c '^ok ' || true)
	ok "suite pgTAP verte — $assertions assertions"
fi

titre "2. La migration est rejouable, et convergente"

# Empreinte de la structure, des politiques et des privilèges **avant** rejeu.
empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select attname || ':' || atttypid::regtype::text || ':' || attnotnull::text as x
			  from pg_attribute where attrelid = 'public.channels'::regclass and attnum > 0
			union all
			select 'pol:' || policyname || ':' || cmd from pg_policies
			 where schemaname = 'public' and tablename = 'channels'
			union all
			select 'con:' || conname from pg_constraint
			 where conrelid = 'public.channels'::regclass
			union all
			select 'priv:' || grantee || ':' || privilege_type
			  from information_schema.role_table_grants
			 where table_schema = 'public' and table_name = 'channels'
			   and grantee in ('anon', 'authenticated')
		) t;
	"
}

avant=$(empreinte)
if psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1; then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu — l'idempotence n'est pas acquise"
fi
apres=$(empreinte)
if [ "$avant" = "$apres" ]; then
	ok "le rejeu ne modifie ni la structure, ni les politiques, ni les privilèges"
else
	fail "le rejeu a modifié quelque chose : l'empreinte diffère"
fi

titre "3. Le cloisonnement est garanti en base, indépendamment de la RLS"

# La preuve décisive de l'unité. Elle s'exécute en tant que `postgres`, qui contourne toute
# politique : ce qui refuse la ligne ne peut donc être que la contrainte elle-même.
psql_db -c "
	insert into public.workspaces (id, name, slug)
	values ('a1110000-0000-4000-8000-000000000001', 'Preuve CRM-021 A', 'tst-crm021-a'),
	       ('a1110000-0000-4000-8000-000000000002', 'Preuve CRM-021 B', 'tst-crm021-b');
	insert into public.tracks (id, workspace_id, name, slug, position)
	values ('a1110000-0000-4000-8000-0000000000a1', 'a1110000-0000-4000-8000-000000000001',
	        'Track A', 'tst-crm021-track-a', 1);
" >/dev/null

if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.channels (workspace_id, track_id, name, slug, position)
	values ('a1110000-0000-4000-8000-000000000002', 'a1110000-0000-4000-8000-0000000000a1',
	        'Menteur', 'tst-crm021-menteur', 1);
" >/dev/null 2>&1; then
	fail "un channel a pu déclarer un workspace différent de celui de son track"
else
	ok "un \`workspace_id\` incohérent avec le track est refusé, même à \`postgres\`"
fi

if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.channels (workspace_id, track_id, name, slug, position)
	values ('a1110000-0000-4000-8000-000000000001', 'a1110000-0000-4000-8000-0000000000a1',
	        'Cohérent', 'tst-crm021-coherent', 1);
" >/dev/null 2>&1; then
	ok "un \`workspace_id\` cohérent est accepté : la contrainte n'interdit pas le cas normal"
else
	fail "un channel cohérent est refusé — la contrainte est trop stricte"
fi

# Le compteur de `position` est propre au track.
psql_db -c "
	insert into public.channels (workspace_id, track_id, name, slug)
	values ('a1110000-0000-4000-8000-000000000001', 'a1110000-0000-4000-8000-0000000000a1',
	        'Suivant', 'tst-crm021-suivant');
" >/dev/null
pos=$(psql_db -c "select position from public.channels where slug = 'tst-crm021-suivant';")
if [ "$pos" = "2" ]; then
	ok "\`position\` est attribuée dans la portée du track (1 puis 2)"
else
	fail "\`position\` attribuée vaut « $pos », attendu « 2 »"
fi

menage

titre "4. Le seed est convergent"

./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué"
total=$(psql_db -c "select count(*) from public.channels where workspace_id = '$WS_SEED';")
archives=$(psql_db -c "select count(*) from public.channels
                        where workspace_id = '$WS_SEED' and archived_at is not null;")
tracks_porteurs=$(psql_db -c "select count(distinct track_id) from public.channels
                               where workspace_id = '$WS_SEED';")
sans_workflow=$(psql_db -c "select count(*) from public.channels
                             where workspace_id = '$WS_SEED' and workflow_id is null;")
ordre=$(psql_db -c "select string_agg(slug, ',' order by position) from public.channels
                     where track_id = '$TRACK_CONSEIL' and archived_at is null;")

[ "$total" = "6" ] && ok "six channels, ni plus ni moins" || fail "channels : $total, attendu 6"
[ "$archives" = "1" ] && ok "un channel archivé, pour rendre l'état démontrable" \
	|| fail "channels archivés : $archives, attendu 1"
[ "$tracks_porteurs" = "3" ] && ok "répartis sur trois tracks" \
	|| fail "tracks porteurs : $tracks_porteurs, attendu 3"
[ "$sans_workflow" = "0" ] \
	&& ok "INC-029 : les six channels portent désormais un \`workflow_id\` — \`CRM-031\` a livré la \
clé étrangère et le seed les rattache au workflow par défaut" \
	|| fail "channels sans workflow : $sans_workflow, attendu 0 depuis \`CRM-031\`"
[ "$ordre" = "prospection,grands-comptes" ] \
	&& ok "l'ordre des onglets de \`conseil-ia\` est celui de \`position\`" \
	|| fail "ordre des onglets : « $ordre »"

titre "5. Contrat d'API, avec les jetons réels (docs/SPEC-channels.md §7)"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && ok "jeton de l'administrateur obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administrateur impossible"
[ -n "$T_VIEWER" ] && ok "jeton du viewer obtenu par la vraie route de connexion" \
	|| fail "connexion du viewer impossible"

code=$(http GET "$API/rest/v1/channels?select=id" -H "apikey: $ANON_KEY")
if [ "$code" = "200" ] && [ "$(jq -r 'length' < "$CORPS")" = "0" ]; then
	ok "ligne b — l'anonyme obtient 200 et zéro ligne, pas une erreur (refus n° 11)"
else
	fail "ligne b — l'anonyme obtient $code et $(head -c 80 "$CORPS")"
fi

code=$(http GET "$API/rest/v1/channels?select=id" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
[ "$(jq -r 'length' < "$CORPS")" = "6" ] \
	&& ok "ligne c — l'administrateur lit les six channels de son workspace" \
	|| fail "ligne c — l'administrateur lit $(jq -r 'length' < "$CORPS") channels"

code=$(http POST "$API/rest/v1/channels" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"track_id\":\"$TRACK_CONSEIL\",\"name\":\"X\",\"slug\":\"tst-crm021-v\"}")
if [ "$code" = "403" ] && [ "$(jq -r .code < "$CORPS")" = "42501" ]; then
	ok "ligne e — un viewer ne crée aucun channel : 403, code 42501"
else
	fail "ligne e — le viewer obtient $code"
fi

code=$(http DELETE "$API/rest/v1/channels?slug=eq.prospection" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
if [ "$code" = "403" ] && jq -e '.message | test("permission denied")' < "$CORPS" >/dev/null; then
	ok "ligne i — la suppression physique est refusée dès le privilège"
else
	fail "ligne i — la suppression rend $code"
fi

titre "6. Non-complaisance : le harnais échoue quand le produit est affaibli"

# a. Politique d'écriture relâchée : un viewer devrait alors créer un channel.
psql_db -c "
	drop policy if exists channels_insertion_admin on public.channels;
	create policy channels_insertion_admin on public.channels for insert to authenticated
		with check (true);
	notify pgrst, 'reload schema';
" >/dev/null
sleep 1
code=$(http POST "$API/rest/v1/channels" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"track_id\":\"$TRACK_CONSEIL\",\"name\":\"X\",\"slug\":\"tst-crm021-relache\"}")
if [ "$code" = "201" ]; then
	ok "politique relâchée : le refus disparaît réellement — le contrôle n'est pas décoratif"
else
	fail "politique relâchée : le viewer obtient encore $code, le contrôle ne mesure rien"
fi
psql_db -c "delete from public.channels where slug = 'tst-crm021-relache';" >/dev/null

# b. Clé composite retirée : un workspace_id menteur devrait alors passer.
psql_db -c "
	alter table public.channels drop constraint channels_track_id_workspace_id_fkey;
" >/dev/null
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.channels (workspace_id, track_id, name, slug, position)
	values ('$WS_SEED', '00000000-0000-4000-8000-00000000dead', 'Menteur', 'tst-crm021-m2', 99);
" >/dev/null 2>&1; then
	ok "clé composite retirée : la ligne menteuse passe — la contrainte porte bien la garantie"
	psql_db -c "delete from public.channels where slug = 'tst-crm021-m2';" >/dev/null
else
	fail "clé composite retirée : la ligne est encore refusée, la garantie vient d'ailleurs"
fi

# c. Unicité déplacée du track vers le workspace.
#
# CETTE DÉGRADATION A TROUVÉ UN DÉFAUT RÉEL DE LA MIGRATION, et c'est le motif de son ajout.
# L'unicité `(track_id, slug)` était écrite **dans le `create table`**, qui porte `if not exists` :
# la réapplication du fichier se terminait **sans erreur** en laissant la contrainte dégradée. La
# migration était idempotente **sans être réparatrice**, et la base restait durablement affaiblie —
# un channel `prospection` devenant impossible dans deux tracks du même workspace.
#
# Le défaut ne pouvait pas se voir autrement : toutes les autres preuves s'exécutent sur une base
# fraîchement migrée, où la contrainte est correcte. Seule la **restauration** après dégradation
# l'expose. Même nature que le défaut trouvé par `CRM-020` sur `tracks_color_check`.
psql_db -c "
	alter table public.channels drop constraint channels_track_id_slug_key;
	alter table public.channels add constraint channels_track_id_slug_key unique (workspace_id, slug);
" >/dev/null
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.channels (workspace_id, track_id, name, slug, position)
	values ('$WS_SEED', '$TRACK_STUDIO', 'Homonyme', 'prospection', 98);
" >/dev/null 2>&1; then
	fail "unicité déplacée : le slug homonyme passe encore, la dégradation n'a rien changé"
	psql_db -c "delete from public.channels where slug = 'prospection' and track_id = '$TRACK_STUDIO';" >/dev/null
else
	ok "unicité déplacée au workspace : un slug homonyme dans un autre track est refusé à tort"
fi

# d. Restauration **constatée**, et non supposée.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
sleep 1
restaure=$(psql_db -c "
	select (select count(*) from pg_constraint
	         where conname = 'channels_track_id_workspace_id_fkey'
	           and conrelid = 'public.channels'::regclass)::text
	    || '/' ||
	       (select coalesce(with_check, '') from pg_policies
	         where tablename = 'channels' and policyname = 'channels_insertion_admin');
")
if printf '%s' "$restaure" | grep -q '^1/' && printf '%s' "$restaure" | grep -q 'is_workspace_admin'; then
	ok "restauration constatée : la clé composite et la politique d'origine sont revenues"
else
	fail "restauration incomplète : « $restaure »"
fi

# La restauration de l'**unicité** est constatée séparément : c'est elle que la migration ne
# réparait pas, et un contrôle global l'aurait manquée.
unicite=$(psql_db -c "
	select pg_get_constraintdef(oid) from pg_constraint
	 where conrelid = 'public.channels'::regclass and conname = 'channels_track_id_slug_key';
")
if [ "$unicite" = "UNIQUE (track_id, slug)" ]; then
	ok "restauration constatée : l'unicité est de nouveau **par track**, la migration répare"
else
	fail "l'unicité n'est pas réparée par le rejeu de la migration : « $unicite »"
fi

code=$(http POST "$API/rest/v1/channels" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"track_id\":\"$TRACK_CONSEIL\",\"name\":\"X\",\"slug\":\"tst-crm021-v2\"}")
[ "$code" = "403" ] && ok "et le refus est de nouveau opposé au viewer" \
	|| fail "après restauration, le viewer obtient encore $code"

titre "7. Suites, tests unitaires et build"

if [ "$RAPIDE" = true ]; then
	printf '  (ignorés : --rapide)\n'
else
	npm run test:sql >/dev/null 2>&1 && ok "npm run test:sql" || fail "npm run test:sql"
	npm run test:unit >/dev/null 2>&1 && ok "npm run test:unit" || fail "npm run test:unit"
	npm run typecheck >/dev/null 2>&1 && ok "npm run typecheck" || fail "npm run typecheck"
	npm run types:check >/dev/null 2>&1 && ok "npm run types:check" || fail "npm run types:check"
	npm run build >/dev/null 2>&1 && ok "npm run build" || fail "npm run build"
	npm run e2e:api >/dev/null 2>&1 && ok "npm run e2e:api" || fail "npm run e2e:api"
	npm run e2e:ui >/dev/null 2>&1 && ok "npm run e2e:ui" || fail "npm run e2e:ui"
fi

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi

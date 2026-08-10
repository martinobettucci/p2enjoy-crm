#!/usr/bin/env bash
# @verifies CRM-019 (docs/BACKLOG.md) — changement atomique du workflow d'un channel entier
# @verifies docs/SPEC-change-channel-workflow.md §1 à §9
# @verifies docs/SCHEMA.md §5 (workflow_changed), §9 (RPC)
# @verifies docs/JOURNAL.md décisions 263, 295 et 306
#
# Ce harnais ne démarre ni n'arrête la pile. Il rejoue la migration sur la base seedée, mesure
# l'absence de mutation métier et la conservation des OID conformes, exerce une vraie course entre
# la RPC et une insertion, puis affaiblit ACL, autorisation, FK, trigger, vocabulaire et mapping.
# Chaque contre-épreuve doit rendre pgTAP rouge et toute sortie restaure l'état livré.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0020_change_channel_workflow.sql
TEST_SQL=supabase/tests/0022_change_channel_workflow.test.sql
SPEC_API=e2e/api/change-channel-workflow.spec.ts
SIGNATURE='public.change_channel_workflow(uuid, uuid, jsonb, boolean)'

WORKSPACE=5eed0000-0000-4000-8000-000000000001
TRACK=5eed0000-0000-4000-8000-000000000021
WORKFLOW_SOURCE=5eed0000-0000-4000-8000-000000000051
ETAPE_SOURCE=5eed0000-0000-4000-8000-000000000061
ADMIN=5eed0000-0000-4000-8000-000000000011
CHANNEL_CONCURRENT=01990000-0000-4000-8000-000000000010
CARD_EXISTANTE=01990000-0000-4000-8000-0000000000a1
CARD_CONCURRENTE=01990000-0000-4000-8000-0000000000a2

checks=0
failures=0
restore_needed=false
pid_a=''
pid_b=''
WORK=$(mktemp -d)

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

appliquer_migration() {
	psql_db -f - < "$MIGRATION"
}

nettoyer_fixture() {
	psql_db -c "delete from public.cards where id in ('$CARD_EXISTANTE','$CARD_CONCURRENTE');
		delete from public.channels where id='$CHANNEL_CONCURRENT';" >/dev/null 2>&1 || true
}

restaurer() {
	set +e
	[ -n "$pid_a" ] && kill "$pid_a" >/dev/null 2>&1 || true
	[ -n "$pid_b" ] && kill "$pid_b" >/dev/null 2>&1 || true
	[ -s "$WORK/is_workspace_admin.sql" ] \
		&& psql_db -f - < "$WORK/is_workspace_admin.sql" >/dev/null 2>&1
	appliquer_migration >/dev/null 2>&1
	nettoyer_fixture
	set -e
}

cleanup() {
	local status=$?
	trap - EXIT
	if [ "$restore_needed" = true ]; then
		restaurer || status=1
	fi
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

suite_verte() {
	scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap.log" 2>&1 \
		&& grep -q '1 fichiers, 59 assertions, aucune anomalie' "$WORK/tap.log"
}

suite_rouge() {
	if scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap-red.log" 2>&1; then
		return 1
	fi
	grep -Eq 'ECHEC|not ok|psql a échoué' "$WORK/tap-red.log"
}

api_verte() {
	npm run --silent e2e:api -- "$SPEC_API" > "$WORK/api.log" 2>&1 \
		&& grep -q '14 passed' "$WORK/api.log"
}

empreinte_metier() {
	psql_db -c "select md5(coalesce(string_agg(ligne, E'\\n' order by ligne), ''))
		from (
			select 'channel:' || row_to_json(ch)::text as ligne from public.channels ch
			union all select 'card:' || row_to_json(c)::text from public.cards c
			union all select 'value:' || row_to_json(v)::text from public.card_field_values v
			union all select 'comment:' || row_to_json(cc)::text from public.card_comments cc
			union all select 'event:' || row_to_json(e)::text from public.card_events e
		) donnees;"
}

identites() {
	psql_db -c "select string_agg(type || ':' || oid::text, '|' order by type) from (
		select 'check' as type, oid from pg_constraint
		 where conrelid='public.card_events'::regclass and conname='card_events_type_check'
		union all select 'fk', oid from pg_constraint
		 where conrelid='public.cards'::regclass and conname='cards_channel_id_workflow_id_fkey'
		union all select 'rpc', oid from pg_proc where oid='$SIGNATURE'::regprocedure
		union all select 'timeline-fn', oid from pg_proc
		 where oid='app.card_events_apres_maj_card()'::regprocedure
		union all select 'trigger', oid from pg_trigger
		 where tgrelid='public.cards'::regclass and tgname='card_events_apres_maj'
	) objets;"
}

degrader_et_verifier() {
	local libelle=$1
	local degradation=$2
	psql_db -c "$degradation" >/dev/null
	if suite_rouge; then
		ok "dégradation vue : $libelle"
	else
		fail "DÉGRADATION NON VUE : $libelle"
	fi
	appliquer_migration >/dev/null
}

echo
echo "Preuves de CRM-019 — changement du workflow d'un channel"
echo

echo "1. Prérequis et contrat livré"
if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi
for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est absent"; fi
done
if head -3 "$MIGRATION" | grep -q '@spec CRM-019' \
	&& head -3 "$TEST_SQL" | grep -q '@verifies CRM-019' \
	&& head -3 "$SPEC_API" | grep -q '@verifies CRM-019'; then
	ok "les trois livrables citent leur contrat CRM-019"
else
	fail "la traçabilité CRM-019 manque dans un livrable"
fi

restore_needed=true
psql_db -c "select pg_get_functiondef('app.is_workspace_admin(uuid)'::regprocedure);" \
	> "$WORK/is_workspace_admin.sql"

echo
echo "2. Migration seedée, données intactes et convergence"
avant_metier=$(empreinte_metier)

# Une base issue de CRM-018 porte encore la clé non différable. La recréer ainsi reproduit ce
# seul état legacy, sans toucher une ligne métier, puis la vraie migration fait la mise à niveau.
psql_db -c "alter table public.cards drop constraint cards_channel_id_workflow_id_fkey;
	alter table public.cards add constraint cards_channel_id_workflow_id_fkey
	foreign key (channel_id, workflow_id) references public.channels(id, workflow_id);" >/dev/null
if appliquer_migration > "$WORK/legacy.log" 2>&1 \
	&& [ "$(psql_db -c "select condeferrable and not condeferred from pg_constraint
		where conrelid='public.cards'::regclass
		and conname='cards_channel_id_workflow_id_fkey';")" = t ]; then
	ok "la migration met réellement à niveau la clé legacy en DEFERRABLE INITIALLY IMMEDIATE"
else
	fail "la mise à niveau de la clé legacy échoue"
	tail -n 20 "$WORK/legacy.log" | sed 's/^/        /'
fi

identites_avant=$(identites)
if appliquer_migration > "$WORK/replay.log" 2>&1; then
	if grep -Eqi 'warning|error|fatal' "$WORK/replay.log"; then
		fail "le rejeu émet un warning ou une erreur"
	else
		ok "la migration se rejoue sans warning ni erreur"
	fi
else
	fail "la migration échoue sur son propre état final"
fi
identites_apres=$(identites)
if [ "$identites_avant" = "$identites_apres" ]; then
	ok "le rejeu conserve les OID des contraintes, fonctions et du trigger conformes"
else
	fail "le rejeu reconstruit encore un objet conforme : $identites_avant → $identites_apres"
fi
if [ "$avant_metier" = "$(empreinte_metier)" ]; then
	ok "mise à niveau et rejeu ne modifient aucune donnée métier seedée"
else
	fail "une donnée métier a changé pendant l'application de la migration"
fi

if suite_verte; then
	ok "suite pgTAP ciblée verte — 59 assertions"
else
	fail "suite pgTAP CRM-019 en échec ou compte inattendu"
	tail -n 25 "$WORK/tap.log" | sed 's/^/        /'
fi
if api_verte; then
	ok "preuve API ciblée verte — 14 scénarios sous vrais JWT"
else
	fail "preuve API CRM-019 en échec ou compte inattendu"
	tail -n 30 "$WORK/api.log" | sed 's/^/        /'
fi

echo
echo "3. Concurrence : aucune card ne se glisse sous l'ancien workflow"
nettoyer_fixture
workflow_cible=$(psql_db -c "select workflow_id from public.channels
	where id='5eed0000-0000-4000-8000-000000000031';")
etape_cible=$(psql_db -c "select id from public.workflow_steps where workflow_id='$workflow_cible'
	order by position, id limit 1;")
psql_db -c "insert into public.channels
	(id, workspace_id, track_id, name, slug, workflow_id, position)
	values ('$CHANNEL_CONCURRENT','$WORKSPACE','$TRACK','Concurrence CRM-019',
	'concurrence-crm-019','$WORKFLOW_SOURCE',999);
	insert into public.cards
	(id, workspace_id, channel_id, workflow_id, current_step_id, title, position, created_by)
	values ('$CARD_EXISTANTE','$WORKSPACE','$CHANNEL_CONCURRENT','$WORKFLOW_SOURCE',
	'$ETAPE_SOURCE','Card existante concurrence CRM-019',1,'$ADMIN');" >/dev/null

psql_db -c "begin;
	select set_config('request.jwt.claims',
		'{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}', true);
	set local role authenticated;
	select count(*) from public.change_channel_workflow(
		'$CHANNEL_CONCURRENT', '$workflow_cible',
		jsonb_build_array(jsonb_build_object(
			'from_step_id','$ETAPE_SOURCE','to_step_id','$etape_cible')), false);
	select pg_sleep(4);
	commit;" > "$WORK/concurrence-a.log" 2>&1 &
pid_a=$!

fenetre=false
for _ in $(seq 1 40); do
	if [ "$(psql_db -c "select count(*) from pg_stat_activity
		where wait_event='PgSleep' and query like '%$CHANNEL_CONCURRENT%';")" -gt 0 ]; then
		fenetre=true
		break
	fi
	sleep 0.1
done

if [ "$fenetre" = true ]; then
	psql_db -c "set statement_timeout='8s';
		insert into public.cards
		(id, workspace_id, channel_id, workflow_id, current_step_id, title, position, created_by)
		values ('$CARD_CONCURRENTE','$WORKSPACE','$CHANNEL_CONCURRENT','$WORKFLOW_SOURCE',
		'$ETAPE_SOURCE','Card concurrente CRM-019',2,'$ADMIN');" \
		> "$WORK/concurrence-b.log" 2>&1 &
	pid_b=$!
else
	fail "la RPC concurrente n'a pas atteint sa fenêtre de preuve"
fi

attente=false
if [ -n "$pid_b" ]; then
	for _ in $(seq 1 40); do
		if [ "$(psql_db -c "select count(*) from pg_stat_activity
			where wait_event_type='Lock' and query like '%$CARD_CONCURRENTE%';")" -gt 0 ]; then
			attente=true
			break
		fi
		sleep 0.1
	done
fi
if [ "$attente" = true ]; then
	ok "l'insertion concurrente attend le verrou du channel au lieu de franchir le mapping"
else
	fail "l'insertion concurrente n'a pas attendu le verrou attendu"
fi

if wait "$pid_a"; then
	ok "la transaction de remappage aboutit entièrement"
else
	fail "la transaction de remappage concurrente échoue"
fi
pid_a=''
if [ -n "$pid_b" ]; then
	if wait "$pid_b"; then
		fail "l'insertion sous l'ancien workflow passe après le remappage"
	elif grep -q 'cards_channel_id_workflow_id_fkey' "$WORK/concurrence-b.log"; then
		ok "après le commit, la FK refuse réellement la card concurrente devenue incohérente"
	else
		fail "l'insertion concurrente échoue pour une cause inattendue"
		tail -n 10 "$WORK/concurrence-b.log" | sed 's/^/        /'
	fi
	pid_b=''
fi

etat=$(psql_db -F '|' -c "select
	(select workflow_id from public.channels where id='$CHANNEL_CONCURRENT'),
	(select workflow_id from public.cards where id='$CARD_EXISTANTE'),
	(select current_step_id from public.cards where id='$CARD_EXISTANTE'),
	(select count(*) from public.cards where id='$CARD_CONCURRENTE'),
	(select count(*) from public.card_events
	 where card_id='$CARD_EXISTANTE' and type='workflow_changed');")
if [ "$etat" = "$workflow_cible|$workflow_cible|$etape_cible|0|1" ]; then
	ok "l'état final est entier : channel et card remappés, intruse absente, une trace exacte"
else
	fail "l'état concurrent final est incohérent : $etat"
fi
nettoyer_fixture

echo
echo "4. Non-complaisance : six protections réellement nécessaires"

degrader_et_verifier \
	"EXECUTE rendu à anon — le geste d'administration deviendrait public" \
	"grant execute on function $SIGNATURE to anon"

psql_db -c "create or replace function app.is_workspace_admin(ws uuid)
	returns boolean language sql stable security definer set search_path = ''
	as \$\$ select true \$\$;" >/dev/null
if suite_rouge; then
	ok "dégradation vue : la garde administrateur qui consentirait tout membre"
else
	fail "DÉGRADATION NON VUE : la garde administrateur consent tout membre"
fi
psql_db -f - < "$WORK/is_workspace_admin.sql" >/dev/null

degrader_et_verifier \
	"la clé composite rendue NOT DEFERRABLE — le lot ne peut plus rester atomique" \
	"alter table public.cards drop constraint cards_channel_id_workflow_id_fkey;
	 alter table public.cards add constraint cards_channel_id_workflow_id_fkey
	 foreign key (channel_id, workflow_id) references public.channels(id, workflow_id)"

degrader_et_verifier \
	"workflow_changed retiré du vocabulaire — la trace serveur serait refusée" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	 check (type = any (array['created','moved','assigned','channel_changed','archived',
	 'unarchived','trashed','restored','field_changed'])) not valid"

degrader_et_verifier \
	"le trigger de cards retiré — le remappage deviendrait silencieux" \
	"drop trigger card_events_apres_maj on public.cards"

degrader_et_verifier \
	"le corps de mapping remplacé — aucun contrôle ne doit rester vert par sa seule signature" \
	"create or replace function public.change_channel_workflow(
		channel_id uuid, workflow_id uuid, step_mapping jsonb,
		discard_field_values boolean default false)
	 returns setof public.cards language plpgsql security definer set search_path = ''
	 as \$\$ begin raise exception 'mapping_guard_removed'; return; end; \$\$"

echo
echo "5. Restauration constatée"
if suite_verte; then
	ok "pgTAP redevient vert après les six restaurations — 59 assertions"
else
	fail "pgTAP reste rouge après restauration"
	tail -n 25 "$WORK/tap.log" | sed 's/^/        /'
fi
if api_verte; then
	ok "les 14 scénarios API redeviennent verts et nettoient leurs fixtures"
else
	fail "l'API ciblée reste rouge après restauration"
	tail -n 30 "$WORK/api.log" | sed 's/^/        /'
fi
if [ "$(psql_db -c "select count(*) from public.channels where id='$CHANNEL_CONCURRENT';")" = 0 ] \
	&& [ "$(psql_db -c "select count(*) from public.cards
		where id in ('$CARD_EXISTANTE','$CARD_CONCURRENTE');")" = 0 ]; then
	ok "la preuve de concurrence ne laisse aucune fixture"
else
	fail "une fixture de concurrence subsiste"
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

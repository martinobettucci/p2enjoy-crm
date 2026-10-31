#!/usr/bin/env bash
# @verifies CRM-019 (docs/BACKLOG.md) — changement atomique du workflow d'un channel entier
# @verifies docs/SPEC-change-channel-workflow.md §1 à §9
# @verifies docs/SCHEMA.md §5 (workflow_changed), §9 (RPC)
# @verifies docs/JOURNAL.md décisions 263, 295 et 306
# @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.7 : la RPC remappe et rend les rattachements (décision 738) ; la 20,
#           SUJET de la section 2, se rejoue privée de la fonction dont la migration 0122 est l'autorité ; les
#           dégradations visent le déclencheur du rattachement et sa clé channel/workflow (docs/SPEC-test-harness.md §3.7)
# @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — les colonnes de rattachement se lisent et s'écrivent sur card_placements
#           (docs/SPEC-rattachements.md §3.2, §5)
# @verifies CRM-111 T2.4.5 (docs/BACKLOG.md) — la clé que la 20 rendait différable a quitté l'affaire avec ses colonnes
#           (migration 0134) : la section 2 constate la clé du RATTACHEMENT au lieu de rejouer la 20 ; la course insère
#           l'affaire puis son rattachement (docs/SPEC-rattachements.md §3.2)
#
# Ce harnais ne démarre ni n'arrête la pile. Il constate la clé channel/workflow du rattachement, exerce une vraie course
# entre la RPC et une insertion, puis affaiblit ACL, autorisation, FK, trigger, vocabulaire et mapping.
# Chaque contre-épreuve doit rendre pgTAP rouge et toute sortie restaure l'état livré.

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/reconstruction.sh
source scripts/lib/reconstruction.sh

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
DB_CONTAINER=$(conteneur db)
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


# RESTAURATION PAR LE RUNNER COMPLET — INC-198, corrigée le 2026-08-21 (décision 499).
#
# Ce harnais restaurait en rejouant `$MIGRATION` SEULE, ce que le §3.5 de
# `docs/SPEC-test-harness.md` interdit depuis INC-142 : « une liste manuelle de migrations
# suivantes devient fausse à chaque nouvelle révision ». Deux défauts se superposaient, et le
# second n'était visible qu'à la mesure.
#
# 1. La 20 n'est plus la dernière autorité sur `card_events_type_check` : les migrations 25, 30 et
#    44 y ajoutent `mail_received`, `mail_sent`, `snoozed` et `woken`.
# 2. SURTOUT, rejouer la 20 ne restaure MÊME PAS son propre ajout sur une base seedée. Sa
#    convergence est gardée par la seconde garde d'INC-144, qui ne s'applique que si aucune ligne
#    de `card_events` ne porte un type hors des dix qu'elle connaît — or le seed en produit quatre.
#    Le `do $$ … $$` est alors un NO-OP SILENCIEUX : le harnais croyait restaurer, et ne restaurait
#    rien.
#
# MESURÉ le 2026-08-21, ce harnais lancé seul sur pile fraîche et seedée : il rendait 23 contrôles,
# 2 en échec — « pgTAP reste rouge après restauration » —, et laissait derrière lui la contrainte
# réduite à NEUF valeurs, `workflow_changed` absente, en `NOT VALID`. Toute écriture serveur de la
# trace échouait dès lors en `23514`, pour ce harnais comme pour tout ce qui s'exécutait ensuite.
# Le rejeu complet du répertoire rend les QUATORZE valeurs, et la contrainte redevient `VALID`.
#
# `--force-recreate` n'est pas décoratif : le `migrations-runner` est un conteneur à usage unique,
# et `docker compose up` sur un conteneur déjà sorti ne le rejoue pas. L'appel porte `--env-file` et
# les DEUX fichiers de composition (`docs/CloudWorker.md` §2.2 bis, décisions 471 et 497) : un appel
# nu recréerait `storage` et `db` sans les surcharges `dev`.
restaurer_etat_courant() {
	# RÉVISÉ PAR `CRM-111` T1 bis (décision 682, INC-289) : rejouer le répertoire sur la base peuplée ne
	# restaure plus — c'est rouge depuis `0099`. La base de développement et ses dérivés sont RECONSTRUITS
	# (`scripts/lib/reconstruction.sh`, docs/SPEC-test-harness.md §3.6), puis seedés.
	reconstruire_base_dev
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
	restaurer_etat_courant >/dev/null
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

degrader_et_verifier() {
	local libelle=$1
	local degradation=$2
	psql_db -c "$degradation" >/dev/null
	if suite_rouge; then
		ok "dégradation vue : $libelle"
	else
		fail "DÉGRADATION NON VUE : $libelle"
	fi
	restaurer_etat_courant >/dev/null
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
echo "2. La clé du lot, sur le rattachement"
# RÉVISÉE PAR `CRM-111` T2.4.5 (décision 51). Cette section rejouait la 20 SEULE, pour mettre à niveau la clé
# `cards_channel_id_workflow_id_fkey` en DEFERRABLE INITIALLY IMMEDIATE et constater qu'un rejeu ne reconstruisait rien.
# La migration 0134 a retiré de l'affaire son channel et son workflow, et cette clé avec eux : la 20 ne s'applique plus
# à la base courante, et son objet vit sur le RATTACHEMENT, où la migration 0110 l'a posé dans la même forme. Le
# contrôle porte donc sur cette clé, et sur le retrait de l'ancienne.
if [ "$(psql_db -c "select condeferrable and not condeferred from pg_constraint
	where conrelid='public.card_placements'::regclass
	and conname='card_placements_channel_workflow_fk';")" = t ]; then
	ok "la clé channel/workflow du rattachement est DEFERRABLE INITIALLY IMMEDIATE"
else
	fail "la clé channel/workflow du rattachement n'a pas la forme que le lot exige"
fi
if [ "$(psql_db -c "select count(*) from pg_constraint
	where conrelid='public.cards'::regclass and conname='cards_channel_id_workflow_id_fkey';")" = 0 ] \
	&& [ "$(psql_db -c "select count(*) from information_schema.columns
		where table_schema='public' and table_name='cards' and column_name in ('channel_id','workflow_id');")" = 0 ]; then
	ok "l'ancienne clé de l'affaire a quitté la base avec ses colonnes (migration 0134)"
else
	fail "l'affaire porte encore la clé ou les colonnes que la migration 0134 retire"
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
	insert into public.cards (id, workspace_id, title, created_by)
	values ('$CARD_EXISTANTE','$WORKSPACE','Card existante concurrence CRM-019','$ADMIN');
	insert into public.card_placements
	(card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
	values ('$CARD_EXISTANTE','$WORKSPACE','$CHANNEL_CONCURRENT','$WORKFLOW_SOURCE','$ETAPE_SOURCE',1);" >/dev/null

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
		insert into public.cards (id, workspace_id, title, created_by)
		values ('$CARD_CONCURRENTE','$WORKSPACE','Card concurrente CRM-019','$ADMIN');
		insert into public.card_placements
		(card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
		values ('$CARD_CONCURRENTE','$WORKSPACE','$CHANNEL_CONCURRENT','$WORKFLOW_SOURCE','$ETAPE_SOURCE',2);" \
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
	# `CRM-111` T2.4.5 (migration 0134) : la clé channel/workflow est celle du RATTACHEMENT.
	elif grep -q 'card_placements_channel_workflow_fk' "$WORK/concurrence-b.log"; then
		ok "après le commit, la FK refuse réellement la card concurrente devenue incohérente"
	else
		fail "l'insertion concurrente échoue pour une cause inattendue"
		tail -n 10 "$WORK/concurrence-b.log" | sed 's/^/        /'
	fi
	pid_b=''
fi

etat=$(psql_db -F '|' -c "select
	(select workflow_id from public.channels where id='$CHANNEL_CONCURRENT'),
	(select workflow_id from public.card_placements where card_id='$CARD_EXISTANTE'),
	(select current_step_id from public.card_placements where card_id='$CARD_EXISTANTE'),
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
	"workflow_changed retiré du vocabulaire — la trace serveur serait refusée" \
	"alter table public.card_events drop constraint card_events_type_check;
	 alter table public.card_events add constraint card_events_type_check
	 check (type = any (array['created','moved','assigned','channel_changed','archived',
	 'unarchived','trashed','restored','field_changed'])) not valid"

# RÉVISÉE PAR `CRM-111` T2.3.7 : `workflow_changed` naît sur la table du RATTACHEMENT depuis T2.3.0 ; retirer le
# déclencheur de `cards`, qui ne l'écrit plus, ne dégradait rien.
degrader_et_verifier \
	"le trigger du rattachement retiré — le remappage deviendrait silencieux" \
	"drop trigger card_placements_write_events on public.card_placements"

degrader_et_verifier \
	"la clé channel/workflow du rattachement rendue NOT DEFERRABLE — le lot ne peut plus rester atomique" \
	"alter table public.card_placements drop constraint card_placements_channel_workflow_fk;
	 alter table public.card_placements add constraint card_placements_channel_workflow_fk
	 foreign key (channel_id, workflow_id) references public.channels(id, workflow_id)"

degrader_et_verifier \
	"le corps de mapping remplacé — aucun contrôle ne doit rester vert par sa seule signature" \
	"create or replace function public.change_channel_workflow(
		channel_id uuid, workflow_id uuid, step_mapping jsonb,
		discard_field_values boolean default false)
	 returns setof public.card_placements language plpgsql security definer set search_path = ''
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

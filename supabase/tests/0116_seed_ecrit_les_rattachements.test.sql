-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.3 : la clé de service écrit les rattachements du seed, migration 124
-- @verifies docs/SPEC-rattachements.md §12 (écriture par le seed, décision 746), §4 (aucun droit nouveau pour
--           `authenticated`) ; docs/SCHEMA.md « Migration `0124` »
--
-- Ce que cette suite prouve, et pourquoi chaque preuve est là.
--   1. Les privilèges accordés : `service_role` INSÈRE un rattachement et met à jour les colonnes que le seed pose —
--      son upsert les réécrit toutes, et il réarme `snoozed_until`. Il ne supprime pas, et ne touche pas à ce que la
--      base tient seule (`health_score`, `created_at`, `updated_at`) : l'accord est borné à son besoin.
--   2. Les privilèges inchangés : `authenticated` et `anon` n'insèrent toujours aucun rattachement.
--   3. Le geste réel : sous le rôle `service_role`, une insertion à identifiant CHOISI aboutit — c'est ce dont dépendent
--      les identifiants stables du seed — et une mise à jour hors de son accord est refusée en `42501`.
--
-- Exécution : `npm run test:sql`, ou directement
--   docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
--     exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0116_seed_ecrit_les_rattachements.test.sql
--
-- Tout se joue dans une transaction annulée : le rattachement de l'affaire du seed retiré puis reposé ne survit pas.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- =============================================================================================
-- 1. Les privilèges accordés à `service_role`
-- =============================================================================================

select ok(has_table_privilege('service_role', 'public.card_placements', 'INSERT'),
	'`service_role` insère un rattachement (le seed, décision 746)');
select ok(has_column_privilege('service_role', 'public.card_placements', 'snoozed_until', 'UPDATE'),
	'`service_role` met à jour `snoozed_until`, que le seed réarme à chaque rejeu');
select ok(not has_column_privilege('service_role', 'public.card_placements', 'created_at', 'UPDATE')
	and not has_column_privilege('service_role', 'public.card_placements', 'updated_at', 'UPDATE')
	and not has_column_privilege('service_role', 'public.card_placements', 'health_score', 'UPDATE'),
	'`service_role` ne met pas à jour ce que la base tient seule : les dates et `health_score`');
select ok(not has_table_privilege('service_role', 'public.card_placements', 'DELETE'),
	'`service_role` ne supprime aucun rattachement');

-- =============================================================================================
-- 2. Les privilèges inchangés des utilisateurs
-- =============================================================================================

select ok(not has_table_privilege('authenticated', 'public.card_placements', 'INSERT'),
	'`authenticated` n''insère toujours aucun rattachement : les fonctions seules le font');
select ok(not has_table_privilege('anon', 'public.card_placements', 'INSERT'),
	'`anon` n''insère aucun rattachement');

-- =============================================================================================
-- 3. Le geste réel, sous le rôle `service_role`
-- =============================================================================================

-- Le rattachement de l'affaire `…c1` est lu, puis retiré en propriétaire : pendant la bascule, l'index
-- `card_placements_one_per_card_idx` n'en admet qu'un, et le seed en posera un seul par affaire.
select workspace_id as ws, channel_id as ch, workflow_id as wf, current_step_id as etape, position as rang
	from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c1' \gset
delete from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c1';

set local role service_role;

select lives_ok(
	format($$insert into public.card_placements (id, workspace_id, card_id, channel_id, workflow_id, current_step_id, position)
		values ('7a770000-0000-4000-8000-0000000001c1', %L, '5eed0000-0000-4000-8000-0000000000c1', %L, %L, %L, %L)$$,
		:'ws', :'ch', :'wf', :'etape', :'rang'),
	'`service_role` pose le rattachement de l''affaire du seed, à l''identifiant qu''il choisit');
select lives_ok(
	$$update public.card_placements set snoozed_until = now() + interval '3 days'
		where id = '7a770000-0000-4000-8000-0000000001c1'$$,
	'`service_role` réarme l''échéance du sommeil');
select throws_ok(
	$$update public.card_placements set created_at = now() where id = '7a770000-0000-4000-8000-0000000001c1'$$,
	'42501', null,
	'une mise à jour hors de l''accord est refusée en `42501`');

reset role;

select results_eq(
	$$select count(*)::int from public.card_placements where id = '7a770000-0000-4000-8000-0000000001c1'$$,
	array[1],
	'le rattachement posé par la clé de service existe, à son identifiant');

select * from finish();
rollback;

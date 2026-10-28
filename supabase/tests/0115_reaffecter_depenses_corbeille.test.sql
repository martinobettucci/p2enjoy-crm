-- @verifies CRM-077 (docs/BACKLOG.md) — onzième tranche (INC-316) : réaffecter les dépenses qui bloquent l'effacement d'un track
-- @verifies docs/SPEC-corbeille.md §9.1 (une dépense bloquante : budget du track en corbeille, affaire hors de ses channels),
--           §9.2 (les refus dans l'ordre — introuvable, réservé, non bloquante, même track, track cible en corbeille,
--           devise —, puis les règles des coûts entières : le point (d) intact, décision 743), §9.4 (après réaffectation,
--           la purge efface le track) ; docs/JOURNAL.md décisions 741 à 743
--
-- LES GESTES SONT JOUÉS SOUS LE RÔLE `authenticated` de Camille (administratrice), Driss (business developer) et Sabine
-- (superadministratrice, membre d'aucun espace). Fixtures propres ; le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set sabine '\'5eed0000-0000-4000-8000-000000000018\''
\set wf '\'5eed0000-0000-4000-8000-000000000051\''
\set etape '\'5eed0000-0000-4000-8000-000000000061\''
\set ta '\'c3160000-0000-4000-8000-0000000000a1\''
\set tb '\'c3160000-0000-4000-8000-0000000000a2\''
\set tc '\'c3160000-0000-4000-8000-0000000000a3\''
\set ca '\'c3160000-0000-4000-8000-0000000000b1\''
\set cb '\'c3160000-0000-4000-8000-0000000000b2\''
\set ka '\'c3160000-0000-4000-8000-0000000000c1\''
\set kb '\'c3160000-0000-4000-8000-0000000000c2\''
-- Budgets du track à effacer : ouvert, clôturé. Budgets cibles : ouvert EUR, CHF, récurrent ; et celui d'un autre track
-- en corbeille.
\set b_ouvert '\'c3160000-0000-4000-8000-0000000000d1\''
\set b_clos '\'c3160000-0000-4000-8000-0000000000d2\''
\set b_cible '\'c3160000-0000-4000-8000-0000000000d3\''
\set b_chf '\'c3160000-0000-4000-8000-0000000000d4\''
\set b_recurrent '\'c3160000-0000-4000-8000-0000000000d5\''
\set b_mort '\'c3160000-0000-4000-8000-0000000000d6\''
\set o_cible '\'c3160000-0000-4000-8000-0000000000f1\''
\set l_ouvert '\'c3160000-0000-4000-8000-0000000000e1\''
\set l_clos '\'c3160000-0000-4000-8000-0000000000e2\''
\set l_interne '\'c3160000-0000-4000-8000-0000000000e3\''

insert into public.tracks (id, workspace_id, name, slug, position) values
	(:ta, :ws, 'INC-316 — track vivant', 'inc316-vivant', 960),
	(:tb, :ws, 'INC-316 — track à effacer', 'inc316-efface', 961),
	(:tc, :ws, 'INC-316 — autre track en corbeille', 'inc316-autre', 962);
insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position) values
	(:ca, :ws, :ta, 'INC-316 — channel vivant', 'inc316-ca', :wf, 960),
	(:cb, :ws, :tb, 'INC-316 — channel du track à effacer', 'inc316-cb', :wf, 961);
-- `CRM-111` T2.4.5 : l'affaire, puis son rattachement, en une instruction (les colonnes de rattachement ont quitté `cards`).
with __source as (select gen_random_uuid() as __id, * from (select * from (values
	(:ka, :ws, :ca, :wf, :etape, 'INC-316 — affaire d''un autre track', 960),
	(:kb, :ws, :cb, :wf, :etape, 'INC-316 — affaire du track à effacer', 961)) as v(id, workspace_id, channel_id, workflow_id, current_step_id, title, position)) as s),
     __affaires as (insert into public.cards (id, workspace_id, title) select id::uuid, workspace_id::uuid, title from __source)
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
select id::uuid, workspace_id::uuid, channel_id::uuid, workflow_id::uuid, current_step_id::uuid, position::numeric from __source;
insert into public.budgets (id, track_id, name, position, currency, is_recurrent) values
	(:b_ouvert, :tb, 'INC-316 — budget ouvert', 960, 'EUR', false),
	(:b_clos, :tb, 'INC-316 — budget clos', 961, 'EUR', false),
	(:b_cible, :ta, 'INC-316 — budget cible', 962, 'EUR', false),
	(:b_chf, :ta, 'INC-316 — budget en francs', 963, 'CHF', false),
	(:b_recurrent, :ta, 'INC-316 — budget récurrent', 964, 'EUR', true),
	(:b_mort, :tc, 'INC-316 — budget d''un track en corbeille', 965, 'EUR', false);
insert into public.budget_occurrences (id, budget_id, label) values (:o_cible, :b_recurrent, 'Novembre 2026');
insert into public.card_costs (id, card_id, budget_id, label, estimated_cost) values
	(:l_ouvert, :ka, :b_ouvert, 'Salon', 300),
	(:l_clos, :ka, :b_clos, 'Impression', 120),
	(:l_interne, :kb, :b_ouvert, 'Interne', 50);
update public.budgets set closed_at = now() where id = :b_clos;
update public.tracks set deleted_at = now() where id in (:tb, :tc);

-- =============================================================================================
-- 1. Les droits
-- =============================================================================================

select ok(has_function_privilege('authenticated', 'public.trash_blocking_costs(uuid)', 'execute')
	and not has_function_privilege('anon', 'public.trash_blocking_costs(uuid)', 'execute'),
	'1 — trash_blocking_costs : authenticated, jamais l''anonyme');
select ok(has_function_privilege('authenticated', 'public.reassign_trashed_track_cost(uuid, uuid, uuid)', 'execute')
	and not has_function_privilege('anon', 'public.reassign_trashed_track_cost(uuid, uuid, uuid)', 'execute'),
	'2 — reassign_trashed_track_cost : authenticated, jamais l''anonyme');

-- =============================================================================================
-- 2. Les dépenses bloquantes — §9.1
-- =============================================================================================

select pg_temp.endosser(:driss);
select throws_ok($$ select * from public.trash_blocking_costs('c3160000-0000-4000-8000-0000000000a2') $$, '42501',
	'reserved_to_admins', '3 — un business developer : réservé aux administrateurs');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:sabine);
select throws_ok($$ select * from public.trash_blocking_costs('c3160000-0000-4000-8000-0000000000a2') $$, 'P0002',
	'track_not_found', '4 — hors de l''espace : introuvable, sans dire qu''il existe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:camille);
select results_eq(
	$$ select cost_id, budget_closed from public.trash_blocking_costs('c3160000-0000-4000-8000-0000000000a2') order by label $$,
	$$ values ('c3160000-0000-4000-8000-0000000000e2'::uuid, true), ('c3160000-0000-4000-8000-0000000000e1'::uuid, false) $$,
	'5 — deux dépenses bloquantes ; celle de l''affaire du track lui-même ne bloque pas, elle part avec lui');
select is((select count(*)::int from public.trash_blocking_costs('c3160000-0000-4000-8000-0000000000a1')), 0,
	'6 — un track vivant n''a rien de bloquant');

-- =============================================================================================
-- 3. Les refus de la réaffectation, dans l'ordre — §9.2
-- =============================================================================================

select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-00000000ffff',
	'c3160000-0000-4000-8000-0000000000d3') $$, 'P0002', 'cost_not_found', '7 — une ligne inconnue : introuvable');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:driss);
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d3') $$, '42501', 'reserved_to_admins', '8 — un business developer : réservé');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:camille);
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e3',
	'c3160000-0000-4000-8000-0000000000d3') $$, 'P0001', 'cost_not_blocking',
	'9 — la dépense d''une affaire du track lui-même ne bloque rien : le geste ne s''y applique pas');
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d2') $$, '22023', 'same_track', '10 — vers un budget du même track : refusé');
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d6') $$, '22023', 'target_in_trash',
	'11 — vers le budget d''un autre track en corbeille : refusé');
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d4') $$, '22023', 'currency_mismatch',
	'12 — vers un budget d''une autre devise : refusé, les montants ne se convertissent pas');
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d5') $$, '23514', null,
	'13 — vers un budget récurrent sans occurrence : la règle des coûts refuse');

-- =============================================================================================
-- 4. La réaffectation, et le point (d) intact — décision 743
-- =============================================================================================

select lives_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e1',
	'c3160000-0000-4000-8000-0000000000d5', 'c3160000-0000-4000-8000-0000000000f1') $$,
	'14 — vers un budget récurrent, avec son occurrence : accepté');
select is((select occurrence_id from public.card_costs where id = 'c3160000-0000-4000-8000-0000000000e1'),
	'c3160000-0000-4000-8000-0000000000f1'::uuid, '15 — la ligne porte l''occurrence choisie');
select is((select estimated_cost from public.card_costs where id = 'c3160000-0000-4000-8000-0000000000e1'), 300.00,
	'16 — et garde ses montants');
select throws_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e2',
	'c3160000-0000-4000-8000-0000000000d3') $$, '23514', null,
	'17 — une dépense sur un budget clôturé ne le quitte pas : aucune exception au point (d)');
update public.budgets set closed_at = null where id = 'c3160000-0000-4000-8000-0000000000d2';
select is((select closed_at from public.budgets where id = 'c3160000-0000-4000-8000-0000000000d2'), null,
	'18 — l''administratrice rouvre le budget d''un track en corbeille, par le geste existant');
select lives_ok($$ select public.reassign_trashed_track_cost('c3160000-0000-4000-8000-0000000000e2',
	'c3160000-0000-4000-8000-0000000000d3') $$, '19 — rouvert, il se quitte');
select is((select count(*)::int from public.trash_blocking_costs('c3160000-0000-4000-8000-0000000000a2')), 0,
	'20 — plus rien ne bloque');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. La purge efface désormais le track — §9.4
-- =============================================================================================

-- Tout ce qui est déjà en corbeille prend la date du jour (comme `0114`), puis seul le track à effacer est reculé.
do $$
declare
	t text;
begin
	foreach t in array array['tracks', 'channels', 'cards'] loop
		execute format('alter table public.%I disable trigger %I', t, t || '_corbeille');
		execute format('update public.%I set deleted_at = now() where deleted_at is not null', t);
		execute format('alter table public.%I enable trigger %I', t, t || '_corbeille');
	end loop;
	alter table public.tracks disable trigger tracks_corbeille;
	update public.tracks set deleted_at = now() - interval '40 days' where id = 'c3160000-0000-4000-8000-0000000000a2';
	alter table public.tracks enable trigger tracks_corbeille;
end;
$$;
select is(app.purge_trash(), 1, '21 — la purge efface le track que rien ne bloque plus');
select ok(not exists (select 1 from public.tracks where id = 'c3160000-0000-4000-8000-0000000000a2')
	and (select count(*) from public.card_costs where id in ('c3160000-0000-4000-8000-0000000000e1',
	     'c3160000-0000-4000-8000-0000000000e2')) = 2,
	'22 — le track est détruit, les deux dépenses réaffectées vivent');

select * from finish();
rollback;

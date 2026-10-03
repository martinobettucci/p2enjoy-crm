-- @verifies INC-270 (docs/INCONSISTENCY_REPORT.md, docs/BACKLOG.md CRM-097 T3) — restaurer une version remappe des
--           affaires vers une étape qu'elle RÉTABLIT, et l'unicité d'un nœud par workflow tient
-- @verifies docs/SPEC-workflow-engine.md §7 ter.12.2 (une étape rétablie est nommée dans le plan, pour qu'un humain
--           puisse la choisir), §7 ter.13.7 (l'ordre des écritures, révisé) ; docs/SPEC-ia.md §13.4 (le point de
--           retour d'une acceptation se restaure) ; migration `0086` ; décision 620
--
-- LE DÉFAUT, MESURÉ LE 2026-10-03 : l'écriture 2 (déplacer les affaires) précédait l'écriture 5 (créer les étapes
-- rétablies) — une affaire ne pouvait viser qu'une étape déjà vivante, et la restauration échouait en 23503.
--
-- Deux workflows jetables dans l'espace du seed, dans une transaction annulée :
--   W1 — l'étape rétablie vise un nœud LIBRE (le cas d'une suggestion acceptée puis restaurée) ;
--   W2 — l'étape rétablie réclame le nœud d'une étape RETIRÉE, avec un autre identifiant : le cas qui imposait
--        l'ordre de `0042`, et qui exige que l'unicité soit ajournée le temps du cœur ;
--   W3 — l'étape rétablie est l'INITIALE de la version : posée non initiale, puis réglée, et comptée créée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temporary table ids (nom text primary key, valeur uuid) on commit drop;
insert into ids values
	('W', '5eed0000-0000-4000-8000-000000000001'),
	('TRACK', '5eed0000-0000-4000-8000-000000000022'),
	('N_PROSPECTION', '5eed0000-0000-4000-8000-000000000041'),
	('N_NEGOCIATION', '5eed0000-0000-4000-8000-000000000043'),
	('N_SIGNATURE', '5eed0000-0000-4000-8000-000000000044'),
	('W1', gen_random_uuid()), ('W1_A', gen_random_uuid()), ('W1_B', gen_random_uuid()), ('W1_C', gen_random_uuid()),
	('W1_CH', gen_random_uuid()), ('W1_CARD', gen_random_uuid()),
	('W2', gen_random_uuid()), ('W2_A', gen_random_uuid()), ('W2_B', gen_random_uuid()), ('W2_B2', gen_random_uuid()),
	('W2_C', gen_random_uuid()), ('W2_CH', gen_random_uuid()), ('W2_CARD', gen_random_uuid()),
	('W3', gen_random_uuid()), ('W3_A', gen_random_uuid()), ('W3_B', gen_random_uuid()), ('W3_C', gen_random_uuid()),
	('W3_CH', gen_random_uuid()), ('W3_CARD', gen_random_uuid());
insert into ids select 'ADM', m.user_id from public.workspace_members m
 where m.workspace_id = '5eed0000-0000-4000-8000-000000000001' and m.role = 'admin' order by m.user_id limit 1;
grant select on ids to authenticated;
create or replace function pg_temp.id(nom text) returns uuid language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur jsonb) on commit drop;
grant all on mesures to authenticated;
create or replace function pg_temp.m(cle text) returns jsonb language sql stable as $$ select valeur from mesures where mesures.cle = $1 $$;

-- Un workflow jetable : A (initiale) → B, un channel, une affaire sur B.
create or replace function pg_temp.workflow(w text) returns void language plpgsql as $$
begin
	insert into public.workflows (id, workspace_id, name, scope, is_default)
	values (pg_temp.id(w), pg_temp.id('W'), 'INC-270 ' || w, 'global', false);
	insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial) values
		(pg_temp.id(w || '_A'), pg_temp.id(w), pg_temp.id('W'), pg_temp.id('N_PROSPECTION'), 1, true),
		(pg_temp.id(w || '_B'), pg_temp.id(w), pg_temp.id('W'), pg_temp.id('N_NEGOCIATION'), 2, false);
	insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	values (pg_temp.id(w), pg_temp.id('W'), pg_temp.id(w || '_A'), pg_temp.id(w || '_B'));
	insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position)
	values (pg_temp.id(w || '_CH'), pg_temp.id('W'), pg_temp.id('TRACK'), 'inc-270 ' || w, 'inc-270-' || lower(w), pg_temp.id(w), 99);
	insert into public.cards (id, workspace_id, channel_id, workflow_id, current_step_id, title, position)
	values (pg_temp.id(w || '_CARD'), pg_temp.id('W'), pg_temp.id(w || '_CH'), pg_temp.id(w), pg_temp.id(w || '_B'), 'inc-270 affaire', 1);
end;
$$;
grant execute on function pg_temp.workflow(text) to authenticated;

select pg_temp.workflow('W1');
select pg_temp.workflow('W2');
select pg_temp.workflow('W3');

-- =============================================================================================
-- 1. La garantie d'unicité, inchangée hors du cœur
-- =============================================================================================

select is(
	(select condeferrable::text || ':' || condeferred::text from pg_constraint where conname = 'workflow_steps_workflow_id_node_id_key'),
	'true:false', '1 — l''unicité d''un nœud par workflow est ajournable, mais contrôlée IMMÉDIATEMENT par défaut');
select throws_ok(
	format($$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position) values (%L, %L, %L, 9)$$,
	       pg_temp.id('W1'), pg_temp.id('W'), pg_temp.id('N_NEGOCIATION')),
	'23505', null, '2 — hors du cœur, un nœud en double est refusé sur-le-champ');

-- Les versions de référence, publiées par la vraie RPC.
select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures select 'V1', to_jsonb((public.publish_workflow_version(pg_temp.id('W1'))).id);
insert into mesures select 'V2', to_jsonb((public.publish_workflow_version(pg_temp.id('W2'))).id);
insert into mesures select 'V3', to_jsonb((public.publish_workflow_version(pg_temp.id('W3'))).id);
reset role;

-- =============================================================================================
-- 3 à 8. W1 — l'affaire va vers une étape rétablie dont le nœud est LIBRE
-- =============================================================================================

-- Le vivant s'écarte de V1 : C ajoutée, l'affaire y passe, B retirée.
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values (pg_temp.id('W1_C'), pg_temp.id('W1'), pg_temp.id('W'), pg_temp.id('N_SIGNATURE'), 3, false);
update public.cards set current_step_id = pg_temp.id('W1_C') where id = pg_temp.id('W1_CARD');
delete from public.workflow_steps where id = pg_temp.id('W1_B');

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok(
	format($$insert into mesures select 'R1', public.restore_workflow_version(%L, %L)$$,
	       pg_temp.m('V1') #>> '{}', jsonb_build_array(jsonb_build_object('from_step_id', pg_temp.id('W1_C'), 'to_step_id', pg_temp.id('W1_B'))))
	, '3 — restaurer V1 en renvoyant l''affaire vers B, que la restauration RÉTABLIT');
reset role;
select is((select current_step_id from public.cards where id = pg_temp.id('W1_CARD')), pg_temp.id('W1_B'),
	'4 — l''affaire est sur B, rétablie avec son identifiant d''origine');
select is((select count(*)::int from public.workflow_steps where id = pg_temp.id('W1_C')), 0, '5 — C, retirée, a disparu');
select is((select string_agg(id::text, ',' order by position) from public.workflow_steps where workflow_id = pg_temp.id('W1')),
	pg_temp.id('W1_A')::text || ',' || pg_temp.id('W1_B')::text, '6 — le workflow est celui de V1, dans son ordre');
select is(
	(select (pg_temp.m('R1') -> 'steps')::text || (pg_temp.m('R1') -> 'cards')::text),
	'{"created": 1, "deleted": 1, "updated": 0}{"remapped": 1}',
	'7 — les compteurs restent justes : une étape créée, une retirée, aucune mise à jour, une affaire remappée');
select is((select is_initial::text from public.workflow_steps where id = pg_temp.id('W1_A')), 'true', '8 — A reste l''étape initiale');

-- =============================================================================================
-- 9 à 14. W2 — l'étape rétablie RÉCLAME le nœud d'une étape retirée
-- =============================================================================================

-- Le vivant : B retirée puis B2 posée sur le MÊME nœud, avec un autre identifiant ; l'affaire y est.
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values (pg_temp.id('W2_C'), pg_temp.id('W2'), pg_temp.id('W'), pg_temp.id('N_SIGNATURE'), 3, false);
update public.cards set current_step_id = pg_temp.id('W2_C') where id = pg_temp.id('W2_CARD');
delete from public.workflow_steps where id = pg_temp.id('W2_B');
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values (pg_temp.id('W2_B2'), pg_temp.id('W2'), pg_temp.id('W'), pg_temp.id('N_NEGOCIATION'), 2, false);
update public.cards set current_step_id = pg_temp.id('W2_B2') where id = pg_temp.id('W2_CARD');
delete from public.workflow_steps where id = pg_temp.id('W2_C');

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok(
	format($$insert into mesures select 'R2', public.restore_workflow_version(%L, %L)$$,
	       pg_temp.m('V2') #>> '{}', jsonb_build_array(jsonb_build_object('from_step_id', pg_temp.id('W2_B2'), 'to_step_id', pg_temp.id('W2_B'))))
	, '9 — restaurer V2 : B rétablie réclame le nœud de B2, retirée, qui porte l''affaire');
reset role;
select is((select current_step_id from public.cards where id = pg_temp.id('W2_CARD')), pg_temp.id('W2_B'), '10 — l''affaire est sur B');
select is((select count(*)::int from public.workflow_steps where workflow_id = pg_temp.id('W2') and node_id = pg_temp.id('N_NEGOCIATION')), 1,
	'11 — un seul nœud « négociation » dans le workflow : B2 a disparu');

-- Le cœur rend l'unicité immédiate : la transaction qui l'a appelé n'en hérite rien. Vérifié AVANT tout
-- `set constraints all immediate`, qui masquerait un oubli.
select throws_ok(
	format($$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position) values (%L, %L, %L, 9)$$,
	       pg_temp.id('W2'), pg_temp.id('W'), pg_temp.id('N_NEGOCIATION')),
	'23505', null, '12 — après la restauration, dans la même transaction, un nœud en double est refusé sur-le-champ');
select lives_ok($$set constraints all immediate$$, '13 — à la validation, aucune contrainte ajournée ne trouve de violation');


select is(
	(select count(*)::int from public.workflow_versions where workflow_id in (pg_temp.id('W1'), pg_temp.id('W2'))),
	4, '14 — chaque restauration a publié son point de retour : deux versions par workflow');

-- =============================================================================================
-- 15 à 17. W3 — l'étape rétablie est l'INITIALE de la version
-- =============================================================================================

-- Le vivant : C devient l'initiale, A est retirée.
update public.workflow_steps set is_initial = false where id = pg_temp.id('W3_A');
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values (pg_temp.id('W3_C'), pg_temp.id('W3'), pg_temp.id('W'), pg_temp.id('N_SIGNATURE'), 0, true);
delete from public.workflow_steps where id = pg_temp.id('W3_A');

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok(format($$insert into mesures select 'R3', public.restore_workflow_version(%L)$$, pg_temp.m('V3') #>> '{}'),
	'15 — restaurer V3 : A, rétablie, était l''initiale ; C, l''initiale vivante, est retirée');
reset role;
select is((select string_agg(id::text || ':' || is_initial::text, ',' order by position) from public.workflow_steps where workflow_id = pg_temp.id('W3')),
	pg_temp.id('W3_A')::text || ':true,' || pg_temp.id('W3_B')::text || ':false', '16 — A est rétablie ET initiale ; B ne l''est pas');
select is((pg_temp.m('R3') -> 'steps')::text, '{"created": 1, "deleted": 1, "updated": 0}',
	'17 — l''étape initiale rétablie se compte CRÉÉE, jamais mise à jour');

select * from finish();
rollback;

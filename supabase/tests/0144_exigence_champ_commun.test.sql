-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.a : une transition exige un champ commun — la table distincte, son
--           espace posé depuis la transition, la clé composite (pas de champ d'un autre espace), le refus d'un champ
--           archivé, les droits réels (l'administratrice exige, le commercial non, la lectrice lit), et l'archivage d'un
--           champ exigé refusé en nommant la transition
-- @verifies docs/SPEC-champs-communs.md §5 (décision 819), §6 ; docs/SCHEMA.md « Migration `0155` » ; CLAUDE.md §10
--
-- Comptes du seed : Camille (administratrice, …0011), Driss (commercial, …0012), Farida (lectrice, …0013). Le `rollback`
-- final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- 1. Structure
select has_table('public', 'workflow_transition_required_common_fields', '1 — la table des exigences de champ commun existe');
select col_is_pk('public', 'workflow_transition_required_common_fields', array['transition_id', 'common_field_id'],
	'2 — sa clé primaire est la transition et le champ commun');

-- 2. Les objets de la preuve, posés sans RLS : deux champs de l'espace du seed, dont un archivé, et un champ d'un autre espace
create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to authenticated;
with siret as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
insert into pg_temp.ids select 'siret', id from siret;
with ancien as (
	insert into public.card_common_fields (workspace_id, key, label, type, archived_at)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-ancien', 'Ancien', 'text', now()) returning id
)
insert into pg_temp.ids select 'ancien', id from ancien;
insert into public.workspaces (id, name, slug) values ('c1120000-0000-4000-8000-0000000000ab', 'Espace de preuve CRM-112 T2', 'tst-crm112-t2');
with autre as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('c1120000-0000-4000-8000-0000000000ab', 'tst-autre', 'Autre', 'text') returning id
)
insert into pg_temp.ids select 'autre', id from autre;
insert into pg_temp.ids
	select 'transition', t.id from public.workflow_transitions t
	 where t.workspace_id = '5eed0000-0000-4000-8000-000000000001' order by t.created_at, t.id limit 1;

-- 3. Les droits réels
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	format($$ insert into public.workflow_transition_required_common_fields (transition_id, common_field_id) values (%L, %L) $$,
	       (select id from pg_temp.ids where nom = 'transition'), (select id from pg_temp.ids where nom = 'siret')),
	'42501', null, '3 — le commercial n''exige pas de champ commun');
reset role;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	format($$ insert into public.workflow_transition_required_common_fields (transition_id, common_field_id) values (%L, %L) $$,
	       (select id from pg_temp.ids where nom = 'transition'), (select id from pg_temp.ids where nom = 'siret')),
	'4 — l''administratrice exige le SIRET pour une transition de son espace');
select throws_ok(
	format($$ insert into public.workflow_transition_required_common_fields (transition_id, common_field_id) values (%L, %L) $$,
	       (select id from pg_temp.ids where nom = 'transition'), (select id from pg_temp.ids where nom = 'siret')),
	'23505', null, '5 — la même exigence ne se pose pas deux fois');
select throws_ok(
	format($$ insert into public.workflow_transition_required_common_fields (transition_id, common_field_id) values (%L, %L) $$,
	       (select id from pg_temp.ids where nom = 'transition'), (select id from pg_temp.ids where nom = 'autre')),
	'23503', null, '6 — un champ d''un autre espace n''est pas exigible : la clé composite le refuse');
select throws_ok(
	format($$ insert into public.workflow_transition_required_common_fields (transition_id, common_field_id) values (%L, %L) $$,
	       (select id from pg_temp.ids where nom = 'transition'), (select id from pg_temp.ids where nom = 'ancien')),
	'P0001', 'common_field_archived', '7 — un champ archivé n''est pas exigible');
reset role;

select is(
	(select workspace_id from public.workflow_transition_required_common_fields
	  where common_field_id = (select id from pg_temp.ids where nom = 'siret')),
	'5eed0000-0000-4000-8000-000000000001'::uuid,
	'8 — l''espace de l''exigence est posé depuis la transition');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.workflow_transition_required_common_fields
	  where common_field_id = (select id from pg_temp.ids where nom = 'siret')),
	1, '9 — la lectrice lit l''exigence (membre de l''espace)');
reset role;

-- 4. L'archivage d'un champ exigé — §6
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	format($$ update public.card_common_fields set archived_at = now() where id = %L $$, (select id from pg_temp.ids where nom = 'siret')),
	'P0001', 'common_field_in_use', '10 — l''archivage d''un champ exigé par une transition est refusé');
reset role;

-- Le refus nomme la transition (le détail), lu par une capture de l'exception.
create or replace function pg_temp.detail_du_refus(p_champ uuid) returns text language plpgsql as $$
declare v_detail text;
begin
	update public.card_common_fields set archived_at = now() where id = p_champ;
	return null;
exception when others then
	get stacked diagnostics v_detail = pg_exception_detail;
	return v_detail;
end;
$$;
select ok(
	pg_temp.detail_du_refus((select id from pg_temp.ids where nom = 'siret')) like '% : % → %',
	'11 — le refus nomme la transition : « workflow : étape → étape »');

delete from public.workflow_transition_required_common_fields where common_field_id = (select id from pg_temp.ids where nom = 'siret');
select lives_ok(
	format($$ update public.card_common_fields set archived_at = now() where id = %L $$, (select id from pg_temp.ids where nom = 'siret')),
	'12 — l''exigence retirée, l''archivage passe');

select * from finish();
rollback;

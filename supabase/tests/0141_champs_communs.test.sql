-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T1 : les champs communs en base — structure et RLS, la validation par
--           type partagée, la clé composite (une valeur ne croise pas deux espaces), l'unicité et l'immuabilité de la clé,
--           la position attribuée, l'auteur posé par la base, et les droits réels : la lectrice lit sans écrire, le
--           commercial écrit une valeur sans définir de champ, l'administratrice définit
-- @verifies docs/SPEC-champs-communs.md §3, §4 ; docs/SCHEMA.md « Migration `0152` » ; CLAUDE.md §10
--
-- Comptes du seed : Camille (administratrice, …0011), Driss (commercial, …0012), Farida (lectrice, …0013). Le `rollback`
-- final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- 1. Structure
select has_table('public', 'card_common_fields', '1 — la table des définitions existe');
select has_table('public', 'card_common_field_values', '2 — la table des valeurs existe');
select ok(
	(select bool_and(c.relrowsecurity) from pg_class c
	  where c.oid in ('public.card_common_fields'::regclass, 'public.card_common_field_values'::regclass)),
	'3 — la RLS est active sur les deux tables');
select has_function('app', 'validate_field_value', array['text', 'jsonb', 'text', 'jsonb', 'uuid'],
	'4 — la validation par type partagée existe');

-- 2. Des champs posés par la clé de service (sans RLS), dans l'espace du seed
create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to authenticated;
-- Deux insertions distinctes, dans l'ordre : la position du second se lit après celle du premier.
with siret as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
insert into pg_temp.ids select 'siret', id from siret;
with secteur as (
	insert into public.card_common_fields (workspace_id, key, label, type, options)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-secteur', 'Secteur', 'select',
	        '{"choices": [{"value": "sante", "label": "Santé"}, {"value": "public", "label": "Public"}]}')
	returning id
)
insert into pg_temp.ids select 'secteur', id from secteur;

select ok(
	(select f2.position > f1.position from public.card_common_fields f1, public.card_common_fields f2
	  where f1.id = (select id from pg_temp.ids where nom = 'siret') and f2.id = (select id from pg_temp.ids where nom = 'secteur')),
	'5 — la position est attribuée en fin de liste de l''espace');

select throws_ok(
	$$ insert into public.card_common_fields (workspace_id, key, label, type)
	   values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'Doublon', 'text') $$,
	'23505', null, '6 — une clé est unique dans l''espace');

select throws_ok(
	$$ insert into public.card_common_fields (workspace_id, key, label, type)
	   values ('5eed0000-0000-4000-8000-000000000001', 'tst-secteur-vide', 'Secteur', 'select') $$,
	'23514', null, '7 — un choix sans liste est refusé, comme pour un champ de workflow');

select ok(
	not has_column_privilege('authenticated', 'public.card_common_fields', 'key', 'update')
	and not has_column_privilege('authenticated', 'public.card_common_fields', 'type', 'update')
	and has_column_privilege('authenticated', 'public.card_common_fields', 'label', 'update')
	and not has_table_privilege('authenticated', 'public.card_common_fields', 'delete')
	and not has_table_privilege('authenticated', 'public.card_common_field_values', 'delete'),
	'8 — la clé et le type ne se modifient pas ; aucune suppression');

-- 3. La validation partagée et la clé composite
create temp table pg_temp.affaire as
	select id, workspace_id from public.cards where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	 order by created_at, id limit 1;
grant select on pg_temp.affaire to authenticated;

select throws_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '42') $$,
	       (select id from pg_temp.affaire), (select id from pg_temp.ids where nom = 'siret'), '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'invalid_field_value', '9 — un nombre pour un champ texte est refusé par la validation partagée');

select throws_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '"industrie"') $$,
	       (select id from pg_temp.affaire), (select id from pg_temp.ids where nom = 'secteur'), '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'invalid_field_value', '10 — un choix hors de la liste est refusé');

insert into public.workspaces (id, name, slug) values ('c1120000-0000-4000-8000-0000000000aa', 'Espace de preuve CRM-112', 'tst-crm112-autre');
with autre as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('c1120000-0000-4000-8000-0000000000aa', 'tst-autre', 'Autre', 'text') returning id
)
insert into pg_temp.ids select 'autre', id from autre;

select throws_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '"x"') $$,
	       (select id from pg_temp.affaire), (select id from pg_temp.ids where nom = 'autre'), '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'invalid_field_value', '11 — un champ d''un autre espace ne reçoit pas de valeur pour cette affaire');

select throws_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '"x"') $$,
	       (select id from pg_temp.affaire), (select id from pg_temp.ids where nom = 'autre'), 'c1120000-0000-4000-8000-0000000000aa'),
	'23503', null, '12 — la charnière `workspace_id` refuse une affaire et un champ de deux espaces');

-- 4. Les droits réels
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');  -- Farida, lectrice
select ok(
	(select count(*) from public.card_common_fields where key in ('tst-siret', 'tst-secteur')) = 2,
	'13 — la lectrice lit les définitions de son espace');
select throws_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '"123"') $$,
	       (select id from pg_temp.affaire), (select id from pg_temp.ids where nom = 'siret'), '5eed0000-0000-4000-8000-000000000001'),
	'42501', null, '14 — la lectrice n''écrit pas de valeur');
reset role;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');  -- Driss, commercial
create temp table pg_temp.ecrite as select id from public.cards where app.can_write_card(id) order by created_at, id limit 1;
select throws_ok(
	$$ insert into public.card_common_fields (workspace_id, key, label, type)
	   values ('5eed0000-0000-4000-8000-000000000001', 'tst-driss', 'Champ de Driss', 'text') $$,
	'42501', null, '15 — un commercial ne définit pas de champ commun');
select lives_ok(
	format($$ insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
	          values (%L, %L, %L, '"123 456 789 00012"') $$,
	       (select id from pg_temp.ecrite), (select id from pg_temp.ids where nom = 'siret'), '5eed0000-0000-4000-8000-000000000001'),
	'16 — le commercial écrit la valeur d''une affaire qu''il peut écrire');
reset role;

select is(
	(select updated_by from public.card_common_field_values
	  where card_id = (select id from pg_temp.ecrite) and field_id = (select id from pg_temp.ids where nom = 'siret')),
	'5eed0000-0000-4000-8000-000000000012'::uuid,
	'17 — l''auteur de la valeur est posé par la base');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, administratrice
select lives_ok(
	$$ insert into public.card_common_fields (workspace_id, key, label, type, options)
	   values ('5eed0000-0000-4000-8000-000000000001', 'tst-budget', 'Budget client', 'money', '{"currency": "EUR"}') $$,
	'18 — l''administratrice définit un champ commun');
reset role;

select * from finish();
rollback;

-- @verifies CRM-116 (docs/BACKLOG.md) — tranche T2 : la couleur d'un channel, migration 116
-- @verifies docs/SPEC-administration-arborescence.md §14.2 (la donnée, aucune politique nouvelle, le privilège de la
--           colonne) ; docs/SPEC-channels.md §2.1 ; docs/SCHEMA.md (`channels`) ; docs/DESIGN_SYSTEM.md §1 (jamais un
--           hexadécimal libre)
--
-- Ce que cette suite prouve, et pourquoi chaque preuve est là.
--   1. La forme de la colonne : `text`, non nulle, `neutral` par défaut — la forme exacte de `tracks.color`.
--   2. Le privilège `UPDATE` de la colonne. Il est accordé COLONNE PAR COLONNE depuis la migration 37 : sans l'accord de
--      la migration 116, la colonne serait « muette » et l'administrateur ne pourrait pas la changer. C'est la preuve
--      qui tomberait la première si l'accord disparaissait.
--   3. La contrainte des cinq jetons, opposable à un appel direct.
--   4. Les droits, sous les politiques EXISTANTES : l'administrateur écrit ; la lectrice, le business developer et
--      l'administrateur d'un autre espace ne changent rien.
--
-- Exécution : `npm run test:sql`, ou directement
--   docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
--     exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0112_couleur_channels.test.sql
--
-- Tout se joue dans une transaction annulée : aucune donnée du seed n'est lue ni modifiée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- =============================================================================================
-- 1. La forme de la colonne
-- =============================================================================================

select has_column('public', 'channels', 'color', '`channels.color` existe');
select col_type_is('public', 'channels', 'color', 'text', '`channels.color` est un `text`');
select col_not_null('public', 'channels', 'color', '`channels.color` est non nulle');
select col_default_is('public', 'channels', 'color', 'neutral', '`channels.color` vaut `neutral` par défaut');

-- =============================================================================================
-- 2. Le privilège de la colonne — accordé explicitement (migration 37, puis 116)
-- =============================================================================================

select ok(
	has_column_privilege('authenticated', 'public.channels', 'color', 'UPDATE'),
	'`authenticated` a le privilège UPDATE sur `channels.color` : la colonne n''est pas muette');

-- =============================================================================================
-- 3. La contrainte des cinq jetons
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	('44440000-0000-4000-8000-000000000001', 'Couleurs A', 'couleurs-a'),
	('44440000-0000-4000-8000-000000000002', 'Couleurs B', 'couleurs-b');

insert into public.tracks (id, workspace_id, name, slug, position) values
	('44440000-0000-4000-8000-0000000000a1', '44440000-0000-4000-8000-000000000001', 'Track couleurs', 'track-couleurs', 1);

insert into public.workflows (id, workspace_id, name, scope) values
	('44440000-0000-4000-8000-0000000000f1', '44440000-0000-4000-8000-000000000001', 'Workflow couleurs', 'global');

select lives_ok(
	$$insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, color, position)
	  values ('44440000-0000-4000-8000-0000000000c1', '44440000-0000-4000-8000-000000000001',
	          '44440000-0000-4000-8000-0000000000a1', '44440000-0000-4000-8000-0000000000f1',
	          'Bleu', 'bleu', 'brand', 1)$$,
	'`color = brand` est accepté');

select lives_ok(
	$$insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position)
	  values ('44440000-0000-4000-8000-0000000000c2', '44440000-0000-4000-8000-000000000001',
	          '44440000-0000-4000-8000-0000000000a1', '44440000-0000-4000-8000-0000000000f1',
	          'Sans couleur', 'sans-couleur', 2)$$,
	'un channel créé sans couleur est accepté');

select is(
	(select color from public.channels where id = '44440000-0000-4000-8000-0000000000c2'),
	'neutral',
	'un channel créé sans couleur prend `neutral`');

select throws_ok(
	$$update public.channels set color = '#23468C' where id = '44440000-0000-4000-8000-0000000000c1'$$,
	'23514', null,
	'docs/DESIGN_SYSTEM.md §1 : un hexadécimal est refusé par `channels_color_check`');

select throws_ok(
	$$update public.channels set color = 'turquoise' where id = '44440000-0000-4000-8000-0000000000c1'$$,
	'23514', null,
	'un jeton qui n''existe pas dans le design system est refusé');

select throws_ok(
	$$update public.channels set color = null where id = '44440000-0000-4000-8000-0000000000c1'$$,
	'23502', null,
	'une couleur nulle est refusée');

-- =============================================================================================
-- 4. Les droits, sous les politiques existantes
-- =============================================================================================
-- Le procédé de la suite `0004` : les revendications posées comme PostgREST les pose, et le rôle applicatif endossé par
-- `set local role`. Un `UPDATE` que la politique écarte ne lève pas d'erreur : il ne touche aucune ligne, et c'est le
-- compte des lignes rendues qui le prouve.

insert into public.profiles (id, full_name) values
	('44440000-0000-4000-8000-00000000000a', 'Admin couleurs A'),
	('44440000-0000-4000-8000-00000000000b', 'Lectrice couleurs A'),
	('44440000-0000-4000-8000-00000000000d', 'Commercial couleurs A'),
	('44440000-0000-4000-8000-00000000000c', 'Admin couleurs B');

insert into public.workspace_members (workspace_id, user_id, role) values
	('44440000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000a', 'admin'),
	('44440000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000b', 'viewer'),
	('44440000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000d', 'business_developer'),
	('44440000-0000-4000-8000-000000000002', '44440000-0000-4000-8000-00000000000c', 'admin');

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- --- 4.1 L'administrateur de l'espace écrit la couleur ----------------------------------------

select pg_temp.endosser('44440000-0000-4000-8000-00000000000a');
with ecrit as (
	update public.channels set color = 'success'
	where id = '44440000-0000-4000-8000-0000000000c1' returning 1
)
select is(count(*)::int, 1, 'l''administrateur de l''espace change la couleur d''un channel') from ecrit;

select lives_ok(
	$$insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, color, position)
	  values ('44440000-0000-4000-8000-0000000000c3', '44440000-0000-4000-8000-000000000001',
	          '44440000-0000-4000-8000-0000000000a1', '44440000-0000-4000-8000-0000000000f1',
	          'Jaune', 'jaune', 'accent', 3)$$,
	'l''administrateur crée un channel avec sa couleur');
reset role;

select is(
	(select color from public.channels where id = '44440000-0000-4000-8000-0000000000c1'),
	'success',
	'la couleur écrite par l''administrateur est relue');

-- --- 4.2 Les autres ne changent rien ----------------------------------------------------------

select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
with ecrit as (
	update public.channels set color = 'danger'
	where id = '44440000-0000-4000-8000-0000000000c1' returning 1
)
select is(count(*)::int, 0, 'la lectrice ne change pas la couleur d''un channel') from ecrit;
reset role;

select pg_temp.endosser('44440000-0000-4000-8000-00000000000d');
with ecrit as (
	update public.channels set color = 'danger'
	where id = '44440000-0000-4000-8000-0000000000c1' returning 1
)
select is(count(*)::int, 0, 'le business developer ne change pas la couleur d''un channel') from ecrit;
reset role;

select pg_temp.endosser('44440000-0000-4000-8000-00000000000c');
with ecrit as (
	update public.channels set color = 'danger'
	where id = '44440000-0000-4000-8000-0000000000c1' returning 1
)
select is(count(*)::int, 0, 'l''administrateur d''un autre espace ne change pas la couleur') from ecrit;
reset role;

select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, color, position)
	  values ('44440000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-0000000000a1',
	          '44440000-0000-4000-8000-0000000000f1', 'Refusé', 'refuse', 'danger', 4)$$,
	'42501', null,
	'la lectrice ne crée pas de channel, couleur ou non');
reset role;

select is(
	(select color from public.channels where id = '44440000-0000-4000-8000-0000000000c1'),
	'success',
	'après les trois refus, la couleur est celle qu''a posée l''administrateur');

select * from finish();

rollback;

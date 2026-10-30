-- @verifies CRM-071 (docs/BACKLOG.md) — tranche T1 : les vues sauvegardées en base
-- @verifies docs/SPEC-vues-import-export.md §2.1 (la table, l'unicité du nom), §2.2 (les filtres aux clés fermées), §2.3
--           (qui lit, qui écrit) ; docs/JOURNAL.md décisions 774 à 776 ; CLAUDE.md §10 (refus par la base)
--
-- Joué sous le rôle `authenticated` de Driss (business developer), de Farida (lectrice, fermée sur « Conseil & IA ») et
-- de Camille (administratrice). Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

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

\set refonte '\'5eed0000-0000-4000-8000-000000000034\''
\set grands '\'5eed0000-0000-4000-8000-000000000032\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''

-- Le jeu sème des vues (docs/SPEC-seed.md) : la preuve part d'une table vide, dans la transaction.
delete from public.saved_views;

-- =============================================================================================
-- 1. Le contrat de la table
-- =============================================================================================

select ok((select relrowsecurity from pg_class where oid = 'public.saved_views'::regclass), '1 — la RLS est activée');
select ok(
	not has_column_privilege('authenticated', 'public.saved_views', 'owner_id', 'INSERT')
	and not has_column_privilege('authenticated', 'public.saved_views', 'workspace_id', 'INSERT')
	and not has_column_privilege('authenticated', 'public.saved_views', 'channel_id', 'UPDATE')
	and not has_table_privilege('anon', 'public.saved_views', 'SELECT'),
	'2 — ni la propriétaire, ni l''espace, ni le channel ne s''écrivent ; l''anonyme ne lit rien');

-- =============================================================================================
-- 2. Les filtres aux clés fermées — §2.2
-- =============================================================================================

select ok(app.saved_view_filters_valid('{"sort": "amount", "direction": "desc", "step_id": "5eed0000-0000-4000-8000-000000000034", "search": "lyon", "snoozed": "shown"}'),
	'3 — des filtres complets et bien formés sont acceptés');
select ok(not app.saved_view_filters_valid('{"page": 2}'), '4 — une clé inconnue (la page) est refusée');
select ok(not app.saved_view_filters_valid('{"sort": "health"}') and not app.saved_view_filters_valid('{"step_id": "pas-un-uuid"}')
          and not app.saved_view_filters_valid(jsonb_build_object('search', repeat('x', 201))),
	'5 — un tri inconnu, une étape mal formée, une recherche trop longue sont refusés');

-- =============================================================================================
-- 3. Les vues privées — §2.3
-- =============================================================================================

select pg_temp.endosser(:driss);
select lives_ok($$ insert into public.saved_views (channel_id, name, filters)
	values ('5eed0000-0000-4000-8000-000000000034', 'Mes négociations', '{"sort": "next_action_at"}') $$,
	'6 — Driss enregistre une vue privée');
select throws_ok($$ insert into public.saved_views (channel_id, name) values ('5eed0000-0000-4000-8000-000000000034', '  mes NÉGOCIATIONS ') $$,
	'23505', null, '7 — un second nom identique, à la casse et aux blancs près, est refusé');
select throws_ok($$ insert into public.saved_views (channel_id, name, visibility)
	values ('5eed0000-0000-4000-8000-000000000034', 'Pour tous', 'workspace') $$,
	'42501', null, '8 — un business developer ne publie pas pour l''espace');
select throws_ok($$ update public.saved_views set visibility = 'workspace' where name = 'Mes négociations' $$,
	'42501', null, '9 — ni ne publie sa propre vue après coup');
select pg_temp.redevenir_proprietaire();
select is((select owner_id::text || '|' || workspace_id::text from public.saved_views where name = 'Mes négociations'),
	'5eed0000-0000-4000-8000-000000000012|5eed0000-0000-4000-8000-000000000001',
	'10 — la base pose la propriétaire (l''appelant) et l''espace (celui du channel)');

select pg_temp.endosser(:camille);
select is((select count(*)::int from public.saved_views), 0, '11 — l''administratrice ne voit pas la vue privée de Driss');
update public.saved_views set name = 'Détournée';
delete from public.saved_views;
select pg_temp.redevenir_proprietaire();
select is((select name from public.saved_views where owner_id = :driss), 'Mes négociations',
	'12 — ni ne la renomme ni ne la supprime : ses écritures sont filtrées');

-- =============================================================================================
-- 4. Les vues de l'espace — §2.3
-- =============================================================================================

select pg_temp.endosser(:camille);
select lives_ok($$ insert into public.saved_views (channel_id, name, visibility, filters)
	values ('5eed0000-0000-4000-8000-000000000034', 'Revue du lundi', 'workspace', '{"sort": "next_action_at", "direction": "asc"}') $$,
	'13 — l''administratrice publie une vue pour l''espace');
select lives_ok($$ insert into public.saved_views (channel_id, name, visibility)
	values ('5eed0000-0000-4000-8000-000000000032', 'Grands comptes à suivre', 'workspace') $$,
	'14 — et une sur « Grands comptes »');
select throws_ok($$ update public.saved_views set visibility = 'private' where name = 'Revue du lundi' $$,
	'22023', 'saved_view_cannot_be_unpublished', '15 — une vue publiée ne redevient pas privée : on la supprime');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:driss);
select is((select string_agg(name, ', ' order by name) from public.saved_views),
	'Grands comptes à suivre, Mes négociations, Revue du lundi', '16 — Driss lit sa vue et celles de l''espace');
delete from public.saved_views where name = 'Revue du lundi';
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.saved_views where name = 'Revue du lundi'), 1,
	'17 — mais ne supprime pas une vue de l''espace');

select pg_temp.endosser(:farida);
select is((select string_agg(name, ', ' order by name) from public.saved_views), 'Revue du lundi',
	'18 — la lectrice, fermée sur « Conseil & IA », ne lit pas la vue de « Grands comptes »');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

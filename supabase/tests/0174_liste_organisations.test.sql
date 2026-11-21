-- @verifies CRM-152 (docs/BACKLOG.md) — tranche T1 : les tracks d'une organisation par ses contacts (rattachement archivé
--           exclu, sous la RLS de l'appelant) ; la liste en base — recherche échappée, l'un des tracks, avec ou sans
--           recettes, tri total, pagination et total compté, les deux refus
-- @verifies docs/SPEC-organisations.md §8.1, §8.2 ; docs/JOURNAL.md décisions 931 et 936 ; CLAUDE.md §10
--
-- Sur le seed : Vertigo Conseil (conseil-ia et formation, des recettes), Sogexia (conseil-ia, par « Migration ERP Sogexia »),
-- Comptoir Vasseur (aucun contact). Les écritures de la preuve vivent dans une transaction annulée.
--
-- Révisé le 2026-11-18 (CRM-153 T1, migration 0188) : la signature de la liste gagne `p_category_ids uuid[]`, en dernier ;
-- l'assertion 1 la nomme. Le contrat prouvé ici ne change pas.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to authenticated;
-- `CRM-162` T3 (docs/SPEC-seed.md §54, décision 51) : « Studio Lumen » a son homonyme, de même domaine ; celle de l'espace du seed.
insert into pg_temp.ids select 'vertigo', id from public.organizations
 where name = 'Vertigo Conseil' and workspace_id = '5eed0000-0000-4000-8000-000000000001';
insert into pg_temp.ids values ('sogexia', '5eed0000-0000-4000-8000-000000000081'), ('comptoir', '5eed0000-0000-4000-8000-000000000083');
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;
create or replace function pg_temp.slugs(o uuid) returns text language sql stable as $$
	select coalesce(string_agg(slug, ',' order by slug), '') from public.organization_tracks(array[o])
$$;
create or replace function pg_temp.noms(p_search text default null, p_tracks uuid[] default null, p_recettes text default 'all',
	p_tri text default 'name', p_desc boolean default false, p_limite integer default 100, p_decalage integer default 0)
returns text language sql stable as $$
	select coalesce(string_agg(name, '|' order by rang), '') from (
		select name, row_number() over () as rang
		  from public.organization_list('5eed0000-0000-4000-8000-000000000001', p_search, p_tracks, p_recettes, p_tri, p_desc,
		                                p_limite, p_decalage)) l
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- La forme
-- ------------------------------------------------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])'::regprocedure),
	false, '1 — la liste est SECURITY INVOKER : elle rend ce que la RLS laisse lire');
select ok(not has_function_privilege('anon', 'public.organization_tracks(uuid[])', 'execute'), '2 — l''anonyme n''appelle pas les tracks');

-- ------------------------------------------------------------------------------------------------------------------
-- Les tracks, par les contacts (§8.1)
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, administratrice
select is(pg_temp.slugs(pg_temp.id('vertigo')), 'conseil-ia,formation', '3 — Vertigo Conseil : deux tracks, par ses contacts');
select is(pg_temp.slugs(pg_temp.id('sogexia')), 'conseil-ia', '4 — Sogexia : un track, par son affaire');
select is(pg_temp.slugs(pg_temp.id('comptoir')), '', '5 — une organisation sans contact n''a aucun track');
reset role;
-- Chaque maillon de la règle, rompu l'un après l'autre sur l'unique chemin de Sogexia (« Migration ERP Sogexia », …0c2),
-- puis rétabli par le savepoint.
savepoint maillon;
update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000c2';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.slugs(pg_temp.id('sogexia')), '', '6 — une affaire à la corbeille ne compte pas');
rollback to savepoint maillon;
savepoint maillon;
update public.card_placements set archived_at = now() where card_id = '5eed0000-0000-4000-8000-0000000000c2';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.slugs(pg_temp.id('sogexia')), '', '7 — un rattachement archivé ne compte pas');
rollback to savepoint maillon;
savepoint maillon;
update public.channels set archived_at = now()
 where id in (select channel_id from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c2');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.slugs(pg_temp.id('sogexia')), '', '8 — un channel archivé ne compte pas');
rollback to savepoint maillon;
savepoint maillon;
update public.tracks set archived_at = now() where id = '5eed0000-0000-4000-8000-000000000021';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.slugs(pg_temp.id('sogexia')), '', '9 — un track archivé ne compte pas');
rollback to savepoint maillon;

-- La lectrice lit le track conseil-ia, mais aucune des affaires qui y relient Vertigo Conseil : la RLS de `cards` le lui
-- retire, et rien ne trahit son existence.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');  -- Farida, lectrice
select is(pg_temp.slugs(pg_temp.id('vertigo')), 'formation', '10 — la lectrice ne voit que les tracks des affaires qu''elle lit');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- La liste (§8.2)
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.noms('vertigo'), 'Vertigo Conseil', '11 — la recherche porte sur le nom, sans casse');
select ok(pg_temp.noms('sogexia.') <> '', '12 — et sur le domaine ou le site web');
select is(pg_temp.noms('%'), '', '13 — un joker de la saisie est échappé : « % » ne rend rien');
select is(pg_temp.noms(null, array['5eed0000-0000-4000-8000-000000000023'::uuid]), 'Vertigo Conseil',
	'14 — le filtre par track : formation');
select ok(pg_temp.noms(null, array['5eed0000-0000-4000-8000-000000000023'::uuid, '5eed0000-0000-4000-8000-000000000021'::uuid]) like '%Atelier Lumen%',
	'15 — plusieurs tracks : l''un d''eux élargit la liste');
select ok(pg_temp.noms(null, null, 'with') like '%Vertigo Conseil%' and pg_temp.noms(null, null, 'without') not like '%Vertigo Conseil%',
	'16 — avec et sans recettes : Vertigo Conseil d''un seul côté');
reset role;
-- Toutes les affaires qui portent une recette à la corbeille : plus aucune organisation n'en a.
savepoint maillon;
update public.cards set deleted_at = now() where id in (select card_id from public.card_revenues);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.noms(null, null, 'with'), '', '17 — une recette d''une affaire à la corbeille ne compte pas');
rollback to savepoint maillon;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(split_part(pg_temp.noms(null, null, 'all', 'contacts', true), '|', 1) <> 'Comptoir Vasseur', true,
	'18 — le tri par contacts, descendant : une organisation sans contact ne vient pas en tête');
select is(
	(select count(*)::integer from (
		select id from public.organization_list('5eed0000-0000-4000-8000-000000000001', null, null, 'all', 'name', false, 3, 0)
		union
		select id from public.organization_list('5eed0000-0000-4000-8000-000000000001', null, null, 'all', 'name', false, 3, 3)) p),
	6, '19 — deux pages de trois : six organisations distinctes, aucune répétée');
select is(
	(select max(total_count) from public.organization_list('5eed0000-0000-4000-8000-000000000001', null, null, 'all', 'name', false, 2, 0)),
	(select count(*) from public.organizations where workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	'20 — total_count compte tout ce qui répond, au-delà de la page');
select throws_ok($$ select * from public.organization_list('5eed0000-0000-4000-8000-000000000001', null, null, 'peut-etre') $$,
	'22023', 'invalid_revenues_filter', '21 — un filtre de recettes inconnu est refusé');
select throws_ok($$ select * from public.organization_list('5eed0000-0000-4000-8000-000000000001', null, null, 'all', 'recettes') $$,
	'22023', 'invalid_sort', '22 — aucun tri sur les recettes (décision 936)');
reset role;

select * from finish();
rollback;

-- @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : `organization_list` lit plusieurs espaces — la portée des espaces
--           donnés, sinon de l'espace donné, sinon de tous ceux que la RLS laisse lire ; `workspace_id` sur chaque ligne ;
--           `total_count` sur toute la portée ; un espace non lu ne rend rien ; les refus et l'appel d'avant inchangés
-- @verifies docs/SPEC-espace-courant.md §16.8.1 ; docs/SPEC-organisations.md §8.2 ; docs/SCHEMA.md « Migration `0201` » ;
--           docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
--
-- Sur le seed (docs/SPEC-seed.md §54) : sept organisations dans « P2Enjoy SAS » (…001), deux dans « Studio Lumen » (Maison
-- Arlo, et Vertigo Conseil, homonyme de celle du seed). Camille (…011) lit les deux espaces ; Farida (…013), lectrice, ne lit
-- que le premier. L'identifiant de « Studio Lumen » est lu par son slug. Rien n'est écrit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to authenticated;
insert into pg_temp.ids values ('p2enjoy', '5eed0000-0000-4000-8000-000000000001');
insert into pg_temp.ids select 'lumen', id from public.workspaces where slug = 'studio-lumen';
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;

-- Les noms rendus, dans l'ordre de la liste, chacun suivi du slug de son espace.
create or replace function pg_temp.lignes(p_workspace_id uuid default null, p_workspace_ids uuid[] default null,
	p_search text default null, p_limite integer default 100)
returns text language sql stable as $$
	select coalesce(string_agg(l.name || '@' || case l.workspace_id when pg_temp.id('lumen') then 'lumen'
	                                                                when pg_temp.id('p2enjoy') then 'p2enjoy' else '?' end,
	                           '|' order by l.rang), '')
	  from (select o.*, row_number() over () as rang
	          from public.organization_list(p_workspace_id => p_workspace_id, p_workspace_ids => p_workspace_ids,
	                                        p_search => p_search, p_limit => p_limite) o) l
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- La forme
-- ------------------------------------------------------------------------------------------------------------------
select ok(pg_temp.id('lumen') is not null, '1 — le seed a son second espace, « Studio Lumen »');
select is((select prosecdef from pg_proc
            where oid = 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])'::regprocedure),
	false, '2 — la liste, qui gagne p_workspace_ids en dernier, reste SECURITY INVOKER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'organization_list'),
	1, '3 — l''ancienne signature est retirée : aucune surcharge ne rend l''appel ambigu');
select ok(pg_get_function_result('public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])'::regprocedure)
            like '%has_revenues boolean, workspace_id uuid, total_count bigint)',
	'4 — chaque ligne porte workspace_id, avant total_count');
select ok(has_function_privilege('authenticated', 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])', 'execute')
          and not has_function_privilege('anon', 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[], uuid[])', 'execute'),
	'5 — recréée, elle retrouve ses droits : authenticated, jamais anon');

-- ------------------------------------------------------------------------------------------------------------------
-- La portée, pour Camille qui lit les deux espaces
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.lignes(),
	'Atelier Lumen@p2enjoy|Comptoir Vasseur@p2enjoy|Imprimerie Duval@p2enjoy|Maison Arlo@lumen|Sogexia@p2enjoy|'
	'Studio Meunier@p2enjoy|Vertigo Conseil@' || (select case when id < (select id from public.organizations o2
	    where o2.name = 'Vertigo Conseil' and o2.workspace_id = pg_temp.id('lumen')) then 'p2enjoy|Vertigo Conseil@lumen'
	    else 'lumen|Vertigo Conseil@p2enjoy' end
	  from public.organizations where name = 'Vertigo Conseil' and workspace_id = pg_temp.id('p2enjoy'))
	|| '|Ville d''Annecy@p2enjoy',
	'6 — sans espace donné : tous ceux qu''elle lit, chaque ligne avec le sien, les homonymes départagés par l''identifiant');
select is((select count(*)::int from public.organization_list() l
            join public.organizations o on o.id = l.id and o.workspace_id is distinct from l.workspace_id),
	0, '7 — workspace_id est celui de l''organisation, sur chaque ligne');
select is(pg_temp.lignes(p_workspace_ids => array[pg_temp.id('lumen')]),
	'Maison Arlo@lumen|Vertigo Conseil@lumen', '8 — p_workspace_ids restreint aux espaces donnés');
select is(pg_temp.lignes(p_workspace_id => pg_temp.id('p2enjoy')),
	'Atelier Lumen@p2enjoy|Comptoir Vasseur@p2enjoy|Imprimerie Duval@p2enjoy|Sogexia@p2enjoy|Studio Meunier@p2enjoy|'
	'Vertigo Conseil@p2enjoy|Ville d''Annecy@p2enjoy',
	'9 — p_workspace_id seul : le résultat d''avant, l''espace donné');
select is(pg_temp.lignes(p_workspace_id => pg_temp.id('p2enjoy'), p_workspace_ids => array[pg_temp.id('lumen')]),
	'Maison Arlo@lumen|Vertigo Conseil@lumen', '10 — p_workspace_ids, non vide, l''emporte sur p_workspace_id');
select is(pg_temp.lignes(p_workspace_id => pg_temp.id('lumen'), p_workspace_ids => '{}'),
	'Maison Arlo@lumen|Vertigo Conseil@lumen', '11 — p_workspace_ids vide ne compte pas : p_workspace_id s''applique');
select is((select count(*)::text || '/' || max(total_count)::text from public.organization_list(p_limit => 2)),
	'2/9', '12 — total_count compte toute la portée, deux espaces confondus, au-delà de la page');
select is(pg_temp.lignes(p_search => 'vertigo') ~ '^Vertigo Conseil@(p2enjoy|lumen)\|Vertigo Conseil@(p2enjoy|lumen)$'
          and pg_temp.lignes(p_search => 'vertigo') like '%@p2enjoy%' and pg_temp.lignes(p_search => 'vertigo') like '%@lumen%',
	true, '13 — la recherche porte sur toute la portée : les deux homonymes, chacun avec son espace');
select is((select count(*)::text || '/' || max(total_count)::text
             from public.organization_list(p_workspace_ids => array[pg_temp.id('p2enjoy'), pg_temp.id('lumen')])),
	'9/9', '14 — deux espaces donnés : les neuf');
-- L'APPEL D'AVANT, positionnel à huit arguments, celui de la webapp livrée avant la migration, garde son sens.
select is((select count(*)::int from public.organization_list(pg_temp.id('p2enjoy'), null, null, 'all', 'name', false, 100, 0)),
	7, '15 — l''appel positionnel d''avant rend les sept organisations de l''espace donné');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Le refus : un espace non lu ne rend rien (Farida, lectrice du seul premier espace)
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.lignes(p_workspace_ids => array[pg_temp.id('lumen')]), '',
	'16 — un espace non lu, donné : aucune ligne, sans erreur');
select is((select count(*)::int from public.organization_list(p_workspace_id => pg_temp.id('lumen'))), 0,
	'17 — un espace non lu, en p_workspace_id : aucune ligne');
select is((select string_agg(distinct coalesce(case l.workspace_id when pg_temp.id('p2enjoy') then 'p2enjoy' end, '?'), ',')
             from public.organization_list(p_workspace_ids => array[pg_temp.id('p2enjoy'), pg_temp.id('lumen')]) l),
	'p2enjoy', '18 — un espace lu et un non lu : les lignes du seul espace lu');
select throws_ok($$select * from public.organization_list(p_revenues => 'parfois')$$, '22023', 'invalid_revenues_filter',
	'19 — le refus d''un filtre de recettes inconnu, inchangé');
select throws_ok($$select * from public.organization_list(p_sort => 'domaine')$$, '22023', 'invalid_sort',
	'20 — le refus d''un tri inconnu, inchangé');
reset role;

select * from finish();
rollback;

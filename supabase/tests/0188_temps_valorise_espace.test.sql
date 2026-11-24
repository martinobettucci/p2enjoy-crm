-- @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : `temps_valorise` rend `workspace_id`, l'espace de la saisie, en
--           dernière colonne ; ses paramètres, sa RLS et ses droits inchangés ; une saisie d'un espace non lu reste absente ;
--           `rentabilite_affaires`, qui l'appelle, tourne toujours
-- @verifies docs/SPEC-espace-courant.md §16.8.2 ; docs/SPEC-temps.md §6.2 ; docs/SCHEMA.md « Migration `0202` » ;
--           docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
--
-- Sur le seed (docs/SPEC-seed.md §54) : Camille (…011) a une saisie dans « Studio Lumen », sur son track « Productions »,
-- et les autres saisies sont dans « P2Enjoy SAS » (…001) ; Farida (…013), lectrice, ne lit que ce premier espace. Les
-- sommes de `rentabilite_affaires` sont prouvées inchangées par ses suites (0087, 0140, 0142), rejouées après la
-- migration. Rien n'est écrit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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
insert into pg_temp.ids select 'productions', t.id from public.tracks t join public.workspaces w on w.id = t.workspace_id
 where w.slug = 'studio-lumen' and t.slug = 'productions';
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;

-- ------------------------------------------------------------------------------------------------------------------
-- La forme
-- ------------------------------------------------------------------------------------------------------------------
select ok(pg_temp.id('productions') is not null, '1 — le seed a le track « Productions » de « Studio Lumen »');
select ok(pg_get_function_result('public.temps_valorise(date, date, uuid, uuid, uuid)'::regprocedure)
            like '%devise text, shared boolean, workspace_id uuid)',
	'2 — workspace_id vient en dernière colonne, après shared');
select is((select prosecdef from pg_proc where oid = 'public.temps_valorise(date, date, uuid, uuid, uuid)'::regprocedure),
	false, '3 — la fonction reste SECURITY INVOKER : elle rend ce que la RLS laisse lire');
select ok(has_function_privilege('authenticated', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute'),
	'4 — recréée, elle retrouve ses droits : authenticated et service_role, jamais anon');

-- ------------------------------------------------------------------------------------------------------------------
-- La valeur, pour Camille qui lit les deux espaces
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select string_agg(distinct (t.workspace_id = pg_temp.id('lumen'))::text, ',')
             from public.temps_valorise('-infinity', 'infinity', null, pg_temp.id('productions'), null) t),
	'true', '5 — une saisie de « Studio Lumen » porte son espace');
select ok((select count(*) from public.temps_valorise('-infinity', 'infinity', null, null, null) t
            where t.workspace_id = pg_temp.id('p2enjoy')) > 0,
	'6 — les saisies de « P2Enjoy SAS » portent le leur');
select is((select count(*)::int from public.temps_valorise('-infinity', 'infinity', null, null, null) t
            join public.tracks tr on tr.id = t.track_id
           where tr.workspace_id is distinct from t.workspace_id),
	0, '7 — sur chaque ligne, l''espace est celui du track de la ligne');
select lives_ok($$select * from public.rentabilite_affaires(null, null, null)$$,
	'8 — rentabilite_affaires, qui lit ses colonnes par leur nom, tourne sans être réécrite');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Le refus : une saisie d'un espace non lu reste absente (Farida)
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*)::int from public.temps_valorise('-infinity', 'infinity', null, null, null) t
            where t.workspace_id = pg_temp.id('lumen') or t.track_id = pg_temp.id('productions')),
	0, '9 — la lectrice d''un seul espace ne voit aucune saisie de l''autre');
select ok((select count(*) from public.temps_valorise('-infinity', 'infinity', null, null, null) t) > 0,
	'10 — et elle voit toujours celles de son espace');
reset role;

select * from finish();
rollback;

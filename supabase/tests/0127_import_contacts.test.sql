-- @verifies CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import des contacts et des organisations en base — la simulation qui
--           ne laisse rien, les issues ligne par ligne, l'organisation retrouvée ou créée, le refus de la lectrice, le journal
-- @verifies docs/SPEC-vues-import-export.md §6.2, §6.2 bis, §6.4, §6.5 ; docs/SPEC-audit.md §3 (la famille `import`) ;
--           CLAUDE.md §10
--
-- Joué sous le rôle `authenticated` de Driss (business developer) et de Farida (lectrice). Le `rollback` final rend la base
-- intacte, le journal compris.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

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
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''

create temp table pg_temp.lignes as select $j$[
 {"full_name": "ZZ Anne Petit", "email": "anne@zz-petit.test", "organization_name": "ZZ Petit SA", "organization_domain": "zz-petit.test"},
 {"full_name": "ZZ Bruno Petit", "email": "ANNE@zz-petit.test"},
 {"full_name": "ZZ Chloé Vidal", "email": "pas-un-email"},
 {"organization_name": "Sogexia"},
 {"full_name": "ZZ Denis Roux", "organization_name": "zz petit sa"},
 {"phone": "01 02 03 04 05"},
 {"full_name": "ZZ Eva Lenoir", "organization_name": "ZZ Nouvelle", "organization_domain": "Pas Un Domaine"}
]$j$::jsonb as rows;
grant select on pg_temp.lignes to authenticated;

-- =============================================================================================
-- 1. Le contrat
-- =============================================================================================

select ok(
	has_function_privilege('authenticated', 'public.import_contacts(uuid, jsonb, boolean)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.import_contacts(uuid, jsonb, boolean)', 'EXECUTE')
	and (select prosecdef = false from pg_proc where oid = 'public.import_contacts(uuid, jsonb, boolean)'::regprocedure),
	'1 — l''import est aux membres connectés, sous leur RLS, jamais à l''anonyme');

-- =============================================================================================
-- 2. La simulation — §6.1, §6.5
-- =============================================================================================

-- Le jeu a déjà importé son fichier de salon (docs/SPEC-seed.md §33) : le journal est compté à partir d'ici.
create temp table pg_temp.repere as select coalesce(max(id), 0) as id from public.audit_log;
grant select on pg_temp.repere to authenticated;

select pg_temp.endosser(:driss);
create temp table pg_temp.simulation as
select * from public.import_contacts('5eed0000-0000-4000-8000-000000000001', (select rows from pg_temp.lignes), true);
select is((select string_agg(outcome || coalesce(':' || code, ''), ', ' order by line) from pg_temp.simulation),
	'created, skipped:duplicate_email, refused:invalid_email, skipped:duplicate_organization, created, refused:name_required, refused:invalid_domain',
	'2 — chaque ligne a son issue : créée, doublon d''email (casse ignorée), email invalide, organisation existante, nom manquant, domaine invalide');
select ok((select organization_created from pg_temp.simulation where line = 1)
          and (select organization_id from pg_temp.simulation where line = 5) = (select organization_id from pg_temp.simulation where line = 1),
	'3 — l''organisation créée par une ligne est retrouvée par son nom, sans casse, par la suivante');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.contacts where full_name like 'ZZ %')
          + (select count(*)::int from public.organizations where name like 'ZZ %'), 0,
	'4 — la simulation ne laisse rien en base');
select is((select count(*)::int from public.audit_log where family = 'import' and id > (select id from pg_temp.repere)), 0,
	'5 — et n''est pas journalisée');

-- =============================================================================================
-- 3. L'import confirmé
-- =============================================================================================

select pg_temp.endosser(:driss);
create temp table pg_temp.confirme as
select * from public.import_contacts('5eed0000-0000-4000-8000-000000000001', (select rows from pg_temp.lignes), false);
select pg_temp.redevenir_proprietaire();
select is((select string_agg(full_name, ', ' order by full_name) from public.contacts where full_name like 'ZZ %'),
	'ZZ Anne Petit, ZZ Denis Roux', '6 — seules les lignes valides sont écrites');
select is((select string_agg(distinct source, ',') from public.contacts where full_name like 'ZZ %'), 'import',
	'7 — leur source est `import`');
select is((select string_agg(name, ', ' order by name) from public.organizations where name like 'ZZ %'), 'ZZ Petit SA',
	'8 — l''organisation d''une ligne refusée n''est pas créée (« ZZ Nouvelle »), celle d''une ligne écrite l''est');
select is((select count(*)::int from public.contacts c join public.organizations o on o.id = c.organization_id
            where c.full_name like 'ZZ %' and o.name = 'ZZ Petit SA'), 2, '9 — les deux contacts sont rattachés à l''organisation');
select is((select details from public.audit_log where family = 'import' and actor_id = :driss order by id desc limit 1),
	'{"created": 2, "refused": 3, "skipped": 2, "organizations_created": 1}'::jsonb,
	'10 — l''import confirmé est journalisé avec ses comptes, jamais une ligne');

select pg_temp.endosser(:driss);
select is((select string_agg(outcome || ':' || code, ', ' order by line)
             from public.import_contacts('5eed0000-0000-4000-8000-000000000001',
                  '[{"full_name": "ZZ Anne Petit", "email": "anne@zz-petit.test"}]', false)),
	'skipped:duplicate_email', '11 — réimporter le même fichier ne crée pas de doublon');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. Les refus — §6.2 bis
-- =============================================================================================

select pg_temp.endosser(:farida);
select is((select outcome || ':' || code from public.import_contacts('5eed0000-0000-4000-8000-000000000001',
             '[{"full_name": "ZZ Farida Essai"}]', false)),
	'refused:forbidden', '12 — la lectrice : chaque ligne est refusée par la RLS');
select throws_ok($$ select * from public.import_contacts('5eed0000-0000-4000-8000-0000000e7299', '[]', true) $$,
	'P0002', 'workspace_not_found', '13 — un espace dont on n''est pas membre n''existe pas');
select throws_ok($$ select * from public.import_contacts('5eed0000-0000-4000-8000-000000000001',
	(select jsonb_agg(jsonb_build_object('full_name', 'ZZ ' || g)) from generate_series(1, 1001) g), true) $$,
	'22023', 'import_too_large', '14 — au-delà de 1 000 lignes, l''appel est refusé');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

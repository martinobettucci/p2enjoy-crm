-- @verifies CRM-114 (docs/BACKLOG.md) — tranche T1 : la famille `organizations` dans les quatre listes fermées du
--           connecteur, et les politiques existantes de `organizations` par profil
-- @verifies docs/SPEC-organisations.md §3 (droits de la base : business developer et administrateur écrivent, tout membre
--           lit), §5 (la famille, après `contacts`), §6 (preuves) ; docs/SPEC-mcp.md §6.1, §6.3 ; décisions 658, 663 ;
--           CLAUDE.md §10 (chaque refus prouvé avec l'identité réelle d'un profil du seed)
--
-- LE SEED : Camille (…011) administratrice ; Driss (…012) business developer ; Farida (…013) lectrice ; Sabine (…018)
-- superadministratrice. `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La famille du connecteur
-- ---------------------------------------------------------------------------------------------

select lives_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'organizations', 'ajouter')$$,
	'1 — la contrainte de la matrice accepte `organizations`');
select throws_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'organisations', 'ajouter')$$,
	'23514', null, '2 — l''orthographe française reste hors liste (décision 658)');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'organizations', 'ajouter'), true,
	'3 — `mcp_autorise` ouvre la case posée');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'organizations', 'modifier'), false,
	'4 — et ferme celle qui ne l''est pas');
select throws_ok(
	$$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'organisations', 'consulter')$$,
	'22023', 'famille_inconnue', '5 — une famille hors liste lève toujours 22023');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select lives_ok(
	$$select public.mcp_poser_droits('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001',
	  '[["budgets", "consulter"], ["organizations", "consulter"], ["contacts", "consulter"]]')$$,
	'6 — la superadministratrice pose une matrice qui ouvre `organizations`');
select is(
	(select e.value -> 'droits' from pg_catalog.jsonb_array_elements(public.mcp_compte('5eed0000-0000-4000-8000-000000000012') -> 'espaces') e
	  where e.value ->> 'slug' = 'p2enjoy'),
	'[["contacts", "consulter"], ["organizations", "consulter"], ["budgets", "consulter"]]'::jsonb,
	'7 — la matrice se lit avec `organizations` entre `contacts` et `budgets`');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 2. Les politiques existantes de `organizations` — celles que l'écran et les outils emploieront
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*) from public.organizations) > 0, true, '8 — la lectrice lit les organisations de l''espace');
select throws_ok(
	$$insert into public.organizations (workspace_id, name) values ('5eed0000-0000-4000-8000-000000000001', 'Refusée')$$,
	'42501', null, '9 — la lectrice ne crée pas d''organisation');
update public.organizations set name = 'Réécrite' where name = 'Sogexia';
select pg_temp.redevenir_proprietaire();
select is((select count(*) from public.organizations where name = 'Réécrite'), 0::bigint,
	'10 — la lectrice ne modifie rien (zéro ligne)');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(
	$$insert into public.organizations (workspace_id, name, domain, website)
	  values ('5eed0000-0000-4000-8000-000000000001', 'Organisation pgTAP', 'pgtap-orga.test', 'https://pgtap-orga.test')$$,
	'11 — le business developer crée une organisation');
select throws_ok(
	$$insert into public.organizations (workspace_id, name, domain)
	  values ('5eed0000-0000-4000-8000-000000000001', 'Doublon', 'pgtap-orga.test')$$,
	'23505', null, '12 — un domaine déjà pris dans l''espace est refusé (une majuscule l''est avant, par la forme)');
select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

-- @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.a : la famille `workflows` dans les quatre listes fermées du
--           connecteur, après `structure`, et les politiques des workflows que ses outils emploient, par profil
-- @verifies docs/SPEC-mcp.md §9.2 undecies (la famille, son rang, ses outils T2.a), §6.1, §6.3 ;
--           docs/SPEC-workflow-engine.md §3.4 (une arête hors de son workflow), §3.7 (écriture réservée à
--           l'administrateur ; une étape occupée ne se retire pas) ; décisions 658, 752, 754 et 756 ;
--           CLAUDE.md §10 (chaque refus prouvé avec l'identité réelle d'un profil du seed)
--
-- LE SEED : Camille (…011) administratrice ; Driss (…012) business developer ; Farida (…013) lectrice ; Sabine (…018)
-- superadministratrice ; « Cycle commercial standard » (…051), son étape Prospection (…061) occupée par des affaires ;
-- les nœuds `prospection` (…041) et `relance` (…042). `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'workflows', 'ajouter')$$,
	'1 — la contrainte de la matrice accepte `workflows`');
select throws_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'workflow', 'ajouter')$$,
	'23514', null, '2 — le singulier reste hors liste');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'workflows', 'ajouter'), true,
	'3 — `mcp_autorise` ouvre la case posée');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'workflows', 'supprimer'), false,
	'4 — et ferme celle qui ne l''est pas');
select throws_ok(
	$$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'workflow', 'consulter')$$,
	'22023', 'famille_inconnue', '5 — une famille hors liste lève toujours 22023');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select lives_ok(
	$$select public.mcp_poser_droits('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001',
	  '[["affaires", "consulter"], ["workflows", "modifier"], ["structure", "consulter"], ["workflows", "consulter"]]')$$,
	'6 — la superadministratrice pose une matrice qui ouvre `workflows`');
select is(
	(select e.value -> 'droits' from pg_catalog.jsonb_array_elements(public.mcp_compte('5eed0000-0000-4000-8000-000000000012') -> 'espaces') e
	  where e.value ->> 'slug' = 'p2enjoy'),
	'[["structure", "consulter"], ["workflows", "consulter"], ["workflows", "modifier"], ["affaires", "consulter"]]'::jsonb,
	'7 — la matrice se lit avec `workflows` entre `structure` et `affaires`');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 2. Les politiques des workflows — celles que les outils de T2.a emploient
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	$$insert into public.workflows (workspace_id, name) values ('5eed0000-0000-4000-8000-000000000001', 'Refusé')$$,
	'42501', null, '8 — le business developer ne crée pas de workflow');
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id)
	  values ('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000048')$$,
	'42501', null, '9 — ni n''ajoute d''étape');
delete from public.workflow_transitions where workflow_id = '5eed0000-0000-4000-8000-000000000051';
select pg_temp.redevenir_proprietaire();
select is((select count(*) > 0 from public.workflow_transitions where workflow_id = '5eed0000-0000-4000-8000-000000000051'), true,
	'10 — ni ne retire d''arête : zéro ligne, les transitions relues présentes');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$insert into public.workflows (id, workspace_id, name)
	  values ('11800000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'Brouillon pgTAP')$$,
	'11 — l''administratrice crée un workflow, sans étape : un brouillon');
select lives_ok(
	$$insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, is_initial)
	  values ('11800000-0000-4000-8000-000000000011', '11800000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000041', true),
	         ('11800000-0000-4000-8000-000000000012', '11800000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000042', false)$$,
	'12 — et lui ajoute deux étapes');
select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	  values ('11800000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '11800000-0000-4000-8000-000000000011', '5eed0000-0000-4000-8000-000000000062')$$,
	'23503', null, '13 — une arête vers l''étape d''un autre workflow est refusée');
select lives_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id, label)
	  values ('11800000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '11800000-0000-4000-8000-000000000011', '11800000-0000-4000-8000-000000000012', 'Relancer')$$,
	'14 — une arête entre ses deux étapes est déclarée');
delete from public.workflow_steps where id = '11800000-0000-4000-8000-000000000012';
select is((select count(*) from public.workflow_transitions where workflow_id = '11800000-0000-4000-8000-000000000001'), 0::bigint,
	'15 — retirer une étape emporte ses arêtes');
select throws_ok(
	$$delete from public.workflow_steps where id = '5eed0000-0000-4000-8000-000000000061'$$,
	'23503', null, '16 — une étape occupée par des affaires ne se retire pas');
select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

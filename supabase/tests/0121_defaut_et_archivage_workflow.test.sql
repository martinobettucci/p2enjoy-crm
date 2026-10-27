-- @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : `set_default_workflow` et la garde d'archivage d'un workflow
-- @verifies docs/SPEC-workflow-engine.md §7 quinquies.1 (l'ordre des vérifications, l'atomicité, le défaut global
--           seulement, le défaut déjà en place sans écriture ; la garde : channel hors corbeille, archivé compris, défaut,
--           rétablissement libre) ; docs/SCHEMA.md ; décisions 758 et 760 ; CLAUDE.md §10 (refus prouvés par profil)
--
-- LE SEED : Camille (…011) administratrice ; Driss (…012) business developer ; Farida (…013) lectrice ; le workflow par
-- défaut (…051), employé par des channels ; le track Conseil & IA (…021). `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

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

-- Trois workflows de la preuve, posés par le propriétaire : deux globaux libres, un propre au track.
insert into public.workflows (id, workspace_id, name) values
	('11810000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'pgTAP global A'),
	('11810000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'pgTAP global B');
insert into public.workflows (id, workspace_id, name, scope, track_id) values
	('11810000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', 'pgTAP du track', 'track',
	 '5eed0000-0000-4000-8000-000000000021');

-- ---------------------------------------------------------------------------------------------
-- 1. set_default_workflow
-- ---------------------------------------------------------------------------------------------

select is(has_function_privilege('anon', 'public.set_default_workflow(uuid)', 'execute'), false,
	'1 — l''anonyme n''exécute pas set_default_workflow');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$select public.set_default_workflow('11810000-0000-4000-8000-000000000001')$$,
	'42501', 'reserve aux administrateurs', '2 — la lectrice est refusée');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$select public.set_default_workflow('11810000-0000-4000-8000-000000000001')$$,
	'42501', 'reserve aux administrateurs', '3 — le business developer est refusé');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$select public.set_default_workflow('00000000-0000-4000-8000-000000000000')$$,
	'P0002', 'workflow introuvable', '4 — un workflow inconnu est introuvable');
select throws_ok($$select public.set_default_workflow('11810000-0000-4000-8000-000000000003')$$,
	'P0001', 'workflow non global', '5 — un workflow propre à un track ne devient pas le défaut');
select is((public.set_default_workflow('11810000-0000-4000-8000-000000000001')).is_default, true,
	'6 — l''administratrice désigne un workflow global par défaut');
select is((select count(*) from public.workflows where workspace_id = '5eed0000-0000-4000-8000-000000000001' and is_default),
	1::bigint, '7 — un seul défaut dans l''espace, l''ancien éteint');
select is((select is_default from public.workflows where id = '5eed0000-0000-4000-8000-000000000051'), false,
	'8 — l''ancien défaut du seed est éteint');
select is((public.set_default_workflow('11810000-0000-4000-8000-000000000001')).id,
	'11810000-0000-4000-8000-000000000001'::uuid, '9 — le défaut déjà en place se redésigne sans erreur');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 2. La garde d'archivage
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$update public.workflows set archived_at = now() where id = '5eed0000-0000-4000-8000-000000000051'$$,
	'P0001', null, '10 — un workflow employé par des channels ne s''archive pas');
select throws_like($$update public.workflows set archived_at = now() where id = '5eed0000-0000-4000-8000-000000000051'$$,
	'workflow_in_use : %', '11 — le refus nomme workflow_in_use et le nombre de channels');
select throws_ok($$update public.workflows set archived_at = now() where id = '11810000-0000-4000-8000-000000000001'$$,
	'P0001', 'workflow_is_default', '12 — le workflow par défaut ne s''archive pas');
select lives_ok($$select public.set_default_workflow('11810000-0000-4000-8000-000000000002')$$,
	'13 — désigner un autre défaut libère l''ancien');
select lives_ok($$update public.workflows set archived_at = now() where id = '11810000-0000-4000-8000-000000000001'$$,
	'14 — un workflow libre et non défaut s''archive');
select throws_ok($$select public.set_default_workflow('11810000-0000-4000-8000-000000000001')$$,
	'P0001', 'workflow archive', '15 — un workflow archivé ne devient pas le défaut');
select lives_ok($$update public.workflows set archived_at = null where id = '11810000-0000-4000-8000-000000000001'$$,
	'16 — rétablir un workflow archivé n''est jamais refusé');
select pg_temp.redevenir_proprietaire();

-- Un channel archivé l'emploie encore ; un channel en corbeille ne compte pas.
insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, archived_at) values
	('11810000-0000-4000-8000-000000000011', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000021',
	 '11810000-0000-4000-8000-000000000001', 'pgTAP archivé', 'pgtap-archive', now());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_like($$update public.workflows set archived_at = now() where id = '11810000-0000-4000-8000-000000000001'$$,
	'workflow_in_use : 1 channel(s)', '17 — un channel archivé l''emploie encore');
select pg_temp.redevenir_proprietaire();
update public.channels set deleted_at = now() where id = '11810000-0000-4000-8000-000000000011';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$update public.workflows set archived_at = now() where id = '11810000-0000-4000-8000-000000000001'$$,
	'18 — un channel en corbeille ne le garde pas');
select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

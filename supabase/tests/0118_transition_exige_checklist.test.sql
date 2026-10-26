-- @verifies CRM-068 (docs/BACKLOG.md) — tranche T2 : une transition exige des points de checklist cochés
-- @verifies docs/SPEC-checklists.md §3.4 (`move_card` refuse `checklist_incomplete`, le détail nomme les points manquants ;
--           un point libre n'y compte pas ; un point archivé reste exigé tant que la transition l'exige) ;
--           docs/SPEC-workflow-engine.md §5.3 ; docs/JOURNAL.md décisions 747 à 749
--
-- Joué sous le rôle `authenticated` de Camille (administratrice) et de Driss (business developer, écrit « inter-
-- entreprises »). L'affaire naît par `creer_affaire` ; le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

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
create temp table pg_temp.ctx (cle text primary key, valeur uuid);
grant all on pg_temp.ctx to authenticated;

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set wf '\'5eed0000-0000-4000-8000-000000000051\''
\set prospection '\'5eed0000-0000-4000-8000-000000000061\''

-- Deux points sur prospection, tous deux exigés par prospection → relance ; le second sera archivé.
select pg_temp.endosser(:camille);
insert into public.workflow_step_checklist_items (id, workspace_id, workflow_id, step_id, label, position) values
	('c0680000-0000-4000-8000-0000000000b1', :ws, :wf, :prospection, 'Besoin, confirmé', 1),
	('c0680000-0000-4000-8000-0000000000b2', :ws, :wf, :prospection, 'Budget connu', 2);
insert into public.workflow_transition_required_checklist_items (transition_id, step_item_id) values
	('5eed0000-0000-4000-8000-000000000071', 'c0680000-0000-4000-8000-0000000000b1'),
	('5eed0000-0000-4000-8000-000000000071', 'c0680000-0000-4000-8000-0000000000b2');
insert into pg_temp.ctx values ('carte', public.creer_affaire('5eed0000-0000-4000-8000-000000000036', 'Checklist — exigence'));
insert into pg_temp.ctx
select 'rattachement', p.id from public.card_placements p where p.card_id = (select valeur from pg_temp.ctx where cle = 'carte');
-- Le second point est archivé APRÈS que l'affaire l'a reçu : il reste exigé.
update public.workflow_step_checklist_items set archived_at = now() where id = 'c0680000-0000-4000-8000-0000000000b2';
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:driss);
select throws_ok($$ select public.move_card((select valeur from pg_temp.ctx where cle = 'rattachement'),
	'5eed0000-0000-4000-8000-000000000062', null) $$, 'P0001', 'checklist_incomplete',
	'1 — aucun point coché : la transition est refusée');

-- Le détail est un tableau JSON des libellés, dans l'ordre de l'étape — une virgule dans un libellé ne le casse pas.
create or replace function pg_temp.detail_du_refus() returns text language plpgsql as $$
begin
	perform public.move_card((select valeur from pg_temp.ctx where cle = 'rattachement'),
		'5eed0000-0000-4000-8000-000000000062', null);
	return null;
exception when others then
	declare
		d text;
	begin
		get stacked diagnostics d = pg_exception_detail;
		return d;
	end;
end;
$$;
select is(pg_temp.detail_du_refus()::jsonb, '["Besoin, confirmé", "Budget connu"]'::jsonb,
	'2 — le détail nomme les deux points manquants, en JSON');

-- Un point LIBRE coché ne compte pas.
insert into public.card_checklist_items (workspace_id, card_id, label)
select '5eed0000-0000-4000-8000-000000000001', valeur, 'Besoin, confirmé' from pg_temp.ctx where cle = 'carte';
update public.card_checklist_items set checked = true where placement_id is null
   and card_id = (select valeur from pg_temp.ctx where cle = 'carte');
select is(pg_temp.detail_du_refus()::jsonb, '["Besoin, confirmé", "Budget connu"]'::jsonb,
	'3 — un point libre de même libellé ne satisfait pas l''exigence');

update public.card_checklist_items set checked = true
 where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')
   and step_item_id = 'c0680000-0000-4000-8000-0000000000b1';
select is(pg_temp.detail_du_refus()::jsonb, '["Budget connu"]'::jsonb,
	'4 — un point coché sur le rattachement ; reste le point archivé, toujours exigé');

update public.card_checklist_items set checked = true
 where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')
   and step_item_id = 'c0680000-0000-4000-8000-0000000000b2';
select lives_ok($$ select public.move_card((select valeur from pg_temp.ctx where cle = 'rattachement'),
	'5eed0000-0000-4000-8000-000000000062', null) $$, '5 — tous les points exigés cochés : la transition passe');
select pg_temp.redevenir_proprietaire();
select is((select current_step_id from public.card_placements where id = (select valeur from pg_temp.ctx where cle = 'rattachement')),
	'5eed0000-0000-4000-8000-000000000062'::uuid, '6 — le rattachement est en relance');

-- Les autres vérifications passent toujours AVANT : une transition non déclarée reste `transition_not_allowed`.
select pg_temp.endosser(:driss);
select throws_ok($$ select public.move_card((select valeur from pg_temp.ctx where cle = 'rattachement'),
	'5eed0000-0000-4000-8000-000000000066', null) $$, 'P0001', 'transition_not_allowed',
	'7 — l''ordre des vérifications est inchangé');
select pg_temp.redevenir_proprietaire();

-- Une transition sans exigence ne lit rien de la checklist.
select is((select count(*)::int from public.workflow_transition_required_checklist_items
	where transition_id = '5eed0000-0000-4000-8000-000000000072'), 0, '8 — relance → négociation n''exige aucun point');
select ok(pg_get_functiondef('public.move_card(uuid,uuid,text)'::regprocedure) like '%missing_required_fields%checklist_incomplete%',
	'9 — le refus de checklist vient après celui des champs exigés');

select * from finish();
rollback;

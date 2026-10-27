-- @verifies CRM-068 (docs/BACKLOG.md) — tranche T1 : le modèle des checklists
-- @verifies docs/SPEC-checklists.md §3.1 (les points d'une étape, écrits par l'administrateur), §3.2 (les points d'une
--           affaire : libres ou d'étape ; le cochage posé par la base, fermé au client), §3.3 (l'ajout à l'entrée dans
--           l'étape, sans doublon, sans les points archivés), §3.4 (une exigence de transition ne vise que son étape de
--           départ — Q3), §3.6 (le fil trace le cochage — Q2) ; docs/JOURNAL.md décisions 747 à 749
--
-- LES GESTES SONT JOUÉS SOUS LE RÔLE `authenticated` de Camille (administratrice), Driss (business developer, écrit le
-- channel « inter-entreprises ») et Farida (lectrice, le lit sans l'écrire). L'affaire est créée par la vraie fonction
-- `creer_affaire` ; le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

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
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set wf '\'5eed0000-0000-4000-8000-000000000051\''
\set prospection '\'5eed0000-0000-4000-8000-000000000061\''
\set relance '\'5eed0000-0000-4000-8000-000000000062\''
\set vers_relance '\'5eed0000-0000-4000-8000-000000000071\''
\set channel '\'5eed0000-0000-4000-8000-000000000036\''

-- =============================================================================================
-- 1. Les objets et les privilèges
-- =============================================================================================

select has_table('public', 'workflow_step_checklist_items', '1 — la table des points d''étape existe');
select has_table('public', 'card_checklist_items', '2 — la table des points d''une affaire existe');
select has_table('public', 'workflow_transition_required_checklist_items', '3 — la table des exigences existe');
select ok((select bool_and(relrowsecurity) from pg_class
	where oid in ('public.workflow_step_checklist_items'::regclass, 'public.card_checklist_items'::regclass,
	              'public.workflow_transition_required_checklist_items'::regclass)),
	'4 — la RLS est activée sur les trois tables');
select ok(has_column_privilege('authenticated', 'public.card_checklist_items', 'checked', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.card_checklist_items', 'checked_at', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.card_checklist_items', 'checked_by', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.card_checklist_items', 'placement_id', 'INSERT'),
	'5 — le client coche ; l''heure, l''auteur et le rattachement d''un point lui sont fermés');

-- ISOLATION — `CRM-068` T3a (décision 51) : le seed pose depuis `docs/SPEC-seed.md` §28 des points de MÊMES libellés sur
-- le workflow par défaut, que les affaires du jeu portent. Cette suite désigne ses points par leur libellé : elle retire
-- donc, dans sa transaction annulée au `rollback`, les points du seed — leur origine d'abord, ce qui détache les points
-- copiés sur les affaires, puis ces points détachés, qu'un point d'étape interdirait de retirer.
delete from public.workflow_step_checklist_items where id::text not like 'c0680000%';
delete from public.card_checklist_items;

-- =============================================================================================
-- 2. Les points d'une étape — écrits par l'administrateur
-- =============================================================================================

select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.workflow_step_checklist_items (workspace_id, workflow_id, step_id, label)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051',
	        '5eed0000-0000-4000-8000-000000000061', 'Interdit') $$, '42501', null,
	'6 — un business developer n''écrit pas les points d''une étape');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:camille);
insert into public.workflow_step_checklist_items (id, workspace_id, workflow_id, step_id, label, position) values
	('c0680000-0000-4000-8000-0000000000a1', :ws, :wf, :prospection, 'Besoin confirmé', 1),
	('c0680000-0000-4000-8000-0000000000a2', :ws, :wf, :prospection, 'Décideur identifié', 2),
	('c0680000-0000-4000-8000-0000000000a3', :ws, :wf, :relance, 'Relance envoyée', 1),
	('c0680000-0000-4000-8000-0000000000a4', :ws, :wf, :relance, 'Point archivé', 2);
update public.workflow_step_checklist_items set archived_at = now() where id = 'c0680000-0000-4000-8000-0000000000a4';
select is((select count(*)::int from public.workflow_step_checklist_items where id::text like 'c0680000%'), 4,
	'7 — l''administratrice pose quatre points sur deux étapes');

-- =============================================================================================
-- 3. L'exigence d'une transition — de son étape de départ seulement (Q3)
-- =============================================================================================

select lives_ok($$ insert into public.workflow_transition_required_checklist_items (transition_id, step_item_id)
	values ('5eed0000-0000-4000-8000-000000000071', 'c0680000-0000-4000-8000-0000000000a1') $$,
	'8 — prospection → relance exige « Besoin confirmé », un point de son étape de départ');
select throws_ok($$ insert into public.workflow_transition_required_checklist_items (transition_id, step_item_id)
	values ('5eed0000-0000-4000-8000-000000000071', 'c0680000-0000-4000-8000-0000000000a3') $$, '22023',
	'checklist_item_not_from_source_step', '9 — un point d''une autre étape ne s''exige pas');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:driss);
-- La politique filtre en silence (décision 70) : l'instruction aboutit sans retirer de ligne, ce que le test 11 constate.
select lives_ok($$ delete from public.workflow_transition_required_checklist_items
	where transition_id = '5eed0000-0000-4000-8000-000000000071' $$,
	'10 — un business developer tente de retirer l''exigence');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.workflow_transition_required_checklist_items
	where transition_id = '5eed0000-0000-4000-8000-000000000071'), 1, '11 — l''exigence est toujours là');

-- =============================================================================================
-- 4. L'ajout à l'entrée dans l'étape — §3.3
-- =============================================================================================

select pg_temp.endosser(:camille);
insert into pg_temp.ctx values ('carte', public.creer_affaire('5eed0000-0000-4000-8000-000000000036', 'Checklist — affaire'));
insert into pg_temp.ctx
select 'rattachement', p.id from public.card_placements p where p.card_id = (select valeur from pg_temp.ctx where cle = 'carte');
select pg_temp.redevenir_proprietaire();

select results_eq(
	$$ select label, checked from public.card_checklist_items
	    where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement') order by position $$,
	$$ values ('Besoin confirmé'::text, false), ('Décideur identifié', false) $$,
	'12 — l''affaire née en prospection reçoit les deux points de l''étape, non cochés');

-- =============================================================================================
-- 5. Cocher : la base pose l'heure et l'auteur, le fil le trace — §3.2, Q2
-- =============================================================================================

select pg_temp.endosser(:driss);
update public.card_checklist_items set checked = true
 where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement') and label = 'Besoin confirmé';
select pg_temp.redevenir_proprietaire();
select ok((select checked_at is not null and checked_by = '5eed0000-0000-4000-8000-000000000012'::uuid
	from public.card_checklist_items where label = 'Besoin confirmé'
	  and placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')),
	'13 — Driss coche : l''heure et l''auteur sont posés par la base');
select results_eq(
	$$ select type, actor_id, payload ->> 'label' from public.card_events
	    where card_id = (select valeur from pg_temp.ctx where cle = 'carte') and type like 'checklist%' $$,
	$$ values ('checklist_checked'::text, '5eed0000-0000-4000-8000-000000000012'::uuid, 'Besoin confirmé'::text) $$,
	'14 — le fil de l''affaire porte « point coché », avec Driss et le libellé');
select is((select placement_id from public.card_events
	where card_id = (select valeur from pg_temp.ctx where cle = 'carte') and type = 'checklist_checked'), null,
	'15 — l''événement est celui de l''affaire, le rattachement dans sa charge');

select pg_temp.endosser(:driss);
select throws_ok($$ update public.card_checklist_items set checked_at = now() where label = 'Décideur identifié' $$,
	'42501', null, '16 — l''heure d''un cochage est fermée au client');
select throws_ok($$ update public.card_checklist_items set label = 'Renommé' where label = 'Décideur identifié'
	and step_item_id is not null $$, 'P0001', 'step_item_locked', '17 — un point d''étape ne se renomme pas sur l''affaire');
-- La politique de suppression ne voit que les points libres : la tentative ne retire rien (décision 70).
delete from public.card_checklist_items where label = 'Décideur identifié' and step_item_id is not null;
select is((select count(*)::int from public.card_checklist_items where label = 'Décideur identifié'
	and step_item_id is not null), 1, '18 — un point d''étape ne se retire pas de l''affaire');

-- =============================================================================================
-- 6. Les points libres — §3.2
-- =============================================================================================

insert into public.card_checklist_items (workspace_id, card_id, label, position)
select '5eed0000-0000-4000-8000-000000000001', valeur, 'Point libre de Driss', 10 from pg_temp.ctx where cle = 'carte';
select pg_temp.redevenir_proprietaire();
select ok((select created_by = '5eed0000-0000-4000-8000-000000000012'::uuid and placement_id is null
	from public.card_checklist_items where label = 'Point libre de Driss'),
	'19 — Driss ajoute un point libre, à l''affaire, sous son nom');
select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.card_checklist_items (workspace_id, card_id, placement_id, label)
	values ('5eed0000-0000-4000-8000-000000000001', (select valeur from pg_temp.ctx where cle = 'carte'),
	        (select valeur from pg_temp.ctx where cle = 'rattachement'), 'Faux point d''étape') $$, '42501', null,
	'20 — le client ne pose pas un point sur un rattachement');
update public.card_checklist_items set checked = true where label = 'Point libre de Driss';
update public.card_checklist_items set checked = false where label = 'Point libre de Driss';
select pg_temp.redevenir_proprietaire();
select ok((select checked_at is null and checked_by is null from public.card_checklist_items
	where label = 'Point libre de Driss'), '21 — décoché, l''heure et l''auteur s''effacent');
select is((select count(*)::int from public.card_events
	where card_id = (select valeur from pg_temp.ctx where cle = 'carte') and type = 'checklist_unchecked'), 1,
	'22 — le fil porte « point décoché »');

-- =============================================================================================
-- 7. La lectrice lit, et n'écrit pas
-- =============================================================================================

select pg_temp.endosser(:farida);
select is((select count(*)::int from public.card_checklist_items
	where card_id = (select valeur from pg_temp.ctx where cle = 'carte')), 3,
	'23 — témoin : la lectrice lit les trois points de l''affaire');
update public.card_checklist_items set checked = true where label = 'Décideur identifié';
select throws_ok($$ insert into public.card_checklist_items (workspace_id, card_id, label)
	values ('5eed0000-0000-4000-8000-000000000001', (select valeur from pg_temp.ctx where cle = 'carte'), 'Interdit') $$,
	'42501', null, '24 — elle n''ajoute pas de point');
select pg_temp.redevenir_proprietaire();
select is((select checked from public.card_checklist_items where label = 'Décideur identifié'
	and placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')), false,
	'25 — son cochage n''a rien changé');

-- =============================================================================================
-- 8. Entrer dans une autre étape : ses points actifs s'ajoutent, sans doublon
-- =============================================================================================

select pg_temp.endosser(:camille);
select lives_ok($$ select public.move_card((select valeur from pg_temp.ctx where cle = 'rattachement'),
	'5eed0000-0000-4000-8000-000000000062', null) $$, '26 — l''affaire passe en relance');
select pg_temp.redevenir_proprietaire();
select results_eq(
	$$ select label from public.card_checklist_items
	    where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement') order by label $$,
	$$ values ('Besoin confirmé'::text), ('Décideur identifié'), ('Relance envoyée') $$,
	'27 — « Relance envoyée » s''ajoute ; le point archivé, non ; ceux de prospection restent');
select throws_ok($$ insert into public.card_checklist_items (workspace_id, card_id, placement_id, step_item_id, label)
	values ('5eed0000-0000-4000-8000-000000000001', (select valeur from pg_temp.ctx where cle = 'carte'),
	        (select valeur from pg_temp.ctx where cle = 'rattachement'), 'c0680000-0000-4000-8000-0000000000a3', 'Doublon') $$,
	'23505', null, '28 — un point d''étape n''existe qu''une fois sur un rattachement');

select * from finish();
rollback;

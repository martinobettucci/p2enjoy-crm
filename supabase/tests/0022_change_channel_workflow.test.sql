-- @verifies CRM-019 (docs/BACKLOG.md) — changement atomique du workflow d'un channel
-- @verifies docs/SPEC-change-channel-workflow.md §1 à §8
-- @verifies docs/SCHEMA.md §5 (workflow_changed), §9 (RPC)
-- @verifies docs/JOURNAL.md décisions 263, 295 et 306
-- @verifies docs/INCONSISTENCY_REPORT.md INC-046 et INC-073

begin;

create extension if not exists pgtap with schema extensions;

select plan(59);

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

create or replace function pg_temp.workflow_derive()
returns uuid language sql stable as $$
	select workflow_id
	  from public.channels
	 where id = '5eed0000-0000-4000-8000-000000000031';
$$;

create or replace function pg_temp.etape_derivee_premiere()
returns uuid language sql stable as $$
	select id
	  from public.workflow_steps
	 where workflow_id = pg_temp.workflow_derive()
	 order by position, id
	 limit 1;
$$;

create or replace function pg_temp.mapping_valide()
returns jsonb language sql stable as $$
	select jsonb_build_array(
		jsonb_build_object(
			'from_step_id', '5eed0000-0000-4000-8000-000000000061'::uuid,
			'to_step_id', pg_temp.etape_derivee_premiere()),
		jsonb_build_object(
			'from_step_id', '5eed0000-0000-4000-8000-000000000062'::uuid,
			'to_step_id', pg_temp.etape_derivee_premiere())
	);
$$;

create or replace function pg_temp.erreur(
	canal uuid, workflow uuid, mapping jsonb, detruire boolean default false
) returns text language plpgsql as $$
begin
	perform public.change_channel_workflow(canal, workflow, mapping, detruire);
	return '(aucun refus)';
exception when others then
	return sqlstate || ':' || sqlerrm;
end;
$$;

create or replace function pg_temp.detail_erreur(
	canal uuid, workflow uuid, mapping jsonb, detruire boolean default false
) returns text language plpgsql as $$
declare
	detail text;
begin
	perform public.change_channel_workflow(canal, workflow, mapping, detruire);
	return '(aucun refus)';
exception when others then
	get stacked diagnostics detail = pg_exception_detail;
	return coalesce(detail, '(sans détail)');
end;
$$;

create or replace function pg_temp.appliquer(
	canal uuid, workflow uuid, mapping jsonb, detruire boolean default false
) returns bigint language plpgsql as $$
declare
	total bigint;
begin
	select count(*) into total
	  from public.change_channel_workflow(canal, workflow, mapping, detruire);
	return total;
end;
$$;

-- =============================================================================================
-- 1. Forme, contrainte, vocabulaire, trigger et ACL
-- =============================================================================================

select has_function('public', 'change_channel_workflow',
	array['uuid', 'uuid', 'jsonb', 'boolean'],
	'la RPC à quatre arguments est livrée');

select is(
	(select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	'SETOF cards', 'la RPC rend SETOF public.cards, donc un tableau PostgREST');

select is(
	(select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	'channel_id uuid, workflow_id uuid, step_mapping jsonb, '
	'discard_field_values boolean DEFAULT false',
	'les noms PostgREST sont exacts et la destruction reste false par défaut');

select is(
	(select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	true, 'le catalogue confirme le retour pluriel');

select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	true, 'SECURITY DEFINER permet d''écrire les colonnes protégées');

select is(
	(select p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	'{"search_path=\"\""}', 'le search_path est vide');

select is(
	(select r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 join pg_roles r on r.oid = p.proowner
	 where n.nspname = 'public' and p.proname = 'change_channel_workflow'),
	'postgres', 'le propriétaire est postgres');

select ok(not has_function_privilege('anon',
	'public.change_channel_workflow(uuid,uuid,jsonb,boolean)', 'execute'),
	'anon est nommément privé d''EXECUTE');
select ok(has_function_privilege('authenticated',
	'public.change_channel_workflow(uuid,uuid,jsonb,boolean)', 'execute'),
	'authenticated peut appeler la garde');
select ok(has_function_privilege('service_role',
	'public.change_channel_workflow(uuid,uuid,jsonb,boolean)', 'execute'),
	'service_role conserve le privilège attendu');

select is((select count(*) from pg_constraint
	where conrelid = 'public.cards'::regclass and conname = 'cards_channel_id_workflow_id_fkey'),
	1::bigint, 'la clé composite cards → channel/workflow existe');
select is((select condeferrable from pg_constraint
	where conrelid = 'public.cards'::regclass and conname = 'cards_channel_id_workflow_id_fkey'),
	true, 'la clé composite est différable pour le lot');
select is((select condeferred from pg_constraint
	where conrelid = 'public.cards'::regclass and conname = 'cards_channel_id_workflow_id_fkey'),
	false, 'elle est initialement immédiate pour toute écriture ordinaire');
select is((select pg_get_constraintdef(oid) from pg_constraint
	where conrelid = 'public.cards'::regclass and conname = 'cards_channel_id_workflow_id_fkey'),
	'FOREIGN KEY (channel_id, workflow_id) REFERENCES channels(id, workflow_id) DEFERRABLE',
	'la définition référentielle complète n''a pas été relâchée');

select ok((select pg_get_constraintdef(oid) like '%workflow_changed%'
	from pg_constraint where conrelid = 'public.card_events'::regclass
	and conname = 'card_events_type_check'),
	'le CHECK accepte le dixième type workflow_changed');
select has_trigger('public', 'cards', 'card_events_apres_maj',
	'le trigger de timeline reste attaché aux cards');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'app' and p.proname = 'card_events_apres_maj_card'),
	true, 'le trigger de timeline reste SECURITY DEFINER');

-- =============================================================================================
-- 2. Fixtures possédées par la suite : actif + archivé + corbeille, deux sources vers une cible
-- =============================================================================================

insert into public.workflows (id, workspace_id, name, scope, track_id)
values ('01900000-0000-4000-8000-000000000001',
	'5eed0000-0000-4000-8000-000000000001', 'tst-crm019-incompatible', 'track',
	'5eed0000-0000-4000-8000-000000000022');

insert into public.channels (
	id, workspace_id, track_id, name, slug, workflow_id, position
) values (
	'01900000-0000-4000-8000-000000000010',
	'5eed0000-0000-4000-8000-000000000001',
	'5eed0000-0000-4000-8000-000000000021',
	'tst CRM-019', 'tst-crm-019', '5eed0000-0000-4000-8000-000000000051', 99
);

insert into public.cards (
	id, workspace_id, channel_id, workflow_id, current_step_id, title, position,
	entered_step_at, archived_at, deleted_at
) values
	('01900000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
	 '01900000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000061', 'tst CRM-019 active', 4,
	 '2020-01-01T00:00:00Z', null, null),
	('01900000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-000000000001',
	 '01900000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000062', 'tst CRM-019 archivée', 2,
	 '2020-01-01T00:00:00Z', now(), null),
	('01900000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-000000000001',
	 '01900000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000062', 'tst CRM-019 corbeille', 1,
	 '2020-01-01T00:00:00Z', null, now());

insert into public.card_field_values (
	card_id, field_id, workflow_id, workspace_id, value
) values (
	'01900000-0000-4000-8000-0000000000a1',
	'5eed0000-0000-4000-8000-000000000081',
	'5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', '4200'::jsonb
);

insert into public.card_comments (id, card_id, workspace_id, author_id, body)
values ('01900000-0000-4000-8000-0000000000c1',
	'01900000-0000-4000-8000-0000000000a1',
	'5eed0000-0000-4000-8000-000000000001',
	'5eed0000-0000-4000-8000-000000000011', 'Commentaire à conserver');

-- =============================================================================================
-- 3. Refus : forme, exhaustivité, visibilité, administration, cible et perte
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(), null),
	'P0001:invalid_step_mapping', 'NULL n''est pas un mapping');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(), '{}'),
	'P0001:invalid_step_mapping', 'un objet n''est pas un tableau');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	jsonb_build_array(jsonb_build_object('from_step_id',
	'5eed0000-0000-4000-8000-000000000061', 'to_step_id', pg_temp.etape_derivee_premiere(),
	'autre', true))), 'P0001:invalid_step_mapping', 'une troisième clé est refusée');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	jsonb_build_array(jsonb_build_object('from_step_id', 'pas-un-uuid', 'to_step_id',
	pg_temp.etape_derivee_premiere()))), 'P0001:invalid_step_mapping',
	'un UUID mal formé reçoit un refus produit, pas une erreur de cast');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	pg_temp.mapping_valide() || jsonb_build_array(jsonb_build_object(
	'from_step_id', '5eed0000-0000-4000-8000-000000000061',
	'to_step_id', pg_temp.etape_derivee_premiere()))),
	'P0001:step_mapping_duplicate', 'une source répétée refuse tout le lot');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(), '[]'),
	'P0001:step_mapping_incomplete', 'une source occupée absente est refusée');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	pg_temp.mapping_valide() || jsonb_build_array(jsonb_build_object(
	'from_step_id', '5eed0000-0000-4000-8000-000000000063',
	'to_step_id', pg_temp.etape_derivee_premiere()))),
	'P0001:step_mapping_incomplete', 'une source inoccupée supplémentaire est refusée');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	jsonb_set(pg_temp.mapping_valide(), '{0,to_step_id}',
	to_jsonb('00000000-0000-4000-8000-00000000dead'::text))),
	'P0001:step_not_in_workflow', 'une cible étrangère au nouveau workflow est refusée');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(), '[]'),
	'P0001:channel_not_found', 'un channel caché au viewer ne révèle pas son existence');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.erreur('5eed0000-0000-4000-8000-000000000036', pg_temp.workflow_derive(), '[]'),
	'42501:forbidden', 'un membre visible mais non administrateur est refusé');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.erreur('00000000-0000-4000-8000-00000000dead', pg_temp.workflow_derive(), '[]'),
	'P0001:channel_not_found', 'un channel absent rend channel_not_found');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010',
	'00000000-0000-4000-8000-00000000dead', '[]'),
	'P0001:workflow_not_found', 'un workflow absent rend workflow_not_found');

select pg_temp.redevenir_proprietaire();
update public.workflows set archived_at = now() where id = pg_temp.workflow_derive();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(), '[]'),
	'P0001:workflow_not_found', 'un workflow archivé est traité comme absent');
select pg_temp.redevenir_proprietaire();
update public.workflows set archived_at = null where id = pg_temp.workflow_derive();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010',
	'01900000-0000-4000-8000-000000000001', '[]'),
	'23514:workflow_not_compatible', 'un workflow de portée track étrangère est refusé');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010',
	'5eed0000-0000-4000-8000-000000000051', '[]'),
	'P0001:same_workflow', 'le workflow courant ne simule pas un succès');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010', pg_temp.workflow_derive(),
	pg_temp.mapping_valide()), 'P0001:field_values_would_be_lost',
	'une réponse existante refuse le défaut non destructif');
select is(pg_temp.detail_erreur('01900000-0000-4000-8000-000000000010',
	pg_temp.workflow_derive(), pg_temp.mapping_valide()),
	'1 réponse(s) de formulaire seraient perdues.', 'le DETAIL chiffre exactement la perte');

select is((select workflow_id from public.channels
	where id = '01900000-0000-4000-8000-000000000010'),
	'5eed0000-0000-4000-8000-000000000051'::uuid,
	'le channel est inchangé après tous les refus');
select is((select count(*) from public.cards where channel_id =
	'01900000-0000-4000-8000-000000000010' and workflow_id =
	'5eed0000-0000-4000-8000-000000000051'), 3::bigint,
	'les trois cards sont inchangées après les refus');
select is((select count(*) from public.card_field_values where card_id =
	'01900000-0000-4000-8000-0000000000a1'), 1::bigint,
	'la réponse est conservée après les refus');
select is((select count(*) from public.card_events where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')
	and type = 'workflow_changed'), 0::bigint,
	'aucun événement de faux succès n''est écrit');

-- =============================================================================================
-- 4. Succès : lot complet, regroupement, positions, perte consentie, trace et retour
-- =============================================================================================

select is(pg_temp.appliquer('01900000-0000-4000-8000-000000000010',
	pg_temp.workflow_derive(), pg_temp.mapping_valide(), true), 3::bigint,
	'le vrai appel authentifié rend les trois cards');
select is((select workflow_id from public.channels
	where id = '01900000-0000-4000-8000-000000000010'),
	pg_temp.workflow_derive(), 'le channel porte le workflow cible');
select is((select count(*) from public.cards where channel_id =
	'01900000-0000-4000-8000-000000000010' and workflow_id = pg_temp.workflow_derive()),
	3::bigint, 'toutes les cards, pas seulement les actives, suivent le nouveau workflow');
select is((select count(*) from public.cards where channel_id =
	'01900000-0000-4000-8000-000000000010' and current_step_id =
	pg_temp.etape_derivee_premiere()), 3::bigint,
	'les deux sources convergent réellement vers une cible unique');
select is((select string_agg(
	case when archived_at is not null then 'archivee'
	     when deleted_at is not null then 'corbeille'
	     else 'active' end, ',' order by id)
	from public.cards where channel_id = '01900000-0000-4000-8000-000000000010'),
	'active,archivee,corbeille', 'les trois états de cycle de vie sont conservés');
select is((select count(*) from public.card_field_values where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')),
	0::bigint, 'la réponse est détruite après opt-in explicite');
select is((select count(*) from public.card_comments where id =
	'01900000-0000-4000-8000-0000000000c1'), 1::bigint,
	'le commentaire survit au changement de workflow');
select is((select count(*) from public.card_events where card_id =
	'01900000-0000-4000-8000-0000000000a1' and type = 'field_changed'), 1::bigint,
	'la mémoire de la réponse détruite survit');
select is((select count(*) from public.card_events where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')
	and type = 'workflow_changed'), 3::bigint,
	'un workflow_changed exact est écrit par card');
select is((select count(*) from public.card_events where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')
	and type = 'moved'), 0::bigint,
	'aucun moved ne prétend qu''une arête a été franchie');
select is((select count(*) from public.card_events where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')
	and type = 'workflow_changed'
	and payload ->> 'channel_id' = '01900000-0000-4000-8000-000000000010'
	and payload ->> 'from_workflow_id' = '5eed0000-0000-4000-8000-000000000051'
	and payload ->> 'to_workflow_id' = pg_temp.workflow_derive()::text
	and payload ? 'from_step_id' and payload ? 'to_step_id'), 3::bigint,
	'chaque payload porte l''ancien et le nouveau contexte complet');
select is((select string_agg(id::text || ':' || position::text, ',' order by id)
	from public.cards where channel_id = '01900000-0000-4000-8000-000000000010'),
	'01900000-0000-4000-8000-0000000000a1:1,'
	'01900000-0000-4000-8000-0000000000a2:3,'
	'01900000-0000-4000-8000-0000000000a3:2',
	'l''ordre source-step, ancienne position, id devient un rang dense déterministe');
select is((select count(*) from public.cards where channel_id =
	'01900000-0000-4000-8000-000000000010' and entered_step_at >
	'2020-01-01T00:00:00Z'), 3::bigint,
	'entered_step_at est remise à zéro pour chaque entrée dans le nouveau graphe');
select is((select count(*) from public.card_events where card_id in (
	select id from public.cards where channel_id = '01900000-0000-4000-8000-000000000010')
	and type = 'workflow_changed' and actor_id =
	'5eed0000-0000-4000-8000-000000000011'), 3::bigint,
	'le trigger SECURITY DEFINER conserve l''actrice authentifiée réelle');

select pg_temp.redevenir_proprietaire();
select throws_ok(
	$$update public.channels set workflow_id = '5eed0000-0000-4000-8000-000000000051'
	  where id = '01900000-0000-4000-8000-000000000010'$$,
	'23503', null,
	'la contrainte redevient immédiate avant le retour : un PATCH ordinaire incohérent est refusé');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.erreur('01900000-0000-4000-8000-000000000010',
	pg_temp.workflow_derive(), pg_temp.mapping_valide(), true),
	'P0001:same_workflow', 'un second appel identique reste un refus, pas une trace supplémentaire');

-- =============================================================================================
-- 5. Channel vide et fermeture du vocabulaire
-- =============================================================================================

select is(pg_temp.appliquer('5eed0000-0000-4000-8000-000000000033',
	pg_temp.workflow_derive(), '[]', false), 0::bigint,
	'un channel vide accepte exactement [] et rend un tableau vide');
select is((select workflow_id from public.channels where id =
	'5eed0000-0000-4000-8000-000000000033'), pg_temp.workflow_derive(),
	'le channel vide a réellement changé : le succès n''est pas simulé');
select is(pg_temp.appliquer('5eed0000-0000-4000-8000-000000000033',
	'5eed0000-0000-4000-8000-000000000051', '[]', false), 0::bigint,
	'le même geste réel restaure le channel vide');
select is((select workflow_id from public.channels where id =
	'5eed0000-0000-4000-8000-000000000033'),
	'5eed0000-0000-4000-8000-000000000051'::uuid,
	'le channel vide retrouve son workflow initial');

select pg_temp.redevenir_proprietaire();
-- RÉVISÉ PAR `CRM-058` : le témoin était `mail_sent`, devenu un type LIVRÉ. S'en servir encore
-- aurait mesuré le contraire de ce que le test dit mesurer. Le garde-fou porte sur un type que le
-- produit n'a pas encore écrit.
select throws_ok(
	$$insert into public.card_events (card_id, workspace_id, type)
	  values ('01900000-0000-4000-8000-0000000000a1',
	          '5eed0000-0000-4000-8000-000000000001', 'mail_bounced')$$,
	'23514', null, 'un type fantôme reste refusé : `mail_received` et `mail_sent` sont acceptés '
	'depuis CRM-055 et CRM-058 — le garde-fou suit le vocabulaire, il ne le devance pas');

select * from finish();
rollback;

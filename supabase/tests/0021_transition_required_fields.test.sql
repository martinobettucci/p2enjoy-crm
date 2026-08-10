-- @verifies CRM-018 (docs/BACKLOG.md) — table de liaison des champs exigés par une transition
-- @verifies docs/SPEC-transition-required-fields.md §2 à §6
-- @verifies docs/SPEC-workflow-engine.md §3.4, §4.5 et §5.7
-- @verifies docs/SPEC-form-composer.md §3.5 et §6.7
-- @verifies docs/SPEC-permissions-rls.md §4 et §7
-- @verifies docs/INCONSISTENCY_REPORT.md INC-037 (copie complète) et INC-038 (suppression visible)

begin;

create extension if not exists pgtap with schema extensions;

select plan(88);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.postgres()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role postgres';
end;
$$;

create or replace function pg_temp.detail_move(card uuid, etape uuid)
returns text language plpgsql as $$
declare
	detail text;
begin
	perform public.move_card(card, etape);
	return '(aucun refus)';
exception when others then
	get stacked diagnostics detail = pg_exception_detail;
	return detail;
end;
$$;

-- =============================================================================================
-- 1. Forme exacte, contraintes, trigger et RLS
-- =============================================================================================

select has_table('public', 'workflow_transition_required_fields',
	'la table de liaison CRM-018 existe');
select columns_are('public', 'workflow_transition_required_fields',
	array['transition_id', 'field_id'],
	'la table porte exactement les deux colonnes arbitrées, sans identité ni horodatage');
select col_is_pk('public', 'workflow_transition_required_fields',
	array['transition_id', 'field_id'], 'la clé primaire est le couple transition × champ');
select col_not_null('public', 'workflow_transition_required_fields', 'transition_id',
	'`transition_id` est non nul');
select col_not_null('public', 'workflow_transition_required_fields', 'field_id',
	'`field_id` est non nul');
select col_type_is('public', 'workflow_transition_required_fields', 'transition_id', 'uuid',
	'`transition_id` porte exactement le type uuid');
select col_type_is('public', 'workflow_transition_required_fields', 'field_id', 'uuid',
	'`field_id` porte exactement le type uuid');
select col_hasnt_default('public', 'workflow_transition_required_fields', 'transition_id',
	'`transition_id` n''invente aucun parent par défaut');
select col_hasnt_default('public', 'workflow_transition_required_fields', 'field_id',
	'`field_id` n''invente aucun parent par défaut');
select fk_ok('public', 'workflow_transition_required_fields', 'transition_id',
	'public', 'workflow_transitions', 'id',
	'`transition_id` référence exactement `workflow_transitions.id`');
select fk_ok('public', 'workflow_transition_required_fields', 'field_id',
	'public', 'form_fields', 'id',
	'`field_id` référence exactement `form_fields.id`');
select is(
	(select count(*)::int from pg_constraint
	  where conrelid = 'public.workflow_transition_required_fields'::regclass and contype = 'f'),
	2, 'exactement deux clés étrangères, une par parent');
select ok(
	(select pg_get_constraintdef(oid) like '%ON DELETE CASCADE'
	   from pg_constraint
	  where conrelid = 'public.workflow_transition_required_fields'::regclass
	    and conname = 'workflow_transition_required_fields_transition_id_fkey'),
	'supprimer une transition cascade ses exigences');
select ok(
	(select pg_get_constraintdef(oid) like '%ON DELETE CASCADE'
	   from pg_constraint
	  where conrelid = 'public.workflow_transition_required_fields'::regclass
	    and conname = 'workflow_transition_required_fields_field_id_fkey'),
	'supprimer un champ cascade ses exigences');
select has_index('public', 'workflow_transition_required_fields',
	'workflow_transition_required_fields_field_idx',
	'l''index inverse rend la cascade et les recherches par champ efficaces');
select has_function('app', 'workflow_transition_required_fields_verifier_workflow',
	'la fonction de cohérence de workflow existe');
select has_trigger('public', 'workflow_transition_required_fields',
	'workflow_transition_required_fields_verifier_workflow',
	'le trigger de cohérence est attaché à la table');
select has_function('app', 'workflow_transition_required_fields_verifier_parent',
	'la fonction symétrique de protection des parents existe');
select has_trigger('public', 'workflow_transitions',
	'workflow_transitions_verifier_required_fields',
	'déplacer une transition repasse par la cohérence des liaisons');
select has_trigger('public', 'form_fields', 'form_fields_verifier_required_fields',
	'déplacer un champ repasse par la cohérence des liaisons');
select is(
	(select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
	  where p.oid = 'app.workflow_transition_required_fields_verifier_workflow()'::regprocedure),
	'postgres', 'la fonction de trigger appartient à postgres');
select ok(
	(select prosecdef from pg_proc
	  where oid = 'app.workflow_transition_required_fields_verifier_workflow()'::regprocedure),
	'la fonction est SECURITY DEFINER pour lire les deux parents malgré RLS');
select ok(
	(select coalesce(proconfig, array[]::text[]) @> array['search_path=""']
	  from pg_proc
	  where oid = 'app.workflow_transition_required_fields_verifier_workflow()'::regprocedure),
	'la fonction fixe un search_path vide');
select is(
	(select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
	  where p.oid = 'app.workflow_transition_required_fields_verifier_parent()'::regprocedure),
	'postgres', 'la protection des parents appartient elle aussi à postgres');
select ok(
	(select prosecdef from pg_proc
	  where oid = 'app.workflow_transition_required_fields_verifier_parent()'::regprocedure),
	'la protection des parents est SECURITY DEFINER');
select ok(
	(select coalesce(proconfig, array[]::text[]) @> array['search_path=""']
	  from pg_proc
	  where oid = 'app.workflow_transition_required_fields_verifier_parent()'::regprocedure),
	'la protection des parents fixe aussi un search_path vide');
select is(
	(select relrowsecurity from pg_class
	  where oid = 'public.workflow_transition_required_fields'::regclass),
	true, 'RLS est activée');
select is(
	(select array_agg(policyname::text order by policyname) from pg_policies
	  where schemaname = 'public' and tablename = 'workflow_transition_required_fields'),
	array['workflow_transition_required_fields_insertion_admin',
	      'workflow_transition_required_fields_lecture_membre',
	      'workflow_transition_required_fields_suppression_admin'],
	'exactement trois politiques : lecture membre, insertion et suppression admin');

select ok(has_table_privilege('anon', 'public.workflow_transition_required_fields', 'select'),
	'anon possède SELECT pour que RLS rende zéro ligne');
select ok(not has_table_privilege('anon', 'public.workflow_transition_required_fields', 'insert'),
	'anon ne possède pas INSERT');
select ok(not has_table_privilege('anon', 'public.workflow_transition_required_fields', 'delete'),
	'anon ne possède pas DELETE');
select ok(has_table_privilege('authenticated', 'public.workflow_transition_required_fields', 'select'),
	'authenticated possède SELECT');
select ok(has_table_privilege('authenticated', 'public.workflow_transition_required_fields', 'insert'),
	'authenticated possède INSERT, filtré par la politique admin');
select ok(has_table_privilege('authenticated', 'public.workflow_transition_required_fields', 'delete'),
	'authenticated possède DELETE, filtré par la politique admin');
select ok(not has_table_privilege('authenticated', 'public.workflow_transition_required_fields', 'update'),
	'authenticated ne peut pas mettre une liaison à jour : supprimer puis créer');
select ok(has_table_privilege('service_role', 'public.workflow_transition_required_fields', 'select'),
	'service_role possède SELECT');
select ok(has_table_privilege('service_role', 'public.workflow_transition_required_fields', 'insert'),
	'service_role possède INSERT');
select ok(has_table_privilege('service_role', 'public.workflow_transition_required_fields', 'update'),
	'service_role possède UPDATE, mais reste contraint par le trigger');
select ok(has_table_privilege('service_role', 'public.workflow_transition_required_fields', 'delete'),
	'service_role possède DELETE');
select ok(not has_function_privilege(role_testee,
	'app.workflow_transition_required_fields_verifier_workflow()', 'execute'),
	format('la fonction de trigger n''est pas exécutable par %s', role_testee))
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_testee);
select ok(not has_function_privilege(role_testee,
	'app.workflow_transition_required_fields_verifier_parent()', 'execute'),
	format('la fonction de protection des parents n''est pas exécutable par %s', role_testee))
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_testee);
select hasnt_column('public', 'workflow_transitions', 'require_fields',
	'l''ancien tableau a disparu seulement après migration réussie');
select has_column('public', 'workflows', 'source_composition_fingerprint',
	'les workflows portent l''empreinte de composition source');
select col_type_is('public', 'workflows', 'source_composition_fingerprint', 'text',
	'l''empreinte est un texte hexadécimal');
select col_is_null('public', 'workflows', 'source_composition_fingerprint',
	'l''empreinte reste nullable pour les sources et les copies historiques');
select col_hasnt_default('public', 'workflows', 'source_composition_fingerprint',
	'aucun défaut ne fabrique une origine aux workflows qui ne sont pas des copies modernes');
select is(
	(select count(*)::int from pg_constraint
	  where conrelid = 'public.workflows'::regclass
	    and conname = 'workflows_source_composition_fingerprint_check'),
	1, 'la forme SHA-256 de l''empreinte est contrainte');
select has_function('app', 'workflow_composition_fingerprint', array['uuid'],
	'la fonction canonique d''empreinte existe');
select is(
	length(app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051')),
	64, 'l''empreinte calculée porte exactement 64 caractères hexadécimaux');

-- =============================================================================================
-- 2. Seed déterministe : source et copie fonctionnelles
-- =============================================================================================

select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	  join public.workflow_transitions t on t.id = trf.transition_id
	  join public.workflows w on w.id = t.workflow_id
	 where w.id = '5eed0000-0000-4000-8000-000000000051'
	    or (w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	        and w.name = 'Cycle commercial — Conseil IA')),
	2, 'les deux liaisons de la fixture seedée existent, indépendamment des copies utilisateur');
select is(
	(select field_id from public.workflow_transition_required_fields
	  where transition_id = '5eed0000-0000-4000-8000-000000000074'),
	'5eed0000-0000-4000-8000-000000000086'::uuid,
	'« Démarrer la réalisation » exige exactement `lien-proposition`');
select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	   join public.workflow_transitions t on t.id = trf.transition_id
	  where t.workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	1, 'la liaison appartient au workflow global');
select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	   join public.workflow_transitions t on t.id = trf.transition_id
	   join public.workflows w on w.id = t.workflow_id
	  where w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and w.name = 'Cycle commercial — Conseil IA'),
	1, 'la copie porte une liaison fonctionnelle remappée — INC-037 et INC-056');
select is(
	(select count(*)::int
	   from public.form_fields source
	   join public.form_fields copie on copie.id = source.id
	   join public.workflows w on w.id = copie.workflow_id
	  where source.workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and w.name = 'Cycle commercial — Conseil IA'),
	0, 'aucun identifiant de champ n''est partagé entre source et copie');
select matches(
	(select source_composition_fingerprint from public.workflows
	  where derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and name = 'Cycle commercial — Conseil IA'),
	'^[0-9a-f]{64}$', 'la copie seedée conserve une empreinte SHA-256 réelle');
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where source_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and name = 'Cycle commercial — Conseil IA'),
	false, 'la copie seedée ne diverge pas immédiatement de sa source');

-- =============================================================================================
-- 3. Parents réels et même workflow
-- =============================================================================================

select throws_ok($$
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075',
	        '5eed0000-0000-4000-8000-0000000000ff') $$,
	'23503', null, 'un identifiant de champ mort est refusé par clé étrangère');

insert into public.workflows (id, workspace_id, name)
values ('18000000-0000-4000-8000-000000000001',
	'5eed0000-0000-4000-8000-000000000001', 'Workflow croisé CRM-018');
insert into public.form_fields (
	id, workflow_id, workspace_id, key, label, type, options, position
) values (
	'18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000001',
	'5eed0000-0000-4000-8000-000000000001', 'croisement-crm-018', 'Croisement CRM-018',
	'text', '{}'::jsonb, 1
);

select throws_ok($$
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075',
	        '18000000-0000-4000-8000-000000000002') $$,
	'23514', 'required_field_workflow_mismatch',
	'un champ réel du même workspace mais d''un autre workflow est refusé par le trigger');

insert into public.workflow_steps (
	id, workflow_id, workspace_id, node_id, position, is_initial
) values
	('18000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000001',
	 '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000041', 1, true),
	('18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-000000000001',
	 '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000042', 2, false);
insert into public.form_fields (
	id, workflow_id, workspace_id, key, label, type, options, position
) values (
	'18000000-0000-4000-8000-000000000005', '5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', 'parent-crm-018', 'Parent CRM-018',
	'text', '{}'::jsonb, 999
);
insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('5eed0000-0000-4000-8000-000000000075',
	'18000000-0000-4000-8000-000000000005');

select throws_ok($$
	update public.workflow_transitions
	   set workflow_id = '18000000-0000-4000-8000-000000000001',
	       from_step_id = '18000000-0000-4000-8000-000000000003',
	       to_step_id = '18000000-0000-4000-8000-000000000004'
	 where id = '5eed0000-0000-4000-8000-000000000075' $$,
	'23514', 'required_field_workflow_mismatch',
	'déplacer après coup une transition liée vers un autre workflow est refusé');
select throws_ok($$
	update public.form_fields
	   set workflow_id = '18000000-0000-4000-8000-000000000001'
	 where id = '18000000-0000-4000-8000-000000000005' $$,
	'23514', 'required_field_workflow_mismatch',
	'déplacer après coup un champ lié vers un autre workflow est refusé');

delete from public.workflow_transition_required_fields
	where transition_id = '5eed0000-0000-4000-8000-000000000075'
	  and field_id = '18000000-0000-4000-8000-000000000005';
delete from public.form_fields where id = '18000000-0000-4000-8000-000000000005';

-- =============================================================================================
-- 4. RLS éprouvée avec les profils réels du seed
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075',
	        '5eed0000-0000-4000-8000-000000000081') $$,
	'l''administratrice crée une liaison du même workflow');
select is(
	(select count(*)::int from public.workflow_transition_required_fields
	  where transition_id = '5eed0000-0000-4000-8000-000000000075'
	    and field_id = '5eed0000-0000-4000-8000-000000000081'),
	1, 'la liaison créée par l''administratrice est réellement visible');
select lives_ok($$
	delete from public.workflow_transition_required_fields
	 where transition_id = '5eed0000-0000-4000-8000-000000000075'
	   and field_id = '5eed0000-0000-4000-8000-000000000081' $$,
	'l''administratrice supprime réellement la liaison');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075',
	        '5eed0000-0000-4000-8000-000000000081') $$,
	'42501', null, 'le business developer ne peut pas créer de liaison');

select pg_temp.anonyme();
select is((select count(*)::int from public.workflow_transition_required_fields), 0,
	'l''anonyme voit zéro ligne sur une table pourtant peuplée');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	  join public.workflow_transitions t on t.id = trf.transition_id
	  join public.workflows w on w.id = t.workflow_id
	 where w.id = '5eed0000-0000-4000-8000-000000000051'
	    or (w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	        and w.name = 'Cycle commercial — Conseil IA')),
	2, 'un membre lit les deux liaisons de la fixture seedée');

select pg_temp.postgres();
select throws_ok($$
	update public.workflow_transition_required_fields
	   set field_id = '18000000-0000-4000-8000-000000000002'
	 where transition_id = '5eed0000-0000-4000-8000-000000000074' $$,
	'23514', 'required_field_workflow_mismatch',
	'même le propriétaire des tables ne peut contourner la cohérence de workflow');

-- =============================================================================================
-- 5. Cascades, `move_card` et copie du produit
-- =============================================================================================

-- Le couple porte `Perdu → Prospection`, et le choix n'est pas indifférent. Cette fixture
-- occupait `Réalisation en cours → Perdu`, que le seed a **déclarée** avec la décision 259
-- (INC-003) : la contrainte d'unicité l'a fait échouer, et la preuve mesurait donc en réalité
-- l'absence d'une arête du produit. `Perdu` est une étape d'issue `lost` : le §3.9 de
-- `docs/SPEC-workflow-engine.md` pose qu'elle n'a **aucune sortie**, et cette absence-là est une
-- règle écrite, non un hasard du graphe courant. La fixture est donc libre par construction.
insert into public.workflow_transitions (
	id, workflow_id, workspace_id, from_step_id, to_step_id, label
) values (
	'18000000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000067',
	'5eed0000-0000-4000-8000-000000000061', 'Transition cascade CRM-018'
);
insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('18000000-0000-4000-8000-000000000010',
	'5eed0000-0000-4000-8000-000000000081');
delete from public.workflow_transitions where id = '18000000-0000-4000-8000-000000000010';
select is(
	(select count(*)::int from public.workflow_transition_required_fields
	  where transition_id = '18000000-0000-4000-8000-000000000010'),
	0, 'supprimer une transition emporte sa liaison');

insert into public.form_fields (
	id, workflow_id, workspace_id, key, label, type, options, position
) values (
	'18000000-0000-4000-8000-000000000011', '5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', 'cascade-crm-018', 'Cascade CRM-018',
	'text', '{}'::jsonb, 999
);
insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('5eed0000-0000-4000-8000-000000000075',
	'18000000-0000-4000-8000-000000000011');
delete from public.form_fields where id = '18000000-0000-4000-8000-000000000011';
select is(
	(select count(*)::int from public.workflow_transition_required_fields
	  where field_id = '18000000-0000-4000-8000-000000000011'),
	0, 'supprimer physiquement un champ jetable ne laisse aucune liaison morte');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	pg_temp.detail_move('5eed0000-0000-4000-8000-0000000000c7',
	                    '5eed0000-0000-4000-8000-000000000065'),
	'lien-proposition', '`move_card` lit la liaison et nomme la clé manquante');

select pg_temp.postgres();
insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
values ('5eed0000-0000-4000-8000-0000000000c7',
	'5eed0000-0000-4000-8000-000000000086', '5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', '"https://p2enjoy.test/crm-018"'::jsonb)
on conflict (card_id, field_id) do update set value = excluded.value;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c7',
	                        '5eed0000-0000-4000-8000-000000000065') $$,
	'la même transition passe lorsque la valeur liée est renseignée');

create temporary table pg_temp_copie_crm018 (id uuid);
insert into pg_temp_copie_crm018
select public.copy_workflow_to_track(
	'5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000022',
	'Copie sonde CRM-018'
);
select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	   join public.workflow_transitions t on t.id = trf.transition_id
	  where t.workflow_id = (select id from pg_temp_copie_crm018)),
	1, '`copy_workflow_to_track` remappe l''exigence vers le formulaire cible');
select is(
	(select count(*)::int from public.form_fields
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	7, 'la copie sonde porte les sept champs de la source');
select is(
	(select count(*)::int from public.form_field_rules
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	15, 'la copie sonde porte les quinze règles de la source');
select is(
	(select count(*)::int
	   from public.form_fields source
	   join public.form_fields copie on copie.id = source.id
	  where source.workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and copie.workflow_id = (select id from pg_temp_copie_crm018)),
	0, 'la copie sonde ne réutilise aucun identifiant de champ source');
select matches(
	(select source_composition_fingerprint from public.workflows
	  where id = (select id from pg_temp_copie_crm018)),
	'^[0-9a-f]{64}$', 'la copie sonde stocke une empreinte valide');
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	false, 'la copie sonde est identique juste après le geste atomique');

update public.form_fields set label = 'Budget estimé modifié — CRM-018'
 where id = '5eed0000-0000-4000-8000-000000000081';
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	true, 'modifier un champ source allume la divergence');
update public.form_fields set label = 'Budget estimé'
 where id = '5eed0000-0000-4000-8000-000000000081';
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	false, 'restaurer exactement la composition éteint la divergence malgré updated_at');

insert into public.form_fields (
	id, workflow_id, workspace_id, key, label, type, options, position
) values (
	'18000000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000051',
	'5eed0000-0000-4000-8000-000000000001', 'ajout-crm-018', 'Ajout CRM-018', 'text', '{}'::jsonb, 998
);
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	true, 'ajouter un champ source allume la divergence');
select pg_temp.postgres();
delete from public.form_fields where id = '18000000-0000-4000-8000-000000000012';
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	false, 'retirer exactement l''ajout rétablit la composition initiale');

delete from public.form_fields where id = '5eed0000-0000-4000-8000-000000000087';
select is(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie_crm018)),
	true, 'supprimer un champ source existant allume enfin la divergence — INC-038');

-- Une corruption impossible sous les gardes normales simule un mapping incomplet. La RPC doit
-- refuser le lot et ne laisser aucun workflow partiel.
alter table public.workflow_transition_required_fields
	disable trigger workflow_transition_required_fields_verifier_workflow;
insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('5eed0000-0000-4000-8000-000000000075',
	'18000000-0000-4000-8000-000000000002');

-- La corruption structurelle exige `postgres`, mais le geste produit reste celui d'une vraie
-- administratrice authentifiée : ses claims doivent être restaurés avant d'appeler la RPC.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.copy_workflow_to_track(
		'5eed0000-0000-4000-8000-000000000051',
		'5eed0000-0000-4000-8000-000000000022',
		'Copie atomique refusée CRM-018') $$,
	'P0001', 'workflow_copy_mapping_incomplete: required_fields 1/2',
	'une référence impossible à remapper refuse toute la copie');
select is(
	(select count(*)::int from public.workflows where name = 'Copie atomique refusée CRM-018'),
	0, 'aucun workflow partiel ne survit au refus de mapping');

select pg_temp.postgres();
delete from public.workflow_transition_required_fields
 where transition_id = '5eed0000-0000-4000-8000-000000000075'
	and field_id = '18000000-0000-4000-8000-000000000002';
alter table public.workflow_transition_required_fields
	enable trigger workflow_transition_required_fields_verifier_workflow;

select * from finish();
rollback;

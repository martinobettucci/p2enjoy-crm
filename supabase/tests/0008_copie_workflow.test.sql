-- @verifies CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, lignage, divergence
-- @verifies docs/SPEC-workflow-engine.md §4.2 (signature), §4.3 (vérifications), §4.5 (ce qui est
--           copié), §4.6 (vue de divergence), §4.7 (privilèges), §4.8 (formulaire copié)
-- @verifies docs/SCHEMA.md §3 (workflows, étapes, transitions), §9 (fonctions)
-- @verifies docs/SPEC-permissions-rls.md §4 (écriture réservée aux administrateurs), §7 (refus n° 2)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-037 (formulaire remappé), INC-038 (suppression
--           détectée), INC-039 (ordre de suppression d'un workspace)
--
-- Suite pgTAP de l'unité `CRM-032`. Elle prouve six choses :
--
--   1. la **forme** de la fonction et de la vue : signature, volatilité, `search_path`, sécurité,
--      colonnes, `security_invoker` ;
--   2. les **privilèges**, et pas seulement leur présence : `anon` n'exécute pas la fonction, et
--      la vue n'est modifiable par personne — deux points que les privilèges par défaut de l'image
--      auraient accordés sans qu'on le demande (docs/JOURNAL.md, décision 80) ;
--   3. la **copie elle-même** : étapes, arêtes remappées, surcharges, positions fractionnaires,
--      `is_default` forcé, lignage renseigné ;
--   4. les **quatre refus** du §4.3, éprouvés contre des comptes réels avec les revendications JWT
--      simulées exactement comme PostgREST les pose ;
--   5. le **signal de divergence** : faux tant que rien ne bouge, vrai après une modification de la
--      source ;
--   6. les reprises de `CRM-018` : formulaire et exigences remappés, empreinte exacte ; ainsi que
--      l'écart encore ouvert d'INC-039 sur la suppression d'un workspace.
--
-- Exécution : `npm run test:sql`, `scripts/verify-copie-workflow.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0008_copie_workflow.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes, ni les workspaces de test ne subsistent.
--
-- La suite se termine **hors savepoint**, et n'en emploie aucun : une assertion exécutée dans un
-- savepoint ensuite annulé est numérotée mais non comptée par pgTAP, et `scripts/run-sql-tests.sh`
-- refuse alors le fichier (docs/SPEC-test-harness.md §3.2, décisions 76 et 79). Les blocs
-- d'autorisation rendent la main au superutilisateur et défont explicitement leurs écritures.

begin;

create extension if not exists pgtap with schema extensions;

select plan(69);

-- =============================================================================================
-- 1. La fonction existe, et elle a exactement la forme spécifiée
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.2.

select has_function(
	'public', 'copy_workflow_to_track', array['uuid', 'uuid', 'text'],
	'`public.copy_workflow_to_track(uuid, uuid, text)` existe');

select function_returns(
	'public', 'copy_workflow_to_track', array['uuid', 'uuid', 'text'], 'uuid',
	'elle rend l''identifiant de la copie, et non un booléen : l''appelant doit pouvoir la relire');

select is(
	(select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'),
	'v', 'elle est `VOLATILE` : elle écrit');

select ok(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'),
	'elle est `SECURITY DEFINER` : les politiques RLS ne s''appliquant pas au propriétaire des '
	'tables, c''est la fonction qui porte la règle d''accès, par un contrôle explicite');

select is(
	(select p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'),
	'{"search_path=\"\""}',
	'son `search_path` vaut exactement la chaîne vide — sans quoi `SECURITY DEFINER` serait une '
	'porte ouverte sur un schéma choisi par l''appelant');

select is(
	(select array_to_string(p.proargnames, ',') from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'),
	'workflow_id,track_id,new_name',
	'ses paramètres portent les noms du contrat d''API : PostgREST les lit dans le corps JSON');

select is(
	(select p.pronargdefaults::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'),
	1, '`new_name` est le seul paramètre facultatif');

-- =============================================================================================
-- 2. La vue de divergence
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.6.

select has_view('public', 'workflow_derivations', 'la vue `public.workflow_derivations` existe');

select columns_are(
	'public', 'workflow_derivations',
	array['workflow_id', 'workspace_id', 'name', 'track_id', 'derived_at', 'source_workflow_id',
	      'source_name', 'source_archived_at', 'source_modified_at',
	      'source_composition_fingerprint', 'current_source_composition_fingerprint',
	      'source_modified_since_copy'],
	'elle porte exactement les colonnes de docs/SPEC-workflow-engine.md §4.6');

select ok(
	(select c.reloptions::text like '%security_invoker=true%' from pg_class c
	   join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'workflow_derivations'),
	'elle est `security_invoker` : la RLS des tables sous-jacentes s''applique à l''appelant. Sans '
	'ce réglage, la vue serait une porte dérobée sur trois tables protégées');

-- =============================================================================================
-- 3. Privilèges — et le défaut d'origine de l'image qu'ils corrigent
-- =============================================================================================
-- docs/JOURNAL.md, décision 80. MESURÉ : l'image livre des privilèges par défaut qui accordent
-- nommément à `anon` l'exécution de toute fonction nouvelle de `public` et **tous** les droits de
-- toute vue nouvelle. Un `revoke … from public` ne les touche pas. Ces trois assertions vérifient
-- que la révocation nommée a bien été faite — et deviendraient rouges si elle disparaissait.

select ok(
	not has_function_privilege('anon', 'public.copy_workflow_to_track(uuid, uuid, text)', 'EXECUTE'),
	'`anon` n''exécute PAS la fonction : la révocation nommée a bien eu lieu, celle visant `public` '
	'n''aurait rien retiré');

select ok(
	has_function_privilege('authenticated', 'public.copy_workflow_to_track(uuid, uuid, text)',
	                       'EXECUTE'),
	'`authenticated` l''exécute : le refus d''un membre non administrateur vient du contrôle '
	'explicite, pas du privilège');

select ok(
	has_table_privilege('anon', 'public.workflow_derivations', 'SELECT'),
	'`anon` a le privilège `SELECT` sur la vue : son refus doit valoir zéro ligne, non une erreur');

select ok(
	not has_table_privilege('authenticated', 'public.workflow_derivations', 'UPDATE'),
	'personne ne modifie la vue : les privilèges par défaut de l''image l''auraient livrée '
	'`arwdDxtm` pour les trois rôles');

select ok(
	not has_table_privilege('authenticated', 'public.workflow_derivations', 'DELETE'),
	'ni ne supprime une de ses lignes');

-- =============================================================================================
-- 4. Jeu d'essai
-- =============================================================================================
-- Deux workspaces, deux tracks, un catalogue de trois nœuds, un workflow global par défaut portant
-- trois étapes — dont une initiale et deux surchargées — et trois arêtes, dont un cycle.

insert into public.workspaces (id, name, slug) values
	('c0b10000-0000-4000-8000-000000000001', 'Copie A', 'tst-crm032-a'),
	('c0b10000-0000-4000-8000-000000000002', 'Copie B', 'tst-crm032-b');

insert into public.tracks (id, workspace_id, name, slug, position, archived_at) values
	('c0b10000-0000-4000-8000-0000000000a1', 'c0b10000-0000-4000-8000-000000000001',
	 'Track A', 'tst-crm032-track-a', 1, null),
	('c0b10000-0000-4000-8000-0000000000a2', 'c0b10000-0000-4000-8000-000000000001',
	 'Track archivé', 'tst-crm032-track-archive', 2, '2026-01-01T00:00:00Z'),
	('c0b10000-0000-4000-8000-0000000000a3', 'c0b10000-0000-4000-8000-000000000002',
	 'Track B', 'tst-crm032-track-b', 1, null);

-- Le catalogue fait partie de la composition horodatée. Ses lignes sont plus récentes que le
-- workflow et ses enfants, mais antérieures à la copie : la section 7 prouve ainsi qu'elles
-- participent à `source_modified_at` sans créer une divergence temporelle artificielle.
insert into public.workflow_nodes_catalog
	(id, workspace_id, key, label, position, created_at, updated_at) values
	('c0b10000-0000-4000-8000-0000000000b1', 'c0b10000-0000-4000-8000-000000000001',
	 'un', 'Un', 1, now() - interval '18 hours', now() - interval '18 hours'),
	('c0b10000-0000-4000-8000-0000000000b2', 'c0b10000-0000-4000-8000-000000000001',
	 'deux', 'Deux', 2, now() - interval '18 hours', now() - interval '18 hours'),
	('c0b10000-0000-4000-8000-0000000000b3', 'c0b10000-0000-4000-8000-000000000001',
	 'trois', 'Trois', 3, now() - interval '18 hours', now() - interval '18 hours');

-- Antidatée d'un jour, comme sa composition plus bas : le trigger `set_updated_at` n'agit qu'à la
-- mise à jour, et écrirait `now()` quoi qu'on lui demande.
insert into public.workflows (id, workspace_id, name, is_default, created_at, updated_at) values
	('c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-000000000001',
	 'Source globale', true, now() - interval '1 day', now() - interval '1 day');

-- Un workflow déjà de portée `track`, pour éprouver le refus « une copie ne se copie pas ».
insert into public.workflows (id, workspace_id, name, scope, track_id) values
	('c0b10000-0000-4000-8000-0000000000c2', 'c0b10000-0000-4000-8000-000000000001',
	 'Déjà rattachée', 'track', 'c0b10000-0000-4000-8000-0000000000a1');

-- Un workflow archivé, et un workflow du workspace B.
insert into public.workflows (id, workspace_id, name, archived_at) values
	('c0b10000-0000-4000-8000-0000000000c3', 'c0b10000-0000-4000-8000-000000000001',
	 'Archivée', '2026-01-01T00:00:00Z');
insert into public.workflows (id, workspace_id, name) values
	('c0b10000-0000-4000-8000-0000000000c4', 'c0b10000-0000-4000-8000-000000000002', 'Chez B');

-- `position` fractionnaire sur la deuxième étape : la copie doit la conserver telle quelle.
--
	-- `updated_at` est **antidaté d'un jour** sur les enfants propres au workflow, et ce n'est pas
-- une coquetterie. MESURÉ : `now()` est constant sur toute la durée d'une transaction, et le trigger
-- `set_updated_at` écrit `now()` sans se laisser imposer une autre valeur. Sans antidatage, toutes
-- les lignes de cette suite porteraient la même seconde, et la section 7 ne pourrait rien prouver
-- du signal de divergence — ni son extinction, ni son allumage. Le trigger ne joue qu'à la mise à
-- jour : l'insertion peut donc fixer la valeur librement.
insert into public.workflow_steps
	(id, workflow_id, workspace_id, node_id, position, is_initial,
	 label_override, probability_override, stale_after_days, created_at, updated_at) values
	('c0b10000-0000-4000-8000-0000000000d1', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000b1',
	 1, true, 'Départ surchargé', 10.50, 7, now() - interval '1 day', now() - interval '1 day'),
	('c0b10000-0000-4000-8000-0000000000d2', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000b2',
	 2.5, false, null, null, null, now() - interval '1 day', now() - interval '1 day'),
	('c0b10000-0000-4000-8000-0000000000d3', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000b3',
	 3, false, null, 90, 21, now() - interval '1 day', now() - interval '1 day');

insert into public.workflow_transitions
	(id, workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment,
	 created_at, updated_at) values
	('c0b10000-0000-4000-8000-0000000000e1', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000d1',
	 'c0b10000-0000-4000-8000-0000000000d2', 'Avancer', false,
	 now() - interval '1 day', now() - interval '1 day'),
	('c0b10000-0000-4000-8000-0000000000e2', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000d2',
	 'c0b10000-0000-4000-8000-0000000000d1', 'Revenir', true,
	 now() - interval '1 day', now() - interval '1 day'),
	('c0b10000-0000-4000-8000-0000000000e3', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-0000000000d2',
	 'c0b10000-0000-4000-8000-0000000000d3', null, false,
	 now() - interval '1 day', now() - interval '1 day');

insert into public.form_fields (
	id, workflow_id, workspace_id, key, label, type, options, position, archived_at,
	created_at, updated_at
) values
	('c0b10000-0000-4000-8000-0000000000f1', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'budget-sonde', 'Budget sonde', 'money',
	 '{"currency":"EUR"}'::jsonb, 1, null, now() - interval '1 day', now() - interval '1 day'),
	('c0b10000-0000-4000-8000-0000000000f2', 'c0b10000-0000-4000-8000-0000000000c1',
	 'c0b10000-0000-4000-8000-000000000001', 'note-sonde', 'Note sonde', 'textarea',
	 '{}'::jsonb, 2, '2026-01-01T00:00:00Z', now() - interval '1 day', now() - interval '1 day');

insert into public.form_field_rules (
	field_id, step_id, workflow_id, workspace_id, visibility, created_at, updated_at
) values (
	'c0b10000-0000-4000-8000-0000000000f1', 'c0b10000-0000-4000-8000-0000000000d2',
	'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-000000000001',
	'required', now() - interval '1 day', now() - interval '1 day'
);

insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('c0b10000-0000-4000-8000-0000000000e1',
	'c0b10000-0000-4000-8000-0000000000f2');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
	('c0b10000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'cp-admin-a@exemple.test', '{"full_name": "Admin CP A"}'),
	('c0b10000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'cp-bizdev-a@exemple.test', '{"full_name": "Bizdev CP A"}'),
	('c0b10000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'cp-viewer-a@exemple.test', '{"full_name": "Viewer CP A"}'),
	('c0b10000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'cp-admin-b@exemple.test', '{"full_name": "Admin CP B"}');

insert into public.workspace_members (workspace_id, user_id, role) values
	('c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-00000000000a', 'admin'),
	('c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-00000000000b',
	 'business_developer'),
	('c0b10000-0000-4000-8000-000000000001', 'c0b10000-0000-4000-8000-00000000000c', 'viewer'),
	('c0b10000-0000-4000-8000-000000000002', 'c0b10000-0000-4000-8000-00000000000d', 'admin');

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- =============================================================================================
-- 5. La copie, faite par un administrateur — docs/SPEC-workflow-engine.md §4.5
-- =============================================================================================
-- L'appel est fait sous l'identité réelle d'un administrateur, et non en superutilisateur : la
-- fonction lit `auth.uid()`, et une copie qui réussirait seulement en superutilisateur ne prouverait
-- rien du produit.

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000a');

create temporary table pg_temp_copie (id uuid);
insert into pg_temp_copie
select public.copy_workflow_to_track(
	'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a1', 'Copie A1');

reset role;

select isnt(
	(select id from pg_temp_copie), null,
	'un administrateur copie le workflow global vers un track de son workspace');

select is(
	(select w.name from public.workflows w where w.id = (select id from pg_temp_copie)),
	'Copie A1', '`new_name` fourni est repris tel quel');

select is(
	(select w.scope from public.workflows w where w.id = (select id from pg_temp_copie)),
	'track', 'la copie est de portée `track`');

select is(
	(select w.track_id from public.workflows w where w.id = (select id from pg_temp_copie)),
	'c0b10000-0000-4000-8000-0000000000a1'::uuid, 'et elle est rattachée au track demandé');

select is(
	(select w.derived_from_workflow_id from public.workflows w
	  where w.id = (select id from pg_temp_copie)),
	'c0b10000-0000-4000-8000-0000000000c1'::uuid,
	'le lignage est renseigné : la copie se souvient d''où elle vient');

select ok(
	(select w.derived_at is not null from public.workflows w
	  where w.id = (select id from pg_temp_copie)),
	'et `derived_at` l''est aussi — la contrainte `workflows_derivation_check` exige les deux');

select matches(
	(select w.source_composition_fingerprint from public.workflows w
	  where w.id = (select id from pg_temp_copie)),
	'^[0-9a-f]{64}$', 'la copie mémorise l''empreinte SHA-256 exacte de sa source');

select ok(
	(select not w.is_default from public.workflows w where w.id = (select id from pg_temp_copie)),
	'`is_default` est FORCÉ À FAUX. MESURÉ : le copier tel quel depuis un workflow par défaut est '
	'refusé en `23505`, et le workflow que l''on copie est en pratique le workflow par défaut');

select ok(
	(select w.archived_at is null from public.workflows w where w.id = (select id from pg_temp_copie)),
	'une copie naît active : `archived_at` n''est pas copié');

select is(
	(select count(*)::int from public.workflow_steps s where s.workflow_id = (select id from pg_temp_copie)),
	3, 'les trois étapes sont copiées');

select is(
	(select count(*)::int from public.workflow_transitions t
	  where t.workflow_id = (select id from pg_temp_copie)),
	3, 'les trois arêtes aussi, cycle compris');

select is(
	(select count(*)::int from public.workflow_steps s
	  where s.workflow_id = (select id from pg_temp_copie) and s.is_initial),
	1, 'l''étape initiale reste initiale, et elle reste unique');

select is(
	(select string_agg(s.position::text, ',' order by s.position) from public.workflow_steps s
	  where s.workflow_id = (select id from pg_temp_copie)),
	'1,2.5,3',
	'les `position` fractionnaires sont conservées à l''identique : renuméroter la copie changerait '
	'l''ordre du board sans que personne ne l''ait demandé');

select is(
	(select s.label_override from public.workflow_steps s
	   join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workflow_id = (select id from pg_temp_copie) and n.key = 'un'),
	'Départ surchargé', 'la surcharge de libellé suit la copie');

select is(
	(select s.probability_override from public.workflow_steps s
	   join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workflow_id = (select id from pg_temp_copie) and n.key = 'un'),
	10.50::numeric, 'la surcharge de probabilité aussi');

select is(
	(select s.stale_after_days from public.workflow_steps s
	   join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workflow_id = (select id from pg_temp_copie) and n.key = 'trois'),
	21, 'et le seuil de relance, pris sur une autre étape que la précédente');

select ok(
	(select bool_and(s.label_override is null and s.probability_override is null
	                 and s.stale_after_days is null)
	   from public.workflow_steps s
	   join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workflow_id = (select id from pg_temp_copie) and n.key = 'deux'),
	'une surcharge absente le reste : `NULL` signifie « prendre la valeur du catalogue », jamais '
	'« zéro »');

-- --- 5.1 LE POINT CENTRAL : les arêtes sont remappées ------------------------------------------
-- Sans remappage, les arêtes de la copie pointeraient vers les étapes de la **source** — la clé
-- composite `(step_id, workflow_id)` les refuserait d'ailleurs en `23503`. L'assertion ne se
-- contente pas de compter : elle vérifie qu'aucune extrémité ne sort de la copie.

select is(
	(select count(*)::int from public.workflow_transitions t
	  where t.workflow_id = (select id from pg_temp_copie)
	    and (t.from_step_id not in (select s.id from public.workflow_steps s
	                                 where s.workflow_id = t.workflow_id)
	      or t.to_step_id   not in (select s.id from public.workflow_steps s
	                                 where s.workflow_id = t.workflow_id))),
	0,
	'AUCUNE arête de la copie ne pointe vers une étape restée dans la source : le remappage par le '
	'nœud est exact (docs/JOURNAL.md, décision 83)');

select is(
	(select n_depuis.key || '→' || n_vers.key
	   from public.workflow_transitions t
	   join public.workflow_steps s_depuis on s_depuis.id = t.from_step_id
	   join public.workflow_steps s_vers   on s_vers.id   = t.to_step_id
	   join public.workflow_nodes_catalog n_depuis on n_depuis.id = s_depuis.node_id
	   join public.workflow_nodes_catalog n_vers   on n_vers.id   = s_vers.node_id
	  where t.workflow_id = (select id from pg_temp_copie) and t.label = 'Avancer'),
	'un→deux',
	'et le graphe est le même : l''arête « Avancer » relie les mêmes nœuds dans la copie');

select ok(
	(select bool_and(t.require_comment) from public.workflow_transitions t
	  where t.workflow_id = (select id from pg_temp_copie) and t.label = 'Revenir'),
	'`require_comment` suit l''arête : une exigence de commentaire n''est pas perdue par la copie');

select is(
	(select count(*)::int from public.workflow_transition_required_fields trf
	   join public.workflow_transitions t on t.id = trf.transition_id
	  where t.workflow_id = (select id from pg_temp_copie)),
	1,
	'CRM-018 / INC-056 : la copie reçoit une liaison vers son propre champ remappé');

select is(
	(select count(*)::int from public.form_fields f
	  where f.workflow_id = (select id from pg_temp_copie)),
	2, 'les deux champs, dont l''archivé, sont copiés');
select is(
	(select count(*)::int from public.form_field_rules r
	  where r.workflow_id = (select id from pg_temp_copie)),
	1, 'la règle est remappée vers le champ et l''étape de la copie');
select is(
	(select count(*)::int
	   from public.form_fields source
	   join public.form_fields copie on copie.id = source.id
	  where source.workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
	    and copie.workflow_id = (select id from pg_temp_copie)),
	0, 'aucun identifiant de champ n''est partagé avec la source');

-- --- 5.2 Le nom par défaut ---------------------------------------------------------------------

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000a');
create temporary table pg_temp_copie2 (id uuid);
insert into pg_temp_copie2
select public.copy_workflow_to_track(
	'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a1');
reset role;

select is(
	(select w.name from public.workflows w where w.id = (select id from pg_temp_copie2)),
	'Source globale',
	'`new_name` omis : la copie reprend le nom de sa source — aucune unicité ne porte sur '
	'`workflows.name`, deux homonymes sont valides');

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a1', '   ')$$,
	'23514', null,
	'un nom vide après `btrim` est refusé par `workflows_name_check`, comme toute autre écriture : '
	'ce n''est pas une façon de demander le nom d''origine');

delete from public.workflows where id = (select id from pg_temp_copie2);

-- =============================================================================================
-- 6. Les quatre refus — docs/SPEC-workflow-engine.md §4.3
-- =============================================================================================

-- --- 6.1 `forbidden` : le rôle ------------------------------------------------------------------

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000b');
select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'42501', 'forbidden',
	'PREUVE DE REFUS N° 2 : un `business_developer` ne copie aucun workflow — copier, c''est '
	'écrire, et il travaille dans un workflow sans le dessiner');
reset role;

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000c');
select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'42501', 'forbidden', 'un `viewer` non plus');
reset role;

select is(
	(select count(*)::int from public.workflows w
	  where w.derived_from_workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'),
	1,
	'et AUCUNE ligne n''a été créée par ces deux refus : une seule copie existe, celle de la '
	'section 5');

-- --- 6.2 `workflow_not_found` : et la règle de discrétion ---------------------------------------
-- docs/JOURNAL.md, décision 82. Le workflow d'un autre workspace rend « introuvable » et non
-- « interdit » : répondre « interdit » confirmerait son existence à qui n'a pas le droit de le
-- savoir. La ligne du workspace B est d'abord constatée présente, sans quoi « introuvable » serait
-- vrai pour la mauvaise raison.

select is(
	(select count(*)::int from public.workflows w
	  where w.id = 'c0b10000-0000-4000-8000-0000000000c4'),
	1, 'le workflow du workspace B existe bel et bien — constaté avant d''éprouver le refus');

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000a');
select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c4', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'P0001', 'workflow_not_found',
	'RÈGLE DE DISCRÉTION : un administrateur de A qui désigne un workflow de B obtient '
	'« introuvable », JAMAIS « interdit » — l''existence de la ligne ne lui est pas révélée');

select throws_ok(
	$$select public.copy_workflow_to_track(
		'00000000-0000-4000-8000-00000000ffff', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'P0001', 'workflow_not_found',
	'un identifiant inventé rend exactement le même refus, au caractère près : c''est ce qui rend '
	'la règle de discrétion effective');

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c3', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'P0001', 'workflow_not_found',
	'un workflow archivé est introuvable : on ne copie pas ce que le produit a retiré des '
	'sélecteurs');

-- --- 6.3 `workflow_not_global` : une copie ne se copie pas --------------------------------------

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c2', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'P0001', 'workflow_not_global',
	'un workflow déjà de portée `track` ne se copie pas : une chaîne de dérivations rendrait le '
	'lignage illisible (docs/JOURNAL.md, décision 85)');

-- --- 6.4 `track_not_found` ----------------------------------------------------------------------

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a3')$$,
	'P0001', 'track_not_found',
	'le track d''un AUTRE workspace est introuvable : la clé composite l''aurait refusé aussi, mais '
	'avec un message qui parle de contrainte et non de produit');

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', 'c0b10000-0000-4000-8000-0000000000a2')$$,
	'P0001', 'track_not_found', 'un track archivé également');

select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000eeee')$$,
	'P0001', 'track_not_found', 'un track inventé aussi');

reset role;

-- --- 6.5 L'ordre des vérifications est celui qui est spécifié -----------------------------------
-- Un `business_developer` qui désigne un workflow de B doit obtenir « introuvable » et non
-- « interdit » : la visibilité est vérifiée AVANT le rôle. Si l'ordre était inversé, il apprendrait
-- que le workflow existe.

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000b');
select throws_ok(
	$$select public.copy_workflow_to_track(
		'c0b10000-0000-4000-8000-0000000000c4', 'c0b10000-0000-4000-8000-0000000000a1')$$,
	'P0001', 'workflow_not_found',
	'ORDRE DES CONTRÔLES : un `business_developer` visant un workflow de B obtient '
	'« introuvable » — la visibilité passe avant le rôle, et l''ordre inverse aurait dit '
	'« interdit », donc « il existe »');
reset role;

-- =============================================================================================
-- 7. Le signal de divergence — docs/SPEC-workflow-engine.md §4.6
-- =============================================================================================

select is(
	(select count(*)::int from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	1, 'la copie apparaît dans `workflow_derivations`');

select is(
	(select source_name from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'Source globale', 'la vue nomme la source, pour que l''interface n''ait pas à la relire');

select is(
	(select source_modified_at from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	(select max(x) from (
		select updated_at from public.workflows where id = 'c0b10000-0000-4000-8000-0000000000c1'
		union all
		select n.updated_at
		  from public.workflow_steps s
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		 where s.workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
		union all
		select updated_at from public.workflow_steps
		 where workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
		union all
		select updated_at from public.workflow_transitions
		 where workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
		union all
		select updated_at from public.form_fields
		 where workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
		union all
		select updated_at from public.form_field_rules
		 where workflow_id = 'c0b10000-0000-4000-8000-0000000000c1'
	) t(x)),
	'`source_modified_at` est bien le plus récent `updated_at` disponible de la source, de son '
	'catalogue de nœuds utilisé ET de sa composition, non celui de la seule ligne du workflow');

select ok(
	(select not source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'aucune divergence tant que rien ne bouge : la source date d''hier, la copie d''aujourd''hui');

-- La copie est antidatée de douze heures — donc **après** le dernier changement de la source, qui
-- date d'un jour. Le signal reste éteint, et la modification qui suit pourra l'allumer.
--
-- MESURÉ, et c'est ce qui dicte ce détour : `now()` est constant sur toute la durée d'une
-- transaction, et le trigger `set_updated_at` écrit `now()` sans se laisser imposer autre chose.
-- Faire « avancer » la source est donc impossible ici ; reculer la copie produit exactement la même
-- situation.
update public.workflows set derived_at = now() - interval '12 hours'
 where id = (select id from pg_temp_copie);

select ok(
	(select not source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'une copie faite après le dernier changement de sa source n''affiche aucune divergence');

-- Une modification d'ÉTAPE, qui ne touche pas la ligne du workflow. C'est le cas que la vue existe
-- pour attraper : sans elle, `workflows.updated_at` seul ne verrait rien.
update public.workflow_steps set label_override = 'Modifié après la copie'
 where id = 'c0b10000-0000-4000-8000-0000000000d1';

select ok(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'une ÉTAPE de la source modifiée fait apparaître la divergence — alors que la ligne du '
	'workflow n''a pas bougé, ce qu''un `workflows.updated_at` seul aurait manqué');

select ok(
	(select source_modified_at > derived_at from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'et la date exposée est bien postérieure à la copie : l''interface a de quoi écrire '
	'« modifié depuis le … »');

-- Remise exacte de la composition : l'horodatage change, l'empreinte métier redevient identique.
update public.workflow_steps set label_override = 'Départ surchargé'
 where id = 'c0b10000-0000-4000-8000-0000000000d1';

select ok(
	(select not source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'restaurer exactement la composition éteint la divergence malgré un updated_at plus récent');

-- --- 7.1 Suppression détectée — INC-038 ---------------------------------------------------------

delete from public.workflow_transitions where id = 'c0b10000-0000-4000-8000-0000000000e3';

select ok(
	(select source_modified_since_copy from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	'INC-038 : une SUPPRESSION dans la source change l''empreinte et reste visible');

-- --- 7.2 La vue est soumise à la RLS ------------------------------------------------------------

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000c');
select is(
	(select count(*)::int from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	1, 'un `viewer` du workspace lit la ligne : lire une dérivation n''exige pas d''écrire');
reset role;

select pg_temp.endosser('c0b10000-0000-4000-8000-00000000000d');
select is(
	(select count(*)::int from public.workflow_derivations
	  where workflow_id = (select id from pg_temp_copie)),
	0,
	'PREUVE DE REFUS N° 3 : un administrateur du workspace B ne voit aucune ligne — la vue est '
	'`security_invoker`, la RLS des tables sous-jacentes s''applique bien à l''appelant');
reset role;

-- =============================================================================================
-- 8. Écarts figés par des assertions
-- =============================================================================================

-- GARDE-FOU RÉVISÉ PAR `CRM-018` : la mesure historique « sept champs source, zéro dérivé » est
-- renversée par le vrai geste de copie, sans retirer la preuve qui avait révélé l'écart.
select has_table(
	'public', 'form_fields',
	'`form_fields` existe depuis `CRM-035` — l''assertion d''absence posée ici est devenue rouge le '
	'jour prévu, et a été révisée plutôt que retirée');

-- RÉVISÉ PAR LA SOUS-TRANCHE 4d DE `CRM-060`, NON RETIRÉ (mécanisme de la décision 51,
-- docs/SPEC-contacts.md §13.6) : le seed pose deux champs de plus sur le workflow source —
-- `contact-principal` et `referent-technique` —, parce que les sélecteurs du §13 sont les premiers
-- écrans à rendre les types `contact` et `user`. La règle a changé par LIVRAISON ; ce que
-- l'assertion exige est inchangé.
select is(
	(select count(*)::int from public.form_fields
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	9,
	'INC-037 : la source du seed porte neuf champs de formulaire');

select is(
	(select count(*)::int from public.form_fields f
	   join public.workflows w on w.id = f.workflow_id
	  where w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and w.name = 'Cycle commercial — Conseil IA'),
	9,
	'INC-037 : sa copie porte les neuf champs remappés par le produit');

-- INC-039 : la suppression d'un workspace est refusée dès qu'un workflow instancie ses nœuds. Ce
-- n'est le défaut d'aucune des deux clés étrangères, correctes isolément ; c'est leur interaction,
-- que personne n'avait mesurée. L'assertion la provoque et la constate.
select throws_ok(
	$$delete from public.workspaces where id = 'c0b10000-0000-4000-8000-000000000001'$$,
	'23503', null,
	'INC-039 : supprimer un workspace échoue tant qu''un de ses workflows porte des étapes — le '
	'`on delete restrict` de `workflow_steps.node_id` bloque la cascade selon l''ordre où '
	'PostgreSQL la propage');

-- Et l'ordre qui fonctionne, pour que le contournement soit écrit et non deviné.
delete from public.workflow_steps where workspace_id = 'c0b10000-0000-4000-8000-000000000001';
select lives_ok(
	$$delete from public.workspaces where id = 'c0b10000-0000-4000-8000-000000000001'$$,
	'INC-039 : les étapes retirées d''abord, la suppression passe — c''est l''ordre que tout '
	'nettoyage doit suivre');

select * from finish();
rollback;

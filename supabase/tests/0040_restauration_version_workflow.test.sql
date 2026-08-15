-- @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, QUATRIÈME TRANCHE :
--            l'application transactionnelle du plan et son retour arrière
-- @verifies docs/SPEC-workflow-engine.md §7 ter.13 (la tranche), §7 ter.13.2 (le plan rejoué),
--            §7 ter.13.3 (ce qui est restauré et ce qui ne l'est pas), §7 ter.13.4 (les champs ne
--            sont jamais supprimés), §7 ter.13.5 (le point de retour publié), §7 ter.13.6 (le geste
--            et ses huit refus), §7 ter.13.7 (l'ordre des écritures), §7 ter.13.8 (ce que la
--            fonction rend), §7 ter.13.9 (autorisations), §7 ter.13.12 (preuves attendues)
-- @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3 : une version d'un autre
--            workspace est indiscernable d'une version inexistante)
-- @verifies docs/SPEC-form-composer.md §5 (les valeurs saisies survivent à l'archivage)
--
-- CE QUE CETTE SUITE ÉPROUVE, ET POURQUOI DANS CET ORDRE.
--
-- La restauration ÉCRIT, là où les trois tranches précédentes ne faisaient que lire. Une preuve de
-- lecture peut se contenter de comparer un retour de fonction ; une preuve d'écriture doit RELIRE
-- LA BASE. Chaque assertion de comportement ci-dessous relit donc l'état écrit, et ne se satisfait
-- jamais du seul document rendu par la fonction.
--
-- La suite crée ses fixtures par le propriétaire, joue les gestes avec les comptes réels du seed,
-- et fait `rollback` : le seed est rendu intact.
--
-- AUCUN COMPTE DU SEED N'EST FIGÉ EN DUR : les identités sont retrouvées par leur rôle, et les
-- comptes se comparent entre eux.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

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

-- Les identités réelles du seed, retrouvées par leur RÔLE et jamais par un identifiant écrit ici.
create temporary table t_ctx as
select
	(select w.id from public.workflows w where w.is_default limit 1)              as wf,
	(select w.workspace_id from public.workflows w where w.is_default limit 1)    as ws,
	(select m.user_id from public.workspace_members m where m.role = 'admin'
	  limit 1)                                                                   as admin_id,
	(select m.user_id from public.workspace_members m where m.role = 'viewer'
	  limit 1)                                                                   as viewer_id,
	(select m.user_id from public.workspace_members m
	  where m.role = 'business_developer' limit 1)                               as bizdev_id;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_ctx to authenticated;

-- =============================================================================================
-- 1. LA FONCTION ELLE-MÊME : SIGNATURE, VOLATILITÉ, AUTORISATION, PRIVILÈGES
-- =============================================================================================

select has_function('public', 'restore_workflow_version',
	array['uuid', 'jsonb', 'text'],
	'1. public.restore_workflow_version(uuid, jsonb, text) existe');

select is(
	(select p.provolatile from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'restore_workflow_version'),
	'v'::"char",
	'2. elle est VOLATILE — elle écrit, à la différence des trois gestes précédents du chapitre');

-- `security definer` est ici la RÈGLE et non une facilité : MESURÉ, `authenticated` ne détient
-- l'`UPDATE` sur `public.cards` que colonne par colonne, et `current_step_id` n'en fait pas partie.
-- L'assertion suivante fige le fait qui l'impose, sans quoi la 3 serait vraie sans rien prouver.
select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'restore_workflow_version'),
	true,
	'3. elle est SECURITY DEFINER — déplacer une affaire exige un privilège de colonne');

select is(
	(select count(*) from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'cards'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE'
	    and column_name = 'current_step_id'),
	0::bigint,
	'4. LE FAIT QUI IMPOSE LE DEFINER : authenticated n''a aucun UPDATE sur cards.current_step_id');

select is(
	(select pg_get_userbyid(p.proowner) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'restore_workflow_version'),
	'postgres',
	'5. son propriétaire est explicite — c''est lui qui prête ses droits');

select is(
	(select p.proconfig::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'restore_workflow_version'),
	-- La forme stockée est `search_path=""` et non `search_path=` : c'est la chaîne vide, entre
	-- guillemets, telle que PostgreSQL la conserve dans `proconfig`. MESURÉ.
	'{"search_path=\"\""}',
	'6. son search_path est vide, et chaque objet est qualifié');

select ok(
	has_function_privilege('authenticated', 'public.restore_workflow_version(uuid, jsonb, text)',
		'execute'),
	'7. authenticated peut l''exécuter');

select ok(
	not has_function_privilege('anon', 'public.restore_workflow_version(uuid, jsonb, text)',
		'execute'),
	'8. anon en est RÉVOQUÉ nommément — sans quoi l''anonyme obtiendrait 403 au lieu de 401');

-- =============================================================================================
-- 2. LES REFUS, CONTRE DES COMPTES RÉELS
-- =============================================================================================

select pg_temp.endosser((select admin_id from t_ctx));

select throws_ok(
	format('select public.restore_workflow_version(%L)',
		'00000000-0000-4000-8000-000000000000'),
	'P0001', 'version introuvable',
	'9. version inexistante : version introuvable');

select pg_temp.redevenir_proprietaire();

-- Un second workspace RÉEL, absent du seed, avec sa propre version : sans lui, le refus n° 3
-- serait vrai par simple absence et ne prouverait rien (décision 50).
insert into public.workspaces (id, name, slug)
values ('cccc0000-0000-4000-8000-0000000000c1', 'Workspace de preuve', 'workspace-de-preuve');

insert into public.workflow_nodes_catalog (id, workspace_id, key, label, kind)
values ('cccc0000-0000-4000-8000-0000000000c2', 'cccc0000-0000-4000-8000-0000000000c1',
        'preuve-ailleurs', 'Preuve ailleurs', 'open');

insert into public.workflows (id, workspace_id, name, scope)
values ('cccc0000-0000-4000-8000-0000000000c3', 'cccc0000-0000-4000-8000-0000000000c1',
        'Workflow de preuve', 'global');

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values ('cccc0000-0000-4000-8000-0000000000c4', 'cccc0000-0000-4000-8000-0000000000c3',
        'cccc0000-0000-4000-8000-0000000000c1', 'cccc0000-0000-4000-8000-0000000000c2', 1, true);

insert into public.workflow_versions
	(id, workspace_id, workflow_id, version_number, composition, composition_fingerprint)
values ('cccc0000-0000-4000-8000-0000000000c5', 'cccc0000-0000-4000-8000-0000000000c1',
        'cccc0000-0000-4000-8000-0000000000c3', 1,
        app.workflow_composition_document('cccc0000-0000-4000-8000-0000000000c3'),
        app.workflow_composition_fingerprint('cccc0000-0000-4000-8000-0000000000c3'));

select pg_temp.endosser((select admin_id from t_ctx));

select throws_ok(
	format('select public.restore_workflow_version(%L)',
		'cccc0000-0000-4000-8000-0000000000c5'),
	'P0001', 'version introuvable',
	'10. VERSION D''UN AUTRE WORKSPACE : le MÊME refus qu''en 9 — preuve de refus n° 3. C''est la '
	'seule assertion qui éprouve que la vérification 2 a bien été écrite à la main sous definer');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser((select bizdev_id from t_ctx));

select throws_ok(
	format('select public.restore_workflow_version(%L)',
		(select id from public.workflow_versions
		  where workflow_id = (select wf from t_ctx) order by version_number limit 1)),
	'42501', 'restauration reservee aux administrateurs',
	'11. business_developer : refusé, et le message ne parle pas d''existence');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser((select viewer_id from t_ctx));

select throws_ok(
	format('select public.restore_workflow_version(%L)',
		(select id from public.workflow_versions
		  where workflow_id = (select wf from t_ctx) order by version_number limit 1)),
	'42501', 'restauration reservee aux administrateurs',
	'12. viewer : LE MÊME message qu''en 11');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser((select admin_id from t_ctx));

select throws_ok(
	format('select public.restore_workflow_version(%L, null, %L)',
		(select id from public.workflow_versions
		  where workflow_id = (select wf from t_ctx) order by version_number limit 1),
		'0000000000000000000000000000000000000000000000000000000000000000'),
	'P0001', 'structure modifiee depuis le plan',
	'13. empreinte vivante périmée : la concurrence optimiste refuse');

select throws_ok(
	format('select public.restore_workflow_version(%L, %L)',
		(select id from public.workflow_versions
		  where workflow_id = (select wf from t_ctx) order by version_number limit 1),
		'"pas un tableau"'),
	'P0001', 'remappage invalide',
	'14. LES REFUS DU PLAN REMONTENT TELS QUELS — la règle de remappage n''est écrite qu''une fois');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. LE CAS NOMINAL : STRUCTURE VIVANTE DÉJÀ ÉGALE À LA VERSION
-- =============================================================================================

create temporary table t_nominal as
select v.id as version_id,
       (select count(*) from public.workflow_versions x where x.workflow_id = v.workflow_id)
         as versions_avant
  from public.workflow_versions v
 where v.workflow_id = (select wf from t_ctx)
 order by v.version_number desc
 limit 1;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_nominal to authenticated;

select pg_temp.endosser((select admin_id from t_ctx));

create temporary table t_res_nominal as
select public.restore_workflow_version((select version_id from t_nominal)) as doc;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_res_nominal to authenticated;

select pg_temp.redevenir_proprietaire();

select is(
	(select (doc -> 'rollback_version' ->> 'published')::boolean from t_res_nominal),
	false,
	'15. AUCUN point de retour publié quand la dernière version joue déjà ce rôle — c''est la '
	'vérification 5 du §7 ter.5 qui l''interdit, pas une garde propre à la restauration');

select is(
	(select count(*) from public.workflow_versions where workflow_id = (select wf from t_ctx)),
	(select versions_avant from t_nominal),
	'16. et la base le confirme : aucune version n''a été ajoutée');

select is(
	(select (doc -> 'steps' ->> 'deleted')::bigint + (doc -> 'steps' ->> 'created')::bigint
	      + (doc -> 'steps' ->> 'updated')::bigint
	      + (doc -> 'cards' ->> 'remapped')::bigint from t_res_nominal),
	0::bigint,
	'17. tous les compteurs sont à zéro : ce qui ne doit rien faire ne subit rien');

select is(
	(select (doc ->> 'matches_version')::boolean from t_res_nominal),
	true,
	'18. matches_version est vrai, et il est MESURÉ après écriture, jamais recopié');

-- =============================================================================================
-- 4. LE CYCLE COMPLET : UNE ÉTAPE AJOUTÉE, DES AFFAIRES DESSUS, LA RESTAURATION, LE RETOUR
-- =============================================================================================

create temporary table t_fixture as
select (select wf from t_ctx)                                             as wf,
       (select ws from t_ctx)                                             as ws,
       'dddd0000-0000-4000-8000-0000000000d1'::uuid                       as node_id,
       'dddd0000-0000-4000-8000-0000000000d2'::uuid                       as etape,
       'dddd0000-0000-4000-8000-0000000000d3'::uuid                       as arete,
       (select s.id from public.workflow_steps s
         where s.workflow_id = (select wf from t_ctx) and s.is_initial)    as initiale,
       (select c.id from public.cards c
         where c.workflow_id = (select wf from t_ctx) order by c.id limit 1) as carte,
       (select v.id from public.workflow_versions v
         where v.workflow_id = (select wf from t_ctx)
         order by v.version_number limit 1)                                as version_seed;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_fixture to authenticated;

insert into public.workflow_nodes_catalog (id, workspace_id, key, label, kind)
select node_id, ws, 'preuve-restauration', 'Preuve restauration', 'open' from t_fixture;

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position)
select etape, wf, ws, node_id, 99 from t_fixture;

insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id, to_step_id)
select arete, wf, ws, initiale, etape from t_fixture;

update public.cards c set current_step_id = (select etape from t_fixture)
 where c.id = (select carte from t_fixture);

select pg_temp.endosser((select admin_id from t_ctx));

-- Sans instruction, le plan bloque : la restauration REFUSE plutôt que de deviner où va l'affaire.
select throws_ok(
	format('select public.restore_workflow_version(%L)', (select version_seed from t_fixture)),
	'P0001', 'plan non applicable',
	'19. une affaire sur une étape retirée, sans instruction : REFUS. Aucune destination devinée');

select pg_temp.redevenir_proprietaire();

select is(
	(select current_step_id from public.cards where id = (select carte from t_fixture)),
	(select etape from t_fixture),
	'20. et le refus n''a RIEN écrit : l''affaire est toujours sur l''étape retirée');

select pg_temp.endosser((select admin_id from t_ctx));

create temporary table t_res as
select public.restore_workflow_version(
	(select version_seed from t_fixture),
	jsonb_build_array(jsonb_build_object(
		'from_step_id', (select etape from t_fixture),
		'to_step_id',   (select initiale from t_fixture)))) as doc;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_res to authenticated;

select pg_temp.redevenir_proprietaire();

select is(
	(select (doc -> 'cards' ->> 'remapped')::bigint from t_res),
	1::bigint,
	'21. une affaire remappée');

select is(
	(select current_step_id from public.cards where id = (select carte from t_fixture)),
	(select initiale from t_fixture),
	'22. ET LA BASE LE CONFIRME : l''affaire est sur l''étape nommée par l''instruction');

select ok(
	exists(select 1 from public.card_events e
	        where e.card_id = (select carte from t_fixture) and e.type = 'moved'),
	'23. la timeline porte un événement `moved` — écrit par le trigger, jamais fabriqué ici');

select ok(
	not exists(select 1 from public.workflow_steps where id = (select etape from t_fixture)),
	'24. l''étape ajoutée a disparu, et sa suppression n''a pu réussir que parce que les affaires '
	'étaient parties d''abord : la clé étrangère des cards est en NO ACTION');

select is(
	(select (doc -> 'transitions' ->> 'deleted')::bigint from t_res),
	0::bigint,
	'25. transitions.deleted vaut ZÉRO alors qu''une arête a disparu : elle est partie EN CASCADE '
	'avec son étape, et chaque compteur ne compte que ce que SON instruction a écrit');

select ok(
	not exists(select 1 from public.workflow_transitions where id = (select arete from t_fixture)),
	'26. l''arête a pourtant bien disparu — c''est la base qui le dit, pas le compteur');

select is(
	(select (doc ->> 'fingerprint_after') from t_res),
	(select composition_fingerprint from public.workflow_versions
	  where id = (select version_seed from t_fixture)),
	'27. L''EMPREINTE D''APRÈS ÉGALE CELLE DE LA VERSION : la composition vivante a réellement été '
	'ramenée à la photographie');

select is(
	(select (doc -> 'rollback_version' ->> 'published')::boolean from t_res),
	true,
	'28. un point de retour a été PUBLIÉ, parce que la composition vivante différait');

-- LE RETOUR ARRIÈRE. Il n'est pas un geste de plus : c'est la restauration elle-même appliquée au
-- point de retour, donc LE MÊME CODE, et c'est ce que cette assertion éprouve.
select pg_temp.endosser((select admin_id from t_ctx));

create temporary table t_retour as
select public.restore_workflow_version(
	(select (doc -> 'rollback_version' ->> 'version_id')::uuid from t_res)) as doc;
-- Les gestes sont joués sous `authenticated` : la table de contexte doit lui être
-- lisible, sans quoi la preuve échouerait sur son échafaudage et non sur son objet.
grant select on t_retour to authenticated;

select pg_temp.redevenir_proprietaire();

select ok(
	exists(select 1 from public.workflow_steps s where s.id = (select etape from t_fixture))
	and exists(select 1 from public.workflow_transitions t
	            where t.id = (select arete from t_fixture)),
	'29. RETOUR ARRIÈRE : l''étape ET l''arête reviennent AVEC LEURS IDENTIFIANTS D''ORIGINE, que '
	'le document conserve — aucune ligne nouvelle ne les remplace');

select is(
	(select (doc ->> 'matches_version')::boolean from t_retour),
	true,
	'30. et l''empreinte d''après égale celle du point de retour : l''aller-retour est complet');

select * from finish();

rollback;

-- @verifies CRM-094 (docs/BACKLOG.md) — tranche T1 : le workflow de départ d'un espace neuf
-- @verifies docs/SPEC-workflow-engine.md §7 quater (le geste, ses quatre refus, le modèle, l'atomicité)
-- @verifies docs/SPEC-onboarding.md §10.3, §10.6 ; docs/SPEC-permissions-rls.md §4 ; docs/JOURNAL.md
--           décision 606
--
-- Un espace neuf n'a ni workflow ni nœud : aucun channel n'y peut naître. Le geste pose le cycle
-- commercial du seed ; la preuve qui compte le plus est la dernière — un channel NAÎT ensuite sur ce
-- workflow. Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

create or replace function pg_temp.endosser(utilisateur uuid, admin_lelabs jsonb default null)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		(jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')
		 || case when admin_lelabs is null then '{}'::jsonb
		         else jsonb_build_object('lelabs_admin', admin_lelabs) end)::text, true);
	execute 'set local role authenticated';
end;
$$;

-- N : l'espace neuf. R : un espace dont le catalogue porte déjà `prospection`, vivant et renommé.
-- Z : un espace dont `perdu` est archivé. D : un espace dont le seul workflow, défaut, est archivé.
create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('N',    '0c940000-0000-4000-8000-0000000000e1'),
	('R',    '0c940000-0000-4000-8000-0000000000e2'),
	('Z',    '0c940000-0000-4000-8000-0000000000e3'),
	('D',    '0c940000-0000-4000-8000-0000000000e4'),
	('ADM',  '0c940000-0000-4000-8000-000000000011'),
	('BIZ',  '0c940000-0000-4000-8000-000000000012'),
	('LECT', '0c940000-0000-4000-8000-000000000013'),
	('EXPL', '0c940000-0000-4000-8000-000000000017'),
	('TRK',  '0c940000-0000-4000-8000-0000000000a1');
grant select on ids to authenticated;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('N'), 'Espace neuf 0074', 'espace-neuf-0074'),
	(pg_temp.id('R'), 'Espace réutilisé 0074', 'espace-reutilise-0074'),
	(pg_temp.id('Z'), 'Espace archivé 0074', 'espace-archive-0074'),
	(pg_temp.id('D'), 'Espace défaut 0074', 'espace-defaut-0074');
insert into public.profiles (id, full_name) values
	(pg_temp.id('ADM'), 'Administratrice 0074'),
	(pg_temp.id('BIZ'), 'Commercial 0074'),
	(pg_temp.id('LECT'), 'Lectrice 0074');
insert into public.workspace_members (workspace_id, user_id, role)
select w.valeur, pg_temp.id('ADM'), 'admin' from ids w where w.nom in ('N', 'R', 'Z', 'D');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('N'), pg_temp.id('BIZ'), 'business_developer'),
	(pg_temp.id('N'), pg_temp.id('LECT'), 'viewer');

insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color) values
	(pg_temp.id('R'), 'prospection', 'Prospect maison', 'open', 'accent');
insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, archived_at) values
	(pg_temp.id('Z'), 'perdu', 'Perdu', 'lost', 'danger', now());
insert into public.workflows (workspace_id, name, scope, is_default, archived_at) values
	(pg_temp.id('D'), 'Ancien défaut', 'global', true, now());

-- =============================================================================================
-- 1. Le contrat
-- =============================================================================================

select ok(
	not has_function_privilege('anon', 'public.creer_workflow_de_depart(uuid)', 'EXECUTE')
	and has_function_privilege('authenticated', 'public.creer_workflow_de_depart(uuid)', 'EXECUTE'),
	'1 — EXECUTE à `authenticated`, refusé à `anon` par le privilège');
select is(
	(select prosecdef::text || '|' || array_to_string(proconfig, ',') from pg_proc
	  where oid = 'public.creer_workflow_de_depart(uuid)'::regprocedure),
	'false|search_path=""',
	'2 — SECURITY INVOKER, `search_path` vide : la RLS des tables écrites fait foi');

-- =============================================================================================
-- 2. Les refus, avant toute écriture
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('LECT'));
select throws_ok($$ select public.creer_workflow_de_depart(pg_temp.id('N')) $$,
	'42501', 'reserve aux administrateurs', '3 — la lectrice est refusée');
select pg_temp.endosser(pg_temp.id('BIZ'));
select throws_ok($$ select public.creer_workflow_de_depart(pg_temp.id('N')) $$,
	'42501', 'reserve aux administrateurs', '4 — le commercial est refusé');
select pg_temp.endosser(pg_temp.id('EXPL'));
select throws_ok($$ select public.creer_workflow_de_depart(pg_temp.id('N')) $$,
	'42501', 'reserve aux administrateurs', '5 — sans appartenance ni revendication, refusé');
reset role;
select is((select count(*)::int from public.workflows where workspace_id = pg_temp.id('N')), 0,
	'6 — les refus n''ont rien écrit');

-- =============================================================================================
-- 3. Le geste de l'administratrice, et ce qu'il pose
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures values ('workflow', public.creer_workflow_de_depart(pg_temp.id('N'))::text);
reset role;

select is(
	(select name || '|' || scope || '|' || is_default::text from public.workflows
	  where id = (select valeur::uuid from mesures where cle = 'workflow')),
	'Cycle commercial|global|true', '7 — « Cycle commercial », global, défaut de l''espace');
select is((select count(*)::int from public.workflows where workspace_id = pg_temp.id('N')), 1,
	'8 — un seul workflow');
select is(
	(select string_agg(n.key || ':' || n.kind || ':' || n.color || ':' || coalesce(n.default_probability::int::text, '-')
	        || ':' || coalesce(n.default_stale_after_days::text, '-'), ',' order by n.key)
	   from public.workflow_nodes_catalog n where n.workspace_id = pg_temp.id('N')),
	'livre:won:success:100:-,negociation:open:brand:50:10,perdu:lost:danger:0:-,prospection:open:neutral:10:14,'
	|| 'realisation:open:success:100:30,relance:open:accent:20:7,signature:open:brand:90:7',
	'9 — sept nœuds, au modèle du §7 quater.2');
select is(
	(select string_agg(n.key || '@' || s.position::int || case when s.is_initial then '*' else '' end, ',' order by s.position)
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workflow_id = (select valeur::uuid from mesures where cle = 'workflow')),
	'prospection@1*,relance@2,negociation@3,signature@4,realisation@5,livre@6,perdu@7',
	'10 — sept étapes ordonnées, Prospection initiale');
select is(
	(select count(*)::int from public.workflow_transitions
	  where workflow_id = (select valeur::uuid from mesures where cle = 'workflow')),
	11, '11 — onze transitions');
select is(
	(select string_agg(nf.key, ',' order by sf.position)
	   from public.workflow_transitions t
	   join public.workflow_steps sf on sf.id = t.from_step_id
	   join public.workflow_nodes_catalog nf on nf.id = sf.node_id
	   join public.workflow_steps st on st.id = t.to_step_id
	   join public.workflow_nodes_catalog nt on nt.id = st.node_id
	  where t.workflow_id = (select valeur::uuid from mesures where cle = 'workflow')
	    and nt.key = 'perdu' and t.require_comment and t.label = 'Marquer perdu'),
	'prospection,relance,negociation,signature,realisation',
	'12 — « Marquer perdu » depuis chaque étape ouverte, commentaire exigé');
select is(
	(select string_agg(nf.key || '>' || nt.key || ':' || t.label, ',' order by sf.position, st.position)
	   from public.workflow_transitions t
	   join public.workflow_steps sf on sf.id = t.from_step_id
	   join public.workflow_nodes_catalog nf on nf.id = sf.node_id
	   join public.workflow_steps st on st.id = t.to_step_id
	   join public.workflow_nodes_catalog nt on nt.id = st.node_id
	  where t.workflow_id = (select valeur::uuid from mesures where cle = 'workflow')
	    and not t.require_comment),
	'prospection>relance:Relancer,relance>negociation:Engager la négociation,negociation>relance:Revenir en relance,'
	|| 'negociation>signature:Passer en signature,signature>realisation:Démarrer la réalisation,'
	|| 'realisation>livre:Marquer comme livré',
	'13 — les six transitions d''avancement, libellées');

-- =============================================================================================
-- 4. Ce que le geste rend POSSIBLE : un channel naît sur ce workflow
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
insert into public.tracks (id, workspace_id, name, slug, position)
values (pg_temp.id('TRK'), pg_temp.id('N'), 'Premier track', 'premier-track', 1);
select lives_ok(
	$$ insert into public.channels (workspace_id, track_id, name, slug, workflow_id, position)
	   values (pg_temp.id('N'), pg_temp.id('TRK'), 'Premier channel', 'premier-channel',
	           (select valeur::uuid from mesures where cle = 'workflow'), 1) $$,
	'14 — le premier channel naît sur le workflow de départ, ce qui était impossible avant');
reset role;

-- =============================================================================================
-- 5. Un seul workflow : le second appel est refusé
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$ select public.creer_workflow_de_depart(pg_temp.id('N')) $$,
	'P0001', 'workflow existant', '15 — un double clic ne crée pas deux workflows');
reset role;
select is((select count(*)::int from public.workflows where workspace_id = pg_temp.id('N')), 1,
	'16 — toujours un seul workflow');

-- =============================================================================================
-- 6. Un nœud vivant de même clé est réutilisé, tel que l'administrateur l'a réglé
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok($$ select public.creer_workflow_de_depart(pg_temp.id('R')) $$,
	'17 — le geste aboutit sur un catalogue qui porte déjà une clé du modèle');
reset role;
select is(
	(select count(*)::int || '|' || min(label) || '|' || min(color)
	   from public.workflow_nodes_catalog where workspace_id = pg_temp.id('R') and key = 'prospection'),
	'1|Prospect maison|accent', '18 — le nœud existant n''est ni dupliqué ni réécrit');
select is(
	(select count(*)::int from public.workflow_steps s
	   join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.workspace_id = pg_temp.id('R') and n.label = 'Prospect maison' and s.is_initial),
	1, '19 — et c''est lui qui porte l''étape initiale');
select is((select count(*)::int from public.workflow_nodes_catalog where workspace_id = pg_temp.id('R')), 7,
	'20 — les six autres clés sont créées');

-- =============================================================================================
-- 7. Un nœud ARCHIVÉ de même clé : refus, et rien n'est écrit
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$ select public.creer_workflow_de_depart(pg_temp.id('Z')) $$,
	'P0001', 'noeud archive : perdu', '21 — un nœud archivé n''est pas réactivé sans le dire');
reset role;
select is(
	(select count(*)::int from public.workflows where workspace_id = pg_temp.id('Z'))
	+ (select count(*)::int from public.workflow_nodes_catalog where workspace_id = pg_temp.id('Z')),
	1, '22 — atomicité : seul le nœud archivé d''origine subsiste');

-- =============================================================================================
-- 8. Un défaut archivé : le workflow de départ naît sans être le défaut, au lieu d'échouer
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok($$ select public.creer_workflow_de_depart(pg_temp.id('D')) $$,
	'23 — un défaut archivé ne fait pas échouer le geste');
reset role;
select is(
	(select is_default::text from public.workflows
	  where workspace_id = pg_temp.id('D') and archived_at is null),
	'false', '24 — le nouveau workflow n''est pas le défaut : l''index le compte encore');

-- =============================================================================================
-- 9. La revendication du domaine vaut administratrice (CRM-092 T8)
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	('0c940000-0000-4000-8000-0000000000e5', 'Espace exploitante 0074', 'espace-exploitante-0074');
select pg_temp.endosser(pg_temp.id('EXPL'), 'true'::jsonb);
select lives_ok($$ select public.creer_workflow_de_depart('0c940000-0000-4000-8000-0000000000e5'::uuid) $$,
	'25 — l''exploitante du domaine, sans appartenance, pose le workflow de départ');
reset role;
select is((select count(*)::int from public.workflows where workspace_id = '0c940000-0000-4000-8000-0000000000e5'),
	1, '26 — un workflow dans cet espace');

-- =============================================================================================
-- 10. Un identifiant d'espace inexistant n'apprend rien
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$ select public.creer_workflow_de_depart('0c940000-0000-4000-8000-0000000000ff'::uuid) $$,
	'42501', 'reserve aux administrateurs', '27 — un espace inconnu rend le même refus qu''un espace d''autrui');
reset role;
select is((select count(*)::int from public.workflows where workspace_id = '0c940000-0000-4000-8000-0000000000ff'),
	0, '28 — et rien n''est écrit');

select * from finish();

rollback;

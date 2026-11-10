-- @verifies CRM-133 (docs/BACKLOG.md) — tranche T1 : la description d'un nœud du catalogue et sa surcharge par l'étape —
--           contraintes, repli sur le nœud, document de composition (la clé seulement si posée, l'empreinte d'avant gardée),
--           copie, comparaisons, restauration, suggestion de l'assistant acceptée, audit nommé, droits d'écriture et de
--           lecture sous la RLS
-- @verifies docs/SPEC-workflow-engine.md §7 sexies.1, §7 sexies.2, §7 sexies.3 ; docs/SCHEMA.md « Migration `0174` » ;
--           docs/SPEC-audit.md §5 ; docs/JOURNAL.md décisions 869, 870 et 882
--
-- Le workflow « Cycle commercial standard » (`…0051`), son étape « Négociation » (`…0063`, nœud `…0043`), le track
-- « Formation » (`…0023`) et les membres (`…0011` admin, `…0012` business_developer, `…0013` viewer) sont du seed. Les
-- preuves posent elles-mêmes leurs descriptions, après avoir retiré celles du seed : elles ne dépendent pas de lui. Le
-- `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.etape(document jsonb, etape uuid) returns jsonb language sql as $$
	select e from jsonb_array_elements(document -> 'steps') e where e ->> 'id' = etape::text
$$;

-- Les descriptions du seed (`docs/SPEC-seed.md`) sont retirées : chaque preuve part de deux colonnes nulles.
update public.workflow_steps set description_override = null where workspace_id = '5eed0000-0000-4000-8000-000000000001';
update public.workflow_nodes_catalog set description = null where workspace_id = '5eed0000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------------------------------------------------------------
-- Le modèle (§7 sexies.1)
-- ------------------------------------------------------------------------------------------------------------------
select has_column('public', 'workflow_nodes_catalog', 'description', '1 — le nœud porte une description');
select has_column('public', 'workflow_steps', 'description_override', '2 — l''étape porte une surcharge de description');

select throws_ok(
	$$ update public.workflow_nodes_catalog set description = '   ' where id = '5eed0000-0000-4000-8000-000000000043' $$,
	'23514', null, '3 — une description blanche du nœud est refusée : vide n''est pas une valeur');
select throws_ok(
	$$ update public.workflow_steps set description_override = '' where id = '5eed0000-0000-4000-8000-000000000063' $$,
	'23514', null, '4 — une surcharge vide est refusée, comme `label_override`');

create temp table pg_temp.empreinte_avant as
	select app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051') as e;

update public.workflow_nodes_catalog set description = 'Le client a reçu une proposition chiffrée.'
 where id = '5eed0000-0000-4000-8000-000000000043';

select is(
	(select coalesce(s.description_override, n.description)
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.id = '5eed0000-0000-4000-8000-000000000063'),
	'Le client a reçu une proposition chiffrée.',
	'5 — sans surcharge, l''étape rend la description de son nœud');

-- ------------------------------------------------------------------------------------------------------------------
-- Le document de composition (§7 sexies.3) : la description du nœud n'y entre pas, la surcharge seulement si posée.
-- ------------------------------------------------------------------------------------------------------------------
select ok(
	not (pg_temp.etape(app.workflow_composition_document('5eed0000-0000-4000-8000-000000000051'),
	                   '5eed0000-0000-4000-8000-000000000063') ? 'description_override'),
	'6 — sans surcharge, l''étape du document n''a pas la clé');
select is(app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051'),
	(select e from pg_temp.empreinte_avant),
	'7 — la description du nœud ne change pas l''empreinte : le catalogue n''est pas versionné');

update public.workflow_steps set description_override = 'Proposition envoyée, en attente du retour du client.'
 where id = '5eed0000-0000-4000-8000-000000000063';

select is(
	(select coalesce(s.description_override, n.description)
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.id = '5eed0000-0000-4000-8000-000000000063'),
	'Proposition envoyée, en attente du retour du client.',
	'8 — posée, la surcharge prime sur la description du nœud');
select is(
	pg_temp.etape(app.workflow_composition_document('5eed0000-0000-4000-8000-000000000051'),
	              '5eed0000-0000-4000-8000-000000000063') ->> 'description_override',
	'Proposition envoyée, en attente du retour du client.',
	'9 — posée, la surcharge entre dans le document');
select isnt(app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051'),
	(select e from pg_temp.empreinte_avant),
	'10 — posée, elle change l''empreinte : le workflow est modifié depuis sa version');

-- ------------------------------------------------------------------------------------------------------------------
-- Les versions : la comparaison la nomme, la restauration la rétablit.
-- ------------------------------------------------------------------------------------------------------------------
create temp table pg_temp.base as
	select id from public.workflow_versions
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number desc limit 1;
grant select on pg_temp.base to authenticated;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.publish_workflow_version('5eed0000-0000-4000-8000-000000000051', 'preuve CRM-133');
reset role;
create temp table pg_temp.cible as
	select id from public.workflow_versions
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number desc limit 1;
grant select on pg_temp.cible to authenticated;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.comparaison as
	select public.compare_workflow_versions((select id from pg_temp.base), (select id from pg_temp.cible)) as c;
reset role;
select is((select c -> 'summary' from pg_temp.comparaison), '{"added": 0, "removed": 0, "modified": 1}'::jsonb,
	'11 — la version qui ne diffère que par la surcharge compte UNE étape modifiée');
select is(
	(select c -> 'changes' -> 'steps' -> 'modified' -> 0 -> 'attributes' from pg_temp.comparaison),
	jsonb_build_array(jsonb_build_object('name', 'description_override', 'before', null,
		'after', 'Proposition envoyée, en attente du retour du client.')),
	'12 — l''attribut modifié est la surcharge, absente avant');

-- Restaurer la version d'avant la surcharge la remet à `NULL` ; restaurer la nouvelle la rétablit.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.restore_workflow_version((select id from pg_temp.base));
reset role;
select is((select description_override from public.workflow_steps where id = '5eed0000-0000-4000-8000-000000000063'),
	null, '13 — une version sans la clé rétablit la surcharge à NULL');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.restore_workflow_version((select id from pg_temp.cible));
reset role;
select is((select description_override from public.workflow_steps where id = '5eed0000-0000-4000-8000-000000000063'),
	'Proposition envoyée, en attente du retour du client.',
	'14 — la version qui la porte la rétablit');

-- ------------------------------------------------------------------------------------------------------------------
-- La copie vers un track, et la comparaison à la source.
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.copie as
	select public.copy_workflow_to_track('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000023',
	                                     'Copie de preuve CRM-133') as id;
reset role;
grant select on pg_temp.copie to authenticated;
select is(
	(select s.description_override from public.workflow_steps s
	  where s.workflow_id = (select id from pg_temp.copie) and s.node_id = '5eed0000-0000-4000-8000-000000000043'),
	'Proposition envoyée, en attente du retour du client.',
	'15 — la copie porte la surcharge');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select ok((public.compare_workflow_with_source((select id from pg_temp.copie)) ->> 'identical')::boolean,
	'16 — la copie qui garde la surcharge est identique à sa source');
reset role;
update public.workflow_steps set description_override = null
 where workflow_id = (select id from pg_temp.copie) and node_id = '5eed0000-0000-4000-8000-000000000043';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.divergence as select public.compare_workflow_with_source((select id from pg_temp.copie)) as c;
reset role;
select is((select c -> 'summary' from pg_temp.divergence), '{"added": 0, "removed": 0, "modified": 1}'::jsonb,
	'17 — retirée de la copie, la surcharge se lit comme une étape modifiée par rapport à la source');

-- ------------------------------------------------------------------------------------------------------------------
-- La suggestion de l'assistant acceptée garde la surcharge (décision 882).
-- ------------------------------------------------------------------------------------------------------------------
create temp table pg_temp.document_ia as
	select app.document_cible_ia('5eed0000-0000-4000-8000-000000000051',
	                             public.proposition_du_workflow('5eed0000-0000-4000-8000-000000000051')) as d;
select is(pg_temp.etape((select d from pg_temp.document_ia), '5eed0000-0000-4000-8000-000000000063') ->> 'description_override',
	'Proposition envoyée, en attente du retour du client.',
	'18 — le document cible de l''assistant reprend la surcharge vivante de l''étape gardée');
select lives_ok(
	$$ select app.appliquer_composition('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
	                                    (select d from pg_temp.document_ia), null) $$,
	'19 — le document cible s''applique');
select is((select description_override from public.workflow_steps where id = '5eed0000-0000-4000-8000-000000000063'),
	'Proposition envoyée, en attente du retour du client.',
	'20 — appliquée, la suggestion laisse la surcharge en place');

-- ------------------------------------------------------------------------------------------------------------------
-- Le journal d'audit : la colonne nommée, sa valeur jamais recopiée.
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.workflow_steps set description_override = 'Une prose qui ne doit pas entrer au journal.'
 where id = '5eed0000-0000-4000-8000-000000000063';
reset role;
select ok(
	exists (select 1 from public.audit_log
	         where entity_type = 'workflow_step' and entity_id = '5eed0000-0000-4000-8000-000000000063'
	           and details = '{"changed": ["description_override"]}'::jsonb)
	and not exists (select 1 from public.audit_log where details::text like '%Une prose qui ne doit pas%'),
	'21 — l''audit nomme la surcharge changée, sans jamais en recopier la valeur');

-- ------------------------------------------------------------------------------------------------------------------
-- Les droits (§7 sexies.2) : écrire est réservé aux administrateurs, lire est permis aux membres.
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
update public.workflow_steps set description_override = 'Écrite par un business developer'
 where id = '5eed0000-0000-4000-8000-000000000063';
update public.workflow_nodes_catalog set description = 'Écrite par un business developer'
 where id = '5eed0000-0000-4000-8000-000000000043';
reset role;
select is(
	(select array[s.description_override, n.description]
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.id = '5eed0000-0000-4000-8000-000000000063'),
	array['Une prose qui ne doit pas entrer au journal.', 'Le client a reçu une proposition chiffrée.'],
	'22 — un business developer n''écrit ni la surcharge ni la description du nœud');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
update public.workflow_steps set description_override = 'Écrite par une lectrice'
 where id = '5eed0000-0000-4000-8000-000000000063';
update public.workflow_nodes_catalog set description = 'Écrite par une lectrice'
 where id = '5eed0000-0000-4000-8000-000000000043';
create temp table pg_temp.lu_par_la_lectrice as
	select s.description_override, n.description
	  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	 where s.id = '5eed0000-0000-4000-8000-000000000063';
reset role;
select is(
	(select array[s.description_override, n.description]
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	  where s.id = '5eed0000-0000-4000-8000-000000000063'),
	array['Une prose qui ne doit pas entrer au journal.', 'Le client a reçu une proposition chiffrée.'],
	'23 — une lectrice n''écrit ni l''une ni l''autre');
select is(
	(select array[description_override, description] from pg_temp.lu_par_la_lectrice),
	array['Une prose qui ne doit pas entrer au journal.', 'Le client a reçu une proposition chiffrée.'],
	'24 — une lectrice les lit, sous la RLS');

select * from finish();
rollback;

-- @verifies CRM-097 (docs/BACKLOG.md) — tranche T3.a : faire évoluer un workflow existant par une suggestion de l'IA
-- @verifies docs/SPEC-ia.md §13.2 (la composition vivante et l'occupation), §13.3 (les cinq codes d'une modification),
--           §13.4 (accepter : point de retour, cible traduite, cœur de la restauration, `PT409`) ;
--           docs/SPEC-workflow-engine.md §7 ter.13 (la restauration, dont le cœur est partagé) ; décision 620
-- @verifies CLAUDE.md §10 (le commercial refusé par la base)
--
-- Sur le workflow par défaut du SEED, dans une transaction annulée : il porte des affaires sur ses étapes, des champs,
-- des règles, une exigence et une version publiée — tout ce qu'une modification doit traverser.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temporary table ids (nom text primary key, valeur uuid) on commit drop;
insert into ids values
	('W', '5eed0000-0000-4000-8000-000000000001'),
	('WF', '5eed0000-0000-4000-8000-000000000051');
insert into ids select 'ADM', m.user_id from public.workspace_members m
 where m.workspace_id = '5eed0000-0000-4000-8000-000000000001' and m.role = 'admin' order by m.user_id limit 1;
insert into ids select 'BIZ', m.user_id from public.workspace_members m
 where m.workspace_id = '5eed0000-0000-4000-8000-000000000001' and m.role = 'business_developer' order by m.user_id limit 1;
grant select on ids to authenticated;
create or replace function pg_temp.id(nom text) returns uuid language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated;
create or replace function pg_temp.m(cle text) returns text language sql stable as $$ select valeur from mesures where mesures.cle = $1 $$;

-- Retire une étape et ce qui en dépend — le geste de l'aperçu (`brouillon-ia.ts`).
create or replace function pg_temp.sans_etape(p jsonb, cle text) returns jsonb language sql immutable as $$
	select p || jsonb_build_object(
		'etapes', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(p -> 'etapes') with ordinality x(e, o)
		                     where e ->> 'noeud' <> cle), '[]'::jsonb),
		'transitions', coalesce((select jsonb_agg(t order by o) from jsonb_array_elements(p -> 'transitions') with ordinality x(t, o)
		                          where t ->> 'de' <> cle and t ->> 'vers' <> cle), '[]'::jsonb),
		'regles', coalesce((select jsonb_agg(r order by o) from jsonb_array_elements(p -> 'regles') with ordinality x(r, o)
		                     where r ->> 'etape' <> cle), '[]'::jsonb),
		'exigences', coalesce((select jsonb_agg(z order by o) from jsonb_array_elements(p -> 'exigences') with ordinality x(z, o)
		                        where z ->> 'de' <> cle and z ->> 'vers' <> cle), '[]'::jsonb))
$$;
create or replace function pg_temp.codes(p jsonb, workflow uuid) returns text language sql as $$
	select coalesce(string_agg(d ->> 'code', ',' order by o), '')
	  from jsonb_array_elements(app.defauts_proposition_ia(pg_temp.id('W'), p, workflow)) with ordinality as x(d, o)
$$;

create temporary table vivante as select public.proposition_du_workflow(pg_temp.id('WF')) as p;
grant select on vivante to authenticated;
create or replace function pg_temp.vivante() returns jsonb language sql stable as $$ select p from vivante $$;

-- =============================================================================================
-- 1. La composition vivante, l'occupation
-- =============================================================================================

select is(
	(select jsonb_path_query_array(pg_temp.vivante(), '$.etapes[*].noeud')),
	'["prospection", "relance", "negociation", "signature", "realisation", "livre", "perdu"]'::jsonb,
	'1 — la proposition vivante nomme les étapes par la clé de leur nœud, dans l''ordre');
select is(
	(select pg_temp.vivante() -> 'noeuds')::text || '|' || (pg_temp.vivante() ->> 'version')
	|| '|' || jsonb_array_length(pg_temp.vivante() -> 'champs')::text,
	'[]|1|' || (select count(*)::text from public.form_fields where workflow_id = pg_temp.id('WF') and archived_at is null),
	'2 — format version 1, aucun nœud à créer, les seuls champs actifs');
select is(
	(select sum(v::int)::int from jsonb_each_text(public.occupation_du_workflow(pg_temp.id('WF'))) as t(k, v)),
	(select count(*)::int from public.cards where workflow_id = pg_temp.id('WF')),
	'3 — l''occupation compte toutes les affaires du workflow, archivées et en corbeille comprises');
select is(pg_temp.codes(pg_temp.vivante(), pg_temp.id('WF')), '',
	'4 — la composition vivante, relue comme une cible, ne porte aucun défaut');
-- SECURITY INVOKER : une personne étrangère à l'espace ne lit ni la composition ni l'occupation (CLAUDE.md §10).
select pg_temp.endosser('00000000-0000-4000-8000-0000000000e7');
select is(
	(select (public.proposition_du_workflow(pg_temp.id('WF')) is null)::text || '|' || public.occupation_du_workflow(pg_temp.id('WF'))::text),
	'true|{}', '4 bis — une personne étrangère à l''espace : ni composition (null), ni occupation ({})');
reset role;

-- =============================================================================================
-- 2. Les cinq codes d'une modification
-- =============================================================================================

select is(
	(select d -> 'valeurs' from jsonb_array_elements(app.defauts_proposition_ia(pg_temp.id('W'),
		pg_temp.sans_etape(pg_temp.vivante(), 'relance'), pg_temp.id('WF'))) d where d ->> 'code' = 'remappage_requis'),
	jsonb_build_object('cle', 'relance', 'affaires',
		(select count(*) from public.cards c join public.workflow_steps s on s.id = c.current_step_id
		   join public.workflow_nodes_catalog n on n.id = s.node_id where s.workflow_id = pg_temp.id('WF') and n.key = 'relance')),
	'5 — remappage_requis : une étape retirée qui porte des affaires, sans destination, avec leur nombre');
select is(
	pg_temp.codes(pg_temp.sans_etape(pg_temp.vivante(), 'relance') || jsonb_build_object('remappages', jsonb_build_array(
		jsonb_build_object('de', 'prospection', 'vers', 'negociation'),
		jsonb_build_object('de', 'relance', 'vers', 'zz'),
		jsonb_build_object('de', 'relance', 'vers', 'negociation'))), pg_temp.id('WF')),
	'remappage_origine_inconnue,remappage_cible_absente,remappage_en_double',
	'6 — un remappage d''une étape conservée, vers une étape absente, puis en double : trois codes, dans l''ordre');
select is(
	pg_temp.codes(jsonb_set(pg_temp.vivante(), '{champs,0,type}', '"number"'), pg_temp.id('WF')),
	'type_non_modifiable', '7 — type_non_modifiable : le type d''un champ conservé ne change pas');
select is(
	pg_temp.codes(jsonb_set(pg_temp.vivante(), '{transitions,0,libelle}', '""'), pg_temp.id('WF')),
	'', '8 — pour une modification, un libellé de transition vide vaut l''absence de libellé propre');
select ok(
	position('transition_sans_libelle' in pg_temp.codes(jsonb_set(pg_temp.vivante(), '{transitions,0,libelle}', '""'), null)) > 0,
	'9 — pour une création, le même libellé vide reste un défaut');

-- =============================================================================================
-- 3. Accepter une modification
-- =============================================================================================

insert into mesures select 'empreinte_avant', app.workflow_composition_fingerprint(pg_temp.id('WF'));
insert into mesures select 'versions_avant', count(*)::text from public.workflow_versions where workflow_id = pg_temp.id('WF');
insert into mesures select 'sur_relance', count(*)::text from public.cards c join public.workflow_steps s on s.id = c.current_step_id
  join public.workflow_nodes_catalog n on n.id = s.node_id where s.workflow_id = pg_temp.id('WF') and n.key = 'relance';

-- La cible : « relance » retirée, ses affaires vers une étape NOUVELLE « qualification-ia » ; un champ ajouté, un
-- champ retiré (il sera archivé).
create temporary table cible as
select pg_temp.sans_etape(pg_temp.vivante(), 'relance')
	|| jsonb_build_object(
		'noeuds', jsonb_build_array(jsonb_build_object('cle', 'qualification-ia', 'libelle', 'Qualification', 'nature', 'open', 'probabilite', 30)),
		'remappages', jsonb_build_array(jsonb_build_object('de', 'relance', 'vers', 'qualification-ia'))) as p;
update cible set p = jsonb_set(p, '{etapes}', jsonb_build_array(p -> 'etapes' -> 0, jsonb_build_object('noeud', 'qualification-ia', 'initiale', false))
	|| (select jsonb_agg(e order by o) from jsonb_array_elements(p -> 'etapes') with ordinality x(e, o) where o > 1));
update cible set p = jsonb_set(p, '{transitions}', (p -> 'transitions') || jsonb_build_array(
	jsonb_build_object('de', 'prospection', 'vers', 'qualification-ia', 'libelle', 'Qualifier', 'commentaire_requis', false),
	jsonb_build_object('de', 'qualification-ia', 'vers', 'negociation', 'libelle', 'Engager', 'commentaire_requis', false)));
update cible set p = jsonb_set(p, '{champs}', (select jsonb_agg(c order by o) from jsonb_array_elements(p -> 'champs') with ordinality x(c, o)
	where c ->> 'cle' <> 'lien-proposition') || jsonb_build_array(
	jsonb_build_object('cle', 'canal', 'libelle', 'Canal', 'type', 'text', 'choix', null, 'devise', null, 'aide', null)));
update cible set p = jsonb_set(p, '{regles}', coalesce((select jsonb_agg(r order by o) from jsonb_array_elements(p -> 'regles') with ordinality x(r, o)
	where r ->> 'champ' <> 'lien-proposition'), '[]'::jsonb));
update cible set p = jsonb_set(p, '{exigences}', coalesce((select jsonb_agg(z order by o) from jsonb_array_elements(p -> 'exigences') with ordinality x(z, o)
	where z ->> 'champ' <> 'lien-proposition'), '[]'::jsonb));
grant select on cible to authenticated;

select is(pg_temp.codes((select p from cible), pg_temp.id('WF')), '', '10 — la cible est conforme');

select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
              values (pg_temp.id('W'), pg_temp.id('WF'), 'etapes', 'Sonde T3 — remplacer la relance') returning id)
insert into mesures select 'S1', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('S1')::uuid, 'correction', (select p from cible));
reset role;

select pg_temp.endosser(pg_temp.id('BIZ'));
select throws_ok(format('select public.accepter_suggestion_ia(%L)', pg_temp.m('S1')), 'PT404', 'suggestion introuvable',
	'11 — le commercial : introuvable');
reset role;

select pg_temp.endosser(pg_temp.id('ADM'));
select is(public.accepter_suggestion_ia(pg_temp.m('S1')::uuid), pg_temp.id('WF'), '12 — l''administratrice accepte : le workflow est rendu');
reset role;

select is(
	(select statut || '|' || (version_retour_id = (select v.id from public.workflow_versions v where v.workflow_id = pg_temp.id('WF')
	                                                order by v.version_number desc limit 1))::text
	   from public.suggestions_ia where id = pg_temp.m('S1')::uuid),
	'acceptee|true', '13 — acceptée, avec son point de retour : la version la plus récente');
select is(
	(select count(*)::int from public.workflow_versions where workflow_id = pg_temp.id('WF')),
	pg_temp.m('versions_avant')::int,
	'14 — la dernière version photographiait déjà la composition vivante : elle EST le point de retour, rien n''est republié');
select is(
	(select jsonb_path_query_array(public.proposition_du_workflow(pg_temp.id('WF')), '$.etapes[*].noeud')),
	'["prospection", "qualification-ia", "negociation", "signature", "realisation", "livre", "perdu"]'::jsonb,
	'15 — la relance a disparu ; la qualification est la deuxième étape');
select is(
	(select count(*)::text from public.cards c join public.workflow_steps s on s.id = c.current_step_id
	   join public.workflow_nodes_catalog n on n.id = s.node_id where s.workflow_id = pg_temp.id('WF') and n.key = 'qualification-ia'),
	pg_temp.m('sur_relance'), '16 — les affaires de la relance sont sur l''étape NOUVELLE, toutes');
select is(
	(select string_agg(key || ':' || (archived_at is not null)::text, ',' order by key) from public.form_fields
	  where workflow_id = pg_temp.id('WF') and key in ('canal', 'lien-proposition')),
	'canal:false,lien-proposition:true', '17 — le champ ajouté est actif ; le champ retiré est ARCHIVÉ, jamais supprimé');
select is(
	(select count(*)::int from public.workflow_transitions where workflow_id = pg_temp.id('WF')),
	jsonb_array_length((select p -> 'transitions' from cible)), '18 — les transitions sont celles de la cible');
select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.id('WF')), pg_temp.id('WF')), '',
	'19 — le workflow modifié, relu, est conforme');

-- Le point de retour se RESTAURE, par le même cœur : les affaires de la qualification vont en prospection.
select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok(format('select public.restore_workflow_version(%L, %L)',
	(select version_retour_id from public.suggestions_ia where id = pg_temp.m('S1')::uuid),
	jsonb_build_array(jsonb_build_object(
		'from_step_id', (select s.id from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
		                  where s.workflow_id = pg_temp.id('WF') and n.key = 'qualification-ia'),
		'to_step_id', (select s.id from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
		                where s.workflow_id = pg_temp.id('WF') and n.key = 'prospection')))),
	'20 — le point de retour se restaure');
reset role;
select is(
	(select jsonb_path_query_array(public.proposition_du_workflow(pg_temp.id('WF')), '$.etapes[*].noeud')),
	'["prospection", "relance", "negociation", "signature", "realisation", "livre", "perdu"]'::jsonb,
	'21 — restauré, le workflow a retrouvé ses étapes');

-- `PT409` : une suggestion relève l'empreinte à sa création ; le workflow bouge ensuite.
select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
              values (pg_temp.id('W'), pg_temp.id('WF'), 'transitions', 'Sonde T3 — concurrence') returning id)
insert into mesures select 'S2', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('S2')::uuid, 'correction', public.proposition_du_workflow(pg_temp.id('WF')));
reset role;
update public.workflow_transitions set label = 'Libellé changé entre-temps'
 where id = (select id from public.workflow_transitions where workflow_id = pg_temp.id('WF') order by id limit 1);
select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(format('select public.accepter_suggestion_ia(%L)', pg_temp.m('S2')), 'PT409', 'workflow modifie',
	'22 — le workflow a bougé depuis la suggestion : PT409, une revue est nécessaire');
reset role;

-- Le workflow porte maintenant un changement qu'aucune version ne photographie : une suggestion créée MAINTENANT,
-- acceptée, publie son point de retour — une fois.
insert into mesures select 'versions_avant_S3', count(*)::text from public.workflow_versions where workflow_id = pg_temp.id('WF');
select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
              values (pg_temp.id('W'), pg_temp.id('WF'), 'champs', 'Sonde T3 — point de retour publié') returning id)
insert into mesures select 'S3', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('S3')::uuid, 'correction',
        jsonb_set(public.proposition_du_workflow(pg_temp.id('WF')), '{workflow,nom}', '"Pipeline revu par l''IA"'));
select is(public.accepter_suggestion_ia(pg_temp.m('S3')::uuid), pg_temp.id('WF'), '23 — acceptée');
reset role;
select is(
	(select (count(*) - pg_temp.m('versions_avant_S3')::int)::text from public.workflow_versions where workflow_id = pg_temp.id('WF'))
	|| '|' || ((select version_retour_id from public.suggestions_ia where id = pg_temp.m('S3')::uuid)
	           = (select v.id from public.workflow_versions v where v.workflow_id = pg_temp.id('WF')
	               order by v.version_number desc limit 1))::text,
	'1|true', '24 — un point de retour PUBLIÉ, un seul, et c''est la version la plus récente');
select is((select name from public.workflows where id = pg_temp.id('WF')), 'Pipeline revu par l''IA',
	'25 — le nom proposé renomme le workflow');

-- Un workflow archivé depuis la suggestion ne se modifie plus.
insert into public.workflows (workspace_id, name, scope) values (pg_temp.id('W'), 'Sonde T3 — bientôt archivé', 'global')
returning id as w2 \gset
insert into ids values ('W2', :'w2');
select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
              values (pg_temp.id('W'), pg_temp.id('W2'), 'etapes', 'Sonde T3 — workflow archivé') returning id)
insert into mesures select 'S4', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('S4')::uuid, 'correction', public.proposition_du_workflow(pg_temp.id('WF')));
reset role;
update public.workflows set archived_at = now() where id = pg_temp.id('W2');
select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(format('select public.accepter_suggestion_ia(%L)', pg_temp.m('S4')), 'P0001', 'workflow archive',
	'26 — le workflow a été archivé depuis la suggestion : refusé');
reset role;

select * from finish();
rollback;

-- @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.a : le contrôle des propositions en base, et l'acceptation
-- @verifies docs/SPEC-ia.md §12.1 (la forme refusée en 22023 ; chacun des vingt-neuf codes, leurs valeurs et leur
--           ordre ; les défauts écrits par la base quoi que l'appelant envoie), §12.2 (correction refusée pendant
--           une génération), §12.3 (sept refus, sept effets, l'atomicité) ; docs/SCHEMA.md §9 ter (migration
--           `0084`) ; docs/JOURNAL.md décision 618
-- @verifies CLAUDE.md §10 (le commercial, la lectrice et l'administratrice d'un autre espace refusés par la base)
--
-- Tout se joue dans une transaction annulée. La proposition de base est la plus petite qui soit conforme ;
-- chaque assertion de défaut n'en change qu'un trait et compare la liste EXACTE des codes rendus.

begin;

create extension if not exists pgtap with schema extensions;

select plan(74);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W',    '0c980000-0000-4000-8000-0000000000e1'),
	('W2',   '0c980000-0000-4000-8000-0000000000e2'),
	('ADM',  '0c980000-0000-4000-8000-000000000011'),
	('ADM2', '0c980000-0000-4000-8000-000000000015'),
	('BIZ',  '0c980000-0000-4000-8000-000000000012'),
	('LECT', '0c980000-0000-4000-8000-000000000013'),
	('ETR',  '0c980000-0000-4000-8000-000000000014');
grant select on ids to authenticated, service_role;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated, service_role;
create or replace function pg_temp.m(cle text) returns uuid
language sql stable as $$ select valeur::uuid from mesures where mesures.cle = $1 $$;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('W'), 'Espace 0078', 'espace-0078'),
	(pg_temp.id('W2'), 'Autre espace 0078', 'autre-espace-0078');
insert into public.profiles (id, full_name) values
	(pg_temp.id('ADM'), 'Administratrice 0078'),
	(pg_temp.id('ADM2'), 'Second administrateur 0078'),
	(pg_temp.id('BIZ'), 'Commercial 0078'),
	(pg_temp.id('LECT'), 'Lectrice 0078'),
	(pg_temp.id('ETR'), 'Étrangère 0078');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('W'), pg_temp.id('ADM'), 'admin'),
	(pg_temp.id('W'), pg_temp.id('ADM2'), 'admin'),
	(pg_temp.id('W'), pg_temp.id('BIZ'), 'business_developer'),
	(pg_temp.id('W'), pg_temp.id('LECT'), 'viewer'),
	(pg_temp.id('W2'), pg_temp.id('ETR'), 'admin');

-- Le catalogue de l'espace : un nœud vivant, un nœud archivé.
insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, archived_at) values
	(pg_temp.id('W'), 'existant', 'Existant', 'open', 'neutral', null),
	(pg_temp.id('W'), 'retire', 'Retiré', 'open', 'neutral', now());

-- La plus petite proposition conforme.
create or replace function pg_temp.base() returns jsonb language sql immutable as $$
	select '{"version": 1, "workflow": {"nom": "Essai"},
	  "noeuds": [{"cle": "a", "libelle": "A", "nature": "open", "probabilite": 10},
	             {"cle": "b", "libelle": "B", "nature": "won", "probabilite": 100}],
	  "etapes": [{"noeud": "a", "initiale": true}, {"noeud": "b", "initiale": false}],
	  "transitions": [{"de": "a", "vers": "b", "libelle": "Gagner", "commentaire_requis": false}],
	  "champs": [{"cle": "f", "libelle": "F", "type": "text", "choix": null, "devise": null, "aide": null}],
	  "regles": [{"champ": "f", "etape": "a", "visibilite": "visible"}],
	  "exigences": [{"de": "a", "vers": "b", "champ": "f"}]}'::jsonb
$$;
-- Les codes rendus, dans leur ordre.
create or replace function pg_temp.codes(p jsonb) returns text language sql as $$
	select coalesce(string_agg(d ->> 'code', ',' order by o), '')
	  from jsonb_array_elements(app.defauts_proposition_ia(pg_temp.id('W'), p)) with ordinality as x(d, o)
$$;
-- Ajoute un élément à une liste de la proposition.
create or replace function pg_temp.plus(p jsonb, liste text, element jsonb) returns jsonb language sql immutable as $$
	select jsonb_set(p, array[liste], (p -> liste) || jsonb_build_array(element))
$$;

-- =============================================================================================
-- 1. La forme : refusée, jamais conservée
-- =============================================================================================

select is(pg_temp.codes(pg_temp.base()), '', '1 — la proposition de base ne porte aucun défaut');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), '{"version": 2}')$$, '22023', 'proposition mal formee',
	'2 — une autre version est une forme invalide');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), pg_temp.base() - 'exigences')$$, '22023', null,
	'3 — une liste absente est une forme invalide');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{noeuds,0,probabilite}', '"dix"'))$$, '22023', null,
	'4 — une probabilité qui n''est pas un nombre est une forme invalide');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{champs,0,choix}', '[1]'))$$, '22023', null,
	'5 — un choix qui n''est pas un texte est une forme invalide');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'),
	jsonb_set(pg_temp.base(), '{regles}', (select jsonb_agg(jsonb_build_object('champ', 'f', 'etape', 'a', 'visibilite', 'visible')) from generate_series(1, 195))))$$,
	'22023', null, '6 — plus de deux cents éléments est une forme invalide');

-- =============================================================================================
-- 2. Les vingt-neuf codes, un trait à la fois
-- =============================================================================================

select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{workflow,nom}', '"  "')), 'nom_absent', '7 — nom_absent');
select is(pg_temp.codes(jsonb_set(jsonb_set(jsonb_set(pg_temp.base(), '{champs,0,cle}', '"F!"'), '{regles,0,champ}', '"F!"'), '{exigences,0,champ}', '"F!"')),
	'cle_invalide', '8 — cle_invalide, sur une clé de champ hors de la forme');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'noeuds', '{"cle": "a", "libelle": "A bis", "nature": "open", "probabilite": 5}')),
	'noeud_en_double', '9 — noeud_en_double');
select is(pg_temp.codes(pg_temp.plus(pg_temp.plus(pg_temp.base(), 'noeuds', '{"cle": "existant", "libelle": "E", "nature": "open", "probabilite": 5}'),
	'etapes', '{"noeud": "existant", "initiale": false}')),
	'noeud_deja_au_catalogue', '10 — noeud_deja_au_catalogue : la clé d''un nœud vivant ne se redéclare pas');
select is(pg_temp.codes(pg_temp.plus(pg_temp.plus(pg_temp.base(), 'noeuds', '{"cle": "retire", "libelle": "R", "nature": "open", "probabilite": 5}'),
	'etapes', '{"noeud": "retire", "initiale": false}')),
	'noeud_archive', '11 — noeud_archive, sur un nœud proposé qui porte la clé d''un nœud archivé');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'etapes', '{"noeud": "retire", "initiale": false}')),
	'noeud_archive', '12 — noeud_archive, sur une étape qui vise un nœud archivé');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'etapes', '{"noeud": "existant", "initiale": false}')),
	'', '13 — une étape vise un nœud VIVANT du catalogue sans le redéclarer : aucun défaut');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{noeuds,0,libelle}', '" "')), 'libelle_absent', '14 — libelle_absent, sur un nœud');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{noeuds,0,nature}', '"paused"')), 'nature_invalide', '15 — nature_invalide');
select is(pg_temp.codes(jsonb_set(jsonb_set(pg_temp.base(), '{noeuds,0,probabilite}', '140'), '{noeuds,1,probabilite}', 'null')),
	'probabilite_invalide,probabilite_invalide', '16 — probabilite_invalide, hors bornes ou absente');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'noeuds', '{"cle": "c", "libelle": "C", "nature": "lost", "probabilite": 0}')),
	'noeud_inutilise', '17 — noeud_inutilise : un nœud qu''aucune étape ne vise');
select is(pg_temp.codes('{"version": 1, "workflow": {"nom": "Vide"}, "noeuds": [], "etapes": [], "transitions": [], "champs": [], "regles": [], "exigences": []}'),
	'aucune_etape', '18 — aucune_etape');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'etapes', '{"noeud": "b", "initiale": false}')), 'etape_en_double', '19 — etape_en_double');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'etapes', '{"noeud": "z", "initiale": false}')), 'noeud_inconnu', '20 — noeud_inconnu');
select is(app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{etapes,1,initiale}', 'true')),
	'[{"code": "etape_initiale", "chemin": "etapes", "valeurs": {"nombre": 2}}]'::jsonb,
	'21 — etape_initiale, avec le nombre d''étapes initiales en valeur');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{etapes,0,initiale}', 'false')), 'etape_initiale', '22 — etape_initiale, quand aucune ne l''est');
select is(app.defauts_proposition_ia(pg_temp.id('W'), pg_temp.plus(pg_temp.base(), 'transitions', '{"de": "a", "vers": "z", "libelle": "Vers z", "commentaire_requis": false}')),
	'[{"code": "transition_etape_absente", "chemin": "transitions[1]", "valeurs": {"de": "a", "vers": "z"}}]'::jsonb,
	'23 — transition_etape_absente, son chemin et ses deux clés');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'transitions', '{"de": "a", "vers": "a", "libelle": "Rester", "commentaire_requis": false}')),
	'transition_boucle', '24 — transition_boucle');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'transitions', '{"de": "a", "vers": "b", "libelle": "Encore", "commentaire_requis": true}')),
	'transition_en_double', '25 — transition_en_double');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{transitions,0,libelle}', '""')), 'transition_sans_libelle', '26 — transition_sans_libelle');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'champs', '{"cle": "f", "libelle": "F bis", "type": "text", "choix": null, "devise": null, "aide": null}')),
	'champ_en_double', '27 — champ_en_double');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{champs,0,libelle}', '""')), 'libelle_absent', '28 — libelle_absent, sur un champ');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{champs,0,type}', '"rating"')), 'type_inconnu', '29 — type_inconnu');
select is(pg_temp.codes(jsonb_set(jsonb_set(pg_temp.base(), '{champs,0,type}', '"select"'), '{champs,0,choix}', '[]')),
	'choix_requis', '30 — choix_requis, sur une liste sans choix');
select is(app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(jsonb_set(pg_temp.base(), '{champs,0,type}', '"multiselect"'), '{champs,0,choix}', '["Été", "ete", "—"]')),
	'[{"code": "choix_invalide", "chemin": "champs[0].choix", "valeurs": {"cle": "f", "choix": "ete"}},
	  {"code": "choix_invalide", "chemin": "champs[0].choix", "valeurs": {"cle": "f", "choix": "—"}}]'::jsonb,
	'31 — choix_invalide : une clé dérivée déjà prise (« Été » et « ete »), puis une clé dérivée vide');
select is(pg_temp.codes(jsonb_set(jsonb_set(pg_temp.base(), '{champs,0,type}', '"money"'), '{champs,0,devise}', '"eur"')),
	'devise_requise', '32 — devise_requise : trois lettres CAPITALES');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{regles,0,champ}', '"g"')), 'regle_champ_absent', '33 — regle_champ_absent');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{regles,0,etape}', '"z"')), 'regle_etape_absente', '34 — regle_etape_absente');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'regles', '{"champ": "f", "etape": "a", "visibilite": "required"}')),
	'regle_en_double', '35 — regle_en_double');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{regles,0,visibilite}', '"grise"')), 'visibilite_invalide', '36 — visibilite_invalide');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{exigences,0,vers}', '"a"')), 'exigence_transition_absente', '37 — exigence_transition_absente');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{exigences,0,champ}', '"g"')), 'exigence_champ_absent', '38 — exigence_champ_absent');
select is(pg_temp.codes(pg_temp.plus(pg_temp.base(), 'exigences', '{"de": "a", "vers": "b", "champ": "f"}')),
	'exigence_en_double', '39 — exigence_en_double');
select is(pg_temp.codes(jsonb_set(jsonb_set(jsonb_set(pg_temp.base(), '{exigences,0,champ}', '"g"'), '{workflow,nom}', '""'), '{etapes,1,initiale}', 'true')),
	'nom_absent,etape_initiale,exigence_champ_absent', '40 — plusieurs défauts se rendent dans l''ordre de la spécification');

-- =============================================================================================
-- 3. Le trigger : la base écrit les défauts ; une correction attend la fin d'une génération
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Un essai') returning id)
insert into mesures select 'SA', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('SA'), 'correction', jsonb_set(pg_temp.base(), '{etapes,1,initiale}', 'true'));
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition, defauts) values (pg_temp.m('SA'), 'correction', pg_temp.base(), '[]')$$,
	'42501', null, '41 — le client ne fournit pas les défauts : le privilège lui est retiré');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SA'), 'correction', '{"version": 1, "etapes": {}}')$$,
	'22023', null, '42 — une correction mal formée est refusée, jamais conservée');
reset role;
select is((select string_agg(d ->> 'code', ',') from public.suggestions_ia_revisions r, jsonb_array_elements(r.defauts) d where r.suggestion_id = pg_temp.m('SA')),
	'etape_initiale', '43 — les défauts d''une correction sont calculés par la base');

set local role service_role;
insert into public.suggestions_ia_revisions (suggestion_id, origine, consigne, proposition, defauts, modele, jetons_entree, jetons_sortie, duree_ms)
values (pg_temp.m('SA'), 'ia', 'Corrige', pg_temp.base(), '[{"code": "invente"}]', 'gemma4:e2b', 1, 1, 1);
reset role;
select is((select defauts from public.suggestions_ia_revisions where suggestion_id = pg_temp.m('SA') and numero = 2), '[]'::jsonb,
	'44 — même la clé de service ne fait pas écrire ses défauts : la base les recalcule');

select pg_temp.endosser(pg_temp.id('ADM'));
update public.suggestions_ia set generation_depuis = now() where id = pg_temp.m('SA');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SA'), 'correction', pg_temp.base())$$,
	'P0001', 'generation en cours', '45 — une correction est refusée pendant une génération');
update public.suggestions_ia set generation_depuis = now() - interval '200 seconds' where id = pg_temp.m('SA');
select lives_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SA'), 'correction', pg_temp.base())$$,
	'46 — un verrou périmé (plus de 180 s) ne retient plus une correction');
update public.suggestions_ia set generation_depuis = null where id = pg_temp.m('SA');
reset role;

-- =============================================================================================
-- 4. Accepter : les refus
-- =============================================================================================

select ok(
	(select prosecdef from pg_proc where oid = 'public.accepter_suggestion_ia(uuid)'::regprocedure)
	and has_function_privilege('authenticated', 'public.accepter_suggestion_ia(uuid)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.accepter_suggestion_ia(uuid)', 'EXECUTE'),
	'47 — le geste est SECURITY DEFINER, exécutable par authenticated, refusé à anon');

set local role authenticated;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SA'))$$, '42501', 'authentification requise',
	'48 — sans utilisateur, aucune acceptation');
reset role;

select pg_temp.endosser(pg_temp.id('BIZ'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SA'))$$, 'PT404', 'suggestion introuvable',
	'49 — le commercial : introuvable, comme une suggestion qui n''existe pas');
reset role;
select pg_temp.endosser(pg_temp.id('LECT'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SA'))$$, 'PT404', 'suggestion introuvable', '50 — la lectrice : introuvable');
reset role;
select pg_temp.endosser(pg_temp.id('ETR'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SA'))$$, 'PT404', 'suggestion introuvable',
	'51 — l''administratrice d''un autre espace : introuvable');
reset role;

select pg_temp.endosser(pg_temp.id('ADM'));
-- Les suggestions des refus restants.
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Sans révision') returning id)
insert into mesures select 'SE', id::text from cree;
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Incohérente') returning id)
insert into mesures select 'SC', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('SC'), 'correction', jsonb_set(pg_temp.base(), '{etapes,1,initiale}', 'true'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SE'))$$, 'P0001', 'aucune revision', '52 — aucune révision, rien à accepter');
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SC'))$$, 'P0001', 'proposition non conforme',
	'53 — une révision qui porte des défauts est refusée');
update public.suggestions_ia set generation_depuis = now() where id = pg_temp.m('SE');
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SE'))$$, 'P0001', 'generation en cours',
	'54 — une génération en vol retient l''acceptation');
reset role;
select is((select count(*)::int from public.workflows where workspace_id = pg_temp.id('W')), 0,
	'55 — aucun refus n''a écrit de workflow');

-- =============================================================================================
-- 5. Accepter : les effets
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures values ('WA', public.accepter_suggestion_ia(pg_temp.m('SA'))::text);
reset role;

select is(
	(select name || '|' || scope || '|' || is_default::text || '|' || (track_id is null)::text from public.workflows where id = pg_temp.m('WA')),
	'Essai|global|true|true', '56 — le workflow : son nom, global, et le défaut d''un espace qui n''en avait aucun');
select is(
	(select string_agg(key || ':' || label || ':' || kind || ':' || color || ':' || default_probability::text, ',' order by key)
	   from public.workflow_nodes_catalog where workspace_id = pg_temp.id('W') and key in ('a', 'b')),
	'a:A:open:brand:10.00,b:B:won:success:100.00', '57 — les nœuds proposés entrent au catalogue, la couleur suivant la nature');
select is(
	(select string_agg(n.key || ':' || s.position::text || ':' || s.is_initial::text, ',' order by s.position)
	   from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id where s.workflow_id = pg_temp.m('WA')),
	'a:1:true,b:2:false', '58 — les étapes, dans l''ordre de la proposition, l''initiale désignée');
select is(
	(select string_agg(f.key || '>' || t2.key || ':' || t.label || ':' || t.require_comment::text, ',')
	   from public.workflow_transitions t
	   join public.workflow_steps s1 on s1.id = t.from_step_id join public.workflow_nodes_catalog f on f.id = s1.node_id
	   join public.workflow_steps s2 on s2.id = t.to_step_id join public.workflow_nodes_catalog t2 on t2.id = s2.node_id
	  where t.workflow_id = pg_temp.m('WA')),
	'a>b:Gagner:false', '59 — la transition, son libellé et son motif');
select is(
	(select string_agg(ff.key || ':' || ff.type || ':' || ff.options::text || ':' || ff.position::text, ',')
	   from public.form_fields ff where ff.workflow_id = pg_temp.m('WA')),
	'f:text:{}:1', '60 — le champ, son type et des options vides pour un texte');
select is(
	(select count(*)::int from public.form_field_rules r where r.workflow_id = pg_temp.m('WA') and r.visibility = 'visible')
	+ (select count(*)::int from public.workflow_transition_required_fields x join public.workflow_transitions t on t.id = x.transition_id
	    where t.workflow_id = pg_temp.m('WA')),
	2, '61 — la règle de visibilité et l''exigence de transition');
select is(
	(select statut || '|' || (workflow_cree_id = pg_temp.m('WA'))::text || '|' || decided_by::text || '|' || (decided_at is not null)::text
	   from public.suggestions_ia where id = pg_temp.m('SA')),
	'acceptee|true|' || pg_temp.id('ADM')::text || '|true', '62 — la suggestion est acceptée, signée, et nomme le workflow créé');

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SA'))$$, 'P0001', 'suggestion figee', '63 — une suggestion acceptée est figée');

-- Une seconde : un nœud du catalogue réemployé, une liste et un montant, une aide.
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Seconde') returning id)
insert into mesures select 'SB', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SB'), 'correction',
	'{"version": 1, "workflow": {"nom": "  Seconde  "},
	  "noeuds": [{"cle": "c", "libelle": "C", "nature": "lost", "probabilite": 0}],
	  "etapes": [{"noeud": "a", "initiale": true}, {"noeud": "c", "initiale": false}],
	  "transitions": [{"de": "a", "vers": "c", "libelle": "Perdre", "commentaire_requis": true}],
	  "champs": [{"cle": "site", "libelle": "Type de site", "type": "select", "choix": ["Vitrine", "E-commerce"], "devise": null, "aide": " Le type. "},
	             {"cle": "budget", "libelle": "Budget", "type": "money", "choix": null, "devise": "EUR", "aide": "  "}],
	  "regles": [], "exigences": []}');
insert into mesures values ('WB', public.accepter_suggestion_ia(pg_temp.m('SB'))::text);

-- Une troisième, conforme à sa révision ; le catalogue changera avant l'acceptation.
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Troisième') returning id)
insert into mesures select 'SD', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SD'), 'correction',
	'{"version": 1, "workflow": {"nom": "Troisième"},
	  "noeuds": [{"cle": "d", "libelle": "D", "nature": "open", "probabilite": 20}, {"cle": "e", "libelle": "E", "nature": "won", "probabilite": 100}],
	  "etapes": [{"noeud": "d", "initiale": true}, {"noeud": "e", "initiale": false}],
	  "transitions": [{"de": "d", "vers": "e", "libelle": "Gagner", "commentaire_requis": false}],
	  "champs": [], "regles": [], "exigences": []}');
-- Une quatrième, conforme, dont la DERNIÈRE écriture échouera.
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Panne') returning id)
insert into mesures select 'SF', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SF'), 'correction',
	'{"version": 1, "workflow": {"nom": "Panne"},
	  "noeuds": [{"cle": "g", "libelle": "G", "nature": "open", "probabilite": 20}, {"cle": "h", "libelle": "H", "nature": "won", "probabilite": 100}],
	  "etapes": [{"noeud": "g", "initiale": true}, {"noeud": "h", "initiale": false}],
	  "transitions": [{"de": "g", "vers": "h", "libelle": "Gagner", "commentaire_requis": false}],
	  "champs": [{"cle": "f", "libelle": "F", "type": "text", "choix": null, "devise": null, "aide": null}],
	  "regles": [], "exigences": [{"de": "g", "vers": "h", "champ": "f"}]}');
reset role;
select is((select jsonb_array_length(defauts) from public.suggestions_ia_revisions where suggestion_id = pg_temp.m('SD')), 0,
	'64 — la troisième est conforme à sa révision');

select is(
	(select is_default::text || '|' || name || '|' ||
	        (select string_agg(ff.key || '=' || ff.options::text || '=' || coalesce(ff.help_text, 'aucune'), ';' order by ff.position)
	           from public.form_fields ff where ff.workflow_id = w.id)
	   from public.workflows w where w.id = pg_temp.m('WB')),
	'false|Seconde|site={"choices": [{"key": "vitrine", "label": "Vitrine"}, {"key": "e-commerce", "label": "E-commerce"}]}=Le type.;budget={"currency": "EUR"}=aucune',
	'65 — la seconde : pas le défaut, nom sans espaces de bord, clés de choix dérivées, devise, aide blanche absente');

insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color) values (pg_temp.id('W'), 'e', 'E', 'won', 'success');
select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SD'))$$, 'P0001', 'proposition non conforme',
	'66 — recontrôlée à l''acceptation : un nœud entré au catalogue depuis la révision la rend non conforme');
reset role;

-- L'ATOMICITÉ : un trigger posé dans cette transaction annulée fait échouer l'écriture des exigences, la
-- dernière du geste ; rien de ce qui la précède ne doit rester.
create or replace function pg_temp.echouer() returns trigger language plpgsql as $$ begin raise exception 'panne simulee'; end $$;
create trigger echouer_0078 before insert on public.workflow_transition_required_fields
	for each row execute function pg_temp.echouer();
select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SF'))$$, 'P0001', 'panne simulee',
	'67 — la dernière écriture du geste échoue');
reset role;
drop trigger echouer_0078 on public.workflow_transition_required_fields;
select is(
	(select count(*)::text from public.workflows where workspace_id = pg_temp.id('W'))
	|| '|' || (select count(*)::text from public.workflow_nodes_catalog where workspace_id = pg_temp.id('W') and key in ('g', 'h'))
	|| '|' || (select statut from public.suggestions_ia where id = pg_temp.m('SF')),
	'2|0|en_revue', '68 — rien n''est resté : ni workflow, ni nœud, et la suggestion est toujours en revue');

-- =============================================================================================
-- 6. Une suggestion figée n'empêche pas d'effacer ce qu'elle désigne (défaut trouvé le 2026-10-02)
-- =============================================================================================
-- Les clés `on delete set null` — workflow créé, version de retour, auteur, décideur — METTENT À JOUR une
-- suggestion décidée, et l'auteur d'une révision immuable. Le gel de T1 les refusait : un workflow créé par une
-- suggestion acceptée, ou un profil qui en avait créé ou décidé une, ne pouvaient plus être supprimés. Trouvé par
-- le retrait des sondes de l'API (`ia-acceptation.spec.ts`), rejoué ici AVANT correction : 69, 70 et 73 rouges.

select lives_ok($$delete from public.workflows where id = pg_temp.m('WB')$$,
	'69 — le workflow créé par une suggestion acceptée se supprime ; le lien s''efface');
select is(
	(select statut || '|' || coalesce(workflow_cree_id::text, 'efface') from public.suggestions_ia where id = pg_temp.m('SB')),
	'acceptee|efface', '70 — la suggestion reste acceptée, sans lien vers ce qui n''existe plus');
select throws_ok($$update public.suggestions_ia set demande = 'réécrite' where id = pg_temp.m('SB')$$, 'P0001', 'suggestion figee',
	'71 — toute autre modification d''une suggestion décidée reste refusée');
select throws_ok($$update public.suggestions_ia set workflow_cree_id = pg_temp.m('WA') where id = pg_temp.m('SB')$$, 'P0001', 'suggestion figee',
	'72 — poser un lien sur une suggestion décidée reste refusé : seul l''effacement passe');
select pg_temp.endosser(pg_temp.id('ADM2'));
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Du second') returning id)
insert into mesures select 'SX', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SX'), 'correction', pg_temp.base());
update public.suggestions_ia set statut = 'abandonnee' where id = pg_temp.m('SX');
reset role;
select lives_ok($$delete from public.profiles where id = pg_temp.id('ADM2')$$,
	'73 — le profil qui a créé, corrigé et abandonné une suggestion se supprime');
select is(
	(select statut || '|' || coalesce(created_by::text, 'efface') || '|' || coalesce(decided_by::text, 'efface') from public.suggestions_ia where id = pg_temp.m('SX'))
	|| '|' || (select coalesce(created_by::text, 'efface') || '|' || (proposition = pg_temp.base())::text from public.suggestions_ia_revisions where suggestion_id = pg_temp.m('SX')),
	'abandonnee|efface|efface|efface|true', '74 — l''auteur et le décideur s''effacent ; le statut et la proposition restent');

select * from finish();
rollback;

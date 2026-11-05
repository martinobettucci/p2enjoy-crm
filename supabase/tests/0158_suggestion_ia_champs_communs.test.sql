-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T7 : le générateur ne doublonne pas un champ de l'affaire — le défaut
--           bloquant `common_field` (`key`, `common_key`, `common_label`) de `app.defauts_proposition_ia`
-- @verifies docs/SPEC-ia.md §14.11 (décision 851 : trois égalités exactes, champs actifs de l'espace seuls, le premier
--           par `position` puis `key`, après `native_field`, un champ vivant conservé épargné, l'acceptation refusée) ;
--           docs/SPEC-champs-communs.md §12 ; docs/SCHEMA.md « Migration `0169` »
--
-- Tout se joue dans une transaction annulée, sur deux espaces créés ici, sans aucune affaire.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

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
	('W',   '0c112700-0000-4000-8000-0000000000e1'),
	('W2',  '0c112700-0000-4000-8000-0000000000e2'),
	('ADM', '0c112700-0000-4000-8000-000000000011');
grant select on ids to authenticated, service_role;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated, service_role;
create or replace function pg_temp.m(cle text) returns uuid
language sql stable as $$ select valeur::uuid from mesures where mesures.cle = $1 $$;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('W'), 'Espace 0158', 'espace-0158'), (pg_temp.id('W2'), 'Autre 0158', 'autre-0158');
insert into public.profiles (id, full_name) values (pg_temp.id('ADM'), 'Administratrice 0158');
insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('W'), pg_temp.id('ADM'), 'admin');
insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability) values
	(pg_temp.id('W'), 'prospection', 'Prospection', 'open', 'brand', 30),
	(pg_temp.id('W'), 'gagne', 'Gagné', 'won', 'success', 100);

-- Les champs de l'affaire : deux actifs, un archivé ; un champ d'un autre espace.
insert into public.card_common_fields (workspace_id, key, label, type, options, position, archived_at) values
	(pg_temp.id('W'), 'siret', 'SIRET', 'text', '{}', 1, null),
	(pg_temp.id('W'), 'code-naf', 'Secteur d''activité', 'text', '{}', 2, null),
	(pg_temp.id('W'), 'ancien-code', 'Ancien code', 'text', '{}', 3, now()),
	(pg_temp.id('W2'), 'tva', 'TVA', 'text', '{}', 1, null);

create or replace function pg_temp.base() returns jsonb language sql immutable as $$
	select '{"version": 1, "workflow": {"nom": "Ventes 0158"}, "noeuds": [],
	  "etapes": [{"noeud": "prospection", "initiale": true, "label": null, "probability": null},
	             {"noeud": "gagne", "initiale": false, "label": null, "probability": null}],
	  "transitions": [{"de": "prospection", "vers": "gagne", "libelle": "Gagner", "commentaire_requis": false}],
	  "champs": [{"cle": "canal", "libelle": "Canal", "type": "text", "choix": null, "devise": null, "aide": null}],
	  "regles": [], "exigences": []}'::jsonb
$$;
create or replace function pg_temp.champ(cle text, libelle text) returns jsonb language sql immutable as $$
	select jsonb_build_object('cle', cle, 'libelle', libelle, 'type', 'text', 'choix', null, 'devise', null, 'aide', null)
$$;
create or replace function pg_temp.avec(p jsonb, element jsonb) returns jsonb language sql immutable as $$
	select jsonb_set(p, '{champs}', (p -> 'champs') || jsonb_build_array(element))
$$;
create or replace function pg_temp.defauts(p jsonb, espace text default 'W', workflow uuid default null) returns jsonb
language sql as $$ select app.defauts_proposition_ia(pg_temp.id(espace), p, workflow) $$;
create or replace function pg_temp.codes(p jsonb, workflow uuid default null) returns text language sql as $$
	select coalesce(string_agg(d ->> 'code', ',' order by o), '')
	  from jsonb_array_elements(pg_temp.defauts(p, 'W', workflow)) with ordinality as x(d, o)
$$;

-- =============================================================================================
-- 1. Les trois égalités, exactes
-- =============================================================================================

select is(pg_temp.defauts(pg_temp.base()), '[]'::jsonb, '1 — la base, sans doublon : aucun défaut');
select is(pg_temp.defauts(pg_temp.avec(pg_temp.base(), pg_temp.champ('siret', 'Numéro d''entreprise'))),
	'[{"code": "common_field", "chemin": "champs[1]", "valeurs": {"key": "siret", "common_key": "siret", "common_label": "SIRET"}}]'::jsonb,
	'2 — par la clé : son chemin, la clé proposée, la clé et le libellé du champ de l''affaire');
select is(pg_temp.defauts(pg_temp.avec(pg_temp.base(), pg_temp.champ('identifiant', '  Siret '))) -> 0 -> 'valeurs',
	'{"key": "identifiant", "common_key": "siret", "common_label": "SIRET"}'::jsonb,
	'3 — par le libellé proposé mis à la forme des clés (« Siret » → siret)');
select is(pg_temp.defauts(pg_temp.avec(pg_temp.base(), pg_temp.champ('secteur-d-activite', 'Domaine'))) -> 0 -> 'valeurs',
	'{"key": "secteur-d-activite", "common_key": "code-naf", "common_label": "Secteur d''activité"}'::jsonb,
	'4 — par la clé proposée égale au libellé du champ de l''affaire mis à la forme des clés');
select is(pg_temp.codes(pg_temp.avec(pg_temp.base(), pg_temp.champ('autre', 'Secteur d''activité'))), 'common_field',
	'5 — par les deux libellés mis à la forme des clés');
select is(pg_temp.codes(pg_temp.avec(pg_temp.avec(pg_temp.base(), pg_temp.champ('siret-ht', 'SIRET HT')),
		pg_temp.champ('naf', 'NAF'))), '',
	'6 — l''égalité est EXACTE : siret-ht et naf passent');

-- =============================================================================================
-- 2. Ce qui ne compte pas
-- =============================================================================================

select is(pg_temp.codes(pg_temp.avec(pg_temp.base(), pg_temp.champ('ancien-code', 'Ancien code'))), '',
	'7 — un champ de l''affaire ARCHIVÉ ne relève rien');
select is(pg_temp.codes(pg_temp.avec(pg_temp.base(), pg_temp.champ('tva', 'TVA'))), '',
	'8 — le champ de l''affaire d''un AUTRE espace ne relève rien');
-- L'autre espace n'a pas de catalogue : ses étapes portent `noeud_inconnu`, d'où la recherche par contenance.
select ok(pg_temp.defauts(pg_temp.avec(pg_temp.base(), pg_temp.champ('tva', 'TVA')), 'W2')
		@> '[{"code": "common_field", "valeurs": {"common_key": "tva"}}]'::jsonb,
	'9 — le même champ, proposé dans l''espace qui le déclare, est relevé');

-- =============================================================================================
-- 3. L'ordre des défauts, le premier champ nommé
-- =============================================================================================

select is(pg_temp.codes(pg_temp.avec(pg_temp.base(), pg_temp.champ('montant', 'SIRET'))), 'native_field,common_field',
	'10 — un champ qui répond aux deux règles porte les deux défauts, common_field APRÈS native_field');
select is(pg_temp.defauts(pg_temp.avec(pg_temp.base(), pg_temp.champ('siret', 'Secteur d''activité'))) -> 0 -> 'valeurs' ->> 'common_key',
	'siret', '11 — deux champs de l''affaire répondent : le premier par position est nommé');

-- =============================================================================================
-- 4. L'acceptation : refusée tant que le défaut demeure ; un champ vivant conservé épargné
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Création 0158') returning id)
insert into mesures select 'SD', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
values (pg_temp.m('SD'), 'correction', pg_temp.avec(pg_temp.base(), pg_temp.champ('siret', 'SIRET')));
select throws_ok($$select public.accepter_suggestion_ia(pg_temp.m('SD'))$$, 'P0001', 'proposition non conforme',
	'12 — l''acceptation est refusée tant que common_field demeure');

with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Création 0158 b') returning id)
insert into mesures select 'SC', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SC'), 'correction', pg_temp.base());
insert into mesures select 'WF', public.accepter_suggestion_ia(pg_temp.m('SC'))::text;
reset role;

-- Un champ vivant né avant le champ de l'affaire de même clé, comme un workflow existant peut en porter.
insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
values (pg_temp.m('WF'), pg_temp.id('W'), 'siret', 'SIRET', 'text', '{}', 2);
select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.m('WF')), pg_temp.m('WF')), '',
	'13 — un champ vivant conservé n''est jamais relevé, même s''il reprend un champ de l''affaire');
select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.m('WF')), null), 'common_field',
	'14 — le même champ, dans une création, est relevé : il y serait nouveau');

select * from finish();
rollback;

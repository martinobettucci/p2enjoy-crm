-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.d.2 : les exigences de champ commun d'une proposition de l'assistant —
--           leur forme, leurs trois défauts, leur rendu depuis le workflow vivant, le document cible qui les applique, et
--           l'acceptation d'une création qui les pose
-- @verifies docs/SPEC-ia.md §6.1 et §12.1 (décision 825) ; docs/SPEC-champs-communs.md §5 ; docs/SCHEMA.md « Migration `0160` »
--
-- Le workflow « Cycle commercial standard » (`…0051`) et sa transition `…0071` sont du seed ; Camille (`…0011`)
-- administre l'espace. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Les codes de défaut d'une proposition, triés, pour un workflow donné.
create or replace function pg_temp.codes(p jsonb, w uuid) returns text language sql as $$
	select coalesce(string_agg(d ->> 'code', ',' order by d ->> 'code'), '')
	  from jsonb_array_elements(app.defauts_proposition_ia('5eed0000-0000-4000-8000-000000000001', p, w)) d
$$;

create temp table pg_temp.champ as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
select id from f;
grant select on pg_temp.champ to authenticated;

-- La transition `…0071`, par les clés de ses nœuds.
create temp table pg_temp.arete as
select nd.key as de, nv.key as vers
  from public.workflow_transitions t
  join public.workflow_steps sd on sd.id = t.from_step_id join public.workflow_nodes_catalog nd on nd.id = sd.node_id
  join public.workflow_steps sv on sv.id = t.to_step_id join public.workflow_nodes_catalog nv on nv.id = sv.node_id
 where t.id = '5eed0000-0000-4000-8000-000000000071';

create temp table pg_temp.vivante as select public.proposition_du_workflow('5eed0000-0000-4000-8000-000000000051') as p;
grant select on pg_temp.vivante, pg_temp.arete to authenticated;

-- 1. La forme
select ok(not ((select p from pg_temp.vivante) ? 'exigences_communes'),
	'1 — sans exigence de champ commun, le rendu du vivant n''a pas la clé');
select ok(app.proposition_ia_bien_formee((select p from pg_temp.vivante) || jsonb_build_object('exigences_communes',
	jsonb_build_array(jsonb_build_object('de', 'a', 'vers', 'b', 'champ', 'c')))),
	'2 — une liste d''exigences communes bien formée est acceptée');
select ok(not app.proposition_ia_bien_formee((select p from pg_temp.vivante) || '{"exigences_communes": "siret"}'::jsonb),
	'3 — une liste qui n''est pas un tableau n''a pas la forme');

-- 2. Les trois défauts
create temp table pg_temp.avec as
select (select p from pg_temp.vivante) || jsonb_build_object('exigences_communes', jsonb_build_array(
	jsonb_build_object('de', (select de from pg_temp.arete), 'vers', (select vers from pg_temp.arete), 'champ', 'tst-siret'))) as p;
grant select on pg_temp.avec to authenticated;
select is(pg_temp.codes((select p from pg_temp.avec), '5eed0000-0000-4000-8000-000000000051'), '',
	'4 — une exigence d''un champ commun existant, sur une transition de la proposition : aucun défaut');
select is(pg_temp.codes((select p from pg_temp.vivante) || jsonb_build_object('exigences_communes', jsonb_build_array(
	jsonb_build_object('de', (select de from pg_temp.arete), 'vers', (select vers from pg_temp.arete), 'champ', 'inconnu'))),
	'5eed0000-0000-4000-8000-000000000051'),
	'exigence_champ_commun_absent', '5 — une clé qui n''est pas un champ commun de l''espace : exigence_champ_commun_absent');
select is(pg_temp.codes((select p from pg_temp.vivante) || jsonb_build_object('exigences_communes', jsonb_build_array(
	jsonb_build_object('de', 'nulle-part', 'vers', 'ailleurs', 'champ', 'tst-siret'))),
	'5eed0000-0000-4000-8000-000000000051'),
	'exigence_commune_transition_absente', '6 — une transition absente de la proposition : exigence_commune_transition_absente');
select is(pg_temp.codes((select p from pg_temp.avec) || jsonb_build_object('exigences_communes',
	(select p -> 'exigences_communes' from pg_temp.avec) || (select p -> 'exigences_communes' from pg_temp.avec)),
	'5eed0000-0000-4000-8000-000000000051'),
	'exigence_commune_en_double', '7 — deux exigences identiques : exigence_commune_en_double');

-- 3. Le document cible applique la proposition qui porte la clé
select is(
	app.document_cible_ia('5eed0000-0000-4000-8000-000000000051', (select p from pg_temp.avec)) -> 'required_common_fields',
	jsonb_build_array(jsonb_build_object('transition_id', '5eed0000-0000-4000-8000-000000000071',
	                                     'common_field_id', (select id from pg_temp.champ), 'key', 'tst-siret')),
	'8 — la proposition qui exige le champ commun le pose dans le document cible, résolu dans l''espace');

insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
select '5eed0000-0000-4000-8000-000000000071', id from pg_temp.champ;
select is(
	(public.proposition_du_workflow('5eed0000-0000-4000-8000-000000000051') -> 'exigences_communes'),
	jsonb_build_array(jsonb_build_object('de', (select de from pg_temp.arete), 'vers', (select vers from pg_temp.arete), 'champ', 'tst-siret')),
	'9 — le rendu du vivant porte l''exigence, par clés');
select ok(
	not (app.document_cible_ia('5eed0000-0000-4000-8000-000000000051',
	        (select p from pg_temp.vivante) || '{"exigences_communes": []}'::jsonb) ? 'required_common_fields'),
	'10 — une proposition qui porte une liste VIDE retire l''exigence : elle décide');
select ok(
	app.document_cible_ia('5eed0000-0000-4000-8000-000000000051', (select p from pg_temp.vivante)) ? 'required_common_fields',
	'11 — une proposition sans la clé (révision antérieure) garde l''exigence vivante');

-- 4. L'acceptation d'une CRÉATION pose l'exigence sur le workflow créé
create temp table pg_temp.suggestion (id uuid);
grant select, insert on pg_temp.suggestion to authenticated;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande)
              values ('5eed0000-0000-4000-8000-000000000001', 'workflow', 'Sonde CRM-112 T2.d.2') returning id)
insert into pg_temp.suggestion select id from cree;
-- Une CRÉATION refuse un champ qui doublonne une information native (`native_field`) : le champ `contact-principal`
-- du seed, toléré dans une modification, est retiré avec ce qui le vise.
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
select (select id from pg_temp.suggestion), 'correction',
       jsonb_set(jsonb_set(jsonb_set(jsonb_set((select p from pg_temp.avec), '{workflow,nom}', '"Copie de preuve CRM-112"'),
         '{champs}', coalesce((select jsonb_agg(c) from jsonb_array_elements((select p from pg_temp.avec) -> 'champs') c
                                where c ->> 'cle' <> 'contact-principal'), '[]'::jsonb)),
         '{regles}', coalesce((select jsonb_agg(r) from jsonb_array_elements((select p from pg_temp.avec) -> 'regles') r
                                where r ->> 'champ' <> 'contact-principal'), '[]'::jsonb)),
         '{exigences}', coalesce((select jsonb_agg(x) from jsonb_array_elements((select p from pg_temp.avec) -> 'exigences') x
                                   where x ->> 'champ' <> 'contact-principal'), '[]'::jsonb));
create temp table pg_temp.cree as select public.accepter_suggestion_ia((select id from pg_temp.suggestion)) as w;
reset role;
select is(
	(select count(*)::int from public.workflow_transition_required_common_fields rc
	   join public.workflow_transitions t on t.id = rc.transition_id
	  where t.workflow_id = (select w from pg_temp.cree) and rc.common_field_id = (select id from pg_temp.champ)),
	1, '12 — accepter une création pose l''exigence de champ commun sur le workflow créé');

select * from finish();
rollback;

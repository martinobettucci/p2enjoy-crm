-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.d.0 : accepter une suggestion de l'assistant garde les champs communs
--           exigés — le document cible reprend les exigences vivantes des transitions gardées, et rien quand il n'y en a
--           pas
-- @verifies docs/SPEC-champs-communs.md §5 ; docs/SPEC-ia.md §14 ; docs/SCHEMA.md « Migration `0159` »
--
-- Le workflow « Cycle commercial standard » (`…0051`) et sa transition `…0071` sont du seed. Le `rollback` final rend la
-- base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
	not (app.document_cible_ia('5eed0000-0000-4000-8000-000000000051',
	                           public.proposition_du_workflow('5eed0000-0000-4000-8000-000000000051')) ? 'required_common_fields'),
	'1 — sans exigence de champ commun, le document cible n''a pas la clé');

create temp table pg_temp.champ as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
select id from f;
insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
select '5eed0000-0000-4000-8000-000000000071', id from pg_temp.champ;

-- La proposition qui reproduit le workflow vivant : celle qu'une suggestion acceptée sans changement appliquerait.
create temp table pg_temp.cible as
	select app.document_cible_ia('5eed0000-0000-4000-8000-000000000051',
	                             public.proposition_du_workflow('5eed0000-0000-4000-8000-000000000051')) as d;

select is(
	(select d -> 'required_common_fields' from pg_temp.cible),
	jsonb_build_array(jsonb_build_object(
		'transition_id', '5eed0000-0000-4000-8000-000000000071',
		'common_field_id', (select id from pg_temp.champ),
		'key', 'tst-siret')),
	'2 — le document cible reprend l''exigence vivante de la transition gardée');

select lives_ok(
	$$ select app.appliquer_composition('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
	                                    (select d from pg_temp.cible), null) $$,
	'3 — le document cible s''applique');

select ok(
	exists (select 1 from public.workflow_transition_required_common_fields
	         where transition_id = '5eed0000-0000-4000-8000-000000000071' and common_field_id = (select id from pg_temp.champ)),
	'4 — appliquée, la proposition laisse l''exigence du champ commun en place');

select * from finish();
rollback;

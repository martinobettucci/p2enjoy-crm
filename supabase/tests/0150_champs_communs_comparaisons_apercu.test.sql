-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T8 : la copie ne perd que l'exigence de la preuve, le seed exigeant aussi `siret`
--           (docs/SPEC-seed.md §38, décision 855)
-- @verifies CRM-112 (docs/BACKLOG.md) — tranches T2.c.2 et T3.b : les champs communs exigés dans les deux comparaisons de
--           versions (INC-344 : la version qui n'en diffère que par eux n'est plus « différente et vide »), et l'aperçu
--           des effets d'une exigence commune, sous la lecture de l'appelant
-- @verifies docs/SPEC-champs-communs.md §5 et §7 (précisions T2.c.2 et T3.b) ; docs/SPEC-workflow-engine.md §7 bis.13,
--           §7 ter.11 ; docs/SCHEMA.md « Migration `0161` »
--
-- Le workflow « Cycle commercial standard » (`…0051`), sa transition `…0071` et le track `…0023` sont du seed ; Camille
-- (`…0011`) administre l'espace. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);


create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.champ as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
select id from f;
grant select on pg_temp.champ to authenticated;

-- La dernière version publiée est la base ; l'exigence posée, une nouvelle version est la cible.
create temp table pg_temp.base as
	select id from public.workflow_versions
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number desc limit 1;
insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
select '5eed0000-0000-4000-8000-000000000071', id from pg_temp.champ;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.publish_workflow_version('5eed0000-0000-4000-8000-000000000051', 'preuve CRM-112 T2.c.2');
reset role;
create temp table pg_temp.cible as
	select id from public.workflow_versions
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number desc limit 1;
grant select on pg_temp.base, pg_temp.cible to authenticated;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.comparaison as
	select public.compare_workflow_versions((select id from pg_temp.base), (select id from pg_temp.cible)) as c;
reset role;

select is((select c -> 'summary' from pg_temp.comparaison), '{"added": 1, "removed": 0, "modified": 0}'::jsonb,
	'1 — INC-344 : la version qui ne diffère que par une exigence commune compte UN ajout');
select is((select c -> 'changes' -> 'required_common_fields' -> 'added' -> 0 -> 'identity' from pg_temp.comparaison),
	jsonb_build_object('transition_id', '5eed0000-0000-4000-8000-000000000071', 'common_field_id', (select id from pg_temp.champ)),
	'2 — l''identité d''une exigence commune est le couple transition × champ commun');
select is((select c -> 'changes' -> 'required_common_fields' -> 'added' -> 0 -> 'element' ->> 'key' from pg_temp.comparaison),
	'tst-siret', '3 — l''élément porte la clé du champ, qui le nomme à l''écran');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select public.compare_workflow_versions((select id from pg_temp.cible), (select id from pg_temp.cible)) -> 'changes'
	        -> 'required_common_fields'),
	'{"added": [], "removed": [], "modified": []}'::jsonb,
	'4 — une version comparée à elle-même : la collection est rendue, vide');

-- La copie vers un track garde l'exigence : identique à sa source ; l'exigence retirée de la copie s'y lit retirée.
create temp table pg_temp.copie as
	select public.copy_workflow_to_track('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000023', 'Copie de preuve CRM-112 T2.c.2') as id;
select ok((public.compare_workflow_with_source((select id from pg_temp.copie)) ->> 'identical')::boolean,
	'5 — la copie qui garde l''exigence commune est identique à sa source');
reset role;
-- RÉVISÉ PAR `CRM-112` T8 : seule l'exigence de la preuve est retirée de la copie — celle du seed (`siret`) y reste.
delete from public.workflow_transition_required_common_fields r
 using public.workflow_transitions t
 where t.id = r.transition_id and t.workflow_id = (select id from pg_temp.copie)
   and r.common_field_id = (select id from pg_temp.champ);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.divergence as select public.compare_workflow_with_source((select id from pg_temp.copie)) as c;
select is((select c -> 'summary' from pg_temp.divergence), '{"added": 0, "removed": 1, "modified": 0}'::jsonb,
	'6 — retirée de la copie, l''exigence commune se lit retirée par rapport à la source');
select is((select c -> 'changes' -> 'required_common_fields' -> 'removed' -> 0 -> 'identity' ->> 'common_field_key' from pg_temp.divergence),
	'tst-siret', '7 — l''identité naturelle porte la clé du champ commun');

-- L'aperçu : les affaires dont un rattachement est à l'étape de départ de `…0071`, sans valeur commune.
create temp table pg_temp.depart as
	select count(distinct p.card_id)::bigint as n
	  from public.workflow_transitions t
	  join public.card_placements p on p.current_step_id = t.from_step_id and p.archived_at is null
	 where t.id = '5eed0000-0000-4000-8000-000000000071';
select is((select at_entry from public.preview_common_field_requirement((select id from pg_temp.champ), '5eed0000-0000-4000-8000-000000000071')),
	(select n from pg_temp.depart),
	'8 — l''aperçu compte les affaires lisibles à l''étape de départ dont la valeur commune est vide');
reset role;
select ok((select n from pg_temp.depart) > 0, '9 — le seed porte des affaires à l''étape de départ : la mesure n''est pas triviale');

select is((select at_entry from public.preview_common_field_requirement(gen_random_uuid(), '5eed0000-0000-4000-8000-000000000071')),
	0::bigint, '10 — un champ inconnu rend 0');

select * from finish();
rollback;

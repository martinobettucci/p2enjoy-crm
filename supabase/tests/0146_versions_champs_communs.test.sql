-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T8 : indépendante de l'exigence `siret` que pose le seed (docs/SPEC-seed.md §38)
-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.c.1 : les champs communs exigés dans les versions et les copies — la
--           photographie par identifiant et clé (et rien quand rien n'est exigé : l'empreinte ne bouge pas), la
--           restauration qui rétablit l'exigence et refuse un champ archivé, la copie vers un track, le journal d'audit
-- @verifies docs/SPEC-champs-communs.md §5 ; docs/SPEC-workflow-engine.md §7 ter ; docs/SCHEMA.md « Migration `0157` »
--
-- Le workflow « Cycle commercial standard » (`…0051`, global) et sa transition `…0071` sont du seed. Camille (`…0011`)
-- publie, restaure et copie. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- `CRM-112` T8 (docs/SPEC-seed.md §38, décision 855) : le seed exige `siret` vers Signature, dans le workflow par défaut et
-- sa copie. Ces preuves supposent un workflow sans exigence commune : elles retirent celles du seed, dans leur transaction.
delete from public.workflow_transition_required_common_fields
 where common_field_id in (select f.id from public.card_common_fields f
                            where f.workspace_id = '5eed0000-0000-4000-8000-000000000001' and f.key = 'siret');


create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.empreinte_avant as
	select app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051') as e;

select ok(
	not (app.workflow_composition_document('5eed0000-0000-4000-8000-000000000051') ? 'required_common_fields'),
	'1 — sans exigence de champ commun, le document n''a pas la clé : l''empreinte des compositions existantes ne bouge pas');

create temp table pg_temp.champ as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
select id from f;
grant select on pg_temp.champ to authenticated;
insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
select '5eed0000-0000-4000-8000-000000000071', id from pg_temp.champ;

select is(
	app.workflow_composition_document('5eed0000-0000-4000-8000-000000000051') -> 'required_common_fields',
	jsonb_build_array(jsonb_build_object(
		'transition_id', '5eed0000-0000-4000-8000-000000000071',
		'common_field_id', (select id from pg_temp.champ),
		'key', 'tst-siret')),
	'2 — l''exigence est photographiée par identifiant et par clé');

select ok(
	exists (select 1 from public.audit_log
	         where entity_id = '5eed0000-0000-4000-8000-000000000071'
	           and details ->> 'required_common_field_added' = 'tst-siret'),
	'3 — la pose de l''exigence est inscrite au journal d''audit, la clé du champ dans le détail');

-- Publier, retirer l'exigence, restaurer : elle revient.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.publish_workflow_version('5eed0000-0000-4000-8000-000000000051', 'preuve CRM-112 T2.c.1');
reset role;
create temp table pg_temp.version as
	select id from public.workflow_versions
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number desc limit 1;
grant select on pg_temp.version to authenticated;
delete from public.workflow_transition_required_common_fields where common_field_id = (select id from pg_temp.champ);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	format($$ select public.restore_workflow_version(%L) $$, (select id from pg_temp.version)),
	'4 — la restauration de la version passe');
reset role;
select ok(
	exists (select 1 from public.workflow_transition_required_common_fields
	         where transition_id = '5eed0000-0000-4000-8000-000000000071' and common_field_id = (select id from pg_temp.champ)),
	'5 — la restauration rétablit l''exigence du champ commun');

-- Copier vers un track : l'exigence suit, sur la transition de la copie, avec le même champ commun.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.copie as
	select public.copy_workflow_to_track('5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000023', 'Copie de preuve CRM-112') as id;
reset role;
select is(
	(select count(*)::int from public.workflow_transition_required_common_fields rc
	   join public.workflow_transitions t on t.id = rc.transition_id
	  where t.workflow_id = (select id from pg_temp.copie) and rc.common_field_id = (select id from pg_temp.champ)),
	1, '6 — la copie vers un track porte l''exigence, sur sa propre transition, avec le même champ commun');

-- Un champ archivé ne se rétablit pas : l'exigence retirée, le champ archivé, la restauration est refusée.
delete from public.workflow_transition_required_common_fields where common_field_id = (select id from pg_temp.champ);
update public.card_common_fields set archived_at = now() where id = (select id from pg_temp.champ);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	format($$ select public.restore_workflow_version(%L) $$, (select id from pg_temp.version)),
	'P0001', 'common_field_archived',
	'7 — restaurer une version qui exige un champ commun archivé est refusé');
reset role;

-- Sans exigence, l'empreinte est revenue à celle d'avant : la clé n'existe que lorsqu'elle porte quelque chose.
select is(
	app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051'),
	(select e from pg_temp.empreinte_avant),
	'8 — l''exigence retirée, l''empreinte redevient celle d''avant');

select * from finish();
rollback;

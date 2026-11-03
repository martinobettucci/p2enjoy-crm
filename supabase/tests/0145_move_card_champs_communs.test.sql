-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.b : la sixième vérification de `move_card` lit les champs communs exigés
--           par la transition, sur les valeurs de l'affaire — refus nommé quand la valeur manque ou est vide, passage quand
--           elle est renseignée, une valeur d'une autre affaire ne compte pas, un champ archivé n'est plus exigé
-- @verifies docs/SPEC-champs-communs.md §5 ; docs/SPEC-workflow-engine.md §5.3 ; docs/SCHEMA.md « Migration `0156` »
--
-- Comptes du seed : Camille (administratrice, …0011). Le `rollback` final rend la base intacte, déplacement compris.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Un rattachement actif du seed dont l'étape courante a une transition sortante sans motif exigé, et sans champ de workflow
-- ni point de checklist exigé : seule l'exigence posée ici peut refuser le déplacement.
create temp table pg_temp.cas as
select p.id as placement, p.card_id as affaire, t.id as transition, t.to_step_id as cible
  from public.card_placements p
  join public.cards c on c.id = p.card_id and c.deleted_at is null
  join public.workflow_transitions t on t.workflow_id = p.workflow_id and t.from_step_id = p.current_step_id
 where p.archived_at is null
   and p.workspace_id = '5eed0000-0000-4000-8000-000000000001'
   and not t.require_comment
   and not exists (select 1 from public.workflow_transition_required_fields r where r.transition_id = t.id)
   and not exists (select 1 from public.workflow_transition_required_checklist_items r where r.transition_id = t.id)
   and not exists (select 1 from public.form_field_rules r where r.step_id = t.to_step_id and r.visibility = 'required')
 order by p.created_at, p.id
 limit 1;
grant select on pg_temp.cas to authenticated;

select ok((select count(*) = 1 from pg_temp.cas), '1 — le seed offre un rattachement et une transition libre de toute exigence');

create temp table pg_temp.champ as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type)
	values ('5eed0000-0000-4000-8000-000000000001', 'tst-siret', 'SIRET', 'text') returning id
)
select id from f;
insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
select (select transition from pg_temp.cas), id from pg_temp.champ;

-- Une valeur du même champ sur UNE AUTRE affaire ne satisfait pas l'exigence.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select c.id, (select id from pg_temp.champ), c.workspace_id, '"123"'
  from public.cards c
 where c.workspace_id = '5eed0000-0000-4000-8000-000000000001' and c.id <> (select affaire from pg_temp.cas)
 order by c.created_at, c.id limit 1;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	format($$ select public.move_card(%L, %L) $$, (select placement from pg_temp.cas), (select cible from pg_temp.cas)),
	'P0001', 'missing_required_fields',
	'2 — le champ commun exigé et absent de l''affaire refuse le déplacement, même renseigné sur une autre affaire');
reset role;

-- Le détail nomme la clé du champ commun.
create or replace function pg_temp.detail_du_refus() returns text language plpgsql as $$
declare v_detail text;
begin
	perform public.move_card((select placement from pg_temp.cas), (select cible from pg_temp.cas));
	return null;
exception when others then
	get stacked diagnostics v_detail = pg_exception_detail;
	return v_detail;
end;
$$;
select is(pg_temp.detail_du_refus(), 'tst-siret', '3 — le détail du refus nomme la clé du champ commun');

-- Une valeur vide ne compte pas.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select (select affaire from pg_temp.cas), id, '5eed0000-0000-4000-8000-000000000001', '""' from pg_temp.champ;
select is(pg_temp.detail_du_refus(), 'tst-siret', '4 — une valeur vide ne satisfait pas l''exigence');

-- Renseignée sur l'affaire, la valeur ouvre la transition.
update public.card_common_field_values set value = '"123 456 789 00012"'
 where card_id = (select affaire from pg_temp.cas) and field_id = (select id from pg_temp.champ);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select current_step_id from public.move_card((select placement from pg_temp.cas), (select cible from pg_temp.cas))),
	(select cible from pg_temp.cas),
	'5 — renseigné sur l''affaire, le champ commun exigé laisse passer le rattachement');
reset role;

-- Un champ archivé n'est plus exigé : l'exigence retirée puis le champ archivé, la valeur vidée ne refuse plus rien.
delete from public.workflow_transition_required_common_fields where common_field_id = (select id from pg_temp.champ);
update public.card_common_fields set archived_at = now() where id = (select id from pg_temp.champ);
select ok(
	not exists (select 1 from public.workflow_transition_required_common_fields where common_field_id = (select id from pg_temp.champ)),
	'6 — l''exigence retirée, le champ s''archive (§6) et ne pèse plus sur aucune transition');

select * from finish();
rollback;

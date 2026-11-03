-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.d : une valeur commune écrit `field_changed` au fil, `scope: "common"`,
--           sans rattachement ; rien quand la valeur ne change pas ; un champ de workflow garde son rattachement
-- @verifies docs/SPEC-champs-communs.md §7 (précision T3.d) ; docs/SPEC-rattachements.md §5 ; docs/SCHEMA.md « Migration `0163` »
--
-- L'affaire `…00c2` et le champ de workflow `…0081` sont du seed ; Camille (`…0011`) l'écrit. Le `rollback` final rend la
-- base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

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

-- Les événements de l'affaire qui portent sur le champ commun, du plus ancien au plus récent.
create or replace function pg_temp.evenements() returns setof public.card_events language sql as $$
	select * from public.card_events
	 where card_id = '5eed0000-0000-4000-8000-0000000000c2'
	   and type = 'field_changed' and payload ->> 'field_id' = (select id::text from pg_temp.champ)
	 order by created_at, id
$$;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select '5eed0000-0000-4000-8000-0000000000c2', id, '5eed0000-0000-4000-8000-000000000001', '"12345678900011"'::jsonb from pg_temp.champ;
reset role;

select is((select count(*)::int from pg_temp.evenements()), 1, '1 — la première valeur écrit un field_changed');
select is((select payload - 'field_id' from pg_temp.evenements() limit 1), '{"scope": "common", "to": "12345678900011"}'::jsonb,
	'2 — le payload porte scope common et la valeur, sans from pour une insertion');
select ok((select placement_id is null from pg_temp.evenements() limit 1),
	'3 — l''événement de la partie commune n''a pas de rattachement');
select ok((select actor_id = '5eed0000-0000-4000-8000-000000000011' from pg_temp.evenements() limit 1),
	'4 — l''auteur est la personne qui a écrit');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.card_common_field_values set value = '"12345678900011"'::jsonb
 where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = (select id from pg_temp.champ);
update public.card_common_field_values set value = '"98765432100022"'::jsonb
 where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = (select id from pg_temp.champ);
reset role;

select is((select count(*)::int from pg_temp.evenements()), 2, '5 — la même valeur réécrite n''écrit rien ; une valeur changée écrit');
select is((select payload -> 'from' from pg_temp.evenements() offset 1), '"12345678900011"'::jsonb,
	'6 — la mise à jour porte l''ancienne valeur');

-- Un champ de WORKFLOW garde son rattachement : le déclencheur de remplissage ne change que pour la partie commune.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
values ('5eed0000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-000000000086', '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000001', '"https://sonde.test/t3d"'::jsonb)
on conflict (placement_id, field_id) do update set value = excluded.value;
reset role;
select ok(
	(select placement_id is not null from public.card_events
	  where card_id = '5eed0000-0000-4000-8000-0000000000c2' and type = 'field_changed'
	    and payload ->> 'field_id' = '5eed0000-0000-4000-8000-000000000086'
	  order by created_at desc, id desc limit 1),
	'7 — un field_changed de champ de workflow garde son rattachement');

select * from finish();
rollback;

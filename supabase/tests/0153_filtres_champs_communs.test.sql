-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.b : les colonnes de recherche typées des valeurs communes, posées par la
--           base et jamais par l'appelant ; la politique de lecture en semi-jointure rend le même droit que
--           `app.can_read_card`, profil par profil
-- @verifies docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/SCHEMA.md « Migration `0164` » ; docs/JOURNAL.md
--           décision 831 ; CLAUDE.md §10 (la règle d'accès prouvée sous le rôle réel de chaque profil)
--
-- Les champs de sonde portent le préfixe `tst-t4b-` ; une valeur est posée sur chaque affaire de l'espace du seed, sous la
-- clé de service (rôle `postgres`). Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.champs as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type) values
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4b-texte', 'Raison sociale', 'text'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4b-date', 'Échéance', 'date'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4b-instant', 'Rendez-vous', 'datetime'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4b-nombre', 'Effectif', 'number')
	returning id, key
)
select id, key from f;
grant select on pg_temp.champs to authenticated;

create or replace function pg_temp.champ(p_cle text) returns uuid language sql as $$
	select id from pg_temp.champs where key = p_cle
$$;

-- Une valeur de chaque type sur l'affaire `…00c2` ; la date et l'instant dans des formes que la validation accepte sans
-- être de l'ISO strict.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value) values
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4b-texte'), '5eed0000-0000-4000-8000-000000000001', '"Société Élan"'),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4b-date'), '5eed0000-0000-4000-8000-000000000001', '"Jan 8 2026"'),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4b-instant'), '5eed0000-0000-4000-8000-000000000001', '"2026-01-08 23:30:00-02"'),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4b-nombre'), '5eed0000-0000-4000-8000-000000000001', '42');

create or replace function pg_temp.ligne(p_cle text) returns public.card_common_field_values language sql as $$
	select * from public.card_common_field_values
	 where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = pg_temp.champ(p_cle)
$$;

select is((pg_temp.ligne('tst-t4b-texte')).value_search, 'societe elan', '1 — un texte : en minuscules, sans accents');
select is((pg_temp.ligne('tst-t4b-date')).value_date, '2026-01-08'::date, '2 — une date hors ISO strict se lit en date');
select is((pg_temp.ligne('tst-t4b-instant')).value_timestamp, '2026-01-09 01:30:00+00'::timestamptz,
	'3 — un instant se lit avec son décalage');
select ok((pg_temp.ligne('tst-t4b-nombre')).value_search is null and (pg_temp.ligne('tst-t4b-nombre')).value_date is null,
	'4 — un nombre ne pose aucune colonne de recherche : le JSON se compare déjà en nombre');

update public.card_common_field_values set value = '"Atelier Morel"'
 where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = pg_temp.champ('tst-t4b-texte');
select is((pg_temp.ligne('tst-t4b-texte')).value_search, 'atelier morel', '5 — une valeur changée recalcule sa colonne');
update public.card_common_field_values set value = 'null'
 where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = pg_temp.champ('tst-t4b-texte');
select is((pg_temp.ligne('tst-t4b-texte')).value_search, null, '6 — une valeur vidée vide sa colonne');

-- L'appelant n'écrit jamais ces colonnes : aucun privilège, et le déclencheur les recalcule de toute façon.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$update public.card_common_field_values set value_search = 'pirate'
	   where card_id = '5eed0000-0000-4000-8000-0000000000c2' and field_id = pg_temp.champ('tst-t4b-texte')$$,
	'42501', null, '7 — l''administratrice ne peut pas écrire value_search : aucun privilège');
reset role;

-- LA POLITIQUE EN SEMI-JOINTURE REND LE MÊME DROIT QUE `app.can_read_card`. Une valeur sur chaque affaire de l'espace ;
-- pour chaque profil, les affaires dont il lit la valeur sont exactement celles que `app.can_read_card_pour` lui ouvre.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select c.id, pg_temp.champ('tst-t4b-nombre'), c.workspace_id, '1'
  from public.cards c
 where c.workspace_id = '5eed0000-0000-4000-8000-000000000001' and c.id <> '5eed0000-0000-4000-8000-0000000000c2';

create temp table pg_temp.attendu as
select u.id as utilisateur, v.card_id
  from public.card_common_field_values v
 cross join (values ('5eed0000-0000-4000-8000-000000000011'::uuid), ('5eed0000-0000-4000-8000-000000000012'),
                    ('5eed0000-0000-4000-8000-000000000013'), ('5eed0000-0000-4000-8000-000000000018')) u(id)
 where v.field_id = pg_temp.champ('tst-t4b-nombre') and app.can_read_card_pour(v.card_id, u.id);
grant select on pg_temp.attendu to authenticated;
create temp table pg_temp.lu (utilisateur uuid, card_id uuid);
grant insert, select on pg_temp.lu to authenticated;

create or replace function pg_temp.lire_comme(utilisateur uuid) returns void language plpgsql as $$
begin
	perform pg_temp.endosser(utilisateur);
	insert into pg_temp.lu
	select utilisateur, v.card_id from public.card_common_field_values v where v.field_id = pg_temp.champ('tst-t4b-nombre');
	execute 'reset role';
end;
$$;
select pg_temp.lire_comme('5eed0000-0000-4000-8000-000000000011');
select pg_temp.lire_comme('5eed0000-0000-4000-8000-000000000012');
select pg_temp.lire_comme('5eed0000-0000-4000-8000-000000000013');
select pg_temp.lire_comme('5eed0000-0000-4000-8000-000000000018');

select set_eq('select card_id from pg_temp.lu where utilisateur = ''5eed0000-0000-4000-8000-000000000011''',
	'select card_id from pg_temp.attendu where utilisateur = ''5eed0000-0000-4000-8000-000000000011''',
	'8 — Camille (administratrice) lit exactement les valeurs que can_read_card lui ouvre');
select set_eq('select card_id from pg_temp.lu where utilisateur = ''5eed0000-0000-4000-8000-000000000012''',
	'select card_id from pg_temp.attendu where utilisateur = ''5eed0000-0000-4000-8000-000000000012''',
	'9 — Driss (business developer) : le même droit');
select set_eq('select card_id from pg_temp.lu where utilisateur = ''5eed0000-0000-4000-8000-000000000013''',
	'select card_id from pg_temp.attendu where utilisateur = ''5eed0000-0000-4000-8000-000000000013''',
	'10 — Farida (lectrice) : le même droit');
select is((select count(*)::int from pg_temp.lu where utilisateur = '5eed0000-0000-4000-8000-000000000018'), 0,
	'11 — Sabine, hors de l''espace, ne lit aucune valeur');
-- *Mesuré sur le seed* : Camille et Driss lisent les 46 affaires, Farida 40 — c'est elle qui départage les deux règles.
select ok((select count(distinct card_id) from pg_temp.lu where utilisateur = '5eed0000-0000-4000-8000-000000000013')
          < (select count(*) from public.cards where workspace_id = '5eed0000-0000-4000-8000-000000000001')
      and (select count(*) from pg_temp.lu where utilisateur = '5eed0000-0000-4000-8000-000000000013') > 0,
	'12 — (témoin) Farida lit une partie des valeurs, pas toutes : la comparaison n''est pas vide de sens');

-- Sans session, rien.
set local role anon;
select is((select count(*)::int from public.card_common_field_values where field_id = pg_temp.champ('tst-t4b-nombre')), 0,
	'13 — sans session, aucune valeur');
reset role;

select * from finish();
rollback;

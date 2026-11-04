-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.c : les filtres de champ personne, contact et fichier — `any_of` pour une
--           personne ou un contact, `is` « filled » ou « empty » pour un fichier ; `filled` accepté par la forme d'une vue
-- @verifies docs/SPEC-champs-communs.md §8 (précision T4.c) ; docs/SCHEMA.md « Migration `0166` » ; docs/JOURNAL.md décision 839
--
-- Les champs de sonde portent le préfixe `tst-t4c-` ; trois affaires du seed reçoivent des valeurs. Le `rollback` final rend
-- la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(app.saved_view_filters_valid('{"common_fields": {"kbis": {"is": "filled"}}}'::jsonb), '1 — « filled » est une forme acceptée');
select ok(not app.saved_view_filters_valid('{"common_fields": {"kbis": {"is": "plein"}}}'::jsonb), '2 — une autre valeur reste refusée');

create temp table pg_temp.champs as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type, options) values
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4c-referent', 'Référent', 'user', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4c-contact', 'Contact clé', 'contact', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4c-kbis', 'Kbis', 'file', '{}')
	returning id, key
)
select id, key from f;
create or replace function pg_temp.champ(p_cle text) returns uuid language sql as $$ select id from pg_temp.champs where key = p_cle $$;

-- Deux contacts du carnet de l'espace, quels qu'ils soient.
create temp table pg_temp.contacts as
select id, row_number() over (order by id) as rang from public.contacts where workspace_id = '5eed0000-0000-4000-8000-000000000001' order by id limit 2;
create or replace function pg_temp.contact(p_rang int) returns uuid language sql as $$ select id from pg_temp.contacts where rang = p_rang $$;

-- A (…00c1) : Camille, contact 1, un Kbis ; B (…00c2) : Driss, contact 2, un Kbis vide ("") ; C (…00c3) : rien.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value) values
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t4c-referent'), '5eed0000-0000-4000-8000-000000000001', '"5eed0000-0000-4000-8000-000000000011"'),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t4c-contact'), '5eed0000-0000-4000-8000-000000000001', to_jsonb(pg_temp.contact(1)::text)),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t4c-kbis'), '5eed0000-0000-4000-8000-000000000001', '"kbis-sogexia.pdf"'),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4c-referent'), '5eed0000-0000-4000-8000-000000000001', '"5eed0000-0000-4000-8000-000000000012"'),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4c-contact'), '5eed0000-0000-4000-8000-000000000001', to_jsonb(pg_temp.contact(2)::text)),
	('5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ('tst-t4c-kbis'), '5eed0000-0000-4000-8000-000000000001', '""');

create or replace function pg_temp.passent(p_filtres jsonb) returns text language sql as $$
	select coalesce(string_agg(lettre, '' order by lettre), '')
	  from (values ('A', '5eed0000-0000-4000-8000-0000000000c1'::uuid), ('B', '5eed0000-0000-4000-8000-0000000000c2'::uuid),
	               ('C', '5eed0000-0000-4000-8000-0000000000c3'::uuid)) t(lettre, card)
	 where app.card_common_filters_match(card, p_filtres, 'UTC')
$$;

select is(pg_temp.passent('{"tst-t4c-referent": {"any_of": ["5eed0000-0000-4000-8000-000000000012"]}}'), 'B', '3 — est cette personne');
select is(pg_temp.passent(jsonb_build_object('tst-t4c-contact', jsonb_build_object('any_of', jsonb_build_array(pg_temp.contact(1)::text)))), 'A',
	'4 — est ce contact');
select is(pg_temp.passent('{"tst-t4c-kbis": {"is": "filled"}}'), 'A', '5 — fichier renseigné : ni nul, ni chaîne vide');
select is(pg_temp.passent('{"tst-t4c-kbis": {"is": "empty"}}'), 'BC', '6 — fichier vide : une chaîne vide ou aucune valeur');
select is(pg_temp.passent('{"tst-t4c-kbis": {"is": "yes"}}'), 'ABC', '7 — une forme de case sur un fichier est ignorée');
select is(pg_temp.passent('{"tst-t4c-referent": {"contains": "Camille"}}'), 'ABC', '8 — « contient » sur une personne est ignoré');
select is(pg_temp.passent('{"tst-t4c-kbis": {"is": "filled"}, "tst-t4c-referent": {"any_of": ["5eed0000-0000-4000-8000-000000000011"]}}'), 'A',
	'9 — deux filtres se combinent');

select * from finish();
rollback;

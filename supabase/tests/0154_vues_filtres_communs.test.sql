-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.d.1 : la forme `common_fields` et `time_zone` d'une vue, validées par la
--           base ; leur interprétation type par type ; `export_cards` qui les applique, le fuseau inconnu refusé, la RLS
--           de la personne respectée
-- @verifies docs/SPEC-champs-communs.md §8 (précision T4.d) ; docs/SPEC-vues-import-export.md §2.2 ; docs/SCHEMA.md
--           « Migration `0165` » ; docs/JOURNAL.md décision 838 ; CLAUDE.md §10
--
-- Les champs de sonde portent le préfixe `tst-t4d-` ; trois affaires du channel « Grands comptes » du seed reçoivent des
-- valeurs. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- --- La forme ---------------------------------------------------------------------------------------------------
select ok(app.saved_view_filters_valid('{"common_fields": {"siret": {"contains": "elan"}, "ca": {"min": 1000, "max": null},
	"secteur": {"any_of": ["btp"]}, "echeance": {"from": "2026-01-01", "to": null}, "signe": {"is": "empty"}},
	"time_zone": "Europe/Paris"}'::jsonb), '1 — les cinq formes et un fuseau sont acceptés');
select ok(not app.saved_view_filters_valid('{"common_fields": {"siret": {"contains": "x", "any_of": ["a"]}}}'::jsonb),
	'2 — deux formes à la fois : refusé');
select ok(not app.saved_view_filters_valid('{"common_fields": {"ca": {"min": null, "max": null}}}'::jsonb),
	'3 — des bornes toutes nulles : refusé');
select ok(not app.saved_view_filters_valid('{"common_fields": {"Mauvaise Cle": {"is": "yes"}}}'::jsonb),
	'4 — une clé hors de la forme d''une clé de champ : refusé');
select ok(not app.saved_view_filters_valid('{"common_fields": {"d": {"from": "01/01/2026"}}}'::jsonb),
	'5 — une date hors de la forme AAAA-MM-JJ : refusé');
select ok(not app.saved_view_filters_valid('{"time_zone": "Europe/Paris; drop"}'::jsonb),
	'6 — un fuseau hors de la forme d''un nom IANA : refusé');
select throws_ok(
	$$insert into public.saved_views (workspace_id, channel_id, owner_id, name, visibility, filters)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000032',
	          '5eed0000-0000-4000-8000-000000000011', 'tst-t4d', 'private', '{"common_fields": {"x": {"is": "maybe"}}}')$$,
	'23514', null, '7 — la contrainte de la table refuse une forme invalide');

-- --- L'interprétation, type par type ------------------------------------------------------------------------------
create temp table pg_temp.champs as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type, options) values
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-texte', 'Raison sociale', 'text', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-choix', 'Secteur', 'select', '{"choices": [{"key": "btp", "label": "BTP"}, {"key": "sante", "label": "Santé"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-multi', 'Tags', 'multiselect', '{"choices": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-ca', 'CA', 'money', '{"currency": "EUR"}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-instant', 'Rendez-vous', 'datetime', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t4d-case', 'Signé', 'checkbox', '{}')
	returning id, key
)
select id, key from f;

create or replace function pg_temp.champ(p_cle text) returns uuid language sql as $$ select id from pg_temp.champs where key = p_cle $$;

-- A (…00c1) : « Société Élan », btp, [a], 12 000, 2026-01-08 23:30 UTC, signé ; B (…00c2) : « Atelier Morel », sante, [b],
-- 3 000, aucune case ; C (…00c3) : aucune valeur.
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select v.card_id::uuid, pg_temp.champ(v.cle), '5eed0000-0000-4000-8000-000000000001', v.valeur::jsonb
  from (values
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-texte', '"Société Élan"'),
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-choix', '"btp"'),
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-multi', '["a"]'),
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-ca', '12000'),
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-instant', '"2026-01-08T23:30:00Z"'),
	('5eed0000-0000-4000-8000-0000000000c1', 'tst-t4d-case', 'true'),
	('5eed0000-0000-4000-8000-0000000000c2', 'tst-t4d-texte', '"Atelier Morel"'),
	('5eed0000-0000-4000-8000-0000000000c2', 'tst-t4d-choix', '"sante"'),
	('5eed0000-0000-4000-8000-0000000000c2', 'tst-t4d-multi', '["b"]'),
	('5eed0000-0000-4000-8000-0000000000c2', 'tst-t4d-ca', '3000')
  ) as v(card_id, cle, valeur);

create or replace function pg_temp.passent(p_filtres jsonb, p_fuseau text default 'UTC') returns text language sql as $$
	select coalesce(string_agg(lettre, '' order by lettre), '')
	  from (values ('A', '5eed0000-0000-4000-8000-0000000000c1'::uuid), ('B', '5eed0000-0000-4000-8000-0000000000c2'::uuid),
	               ('C', '5eed0000-0000-4000-8000-0000000000c3'::uuid)) t(lettre, card)
	 where app.card_common_filters_match(card, p_filtres, p_fuseau)
$$;

select is(pg_temp.passent('{"tst-t4d-texte": {"contains": "ELAN"}}'), 'A', '8 — contient : sans casse ni accents');
select is(pg_temp.passent('{"tst-t4d-texte": {"contains": "50%"}}'), '', '9 — contient : % est un caractère, pas un joker');
select is(pg_temp.passent('{"tst-t4d-choix": {"any_of": ["sante", "inconnu"]}}'), 'B', '10 — un choix parmi des clés');
select is(pg_temp.passent('{"tst-t4d-multi": {"any_of": ["a", "b"]}}'), 'AB', '11 — choix multiple : contient l''une des clés');
select is(pg_temp.passent('{"tst-t4d-ca": {"min": 3000, "max": 3000}}'), 'B', '12 — des bornes incluses');
select is(pg_temp.passent('{"tst-t4d-ca": {"min": 10000}}'), 'A', '13 — une seule borne');
select is(pg_temp.passent('{"tst-t4d-instant": {"from": "2026-01-08", "to": "2026-01-08"}}', 'UTC'), 'A',
	'14 — une date et heure lue en UTC : le 8 janvier');
select is(pg_temp.passent('{"tst-t4d-instant": {"from": "2026-01-08", "to": "2026-01-08"}}', 'Europe/Paris'), '',
	'15 — la même lue à Paris : le 9 janvier, hors du filtre');
select is(pg_temp.passent('{"tst-t4d-case": {"is": "empty"}}'), 'BC', '16 — case vide : sans valeur ou sans ligne');
select is(pg_temp.passent('{"tst-t4d-case": {"is": "yes"}, "tst-t4d-choix": {"any_of": ["btp"]}}'), 'A', '17 — deux filtres se combinent');
select is(pg_temp.passent('{"tst-t4d-ca": {"contains": "12"}, "inconnu": {"is": "yes"}}'), 'ABC',
	'18 — une forme hors type et une clé inconnue sont ignorées');

-- --- L'export ---------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select set_eq(
	$$select card_id from public.export_cards('5eed0000-0000-4000-8000-000000000032',
	   '{"common_fields": {"tst-t4d-choix": {"any_of": ["btp", "sante"]}}, "time_zone": "Europe/Paris"}')$$,
	$$values ('5eed0000-0000-4000-8000-0000000000c1'::uuid), ('5eed0000-0000-4000-8000-0000000000c2'::uuid)$$,
	'19 — l''export de Camille applique les filtres de champ');
select throws_ok(
	$$select * from public.export_cards('5eed0000-0000-4000-8000-000000000032', '{"time_zone": "Mars/Olympus"}')$$,
	'22023', 'invalid_filters', '20 — un fuseau inconnu est refusé');
reset role;

-- La RLS de la personne : Farida ne lit pas « Grands comptes » ; l'export lui répond « introuvable ».
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok(
	$$select * from public.export_cards('5eed0000-0000-4000-8000-000000000032',
	   '{"common_fields": {"tst-t4d-choix": {"any_of": ["btp"]}}}')$$,
	null, null, '21 — la lectrice sans droit sur le channel n''exporte rien');
-- Et la fonction d'interprétation, sous son rôle, ne voit pas les valeurs : une case « oui » ne passe pas.
select is(app.card_common_filters_match('5eed0000-0000-4000-8000-0000000000c1', '{"tst-t4d-case": {"is": "yes"}}', 'UTC'), false,
	'22 — security invoker : sous la lectrice, la valeur de A est illisible, le filtre « oui » ne passe pas');
reset role;

select * from finish();
rollback;

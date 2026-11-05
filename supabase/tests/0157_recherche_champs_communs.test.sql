-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T6 : la recherche globale par les champs de l'affaire — `value_tsv` posée
--           par la base pour les seuls types textuels et les libellés des choix, indexée, recalculée quand les choix
--           changent ; la famille `affaire` trouve par un champ actif et l'extrait le nomme ; les droits restent ceux de
--           l'affaire (`security invoker`)
-- @verifies docs/SPEC-champs-communs.md §10 (précision T6) ; docs/SPEC-recherche.md §6.3, §6.5 ;
--           docs/SCHEMA.md « Migration `0168` » ; docs/JOURNAL.md décision 844 ; CLAUDE.md §10
--
-- Les champs de sonde portent le préfixe `tst-t6-`. L'affaire `…00c1` (« Refonte du site vitrine », channel « Grands
-- comptes ») est lue par l'administratrice et NE l'est PAS par la lectrice (suite 0065, §2 M6) : elle reçoit les valeurs.
-- Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.champs as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type, options) values
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-siret', 'SIRET', 'text', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-site', 'Site', 'url', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-effectif', 'Effectif', 'number', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-secteur', 'Secteur', 'select',
		 '{"choices": [{"key": "btp", "label": "Bâtiment"}, {"key": "sante", "label": "Santé"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-labels', 'Labels', 'multiselect',
		 '{"choices": [{"key": "a", "label": "Écolabel"}, {"key": "b", "label": "Qualiopi"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t6-ancien', 'Ancien', 'text', '{}')
	returning id, key
)
select id, key from f;
grant select on pg_temp.champs to authenticated;
create or replace function pg_temp.champ(p_cle text) returns uuid language sql as $$ select id from pg_temp.champs where key = p_cle $$;

insert into public.card_common_field_values (card_id, field_id, workspace_id, value) values
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t6-siret'), '5eed0000-0000-4000-8000-000000000001', '"Zorglub 552 100 554"'),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t6-effectif'), '5eed0000-0000-4000-8000-000000000001', '48213'),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t6-secteur'), '5eed0000-0000-4000-8000-000000000001', '"btp"'),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t6-labels'), '5eed0000-0000-4000-8000-000000000001', '["a", "b"]'),
	('5eed0000-0000-4000-8000-0000000000c1', pg_temp.champ('tst-t6-ancien'), '5eed0000-0000-4000-8000-000000000001', '"Archivix"');
update public.card_common_fields set archived_at = now() where id = pg_temp.champ('tst-t6-ancien');

create or replace function pg_temp.tsv(p_cle text) returns tsvector language sql as $$
	select v.value_tsv from public.card_common_field_values v
	 where v.card_id = '5eed0000-0000-4000-8000-0000000000c1' and v.field_id = pg_temp.champ(p_cle)
$$;

-- --- La colonne et son index ------------------------------------------------------------------------------------
select has_column('public', 'card_common_field_values', 'value_tsv', '1 — `value_tsv` existe');
select ok(
	(select i.indexdef like '%USING gin (value_tsv)%' from pg_indexes i
	  where i.schemaname = 'public' and i.indexname = 'card_common_field_values_value_tsv_idx'),
	'2 — un index GIN sert `value_tsv`');

-- --- Ce que la base pose ----------------------------------------------------------------------------------------
select ok(pg_temp.tsv('tst-t6-siret') @@ to_tsquery('app.francais_sans_accent', 'zorglub'),
	'3 — un texte est cherchable');
select is(pg_temp.tsv('tst-t6-effectif'), null, '4 — un nombre n''est pas indexé : `value_tsv` reste nulle');
select ok(pg_temp.tsv('tst-t6-secteur') @@ to_tsquery('app.francais_sans_accent', 'batiment')
          and not pg_temp.tsv('tst-t6-secteur') @@ to_tsquery('app.francais_sans_accent', 'btp'),
	'5 — un choix est cherchable par son LIBELLÉ, désaccentué, et non par sa clé');
select ok(pg_temp.tsv('tst-t6-labels') @@ to_tsquery('app.francais_sans_accent', 'ecolabel & qualiopi'),
	'6 — un choix multiple est cherchable par tous ses libellés');
update public.card_common_field_values set value_tsv = to_tsvector('simple', 'falsifie')
 where card_id = '5eed0000-0000-4000-8000-0000000000c1' and field_id = pg_temp.champ('tst-t6-siret');
select ok(not pg_temp.tsv('tst-t6-siret') @@ to_tsquery('simple', 'falsifie')
          and pg_temp.tsv('tst-t6-siret') @@ to_tsquery('app.francais_sans_accent', 'zorglub'),
	'7 — l''appelant n''écrit pas `value_tsv` : le déclencheur la recalcule depuis la valeur');

-- Les libellés des choix changent : les valeurs du champ suivent, sans être revalidées ni redatées.
-- `now()` est figé dans la transaction : la date d'avant est posée dans le passé, déclencheur suspendu, pour que la preuve
-- distingue une valeur redatée d'une valeur intacte.
alter table public.card_common_field_values disable trigger card_common_field_values_validate;
update public.card_common_field_values set updated_at = '2026-01-01T00:00:00Z'
 where card_id = '5eed0000-0000-4000-8000-0000000000c1' and field_id = pg_temp.champ('tst-t6-secteur');
alter table public.card_common_field_values enable trigger card_common_field_values_validate;
update public.card_common_fields
   set options = '{"choices": [{"key": "btp", "label": "Construction"}, {"key": "sante", "label": "Santé"}]}'
 where id = pg_temp.champ('tst-t6-secteur');
select ok(pg_temp.tsv('tst-t6-secteur') @@ to_tsquery('app.francais_sans_accent', 'construction')
          and not pg_temp.tsv('tst-t6-secteur') @@ to_tsquery('app.francais_sans_accent', 'batiment'),
	'8 — un libellé de choix renommé : `value_tsv` est recalculée pour les valeurs du champ');
select is(
	(select v.updated_at from public.card_common_field_values v
	  where v.card_id = '5eed0000-0000-4000-8000-0000000000c1' and v.field_id = pg_temp.champ('tst-t6-secteur')),
	'2026-01-01T00:00:00Z'::timestamptz,
	'9 — le recalcul ne redate pas la valeur : elle n''a pas changé');

-- --- La recherche globale, sous les droits d'une personne ---------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select results_eq(
	$$ select objet, id, extrait from public.recherche_globale('zorglub', 20) $$,
	$$ values ('affaire'::text, '5eed0000-0000-4000-8000-0000000000c1'::uuid, 'SIRET : Zorglub 552 100 554'::text) $$,
	'10 — l''administratrice trouve l''affaire par un champ texte, et l''extrait nomme le champ');
select results_eq(
	$$ select extrait from public.recherche_globale('construction', 20) where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	$$ values ('Secteur : Construction'::text) $$,
	'11 — un choix trouvé par son libellé : l''extrait rend le libellé, jamais la clé');
select results_eq(
	$$ select extrait from public.recherche_globale('qualiopi', 20) where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	$$ values ('Labels : Écolabel, Qualiopi'::text) $$,
	'12 — un choix multiple : l''extrait rend ses libellés');
select is(
	(select count(*)::int from public.recherche_globale('48213', 20) where id = '5eed0000-0000-4000-8000-0000000000c1'), 0,
	'13 — un nombre ne se cherche pas');
select is(
	(select count(*)::int from public.recherche_globale('archivix', 20)), 0,
	'14 — un champ archivé ne fait plus trouver l''affaire');
select results_eq(
	$$ select extrait from public.recherche_globale('vitrine', 20) where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	$$ values (null::text) $$,
	'15 — une affaire trouvée par son titre seulement garde un extrait nul');
reset role;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.recherche_globale('zorglub', 20)), 0,
	'16 — la lectrice, qui ne lit pas l''affaire, ne la trouve pas par son champ : zéro ligne, jamais une erreur');
reset role;

select lives_ok(
	$$ update public.card_common_fields set options = '{"choices": [{"key": "sante", "label": "Santé"}]}'
	    where id = pg_temp.champ('tst-t6-secteur') $$,
	'17 — retirer un choix encore employé reste permis : le recalcul ne revalide pas les valeurs');

-- --- La fonction reste ce qu'elle était --------------------------------------------------------------------------
select ok(
	not (select p.prosecdef from pg_proc p where p.oid = 'public.recherche_globale(text, integer)'::regprocedure),
	'18 — `recherche_globale` reste `security invoker`');
select ok(
	has_function_privilege('authenticated', 'public.recherche_globale(text, integer)', 'execute')
	and not has_function_privilege('anon', 'public.recherche_globale(text, integer)', 'execute'),
	'19 — exécutable par `authenticated`, jamais par `anon`');
select ok(
	not has_function_privilege('authenticated', 'app.card_common_value_tsv(text, jsonb, jsonb)', 'execute')
	and not has_function_privilege('authenticated', 'app.card_common_fields_recompute_tsv()', 'execute'),
	'20 — les deux fonctions internes ne sont pas exposées');

select * from finish();
rollback;

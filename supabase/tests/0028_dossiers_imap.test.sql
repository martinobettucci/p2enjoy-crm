-- @verifies CRM-056 (docs/BACKLOG.md) — dossiers IMAP imbriqués
-- @verifies docs/SPEC-mail-subsystem.md §4.5 (dossiers, renommage), §17.1 (mesures), §17.2
-- @verifies docs/JOURNAL.md décisions 323, 324, 325

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

delete from public.mail_folder_map;

-- =============================================================================================
-- 1. La table et ses invariants
-- =============================================================================================

select has_table('public', 'mail_folder_map', '1 — la correspondance existe');

select col_is_unique('public', 'mail_folder_map', array['account_id', 'entity_type', 'entity_id'],
	'2 — un compte ne porte qu''UN dossier par entité : deux feraient diverger l''arborescence');

select has_column('public', 'mail_folder_map', 'requested_path',
	'3 — le chemin DEMANDÉ est conservé');

select has_column('public', 'mail_folder_map', 'actual_path',
	'4 — et le chemin réellement CRÉÉ aussi : les deux, jamais l''un ou l''autre');

select throws_ok(
	$$ insert into public.mail_folder_map (account_id, entity_type, entity_id, requested_path,
	     actual_path)
	   select id, 'workspace', id, 'CRM/x', 'CRM/x' from public.mail_inbound_accounts limit 1 $$,
	'23514',
	null,
	'5 — un type d''entité hors des trois niveaux est refusé');

-- =============================================================================================
-- 2. L'assainissement — §4.5
-- =============================================================================================

select is(app.assainir_segment_dossier('A/B'), 'A B',
	'6 — le DÉLIMITEUR est remplacé par une espace, non retiré : « A/B » reste lisible');

select is(app.assainir_segment_dossier('A\B'), 'A B',
	'7 — la contre-oblique aussi : le serveur, lui, ne l''assainit pas (§17.1)');

select is(app.assainir_segment_dossier(E'A\tB'), 'A B',
	'8 — un caractère de contrôle est remplacé : un nom illisible dans un terminal ne l''est pas');

select is(app.assainir_segment_dossier('   '), 'sans-nom',
	'9 — un nom vide devient « sans-nom » plutôt que de produire un segment vide');

select is(app.assainir_segment_dossier(null), 'sans-nom',
	'10 — un nom absent aussi');

select is(app.assainir_segment_dossier('Conseil & IA'), 'Conseil & IA',
	'11 — l''esperluette est CONSERVÉE : c''est le fil qui l''encode, pas le produit (décision 324)');

select is(char_length(app.assainir_segment_dossier(repeat('é', 300))), 120,
	'12 — un nom sans borne est une promesse qu''aucune couche ne tient');

-- =============================================================================================
-- 3. Les chemins dérivés
-- =============================================================================================

select matches(
	public.chemin_dossier_card((select id from public.cards
	                             where archived_at is null and deleted_at is null limit 1)),
	'^CRM/[^/]+/[^/]+/[^/]+$',
	'13 — le chemin d''une card a QUATRE segments : CRM, track, channel, card');

select is(
	public.chemin_dossier_entite('track', (select id from public.tracks order by name limit 1)),
	'CRM/' || app.assainir_segment_dossier((select name from public.tracks order by name limit 1)),
	'14 — le chemin d''un track est le préfixe de celui de ses cards');

select is(
	public.chemin_dossier_entite('inconnu', gen_random_uuid()),
	null,
	'15 — un type inconnu ne rend AUCUN chemin plutôt qu''un chemin approximatif');

-- =============================================================================================
-- 4. La divergence, et son ordre
-- =============================================================================================

create temporary table pg_temp_ref (nom text primary key, valeur text);

insert into pg_temp_ref
select 'compte', id::text from public.mail_inbound_accounts where owner_id is null;
insert into pg_temp_ref
select 'track', id::text from public.tracks order by name limit 1;

insert into public.mail_folder_map (account_id, entity_type, entity_id, requested_path, actual_path)
select (select valeur::uuid from pg_temp_ref where nom = 'compte'),
       'track',
       (select valeur::uuid from pg_temp_ref where nom = 'track'),
       'CRM/Nom périmé',
       'CRM/Nom périmé';

select is(
	(select count(*)::int from public.dossiers_a_renommer(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))),
	1,
	'16 — un chemin devenu faux est signalé comme divergence');

select is(
	(select profondeur from public.dossiers_a_renommer(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))),
	1,
	'17 — et sa PROFONDEUR est donnée : renommer un track avant ses cards emporte les enfants');

-- Le rattachement fait suivre en base ce que le serveur a déjà déplacé.
insert into public.mail_folder_map (account_id, entity_type, entity_id, requested_path, actual_path)
select (select valeur::uuid from pg_temp_ref where nom = 'compte'),
       'card',
       (select id from public.cards where archived_at is null and deleted_at is null limit 1),
       'CRM/Nom périmé/Channel/Card',
       'CRM/Nom périmé/Channel/Card';

select is(
	public.mail_folder_map_reparenter(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'),
		'CRM/Nom périmé', 'CRM/Nom réel'),
	1,
	'18 — le descendant suit le parent renommé, et lui seul');

select * from finish();

rollback;

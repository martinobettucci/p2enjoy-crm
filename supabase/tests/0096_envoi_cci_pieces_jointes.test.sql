-- @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : copie cachée et pièces jointes à l'envoi
-- @verifies docs/SPEC-mail-subsystem.md §19 bis.2 (Cci, 10 fichiers et 10 Mo, bucket privé vérifié en base, archive),
--           §19 bis.3 (colonnes, bucket, prédicats, les trois refus, taille et type lus dans `storage.objects`, la
--           liste des dépôts abandonnés) ; docs/SCHEMA.md « Migrations `0106` et `0107` » ; décisions 719 et 720
--
-- LES OBJETS DE STOCKAGE SONT POSÉS DANS LA TRANSACTION, comme `storage` les écrirait — `owner`, `metadata.size`,
-- `metadata.mimetype` —, et disparaissent au `rollback`. Ils ne démontrent rien du produit : ils éprouvent la garde. Le
-- dépôt réel, par l'API de stockage, est prouvé par `e2e/api/envoi-pieces-jointes.spec.ts`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

create temporary table pg_temp_ref (nom text primary key, valeur text);
grant all on pg_temp_ref to authenticated, service_role;
insert into pg_temp_ref
select 'identite', id::text from public.mail_outbound_identities where owner_id is null limit 1;

-- Deux objets de Camille dans son dossier, un de Driss dans le sien, deux gros objets de Camille.
insert into storage.objects (bucket_id, name, owner, metadata) values
	('mail-outbound-attachments', '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/a/devis.pdf',
	 '5eed0000-0000-4000-8000-000000000011', '{"size": 1200, "mimetype": "application/pdf"}'),
	('mail-outbound-attachments', '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/b/note.txt',
	 '5eed0000-0000-4000-8000-000000000011', '{"size": 34, "mimetype": "text/plain"}'),
	('mail-outbound-attachments', '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000012/c/interne.txt',
	 '5eed0000-0000-4000-8000-000000000012', '{"size": 10, "mimetype": "text/plain"}'),
	('mail-outbound-attachments', '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/d/gros1.bin',
	 '5eed0000-0000-4000-8000-000000000011', '{"size": 6000000, "mimetype": "application/octet-stream"}'),
	('mail-outbound-attachments', '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/e/gros2.bin',
	 '5eed0000-0000-4000-8000-000000000011', '{"size": 6000000, "mimetype": "application/octet-stream"}');

select isnt((select valeur from pg_temp_ref where nom = 'identite'), null,
	'1 — TÉMOIN : l''identité de service du seed existe');

-- =============================================================================================
-- 1. Le modèle
-- =============================================================================================

select has_column('public', 'mail_outbox', 'bcc_addrs', '2 — la file porte la copie cachée');
select has_column('public', 'mail_messages', 'bcc_addresses', '3 — le message archivé porte la copie cachée');
select is((select public from storage.buckets where id = 'mail-outbound-attachments'), false,
	'4 — le bucket des pièces à envoyer est PRIVÉ');
select is((select file_size_limit from storage.buckets where id = 'mail-outbound-attachments'), 10485760::bigint,
	'5 — et plafonné à 10 Mo par objet');
select has_function('public', 'queue_outbound_email',
	array['uuid', 'uuid', 'text[]', 'text', 'text', 'text[]', 'uuid', 'text[]', 'jsonb'],
	'6 — la file prend `p_bcc` et `p_attachments`');
select hasnt_function('public', 'queue_outbound_email',
	array['uuid', 'uuid', 'text[]', 'text', 'text', 'text[]', 'uuid'],
	'7 — l''ancienne signature est retirée : aucune fonction n''expose deux contrats');
select ok(not has_function_privilege('authenticated', 'public.depots_envoi_abandonnes(interval)', 'execute'),
	'8 — la liste des dépôts abandonnés est réservée à la clé de service');
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname like 'mail_outbound_attachments_%'), 3,
	'9 — trois politiques sur le bucket : dépôt, lecture de ses dépôts, retrait');

-- =============================================================================================
-- 2. Les prédicats de stockage
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille

select ok(app.piece_envoi_deposable(
	'5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/x/f.txt'),
	'10 — Camille dépose dans son dossier d''un espace dont elle est membre');
select ok(not app.piece_envoi_deposable(
	'5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000012/x/f.txt'),
	'11 — pas dans le dossier de Driss');
select ok(not app.piece_envoi_deposable(
	'00000000-0000-4000-8000-000000000000/5eed0000-0000-4000-8000-000000000011/x/f.txt'),
	'12 — pas dans un espace dont elle n''est pas membre');
select ok(not app.piece_envoi_deposable('pas-un-uuid/5eed0000-0000-4000-8000-000000000011/x/f.txt'),
	'13 — un premier segment qui n''est pas un espace est refusé, sans erreur');
select ok(not app.piece_envoi_deposable('5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/f.txt'),
	'14 — un chemin sans son segment aléatoire est refusé');

-- =============================================================================================
-- 3. La mise en file
-- =============================================================================================

select lives_ok(
	format($$select public.queue_outbound_email(
		'5eed0000-0000-4000-8000-0000000000c1', %L, array['client@exterieur.test'], 'Objet', 'Corps.',
		'{}', null, array['direction@exterieur.test'],
		'["5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/a/devis.pdf",
		  "5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/b/note.txt"]')$$,
		(select valeur from pg_temp_ref where nom = 'identite')),
	'15 — Camille met en file avec une Cci et deux pièces');

select pg_temp.redevenir_proprietaire();

select is((select bcc_addrs from public.mail_outbox where body_text like 'Corps.%' order by created_at desc limit 1),
	array['direction@exterieur.test'], '16 — la Cci est dans la file');
select is((select attachments from public.mail_outbox where body_text like 'Corps.%' order by created_at desc limit 1),
	'[{"path": "5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/a/devis.pdf", "filename": "devis.pdf", "size_bytes": 1200, "mime_type": "application/pdf"},
	  {"path": "5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/b/note.txt", "filename": "note.txt", "size_bytes": 34, "mime_type": "text/plain"}]'::jsonb,
	'17 — nom, taille et type RELUS DANS LE STOCKAGE, jamais crus du client');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	format($$select public.queue_outbound_email('5eed0000-0000-4000-8000-0000000000c1', %L,
		array['client@exterieur.test'], 'O', 'C.', '{}', null, '{}',
		'["5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000012/c/interne.txt"]')$$,
		(select valeur from pg_temp_ref where nom = 'identite')),
	'23514', 'attachment_not_available', '18 — la pièce de Driss est refusée');
select throws_ok(
	format($$select public.queue_outbound_email('5eed0000-0000-4000-8000-0000000000c1', %L,
		array['client@exterieur.test'], 'O', 'C.', '{}', null, '{}',
		'["5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/z/absente.txt"]')$$,
		(select valeur from pg_temp_ref where nom = 'identite')),
	'23514', 'attachment_not_available', '19 — une pièce absente reçoit le MÊME refus');
select throws_ok(
	format($$select public.queue_outbound_email('5eed0000-0000-4000-8000-0000000000c1', %L,
		array['client@exterieur.test'], 'O', 'C.', '{}', null, '{}', %L::jsonb)$$,
		(select valeur from pg_temp_ref where nom = 'identite'),
		(select jsonb_agg('x/' || n) from generate_series(1, 11) n)),
	'23514', 'too_many_attachments', '20 — onze fichiers : refus nommé');
select throws_ok(
	format($$select public.queue_outbound_email('5eed0000-0000-4000-8000-0000000000c1', %L,
		array['client@exterieur.test'], 'O', 'C.', '{}', null, '{}',
		'["5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/d/gros1.bin",
		  "5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/e/gros2.bin"]')$$,
		(select valeur from pg_temp_ref where nom = 'identite')),
	'23514', 'attachments_too_large', '21 — plus de 10 Mo au total : refus nommé');
select throws_ok(
	format($$select public.queue_outbound_email('5eed0000-0000-4000-8000-0000000000c1', %L,
		array['client@exterieur.test'], 'O', 'C.', '{}', null, '{}', '{"pas": "un tableau"}')$$,
		(select valeur from pg_temp_ref where nom = 'identite')),
	'23514', 'attachment_not_available', '22 — une liste qui n''est pas un tableau est refusée');

-- UNE FOIS EN FILE, LE DÉPÔT N'EST PLUS RETIRABLE ; un dépôt hors file l'est.
select ok(not app.piece_envoi_retirable(
	'5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/a/devis.pdf'),
	'23 — un dépôt cité par la file n''est plus retirable');
select ok(app.piece_envoi_retirable(
	'5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/d/gros1.bin'),
	'24 — un dépôt hors file l''est');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. Les dépôts abandonnés
-- =============================================================================================

select is((select count(*)::int from public.depots_envoi_abandonnes(interval '-1 minute')
            where name like '%/a/devis.pdf'), 0,
	'25 — un dépôt cité par un envoi EN COURS n''est jamais abandonné');
select is((select count(*)::int from public.depots_envoi_abandonnes(interval '-1 minute')
            where name like '%5eed0000-0000-4000-8000-000000000011/d/gros1.bin'), 1,
	'26 — un dépôt jamais mis en file l''est, passé le délai');

select * from finish();
rollback;

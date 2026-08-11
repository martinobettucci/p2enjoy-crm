-- @verifies CRM-054 (docs/BACKLOG.md) — ingestion des messages
-- @verifies docs/SPEC-mail-subsystem.md §4.2 (dédoublonnage et occurrences), §4.3 (les quatre
--           statuts), §15.5 (chemin sans nom de fichier, bucket privé)
-- @verifies docs/SCHEMA.md §12 ; docs/SPEC-permissions-rls.md §7 (preuve de refus n° 9)
-- @verifies docs/JOURNAL.md décision 320

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- =============================================================================================
-- 1. Les trois tables et leurs invariants
-- =============================================================================================

select has_table('public', 'mail_messages', '1 — le message canonique existe');
select has_table('public', 'mail_message_occurrences', '2 — les occurrences existent');
select has_table('public', 'mail_attachments', '3 — les pièces jointes existent');

select col_is_unique('public', 'mail_messages', array['workspace_id', 'rfc822_message_id'],
	'4 — la clé de DÉDOUBLONNAGE est celle du §4.2, et elle est unique');

select col_is_pk('public', 'mail_message_occurrences',
	array['message_id', 'account_id', 'folder'],
	'5 — une occurrence est unique par message, compte et dossier');

-- =============================================================================================
-- 2. Les contraintes mordent
-- =============================================================================================

-- Un message classé porte une card, un message non classé n'en porte pas. L'invariant est écrit
-- pour que `CRM-055` ne puisse pas le rompre par inadvertance.
select throws_ok(
	$$ insert into public.mail_messages (workspace_id, rfc822_message_id, classification,
	     from_address)
	   values ('5eed0000-0000-4000-8000-000000000001', '<a@b.test>', 'auto', 'x@y.test') $$,
	'23514',
	null,
	'6 — un message CLASSÉ sans card est refusé');

select lives_ok(
	$$ insert into public.mail_messages (workspace_id, rfc822_message_id, from_address)
	   values ('5eed0000-0000-4000-8000-000000000001', '<sonde-1@b.test>', 'x@y.test') $$,
	'7 — un message non classé sans card est accepté : c''est l''état d''un message ingéré');

select throws_ok(
	$$ insert into public.mail_messages (workspace_id, rfc822_message_id, from_address)
	   values ('5eed0000-0000-4000-8000-000000000001', '<sonde-1@b.test>', 'autre@y.test') $$,
	'23505',
	null,
	'8 — le MÊME identifiant dans le MÊME workspace est refusé : c''est le dédoublonnage');

select lives_ok(
	$$ insert into public.mail_attachments (message_id, filename, mime_type, size_bytes,
	     storage_path, sha256)
	   select id, 'rapport.pdf', 'application/pdf', 10,
	          '5eed0000-0000-4000-8000-000000000001/' || id::text ||
	          '/0000000000000000000000000000000000000000000000000000000000000000',
	          '0000000000000000000000000000000000000000000000000000000000000000'
	     from public.mail_messages where rfc822_message_id = '<sonde-1@b.test>' $$,
	'9 — une pièce jointe bien formée est acceptée');

select is(
	(select a.av_status from public.mail_attachments a
	   join public.mail_messages m on m.id = a.message_id
	  where m.rfc822_message_id = '<sonde-1@b.test>'),
	'pending',
	'10 — et son statut NAÎT `pending` : donc non téléchargeable, avant toute analyse');

select throws_ok(
	$$ insert into public.mail_attachments (message_id, filename, mime_type, size_bytes,
	     storage_path, sha256)
	   select id, 'x', 'text/plain', 1, 'a/b/c', 'pas-une-empreinte'
	     from public.mail_messages where rfc822_message_id = '<sonde-1@b.test>' $$,
	'23514',
	null,
	'11 — une empreinte qui n''en est pas une est refusée');

-- LE CHEMIN NE CONTIENT JAMAIS DE NOM DE FICHIER (§15.5) : un nom d'origine dans un chemin de
-- stockage est une traversée de répertoire qui attend son heure.
select throws_ok(
	$$ insert into public.mail_attachments (message_id, filename, mime_type, size_bytes,
	     storage_path, sha256)
	   select id, 'x', 'text/plain', 1,
	          '5eed0000-0000-4000-8000-000000000001/' || id::text || '/rapport.pdf',
	          '0000000000000000000000000000000000000000000000000000000000000000'
	     from public.mail_messages where rfc822_message_id = '<sonde-1@b.test>' $$,
	'23514',
	null,
	'12 — un chemin de dépôt PORTANT UN NOM DE FICHIER est refusé');

select throws_ok(
	$$ update public.mail_attachments set av_status = 'analyse-en-cours' $$,
	'23514',
	null,
	'13 — un statut antivirus hors des quatre valeurs est refusé');

select lives_ok(
	$$ delete from public.mail_messages where rfc822_message_id = '<sonde-1@b.test>' $$,
	'14 — les sondes sont retirées, et la pièce suit par cascade');

select is(
	(select count(*)::int from public.mail_attachments a
	  where not exists (select 1 from public.mail_messages m where m.id = a.message_id)),
	0,
	'15 — la cascade n''a laissé AUCUNE pièce orpheline');

-- =============================================================================================
-- 3. Le bucket, et la PREUVE DE REFUS N° 9
-- =============================================================================================

select is(
	(select count(*)::int from storage.buckets where id = 'mail-attachments'),
	1,
	'16 — le bucket des pièces jointes existe');

select is(
	(select public from storage.buckets where id = 'mail-attachments'),
	false,
	'17 — et il est PRIVÉ : aucun objet n''est servi sans autorisation');

-- ASSERTION RETOURNÉE PAR `CRM-057` (décision 51). Elle figeait l'absence de toute politique et
-- annonçait ce qui la rendrait rouge : « CRM-057 devra écrire une politique conditionnée à
-- `av_status = 'clean'` ». C'est fait, et l'assertion est RÉVISÉE plutôt que retirée : elle porte
-- désormais sur le nombre — EXACTEMENT une — parce qu'une seconde politique, si étroite soit-elle,
-- ouvrirait une autre part du stockage sans que rien ne le dise.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'storage' and tablename = 'objects'),
	1,
	'18 — REFUS N° 9 RÉVISÉ : EXACTEMENT une politique d''objet, celle des pièces jointes saines');

-- CE QUE LA MESURE A MONTRÉ, ET QUI VAUT D'ÊTRE ÉCRIT : `storage.objects` accorde **tous** les
-- privilèges à `anon` et `authenticated` — c'est le défaut de Supabase. La protection ne vient
-- donc PAS des privilèges : elle vient du refus par défaut de la RLS, et de l'absence de toute
-- politique. `CRM-057`, qui livrera le téléchargement, devra écrire une politique conditionnée à
-- `av_status = 'clean'` — une politique écrite à la légère ouvrirait aussi les pièces `infected`.
select is(
	(select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
	true,
	'19 — la RLS est activée sur les objets : c''est ELLE qui refuse, non les privilèges');

-- =============================================================================================
-- 4. RLS et privilèges des trois tables
-- =============================================================================================

select is(
	(select count(*)::int from pg_class c
	  where c.oid in ('public.mail_messages'::regclass,
	                  'public.mail_message_occurrences'::regclass,
	                  'public.mail_attachments'::regclass)
	    and c.relrowsecurity),
	3,
	'20 — RLS est activée sur les trois tables');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public'
	    and tablename in ('mail_messages', 'mail_message_occurrences', 'mail_attachments')
	    and cmd <> 'SELECT'),
	0,
	'21 — aucune politique d''écriture : un message est un FAIT reçu, pas une déclaration');

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public'
	    and table_name in ('mail_messages', 'mail_message_occurrences', 'mail_attachments')
	    and grantee = 'authenticated' and privilege_type <> 'SELECT'),
	0,
	'22 — et aucun privilège d''écriture accordé à authenticated');

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public'
	    and table_name in ('mail_messages', 'mail_message_occurrences', 'mail_attachments')
	    and grantee = 'anon'),
	0,
	'23 — REFUS N° 11 : anon n''a rien sur les trois tables');

-- La lecture d'un message CLASSÉ suit toujours sa card. `CRM-057` y a ajouté le second titre de
-- visibilité — la BOÎTE où le message a été vu —, sans retirer le premier.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_messages'
	    and qual like '%can_read_card%'),
	1,
	'24 — la lecture d''un message suit le droit sur sa CARD');

-- ASSERTION RÉVISÉE PAR `CRM-057`, ET LE MOTIF EST UN DÉFAUT QU'ELLE A RÉVÉLÉ : la politique des
-- pièces jointes jugeait sur `card_id`, colonne NULLE tant que le message n'est pas classé. La
-- pièce d'un message non classé était donc invisible à tous — y compris à celui qui doit le trier,
-- et qui a précisément besoin de la voir pour décider. Elle suit désormais son MESSAGE.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_attachments'
	    and qual like '%peut_voir_message%'),
	1,
	'25 — celle d''une pièce jointe suit son MESSAGE, qui suit sa card ou sa boîte (CRM-057 §18.1)');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_message_occurrences'
	    and qual like '%mail_inbound_accounts%'),
	1,
	'26 — une occurrence dit dans quelle BOÎTE un message a été vu : elle suit le compte');

select * from finish();

rollback;

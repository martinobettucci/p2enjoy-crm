-- @verifies CRM-057 (docs/BACKLOG.md) — inbox globale : qui voit un message non classé
-- @verifies docs/SPEC-mail-subsystem.md §18.1 (la visibilité suit la boîte), §18.2 (classer exige
--           les deux droits), §18.3 (l'arborescence), §18.5 (la pièce saine, et elle seule)
-- @verifies docs/SPEC-permissions-rls.md §5 (Storage), §7.2 preuve de refus n° 9
-- @verifies docs/JOURNAL.md décision 327
--
-- LA SUITE S'APPUIE SUR LE COURRIER DU SEED (§2.19) : deux messages réellement reçus, l'un classé
-- par la règle 1, l'autre non classé dans la boîte système. Elle ne les fabrique pas — un message
-- forgé ici prouverait le comportement d'une donnée qui n'existe pas dans le produit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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
select 'non_classe', id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'classe', id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'card_classee', card_id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';

-- TÉMOIN AVANT TOUTE ASSERTION DE REFUS : sans lui, « zéro ligne » serait vrai que la RLS refuse ou
-- que la donnée manque (décision 50). Le seed doit avoir fait arriver les deux messages.
select is(
	(select count(*) from pg_temp_ref where nom in ('non_classe', 'classe')),
	2::bigint,
	'1 — TÉMOIN : les deux messages du seed existent, vus par le propriétaire de la base');

-- =============================================================================================
-- 2. Les fonctions livrées
-- =============================================================================================

select has_function('app', 'boite_du_message_lisible', array['uuid'],
	'2 — la visibilité de la BOÎTE existe, et ne relit pas `mail_messages` (§3.5)');

select has_function('app', 'peut_voir_message', array['uuid'],
	'3 — la visibilité d''un message existe : sa card, ou sa boîte');

select has_function('public', 'inbox_arborescence', array[]::text[],
	'4 — l''arborescence de l''inbox existe, et ne prend aucun argument');

-- `SECURITY INVOKER` : les compteurs sont ceux de l'APPELANT. Une fonction `DEFINER` aurait
-- annoncé du courrier introuvable à qui n'y a pas droit (§18.3).
select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'inbox_arborescence'),
	false,
	'5 — l''arborescence s''exécute avec les droits de l''APPELANT, jamais du définisseur');

select ok(
	not has_function_privilege('anon', 'public.inbox_arborescence()', 'execute'),
	'6 — l''anonyme ne peut pas l''exécuter');

-- =============================================================================================
-- 3. Qui voit un message NON CLASSÉ — §18.1
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, admin

select is(
	(select count(*) from public.mail_messages m
	  where m.id = (select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	1::bigint,
	'7 — l''administratrice voit le non classé de la boîte du workspace : la visibilité suit la boîte');

select ok(
	app.peut_voir_message((select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	'8 — et la fonction le dit aussi');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');  -- Driss, business_developer

-- L'ABSENCE DE RÔLE DE TRI EST FIGÉE ICI, ET NON COMMENTÉE. Le jour où un tel rôle existera, cette
-- assertion deviendra ROUGE et désignera la preuve à réécrire — mécanisme de la décision 51. La
-- retirer alors, plutôt que la réviser, effacerait la limite en même temps que sa cause.
select is(
	(select count(*) from public.mail_messages m where m.card_id is null),
	0::bigint,
	'9 — ABSENCE FIGÉE : un membre ordinaire ne voit AUCUN non classé, faute de rôle de tri (§18.1)');

select ok(
	not app.peut_voir_message((select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	'10 — Driss possède une boîte, mais pas CELLE où ce message a été vu');

-- Le message CLASSÉ, lui, suit sa card : Driss la lit, donc il lit le message. Deux titres de
-- visibilité différents pour deux messages de la même boîte.
select is(
	(select count(*) from public.mail_messages m
	  where m.id = (select valeur::uuid from pg_temp_ref where nom = 'classe')),
	1::bigint,
	'11 — le message CLASSÉ reste lisible par qui lit sa card');

-- =============================================================================================
-- 4. Classer exige les DEUX droits — §18.2
-- =============================================================================================

select throws_ok(
	format($$ select public.classify_message(%L::uuid, %L::uuid) $$,
		(select valeur from pg_temp_ref where nom = 'non_classe'),
		(select valeur from pg_temp_ref where nom = 'card_classee')),
	'42501',
	null,
	'12 — classer un message qu''on n''a pas le droit de VOIR est refusé, même avec le droit d''écrire');

select is(
	(select classification from public.mail_messages m
	  where m.id = (select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	null,
	'13 — et la ligne est relue INCHANGÉE — invisible pour lui, donc nulle : le refus n''a rien écrit');

select pg_temp.redevenir_proprietaire();

select is(
	(select classification from public.mail_messages
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	'unclassified',
	'14 — contre-épreuve par le propriétaire : le message est bien resté non classé');

-- =============================================================================================
-- 5. La pièce jointe saine, et elle seule — §18.5
-- =============================================================================================

insert into public.mail_attachments (message_id, filename, mime_type, size_bytes, storage_path,
	sha256, av_status)
select (select valeur::uuid from pg_temp_ref where nom = 'classe'), 'rapport.pdf',
	'application/pdf', 12,
	(select workspace_id from public.mail_messages
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'classe'))::text
	  || '/' || (select valeur from pg_temp_ref where nom = 'classe') || '/'
	  || repeat('a', 64),
	repeat('a', 64), 'clean';

insert into pg_temp_ref
select 'chemin_clean', storage_path from public.mail_attachments where sha256 = repeat('a', 64);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select ok(
	app.piece_jointe_telechargeable((select valeur from pg_temp_ref where nom = 'chemin_clean')),
	'15 — une pièce `clean` dont le message est visible est téléchargeable');

select pg_temp.redevenir_proprietaire();

update public.mail_attachments set av_status = 'infected' where sha256 = repeat('a', 64);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select ok(
	not app.piece_jointe_telechargeable((select valeur from pg_temp_ref where nom = 'chemin_clean')),
	'16 — la MÊME pièce devenue `infected` ne l''est plus : le statut décide, pas le droit');

select pg_temp.redevenir_proprietaire();
update public.mail_attachments set av_status = 'pending' where sha256 = repeat('a', 64);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select ok(
	not app.piece_jointe_telechargeable((select valeur from pg_temp_ref where nom = 'chemin_clean')),
	'17 — `pending` non plus : un fichier non analysé n''est pas un fichier sain (§4.3)');

select pg_temp.redevenir_proprietaire();
update public.mail_attachments set av_status = 'skipped' where sha256 = repeat('a', 64);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select ok(
	not app.piece_jointe_telechargeable((select valeur from pg_temp_ref where nom = 'chemin_clean')),
	'18 — `skipped` non plus : l''analyse n''a pas eu lieu, et le taire serait la rendre inutile');

select pg_temp.redevenir_proprietaire();
update public.mail_attachments set av_status = 'clean' where sha256 = repeat('a', 64);

-- Farida est `viewer` et n'a AUCUNE boîte : elle ne voit ni le message, ni sa pièce, quel que soit
-- le statut d'analyse de celle-ci.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select ok(
	not app.piece_jointe_telechargeable((select valeur from pg_temp_ref where nom = 'chemin_clean')),
	'19 — une pièce `clean` reste refusée à qui ne voit pas son message');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 6. La politique de stockage — §18.5, preuve de refus n° 9 RÉVISÉE
-- =============================================================================================

select is(
	(select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'),
	1::bigint,
	'20 — `storage.objects` porte EXACTEMENT une politique : ouvrir large ouvrirait tout le stockage');

select ok(
	(select qual from pg_policies
	  where schemaname = 'storage' and tablename = 'objects'
	    and policyname = 'mail_attachments_objets_lecture') like '%mail-attachments%',
	'21 — et elle est bornée au bucket des pièces jointes, jamais au stockage entier');

select is(
	(select cmd from pg_policies
	  where schemaname = 'storage' and tablename = 'objects'
	    and policyname = 'mail_attachments_objets_lecture'),
	'SELECT',
	'22 — aucune ÉCRITURE n''est ouverte : le dépôt reste le fait de `service_role`');

select * from finish();
rollback;

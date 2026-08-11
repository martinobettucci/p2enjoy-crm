-- @verifies CRM-059 (docs/BACKLOG.md) — la reprise d'un rangement manqué, dette de `CRM-056`
-- @verifies docs/SPEC-mail-subsystem.md §20.5 (la dette), §4.5 (dossiers IMAP)
-- @verifies docs/JOURNAL.md décision 342
--
-- CE QUE CETTE SUITE MESURE. La sélection — un message classé, jamais rangé, avec de quoi le
-- copier — et la fermeture du fait par `marquer_message_range`. La DÉCISION de copier appartient
-- au service et s'éprouve sans serveur ; ici, on mesure ce que la base garantit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create temporary table pg_temp_ref (nom text primary key, valeur text);

insert into pg_temp_ref
select 'compte', id::text from public.mail_inbound_accounts where owner_id is null;
insert into pg_temp_ref
select 'card', id::text from public.cards
 where archived_at is null and deleted_at is null and channel_id is not null
 order by title limit 1;

-- =============================================================================================
-- 1. Le vocabulaire
-- =============================================================================================

select has_function('public', 'messages_a_ranger', array['uuid'],
	'1 — la sélection des rangements manqués existe');

select has_function('public', 'marquer_message_range', array['uuid'],
	'2 — la fermeture du fait existe');

select has_column('public', 'mail_messages', 'filed_at',
	'3 — `mail_messages` porte QUAND un message a été COPIÉ, pas seulement classé');

select is(
	has_function_privilege('authenticated', 'public.messages_a_ranger(uuid)', 'execute'),
	false,
	'4 — la sélection est un constat de la relève : le client ne l''appelle pas');

select is(
	has_function_privilege('authenticated', 'public.marquer_message_range(uuid)', 'execute'),
	false,
	'5 — et la fermeture du fait non plus');

-- =============================================================================================
-- 2. Un message classé, jamais rangé — la sonde
-- =============================================================================================

insert into public.mail_messages (workspace_id, rfc822_message_id, from_address, to_addresses, card_id, classification)
values ('5eed0000-0000-4000-8000-000000000001', '<rangement-manque@sonde.test>',
        'client@exterieur.test', array['personne@ailleurs.test'],
        (select valeur::uuid from pg_temp_ref where nom = 'card'), 'auto');

insert into pg_temp_ref
select 'message', id::text from public.mail_messages
 where rfc822_message_id = '<rangement-manque@sonde.test>';

select is(
	(select count(*)::int from public.messages_a_ranger(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))
	  where message_id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	0,
	'6 — SANS occurrence, un message classé n''est pas repris : rien ne dit d''où le copier');

insert into public.mail_message_occurrences (message_id, account_id, folder, uid, seen_at)
select (select valeur::uuid from pg_temp_ref where nom = 'message'),
       (select valeur::uuid from pg_temp_ref where nom = 'compte'),
       'INBOX', 77001, now() - interval '2 minutes';

select is(
	(select folder from public.messages_a_ranger(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))
	  where message_id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	'INBOX',
	'7 — AVEC une occurrence, le message classé et non rangé est repris, avec son dossier');

select is(
	(select uid from public.messages_a_ranger(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))
	  where message_id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	77001::bigint,
	'7 bis — et son UID');

-- UNE SECONDE OCCURRENCE, PLUS RÉCENTE : la première vue (`seen_at` la plus ancienne) doit rester
-- la source retenue, déterministe et indépendante de l'ordre de retour du serveur.
insert into public.mail_message_occurrences (message_id, account_id, folder, uid, seen_at)
select (select valeur::uuid from pg_temp_ref where nom = 'message'),
       (select valeur::uuid from pg_temp_ref where nom = 'compte'),
       'Archive', 77002, now();

select is(
	(select folder from public.messages_a_ranger(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))
	  where message_id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	'INBOX',
	'8 — DEUX occurrences : la plus ANCIENNE est retenue, jamais celle qu''un second tour ajoute');

-- =============================================================================================
-- 3. La fermeture du fait
-- =============================================================================================

select lives_ok(
	format($$ select public.marquer_message_range(%L::uuid) $$,
		(select valeur from pg_temp_ref where nom = 'message')),
	'9 — fermer le fait est accepté');

select is(
	(select filed_at is not null from public.mail_messages
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	true,
	'10 — `filed_at` est posé par la fermeture, jamais par le classement');

select is(
	(select count(*)::int from public.messages_a_ranger(
		(select valeur::uuid from pg_temp_ref where nom = 'compte'))
	  where message_id = (select valeur::uuid from pg_temp_ref where nom = 'message')),
	0,
	'11 — une fois fermé, le message ne revient plus : une reprise n''est pas une boucle');

select * from finish();
rollback;

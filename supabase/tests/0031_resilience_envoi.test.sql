-- @verifies CRM-059 (docs/BACKLOG.md) — reprise d'un envoi, orphelins, état visible
-- @verifies docs/SPEC-mail-subsystem.md §20.3 (le backoff et sa borne), §20.4 (l'envoi orphelin),
--           §20.7 (l'état affiché est conforme à la réalité)
-- @verifies docs/JOURNAL.md décision 331
--
-- CE QUE CETTE SUITE MESURE, ET CE QU'ELLE NE MESURE PAS. La DÉCISION de rejouer appartient au
-- service et s'éprouve sans serveur (`mail-sync/tests/test_backoff.py`). Ici, on mesure ce que la
-- base garantit : qu'une reprogrammation reporte réellement, qu'elle refuse un délai nul, qu'un
-- orphelin trop jeune n'est pas repris, et que l'état affiché est celui de l'appelant.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

create temporary table pg_temp_ref (nom text primary key, valeur text);

insert into pg_temp_ref
select 'identite', id::text from public.mail_outbound_identities where owner_id is null;
insert into pg_temp_ref values ('card', '5eed0000-0000-4000-8000-0000000000c1');

select is(
	(select count(*) from pg_temp_ref where nom = 'identite'),
	1::bigint,
	'1 — TÉMOIN : l''identité de service du seed existe');

-- Une ligne de file, posée par le propriétaire : la garde est éprouvée ailleurs (`0030`), et
-- passer par elle ici mesurerait deux choses à la fois.
insert into public.mail_outbox (workspace_id, identity_id, card_id, to_addrs, body_text)
select '5eed0000-0000-4000-8000-000000000001',
       (select valeur::uuid from pg_temp_ref where nom = 'identite'),
       (select valeur::uuid from pg_temp_ref where nom = 'card'),
       array['client@exterieur.test'], 'Corps de sonde.';

insert into pg_temp_ref
select 'file', id::text from public.mail_outbox where body_text = 'Corps de sonde.';

-- =============================================================================================
-- 1. Reprogrammer — §20.3
-- =============================================================================================

select has_function('public', 'reprogrammer_envoi', array['uuid', 'text', 'integer'],
	'2 — la reprogrammation existe');

select is(
	public.reprogrammer_envoi(
		(select valeur::uuid from pg_temp_ref where nom = 'file'), 'timeout', 60),
	1,
	'3 — reprogrammer rend le compte de tentatives, qui passe à UN');

select is(
	(select status from public.mail_outbox
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'file')),
	'queued',
	'4 — l''envoi retourne en file : il n''est ni parti, ni perdu');

select ok(
	(select next_attempt_at from public.mail_outbox
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'file')) > now(),
	'5 — et sa prochaine tentative est REPORTÉE : sans report, ce serait une boucle de scrutation');

select is(
	(select last_error from public.mail_outbox
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'file')),
	'timeout',
	'6 — la cause est nommée par un CODE, jamais par le texte du serveur (§13.7)');

-- LE CODE EST ASSAINI PAR LA BASE, et pas seulement par le service : un appelant qui passerait le
-- texte brut d'un serveur — avec sa version et son hôte — ne doit pas pouvoir l'écrire.
select is(
	(select public.reprogrammer_envoi(
		(select valeur::uuid from pg_temp_ref where nom = 'file'),
		'421 4.7.0 mail.exemple.fr rejette 10.0.0.4', 60) is not null),
	true,
	'7 — un code impur est accepté, puis assaini');

select is(
	(select last_error from public.mail_outbox
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'file')),
	'mailexemplefrrejette',
	'8 — seules les lettres et les tirets bas survivent : ni version, ni hôte, ni adresse');

select throws_ok(
	format($$ select public.reprogrammer_envoi(%L::uuid, 'timeout', 0) $$,
		(select valeur from pg_temp_ref where nom = 'file')),
	'23514',
	'delai_invalide',
	'9 — un délai nul est refusé : ce serait harceler un serveur en panne au lieu de l''attendre');

-- Un envoi DÉJÀ parti ne se reprogramme pas : le renvoyer produirait un doublon chez le
-- destinataire, que rien ne rattraperait.
update public.mail_outbox set status = 'sent'
 where id = (select valeur::uuid from pg_temp_ref where nom = 'file');

select throws_ok(
	format($$ select public.reprogrammer_envoi(%L::uuid, 'timeout', 60) $$,
		(select valeur from pg_temp_ref where nom = 'file')),
	'P0002',
	'outbox_not_reschedulable',
	'10 — un envoi déjà `sent` ne se reprogramme pas : ce serait l''envoyer deux fois');

-- =============================================================================================
-- 2. Les orphelins — §20.4
-- =============================================================================================

update public.mail_outbox
   set status = 'sending', reserved_at = now()
 where id = (select valeur::uuid from pg_temp_ref where nom = 'file');

select is(
	public.reprendre_envois_orphelins(10),
	0,
	'11 — un envoi réservé À L''INSTANT n''est pas repris : un envoi lent n''est pas un envoi mort');

update public.mail_outbox
   set reserved_at = now() - interval '30 minutes'
 where id = (select valeur::uuid from pg_temp_ref where nom = 'file');

select is(
	public.reprendre_envois_orphelins(10),
	1,
	'12 — un envoi réservé il y a trente minutes est REPRIS : le worker qui le tenait est mort');

-- =============================================================================================
-- 3. L'état affiché — §20.7
-- =============================================================================================

-- `SECURITY INVOKER` : l'état est celui que l'APPELANT a le droit de voir. Une fonction `DEFINER`
-- aurait annoncé l'incident d'une boîte qu'il n'administre pas.
select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'etat_messagerie'),
	false,
	'13 — l''état s''exécute avec les droits de l''APPELANT');

select ok(
	not has_function_privilege('anon', 'public.etat_messagerie()', 'execute'),
	'14 — l''anonyme ne lit aucun état : une panne de messagerie n''est pas une information publique');

select * from finish();
rollback;

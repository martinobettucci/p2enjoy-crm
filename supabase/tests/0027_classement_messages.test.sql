-- @verifies CRM-055 (docs/BACKLOG.md) — classement assisté
-- @verifies docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.1 (la règle 3 désactivée),
--           §16.2 (forme ET domaine, card fermée), §16.3 (classement manuel, idempotence)
-- @verifies docs/SPEC-cards.md §14 (timeline) ; docs/JOURNAL.md décision 322

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

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

delete from public.mail_messages;

create temporary table pg_temp_ref (nom text primary key, valeur text);
grant all on pg_temp_ref to authenticated, service_role;

insert into pg_temp_ref
select 'card', id::text from public.cards
 where archived_at is null and deleted_at is null and channel_id is not null
 order by title limit 1;
insert into pg_temp_ref
select 'adresse', c.email_local_part || '@' || w.inbound_domain
  from public.cards c join public.workspaces w on w.id = c.workspace_id
 where c.id = (select valeur::uuid from pg_temp_ref where nom = 'card');
insert into pg_temp_ref
select 'card_archivee', id::text from public.cards where archived_at is not null limit 1;
insert into pg_temp_ref
select 'adresse_archivee', c.email_local_part || '@' || w.inbound_domain
  from public.cards c join public.workspaces w on w.id = c.workspace_id
 where c.id = (select valeur::uuid from pg_temp_ref where nom = 'card_archivee');

-- =============================================================================================
-- 1. Le vocabulaire, et la RÈGLE 3 FIGÉE
-- =============================================================================================

select ok(
	(select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check')
	  like '%mail_received%',
	'1 — le vocabulaire de la timeline compte ONZE types : un message qui entre est un fait');

select has_function('public', 'classify_message', array['uuid', 'uuid'],
	'2 — le classement manuel existe');

select has_function('public', 'classer_message_automatiquement',
	'3 — le classement automatique existe');

-- ASSERTION RETOURNÉE, NON RETIRÉE (mécanisme de la décision 51) : elle attendait l'absence de
-- `contacts` et de `card_contacts` ; ces deux tables existent depuis CRM-060 tranche 1. La
-- désactivation de la règle 3 vit désormais dans le CODE de classement, non dans l'absence de sa
-- cible. Le motif du contrôle change : on constate la PRÉSENCE des tables, ce qui rend la règle 3
-- SATISFAISABLE en base ; l'activer dans le code est la TRANCHE 2 de CRM-060.
select ok(
	to_regclass('public.contacts') is not null and to_regclass('public.card_contacts') is not null,
	'4 — CRM-060 TRANCHE 1 A LIVRÉ `contacts` ET `card_contacts` : la règle 3 devient '
	'SATISFAISABLE en base. L''activer dans le code de classement est la TRANCHE 2 de CRM-060 ; '
	'l''ASSERTION D''ABSENCE FIGÉE PAR CRM-055 EST RETOURNÉE POUR CONSTATER LA PRÉSENCE, comme '
	'le mécanisme de la décision 51 le demande (CLAUDE.md §3.1)');

select is(
	has_function_privilege('authenticated', 'public.classer_message_automatiquement(uuid, text, text[])', 'execute'),
	false,
	'5 — le classement AUTOMATIQUE est un constat de la relève : le client ne l''appelle pas');

select is(
	has_function_privilege('authenticated', 'public.classify_message(uuid, uuid)', 'execute'),
	true,
	'6 — le classement MANUEL, lui, est offert à un membre connecté');

-- =============================================================================================
-- 2. La règle 1 — forme ET domaine, et jamais une card fermée
-- =============================================================================================

select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array[(select valeur from pg_temp_ref where nom = 'adresse')]),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'7 — RÈGLE 1 : une adresse de card désigne sa card');

select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array[replace((select valeur from pg_temp_ref where nom = 'adresse'),
		              '@crm.p2enjoy.test', '@autre-domaine.test')]),
	null,
	'8 — la FORME seule ne suffit pas : le domaine doit être celui du workspace');

select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array['contact@crm.p2enjoy.test']),
	null,
	'9 — le DOMAINE seul ne suffit pas non plus');

select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array[upper((select valeur from pg_temp_ref where nom = 'adresse'))]),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'10 — la casse n''a pas d''importance : deux graphies sont la même adresse');

select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array[(select valeur from pg_temp_ref where nom = 'adresse_archivee')]),
	null,
	'11 — UNE CARD ARCHIVÉE NE REÇOIT PAS : classer dans un dossier fermé y ramènerait du courrier');

-- =============================================================================================
-- 3. Le classement automatique, sur des messages réels
-- =============================================================================================

insert into public.mail_messages (workspace_id, rfc822_message_id, from_address, to_addresses)
values ('5eed0000-0000-4000-8000-000000000001', '<auto-1@sonde.test>', 'client@exterieur.test',
        array[(select valeur from pg_temp_ref where nom = 'adresse')]);

select is(
	public.classer_message_automatiquement(
		(select id from public.mail_messages where rfc822_message_id = '<auto-1@sonde.test>')),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'12 — la règle 1 classe le message dans sa card');

select is(
	(select classification from public.mail_messages where rfc822_message_id = '<auto-1@sonde.test>'),
	'auto',
	'13 — et la classification dit qu''aucun humain ne l''a fait');

select is(
	(select classified_by from public.mail_messages where rfc822_message_id = '<auto-1@sonde.test>'),
	null,
	'14 — `classified_by` reste NUL : un classement automatique n''a pas d''auteur');

-- LE COMPTE PORTE SUR L'ÉVÉNEMENT DE CE MESSAGE, ET NON SUR LA TABLE ENTIÈRE : d'autres preuves
-- laissent des `mail_received` derrière elles, et une assertion globale mesurerait leur ménage
-- plutôt que le produit.
select is(
	(select count(*)::int from public.card_events e
	  where e.type = 'mail_received' and e.payload->>'rule' = 'auto'
	    and e.payload->>'message_id' = (select id::text from public.mail_messages
	                                     where rfc822_message_id = '<auto-1@sonde.test>')),
	1,
	'15 — un événement `mail_received` est écrit dans la timeline de la card');

-- RÈGLE 2 : la filiation, et seulement si la règle 1 n'a rien dit.
insert into public.mail_messages (workspace_id, rfc822_message_id, from_address, to_addresses)
values ('5eed0000-0000-4000-8000-000000000001', '<auto-2@sonde.test>', 'client@exterieur.test',
        array['personne@ailleurs.test']);

select is(
	public.classer_message_automatiquement(
		(select id from public.mail_messages where rfc822_message_id = '<auto-2@sonde.test>'),
		'<auto-1@sonde.test>'),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'16 — RÈGLE 2 : une réponse suit la card de son parent');

-- RÈGLE 4 : rien ne s'applique.
insert into public.mail_messages (workspace_id, rfc822_message_id, from_address, to_addresses)
values ('5eed0000-0000-4000-8000-000000000001', '<auto-3@sonde.test>', 'client@exterieur.test',
        array['personne@ailleurs.test']);

select is(
	public.classer_message_automatiquement(
		(select id from public.mail_messages where rfc822_message_id = '<auto-3@sonde.test>')),
	null,
	'17 — RÈGLE 4 : rien ne s''applique, le message reste non classé — et ce n''est pas une erreur');

-- =============================================================================================
-- 4. Le classement manuel
-- =============================================================================================

-- RÉVISÉ PAR `CRM-057`, ET LA SUITE AVAIT RAISON D'ÉCHOUER. La sonde était un message sans aucune
-- OCCURRENCE : il n'avait été vu dans aucune boîte. Tant que `classify_message` ne vérifiait que le
-- droit d'écriture sur la card, cela passait ; depuis que classer exige aussi de VOIR le message
-- (§18.2), un message que personne n'a jamais reçu nulle part n'est classable par personne — et
-- c'est exactement la règle voulue.
--
-- La sonde reçoit donc une occurrence dans la boîte du workspace, comme tout message réellement
-- relevé. Ce n'est pas un contournement de la garde : c'est la donnée qui manquait pour que la
-- sonde ressemble à un vrai message.
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select (select id from public.mail_messages where rfc822_message_id = '<auto-3@sonde.test>'),
       a.id, 'INBOX', 90001
  from public.mail_inbound_accounts a
 where a.owner_id is null
 limit 1;

-- L'IDENTIFIANT EST RELEVÉ AVANT DE CHANGER DE RÔLE, et ce n'est pas une commodité : le lire
-- depuis le rôle `authenticated` dépendrait de la politique qu'on s'apprête à éprouver.
insert into pg_temp_ref
select 'message_non_classe', id::text from public.mail_messages
 where rfc822_message_id = '<auto-3@sonde.test>';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	public.classify_message(
		(select valeur::uuid from pg_temp_ref where nom = 'message_non_classe'),
		(select valeur::uuid from pg_temp_ref where nom = 'card')),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'18 — l''administratrice classe un message à la main');

-- IDEMPOTENT : reclasser dans la MÊME card ne produit pas un second événement. Un utilisateur qui
-- clique deux fois ne raconte pas deux histoires.
select lives_ok(
	$$ select public.classify_message(
	     (select valeur::uuid from pg_temp_ref where nom = 'message_non_classe'),
	     (select valeur::uuid from pg_temp_ref where nom = 'card')) $$,
	'19 — reclasser dans la même card est accepté');

select pg_temp.redevenir_proprietaire();

select is(
	(select count(*)::int from public.card_events e
	  where e.type = 'mail_received' and e.payload->>'rule' = 'manual'
	    and e.payload->>'message_id' = (select valeur from pg_temp_ref
	                                     where nom = 'message_non_classe')),
	1,
	'20 — et n''a écrit qu''UN seul événement : deux clics ne racontent pas deux histoires');

select * from finish();

rollback;

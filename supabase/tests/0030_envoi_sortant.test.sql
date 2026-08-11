-- @verifies CRM-058 (docs/BACKLOG.md) — la garde de la file d'envoi et son quota
-- @verifies docs/SPEC-mail-subsystem.md §19.4 (les six refus, le quota), §19.5 (les trois effets),
--           §19.8 (limites figées)
-- @verifies docs/SPEC-permissions-rls.md §4 ; docs/JOURNAL.md décision 330
--
-- LA GARDE EST ÉPROUVÉE PAR SES REFUS, un par un et dans l'ordre où elle les oppose : un refus qui
-- surviendrait pour la mauvaise raison — la card avant l'identité, par exemple — renseignerait
-- l'appelant sur l'existence d'objets qu'il n'a pas le droit de voir.

begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

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
select 'identite_service', id::text from public.mail_outbound_identities where owner_id is null;
insert into pg_temp_ref
select 'identite_driss', id::text from public.mail_outbound_identities
 where owner_id = '5eed0000-0000-4000-8000-000000000012';
insert into pg_temp_ref values ('card', '5eed0000-0000-4000-8000-0000000000c1');
insert into pg_temp_ref
select 'card_archivee', id::text from public.cards where archived_at is not null limit 1;

-- TÉMOIN : sans lui, « la garde refuse » serait vrai aussi si les objets manquaient.
select is(
	(select count(*) from pg_temp_ref where nom in ('identite_service', 'identite_driss', 'card')),
	3::bigint,
	'1 — TÉMOIN : les deux identités et la card du seed existent');

-- =============================================================================================
-- 1. Ce que la migration a posé
-- =============================================================================================

select has_table('public', 'mail_outbox', '2 — la file d''envoi existe');

select has_function('public', 'queue_outbound_email',
	array['uuid', 'uuid', 'text[]', 'text', 'text', 'text[]', 'uuid'],
	'3 — la garde existe, et c''est la seule porte');

select ok(
	(select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check')
	  like '%mail_sent%',
	'4 — la timeline compte DOUZE types : un message envoyé est un fait de la card');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_outbox' and cmd <> 'SELECT'),
	0,
	'5 — aucune politique d''écriture : la file se remplit par la garde, elle se vide par le worker');

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'mail_outbox' and grantee = 'anon'),
	0,
	'6 — REFUS N° 11 : anon n''a rien sur la file');

-- Les trois fonctions du worker sont le fait du SERVICE : les offrir au client laisserait
-- déclarer qu'un message est parti alors qu'il ne l'est pas.
select ok(
	not has_function_privilege('authenticated', 'public.reserver_envois(integer)', 'execute'),
	'7 — `reserver_envois` est refusée au client');
select ok(
	not has_function_privilege('authenticated',
		'public.marquer_envoi_reussi(uuid, text, text[])', 'execute'),
	'8 — `marquer_envoi_reussi` aussi');
select ok(
	not has_function_privilege('authenticated', 'public.marquer_envoi_echoue(uuid, text)', 'execute'),
	'9 — `marquer_envoi_echoue` aussi');

-- ABSENCE FIGÉE (§19.8) : les pièces jointes à l'envoi ne sont pas livrées. Le jour où elles le
-- seront, cette assertion deviendra rouge et désignera la preuve à écrire — décision 51.
select is(
	(select count(*)::int from public.mail_outbox where attachments <> '[]'::jsonb),
	0,
	'10 — ABSENCE FIGÉE : aucune pièce jointe à l''envoi, la colonne existe et rien ne l''alimente');

-- =============================================================================================
-- 2. Les six refus, dans l'ordre où la garde les oppose
-- =============================================================================================

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'42501',
	'not_authenticated',
	'11 — sans session, la garde refuse : un envoi part toujours au nom de quelqu''un');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');  -- Farida, viewer

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'42501',
	'forbidden',
	'12 — le viewer n''envoie pas : écrire au nom d''une affaire, c''est y ajouter du contenu');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');  -- Driss, business_developer

-- L'IDENTITÉ DE SERVICE APPARTIENT AU WORKSPACE : seuls ses administrateurs l'empruntent. Driss
-- écrit pourtant sur cette card — le refus porte donc bien sur l'identité, non sur le droit.
select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'42501',
	'identity_not_available',
	'13 — un membre n''emprunte pas l''identité de service du workspace');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, admin

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_driss')),
	'42501',
	'identity_not_available',
	'14 — même une administratrice n''emprunte pas l''identité PERSONNELLE d''un collègue');

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card_archivee'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'23514',
	'card_not_available',
	'15 — une affaire archivée n''envoie pas : elle ne recevrait pas la réponse');

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array[]::text[]) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'23514',
	'recipient_required',
	'16 — un message sans destinataire n''est pas un message');

-- =============================================================================================
-- 3. Le quota — §19.4
-- =============================================================================================

select pg_temp.redevenir_proprietaire();

update public.mail_outbound_identities set daily_quota = 0
 where id = (select valeur::uuid from pg_temp_ref where nom = 'identite_service');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- `0` GARDE SON SENS LITTÉRAL : cette identité n'envoie pas. C'est `NULL` qui signifie « aucun
-- plafond » depuis `CRM-058` — le défaut `0` d'origine interdisait tout envoi sans le dire.
select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['a@b.test']) $$,
		(select valeur from pg_temp_ref where nom = 'card'),
		(select valeur from pg_temp_ref where nom = 'identite_service')),
	'23505',
	'quota_exceeded',
	'17 — un quota de zéro refuse, et le dit');

select pg_temp.redevenir_proprietaire();
update public.mail_outbound_identities set daily_quota = null
 where id = (select valeur::uuid from pg_temp_ref where nom = 'identite_service');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select isnt(
	public.queue_outbound_email(
		(select valeur::uuid from pg_temp_ref where nom = 'card'),
		(select valeur::uuid from pg_temp_ref where nom = 'identite_service'),
		array['client@exterieur.test'],
		'Sonde pgTAP',
		'Corps de sonde.'),
	null,
	'18 — sans plafond, la mise en file aboutit et rend l''identifiant de la ligne');

select pg_temp.redevenir_proprietaire();

-- LE QUOTA COMPTE LES LIGNES EN VOL AUTANT QUE PARTIES : compter les seuls `sent` laisserait
-- mettre en file mille messages qui partiraient tous.
select is(
	app.envois_du_jour((select valeur::uuid from pg_temp_ref where nom = 'identite_service')),
	1,
	'19 — une ligne `queued` compte déjà dans le quota du jour');

update public.mail_outbox set status = 'failed'
 where identity_id = (select valeur::uuid from pg_temp_ref where nom = 'identite_service');

select is(
	app.envois_du_jour((select valeur::uuid from pg_temp_ref where nom = 'identite_service')),
	0,
	'20 — un envoi `failed` ne consomme plus le quota : il n''est jamais parti');

-- =============================================================================================
-- 4. L'invariant du sens
-- =============================================================================================
--
-- `direction` distingue ce que nous avons ÉCRIT de ce que nous avons REÇU. Sans elle, la règle 2
-- du §4.4 pourrait rattacher une réponse à notre propre envoi comme s'il venait du correspondant.

select throws_ok(
	$$ insert into public.mail_messages (workspace_id, rfc822_message_id, from_address, direction)
	   values ('5eed0000-0000-4000-8000-000000000001', '<sens@sonde.test>', 'a@b.test', 'lateral') $$,
	'23514',
	null,
	'21 — un sens de circulation inconnu est refusé : un message va dans un sens ou dans l''autre');

select * from finish();
rollback;

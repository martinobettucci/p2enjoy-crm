-- @verifies CRM-069 (docs/BACKLOG.md) — tranche T4 : le digest quotidien en base et à l'envoi
-- @verifies docs/SPEC-etiquettes-digest.md §5.1 (le consentement, privé, posé pour soi seul), §5.2 (le contenu ; rien à dire,
--           rien d'envoyé), §5.3 (la file sans affaire, l'identité de service, sans `Reply-To`, aucun courrier d'affaire
--           écrit au succès), §5.4 (7 h de Paris, idempotent, `digest_runs`, le job) ; docs/JOURNAL.md décisions 769, 771, 772
--
-- Joué sous le rôle `authenticated` de Driss (business developer) et de Farida (lectrice), et sous le propriétaire pour le
-- job. Le `rollback` final rend la base intacte, la file d'envoi comprise.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;
-- 7 h 15 à Paris aujourd'hui, et 6 h 15 : l'heure du job, et celle où il ne fait rien.
create temp table pg_temp.instants as
select ((current_date + time '07:15') at time zone 'Europe/Paris') as sept,
       ((current_date + time '06:15') at time zone 'Europe/Paris') as six;
grant select on pg_temp.instants to authenticated;

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''

-- =============================================================================================
-- 1. Le contrat des tables
-- =============================================================================================

select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.digest_subscriptions'::regclass, 'public.digest_runs'::regclass)),
	'1 — la RLS est activée sur le consentement et sur le journal');
select ok(
	not has_column_privilege('authenticated', 'public.digest_subscriptions', 'profile_id', 'INSERT')
	and not has_table_privilege('authenticated', 'public.digest_subscriptions', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.digest_runs', 'SELECT')
	and not has_function_privilege('authenticated', 'app.envoyer_digests(timestamptz)', 'EXECUTE'),
	'2 — on ne consent que pour soi ; le journal et le job sont fermés aux clients');

-- =============================================================================================
-- 2. Le consentement — §5.1
-- =============================================================================================

-- Le jeu abonne Driss (docs/SPEC-seed.md §31) : la preuve part d'une table vide, dans la transaction.
delete from public.digest_subscriptions;

select pg_temp.endosser(:driss);
select lives_ok($$ insert into public.digest_subscriptions (workspace_id) values ('5eed0000-0000-4000-8000-000000000001') $$,
	'3 — Driss consent au digest de l''espace');
select pg_temp.redevenir_proprietaire();
select is((select profile_id from public.digest_subscriptions where workspace_id = :ws), :driss::uuid,
	'4 — la base pose la personne : l''appelant');

select pg_temp.endosser(:farida);
select is((select count(*)::int from public.digest_subscriptions), 0, '5 — la lectrice ne voit pas le consentement d''autrui');
delete from public.digest_subscriptions where profile_id = '5eed0000-0000-4000-8000-000000000012';
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.digest_subscriptions where profile_id = :driss), 1,
	'6 — ni ne le retire : sa suppression est filtrée');

-- =============================================================================================
-- 3. La file : une affaire pour un envoi d'affaire, aucune pour un digest — §5.3
-- =============================================================================================

select throws_ok($$ insert into public.mail_outbox (workspace_id, identity_id, kind, to_addrs, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', '756dd61a-a479-4bb0-80c4-015f8d456206', 'card', array['a@b.test'], 'x') $$,
	'23514', null, '7 — un envoi d''affaire sans affaire est refusé');
select throws_ok($$ insert into public.mail_outbox (workspace_id, identity_id, kind, card_id, to_addrs, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', '756dd61a-a479-4bb0-80c4-015f8d456206', 'digest',
	        '5eed0000-0000-4000-8000-0000000000c1', array['a@b.test'], 'x') $$,
	'23514', null, '8 — un digest rattaché à une affaire est refusé');

-- =============================================================================================
-- 4. Le job — §5.2, §5.4
-- =============================================================================================

select is(app.envoyer_digests((select six from pg_temp.instants)), 0, '9 — à 6 h de Paris, le job ne fait rien');

-- L'adresse de Driss, posée comme à sa connexion par la fonction de session (décision 773) : le jeu ne garantit pas qu'il
-- se soit connecté depuis la dernière reconstruction.
update public.profiles set email = null where id = :driss;
select is((public.ouvrir_session_serveur(:driss, '  BizDev@P2Enjoy.test ', 'Driss Lemoine', pg_catalog.sha256('preuve-0124'::bytea),
                                         'r', now() + interval '1 hour') ->> 'admis'), 'true',
	'9 bis — Driss ouvre une session, admis');
select is((select email from public.profiles where id = :driss), 'bizdev@p2enjoy.test',
	'9 ter — la base retient son adresse vérifiée, en minuscules');

-- Le journal du jour, vidé dans la transaction : le seed y a peut-être déjà inscrit l'issue de Driss, et le job, idempotent,
-- ne la referait pas.
delete from public.digest_runs;

-- Une mention non lue de Driss, pour que le digest la dise.
insert into public.notifications (workspace_id, recipient_id, type, subject_card_id)
values (:ws, :driss, 'mention', '5eed0000-0000-4000-8000-0000000000c1');

select is(app.envoyer_digests((select sept from pg_temp.instants)), 1, '10 — à 7 h, un digest part : celui de Driss, seul abonné');
select is((select status from public.digest_runs where profile_id = :driss and workspace_id = :ws), 'queued',
	'11 — le journal le dit mis en file');
select is((select kind || '|' || (card_id is null)::text || '|' || array_to_string(to_addrs, ',')
             from public.mail_outbox o join public.digest_runs r on r.outbox_id = o.id where r.profile_id = :driss),
	'digest|true|bizdev@p2enjoy.test', '12 — un digest, sans affaire, à l''adresse de Driss');
select ok((select body_text like '%{site}/tracks/%' and body_text like '%On vous a mentionné%' and subject like 'Votre journée dans %'
             from public.mail_outbox o join public.digest_runs r on r.outbox_id = o.id where r.profile_id = :driss),
	'13 — le corps porte ses liens au jeton `{site}` et la mention non lue');
select is(app.envoyer_digests((select sept from pg_temp.instants) + interval '20 minutes'), 0,
	'14 — rappelé le même jour, il n''envoie rien : idempotent');
select is((select count(*)::int from public.digest_runs where profile_id = :camille), 0, '15 — Camille, non abonnée, ne reçoit rien');

-- Un espace sans identité de service, et sans rien à dire pour Driss.
insert into public.workspaces (id, name, slug) values ('5eed0000-0000-4000-8000-0000000e7201', 'ZZ Sans service', 'zz-sans-service');
insert into public.workspace_members (workspace_id, user_id, role) values ('5eed0000-0000-4000-8000-0000000e7201', :camille, 'admin');
insert into public.workspace_members (workspace_id, user_id, role) values ('5eed0000-0000-4000-8000-0000000e7201', :driss, 'business_developer');
insert into public.digest_subscriptions (profile_id, workspace_id) values (:driss, '5eed0000-0000-4000-8000-0000000e7201');
select is((select count(*)::int from app.digest_corps(:driss, '5eed0000-0000-4000-8000-0000000e7201', (select sept from pg_temp.instants))),
	0, '16 — rien à dire : aucun corps');
select app.envoyer_digests((select sept from pg_temp.instants));
select is((select status from public.digest_runs where workspace_id = '5eed0000-0000-4000-8000-0000000e7201'), 'no_service_identity',
	'17 — sans identité de service, rien ne part, et le journal le dit');

-- =============================================================================================
-- 5. L'envoi — §5.3
-- =============================================================================================

update public.mail_outbox set status = 'cancelled' where status = 'queued' and kind = 'card';
select is((select reply_to from public.reserver_envois(10) where card_id is null), null::text,
	'18 — la réservation rend le digest sans `Reply-To`');
select is((select count(*)::int from public.mail_messages m where m.rfc822_message_id = '<digest@crm.test>'), 0, '18 bis — témoin : aucun courrier d''affaire avant le succès');
select public.marquer_envoi_reussi((select outbox_id from public.digest_runs where profile_id = :driss and workspace_id = :ws),
                                   '<digest@crm.test>');
select is((select o.status from public.mail_outbox o join public.digest_runs r on r.outbox_id = o.id
            where r.profile_id = :driss and r.workspace_id = :ws)
          || '|' || (select count(*)::text from public.mail_messages m where m.rfc822_message_id = '<digest@crm.test>'),
	'sent|0', '19 — le succès clôt la ligne sans rien ranger dans le courrier d''une affaire');

select is((select schedule from cron.job where jobname = 'p2enjoy-digest-quotidien'), '2 * * * *',
	'20 — le job tourne chaque heure, à la minute 2');

select * from finish();
rollback;

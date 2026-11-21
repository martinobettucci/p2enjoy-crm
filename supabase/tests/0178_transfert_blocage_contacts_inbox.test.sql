-- @verifies CRM-156 (docs/BACKLOG.md) — tranche T2 : la base des ajouts — le transfert (ses refus dans l'ordre, la lecture
--           ouverte puis refermée, « Seulement moi », la notification unique, ce que le destinataire ne peut pas faire, le
--           retrait par l'auteur et le destinataire seuls, l'action groupée), le blocage (réservé à l'administrateur, les
--           reçus mis à la corbeille, la réception en corbeille, ni classée ni évaluée, l'envoi épargné, le déblocage), les
--           expéditeurs inconnus et la source des contacts créés
-- @verifies docs/SPEC-mail-subsystem.md §32.7, §32.8, §32.10 ; docs/SCHEMA.md « Migration `0190` » ; docs/JOURNAL.md
--           décisions 945 et 947 ; CLAUDE.md §10 (la règle prouvée par la base, sous les vrais rôles)
-- @verifies CRM-156 tranche T4 : la préférence `mail_transfer` s'écrit — docs/SCHEMA.md « Migration `0191` » ;
--           docs/SPEC-notifications.md §52 ; docs/DESIGN_SYSTEM.md §5.109 bis
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final :
-- - dans la boîte de Camille (`admin@`, administratrice), non classés, que Driss ne lit pas : `x1` et `x2` de
--   `tiers@exemple.test`, et `b1` de `bloque@exemple.test` ;
-- - dans l'affaire `…c1`, `b2` de `bloque@exemple.test` ; dans `…c5`, que la lectrice lit, `k1` ;
-- - un envoi `bo` dont l'adresse d'expédition est `bloque@exemple.test` (un envoi n'est jamais bloqué) ;
-- - deux expéditeurs pour les inconnus : `nouveau@atelier-lumen.example` (domaine d'une organisation du seed) et
--   `ines.morel@atelier-lumen.example` (déjà un contact du seed).
-- Révisé le 2026-11-21 (`CRM-161` T1, docs/SPEC-mail-subsystem.md §35.8, décision 51) : les fonctions de l'inbox prennent
--   l'espace (`p_workspace_id`, la portée `workspace_id`) ; la preuve passe celui du seed, sans changer ce qu'elle prouve.

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

\set espace '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set driss '5eed0000-0000-4000-8000-000000000012'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set c1 '5eed0000-0000-4000-8000-0000000000c1'
\set c5 '5eed0000-0000-4000-8000-0000000000c5'
\set inconnu '01780000-0000-4000-8000-0000000000e1'

insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, from_name,
                                  to_addresses, subject, direction, received_at)
values
	(:'espace', '<tst-156t2-x1@exemple.test>', null, 'unclassified', 'tiers@exemple.test', null, array['admin@p2enjoy.test'], 'Sonde 156 X1', 'inbound', now() - interval '5 hours'),
	(:'espace', '<tst-156t2-x2@exemple.test>', null, 'unclassified', 'tiers@exemple.test', null, array['admin@p2enjoy.test'], 'Sonde 156 X2', 'inbound', now() - interval '4 hours'),
	(:'espace', '<tst-156t2-b1@exemple.test>', null, 'unclassified', 'Bloque@Exemple.test', null, array['admin@p2enjoy.test'], 'Sonde 156 B1', 'inbound', now() - interval '3 hours'),
	(:'espace', '<tst-156t2-b2@exemple.test>', :'c1', 'manual', 'bloque@exemple.test', null, array['client@exemple.test'], 'Sonde 156 B2', 'inbound', now() - interval '2 hours'),
	(:'espace', '<tst-156t2-bo@exemple.test>', :'c1', 'outbound', 'bloque@exemple.test', null, array['client@exemple.test'], 'Sonde 156 envoi', 'outbound', now() - interval '2 hours'),
	(:'espace', '<tst-156t2-k1@exemple.test>', :'c5', 'manual', 'tiers@exemple.test', null, array['client@exemple.test'], 'Sonde 156 K1', 'inbound', now() - interval '1 hour'),
	(:'espace', '<tst-156t2-n1@exemple.test>', null, 'unclassified', 'nouveau@atelier-lumen.example', 'Nora Nouveau', array['admin@p2enjoy.test'], 'Sonde 156 N1', 'inbound', now() - interval '50 minutes'),
	(:'espace', '<tst-156t2-n2@exemple.test>', null, 'unclassified', 'ines.morel@atelier-lumen.example', 'Inès Morel', array['admin@p2enjoy.test'], 'Sonde 156 N2', 'inbound', now() - interval '40 minutes');

insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 178000 + row_number() over (order by m.rfc822_message_id)
  from public.mail_messages m
  join public.mail_inbound_accounts a on a.imap_username = 'admin@p2enjoy.test'
 where m.rfc822_message_id like '<tst-156t2-%' and m.card_id is null;

select id as x1 from public.mail_messages where rfc822_message_id = '<tst-156t2-x1@exemple.test>' \gset
select id as k1 from public.mail_messages where rfc822_message_id = '<tst-156t2-k1@exemple.test>' \gset

-- 1–2. La forme.
select ok(not has_table_privilege('authenticated', 'public.mail_message_transfers', 'insert')
          and not has_table_privilege('authenticated', 'public.mail_blocked_senders', 'insert')
          and has_table_privilege('authenticated', 'public.mail_message_transfers', 'select'),
	'1 — aucune écriture directe des transferts ni des blocages : les fonctions sont le seul chemin');
select ok(not has_function_privilege('anon', 'public.transfer_message(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.block_sender(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.import_contacts(uuid, jsonb, boolean, text)', 'execute'),
	'2 — l''anonyme n''exécute rien ; `import_contacts` garde son droit sous sa nouvelle signature');

-- 3–11. Le transfert, par Camille.
select pg_temp.endosser(:'driss');
select is((select count(*)::int from public.mail_messages where id = :'x1'), 0,
	'3 — avant le transfert, Driss ne lit pas `x1`, de la boîte de Camille');

select pg_temp.endosser(:'admin');
select throws_ok(format('select public.transfer_message(%L, %L)', :'x1', :'admin'), '22023', 'self_transfer',
	'4 — se transférer à soi : refusé');
select throws_ok(format('select public.transfer_message(%L, %L)', :'x1', :'inconnu'), '22023', 'recipient_not_member',
	'5 — un destinataire qui n''est pas membre de l''espace : refusé');
select is(public.transfer_message(:'x1', :'driss'), true, '6 — Camille transfère `x1` à Driss');
select is(public.transfer_message(:'x1', :'driss'), false, '7 — une seconde fois : rien ne change');

reset role;
select is((select count(*)::int from public.notifications
            where recipient_id = :'driss' and type = 'mail_transfer' and payload ->> 'message_id' = :'x1'), 1,
	'8 — une seule notification `mail_transfer` pour Driss, malgré le second appel');

select pg_temp.endosser(:'driss');
select is((select count(*)::int from public.mail_messages where id = :'x1'), 1, '9 — Driss lit désormais `x1`');
select ok((select public.concerns_me(m) from public.mail_messages m where m.id = :'x1'),
	'10 — et `x1` le concerne : il est dans son « Seulement moi »');
select throws_ok(format('select public.delete_message(%L)', :'x1'), '42501', 'forbidden',
	'11 — il ne peut pas le supprimer : le transfert n''ouvre pas l''écriture de la boîte');
select is((select count(*)::int from public.mail_messages where rfc822_message_id = '<tst-156t2-x2@exemple.test>'), 0,
	'12 — exactement les mails transférés : `x2`, du même expéditeur, lui reste fermé');

-- 13–14. La lectrice : elle ne transfère pas.
select pg_temp.endosser(:'lectrice');
select throws_ok(format('select public.transfer_message(%L, %L)', :'k1', :'driss'), '42501', 'forbidden',
	'13 — la lectrice, qui lit `k1`, ne le transfère pas (décision 947)');
select throws_ok(format('select public.transfer_message(%L, %L)', :'x1', :'driss'), 'PGRST', null,
	'14 — un message qu''elle ne voit pas : introuvable');

-- 15–18. Le retrait : l'auteur et le destinataire, eux seuls.
select pg_temp.endosser(:'driss');
select is(public.transfer_message(:'x1', :'lectrice'), true, '15 — Driss, qui voit `x1` et édite l''espace, le transfère à la lectrice');
select pg_temp.endosser(:'lectrice');
select throws_ok(format('select public.remove_message_transfer(%L, %L)', :'x1', :'driss'), '42501', 'forbidden',
	'16 — la lectrice, qui voit `x1`, ne retire pas le transfert vers Driss : ni auteur, ni destinataire');
select pg_temp.endosser(:'driss');
select is(public.remove_message_transfer(:'x1', :'driss'), true, '17 — Driss retire le transfert qu''il a reçu');
select is((select count(*)::int from public.mail_messages where id = :'x1'), 0,
	'18 — sa voie de lecture est refermée, et seulement la sienne');
select pg_temp.endosser(:'lectrice');
select is((select count(*)::int from public.mail_messages where id = :'x1'), 1, '19 — la lectrice lit toujours `x1`');
select throws_ok(format('select public.remove_message_transfer(%L, %L)', :'k1', :'driss'), 'PGRST', null,
	'20 — retirer un transfert qui n''existe pas : introuvable');

-- 21–22. L'action groupée : une notification pour l'appel.
select pg_temp.endosser(:'admin');
select is(public.inbox_bulk_apply('{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "folder": "unclassified", "sender": "tiers@exemple.test", "snoozed": "shown"}',
                                  'transfer', format('{"recipient_id": "%s"}', :'driss')::jsonb) - 'next',
	'{"threads": 2, "messages": 2, "done": 2, "refused": {}}'::jsonb, '21 — transférer deux mails à Driss en un appel');
reset role;
select is((select string_agg(payload ->> 'count', ',') from public.notifications
            where recipient_id = :'driss' and type = 'mail_transfer' and payload ->> 'count' = '2'), '2',
	'22 — une seule notification pour l''appel, qui dit deux mails');

-- 23–26. Le blocage : l'administratrice seule.
select pg_temp.endosser(:'driss');
select throws_ok(format('select public.block_sender(%L, %L)', :'espace', 'bloque@exemple.test'), '42501', 'forbidden',
	'23 — Driss ne bloque pas : réservé à l''administrateur (décision 947)');
select throws_ok(format('select public.blocked_sender_impact(%L, %L)', :'espace', 'bloque@exemple.test'), '42501', 'forbidden',
	'24 — ni ne compte l''effet d''un blocage');
select pg_temp.endosser(:'admin');
select throws_ok(format('select public.block_sender(%L, %L)', :'espace', 'pas une adresse'), '22023', 'invalid_address',
	'25 — une adresse mal formée : refusée');
select is(public.blocked_sender_impact(:'espace', ' BLOQUE@exemple.test '), 2,
	'26 — l''effet annoncé : les deux mails reçus, quelle que soit la casse ; l''envoi n''est pas compté');

-- 27–30. Bloquer : les reçus en corbeille, dans tout l'espace.
select is(public.block_sender(:'espace', 'bloque@exemple.test') ->> 'trashed', '2', '27 — bloquer : deux mails mis à la corbeille');
reset role;
select is((select count(*)::int from public.mail_messages where rfc822_message_id in ('<tst-156t2-b1@exemple.test>', '<tst-156t2-b2@exemple.test>')
            and deleted_at is not null and deleted_by = :'admin'), 2,
	'28 — le non classé de sa boîte et le classé de `…c1`, effacés par l''administratrice');
select is((select count(*)::int from public.card_events e
            where e.card_id = :'c1' and e.type = 'mail_deleted'
              and e.payload ->> 'message_id' = (select id::text from public.mail_messages where rfc822_message_id = '<tst-156t2-b2@exemple.test>')), 1,
	'29 — le fil de l''affaire porte « Message effacé »');
select is((select deleted_at is null from public.mail_messages where rfc822_message_id = '<tst-156t2-bo@exemple.test>'), true,
	'30 — un envoi n''est jamais bloqué');

-- 31–34. À la réception : le prochain mail naît en corbeille, ni classé, ni évalué.
insert into public.mail_messages (workspace_id, rfc822_message_id, classification, from_address, to_addresses, subject, direction, received_at)
values (:'espace', '<tst-156t2-b3@exemple.test>', 'unclassified', ' BLOQUE@exemple.test', array['admin@p2enjoy.test'], 'Sonde 156 B3', 'inbound', now());
select id as b3 from public.mail_messages where rfc822_message_id = '<tst-156t2-b3@exemple.test>' \gset
select is((select row(deleted_at is not null, deleted_by = :'admin')::text from public.mail_messages where id = :'b3'), '(t,t)',
	'31 — reçu après le blocage : il naît en corbeille, effacé au nom de qui a bloqué');
select is(public.classer_message_automatiquement(:'b3', null, null), null::uuid,
	'32 — le classement automatique ne le classe pas');
select ok(not exists (select 1 from public.claim_label_evaluations(1000) c where c.message_id = :'b3'),
	'33 — la file des pastilles ne le prend pas');

-- 34–36. Débloquer : l'administratrice seule ; ce qui est en corbeille y reste ; le suivant arrive normalement.
select pg_temp.endosser(:'driss');
select throws_ok(format('select public.unblock_sender(%L, %L)', :'espace', 'bloque@exemple.test'), '42501', 'forbidden',
	'34 — Driss ne débloque pas');
select pg_temp.endosser(:'admin');
select is(public.unblock_sender(:'espace', 'bloque@exemple.test'), true, '35 — l''administratrice débloque');
reset role;
insert into public.mail_messages (workspace_id, rfc822_message_id, classification, from_address, to_addresses, subject, direction, received_at)
values (:'espace', '<tst-156t2-b4@exemple.test>', 'unclassified', 'bloque@exemple.test', array['admin@p2enjoy.test'], 'Sonde 156 B4', 'inbound', now());
select is((select string_agg(rfc822_message_id || '=' || (deleted_at is not null)::text, ',' order by rfc822_message_id)
             from public.mail_messages where rfc822_message_id in ('<tst-156t2-b3@exemple.test>', '<tst-156t2-b4@exemple.test>')),
	'<tst-156t2-b3@exemple.test>=true,<tst-156t2-b4@exemple.test>=false',
	'36 — le mail mis en corbeille y reste ; le suivant arrive hors corbeille');

-- 37–38. Les expéditeurs inconnus, et la source des contacts créés.
select pg_temp.endosser(:'admin');
select is((select string_agg(address || '|' || suggested_name || '|' || coalesce(suggested_organization_name, '-'), ';' order by address)
             from public.inbox_bulk_unknown_senders(
               '{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "folder": "unclassified", "snoozed": "shown", "threads": [
                  {"workspace_id": "5eed0000-0000-4000-8000-000000000001", "thread_key": "<tst-156t2-n1@exemple.test>"},
                  {"workspace_id": "5eed0000-0000-4000-8000-000000000001", "thread_key": "<tst-156t2-n2@exemple.test>"}]}')),
	'nouveau@atelier-lumen.example|Nora Nouveau|Atelier Lumen',
	'37 — l''inconnu seul, avec son nom et l''organisation de son domaine ; l''expéditeur déjà contact est écarté');
-- Deux instructions : une requête ne voit pas ce que la fonction qu'elle appelle vient d'écrire (son instantané est pris
-- avant l'appel).
create temp table issue_import as
select * from public.import_contacts(:'espace',
	'[{"full_name": "Nora Nouveau", "email": "nouveau@atelier-lumen.example", "organization_name": "Atelier Lumen"}]', false, 'email');
select is((select c.source from issue_import r join public.contacts c on c.id = r.contact_id), 'email',
	'38 — le contact créé depuis l''inbox naît avec la source `email`');

-- 39–40. `CRM-156` T4 (migration `0191`) : la préférence « Recevoir les transferts de mails » s'écrit par l'unique chemin,
-- et retient ce que la personne a décidé. Défaut trouvé à l'écran : la RPC de `0067` refusait tout type hors « mention ».
reset role;
select pg_temp.endosser(:'driss');
select lives_ok($$ select public.definir_preference_notification('mail_transfer', false) $$,
	'39 — `definir_preference_notification` accepte `mail_transfer`');
select is((select in_app from public.notification_preferences where type = 'mail_transfer'), false,
	'40 — la décision retenue est celle de l''appelant : il ne reçoit plus les transferts');

select * from finish();
rollback;

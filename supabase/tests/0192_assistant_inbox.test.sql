-- @verifies CRM-166 (docs/BACKLOG.md) — tranche T1 : les trois fonctions de lecture de l'assistant de l'inbox — les fils d'une portée
--           (51 au plus, du plus récent au plus ancien), le message reçu le plus récent de chaque fil (jamais l'envoi), 50 fils au plus,
--           ce que la personne ne voit pas écarté, le contexte de l'espace (pastilles actives, affaires, membres hors l'appelant),
--           aucun droit ouvert à `anon`, aucune écriture
-- @verifies docs/SPEC-ia.md §17.3, §17.6 ; docs/SCHEMA.md « Migration `0207` » ; docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10 (la
--           règle prouvée par la base, sous les vrais rôles)
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final :
-- - dans la boîte de Driss (`bizdev@`), non classés : un fil A — `a1` reçu, `a2` sa réponse reçue, plus récente, et `a3`, l'ENVOI qui y répond,
--   le plus récent de tous —, un fil B (`b1`) ;
-- - dans la boîte système, que Driss ne lit pas : `s1` ;
-- - 51 fils de plus (`bulk`), pour la borne de 50.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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

insert into public.mail_messages (workspace_id, rfc822_message_id, references_ids, card_id, classification, from_address, from_name,
                                  to_addresses, subject, body_text, direction, received_at)
values
	(:'espace', '<tst-166-a1@exemple.test>', '{}', null, 'unclassified', 'fournisseur@exemple.test', 'Fournisseur', array['bizdev@p2enjoy.test'], 'Sonde 166 A', 'Bonjour A', 'inbound', now() - interval '3 hours'),
	(:'espace', '<tst-166-a2@exemple.test>', array['<tst-166-a1@exemple.test>'], null, 'unclassified', 'fournisseur@exemple.test', 'Fournisseur', array['bizdev@p2enjoy.test'], 'Re: Sonde 166 A', 'Réponse A', 'inbound', now() - interval '2 hours'),
	(:'espace', '<tst-166-a3@exemple.test>', array['<tst-166-a1@exemple.test>'], null, 'unclassified', 'bizdev@p2enjoy.test', null, array['fournisseur@exemple.test'], 'Re: Sonde 166 A', 'Envoi de Driss', 'outbound', now() - interval '1 hour'),
	(:'espace', '<tst-166-b1@exemple.test>', '{}', null, 'unclassified', 'autre@exemple.test', 'Autre', array['bizdev@p2enjoy.test'], 'Sonde 166 B', 'Bonjour B', 'inbound', now() - interval '4 hours'),
	(:'espace', '<tst-166-s1@exemple.test>', '{}', null, 'unclassified', 'fournisseur@exemple.test', 'Fournisseur', array['systeme@crm.p2enjoy.test'], 'Sonde 166 S', 'Bonjour S', 'inbound', now() - interval '5 hours');

insert into public.mail_messages (workspace_id, rfc822_message_id, references_ids, card_id, classification, from_address,
                                  to_addresses, subject, body_text, direction, received_at)
select :'espace', '<tst-166-bulk-' || n || '@exemple.test>', '{}', null, 'unclassified', 'masse@exemple.test',
       array['bizdev@p2enjoy.test'], 'Masse 166 ' || n, 'x', 'inbound', now() - interval '10 days' - (n || ' minutes')::interval
  from generate_series(1, 51) n;

insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 166000 + row_number() over (order by m.rfc822_message_id)
  from public.mail_messages m
  join public.mail_inbound_accounts a
    on a.imap_username = case when m.rfc822_message_id = '<tst-166-s1@exemple.test>' then 'systeme@crm.p2enjoy.test'
                              else 'bizdev@p2enjoy.test' end
 where m.rfc822_message_id like '<tst-166-%' and m.card_id is null;

insert into public.mail_labels (workspace_id, name, description, color, archived_at)
values (:'espace', 'Archivée 166', 'une pastille archivée', 'neutral', now());

select id as a2 from public.mail_messages where rfc822_message_id = '<tst-166-a2@exemple.test>' \gset
select id as a3 from public.mail_messages where rfc822_message_id = '<tst-166-a3@exemple.test>' \gset
select app.cle_fil('{}'::text[], '<tst-166-a1@exemple.test>') as cle_a \gset
select app.cle_fil('{}'::text[], '<tst-166-b1@exemple.test>') as cle_b \gset
select app.cle_fil('{}'::text[], '<tst-166-s1@exemple.test>') as cle_s \gset

\set filtre_expediteur '{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "folder": "unclassified", "sender": "fournisseur@exemple.test", "snoozed": "shown"}'

-- 1 à 3 — aucun droit à `anon`.
select ok(not has_function_privilege('anon', 'public.inbox_assistant_threads(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.inbox_assistant_messages(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.inbox_assistant_context(uuid)', 'execute'),
	'aucune des trois fonctions n''est offerte à anon');
select ok(has_function_privilege('authenticated', 'public.inbox_assistant_threads(jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.inbox_assistant_messages(jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.inbox_assistant_context(uuid)', 'execute'),
	'elles sont offertes aux personnes connectées');
select is((select count(*)::integer from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('inbox_assistant_threads', 'inbox_assistant_messages', 'inbox_assistant_context') and provolatile = 's'), 3,
	'les trois fonctions sont `stable` : une lecture, aucune écriture');

select pg_temp.endosser(:'driss');

-- 4 à 7 — les fils d'une portée.
select is((select count(*)::integer from public.inbox_assistant_threads(:'filtre_expediteur'::jsonb)), 1,
	'sous le filtre de l''expéditeur, Driss ne reçoit que SON fil : celui de la boîte système lui échappe');
select is((select count(*)::integer from public.inbox_assistant_threads(
	'{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "folder": "unclassified", "sender": "masse@exemple.test", "snoozed": "shown"}'::jsonb)), 51,
	'51 fils au plus, de quoi dire « plus de 50 »');
select is((select thread_key from public.inbox_assistant_threads(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_b'),
	                                                jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_a')))) limit 1), :'cle_a',
	'du plus récent au plus ancien : le fil A passe avant le fil B, quel que soit l''ordre demandé');

-- 8 à 11 — le message de chaque fil.
select is((select count(*)::integer from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_a'),
	                                                jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_b'))))), 2,
	'un message par fil : deux fils, deux lignes');
select is((select message_id from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_a')))) ), :'a2'::uuid,
	'le message du fil est le message REÇU le plus récent, jamais l''envoi qui est plus récent encore');
select is((select body_text from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_a')))) ), 'Réponse A',
	'il porte l''objet, l''expéditeur et le texte du message reçu');
select is((select count(*)::integer from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_s'))))), 0,
	'un fil de la boîte système, que Driss ne voit pas, est écarté : aucune ligne, aucune erreur');

select throws_ok($$select * from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', '5eed0000-0000-4000-8000-000000000001'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'sender', 'masse@exemple.test'))$$, '22023', 'too_many_threads',
	'plus de 50 fils : refusé, jamais tronqué en silence');

-- 13 à 16 — le contexte de l'espace.
select ok((select (c -> 'labels') @> '[{"name": "Lead"}]'::jsonb and not (c -> 'labels') @> '[{"name": "Archivée 166"}]'::jsonb
             from (select public.inbox_assistant_context(:'espace') c) x),
	'le contexte porte les pastilles actives, jamais une archivée');
select ok((select jsonb_array_length(c -> 'cards') between 1 and 100 from (select public.inbox_assistant_context(:'espace') c) x),
	'il porte de 1 à 100 affaires');
select ok((select not (c -> 'members') @> jsonb_build_array(jsonb_build_object('id', :'driss'::uuid, 'full_name', (select full_name from public.profiles where id = :'driss')))
                 and (c -> 'members') @> jsonb_build_array(jsonb_build_object('id', :'admin'::uuid, 'full_name', (select full_name from public.profiles where id = :'admin')))
             from (select public.inbox_assistant_context(:'espace') c) x),
	'il porte les membres, hors la personne elle-même');
select throws_ok($$select public.inbox_assistant_context('5eed0000-0000-4000-8000-0000000000ff')$$, '42501', 'workspace_not_member',
	'un espace qui n''est pas le sien : refusé');

select pg_temp.endosser(:'lectrice');
select is((select count(*)::integer from public.inbox_assistant_messages(
	jsonb_build_object('workspace_id', :'espace'::uuid, 'folder', 'unclassified', 'snoozed', 'shown',
	                   'threads', jsonb_build_array(jsonb_build_object('workspace_id', :'espace'::uuid, 'thread_key', :'cle_a'))))), 0,
	'la lectrice ne lit pas la boîte de Driss : le fil lui est écarté');

select * from finish();
rollback;

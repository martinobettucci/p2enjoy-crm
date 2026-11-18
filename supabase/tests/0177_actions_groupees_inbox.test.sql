-- @verifies CRM-156 (docs/BACKLOG.md) — tranche T1 : les actions groupées de l'inbox en base — la portée (dossier, filtres,
--           fils cochés, sommeil, corbeille, visibilité), le filtre explicite exigé par la base, le compte, chaque action
--           passée par sa fonction unitaire, une sélection mixte, les refus de forme, une panne qui fait échouer l'appel,
--           les paquets de 2 000 et leur curseur (décision 949, §32.5 bis)
-- @verifies docs/SPEC-mail-subsystem.md §32.2 à §32.5 bis ; docs/SCHEMA.md « Migration `0189` » ;
--           docs/JOURNAL.md décisions 944, 946 et 949 ; CLAUDE.md §10 (la règle prouvée par la base, sous
--           les vrais rôles)
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final :
-- - dans la boîte de Driss (`bizdev@`), non classés : `a1` et sa réponse `a2` (un fil), de `spam@` ; `b1` de `autre@`, et
--   l'envoi `b2` qui lui répond (un second fil) ;
-- - dans la boîte système, que Driss ne lit pas : `s1`, de `spam@` aussi ;
-- - dans l'affaire `…c5`, que Driss et la lectrice lisent sans l'écrire : `k1`, de `spam@`.
-- `a1` seul porte la pastille « Spam », posée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

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

insert into public.mail_messages (workspace_id, rfc822_message_id, references_ids, card_id, classification, from_address,
                                  to_addresses, subject, direction, received_at)
values
	(:'espace', '<tst-156-a1@exemple.test>', '{}', null, 'unclassified', 'spam@exemple.test', array['bizdev@p2enjoy.test'], 'Sonde 156 A', 'inbound', now() - interval '3 hours'),
	(:'espace', '<tst-156-a2@exemple.test>', array['<tst-156-a1@exemple.test>'], null, 'unclassified', 'Spam@Exemple.test', array['bizdev@p2enjoy.test'], 'Re: Sonde 156 A', 'inbound', now() - interval '2 hours'),
	(:'espace', '<tst-156-b1@exemple.test>', '{}', null, 'unclassified', 'autre@exemple.test', array['bizdev@p2enjoy.test'], 'Sonde 156 B', 'inbound', now() - interval '90 minutes'),
	(:'espace', '<tst-156-b2@exemple.test>', array['<tst-156-b1@exemple.test>'], null, 'unclassified', 'bizdev@p2enjoy.test', array['autre@exemple.test'], 'Re: Sonde 156 B', 'outbound', now() - interval '1 hour'),
	(:'espace', '<tst-156-s1@exemple.test>', '{}', null, 'unclassified', 'spam@exemple.test', array['systeme@crm.p2enjoy.test'], 'Sonde 156 S', 'inbound', now() - interval '30 minutes'),
	(:'espace', '<tst-156-k1@exemple.test>', '{}', :'c5', 'manual', 'spam@exemple.test', array['client@exemple.test'], 'Sonde 156 K', 'inbound', now() - interval '20 minutes');

insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 156000 + row_number() over (order by m.rfc822_message_id)
  from public.mail_messages m
  join public.mail_inbound_accounts a
    on a.imap_username = case when m.rfc822_message_id = '<tst-156-s1@exemple.test>' then 'systeme@crm.p2enjoy.test'
                              else 'bizdev@p2enjoy.test' end
 where m.rfc822_message_id like '<tst-156-%' and m.card_id is null;

insert into public.mail_message_labels (message_id, label_id, workspace_id, source, applied, set_by, set_at)
select m.id, l.id, :'espace', 'manual', true, :'admin', now()
  from public.mail_messages m, public.mail_labels l
 where m.rfc822_message_id = '<tst-156-a1@exemple.test>' and l.workspace_id = :'espace' and l.name = 'Spam';

select l.id as spam from public.mail_labels l where l.workspace_id = :'espace' and l.name = 'Spam' \gset
select id as a1 from public.mail_messages where rfc822_message_id = '<tst-156-a1@exemple.test>' \gset
select id as a2 from public.mail_messages where rfc822_message_id = '<tst-156-a2@exemple.test>' \gset
select id as b1 from public.mail_messages where rfc822_message_id = '<tst-156-b1@exemple.test>' \gset
select id as k1 from public.mail_messages where rfc822_message_id = '<tst-156-k1@exemple.test>' \gset

-- Les descriptions de portée employées plus bas.
\set expediteur_spam '{"folder": "unclassified", "sender": " SPAM@exemple.test ", "snoozed": "hidden"}'
\set fil_b '{"folder": "unclassified", "snoozed": "hidden", "threads": [{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "thread_key": "<tst-156-b1@exemple.test>"}]}'
\set fil_a '{"folder": "unclassified", "snoozed": "hidden", "threads": [{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "thread_key": "<tst-156-a1@exemple.test>"}]}'

-- 1–3. La forme et les droits d'exécution.
select ok(not has_function_privilege('anon', 'public.inbox_bulk_apply(jsonb, text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.inbox_bulk_count(jsonb)', 'execute'),
	'1 — l''anonyme n''exécute aucune des deux fonctions');
select ok(has_function_privilege('authenticated', 'public.inbox_bulk_apply(jsonb, text, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.inbox_bulk_count(jsonb)', 'execute'),
	'2 — `authenticated` les exécute');
select ok(not has_function_privilege('authenticated', 'app.inbox_scope_messages(jsonb)', 'execute'),
	'3 — la portée elle-même n''est pas exposée');

select pg_temp.endosser(:'driss');

-- 4–8. Les refus de forme, avant toute lecture.
select throws_ok($$select public.inbox_bulk_count('{"folder": "unclassified", "snoozed": "hidden"}')$$,
	'22023', 'filter_required', '4 — « tout le filtre » sans filtre explicite : refusé par la base (§32.3)');
select throws_ok($$select public.inbox_bulk_count('{"folder": "dossier"}')$$,
	'22023', 'invalid_scope', '5 — un dossier inconnu : invalid_scope');
select throws_ok($$select public.inbox_bulk_count('{"folder": "card", "only_me": true}')$$,
	'22023', 'invalid_scope', '6 — une affaire sans `card_id` : invalid_scope');
select throws_ok($$select public.inbox_bulk_count('{"folder": "unclassified", "label_ids": ["pas-un-uuid"]}')$$,
	'22023', 'invalid_scope', '7 — une pastille mal formée : invalid_scope');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', :'fil_b', 'archiver'),
	'22023', 'invalid_action', '8 — une action inconnue : invalid_action');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', :'fil_b', 'classify'),
	'22023', 'invalid_action', '9 — classer sans affaire : invalid_action');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', :'fil_b', 'restore'),
	'22023', 'action_not_allowed_here', '10 — restaurer hors de la corbeille : action_not_allowed_here');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', :'fil_b', 'unclassify'),
	'22023', 'action_not_allowed_here', '11 — déclasser hors d''une affaire : action_not_allowed_here');

-- 12–16. La portée et le compte.
select is((select row(thread_count, message_count)::text from public.inbox_bulk_count(:'expediteur_spam')), '(1,2)',
	'12 — l''expéditeur, sans casse ni blancs : un fil, deux messages ; `s1`, de la boîte système, n''est pas vu par Driss');
select is((select row(thread_count, message_count)::text
             from public.inbox_bulk_count(format('{"folder": "unclassified", "label_ids": ["%s"]}', :'spam')::jsonb)),
	'(1,1)', '13 — la pastille : seul le message qui la porte, pas tout son fil (décision 946)');
select is((select row(thread_count, message_count)::text from public.inbox_bulk_count(:'fil_b')), '(1,2)',
	'14 — un fil coché sans filtre : ses messages du dossier, l''envoi compris');
select is((select row(thread_count, message_count)::text
             from public.inbox_bulk_count(format('{"folder": "card", "card_id": "%s", "sender": "spam@exemple.test"}', :'c5')::jsonb)),
	'(1,1)', '15 — le dossier d''une affaire qu''il lit');
select is((select row(thread_count, message_count)::text
             from public.inbox_bulk_count('{"folder": "unclassified", "sender": "personne@exemple.test"}')), '(0,0)',
	'16 — un filtre qui ne retient rien : zéro, sans erreur');

-- 17–19. Lu, puis non lu : l'état de Driss.
select is(public.inbox_bulk_apply(:'expediteur_spam', 'mark_read') - 'refused',
	'{"threads": 1, "messages": 2, "done": 2, "next": null}'::jsonb, '17 — marquer lu : deux messages faits');
select is((select count(*)::int from public.mail_message_reads r where r.user_id = :'driss' and r.message_id in (:'a1', :'a2')), 2,
	'18 — les deux lectures de Driss sont écrites');
select is(public.inbox_bulk_apply(:'fil_b', 'mark_unread') ->> 'done', '1',
	'19 — non lu sur un fil avec un envoi : seul le reçu est compté, l''envoi n''a pas d''état de lecture');

-- 20–22. Une sélection mixte : réévaluer un fil qui porte un reçu et un envoi.
select is(public.inbox_bulk_apply(:'fil_b', 'request_label_evaluation'),
	'{"threads": 1, "messages": 2, "done": 1, "refused": {"outbound_message": 1}, "next": null}'::jsonb,
	'20 — réévaluer : le reçu remis dans la file, l''envoi refusé sous son code, et le compte rendu le dit');
select is((select state from public.mail_label_evaluations where message_id = :'b1'), 'pending',
	'21 — le reçu est en attente d''évaluation');

-- 22–23. Poser une pastille sur un fil coché.
select is(public.inbox_bulk_apply(:'fil_a', 'set_label', format('{"label_id": "%s", "applied": true}', :'spam')::jsonb) ->> 'done', '2',
	'22 — poser « Spam » sur le fil coché : ses deux messages');
select is((select count(*)::int from public.mail_message_labels where label_id = :'spam' and message_id in (:'a1', :'a2')
            and source = 'manual' and applied), 2, '23 — la pastille est posée à la main sur les deux');

-- 24–25. Classer dans une affaire qu'il n'écrit pas : tout refusé, rien ne bouge.
select is(public.inbox_bulk_apply(:'expediteur_spam', 'classify', format('{"card_id": "%s"}', :'c5')::jsonb),
	'{"threads": 1, "messages": 2, "done": 0, "refused": {"forbidden": 2}, "next": null}'::jsonb,
	'24 — classer dans `…c5`, qu''il lit sans l''écrire : deux refus `forbidden`');
select is((select count(*)::int from public.mail_messages where id in (:'a1', :'a2') and card_id is null), 2,
	'25 — les deux messages restent non classés');

-- 26–28. Le sommeil porte sur des fils.
select is(public.inbox_bulk_apply(:'fil_b', 'snooze', format('{"until": "%s"}', now() + interval '2 days')::jsonb) - 'refused',
	'{"threads": 1, "messages": 2, "done": 1, "next": null}'::jsonb, '26 — endormir : un fil fait, deux messages dans la portée');
select is((select row(thread_count, message_count)::text from public.inbox_bulk_count(:'fil_b')), '(0,0)',
	'27 — en mode `hidden`, le fil endormi sort de la portée, comme de la liste');
select is(public.inbox_bulk_apply(jsonb_set(:'fil_b'::jsonb, '{snoozed}', '"shown"'), 'wake') ->> 'done', '1',
	'28 — en mode `shown`, il se réveille');

-- 29–32. Supprimer ici, puis restaurer depuis la corbeille.
select is(public.inbox_bulk_apply(:'fil_b', 'delete', '{"also_mailbox": false}') ->> 'done', '2',
	'29 — supprimer ici le fil coché : ses deux messages en corbeille');
-- Lu sous la clé de propriétaire : la politique de lecture écarte, à dessein, tout message en corbeille (§29.4).
reset role;
select is((select count(*)::int from public.mail_messages where rfc822_message_id like '<tst-156-b%' and deleted_at is not null
             and deleted_by = :'driss'), 2,
	'30 — ils sont en corbeille, effacés par Driss');
select pg_temp.endosser(:'driss');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', '{"folder": "trash"}', 'restore'),
	'22023', 'invalid_scope', '31 — la corbeille exige les messages cochés');
select is(public.inbox_bulk_apply(format('{"folder": "trash", "message_ids": ["%s"]}', :'b1')::jsonb, 'restore') ->> 'done', '1',
	'32 — restaurer le message coché dans la corbeille');

-- 33–34. La lectrice : non lu permis, classer refusé, par les mêmes règles que l'unité.
select pg_temp.endosser(:'lectrice');
select is(public.inbox_bulk_apply(format('{"folder": "card", "card_id": "%s", "sender": "spam@exemple.test"}', :'c5')::jsonb, 'mark_read') ->> 'done', '1',
	'33 — la lectrice marque lu le message de l''affaire qu''elle lit');
select is(public.inbox_bulk_apply(format('{"folder": "card", "card_id": "%s", "sender": "spam@exemple.test"}', :'c5')::jsonb,
                                  'classify', format('{"card_id": "%s"}', :'c1')::jsonb) -> 'refused',
	'{"forbidden": 1}'::jsonb, '34 — elle ne classe rien : `forbidden`');

-- 35–36. Une panne n'est pas un refus : l'appel entier échoue. La sonde pose, le temps de ce test, un déclencheur qui lève
-- une erreur non nommée quand on retire la lecture de `a2` (déclencheur et fonction défaits par le `rollback` final).
reset role;
create function public.tst_156_panne() returns trigger language plpgsql as $$
begin
	raise exception 'panne_simulee';
end;
$$;
create trigger tst_156_panne before delete on public.mail_message_reads
	for each row when (old.message_id = :'a2'::uuid) execute function public.tst_156_panne();
select pg_temp.endosser(:'driss');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', :'expediteur_spam', 'mark_unread'),
	'P0001', 'panne_simulee', '35 — une erreur non nommée remonte : l''appel échoue au lieu de la compter');
select is((select count(*)::int from public.mail_message_reads r where r.user_id = :'driss' and r.message_id in (:'a1', :'a2')), 2,
	'36 — et rien n''est écrit : les deux lectures de Driss sont toujours là');

-- 37–41. Les paquets : 2 001 messages d'un même expéditeur, chacun son propre fil, dans la boîte de Driss.
reset role;
drop trigger tst_156_panne on public.mail_message_reads;
insert into public.mail_messages (workspace_id, rfc822_message_id, references_ids, card_id, classification, from_address,
                                  to_addresses, subject, direction, received_at)
select :'espace', '<tst-156-masse-' || g || '@exemple.test>', '{}', null, 'unclassified', 'masse@exemple.test',
       array['bizdev@p2enjoy.test'], 'Masse ' || g, 'inbound', now() - (g || ' seconds')::interval
  from generate_series(1, 2001) g;
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 157000 + row_number() over (order by m.id)
  from public.mail_messages m
  join public.mail_inbound_accounts a on a.imap_username = 'bizdev@p2enjoy.test'
 where m.rfc822_message_id like '<tst-156-masse-%';
select pg_temp.endosser(:'driss');
\set masse '{"folder": "unclassified", "sender": "masse@exemple.test", "snoozed": "shown"}'
create temp table premier as select public.inbox_bulk_apply(:'masse', 'mark_read') as r;
select is((select (r ->> 'messages')::int from premier), 2000,
	'37 — le premier paquet porte 2 000 messages, pas un de plus');
select is(public.inbox_bulk_apply(jsonb_set(:'masse'::jsonb, '{after}', (select r -> 'next' from premier)), 'mark_read')
            - 'refused', '{"threads": 1, "messages": 1, "done": 1, "next": null}'::jsonb,
	'38 — le paquet suivant, après le curseur : le dernier message, et `next` nul');
create temp table sommeil as select public.inbox_bulk_apply(:'masse', 'snooze', format('{"until": "%s"}', now() + interval '1 day')::jsonb) as r;
select is((select row((r ->> 'threads')::int, jsonb_typeof(r -> 'next'))::text from sommeil), '(2000,array)',
	'39 — le sommeil se découpe en fils : 2 000 fils, et un curseur `[workspace_id, thread_key]`');
select is((public.inbox_bulk_apply(jsonb_set(:'masse'::jsonb, '{after}', (select r -> 'next' from sommeil)), 'snooze',
                                   format('{"until": "%s"}', now() + interval '1 day')::jsonb)) ->> 'done', '1',
	'40 — le dernier fil, dans le paquet suivant');
select throws_ok(format('select public.inbox_bulk_apply(%L, %L)', jsonb_set(:'masse'::jsonb, '{after}', '"pas-un-uuid"'), 'mark_read'),
	'22023', 'invalid_scope', '41 — un curseur mal formé : invalid_scope');

select * from finish();
rollback;

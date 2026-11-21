-- @verifies CRM-161 (docs/BACKLOG.md) — tranche T1 : l'inbox d'un espace en base — `inbox_messages`, `inbox_hidden_counts`
--           et `inbox_arborescence` prennent l'espace en tête (obligatoire, `workspace_required`), l'ancienne signature
--           supprimée ; un dossier d'affaire d'un autre espace ne rend rien ; la portée des actions groupées exige l'espace et
--           refuse un fil d'un autre (`thread_other_workspace`) ; `inbox_unread_by_workspace` compte chaque espace, zéro
--           compris, sous « Seulement moi » aussi ; un espace dont la personne n'est pas membre ne rend rien
-- @verifies docs/SPEC-mail-subsystem.md §35.2 à §35.4 ; docs/SPEC-espace-courant.md §5, §7.1 ; docs/SCHEMA.md « Migration
--           `0195` » ; docs/JOURNAL.md décisions 965 et 967 ; CLAUDE.md §10
--
-- LE MONTAGE EST ÉCRIT EN PROPRIÉTAIRE, DANS LA TRANSACTION DE LA PREUVE, QUI EST ANNULÉE : un second espace (« Sonde 161 »)
-- dont Camille, administratrice de l'espace du seed, est aussi administratrice, sa boîte système, deux mails non classés
-- (l'un ordinaire et non lu, l'autre pastillé Spam, donc masqué), et un troisième espace sans aucun mail dont elle est
-- membre. Driss n'est membre que de l'espace du seed. Les comptes de l'espace du seed sont mesurés AVANT le montage du
-- second : ils ne doivent pas en bouger.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated', 'iss', 'p2enjoy-crm/session')::text, true);
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
insert into pg_temp_ref values
	('seed', '5eed0000-0000-4000-8000-000000000001'),
	('sonde', 'e1610000-0000-4000-8000-000000000001'),
	('vide', 'e1610000-0000-4000-8000-000000000002'),
	('camille', '5eed0000-0000-4000-8000-000000000011'),
	('driss', '5eed0000-0000-4000-8000-000000000012'),
	-- « Refonte du monitoring — Vertuo », une affaire de l'espace du seed que Camille lit.
	('affaire_seed', '5eed0000-0000-4000-8000-00000000d012');

create or replace function pg_temp.ref(n text) returns text language sql as $$
	select valeur from pg_temp_ref where nom = n;
$$;
create or replace function pg_temp.id(n text) returns uuid language sql as $$
	select valeur::uuid from pg_temp_ref where nom = n;
$$;

-- =============================================================================================
-- 1. Les signatures — §35.2
-- =============================================================================================

select has_function('public', 'inbox_messages', array['uuid', 'uuid', 'boolean', 'uuid[]', 'text', 'integer'],
	'1 — `inbox_messages` prend l''espace en tête');
select hasnt_function('public', 'inbox_messages', array['uuid', 'boolean', 'uuid[]', 'text', 'integer'],
	'2 — et l''ancienne signature, sans espace, n''existe plus');
select has_function('public', 'inbox_hidden_counts', array['uuid', 'uuid', 'boolean', 'uuid[]', 'text', 'boolean'],
	'3 — `inbox_hidden_counts` prend l''espace en tête');
select hasnt_function('public', 'inbox_hidden_counts', array['uuid', 'boolean', 'uuid[]', 'text', 'boolean'],
	'4 — et l''ancienne signature n''existe plus');
select has_function('public', 'inbox_arborescence', array['uuid', 'boolean'],
	'5 — `inbox_arborescence` prend l''espace en tête');
select hasnt_function('public', 'inbox_arborescence', array['boolean'],
	'6 — et l''ancienne signature n''existe plus');
select ok(not has_function_privilege('anon', 'public.inbox_unread_by_workspace(boolean)', 'execute')
          and has_function_privilege('authenticated', 'public.inbox_unread_by_workspace(boolean)', 'execute'),
	'7 — `inbox_unread_by_workspace` : `authenticated` seul');

-- =============================================================================================
-- 2. Les mesures de l'espace du seed, AVANT le second espace
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('camille'));
insert into pg_temp_ref select 'liste_seed', count(*)::text from public.inbox_messages(pg_temp.id('seed'));
insert into pg_temp_ref select 'arbo_seed', (select nombre || ',' || unread_count from public.inbox_arborescence(pg_temp.id('seed'))
                                             where card_id is null);
insert into pg_temp_ref select 'masques_seed', coalesce((select string_agg(label_id || ':' || thread_count, ',' order by label_id)
                                                         from public.inbox_hidden_counts(pg_temp.id('seed'))), '');
insert into pg_temp_ref select 'nonlus_seed', (select unread_count::text from public.inbox_unread_by_workspace()
                                               where workspace_id = pg_temp.id('seed'));
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. Le second espace, sa boîte, ses mails
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('sonde'), 'Sonde 161', 'sonde-161'),
	(pg_temp.id('vide'), 'Sonde 161 vide', 'sonde-161-vide');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('sonde'), pg_temp.id('camille'), 'admin'),
	(pg_temp.id('vide'), pg_temp.id('camille'), 'admin');
insert into public.mail_inbound_accounts (workspace_id, owner_id, label, imap_host, imap_port, imap_username)
values (pg_temp.id('sonde'), null, 'Boîte système sonde 161', 'imap.sonde-161.test', 143, 'systeme@sonde-161.test');
insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, to_addresses,
                                  cc_addresses, bcc_addresses, subject, direction)
values
	(pg_temp.id('sonde'), '<tst-161-a@sonde-161.test>', null, 'unclassified', 'tiers161@exemple.test',
	 array['systeme@sonde-161.test'], '{}', '{}', 'Sonde 161 ordinaire', 'inbound'),
	(pg_temp.id('sonde'), '<tst-161-spam@sonde-161.test>', null, 'unclassified', 'spam161@exemple.test',
	 array['systeme@sonde-161.test'], '{}', '{}', 'Sonde 161 spam', 'inbound');
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 161000 + row_number() over (order by m.rfc822_message_id)
  from public.mail_messages m
  join public.mail_inbound_accounts a on a.imap_username = 'systeme@sonde-161.test'
 where m.rfc822_message_id like '<tst-161-%';
insert into pg_temp_ref
select 'msg_' || case when rfc822_message_id like '%spam%' then 'spam' else 'a' end, id::text
  from public.mail_messages where rfc822_message_id like '<tst-161-%';
insert into pg_temp_ref
select 'fil_a', app.cle_fil(references_ids, rfc822_message_id) from public.mail_messages where id = pg_temp.id('msg_a');
-- Spam est cachée dans tout espace créé (`0193`) : le second mail est masqué.
insert into public.mail_message_labels (message_id, label_id, workspace_id, source, applied)
select pg_temp.id('msg_spam'), l.id, pg_temp.id('sonde'), 'llm', true
  from public.mail_labels l where l.workspace_id = pg_temp.id('sonde') and l.name = 'Spam';
insert into pg_temp_ref
select 'spam_sonde', id::text from public.mail_labels where workspace_id = pg_temp.id('sonde') and name = 'Spam';

-- Le témoin du montage : en propriétaire, les deux mails sont bien dans le second espace, non classés.
select results_eq(
	$$select count(*)::int from public.mail_messages where workspace_id = pg_temp.id('sonde') and card_id is null$$,
	$$values (2)$$,
	'8 — témoin : deux mails non classés dans le second espace');

-- =============================================================================================
-- 4. La liste — §35.2
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('camille'));

select results_eq(
	$$select array_agg(m.id) from public.inbox_messages(pg_temp.id('sonde')) m$$,
	$$values (array[pg_temp.id('msg_a')])$$,
	'9 — la liste du second espace ne rend que son mail visible (le Spam reste masqué)');
select is((select count(*)::text from public.inbox_messages(pg_temp.id('seed'))), pg_temp.ref('liste_seed'),
	'10 — la liste de l''espace du seed n''a pas bougé : aucun mail du second espace n''y paraît');
select is((select count(*)::int from public.inbox_messages(pg_temp.id('seed')) m where m.workspace_id <> pg_temp.id('seed')), 0,
	'11 — et chacune de ses lignes est de l''espace du seed');
select throws_ok($$select * from public.inbox_messages(null)$$, '22023', 'workspace_required',
	'12 — sans espace, la liste est refusée : `workspace_required`');
select is((select count(*)::int from public.inbox_messages(pg_temp.id('sonde'), pg_temp.id('affaire_seed'))), 0,
	'13 — le dossier d''une affaire de l''espace du seed, demandé dans le second espace, ne rend rien');
select ok((select count(*) from public.inbox_messages(pg_temp.id('seed'), pg_temp.id('affaire_seed'))) > 0,
	'14 — témoin : le même dossier, dans son espace, rend ses mails');

-- =============================================================================================
-- 5. La mention des fils masqués — §35.2
-- =============================================================================================

select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts(pg_temp.id('sonde'))$$,
	$$values (pg_temp.id('spam_sonde'), 1)$$,
	'15 — la mention du second espace compte son fil Spam, et lui seul');
select is(coalesce((select string_agg(label_id || ':' || thread_count, ',' order by label_id)
                    from public.inbox_hidden_counts(pg_temp.id('seed'))), ''), pg_temp.ref('masques_seed'),
	'16 — la mention de l''espace du seed n''a pas bougé');
select throws_ok($$select * from public.inbox_hidden_counts(null)$$, '22023', 'workspace_required',
	'17 — sans espace, la mention est refusée');

-- =============================================================================================
-- 6. L'arborescence — §35.2
-- =============================================================================================

select results_eq(
	$$select card_id, nombre::int, unread_count::int from public.inbox_arborescence(pg_temp.id('sonde'))$$,
	$$values (null::uuid, 1, 1)$$,
	'18 — l''arborescence du second espace : « Non classés », un mail, non lu ; aucune affaire');
select is((select nombre || ',' || unread_count from public.inbox_arborescence(pg_temp.id('seed')) where card_id is null),
	pg_temp.ref('arbo_seed'),
	'19 — les compteurs de « Non classés » de l''espace du seed n''ont pas bougé');
select throws_ok($$select * from public.inbox_arborescence(null)$$, '22023', 'workspace_required',
	'20 — sans espace, l''arborescence est refusée');

-- =============================================================================================
-- 7. La portée des actions groupées — §35.3
-- =============================================================================================

select throws_ok(
	$$select * from public.inbox_bulk_count(jsonb_build_object('folder', 'unclassified', 'sender', 'tiers161@exemple.test'))$$,
	'22023', 'invalid_scope',
	'21 — une portée sans espace est refusée : `invalid_scope`');
select results_eq(
	$$select thread_count, message_count from public.inbox_bulk_count(jsonb_build_object(
		'folder', 'unclassified', 'workspace_id', pg_temp.ref('sonde'), 'sender', 'tiers161@exemple.test'))$$,
	$$values (1, 1)$$,
	'22 — dans le second espace, le filtre par expéditeur désigne son fil');
select results_eq(
	$$select thread_count, message_count from public.inbox_bulk_count(jsonb_build_object(
		'folder', 'unclassified', 'workspace_id', pg_temp.ref('seed'), 'sender', 'tiers161@exemple.test'))$$,
	$$values (0, 0)$$,
	'23 — dans l''espace du seed, le même filtre ne désigne rien');
select throws_ok(
	format($$select * from public.inbox_bulk_count(jsonb_build_object('folder', 'unclassified', 'workspace_id', %L,
		'threads', jsonb_build_array(jsonb_build_object('workspace_id', %L, 'thread_key', %L))))$$,
		pg_temp.ref('seed'), pg_temp.ref('sonde'), pg_temp.ref('fil_a')),
	'22023', 'thread_other_workspace',
	'24 — un fil nommé d''un autre espace est refusé : `thread_other_workspace`');

-- =============================================================================================
-- 8. Les non-lus de chaque espace — §35.4
-- =============================================================================================

select results_eq(
	$$select unread_count from public.inbox_unread_by_workspace() where workspace_id = pg_temp.id('sonde')$$,
	$$values (1)$$,
	'25 — le second espace compte un non-lu (le Spam masqué n''est pas compté)');
select is((select unread_count::text from public.inbox_unread_by_workspace() where workspace_id = pg_temp.id('seed')),
	pg_temp.ref('nonlus_seed'),
	'26 — l''espace du seed garde son compte');
select results_eq(
	$$select unread_count from public.inbox_unread_by_workspace() where workspace_id = pg_temp.id('vide')$$,
	$$values (0)$$,
	'27 — un espace sans mail rend zéro, pas une absence');
select results_eq(
	$$select unread_count from public.inbox_unread_by_workspace(true) where workspace_id = pg_temp.id('sonde')$$,
	$$values (0)$$,
	'28 — sous « Seulement moi », le mail adressé à la boîte système ne compte pas pour Camille');
select is((select sum(unread_count)::int from public.inbox_arborescence(pg_temp.id('seed'))),
	(select unread_count from public.inbox_unread_by_workspace() where workspace_id = pg_temp.id('seed')),
	'29 — le compte d''un espace est la somme des non-lus de son arborescence');

-- =============================================================================================
-- 9. Un espace dont la personne n'est pas membre
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('driss'));
select ok((select count(*) from public.inbox_messages(pg_temp.id('sonde'))) = 0
          and not exists (select 1 from public.inbox_unread_by_workspace() where workspace_id = pg_temp.id('sonde')),
	'30 — Driss, non membre du second espace, n''y lit rien et ne le voit pas dans les non-lus, sans erreur');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

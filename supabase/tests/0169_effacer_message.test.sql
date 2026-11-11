-- @verifies CRM-138 (docs/BACKLOG.md) — tranche T1 : effacer, restaurer, la corbeille visible, le déplacement IMAP demandé,
--           la purge ; un message effacé n'est lu nulle part ; chaque refus avec les revendications d'un vrai jeton
-- @verifies docs/SPEC-mail-subsystem.md §29.2 à §29.6 ; docs/SCHEMA.md « Migration `0180` » ; docs/JOURNAL.md
--           décisions 878, 917 et 921 ; docs/SPEC-corbeille.md §8 (règle de visibilité 707) ; CLAUDE.md §10
--
-- Les preuves posent leurs propres messages, dans une transaction annulée : M1, classé dans une affaire que Driss (le
-- business developer, `…0012`) peut écrire, présent dans la boîte de Camille (l'administratrice, `…0011`) ; M2, non classé,
-- présent dans la même boîte. Farida (`…0013`) est la lectrice.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select, insert on pg_temp.ids to authenticated, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;

-- L'affaire que Driss écrit, lue sous son jeton ; la boîte de Camille.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
insert into pg_temp.ids select 'affaire', c.id from public.cards c
 where c.deleted_at is null and app.can_write_card(c.id) and app.card_has_active_placement(c.id) order by c.created_at limit 1;
reset role;
insert into pg_temp.ids select 'boite', a.id from public.mail_inbound_accounts a
 where a.owner_id = '5eed0000-0000-4000-8000-000000000011' order by a.created_at limit 1;
insert into pg_temp.ids values ('m1', gen_random_uuid()), ('m2', gen_random_uuid());
insert into public.mail_messages (id, workspace_id, rfc822_message_id, card_id, classification, direction, from_address, subject, received_at)
values (pg_temp.id('m1'), '5eed0000-0000-4000-8000-000000000001', '<crm138-m1@exemple.test>', pg_temp.id('affaire'), 'manual',
        'inbound', 'client@exemple.test', 'Preuve CRM-138 — classé', now()),
       (pg_temp.id('m2'), '5eed0000-0000-4000-8000-000000000001', '<crm138-m2@exemple.test>', null, 'unclassified',
        'inbound', 'inconnu@exemple.test', 'Preuve CRM-138 — non classé', now());
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
values (pg_temp.id('m1'), pg_temp.id('boite'), 'INBOX', 900001), (pg_temp.id('m2'), pg_temp.id('boite'), 'INBOX', 900002);

-- ------------------------------------------------------------------------------------------------------------------
-- Le modèle
-- ------------------------------------------------------------------------------------------------------------------
select has_column('public', 'mail_messages', 'deleted_at', '1 — le message porte sa date de corbeille');
select has_table('public', 'mail_trash_moves', '2 — les déplacements IMAP ont leur table');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	format($$ insert into public.mail_trash_moves (workspace_id, message_id, account_id, folder, uid) values
	          ('5eed0000-0000-4000-8000-000000000001', %L, %L, 'INBOX', 1) $$, pg_temp.id('m2'), pg_temp.id('boite')),
	'42501', null, '3 — aucune écriture des déplacements pour `authenticated`, administrateur compris');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Effacer : les refus, dans l'ordre
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok(format($$ select public.delete_message(%L) $$, pg_temp.id('m2')), 'PGRST', null,
	'4 — la lectrice ne voit pas le non classé de la boîte de Camille : introuvable');
select throws_ok($$ select public.delete_message(gen_random_uuid()) $$, 'PGRST', null,
	'5 — un message inconnu est introuvable, comme un illisible');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(format($$ select public.delete_message(%L, true) $$, pg_temp.id('m1')), '22023', 'no_writable_mailbox',
	'6 — Driss écrit l''affaire mais aucune boîte du message : la case est refusée, avant toute écriture');
select is((select deleted_at from public.mail_messages where id = pg_temp.id('m1')), null,
	'7 — le refus n''a rien effacé');

-- ------------------------------------------------------------------------------------------------------------------
-- Effacer M1 (classé) sans la case, par Driss
-- ------------------------------------------------------------------------------------------------------------------
select lives_ok(format($$ select public.delete_message(%L) $$, pg_temp.id('m1')),
	'8 — Driss, qui écrit l''affaire, efface le message classé');
select is((select count(*)::integer from public.mail_messages where id = pg_temp.id('m1')), 0,
	'9 — effacé, il n''est plus lu sous la politique, par celui-là même qui l''a effacé');
reset role;
select is((select deleted_by from public.mail_messages where id = pg_temp.id('m1')),
	'5eed0000-0000-4000-8000-000000000012'::uuid, '10 — l''auteur est posé par le serveur');
select is((select count(*)::integer from public.card_events
	where type = 'mail_deleted' and payload ->> 'message_id' = pg_temp.id('m1')::text), 1,
	'11 — le fil de l''affaire reçoit « Message effacé »');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(format($$ select public.delete_message(%L) $$, pg_temp.id('m1')), '12 — effacer deux fois ne refuse pas');
reset role;
select is((select count(*)::integer from public.card_events
	where type = 'mail_deleted' and payload ->> 'message_id' = pg_temp.id('m1')::text), 1,
	'13 — ni ne raconte une seconde histoire');
select ok(not app.peut_voir_message(pg_temp.id('m1')), '14 — la garde des pièces, du fil et du classement ne le voit plus');

-- La date qui décide de la purge est figée : une écriture directe ne la recule pas.
update public.mail_messages set deleted_at = '2000-01-01' where id = pg_temp.id('m1');
select isnt((select deleted_at from public.mail_messages where id = pg_temp.id('m1')), '2000-01-01'::timestamptz,
	'15 — tant qu''il est en corbeille, sa date ne se change pas');

-- ------------------------------------------------------------------------------------------------------------------
-- La corbeille visible (décision 707) et la restauration
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select ok(exists (select 1 from public.trashed_messages('5eed0000-0000-4000-8000-000000000001') where message_id = pg_temp.id('m1')),
	'16 — Driss voit dans la corbeille ce qu''il a effacé');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select ok(not exists (select 1 from public.trashed_messages('5eed0000-0000-4000-8000-000000000001') where message_id = pg_temp.id('m1')),
	'17 — la lectrice, qui ne l''a pas effacé, ne l''y voit pas');
select throws_ok(format($$ select public.restore_message(%L) $$, pg_temp.id('m1')), 'PGRST', null,
	'18 — ni ne peut le restaurer : introuvable pour elle');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select ok(exists (select 1 from public.trashed_messages('5eed0000-0000-4000-8000-000000000001') where message_id = pg_temp.id('m1')),
	'19 — l''administratrice voit toute la corbeille de l''espace');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(format($$ select public.restore_message(%L) $$, pg_temp.id('m1')), '20 — Driss le restaure');
select is((select count(*)::integer from public.mail_messages where id = pg_temp.id('m1')), 1, '21 — restauré, il se lit de nouveau');
reset role;
select is((select count(*)::integer from public.card_events
	where type = 'mail_restored' and payload ->> 'message_id' = pg_temp.id('m1')::text), 1,
	'22 — le fil de l''affaire reçoit « Message restauré »');

-- ------------------------------------------------------------------------------------------------------------------
-- M2 (non classé) avec la case : le déplacement demandé, annulé par la restauration, puis fait par mail-sync
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((public.delete_message(pg_temp.id('m2'), true) ->> 'mailbox_moves')::integer, 1,
	'23 — Camille efface avec la case : un déplacement par occurrence de sa boîte');
select lives_ok(format($$ select public.restore_message(%L) $$, pg_temp.id('m2')), '24 — puis le restaure');
reset role;
select is((select state from public.mail_trash_moves where message_id = pg_temp.id('m2')), 'cancelled',
	'25 — la restauration annule le déplacement en attente');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.delete_message(pg_temp.id('m2'), true);
reset role;
set local role service_role;
select is((select public.trash_move_record(t.id, 'retry', 'timeout') from public.mail_trash_moves t
	where t.message_id = pg_temp.id('m2') and t.state = 'pending'), 'pending', '26 — un essai manqué est réessayé plus tard');
select is((select public.trash_move_record(t.id, 'done') from public.mail_trash_moves t
	where t.message_id = pg_temp.id('m2') and t.state = 'pending'), 'done', '27 — fait, le déplacement est clos');
reset role;
select is((select count(*)::integer from public.mail_message_occurrences where message_id = pg_temp.id('m2') and folder = 'INBOX'), 0,
	'28 — l''occurrence quitte le dossier d''où le message est parti');

-- ------------------------------------------------------------------------------------------------------------------
-- La purge à 30 jours : réservée à mail-sync, journalisée sans l'objet
-- ------------------------------------------------------------------------------------------------------------------
alter table public.mail_messages disable trigger mail_messages_corbeille_avant_ecriture;
update public.mail_messages set deleted_at = now() - interval '31 days' where id = pg_temp.id('m2');
alter table public.mail_messages enable trigger mail_messages_corbeille_avant_ecriture;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(format($$ select public.purge_mail_message(%L) $$, pg_temp.id('m2')), '42501', null,
	'29 — l''administratrice ne purge pas elle-même : la purge est à mail-sync');
reset role;
set local role service_role;
create temp table pg_temp.purge as select public.purge_mail_message(pg_temp.id('m2')) as faite;
reset role;
-- Constaté sous le propriétaire : `service_role` ne lit pas le journal d'audit.
select ok((select faite from pg_temp.purge)
          and not exists (select 1 from public.mail_messages where id = pg_temp.id('m2'))
          and exists (select 1 from public.audit_log l where l.entity_type = 'mail_message' and l.entity_id = pg_temp.id('m2')
                       and l.action = 'purged' and l.entity_label is null),
	'30 — purgé à 31 jours : la ligne part, le journal la nomme sans son objet');

select * from finish();
rollback;

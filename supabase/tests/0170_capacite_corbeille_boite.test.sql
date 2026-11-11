-- @verifies CRM-138 (docs/BACKLOG.md) — tranche T3 : la capacité « L'effacer aussi dans la boîte mail », rendue sur le
--           message par la colonne calculée `mailbox_trash_permitted`, avec les revendications d'un vrai jeton
-- @verifies docs/SPEC-mail-subsystem.md §29.1 (précisé avant le code de T3), §29.3 point 4 ; docs/SCHEMA.md « Migration
--           `0181` » ; docs/DESIGN_SYSTEM.md §5.102 ; CLAUDE.md §10
--
-- Les preuves posent leur propre message, dans une transaction annulée : M, classé dans une affaire que Driss (le
-- business developer, `…0012`) lit, présent dans la seule boîte de Camille (l'administratrice, `…0011`). Puis une
-- occurrence dans la boîte de Driss lui ouvre la case. La capacité doit dire exactement ce que `delete_message` accepte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select, insert on pg_temp.ids to authenticated, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;

-- L'affaire que Driss lit, lue sous son jeton ; la boîte de Camille et celle de Driss.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
insert into pg_temp.ids select 'affaire', c.id from public.cards c
 where c.deleted_at is null and app.can_read_card(c.id) and app.card_has_active_placement(c.id) order by c.created_at limit 1;
reset role;
insert into pg_temp.ids select 'boite_camille', a.id from public.mail_inbound_accounts a
 where a.owner_id = '5eed0000-0000-4000-8000-000000000011' order by a.created_at limit 1;
insert into pg_temp.ids select 'boite_driss', a.id from public.mail_inbound_accounts a
 where a.owner_id = '5eed0000-0000-4000-8000-000000000012' order by a.created_at limit 1;
insert into pg_temp.ids values ('m', gen_random_uuid());
insert into public.mail_messages (id, workspace_id, rfc822_message_id, card_id, classification, direction, from_address, subject, received_at)
values (pg_temp.id('m'), '5eed0000-0000-4000-8000-000000000001', '<crm138-t3@exemple.test>', pg_temp.id('affaire'), 'manual',
        'inbound', 'client@exemple.test', 'Preuve CRM-138 T3', now());
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
values (pg_temp.id('m'), pg_temp.id('boite_camille'), 'INBOX', 910001);

select has_function('public', 'mailbox_trash_permitted', array['mail_messages'], '1 — la colonne calculée existe');

-- Camille, titulaire de la boîte : la case est offerte.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select m.mailbox_trash_permitted from public.mail_messages m where m.id = pg_temp.id('m')), true,
	'2 — la titulaire de la boîte où le message figure peut l''y effacer');
reset role;

-- Driss lit le message par l'affaire, mais aucune de ses boîtes ne le porte : la case est absente, et la base refuse.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select m.mailbox_trash_permitted from public.mail_messages m where m.id = pg_temp.id('m')), false,
	'3 — qui lit le message par l''affaire sans en écrire aucune boîte : faux');
select throws_ok(format($$ select public.delete_message(%L, true) $$, pg_temp.id('m')), '22023', 'no_writable_mailbox',
	'4 — et la base refuse ce que la capacité refuse');
reset role;

-- Le message figure aussi dans la boîte de Driss : la case lui est offerte, et l'administratrice la garde.
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
values (pg_temp.id('m'), pg_temp.id('boite_driss'), 'INBOX', 910002);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select m.mailbox_trash_permitted from public.mail_messages m where m.id = pg_temp.id('m')), true,
	'5 — présent dans sa propre boîte, Driss peut l''y effacer');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*)::integer from public.mail_messages m where m.id = pg_temp.id('m') and m.mailbox_trash_permitted), 1,
	'6 — l''administratrice de l''espace de ces boîtes la garde');
reset role;

select * from finish();
rollback;

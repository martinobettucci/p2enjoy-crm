-- @verifies CRM-138 (docs/BACKLOG.md) — tranche T4 : `trashed_message_workspace` rend l'espace d'un message de la corbeille
--           visible de l'appelant, et rien d'autre, avec les revendications d'un vrai jeton
-- @verifies docs/SPEC-mail-subsystem.md §29.8 (précisé avant le code de T4), §29.4 (la règle de visibilité de la corbeille) ;
--           docs/SCHEMA.md « Migration `0182` » ; CLAUDE.md §10
--
-- La preuve pose son propre message non classé dans la boîte de Camille (l'administratrice, `…0011`), dans une transaction
-- annulée ; Camille l'efface. Driss (`…0012`) n'administre pas l'espace et ne l'a pas effacé ; `anon` n'appelle pas.

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
grant select, insert on pg_temp.ids to authenticated, anon;
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;

insert into pg_temp.ids values ('m', gen_random_uuid());
insert into public.mail_messages (id, workspace_id, rfc822_message_id, classification, direction, from_address, subject, received_at)
values (pg_temp.id('m'), '5eed0000-0000-4000-8000-000000000001', '<crm138-t4@exemple.test>', 'unclassified', 'inbound',
        'client@exemple.test', 'Preuve CRM-138 T4', now());
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select pg_temp.id('m'), a.id, 'INBOX', 920001 from public.mail_inbound_accounts a
 where a.owner_id = '5eed0000-0000-4000-8000-000000000011' order by a.created_at limit 1;

-- Vivant, le message n'est pas dans la corbeille : rien.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(public.trashed_message_workspace(pg_temp.id('m')), null, '1 — un message vivant ne se résout pas par cette ancre');
select public.delete_message(pg_temp.id('m'));
select is(public.trashed_message_workspace(pg_temp.id('m')), '5eed0000-0000-4000-8000-000000000001'::uuid,
	'2 — effacé par elle, son espace est rendu à Camille');
select is(public.trashed_message_workspace(gen_random_uuid()), null, '3 — un identifiant inconnu : rien');
reset role;

-- Driss ne l'a pas effacé et n'administre pas l'espace : il n'est pas dans sa corbeille visible.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(public.trashed_message_workspace(pg_temp.id('m')), null,
	'4 — hors de la corbeille visible de l''appelant : rien, indiscernable d''un inconnu');
reset role;

set local role anon;
select throws_ok(format($$ select public.trashed_message_workspace(%L) $$, pg_temp.id('m')), '42501', null,
	'5 — `anon` n''appelle pas la fonction');
reset role;

select is((select p.prosecdef from pg_proc p where p.oid = 'public.trashed_message_workspace(uuid)'::regprocedure), true,
	'6 — SECURITY DEFINER : la politique de lecture exclut un message effacé, la fonction le lit sous sa propre règle');

select * from finish();
rollback;

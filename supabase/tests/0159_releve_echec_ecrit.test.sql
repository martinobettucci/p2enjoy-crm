-- @verifies CRM-135 (docs/BACKLOG.md) — la relève écrit son échec et son succès sur la boîte, jamais sur une ligne `disabled`
-- @verifies docs/SPEC-mail-subsystem.md §24.3 (`mail_inbound_account_record_poll_failure` et `record_sync` reprise),
--           §24.7 (preuves pgTAP), §13.7 (six codes) ; docs/SCHEMA.md « Migration `0170` » ; docs/JOURNAL.md
--           décisions 873 et 874 ; INC-349
--
-- La suite éprouve la BASE avec les rôles réels. Elle n'ouvre aucune session IMAP : le classement d'un échec et le moment
-- de l'écriture sont l'affaire de `mail-sync` (pytest, et l'intégration contre la vraie base).

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

create or replace function pg_temp.refus(p_sql text) returns text[] language plpgsql as $$
declare
	v_etat text; v_message text; v_detail text;
begin
	execute p_sql;
	return array['aucun refus'];
exception when others then
	get stacked diagnostics v_etat = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
	return array[v_etat, v_message, v_detail];
end;
$$;
grant execute on function pg_temp.refus(text) to service_role;

create or replace function pg_temp.ws() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.farida() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;
create or replace function pg_temp.boite() returns uuid language sql immutable as
	$$ select 'c1350000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.boite_desactivee() returns uuid language sql immutable as
	$$ select 'c1350000-0000-4000-8000-000000000002'::uuid $$;

-- Les comptes du seed sont retirés DANS la transaction (les unicités partielles, suite 0024) ; le `rollback` les rend.
delete from public.mail_inbound_accounts;

insert into public.mail_inbound_accounts
	(id, workspace_id, owner_id, label, imap_host, imap_port, imap_security, imap_username, status, last_error,
	 last_checked_at, last_sync_at)
values
	(pg_temp.boite(), pg_temp.ws(), pg_temp.driss(), 'Driss', 'imap.test', 143, 'none', 'driss', 'ok', null,
	 '2026-11-01 08:00+00', '2026-11-01 09:00+00'),
	(pg_temp.boite_desactivee(), pg_temp.ws(), pg_temp.farida(), 'Farida', 'imap.test', 143, 'none', 'farida',
	 'disabled', null, null, null);

-- =============================================================================================
-- 1. Les droits : un constat du serveur (§24.3)
-- =============================================================================================

select has_function('public', 'mail_inbound_account_record_poll_failure', array['uuid', 'text'],
	'1 — la fonction qui écrit l''échec d''une relève existe');

select ok(not has_function_privilege('authenticated', 'public.mail_inbound_account_record_poll_failure(uuid, text)', 'execute'),
	'2 — authenticated n''écrit pas l''échec d''une relève');

select ok(not has_function_privilege('anon', 'public.mail_inbound_account_record_poll_failure(uuid, text)', 'execute'),
	'3 — anon n''écrit pas l''échec d''une relève');

select ok(not has_function_privilege('authenticated', 'public.mail_inbound_account_record_sync(uuid)', 'execute'),
	'4 — la reprise de record_sync reste refusée à authenticated');

-- =============================================================================================
-- 2. L'échec s'écrit, sans toucher les deux dates (§24.3)
-- =============================================================================================

set local role service_role;

select lives_ok(
	$$ select public.mail_inbound_account_record_poll_failure(pg_temp.boite(), 'auth_failed') $$,
	'5 — service_role écrit l''échec d''une relève');

reset role;

select is((select status from public.mail_inbound_accounts where id = pg_temp.boite()), 'error',
	'6 — la boîte passe en erreur');
select is((select last_error from public.mail_inbound_accounts where id = pg_temp.boite()), 'auth_failed',
	'7 — le code de l''échec est écrit');
select is((select last_checked_at from public.mail_inbound_accounts where id = pg_temp.boite()),
	'2026-11-01 08:00+00'::timestamptz,
	'8 — last_checked_at n''est pas touchée : la garde de 30 s du test ne mord pas après une relève');
select is((select last_sync_at from public.mail_inbound_accounts where id = pg_temp.boite()),
	'2026-11-01 09:00+00'::timestamptz,
	'9 — last_sync_at n''est pas touchée : elle reste la dernière relève réussie');

set local role service_role;

select is(
	(pg_temp.refus($$ select public.mail_inbound_account_record_poll_failure(pg_temp.boite(), 'Login failed for driss') $$))[1],
	'23514',
	'10 — un texte de serveur n''entre pas : la contrainte des six codes le refuse');

select is(
	pg_temp.refus($$ select public.mail_inbound_account_record_poll_failure('c1350000-0000-4000-8000-0000000000ff', 'timeout') $$),
	array['PGRST', '{"code": "P0002", "message": "account_not_found"}', '{"status": 404, "headers": {}}'],
	'11 — un compte inconnu est refusé, pas passé sous silence');

select lives_ok(
	$$ select public.mail_inbound_account_record_poll_failure(pg_temp.boite_desactivee(), 'auth_failed') $$,
	'12 — l''échec sur une boîte désactivée ne lève pas');

reset role;

select is((select status from public.mail_inbound_accounts where id = pg_temp.boite_desactivee()), 'disabled',
	'13 — une boîte désactivée reste désactivée');
select is((select last_error from public.mail_inbound_accounts where id = pg_temp.boite_desactivee()), null,
	'14 — et son last_error n''est pas réécrit');

-- =============================================================================================
-- 3. La relève allée au bout rend la boîte `ok` (§24.3)
-- =============================================================================================

set local role service_role;

select is(public.mail_inbound_account_record_sync(pg_temp.boite()), now(),
	'15 — la relève réussie se date toujours à l''horloge de la base');

reset role;

select is((select status from public.mail_inbound_accounts where id = pg_temp.boite()), 'ok',
	'16 — la relève réussie rend la boîte ok');
select is((select last_error from public.mail_inbound_accounts where id = pg_temp.boite()), null,
	'17 — et efface l''incident');

set local role service_role;
select public.mail_inbound_account_record_sync(pg_temp.boite_desactivee());
reset role;

select is((select status from public.mail_inbound_accounts where id = pg_temp.boite_desactivee()), 'disabled',
	'18 — une relève réussie ne réactive pas une boîte désactivée');
select is((select last_sync_at from public.mail_inbound_accounts where id = pg_temp.boite_desactivee()), now(),
	'19 — mais elle la date : la relève a eu lieu');

select * from finish();

rollback;

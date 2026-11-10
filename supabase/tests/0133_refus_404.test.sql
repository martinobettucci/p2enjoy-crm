-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.a : le compte des levées « introuvable » révisé (décision 51), +1
-- @verifies CRM-120 (docs/BACKLOG.md) — tranche T2 : les refus « introuvable » rendent 404 — la fonction qui lève,
--           sa forme (SQLSTATE `PGRST`, code `P0002` et message inchangés dans le corps, statut dans le détail), ses
--           privilèges, plus aucune levée de `P0002`, et deux refus réels : un 404 sous la RLS, le 409 de
--           `outbox_not_reschedulable`
-- @verifies CRM-127 (docs/BACKLOG.md) — tranche T2 : le compte de l'assertion 5 inclut ses deux fonctions (migration 0151)
-- @verifies CRM-128 (docs/BACKLOG.md) — tranche T2 : le compte de l'assertion 5 inclut ses deux fonctions (migration 0162,
--           docs/SPEC-mails-prepares.md §3.4, §3.5)
-- @verifies CRM-135 (docs/BACKLOG.md) — le compte de l'assertion 5 inclut `mail_inbound_account_record_poll_failure`
--           (migration 0170, docs/SPEC-mail-subsystem.md §24.3), et son témoin 5 bis la nomme
-- @verifies docs/SPEC-refus-404.md §2, §3, §4 ; docs/JOURNAL.md décisions 762 et 797 ; CLAUDE.md §10
--
-- Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Le refus levé par une requête, tel que PostgREST le lit : SQLSTATE, message, détail.
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
grant execute on function pg_temp.refus(text) to authenticated;

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- 1. La fonction
select has_function('app', 'raise_http_error', array['integer', 'text'], '1 — `app.raise_http_error(integer, text)` existe');

select is(
	pg_temp.refus($$ select app.raise_http_error(404, 'x_not_found') $$),
	array['PGRST', '{"code": "P0002", "message": "x_not_found"}', '{"status": 404, "headers": {}}'],
	'2 — elle lève `PGRST`, le code `P0002` et le message en JSON, le statut 404 dans le détail');

select ok(
	has_function_privilege('authenticated', 'app.raise_http_error(integer, text)', 'execute')
	and has_function_privilege('service_role', 'app.raise_http_error(integer, text)', 'execute')
	and not has_function_privilege('anon', 'app.raise_http_error(integer, text)', 'execute'),
	'3 — exécutable par `authenticated` et `service_role` (fonctions à droits de l''appelant), jamais par `anon`');

-- 2. L'inventaire réécrit
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('public', 'app') and p.prosrc ~* 'raise[^;]*errcode\s*=\s*''P0002'''),
	0,
	'4 — plus aucune fonction de `public` ni d''`app` ne lève `P0002` par `errcode` (le code ne vit plus que dans le corps)');

select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('public', 'app') and p.prosrc ~ 'app\.raise_http_error\(404, '),
	-- RÉVISÉ PAR `CRM-127` T2 (migration 0151), non relâché : deux fonctions de plus lèvent par ce chemin,
	-- `mail_inbound_account_record_sync` et `authorize_mail_connection_test` (docs/SPEC-mail-subsystem.md §23.2, §23.3).
	-- RÉVISÉ PAR `CRM-112` T2.a (migration 0155), non relâché : `app.workflow_transition_required_common_fields_avant` refuse
	-- une transition inconnue par ce chemin (`transition_not_found`, docs/SPEC-champs-communs.md §5).
	-- RÉVISÉ PAR `CRM-135` (migration 0170), non relâché : `mail_inbound_account_record_poll_failure` refuse un compte
	-- inconnu par ce chemin (`account_not_found`, docs/SPEC-mail-subsystem.md §24.3). Le témoin 5 bis la nomme.
	33,
	'5 — les vingt-sept fonctions « introuvable » de CRM-120, les deux de CRM-127, celle de CRM-112, les deux de CRM-128 (`send_email_draft`, `discard_email_draft`) et celle de CRM-135 (`mail_inbound_account_record_poll_failure`) lèvent par `app.raise_http_error(404, …)`');

select ok(
	(select p.prosrc ~ 'app\.raise_http_error\(404, ''account_not_found''\)'
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mail_inbound_account_record_poll_failure'),
	'5 bis — témoin : `mail_inbound_account_record_poll_failure` (CRM-135) est l''une des 33, et refuse un compte inconnu par `app.raise_http_error(404, ''account_not_found'')`');

select is(
	(select array_agg(p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('public', 'app') and p.prosrc ~ 'app\.raise_http_error\(409, '),
	array['reprogrammer_envoi'],
	'6 — seule `reprogrammer_envoi` lève par `app.raise_http_error(409, …)` (décision 797)');

-- 3. Deux refus réels
select is(
	pg_temp.refus($$ select public.reprogrammer_envoi('00000000-0000-4000-8000-0000000000ff', 'timeout', 60) $$),
	array['PGRST', '{"code": "P0002", "message": "outbox_not_reschedulable"}', '{"status": 409, "headers": {}}'],
	'7 — un envoi absent ou qui n''est plus en cours ne se reprogramme pas : 409');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	pg_temp.refus($$ select public.export_contacts('00000000-0000-4000-8000-0000000000ff') $$),
	array['PGRST', '{"code": "P0002", "message": "workspace_not_found"}', '{"status": 404, "headers": {}}'],
	'8 — sous la session d''une personne, un espace qui n''est pas le sien est introuvable : 404, message inchangé');
reset role;

select is(
	pg_temp.refus($$ select public.set_default_workflow('00000000-0000-4000-8000-0000000000ff') $$),
	array['PGRST', '{"code": "P0002", "message": "workflow introuvable"}', '{"status": 404, "headers": {}}'],
	'9 — un message à espace reste tel quel (`workflow introuvable`)');

select * from finish();
rollback;

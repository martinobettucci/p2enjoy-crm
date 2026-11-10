-- @verifies CRM-136 (docs/BACKLOG.md) — tranche T1 : le quota d'une identité réglable, retour à « aucun plafond » compris
--           (`p_daily_quota_set`), ses refus ; et les deux bornes de relève qu'exposera l'écran de la boîte
--           (`watch_folders` non vide, `backfill_months` de 0 à 120)
-- @verifies docs/SPEC-mail-subsystem.md §25.6, §25.9 (ligne « pgTAP ») ; docs/SCHEMA.md « Migration `0178` » ;
--           docs/JOURNAL.md décisions 875, 884 et 885 ; CLAUDE.md §10
--
-- Les identités et les boîtes sont celles du seed (docs/SPEC-seed.md §22) : l'identité de Driss (`contact@`), sa boîte
-- (`bizdev@`), et l'identité de Camille. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
create or replace function pg_temp.refus(p_sql text) returns text[] language plpgsql as $$
declare
	v_etat text; v_message text;
begin
	execute p_sql;
	return array['aucun refus'];
exception when others then
	get stacked diagnostics v_etat = returned_sqlstate, v_message = message_text;
	return array[v_etat, v_message];
end;
$$;
grant execute on function pg_temp.refus(text) to authenticated;

create or replace function pg_temp.driss() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.camille() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.espace() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;

-- L'identité de Driss telle que l'écran la renvoie : ses champs inchangés, sans mot de passe, le quota et son drapeau.
create or replace function pg_temp.regler(p_quota integer, p_set boolean) returns text language sql as $$
	select format(
		'select public.upsert_mail_outbound_identity(p_workspace_id => %L, p_label => %L, p_smtp_host => %L, p_smtp_port => %s,'
		' p_smtp_security => %L, p_smtp_username => %L, p_from_address => %L, p_owner_id => %L, p_is_default => true,'
		' p_daily_quota => %s, p_daily_quota_set => %s)',
		pg_temp.espace(), 'Envoi de Driss Lemoine', 'stalwart', 587, 'none', 'bizdev@p2enjoy.test', 'contact@p2enjoy.test',
		pg_temp.driss(), coalesce(p_quota::text, 'null'), case when p_set then 'true' else 'false' end)
$$;
grant execute on function pg_temp.regler(integer, boolean) to authenticated;
create or replace function pg_temp.quota_de_driss() returns integer language sql as $$
	select daily_quota from public.mail_outbound_identities
	 where owner_id = '5eed0000-0000-4000-8000-000000000012' and from_address = 'contact@p2enjoy.test'
$$;

-- 1. La signature et ses droits
select has_function(
	'public', 'upsert_mail_outbound_identity',
	array['uuid', 'text', 'text', 'integer', 'text', 'text', 'text', 'text', 'uuid', 'text', 'text', 'boolean', 'integer', 'boolean'],
	'1 — `upsert_mail_outbound_identity` porte `p_daily_quota_set` en quatorzième paramètre');
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'upsert_mail_outbound_identity'),
	1,
	'2 — une seule signature : l''ancienne est retirée, PostgREST n''a pas deux surcharges à départager');
select ok(
	has_function_privilege('authenticated', 'public.upsert_mail_outbound_identity(uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer, boolean)', 'execute')
	and has_function_privilege('service_role', 'public.upsert_mail_outbound_identity(uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer, boolean)', 'execute')
	and not has_function_privilege('anon', 'public.upsert_mail_outbound_identity(uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer, boolean)', 'execute'),
	'3 — exécutable par `authenticated` et `service_role`, jamais par `anon`');

-- 2. Le quota, sous la session de Driss
select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(pg_temp.regler(200, true)), array['aucun refus'], '4 — Driss pose un plafond de 200 sur son identité');
select pg_temp.redevenir_proprietaire();
select is(pg_temp.quota_de_driss(), 200, '5 — le plafond est écrit');

select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(pg_temp.regler(null, false)), array['aucun refus'], '6 — un appel sans le drapeau (harnais, seed) passe');
select pg_temp.redevenir_proprietaire();
select is(pg_temp.quota_de_driss(), 200, '7 — sans le drapeau, `NULL` CONSERVE le plafond : les appelants existants ne l''écrasent pas');

select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(pg_temp.regler(null, true)), array['aucun refus'], '8 — avec le drapeau, `NULL` est envoyé tel quel');
select pg_temp.redevenir_proprietaire();
select is(pg_temp.quota_de_driss(), null::integer, '9 — retour à « aucun plafond » : le quota est `NULL`');

select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(pg_temp.regler(0, true)), array['aucun refus'], '10 — `0` est une interdiction explicite d''envoyer, acceptée');
select is(
	(pg_temp.refus(pg_temp.regler(100001, true)))[1],
	'23514',
	'11 — au-delà de 100 000, la borne `mail_outbound_identities_quota_borne` refuse');
select pg_temp.redevenir_proprietaire();
select is(pg_temp.quota_de_driss(), 0, '12 — le refus n''a rien écrit : le quota reste `0`');

-- 3. Un membre ne règle pas l'identité d'un autre
select pg_temp.endosser(pg_temp.driss());
select is(
	pg_temp.refus(format(
		'select public.upsert_mail_outbound_identity(p_workspace_id => %L, p_label => %L, p_smtp_host => %L, p_smtp_port => 587,'
		' p_smtp_security => %L, p_smtp_username => %L, p_from_address => %L, p_owner_id => %L,'
		' p_daily_quota => null, p_daily_quota_set => true)',
		pg_temp.espace(), 'Envoi de Camille Aubert', 'stalwart', 'none', 'admin@p2enjoy.test', 'admin@p2enjoy.test', pg_temp.camille())),
	array['42501', 'forbidden'],
	'13 — Driss, business developer, ne règle pas le quota de l''identité de Camille');
select pg_temp.redevenir_proprietaire();

-- 4. Les deux bornes de relève qu'exposera l'écran de la boîte (§25.4, §25.5), sous la session de Driss, sur sa boîte
create or replace function pg_temp.boite(p_dossiers text, p_mois integer) returns text language sql as $$
	select format(
		'select public.upsert_mail_inbound_account(p_workspace_id => %L, p_label => %L, p_imap_host => %L, p_imap_port => 143,'
		' p_imap_security => %L, p_imap_username => %L, p_password => null, p_owner_id => %L, p_watch_folders => %s,'
		' p_folder_style => null, p_backfill_months => %s)',
		'5eed0000-0000-4000-8000-000000000001', 'Boîte de Driss Lemoine', 'stalwart', 'none', 'bizdev@p2enjoy.test',
		'5eed0000-0000-4000-8000-000000000012', p_dossiers, p_mois)
$$;
grant execute on function pg_temp.boite(text, integer) to authenticated;
select pg_temp.endosser(pg_temp.driss());
select is(
	(pg_temp.refus(pg_temp.boite('array[]::text[]', 0)))[1],
	'23514',
	'14 — aucun dossier coché : `mail_inbound_accounts_watch_folders_non_vide` refuse');
select is(
	(pg_temp.refus(pg_temp.boite('array[''INBOX'']', 121)))[1],
	'23514',
	'15 — 121 mois : la borne de l''historique refuse');
select is(
	pg_temp.refus(pg_temp.boite('array[''INBOX'', ''Junk Mail'']', 3)),
	array['aucun refus'],
	'16 — deux dossiers et trois mois d''historique : accepté');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

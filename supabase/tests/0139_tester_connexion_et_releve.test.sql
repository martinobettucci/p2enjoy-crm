-- @verifies CRM-120 (docs/BACKLOG.md) — les deux refus « introuvable » passent par `app.raise_http_error` (docs/SPEC-refus-404.md §2)
-- @verifies CRM-127 (docs/BACKLOG.md) — tranche T2 : la relève écrit `last_sync_at`, et le droit de tester une connexion
-- @verifies docs/SPEC-mail-subsystem.md §23.2 (`mail_inbound_account_record_sync`, réservée à `service_role`), §23.3
--           (le droit d'écrire la ligne, `not_found` sans divulgation, `disabled`, garde de 30 s, `invalid_target`)
-- @verifies docs/SCHEMA.md « Migration `0151` » ; docs/SPEC-permissions-rls.md §7, preuves de refus n° 7 et n° 11 ;
--           docs/JOURNAL.md décision 816 ; INC-340
--
-- La suite éprouve la BASE avec les rôles réels. Elle n'ouvre aucune session IMAP ni SMTP : c'est l'affaire de la
-- fonction edge et de `mail-sync`, éprouvés sur la pile par `e2e/api/tester-connexion.spec.ts`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Le refus tel que `app.raise_http_error` le lève (`CRM-120`) : SQLSTATE `PGRST`, corps JSON, statut dans le détail.
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
grant execute on function pg_temp.refus(text) to authenticated, service_role;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Les membres du seed socle : Camille administratrice, Driss business developer, Farida lectrice.
create or replace function pg_temp.ws() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.camille() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.farida() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- Les lignes de la suite. Les comptes du seed sont retirés DANS la transaction, pour la raison que donne la suite 0024 :
-- les unicités partielles refusent une seconde boîte système ou personnelle. Le `rollback` final les rend.
create or replace function pg_temp.boite_systeme() returns uuid language sql immutable as
	$$ select 'c1270000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.boite_driss() returns uuid language sql immutable as
	$$ select 'c1270000-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.boite_farida() returns uuid language sql immutable as
	$$ select 'c1270000-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.identite_service() returns uuid language sql immutable as
	$$ select 'c1270000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.identite_driss() returns uuid language sql immutable as
	$$ select 'c1270000-0000-4000-8000-000000000012'::uuid $$;

delete from public.mail_inbound_accounts;

insert into public.mail_inbound_accounts
	(id, workspace_id, owner_id, label, imap_host, imap_port, imap_security, imap_username)
values
	(pg_temp.boite_systeme(), pg_temp.ws(), null,            'Système', 'imap.test', 143, 'none', 'systeme'),
	(pg_temp.boite_driss(),   pg_temp.ws(), pg_temp.driss(),  'Driss',   'imap.test', 143, 'none', 'driss'),
	(pg_temp.boite_farida(),  pg_temp.ws(), pg_temp.farida(), 'Farida',  'imap.test', 143, 'none', 'farida');

insert into public.mail_outbound_identities
	(id, workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security, smtp_username, from_address, is_default)
values
	(pg_temp.identite_service(), pg_temp.ws(), null,           'Service', 'smtp.test', 587, 'none', 'service',
	 'service@p2enjoy.test', false),
	(pg_temp.identite_driss(),   pg_temp.ws(), pg_temp.driss(), 'Driss',  'smtp.test', 587, 'none', 'driss',
	 'driss@p2enjoy.test', false);

-- =============================================================================================
-- 1. `mail_inbound_account_record_sync` : un constat du serveur (§23.2)
-- =============================================================================================

select has_function('public', 'mail_inbound_account_record_sync', array['uuid'],
	'1 — la fonction qui date la relève existe');

select ok(not has_function_privilege('authenticated', 'public.mail_inbound_account_record_sync(uuid)', 'execute'),
	'2 — authenticated ne date pas une relève');

select ok(not has_function_privilege('anon', 'public.mail_inbound_account_record_sync(uuid)', 'execute'),
	'3 — anon ne date pas une relève');

set local role service_role;

select is(
	public.mail_inbound_account_record_sync(pg_temp.boite_driss()),
	now(),
	'4 — service_role pose l''horloge de la base, et la rend');

select is(
	(select last_sync_at from public.mail_inbound_accounts where id = pg_temp.boite_driss()),
	now(),
	'5 — last_sync_at est relue en base');

select is(
	(select status from public.mail_inbound_accounts where id = pg_temp.boite_driss()),
	'pending',
	'6 — la relève ne touche pas status : il reste le constat du test de connexion (§23.1)');

select is(
	pg_temp.refus($$ select public.mail_inbound_account_record_sync('c1270000-0000-4000-8000-0000000000ff') $$),
	array['PGRST', '{"code": "P0002", "message": "account_not_found"}', '{"status": 404, "headers": {}}'],
	'7 — un compte inconnu est refusé, pas passé sous silence');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 2. `authorize_mail_connection_test` : le droit d'écrire la ligne (§23.3)
-- =============================================================================================

select ok(not has_function_privilege('anon', 'public.authorize_mail_connection_test(text, uuid)', 'execute'),
	'8 — anon ne peut pas demander un test (preuve de refus n° 11)');

select pg_temp.endosser(pg_temp.camille());

select lives_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_systeme()),
	'9 — l''administratrice teste la boîte système');

select lives_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_driss()),
	'10 — l''administratrice teste la boîte d''un membre');

select lives_ok(
	format($$ select public.authorize_mail_connection_test('outbound', %L) $$, pg_temp.identite_service()),
	'11 — l''administratrice teste l''identité de service');

select throws_ok(
	format($$ select public.authorize_mail_connection_test('carrier-pigeon', %L) $$, pg_temp.boite_driss()),
	'22023', 'invalid_target',
	'12 — une cible hors de inbound et outbound est refusée');

select is(
	pg_temp.refus($$ select public.authorize_mail_connection_test('inbound', 'c1270000-0000-4000-8000-0000000000ff') $$),
	array['PGRST', '{"code": "P0002", "message": "not_found"}', '{"status": 404, "headers": {}}'],
	'13 — un identifiant inconnu rend not_found');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.driss());

select lives_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_driss()),
	'14 — un membre teste sa propre boîte');

select lives_ok(
	format($$ select public.authorize_mail_connection_test('outbound', %L) $$, pg_temp.identite_driss()),
	'15 — un membre teste sa propre identité');

select is(
	pg_temp.refus(format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_systeme())),
	array['PGRST', '{"code": "P0002", "message": "not_found"}', '{"status": 404, "headers": {}}'],
	'16 — un membre ne teste pas la boîte système, et apprend seulement not_found');

select is(
	pg_temp.refus(format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_farida())),
	array['PGRST', '{"code": "P0002", "message": "not_found"}', '{"status": 404, "headers": {}}'],
	'17 — un membre ne teste pas la boîte d''un collègue : même réponse qu''une ligne absente (preuve n° 7)');

select is(
	pg_temp.refus(format($$ select public.authorize_mail_connection_test('outbound', %L) $$, pg_temp.identite_service())),
	array['PGRST', '{"code": "P0002", "message": "not_found"}', '{"status": 404, "headers": {}}'],
	'18 — un membre ne teste pas l''identité de service');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.farida());

select lives_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_farida()),
	'19 — la lectrice teste sa propre boîte : le droit est celui de la ligne, pas celui du rôle');

select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(null);
select throws_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_systeme()),
	'42501', 'not_authenticated',
	'20 — sans sujet dans le jeton, not_authenticated');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. `disabled` et la garde de 30 secondes (§23.3)
-- =============================================================================================

update public.mail_inbound_accounts set status = 'disabled' where id = pg_temp.boite_driss();
update public.mail_outbound_identities set last_checked_at = now() - interval '10 seconds'
 where id = pg_temp.identite_driss();
update public.mail_inbound_accounts set last_checked_at = now() - interval '10 seconds'
 where id = pg_temp.boite_farida();

select pg_temp.endosser(pg_temp.driss());

select throws_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_driss()),
	'55000', 'disabled',
	'21 — une ligne désactivée ne se teste pas : le test écraserait la décision d''exploitation');

select throws_ok(
	format($$ select public.authorize_mail_connection_test('outbound', %L) $$, pg_temp.identite_driss()),
	'P0001', 'too_soon',
	'22 — un test il y a 10 s : too_soon');

select is(
	pg_temp.refus(format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_farida())),
	array['PGRST', '{"code": "P0002", "message": "not_found"}', '{"status": 404, "headers": {}}'],
	'23 — le droit est jugé AVANT la garde : la date du dernier test d''un collègue ne se devine pas');

select pg_temp.redevenir_proprietaire();

update public.mail_outbound_identities set last_checked_at = now() - interval '31 seconds'
 where id = pg_temp.identite_driss();

select pg_temp.endosser(pg_temp.driss());

select lives_ok(
	format($$ select public.authorize_mail_connection_test('outbound', %L) $$, pg_temp.identite_driss()),
	'24 — un test il y a 31 s : de nouveau permis');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.camille());

select throws_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_driss()),
	'55000', 'disabled',
	'25 — disabled vaut aussi pour l''administratrice');

select throws_ok(
	format($$ select public.authorize_mail_connection_test('inbound', %L) $$, pg_temp.boite_farida()),
	'P0001', 'too_soon',
	'26 — la garde vaut aussi pour l''administratrice');

-- La garde n'écrit rien : refusée ou permise, la demande laisse la ligne telle quelle.
select pg_temp.redevenir_proprietaire();

select is(
	(select last_checked_at from public.mail_outbound_identities where id = pg_temp.identite_driss()),
	now() - interval '31 seconds',
	'27 — demander un test n''écrit pas last_checked_at : seul le service le fait, à la fin du test');

select * from finish();

rollback;

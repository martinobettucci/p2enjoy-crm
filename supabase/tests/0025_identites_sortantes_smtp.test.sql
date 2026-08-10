-- @verifies CRM-053 (docs/BACKLOG.md) — identités sortantes SMTP
-- @verifies docs/SPEC-mail-subsystem.md §2.2 (entrant et sortant divergent), §14.2 (modèle et
--           identité par défaut), §14.3 (qui lit quoi), §14.4 (voie de sortie du secret),
--           §13.7 (les six codes, partagés avec IMAP)
-- @verifies docs/SCHEMA.md §12 ; docs/SPEC-permissions-rls.md §7 (secondes moitiés des n° 6 et 7)
-- @verifies docs/JOURNAL.md décision 318
--
-- Comme la suite 0024, elle retire les lignes seedées DANS sa transaction : les index uniques
-- partiels de l'identité par défaut butent sinon sur ce que le seed vient de poser, et le verdict
-- dépendrait de l'ordre des commandes plutôt que du produit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
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

delete from public.mail_outbound_identities;

-- =============================================================================================
-- 1. La table et ses invariants
-- =============================================================================================

select has_table('public', 'mail_outbound_identities',
	'1 — la table des identités sortantes existe');

select has_column('public', 'mail_outbound_identities', 'from_address',
	'2 — l''adresse d''expédition est portée : c''est la seule donnée que le destinataire verra');

select hasnt_column('public', 'mail_outbound_identities', 'password',
	'3 — aucune colonne de mot de passe : le secret vit dans Vault');

select col_is_null('public', 'mail_outbound_identities', 'owner_id',
	'4 — owner_id est nullable : nul = identité de service du workspace');

select is(
	(select count(*)::int from pg_indexes
	  where schemaname = 'public' and tablename = 'mail_outbound_identities'
	    and indexdef ilike '%unique%' and indexdef ilike '%is_default%'),
	2,
	'5 — DEUX index uniques partiels sur l''identité par défaut : une par personne, une de service');

select has_trigger('public', 'mail_outbound_identities', 'mail_outbound_identities_defaut',
	'6 — un trigger tient l''identité par défaut');

-- LE TRIGGER EST `BEFORE`, ET C'EST MESURÉ. Écrit `AFTER`, l'index unique refusait la seconde
-- identité AVANT que le rabattement n'ait lieu. Un invariant tenu par un index et rétabli par un
-- trigger n'a de sens que si le second parle en premier.
select is(
	(select t.tgtype::int & 2 from pg_trigger t
	  where t.tgrelid = 'public.mail_outbound_identities'::regclass
	    and t.tgname = 'mail_outbound_identities_defaut'),
	2,
	'7 — et il est BEFORE : sinon l''index refuse avant que le défaut ne soit rabattu');

select has_trigger('public', 'mail_outbound_identities', 'mail_outbound_identities_proprietaire',
	'8 — le propriétaire d''une identité personnelle est vérifié');

-- =============================================================================================
-- 2. Les contraintes mordent
-- =============================================================================================

select throws_ok(
	$$ insert into public.mail_outbound_identities (workspace_id, label, smtp_host, smtp_port,
	     smtp_security, smtp_username, from_address)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 587, 'none', 'u',
	           'pas-une-adresse') $$,
	'23514',
	null,
	'9 — une adresse d''expédition qui n''en est pas une est REFUSÉE : le destinataire la verrait');

select throws_ok(
	$$ insert into public.mail_outbound_identities (workspace_id, label, smtp_host, smtp_port,
	     smtp_security, smtp_username, from_address)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 587, 'smtps', 'u', 'a@b.tld') $$,
	'23514',
	null,
	'10 — un mode de sécurité inconnu est refusé');

select throws_ok(
	$$ insert into public.mail_outbound_identities (workspace_id, label, smtp_host, smtp_port,
	     smtp_security, smtp_username, from_address, last_error)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 587, 'none', 'u', 'a@b.tld',
	           '535 5.7.8 Authentication credentials invalid') $$,
	'23514',
	null,
	'11 — le texte brut d''un serveur distant est REFUSÉ dans last_error, comme en IMAP');

select lives_ok(
	$$ insert into public.mail_outbound_identities (workspace_id, label, smtp_host, smtp_port,
	     smtp_security, smtp_username, from_address, last_error)
	   values ('5eed0000-0000-4000-8000-000000000001', 'sonde', 'h', 587, 'none', 'u', 'a@b.tld',
	           'auth_failed') $$,
	'12 — un code du catalogue partagé avec IMAP est accepté');

select throws_ok(
	$$ insert into public.mail_outbound_identities (workspace_id, label, smtp_host, smtp_port,
	     smtp_security, smtp_username, from_address, daily_quota)
	   values ('5eed0000-0000-4000-8000-000000000001', 'y', 'h', 587, 'none', 'u', 'c@d.tld', -1) $$,
	'23514',
	null,
	'13 — un quota négatif est refusé');

select lives_ok(
	$$ delete from public.mail_outbound_identities $$,
	'14 — les sondes de contraintes sont retirées');

-- =============================================================================================
-- 3. Privilèges — secondes moitiés des refus n° 6 et n° 11
-- =============================================================================================

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_outbound_identities'
	    and grantee = 'authenticated' and column_name = 'secret_id'),
	0,
	'15 — REFUS N° 6, seconde moitié : authenticated n''a aucun privilège sur secret_id');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_outbound_identities'
	    and grantee = 'authenticated' and column_name = 'from_address'
	    and privilege_type = 'SELECT'),
	1,
	'16 — mais il lit l''adresse d''expédition : le refus vise la seule référence du secret');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_outbound_identities'
	    and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
	0,
	'17 — aucune écriture directe : le seul chemin est la fonction du §14.2');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_outbound_identities' and grantee = 'anon'),
	0,
	'18 — REFUS N° 11 : anon n''a rien du tout');

select is(
	(select relrowsecurity from pg_class where oid = 'public.mail_outbound_identities'::regclass),
	true,
	'19 — RLS est activée');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_outbound_identities' and cmd <> 'SELECT'),
	0,
	'20 — aucune politique d''écriture n''existe');

select is(
	has_function_privilege('authenticated', 'public.mail_outbound_identity_credentials(uuid)', 'execute'),
	false,
	'21 — authenticated ne peut pas exécuter la voie de sortie du secret');

select is(
	has_function_privilege('service_role', 'public.mail_outbound_identity_credentials(uuid)', 'execute'),
	true,
	'22 — service_role, lui, le peut');

select is(
	has_function_privilege('authenticated',
		'public.mail_outbound_identity_record_check(uuid, text, text)', 'execute'),
	false,
	'23 — le statut est un constat du serveur : authenticated ne l''écrit pas');

-- =============================================================================================
-- 4. Le comportement, avec les rôles réels
-- =============================================================================================

create temporary table pg_temp_identites (nom text primary key, id uuid);
grant all on pg_temp_identites to authenticated, service_role;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

select lives_ok(
	$$ insert into pg_temp_identites
	   select 'service', public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Identité de service', 'stalwart', 587,
	     'none', 'systeme@crm.p2enjoy.test', 'systeme@crm.p2enjoy.test', 'motdepasse-sonde') $$,
	'24 — l''administratrice configure l''identité de service');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012'::uuid);

select lives_ok(
	$$ insert into pg_temp_identites
	   select 'driss1', public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Envoi de Driss', 'stalwart', 587, 'none',
	     'bizdev@p2enjoy.test', 'contact@p2enjoy.test', 'motdepasse-sonde',
	     '5eed0000-0000-4000-8000-000000000012'::uuid) $$,
	'25 — un membre configure la sienne, et son adresse d''expédition DIFFÈRE de sa boîte (§2.2)');

select lives_ok(
	$$ insert into pg_temp_identites
	   select 'driss2', public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Second envoi', 'stalwart', 587, 'none',
	     'bizdev@p2enjoy.test', 'autre@p2enjoy.test', 'motdepasse-sonde',
	     '5eed0000-0000-4000-8000-000000000012'::uuid) $$,
	'26 — il en déclare une seconde, et le défaut se DÉPLACE au lieu de se disputer');

select pg_temp.redevenir_proprietaire();

select is(
	(select count(*)::int from public.mail_outbound_identities
	  where owner_id = '5eed0000-0000-4000-8000-000000000012' and is_default),
	1,
	'27 — une seule identité par défaut pour cette personne, et pas zéro');

select is(
	(select from_address from public.mail_outbound_identities
	  where owner_id = '5eed0000-0000-4000-8000-000000000012' and is_default),
	'autre@p2enjoy.test',
	'28 — et c''est la DERNIÈRE déclarée : le défaut suit le geste');

select is(
	(select count(*)::int from public.mail_outbound_identities
	  where owner_id is null and is_default),
	1,
	'29 — l''identité de service porte son propre défaut, indépendamment des personnes');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012'::uuid);

select throws_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Vol', 'stalwart', 587, 'none',
	     'u@p2enjoy.test', 'vol@p2enjoy.test', 'x') $$,
	'42501',
	'forbidden',
	'30 — il ne configure PAS l''identité de service');

select throws_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Vol', 'stalwart', 587, 'none',
	     'u@p2enjoy.test', 'vol@p2enjoy.test', 'x',
	     '5eed0000-0000-4000-8000-000000000011'::uuid) $$,
	'42501',
	'forbidden',
	'31 — ni celle d''un collègue');

-- REFUS N° 7, seconde moitié : ce que chacun LIT.
select is(
	(select count(*)::int from public.mail_outbound_identities),
	2,
	'32 — REFUS N° 7 : il ne voit QUE ses deux identités, jamais celle de service');

select throws_ok(
	$$ select secret_id from public.mail_outbound_identities $$,
	'42501',
	null,
	'33 — REFUS N° 6, sur des lignes qu''il lit par ailleurs : secret_id est fermée');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

select is(
	(select count(*)::int from public.mail_outbound_identities),
	3,
	'34 — l''administratrice voit les trois');

select is(
	(select count(*)::int from public.mail_outbound_identities
	  where owner_id = '5eed0000-0000-4000-8000-000000000011'),
	0,
	'35 — et elle n''en a AUCUNE à elle : lire n''est pas posséder');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012'::uuid);

select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Envoi de Driss', 'stalwart', 587, 'none',
	     'bizdev@p2enjoy.test', 'contact@p2enjoy.test', null,
	     '5eed0000-0000-4000-8000-000000000012'::uuid) $$,
	'36 — le rejeu SANS mot de passe est accepté et ne perd pas le secret');

select pg_temp.redevenir_proprietaire();
set local role service_role;

select is(
	(select password from public.mail_outbound_identity_credentials(
		(select id from pg_temp_identites where nom = 'driss1'))),
	'motdepasse-sonde',
	'37 — service_role obtient le mot de passe en clair : Vault a fait l''aller-retour');

select lives_ok(
	$$ select public.mail_outbound_identity_record_check(
	     (select id from pg_temp_identites where nom = 'driss1'), 'error', 'auth_failed') $$,
	'38 — le verdict d''un test SMTP s''écrit par la fonction réservée');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

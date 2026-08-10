-- @verifies CRM-052 (docs/BACKLOG.md) — comptes entrants IMAP
-- @verifies docs/SPEC-mail-subsystem.md §13.2 (modèle), §13.3 (chemin d'écriture unique),
--           §13.4 (qui lit quoi), §13.5 (la seule voie de sortie d'un secret),
--           §13.7 (last_error est un code)
-- @verifies docs/SCHEMA.md §12 (`mail_inbound_accounts`)
-- @verifies docs/SPEC-permissions-rls.md §7, preuves de refus n° 6, n° 7 et n° 11
-- @verifies docs/JOURNAL.md décision 316
--
-- CE QUE CETTE SUITE ÉPROUVE, ET CE QU'ELLE NE PEUT PAS ÉPROUVER.
--
-- Elle éprouve la BASE : structure, contraintes, unicités partielles, politiques, privilèges de
-- colonne, et le comportement des trois fonctions avec les rôles réels. Elle n'ouvre aucune
-- session IMAP — c'est l'affaire de `e2e/mail/mail-inbound.spec.ts`, qui parle au vrai serveur.

begin;

create extension if not exists pgtap with schema extensions;

select plan(60);

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

-- Comptes du seed socle, employés tels quels : une suite qui fabriquerait ses propres membres
-- éprouverait un workspace qui n'existe nulle part ailleurs.
create or replace function pg_temp.ws() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.camille() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.farida() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- LES COMPTES DU SEED SONT RETIRÉS **DANS LA TRANSACTION**, et le `rollback` final les rend.
--
-- Sans cela, cette suite serait verte sur une base fraîche et rouge après `apply-seed.sh` : les
-- unicités partielles du §13.2 sont précisément faites pour refuser une seconde boîte système ou
-- une seconde boîte personnelle, et le seed en pose déjà trois. Une suite dont le verdict dépend
-- de l'ordre des commandes n'éprouve pas le produit, elle éprouve l'état de la machine.
--
-- Ce retrait n'est PAS un contournement de la règle : il la reconnaît. Les scénarios de la
-- section 5 recréent leurs comptes par le véritable chemin d'écriture, et la présence des trois
-- comptes seedés est éprouvée ailleurs — par `scripts/verify-mail-inbound.sh`, qui les compte sur
-- la base réelle.
delete from public.mail_inbound_accounts;

-- =============================================================================================
-- 1. La table existe, et elle porte ce que le §13.2 annonce
-- =============================================================================================

select has_table('public', 'mail_inbound_accounts',
	'1 — la table des comptes entrants existe');

select has_column('public', 'mail_inbound_accounts', 'last_checked_at',
	'2 — last_checked_at existe : « connexion éprouvée » n''est pas « messages lus »');

select has_column('public', 'mail_inbound_accounts', 'secret_id',
	'3 — la référence Vault est portée par la table, jamais le mot de passe');

select hasnt_column('public', 'mail_inbound_accounts', 'password',
	'4 — aucune colonne de mot de passe : le secret vit dans Vault');

select col_is_null('public', 'mail_inbound_accounts', 'owner_id',
	'5 — owner_id est nullable : nul = boîte système du workspace');

select col_not_null('public', 'mail_inbound_accounts', 'workspace_id',
	'6 — un compte appartient toujours à un workspace');

select is(
	(select count(*)::int from pg_indexes
	  where schemaname = 'public'
	    and tablename = 'mail_inbound_accounts'
	    and indexdef ilike '%unique%'
	    and indexdef ilike '%where%'),
	2,
	'7 — DEUX index uniques partiels : un catch-all par workspace, une boîte par personne');

select is(
	(select count(*)::int from pg_indexes
	  where schemaname = 'public' and tablename = 'mail_inbound_accounts'
	    and indexname = 'mail_inbound_accounts_systeme_unique'),
	1,
	'8 — l''unicité de la boîte système est nommée et existe');

select is(
	(select count(*)::int from pg_indexes
	  where schemaname = 'public' and tablename = 'mail_inbound_accounts'
	    and indexname = 'mail_inbound_accounts_personnelle_unique'),
	1,
	'9 — l''unicité de la boîte personnelle est nommée et existe');

select has_trigger('public', 'mail_inbound_accounts', 'mail_inbound_accounts_updated_at',
	'10 — updated_at est tenu par un trigger, pas par le client');

select has_trigger('public', 'mail_inbound_accounts', 'mail_inbound_accounts_proprietaire',
	'11 — le propriétaire d''une boîte personnelle est vérifié par un trigger');

-- =============================================================================================
-- 2. Les contraintes mordent
-- =============================================================================================

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 143, 'imaps', 'u') $$,
	'23514',
	null,
	'12 — un mode de sécurité inconnu est refusé : ssl, starttls ou none');

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 70000, 'none', 'u') $$,
	'23514',
	null,
	'13 — un port hors bornes est refusé');

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username, status)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 143, 'none', 'u', 'connecte') $$,
	'23514',
	null,
	'14 — un statut hors vocabulaire est refusé');

-- LE CŒUR DU §13.7 : `last_error` est un CODE. Un texte de serveur distant ne passe pas, et
-- c'est ce qui rend la règle opposable plutôt que recommandée.
select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username, last_error)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 143, 'none', 'u',
	           '[AUTHENTICATIONFAILED] Authentication failed') $$,
	'23514',
	null,
	'15 — le texte brut d''un serveur distant est REFUSÉ dans last_error');

select lives_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username, last_error)
	   values ('5eed0000-0000-4000-8000-000000000001', 'sonde-codes', 'h', 143, 'none', 'u',
	           'auth_failed') $$,
	'16 — un code du catalogue est accepté');

-- Le trigger de propriété parle AVANT la clé étrangère, et c'est tant mieux : « owner_not_member »
-- dit pourquoi le compte est refusé, là où une violation de FK ne dirait que « ce profil n'existe
-- pas ». Ce qui est mesuré ici est le refus effectif, pas celui qu'on aurait supposé.
select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, owner_id, label, imap_host,
	     imap_port, imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001',
	           '5eed0000-0000-4000-8000-0000000000ff', 'x', 'h', 143, 'none', 'u') $$,
	'23514',
	'owner_not_member',
	'17 — un propriétaire étranger au workspace est refusé, et le refus le DIT');

-- La sonde du test 16 occupe déjà l'unicité de la boîte système : sans ce retrait, le contrôle
-- suivant mesurerait un doublon au lieu de la borne qu'il vise.
select lives_ok(
	$$ delete from public.mail_inbound_accounts where label = 'sonde-codes' $$,
	'18 — la sonde de codes est retirée avant les bornes suivantes');

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username, watch_folders)
	   values ('5eed0000-0000-4000-8000-000000000001', 'x', 'h', 143, 'none', 'u',
	           array[]::text[]) $$,
	'23514',
	null,
	'19 — surveiller zéro dossier est refusé : le compte ne lirait rien');

select lives_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001', 'systeme-1', 'h', 143, 'none', 'u') $$,
	'20 — une première boîte système est acceptée');

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, label, imap_host, imap_port,
	     imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001', 'systeme-2', 'h', 143, 'none', 'u') $$,
	'23505',
	null,
	'21 — une SECONDE boîte système est refusée : deux catch-all dédoubleraient les messages');

select lives_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, owner_id, label, imap_host,
	     imap_port, imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001',
	           '5eed0000-0000-4000-8000-000000000012', 'driss-1', 'h', 143, 'none', 'u') $$,
	'22 — une première boîte personnelle est acceptée');

select throws_ok(
	$$ insert into public.mail_inbound_accounts (workspace_id, owner_id, label, imap_host,
	     imap_port, imap_security, imap_username)
	   values ('5eed0000-0000-4000-8000-000000000001',
	           '5eed0000-0000-4000-8000-000000000012', 'driss-2', 'h', 143, 'none', 'u') $$,
	'23505',
	null,
	'23 — une SECONDE boîte pour la même personne est refusée : laquelle lire ?');

select lives_ok(
	$$ delete from public.mail_inbound_accounts $$,
	'24 — les sondes d''unicité sont retirées');

-- =============================================================================================
-- 3. Les privilèges — le refus n° 6 est un privilège de COLONNE
-- =============================================================================================

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'authenticated' and column_name = 'secret_id'),
	0,
	'25 — REFUS N° 6 : authenticated n''a AUCUN privilège sur secret_id');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'authenticated' and privilege_type = 'SELECT'
	    and column_name = 'imap_username'),
	1,
	'26 — mais il lit bien les colonnes de configuration : le refus vise la seule référence');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
	0,
	'27 — AUCUNE écriture directe : le seul chemin correct est la fonction du §13.3');

select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'anon'),
	0,
	'28 — REFUS N° 11 : anon n''a rien du tout sur cette table');

select is(
	(select relrowsecurity from pg_class
	  where oid = 'public.mail_inbound_accounts'::regclass),
	true,
	'29 — RLS est activée');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_inbound_accounts'),
	2,
	'30 — deux politiques, toutes deux en lecture : rien n''ouvre l''écriture');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_inbound_accounts' and cmd <> 'SELECT'),
	0,
	'31 — aucune politique d''écriture n''existe');

-- =============================================================================================
-- 4. Les trois fonctions et leurs droits (§13.3, §13.5)
-- =============================================================================================

select has_function('public', 'upsert_mail_inbound_account',
	'32 — le chemin d''écriture existe');

select has_function('public', 'mail_inbound_account_credentials', array['uuid'],
	'33 — la voie de sortie du secret existe');

select has_function('public', 'mail_inbound_account_record_check', array['uuid', 'text', 'text'],
	'34 — l''écriture du verdict existe');

select is(
	(select p.prosecdef from pg_proc p
	  where p.pronamespace = 'public'::regnamespace
	    and p.proname = 'upsert_mail_inbound_account'),
	true,
	'35 — le chemin d''écriture est SECURITY DEFINER : Vault est hors de portée du client');

select is(
	(select p.prosecdef from pg_proc p
	  where p.pronamespace = 'public'::regnamespace
	    and p.proname = 'mail_inbound_account_credentials'),
	true,
	'36 — la voie de sortie est SECURITY DEFINER');

select is(
	has_function_privilege('authenticated', 'public.mail_inbound_account_credentials(uuid)', 'execute'),
	false,
	'37 — authenticated ne peut PAS exécuter la voie de sortie du secret');

select is(
	has_function_privilege('anon', 'public.mail_inbound_account_credentials(uuid)', 'execute'),
	false,
	'38 — anon non plus');

select is(
	has_function_privilege('service_role', 'public.mail_inbound_account_credentials(uuid)', 'execute'),
	true,
	'39 — service_role, lui, le peut : c''est la SEULE voie de sortie d''un mot de passe');

select is(
	has_function_privilege('authenticated', 'public.mail_inbound_account_record_check(uuid, text, text)', 'execute'),
	false,
	'40 — le statut est un constat du serveur : authenticated ne l''écrit pas');

select is(
	has_function_privilege('authenticated',
		'public.upsert_mail_inbound_account(uuid, text, text, integer, text, text, text, uuid, text[], text, integer)',
		'execute'),
	true,
	'41 — le chemin d''écriture, lui, est ouvert à un membre connecté');

-- =============================================================================================
-- 5. Le comportement, avec les rôles réels
-- =============================================================================================

create temporary table pg_temp_comptes (nom text primary key, id uuid);
grant all on pg_temp_comptes to authenticated, service_role;

select pg_temp.endosser(pg_temp.camille());

select lives_ok(
	$$ insert into pg_temp_comptes
	   select 'systeme', public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Boîte système', 'stalwart', 143, 'none',
	     'systeme@crm.p2enjoy.test', 'motdepasse-sonde', null) $$,
	'42 — l''administratrice configure la boîte système');

select lives_ok(
	$$ insert into pg_temp_comptes
	   select 'camille', public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Boîte de Camille', 'stalwart', 143, 'none',
	     'admin@p2enjoy.test', 'motdepasse-sonde',
	     '5eed0000-0000-4000-8000-000000000011'::uuid) $$,
	'43 — et sa propre boîte personnelle');

select pg_temp.endosser(pg_temp.driss());

select lives_ok(
	$$ insert into pg_temp_comptes
	   select 'driss', public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Boîte de Driss', 'stalwart', 143, 'none',
	     'bizdev@p2enjoy.test', 'motdepasse-sonde',
	     '5eed0000-0000-4000-8000-000000000012'::uuid) $$,
	'44 — un membre non administrateur configure LA SIENNE');

select throws_ok(
	$$ select public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Vol', 'stalwart', 143, 'none',
	     'systeme@crm.p2enjoy.test', 'x', null) $$,
	'42501',
	'forbidden',
	'45 — il ne configure PAS la boîte système : c''est un objet d''exploitation');

select throws_ok(
	$$ select public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Vol', 'stalwart', 143, 'none',
	     'admin@p2enjoy.test', 'x', '5eed0000-0000-4000-8000-000000000011'::uuid) $$,
	'42501',
	'forbidden',
	'46 — ni celle d''un collègue');

-- REFUS N° 7, sur des lignes réelles : ce que chacun LIT.
select is(
	(select count(*)::int from public.mail_inbound_accounts),
	1,
	'47 — REFUS N° 7 : Driss ne voit QUE sa boîte, ni la système, ni celle de Camille');

select is(
	(select label from public.mail_inbound_accounts),
	'Boîte de Driss',
	'48 — et la ligne qu''il voit est bien la sienne');

select throws_ok(
	$$ select secret_id from public.mail_inbound_accounts $$,
	'42501',
	null,
	'49 — REFUS N° 6, mesuré sur une ligne qu''il lit par ailleurs : secret_id est fermée');

select pg_temp.endosser(pg_temp.camille());

select is(
	(select count(*)::int from public.mail_inbound_accounts),
	3,
	'50 — l''administratrice voit les trois : la système et les deux personnelles');

select pg_temp.endosser(pg_temp.farida());

select is(
	(select count(*)::int from public.mail_inbound_accounts),
	0,
	'51 — un membre sans boîte ne voit RIEN, et ce n''est pas une erreur');

-- Un rejeu du même geste ne duplique pas, et ne perd pas le secret : c'est le contrat de
-- convergence du seed (§13.8).
select pg_temp.endosser(pg_temp.driss());

select lives_ok(
	$$ select public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Boîte de Driss', 'stalwart', 143, 'none',
	     'bizdev@p2enjoy.test', null, '5eed0000-0000-4000-8000-000000000012'::uuid) $$,
	'52 — le rejeu SANS mot de passe est accepté');

select pg_temp.redevenir_proprietaire();

select is(
	(select count(*)::int from public.mail_inbound_accounts),
	3,
	'53 — le rejeu n''a rien dupliqué');

select isnt(
	(select secret_id from public.mail_inbound_accounts
	  where owner_id = '5eed0000-0000-4000-8000-000000000012'),
	null,
	'54 — et il n''a PAS effacé le secret : « remplacer le mot de passe » n''est pas obligatoire');

-- La voie de sortie rend bien le secret déchiffré, et à service_role seul.
set local role service_role;

select is(
	(select password from public.mail_inbound_account_credentials(
		(select id from pg_temp_comptes where nom = 'driss'))),
	'motdepasse-sonde',
	'55 — service_role obtient le mot de passe EN CLAIR : Vault a fait l''aller-retour');

select is(
	(select imap_username from public.mail_inbound_account_credentials(
		(select id from pg_temp_comptes where nom = 'driss'))),
	'bizdev@p2enjoy.test',
	'56 — avec les paramètres de connexion qui vont avec');

select lives_ok(
	$$ select public.mail_inbound_account_record_check(
	     (select id from pg_temp_comptes where nom = 'driss'), 'error', 'auth_failed') $$,
	'57 — le verdict d''un test de connexion s''écrit par la fonction réservée');

select pg_temp.redevenir_proprietaire();

select results_eq(
	$$ select status, last_error from public.mail_inbound_accounts
	    where owner_id = '5eed0000-0000-4000-8000-000000000012' $$,
	$$ values ('error'::text, 'auth_failed'::text) $$,
	'58 — et l''état relu porte le code, jamais une phrase');

-- =============================================================================================
-- 6. Un compte supprimé puis recréé — le secret orphelin est REPRIS, pas dupliqué
-- =============================================================================================
--
-- `vault.secrets.name` est UNIQUE (`secrets_name_idx`, mesuré). Supprimer un compte laisse donc
-- derrière lui un secret que plus rien ne référence, et recréer la même boîte échouait sur un
-- `23505` incompréhensible pour l'exploitant. Défaut trouvé par cette suite, pas à la lecture.

select lives_ok(
	$$ delete from public.mail_inbound_accounts where owner_id is null $$,
	'59 — la boîte système est supprimée, son secret Vault restant orphelin');

select pg_temp.endosser(pg_temp.camille());

select lives_ok(
	$$ select public.upsert_mail_inbound_account(
	     '5eed0000-0000-4000-8000-000000000001'::uuid, 'Boîte système', 'stalwart', 143, 'none',
	     'systeme@crm.p2enjoy.test', 'motdepasse-sonde', null) $$,
	'60 — et elle se recrée : le secret orphelin est repris, jamais dupliqué');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

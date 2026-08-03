-- @verifies CRM-003 (docs/BACKLOG.md) — migrations d'amorçage : identité et cloisonnement
-- @verifies docs/SCHEMA.md §1 (identité et cloisonnement), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §2 (rôles), §4 (politiques), §7 (preuves de refus)
--
-- Suite pgTAP de l'unité `CRM-003`. Elle prouve trois choses :
--
--   1. la structure réellement créée est conforme à `docs/SCHEMA.md` §1 ;
--   2. le trigger de création de profil se comporte comme spécifié, y compris sur ses cas
--      limites — métadonnée absente, email absent, profil déjà présent, compte supprimé ;
--   3. les tables sont en refus par défaut : RLS activée, aucune politique, et les privilèges
--      posés sont exactement ceux voulus.
--
-- Exécution : `scripts/verify-migrations.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0001_identite_et_cloisonnement.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes de test ne subsistent dans la base. `pgtap` n'est donc **jamais** installée
-- durablement, et surtout pas en production.

begin;

create extension if not exists pgtap with schema extensions;

select plan(70);

-- =============================================================================================
-- 1. Structure — docs/SCHEMA.md §1
-- =============================================================================================

select has_schema('app', 'le schéma `app` existe');

select has_table('public', 'profiles',          'table `profiles`');
select has_table('public', 'workspaces',        'table `workspaces`');
select has_table('public', 'workspace_members', 'table `workspace_members`');
select has_table('public', 'track_members',     'table `track_members`');
select has_table('public', 'channel_members',   'table `channel_members`');

select columns_are(
	'public', 'profiles',
	array['id', 'full_name', 'avatar_url', 'locale', 'created_at', 'updated_at'],
	'`profiles` porte exactement les colonnes de docs/SCHEMA.md §1'
);

select columns_are(
	'public', 'workspaces',
	array['id', 'name', 'slug', 'inbound_domain', 'settings', 'created_at', 'updated_at'],
	'`workspaces` porte exactement les colonnes de docs/SCHEMA.md §1'
);

select columns_are(
	'public', 'workspace_members',
	array['workspace_id', 'user_id', 'role', 'created_at'],
	'`workspace_members` porte exactement les colonnes de docs/SCHEMA.md §1'
);

select col_is_pk('public', 'profiles', 'id', '`profiles.id` est la clé primaire');
select col_is_pk('public', 'workspace_members', array['workspace_id', 'user_id'],
	'clé primaire composite de `workspace_members`');
select col_is_pk('public', 'track_members', array['track_id', 'user_id'],
	'clé primaire composite de `track_members`');
select col_is_pk('public', 'channel_members', array['channel_id', 'user_id'],
	'clé primaire composite de `channel_members`');

select col_not_null('public', 'profiles', 'full_name', '`profiles.full_name` est non nul');
select col_default_is('public', 'profiles', 'locale', 'fr', 'la langue par défaut est « fr »');
select col_type_is('public', 'workspaces', 'settings', 'jsonb', '`workspaces.settings` est jsonb');
select col_is_unique('public', 'workspaces', 'slug', '`workspaces.slug` est unique');

-- Le prolongement de `auth.users` est une clé étrangère réelle, pas une convention de nommage.
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id',
	'`profiles.id` référence `auth.users.id`');

-- La cascade n'est pas un détail d'écriture : sans elle, la suppression d'un compte échouerait
-- et laisserait un profil orphelin (docs/SCHEMA.md §1, « ON DELETE CASCADE »).
select is(
	(select confdeltype::text from pg_constraint
	  where conrelid = 'public.profiles'::regclass and contype = 'f'),
	'c',
	'la suppression d''un compte supprime le profil en cascade'
);
select fk_ok('public', 'workspace_members', 'workspace_id', 'public', 'workspaces', 'id',
	'`workspace_members.workspace_id` référence `workspaces.id`');
select fk_ok('public', 'workspace_members', 'user_id', 'public', 'profiles', 'id',
	'`workspace_members.user_id` référence `profiles.id`');

-- INC-010 : la clé étrangère vers `tracks` / `channels` est différée, faute de tables à
-- référencer. Le test **constate** cet état plutôt que de le taire, afin qu'il devienne rouge le
-- jour où `CRM-020` la posera sans mettre à jour cette suite.
select is_empty(
	$$ select conname from pg_constraint
	    where conrelid = 'public.track_members'::regclass and contype = 'f'
	      and conname like '%track_id%' $$,
	'INC-010 : `track_members.track_id` n''a pas encore de clé étrangère (CRM-020)'
);

select has_index('public', 'workspace_members', 'workspace_members_user_id_idx',
	'index inverse sur `workspace_members.user_id`');
select has_index('public', 'track_members', 'track_members_user_id_idx',
	'index inverse sur `track_members.user_id`');
select has_index('public', 'channel_members', 'channel_members_user_id_idx',
	'index inverse sur `channel_members.user_id`');

-- =============================================================================================
-- 2. Fonctions et triggers
-- =============================================================================================

select has_function('app', 'handle_new_user', 'la fonction `app.handle_new_user` existe');
select has_function('app', 'set_updated_at',  'la fonction `app.set_updated_at` existe');

select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'handle_new_user'),
	true,
	'`app.handle_new_user` est SECURITY DEFINER'
);

select is(
	(select pg_get_userbyid(proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'handle_new_user'),
	'postgres',
	'`app.handle_new_user` appartient à `postgres`, propriétaire de `public.profiles`'
);

-- `search_path` explicite sur toute fonction du schéma : exigé par docs/SCHEMA.md §9.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
	                     where c like 'search\_path=%')),
	0,
	'toutes les fonctions du schéma `app` fixent `search_path`'
);

select has_trigger('auth', 'users', 'on_auth_user_created',
	'le trigger de création de profil est posé sur `auth.users`');
select has_trigger('public', 'profiles', 'profiles_set_updated_at',
	'`profiles` maintient `updated_at`');
select has_trigger('public', 'workspaces', 'workspaces_set_updated_at',
	'`workspaces` maintient `updated_at`');

-- =============================================================================================
-- 3. Comportement du trigger de création de profil
-- =============================================================================================
-- Les comptes sont insérés directement dans `auth.users`, ce qui est exactement ce que fait
-- GoTrue. La preuve par le **véritable** chemin applicatif — API d'administration GoTrue — est
-- rejouée hors interface par `scripts/verify-migrations.sh`, comme l'exige `CLAUDE.md` §8.

-- 3.1 Métadonnée `full_name` fournie
insert into auth.users (id, email, raw_user_meta_data)
values (
	'00000000-0000-4000-8000-000000000001',
	'alice@exemple.test',
	'{"full_name": "Alice Martin", "locale": "en", "avatar_url": "https://exemple.test/a.png"}'
);

select results_eq(
	$$ select full_name, locale, avatar_url from public.profiles
	    where id = '00000000-0000-4000-8000-000000000001' $$,
	$$ values ('Alice Martin', 'en', 'https://exemple.test/a.png') $$,
	'le profil reprend `full_name`, `locale` et `avatar_url` des métadonnées'
);

-- 3.2 Métadonnée `name` seule (forme émise par plusieurs fournisseurs OAuth)
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000002', 'bob@exemple.test', '{"name": "Bob Durand"}');

select is(
	(select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
	'Bob Durand',
	'à défaut de `full_name`, la métadonnée `name` est retenue'
);

select is(
	(select locale from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
	'fr',
	'sans métadonnée `locale`, la langue par défaut est « fr »'
);

-- 3.3 Aucune métadonnée : repli sur la partie locale de l'email
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000003', 'carole.dupont@exemple.test');

select is(
	(select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000003'),
	'carole.dupont',
	'sans métadonnée, le nom affiché est la partie locale de l''email'
);

-- 3.4 Ni métadonnée ni email : repli terminal. Sans lui, la contrainte `NOT NULL` ferait échouer
--     la création du compte lui-même, ce qui serait un défaut bien plus grave qu'un nom fade.
insert into auth.users (id, phone)
values ('00000000-0000-4000-8000-000000000004', '+33600000004');

select is(
	(select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000004'),
	'Utilisateur 00000000',
	'sans email ni métadonnée, le nom affiché dérive de l''identifiant'
);

select is(
	(select count(*)::int from public.profiles),
	4,
	'quatre comptes créés, quatre profils'
);

-- 3.5 `updated_at` est maintenu par trigger, pas par le client
update public.profiles
   set full_name = 'Alice Martin-Durand', updated_at = '2000-01-01T00:00:00Z'
 where id = '00000000-0000-4000-8000-000000000001';

select ok(
	(select updated_at from public.profiles where id = '00000000-0000-4000-8000-000000000001')
		> now() - interval '1 minute',
	'`updated_at` est réécrit par le trigger, même si le client tente de le forcer'
);

-- 3.6 Profil déjà présent : le trigger ne l'écrase pas.
--     Un second `INSERT` sur le même identifiant est impossible — c'est une clé primaire. On
--     rejoue donc la **même fonction** sur la même ligne au moyen d'un trigger de test posé sur
--     `UPDATE`, puis on vérifie que la valeur éditée par l'utilisateur a survécu.
create trigger tst_rejoue_handle_new_user
	after update on auth.users
	for each row execute function app.handle_new_user();

update auth.users set updated_at = now() where id = '00000000-0000-4000-8000-000000000001';

select is(
	(select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
	'Alice Martin-Durand',
	'rejoué sur un profil existant, le trigger ne réécrit rien (`on conflict do nothing`)'
);

drop trigger tst_rejoue_handle_new_user on auth.users;

-- 3.7 Suppression du compte : le profil suit
delete from auth.users where id = '00000000-0000-4000-8000-000000000004';

select is_empty(
	$$ select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000004' $$,
	'la suppression du compte supprime le profil (cascade)'
);

-- =============================================================================================
-- 4. Contraintes d'intégrité
-- =============================================================================================

insert into public.workspaces (id, name, slug)
values ('00000000-0000-4000-8000-0000000000a1', 'P2Enjoy', 'p2enjoy');

select throws_ok(
	$$ insert into public.workspaces (name, slug) values ('Doublon', 'p2enjoy') $$,
	'23505',
	null,
	'deux workspaces ne peuvent pas partager le même `slug`'
);

select lives_ok(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('00000000-0000-4000-8000-0000000000a1',
	           '00000000-0000-4000-8000-000000000001', 'admin') $$,
	'un rôle déclaré est accepté'
);

select throws_ok(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('00000000-0000-4000-8000-0000000000a1',
	           '00000000-0000-4000-8000-000000000002', 'superadmin') $$,
	'23514',
	null,
	'un rôle hors de la liste des trois rôles est refusé'
);

select throws_ok(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('00000000-0000-4000-8000-0000000000a1',
	           '00000000-0000-4000-8000-00000000dead', 'viewer') $$,
	'23503',
	null,
	'un membre doit correspondre à un profil existant'
);

select throws_ok(
	$$ insert into public.track_members (track_id, user_id, access)
	   values ('00000000-0000-4000-8000-0000000000b1',
	           '00000000-0000-4000-8000-000000000001', 'owner') $$,
	'23514',
	null,
	'`track_members.access` n''accepte que member, viewer ou none'
);

select lives_ok(
	$$ insert into public.channel_members (channel_id, user_id, access)
	   values ('00000000-0000-4000-8000-0000000000c1',
	           '00000000-0000-4000-8000-000000000001', 'none') $$,
	'un droit fin `none` est un enregistrement valide, pas une absence de ligne'
);

-- La suppression d'un workspace emporte ses membres : aucun droit ne survit à son objet.
delete from public.workspaces where id = '00000000-0000-4000-8000-0000000000a1';

select is_empty(
	$$ select 1 from public.workspace_members
	    where workspace_id = '00000000-0000-4000-8000-0000000000a1' $$,
	'la suppression d''un workspace supprime ses membres (cascade)'
);

-- =============================================================================================
-- 5. Refus par défaut — docs/SPEC-permissions-rls.md §4, §7
-- =============================================================================================
-- RLS activée sans aucune politique : toute lecture par `anon` ou `authenticated` retourne zéro
-- ligne, toute écriture est refusée. `CRM-010` a livré les **fonctions** d'autorisation sans poser
-- la moindre politique ; celles-ci restent donc attendues, sans qu'aucune unité ne les porte
-- nommément pour les trois tables d'identité — `docs/INCONSISTENCY_REPORT.md`, INC-014. Cette
-- suite deviendra rouge si elles sont ajoutées sans qu'elle soit mise à jour, ce qui est l'effet
-- recherché.

select is(
	(select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public'
	    and c.relname in ('profiles', 'workspaces', 'workspace_members',
	                      'track_members', 'channel_members')),
	true,
	'RLS est activée sur les cinq tables'
);

select is(
	(select bool_or(relforcerowsecurity) from pg_class c
	   join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public'
	    and c.relname in ('profiles', 'workspaces', 'workspace_members',
	                      'track_members', 'channel_members')),
	false,
	'RLS n''est pas forcée : le trigger de création de profil doit rester opérant'
);

select policies_are('public', 'profiles',          array[]::text[],
	'`profiles` n''a aucune politique : refus par défaut, INC-014');
select policies_are('public', 'workspaces',        array[]::text[],
	'`workspaces` n''a aucune politique : refus par défaut, INC-014');
select policies_are('public', 'workspace_members', array[]::text[],
	'`workspace_members` n''a aucune politique : refus par défaut, INC-014');
select policies_are('public', 'track_members',     array[]::text[],
	'`track_members` n''a aucune politique : refus par défaut jusqu''à CRM-012');
select policies_are('public', 'channel_members',   array[]::text[],
	'`channel_members` n''a aucune politique : refus par défaut jusqu''à CRM-012');

-- Un refus de lecture doit se manifester par zéro ligne, jamais par une erreur de privilège :
-- `SELECT` est donc bien accordé, et c'est RLS qui filtre.
select ok(has_table_privilege('anon', 'public.profiles', 'SELECT'),
	'`anon` détient SELECT sur `profiles` : le refus vient de RLS, pas d''un privilège manquant');
select ok(has_table_privilege('anon', 'public.workspaces', 'SELECT'),
	'`anon` détient SELECT sur `workspaces`');
select ok(has_table_privilege('anon', 'public.workspace_members', 'SELECT'),
	'`anon` détient SELECT sur `workspace_members`');
select ok(has_table_privilege('anon', 'public.track_members', 'SELECT'),
	'`anon` détient SELECT sur `track_members`');
select ok(has_table_privilege('anon', 'public.channel_members', 'SELECT'),
	'`anon` détient SELECT sur `channel_members`');

-- En revanche, aucun client ne crée ni ne supprime un profil : c'est le trigger et la cascade.
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
	'`authenticated` ne peut pas insérer un profil : c''est le rôle du trigger');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
	'`authenticated` ne peut pas supprimer un profil : c''est la cascade depuis `auth.users`');
select ok(not has_table_privilege('anon', 'public.profiles', 'INSERT'),
	'`anon` ne peut pas insérer un profil');
select ok(has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
	'`authenticated` peut modifier un profil, sous réserve des politiques à venir');

select ok(not has_table_privilege('anon', 'public.workspaces', 'INSERT'),
	'`anon` n''écrit dans aucune table métier');
select ok(not has_table_privilege('anon', 'public.workspace_members', 'INSERT'),
	'`anon` n''écrit pas dans `workspace_members`');

-- Le schéma `app` est utilisable. `handle_new_user` n'est exécutable par personne : elle n'est
-- appelée que par le trigger. Les fonctions d'autorisation de `CRM-010`, elles, sont explicitement
-- accordées à `anon` — voir `supabase/tests/0002_fonctions_autorisation.test.sql` §5.
select ok(has_schema_privilege('anon', 'app', 'USAGE'),
	'`anon` a USAGE sur `app` : une politique appelant une fonction `app.*` refusera par zéro '
	'ligne, non par une erreur de privilège');
select ok(has_schema_privilege('authenticated', 'app', 'USAGE'),
	'`authenticated` a USAGE sur `app`');
select ok(not has_function_privilege('authenticated', 'app.handle_new_user()', 'EXECUTE'),
	'`app.handle_new_user` n''est exécutable par personne d''autre que le trigger');

select * from finish();

rollback;

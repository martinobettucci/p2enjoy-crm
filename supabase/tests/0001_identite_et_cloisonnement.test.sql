-- @verifies CRM-003 (docs/BACKLOG.md) — migrations d'amorçage : identité et cloisonnement
-- @verifies CRM-022 (docs/BACKLOG.md) — politiques d'identité qui ferment le refus transitoire
-- @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §7.2 — `profiles.id` est le `sub`
--           du SSO et ne référence plus `auth.users` (assertions 18, 19 et 43 RÉVISÉES) ; §7.5 —
--           tranche T6 : le trigger de création de profil est retiré par `0077`, ses assertions
--           avec lui (docs/JOURNAL.md décision 589)
-- @verifies docs/SCHEMA.md §1 (identité et cloisonnement), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §2 (rôles), §4 (politiques), §7 (preuves de refus)
--
-- Suite pgTAP de l'unité `CRM-003`. Elle prouve trois choses :
--
--   1. la structure réellement créée est conforme à `docs/SCHEMA.md` §1 ;
--   2. le trigger de création de profil n'existe plus (`CRM-092` T6) : un profil naît de la
--      première connexion LeLabs admise, jamais d'une ligne `auth.users` ;
--   3. la RLS reste activée et porte désormais les politiques exactes de `CRM-022`, tandis que
--      les privilèges minimaux empêchent une colonne protégée de reposer sur la seule politique.
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

select plan(62);

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

-- RÉVISÉES par `CRM-092` (docs/SPEC-session-sso.md §7.2, décision 578) : `profiles.id` était le
-- prolongement de `auth.users` ; il est désormais le `sub` du SSO, qui n'a aucune ligne dans
-- `auth.users`. La clé est retirée par la migration 0075, et ces deux assertions prouvent son
-- ABSENCE au lieu de sa présence — elles ne sont pas retirées (décision 51).
select is(
	(select count(*)::integer from pg_constraint
	  where conrelid = 'public.profiles'::regclass and contype = 'f'
	    and confrelid = 'auth.users'::regclass),
	0,
	'`profiles.id` ne référence plus `auth.users.id` : c''est le `sub` du SSO (CRM-092)');

select is(
	(select count(*)::integer from pg_constraint
	  where conrelid = 'public.profiles'::regclass and contype = 'f'),
	0,
	'`profiles` ne porte aucune clé étrangère : aucune suppression ailleurs ne l''emporte (CRM-092)'
);
select fk_ok('public', 'workspace_members', 'workspace_id', 'public', 'workspaces', 'id',
	'`workspace_members.workspace_id` référence `workspaces.id`');
select fk_ok('public', 'workspace_members', 'user_id', 'public', 'profiles', 'id',
	'`workspace_members.user_id` référence `profiles.id`');

-- INC-010, MOITIÉ CLOSE PAR `CRM-020`. Cette suite affirmait l'absence de clé étrangère vers
-- `tracks`, faute de table à référencer, « afin qu'elle devienne rouge le jour où `CRM-020` la
-- posera sans mettre à jour cette suite ». Ce jour est venu : l'assertion a **réellement échoué**
-- lors de la livraison de `CRM-020`, et elle est révisée ici — c'est le mécanisme de la
-- décision 51, qui fonctionne comme prévu, et non un ajustement de confort.
select fk_ok('public', 'track_members', 'track_id', 'public', 'tracks', 'id',
	'INC-010 : `track_members.track_id` référence `tracks.id` depuis CRM-020');

-- INC-010, SECONDE MOITIÉ CLOSE PAR `CRM-021`. Cette suite affirmait ici l'absence de clé
-- étrangère vers `channels`, « afin qu'elle devienne rouge le jour où `CRM-021` la posera ». Ce
-- jour est venu : l'assertion a **réellement échoué** lors de la livraison de `CRM-021`, et elle
-- est révisée ici. Les deux moitiés d'INC-010 sont désormais techniquement closes.
select fk_ok('public', 'channel_members', 'channel_id', 'public', 'channels', 'id',
	'INC-010 : `channel_members.channel_id` référence `channels.id` depuis CRM-021');

select has_index('public', 'workspace_members', 'workspace_members_user_id_idx',
	'index inverse sur `workspace_members.user_id`');
select has_index('public', 'track_members', 'track_members_user_id_idx',
	'index inverse sur `track_members.user_id`');
select has_index('public', 'channel_members', 'channel_members_user_id_idx',
	'index inverse sur `channel_members.user_id`');

-- =============================================================================================
-- 2. Fonctions et triggers
-- =============================================================================================

-- RÉVISÉE par `CRM-092` T6 (docs/SPEC-session-sso.md §7.5) : `0077` retire la fonction, et
-- l'assertion prouve son ABSENCE. Les deux qui la suivaient — `SECURITY DEFINER`, propriétaire
-- `postgres` — sont RETIRÉES avec leur objet : une fonction absente n'a ni l'un ni l'autre
-- (docs/JOURNAL.md décision 589 ; l'absence est aussi prouvée par `0071_retrait_gotrue.test.sql`).
select hasnt_function('app', 'handle_new_user',
	'la fonction `app.handle_new_user` n''existe plus : aucun compte GoTrue ne crée de profil (CRM-092)');
select has_function('app', 'set_updated_at',  'la fonction `app.set_updated_at` existe');

-- `search_path` explicite sur toute fonction du schéma : exigé par docs/SCHEMA.md §9.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
	                     where c like 'search\_path=%')),
	0,
	'toutes les fonctions du schéma `app` fixent `search_path`'
);

-- RÉVISÉE par `CRM-092` T6 : l'assertion prouve l'ABSENCE du trigger retiré par `0077`.
select hasnt_trigger('auth', 'users', 'on_auth_user_created',
	'aucun trigger de création de profil sur `auth.users` : plus rien n''y écrit (CRM-092)');
select has_trigger('public', 'profiles', 'profiles_set_updated_at',
	'`profiles` maintient `updated_at`');
select has_trigger('public', 'workspaces', 'workspaces_set_updated_at',
	'`workspaces` maintient `updated_at`');

-- =============================================================================================
-- 3. Profils de la suite, et `updated_at`
-- =============================================================================================
-- RÉVISÉE par `CRM-092` T6 (docs/JOURNAL.md décision 589). Cette section éprouvait le trigger de
-- création de profil : nom tiré de `full_name`, puis de `name`, puis de l'email, puis de
-- l'identifiant ; langue et avatar des métadonnées ; profil existant intact ; compte supprimé. Le
-- trigger est retiré par `0077`, et ses SIX assertions de comportement le sont avec lui, ainsi que
-- le décompte des quatre profils qu'il créait. Ce qui les remplace : un profil naît désormais de
-- `public.ouvrir_session_sso`, dont `0069_identite_sso.test.sql` prouve la création unique, le nom
-- et l'absence de réécriture ; `0071_retrait_gotrue.test.sql` prouve qu'une ligne `auth.users` ne
-- crée plus rien. Les profils de cette suite sont donc posés directement, la clé vers `auth.users`
-- n'existant plus depuis `0075`.
insert into public.profiles (id, full_name, avatar_url, locale)
values
	('00000000-0000-4000-8000-000000000001', 'Alice Martin', 'https://exemple.test/a.png', 'en'),
	('00000000-0000-4000-8000-000000000002', 'Bob Durand', null, default);

-- 3.1 La langue par défaut s'applique à un profil posé sans langue.
select is(
	(select locale from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
	'fr',
	'sans langue fournie, la langue par défaut est « fr »'
);

-- 3.2 `updated_at` est maintenu par trigger, pas par le client
update public.profiles
   set full_name = 'Alice Martin-Durand', updated_at = '2000-01-01T00:00:00Z'
 where id = '00000000-0000-4000-8000-000000000001';

select ok(
	(select updated_at from public.profiles where id = '00000000-0000-4000-8000-000000000001')
		> now() - interval '1 minute',
	'`updated_at` est réécrit par le trigger, même si le client tente de le forcer'
);

-- =============================================================================================
-- 4. Contraintes d'intégrité
-- =============================================================================================

-- Le slug appartient à cette suite seule. « p2enjoy » a été abandonné ici : c'est celui de
-- l'espace de travail du seed socle (`docs/SPEC-seed.md` §2.1), et le réserver faisait échouer
-- la suite sur une base seedée — par une erreur d'insertion, non par une assertion, ce qui
-- interrompait tout ce qui suit (`docs/JOURNAL.md`, décision 35).
insert into public.workspaces (id, name, slug)
values ('00000000-0000-4000-8000-0000000000a1', 'Espace pgTAP CRM-003', 'pgtap-crm-003');

select throws_ok(
	$$ insert into public.workspaces (name, slug) values ('Doublon', 'pgtap-crm-003') $$,
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

-- Depuis `CRM-021`, `channel_members.channel_id` porte une clé étrangère : un droit fin ne peut
-- plus désigner un channel imaginaire. La preuve gagne au change — elle exige désormais un objet
-- réel, et elle prouve **en plus** que l'orphelin est refusé.
insert into public.tracks (id, workspace_id, name, slug, position)
values ('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a1',
        'Track pgTAP CRM-003', 'pgtap-crm-003-track', 1);
-- `CRM-033` rend `channels.workflow_id` obligatoire : la fixture doit désigner un workflow. Un
-- workflow **global** convient à tout channel de son workspace
-- (docs/SPEC-workflow-engine.md §4.12.2).
insert into public.workflows (id, workspace_id, name, scope)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
        'Workflow pgTAP CRM-003', 'global');

insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position)
values ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000f1', 'Channel pgTAP CRM-003', 'pgtap-crm-003-channel', 1);

select lives_ok(
	$$ insert into public.channel_members (channel_id, user_id, access)
	   values ('00000000-0000-4000-8000-0000000000c9',
	           '00000000-0000-4000-8000-000000000001', 'none') $$,
	'un droit fin `none` est un enregistrement valide, pas une absence de ligne'
);

select throws_ok(
	$$ insert into public.channel_members (channel_id, user_id, access)
	   values ('00000000-0000-4000-8000-0000000000ce',
	           '00000000-0000-4000-8000-000000000001', 'none') $$,
	'23503',
	null,
	'INC-010 : un droit fin ne peut plus désigner un channel inexistant (CRM-021)'
);

-- La suppression d'un workspace emporte ses membres : aucun droit ne survit à son objet.
delete from public.workspaces where id = '00000000-0000-4000-8000-0000000000a1';

select is_empty(
	$$ select 1 from public.workspace_members
	    where workspace_id = '00000000-0000-4000-8000-0000000000a1' $$,
	'la suppression d''un workspace supprime ses membres (cascade)'
);

-- =============================================================================================
-- 5. Politiques effectives — docs/SPEC-permissions-rls.md §4, §7
-- =============================================================================================
-- RÉVISÉ À `CRM-022`, non retiré : les trois tableaux vides ci-dessous sont devenus rouges à
-- l'installation des identités lisibles, exactement comme ils avaient été conçus pour le faire.
-- Ils nomment maintenant les sept politiques attendues ; en retirer ou en dupliquer une rendra
-- de nouveau cette suite du socle rouge.

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
	'RLS n''est pas forcée : l''admission `SECURITY DEFINER` doit rester opérante (CRM-092)'
);

select policies_are('public', 'profiles',
	array['profiles_lecture_equipe', 'profiles_maj_propre'],
	'`profiles` porte ses deux politiques de CRM-022');
select policies_are('public', 'workspaces',
	array['workspaces_lecture_membre'],
	'`workspaces` porte sa politique de lecture membre');
select policies_are('public', 'workspace_members',
	array['workspace_members_lecture_membre', 'workspace_members_insertion_admin',
	      'workspace_members_maj_admin', 'workspace_members_suppression_admin'],
	'`workspace_members` porte ses quatre politiques de CRM-022');
-- RÉVISÉES À `CRM-012`, non retirées : les deux tables de droits fins portent désormais leurs
-- quatre politiques (docs/SPEC-permissions-rls.md §4.1). Les deux `policies_are` vides sont
-- devenues rouges au passage de l'unité, exactement comme la décision 51 l'attendait, et sont
-- **retournées** — elles nomment maintenant les politiques attendues, de sorte qu'en retirer une
-- reste immédiatement visible depuis la suite du socle.
select policies_are('public', 'track_members',
	array['track_members_lecture', 'track_members_insertion_admin',
	      'track_members_maj_admin', 'track_members_suppression_admin'],
	'`track_members` porte les quatre politiques de CRM-012 (§4.1)');
select policies_are('public', 'channel_members',
	array['channel_members_lecture', 'channel_members_insertion_admin',
	      'channel_members_maj_admin', 'channel_members_suppression_admin'],
	'`channel_members` porte les quatre politiques de CRM-012 (§4.1)');

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

-- En revanche, aucun client ne crée ni ne supprime un profil. RÉVISÉ par `CRM-092` : le profil naît
-- de l'admission (`ouvrir_session_sso`, clé de service seule), et le retirer est un geste de service.
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
	'`authenticated` ne peut pas insérer un profil : il naît de l''admission LeLabs (CRM-092)');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
	'`authenticated` ne peut pas supprimer un profil : c''est un geste de service (CRM-092)');
select ok(not has_table_privilege('anon', 'public.profiles', 'INSERT'),
	'`anon` ne peut pas insérer un profil');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
	'`authenticated` n''a aucun UPDATE de table : seules full_name et avatar_url sont accordées');

select ok(not has_table_privilege('anon', 'public.workspaces', 'INSERT'),
	'`anon` n''écrit dans aucune table métier');
select ok(not has_table_privilege('anon', 'public.workspace_members', 'INSERT'),
	'`anon` n''écrit pas dans `workspace_members`');

-- Le schéma `app` est utilisable. Les fonctions d'autorisation de `CRM-010` sont explicitement
-- accordées à `anon` — voir `supabase/tests/0002_fonctions_autorisation.test.sql` §5.
select ok(has_schema_privilege('anon', 'app', 'USAGE'),
	'`anon` a USAGE sur `app` : une politique appelant une fonction `app.*` refusera par zéro '
	'ligne, non par une erreur de privilège');
select ok(has_schema_privilege('authenticated', 'app', 'USAGE'),
	'`authenticated` a USAGE sur `app`');
-- RETIRÉE par `CRM-092` T6 : « `app.handle_new_user` n'est exécutable par personne d'autre que le
-- trigger ». La fonction n'existe plus (`0077`) ; son absence est prouvée au §2 et par `0071`.

select * from finish();

rollback;

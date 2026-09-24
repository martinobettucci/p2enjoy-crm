-- @verifies CRM-092 (docs/BACKLOG.md) — tranche T6 : GoTrue retiré, son trigger avec lui
-- @verifies docs/SPEC-session-sso.md §2 (ce qui est retiré), §7.5 (migration `0077`), §13 (pgTAP, T6),
--           §15 (tables inertes du schéma `auth`)
-- @verifies docs/SCHEMA.md §1 (un profil naît d'un `sub` LeLabs) ; docs/JOURNAL.md décision 589
--
-- Ce que cette suite prouve, et que les assertions retirées de `0001` et `0023` ne peuvent plus dire :
-- `auth.users` n'est plus relié à rien. Aucun trigger ne s'y déclenche, la fonction qui créait les
-- profils n'existe plus, une ligne qu'on y insèrerait ne produirait aucun profil, et un profil se
-- pose sans elle. Les tables du schéma `auth` restent, inertes : leur suppression est hors de l'unité.
--
-- Tout se joue dans une transaction annulée : rien ne subsiste, ni `pgtap`, ni les lignes d'essai.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- =============================================================================================
-- 1. Ce que `0077` retire
-- =============================================================================================

select hasnt_trigger('auth', 'users', 'on_auth_user_created',
	'1 — le trigger `on_auth_user_created` n''existe plus sur `auth.users`');

select is(
	(select count(*)::int from pg_catalog.pg_trigger
	  where tgrelid = 'auth.users'::regclass and not tgisinternal),
	0,
	'2 — aucun trigger utilisateur, quel qu''il soit, ne se déclenche sur `auth.users`');

select hasnt_function('app', 'handle_new_user',
	'3 — la fonction `app.handle_new_user` n''existe plus');

select is(
	(select count(*)::int from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('app', 'public')
	    and p.prokind in ('f', 'p')
	    and pg_catalog.pg_get_functiondef(p.oid) ilike '%raw_user_meta_data%'),
	0,
	'4 — aucune fonction du produit ne lit plus les métadonnées d''un compte GoTrue');

-- =============================================================================================
-- 2. Ce qui reste, inerte — docs/SPEC-session-sso.md §2, §15
-- =============================================================================================

select has_table('auth', 'users',
	'5 — la table `auth.users` reste : la supprimer est une opération destructive distincte (§15)');

-- Une ligne insérée à la main, comme le faisait GoTrue, ne produit plus aucun profil.
insert into auth.users (id, email)
values ('0c940000-0000-4000-8000-000000000001', 'inerte-0071@exemple.test');

select is(
	(select count(*)::int from public.profiles where id = '0c940000-0000-4000-8000-000000000001'),
	0,
	'6 — une ligne `auth.users` ne crée plus de profil : plus rien n''y écrit, et rien n''en dérive');

-- =============================================================================================
-- 3. Un profil naît sans compte GoTrue
-- =============================================================================================

select lives_ok(
	$$ insert into public.profiles (id, full_name)
	   values ('0c940000-0000-4000-8000-000000000002', 'Née de LeLabs') $$,
	'7 — un profil se pose sans ligne `auth.users` : son identifiant est le `sub` LeLabs');

select is(
	(select count(*)::int from auth.users where id = '0c940000-0000-4000-8000-000000000002'),
	0,
	'8 — et aucune ligne `auth.users` n''a été créée pour lui');

select * from finish();

rollback;

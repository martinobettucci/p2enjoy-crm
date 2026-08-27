-- @verifies CRM-005 (docs/BACKLOG.md) — seed socle : contrat des données de développement
-- @verifies CRM-022 (docs/BACKLOG.md) — avatars seedés et sept politiques d'identité
-- @verifies docs/SPEC-seed.md §2 (contrat), §4 (identifiants stables), §7 (preuves n° 1 à 4)
-- @verifies docs/SCHEMA.md §1 (`profiles`, `workspaces`, `workspace_members`)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (les trois rôles de workspace)
--
-- Suite pgTAP du seed socle. Elle vérifie le contrat de `docs/SPEC-seed.md` §2 **au niveau SQL**,
-- c'est-à-dire un cran sous l'API : ni PostgREST, ni Kong, ni GoTrue n'interviennent.
--
-- Ce n'est pas une redite de `scripts/verify-seed.sh`, qui interroge l'API. Les deux vues sont
-- complémentaires et peuvent diverger : une ligne présente en base mais invisible de l'API
-- signalerait un cache de schéma périmé ou un privilège manquant, et l'inverse un défaut de
-- cloisonnement. Prouver le contrat des deux côtés est ce qui rend l'écart détectable.
--
-- PRÉREQUIS : le seed doit avoir été appliqué (`supabase/seed/apply-seed.sh`). Cette suite ne
-- l'applique pas — elle passe par la base, or le seed doit passer par les API réelles
-- (`docs/JOURNAL.md`, décision 32). C'est `scripts/verify-seed.sh` qui enchaîne les deux.
--
-- Exécution : `scripts/verify-seed.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0003_seed_socle.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : l'extension `pgtap` ne subsiste
-- pas dans la base, et **aucune donnée du seed n'est modifiée** — la suite est en lecture seule.

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- =============================================================================================
-- 1. L'espace de travail — docs/SPEC-seed.md §2.1
-- =============================================================================================

select is(
	(select count(*)::int from public.workspaces),
	1,
	'le seed socle pose exactement un espace de travail (CRM-005 : « un workspace »)');

select is(
	(select count(*)::int from public.workspaces
	  where id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	1,
	'l''espace de travail porte l''identifiant fixe 5eed0000-…-000000000001');

select is(
	(select name from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	'P2Enjoy SARL',
	'workspaces.name vaut « P2Enjoy SAS »');

select is(
	(select slug from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	'p2enjoy',
	'workspaces.slug vaut « p2enjoy »');

select is(
	(select inbound_domain from public.workspaces
	  where id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	'crm.p2enjoy.test',
	'workspaces.inbound_domain vaut « crm.p2enjoy.test » — TLD réservé par la RFC 2606');

select is(
	(select settings from public.workspaces
	  where id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	'{}'::jsonb,
	'workspaces.settings vaut « {} » : aucun réglage, et non NULL');

-- =============================================================================================
-- 2. Les comptes — docs/SPEC-seed.md §2.2
-- =============================================================================================
-- Les comptes sont lus dans `auth.users`, dont GoTrue est l'autorité. Le seed n'y écrit jamais
-- directement : il passe par l'API d'administration. Ce que la suite vérifie ici, c'est le
-- **résultat** de cet appel, pas le moyen.

select is(
	(select count(*)::int from auth.users where id::text like '5eed%'),
	3,
	'le seed pose exactement trois comptes, reconnaissables à leur préfixe « 5eed »');

select is(
	(select email from auth.users where id = '5eed0000-0000-4000-8000-000000000011'::uuid),
	'admin@p2enjoy.test',
	'…000000000011 est admin@p2enjoy.test');

select is(
	(select email from auth.users where id = '5eed0000-0000-4000-8000-000000000012'::uuid),
	'bizdev@p2enjoy.test',
	'…000000000012 est bizdev@p2enjoy.test');

select is(
	(select email from auth.users where id = '5eed0000-0000-4000-8000-000000000013'::uuid),
	'viewer@p2enjoy.test',
	'…000000000013 est viewer@p2enjoy.test');

-- Une adresse non confirmée rendrait le compte inutilisable pour les tests et les captures, sans
-- que rien ne le signale avant la première tentative de connexion.
select is(
	(select count(*)::int from auth.users
	  where id::text like '5eed%' and email_confirmed_at is not null),
	3,
	'les trois comptes ont une adresse confirmée : ils sont immédiatement utilisables');

select is(
	(select count(*)::int from auth.users
	  where id::text like '5eed%' and encrypted_password is not null),
	3,
	'les trois comptes portent un mot de passe : aucun n''est resté au stade de l''invitation');

-- Le mot de passe n'est jamais stocké en clair. On ne teste pas sa valeur — elle est publiée —
-- mais le fait qu'elle ne soit pas lisible telle quelle dans la colonne.
select is(
	(select count(*)::int from auth.users
	  where id::text like '5eed%' and encrypted_password = 'SeedDev2026Local'),
	0,
	'le mot de passe du seed n''est pas stocké en clair dans auth.users');

-- Toutes les adresses du seed sont sous un TLD qui ne peut pas être routé : un email envoyé par
-- erreur à un compte de démonstration ne peut atteindre personne de réel.
select is(
	(select count(*)::int from auth.users
	  where id::text like '5eed%' and email not like '%@p2enjoy.test'),
	0,
	'aucune adresse du seed n''échappe au domaine réservé p2enjoy.test');

-- =============================================================================================
-- 3. Les profils — nés du trigger de CRM-003, convergés par le seed
-- =============================================================================================
-- Le seed ne crée aucun profil : `app.handle_new_user()` s'en charge (docs/SCHEMA.md §1). Ce que
-- la suite vérifie, c'est que le trigger a bien fonctionné pour les trois comptes, et que le nom
-- affiché est celui du contrat — ce qui, après une mise à jour de compte, n'a rien d'automatique
-- (docs/JOURNAL.md, décision 34).

select is(
	(select count(*)::int from public.profiles where id::text like '5eed%'),
	3,
	'les trois profils existent : le trigger de CRM-003 s''est déclenché pour chaque compte');

select is(
	(select full_name from public.profiles where id = '5eed0000-0000-4000-8000-000000000011'::uuid),
	'Camille Aubert',
	'le profil de l''administratrice porte le nom du contrat');

select is(
	(select full_name from public.profiles where id = '5eed0000-0000-4000-8000-000000000012'::uuid),
	'Driss Lemoine',
	'le profil du business developer porte le nom du contrat');

select is(
	(select full_name from public.profiles where id = '5eed0000-0000-4000-8000-000000000013'::uuid),
	'Farida Nowak',
	'le profil du viewer porte le nom du contrat');

select is(
	(select count(*)::int from public.profiles where id::text like '5eed%' and locale = 'fr'),
	3,
	'les trois profils sont en français, langue par défaut du produit');

select results_eq(
	$$ select id, avatar_url from public.profiles where id::text like '5eed%' order by id $$,
	$$ values
		('5eed0000-0000-4000-8000-000000000011'::uuid, '/avatars/camille-aubert.svg'::text),
		('5eed0000-0000-4000-8000-000000000012'::uuid, '/avatars/driss-lemoine.svg'::text),
		('5eed0000-0000-4000-8000-000000000013'::uuid, '/avatars/farida-nowak.svg'::text) $$,
	'les trois profils portent les avatars même origine du contrat CRM-022');

select results_eq(
	$$ select id, raw_user_meta_data ->> 'avatar_url' from auth.users
	    where id::text like '5eed%' order by id $$,
	$$ values
		('5eed0000-0000-4000-8000-000000000011'::uuid, '/avatars/camille-aubert.svg'::text),
		('5eed0000-0000-4000-8000-000000000012'::uuid, '/avatars/driss-lemoine.svg'::text),
		('5eed0000-0000-4000-8000-000000000013'::uuid, '/avatars/farida-nowak.svg'::text) $$,
	'les métadonnées GoTrue convergent sur les mêmes avatars');

-- Un profil sans compte serait le signe d'une cascade rompue ; un compte sans profil, d'un
-- trigger défaillant. Les deux sens sont vérifiés.
select is(
	(select count(*)::int from public.profiles p
	  where p.id::text like '5eed%'
	    and not exists (select 1 from auth.users u where u.id = p.id)),
	0,
	'aucun profil seedé n''est orphelin de son compte');

select is(
	(select count(*)::int from auth.users u
	  where u.id::text like '5eed%'
	    and not exists (select 1 from public.profiles p where p.id = u.id)),
	0,
	'aucun compte seedé n''est dépourvu de profil');

-- =============================================================================================
-- 4. Les appartenances et les rôles — docs/SPEC-permissions-rls.md §2.1
-- =============================================================================================

select is(
	(select count(*)::int from public.workspace_members),
	3,
	'exactement trois appartenances, aucune de plus');

select is(
	(select role from public.workspace_members
	  where user_id = '5eed0000-0000-4000-8000-000000000011'::uuid),
	'admin',
	'admin@p2enjoy.test est « admin »');

select is(
	(select role from public.workspace_members
	  where user_id = '5eed0000-0000-4000-8000-000000000012'::uuid),
	'business_developer',
	'bizdev@p2enjoy.test est « business_developer »');

select is(
	(select role from public.workspace_members
	  where user_id = '5eed0000-0000-4000-8000-000000000013'::uuid),
	'viewer',
	'viewer@p2enjoy.test est « viewer »');

select is(
	(select count(distinct role)::int from public.workspace_members),
	3,
	'les trois rôles de docs/SPEC-permissions-rls.md §2.1 sont représentés');

select is(
	(select count(*)::int from public.workspace_members
	  where workspace_id <> '5eed0000-0000-4000-8000-000000000001'::uuid),
	0,
	'toutes les appartenances visent l''unique espace de travail du seed');

-- =============================================================================================
-- 5. Ce que le seed ne pose PAS — docs/SPEC-seed.md §2.2 et §8
-- =============================================================================================
-- Ces deux contrôles ne sont pas une formalité : ils devaient rendre la suite rouge le jour où une
-- unité ajouterait des droits fins au seed sans étendre ces preuves. **C'est exactement ce qui
-- s'est produit à `CRM-012`** (docs/JOURNAL.md décision 51, neuvième occurrence), et ils sont
-- retournés plutôt que retirés : ils comptent désormais ce que le seed doit poser, de sorte qu'un
-- droit fin ajouté ou perdu reste immédiatement visible depuis la suite du seed.
--
-- Le contrat détaillé — quelle ligne démontre quelle situation de la matrice — est en
-- `docs/SPEC-seed.md` §2.11, et ses effets sont prouvés par
-- `supabase/tests/0011_droits_fins.test.sql` et `e2e/api/droits-fins.spec.ts`.

select is(
	(select count(*)::int from public.track_members),
	2,
	'deux droits fins de track : la restriction du viewer, et celle — sans effet — de '
	'l''administratrice (docs/SPEC-seed.md §2.11)');

select is(
	(select count(*)::int from public.channel_members),
	2,
	'deux droits fins de channel : la réouverture de `prospection` pour le viewer, et la '
	'lecture seule de `maintenance` pour le business developer');

-- =============================================================================================
-- 6. Les politiques d'identité attendues existent — CRM-022
-- =============================================================================================
-- Le seed ne crée aucune politique ; la migration CRM-022 en livre exactement sept. L'anonyme
-- reste fermé et les JWT membres sont exercés par scripts/verify-seed.sh et e2e/api/identites.

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public'
	    and tablename in ('profiles', 'workspaces', 'workspace_members')),
	7,
	'CRM-022 livre exactement sept politiques sur les trois tables d''identité');

select * from finish();

rollback;

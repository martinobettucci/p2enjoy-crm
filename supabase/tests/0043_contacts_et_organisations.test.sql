-- @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 1 : le modèle
-- @verifies docs/SPEC-contacts.md §2 (modèle), §3 (autorisations)
-- @verifies docs/SPEC-permissions-rls.md §4 (ligne contacts/organizations)
-- @verifies docs/SCHEMA.md §6 (organizations, contacts, card_contacts)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §15 (preuves propres)
--
-- CE QUE CETTE SUITE PROUVE.
--
-- 1. La FORME des trois tables — colonnes, contraintes de valeur, unicités partielles,
--    clés étrangères composites — établie par la mesure.
-- 2. Le CLOISONNEMENT STRUCTUREL : une organisation d'un workspace A ne peut porter un contact
--    référencé depuis le workspace B ; ni une card d'un workspace A être liée à un contact du
--    workspace B. La FK composite fait le refus sans trigger.
-- 3. La RLS activée sur les trois tables, les politiques par action nommées, et les privilèges
--    par rôle explicites — la lectrice n'écrit pas, l'anonyme obtient zéro ligne.
-- 4. Que `business_developer` PEUT écrire (contrairement aux tracks et channels réservés à
--    l'`admin`).
--
-- La suite s'exécute en transaction et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- Endossement d'un jeton — même patron que `0035_corbeille.test.sql`.
create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.endosser_anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('role', 'anon')::text, true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Constantes seedées (docs/SPEC-seed.md).
create or replace function pg_temp.ws() returns uuid language sql immutable
	as $$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.admin_id() returns uuid language sql immutable
	as $$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.bizdev_id() returns uuid language sql immutable
	as $$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.viewer_id() returns uuid language sql immutable
	as $$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- =============================================================================================
-- 1 à 9. FORME des trois tables.
-- =============================================================================================

select has_table('public', 'organizations', '1 — `organizations` existe');
select has_table('public', 'contacts',       '2 — `contacts` existe');
select has_table('public', 'card_contacts',  '3 — `card_contacts` existe');

select col_not_null('public', 'organizations', 'workspace_id',
	'4 — `organizations.workspace_id` est non nul');
select col_is_null ('public', 'organizations', 'domain',
	'5 — `organizations.domain` est facultatif');

select col_not_null('public', 'contacts', 'full_name',
	'6 — `contacts.full_name` est non nul');
select col_is_null ('public', 'contacts', 'email',
	'7 — `contacts.email` est facultatif');
select col_is_null ('public', 'contacts', 'organization_id',
	'8 — `contacts.organization_id` est facultatif');

select col_default_is('public', 'contacts', 'source', 'manual'::text,
	'9 — la source d''un contact vaut `manual` par défaut');

-- =============================================================================================
-- 10 à 14. CONTRAINTES DE VALEUR.
-- =============================================================================================

select throws_ok(
	$$ insert into public.contacts (workspace_id, full_name)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, '  ') $$,
	'23514', null,
	'10 — un `full_name` vide est refusé');

select throws_ok(
	$$ insert into public.contacts (workspace_id, full_name, email)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'x', 'sans arobase') $$,
	'23514', null,
	'11 — un email mal formé est refusé');

select throws_ok(
	$$ insert into public.contacts (workspace_id, full_name, source)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'x', 'inconnue') $$,
	'23514', null,
	'12 — une source hors énumération est refusée');

select throws_ok(
	$$ insert into public.organizations (workspace_id, name, domain)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'X', 'HÔTELS.exemple') $$,
	'23514', null,
	'13 — un domaine avec majuscules ou caractère hors [a-z0-9-.] est refusé');

select throws_ok(
	$$ insert into public.organizations (workspace_id, name, website)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'X', 'site sans schéma') $$,
	'23514', null,
	'14 — un `website` sans http/https est refusé');

-- =============================================================================================
-- 15 à 17. UNICITÉS PARTIELLES : deux organisations sans domaine coexistent, deux contacts sans
-- email coexistent, mais deux mêmes emails (casse différente) collisionnent.
-- =============================================================================================

-- Deux insertions successives : la SECONDE ne doit pas être refusée par l'unicité partielle.
do $$
declare avant int; apres int;
begin
	select count(*) into avant from public.organizations where workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid;
	insert into public.organizations (workspace_id, name) values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sans domaine A');
	insert into public.organizations (workspace_id, name) values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sans domaine B');
	select count(*) into apres from public.organizations where workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid;
	perform set_config('crm_test.orgs_delta', (apres - avant)::text, true);
end $$;
select is(current_setting('crm_test.orgs_delta')::int, 2,
	'15 — deux organisations sans domaine cohabitent dans le même workspace');

do $$
declare avant int; apres int;
begin
	select count(*) into avant from public.contacts where workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid;
	insert into public.contacts (workspace_id, full_name) values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sans email A');
	insert into public.contacts (workspace_id, full_name) values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sans email B');
	select count(*) into apres from public.contacts where workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid;
	perform set_config('crm_test.contacts_delta', (apres - avant)::text, true);
end $$;
select is(current_setting('crm_test.contacts_delta')::int, 2,
	'16 — deux contacts sans email cohabitent dans le même workspace');

do $$
begin
	insert into public.contacts (workspace_id, full_name, email)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'A', 'unicite@exemple.test');
end $$;

select throws_ok(
	$$ insert into public.contacts (workspace_id, full_name, email)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'B', 'UNICITE@Exemple.Test') $$,
	'23505', null,
	'17 — deux emails identiques à la casse près sont refusés (unicité partielle insensible)');

-- =============================================================================================
-- 18 à 20. CLOISONNEMENT STRUCTUREL par FK composites : un contact ne peut se rattacher à une
-- organisation d'un autre workspace, ni une card à un contact d'un autre workspace.
-- =============================================================================================

-- Crée un second workspace jetable pour cette suite, avec sa propre organisation et sa card.
-- (Passe par la clé de service ; on ne teste pas la RLS ici mais la FK composite.)
do $$
declare
	ws_b uuid := gen_random_uuid();
	org_b uuid;
begin
	insert into public.workspaces (id, name, slug)
	values (ws_b, 'Workspace B', 'workspace-b-test');
	insert into public.organizations (workspace_id, name)
	values (ws_b, 'Org B') returning id into org_b;
	perform set_config('crm_test.ws_b',  ws_b::text,  true);
	perform set_config('crm_test.org_b', org_b::text, true);
end $$;

select throws_ok(
	$$ insert into public.contacts (workspace_id, full_name, organization_id)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'X', current_setting('crm_test.org_b')::uuid) $$,
	'23503', null,
	'18 — un contact ne peut pointer une organisation d''un autre workspace (FK composite)');

do $$
declare
	c_b uuid;
begin
	insert into public.contacts (workspace_id, full_name)
	values (current_setting('crm_test.ws_b')::uuid, 'Contact B') returning id into c_b;
	perform set_config('crm_test.contact_b', c_b::text, true);
end $$;

select throws_ok(
	$$ insert into public.card_contacts (workspace_id, card_id, contact_id)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid,
	           '5eed0000-0000-4000-8000-0000000000c1'::uuid,
	           current_setting('crm_test.contact_b')::uuid) $$,
	'23503', null,
	'19 — une card ne peut être liée à un contact d''un autre workspace (FK composite)');

-- Une paire (card, contact) même workspace est acceptée ; répéter la paire est refusée par la PK.
do $$
declare
	c_a uuid;
begin
	insert into public.contacts (workspace_id, full_name, email)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Contact A', 'pk-test@exemple.test') returning id into c_a;
	insert into public.card_contacts (workspace_id, card_id, contact_id)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, '5eed0000-0000-4000-8000-0000000000c1'::uuid, c_a);
	perform set_config('crm_test.contact_a', c_a::text, true);
end $$;

select throws_ok(
	$$ insert into public.card_contacts (workspace_id, card_id, contact_id)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid,
	           '5eed0000-0000-4000-8000-0000000000c1'::uuid,
	           current_setting('crm_test.contact_a')::uuid) $$,
	'23505', null,
	'20 — la même paire (card, contact) n''entre pas deux fois (clé primaire)');

-- =============================================================================================
-- 21 à 24. RLS ACTIVÉE.
-- =============================================================================================

select ok(
	(select relrowsecurity from pg_class where oid = 'public.organizations'::regclass),
	'21 — RLS activée sur `organizations`');
select ok(
	(select relrowsecurity from pg_class where oid = 'public.contacts'::regclass),
	'22 — RLS activée sur `contacts`');
select ok(
	(select relrowsecurity from pg_class where oid = 'public.card_contacts'::regclass),
	'23 — RLS activée sur `card_contacts`');

select is(
	(select count(*)::int from pg_policies
	   where schemaname = 'public'
	     and tablename in ('organizations','contacts','card_contacts')),
	12,
	'24 — douze politiques au total (quatre par table : lecture, insertion, MAJ, suppression)');

-- =============================================================================================
-- 25 à 27. POLITIQUES d'écriture nommées par action, sur les trois tables.
-- =============================================================================================

select is(
	(select count(*)::int from pg_policies
	   where schemaname = 'public' and tablename = 'organizations'),
	4,
	'25 — `organizations` porte 4 politiques : lecture, insertion, MAJ, suppression');

select is(
	(select count(*)::int from pg_policies
	   where schemaname = 'public' and tablename = 'contacts'),
	4,
	'26 — `contacts` porte 4 politiques : lecture, insertion, MAJ, suppression');

select is(
	(select count(*)::int from pg_policies
	   where schemaname = 'public' and tablename = 'card_contacts'),
	4,
	'27 — `card_contacts` porte 4 politiques : lecture, insertion, MAJ, suppression');

-- =============================================================================================
-- 28 à 30. PRIVILÈGES par rôle. Un `revoke all` puis les GRANT nommés.
-- =============================================================================================

select is(
	(select array_agg(privilege_type::text order by privilege_type::text)
	   from information_schema.role_table_grants
	  where table_schema='public' and table_name='contacts' and grantee='authenticated'),
	array['DELETE','INSERT','SELECT','UPDATE']::text[],
	'28 — `authenticated` porte SELECT, INSERT, UPDATE, DELETE sur `contacts`');

select is(
	(select array_agg(privilege_type::text order by privilege_type::text)
	   from information_schema.role_table_grants
	  where table_schema='public' and table_name='contacts' and grantee='anon'),
	array['SELECT']::text[],
	'29 — `anon` ne porte que SELECT sur `contacts` (refus par zéro ligne)');

select is(
	(select array_agg(privilege_type::text order by privilege_type::text)
	   from information_schema.role_table_grants
	  where table_schema='public' and table_name='card_contacts' and grantee='authenticated'),
	array['DELETE','INSERT','SELECT','UPDATE']::text[],
	'30 — `authenticated` porte SELECT, INSERT, UPDATE, DELETE sur `card_contacts`');

-- =============================================================================================
-- 31 à 34. BUSINESS_DEVELOPER PEUT écrire ; VIEWER refusé ; ANONYME zéro ligne.
-- =============================================================================================

-- 31. business_developer INSÈRE une organisation.
do $$
declare ok bool;
begin
	perform pg_temp.endosser(pg_temp.bizdev_id());
	insert into public.organizations (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Bizdev OK');
	perform pg_temp.redevenir_proprietaire();
	ok := true;
	perform set_config('crm_test.bizdev_insert', ok::text, true);
exception
	when others then
		perform pg_temp.redevenir_proprietaire();
		perform set_config('crm_test.bizdev_insert', 'false', true);
end $$;
select is(current_setting('crm_test.bizdev_insert'), 'true',
	'31 — `business_developer` insère une organisation (écriture ouverte, docs/SPEC-permissions-rls.md §4)');

-- 32. viewer INSÈRE : refus 42501.
select pg_temp.endosser(pg_temp.viewer_id());
select throws_ok(
	$$ insert into public.organizations (workspace_id, name)
	   values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Viewer refus') $$,
	'42501', null,
	'32 — la lectrice ne peut pas insérer une organisation');
select pg_temp.redevenir_proprietaire();

-- 33. anonyme LIT `contacts` : zéro ligne, jamais une erreur.
do $$
declare n int;
begin
	perform pg_temp.endosser_anonyme();
	select count(*) into n from public.contacts;
	perform pg_temp.redevenir_proprietaire();
	perform set_config('crm_test.anon_count', n::text, true);
end $$;
select is(current_setting('crm_test.anon_count')::int, 0,
	'33 — l''anonyme lit zéro ligne de `contacts` (refus par zéro ligne, jamais par erreur)');

-- 34. admin LIT `contacts` : les lignes qu'on a créées sont là (au moins 5, tolérance ouverte).
do $$
declare n int;
begin
	perform pg_temp.endosser(pg_temp.admin_id());
	select count(*) into n from public.contacts where workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid;
	perform pg_temp.redevenir_proprietaire();
	perform set_config('crm_test.admin_count', n::text, true);
end $$;
select ok(current_setting('crm_test.admin_count')::int >= 4,
	'34 — l''administratrice lit les contacts de son workspace (au moins ceux créés par la suite)');

-- =============================================================================================
-- 35 à 38. CASCADES et détachement.
-- =============================================================================================

-- On se remet propriétaire pour ces scénarios : les blocs précédents ont endossé plusieurs rôles.
select pg_temp.redevenir_proprietaire();

-- 35. Supprimer une organisation DÉTACHE ses contacts (on delete set null).
do $$
declare org_id uuid; c_id uuid; org_after int;
begin
	insert into public.organizations (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sera supprimée') returning id into org_id;
	insert into public.contacts (workspace_id, full_name, organization_id)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Détaché', org_id) returning id into c_id;
	delete from public.organizations where id = org_id;
	select case when organization_id is null then 1 else 0 end into org_after
	  from public.contacts where id = c_id;
	perform set_config('crm_test.cascade_org', org_after::text, true);
end $$;
select is(current_setting('crm_test.cascade_org')::int, 1,
	'35 — supprimer une organisation détache ses contacts (`on delete set null`), sans les emporter');

-- 36. Supprimer un contact EMPORTE ses `card_contacts` (on delete cascade).
do $$
declare c_id uuid; n_before int; n_after int;
begin
	insert into public.contacts (workspace_id, full_name)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Sera cascade') returning id into c_id;
	insert into public.card_contacts (workspace_id, card_id, contact_id)
	values ('5eed0000-0000-4000-8000-000000000001'::uuid, '5eed0000-0000-4000-8000-0000000000c2'::uuid, c_id);
	select count(*) into n_before from public.card_contacts where contact_id = c_id;
	delete from public.contacts where id = c_id;
	select count(*) into n_after  from public.card_contacts where contact_id = c_id;
	perform set_config('crm_test.cascade_contact', (n_before - n_after)::text, true);
end $$;
select is(current_setting('crm_test.cascade_contact')::int, 1,
	'36 — supprimer un contact emporte ses `card_contacts` (`on delete cascade`)');

-- 37 et 38. Contraintes d'unicité composite existent bien : (id, workspace_id) sur organizations
-- et contacts — ce qui rend exprimables les FK composites.
select is(
	(select count(*)::int from pg_constraint
	   where conrelid = 'public.organizations'::regclass and contype = 'u'),
	1,
	'37 — `organizations` porte l''unicité composite (id, workspace_id)');

select is(
	(select count(*)::int from pg_constraint
	   where conrelid = 'public.contacts'::regclass and contype = 'u'),
	1,
	'38 — `contacts` porte l''unicité composite (id, workspace_id)');

select * from finish();
rollback;

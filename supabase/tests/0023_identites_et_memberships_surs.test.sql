-- @verifies CRM-022 (docs/BACKLOG.md) — identités lisibles et memberships sûrs
-- @verifies docs/SPEC-identite.md §3 à §9
-- @verifies docs/SCHEMA.md §1 et §5
-- @verifies docs/SPEC-permissions-rls.md §4.1 bis et §7
-- @verifies docs/JOURNAL.md décisions 294 et 307

begin;

create extension if not exists pgtap with schema extensions;

select plan(84);

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

-- Identifiants réservés à la transaction de cette suite.
-- B = second workspace ; C = workspace à administrateur unique ; AUTEUR = profil à supprimer.

-- =============================================================================================
-- 1. Schéma, fonctions, triggers, politiques et privilèges
-- =============================================================================================

select col_not_null('public', 'profiles', 'full_name',
	'1 — le nom reste non nul');
select is(
	(select a.attnotnull from pg_attribute a
	  where a.attrelid = 'public.profiles'::regclass and a.attname = 'avatar_url'),
	false, '2 — l''avatar reste nullable');
select ok(exists (
	select 1 from pg_constraint c
	 where c.conrelid = 'public.profiles'::regclass
	   and c.conname = 'profiles_full_name_check' and c.contype = 'c'),
	'3 — la borne du nom est une contrainte nommée');
select ok(exists (
	select 1 from pg_constraint c
	 where c.conrelid = 'public.profiles'::regclass
	   and c.conname = 'profiles_avatar_url_check' and c.contype = 'c'),
	'4 — la frontière d''URL avatar est une contrainte nommée');
select is(
	(select a.attnotnull from pg_attribute a
	  where a.attrelid = 'public.card_comments'::regclass and a.attname = 'author_id'),
	false, '5 — l''auteur d''un commentaire est nullable');
select is(
	(select c.confdeltype::text from pg_constraint c
	  where c.conrelid = 'public.card_comments'::regclass
	    and c.conname = 'card_comments_author_id_fkey'),
	'n', '6 — la FK d''auteur porte ON DELETE SET NULL');

select has_function('app', 'profile_normaliser_nom',
	'7 — la normalisation du nom est une fonction');
select has_function('app', 'workspace_members_garder_admin',
	'8 — la garde du dernier admin est une fonction');
select has_trigger('public', 'profiles', 'profiles_normaliser_nom',
	'9 — la normalisation est branchée sur profiles');
select has_trigger('public', 'workspace_members', 'workspace_members_garder_admin',
	'10 — la garde est branchée sur workspace_members');
select is(
	(select t.tgdeferrable from pg_trigger t
	  where t.tgrelid = 'public.workspace_members'::regclass
	    and t.tgname = 'workspace_members_garder_admin'),
	true, '11 — la garde est différable');
select is(
	(select t.tginitdeferred from pg_trigger t
	  where t.tgrelid = 'public.workspace_members'::regclass
	    and t.tgname = 'workspace_members_garder_admin'),
	false, '12 — la garde est initialement immédiate');
select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'workspace_members_garder_admin'),
	true, '13 — la garde est SECURITY DEFINER');
select is(
	(select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'workspace_members_garder_admin'),
	'postgres', '14 — la garde appartient à postgres');
select is(
	(select p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'workspace_members_garder_admin'),
	'{"search_path=\"\""}', '15 — le search_path de la garde est vide');
select ok(
	not has_function_privilege('authenticated', 'app.workspace_members_garder_admin()', 'EXECUTE'),
	'16 — aucun rôle API n''appelle directement la garde');

select policies_are('public', 'profiles',
	array['profiles_lecture_equipe', 'profiles_maj_propre'],
	'17 — profiles porte exactement deux politiques');
select policies_are('public', 'workspaces',
	array['workspaces_lecture_membre'],
	'18 — workspaces porte exactement une politique');
select policies_are('public', 'workspace_members',
	array['workspace_members_lecture_membre', 'workspace_members_insertion_admin',
	      'workspace_members_maj_admin', 'workspace_members_suppression_admin'],
	'19 — workspace_members porte exactement quatre politiques');
select is(
	(select count(*)::int from pg_policy p
	  where p.polrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass,
	                       'public.workspace_members'::regclass)),
	7, '20 — les trois tables portent exactement sept politiques');
select is(
	(select jsonb_agg(jsonb_build_array(c.relname, p.polname, p.polcmd) order by c.relname, p.polname)
	   from pg_policy p join pg_class c on c.oid = p.polrelid
	  where p.polrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass,
	                       'public.workspace_members'::regclass)),
	'[["profiles", "profiles_lecture_equipe", "r"],
	  ["profiles", "profiles_maj_propre", "w"],
	  ["workspace_members", "workspace_members_insertion_admin", "a"],
	  ["workspace_members", "workspace_members_lecture_membre", "r"],
	  ["workspace_members", "workspace_members_maj_admin", "w"],
	  ["workspace_members", "workspace_members_suppression_admin", "d"],
	  ["workspaces", "workspaces_lecture_membre", "r"]]'::jsonb,
	'21 — chaque politique porte la commande attendue');

select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
	'22 — aucun UPDATE de table ne rouvre profiles');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
	'23 — full_name est modifiable');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE'),
	'24 — avatar_url est modifiable');
select ok((select bool_and(not has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'))
	from unnest(array['id', 'locale', 'created_at', 'updated_at']) c),
	'25 — les colonnes privilégiées du profil sont fermées');
select ok(has_table_privilege('authenticated', 'public.workspaces', 'SELECT'),
	'26 — un utilisateur peut lire les workspaces consentis');
select ok((select bool_and(not has_table_privilege('authenticated', 'public.workspaces', p))
	from unnest(array['INSERT', 'UPDATE', 'DELETE']) p),
	'27 — aucun geste d''écriture de workspace n''est exposé');
select ok(has_table_privilege('authenticated', 'public.workspace_members', 'SELECT'),
	'28 — les memberships consentis sont lisibles');
select ok(has_table_privilege('authenticated', 'public.workspace_members', 'INSERT'),
	'29 — INSERT est disponible sous politique admin');
select ok(has_table_privilege('authenticated', 'public.workspace_members', 'DELETE'),
	'30 — DELETE est disponible sous politique admin');
select ok(not has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE'),
	'31 — aucun UPDATE de table ne permet de déplacer une appartenance');
select ok(has_column_privilege('authenticated', 'public.workspace_members', 'role', 'UPDATE'),
	'32 — seul role est modifiable');
select ok((select bool_and(not has_column_privilege(
	'authenticated', 'public.workspace_members', c, 'UPDATE'))
	from unnest(array['workspace_id', 'user_id', 'created_at']) c),
	'33 — les clés et la date d''appartenance sont fermées');
select ok(
	has_table_privilege('service_role', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE')
	and has_table_privilege('service_role', 'public.workspaces', 'SELECT,INSERT,UPDATE,DELETE')
	and has_table_privilege('service_role', 'public.workspace_members', 'SELECT,INSERT,UPDATE,DELETE'),
	'34 — service_role conserve les privilèges nécessaires au provisioning');

-- =============================================================================================
-- 2. Bornes du profil et création GoTrue
-- =============================================================================================

select lives_ok(
	$$ update public.profiles set full_name = '  Camille Aubert  '
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'35 — un nom avec espaces de bord est accepté puis normalisé');
select is(
	(select full_name from public.profiles where id = '5eed0000-0000-4000-8000-000000000011'),
	'Camille Aubert', '36 — les espaces de bord ne sont pas stockés');
select throws_ok(
	$$ update public.profiles set full_name = '   '
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', null, '37 — un nom blanc est refusé');
select throws_ok(
	$$ update public.profiles set full_name = repeat('x', 121)
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', null, '38 — un nom de 121 caractères est refusé');
select throws_ok(
	$$ update public.profiles set avatar_url = 'http://exemple.test/avatar.png'
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', null, '39 — HTTP est refusé');
select throws_ok(
	$$ update public.profiles set avatar_url = '//exemple.test/avatar.png'
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', null, '40 — un chemin protocole-relatif est refusé');
select lives_ok(
	$$ update public.profiles set avatar_url = '/avatars/camille-aubert.svg'
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'41 — un chemin même origine est accepté');
select lives_ok(
	$$ update public.profiles set avatar_url = 'https://exemple.test/avatar.png'
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'42 — HTTPS est accepté');

select lives_ok(
	$$ insert into auth.users (id, email, raw_user_meta_data)
	   values ('02200000-0000-4000-8000-000000000003', 'auteur-crm022@exemple.test',
	           jsonb_build_object('full_name', repeat('N', 125),
	                              'avatar_url', 'javascript:alert(1)')) $$,
	'43 — une métadonnée avatar invalide ne fait pas échouer la création GoTrue');
select is(
	(select avatar_url from public.profiles where id = '02200000-0000-4000-8000-000000000003'),
	null, '44 — l''avatar invalide de GoTrue devient nul');
select is(
	(select char_length(full_name) from public.profiles
	  where id = '02200000-0000-4000-8000-000000000003'),
	120, '45 — le nom GoTrue est borné à 120 caractères');

-- Fixtures des frontières : deux collègues dans B et un profil sans membership pour les ajouts.
insert into auth.users (id, email, raw_user_meta_data) values
	('02200000-0000-4000-8000-000000000001', 'admin-b-crm022@exemple.test',
	 '{"full_name":"Admin B CRM022"}'),
	('02200000-0000-4000-8000-000000000002', 'releve-b-crm022@exemple.test',
	 '{"full_name":"Relève B CRM022"}'),
	('02200000-0000-4000-8000-000000000004', 'invite-crm022@exemple.test',
	 '{"full_name":"Invité CRM022"}');

insert into public.workspaces (id, name, slug)
values ('02200000-0000-4000-8000-0000000000b1', 'Workspace B CRM022', 'workspace-b-crm022');
insert into public.workspace_members (workspace_id, user_id, role) values
	('02200000-0000-4000-8000-0000000000b1', '02200000-0000-4000-8000-000000000001', 'admin'),
	('02200000-0000-4000-8000-0000000000b1', '02200000-0000-4000-8000-000000000002', 'viewer');

-- =============================================================================================
-- 3. RLS de lecture : équipe oui, autre workspace non, anonyme non
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*) from public.profiles), 3::bigint,
	'46 — l''admin A lit les trois profils de son équipe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select count(*) from public.profiles), 3::bigint,
	'47 — le business developer A lit les trois profils de son équipe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*) from public.profiles), 3::bigint,
	'48 — le viewer A lit les trois profils de son équipe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*) from public.workspaces), 1::bigint,
	'49 — l''admin A ne lit que son workspace');
select is((select count(*) from public.workspace_members), 3::bigint,
	'50 — l''admin A lit les trois memberships de son workspace');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('02200000-0000-4000-8000-000000000001');
select is((select count(*) from public.profiles), 2::bigint,
	'51 — l''admin B lit seulement les deux profils de B');
select is((select count(*) from public.workspaces), 1::bigint,
	'52 — l''admin B ne lit que B');
select is((select count(*) from public.workspace_members), 2::bigint,
	'53 — l''admin B lit seulement les memberships de B');
select is_empty(
	$$ select 1 from public.profiles
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'54 — B ne lit aucun profil de A');
select pg_temp.redevenir_proprietaire();

set local role anon;
select is(
	(select (select count(*) from public.profiles)
	       + (select count(*) from public.workspaces)
	       + (select count(*) from public.workspace_members)),
	0::bigint, '55 — l''anonyme lit zéro ligne sur les trois tables');
reset role;

-- =============================================================================================
-- 4. Profil propre et mutations de membership
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select results_eq(
	$$ update public.profiles set full_name = '  Camille Aubert  '
	    where id = '5eed0000-0000-4000-8000-000000000011'
	    returning full_name $$,
	$$ values ('Camille Aubert'::text) $$,
	'56 — l''admin modifie et normalise son propre nom');
select is_empty(
	$$ update public.profiles set full_name = 'Usurpation'
	    where id = '5eed0000-0000-4000-8000-000000000012'
	    returning id $$,
	'57 — modifier le profil d''un collègue ne touche aucune ligne');
select throws_ok(
	$$ update public.profiles set locale = 'en'
	    where id = '5eed0000-0000-4000-8000-000000000011' $$,
	'42501', null, '58 — locale est fermée par privilège de colonne');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select results_eq(
	$$ update public.profiles set avatar_url = '/avatars/driss-lemoine.svg'
	    where id = '5eed0000-0000-4000-8000-000000000012'
	    returning avatar_url $$,
	$$ values ('/avatars/driss-lemoine.svg'::text) $$,
	'59 — le business developer modifie son propre avatar');
select throws_ok(
	$$ update public.profiles set avatar_url = 'data:image/svg+xml,non'
	    where id = '5eed0000-0000-4000-8000-000000000012' $$,
	'23514', null, '60 — la contrainte reste opposable à une mise à jour propre');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select results_eq(
	$$ update public.workspace_members set role = 'business_developer'
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000013'
	    returning role $$,
	$$ values ('business_developer'::text) $$,
	'61 — l''admin promeut un membership de son workspace');
select lives_ok(
	$$ update public.workspace_members set role = 'viewer'
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000013' $$,
	'62 — l''admin restaure le rôle du viewer');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is_empty(
	$$ update public.workspace_members set role = 'admin'
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000013'
	    returning user_id $$,
	'63 — un business developer ne promeut personne');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is_empty(
	$$ delete from public.workspace_members
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000012'
	    returning user_id $$,
	'64 — un viewer ne retire personne');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select results_eq(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('5eed0000-0000-4000-8000-000000000001',
	           '02200000-0000-4000-8000-000000000004', 'viewer')
	   returning role $$,
	$$ values ('viewer'::text) $$,
	'65 — l''admin ajoute un membership');
select results_eq(
	$$ delete from public.workspace_members
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '02200000-0000-4000-8000-000000000004'
	    returning user_id $$,
	$$ values ('02200000-0000-4000-8000-000000000004'::uuid) $$,
	'66 — l''admin retire le membership ajouté');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('5eed0000-0000-4000-8000-000000000001',
	           '02200000-0000-4000-8000-000000000004', 'viewer') $$,
	'42501', null, '67 — un business developer ne peut ajouter un membership');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is_empty(
	$$ update public.workspace_members set role = 'admin'
	    where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	      and user_id = '02200000-0000-4000-8000-000000000002'
	    returning user_id $$,
	'68 — l''admin A ne modifie aucun membership de B');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Dernier admin, rotation différée et cascade du parent
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$ update public.workspace_members set role = 'viewer'
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', 'last_workspace_admin',
	'69 — le dernier admin ne se rétrograde pas');
select throws_ok(
	$$ delete from public.workspace_members
	    where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	      and user_id = '5eed0000-0000-4000-8000-000000000011' $$,
	'23514', 'last_workspace_admin',
	'70 — le dernier admin ne se retire pas');
select pg_temp.redevenir_proprietaire();

select throws_ok(
	$$ delete from public.workspace_members
	    where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	      and user_id = '02200000-0000-4000-8000-000000000001' $$,
	'23514', 'last_workspace_admin',
	'71 — même postgres ne contourne pas la garde d''intégrité');

select lives_ok(
	$$ do $rotation$
	   begin
	     set constraints workspace_members_garder_admin deferred;
	     update public.workspace_members set role = 'admin'
	      where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	        and user_id = '02200000-0000-4000-8000-000000000002';
	     update public.workspace_members set role = 'viewer'
	      where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	        and user_id = '02200000-0000-4000-8000-000000000001';
	     set constraints workspace_members_garder_admin immediate;
	   end $rotation$ $$,
	'72 — une rotation explicitement différée réussit');
select results_eq(
	$$ select user_id, role from public.workspace_members
	    where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	    order by user_id $$,
	$$ values
	   ('02200000-0000-4000-8000-000000000001'::uuid, 'viewer'::text),
	   ('02200000-0000-4000-8000-000000000002'::uuid, 'admin'::text) $$,
	'73 — la relève est réellement devenue admin');
select lives_ok(
	$$ do $rotation$
	   begin
	     set constraints workspace_members_garder_admin deferred;
	     update public.workspace_members set role = 'admin'
	      where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	        and user_id = '02200000-0000-4000-8000-000000000001';
	     update public.workspace_members set role = 'viewer'
	      where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	        and user_id = '02200000-0000-4000-8000-000000000002';
	     set constraints workspace_members_garder_admin immediate;
	   end $rotation$ $$,
	'74 — la rotation inverse réussit aussi');
select results_eq(
	$$ select user_id, role from public.workspace_members
	    where workspace_id = '02200000-0000-4000-8000-0000000000b1'
	    order by user_id $$,
	$$ values
	   ('02200000-0000-4000-8000-000000000001'::uuid, 'admin'::text),
	   ('02200000-0000-4000-8000-000000000002'::uuid, 'viewer'::text) $$,
	'75 — l''état initial de B est restauré');
select lives_ok(
	$$ delete from public.workspaces
	    where id = '02200000-0000-4000-8000-0000000000b1' $$,
	'76 — supprimer le workspace parent laisse sa cascade s''achever');
select is_empty(
	$$ select 1 from public.workspace_members
	    where workspace_id = '02200000-0000-4000-8000-0000000000b1' $$,
	'77 — aucun membership de B ne survit au parent');

select lives_ok(
	$$ insert into public.workspaces (id, name, slug)
	   values ('02200000-0000-4000-8000-0000000000c1',
	           'Workspace C CRM022', 'workspace-c-crm022');
	   insert into public.workspace_members (workspace_id, user_id, role)
	   values ('02200000-0000-4000-8000-0000000000c1',
	           '02200000-0000-4000-8000-000000000001', 'admin') $$,
	'78 — un workspace peut recevoir son premier admin');
select throws_ok(
	$$ delete from public.workspace_members
	    where workspace_id = '02200000-0000-4000-8000-0000000000c1'
	      and user_id = '02200000-0000-4000-8000-000000000001' $$,
	'23514', 'last_workspace_admin',
	'79 — l''admin unique ne contourne pas la garde en laissant zéro membre');
select lives_ok(
	$$ delete from public.workspaces
	    where id = '02200000-0000-4000-8000-0000000000c1' $$,
	'80 — la cascade de C reste possible malgré sa seule ligne admin');

-- =============================================================================================
-- 6. La parole survit au compte
-- =============================================================================================

select lives_ok(
	$$ insert into public.card_comments
	     (id, workspace_id, card_id, author_id, body)
	   values
	     ('02200000-0000-4000-8000-0000000000d1',
	      '5eed0000-0000-4000-8000-000000000001',
	      '5eed0000-0000-4000-8000-0000000000c1',
	      '02200000-0000-4000-8000-000000000003',
	      'Parole conservée CRM022') $$,
	'81 — un commentaire peut référencer son auteur');
select lives_ok(
	$$ delete from auth.users
	    where id = '02200000-0000-4000-8000-000000000003' $$,
	'82 — supprimer le compte auteur n''est pas bloqué par sa parole');
select results_eq(
	$$ select author_id, body from public.card_comments
	    where id = '02200000-0000-4000-8000-0000000000d1' $$,
	$$ values (null::uuid, 'Parole conservée CRM022'::text) $$,
	'83 — la parole demeure et son auteur est détaché');

insert into public.workspaces (id, name, slug)
values ('02200000-0000-4000-8000-0000000000e1', 'Workspace vide CRM022', 'workspace-vide-crm022');
select throws_ok(
	$$ insert into public.workspace_members (workspace_id, user_id, role)
	   values ('02200000-0000-4000-8000-0000000000e1',
	           '02200000-0000-4000-8000-000000000004', 'viewer') $$,
	'23514', 'last_workspace_admin',
	'84 — le premier membership d''un workspace ne peut être non-admin');

select * from finish();

rollback;

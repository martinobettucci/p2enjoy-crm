-- @verifies CRM-092 (docs/BACKLOG.md) — identité par le seul SSO, tranche T1
-- @verifies docs/SPEC-session-sso.md §6.1 (règle), §6.2 (ouverture de session), §6.3 (attentes),
--           §7.1 (fonctions auth.*), §7.2 (modèle, RLS, privilèges), §13 (preuves pgTAP)
-- @verifies docs/SPEC-identite.md §4 (bornes du nom) ; docs/SPEC-permissions-rls.md §3.2
-- @verifies docs/JOURNAL.md décisions 579, 580 (K11) et 581

begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.endosser_role(nom text)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', nom)::text, true);
	execute pg_catalog.format('set local role %I', nom);
end;
$$;

-- Exécute une instruction sous le rôle courant et rend le nombre de lignes qu'elle a touchées : un
-- `DELETE` dans un `WITH` imbriqué est refusé par PostgreSQL.
create or replace function pg_temp.lignes(requete text)
returns integer language plpgsql as $$
declare
	n integer;
begin
	execute requete;
	get diagnostics n = row_count;
	return n;
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Identifiants réservés à cette transaction, annulée en fin de suite.
-- W1, W2 : espaces de preuve. ADM : administratrice de W1. MBR : simple membre de W1.
-- ADM2 : administratrice de W2 seule. NEUF, NEUF2, NEUF3, ETRANGER : sub LeLabs sans profil.

create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W1',       '0c920000-0000-4000-8000-000000000001'),
	('W2',       '0c920000-0000-4000-8000-000000000002'),
	('ADM',      '0c920000-0000-4000-8000-000000000011'),
	('MBR',      '0c920000-0000-4000-8000-000000000012'),
	('ADM2',     '0c920000-0000-4000-8000-000000000013'),
	('NEUF',     '0c920000-0000-4000-8000-000000000021'),
	('NEUF2',    '0c920000-0000-4000-8000-000000000022'),
	('NEUF3',    '0c920000-0000-4000-8000-000000000023'),
	('ETRANGER', '0c920000-0000-4000-8000-000000000024');
grant select on ids to anon, authenticated, service_role;

create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

-- =============================================================================================
-- 1. Fonctions auth.* : la forme qui lit `request.jwt.claims` (§7.1, K11)
-- =============================================================================================

select is(
	(select set_config('request.jwt.claims',
		'{"sub":"0c920000-0000-4000-8000-0000000000aa","role":"authenticated","email":"a@b.test"}', true)
	 is not null),
	true, '1 — revendications posées comme PostgREST 14 les pose');
select is(auth.uid(), '0c920000-0000-4000-8000-0000000000aa'::uuid,
	'2 — auth.uid() lit le sub de request.jwt.claims (K11 levée)');
select is(auth.role(), 'authenticated', '3 — auth.role() lit le rôle de request.jwt.claims');
select is(auth.email(), 'a@b.test', '4 — auth.email() lit l''adresse de request.jwt.claims');
select is(auth.jwt() ->> 'sub', '0c920000-0000-4000-8000-0000000000aa',
	'5 — auth.jwt() rend les revendications');
select is(
	(select count(*)::integer from pg_proc p
	  where p.pronamespace = 'auth'::regnamespace
	    and p.proname in ('uid', 'role', 'email', 'jwt')
	    and pg_get_userbyid(p.proowner) = 'supabase_auth_admin'
	    and not p.prosecdef),
	4, '6 — les quatre fonctions gardent le propriétaire de GoTrue, sans SECURITY DEFINER');
select set_config('request.jwt.claims', '', true);

-- =============================================================================================
-- 2. Modèle : profils détachés d'auth.users, table des attentes (§7.2)
-- =============================================================================================

select is(
	(select count(*)::integer from pg_constraint c
	  where c.conrelid = 'public.profiles'::regclass and c.contype = 'f'
	    and c.confrelid = 'auth.users'::regclass),
	0, '7 — profiles.id ne référence plus auth.users');
select has_table('public', 'workspace_invitations', '8 — la table des attentes existe');
select col_is_pk('public', 'workspace_invitations', array['workspace_id', 'email'],
	'9 — une attente par adresse et par espace');
select col_not_null('public', 'workspace_invitations', 'email', '10 — adresse obligatoire');
select col_not_null('public', 'workspace_invitations', 'role', '11 — rôle obligatoire');
select ok(exists (select 1 from pg_constraint c
	where c.conrelid = 'public.workspace_invitations'::regclass
	  and c.conname = 'workspace_invitations_email_check' and c.contype = 'c'),
	'12 — la forme de l''adresse est une contrainte nommée');
select ok(exists (select 1 from pg_constraint c
	where c.conrelid = 'public.workspace_invitations'::regclass
	  and c.conname = 'workspace_invitations_role_check' and c.contype = 'c'),
	'13 — la liste des rôles est une contrainte nommée');
select is(
	(select c.confdeltype::text from pg_constraint c
	  where c.conrelid = 'public.workspace_invitations'::regclass and c.contype = 'f'
	    and c.confrelid = 'public.workspaces'::regclass),
	'c', '14 — supprimer l''espace supprime ses attentes');
select is(
	(select c.confdeltype::text from pg_constraint c
	  where c.conrelid = 'public.workspace_invitations'::regclass and c.contype = 'f'
	    and c.confrelid = 'public.profiles'::regclass),
	'n', '15 — supprimer l''auteur d''une attente la détache sans la perdre');
select has_index('public', 'workspace_invitations', 'workspace_invitations_email_idx',
	'16 — l''adresse est indexée pour l''échange');

-- =============================================================================================
-- 3. RLS et privilèges (§7.2, docs/SPEC-permissions-rls.md §3.2)
-- =============================================================================================

select ok((select c.relrowsecurity from pg_class c
	where c.oid = 'public.workspace_invitations'::regclass), '17 — RLS activée');
select is(
	(select array_agg(p.polname || ':' || p.polcmd::text order by p.polname) from pg_policy p
	  where p.polrelid = 'public.workspace_invitations'::regclass),
	array['workspace_invitations_insertion_admin:a', 'workspace_invitations_lecture_admin:r',
	      'workspace_invitations_suppression_admin:d'],
	'18 — trois politiques exactement : lecture, insertion, suppression');
select ok(has_table_privilege('anon', 'public.workspace_invitations', 'SELECT')
	and not has_table_privilege('anon', 'public.workspace_invitations', 'INSERT')
	and not has_table_privilege('anon', 'public.workspace_invitations', 'DELETE'),
	'19 — anon ne peut que lire, et la RLS lui rend zéro ligne');
select ok(not has_table_privilege('authenticated', 'public.workspace_invitations', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.workspace_invitations', 'role', 'UPDATE'),
	'20 — aucune mise à jour d''une attente n''est ouverte');
select ok(not has_column_privilege('authenticated', 'public.workspace_invitations', 'created_at', 'INSERT'),
	'21 — la date d''inscription reste celle du serveur');

-- Fixtures, posées par le propriétaire.
insert into public.workspaces (id, name, slug)
values (pg_temp.id('W1'), 'Preuve SSO un', 'preuve-sso-un'),
       (pg_temp.id('W2'), 'Preuve SSO deux', 'preuve-sso-deux');
insert into public.profiles (id, full_name)
values (pg_temp.id('ADM'), 'Admin Preuve'),
       (pg_temp.id('MBR'), 'Membre Preuve'),
       (pg_temp.id('ADM2'), 'Admin Deux');
insert into public.workspace_members (workspace_id, user_id, role)
values (pg_temp.id('W1'), pg_temp.id('ADM'), 'admin'),
       (pg_temp.id('W1'), pg_temp.id('MBR'), 'business_developer'),
       (pg_temp.id('W2'), pg_temp.id('ADM2'), 'admin');

select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'Majuscule@preuve.test', 'viewer')$$, pg_temp.id('W1')),
	'23514', null, '22 — une adresse non normalisée est refusée');
select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'sans-arobase.preuve.test', 'viewer')$$, pg_temp.id('W1')),
	'23514', null, '23 — une adresse sans @ est refusée');
select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'role@preuve.test', 'owner')$$, pg_temp.id('W1')),
	'23514', null, '24 — un rôle hors liste est refusé');

select pg_temp.endosser(pg_temp.id('ADM'));
select lives_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'attendue@preuve.test', 'viewer')$$, pg_temp.id('W1')),
	'25 — l''administratrice inscrit une attente dans son espace');
select is(
	(select invited_by from public.workspace_invitations where email = 'attendue@preuve.test'),
	pg_temp.id('ADM'), '26 — l''auteur de l''attente est l''appelant, posé par défaut');
select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role, invited_by)
	         values (%L, 'usurpee@preuve.test', 'viewer', %L)$$, pg_temp.id('W1'), pg_temp.id('MBR')),
	'42501', null, '27 — inscrire au nom d''un autre est refusé');
select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'ailleurs@preuve.test', 'viewer')$$, pg_temp.id('W2')),
	'42501', null, '28 — inscrire dans un espace qu''on n''administre pas est refusé');
select is((select count(*)::integer from public.workspace_invitations), 1,
	'29 — l''administratrice lit les attentes de son espace, et seulement elles');
select throws_ok(
	$$update public.workspace_invitations set role = 'admin' where email = 'attendue@preuve.test'$$,
	'42501', null, '30 — changer le rôle d''une attente est refusé par privilège');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(pg_temp.id('MBR'));
select throws_ok(
	format($$insert into public.workspace_invitations (workspace_id, email, role)
	         values (%L, 'par-membre@preuve.test', 'viewer')$$, pg_temp.id('W1')),
	'42501', null, '31 — un membre non administrateur ne peut pas inscrire');
select is((select count(*)::integer from public.workspace_invitations), 0,
	'32 — un membre non administrateur ne lit aucune attente');
select is(pg_temp.lignes('delete from public.workspace_invitations'),
	0, '33 — un membre non administrateur ne retire aucune attente');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(pg_temp.id('ADM2'));
select is((select count(*)::integer from public.workspace_invitations), 0,
	'34 — l''administratrice d''un autre espace ne lit pas ces attentes');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser_role('anon');
select is((select count(*)::integer from public.workspace_invitations), 0,
	'35 — l''anonyme lit zéro ligne, sans erreur de privilège');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(pg_temp.id('ADM'));
select is(
	pg_temp.lignes($$delete from public.workspace_invitations where email = 'attendue@preuve.test'$$),
	1, '36 — l''administratrice retire une attente de son espace');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. `ouvrir_session_sso` : privilèges (§6.2)
-- =============================================================================================

select ok((select p.prosecdef from pg_proc p
	where p.oid = 'public.ouvrir_session_sso(uuid, text, text)'::regprocedure),
	'37 — SECURITY DEFINER');
select is(
	(select pg_get_userbyid(p.proowner) from pg_proc p
	  where p.oid = 'public.ouvrir_session_sso(uuid, text, text)'::regprocedure),
	'postgres', '38 — propriétaire postgres');
select is(
	(select p.proconfig from pg_proc p
	  where p.oid = 'public.ouvrir_session_sso(uuid, text, text)'::regprocedure),
	array['search_path=""'], '39 — search_path vide');
select ok(has_function_privilege('service_role', 'public.ouvrir_session_sso(uuid, text, text)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.ouvrir_session_sso(uuid, text, text)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.ouvrir_session_sso(uuid, text, text)', 'EXECUTE'),
	'40 — exécutable par la seule clé de service');

select pg_temp.endosser(pg_temp.id('MBR'));
select throws_ok(
	format($$select public.ouvrir_session_sso(%L, 'membre@preuve.test', 'X')$$, pg_temp.id('MBR')),
	'42501', null, '41 — un utilisateur ne peut pas s''ouvrir une session lui-même');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. `ouvrir_session_sso` : comportement (§6.1, §6.2)
-- =============================================================================================

insert into public.workspace_invitations (workspace_id, email, role)
values (pg_temp.id('W1'), 'camille@preuve.test', 'viewer'),
       (pg_temp.id('W2'), 'camille@preuve.test', 'admin');

select pg_temp.endosser_role('service_role');
create temporary table resultat (etape text primary key, valeur jsonb) on commit drop;
grant all on resultat to service_role;
insert into resultat
select 'premiere', public.ouvrir_session_sso(pg_temp.id('NEUF'), '  Camille@Preuve.test ', '  Camille   Aubert ');
select pg_temp.redevenir_proprietaire();

select is((select valeur from resultat where etape = 'premiere'),
	'{"admis": true, "espaces": 2, "rattachees": 2, "nom": "Camille Aubert"}'::jsonb,
	'42 — deux attentes consommées : admise, deux espaces, nom épuré');
select is(
	(select array_agg(workspace_id::text || ':' || role order by workspace_id) from public.workspace_members
	  where user_id = pg_temp.id('NEUF')),
	array[pg_temp.id('W1')::text || ':viewer', pg_temp.id('W2')::text || ':admin'],
	'43 — une appartenance par attente, au rôle choisi par l''administrateur');
select is((select count(*)::integer from public.workspace_invitations where email = 'camille@preuve.test'),
	0, '44 — les attentes sont consommées');
select is((select full_name from public.profiles where id = pg_temp.id('NEUF')), 'Camille Aubert',
	'45 — le profil naît du sub, avec le nom du SSO');

update public.profiles set full_name = 'Camille A.' where id = pg_temp.id('NEUF');
insert into public.workspace_invitations (workspace_id, email, role)
values (pg_temp.id('W1'), 'camille@preuve.test', 'admin');

select pg_temp.endosser_role('service_role');
insert into resultat
select 'seconde', public.ouvrir_session_sso(pg_temp.id('NEUF'), 'camille@preuve.test', 'Camille Aubert');
insert into resultat
select 'rejeu', public.ouvrir_session_sso(pg_temp.id('NEUF'), 'camille@preuve.test', 'Camille Aubert');
select pg_temp.redevenir_proprietaire();

select is((select valeur from resultat where etape = 'seconde'),
	'{"admis": true, "espaces": 2, "rattachees": 1, "nom": "Camille A."}'::jsonb,
	'46 — un profil existant n''est jamais réécrit par le SSO');
select is(
	(select role from public.workspace_members
	  where user_id = pg_temp.id('NEUF') and workspace_id = pg_temp.id('W1')),
	'viewer', '47 — une appartenance existante garde son rôle : une attente ne promeut pas');
select is((select valeur from resultat where etape = 'rejeu'),
	'{"admis": true, "espaces": 2, "rattachees": 0, "nom": "Camille A."}'::jsonb,
	'48 — le rejeu ne crée rien');

select pg_temp.endosser_role('service_role');
insert into resultat
select 'inconnue', public.ouvrir_session_sso(pg_temp.id('ETRANGER'), 'personne@preuve.test', 'Personne');
select pg_temp.redevenir_proprietaire();

select is((select valeur from resultat where etape = 'inconnue'),
	'{"admis": false, "espaces": 0, "rattachees": 0, "nom": null}'::jsonb,
	'49 — ni membre ni attendue : refusée');
select is((select count(*)::integer from public.profiles where id = pg_temp.id('ETRANGER')), 0,
	'50 — une personne non attendue ne laisse aucune trace');

-- Un ancien membre dont les appartenances ont été retirées garde son profil, mais n'est plus admis.
delete from public.workspace_members where user_id = pg_temp.id('MBR');
select pg_temp.endosser_role('service_role');
insert into resultat
select 'retiree', public.ouvrir_session_sso(pg_temp.id('MBR'), 'membre@preuve.test', 'Membre');
select pg_temp.redevenir_proprietaire();
select is((select valeur -> 'admis' from resultat where etape = 'retiree'), 'false'::jsonb,
	'51 — un membre retiré de tous ses espaces n''est plus admis');

-- Replis du nom.
insert into public.workspace_invitations (workspace_id, email, role)
values (pg_temp.id('W1'), 'jeanne.durand@preuve.test', 'viewer'),
       (pg_temp.id('W1'), 'long@preuve.test', 'viewer');
select pg_temp.endosser_role('service_role');
insert into resultat
select 'sans-nom', public.ouvrir_session_sso(pg_temp.id('NEUF2'), 'jeanne.durand@preuve.test', '   ');
insert into resultat
select 'long', public.ouvrir_session_sso(pg_temp.id('NEUF3'), 'long@preuve.test', repeat('a', 119) || ' b');
select pg_temp.redevenir_proprietaire();

select is((select full_name from public.profiles where id = pg_temp.id('NEUF2')), 'jeanne.durand',
	'52 — sans nom au SSO : la partie locale de l''adresse');
select is((select full_name from public.profiles where id = pg_temp.id('NEUF3')), repeat('a', 119),
	'53 — un nom trop long est borné à 120 caractères puis épuré');

select pg_temp.endosser_role('service_role');
select throws_ok(
	$$select public.ouvrir_session_sso(null, 'x@preuve.test', 'X')$$,
	'22023', 'sub_requis', '54 — un sub absent est refusé');
select throws_ok(
	format($$select public.ouvrir_session_sso(%L, 'pas-une-adresse', 'X')$$, pg_temp.id('NEUF')),
	'22023', 'adresse_invalide', '55 — une adresse invalide est refusée');
select pg_temp.redevenir_proprietaire();

-- La garde du dernier administrateur n'est jamais sollicitée par l'ouverture : elle n'insère que.
select is(
	(select count(*)::integer from public.workspace_members
	  where workspace_id = pg_temp.id('W1') and role = 'admin'),
	1, '56 — l''administratrice de W1 est toujours seule administratrice');

-- Supprimer un espace emporte ses attentes ; supprimer l'auteur d'une attente la garde.
insert into public.workspace_invitations (workspace_id, email, role, invited_by)
values (pg_temp.id('W2'), 'garde@preuve.test', 'viewer', pg_temp.id('ADM2'));
delete from public.profiles where id = pg_temp.id('NEUF');
select is(
	(select count(*)::integer from public.workspace_invitations
	  where email = 'garde@preuve.test' and invited_by = pg_temp.id('ADM2')),
	1, '57 — une attente survit à la suppression d''un autre profil');
delete from public.workspaces where id = pg_temp.id('W2');
select is((select count(*)::integer from public.workspace_invitations where email = 'garde@preuve.test'),
	0, '58 — supprimer l''espace supprime ses attentes');

select * from finish();

rollback;

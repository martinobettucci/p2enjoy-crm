-- @verifies CRM-092 (docs/BACKLOG.md) — correctif INC-249 : l'admission patiente
-- @verifies docs/SPEC-session-sso.md §6.2 (points 2 et 5), §7.6 (migration 0078), §13 (preuves INC-249)
-- @verifies docs/SPEC-identite.md §5 (la garde du dernier administrateur n'est plus sollicitée)
-- @verifies docs/JOURNAL.md décision 593 ; docs/INCONSISTENCY_REPORT.md INC-249
--
-- Avant `0078`, une personne attendue comme lectrice dans un espace vide faisait échouer TOUTE sa
-- connexion : la garde refusait la première appartenance non administratrice, dans la transaction qui
-- convertissait toutes ses attentes. Cette suite prouve la voie arbitrée : l'attente reste en suspens,
-- le reste de l'admission aboutit, et l'attente se convertit une fois l'administrateur entré.
--
-- Tout se joue dans une transaction annulée : rien ne subsiste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- E : espace vide, sans aucun membre. A : espace qui a déjà son administratrice.
create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('E',     '0c960000-0000-4000-8000-0000000000e1'),
	('E2',    '0c960000-0000-4000-8000-0000000000e2'),
	('A',     '0c960000-0000-4000-8000-0000000000a1'),
	('ADM_A', '0c960000-0000-4000-8000-000000000011'),
	('ADM_E', '0c960000-0000-4000-8000-000000000012'),
	('SOLO',  '0c960000-0000-4000-8000-000000000021'),
	('MIX',   '0c960000-0000-4000-8000-000000000022');
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('E'),  'Espace vide 0072',     'espace-vide-0072'),
	(pg_temp.id('E2'), 'Espace vide bis 0072', 'espace-vide-bis-0072'),
	(pg_temp.id('A'),  'Espace ouvert 0072',   'espace-ouvert-0072');
insert into public.profiles (id, full_name) values (pg_temp.id('ADM_A'), 'Administratrice A');
insert into public.workspace_members (workspace_id, user_id, role)
values (pg_temp.id('A'), pg_temp.id('ADM_A'), 'admin');

insert into public.workspace_invitations (workspace_id, email, role) values
	(pg_temp.id('E'),  'solo-0072@exemple.test',  'viewer'),
	(pg_temp.id('E'),  'adm-e-0072@exemple.test', 'admin'),
	(pg_temp.id('E2'), 'mix-0072@exemple.test',   'viewer'),
	(pg_temp.id('A'),  'mix-0072@exemple.test',   'business_developer');

create temporary table resultat (etape text primary key, valeur jsonb) on commit drop;

-- =============================================================================================
-- 1. Une lectrice attendue dans un espace vide, seule : en suspens, et rien ne casse
-- =============================================================================================

select lives_ok(
	$$ insert into resultat values ('solo-1',
	     public.ouvrir_session_sso(pg_temp.id('SOLO'), 'solo-0072@exemple.test', 'Solo')) $$,
	'1 — la connexion ne lève plus : la garde du dernier administrateur n''est pas sollicitée');

select is((select valeur from resultat where etape = 'solo-1'),
	'{"admis": false, "espaces": 0, "rattachees": 0, "en_suspens": 1, "nom": null}'::jsonb,
	'2 — non admise, une attente en suspens : l''échangeur en tire `attente_administrateur`');

select is((select count(*)::int from public.workspace_invitations
            where email = 'solo-0072@exemple.test' and workspace_id = pg_temp.id('E')),
	1, '3 — l''attente reste en place, avec son rôle');

select is((select count(*)::int from public.profiles where id = pg_temp.id('SOLO')),
	0, '4 — aucun profil n''est créé pour une personne que rien n''admet encore');

select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('E')),
	0, '5 — l''espace vide reste vide');

-- =============================================================================================
-- 2. L'administratrice attendue dans ce même espace vide entre, elle
-- =============================================================================================

insert into resultat values ('adm-e',
	public.ouvrir_session_sso(pg_temp.id('ADM_E'), 'adm-e-0072@exemple.test', 'Adm E'));

select is((select valeur from resultat where etape = 'adm-e'),
	'{"admis": true, "espaces": 1, "rattachees": 1, "en_suspens": 0, "nom": "Adm E"}'::jsonb,
	'6 — une attente administratrice se consomme toujours, même dans un espace vide');

select is((select role from public.workspace_members
            where workspace_id = pg_temp.id('E') and user_id = pg_temp.id('ADM_E')),
	'admin', '7 — et elle devient la première appartenance, administratrice');

-- =============================================================================================
-- 3. La lectrice se reconnecte : son attente se convertit
-- =============================================================================================

insert into resultat values ('solo-2',
	public.ouvrir_session_sso(pg_temp.id('SOLO'), 'solo-0072@exemple.test', 'Solo'));

select is((select valeur from resultat where etape = 'solo-2'),
	'{"admis": true, "espaces": 1, "rattachees": 1, "en_suspens": 0, "nom": "Solo"}'::jsonb,
	'8 — l''administratrice entrée, la connexion suivante admet la lectrice');

select is((select role from public.workspace_members
            where workspace_id = pg_temp.id('E') and user_id = pg_temp.id('SOLO')),
	'viewer', '9 — avec le rôle choisi par l''administrateur');

select is((select count(*)::int from public.workspace_invitations where email = 'solo-0072@exemple.test'),
	0, '10 — et l''attente est consommée');

-- =============================================================================================
-- 4. Attendue ailleurs aussi : elle entre là où elle peut, le reste attend
-- =============================================================================================

select lives_ok(
	$$ insert into resultat values ('mix',
	     public.ouvrir_session_sso(pg_temp.id('MIX'), 'mix-0072@exemple.test', 'Mix')) $$,
	'11 — une attente en suspens ne fait plus échouer les autres');

select is((select valeur from resultat where etape = 'mix'),
	'{"admis": true, "espaces": 1, "rattachees": 1, "en_suspens": 1, "nom": "Mix"}'::jsonb,
	'12 — admise dans l''espace ouvert, une attente en suspens dans l''espace vide');

select is((select role from public.workspace_members
            where workspace_id = pg_temp.id('A') and user_id = pg_temp.id('MIX')),
	'business_developer', '13 — membre de l''espace ouvert, au rôle attendu');

select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('E2')),
	0, '14 — l''espace vide bis reste vide');

select is((select role from public.workspace_invitations
            where email = 'mix-0072@exemple.test' and workspace_id = pg_temp.id('E2')),
	'viewer', '15 — son attente dans l''espace vide reste en place, au même rôle');

-- =============================================================================================
-- 5. Le contrat de la fonction est inchangé
-- =============================================================================================

select is(
	(select pg_get_userbyid(proowner) || '|' || prosecdef::text || '|'
	        || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || '|'
	        || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
	   from pg_proc p where p.oid = 'public.ouvrir_session_sso(uuid, text, text)'::regprocedure),
	'postgres|true|false|true',
	'16 — toujours propriété de postgres, SECURITY DEFINER, exécutable par service_role seul');

select * from finish();

rollback;

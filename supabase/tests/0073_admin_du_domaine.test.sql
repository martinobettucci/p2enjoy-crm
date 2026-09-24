-- @verifies CRM-092 (docs/BACKLOG.md) — tranche T8 : la règle du domaine sur `admin`
-- @verifies docs/SPEC-session-sso.md §6.1 bis (points 1 à 8), §7.7 (migration 0079), §5.4
--           (revendication `lelabs_admin`) ; docs/SSO.md « Les deux règles du domaine »
-- @verifies docs/SPEC-permissions-rls.md §3 ; docs/JOURNAL.md décision 597
--
-- Le porteur de la revendication `lelabs_admin: true` est membre et administrateur de TOUT espace,
-- sans une ligne dans `workspace_members` ; sans elle, il n'est rien. Les politiques suivent sans être
-- réécrites : la preuve le mesure par une lecture (`workspaces`) et par une écriture réservée à
-- l'administrateur (`tracks`). Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

create or replace function pg_temp.endosser(utilisateur uuid, admin_lelabs jsonb default null)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		(jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')
		 || case when admin_lelabs is null then '{}'::jsonb
		         else jsonb_build_object('lelabs_admin', admin_lelabs) end)::text, true);
	execute 'set local role authenticated';
end;
$$;

-- E : un espace neuf où PERSONNE n'est membre. EXPL : l'exploitante du domaine, sans aucune
-- appartenance. LECT : une lectrice de E, pour éprouver que la revendication l'emporte.
create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('E',    '0c970000-0000-4000-8000-0000000000e1'),
	('A',    '0c970000-0000-4000-8000-0000000000a1'),
	('ADM',  '0c970000-0000-4000-8000-000000000011'),
	('EXPL', '0c970000-0000-4000-8000-000000000017'),
	('LECT', '0c970000-0000-4000-8000-000000000013'),
	('NEANT','0c970000-0000-4000-8000-0000000000ff');
grant select on ids to authenticated;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('E'), 'Espace 0073', 'espace-0073'),
	(pg_temp.id('A'), 'Espace ouvert 0073', 'espace-ouvert-0073');
insert into public.profiles (id, full_name) values
	(pg_temp.id('ADM'), 'Administratrice 0073'),
	(pg_temp.id('LECT'), 'Lectrice 0073');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('A'), pg_temp.id('ADM'), 'admin'),
	(pg_temp.id('E'), pg_temp.id('ADM'), 'admin'),
	(pg_temp.id('E'), pg_temp.id('LECT'), 'viewer');

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated;

-- =============================================================================================
-- 1. La revendication, et elle seule
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('EXPL'), 'true'::jsonb);
select ok(app.est_admin_lelabs(), '1 — `lelabs_admin: true` : la revendication est lue');
select pg_temp.endosser(pg_temp.id('EXPL'));
select ok(not app.est_admin_lelabs(), '2 — revendication absente : rien');
select pg_temp.endosser(pg_temp.id('EXPL'), 'false'::jsonb);
select ok(not app.est_admin_lelabs(), '3 — `lelabs_admin: false` : rien');
select pg_temp.endosser(pg_temp.id('EXPL'), '"true"'::jsonb);
select ok(not app.est_admin_lelabs(), '4 — une CHAÎNE « true » n''est pas le booléen : mal formée, elle ne donne rien, sans lever');
reset role;

-- =============================================================================================
-- 2. Membre et administrateur de tout espace, sans une ligne
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('EXPL'), 'true'::jsonb);
select ok(app.is_workspace_member(pg_temp.id('E')) and app.is_workspace_member(pg_temp.id('A')),
	'5 — le porteur est membre des deux espaces, sans appartenance');
select ok(app.is_workspace_admin(pg_temp.id('E')) and app.is_workspace_admin(pg_temp.id('A')),
	'6 — et administrateur des deux');
select is(app.workspace_role(pg_temp.id('E')), 'admin', '7 — son rôle y est `admin`');
select ok(not app.is_workspace_member(pg_temp.id('NEANT')),
	'8 — un espace qui n''existe pas ne le devient pas par la revendication');
select is(app.workspace_role(pg_temp.id('NEANT')), null, '9 — et n''y donne aucun rôle');
insert into mesures values ('espaces_lus', (select count(*)::text from public.workspaces));
reset role;
select is((select valeur from mesures where cle = 'espaces_lus'), (select count(*)::text from public.workspaces),
	'10 — la RLS de `workspaces` suit : le porteur lit TOUS les espaces');

select pg_temp.endosser(pg_temp.id('EXPL'));
select ok(not app.is_workspace_member(pg_temp.id('E')), '11 — sans la revendication, il n''est membre de rien');
insert into mesures values ('espaces_sans', (select count(*)::text from public.workspaces));
reset role;
select is((select valeur from mesures where cle = 'espaces_sans'), '0', '12 — et ne lit aucun espace');

-- L'écriture réservée à l'administrateur : un track, dans l'espace où il n'a aucune ligne.
select pg_temp.endosser(pg_temp.id('EXPL'), 'true'::jsonb);
select lives_ok(
	$$ insert into public.tracks (workspace_id, name, slug, color, position)
	   values (pg_temp.id('E'), 'Track du domaine', 'track-domaine-0073', 'brand', 1) $$,
	'13 — l''écriture réservée à l''administrateur est ACCEPTÉE par la politique, sans appartenance');
reset role;
select pg_temp.endosser(pg_temp.id('EXPL'));
select throws_ok(
	$$ insert into public.tracks (workspace_id, name, slug, color, position)
	   values (pg_temp.id('E'), 'Track refusé', 'track-refuse-0073', 'brand', 2) $$,
	'42501', null, '14 — sans la revendication, la même écriture est REFUSÉE par la RLS');
reset role;

select is((select count(*)::int from public.workspace_members where user_id = pg_temp.id('EXPL')),
	0, '15 — aucune appartenance n''a été écrite : la règle vit dans le jeton');

-- =============================================================================================
-- 3. La revendication l'emporte sur une appartenance moindre, et ne dit rien d'un tiers
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('LECT'));
select is(app.workspace_role(pg_temp.id('E')), 'viewer', '16 — la lectrice sans revendication reste lectrice');
select pg_temp.endosser(pg_temp.id('LECT'), 'true'::jsonb);
select is(app.workspace_role(pg_temp.id('E')), 'admin', '17 — portant `admin` chez LeLabs, elle y est administratrice');
select is(public.mon_role_espace(pg_temp.id('E')), 'admin',
	'18 — `mon_role_espace` rend à l''interface le rôle que la base applique');
-- `workspace_role_pour` n'est exécutable que par les fonctions qui l'appellent : elle est éprouvée
-- sous `postgres`, la revendication toujours posée dans la transaction.
reset role;
select is(app.workspace_role_pour(pg_temp.id('E'), pg_temp.id('EXPL')), null,
	'19 — `workspace_role_pour` juge un TIERS sur ses seules appartenances, revendication posée ou non (§6.1 bis, point 6)');
select is(app.workspace_role_pour(pg_temp.id('E'), pg_temp.id('LECT')), 'admin',
	'19 bis — mais pour l''APPELANT, elle l''applique : c''est par elle que passent les droits fins');

-- LES DROITS FINS DE LECTURE SUIVENT, et c'est ce que la preuve d'interface a mesuré en premier : un
-- channel du seed, dans un espace où l'exploitante n'a aucune ligne.
select pg_temp.endosser(pg_temp.id('EXPL'), 'true'::jsonb);
select ok(app.can_read_channel('5eed0000-0000-4000-8000-000000000031'::uuid),
	'19 ter — le porteur lit un channel du seed par les droits fins, sans appartenance');
select pg_temp.endosser(pg_temp.id('EXPL'));
select ok(not app.can_read_channel('5eed0000-0000-4000-8000-000000000031'::uuid),
	'19 quater — sans la revendication, il ne le lit pas');
reset role;

-- =============================================================================================
-- 4. L'admission du porteur
-- =============================================================================================

select is(
	public.ouvrir_session_sso(pg_temp.id('EXPL'), 'exploitante-0073@exemple.test', 'Exploitante', true)
	  - 'espaces',
	'{"admis": true, "rattachees": 0, "en_suspens": 0, "nom": "Exploitante"}'::jsonb,
	'20 — le porteur est ADMIS sans appartenance ni attente');
select is((select count(*)::int from public.profiles where id = pg_temp.id('EXPL')), 1,
	'21 — et son profil est créé : il signe ce qu''il écrit');
select is(
	(public.ouvrir_session_sso(pg_temp.id('EXPL'), 'exploitante-0073@exemple.test', 'Exploitante', true) ->> 'espaces')::int,
	(select count(*)::int from public.workspaces),
	'22 — `espaces` compte tous les espaces, qu''il administre');
select is(
	public.ouvrir_session_sso(pg_temp.id('EXPL'), 'exploitante-0073@exemple.test', 'Exploitante') ->> 'admis',
	'false', '23 — sans le drapeau, la même personne n''est admise par rien : le rôle retiré ferme l''accès');

-- =============================================================================================
-- 5. Les contrats
-- =============================================================================================

select is(to_regprocedure('public.ouvrir_session_sso(uuid, text, text)'), null,
	'24 — l''ancienne signature à trois arguments est retirée par 0079');
select is(
	(select pg_get_userbyid(proowner) || '|' || prosecdef::text || '|'
	        || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || '|'
	        || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
	   from pg_proc p where p.oid = 'public.ouvrir_session_sso(uuid, text, text, boolean)'::regprocedure),
	'postgres|true|false|true',
	'25 — `ouvrir_session_sso` : postgres, SECURITY DEFINER, service_role seul');
select ok(
	has_function_privilege('authenticated', 'public.mon_role_espace(uuid)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.mon_role_espace(uuid)', 'EXECUTE')
	and not (select prosecdef from pg_proc where oid = 'public.mon_role_espace(uuid)'::regprocedure),
	'26 — `mon_role_espace` : SECURITY INVOKER, `authenticated` seul');

select * from finish();

rollback;

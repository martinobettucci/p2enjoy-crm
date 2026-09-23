-- @verifies CRM-092 (docs/BACKLOG.md) — sessions du client confidentiel, tranche T3 bis
-- @verifies docs/SPEC-session-sso.md §5.3 (prolonger, fermer), §5.6 (poignée), §7.4 (table et fonctions),
--           §13 (preuves pgTAP)
-- @verifies docs/SPEC-permissions-rls.md §3.2 ; docs/JOURNAL.md décision 586

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

create or replace function pg_temp.endosser_role(nom text)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', nom)::text, true);
	execute pg_catalog.format('set local role %I', nom);
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.empreinte(texte text) returns bytea
language sql immutable as $$ select extensions.digest(texte, 'sha256') $$;

-- W : espace de preuve, ADM son administratrice. VIS : personne attendue puis membre. NUL : sans attente.
create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W',   '0c930000-0000-4000-8000-000000000001'),
	('ADM', '0c930000-0000-4000-8000-000000000011'),
	('VIS', '0c930000-0000-4000-8000-000000000021'),
	('NUL', '0c930000-0000-4000-8000-000000000022');
grant select on ids to service_role, anon, authenticated;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table resultat (etape text primary key, valeur jsonb) on commit drop;
grant all on resultat to service_role;

-- =============================================================================================
-- 1. Structure, RLS et privilèges (§7.4)
-- =============================================================================================

select has_table('public', 'sessions_sso', '1 — la table des sessions existe');
select ok((select relrowsecurity from pg_class where oid = 'public.sessions_sso'::regclass),
	'2 — RLS activée');
select is((select count(*)::integer from pg_policy where polrelid = 'public.sessions_sso'::regclass),
	0, '3 — aucune politique : aucun rôle de l''API ne lit ni n''écrit une ligne');
select ok(not has_table_privilege('anon', 'public.sessions_sso', 'SELECT')
	and not has_table_privilege('anon', 'public.sessions_sso', 'INSERT')
	and not has_table_privilege('anon', 'public.sessions_sso', 'UPDATE')
	and not has_table_privilege('anon', 'public.sessions_sso', 'DELETE'),
	'4 — anon n''a aucun privilège');
select ok(not has_table_privilege('authenticated', 'public.sessions_sso', 'SELECT')
	and not has_table_privilege('authenticated', 'public.sessions_sso', 'INSERT')
	and not has_table_privilege('authenticated', 'public.sessions_sso', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.sessions_sso', 'DELETE'),
	'5 — authenticated n''a aucun privilège : une personne ne lit même pas ses propres sessions');
select col_is_unique('public', 'sessions_sso', 'poignee_empreinte', '6 — une empreinte désigne une seule session');
select is(
	(select c.confdeltype::text from pg_constraint c
	  where c.conrelid = 'public.sessions_sso'::regclass and c.contype = 'f'
	    and c.confrelid = 'public.profiles'::regclass),
	'c', '7 — retirer une personne ferme ses sessions');
select is(
	(select count(*)::integer from pg_proc p
	  where p.oid in ('public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz)'::regprocedure,
	                  'public.lire_session_serveur(bytea)'::regprocedure,
	                  'public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz)'::regprocedure,
	                  'public.fermer_session_serveur(bytea)'::regprocedure)
	    and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
	    and p.proconfig = array['search_path=""']),
	4, '8 — quatre fonctions SECURITY DEFINER, propriétaire postgres, search_path vide');
select ok(
	(select bool_and(has_function_privilege('service_role', f, 'EXECUTE')
	                 and not has_function_privilege('anon', f, 'EXECUTE')
	                 and not has_function_privilege('authenticated', f, 'EXECUTE'))
	   from unnest(array[
		'public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz)',
		'public.lire_session_serveur(bytea)',
		'public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz)',
		'public.fermer_session_serveur(bytea)']) as f),
	'9 — les quatre fonctions sont réservées à la clé de service');

-- Fixtures.
insert into public.workspaces (id, name, slug) values (pg_temp.id('W'), 'Preuve sessions', 'preuve-sessions');
insert into public.profiles (id, full_name) values (pg_temp.id('ADM'), 'Admin Sessions');
insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('W'), pg_temp.id('ADM'), 'admin');
insert into public.workspace_invitations (workspace_id, email, role) values (pg_temp.id('W'), 'vis@preuve.test', 'viewer');

select throws_ok(
	format($$insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
	         values (%L, '\x00'::bytea, 'x', now() + interval '1 hour')$$, pg_temp.id('ADM')),
	'23514', null, '10 — une empreinte qui n''a pas 32 octets est refusée');
select throws_ok(
	format($$insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
	         values (%L, %L, '', now() + interval '1 hour')$$, pg_temp.id('ADM'), pg_temp.empreinte('z')),
	'23514', null, '11 — un jeton vide est refusé');

-- =============================================================================================
-- 2. Refus pour les rôles de l'API (§5.6, §7.4)
-- =============================================================================================

select pg_temp.endosser_role('authenticated');
select throws_ok('select * from public.sessions_sso', '42501', null,
	'12 — authenticated ne lit pas la table : refus de privilège');
select throws_ok(format($$select public.lire_session_serveur(%L)$$, pg_temp.empreinte('a')), '42501', null,
	'13 — authenticated ne lit pas une session par la fonction');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser_role('anon');
select throws_ok('select * from public.sessions_sso', '42501', null, '14 — anon ne lit pas la table');
select throws_ok(format($$select public.fermer_session_serveur(%L)$$, pg_temp.empreinte('a')), '42501', null,
	'15 — anon ne ferme pas une session');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. Ouvrir (§5.2, point 5)
-- =============================================================================================

select pg_temp.endosser_role('service_role');
insert into resultat select 'ouvrir-attendue', public.ouvrir_session_serveur(
	pg_temp.id('VIS'), 'VIS@preuve.test', 'Vis Preuve', pg_temp.empreinte('poignee-vis'), 'chiffre-1', now() + interval '30 minutes');
insert into resultat select 'ouvrir-inconnue', public.ouvrir_session_serveur(
	pg_temp.id('NUL'), 'nul@preuve.test', 'Nul Preuve', pg_temp.empreinte('poignee-nul'), 'chiffre-n', now() + interval '30 minutes');
select pg_temp.redevenir_proprietaire();

select is((select valeur -> 'admis' from resultat where etape = 'ouvrir-attendue'), 'true'::jsonb,
	'16 — une personne attendue est admise');
select is((select valeur -> 'rattachees' from resultat where etape = 'ouvrir-attendue'), '1'::jsonb,
	'17 — son attente est consommée par la même fonction');
select is(
	(select sub from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	pg_temp.id('VIS'), '18 — sa session est enregistrée sous son sub');
select is(
	(select rafraichissement from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	'chiffre-1', '19 — le jeton est gardé tel que l''échangeur l''a chiffré');
select is((select valeur -> 'admis' from resultat where etape = 'ouvrir-inconnue'), 'false'::jsonb,
	'20 — une personne ni membre ni attendue n''est pas admise');
select is((select count(*)::integer from public.sessions_sso where sub = pg_temp.id('NUL')), 0,
	'21 — et aucune session ne lui est enregistrée');

-- =============================================================================================
-- 4. Lire (§5.3, points 1 et 2)
-- =============================================================================================

insert into public.profiles (id, full_name) values ('0c930000-0000-4000-8000-000000000031', 'Ancienne');
insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
values ('0c930000-0000-4000-8000-000000000031', pg_temp.empreinte('echue-recente'), 'x', now() - interval '1 hour'),
       ('0c930000-0000-4000-8000-000000000031', pg_temp.empreinte('echue-ancienne'), 'x', now() - interval '2 days');

select pg_temp.endosser_role('service_role');
create temporary table lu on commit drop as
	select 'valide'::text as cas, * from public.lire_session_serveur(pg_temp.empreinte('poignee-vis'))
	union all select 'inconnue', * from public.lire_session_serveur(pg_temp.empreinte('jamais-emise'))
	union all select 'echue', * from public.lire_session_serveur(pg_temp.empreinte('echue-recente'));
select pg_temp.redevenir_proprietaire();

select is((select sub from lu where cas = 'valide'), pg_temp.id('VIS'), '22 — une session valide rend son sub');
select is((select rafraichissement from lu where cas = 'valide'), 'chiffre-1', '23 — et son jeton chiffré');
select is((select count(*)::integer from lu where cas = 'inconnue'), 0, '24 — une empreinte inconnue ne rend rien');
select is((select count(*)::integer from lu where cas = 'echue'), 0, '25 — une session échue ne rend rien');
select is((select count(*)::integer from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('echue-ancienne')),
	0, '26 — une session échue depuis plus d''un jour est purgée au passage');
select is((select count(*)::integer from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('echue-recente')),
	1, '27 — une session échue depuis moins d''un jour est gardée, mais n''est plus lue');

-- =============================================================================================
-- 5. Renouveler (§5.3, points 4 et 5)
-- =============================================================================================

select pg_temp.endosser_role('service_role');
insert into resultat select 'renouveler', public.renouveler_session_serveur(
	pg_temp.empreinte('poignee-vis'), pg_temp.id('VIS'), 'vis@preuve.test', 'Vis Preuve', 'chiffre-2', now() + interval '45 minutes');
insert into resultat select 'renouveler-autre-sub', public.renouveler_session_serveur(
	pg_temp.empreinte('poignee-vis'), pg_temp.id('NUL'), 'nul@preuve.test', 'Nul', 'chiffre-x', now() + interval '1 hour');
select pg_temp.redevenir_proprietaire();

select is((select valeur -> 'admis' from resultat where etape = 'renouveler'), 'true'::jsonb,
	'28 — un membre est toujours admis au renouvellement');
select is(
	(select rafraichissement from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	'chiffre-2', '29 — le jeton est remplacé par celui que LeLabs vient de rendre');
select ok(
	(select expire_le > now() + interval '40 minutes' from public.sessions_sso
	  where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	'30 — l''échéance suit celle que LeLabs vient de rendre');
select is((select valeur from resultat where etape = 'renouveler-autre-sub'),
	'{"admis": false, "session": false}'::jsonb,
	'31 — une poignée ne renouvelle jamais la session d''une autre personne');
select is(
	(select rafraichissement from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	'chiffre-2', '32 — et la session visée est laissée intacte');

-- Appartenance retirée : le renouvellement suivant supprime la session.
delete from public.workspace_members where user_id = pg_temp.id('VIS');
select pg_temp.endosser_role('service_role');
insert into resultat select 'renouveler-retiree', public.renouveler_session_serveur(
	pg_temp.empreinte('poignee-vis'), pg_temp.id('VIS'), 'vis@preuve.test', 'Vis Preuve', 'chiffre-3', now() + interval '1 hour');
select pg_temp.redevenir_proprietaire();

select is((select valeur -> 'admis' from resultat where etape = 'renouveler-retiree'), 'false'::jsonb,
	'33 — une personne retirée de tous ses espaces n''est plus admise');
select is((select count(*)::integer from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('poignee-vis')),
	0, '34 — et sa session est supprimée');

-- =============================================================================================
-- 6. Fermer, et cascade (§5.3, §7.4)
-- =============================================================================================

insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
values (pg_temp.id('ADM'), pg_temp.empreinte('adm-1'), 'x', now() + interval '1 hour'),
       (pg_temp.id('ADM'), pg_temp.empreinte('adm-2'), 'x', now() + interval '1 hour');

select pg_temp.endosser_role('service_role');
select lives_ok(format($$select public.fermer_session_serveur(%L)$$, pg_temp.empreinte('adm-1')),
	'35 — fermer une session aboutit');
select lives_ok(format($$select public.fermer_session_serveur(%L)$$, pg_temp.empreinte('jamais-emise')),
	'36 — fermer une session inexistante n''est pas une erreur');
select pg_temp.redevenir_proprietaire();

select is((select count(*)::integer from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('adm-1')),
	0, '37 — la session fermée n''existe plus');
select is((select count(*)::integer from public.sessions_sso where poignee_empreinte = pg_temp.empreinte('adm-2')),
	1, '38 — une autre session de la même personne est intacte : fermer ne vise qu''une poignée');

-- L'espace d'abord : retirer sa seule administratrice est refusé par la garde du dernier admin.
delete from public.workspaces where id = pg_temp.id('W');
delete from public.profiles where id = pg_temp.id('ADM');
select is((select count(*)::integer from public.sessions_sso where sub = pg_temp.id('ADM')), 0,
	'39 — retirer une personne ferme toutes ses sessions');
select is((select count(*)::integer from public.sessions_sso
	where sub in (select valeur from ids)), 0,
	'40 — aucune session de preuve ne subsiste');

select * from finish();

rollback;

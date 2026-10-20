-- @verifies CRM-101 (docs/BACKLOG.md) — tranche T1 : la plateforme et son superadministrateur, en base
-- @verifies docs/SPEC-plateforme.md §2 (le drapeau n'élargit aucune politique métier), §3 (amorçage unique), §4
--           (admission révisée), §5 (tables fermées), §6 (garde, dictionnaire des refus, journal) ; docs/SCHEMA.md
--           §1 bis ; docs/SPEC-session-sso.md §6.1 (condition 3 révisée) ; CLAUDE.md §10
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : deux tables fermées (RLS sans politique, aucun privilège client), quinze fonctions de la plateforme
--    `SECURITY DEFINER` à `search_path` vide, exécutables par `authenticated` seul, et les fonctions de session
--    toujours réservées à la clé de service.
-- 2. La garde : CHAQUE fonction plateforme_* refusée en `42501` à l'anonyme, à la lectrice et à l'administratrice d'espace — un
--    pouvoir d'espace n'est pas un pouvoir de plateforme —, et ouverte au porteur de `lelabs_admin`.
-- 3. L'amorçage unique : adresse non listée, liste vide, puis l'amorçage par la vraie fonction de session serveur, qui
--    admet la personne sans appartenance ; une seconde adresse listée n'a ensuite plus d'effet.
-- 4. Les gestes d'un superadministrateur en base, chacun contre le refus qui l'encadre, et leur journal.
-- 5. Le drapeau n'ouvre aucune donnée métier : le superadministrateur sans appartenance lit zéro track.
-- 6. Le dernier superadministrateur ne se retire pas, même par un porteur d'`admin` LeLabs.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact. Elle suppose `superadmins` vide,
-- ce qui est l'état du seed (aucune connexion amorcée n'y écrit dans une base fraîchement seedée) ; si une connexion de
-- développement l'a peuplée, la suite la vide DANS SA TRANSACTION, annulée à la fin.

begin;

create extension if not exists pgtap with schema extensions;

select plan(70);

create or replace function pg_temp.endosser(utilisateur uuid, admin_domaine boolean default false)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated', 'lelabs_admin', admin_domaine)::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
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

-- Appelle les quatorze fonctions de la plateforme avec des arguments plausibles, et compte celles qui refusent par la
-- garde. Chaque appel est isolé dans son propre bloc : un refus n'arrête pas les suivants.
create or replace function pg_temp.refus_de_la_garde()
returns integer language plpgsql as $$
declare
	appels text[] := array[
		'select public.plateforme_espaces()',
		'select public.plateforme_creer_espace(''Garde'', ''garde-0084'')',
		'select public.plateforme_modifier_espace(''5eed0000-0000-4000-8000-000000000001'', ''Garde'', null)',
		'select public.plateforme_supprimer_espace(''5eed0000-0000-4000-8000-000000000001'', ''p2enjoy'')',
		'select public.plateforme_membres(''5eed0000-0000-4000-8000-000000000001'')',
		'select public.plateforme_poser_membre(''5eed0000-0000-4000-8000-000000000001'', ''5eed0000-0000-4000-8000-000000000013'', ''admin'')',
		'select public.plateforme_retirer_membre(''5eed0000-0000-4000-8000-000000000001'', ''5eed0000-0000-4000-8000-000000000013'')',
		'select public.plateforme_attentes(''5eed0000-0000-4000-8000-000000000001'')',
		'select public.plateforme_inviter(''5eed0000-0000-4000-8000-000000000001'', ''garde@exemple.test'', ''admin'')',
		'select public.plateforme_retirer_attente(''5eed0000-0000-4000-8000-000000000001'', ''garde@exemple.test'')',
		'select public.plateforme_profils()',
		'select public.plateforme_superadmins()',
		'select public.plateforme_poser_superadmin(''5eed0000-0000-4000-8000-000000000013'', true)',
		'select public.plateforme_journal_liste()'
	];
	appel text;
	refus integer := 0;
begin
	foreach appel in array appels loop
		begin
			execute appel;
		exception
			when insufficient_privilege then
				if sqlerrm in ('reserve_aux_superadministrateurs')
				   or sqlerrm like 'permission denied for function%' then
					refus := refus + 1;
				end if;
		end;
	end loop;
	return refus;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Profils du seed : Camille …011 administratrice de « p2enjoy » (…001), Driss …012 business developer,
-- Farida …013 lectrice. Fixtures de la suite : Sabine …a0890001 (inconnue du CRM avant son amorçage), Xavier
-- …a0890002 (profil sans appartenance, jamais superadministrateur).
-- ---------------------------------------------------------------------------------------------

delete from public.superadmins;
insert into public.profiles (id, full_name) values ('a0890000-0000-4000-8000-000000000002', 'Xavier Témoin');

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_table('public', 'superadmins', 'la table des superadministrateurs existe');
select has_table('public', 'plateforme_journal', 'le journal de la plateforme existe');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_class
	  where oid in ('public.superadmins'::regclass, 'public.plateforme_journal'::regclass) and relrowsecurity),
	2, 'la RLS est activée sur les deux tables');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_policies
	  where schemaname = 'public' and tablename in ('superadmins', 'plateforme_journal')),
	0, 'aucune politique : personne ne lit ni n''écrit ces tables par l''API');

select ok(
	not has_table_privilege('authenticated', 'public.superadmins', 'select')
	and not has_table_privilege('anon', 'public.superadmins', 'select')
	and not has_table_privilege('authenticated', 'public.superadmins', 'insert')
	and not has_table_privilege('authenticated', 'public.plateforme_journal', 'select')
	and not has_table_privilege('anon', 'public.plateforme_journal', 'select')
	and not has_table_privilege('authenticated', 'public.plateforme_journal', 'insert'),
	'aucun privilège client sur les deux tables, retiré nommément');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_proc p
	  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname like 'plateforme\_%'
	   and p.prosecdef and p.proconfig @> array['search_path=""']),
	14, 'les quatorze fonctions plateforme_* sont SECURITY DEFINER à search_path vide');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_proc p
	  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and (p.proname like 'plateforme\_%' or p.proname = 'est_superadmin')
	   and has_function_privilege('authenticated', p.oid, 'execute')
	   and not has_function_privilege('anon', p.oid, 'execute')),
	15, 'les quinze fonctions sont exécutables par authenticated, jamais par anon');

select ok(
	not has_function_privilege('authenticated',
		'public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean, text[])', 'execute')
	and has_function_privilege('service_role',
		'public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean, text[])', 'execute')
	and not has_function_privilege('authenticated',
		'public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean, text[])', 'execute'),
	'les fonctions de session serveur restent réservées à la clé de service');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_proc p
	  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname in ('ouvrir_session_serveur', 'renouveler_session_serveur')),
	2, 'les anciennes signatures des fonctions de session serveur sont retirées');

select ok(
	not has_function_privilege('authenticated', 'app.amorcer_superadmin(uuid, text, text, text[])', 'execute')
	and not has_function_privilege('service_role', 'app.amorcer_superadmin(uuid, text, text, text[])', 'execute'),
	'l''amorçage n''est appelable par aucun rôle client : seules les fonctions de session et du registre l''emploient');

-- =============================================================================================
-- 2. La garde
-- =============================================================================================

select pg_temp.anonyme();
select is(pg_temp.refus_de_la_garde(), 14, 'l''anonyme est refusé par les quatorze fonctions');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.refus_de_la_garde(), 14, 'la lectrice est refusée par les quatorze fonctions');
select is(public.est_superadmin(), false, 'est_superadmin() est faux pour la lectrice');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.refus_de_la_garde(), 14,
	'l''administratrice d''espace est refusée par les quatorze fonctions : un pouvoir d''espace n''est pas de plateforme');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select is(public.est_superadmin(), true, 'le porteur de lelabs_admin est superadministrateur');
select ok((select pg_catalog.count(*) from public.plateforme_espaces()) >= 1,
	'le porteur de lelabs_admin lit la liste des espaces');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. L'amorçage unique et l'admission révisée
-- =============================================================================================

select is(app.amorcer_superadmin('a0890000-0000-4000-8000-000000000001', 'sabine@exemple.test', 'Sabine',
	array['autre@exemple.test']), false, 'une adresse non listée n''amorce rien');
select is(app.amorcer_superadmin('a0890000-0000-4000-8000-000000000001', 'sabine@exemple.test', 'Sabine',
	'{}'::text[]), false, 'une liste vide n''amorce rien');
select is((select pg_catalog.count(*)::integer from public.profiles where id = 'a0890000-0000-4000-8000-000000000001'),
	0, 'un amorçage refusé ne crée aucun profil');

select is(
	(public.ouvrir_session_sso('a0890000-0000-4000-8000-000000000001', 'sabine@exemple.test', 'Sabine')) ->> 'admis',
	'false', 'avant l''amorçage, une personne sans appartenance ni attente n''est pas admise');

select is(
	(public.ouvrir_session_serveur('a0890000-0000-4000-8000-000000000001', '  Sabine@Exemple.TEST ', 'Sabine  Plateforme',
		sha256('poignee-0084'::bytea), 'v1.x.y', now() + interval '1 hour', false,
		array['autre@exemple.test', ' sabine@exemple.test '])) ->> 'admis',
	'true', 'la session serveur amorce l''adresse listée (casse et espaces ignorés) et admet sans appartenance');
select is((select pg_catalog.count(*)::integer from public.superadmins), 1, 'une seule ligne de superadministrateur');
select is((select full_name from public.profiles where id = 'a0890000-0000-4000-8000-000000000001'),
	'Sabine Plateforme', 'le profil est créé à l''amorçage, nom épuré');
select is((select pg_catalog.count(*)::integer from public.sessions_sso
	        where sub = 'a0890000-0000-4000-8000-000000000001'), 1, 'la session serveur est enregistrée');
select is((select geste || ':' || coalesce(acteur::text, 'null') from public.plateforme_journal
	        order by id desc limit 1), 'superadmin_amorce:null', 'l''amorçage est journalisé, sans acteur');

select is(app.amorcer_superadmin('a0890000-0000-4000-8000-000000000002', 'xavier@exemple.test', 'Xavier',
	array['xavier@exemple.test']), false, 'une fois amorcé, une seconde adresse listée n''a plus d''effet');
select is((select pg_catalog.count(*)::integer from public.superadmins), 1, 'toujours une seule ligne');
select is(
	(public.ouvrir_session_sso('a0890000-0000-4000-8000-000000000002', 'xavier@exemple.test', 'Xavier')) ->> 'admis',
	'false', 'un profil sans appartenance et sans drapeau reste non admis');

-- =============================================================================================
-- 4. Les gestes d'un superadministrateur en base
-- =============================================================================================

select pg_temp.endosser('a0890000-0000-4000-8000-000000000001');
select is(public.est_superadmin(), true, 'le superadministrateur en base est reconnu sans revendication');

-- Espaces
select throws_ok($$select public.plateforme_creer_espace('Suite', 'Bad_Slug')$$, '22023', 'identifiant_invalide',
	'un slug hors forme est refusé');
select throws_ok($$select public.plateforme_creer_espace('Suite', 'a')$$, '22023', 'identifiant_invalide',
	'un slug d''un caractère est refusé');
select throws_ok($$select public.plateforme_creer_espace('Suite', 'p2enjoy')$$, '23505', 'identifiant_pris',
	'un slug déjà employé est refusé');
select throws_ok($$select public.plateforme_creer_espace('   ', 'suite-0084')$$, '22023', 'nom_invalide',
	'un nom vide est refusé');
select throws_ok($$select public.plateforme_creer_espace('Suite', 'suite-0084', 'pas un domaine')$$, '22023',
	'domaine_invalide', 'un domaine entrant mal formé est refusé');

create temporary table espace_suite (id uuid) on commit drop;
grant all on espace_suite to authenticated;
insert into espace_suite
select public.plateforme_creer_espace('  Espace   de la suite ', 'suite-0084', ' Crm.Suite-0084.TEST ');
-- Relu par la plateforme, et non par la table : sans appartenance, la RLS de `workspaces` cache l'espace au
-- superadministrateur en base (§2) — le test 5 ci-dessous le prouve pour les tracks.
select is((select nom || '|' || slug || '|' || domaine_entrant from public.plateforme_espaces()
	        where id = (select id from espace_suite)),
	'Espace de la suite|suite-0084|crm.suite-0084.test', 'l''espace est créé, nom et domaine normalisés');

select lives_ok($$select public.plateforme_modifier_espace((select id from espace_suite), 'Espace renommé', null)$$,
	'l''espace se renomme et perd son domaine');
select is((select nom || '|' || slug || '|' || coalesce(domaine_entrant, 'null') from public.plateforme_espaces()
	        where id = (select id from espace_suite)),
	'Espace renommé|suite-0084|null', 'le slug ne change pas');
select throws_ok($$select public.plateforme_modifier_espace('00000000-0000-4000-8000-0000000000ff', 'X', null)$$,
	'P0002', 'espace_introuvable', 'un espace inexistant est introuvable');

-- Appartenances
select throws_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000012', 'viewer')$$, '23514', 'last_workspace_admin',
	'le premier membre d''un espace doit être administrateur : l''invariant existant remonte tel quel');
select throws_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000012', 'owner')$$, '22023', 'role_invalide', 'un rôle hors liste est refusé');
select throws_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'00000000-0000-4000-8000-0000000000ff', 'admin')$$, 'P0002', 'profil_introuvable',
	'une personne sans profil ne devient pas membre');
select lives_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000012', 'admin')$$, 'Driss devient administrateur du nouvel espace');
select lives_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000013', 'viewer')$$, 'Farida devient lectrice');
select lives_ok($$select public.plateforme_poser_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000013', 'business_developer')$$, 'le rôle de Farida change');
select is(
	(select string_agg(nom || ':' || role, ',' order by nom) from public.plateforme_membres((select id from espace_suite))),
	'Driss Lemoine:admin,Farida Nowak:business_developer', 'les membres et leurs rôles sont relus');
select throws_ok($$select public.plateforme_retirer_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000012')$$, '23514', 'last_workspace_admin',
	'le dernier administrateur ne se retire pas');

-- Un droit fin de Farida dans l'espace part avec son appartenance.
select pg_temp.redevenir_proprietaire();
insert into public.tracks (id, workspace_id, name, slug)
values ('a0890000-0000-4000-8000-0000000000a1', (select id from espace_suite), 'Track 0084', 'track-0084');
insert into public.track_members (track_id, user_id, access)
values ('a0890000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000013', 'viewer');
select pg_temp.endosser('a0890000-0000-4000-8000-000000000001');
select lives_ok($$select public.plateforme_retirer_membre((select id from espace_suite),
	'5eed0000-0000-4000-8000-000000000013')$$, 'Farida est retirée de l''espace');
select pg_temp.redevenir_proprietaire();
select is((select pg_catalog.count(*)::integer from public.track_members
	        where track_id = 'a0890000-0000-4000-8000-0000000000a1'), 0,
	'son droit fin dans l''espace est retiré avec l''appartenance');
select is((select pg_catalog.count(*)::integer from public.workspace_members
	        where user_id = '5eed0000-0000-4000-8000-000000000013'), 1,
	'son appartenance à « p2enjoy » n''est pas touchée');
select pg_temp.endosser('a0890000-0000-4000-8000-000000000001');

-- Attentes
select lives_ok($$select public.plateforme_inviter((select id from espace_suite), ' Nouvelle@Exemple.TEST ', 'viewer')$$,
	'une attente est inscrite');
select lives_ok($$select public.plateforme_inviter((select id from espace_suite), 'nouvelle@exemple.test', 'admin')$$,
	'la même adresse est réinscrite avec un autre rôle');
select is(
	(select string_agg(email || ':' || role || ':' || invite_par, ',')
	   from public.plateforme_attentes((select id from espace_suite))),
	'nouvelle@exemple.test:admin:Sabine Plateforme', 'une seule attente, remplacée, signée par son auteur');
select throws_ok($$select public.plateforme_inviter((select id from espace_suite), 'pas-une-adresse', 'viewer')$$,
	'22023', 'adresse_invalide', 'une adresse mal formée est refusée');
select lives_ok($$select public.plateforme_retirer_attente((select id from espace_suite), 'NOUVELLE@exemple.test')$$,
	'l''attente est retirée');
select is((select pg_catalog.count(*)::integer from public.plateforme_attentes((select id from espace_suite))), 0,
	'aucune attente ne reste');

-- Personnes
select is((select string_agg(nom, ',') from public.plateforme_profils('CAMILLÉ')), 'Camille Aubert',
	'la recherche de personnes ignore casse et accents');
select is((select pg_catalog.count(*)::integer from public.plateforme_profils('%')), 0,
	'un métacaractère saisi est cherché littéralement');

-- =============================================================================================
-- 5. Le drapeau n'ouvre aucune donnée métier
-- =============================================================================================

select is((select pg_catalog.count(*)::integer from public.tracks
	        where workspace_id = '5eed0000-0000-4000-8000-000000000001'), 0,
	'le superadministrateur en base sans appartenance ne lit aucun track de « p2enjoy »');

-- =============================================================================================
-- 6. Superadministrateurs, suppression d'un espace, journal
-- =============================================================================================

select lives_ok($$select public.plateforme_poser_superadmin('5eed0000-0000-4000-8000-000000000011', true)$$,
	'Sabine accorde le drapeau à Camille');
select is((select string_agg(nom || '<' || coalesce(accorde_par_nom, '-'), ',' order by nom)
	         from public.plateforme_superadmins()),
	'Camille Aubert<Sabine Plateforme,Sabine Plateforme<-', 'les deux superadministrateurs, et qui a accordé');

select throws_ok($$select public.plateforme_supprimer_espace((select id from espace_suite), 'autre')$$, '22023',
	'confirmation_incorrecte', 'la suppression exige le slug exact');
select lives_ok($$select public.plateforme_supprimer_espace((select id from espace_suite), 'suite-0084')$$,
	'l''espace est supprimé, track compris');
select is((select pg_catalog.count(*)::integer from public.workspaces where slug = 'suite-0084'), 0,
	'l''espace n''existe plus');

select is(
	(select string_agg(geste, ',' order by id desc) from public.plateforme_journal_liste(null, 200)
	  where geste <> 'superadmin_amorce'),
	'espace_supprime,superadmin_accorde,attente_retiree,attente_inscrite,attente_inscrite,membre_retire,membre_pose,membre_pose,membre_pose,espace_modifie,espace_cree',
	'chaque geste est journalisé, le plus récent d''abord');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$select public.plateforme_poser_superadmin('a0890000-0000-4000-8000-000000000001', false)$$,
	'Camille retire le drapeau de Sabine');
select throws_ok($$select public.plateforme_poser_superadmin('5eed0000-0000-4000-8000-000000000011', false)$$, 'P0001',
	'dernier_superadministrateur', 'le dernier superadministrateur en base ne se retire pas');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select throws_ok($$select public.plateforme_poser_superadmin('5eed0000-0000-4000-8000-000000000011', false)$$, 'P0001',
	'dernier_superadministrateur', 'pas même par un porteur d''admin LeLabs');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('a0890000-0000-4000-8000-000000000001');
select is(public.est_superadmin(), false, 'le retrait agit à l''appel suivant');
select pg_temp.redevenir_proprietaire();

select is(
	(public.renouveler_session_serveur(sha256('poignee-0084'::bytea), 'a0890000-0000-4000-8000-000000000001',
		'sabine@exemple.test', 'Sabine', 'v1.z.w', now() + interval '1 hour', false,
		array['sabine@exemple.test'])) ->> 'admis',
	'false', 'au renouvellement, la personne sans drapeau ni appartenance n''est plus admise, liste ou non');
select is((select pg_catalog.count(*)::integer from public.sessions_sso
	        where sub = 'a0890000-0000-4000-8000-000000000001'), 0, 'et sa session serveur est supprimée');

select * from finish();
rollback;

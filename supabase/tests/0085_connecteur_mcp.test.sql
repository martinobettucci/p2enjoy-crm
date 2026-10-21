-- @verifies CRM-102 (docs/BACKLOG.md) — tranche T1 : le registre du connecteur MCP, en base
-- @verifies docs/SPEC-mcp.md §6.1 (familles et actions fermées), §6.3 (`mcp_autorise` : superadministrateur, porteur de
--           `lelabs_admin`, case de la matrice ; `22023` pour une famille ou une action inconnue), §7.1 (trois tables
--           fermées, cascades), §7.2 (inscription, amorçage), §7.3 (RPC réservées à la clé de service) ;
--           docs/SCHEMA.md §9 quinquies ; docs/SPEC-plateforme.md §3 (amorçage unique) ; CLAUDE.md §10
-- @verifies CRM-103 (docs/BACKLOG.md) — tranche T1 : docs/SPEC-mcp.md §8.2 (les quatre fonctions d'administration :
--           garde, liste, fiche d'un utilisateur venu ou non au connecteur, matrice remplacée sur profil exigé,
--           validation fermée, journal sans doublon, journal des appels) ; D9 (le droit vise le profil) ; A5
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : trois tables fermées, quatre fonctions `SECURITY DEFINER` à `search_path` vide ; `mcp_autorise` pour
--    `authenticated` seul, les trois RPC du registre pour `service_role` seul.
-- 2. La garde : les RPC du registre refusées en `42501` à l'anonyme et à une personne connectée ; `mcp_autorise` refusée
--    à l'anonyme.
-- 3. `mcp_autorise` sous le jeton de la personne : la case ouvre son espace, sa famille, son action, et rien d'autre.
-- 4. L'inscription : normalisation, relève de l'adresse et de l'activité, amorçage unique, drapeau LeLabs.
-- 5. L'état d'un compte et le journal.
-- 6. Les cascades et les `check` fermés ; depuis `CRM-103` (D9), le droit suit le PROFIL, et non le compte du connecteur.
-- 7. L'administration du connecteur (`CRM-103` T1), jouée AVANT la section 6, qui retire le compte de Driss.
--
-- La suite pose ses propres fixtures et fait `rollback`. Elle vide `superadmins` DANS SA TRANSACTION pour éprouver
-- l'amorçage (le seed y inscrit Sabine Plateforme, docs/SPEC-seed.md §19). Elle tient sur un registre DÉJÀ VIVANT : les
-- preuves d'intégration y inscrivent des comptes et y écrivent le journal — elle tolère un compte présent, efface dans sa
-- transaction les droits de ses deux comptes, et ne lit que les lignes de journal nées après son point de départ.

begin;

create extension if not exists pgtap with schema extensions;

select plan(79);

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

create or replace function pg_temp.service()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
	execute 'set local role service_role';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Fixtures : l'espace du seed (…0001), un second espace, Driss (…0012) et Farida (…0013) du seed, et deux comptes du
-- connecteur sans profil.
delete from public.superadmins;
create temporary table depart_mcp_journal on commit drop as
	select coalesce(max(id), 0) as id from public.mcp_journal;
insert into public.workspaces (id, name, slug) values ('a0900000-0000-4000-8000-0000000000b0', 'Second 0085', 'second-0085');
insert into public.mcp_comptes (sub, email, nom) values
	('5eed0000-0000-4000-8000-000000000012', 'driss@exemple.test', 'Driss'),
	('5eed0000-0000-4000-8000-000000000013', 'farida@exemple.test', 'Farida')
on conflict (sub) do nothing;
delete from public.mcp_droits
 where sub in ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000013');
insert into public.mcp_droits (sub, workspace_id, famille, action) values
	('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'affaires', 'consulter');

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_table('public', 'mcp_comptes', 'la table des comptes du connecteur existe');
select has_table('public', 'mcp_droits', 'la table de la matrice existe');
select has_table('public', 'mcp_journal', 'le journal des appels existe');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_class
	  where oid in ('public.mcp_comptes'::regclass, 'public.mcp_droits'::regclass, 'public.mcp_journal'::regclass)
	    and relrowsecurity),
	3, 'la RLS est activée sur les trois tables');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_policies
	  where schemaname = 'public' and tablename in ('mcp_comptes', 'mcp_droits', 'mcp_journal')),
	0, 'aucune politique : personne ne lit ni n''écrit ces tables par l''API');

select is(
	(select pg_catalog.count(*)::integer
	   from (values ('public.mcp_comptes'), ('public.mcp_droits'), ('public.mcp_journal')) t (nom),
	        (values ('anon'), ('authenticated')) r (role),
	        (values ('select'), ('insert'), ('update'), ('delete')) p (privilege)
	  where has_table_privilege(r.role, t.nom, p.privilege)),
	0, 'aucun privilège client sur les trois tables, retiré nommément');

select is(
	(select pg_catalog.count(*)::integer from pg_catalog.pg_proc p
	  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname like 'mcp\_%'
	   and p.prosecdef and p.proconfig @> array['search_path=""']),
	8, 'les huit fonctions mcp_* — quatre du registre, quatre de l''administration (CRM-103) — sont SECURITY DEFINER à search_path vide');

select ok(
	has_function_privilege('authenticated', 'public.mcp_autorise(uuid, text, text)', 'execute')
	and not has_function_privilege('anon', 'public.mcp_autorise(uuid, text, text)', 'execute')
	and not has_function_privilege('service_role', 'public.mcp_autorise(uuid, text, text)', 'execute'),
	'mcp_autorise est exécutable par authenticated seul');

select is(
	(select pg_catalog.count(*)::integer
	   from (values ('public.mcp_inscrire_compte(uuid, text, text, text[], boolean)'),
	                ('public.mcp_etat_compte(uuid, boolean)'),
	                ('public.mcp_journaliser(uuid, text, uuid, text, integer)')) f (signature)
	  where has_function_privilege('service_role', f.signature, 'execute')
	    and not has_function_privilege('authenticated', f.signature, 'execute')
	    and not has_function_privilege('anon', f.signature, 'execute')),
	3, 'les trois RPC du registre sont exécutables par service_role seul');

-- =============================================================================================
-- 2. La garde
-- =============================================================================================

select pg_temp.anonyme();
select throws_ok($$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'affaires', 'consulter')$$,
	'42501', null, 'l''anonyme ne peut pas appeler mcp_autorise');
select throws_ok($$select public.mcp_etat_compte('5eed0000-0000-4000-8000-000000000012', false)$$,
	'42501', null, 'l''anonyme ne lit pas l''état d''un compte');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$select public.mcp_inscrire_compte('5eed0000-0000-4000-8000-000000000012', 'driss@exemple.test', 'Driss', array['driss@exemple.test'], true)$$,
	'42501', null, 'une personne connectée ne s''inscrit pas elle-même, ni ne s''amorce');
select throws_ok($$select public.mcp_etat_compte('5eed0000-0000-4000-8000-000000000013', false)$$,
	'42501', null, 'une personne connectée ne lit pas la matrice d''une autre');
select throws_ok($$select public.mcp_journaliser('5eed0000-0000-4000-8000-000000000012', 'faux', null, 'ok', 1)$$,
	'42501', null, 'une personne connectée n''écrit pas au journal');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. mcp_autorise, sous le jeton de la personne
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'affaires', 'consulter'), true,
	'la case posée ouvre son espace, sa famille et son action');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'affaires', 'ajouter'), false,
	'une autre action de la même famille reste fermée');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'contacts', 'consulter'), false,
	'une autre famille reste fermée');
select is(public.mcp_autorise('a0900000-0000-4000-8000-0000000000b0', 'affaires', 'consulter'), false,
	'un autre espace reste fermé');
select throws_ok($$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'finances', 'consulter')$$,
	'22023', 'famille_inconnue', 'une famille hors liste lève 22023, jamais false');
select throws_ok($$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'affaires', 'purger')$$,
	'22023', 'action_inconnue', 'une action hors liste lève 22023, jamais false');
select throws_ok($$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', null, 'consulter')$$,
	'22023', 'famille_inconnue', 'une famille absente lève 22023');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'affaires', 'consulter'), false,
	'la case de Driss n''ouvre rien à Farida : la matrice est personnelle');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select is(public.mcp_autorise('a0900000-0000-4000-8000-0000000000b0', 'budgets', 'supprimer'), true,
	'le porteur de lelabs_admin franchit la matrice');
select pg_temp.redevenir_proprietaire();

insert into public.superadmins (sub) values ('5eed0000-0000-4000-8000-000000000013');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(public.mcp_autorise('a0900000-0000-4000-8000-0000000000b0', 'temps', 'ajouter'), true,
	'le superadministrateur en base franchit la matrice');
select pg_temp.redevenir_proprietaire();
delete from public.superadmins;

-- =============================================================================================
-- 4. L'inscription
-- =============================================================================================

select pg_temp.service();
select is(
	public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c1', '  Noa@Exemple.TEST ', '  Noa   Martin ', '{}', false),
	'{"superadmin": false, "droits": 0}'::jsonb,
	'un compte sans drapeau ni droit est inscrit et le dit');
select pg_temp.redevenir_proprietaire();
select is(
	(select row(email, nom)::text from public.mcp_comptes where sub = 'a0900000-0000-4000-8000-0000000000c1'),
	row('noa@exemple.test', 'Noa Martin')::text,
	'l''adresse est normalisée et le nom resserré');
select is(
	(select pg_catalog.count(*)::integer from public.profiles where id = 'a0900000-0000-4000-8000-0000000000c1'),
	0, 'l''inscription seule ne crée pas de profil : un compte du connecteur n''en a pas forcément');

update public.mcp_comptes set premiere_connexion = '2026-01-01', derniere_activite = '2026-01-02'
 where sub = 'a0900000-0000-4000-8000-0000000000c1';
select pg_temp.service();
select lives_ok(
	$$select public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c1', 'noa.martin@exemple.test', 'Noa M.', '{}', false)$$,
	'une seconde inscription relève le compte');
select pg_temp.redevenir_proprietaire();
select is(
	(select row(email, nom, premiere_connexion = '2026-01-01'::timestamptz, derniere_activite = pg_catalog.now())::text
	   from public.mcp_comptes where sub = 'a0900000-0000-4000-8000-0000000000c1'),
	row('noa.martin@exemple.test', 'Noa M.', true, true)::text,
	'l''adresse, le nom et la dernière activité sont relevés ; la première connexion est gardée');

select pg_temp.service();
select is(
	(public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c2', 'sans.nom@exemple.test', '   ', '{}', false))->'superadmin',
	'false'::jsonb, 'un nom vide est accepté');
select pg_temp.redevenir_proprietaire();
select is((select nom from public.mcp_comptes where sub = 'a0900000-0000-4000-8000-0000000000c2'), 'sans.nom',
	'un nom vide prend la partie locale de l''adresse, comme le profil');

select pg_temp.service();
select throws_ok($$select public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c3', 'pas-une-adresse', 'X', '{}', false)$$,
	'22023', 'adresse_invalide', 'une adresse mal formée est refusée');
select throws_ok($$select public.mcp_inscrire_compte(null, 'x@exemple.test', 'X', '{}', false)$$,
	'22023', 'sub_requis', 'un sujet absent est refusé');
select is(
	(public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c4', 'ops@exemple.test', 'Ops', '{}', true))->'superadmin',
	'true'::jsonb, 'le drapeau LeLabs du jeton vérifié vaut superadministrateur');
select pg_temp.redevenir_proprietaire();
select is((select pg_catalog.count(*)::integer from public.superadmins), 0,
	'le drapeau LeLabs n''inscrit personne à superadmins');

-- L'amorçage : la première adresse listée et vérifiée qui se connecte, tant que superadmins est vide.
select pg_temp.service();
select is(
	(public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c5', 'Resp@Exemple.test', 'Resp Onsable',
		array['resp@exemple.test', 'second@exemple.test'], false))->'superadmin',
	'true'::jsonb, 'la première connexion listée amorce le superadministrateur');
select pg_temp.redevenir_proprietaire();
select is(
	(select row(s.sub, p.full_name)::text from public.superadmins s join public.profiles p on p.id = s.sub),
	row('a0900000-0000-4000-8000-0000000000c5'::uuid, 'Resp Onsable')::text,
	'l''amorçage inscrit le drapeau et crée le profil qui manquait');
select pg_temp.service();
select is(
	(public.mcp_inscrire_compte('a0900000-0000-4000-8000-0000000000c6', 'second@exemple.test', 'Second',
		array['resp@exemple.test', 'second@exemple.test'], false))->'superadmin',
	'false'::jsonb, 'une seconde adresse listée n''a plus d''effet : un superadministrateur existe');
select pg_temp.redevenir_proprietaire();
select is((select pg_catalog.count(*)::integer from public.superadmins), 1, 'un seul superadministrateur amorcé');

-- =============================================================================================
-- 5. L'état d'un compte et le journal
-- =============================================================================================

select pg_temp.service();
select is(
	public.mcp_etat_compte('5eed0000-0000-4000-8000-000000000012', false),
	'{"superadmin": false, "droits": [{"workspace_id": "5eed0000-0000-4000-8000-000000000001", "famille": "affaires", "action": "consulter"}]}'::jsonb,
	'l''état rend le drapeau et la matrice du compte');
select is(
	public.mcp_etat_compte('a0900000-0000-4000-8000-0000000000ff', false),
	'{"superadmin": false, "droits": []}'::jsonb,
	'un compte inconnu n''a ni drapeau ni droit');
select is(
	(public.mcp_etat_compte('a0900000-0000-4000-8000-0000000000c5', false))->'superadmin',
	'true'::jsonb, 'l''état lit le drapeau en base');
select lives_ok(
	$$select public.mcp_journaliser('5eed0000-0000-4000-8000-000000000012', 'crm_workspace_list', null, 'ok', -5)$$,
	'le service écrit une ligne au journal');
select throws_ok(
	$$select public.mcp_journaliser('5eed0000-0000-4000-8000-000000000012', 'crm_workspace_list', null, 'peut-etre', 3)$$,
	'23514', null, 'une issue hors liste est refusée');
select pg_temp.redevenir_proprietaire();
select is(
	(select row(outil, workspace_id, issue, duree_ms)::text from public.mcp_journal
	  where sub = '5eed0000-0000-4000-8000-000000000012' order by id desc limit 1),
	row('crm_workspace_list', null::uuid, 'ok', 0)::text,
	'la ligne porte l''outil, l''espace, l''issue et une durée jamais négative');

-- =============================================================================================
-- 7. L'administration du connecteur — `CRM-103` T1, docs/SPEC-mcp.md §8.2 (A5, D9)
-- =============================================================================================
-- Fixtures de la section : Yannick (…a0940001), un profil jamais venu au connecteur ; un compte du connecteur sans
-- profil (…a0940002). Le superadministrateur est Camille porteuse du rôle `admin` LeLabs.

insert into public.profiles (id, full_name) values ('a0940000-0000-4000-8000-000000000001', 'Yannick Témoin');
insert into public.mcp_comptes (sub, email, nom) values ('a0940000-0000-4000-8000-000000000002', 'sans-profil@exemple.test', 'Sans Profil');
create temporary table depart_plateforme_journal on commit drop as
	select coalesce(max(id), 0) as id from public.plateforme_journal;
create temporary table nb_espaces on commit drop as select pg_catalog.count(*)::integer as n from public.workspaces;
grant select on nb_espaces, depart_mcp_journal to authenticated;

create or replace function pg_temp.refus_administration()
returns integer language plpgsql as $$
declare
	appels text[] := array[
		'select public.mcp_comptes_liste()',
		'select public.mcp_compte(''5eed0000-0000-4000-8000-000000000012'')',
		'select public.mcp_poser_droits(''5eed0000-0000-4000-8000-000000000012'', ''5eed0000-0000-4000-8000-000000000001'', ''[]'')',
		'select public.mcp_journal_liste()'
	];
	appel text;
	refus integer := 0;
begin
	foreach appel in array appels loop
		begin
			execute appel;
		exception
			when insufficient_privilege then refus := refus + 1;
		end;
	end loop;
	return refus;
end;
$$;

select is(
	(select pg_catalog.count(*)::integer
	   from (values ('public.mcp_comptes_liste(integer)'), ('public.mcp_compte(uuid)'),
	                ('public.mcp_poser_droits(uuid, uuid, jsonb)'), ('public.mcp_journal_liste(uuid, text, bigint, integer)')) f (signature)
	  where has_function_privilege('authenticated', f.signature, 'execute')
	    and not has_function_privilege('anon', f.signature, 'execute')),
	4, 'les quatre fonctions d''administration sont exécutables par authenticated, jamais par anon');

select pg_temp.anonyme();
select is(pg_temp.refus_administration(), 4, 'l''anonyme est refusé par les quatre fonctions d''administration');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.refus_administration(), 4, 'la lectrice est refusée par les quatre fonctions d''administration');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.refus_administration(), 4,
	'l''administratrice d''espace est refusée : un pouvoir d''espace n''est pas un pouvoir de plateforme');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011', true);
select ok(
	(select avec_profil and espaces_ouverts = 1 and nom = 'Driss Lemoine'
	   from public.mcp_comptes_liste() where sub = '5eed0000-0000-4000-8000-000000000012'),
	'Driss, venu au connecteur, est listé sous le nom de son profil, avec un espace ouvert');
select ok(
	(select not avec_profil and nom = 'Sans Profil' and email = 'sans-profil@exemple.test'
	   from public.mcp_comptes_liste() where sub = 'a0940000-0000-4000-8000-000000000002'),
	'un compte du connecteur sans profil est listé, et le dit');

select ok(
	(select (f ->> 'avec_profil')::boolean and not (f ->> 'connecte')::boolean
	        and f -> 'derniere_activite' = 'null'::jsonb and f -> 'email' = 'null'::jsonb and f ->> 'nom' = 'Yannick Témoin'
	        and pg_catalog.jsonb_array_length(f -> 'espaces') = (select n from nb_espaces)
	        and not exists (select 1 from pg_catalog.jsonb_array_elements(f -> 'espaces') e
	                         where e.value -> 'role' <> 'null'::jsonb or e.value -> 'droits' <> '[]'::jsonb)
	   from (select public.mcp_compte('a0940000-0000-4000-8000-000000000001') as f) x),
	'la fiche d''un profil jamais venu au connecteur porte tous les espaces, sans rôle, sans droit ni date (A5)');
select ok(
	(select (f ->> 'connecte')::boolean
	        and exists (select 1 from pg_catalog.jsonb_array_elements(f -> 'espaces') e
	                     where e.value ->> 'slug' = 'p2enjoy' and e.value ->> 'role' = 'viewer')
	   from (select public.mcp_compte('5eed0000-0000-4000-8000-000000000013') as f) x),
	'la fiche de Farida dit sa venue au connecteur et son rôle de lectrice dans « p2enjoy »');
select ok(
	(select not (f ->> 'avec_profil')::boolean and f ->> 'email' = 'sans-profil@exemple.test'
	   from (select public.mcp_compte('a0940000-0000-4000-8000-000000000002') as f) x),
	'la fiche d''un compte du connecteur sans profil le dit');
select throws_ok($$select public.mcp_compte('00000000-0000-4000-8000-0000000000ff')$$, 'P0002', 'profil_introuvable',
	'ni profil ni compte du connecteur : la fiche est introuvable');

select throws_ok(
	$$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001',
	  '[["affaires", "consulter"]]')$$,
	'P0002', 'profil_introuvable', 'un compte sans profil ne reçoit pas de matrice : un droit serait sans effet (D9)');
select lives_ok(
	$$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	  '[["affaires", "consulter"], ["structure", "consulter"], ["affaires", "consulter"]]')$$,
	'une matrice est posée à un profil jamais venu au connecteur, doublon compris');
select is(
	(select e.value -> 'droits' from pg_catalog.jsonb_array_elements(public.mcp_compte('a0940000-0000-4000-8000-000000000001') -> 'espaces') e
	  where e.value ->> 'slug' = 'p2enjoy'),
	'[["structure", "consulter"], ["affaires", "consulter"]]'::jsonb,
	'les doublons se confondent, et la matrice se lit dans l''ordre des familles puis des actions');
select pg_temp.redevenir_proprietaire();

select pg_temp.service();
select is(pg_catalog.jsonb_array_length(public.mcp_etat_compte('a0940000-0000-4000-8000-000000000001', false) -> 'droits'), 2,
	'les droits posés avant la première connexion valent pour le connecteur (A5)');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011', true);
select lives_ok(
	$$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	  '[["structure", "consulter"], ["affaires", "consulter"]]')$$,
	'un remplacement à l''identique passe');
select pg_temp.redevenir_proprietaire();
select is(
	(select pg_catalog.count(*)::integer from public.plateforme_journal
	  where geste = 'mcp_droits_poses' and id > (select id from depart_plateforme_journal)),
	1, 'un remplacement à l''identique n''écrit rien au journal de la plateforme');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011', true);
select lives_ok(
	$$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	  '[["affaires", "ajouter"]]')$$,
	'la matrice est remplacée');
select is(
	(select e.value -> 'droits' from pg_catalog.jsonb_array_elements(public.mcp_compte('a0940000-0000-4000-8000-000000000001') -> 'espaces') e
	  where e.value ->> 'slug' = 'p2enjoy'),
	'[["affaires", "ajouter"]]'::jsonb, 'les cases retirées partent, la nouvelle est posée');
select pg_temp.redevenir_proprietaire();
select is(
	(select cible from public.plateforme_journal
	  where geste = 'mcp_droits_poses' and id > (select id from depart_plateforme_journal) order by id desc limit 1)
	 - 'espace',
	'{"nom": "Yannick Témoin", "avant": [["structure", "consulter"], ["affaires", "consulter"]], "apres": [["affaires", "ajouter"]]}'::jsonb,
	'le journal nomme la personne et dit l''avant et l''après');
select ok(
	(select pg_catalog.bool_and(accorde_par = '5eed0000-0000-4000-8000-000000000011') from public.mcp_droits
	  where sub = 'a0940000-0000-4000-8000-000000000001'),
	'chaque case porte le superadministrateur qui l''a accordée');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011', true);
select throws_ok($$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	'[["finances", "consulter"]]')$$, '22023', 'droit_invalide', 'une famille hors liste est refusée');
select throws_ok($$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	'[["affaires"]]')$$, '22023', 'droit_invalide', 'un couple incomplet est refusé');
select throws_ok($$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001',
	'{"affaires": "consulter"}')$$, '22023', 'droit_invalide', 'une matrice qui n''est pas un tableau est refusée');
select throws_ok($$select public.mcp_poser_droits('a0940000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000fe',
	'[]')$$, 'P0002', 'espace_introuvable', 'un espace inconnu est refusé');

select is(
	(select nom || '|' || outil from public.mcp_journal_liste('5eed0000-0000-4000-8000-000000000012', 'ok')
	  where id > (select id from depart_mcp_journal) limit 1),
	'Driss Lemoine|crm_workspace_list', 'le journal des appels se filtre par compte et par issue, sous le nom du profil');
select throws_ok($$select public.mcp_journal_liste(null, 'perdu')$$, '22023', 'issue_invalide',
	'une issue inconnue est refusée plutôt que de rendre une liste vide');
select ok(
	not exists (select 1 from public.mcp_journal_liste(null, null,
	              (select max(id) from public.mcp_journal_liste())) j
	             where j.id >= (select max(id) from public.mcp_journal_liste())),
	'le curseur est exclusif : la page suivante commence avant lui');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 6. Cascades et listes fermées
-- =============================================================================================

select throws_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'finances', 'consulter')$$,
	'23514', null, 'une famille hors liste ne s''inscrit pas dans la matrice');
select throws_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'affaires', 'purger')$$,
	'23514', null, 'une action hors liste ne s''inscrit pas dans la matrice');

insert into public.mcp_droits (sub, workspace_id, famille, action) values
	('5eed0000-0000-4000-8000-000000000012', 'a0900000-0000-4000-8000-0000000000b0', 'structure', 'consulter'),
	('5eed0000-0000-4000-8000-000000000013', 'a0900000-0000-4000-8000-0000000000b0', 'structure', 'consulter');
delete from public.workspaces where id = 'a0900000-0000-4000-8000-0000000000b0';
select is(
	(select pg_catalog.count(*)::integer from public.mcp_droits where workspace_id = 'a0900000-0000-4000-8000-0000000000b0'),
	0, 'supprimer un espace retire ses droits du connecteur');
delete from public.mcp_comptes where sub = '5eed0000-0000-4000-8000-000000000012';
select is(
	(select pg_catalog.count(*)::integer from public.mcp_droits where sub = '5eed0000-0000-4000-8000-000000000012'),
	1, 'retirer un compte du connecteur GARDE sa matrice : le droit vise le profil (D9)');
select throws_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('a0940000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'affaires', 'consulter')$$,
	'23503', null, 'un droit sans profil ne s''inscrit pas (D9)');
delete from public.profiles where id = 'a0940000-0000-4000-8000-000000000001';
select is(
	(select pg_catalog.count(*)::integer from public.mcp_droits where sub = 'a0940000-0000-4000-8000-000000000001'),
	0, 'retirer un profil retire sa matrice');
select is(
	(select pg_catalog.count(*)::integer from public.mcp_journal
	  where sub = '5eed0000-0000-4000-8000-000000000012' and id > (select id from depart_mcp_journal)),
	1, 'le journal survit au compte retiré');

select * from finish();
rollback;

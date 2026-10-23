-- @verifies CRM-070 (docs/BACKLOG.md) — tranche T3 : inscrire ou remplacer une attente en une transaction, sous les
--           politiques de `workspace_invitations` ; la retirer
-- @verifies docs/SPEC-membres.md §3.2, §5 point 3 ; docs/SCHEMA.md §9 bis.8 quinquies ; CLAUDE.md §10 (le refus prouvé
--           avec l'identité réelle de chaque profil du seed)
--
-- LE SEED : Camille (…011) administratrice, Driss (…012) business developer, Farida (…013) lectrice ; une attente
-- `attendu@p2enjoy.test` (lecteur) dans l'espace de démonstration (…001).
--
-- 1. La forme : SECURITY INVOKER — la fonction n'élève aucun droit —, `search_path` vide, `authenticated` seul.
-- 2. L'administratrice : inscription neuve, adresse normalisée, auteur posé ; remplacement en place, rôle d'avant rendu ;
--    adresse ou rôle invalides refusés sans perdre l'attente existante ; retrait par la politique de suppression.
-- 3. Le business developer et la lectrice : refusés, et l'attente existante reste intacte.
--
-- `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

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

-- Le rôle de l'attente d'une adresse, lu par le propriétaire (hors RLS).
create or replace function pg_temp.role_de(p_email text) returns text language sql security definer as $$
	select role from public.workspace_invitations
	 where workspace_id = '5eed0000-0000-4000-8000-000000000001' and email = p_email
$$;

-- Retire, sous l'identité courante, l'attente d'une adresse (toutes si `null`) ; rend le nombre de lignes retirées.
create or replace function pg_temp.retirer(p_email text) returns bigint language sql as $$
	with d as (delete from public.workspace_invitations
	            where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	              and (p_email is null or email = p_email)
	        returning 1)
	select count(*) from d
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'inscrire_attente', array['uuid', 'text', 'text'], 'la fonction existe');
select is((select prosecdef from pg_proc where proname = 'inscrire_attente'), false,
          'SECURITY INVOKER : les politiques décident');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where proname = 'inscrire_attente'), 'search_path vide');
select ok(has_function_privilege('authenticated', 'public.inscrire_attente(uuid, text, text)', 'execute'),
          'authenticated l''exécute');
select ok(not has_function_privilege('anon', 'public.inscrire_attente(uuid, text, text)', 'execute'),
          'anon ne l''exécute pas');

-- ---------------------------------------------------------------------------------------------
-- 2. L'administratrice
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', '  Nouvelle@P2Enjoy.test ', 'business_developer'),
          null, 'inscription neuve : aucun rôle remplacé');
select is((select count(*) from public.workspace_invitations
            where email = 'nouvelle@p2enjoy.test' and invited_by = '5eed0000-0000-4000-8000-000000000011'),
          1::bigint, 'l''adresse est normalisée, et l''auteur est l''administratrice');

select is(public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'attendu@p2enjoy.test', 'admin'),
          'viewer', 'remplacement : le rôle d''avant est rendu');
select is(pg_temp.role_de('attendu@p2enjoy.test'), 'admin', 'l''attente porte le nouveau rôle');
select is((select count(*) from public.workspace_invitations where email = 'attendu@p2enjoy.test'),
          1::bigint, 'une seule attente par adresse');

select throws_ok($$ select public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'attendu-sans-arobase', 'viewer') $$,
                 '22023', 'adresse_invalide', 'une adresse invalide est refusée');
select throws_ok($$ select public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'attendu@p2enjoy.test', 'owner') $$,
                 '22023', 'role_invalide', 'un rôle inconnu est refusé');
select is(pg_temp.role_de('attendu@p2enjoy.test'), 'admin',
          'les refus ne touchent pas l''attente existante');

select is(pg_temp.retirer('nouvelle@p2enjoy.test'), 1::bigint, 'l''administratrice retire une attente par la politique de suppression');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 3. Les autres profils
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$ select public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'attendu@p2enjoy.test', 'viewer') $$,
                 '42501', 'reserve_aux_administrateurs', 'le business developer est refusé');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$ select public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'autre@p2enjoy.test', 'viewer') $$,
                 '42501', 'reserve_aux_administrateurs', 'la lectrice est refusée');
select is(pg_temp.retirer(null), 0::bigint, 'la lectrice ne retire rien : la politique filtre');
select pg_temp.redevenir_proprietaire();

select is(pg_temp.role_de('attendu@p2enjoy.test'), 'admin', 'l''attente est intacte après les refus');

select * from finish();

rollback;

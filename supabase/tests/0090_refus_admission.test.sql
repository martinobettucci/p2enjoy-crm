-- @verifies CRM-109 (docs/BACKLOG.md) — tranche T1 : le journal des refus d'admission d'une adresse attendue
-- @verifies docs/SPEC-refus-admission.md §2 (trois motifs, une adresse attendue, rien pour une inconnue), §3 (table,
--           cascade sur l'attente, écriture par `service_role` seul, lecture par l'administrateur, purge à 90 jours),
--           §6 ; docs/SCHEMA.md §9 bis.8 sexies ; CLAUDE.md §10, §11 (minimisation prouvée)
--
-- LE SEED : l'attente `attendu@p2enjoy.test` (lecteur) dans l'espace de démonstration (…001) ; Camille (…011)
-- administratrice, Driss (…012) business developer, Farida (…013) lectrice.
--
-- 1. La forme : RLS, aucune écriture cliente, fonction `security definer` à `search_path` vide, `service_role` seul,
--    purge planifiée.
-- 2. L'écriture : une adresse attendue journalise et compte ; une inconnue n'écrit rien ; un motif hors des trois est
--    refusé ; l'adresse est normalisée.
-- 3. La lecture : l'administratrice lit, le business developer et la lectrice rien ; une trace de plus de 90 jours n'est
--    pas rendue, et la purge la retire.
-- 4. La cascade : la trace part au remplacement, au retrait et à la consommation de l'attente.
--
-- `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

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

create or replace function pg_temp.trace(p_email text) returns text language sql as $$
	select motif || '/' || refus from public.admission_refus
	 where workspace_id = '5eed0000-0000-4000-8000-000000000001' and email = p_email
$$;

-- La suite ne dépend pas de l'état de la base : une trace laissée par un passage réel de l'échangeur (`CRM-109` T2,
-- `e2e/api/session.spec.ts`) est retirée ici, dans la transaction annulée.
delete from public.admission_refus;

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'admission_refus', 'la table existe');
select ok((select relrowsecurity from pg_class where oid = 'public.admission_refus'::regclass), 'RLS activée');
select ok(not has_table_privilege('authenticated', 'public.admission_refus', 'insert')
          and not has_table_privilege('authenticated', 'public.admission_refus', 'update')
          and not has_table_privilege('authenticated', 'public.admission_refus', 'delete'),
          'aucune écriture pour authenticated');
select ok(not has_table_privilege('anon', 'public.admission_refus', 'select'), 'anon ne lit pas');
select is((select prosecdef from pg_proc where proname = 'journaliser_refus_admission'), true, 'SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where proname = 'journaliser_refus_admission'),
          'search_path vide');
select ok(has_function_privilege('service_role', 'public.journaliser_refus_admission(text, text)', 'execute'),
          'service_role l''exécute');
select ok(not has_function_privilege('authenticated', 'public.journaliser_refus_admission(text, text)', 'execute')
          and not has_function_privilege('anon', 'public.journaliser_refus_admission(text, text)', 'execute'),
          'ni authenticated ni anon ne l''exécutent');
select is((select schedule from cron.job where jobname = 'p2enjoy-purge-refus-admission'), '53 3 * * *',
          'la purge est planifiée chaque jour');

-- ---------------------------------------------------------------------------------------------
-- 2. L'écriture, par l'échangeur
-- ---------------------------------------------------------------------------------------------

set local role service_role;
select lives_ok($$ select public.journaliser_refus_admission(' Attendu@P2Enjoy.test ', 'adresse_non_verifiee') $$,
                'service_role journalise un refus');
select lives_ok($$ select public.journaliser_refus_admission('inconnu@p2enjoy.test', 'adresse_non_verifiee') $$,
                'une adresse inconnue ne lève rien');
select throws_ok($$ select public.journaliser_refus_admission('attendu@p2enjoy.test', 'attente_espace') $$,
                 '22023', 'motif_invalide', 'un motif hors des trois est refusé');
select lives_ok($$ select public.journaliser_refus_admission('attendu@p2enjoy.test', 'attente_verification') $$,
                'un second refus');
reset role;

select is(pg_temp.trace('attendu@p2enjoy.test'), 'attente_verification/2',
          'l''adresse normalisée trouve son attente ; le dernier motif et le compte');
select is((select count(*) from public.admission_refus where email = 'inconnu@p2enjoy.test'), 0::bigint,
          'une adresse que personne n''attend ne laisse aucune trace (SPEC-session-sso §6.1)');

set local role authenticated;
select throws_ok($$ select public.journaliser_refus_admission('attendu@p2enjoy.test', 'adresse_non_verifiee') $$,
                 '42501', null, 'authenticated ne journalise pas');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 3. La lecture
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*) from public.admission_refus), 1::bigint, 'l''administratrice lit la trace de son espace');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select count(*) from public.admission_refus), 0::bigint, 'le business developer ne lit rien');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*) from public.admission_refus), 0::bigint, 'la lectrice ne lit rien');
select pg_temp.redevenir_proprietaire();

update public.admission_refus
   set premier_refus = now() - interval '100 days', dernier_refus = now() - interval '91 days'
 where email = 'attendu@p2enjoy.test';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*) from public.admission_refus), 0::bigint, 'une trace de plus de 90 jours n''est plus rendue');
select pg_temp.redevenir_proprietaire();
select is(app.purger_refus_admission(), 1, 'la purge la retire');
select is((select count(*) from public.admission_refus), 0::bigint, 'plus rien ne reste');

-- ---------------------------------------------------------------------------------------------
-- 4. La cascade
-- ---------------------------------------------------------------------------------------------

set local role service_role;
select public.journaliser_refus_admission('attendu@p2enjoy.test', 'attente_administrateur');
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.inscrire_attente('5eed0000-0000-4000-8000-000000000001', 'attendu@p2enjoy.test', 'business_developer');
select pg_temp.redevenir_proprietaire();
select is(pg_temp.trace('attendu@p2enjoy.test'), null, 'remplacer l''attente efface sa trace (décision 644)');

set local role service_role;
select public.journaliser_refus_admission('attendu@p2enjoy.test', 'attente_administrateur');
reset role;
delete from public.workspace_invitations where email = 'attendu@p2enjoy.test';
select is(pg_temp.trace('attendu@p2enjoy.test'), null, 'retirer l''attente efface sa trace');

-- La consommation : `ouvrir_session_sso` consomme l'attente d'une personne admise, et la trace part avec elle.
insert into public.workspace_invitations (workspace_id, email, role)
values ('5eed0000-0000-4000-8000-000000000001', 'consommee@p2enjoy.test', 'viewer');
set local role service_role;
select public.journaliser_refus_admission('consommee@p2enjoy.test', 'attente_verification');
reset role;
select is(pg_temp.trace('consommee@p2enjoy.test'), 'attente_verification/1', 'la trace d''une nouvelle attente');
select public.ouvrir_session_sso(gen_random_uuid(), 'consommee@p2enjoy.test', 'Personne Consommée');
select is(pg_temp.trace('consommee@p2enjoy.test'), null, 'consommer l''attente à l''admission efface sa trace');

select * from finish();

rollback;

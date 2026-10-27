-- @verifies CRM-077 (docs/BACKLOG.md), dixième tranche — docs/SPEC-corbeille.md §8.4 (…038 en corbeille fermé à qui ne l'a pas retiré)
-- @verifies CRM-093 (docs/BACKLOG.md) — tranche T1 : la capacité d'écriture sur un channel et sur une affaire, lisible
--           par l'interface
-- @verifies docs/SPEC-droits-interface.md §2.1 (deux colonnes calculées, SECURITY INVOKER, droits d'exécution, aucune
--           ligne de plus que la RLS) ; docs/SPEC-permissions-rls.md §3.3 bis (le plus spécifique gagne, transitif),
--           §7 (zéro ligne pour l'anonyme) ; docs/SCHEMA.md §9 bis.8 ter ; docs/JOURNAL.md décision 628 et sa précision ;
--           docs/SPEC-droits-interface.md §2.2 (les deux colonnes de l'espace, migration 0092)
--
-- CE QUE CETTE SUITE PROUVE, AVEC LES PROFILS ET LES DROITS FINS RÉELS DU SEED (`supabase/seed/apply-seed.sh`, droits
-- fins : Farida `member` sur « prospection » …031 sous « Conseil & IA » …021 qui lui est fermé ; Driss `viewer` sur
-- « maintenance » …035) :
--
-- 1. La forme : deux surcharges, SECURITY INVOKER — en DEFINER, elles rendraient `true` à la lectrice.
-- 2. Les droits d'exécution : `anon` et `authenticated` exécutent, `public` non.
-- 3. La matrice des channels, profil par profil, mesurée le 2026-10-21 : l'administratrice écrit les huit ; le
--    business developer les écrit sauf « maintenance » ; la lectrice ne lit que six channels et n'écrit que
--    « prospection », rouvert par un droit fin sous un track fermé.
--    RÉVISÉE PAR CRM-077 DIXIÈME TRANCHE (docs/SPEC-corbeille.md §8.4, décision 707) : « Annexes 2023 » …038 est en
--    corbeille, retiré par l'administratrice ; il n'est plus lisible que par elle. Le business developer en lit donc
--    sept, la lectrice cinq — la règle de cette suite est inchangée, c'est la corbeille personnelle qui ferme …038.
-- 4. Une affaire porte la capacité de son channel, pour chacun des trois profils.
-- 5. L'anonyme : zéro ligne, sans erreur de privilège.
--
-- Lecture seule, `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

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

-- Les channels écrits par l'appelant, par leurs trois derniers caractères, dans l'ordre.
create or replace function pg_temp.ecrits() returns text language sql as $$
	select coalesce(string_agg(right(c.id::text, 3), ',' order by c.id), '')
	  from public.channels c where c.id::text like '5eed%' and c.ecriture_permise
$$;
create or replace function pg_temp.lus() returns text language sql as $$
	select coalesce(string_agg(right(id::text, 3), ',' order by id), '')
	  from public.channels where id::text like '5eed%'
$$;
-- Les affaires lues dont la capacité diffère de celle de leur channel : doit être vide.
create or replace function pg_temp.divergences() returns bigint language sql as $$
	select count(*) from public.cards k join public.channels c on c.id = k.channel_id
	 where k.ecriture_permise is distinct from c.ecriture_permise
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'ecriture_permise', array['channels'], 'la colonne calculée des channels existe');
select has_function('public', 'ecriture_permise', array['cards'], 'la colonne calculée des affaires existe');
select is((select bool_or(prosecdef) from pg_proc
            where proname = 'ecriture_permise'
              and pg_get_function_identity_arguments(oid) in ('ch channels', 'c cards')),
          false, 'les deux surcharges sont SECURITY INVOKER : en DEFINER, elles répondraient pour postgres');

-- ---------------------------------------------------------------------------------------------
-- 2. Les droits d'exécution
-- ---------------------------------------------------------------------------------------------

select ok(has_function_privilege('anon', 'public.ecriture_permise(public.channels)', 'execute'),
          'anon exécute la colonne des channels : zéro ligne plutôt qu''une erreur de privilège');
select ok(has_function_privilege('authenticated', 'public.ecriture_permise(public.cards)', 'execute'),
          'authenticated exécute la colonne des affaires');
select ok(not exists (select 1 from information_schema.routine_privileges
                       where routine_schema = 'public' and routine_name = 'ecriture_permise'
                         and grantee = 'PUBLIC'),
          'public n''exécute aucune des surcharges');

-- ---------------------------------------------------------------------------------------------
-- 3. La matrice des channels, profil par profil
-- ---------------------------------------------------------------------------------------------

-- RÉVISÉE PAR `CRM-068` T3a (décision 51) : le channel « Checklists » (`…c6841`, track `studio-web`, `docs/SPEC-seed.md`
-- §28) entre dans la matrice ; il se lit et s'écrit comme `refonte`, l'autre channel ouvert de `studio-web`, la lectrice le lit sans l'écrire.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.lus(), '031,032,033,034,035,036,037,038,841', 'l''administratrice lit les neuf channels du seed');
select is(pg_temp.ecrits(), '031,032,033,034,035,036,037,038,841', 'l''administratrice les écrit tous');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.lus(), '031,032,033,034,035,036,037,841', 'le business developer lit huit channels : …038 est en corbeille, retiré par l''administratrice');
select is(pg_temp.ecrits(), '031,032,033,034,036,037,841',
          'le business developer les écrit tous sauf « maintenance », où un droit fin le restreint en lecture');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.lus(), '031,034,035,036,037,841',
          'la lectrice ne lit que six channels : « Conseil & IA » lui est fermé, sauf « prospection », et …038 est en corbeille');
select is(pg_temp.ecrits(), '031',
          'la lectrice n''écrit que « prospection », rouvert par un droit fin sous un track fermé — transitivité');
select is((select c.ecriture_permise from public.channels c where c.id = '5eed0000-0000-4000-8000-000000000032'), null,
          'un channel qu''elle ne lit pas n''est pas rendu : la colonne n''apprend rien de plus que la RLS');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 4. Une affaire porte la capacité de son channel
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.divergences(), 0::bigint, 'administratrice : chaque affaire porte la capacité de son channel');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.divergences(), 0::bigint, 'business developer : chaque affaire porte la capacité de son channel');
select ok(exists (select 1 from public.cards k
                   where k.channel_id = '5eed0000-0000-4000-8000-000000000035' and not k.ecriture_permise),
          'business developer : une affaire de « maintenance » est en lecture seule');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.divergences(), 0::bigint, 'lectrice : chaque affaire porte la capacité de son channel');
select ok(exists (select 1 from public.cards k
                   where k.channel_id = '5eed0000-0000-4000-8000-000000000031' and k.ecriture_permise),
          'lectrice : une affaire de « prospection » est modifiable');
select ok(not exists (select 1 from public.cards k
                       where k.channel_id <> '5eed0000-0000-4000-8000-000000000031' and k.ecriture_permise),
          'lectrice : aucune autre affaire n''est modifiable');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 6. Les deux capacités de l'espace
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'administration_permise', array['workspaces'], 'la capacité d''administration existe');
select has_function('public', 'edition_permise', array['workspaces'], 'la capacité d''édition existe');
select is((select bool_or(prosecdef) from pg_proc where proname in ('administration_permise', 'edition_permise')),
          false, 'les deux sont SECURITY INVOKER');

create or replace function pg_temp.capacites() returns text language sql as $$
	select coalesce(string_agg(w.administration_permise::text || '/' || w.edition_permise::text, ','), '')
	  from public.workspaces w where w.id = '5eed0000-0000-4000-8000-000000000001'
$$;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.capacites(), 'true/true', 'l''administratrice administre et édite l''espace');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.capacites(), 'false/true', 'le business developer édite sans administrer');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.capacites(), 'false/false', 'la lectrice n''administre ni n''édite');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 5. L'anonyme : zéro ligne, sans erreur
-- ---------------------------------------------------------------------------------------------

set local role anon;
select lives_ok($$ select c.id, c.ecriture_permise from public.channels c $$,
                'l''anonyme demande la colonne sans erreur de privilège');
select is((select count(*) from public.channels c where c.ecriture_permise is not null), 0::bigint,
          'l''anonyme ne reçoit aucune ligne de channel');
select is((select count(*) from public.cards k where k.ecriture_permise is not null), 0::bigint,
          'l''anonyme ne reçoit aucune ligne d''affaire');
select is((select count(*) from public.workspaces w where w.administration_permise is not null), 0::bigint,
          'l''anonyme ne reçoit aucune ligne d''espace');
reset role;

select * from finish();

rollback;

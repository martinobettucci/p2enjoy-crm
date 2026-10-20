-- @verifies CRM-093 (docs/BACKLOG.md) — tranche T1 : la capacité d'écriture sur un channel et sur une affaire, lisible
--           par l'interface
-- @verifies docs/SPEC-droits-interface.md §2.1 (deux colonnes calculées, SECURITY INVOKER, droits d'exécution, aucune
--           ligne de plus que la RLS) ; docs/SPEC-permissions-rls.md §3.3 bis (le plus spécifique gagne, transitif),
--           §7 (zéro ligne pour l'anonyme) ; docs/SCHEMA.md §9 bis.8 ter ; docs/JOURNAL.md décision 628
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
-- 4. Une affaire porte la capacité de son channel, pour chacun des trois profils.
-- 5. L'anonyme : zéro ligne, sans erreur de privilège.
--
-- Lecture seule, `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.lus(), '031,032,033,034,035,036,037,038', 'l''administratrice lit les huit channels du seed');
select is(pg_temp.ecrits(), '031,032,033,034,035,036,037,038', 'l''administratrice les écrit tous');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.lus(), '031,032,033,034,035,036,037,038', 'le business developer lit les huit channels');
select is(pg_temp.ecrits(), '031,032,033,034,036,037,038',
          'le business developer les écrit tous sauf « maintenance », où un droit fin le restreint en lecture');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.lus(), '031,034,035,036,037,038',
          'la lectrice ne lit que six channels : « Conseil & IA » lui est fermé, sauf « prospection »');
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
-- 5. L'anonyme : zéro ligne, sans erreur
-- ---------------------------------------------------------------------------------------------

set local role anon;
select lives_ok($$ select c.id, c.ecriture_permise from public.channels c $$,
                'l''anonyme demande la colonne sans erreur de privilège');
select is((select count(*) from public.channels c where c.ecriture_permise is not null), 0::bigint,
          'l''anonyme ne reçoit aucune ligne de channel');
select is((select count(*) from public.cards k where k.ecriture_permise is not null), 0::bigint,
          'l''anonyme ne reçoit aucune ligne d''affaire');
reset role;

select * from finish();

rollback;

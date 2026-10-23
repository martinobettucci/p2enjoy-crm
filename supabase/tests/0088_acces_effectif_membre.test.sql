-- @verifies CRM-070 (docs/BACKLOG.md) — tranche T1 : l'accès effectif d'un membre, lu par l'administrateur de son espace
-- @verifies docs/SPEC-membres.md §3.3, §5 point 1 (fonction de lecture réservée à l'administrateur) ;
--           docs/SPEC-permissions-rls.md §2.2 (« le plus spécifique gagne »), §3.3 bis (track lisible par un channel) ;
--           docs/SCHEMA.md §9 bis.8 quater ; docs/JOURNAL.md décision 635
--
-- CE QUE CETTE SUITE PROUVE, SUR LES DROITS FINS RÉELS DU SEED : Farida (lectrice) `none` sur le track « Conseil & IA »
-- (…021) et `member` sur son channel « Prospection » (…031) ; Driss (business developer) `viewer` sur « Maintenance »
-- (…035) ; Camille administratrice.
--
-- 1. La forme : SECURITY DEFINER, `search_path` vide, `execute` à `authenticated` seul.
-- 2. La garde : tout appelant qui n'administre pas l'espace est refusé (42501), lectrice comme business developer.
-- 3. Ce que l'administratrice lit pour Farida, pour Driss, pour elle-même, et pour une personne étrangère à l'espace.
-- 4. L'inventaire : un track ou un channel en corbeille n'est pas rendu ; un channel archivé l'est, et se dit archivé.
--
-- Lecture seule, `rollback`.

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

-- L'accès lu pour une personne sur un objet, sous la forme « posé/effectif ».
create or replace function pg_temp.lu(p_user uuid, p_objet uuid) returns text language sql as $$
	select coalesce(a.acces_pose, 'hérité') || '/' || a.acces_effectif
	  from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001', p_user) a
	 where a.id = p_objet
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'acces_effectif_membre', array['uuid', 'uuid'], 'la fonction de lecture existe');
select is((select prosecdef from pg_proc where proname = 'acces_effectif_membre'), true,
          'SECURITY DEFINER : elle lit les droits d''une autre personne');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where proname = 'acces_effectif_membre'),
          'search_path vide');
select ok(has_function_privilege('authenticated', 'public.acces_effectif_membre(uuid, uuid)', 'execute'),
          'authenticated l''exécute');
select ok(not has_function_privilege('anon', 'public.acces_effectif_membre(uuid, uuid)', 'execute'),
          'anon ne l''exécute pas');

-- ---------------------------------------------------------------------------------------------
-- 2. La garde
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$ select * from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                                                '5eed0000-0000-4000-8000-000000000013') $$,
                 '42501', 'reserve_aux_administrateurs',
                 'le business developer est refusé : il n''administre pas l''espace');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$ select * from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                                                '5eed0000-0000-4000-8000-000000000013') $$,
                 '42501', 'reserve_aux_administrateurs',
                 'la lectrice est refusée, même pour ses propres droits');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 3. Ce que lit l'administratrice
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- Farida : un track fermé, un channel rouvert sous lui, les autres channels du track fermés par héritage.
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000013', '5eed0000-0000-4000-8000-000000000021'), 'none/none',
          'Farida : « Conseil & IA » posé à none, effectif none');
select is((select lisible_par_un_channel from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                                  '5eed0000-0000-4000-8000-000000000013')
            where id = '5eed0000-0000-4000-8000-000000000021'), true,
          'Farida : le track fermé reste lisible par l''un de ses channels (§3.3 bis)');
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000013', '5eed0000-0000-4000-8000-000000000031'), 'member/write',
          'Farida : « Prospection » posé à member, effectif write — le plus spécifique gagne');
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000013', '5eed0000-0000-4000-8000-000000000032'), 'hérité/none',
          'Farida : « Grands comptes », rien de posé, fermé par le track');
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000013', '5eed0000-0000-4000-8000-000000000034'), 'hérité/read',
          'Farida : « Refonte de site », rien de posé, lecture par son rôle de lectrice');

-- Driss : une restriction en lecture sur un channel, l'écriture partout ailleurs.
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000035'), 'viewer/read',
          'Driss : « Maintenance » posé à viewer, effectif read');
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000034'), 'hérité/write',
          'Driss : « Refonte de site », effectif write par son rôle');

-- L'administratrice elle-même : un administrateur n'est jamais restreint, quels que soient ses droits posés.
select is((select count(*) from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   '5eed0000-0000-4000-8000-000000000011') where acces_effectif <> 'write'),
          0::bigint, 'Camille : write partout — un administrateur n''est jamais restreint');
select is(pg_temp.lu('5eed0000-0000-4000-8000-000000000011', '5eed0000-0000-4000-8000-000000000021'), 'none/write',
          'Camille : son droit none posé sur « Conseil & IA » est rendu tel quel, et sans effet');

-- Une personne étrangère à l'espace : aucun rôle implicite.
select is((select count(*) from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   gen_random_uuid()) where acces_effectif <> 'none'),
          0::bigint, 'une personne étrangère à l''espace : none partout');

-- ---------------------------------------------------------------------------------------------
-- 4. L'inventaire
-- ---------------------------------------------------------------------------------------------

select is((select count(*) from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   '5eed0000-0000-4000-8000-000000000013') where objet = 'channel'),
          (select count(*) from public.channels where workspace_id = '5eed0000-0000-4000-8000-000000000001'
                                                  and deleted_at is null),
          'un channel par channel vivant de l''espace');
select is((select count(*) from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   '5eed0000-0000-4000-8000-000000000013') where objet = 'track'),
          (select count(*) from public.tracks where workspace_id = '5eed0000-0000-4000-8000-000000000001'
                                                and deleted_at is null),
          'un track par track vivant de l''espace');
select is((select archive from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   '5eed0000-0000-4000-8000-000000000013')
            where id = '5eed0000-0000-4000-8000-000000000033'), true,
          '« Appels d''offres », archivé, est rendu et se dit archivé');
select is((select count(*) from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                   '5eed0000-0000-4000-8000-000000000013') a
             join public.channels c on c.id = a.id where c.deleted_at is not null),
          0::bigint, 'aucun channel en corbeille n''est rendu');

select pg_temp.redevenir_proprietaire();

-- L'anonyme n'a pas le droit d'exécuter.
set local role anon;
select throws_ok($$ select * from public.acces_effectif_membre('5eed0000-0000-4000-8000-000000000001',
                                                                '5eed0000-0000-4000-8000-000000000013') $$,
                 '42501', null, 'l''anonyme est refusé par les droits d''exécution');
reset role;

select * from finish();

rollback;

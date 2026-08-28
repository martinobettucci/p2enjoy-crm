-- @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, TRANCHE 3 : l'état de lecture seule
-- @verifies docs/SPEC-goals.md §5.7 (l'arbitrage d'INC-170), §5.7.2 (les quatre mesures qui
--           fondent le contrat), §5.7.4 (contrat opposable, lignes a, b, d et e), §5.7.5 (DoD)
-- @verifies docs/SCHEMA.md §9 bis.8 bis (`public.ecriture_permise`)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (formes du refus)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les identités réelles)
--
-- CE QUE CETTE SUITE PROUVE, ET POURQUOI CHAQUE ASSERTION EXISTE.
--
-- 1. LA FORME DE LA FONCTION, et c'est la plus importante des cinq. `security invoker` n'est pas
--    ici un défaut accepté : en `definer`, la fonction répondrait pour son propriétaire, qui
--    traverse la RLS, et rendrait `true` à TOUT appelant — la lectrice comprise. Le canevas
--    n'afficherait alors JAMAIS son état de lecture seule, et le §5.4 se lirait à l'envers. Une
--    suite qui ne mesurerait que les valeurs resterait verte sur cette régression le jour où le
--    seul profil éprouvé serait un profil qui écrit.
--
-- 2. LES PRIVILÈGES, `anon` NOMMÉMENT. Sans `execute`, un appelant anonyme atteignant
--    `goal_boards` recevrait une ERREUR DE PRIVILÈGE là où `docs/SPEC-permissions-rls.md` §7 exige
--    zéro ligne — la différence entre un refus et une panne.
--
-- 3. LES TROIS PROFILS RÉELS DU SEED sur la MÊME ligne (mesure B du §5.7.2). Deux valeurs
--    différentes sur un même tableau sont la seule preuve que la fonction s'exécute bien sous
--    l'identité de l'appelant : une assertion à un seul profil serait verte en `definer`.
--
-- 4. LA CONDITION EST SUFFISANTE, JAMAIS NÉCESSAIRE (mesure D du §5.7.2, contrat ligne d). Driss
--    écrit le tableau — la colonne rend `true` — et ne peut pourtant PAS poser un lien vers
--    « Maintenance », channel qu'il lit sans l'écrire. Sans cette assertion, rien n'empêcherait
--    une session ultérieure de lire la colonne comme « tout passe » et de faire rejouer à l'écran
--    une règle qui vit dans la politique.
--
-- 5. LA COLONNE N'OUVRE ET NE FERME AUCUNE LIGNE (contrat ligne e) : le nombre de tableaux lus par
--    la lectrice est le même qu'avant, la colonne n'étant qu'un booléen de plus sur une ligne déjà
--    consentie.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
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
	perform set_config('request.jwt.claims', '', true);
	execute 'reset role';
end;
$$;

-- Identités et lignes du seed, stables par contrat (`docs/SPEC-seed.md`).
create or replace function pg_temp.camille() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.farida() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;
create or replace function pg_temp.tableau() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000e1'::uuid $$;
create or replace function pg_temp.ch_maintenance() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000035'::uuid $$;

-- =============================================================================================
-- 1. La FORME de la fonction — `invoker`, `stable`, et son unique argument composite
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.8 bis, docs/SPEC-goals.md §5.7.4.

select has_function(
	'public', 'ecriture_permise', array['public.goal_boards'],
	'CRM-083 : `public.ecriture_permise(goal_boards)` existe');

select is(
	(select prosecdef from pg_proc where oid = 'public.ecriture_permise(public.goal_boards)'::regprocedure),
	false,
	'CRM-083 : elle est `security INVOKER` — en `definer`, elle rendrait « true » à tout le monde '
	'et l''état de lecture seule du §5.4 ne paraîtrait jamais');

select is(
	(select provolatile from pg_proc where oid = 'public.ecriture_permise(public.goal_boards)'::regprocedure),
	's'::"char",
	'CRM-083 : elle est `stable` — PostgREST n''expose comme colonne calculée qu''une fonction qui '
	'ne modifie rien');

-- =============================================================================================
-- 2. Les privilèges, `anon` NOMMÉMENT
-- =============================================================================================

select ok(
	has_function_privilege('anon', 'public.ecriture_permise(public.goal_boards)', 'EXECUTE'),
	'CRM-083 : `anon` l''exécute — sans quoi un appelant anonyme atteignant `goal_boards` '
	'recevrait une erreur de privilège là où le §7 exige zéro ligne');

select ok(
	has_function_privilege('authenticated', 'public.ecriture_permise(public.goal_boards)', 'EXECUTE'),
	'CRM-083 : `authenticated` l''exécute');

select ok(
	has_function_privilege('service_role', 'public.ecriture_permise(public.goal_boards)', 'EXECUTE'),
	'CRM-083 : `service_role` l''exécute');

-- =============================================================================================
-- 3. Les trois profils réels sur la MÊME ligne — mesure B du §5.7.2
-- =============================================================================================

select pg_temp.endosser(pg_temp.camille());

select is(
	(select public.ecriture_permise(b) from public.goal_boards b where b.id = pg_temp.tableau()),
	true,
	'CRM-083 : Camille, administratrice, ÉCRIT le tableau — la colonne rend « true »');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.driss());

select is(
	(select public.ecriture_permise(b) from public.goal_boards b where b.id = pg_temp.tableau()),
	true,
	'CRM-083 : Driss, business developer, ÉCRIT le tableau — le §4.2 ouvre l''écriture à tout '
	'membre, pas aux seuls administrateurs');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.farida());

select is(
	(select public.ecriture_permise(b) from public.goal_boards b where b.id = pg_temp.tableau()),
	false,
	'CRM-083 : Farida, lectrice, N''ÉCRIT PAS le tableau — c''est l''état de lecture seule du §5.4, '
	'et deux valeurs différentes sur la MÊME ligne sont la seule preuve que la fonction s''exécute '
	'sous l''identité de l''appelant');

-- Contrat ligne e : la colonne n'ouvre ni ne ferme aucune ligne.
select is(
	(select count(*)::int from public.goal_boards),
	2,
	'CRM-083 : la lectrice lit toujours les DEUX tableaux du seed — la colonne n''est qu''un '
	'booléen de plus sur une ligne que la RLS a déjà consentie (§5.7.4, ligne e)');

select pg_temp.redevenir_proprietaire();
select pg_temp.anonyme();

select is(
	(select app.can_write_goal_board(pg_temp.tableau())),
	false,
	'CRM-083 : l''appelant anonyme n''écrit rien — `auth.uid()` étant nul, le droit accordé à '
	'`anon` n''ouvre rien');

-- =============================================================================================
-- 4. La condition est SUFFISANTE, jamais NÉCESSAIRE — mesure D du §5.7.2, contrat ligne d
-- =============================================================================================
-- Driss écrit le tableau (assertion ci-dessus), et ne peut pourtant pas poser un lien vers
-- « Maintenance ». Un écran qui lirait la colonne comme « tout passe » rejouerait ici une règle de
-- la base et divergerait d'elle au premier changement de politique.

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.driss());

select is(
	(select app.can_write_channel(pg_temp.ch_maintenance())),
	false,
	'CRM-083 : Driss, pour qui la colonne rend « true », N''ÉCRIT PAS « Maintenance » — la capacité '
	'du tableau est une condition SUFFISANTE de refus, jamais NÉCESSAIRE (§5.7.4, ligne d)');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

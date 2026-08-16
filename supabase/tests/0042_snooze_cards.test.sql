-- @verifies CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 1
-- @verifies docs/SPEC-cards.md §16.2 (ce que « en sommeil » signifie), §16.3 (`snooze_card` et ses
--           quatre refus, dans l'ordre), §16.4 (`wake_card` et son idempotence), §16.5 (la trace
--           est écrite par un trigger, jamais par la fonction), §16.6 (qui peut mettre en
--           sommeil), §16.7 (la colonne se ferme), §16.9 (preuves exigées)
-- @verifies docs/SPEC-cards.md §5 (ce que « active » signifie), §14.4 (vocabulaire de
--           `card_events`), §14.6 (le payload ne porte aucun libellé)
-- @verifies docs/SPEC-permissions-rls.md §4.3 (règle de discrétion), §4.4 (colonne constatée par
--           le serveur), §7 (preuve de refus n° 1)
-- @verifies docs/SCHEMA.md §5 (card_events), §9 (fonctions et RPC)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME des deux fonctions — signature, retour composite, `SECURITY DEFINER`, `search_path`
--    vidé, propriétaire — et leurs privilèges, `anon` nommément exclu. Une garde qu'un appelant
--    anonyme pourrait invoquer ne serait pas une garde.
--
-- 2. Les quatre refus de `snooze_card`, DANS L'ORDRE où la garde les oppose, et chacun contre son
--    succès correspondant : une assertion qui ne prouverait que le refus serait verte sur une
--    fonction qui refuse tout.
--
-- 3. La RÈGLE DE DISCRÉTION avec le MÊME profil dans les deux cas — invisible rend
--    `card_not_found`, visible-mais-lecteur rend `forbidden`. C'est la seule forme qui prouve que
--    la distinction tient au droit et non au profil.
--
-- 4. Que la TRACE est écrite par le trigger de table et non par la fonction : l'écriture par le
--    propriétaire — qui n'appelle aucune des deux fonctions — laisse elle aussi son événement.
--
-- 5. Que l'IDEMPOTENCE de `wake_card` est réelle : un réveil sans sommeil n'écrit rien.
--
-- 6. Que la colonne est FERMÉE en écriture directe, sans quoi les quatre refus seraient
--    contournables par un `PATCH`.
--
-- La suite joue les gestes avec les comptes RÉELS du seed et fait `rollback` : le seed est rendu
-- intact, et aucun événement n'y survit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

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

-- Objets du seed employés ici (docs/SPEC-seed.md, identifiants stables par contrat) :
--   profils  11 administratrice · 13 lectrice
--   cards    c1 (channel 32, track `grands-comptes` — INVISIBLE de la lectrice)
--            c5 (channel 35, `inter-entreprises` — VISIBLE de la lectrice, SANS écriture)
--            c8 ARCHIVÉE · c9 CORBEILLE

-- =============================================================================================
-- 1. La forme des deux fonctions — docs/SPEC-cards.md §16.3, §16.4, §16.6
-- =============================================================================================

select has_function('public', 'snooze_card', array['uuid', 'timestamptz'],
	'`public.snooze_card(uuid, timestamptz)` est livrée');

select has_function('public', 'wake_card', array['uuid'],
	'`public.wake_card(uuid)` est livrée');

select function_returns('public', 'snooze_card', array['uuid', 'timestamptz'], 'cards',
	'`snooze_card` rend `public.cards` : le client obtient l''échéance enregistrée sans relecture');

select function_returns('public', 'wake_card', array['uuid'], 'cards',
	'`wake_card` rend `public.cards`, même contrat que sa jumelle');

select is(
	(select array_agg(p.prosecdef order by p.proname) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname in ('snooze_card', 'wake_card')),
	array[true, true],
	'`SECURITY DEFINER` toutes deux : c''est le mécanisme même de la garde, la colonne étant fermée '
	'à leur appelant (§16.7)');

select is(
	(select array_agg(p.proconfig::text order by p.proname) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname in ('snooze_card', 'wake_card')),
	array['{"search_path=\"\""}', '{"search_path=\"\""}'],
	'`search_path` vidé toutes deux : sans lui, une fonction `SECURITY DEFINER` est une porte '
	'ouverte sur le schéma de l''appelant');

select is(
	(select array_agg(distinct r.rolname::text) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	   join pg_roles r on r.oid = p.proowner
	  where n.nspname = 'public' and p.proname in ('snooze_card', 'wake_card')),
	array['postgres'],
	'Propriétaire `postgres` : `SECURITY DEFINER` n''a de sens qu''avec le rôle qui détient le '
	'privilège retiré à l''appelant');

select ok(
	has_function_privilege('authenticated', 'public.snooze_card(uuid, timestamptz)', 'execute')
	and has_function_privilege('authenticated', 'public.wake_card(uuid)', 'execute'),
	'`authenticated` peut appeler les deux : le droit RÉEL est vérifié dans la fonction (§16.6)');

select ok(
	not has_function_privilege('anon', 'public.snooze_card(uuid, timestamptz)', 'execute')
	and not has_function_privilege('anon', 'public.wake_card(uuid)', 'execute'),
	'`anon` ne peut appeler ni l''une ni l''autre : un anonyme n''a ni card, ni channel');

-- =============================================================================================
-- 2. La colonne est fermée en écriture directe — docs/SPEC-cards.md §16.7
-- =============================================================================================

select ok(not has_column_privilege('authenticated', 'public.cards', 'snoozed_until', 'update'),
	'`snoozed_until` est fermée : sans quoi les quatre refus seraient contournables par un `PATCH`');

select ok(has_column_privilege('service_role', 'public.cards', 'snoozed_until', 'update'),
	'`service_role` la conserve : le seed et l''exploitation écrivent, et le trigger les trace');

-- =============================================================================================
-- 3. Le vocabulaire du fil et le trigger — docs/SPEC-cards.md §16.5
-- =============================================================================================

select ok(
	(select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check')
	like '%snoozed%woken%',
	'`card_events_type_check` porte `snoozed` ET `woken` : le vocabulaire passe de douze à '
	'quatorze valeurs, et cette migration en devient la dernière autorité');

select has_trigger('public', 'cards', 'card_events_apres_maj_sommeil',
	'Le trigger de trace est sur la TABLE, non dans les fonctions : `card_events` n''accorde aucun '
	'privilège d''écriture, `service_role` compris (§14)');

-- =============================================================================================
-- 4. Les quatre refus de `snooze_card`, dans l'ordre — docs/SPEC-cards.md §16.3
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000ff',
	                          now() + interval '3 days') $$,
	'P0001', 'card_not_found',
	'Refus n° 1 — une card qui n''existe pas est ABSENTE, et le code est `P0001` : `P0002` serait '
	'rendu `500` par PostgREST et lu comme une panne du produit');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c8',
	                          now() + interval '3 days') $$,
	'P0001', 'card_not_found',
	'Refus n° 1 — une card ARCHIVÉE est traitée comme absente : « active » a la même définition '
	'qu''ailleurs (§5)');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c9',
	                          now() + interval '3 days') $$,
	'P0001', 'card_not_found',
	'Refus n° 1 — une card à la CORBEILLE de même : on la restaure avant de l''endormir');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c1', null) $$,
	'P0001', 'snooze_date_required',
	'Refus n° 3 — une mise en sommeil sans échéance serait un archivage, geste qui existe déjà');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c1',
	                          now() - interval '1 minute') $$,
	'P0001', 'snooze_date_in_past',
	'Refus n° 4 — une échéance passée rendrait la card immédiatement hors sommeil : l''écriture '
	'serait acceptée et sans effet observable (§16.2)');

-- Le succès correspondant, sans quoi les refus ci-dessus seraient verts sur une fonction qui
-- refuse tout.
select is(
	(select (public.snooze_card('5eed0000-0000-4000-8000-0000000000c1',
	                            '2099-01-01T00:00:00Z'::timestamptz)).snoozed_until),
	'2099-01-01T00:00:00Z'::timestamptz,
	'Succès — l''échéance future est enregistrée, et la fonction rend la ligne mise à jour');

select is(
	(select count(*)::int from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'snoozed'),
	1,
	'Le fil porte UN `snoozed`, écrit par le trigger de table');

select is(
	(select (e.payload->>'until')::timestamptz from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'snoozed'),
	'2099-01-01T00:00:00Z'::timestamptz,
	'Le `payload` porte l''échéance');

select is(
	(select array_agg(k order by k) from public.card_events e,
	        lateral jsonb_object_keys(e.payload) k
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'snoozed'),
	array['until'],
	'Et RIEN d''autre : aucun libellé, règle du §14.6 inchangée');

-- Reporter une échéance est un geste ordinaire (§16.3) : accepté, et tracé une seconde fois.
select is(
	(select (public.snooze_card('5eed0000-0000-4000-8000-0000000000c1',
	                            '2099-06-01T00:00:00Z'::timestamptz)).snoozed_until),
	'2099-06-01T00:00:00Z'::timestamptz,
	'Une card DÉJÀ en sommeil est acceptée : la nouvelle échéance remplace l''ancienne');

select is(
	(select count(*)::int from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'snoozed'),
	2,
	'Le report écrit un SECOND `snoozed` : c''est un geste, non une erreur');

-- =============================================================================================
-- 5. `wake_card`, et son idempotence — docs/SPEC-cards.md §16.4
-- =============================================================================================

select is(
	(select (public.wake_card('5eed0000-0000-4000-8000-0000000000c1')).snoozed_until),
	null::timestamptz,
	'Le réveil remet l''échéance à `NULL` — le temps, lui, ne l''efface pas (§16.2)');

select is(
	(select count(*)::int from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'woken'),
	1,
	'Le fil porte UN `woken`, `payload` nommant l''échéance abandonnée');

select lives_ok($$
	select public.wake_card('5eed0000-0000-4000-8000-0000000000c1') $$,
	'Réveiller une card qui ne dort pas ne REFUSE pas : c''est un état déjà atteint');

select is(
	(select count(*)::int from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c1' and e.type = 'woken'),
	1,
	'Et n''écrit AUCUN second événement : deux onglets ouverts sur la même affaire ne produisent '
	'pas deux traces pour un seul réveil (§16.4)');

-- =============================================================================================
-- 6. La règle de discrétion, avec le MÊME profil — docs/SPEC-permissions-rls.md §4.3
-- =============================================================================================

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c1',
	                          '2099-01-01T00:00:00Z'::timestamptz) $$,
	'P0001', 'card_not_found',
	'La lectrice ne voit pas les cards de `grands-comptes` : la card lui est ABSENTE, et le refus '
	'ne lui apprend pas qu''elle existe');

select throws_ok($$
	select public.snooze_card('5eed0000-0000-4000-8000-0000000000c5',
	                          '2099-01-01T00:00:00Z'::timestamptz) $$,
	'42501', 'forbidden',
	'Sur une card qu''elle LIT sans y écrire, le refus devient `forbidden` — `42501` → `403`. '
	'Preuve de refus n° 1 du §7, exercée par un geste de plus');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

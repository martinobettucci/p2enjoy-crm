-- @verifies CRM-095 (docs/BACKLOG.md) — tranche T1 : créer une affaire depuis le board
-- @verifies docs/SPEC-cards.md §18.2 (le geste, l'étape initiale, ses refus), §18.5 (ligne pgTAP) ;
--           docs/SPEC-permissions-rls.md §4 (`cards_insertion`) ; docs/JOURNAL.md décision 609
--
-- La règle que ce fichier tient le plus fort : une affaire créée par le geste entre par l'étape
-- INITIALE du workflow de son channel — la règle du manuel (§5 bis.2) que rien ne tenait. Le workflow
-- est posé par le geste de `CRM-094` lui-même, comme dans un espace neuf. Tout se joue dans une
-- transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- W : l'espace. C : le channel vivant ; CA : archivé ; CT : à la corbeille ; CN : sur un workflow sans
-- étape initiale. ETR : un acteur sans aucune appartenance.
create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W',    '0c950000-0000-4000-8000-0000000000e1'),
	('ADM',  '0c950000-0000-4000-8000-000000000011'),
	('BIZ',  '0c950000-0000-4000-8000-000000000012'),
	('LECT', '0c950000-0000-4000-8000-000000000013'),
	('ETR',  '0c950000-0000-4000-8000-000000000014'),
	('TRK',  '0c950000-0000-4000-8000-0000000000a1'),
	('C',    '0c950000-0000-4000-8000-0000000000c1'),
	('CA',   '0c950000-0000-4000-8000-0000000000c2'),
	('CT',   '0c950000-0000-4000-8000-0000000000c3'),
	('CN',   '0c950000-0000-4000-8000-0000000000c4'),
	('WN',   '0c950000-0000-4000-8000-0000000000f1');
grant select on ids to authenticated;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated;

insert into public.workspaces (id, name, slug) values (pg_temp.id('W'), 'Espace 0075', 'espace-0075');
insert into public.profiles (id, full_name) values
	(pg_temp.id('ADM'), 'Administratrice 0075'),
	(pg_temp.id('BIZ'), 'Commercial 0075'),
	(pg_temp.id('LECT'), 'Lectrice 0075'),
	(pg_temp.id('ETR'), 'Étrangère 0075');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('W'), pg_temp.id('ADM'), 'admin'),
	(pg_temp.id('W'), pg_temp.id('BIZ'), 'business_developer'),
	(pg_temp.id('W'), pg_temp.id('LECT'), 'viewer');

-- Le workflow de départ, posé par le geste de `CRM-094` — l'espace neuf tel que la production le connaît.
select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures values ('workflow', public.creer_workflow_de_depart(pg_temp.id('W'))::text);
reset role;

-- Un workflow SANS étape initiale, pour le refus du §18.2 ligne 4.
insert into public.workflows (id, workspace_id, name, scope, is_default)
values (pg_temp.id('WN'), pg_temp.id('W'), 'Sans entrée', 'global', false);
insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, is_initial)
select pg_temp.id('WN'), pg_temp.id('W'), n.id, 1, false
  from public.workflow_nodes_catalog n
 where n.workspace_id = pg_temp.id('W') and n.key = 'relance';

insert into public.tracks (id, workspace_id, name, slug, position)
values (pg_temp.id('TRK'), pg_temp.id('W'), 'Premier track', 'premier-track', 1);
insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position, archived_at, deleted_at)
select c.id, pg_temp.id('W'), pg_temp.id('TRK'), c.nom, c.slug, c.flux, c.rang, c.archive, c.corbeille
  from (values
	(pg_temp.id('C'),  'Premier channel', 'premier-channel', (select valeur::uuid from mesures where cle = 'workflow'), 1, null::timestamptz, null::timestamptz),
	(pg_temp.id('CA'), 'Archivé',         'archive',         (select valeur::uuid from mesures where cle = 'workflow'), 2, now(),             null),
	(pg_temp.id('CT'), 'En corbeille',    'corbeille',       (select valeur::uuid from mesures where cle = 'workflow'), 3, null,              now()),
	(pg_temp.id('CN'), 'Sans entrée',     'sans-entree',     pg_temp.id('WN'),                                          4, null,              null)
  ) as c(id, nom, slug, flux, rang, archive, corbeille);

-- =============================================================================================
-- 1. Le contrat
-- =============================================================================================

select ok(
	not has_function_privilege('anon', 'public.creer_affaire(uuid, text)', 'EXECUTE')
	and has_function_privilege('authenticated', 'public.creer_affaire(uuid, text)', 'EXECUTE'),
	'1 — EXECUTE à `authenticated`, refusé à `anon` par le privilège');
select is(
	(select prosecdef::text || '|' || array_to_string(proconfig, ',') from pg_proc
	  where oid = 'public.creer_affaire(uuid, text)'::regprocedure),
	'false|search_path=""',
	'2 — SECURITY INVOKER, `search_path` vide : la RLS de `cards` fait foi');

-- =============================================================================================
-- 2. L'administratrice crée : étape INITIALE, titre ramené, position, adresse, événement
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures values ('carte', public.creer_affaire(pg_temp.id('C'), '  Première affaire  ')::text);
reset role;

select is(
	(select title from public.cards where id = (select valeur::uuid from mesures where cle = 'carte')),
	'Première affaire',
	'3 — le titre est ramené par `trim`');
select ok(
	(select s.is_initial from public.cards c join public.workflow_steps s on s.id = c.current_step_id
	  where c.id = (select valeur::uuid from mesures where cle = 'carte')),
	'4 — l''affaire entre par l''étape INITIALE du workflow de son channel');
select is(
	(select c.workflow_id from public.cards c where c.id = (select valeur::uuid from mesures where cle = 'carte')),
	(select valeur::uuid from mesures where cle = 'workflow'),
	'5 — son workflow est celui du channel');
select is(
	(select c.created_by from public.cards c where c.id = (select valeur::uuid from mesures where cle = 'carte')),
	pg_temp.id('ADM'),
	'6 — `created_by` est l''appelante');
select is(
	(select c.position from public.cards c where c.id = (select valeur::uuid from mesures where cle = 'carte')),
	1::numeric,
	'7 — la position vient du trigger existant : première de sa colonne');
select ok(
	(select c.email_local_part ~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$' from public.cards c
	  where c.id = (select valeur::uuid from mesures where cle = 'carte')),
	'8 — l''adresse vient du trigger existant');
select is(
	(select count(*)::int from public.card_events e
	  where e.card_id = (select valeur::uuid from mesures where cle = 'carte') and e.type = 'created'),
	1,
	'9 — l''événement « créée » du fil est écrit par le trigger existant');

-- =============================================================================================
-- 3. Le commercial crée ; la lectrice et l'étrangère non
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('BIZ'));
insert into mesures values ('carte-biz', public.creer_affaire(pg_temp.id('C'), 'Affaire du commercial')::text);
reset role;
select is(
	(select c.position from public.cards c where c.id = (select valeur::uuid from mesures where cle = 'carte-biz')),
	2::numeric,
	'10 — le commercial crée, et sa carte vient après la première');

select pg_temp.endosser(pg_temp.id('LECT'));
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('C'), 'Refusée') $$,
	'42501', null,
	'11 — la lectrice est refusée par `cards_insertion`');
reset role;

select pg_temp.endosser(pg_temp.id('ETR'));
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('C'), 'Refusée') $$,
	'P0002', 'channel introuvable',
	'12 — sans appartenance, le channel est introuvable : rien n''est divulgué');
reset role;

-- =============================================================================================
-- 4. Les refus nommés
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(
	$$ select public.creer_affaire('0c950000-0000-4000-8000-0000000000ff', 'Nulle part') $$,
	'P0002', 'channel introuvable',
	'13 — un channel inconnu : P0002');
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('CA'), 'Trop tard') $$,
	'P0001', 'channel ferme',
	'14 — un channel archivé : P0001 « channel ferme »');
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('CT'), 'Trop tard') $$,
	'P0001', 'channel ferme',
	'15 — un channel à la corbeille : P0001 « channel ferme »');
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('CN'), 'Sans entrée') $$,
	'P0001', 'aucune etape initiale',
	'16 — un workflow sans étape initiale : P0001, rien n''est écrit');
select throws_ok(
	$$ select public.creer_affaire(pg_temp.id('C'), '   ') $$,
	'23514', null,
	'17 — un titre blanc est refusé par la contrainte existante');
reset role;

select is(
	(select count(*)::int from public.cards where channel_id in (pg_temp.id('CA'), pg_temp.id('CT'), pg_temp.id('CN'))),
	0,
	'18 — aucun refus n''a laissé d''affaire derrière lui');
select is(
	(select count(*)::int from public.cards where channel_id = pg_temp.id('C')),
	2,
	'19 — le channel vivant porte les deux seules affaires créées');

-- =============================================================================================
-- 5. L'anonyme, et un appel sans identité
-- =============================================================================================

set local role anon;
select throws_ok(
	$$ select public.creer_affaire('0c950000-0000-4000-8000-0000000000c1', 'Anonyme') $$,
	'42501', null,
	'20 — l''anonyme est refusé par le privilège');
reset role;

select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select throws_ok(
	$$ select public.creer_affaire('0c950000-0000-4000-8000-0000000000c1', 'Sans identité') $$,
	'42501', 'authentification requise',
	'21 — sans identité, le contrôle de tête refuse');
reset role;

select is(
	(select count(*)::int from public.cards where channel_id = pg_temp.id('C')),
	2,
	'22 — ni l''anonyme ni l''appel sans identité n''ont écrit');

select * from finish();
rollback;

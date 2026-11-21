-- @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : un espace ne prend pas pour slug un premier segment d'une route globale
--           de la webapp (`workspaces_slug_not_reserved`), parce que l'espace est en tête du chemin des pages d'un espace
-- @verifies docs/SPEC-espace-courant.md §15.1 (et le refus nommé `identifiant_reserve` de `plateforme_creer_espace`) ; docs/SCHEMA.md « Migration `0196` » ; docs/JOURNAL.md décision 967
--
-- LES ESSAIS SONT ÉCRITS EN PROPRIÉTAIRE, DANS LA TRANSACTION DE LA PREUVE, QUI EST ANNULÉE.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_check('public', 'workspaces', '1 — `workspaces` porte une contrainte de vérification');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.workspaces'::regclass
                   and conname = 'workspaces_slug_not_reserved'),
	'2 — la contrainte des slugs réservés existe, sous son nom');

-- Chaque slug réservé est refusé (23514) ; le compte des refus égale la liste.
create or replace function pg_temp.refuse(p_slug text) returns boolean language plpgsql as $$
begin
	insert into public.workspaces (name, slug) values ('Sonde ' || p_slug, p_slug);
	return false;
exception when check_violation then
	return true;
end;
$$;
select is((select count(*)::int from unnest(array['aide', 'plateforme', 'contacts', 'objectifs', 'couts', 'pilotage', 'temps',
                                                   'rentabilite', 'ma-journee', 'affaires-figees', 'demarrage', 'connexion',
                                                   'auth', 'inbox', 'tracks', 'reglages']) s
            where pg_temp.refuse(s)), 16,
	'3 — les seize slugs réservés sont refusés, chacun');

select lives_ok($$insert into public.workspaces (name, slug) values ('Sonde studio', 'studio-lumen-sonde')$$,
	'4 — un slug ordinaire est accepté');
select ok(exists (select 1 from public.workspaces where slug = 'p2enjoy'),
	'5 — l''espace du seed garde son slug, `p2enjoy`, qui n''est pas réservé');

-- Le refus dit en clair par la plateforme : `identifiant_reserve`, sous un superadministrateur du seed (`docs/SPEC-seed.md`).
create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated', 'iss', 'p2enjoy-crm/session')::text, true);
	execute 'set local role authenticated';
end;
$$;
select pg_temp.endosser((select sub from public.superadmins order by accorde_le limit 1));
select throws_ok($$select public.plateforme_creer_espace('Contacts', 'contacts')$$, '23514', 'identifiant_reserve',
	'6 — la plateforme nomme le refus d''un slug réservé : `identifiant_reserve`');
select throws_ok($$select public.plateforme_creer_espace('Suite', 'p2enjoy')$$, '23505', 'identifiant_pris',
	'7 — le slug déjà employé garde son refus');
reset role;

select * from finish();
rollback;

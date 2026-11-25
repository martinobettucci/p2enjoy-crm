-- @verifies INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T1 : le fuseau d'un e-mail est celui de
--           l'ESPACE : la colonne `workspaces.timezone`, sa validation, `workspace_set_timezone` et son refus en base, le rendu des deux
--           variables horodatées au fuseau de l'espace, l'index de recherche resté en UTC
-- @verifies docs/SPEC-modeles-emails.md §8.6 bis ; docs/SCHEMA.md `workspaces` ; docs/SPEC-audit.md ; docs/JOURNAL.md décisions 992 et 996
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, DANS L'ORDRE
--   1. la colonne, son défaut `Europe/Paris`, et son refus d'un nom inconnu — par le catalogue et par une écriture directe ;
--   2. `app.is_valid_timezone` : les noms IANA, et le rejet du faux, du vide et du nul ;
--   3. `workspace_set_timezone` — l'administrateur de l'espace et le superadministrateur le règlent ; le lecteur, l'administrateur d'un
--      AUTRE espace, l'anonyme, un espace inexistant et un nom inconnu sont refusés EN BASE, par la même erreur pour les deux espaces ;
--   4. le journal d'audit nomme la colonne changée ;
--   5. LE RENDU : l'instant d'une même affaire se lit 11:00 en été et 10:00 en hiver à Paris, 05:00 et 04:00 à Montréal — l'heure d'été
--      est donc éprouvée, non supposée — pour `card.next_action_at` ET pour un champ commun `datetime` ; un champ `date` ne bouge pas ;
--   6. l'index de recherche (la fonction à trois paramètres) reste en UTC.
--
-- La suite pose ses fixtures en propriétaire et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

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

-- ---------------------------------------------------------------------------------------------
-- Fixtures — DEUX espaces à nous, pour que « l'administrateur d'un autre espace » soit un vrai autre espace.
--   F1 : Camille (administratrice), Farida (lectrice) ;   F2 : Driss (administrateur de F2 seulement).
-- ---------------------------------------------------------------------------------------------
insert into public.workspaces (id, name, slug) values
	('c0000000-0000-4000-8000-0000000000f1', 'Espace F1 — suite 0190', 'suite-0190-f1'),
	('c0000000-0000-4000-8000-0000000000f2', 'Espace F2 — suite 0190', 'suite-0190-f2');
insert into public.workspace_members (workspace_id, user_id, role) values
	('c0000000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-000000000011', 'admin'),
	('c0000000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-000000000013', 'viewer'),
	('c0000000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-000000000012', 'admin');
-- Sabine, la superadministratrice du seed, n'est membre d'aucun des deux : son droit ne vient que de sa qualité.
insert into public.superadmins (sub) values ('5eed0000-0000-4000-8000-000000000018') on conflict do nothing;

-- =============================================================================================
-- 1. La colonne
-- =============================================================================================
select has_column('public', 'workspaces', 'timezone', 'INC-216 — workspaces.timezone existe');

select col_not_null('public', 'workspaces', 'timezone', 'INC-216 — workspaces.timezone est non nulle');

select is(
	(select timezone from public.workspaces where id = 'c0000000-0000-4000-8000-0000000000f1'),
	'Europe/Paris',
	'INC-216 — un espace créé sans fuseau porte Europe/Paris (décision 992)');

select throws_ok(
	$$update public.workspaces set timezone = 'Mars/Phobos' where id = 'c0000000-0000-4000-8000-0000000000f1'$$,
	'23514', null,
	'INC-216 — une écriture directe d''un nom inconnu est refusée par la contrainte, jamais par l''écran');

-- =============================================================================================
-- 2. La validation
-- =============================================================================================
select ok(app.is_valid_timezone('Europe/Paris') and app.is_valid_timezone('UTC') and app.is_valid_timezone('America/Montreal'),
	'INC-216 — Europe/Paris, UTC et America/Montreal sont des fuseaux valides');

select ok(not app.is_valid_timezone('Mars/Phobos') and not app.is_valid_timezone('') and not coalesce(app.is_valid_timezone(null), false),
	'INC-216 — un nom inconnu, le vide et le nul ne le sont pas');

-- =============================================================================================
-- 3. Le réglage — qui peut, et que tout le reste est refusé EN BASE
-- =============================================================================================
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');   -- Camille, administratrice de F1
select lives_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f1', 'America/Montreal')$$,
	'INC-216 — l''administratrice de l''espace règle son fuseau');
select pg_temp.redevenir_proprietaire();

select is(
	(select timezone from public.workspaces where id = 'c0000000-0000-4000-8000-0000000000f1'),
	'America/Montreal',
	'INC-216 — le fuseau réglé est celui de l''espace');

select is(
	(select timezone from public.workspaces where id = 'c0000000-0000-4000-8000-0000000000f2'),
	'Europe/Paris',
	'INC-216 — l''autre espace n''a pas bougé');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');   -- Farida, lectrice de F1
select throws_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f1', 'UTC')$$,
	'42501', 'forbidden',
	'INC-216 — la lectrice de l''espace est refusée EN BASE (forbidden, 42501)');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');   -- Driss, administrateur de F2 seulement
select throws_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f1', 'UTC')$$,
	'42501', 'forbidden',
	'INC-216 — l''administrateur d''un AUTRE espace est refusé EN BASE');
select throws_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f9', 'UTC')$$,
	'42501', 'forbidden',
	'INC-216 — un espace inexistant rend le MÊME refus : l''existence d''un espace ne se devine pas');
select lives_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f2', 'Europe/Lisbon')$$,
	'INC-216 — Driss règle, lui, l''espace qu''il administre');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');   -- Sabine, superadministratrice, membre d'aucun des deux
select lives_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f1', 'Europe/Paris')$$,
	'INC-216 — la superadministratrice règle un espace dont elle n''est pas membre');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$select public.workspace_set_timezone('c0000000-0000-4000-8000-0000000000f1', 'Mars/Phobos')$$,
	'22023', 'invalid_timezone',
	'INC-216 — un nom inconnu est refusé (invalid_timezone, 22023), même à l''administratrice');
select throws_ok(
	$$select public.workspace_set_timezone(null, 'UTC')$$,
	'42501', 'forbidden',
	'INC-216 — un espace nul est refusé comme un espace inconnu');
select pg_temp.redevenir_proprietaire();

-- L'anonyme n'a pas le privilège d'exécuter la fonction (`revoke … from public, anon`).
select ok(
	not has_function_privilege('anon', 'public.workspace_set_timezone(uuid, text)', 'execute')
	and has_function_privilege('authenticated', 'public.workspace_set_timezone(uuid, text)', 'execute'),
	'INC-216 — l''anonyme ne peut pas exécuter workspace_set_timezone, l''authentifié le peut (la règle est dans la fonction)');

-- =============================================================================================
-- 4. Le journal d'audit nomme la colonne
-- =============================================================================================
select ok(
	exists (select 1 from public.audit_log a
	         where a.workspace_id = 'c0000000-0000-4000-8000-0000000000f1'
	           and a.entity_type = 'workspace' and a.action = 'updated'
	           and a.details::text like '%timezone%'),
	'INC-216 — le changement de fuseau est inscrit au journal d''audit de l''espace, la colonne nommée');

-- =============================================================================================
-- 5. LE RENDU — l'heure d'été est éprouvée, non supposée
-- =============================================================================================
-- L'affaire du seed `…0c2` et son espace principal (Paris par défaut) ; un champ commun `datetime`, un champ `date`, un modèle.
insert into public.card_common_fields (id, workspace_id, key, label, type, options) values
	('c0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001', 'tst-0190-rdv', 'Rendez-vous 0190', 'datetime', '{}'),
	('c0000000-0000-4000-8000-0000000000b2', '5eed0000-0000-4000-8000-000000000001', 'tst-0190-jour', 'Jour 0190', 'date', '{}');
insert into public.card_common_field_values (card_id, field_id, workspace_id, value) values
	('5eed0000-0000-4000-8000-0000000000c2', 'c0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001', '"2026-07-15T09:00:00Z"'),
	('5eed0000-0000-4000-8000-0000000000c2', 'c0000000-0000-4000-8000-0000000000b2', '5eed0000-0000-4000-8000-000000000001', '"2026-03-31"');
insert into public.mail_templates (id, workspace_id, name, subject, body_text, created_by)
values ('c0000000-0000-4000-8000-0000000000e1', '5eed0000-0000-4000-8000-000000000001', 'Fuseau — suite 0190',
        'Fuseau',
        'A=<{{card.next_action_at}}> B=<{{card.field.tst-0190-rdv}}> C=<{{card.field.tst-0190-jour}}>',
        '5eed0000-0000-4000-8000-000000000011');

create or replace function pg_temp.rendre()
returns text language sql stable as $$
	select r.body_text from public.rendre_modele_email('c0000000-0000-4000-8000-0000000000e1',
	                                                    '5eed0000-0000-4000-8000-0000000000c2') r;
$$;
create or replace function pg_temp.poser(instant timestamptz, fuseau text)
returns void language plpgsql as $$
begin
	update public.card_placements set next_action_at = instant where card_id = '5eed0000-0000-4000-8000-0000000000c2';
	update public.workspaces set timezone = fuseau where id = '5eed0000-0000-4000-8000-000000000001';
end;
$$;

-- Paris (le défaut) : UTC+2 en été, UTC+1 en hiver.
select pg_temp.poser('2026-07-15 09:00:00+00', 'Europe/Paris');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'A=<([^>]*)>'), '15/07/2026 11:00',
	'INC-216 — à Paris, 09:00 UTC en juillet se lit 11:00 (heure d''été)');
select pg_temp.redevenir_proprietaire();

select pg_temp.poser('2026-01-15 09:00:00+00', 'Europe/Paris');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'A=<([^>]*)>'), '15/01/2026 10:00',
	'INC-216 — à Paris, 09:00 UTC en janvier se lit 10:00 (heure d''hiver)');
select pg_temp.redevenir_proprietaire();

-- Montréal : UTC-4 en été, UTC-5 en hiver — un fuseau qui n'est pas celui du défaut, pour que le rendu ne soit pas câblé sur Paris.
select pg_temp.poser('2026-07-15 09:00:00+00', 'America/Montreal');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'A=<([^>]*)>'), '15/07/2026 05:00',
	'INC-216 — à Montréal, 09:00 UTC en juillet se lit 05:00');
select pg_temp.redevenir_proprietaire();

select pg_temp.poser('2026-01-15 09:00:00+00', 'America/Montreal');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'A=<([^>]*)>'), '15/01/2026 04:00',
	'INC-216 — à Montréal, 09:00 UTC en janvier se lit 04:00');
select pg_temp.redevenir_proprietaire();

-- Le champ commun `datetime` suit le même fuseau ; le champ `date` n'a pas d'heure et ne bouge pas.
select pg_temp.poser('2026-07-15 09:00:00+00', 'Europe/Paris');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'B=<([^>]*)>'), '15/07/2026 11:00',
	'INC-216 — un champ commun datetime se rend au fuseau de l''espace (Paris, été)');
select is(substring(pg_temp.rendre() from 'C=<([^>]*)>'), '31/03/2026',
	'INC-216 — un champ commun date n''a pas d''heure : il ne bouge pas');
select pg_temp.redevenir_proprietaire();

select pg_temp.poser('2026-07-15 09:00:00+00', 'America/Montreal');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'B=<([^>]*)>'), '15/07/2026 05:00',
	'INC-216 — le champ commun datetime suit le fuseau de l''espace (Montréal, été)');
select pg_temp.redevenir_proprietaire();

select pg_temp.poser('2026-07-15 09:00:00+00', 'UTC');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(substring(pg_temp.rendre() from 'A=<([^>]*)>'), '15/07/2026 09:00',
	'INC-216 — un espace réglé en UTC rend UTC : le fuseau vient de la colonne, non d''un câblage');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 6. La forme, et l'index de recherche qui reste en UTC
-- =============================================================================================
select has_function('app', 'card_common_field_texte', array['text', 'jsonb', 'jsonb', 'text'],
	'INC-216 — app.card_common_field_texte(text, jsonb, jsonb, text) existe');

select is(app.card_common_field_texte('datetime', '{}'::jsonb, '"2026-07-15T09:00:00Z"'::jsonb),
	'15/07/2026 09:00',
	'INC-216 — la version à trois paramètres, celle de l''index de recherche, reste en UTC');

select is(app.card_common_field_texte('datetime', '{}'::jsonb, '"2026-07-15T09:00:00Z"'::jsonb, 'Europe/Paris'),
	'15/07/2026 11:00',
	'INC-216 — la version à quatre paramètres rend au fuseau donné');

select ok(
	(select not p.prosecdef and p.provolatile = 's'
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'rendre_modele_email'),
	'INC-216 — rendre_modele_email reste security invoker et stable : la RLS s''applique au rendu comme avant');

-- Le défaut d'un espace NEUF reste Paris : le seul espace de la suite que personne n'a réglé.
select is(
	(select count(*)::int from public.workspaces where timezone is null),
	0,
	'INC-216 — aucun espace sans fuseau');

select * from finish();
rollback;

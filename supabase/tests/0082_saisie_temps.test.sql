-- @verifies CRM-098 (docs/BACKLOG.md) — tranche T1 : la saisie de temps et le coût du personnel, en base
-- @verifies docs/SPEC-temps.md §2 (minutes, quart de 105, plafond de 420 par personne, espace et jour), §3.1 (versions
--           immuables, non rétroactives sauf la première, supprimables avant leur effet, personne de l'espace), §3.2
--           (une cible exactement, une ligne par personne × jour × cible, seules les minutes changent, auteur retenu),
--           §4 (valorisation par date d'effet, `null` sans version, devises séparées), §5 (lecture : soi et les
--           administrateurs ; écriture : soi, ou un administrateur pour un membre, sur une cible que la personne lit),
--           §6.2 (`public.temps_valorise`) ; docs/SCHEMA.md §9 quater « Migration `0087` » ; CLAUDE.md §10
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : les deux tables, la RLS, la personne tenue par `NO ACTION` (INC-268 : aucune clé `RESTRICT`).
-- 2. Les contraintes des saisies, chacune contre le succès qui l'encadre, et le plafond — compté par espace.
-- 3. Les règles des versions : la première peut porter toute date, les suivantes jamais une date passée ; aucune ne se
--    modifie ; seule une version programmée se retire ; la personne doit appartenir à l'espace ou y avoir du temps.
-- 4. La valorisation, sur des montants calculés à la main : la version en vigueur le JOUR TRAVAILLÉ, le prorata d'une
--    heure, `null` avant toute version, une ligne par devise, le chemin d'une affaire jusqu'à son track.
-- 5. Les autorisations, avec les TROIS PROFILS RÉELS du seed et un administrateur du domaine : ce qui se lit, ce qui
--    s'écrit, pour qui, sur quelle cible — chaque refus contre le succès voisin.
-- 6. La suppression d'un espace entier emporte ses versions en vigueur (le déclencheur reconnaît la cascade).
--
-- Les dates sont relatives au jour d'exécution : la règle de non-rétroactivité se juge à `current_date`.
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(66);

create or replace function pg_temp.endosser(utilisateur uuid, admin_domaine boolean default false)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated', 'lelabs_admin', admin_domaine)::text, true);
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
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Un refus par le `using` d'une politique ne lève rien : il touche zéro ligne, et c'est sa seule mesure.
create or replace function pg_temp.lignes_touchees(requete text)
returns bigint language plpgsql as $$
declare
	touchees bigint;
begin
	execute requete;
	get diagnostics touchees = row_count;
	return touchees;
end;
$$;

-- Le rendu de `temps_valorise`, en une chaîne comparable — track/channel/affaire (trois derniers caractères),
-- minutes, montant, devise —, triée en collation C pour ne dépendre d'aucun ordre de ligne.
create or replace function pg_temp.valorise(p_debut date, p_fin date, p_profile uuid, p_track uuid default null, p_card uuid default null)
returns text language sql as $$
	select coalesce(string_agg(x, ' ' order by x collate "C"), '')
	  from (select coalesce(right(v.track_id::text, 3), '-') || '/' || coalesce(right(v.channel_id::text, 3), '-') || '/' ||
	               coalesce(right(v.card_id::text, 3), '-') || ':' || v.minutes || ':' ||
	               coalesce(v.montant::text, 'null') || ':' || coalesce(v.devise, 'null') as x
	          from public.temps_valorise(p_debut, p_fin, p_profile, p_track, p_card) v) r
$$;

-- ---------------------------------------------------------------------------------------------
-- Profils et objets du seed, mesurés sur la pile seedée :
--   Camille …011 admin ; Driss …012 business developer ; Farida …013 lectrice.
--   « Conseil & IA » …021 : droit fin `none` pour Farida ; son channel « Prospection » …031 lui est rouvert
--   (`member`) ; « Grands comptes » …032 lui reste fermé. « Studio web » …022, channel « Refonte de site » …034.
--   Affaires : …0cb dans « Prospection », …0c3 dans « Grands comptes ».
-- Fixtures propres à la suite : un second espace (…a087…001) et son track, un profil sans appartenance.
-- ---------------------------------------------------------------------------------------------

insert into public.workspaces (id, name, slug)
values ('a0870000-0000-4000-8000-000000000001', 'Espace de la suite 0082', 'suite-0082');
insert into public.tracks (id, workspace_id, name, slug)
values ('a0870000-0000-4000-8000-000000000002', 'a0870000-0000-4000-8000-000000000001', 'Track 0082', 'track-0082');
-- La première appartenance d'un espace est administratrice (garde de `workspace_members`).
insert into public.workspace_members (workspace_id, user_id, role)
values ('a0870000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000011', 'admin');
insert into public.workspace_members (workspace_id, user_id, role)
values ('a0870000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', 'business_developer');
insert into public.profiles (id, full_name) values
	('a0870000-0000-4000-8000-000000000010', 'Personne hors espace 0082'),
	('a0870000-0000-4000-8000-000000000011', 'Administrateur du domaine 0082');

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_table('public', 'couts_personnel', '1 — la table des versions de coût existe');
select has_table('public', 'saisies_temps', '2 — la table des saisies existe');
select is(
	(select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class
	  where oid in ('public.couts_personnel'::regclass, 'public.saisies_temps'::regclass)),
	'couts_personnel:true,saisies_temps:true', '3 — la RLS est active sur les deux tables');
select is(
	(select string_agg(conrelid::regclass::text || ':' || confdeltype::text, ',' order by conrelid::regclass::text)
	   from pg_constraint
	  where contype = 'f' and confrelid = 'public.profiles'::regclass
	    and conrelid in ('public.couts_personnel'::regclass, 'public.saisies_temps'::regclass)
	    and conkey = array[(select attnum from pg_attribute where attrelid = conrelid and attname = 'profile_id')]),
	'couts_personnel:a,saisies_temps:a', '4 — la personne est tenue par NO ACTION, jamais RESTRICT (INC-268)');

-- =============================================================================================
-- 2. Les saisies : contraintes et plafond
-- =============================================================================================

select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 105,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'5 — un quart (105 minutes) sur un channel se saisit');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 0,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'23514', null, '6 — zéro minute ne se saisit pas : une cellule vide est une ligne absente');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 20,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'23514', null, '7 — 20 minutes ne tombent pas sur un quart d''heure');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 31, 435,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'23514', null, '8 — une saisie ne dépasse pas une journée de 7 heures');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 15)$$,
	'23514', null, '9 — une saisie sans cible est refusée');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 15,
	          '5eed0000-0000-4000-8000-000000000022', '5eed0000-0000-4000-8000-000000000034')$$,
	'23514', null, '10 — une saisie sur deux cibles à la fois est refusée');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 15,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'23505', null, '11 — une seule saisie par personne, jour et cible : la cellule est la ligne');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 15,
	          'a0870000-0000-4000-8000-000000000002')$$,
	'23503', null, '12 — la cible appartient à l''espace de la saisie');

select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 210,
	          '5eed0000-0000-4000-8000-0000000000c3');
	  insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 105,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'13 — quatre quarts sur trois cibles le même jour : la journée est pleine, et permise');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 15,
	          '5eed0000-0000-4000-8000-000000000032')$$,
	'P0001', 'plafond journalier', '14 — un quart d''heure de plus que la journée est refusé');
select throws_ok(
	$$update public.saisies_temps set minutes = 120
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = current_date - 30
	     and channel_id = '5eed0000-0000-4000-8000-000000000034'$$,
	'P0001', 'plafond journalier', '15 — augmenter une saisie au-delà de la journée est refusé aussi');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('a0870000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 30, 420,
	          'a0870000-0000-4000-8000-000000000002')$$,
	'16 — le plafond se compte par espace : la même personne, le même jour, dans un autre espace');
select throws_ok(
	$$update public.saisies_temps set jour = current_date - 29
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = current_date - 30
	     and channel_id = '5eed0000-0000-4000-8000-000000000034'$$,
	'P0001', 'seules les minutes d''une saisie changent', '17 — une saisie ne change ni de jour ni de cible');

-- =============================================================================================
-- 3. Les versions de coût
-- =============================================================================================

select lives_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 365, 120.00)$$,
	'18 — la première version d''une personne peut porter une date passée');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 1, 130.00)$$,
	'P0001', 'version retroactive', '19 — une version suivante ne prend pas effet dans le passé');
select lives_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 30, 150.00);
	  insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart, devise)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 60, 200.00, 'CHF')$$,
	'20 — une augmentation programmée, puis une version en francs suisses');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 30, 160.00)$$,
	'23505', null, '21 — une seule version par personne et date d''effet');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 90, -1)$$,
	'23514', null, '22 — un coût négatif est refusé');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart, devise)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 90, 100, 'eur')$$,
	'23514', null, '23 — une devise hors du format ISO est refusée');
select throws_ok(
	$$update public.couts_personnel set cout_quart = 999
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and date_effet = current_date + 30$$,
	'P0001', 'version de cout immuable', '24 — une version ne se modifie pas, même programmée');
select throws_ok(
	$$delete from public.couts_personnel
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and date_effet = current_date - 365$$,
	'P0001', 'version en vigueur', '25 — une version en vigueur ne se retire pas');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', 'a0870000-0000-4000-8000-000000000010', current_date, 100)$$,
	'P0001', 'personne hors de l''espace', '26 — une personne sans appartenance ni temps saisi ne reçoit pas de coût');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', 'a0870000-0000-4000-8000-000000000010', current_date - 2, 105,
	          '5eed0000-0000-4000-8000-000000000022');
	  insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', 'a0870000-0000-4000-8000-000000000010', current_date - 10, 100)$$,
	'27 — qui a déjà saisi du temps dans l''espace (un administrateur du domaine) reçoit un coût');

-- =============================================================================================
-- 4. La valorisation — montants calculés à la main
-- =============================================================================================
-- Driss, le jour J-30 : 105 min sur « Refonte de site » (…034 de …022), 210 sur l'affaire …0c3 (« Grands comptes »
-- …032 de …021), 105 sur le track …022 ; version de 120 € en vigueur → 120, 240, 120. Dans le second espace : 420
-- minutes, aucune version → non valorisé.

select is(
	pg_temp.valorise(current_date - 30, current_date - 30, '5eed0000-0000-4000-8000-000000000012'),
	'002/-/-:420:null:null 021/032/0c3:210:240.00:EUR 022/-/-:105:120.00:EUR 022/034/-:105:120.00:EUR',
	'28 — la version en vigueur le jour travaillé valorise chaque cible ; sans version, montant et devise nuls');

select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id) values
	  ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 400, 60,
	   '5eed0000-0000-4000-8000-000000000034'),
	  ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 29, 60,
	   '5eed0000-0000-4000-8000-000000000034'),
	  ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 30, 105,
	   '5eed0000-0000-4000-8000-000000000034'),
	  ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 60, 105,
	   '5eed0000-0000-4000-8000-000000000034')$$,
	'29 — des saisies avant la première version, en heures, et faites d''avance');
select is(
	pg_temp.valorise(current_date - 400, current_date - 400, '5eed0000-0000-4000-8000-000000000012'),
	'022/034/-:60:null:null', '30 — avant la première version, le temps compte et n''est pas valorisé');
select is(
	pg_temp.valorise(current_date - 29, current_date - 29, '5eed0000-0000-4000-8000-000000000012'),
	'022/034/-:60:68.57:EUR', '31 — une heure vaut 60/105 d''un quart : 120 × 60 / 105 = 68,57');
select is(
	pg_temp.valorise(current_date + 30, current_date + 60, '5eed0000-0000-4000-8000-000000000012'),
	'022/034/-:105:150.00:EUR 022/034/-:105:200.00:CHF',
	'32 — une saisie faite d''avance prend la version de son jour, et les devises ne s''additionnent pas');
select is(
	pg_temp.valorise(current_date - 30, current_date - 30, '5eed0000-0000-4000-8000-000000000012',
	                 '5eed0000-0000-4000-8000-000000000021'),
	'021/032/0c3:210:240.00:EUR', '33 — le filtre d''un track retient le temps de ses affaires (chemin complet)');
select is(
	pg_temp.valorise(current_date - 400, current_date + 60, null, null, '5eed0000-0000-4000-8000-0000000000c3'),
	'021/032/0c3:210:240.00:EUR', '34 — le filtre d''une affaire');
select lives_ok(
	$$delete from public.couts_personnel
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and date_effet = current_date + 60$$,
	'35 — une version programmée se retire');
select is(
	pg_temp.valorise(current_date + 60, current_date + 60, '5eed0000-0000-4000-8000-000000000012'),
	'022/034/-:105:150.00:EUR', '36 — la version retirée, la saisie retombe sur la version précédente');

-- =============================================================================================
-- 5. Les autorisations, avec les profils réels
-- =============================================================================================
-- Fixtures en propriétaire : une saisie de Farida, une version de Camille.
insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 30, 105,
        '5eed0000-0000-4000-8000-000000000031');
insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000011', current_date - 100, 140.00);

-- --- Lecture ---------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.saisies_temps where profile_id = '5eed0000-0000-4000-8000-000000000013'),
	0, '37 — Driss ne lit pas le temps de Farida');
select is((select count(*)::int from public.saisies_temps where profile_id = '5eed0000-0000-4000-8000-000000000012'),
	8, '38 — Driss lit son propre temps, dans ses deux espaces');
select is((select string_agg(cout_quart::text, ',' order by date_effet) from public.couts_personnel),
	'120.00,150.00', '39 — Driss lit son propre coût (décision 621, point 3), et seulement le sien');
select throws_ok(
	$$insert into public.couts_personnel (workspace_id, profile_id, date_effet, cout_quart)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date + 5, 999)$$,
	'42501', null, '40 — Driss ne se donne pas de coût');
select is(pg_temp.lignes_touchees(
	$$delete from public.couts_personnel where profile_id = '5eed0000-0000-4000-8000-000000000012'
	   and date_effet = current_date + 30$$),
	0::bigint, '41 — Driss ne retire pas sa version programmée');
select is(
	pg_temp.valorise(current_date - 30, current_date - 30, null),
	'002/-/-:420:null:null 021/032/0c3:210:240.00:EUR 022/-/-:105:120.00:EUR 022/034/-:105:120.00:EUR',
	'42 — pour Driss, le rapport ne contient que son temps');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*)::int from public.couts_personnel), 0, '43 — Farida, sans version, ne lit aucun coût');
select is(
	pg_temp.valorise(current_date - 30, current_date - 30, null),
	'021/031/-:105:null:null', '44 — Farida lit son temps, non valorisé faute de version');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.saisies_temps where profile_id = '5eed0000-0000-4000-8000-000000000013'),
	1, '45 — un administrateur lit le temps de chacun');
select is((select count(*)::int from public.couts_personnel where workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	4, '46 — un administrateur lit le coût de chacun');
select is(pg_temp.lignes_touchees(
	$$delete from public.couts_personnel where profile_id = '5eed0000-0000-4000-8000-000000000012'
	   and date_effet = current_date + 30$$),
	1::bigint, '47 — un administrateur retire une version programmée');

-- --- Écriture de son propre temps --------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 29, 105,
	          '5eed0000-0000-4000-8000-000000000031')$$,
	'48 — une lectrice saisit son temps sur un channel qu''elle lit');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 29, 105,
	          '5eed0000-0000-4000-8000-000000000021')$$,
	'42501', null, '49 — mais pas sur le track qui lui est fermé');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 29, 105,
	          '5eed0000-0000-4000-8000-000000000032')$$,
	'42501', null, '50 — ni sur un channel de ce track qu''on ne lui a pas rouvert');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 29, 105,
	          '5eed0000-0000-4000-8000-0000000000cb')$$,
	'51 — elle saisit sur une affaire qu''elle lit');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 29, 105,
	          '5eed0000-0000-4000-8000-0000000000c3')$$,
	'42501', null, '52 — et non sur une affaire qu''elle ne lit pas');

-- --- Pour autrui -------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 28, 105,
	          '5eed0000-0000-4000-8000-000000000031')$$,
	'42501', null, '53 — un membre ne saisit pas le temps d''un autre');
select is(pg_temp.lignes_touchees(
	$$update public.saisies_temps set minutes = 15 where profile_id = '5eed0000-0000-4000-8000-000000000013'$$),
	0::bigint, '54 — ni ne le modifie');
select is(pg_temp.lignes_touchees(
	$$delete from public.saisies_temps where profile_id = '5eed0000-0000-4000-8000-000000000013'$$),
	0::bigint, '55 — ni ne le retire');
select is(pg_temp.lignes_touchees(
	$$update public.saisies_temps set minutes = 90 where profile_id = '5eed0000-0000-4000-8000-000000000012'
	   and jour = current_date - 29$$),
	1::bigint, '56 — il modifie son propre temps');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 28, 105,
	          '5eed0000-0000-4000-8000-000000000031')$$,
	'57 — un administrateur saisit le temps d''une lectrice, sur une cible qu''elle lit');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', current_date - 28, 105,
	          '5eed0000-0000-4000-8000-000000000032')$$,
	'42501', null, '58 — mais pas sur une cible qu''elle ne lit pas, même si lui la lit');
select is(pg_temp.lignes_touchees(
	$$update public.saisies_temps set minutes = 105 where profile_id = '5eed0000-0000-4000-8000-000000000012'
	   and jour = current_date - 29$$),
	1::bigint, '59 — un administrateur corrige le temps d''un autre');

select pg_temp.redevenir_proprietaire();
select is(
	(select string_agg(coalesce(right(created_by::text, 3), '-') || '>' || coalesce(right(updated_by::text, 3), '-'), ','
	                   order by jour)
	   from public.saisies_temps
	  where (profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = current_date - 29
	         and channel_id = '5eed0000-0000-4000-8000-000000000034')
	     or (profile_id = '5eed0000-0000-4000-8000-000000000013' and jour = current_date - 28)),
	'->011,011>011',
	'60 — la trace de l''auteur : la création et la dernière correction (décision 621, point 7)');

-- --- Un administrateur du domaine, sans ligne d'appartenance (0079) ----------------------------
select pg_temp.endosser('a0870000-0000-4000-8000-000000000011', true);
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', 'a0870000-0000-4000-8000-000000000011', current_date - 3, 105,
	          '5eed0000-0000-4000-8000-000000000021')$$,
	'61 — un administrateur du domaine saisit son temps sans ligne d''appartenance');
select pg_temp.endosser('a0870000-0000-4000-8000-000000000010');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', 'a0870000-0000-4000-8000-000000000010', current_date - 3, 105,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'42501', null, '62 — une personne hors de l''espace ne saisit rien');

-- --- Anonyme ---------------------------------------------------------------------------------
select pg_temp.anonyme();
select throws_ok($$select count(*) from public.saisies_temps$$, '42501', null, '63 — un anonyme ne lit aucune saisie');
select throws_ok($$select * from public.temps_valorise(current_date - 30, current_date)$$,
	'42501', null, '64 — ni le rapport');

-- =============================================================================================
-- 6. La suppression d'un espace entier
-- =============================================================================================
select pg_temp.redevenir_proprietaire();
select lives_ok($$delete from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'$$,
	'65 — l''espace du seed se supprime, versions en vigueur comprises');
select is((select count(*)::int from public.couts_personnel where workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	0, '66 — et ses versions partent avec lui');

select * from finish();

rollback;

-- @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture
-- @verifies docs/SPEC-costs.md §2.1 (budgets), §2.2 (occurrences, aucune génération),
--           §3.1 (lecture par le track), §3.2 (écriture réservée à l'administrateur)
-- @verifies docs/SCHEMA.md §9 bis.4, §9 bis.5 (colonnes), §9 bis.7 (politiques)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.3 (droits fins),
--           §3.5 (récursion)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME des deux tables et l'activation de la RLS. Une table livrée sans RLS serait ouverte
--    à tout porteur de jeton, et le reste de la suite mesurerait des refus imaginaires.
--
-- 2. LES CONTRAINTES DE VALEUR, chacune contre son succès correspondant : une assertion qui ne
--    prouverait que le refus serait verte sur une contrainte qui refuse tout. C'est en
--    particulier vrai des DEUX ABSENCES délibérées — aucun signe imposé sur les montants (§2.1),
--    aucune comparaison entre `period_start` et `period_end` (§2.2) —, qui ne se prouvent QUE par
--    un succès.
--
-- 3. L'UNICITÉ DU NOM LIMITÉE AUX BUDGETS OUVERTS, sur les quatre cas qui la définissent, dont
--    celui que la spécification cite en exemple — clôturer « Salon 2025 » puis en rouvrir un —,
--    et le REVERS de ce choix : rouvrir un budget clos dont le nom a été repris est refusé. C'est
--    le contrat de réversibilité de la clôture que la Definition of Done réclame, et il est
--    mesuré ici plutôt que supposé.
--
-- 4. LA RÉCURRENCE TENUE DES DEUX CÔTÉS. Une garde posée seulement sur `budget_occurrences`
--    laisserait passer « créer un budget récurrent, lui poser des occurrences, puis retirer sa
--    récurrence ». L'invariant serait faux SANS qu'aucune ligne interdite n'ait été insérée, et
--    `CRM-085` s'appuierait dessus pour décider si `occurrence_id` est exigée. Les deux triggers
--    sont donc éprouvés séparément.
--
-- 5. L'INDÉPENDANCE DES DEUX CLÔTURES (§2.2) : clôturer le budget ne clôt pas ses occurrences, et
--    clôturer une occurrence ne clôt pas le budget. Deux décisions de gestion distinctes.
--
-- 6. LA FORME DES DEUX FONCTIONS D'APPUI — `security definer`, `search_path` vidé, propriétaire,
--    privilèges. C'est la condition de la décision 27 : une fonction `invoker` lue par la
--    politique de `budget_occurrences` rejouerait la RLS de `budgets` à chaque ligne.
--
-- 7. LES POLITIQUES, jouées avec les TROIS PROFILS RÉELS du seed et fondées sur des mesures
--    relevées sur la pile plutôt que supposées :
--      * Camille (`admin`) lit les CINQ tracks **bien qu'elle porte un droit fin `none` sur
--        « Conseil & IA »** — un administrateur n'est jamais restreint, et le seed en fait une
--        démonstration permanente ;
--      * Driss (`business_developer`) lit les cinq tracks et n'écrit AUCUN budget : c'est la
--        ligne de partage du §3, « le budget est un cadre, l'affectation est un geste » ;
--      * Farida (`viewer`) **ne lit pas « Conseil & IA »**, donc pas ses budgets.
--    Ces trois écarts ne sont pas décoratifs : chacun porte une assertion qu'aucun autre profil ne
--    pourrait produire.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

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
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- UNE MISE À JOUR REFUSÉE PAR LE `using` D'UNE POLITIQUE NE LÈVE RIEN : elle touche zéro ligne.
-- Le nombre de lignes est donc la SEULE mesure d'un tel refus, et `throws_ok` y serait rouge sur
-- un produit correct. `WITH ... RETURNING` ne convient pas — PostgreSQL refuse une CTE
-- modifiante ailleurs qu'au premier niveau, MESURÉ ici même —, d'où cette fonction.
--
-- Elle est `security invoker`, ce qui est la condition de sa validité : exécutée avec les droits
-- de l'appelant ENDOSSÉ, elle subit la RLS que l'assertion mesure. En `definer` elle les
-- traverserait et rendrait toujours « une ligne ».
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

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire — donc hors RLS. Les identifiants sont STABLES pour que les
-- messages d'assertion restent lisibles d'une exécution à l'autre.
-- ---------------------------------------------------------------------------------------------
-- LES NOMS PORTENT CELUI DU FICHIER, et cette précaution a été apprise sur `CRM-082` : une
-- fixture homonyme d'une ligne du seed fait mourir la suite entière sur son unicité, et le
-- diagnostic ressemble alors à un défaut du produit.
--
-- LES DEUX TRACKS RETENUS LE SONT POUR CE QU'ILS SÉPARENT, mesuré sur la pile seedée :
--   * « Conseil & IA » (…021) — lu par Camille et Driss, **INVISIBLE à Farida** (droit fin
--     `none`, que son `channel_members` sur « Prospection » ne rouvre pas au niveau du TRACK).
--     C'est le seul cas qui prouve le §3.1 ;
--   * « Studio web »   (…022) — lu par les trois. Il sert de témoin : sans lui, l'absence de
--     lecture de Farida se confondrait avec « elle ne lit aucun budget ».

insert into public.budgets (id, track_id, name, currency, planned_amount, is_recurrent,
                            closed_at, position, created_by)
values
	-- Simple, ouvert, sur le track fermé à la lectrice.
	('b0000000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000021',
	 'Budget simple de la suite 0048', 'EUR', 12000.00, false, null, 100,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Simple, ouvert, sur le track lu par les trois — le témoin.
	('b0000000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000022',
	 'Budget témoin de la suite 0048', 'EUR', 8000.00, false, null, 100,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Récurrent, ouvert, sur le track fermé à la lectrice.
	('b0000000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000021',
	 'Budget récurrent de la suite 0048', 'EUR', 24000.00, true, null, 101,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Clôturé : il LIBÈRE son nom, et c'est la moitié de la démonstration du §3 ci-dessous.
	('b0000000-0000-4000-8000-000000000004', '5eed0000-0000-4000-8000-000000000022',
	 'Budget clôturé de la suite 0048', 'EUR', 3000.00, false, now(), 101,
	 '5eed0000-0000-4000-8000-000000000011');

insert into public.budget_occurrences (id, budget_id, label, period_start, period_end,
                                       planned_amount, closed_at)
values
	('b0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-000000000003',
	 'Occurrence ouverte 0048', '2026-01-01', '2026-01-31', 2000.00, null),
	('b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-000000000003',
	 'Occurrence close 0048', '2026-02-01', '2026-02-28', 2000.00, now());

-- =============================================================================================
-- 1. Forme des tables et refus par défaut
-- =============================================================================================

select has_table('public', 'budgets',            'CRM-084 : la table budgets existe');
select has_table('public', 'budget_occurrences', 'CRM-084 : la table budget_occurrences existe');

select is(
	(select count(*) from pg_class
	  where oid in ('public.budgets'::regclass, 'public.budget_occurrences'::regclass)
	    and relrowsecurity),
	2::bigint,
	'CRM-084 : les DEUX tables sont en refus par défaut — RLS activée');

-- `on delete cascade` sur le track : un track détruit emporte ses enveloppes, qui n'ont aucun
-- sens hors de lui. Constaté au CATALOGUE plutôt que par une suppression réelle, qui déclencherait
-- la corbeille de `CRM-077` et prouverait autre chose.
select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.budgets'::regclass
	    and confrelid = 'public.tracks'::regclass),
	'c'::"char",
	'CRM-084 : budgets.track_id est ON DELETE CASCADE');

select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.budget_occurrences'::regclass
	    and confrelid = 'public.budgets'::regclass),
	'c'::"char",
	'CRM-084 : budget_occurrences.budget_id est ON DELETE CASCADE');

-- =============================================================================================
-- 2. Contraintes de valeur — chaque refus contre son succès, et les DEUX absences délibérées
-- =============================================================================================

select throws_ok(
	$$insert into public.budgets (track_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000021', '   ', 200)$$,
	'23514',
	null,
	'CRM-084 : un nom de budget réduit à des blancs est refusé (docs/SPEC-costs.md §2.1)');

select throws_ok(
	$$insert into public.budgets (track_id, name, currency, position)
	  values ('5eed0000-0000-4000-8000-000000000021', 'Devise minuscule 0048', 'eur', 200)$$,
	'23514',
	null,
	'CRM-084 : une devise hors du format ^[A-Z]{3}$ est refusée');

select lives_ok(
	$$insert into public.budgets (id, track_id, name, currency, position)
	  values ('b0000000-0000-4000-8000-00000000000c',
	          '5eed0000-0000-4000-8000-000000000021', 'Devise suisse 0048', 'CHF', 200)$$,
	'CRM-084 : une devise à trois majuscules est acceptée — le refus ci-dessus porte bien sur la FORME');

-- AUCUNE CONTRAINTE DE SIGNE, et cela ne se prouve QUE par un succès (§2.1). Un avoir, une remise
-- ou un remboursement sont des montants négatifs légitimes, même doctrine que `cards.amount`.
select lives_ok(
	$$insert into public.budgets (id, track_id, name, planned_amount, position)
	  values ('b0000000-0000-4000-8000-00000000000d',
	          '5eed0000-0000-4000-8000-000000000021', 'Enveloppe négative 0048', -500.00, 201)$$,
	'CRM-084 : une enveloppe NÉGATIVE est acceptée — aucune contrainte de signe (docs/SPEC-costs.md §2.1)');

select throws_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000003', E' ')$$,
	'23514',
	null,
	'CRM-084 : un libellé d''occurrence réduit à un blanc insécable est refusé');

-- LES PÉRIODES SONT PUREMENT DESCRIPTIVES (§2.2) : elles ordonnent et libellent, elles ne jugent
-- rien. Une borne de fin antérieure à la borne de début est donc ACCEPTÉE — c'est l'état normal
-- d'une saisie en cours, et la contraindre serait la première déduction d'une série que la
-- spécification interdit.
select lives_ok(
	$$insert into public.budget_occurrences (id, budget_id, label, period_start, period_end)
	  values ('b0000000-0000-4000-8000-0000000000a9', 'b0000000-0000-4000-8000-000000000003',
	          'Période à l''envers 0048', '2026-06-30', '2026-06-01')$$,
	'CRM-084 : une période dont la fin précède le début est ACCEPTÉE — les bornes sont descriptives (docs/SPEC-costs.md §2.2)');

-- =============================================================================================
-- 3. L'unicité du nom ne porte que sur les budgets OUVERTS
-- =============================================================================================

select throws_ok(
	$$insert into public.budgets (track_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000021', 'Budget simple de la suite 0048', 202)$$,
	'23505',
	null,
	'CRM-084 : deux budgets OUVERTS de même nom sur le même track sont refusés');

-- LE CAS QUE LA SPÉCIFICATION CITE EN EXEMPLE (§2.1) : clôturer « Salon 2025 » puis en ouvrir un
-- nouveau l'année suivante est un geste NORMAL. Le nom d'un budget clos est libéré.
select lives_ok(
	$$insert into public.budgets (id, track_id, name, position)
	  values ('b0000000-0000-4000-8000-000000000005', '5eed0000-0000-4000-8000-000000000022',
	          'Budget clôturé de la suite 0048', 203)$$,
	'CRM-084 : le nom d''un budget CLÔTURÉ est libéré et reprenable (docs/SPEC-costs.md §2.1)');

select lives_ok(
	$$insert into public.budgets (id, track_id, name, position)
	  values ('b0000000-0000-4000-8000-000000000006', '5eed0000-0000-4000-8000-000000000022',
	          'Budget simple de la suite 0048', 204)$$,
	'CRM-084 : l''unicité est par TRACK — le même nom vit sur un autre track');

-- LE REVERS DU CHOIX CI-DESSUS, ET C'EST LE CONTRAT DE RÉVERSIBILITÉ DE LA CLÔTURE. Rouvrir un
-- budget clos est une simple mise à jour, qu'aucune garde n'interdit — mais son nom a pu être
-- repris entre-temps, et l'index partiel est alors la seule limite. Sans cette assertion, la
-- Definition of Done resterait sans réponse sur « clôture réversible ou non ».
select throws_ok(
	$$update public.budgets set closed_at = null
	   where id = 'b0000000-0000-4000-8000-000000000004'$$,
	'23505',
	null,
	'CRM-084 : rouvrir un budget clos dont le nom a été REPRIS est refusé par l''index partiel');

select lives_ok(
	$$update public.budgets set closed_at = null
	   where id = 'b0000000-0000-4000-8000-00000000000d'$$,
	'CRM-084 : rouvrir un budget clos dont le nom est LIBRE est accepté — la clôture est réversible');

-- =============================================================================================
-- 4. Attribution automatique de `position`, bornée au track
-- =============================================================================================

insert into public.budgets (id, track_id, name)
values ('b0000000-0000-4000-8000-000000000007', '5eed0000-0000-4000-8000-000000000021',
        'Position omise 0048');

select is(
	(select position from public.budgets where id = 'b0000000-0000-4000-8000-000000000007'),
	202::numeric,
	'CRM-084 : une position omise reçoit le maximum du TRACK plus un — mesuré à 202, les budgets 203 et 204 vivant sur l''AUTRE track');

-- Le maximum est celui du track, jamais celui de la table : deux tracks numérotent leurs budgets
-- indépendamment, comme deux workspaces numérotent leurs tracks.
--
-- LE TRACK RETENU EST « Pipeline 2024 » (…024), ET LE CHOIX A ÉTÉ MESURÉ. La première rédaction
-- prenait « Formation » (…023), qui ne portait alors aucun budget ; le seed de cette même unité
-- lui en a ensuite posé un — « Suisse romande », en CHF, sans lequel le regroupement par devise du
-- §4.5 serait indémontrable —, et l'assertion attendait 1 là où le trigger rendait légitimement 2.
-- Ce n'était pas un défaut du produit mais une fixture périmée par son propre seed. « Pipeline
-- 2024 » est le seul track que le seed laisse sans budget ; son état archivé est sans effet ici,
-- l'archivage ne participant pas au calcul de la position.
insert into public.budgets (id, track_id, name)
values ('b0000000-0000-4000-8000-000000000008', '5eed0000-0000-4000-8000-000000000024',
        'Position omise sur un track vierge 0048');

select is(
	(select position from public.budgets where id = 'b0000000-0000-4000-8000-000000000008'),
	1::numeric,
	'CRM-084 : sur un track SANS budget, la première position est 1 — le maximum est PAR TRACK');

-- =============================================================================================
-- 5. La récurrence, tenue des DEUX côtés
-- =============================================================================================

-- --- 5.1 Côté occurrence ----------------------------------------------------------------------

select throws_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000001', 'Occurrence interdite 0048')$$,
	'23514',
	null,
	'CRM-084 : une occurrence sur un budget NON récurrent est refusée (docs/SPEC-costs.md §2.2)');

select lives_ok(
	$$insert into public.budget_occurrences (id, budget_id, label)
	  values ('b0000000-0000-4000-8000-0000000000a3',
	          'b0000000-0000-4000-8000-000000000003', 'Occurrence licite 0048')$$,
	'CRM-084 : une occurrence sur un budget RÉCURRENT est acceptée');

-- Le trigger porte aussi sur la mise à jour de `budget_id` : sans cela, on déplacerait une
-- occurrence existante vers un budget simple et l'invariant serait faux sans aucune insertion.
select throws_ok(
	$$update public.budget_occurrences
	     set budget_id = 'b0000000-0000-4000-8000-000000000001'
	   where id = 'b0000000-0000-4000-8000-0000000000a3'$$,
	'23514',
	null,
	'CRM-084 : DÉPLACER une occurrence vers un budget non récurrent est refusé');

-- --- 5.2 Côté budget --------------------------------------------------------------------------
-- C'est le chemin que la lecture rapide manque : aucune ligne interdite n'est insérée, et pourtant
-- l'invariant deviendrait faux.

select throws_ok(
	$$update public.budgets set is_recurrent = false
	   where id = 'b0000000-0000-4000-8000-000000000003'$$,
	'23514',
	null,
	'CRM-084 : retirer la récurrence d''un budget qui PORTE des occurrences est refusé');

select lives_ok(
	$$with vidage as (
	      delete from public.budget_occurrences
	       where budget_id = 'b0000000-0000-4000-8000-000000000003' returning 1)
	  update public.budgets set is_recurrent = false
	   where id = 'b0000000-0000-4000-8000-000000000003'
	     and (select count(*) from vidage) >= 0$$,
	'CRM-084 : la récurrence se retire une fois les occurrences supprimées — le refus porte sur elles, pas sur le geste');

-- La fixture récurrente est rétablie pour la suite : les sections 6 et 9 en dépendent.
update public.budgets set is_recurrent = true
 where id = 'b0000000-0000-4000-8000-000000000003';

insert into public.budget_occurrences (id, budget_id, label, closed_at)
values
	('b0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-000000000003',
	 'Occurrence ouverte 0048', null),
	('b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-000000000003',
	 'Occurrence close 0048', now());

-- =============================================================================================
-- 6. Unicité du libellé, et INDÉPENDANCE des deux clôtures
-- =============================================================================================

select throws_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000003', 'Occurrence ouverte 0048')$$,
	'23505',
	null,
	'CRM-084 : deux occurrences de même libellé sur le même budget sont refusées');

-- Contrairement au nom d'un budget, ce libellé n'est PAS libéré par la clôture : un mois ne
-- revient pas, et deux « Janvier 2026 » seraient une erreur de saisie dans tous les cas.
select throws_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000003', 'Occurrence close 0048')$$,
	'23505',
	null,
	'CRM-084 : le libellé d''une occurrence CLOSE reste pris — l''unicité n''y est pas partielle');

-- Clôturer le budget ne clôt pas ses occurrences (§2.2) : deux décisions de gestion distinctes.
update public.budgets set closed_at = now()
 where id = 'b0000000-0000-4000-8000-000000000003';

select is(
	(select count(*) from public.budget_occurrences
	  where budget_id = 'b0000000-0000-4000-8000-000000000003' and closed_at is null),
	1::bigint,
	'CRM-084 : clôturer un budget ne clôt PAS ses occurrences (docs/SPEC-costs.md §2.2)');

update public.budgets set closed_at = null
 where id = 'b0000000-0000-4000-8000-000000000003';

update public.budget_occurrences set closed_at = now()
 where id = 'b0000000-0000-4000-8000-0000000000a1';

select is(
	(select closed_at from public.budgets where id = 'b0000000-0000-4000-8000-000000000003'),
	null::timestamptz,
	'CRM-084 : clôturer la DERNIÈRE occurrence ouverte ne clôt pas son budget');

update public.budget_occurrences set closed_at = null
 where id = 'b0000000-0000-4000-8000-0000000000a1';

-- =============================================================================================
-- 7. Forme des deux fonctions d'appui
-- =============================================================================================
-- C'est la condition de la décision 27, et elle ne se lit pas dans le comportement : une fonction
-- `invoker` rendrait les mêmes verdicts jusqu'au jour où la politique de `budget_occurrences`
-- rejouerait celle de `budgets` à chaque ligne.

select is(
	(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname in ('can_read_budget', 'can_write_budget')
	    and p.prosecdef),
	2::bigint,
	'CRM-084 : les DEUX fonctions d''appui sont SECURITY DEFINER (décision 27)');

select is(
	(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname in ('can_read_budget', 'can_write_budget')
	    and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
	2::bigint,
	'CRM-084 : les DEUX fonctions ont un search_path VIDÉ');

select is(
	(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname in ('can_read_budget', 'can_write_budget')
	    and pg_get_userbyid(p.proowner) = 'postgres'),
	2::bigint,
	'CRM-084 : les DEUX fonctions appartiennent à postgres — sans quoi SECURITY DEFINER ne vaut rien');

select is(
	(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname in ('can_read_budget', 'can_write_budget')
	    and p.provolatile = 's'),
	2::bigint,
	'CRM-084 : les DEUX fonctions sont STABLE — elles sont lues à chaque ligne d''une politique');

-- `anon` reçoit `EXECUTE` pour la même raison que dans CRM-020 et CRM-082 : sans lui, un appelant
-- anonyme recevrait une ERREUR DE PRIVILÈGE au lieu du refus silencieux attendu — une table vide,
-- jamais un aveu.
select ok(
	has_function_privilege('anon', 'app.can_read_budget(uuid)', 'execute')
	and has_function_privilege('anon', 'app.can_write_budget(uuid)', 'execute'),
	'CRM-084 : anon exécute les deux fonctions — un refus doit être silencieux, pas une erreur de privilège');

select ok(
	has_function_privilege('authenticated', 'app.can_read_budget(uuid)', 'execute')
	and has_function_privilege('authenticated', 'app.can_write_budget(uuid)', 'execute'),
	'CRM-084 : authenticated exécute les deux fonctions');

-- =============================================================================================
-- 8. Les politiques de `budgets`, avec les trois profils réels du seed
-- =============================================================================================

-- --- 8.1 Lecture ------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- CAMILLE PORTE UN DROIT FIN `none` SUR « Conseil & IA », ET LE LIT QUAND MÊME : un administrateur
-- n'est jamais restreint (docs/SPEC-permissions-rls.md §3.3). Le seed en fait une démonstration
-- permanente, et cette assertion est la seule du dépôt à la porter sur un budget.
select is(
	(select count(*) from public.budgets
	  where id = 'b0000000-0000-4000-8000-000000000001'),
	1::bigint,
	'CRM-084 : l''administratrice lit le budget d''un track où elle porte un droit fin « none »');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select count(*) from public.budgets
	  where id = 'b0000000-0000-4000-8000-000000000001'),
	1::bigint,
	'CRM-084 : le business developer lit le budget — la lecture suit le TRACK, pas le rôle');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

-- LE CAS QUI PROUVE LE §3.1, et le seul : Farida ne lit pas « Conseil & IA », donc pas son budget.
select is(
	(select count(*) from public.budgets
	  where id = 'b0000000-0000-4000-8000-000000000001'),
	0::bigint,
	'CRM-084 : la lectrice NE LIT PAS le budget d''un track qui lui est fermé (docs/SPEC-costs.md §3.1)');

-- Le témoin, sans lequel l'assertion ci-dessus se confondrait avec « elle ne lit aucun budget ».
select is(
	(select count(*) from public.budgets
	  where id = 'b0000000-0000-4000-8000-000000000002'),
	1::bigint,
	'CRM-084 : la lectrice lit le budget d''un track qu''elle lit — le refus ci-dessus porte bien sur le TRACK');

select pg_temp.redevenir_proprietaire();
select pg_temp.anonyme();

select is(
	(select count(*) from public.budgets),
	0::bigint,
	'CRM-084 : un appelant anonyme ne lit AUCUN budget');

-- --- 8.2 Écriture : la ligne de partage du §3 -------------------------------------------------

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

-- DRISS ÉCRIT LES AFFAIRES DE CE TRACK, ET N'ÉCRIT AUCUN BUDGET. C'est l'arbitrage du §3 : « le
-- budget est un cadre — décision de gestion ; l'affectation est un geste quotidien ». Sans cette
-- assertion, rien ne distinguerait la règle livrée de « tout membre écrivant écrit un budget ».
select throws_ok(
	$$insert into public.budgets (track_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000022', 'Budget du bizdev 0048', 300)$$,
	'42501',
	null,
	'CRM-084 : un business developer NE CRÉE PAS de budget (docs/SPEC-costs.md §3.2)');

-- La clôture est une mise à jour, et une mise à jour refusée par `using` ne LÈVE RIEN : elle
-- touche zéro ligne. L'assertion mesure donc le nombre de lignes, pas une erreur — écrire
-- `throws_ok` ici serait rouge sur un produit correct.
select is(
	pg_temp.lignes_touchees($$update public.budgets set closed_at = now() where id = 'b0000000-0000-4000-8000-000000000002'$$),
	0::bigint,
	'CRM-084 : un business developer NE CLÔTURE PAS un budget — zéro ligne touchée');

select is(
	pg_temp.lignes_touchees($$delete from public.budgets where id = 'b0000000-0000-4000-8000-000000000002'$$),
	0::bigint,
	'CRM-084 : un business developer NE SUPPRIME PAS un budget');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok(
	$$insert into public.budgets (track_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000022', 'Budget de la lectrice 0048', 301)$$,
	'42501',
	null,
	'CRM-084 : une lectrice ne crée aucun budget — l''invariant du §2.1 de SPEC-permissions-rls');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$insert into public.budgets (id, track_id, name, position)
	  values ('b0000000-0000-4000-8000-000000000009', '5eed0000-0000-4000-8000-000000000022',
	          'Budget de l''administratrice 0048', 302)$$,
	'CRM-084 : l''administratrice crée un budget — le refus ci-dessus porte bien sur le RÔLE');

select is(
	pg_temp.lignes_touchees($$update public.budgets set closed_at = now() where id = 'b0000000-0000-4000-8000-000000000009'$$),
	1::bigint,
	'CRM-084 : l''administratrice clôture un budget');

select is(
	pg_temp.lignes_touchees($$delete from public.budgets where id = 'b0000000-0000-4000-8000-000000000009'$$),
	1::bigint,
	'CRM-084 : l''administratrice supprime un budget vierge — la clôture est la règle de PRODUIT, pas une garde de base');

-- LE `with check` DE LA MISE À JOUR N'EST PAS UN DOUBLON DU `using`, et c'est ici que cela se voit :
-- il interdit de DÉPLACER un budget hors du périmètre où l'appelant est administrateur. Camille
-- l'est partout dans ce workspace, si bien que le déplacement vers un autre de SES tracks réussit ;
-- l'assertion pose que la règle est bien celle du workspace et non celle du track d'origine.
select is(
	pg_temp.lignes_touchees($$update public.budgets set track_id = '5eed0000-0000-4000-8000-000000000023' where id = 'b0000000-0000-4000-8000-000000000002'$$),
	1::bigint,
	'CRM-084 : l''administratrice déplace un budget vers un autre track de SON workspace');

select pg_temp.redevenir_proprietaire();

update public.budgets set track_id = '5eed0000-0000-4000-8000-000000000022'
 where id = 'b0000000-0000-4000-8000-000000000002';

-- =============================================================================================
-- 9. Les politiques de `budget_occurrences`
-- =============================================================================================
-- Elles ne relisent JAMAIS `budget_occurrences` : `app.can_read_budget` lit `budgets`, qui lit
-- `tracks`. C'est l'exigence du §3.5 de `docs/SPEC-permissions-rls.md`.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select count(*) from public.budget_occurrences
	  where budget_id = 'b0000000-0000-4000-8000-000000000003'),
	0::bigint,
	'CRM-084 : la lectrice ne lit AUCUNE occurrence d''un budget qu''elle ne lit pas');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select count(*) from public.budget_occurrences
	  where budget_id = 'b0000000-0000-4000-8000-000000000003'),
	2::bigint,
	'CRM-084 : le business developer lit les DEUX occurrences — la lecture suit le budget');

select throws_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000003', 'Occurrence du bizdev 0048')$$,
	'42501',
	null,
	'CRM-084 : un business developer N''OUVRE PAS d''occurrence (docs/SPEC-costs.md §3.2)');

select is(
	pg_temp.lignes_touchees($$update public.budget_occurrences set closed_at = now() where id = 'b0000000-0000-4000-8000-0000000000a1'$$),
	0::bigint,
	'CRM-084 : un business developer NE CLÔTURE PAS une occurrence');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$insert into public.budget_occurrences (budget_id, label)
	  values ('b0000000-0000-4000-8000-000000000003', 'Occurrence de l''administratrice 0048')$$,
	'CRM-084 : l''administratrice ouvre une occurrence — le refus ci-dessus porte bien sur le RÔLE');

select is(
	pg_temp.lignes_touchees($$update public.budget_occurrences set closed_at = now() where id = 'b0000000-0000-4000-8000-0000000000a1'$$),
	1::bigint,
	'CRM-084 : l''administratrice clôture une occurrence');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

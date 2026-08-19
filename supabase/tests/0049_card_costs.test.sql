-- @verifies CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire : modèle
-- @verifies docs/SPEC-costs.md §1 (le cas qui a motivé la demande), §2.3 (card_costs),
--           §3.1 (double condition de lecture), §3.2 (écriture), §4.4 (le réel inconnu)
-- @verifies docs/SCHEMA.md §9 bis.6 (colonnes et triggers), §9 bis.7 (politiques)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.5 (récursion)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME de la table, ses actions référentielles et l'activation de la RLS. Les deux
--    `on delete restrict` sont mesurés dans le catalogue ET par le refus qu'ils produisent : la
--    première mesure dirait « la règle est déclarée », la seconde seule dit « elle s'applique ».
--
-- 2. LES CONTRAINTES DE VALEUR, chacune contre son succès correspondant. C'est vrai en
--    particulier des TROIS ABSENCES délibérées — aucune unicité sur `(card_id, label)`, aucune
--    contrainte de signe, `actual_cost` nullable —, qui ne se prouvent QUE par un succès : une
--    assertion qui ne mesurerait que des refus resterait verte sur une table qui refuse tout.
--
-- 3. L'INVARIANT `occurrence_id` EXIGÉE SI ET SEULEMENT SI LE BUDGET EST RÉCURRENT, sur ses
--    QUATRE cas — les deux permis et les deux interdits. Un « si » prouvé sans son « seulement
--    si » laisserait passer une occurrence sur un budget simple.
--
-- 4. LA FRONTIÈRE EXACTE DE LA CLÔTURE (§2.3), qui est le point que la lecture rapide manque.
--    Un budget clos refuse l'insertion et le DÉPLACEMENT — des deux côtés, celui qu'on quitte
--    comme celui qu'on rejoint — mais accepte la saisie du RÉEL et la correction du LIBELLÉ. Sans
--    ces deux succès, la suite serait verte sur un produit qui gèlerait tout après la clôture,
--    c'est-à-dire sur le produit exactement contraire à celui que le §2.3 décrit.
--
-- 5. L'INVARIANT TENU DEPUIS `budgets` : rendre récurrent un budget qui porte déjà des lignes est
--    refusé. C'est le pendant de la décision 471, dans l'autre sens : sans lui, l'invariant du
--    point 3 deviendrait faux pour des lignes que son trigger ne reverra jamais.
--
-- 6. LA DOUBLE CONDITION DE LECTURE, PAR LE CAS QUI LA MOTIVE ET PAR LUI SEUL (§3.1) : une card
--    que Farida LIT, rattachée à un budget d'un track qu'elle ne lit pas, lui rend ZÉRO ligne. La
--    lecture de la card est mesurée dans la même suite, faute de quoi zéro ligne ne prouverait que
--    l'absence de droit sur la card.
--
-- 7. LES POLITIQUES, jouées avec les TROIS PROFILS RÉELS du seed, et la frontière du point 4
--    mesurée UNE SECONDE FOIS à leur niveau : la mise à jour d'un réel sur un budget clos touche
--    UNE ligne, sa suppression en touche ZÉRO. Les deux couches disent la même chose par deux
--    mécanismes différents, et chacune peut régresser sans l'autre.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

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

-- UNE ÉCRITURE REFUSÉE PAR LE `using` D'UNE POLITIQUE NE LÈVE RIEN : elle touche zéro ligne. Le
-- nombre de lignes est donc la SEULE mesure d'un tel refus, et `throws_ok` y serait rouge sur un
-- produit correct. `security invoker` est la condition de validité de cette fonction : exécutée
-- avec les droits de l'appelant ENDOSSÉ, elle subit la RLS que l'assertion mesure.
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
-- Fixtures, posées en propriétaire — donc hors RLS.
-- ---------------------------------------------------------------------------------------------
-- LES NOMS PORTENT CELUI DU FICHIER : une fixture homonyme d'une ligne du seed ferait mourir la
-- suite entière sur son unicité, et le diagnostic ressemblerait à un défaut du produit
-- (apprentissage de `CRM-082`, repris par `CRM-084`).
--
-- LES DEUX TRACKS RETENUS LE SONT POUR CE QU'ILS SÉPARENT, mesuré sur la pile seedée :
--   * « Conseil & IA » (…021) — INVISIBLE à Farida (droit fin `none`). C'est le seul track qui
--     rende démontrable la double condition du §3.1 ;
--   * « Studio web »   (…022) — lu par les trois, et dont Driss ÉCRIT les cards.
--
-- LA CARD RETENUE EST « Refonte intranet Ville de Lyon » (…0c4), sur « Studio web » : Farida la
-- LIT et Driss l'ÉCRIT, tous deux mesurés sur la pile. C'est ce qui permet à la même card de
-- porter à la fois le cas de lecture du §3.1 et les cas d'écriture du §3.2.

insert into public.budgets (id, track_id, name, currency, planned_amount, is_recurrent,
                            closed_at, position, created_by)
values
	-- Simple, ouvert, sur le track LU par les trois : le support des cas nominaux.
	('c0000000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000022',
	 'Budget simple de la suite 0049', 'EUR', 9000.00, false, null, 200,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Récurrent, ouvert, même track.
	('c0000000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000022',
	 'Budget récurrent de la suite 0049', 'EUR', 24000.00, true, null, 201,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Simple, sur le track FERMÉ à Farida : le budget de la double condition du §3.1.
	('c0000000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000021',
	 'Budget fermé de la suite 0049', 'EUR', 5000.00, false, null, 200,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Simple, ouvert : il sera clôturé APRÈS avoir reçu ses lignes, comme le fait le seed.
	('c0000000-0000-4000-8000-000000000004', '5eed0000-0000-4000-8000-000000000022',
	 'Budget à clôturer de la suite 0049', 'EUR', 3000.00, false, null, 202,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Récurrent, ouvert : son occurrence sera clôturée après avoir reçu sa ligne.
	('c0000000-0000-4000-8000-000000000005', '5eed0000-0000-4000-8000-000000000022',
	 'Budget à occurrence close 0049', 'EUR', 4000.00, true, null, 203,
	 '5eed0000-0000-4000-8000-000000000011');

insert into public.budget_occurrences (id, budget_id, label, period_start, period_end,
                                       planned_amount, closed_at)
values
	('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000002',
	 'Occurrence ouverte 0049', '2026-03-01', '2026-03-31', 2000.00, null),
	('c0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-000000000002',
	 'Seconde occurrence ouverte 0049', '2026-04-01', '2026-04-30', 2000.00, null),
	('c0000000-0000-4000-8000-0000000000a3', 'c0000000-0000-4000-8000-000000000005',
	 'Occurrence à clôturer 0049', '2026-05-01', '2026-05-31', 1000.00, null);

-- =============================================================================================
-- 1. Forme de la table, actions référentielles et refus par défaut
-- =============================================================================================

select has_table('public', 'card_costs', 'CRM-085 : la table card_costs existe');

select has_column('public', 'card_costs', 'occurrence_id',
	'CRM-085 : card_costs porte occurrence_id (docs/SCHEMA.md §9 bis.6)');

select col_is_null('public', 'card_costs', 'actual_cost',
	'CRM-085 : actual_cost est NULLABLE — nul n''est pas zéro (docs/SPEC-costs.md §2.3)');

select col_not_null('public', 'card_costs', 'estimated_cost',
	'CRM-085 : estimated_cost est OBLIGATOIRE — une ligne sans estimé n''aurait rien à comparer');

select col_not_null('public', 'card_costs', 'budget_id',
	'CRM-085 : budget_id est obligatoire — une dépense sans enveloppe n''est rattachée à rien');

-- AUCUNE COLONNE `currency` (§2.3) : la devise est celle du budget. La porter ici permettrait
-- d'additionner deux devises dans un même total, ce qu'aucun écran ne rendrait honnêtement.
select hasnt_column('public', 'card_costs', 'currency',
	'CRM-085 : card_costs ne porte AUCUNE devise — c''est celle de son budget (§2.3)');

select is(
	(select count(*)::int from pg_class where relname = 'card_costs' and relrowsecurity),
	1,
	'CRM-085 : la RLS est activée sur card_costs — sans elle tout porteur de jeton lirait tout');

-- LES DEUX `on delete restrict`, MESURÉS DANS LE CATALOGUE. `r` est le code de `RESTRICT` ; `a`
-- serait `NO ACTION`, qui diffère en ce qu'il est ajournable, et `c` la cascade — celle-là même
-- qui détruirait la dépense constatée avec l'enveloppe.
select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.card_costs'::regclass
	    and confrelid = 'public.budgets'::regclass),
	'r'::"char",
	'CRM-085 : card_costs.budget_id est ON DELETE RESTRICT — un budget qui porte des dépenses est '
	'indestructible (docs/SPEC-costs.md §3.2)');

select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.card_costs'::regclass
	    and confrelid = 'public.budget_occurrences'::regclass),
	'r'::"char",
	'CRM-085 : card_costs.occurrence_id est ON DELETE RESTRICT — une occurrence détruite sous ses '
	'lignes rendrait l''invariant faux sans aucune ligne interdite');

select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.card_costs'::regclass
	    and confrelid = 'public.cards'::regclass),
	'c'::"char",
	'CRM-085 : card_costs.card_id est ON DELETE CASCADE — les lignes n''ont aucun sens sans leur '
	'affaire');

select has_index('public', 'card_costs', 'card_costs_sans_reel_idx',
	'CRM-085 : l''index PARTIEL des lignes sans réel existe — il sert l''onglet « À saisir » (§4.8)');

-- =============================================================================================
-- 2. Contraintes de valeur, chacune contre son succès
-- =============================================================================================

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', '   ', 10.00)$$,
	'23514',
	null,
	'CRM-085 : un libellé fait de blancs est refusé — app.btrim_blancs retire exactement ce que '
	'String.prototype.trim() retire');

select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, actual_cost)
	  values ('c0000000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Publicité', 100.00, null)$$,
	'CRM-085 : une ligne SANS réel est acceptée — c''est l''état normal d''une dépense en cours '
	'(docs/SPEC-costs.md §2.3)');

-- LE CAS DU RESPONSABLE, MOT POUR MOT (§1) : deux lignes de nature différente sur la MÊME affaire,
-- l'une sans réel. Une affectation unique par affaire ne le rendrait pas.
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, actual_cost)
	  values ('c0000000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Production', 350.00, 375.00)$$,
	'CRM-085 : la même affaire porte une SECONDE ligne, d''une autre nature — c''est le cas qui a '
	'motivé la demande (docs/SPEC-costs.md §1)');

-- AUCUNE UNICITÉ (§2.3) : deux achats de même nature sur le même budget restent deux lignes.
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
	  values ('c0000000-0000-4000-8000-0000000000f3', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Publicité', 60.00)$$,
	'CRM-085 : une SECONDE ligne « Publicité » sur le même budget est acceptée — aucune unicité '
	'sur (card_id, label) ni sur (card_id, budget_id) (§2.3)');

-- AUCUNE CONTRAINTE DE SIGNE (§2.3) : un avoir, une remise ou un remboursement sont des coûts
-- négatifs légitimes. Cette absence ne se prouve QUE par un succès.
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, actual_cost)
	  values ('c0000000-0000-4000-8000-0000000000f4', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Avoir fournisseur', -120.00, -120.00)$$,
	'CRM-085 : un coût NÉGATIF est accepté — un avoir ou un remboursement sont légitimes, même '
	'doctrine que cards.amount (§2.3)');

select is(
	(select actual_cost from public.card_costs
	  where id = 'c0000000-0000-4000-8000-0000000000f1'),
	null::numeric,
	'CRM-085 : le réel non saisi est resté NUL et n''a pas été coercé en zéro — c''est la '
	'distinction que défend tout le §4.4');

-- =============================================================================================
-- 3. `occurrence_id` exigée SI ET SEULEMENT SI le budget est récurrent — les QUATRE cas
-- =============================================================================================

-- (1) Récurrent SANS occurrence : refusé.
select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000002', 'Sans occurrence', 10.00)$$,
	'23514',
	null,
	'CRM-085 : une ligne sur un budget RÉCURRENT sans occurrence est refusée (docs/SCHEMA.md '
	'§9 bis.6)');

-- (2) Récurrent AVEC occurrence : accepté.
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, occurrence_id, label, estimated_cost)
	  values ('c0000000-0000-4000-8000-0000000000f5', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000002',
	          'c0000000-0000-4000-8000-0000000000a1', 'Achat d''espace', 900.00)$$,
	'CRM-085 : une ligne sur un budget récurrent AVEC son occurrence est acceptée');

-- (3) Simple AVEC occurrence : refusé. C'est le « seulement si », que le cas (1) ne prouve pas.
select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, occurrence_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001',
	          'c0000000-0000-4000-8000-0000000000a1', 'Occurrence de trop', 10.00)$$,
	'23514',
	null,
	'CRM-085 : une ligne sur un budget SIMPLE qui cite une occurrence est refusée — l''invariant '
	'se tient dans les deux sens');

-- (4) Simple SANS occurrence : accepté — déjà prouvé au §2, et l'assertion suivante mesure la
--     règle qui manquerait le plus si elle tombait : l'occurrence appartient au budget cité.
select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, occurrence_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000005',
	          'c0000000-0000-4000-8000-0000000000a1', 'Occurrence étrangère', 10.00)$$,
	'23514',
	null,
	'CRM-085 : une occurrence appartenant à un AUTRE budget est refusée — sinon les deux vues de '
	'CRM-086 cesseraient de sommer la même chose');

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-0000000000ff', 'Budget fantôme', 10.00)$$,
	'23503',
	null,
	'CRM-085 : un budget inexistant est refusé en 23503 — code d''intégrité référentielle, pas de '
	'contrainte de valeur');

-- =============================================================================================
-- 4. LA FRONTIÈRE DE LA CLÔTURE — le point que la lecture rapide manque (§2.3)
-- =============================================================================================
-- Les lignes sont posées PUIS les clôtures interviennent, exactement comme le fait le seed et
-- comme le décrit la spécification : « on clôt une campagne PUIS les factures arrivent ».

insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, actual_cost)
values ('c0000000-0000-4000-8000-0000000000f6', '5eed0000-0000-4000-8000-0000000000c4',
        'c0000000-0000-4000-8000-000000000004', 'Salon', 500.00, null);

insert into public.card_costs (id, card_id, budget_id, occurrence_id, label, estimated_cost)
values ('c0000000-0000-4000-8000-0000000000f7', '5eed0000-0000-4000-8000-0000000000c4',
        'c0000000-0000-4000-8000-000000000005',
        'c0000000-0000-4000-8000-0000000000a3', 'Impression', 200.00);

update public.budgets            set closed_at = now()
 where id = 'c0000000-0000-4000-8000-000000000004';
update public.budget_occurrences set closed_at = now()
 where id = 'c0000000-0000-4000-8000-0000000000a3';

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000004', 'Trop tard', 10.00)$$,
	'23514',
	null,
	'CRM-085 : un budget CLÔTURÉ n''accepte aucune ligne neuve (docs/SPEC-costs.md §2.3)');

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, occurrence_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000005',
	          'c0000000-0000-4000-8000-0000000000a3', 'Trop tard aussi', 10.00)$$,
	'23514',
	null,
	'CRM-085 : une OCCURRENCE clôturée n''accepte aucune ligne neuve, même sur un budget ouvert');

-- LES DEUX SUCCÈS QUI DÉFINISSENT LA FRONTIÈRE, ET SANS LESQUELS CETTE SUITE SERAIT VERTE SUR UN
-- PRODUIT QUI GÈLE TOUT APRÈS LA CLÔTURE.
select lives_ok(
	$$update public.card_costs set actual_cost = 480.00
	   where id = 'c0000000-0000-4000-8000-0000000000f6'$$,
	'CRM-085 : le coût RÉEL reste saisissable sur un budget clôturé — on clôt une campagne PUIS '
	'les factures arrivent (docs/SPEC-costs.md §2.3)');

select lives_ok(
	$$update public.card_costs set label = 'Salon du web'
	   where id = 'c0000000-0000-4000-8000-0000000000f6'$$,
	'CRM-085 : le LIBELLÉ reste corrigeable sur un budget clôturé (§2.3)');

select is(
	(select actual_cost from public.card_costs
	  where id = 'c0000000-0000-4000-8000-0000000000f6'),
	480.00::numeric,
	'CRM-085 : et la valeur saisie après la clôture est bien enregistrée');

-- LE DÉPLACEMENT, LUI, EST REFUSÉ DES DEUX CÔTÉS.
select throws_ok(
	$$update public.card_costs set budget_id = 'c0000000-0000-4000-8000-000000000001'
	   where id = 'c0000000-0000-4000-8000-0000000000f6'$$,
	'23514',
	null,
	'CRM-085 : une ligne ne QUITTE pas un budget clôturé — la déplacer diminuerait un total déjà '
	'arrêté (§2.3)');

select throws_ok(
	$$update public.card_costs set budget_id = 'c0000000-0000-4000-8000-000000000004'
	   where id = 'c0000000-0000-4000-8000-0000000000f1'$$,
	'23514',
	null,
	'CRM-085 : une ligne ne REJOINT pas davantage un budget clôturé — c''est le même refus que '
	'celui de l''insertion');

select throws_ok(
	$$update public.card_costs set occurrence_id = 'c0000000-0000-4000-8000-0000000000a1',
	                               budget_id     = 'c0000000-0000-4000-8000-000000000002'
	   where id = 'c0000000-0000-4000-8000-0000000000f7'$$,
	'23514',
	null,
	'CRM-085 : une ligne ne quitte pas davantage une OCCURRENCE clôturée, son budget fût-il '
	'ouvert');

-- ET LE DÉPLACEMENT ENTRE DEUX RATTACHEMENTS OUVERTS RESTE LIBRE : sans ce succès, les trois
-- refus ci-dessus seraient verts sur un produit qui interdirait tout déplacement.
select lives_ok(
	$$update public.card_costs set occurrence_id = 'c0000000-0000-4000-8000-0000000000a2'
	   where id = 'c0000000-0000-4000-8000-0000000000f5'$$,
	'CRM-085 : une ligne se déplace librement entre deux occurrences OUVERTES du même budget');

-- =============================================================================================
-- 5. L'invariant tenu depuis `budgets` — le pendant de la décision 471
-- =============================================================================================

select throws_ok(
	$$update public.budgets set is_recurrent = true
	   where id = 'c0000000-0000-4000-8000-000000000001'$$,
	'23514',
	null,
	'CRM-085 : rendre RÉCURRENT un budget qui porte déjà des lignes est refusé — elles resteraient '
	'sans occurrence sur un budget récurrent, invariant faux sans ligne interdite');

select lives_ok(
	$$update public.budgets set is_recurrent = true
	   where id = 'c0000000-0000-4000-8000-000000000003'$$,
	'CRM-085 : et un budget simple SANS ligne se rend librement récurrent — la garde ne porte que '
	'sur ce qu''elle doit garder');

update public.budgets set is_recurrent = false
 where id = 'c0000000-0000-4000-8000-000000000003';

-- =============================================================================================
-- 6. Les deux `on delete restrict`, mesurés par le refus qu'ils produisent
-- =============================================================================================

select throws_ok(
	$$delete from public.budgets where id = 'c0000000-0000-4000-8000-000000000001'$$,
	'23503',
	null,
	'CRM-085 : un budget qui porte des lignes de coût est INDESTRUCTIBLE — la règle de produit '
	'« un budget ne se supprime pas, il se clôture » est rendue structurelle (§3.2)');

select throws_ok(
	$$delete from public.budget_occurrences where id = 'c0000000-0000-4000-8000-0000000000a2'$$,
	'23503',
	null,
	'CRM-085 : une occurrence qui porte des lignes est indestructible — sinon occurrence_id '
	'deviendrait nulle sur un budget récurrent');

select lives_ok(
	$$delete from public.budget_occurrences where id = 'c0000000-0000-4000-8000-0000000000a1'$$,
	'CRM-085 : et une occurrence SANS ligne se supprime — le refus ci-dessus ne gèle pas la table');

-- =============================================================================================
-- 7. Forme de la fonction d'appui et des triggers
-- =============================================================================================

select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'budget_est_ouvert'),
	true,
	'CRM-085 : app.budget_est_ouvert est SECURITY DEFINER — sinon la politique de card_costs '
	'rejouerait la RLS de budgets à chaque ligne (décision 27)');

select is(
	(select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'budget_est_ouvert'),
	array['search_path=""'],
	'CRM-085 : son search_path est VIDÉ — une fonction definer au search_path ouvert est une '
	'élévation de privilège');

select is(
	(select has_function_privilege('anon', 'app.budget_est_ouvert(uuid)', 'execute')),
	true,
	'CRM-085 : anon EXÉCUTE app.budget_est_ouvert — sans ce droit il recevrait une erreur de '
	'privilège au lieu du refus silencieux attendu');

select has_trigger('public', 'card_costs', 'card_costs_verifier_rattachement',
	'CRM-085 : le trigger de rattachement est posé sur card_costs');

select has_trigger('public', 'budgets', 'budgets_verifier_recurrence_lignes',
	'CRM-085 : le trigger de récurrence est posé sur budgets, et cohabite avec celui de CRM-084');

select has_trigger('public', 'budgets', 'budgets_verifier_recurrence',
	'CRM-085 : et celui de CRM-084 est toujours là — les deux gardent deux sens opposés');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'card_costs'),
	4,
	'CRM-085 : card_costs porte QUATRE politiques, une par action (docs/SCHEMA.md §9 bis.7)');

-- =============================================================================================
-- 8. LA DOUBLE CONDITION DE LECTURE, PAR LE CAS QUI LA MOTIVE (§3.1)
-- =============================================================================================
-- La ligne posée ici rattache une card de « Studio web » — que Farida LIT — à un budget de
-- « Conseil & IA » — qu'elle ne lit PAS. C'est le cas nommé au §3.1 : « une card et un budget
-- peuvent relever de deux tracks dont l'appelant ne lit que l'un ».

insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
values ('c0000000-0000-4000-8000-0000000000f8', '5eed0000-0000-4000-8000-0000000000c4',
        'c0000000-0000-4000-8000-000000000003', 'Prospection terrain', 800.00);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

-- LA LECTURE DE LA CARD EST MESURÉE D'ABORD, sans quoi « zéro ligne » ne prouverait que l'absence
-- de droit sur la card et la double condition resterait indistinguable d'une condition simple.
select is(
	(select app.can_read_card('5eed0000-0000-4000-8000-0000000000c4')),
	true,
	'CRM-085 : Farida LIT bien l''affaire — c''est la moitié de la démonstration du §3.1');

select is(
	(select app.can_read_budget('c0000000-0000-4000-8000-000000000003')),
	false,
	'CRM-085 : et elle ne lit PAS le budget, qui vit sur un track fermé — c''est l''autre moitié');

select is(
	(select count(*)::int from public.card_costs
	  where id = 'c0000000-0000-4000-8000-0000000000f8'),
	0,
	'CRM-085 : elle ne voit AUCUNE ligne rattachée à ce budget, bien qu''elle lise l''affaire — '
	'sinon le nom et le montant d''une enveloppe interdite fuiraient (§3.1)');

select is(
	(select count(*)::int from public.card_costs
	  where id = 'c0000000-0000-4000-8000-0000000000f1'),
	1,
	'CRM-085 : et elle voit les lignes dont elle lit LES DEUX côtés — le refus ci-dessus n''est '
	'pas un aveuglement général');

-- UN VIEWER N'ÉCRIT RIEN (docs/SPEC-permissions-rls.md §2.1), et le refus prend ici la forme du
-- `with check` : une exception, pas un filtre.
select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Refusée à la lectrice', 10.00)$$,
	'42501',
	null,
	'CRM-085 : la lectrice ne CRÉE aucune ligne de coût — elle n''écrit aucune card');

select is(
	pg_temp.lignes_touchees(
		$$update public.card_costs set actual_cost = 1.00
		   where id = 'c0000000-0000-4000-8000-0000000000f1'$$),
	0::bigint,
	'CRM-085 : et elle n''en modifie aucune — le refus d''un `using` ne lève rien, il touche zéro '
	'ligne');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 9. Les politiques d'écriture, jouées avec Driss — la ligne de partage du §3
-- =============================================================================================
-- « Le budget est un CADRE — décision de gestion ; l'affectation est un GESTE quotidien. » Driss
-- (`business_developer`) n'écrit AUCUN budget — `CRM-084` le prouve — et doit écrire toutes les
-- lignes de coût des affaires qu'il travaille. C'est cette asymétrie que la section mesure.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
	  values ('c0000000-0000-4000-8000-0000000000f9', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0000000-0000-4000-8000-000000000001', 'Ligne du bizdev', 42.00)$$,
	'CRM-085 : le business developer CRÉE une ligne de coût sur une affaire qu''il écrit, sans '
	'aucun droit sur le budget lui-même (docs/SPEC-costs.md §3.2)');

select is(
	(select app.can_write_budget('c0000000-0000-4000-8000-000000000001')),
	false,
	'CRM-085 : et il n''écrit toujours PAS le budget qui l''encadre — c''est exactement la ligne '
	'de partage du §3');

select is(
	pg_temp.lignes_touchees(
		$$update public.card_costs set actual_cost = 44.00
		   where id = 'c0000000-0000-4000-8000-0000000000f9'$$),
	1::bigint,
	'CRM-085 : il saisit le réel de sa ligne');

-- LA FRONTIÈRE DE LA CLÔTURE, MESURÉE UNE SECONDE FOIS AU NIVEAU DES POLITIQUES. Le §4 l'a
-- mesurée au niveau du trigger, en propriétaire ; ici c'est la RLS qui parle, et les deux
-- mécanismes peuvent régresser l'un sans l'autre.
select is(
	pg_temp.lignes_touchees(
		$$update public.card_costs set actual_cost = 500.00
		   where id = 'c0000000-0000-4000-8000-0000000000f6'$$),
	1::bigint,
	'CRM-085 : la politique de mise à jour n''exige PAS le budget ouvert — sans quoi il faudrait '
	'rouvrir une enveloppe pour saisir une facture (§2.3)');

select is(
	pg_temp.lignes_touchees(
		$$delete from public.card_costs where id = 'c0000000-0000-4000-8000-0000000000f6'$$),
	0::bigint,
	'CRM-085 : mais la SUPPRESSION exige le budget ouvert — retirer une dépense d''un total déjà '
	'arrêté est le même geste que le déplacement interdit (docs/SCHEMA.md §9 bis.7)');

select is(
	pg_temp.lignes_touchees(
		$$delete from public.card_costs where id = 'c0000000-0000-4000-8000-0000000000f9'$$),
	1::bigint,
	'CRM-085 : et une ligne d''un budget OUVERT se supprime — le refus ci-dessus ne gèle pas la '
	'table');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 10. L'appelant anonyme, et la cascade de la card
-- =============================================================================================

select pg_temp.anonyme();

select is(
	(select count(*)::int from public.card_costs),
	0,
	'CRM-085 : un appelant ANONYME ne lit AUCUNE ligne de coût — zéro ligne, jamais une erreur de '
	'privilège (docs/SPEC-permissions-rls.md §7)');

select pg_temp.redevenir_proprietaire();

-- LA CASCADE DE LA CARD, mesurée par la disparition qu'elle produit. Elle s'exerce en dernier :
-- elle détruit les fixtures dont les sections précédentes se servaient.
-- Le dénombrement porte sur les SEULES fixtures de cette suite — préfixe `c0000000` —, et non
-- sur toutes les lignes de l'affaire : le seed en pose deux sur la même card, et les compter ici
-- ferait rougir cette suite au premier enrichissement du jeu de démonstration, sur un produit
-- intact.
select is(
	(select count(*)::int from public.card_costs
	  where card_id = '5eed0000-0000-4000-8000-0000000000c4'
	    and id::text like 'c0000000%'),
	8,
	'CRM-085 : l''affaire porte bien les huit lignes de cette suite encore vivantes avant sa '
	'suppression');

delete from public.cards where id = '5eed0000-0000-4000-8000-0000000000c4';

select is(
	(select count(*)::int from public.card_costs
	  where card_id = '5eed0000-0000-4000-8000-0000000000c4'),
	0,
	'CRM-085 : supprimer l''affaire emporte toutes ses lignes de coût — elles n''ont aucun sens '
	'sans elle');

select * from finish();

rollback;

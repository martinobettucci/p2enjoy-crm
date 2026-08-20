-- @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6a : le socle de données de
--           l'onglet « À saisir »
-- @verifies docs/SPEC-costs.md §4.8 (une ligne lisible mais non écrivable est rendue en lecture
--           seule AVEC SON MOTIF, jamais masquée ; l'onglet liste les budgets clôturés),
--           §4.8.1 (le droit d'écriture est rendu par la base, jamais calculé par l'interface),
--           §3.1 (double condition de lecture), §3.2 (écriture)
-- @verifies docs/SCHEMA.md §9 bis.8 (`public.reel_saisissable`), §9 bis.7 (politiques)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.7 (`app.can_write_card`)
-- @verifies docs/PROD_MIGRATIONS.md §3 (migration 52 : `prosecdef` doit être FAUX)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS la frontière de la clôture du §2.3 — « le réel reste saisissable sur un
-- budget clos, le rattachement ne change plus ». La suite `0049_card_costs.test.sql` la porte déjà,
-- dans les deux sens et aux deux niveaux, trigger et politique. La Definition of Done de `CRM-086`
-- la réclame en pgTAP « avec sa contre-épreuve » : elle y est, et la dupliquer ici ferait deux
-- sources pour une même règle, qui divergeraient au premier ajustement.
--
-- Ce qu'elle prouve, et que rien d'autre ne prouve, c'est `public.reel_saisissable` — la colonne
-- calculée de la migration 52, sur laquelle repose la SEULE règle d'interface du produit qui
-- connaisse un droit d'écriture avant de rendre son contrôle (§4.8).
--
-- 1. SA FORME DANS LE CATALOGUE. `prosecdef` FAUX est la vérification la plus importante de ce
--    fichier. En `SECURITY DEFINER`, la fonction répondrait pour le propriétaire — `postgres`, qui
--    traverse toute la RLS — et rendrait donc « vrai » à TOUT appelant, `viewer` compris. L'onglet
--    rendrait alors des champs de saisie dont chaque envoi serait refusé, et le §4.8 se lirait à
--    l'envers. C'est le seul défaut que la migration 52 peut introduire, et il ne se voit ni à la
--    lecture du SQL — `security invoker` étant le DÉFAUT, il ne s'écrit pas — ni à l'usage sous un
--    compte qui écrit de toute façon.
--
-- 2. SA VALEUR SOUS TROIS IDENTITÉS RÉELLES, sur la MÊME ligne : Driss, qui écrit les cards de
--    « Studio web », obtient vrai ; Farida, lectrice, obtient faux ; l'anonyme obtient faux. Une
--    seule identité ne prouverait rien — une fonction qui rendrait toujours vrai passerait sous
--    Driss, et une qui rendrait toujours faux passerait sous Farida.
--
-- 3. SON ACCORD AVEC LA POLITIQUE, ET C'EST LE POINT QUI NE SE DEVINE PAS. Le signal et la règle
--    sont deux mécanismes distincts — une fonction d'un côté, la clause `using` de
--    `card_costs_modification` de l'autre — et rien ne les oblige structurellement à dire la même
--    chose. La suite les CONFRONTE : là où le signal dit « faux », l'écriture touche zéro ligne ;
--    là où il dit « vrai », elle en touche une. Une divergence rendrait l'onglet menteur dans un
--    sens ou dans l'autre — champ éteint sur une ligne écrivable, ou champ offert sur une ligne
--    refusée —, et aucune preuve d'interface ne l'attraperait.
--
-- 4. QU'ELLE NE DIVULGUE RIEN. Elle ne s'évalue que sur une ligne que la RLS a déjà consentie : sur
--    la ligne d'un budget d'un track fermé à Farida, il n'y a pas « faux », il n'y a RIEN — la
--    double condition du §3.1 écarte la ligne entière. Une colonne calculée qui rendrait une valeur
--    sur une ligne masquée en révélerait l'existence.
--
-- 5. QUE L'ONGLET LISTE BIEN LES BUDGETS CLÔTURÉS, mesuré sur la lecture exacte qu'il émet —
--    `actual_cost is null` sans aucun filtre de clôture. C'est la règle que la Definition of Done
--    demande de rendre observable, et le seed pose désormais la ligne qui l'exerce.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
-- avec les droits de l'appelant ENDOSSÉ, elle subit la RLS que l'assertion mesure. Reprise
-- textuellement de `0049_card_costs.test.sql`, où elle a été écrite.
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
-- LES NOMS PORTENT CELUI DU FICHIER, apprentissage de `CRM-082` repris par `CRM-084` et `CRM-085` :
-- une fixture homonyme d'une ligne du seed ferait mourir la suite entière sur son unicité, et le
-- diagnostic ressemblerait à un défaut du produit.
--
-- LES DEUX TRACKS RETENUS LE SONT POUR CE QU'ILS SÉPARENT, comme dans la suite 0049 :
--   * « Studio web »   (…022) — lu par les trois, et dont Driss ÉCRIT les cards ;
--   * « Conseil & IA » (…021) — INVISIBLE à Farida (droit fin `none`), seul track qui rende
--     démontrable la non-divulgation du point 4.
--
-- LES DEUX CARDS RETENUES sont celles du seed : « Refonte intranet Ville de Lyon » (…0c4) sur
-- « Studio web », que Farida LIT et Driss ÉCRIT, et « Formation Data & IA — promo 2026 » (…0c7),
-- que Farida lit aussi mais dont le budget lui est fermé.

insert into public.budgets (id, track_id, name, currency, planned_amount, is_recurrent,
                            closed_at, position, created_by)
values
	-- Ouvert, sur le track lu par les trois : le support des cas nominaux.
	('c0050000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000022',
	 'Budget ouvert de la suite 0050', 'EUR', 9000.00, false, null, 250,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Ouvert, puis clôturé plus bas — comme le fait le seed, et pour la même raison : le trigger
	-- refuse toute ligne neuve sur un budget clos, y compris au propriétaire.
	('c0050000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000022',
	 'Budget à clôturer de la suite 0050', 'EUR', 3000.00, false, null, 251,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Sur le track FERMÉ à Farida : le budget de la non-divulgation.
	('c0050000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000021',
	 'Budget fermé de la suite 0050', 'EUR', 5000.00, false, null, 250,
	 '5eed0000-0000-4000-8000-000000000011');

insert into public.card_costs (id, card_id, budget_id, occurrence_id, label,
                               estimated_cost, actual_cost, created_by)
values
	-- La ligne CENTRALE : sans réel, sur un budget ouvert, sur une card que Farida LIT et que
	-- Driss ÉCRIT. C'est elle que les trois identités interrogent.
	('c0050000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-0000000000c4',
	 'c0050000-0000-4000-8000-000000000001', null, 'Sans réel 0050', 400.00, null,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Sans réel, sur le budget qui sera clôturé : la ligne que l'onglet doit continuer de lister.
	('c0050000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-0000000000c4',
	 'c0050000-0000-4000-8000-000000000002', null, 'Sans réel sur budget clos 0050', 500.00, null,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- AVEC réel, sur le budget ouvert : la contre-épreuve du filtre de l'onglet. Sans elle, une
	-- lecture qui aurait perdu son `actual_cost is null` resterait verte.
	('c0050000-0000-4000-8000-0000000000f3', '5eed0000-0000-4000-8000-0000000000c4',
	 'c0050000-0000-4000-8000-000000000001', null, 'Avec réel 0050', 600.00, 590.00,
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Sans réel, sur le budget d'un track FERMÉ à Farida, portée par une card qu'elle LIT : la
	-- ligne de la non-divulgation (§3.1).
	('c0050000-0000-4000-8000-0000000000f4', '5eed0000-0000-4000-8000-0000000000c7',
	 'c0050000-0000-4000-8000-000000000003', null, 'Sans réel hors portée 0050', 700.00, null,
	 '5eed0000-0000-4000-8000-000000000011');

-- La clôture vient APRÈS les lignes, comme dans le seed et dans la suite 0049.
update public.budgets set closed_at = '2026-06-30T17:00:00Z'
 where id = 'c0050000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------------------------
-- 1. La forme de la fonction dans le catalogue — docs/PROD_MIGRATIONS.md §3, migration 52
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'reel_saisissable', array['card_costs'],
	'CRM-086 : la colonne calculée « public.reel_saisissable(card_costs) » existe — sans elle, '
	'l''onglet « À saisir » ne saurait pas quelles lignes rendre en lecture seule');

select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'reel_saisissable'),
	false,
	'CRM-086 : elle est SECURITY INVOKER, et c''est la vérification la plus importante de cette '
	'suite — en DEFINER, elle répondrait pour le propriétaire de la fonction et rendrait « vrai » '
	'à tout appelant, viewer compris (docs/SPEC-costs.md §4.8.1)');

select is(
	(select p.provolatile from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'reel_saisissable'),
	's'::"char",
	'CRM-086 : elle est STABLE — elle lit la base et ne peut donc pas être IMMUTABLE, mais elle ne '
	'l''écrit pas et PostgREST doit pouvoir l''appeler dans un « select »');

select ok(
	has_function_privilege('authenticated', 'public.reel_saisissable(public.card_costs)', 'execute'),
	'CRM-086 : « authenticated » l''exécute — sans quoi toute lecture de l''onglet échouerait sur '
	'un défaut de privilège');

select ok(
	has_function_privilege('anon', 'public.reel_saisissable(public.card_costs)', 'execute'),
	'CRM-086 : « anon » l''exécute aussi, pour la raison exacte qui lui fait recevoir celui '
	'd''app.can_write_card — un appelant anonyme doit recevoir ZÉRO LIGNE et non une erreur de '
	'privilège (docs/SPEC-permissions-rls.md §7)');

-- ---------------------------------------------------------------------------------------------
-- 2. Sa valeur sous trois identités réelles, sur la MÊME ligne
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select public.reel_saisissable(c) from public.card_costs c
	  where c.id = 'c0050000-0000-4000-8000-0000000000f1'),
	true,
	'CRM-086 : Driss ÉCRIT les cards de « Studio web », donc la colonne calculée rend VRAI sur '
	'cette ligne — le champ de saisie lui est offert (docs/SPEC-costs.md §4.8)');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select public.reel_saisissable(c) from public.card_costs c
	  where c.id = 'c0050000-0000-4000-8000-0000000000f1'),
	false,
	'CRM-086 : Farida LIT la même ligne et ne l''écrit pas, donc la colonne calculée rend FAUX — '
	'c''est ce qui la fait rendre en lecture seule AVEC SON MOTIF, jamais masquée (§4.8)');

select is(
	(select count(*)::int from public.card_costs c
	  where c.id = 'c0050000-0000-4000-8000-0000000000f1'),
	1,
	'CRM-086 : et elle la LIT bien — sans cette contre-épreuve, le « faux » ci-dessus serait '
	'indistinguable d''une ligne absente, et ne prouverait rien du droit d''écriture');

-- ---------------------------------------------------------------------------------------------
-- 3. Son accord avec la politique — le point qui ne se devine pas
-- ---------------------------------------------------------------------------------------------
-- Le signal et la règle sont deux mécanismes distincts, et rien ne les oblige à dire la même chose.
-- Les confronter est la seule façon de le savoir : une divergence rendrait l'onglet menteur dans un
-- sens — champ offert sur une ligne refusée — ou dans l'autre — champ éteint sur une ligne
-- écrivable —, et aucune preuve d'interface ne l'attraperait.

select is(
	pg_temp.lignes_touchees(
		'update public.card_costs set actual_cost = 123.00 '
		'where id = ''c0050000-0000-4000-8000-0000000000f1'''),
	0::bigint,
	'CRM-086 : là où la colonne calculée dit FAUX, l''écriture touche ZÉRO ligne — le signal et la '
	'clause « using » de card_costs_modification disent la même chose');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	pg_temp.lignes_touchees(
		'update public.card_costs set actual_cost = 123.00 '
		'where id = ''c0050000-0000-4000-8000-0000000000f1'''),
	1::bigint,
	'CRM-086 : et là où elle dit VRAI, l''écriture touche UNE ligne — les deux mécanismes '
	'concordent dans les deux sens, ce qu''une seule des deux mesures ne dirait pas');

select is(
	(select actual_cost from public.card_costs where id = 'c0050000-0000-4000-8000-0000000000f1'),
	123.00,
	'CRM-086 : et la valeur saisie est bien celle qui est enregistrée');

-- ---------------------------------------------------------------------------------------------
-- 4. Elle ne divulgue rien — la double condition du §3.1 reste entière
-- ---------------------------------------------------------------------------------------------

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select count(*)::int from public.cards where id = '5eed0000-0000-4000-8000-0000000000c7'),
	1,
	'CRM-086 : Farida LIT l''affaire « Formation Data & IA — promo 2026 », sans quoi l''absence de '
	'sa ligne ne prouverait que le droit manquant sur la card');

select is(
	(select count(*)::int from public.card_costs c
	  where c.id = 'c0050000-0000-4000-8000-0000000000f4'),
	0,
	'CRM-086 : sur la ligne d''un budget d''un track qui lui est fermé, il n''y a pas « faux », il '
	'n''y a RIEN — la colonne calculée ne s''évalue que sur une ligne déjà consentie par la RLS, et '
	'une valeur rendue ici révélerait l''existence de la ligne (§3.1)');

-- ---------------------------------------------------------------------------------------------
-- 5. Ce que l'onglet liste : les budgets clôturés COMPRIS, et les réels saisis EXCLUS
-- ---------------------------------------------------------------------------------------------
-- La lecture exacte que `lireLignesASaisir` émet, jouée ici sous une identité réelle : le filtre
-- `actual_cost is null`, et AUCUN filtre de clôture.
--
-- LA LIGNE CENTRALE EST REMISE EN ATTENTE AVANT CETTE SECTION, et c'est écrit plutôt que subi : la
-- section 3 vient d'y SAISIR un réel — c'est même ce qu'elle prouve —, si bien qu'elle a quitté la
-- population de l'onglet. La restaurer est la seule façon de mesurer ici les DEUX lignes que la
-- section attend ; l'alternative, une quatrième fixture jamais écrite, aurait fait diverger la ligne
-- que les identités interrogent de celle que l'onglet liste, et cette section ne dirait plus rien de
-- la précédente. Le geste est fait en PROPRIÉTAIRE, hors RLS : il appartient à la fixture, pas au
-- produit.

select pg_temp.redevenir_proprietaire();

update public.card_costs set actual_cost = null
 where id = 'c0050000-0000-4000-8000-0000000000f1';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select count(*)::int from public.card_costs c
	  join public.budgets b on b.id = c.budget_id
	  where c.actual_cost is null and c.id::text like 'c0050000%'
	    and b.track_id = '5eed0000-0000-4000-8000-000000000022'),
	2,
	'CRM-086 : l''onglet liste DEUX lignes de cette suite sur « Studio web » — celle du budget '
	'ouvert et celle du budget CLÔTURÉ. « C''est précisément après la clôture que les factures '
	'arrivent, et les exclure viderait l''onglet de son usage » (docs/SPEC-costs.md §4.8)');

select is(
	(select count(*)::int from public.card_costs c
	  join public.budgets b on b.id = c.budget_id
	  where c.actual_cost is null and c.id::text like 'c0050000%'
	    and b.closed_at is not null),
	1,
	'CRM-086 : et l''une des deux porte bien un budget clos — sans cette mesure, la précédente '
	'resterait verte sur un onglet qui les exclurait toutes');

select is(
	(select count(*)::int from public.card_costs c
	  where c.actual_cost is not null and c.id::text like 'c0050000%'),
	1,
	'CRM-086 : la ligne dont le réel EST saisi existe et n''entre dans aucun des comptes ci-dessus '
	'— contre-épreuve du filtre « actual_cost is null », sans laquelle une lecture qui l''aurait '
	'perdu resterait verte');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

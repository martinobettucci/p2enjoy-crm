-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--           TRANCHE 4, SOUS-TRANCHE 4c : l'écran
-- @verifies docs/SPEC-modeles-emails.md §13.1 (les quatre questions et leurs mesures), §13.2 (la
--           mesure qui RÉVISE le §11.6 bis : aucun `set constraints`), §13.3 (signature, les trois
--           refus, privilèges), §13.10 (contrat d'API de la RPC)
-- @verifies docs/SPEC-modeles-emails.md §11.6 (la position est `deferrable`), §11.7 (autorisations
--           des deux tables)
-- @verifies docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
-- @verifies docs/SCHEMA.md §7 (`mail_sequence_steps`, `public.reordonner_paliers_sequence`)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. LA FORME DE LA FONCTION DANS LE CATALOGUE : sa volatilité, son `security invoker`, et ses
--    privilèges rôle par rôle avec `anon` EXCLU. Une fonction livrée `security definer` par
--    inadvertance réécrirait la règle d'écriture de la migration 59, et tous les refus mesurés
--    plus bas porteraient alors sur une règle qui n'est plus celle du produit.
--
-- 2. LA DÉCISION DE FORME DU §13.2, FIGÉE PAR UNE ASSERTION plutôt que laissée au commentaire :
--    le corps de la fonction ne contient AUCUN `set constraints`. La voir rougir un jour
--    signalerait que quelqu'un a réintroduit la commande que la mesure a écartée — et, avec elle,
--    l'idée fausse que la contrainte serait `initially deferred`.
--
-- 3. QUE LA CONTRAINTE DE POSITION EST BIEN `DEFERRABLE INITIALLY IMMEDIATE`, lue dans
--    `pg_constraint`. C'est le PRÉALABLE sans lequel la fonction échouerait : l'assertion est ici
--    pour que sa disparition fasse rougir CETTE suite, et non l'écran en production.
--
-- 4. LES TROIS REFUS DU §13.3, CHACUN PRÉCÉDÉ DE SON TÉMOIN. Un refus vert sur une absence ne
--    prouve rien : le témoin établit que le même geste passe quand la seule condition testée est
--    levée.
--
-- 5. LA PERMUTATION, RELUE POSITION À POSITION, et non par son seul compte de retour. Une
--    fonction qui rendrait `3` sans rien déplacer serait verte sur le compte seul — c'est la
--    précaution que le §11.6 bis a déjà prise pour l'échange atomique.
--
-- 6. LE ZÉRO-LIGNE DE LA LECTRICE : elle appelle, la fonction rend `0`, AUCUNE exception n'est
--    levée, et les positions sont relues INCHANGÉES. C'est la conséquence directe du
--    `security invoker` (§13.1 question 2), et l'assertion qui la porte est celle qui verrait la
--    fonction basculer en `security definer`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

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

/*
  L'ORDRE DES PALIERS D'UNE SÉQUENCE, RENDU EN UNE CHAÎNE COMPARABLE.

  Comparer trois positions une à une demanderait trois assertions par geste et rendrait la suite
  illisible ; comparer un `array_agg` masquerait quel palier est mal placé dans le message d'échec.
  Une chaîne `a1,a2,a3` nomme les deux à la fois.
*/
create or replace function pg_temp.ordre(sequence uuid)
returns text language sql stable as $$
	select string_agg(right(s.id::text, 2), ',' order by s.position)
	  from public.mail_sequence_steps s
	 where s.sequence_id = sequence;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire — donc hors RLS.
-- ---------------------------------------------------------------------------------------------
-- LE NOM DES FIXTURES PORTE CELUI DU FICHIER, précaution MESURÉE par la suite 0047 : une fixture
-- portant un nom que le seed prendrait ensuite tuerait la suite à sa première insertion, l'unicité
-- par workspace du §11.3 s'y opposant.
--
-- TROIS PALIERS, ET TROIS SONT NÉCESSAIRES : deux ne donnent qu'une permutation, indiscernable
-- d'un échange trivial, et le refus « ordre partiel » y serait indiscernable du refus « tableau à
-- un élément ». C'est le raisonnement du §11.9 sur le seed, transposé à la preuve.

insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values ('d0000000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-000000000001',
        'Modèle d''essai de la suite 0060', 'Objet 0060', 'Un corps sans variable.');

insert into public.mail_sequences (id, workspace_id, name)
values ('d0000000-0000-4000-8000-0000000000e1', '5eed0000-0000-4000-8000-000000000001',
        'Séquence d''essai de la suite 0060');

insert into public.mail_sequence_steps (id, workspace_id, sequence_id, position, delai_jours, template_id)
values
	('d0000000-0000-4000-8000-0000000000d1', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000e1', 1, 3, 'd0000000-0000-4000-8000-0000000000f1'),
	('d0000000-0000-4000-8000-0000000000d2', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000e1', 2, 7, 'd0000000-0000-4000-8000-0000000000f1'),
	('d0000000-0000-4000-8000-0000000000d3', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000e1', 3, 14, 'd0000000-0000-4000-8000-0000000000f1');

-- Une SECONDE séquence, dont un palier servira de corps étranger au refus `paliers_incomplets`.
insert into public.mail_sequences (id, workspace_id, name)
values ('d0000000-0000-4000-8000-0000000000e2', '5eed0000-0000-4000-8000-000000000001',
        'Séquence voisine de la suite 0060');

insert into public.mail_sequence_steps (id, workspace_id, sequence_id, position, delai_jours, template_id)
values
	('d0000000-0000-4000-8000-0000000000d9', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000e2', 1, 5, 'd0000000-0000-4000-8000-0000000000f1');

-- =============================================================================================
-- 1. La forme de la fonction dans le catalogue — §13.3
-- =============================================================================================

select has_function('public', 'reordonner_paliers_sequence', array['uuid', 'uuid[]'],
	'1. `public.reordonner_paliers_sequence(uuid, uuid[])` existe');

select is(
	(select p.provolatile from pg_proc p
	  where p.oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure),
	'v'::"char",
	'2. Elle est VOLATILE — elle écrit, et l''annoncer stable la ferait mettre en cache par le planificateur');

-- LA DÉCISION DE FORME DU §13.1 QUESTION 2. Une fonction `security definer` devrait RÉÉCRIRE la
-- règle d'écriture de la migration 59, et deux écritures de la même règle divergent.
select is(
	(select p.prosecdef from pg_proc p
	  where p.oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure),
	false,
	'3. Elle est `security INVOKER` — la RLS de la migration 59 fait tout le tri (§13.1 question 2)');

-- LA VALEUR ATTENDUE EST `search_path=""` ET NON `search_path=`, ET C'EST UNE MESURE QUI L'A
-- CORRIGÉE : PostgreSQL stocke `set search_path = ''` dans `proconfig` avec ses guillemets, la
-- chaîne vide devant être distinguable d'une valeur absente. Écrite de mémoire, l'assertion
-- rougissait sur une fonction parfaitement conforme.
select is(
	(select p.proconfig from pg_proc p
	  where p.oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure),
	array['search_path=""'],
	'4. Son `search_path` est VIDE — aucun schéma de l''appelant n''entre dans sa résolution');

select is(
	has_function_privilege('anon', 'public.reordonner_paliers_sequence(uuid, uuid[])', 'EXECUTE'),
	false,
	'5. `anon` NE L''EXÉCUTE PAS — le refus tombe sur le PRIVILÈGE, avant la fonction (§13.3)');

select is(
	has_function_privilege('authenticated', 'public.reordonner_paliers_sequence(uuid, uuid[])', 'EXECUTE'),
	true,
	'6. `authenticated` l''exécute — c''est la RLS, ensuite, qui décide de ce qui s''écrit');

select is(
	has_function_privilege('service_role', 'public.reordonner_paliers_sequence(uuid, uuid[])', 'EXECUTE'),
	true,
	'7. `service_role` l''exécute');

-- =============================================================================================
-- 2. Les deux décisions de forme du §13.2, figées par des assertions
-- =============================================================================================
--
-- LA PREMIÈRE EST LA PLUS IMPORTANTE DE CETTE SUITE. Le §11.6 bis annonçait un `set constraints` ;
-- la mesure du 2026-08-26 a montré qu'il est inutile, la contrainte étant vérifiée en FIN
-- D'INSTRUCTION. Réintroduire la commande ferait croire au lecteur suivant que la contrainte est
-- `initially deferred` — ce qu'elle n'est pas, et ce qu'elle ne doit pas devenir (§11.6).

-- ELLE LIT LE CODE SANS SES COMMENTAIRES, ET C'EST LE FAUX ROUGE DU §9.10 bis, RENCONTRÉ UNE
-- SECONDE FOIS. Écrite sur le corps BRUT, l'assertion trouvait `set constraints` dans le
-- commentaire qui explique précisément pourquoi la commande est absente — et rougissait sur une
-- fonction parfaitement conforme. Le remède est celui que le §9.10 bis a déjà écrit pour le
-- harnais de l'écran des modèles : retirer les commentaires de ligne avant de chercher.
select is(
	(select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'set\s+constraints' from pg_proc p
	  where p.oid = 'public.reordonner_paliers_sequence(uuid, uuid[])'::regprocedure),
	false,
	'8. Son corps n''émet AUCUN `set constraints` — la mesure du §13.2 l''a écarté, motif écrit');

-- LE PRÉALABLE SANS LEQUEL LA FONCTION ÉCHOUERAIT. Sa disparition doit faire rougir CETTE suite,
-- et non l'écran en production.
select is(
	(select c.condeferrable from pg_constraint c
	  where c.conname = 'mail_sequence_steps_sequence_position_key'),
	true,
	'9. La contrainte de position est DEFERRABLE — préalable mesuré du §11.6');

select is(
	(select c.condeferred from pg_constraint c
	  where c.conname = 'mail_sequence_steps_sequence_position_key'),
	false,
	'10. …et `initially IMMEDIATE` — hors réordonnancement, un doublon est refusé à l''instruction qui le crée');

-- =============================================================================================
-- 3. Les trois refus du §13.3, chacun précédé de son témoin
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- TÉMOIN COMMUN AUX TROIS REFUS : le même geste, bien formé, passe. Sans lui, chaque refus vert
-- pourrait n'être que l'effet d'une fonction qui refuse tout.
select is(
	public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d2',
		      'd0000000-0000-4000-8000-0000000000d3']::uuid[]),
	3,
	'11. TÉMOIN — un ordre complet et bien formé repose les TROIS paliers');

select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1', array[]::uuid[])$$,
	'23514', 'paliers_requis',
	'12. REFUS (a) — un tableau VIDE est refusé, et non silencieusement rendu à `0` (§13.3)');

select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1', null::uuid[])$$,
	'23514', 'paliers_requis',
	'13. REFUS (a) — un tableau NUL tombe sous le même refus, et non sur un `cardinality` nul');

select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d3']::uuid[])$$,
	'23514', 'paliers_dupliques',
	'14. REFUS (b) — un DOUBLON est refusé ici, aucune contrainte de la base ne le verrait');

select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d2']::uuid[])$$,
	'23514', 'paliers_incomplets',
	'15. REFUS (c) — un ordre PARTIEL est refusé : il laisserait un palier hors de `1..n`');

-- LE PALIER ÉTRANGER EST CELUI D'UNE AUTRE SÉQUENCE, ET NON UN IDENTIFIANT INVENTÉ : c'est le cas
-- qu'un écran produirait réellement — deux onglets ouverts sur deux séquences.
select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d2',
		      'd0000000-0000-4000-8000-0000000000d9']::uuid[])$$,
	'23514', 'paliers_incomplets',
	'16. REFUS (c) — un palier d''une AUTRE séquence est refusé, bien que le CARDINAL soit juste');

-- UNE SÉQUENCE INCONNUE REND LE MÊME REFUS, ET C'EST DÉLIBÉRÉ (§13.3) : une phrase qui dirait
-- « cette séquence n'existe pas » renseignerait un appelant sans droit sur ce que la RLS cache.
select throws_ok(
	$$select public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000eF',
		array['d0000000-0000-4000-8000-0000000000d1']::uuid[])$$,
	'23514', 'paliers_incomplets',
	'17. REFUS (c) — une séquence INCONNUE rend le MÊME refus, jamais un message qui la nomme');

-- =============================================================================================
-- 4. La permutation, relue position à position — §13.2
-- =============================================================================================

select is(pg_temp.ordre('d0000000-0000-4000-8000-0000000000e1'), 'd1,d2,d3',
	'18. TÉMOIN — l''ordre de départ est bien `d1,d2,d3`');

select is(
	public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d3',
		      'd0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d2']::uuid[]),
	3,
	'19. Une ROTATION complète est acceptée — trois paliers repositionnés en UNE instruction');

-- L'ASSERTION QUI COMPTE : le compte de retour ne prouve rien tant que les positions ne sont pas
-- relues. Une fonction qui rendrait `3` sans rien déplacer serait verte sur le compte seul.
select is(pg_temp.ordre('d0000000-0000-4000-8000-0000000000e1'), 'd3,d1,d2',
	'20. …et les positions RELUES portent l''ordre envoyé (§13.2)');

-- L'INVERSION COMPLÈTE EST LE CAS OÙ **AUCUN** PALIER NE GARDE SA POSITION : c'est celui qu'une
-- contrainte non différée refuserait à coup sûr, et il est joué explicitement.
select is(
	public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d2',
		      'd0000000-0000-4000-8000-0000000000d1',
		      'd0000000-0000-4000-8000-0000000000d3']::uuid[]),
	3,
	'21. Un ÉCHANGE des deux premiers est accepté — aucun `set constraints` n''a été émis');

select is(pg_temp.ordre('d0000000-0000-4000-8000-0000000000e1'), 'd2,d1,d3',
	'22. …et les positions relues le confirment');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Le zéro-ligne de la lectrice — §13.3, et la conséquence du `security invoker`
-- =============================================================================================
--
-- C'EST L'ASSERTION QUI VERRAIT LA FONCTION BASCULER EN `security definer`. Sous `definer`, la
-- lectrice écrirait — la fonction s'exécutant avec les droits de `postgres` — et le compte rendu
-- vaudrait `3`. Le refus de la politique de la migration 59 ne serait alors plus opposable par
-- cette porte.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	public.reordonner_paliers_sequence(
		'd0000000-0000-4000-8000-0000000000e1',
		array['d0000000-0000-4000-8000-0000000000d3',
		      'd0000000-0000-4000-8000-0000000000d2',
		      'd0000000-0000-4000-8000-0000000000d1']::uuid[]),
	0,
	'23. LA LECTRICE OBTIENT `0` — un refus de politique, jamais une exception (§7 des permissions)');

select is(pg_temp.ordre('d0000000-0000-4000-8000-0000000000e1'), 'd2,d1,d3',
	'24. …et les positions sont RELUES INCHANGÉES — le `0` n''était pas un succès silencieux');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- Toutes les écritures de cette suite vivent dans la transaction, que le `rollback` défait.

select * from finish();

rollback;

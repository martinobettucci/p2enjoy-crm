-- @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences,
--            SOUS-TRANCHE 3B : l'émission
-- @verifies docs/SPEC-notifications.md §34 (d'où vient la liste du sélecteur), §34.2 (la forme :
--            `stable`, `security invoker`, `search_path` vide), §34.3 (l'appelant ne figure pas
--            dans sa propre liste, et la limite de la clé de service), §34.4 (privilèges, et
--            `anon` révoqué NOMMÉMENT), §5.1 (la règle d'éligibilité), §40 (preuves attendues)
-- @verifies docs/SCHEMA.md §9 bis.9 bis ; docs/PROD_MIGRATIONS.md §3 (migration 66)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS la règle d'éligibilité : `0061_mentions_commentaires.test.sql` la tient, et
-- la sous-tranche 3b ne la touche pas. Elle ne reprouve pas non plus la production d'une
-- notification : `0062` la tient. Ces deux suites doivent rester VERTES SANS AUCUNE MODIFICATION,
-- et c'est là qu'est la preuve de non-régression de cette sous-tranche, pas ici.
--
-- Ce que ce fichier prouve, et que rien d'autre ne prouve :
--
-- 1. QUE LA FONCTION EST `SECURITY INVOKER` (§34.2). En `DEFINER`, elle répondrait pour `postgres`,
--    qui traverse toute la RLS, et rendrait les membres d'un workspace que l'appelant n'atteint
--    pas. Aucune preuve d'API ne peut voir cette propriété : elle ne se lit que dans le catalogue.
--
-- 2. QUE `anon` N'A PAS `execute`, ET QUE `authenticated` L'A. C'est la leçon payée par la
--    migration `0053` : `pg_default_acl` accorde `execute` à `anon` sur toute fonction neuve de
--    `public`, et `revoke … from public` ne lui retire rien. Un oubli de la ligne `revoke` rendrait
--    `200 []` là où le contrat annonce `401` — une preuve d'API le verrait, mais seulement si elle
--    est écrite ; l'assertion de catalogue, elle, ne dépend d'aucun jeton.
--
-- 3. QUE LA FONCTION NE RELIT AUCUNE TABLE D'APPARTENANCE. C'est la contre-épreuve de la « seconde
--    écriture de la règle » : une définition qui recopierait le prédicat de `app.resolve_access`
--    passerait toutes les assertions de forme et rendrait, aujourd'hui, exactement les mêmes
--    lignes. Elle divergerait au premier niveau de droit ajouté. L'assertion 6 lit la DÉFINITION.
--
-- 4. QUE L'APPELANT EST RETIRÉ DE SA PROPRE LISTE (§34.3), sous un appelant réel. Cette suite
--    s'exécute sous le PROPRIÉTAIRE, où `auth.uid()` est nul : l'assertion pose donc la
--    revendication elle-même, ce qui est la seule façon d'éprouver la règle hors de l'API.
--
-- 5. QUE LA LIMITE DE LA CLÉ DE SERVICE EST CELLE QUI EST ÉCRITE (§34.3) : `auth.uid()` nul, donc
--    personne n'est retiré, et la fonction rend TOUS les membres éligibles — jamais zéro ligne.
--    Sans le `coalesce` de la migration, la comparaison vaudrait `NULL` et la fonction rendrait un
--    silence dont aucune preuve ne dirait la cause. C'est exactement ce que fige l'assertion 10.
--
-- 6. QUE LE REFUS EST ZÉRO LIGNE, JAMAIS UNE ERREUR (§34.2, M8), sur l'affaire mesurée du seed :
--    Farida est `none` sur « Grands comptes », donc `…0c1` ne lui est pas ouverte.
--
-- La suite écrit puis fait `rollback` : le seed est rendu intact. Elle n'écrit d'ailleurs rien —
-- la fonction est une lecture —, mais la transaction est ouverte pour que les `set local role` et
-- `set local request.jwt.claims` ne fuient pas hors de la suite.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.p_admin() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.p_bizdev() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.p_viewer() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- `…0c1` : « Refonte du site vitrine », channel « Grands comptes », que la lectrice NE LIT PAS.
-- `…0c5` : « Support niveau 2 », channel « Maintenance », que les trois profils lisent.
-- Cet écart est la mesure M1, et il existe DÉJÀ dans le seed : la même personne y est éligible sur
-- une affaire et pas sur l'autre. Aucune donnée n'est fabriquée pour cette suite.
create or replace function pg_temp.card_fermee_a_la_lectrice() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.card_ouverte_a_tous() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c5'::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 6. La forme de la fonction — docs/SPEC-notifications.md §34.2
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'mentionnables', array['uuid'],
	'CRM-064 §34.2 — `public.mentionnables(uuid)` existe : sans elle, le sélecteur du composeur '
	'devrait calculer l''éligibilité lui-même, ce que `CLAUDE.md` §10 interdit');

-- `SECURITY INVOKER`, ET C'EST LE POINT MÊME DE LA FONCTION. En `DEFINER`, la lecture de
-- `public.cards` ignorerait la RLS de l'appelant, et une affaire fermée rendrait la liste de ses
-- lecteurs au lieu de zéro ligne.
select is(
	(select p.prosecdef from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables'),
	false,
	'CRM-064 §34.2 — `security invoker`, JAMAIS `definer` : la RLS de « cards » décide seule, et '
	'c''est ce qui fait du refus un ZÉRO LIGNE plutôt qu''une fuite');

-- `STABLE` : PostgREST n'expose en `GET` que les fonctions non volatiles. `volatile` — la valeur
-- par défaut de PostgreSQL, donc l'oubli le plus probable — lui ferait perdre ce droit.
select is(
	(select p.provolatile from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables'),
	's'::"char",
	'CRM-064 §34.2 — `stable` : le corps lit des tables, donc pas `immutable` ; et non `volatile`, '
	'que PostgREST refuserait d''exposer en lecture');

select is(
	(select p.proconfig from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mentionnables'),
	array['search_path=""'],
	'CRM-064 §34.2 — `search_path` VIDE : tous les objets du corps sont pleinement qualifiés, comme '
	'`public.cards_figees` et `public.inbox_arborescence`');

-- LES TROIS COLONNES, ET TROIS SEULEMENT. En ajouter une demain doit faire rougir cette suite :
-- le module client projette ces trois-là, et une quatrième arriverait sans que rien ne la lise.
select is(
	(select array_agg(nom order by rang)
	   from (
	     select unnest(p.proargnames) as nom,
	            generate_subscripts(p.proargnames, 1) as rang
	       from pg_catalog.pg_proc p
	       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	      where n.nspname = 'public' and p.proname = 'mentionnables'
	   ) noms
	  where nom <> 'card_id'),
	array['profile_id', 'full_name', 'avatar_url'],
	'CRM-064 §34.2 — trois colonnes rendues, et trois seulement : ce que la case à cocher affiche');

-- LA RÈGLE N'A QU'UNE SEULE ÉCRITURE (§34.1), ET C'EST CETTE ASSERTION QUI L'ÉPROUVE. Une
-- définition qui recopierait le prédicat rendrait AUJOURD'HUI les mêmes lignes : aucune assertion
-- de résultat ne la prendrait en défaut. Seule la lecture de la définition le peut.
-- LA DÉFINITION EST LUE SANS SES COMMENTAIRES, ET C'EST UNE CORRECTION MESURÉE : écrite d'abord
-- sur `pg_get_functiondef` brut, cette assertion rougissait sur le PROPRE COMMENTAIRE de la
-- migration, qui nomme `track_members` et `channel_members` pour dire qu'elle ne les lit pas. Une
-- assertion qui prend en défaut la prose expliquant la règle ne mesure pas la règle.
create or replace function pg_temp.corps_mentionnables() returns text language sql stable as $corps$
	select regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
	  from pg_catalog.pg_proc p
	  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'mentionnables'
$corps$;

select ok(
	pg_temp.corps_mentionnables() like '%app.can_read_card_pour%'
	and pg_temp.corps_mentionnables() not like '%track_members%'
	and pg_temp.corps_mentionnables() not like '%channel_members%'
	and pg_temp.corps_mentionnables() not like '%resolve_access%',
	'CRM-064 §34.1 — elle DÉLÈGUE à `app.can_read_card_pour` et ne relit NI `track_members` NI '
	'`channel_members` : une copie du prédicat rendrait les mêmes lignes aujourd''hui et '
	'divergerait au premier niveau de droit ajouté');

-- ---------------------------------------------------------------------------------------------
-- 7 à 8. Les privilèges — docs/SPEC-notifications.md §34.4
-- ---------------------------------------------------------------------------------------------

-- `anon` EST RÉVOQUÉ NOMMÉMENT, et c'est la leçon de la migration `0053`. Sans la ligne `revoke`,
-- `pg_default_acl` lui aurait laissé `execute`, et un appelant anonyme obtiendrait `200 []` là où
-- le contrat annonce `401` : un refus par le privilège est plus strict qu'une liste vide.
select is(
	has_function_privilege('anon', 'public.mentionnables(uuid)', 'EXECUTE'),
	false,
	'CRM-064 §34.4 — `anon` N''A PAS `execute` : refusé PAR LE PRIVILÈGE, avant toute politique');

select is(
	has_function_privilege('authenticated', 'public.mentionnables(uuid)', 'EXECUTE'),
	true,
	'CRM-064 §34.4 — `authenticated` a `execute` : c''est le rôle sous lequel l''écran appelle');

-- ---------------------------------------------------------------------------------------------
-- 9 à 12. Ce que la fonction REND, sous des appelants réels
-- ---------------------------------------------------------------------------------------------

-- L'APPELANT EST RETIRÉ DE SA PROPRE LISTE (§34.3), et la lectrice est retirée par l'ÉLIGIBILITÉ.
-- Les deux exclusions tombent dans la même assertion, et c'est voulu : elles sont indistinguables
-- de l'extérieur, ce sont les assertions 10 et 11 qui les séparent.
set local role authenticated;
set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000011","role":"authenticated"}';

select is(
	(select array_agg(m.profile_id::text order by m.full_name)
	   from public.mentionnables(pg_temp.card_fermee_a_la_lectrice()) m),
	array[pg_temp.p_bizdev()::text],
	'CRM-064 §34.3, §5.1 — sous l''administratrice, sur une affaire de « Grands comptes » : une '
	'seule personne. La lectrice en est retirée par l''ÉLIGIBILITÉ (M1), l''appelante par la règle '
	'de l''auto-mention');

-- LA MÊME PERSONNE, ÉLIGIBLE AILLEURS. C'est ce qui rend la preuve stricte : une fonction qui
-- rendrait partout la même liste passerait l'assertion 9 en écartant Farida par erreur.
select is(
	(select array_agg(m.profile_id::text order by m.full_name)
	   from public.mentionnables(pg_temp.card_ouverte_a_tous()) m),
	array[pg_temp.p_bizdev()::text, pg_temp.p_viewer()::text],
	'CRM-064 §5.1 — sur « Maintenance », la MÊME lectrice est éligible : la liste dépend de '
	'l''affaire, jamais du seul workspace');

-- LE REFUS EST ZÉRO LIGNE, JAMAIS UNE ERREUR (§34.2, M8). Sous la lectrice, l'affaire de
-- « Grands comptes » n'existe pas — la RLS de `public.cards` la lui cache —, et la fonction ne
-- lève rien : elle ne rend rien. C'est la forme exigée par `docs/SPEC-permissions-rls.md` §7.
set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000013","role":"authenticated"}';

select is(
	(select count(*)::integer from public.mentionnables(pg_temp.card_fermee_a_la_lectrice())),
	0,
	'CRM-064 §34.2 — sous la lectrice, une affaire qui ne lui est pas ouverte rend ZÉRO LIGNE et '
	'AUCUNE erreur : le refus se mesure comme une absence, jamais comme une exception');

-- LA LIMITE DE LA CLÉ DE SERVICE EST CELLE QUI EST ÉCRITE (§34.3). `auth.uid()` y étant nul,
-- personne n'est retiré et les trois membres éligibles sont rendus. SANS le `coalesce` de la
-- migration, `p.id <> null` vaudrait `NULL`, donc faux, et la fonction rendrait ZÉRO LIGNE au
-- service — un silence dont aucune preuve d'API ne dirait la cause. Cette assertion est la seule
-- du dépôt à pouvoir le voir.
reset role;
set local request.jwt.claims to '';

select is(
	(select count(*)::integer from public.mentionnables(pg_temp.card_ouverte_a_tous())),
	3,
	'CRM-064 §34.3 — sans revendication, `auth.uid()` est nul : personne n''est retiré et les TROIS '
	'membres éligibles sont rendus. Un `coalesce` manquant rendrait zéro, en silence');

select * from finish();

rollback;

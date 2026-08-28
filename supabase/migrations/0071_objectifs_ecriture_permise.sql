-- @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, TRANCHE 3 : l'état de lecture seule
-- @spec docs/SPEC-goals.md §5.7 (l'arbitrage d'INC-170 et son contrat), §5.7.4 (contrat opposable),
--       §5.4 (états de l'écran), §4.2 (écriture)
-- @spec docs/SCHEMA.md §9 bis.8 bis (`public.ecriture_permise`), §9 bis.8 (le même mécanisme,
--       migration 52, dont celle-ci est la transposition)
-- @spec docs/SPEC-permissions-rls.md §7 (formes du refus : zéro ligne contre 403)
-- @spec docs/DESIGN_SYSTEM.md §5.29 ter (ce que l'écran en fait, et ce qu'il ne relâche pas)
-- @spec docs/PROD_MIGRATIONS.md §3.2 (migration 71)
--
-- CETTE MIGRATION AJOUTE UNE SEULE FONCTION, ET ELLE NE LIT AUCUNE DONNÉE NOUVELLE.
--
-- Le §5.4 de `docs/SPEC-goals.md` demande depuis l'origine un état de lecture seule du canevas.
-- Son déclencheur était rédigé comme un RÔLE — « le `viewer` » —, ce que `docs/DESIGN_SYSTEM.md`
-- interdit neuf fois : la règle réelle vit dans les politiques, et un rôle ne la résume pas. C'est
-- la contradiction qu'INC-170 portait depuis le 2026-08-19, et l'arbitrage du 2026-08-28 (décision
-- 546) la ferme en déplaçant le déclencheur, jamais en retirant l'état : la BASE dit la capacité,
-- l'écran ne la déduit plus.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'EST PAS, ET C'EST ÉCRIT EN TÊTE.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UNE AUTORISATION NOUVELLE. La fonction ne rend qu'un booléen, et seulement sur
--    une ligne que la RLS a DÉJÀ consentie : un tableau que l'appelant ne lit pas n'est pas rendu,
--    et sa colonne calculée ne l'est donc pas non plus. `app.can_write_goal_board` est par ailleurs
--    déjà exécutable par `anon` et `authenticated` depuis la migration 49.
--
-- 2. CE N'EST PAS UNE RÈGLE D'INTERFACE DÉPLACÉE EN BASE. La règle EST en base — ce sont les
--    politiques `goal_blocks_*` et `goal_links_*` de la migration 49 —, et cette fonction ne fait
--    que la RENDRE LISIBLE.
--
-- 3. CE N'EST PAS LA VÉRITÉ DE TOUS LES GESTES, et c'est MESURÉ (`docs/SPEC-goals.md` §5.7.2,
--    mesure D) : poser un lien exige EN OUTRE `app.can_write_channel` sur la destination, si bien
--    qu'un appelant pour qui cette colonne vaut `true` reçoit quand même `403` / `42501` en liant
--    un bloc à un channel qu'il lit sans l'écrire. La colonne est donc une condition SUFFISANTE de
--    refus, jamais NÉCESSAIRE : l'écran éteint sur elle et continue de traduire les refus partout
--    ailleurs. Un écran qui la lirait comme « tout passe » rejouerait une règle de la base et
--    divergerait d'elle au premier changement de politique.
--
-- 4. CE N'EST PAS UNE RPC. C'est une COLONNE CALCULÉE au sens de PostgREST : une fonction dont
--    l'unique argument est le type composite de la table est exposée comme une colonne de plus, et
--    se demande dans le même `select` que les autres. Aucun aller-retour supplémentaire n'est donc
--    payé (`CLAUDE.md` §21).
--
-- 5. AUCUNE TABLE N'EST CRÉÉE NI MODIFIÉE, aucune politique n'est touchée, aucun trigger n'est
--    posé, aucun index n'est bâti.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du répertoire
-- à chaque démarrage de la pile (`docs/DAT.md` §3.2). `create or replace function` puis `revoke` et
-- `grant` nominatifs sont rejouables sans effet de bord.

-- =============================================================================================
-- 1. `public.ecriture_permise(goal_boards)` — la capacité d'écriture, rendue comme une colonne
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.8 bis, docs/SPEC-goals.md §5.7.4.

create or replace function public.ecriture_permise(tableau public.goal_boards)
returns boolean
language sql
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI CRITIQUE PLUTÔT QUE NEUTRE.
--
-- En `SECURITY DEFINER`, cette fonction répondrait pour le propriétaire de la fonction — `postgres`,
-- qui traverse toute la RLS — et rendrait donc `true` à TOUT appelant, lectrice comprise. Le canevas
-- n'afficherait alors JAMAIS son état de lecture seule, et le §5.4 se lirait exactement à l'envers.
-- C'est le seul défaut que cette migration peut introduire, et c'est pourquoi
-- `docs/PROD_MIGRATIONS.md` §3.2 en fait sa première vérification d'après-application.
--
-- AUCUN `set search_path` N'EST POSÉ, et ce n'est pas un oubli : même raison qu'à la migration 52.
-- La consigne de `search_path` vide vise les fonctions `SECURITY DEFINER`, où un chemin contrôlé
-- par l'appelant permettrait de détourner un nom non qualifié. Ici la fonction s'exécute avec les
-- droits de l'appelant — elle ne lui donne rien qu'il n'ait déjà — et son corps ne cite qu'un nom
-- PLEINEMENT QUALIFIÉ, `app.can_write_goal_board`.
as $$
	select app.can_write_goal_board(tableau.id);
$$;

comment on function public.ecriture_permise(public.goal_boards) is
	'CRM-083 — docs/SPEC-goals.md §5.7, docs/SCHEMA.md §9 bis.8 bis. Colonne CALCULÉE au sens de '
	'PostgREST : la capacité d''écriture effective du tableau, rendue par la base pour que le '
	'canevas puisse rendre son état de LECTURE SEULE sans jamais déduire un droit d''un rôle '
	'(INC-170, décision 546). Condition SUFFISANTE de refus, jamais nécessaire : poser un lien '
	'exige en outre app.can_write_channel. SECURITY INVOKER obligatoire : en DEFINER, elle rendrait '
	'« true » à tout le monde et l''état ne paraîtrait jamais.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite. `anon` reçoit `execute` pour la raison exacte qui le lui fait recevoir sur
-- `public.reel_saisissable` (migration 52) : sans lui, un appelant anonyme atteignant `goal_boards`
-- recevrait une ERREUR DE PRIVILÈGE là où `docs/SPEC-permissions-rls.md` §7 exige zéro ligne. Le
-- droit n'ouvre rien — `auth.uid()` étant nul, `app.can_write_goal_board` rend faux, ce qui est
-- MESURÉ (`docs/SPEC-goals.md` §5.7.2, mesure B).
revoke all on function public.ecriture_permise(public.goal_boards) from public;
grant execute on function public.ecriture_permise(public.goal_boards) to anon, authenticated, service_role;

-- =============================================================================================
-- 2. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une colonne calculée neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement : un
-- `select=…,ecriture_permise` rendrait `400 / PGRST202` sur une pile déjà démarrée. Le
-- `migrations-runner` s'exécute avant le service `rest` au premier démarrage, mais il rejoue aussi
-- le répertoire sur une pile chaude (`docs/JOURNAL.md` décision 471) : la notification est donc
-- posée ici plutôt que laissée à un redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

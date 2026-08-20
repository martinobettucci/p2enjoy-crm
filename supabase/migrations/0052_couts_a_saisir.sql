-- @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6a : le socle de données de l'onglet
--       « À saisir »
-- @spec docs/SPEC-costs.md §4.8 (l'onglet), §4.8.1 (contrat de lecture : le droit d'écriture est
--       rendu par la base, jamais calculé par l'interface), §2.3 (« nul n'est pas zéro », et la
--       frontière exacte de la clôture), §3.1 (double condition de lecture), §3.2 (écriture)
-- @spec docs/SCHEMA.md §9 bis.8 (`public.reel_saisissable`), §9 bis.6 (`card_costs`),
--       §9 bis.7 (politiques)
-- @spec docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §7 (formes du refus)
-- @spec docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 52)
--
-- CETTE MIGRATION AJOUTE UNE SEULE FONCTION, ET ELLE NE LIT AUCUNE DONNÉE NOUVELLE.
--
-- L'onglet « À saisir » du §4.8 est le SEUL endroit du produit où l'interface doit connaître un
-- droit d'écriture AVANT de rendre son contrôle : « une ligne lisible mais non écrivable —
-- `app.can_write_card` faux — est rendue en lecture seule, avec le motif, jamais masquée ». Partout
-- ailleurs, le produit envoie et traduit le refus (`docs/DESIGN_SYSTEM.md` §5.13, §5.16, §5.21), et
-- aucune commande n'est éteinte d'avance. Ici la spécification demande l'inverse, et pour une raison
-- qui lui est propre : un tableau de saisie en série n'est pas une commande, c'est une SURFACE, et
-- l'utilisateur doit savoir avant de taper quelles lignes il peut renseigner.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'EST PAS, ET C'EST ÉCRIT EN TÊTE.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UNE AUTORISATION NOUVELLE. La fonction ne rend qu'un booléen, et seulement sur
--    une ligne que la RLS a DÉJÀ consentie : une ligne que l'appelant ne lit pas n'est pas rendue,
--    et sa colonne calculée ne l'est donc pas non plus. `app.can_write_card` est par ailleurs déjà
--    exécutable par `anon` et `authenticated` depuis la migration 13.
--
-- 2. CE N'EST PAS UNE RÈGLE D'INTERFACE DÉPLACÉE EN BASE. La règle EST en base — c'est la politique
--    `card_costs_modification` de la migration 51 —, et cette fonction ne fait que la RENDRE
--    LISIBLE. Un écran qui déduirait le même droit d'un rôle de workspace serait faux : les droits
--    fins de `docs/SPEC-permissions-rls.md` §3.7 ouvrent l'écriture par channel, et un
--    `business_developer` écrit certaines affaires et pas d'autres.
--
-- 3. CE N'EST PAS UNE RPC. C'est une COLONNE CALCULÉE au sens de PostgREST : une fonction dont
--    l'unique argument est le type composite de la table est exposée comme une colonne de plus, et
--    se demande dans le même `select` que les autres. Aucun aller-retour supplémentaire n'est donc
--    payé (`CLAUDE.md` §21), là où un appel par ligne en aurait payé un par ligne.
--
-- 4. AUCUNE TABLE N'EST CRÉÉE NI MODIFIÉE, aucune politique n'est touchée, aucun trigger n'est
--    posé. Le point de sûreté des migrations 48 à 51 — les `alter default privileges` de la
--    plateforme qui ouvrent en écriture toute table neuve de `public` — n'a donc aucun objet ici.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du répertoire
-- à chaque démarrage de la pile (`docs/DAT.md` §3.2). `create or replace function` puis `revoke` et
-- `grant` nominatifs sont rejouables sans effet de bord.

-- =============================================================================================
-- 1. `public.reel_saisissable(card_costs)` — le droit d'écriture, rendu comme une colonne
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.8, docs/SPEC-costs.md §4.8.1.

create or replace function public.reel_saisissable(ligne public.card_costs)
returns boolean
language sql
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI CRITIQUE PLUTÔT QUE NEUTRE.
--
-- En `SECURITY DEFINER`, cette fonction répondrait pour le propriétaire de la fonction — `postgres`,
-- qui traverse toute la RLS — et rendrait donc `true` à TOUT appelant, `viewer` compris. L'onglet
-- rendrait alors des champs de saisie dont chaque envoi serait refusé, et le §4.8 se lirait à
-- l'envers : « rendue en lecture seule avec le motif » deviendrait « rendue saisissable et refusée
-- après coup ». C'est le seul défaut que cette migration peut introduire, et c'est pourquoi
-- `docs/PROD_MIGRATIONS.md` §3 en fait sa vérification d'après-application.
--
-- AUCUN `set search_path` N'EST POSÉ, et ce n'est pas un oubli. La consigne de `search_path` vide
-- vise les fonctions `SECURITY DEFINER`, où un chemin de recherche contrôlé par l'appelant
-- permettrait de détourner un nom non qualifié. Ici la fonction s'exécute avec les droits de
-- l'appelant — elle ne lui donne donc rien qu'il n'ait déjà — et son corps ne cite qu'un nom
-- PLEINEMENT QUALIFIÉ, `app.can_write_card`. Poser `search_path = ''` serait sans effet utile ;
-- ne pas le poser n'ouvre rien.
as $$
	select app.can_write_card(ligne.card_id);
$$;

comment on function public.reel_saisissable(public.card_costs) is
	'CRM-086 — docs/SPEC-costs.md §4.8.1, docs/SCHEMA.md §9 bis.8. Colonne CALCULÉE au sens de '
	'PostgREST : le droit d''écriture effectif de la ligne, rendu par la base pour que l''onglet '
	'« À saisir » puisse rendre une ligne non écrivable en lecture seule AVEC SON MOTIF plutôt que '
	'de la refuser après coup. SECURITY INVOKER obligatoire : en DEFINER, elle rendrait « true » à '
	'tout le monde.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite. `anon` reçoit `execute` pour la raison exacte qui la fait recevoir celui
-- d'`app.can_write_card` (migration 13) : sans lui, un appelant anonyme atteignant `card_costs`
-- recevrait une ERREUR DE PRIVILÈGE là où `docs/SPEC-permissions-rls.md` §7 exige zéro ligne. Le
-- droit n'ouvre rien — `auth.uid()` étant nul, `app.can_write_channel` rend faux.
revoke all on function public.reel_saisissable(public.card_costs) from public;
grant execute on function public.reel_saisissable(public.card_costs) to anon, authenticated, service_role;

-- =============================================================================================
-- 2. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une colonne calculée neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement : un
-- `select=…,reel_saisissable` rendrait `400 / PGRST202` sur une pile déjà démarrée. Le
-- `migrations-runner` s'exécute avant le service `rest` au premier démarrage, mais il rejoue aussi
-- le répertoire sur une pile chaude (`docs/JOURNAL.md` décision 471) : la notification est donc
-- posée ici plutôt que laissée à un redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

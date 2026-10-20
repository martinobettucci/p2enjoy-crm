-- @spec CRM-093 (docs/BACKLOG.md) — tranche T1 : la capacité d'écriture sur un channel et sur une affaire, lisible par
--       l'interface
-- @spec docs/SPEC-droits-interface.md §2 (les trois faits), §2.1 (les deux colonnes calculées)
-- @spec docs/SCHEMA.md §9 bis.8 ter ; docs/SPEC-permissions-rls.md §3.3, §3.3 bis (« le plus spécifique gagne »),
--       §7 (formes du refus : zéro ligne contre 403)
-- @spec docs/JOURNAL.md décision 628 ; docs/PROD_MIGRATIONS.md §3 (migration 91)
--
-- DEUX FONCTIONS, AU PATRON EXACT DE LA MIGRATION 71 (`public.ecriture_permise(goal_boards)`).
--
-- Ce que l'interface doit savoir pour offrir — ou désactiver avec son motif — un geste sur une affaire est une seule
-- chose : l'appelant peut-il écrire sur le channel ? `app.can_write_card` est défini ainsi, et toutes les politiques
-- d'écriture de la famille « affaire » s'y ramènent (`docs/SPEC-droits-interface.md` §2, mesuré sur `pg_policies`).
-- Ces deux colonnes calculées RENDENT LISIBLE cette règle ; elles n'en écrivent aucune.
--
-- CE QUE CETTE MIGRATION N'EST PAS :
--   1. Une autorisation nouvelle : la fonction ne rend un booléen que sur une ligne que la RLS a DÉJÀ consentie à
--      l'appelant ; `app.can_write_channel` est déjà exécutable par `anon` et `authenticated`.
--   2. La vérité de tous les gestes : certains en exigent davantage (une ligne de coût exige un budget lisible et
--      ouvert, `0050`). La colonne est une condition SUFFISANTE de refus, jamais nécessaire : l'écran éteint sur elle
--      et continue de traduire les refus partout ailleurs.
--   3. Une RPC : PostgREST expose comme colonne calculée une fonction dont l'unique argument est le type de la table ;
--      elle se demande dans le même `select`, sans aller-retour de plus (`CLAUDE.md` §21).
--   4. Une modification de schéma : aucune table, politique, trigger ni index n'est touché.
--
-- `SECURITY INVOKER` (le défaut) EST CRITIQUE : en `DEFINER`, la fonction répondrait pour `postgres`, qui traverse la
-- RLS, et rendrait `true` à la lectrice. Aucun `set search_path` : même raison qu'aux migrations 52 et 71 — la
-- fonction n'accorde rien à l'appelant, et son corps ne cite qu'un nom pleinement qualifié.
--
-- Ordinaire, idempotente : `create or replace`, puis `revoke` et `grant` nominatifs.

-- =============================================================================================
-- 1. `public.ecriture_permise(channels)`
-- =============================================================================================

create or replace function public.ecriture_permise(ch public.channels)
returns boolean
language sql
stable
as $$
	select app.can_write_channel(ch.id);
$$;

comment on function public.ecriture_permise(public.channels) is
	'CRM-093 — docs/SPEC-droits-interface.md §2.1, docs/SCHEMA.md §9 bis.8 ter. Colonne CALCULÉE : l''appelant '
	'peut-il écrire sur ce channel — rôle et droits fins, « le plus spécifique gagne » (app.can_write_channel). '
	'Condition SUFFISANTE de refus, jamais nécessaire. SECURITY INVOKER obligatoire.';

-- =============================================================================================
-- 2. `public.ecriture_permise(cards)` — une affaire hérite de son channel
-- =============================================================================================

create or replace function public.ecriture_permise(c public.cards)
returns boolean
language sql
stable
as $$
	select app.can_write_channel(c.channel_id);
$$;

comment on function public.ecriture_permise(public.cards) is
	'CRM-093 — docs/SPEC-droits-interface.md §2.1, docs/SCHEMA.md §9 bis.8 ter. Colonne CALCULÉE : l''appelant '
	'peut-il écrire sur cette affaire — celle de son channel, comme app.can_write_card, sans relire la table. '
	'Condition SUFFISANTE de refus, jamais nécessaire. SECURITY INVOKER obligatoire.';

-- `anon` reçoit `execute` pour la raison de la migration 71 : sans lui, un appelant anonyme qui demanderait la colonne
-- recevrait une ERREUR DE PRIVILÈGE là où `docs/SPEC-permissions-rls.md` §7 exige zéro ligne. Le droit n'ouvre rien :
-- la RLS ne lui rend aucune ligne, et `auth.uid()` nul rend faux.
revoke all on function public.ecriture_permise(public.channels) from public;
grant execute on function public.ecriture_permise(public.channels) to anon, authenticated, service_role;
revoke all on function public.ecriture_permise(public.cards) from public;
grant execute on function public.ecriture_permise(public.cards) to anon, authenticated, service_role;

-- Une colonne calculée neuve reste invisible au cache de schéma de PostgREST jusqu'à son rechargement.
notify pgrst, 'reload schema';

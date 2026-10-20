-- @spec CRM-093 (docs/BACKLOG.md) — tranche T1 : les capacités d'administration et d'édition de l'espace, lisibles par
--       l'interface
-- @spec docs/SPEC-droits-interface.md §2 (les trois faits, tous rendus par la base), §2.2 (les deux colonnes de
--       l'espace) ; docs/DESIGN_SYSTEM.md §5.29 ter (la frontière : lire un rôle pour éteindre est interdit, une capacité
--       rendue par la base sur la ligne s'éteint légitimement)
-- @spec docs/SCHEMA.md §9 bis.8 ter ; docs/JOURNAL.md décision 628 et sa précision ; docs/PROD_MIGRATIONS.md §3
--       (migration 92)
--
-- DEUX FONCTIONS, AU PATRON EXACT DES MIGRATIONS 71 ET 91 : des colonnes CALCULÉES de `workspaces`, que PostgREST rend
-- dans le même `select` que la ligne de l'espace.
--
-- `administration_permise` dit ce que disent les politiques d'écriture de la structure (tracks, channels, workflows,
-- champs, catalogue, budgets, coût du personnel, droits fins, appartenances, attentes, assistant IA) :
-- `app.is_workspace_admin`, administrateur du domaine LeLabs compris (migration 79). `edition_permise` dit ce que disent
-- celles des contacts, organisations, tableaux d'objectifs, modèles et séquences : `app.workspace_role` dans
-- (`admin`, `business_developer`). Le prédicat est RECOPIÉ À L'IDENTIQUE de ces politiques, pour que la colonne et la
-- règle ne puissent pas diverger ; la suite pgTAP `0086` le prouve sur les trois profils du seed.
--
-- CE QUE CETTE MIGRATION N'EST PAS : une autorisation nouvelle (la ligne n'est rendue que si la RLS l'a consentie, et les
-- deux fonctions d'appui sont déjà exécutables par `anon` et `authenticated`) ; une modification de schéma (aucune
-- table, politique, déclencheur ni index). `SECURITY INVOKER` est critique, aucun `set search_path` : mêmes motifs
-- qu'aux migrations 71 et 91. Ordinaire, idempotente.

create or replace function public.administration_permise(w public.workspaces)
returns boolean
language sql
stable
as $$
	select app.is_workspace_admin(w.id);
$$;

comment on function public.administration_permise(public.workspaces) is
	'CRM-093 — docs/SPEC-droits-interface.md §2.2. Colonne CALCULÉE : l''appelant administre-t-il cet espace — la règle '
	'des politiques d''écriture de la structure (app.is_workspace_admin). Condition SUFFISANTE de refus, jamais '
	'nécessaire. SECURITY INVOKER obligatoire.';

create or replace function public.edition_permise(w public.workspaces)
returns boolean
language sql
stable
as $$
	select coalesce(app.workspace_role(w.id) in ('admin', 'business_developer'), false);
$$;

comment on function public.edition_permise(public.workspaces) is
	'CRM-093 — docs/SPEC-droits-interface.md §2.2. Colonne CALCULÉE : l''appelant édite-t-il les contacts, organisations, '
	'objectifs, modèles et séquences de cet espace — le prédicat de leurs politiques, recopié à l''identique. Condition '
	'SUFFISANTE de refus, jamais nécessaire. SECURITY INVOKER obligatoire.';

-- `anon` reçoit `execute` pour la raison de la migration 71 : zéro ligne plutôt qu'une erreur de privilège.
revoke all on function public.administration_permise(public.workspaces) from public;
grant execute on function public.administration_permise(public.workspaces) to anon, authenticated, service_role;
revoke all on function public.edition_permise(public.workspaces) from public;
grant execute on function public.edition_permise(public.workspaces) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

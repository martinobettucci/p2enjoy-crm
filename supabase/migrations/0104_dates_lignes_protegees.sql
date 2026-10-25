-- @spec CRM-013 (docs/BACKLOG.md) — colonnes protégées, tranche INC-238 : la date de naissance d'une ligne de coût et
--       d'une ligne de recette se ferme à l'appelant ordinaire
-- @spec docs/SPEC-permissions-rls.md §4.3 (le mécanisme : privilège de table retiré, colonnes ouvertes énumérées),
--       §4.4.7 (la portée, la forme, le contrat) ; docs/SCHEMA.md « Migration `0104` » ; docs/PROD_MIGRATIONS.md §3 ;
--       docs/JOURNAL.md décision 687 ; docs/INCONSISTENCY_REPORT.md INC-238 ; docs/SPEC-costs.md §2.1 bis (l'ancienneté
--       et son seuil lisent `created_at`) ; docs/SPEC-recettes.md §6.4
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION CHANGE, ET RIEN D'AUTRE.
-- ---------------------------------------------------------------------------------------------
--
-- `authenticated` perd `INSERT` et `UPDATE` sur `created_at` et `updated_at` de `card_costs` et de `card_revenues`.
-- Toutes les autres colonnes gardent exactement leurs privilèges, `id` compris : l'upsert du seed des recettes le
-- réécrit dans son `ON CONFLICT DO UPDATE`. `SELECT` et `DELETE` restent de table. `service_role` conserve
-- `all privileges` : le seed antidate « Prospection terrain » par ce chemin (§4.4.7).
--
-- PostgreSQL n'offre pas de `REVOKE INSERT (colonne)` qui laisserait intact un privilège de table : la forme est le
-- retrait du privilège de table, puis l'énumération des colonnes ouvertes (§4.3). Une colonne ajoutée plus tard à
-- l'une de ces tables naît donc FERMÉE à l'écriture, et la migration qui l'ajoute doit l'ouvrir ici, nommément.
--
-- Rejouable : `revoke` et `grant` sont idempotents.

-- =============================================================================================
-- 1. `public.card_costs`
-- =============================================================================================

revoke insert, update on public.card_costs from authenticated;

grant insert (id, card_id, budget_id, occurrence_id, label, estimated_cost, actual_cost, created_by,
              settled_at, settled_by)
	on public.card_costs to authenticated;
grant update (id, card_id, budget_id, occurrence_id, label, estimated_cost, actual_cost, created_by,
              settled_at, settled_by)
	on public.card_costs to authenticated;

-- =============================================================================================
-- 2. `public.card_revenues`
-- =============================================================================================

revoke insert, update on public.card_revenues from authenticated;

grant insert (id, card_id, label, estimated_amount, actual_amount, settled_at, settled_by, position, created_by)
	on public.card_revenues to authenticated;
grant update (id, card_id, label, estimated_amount, actual_amount, settled_at, settled_by, position, created_by)
	on public.card_revenues to authenticated;

comment on column public.card_costs.created_at is
	'CRM-013, INC-238 (docs/SPEC-permissions-rls.md §4.4.7) : posée par la base, jamais écrite par authenticated — '
	'l''ancienneté de l''onglet « À saisir » et son seuil la lisent. service_role seul la choisit (seed).';
comment on column public.card_revenues.created_at is
	'CRM-013, INC-238 (docs/SPEC-permissions-rls.md §4.4.7) : posée par la base, jamais écrite par authenticated — '
	'l''ancienneté de l''onglet « À saisir » des recettes la lit. service_role seul la choisit.';

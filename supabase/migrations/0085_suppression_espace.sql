-- @spec INC-268 (docs/INCONSISTENCY_REPORT.md, docs/BACKLOG.md « Arbitrage du 2026-10-03 ») — un espace de travail
--       qui porte un workflow se supprime ; décision 619
-- @spec docs/SCHEMA.md §1 (cloisonnement par espace : tout cascade depuis `workspaces`), §3 (workflows),
--       §9 bis (coûts) ; docs/SPEC-costs.md §3.2 ; docs/SPEC-modeles-emails.md §11 ; docs/PROD_MIGRATIONS.md §3
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION CHANGE, ET CE QU'ELLE NE CHANGE PAS.
-- ---------------------------------------------------------------------------------------------
-- Huit clés étrangères passent de `ON DELETE RESTRICT` à `ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE`, et
-- la suppression d'un espace ajourne leur contrôle à la validation ; rien d'autre — mêmes noms, mêmes colonnes, mêmes
-- tables visées. MESURÉ le 2026-10-02 : supprimer un espace qui porte un workflow échouait en 23503, la cascade
-- atteignant le catalogue de nœuds avant les étapes qui le visent.
--
-- POURQUOI `NO ACTION` NE SUFFIT PAS SEUL — MESURÉ le 2026-10-03, première rédaction de cette migration. Chaque
-- branche d'une cascade s'exécute comme son propre ordre interne : le contrôle d'un `NO ACTION` tombe à la fin de la
-- branche « catalogue », avant que la branche « workflows » n'ait retiré les étapes. Il faut donc que le contrôle
-- attende la VALIDATION, et seulement quand c'est un espace qu'on supprime : les clés deviennent ajournables
-- (`DEFERRABLE`), restent contrôlées immédiatement par défaut (`INITIALLY IMMEDIATE`), et un déclencheur
-- `BEFORE DELETE` sur `workspaces` les ajourne pour la transaction (`SET CONSTRAINTS … DEFERRED`). `RESTRICT` ne
-- s'ajourne pas : d'où `NO ACTION`.
--
-- LA PROTECTION D'UNE SUPPRESSION DIRECTE EST INCHANGÉE : supprimer un nœud qu'une étape vise, un workflow que suit
-- un channel, un budget ou une occurrence qui portent des dépenses, un modèle qu'emploie un palier, une séquence ou
-- une identité qui portent une inscription reste refusé à la fin de l'ordre, avec le même code 23503 — PostgREST
-- rend toujours 409. Après une suppression d'espace, le contrôle a lieu à la validation : il refuse encore tout
-- objet resté orphelin. Prouvé par `supabase/tests/0079_suppression_espace.test.sql`.
--
-- IDEMPOTENTE : chaque clé est retirée puis reposée. Le runner applique le fichier dans sa transaction.

alter table public.workflow_steps
	drop constraint if exists workflow_steps_node_id_workspace_id_fkey,
	add constraint workflow_steps_node_id_workspace_id_fkey
		foreign key (node_id, workspace_id) references public.workflow_nodes_catalog (id, workspace_id) on delete no action deferrable initially immediate;

alter table public.channels
	drop constraint if exists channels_workflow_id_workspace_id_fkey,
	add constraint channels_workflow_id_workspace_id_fkey
		foreign key (workflow_id, workspace_id) references public.workflows (id, workspace_id) on delete no action deferrable initially immediate;

alter table public.card_costs
	drop constraint if exists card_costs_budget_id_fkey,
	add constraint card_costs_budget_id_fkey
		foreign key (budget_id) references public.budgets (id) on delete no action deferrable initially immediate,
	drop constraint if exists card_costs_occurrence_id_fkey,
	add constraint card_costs_occurrence_id_fkey
		foreign key (occurrence_id) references public.budget_occurrences (id) on delete no action deferrable initially immediate;

alter table public.mail_sequence_steps
	drop constraint if exists mail_sequence_steps_template_id_fkey,
	add constraint mail_sequence_steps_template_id_fkey
		foreign key (template_id) references public.mail_templates (id) on delete no action deferrable initially immediate,
	drop constraint if exists mail_sequence_steps_template_workspace_fkey,
	add constraint mail_sequence_steps_template_workspace_fkey
		foreign key (template_id, workspace_id) references public.mail_templates (id, workspace_id) on delete no action deferrable initially immediate;

alter table public.card_sequence_enrollments
	drop constraint if exists card_sequence_enrollments_identity_fk,
	add constraint card_sequence_enrollments_identity_fk
		foreign key (identity_id) references public.mail_outbound_identities (id) on delete no action deferrable initially immediate,
	drop constraint if exists card_sequence_enrollments_sequence_fk,
	add constraint card_sequence_enrollments_sequence_fk
		foreign key (sequence_id, workspace_id) references public.mail_sequences (id, workspace_id) on delete no action deferrable initially immediate;

-- Le contrôle ajourné pour la seule transaction qui supprime un espace : à la validation, la cascade a tout emporté.
create or replace function app.workspaces_avant_suppression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	set constraints
		public.workflow_steps_node_id_workspace_id_fkey,
		public.channels_workflow_id_workspace_id_fkey,
		public.card_costs_budget_id_fkey,
		public.card_costs_occurrence_id_fkey,
		public.mail_sequence_steps_template_id_fkey,
		public.mail_sequence_steps_template_workspace_fkey,
		public.card_sequence_enrollments_identity_fk,
		public.card_sequence_enrollments_sequence_fk
	deferred;
	return old;
end;
$$;

revoke all on function app.workspaces_avant_suppression() from public;

drop trigger if exists workspaces_avant_suppression on public.workspaces;
create trigger workspaces_avant_suppression
	before delete on public.workspaces
	for each row execute function app.workspaces_avant_suppression();

notify pgrst, 'reload schema';

-- @spec CRM-118 (docs/BACKLOG.md) — tranche T1.b : désigner le workflow par défaut en une transaction, et garder
--       l'archivage d'un workflow (docs/SPEC-workflow-engine.md §7 quinquies.1 ; docs/SCHEMA.md ; docs/JOURNAL.md
--       décisions 758 et 760)
--
-- 1. `public.set_default_workflow(p_workflow)` : éteint l'ancien défaut puis allume le nouveau, dans la même transaction —
--    l'ordre qui ne heurte jamais l'index unique partiel `workflows_workspace_default_uk`. `SECURITY INVOKER` : elle
--    n'ouvre aucun droit, la RLS de `workflows` (écriture par l'administrateur) s'applique à ses deux écritures ; les
--    contrôles explicites ne servent qu'à rendre un refus nommé, dans l'ordre du §7 quinquies.1.
-- 2. La garde d'archivage, `workflows_garder_archivage` : au seul passage d'`archived_at` de `NULL` à une date, refuse un
--    workflow qu'emploie un channel hors corbeille (archivé compris) — `workflow_in_use` — ou le workflow par défaut —
--    `workflow_is_default`. Rétablir n'est jamais refusé.
--
-- Retour arrière : `drop trigger workflows_garder_archivage on public.workflows; drop function
-- app.workflows_garder_archivage(); drop function public.set_default_workflow(uuid);` — aucune donnée à reprendre.

create or replace function public.set_default_workflow(p_workflow uuid)
returns public.workflows
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	le_workflow public.workflows%rowtype;
begin
	if (select auth.uid()) is null then
		raise exception 'authentification requise' using errcode = '42501';
	end if;
	select * into le_workflow from public.workflows w where w.id = p_workflow;
	if le_workflow.id is null then
		raise exception 'workflow introuvable' using errcode = 'P0002';
	end if;
	if not app.is_workspace_admin(le_workflow.workspace_id) then
		raise exception 'reserve aux administrateurs' using errcode = '42501';
	end if;
	if le_workflow.archived_at is not null then
		raise exception 'workflow archive' using errcode = 'P0001';
	end if;
	if le_workflow.scope <> 'global' then
		raise exception 'workflow non global' using errcode = 'P0001';
	end if;
	if le_workflow.is_default then
		return le_workflow;
	end if;

	update public.workflows w set is_default = false
	 where w.workspace_id = le_workflow.workspace_id and w.is_default and w.id <> p_workflow;
	update public.workflows w set is_default = true where w.id = p_workflow
	returning * into le_workflow;
	return le_workflow;
end;
$$;

comment on function public.set_default_workflow(uuid) is
	'CRM-118 T1.b : désigne le workflow par défaut de son espace, en une transaction (docs/SPEC-workflow-engine.md §7 quinquies.1).';

revoke all on function public.set_default_workflow(uuid) from public;
revoke all on function public.set_default_workflow(uuid) from anon;
grant execute on function public.set_default_workflow(uuid) to authenticated;

create or replace function app.workflows_garder_archivage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	employes bigint;
begin
	if old.archived_at is null and new.archived_at is not null then
		-- `SECURITY DEFINER` : le compte porte sur TOUS les channels de l'espace, y compris ceux que les droits fins de
		-- l'appelant lui cachent — un channel caché qui emploie le workflow le garde tout autant.
		select count(*) into employes from public.channels c
		 where c.workflow_id = new.id and c.deleted_at is null;
		if employes > 0 then
			raise exception 'workflow_in_use : % channel(s)', employes using errcode = 'P0001';
		end if;
		if new.is_default then
			raise exception 'workflow_is_default' using errcode = 'P0001';
		end if;
	end if;
	return new;
end;
$$;

comment on function app.workflows_garder_archivage() is
	'CRM-118 T1.b : refuse d''archiver un workflow employé par un channel hors corbeille, ou le workflow par défaut (docs/SPEC-workflow-engine.md §7 quinquies.1).';

revoke all on function app.workflows_garder_archivage() from public;

drop trigger if exists workflows_garder_archivage on public.workflows;
create trigger workflows_garder_archivage
	before update of archived_at on public.workflows
	for each row execute function app.workflows_garder_archivage();

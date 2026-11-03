-- @spec CRM-112 (docs/BACKLOG.md) — tranche T2.a : une transition exige un champ commun — la table distincte, son espace
--       posé depuis la transition, ses politiques ; l'archivage d'un champ commun exigé refusé et nommé
-- @spec docs/SPEC-champs-communs.md §5 (révisé par la décision 819), §6 ; docs/SCHEMA.md « Migration `0155` » ;
--       docs/JOURNAL.md décisions 664 et 819
--
-- UNE TABLE DISTINCTE, ET NON UNE COLONNE (décision 819) : `workflow_transition_required_fields` garde sa clé primaire
-- `(transition_id, field_id)`, que le connecteur MCP et les fonctions de versions lisent. La sixième vérification de
-- `move_card` lira les deux tables (T2.b) ; les versions et les copies, en T2.c.
--
-- IDEMPOTENCE : `create table if not exists`, contraintes retirées puis reposées, `create or replace`, déclencheurs et
-- politiques retirés puis recréés.

-- =============================================================================================
-- 1. La clé composite d'une transition par son espace
-- =============================================================================================

-- `workflow_transitions` n'avait pas d'unicité `(id, workspace_id)` : elle est déjà vraie (`id` est la clé primaire), et
-- elle est la cible de la clé composite ci-dessous.
-- Posée seulement si elle manque : la retirer pour la reposer échouerait au rejeu, la clé composite en dépendant.
do $$
begin
	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.workflow_transitions'::regclass
	                  and conname = 'workflow_transitions_id_workspace_key') then
		alter table public.workflow_transitions
			add constraint workflow_transitions_id_workspace_key unique (id, workspace_id);
	end if;
end;
$$;

-- =============================================================================================
-- 2. La table — §5
-- =============================================================================================

create table if not exists public.workflow_transition_required_common_fields (
	transition_id   uuid not null,
	common_field_id uuid not null,
	workspace_id    uuid not null,
	created_at      timestamptz not null default now(),
	primary key (transition_id, common_field_id)
);

alter table public.workflow_transition_required_common_fields
	drop constraint if exists workflow_transition_required_common_fields_transition_fkey,
	drop constraint if exists workflow_transition_required_common_fields_field_fkey;
-- UNE EXIGENCE NE RELIE QUE DEUX OBJETS DU MÊME ESPACE : la transition et le champ commun, chacun par sa clé composite.
alter table public.workflow_transition_required_common_fields
	add constraint workflow_transition_required_common_fields_transition_fkey
		foreign key (transition_id, workspace_id) references public.workflow_transitions (id, workspace_id) on delete cascade,
	add constraint workflow_transition_required_common_fields_field_fkey
		foreign key (common_field_id, workspace_id) references public.card_common_fields (id, workspace_id) on delete cascade;

create index if not exists workflow_transition_required_common_fields_field_idx
	on public.workflow_transition_required_common_fields (common_field_id);

comment on table public.workflow_transition_required_common_fields is
	'CRM-112 T2.a (0155) : une transition exige qu''un champ commun de l''affaire soit renseigné (docs/SPEC-champs-communs.md '
	'§5, décision 819). Lue par move_card avec workflow_transition_required_fields (T2.b).';

-- L'ESPACE EST POSÉ DEPUIS LA TRANSITION, jamais choisi par le client : il n'entre pas dans le privilège d'insertion.
create or replace function app.workflow_transition_required_common_fields_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_archive timestamptz;
begin
	select t.workspace_id into new.workspace_id from public.workflow_transitions t where t.id = new.transition_id;
	if new.workspace_id is null then
		-- « Introuvable » rend HTTP 404 par la forme commune (CRM-120, docs/SPEC-refus-404.md), jamais par `errcode`.
		perform app.raise_http_error(404, 'transition_not_found');
	end if;
	select f.archived_at into v_archive
	  from public.card_common_fields f
	 where f.id = new.common_field_id and f.workspace_id = new.workspace_id;
	-- Exiger un champ archivé fermerait la transition à toute affaire : refusé, comme sa restauration en T2.c.
	if v_archive is not null then
		raise exception 'common_field_archived' using errcode = 'P0001';
	end if;
	return new;
end;
$$;
alter function app.workflow_transition_required_common_fields_avant() owner to postgres;
revoke all on function app.workflow_transition_required_common_fields_avant() from public;

drop trigger if exists workflow_transition_required_common_fields_avant on public.workflow_transition_required_common_fields;
create trigger workflow_transition_required_common_fields_avant
	before insert on public.workflow_transition_required_common_fields
	for each row execute function app.workflow_transition_required_common_fields_avant();

-- =============================================================================================
-- 3. Politiques et privilèges — les mêmes que pour les champs de workflow exigés
-- =============================================================================================

alter table public.workflow_transition_required_common_fields enable row level security;

drop policy if exists workflow_transition_required_common_fields_lecture_membre on public.workflow_transition_required_common_fields;
create policy workflow_transition_required_common_fields_lecture_membre
	on public.workflow_transition_required_common_fields for select to authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists workflow_transition_required_common_fields_insertion_admin on public.workflow_transition_required_common_fields;
create policy workflow_transition_required_common_fields_insertion_admin
	on public.workflow_transition_required_common_fields for insert to authenticated
	with check (exists (
		select 1 from public.workflow_transitions t
		 where t.id = transition_id and app.is_workspace_admin(t.workspace_id)));

drop policy if exists workflow_transition_required_common_fields_suppression_admin on public.workflow_transition_required_common_fields;
create policy workflow_transition_required_common_fields_suppression_admin
	on public.workflow_transition_required_common_fields for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

revoke all on public.workflow_transition_required_common_fields from anon, authenticated;
grant select on public.workflow_transition_required_common_fields to authenticated;
grant insert (transition_id, common_field_id) on public.workflow_transition_required_common_fields to authenticated;
grant delete on public.workflow_transition_required_common_fields to authenticated;
grant all privileges on public.workflow_transition_required_common_fields to service_role;

-- =============================================================================================
-- 4. L'archivage d'un champ commun exigé est refusé, et nomme les transitions — §6
-- =============================================================================================

-- Les modèles d'email qui emploient le champ s'y ajouteront en T5, avec leurs variables.
create or replace function app.card_common_fields_refuser_archivage_employe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_transitions text;
begin
	if old.archived_at is null and new.archived_at is not null then
		-- Le libellé d'une étape est sa surcharge, sinon celui de son nœud du catalogue.
		select string_agg(format('%s : %s → %s', w.name, coalesce(sf.label_override, nf.label), coalesce(st.label_override, nt.label)),
		                  ' ; ' order by w.name, sf.position, st.position)
		  into v_transitions
		  from public.workflow_transition_required_common_fields r
		  join public.workflow_transitions t on t.id = r.transition_id
		  join public.workflows w on w.id = t.workflow_id
		  join public.workflow_steps sf on sf.id = t.from_step_id
		  join public.workflow_nodes_catalog nf on nf.id = sf.node_id
		  join public.workflow_steps st on st.id = t.to_step_id
		  join public.workflow_nodes_catalog nt on nt.id = st.node_id
		 where r.common_field_id = new.id;
		if v_transitions is not null then
			raise exception 'common_field_in_use' using errcode = 'P0001', detail = v_transitions;
		end if;
	end if;
	return new;
end;
$$;
alter function app.card_common_fields_refuser_archivage_employe() owner to postgres;
revoke all on function app.card_common_fields_refuser_archivage_employe() from public;

drop trigger if exists card_common_fields_refuser_archivage_employe on public.card_common_fields;
create trigger card_common_fields_refuser_archivage_employe
	before update of archived_at on public.card_common_fields
	for each row execute function app.card_common_fields_refuser_archivage_employe();

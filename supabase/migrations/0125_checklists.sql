-- @spec CRM-068 (docs/BACKLOG.md) — tranche T1 : le modèle des checklists
-- @spec docs/SPEC-checklists.md §2 (un point d'étape appartient au rattachement, un point libre à l'affaire), §3.1 (les
--       points d'une étape), §3.2 (les points d'une affaire), §3.3 (l'ajout à l'entrée dans l'étape, par la base), §3.4
--       (les points exigés par une transition, de son étape de départ — Q3), §3.6 (le cochage posé par la base, tracé dans
--       le fil — Q2) ; docs/SCHEMA.md « Migration `0125` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 747 à 749
--
-- TROIS TABLES, ET TOUTES LES RÈGLES EN BASE (`CLAUDE.md` §10). L'écran n'aura rien à garder : la forme d'un point d'étape,
-- l'auteur et l'heure d'un cochage, l'origine d'une exigence sont tenus ici.

-- =============================================================================================
-- 1. Les points d'une étape — §3.1
-- =============================================================================================

create table if not exists public.workflow_step_checklist_items (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	workflow_id  uuid        not null,
	step_id      uuid        not null,
	label        text        not null,
	position     numeric     not null default 0,
	archived_at  timestamptz,
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint workflow_step_checklist_items_step_fkey
		foreign key (step_id, workflow_id) references public.workflow_steps (id, workflow_id) on delete cascade,
	constraint workflow_step_checklist_items_label_check
		check (app.btrim_blancs(label) <> '' and char_length(label) <= 200),
	constraint workflow_step_checklist_items_id_step_key unique (id, step_id)
);

create index if not exists workflow_step_checklist_items_step_idx
	on public.workflow_step_checklist_items (step_id, position);

comment on table public.workflow_step_checklist_items is
	'CRM-068 — docs/SPEC-checklists.md §3.1. Les points qu''une étape ajoute aux affaires qui y entrent.';

-- =============================================================================================
-- 2. Les points d'une affaire — §3.2
-- =============================================================================================

create table if not exists public.card_checklist_items (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null,
	card_id      uuid        not null,
	placement_id uuid        references public.card_placements (id) on delete cascade,
	step_item_id uuid        references public.workflow_step_checklist_items (id) on delete set null,
	label        text        not null,
	position     numeric     not null default 0,
	checked      boolean     not null default false,
	checked_at   timestamptz,
	checked_by   uuid        references public.profiles (id) on delete set null,
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint card_checklist_items_card_fkey
		foreign key (card_id, workspace_id) references public.cards (id, workspace_id) on delete cascade,
	constraint card_checklist_items_label_check
		check (app.btrim_blancs(label) <> '' and char_length(label) <= 200),
	-- Un point libre n'a ni rattachement ni origine ; un point d'étape a un rattachement. Son origine peut tomber à nul
	-- si l'administrateur supprime l'étape : le point reste, sous son libellé copié.
	constraint card_checklist_items_kind_check
		check (placement_id is not null or step_item_id is null),
	constraint card_checklist_items_placement_step_key unique (placement_id, step_item_id)
);

create index if not exists card_checklist_items_card_idx on public.card_checklist_items (card_id, position);
create index if not exists card_checklist_items_placement_idx on public.card_checklist_items (placement_id);

comment on table public.card_checklist_items is
	'CRM-068 — docs/SPEC-checklists.md §3.2. Les points d''une affaire : libres (placement_id nul) ou ajoutés par l''étape '
	'd''un rattachement.';

-- =============================================================================================
-- 3. Les points exigés par une transition — §3.4
-- =============================================================================================

create table if not exists public.workflow_transition_required_checklist_items (
	transition_id uuid not null references public.workflow_transitions (id) on delete cascade,
	step_item_id  uuid not null references public.workflow_step_checklist_items (id) on delete cascade,
	created_at    timestamptz not null default now(),
	primary key (transition_id, step_item_id)
);

comment on table public.workflow_transition_required_checklist_items is
	'CRM-068 — docs/SPEC-checklists.md §3.4. Les points de l''étape de départ qu''une transition exige cochés.';

-- Une transition n'exige que des points de son étape de départ (Q3, décision 748).
create or replace function app.checklist_requirement_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not exists (
		select 1
		  from public.workflow_transitions t
		  join public.workflow_step_checklist_items i on i.step_id = t.from_step_id
		 where t.id = new.transition_id and i.id = new.step_item_id
	) then
		raise exception 'checklist_item_not_from_source_step' using errcode = '22023';
	end if;
	return new;
end;
$$;

drop trigger if exists workflow_transition_required_checklist_items_guard
	on public.workflow_transition_required_checklist_items;
create trigger workflow_transition_required_checklist_items_guard
	before insert or update on public.workflow_transition_required_checklist_items
	for each row execute function app.checklist_requirement_guard();

-- =============================================================================================
-- 4. Les déclencheurs des points d'une affaire
-- =============================================================================================

-- Avant l'écriture : l'auteur et l'heure d'un cochage sont ceux de la base ; un point d'étape garde sa forme.
create or replace function app.card_checklist_items_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		new.created_by := coalesce((select auth.uid()), new.created_by);
		if new.checked then
			new.checked_at := pg_catalog.now();
			new.checked_by := (select auth.uid());
		else
			new.checked_at := null;
			new.checked_by := null;
		end if;
		return new;
	end if;
	-- La forme d'un point d'étape appartient à l'étape : son libellé ne se modifie pas sur l'affaire.
	if old.step_item_id is not null and new.label is distinct from old.label then
		raise exception 'step_item_locked' using errcode = 'P0001';
	end if;
	if (new.card_id, new.placement_id, new.step_item_id, new.workspace_id, new.created_by, new.created_at)
	   is distinct from
	   (old.card_id, old.placement_id, old.step_item_id, old.workspace_id, old.created_by, old.created_at)
	   and pg_catalog.pg_trigger_depth() <= 1 then
		raise exception 'checklist_item_immutable' using errcode = 'P0001';
	end if;
	if new.checked is distinct from old.checked then
		if new.checked then
			new.checked_at := pg_catalog.now();
			new.checked_by := (select auth.uid());
		else
			new.checked_at := null;
			new.checked_by := null;
		end if;
	else
		new.checked_at := old.checked_at;
		new.checked_by := old.checked_by;
	end if;
	new.updated_at := pg_catalog.now();
	return new;
end;
$$;

drop trigger if exists card_checklist_items_before on public.card_checklist_items;
create trigger card_checklist_items_before
	before insert or update on public.card_checklist_items
	for each row execute function app.card_checklist_items_before();

-- Un point d'étape ne se retire pas de l'affaire : seule la disparition de son rattachement l'emporte.
create or replace function app.card_checklist_items_refuse_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.step_item_id is not null and pg_catalog.pg_trigger_depth() <= 1 then
		raise exception 'step_item_locked' using errcode = 'P0001';
	end if;
	return old;
end;
$$;

drop trigger if exists card_checklist_items_refuse_delete on public.card_checklist_items;
create trigger card_checklist_items_refuse_delete
	before delete on public.card_checklist_items
	for each row execute function app.card_checklist_items_refuse_delete();

-- Après le cochage : le fil de l'affaire en garde la trace (Q2, décision 748). L'événement est celui de l'affaire
-- (`placement_id` nul, contrainte `card_events_placement_by_type`) ; le rattachement et le point sont dans sa charge.
create or replace function app.card_checklist_items_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	values (new.card_id, new.workspace_id,
	        case when new.checked then 'checklist_checked' else 'checklist_unchecked' end,
	        (select auth.uid()),
	        pg_catalog.jsonb_build_object('item_id', new.id, 'label', new.label, 'placement_id', new.placement_id,
	                                      'step_item_id', new.step_item_id));
	return null;
end;
$$;

drop trigger if exists card_checklist_items_event on public.card_checklist_items;
create trigger card_checklist_items_event
	after update of checked on public.card_checklist_items
	for each row when (old.checked is distinct from new.checked)
	execute function app.card_checklist_items_event();

-- L'entrée dans une étape ajoute ses points non archivés au rattachement (§3.3). Revenir dans une étape ne duplique rien,
-- et ce qui était coché le reste.
create or replace function app.card_placements_add_step_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.card_checklist_items (workspace_id, card_id, placement_id, step_item_id, label, position)
	select new.workspace_id, new.card_id, new.id, i.id, i.label, i.position
	  from public.workflow_step_checklist_items i
	 where i.step_id = new.current_step_id and i.archived_at is null
	on conflict (placement_id, step_item_id) do nothing;
	return null;
end;
$$;

drop trigger if exists card_placements_add_step_items on public.card_placements;
create trigger card_placements_add_step_items
	after insert or update of current_step_id on public.card_placements
	for each row execute function app.card_placements_add_step_items();

do $$
declare
	f text;
begin
	foreach f in array array['app.checklist_requirement_guard()', 'app.card_checklist_items_before()',
		'app.card_checklist_items_refuse_delete()', 'app.card_checklist_items_event()',
		'app.card_placements_add_step_items()'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f);
	end loop;
end;
$$;

-- =============================================================================================
-- 5. Le fil : deux types de plus — §3.6, Q2
-- =============================================================================================

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check
	check (type in ('created', 'moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                'trashed', 'restored', 'field_changed', 'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed',
	                'woken', 'stalled', 'contact_linked', 'contact_unlinked', 'contact_role_changed',
	                'checklist_checked', 'checklist_unchecked'));

-- =============================================================================================
-- 6. Droits — RLS et privilèges (`CLAUDE.md` §10)
-- =============================================================================================

alter table public.workflow_step_checklist_items enable row level security;
alter table public.card_checklist_items enable row level security;
alter table public.workflow_transition_required_checklist_items enable row level security;

revoke all on public.workflow_step_checklist_items, public.card_checklist_items,
	public.workflow_transition_required_checklist_items from anon, authenticated;
grant select, insert, delete on public.workflow_step_checklist_items to authenticated;
grant update (label, position, archived_at) on public.workflow_step_checklist_items to authenticated;
grant select, insert, delete on public.workflow_transition_required_checklist_items to authenticated;
grant select, delete on public.card_checklist_items to authenticated;
grant insert (workspace_id, card_id, label, position, checked) on public.card_checklist_items to authenticated;
grant update (label, position, checked) on public.card_checklist_items to authenticated;
grant all on public.workflow_step_checklist_items, public.card_checklist_items,
	public.workflow_transition_required_checklist_items to service_role;

-- Les points d'une étape : lus par les membres, écrits par l'administrateur — les règles de `workflow_steps`.
drop policy if exists workflow_step_checklist_items_lecture on public.workflow_step_checklist_items;
create policy workflow_step_checklist_items_lecture on public.workflow_step_checklist_items
	for select to authenticated using (app.is_workspace_member(workspace_id));
drop policy if exists workflow_step_checklist_items_ecriture on public.workflow_step_checklist_items;
create policy workflow_step_checklist_items_ecriture on public.workflow_step_checklist_items
	for all to authenticated
	using (app.is_workspace_admin(workspace_id)) with check (app.is_workspace_admin(workspace_id));

-- Les exigences d'une transition : les règles de `workflow_transition_required_fields`.
drop policy if exists workflow_transition_required_checklist_items_lecture
	on public.workflow_transition_required_checklist_items;
create policy workflow_transition_required_checklist_items_lecture on public.workflow_transition_required_checklist_items
	for select to authenticated
	using (exists (select 1 from public.workflow_transitions t
	                where t.id = transition_id and app.is_workspace_member(t.workspace_id)));
drop policy if exists workflow_transition_required_checklist_items_ecriture
	on public.workflow_transition_required_checklist_items;
create policy workflow_transition_required_checklist_items_ecriture on public.workflow_transition_required_checklist_items
	for all to authenticated
	using (exists (select 1 from public.workflow_transitions t
	                where t.id = transition_id and app.is_workspace_admin(t.workspace_id)))
	with check (exists (select 1 from public.workflow_transitions t
	                     where t.id = transition_id and app.is_workspace_admin(t.workspace_id)));

-- Les points d'une affaire : un point d'étape suit son rattachement (comme une valeur de champ), un point libre suit
-- l'affaire. Le client n'insère et ne retire que des points libres.
drop policy if exists card_checklist_items_lecture on public.card_checklist_items;
create policy card_checklist_items_lecture on public.card_checklist_items
	for select to authenticated
	using (case when placement_id is null then app.can_read_card(card_id)
	            else placement_id in (select p.id from public.card_placements p
	                                   where p.channel_id in (select unnest(app.readable_channel_ids()))) end);
drop policy if exists card_checklist_items_insertion on public.card_checklist_items;
create policy card_checklist_items_insertion on public.card_checklist_items
	for insert to authenticated
	with check (placement_id is null and step_item_id is null and app.can_write_card(card_id));
drop policy if exists card_checklist_items_maj on public.card_checklist_items;
create policy card_checklist_items_maj on public.card_checklist_items
	for update to authenticated
	using (case when placement_id is null then app.can_write_card(card_id)
	            else app.can_write_channel((select p.channel_id from public.card_placements p where p.id = placement_id)) end)
	with check (case when placement_id is null then app.can_write_card(card_id)
	                 else app.can_write_channel((select p.channel_id from public.card_placements p
	                                              where p.id = placement_id)) end);
drop policy if exists card_checklist_items_suppression on public.card_checklist_items;
create policy card_checklist_items_suppression on public.card_checklist_items
	for delete to authenticated
	using (placement_id is null and app.can_write_card(card_id));

notify pgrst, 'reload schema';

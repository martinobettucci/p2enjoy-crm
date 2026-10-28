-- @spec CRM-069 (docs/BACKLOG.md) — tranche T1 : les étiquettes en base
-- @spec docs/SPEC-etiquettes-digest.md §2.1 (le catalogue d'un espace : écriture administrateur, lecture membre, palette
--       fermée, nom unique parmi les étiquettes non archivées), §2.2 (les étiquettes d'une affaire : posées par qui écrit
--       l'affaire, refus d'une étiquette archivée, le fil) ; docs/SCHEMA.md « Migration `0132` » ; docs/PROD_MIGRATIONS.md
--       §3 ; docs/JOURNAL.md décisions 769 et 771
--
-- DEUX TABLES, ET TOUTES LES RÈGLES EN BASE (`CLAUDE.md` §10) : l'espace d'une étiquette posée, son auteur, le refus d'une
-- étiquette archivée et la ligne du fil sont tenus ici ; l'écran et le connecteur n'ont rien à garder.

-- =============================================================================================
-- 1. Le catalogue d'un espace — §2.1
-- =============================================================================================

create table if not exists public.labels (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	color        text        not null default 'neutral',
	archived_at  timestamptz,
	created_by   uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint labels_name_check check (app.btrim_blancs(name) <> '' and char_length(name) <= 40),
	-- La palette fermée de `tracks.color` et `channels.color` (migration 0116).
	constraint labels_color_check check (color in ('brand', 'success', 'accent', 'danger', 'neutral')),
	constraint labels_id_workspace_key unique (id, workspace_id)
);

-- Un nom par espace parmi les étiquettes NON archivées, sans tenir compte de la casse : archiver libère le nom.
create unique index if not exists labels_workspace_name_key
	on public.labels (workspace_id, lower(app.btrim_blancs(name))) where archived_at is null;

comment on table public.labels is
	'CRM-069 — docs/SPEC-etiquettes-digest.md §2.1. Le catalogue des étiquettes d''un espace, tenu par ses administrateurs.';

create or replace function app.labels_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'UPDATE' then
		new.workspace_id := old.workspace_id;
		new.created_by := old.created_by;
		new.created_at := old.created_at;
		new.updated_at := now();
	end if;
	return new;
end;
$$;

drop trigger if exists labels_avant on public.labels;
create trigger labels_avant
	before insert or update on public.labels
	for each row execute function app.labels_avant();

-- =============================================================================================
-- 2. Les étiquettes d'une affaire — §2.2
-- =============================================================================================

create table if not exists public.card_labels (
	card_id      uuid        not null,
	label_id     uuid        not null,
	workspace_id uuid        not null,
	created_by   uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	constraint card_labels_pkey primary key (card_id, label_id),
	constraint card_labels_card_fkey
		foreign key (card_id, workspace_id) references public.cards (id, workspace_id) on delete cascade,
	-- Une étiquette d'un AUTRE espace est refusée par cette clé (`23503`) : l'espace est celui de l'affaire (§2.2).
	constraint card_labels_label_fkey
		foreign key (label_id, workspace_id) references public.labels (id, workspace_id) on delete cascade
);

create index if not exists card_labels_label_idx on public.card_labels (label_id);

comment on table public.card_labels is
	'CRM-069 — docs/SPEC-etiquettes-digest.md §2.2. Les étiquettes posées sur une affaire, et non sur un rattachement.';

-- Avant la pose : l'espace est celui de l'AFFAIRE (le client ne l'envoie pas), l'auteur est l'appelant, et une étiquette
-- archivée n'est plus posée.
create or replace function app.card_labels_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_archivee timestamptz;
begin
	new.workspace_id := (select c.workspace_id from public.cards c where c.id = new.card_id);
	new.created_by := (select auth.uid());
	new.created_at := now();
	select l.archived_at into v_archivee from public.labels l where l.id = new.label_id;
	if v_archivee is not null then
		raise exception 'label_archived' using errcode = '22023';
	end if;
	return new;
end;
$$;

drop trigger if exists card_labels_avant on public.card_labels;
create trigger card_labels_avant
	before insert on public.card_labels
	for each row execute function app.card_labels_avant();

-- Après la pose ou le retrait : le fil de l'affaire en garde la trace, avec le nom de l'étiquette (§2.2, décision 771).
-- Un retrait EN CASCADE — l'affaire ou l'étiquette effacée par la clé de service — n'écrit rien : l'affaire n'est plus là
-- pour porter l'événement, ou l'étiquette pour le nommer.
create or replace function app.card_labels_evenement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_ligne public.card_labels%rowtype;
	v_nom   text;
begin
	v_ligne := case when tg_op = 'DELETE' then old else new end;
	if not exists (select 1 from public.cards c where c.id = v_ligne.card_id) then
		return null;
	end if;
	select l.name into v_nom from public.labels l where l.id = v_ligne.label_id;
	if v_nom is null then
		return null;
	end if;
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	values (v_ligne.card_id, v_ligne.workspace_id,
	        case when tg_op = 'DELETE' then 'label_removed' else 'label_added' end,
	        (select auth.uid()),
	        pg_catalog.jsonb_build_object('label_id', v_ligne.label_id, 'name', v_nom));
	return null;
end;
$$;

drop trigger if exists card_labels_evenement on public.card_labels;
create trigger card_labels_evenement
	after insert or delete on public.card_labels
	for each row execute function app.card_labels_evenement();

do $$
declare
	f text;
begin
	foreach f in array array['app.labels_avant()', 'app.card_labels_avant()', 'app.card_labels_evenement()'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f);
	end loop;
end;
$$;

-- =============================================================================================
-- 3. Le fil : deux types de plus, événements de l'AFFAIRE — §2.2
-- =============================================================================================

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check
	check (type in ('created', 'moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                'trashed', 'restored', 'field_changed', 'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed',
	                'woken', 'stalled', 'contact_linked', 'contact_unlinked', 'contact_role_changed',
	                'checklist_checked', 'checklist_unchecked', 'label_added', 'label_removed'));

-- =============================================================================================
-- 4. Droits — RLS et privilèges (`CLAUDE.md` §10)
-- =============================================================================================

alter table public.labels enable row level security;
alter table public.card_labels enable row level security;

-- Le catalogue : lu par tout membre, écrit par l'administrateur. Aucune suppression : une étiquette s'archive.
drop policy if exists labels_lecture on public.labels;
create policy labels_lecture on public.labels
	for select to authenticated using (app.is_workspace_member(workspace_id));
drop policy if exists labels_ecriture on public.labels;
create policy labels_ecriture on public.labels
	for all to authenticated
	using (app.is_workspace_admin(workspace_id)) with check (app.is_workspace_admin(workspace_id));

-- Les étiquettes d'une affaire : lues par qui lit l'affaire, posées et retirées par qui l'écrit.
drop policy if exists card_labels_lecture on public.card_labels;
create policy card_labels_lecture on public.card_labels
	for select to authenticated using (app.can_read_card(card_id));
drop policy if exists card_labels_pose on public.card_labels;
create policy card_labels_pose on public.card_labels
	for insert to authenticated with check (app.can_write_card(card_id));
drop policy if exists card_labels_retrait on public.card_labels;
create policy card_labels_retrait on public.card_labels
	for delete to authenticated using (app.can_write_card(card_id));

-- Les privilèges par défaut de `public` sont d'abord retirés : sans cela, `authenticated` recevrait `DELETE` sur le
-- catalogue (le défaut mesuré par la pgTAP `0122` n° 2 de `CRM-068`).
revoke all on public.labels, public.card_labels from anon, authenticated;
grant select on public.labels to authenticated;
grant insert (workspace_id, name, color) on public.labels to authenticated;
grant update (name, color, archived_at) on public.labels to authenticated;
grant select, delete on public.card_labels to authenticated;
grant insert (card_id, label_id) on public.card_labels to authenticated;
grant all on public.labels, public.card_labels to service_role;

notify pgrst, 'reload schema';

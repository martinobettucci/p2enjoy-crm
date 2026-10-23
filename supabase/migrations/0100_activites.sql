-- @spec CRM-067 (docs/BACKLOG.md) — tranche T1 : les activités réalisées d'une affaire — appels, réunions, visios —
--       et leurs participants
-- @spec docs/SPEC-activites.md §2 (ce qui est consigné), §3 (deux tables, pierre tombale, participants, politiques d'un
--       commentaire) ; docs/SPEC-cards.md §13 (le patron des commentaires : triggers, modération bornée, INC-072,
--       décision 374) ; docs/SCHEMA.md §9 bis.8 septies ; docs/JOURNAL.md décisions 647 à 649 ;
--       docs/PROD_MIGRATIONS.md §3 (migration 100)
--
-- LE PATRON EST CELUI DE `card_comments`, REPRIS SANS L'AFFAIBLIR. `workspace_id` est dérivé de l'affaire par le trigger
-- d'insertion ; une activité naît ni modifiée ni retirée, quoi que le client envoie ; un tiers — l'administrateur de
-- l'espace — ne peut que la RETIRER, jamais la réécrire ; retirer la vide en pierre tombale (subject et compte rendu
-- effacés, participants retirés), et une activité retirée ne se modifie plus. Les privilèges de colonne bornent ce que
-- le client peut écrire. Ordinaire, rejouable.

-- =============================================================================================
-- 1. Les activités
-- =============================================================================================

create table if not exists public.card_activities (
	id            uuid        primary key default gen_random_uuid(),
	card_id       uuid        not null references public.cards (id) on delete cascade,
	workspace_id  uuid        not null references public.workspaces (id) on delete cascade,
	type          text        not null,
	occurred_at   timestamptz not null,
	duration_minutes integer,
	subject         text        not null,
	body  text,
	author_id     uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at    timestamptz not null default now(),
	edited_at     timestamptz,
	deleted_at    timestamptz,
	deleted_by    uuid        references public.profiles (id) on delete set null,
	constraint card_activities_type_check check (type in ('call', 'meeting', 'visio')),
	constraint card_activities_duration_check check (duration_minutes is null or duration_minutes between 1 and 1440),
	-- Une pierre tombale a un subject vide ; une activité vivante, de 1 à 200 caractères.
	constraint card_activities_subject_check check (
		(deleted_at is not null and subject = '')
		or (deleted_at is null and char_length(btrim(subject)) between 1 and 200)
	),
	constraint card_activities_body_check check (body is null or char_length(body) <= 20000)
);

create index if not exists card_activities_card_idx on public.card_activities (card_id, occurred_at desc);

comment on table public.card_activities is
	'CRM-067 — docs/SPEC-activites.md §3. Une activité réalisée sur une affaire (appel, réunion, visio). Retirer la '
	'vide en pierre tombale ; droits d''un commentaire, modération bornée au retrait.';

-- =============================================================================================
-- 2. Les participants : un contact lié à l'affaire, ou un membre de l'espace
-- =============================================================================================

create table if not exists public.card_activity_participants (
	activity_id uuid not null references public.card_activities (id) on delete cascade,
	contact_id  uuid references public.contacts (id) on delete cascade,
	profile_id  uuid references public.profiles (id) on delete cascade,
	constraint card_activity_participants_one_check check ((contact_id is null) <> (profile_id is null))
);

create unique index if not exists card_activity_participants_contact_uniq
	on public.card_activity_participants (activity_id, contact_id) where contact_id is not null;
create unique index if not exists card_activity_participants_profile_uniq
	on public.card_activity_participants (activity_id, profile_id) where profile_id is not null;

comment on table public.card_activity_participants is
	'CRM-067 — docs/SPEC-activites.md §3. Exactement un de contact_id (lié à l''affaire) ou profile_id (membre de '
	'l''espace) ; suit son activité.';

-- =============================================================================================
-- 3. Les triggers des activités
-- =============================================================================================

-- Une activité RÉALISÉE a eu lieu : jamais dans le futur, à cinq minutes près pour l'horloge du poste (§2).
create or replace function app.card_activities_verifier_date(p_survenue timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
	if p_survenue > now() + interval '5 minutes' then
		raise exception 'activity_in_future'
			using errcode = '23514',
			      detail  = 'Une activité consignée a eu lieu : sa date ne peut pas être dans le futur.';
	end if;
end;
$$;

create or replace function app.card_activities_avant_insertion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	espace uuid;
begin
	select c.workspace_id into espace from public.cards c where c.id = new.card_id;
	if espace is null then
		raise exception 'card_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucune card lisible ne porte cet identifiant.';
	end if;
	perform app.card_activities_verifier_date(new.occurred_at);

	new.workspace_id := espace;
	new.created_at   := now();
	-- Une activité ne naît ni corrigée, ni retirée, quoi que le client envoie.
	new.edited_at    := null;
	new.deleted_at   := null;
	new.deleted_by   := null;
	new.subject        := btrim(new.subject);
	return new;
end;
$$;

create or replace function app.card_activities_avant_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	-- La porte étroite des détachements de clé (INC-076) : la suppression d'un profil ne touche QUE `author_id` ou
	-- `deleted_by`, et rien d'autre ne doit changer.
	detachement_fk boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and ((old.author_id is not null and new.author_id is null) or (old.deleted_by is not null and new.deleted_by is null))
		and new.id            is not distinct from old.id
		and new.card_id       is not distinct from old.card_id
		and new.workspace_id  is not distinct from old.workspace_id
		and new.type          is not distinct from old.type
		and new.occurred_at   is not distinct from old.occurred_at
		and new.duration_minutes is not distinct from old.duration_minutes
		and new.subject         is not distinct from old.subject
		and new.body  is not distinct from old.body
		and new.created_at    is not distinct from old.created_at
		and new.edited_at     is not distinct from old.edited_at
		and new.deleted_at    is not distinct from old.deleted_at;
	v_appelant uuid := (select auth.uid());
begin
	if detachement_fk then
		return new;
	end if;

	if old.deleted_at is not null then
		raise exception 'activity_deleted'
			using errcode = 'P0001',
			      detail  = 'Une activité retirée ne peut plus être ni corrigée ni rétablie.';
	end if;

	if new.id           is distinct from old.id
	or new.card_id      is distinct from old.card_id
	or new.workspace_id is distinct from old.workspace_id
	or new.author_id    is distinct from old.author_id
	or new.created_at   is distinct from old.created_at then
		raise exception 'activity_identity_immutable'
			using errcode = 'P0001',
			      detail  = 'L''affaire, l''espace, l''auteur et la date de création d''une activité ne changent pas.';
	end if;

	-- LA BORNE DE LA MODÉRATION — INC-072, décision 374 : un tiers ne peut que retirer.
	if v_appelant is not null
	   and old.author_id is distinct from v_appelant
	   and new.deleted_at is null then
		raise exception 'activity_moderation_limited'
			using errcode = 'P0001',
			      detail  = 'Un tiers ne peut que retirer une activité, jamais la corriger.';
	end if;

	if new.deleted_at is not null then
		-- LE RETRAIT VIDE RÉELLEMENT L'ACTIVITÉ : la date et l'auteur du geste sont ceux de la base.
		new.deleted_at    := now();
		new.deleted_by    := v_appelant;
		new.subject         := '';
		new.body  := null;
		new.duration_minutes := old.duration_minutes;
		new.type          := old.type;
		new.occurred_at   := old.occurred_at;
		new.edited_at     := old.edited_at;
		return new;
	end if;

	perform app.card_activities_verifier_date(new.occurred_at);
	new.deleted_by := old.deleted_by;
	new.subject      := btrim(new.subject);
	if (new.type, new.occurred_at, new.duration_minutes, new.subject, new.body)
	   is distinct from (old.type, old.occurred_at, old.duration_minutes, old.subject, old.body) then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$$;

-- Après le retrait, les participants partent avec le contenu. `SECURITY DEFINER` : le modérateur n'est pas l'auteur,
-- et la politique des participants ne lui ouvre pas leur suppression.
create or replace function app.card_activities_apres_retrait()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.deleted_at is null and new.deleted_at is not null then
		delete from public.card_activity_participants p where p.activity_id = new.id;
	end if;
	return null;
end;
$$;
alter function app.card_activities_apres_retrait() owner to postgres;
revoke all on function app.card_activities_apres_retrait() from public, anon, authenticated;

drop trigger if exists card_activities_avant_insertion on public.card_activities;
create trigger card_activities_avant_insertion before insert on public.card_activities
	for each row execute function app.card_activities_avant_insertion();
drop trigger if exists card_activities_avant_maj on public.card_activities;
create trigger card_activities_avant_maj before update on public.card_activities
	for each row execute function app.card_activities_avant_maj();
drop trigger if exists card_activities_apres_retrait on public.card_activities;
create trigger card_activities_apres_retrait after update on public.card_activities
	for each row execute function app.card_activities_apres_retrait();

-- =============================================================================================
-- 4. Le trigger des participants : un contact lié à l'affaire, un membre de l'espace, une activité vivante
-- =============================================================================================

create or replace function app.card_activity_participants_verifier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card uuid;
	v_ws   uuid;
	v_retiree boolean;
begin
	select a.card_id, a.workspace_id, a.deleted_at is not null into v_card, v_ws, v_retiree
	  from public.card_activities a where a.id = new.activity_id;
	if v_retiree then
		raise exception 'activity_deleted' using errcode = 'P0001';
	end if;
	if new.contact_id is not null
	   and not exists (select 1 from public.card_contacts cc where cc.card_id = v_card and cc.contact_id = new.contact_id) then
		raise exception 'participant_outside_card' using errcode = '23514',
			detail = 'Un contact participant doit être lié à l''affaire.';
	end if;
	if new.profile_id is not null
	   and not exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = new.profile_id) then
		raise exception 'participant_outside_card' using errcode = '23514',
			detail = 'Un participant de l''équipe doit être membre de l''espace de l''affaire.';
	end if;
	return new;
end;
$$;
alter function app.card_activity_participants_verifier() owner to postgres;
revoke all on function app.card_activity_participants_verifier() from public, anon, authenticated;

drop trigger if exists card_activity_participants_verifier on public.card_activity_participants;
create trigger card_activity_participants_verifier before insert or update on public.card_activity_participants
	for each row execute function app.card_activity_participants_verifier();

-- =============================================================================================
-- 5. Politiques et privileges — ceux d'un commentaire (§3)
-- =============================================================================================

alter table public.card_activities enable row level security;
alter table public.card_activity_participants enable row level security;

revoke all on table public.card_activities from public, anon, authenticated;
grant select on table public.card_activities to authenticated;
grant insert (id, card_id, type, occurred_at, duration_minutes, subject, body) on table public.card_activities to authenticated;
grant update (type, occurred_at, duration_minutes, subject, body, deleted_at) on table public.card_activities to authenticated;

revoke all on table public.card_activity_participants from public, anon, authenticated;
grant select, insert, delete on table public.card_activity_participants to authenticated;

drop policy if exists card_activities_lecture on public.card_activities;
create policy card_activities_lecture on public.card_activities
	for select to authenticated using (app.can_read_card(card_id));
drop policy if exists card_activities_insertion on public.card_activities;
create policy card_activities_insertion on public.card_activities
	for insert to authenticated with check (app.can_write_card(card_id) and author_id = (select auth.uid()));
drop policy if exists card_activities_maj on public.card_activities;
create policy card_activities_maj on public.card_activities
	for update to authenticated
	using (author_id = (select auth.uid()) and app.can_write_card(card_id))
	with check (author_id = (select auth.uid()) and app.can_write_card(card_id));
drop policy if exists card_activities_moderation on public.card_activities;
create policy card_activities_moderation on public.card_activities
	for update to authenticated
	using (app.is_workspace_admin(workspace_id) and app.can_read_card(card_id))
	with check (app.is_workspace_admin(workspace_id) and app.can_read_card(card_id));

drop policy if exists card_activity_participants_lecture on public.card_activity_participants;
create policy card_activity_participants_lecture on public.card_activity_participants
	for select to authenticated
	using (exists (select 1 from public.card_activities a where a.id = activity_id and app.can_read_card(a.card_id)));
drop policy if exists card_activity_participants_ecriture on public.card_activity_participants;
create policy card_activity_participants_ecriture on public.card_activity_participants
	for insert to authenticated
	with check (exists (select 1 from public.card_activities a
	                     where a.id = activity_id and a.author_id = (select auth.uid()) and app.can_write_card(a.card_id)));
drop policy if exists card_activity_participants_retrait on public.card_activity_participants;
create policy card_activity_participants_retrait on public.card_activity_participants
	for delete to authenticated
	using (exists (select 1 from public.card_activities a
	                where a.id = activity_id and a.author_id = (select auth.uid()) and app.can_write_card(a.card_id)));

notify pgrst, 'reload schema';

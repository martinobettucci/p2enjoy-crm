-- @spec CRM-138 (docs/BACKLOG.md) — tranche T1 : effacer un message vers la corbeille de l'inbox, la restaurer, le
--       déplacement IMAP demandé à `mail-sync`, la purge à 30 jours ; un message effacé n'est plus lu nulle part
-- @spec docs/SPEC-mail-subsystem.md §29.2 à §29.6 ; docs/SCHEMA.md « Migration `0180` » ; docs/SPEC-corbeille.md §8
--       (la rétention, la règle de visibilité de la décision 707) ; docs/JOURNAL.md décisions 878, 917 et 921
--
-- LES QUATRE FONCTIONS REPRISES (§5) le sont À L'IDENTIQUE de leur définition en base (`pg_get_functiondef`, 2026-11-11),
-- avec le seul filtre `deleted_at is null` ajouté. La politique de lecture exclut un message en corbeille (§4) : les
-- fonctions `SECURITY INVOKER` l'excluent d'elles-mêmes. Les fonctions `SECURITY DEFINER` qui ne sont PAS reprises le
-- comptent à dessein, parce qu'il existe encore en base : l'export RGPD d'un contact, l'énumération d'une purge d'affaire,
-- la détection d'une réponse par les séquences de relance, la tenue des envois et la classification d'un message NOUVEAU
-- par la filiation (docs/SPEC-mail-subsystem.md §29.4, précisé à l'écriture de cette migration).

-- =============================================================================================
-- 1. Les colonnes, et la date qui décide de la purge posée par le serveur
-- =============================================================================================

alter table public.mail_messages
	add column deleted_at timestamptz,
	add column deleted_by uuid references public.profiles (id) on delete set null;
comment on column public.mail_messages.deleted_at is
	'CRM-138 : mis à la corbeille de l''inbox à cette date (posée par le serveur) ; NULL, il ne l''est pas. docs/SPEC-mail-subsystem.md §29.2.';
comment on column public.mail_messages.deleted_by is
	'CRM-138 : qui l''a effacé ; `on delete set null`. docs/SPEC-mail-subsystem.md §29.2.';
create index mail_messages_corbeille_idx on public.mail_messages (workspace_id, deleted_at) where deleted_at is not null;

-- Le patron de `app.corbeille_avant_ecriture` (docs/SPEC-corbeille.md §8.1) : au passage en corbeille, le serveur pose la
-- date et l'auteur ; tant que le message y reste, il les FIGE ; à la restauration, il les efface ensemble.
create or replace function app.mail_messages_corbeille_avant_ecriture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.deleted_at is null then
		new.deleted_by := null;
	elsif old.deleted_at is null then
		new.deleted_at := now();
		new.deleted_by := (select p.id from public.profiles p where p.id = auth.uid());
	else
		new.deleted_at := old.deleted_at;
		new.deleted_by := old.deleted_by;
	end if;
	return new;
end;
$$;
create trigger mail_messages_corbeille_avant_ecriture
	before update of deleted_at, deleted_by on public.mail_messages
	for each row execute function app.mail_messages_corbeille_avant_ecriture();

-- =============================================================================================
-- 2. Le déplacement IMAP, une ligne par occurrence dans une boîte que la personne peut écrire
-- =============================================================================================

create table public.mail_trash_moves (
	id               uuid primary key default gen_random_uuid(),
	workspace_id     uuid not null references public.workspaces (id) on delete cascade,
	message_id       uuid not null references public.mail_messages (id) on delete cascade,
	account_id       uuid not null references public.mail_inbound_accounts (id) on delete cascade,
	folder           text not null,
	uid              bigint not null,
	state            text not null default 'pending',
	attempts         integer not null default 0,
	next_attempt_at  timestamptz not null default now(),
	last_error       text,
	requested_by     uuid references public.profiles (id) on delete set null,
	created_at       timestamptz not null default now(),
	done_at          timestamptz,
	constraint mail_trash_moves_state_check check (state in ('pending', 'done', 'failed', 'cancelled')),
	constraint mail_trash_moves_attempts_check check (attempts >= 0),
	constraint mail_trash_moves_last_error_check check (last_error is null or char_length(last_error) between 1 and 500)
);
comment on table public.mail_trash_moves is
	'CRM-138 : le déplacement d''un message effacé dans la corbeille de sa boîte, par `mail-sync`. docs/SPEC-mail-subsystem.md §29.2, §29.5.';
create index mail_trash_moves_a_faire_idx on public.mail_trash_moves (next_attempt_at) where state = 'pending';
create index mail_trash_moves_message_idx on public.mail_trash_moves (message_id);

alter table public.mail_trash_moves enable row level security;
revoke all on public.mail_trash_moves from anon, authenticated;
grant select on public.mail_trash_moves to authenticated;
grant all on public.mail_trash_moves to service_role;

-- =============================================================================================
-- 3. Les droits : écrire un message, voir la corbeille
-- =============================================================================================

-- Écrire sur la boîte d'un message : la règle de lecture des boîtes (`app.boite_du_message_lisible`) — son titulaire, ou
-- un administrateur de l'espace. Une fonction à part, pour que la règle d'écriture puisse un jour diverger de la lecture.
create or replace function app.peut_ecrire_boite_du_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.mail_message_occurrences o
		  join public.mail_inbound_accounts a on a.id = o.account_id
		 where o.message_id = p_message_id
		   and (a.owner_id = (select auth.uid()) or app.is_workspace_admin(a.workspace_id))
	);
$$;

-- Écrire un message (décision 917) : classé, qui peut écrire l'affaire ; non classé, qui peut écrire sa boîte.
create or replace function app.peut_ecrire_message(p_message public.mail_messages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select case when p_message.card_id is not null then app.can_write_card(p_message.card_id)
	            else app.peut_ecrire_boite_du_message(p_message.id) end;
$$;

-- La corbeille visible (décision 707, reprise par la décision 917) : le message qu'on a soi-même effacé ; tout message
-- effacé de l'espace pour qui l'administre.
create or replace function app.message_en_corbeille_visible(p_message public.mail_messages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select p_message.deleted_at is not null
	   and (p_message.deleted_by = (select auth.uid()) or app.is_workspace_admin(p_message.workspace_id));
$$;

-- Par son identifiant, en `SECURITY DEFINER` : la politique de `mail_messages` exclut un message en corbeille, et une
-- sous-requête sous les droits de l'appelant ne le trouverait jamais.
create or replace function app.message_en_corbeille_visible_par_id(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((select app.message_en_corbeille_visible(m) from public.mail_messages m where m.id = p_message_id), false);
$$;

create policy mail_trash_moves_lecture on public.mail_trash_moves
	for select to authenticated
	using (app.message_en_corbeille_visible_par_id(message_id));

-- =============================================================================================
-- 4. La politique de lecture : un message en corbeille n'est lu nulle part
-- =============================================================================================

drop policy if exists mail_messages_lecture on public.mail_messages;
create policy mail_messages_lecture on public.mail_messages
	for select to authenticated
	using (
		deleted_at is null
		and (((card_id is not null) and app.can_read_card(card_id)) or app.boite_du_message_lisible(id))
	);

-- =============================================================================================
-- 5. Le type d'événement de l'affaire : `mail_deleted`, `mail_restored`
-- =============================================================================================
--
-- Reprise de la contrainte en base (`0176`) à l'identique, plus les deux types. Hors rattachement, comme `mail_cancelled`.

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check
	check (type = any (array[
		'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived', 'trashed',
		'restored', 'field_changed', 'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed', 'woken', 'stalled',
		'contact_linked', 'contact_unlinked', 'contact_role_changed', 'checklist_checked', 'checklist_unchecked',
		'label_added', 'label_removed', 'attached', 'detached', 'mail_cancelled', 'mail_deleted', 'mail_restored'
	]));

-- Le journal d'audit admet le message purgé (famille `retention`, par `app.audit_family`). Reprise de la contrainte en base
-- à l'identique, plus `mail_message`.
alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log add constraint audit_log_entity_type_check
	check (entity_type = any (array[
		'member', 'invitation', 'track_access', 'channel_access', 'workspace', 'track', 'channel', 'workflow',
		'workflow_step', 'workflow_transition', 'workflow_node', 'form_field', 'form_field_rule', 'mail_account',
		'mail_identity', 'card', 'comment', 'activity', 'contact', 'organization', 'session', 'audit_log', 'card_list',
		'contact_list', 'webhook', 'mail_message'
	]));

-- =============================================================================================
-- 6. Effacer, restaurer, lire la corbeille — sous le jeton de la personne
-- =============================================================================================

create or replace function public.delete_message(p_message_id uuid, p_also_mailbox boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_message  public.mail_messages%rowtype;
	v_moves    integer := 0;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	-- Inconnu, ou illisible : indiscernables. Un message déjà en corbeille se lit par la corbeille visible.
	if v_message.id is null
	   or (v_message.deleted_at is null and not app.peut_voir_message(p_message_id))
	   or (v_message.deleted_at is not null and not app.message_en_corbeille_visible(v_message)) then
		perform app.raise_http_error(404, 'message_not_found');
	end if;
	if not app.peut_ecrire_message(v_message) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	-- IDEMPOTENTE : un second appel ne raconte pas une seconde histoire.
	if v_message.deleted_at is not null then
		return jsonb_build_object('message_id', p_message_id, 'deleted_at', v_message.deleted_at, 'mailbox_moves', 0);
	end if;
	if coalesce(p_also_mailbox, false) then
		if not exists (
			select 1 from public.mail_message_occurrences o
			  join public.mail_inbound_accounts a on a.id = o.account_id
			 where o.message_id = p_message_id
			   and (a.owner_id = v_appelant or app.is_workspace_admin(a.workspace_id))
		) then
			raise exception 'no_writable_mailbox' using errcode = '22023';
		end if;
		insert into public.mail_trash_moves (workspace_id, message_id, account_id, folder, uid, requested_by)
		select v_message.workspace_id, o.message_id, o.account_id, o.folder, o.uid, v_appelant
		  from public.mail_message_occurrences o
		  join public.mail_inbound_accounts a on a.id = o.account_id
		 where o.message_id = p_message_id
		   and (a.owner_id = v_appelant or app.is_workspace_admin(a.workspace_id));
		get diagnostics v_moves = row_count;
	end if;
	update public.mail_messages m set deleted_at = now() where m.id = p_message_id;
	if v_message.card_id is not null then
		perform app.card_event_ecrire(v_message.card_id, v_message.workspace_id, 'mail_deleted',
			jsonb_build_object('message_id', p_message_id, 'subject', v_message.subject));
	end if;
	return jsonb_build_object('message_id', p_message_id, 'deleted_at',
		(select m.deleted_at from public.mail_messages m where m.id = p_message_id), 'mailbox_moves', v_moves);
end;
$$;
comment on function public.delete_message(uuid, boolean) is
	'CRM-138 : met le message ouvert à la corbeille de l''inbox ; avec p_also_mailbox, demande à mail-sync de le déplacer dans la corbeille de chaque boîte que la personne peut écrire. 404 message_not_found, 42501 forbidden, 22023 no_writable_mailbox. docs/SPEC-mail-subsystem.md §29.3.';
revoke all on function public.delete_message(uuid, boolean) from public, anon;
grant execute on function public.delete_message(uuid, boolean) to authenticated;

create or replace function public.restore_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message   public.mail_messages%rowtype;
	v_annules   integer := 0;
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null or not app.message_en_corbeille_visible(v_message) then
		perform app.raise_http_error(404, 'message_not_found');
	end if;
	if not app.peut_ecrire_message(v_message) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	-- Un déplacement encore en attente est annulé ; un déplacement fait n'est pas défait (§29.4).
	update public.mail_trash_moves t set state = 'cancelled'
	 where t.message_id = p_message_id and t.state = 'pending';
	get diagnostics v_annules = row_count;
	update public.mail_messages m set deleted_at = null where m.id = p_message_id;
	if v_message.card_id is not null then
		perform app.card_event_ecrire(v_message.card_id, v_message.workspace_id, 'mail_restored',
			jsonb_build_object('message_id', p_message_id, 'subject', v_message.subject));
	end if;
	return jsonb_build_object('message_id', p_message_id, 'cancelled_moves', v_annules);
end;
$$;
comment on function public.restore_message(uuid) is
	'CRM-138 : sort le message de la corbeille de l''inbox ; annule les déplacements IMAP en attente, ne défait pas ceux qui sont faits. docs/SPEC-mail-subsystem.md §29.4.';
revoke all on function public.restore_message(uuid) from public, anon;
grant execute on function public.restore_message(uuid) to authenticated;

create or replace function public.trashed_messages(p_workspace_id uuid)
returns table (
	message_id uuid, subject text, from_address text, from_name text, card_id uuid, deleted_at timestamptz,
	deleted_by uuid, deleted_by_name text, purge_at timestamptz, can_restore boolean,
	moves_pending integer, moves_done integer, moves_failed integer, last_move_error text
)
language sql
stable
security definer
set search_path = ''
as $$
	select m.id, m.subject, m.from_address, m.from_name, m.card_id, m.deleted_at, m.deleted_by, p.full_name,
	       m.deleted_at + app.trash_retention(), app.peut_ecrire_message(m),
	       (select pg_catalog.count(*)::integer from public.mail_trash_moves t where t.message_id = m.id and t.state = 'pending'),
	       (select pg_catalog.count(*)::integer from public.mail_trash_moves t where t.message_id = m.id and t.state = 'done'),
	       (select pg_catalog.count(*)::integer from public.mail_trash_moves t where t.message_id = m.id and t.state = 'failed'),
	       (select t.last_error from public.mail_trash_moves t where t.message_id = m.id and t.state = 'failed'
	         order by t.created_at desc limit 1)
	  from public.mail_messages m
	  left join public.profiles p on p.id = m.deleted_by
	 where m.workspace_id = p_workspace_id
	   and (select auth.uid()) is not null
	   and app.message_en_corbeille_visible(m)
	 order by m.deleted_at desc, m.id;
$$;
comment on function public.trashed_messages(uuid) is
	'CRM-138 : la corbeille de l''inbox visible par la personne — ce qu''elle a effacé, tout pour un administrateur (décision 707). docs/SPEC-mail-subsystem.md §29.4.';
revoke all on function public.trashed_messages(uuid) from public, anon;
grant execute on function public.trashed_messages(uuid) to authenticated;

-- =============================================================================================
-- 7. `mail-sync` : le déplacement IMAP et la purge — `service_role` seulement
-- =============================================================================================

create or replace function public.trash_moves_to_process(p_limit integer default 20)
returns table (move_id uuid, message_id uuid, account_id uuid, folder text, uid bigint, attempts integer)
language sql
security definer
set search_path = ''
as $$
	select t.id, t.message_id, t.account_id, t.folder, t.uid, t.attempts
	  from public.mail_trash_moves t
	 where t.state = 'pending' and t.next_attempt_at <= now()
	 order by t.next_attempt_at, t.id
	 limit greatest(1, least(coalesce(p_limit, 20), 100))
	   for update skip locked;
$$;

-- L'issue d'un essai : `done` (avec la note d'un UID absent), `failed` (définitif), ou `retry` — un nouvel essai à 1, 5,
-- 15, 60 puis 240 minutes ; au dixième, `failed` (§29.5). Fait, l'occurrence quitte le dossier qu'elle a quitté.
create or replace function public.trash_move_record(p_move_id uuid, p_outcome text, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_move  public.mail_trash_moves%rowtype;
	v_delai interval;
begin
	if p_outcome not in ('done', 'failed', 'retry') then
		raise exception 'invalid_outcome' using errcode = '22023';
	end if;
	select * into v_move from public.mail_trash_moves t where t.id = p_move_id for update;
	if v_move.id is null or v_move.state <> 'pending' then
		return coalesce(v_move.state, 'unknown');
	end if;
	if p_outcome = 'done' then
		update public.mail_trash_moves t set state = 'done', done_at = now(), attempts = t.attempts + 1,
		       last_error = nullif(left(coalesce(p_error, ''), 500), '')
		 where t.id = p_move_id;
		delete from public.mail_message_occurrences o
		 where o.message_id = v_move.message_id and o.account_id = v_move.account_id
		   and o.folder = v_move.folder and o.uid = v_move.uid;
		return 'done';
	end if;
	if p_outcome = 'failed' or v_move.attempts + 1 >= 10 then
		update public.mail_trash_moves t set state = 'failed', attempts = t.attempts + 1,
		       last_error = left(coalesce(nullif(p_error, ''), 'unknown_error'), 500)
		 where t.id = p_move_id;
		return 'failed';
	end if;
	v_delai := case v_move.attempts when 0 then interval '1 minute' when 1 then interval '5 minutes'
	                                 when 2 then interval '15 minutes' when 3 then interval '60 minutes'
	                                 else interval '240 minutes' end;
	update public.mail_trash_moves t set attempts = t.attempts + 1, next_attempt_at = now() + v_delai,
	       last_error = left(coalesce(nullif(p_error, ''), 'unknown_error'), 500)
	 where t.id = p_move_id;
	return 'pending';
end;
$$;

create or replace function public.mail_messages_to_purge(p_limit integer default 50)
returns table (message_id uuid, storage_paths text[])
language sql
stable
security definer
set search_path = ''
as $$
	select m.id,
	       coalesce((select pg_catalog.array_agg(a.storage_path order by a.storage_path) from public.mail_attachments a
	                  where a.message_id = m.id and a.storage_path is not null), '{}')
	  from public.mail_messages m
	 where m.deleted_at is not null
	   and m.deleted_at < now() - app.trash_retention()
	   and not exists (select 1 from public.mail_trash_moves t where t.message_id = m.id and t.state = 'pending')
	 order by m.deleted_at, m.id
	 limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

create or replace function public.purge_mail_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id for update;
	if v_message.id is null or v_message.deleted_at is null
	   or v_message.deleted_at >= now() - app.trash_retention() then
		return false;
	end if;
	-- Journalisé SANS son objet : un objet de courriel peut porter une donnée personnelle, et le journal survit au message.
	perform app.audit_record(v_message.workspace_id, 'purged', 'mail_message', v_message.id, null,
		jsonb_build_object('card_id', v_message.card_id, 'deleted_at', v_message.deleted_at, 'deleted_by', v_message.deleted_by));
	delete from public.mail_messages m where m.id = p_message_id;
	return true;
end;
$$;

revoke all on function public.trash_moves_to_process(integer) from public, anon, authenticated;
revoke all on function public.trash_move_record(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mail_messages_to_purge(integer) from public, anon, authenticated;
revoke all on function public.purge_mail_message(uuid) from public, anon, authenticated;
grant execute on function public.trash_moves_to_process(integer) to service_role;
grant execute on function public.trash_move_record(uuid, text, text) to service_role;
grant execute on function public.mail_messages_to_purge(integer) to service_role;
grant execute on function public.purge_mail_message(uuid) to service_role;

-- =============================================================================================
-- 8. Les quatre fonctions reprises, avec le seul filtre `deleted_at is null`
-- =============================================================================================

-- app.peut_voir_message : la garde de classer, retirer, marquer lu, du fil et des pièces jointes.
CREATE OR REPLACE FUNCTION app.peut_voir_message(p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	-- CRM-138 : un message en corbeille n'est vu par aucune des deux voies ; la corbeille se lit par `trashed_messages`.
	select exists (
		select 1
		  from public.mail_messages m
		 where m.id = p_message_id
		   and m.deleted_at is null
		   and ((m.card_id is not null and app.can_read_card(m.card_id)) or app.boite_du_message_lisible(m.id))
	);
$function$;

-- app.health_last_contact : appelée sous `app.health_context` (SECURITY DEFINER, CRM-142), la RLS ne la filtre pas.
CREATE OR REPLACE FUNCTION app.health_last_contact(p_card_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select greatest(
		(select max(a.occurred_at) from public.card_activities a where a.card_id = p_card_id and a.deleted_at is null),
		(select max(m.received_at) from public.mail_messages m where m.card_id = p_card_id and m.deleted_at is null)
	);
$function$;

-- public.messages_a_ranger : mail-sync ne range pas un message en corbeille dans le dossier IMAP de son affaire.
CREATE OR REPLACE FUNCTION public.messages_a_ranger(p_account_id uuid)
 RETURNS TABLE(message_id uuid, card_id uuid, folder text, uid bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select distinct on (m.id)
	       m.id, m.card_id, o.folder, o.uid
	  from public.mail_messages m
	  join public.mail_message_occurrences o
	    on o.message_id = m.id and o.account_id = p_account_id
	 where m.card_id is not null
	   and m.filed_at is null
	   and m.deleted_at is null
	 order by m.id, o.seen_at asc;
$function$;

-- public.prepare_email : on ne répond pas à un message en corbeille (`reply_outside_card`).
CREATE OR REPLACE FUNCTION public.prepare_email(p_card_id uuid, p_to text[], p_body_text text, p_subject text DEFAULT ''::text, p_identity_id uuid DEFAULT NULL::uuid, p_cc text[] DEFAULT '{}'::text[], p_bcc text[] DEFAULT '{}'::text[], p_in_reply_to_message_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_appelant  uuid := (select auth.uid());
	v_espace    uuid;
	v_brouillon uuid;
	v_chemins   text[];
	v_trouvees  integer;
	v_total     bigint;
	v_pieces    jsonb := '[]'::jsonb;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- PRÉPARER AU NOM D'UNE AFFAIRE, C'EST DÉJÀ Y ÉCRIRE : le droit est celui de l'envoi.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- L'AFFAIRE VIVANTE ET DOTÉE D'UNE ADRESSE — la règle de `queue_outbound_email`.
	select c.workspace_id into v_espace
	  from public.cards c
	 where c.id = p_card_id
	   and c.deleted_at is null
	   and c.email_local_part is not null
	   and app.card_has_active_placement(c.id);
	if v_espace is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- LA SIENNE, ET ELLE SEULE (décision 805).
	if p_identity_id is not null and not exists (
		select 1 from public.mail_outbound_identities i
		 where i.id = p_identity_id and i.owner_id = v_appelant and i.workspace_id = v_espace
	) then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	if p_in_reply_to_message_id is not null and not exists (
		select 1 from public.mail_messages m
		 where m.id = p_in_reply_to_message_id and m.card_id = p_card_id and m.deleted_at is null
	) then
		raise exception 'reply_outside_card' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;
	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LES PIÈCES — `CRM-143` §17.6, les règles de `queue_outbound_email` (§19 bis.2 points 4 et 5) : le client ne donne que
	-- des CHEMINS ; nom, taille et type sont relus dans `storage.objects`, jamais crus.
	if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
		raise exception 'attachment_not_available' using errcode = '23514';
	end if;
	select coalesce(array_agg(distinct e), '{}')
	  into v_chemins
	  from jsonb_array_elements_text(coalesce(p_attachments, '[]'::jsonb)) e;
	if coalesce(array_length(v_chemins, 1), 0) > 10 then
		raise exception 'too_many_attachments' using errcode = '23514', detail = 'At most 10 attachments per message.';
	end if;
	if coalesce(array_length(v_chemins, 1), 0) > 0 then
		select count(*),
		       coalesce(sum((o.metadata ->> 'size')::bigint), 0),
		       coalesce(jsonb_agg(jsonb_build_object(
		           'path', o.name,
		           'filename', split_part(o.name, '/', 4),
		           'mime_type', coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
		           'size_bytes', (o.metadata ->> 'size')::bigint
		       ) order by o.name), '[]'::jsonb)
		  into v_trouvees, v_total, v_pieces
		  from storage.objects o
		 where o.bucket_id = 'mail-outbound-attachments'
		   and o.name = any (v_chemins)
		   and o.owner = v_appelant
		   and split_part(o.name, '/', 1) = v_espace::text
		   and split_part(o.name, '/', 2) = v_appelant::text;
		-- UN SEUL REFUS POUR QUATRE CAUSES : les distinguer dirait qu'un objet d'autrui existe à ce chemin.
		if v_trouvees <> array_length(v_chemins, 1) then
			raise exception 'attachment_not_available' using errcode = '23514';
		end if;
		if v_total > 10485760 then
			raise exception 'attachments_too_large' using errcode = '23514', detail = 'At most 10 MB of attachments per message.';
		end if;
	end if;

	-- UN ASSISTANT EN BOUCLE NE REMPLIT PAS LA FILE SANS FIN (§3.3, point 7).
	if (select count(*) from public.mail_drafts d
	     where d.created_by = v_appelant and d.workspace_id = v_espace and d.status = 'pending') >= 200 then
		raise exception 'draft_limit_reached' using errcode = '23514', detail = 'At most 200 pending prepared messages.';
	end if;

	insert into public.mail_drafts (
		workspace_id, card_id, identity_id, in_reply_to_message_id,
		to_addrs, cc_addrs, bcc_addrs, subject, body_text, origin, created_by, attachments
	)
	values (
		v_espace, p_card_id, p_identity_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), coalesce(p_bcc, '{}'), coalesce(p_subject, ''), p_body_text,
		case when app.via_connector() then 'mcp' else 'web' end, v_appelant, v_pieces
	)
	returning id into v_brouillon;

	return v_brouillon;
end;
$function$;

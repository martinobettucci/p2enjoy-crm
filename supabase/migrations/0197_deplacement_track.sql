-- @spec CRM-162 (docs/BACKLOG.md) — tranche T1 : déplacer un track entier d'un espace à un autre, en base — les alias
--       d'adresses et la trace des déplacements, les clés composites différables, les gardes traversées par le drapeau de
--       transaction, le périmètre, les refus, l'appariement des référentiels, l'aperçu, le déplacement, la redirection d'une
--       adresse, et le classement d'un mail adressé à une ancienne adresse
-- @spec docs/SPEC-deplacement-track.md §2 à §12 ; docs/SCHEMA.md « Migration — `CRM-162` T1 » ; docs/JOURNAL.md décisions
--       964, 966, 968, 969 et 972 ; CLAUDE.md §10 (super-administrateur seul, en base)
--
-- LES FONCTIONS REPRISES le sont de leur définition vivante : les dix-huit déclencheurs gardiens (le seul ajout est la garde
-- du drapeau en tête), et `public.classer_message_automatiquement` (`0190`, la règle 1 bis ajoutée).
--
-- IDEMPOTENCE : `create … if not exists`, `create or replace`, contraintes reposées.

-- =============================================================================================
-- 1. Les types d'événement et de geste — §10
-- =============================================================================================

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check CHECK ((type = ANY (ARRAY['created'::text, 'moved'::text, 'assigned'::text, 'channel_changed'::text, 'workflow_changed'::text, 'archived'::text, 'unarchived'::text, 'trashed'::text, 'restored'::text, 'field_changed'::text, 'mail_received'::text, 'mail_sent'::text, 'mail_unclassified'::text, 'snoozed'::text, 'woken'::text, 'stalled'::text, 'contact_linked'::text, 'contact_unlinked'::text, 'contact_role_changed'::text, 'checklist_checked'::text, 'checklist_unchecked'::text, 'label_added'::text, 'label_removed'::text, 'attached'::text, 'detached'::text, 'mail_cancelled'::text, 'mail_deleted'::text, 'mail_restored'::text, 'track_moved'::text])));
alter table public.plateforme_journal drop constraint if exists plateforme_journal_geste_check;
alter table public.plateforme_journal add constraint plateforme_journal_geste_check CHECK ((geste = ANY (ARRAY['superadmin_amorce'::text, 'superadmin_accorde'::text, 'superadmin_retire'::text, 'espace_cree'::text, 'espace_modifie'::text, 'espace_supprime'::text, 'membre_pose'::text, 'membre_retire'::text, 'attente_inscrite'::text, 'attente_retiree'::text, 'mcp_droits_poses'::text, 'logs_purged'::text, 'card_addresses_regenerated'::text, 'track_moved'::text])));

-- =============================================================================================
-- 2. Les clés étrangères composites, différables — décision 969
-- =============================================================================================

-- `DEFERRABLE INITIALLY IMMEDIATE` : rien ne change hors du déplacement, qui seul les diffère. Aucune revalidation.
-- *Précisé au code* : TOUTE clé composite, et non les seules qui portent `workspace_id` — l'appariement d'un workflow
-- réécrit aussi des couples (rattachement, workflow) et (workflow, étape).
do $$
declare
	r record;
begin
	for r in
		select c.conrelid::regclass as tbl, c.conname
		  from pg_catalog.pg_constraint c
		 where c.contype = 'f' and c.connamespace = 'public'::regnamespace and not c.condeferrable
		   and pg_catalog.cardinality(c.conkey) > 1
	loop
		execute format('alter table %s alter constraint %I deferrable initially immediate', r.tbl, r.conname);
	end loop;
end;
$$;

-- =============================================================================================
-- 3. Les alias d'adresses et la trace des déplacements — §8, §10, §12
-- =============================================================================================

create table if not exists public.card_address_aliases (
	workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
	email_local_part text        not null,
	card_id          uuid        not null references public.cards (id) on delete cascade,
	created_at       timestamptz not null default now(),
	primary key (workspace_id, email_local_part)
);
comment on table public.card_address_aliases is
	'CRM-162 §8 — l''ancienne adresse d''une affaire déplacée : la partie locale dans l''espace quitté, qui continue d''aboutir. '
	'Écrite par la seule fonction de déplacement ; lue par le classement d''un mail entrant.';
alter table public.card_address_aliases enable row level security;
revoke all on public.card_address_aliases from anon, authenticated;

create table if not exists public.track_moves (
	id                bigint      generated always as identity primary key,
	track_id          uuid        not null references public.tracks (id) on delete cascade,
	track_slug        text        not null,
	from_workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	to_workspace_id   uuid        not null references public.workspaces (id) on delete cascade,
	moved_by          uuid        references public.profiles (id) on delete set null,
	moved_at          timestamptz not null default now()
);
create index if not exists track_moves_depart_idx on public.track_moves (from_workspace_id, track_slug, moved_at desc);
comment on table public.track_moves is
	'CRM-162 §10, §12 — la trace de chaque déplacement d''un track, lue par la redirection d''une ancienne adresse.';
alter table public.track_moves enable row level security;
revoke all on public.track_moves from anon, authenticated;
grant select on public.track_moves to authenticated;
drop policy if exists track_moves_lecture on public.track_moves;
create policy track_moves_lecture on public.track_moves for select to authenticated
	using (exists (select 1 from public.tracks t where t.id = track_moves.track_id));

-- =============================================================================================
-- 4. Les gardes, traversées par le drapeau du déplacement — décision 969
-- =============================================================================================

create or replace function app.card_events_refuser_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	raise exception 'card_event_immutable'
		using errcode = 'P0001',
		      detail  = 'Un événement de timeline est définitif : il ne peut être ni modifié ni corrigé.';
end;
$function$;

create or replace function app.workflow_versions_refuser_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	raise exception 'une version publiee est immuable'
		using errcode = '42501',
		      detail  = 'workflow_versions n''accepte aucune mise a jour, y compris sous service_role',
		      hint    = 'publier une nouvelle version plutot que de reecrire celle-ci';
end;
$function$;

create or replace function app.card_comments_avant_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	-- Porte étroite de `CRM-022` (INC-076), étendue à `deleted_by` : l'action référentielle qui
	-- détache une identité supprimée ne touche QUE `author_id`.
	--
	-- CRM-064 : `mentions` a disparu de l'énumération avec la colonne elle-même. La porte reste
	-- aussi étroite qu'avant — elle exige toujours que RIEN d'autre que la clé détachée ne change.
	detachement_fk boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.author_id is not null
		and new.author_id is null
		and new.id           is not distinct from old.id
		and new.card_id      is not distinct from old.card_id
		and new.workspace_id is not distinct from old.workspace_id
		and new.created_at   is not distinct from old.created_at
		and new.body         is not distinct from old.body
		and new.edited_at    is not distinct from old.edited_at
		and new.deleted_at   is not distinct from old.deleted_at
		and new.deleted_by   is not distinct from old.deleted_by;

	-- Le MÊME détachement, appliqué à `deleted_by` : un modérateur dont le compte est supprimé.
	detachement_fk_moderateur boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.deleted_by is not null
		and new.deleted_by is null
		and new.id           is not distinct from old.id
		and new.card_id      is not distinct from old.card_id
		and new.workspace_id is not distinct from old.workspace_id
		and new.author_id    is not distinct from old.author_id
		and new.created_at   is not distinct from old.created_at
		and new.body         is not distinct from old.body
		and new.edited_at    is not distinct from old.edited_at
		and new.deleted_at   is not distinct from old.deleted_at;

	v_appelant uuid := (select auth.uid());
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if detachement_fk or detachement_fk_moderateur then
		return new;
	end if;

	if old.deleted_at is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus être ni modifié ni restauré.';
	end if;

	if new.id           is distinct from old.id
	or new.card_id      is distinct from old.card_id
	or new.workspace_id is distinct from old.workspace_id
	or new.author_id    is distinct from old.author_id
	or new.created_at   is distinct from old.created_at then
		raise exception 'comment_immutable_column'
			using errcode = 'P0001',
			      detail  = 'id, card_id, workspace_id, author_id et created_at sont figés.';
	end if;

	-- LA BORNE DE LA MODÉRATION — INC-072, décision 374, reprise mot pour mot.
	if v_appelant is not null
	   and old.author_id is distinct from v_appelant
	   and new.deleted_at is null then
		raise exception 'comment_moderation_limitee'
			using errcode = 'P0001',
			      detail  = 'Un tiers ne peut que supprimer un commentaire, jamais le modifier.';
	end if;

	if new.deleted_at is not null then
		-- LA SUPPRESSION VIDE RÉELLEMENT LE CORPS (décision 193). La date est celle du geste, non
		-- celle que l'appelant a envoyée, et l'AUTEUR DU GESTE est relevé au passage (INC-072).
		new.deleted_at := now();
		new.deleted_by := v_appelant;
		new.body       := '';
		new.edited_at  := old.edited_at;
		return new;
	end if;

	new.deleted_by := old.deleted_by;

	if new.body is distinct from old.body then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$function$;

create or replace function app.card_activities_avant_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
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
$function$;

create or replace function app.card_checklist_items_before()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
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
$function$;

create or replace function app.saisies_temps_auteur()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if tg_op = 'INSERT' then
		new.created_by := coalesce((select auth.uid()), new.created_by);
		new.updated_by := new.created_by;
	else
		if coalesce(pg_catalog.current_setting('app.trash_purge', true), '') = 'on'
		   and (new.workspace_id, new.profile_id, new.jour, new.minutes, new.created_by, new.created_at)
		       is not distinct from
		       (old.workspace_id, old.profile_id, old.jour, old.minutes, old.created_by, old.created_at) then
			return new;
		end if;
		if (new.workspace_id, new.profile_id, new.jour, new.track_id, new.channel_id, new.card_id, new.created_by,
		    new.created_at)
		   is distinct from
		   (old.workspace_id, old.profile_id, old.jour, old.track_id, old.channel_id, old.card_id, old.created_by,
		    old.created_at) then
			raise exception 'seules les minutes d''une saisie changent' using errcode = 'P0001';
		end if;
		new.updated_by := coalesce((select auth.uid()), new.updated_by);
	end if;
	return new;
end;
$function$;

create or replace function app.saisies_temps_plafond()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	deja integer;
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	-- Une valeur hors de la forme du §2 est laissée à la contrainte `saisies_temps_minutes_check`, plus précise.
	if new.minutes is null or new.minutes <= 0 or new.minutes > 420 or new.minutes % 15 <> 0 then
		return new;
	end if;
	perform pg_advisory_xact_lock(
		hashtextextended('saisies_temps:' || new.workspace_id::text || ':' || new.profile_id::text || ':' || new.jour::text, 0));
	select coalesce(sum(s.minutes), 0) into deja
	  from public.saisies_temps s
	 where s.workspace_id = new.workspace_id
	   and s.profile_id = new.profile_id
	   and s.jour = new.jour
	   and s.id <> new.id;
	if deja + new.minutes > 420 then
		raise exception 'plafond journalier' using errcode = 'P0001',
			detail = format('%s minutes déjà saisies ce jour, %s demandées, 420 au plus', deja, new.minutes);
	end if;
	return new;
end;
$function$;

create or replace function app.saved_views_avant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if tg_op = 'INSERT' then
		new.workspace_id := (select c.workspace_id from public.channels c where c.id = new.channel_id);
		-- La clé de service (seed, preuves) n'a pas d'appelant : elle garde la propriétaire qu'elle envoie.
		new.owner_id := coalesce((select auth.uid()), new.owner_id);
		new.created_at := now();
	else
		new.workspace_id := old.workspace_id;
		new.channel_id := old.channel_id;
		new.owner_id := old.owner_id;
		new.created_at := old.created_at;
		if old.visibility = 'workspace' and new.visibility = 'private' then
			raise exception 'saved_view_cannot_be_unpublished' using errcode = '22023';
		end if;
	end if;
	new.updated_at := now();
	return new;
end;
$function$;

create or replace function app.notifications_avant_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if new.read_at is not null then
		new.read_at := now();
	end if;
	return new;
end;
$function$;

create or replace function app.card_events_apres_maj_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if new.deleted_at is distinct from old.deleted_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.deleted_at is null then 'restored' else 'trashed' end,
			'{}'::jsonb);
	end if;

	return null;
end;
$function$;

create or replace function app.card_events_apres_ecriture_valeur()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_payload jsonb;
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if tg_op = 'UPDATE' then
		if new.value is not distinct from old.value then
			return null;
		end if;
		v_payload := jsonb_build_object('field_id', new.field_id,
		                                'from',     old.value,
		                                'to',       new.value);
	else
		v_payload := jsonb_build_object('field_id', new.field_id,
		                                'to',       new.value);
	end if;

	perform app.card_event_ecrire(new.card_id, new.workspace_id, 'field_changed', v_payload);
	return null;
end;
$function$;

create or replace function app.card_events_apres_ecriture_valeur_commune()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_payload jsonb;
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if tg_op = 'UPDATE' then
		if new.value is not distinct from old.value then
			return null;
		end if;
		v_payload := jsonb_build_object('field_id', new.field_id, 'scope', 'common', 'from', old.value, 'to', new.value);
	else
		v_payload := jsonb_build_object('field_id', new.field_id, 'scope', 'common', 'to', new.value);
	end if;

	perform app.card_event_ecrire(new.card_id, new.workspace_id, 'field_changed', v_payload);
	return null;
end;
$function$;

create or replace function app.card_events_apres_maj_contacts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if tg_op = 'INSERT' then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'contact_linked',
			jsonb_build_object('contact_id', new.contact_id, 'role', new.role));
	elsif tg_op = 'DELETE' then
		-- LA CARD PEUT AVOIR DISPARU AVANT SES RATTACHEMENTS, ET C'EST UNE PREUVE EXISTANTE QUI
		-- L'A ÉTABLI. `card_contacts` référence `cards` en `on delete cascade` : supprimer une
		-- affaire retire ses rattachements, et le trigger tentait alors d'écrire « contact
		-- détaché » dans le fil d'une affaire qui n'existe plus. MESURÉ le 2026-08-25 par
		-- `supabase/tests/0049_card_costs.test.sql` :
		--
		--   ERROR: insert or update on table "card_events" violates foreign key constraint
		--          "card_events_card_id_workspace_id_fkey"
		--
		-- La suppression de l'affaire ÉCHOUAIT donc entièrement — un défaut du produit, non de la
		-- preuve. La trace n'est écrite que si l'affaire est encore là : un fil appartient à sa
		-- card, et l'histoire d'une affaire supprimée n'a nulle part où s'écrire. Le détachement
		-- individuel, lui, garde sa trace — c'est le cas b du §19.7, et il est prouvé.
		if exists (select 1 from public.cards c where c.id = old.card_id) then
			perform app.card_event_ecrire(old.card_id, old.workspace_id, 'contact_unlinked',
				jsonb_build_object('contact_id', old.contact_id, 'role', old.role));
		end if;
	-- `is distinct from` comme les cinq gardes de `CRM-044` : une écriture qui ne déplace pas la
	-- valeur n'allonge pas l'histoire, ce qui rend un rejeu convergent. Deux nulls sont « la même
	-- valeur » pour cet opérateur, ce qui est exactement le comportement voulu.
	elsif new.role is distinct from old.role then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'contact_role_changed',
			jsonb_build_object('contact_id', new.contact_id, 'from', old.role, 'to', new.role));
	end if;

	-- `after` et rend `null` : le trigger n'influence jamais la ligne écrite.
	return null;
end;
$function$;

create or replace function app.card_placements_write_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_acteur uuid := (select p.id from public.profiles p where p.id = auth.uid());
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	-- Un changement de channel prévaut, même s'il change aussi le workflow et l'étape (CRM-045).
	if new.channel_id is distinct from old.channel_id then
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (new.card_id, new.workspace_id, new.id, 'channel_changed', v_acteur,
			jsonb_build_object('from_channel_id',  old.channel_id,
			                   'to_channel_id',    new.channel_id,
			                   'from_workflow_id', old.workflow_id,
			                   'to_workflow_id',   new.workflow_id,
			                   'from_step_id',     old.current_step_id,
			                   'to_step_id',       new.current_step_id));
	-- À channel constant, un changement de workflow est un remappage : il ne franchit aucune arête.
	elsif new.workflow_id is distinct from old.workflow_id then
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (new.card_id, new.workspace_id, new.id, 'workflow_changed', v_acteur,
			jsonb_build_object('channel_id',       new.channel_id,
			                   'from_workflow_id', old.workflow_id,
			                   'to_workflow_id',   new.workflow_id,
			                   'from_step_id',     old.current_step_id,
			                   'to_step_id',       new.current_step_id));
	elsif new.current_step_id is distinct from old.current_step_id then
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (new.card_id, new.workspace_id, new.id, 'moved', v_acteur,
			jsonb_build_object('from_step_id', old.current_step_id,
			                   'to_step_id',   new.current_step_id));
	end if;

	if new.owner_id is distinct from old.owner_id then
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (new.card_id, new.workspace_id, new.id, 'assigned', v_acteur,
			jsonb_build_object('from_owner_id', old.owner_id,
			                   'to_owner_id',   new.owner_id));
	end if;

	if new.archived_at is distinct from old.archived_at then
		insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
		values (new.card_id, new.workspace_id, new.id,
			case when new.archived_at is null then 'unarchived' else 'archived' end, v_acteur, '{}'::jsonb);
	end if;

	if new.snoozed_until is distinct from old.snoozed_until then
		if new.snoozed_until is null then
			insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
			values (new.card_id, new.workspace_id, new.id, 'woken', v_acteur,
				jsonb_build_object('from', old.snoozed_until));
		else
			insert into public.card_events (card_id, workspace_id, placement_id, type, actor_id, payload)
			values (new.card_id, new.workspace_id, new.id, 'snoozed', v_acteur,
				jsonb_build_object('until', new.snoozed_until));
		end if;
	end if;

	return null;
end;
$function$;

create or replace function app.card_placements_add_step_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	insert into public.card_checklist_items (workspace_id, card_id, placement_id, step_item_id, label, position)
	select new.workspace_id, new.card_id, new.id, i.id, i.label, i.position
	  from public.workflow_step_checklist_items i
	 where i.step_id = new.current_step_id and i.archived_at is null
	on conflict (placement_id, step_item_id) do nothing;
	return null;
end;
$function$;

create or replace function app.card_checklist_items_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	values (new.card_id, new.workspace_id,
	        case when new.checked then 'checklist_checked' else 'checklist_unchecked' end,
	        (select auth.uid()),
	        pg_catalog.jsonb_build_object('item_id', new.id, 'label', new.label, 'placement_id', new.placement_id,
	                                      'step_item_id', new.step_item_id));
	return null;
end;
$function$;

create or replace function app.audit_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	ligne    jsonb := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
	avant    jsonb := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else null end;
	objet    text  := tg_argv[0];
	espace   uuid  := (case when objet = 'workspace' then ligne ->> 'id' else ligne ->> 'workspace_id' end)::uuid;
	libelle  text  := ligne ->> tg_argv[1];
	changees text[] := '{}';
	valeurs_avant jsonb := '{}'::jsonb;
	valeurs_apres jsonb := '{}'::jsonb;
	details  jsonb := '{}'::jsonb;
	geste    text;
	colonne  text;
	i        integer;
	-- §5 : les seules valeurs recopiées, courtes et sans secret. Les autres colonnes changées ne sont que nommées.
	courtes  constant text[] := array['name', 'slug', 'label', 'label_override', 'key', 'kind', 'type', 'workflow_id',
		'inbound_domain', 'visibility', 'require_comment', 'probability_override', 'stale_after_days',
		'default_probability', 'default_stale_after_days', 'is_initial', 'from_step_id', 'to_step_id', 'node_id',
		'color', 'is_default', 'daily_quota', 'imap_host', 'imap_port', 'imap_security', 'smtp_host', 'smtp_port',
		'smtp_security', 'from_address'];
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if objet = 'workflow_step' and libelle is null then
		select n.label into libelle from public.workflow_nodes_catalog n where n.id = (ligne ->> 'node_id')::uuid;
	end if;

	if tg_op = 'INSERT' then
		geste := 'created';
	elsif tg_op = 'DELETE' then
		geste := 'deleted';
	else
		for i in 2 .. tg_nargs - 1 loop
			colonne := tg_argv[i];
			if (avant -> colonne) is distinct from (ligne -> colonne) then
				changees := changees || colonne;
				if colonne = any (courtes) then
					valeurs_avant := valeurs_avant || pg_catalog.jsonb_build_object(colonne, avant -> colonne);
					valeurs_apres := valeurs_apres || pg_catalog.jsonb_build_object(colonne, ligne -> colonne);
				end if;
			end if;
		end loop;
		if pg_catalog.cardinality(changees) = 0 then
			return null;
		end if;
		geste := case
			when 'archived_at' = any (changees) and (ligne ->> 'archived_at') is not null
			     and objet in ('workflow', 'form_field', 'workflow_node') then 'archived'
			else 'updated'
		end;
		details := pg_catalog.jsonb_build_object('changed',
			(select pg_catalog.jsonb_agg(c order by c) from pg_catalog.unnest(changees) c));
		if valeurs_avant <> '{}'::jsonb then
			details := details || pg_catalog.jsonb_build_object('before', valeurs_avant, 'after', valeurs_apres);
		end if;
		-- `settings` : les CLÉS changées, jamais leurs valeurs (§5).
		if 'settings' = any (changees) then
			details := details || pg_catalog.jsonb_build_object('settings_keys', (
				select coalesce(pg_catalog.jsonb_agg(k order by k), '[]'::jsonb)
				  from (
					select k from pg_catalog.jsonb_object_keys(coalesce(avant -> 'settings', '{}'::jsonb)) k
					union
					select k from pg_catalog.jsonb_object_keys(coalesce(ligne -> 'settings', '{}'::jsonb)) k
				  ) toutes
				 where (avant -> 'settings' -> k) is distinct from (ligne -> 'settings' -> k)));
		end if;
	end if;

	perform app.audit_record(espace, geste, objet, (ligne ->> 'id')::uuid, libelle, details);
	return null;
end;
$function$;

create or replace function app.card_activities_apres_retrait()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if old.deleted_at is null and new.deleted_at is not null then
		delete from public.card_activity_participants p where p.activity_id = new.id;
	end if;
	return null;
end;
$function$;

-- =============================================================================================
-- 5. Le périmètre — docs/SPEC-deplacement-track.md §3
-- =============================================================================================

-- Le track, ses channels, ses workflows propres, les affaires qui ont un rattachement dans ses channels, et leurs mails.
-- Une affaire rattachée AUSSI ailleurs est dans le périmètre : c'est le refus `shared_card` qui l'arrête (§4).
create or replace function app.track_move_scope(
	p_track_id uuid,
	out channel_ids uuid[],
	out card_ids uuid[],
	out workflow_ids uuid[],
	out message_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
	with ch as (select c.id from public.channels c where c.track_id = p_track_id),
	     ca as (select distinct pl.card_id as id from public.card_placements pl where pl.channel_id in (select id from ch)),
	     wf as (select w.id from public.workflows w where w.track_id = p_track_id),
	     me as (select m.id from public.mail_messages m where m.card_id in (select id from ca))
	select coalesce((select pg_catalog.array_agg(id) from ch), '{}'),
	       coalesce((select pg_catalog.array_agg(id) from ca), '{}'),
	       coalesce((select pg_catalog.array_agg(id) from wf), '{}'),
	       coalesce((select pg_catalog.array_agg(id) from me), '{}');
$$;
revoke all on function app.track_move_scope(uuid) from public, anon, authenticated;

-- Les workflows COMMUNS à l'espace qu'utilise le périmètre (§7.3) : ceux de ses channels, de ses rattachements et des
-- valeurs de ses affaires.
create or replace function app.track_move_shared_workflows(p_track_id uuid, p_channels uuid[], p_cards uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(pg_catalog.array_agg(distinct w.id), '{}')
	  from public.workflows w
	 where w.track_id is distinct from p_track_id
	   and w.id in (
		select c.workflow_id from public.channels c where c.id = any (p_channels)
		union select pl.workflow_id from public.card_placements pl where pl.card_id = any (p_cards)
		union select v.workflow_id from public.card_field_values v where v.card_id = any (p_cards));
$$;
revoke all on function app.track_move_shared_workflows(uuid, uuid[], uuid[]) from public, anon, authenticated;

-- La signature d'un workflow (décision 968) : ses étapes dans l'ordre — la clé du nœud, le libellé propre, les points de
-- checklist —, puis ses champs par clé et par type. Deux workflows de même signature sont « identiques ».
create or replace function app.workflow_signature(p_workflow_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select pg_catalog.md5(
		coalesce((select pg_catalog.string_agg(
			n.key || '|' || coalesce(s.label_override, '') || '|' ||
			coalesce((select pg_catalog.string_agg(lower(app.btrim_blancs(i.label)), ';' order by lower(app.btrim_blancs(i.label)))
			            from public.workflow_step_checklist_items i
			           where i.step_id = s.id and i.archived_at is null), ''),
			'#' order by s.position, n.key)
		  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
		 where s.workflow_id = p_workflow_id), '')
		|| '//' ||
		coalesce((select pg_catalog.string_agg(f.key || '|' || f.type, '#' order by f.key)
		  from public.form_fields f where f.workflow_id = p_workflow_id and f.archived_at is null), ''));
$$;
revoke all on function app.workflow_signature(uuid) from public, anon, authenticated;

-- =============================================================================================
-- 6. L'appariement des référentiels — §7 (rien n'est écrit)
-- =============================================================================================

-- Une ligne par référentiel CITÉ par le périmètre : sa famille, sa source, et sa cible à l'arrivée quand elle est trouvée
-- (`reuse`) ; sinon `create`, ou `conflict` (un champ commun homonyme d'un autre type, §4). Les nœuds et champs communs
-- d'un workflow commun COPIÉ sont cités ; ceux d'un workflow réutilisé ne le sont pas : il a les siens à l'arrivée.
create or replace function app.track_move_matches(p_track_id uuid, p_target uuid)
returns table (family text, source_id uuid, source_name text, target_id uuid, target_name text, action text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_scope    record;
	v_partages uuid[];
	v_copies   uuid[] := '{}';
	v_depart   text;
	r          record;
	v_cible    uuid;
begin
	select * into v_scope from app.track_move_scope(p_track_id);
	v_partages := app.track_move_shared_workflows(p_track_id, v_scope.channel_ids, v_scope.card_ids);
	select w.name into v_depart from public.tracks t join public.workspaces w on w.id = t.workspace_id where t.id = p_track_id;

	-- Les workflows communs : identiques, réutilisés ; sinon copiés.
	for r in select w.id, w.name from public.workflows w where w.id = any (v_partages) order by w.name loop
		select t.id into v_cible
		  from public.workflows t
		 where t.workspace_id = p_target and t.scope = 'global' and t.archived_at is null
		   and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(r.name))
		   and app.workflow_signature(t.id) = app.workflow_signature(r.id)
		 order by t.created_at, t.id limit 1;
		if v_cible is not null then
			family := 'workflow'; source_id := r.id; source_name := r.name; target_id := v_cible;
			target_name := r.name; action := 'reuse';
		else
			v_copies := v_copies || r.id;
			family := 'workflow'; source_id := r.id; source_name := r.name; target_id := null; action := 'create';
			target_name := case when exists (select 1 from public.workflows t where t.workspace_id = p_target
			                                    and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(r.name)))
			                    then r.name || ' (' || v_depart || ')' else r.name end;
		end if;
		return next;
	end loop;

	-- Les nœuds : ceux des workflows propres au track et des workflows communs copiés, par leur clé.
	return query
	select distinct 'node'::text, n.id, n.label, t.id, t.label, case when t.id is null then 'create' else 'reuse' end
	  from public.workflow_steps s
	  join public.workflow_nodes_catalog n on n.id = s.node_id
	  left join public.workflow_nodes_catalog t on t.workspace_id = p_target and t.key = n.key
	 where s.workflow_id = any (v_scope.workflow_ids || v_copies);

	-- Les champs communs : par leur nom ; un homonyme d'un autre type est un conflit.
	return query
	select distinct on (f.id) 'common_field'::text, f.id, f.label, t.id, t.label,
	       case when t.id is null then 'create' when t.type <> f.type then 'conflict' else 'reuse' end
	  from public.card_common_fields f
	  left join public.card_common_fields t
	         on t.workspace_id = p_target and lower(app.btrim_blancs(t.label)) = lower(app.btrim_blancs(f.label))
	 where f.id in (
		select v.field_id from public.card_common_field_values v where v.card_id = any (v_scope.card_ids)
		union select q.common_field_id from public.workflow_transition_required_common_fields q
		        join public.workflow_transitions tr on tr.id = q.transition_id
		       where tr.workflow_id = any (v_scope.workflow_ids || v_copies))
	 order by f.id, (t.type = f.type) desc nulls last, t.archived_at nulls first, t.id;

	-- Les étiquettes : par leur nom ; une archivée de l'arrivée compte.
	return query
	select distinct on (l.id) 'label'::text, l.id, l.name, t.id, t.name, case when t.id is null then 'create' else 'reuse' end
	  from public.labels l
	  left join public.labels t on t.workspace_id = p_target and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(l.name))
	 where l.id in (select cl.label_id from public.card_labels cl where cl.card_id = any (v_scope.card_ids))
	 order by l.id, t.archived_at nulls first, t.id;

	-- Les contacts : par leur e-mail, sinon par leur nom (décision 968).
	return query
	select distinct on (c.id) 'contact'::text, c.id, c.full_name, t.id, t.full_name,
	       case when t.id is null then 'create' else 'reuse' end
	  from public.contacts c
	  left join public.contacts t
	         on t.workspace_id = p_target
	        and case when c.email is not null then lower(t.email) = lower(c.email)
	                 else t.email is null and lower(app.btrim_blancs(t.full_name)) = lower(app.btrim_blancs(c.full_name)) end
	 where c.id in (
		select cc.contact_id from public.card_contacts cc where cc.card_id = any (v_scope.card_ids)
		union select p.contact_id from public.card_activity_participants p
		        join public.card_activities a on a.id = p.activity_id
		       where a.card_id = any (v_scope.card_ids) and p.contact_id is not null)
	 order by c.id, t.created_at, t.id;

	-- Les organisations des contacts CRÉÉS : par leur domaine, sinon par leur nom.
	return query
	select distinct on (o.id) 'organization'::text, o.id, o.name, t.id, t.name,
	       case when t.id is null then 'create' else 'reuse' end
	  from public.organizations o
	  left join public.organizations t
	         on t.workspace_id = p_target
	        and case when o.domain is not null then lower(t.domain) = lower(o.domain)
	                 else lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(o.name)) end
	 where o.id in (
		select c.organization_id from public.contacts c
		 where c.organization_id is not null
		   and c.id in (
			select cc.contact_id from public.card_contacts cc where cc.card_id = any (v_scope.card_ids)
			union select p.contact_id from public.card_activity_participants p
			        join public.card_activities a on a.id = p.activity_id
			       where a.card_id = any (v_scope.card_ids) and p.contact_id is not null)
		   and not exists (
			select 1 from public.contacts t
			 where t.workspace_id = p_target
			   and case when c.email is not null then lower(t.email) = lower(c.email)
			            else t.email is null and lower(app.btrim_blancs(t.full_name)) = lower(app.btrim_blancs(c.full_name)) end))
	 order by o.id, t.created_at, t.id;

	-- Les pastilles des mails : par leur nom.
	return query
	select distinct on (l.id) 'mail_label'::text, l.id, l.name, t.id, t.name, case when t.id is null then 'create' else 'reuse' end
	  from public.mail_labels l
	  left join public.mail_labels t on t.workspace_id = p_target and lower(t.name) = lower(l.name)
	 where l.id in (select x.label_id from public.mail_message_labels x where x.message_id = any (v_scope.message_ids))
	 order by l.id, t.id;

	-- Les séquences des relances closes, puis les modèles des séquences CRÉÉES.
	return query
	select distinct on (s.id) 'sequence'::text, s.id, s.name, t.id, t.name, case when t.id is null then 'create' else 'reuse' end
	  from public.mail_sequences s
	  left join public.mail_sequences t
	         on t.workspace_id = p_target and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(s.name))
	 where s.id in (select e.sequence_id from public.card_sequence_enrollments e where e.card_id = any (v_scope.card_ids))
	 order by s.id, t.id;

	return query
	select distinct on (m.id) 'template'::text, m.id, m.name, t.id, t.name, case when t.id is null then 'create' else 'reuse' end
	  from public.mail_templates m
	  left join public.mail_templates t
	         on t.workspace_id = p_target and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(m.name))
	 where m.id in (
		select st.template_id from public.mail_sequence_steps st
		 where st.template_id is not null
		   and st.sequence_id in (
			select s.id from public.mail_sequences s
			 where s.id in (select e.sequence_id from public.card_sequence_enrollments e where e.card_id = any (v_scope.card_ids))
			   and not exists (select 1 from public.mail_sequences t where t.workspace_id = p_target
			                     and lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(s.name)))))
	 order by m.id, t.id;
end;
$$;

-- =============================================================================================
-- 7. Les refus — §4 (rien n'est écrit)
-- =============================================================================================

-- Les personnes CITÉES par le périmètre (décision 968) : toute colonne qui référence `profiles` dans une table qui bouge
-- (§3.1, §3.2). La liste des colonnes est tirée du graphe des clés étrangères au 2026-11-21.
create or replace function app.track_move_people(p_track_id uuid)
returns table (profile_id uuid, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v record;
begin
	select * into v from app.track_move_scope(p_track_id);
	return query
	select x.pid, x.src from (
		select t.deleted_by as pid, 'tracks' as src from public.tracks t where t.id = p_track_id
		union all select c.deleted_by, 'channels' from public.channels c where c.id = any (v.channel_ids)
		union all select wv.published_by, 'workflow_versions' from public.workflow_versions wv where wv.workflow_id = any (v.workflow_ids)
		union all select i.created_by, 'workflow_step_checklist_items' from public.workflow_step_checklist_items i where i.workflow_id = any (v.workflow_ids)
		union all select ct.created_by, 'card_templates' from public.card_templates ct where ct.workflow_id = any (v.workflow_ids)
		union all select s.created_by, 'suggestions_ia' from public.suggestions_ia s where s.workflow_id = any (v.workflow_ids)
		union all select s.decided_by, 'suggestions_ia' from public.suggestions_ia s where s.workflow_id = any (v.workflow_ids)
		union all select r.created_by, 'suggestions_ia_revisions' from public.suggestions_ia_revisions r
		            join public.suggestions_ia s on s.id = r.suggestion_id where s.workflow_id = any (v.workflow_ids)
		union all select c.created_by, 'cards' from public.cards c where c.id = any (v.card_ids)
		union all select c.deleted_by, 'cards' from public.cards c where c.id = any (v.card_ids)
		union all select p.created_by, 'card_placements' from public.card_placements p where p.card_id = any (v.card_ids)
		union all select p.owner_id, 'card_placements' from public.card_placements p where p.card_id = any (v.card_ids)
		union all select f.updated_by, 'card_field_values' from public.card_field_values f where f.card_id = any (v.card_ids)
		union all select i.checked_by, 'card_checklist_items' from public.card_checklist_items i where i.card_id = any (v.card_ids)
		union all select i.created_by, 'card_checklist_items' from public.card_checklist_items i where i.card_id = any (v.card_ids)
		union all select f.updated_by, 'card_common_field_values' from public.card_common_field_values f where f.card_id = any (v.card_ids)
		union all select l.created_by, 'card_labels' from public.card_labels l where l.card_id = any (v.card_ids)
		union all select c.author_id, 'card_comments' from public.card_comments c where c.card_id = any (v.card_ids)
		union all select c.deleted_by, 'card_comments' from public.card_comments c where c.card_id = any (v.card_ids)
		union all select m.profile_id, 'card_comment_mentions' from public.card_comment_mentions m
		            join public.card_comments c on c.id = m.comment_id where c.card_id = any (v.card_ids)
		union all select a.author_id, 'card_activities' from public.card_activities a where a.card_id = any (v.card_ids)
		union all select a.deleted_by, 'card_activities' from public.card_activities a where a.card_id = any (v.card_ids)
		union all select p.profile_id, 'card_activity_participants' from public.card_activity_participants p
		            join public.card_activities a on a.id = p.activity_id where a.card_id = any (v.card_ids)
		-- L'auteur d'un déplacement n'est pas une personne du track : l'événement `track_moved` ne le cite pas.
		union all select e.actor_id, 'card_events' from public.card_events e
		           where e.card_id = any (v.card_ids) and e.type <> 'track_moved'
		union all select e.armed_by, 'card_sequence_enrollments' from public.card_sequence_enrollments e where e.card_id = any (v.card_ids)
		union all select s.profile_id, 'saisies_temps' from public.saisies_temps s
		           where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)
		union all select s.created_by, 'saisies_temps' from public.saisies_temps s
		           where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)
		union all select s.updated_by, 'saisies_temps' from public.saisies_temps s
		           where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)
		union all select sv.owner_id, 'saved_views' from public.saved_views sv where sv.channel_id = any (v.channel_ids)
		union all select w.created_by, 'webhook_endpoints' from public.webhook_endpoints w where w.channel_id = any (v.channel_ids)
		union all select m.classified_by, 'mail_messages' from public.mail_messages m where m.id = any (v.message_ids)
		union all select m.deleted_by, 'mail_messages' from public.mail_messages m where m.id = any (v.message_ids)
		union all select l.set_by, 'mail_message_labels' from public.mail_message_labels l where l.message_id = any (v.message_ids)
		union all select t.recipient_id, 'mail_message_transfers' from public.mail_message_transfers t where t.message_id = any (v.message_ids)
		union all select t.transferred_by, 'mail_message_transfers' from public.mail_message_transfers t where t.message_id = any (v.message_ids)
		union all select t.requested_by, 'mail_trash_moves' from public.mail_trash_moves t where t.message_id = any (v.message_ids)
		union all select r.user_id, 'mail_message_reads' from public.mail_message_reads r where r.message_id = any (v.message_ids)
		union all select k.user_id, 'mail_attachment_risk_acknowledgments' from public.mail_attachment_risk_acknowledgments k
		            join public.mail_attachments a on a.id = k.attachment_id where a.message_id = any (v.message_ids)
		union all select z.snoozed_by, 'mail_thread_snoozes' from public.mail_thread_snoozes z
		           where (z.workspace_id, z.thread_key) in (
				select m.workspace_id, app.cle_fil(m.references_ids, m.rfc822_message_id)
				  from public.mail_messages m where m.id = any (v.message_ids))
		union all select o.created_by, 'mail_outbox' from public.mail_outbox o where o.card_id = any (v.card_ids)
		union all select o.cancelled_by, 'mail_outbox' from public.mail_outbox o where o.card_id = any (v.card_ids)
		union all select d.created_by, 'mail_drafts' from public.mail_drafts d where d.card_id = any (v.card_ids)
		union all select n.recipient_id, 'notifications' from public.notifications n where n.subject_card_id = any (v.card_ids)
		union all select b.created_by, 'budgets' from public.budgets b where b.track_id = p_track_id
		union all select c.created_by, 'card_costs' from public.card_costs c where c.card_id = any (v.card_ids)
		union all select c.settled_by, 'card_costs' from public.card_costs c where c.card_id = any (v.card_ids)
		union all select a.created_by, 'card_cost_actuals' from public.card_cost_actuals a
		            join public.card_costs c on c.id = a.card_cost_id where c.card_id = any (v.card_ids)
		union all select r.created_by, 'card_revenues' from public.card_revenues r where r.card_id = any (v.card_ids)
		union all select r.settled_by, 'card_revenues' from public.card_revenues r where r.card_id = any (v.card_ids)
		union all select a.created_by, 'card_revenue_actuals' from public.card_revenue_actuals a
		            join public.card_revenues r on r.id = a.card_revenue_id where r.card_id = any (v.card_ids)
		union all select m.user_id, 'track_members' from public.track_members m where m.track_id = p_track_id
		union all select m.user_id, 'channel_members' from public.channel_members m where m.channel_id = any (v.channel_ids)
	) x
	where x.pid is not null;
end;
$$;
revoke all on function app.track_move_people(uuid) from public, anon, authenticated;

-- Tous les refus, chacun avec sa liste. Vide : le déplacement est permis.
create or replace function app.track_move_refusals(p_track_id uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_track   public.tracks%rowtype;
	v         record;
	v_refus   jsonb := '[]'::jsonb;
	v_liste   jsonb;
begin
	select * into v_track from public.tracks t where t.id = p_track_id;
	select * into v from app.track_move_scope(p_track_id);

	if v_track.workspace_id = p_target then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'same_workspace', 'items', '[]'::jsonb));
	end if;

	if v_track.deleted_at is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'track_trashed', 'items', '[]'::jsonb));
	end if;

	select jsonb_agg(jsonb_build_object('track_id', t.id, 'name', t.name, 'slug', t.slug) order by t.name) into v_liste
	  from public.tracks t
	 where t.workspace_id = p_target and t.id <> p_track_id
	   and (lower(app.btrim_blancs(t.name)) = lower(app.btrim_blancs(v_track.name)) or t.slug = v_track.slug);
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'homonym_track', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('card_id', c.id, 'title', c.title, 'other_tracks', autres.noms) order by c.title, c.id)
	  into v_liste
	  from public.cards c
	  join lateral (
		select jsonb_agg(distinct tr.name) as noms
		  from public.card_placements pl
		  join public.channels ch on ch.id = pl.channel_id
		  join public.tracks tr on tr.id = ch.track_id
		 where pl.card_id = c.id and ch.track_id <> p_track_id) autres on autres.noms is not null
	 where c.id = any (v.card_ids);
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'shared_card', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name, 'sources', x.sources) order by p.full_name, p.id)
	  into v_liste
	  from (select pp.profile_id, jsonb_agg(distinct pp.source) as sources
	          from app.track_move_people(p_track_id) pp
	         where not exists (select 1 from public.workspace_members m
	                            where m.workspace_id = p_target and m.user_id = pp.profile_id)
	         group by pp.profile_id) x
	  join public.profiles p on p.id = x.profile_id;
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'non_member', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('card_id', c.id, 'title', c.title, 'sequence', s.name) order by c.title, c.id) into v_liste
	  from public.card_sequence_enrollments e
	  join public.cards c on c.id = e.card_id
	  join public.mail_sequences s on s.id = e.sequence_id
	 where e.card_id = any (v.card_ids) and e.status = 'active';
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'armed_sequence', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('card_id', c.id, 'title', c.title, 'subject', o.subject) order by c.title, o.created_at)
	  into v_liste
	  from public.mail_outbox o join public.cards c on c.id = o.card_id
	 where o.card_id = any (v.card_ids) and o.status in ('queued', 'sending');
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'queued_send', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('card_id', c.id, 'title', c.title, 'subject', d.subject) order by c.title, d.created_at)
	  into v_liste
	  from public.mail_drafts d join public.cards c on c.id = d.card_id
	 where d.card_id = any (v.card_ids) and d.status = 'pending';
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'pending_draft', 'items', v_liste));
	end if;

	select jsonb_agg(jsonb_build_object('field', f.label, 'type', f.type, 'target_type', t.type) order by f.label) into v_liste
	  from app.track_move_matches(p_track_id, p_target) m
	  join public.card_common_fields f on f.id = m.source_id
	  join public.card_common_fields t on t.id = m.target_id
	 where m.family = 'common_field' and m.action = 'conflict';
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'field_type_conflict', 'items', v_liste));
	end if;

	-- Le plafond de 420 minutes par personne et par jour, à l'arrivée (décision 969).
	select jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'name', p.full_name, 'day', x.jour, 'minutes', x.total)
	                 order by p.full_name, x.jour) into v_liste
	  from (
		select s.profile_id, s.jour, sum(s.minutes) as total
		  from public.saisies_temps s
		 where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)
		    or (s.workspace_id = p_target
		        and (s.profile_id, s.jour) in (
				select d.profile_id, d.jour from public.saisies_temps d
				 where d.track_id = p_track_id or d.channel_id = any (v.channel_ids) or d.card_id = any (v.card_ids)))
		 group by s.profile_id, s.jour
		having sum(s.minutes) > 420) x
	  join public.profiles p on p.id = x.profile_id;
	if v_liste is not null then
		v_refus := v_refus || jsonb_build_array(jsonb_build_object('code', 'daily_cap_exceeded', 'items', v_liste));
	end if;

	return v_refus;
end;
$$;
revoke all on function app.track_move_refusals(uuid, uuid) from public, anon, authenticated;

-- =============================================================================================
-- 8. L'aperçu — §5 (rien n'est écrit)
-- =============================================================================================

create or replace function public.track_move_preview(p_track_id uuid, p_target_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_track public.tracks%rowtype;
	v_from  public.workspaces%rowtype;
	v_to    public.workspaces%rowtype;
	v       record;
	v_refs  jsonb;
	v_costs jsonb;
	v_sans  jsonb;
	v_dups  jsonb;
begin
	perform app.exiger_superadmin();
	select * into v_track from public.tracks t where t.id = p_track_id;
	if v_track.id is null then
		perform app.raise_http_error(404, 'track_not_found');
	end if;
	select * into v_to from public.workspaces w where w.id = p_target_workspace_id;
	if v_to.id is null then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	select * into v_from from public.workspaces w where w.id = v_track.workspace_id;
	select * into v from app.track_move_scope(p_track_id);

	select coalesce(jsonb_object_agg(f.family, f.listes), '{}'::jsonb) into v_refs
	  from (
		select m.family, jsonb_build_object(
			'reused', coalesce(jsonb_agg(jsonb_build_object('source', m.source_name, 'target', m.target_name)
			                               order by m.source_name) filter (where m.action = 'reuse'), '[]'::jsonb),
			'created', coalesce(jsonb_agg(jsonb_build_object('source', m.source_name, 'target', coalesce(m.target_name, m.source_name))
			                               order by m.source_name) filter (where m.action = 'create'), '[]'::jsonb)) as listes
		  from app.track_move_matches(p_track_id, p_target_workspace_id) m
		 group by m.family) f;

	-- La valeur des temps déplacés, au coût du départ puis de l'arrivée, par devise (décision 966) : la règle de
	-- `temps_valorise`, le coût en vigueur le jour de la saisie, pour la personne, dans l'espace dit.
	with deplaces as (
		select s.* from public.saisies_temps s
		 where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)),
	valeurs as (
		select e.espace, c.devise, sum(round(d.minutes * c.cout_quart / 105, 2)) as montant
		  from deplaces d
		 cross join (values ('from', v_from.id), ('to', p_target_workspace_id)) e(espace, ws)
		  join lateral (select cp.cout_quart, cp.devise from public.couts_personnel cp
		                 where cp.workspace_id = e.ws and cp.profile_id = d.profile_id and cp.date_effet <= d.jour
		                 order by cp.date_effet desc limit 1) c on true
		 group by e.espace, c.devise)
	select jsonb_build_object(
		'minutes', (select coalesce(sum(d.minutes), 0) from deplaces d),
		'from', coalesce((select jsonb_agg(jsonb_build_object('currency', x.devise, 'amount', x.montant) order by x.devise)
		                    from valeurs x where x.espace = 'from'), '[]'::jsonb),
		'to', coalesce((select jsonb_agg(jsonb_build_object('currency', x.devise, 'amount', x.montant) order by x.devise)
		                  from valeurs x where x.espace = 'to'), '[]'::jsonb))
	  into v_costs;

	select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.full_name) order by p.full_name, p.id) into v_sans
	  from public.profiles p
	 where p.id in (select s.profile_id from public.saisies_temps s
	                 where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids))
	   and not exists (select 1 from public.couts_personnel cp where cp.workspace_id = p_target_workspace_id and cp.profile_id = p.id);

	-- Les mails déjà présents à l'arrivée (décision 972).
	select jsonb_agg(jsonb_build_object('subject', m.subject, 'received_at', m.received_at,
	                                    'target_card', tc.title, 'kept_in_card', t.card_id is null) order by m.received_at)
	  into v_dups
	  from public.mail_messages m
	  join public.mail_messages t on t.workspace_id = p_target_workspace_id and t.rfc822_message_id = m.rfc822_message_id
	  left join public.cards tc on tc.id = t.card_id
	 where m.id = any (v.message_ids);

	return jsonb_build_object(
		'track', jsonb_build_object('id', v_track.id, 'name', v_track.name, 'slug', v_track.slug),
		'from', jsonb_build_object('id', v_from.id, 'name', v_from.name, 'slug', v_from.slug),
		'to', jsonb_build_object('id', v_to.id, 'name', v_to.name, 'slug', v_to.slug, 'inbound_domain', v_to.inbound_domain),
		'counts', jsonb_build_object(
			'channels', pg_catalog.cardinality(v.channel_ids),
			'cards', pg_catalog.cardinality(v.card_ids),
			'messages', pg_catalog.cardinality(v.message_ids),
			'attachments', (select count(*) from public.mail_attachments a where a.message_id = any (v.message_ids)),
			'comments', (select count(*) from public.card_comments c where c.card_id = any (v.card_ids) and c.deleted_at is null),
			'time_entries', (select count(*) from public.saisies_temps s
			                  where s.track_id = p_track_id or s.channel_id = any (v.channel_ids) or s.card_id = any (v.card_ids)),
			'budgets', (select count(*) from public.budgets b where b.track_id = p_track_id),
			'costs', (select count(*) from public.card_costs c where c.card_id = any (v.card_ids)),
			'revenues', (select count(*) from public.card_revenues r where r.card_id = any (v.card_ids)),
			'webhooks', (select count(*) from public.webhook_endpoints w where w.channel_id = any (v.channel_ids)),
			'views', (select count(*) from public.saved_views s where s.channel_id = any (v.channel_ids))),
		'referentials', v_refs,
		'costs', v_costs || jsonb_build_object('without_cost', coalesce(v_sans, '[]'::jsonb)),
		'duplicates', coalesce(v_dups, '[]'::jsonb),
		'addresses', jsonb_build_object('inbound_domain', v_to.inbound_domain, 'cards', pg_catalog.cardinality(v.card_ids)),
		'refusals', app.track_move_refusals(p_track_id, p_target_workspace_id));
end;
$$;

comment on function public.track_move_preview(uuid, uuid) is
	'CRM-162 §5 — l''aperçu chiffré du déplacement d''un track vers un espace : ce qui part, les référentiels réutilisés et '
	'créés, la valeur des temps au départ et à l''arrivée, les mails déjà présents, les refus. N''écrit rien. '
	'Super-administrateur seul.';

revoke all on function public.track_move_preview(uuid, uuid) from public, anon;
grant execute on function public.track_move_preview(uuid, uuid) to authenticated;

-- =============================================================================================
-- 9. La copie d'un workflow commun — §7.3
-- =============================================================================================

-- Copie un workflow commun à l'espace d'arrivée, avec son graphe : étapes (nœuds appariés), champs, règles, points de
-- checklist, transitions et leurs exigences. Les correspondances sont posées dans `tm_map` (step, field, step_item,
-- transition). Les versions publiées, modèles et suggestions restent au workflow d'origine : la copie est une structure.
create or replace function app.track_move_copy_workflow(p_source uuid, p_target uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_new uuid;
	r     record;
	v_id  uuid;
begin
	insert into public.workflows (workspace_id, name, scope, is_default)
	select p_target, p_name, 'global', false from public.workflows w where w.id = p_source
	returning id into v_new;

	for r in select * from public.workflow_steps s where s.workflow_id = p_source order by s.position loop
		insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, label_override, probability_override,
		                                   stale_after_days, is_initial, description_override)
		values (v_new, p_target, (select m.target_id from pg_temp.tm_map m where m.family = 'node' and m.source_id = r.node_id),
		        r.position, r.label_override, r.probability_override, r.stale_after_days, r.is_initial, r.description_override)
		returning id into v_id;
		insert into pg_temp.tm_map values ('step', r.id, v_id);
	end loop;

	for r in select * from public.form_fields f where f.workflow_id = p_source loop
		insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at)
		values (v_new, p_target, r.key, r.label, r.type, r.options, r.help_text, r.position, r.archived_at)
		returning id into v_id;
		insert into pg_temp.tm_map values ('field', r.id, v_id);
	end loop;

	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	select (select m.target_id from pg_temp.tm_map m where m.family = 'field' and m.source_id = x.field_id),
	       (select m.target_id from pg_temp.tm_map m where m.family = 'step' and m.source_id = x.step_id),
	       v_new, p_target, x.visibility
	  from public.form_field_rules x where x.workflow_id = p_source;

	for r in select * from public.workflow_step_checklist_items i where i.workflow_id = p_source loop
		insert into public.workflow_step_checklist_items (workspace_id, workflow_id, step_id, label, position, archived_at, created_by)
		values (p_target, v_new, (select m.target_id from pg_temp.tm_map m where m.family = 'step' and m.source_id = r.step_id),
		        r.label, r.position, r.archived_at, r.created_by)
		returning id into v_id;
		insert into pg_temp.tm_map values ('step_item', r.id, v_id);
	end loop;

	for r in select * from public.workflow_transitions t where t.workflow_id = p_source loop
		insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment)
		values (v_new, p_target,
		        (select m.target_id from pg_temp.tm_map m where m.family = 'step' and m.source_id = r.from_step_id),
		        (select m.target_id from pg_temp.tm_map m where m.family = 'step' and m.source_id = r.to_step_id),
		        r.label, r.require_comment)
		returning id into v_id;
		insert into pg_temp.tm_map values ('transition', r.id, v_id);
	end loop;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select (select m.target_id from pg_temp.tm_map m where m.family = 'transition' and m.source_id = q.transition_id),
	       (select m.target_id from pg_temp.tm_map m where m.family = 'field' and m.source_id = q.field_id)
	  from public.workflow_transition_required_fields q
	  join public.workflow_transitions t on t.id = q.transition_id
	 where t.workflow_id = p_source;

	insert into public.workflow_transition_required_checklist_items (transition_id, step_item_id)
	select (select m.target_id from pg_temp.tm_map m where m.family = 'transition' and m.source_id = q.transition_id),
	       (select m.target_id from pg_temp.tm_map m where m.family = 'step_item' and m.source_id = q.step_item_id)
	  from public.workflow_transition_required_checklist_items q
	  join public.workflow_transitions t on t.id = q.transition_id
	 where t.workflow_id = p_source;

	insert into public.workflow_transition_required_common_fields (transition_id, common_field_id, workspace_id)
	select (select m.target_id from pg_temp.tm_map m where m.family = 'transition' and m.source_id = q.transition_id),
	       coalesce((select m.target_id from pg_temp.tm_map m where m.family = 'common_field' and m.source_id = q.common_field_id),
	                q.common_field_id),
	       p_target
	  from public.workflow_transition_required_common_fields q
	  join public.workflow_transitions t on t.id = q.transition_id
	 where t.workflow_id = p_source;

	insert into pg_temp.tm_map values ('workflow', p_source, v_new);
	return v_new;
end;
$$;
revoke all on function app.track_move_copy_workflow(uuid, uuid, text) from public, anon, authenticated;

-- Un workflow commun RÉUTILISÉ : ses étapes s'apparient par leur rang (la signature les a dites identiques), ses champs par
-- leur clé, ses points de checklist par l'étape et le libellé.
create or replace function app.track_move_map_workflow(p_source uuid, p_target_workflow uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	insert into pg_temp.tm_map
	select 'step', s.id, t.id
	  from (select s.id, row_number() over (order by s.position, s.id) as rang from public.workflow_steps s where s.workflow_id = p_source) s
	  join (select t.id, row_number() over (order by t.position, t.id) as rang from public.workflow_steps t where t.workflow_id = p_target_workflow) t
	    on t.rang = s.rang;
	insert into pg_temp.tm_map
	select 'field', f.id, t.id
	  from public.form_fields f join public.form_fields t on t.workflow_id = p_target_workflow and t.key = f.key
	 where f.workflow_id = p_source;
	insert into pg_temp.tm_map
	select 'step_item', i.id, t.id
	  from public.workflow_step_checklist_items i
	  join pg_temp.tm_map m on m.family = 'step' and m.source_id = i.step_id
	  join public.workflow_step_checklist_items t
	    on t.step_id = m.target_id and lower(app.btrim_blancs(t.label)) = lower(app.btrim_blancs(i.label)) and t.archived_at is null
	 where i.workflow_id = p_source
	on conflict do nothing;
	insert into pg_temp.tm_map values ('workflow', p_source, p_target_workflow);
end;
$$;
revoke all on function app.track_move_map_workflow(uuid, uuid) from public, anon, authenticated;

-- =============================================================================================
-- 10. Le déplacement — §6, en une transaction
-- =============================================================================================

create or replace function public.move_track(p_track_id uuid, p_target_workspace_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_track  public.tracks%rowtype;
	v_from   uuid;
	v        record;
	v_refus  jsonb;
	r        record;
	v_new    uuid;
	v_cle    text;
	v_bilan  jsonb;
	v_acteur uuid;
	v_claims text;
begin
	perform app.exiger_superadmin();
	v_acteur := auth.uid();
	select * into v_track from public.tracks t where t.id = p_track_id for update;
	if v_track.id is null then
		perform app.raise_http_error(404, 'track_not_found');
	end if;
	if not exists (select 1 from public.workspaces w where w.id = p_target_workspace_id) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	if app.btrim_blancs(coalesce(p_confirm_name, '')) is distinct from app.btrim_blancs(v_track.name) then
		raise exception 'confirmation_mismatch' using errcode = '22023';
	end if;
	v_from := v_track.workspace_id;
	select * into v from app.track_move_scope(p_track_id);

	-- Les verrous : rien ne se crée entre l'aperçu et l'écriture que l'aperçu n'a pas vu.
	perform 1 from public.channels c where c.id = any (v.channel_ids) order by c.id for update;
	perform 1 from public.cards c where c.id = any (v.card_ids) order by c.id for update;

	v_refus := app.track_move_refusals(p_track_id, p_target_workspace_id);
	if jsonb_array_length(v_refus) > 0 then
		raise exception 'track_move_refused' using errcode = '22023', detail = v_refus::text;
	end if;

	-- Le drapeau de la transaction (décision 969), et les clés composites différées. LES LIGNES DÉPLACÉES S'ÉCRIVENT SANS
	-- IDENTITÉ DE REQUÊTE : un déclencheur qui pose son auteur (`updated_by := v_acteur`) les attribuerait sinon au
	-- super-administrateur, qui deviendrait une « personne citée » et bloquerait le retour (relevé au premier essai). L'acteur
	-- est gardé, et le journal le nomme.
	v_claims := pg_catalog.current_setting('request.jwt.claims', true);
	perform pg_catalog.set_config('request.jwt.claims', '', true);
	perform pg_catalog.set_config('app.track_move', 'on', true);
	set constraints all deferred;

	-- Les tables de travail de la transaction ; un second déplacement dans la même transaction les recrée.
	drop table if exists pg_temp.tm_map;
	drop table if exists pg_temp.tm_matches;
	create temporary table tm_map (family text, source_id uuid, target_id uuid, primary key (family, source_id)) on commit drop;
	create temporary table tm_matches on commit drop as
	select * from app.track_move_matches(p_track_id, p_target_workspace_id);
	insert into pg_temp.tm_map
	select m.family, m.source_id, m.target_id from pg_temp.tm_matches m where m.action = 'reuse' and m.family <> 'workflow';

	-- Les référentiels créés, dans l'ordre de leurs dépendances (§7).
	for r in select * from pg_temp.tm_matches m where m.family = 'node' and m.action = 'create' loop
		insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability,
		                                           default_stale_after_days, position, description)
		select p_target_workspace_id, n.key, n.label, n.kind, n.color, n.default_probability, n.default_stale_after_days,
		       n.position, n.description
		  from public.workflow_nodes_catalog n where n.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('node', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'common_field' and m.action = 'create' loop
		select f.key into v_cle from public.card_common_fields f where f.id = r.source_id;
		if exists (select 1 from public.card_common_fields t where t.workspace_id = p_target_workspace_id and t.key = v_cle) then
			v_cle := v_cle || '-' || substr(md5(r.source_id::text), 1, 4);
		end if;
		insert into public.card_common_fields (workspace_id, key, label, type, options, help_text, is_listed, position)
		select p_target_workspace_id, v_cle, f.label, f.type, f.options, f.help_text, f.is_listed, f.position
		  from public.card_common_fields f where f.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('common_field', r.source_id, v_new);
	end loop;
	-- Un champ de liste réutilisé reçoit les choix absents (§7.1) : une valeur déplacée y reste valide.
	update public.card_common_fields t
	   set options = jsonb_set(t.options, '{choices}',
	         coalesce(t.options -> 'choices', '[]'::jsonb) || coalesce((
	           select jsonb_agg(c) from jsonb_array_elements(f.options -> 'choices') c
	            where not exists (select 1 from jsonb_array_elements(t.options -> 'choices') d where d ->> 'key' = c ->> 'key')),
	           '[]'::jsonb))
	  from pg_temp.tm_matches m
	  join public.card_common_fields f on f.id = m.source_id
	 where m.family = 'common_field' and m.action = 'reuse' and t.id = m.target_id
	   and jsonb_typeof(f.options -> 'choices') = 'array';

	for r in select * from pg_temp.tm_matches m where m.family = 'label' and m.action = 'create' loop
		insert into public.labels (workspace_id, name, color, created_by)
		select p_target_workspace_id, l.name, l.color, v_acteur from public.labels l where l.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('label', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'organization' and m.action = 'create' loop
		insert into public.organizations (workspace_id, name, domain, website)
		select p_target_workspace_id, o.name, o.domain, o.website from public.organizations o where o.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('organization', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'contact' and m.action = 'create' loop
		insert into public.contacts (workspace_id, organization_id, full_name, email, phone, role_title, source)
		select p_target_workspace_id,
		       (select x.target_id from pg_temp.tm_map x where x.family = 'organization' and x.source_id = c.organization_id),
		       c.full_name, c.email, c.phone, c.role_title, c.source
		  from public.contacts c where c.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('contact', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'mail_label' and m.action = 'create' loop
		insert into public.mail_labels (workspace_id, name, color, description, hidden, archived_at, created_by)
		select p_target_workspace_id, l.name, l.color, l.description, l.hidden, l.archived_at, v_acteur
		  from public.mail_labels l where l.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('mail_label', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'template' and m.action = 'create' loop
		insert into public.mail_templates (workspace_id, name, subject, body_text, created_by)
		select p_target_workspace_id, t.name, t.subject, t.body_text, v_acteur from public.mail_templates t where t.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('template', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'sequence' and m.action = 'create' loop
		insert into public.mail_sequences (workspace_id, name, created_by)
		select p_target_workspace_id, s.name, v_acteur from public.mail_sequences s where s.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('sequence', r.source_id, v_new);
		insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
		select p_target_workspace_id, v_new, st.position, st.delai_jours,
		       coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'template' and x.source_id = st.template_id),
		                st.template_id)
		  from public.mail_sequence_steps st where st.sequence_id = r.source_id;
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'workflow' loop
		if r.action = 'reuse' then
			perform app.track_move_map_workflow(r.source_id, r.target_id);
		else
			perform app.track_move_copy_workflow(r.source_id, p_target_workspace_id, r.target_name);
		end if;
	end loop;

	-- Les lignes déplacées (§3.1), des parents aux enfants ; les clés composites se contrôlent à la fin.
	update public.tracks set workspace_id = p_target_workspace_id where id = p_track_id;
	update public.channels c
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = c.workflow_id),
	                              c.workflow_id)
	 where c.id = any (v.channel_ids);

	update public.workflows set workspace_id = p_target_workspace_id where id = any (v.workflow_ids);
	update public.workflow_steps s
	   set workspace_id = p_target_workspace_id,
	       node_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'node' and x.source_id = s.node_id), s.node_id)
	 where s.workflow_id = any (v.workflow_ids);
	update public.workflow_transitions set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_versions set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.form_fields set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.form_field_rules set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_step_checklist_items set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_transition_required_common_fields q
	   set workspace_id = p_target_workspace_id,
	       common_field_id = coalesce((select x.target_id from pg_temp.tm_map x
	                                    where x.family = 'common_field' and x.source_id = q.common_field_id), q.common_field_id)
	 where q.transition_id in (select t.id from public.workflow_transitions t where t.workflow_id = any (v.workflow_ids));
	update public.card_templates set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.suggestions_ia_revisions set workspace_id = p_target_workspace_id
	 where suggestion_id in (select s.id from public.suggestions_ia s where s.workflow_id = any (v.workflow_ids));
	update public.suggestions_ia set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);

	update public.cards set workspace_id = p_target_workspace_id where id = any (v.card_ids);
	update public.card_placements p
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = p.workflow_id),
	                              p.workflow_id),
	       current_step_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'step' and x.source_id = p.current_step_id),
	                                  p.current_step_id)
	 where p.card_id = any (v.card_ids);
	update public.card_field_values f
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = f.workflow_id),
	                              f.workflow_id),
	       field_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'field' and x.source_id = f.field_id),
	                           f.field_id)
	 where f.card_id = any (v.card_ids);
	update public.card_checklist_items i
	   set workspace_id = p_target_workspace_id,
	       step_item_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'step_item' and x.source_id = i.step_item_id),
	                               i.step_item_id)
	 where i.card_id = any (v.card_ids);
	update public.card_common_field_values f
	   set workspace_id = p_target_workspace_id,
	       field_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'common_field' and x.source_id = f.field_id),
	                           f.field_id)
	 where f.card_id = any (v.card_ids);
	update public.card_labels l
	   set workspace_id = p_target_workspace_id,
	       label_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'label' and x.source_id = l.label_id), l.label_id)
	 where l.card_id = any (v.card_ids);
	update public.card_contacts c
	   set workspace_id = p_target_workspace_id,
	       contact_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'contact' and x.source_id = c.contact_id),
	                             c.contact_id)
	 where c.card_id = any (v.card_ids);
	update public.card_comment_mentions m set workspace_id = p_target_workspace_id
	 where m.comment_id in (select c.id from public.card_comments c where c.card_id = any (v.card_ids));
	update public.card_comments set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_activity_participants p
	   set contact_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'contact' and x.source_id = p.contact_id),
	                             p.contact_id)
	 where p.activity_id in (select a.id from public.card_activities a where a.card_id = any (v.card_ids)) and p.contact_id is not null;
	update public.card_activities set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_events set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_sequence_enrollments e
	   set workspace_id = p_target_workspace_id,
	       sequence_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'sequence' and x.source_id = e.sequence_id),
	                              e.sequence_id)
	 where e.card_id = any (v.card_ids);
	update public.saisies_temps set workspace_id = p_target_workspace_id
	 where track_id = p_track_id or channel_id = any (v.channel_ids) or card_id = any (v.card_ids);
	update public.saved_views set workspace_id = p_target_workspace_id where channel_id = any (v.channel_ids);
	update public.webhook_deliveries set workspace_id = p_target_workspace_id
	 where endpoint_id in (select w.id from public.webhook_endpoints w where w.channel_id = any (v.channel_ids));
	update public.webhook_endpoints set workspace_id = p_target_workspace_id where channel_id = any (v.channel_ids);

	-- Les mails déjà présents à l'arrivée (décision 972) : l'exemplaire d'arrivée est gardé, classé dans l'affaire s'il ne
	-- l'est nulle part ; les envois qui citent l'exemplaire de départ le citent désormais, puis il est retiré.
	for r in select m.id as depart, t.id as arrivee, t.card_id as carte_arrivee, m.card_id, m.classification, m.classified_at
	           from public.mail_messages m
	           join public.mail_messages t on t.workspace_id = p_target_workspace_id and t.rfc822_message_id = m.rfc822_message_id
	          where m.id = any (v.message_ids) loop
		if r.carte_arrivee is null then
			update public.mail_messages set card_id = r.card_id, classification = r.classification,
			       classified_at = coalesce(r.classified_at, now())
			 where id = r.arrivee;
		end if;
		update public.mail_outbox set sent_message_id = r.arrivee where sent_message_id = r.depart;
		update public.mail_outbox set in_reply_to_message_id = r.arrivee where in_reply_to_message_id = r.depart;
		update public.mail_drafts set in_reply_to_message_id = r.arrivee where in_reply_to_message_id = r.depart;
		delete from public.mail_messages where id = r.depart;
	end loop;

	update public.mail_thread_snoozes z set workspace_id = p_target_workspace_id
	 where z.workspace_id = v_from
	   and z.thread_key in (select app.cle_fil(m.references_ids, m.rfc822_message_id) from public.mail_messages m
	                         where m.id = any (v.message_ids))
	   and not exists (select 1 from public.mail_thread_snoozes y where y.workspace_id = p_target_workspace_id and y.thread_key = z.thread_key);
	update public.mail_message_labels l
	   set workspace_id = p_target_workspace_id,
	       label_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'mail_label' and x.source_id = l.label_id),
	                           l.label_id)
	 where l.message_id = any (v.message_ids);
	update public.mail_label_evaluations set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_message_transfers set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_trash_moves set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_messages set workspace_id = p_target_workspace_id where id = any (v.message_ids);
	update public.mail_outbox set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.mail_drafts set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.notifications set workspace_id = p_target_workspace_id where subject_card_id = any (v.card_ids);

	-- Les adresses (§8) : l'ancienne aboutit par l'alias de l'espace quitté ; revenir dans un espace retire son alias.
	delete from public.card_address_aliases a where a.workspace_id = p_target_workspace_id and a.card_id = any (v.card_ids);
	insert into public.card_address_aliases (workspace_id, email_local_part, card_id)
	select v_from, c.email_local_part, c.id from public.cards c where c.id = any (v.card_ids) and c.email_local_part is not null
	on conflict (workspace_id, email_local_part) do update set card_id = excluded.card_id;

	-- Les clés différées se contrôlent ici, pour un refus lisible plutôt qu'un échec au commit.
	set constraints all immediate;
	perform pg_catalog.set_config('app.track_move', 'off', true);
	perform pg_catalog.set_config('request.jwt.claims', coalesce(v_claims, ''), true);

	-- Le journal (§10).
	v_bilan := jsonb_build_object(
		'channels', pg_catalog.cardinality(v.channel_ids),
		'cards', pg_catalog.cardinality(v.card_ids),
		'messages', pg_catalog.cardinality(v.message_ids),
		'reused', (select count(*) from pg_temp.tm_matches m where m.action = 'reuse'),
		'created', (select count(*) from pg_temp.tm_matches m where m.action = 'create'));
	insert into public.track_moves (track_id, track_slug, from_workspace_id, to_workspace_id, moved_by)
	values (p_track_id, v_track.slug, v_from, p_target_workspace_id, v_acteur);
	insert into public.plateforme_journal (acteur, geste, workspace_id, cible)
	values (v_acteur, 'track_moved', p_target_workspace_id,
	        jsonb_build_object('track_id', p_track_id, 'track_name', v_track.name, 'from', v_from, 'to', p_target_workspace_id)
	        || v_bilan);
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	select c.id, p_target_workspace_id, 'track_moved', v_acteur,
	       jsonb_build_object('track', v_track.name, 'from', v_from, 'to', p_target_workspace_id)
	  from public.cards c where c.id = any (v.card_ids);

	return v_bilan || jsonb_build_object('track_id', p_track_id, 'from', v_from, 'to', p_target_workspace_id);
end;
$$;

comment on function public.move_track(uuid, uuid, text) is
	'CRM-162 §6 — déplace un track entier vers un espace, en une transaction : refus recalculés, référentiels retrouvés '
	'ou créés, lignes déplacées, alias d''adresses, journal. Super-administrateur seul ; la saisie du nom confirme.';

revoke all on function public.move_track(uuid, uuid, text) from public, anon;
grant execute on function public.move_track(uuid, uuid, text) to authenticated;


-- =============================================================================================
-- 11. La redirection d'une ancienne adresse — §12
-- =============================================================================================

create or replace function public.track_current_address(p_workspace_slug text, p_track_slug text)
returns table (workspace_slug text, track_slug text)
language sql
stable
security invoker
set search_path = ''
as $$
	select w.slug, t.slug
	  from (select m.track_id
	          from public.track_moves m
	          join public.workspaces d on d.id = m.from_workspace_id
	         where d.slug = p_workspace_slug and m.track_slug = p_track_slug
	         order by m.moved_at desc, m.id desc
	         limit 1) dernier
	  join public.tracks t on t.id = dernier.track_id
	  join public.workspaces w on w.id = t.workspace_id;
$$;
comment on function public.track_current_address(text, text) is
	'CRM-162 §12 — l''adresse actuelle d''un track déplacé depuis un espace, si l''appelant le lit (RLS de tracks).';
revoke all on function public.track_current_address(text, text) from public, anon;
grant execute on function public.track_current_address(text, text) to authenticated;

-- =============================================================================================
-- 12. Un mail adressé à une ancienne adresse — §8
-- =============================================================================================

-- Fait passer un mail JUSTE RELEVÉ dans l'espace de son affaire : ses lignes propres le suivent, ses pastilles sont
-- retirées (elles appartiennent à l'espace de départ, et la passe d'évaluation de l'arrivée le reprend). Un exemplaire déjà
-- présent à l'arrivée est gardé (décision 972) : le mail de départ est retiré, et l'identifiant rendu est celui d'arrivée.
create or replace function app.move_message_to_workspace(p_message_id uuid, p_target uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
	v_doublon uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.workspace_id = p_target then
		return p_message_id;
	end if;
	select t.id into v_doublon from public.mail_messages t
	 where t.workspace_id = p_target and t.rfc822_message_id = v_message.rfc822_message_id;
	if v_doublon is not null then
		delete from public.mail_messages where id = p_message_id;
		return v_doublon;
	end if;
	perform pg_catalog.set_config('app.track_move', 'on', true);
	delete from public.mail_message_labels where message_id = p_message_id;
	update public.mail_label_evaluations set workspace_id = p_target, state = 'pending', attempts = 0,
	       next_attempt_at = now(), last_error = null
	 where message_id = p_message_id;
	update public.mail_message_transfers set workspace_id = p_target where message_id = p_message_id;
	update public.mail_messages set workspace_id = p_target where id = p_message_id;
	perform pg_catalog.set_config('app.track_move', 'off', true);
	return p_message_id;
end;
$$;
revoke all on function app.move_message_to_workspace(uuid, uuid) from public, anon, authenticated;

create or replace function public.classer_message_automatiquement(p_message_id uuid, p_in_reply_to text DEFAULT NULL::text, p_references text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message         public.mail_messages%rowtype;
	v_card            uuid;
	v_cards_suggerees uuid[];
	v_suggestion      uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	-- `CRM-156` T2 (§32.8) : un message EN CORBEILLE n'est pas classé — c'est le cas d'un mail d'un expéditeur bloqué, posé
	-- directement en corbeille par `app.mail_messages_expediteur_bloque`. Ni classement, ni suggestion, ni événement.
	if v_message.deleted_at is not null then
		return null;
	end if;

	-- Un message DÉJÀ classé n'est pas reclassé : la règle 1 a parlé une fois, et un second
	-- passage de la relève ne doit pas déplacer du courrier.
	if v_message.classification <> 'unclassified' then
		return v_message.card_id;
	end if;

	-- RÈGLE 1 — une adresse de card figure parmi les destinataires.
	v_card := app.card_par_adresse(
		v_message.workspace_id,
		v_message.to_addresses || v_message.cc_addresses
	);

	-- `CRM-162` (§8) — RÈGLE 1 BIS : une ANCIENNE adresse d'une affaire déplacée, alias de l'espace du message. Le message
	-- passe alors dans l'espace de l'affaire, puis la règle 1 s'y applique.
	if v_card is null then
		select a.card_id into v_card
		  from public.card_address_aliases a
		  join public.workspaces w on w.id = a.workspace_id
		 where a.workspace_id = v_message.workspace_id
		   and lower(a.email_local_part || '@' || w.inbound_domain) = any (
		         select lower(btrim(adresse)) from unnest(v_message.to_addresses || v_message.cc_addresses) as adresse)
		 limit 1;
		if v_card is not null then
			p_message_id := app.move_message_to_workspace(p_message_id,
			                  (select c.workspace_id from public.cards c where c.id = v_card));
			select * into v_message from public.mail_messages m where m.id = p_message_id;
			-- La règle 1 l'aurait exigé : l'affaire reçoit si l'un de ses rattachements est actif et qu'elle n'est pas
			-- à la corbeille. L'alias suffit, même sans domaine à l'arrivée (§5, « addresses »).
			if not exists (select 1 from public.cards c
			                where c.id = v_card and c.deleted_at is null and app.card_has_active_placement(c.id)) then
				v_card := null;
			end if;
			-- Déjà classé à l'arrivée (un exemplaire gardé, décision 972) : il n'est pas reclassé.
			if v_message.classification <> 'unclassified' then
				return v_message.card_id;
			end if;
		end if;
	end if;

	-- RÈGLE 2 — la filiation, et seulement si la règle 1 n'a rien dit.
	if v_card is null and (p_in_reply_to is not null or p_references is not null) then
		select m.card_id into v_card
		  from public.mail_messages m
		 where m.workspace_id = v_message.workspace_id
		   and m.card_id is not null
		   and m.rfc822_message_id = any (
		         coalesce(p_references, array[]::text[]) ||
		         case when p_in_reply_to is null then array[]::text[] else array[p_in_reply_to] end
		       )
		 order by m.received_at desc
		 limit 1;

		-- La card du parent peut avoir été archivée depuis : la règle 2 hérite alors du refus de
		-- la règle 1, faute de quoi la filiation contournerait la règle du §16.2.
		if v_card is not null and not exists (
			select 1 from public.cards c
			 where c.id = v_card and app.card_has_active_placement(c.id) and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 3 — l'expéditeur est un contact rattaché à EXACTEMENT UNE card active : on SUGGÈRE, on
	-- ne classe pas. Atteinte seulement quand les règles 1 et 2 sont muettes. L'unicité partielle
	-- (workspace_id, lower(email)) de `contacts` garantit AU PLUS un contact par email ; l'ambiguïté
	-- à trancher est donc du côté des CARDS. Une card archivée ou en corbeille ne compte pas, comme
	-- la règle 1 refuse de classer dans une card rangée (§16.2, docs/SPEC-contacts.md §8.2).
	if v_card is null then
		select array_agg(distinct cc.card_id)
		  into v_cards_suggerees
		  from public.contacts ct
		  join public.card_contacts cc
		    on cc.contact_id = ct.id and cc.workspace_id = ct.workspace_id
		  join public.cards c
		    on c.id = cc.card_id and c.workspace_id = cc.workspace_id
		 where ct.workspace_id = v_message.workspace_id
		   and ct.email is not null
		   and lower(ct.email) = lower(btrim(v_message.from_address))
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null;

		-- EXACTEMENT une : zéro n'invente rien, deux ou plus se tait plutôt que de choisir au
		-- hasard. On écrit la suggestion calculée — ou on l'efface —, de sorte qu'un second passage
		-- de la relève rende un résultat déterministe (docs/SPEC-contacts.md §8.3).
		if v_cards_suggerees is not null and array_length(v_cards_suggerees, 1) = 1 then
			v_suggestion := v_cards_suggerees[1];
		else
			v_suggestion := null;
		end if;

		update public.mail_messages m
		   set suggested_card_id = v_suggestion,
		       suggested_at = case when v_suggestion is null then null else now() end
		 where m.id = p_message_id;

		-- RÈGLE 4 — la règle 3 ne classe pas : le message reste non classé. Ce n'est pas une erreur.
		return null;
	end if;

	update public.mail_messages m
	   set card_id = v_card,
	       classification = 'auto',
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		v_card,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'auto')
	);

	-- Les pièces jointes suivent leur message : `card_id` y est recopié pour un accès direct
	-- depuis la card (docs/SCHEMA.md §12).
	update public.mail_attachments a set card_id = v_card where a.message_id = p_message_id;

	return v_card;
end;
$function$;

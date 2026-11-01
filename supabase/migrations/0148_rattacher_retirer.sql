-- @spec CRM-111 (docs/BACKLOG.md) — tranche T3 : rattacher et retirer
-- @spec docs/SPEC-rattachements.md §3.1 (une affaire, plusieurs rattachements, un par channel), §4 (« Rattacher » : écrire
--       l'affaire et le channel cible ; « Retirer » : administrateur, jamais le dernier), §5 (`attach_card`,
--       `detach_card`, la timeline et ses deux valeurs `attached` et `detached`) ; docs/SCHEMA.md « Migration `0148` » ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 639, 642, 643, 658, 661 et 802
-- @spec CRM-071 (docs/BACKLOG.md) — tranche T6 : la création importée garde sa marque `source: import`
--       (docs/SPEC-vues-import-export.md, « Le fil »), la définition de la 0138 étant celle dont la réécriture part
--
-- LA TRANSITION SE CLÔT ICI. Depuis la 108, `card_placements_one_per_card_idx` tenait un rattachement par affaire, le
-- temps de la bascule (T2). Il tombe : une affaire peut désormais être rattachée à plusieurs channels, un seul
-- rattachement par channel (`card_placements_card_channel_key`, inchangé). Les lectures qui situent l'affaire par son
-- PLUS ANCIEN rattachement restent justes ; leurs lectures à plusieurs rattachements sont T4 à T7.

-- =============================================================================================
-- 1. Plusieurs rattachements par affaire
-- =============================================================================================

drop index if exists public.card_placements_one_per_card_idx;

-- =============================================================================================
-- 2. Le fil : deux valeurs de plus, `attached` et `detached` (§5), dans le même changement que ce qui les écrit
-- =============================================================================================

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check
	check (type in ('created', 'moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                'trashed', 'restored', 'field_changed', 'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed',
	                'woken', 'stalled', 'contact_linked', 'contact_unlinked', 'contact_role_changed',
	                'checklist_checked', 'checklist_unchecked', 'label_added', 'label_removed', 'attached', 'detached'));

-- Les deux valeurs sont des événements de RATTACHEMENT : elles portent `placement_id`, comme `moved` ou `archived`. La
-- contrainte qui lie le type à la présence du rattachement (migrations 0109 et 0125) les reçoit dans le même changement.
alter table public.card_events drop constraint if exists card_events_placement_by_type;
alter table public.card_events add constraint card_events_placement_by_type
	check ((type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived', 'snoozed',
	                 'woken', 'stalled', 'field_changed', 'attached', 'detached')) = (placement_id is not null));

-- =============================================================================================
-- 3. La naissance d'un rattachement : `created` pour le premier, `attached` pour les suivants
-- =============================================================================================

-- Le premier rattachement d'une affaire porte sa création (décision 770), marquée `source: import` quand l'import l'a
-- posée (migration 0138, `CRM-071` T6 : la définition en base, dont celle-ci part) ; un rattachement de plus porte
-- `attached`, désigné par `placement_id` comme les autres événements de rattachement (§5).
create or replace function app.card_placements_evenement_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
	if not exists (select 1 from public.card_placements p where p.card_id = new.card_id and p.id <> new.id) then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'created',
			pg_catalog.jsonb_build_object(
				'title',      (select c.title from public.cards c where c.id = new.card_id),
				'channel_id', new.channel_id,
				'step_id',    new.current_step_id)
			|| case when pg_catalog.current_setting('app.card_creation_source', true) = 'import'
			        then pg_catalog.jsonb_build_object('source', 'import') else '{}'::jsonb end);
	else
		insert into public.card_events (card_id, workspace_id, type, actor_id, payload, placement_id)
		values (new.card_id, new.workspace_id, 'attached',
		        (select pr.id from public.profiles pr where pr.id = auth.uid()),
		        jsonb_build_object('channel_id', new.channel_id, 'step_id', new.current_step_id),
		        new.id);
	end if;
	return null;
end;
$fn$;
revoke all on function app.card_placements_evenement_creation() from public, anon, authenticated;

-- =============================================================================================
-- 4. Rattacher — `attach_card(p_card, p_channel)` (§5, décision 643)
-- =============================================================================================

-- Le rattachement naît à l'ÉTAPE INITIALE du workflow du channel, bloc vide. Si l'affaire a déjà un rattachement à ce
-- channel, ARCHIVÉ, il est désarchivé tel quel (son étape, son bloc, ses valeurs) ; actif, le geste est refusé.
-- Refus, dans cet ordre — aucun ne révèle ce que l'appelant ne lit pas :
--   `card_not_found`     l'affaire n'existe pas, est à la corbeille, ou n'est pas lisible ;
--   `forbidden` (42501)  l'appelant n'écrit pas l'affaire (§4 : un channel rattaché écrit suffit) ;
--   `channel_not_found`  le channel n'existe pas, n'est pas lisible, ou n'est pas de l'espace de l'affaire ;
--   `channel_closed`     le channel est archivé ou à la corbeille, comme pour `creer_affaire` ;
--   `forbidden` (42501)  l'appelant n'écrit pas le channel cible ;
--   `already_attached`   l'affaire a déjà un rattachement actif à ce channel.
create or replace function public.attach_card(p_card uuid, p_channel uuid)
returns public.card_placements
language plpgsql
security definer
set search_path = ''
as $fn$
declare
	v_carte     public.cards%rowtype;
	v_channel   public.channels%rowtype;
	v_existant  public.card_placements%rowtype;
	v_etape     uuid;
	v_place     public.card_placements%rowtype;
begin
	select c.* into v_carte
	  from public.cards c
	 where c.id = p_card
	   and c.deleted_at is null
	   and app.can_read_card(c.id);
	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.can_write_card(v_carte.id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select ch.* into v_channel
	  from public.channels ch
	 where ch.id = p_channel
	   and ch.workspace_id = v_carte.workspace_id
	   and app.can_read_channel(ch.id);
	if not found then
		raise exception 'channel_not_found';
	end if;

	if v_channel.archived_at is not null or v_channel.deleted_at is not null then
		raise exception 'channel_closed';
	end if;

	if not app.can_write_channel(v_channel.id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select p.* into v_existant
	  from public.card_placements p
	 where p.card_id = v_carte.id and p.channel_id = v_channel.id;
	if found then
		if v_existant.archived_at is null then
			raise exception 'already_attached';
		end if;
		-- Désarchivé tel quel : le déclencheur du rattachement écrit `unarchived`.
		update public.card_placements p set archived_at = null where p.id = v_existant.id
		returning p.* into v_place;
		return v_place;
	end if;

	select s.id into v_etape
	  from public.workflow_steps s
	 where s.workflow_id = v_channel.workflow_id and s.is_initial;
	if v_etape is null then
		raise exception 'step_not_initial' using errcode = '22023';
	end if;

	-- Le rang est attribué par `card_placements_attribuer_position` ; l'événement `attached`, par la naissance du
	-- rattachement (§3 ci-dessus) ; les points de checklist de l'étape, par `card_placements_add_step_items`.
	insert into public.card_placements (workspace_id, card_id, channel_id, workflow_id, current_step_id, created_by)
	values (v_carte.workspace_id, v_carte.id, v_channel.id, v_channel.workflow_id, v_etape,
	        (select pr.id from public.profiles pr where pr.id = auth.uid()))
	returning * into v_place;
	return v_place;
end;
$fn$;

-- =============================================================================================
-- 5. Retirer — `detach_card(p_placement, discard_field_values)` (§4, §5, décision 643)
-- =============================================================================================

-- Réservé à l'administrateur de l'espace, et jamais sur le DERNIER rattachement d'une affaire — archivés compris :
-- l'invariant du §3.1 le refuserait de toute façon à la validation, le geste le dit avant. Les valeurs de bloc du
-- rattachement partent avec lui ; leur perte exige `discard_field_values`, selon la doctrine de `move_card_to_channel`
-- (décision 216). L'événement `detached` est écrit par le geste, AVANT le retrait, avec le rattachement retiré : une
-- purge qui emporte des rattachements avec leur channel (décision 802) n'est pas un retrait, et n'en écrit pas.
-- Refus, dans cet ordre :
--   `card_not_found`              le rattachement n'existe pas, son affaire est à la corbeille, ou il n'est pas lisible ;
--   `forbidden` (42501)           l'appelant n'est pas administrateur de l'espace ;
--   `last_placement`              c'est le dernier rattachement de l'affaire ;
--   `field_values_would_be_lost`  des valeurs de bloc seraient perdues, sans `discard_field_values`.
create or replace function public.detach_card(p_placement uuid, discard_field_values boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
	v_place   public.card_placements%rowtype;
	v_valeurs integer;
begin
	select p.* into v_place
	  from public.card_placements p
	  join public.cards c on c.id = p.card_id
	 where p.id = p_placement
	   and c.deleted_at is null
	   and app.can_read_channel(p.channel_id);
	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.is_workspace_admin(v_place.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (select 1 from public.card_placements autre
	                where autre.card_id = v_place.card_id and autre.id <> v_place.id) then
		raise exception 'last_placement';
	end if;

	select count(*) into v_valeurs from public.card_field_values v where v.placement_id = v_place.id;
	if v_valeurs > 0 and not coalesce(discard_field_values, false) then
		raise exception 'field_values_would_be_lost'
			using detail = format('%s réponse(s) de formulaire seraient perdues.', v_valeurs);
	end if;

	insert into public.card_events (card_id, workspace_id, type, actor_id, payload, placement_id)
	values (v_place.card_id, v_place.workspace_id, 'detached',
	        (select pr.id from public.profiles pr where pr.id = auth.uid()),
	        jsonb_build_object('channel_id', v_place.channel_id, 'step_id', v_place.current_step_id),
	        v_place.id);

	delete from public.card_placements p where p.id = v_place.id;
end;
$fn$;

-- =============================================================================================
-- 6. Privilèges
-- =============================================================================================

do $$
declare
	f text;
begin
	foreach f in array array['public.attach_card(uuid, uuid)', 'public.detach_card(uuid, boolean)'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon', f);
		execute pg_catalog.format('grant execute on function %s to authenticated, service_role', f);
	end loop;
end;
$$;

notify pgrst, 'reload schema';

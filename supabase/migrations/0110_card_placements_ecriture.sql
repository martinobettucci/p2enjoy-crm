-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3, étape 0 : la fondation des écritures par rattachement (décision
--       705). docs/SPEC-rattachements.md §4 (écrire un rattachement, c'est écrire son channel), §5 (timeline), §14 ;
--       docs/JOURNAL.md décisions 661, 670, 705
-- @spec docs/SCHEMA.md « Migration `0110` », §5 (card_placements, card_events) ; docs/PROD_MIGRATIONS.md §3
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS. Elle rend `card_placements` écrivable sans qu'aucun appelant
-- ne change encore : (1) la timeline d'un rattachement — étape, channel, workflow, responsable, archivage, sommeil — est
-- écrite par les déclencheurs de `card_placements`, et non plus par ceux de `cards`, qui ne gardent que la corbeille ;
-- (2) un MIROIR INVERSE reporte sur `cards` toute écriture d'un rattachement, tant que des lecteurs lisent encore ces
-- colonnes sur `cards` ; (3) `authenticated` reçoit la mise à jour des sept colonnes qu'il écrit aujourd'hui sur
-- l'affaire, sous une politique qui exige d'écrire le channel du rattachement. Les gestes passent ensuite au
-- rattachement, groupe par groupe (T2.3), et chacun retire sa signature par affaire dans le même changement.
--
-- LES DEUX MIROIRS NE BOUCLENT PAS. Le miroir de `cards` (T2.1) ne se lance que si une colonne de rattachement de
-- l'affaire CHANGE ; le miroir inverse n'écrit `cards` que si elle DIFFÈRE du rattachement. Une écriture d'un côté rend
-- donc l'autre égal, et le second passage ne trouve plus rien à écrire.
--
-- IDEMPOTENCE : `create or replace`, déclencheurs et politique recréés, privilèges reposés.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : réappliquer `app.card_events_apres_maj_card` et
-- `app.card_events_apres_maj_sommeil` de la migration 0042 et leurs deux déclencheurs, retirer les déclencheurs et
-- fonctions de cette migration, la politique et le privilège de mise à jour. Aucune donnée n'est touchée.

-- ===========================================================================================================
-- 1. La timeline d'un rattachement est écrite par `card_placements`
-- ===========================================================================================================

-- Le même vocabulaire, les mêmes charges utiles, le même ordre que les deux déclencheurs de `cards` qu'il remplace
-- (`card_events_apres_maj`, puis `card_events_apres_maj_sommeil`). L'événement désigne le rattachement
-- (`card_events_fill_placement` le pose depuis l'affaire tant qu'elle n'en a qu'un ; il est ici posé explicitement).
create or replace function app.card_placements_write_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_acteur uuid := (select p.id from public.profiles p where p.id = auth.uid());
begin
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
$$;
revoke all on function app.card_placements_write_events() from public, anon, authenticated;

drop trigger if exists card_placements_write_events on public.card_placements;
create trigger card_placements_write_events
	after update on public.card_placements
	for each row
	when ((old.channel_id, old.workflow_id, old.current_step_id, old.owner_id, old.archived_at, old.snoozed_until)
	      is distinct from
	      (new.channel_id, new.workflow_id, new.current_step_id, new.owner_id, new.archived_at, new.snoozed_until))
	execute function app.card_placements_write_events();

-- `cards` ne garde que les événements de l'AFFAIRE : la corbeille. La création reste écrite par
-- `card_events_apres_insertion` jusqu'à ce que `creer_affaire` écrive le rattachement elle-même.
create or replace function app.card_events_apres_maj_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.deleted_at is distinct from old.deleted_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.deleted_at is null then 'restored' else 'trashed' end,
			'{}'::jsonb);
	end if;

	return null;
end;
$$;

drop trigger if exists card_events_apres_maj_sommeil on public.cards;
drop function if exists app.card_events_apres_maj_sommeil();

-- ===========================================================================================================
-- 2. Le miroir inverse : un rattachement écrit, son affaire suit
-- ===========================================================================================================

create or replace function app.card_placements_mirror_to_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.cards c
	   set channel_id           = new.channel_id,
	       workflow_id          = new.workflow_id,
	       current_step_id      = new.current_step_id,
	       position             = new.position,
	       owner_id             = new.owner_id,
	       amount               = new.amount,
	       probability_override = new.probability_override,
	       next_action          = new.next_action,
	       next_action_at       = new.next_action_at,
	       entered_step_at      = new.entered_step_at,
	       health_score         = new.health_score,
	       snoozed_until        = new.snoozed_until,
	       archived_at          = new.archived_at
	 where c.id = new.card_id
	   and (c.channel_id, c.workflow_id, c.current_step_id, c.position, c.owner_id, c.amount,
	        c.probability_override, c.next_action, c.next_action_at, c.entered_step_at, c.health_score,
	        c.snoozed_until, c.archived_at)
	       is distinct from
	       (new.channel_id, new.workflow_id, new.current_step_id, new.position, new.owner_id, new.amount,
	        new.probability_override, new.next_action, new.next_action_at, new.entered_step_at, new.health_score,
	        new.snoozed_until, new.archived_at);
	return null;
end;
$$;
revoke all on function app.card_placements_mirror_to_card() from public, anon, authenticated;

drop trigger if exists card_placements_mirror_to_card on public.card_placements;
create trigger card_placements_mirror_to_card
	after update on public.card_placements
	for each row
	when ((old.channel_id, old.workflow_id, old.current_step_id, old.position, old.owner_id, old.amount,
	       old.probability_override, old.next_action, old.next_action_at, old.entered_step_at, old.health_score,
	       old.snoozed_until, old.archived_at)
	      is distinct from
	      (new.channel_id, new.workflow_id, new.current_step_id, new.position, new.owner_id, new.amount,
	       new.probability_override, new.next_action, new.next_action_at, new.entered_step_at, new.health_score,
	       new.snoozed_until, new.archived_at))
	execute function app.card_placements_mirror_to_card();

-- ===========================================================================================================
-- 3. L'écriture d'un rattachement par un client (docs/SPEC-rattachements.md §4)
-- ===========================================================================================================

-- Les sept colonnes qu'un client écrit aujourd'hui sur l'affaire. L'étape, le channel, le workflow et le sommeil
-- restent aux fonctions (`move_card`, `move_card_to_channel`, `change_channel_workflow`, `snooze_card`, `wake_card`).
revoke all on public.card_placements from authenticated;
grant select on public.card_placements to authenticated;
grant update (position, owner_id, amount, probability_override, next_action, next_action_at, archived_at)
	on public.card_placements to authenticated;

drop policy if exists card_placements_update on public.card_placements;
create policy card_placements_update on public.card_placements
	for update to authenticated
	using (app.can_write_channel(channel_id))
	with check (app.can_write_channel(channel_id));

-- La capacité lue par l'interface (`CRM-093`), comme celle de l'affaire.
create or replace function public.ecriture_permise(p public.card_placements)
returns boolean
language sql
stable
set search_path = ''
as $$
	select app.can_write_channel(p.channel_id);
$$;
revoke all on function public.ecriture_permise(public.card_placements) from public;
grant execute on function public.ecriture_permise(public.card_placements) to anon, authenticated, service_role;

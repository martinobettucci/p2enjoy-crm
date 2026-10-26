-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.4 : changer de channel un rattachement (décision 705).
--       docs/SPEC-rattachements.md §5 (« Déplacer vers un autre channel : `move_card_to_channel(p_placement, to_channel_id,
--       to_step_id, discard_field_values)` — signature remplacée ; déplace un rattachement ; refusé si l'affaire est déjà
--       rattachée au channel cible »), §3.3, §14 ; docs/SPEC-workflow-engine.md §6 (le déplacement inter-workflow, ses
--       refus et leur ordre, la perte assumée des réponses — décision 216) ; docs/JOURNAL.md décisions 661, 705, 731
-- @spec docs/SCHEMA.md « Migration `0117` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3
--
-- LA SIGNATURE EST REMPLACÉE, NON SURCHARGÉE (décision 661) : `move_card_to_channel(p_placement, …)` désigne le
-- rattachement et le rend ; la forme par affaire est supprimée. La garde est celle de `CRM-045` (migration 0017), dans le
-- même ordre et avec les mêmes messages, mais chaque vérification porte sur le RATTACHEMENT : son channel d'origine, son
-- workflow, son étape, ses valeurs (`card_field_values.placement_id`, T2.2). UNE GARDE NOUVELLE, après `same_channel` :
-- `already_attached`, quand un AUTRE rattachement de la même affaire est déjà sur le channel cible (décision
-- 731) — tant qu'une affaire n'a qu'un rattachement, elle ne peut pas se déclencher ; elle précède la contrainte
-- `card_placements_card_channel_key`, dont le 23505 n'est pas un message de produit.
--
-- L'ÉCRITURE porte sur `card_placements`, EN UNE SEULE INSTRUCTION (channel, workflow, étape, position) : la clé
-- `card_placements_step_fk (current_step_id, workflow_id)` n'est pas différable. L'événement `channel_changed` est écrit
-- par la table du rattachement (T2.3.0), et le miroir recopie le tout sur `cards` en une instruction, elle aussi.
-- Les réponses du rattachement sont supprimées AVANT, quand le workflow change : la clé
-- `card_field_values (card_id, workflow_id) → cards` refuserait sinon le miroir.
--
-- IDEMPOTENCE : `drop function if exists` de la forme par affaire, puis `create or replace`.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : supprimer la fonction et réappliquer celle de la migration 0017, avec les
-- appelants d'avant.

drop function if exists public.move_card_to_channel(uuid, uuid, uuid, boolean);

create or replace function public.move_card_to_channel(
	p_placement          uuid,
	to_channel_id        uuid,
	to_step_id           uuid    default null,
	discard_field_values boolean default false
) returns public.card_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Recopiés avant tout usage : `to_channel_id` et `to_step_id` sont aussi des noms de colonnes (42702).
	v_channel   uuid := to_channel_id;
	v_etape     uuid := to_step_id;
	v_placement public.card_placements%rowtype;
	v_cible     public.channels%rowtype;
	v_valeurs   integer;
begin
	-- 1 Le rattachement existe, est actif, son affaire hors de la corbeille, son channel lisible — sinon `card_not_found`,
	-- jamais `forbidden` (§4.3 : ne pas confirmer l'existence).
	select p.* into v_placement
	  from public.card_placements p
	  join public.cards c on c.id = p.card_id
	 where p.id = p_placement
	   and p.archived_at is null
	   and c.deleted_at is null
	   and app.can_read_channel(p.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- 2 L'appelant écrit le channel D'ORIGINE (preuve de refus n° 1).
	if not app.can_write_channel(v_placement.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 3 Le channel cible existe et est lisible — sinon `channel_not_found` : pas d'oracle d'existence.
	select ch.* into v_cible
	  from public.channels ch
	 where ch.id = v_channel
	   and app.can_read_channel(ch.id);

	if not found then
		raise exception 'channel_not_found';
	end if;

	-- 4 L'appelant écrit le channel CIBLE.
	if not app.can_write_channel(v_cible.id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 5 Le channel cible n'est pas celui du rattachement : un `channel_changed` sans changement serait une trace fausse.
	if v_cible.id = v_placement.channel_id then
		raise exception 'same_channel';
	end if;

	-- 5 bis — décision 731 : l'affaire n'est pas déjà rattachée au channel cible par un AUTRE rattachement
	-- (docs/SPEC-rattachements.md §5). Le channel cible est lisible (3) : la réponse ne révèle rien.
	if exists (
		select 1 from public.card_placements autre
		 where autre.card_id = v_placement.card_id
		   and autre.channel_id = v_cible.id
	) then
		raise exception 'already_attached';
	end if;

	-- 6 Le remappage est obligatoire quand le workflow change ; sinon l'étape est conservée.
	if v_cible.workflow_id is distinct from v_placement.workflow_id and v_etape is null then
		raise exception 'step_mapping_required';
	end if;

	v_etape := coalesce(v_etape, v_placement.current_step_id);

	-- 7 L'étape appartient au workflow du channel cible.
	if not exists (
		select 1 from public.workflow_steps s
		 where s.id = v_etape and s.workflow_id = v_cible.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- 8 Les réponses du RATTACHEMENT, et leur perte assumée (décision 216) : jamais sans `discard_field_values`.
	if v_cible.workflow_id is distinct from v_placement.workflow_id then
		select count(*) into v_valeurs
		  from public.card_field_values v
		 where v.placement_id = p_placement;

		if v_valeurs > 0 and not coalesce(discard_field_values, false) then
			raise exception 'field_values_would_be_lost'
				using detail = format('%s réponse(s) de formulaire seraient perdues.', v_valeurs);
		end if;

		if v_valeurs > 0 then
			delete from public.card_field_values v where v.placement_id = p_placement;
		end if;
	end if;

	-- 9 L'écriture, en une instruction. `entered_step_at` ne change que si l'étape change (décision 217) ; la position
	-- est toujours recalculée, sa portée étant le couple (channel, étape).
	update public.card_placements p
	   set channel_id      = v_cible.id,
	       workflow_id     = v_cible.workflow_id,
	       current_step_id = v_etape,
	       entered_step_at = case
	           when v_etape is distinct from v_placement.current_step_id then now()
	           else p.entered_step_at
	       end,
	       position        = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.card_placements autre
	            where autre.channel_id      = v_cible.id
	              and autre.current_step_id = v_etape
	       )
	 where p.id = p_placement
	returning p.* into v_placement;

	return v_placement;
end;
$$;

revoke all on function public.move_card_to_channel(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.move_card_to_channel(uuid, uuid, uuid, boolean) to authenticated, service_role;

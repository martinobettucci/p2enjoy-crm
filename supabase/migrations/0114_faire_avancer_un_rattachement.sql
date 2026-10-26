-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.3 : faire avancer un rattachement (décision 705). docs/SPEC-rattachements.md
--       §5 (« Faire avancer : `move_card(p_placement, to_step_id, comment)` — signature remplacée ; les champs exigés se
--       lisent sur ses valeurs »), §3.3, §14 ; docs/SPEC-workflow-engine.md §5 (la garde centrale de transition, ses six
--       vérifications et leur ordre) ; docs/JOURNAL.md décisions 661, 705
-- @spec docs/SCHEMA.md « Migration `0114` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3
--
-- LA SIGNATURE EST REMPLACÉE, NON SURCHARGÉE (décision 661) : `move_card(p_placement, to_step_id, comment)` désigne le
-- rattachement et le rend ; la forme par affaire est supprimée. La garde est celle de `CRM-034` et `CRM-036`, au mot près :
-- même ordre, mêmes messages — `card_not_found`, `forbidden`, `step_not_in_workflow`, `transition_not_allowed`,
-- `comment_required`, `comment_too_long`, `missing_required_fields` —, mais chaque vérification porte sur le
-- RATTACHEMENT : son channel, son workflow, son étape, et ses valeurs (`card_field_values.placement_id`, T2.2). Le motif
-- reste un commentaire de l'AFFAIRE. L'événement `moved` est écrit par la table du rattachement (T2.3.0).
--
-- IDEMPOTENCE : `drop function if exists` de la forme par affaire, puis `create or replace`.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : supprimer la fonction et réappliquer celle de la migration 0035, avec les
-- appelants d'avant.

drop function if exists public.move_card(uuid, uuid, text);

create or replace function public.move_card(
	p_placement uuid,
	to_step_id  uuid,
	comment     text default null
) returns public.card_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cible      uuid := to_step_id;
	-- INC-052, décision 374 : la classe des blancs est celle d'`app.btrim_blancs`.
	v_comment    text := nullif(app.btrim_blancs(comment), '');
	v_placement  public.card_placements%rowtype;
	v_transition public.workflow_transitions%rowtype;
	v_manquants  text[];
begin
	-- 1 Le rattachement existe, est actif, son affaire hors de la corbeille, son channel lisible.
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

	-- 2 L'appelant écrit le channel du rattachement.
	if not app.can_write_channel(v_placement.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 3 L'étape cible appartient au workflow du rattachement.
	if not exists (
		select 1 from public.workflow_steps s
		 where s.id = v_cible and s.workflow_id = v_placement.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- 4 Une transition déclarée relie l'étape courante à la cible.
	select t.* into v_transition
	  from public.workflow_transitions t
	 where t.workflow_id = v_placement.workflow_id
	   and t.from_step_id = v_placement.current_step_id
	   and t.to_step_id = v_cible;

	if not found then
		raise exception 'transition_not_allowed';
	end if;

	-- 5 Le motif, s'il est exigé.
	if v_transition.require_comment and v_comment is null then
		raise exception 'comment_required';
	end if;

	-- 5 bis — INC-048, décision 374 : le motif est un commentaire, il en a les bornes.
	if v_comment is not null and length(v_comment) > 10000 then
		raise exception 'comment_too_long'
			using errcode = 'P0001',
			      detail  = 'Un motif de transition est un commentaire : 10 000 caractères au plus.';
	end if;

	-- 6 Les champs exigés à l'étape cible ou par la transition, lus sur les valeurs du RATTACHEMENT.
	select array_agg(f.key order by f.position, f.key)
	  into v_manquants
	  from public.form_fields f
	 where f.workflow_id = v_placement.workflow_id
	   and f.archived_at is null
	   and (
	       exists (
	           select 1
	             from public.form_field_rules r
	            where r.field_id = f.id
	              and r.step_id = v_cible
	              and r.visibility = 'required'
	       )
	       or exists (
	           select 1
	             from public.workflow_transition_required_fields trf
	            where trf.transition_id = v_transition.id
	              and trf.field_id = f.id
	       )
	   )
	   and not exists (
	       select 1
	         from public.card_field_values v
	        where v.placement_id = p_placement
	          and v.field_id = f.id
	          and not app.valeur_de_champ_est_vide(v.value)
	   );

	if v_manquants is not null and array_length(v_manquants, 1) > 0 then
		raise exception 'missing_required_fields'
			using detail = array_to_string(v_manquants, ', ');
	end if;

	-- INC-048 — LE MOTIF EST CONSERVÉ, avant le déplacement, dans la même transaction : soit le rattachement bouge et le
	-- motif est écrit, soit ni l'un ni l'autre. Il reste un commentaire de l'AFFAIRE.
	if v_comment is not null then
		insert into public.card_comments (card_id, workspace_id, author_id, body)
		values (v_placement.card_id, v_placement.workspace_id, (select auth.uid()), v_comment);
	end if;

	update public.card_placements p
	   set current_step_id = v_cible,
	       entered_step_at = now(),
	       position = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.card_placements autre
	            where autre.channel_id = v_placement.channel_id
	              and autre.current_step_id = v_cible
	       )
	 where p.id = p_placement
	returning p.* into v_placement;

	return v_placement;
end;
$$;

revoke all on function public.move_card(uuid, uuid, text) from public, anon;
grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;

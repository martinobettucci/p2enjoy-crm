-- @spec CRM-112 (docs/BACKLOG.md) — tranche T2.b : la sixième vérification de `move_card` lit aussi les champs communs
--       que la transition exige, sur les valeurs de l'affaire ; `missing_required_fields` nomme les deux sortes de champs
-- @spec docs/SPEC-champs-communs.md §5 ; docs/SPEC-workflow-engine.md §5.3 (les vérifications de `move_card`, dans
--       l'ordre) ; docs/SCHEMA.md « Migration `0156` » ; docs/JOURNAL.md décisions 664 et 819
--
-- `move_card` EST REPRISE À L'IDENTIQUE DE SA DÉFINITION EN BASE (migration `0128`, relue par `pg_get_functiondef`), avec
-- un seul ajout, à la fin de la vérification 6. Aucune autre vérification ne change, ni son ordre, ni ses messages, ni
-- ses privilèges : `create or replace` les conserve.

CREATE OR REPLACE FUNCTION public.move_card(p_placement uuid, to_step_id uuid, comment text DEFAULT NULL::text)
 RETURNS card_placements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_cible      uuid := to_step_id;
	-- INC-052, décision 374 : la classe des blancs est celle d'`app.btrim_blancs`.
	v_comment    text := nullif(app.btrim_blancs(comment), '');
	v_placement  public.card_placements%rowtype;
	v_transition public.workflow_transitions%rowtype;
	v_manquants  text[];
	v_points     text[];
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

	-- 6 (suite) — CRM-112 T2.b (docs/SPEC-champs-communs.md §5) : les CHAMPS COMMUNS que la transition exige, lus sur les
	-- valeurs de l'AFFAIRE. Leurs clés suivent celles des champs de workflow, dans le même détail. Un champ commun archivé
	-- n'est plus exigé : son archivage est refusé tant qu'une transition l'exige (§6), si bien que le cas ne se présente
	-- qu'après le retrait de l'exigence.
	v_manquants := coalesce(v_manquants, array[]::text[]) || coalesce((
		select array_agg(f.key order by f.position, f.key)
		  from public.workflow_transition_required_common_fields r
		  join public.card_common_fields f on f.id = r.common_field_id
		 where r.transition_id = v_transition.id
		   and f.archived_at is null
		   and not exists (
		       select 1
		         from public.card_common_field_values v
		        where v.card_id = v_placement.card_id
		          and v.field_id = f.id
		          and not app.valeur_de_champ_est_vide(v.value)
		   )
	), array[]::text[]);

	if v_manquants is not null and array_length(v_manquants, 1) > 0 then
		raise exception 'missing_required_fields'
			using detail = array_to_string(v_manquants, ', ');
	end if;

	-- 6 bis — CRM-068 T2 (docs/SPEC-checklists.md §3.4) : les points de checklist que la transition exige, cochés sur le
	-- RATTACHEMENT. Un point jamais ajouté compte comme non coché. Le détail est un tableau JSON des libellés : un libellé
	-- peut contenir une virgule, qu'une liste jointe rendrait ambiguë.
	select array_agg(i.label order by i.position, i.label)
	  into v_points
	  from public.workflow_transition_required_checklist_items r
	  join public.workflow_step_checklist_items i on i.id = r.step_item_id
	 where r.transition_id = v_transition.id
	   and not exists (
	       select 1
	         from public.card_checklist_items c
	        where c.placement_id = p_placement
	          and c.step_item_id = i.id
	          and c.checked
	   );

	if v_points is not null and array_length(v_points, 1) > 0 then
		raise exception 'checklist_incomplete'
			using errcode = 'P0001', detail = pg_catalog.to_jsonb(v_points)::text;
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
$function$;

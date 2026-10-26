-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.7 : les remappages portent sur les rattachements, et la clé
--       channel/workflow du rattachement redevient immédiate (décision 705). docs/SPEC-rattachements.md §5 (« Changer le
--       workflow d'un channel : `change_channel_workflow` — remappe les rattachements du channel »), §14 ;
--       docs/SPEC-change-channel-workflow.md ; docs/SPEC-workflow-engine.md §7 bis (restaurer une version) ;
--       docs/JOURNAL.md décisions 661, 705, 738
-- @spec docs/SCHEMA.md « Migration `0122` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3
--
-- CE QUI CHANGE. (1) `change_channel_workflow` verrouille, compte, efface et remappe les RATTACHEMENTS du channel et
-- leurs valeurs (par `placement_id`, T2.3.6), et RENDS les rattachements remappés : `SETOF public.card_placements` au
-- lieu de `SETOF public.cards` (décision 738) — ses arguments, ses refus et leur ordre sont inchangés. (2)
-- `app.appliquer_composition`, que `restore_workflow_version` appelle, remappe les rattachements. (3) La clé
-- `card_placements_channel_workflow_fk` redevient `INITIALLY IMMEDIATE` : différée par défaut pour le miroir de la
-- bascule (T2.1), elle n'est plus différée que là où un geste le demande, comme celle de `cards`.
--
-- CE QUI NE CHANGE PAS ICI, ET POURQUOI (décision 738). `creer_affaire` n'écrit pas encore le rattachement
-- elle-même : elle s'exécute sous les droits de l'appelant, que la table des rattachements ne laisse pas écrire, et
-- `cards` porte encore ses colonnes de rattachement non nulles avec le miroir d'insertion qui en fait le premier
-- rattachement. Écrire le rattachement en plus exigerait d'éteindre le miroir pour ce seul geste ; T2.4, qui retire les
-- colonnes et les miroirs, le fait sans artifice.
--
-- IDEMPOTENCE : `drop function if exists` puis `create or replace` ; la contrainte est réécrite à l'identique au rejeu.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : réappliquer `change_channel_workflow` de la migration 0020 (rendant
-- `SETOF cards`) et `app.appliquer_composition` de la migration 0086, et rendre la clé `INITIALLY DEFERRED`.

alter table public.card_placements
	alter constraint card_placements_channel_workflow_fk deferrable initially immediate;

drop function if exists public.change_channel_workflow(uuid, uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.change_channel_workflow(channel_id uuid, workflow_id uuid, step_mapping jsonb, discard_field_values boolean DEFAULT false)
 RETURNS SETOF public.card_placements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	-- Les arguments portent des noms de colonnes : ils sont copiés avant toute requête afin que
	-- chaque référence SQL reste non ambiguë.
	v_channel_id uuid    := channel_id;
	v_workflow_id uuid   := workflow_id;
	v_mapping jsonb      := step_mapping;
	v_discard boolean    := coalesce(discard_field_values, false);
	v_channel public.channels%rowtype;
	v_target public.workflows%rowtype;
	v_sources_occupees uuid[];
	v_sources_mapping uuid[];
	v_reponses bigint;
begin
	-- 3.1 Le channel est visible. Un objet caché ou d'un autre workspace ne devient pas un oracle.
	select ch.* into v_channel
	  from public.channels ch
	 where ch.id = v_channel_id
	   and app.can_read_channel(ch.id)
	 for update;

	if not found then
		raise exception 'channel_not_found';
	end if;

	-- 3.2 Changer le contenant est une administration du workspace, pas un droit fin `write`.
	if not app.is_workspace_admin(v_channel.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 3.3 Le workflow cible est actif, du même workspace et verrouillé jusqu'au commit.
	select w.* into v_target
	  from public.workflows w
	 where w.id = v_workflow_id
	   and w.workspace_id = v_channel.workspace_id
	   and w.archived_at is null
	 for share;

	if not found then
		raise exception 'workflow_not_found';
	end if;

	if v_target.scope = 'track' and v_target.track_id is distinct from v_channel.track_id then
		raise exception 'workflow_not_compatible' using errcode = '23514';
	end if;

	if v_target.id = v_channel.workflow_id then
		raise exception 'same_workflow';
	end if;

	-- Les étapes des deux graphes ne peuvent pas être déplacées pendant la validation.
	perform s.id
	  from public.workflow_steps s
	 where s.workflow_id in (v_channel.workflow_id, v_target.id)
	 order by s.id
	 for share;

	-- Les cards, puis leurs réponses, sont verrouillées AVANT de calculer l'ensemble occupé. La
	-- clé étrangère vers le channel fait également attendre toute insertion concurrente.
	perform c.id
	  from public.card_placements c
	 where c.channel_id = v_channel.id
	 order by c.id
	 for update;

	perform fv.placement_id, fv.field_id
	  from public.card_field_values fv
	  join public.card_placements c on c.id = fv.placement_id
	 where c.channel_id = v_channel.id
	 order by fv.placement_id, fv.field_id
	 for update of fv;

	-- 3.4 Forme exacte : tableau d'objets, deux clés seulement, valeurs chaîne UUID.
	if v_mapping is null or pg_catalog.jsonb_typeof(v_mapping) <> 'array' then
		raise exception 'invalid_step_mapping';
	end if;

	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		 where pg_catalog.jsonb_typeof(item.value) <> 'object'
		    or not (item.value ? 'from_step_id' and item.value ? 'to_step_id')
		    or (select count(*) from pg_catalog.jsonb_object_keys(item.value)) <> 2
		    or pg_catalog.jsonb_typeof(item.value -> 'from_step_id') <> 'string'
		    or pg_catalog.jsonb_typeof(item.value -> 'to_step_id') <> 'string'
		    or not pg_catalog.pg_input_is_valid(
		        item.value ->> 'from_step_id', 'uuid')
		    or not pg_catalog.pg_input_is_valid(
		        item.value ->> 'to_step_id', 'uuid')
	) then
		raise exception 'invalid_step_mapping';
	end if;

	-- 3.5 Un doublon de SOURCE est refusé. Plusieurs sources vers la même cible restent licites.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		 group by (item.value ->> 'from_step_id')::uuid
		having count(*) > 1
	) then
		raise exception 'step_mapping_duplicate';
	end if;

	select coalesce(array_agg(distinct c.current_step_id order by c.current_step_id),
	                array[]::uuid[])
	  into v_sources_occupees
	  from public.card_placements c
	 where c.channel_id = v_channel.id;

	select coalesce(array_agg((item.value ->> 'from_step_id')::uuid
	                          order by (item.value ->> 'from_step_id')::uuid),
	                array[]::uuid[])
	  into v_sources_mapping
	  from pg_catalog.jsonb_array_elements(v_mapping) as item(value);

	-- Égalité stricte : une source absente ET une source supplémentaire sont le même mapping non
	-- exhaustif. Pour un channel vide, seule la liste vide passe.
	if v_sources_mapping is distinct from v_sources_occupees then
		raise exception 'step_mapping_incomplete';
	end if;

	-- 3.6 Chaque cible appartient au nouveau workflow. Aucun nœud ou rang n'est deviné.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		  left join public.workflow_steps s
		    on s.id = (item.value ->> 'to_step_id')::uuid
		   and s.workflow_id = v_target.id
		 where s.id is null
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- 3.7 Les réponses de formulaire appartiennent à l'ancien graphe. Elles ne sont jamais
	-- remappées ; leur destruction est un consentement séparé et false par défaut.
	select count(*) into v_reponses
	  from public.card_field_values fv
	  join public.card_placements c on c.id = fv.placement_id
	 where c.channel_id = v_channel.id;

	if v_reponses > 0 and not v_discard then
		raise exception 'field_values_would_be_lost'
			using detail = format('%s réponse(s) de formulaire seraient perdues.', v_reponses);
	end if;

	if v_reponses > 0 then
		delete from public.card_field_values fv
		 using public.card_placements c
		 where c.id = fv.placement_id
		   and c.channel_id = v_channel.id;
	end if;

	-- 3.8 Écriture atomique. L'ancien rang des étapes, puis la position et l'id des cards,
	-- déterminent l'ordre quand plusieurs sources convergent vers une cible.
	-- `CRM-111` T2.3.7 : le rattachement porte le couple (channel, workflow) ; sa clé est différée comme celle de `cards`,
	-- que le miroir de la bascule écrit dans la même transaction.
	set constraints public.cards_channel_id_workflow_id_fkey, public.card_placements_channel_workflow_fk deferred;

	update public.channels ch
	   set workflow_id = v_target.id
	 where ch.id = v_channel.id;

	with mapping as (
		select (item.value ->> 'from_step_id')::uuid as from_step_id,
		       (item.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
	), ordonnees as (
		select c.id,
		       m.to_step_id,
		       row_number() over (
			   partition by m.to_step_id
			   order by source.position, c.position, c.id
		       )::numeric as nouvelle_position
		  from public.card_placements c
		  join mapping m on m.from_step_id = c.current_step_id
		  join public.workflow_steps source on source.id = c.current_step_id
		 where c.channel_id = v_channel.id
	)
	update public.card_placements c
	   set workflow_id     = v_target.id,
	       current_step_id = o.to_step_id,
	       entered_step_at = now(),
	       position        = o.nouvelle_position
	  from ordonnees o
	 where c.id = o.id;

	-- Le contrôle a réellement lieu avant que l'appelant ne reçoive le succès. La contrainte ne
	-- reste pas différée dans une transaction SQL plus longue que l'appel PostgREST ordinaire.
	set constraints public.cards_channel_id_workflow_id_fkey, public.card_placements_channel_workflow_fk immediate;

	return query
	select c.*
	  from public.card_placements c
	 where c.channel_id = v_channel.id
	 order by c.current_step_id, c.position, c.id;
end;
$function$;

revoke all on function public.change_channel_workflow(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.change_channel_workflow(uuid, uuid, jsonb, boolean) to authenticated, service_role;

-- --- `app.appliquer_composition` : les rattachements remappés (sa définition reprise de la base) -----------------------
CREATE OR REPLACE FUNCTION app.appliquer_composition(p_workflow_id uuid, p_workspace_id uuid, p_doc jsonb, p_overrides jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	n_cards    bigint := 0;
	n_step_new bigint := 0;
	n_step_del bigint := 0;
	n_step_maj bigint := 0;
	n_tr_new   bigint := 0;
	n_tr_del   bigint := 0;
	n_tr_maj   bigint := 0;
	n_ch_new   bigint := 0;
	n_ch_des   bigint := 0;
	n_ch_arc   bigint := 0;
	n_ch_maj   bigint := 0;
	n_rg_new   bigint := 0;
	n_rg_del   bigint := 0;
	n_rg_maj   bigint := 0;
	n_rq_new   bigint := 0;
	n_rq_del   bigint := 0;
	retablies  uuid[];
begin
	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 2 — LES ÉTAPES RÉTABLIES, AVANT LES AFFAIRES (INC-270), avec l'identifiant d'origine que
	-- le document conserve : une affaire peut viser l'une d'elles. Jamais initiales ici —
	-- `workflow_steps_workflow_initial_uk` refuserait une seconde initiale ; l'écriture 6 règle
	-- l'initiale. L'unicité d'un nœud est ajournée : une étape rétablie peut réclamer le nœud d'une
	-- étape retirée qui porte encore ses affaires.
	-- ---------------------------------------------------------------------------------------
	set constraints public.workflow_steps_workflow_id_node_id_key deferred;

	with posees as (
		insert into public.workflow_steps (
			id, workflow_id, workspace_id, node_id, position,
			label_override, probability_override, stale_after_days, is_initial
		)
		select (e.value ->> 'id')::uuid,
		       p_workflow_id,
		       p_workspace_id,
		       (e.value ->> 'node_id')::uuid,
		       (e.value ->> 'position')::numeric,
		       e.value ->> 'label_override',
		       (e.value ->> 'probability_override')::numeric,
		       (e.value ->> 'stale_after_days')::integer,
		       false
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
		 where not exists (
			select 1 from public.workflow_steps s where s.id = (e.value ->> 'id')::uuid
		 )
		returning id
	)
	select coalesce(pg_catalog.array_agg(posees.id), '{}') into retablies from posees;

	n_step_new := pg_catalog.cardinality(retablies);

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 3 — LES AFFAIRES, avant toute suppression d'étape.
	--
	-- MESURÉ : `cards_current_step_id_workflow_id_fkey` est en `NO ACTION`. Supprimer une étape
	-- qui porte encore une affaire échoue en `23503`. C'est ce fait, et lui seul, qui rend le plan
	-- obligatoire.
	--
	-- Le plan a rendu `ready` : chaque affaire est donc soit sur une étape que la version conserve
	-- — elle ne bouge pas —, soit couverte par une instruction. Appliquer les instructions suffit,
	-- et ne réécrit PAS la règle de résolution.
	--
	-- Une affaire remappée ne franchit AUCUNE arête : `move_card` n'est pas appelée, et ses gardes
	-- ne s'appliquent pas. Le trigger `card_events_apres_maj` écrit l'événement `moved` — la
	-- fonction n'en fabrique aucun.
	-- ---------------------------------------------------------------------------------------
	with instructions as (
		select (e.value ->> 'from_step_id')::uuid as from_step_id,
		       (e.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) as e(value)
	)
	-- `CRM-111` T2.3.7 : les RATTACHEMENTS sont remappés ; le miroir de la bascule reporte sur `cards`.
	update public.card_placements c
	   set current_step_id = i.to_step_id,
	       entered_step_at = pg_catalog.now()
	  from instructions i
	 where c.workflow_id = p_workflow_id
	   and c.current_step_id = i.from_step_id;

	get diagnostics n_cards = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 4 — L'ÉTAPE INITIALE EST D'ABORD DÉMISE.
	--
	-- MESURÉ : `workflow_steps_workflow_initial_uk` est un index unique PARTIEL sur
	-- `(workflow_id) where is_initial`. Rétablir l'étape initiale de la version avant d'avoir
	-- défait l'actuelle échoue en `23505`. L'ordre n'est donc pas commutatif.
	-- ---------------------------------------------------------------------------------------
	update public.workflow_steps s
	   set is_initial = false
	 where s.workflow_id = p_workflow_id
	   and s.is_initial
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
		   and (e.value ->> 'is_initial')::boolean
	 );

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 5 — LES ÉTAPES RETIRÉES, dont les affaires sont parties. Leur suppression emporte
	-- en cascade leurs arêtes et leurs règles, ce qui allège les écritures 7 et 9.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_steps s
	 where s.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
	 );

	get diagnostics n_step_del = row_count;

	-- Les étapes retirées sont parties : un nœud n'apparaît plus qu'une fois par workflow, et c'est
	-- vérifié MAINTENANT — la transaction appelante n'hérite d'aucune unicité ajournée.
	set constraints public.workflow_steps_workflow_id_node_id_key immediate;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 6 — LES ÉTAPES CONSERVÉES reprennent leurs colonnes photographiées ; l'étape
	-- initiale rétablie le redevient. `is distinct from` : ce qui ne doit rien faire ne subit rien,
	-- et `updated_at` n'est pas réécrit sans motif. L'étape initiale rétablie est réglée D'ABORD :
	-- une étape rétablie se compte créée, et la mise à jour ne lui trouve plus aucun écart.
	-- ---------------------------------------------------------------------------------------
	update public.workflow_steps s
	   set is_initial = true
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
	 where s.id = (e.value ->> 'id')::uuid
	   and s.id = any (retablies)
	   and (e.value ->> 'is_initial')::boolean;

	update public.workflow_steps s
	   set position             = (e.value ->> 'position')::numeric,
	       label_override       = e.value ->> 'label_override',
	       probability_override = (e.value ->> 'probability_override')::numeric,
	       stale_after_days     = (e.value ->> 'stale_after_days')::integer,
	       is_initial           = (e.value ->> 'is_initial')::boolean
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
	 where s.id = (e.value ->> 'id')::uuid
	   and s.workflow_id = p_workflow_id
	   and (s.position, s.label_override, s.probability_override, s.stale_after_days, s.is_initial)
	       is distinct from
	       ((e.value ->> 'position')::numeric, e.value ->> 'label_override',
	        (e.value ->> 'probability_override')::numeric,
	        (e.value ->> 'stale_after_days')::integer, (e.value ->> 'is_initial')::boolean);

	get diagnostics n_step_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 7 — LES ARÊTES. Leurs deux extrémités doivent exister, donc après les étapes. Une
	-- arête ne porte AUCUNE donnée utilisateur : la supprimer ne détruit que de la structure.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transitions t
	 where t.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = t.id
	 );

	get diagnostics n_tr_del = row_count;

	insert into public.workflow_transitions (
		id, workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment
	)
	select (e.value ->> 'id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       (e.value ->> 'from_step_id')::uuid,
	       (e.value ->> 'to_step_id')::uuid,
	       e.value ->> 'label',
	       (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transitions t where t.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_tr_new = row_count;

	update public.workflow_transitions t
	   set label           = e.value ->> 'label',
	       require_comment = (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where t.id = (e.value ->> 'id')::uuid
	   and t.workflow_id = p_workflow_id
	   and (t.label, t.require_comment)
	       is distinct from (e.value ->> 'label', (e.value ->> 'require_comment')::boolean);

	get diagnostics n_tr_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 8 — LES CHAMPS, ET AUCUN N'EST SUPPRIMÉ.
	--
	-- `card_field_values` porte les SAISIES des utilisateurs, et le document canonique n'en
	-- conserve aucune. MESURÉ, et c'est ce qui retire toute discussion : `public.form_fields` ne
	-- porte AUCUNE politique `delete`, et `authenticated` n'a que `select`, `insert`, `update`.
	-- La suppression d'un champ n'existe pas dans ce produit.
	--
	-- Un champ surnuméraire est donc ARCHIVÉ ; un champ archivé que la version portait actif est
	-- DÉSARCHIVÉ. La conséquence est assumée et rendue : l'empreinte d'après peut différer de
	-- celle de la version, et `matches_version` le dit.
	-- ---------------------------------------------------------------------------------------
	insert into public.form_fields (
		id, workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at
	)
	select (e.value ->> 'id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       e.value ->> 'key',
	       e.value ->> 'label',
	       e.value ->> 'type',
	       coalesce(e.value -> 'options', '{}'::jsonb),
	       e.value ->> 'help_text',
	       (e.value ->> 'position')::numeric,
	       (e.value ->> 'archived_at')::timestamptz
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_fields f where f.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_ch_new = row_count;

	-- Désarchivage : compté à part de la mise à jour, parce que ce n'est pas le même fait pour un
	-- humain qui lit le compte rendu du geste.
	update public.form_fields f
	   set archived_at = null
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = p_workflow_id
	   and f.archived_at is not null
	   and (e.value ->> 'archived_at') is null;

	get diagnostics n_ch_des = row_count;

	update public.form_fields f
	   set key         = e.value ->> 'key',
	       label       = e.value ->> 'label',
	       type        = e.value ->> 'type',
	       options     = coalesce(e.value -> 'options', '{}'::jsonb),
	       help_text   = e.value ->> 'help_text',
	       position    = (e.value ->> 'position')::numeric,
	       archived_at = (e.value ->> 'archived_at')::timestamptz
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = p_workflow_id
	   and (f.key, f.label, f.type, f.options, f.help_text, f.position, f.archived_at)
	       is distinct from
	       (e.value ->> 'key', e.value ->> 'label', e.value ->> 'type',
	        coalesce(e.value -> 'options', '{}'::jsonb), e.value ->> 'help_text',
	        (e.value ->> 'position')::numeric, (e.value ->> 'archived_at')::timestamptz);

	get diagnostics n_ch_maj = row_count;

	-- Le champ surnuméraire : ARCHIVÉ, jamais supprimé. Ses valeurs saisies restent intactes.
	update public.form_fields f
	   set archived_at = pg_catalog.now()
	 where f.workflow_id = p_workflow_id
	   and f.archived_at is null
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = f.id
	 );

	get diagnostics n_ch_arc = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 9 — LES RÈGLES DE VISIBILITÉ. Elles lient un champ ET une étape, donc après les
	-- deux. Une partie a déjà disparu par la cascade des étapes supprimées ; le reste est traité
	-- ici, et le résultat ne dépend pas de savoir laquelle.
	-- ---------------------------------------------------------------------------------------
	delete from public.form_field_rules r
	 where r.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'field_id')::uuid = r.field_id
		   and (e.value ->> 'step_id')::uuid  = r.step_id
	 );

	get diagnostics n_rg_del = row_count;

	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	select (e.value ->> 'field_id')::uuid,
	       (e.value ->> 'step_id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_field_rules r
		 where r.field_id = (e.value ->> 'field_id')::uuid
		   and r.step_id  = (e.value ->> 'step_id')::uuid
	 );

	get diagnostics n_rg_new = row_count;

	update public.form_field_rules r
	   set visibility = e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
	 where r.field_id = (e.value ->> 'field_id')::uuid
	   and r.step_id  = (e.value ->> 'step_id')::uuid
	   and r.visibility is distinct from (e.value ->> 'visibility');

	get diagnostics n_rg_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 10 — LES CHAMPS REQUIS PAR TRANSITION. Ils lient une arête et un champ, donc après
	-- les deux. Table de liaison pure : elle n'a rien à mettre à jour, seulement à créer ou à
	-- supprimer.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transition_required_fields rf
	 using public.workflow_transitions t
	 where t.id = rf.transition_id
	   and t.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(p_doc -> 'required_fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'transition_id')::uuid = rf.transition_id
		   and (e.value ->> 'field_id')::uuid      = rf.field_id
	 );

	get diagnostics n_rq_del = row_count;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select (e.value ->> 'transition_id')::uuid,
	       (e.value ->> 'field_id')::uuid
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'required_fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transition_required_fields rf
		 where rf.transition_id = (e.value ->> 'transition_id')::uuid
		   and rf.field_id      = (e.value ->> 'field_id')::uuid
	 );

	get diagnostics n_rq_new = row_count;

	return pg_catalog.jsonb_build_object(
		'cards', n_cards,
		'steps_created', n_step_new, 'steps_deleted', n_step_del, 'steps_updated', n_step_maj,
		'transitions_created', n_tr_new, 'transitions_deleted', n_tr_del, 'transitions_updated', n_tr_maj,
		'fields_created', n_ch_new, 'fields_unarchived', n_ch_des, 'fields_archived', n_ch_arc, 'fields_updated', n_ch_maj,
		'rules_created', n_rg_new, 'rules_deleted', n_rg_del, 'rules_updated', n_rg_maj,
		'required_created', n_rq_new, 'required_deleted', n_rq_del
	);
end;
$function$;

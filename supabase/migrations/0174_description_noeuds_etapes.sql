-- @spec CRM-133 (docs/BACKLOG.md) — tranche T1 : la description d'un nœud du catalogue, et sa surcharge par l'étape —
--       deux colonnes, le chemin de `label_override` (document de composition, restauration, copie, comparaison à la
--       source, audit), et la surcharge gardée par une suggestion de l'assistant acceptée
-- @spec docs/SPEC-workflow-engine.md §7 sexies.1 à §7 sexies.3 ; docs/SCHEMA.md « Migration `0174` » ;
--       docs/SPEC-audit.md ; docs/JOURNAL.md décisions 869, 870 et 882
--
-- LES CINQ FONCTIONS SONT REPRISES À L'IDENTIQUE DE LEUR DÉFINITION EN BASE (`pg_get_functiondef`, 2026-11-10), chacune
-- avec la seule colonne ajoutée, à côté de `label_override`. Dans le document de composition et le document naturalisé, la
-- clé `description_override` n'est posée QUE si elle porte une valeur (le patron de la `0157`) : l'empreinte d'une
-- composition sans surcharge est celle d'avant, aucune copie ne se découvre divergente, aucun workflow « modifié ».
-- `compare_workflow_versions` et `compare_workflow_with_source` ne sont pas reprises : elles comparent tout attribut
-- présent (`app.composition_collection_diff`). La description du NŒUD n'entre dans aucun document : le catalogue n'est
-- pas versionné. Aucune politique nouvelle : les privilèges de table couvrent les colonnes nouvelles.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Les colonnes. Vide n'est pas une valeur : la base refuse une chaîne blanche (`23514`), les écrans envoient `NULL`.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.workflow_nodes_catalog
	add column description text,
	add constraint workflow_nodes_catalog_description_check check (description is null or btrim(description) <> '');
comment on column public.workflow_nodes_catalog.description is
	'CRM-133 : description du nœud, facultative, non blanche, sans borne ; l''étape peut la surcharger (docs/SPEC-workflow-engine.md §7 sexies).';

alter table public.workflow_steps
	add column description_override text,
	add constraint workflow_steps_description_check
		check (description_override is null or btrim(description_override) <> '');
comment on column public.workflow_steps.description_override is
	'CRM-133 : surcharge de la description du nœud ; description effective = coalesce(description_override, node.description).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Le document de composition : la surcharge photographiée, seulement si elle est posée.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.workflow_composition_document(target_workflow_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select pg_catalog.jsonb_build_object(
		'workflow', pg_catalog.jsonb_build_object(
			'id', w.id,
			'name', w.name,
			'scope', w.scope,
			'track_id', w.track_id,
			'is_default', w.is_default,
			'archived_at', w.archived_at
		),
		'steps', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', s.id,
					'node_id', s.node_id,
					'node_key', n.key,
					'node_label', n.label,
					'node_kind', n.kind,
					'node_color', n.color,
					'node_default_probability', n.default_probability,
					'node_default_stale_after_days', n.default_stale_after_days,
					'node_archived_at', n.archived_at,
					'position', s.position,
					'label_override', s.label_override,
					'probability_override', s.probability_override,
					'stale_after_days', s.stale_after_days,
					'is_initial', s.is_initial
				)
				-- `CRM-133` (décision 870) : la clé n'est posée que si elle porte une valeur, l'empreinte d'avant reste.
				|| pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('description_override', s.description_override))
				order by s.id
			)
			  from public.workflow_steps s
			  join public.workflow_nodes_catalog n on n.id = s.node_id
			 where s.workflow_id = w.id
		), '[]'::jsonb),
		'transitions', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', t.id,
					'from_step_id', t.from_step_id,
					'to_step_id', t.to_step_id,
					'label', t.label,
					'require_comment', t.require_comment
				) order by t.id
			)
			  from public.workflow_transitions t
			 where t.workflow_id = w.id
		), '[]'::jsonb),
		'fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', f.id,
					'key', f.key,
					'label', f.label,
					'type', f.type,
					'options', f.options,
					'help_text', f.help_text,
					'position', f.position,
					'archived_at', f.archived_at
				) order by f.id
			)
			  from public.form_fields f
			 where f.workflow_id = w.id
		), '[]'::jsonb),
		'rules', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'field_id', r.field_id,
					'step_id', r.step_id,
					'visibility', r.visibility
				) order by r.field_id, r.step_id
			)
			  from public.form_field_rules r
			 where r.workflow_id = w.id
		), '[]'::jsonb),
		'required_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'transition_id', rf.transition_id,
					'field_id', rf.field_id
				) order by rf.transition_id, rf.field_id
			)
			  from public.workflow_transition_required_fields rf
			  join public.workflow_transitions t on t.id = rf.transition_id
			 where t.workflow_id = w.id
		), '[]'::jsonb)
	)
	-- CRM-112 T2.c.1 : les champs communs exigés, par identifiant ET par clé (docs/SPEC-champs-communs.md §5). La clé
	-- n'est posée QUE si le workflow en exige : l'empreinte d'une composition qui n'en exige pas reste celle d'avant,
	-- et aucune copie existante ne se découvre « divergente » de sa source.
	|| coalesce((
		select pg_catalog.jsonb_build_object('required_common_fields', pg_catalog.jsonb_agg(
			pg_catalog.jsonb_build_object(
				'transition_id', rc.transition_id,
				'common_field_id', rc.common_field_id,
				'key', f.key
			) order by rc.transition_id, rc.common_field_id))
		  from public.workflow_transition_required_common_fields rc
		  join public.workflow_transitions t on t.id = rc.transition_id
		  join public.card_common_fields f on f.id = rc.common_field_id
		 where t.workflow_id = w.id
		having count(*) > 0
	), '{}'::jsonb)
	  from public.workflows w
	 where w.id = target_workflow_id;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. La restauration (et l'acceptation d'une suggestion) : la surcharge rétablie, `NULL` quand le document ne la porte pas.
-- ---------------------------------------------------------------------------------------------------------------------
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
			label_override, probability_override, stale_after_days, is_initial, description_override
		)
		select (e.value ->> 'id')::uuid,
		       p_workflow_id,
		       p_workspace_id,
		       (e.value ->> 'node_id')::uuid,
		       (e.value ->> 'position')::numeric,
		       e.value ->> 'label_override',
		       (e.value ->> 'probability_override')::numeric,
		       (e.value ->> 'stale_after_days')::integer,
		       false,
		       e.value ->> 'description_override'
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
	       is_initial           = (e.value ->> 'is_initial')::boolean,
	       -- `CRM-133` : absente d'une version d'avant la surcharge, elle la rétablit à `NULL`.
	       description_override = e.value ->> 'description_override'
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
	 where s.id = (e.value ->> 'id')::uuid
	   and s.workflow_id = p_workflow_id
	   and (s.position, s.label_override, s.probability_override, s.stale_after_days, s.is_initial, s.description_override)
	       is distinct from
	       ((e.value ->> 'position')::numeric, e.value ->> 'label_override',
	        (e.value ->> 'probability_override')::numeric,
	        (e.value ->> 'stale_after_days')::integer, (e.value ->> 'is_initial')::boolean,
	        e.value ->> 'description_override');

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

	-- CRM-112 T2.c.1 : les champs communs exigés suivent la composition, comme les champs de workflow exigés. Une clé
	-- absente (version antérieure) vaut « aucun ». Un champ archivé est refusé par le déclencheur d'insertion,
	-- `common_field_archived` (docs/SPEC-champs-communs.md §5). Le compte rendu ne change pas de forme.
	delete from public.workflow_transition_required_common_fields rc
	 using public.workflow_transitions t
	 where t.id = rc.transition_id
	   and t.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(p_doc -> 'required_common_fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'transition_id')::uuid   = rc.transition_id
		   and (e.value ->> 'common_field_id')::uuid = rc.common_field_id
	 );

	insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
	select (e.value ->> 'transition_id')::uuid,
	       (e.value ->> 'common_field_id')::uuid
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'required_common_fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transition_required_common_fields rc
		 where rc.transition_id   = (e.value ->> 'transition_id')::uuid
		   and rc.common_field_id = (e.value ->> 'common_field_id')::uuid
	 );

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

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. La copie vers un track : la surcharge recopiée.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_workflow_to_track(workflow_id uuid, track_id uuid, new_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_source_id uuid := workflow_id;
	v_track_id  uuid := track_id;
	v_nom       text := new_name;
	v_source    public.workflows%rowtype;
	v_copie_id  uuid;
	v_fingerprint text;
	v_attendu     bigint;
	v_insere      bigint;
begin
	select w.* into v_source
	  from public.workflows w
	 where w.id = v_source_id
	   and w.archived_at is null
	   and app.is_workspace_member(w.workspace_id)
	 for share;

	if not found then
		raise exception 'workflow_not_found';
	end if;

	if not app.is_workspace_admin(v_source.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if v_source.scope <> 'global' then
		raise exception 'workflow_not_global';
	end if;

	perform 1
	  from public.tracks t
	 where t.id = v_track_id
	   and t.workspace_id = v_source.workspace_id
	   and t.archived_at is null
	 for share;

	if not found then
		 raise exception 'track_not_found';
	end if;

	-- Le geste est rare et administratif. SHARE ROW EXCLUSIVE stabilise la composition et
	-- sérialise deux copies concurrentes : deux verrous SHARE suivis d'INSERT se bloqueraient
	-- mutuellement lors de leur promotion en ROW EXCLUSIVE.
	lock table public.workflow_nodes_catalog,
	           public.workflow_steps,
	           public.workflow_transitions,
	           public.form_fields,
	           public.form_field_rules,
	           public.workflow_transition_required_fields
		in share row exclusive mode;

	v_fingerprint := app.workflow_composition_fingerprint(v_source.id);
	if v_fingerprint is null then
		raise exception 'workflow_copy_fingerprint_failed';
	end if;

	insert into public.workflows (
		workspace_id, name, scope, track_id,
		derived_from_workflow_id, derived_at, source_composition_fingerprint, is_default
	)
	values (
		v_source.workspace_id, coalesce(v_nom, v_source.name), 'track', v_track_id,
		v_source.id, now(), v_fingerprint, false
	)
	returning id into v_copie_id;

	insert into public.workflow_steps (
		workflow_id, workspace_id, node_id, position,
		label_override, probability_override, stale_after_days, is_initial, description_override
	)
	select v_copie_id, s.workspace_id, s.node_id, s.position,
	       s.label_override, s.probability_override, s.stale_after_days, s.is_initial, s.description_override
	  from public.workflow_steps s
	 where s.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu from public.workflow_steps s where s.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: steps %/%', v_insere, v_attendu;
	end if;

	insert into public.workflow_transitions (
		workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment
	)
	select v_copie_id, t.workspace_id, copie_depuis.id, copie_vers.id,
	       t.label, t.require_comment
	  from public.workflow_transitions t
	  join public.workflow_steps source_depuis on source_depuis.id = t.from_step_id
	  join public.workflow_steps source_vers   on source_vers.id   = t.to_step_id
	  join public.workflow_steps copie_depuis
	    on copie_depuis.workflow_id = v_copie_id and copie_depuis.node_id = source_depuis.node_id
	  join public.workflow_steps copie_vers
	    on copie_vers.workflow_id = v_copie_id and copie_vers.node_id = source_vers.node_id
	 where t.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.workflow_transitions t where t.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: transitions %/%', v_insere, v_attendu;
	end if;

	insert into public.form_fields (
		workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at
	)
	select v_copie_id, f.workspace_id, f.key, f.label, f.type, f.options, f.help_text,
	       f.position, f.archived_at
	  from public.form_fields f
	 where f.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu from public.form_fields f where f.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: fields %/%', v_insere, v_attendu;
	end if;

	insert into public.form_field_rules (
		field_id, step_id, workflow_id, workspace_id, visibility
	)
	select cible_champ.id, cible_etape.id, v_copie_id, r.workspace_id, r.visibility
	  from public.form_field_rules r
	  join public.form_fields source_champ on source_champ.id = r.field_id
	  join public.form_fields cible_champ
	    on cible_champ.workflow_id = v_copie_id and cible_champ.key = source_champ.key
	  join public.workflow_steps source_etape on source_etape.id = r.step_id
	  join public.workflow_steps cible_etape
	    on cible_etape.workflow_id = v_copie_id and cible_etape.node_id = source_etape.node_id
	 where r.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.form_field_rules r where r.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: rules %/%', v_insere, v_attendu;
	end if;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select cible_transition.id, cible_champ.id
	  from public.workflow_transition_required_fields rf
	  join public.workflow_transitions source_transition on source_transition.id = rf.transition_id
	  join public.workflow_steps source_depart on source_depart.id = source_transition.from_step_id
	  join public.workflow_steps source_arrivee on source_arrivee.id = source_transition.to_step_id
	  join public.workflow_steps cible_depart
	    on cible_depart.workflow_id = v_copie_id and cible_depart.node_id = source_depart.node_id
	  join public.workflow_steps cible_arrivee
	    on cible_arrivee.workflow_id = v_copie_id and cible_arrivee.node_id = source_arrivee.node_id
	  join public.workflow_transitions cible_transition
	    on cible_transition.workflow_id = v_copie_id
	   and cible_transition.from_step_id = cible_depart.id
	   and cible_transition.to_step_id = cible_arrivee.id
	  join public.form_fields source_champ on source_champ.id = rf.field_id
	  join public.form_fields cible_champ
	    on cible_champ.workflow_id = v_copie_id and cible_champ.key = source_champ.key
	 where source_transition.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.workflow_transition_required_fields rf
	  join public.workflow_transitions t on t.id = rf.transition_id
	 where t.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: required_fields %/%', v_insere, v_attendu;
	end if;

	-- CRM-112 T2.c.1 : les champs communs exigés suivent la copie. Elle reste dans l'espace, si bien que l'exigence vise le
	-- MÊME champ commun ; seule la transition est celle de la copie (docs/SPEC-champs-communs.md §5).
	insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
	select cible_transition.id, rc.common_field_id
	  from public.workflow_transition_required_common_fields rc
	  join public.workflow_transitions source_transition on source_transition.id = rc.transition_id
	  join public.workflow_steps source_depart on source_depart.id = source_transition.from_step_id
	  join public.workflow_steps source_arrivee on source_arrivee.id = source_transition.to_step_id
	  join public.workflow_steps cible_depart
	    on cible_depart.workflow_id = v_copie_id and cible_depart.node_id = source_depart.node_id
	  join public.workflow_steps cible_arrivee
	    on cible_arrivee.workflow_id = v_copie_id and cible_arrivee.node_id = source_arrivee.node_id
	  join public.workflow_transitions cible_transition
	    on cible_transition.workflow_id = v_copie_id
	   and cible_transition.from_step_id = cible_depart.id
	   and cible_transition.to_step_id = cible_arrivee.id
	 where source_transition.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.workflow_transition_required_common_fields rc
	  join public.workflow_transitions t on t.id = rc.transition_id
	 where t.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: required_common_fields %/%', v_insere, v_attendu;
	end if;

	return v_copie_id;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Le document naturalisé de la comparaison à la source : la surcharge, seulement si elle est posée.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.workflow_composition_naturel(target_workflow_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with document as (
		select app.workflow_composition_document(target_workflow_id) as j
	),
	-- Table de correspondance « identifiant local d'étape » -> « identifiant de nœud ». C'est elle
	-- qui rend les arêtes, les règles et les exigences comparables d'un workflow à l'autre.
	etapes as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'steps') as e(value)
	),
	etape_par_id as (
		select element ->> 'id' as id_local, element ->> 'node_id' as node_id
		  from etapes
	),
	champs as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'fields') as e(value)
	),
	champ_par_id as (
		select element ->> 'id' as id_local, element ->> 'key' as cle
		  from champs
	),
	arcs as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'transitions') as e(value)
	),
	-- L'identité d'une arête est le COUPLE de nœuds, garanti unique par
	-- `workflow_transitions_workflow_from_to_key` (§4 ter.2). Le libellé est un attribut : le
	-- changer est une modification, pas un retrait suivi d'un ajout.
	arc_par_id as (
		select
			a.element ->> 'id' as id_local,
			(select node_id from etape_par_id where id_local = a.element ->> 'from_step_id') as from_node_id,
			(select node_id from etape_par_id where id_local = a.element ->> 'to_step_id')   as to_node_id
		  from arcs a
	),
	regles as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'rules') as e(value)
	),
	exigences as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'required_fields') as e(value)
	),
	-- `CRM-112` T2.c.2 : absente du document quand rien n'est exigé (`0157`) ; `coalesce` rend alors zéro ligne.
	exigences_communes as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(coalesce(d.j -> 'required_common_fields', '[]'::jsonb)) as e(value)
	)
	select pg_catalog.jsonb_build_object(
		'steps', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'node_id',              element -> 'node_id',
					'node_key',             element -> 'node_key',
					'position',             element -> 'position',
					'is_initial',           element -> 'is_initial',
					'label_override',       element -> 'label_override',
					'probability_override', element -> 'probability_override',
					'stale_after_days',     element -> 'stale_after_days'
				)
				-- `CRM-133` : posée seulement si elle porte une valeur, comme dans le document.
				|| pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('description_override', element -> 'description_override'))
				order by element ->> 'node_id'
			) from etapes
		), '[]'::jsonb),
		'transitions', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id',    (select from_node_id from arc_par_id where id_local = a.element ->> 'id'),
					'to_node_id',      (select to_node_id   from arc_par_id where id_local = a.element ->> 'id'),
					'label',           a.element -> 'label',
					'require_comment', a.element -> 'require_comment'
				) order by
					(select from_node_id from arc_par_id where id_local = a.element ->> 'id'),
					(select to_node_id   from arc_par_id where id_local = a.element ->> 'id')
			) from arcs a
		), '[]'::jsonb),
		-- `fields.key` est le seul appariement qui repose sur une clé MÉTIER, et l'écart est assumé
		-- au §4 ter.2 : `key` est exactement ce que la copie remappe, et un champ n'a pas d'autre
		-- invariant partagé. Renommer un champ dans la copie est donc un retrait ET un ajout.
		'fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'key',         element -> 'key',
					'type',        element -> 'type',
					'label',       element -> 'label',
					'options',     element -> 'options',
					'position',    element -> 'position',
					'help_text',   element -> 'help_text',
					'archived_at', element -> 'archived_at'
				) order by element ->> 'key'
			) from champs
		), '[]'::jsonb),
		'rules', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'field_key',  (select cle     from champ_par_id where id_local = r.element ->> 'field_id'),
					'node_id',    (select node_id from etape_par_id where id_local = r.element ->> 'step_id'),
					'visibility', r.element -> 'visibility'
				) order by
					(select cle     from champ_par_id where id_local = r.element ->> 'field_id'),
					(select node_id from etape_par_id where id_local = r.element ->> 'step_id')
			) from regles r
		), '[]'::jsonb),
		-- Une exigence EST son identité : elle existe ou elle n'existe pas. Aucun attribut à
		-- comparer, donc aucun `modified` possible sur cette collection (§4 ter.3).
		'required_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id', (select from_node_id from arc_par_id  where id_local = x.element ->> 'transition_id'),
					'to_node_id',   (select to_node_id   from arc_par_id  where id_local = x.element ->> 'transition_id'),
					'field_key',    (select cle          from champ_par_id where id_local = x.element ->> 'field_id')
				) order by
					(select from_node_id from arc_par_id  where id_local = x.element ->> 'transition_id'),
					(select to_node_id   from arc_par_id  where id_local = x.element ->> 'transition_id'),
					(select cle          from champ_par_id where id_local = x.element ->> 'field_id')
			) from exigences x
		), '[]'::jsonb),
		-- `CRM-112` T2.c.2 : un champ commun se nomme par sa clé, que le document porte ; une exigence est son identité.
		'required_common_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id',     (select from_node_id from arc_par_id where id_local = c.element ->> 'transition_id'),
					'to_node_id',       (select to_node_id   from arc_par_id where id_local = c.element ->> 'transition_id'),
					'common_field_key', c.element -> 'key'
				) order by
					(select from_node_id from arc_par_id where id_local = c.element ->> 'transition_id'),
					(select to_node_id   from arc_par_id where id_local = c.element ->> 'transition_id'),
					c.element ->> 'key'
			) from exigences_communes c
		), '[]'::jsonb)
	)
	  from document d
	 where d.j is not null;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Le document cible d'une suggestion de modification : l'étape existante garde sa surcharge (décision 882).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.document_cible_ia(p_workflow uuid, p_proposition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	vivant      jsonb := app.workflow_composition_document(p_workflow);
	espace      uuid;
	etapes      jsonb := '{}'::jsonb;
	aretes      jsonb := '{}'::jsonb;
	champs      jsonb := '{}'::jsonb;
	l_etapes    jsonb := '[]'::jsonb;
	l_aretes    jsonb := '[]'::jsonb;
	l_champs    jsonb := '[]'::jsonb;
	l_regles    jsonb := '[]'::jsonb;
	l_exigences jsonb := '[]'::jsonb;
	e           record;
	existant    jsonb;
	identifiant uuid;
	options     jsonb;
	surcharges  jsonb;
	le_noeud    uuid;
begin
	select w.workspace_id into espace from public.workflows w where w.id = p_workflow;

	for e in select value as v, ordinality as rang from jsonb_array_elements(p_proposition -> 'etapes') with ordinality loop
		select x into existant from jsonb_array_elements(vivant -> 'steps') x where x ->> 'node_key' = e.v ->> 'noeud';
		if existant is not null then
			-- `CRM-113` (docs/SPEC-ia.md §14.3) : la surcharge vivante n'est gardée que si la cible n'en dit rien.
			surcharges := app.ai_step_overrides((existant ->> 'node_id')::uuid, e.v,
				existant ->> 'label_override', (existant ->> 'probability_override')::numeric, true);
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', existant -> 'id', 'node_id', existant -> 'node_id', 'position', e.rang,
				'label_override', surcharges -> 'label_override', 'probability_override', surcharges -> 'probability_override',
				'stale_after_days', existant -> 'stale_after_days', 'is_initial', e.v -> 'initiale')
				-- `CRM-133` (décision 882) : l'assistant ne propose aucune description ; l'étape existante garde la sienne.
				|| jsonb_strip_nulls(jsonb_build_object('description_override', existant -> 'description_override')));
			etapes := etapes || jsonb_build_object(e.v ->> 'noeud', existant -> 'id');
		else
			identifiant := gen_random_uuid();
			le_noeud := (select n.id from public.workflow_nodes_catalog n
			              where n.workspace_id = espace and n.key = e.v ->> 'noeud' and n.archived_at is null);
			surcharges := app.ai_step_overrides(le_noeud, e.v, null, null, false);
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', identifiant, 'node_id', le_noeud, 'position', e.rang,
				'label_override', surcharges -> 'label_override', 'probability_override', surcharges -> 'probability_override',
				'stale_after_days', null, 'is_initial', e.v -> 'initiale'));
			etapes := etapes || jsonb_build_object(e.v ->> 'noeud', identifiant);
		end if;
		existant := null;
	end loop;

	for e in select value as v from jsonb_array_elements(p_proposition -> 'transitions') loop
		select x into existant from jsonb_array_elements(vivant -> 'transitions') x
		 where x ->> 'from_step_id' = etapes ->> (e.v ->> 'de') and x ->> 'to_step_id' = etapes ->> (e.v ->> 'vers');
		identifiant := coalesce((existant ->> 'id')::uuid, gen_random_uuid());
		l_aretes := l_aretes || jsonb_build_array(jsonb_build_object(
			'id', identifiant, 'from_step_id', etapes -> (e.v ->> 'de'), 'to_step_id', etapes -> (e.v ->> 'vers'),
			'label', nullif(btrim(e.v ->> 'libelle'), ''), 'require_comment', e.v -> 'commentaire_requis'));
		aretes := aretes || jsonb_build_object(format('%s>%s', e.v ->> 'de', e.v ->> 'vers'), identifiant);
		existant := null;
	end loop;

	for e in select value as v, ordinality as rang from jsonb_array_elements(p_proposition -> 'champs') with ordinality loop
		select x into existant from jsonb_array_elements(vivant -> 'fields') x
		 where x ->> 'key' = e.v ->> 'cle' and x -> 'archived_at' = 'null'::jsonb;
		identifiant := coalesce((existant ->> 'id')::uuid, gen_random_uuid());
		options := coalesce(existant -> 'options', '{}'::jsonb) - 'choices' - 'currency';
		if e.v ->> 'type' in ('select', 'multiselect') then
			-- Un choix dont le libellé est inchangé garde sa clé : les réponses déjà données la portent.
			options := options || jsonb_build_object('choices', (
				select coalesce(jsonb_agg(jsonb_build_object(
					'key', coalesce(
						(select a ->> 'key' from jsonb_array_elements(coalesce(existant -> 'options' -> 'choices', '[]'::jsonb)) a
						  where btrim(a ->> 'label') = btrim(c.libelle) limit 1),
						app.cle_de_libelle_ia(c.libelle)),
					'label', btrim(c.libelle)) order by c.rang), '[]'::jsonb)
				  from jsonb_array_elements_text(e.v -> 'choix') with ordinality as c(libelle, rang)));
		elsif e.v ->> 'type' = 'money' then
			options := options || jsonb_build_object('currency', e.v ->> 'devise');
		end if;
		l_champs := l_champs || jsonb_build_array(jsonb_build_object(
			'id', identifiant, 'key', e.v ->> 'cle', 'label', btrim(e.v ->> 'libelle'), 'type', e.v ->> 'type',
			'options', options, 'help_text', nullif(btrim(e.v ->> 'aide'), ''), 'position', e.rang, 'archived_at', null));
		champs := champs || jsonb_build_object(e.v ->> 'cle', identifiant);
		existant := null;
	end loop;
	-- Les champs déjà archivés restent tels quels.
	l_champs := l_champs || coalesce((select jsonb_agg(x) from jsonb_array_elements(vivant -> 'fields') x
	                                   where x -> 'archived_at' <> 'null'::jsonb), '[]'::jsonb);

	l_regles := coalesce((select jsonb_agg(jsonb_build_object(
			'field_id', champs -> (r ->> 'champ'), 'step_id', etapes -> (r ->> 'etape'), 'visibility', r ->> 'visibilite'))
		  from jsonb_array_elements(p_proposition -> 'regles') r), '[]'::jsonb)
		|| coalesce((select jsonb_agg(x) from jsonb_array_elements(vivant -> 'rules') x
		              where x ->> 'field_id' in (select f ->> 'id' from jsonb_array_elements(vivant -> 'fields') f
		                                          where f -> 'archived_at' <> 'null'::jsonb)
		                and x ->> 'step_id' in (select v #>> '{}' from jsonb_each(etapes) as t(k, v))), '[]'::jsonb);

	l_exigences := coalesce((select jsonb_agg(jsonb_build_object(
			'transition_id', aretes -> format('%s>%s', x ->> 'de', x ->> 'vers'), 'field_id', champs -> (x ->> 'champ')))
		  from jsonb_array_elements(p_proposition -> 'exigences') x), '[]'::jsonb)
		|| coalesce((select jsonb_agg(y) from jsonb_array_elements(vivant -> 'required_fields') y
		              where y ->> 'field_id' in (select f ->> 'id' from jsonb_array_elements(vivant -> 'fields') f
		                                          where f -> 'archived_at' <> 'null'::jsonb)
		                and y ->> 'transition_id' in (select v #>> '{}' from jsonb_each(aretes) as t(k, v))), '[]'::jsonb);

	-- CRM-112 T2.d.0 : les champs communs exigés VIVANTS sont repris tels quels sur les transitions que la proposition
	-- garde. Sans cette reprise, `app.appliquer_composition` lirait leur absence comme « aucune exigence » et les
	-- retirerait à l'acceptation (docs/SPEC-champs-communs.md §5). L'assistant ne les propose ni ne les retire.
	return jsonb_build_object('workflow', vivant -> 'workflow', 'steps', l_etapes, 'transitions', l_aretes,
	                          'fields', l_champs, 'rules', l_regles, 'required_fields', l_exigences)
	    || case
	       -- `CRM-112` T2.d.2 (décision 825) : une proposition qui PORTE `exigences_communes` décide, même vide ; ses clés
	       -- sont résolues dans l'espace. Une proposition qui ne la porte pas (révision antérieure) garde les exigences
	       -- vivantes des transitions gardées, comme la `0159`.
	       when p_proposition ? 'exigences_communes' then
	           coalesce((select jsonb_build_object('required_common_fields', jsonb_agg(jsonb_build_object(
	                        'transition_id', aretes -> format('%s>%s', x ->> 'de', x ->> 'vers'),
	                        'common_field_id', f.id,
	                        'key', f.key)))
	                       from jsonb_array_elements(p_proposition -> 'exigences_communes') x
	                       join public.card_common_fields f
	                         on f.workspace_id = espace and f.key = x ->> 'champ' and f.archived_at is null
	                     having count(*) > 0), '{}'::jsonb)
	       else
	           coalesce((select jsonb_build_object('required_common_fields', jsonb_agg(y))
	                       from jsonb_array_elements(vivant -> 'required_common_fields') y
	                      where y ->> 'transition_id' in (select v #>> '{}' from jsonb_each(aretes) as t(k, v))
	                     having count(*) > 0), '{}'::jsonb)
	       end;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Le journal d'audit (`0115`) : les deux colonnes NOMMÉES, jamais recopiées — une prose n'est pas une valeur courte.
-- ---------------------------------------------------------------------------------------------------------------------
drop trigger if exists workflow_steps_audit on public.workflow_steps;
create trigger workflow_steps_audit after insert or update or delete on public.workflow_steps
	for each row execute function app.audit_configuration('workflow_step', 'label_override',
		'node_id', 'label_override', 'probability_override', 'stale_after_days', 'is_initial', 'description_override');
drop trigger if exists workflow_nodes_catalog_audit on public.workflow_nodes_catalog;
create trigger workflow_nodes_catalog_audit after insert or update or delete on public.workflow_nodes_catalog
	for each row execute function app.audit_configuration('workflow_node', 'label',
		'key', 'label', 'kind', 'color', 'default_probability', 'default_stale_after_days', 'archived_at', 'description');

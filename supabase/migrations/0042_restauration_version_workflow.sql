-- @spec CRM-078 (docs/BACKLOG.md) — versionnement des workflows, quatrième tranche : l'application
--       transactionnelle du plan et son retour arrière
-- @spec docs/SPEC-workflow-engine.md §7 ter.13 (la tranche), §7 ter.13.2 (le plan rejoué dans la
--       transaction), §7 ter.13.3 (ce qui est restauré et ce qui ne l'est pas), §7 ter.13.4 (les
--       champs ne sont jamais supprimés), §7 ter.13.5 (le point de retour publié), §7 ter.13.6 (le
--       geste et ses huit refus), §7 ter.13.7 (l'ordre des écritures), §7 ter.13.8 (ce que la
--       fonction rend), §7 ter.13.9 (autorisations), §7 ter.13.10 (contrat d'API)
-- @spec docs/SPEC-workflow-engine.md §7 ter.2 (document canonique), §7 ter.5 (publier), §7 ter.12
--       (le plan de remappage)
-- @spec docs/SPEC-cards.md §3.3 (current_step_id lié au workflow), §14.4 (événement `moved`)
-- @spec docs/SPEC-form-composer.md §5 (les valeurs saisies survivent à l'archivage)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- Les trois premières tranches conservent une photographie, la comparent, et disent où chaque
-- affaire atterrirait. Aucune n'écrit. Celle-ci ÉCRIT : elle rend la composition vivante égale à
-- celle qu'une version a photographiée, en une transaction ou pas du tout.
--
-- Non livré, et nommé (§7 ter.13.11) : tout écran, la restauration de l'identité du workflow, la
-- suppression d'un champ — qui n'existe pas dans ce produit —, la purge des versions et le
-- changement de type d'un champ.
--
-- ---------------------------------------------------------------------------------------------
-- LE PLAN EST REJOUÉ ICI, ET JAMAIS TRANSMIS.
-- ---------------------------------------------------------------------------------------------
-- Un plan calculé à 14 h 03 et appliqué à 14 h 09 décrit un monde qui n'existe peut-être plus. La
-- fonction appelle donc `public.plan_card_remapping` dans sa PROPRE transaction et exige `ready`.
-- Un plan transmis par l'appelant serait une affirmation sur l'état de la base, et une affirmation
-- ne se vérifie pas moins cher qu'elle ne se recalcule.
--
-- Conséquence voulue : les huit refus du §7 ter.12.4 remontent TELS QUELS, avec leur message et
-- leur SQLSTATE. Les réécrire aurait donné deux formulations de la même règle.
--
-- ---------------------------------------------------------------------------------------------
-- `SECURITY DEFINER`, ET C'EST LA MESURE QUI L'A IMPOSÉ.
-- ---------------------------------------------------------------------------------------------
-- La première rédaction de la spécification retenait `security invoker`, au motif exact que les
-- tables de structure portent toutes leurs politiques d'écriture d'administrateur. Mais la
-- restauration ne fait pas qu'écrire la structure : elle DÉPLACE DES AFFAIRES.
--
-- MESURÉ le 2026-08-15 : `authenticated` ne détient l'`UPDATE` sur `public.cards` que colonne par
-- colonne, sur douze colonnes, et `current_step_id` n'en fait PAS partie — c'est le privilège de
-- colonne de CRM-034 qui ferme le `PATCH` direct d'une affaire (INC-046). C'est exactement
-- pourquoi `move_card`, `move_card_to_channel` et `change_channel_workflow` sont toutes les trois
-- `security definer`. Un `invoker` échouerait en `42501` sur la deuxième écriture, y compris pour
-- un administrateur.
--
-- CE QUE CE CHOIX OBLIGE À ÉCRIRE À LA MAIN : sous `definer`, la RLS ne fait plus le travail de la
-- vérification 2. Elle porte donc explicitement `app.is_workspace_member`, comme
-- `publish_workflow_version`, et rend `version introuvable` dans les deux cas — sans quoi un
-- identifiant d'autrui tomberait sur le refus d'administration, et la fonction deviendrait
-- l'oracle d'existence que tout ce chapitre refuse d'être.
--
-- ---------------------------------------------------------------------------------------------
-- LE RETOUR ARRIÈRE EST UN POINT DE RETOUR PUBLIÉ, ET NON UN JOURNAL PARALLÈLE.
-- ---------------------------------------------------------------------------------------------
-- Conserver l'état d'avant dans une table dédiée aurait été une SECONDE forme de conservation
-- d'une composition, à côté de `workflow_versions` qui existe pour cela ; deux mécanismes pour la
-- même chose divergent toujours, et l'un des deux finit non testé.
--
-- La composition vivante est donc publiée comme version AVANT toute écriture, par la vraie RPC.
-- Le retour arrière n'est alors pas un geste de plus : c'est la restauration elle-même, appliquée
-- au point de retour, donc LE MÊME CODE, éprouvé par les mêmes preuves.
--
-- ---------------------------------------------------------------------------------------------
-- IDEMPOTENCE ET CONVERGENCE : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de CRM-001 ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). La fonction est posée en `create or
-- replace`, son propriétaire et ses privilèges sont RÉAFFIRMÉS à chaque passage, de sorte qu'un
-- `grant` retiré à la main soit RÉTABLI par un rejeu (décision 57).

begin;

create or replace function public.restore_workflow_version(
	target_version_id         uuid,
	step_overrides            jsonb default null,
	expected_live_fingerprint text  default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	version_cible    public.workflow_versions;
	workflow_vivant  public.workflows;
	empreinte_avant  text;
	derniere         public.workflow_versions;
	point_retour     public.workflow_versions;
	point_publie     boolean := false;
	plan             jsonb;
	etapes_bloquees  text;
	noeud_absent     uuid;
	doc              jsonb;
	n_cards          bigint := 0;
	n_step_new       bigint := 0;
	n_step_del       bigint := 0;
	n_step_maj       bigint := 0;
	n_tr_new         bigint := 0;
	n_tr_del         bigint := 0;
	n_tr_maj         bigint := 0;
	n_ch_new         bigint := 0;
	n_ch_des         bigint := 0;
	n_ch_arc         bigint := 0;
	n_ch_maj         bigint := 0;
	n_rg_new         bigint := 0;
	n_rg_del         bigint := 0;
	n_rg_maj         bigint := 0;
	n_rq_new         bigint := 0;
	n_rq_del         bigint := 0;
	empreinte_apres  text;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. La version existe ET l'appelant est membre de son workspace. Sous `security definer`, la
	--    RLS ne fait PAS ce travail : l'appartenance est donc écrite à la main, exactement comme
	--    dans `publish_workflow_version`. Ce contrôle PRÉCÈDE celui d'administration, faute de quoi
	--    le message d'administration révélerait l'existence d'une version d'autrui.
	select v.* into version_cible
	  from public.workflow_versions v
	 where v.id = target_version_id;

	if not found or not app.is_workspace_member(version_cible.workspace_id) then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 3. Administrateur du workspace. Restaurer écrit la structure de travail de tout un channel.
	if not app.is_workspace_admin(version_cible.workspace_id) then
		raise exception 'restauration reservee aux administrateurs'
			using errcode = '42501',
			      detail  = 'la restauration d''une version est une prerogative d''administration';
	end if;

	-- LE VERROU, avant toute lecture de composition. Sans lui, deux restaurations simultanées
	-- liraient la même structure vivante et la seconde écraserait la première sans le savoir.
	-- C'est le geste du §7 ter.5, pour le même motif.
	select w.* into workflow_vivant
	  from public.workflows w
	 where w.id = version_cible.workflow_id
	   for update;

	-- 4. Un workflow archivé est un workflow sorti du service. Planifier restait permis (§7
	--    ter.12.4) parce que planifier ne fait que lire ; restaurer écrit, et le refus est ici.
	if workflow_vivant.archived_at is not null then
		raise exception 'workflow archive'
			using errcode = 'P0001',
			      detail  = 'un workflow archive ne peut pas etre restaure';
	end if;

	empreinte_avant := app.workflow_composition_fingerprint(workflow_vivant.id);

	-- 5. Concurrence OPTIMISTE et facultative : l'appelant dit l'empreinte vivante telle qu'il l'a
	--    vue en demandant le plan. Une divergence n'est pas une erreur de l'appelant — c'est l'état
	--    du monde qui a changé sous lui —, d'où le `409` et non le `400`.
	--
	--    LE SQLSTATE EST `PT409`, ET C'EST LA MESURE QUI L'A IMPOSÉ. La première rédaction levait
	--    `P0001`, comme les sept autres refus. MESURÉ le 2026-08-15 par une sonde posée puis retirée
	--    sur la pile locale : PostgREST rend **HTTP 400** pour tout `P0001`, et **HTTP 409** pour un
	--    SQLSTATE de la forme `PT<statut>`. Les deux exigences du §7 ter.13.6 — « `P0001` » et
	--    « `409` » — étaient donc inconciliables, et le refus rendait `400` en pratique.
	--    Ce qui est ARGUMENTÉ dans la spécification est le code HTTP : « la demande était valide,
	--    c'est l'état du monde qui a changé sous elle ; un `400` laisserait croire à une erreur de
	--    l'appelant ». Le `P0001` n'y est argumenté nulle part — c'est la valeur par défaut de
	--    `raise exception`, écrite par symétrie. C'est donc lui qui cède, et la colonne SQLSTATE du
	--    §7 ter.13.6 a été révisée avec son motif plutôt que le `409` abandonné en silence.
	--    Le message et le `detail` sont inchangés : seul le véhicule du statut change.
	if expected_live_fingerprint is not null
	   and expected_live_fingerprint <> empreinte_avant then
		raise exception 'structure modifiee depuis le plan'
			using errcode = 'PT409',
			      detail  = 'la composition vivante a change depuis le calcul du plan',
			      hint    = 'redemandez le plan avant d''appliquer';
	end if;

	-- 6 et 7. LE PLAN EST REJOUÉ ICI. `card_limit` vaut 1 : seuls le verdict et les compteurs sont
	--    lus, et ceux-ci portent sur la TOTALITÉ des affaires (§7 ter.12.6). Les huit refus du plan
	--    remontent tels quels — c'est le seul endroit où la règle de remappage est écrite.
	plan := public.plan_card_remapping(target_version_id, step_overrides, 1);

	if not (plan ->> 'ready')::boolean then
		-- Le refus NOMME les étapes qui bloquent : un « plan non applicable » sec obligerait
		-- l'appelant à redemander le plan pour savoir quoi corriger.
		select pg_catalog.string_agg(e.value ->> 'label', ', ' order by e.value ->> 'label')
		  into etapes_bloquees
		  from pg_catalog.jsonb_array_elements(plan -> 'steps' -> 'removed') as e(value)
		 where (e.value ->> 'cards_unresolved')::bigint > 0;

		raise exception 'plan non applicable'
			using errcode = 'P0001',
			      detail  = (plan -> 'summary' ->> 'cards_unresolved')
			                || ' affaire(s) sans destination sur : '
			                || coalesce(etapes_bloquees, 'etape inconnue'),
			      hint    = 'fournissez une instruction step_overrides pour chacune de ces etapes';
	end if;

	doc := version_cible.composition;

	-- 8. Une étape rétablie porte un `node_id`, lié au catalogue par une clé `on delete restrict`.
	--    Le catalogue n'expose aucune suppression, donc le cas ne peut naître que d'une purge
	--    d'administration ; le contrôle explicite rend alors un refus lisible plutôt qu'un `23503`
	--    brut (CLAUDE.md §20).
	select (e.value ->> 'node_id')::uuid into noeud_absent
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_steps s
		 where s.id = (e.value ->> 'id')::uuid and s.workflow_id = workflow_vivant.id
	 )
	   and not exists (
		select 1 from public.workflow_nodes_catalog n
		 where n.id = (e.value ->> 'node_id')::uuid
		   and n.workspace_id = workflow_vivant.workspace_id
	 )
	 limit 1;

	if noeud_absent is not null then
		raise exception 'noeud de catalogue introuvable'
			using errcode = 'P0001',
			      detail  = 'le noeud ' || noeud_absent::text
			                || ' a disparu du catalogue et une etape retablie l''instancie';
	end if;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 1 — LE POINT DE RETOUR, publié AVANT tout le reste puisqu'il photographie l'état
	-- d'avant. Publié si et seulement si la composition vivante diffère de la dernière version :
	-- lorsqu'elles sont égales, cette dernière EST déjà le point de retour, et en publier une
	-- seconde indiscernable est exactement ce que la vérification 5 du §7 ter.5 interdit.
	-- ---------------------------------------------------------------------------------------
	select v.* into derniere
	  from public.workflow_versions v
	 where v.workflow_id = workflow_vivant.id
	 order by v.version_number desc
	 limit 1;

	if derniere.composition_fingerprint is distinct from empreinte_avant then
		point_retour := public.publish_workflow_version(
			workflow_vivant.id,
			'Point de retour avant restauration de la version '
				|| version_cible.version_number::text
		);
		point_publie := true;
	else
		point_retour := derniere;
	end if;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 2 — LES AFFAIRES, avant toute suppression d'étape.
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
		  from pg_catalog.jsonb_array_elements(coalesce(step_overrides, '[]'::jsonb)) as e(value)
	)
	update public.cards c
	   set current_step_id = i.to_step_id,
	       entered_step_at = pg_catalog.now()
	  from instructions i
	 where c.workflow_id = workflow_vivant.id
	   and c.current_step_id = i.from_step_id;

	get diagnostics n_cards = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 3 — L'ÉTAPE INITIALE EST D'ABORD DÉMISE.
	--
	-- MESURÉ : `workflow_steps_workflow_initial_uk` est un index unique PARTIEL sur
	-- `(workflow_id) where is_initial`. Rétablir l'étape initiale de la version avant d'avoir
	-- défait l'actuelle échoue en `23505`. L'ordre n'est donc pas commutatif.
	-- ---------------------------------------------------------------------------------------
	update public.workflow_steps s
	   set is_initial = false
	 where s.workflow_id = workflow_vivant.id
	   and s.is_initial
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
		   and (e.value ->> 'is_initial')::boolean
	 );

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 4 — LES ÉTAPES RETIRÉES, dont les affaires sont parties. Leur suppression emporte
	-- en cascade leurs arêtes et leurs règles, ce qui allège les écritures 6 et 8.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_steps s
	 where s.workflow_id = workflow_vivant.id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
	 );

	get diagnostics n_step_del = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 5 — LES ÉTAPES RÉTABLIES, avec leur identifiant d'origine que le document conserve.
	-- Après la suppression : `workflow_steps_workflow_id_node_id_key` veut qu'un nœud n'apparaisse
	-- qu'une fois par workflow, et une étape rétablie peut réclamer le nœud d'une étape retirée.
	-- ---------------------------------------------------------------------------------------
	insert into public.workflow_steps (
		id, workflow_id, workspace_id, node_id, position,
		label_override, probability_override, stale_after_days, is_initial
	)
	select (e.value ->> 'id')::uuid,
	       workflow_vivant.id,
	       workflow_vivant.workspace_id,
	       (e.value ->> 'node_id')::uuid,
	       (e.value ->> 'position')::numeric,
	       e.value ->> 'label_override',
	       (e.value ->> 'probability_override')::numeric,
	       (e.value ->> 'stale_after_days')::integer,
	       (e.value ->> 'is_initial')::boolean
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_steps s where s.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_step_new = row_count;

	-- Les étapes conservées reprennent leurs colonnes photographiées. `is distinct from` : ce qui
	-- ne doit rien faire ne subit rien, et `updated_at` n'est pas réécrit sans motif.
	update public.workflow_steps s
	   set position             = (e.value ->> 'position')::numeric,
	       label_override       = e.value ->> 'label_override',
	       probability_override = (e.value ->> 'probability_override')::numeric,
	       stale_after_days     = (e.value ->> 'stale_after_days')::integer,
	       is_initial           = (e.value ->> 'is_initial')::boolean
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
	 where s.id = (e.value ->> 'id')::uuid
	   and s.workflow_id = workflow_vivant.id
	   and (s.position, s.label_override, s.probability_override, s.stale_after_days, s.is_initial)
	       is distinct from
	       ((e.value ->> 'position')::numeric, e.value ->> 'label_override',
	        (e.value ->> 'probability_override')::numeric,
	        (e.value ->> 'stale_after_days')::integer, (e.value ->> 'is_initial')::boolean);

	get diagnostics n_step_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 6 — LES ARÊTES. Leurs deux extrémités doivent exister, donc après les étapes. Une
	-- arête ne porte AUCUNE donnée utilisateur : la supprimer ne détruit que de la structure.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transitions t
	 where t.workflow_id = workflow_vivant.id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(doc -> 'transitions', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = t.id
	 );

	get diagnostics n_tr_del = row_count;

	insert into public.workflow_transitions (
		id, workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment
	)
	select (e.value ->> 'id')::uuid,
	       workflow_vivant.id,
	       workflow_vivant.workspace_id,
	       (e.value ->> 'from_step_id')::uuid,
	       (e.value ->> 'to_step_id')::uuid,
	       e.value ->> 'label',
	       (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transitions t where t.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_tr_new = row_count;

	update public.workflow_transitions t
	   set label           = e.value ->> 'label',
	       require_comment = (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where t.id = (e.value ->> 'id')::uuid
	   and t.workflow_id = workflow_vivant.id
	   and (t.label, t.require_comment)
	       is distinct from (e.value ->> 'label', (e.value ->> 'require_comment')::boolean);

	get diagnostics n_tr_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 7 — LES CHAMPS, ET AUCUN N'EST SUPPRIMÉ.
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
	       workflow_vivant.id,
	       workflow_vivant.workspace_id,
	       e.value ->> 'key',
	       e.value ->> 'label',
	       e.value ->> 'type',
	       coalesce(e.value -> 'options', '{}'::jsonb),
	       e.value ->> 'help_text',
	       (e.value ->> 'position')::numeric,
	       (e.value ->> 'archived_at')::timestamptz
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_fields f where f.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_ch_new = row_count;

	-- Désarchivage : compté à part de la mise à jour, parce que ce n'est pas le même fait pour un
	-- humain qui lit le compte rendu du geste.
	update public.form_fields f
	   set archived_at = null
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = workflow_vivant.id
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
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = workflow_vivant.id
	   and (f.key, f.label, f.type, f.options, f.help_text, f.position, f.archived_at)
	       is distinct from
	       (e.value ->> 'key', e.value ->> 'label', e.value ->> 'type',
	        coalesce(e.value -> 'options', '{}'::jsonb), e.value ->> 'help_text',
	        (e.value ->> 'position')::numeric, (e.value ->> 'archived_at')::timestamptz);

	get diagnostics n_ch_maj = row_count;

	-- Le champ surnuméraire : ARCHIVÉ, jamais supprimé. Ses valeurs saisies restent intactes.
	update public.form_fields f
	   set archived_at = pg_catalog.now()
	 where f.workflow_id = workflow_vivant.id
	   and f.archived_at is null
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = f.id
	 );

	get diagnostics n_ch_arc = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 8 — LES RÈGLES DE VISIBILITÉ. Elles lient un champ ET une étape, donc après les
	-- deux. Une partie a déjà disparu par la cascade des étapes supprimées ; le reste est traité
	-- ici, et le résultat ne dépend pas de savoir laquelle.
	-- ---------------------------------------------------------------------------------------
	delete from public.form_field_rules r
	 where r.workflow_id = workflow_vivant.id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'rules', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'field_id')::uuid = r.field_id
		   and (e.value ->> 'step_id')::uuid  = r.step_id
	 );

	get diagnostics n_rg_del = row_count;

	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	select (e.value ->> 'field_id')::uuid,
	       (e.value ->> 'step_id')::uuid,
	       workflow_vivant.id,
	       workflow_vivant.workspace_id,
	       e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'rules', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_field_rules r
		 where r.field_id = (e.value ->> 'field_id')::uuid
		   and r.step_id  = (e.value ->> 'step_id')::uuid
	 );

	get diagnostics n_rg_new = row_count;

	update public.form_field_rules r
	   set visibility = e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'rules', '[]'::jsonb)) as e(value)
	 where r.field_id = (e.value ->> 'field_id')::uuid
	   and r.step_id  = (e.value ->> 'step_id')::uuid
	   and r.visibility is distinct from (e.value ->> 'visibility');

	get diagnostics n_rg_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 9 — LES CHAMPS REQUIS PAR TRANSITION. Ils lient une arête et un champ, donc après
	-- les deux. Table de liaison pure : elle n'a rien à mettre à jour, seulement à créer ou à
	-- supprimer.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transition_required_fields rf
	 using public.workflow_transitions t
	 where t.id = rf.transition_id
	   and t.workflow_id = workflow_vivant.id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(doc -> 'required_fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'transition_id')::uuid = rf.transition_id
		   and (e.value ->> 'field_id')::uuid      = rf.field_id
	 );

	get diagnostics n_rq_del = row_count;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select (e.value ->> 'transition_id')::uuid,
	       (e.value ->> 'field_id')::uuid
	  from pg_catalog.jsonb_array_elements(
	       coalesce(doc -> 'required_fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transition_required_fields rf
		 where rf.transition_id = (e.value ->> 'transition_id')::uuid
		   and rf.field_id      = (e.value ->> 'field_id')::uuid
	 );

	get diagnostics n_rq_new = row_count;

	-- L'empreinte est RECALCULÉE, jamais recopiée depuis la version. Elle peut différer sans
	-- qu'aucune erreur n'ait eu lieu : la clé `workflow` n'est pas restaurée (§7 ter.13.3), et un
	-- champ surnuméraire archivé reste dans le document avec son `archived_at`. Rendre le booléen
	-- plutôt que de prétendre à l'égalité est la seule réponse honnête.
	empreinte_apres := app.workflow_composition_fingerprint(workflow_vivant.id);

	return pg_catalog.jsonb_build_object(
		'version', pg_catalog.jsonb_build_object(
			'version_id',              version_cible.id,
			'version_number',          version_cible.version_number,
			'workflow_id',             version_cible.workflow_id,
			'composition_fingerprint', version_cible.composition_fingerprint
		),
		'rollback_version', pg_catalog.jsonb_build_object(
			'version_id',     point_retour.id,
			'version_number', point_retour.version_number,
			'published',      point_publie
		),
		'cards',           pg_catalog.jsonb_build_object('remapped', n_cards),
		'steps',           pg_catalog.jsonb_build_object(
			'created', n_step_new, 'deleted', n_step_del, 'updated', n_step_maj),
		'transitions',     pg_catalog.jsonb_build_object(
			'created', n_tr_new, 'deleted', n_tr_del, 'updated', n_tr_maj),
		'fields',          pg_catalog.jsonb_build_object(
			'created', n_ch_new, 'unarchived', n_ch_des,
			'archived', n_ch_arc, 'updated', n_ch_maj),
		'rules',           pg_catalog.jsonb_build_object(
			'created', n_rg_new, 'deleted', n_rg_del, 'updated', n_rg_maj),
		'required_fields', pg_catalog.jsonb_build_object('created', n_rq_new, 'deleted', n_rq_del),
		'fingerprint_after', empreinte_apres,
		'matches_version',   empreinte_apres = version_cible.composition_fingerprint
	);
end;
$$;

-- Propriétaire explicite : c'est lui qui prête ses droits sous `security definer`, et un
-- propriétaire implicite dépendrait du rôle qui a appliqué la migration.
alter function public.restore_workflow_version(uuid, jsonb, text) owner to postgres;

comment on function public.restore_workflow_version(uuid, jsonb, text) is
	'CRM-078 — docs/SPEC-workflow-engine.md §7 ter.13. Rend la composition vivante d''un workflow '
	'égale à celle qu''une version a photographiée, en une transaction ou pas du tout. Rejoue '
	'plan_card_remapping et exige ready ; ses huit refus remontent tels quels. Publie d''abord la '
	'composition vivante comme POINT DE RETOUR par la vraie RPC, sauf si la dernière version joue '
	'déjà ce rôle : le retour arrière est alors la restauration de ce point, donc le même code. '
	'Restaure steps, transitions, fields, rules et required_fields — jamais la clé workflow, qui '
	'est l''identité et le placement. UN CHAMP SURNUMÉRAIRE EST ARCHIVÉ, JAMAIS SUPPRIMÉ. '
	'SECURITY DEFINER parce que déplacer une affaire exige un privilège de colonne qu''aucun '
	'authenticated ne détient.';

-- La révocation nommée d'`anon` est obligatoire : le `grant execute` par défaut de l'image porte
-- sur `anon` aussi (décision 80). Sans elle, l'anonyme obtiendrait 403 au lieu de 401.
revoke all on function public.restore_workflow_version(uuid, jsonb, text) from public, anon;
grant execute on function public.restore_workflow_version(uuid, jsonb, text)
	to authenticated, service_role;

commit;

-- @spec CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, lignage et divergence
-- @spec docs/SPEC-workflow-engine.md §4.2 (signature), §4.3 (vérifications), §4.4 (codes HTTP),
--       §4.5 (ce qui est copié), §4.6 (vue de divergence), §4.7 (privilèges), §4.8 (champs)
-- @spec docs/SCHEMA.md §3 (workflows, étapes, transitions), §9 (fonctions)
-- @spec docs/SPEC-permissions-rls.md §4 (écriture réservée aux administrateurs), §7 (refus n° 2, n° 11)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/INCONSISTENCY_REPORT.md INC-037 (champs de formulaire absents jusqu'à CRM-035),
--       INC-038 (angle mort du signal de divergence), INC-039 (ordre de suppression d'un workspace)
--
-- Un track peut vouloir son propre cycle. La copie est une **divergence assumée**
-- (docs/SPEC-workflow-engine.md §4.1) : le workflow copié vit sa vie, et rien ne se propage.
-- `CRM-031` avait posé les deux colonnes de traçabilité et la clé étrangère `on delete set null`
-- qui va avec ; cette migration livre le geste qui les renseigne, et le moyen de savoir que
-- l'original a bougé depuis.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la fonction `public.copy_workflow_to_track`, ses quatre refus, le remappage des arêtes
-- par le nœud, la vue `public.workflow_derivations` qui porte le signal de divergence, et les
-- privilèges **explicites** des deux objets.
--
-- Non livré, et nommé :
--
--   * la **copie des champs de formulaire**, que la Definition of Done exige. `form_fields` est
--     livrée par `CRM-035`, deux unités plus loin — MESURÉ : `to_regclass('public.form_fields')`
--     rend `NULL`. Aucune table n'est créée par anticipation. Cette version historique ne copie
--     plus le tableau transitoire `require_fields` : CRM-018 possède désormais la copie complète
--     et remappée, et ce retrait rend le rejeu convergent après suppression de la colonne ;
--
--   * la détection d'une **suppression** dans la source. MESURÉ : retirer une arête ne modifie
--     aucun `updated_at`, et `source_modified_since_copy` reste faux alors que la source a divergé.
--     Corriger cela engage le schéma — trois options dans INC-038 —, ce qui dépasse cette unité.
--     L'angle mort est **figé par une assertion** plutôt que laissé à la mémoire ;
--
--   * la **contrainte d'affectation** d'un channel à un workflow de portée `track`
--     (docs/SPEC-workflow-engine.md §4.12). Elle relève de `CRM-033`, avec la contrainte `NOT NULL`
--     qu'INC-029 laisse due. Cette unité la rend nécessaire — un workflow `track` existe désormais
--     dans le seed — sans la livrer.
--
-- ---------------------------------------------------------------------------------------------
-- Le privilège par défaut de l'image, et pourquoi cette migration révoque nommément.
-- ---------------------------------------------------------------------------------------------
-- MESURÉ, et contraire à l'attente (docs/JOURNAL.md, décision 80) : une fonction créée dans
-- `public` puis « protégée » par `revoke all … from public` reste **exécutable par la clé
-- anonyme**. L'image livre des `ALTER DEFAULT PRIVILEGES` qui accordent nommément à `anon`,
-- `authenticated` et `service_role` l'exécution de toute fonction nouvelle du schéma `public`, et
-- **tous** les droits (`arwdDxtm`) de toute vue nouvelle. Un `revoke` visant `public` ne les touche
-- pas.
--
-- C'est la première fois que le produit crée autre chose qu'une table dans `public` : ses fonctions
-- vivent dans le schéma `app`, que l'API n'expose pas. Les deux objets livrés ici doivent au
-- contraire être appelables par le client, donc naître dans `public` — et donc être fermés
-- nommément, ce que fait la section 4.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). `drop … if exists` précède chaque création :
-- `create or replace function` refuse de renommer un paramètre, et `create or replace view` refuse
-- de changer la liste des colonnes. Un rejeu **reconstruit** donc les deux objets, et la section 4
-- réapplique les privilèges — de sorte qu'un privilège relâché à la main soit **réparé** par le
-- rejeu, et non seulement laissé en l'état (décision 57).

-- =============================================================================================
-- 1. `public.copy_workflow_to_track`
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.2 et §4.3.
--
-- `SECURITY DEFINER` n'est pas une facilité : les politiques RLS ne s'appliquent pas au
-- propriétaire des tables, donc **c'est la fonction qui porte la règle d'accès**, par le contrôle
-- explicite de la section 1.2, et non les politiques, qu'elle contourne par construction.
--
-- `search_path` vidé : toute relation est pleinement qualifiée, y compris `auth.uid()` atteinte à
-- travers les fonctions du schéma `app`.

drop function if exists public.copy_workflow_to_track(uuid, uuid, text);

create function public.copy_workflow_to_track(
	workflow_id uuid,
	track_id    uuid,
	new_name    text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Les arguments sont recopiés dans des variables locales **avant tout usage** : `workflow_id`
	-- et `track_id` sont aussi des noms de colonnes des tables lues plus bas, et PL/pgSQL refuse
	-- une référence ambiguë (`42702`) plutôt que d'en choisir une.
	v_source_id uuid := workflow_id;
	v_track_id  uuid := track_id;
	v_nom       text := new_name;
	v_source    public.workflows%rowtype;
	v_copie_id  uuid;
begin
	-- --- 1.1 Le workflow existe, il est visible de l'appelant, il n'est pas archivé -------------
	-- « Visible » signifie `app.is_workspace_member`, et cette vérification passe **avant** celle
	-- du rôle : un workflow d'un autre workspace rend `workflow_not_found`, jamais `forbidden`.
	-- Répondre « interdit » confirmerait son existence à quelqu'un qui n'a pas le droit de le
	-- savoir (docs/JOURNAL.md, décision 82).
	--
	-- `P0001` par défaut, donc `400` — MESURÉ. `P0002`, le code naturel pour « rien ne
	-- correspond », est rendu **`500`** par PostgREST et serait donc lu comme une panne du produit
	-- (§4.4, décision 81).
	select w.* into v_source
	  from public.workflows w
	 where w.id = v_source_id
	   and w.archived_at is null
	   and app.is_workspace_member(w.workspace_id);

	if not found then
		raise exception 'workflow_not_found';
	end if;

	-- --- 1.2 L'appelant est administrateur du workspace -----------------------------------------
	-- docs/SPEC-permissions-rls.md §4 : l'écriture des workflows est réservée aux administrateurs.
	-- Une copie est une écriture. `42501` → `403`, MESURÉ.
	if not app.is_workspace_admin(v_source.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 1.3 Une copie ne se copie pas -----------------------------------------------------------
	-- docs/JOURNAL.md, décision 85. Une chaîne de dérivations rendrait `derived_from_workflow_id`
	-- illisible sans parcourir tout l'arbre, et le signal de divergence devrait dire **lequel des
	-- ancêtres** a changé — question à laquelle la spécification ne répond pas.
	if v_source.scope <> 'global' then
		raise exception 'workflow_not_global';
	end if;

	-- --- 1.4 Le track existe, dans le même workspace, et n'est pas archivé -----------------------
	-- Le même workspace : sans ce filtre, la clé étrangère composite de `workflows` refuserait de
	-- toute façon la ligne (`23503`), mais avec un message qui parle de contrainte et non de
	-- produit. Mieux vaut le refus explicite.
	if not exists (
		select 1
		  from public.tracks t
		 where t.id = v_track_id
		   and t.workspace_id = v_source.workspace_id
		   and t.archived_at is null
	) then
		raise exception 'track_not_found';
	end if;

	-- --- 1.5 Le workflow copié -------------------------------------------------------------------
	-- `is_default` **forcé à faux**, et ce n'est pas une précaution : MESURÉ, copier la colonne
	-- telle quelle depuis un workflow par défaut est refusé en `23505` par
	-- `workflows_workspace_default_uk`. Or le workflow que l'on copie est, en pratique, le workflow
	-- par défaut — la fonctionnalité échouerait sur son cas d'emploi principal.
	--
	-- `archived_at` n'est pas copié davantage : une copie naît active.
	--
	-- `new_name` nul signifie « reprendre le nom de la source ». Une chaîne vide n'est **pas**
	-- traitée comme nulle : elle est refusée par `workflows_name_check`, comme toute autre écriture
	-- (§4.2). Un nom vide est une erreur du client, pas une façon de demander le nom d'origine.
	insert into public.workflows (
		workspace_id, name, scope, track_id,
		derived_from_workflow_id, derived_at, is_default
	)
	values (
		v_source.workspace_id, coalesce(v_nom, v_source.name), 'track', v_track_id,
		v_source.id, now(), false
	)
	returning id into v_copie_id;

	-- --- 1.6 Les étapes, à l'identique -----------------------------------------------------------
	-- `position` est fournie, donc le trigger d'attribution ne se déclenche pas : les positions
	-- fractionnaires sont conservées telles quelles — MESURÉ, `1`, `2.5`, `3` donnent `1`, `2.5`,
	-- `3`. Renuméroter la copie changerait l'ordre du board sans que personne ne l'ait demandé.
	--
	-- `is_initial` est copié : au plus une étape initiale par workflow, et la source en portait au
	-- plus une, donc l'index unique partiel de la copie est satisfait par construction.
	insert into public.workflow_steps (
		workflow_id, workspace_id, node_id, position,
		label_override, probability_override, stale_after_days, is_initial
	)
	select v_copie_id, s.workspace_id, s.node_id, s.position,
	       s.label_override, s.probability_override, s.stale_after_days, s.is_initial
	  from public.workflow_steps s
	 where s.workflow_id = v_source.id;

	-- --- 1.7 Les arêtes, remappées par le nœud ---------------------------------------------------
	-- `(workflow_id, node_id)` est unique (docs/SPEC-workflow-engine.md §3.3) : dans un workflow
	-- donné, un nœud désigne **une** étape et une seule. Le nœud est donc la clé naturelle qui
	-- relie une étape de la source à son homologue dans la copie, et aucune table de correspondance
	-- n'est nécessaire (décision 83).
	--
	-- MESURÉ sur la sonde : zéro arête de la copie ne pointe vers une étape restée dans la source.
	--
	-- CRM-018 remplace ensuite cette version par la copie de composition complète. Ne pas nommer
	-- ici l'ancienne colonne `require_fields` est indispensable : le runner rejoue aussi cette
	-- migration sur un schéma final où la colonne a été remplacée par une table de liaison.
	insert into public.workflow_transitions (
		workflow_id, workspace_id, from_step_id, to_step_id,
		label, require_comment
	)
	select v_copie_id, t.workspace_id, copie_depuis.id, copie_vers.id,
	       t.label, t.require_comment
	  from public.workflow_transitions t
	  join public.workflow_steps source_depuis on source_depuis.id = t.from_step_id
	  join public.workflow_steps source_vers   on source_vers.id   = t.to_step_id
	  join public.workflow_steps copie_depuis
	    on copie_depuis.workflow_id = v_copie_id and copie_depuis.node_id = source_depuis.node_id
	  join public.workflow_steps copie_vers
	    on copie_vers.workflow_id   = v_copie_id and copie_vers.node_id   = source_vers.node_id
	 where t.workflow_id = v_source.id;

	return v_copie_id;
end;
$$;

comment on function public.copy_workflow_to_track(uuid, uuid, text) is
	'CRM-032 — docs/SPEC-workflow-engine.md §4. Duplique un workflow global, ses étapes et ses '
	'arêtes vers un track, en renseignant le lignage. La copie est une divergence assumée : rien '
	'ne se propage ensuite. Refus : workflow_not_found, forbidden, workflow_not_global, '
	'track_not_found.';

-- =============================================================================================
-- 2. `public.workflow_derivations` — le signal de divergence
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.6. La phrase que l'interface doit pouvoir dire — « dérive de X,
-- **modifié depuis** le jj/mm/aaaa » — n'est pas calculable à partir des seules colonnes de
-- `workflows` : modifier une étape ne touche pas la ligne du workflow, donc son `updated_at` ne
-- bouge pas. Il faut le plus récent `updated_at` du workflow **et de sa composition**.
--
-- `security_invoker = true` : les politiques RLS des tables sous-jacentes s'appliquent à
-- l'appelant, et non au propriétaire de la vue. MESURÉ : un rôle `anon` n'y voit aucune ligne là où
-- le propriétaire en voit une. Sans ce réglage, la vue serait une porte dérobée sur trois tables
-- protégées.
--
-- ANGLE MORT MESURÉ, ET NON CORRIGÉ ICI (INC-038) : une **suppression** dans la source ne modifie
-- aucun `updated_at`. Après le retrait d'une arête, `source_modified_since_copy` vaut toujours faux
-- alors que la source a divergé. Le corriger engage le schéma ; l'angle mort est figé par une
-- assertion de `supabase/tests/0008_copie_workflow.test.sql`.

drop view if exists public.workflow_derivations;

-- Le calcul du « dernier changement de la source » est **inline**, en trois sous-requêtes
-- scalaires, plutôt que confié à une fonction d'assistance : une fonction de plus dans `app`
-- serait un objet à documenter, à privilégier et à faire vivre, pour une expression qui tient en
-- quatre lignes et n'a qu'un seul appelant.
--
-- Les `coalesce` ne sont pas décoratifs : un workflow **sans étape** est un état légitime du
-- produit (docs/SPEC-workflow-engine.md §3.5, décision 72). Sans eux, `greatest` recevrait `NULL`
-- et la ligne du brouillon disparaîtrait du signal.

create view public.workflow_derivations with (security_invoker = true) as
select
	copie.id           as workflow_id,
	copie.workspace_id as workspace_id,
	copie.name         as name,
	copie.track_id     as track_id,
	copie.derived_at   as derived_at,
	source.id          as source_workflow_id,
	source.name        as source_name,
	source.archived_at as source_archived_at,
	greatest(
		source.updated_at,
		coalesce((select max(s.updated_at) from public.workflow_steps s
		           where s.workflow_id = source.id), source.updated_at),
		coalesce((select max(t.updated_at) from public.workflow_transitions t
		           where t.workflow_id = source.id), source.updated_at)
	) as source_modified_at,
	greatest(
		source.updated_at,
		coalesce((select max(s.updated_at) from public.workflow_steps s
		           where s.workflow_id = source.id), source.updated_at),
		coalesce((select max(t.updated_at) from public.workflow_transitions t
		           where t.workflow_id = source.id), source.updated_at)
	) > copie.derived_at as source_modified_since_copy
  from public.workflows copie
  join public.workflows source on source.id = copie.derived_from_workflow_id;

comment on view public.workflow_derivations is
	'CRM-032 — docs/SPEC-workflow-engine.md §4.6. Une ligne par workflow dérivé, avec la date du '
	'dernier changement de sa source, composition comprise. `security_invoker` : la RLS des tables '
	'sous-jacentes s''applique à l''appelant. Ne détecte pas une suppression dans la source '
	'(INC-038).';

-- =============================================================================================
-- 3. Privilèges explicites — nommément, et non par `public`
-- =============================================================================================
-- docs/JOURNAL.md, décision 80. `revoke … from public` ne retire pas un droit accordé nommément à
-- `anon` par les privilèges par défaut de l'image. Les deux objets sont donc fermés nommément,
-- puis rouverts au strict nécessaire.
--
-- MESURÉ : sans la révocation nommée, l'anonyme exécute la fonction. Avec elle, PostgREST rend
-- `401` — et non `403` : il traite l'absence de droit d'un appelant non authentifié comme une
-- invitation à s'authentifier.

revoke all on function public.copy_workflow_to_track(uuid, uuid, text) from public, anon;
grant execute on function public.copy_workflow_to_track(uuid, uuid, text)
	to authenticated, service_role;

-- La vue est en **lecture seule** : aucune écriture n'a de sens sur une jointure de deux workflows,
-- et les privilèges par défaut de l'image la livreraient autrement modifiable par les trois rôles.
revoke all on public.workflow_derivations from anon, authenticated;
grant select on public.workflow_derivations to anon, authenticated;
grant all privileges on public.workflow_derivations to service_role;

-- PostgREST met son schéma en cache : sans ce signal, la fonction et la vue ne sont pas visibles de
-- l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

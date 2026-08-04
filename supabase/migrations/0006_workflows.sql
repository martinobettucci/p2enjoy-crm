-- @spec CRM-031 (docs/BACKLOG.md) — workflows, étapes, transitions : structure, ordre, politiques
-- @spec docs/SPEC-workflow-engine.md §3.2 (workflows), §3.3 (étapes), §3.4 (transitions),
--       §3.5 (étape initiale), §3.6 (ordre), §3.7 (autorisations)
-- @spec docs/SCHEMA.md §2 (channels.workflow_id), §3 (workflows), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille de tables), §7 (preuves de refus)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/INCONSISTENCY_REPORT.md INC-029 (clé étrangère de channels.workflow_id),
--       INC-031 (garde d'archivage), INC-033 (require_fields sans intégrité référentielle)
--
-- Le graphe des états d'une card. Le catalogue de `CRM-030` dit quels états ont un nom ; un
-- workflow dit dans quel ordre une card les traverse et **quels déplacements sont permis**.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : les trois tables, la cohérence de portée `scope` / `track_id`, l'unicité du workflow par
-- défaut, l'unicité `(workflow, nœud)`, **au plus une étape initiale**, l'impossibilité
-- structurelle qu'une transition sorte de son workflow, l'attribution automatique de `position`
-- dans la portée du workflow, neuf politiques RLS, les privilèges explicites, et la clé étrangère
-- que `CRM-021` avait dû différer sur `channels.workflow_id` (INC-029).
--
-- Non livré, et nommé :
--
--   * **« au moins une étape initiale »**. MESURÉ : le seul mécanisme capable de l'exiger est un
--     `constraint trigger … deferrable initially deferred`, qui reporte le contrôle au `commit`.
--     Éprouvé sur une sonde : l'insertion isolée d'un workflow — exactement ce que fait PostgREST,
--     une requête valant une transaction — est acceptée, puis **le `commit` échoue**. La garde ne
--     protégerait rien : elle rendrait la création d'un workflow impossible par l'API, et
--     l'éditeur d'administration n'aurait aucun moyen de créer le premier objet qu'il édite. Un
--     workflow sans étape initiale est donc un **brouillon**, structurellement valide et
--     inutilisable ; la condition est reportée sur l'emploi — `CRM-033`, `CRM-040`
--     (docs/SPEC-workflow-engine.md §3.5, docs/JOURNAL.md décision 72) ;
--
--   * la contrainte **`NOT NULL`** sur `channels.workflow_id`, que `docs/SCHEMA.md` §2 exige. Elle
--     change le **contrat de création d'un channel** — créer un channel deviendrait impossible sans
--     désigner un workflow —, ce qui relève de `CRM-033` et de son trigger de cohérence. INC-029
--     est mise à jour, elle n'est pas close ;
--
--   * la **garde d'archivage d'un nœud occupé** (INC-031). Son chemin est
--     `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`. `workflow_steps`
--     existe désormais, `cards` non — MESURÉ : `to_regclass('public.cards')` rend `NULL`. La
--     limiter à l'occupation par une **étape** serait plus strict que la règle spécifiée et
--     trancherait à la place du responsable ;
--
--   * toute **intégrité référentielle sur `require_fields`**. MESURÉ, et propriété du type et non
--     différé : PostgreSQL refuse une clé étrangère depuis une colonne tableau — « Key columns
--     "require_fields" and "id" are of incompatible types: uuid[] and uuid ». INC-033.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (`docs/JOURNAL.md`, décision 20). Tout est donc rejouable, et les
-- contraintes sont **convergentes** : `drop constraint if exists` puis `add constraint`, de sorte
-- qu'un rejeu **répare** une contrainte retirée à la main plutôt que de la laisser manquante
-- (décision 57).

-- =============================================================================================
-- 0. L'unicité que le catalogue doit offrir à ses étapes
-- =============================================================================================
-- Une étape doit instancier un nœud **du même workspace** que son workflow. La seule façon de le
-- garantir par la base est une clé étrangère composite `(node_id, workspace_id)`, qui exige une
-- unicité correspondante sur le catalogue. MESURÉ : sans elle, la création échoue en `42830`,
-- « there is no unique constraint matching given keys for referenced table ».
--
-- `(id, workspace_id)` est unique par construction — `id` l'est déjà — et ne peut donc refuser
-- aucune ligne, existante ou future. C'est le même geste que `tracks_id_workspace_id_key`, posée
-- par `CRM-021` pour la même raison (docs/SPEC-channels.md §2.4).

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_nodes_catalog_id_workspace_id_key'
		   and conrelid = 'public.workflow_nodes_catalog'::regclass
	) then
		alter table public.workflow_nodes_catalog
			add constraint workflow_nodes_catalog_id_workspace_id_key unique (id, workspace_id);
	end if;
end
$$;

-- =============================================================================================
-- 1. `public.workflows`
-- =============================================================================================
-- docs/SCHEMA.md §3, complété par les « Conventions générales » du même document pour `created_at`
-- et `updated_at`, que le tableau du §3 omet — quatrième occurrence du même oubli (INC-025).

create table if not exists public.workflows (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	-- `global` : disponible pour tous les channels du workspace. `track` : réservé aux channels
	-- d'un track. Colonne `text` avec `CHECK` et non type énuméré, comme partout ailleurs dans ce
	-- schéma : `docs/SCHEMA.md` réserve les types PostgreSQL aux énumérations **stables**.
	scope        text        not null default 'global',
	-- Nul si `global`, renseigné si `track` — contrainte de la section 1.1. La clé étrangère est
	-- **composite** (section 1.2) : le track appartient alors au même workspace, garanti par la
	-- base et non par une politique.
	track_id     uuid,
	-- Trace de la copie (`CRM-032`), **pas un lien de dépendance** : la copie est une divergence
	-- assumée (docs/SPEC-workflow-engine.md §4). `on delete set null` et non `cascade` — supprimer
	-- l'original ne doit pas emporter ses copies.
	derived_from_workflow_id uuid references public.workflows (id) on delete set null,
	derived_at   timestamptz,
	-- Au plus un vrai par workspace (index unique partiel, section 1.3). « Au plus » et non
	-- « exactement » : un workspace neuf n'a aucun workflow, et exiger un défaut rendrait sa
	-- création impossible.
	is_default   boolean     not null default false,
	-- Suppression douce : un workflow est un objet de premier plan, l'archivage tient lieu de
	-- suppression. Aucun `grant delete` — voir la section 7.
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.workflows drop constraint if exists workflows_name_check;
alter table public.workflows add  constraint workflows_name_check
	check (btrim(name) <> '');

alter table public.workflows drop constraint if exists workflows_scope_check;
alter table public.workflows add  constraint workflows_scope_check
	check (scope in ('global', 'track'));

-- La cohérence de portée est une **contrainte**, pas une convention. Sans elle, un workflow
-- `global` portant un `track_id` résiduel serait un objet dont personne ne saurait dire s'il est
-- disponible pour tout le workspace ou pour un seul track
-- (docs/SPEC-workflow-engine.md §3.2, §4).
alter table public.workflows drop constraint if exists workflows_scope_track_check;
alter table public.workflows add  constraint workflows_scope_track_check
	check ((scope = 'global' and track_id is null)
	    or (scope = 'track'  and track_id is not null));

-- `derived_at` accompagne `derived_from_workflow_id` : l'un sans l'autre serait une trace
-- incomplète — une copie sans date, ou une date sans origine.
alter table public.workflows drop constraint if exists workflows_derivation_check;
alter table public.workflows add  constraint workflows_derivation_check
	check ((derived_from_workflow_id is null and derived_at is null)
	    or (derived_from_workflow_id is not null and derived_at is not null));

-- Un workflow ne dérive pas de lui-même. La clé étrangère l'accepterait ; la contrainte le refuse.
alter table public.workflows drop constraint if exists workflows_derivation_self_check;
alter table public.workflows add  constraint workflows_derivation_self_check
	check (derived_from_workflow_id is null or derived_from_workflow_id <> id);

-- --- 1.2 Le track d'un workflow appartient à son workspace ------------------------------------
-- Clé étrangère **composite**, et non simple vers `tracks (id)`. Une clé simple laisserait un
-- administrateur du workspace A rattacher son workflow à un track de B : aucune politique RLS ne
-- rattraperait cela, une politique décidant **qui écrit** la ligne, pas **ce que la ligne
-- raconte** (docs/JOURNAL.md, décision 73). L'unicité `tracks (id, workspace_id)` nécessaire
-- existe déjà, posée par `CRM-021`.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflows_track_id_workspace_id_fkey'
		   and conrelid = 'public.workflows'::regclass
	) then
		alter table public.workflows
			add constraint workflows_track_id_workspace_id_fkey
			foreign key (track_id, workspace_id)
			references public.tracks (id, workspace_id) on delete cascade;
	end if;
end
$$;

-- L'unicité dont les étapes et les transitions ont besoin pour leur propre clé composite.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflows_id_workspace_id_key'
		   and conrelid = 'public.workflows'::regclass
	) then
		alter table public.workflows
			add constraint workflows_id_workspace_id_key unique (id, workspace_id);
	end if;
end
$$;

-- --- 1.3 Au plus un workflow par défaut, par workspace ----------------------------------------
-- MESURÉ : la seconde ligne marquée par défaut dans le même workspace est refusée en `23505`.

create unique index if not exists workflows_workspace_default_uk
	on public.workflows (workspace_id)
	where is_default;

-- La question posée par tout sélecteur de workflow : « les workflows non archivés de ce workspace,
-- dans l'ordre ». L'index partiel ne porte que les lignes réellement listées.
create index if not exists workflows_workspace_name_idx
	on public.workflows (workspace_id, name)
	where archived_at is null;

create index if not exists workflows_track_idx
	on public.workflows (track_id)
	where track_id is not null;

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
	before update on public.workflows
	for each row execute function app.set_updated_at();

comment on table public.workflows is
	'CRM-031 — docs/SCHEMA.md §3. Graphe des états d''une card. Assemblé à partir des nœuds du '
	'catalogue (CRM-030) ; ses arêtes sont dans workflow_transitions.';
comment on column public.workflows.scope is
	'`global` (tous les channels du workspace) ou `track` (ceux d''un track). La cohérence avec '
	'`track_id` est une contrainte, pas une convention.';
comment on column public.workflows.track_id is
	'Non nul si `scope = track`. Clé étrangère **composite** avec `workspace_id` : le track '
	'appartient au même workspace, garanti par la base (docs/SPEC-workflow-engine.md §3.2).';
comment on column public.workflows.derived_from_workflow_id is
	'Trace de la copie (CRM-032), non un lien de dépendance : `on delete set null`, la copie '
	'survivant à la suppression de son origine.';
comment on column public.workflows.is_default is
	'Au plus un vrai par workspace. « Au plus » et non « exactement » : un workspace neuf n''a '
	'aucun workflow.';
comment on column public.workflows.archived_at is
	'Non nul = archivé : masqué des sélecteurs, réversible. Aucune suppression physique.';

-- =============================================================================================
-- 2. `public.workflow_steps`
-- =============================================================================================
-- L'instanciation d'un nœud du catalogue dans un workflow. `docs/SCHEMA.md` §3, complété de
-- `workspace_id` — que ses conventions générales exigent de toute table métier, « y compris
-- lorsqu'il serait déductible par jointure » — et des horodatages.

create table if not exists public.workflow_steps (
	id           uuid        primary key default gen_random_uuid(),
	workflow_id  uuid        not null,
	-- Dénormalisé pour que les politiques RLS restent simples et indexables, comme
	-- `channels.workspace_id`. Sa **véracité** n'est pas supposée : la clé composite de la
	-- section 2.2 la garantit.
	workspace_id uuid        not null,
	node_id      uuid        not null,
	-- `numeric` : index fractionnaire, comme partout ailleurs. Insérer une colonne entre deux
	-- autres n'exigera pas de renuméroter le board. `not null` **sans défaut de colonne** : le
	-- trigger de la section 4 la renseigne lorsqu'elle est omise.
	position     numeric     not null,
	-- Surcharges **locales et facultatives**. Ni la clé ni le type ne sont surchargeables : ils ne
	-- sont pas copiés ici, ils restent lus depuis le nœud, ce qui rend l'analytique comparable d'un
	-- channel à l'autre (docs/SPEC-workflow-engine.md §3.3).
	--
	-- Nullables, et `NULL` signifie « prendre la valeur du catalogue » — jamais « zéro ». Même
	-- distinction qu'au §2.5, et même conséquence.
	label_override           text,
	probability_override     numeric(5,2),
	stale_after_days         integer,
	-- Au plus une vraie par workflow (index unique partiel, section 2.3). « Au moins une » n'est
	-- pas imposable ici : voir l'en-tête et la décision 72.
	is_initial   boolean     not null default false,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 2.1 Contraintes de valeur, posées de façon convergente -----------------------------------
-- Une surcharge fournie doit être utilisable : un libellé vide n'est pas une surcharge, c'est une
-- colonne à effacer. Les bornes reprennent celles du catalogue (§2.5), pour que la surcharge ne
-- puisse pas exprimer ce que le nœud lui-même ne pourrait pas.

alter table public.workflow_steps drop constraint if exists workflow_steps_label_check;
alter table public.workflow_steps add  constraint workflow_steps_label_check
	check (label_override is null or btrim(label_override) <> '');

alter table public.workflow_steps drop constraint if exists workflow_steps_probability_check;
alter table public.workflow_steps add  constraint workflow_steps_probability_check
	check (probability_override is null
	       or (probability_override >= 0 and probability_override <= 100));

alter table public.workflow_steps drop constraint if exists workflow_steps_stale_check;
alter table public.workflow_steps add  constraint workflow_steps_stale_check
	check (stale_after_days is null or stale_after_days > 0);

-- --- 2.2 Les deux clés composites, et ce qu'elles garantissent --------------------------------
-- `(workflow_id, workspace_id)` : l'étape appartient au workflow **et** le `workspace_id`
-- dénormalisé dit la vérité. `on delete cascade` — supprimer un workflow emporte ses étapes, qui
-- n'ont aucune existence hors de lui.
--
-- `(node_id, workspace_id)` : le nœud instancié appartient au même workspace. `on delete restrict`
-- et non `cascade` : le catalogue n'expose aucune suppression (§2.6), mais si une purge en
-- supprimait un, l'effacement silencieux des étapes qui l'instancient détruirait des workflows
-- entiers sans le dire.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_steps_workflow_id_workspace_id_fkey'
		   and conrelid = 'public.workflow_steps'::regclass
	) then
		alter table public.workflow_steps
			add constraint workflow_steps_workflow_id_workspace_id_fkey
			foreign key (workflow_id, workspace_id)
			references public.workflows (id, workspace_id) on delete cascade;
	end if;

	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_steps_node_id_workspace_id_fkey'
		   and conrelid = 'public.workflow_steps'::regclass
	) then
		alter table public.workflow_steps
			add constraint workflow_steps_node_id_workspace_id_fkey
			foreign key (node_id, workspace_id)
			references public.workflow_nodes_catalog (id, workspace_id) on delete restrict;
	end if;

	-- `docs/SCHEMA.md` §3 : « un nœud n'apparaît qu'une fois par workflow ». Posée hors du
	-- `create table`, qui porte `if not exists` et ne rétablirait donc jamais une unicité retirée
	-- à la main sur une base existante (décision 57).
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_steps_workflow_id_node_id_key'
		   and conrelid = 'public.workflow_steps'::regclass
	) then
		alter table public.workflow_steps
			add constraint workflow_steps_workflow_id_node_id_key unique (workflow_id, node_id);
	end if;

	-- L'unicité dont les transitions ont besoin. MESURÉ : sans elle, leur clé composite échoue en
	-- `42830`.
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_steps_id_workflow_id_key'
		   and conrelid = 'public.workflow_steps'::regclass
	) then
		alter table public.workflow_steps
			add constraint workflow_steps_id_workflow_id_key unique (id, workflow_id);
	end if;
end
$$;

-- --- 2.3 Au plus une étape initiale, par workflow ----------------------------------------------
-- MESURÉ : la seconde étape initiale du même workflow est refusée en `23505`. C'est la moitié de
-- l'exigence que la base peut tenir ; l'autre moitié est une condition d'emploi (décision 72).

create unique index if not exists workflow_steps_workflow_initial_uk
	on public.workflow_steps (workflow_id)
	where is_initial;

-- La question posée par tout board : « les étapes de ce workflow, dans l'ordre ».
create index if not exists workflow_steps_workflow_position_idx
	on public.workflow_steps (workflow_id, position);

create index if not exists workflow_steps_node_idx
	on public.workflow_steps (node_id);

drop trigger if exists workflow_steps_set_updated_at on public.workflow_steps;
create trigger workflow_steps_set_updated_at
	before update on public.workflow_steps
	for each row execute function app.set_updated_at();

comment on table public.workflow_steps is
	'CRM-031 — docs/SCHEMA.md §3. Instanciation d''un nœud du catalogue dans un workflow. La clé et '
	'le type restent ceux du nœud ; seuls le libellé, la probabilité et le seuil se surchargent.';
comment on column public.workflow_steps.workspace_id is
	'Dénormalisé pour la RLS. Sa véracité est garantie par workflow_steps_workflow_id_workspace_id_fkey, '
	'et non supposée (docs/SPEC-workflow-engine.md §3.3).';
comment on column public.workflow_steps.position is
	'Ordre des colonnes du board **dans son workflow**. Attribuée automatiquement si omise.';
comment on column public.workflow_steps.label_override is
	'Surcharge locale du libellé du nœud. `NULL` signifie « prendre celui du catalogue », jamais '
	'« vide ».';
comment on column public.workflow_steps.is_initial is
	'Étape de départ des cards. **Au plus une** par workflow, garantie par index unique partiel. '
	'« Au moins une » n''est pas imposable à l''écriture : docs/JOURNAL.md décision 72.';

-- =============================================================================================
-- 3. `public.workflow_transitions`
-- =============================================================================================
-- Les arêtes autorisées. **Une transition non déclarée est refusée** — la garde qui l'applique est
-- `move_card` (`CRM-034`) ; cette table en est la déclaration.

create table if not exists public.workflow_transitions (
	id           uuid        primary key default gen_random_uuid(),
	workflow_id  uuid        not null,
	workspace_id uuid        not null,
	from_step_id uuid        not null,
	to_step_id   uuid        not null,
	-- Libellé du bouton d'action dans le menu d'une card. Facultatif : à défaut, l'interface
	-- affichera le libellé de l'étape d'arrivée (docs/SPEC-workflow-engine.md §7).
	label            text,
	require_comment  boolean not null default false,
	-- MESURÉ : aucune clé étrangère n'est possible depuis une colonne tableau — « Key columns
	-- "require_fields" and "id" are of incompatible types: uuid[] and uuid ». Ce n'est pas un
	-- différé en attendant `form_fields` (`CRM-035`) : c'est une propriété du type. INC-033.
	require_fields   uuid[]  not null default '{}',
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 3.1 Contraintes de valeur -----------------------------------------------------------------
-- Une transition d'une étape vers elle-même n'est pas un déplacement.

alter table public.workflow_transitions drop constraint if exists workflow_transitions_distinct_check;
alter table public.workflow_transitions add  constraint workflow_transitions_distinct_check
	check (from_step_id <> to_step_id);

alter table public.workflow_transitions drop constraint if exists workflow_transitions_label_check;
alter table public.workflow_transitions add  constraint workflow_transitions_label_check
	check (label is null or btrim(label) <> '');

-- --- 3.2 Les clés composites : une transition ne sort pas de son workflow ----------------------
-- MESURÉ : une arête dont l'étape cible appartient à un autre workflow est refusée en `23503`,
-- `Key (to_step_id, workflow_id)=(…) is not present in table "workflow_steps"`. Un trigger aurait
-- rendu le même service, plus tard et moins sûrement (décision 73).
--
-- MESURÉ également : supprimer une étape emporte ses arêtes. C'est voulu — une arête vers une
-- étape disparue n'est pas une donnée à conserver, c'est une arête cassée.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_transitions_workflow_id_workspace_id_fkey'
		   and conrelid = 'public.workflow_transitions'::regclass
	) then
		alter table public.workflow_transitions
			add constraint workflow_transitions_workflow_id_workspace_id_fkey
			foreign key (workflow_id, workspace_id)
			references public.workflows (id, workspace_id) on delete cascade;
	end if;

	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_transitions_from_step_fkey'
		   and conrelid = 'public.workflow_transitions'::regclass
	) then
		alter table public.workflow_transitions
			add constraint workflow_transitions_from_step_fkey
			foreign key (from_step_id, workflow_id)
			references public.workflow_steps (id, workflow_id) on delete cascade;
	end if;

	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_transitions_to_step_fkey'
		   and conrelid = 'public.workflow_transitions'::regclass
	) then
		alter table public.workflow_transitions
			add constraint workflow_transitions_to_step_fkey
			foreign key (to_step_id, workflow_id)
			references public.workflow_steps (id, workflow_id) on delete cascade;
	end if;

	-- `docs/SCHEMA.md` §3 : une arête n'est déclarée qu'une fois.
	if not exists (
		select 1 from pg_constraint
		 where conname = 'workflow_transitions_workflow_from_to_key'
		   and conrelid = 'public.workflow_transitions'::regclass
	) then
		alter table public.workflow_transitions
			add constraint workflow_transitions_workflow_from_to_key
			unique (workflow_id, from_step_id, to_step_id);
	end if;
end
$$;

-- La question posée par le menu d'actions d'une card : « les transitions déclarées depuis cette
-- étape ».
create index if not exists workflow_transitions_from_step_idx
	on public.workflow_transitions (from_step_id);
create index if not exists workflow_transitions_to_step_idx
	on public.workflow_transitions (to_step_id);

drop trigger if exists workflow_transitions_set_updated_at on public.workflow_transitions;
create trigger workflow_transitions_set_updated_at
	before update on public.workflow_transitions
	for each row execute function app.set_updated_at();

comment on table public.workflow_transitions is
	'CRM-031 — docs/SCHEMA.md §3. Arêtes autorisées d''un workflow. Une transition non déclarée est '
	'refusée par move_card (CRM-034). Les cycles sont permis.';
comment on column public.workflow_transitions.require_fields is
	'Champs de formulaire exigés en plus de ceux de l''étape cible. Aucune intégrité '
	'référentielle n''est possible sur un uuid[] — INC-033, mesuré.';

-- =============================================================================================
-- 4. Attribution automatique de `position`, dans la portée du workflow
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §3.6. La portée est le **workflow** — et non le workspace comme
-- pour le catalogue, ni le track comme pour les channels : l'ordre servi est celui des colonnes
-- d'un board, qui appartient à un workflow.
--
-- MESURÉ sur la sonde : trois insertions sans `position` dans un workflow rendent `1`, `2`, `3` ;
-- une insertion dans un **autre** workflow rend `1`.
--
-- Propriété héritée de `CRM-020` et vérifiée à nouveau plutôt que supposée : un trigger
-- `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait **omise** ou écrite
-- explicitement, et ne peut pas distinguer les deux cas.
--
-- `SECURITY INVOKER` : la fonction ne lit que `workflow_steps`, table sur laquelle l'appelant a
-- déjà été autorisé par la politique d'insertion. Lui donner les droits du propriétaire serait un
-- privilège gratuit. `search_path` vidé, comme sur toute fonction du schéma `app`.

create or replace function app.workflow_steps_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(s.position), 0) + 1
			  from public.workflow_steps s
			 where s.workflow_id = new.workflow_id
		);
	end if;
	return new;
end;
$$;

comment on function app.workflow_steps_attribuer_position() is
	'CRM-031 — docs/SPEC-workflow-engine.md §3.6. Trigger BEFORE INSERT : place l''étape en fin de '
	'board **de son workflow** lorsque `position` est omise.';

revoke all on function app.workflow_steps_attribuer_position() from public;

drop trigger if exists workflow_steps_attribuer_position on public.workflow_steps;
create trigger workflow_steps_attribuer_position
	before insert on public.workflow_steps
	for each row execute function app.workflow_steps_attribuer_position();

-- =============================================================================================
-- 5. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.workflows            enable row level security;
alter table public.workflow_steps       enable row level security;
alter table public.workflow_transitions enable row level security;

-- --- 5.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 range les trois tables ensemble : lecture par les **membres du
-- workspace**. Aucun droit fin ne les gouverne — un workflow n'est ni un track ni un channel, et
-- `track_members` / `channel_members` portent sur un sous-arbre d'organisation. La règle s'arrête
-- au rôle de workspace **par conception**, non par différé : aucune entrée d'incohérence n'est
-- ouverte à ce titre, contrairement à INC-024 et INC-030.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège.

drop policy if exists workflows_lecture_membre on public.workflows;
create policy workflows_lecture_membre
	on public.workflows for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists workflow_steps_lecture_membre on public.workflow_steps;
create policy workflow_steps_lecture_membre
	on public.workflow_steps for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists workflow_transitions_lecture_membre on public.workflow_transitions;
create policy workflow_transitions_lecture_membre
	on public.workflow_transitions for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));

comment on policy workflows_lecture_membre on public.workflows is
	'CRM-031 — lecture par les membres du workspace. Règle spécifiée, non un repli : aucun droit '
	'fin ne gouverne un workflow.';

-- --- 5.2 Insertion et mise à jour, réservées aux administrateurs -------------------------------
-- docs/SPEC-permissions-rls.md §4 : écriture `admin` sur les trois tables. Un `business_developer`
-- travaille **dans** un workflow, il ne le dessine pas.
--
-- `USING` **et** `WITH CHECK` sur la mise à jour : `USING` décide si la ligne **avant** modification
-- est modifiable, `WITH CHECK` si la ligne **après** modification est acceptable. Sans le second, un
-- administrateur du workspace A pourrait déplacer une ligne vers B, où il n'a aucun droit.
--
-- MESURÉ lors de `CRM-030`, et vrai ici de la même façon : une mise à jour refusée par le `USING`
-- ne lève **aucune erreur** — PostgREST rend `200` et un tableau vide. Toute preuve de refus doit
-- donc relire la ligne et la constater **inchangée** (docs/JOURNAL.md, décision 70).

drop policy if exists workflows_insertion_admin on public.workflows;
create policy workflows_insertion_admin
	on public.workflows for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists workflows_maj_admin on public.workflows;
create policy workflows_maj_admin
	on public.workflows for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists workflow_steps_insertion_admin on public.workflow_steps;
create policy workflow_steps_insertion_admin
	on public.workflow_steps for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists workflow_steps_maj_admin on public.workflow_steps;
create policy workflow_steps_maj_admin
	on public.workflow_steps for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists workflow_transitions_insertion_admin on public.workflow_transitions;
create policy workflow_transitions_insertion_admin
	on public.workflow_transitions for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists workflow_transitions_maj_admin on public.workflow_transitions;
create policy workflow_transitions_maj_admin
	on public.workflow_transitions for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

-- --- 5.3 Suppression : ouverte aux étapes et aux transitions, refusée aux workflows ------------
-- docs/SPEC-workflow-engine.md §3.7, docs/JOURNAL.md décision 74. C'est le seul endroit du produit
-- livré où une suppression physique est ouverte à un client, et l'exception est écrite plutôt que
-- silencieuse :
--
--   * un **workflow** est un objet de premier plan, il porte `archived_at`, et l'archivage tient
--     lieu de suppression — même règle que les tracks, les channels et le catalogue. Aucune
--     politique `for delete`, aucun privilège : le refus est double ;
--   * une **étape** et une **transition** sont la composition d'un workflow, pas des objets à durée
--     de vie propre — `docs/SCHEMA.md` §3 ne leur donne aucun `archived_at`. Un éditeur qui ne peut
--     pas retirer une arête ne peut pas éditer.

drop policy if exists workflow_steps_suppression_admin on public.workflow_steps;
create policy workflow_steps_suppression_admin
	on public.workflow_steps for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

drop policy if exists workflow_transitions_suppression_admin on public.workflow_transitions;
create policy workflow_transitions_suppression_admin
	on public.workflow_transitions for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

comment on policy workflow_steps_suppression_admin on public.workflow_steps is
	'CRM-031 — seule suppression physique exposée du produit, avec celle des transitions : une '
	'étape est la composition d''un workflow, non un objet à durée de vie propre (décision 74).';

-- =============================================================================================
-- 6. `channels.workflow_id` : la clé étrangère qu'INC-029 avait dû différer
-- =============================================================================================
-- `docs/SCHEMA.md` §2 exige `channels.workflow_id` **non nulle et référencée**. `CRM-021` avait dû
-- livrer la colonne nue, `workflows` n'existant pas. La table existe désormais.
--
-- La clé est **composite** — `(workflow_id, workspace_id)` — pour la même raison que les autres :
-- le workflow d'un channel appartient au même workspace, garanti par la base et non par une
-- politique.
--
-- La contrainte `NOT NULL` n'est **pas** posée ici : elle change le contrat de création d'un
-- channel, qui deviendrait impossible sans workflow. Elle revient à `CRM-033` avec son trigger de
-- cohérence workflow ↔ track. INC-029 est mise à jour, non close.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'channels_workflow_id_workspace_id_fkey'
		   and conrelid = 'public.channels'::regclass
	) then
		alter table public.channels
			add constraint channels_workflow_id_workspace_id_fkey
			foreign key (workflow_id, workspace_id)
			references public.workflows (id, workspace_id) on delete restrict;
	end if;
end
$$;

comment on column public.channels.workflow_id is
	'Workflow suivi par le channel. Clé étrangère **composite** avec `workspace_id` depuis '
	'CRM-031 : le workflow appartient au même workspace. Encore nullable — la contrainte NOT NULL '
	'de docs/SCHEMA.md §2 revient à CRM-033 (INC-029).';

-- =============================================================================================
-- 7. Privilèges explicites
-- =============================================================================================
-- Comme les unités précédentes, on ne s'en remet pas aux privilèges par défaut de l'image : ils
-- sont posés explicitement, de sorte que le comportement du produit ne dépende pas d'un réglage
-- susceptible de changer d'une version à l'autre.
--
-- Noter l'asymétrie, qui est la traduction de la décision 74 : `delete` est accordé sur les étapes
-- et les transitions, **jamais** sur les workflows.

revoke all on public.workflows            from anon, authenticated;
revoke all on public.workflow_steps       from anon, authenticated;
revoke all on public.workflow_transitions from anon, authenticated;

grant select         on public.workflows to anon, authenticated;
grant insert, update on public.workflows to authenticated;

grant select                 on public.workflow_steps to anon, authenticated;
grant insert, update, delete on public.workflow_steps to authenticated;

grant select                 on public.workflow_transitions to anon, authenticated;
grant insert, update, delete on public.workflow_transitions to authenticated;

grant all privileges on public.workflows            to service_role;
grant all privileges on public.workflow_steps       to service_role;
grant all privileges on public.workflow_transitions to service_role;

-- PostgREST met son schéma en cache : sans ce signal, les tables nouvellement créées ne sont pas
-- visibles de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

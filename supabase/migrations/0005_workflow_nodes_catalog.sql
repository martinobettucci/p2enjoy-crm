-- @spec CRM-030 (docs/BACKLOG.md) — catalogue de nœuds : table, ordre, archivage, politiques
-- @spec docs/SPEC-workflow-engine.md §2.2 (modèle), §2.3 (clé stable), §2.4 (ordre),
--       §2.5 (probabilité et seuil), §2.6 (archivage), §2.7 (autorisations)
-- @spec docs/SCHEMA.md §3 (workflows), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille de tables), §7 (preuves de refus)
-- @spec docs/DESIGN_SYSTEM.md §1 (couleurs de données : un nom de jeton, jamais un hexadécimal)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Le vocabulaire des états d'une card, propre à un workspace. C'est lui qui rend comparable le
-- temps passé en « Relance » d'un channel à l'autre : deux workflows différents qui instancient le
-- même nœud parlent du même état.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la table, l'unicité de la clé **par workspace**, les contraintes de valeur, l'attribution
-- automatique de `position` dans la portée du workspace, le maintien d'`updated_at`, l'index
-- partiel du catalogue actif, et **trois politiques RLS**.
--
-- Non livré, et nommé :
--
--   * la garde qui refuse d'archiver un nœud **occupé par une card active**, exigée par
--     `docs/SPEC-workflow-engine.md` §2.6 et par la Definition of Done de `CRM-030`. Son chemin est
--     `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id` : il traverse
--     `workflow_steps` (`CRM-031`) et `cards` (`CRM-040`), placées **après** cette unité par
--     `docs/MASTER_PLAN.md` §2. MESURÉ : les trois tables `workflows`, `workflow_steps` et `cards`
--     rendent `NULL` à `to_regclass`.
--
--     L'écrire quand même serait pire que l'omettre, et cela aussi a été MESURÉ : PostgreSQL
--     **accepte la création** d'une fonction PL/pgSQL référençant une table absente — le corps
--     n'est pas analysé à la création — et l'échec ne survient qu'au **premier appel**, en
--     `relation "public.cards" does not exist`. Un trigger `BEFORE UPDATE` écrit ici ferait donc
--     échouer **toute** mise à jour du catalogue dès sa livraison, y compris un simple renommage,
--     et le seed lui-même n'aurait plus convergé.
--
--     Écart consigné en `docs/INCONSISTENCY_REPORT.md`, INC-031, avec trois options d'arbitrage, et
--     **figé par deux assertions `hasnt_table`** de `supabase/tests/0006_workflow_nodes_catalog.test.sql`
--     qui deviendront rouges à `CRM-031` et à `CRM-040` (docs/JOURNAL.md, décisions 51 et 66).
--
-- Ce qui n'est PAS un manque, contrairement à `tracks` et `channels` : l'absence de droit fin. Le
-- catalogue n'appartient ni à un track ni à un channel, et `track_members` / `channel_members`
-- portent sur un sous-arbre d'organisation. Sa politique s'arrête au rôle de workspace **par
-- conception**, non par différé — aucune entrée d'incohérence n'est ouverte à ce titre
-- (docs/SPEC-workflow-engine.md §2.7).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile (`docs/JOURNAL.md`, décision 20). Tout est donc rejouable, et les
-- contraintes de valeur sont **convergentes** : `drop constraint if exists` puis `add constraint`,
-- de sorte qu'un rejeu **répare** une contrainte retirée à la main plutôt que de la laisser
-- manquante (décision 57, défaut réel trouvé par le harnais de `CRM-020`).

-- =============================================================================================
-- 1. `public.workflow_nodes_catalog`
-- =============================================================================================
-- docs/SCHEMA.md §3, complété par les « Conventions générales » du même document pour
-- `created_at` et `updated_at`, que le tableau du §3 omet pour cette table comme le §2 les omettait
-- pour `tracks` et `channels` (INC-025, troisième occurrence du même oubli).

create table if not exists public.workflow_nodes_catalog (
	id           uuid        primary key default gen_random_uuid(),
	-- Porté directement, sans jointure : convention générale de `docs/SCHEMA.md`. Ici elle ne
	-- coûte rien — le catalogue n'a pas de parent intermédiaire, donc aucune dénormalisation ne
	-- peut mentir, contrairement à `channels.workspace_id` qui a exigé une clé étrangère composite
	-- (docs/SPEC-channels.md §2.4).
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	-- L'identifiant **durable** du nœud, celui sur lequel l'analytique s'appuie. Même forme que les
	-- slugs de `tracks` et de `channels`, pour rester utilisable dans une URL, un nom de colonne de
	-- rapport ou une clé de traduction.
	key          text        not null,
	label        text        not null,
	-- `won` / `lost` est ce qui rend l'analytique de conversion possible sans convention implicite
	-- sur les libellés (docs/SPEC-workflow-engine.md §2.1). Colonne `text` avec `CHECK` et non type
	-- énuméré : `docs/SCHEMA.md` réserve les types PostgreSQL aux énumérations **stables**, et
	-- celle-ci pourrait s'étendre par migration.
	kind         text        not null default 'open',
	-- `docs/DESIGN_SYSTEM.md` §1, « Couleurs de données » : un **nom de jeton**, jamais un
	-- hexadécimal. Défaut `neutral` et non `brand` : un nœud qui n'a pas choisi sa couleur ne doit
	-- pas revendiquer celle de la marque (décision 53, reprise de `CRM-020`).
	color        text        not null default 'neutral',
	-- Nullable, et `0` n'est **pas** `NULL` : `perdu` vaut réellement 0 %, alors qu'un nœud métier
	-- peut n'avoir aucune signification prévisionnelle. Confondre les deux rendrait toute moyenne
	-- fausse (docs/SPEC-workflow-engine.md §2.5).
	default_probability      numeric(5,2),
	-- Nombre de jours au-delà duquel une card figée sur ce nœud est signalée. Nul pour un nœud
	-- terminal : une affaire livrée ou perdue n'est pas en retard.
	default_stale_after_days integer,
	-- `numeric` et non `integer` : index fractionnaire, comme `tracks.position` et
	-- `channels.position`. Insérer un nœud entre deux autres n'exigera pas de renuméroter la liste
	-- entière. `not null` **sans défaut de colonne** : le trigger de la section 2 la renseigne
	-- lorsqu'elle est omise.
	position     numeric     not null,
	-- Suppression douce : masqué des sélecteurs, réversible. La suppression physique n'est pas
	-- exposée — voir la section 4, aucun `grant delete`.
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- `docs/SCHEMA.md` §3 : « unique par workspace ». Deux workspaces peuvent donc avoir chacun
	-- leur `prospection` — c'est la condition pour que le catalogue soit réellement « propre à un
	-- workspace ».
	unique (workspace_id, key)
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------
-- Elles ne sont pas écrites dans le `create table` : celui-ci porte `if not exists`, et une
-- contrainte retirée à la main sur une base existante ne serait alors **jamais** rétablie par un
-- rejeu. La migration serait idempotente sans être réparatrice (décision 57).

alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_key_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_key_check
	check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_label_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_label_check
	check (btrim(label) <> '');

alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_kind_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_kind_check
	check (kind in ('open', 'won', 'lost'));

alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_color_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_color_check
	check (color in ('brand', 'success', 'accent', 'danger', 'neutral'));

-- MESURÉ, et contre-intuitif : `numeric(5,2)` **arrondit avant** que cette contrainte ne soit
-- évaluée. `99.999` est stocké `100.00` et **accepté** ; `100.01` et `-0.01` sont refusés. La
-- contrainte porte donc sur la valeur arrondie par le type, jamais sur celle que le client a
-- envoyée (docs/JOURNAL.md, décision 68).
alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_probability_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_probability_check
	check (default_probability is null
	       or (default_probability >= 0 and default_probability <= 100));

-- `> 0` et non `>= 0` : un seuil de zéro jour signalerait toute card dès son arrivée sur le nœud,
-- ce qui n'est jamais l'intention, et masquerait l'absence de seuil sous une valeur qui a l'air
-- d'en être une (docs/SPEC-workflow-engine.md §2.5).
alter table public.workflow_nodes_catalog drop constraint if exists workflow_nodes_catalog_stale_check;
alter table public.workflow_nodes_catalog add  constraint workflow_nodes_catalog_stale_check
	check (default_stale_after_days is null or default_stale_after_days > 0);

comment on table public.workflow_nodes_catalog is
	'CRM-030 — docs/SCHEMA.md §3. Vocabulaire des états d''une card, propre à un workspace. Un '
	'workflow (CRM-031) en instancie des nœuds ; la clé et le type restent ceux du catalogue, ce '
	'qui rend l''analytique comparable d''un channel à l''autre.';
comment on column public.workflow_nodes_catalog.key is
	'Identifiant durable du nœud, unique **par workspace**. Minuscules, chiffres et tirets simples. '
	'C''est lui que l''analytique agrège (docs/SPEC-workflow-engine.md §2.3).';
comment on column public.workflow_nodes_catalog.kind is
	'`open`, `won` ou `lost`. Rend l''analytique de conversion possible sans convention implicite '
	'sur les libellés.';
comment on column public.workflow_nodes_catalog.color is
	'Nom de jeton du design system, jamais un hexadécimal (docs/DESIGN_SYSTEM.md §1).';
comment on column public.workflow_nodes_catalog.default_probability is
	'Pourcentage de 0 à 100, nullable. `0` n''est pas `NULL` : « perdu à coup sûr » et « aucune '
	'signification prévisionnelle » sont deux états différents.';
comment on column public.workflow_nodes_catalog.default_stale_after_days is
	'Seuil de relance en jours, strictement positif. Nul pour un nœud terminal : une affaire livrée '
	'ou perdue n''est pas en retard.';
comment on column public.workflow_nodes_catalog.position is
	'Ordre du catalogue **dans son workspace**. Attribuée automatiquement si omise '
	'(docs/SPEC-workflow-engine.md §2.4).';
comment on column public.workflow_nodes_catalog.archived_at is
	'Non nul = archivé : masqué des sélecteurs, réversible. Aucune suppression physique. La garde '
	'qui refuse l''archivage d''un nœud occupé est différée — INC-031.';

-- La question posée à chaque affichage du catalogue et de tout sélecteur de nœud : « les nœuds non
-- archivés de ce workspace, dans l'ordre ». L'index partiel ne porte que les lignes réellement
-- listées.
create index if not exists workflow_nodes_catalog_workspace_position_idx
	on public.workflow_nodes_catalog (workspace_id, position, label)
	where archived_at is null;

drop trigger if exists workflow_nodes_catalog_set_updated_at on public.workflow_nodes_catalog;
create trigger workflow_nodes_catalog_set_updated_at
	before update on public.workflow_nodes_catalog
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. Attribution automatique de `position`, dans la portée du workspace
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §2.4. La portée est le **workspace**, et non le track comme pour
-- `channels` (décision 61) : le catalogue est une liste unique par workspace, affichée d'un seul
-- tenant dans l'écran d'administration. Il n'a pas de conteneur intermédiaire, donc pas d'autre
-- portée possible (docs/JOURNAL.md, décision 67).
--
-- MESURÉ sur la sonde : trois insertions sans `position` dans un workspace rendent `1`, `2`, `3` ;
-- une quatrième dans un **autre** workspace rend `1` ; une valeur explicite (`42`) est conservée.
--
-- Propriété héritée de `CRM-020` et vérifiée à nouveau plutôt que supposée : un trigger
-- `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait **omise** ou écrite
-- explicitement, et ne peut pas distinguer les deux cas. Écrire `position: null` équivaut donc à
-- omettre. La contrainte `NOT NULL` protège en revanche les mises à jour, que le trigger ne couvre
-- pas.
--
-- `SECURITY INVOKER` : la fonction ne lit que `workflow_nodes_catalog`, table sur laquelle
-- l'appelant a déjà été autorisé par la politique d'insertion. Lui donner les droits du
-- propriétaire serait un privilège gratuit. `search_path` vidé, comme sur toute fonction du schéma
-- `app`.

create or replace function app.catalogue_noeuds_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(n.position), 0) + 1
			  from public.workflow_nodes_catalog n
			 where n.workspace_id = new.workspace_id
		);
	end if;
	return new;
end;
$$;

comment on function app.catalogue_noeuds_attribuer_position() is
	'CRM-030 — docs/SPEC-workflow-engine.md §2.4. Trigger BEFORE INSERT : place le nœud en fin de '
	'catalogue **de son workspace** lorsque `position` est omise.';

revoke all on function app.catalogue_noeuds_attribuer_position() from public;

drop trigger if exists workflow_nodes_catalog_attribuer_position on public.workflow_nodes_catalog;
create trigger workflow_nodes_catalog_attribuer_position
	before insert on public.workflow_nodes_catalog
	for each row execute function app.catalogue_noeuds_attribuer_position();

-- =============================================================================================
-- 3. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.workflow_nodes_catalog enable row level security;

-- --- 3.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 range `workflow_nodes_catalog` avec les tables d'organisation :
-- lecture par les **membres du workspace**. Contrairement à `tracks` (INC-024) et à `channels`
-- (INC-030), aucune fonction n'est différée ici : `app.is_workspace_member` **est** la règle
-- spécifiée, pas un repli.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège
-- (docs/SPEC-permissions-rls.md §7, dernier paragraphe).

drop policy if exists catalogue_noeuds_lecture_membre on public.workflow_nodes_catalog;
create policy catalogue_noeuds_lecture_membre
	on public.workflow_nodes_catalog
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

comment on policy catalogue_noeuds_lecture_membre on public.workflow_nodes_catalog is
	'CRM-030 — lecture par les membres du workspace. C''est la règle spécifiée, non un repli : le '
	'catalogue n''appartient à aucun track ni channel, donc aucun droit fin ne le gouverne.';

-- --- 3.2 Insertion ----------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §2.1 : le catalogue de nœuds est nommément une prérogative
-- d'administration. Un `business_developer` travaille dans le vocabulaire, il ne le définit pas.

drop policy if exists catalogue_noeuds_insertion_admin on public.workflow_nodes_catalog;
create policy catalogue_noeuds_insertion_admin
	on public.workflow_nodes_catalog
	for insert
	to authenticated
	with check (app.is_workspace_admin(workspace_id));

comment on policy catalogue_noeuds_insertion_admin on public.workflow_nodes_catalog is
	'CRM-030 — création réservée aux administrateurs du workspace.';

-- --- 3.3 Mise à jour --------------------------------------------------------------------------
-- `USING` **et** `WITH CHECK` : `USING` décide si la ligne **avant** modification est modifiable,
-- `WITH CHECK` si la ligne **après** modification est acceptable. Sans le second, un administrateur
-- du workspace A pourrait déplacer un nœud vers le workspace B, où il n'a aucun droit. Refus
-- mesuré : `403`, code `42501` (docs/SPEC-workflow-engine.md §2.8, ligne j).
--
-- L'archivage et le désarchivage passent par cette politique : ce sont de simples `update` de
-- `archived_at`.
--
-- MESURÉ, et décisif pour les preuves : une mise à jour refusée par le `USING` ne produit **aucune
-- erreur**. PostgREST rend `200` et un tableau vide, aucune ligne n'ayant été vue comme modifiable
-- (§2.8, ligne h). Toute preuve de refus doit donc relire la ligne et la constater **inchangée**.

drop policy if exists catalogue_noeuds_maj_admin on public.workflow_nodes_catalog;
create policy catalogue_noeuds_maj_admin
	on public.workflow_nodes_catalog
	for update
	to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

comment on policy catalogue_noeuds_maj_admin on public.workflow_nodes_catalog is
	'CRM-030 — modification et archivage réservés aux administrateurs. WITH CHECK interdit le '
	'déplacement vers un autre workspace.';

-- --- 3.4 Aucune politique de suppression ------------------------------------------------------
-- docs/SPEC-workflow-engine.md §2.6 : un nœud n'est jamais supprimé, il est archivé. La
-- suppression physique « est réservée aux purges RGPD » (docs/SCHEMA.md, conventions générales),
-- qui passent par `service_role` et non par un client. Aucune politique `for delete` n'est écrite,
-- et la section 4 n'accorde pas le privilège : le refus est donc double, et se manifeste dès le
-- privilège — `403`, `permission denied for table workflow_nodes_catalog`.

-- =============================================================================================
-- 4. Privilèges explicites
-- =============================================================================================
-- Comme `CRM-003`, `CRM-020` et `CRM-021`, on ne s'en remet pas aux privilèges par défaut de
-- l'image : ils sont posés explicitement, de sorte que le comportement du produit ne dépende pas
-- d'un réglage susceptible de changer d'une version à l'autre.

revoke all on public.workflow_nodes_catalog from anon, authenticated;
grant select         on public.workflow_nodes_catalog to anon, authenticated;
grant insert, update on public.workflow_nodes_catalog to authenticated;
grant all privileges on public.workflow_nodes_catalog to service_role;

-- PostgREST met son schéma en cache : sans ce signal, la table nouvellement créée n'est pas
-- visible de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

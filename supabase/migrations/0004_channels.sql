-- @spec CRM-021 (docs/BACKLOG.md) — channels : table, ordre des onglets, archivage, politiques
-- @spec docs/SPEC-channels.md §2 (modèle), §3 (ordre), §4 (archivage), §6 (autorisations)
-- @spec docs/SCHEMA.md §2 (organisation), §9 (fonctions), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille de tables), §7 (preuves de refus)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Second niveau d'organisation du produit. Un channel appartient à un track (`CRM-020`), portera
-- un workflow (`CRM-031`) et contiendra des cards (`CRM-040`) ; c'est l'objet que la barre
-- d'onglets liste et celui auquel les droits fins de `channel_members` se rattachent.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la table, l'unicité du slug par track, l'attribution automatique de `position` dans la
-- portée du track, le maintien d'`updated_at`, la clé étrangère composite qui rend le
-- `workspace_id` dénormalisé **véridique**, la clé étrangère qu'INC-010 avait dû différer pour
-- `channel_members`, et **trois politiques RLS**.
--
-- Non livré, et nommé :
--
--   * la clé étrangère `workflow_id → workflows` et la contrainte `NOT NULL` que
--     `docs/SCHEMA.md` §2 exige. La table `workflows` n'existe pas : elle arrive avec `CRM-031`,
--     placée **après** cette unité par `docs/MASTER_PLAN.md` §2. Mesuré :
--     `to_regclass('public.workflows')` rend `NULL`. Contradiction consignée en
--     `docs/INCONSISTENCY_REPORT.md`, INC-029, et **figée par trois assertions** de
--     `supabase/tests/0005_channels.test.sql` qui deviendront rouges à `CRM-031` ;
--   * le trigger de cohérence workflow ↔ track, explicitement rattaché à `CRM-033` par la
--     Definition of Done de `CRM-021` ;
--   * `app.can_read_channel` et `app.can_write_channel`, donc la restriction par droit fin. Deux
--     des quatre fonctions différées par INC-013, dont l'arbitrage **reste ouvert** ; les écrire
--     ici trancherait à la place du responsable. La politique de lecture s'arrête donc au rôle de
--     workspace : elle cloisonne, elle ne restreint pas. INC-030.
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
-- 1. La condition du cloisonnement : `tracks (id, workspace_id)` doit être unique
-- =============================================================================================
-- docs/SPEC-channels.md §2.4. `channels` porte `workspace_id` par dénormalisation, comme les
-- conventions générales de `docs/SCHEMA.md` l'exigent de toute table métier — « y compris
-- lorsqu'il serait déductible par jointure : les politiques RLS restent ainsi simples et
-- indexables ».
--
-- Le danger d'une dénormalisation est qu'elle **mente**. Si `channels.workspace_id` pouvait
-- différer du workspace du track désigné par `channels.track_id`, la politique de lecture — qui
-- interroge `channels.workspace_id` — cloisonnerait sur une valeur fausse : le channel d'un track
-- du workspace A serait lisible par les membres de B, avec des politiques pourtant correctes.
-- Aucune règle RLS ne rattrape cela, puisqu'elle fait confiance à la donnée.
--
-- La garantie est donc portée par une clé étrangère **composite**, section 3. PostgreSQL exige
-- alors une contrainte d'unicité sur les colonnes référencées — MESURÉ, et non supposé : sans
-- elle, la création de la clé est refusée par
-- « there is no unique constraint matching given keys for referenced table "tracks" ».
--
-- L'ajout est **additif et sans risque** : `(id)` étant déjà la clé primaire de `tracks`,
-- `(id, workspace_id)` est unique par construction et ne peut refuser aucune ligne, existante ou
-- future. Ce qu'il change est le catalogue, ce que la suite pgTAP de `CRM-020` observe.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'tracks_id_workspace_id_key'
		   and conrelid = 'public.tracks'::regclass
	) then
		alter table public.tracks
			add constraint tracks_id_workspace_id_key unique (id, workspace_id);
	end if;
end;
$$;

comment on constraint tracks_id_workspace_id_key on public.tracks is
	'CRM-021 — docs/SPEC-channels.md §2.4. Condition de la clé étrangère composite de `channels` : '
	'elle est ce qui empêche le `workspace_id` dénormalisé d''un channel de mentir à la RLS.';

-- =============================================================================================
-- 2. `public.channels`
-- =============================================================================================
-- docs/SCHEMA.md §2, complété par les « Conventions générales » du même document pour
-- `created_at` et `updated_at`, que le tableau du §2 omettait pour cette table comme pour
-- `tracks` (INC-025, dont c'est ici la seconde moitié).

create table if not exists public.channels (
	id           uuid        primary key default gen_random_uuid(),
	-- Dénormalisé, et rendu véridique par la contrainte composite de la section 3.
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	-- Aucune clé étrangère **simple** vers `tracks` : celle de la section 3 la contient. En
	-- ajouter une seconde coûterait une vérification supplémentaire à chaque écriture sans rien
	-- garantir de plus.
	track_id     uuid        not null,
	name         text        not null,
	slug         text        not null,
	description  text,
	-- ÉCART ASSUMÉ, CONSIGNÉ, ET FIGÉ PAR DES ASSERTIONS — INC-029.
	--
	-- `docs/SCHEMA.md` §2 exige `uuid`, `FK workflows`, **non nul**. La table `workflows` est
	-- livrée par `CRM-031`, deux étapes plus loin dans `docs/MASTER_PLAN.md` §2. Une clé
	-- étrangère vers une table absente est refusée à la création, et un `NOT NULL` qu'aucune
	-- valeur licite ne peut satisfaire rendrait la table **inutilisable** : ni le seed, ni les
	-- preuves d'API ne pourraient créer un channel.
	--
	-- La colonne est donc livrée **nullable et sans clé étrangère**, plutôt qu'omise : elle fait
	-- partie de l'identité du channel dans la référence de schéma, les types générés la
	-- porteront, et le coût de reprise est identique dans les deux cas — absente ou nulle, les
	-- lignes créées d'ici `CRM-031` devront être renseignées avant que `NOT NULL` puisse être
	-- posée (docs/JOURNAL.md, décision 59).
	workflow_id  uuid,
	-- `numeric` et non `integer` : index fractionnaire, comme `tracks.position` et
	-- `cards.position`. Insérer un onglet entre deux autres n'exigera pas de renuméroter la barre
	-- entière. `not null` **sans défaut de colonne** : le trigger de la section 4 la renseigne
	-- lorsqu'elle est omise.
	position     numeric     not null,
	-- Suppression douce : masqué, réversible. La suppression physique n'est pas exposée — voir la
	-- section 7, aucun `grant delete`.
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 2.0 bis L'unicité par track, posée de façon convergente ----------------------------------
-- `docs/SCHEMA.md` §2 : « unique par track ». Deux tracks peuvent donc porter un channel
-- `prospection` sans se gêner, ce que l'unicité par workspace interdirait.
--
-- DÉFAUT RÉEL, REPRODUIT ET CORRIGÉ APRÈS COUP. Cette contrainte était écrite **dans le
-- `create table`**, qui porte `if not exists`. Mesuré sur la base de développement : après avoir
-- remplacé l'unicité par une unicité par workspace, la réapplication de ce fichier se termine
-- **sans erreur** et laisse la contrainte dégradée. La migration était idempotente **sans être
-- réparatrice**, et la base restait durablement affaiblie — un channel `prospection` devenant
-- impossible dans deux tracks du même workspace.
--
-- C'est exactement le défaut que `CRM-020` avait rencontré sur `tracks_color_check` (décision 57).
-- La leçon avait été appliquée aux contraintes `CHECK` de la section 2.1 sans être généralisée aux
-- autres contraintes de table.
--
-- La reconstruction n'est pas inconditionnelle, à la différence des contraintes de valeur : un
-- `drop`/`add` d'une contrainte d'unicité **reconstruit son index** à chaque démarrage de la pile,
-- ce qui n'est pas le prix négligeable d'une revalidation de `CHECK`. La définition réelle est
-- donc comparée à celle attendue, et la contrainte n'est refaite que si elles diffèrent.

do $$
declare
	definition text;
begin
	select pg_get_constraintdef(c.oid) into definition
	  from pg_constraint c
	 where c.conrelid = 'public.channels'::regclass
	   and c.conname = 'channels_track_id_slug_key';

	if definition is null then
		alter table public.channels
			add constraint channels_track_id_slug_key unique (track_id, slug);
	elsif definition <> 'UNIQUE (track_id, slug)' then
		alter table public.channels drop constraint channels_track_id_slug_key;
		alter table public.channels
			add constraint channels_track_id_slug_key unique (track_id, slug);
	end if;
end;
$$;

-- --- 2.1 Contraintes de valeur, posées de façon convergente -----------------------------------
-- Elles ne sont pas écrites dans le `create table` : celui-ci porte `if not exists`, et une
-- contrainte retirée à la main sur une base existante ne serait alors **jamais** rétablie par un
-- rejeu. La migration serait idempotente sans être réparatrice (décision 57).

alter table public.channels drop constraint if exists channels_name_check;
alter table public.channels add  constraint channels_name_check check (btrim(name) <> '');

alter table public.channels drop constraint if exists channels_slug_check;
alter table public.channels add  constraint channels_slug_check
	check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

comment on table public.channels is
	'CRM-021 — docs/SCHEMA.md §2. Second niveau d''organisation. Appartient à un track (CRM-020), '
	'portera un workflow (CRM-031) et contiendra des cards (CRM-040).';
comment on column public.channels.workspace_id is
	'Dénormalisé pour la RLS. Sa véracité est garantie par channels_track_id_workspace_id_fkey, '
	'et non supposée (docs/SPEC-channels.md §2.4).';
comment on column public.channels.slug is
	'Identifiant d''URL, unique **par track**. Minuscules, chiffres et tirets simples.';
comment on column public.channels.workflow_id is
	'Nullable et sans clé étrangère jusqu''à CRM-031 : docs/SCHEMA.md §2 l''exige non nulle et '
	'référencée, mais `workflows` n''existe pas encore. INC-029, docs/SPEC-channels.md §2.5.';
comment on column public.channels.position is
	'Ordre des onglets **dans son track**. Attribuée automatiquement si omise '
	'(docs/SPEC-channels.md §3).';
comment on column public.channels.archived_at is
	'Non nul = archivé : masqué de la barre d''onglets, réversible. Aucune suppression physique.';

-- La question posée à chaque affichage de la barre d'onglets : « les channels non archivés de ce
-- track, dans l'ordre ». L'index partiel ne porte que les lignes réellement listées.
create index if not exists channels_track_position_idx
	on public.channels (track_id, position, name)
	where archived_at is null;

drop trigger if exists channels_set_updated_at on public.channels;
create trigger channels_set_updated_at
	before update on public.channels
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. La clé étrangère composite — le cloisonnement, garanti et non espéré
-- =============================================================================================
-- docs/SPEC-channels.md §2.4. `(track_id, workspace_id)` référence `tracks (id, workspace_id)` :
-- un channel ne peut pas déclarer un workspace différent de celui de son track.
--
-- MESURÉ sur une table sonde jetable, avant écriture : l'insertion d'un channel dont
-- `workspace_id` ne correspond pas à celui de son track est refusée en `23503`,
-- « Key (track_id, workspace_id)=(…) is not present in table "tracks" ». Un `workspace_id`
-- cohérent passe.
--
-- `on delete cascade` : la suppression d'un track emporte ses channels. Cohérent avec la cascade
-- de `tracks.workspace_id` vers `workspaces`, et avec le fait qu'un channel n'a aucun sens hors
-- de son track.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'channels_track_id_workspace_id_fkey'
		   and conrelid = 'public.channels'::regclass
	) then
		alter table public.channels
			add constraint channels_track_id_workspace_id_fkey
			foreign key (track_id, workspace_id)
			references public.tracks (id, workspace_id) on delete cascade;
	end if;
end;
$$;

-- =============================================================================================
-- 4. La clé étrangère qu'INC-010 avait dû différer — sa seconde moitié
-- =============================================================================================
-- `CRM-003` a créé `public.channel_members` sans clé étrangère vers `channels`, la table
-- n'existant pas encore. `CRM-020` a posé celle de `track_members` ; celle-ci pose la seconde, et
-- **referme la partie technique d'INC-010**.
--
-- `on delete cascade` : un droit fin n'a aucun sens sans son channel.
--
-- RISQUE D'EXPLOITATION, NOMMÉ ET NON MASQUÉ. Si une ligne orpheline existait dans
-- `channel_members`, cet `alter table` échouerait — et comme PostgREST attend la terminaison
-- réussie du `migrations-runner`, **la pile ne démarrerait plus**. Aucun `not valid` n'est employé
-- pour contourner : il rendrait la contrainte décorative sur les lignes existantes. La
-- vérification préalable est portée par `docs/PROD_MIGRATIONS.md` §3 (décision 55).
--
-- Sur les bases du projet, la table est vide : le seed n'y écrit rien (docs/SPEC-seed.md §2).

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'channel_members_channel_id_fkey'
		   and conrelid = 'public.channel_members'::regclass
	) then
		alter table public.channel_members
			add constraint channel_members_channel_id_fkey
			foreign key (channel_id) references public.channels (id) on delete cascade;
	end if;
end;
$$;

-- =============================================================================================
-- 5. Attribution automatique de `position`, dans la portée du track
-- =============================================================================================
-- docs/SPEC-channels.md §3. La portée est le **track**, non le workspace : les onglets d'un track
-- forment une barre à eux seuls, et compter à l'échelle du workspace ferait dépendre la
-- numérotation d'un track de l'activité d'un autre — produisant des barres commençant à 7 ou à 12
-- sans que rien ne l'explique (docs/JOURNAL.md, décision 61).
--
-- MESURÉ sur la sonde : trois insertions sans `position` — deux dans un track, une dans un autre —
-- rendent `1`, `2` et `1`. La numérotation redémarre bien à chaque track.
--
-- Propriété héritée de `CRM-020`, reprise sans être redécouverte : un trigger `BEFORE INSERT`
-- reçoit `new.position` à `NULL` que le client l'ait **omise** ou écrite explicitement, et ne peut
-- pas distinguer les deux cas. Écrire `position: null` équivaut donc à omettre. La contrainte
-- `NOT NULL` protège en revanche les mises à jour, que le trigger ne couvre pas.
--
-- `SECURITY INVOKER` : la fonction ne lit que `channels`, table sur laquelle l'appelant a déjà été
-- autorisé par la politique d'insertion. Lui donner les droits du propriétaire serait un privilège
-- gratuit. `search_path` vidé, comme sur toute fonction du schéma `app`.

create or replace function app.channels_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(c.position), 0) + 1
			  from public.channels c
			 where c.track_id = new.track_id
		);
	end if;
	return new;
end;
$$;

comment on function app.channels_attribuer_position() is
	'CRM-021 — docs/SPEC-channels.md §3. Trigger BEFORE INSERT : place le channel en fin de barre '
	'**de son track** lorsque `position` est omise.';

revoke all on function app.channels_attribuer_position() from public;

drop trigger if exists channels_attribuer_position on public.channels;
create trigger channels_attribuer_position
	before insert on public.channels
	for each row execute function app.channels_attribuer_position();

-- =============================================================================================
-- 6. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.channels enable row level security;

-- --- 6.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 prescrit `app.can_read_channel`. Cette fonction est différée
-- (INC-013) ; la politique s'appuie donc sur `app.is_workspace_member`, livrée et prouvée par
-- `CRM-010` — le même choix que `CRM-020` pour `tracks`. Elle **cloisonne par workspace** — preuve
-- de refus n° 3 au niveau des channels — mais **n'applique aucun droit fin** : un
-- `channel_members.access = 'none'` ne masque rien encore. INC-030, et assertion dédiée dans la
-- suite pgTAP.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège
-- (docs/SPEC-permissions-rls.md §7, dernier paragraphe).

drop policy if exists channels_lecture_membre on public.channels;
create policy channels_lecture_membre
	on public.channels
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

comment on policy channels_lecture_membre on public.channels is
	'CRM-021 — lecture par les membres du workspace. Droits fins non appliqués : INC-030, CRM-012.';

-- --- 6.2 Insertion ----------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §2.1 : l'organisation — tracks, channels, workflows — est une
-- prérogative d'administration. Un `business_developer` travaille dans la structure, il ne la
-- définit pas.

drop policy if exists channels_insertion_admin on public.channels;
create policy channels_insertion_admin
	on public.channels
	for insert
	to authenticated
	with check (app.is_workspace_admin(workspace_id));

comment on policy channels_insertion_admin on public.channels is
	'CRM-021 — création réservée aux administrateurs du workspace.';

-- --- 6.3 Mise à jour --------------------------------------------------------------------------
-- `USING` **et** `WITH CHECK` : `USING` décide si la ligne **avant** modification est modifiable,
-- `WITH CHECK` si la ligne **après** modification est acceptable. Sans le second, un
-- administrateur du workspace A pourrait déplacer un channel vers le workspace B, où il n'a aucun
-- droit. Refus mesuré : `403`, code `42501` (docs/SPEC-channels.md §7, ligne l).
--
-- L'archivage et le désarchivage passent par cette politique : ce sont de simples `update` de
-- `archived_at`.

drop policy if exists channels_maj_admin on public.channels;
create policy channels_maj_admin
	on public.channels
	for update
	to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

comment on policy channels_maj_admin on public.channels is
	'CRM-021 — modification et archivage réservés aux administrateurs. WITH CHECK interdit le '
	'déplacement vers un autre workspace.';

-- --- 6.4 Aucune politique de suppression ------------------------------------------------------
-- docs/SPEC-channels.md §4 : la suppression du produit est l'archivage. La suppression physique
-- « est réservée aux purges RGPD » (docs/SCHEMA.md, conventions générales), qui passent par
-- `service_role` et non par un client. Aucune politique `for delete` n'est écrite, et la
-- section 7 n'accorde pas le privilège : le refus est donc double, et se manifeste dès le
-- privilège — `403`, `permission denied for table channels`.

-- =============================================================================================
-- 7. Privilèges explicites
-- =============================================================================================
-- Comme `CRM-003` et `CRM-020`, on ne s'en remet pas aux privilèges par défaut de l'image : ils
-- sont posés explicitement, de sorte que le comportement du produit ne dépende pas d'un réglage
-- susceptible de changer d'une version à l'autre.

revoke all on public.channels from anon, authenticated;
grant select         on public.channels to anon, authenticated;
grant insert, update on public.channels to authenticated;
grant all privileges on public.channels to service_role;

-- PostgREST met son schéma en cache : sans ce signal, la table nouvellement créée n'est pas
-- visible de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

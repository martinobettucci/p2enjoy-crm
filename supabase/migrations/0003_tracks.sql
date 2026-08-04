-- @spec CRM-020 (docs/BACKLOG.md) — tracks : table, ordre, archivage, politiques
-- @spec docs/SPEC-tracks.md §2 (modèle), §3 (ordre), §4 (archivage), §5 (autorisations)
-- @spec docs/SCHEMA.md §2 (organisation), §9 (fonctions), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille de tables), §7 (preuves de refus)
-- @spec docs/DESIGN_SYSTEM.md §1 (couleurs de données : un nom de jeton, jamais un hexadécimal)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Premier niveau d'organisation du produit. Un track regroupe des channels (`CRM-021`), qui
-- portent des cards (`CRM-040`) ; c'est l'objet que la barre latérale liste et celui auquel les
-- droits fins de `track_members` se rattachent.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la table, sa contrainte de couleur, l'attribution automatique de `position`, le
-- maintien d'`updated_at`, la clé étrangère qu'INC-010 avait dû différer, et **trois politiques
-- RLS** — lecture par les membres du workspace, insertion et mise à jour par ses administrateurs.
--
-- Non livré : `app.can_read_track`, et donc la restriction par droit fin. Cette fonction est
-- l'une des quatre différées par INC-013, dont l'arbitrage appartient au responsable et **reste
-- ouvert** ; l'écrire ici trancherait à sa place. La politique de lecture s'arrête donc au rôle
-- de workspace : elle cloisonne, elle ne restreint pas. L'écart est consigné en
-- `docs/INCONSISTENCY_REPORT.md`, INC-024, et **figé par une assertion** de
-- `supabase/tests/0004_tracks.test.sql`, qui deviendra rouge le jour où la politique sera
-- resserrée.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile (`docs/JOURNAL.md`, décision 20). Tout est donc écrit pour être
-- rejouable : `create table if not exists`, `create or replace function`, `drop trigger if
-- exists` avant `create trigger`, `drop policy if exists` avant `create policy`, et un ajout de
-- contrainte gardé par une recherche dans `pg_constraint`.

-- =============================================================================================
-- 1. `public.tracks`
-- =============================================================================================
-- docs/SCHEMA.md §2, complété par les « Conventions générales » du même document pour
-- `created_at` et `updated_at`, que le tableau du §2 omettait (INC-025).

create table if not exists public.tracks (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	slug         text        not null,
	description  text,
	-- `docs/DESIGN_SYSTEM.md` §1, « Couleurs de données » : la couleur d'un track est un **nom de
	-- jeton**, jamais un hexadécimal libre. La règle est traduite en base, où elle est opposable
	-- à l'API, et non dans un composant, qu'un appel direct contournerait.
	--
	-- Défaut `neutral` et non `brand` : le §1 réserve le bleu primaire aux actions primaires, aux
	-- liens et au **track actif**. Un track qui n'a pas choisi sa couleur ne doit pas revendiquer
	-- celle de l'état actif (docs/JOURNAL.md, décision 53).
	color        text        not null default 'neutral',
	-- Nom d'icône Lucide en kebab-case. La contrainte porte sur la **forme**, pas sur
	-- l'existence : une énumération des icônes de Lucide deviendrait fausse au premier
	-- `npm update` sans qu'aucune migration ne le signale. L'existence est traitée par le
	-- catalogue de `webapp/src/app/icones-tracks.ts`, avec un repli documenté (décision 54).
	icon         text        not null default 'folder',
	-- `numeric` et non `integer` : index fractionnaire, comme `cards.position`
	-- (docs/SCHEMA.md §5). Insérer un track entre deux autres n'exigera pas de renuméroter la
	-- liste entière. `not null` **sans défaut de colonne** : le trigger de la section 3 la
	-- renseigne lorsqu'elle est omise.
	--
	-- Mesuré, et corrigé après une assertion en échec : à l'insertion, écrire `null`
	-- explicitement **équivaut à omettre** — un trigger `BEFORE INSERT` reçoit `null` dans les
	-- deux cas et ne peut pas les distinguer. La contrainte `not null` protège en revanche les
	-- mises à jour, que le trigger ne couvre pas (docs/SPEC-tracks.md §3).
	position     numeric     not null,
	-- Suppression douce : masqué, réversible (docs/SCHEMA.md, conventions générales). La
	-- suppression physique n'est pas exposée — voir la section 6, aucun `grant delete`.
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- `docs/SCHEMA.md` §2 : « unique par workspace ». Deux workspaces peuvent donc porter un
	-- track `conseil-ia` sans se gêner, ce que l'unicité globale interdirait.
	unique (workspace_id, slug)
);

-- --- 1.1 Contraintes de valeur, posées de façon **convergente** -------------------------------
-- Elles ne sont pas écrites dans le `create table` : celui-ci porte `if not exists`, et une
-- contrainte retirée à la main sur une base existante ne serait alors **jamais** rétablie par un
-- rejeu. La migration serait idempotente sans être réparatrice.
--
-- Défaut réel, trouvé par le contrôle de restauration de `scripts/verify-tracks.sh` : après avoir
-- retiré `tracks_color_check` pour éprouver la non-complaisance du harnais, la réapplication du
-- fichier ne la remettait pas, et la base restait durablement affaiblie.
--
-- `drop constraint if exists` puis `add constraint` : la définition du fichier fait autorité à
-- chaque passage. Le coût est une revalidation de la table à chaque démarrage de la pile ; sur
-- une table dont la cardinalité est celle des tracks d'un workspace, il est négligeable, et il
-- achète une propriété qui vaut mieux — le schéma converge vers ce que le dépôt déclare.

alter table public.tracks drop constraint if exists tracks_name_check;
alter table public.tracks add  constraint tracks_name_check check (btrim(name) <> '');

alter table public.tracks drop constraint if exists tracks_slug_check;
alter table public.tracks add  constraint tracks_slug_check
	check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- `docs/DESIGN_SYSTEM.md` §1 rendu opposable en base : c'est la contrainte qui interdit
-- l'hexadécimal libre, et un appel direct à l'API ne la contourne pas.
alter table public.tracks drop constraint if exists tracks_color_check;
alter table public.tracks add  constraint tracks_color_check
	check (color in ('brand', 'success', 'accent', 'danger', 'neutral'));

alter table public.tracks drop constraint if exists tracks_icon_check;
alter table public.tracks add  constraint tracks_icon_check check (icon ~ '^[a-z][a-z0-9-]*$');

comment on table public.tracks is
	'CRM-020 — docs/SCHEMA.md §2. Premier niveau d''organisation d''un workspace. Regroupe les '
	'channels (CRM-021).';
comment on column public.tracks.slug is
	'Identifiant d''URL, unique par workspace. Minuscules, chiffres et tirets simples.';
comment on column public.tracks.color is
	'Nom de jeton du design system (docs/DESIGN_SYSTEM.md §1), jamais un hexadécimal.';
comment on column public.tracks.icon is
	'Nom d''icône Lucide en kebab-case. La forme est contrainte, l''existence est traitée par '
	'l''interface (docs/SPEC-tracks.md §2.4).';
comment on column public.tracks.position is
	'Ordre dans la barre latérale. Attribuée automatiquement si omise (docs/SPEC-tracks.md §3).';
comment on column public.tracks.archived_at is
	'Non nul = archivé : masqué de la barre latérale, réversible. Aucune suppression physique.';

-- La question posée à chaque affichage de la barre latérale : « les tracks non archivés de ce
-- workspace, dans l'ordre ». L'index partiel ne porte que les lignes réellement listées.
create index if not exists tracks_workspace_position_idx
	on public.tracks (workspace_id, position, name)
	where archived_at is null;

drop trigger if exists tracks_set_updated_at on public.tracks;
create trigger tracks_set_updated_at
	before update on public.tracks
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. La clé étrangère qu'INC-010 avait dû différer
-- =============================================================================================
-- `CRM-003` a créé `public.track_members` sans clé étrangère vers `tracks`, la table n'existant
-- pas encore. Elle est posée ici. `on delete cascade` : un droit fin n'a aucun sens sans son
-- track.
--
-- RISQUE D'EXPLOITATION, NOMMÉ ET NON MASQUÉ. Si une ligne orpheline existait dans
-- `track_members`, cet `alter table` échouerait — et comme PostgREST attend la terminaison réussie
-- du `migrations-runner`, **la pile ne démarrerait plus**. Aucun `not valid` n'est employé pour
-- contourner : il rendrait la contrainte décorative sur les lignes existantes. La vérification
-- préalable est portée par `docs/PROD_MIGRATIONS.md` §3 (décision 55).
--
-- Sur les bases du projet, la table est vide : le seed n'y écrit rien (docs/SPEC-seed.md §2).

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'track_members_track_id_fkey'
		   and conrelid = 'public.track_members'::regclass
	) then
		alter table public.track_members
			add constraint track_members_track_id_fkey
			foreign key (track_id) references public.tracks (id) on delete cascade;
	end if;
end;
$$;

-- =============================================================================================
-- 3. Attribution automatique de `position`
-- =============================================================================================
-- docs/SPEC-tracks.md §3. Un client qui omet `position` obtient la suivante dans **son**
-- workspace — jamais la suivante toutes bases confondues, ce qui ferait dépendre l'ordre d'un
-- workspace de l'activité d'un autre.
--
-- MESURÉ, et non supposé : un trigger `BEFORE INSERT` renseigne bien une colonne `NOT NULL`
-- avant que la contrainte ne soit vérifiée — deux insertions successives sans `position` rendent
-- `1` puis `2` (docs/JOURNAL.md, décision 52). C'est ce qui permet à la colonne de rester
-- `NOT NULL` sans défaut de colonne : omettre reste licite, écrire `null` reste refusé.
--
-- `SECURITY INVOKER` : la fonction ne lit que `tracks`, table sur laquelle l'appelant a déjà été
-- autorisé par la politique d'insertion. Lui donner les droits du propriétaire serait un
-- privilège gratuit. `search_path` vidé, comme sur toute fonction du schéma `app`.

create or replace function app.tracks_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(t.position), 0) + 1
			  from public.tracks t
			 where t.workspace_id = new.workspace_id
		);
	end if;
	return new;
end;
$$;

comment on function app.tracks_attribuer_position() is
	'CRM-020 — docs/SPEC-tracks.md §3. Trigger BEFORE INSERT : place le track en fin de liste de '
	'son workspace lorsque `position` est omise.';

revoke all on function app.tracks_attribuer_position() from public;

drop trigger if exists tracks_attribuer_position on public.tracks;
create trigger tracks_attribuer_position
	before insert on public.tracks
	for each row execute function app.tracks_attribuer_position();

-- =============================================================================================
-- 4. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.tracks enable row level security;

-- --- 4.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 prescrit `app.can_read_track`. Cette fonction est différée
-- (INC-013) ; la politique s'appuie donc sur `app.is_workspace_member`, livrée et prouvée par
-- `CRM-010`. Elle **cloisonne par workspace** — c'est la preuve de refus n° 3 au niveau des
-- tracks — mais **n'applique aucun droit fin** : un `track_members.access = 'none'` ne masque
-- rien encore. INC-024, et assertion dédiée dans la suite pgTAP.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège
-- (docs/SPEC-permissions-rls.md §7, dernier paragraphe).

drop policy if exists tracks_lecture_membre on public.tracks;
create policy tracks_lecture_membre
	on public.tracks
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

comment on policy tracks_lecture_membre on public.tracks is
	'CRM-020 — lecture par les membres du workspace. Droits fins non appliqués : INC-024, CRM-012.';

-- --- 4.2 Insertion ----------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §2.1 : l'organisation — tracks, channels, workflows — est une
-- prérogative d'administration. Un `business_developer` travaille dans la structure, il ne la
-- définit pas.

drop policy if exists tracks_insertion_admin on public.tracks;
create policy tracks_insertion_admin
	on public.tracks
	for insert
	to authenticated
	with check (app.is_workspace_admin(workspace_id));

comment on policy tracks_insertion_admin on public.tracks is
	'CRM-020 — création réservée aux administrateurs du workspace.';

-- --- 4.3 Mise à jour --------------------------------------------------------------------------
-- `USING` **et** `WITH CHECK`, et ce n'est pas une redondance : `USING` décide si la ligne
-- **avant** modification est modifiable, `WITH CHECK` si la ligne **après** modification est
-- acceptable. Sans le second, un administrateur du workspace A pourrait déplacer un track vers le
-- workspace B, où il n'a aucun droit — le `USING` seul l'aurait laissé passer, la ligne d'origine
-- lui appartenant. Refus mesuré : `403`, code `42501` (docs/SPEC-tracks.md §6, ligne l).
--
-- L'archivage et le désarchivage passent par cette politique : ce sont de simples `update` de
-- `archived_at`.

drop policy if exists tracks_maj_admin on public.tracks;
create policy tracks_maj_admin
	on public.tracks
	for update
	to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

comment on policy tracks_maj_admin on public.tracks is
	'CRM-020 — modification et archivage réservés aux administrateurs. WITH CHECK interdit le '
	'déplacement vers un autre workspace.';

-- --- 4.4 Aucune politique de suppression ------------------------------------------------------
-- docs/SPEC-tracks.md §4 : la suppression du produit est l'archivage. La suppression physique
-- « est réservée aux purges RGPD » (docs/SCHEMA.md, conventions générales), qui passent par
-- `service_role` et non par un client. Aucune politique `for delete` n'est écrite, et la
-- section 5 n'accorde pas le privilège : le refus est donc double, et se manifeste dès le
-- privilège — `403`, `permission denied for table tracks`.

-- =============================================================================================
-- 5. Privilèges explicites
-- =============================================================================================
-- Comme `CRM-003`, on ne s'en remet pas aux privilèges par défaut de l'image : ils sont posés
-- explicitement, de sorte que le comportement du produit ne dépende pas d'un réglage susceptible
-- de changer d'une version à l'autre.

revoke all on public.tracks from anon, authenticated;
grant select         on public.tracks to anon, authenticated;
grant insert, update on public.tracks to authenticated;
grant all privileges on public.tracks to service_role;

-- PostgREST met son schéma en cache : sans ce signal, la table nouvellement créée n'est pas
-- visible de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

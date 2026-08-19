-- @spec CRM-082 (docs/BACKLOG.md) — objectifs : modèle, RLS et API
-- @spec docs/SPEC-goals.md §1 (ce que ce n'est pas), §2 (objets), §4 (autorisations)
-- @spec docs/SCHEMA.md §9 bis.1 à §9 bis.3 (colonnes), §9 bis.7 (politiques)
-- @spec docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.5 (une politique ne relit
--       pas sa propre table), §4 (familles de tables)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 49)
--
-- Le « tableau blanc intelligent » : des blocs posés à la main, reliés par des flèches, chacun
-- pouvant désigner un channel. Décision 431 du 2026-08-19.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'AUTORISERA JAMAIS, ET C'EST ÉCRIT EN TÊTE.
-- ---------------------------------------------------------------------------------------------
-- `docs/SPEC-goals.md` §1 : le tableau n'est PAS une projection des données du CRM. Aucun trigger
-- de ce fichier ne calcule `fill_percent`, ne crée de lien, ne déplace un bloc ni ne déduit un
-- ordre. `fill_percent` est un entier SAISI ; la précision décimale suggérerait un calcul, ce que
-- la spécification interdit. Le seul lien avec le reste du produit est descendant et volontaire :
-- `goal_blocks.channel_id`, qui sert à naviguer et à appliquer la règle de visibilité du §4.1.
--
-- Une évolution future qui proposerait de remplir un bloc « automatiquement à partir de
-- l'avancement réel » contredit cette spécification : c'est un changement de nature, à arbitrer
-- comme tel, jamais une amélioration.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : les trois tables, leurs contraintes de forme, l'attribution automatique de `position`,
-- le trigger de cohérence des flèches, les quatre fonctions d'appui `SECURITY DEFINER`, la RLS
-- activée, les politiques nommées par action, les privilèges explicites et les triggers
-- `updated_at`.
--
-- Non livré, et nommé plutôt que tu : **aucun écran**. L'entrée de navigation, le canevas, les
-- gestes de déplacement et le tracé des flèches sont `CRM-083`.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile. Tout est donc écrit pour être rejouable : `create table if not
-- exists`, `create or replace function`, `drop trigger if exists` avant `create trigger`, `drop
-- policy if exists` avant `create policy`, et les contraintes de valeur posées de façon
-- **convergente** — `drop constraint if exists` puis `add constraint` — pour que la définition du
-- fichier fasse autorité à chaque passage (même patron que `CRM-020` et `CRM-060`).

-- =============================================================================================
-- 1. `public.goal_boards` — le tableau
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.1, docs/SPEC-goals.md §2.1.
--
-- Un tableau appartient à un WORKSPACE et jamais à un track : un bloc peut viser un channel de
-- n'importe quel track, et un tableau transverse — « mes objectifs du trimestre » — doit rester
-- possible. Arbitrage du responsable du 2026-08-19.

create table if not exists public.goal_boards (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	description  text,
	-- `numeric` et non `integer` : index fractionnaire, même convention que `tracks.position` et
	-- `cards.position`. Attribuée par trigger lorsqu'elle est omise (§3 ci-dessous).
	position     numeric     not null,
	-- L'archivage tient lieu de suppression, comme pour les tracks et les channels : un tableau
	-- CONTIENT le travail, contrairement à un bloc qui se supprime réellement (§2 de la
	-- spécification, dernier paragraphe).
	archived_at  timestamptz,
	-- Trace, JAMAIS un droit : `docs/SPEC-goals.md` §4.2, « aucune notion de propriétaire de
	-- bloc ». Un diagramme est un objet collectif.
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.goal_boards drop constraint if exists goal_boards_name_check;
alter table public.goal_boards add  constraint goal_boards_name_check
	check (app.btrim_blancs(name) <> '');

comment on table public.goal_boards is
	'CRM-082 — docs/SCHEMA.md §9 bis.1, docs/SPEC-goals.md §2.1. Tableau d''objectifs d''un '
	'workspace : surface de composition libre, jamais une projection des données du CRM (§1).';
comment on column public.goal_boards.created_by is
	'Trace, jamais un droit : docs/SPEC-goals.md §4.2. Le diagramme est un objet collectif.';

-- Unicité par workspace sur la forme NORMALISÉE (`docs/SPEC-goals.md` §2.1, « unique par
-- workspace après normalisation des espaces »). `app.btrim_blancs` est la normalisation du dépôt
-- — elle retire les blancs de bord, y compris les blancs Unicode invisibles de `CRM-035` — et
-- elle est `IMMUTABLE`, donc indexable.
--
-- CE QUE CETTE UNICITÉ FAIT, ET QUI EST ÉCRIT PLUTÔT QUE DÉCOUVERT : elle porte sur TOUS les
-- tableaux, archivés compris, la spécification ne la restreignant pas aux tableaux vivants
-- comme celle des budgets le sera (`docs/SCHEMA.md` §9 bis.4, index partiel `where closed_at is
-- null`). Un nom libéré par l'archivage reste donc pris. L'écart est consigné au registre pour
-- arbitrage du responsable ; le comportement suit ici la spécification à la lettre.
drop index if exists goal_boards_workspace_name_key;
create unique index goal_boards_workspace_name_key
	on public.goal_boards (workspace_id, app.btrim_blancs(name));

create index if not exists goal_boards_workspace_position_idx
	on public.goal_boards (workspace_id, position, name)
	where archived_at is null;

drop trigger if exists goal_boards_set_updated_at on public.goal_boards;
create trigger goal_boards_set_updated_at
	before update on public.goal_boards
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. `public.goal_blocks` — le bloc
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.2, docs/SPEC-goals.md §2.2.

create table if not exists public.goal_blocks (
	id           uuid        primary key default gen_random_uuid(),
	board_id     uuid        not null references public.goal_boards (id) on delete cascade,
	title        text        not null,
	body         text,
	-- ENTIER, et non fraction : un pourcentage saisi à la main se lit et se compare mieux en
	-- entiers, et la précision décimale suggérerait un calcul, que le §1 interdit.
	fill_percent smallint    not null default 0,
	-- `on delete set null` et NON `cascade` : un channel mis à la corbeille ne fait pas
	-- disparaître un objectif. Le bloc survit, son lien tombe, et l'écran dira « lien perdu »
	-- (§5.4). Détruire le raisonnement d'un utilisateur parce qu'une destination a bougé serait
	-- une perte de donnée.
	channel_id   uuid        references public.channels (id) on delete set null,
	pos_x        numeric     not null,
	pos_y        numeric     not null,
	width        numeric     not null,
	height       numeric     not null,
	-- NOM DE JETON, jamais un hexadécimal : `docs/DESIGN_SYSTEM.md` §1. Une couleur écrite en
	-- dur en base survivrait à tout changement de charte et la contredirait en silence.
	color        text        not null default 'brand',
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 2.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.goal_blocks drop constraint if exists goal_blocks_title_check;
alter table public.goal_blocks add  constraint goal_blocks_title_check
	check (app.btrim_blancs(title) <> '');

alter table public.goal_blocks drop constraint if exists goal_blocks_fill_percent_check;
alter table public.goal_blocks add  constraint goal_blocks_fill_percent_check
	check (fill_percent between 0 and 100);

-- Un bloc de largeur ou de hauteur nulle serait invisible et impossible à ressaisir à la souris.
alter table public.goal_blocks drop constraint if exists goal_blocks_taille_check;
alter table public.goal_blocks add  constraint goal_blocks_taille_check
	check (width > 0 and height > 0);

alter table public.goal_blocks drop constraint if exists goal_blocks_color_check;
alter table public.goal_blocks add  constraint goal_blocks_color_check
	check (color in ('brand', 'success', 'accent', 'danger', 'neutral'));

comment on table public.goal_blocks is
	'CRM-082 — docs/SCHEMA.md §9 bis.2, docs/SPEC-goals.md §2.2. Bloc d''un tableau d''objectifs. '
	'fill_percent est SAISI et jamais calculé (§1).';
comment on column public.goal_blocks.fill_percent is
	'Entier 0..100, saisi à la main. Aucun trigger ne le calcule : docs/SPEC-goals.md §1.';
comment on column public.goal_blocks.channel_id is
	'Lien volontaire et descendant vers un channel. on delete set null : le bloc survit à la '
	'disparition de sa destination (docs/SPEC-goals.md §2.2).';

create index if not exists goal_blocks_board_idx
	on public.goal_blocks (board_id);
create index if not exists goal_blocks_channel_idx
	on public.goal_blocks (channel_id)
	where channel_id is not null;

drop trigger if exists goal_blocks_set_updated_at on public.goal_blocks;
create trigger goal_blocks_set_updated_at
	before update on public.goal_blocks
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. `public.goal_links` — la flèche
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.3, docs/SPEC-goals.md §2.3 et §2.4.
--
-- TROIS DIRECTIONS ET NON DEUX, alors que `<-` est le symétrique de `->`. Stocker `<-` en
-- inversant source et cible ferait « sauter » la flèche au rechargement, dans l'autre sens que
-- celui où l'utilisateur l'a tracée. Un tableau blanc restitue exactement le geste : la direction
-- est une donnée, pas une normalisation.

create table if not exists public.goal_links (
	id              uuid        primary key default gen_random_uuid(),
	-- REDONDANT avec les blocs, et c'est DÉLIBÉRÉ (`docs/SPEC-goals.md` §2.4). Deux raisons, la
	-- seconde étant la vraie : la politique de lecture se résout sans jointure sur les blocs, et
	-- la colonne rend IMPOSSIBLE un lien entre deux tableaux — le trigger du §5 le garde.
	board_id        uuid        not null references public.goal_boards (id) on delete cascade,
	source_block_id uuid        not null references public.goal_blocks (id) on delete cascade,
	target_block_id uuid        not null references public.goal_blocks (id) on delete cascade,
	direction       text        not null default 'forward',
	label           text,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now()
);

-- --- 3.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.goal_links drop constraint if exists goal_links_direction_check;
alter table public.goal_links add  constraint goal_links_direction_check
	check (direction in ('forward', 'backward', 'both'));

-- Une flèche d'un bloc vers lui-même n'a pas de sens de lecture (`docs/SPEC-goals.md` §2.3).
alter table public.goal_links drop constraint if exists goal_links_boucle_check;
alter table public.goal_links add  constraint goal_links_boucle_check
	check (source_block_id <> target_block_id);

alter table public.goal_links drop constraint if exists goal_links_label_check;
alter table public.goal_links add  constraint goal_links_label_check
	check (label is null or app.btrim_blancs(label) <> '');

comment on table public.goal_links is
	'CRM-082 — docs/SCHEMA.md §9 bis.3, docs/SPEC-goals.md §2.3. Flèche entre deux blocs du MÊME '
	'tableau. AUCUN refus de cycle : « A nourrit B, B nourrit A » est une intention légitime.';
comment on column public.goal_links.direction is
	'forward (->), backward (<-), both (<->). Trois directions et non deux : normaliser <- en '
	'inversant source et cible ferait sauter la flèche au rechargement (docs/SPEC-goals.md §2.3).';
comment on column public.goal_links.board_id is
	'Redondance délibérée avec les blocs : docs/SPEC-goals.md §2.4.';

-- Deux flèches entre les mêmes blocs se superposeraient sans se distinguer : changer la direction
-- d'une flèche existante est une MODIFICATION, pas un ajout (`docs/SPEC-goals.md` §2.3).
drop index if exists goal_links_source_target_key;
create unique index goal_links_source_target_key
	on public.goal_links (source_block_id, target_block_id);

create index if not exists goal_links_board_idx
	on public.goal_links (board_id);
create index if not exists goal_links_target_idx
	on public.goal_links (target_block_id);

drop trigger if exists goal_links_set_updated_at on public.goal_links;
create trigger goal_links_set_updated_at
	before update on public.goal_links
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 4. Attribution automatique de `position`
-- =============================================================================================
-- Même patron que `app.tracks_attribuer_position` (`CRM-011`). Un client qui omet `position`
-- obtient la suivante dans SON workspace. `security definer` : la fonction lit `goal_boards` pour
-- calculer le maximum, et la RLS de la table masquerait les tableaux d'un autre workspace — ce
-- qui est sans effet ici, la sous-requête étant déjà bornée au workspace de la ligne insérée,
-- mais le `definer` garantit que le maximum est le vrai maximum et non celui des lignes visibles.

create or replace function app.goal_boards_attribuer_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(b.position), 0) + 1
			  from public.goal_boards b
			 where b.workspace_id = new.workspace_id
		);
	end if;
	return new;
end;
$$;

alter function app.goal_boards_attribuer_position() owner to postgres;

comment on function app.goal_boards_attribuer_position() is
	'CRM-082 — docs/SPEC-goals.md §2.1. Attribue la position suivante dans le workspace lorsque '
	'`position` est omise. Même patron que app.tracks_attribuer_position (CRM-011).';

revoke all on function app.goal_boards_attribuer_position() from public;

drop trigger if exists goal_boards_attribuer_position on public.goal_boards;
create trigger goal_boards_attribuer_position
	before insert on public.goal_boards
	for each row execute function app.goal_boards_attribuer_position();

-- =============================================================================================
-- 5. Cohérence d'une flèche : ses deux blocs appartiennent à son tableau
-- =============================================================================================
-- `docs/SCHEMA.md` §9 bis.3, `docs/SPEC-goals.md` §2.4. C'est la RAISON D'ÊTRE de la redondance
-- de `board_id` : sans ce trigger, un lien entre deux tableaux ne se détecterait qu'à
-- l'affichage. Même raisonnement que la cohérence workflow ↔ channel de `CRM-033`.
--
-- `security definer` est ICI INDISPENSABLE et non décoratif : le trigger lit `goal_blocks`, dont
-- la politique de lecture masque les blocs liés à un channel illisible (§7.2). Sans `definer`, un
-- appelant qui ne lit pas le channel d'un bloc verrait sa flèche refusée avec « n'appartient pas
-- à ce tableau » — un message FAUX, et une fuite par le message d'erreur.

create or replace function app.goal_links_verifier_tableau()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	board_source uuid;
	board_cible  uuid;
begin
	select b.board_id into board_source
	  from public.goal_blocks b where b.id = new.source_block_id;

	select b.board_id into board_cible
	  from public.goal_blocks b where b.id = new.target_block_id;

	if board_source is distinct from new.board_id
	   or board_cible is distinct from new.board_id then
		raise exception
			'Une flèche relie deux blocs du même tableau (docs/SPEC-goals.md §2.4).'
			using errcode = 'check_violation';
	end if;

	return new;
end;
$$;

alter function app.goal_links_verifier_tableau() owner to postgres;

comment on function app.goal_links_verifier_tableau() is
	'CRM-082 — docs/SPEC-goals.md §2.4. Refuse une flèche dont un bloc n''appartient pas à son '
	'tableau. SECURITY DEFINER : sans cela, un bloc masqué par la RLS ferait rendre un refus faux.';

revoke all on function app.goal_links_verifier_tableau() from public;

drop trigger if exists goal_links_verifier_tableau on public.goal_links;
create trigger goal_links_verifier_tableau
	before insert or update on public.goal_links
	for each row execute function app.goal_links_verifier_tableau();

-- =============================================================================================
-- 6. Fonctions d'appui des politiques
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3.5 interdit qu'une politique relise sa propre table. Aucune de
-- celles du §7 ne le fait — la politique de `goal_links` lit `goal_blocks`, jamais `goal_links`.
--
-- LES QUATRE FONCTIONS SONT `SECURITY DEFINER`, COMME LEURS SŒURS DE `CRM-020`, et c'est la
-- condition de la décision 27 : une fonction `invoker` appelée depuis une politique rejouerait la
-- RLS de la table qu'elle lit, et `app.can_read_goal_block` — lue par la politique de
-- `goal_links` — relancerait la politique de `goal_blocks` à chaque ligne. C'est la récursion
-- mesurée à la décision 27, et le point de vigilance écrit dans la DoD de `CRM-082`.

-- --- 6.1 Lecture et écriture d'un tableau -----------------------------------------------------

create or replace function app.can_read_goal_board(board uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.goal_boards b
		 where b.id = board
		   and app.is_workspace_member(b.workspace_id)
	);
$$;

alter function app.can_read_goal_board(uuid) owner to postgres;

comment on function app.can_read_goal_board(uuid) is
	'CRM-082 — docs/SPEC-goals.md §4.1. Le tableau est lisible par tout membre de son workspace.';

-- L'ÉCRITURE EST OUVERTE À TOUT MEMBRE POUVANT ÉCRIRE, et non aux seuls administrateurs comme
-- pour les tracks : arbitrage du responsable du 2026-08-19, « un utilisateur crée autant
-- d'objectifs qu'il veut » suppose qu'il n'ait pas à demander un administrateur. La lavagna est
-- un outil de travail, pas une configuration.
--
-- UN `viewer` N'ÉCRIT RIEN, tableau libre compris : c'est l'invariant du §2.1 de
-- `docs/SPEC-permissions-rls.md`, « consulte, sans aucune écriture », qu'aucune table n'est
-- autorisée à percer.
create or replace function app.can_write_goal_board(board uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.goal_boards b
		 where b.id = board
		   and app.workspace_role(b.workspace_id) in ('admin', 'business_developer')
	);
$$;

alter function app.can_write_goal_board(uuid) owner to postgres;

comment on function app.can_write_goal_board(uuid) is
	'CRM-082 — docs/SPEC-goals.md §4.2. Tout membre pouvant écrire, jamais un viewer.';

-- --- 6.2 Lecture et écriture d'un bloc --------------------------------------------------------
-- UN BLOC LIÉ À UN CHANNEL FERMÉ EST INVISIBLE, PAS GRISÉ (`docs/SPEC-goals.md` §4.1). C'est le
-- seul choix qui ne fuit pas : rendre le bloc en le grisant révélerait qu'un objectif existe sur
-- un channel interdit, et son titre en dirait déjà trop.
--
-- Ce que cela coûte, et qui est assumé : deux personnes du même workspace peuvent voir deux
-- diagrammes différents du même tableau. La confidentialité prime sur la complétude du dessin.

create or replace function app.can_read_goal_block(block uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.goal_blocks g
		 where g.id = block
		   and app.can_read_goal_board(g.board_id)
		   and (g.channel_id is null or app.can_read_channel(g.channel_id))
	);
$$;

alter function app.can_read_goal_block(uuid) owner to postgres;

comment on function app.can_read_goal_block(uuid) is
	'CRM-082 — docs/SPEC-goals.md §4.1. Un bloc lié à un channel illisible est INVISIBLE.';

-- « Écrire le bloc tel qu'il est » : écrire son tableau, et le voir. La condition de channel est
-- ici la LECTURE et non l'écriture, délibérément — `docs/SPEC-goals.md` §4.2 n'exige
-- `can_write_channel` que pour POSER un lien, geste porté par le `with check` du §7.2. « Retirer
-- le lien n'exige rien de plus que l'écriture sur le bloc : on peut toujours défaire ce qui gêne. »
create or replace function app.can_write_goal_block(block uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.goal_blocks g
		 where g.id = block
		   and app.can_write_goal_board(g.board_id)
		   and (g.channel_id is null or app.can_read_channel(g.channel_id))
	);
$$;

alter function app.can_write_goal_block(uuid) owner to postgres;

comment on function app.can_write_goal_block(uuid) is
	'CRM-082 — docs/SPEC-goals.md §4.2. Écrire le bloc tel qu''il est. Poser un LIEN exige en '
	'plus app.can_write_channel, porté par le with check de la politique.';

-- --- 6.3 Privilèges des quatre fonctions ------------------------------------------------------
-- UN `revoke ... from public` NE SUFFIT PAS : `anon` conserverait son `EXECUTE`, posé par les
-- privilèges par défaut de la distribution. La règle est écrite depuis la décision 80, et une
-- assertion pgTAP la remesure.

revoke all on function app.can_read_goal_board(uuid)  from public;
revoke all on function app.can_write_goal_board(uuid) from public;
revoke all on function app.can_read_goal_block(uuid)  from public;
revoke all on function app.can_write_goal_block(uuid) from public;

grant execute on function app.can_read_goal_board(uuid)  to anon, authenticated, service_role;
grant execute on function app.can_write_goal_board(uuid) to anon, authenticated, service_role;
grant execute on function app.can_read_goal_block(uuid)  to anon, authenticated, service_role;
grant execute on function app.can_write_goal_block(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 7. Row Level Security
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.7. Refus par défaut : la RLS est activée et aucune politique n'est
-- implicite.

alter table public.goal_boards enable row level security;
alter table public.goal_blocks enable row level security;
alter table public.goal_links  enable row level security;

-- --- 7.1 `goal_boards` ------------------------------------------------------------------------

drop policy if exists goal_boards_lecture_membre on public.goal_boards;
create policy goal_boards_lecture_membre
	on public.goal_boards
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists goal_boards_insertion_membre_ecrivant on public.goal_boards;
create policy goal_boards_insertion_membre_ecrivant
	on public.goal_boards
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists goal_boards_maj_membre_ecrivant on public.goal_boards;
create policy goal_boards_maj_membre_ecrivant
	on public.goal_boards
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('admin', 'business_developer'))
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists goal_boards_suppression_membre_ecrivant on public.goal_boards;
create policy goal_boards_suppression_membre_ecrivant
	on public.goal_boards
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

-- --- 7.2 `goal_blocks` ------------------------------------------------------------------------
-- La lecture porte la règle de visibilité du §4.1 : le tableau, ET le channel lorsqu'il y en a un.

drop policy if exists goal_blocks_lecture on public.goal_blocks;
create policy goal_blocks_lecture
	on public.goal_blocks
	for select
	to anon, authenticated
	using (
		app.can_read_goal_board(board_id)
		and (channel_id is null or app.can_read_channel(channel_id))
	);

-- POSER UN LIEN EXIGE L'ÉCRITURE SUR LE CHANNEL, pas seulement sa lecture : un lien est une
-- affirmation publique — « cet objectif porte sur ce dossier » — que verront tous ceux qui lisent
-- le channel. Quelqu'un qui n'a que la lecture ne peut pas engager le dossier d'autrui.
drop policy if exists goal_blocks_insertion on public.goal_blocks;
create policy goal_blocks_insertion
	on public.goal_blocks
	for insert
	to authenticated
	with check (
		app.can_write_goal_board(board_id)
		and (channel_id is null or app.can_write_channel(channel_id))
	);

-- L'ASYMÉTRIE ENTRE `using` ET `with check` EST LA RÈGLE, PAS UN OUBLI. `using` porte sur la
-- ligne ANCIENNE : il n'exige que la LECTURE du channel actuel, de sorte que RETIRER un lien —
-- écrire `channel_id = null` — reste possible à qui écrit le bloc. `with check` porte sur la
-- ligne NOUVELLE : il exige l'ÉCRITURE du channel visé, de sorte que POSER un lien engage
-- réellement la destination. `docs/SPEC-goals.md` §4.2, dernier paragraphe.
drop policy if exists goal_blocks_maj on public.goal_blocks;
create policy goal_blocks_maj
	on public.goal_blocks
	for update
	to authenticated
	using (
		app.can_write_goal_board(board_id)
		and (channel_id is null or app.can_read_channel(channel_id))
	)
	with check (
		app.can_write_goal_board(board_id)
		and (channel_id is null or app.can_write_channel(channel_id))
	);

-- UN BLOC SE SUPPRIME RÉELLEMENT, il ne s'archive pas : il ne porte aucune donnée métier et n'est
-- référencé que par ses flèches, qui partent en `cascade` (`docs/SPEC-goals.md` §3).
drop policy if exists goal_blocks_suppression on public.goal_blocks;
create policy goal_blocks_suppression
	on public.goal_blocks
	for delete
	to authenticated
	using (
		app.can_write_goal_board(board_id)
		and (channel_id is null or app.can_read_channel(channel_id))
	);

-- --- 7.3 `goal_links` -------------------------------------------------------------------------
-- La lecture ne dépend QUE du tableau (`docs/SCHEMA.md` §9 bis.7) : les flèches d'un bloc masqué
-- restent lisibles, et l'écran les rend « en pointillés vers le vide, sans libellé et sans
-- infobulle » (§5.4). C'est la contrepartie assumée du bloc invisible — l'écran ne nomme jamais
-- ce qu'il cache, mais il ne fait pas non plus disparaître le dessin.

drop policy if exists goal_links_lecture on public.goal_links;
create policy goal_links_lecture
	on public.goal_links
	for select
	to anon, authenticated
	using (app.can_read_goal_board(board_id));

drop policy if exists goal_links_insertion on public.goal_links;
create policy goal_links_insertion
	on public.goal_links
	for insert
	to authenticated
	with check (
		app.can_write_goal_block(source_block_id)
		and app.can_write_goal_block(target_block_id)
	);

drop policy if exists goal_links_maj on public.goal_links;
create policy goal_links_maj
	on public.goal_links
	for update
	to authenticated
	using (
		app.can_write_goal_block(source_block_id)
		and app.can_write_goal_block(target_block_id)
	)
	with check (
		app.can_write_goal_block(source_block_id)
		and app.can_write_goal_block(target_block_id)
	);

drop policy if exists goal_links_suppression on public.goal_links;
create policy goal_links_suppression
	on public.goal_links
	for delete
	to authenticated
	using (
		app.can_write_goal_block(source_block_id)
		and app.can_write_goal_block(target_block_id)
	);

-- =============================================================================================
-- 8. Privilèges explicites
-- =============================================================================================
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas
-- des privilèges par défaut de la distribution (même patron que `CRM-060`).

revoke all on public.goal_boards from anon, authenticated;
grant select                 on public.goal_boards to anon, authenticated;
grant insert, update, delete on public.goal_boards to authenticated;
grant all privileges         on public.goal_boards to service_role;

revoke all on public.goal_blocks from anon, authenticated;
grant select                 on public.goal_blocks to anon, authenticated;
grant insert, update, delete on public.goal_blocks to authenticated;
grant all privileges         on public.goal_blocks to service_role;

revoke all on public.goal_links from anon, authenticated;
grant select                 on public.goal_links to anon, authenticated;
grant insert, update, delete on public.goal_links to authenticated;
grant all privileges         on public.goal_links to service_role;

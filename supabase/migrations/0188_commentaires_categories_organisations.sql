-- @spec CRM-153 (docs/BACKLOG.md) — tranche T1 : les catégories d'une organisation (catalogue et poses), son fil de
--       commentaires avec mentions et notification, et le filtre par catégorie de la liste
-- @spec docs/SPEC-organisations.md §9.1, §9.2 ; docs/SCHEMA.md « Migration `0188` » ; docs/SPEC-notifications.md §51
--       docs/JOURNAL.md décisions 932, 939 et 942
--
-- LE PATRON EST CELUI DES AFFAIRES : `card_comments` (0015, 0035), `card_comment_mentions` (0063) et la notification
-- (0064, 0067), repris pour une organisation. Les droits se lisent sur l'organisation et non sur un channel : tout membre
-- de l'espace lit ; le business developer et l'administrateur écrivent — la règle de `organizations_maj_bizdev_admin`.
-- Objets nouveaux en anglais (docs/DAT.md §12 bis). Aucune donnée posée : le catalogue naît vide (décision 939).


-- =============================================================================================
-- 1. Les droits sur une organisation (§9.2)
-- =============================================================================================
--
-- `SECURITY DEFINER` comme `app.can_read_card` : une politique qui les appelle ne dépend pas de la RLS de `organizations`
-- au moment où elle est évaluée. Ils ne rendent qu'un booléen sur l'appelant, ou sur un profil pour la mention.
create or replace function app.can_read_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.organizations o
		 where o.id = p_organization_id
		   and app.is_workspace_member(o.workspace_id));
$$;

comment on function app.can_read_organization(uuid) is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Vrai si l''appelant est membre de l''espace de l''organisation : la règle '
	'de lecture de `organizations_lecture_membre`, pour les politiques du fil, des mentions et des notifications.';

create or replace function app.can_write_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.organizations o
		 where o.id = p_organization_id
		   and app.workspace_role(o.workspace_id) in ('business_developer', 'admin'));
$$;

comment on function app.can_write_organization(uuid) is
	'CRM-153 — docs/SPEC-organisations.md §9.1, §9.2. Vrai si l''appelant peut modifier l''organisation — business '
	'developer ou administrateur, la règle de `organizations_maj_bizdev_admin` : il commente, pose et retire une catégorie.';

create or replace function app.can_read_organization_for(p_organization_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.organizations o
		 where o.id = p_organization_id
		   and app.workspace_role_pour(o.workspace_id, p_profile_id) is not null);
$$;

comment on function app.can_read_organization_for(uuid, uuid) is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Vrai si le profil donné lit l''organisation — un membre de son espace, '
	'lectrice comprise : la règle d''éligibilité d''une mention.';

revoke all on function app.can_read_organization(uuid) from public;
revoke all on function app.can_write_organization(uuid) from public;
revoke all on function app.can_read_organization_for(uuid, uuid) from public;
grant execute on function app.can_read_organization(uuid) to anon, authenticated, service_role;
grant execute on function app.can_write_organization(uuid) to authenticated, service_role;
grant execute on function app.can_read_organization_for(uuid, uuid) to authenticated, service_role;

-- =============================================================================================
-- 2. Le catalogue des catégories (§9.1)
-- =============================================================================================
create table if not exists public.organization_categories (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	color        text        not null default 'neutral',
	archived_at  timestamptz,
	created_by   uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint organization_categories_name_check
		check (app.btrim_blancs(name) <> '' and char_length(name) <= 40),
	constraint organization_categories_color_check
		check (color in ('brand', 'success', 'accent', 'danger', 'neutral')),
	constraint organization_categories_id_workspace_key unique (id, workspace_id)
);

-- UNIQUE SANS CASSE, ARCHIVÉES COMPRISES (§9.1) : une catégorie archivée garde son nom, qu'on retrouve en la désarchivant
-- plutôt qu'en créant sa jumelle. Le déclencheur rogne le nom avant que l'index ne le compare.
create unique index if not exists organization_categories_workspace_name_key
	on public.organization_categories (workspace_id, lower(name));

comment on table public.organization_categories is
	'CRM-153 — docs/SPEC-organisations.md §9.1, décision 939. Le catalogue des catégories d''organisation d''un espace, '
	'défini par l''administrateur, vide à la naissance. « Supprimer » archive : aucune suppression physique.';

create or replace function app.organization_categories_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	new.name := app.btrim_blancs(new.name);
	if tg_op = 'INSERT' then
		new.created_by  := coalesce((select auth.uid()), new.created_by);
		new.created_at  := now();
		new.updated_at  := now();
		new.archived_at := case when new.archived_at is null then null else now() end;
		return new;
	end if;

	new.id           := old.id;
	new.workspace_id := old.workspace_id;
	new.created_by   := old.created_by;
	new.created_at   := old.created_at;
	new.updated_at   := now();
	-- L'HEURE D'ARCHIVAGE EST CELLE DE LA BASE : une date envoyée par le client est ignorée, non refusée ; une catégorie
	-- déjà archivée garde la sienne.
	if new.archived_at is not null then
		new.archived_at := coalesce(old.archived_at, now());
	end if;
	return new;
end;
$$;

comment on function app.organization_categories_before_write() is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Rogne le nom ; pose l''auteur et les horodatages ; fige l''espace, '
	'l''auteur et la création ; l''heure d''archivage est celle de la base.';

drop trigger if exists organization_categories_before_write on public.organization_categories;
create trigger organization_categories_before_write
	before insert or update on public.organization_categories
	for each row execute function app.organization_categories_before_write();

alter table public.organization_categories enable row level security;

drop policy if exists organization_categories_read on public.organization_categories;
create policy organization_categories_read
	on public.organization_categories for select to authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists organization_categories_insert_admin on public.organization_categories;
create policy organization_categories_insert_admin
	on public.organization_categories for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists organization_categories_update_admin on public.organization_categories;
create policy organization_categories_update_admin
	on public.organization_categories for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

comment on policy organization_categories_read on public.organization_categories is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Tout membre de l''espace lit le catalogue, archivées comprises.';
comment on policy organization_categories_insert_admin on public.organization_categories is
	'CRM-153 — docs/SPEC-organisations.md §9.1. L''administrateur seul crée une catégorie.';
comment on policy organization_categories_update_admin on public.organization_categories is
	'CRM-153 — docs/SPEC-organisations.md §9.1. L''administrateur seul renomme, recolore, archive et désarchive. Aucune '
	'politique DELETE : la suppression physique n''existe pas (décision 939).';

revoke all on public.organization_categories from anon, authenticated;
grant select                                 on public.organization_categories to authenticated;
grant insert (workspace_id, name, color)     on public.organization_categories to authenticated;
grant update (name, color, archived_at)      on public.organization_categories to authenticated;
grant all privileges                         on public.organization_categories to service_role;

-- =============================================================================================
-- 3. La pose d'une catégorie sur une organisation (§9.1)
-- =============================================================================================
create table if not exists public.organization_category_links (
	organization_id uuid        not null,
	category_id     uuid        not null,
	workspace_id    uuid        not null,
	created_by      uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at      timestamptz not null default now(),
	primary key (organization_id, category_id),
	constraint organization_category_links_organization_fkey
		foreign key (organization_id, workspace_id) references public.organizations (id, workspace_id) on delete cascade,
	constraint organization_category_links_category_fkey
		foreign key (category_id, workspace_id) references public.organization_categories (id, workspace_id)
		on delete cascade
);

create index if not exists organization_category_links_category_idx
	on public.organization_category_links (category_id);

comment on table public.organization_category_links is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Les catégories posées sur une organisation, plusieurs par organisation. '
	'Retirer est un DELETE de la ligne ; une catégorie archivée ne se pose plus mais se retire.';

create or replace function app.organization_category_links_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_espace         uuid;
	v_espace_cat     uuid;
	v_archivee       timestamptz;
begin
	select o.workspace_id into v_espace from public.organizations o where o.id = new.organization_id;
	if v_espace is null then
		raise exception 'organization_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucune organisation lisible ne porte cet identifiant.';
	end if;

	-- SOUS LA RLS DE L'APPELANT : une catégorie d'un espace qu'il ne lit pas se confond avec une catégorie inexistante, et
	-- les deux reçoivent le même refus — rien ne trahit son existence.
	select c.workspace_id, c.archived_at into v_espace_cat, v_archivee
	  from public.organization_categories c where c.id = new.category_id;
	if v_espace_cat is null or v_espace_cat <> v_espace then
		raise exception 'category_other_workspace'
			using errcode = '22023',
			      detail  = 'Aucune catégorie de l''espace de cette organisation ne porte cet identifiant.';
	end if;
	if v_archivee is not null then
		raise exception 'category_archived'
			using errcode = '22023',
			      detail  = 'Une catégorie archivée ne se pose plus ; elle se désarchive d''abord.';
	end if;

	new.workspace_id := v_espace;
	new.created_by   := coalesce((select auth.uid()), new.created_by);
	new.created_at   := now();
	return new;
end;
$$;

comment on function app.organization_category_links_before_insert() is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Dérive l''espace de l''organisation ; refuse une catégorie d''un autre '
	'espace (22023 category_other_workspace) ou archivée (22023 category_archived) ; pose l''auteur et l''heure.';

drop trigger if exists organization_category_links_before_insert on public.organization_category_links;
create trigger organization_category_links_before_insert
	before insert on public.organization_category_links
	for each row execute function app.organization_category_links_before_insert();

alter table public.organization_category_links enable row level security;

drop policy if exists organization_category_links_read on public.organization_category_links;
create policy organization_category_links_read
	on public.organization_category_links for select to authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists organization_category_links_insert on public.organization_category_links;
create policy organization_category_links_insert
	on public.organization_category_links for insert to authenticated
	with check (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists organization_category_links_delete on public.organization_category_links;
create policy organization_category_links_delete
	on public.organization_category_links for delete to authenticated
	using (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

comment on policy organization_category_links_read on public.organization_category_links is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Tout membre de l''espace lit les poses.';
comment on policy organization_category_links_insert on public.organization_category_links is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Qui peut modifier l''organisation — business developer, administrateur — '
	'pose une catégorie. La lectrice est refusée.';
comment on policy organization_category_links_delete on public.organization_category_links is
	'CRM-153 — docs/SPEC-organisations.md §9.1. Qui peut modifier l''organisation retire une catégorie, archivée comprise.';

revoke all on public.organization_category_links from anon, authenticated;
grant select, delete                          on public.organization_category_links to authenticated;
grant insert (organization_id, category_id)   on public.organization_category_links to authenticated;
grant all privileges                          on public.organization_category_links to service_role;

-- =============================================================================================
-- 4. Le fil de commentaires d'une organisation (§9.2) — la forme de `card_comments`
-- =============================================================================================
create table if not exists public.organization_comments (
	id              uuid        primary key default gen_random_uuid(),
	organization_id uuid        not null,
	workspace_id    uuid        not null,
	author_id       uuid        default auth.uid() references public.profiles (id) on delete set null,
	body            text        not null,
	created_at      timestamptz not null default now(),
	edited_at       timestamptz,
	deleted_at      timestamptz,
	deleted_by      uuid        references public.profiles (id) on delete set null,
	constraint organization_comments_body_check
		check ((deleted_at is null and length(btrim(body)) >= 1 and length(body) <= 10000)
		    or (deleted_at is not null and body = '')),
	constraint organization_comments_organization_fkey
		foreign key (organization_id, workspace_id) references public.organizations (id, workspace_id) on delete cascade,
	constraint organization_comments_id_workspace_key unique (id, workspace_id)
);

create index if not exists organization_comments_organization_created_idx
	on public.organization_comments (organization_id, created_at, id);

comment on table public.organization_comments is
	'CRM-153 — docs/SPEC-organisations.md §9.2, décision 939. Le fil de discussion d''une organisation, comme celui d''une '
	'affaire : écrire exige de pouvoir modifier l''organisation ; l''auteur modifie et supprime le sien ; l''administrateur '
	'modère. Un commentaire supprimé est une PIERRE TOMBALE, vidée de son corps. Le fil n''est pas publié au temps réel.';

create or replace function app.organization_comments_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_espace uuid;
begin
	select o.workspace_id into v_espace from public.organizations o where o.id = new.organization_id;
	if v_espace is null then
		raise exception 'organization_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucune organisation lisible ne porte cet identifiant.';
	end if;

	new.workspace_id := v_espace;
	new.created_at   := now();
	new.edited_at    := null;
	new.deleted_at   := null;
	new.deleted_by   := null;
	return new;
end;
$$;

comment on function app.organization_comments_before_insert() is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Dérive l''espace de l''organisation et interdit un commentaire né modifié '
	'ou supprimé. SECURITY INVOKER par discrétion, comme `app.card_comments_avant_insertion`.';

drop trigger if exists organization_comments_before_insert on public.organization_comments;
create trigger organization_comments_before_insert
	before insert on public.organization_comments
	for each row execute function app.organization_comments_before_insert();

create or replace function app.organization_comments_before_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	-- LES MISES À NUL DES CLÉS `ON DELETE SET NULL` passent : un profil supprimé détache son nom de ses commentaires et
	-- de ses modérations, sans rien changer d'autre — la règle de `app.card_comments_avant_maj` (0035).
	detachement_auteur boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.author_id is not null and new.author_id is null
		and new.id              is not distinct from old.id
		and new.organization_id is not distinct from old.organization_id
		and new.workspace_id    is not distinct from old.workspace_id
		and new.created_at      is not distinct from old.created_at
		and new.body            is not distinct from old.body
		and new.edited_at       is not distinct from old.edited_at
		and new.deleted_at      is not distinct from old.deleted_at
		and new.deleted_by      is not distinct from old.deleted_by;

	detachement_moderateur boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.deleted_by is not null and new.deleted_by is null
		and new.id              is not distinct from old.id
		and new.organization_id is not distinct from old.organization_id
		and new.workspace_id    is not distinct from old.workspace_id
		and new.author_id       is not distinct from old.author_id
		and new.created_at      is not distinct from old.created_at
		and new.body            is not distinct from old.body
		and new.edited_at       is not distinct from old.edited_at
		and new.deleted_at      is not distinct from old.deleted_at;

	v_appelant uuid := (select auth.uid());
begin
	if detachement_auteur or detachement_moderateur then
		return new;
	end if;

	if old.deleted_at is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus être ni modifié ni restauré.';
	end if;

	if new.id              is distinct from old.id
	or new.organization_id is distinct from old.organization_id
	or new.workspace_id    is distinct from old.workspace_id
	or new.author_id       is distinct from old.author_id
	or new.created_at      is distinct from old.created_at then
		raise exception 'comment_immutable_column'
			using errcode = 'P0001',
			      detail  = 'id, organization_id, workspace_id, author_id et created_at sont figés.';
	end if;

	if v_appelant is not null
	   and old.author_id is distinct from v_appelant
	   and new.deleted_at is null then
		raise exception 'comment_moderation_limitee'
			using errcode = 'P0001',
			      detail  = 'Un tiers ne peut que supprimer un commentaire, jamais le modifier.';
	end if;

	if new.deleted_at is not null then
		new.deleted_at := now();
		new.deleted_by := v_appelant;
		new.body       := '';
		new.edited_at  := old.edited_at;
		return new;
	end if;

	new.deleted_by := old.deleted_by;
	if new.body is distinct from old.body then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$$;

comment on function app.organization_comments_before_update() is
	'CRM-153 — docs/SPEC-organisations.md §9.2. La pierre tombale (comment_deleted), cinq colonnes figées '
	'(comment_immutable_column), un tiers ne fait que supprimer (comment_moderation_limitee) ; vide le corps à la '
	'suppression, pose deleted_by, et edited_at si et seulement si le corps change.';

drop trigger if exists organization_comments_before_update on public.organization_comments;
create trigger organization_comments_before_update
	before update on public.organization_comments
	for each row execute function app.organization_comments_before_update();

alter table public.organization_comments enable row level security;

drop policy if exists organization_comments_read on public.organization_comments;
create policy organization_comments_read
	on public.organization_comments for select to anon, authenticated
	using (app.can_read_organization(organization_id));

drop policy if exists organization_comments_insert on public.organization_comments;
create policy organization_comments_insert
	on public.organization_comments for insert to authenticated
	with check (app.can_write_organization(organization_id) and author_id = (select auth.uid()));

drop policy if exists organization_comments_update_author on public.organization_comments;
create policy organization_comments_update_author
	on public.organization_comments for update to authenticated
	using      (author_id = (select auth.uid()) and app.can_write_organization(organization_id))
	with check (author_id = (select auth.uid()) and app.can_write_organization(organization_id));

drop policy if exists organization_comments_moderation on public.organization_comments;
create policy organization_comments_moderation
	on public.organization_comments for update to authenticated
	using      (app.is_workspace_admin(workspace_id) and app.can_read_organization(organization_id))
	with check (app.is_workspace_admin(workspace_id) and app.can_read_organization(organization_id));

comment on policy organization_comments_read on public.organization_comments is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Tout membre de l''espace lit le fil. Accordée à anon pour que le refus '
	'soit zéro ligne et non une erreur de privilège.';
comment on policy organization_comments_insert on public.organization_comments is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Commente qui peut modifier l''organisation, et seulement en son nom.';
comment on policy organization_comments_update_author on public.organization_comments is
	'CRM-153 — docs/SPEC-organisations.md §9.2. L''auteur modifie et supprime le sien tant qu''il garde le droit d''écrire.';
comment on policy organization_comments_moderation on public.organization_comments is
	'CRM-153 — docs/SPEC-organisations.md §9.2. L''administrateur supprime le commentaire d''un tiers ; le déclencheur '
	'refuse qu''il le modifie.';

revoke all on public.organization_comments from anon, authenticated;
grant select                                   on public.organization_comments to anon, authenticated;
grant insert (organization_id, author_id, body) on public.organization_comments to authenticated;
grant update (body, deleted_at)                on public.organization_comments to authenticated;
grant all privileges                           on public.organization_comments to service_role;

-- =============================================================================================
-- 5. Les mentions d'un commentaire (§9.2) — la forme de `card_comment_mentions`
-- =============================================================================================
create table if not exists public.organization_comment_mentions (
	comment_id   uuid        not null,
	profile_id   uuid        not null references public.profiles (id) on delete cascade,
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	created_at   timestamptz not null default now(),
	primary key (comment_id, profile_id),
	constraint organization_comment_mentions_comment_fkey
		foreign key (comment_id, workspace_id) references public.organization_comments (id, workspace_id)
		on delete cascade
);

create index if not exists organization_comment_mentions_profile_created_idx
	on public.organization_comment_mentions (profile_id, created_at desc);

comment on table public.organization_comment_mentions is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Les membres mentionnés dans un commentaire d''organisation ; seul l''auteur '
	'pose ses mentions ; chacune notifie son destinataire, sauf l''auteur qui se mentionne.';

create or replace function app.organization_of_comment(p_comment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select oc.organization_id from public.organization_comments oc where oc.id = p_comment_id;
$$;

comment on function app.organization_of_comment(uuid) is
	'CRM-153 — docs/SPEC-organisations.md §9.2. L''organisation d''un commentaire, pour les politiques des mentions — la '
	'forme de `app.card_du_commentaire`.';

revoke all on function app.organization_of_comment(uuid) from public;
grant execute on function app.organization_of_comment(uuid) to anon, authenticated, service_role;

create or replace function app.organization_comment_mentions_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_organisation uuid;
	v_espace       uuid;
	v_supprime     timestamptz;
begin
	select oc.organization_id, oc.workspace_id, oc.deleted_at
	  into v_organisation, v_espace, v_supprime
	  from public.organization_comments oc
	 where oc.id = new.comment_id;

	if v_organisation is null then
		raise exception 'comment_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucun commentaire lisible ne porte cet identifiant.';
	end if;

	if v_supprime is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus mentionner personne.';
	end if;

	if not app.can_read_organization_for(v_organisation, new.profile_id) then
		raise exception 'mention_destinataire_sans_acces'
			using errcode = 'P0001',
			      detail  = 'Une mention ne désigne que quelqu''un qui peut lire cette organisation.';
	end if;

	new.workspace_id := v_espace;
	new.created_at   := now();
	return new;
end;
$$;

comment on function app.organization_comment_mentions_before_insert() is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Refuse un commentaire introuvable (comment_not_found) ou supprimé '
	'(comment_deleted), et un destinataire qui ne lit pas l''organisation (mention_destinataire_sans_acces) ; dérive '
	'l''espace du commentaire.';

drop trigger if exists organization_comment_mentions_before_insert on public.organization_comment_mentions;
create trigger organization_comment_mentions_before_insert
	before insert on public.organization_comment_mentions
	for each row execute function app.organization_comment_mentions_before_insert();

alter table public.organization_comment_mentions enable row level security;

drop policy if exists organization_comment_mentions_read on public.organization_comment_mentions;
create policy organization_comment_mentions_read
	on public.organization_comment_mentions for select to anon, authenticated
	using (app.can_read_organization(app.organization_of_comment(comment_id)));

drop policy if exists organization_comment_mentions_insert on public.organization_comment_mentions;
create policy organization_comment_mentions_insert
	on public.organization_comment_mentions for insert to authenticated
	with check (
		app.can_write_organization(app.organization_of_comment(comment_id))
		and exists (select 1 from public.organization_comments oc
		             where oc.id = organization_comment_mentions.comment_id
		               and oc.author_id = (select auth.uid())));

drop policy if exists organization_comment_mentions_delete on public.organization_comment_mentions;
create policy organization_comment_mentions_delete
	on public.organization_comment_mentions for delete to authenticated
	using (
		app.can_write_organization(app.organization_of_comment(comment_id))
		and exists (select 1 from public.organization_comments oc
		             where oc.id = organization_comment_mentions.comment_id
		               and oc.author_id = (select auth.uid())));

comment on policy organization_comment_mentions_read on public.organization_comment_mentions is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Qui lit l''organisation lit les mentions de son fil.';
comment on policy organization_comment_mentions_insert on public.organization_comment_mentions is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Seul l''auteur du commentaire, qui garde le droit d''écrire, pose ses mentions.';
comment on policy organization_comment_mentions_delete on public.organization_comment_mentions is
	'CRM-153 — docs/SPEC-organisations.md §9.2. Seul l''auteur du commentaire retire ses mentions.';

revoke all on public.organization_comment_mentions from anon, authenticated;
grant select                           on public.organization_comment_mentions to anon, authenticated;
grant insert (comment_id, profile_id), delete on public.organization_comment_mentions to authenticated;
grant all privileges                   on public.organization_comment_mentions to service_role;

-- =============================================================================================
-- 6. La notification : un second sujet possible (§9.2 ; docs/SPEC-notifications.md §51)
-- =============================================================================================
alter table public.notifications add column if not exists subject_organization_id uuid;

do $$
begin
	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.notifications'::regclass
	                  and conname = 'notifications_subject_organization_fkey') then
		alter table public.notifications
			add constraint notifications_subject_organization_fkey
			foreign key (subject_organization_id, workspace_id) references public.organizations (id, workspace_id)
			on delete cascade;
	end if;
	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.notifications'::regclass
	                  and conname = 'notifications_single_subject_check') then
		alter table public.notifications
			add constraint notifications_single_subject_check
			check (num_nonnulls(subject_card_id, subject_organization_id) <= 1);
	end if;
end;
$$;

comment on column public.notifications.subject_organization_id is
	'CRM-153 — docs/SPEC-notifications.md §51. L''organisation dont le fil a produit la notification ; jamais posée avec '
	'subject_card_id (notifications_single_subject_check). Supprimer l''organisation supprime ses notifications.';

drop policy if exists notifications_lecture on public.notifications;
create policy notifications_lecture
	on public.notifications for select to anon, authenticated
	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
		and (subject_organization_id is null or app.can_read_organization(subject_organization_id))
		and app.notification_consentie(recipient_id, type));

drop policy if exists notifications_marquage on public.notifications;
create policy notifications_marquage
	on public.notifications for update to authenticated
	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
		and (subject_organization_id is null or app.can_read_organization(subject_organization_id)))
	with check (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
		and (subject_organization_id is null or app.can_read_organization(subject_organization_id)));

comment on policy notifications_lecture on public.notifications is
	'CRM-053 — docs/SPEC-notifications.md §16.1, §19 ; CRM-153 — §51. Le destinataire lit sa notification s''il lit son '
	'sujet — affaire ou organisation — et s''il n''a pas refusé son type.';
comment on policy notifications_marquage on public.notifications is
	'CRM-053 — docs/SPEC-notifications.md §16.2 ; CRM-153 — §51. Le destinataire marque lue sa notification s''il lit son '
	'sujet, affaire ou organisation.';

create or replace function app.notifications_after_organization_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_organisation uuid;
	v_auteur       uuid;
begin
	select oc.organization_id, oc.author_id
	  into v_organisation, v_auteur
	  from public.organization_comments oc
	 where oc.id = new.comment_id;

	-- UNE AUTO-MENTION NE NOTIFIE PAS (docs/SPEC-notifications.md §14.3) : la comparaison porte sur `author_id`, jamais
	-- sur `auth.uid()`, nul par la clé de service — la règle de `app.notifications_apres_mention`.
	if v_auteur is not null and v_auteur = new.profile_id then
		return null;
	end if;

	insert into public.notifications
		(workspace_id, recipient_id, type, subject_organization_id, payload, created_at, read_at)
	values (
		new.workspace_id,
		new.profile_id,
		'mention',
		v_organisation,
		jsonb_build_object('comment_id', new.comment_id, 'author_id', v_auteur),
		now(),
		null
	);
	return null;
end;
$$;

comment on function app.notifications_after_organization_mention() is
	'CRM-153 — docs/SPEC-organisations.md §9.2, docs/SPEC-notifications.md §51. Une mention dans le fil d''une '
	'organisation notifie son destinataire — type mention, subject_organization_id, payload {comment_id, author_id} — '
	'sauf l''auteur qui se mentionne. SECURITY DEFINER : l''auteur n''écrit pas dans la boîte d''un autre.';

revoke all on function app.notifications_after_organization_mention() from public;

drop trigger if exists notifications_after_organization_mention on public.organization_comment_mentions;
create trigger notifications_after_organization_mention
	after insert on public.organization_comment_mentions
	for each row execute function app.notifications_after_organization_mention();

-- =============================================================================================
-- 7. La liste des organisations : le filtre par catégorie (§9.1)
-- =============================================================================================
--
-- `p_category_ids` VIENT EN DERNIER : un appel nommé sans lui, celui de la webapp et du connecteur livrés, garde son sens,
-- et un appel positionnel aussi. L'ancienne signature est retirée pour qu'aucune surcharge ne rende l'appel ambigu.
drop function if exists public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer);

create or replace function public.organization_list(
	p_workspace_id uuid,
	p_search text default null,
	p_track_ids uuid[] default null,
	p_revenues text default 'all',
	p_sort text default 'name',
	p_descending boolean default false,
	p_limit integer default 50,
	p_offset integer default 0,
	p_category_ids uuid[] default null
)
returns table (
	id uuid,
	name text,
	domain text,
	website text,
	contacts integer,
	has_revenues boolean,
	total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_recherche  text := nullif(btrim(coalesce(p_search, '')), '');
	v_motif      text;
	v_tracks     uuid[] := case when cardinality(coalesce(p_track_ids, '{}')) = 0 then null else p_track_ids end;
	v_categories uuid[] := case when cardinality(coalesce(p_category_ids, '{}')) = 0 then null else p_category_ids end;
	v_limite     integer := least(greatest(coalesce(p_limit, 50), 1), 100);
	v_decalage   integer := greatest(coalesce(p_offset, 0), 0);
begin
	if coalesce(p_revenues, 'all') not in ('all', 'with', 'without') then
		raise exception 'invalid_revenues_filter' using errcode = '22023';
	end if;
	if coalesce(p_sort, 'name') not in ('name', 'contacts') then
		raise exception 'invalid_sort' using errcode = '22023';
	end if;
	-- LES JOKERS DE LA SAISIE SONT ÉCHAPPÉS : « 100% » cherche « 100% », pas « 100 » suivi de n'importe quoi.
	if v_recherche is not null then
		v_motif := '%' || replace(replace(replace(v_recherche, '\', '\\'), '%', '\%'), '_', '\_') || '%';
	end if;

	return query
	with candidates as (
		select o.id, o.name, o.domain, o.website,
		       (select count(*) from public.contacts ct where ct.organization_id = o.id)::integer as contacts,
		       exists (
		           select 1
		             from public.contacts ct
		             join public.card_contacts cc on cc.contact_id = ct.id
		             join public.cards c on c.id = cc.card_id and c.deleted_at is null
		             join public.card_revenues r on r.card_id = c.id
		            where ct.organization_id = o.id
		       ) as has_revenues
		  from public.organizations o
		 where o.workspace_id = p_workspace_id
		   and (v_motif is null
		        or o.name ilike v_motif
		        or coalesce(o.domain, '') ilike v_motif
		        or coalesce(o.website, '') ilike v_motif)
		   and (v_tracks is null or exists (
		           select 1 from public.organization_tracks(array[o.id]) ot where ot.track_id = any (v_tracks)))
		   -- L'UNE DES CATÉGORIES DONNÉES, ARCHIVÉES COMPRISES (§9.1) : on retrouve les organisations d'une catégorie qu'on
		   -- vient d'archiver.
		   and (v_categories is null or exists (
		           select 1 from public.organization_category_links l
		            where l.organization_id = o.id and l.category_id = any (v_categories)))
	),
	filtrees as (
		select * from candidates c
		 where coalesce(p_revenues, 'all') = 'all'
		    or (p_revenues = 'with' and c.has_revenues)
		    or (p_revenues = 'without' and not c.has_revenues)
	)
	select f.id, f.name, f.domain, f.website, f.contacts, f.has_revenues, count(*) over ()
	  from filtrees f
	 order by
	   case when p_sort = 'contacts' and not coalesce(p_descending, false) then f.contacts end asc nulls last,
	   case when p_sort = 'contacts' and coalesce(p_descending, false) then f.contacts end desc nulls last,
	   case when coalesce(p_sort, 'name') = 'name' and coalesce(p_descending, false) then lower(f.name) end desc,
	   lower(f.name) asc,
	   f.id asc
	 limit v_limite offset v_decalage;
end;
$$;

comment on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[]) is
	'CRM-152 — docs/SPEC-organisations.md §8.2 ; CRM-153 — §9.1. Les organisations de l''espace que l''appelant lit : '
	'recherche dans le nom, le domaine et le site web ; l''un des tracks donnés ; l''une des catégories données, archivées '
	'comprises ; avec ou sans recettes ; tri par nom ou contacts, ordre total ; paginé, total_count compté. 22023 '
	'invalid_revenues_filter, invalid_sort.';

revoke all on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])
	from public, anon;
grant execute on function public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])
	to authenticated;


notify pgrst, 'reload schema';

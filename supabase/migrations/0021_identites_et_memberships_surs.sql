-- @spec CRM-022 (docs/BACKLOG.md) — identités lisibles et memberships sûrs
-- @spec docs/SPEC-identite.md §1 à §10
-- @spec docs/SCHEMA.md §1 et §5
-- @spec docs/SPEC-permissions-rls.md §4.1 bis et §7
-- @spec docs/JOURNAL.md décisions 294 et 307
--
-- Cette migration ferme le refus par défaut laissé volontairement par CRM-003 sur les trois
-- tables d'identité. Elle borne les seules données de profil éditables, garantit qu'une mutation
-- d'appartenance ne laisse pas un workspace existant sans administrateur et détache l'auteur
-- d'un commentaire lors de la suppression d'un profil sans perdre sa parole.

-- =============================================================================================
-- 0. Refus explicite des états legacy incompatibles
-- =============================================================================================

do $$
begin
	if exists (
		select 1
		  from public.profiles p
		 where p.full_name <> pg_catalog.btrim(p.full_name)
		    or pg_catalog.char_length(p.full_name) not between 1 and 120
	) then
		raise exception 'invalid_legacy_profile_name' using errcode = '23514';
	end if;

	if exists (
		select 1
		  from public.profiles p
		 where p.avatar_url is not null
		   and (
			pg_catalog.char_length(p.avatar_url) > 2048
			or not (
				pg_catalog.left(p.avatar_url, 8) = 'https://'
				or (
					pg_catalog.left(p.avatar_url, 1) = '/'
					and pg_catalog.left(p.avatar_url, 2) <> '//'
				)
			)
		   )
	) then
		raise exception 'invalid_legacy_profile_avatar' using errcode = '23514';
	end if;

	if exists (
		select 1
		  from public.workspace_members wm
		 group by wm.workspace_id
		having pg_catalog.bool_or(wm.role = 'admin') is not true
	) then
		raise exception 'legacy_workspace_without_admin' using errcode = '23514';
	end if;
end;
$$;

-- =============================================================================================
-- 1. Profil propre : normalisation et bornes durables
-- =============================================================================================

create or replace function app.profile_normaliser_nom()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	new.full_name := pg_catalog.btrim(new.full_name);
	return new;
end;
$$;

comment on function app.profile_normaliser_nom() is
	'CRM-022 — docs/SPEC-identite.md §4. Retire les espaces de bord du nom avant validation.';

do $$
begin
	if not exists (
		select 1
		  from pg_catalog.pg_trigger t
		 where t.tgrelid = 'public.profiles'::regclass
		   and t.tgname = 'profiles_normaliser_nom'
		   and not t.tgisinternal
		   and pg_catalog.pg_get_triggerdef(t.oid) =
		       'CREATE TRIGGER profiles_normaliser_nom BEFORE INSERT OR UPDATE OF full_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION app.profile_normaliser_nom()'
	) then
		drop trigger if exists profiles_normaliser_nom on public.profiles;
		create trigger profiles_normaliser_nom
			before insert or update of full_name on public.profiles
			for each row execute function app.profile_normaliser_nom();
	end if;
end;
$$;

do $$
declare
	definition_reelle text;
begin
	select pg_catalog.pg_get_constraintdef(c.oid)
	  into definition_reelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = 'public.profiles'::regclass
	   and c.conname = 'profiles_full_name_check';

	if definition_reelle is distinct from
	   'CHECK (((full_name = btrim(full_name)) AND ((char_length(full_name) >= 1) AND (char_length(full_name) <= 120))))' then
		alter table public.profiles drop constraint if exists profiles_full_name_check;
		alter table public.profiles add constraint profiles_full_name_check check (
			full_name = pg_catalog.btrim(full_name)
			and pg_catalog.char_length(full_name) between 1 and 120
		);
	end if;

	select pg_catalog.pg_get_constraintdef(c.oid)
	  into definition_reelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = 'public.profiles'::regclass
	   and c.conname = 'profiles_avatar_url_check';

	if definition_reelle is distinct from
	   'CHECK (((avatar_url IS NULL) OR ((char_length(avatar_url) <= 2048) AND (("left"(avatar_url, 8) = ''https://''::text) OR (("left"(avatar_url, 1) = ''/''::text) AND ("left"(avatar_url, 2) <> ''//''::text))))))' then
		alter table public.profiles drop constraint if exists profiles_avatar_url_check;
		alter table public.profiles add constraint profiles_avatar_url_check check (
			avatar_url is null
			or (
				pg_catalog.char_length(avatar_url) <= 2048
				and (
					pg_catalog.left(avatar_url, 8) = 'https://'
					or (
						pg_catalog.left(avatar_url, 1) = '/'
						and pg_catalog.left(avatar_url, 2) <> '//'
					)
				)
			)
		);
	end if;
end;
$$;

comment on constraint profiles_full_name_check on public.profiles is
	'CRM-022 — nom normalisé, non blanc et borné à 120 caractères.';
comment on constraint profiles_avatar_url_check on public.profiles is
	'CRM-022 — avatar nullable, chemin même origine hors // ou URL HTTPS, borné à 2048 caractères.';

-- La création GoTrue applique les mêmes bornes sans faire échouer un compte à cause d'une URL de
-- métadonnée extérieure ou mal formée. `on conflict do nothing` protège toujours les éditions.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_nom text;
	v_avatar text := nullif(new.raw_user_meta_data ->> 'avatar_url', '');
begin
	v_nom := pg_catalog.left(
		coalesce(
			nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
			nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
			nullif(pg_catalog.btrim(pg_catalog.split_part(
				coalesce(new.email, ''), '@', 1)), ''),
			'Utilisateur ' || pg_catalog.left(new.id::text, 8)
		),
		120
	);

	if v_avatar is not null and (
		pg_catalog.char_length(v_avatar) > 2048
		or not (
			pg_catalog.left(v_avatar, 8) = 'https://'
			or (
				pg_catalog.left(v_avatar, 1) = '/'
				and pg_catalog.left(v_avatar, 2) <> '//'
			)
		)
	) then
		v_avatar := null;
	end if;

	insert into public.profiles (id, full_name, avatar_url, locale)
	values (
		new.id,
		v_nom,
		v_avatar,
		coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'fr')
	)
	on conflict (id) do nothing;

	return new;
end;
$$;

alter function app.handle_new_user() owner to postgres;
revoke all on function app.handle_new_user() from public, anon, authenticated, service_role;

comment on function app.handle_new_user() is
	'CRM-022 — docs/SPEC-identite.md §4. Crée un profil borné depuis GoTrue ; une URL avatar '
	'invalide devient nulle et un profil existant reste intact.';

-- =============================================================================================
-- 2. Parole historique : suppression du profil sans suppression du commentaire
-- =============================================================================================

alter table public.card_comments alter column author_id drop not null;

do $$
declare
	v_contrainte record;
begin
	select c.conname, c.confdeltype
	  into v_contrainte
	  from pg_catalog.pg_constraint c
	 where c.conrelid = 'public.card_comments'::regclass
	   and c.conname = 'card_comments_author_id_fkey'
	   and c.contype = 'f';

	if v_contrainte.conname is null or v_contrainte.confdeltype <> 'n' then
		alter table public.card_comments drop constraint if exists card_comments_author_id_fkey;
		alter table public.card_comments
			add constraint card_comments_author_id_fkey
			foreign key (author_id) references public.profiles(id) on delete set null;
	end if;
end;
$$;

comment on column public.card_comments.author_id is
	'CRM-022 — auteur nullable : ON DELETE SET NULL conserve la parole et permet « Compte supprimé ».';

-- Le trigger de CRM-043 gelait `author_id` pour tous les rôles. Une action référentielle SET NULL
-- est elle-même un UPDATE de la ligne enfant : sans cette exception étroite, la FK ci-dessus
-- annoncerait la conservation de la parole tout en bloquant chaque suppression réelle de compte.
--
-- `pg_trigger_depth() > 1` distingue l'UPDATE émis par le trigger FK du PATCH direct. Les quatre
-- autres colonnes immuables et toutes les données éditables doivent en outre rester identiques :
-- aucun geste applicatif imbriqué ne peut employer cette porte pour réécrire le commentaire.
--
-- CRM-064, INC-240, 2026-08-29 : la porte comparait aussi `new.mentions` à `old.mentions`. La
-- migration 0063 a SUPPRIMÉ `public.card_comments.mentions` et l'a remplacée par la table
-- `public.card_comment_mentions` ; la comparaison a donc disparu de la définition finale, mais elle
-- subsistait ICI. Le rejeu du répertoire complet le masquait — 0063 réécrit la fonction après —,
-- mais tout rejeu qui s'arrête ou qui VISE cette migration reposait cette définition sur une base
-- où la colonne n'existe plus : le trigger `before update` de `card_comments` sortait alors en
-- 42703, et plus aucun commentaire n'était modifiable ni supprimable, ni aucun compte supprimable.
-- La comparaison est retirée ici comme elle l'a été dans 0015 et 0063 ; le reste du corps est repris
-- MOT POUR MOT, et la porte reste exactement aussi étroite — voir docs/SPEC-notifications.md §7.4.1.
create or replace function app.card_comments_avant_maj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	detachement_fk boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.author_id is not null
		and new.author_id is null
		and new.id           is not distinct from old.id
		and new.card_id      is not distinct from old.card_id
		and new.workspace_id is not distinct from old.workspace_id
		and new.created_at   is not distinct from old.created_at
		and new.body         is not distinct from old.body
		and new.edited_at    is not distinct from old.edited_at
		and new.deleted_at   is not distinct from old.deleted_at;
begin
	if detachement_fk then
		return new;
	end if;

	if old.deleted_at is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus être ni modifié ni restauré.';
	end if;

	if new.id           is distinct from old.id
	or new.card_id      is distinct from old.card_id
	or new.workspace_id is distinct from old.workspace_id
	or new.author_id    is distinct from old.author_id
	or new.created_at   is distinct from old.created_at then
		raise exception 'comment_immutable_column'
			using errcode = 'P0001',
			      detail  = 'id, card_id, workspace_id, author_id et created_at sont figés.';
	end if;

	if new.deleted_at is not null then
		new.deleted_at := now();
		new.body       := '';
		new.edited_at  := old.edited_at;
		return new;
	end if;

	if new.body is distinct from old.body then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$$;

comment on function app.card_comments_avant_maj() is
	'CRM-022 + CRM-043 — garde la pierre tombale et les colonnes immuables. Seul le SET NULL '
	'interne de la FK auteur, reconnaissable à sa profondeur et à l''absence de toute autre '
	'modification, détache une identité supprimée sans perdre sa parole.';

-- =============================================================================================
-- 3. Invariant du dernier administrateur
-- =============================================================================================

create or replace function app.workspace_members_garder_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_workspace_id uuid;
begin
	-- Le workspace source doit rester administré. Cette vérification ne dépend volontairement pas
	-- du nombre de membres restant : supprimer l'unique ligne admin ne doit pas contourner la
	-- garde en transformant le workspace en espace vide.
	if tg_op <> 'INSERT' then
		v_workspace_id := old.workspace_id;
		if exists (
			select 1 from public.workspaces w where w.id = v_workspace_id
		) and not exists (
			select 1
			  from public.workspace_members wm
			 where wm.workspace_id = v_workspace_id
			   and wm.role = 'admin'
		) then
			raise exception 'last_workspace_admin'
				using errcode = '23514',
				      detail = 'Un workspace existant doit conserver au moins un administrateur.';
		end if;
	end if;

	-- Une insertion ou un déplacement propriétaire ne peut pas peupler un workspace avec un rôle
	-- non-admin en premier. En UPDATE sans déplacement, le contrôle source ci-dessus suffit.
	if tg_op <> 'DELETE'
	   and (tg_op = 'INSERT' or new.workspace_id is distinct from old.workspace_id) then
		v_workspace_id := new.workspace_id;
		if exists (
			select 1 from public.workspaces w where w.id = v_workspace_id
		) and not exists (
			select 1
			  from public.workspace_members wm
			 where wm.workspace_id = v_workspace_id
			   and wm.role = 'admin'
		) then
			raise exception 'last_workspace_admin'
				using errcode = '23514',
				      detail = 'La première appartenance d''un workspace doit être administratrice.';
		end if;
	end if;

	return null;
end;
$$;

alter function app.workspace_members_garder_admin() owner to postgres;
revoke all on function app.workspace_members_garder_admin()
	from public, anon, authenticated, service_role;

comment on function app.workspace_members_garder_admin() is
	'CRM-022 — docs/SPEC-identite.md §5. Constraint trigger différable : toute mutation '
	'de membership laisse un admin dans le workspace parent tant qu''il existe.';

do $$
declare
	definition_reelle text;
begin
	select pg_catalog.pg_get_triggerdef(t.oid)
	  into definition_reelle
	  from pg_catalog.pg_trigger t
	 where t.tgrelid = 'public.workspace_members'::regclass
	   and t.tgname = 'workspace_members_garder_admin'
	   and not t.tgisinternal;

	if definition_reelle is distinct from
	   'CREATE CONSTRAINT TRIGGER workspace_members_garder_admin AFTER INSERT OR DELETE OR UPDATE ON public.workspace_members DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION app.workspace_members_garder_admin()' then
		drop trigger if exists workspace_members_garder_admin on public.workspace_members;
		create constraint trigger workspace_members_garder_admin
			after insert or update or delete on public.workspace_members
			deferrable initially immediate
			for each row execute function app.workspace_members_garder_admin();
	end if;
end;
$$;

comment on trigger workspace_members_garder_admin on public.workspace_members is
	'CRM-022 — bloque suppression/rétrogradation du dernier admin ; différable pour rotation '
	'atomique et compatible avec la cascade de suppression du workspace.';

-- =============================================================================================
-- 4. Privilèges minimaux : les colonnes protégées ne reposent pas sur la seule RLS
-- =============================================================================================

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant all privileges on public.profiles to service_role;

revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to anon, authenticated;
grant all privileges on public.workspaces to service_role;

revoke all on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to anon, authenticated;
grant insert, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;
grant all privileges on public.workspace_members to service_role;

-- =============================================================================================
-- 5. Sept politiques : visibilité d'équipe et administration explicite
-- =============================================================================================

create or replace function app.migration_0021_converger_politique(
	table_cible regclass,
	nom_politique text,
	commande_cible "char",
	roles_sql text,
	using_sql text,
	check_sql text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	commande_reelle "char";
	permissive_reelle boolean;
	commande_sql text;
	requete text;
begin
	select p.polcmd, p.polpermissive
	  into commande_reelle, permissive_reelle
	  from pg_catalog.pg_policy p
	 where p.polrelid = table_cible
	   and p.polname = nom_politique;

	commande_sql := case commande_cible
		when 'r' then 'SELECT'
		when 'a' then 'INSERT'
		when 'w' then 'UPDATE'
		when 'd' then 'DELETE'
		else null
	end;

	if commande_sql is null then
		raise exception 'invalid_policy_command';
	end if;

	if commande_reelle is null
	   or commande_reelle <> commande_cible
	   or permissive_reelle is not true then
		execute pg_catalog.format(
			'drop policy if exists %I on %s', nom_politique, table_cible);
		requete := pg_catalog.format(
			'create policy %I on %s as permissive for %s to %s',
			nom_politique, table_cible, commande_sql, roles_sql);
	else
		requete := pg_catalog.format(
			'alter policy %I on %s to %s', nom_politique, table_cible, roles_sql);
	end if;

	if using_sql is not null then
		requete := requete || ' using (' || using_sql || ')';
	end if;
	if check_sql is not null then
		requete := requete || ' with check (' || check_sql || ')';
	end if;

	execute requete;
end;
$$;

select app.migration_0021_converger_politique(
	'public.profiles', 'profiles_lecture_equipe', 'r', 'anon, authenticated',
	'id = (select auth.uid()) or exists (select 1 from public.workspace_members cible ' ||
	'where cible.user_id = profiles.id and app.is_workspace_member(cible.workspace_id))',
	null);

select app.migration_0021_converger_politique(
	'public.profiles', 'profiles_maj_propre', 'w', 'authenticated',
	'id = (select auth.uid())', 'id = (select auth.uid())');

select app.migration_0021_converger_politique(
	'public.workspaces', 'workspaces_lecture_membre', 'r', 'anon, authenticated',
	'app.is_workspace_member(id)', null);

select app.migration_0021_converger_politique(
	'public.workspace_members', 'workspace_members_lecture_membre', 'r',
	'anon, authenticated', 'app.is_workspace_member(workspace_id)', null);

select app.migration_0021_converger_politique(
	'public.workspace_members', 'workspace_members_insertion_admin', 'a',
	'authenticated', null, 'app.is_workspace_admin(workspace_id)');

select app.migration_0021_converger_politique(
	'public.workspace_members', 'workspace_members_maj_admin', 'w',
	'authenticated', 'app.is_workspace_admin(workspace_id)',
	'app.is_workspace_admin(workspace_id)');

select app.migration_0021_converger_politique(
	'public.workspace_members', 'workspace_members_suppression_admin', 'd',
	'authenticated', 'app.is_workspace_admin(workspace_id)', null);

comment on policy profiles_lecture_equipe on public.profiles is
	'CRM-022 — profil propre ou profil d''une personne partageant au moins un workspace.';
comment on policy profiles_maj_propre on public.profiles is
	'CRM-022 — seule sa propre ligne ; les privilèges bornent aux colonnes nom et avatar.';
comment on policy workspaces_lecture_membre on public.workspaces is
	'CRM-022 — un membre lit seulement ses workspaces.';
comment on policy workspace_members_lecture_membre on public.workspace_members is
	'CRM-022 — un membre lit toutes les appartenances de son workspace.';
comment on policy workspace_members_insertion_admin on public.workspace_members is
	'CRM-022 — seul un admin ajoute une appartenance.';
comment on policy workspace_members_maj_admin on public.workspace_members is
	'CRM-022 — seul un admin change un rôle ; les autres colonnes sont fermées par privilège.';
comment on policy workspace_members_suppression_admin on public.workspace_members is
	'CRM-022 — seul un admin retire une appartenance ; la garde protège le dernier admin.';

drop function if exists app.migration_0021_converger_politique(
	regclass, text, "char", text, text, text);

notify pgrst, 'reload schema';

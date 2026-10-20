-- @spec CRM-101 (docs/BACKLOG.md) — tranche T1 : la plateforme et son superadministrateur, en base
-- @spec docs/SPEC-plateforme.md §2 (qui est superadministrateur), §3 (amorçage unique), §4 (admission révisée),
--       §5 (modèle de données), §6 (fonctions et dictionnaire des refus) ; docs/SCHEMA.md §1 bis ;
--       docs/SPEC-session-sso.md §6.1 (condition 3 révisée), §6.2, §7.4, §7.7 ; docs/SPEC-identite.md §5
--       (invariant du dernier administrateur, remonté tel quel) ; docs/PROD_MIGRATIONS.md §2.13
-- @spec docs/JOURNAL.md décision 627 (arbitrages A1 et D7)
--
-- CE QUE CETTE MIGRATION FAIT, ET RIEN D'AUTRE.
--   1. `public.superadmins` et `public.plateforme_journal`, fermées à l'API : RLS sans politique, privilèges retirés
--      NOMMÉMENT (docs/SCHEMA.md §9 : les privilèges par défaut de l'image les accorderaient sinon).
--   2. Les fonctions d'appui du schéma `app` : `est_superadmin`, `est_superadmin_pour`, `exiger_superadmin`,
--      `amorcer_superadmin`, et deux validations.
--   3. Les fonctions `public.plateforme_*`, toutes `SECURITY DEFINER` et gardées EN PREMIER par
--      `app.exiger_superadmin()` : un superadministrateur en base n'est membre d'aucun espace, et la RLS des
--      appartenances et des attentes le refuserait. La garde écrite ici est donc la règle d'accès, et la suite
--      `0084_plateforme.test.sql` la prouve fonction par fonction.
--   4. L'admission révisée : `ouvrir_session_sso` admet un superadministrateur en base sans appartenance ; les deux
--      fonctions de session serveur reçoivent la liste d'amorçage et amorcent AVANT l'admission.
--
-- LE DRAPEAU EN BASE N'ÉLARGIT AUCUNE POLITIQUE DES DONNÉES MÉTIER (§2) : seules les fonctions de cette migration le
-- lisent. Un superadministrateur en base sans appartenance ne lit ni track, ni affaire, ni coût.
--
-- Ordinaire, idempotente. Aucune donnée existante n'est modifiée. Les anciennes signatures des deux fonctions de session
-- serveur sont retirées, comme `0079` l'a fait : le nouveau paramètre porte un défaut, et un appel à l'ancienne arité se
-- résout sur la nouvelle fonction, au comportement inchangé.

-- =============================================================================================
-- 1. Les deux tables
-- =============================================================================================

create table if not exists public.superadmins (
	sub         uuid        primary key references public.profiles (id) on delete cascade,
	accorde_par uuid        references public.profiles (id) on delete set null,
	accorde_le  timestamptz not null default pg_catalog.now()
);

create table if not exists public.plateforme_journal (
	id           bigint      generated always as identity primary key,
	acteur       uuid        references public.profiles (id) on delete set null,
	geste        text        not null,
	workspace_id uuid,
	cible        jsonb       not null default '{}'::jsonb,
	cree_le      timestamptz not null default pg_catalog.now(),
	constraint plateforme_journal_geste_check check (geste in (
		'superadmin_amorce', 'superadmin_accorde', 'superadmin_retire',
		'espace_cree', 'espace_modifie', 'espace_supprime',
		'membre_pose', 'membre_retire',
		'attente_inscrite', 'attente_retiree',
		'mcp_droits_poses'
	))
);

create index if not exists plateforme_journal_recents on public.plateforme_journal (id desc);

alter table public.superadmins enable row level security;
alter table public.plateforme_journal enable row level security;

revoke all on public.superadmins from public, anon, authenticated;
revoke all on public.plateforme_journal from public, anon, authenticated;
grant all on public.superadmins to service_role;
grant all on public.plateforme_journal to service_role;

comment on table public.superadmins is
	'CRM-101 — docs/SPEC-plateforme.md §5.1. Drapeau superadministrateur en base ; aucune lecture par l''API.';
comment on table public.plateforme_journal is
	'CRM-101 — docs/SPEC-plateforme.md §5.2. Journal des gestes de la plateforme et du connecteur, ajout seul.';

-- =============================================================================================
-- 2. Les fonctions d'appui
-- =============================================================================================

-- Le superadministrateur, pour l'APPELANT : porteur de `lelabs_admin`, ou ligne en base. Relue à chaque appel : un
-- retrait agit à la requête suivante.
create or replace function app.est_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (select app.est_admin_lelabs())
	    or exists (select 1 from public.superadmins s where s.sub = (select auth.uid()));
$$;

-- La même règle pour une personne DÉSIGNÉE, sous la clé de service : le registre du connecteur (`CRM-102`) l'appelle
-- avec le drapeau LeLabs du jeton qu'il a lui-même vérifié.
create or replace function app.est_superadmin_pour(p_sub uuid, p_admin_lelabs boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(p_admin_lelabs, false)
	    or exists (select 1 from public.superadmins s where s.sub = p_sub);
$$;

create or replace function app.exiger_superadmin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not app.est_superadmin() then
		raise exception 'reserve_aux_superadministrateurs' using errcode = '42501';
	end if;
end;
$$;

create or replace function app.journaliser_plateforme(p_geste text, p_ws uuid, p_cible jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
	insert into public.plateforme_journal (acteur, geste, workspace_id, cible)
	values ((select auth.uid()), p_geste, p_ws, coalesce(p_cible, '{}'::jsonb));
$$;

-- L'AMORÇAGE UNIQUE (§3). Le verrou consultatif sérialise deux premières connexions simultanées : la seconde trouve la
-- table non vide. L'appelant — l'échangeur ou le connecteur, sous la clé de service — a déjà vérifié le jeton, l'adresse
-- (`email_verified`) et le rôle `verified` ; la fonction ne les revoit pas, elle ne voit pas le jeton.
create or replace function app.amorcer_superadmin(p_sub uuid, p_email text, p_nom text, p_liste text[])
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	nom     text;
begin
	if p_sub is null or adresse = '' or p_liste is null or pg_catalog.cardinality(p_liste) = 0 then
		return false;
	end if;

	perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('p2enjoy-crm/superadmins'));

	if exists (select 1 from public.superadmins) then
		return false;
	end if;
	if not exists (
		select 1 from pg_catalog.unnest(p_liste) as l (entree)
		 where pg_catalog.lower(pg_catalog.btrim(l.entree)) = adresse
	) then
		return false;
	end if;

	-- Le profil, s'il manque : même chaîne de repli que `ouvrir_session_sso` (docs/SPEC-session-sso.md §6.2, point 3).
	nom := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nom, ''), '[[:space:]]+', ' ', 'g'));
	if nom = '' then
		nom := pg_catalog.split_part(adresse, '@', 1);
	end if;
	nom := pg_catalog.btrim(pg_catalog.left(nom, 120));
	if nom = '' then
		nom := 'Utilisateur ' || pg_catalog.left(p_sub::text, 8);
	end if;
	insert into public.profiles (id, full_name) values (p_sub, nom) on conflict (id) do nothing;

	insert into public.superadmins (sub, accorde_par) values (p_sub, null);
	insert into public.plateforme_journal (acteur, geste, cible)
	values (null, 'superadmin_amorce', pg_catalog.jsonb_build_object('sub', p_sub));
	return true;
end;
$$;

-- Validations de forme, communes aux fonctions de la plateforme. Elles rendent la valeur normalisée ou lèvent le code du
-- dictionnaire (§6.1).
create or replace function app.plateforme_nom(p_nom text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	nom text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nom, ''), '[[:space:]]+', ' ', 'g'));
begin
	if nom = '' or pg_catalog.char_length(nom) > 120 then
		raise exception 'nom_invalide' using errcode = '22023';
	end if;
	return nom;
end;
$$;

create or replace function app.plateforme_domaine(p_domaine text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	domaine text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_domaine, '')));
begin
	if domaine = '' then
		return null;
	end if;
	if pg_catalog.char_length(domaine) > 253
	   or domaine !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
		raise exception 'domaine_invalide' using errcode = '22023';
	end if;
	return domaine;
end;
$$;

create or replace function app.plateforme_role(p_role text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
	if p_role is null or p_role not in ('admin', 'business_developer', 'viewer') then
		raise exception 'role_invalide' using errcode = '22023';
	end if;
	return p_role;
end;
$$;

create or replace function app.plateforme_espace_existe(p_ws uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_ws is null or not exists (select 1 from public.workspaces w where w.id = p_ws) then
		raise exception 'espace_introuvable' using errcode = 'P0002';
	end if;
end;
$$;

-- =============================================================================================
-- 3. Le drapeau, pour l'interface
-- =============================================================================================

-- Aide d'interface, jamais une protection (§5.3) : chaque fonction de la plateforme refait sa garde.
create or replace function public.est_superadmin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select app.est_superadmin();
$$;

-- =============================================================================================
-- 4. Espaces (§6.2)
-- =============================================================================================

create or replace function public.plateforme_espaces()
returns table (
	id uuid, nom text, slug text, domaine_entrant text,
	membres integer, administrateurs integer, attentes integer, cree_le timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select w.id, w.name, w.slug, w.inbound_domain,
	       (select pg_catalog.count(*)::integer from public.workspace_members m where m.workspace_id = w.id),
	       (select pg_catalog.count(*)::integer from public.workspace_members m
	         where m.workspace_id = w.id and m.role = 'admin'),
	       (select pg_catalog.count(*)::integer from public.workspace_invitations i where i.workspace_id = w.id),
	       w.created_at
	  from public.workspaces w
	 order by w.name, w.slug;
end;
$$;

create or replace function public.plateforme_creer_espace(p_nom text, p_slug text, p_domaine_entrant text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	nom     text;
	slug    text := pg_catalog.btrim(coalesce(p_slug, ''));
	domaine text;
	cree    uuid;
begin
	perform app.exiger_superadmin();
	nom := app.plateforme_nom(p_nom);
	if pg_catalog.char_length(slug) not between 2 and 63 or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
		raise exception 'identifiant_invalide' using errcode = '22023';
	end if;
	domaine := app.plateforme_domaine(p_domaine_entrant);

	begin
		insert into public.workspaces (name, slug, inbound_domain, settings)
		values (nom, slug, domaine, '{}'::jsonb)
		returning id into cree;
	exception when unique_violation then
		raise exception 'identifiant_pris' using errcode = '23505';
	end;

	perform app.journaliser_plateforme('espace_cree', cree,
		pg_catalog.jsonb_build_object('nom', nom, 'slug', slug, 'domaine_entrant', domaine));
	return cree;
end;
$$;

-- Le slug ne se modifie pas : il nomme les dossiers IMAP et les adresses d'amorçage (§6.2).
create or replace function public.plateforme_modifier_espace(p_id uuid, p_nom text, p_domaine_entrant text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	nom     text;
	domaine text;
	avant   public.workspaces;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_id);
	nom := app.plateforme_nom(p_nom);
	domaine := app.plateforme_domaine(p_domaine_entrant);

	select * into avant from public.workspaces w where w.id = p_id for update;
	update public.workspaces w set name = nom, inbound_domain = domaine where w.id = p_id;

	perform app.journaliser_plateforme('espace_modifie', p_id, pg_catalog.jsonb_build_object(
		'avant', pg_catalog.jsonb_build_object('nom', avant.name, 'domaine_entrant', avant.inbound_domain),
		'apres', pg_catalog.jsonb_build_object('nom', nom, 'domaine_entrant', domaine)));
end;
$$;

-- IRRÉVERSIBLE : la cascade et l'ajournement des contraintes viennent de `0085` (décision 619). La saisie du slug est
-- revérifiée ici, l'écran ne faisant qu'aider.
create or replace function public.plateforme_supprimer_espace(p_id uuid, p_slug_confirme text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	espace  public.workspaces;
	trace   jsonb;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_id);
	select * into espace from public.workspaces w where w.id = p_id for update;
	if coalesce(p_slug_confirme, '') is distinct from espace.slug then
		raise exception 'confirmation_incorrecte' using errcode = '22023';
	end if;

	trace := pg_catalog.jsonb_build_object(
		'nom', espace.name,
		'slug', espace.slug,
		'membres', (select pg_catalog.count(*) from public.workspace_members m where m.workspace_id = p_id),
		'tracks', (select pg_catalog.count(*) from public.tracks t where t.workspace_id = p_id),
		'affaires', (select pg_catalog.count(*) from public.cards c where c.workspace_id = p_id));

	delete from public.workspaces w where w.id = p_id;
	perform app.journaliser_plateforme('espace_supprime', p_id, trace);
end;
$$;

-- =============================================================================================
-- 5. Appartenances (§6.3)
-- =============================================================================================

create or replace function public.plateforme_membres(p_ws uuid)
returns table (user_id uuid, nom text, role text, superadmin boolean, depuis timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	return query
	select m.user_id, p.full_name, m.role,
	       exists (select 1 from public.superadmins s where s.sub = m.user_id),
	       m.created_at
	  from public.workspace_members m
	  join public.profiles p on p.id = m.user_id
	 where m.workspace_id = p_ws
	 order by (m.role = 'admin') desc, p.full_name, m.user_id;
end;
$$;

-- L'invariant du dernier administrateur (`0021`) n'est pas recopié : il lève `last_workspace_admin`, et le refus remonte
-- tel quel (§6.1).
create or replace function public.plateforme_poser_membre(p_ws uuid, p_user uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	role_voulu  text;
	role_avant  text;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	role_voulu := app.plateforme_role(p_role);
	if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;

	select m.role into role_avant
	  from public.workspace_members m
	 where m.workspace_id = p_ws and m.user_id = p_user
	   for update;

	if role_avant is null then
		insert into public.workspace_members (workspace_id, user_id, role) values (p_ws, p_user, role_voulu);
	elsif role_avant is distinct from role_voulu then
		update public.workspace_members m set role = role_voulu
		 where m.workspace_id = p_ws and m.user_id = p_user;
	else
		return;
	end if;

	perform app.journaliser_plateforme('membre_pose', p_ws, pg_catalog.jsonb_build_object(
		'user_id', p_user, 'avant', role_avant, 'apres', role_voulu));
end;
$$;

-- Les droits fins de la personne DANS CET ESPACE partent avec l'appartenance : sans rôle d'espace ils n'ouvrent rien
-- (`app.resolve_access`), mais ils se réactiveraient en silence à un retour de la personne. Mesuré : `track_members` et
-- `channel_members` ne portent pas `workspace_id` (INC-011) ; on remonte par `tracks` et `channels`.
create or replace function public.plateforme_retirer_membre(p_ws uuid, p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	role_avant text;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);

	delete from public.workspace_members m
	 where m.workspace_id = p_ws and m.user_id = p_user
	returning m.role into role_avant;
	if role_avant is null then
		return;
	end if;

	delete from public.track_members tm
	 using public.tracks t
	 where tm.track_id = t.id and t.workspace_id = p_ws and tm.user_id = p_user;
	delete from public.channel_members cm
	 using public.channels c
	 where cm.channel_id = c.id and c.workspace_id = p_ws and cm.user_id = p_user;

	perform app.journaliser_plateforme('membre_retire', p_ws, pg_catalog.jsonb_build_object(
		'user_id', p_user, 'role', role_avant));
end;
$$;

-- =============================================================================================
-- 6. Attentes (§6.4)
-- =============================================================================================

create or replace function public.plateforme_attentes(p_ws uuid)
returns table (email text, role text, invite_par text, depuis timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	return query
	select i.email, i.role, p.full_name, i.created_at
	  from public.workspace_invitations i
	  left join public.profiles p on p.id = i.invited_by
	 where i.workspace_id = p_ws
	 order by i.email;
end;
$$;

-- Une attente existante pour la même adresse est REMPLACÉE, en une transaction : changer le rôle d'une attente, c'est la
-- retirer puis la réinscrire (docs/SPEC-session-sso.md §7.2). La règle de forme de l'adresse est celle de la table :
-- une adresse refusée par ses contraintes devient `adresse_invalide`.
create or replace function public.plateforme_inviter(p_ws uuid, p_email text, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	role_voulu text;
	role_avant text;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	role_voulu := app.plateforme_role(p_role);

	delete from public.workspace_invitations i
	 where i.workspace_id = p_ws and i.email = adresse
	returning i.role into role_avant;

	begin
		insert into public.workspace_invitations (workspace_id, email, role, invited_by)
		values (p_ws, adresse, role_voulu, (select auth.uid()));
	exception when check_violation or not_null_violation then
		raise exception 'adresse_invalide' using errcode = '22023';
	end;

	perform app.journaliser_plateforme('attente_inscrite', p_ws, pg_catalog.jsonb_build_object(
		'email', adresse, 'avant', role_avant, 'apres', role_voulu));
end;
$$;

create or replace function public.plateforme_retirer_attente(p_ws uuid, p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	role_avant text;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);

	delete from public.workspace_invitations i
	 where i.workspace_id = p_ws and i.email = adresse
	returning i.role into role_avant;
	if role_avant is null then
		return;
	end if;

	perform app.journaliser_plateforme('attente_retiree', p_ws, pg_catalog.jsonb_build_object(
		'email', adresse, 'role', role_avant));
end;
$$;

-- =============================================================================================
-- 7. Personnes, superadministrateurs, journal (§6.5)
-- =============================================================================================

create or replace function public.plateforme_profils(p_recherche text default null, p_limite integer default 50)
returns table (id uuid, nom text, espaces integer, superadmin boolean, cree_le timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	motif  text := pg_catalog.btrim(coalesce(p_recherche, ''));
	limite integer := least(greatest(coalesce(p_limite, 50), 1), 200);
begin
	perform app.exiger_superadmin();
	return query
	select p.id, p.full_name,
	       (select pg_catalog.count(*)::integer from public.workspace_members m where m.user_id = p.id),
	       exists (select 1 from public.superadmins s where s.sub = p.id),
	       p.created_at
	  from public.profiles p
	 -- `unaccent` à deux arguments, dictionnaire qualifié : sous `search_path` vide, la forme à un argument ne trouve
	 -- pas son dictionnaire. Les métacaractères de `ilike` saisis sont échappés : la recherche est littérale.
	 where motif = ''
	    or extensions.unaccent('extensions.unaccent'::regdictionary, p.full_name) ilike
	       '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
	                 extensions.unaccent('extensions.unaccent'::regdictionary, motif),
	                 '\', '\\'), '%', '\%'), '_', '\_') || '%'
	 order by p.full_name, p.id
	 limit limite;
end;
$$;

create or replace function public.plateforme_superadmins()
returns table (sub uuid, nom text, accorde_par_nom text, accorde_le timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select s.sub, p.full_name, a.full_name, s.accorde_le
	  from public.superadmins s
	  join public.profiles p on p.id = s.sub
	  left join public.profiles a on a.id = s.accorde_par
	 order by p.full_name, s.sub;
end;
$$;

-- La DERNIÈRE ligne ne se retire pas, même par un porteur d'`admin` LeLabs : la plateforme garde toujours un
-- superadministrateur en base, indépendant du SSO (§6.5). Le verrou de l'amorçage sérialise aussi deux retraits
-- concurrents, qui sans lui pourraient chacun croire qu'il en reste un.
create or replace function public.plateforme_poser_superadmin(p_user uuid, p_actif boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;
	perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('p2enjoy-crm/superadmins'));

	if coalesce(p_actif, false) then
		insert into public.superadmins (sub, accorde_par) values (p_user, (select auth.uid()))
		on conflict (sub) do nothing;
		if found then
			perform app.journaliser_plateforme('superadmin_accorde', null,
				pg_catalog.jsonb_build_object('sub', p_user));
		end if;
	else
		if not exists (select 1 from public.superadmins s where s.sub = p_user) then
			return;
		end if;
		if (select pg_catalog.count(*) from public.superadmins) <= 1 then
			raise exception 'dernier_superadministrateur' using errcode = 'P0001';
		end if;
		delete from public.superadmins s where s.sub = p_user;
		perform app.journaliser_plateforme('superadmin_retire', null, pg_catalog.jsonb_build_object('sub', p_user));
	end if;
end;
$$;

create or replace function public.plateforme_journal_liste(p_avant bigint default null, p_limite integer default 50)
returns table (id bigint, acteur_nom text, geste text, workspace_id uuid, cible jsonb, cree_le timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	limite integer := least(greatest(coalesce(p_limite, 50), 1), 200);
begin
	perform app.exiger_superadmin();
	return query
	select j.id, p.full_name, j.geste, j.workspace_id, j.cible, j.cree_le
	  from public.plateforme_journal j
	  left join public.profiles p on p.id = j.acteur
	 where p_avant is null or j.id < p_avant
	 order by j.id desc
	 limit limite;
end;
$$;

-- =============================================================================================
-- 8. L'admission révisée (§4)
-- =============================================================================================

drop function if exists public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean);
drop function if exists public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean);

-- Le corps est celui de `0079`, à une différence près, et c'est le §4 : un superadministrateur en base est ADMIS sans
-- appartenance ni attente. Il a déjà un profil (clé étrangère de `superadmins`) : rien d'autre ne change.
create or replace function public.ouvrir_session_sso(
	p_sub uuid, p_email text, p_nom text, p_admin_lelabs boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse         text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	porteur_admin   boolean := coalesce(p_admin_lelabs, false);
	superadmin_base boolean;
	nom             text;
	espaces_lies    uuid[];
	roles_lies      text[];
	rattachees      integer;
	espaces         integer;
	suspendues      integer;
	nom_profil      text;
begin
	if p_sub is null then
		raise exception 'sub_requis' using errcode = '22023';
	end if;
	if adresse !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
		raise exception 'adresse_invalide' using errcode = '22023';
	end if;

	-- 1. Consommer les attentes, sauf celles en suspens faute d'administrateur (décision 593).
	with consommees as (
		delete from public.workspace_invitations i
		 where i.email = adresse
		   and (
		        i.role = 'admin'
		     or exists (select 1 from public.workspace_members m
		                 where m.workspace_id = i.workspace_id and m.role = 'admin')
		     or exists (select 1 from public.workspace_members m
		                 where m.workspace_id = i.workspace_id and m.user_id = p_sub)
		   )
		returning i.workspace_id, i.role
	)
	select coalesce(pg_catalog.array_agg(c.workspace_id order by c.workspace_id), '{}'),
	       coalesce(pg_catalog.array_agg(c.role order by c.workspace_id), '{}')
	  into espaces_lies, roles_lies
	  from consommees c;
	rattachees := pg_catalog.cardinality(espaces_lies);

	select pg_catalog.count(*)::integer
	  into suspendues
	  from public.workspace_invitations i
	 where i.email = adresse;

	-- 2. Le profil : pour une personne rattachée, ET pour le porteur d'`admin` (§6.1 bis, point 3).
	if rattachees > 0 or porteur_admin then
		nom := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nom, ''), '[[:space:]]+', ' ', 'g'));
		if nom = '' then
			nom := pg_catalog.split_part(adresse, '@', 1);
		end if;
		nom := pg_catalog.btrim(pg_catalog.left(nom, 120));
		if nom = '' then
			nom := 'Utilisateur ' || pg_catalog.left(p_sub::text, 8);
		end if;

		insert into public.profiles (id, full_name)
		values (p_sub, nom)
		on conflict (id) do nothing;
	end if;

	-- 3. Une appartenance par attente consommée ; une appartenance existante garde son rôle.
	if rattachees > 0 then
		insert into public.workspace_members (workspace_id, user_id, role)
		select lie.workspace_id, p_sub, lie.role
		  from rows from (pg_catalog.unnest(espaces_lies), pg_catalog.unnest(roles_lies))
		       as lie (workspace_id, role)
		on conflict (workspace_id, user_id) do nothing;
	end if;

	-- 4. Le superadministrateur en base (docs/SPEC-plateforme.md §4) : lu APRÈS l'éventuel amorçage, que l'appelant a
	--    fait dans la même transaction.
	superadmin_base := exists (select 1 from public.superadmins s where s.sub = p_sub);

	if porteur_admin then
		select pg_catalog.count(*)::integer into espaces from public.workspaces w;
	else
		select pg_catalog.count(*)::integer
		  into espaces
		  from public.workspace_members m
		 where m.user_id = p_sub;
	end if;

	select p.full_name into nom_profil from public.profiles p where p.id = p_sub;

	return pg_catalog.jsonb_build_object(
		'admis', porteur_admin or superadmin_base or espaces > 0,
		'espaces', espaces,
		'rattachees', rattachees,
		'en_suspens', suspendues,
		'nom', nom_profil
	);
end;
$$;

-- Les deux fonctions de session serveur de `0079`, avec la liste d'amorçage, qu'elles appliquent AVANT l'admission.
create or replace function public.ouvrir_session_serveur(
	p_sub uuid, p_email text, p_nom text,
	p_empreinte bytea, p_rafraichissement text, p_expire_le timestamptz,
	p_admin_lelabs boolean default false,
	p_superadmins_initiaux text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	perform app.amorcer_superadmin(p_sub, p_email, p_nom, p_superadmins_initiaux);
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
		values (p_sub, p_empreinte, p_rafraichissement, p_expire_le);
	end if;
	return admission;
end;
$$;

create or replace function public.renouveler_session_serveur(
	p_empreinte bytea, p_sub uuid, p_email text, p_nom text,
	p_rafraichissement text, p_expire_le timestamptz,
	p_admin_lelabs boolean default false,
	p_superadmins_initiaux text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	if not exists (
		select 1 from public.sessions_sso s
		 where s.poignee_empreinte = p_empreinte and s.sub = p_sub
	) then
		return pg_catalog.jsonb_build_object('admis', false, 'session', false);
	end if;

	perform app.amorcer_superadmin(p_sub, p_email, p_nom, p_superadmins_initiaux);
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		update public.sessions_sso s
		   set rafraichissement = p_rafraichissement,
		       expire_le = p_expire_le,
		       renouvele_le = pg_catalog.now()
		 where s.poignee_empreinte = p_empreinte;
	else
		delete from public.sessions_sso s where s.poignee_empreinte = p_empreinte;
	end if;
	return admission || pg_catalog.jsonb_build_object('session', true);
end;
$$;

-- =============================================================================================
-- 9. Propriétaires et privilèges
-- =============================================================================================
-- Dans le schéma `public`, les privilèges par défaut de l'image accordent NOMMÉMENT l'exécution de toute fonction
-- nouvelle à `anon`, `authenticated` et `service_role` (docs/SCHEMA.md §9) : chaque fonction est fermée en les nommant,
-- puis rouverte au strict nécessaire. Le schéma `app` n'a aucun privilège par défaut.

do $$
declare
	f text;
begin
	foreach f in array array[
		'app.est_superadmin()',
		'app.est_superadmin_pour(uuid, boolean)',
		'app.exiger_superadmin()',
		'app.journaliser_plateforme(text, uuid, jsonb)',
		'app.amorcer_superadmin(uuid, text, text, text[])',
		'app.plateforme_nom(text)',
		'app.plateforme_domaine(text)',
		'app.plateforme_role(text)',
		'app.plateforme_espace_existe(uuid)',
		'public.est_superadmin()',
		'public.plateforme_espaces()',
		'public.plateforme_creer_espace(text, text, text)',
		'public.plateforme_modifier_espace(uuid, text, text)',
		'public.plateforme_supprimer_espace(uuid, text)',
		'public.plateforme_membres(uuid)',
		'public.plateforme_poser_membre(uuid, uuid, text)',
		'public.plateforme_retirer_membre(uuid, uuid)',
		'public.plateforme_attentes(uuid)',
		'public.plateforme_inviter(uuid, text, text)',
		'public.plateforme_retirer_attente(uuid, text)',
		'public.plateforme_profils(text, integer)',
		'public.plateforme_superadmins()',
		'public.plateforme_poser_superadmin(uuid, boolean)',
		'public.plateforme_journal_liste(bigint, integer)',
		'public.ouvrir_session_sso(uuid, text, text, boolean)',
		'public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean, text[])',
		'public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean, text[])'
	] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f);
	end loop;
end;
$$;

-- `app.est_superadmin` est lue par la garde, sous le rôle de l'appelant ; `est_superadmin_pour`, par le registre du
-- connecteur sous la clé de service.
grant execute on function app.est_superadmin() to authenticated, service_role;
grant execute on function app.est_superadmin_pour(uuid, boolean) to service_role;

grant execute on function public.est_superadmin() to authenticated;
grant execute on function public.plateforme_espaces() to authenticated;
grant execute on function public.plateforme_creer_espace(text, text, text) to authenticated;
grant execute on function public.plateforme_modifier_espace(uuid, text, text) to authenticated;
grant execute on function public.plateforme_supprimer_espace(uuid, text) to authenticated;
grant execute on function public.plateforme_membres(uuid) to authenticated;
grant execute on function public.plateforme_poser_membre(uuid, uuid, text) to authenticated;
grant execute on function public.plateforme_retirer_membre(uuid, uuid) to authenticated;
grant execute on function public.plateforme_attentes(uuid) to authenticated;
grant execute on function public.plateforme_inviter(uuid, text, text) to authenticated;
grant execute on function public.plateforme_retirer_attente(uuid, text) to authenticated;
grant execute on function public.plateforme_profils(text, integer) to authenticated;
grant execute on function public.plateforme_superadmins() to authenticated;
grant execute on function public.plateforme_poser_superadmin(uuid, boolean) to authenticated;
grant execute on function public.plateforme_journal_liste(bigint, integer) to authenticated;

grant execute on function public.ouvrir_session_sso(uuid, text, text, boolean) to service_role;
grant execute on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean, text[])
	to service_role;
grant execute on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean, text[])
	to service_role;

comment on function app.est_superadmin() is
	'CRM-101 — docs/SPEC-plateforme.md §2, §5.3. Porteur de lelabs_admin, ou ligne de public.superadmins pour l''appelant.';
comment on function app.amorcer_superadmin(uuid, text, text, text[]) is
	'CRM-101 — docs/SPEC-plateforme.md §3. Amorçage unique, sous verrou consultatif, tant que superadmins est vide.';
comment on function public.est_superadmin() is
	'CRM-101 — docs/SPEC-plateforme.md §5.3. Aide d''interface ; chaque fonction de la plateforme refait sa garde.';
comment on function public.ouvrir_session_sso(uuid, text, text, boolean) is
	'CRM-092, CRM-101 — docs/SPEC-session-sso.md §6.2, §6.1 bis ; docs/SPEC-plateforme.md §4. Admission ; le porteur d''admin et le superadministrateur en base sont admis d''office.';
comment on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean, text[]) is
	'CRM-092, CRM-101 — docs/SPEC-session-sso.md §7.4 ; docs/SPEC-plateforme.md §3, §4. Amorçage, admission, puis session serveur.';
comment on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean, text[]) is
	'CRM-092, CRM-101 — docs/SPEC-session-sso.md §7.4 ; docs/SPEC-plateforme.md §3, §4. Amorçage, admission rejouée ; sinon session supprimée.';

-- @spec CRM-053 (docs/BACKLOG.md) — identités sortantes SMTP
-- @spec docs/SPEC-mail-subsystem.md §2.2 (identité sortante), §2.3 (secrets et Vault),
--       §14.2 (modèle), §14.3 (qui lit quoi), §14.4 (test de connexion), §13.7 (les six codes)
-- @spec docs/SCHEMA.md §12 (`mail_outbound_identities`)
-- @spec docs/SPEC-permissions-rls.md §7 (secondes moitiés des refus n° 6 et n° 7)
-- @spec docs/JOURNAL.md décision 318 ; décision 316 (le modèle dont celle-ci hérite)
--
-- CETTE MIGRATION EST LA JUMELLE DE LA 22, ET C'EST DÉLIBÉRÉ.
--
-- Mêmes politiques, mêmes privilèges de colonne, même chemin d'écriture unique vers Vault, même
-- catalogue de codes d'erreur. Inventer un second vocabulaire pour les mêmes causes obligerait
-- l'exploitant à en apprendre deux (décision 318).
--
-- Ce qui lui est PROPRE : l'adresse d'expédition, qui n'a aucune raison de correspondre au compte
-- entrant — c'est le cas d'usage du §2.2 —, la signature, le quota, et surtout **l'identité par
-- défaut**, dont l'unicité est tenue par un index partiel ET rabattue par un trigger.

-- =============================================================================================
-- 1. La table
-- =============================================================================================

create table if not exists public.mail_outbound_identities (
	id              uuid primary key default gen_random_uuid(),
	workspace_id    uuid not null references public.workspaces (id) on delete cascade,
	-- `null` = identité de SERVICE du workspace (§2.2).
	owner_id        uuid references public.profiles (id) on delete cascade,
	label           text not null,
	smtp_host       text not null,
	smtp_port       integer not null,
	smtp_security   text not null default 'starttls',
	smtp_username   text not null,
	secret_id       uuid,
	-- L'ADRESSE RÉELLEMENT AFFICHÉE, et rien ne la lie au compte entrant : « un utilisateur peut
	-- recevoir sur une boîte et répondre depuis une adresse hébergée ailleurs » (§2.2). Le seed
	-- le démontre au lieu de le décrire.
	from_address    text not null,
	from_name       text,
	signature_html  text,
	is_default      boolean not null default false,
	-- CRÉÉE SANS CONSOMMATEUR, et le dire vaut mieux que de laisser croire qu'un quota est
	-- appliqué : l'envoi appartient à `CRM-058` (§14.1).
	daily_quota     integer not null default 0,
	status          text not null default 'pending',
	last_error      text,
	last_checked_at timestamptz,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now()
);

-- Voir la section 1 bis de la migration 22 : une contrainte écrite dans le corps d'un
-- `create table if not exists` n'est posée que sur une base neuve.
create or replace function app.migration_0023_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_catalog.pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname  = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_label_borne',
	'CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 120)))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_host_borne',
	'CHECK (((char_length(btrim(smtp_host)) >= 1) AND (char_length(btrim(smtp_host)) <= 253)))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_port_borne',
	'CHECK (((smtp_port >= 1) AND (smtp_port <= 65535)))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_securite',
	'CHECK ((smtp_security = ANY (ARRAY[''ssl''::text, ''starttls''::text, ''none''::text])))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_username_borne',
	'CHECK (((char_length(btrim(smtp_username)) >= 1) AND (char_length(btrim(smtp_username)) <= 320)))');

-- L'adresse d'expédition est la seule donnée de cette table que le DESTINATAIRE verra. Une borne
-- laxiste y ferait passer une chaîne qui n'est pas une adresse, et le refus viendrait alors du
-- serveur distant, à l'envoi, pour un compte déclaré « ok ».
select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_from_address',
	'CHECK (((char_length(btrim(from_address)) >= 3) AND (char_length(btrim(from_address)) <= 320) '
	'AND (btrim(from_address) ~ ''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$''::text)))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_statut',
	'CHECK ((status = ANY (ARRAY[''pending''::text, ''ok''::text, ''error''::text, ''disabled''::text])))');

-- LE MÊME catalogue de codes qu'au §13.7 : une panne réseau est une panne réseau, qu'elle
-- survienne en IMAP ou en SMTP (décision 318).
select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_erreur_code',
	'CHECK (((last_error IS NULL) OR (last_error = ANY (ARRAY[''auth_failed''::text, '
	'''host_unreachable''::text, ''connection_refused''::text, ''tls_failed''::text, '
	'''timeout''::text, ''protocol_error''::text]))))');

select app.migration_0023_converger_contrainte(
	'public.mail_outbound_identities', 'mail_outbound_identities_quota_borne',
	'CHECK (((daily_quota >= 0) AND (daily_quota <= 100000)))');

comment on table public.mail_outbound_identities is
	'Identités SMTP employées par mail-sync pour expédier. owner_id nul = identité de service. '
	'from_address n''a aucune raison de correspondre au compte entrant (docs/SPEC-mail-subsystem.md '
	'§2.2). Le mot de passe vit dans Vault ; écriture par upsert_mail_outbound_identity seulement.';

comment on column public.mail_outbound_identities.daily_quota is
	'CRM-053 : créée SANS CONSOMMATEUR. L''envoi et son décompte appartiennent à CRM-058 ; aucun '
	'quota n''est appliqué aujourd''hui, et le dire vaut mieux que de laisser croire l''inverse.';

-- Une identité par défaut par personne, et une pour le service. L'index REFUSE le second défaut ;
-- le trigger ci-dessous fait en sorte que ce refus ne survienne jamais, en rabattant l'ancien.
create unique index if not exists mail_outbound_identities_defaut_personne
	on public.mail_outbound_identities (workspace_id, owner_id)
	where is_default and owner_id is not null;

create unique index if not exists mail_outbound_identities_defaut_service
	on public.mail_outbound_identities (workspace_id)
	where is_default and owner_id is null;

create index if not exists mail_outbound_identities_workspace_idx
	on public.mail_outbound_identities (workspace_id);

drop trigger if exists mail_outbound_identities_updated_at on public.mail_outbound_identities;
create trigger mail_outbound_identities_updated_at
	before update on public.mail_outbound_identities
	for each row execute function app.set_updated_at();

-- LE DÉFAUT SE DÉPLACE, IL NE SE DISPUTE PAS. Choisir une nouvelle identité par défaut est un
-- geste ordinaire ; obliger l'utilisateur à décocher l'ancienne d'abord ferait porter à l'écran
-- une mécanique que la base sait tenir, et l'exposerait à un état intermédiaire sans défaut.
--
-- LE TRIGGER EST `BEFORE`, ET C'EST MESURÉ : écrit `AFTER`, l'index unique partiel refusait la
-- seconde identité **avant** que le rabattement n'ait lieu — `duplicate key value violates unique
-- constraint`. Un invariant tenu par un index et rétabli par un trigger n'a de sens que si le
-- second parle en premier. Défaut trouvé en exerçant, pas à la lecture.
create or replace function app.mail_outbound_identities_rabattre_defaut()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.is_default then
		update public.mail_outbound_identities autres
		   set is_default = false
		 where autres.workspace_id = new.workspace_id
		   and autres.owner_id is not distinct from new.owner_id
		   and autres.id <> new.id
		   and autres.is_default;
	end if;
	return new;
end;
$$;

comment on function app.mail_outbound_identities_rabattre_defaut() is
	'CRM-053 : une seule identité par défaut par personne. Le trigger RABAT les autres au lieu de '
	'refuser — docs/SPEC-mail-subsystem.md §14.2.';

drop trigger if exists mail_outbound_identities_defaut on public.mail_outbound_identities;
create trigger mail_outbound_identities_defaut
	before insert or update of is_default on public.mail_outbound_identities
	for each row execute function app.mail_outbound_identities_rabattre_defaut();

-- Même règle qu'au §13.2 : une identité personnelle appartient à un membre du workspace.
create or replace function app.mail_outbound_identities_verifier_proprietaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.owner_id is not null and not exists (
		select 1
		  from public.workspace_members wm
		 where wm.workspace_id = new.workspace_id
		   and wm.user_id = new.owner_id
	) then
		raise exception 'owner_not_member' using errcode = '23514';
	end if;
	return new;
end;
$$;

drop trigger if exists mail_outbound_identities_proprietaire on public.mail_outbound_identities;
create trigger mail_outbound_identities_proprietaire
	before insert or update of workspace_id, owner_id on public.mail_outbound_identities
	for each row execute function app.mail_outbound_identities_verifier_proprietaire();

-- =============================================================================================
-- 2. Row Level Security — la règle du §13.4, mot pour mot
-- =============================================================================================

alter table public.mail_outbound_identities enable row level security;

drop policy if exists mail_outbound_identities_lecture_admin on public.mail_outbound_identities;
create policy mail_outbound_identities_lecture_admin
	on public.mail_outbound_identities
	for select
	to authenticated
	using (app.is_workspace_admin(workspace_id));

drop policy if exists mail_outbound_identities_lecture_proprietaire on public.mail_outbound_identities;
create policy mail_outbound_identities_lecture_proprietaire
	on public.mail_outbound_identities
	for select
	to authenticated
	using (owner_id = (select auth.uid()));

-- =============================================================================================
-- 3. Le chemin d'écriture, et il est unique
-- =============================================================================================

create or replace function public.upsert_mail_outbound_identity(
	p_workspace_id   uuid,
	p_label          text,
	p_smtp_host      text,
	p_smtp_port      integer,
	p_smtp_security  text,
	p_smtp_username  text,
	p_from_address   text,
	p_password       text default null,
	p_owner_id       uuid default null,
	p_from_name      text default null,
	p_signature_html text default null,
	p_is_default     boolean default true,
	p_daily_quota    integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant   uuid := (select auth.uid());
	v_est_admin  boolean;
	v_existant   public.mail_outbound_identities%rowtype;
	v_secret_id  uuid;
	v_nom_secret text;
	v_id         uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	v_est_admin := app.is_workspace_admin(p_workspace_id);

	if p_owner_id is null then
		if not v_est_admin then
			raise exception 'forbidden' using errcode = '42501';
		end if;
	elsif not v_est_admin and p_owner_id <> v_appelant then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- L'identité est retrouvée par son ADRESSE D'EXPÉDITION, et non par son seul propriétaire :
	-- rien n'interdit d'en déclarer plusieurs, contrairement aux comptes entrants dont une seule
	-- boîte par personne peut être lue (§14.2).
	select * into v_existant
	  from public.mail_outbound_identities i
	 where i.workspace_id = p_workspace_id
	   and i.owner_id is not distinct from p_owner_id
	   and i.from_address = btrim(p_from_address);

	-- Même reprise du secret orphelin qu'à la migration 22 : `vault.secrets.name` est unique, et
	-- une identité supprimée laisserait sinon un secret qui bloque toute recréation.
	if p_password is not null and btrim(p_password) <> '' then
		v_nom_secret := 'mail_outbound:' || p_workspace_id::text || ':'
		                || coalesce(p_owner_id::text, 'service') || ':' || btrim(p_from_address);
		v_secret_id := v_existant.secret_id;

		if v_secret_id is null then
			select s.id into v_secret_id from vault.secrets s where s.name = v_nom_secret;
		end if;

		if v_secret_id is null then
			v_secret_id := vault.create_secret(
				p_password, v_nom_secret,
				'CRM-053 — mot de passe SMTP d''une identité sortante'
			);
		else
			perform vault.update_secret(v_secret_id, p_password);
		end if;
	else
		v_secret_id := v_existant.secret_id;
	end if;

	if v_existant.id is null then
		if v_secret_id is null then
			raise exception 'password_required' using errcode = '23514';
		end if;

		insert into public.mail_outbound_identities (
			workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security, smtp_username,
			secret_id, from_address, from_name, signature_html, is_default, daily_quota
		)
		values (
			p_workspace_id, p_owner_id, btrim(p_label), btrim(p_smtp_host), p_smtp_port,
			p_smtp_security, btrim(p_smtp_username), v_secret_id, btrim(p_from_address),
			p_from_name, p_signature_html, coalesce(p_is_default, true), coalesce(p_daily_quota, 0)
		)
		returning id into v_id;
	else
		update public.mail_outbound_identities i
		   set label          = btrim(p_label),
		       smtp_host      = btrim(p_smtp_host),
		       smtp_port      = p_smtp_port,
		       smtp_security  = p_smtp_security,
		       smtp_username  = btrim(p_smtp_username),
		       secret_id      = v_secret_id,
		       from_name      = coalesce(p_from_name, i.from_name),
		       signature_html = coalesce(p_signature_html, i.signature_html),
		       is_default     = coalesce(p_is_default, i.is_default),
		       daily_quota    = coalesce(p_daily_quota, i.daily_quota),
		       -- Toute modification de la connexion REMET l'état à `pending` : un `ok` obtenu
		       -- avec l'ancien hôte ne dit rien du nouveau.
		       status         = case
		                          when i.smtp_host <> btrim(p_smtp_host)
		                            or i.smtp_port <> p_smtp_port
		                            or i.smtp_security <> p_smtp_security
		                            or i.smtp_username <> btrim(p_smtp_username)
		                            or (p_password is not null and btrim(p_password) <> '')
		                          then 'pending'
		                          else i.status
		                        end,
		       last_error     = case
		                          when i.smtp_host <> btrim(p_smtp_host)
		                            or i.smtp_port <> p_smtp_port
		                            or i.smtp_security <> p_smtp_security
		                            or i.smtp_username <> btrim(p_smtp_username)
		                            or (p_password is not null and btrim(p_password) <> '')
		                          then null
		                          else i.last_error
		                        end
		 where i.id = v_existant.id
		returning i.id into v_id;
	end if;

	return v_id;
end;
$$;

comment on function public.upsert_mail_outbound_identity is
	'CRM-053 : SEUL chemin d''écriture d''une identité sortante. Vérifie le droit avant de créer '
	'le secret, met le mot de passe dans Vault, ne rend jamais secret_id. §14.2.';

-- =============================================================================================
-- 4. La voie de sortie du secret, et l'écriture du verdict
-- =============================================================================================

create or replace function public.mail_outbound_identity_credentials(p_identity_id uuid)
returns table (
	identity_id   uuid,
	workspace_id  uuid,
	smtp_host     text,
	smtp_port     integer,
	smtp_security text,
	smtp_username text,
	from_address  text,
	password      text
)
language sql
security definer
set search_path = ''
stable
as $$
	select i.id,
	       i.workspace_id,
	       i.smtp_host,
	       i.smtp_port,
	       i.smtp_security,
	       i.smtp_username,
	       i.from_address,
	       s.decrypted_secret
	  from public.mail_outbound_identities i
	  left join vault.decrypted_secrets s on s.id = i.secret_id
	 where i.id = p_identity_id;
$$;

comment on function public.mail_outbound_identity_credentials(uuid) is
	'CRM-053 : unique voie par laquelle un mot de passe SMTP sort de la base. Réservée à '
	'service_role. docs/SPEC-mail-subsystem.md §14.4.';

create or replace function public.mail_outbound_identity_record_check(
	p_identity_id uuid,
	p_status      text,
	p_error       text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_maintenant timestamptz := now();
begin
	update public.mail_outbound_identities i
	   set status          = p_status,
	       last_error      = p_error,
	       last_checked_at = v_maintenant
	 where i.id = p_identity_id;

	if not found then
		raise exception 'identity_not_found' using errcode = 'P0002';
	end if;

	return v_maintenant;
end;
$$;

comment on function public.mail_outbound_identity_record_check is
	'CRM-053 : écrit status, last_error et last_checked_at après un test SMTP réel. Réservée à '
	'service_role — le statut est un constat du serveur.';

-- =============================================================================================
-- 5. Privilèges — `revoke` avant `grant`, comme à la migration 22
-- =============================================================================================

revoke all on public.mail_outbound_identities from anon, authenticated;

-- `secret_id` est ABSENTE de cette liste : seconde moitié de la preuve de refus n° 6.
grant select (
	id, workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security, smtp_username,
	from_address, from_name, signature_html, is_default, daily_quota, status, last_error,
	last_checked_at, created_at, updated_at
) on public.mail_outbound_identities to authenticated;

grant all privileges on public.mail_outbound_identities to service_role;

revoke all on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) from public, anon;
grant execute on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) to authenticated, service_role;

revoke all on function public.mail_outbound_identity_credentials(uuid)
	from public, anon, authenticated;
grant execute on function public.mail_outbound_identity_credentials(uuid) to service_role;

revoke all on function public.mail_outbound_identity_record_check(uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.mail_outbound_identity_record_check(uuid, text, text) to service_role;

-- L'outil de convergence appartient à cette migration, pas au schéma.
drop function if exists app.migration_0023_converger_contrainte(text, text, text);

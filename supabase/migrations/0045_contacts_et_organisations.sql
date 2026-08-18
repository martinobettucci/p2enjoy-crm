-- @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 1 : le modèle
-- @spec docs/SPEC-contacts.md §1 (portée et découpage), §2 (modèle de données),
--       §3 (autorisations), §4 (contrat d'API), §7 (Definition of Done — tranche 1)
-- @spec docs/SCHEMA.md §6 (organizations, contacts, card_contacts)
-- @spec docs/SPEC-permissions-rls.md §4 (tableau des familles de tables, ligne contacts/organizations)
-- @spec docs/SPEC-mail-subsystem.md §16, règle 3 (consommateur futur, tranche 2)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 45)
--
-- Carnet de contacts d'un workspace, avec leurs organisations et leur rattachement aux affaires.
-- Objet métier de première classe (`CLAUDE.md` §4). Débloque à terme la règle 3 du classement de
-- messages (`CRM-055`) et la résolution du champ `contact` (`CRM-036` §6.5).
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : les trois tables, leurs contraintes de forme, leurs unicités partielles, les FK
-- composites qui rendent le cloisonnement `workspace_id` **structurel**, la RLS activée, les
-- politiques nommées par action, les privilèges explicites, et les triggers `updated_at`.
--
-- Non livré, et nommé plutôt que tu :
--   * l'archivage réversible d'un contact — arbitrage §6, point 1 de la spécification ;
--   * la fusion de doublons — même point ;
--   * la purge RGPD — même point ;
--   * le rapprochement automatique email → organisation par domaine — arbitrage §6, point 2 ;
--   * la règle 3 du classement, qui LIT ce modèle : tranche 2, dans une session ultérieure ;
--   * la résolution du champ `contact` dans le formulaire : tranche 3 ;
--   * les écrans : tranche 4.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile. Tout est donc écrit pour être rejouable :
-- `create table if not exists`, `create or replace function`, `drop trigger if exists` avant
-- `create trigger`, `drop policy if exists` avant `create policy`, et les contraintes de valeur
-- posées de façon **convergente** — `drop constraint if exists` puis `add constraint` — pour que
-- la définition du fichier fasse autorité à chaque passage (même patron que `CRM-020`).

-- =============================================================================================
-- 1. `public.organizations`
-- =============================================================================================
-- docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.1.

create table if not exists public.organizations (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	-- `domain` est le PIVOT du rapprochement des emails (`docs/SCHEMA.md` §6). Facultatif — une
	-- organisation peut naître sans domaine connu —, unique par workspace sur `lower(domain)`
	-- pour absorber la casse comme le classement des emails l'exige (docs/SPEC-mail-subsystem.md
	-- §16). L'unicité est POSÉE PLUS BAS via un index partiel, `NULL` étant naturellement non
	-- unique en PostgreSQL — sans quoi deux organisations sans domaine coïncideraient sur `NULL`.
	domain       text,
	-- Site public, facultatif ; forme validée par contrainte pour éviter des chaînes qui ne
	-- ressemblent pas à une URL, mais on ne vérifie ni la joignabilité ni la présence d'un `TLD` :
	-- ce ne sont pas des propriétés du champ, ce sont des états du monde.
	website      text,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- Rend exprimable la FK composite de `contacts` : (organization_id, workspace_id) →
	-- (organizations.id, organizations.workspace_id). Ne change AUCUN comportement, `id` étant
	-- déjà clé primaire.
	unique (id, workspace_id)
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.organizations drop constraint if exists organizations_name_check;
alter table public.organizations add  constraint organizations_name_check
	check (btrim(name) <> '');

-- Domaine de la forme `label(.label)+`, minuscules, chiffres, tirets et points. La forme est
-- contrainte, l'existence est un état du monde.
alter table public.organizations drop constraint if exists organizations_domain_check;
alter table public.organizations add  constraint organizations_domain_check
	check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

-- URL http/https lorsqu'elle est renseignée.
alter table public.organizations drop constraint if exists organizations_website_check;
alter table public.organizations add  constraint organizations_website_check
	check (website is null or website ~* '^https?://[^\s]+$');

comment on table public.organizations is
	'CRM-060 — docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.1. Organisations d''un workspace, '
	'auxquelles des contacts peuvent se rattacher.';
comment on column public.organizations.domain is
	'Pivot du rapprochement des emails (docs/SPEC-mail-subsystem.md §16). Unique par workspace '
	'sur lower(domain), unicité partielle : NULL autorisé plusieurs fois.';

-- Unicité PARTIELLE, insensible à la casse.
drop index if exists organizations_workspace_domain_key;
create unique index organizations_workspace_domain_key
	on public.organizations (workspace_id, lower(domain))
	where domain is not null;

create index if not exists organizations_workspace_idx
	on public.organizations (workspace_id, name);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
	before update on public.organizations
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. `public.contacts`
-- =============================================================================================
-- docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.2.

create table if not exists public.contacts (
	id              uuid        primary key default gen_random_uuid(),
	workspace_id    uuid        not null references public.workspaces (id) on delete cascade,
	-- La FK vers `organizations` est COMPOSITE et porte `workspace_id`. Rattacher un contact à
	-- une organisation d'un AUTRE workspace serait une fuite de cloisonnement ; la clé composite
	-- l'interdit STRUCTURELLEMENT, sans trigger — même patron que `form_field_rules` (CRM-035).
	-- `on delete set null` : supprimer une organisation DÉTACHE ses contacts au lieu de les
	-- emporter (mesure de sûreté contre la perte silencieuse d'enfants imposée par CRM-077).
	organization_id uuid,
	full_name       text        not null,
	-- Email FACULTATIF (§2.2 de la spécification) : un contact peut n'être qu'un nom et un
	-- téléphone. Unicité PARTIELLE par workspace sur `lower(email)`, sans quoi deux contacts sans
	-- email entreraient en collision sur `NULL`.
	email           text,
	phone           text,
	role_title      text,
	source          text        not null default 'manual',
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now(),
	unique (id, workspace_id),
	foreign key (organization_id, workspace_id)
		references public.organizations (id, workspace_id) on delete set null
);

-- --- 2.1 Contraintes de valeur ----------------------------------------------------------------

alter table public.contacts drop constraint if exists contacts_full_name_check;
alter table public.contacts add  constraint contacts_full_name_check
	check (btrim(full_name) <> '');

-- Forme d'email : la validation stricte de RFC 5322 serait un défaut à elle seule. On borne à ce
-- qui ressemble à une adresse et refuse les espaces internes ; l'existence est un état du monde.
alter table public.contacts drop constraint if exists contacts_email_check;
alter table public.contacts add  constraint contacts_email_check
	check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.contacts drop constraint if exists contacts_phone_check;
alter table public.contacts add  constraint contacts_phone_check
	check (phone is null or btrim(phone) <> '');

alter table public.contacts drop constraint if exists contacts_role_title_check;
alter table public.contacts add  constraint contacts_role_title_check
	check (role_title is null or btrim(role_title) <> '');

-- `source` : de quelle voie le contact est-il entré. Liste fermée (§2.2 de la spécification).
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add  constraint contacts_source_check
	check (source in ('manual', 'email', 'import'));

comment on table public.contacts is
	'CRM-060 — docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.2. Personnes avec qui une affaire se '
	'traite. Email et organisation facultatifs ; rôle libre.';
comment on column public.contacts.email is
	'Unique par workspace sur lower(email), unicité partielle : NULL autorisé plusieurs fois.';
comment on column public.contacts.source is
	'Voie d''entrée : manual, email (ingestion), import.';

-- Unicité PARTIELLE, insensible à la casse.
drop index if exists contacts_workspace_email_key;
create unique index contacts_workspace_email_key
	on public.contacts (workspace_id, lower(email))
	where email is not null;

create index if not exists contacts_workspace_full_name_idx
	on public.contacts (workspace_id, full_name);
create index if not exists contacts_organization_idx
	on public.contacts (organization_id)
	where organization_id is not null;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
	before update on public.contacts
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. `public.card_contacts`
-- =============================================================================================
-- docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.3. Association n-n avec un rôle facultatif.
-- Les DEUX FK sont composites et portent `workspace_id`, ce qui interdit STRUCTURELLEMENT toute
-- liaison entre une affaire et un contact de workspaces différents. Aucun trigger de cohérence
-- n'est requis — la mesure a montré que `cards` porte déjà `workspace_id` et une contrainte
-- `unique (id, workspace_id)` (CRM-036), ce que ce fichier réemploie.

create table if not exists public.card_contacts (
	workspace_id uuid        not null,
	card_id      uuid        not null,
	contact_id   uuid        not null,
	-- Rôle LIBRE : `docs/SCHEMA.md` §6 l'illustre par `decideur`, `prescripteur`, `technique`,
	-- « … » — une énumération fermée deviendrait fausse au premier besoin métier. La contrainte
	-- porte sur la forme, pas sur une liste.
	role         text,
	created_at   timestamptz not null default now(),
	primary key (card_id, contact_id),
	foreign key (card_id, workspace_id)
		references public.cards (id, workspace_id) on delete cascade,
	foreign key (contact_id, workspace_id)
		references public.contacts (id, workspace_id) on delete cascade
);

alter table public.card_contacts drop constraint if exists card_contacts_role_check;
alter table public.card_contacts add  constraint card_contacts_role_check
	check (role is null or btrim(role) <> '');

comment on table public.card_contacts is
	'CRM-060 — docs/SCHEMA.md §6, docs/SPEC-contacts.md §2.3. Rattachement n-n d''un contact à '
	'une affaire, avec un rôle facultatif. Cloisonnement workspace_id garanti par les FK '
	'composites.';

create index if not exists card_contacts_contact_idx
	on public.card_contacts (contact_id);
create index if not exists card_contacts_workspace_card_idx
	on public.card_contacts (workspace_id, card_id);

-- =============================================================================================
-- 4. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS activée dès la création : même le temps d'une instruction, aucune de ces tables ne doit
-- être ouverte à quiconque détient la clé anonyme, qui est publique par construction.

alter table public.organizations enable row level security;
alter table public.contacts       enable row level security;
alter table public.card_contacts  enable row level security;

-- --- 4.1 organizations, contacts : lecture par les membres du workspace -----------------------
-- docs/SPEC-permissions-rls.md §4 : « membres du workspace ». Accordée à `anon` ET `authenticated`
-- pour que le refus se manifeste par ZÉRO LIGNE plutôt que par une erreur de privilège (§7,
-- dernier paragraphe).

drop policy if exists organizations_lecture_membre on public.organizations;
create policy organizations_lecture_membre
	on public.organizations
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists contacts_lecture_membre on public.contacts;
create policy contacts_lecture_membre
	on public.contacts
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

-- --- 4.2 organizations, contacts : écriture par business_developer ET admin -------------------
-- docs/SPEC-permissions-rls.md §4 : « business_developer et admin ». À la différence des tracks,
-- channels et workflows réservés à l'admin, un contact est le matériau quotidien d'un commercial
-- (docs/SPEC-permissions-rls.md §2.1). Le prédicat s'exprime par `app.workspace_role`, livrée
-- par CRM-010, qui rend NULL pour un non-membre et refuse alors le prédicat.

drop policy if exists organizations_insertion_bizdev_admin on public.organizations;
create policy organizations_insertion_bizdev_admin
	on public.organizations
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists organizations_maj_bizdev_admin on public.organizations;
create policy organizations_maj_bizdev_admin
	on public.organizations
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('business_developer', 'admin'))
	with check (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists organizations_suppression_bizdev_admin on public.organizations;
create policy organizations_suppression_bizdev_admin
	on public.organizations
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists contacts_insertion_bizdev_admin on public.contacts;
create policy contacts_insertion_bizdev_admin
	on public.contacts
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists contacts_maj_bizdev_admin on public.contacts;
create policy contacts_maj_bizdev_admin
	on public.contacts
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('business_developer', 'admin'))
	with check (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

drop policy if exists contacts_suppression_bizdev_admin on public.contacts;
create policy contacts_suppression_bizdev_admin
	on public.contacts
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('business_developer', 'admin'));

-- --- 4.3 card_contacts : lecture de la card, écriture sur la card -----------------------------
-- docs/SPEC-contacts.md §3 : `app.can_read_card` en lecture (livrée par CRM-036),
-- `app.can_write_card` en écriture (livrée par CRM-036). Le droit d'écriture des contacts n'est
-- PAS exigé en plus pour le rattachement : un business_developer fermé sur un track ne doit pas
-- rattacher un contact à une affaire qu'il ne peut pas écrire. Le cloisonnement du contact
-- lui-même est déjà tenu par la FK composite.

drop policy if exists card_contacts_lecture on public.card_contacts;
create policy card_contacts_lecture
	on public.card_contacts
	for select
	to anon, authenticated
	using (app.can_read_card(card_id));

drop policy if exists card_contacts_insertion on public.card_contacts;
create policy card_contacts_insertion
	on public.card_contacts
	for insert
	to authenticated
	with check (app.can_write_card(card_id));

drop policy if exists card_contacts_maj on public.card_contacts;
create policy card_contacts_maj
	on public.card_contacts
	for update
	to authenticated
	using      (app.can_write_card(card_id))
	with check (app.can_write_card(card_id));

drop policy if exists card_contacts_suppression on public.card_contacts;
create policy card_contacts_suppression
	on public.card_contacts
	for delete
	to authenticated
	using (app.can_write_card(card_id));

-- =============================================================================================
-- 5. Privilèges explicites
-- =============================================================================================
-- Les défauts de l'image Supabase accordent trop (docs/JOURNAL.md, décision 134 sur `CRM-036`).
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas
-- d'un réglage susceptible de changer d'une version à l'autre.

revoke all on public.organizations from anon, authenticated;
grant select                 on public.organizations to anon, authenticated;
grant insert, update, delete on public.organizations to authenticated;
grant all privileges         on public.organizations to service_role;

revoke all on public.contacts from anon, authenticated;
grant select                 on public.contacts to anon, authenticated;
grant insert, update, delete on public.contacts to authenticated;
grant all privileges         on public.contacts to service_role;

revoke all on public.card_contacts from anon, authenticated;
grant select                 on public.card_contacts to anon, authenticated;
grant insert, update, delete on public.card_contacts to authenticated;
grant all privileges         on public.card_contacts to service_role;

-- PostgREST met son schéma en cache : sans ce signal, les tables nouvellement créées ne sont pas
-- visibles de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

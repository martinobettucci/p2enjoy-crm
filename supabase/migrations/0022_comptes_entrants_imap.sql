-- @spec CRM-052 (docs/BACKLOG.md) — comptes entrants IMAP
-- @spec docs/SPEC-mail-subsystem.md §2.1 (nature des comptes), §2.3 (secrets et Vault),
--       §13.2 (modèle), §13.3 (le chemin d'écriture), §13.4 (qui lit quoi), §13.5 (test de
--       connexion), §13.7 (le message d'erreur est un code)
-- @spec docs/SCHEMA.md §12 (`mail_inbound_accounts`)
-- @spec docs/SPEC-permissions-rls.md §4.4 (colonnes protégées), §7 (preuves de refus 6 et 7)
-- @spec docs/JOURNAL.md décision 316 ; décision 23 (Vault retenu, pgcrypto abandonné)
--
-- CE QUE CETTE MIGRATION ÉTABLIT, ET CE QU'ELLE REFUSE D'ÉTABLIR.
--
-- Elle crée la table de configuration des boîtes lues en IMAP, ses politiques de lecture, ses
-- privilèges de colonne, et **les deux seules fonctions par lesquelles un secret entre et sort**.
--
-- Elle n'ouvre AUCUNE écriture directe : ni `insert`, ni `update`, ni `delete` ne sont accordés à
-- `authenticated`. Une table de configuration dont un seul chemin d'écriture est correct — celui
-- qui met le mot de passe dans Vault au lieu de la table — ne doit pas en offrir deux. Le contrôle
-- du droit vit dans la fonction, en base, jamais dans l'interface (CLAUDE.md §10).
--
-- MESURÉ avant d'écrire (décision 316) : `authenticated` est refusé **dès le schéma `vault`** —
-- `permission denied for schema vault` —, et `service_role` est le seul rôle applicatif à porter
-- `usage` sur ce schéma et `select` sur `vault.decrypted_secrets`. Aucune politique de table
-- n'avait donc à protéger l'écriture d'un secret : elle est déjà impossible. Ce qui restait à
-- protéger est la **référence**, et c'est un privilège de colonne.

-- =============================================================================================
-- 1. La table
-- =============================================================================================

create table if not exists public.mail_inbound_accounts (
	id              uuid primary key default gen_random_uuid(),
	workspace_id    uuid not null references public.workspaces (id) on delete cascade,
	-- `null` = boîte système du workspace, le catch-all du domaine des cards (§2.1).
	-- `on delete cascade` : la boîte personnelle d'un compte supprimé n'a plus de lecteur, et la
	-- conserver laisserait une configuration orpheline que personne ne peut ni voir ni corriger.
	owner_id        uuid references public.profiles (id) on delete cascade,
	label           text not null,
	imap_host       text not null,
	imap_port       integer not null,
	imap_security   text not null default 'starttls',
	imap_username   text not null,
	-- Référence Vault. JAMAIS lisible par `authenticated` : privilège de colonne révoqué au §4.
	secret_id       uuid,
	watch_folders   text[] not null default array['INBOX']::text[],
	folder_style    text not null default 'folder',
	-- Les quatre colonnes que `CRM-054` et `CRM-056` rempliront. Elles sont créées ici parce que
	-- `docs/SCHEMA.md` §12 les déclare sur cette table ; les omettre obligerait ces unités à
	-- migrer la table qu'elles lisent (§13.1).
	sync_state      jsonb not null default '{}'::jsonb,
	backfill_months integer not null default 0,
	status          text not null default 'pending',
	last_error      text,
	-- « Quand la connexion a-t-elle été éprouvée » n'est PAS « quand ai-je lu des messages ».
	-- Confondre les deux ferait afficher une synchronisation qui n'a pas eu lieu (§13.2).
	last_checked_at timestamptz,
	last_sync_at    timestamptz,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now()
);

-- =============================================================================================
-- 1 bis. Les contraintes, posées par CONVERGENCE et non par la seule création
-- =============================================================================================
--
-- `create table if not exists` ne corrige jamais une table déjà créée : une contrainte écrite
-- dans le corps de la création ne serait posée que sur une base neuve, et un rejeu laisserait
-- intacte une définition périmée. Le convergeur compare la définition réelle à celle attendue et
-- ne remplace que si elles diffèrent.
--
-- Il est **local à cette migration**, comme celui de la migration 15 l'était à la sienne : cette
-- dernière retire le sien à la fin, précisément pour qu'aucune migration ultérieure ne dépende
-- d'un outil qu'elle n'a pas posé. Reprendre cette discipline évite qu'un rejeu partiel de
-- l'historique laisse la 22 sans son outil.
--
-- Ce n'est pas une précaution théorique : la borne de `watch_folders` a dû être corrigée après
-- coup, `array_length('{}', 1)` rendant **NULL** — et un `check` qui vaut NULL est réputé
-- satisfait. Sans convergence, la base de développement aurait gardé la version fautive.

create or replace function app.migration_0022_converger_contrainte(
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

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_label_borne',
	'CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 120)))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_host_borne',
	'CHECK (((char_length(btrim(imap_host)) >= 1) AND (char_length(btrim(imap_host)) <= 253)))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_port_borne',
	'CHECK (((imap_port >= 1) AND (imap_port <= 65535)))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_securite',
	'CHECK ((imap_security = ANY (ARRAY[''ssl''::text, ''starttls''::text, ''none''::text])))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_username_borne',
	'CHECK (((char_length(btrim(imap_username)) >= 1) AND (char_length(btrim(imap_username)) <= 320)))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_folder_style',
	'CHECK ((folder_style = ANY (ARRAY[''folder''::text, ''label''::text])))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_statut',
	'CHECK ((status = ANY (ARRAY[''pending''::text, ''ok''::text, ''error''::text, ''disabled''::text])))');

-- LE CŒUR DU §13.7 : `last_error` porte un CODE, jamais le texte du serveur distant. La
-- contrainte est ce qui rend la règle opposable au lieu de recommandée.
select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_erreur_code',
	'CHECK (((last_error IS NULL) OR (last_error = ANY (ARRAY[''auth_failed''::text, '
	'''host_unreachable''::text, ''connection_refused''::text, ''tls_failed''::text, '
	'''timeout''::text, ''protocol_error''::text]))))');

select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_backfill_borne',
	'CHECK (((backfill_months >= 0) AND (backfill_months <= 120)))');

-- `coalesce` N'EST PAS UNE PRÉCAUTION DE STYLE : `array_length('{}', 1)` rend **NULL**, et un
-- `check` qui vaut NULL est réputé satisfait. Écrite sans lui, la contrainte laissait passer un
-- tableau vide — défaut trouvé par la suite pgTAP, pas à la lecture.
select app.migration_0022_converger_contrainte(
	'public.mail_inbound_accounts', 'mail_inbound_accounts_watch_folders_non_vide',
	'CHECK ((COALESCE(array_length(watch_folders, 1), 0) >= 1))');

comment on table public.mail_inbound_accounts is
	'Comptes IMAP lus par mail-sync. owner_id nul = boîte système du workspace (catch-all du '
	'domaine des cards). Le mot de passe vit dans Vault ; la table ne porte que sa référence, '
	'illisible par authenticated. Écriture par public.upsert_mail_inbound_account uniquement. '
	'docs/SPEC-mail-subsystem.md §13.';

comment on column public.mail_inbound_accounts.secret_id is
	'Référence Vault du mot de passe. Lecture RÉVOQUÉE à anon et authenticated : preuve de refus '
	'n° 6 de docs/SPEC-permissions-rls.md §7.';

comment on column public.mail_inbound_accounts.last_error is
	'Code stable du §13.7, jamais le texte du serveur distant : une phrase d''erreur tierce est '
	'une entrée non maîtrisée qui finirait affichée puis capturée.';

comment on column public.mail_inbound_accounts.last_checked_at is
	'Dernier test de connexion. À ne pas confondre avec last_sync_at, que CRM-054 renseignera.';

-- DEUX INDEX UNIQUES PARTIELS, ET CHACUN ÉVITE UN DÉFAUT PRÉCIS (§13.2). Sans le premier, deux
-- catch-all concurrents liraient le même domaine et dédoubleraient chaque message ; sans le
-- second, un utilisateur porterait deux boîtes personnelles dont rien ne dirait laquelle lire.
create unique index if not exists mail_inbound_accounts_systeme_unique
	on public.mail_inbound_accounts (workspace_id)
	where owner_id is null;

create unique index if not exists mail_inbound_accounts_personnelle_unique
	on public.mail_inbound_accounts (workspace_id, owner_id)
	where owner_id is not null;

-- Lecture par workspace : la politique la plus courante filtre là-dessus.
create index if not exists mail_inbound_accounts_workspace_idx
	on public.mail_inbound_accounts (workspace_id);

drop trigger if exists mail_inbound_accounts_updated_at on public.mail_inbound_accounts;
create trigger mail_inbound_accounts_updated_at
	before update on public.mail_inbound_accounts
	for each row execute function app.set_updated_at();

-- Le propriétaire doit appartenir au workspace de la boîte : une boîte personnelle rattachée à
-- quelqu'un qui n'est pas membre n'aurait aucun lecteur légitime. La contrainte est un trigger et
-- non un `check`, une contrainte ne pouvant pas interroger une autre table.
create or replace function app.mail_inbound_accounts_verifier_proprietaire()
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

comment on function app.mail_inbound_accounts_verifier_proprietaire() is
	'CRM-052 : une boîte personnelle appartient à un membre du workspace, sans quoi personne ne '
	'pourrait la lire. docs/SPEC-mail-subsystem.md §13.2.';

drop trigger if exists mail_inbound_accounts_proprietaire on public.mail_inbound_accounts;
create trigger mail_inbound_accounts_proprietaire
	before insert or update of workspace_id, owner_id on public.mail_inbound_accounts
	for each row execute function app.mail_inbound_accounts_verifier_proprietaire();

-- =============================================================================================
-- 2. Row Level Security — qui lit quoi (§13.4)
-- =============================================================================================

alter table public.mail_inbound_accounts enable row level security;

-- La boîte système est un objet d'EXPLOITATION : y donner accès à tout membre reviendrait à
-- publier la configuration de réception du domaine des cards.
drop policy if exists mail_inbound_accounts_lecture_admin on public.mail_inbound_accounts;
create policy mail_inbound_accounts_lecture_admin
	on public.mail_inbound_accounts
	for select
	to authenticated
	using (app.is_workspace_admin(workspace_id));

-- La boîte d'un collègue est sa correspondance : un membre ne lit QUE la sienne. C'est la preuve
-- de refus n° 7, et elle devient ici acquise au lieu d'être figée.
drop policy if exists mail_inbound_accounts_lecture_proprietaire on public.mail_inbound_accounts;
create policy mail_inbound_accounts_lecture_proprietaire
	on public.mail_inbound_accounts
	for select
	to authenticated
	using (owner_id = (select auth.uid()));

-- =============================================================================================
-- 3. Le chemin d'écriture, et il est unique (§13.3)
-- =============================================================================================
--
-- LES TROIS FONCTIONS VIVENT DANS `public`, ET C'EST MESURÉ, NON SUPPOSÉ : PostgREST est
-- configuré avec `PGRST_DB_SCHEMAS=public,storage,graphql_public`. Une fonction du schéma `app`
-- serait invisible de `/rest/v1/rpc/`, donc inappelable par le seed comme par `mail-sync`. C'est
-- la convention déjà suivie par `move_card`, `move_card_to_channel`, `change_channel_workflow` et
-- `copy_workflow_to_track` : `app` porte les auxiliaires, `public` porte ce qui s'appelle.

-- Écrit ou met à jour un compte entrant, secret compris.
--
-- TROIS PROPRIÉTÉS, ET AUCUNE N'EST DÉCORATIVE.
--
-- 1. Le droit est vérifié AVANT que le secret n'existe : administrateur du workspace pour la
--    boîte système, administrateur ou l'intéressé lui-même pour une boîte personnelle. Créer le
--    secret puis refuser laisserait une ligne dans `vault.secrets` que rien ne référence.
-- 2. `secret_id` n'est JAMAIS rendu. La valeur de retour est l'identifiant du compte.
-- 3. Un mot de passe absent ou vide lors d'une mise à jour CONSERVE le secret existant. C'est ce
--    que le §2.3 appelle « remplacer le mot de passe » : ne pas le remplacer est le cas ordinaire,
--    et obliger à le ressaisir pour changer un port ferait ressaisir un secret sans raison.
create or replace function public.upsert_mail_inbound_account(
	p_workspace_id    uuid,
	p_label           text,
	p_imap_host       text,
	p_imap_port       integer,
	p_imap_security   text,
	p_imap_username   text,
	p_password        text default null,
	p_owner_id        uuid default null,
	p_watch_folders   text[] default null,
	p_folder_style    text default null,
	p_backfill_months integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant     uuid := (select auth.uid());
	v_est_admin    boolean;
	v_existant     public.mail_inbound_accounts%rowtype;
	v_secret_id    uuid;
	v_nom_secret   text;
	v_id           uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	v_est_admin := app.is_workspace_admin(p_workspace_id);

	-- La boîte système n'appartient à personne : seul un administrateur la configure.
	if p_owner_id is null then
		if not v_est_admin then
			raise exception 'forbidden' using errcode = '42501';
		end if;
	elsif not v_est_admin and p_owner_id <> v_appelant then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_existant
	  from public.mail_inbound_accounts a
	 where a.workspace_id = p_workspace_id
	   and a.owner_id is not distinct from p_owner_id;

	-- LE SECRET N'EST TOUCHÉ QUE S'IL EST FOURNI. `vault.update_secret` conserve la référence,
	-- ce qui évite d'orpheliner l'ancienne ligne à chaque changement de mot de passe.
	--
	-- LE NOM D'UN SECRET EST UNIQUE DANS VAULT — `secrets_name_idx`, MESURÉ. Un compte supprimé
	-- laisse donc derrière lui un secret que plus rien ne référence, et recréer la même boîte
	-- échouerait sur un `23505` incompréhensible pour l'exploitant. Le secret orphelin est REPRIS
	-- au lieu d'être recréé : c'est le même nom, la même boîte, et son contenu est remplacé.
	-- Défaut trouvé par la suite pgTAP, pas à la lecture.
	if p_password is not null and btrim(p_password) <> '' then
		v_nom_secret := 'mail_inbound:' || p_workspace_id::text || ':'
		                || coalesce(p_owner_id::text, 'system');
		v_secret_id := v_existant.secret_id;

		if v_secret_id is null then
			select s.id into v_secret_id from vault.secrets s where s.name = v_nom_secret;
		end if;

		if v_secret_id is null then
			v_secret_id := vault.create_secret(
				p_password,
				v_nom_secret,
				'CRM-052 — mot de passe IMAP d''un compte entrant'
			);
		else
			perform vault.update_secret(v_secret_id, p_password);
		end if;
	else
		v_secret_id := v_existant.secret_id;
	end if;

	if v_existant.id is null then
		-- Un compte NEUF sans mot de passe serait inutilisable, et son test de connexion
		-- échouerait sur un secret absent plutôt que sur un diagnostic. Le refus est explicite.
		if v_secret_id is null then
			raise exception 'password_required' using errcode = '23514';
		end if;

		insert into public.mail_inbound_accounts (
			workspace_id, owner_id, label, imap_host, imap_port, imap_security,
			imap_username, secret_id, watch_folders, folder_style, backfill_months
		)
		values (
			p_workspace_id, p_owner_id, btrim(p_label), btrim(p_imap_host), p_imap_port,
			p_imap_security, btrim(p_imap_username), v_secret_id,
			coalesce(p_watch_folders, array['INBOX']::text[]),
			coalesce(p_folder_style, 'folder'),
			coalesce(p_backfill_months, 0)
		)
		returning id into v_id;
	else
		update public.mail_inbound_accounts a
		   set label           = btrim(p_label),
		       imap_host       = btrim(p_imap_host),
		       imap_port       = p_imap_port,
		       imap_security   = p_imap_security,
		       imap_username   = btrim(p_imap_username),
		       secret_id       = v_secret_id,
		       watch_folders   = coalesce(p_watch_folders, a.watch_folders),
		       folder_style    = coalesce(p_folder_style, a.folder_style),
		       backfill_months = coalesce(p_backfill_months, a.backfill_months),
		       -- Toute modification de la connexion REMET l'état à `pending` : un `ok` obtenu
		       -- avec l'ancien hôte ne dit rien du nouveau, et le laisser afficherait une
		       -- certitude périmée.
		       status          = case
		                           when a.imap_host <> btrim(p_imap_host)
		                             or a.imap_port <> p_imap_port
		                             or a.imap_security <> p_imap_security
		                             or a.imap_username <> btrim(p_imap_username)
		                             or (p_password is not null and btrim(p_password) <> '')
		                           then 'pending'
		                           else a.status
		                         end,
		       last_error      = case
		                           when a.imap_host <> btrim(p_imap_host)
		                             or a.imap_port <> p_imap_port
		                             or a.imap_security <> p_imap_security
		                             or a.imap_username <> btrim(p_imap_username)
		                             or (p_password is not null and btrim(p_password) <> '')
		                           then null
		                           else a.last_error
		                         end
		 where a.id = v_existant.id
		returning a.id into v_id;
	end if;

	return v_id;
end;
$$;

comment on function public.upsert_mail_inbound_account is
	'CRM-052 : SEUL chemin d''écriture d''un compte entrant. Vérifie le droit avant de créer le '
	'secret, met le mot de passe dans Vault, ne rend jamais secret_id, et conserve le secret '
	'existant si aucun mot de passe n''est fourni. docs/SPEC-mail-subsystem.md §13.3.';

-- =============================================================================================
-- 4. La seule voie de sortie d'un mot de passe (§13.5)
-- =============================================================================================

-- PostgREST n'expose pas le schéma `vault` : sans cette fonction, `mail-sync` ne pourrait pas
-- déchiffrer, ou il faudrait lui ouvrir une connexion PostgreSQL directe et un second chemin
-- d'accès. Elle est `security definer`, son exécution est révoquée à tous et accordée au seul
-- `service_role`, et elle est éprouvée dans les deux sens : elle rend le secret au service, elle
-- est refusée à tout le reste.
create or replace function public.mail_inbound_account_credentials(p_account_id uuid)
returns table (
	account_id    uuid,
	workspace_id  uuid,
	imap_host     text,
	imap_port     integer,
	imap_security text,
	imap_username text,
	password      text
)
language sql
security definer
set search_path = ''
stable
as $$
	select a.id,
	       a.workspace_id,
	       a.imap_host,
	       a.imap_port,
	       a.imap_security,
	       a.imap_username,
	       s.decrypted_secret
	  from public.mail_inbound_accounts a
	  left join vault.decrypted_secrets s on s.id = a.secret_id
	 where a.id = p_account_id;
$$;

comment on function public.mail_inbound_account_credentials(uuid) is
	'CRM-052 : unique voie par laquelle un mot de passe IMAP sort de la base. Exécution réservée '
	'à service_role. docs/SPEC-mail-subsystem.md §13.5.';

-- Écrit le verdict d'un test de connexion. Réservée à `service_role` pour la même raison : le
-- statut d'un compte est un CONSTAT du serveur, jamais une déclaration du client (§13.2).
create or replace function public.mail_inbound_account_record_check(
	p_account_id uuid,
	p_status     text,
	p_error      text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_maintenant timestamptz := now();
begin
	update public.mail_inbound_accounts a
	   set status          = p_status,
	       last_error      = p_error,
	       last_checked_at = v_maintenant
	 where a.id = p_account_id;

	if not found then
		raise exception 'account_not_found' using errcode = 'P0002';
	end if;

	return v_maintenant;
end;
$$;

comment on function public.mail_inbound_account_record_check is
	'CRM-052 : écrit status, last_error et last_checked_at après un test de connexion réel. '
	'Réservée à service_role — le statut est un constat du serveur. §13.2, §13.7.';

-- =============================================================================================
-- 5. Privilèges — le `revoke` est écrit AVANT les `grant`
-- =============================================================================================
--
-- Même motif qu'à la migration 15 (décision 134) : `supabase/docker/volumes/db/roles.sql` accorde
-- `all privileges` par défaut à `anon` et `authenticated` sur toute table nouvelle. Sans ce
-- `revoke`, le refus par défaut du produit serait une illusion.

revoke all on public.mail_inbound_accounts from anon, authenticated;

-- AUCUNE ÉCRITURE DIRECTE. Ni `insert`, ni `update`, ni `delete` : le seul chemin correct est la
-- fonction du §3, et une table de configuration ne doit pas en offrir deux.
--
-- `secret_id` est ABSENTE de cette liste, et c'est la preuve de refus n° 6. La révocation est un
-- privilège de COLONNE, pas une politique : elle ne dépend d'aucune ligne et ne peut pas être
-- contournée par un `select` bien choisi.
grant select (
	id, workspace_id, owner_id, label, imap_host, imap_port, imap_security, imap_username,
	watch_folders, folder_style, sync_state, backfill_months, status, last_error,
	last_checked_at, last_sync_at, created_at, updated_at
) on public.mail_inbound_accounts to authenticated;

grant all privileges on public.mail_inbound_accounts to service_role;

-- `anon` ne reçoit RIEN : un appelant sans session n'a aucune raison de lire une configuration de
-- messagerie, et la preuve de refus n° 11 l'exige.

revoke all on function public.upsert_mail_inbound_account(
	uuid, text, text, integer, text, text, text, uuid, text[], text, integer
) from public, anon;
grant execute on function public.upsert_mail_inbound_account(
	uuid, text, text, integer, text, text, text, uuid, text[], text, integer
) to authenticated, service_role;

revoke all on function public.mail_inbound_account_credentials(uuid) from public, anon, authenticated;
grant execute on function public.mail_inbound_account_credentials(uuid) to service_role;

revoke all on function public.mail_inbound_account_record_check(uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.mail_inbound_account_record_check(uuid, text, text) to service_role;

-- L'outil de convergence est retiré : il appartient à cette migration, pas au schéma. Le laisser
-- ferait croire à une API du produit, et une migration ultérieure finirait par s'appuyer dessus.
drop function if exists app.migration_0022_converger_contrainte(text, text, text);

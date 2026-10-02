-- @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : les suggestions de l'assistant IA et leur historique
-- @spec docs/SPEC-ia.md §2 (rien n'est écrit dans la configuration avant « Accepter »), §5 (données),
--       §6.1 (la proposition et ses défauts), §11.2 (qui écrit quoi), §11.4 (le verrou, l'échec)
-- @spec docs/SCHEMA.md §9 ter (`suggestions_ia`, `suggestions_ia_revisions`) ;
--       docs/PROD_MIGRATIONS.md §3 (migrations en attente) ; docs/JOURNAL.md décision 617
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- Deux tables : la suggestion, et l'historique de ses révisions. AUCUNE n'écrit dans la configuration :
-- une suggestion n'est qu'une proposition, que seul le geste d'acceptation (tranche T2) applique.
--
-- QUI ÉCRIT QUOI (docs/SPEC-ia.md §11.2). Un administrateur — et lui seul, par RLS — crée une suggestion,
-- pose le verrou de génération, l'abandonne, et y ajoute des révisions d'origine `correction`. La
-- fonction edge `ia` écrit les révisions d'origine `ia` avec la clé de service, après que la base a
-- autorisé l'appelant : un client ne peut donc pas faire passer sa correction pour une suggestion du
-- modèle. L'acceptation est refusée à `authenticated` : elle appartient au geste de T2.
--
-- IDEMPOTENTE ET CONVERGENTE : contraintes retirées puis reposées à chaque passage (décision 57),
-- fonctions et politiques remplacées. Le runner applique chaque fichier dans sa transaction.

-- ---------------------------------------------------------------------------------------------
-- 1. La suggestion
-- ---------------------------------------------------------------------------------------------
create table if not exists public.suggestions_ia (
	id                 uuid        primary key default gen_random_uuid(),
	workspace_id       uuid        not null,
	workflow_id        uuid,
	portee             text        not null,
	demande            text        not null,
	statut             text        not null default 'en_revue',
	empreinte_initiale text,
	generation_depuis  timestamptz,
	derniere_erreur    text,
	version_retour_id  uuid,
	workflow_cree_id   uuid,
	created_by         uuid        default auth.uid(),
	decided_by         uuid,
	created_at         timestamptz not null default now(),
	decided_at         timestamptz
);

-- La clé `(id, workspace_id)` porte la clé étrangère des révisions : celle-ci est retirée D'ABORD, sans quoi
-- un second passage — une adoption rejoue tout le répertoire — échouerait sur la clé dont elle dépend
-- (mesuré le 2026-10-02, par la restauration des dégradations de `0077`). Elle est reposée au §2.
alter table if exists public.suggestions_ia_revisions
	drop constraint if exists suggestions_ia_revisions_suggestion_fkey;

alter table public.suggestions_ia
	drop constraint if exists suggestions_ia_workspace_id_fkey,
	drop constraint if exists suggestions_ia_workflow_id_workspace_id_fkey,
	drop constraint if exists suggestions_ia_version_retour_id_fkey,
	drop constraint if exists suggestions_ia_workflow_cree_id_fkey,
	drop constraint if exists suggestions_ia_created_by_fkey,
	drop constraint if exists suggestions_ia_decided_by_fkey,
	drop constraint if exists suggestions_ia_portee_check,
	drop constraint if exists suggestions_ia_demande_check,
	drop constraint if exists suggestions_ia_statut_check,
	drop constraint if exists suggestions_ia_empreinte_check,
	drop constraint if exists suggestions_ia_erreur_check,
	drop constraint if exists suggestions_ia_cible_check,
	drop constraint if exists suggestions_ia_decision_check,
	drop constraint if exists suggestions_ia_id_workspace_id_key;

alter table public.suggestions_ia
	add constraint suggestions_ia_workspace_id_fkey
		foreign key (workspace_id) references public.workspaces (id) on delete cascade,
	add constraint suggestions_ia_workflow_id_workspace_id_fkey
		foreign key (workflow_id, workspace_id) references public.workflows (id, workspace_id) on delete cascade,
	add constraint suggestions_ia_version_retour_id_fkey
		foreign key (version_retour_id) references public.workflow_versions (id) on delete set null,
	add constraint suggestions_ia_workflow_cree_id_fkey
		foreign key (workflow_cree_id) references public.workflows (id) on delete set null,
	add constraint suggestions_ia_created_by_fkey
		foreign key (created_by) references public.profiles (id) on delete set null,
	add constraint suggestions_ia_decided_by_fkey
		foreign key (decided_by) references public.profiles (id) on delete set null,
	add constraint suggestions_ia_portee_check
		check (portee in ('workflow', 'etapes', 'transitions', 'champs')),
	add constraint suggestions_ia_demande_check
		check (btrim(demande) <> '' and char_length(demande) <= 4000),
	add constraint suggestions_ia_statut_check
		check (statut in ('en_revue', 'acceptee', 'abandonnee')),
	add constraint suggestions_ia_empreinte_check
		check (empreinte_initiale is null or empreinte_initiale ~ '^[0-9a-f]{64}$'),
	add constraint suggestions_ia_erreur_check
		check (derniere_erreur is null
		       or derniere_erreur in ('delai_depasse', 'serveur_injoignable', 'cle_refusee', 'reponse_invalide')),
	-- Créer un workflow se dit avec la portée `workflow` et sans cible ; toute autre portée vise un
	-- workflow existant (docs/SPEC-ia.md §7).
	add constraint suggestions_ia_cible_check
		check (workflow_id is not null or portee = 'workflow'),
	add constraint suggestions_ia_decision_check
		check ((statut = 'en_revue') = (decided_at is null)),
	add constraint suggestions_ia_id_workspace_id_key unique (id, workspace_id);

-- ---------------------------------------------------------------------------------------------
-- 2. Les révisions
-- ---------------------------------------------------------------------------------------------
create table if not exists public.suggestions_ia_revisions (
	id            uuid        primary key default gen_random_uuid(),
	suggestion_id uuid        not null,
	workspace_id  uuid        not null,
	numero        integer     not null,
	origine       text        not null,
	consigne      text,
	proposition   jsonb       not null,
	defauts       jsonb       not null default '[]'::jsonb,
	modele        text,
	jetons_entree integer,
	jetons_sortie integer,
	duree_ms      integer,
	created_by    uuid        default auth.uid(),
	created_at    timestamptz not null default now()
);

alter table public.suggestions_ia_revisions
	drop constraint if exists suggestions_ia_revisions_suggestion_fkey,
	drop constraint if exists suggestions_ia_revisions_created_by_fkey,
	drop constraint if exists suggestions_ia_revisions_numero_check,
	drop constraint if exists suggestions_ia_revisions_origine_check,
	drop constraint if exists suggestions_ia_revisions_consigne_check,
	drop constraint if exists suggestions_ia_revisions_proposition_check,
	drop constraint if exists suggestions_ia_revisions_defauts_check,
	drop constraint if exists suggestions_ia_revisions_mesures_check,
	drop constraint if exists suggestions_ia_revisions_suggestion_id_numero_key;

alter table public.suggestions_ia_revisions
	-- La clé COMPOSITE garantit que la révision appartient à l'espace de sa suggestion : la RLS, qui lit
	-- `workspace_id`, ne peut pas être trompée par une révision rattachée à la suggestion d'autrui.
	add constraint suggestions_ia_revisions_suggestion_fkey
		foreign key (suggestion_id, workspace_id) references public.suggestions_ia (id, workspace_id) on delete cascade,
	add constraint suggestions_ia_revisions_created_by_fkey
		foreign key (created_by) references public.profiles (id) on delete set null,
	add constraint suggestions_ia_revisions_numero_check check (numero > 0),
	add constraint suggestions_ia_revisions_origine_check check (origine in ('ia', 'correction')),
	add constraint suggestions_ia_revisions_consigne_check
		check (consigne is null or (btrim(consigne) <> '' and char_length(consigne) <= 4000)),
	add constraint suggestions_ia_revisions_proposition_check
		check (jsonb_typeof(proposition) = 'object' and proposition ? 'version'),
	add constraint suggestions_ia_revisions_defauts_check check (jsonb_typeof(defauts) = 'array'),
	-- Les mesures appartiennent à une génération du modèle, et à elle seule.
	add constraint suggestions_ia_revisions_mesures_check
		check (case origine
		         when 'ia' then modele is not null and jetons_entree >= 0 and jetons_sortie >= 0 and duree_ms >= 0
		         else modele is null and jetons_entree is null and jetons_sortie is null and duree_ms is null
		       end),
	add constraint suggestions_ia_revisions_suggestion_id_numero_key unique (suggestion_id, numero);

-- ---------------------------------------------------------------------------------------------
-- 3. Gardes
-- ---------------------------------------------------------------------------------------------

-- Création : l'empreinte d'un workflow existant est CALCULÉE par la base, jamais reçue du client — c'est
-- elle que l'acceptation comparera (docs/SPEC-ia.md §4, concurrence). Une suggestion naît en revue.
create or replace function app.suggestions_ia_avant_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.statut := 'en_revue';
	new.decided_by := null;
	new.decided_at := null;
	new.version_retour_id := null;
	new.workflow_cree_id := null;
	new.derniere_erreur := null;
	new.empreinte_initiale := case
		when new.workflow_id is null then null
		else app.workflow_composition_fingerprint(new.workflow_id)
	end;
	return new;
end;
$$;

-- Mise à jour : une suggestion décidée est figée ; `authenticated` peut abandonner, jamais accepter ; la
-- décision se date et se signe par la base.
create or replace function app.suggestions_ia_avant_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if old.statut <> 'en_revue' then
		raise exception 'suggestion figee' using errcode = 'P0001';
	end if;
	if new.statut = 'acceptee' and current_user = 'authenticated' then
		raise exception 'acceptation reservee au geste d''acceptation' using errcode = '42501';
	end if;
	if new.statut <> 'en_revue' then
		new.decided_at := now();
		new.decided_by := coalesce(new.decided_by, auth.uid());
		new.generation_depuis := null;
	end if;
	return new;
end;
$$;

-- Révision : la suggestion doit être en revue ; son espace est RECOPIÉ ; son numéro suit le dernier, sous
-- verrou de la suggestion ; un client n'écrit qu'une `correction`.
create or replace function app.suggestions_ia_revisions_avant_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	la_suggestion public.suggestions_ia%rowtype;
begin
	select * into la_suggestion from public.suggestions_ia where id = new.suggestion_id for update;
	if not found then
		raise exception 'suggestion introuvable' using errcode = 'P0002';
	end if;
	if la_suggestion.statut <> 'en_revue' then
		raise exception 'suggestion figee' using errcode = 'P0001';
	end if;
	if current_user = 'authenticated' and new.origine <> 'correction' then
		raise exception 'seule une correction s''ecrit par le client' using errcode = '42501';
	end if;
	new.workspace_id := la_suggestion.workspace_id;
	new.numero := coalesce(
		(select max(r.numero) from public.suggestions_ia_revisions r where r.suggestion_id = new.suggestion_id), 0) + 1;
	return new;
end;
$$;

create or replace function app.suggestions_ia_revisions_refuser_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	raise exception 'revision immuable' using errcode = 'P0001';
end;
$$;

revoke all on function app.suggestions_ia_avant_creation() from public;
revoke all on function app.suggestions_ia_avant_maj() from public;
revoke all on function app.suggestions_ia_revisions_avant_creation() from public;
revoke all on function app.suggestions_ia_revisions_refuser_mutation() from public;

drop trigger if exists suggestions_ia_avant_creation on public.suggestions_ia;
create trigger suggestions_ia_avant_creation
	before insert on public.suggestions_ia
	for each row execute function app.suggestions_ia_avant_creation();

drop trigger if exists suggestions_ia_avant_maj on public.suggestions_ia;
create trigger suggestions_ia_avant_maj
	before update on public.suggestions_ia
	for each row execute function app.suggestions_ia_avant_maj();

drop trigger if exists suggestions_ia_revisions_avant_creation on public.suggestions_ia_revisions;
create trigger suggestions_ia_revisions_avant_creation
	before insert on public.suggestions_ia_revisions
	for each row execute function app.suggestions_ia_revisions_avant_creation();

-- IMMUABLE EN MODIFICATION, ET SEULEMENT EN MODIFICATION. Une suppression n'est ouverte à aucun client (aucun
-- privilège `DELETE`) ; elle n'arrive que par la CASCADE d'une suggestion, d'un espace de travail ou d'une
-- purge. La première rédaction refusait aussi `DELETE` : elle bloquait ces cascades — mesuré le 2026-10-02,
-- la clé de service ne pouvait plus retirer une suggestion de sonde, ni donc un espace.
drop trigger if exists suggestions_ia_revisions_immuables on public.suggestions_ia_revisions;
create trigger suggestions_ia_revisions_immuables
	before update on public.suggestions_ia_revisions
	for each row execute function app.suggestions_ia_revisions_refuser_mutation();

-- ---------------------------------------------------------------------------------------------
-- 4. RLS : les administrateurs de l'espace, et eux seuls
-- ---------------------------------------------------------------------------------------------
alter table public.suggestions_ia enable row level security;
alter table public.suggestions_ia force row level security;
alter table public.suggestions_ia_revisions enable row level security;
alter table public.suggestions_ia_revisions force row level security;

drop policy if exists suggestions_ia_lecture_admin on public.suggestions_ia;
create policy suggestions_ia_lecture_admin on public.suggestions_ia
	for select to anon, authenticated
	using (app.is_workspace_admin(workspace_id));

drop policy if exists suggestions_ia_creation_admin on public.suggestions_ia;
create policy suggestions_ia_creation_admin on public.suggestions_ia
	for insert to authenticated
	with check (app.is_workspace_admin(workspace_id) and created_by = auth.uid());

drop policy if exists suggestions_ia_maj_admin on public.suggestions_ia;
create policy suggestions_ia_maj_admin on public.suggestions_ia
	for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists suggestions_ia_revisions_lecture_admin on public.suggestions_ia_revisions;
create policy suggestions_ia_revisions_lecture_admin on public.suggestions_ia_revisions
	for select to anon, authenticated
	using (app.is_workspace_admin(workspace_id));

drop policy if exists suggestions_ia_revisions_creation_admin on public.suggestions_ia_revisions;
create policy suggestions_ia_revisions_creation_admin on public.suggestions_ia_revisions
	for insert to authenticated
	with check (app.is_workspace_admin(workspace_id) and created_by = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- 5. Privilèges explicites — rien ne s'en remet aux privilèges par défaut de l'image
-- ---------------------------------------------------------------------------------------------
-- La lecture est accordée à `anon` comme à `authenticated` : un refus se lit alors comme zéro ligne, et
-- non comme une erreur de privilège (docs/SPEC-permissions-rls.md §7). Les colonnes qu'un client écrit
-- sont NOMMÉES : il crée, verrouille et abandonne, rien d'autre.
revoke all on public.suggestions_ia from anon, authenticated;
grant select on public.suggestions_ia to anon, authenticated;
grant insert (workspace_id, workflow_id, portee, demande, generation_depuis) on public.suggestions_ia to authenticated;
grant update (statut, generation_depuis) on public.suggestions_ia to authenticated;
grant all privileges on public.suggestions_ia to service_role;

revoke all on public.suggestions_ia_revisions from anon, authenticated;
grant select on public.suggestions_ia_revisions to anon, authenticated;
grant insert (suggestion_id, origine, consigne, proposition, defauts) on public.suggestions_ia_revisions to authenticated;
grant all privileges on public.suggestions_ia_revisions to service_role;

notify pgrst, 'reload schema';

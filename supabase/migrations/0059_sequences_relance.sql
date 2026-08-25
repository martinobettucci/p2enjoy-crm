-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 4, SOUS-TRANCHE 4a : la séquence et ses paliers
-- @spec docs/SPEC-modeles-emails.md §11 (contrat exécutable de 4a), §11.2 (à qui une séquence
--       appartient), §11.3 (colonnes de `mail_sequences`), §11.4 (le palier, le délai relatif, le
--       `on delete restrict`), §11.5 (ce que la base refuse, ligne à ligne), §11.6 (la position
--       est `deferrable`, et une mesure l'impose), §11.7 (autorisations), §11.9 (le seed)
-- @spec docs/SPEC-modeles-emails.md §2.2 (le `on delete restrict` annoncé quatre tranches à
--       l'avance), §2.6 (le patron d'autorisation repris tel quel)
-- @spec docs/SCHEMA.md §7 (`mail_sequences`, `mail_sequence_steps`)
-- @spec docs/SPEC-permissions-rls.md §3 (fonctions d'autorisation), §7 (le refus est zéro ligne)
-- @spec docs/PROD_MIGRATIONS.md migration 59
--
-- CETTE MIGRATION CRÉE DEUX TABLES ET AJOUTE UN INDEX À UNE TROISIÈME.
--
-- Le seul objet existant touché est `public.mail_templates`, qui reçoit un index unique sur
-- `(id, workspace_id)`. C'est un ajout ADDITIF : il ne refuse aucune écriture que la clé primaire
-- n'interdisait déjà, puisque `id` y est déjà unique à lui seul. Il existe parce qu'une clé
-- étrangère composite l'exige (section 3.2), et pour aucune autre raison.
--
-- Aucune politique, aucun privilège et aucun trigger d'une autre unité n'est modifié.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE SOUS-TRANCHE N'EST PAS.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS L'ARMEMENT. Aucune affaire n'est liée à une séquence ici, aucun message n'est
--    mis en file, aucun job n'est enregistré. Les trois questions du §7.3 — qui arme, ce qui
--    interrompt, ce qu'une réponse produit — portent sur l'APPLICATION d'une séquence à une
--    affaire : elles appartiennent à la sous-tranche 4b et sont cadrées au §11.12.
--
-- 2. CE N'EST PAS UNE SECONDE DÉFINITION DE « FIGÉE ». Une séquence ne porte AUCUN seuil de
--    déclenchement (§11.2). « Figée » a une seule définition en base depuis `CRM-062` —
--    `public.cards_figees()` —, et le §2.1 de `docs/SPEC-relances.md` existe précisément pour
--    empêcher qu'une seconde apparaisse.
--
-- 3. AUCUNE COLONNE SANS LECTEUR (§11.3). Ni `description`, ni `is_active`, ni `archived_at`. La
--    tranche 3 vient de payer le prix d'une colonne posée « au cas où » : `signature_html`, morte
--    depuis `CRM-053`, mal nommée, et dont la réparation a coûté un renommage gardé et la
--    correction de deux migrations antérieures (INC-215, close par la migration 58).
--
-- 4. AUCUNE IDENTITÉ SORTANTE SUR LA SÉQUENCE. Le §2.1 a écarté le lien inverse pour le modèle —
--    un contenu ne dépend pas du compte SMTP qui l'expédie — et l'argument vaut sans changement :
--    quelle identité expédie est une question d'ARMEMENT, donc de 4b.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout est donc écrit pour être
-- rejouable : `create table if not exists`, `drop constraint if exists` avant `add constraint`,
-- `drop policy if exists` avant `create policy`, `drop index if exists` avant `create index`.
--
-- LA MIGRATION 58 A MONTRÉ CE QUE CETTE EXIGENCE COÛTE QUAND ON L'OUBLIE : un `grant select` de
-- colonne nommant une colonne renommée plus loin a fait échouer le DEUXIÈME démarrage suivant,
-- c'est-à-dire chez le prochain contributeur et jamais chez celui qui l'écrit (décision 516).
-- Rien ici ne nomme une colonne d'une autre migration.

-- =============================================================================================
-- 1. `public.mail_sequences` — la cadence éditoriale nommée — §11.2 et §11.3
-- =============================================================================================
-- UNE SÉQUENCE APPARTIENT AU WORKSPACE, exactement comme un modèle (§2.1) et pour la même raison :
-- deux personnes qui relancent le même prospect doivent relancer à la même cadence, et dupliquer
-- une cadence par channel serait la duplication que `CLAUDE.md` §4 proscrit.

create table if not exists public.mail_sequences (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	-- Trace, JAMAIS un droit : même règle qu'au §2.2 pour `mail_templates.created_by`. Aucune
	-- politique ne lit cette colonne.
	created_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

alter table public.mail_sequences drop constraint if exists mail_sequences_name_borne;
alter table public.mail_sequences add  constraint mail_sequences_name_borne
	check (char_length(app.btrim_blancs(name)) between 1 and 120);

-- Unicité par workspace sur la forme NORMALISÉE, comme `mail_templates` (§11.3). Deux cadences
-- nommées « Relance longue » et « Relance longue » aux blancs près sont la même cadence pour qui
-- les lit dans une liste ; l'unicité GLOBALE, elle, empêcherait deux workspaces de nommer la leur.
drop index if exists mail_sequences_workspace_name_key;
create unique index mail_sequences_workspace_name_key
	on public.mail_sequences (workspace_id, app.btrim_blancs(name));

-- L'INDEX QUE LA CLÉ COMPOSITE DU PALIER EXIGE (§11.5 points n et o). `id` est déjà unique par la
-- clé primaire ; cet index n'ajoute donc aucune règle, il rend seulement le couple référençable.
-- C'est le patron de `workflow_steps_id_workflow_id_key`, posé pour la même raison par `CRM-031`.
--
-- ELLE EST POSÉE CONDITIONNELLEMENT, ET NON PAR `drop … if exists` SUIVI D'UN `add`. MESURÉ le
-- 2026-08-25 au DEUXIÈME passage de cette migration :
--
--   ERROR: cannot drop constraint mail_sequences_id_workspace_key on table mail_sequences
--          because other objects depend on it
--
-- La clé étrangère composite de la section 3.2 en dépend, si bien que la déposer exigerait un
-- `cascade` — qui emporterait SILENCIEUSEMENT cette clé étrangère et laisserait la table sans son
-- garde-fou de cloisonnement. La forme conditionnelle est celle de la migration 54 pour
-- `card_events_type_check`, et elle est retenue ici pour la même raison : ce qui ne peut pas être
-- reposé sans dommage se pose une fois. C'est exactement la panne que le préambule décrit — elle ne
-- se serait vue qu'au deuxième démarrage, donc chez le prochain contributeur.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.mail_sequences'::regclass
		   and conname  = 'mail_sequences_id_workspace_key'
	) then
		alter table public.mail_sequences add constraint mail_sequences_id_workspace_key
			unique (id, workspace_id);
	end if;
end;
$$;

create index if not exists mail_sequences_workspace_idx
	on public.mail_sequences (workspace_id, name);

drop trigger if exists mail_sequences_set_updated_at on public.mail_sequences;
create trigger mail_sequences_set_updated_at
	before update on public.mail_sequences
	for each row execute function app.set_updated_at();

comment on table public.mail_sequences is
	'CRM-063 tranche 4a — docs/SCHEMA.md §7, docs/SPEC-modeles-emails.md §11.2. Cadence '
	'éditoriale nommée d''un workspace : une suite ordonnée de paliers, chacun portant un modèle '
	'et un délai. Elle ne porte NI identité sortante NI seuil de déclenchement — la première est '
	'une question d''armement (4b), le second a une seule définition en base depuis CRM-062.';
comment on column public.mail_sequences.created_by is
	'Trace, jamais un droit : docs/SPEC-modeles-emails.md §11.3. Aucune politique ne la lit.';

-- =============================================================================================
-- 2. L'index composite ajouté à `public.mail_templates` — §11.5
-- =============================================================================================
-- MESURÉ le 2026-08-25, avant cette migration : les seuls index uniques de `mail_templates` sont
-- `mail_templates_pkey` et `mail_templates_workspace_name_key`. Le couple `(id, workspace_id)`
-- n'était donc pas référençable, et la clé étrangère composite du palier — celle qui interdit
-- qu'un palier emprunte le modèle d'un AUTRE workspace — ne pouvait pas être posée.
--
-- L'ajout est ADDITIF et ne change aucun comportement : `id` étant déjà unique seul, le couple
-- l'est nécessairement.

-- Posée conditionnellement, pour la raison MESURÉE en section 1 : la clé étrangère composite de la
-- section 3.2 en dépend, et un `drop … if exists` échouerait dès le deuxième passage.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.mail_templates'::regclass
		   and conname  = 'mail_templates_id_workspace_key'
	) then
		alter table public.mail_templates add constraint mail_templates_id_workspace_key
			unique (id, workspace_id);
	end if;
end;
$$;

-- =============================================================================================
-- 3. `public.mail_sequence_steps` — le palier — §11.4
-- =============================================================================================

create table if not exists public.mail_sequence_steps (
	id           uuid        primary key default gen_random_uuid(),
	-- Dénormalisée pour que les politiques RLS la lisent SANS JOINTURE — patron de `card_contacts`
	-- et de `goal_blocks`. Une colonne dénormalisée peut diverger de sa source ; la section 3.2
	-- l'interdit en base plutôt que de compter sur les écrivains.
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	-- `cascade` : un palier n'a AUCUNE existence hors de sa séquence.
	sequence_id  uuid        not null references public.mail_sequences (id) on delete cascade,
	position     integer     not null,
	delai_jours  integer     not null,
	-- `restrict` : c'est la contrainte que le §2.2 a écrite QUATRE TRANCHES à l'avance, pour que
	-- celle-ci ne la découvre pas. Un modèle employé par une séquence ne se supprime plus.
	template_id  uuid        not null references public.mail_templates (id) on delete restrict,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

-- --- 3.1 Bornes de valeur ---------------------------------------------------------------------
--
-- LE DÉLAI SE COMPTE DEPUIS LE PALIER PRÉCÉDENT, et le premier depuis l'armement (§11.4).
-- L'alternative était un décalage ABSOLU depuis l'armement ; le relatif est retenu parce
-- qu'insérer un palier au milieu d'une cadence ne renumérote alors RIEN. En absolu, glisser une
-- relance entre J+3 et J+14 obligerait à réécrire le décalage de tous les paliers suivants, et un
-- oubli produirait deux envois le même jour sans qu'aucune contrainte ne le voie.
--
-- LA BORNE BASSE EST 1, ET NON 0. Un palier de délai nul partirait à l'instant de l'armement, ou
-- en même temps que le palier qui le précède : ce n'est pas une cadence, c'est un doublon. La
-- borne haute de 365 tient la place des 20 000 caractères du §2.2 — au-delà d'un an, on n'écrit
-- plus une cadence de relance.

alter table public.mail_sequence_steps drop constraint if exists mail_sequence_steps_position_borne;
alter table public.mail_sequence_steps add  constraint mail_sequence_steps_position_borne
	check (position between 1 and 50);

alter table public.mail_sequence_steps drop constraint if exists mail_sequence_steps_delai_borne;
alter table public.mail_sequence_steps add  constraint mail_sequence_steps_delai_borne
	check (delai_jours between 1 and 365);

-- --- 3.2 Les deux clés composites, qui interdisent la divergence de workspace ------------------
--
-- §11.5 points n et o. Un palier porte `workspace_id` pour que ses politiques le lisent sans
-- jointure ; le faire diverger SILENCIEUSEMENT de sa séquence ou de son modèle rendrait le
-- cloisonnement faux là où il compte. Les deux clés l'interdisent en base, et le refus est un
-- `23503` — une clé étrangère, jamais une politique, jamais un trigger.

alter table public.mail_sequence_steps drop constraint if exists mail_sequence_steps_sequence_workspace_fkey;
alter table public.mail_sequence_steps add  constraint mail_sequence_steps_sequence_workspace_fkey
	foreign key (sequence_id, workspace_id)
	references public.mail_sequences (id, workspace_id) on delete cascade;

alter table public.mail_sequence_steps drop constraint if exists mail_sequence_steps_template_workspace_fkey;
alter table public.mail_sequence_steps add  constraint mail_sequence_steps_template_workspace_fkey
	foreign key (template_id, workspace_id)
	references public.mail_templates (id, workspace_id) on delete restrict;

-- --- 3.3 LA POSITION EST UNIQUE PAR SÉQUENCE, ET LA CONTRAINTE EST `DEFERRABLE` ----------------
--
-- §11.6, ET UNE MESURE L'IMPOSE. Réordonner des paliers, c'est ÉCHANGER deux positions, et
-- l'opération passe nécessairement par un état transitoire où deux lignes portent la même
-- position. MESURÉ le 2026-08-25 sur deux tables sondes portant deux lignes en positions 1 et 2 :
--
--   * `unique` simple, `update … set pos = 3 - pos` en UN SEUL update  => 23505
--   * `unique` simple, deux `update` séparés dans une transaction      => 23505
--   * `deferrable initially immediate`, le MÊME update unique          => ACCEPTÉ
--   * `deferrable initially immediate` + `set constraints … deferred`  => ACCEPTÉ
--
-- La première ligne est celle qui décide : avec une contrainte simple, MÊME L'ÉCHANGE ATOMIQUE est
-- refusé, PostgreSQL vérifiant un index unique ligne à ligne. Différée à la fin de l'INSTRUCTION,
-- la vérification laisse passer l'échange sans qu'aucun appelant n'ait à émettre `set constraints`
-- — donc y compris un `PATCH` PostgREST, qui n'a aucun moyen de le faire.
--
-- ELLE RESTE `initially immediate` ET NON `initially deferred` : hors réordonnancement, un doublon
-- doit être refusé par l'instruction qui le crée, et non à la validation d'une transaction dont
-- l'appelant ne saura plus quelle écriture a fauté.

alter table public.mail_sequence_steps drop constraint if exists mail_sequence_steps_sequence_position_key;
alter table public.mail_sequence_steps add  constraint mail_sequence_steps_sequence_position_key
	unique (sequence_id, position) deferrable initially immediate;

create index if not exists mail_sequence_steps_sequence_idx
	on public.mail_sequence_steps (sequence_id, position);

-- Un modèle peut servir PLUSIEURS paliers (§11.4) : l'index est ordinaire, jamais unique. Il sert
-- le refus du `on delete restrict`, qui cherche les paliers d'un modèle qu'on supprime.
create index if not exists mail_sequence_steps_template_idx
	on public.mail_sequence_steps (template_id);

drop trigger if exists mail_sequence_steps_set_updated_at on public.mail_sequence_steps;
create trigger mail_sequence_steps_set_updated_at
	before update on public.mail_sequence_steps
	for each row execute function app.set_updated_at();

comment on table public.mail_sequence_steps is
	'CRM-063 tranche 4a — docs/SCHEMA.md §7, docs/SPEC-modeles-emails.md §11.4. Palier d''une '
	'séquence : une position, un délai EN JOURS DEPUIS LE PALIER PRÉCÉDENT — le premier depuis '
	'l''armement — et un modèle. La position est unique par séquence et DEFERRABLE : sans cela, '
	'même un échange atomique de deux positions rendrait 23505 (§11.6).';
comment on column public.mail_sequence_steps.delai_jours is
	'Jours depuis le palier PRÉCÉDENT, et non depuis l''armement : insérer un palier au milieu '
	'd''une cadence ne renumérote alors rien (docs/SPEC-modeles-emails.md §11.4). Le décalage '
	'absolu reste dérivable — la somme des délais des paliers de position inférieure ou égale.';
comment on column public.mail_sequence_steps.template_id is
	'`on delete restrict`, annoncé par docs/SPEC-modeles-emails.md §2.2 quatre tranches avant '
	'd''être posé : un modèle employé par une séquence ne se supprime plus, et le refus est un '
	'23503. La clé n''est PAS unique — un même modèle sert plusieurs paliers.';

-- =============================================================================================
-- 4. Row Level Security — §11.7
-- =============================================================================================
-- AUCUNE NOTION NOUVELLE : le patron est EXACTEMENT celui de `mail_templates` (§2.6), lui-même
-- celui de `goal_boards`, et la raison est la même — une séquence est un objet éditorial collectif
-- du workspace.
--
-- LES DEUX TABLES PORTENT LES QUATRE POLITIQUES, sans exception : un palier modifiable par qui ne
-- peut pas modifier sa séquence serait un contournement, la cadence vivant dans les paliers.
--
-- Refus par défaut : la RLS est activée et aucune politique n'est implicite.

alter table public.mail_sequences       enable row level security;
alter table public.mail_sequence_steps  enable row level security;

drop policy if exists mail_sequences_lecture_membre on public.mail_sequences;
create policy mail_sequences_lecture_membre
	on public.mail_sequences
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists mail_sequences_insertion_membre_ecrivant on public.mail_sequences;
create policy mail_sequences_insertion_membre_ecrivant
	on public.mail_sequences
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequences_maj_membre_ecrivant on public.mail_sequences;
create policy mail_sequences_maj_membre_ecrivant
	on public.mail_sequences
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('admin', 'business_developer'))
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequences_suppression_membre_ecrivant on public.mail_sequences;
create policy mail_sequences_suppression_membre_ecrivant
	on public.mail_sequences
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequence_steps_lecture_membre on public.mail_sequence_steps;
create policy mail_sequence_steps_lecture_membre
	on public.mail_sequence_steps
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists mail_sequence_steps_insertion_membre_ecrivant on public.mail_sequence_steps;
create policy mail_sequence_steps_insertion_membre_ecrivant
	on public.mail_sequence_steps
	for insert
	to authenticated
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequence_steps_maj_membre_ecrivant on public.mail_sequence_steps;
create policy mail_sequence_steps_maj_membre_ecrivant
	on public.mail_sequence_steps
	for update
	to authenticated
	using      (app.workspace_role(workspace_id) in ('admin', 'business_developer'))
	with check (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

drop policy if exists mail_sequence_steps_suppression_membre_ecrivant on public.mail_sequence_steps;
create policy mail_sequence_steps_suppression_membre_ecrivant
	on public.mail_sequence_steps
	for delete
	to authenticated
	using (app.workspace_role(workspace_id) in ('admin', 'business_developer'));

-- =============================================================================================
-- 5. Privilèges des deux tables — §11.7
-- =============================================================================================
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas des
-- `alter default privileges` de la distribution. `anon` conserve `select` — et n'obtient RIEN,
-- aucune politique ne le laissant passer : `app.is_workspace_member` rend faux hors session.
--
-- LE POINT DE SÛRETÉ DES MIGRATIONS 48 À 58 S'APPLIQUE : la plateforme porte des
-- `alter default privileges … to anon`, si bien qu'un `revoke … from public` ne retire RIEN à un
-- rôle NOMMÉ. Les rôles sont donc révoqués nommément avant toute attribution.

revoke all on public.mail_sequences from anon, authenticated;
grant select                 on public.mail_sequences to anon, authenticated;
grant insert, update, delete on public.mail_sequences to authenticated;
grant all privileges         on public.mail_sequences to service_role;

revoke all on public.mail_sequence_steps from anon, authenticated;
grant select                 on public.mail_sequence_steps to anon, authenticated;
grant insert, update, delete on public.mail_sequence_steps to authenticated;
grant all privileges         on public.mail_sequence_steps to service_role;

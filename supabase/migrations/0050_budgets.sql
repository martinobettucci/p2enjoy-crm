-- @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture
-- @spec docs/SPEC-costs.md §1 (le modèle), §2.1 (budgets), §2.2 (occurrences), §3 (autorisations),
--       §5 (hors périmètre)
-- @spec docs/SCHEMA.md §9 bis.4 (budgets), §9 bis.5 (budget_occurrences), §9 bis.7 (politiques)
-- @spec docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.3 (droits fins de track),
--       §3.5 (une politique ne relit pas sa propre table), §4 (familles de tables)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 50)
--
-- Un track porte des budgets ; un budget récurrent porte des occurrences. Décision 432 du
-- 2026-08-19.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'AUTORISERA JAMAIS, ET C'EST ÉCRIT EN TÊTE.
-- ---------------------------------------------------------------------------------------------
-- `docs/SPEC-costs.md` §2.2 : **aucune génération automatique d'occurrences**, jamais. Aucun
-- trigger de ce fichier ne crée « février » parce que « janvier » existe, ne déduit une période
-- d'une autre, ni ne pose de calendrier. On crée « janvier » à la main, puis « février » à la
-- main, et **on ne crée pas « mars » s'il ne s'est rien passé en mars** : un mois sans occurrence
-- est une INFORMATION, que la génération automatique détruirait en fabriquant une occurrence vide.
--
-- `period_start` et `period_end` ne contraignent RIEN (§2.2). Elles ordonnent et libellent. Aucun
-- trigger n'y compare une date, et `CRM-085` n'en refusera aucune ligne de coût : le rattachement
-- est un choix de l'utilisateur, pas une déduction.
--
-- Une évolution future qui proposerait de « générer les douze mois » ou de refuser une dépense
-- hors période contredit cette spécification : c'est un changement de nature, à arbitrer comme
-- tel, jamais une amélioration.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : les deux tables, leurs contraintes de forme, l'unicité du nom **limitée aux budgets
-- ouverts**, l'attribution automatique de `position`, les deux triggers de cohérence de la
-- récurrence, les deux fonctions d'appui `SECURITY DEFINER`, la RLS activée, les politiques
-- nommées par action, les privilèges explicites et les triggers `updated_at`.
--
-- Non livré, et NOMMÉ plutôt que tu :
--   * `card_costs` — les lignes de coût d'une affaire — est `CRM-085` (`docs/SCHEMA.md`
--     §9 bis.6). Cette migration ne pose donc AUCUN trigger de refus d'insertion sur un budget
--     clôturé : il n'existe encore aucune table à qui le refuser. Le contrat est écrit au §2.3 de
--     la spécification et appartient à l'unité suivante ;
--   * **aucun écran**. L'administration des budgets dans le track (`docs/SPEC-costs.md` §4.1) est
--     la tranche 2 de `CRM-084` ; les écrans de coûts sont `CRM-086`.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile. Tout est donc écrit pour être rejouable : `create table if not
-- exists`, `create or replace function`, `drop trigger if exists` avant `create trigger`, `drop
-- policy if exists` avant `create policy`, et les contraintes de valeur posées de façon
-- **convergente** — `drop constraint if exists` puis `add constraint` — pour que la définition du
-- fichier fasse autorité à chaque passage (même patron que `CRM-020`, `CRM-060` et `CRM-082`).

-- =============================================================================================
-- 1. `public.budgets` — l'enveloppe d'un track
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.4, docs/SPEC-costs.md §2.1.
--
-- Un budget appartient à un TRACK et jamais à un channel : le §1 de la spécification pose que
-- « un track porte des budgets », et le §4.5 cumule par track. Le rattacher plus bas obligerait
-- les écrans à recomposer un total de track par union de channels, ce qu'aucune RLS ne rendrait
-- honnêtement — un channel fermé à l'appelant retirerait silencieusement sa part du total.

create table if not exists public.budgets (
	id             uuid        primary key default gen_random_uuid(),
	track_id       uuid        not null references public.tracks (id) on delete cascade,
	name           text        not null,
	-- Même convention que `cards.currency` : trois lettres majuscules, défaut `EUR`. Aucune
	-- conversion, aucun taux de change (§5) — les écrans REGROUPENT par devise (§4.5) au lieu
	-- d'additionner ce qui ne s'additionne pas.
	currency       text        not null default 'EUR',
	-- L'enveloppe, SI elle est décidée. Facultative : un budget peut n'être qu'un axe de
	-- regroupement de dépenses, sans montant prévu d'avance.
	planned_amount numeric(14,2),
	is_recurrent   boolean     not null default false,
	-- Nul tant que le budget est OUVERT. Un budget ne se supprime pas, il se clôture (§3.2) :
	-- des lignes de coût le référenceront, et les détruire effacerait la dépense constatée.
	closed_at      timestamptz,
	-- `numeric` et non `integer` : index fractionnaire, même convention que `tracks.position` et
	-- `goal_boards.position`. Attribuée par trigger lorsqu'elle est omise (§3 ci-dessous).
	position       numeric     not null,
	-- Trace, JAMAIS un droit : l'écriture d'un budget est réservée aux administrateurs du
	-- workspace (§3.2), et l'auteur d'un budget n'en obtient aucun privilège particulier.
	created_by     uuid        references public.profiles (id) on delete set null,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.budgets drop constraint if exists budgets_name_check;
alter table public.budgets add  constraint budgets_name_check
	check (app.btrim_blancs(name) <> '');

alter table public.budgets drop constraint if exists budgets_currency_check;
alter table public.budgets add  constraint budgets_currency_check
	check (currency ~ '^[A-Z]{3}$');

-- AUCUNE CONTRAINTE DE SIGNE sur `planned_amount`, et c'est délibéré (§2.1) : même doctrine que
-- `cards.amount`. Un avoir, une remise ou un remboursement sont des montants négatifs légitimes,
-- et une contrainte `>= 0` obligerait à les représenter par un contournement.

comment on table public.budgets is
	'CRM-084 — docs/SCHEMA.md §9 bis.4, docs/SPEC-costs.md §2.1. Enveloppe budgétaire d''un '
	'track. Se clôture, ne se supprime pas.';

comment on column public.budgets.closed_at is
	'Nul tant que le budget est ouvert. La clôture est RÉVERSIBLE (voir §1.2) ; sa seule limite '
	'est l''index partiel d''unicité du nom.';

comment on column public.budgets.is_recurrent is
	'Un budget récurrent porte des occurrences (docs/SPEC-costs.md §2.2) ; un budget simple n''en '
	'porte aucune, et le trigger `app.budgets_verifier_recurrence` le tient dans les deux sens.';

-- --- 1.2 Unicité du nom, LIMITÉE AUX BUDGETS OUVERTS ------------------------------------------
-- `docs/SPEC-costs.md` §2.1 et `docs/SCHEMA.md` §9 bis.4 : index PARTIEL `where closed_at is
-- null`. Clôturer « Salon 2025 » puis ouvrir un nouveau « Salon 2025 » l'année suivante est un
-- geste normal ; l'interdire forcerait des noms artificiels — « Salon 2025 (bis) » — que
-- personne ne relit.
--
-- C'EST L'ÉCART EXACT AVEC `goal_boards`, dont l'unicité porte sur TOUS les tableaux, archivés
-- compris (`CRM-082` §1.1). Les deux suivent leur spécification à la lettre ; la divergence est
-- écrite ici plutôt que découverte en comparant deux fichiers.
--
-- CE QUE CET INDEX DIT DE LA RÉOUVERTURE, ET C'EST LE CONTRAT ÉCRIT QUE LA DoD RÉCLAME : la
-- clôture est RÉVERSIBLE — remettre `closed_at` à nul est une simple mise à jour, qu'aucune
-- garde n'interdit —, MAIS elle ne l'est plus si le nom a été repris entre-temps. Rouvrir
-- « Salon 2025 » alors qu'un « Salon 2025 » ouvert existe déjà est refusé par CET index, et par
-- lui seul. C'est la conséquence directe et assumée du choix ci-dessus : le nom d'un budget clos
-- est LIBÉRÉ, donc reprenable, donc parfois repris.
--
-- La forme normalisée, plutôt que le texte brut : `app.btrim_blancs` retire les blancs de tête et
-- de queue, exactement ceux que `String.prototype.trim()` retire, de sorte que la base ne soit ni
-- plus stricte ni plus laxiste que l'interface. Elle est `IMMUTABLE`, donc indexable.
drop index if exists budgets_track_name_ouvert_key;
create unique index budgets_track_name_ouvert_key
	on public.budgets (track_id, app.btrim_blancs(name))
	where closed_at is null;

create index if not exists budgets_track_position_idx
	on public.budgets (track_id, position, name)
	where closed_at is null;

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
	before update on public.budgets
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. `public.budget_occurrences` — les instances d'un budget récurrent
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.5, docs/SPEC-costs.md §2.2.

create table if not exists public.budget_occurrences (
	id             uuid        primary key default gen_random_uuid(),
	budget_id      uuid        not null references public.budgets (id) on delete cascade,
	label          text        not null,
	-- PUREMENT DESCRIPTIVES (§2.2). Elles servent à ordonner et à libeller, et ne contraignent
	-- aucune ligne de coût. Facultatives : « Campagne de lancement » est un libellé qui se passe
	-- de dates.
	period_start   date,
	period_end     date,
	planned_amount numeric(14,2),
	-- UNE OCCURRENCE SE CLÔTURE INDÉPENDAMMENT DE SON BUDGET (§2.2). Aucune cascade dans un sens
	-- ni dans l'autre : clôturer le budget ne clôt pas ses occurrences, et clôturer la dernière
	-- occurrence ne clôt pas le budget. Les deux gestes portent deux décisions de gestion
	-- distinctes — « ce mois est soldé » n'est pas « cette enveloppe est finie ».
	closed_at      timestamptz,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);

-- --- 2.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.budget_occurrences drop constraint if exists budget_occurrences_label_check;
alter table public.budget_occurrences add  constraint budget_occurrences_label_check
	check (app.btrim_blancs(label) <> '');

-- AUCUNE CONTRAINTE `period_start <= period_end`, et ce n'est PAS un oubli. Le §2.2 pose ces deux
-- colonnes comme « purement descriptives » : les contraindre entre elles serait la première
-- déduction d'une série que la spécification interdit, et refuserait une saisie en cours dont
-- l'utilisateur n'a encore renseigné qu'une borne. L'ordre des périodes sert à TRIER (§4.3), pas
-- à juger.

comment on table public.budget_occurrences is
	'CRM-084 — docs/SCHEMA.md §9 bis.5, docs/SPEC-costs.md §2.2. Instance d''un budget récurrent. '
	'AUCUNE génération automatique, jamais.';

comment on column public.budget_occurrences.period_start is
	'Purement descriptive : elle ordonne et libelle, elle ne contraint aucune ligne de coût '
	'(docs/SPEC-costs.md §2.2).';

-- --- 2.2 Unicité du libellé, par budget -------------------------------------------------------
-- `docs/SCHEMA.md` §9 bis.5 : « non vide, unique par budget ». Sans restriction aux occurrences
-- ouvertes, contrairement au nom d'un budget : deux « Janvier 2026 » sur la même enveloppe
-- seraient une erreur de saisie dans tous les cas, jamais un geste normal — un mois ne revient
-- pas.
drop index if exists budget_occurrences_budget_label_key;
create unique index budget_occurrences_budget_label_key
	on public.budget_occurrences (budget_id, app.btrim_blancs(label));

create index if not exists budget_occurrences_budget_periode_idx
	on public.budget_occurrences (budget_id, period_start, label);

drop trigger if exists budget_occurrences_set_updated_at on public.budget_occurrences;
create trigger budget_occurrences_set_updated_at
	before update on public.budget_occurrences
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. Attribution automatique de `position`
-- =============================================================================================
-- Même patron que `app.tracks_attribuer_position` (`CRM-011`) et `app.goal_boards_attribuer_
-- position` (`CRM-082`). Un client qui omet `position` obtient la suivante dans SON track.
--
-- `security definer` : la fonction lit `budgets` pour calculer le maximum, et la RLS de la table
-- masquerait les budgets d'un track illisible. La sous-requête est déjà bornée au track de la
-- ligne insérée, mais le `definer` garantit que le maximum est le VRAI maximum et non celui des
-- lignes visibles — deux budgets ne doivent pas recevoir la même position parce que l'un d'eux
-- était invisible à celui qui a créé l'autre.

create or replace function app.budgets_attribuer_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(b.position), 0) + 1
			  from public.budgets b
			 where b.track_id = new.track_id
		);
	end if;
	return new;
end;
$$;

alter function app.budgets_attribuer_position() owner to postgres;

comment on function app.budgets_attribuer_position() is
	'CRM-084 — docs/SCHEMA.md §9 bis.4. Attribue la position suivante dans le track lorsque '
	'`position` est omise. Même patron que app.tracks_attribuer_position (CRM-011).';

revoke all on function app.budgets_attribuer_position() from public;

drop trigger if exists budgets_attribuer_position on public.budgets;
create trigger budgets_attribuer_position
	before insert on public.budgets
	for each row execute function app.budgets_attribuer_position();

-- =============================================================================================
-- 4. Cohérence de la récurrence — LA GARDE SE TIENT DES DEUX CÔTÉS
-- =============================================================================================
-- `docs/SCHEMA.md` §9 bis.5 : « une occurrence n'existe que sur un budget `is_recurrent` ».
--
-- CETTE PHRASE DÉCRIT UN INVARIANT, PAS UN SEUL TRIGGER, et c'est le point que la lecture rapide
-- manque. Une garde posée uniquement sur `budget_occurrences` laisserait le chemin suivant
-- ouvert : créer un budget récurrent, lui poser trois occurrences, puis le repasser à
-- `is_recurrent = false`. L'invariant serait alors faux SANS qu'aucune ligne interdite n'ait
-- jamais été insérée, et `CRM-085` s'appuierait ensuite sur lui pour décider si `occurrence_id`
-- est exigée. Il faut donc DEUX triggers, un par table.

-- --- 4.1 Côté occurrence : elle n'existe que sur un budget récurrent --------------------------
-- `security definer` : la fonction lit `budgets`, dont la RLS masque les budgets d'un track que
-- l'appelant ne lit pas. Sans `definer`, un appelant qui poserait une occurrence sur un budget
-- qu'il n'a pas le droit de LIRE recevrait « budget introuvable » au lieu du refus de sa
-- politique d'écriture — un message trompeur, et un aveu par l'erreur. Ici la politique tranche
-- d'abord, le trigger ensuite.

create or replace function app.budget_occurrences_verifier_recurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	recurrent boolean;
begin
	select b.is_recurrent into recurrent
	  from public.budgets b
	 where b.id = new.budget_id;

	if recurrent is null then
		raise exception 'le budget « % » n''existe pas', new.budget_id
			using errcode = '23503';
	end if;

	if not recurrent then
		raise exception 'une occurrence n''existe que sur un budget récurrent (docs/SPEC-costs.md §2.2)'
			using errcode = '23514';
	end if;

	return new;
end;
$$;

alter function app.budget_occurrences_verifier_recurrence() owner to postgres;

comment on function app.budget_occurrences_verifier_recurrence() is
	'CRM-084 — docs/SCHEMA.md §9 bis.5, docs/SPEC-costs.md §2.2. Une occurrence n''existe que '
	'sur un budget `is_recurrent`. Pendant de app.budgets_verifier_recurrence.';

revoke all on function app.budget_occurrences_verifier_recurrence() from public;

drop trigger if exists budget_occurrences_verifier_recurrence on public.budget_occurrences;
create trigger budget_occurrences_verifier_recurrence
	before insert or update of budget_id on public.budget_occurrences
	for each row execute function app.budget_occurrences_verifier_recurrence();

-- --- 4.2 Côté budget : on ne retire pas la récurrence sous ses occurrences --------------------
-- Le pendant du 4.1, et la raison est écrite au 4 ci-dessus. Le refus ne porte QUE sur le passage
-- de `true` à `false` alors que des occurrences existent : rendre récurrent un budget simple
-- reste libre — il n'a rien à contredire —, et la mise à jour d'un budget récurrent qui garde sa
-- récurrence n'est pas touchée.
--
-- LE REMÈDE EST NOMMÉ DANS LE MESSAGE, et ce n'est pas de la politesse : sans lui, un
-- administrateur qui voit « des occurrences existent » ne sait pas si le produit lui demande de
-- les supprimer, de les clôturer, ou s'il vient de rencontrer un défaut. Supprimer les
-- occurrences est ici le geste attendu — clôturer ne suffirait pas, une occurrence close reste
-- une occurrence, et les lignes de coût de `CRM-085` la référencent encore.

create or replace function app.budgets_verifier_recurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	occurrences integer;
begin
	if old.is_recurrent and not new.is_recurrent then
		select count(*) into occurrences
		  from public.budget_occurrences o
		 where o.budget_id = new.id;

		if occurrences > 0 then
			raise exception
				'ce budget porte % occurrence(s) : supprimez-les avant de le rendre non récurrent (docs/SPEC-costs.md §2.2)',
				occurrences
				using errcode = '23514';
		end if;
	end if;

	return new;
end;
$$;

alter function app.budgets_verifier_recurrence() owner to postgres;

comment on function app.budgets_verifier_recurrence() is
	'CRM-084 — docs/SPEC-costs.md §2.2. Refuse de retirer la récurrence d''un budget qui porte '
	'des occurrences. Pendant de app.budget_occurrences_verifier_recurrence.';

revoke all on function app.budgets_verifier_recurrence() from public;

drop trigger if exists budgets_verifier_recurrence on public.budgets;
create trigger budgets_verifier_recurrence
	before update of is_recurrent on public.budgets
	for each row execute function app.budgets_verifier_recurrence();

-- =============================================================================================
-- 5. Fonctions d'appui des politiques
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3.5 interdit qu'une politique relise sa propre table. Aucune de
-- celles du §6 ne le fait : celles de `budgets` lisent `tracks` par `app.can_read_track`, celles
-- de `budget_occurrences` lisent `budgets` par les deux fonctions ci-dessous.
--
-- LES DEUX FONCTIONS SONT `SECURITY DEFINER`, comme leurs sœurs de `CRM-020` et `CRM-082`, et
-- c'est la condition de la décision 27 : une fonction `invoker` appelée depuis la politique de
-- `budget_occurrences` rejouerait la RLS de `budgets` à chaque ligne, et la politique de
-- `budgets` rejouerait à son tour `app.can_read_track`. C'est la récursion mesurée à la
-- décision 27.

-- --- 5.1 Lecture d'un budget ------------------------------------------------------------------
-- LA RÈGLE DES TRACKS, SANS EXCEPTION (`docs/SPEC-costs.md` §3.1) : droits fins compris,
-- réouverture transitive comprise. `app.can_read_track` porte déjà toute cette mécanique
-- (`CRM-012`, `CRM-034`) ; la recopier ici la ferait diverger au premier ajustement des droits
-- fins.

create or replace function app.can_read_budget(budget uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.budgets b
		 where b.id = budget
		   and app.can_read_track(b.track_id)
	);
$$;

alter function app.can_read_budget(uuid) owner to postgres;

comment on function app.can_read_budget(uuid) is
	'CRM-084 — docs/SPEC-costs.md §3.1. Le budget est lisible par qui lit son track, droits fins '
	'appliqués.';

-- --- 5.2 Écriture d'un budget ------------------------------------------------------------------
-- L'ÉCRITURE EST RÉSERVÉE À L'ADMINISTRATEUR DU WORKSPACE, et non ouverte à tout membre écrivant
-- comme celle d'un tableau d'objectifs : arbitrage du responsable du 2026-08-19
-- (`docs/SPEC-costs.md` §3). « Le budget est un CADRE — décision de gestion ; l'affectation est
-- un GESTE quotidien. Les confondre bloquerait le travail ou ouvrirait la gestion. »
--
-- C'est donc la ligne de partage de tout le sous-système : ici, `app.is_workspace_admin` ;
-- en `CRM-085`, `app.can_write_card`. Une ligne de coût sera posée par quiconque travaille
-- l'affaire, l'enveloppe qui l'encadre par le seul administrateur.
--
-- LE DROIT FIN NE REMONTE PAS ICI, et c'est délibéré : un `track_members.access = 'write'` ouvre
-- le travail sur le track, pas sa gestion budgétaire. Le §3.2 nomme l'administrateur du
-- WORKSPACE, et cette fonction ne dit rien de plus. Le droit de LIRE reste, lui, entièrement
-- gouverné par les droits fins (§5.1) : un administrateur voit les budgets de tous les tracks
-- qu'il lit, et il n'en existe aucun qu'il ne lise pas.

create or replace function app.can_write_budget(budget uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.budgets b
		  join public.tracks t on t.id = b.track_id
		 where b.id = budget
		   and app.is_workspace_admin(t.workspace_id)
	);
$$;

alter function app.can_write_budget(uuid) owner to postgres;

comment on function app.can_write_budget(uuid) is
	'CRM-084 — docs/SPEC-costs.md §3.2. Seul un administrateur du workspace écrit un budget : le '
	'budget est un cadre, pas un geste quotidien.';

-- --- 5.3 Privilèges des deux fonctions ---------------------------------------------------------
-- `EXECUTE` est accordé à `anon` pour la même raison que dans `CRM-020` et `CRM-082` : une
-- politique RLS est évaluée avec les droits du rôle courant, et un appelant anonyme dépourvu
-- d'`EXECUTE` recevrait une **erreur de privilège** au lieu du refus silencieux attendu — une
-- table vide, jamais un aveu.

revoke all on function app.can_read_budget(uuid)  from public;
revoke all on function app.can_write_budget(uuid) from public;

grant execute on function app.can_read_budget(uuid)  to anon, authenticated, service_role;
grant execute on function app.can_write_budget(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 6. Row Level Security
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.7. Refus par défaut : la RLS est activée et aucune politique n'est
-- implicite.

alter table public.budgets            enable row level security;
alter table public.budget_occurrences enable row level security;

-- --- 6.1 `budgets` -----------------------------------------------------------------------------
-- Lecture : `app.can_read_track`. Écriture : `app.is_workspace_admin` sur le workspace du track.
--
-- LA POLITIQUE D'INSERTION NE PEUT PAS APPELER `app.can_write_budget` : la ligne n'existe pas
-- encore, et la fonction la cherche par son `id`. Elle remonte donc au track directement, ce qui
-- est la MÊME règle écrite au niveau où la donnée est disponible. Les trois autres actions
-- portent la même condition sous les deux formes, et la suite pgTAP les compare.

drop policy if exists budgets_lecture_track on public.budgets;
create policy budgets_lecture_track
	on public.budgets
	for select
	to anon, authenticated
	using (app.can_read_track(track_id));

drop policy if exists budgets_insertion_admin on public.budgets;
create policy budgets_insertion_admin
	on public.budgets
	for insert
	to authenticated
	with check (exists (
		select 1
		  from public.tracks t
		 where t.id = track_id
		   and app.is_workspace_admin(t.workspace_id)
	));

-- `using` ET `with check` portent la même condition : un administrateur ne peut pas DÉPLACER un
-- budget vers un track d'un workspace dont il n'est pas administrateur. Sans le `with check`, la
-- mise à jour de `track_id` serait une porte de sortie du cloisonnement.
drop policy if exists budgets_maj_admin on public.budgets;
create policy budgets_maj_admin
	on public.budgets
	for update
	to authenticated
	using      (app.can_write_budget(id))
	with check (exists (
		select 1
		  from public.tracks t
		 where t.id = track_id
		   and app.is_workspace_admin(t.workspace_id)
	));

-- LA SUPPRESSION EST OUVERTE À L'ADMINISTRATEUR, ET LA SPÉCIFICATION N'EST PAS CONTREDITE.
-- Le §3.2 pose qu'« un budget ne se supprime pas : il se clôture ». C'est une règle de PRODUIT,
-- que l'interface tient — l'administration des budgets n'offrira aucune commande de suppression
-- (§4.1) —, et que `CRM-085` rendra structurelle : `card_costs.budget_id` est `on delete
-- restrict`, si bien qu'un budget PORTANT des dépenses deviendra indestructible par la base
-- elle-même.
--
-- Interdire la suppression ici, en RLS, interdirait aussi de défaire une erreur de saisie sur un
-- budget vierge — créé une minute plus tôt, sans aucune ligne —, et l'on n'a pas de geste pour
-- cela : la clôture le garderait à l'écran, dans l'onglet des budgets clôturés, pour toujours.
drop policy if exists budgets_suppression_admin on public.budgets;
create policy budgets_suppression_admin
	on public.budgets
	for delete
	to authenticated
	using (app.can_write_budget(id));

-- --- 6.2 `budget_occurrences` ------------------------------------------------------------------
-- « L'appelant lit le budget » (`docs/SPEC-costs.md` §3.1) et « administrateur du workspace »
-- pour l'écriture (§3.2). Les deux conditions passent par les fonctions du §5, jamais par une
-- relecture de `budget_occurrences`.

drop policy if exists budget_occurrences_lecture_budget on public.budget_occurrences;
create policy budget_occurrences_lecture_budget
	on public.budget_occurrences
	for select
	to anon, authenticated
	using (app.can_read_budget(budget_id));

drop policy if exists budget_occurrences_insertion_admin on public.budget_occurrences;
create policy budget_occurrences_insertion_admin
	on public.budget_occurrences
	for insert
	to authenticated
	with check (app.can_write_budget(budget_id));

drop policy if exists budget_occurrences_maj_admin on public.budget_occurrences;
create policy budget_occurrences_maj_admin
	on public.budget_occurrences
	for update
	to authenticated
	using      (app.can_write_budget(budget_id))
	with check (app.can_write_budget(budget_id));

drop policy if exists budget_occurrences_suppression_admin on public.budget_occurrences;
create policy budget_occurrences_suppression_admin
	on public.budget_occurrences
	for delete
	to authenticated
	using (app.can_write_budget(budget_id));

-- =============================================================================================
-- 7. Privilèges explicites
-- =============================================================================================
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas
-- des privilèges par défaut de la distribution (même patron que `CRM-060` et `CRM-082`).

revoke all on public.budgets from anon, authenticated;
grant select                 on public.budgets to anon, authenticated;
grant insert, update, delete on public.budgets to authenticated;
grant all privileges         on public.budgets to service_role;

revoke all on public.budget_occurrences from anon, authenticated;
grant select                 on public.budget_occurrences to anon, authenticated;
grant insert, update, delete on public.budget_occurrences to authenticated;
grant all privileges         on public.budget_occurrences to service_role;

-- @spec CRM-035 (docs/BACKLOG.md) — définition des champs de formulaire et de leurs règles
-- @spec docs/SPEC-form-composer.md §2.2 (modèle des champs), §2.4 (options exigées),
--       §2.5 (clé et archivage), §2.6 (ordre), §2.7 (autorisations), §3.2 (modèle des règles),
--       §3.3 (ce que la base garantit structurellement)
-- @spec docs/SCHEMA.md §4 (formulaires conditionnels), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille de tables), §7 (preuves de refus)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes omises par les tableaux),
--       INC-033 et INC-037 (corrigées ensuite par `CRM-018`), INC-043 (`CRM-034` sans cible)
--
-- Le vocabulaire d'un formulaire. Le catalogue de `CRM-030` dit quels états ont un nom, un workflow
-- dit dans quel ordre une card les traverse, et ces deux tables disent **quelles questions** sont
-- posées à propos d'une card, et à quelle étape.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : les deux tables, l'appartenance d'un champ à son workflow et d'une règle au workflow
-- **commun** à son champ et à son étape, la liste fermée des quinze types, les options que deux
-- types ne peuvent pas omettre, l'unicité de la clé par workflow, l'attribution automatique de
-- `position` dans la portée du workflow, six politiques RLS, et les privilèges explicites — avec
-- l'asymétrie de suppression de la décision 96.
--
-- Non livré, et nommé :
--
--   * **toute obligation réelle**. `visibility = 'required'` est une **déclaration sans garde** :
--     ce qui l'applique est `move_card` (`CRM-034`), dont MESURÉ `to_regprocedure` rend `NULL`, et
--     qui n'a aucune cible — `cards` n'existe pas non plus (INC-043) ;
--
--   * **toute validation de valeur**. Les valeurs vivent dans `card_field_values` (`CRM-036`), qui
--     n'existe pas. Cette migration garantit que le **type déclaré** appartient à la liste, jamais
--     qu'une valeur lui correspond ;
--
--   * **la forme des entrées de `choices`** — `{key, label}` — et l'unicité des clés de choix. Un
--     `CHECK` ne peut porter aucune sous-requête, et déplier un tableau `jsonb` dans une contrainte
--     exigerait une fonction dont l'immutabilité serait à démontrer (décision 94, §2.4) ;
--
--   * **la copie des champs vers un track** dans cette version historique.
--     `copy_workflow_to_track` avait été écrite avant `form_fields` ; `CRM-018` la redéfinit après
--     cette migration pour copier et remapper le formulaire complet. INC-037 est ainsi fermée
--     sans rendre ce fichier dépendant d'une table qui n'existait pas encore à son époque ;
--
--   * les champs exigés par une transition. L'ancien `require_fields uuid[]` ne pouvait porter
--     aucune intégrité référentielle ; `CRM-018` crée la table de liaison une fois ces champs
--     disponibles. INC-033.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (`docs/JOURNAL.md`, décision 20). Tout est donc rejouable, et les
-- contraintes sont **convergentes** : une contrainte retirée ou affaiblie à la main est **réparée**
-- par un rejeu, et non simplement laissée telle quelle (décisions 57 et 78).

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Même outil qu'aux migrations 0006 et 0008, et pour le même motif : une contrainte nommée dont la
-- **définition** a été affaiblie à la main survit à tous les rejeux si l'on se contente de tester
-- la présence de son nom. La définition réelle est donc comparée à celle attendue, et la contrainte
-- n'est refaite que si elles diffèrent — un `drop`/`add` inconditionnel revaliderait la table et
-- reconstruirait l'index à chaque démarrage de la pile.
--
-- `search_path` vidé n'est pas ici une convention de style : `pg_get_constraintdef` rend les noms de
-- relations **selon le `search_path`**, et avec un chemin vide il les rend pleinement qualifiés. Les
-- deux côtés de la comparaison s'écrivent donc de la même façon.
--
-- La fonction est **retirée en fin de migration**, section 7.

create or replace function app.migration_0009_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
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

-- =============================================================================================
-- 1. `public.form_fields`
-- =============================================================================================
-- docs/SCHEMA.md §4, complété par les « Conventions générales » du même document pour
-- `workspace_id`, `created_at` et `updated_at`, que le tableau du §4 omet — cinquième occurrence du
-- même oubli (INC-025).

create table if not exists public.form_fields (
	id           uuid        primary key default gen_random_uuid(),
	workflow_id  uuid        not null,
	-- Dénormalisé pour que les politiques RLS restent simples et indexables, comme
	-- `workflow_steps.workspace_id`. Sa **véracité** n'est pas supposée : la clé composite de la
	-- section 1.2 la garantit.
	workspace_id uuid        not null,
	-- L'identifiant **durable** du champ : celui qu'un export, un filtre de vue sauvegardée ou un
	-- message d'erreur de `move_card` nomme. Même forme que les clés du catalogue de nœuds, par la
	-- même convention (docs/SPEC-form-composer.md §2.5).
	key          text        not null,
	label        text        not null,
	-- Liste **fermée** de quinze valeurs (§2.3). Colonne `text` avec `CHECK` et non type énuméré,
	-- comme partout ailleurs dans ce schéma : `docs/SCHEMA.md` réserve les types PostgreSQL aux
	-- énumérations **stables**, et celle-ci pourrait s'étendre par migration.
	--
	-- Trois de ces types — `user`, `contact`, `file` — désignent des objets dont deux n'existent pas
	-- encore. Déclarer le champ est licite dès maintenant ; **résoudre** sa valeur appartient à
	-- `CRM-036` et à `CRM-060`.
	type         text        not null,
	-- Objet JSON, jamais un tableau ni un scalaire. Deux types ne sont pas utilisables sans lui :
	-- `select`/`multiselect` exigent des `choices` non vides, `money` une `currency` (section 1.1,
	-- décision 94).
	options      jsonb       not null default '{}'::jsonb,
	help_text    text,
	-- `numeric` : index fractionnaire, comme partout ailleurs. Insérer un champ entre deux autres
	-- n'exigera pas de renuméroter le formulaire. `not null` **sans défaut de colonne** : le trigger
	-- de la section 3 la renseigne lorsqu'elle est omise.
	position     numeric     not null,
	-- Suppression douce, et **aucune suppression physique n'est exposée** (section 6). Les valeurs
	-- saisies survivent à l'archivage (docs/SPEC-form-composer.md §5) ; les effacer par cascade
	-- serait une perte de données silencieuse.
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- `docs/SCHEMA.md` §4 : « unique par workflow ». L'unicité est **totale**, et non partielle sur
	-- les champs actifs : un champ archivé **garde sa clé réservée**. Réattribuer la clé d'un champ
	-- archivé rendrait un export ambigu — deux questions différentes sous la même colonne — sans
	-- qu'aucune erreur ne le signale (décision 96).
	unique (workflow_id, key)
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------
-- Elles ne sont pas écrites dans le `create table` : celui-ci porte `if not exists`, et une
-- contrainte retirée à la main sur une base existante ne serait alors **jamais** rétablie par un
-- rejeu. La migration serait idempotente sans être réparatrice (décision 57).

alter table public.form_fields drop constraint if exists form_fields_key_check;
alter table public.form_fields add  constraint form_fields_key_check
	check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.form_fields drop constraint if exists form_fields_label_check;
alter table public.form_fields add  constraint form_fields_label_check
	check (btrim(label) <> '');

-- Un texte d'aide vide n'est pas une aide, c'est une colonne à effacer. Même raisonnement que
-- `workflow_steps.label_override` : `NULL` signifie « aucune aide », jamais « aide vide ».
alter table public.form_fields drop constraint if exists form_fields_help_text_check;
alter table public.form_fields add  constraint form_fields_help_text_check
	check (help_text is null or btrim(help_text) <> '');

alter table public.form_fields drop constraint if exists form_fields_type_check;
alter table public.form_fields add  constraint form_fields_type_check
	check (type in ('text', 'textarea', 'number', 'money', 'date', 'datetime',
	                'select', 'multiselect', 'checkbox', 'url', 'email', 'phone',
	                'user', 'contact', 'file'));

-- `options` est un **objet**. Un tableau ou un scalaire y serait un contrat que personne ne saurait
-- lire, et les deux contraintes suivantes n'auraient plus de sens.
alter table public.form_fields drop constraint if exists form_fields_options_objet_check;
alter table public.form_fields add  constraint form_fields_options_objet_check
	check (jsonb_typeof(options) = 'object');

-- DÉCISION 94, et ce qu'elle coûte. Le §2.3 dit « liste de choix définie dans `options` » : une
-- liste vide n'est pas un champ, c'est une impasse d'interface. Le prix est assumé — un `select`
-- naît avec au moins un choix, on ne peut pas créer la question puis ses réponses en deux gestes.
--
-- LE `coalesce` N'EST PAS UNE PRÉCAUTION DE STYLE : SANS LUI LA CONTRAINTE NE REFUSE RIEN.
-- DÉFAUT RÉEL, TROUVÉ PAR LA SUITE pgTAP DE CETTE UNITÉ ET CORRIGÉ ICI (décision 102). La première
-- écriture était `type not in (…) or (jsonb_typeof(options -> 'choices') = 'array' and …)`. Un
-- `select` dont `options` vaut `{}` — le **défaut de la colonne**, donc le cas le plus courant —
-- rend `options -> 'choices'` à `NULL`, donc `jsonb_typeof(NULL)` à `NULL`, donc la conjonction à
-- `NULL`, donc `false or NULL` à `NULL`. Et un `CHECK` qui rend `NULL` **passe**. La contrainte
-- refusait `{"choices": []}` et laissait passer l'absence pure, qui est pourtant le cas à refuser
-- en premier. MESURÉ : `not ok — caught: no exception, wanted: 23514`.
--
-- La comparaison de `jsonb` remplace `jsonb_array_length` pour une seconde raison : cette fonction
-- **lève une erreur** sur un scalaire (« cannot get array length of a scalar »), et l'ordre
-- d'évaluation d'un `AND` n'est pas garanti en SQL. Un `CHECK` ne doit jamais pouvoir échouer
-- autrement qu'en refusant la ligne.
alter table public.form_fields drop constraint if exists form_fields_choices_check;
alter table public.form_fields add  constraint form_fields_choices_check
	check (type not in ('select', 'multiselect')
	       or coalesce(jsonb_typeof(options -> 'choices') = 'array'
	                   and options -> 'choices' <> '[]'::jsonb, false));

-- Le §2.3 dit « `money` avec devise ». Un montant sans devise n'est pas un montant. Le format est
-- celui de l'ISO 4217, qui est ce que tout client attend d'un code de devise.
--
-- Même `coalesce`, même motif (décision 102) : `options ->> 'currency'` rend `NULL` lorsque la clé
-- est absente, l'expression régulière rend `NULL`, et la contrainte passait.
alter table public.form_fields drop constraint if exists form_fields_currency_check;
alter table public.form_fields add  constraint form_fields_currency_check
	check (type <> 'money'
	       or coalesce((options ->> 'currency') ~ '^[A-Z]{3}$', false));

-- --- 1.2 Les deux clés composites, et ce qu'elles garantissent --------------------------------
-- `(workflow_id, workspace_id)` : le champ appartient au workflow **et** le `workspace_id`
-- dénormalisé dit la vérité. Une clé simple laisserait un administrateur du workspace A rattacher
-- son champ à un workflow de B : aucune politique RLS ne rattraperait cela, une politique décidant
-- **qui écrit** la ligne, pas **ce que la ligne raconte** (décision 73).
--
-- `on delete cascade` — supprimer un workflow emporte ses champs, qui n'ont aucune existence hors
-- de lui.

select app.migration_0009_converger_contrainte(
	'public.form_fields', 'form_fields_workflow_id_workspace_id_fkey',
	'FOREIGN KEY (workflow_id, workspace_id) REFERENCES public.workflows(id, workspace_id) '
	'ON DELETE CASCADE');

-- L'unicité dont les règles ont besoin pour leur propre clé composite. Elle ne peut refuser aucune
-- ligne — `id` est déjà unique — et elle est la **condition** de la section 2.2. MESURÉ sur sonde :
-- sans elle, la création de `form_field_rules` échoue en `42830`, « there is no unique constraint
-- matching given keys for referenced table ». Troisième fois que ce geste est nécessaire, après
-- `workflows_id_workspace_id_key` et `workflow_steps_id_workflow_id_key`.
select app.migration_0009_converger_contrainte(
	'public.form_fields', 'form_fields_id_workflow_id_key',
	'UNIQUE (id, workflow_id)');

-- --- 1.3 Index -------------------------------------------------------------------------------
-- La question posée par tout formulaire : « les champs actifs de ce workflow, dans l'ordre ».
-- L'index partiel ne porte que les lignes réellement rendues.

create index if not exists form_fields_workflow_position_idx
	on public.form_fields (workflow_id, position)
	where archived_at is null;

drop trigger if exists form_fields_set_updated_at on public.form_fields;
create trigger form_fields_set_updated_at
	before update on public.form_fields
	for each row execute function app.set_updated_at();

comment on table public.form_fields is
	'CRM-035 — docs/SCHEMA.md §4. Les questions posées à propos d''une card, déclarées pour un '
	'**workflow**. Ce n''est pas une colonne : ajouter un champ n''exige aucune migration. Les '
	'valeurs vivent dans card_field_values (CRM-036).';
comment on column public.form_fields.workflow_id is
	'Le formulaire suit le workflow, jamais le channel : deux channels partageant un workflow '
	'partagent son formulaire (docs/SPEC-form-composer.md §2.1).';
comment on column public.form_fields.workspace_id is
	'Dénormalisé pour la RLS. Sa véracité est garantie par form_fields_workflow_id_workspace_id_fkey, '
	'et non supposée.';
comment on column public.form_fields.key is
	'Identifiant durable du champ, unique **par workflow**, y compris pour les champs archivés. '
	'C''est lui qu''un export nomme et que move_card (CRM-034) listera parmi les clés manquantes.';
comment on column public.form_fields.type is
	'Liste fermée de quinze valeurs. `user`, `contact` et `file` désignent des objets que CRM-036 '
	'et CRM-060 résoudront ; les déclarer est licite dès maintenant.';
comment on column public.form_fields.options is
	'Objet JSON. `select`/`multiselect` exigent `choices` non vide, `money` une `currency` ISO 4217. '
	'La forme de chaque entrée de `choices` n''est pas contrainte : décision 94.';
comment on column public.form_fields.position is
	'Ordre du champ **dans son formulaire**. Attribuée automatiquement si omise.';
comment on column public.form_fields.archived_at is
	'Non nul = archivé : retiré des formulaires, les valeurs saisies étant conservées. Aucune '
	'suppression physique n''est exposée (décision 96).';

-- =============================================================================================
-- 2. `public.form_field_rules`
-- =============================================================================================
-- La conditionnalité par étape. docs/SCHEMA.md §4, complété de `workflow_id`, `workspace_id` et des
-- horodatages — sixième occurrence de l'oubli d'INC-025 pour les deux derniers, et ajout **motivé**
-- pour le premier : voir la section 2.2.

create table if not exists public.form_field_rules (
	field_id     uuid        not null,
	step_id      uuid        not null,
	-- LA CHARNIÈRE. Ce n'est pas une commodité : c'est la colonne sans laquelle la table ne pourrait
	-- pas exprimer que le champ et l'étape appartiennent au **même** workflow, et qu'aucun trigger
	-- ne rattraperait aussi sûrement (décision 95).
	workflow_id  uuid        not null,
	workspace_id uuid        not null,
	visibility   text        not null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- docs/SCHEMA.md §4 : un couple champ × étape porte **au plus une** visibilité. Deux règles
	-- contradictoires sur le même couple sont structurellement impossibles.
	primary key (field_id, step_id)
);

-- --- 2.1 Contrainte de valeur ------------------------------------------------------------------
-- `hidden` n'est pas la valeur par défaut : l'**absence** de ligne l'est, et elle vaut `visible`
-- (docs/SPEC-form-composer.md §3.1). Aucune valeur par défaut n'est donc posée sur la colonne — une
-- règle écrite sans visibilité serait une règle qui ne dit rien.

alter table public.form_field_rules drop constraint if exists form_field_rules_visibility_check;
alter table public.form_field_rules add  constraint form_field_rules_visibility_check
	check (visibility in ('hidden', 'visible', 'required'));

-- --- 2.2 Les trois clés composites : une règle ne croise pas deux workflows --------------------
-- MESURÉ sur sonde, dans les **deux** sens. Une règle liant un champ du workflow A à une étape du
-- workflow B est refusée quel que soit le `workflow_id` déclaré :
--
--   * avec celui du champ  → `23503`, « Key (step_id, workflow_id)=(…) is not present in table
--     "workflow_steps" » ;
--   * avec celui de l'étape → `23503`, « Key (field_id, workflow_id)=(…) is not present in table
--     "form_fields" ».
--
-- Une des deux clés attrape toujours l'erreur ; il n'y a pas de troisième valeur à essayer. Un
-- trigger aurait rendu le même service, plus tard et moins sûrement (décision 73).
--
-- MESURÉ également : supprimer une étape emporte ses règles. C'est voulu — une règle portant sur
-- une étape disparue n'est pas une donnée à conserver, c'est une règle cassée.

select app.migration_0009_converger_contrainte(
	'public.form_field_rules', 'form_field_rules_field_id_workflow_id_fkey',
	'FOREIGN KEY (field_id, workflow_id) REFERENCES public.form_fields(id, workflow_id) '
	'ON DELETE CASCADE');

select app.migration_0009_converger_contrainte(
	'public.form_field_rules', 'form_field_rules_step_id_workflow_id_fkey',
	'FOREIGN KEY (step_id, workflow_id) REFERENCES public.workflow_steps(id, workflow_id) '
	'ON DELETE CASCADE');

-- Et le `workspace_id` dénormalisé dit la vérité, comme partout ailleurs.
select app.migration_0009_converger_contrainte(
	'public.form_field_rules', 'form_field_rules_workflow_id_workspace_id_fkey',
	'FOREIGN KEY (workflow_id, workspace_id) REFERENCES public.workflows(id, workspace_id) '
	'ON DELETE CASCADE');

-- La question posée par le rendu d'une étape : « les règles déclarées à cette étape ». La clé
-- primaire sert déjà la question symétrique, « les règles de ce champ ».
create index if not exists form_field_rules_step_idx
	on public.form_field_rules (step_id);

drop trigger if exists form_field_rules_set_updated_at on public.form_field_rules;
create trigger form_field_rules_set_updated_at
	before update on public.form_field_rules
	for each row execute function app.set_updated_at();

comment on table public.form_field_rules is
	'CRM-035 — docs/SCHEMA.md §4. Visibilité d''un champ à une étape. **L''absence de ligne vaut '
	'`visible`** : le formulaire d''une étape se lit en listant les champs du workflow puis en '
	'appliquant les règles trouvées, jamais en listant les règles de l''étape.';
comment on column public.form_field_rules.workflow_id is
	'Charnière des deux clés composites : c''est elle qui rend structurellement impossible une '
	'règle croisant deux workflows (docs/SPEC-form-composer.md §3.3, décision 95).';
comment on column public.form_field_rules.visibility is
	'`hidden`, `visible` ou `required`. `required` est une **déclaration** : ce qui l''applique est '
	'move_card (CRM-034), non commencée — INC-043.';

-- =============================================================================================
-- 3. Attribution automatique de `position`, dans la portée du workflow
-- =============================================================================================
-- docs/SPEC-form-composer.md §2.6. La portée est le **workflow**, comme pour `workflow_steps` : un
-- formulaire appartient à un workflow, non à un workspace ni à un track.
--
-- Propriété héritée de `CRM-020` et de `CRM-031`, vérifiée à nouveau plutôt que supposée : un
-- trigger `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait **omise** ou écrite
-- explicitement, et ne peut pas distinguer les deux cas.
--
-- Le maximum est pris **sans filtrer les champs archivés** : un champ archivé occupe toujours sa
-- position, et réutiliser la sienne mêlerait le champ neuf aux valeurs conservées lors d'un
-- désarchivage.
--
-- `SECURITY INVOKER` : la fonction ne lit que `form_fields`, table sur laquelle l'appelant a déjà
-- été autorisé par la politique d'insertion. Lui donner les droits du propriétaire serait un
-- privilège gratuit. `search_path` vidé, comme sur toute fonction du schéma `app`.

create or replace function app.form_fields_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(f.position), 0) + 1
			  from public.form_fields f
			 where f.workflow_id = new.workflow_id
		);
	end if;
	return new;
end;
$$;

comment on function app.form_fields_attribuer_position() is
	'CRM-035 — docs/SPEC-form-composer.md §2.6. Trigger BEFORE INSERT : place le champ en fin de '
	'formulaire **de son workflow** lorsque `position` est omise. Les champs archivés comptent.';

revoke all on function app.form_fields_attribuer_position() from public;

drop trigger if exists form_fields_attribuer_position on public.form_fields;
create trigger form_fields_attribuer_position
	before insert on public.form_fields
	for each row execute function app.form_fields_attribuer_position();

-- =============================================================================================
-- 4. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.form_fields      enable row level security;
alter table public.form_field_rules enable row level security;

-- --- 4.1 Lecture ------------------------------------------------------------------------------
-- docs/SPEC-permissions-rls.md §4 range les deux tables ensemble : lecture par les **membres du
-- workspace**. Aucun droit fin ne les gouverne — un formulaire appartient à un workflow, et un
-- workflow n'est ni un track ni un channel. La règle s'arrête au rôle de workspace **par
-- conception**, non par différé : aucune entrée d'incohérence n'est ouverte à ce titre,
-- contrairement à INC-024 et INC-030.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège.

drop policy if exists form_fields_lecture_membre on public.form_fields;
create policy form_fields_lecture_membre
	on public.form_fields for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));

drop policy if exists form_field_rules_lecture_membre on public.form_field_rules;
create policy form_field_rules_lecture_membre
	on public.form_field_rules for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));

comment on policy form_fields_lecture_membre on public.form_fields is
	'CRM-035 — lecture par les membres du workspace. Règle spécifiée, non un repli : aucun droit '
	'fin ne gouverne un formulaire.';

-- --- 4.2 Insertion et mise à jour, réservées aux administrateurs -------------------------------
-- docs/SPEC-permissions-rls.md §4 : écriture `admin`. Un `business_developer` **remplit** le
-- formulaire, il ne le dessine pas.
--
-- `USING` **et** `WITH CHECK` sur la mise à jour : `USING` décide si la ligne **avant** modification
-- est modifiable, `WITH CHECK` si la ligne **après** modification est acceptable. Sans le second, un
-- administrateur du workspace A pourrait déplacer une ligne vers B, où il n'a aucun droit.
--
-- MESURÉ aux unités précédentes, et vrai ici de la même façon : une écriture refusée par la clause
-- `USING` ne lève **aucune erreur** — PostgREST rend `200` ou `204` et ne modifie rien. Toute preuve
-- de refus doit donc relire la ligne et la constater **inchangée** (décision 70).

drop policy if exists form_fields_insertion_admin on public.form_fields;
create policy form_fields_insertion_admin
	on public.form_fields for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists form_fields_maj_admin on public.form_fields;
create policy form_fields_maj_admin
	on public.form_fields for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists form_field_rules_insertion_admin on public.form_field_rules;
create policy form_field_rules_insertion_admin
	on public.form_field_rules for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));

drop policy if exists form_field_rules_maj_admin on public.form_field_rules;
create policy form_field_rules_maj_admin
	on public.form_field_rules for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

-- --- 4.3 Suppression : ouverte aux règles, refusée aux champs ----------------------------------
-- docs/SPEC-form-composer.md §2.7, docs/JOURNAL.md décision 96. C'est la décision 74 appliquée une
-- seconde fois, et l'exception est écrite plutôt que silencieuse :
--
--   * un **champ** porte `archived_at`, et l'archivage tient lieu de suppression — même règle que
--     les tracks, les channels, le catalogue et les workflows. Aucune politique `for delete`, aucun
--     privilège : le refus est double. Supprimer un champ effacerait par cascade les valeurs
--     saisies, que l'archivage conserve ;
--   * une **règle** est la composition d'un formulaire, sans existence propre et sans `archived_at`.
--     Un éditeur qui ne peut pas retirer une règle ne peut pas éditer.

drop policy if exists form_field_rules_suppression_admin on public.form_field_rules;
create policy form_field_rules_suppression_admin
	on public.form_field_rules for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

comment on policy form_field_rules_suppression_admin on public.form_field_rules is
	'CRM-035 — la règle se supprime, le champ s''archive. Décision 96, qui reprend la décision 74 : '
	'une règle est la composition d''un formulaire, non un objet à durée de vie propre.';

-- =============================================================================================
-- 5. Privilèges explicites
-- =============================================================================================
-- Comme les unités précédentes, on ne s'en remet pas aux privilèges par défaut de l'image : ils
-- sont posés explicitement, de sorte que le comportement du produit ne dépende pas d'un réglage
-- susceptible de changer d'une version à l'autre.
--
-- Noter l'asymétrie, qui est la traduction de la décision 96 : `delete` est accordé sur les règles,
-- **jamais** sur les champs.

revoke all on public.form_fields      from anon, authenticated;
revoke all on public.form_field_rules from anon, authenticated;

grant select         on public.form_fields to anon, authenticated;
grant insert, update on public.form_fields to authenticated;

grant select                 on public.form_field_rules to anon, authenticated;
grant insert, update, delete on public.form_field_rules to authenticated;

grant all privileges on public.form_fields      to service_role;
grant all privileges on public.form_field_rules to service_role;

-- =============================================================================================
-- 6. Ce que la copie d'un workflow ne fait pas, et qui n'est pas corrigé ici
-- =============================================================================================
-- `copy_workflow_to_track` (`CRM-032`, migration 0007) copie les étapes et les transitions. Elle ne
-- copie **aucun champ** : elle a été écrite quand `form_fields` n'existait pas, et INC-037 prévoyait
-- déjà les deux branches possibles. Celle-ci est la branche « incorrecte » qu'elle annonçait : le
-- formulaire suit le workflow, donc une copie naît **sans formulaire**.
--
-- Le comportement reste **inchangé**. La corriger reviendrait à trancher l'arbitrage d'INC-037 à la
-- place du responsable et à rouvrir `CRM-032` — sa fonction, sa suite pgTAP, ses quinze scénarios
-- d'API et son harnais — dans un changement consacré à `CRM-035`, ce que `CLAUDE.md` §13 interdit.
--
-- L'écart n'est pas laissé à ce commentaire : il est **compté** par des assertions, dans
-- `supabase/tests/0008_copie_workflow.test.sql` et `scripts/verify-copie-workflow.sh`. Décision 93.

-- =============================================================================================
-- 7. La fonction d'assistance ne survit pas à la migration
-- =============================================================================================
-- Elle n'a de sens que le temps de ce fichier. La laisser dans le schéma `app` en ferait une
-- surface publique que rien ne documente, et qu'un appelant pourrait employer pour reconstruire
-- n'importe quelle contrainte de n'importe quelle table.

drop function if exists app.migration_0009_converger_contrainte(text, text, text);

-- PostgREST met son schéma en cache : sans ce signal, les tables nouvellement créées ne sont pas
-- visibles de l'API tant que le service n'a pas redémarré.
notify pgrst, 'reload schema';

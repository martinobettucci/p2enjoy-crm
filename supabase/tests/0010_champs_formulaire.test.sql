-- @verifies CRM-035 (docs/BACKLOG.md) — champs de formulaire et règles de visibilité
-- @verifies docs/SPEC-form-composer.md §2.2 (modèle des champs), §2.4 (options exigées),
--           §2.5 (clé et archivage), §2.6 (ordre), §2.7 (autorisations), §3.1 (valeur par défaut),
--           §3.2 (modèle des règles), §3.3 (garanties structurelles), §7.1 (preuves attendues)
-- @verifies docs/SCHEMA.md §4 (formulaires conditionnels), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §4 (politiques par famille de tables)
-- @verifies docs/SPEC-seed.md §2.10 (champs et règles du seed)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes omises), INC-033
--           (`require_fields` sans intégrité), INC-037 (la copie n'emporte pas les champs)
--
-- Suite pgTAP de l'unité `CRM-035`. Elle prouve sept choses :
--
--   1. la **forme** des deux tables : colonnes, nullabilité, clés primaires, unicités, index ;
--   2. les **contraintes de valeur** — les quinze types, les trois visibilités, la clé, le libellé,
--      et les deux exigences d'options que la décision 94 a posées ;
--   3. ce que les **clés composites** garantissent : une règle ne croise pas deux workflows, dans
--      les **deux** sens, et un champ ne rejoint pas un workflow d'un autre workspace ;
--   4. les **cascades** : supprimer une étape emporte ses règles, supprimer un champ aussi ;
--   5. l'**unicité de la clé par workflow**, totale — un champ archivé garde la sienne — et la même
--      clé acceptée dans un autre workflow ;
--   6. la **RLS**, les six politiques, et l'asymétrie de privilège de la décision 96 : aucun
--      `DELETE` sur les champs, `DELETE` sur les règles ;
--   7. la **conformité du seed**, et l'écart d'INC-037 **compté** : la source porte sept champs, la
--      copie de portée `track` n'en porte aucun.
--
-- Exécution : `npm run test:sql`, `scripts/verify-champs-formulaire.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0010_champs_formulaire.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Comme les suites précédentes, aucun
-- bloc n'emploie `rollback to savepoint` : une assertion prise dans un savepoint annulé est
-- **numérotée mais non comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

-- =============================================================================================
-- 1. Forme des deux tables
-- =============================================================================================

select has_table('public', 'form_fields', '`public.form_fields` existe');
select has_table('public', 'form_field_rules', '`public.form_field_rules` existe');

select has_column('public', 'form_fields', 'workspace_id',
	'`form_fields.workspace_id` existe — que `docs/SCHEMA.md` §4 omettait (INC-025, cinquième '
	'occurrence)');
select has_column('public', 'form_fields', 'created_at',
	'`form_fields.created_at` existe — même omission du même tableau');
select has_column('public', 'form_field_rules', 'workflow_id',
	'`form_field_rules.workflow_id` existe : la **charnière** des deux clés composites, sans '
	'laquelle une règle pourrait croiser deux workflows (décision 95)');

select col_is_pk('public', 'form_fields', 'id', '`form_fields.id` est la clé primaire');
select col_is_pk('public', 'form_field_rules', array['field_id', 'step_id'],
	'la clé primaire des règles est `(field_id, step_id)` : un couple champ × étape porte **au plus '
	'une** visibilité, deux règles contradictoires sont structurellement impossibles');

-- `position` est `not null` **sans défaut de colonne** : un défaut ferait de toute omission un `1`,
-- là où le trigger place le champ en fin de formulaire (§2.6).
select col_not_null('public', 'form_fields', 'position',
	'`form_fields.position` est non nulle');
select col_hasnt_default('public', 'form_fields', 'position',
	'`form_fields.position` n''a **aucun défaut de colonne** : le trigger la renseigne, et une '
	'omission reste une omission');
select col_has_default('public', 'form_fields', 'options',
	'`form_fields.options` a un défaut — `{}` : un champ sans options est le cas courant');

select has_index('public', 'form_fields', 'form_fields_workflow_position_idx',
	'l''index qui sert « les champs actifs de ce workflow, dans l''ordre » existe');
select has_index('public', 'form_field_rules', 'form_field_rules_step_idx',
	'l''index qui sert « les règles déclarées à cette étape » existe');

select has_trigger('public', 'form_fields', 'form_fields_attribuer_position',
	'le trigger d''attribution de `position` existe');
select has_function('app', 'form_fields_attribuer_position', array[]::text[],
	'la fonction `app.form_fields_attribuer_position` existe');

-- Une fonction dont le chemin de recherche est mutable est une surface d'attaque, `SECURITY
-- INVOKER` ou non.
select ok(
	(select coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'form_fields_attribuer_position'),
	'`app.form_fields_attribuer_position` a son `search_path` vidé');

-- La fonction d'assistance de la migration ne survit pas à celle-ci (section 7 de la migration).
select hasnt_function('app', 'migration_0009_converger_contrainte',
	array['text', 'text', 'text'],
	'`app.migration_0009_converger_contrainte` a été retirée : elle n''a de sens que le temps de la '
	'migration');

-- =============================================================================================
-- 2. Un terrain de mesure : deux workflows du même workspace, et un troisième workspace
-- =============================================================================================
-- Les objets du seed ne sont **jamais** modifiés : tout ce qui suit naît ici et meurt au `rollback`.

insert into public.workspaces (id, name, slug)
	values ('c8a11035-0000-4000-8000-000000000001', 'Atelier CRM-035', 'tst-crm035');
insert into public.workspaces (id, name, slug)
	values ('c8a11035-0000-4000-8000-000000000002', 'Atelier CRM-035 bis', 'tst-crm035-bis');

insert into public.workflows (id, workspace_id, name)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001', 'WF A');
insert into public.workflows (id, workspace_id, name)
	values ('c8a11035-0000-4000-8000-000000000012', 'c8a11035-0000-4000-8000-000000000001', 'WF B');
insert into public.workflows (id, workspace_id, name)
	values ('c8a11035-0000-4000-8000-000000000013', 'c8a11035-0000-4000-8000-000000000002',
	        'WF workspace étranger');

insert into public.workflow_nodes_catalog (id, workspace_id, key, label)
	values ('c8a11035-0000-4000-8000-000000000021', 'c8a11035-0000-4000-8000-000000000001',
	        'depart', 'Départ');
insert into public.workflow_nodes_catalog (id, workspace_id, key, label)
	values ('c8a11035-0000-4000-8000-000000000022', 'c8a11035-0000-4000-8000-000000000001',
	        'arrivee', 'Arrivée');

-- Une étape dans A, une étape dans B : de quoi croiser.
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, is_initial)
	values ('c8a11035-0000-4000-8000-000000000031', 'c8a11035-0000-4000-8000-000000000011',
	        'c8a11035-0000-4000-8000-000000000001', 'c8a11035-0000-4000-8000-000000000021', true);
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, is_initial)
	values ('c8a11035-0000-4000-8000-000000000032', 'c8a11035-0000-4000-8000-000000000012',
	        'c8a11035-0000-4000-8000-000000000001', 'c8a11035-0000-4000-8000-000000000021', true);

-- =============================================================================================
-- 3. Contraintes de valeur
-- =============================================================================================

select lives_ok($$
	insert into public.form_fields (id, workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000011',
	        'c8a11035-0000-4000-8000-000000000001', 'budget-cible', 'Budget cible', 'text', 1)
$$, 'un champ conforme est accepté');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'sirene', 'Numéro SIRENE', 'siret', 1)
$$, '23514', null, 'un `type` hors des quinze valeurs est refusé');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'Budget_Cible', 'Budget', 'text', 1)
$$, '23514', null, 'une `key` hors de la forme des slugs est refusée');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'sans-libelle', '   ', 'text', 1)
$$, '23514', null, 'un libellé vide ou blanc est refusé');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, help_text, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'aide-vide', 'Aide vide', 'text', '  ', 1)
$$, '23514', null,
	'un `help_text` blanc est refusé : `NULL` signifie « aucune aide », jamais « aide vide »');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'liste', 'Liste', 'text', '[1,2]'::jsonb, 1)
$$, '23514', null, '`options` doit être un **objet** JSON, jamais un tableau');

-- DÉCISION 94 : les deux exigences d'options, mesurées dans les deux sens.
select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'origine', 'Origine', 'select', 1)
$$, '23514', null, 'un `select` sans `choices` est refusé : une liste vide est une impasse');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'origine', 'Origine', 'select', '{"choices": []}'::jsonb, 1)
$$, '23514', null, 'un `select` dont `choices` est **vide** est refusé, et pas seulement absent');

select lives_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'origine', 'Origine', 'select',
	        '{"choices": [{"key": "salon", "label": "Salon"}]}'::jsonb, 2)
$$, 'un `select` avec un choix est accepté');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'montant', 'Montant', 'money', 1)
$$, '23514', null, 'un `money` sans `currency` est refusé : un montant sans devise n''en est pas un');

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'montant', 'Montant', 'money', '{"currency": "euro"}'::jsonb, 1)
$$, '23514', null, 'une `currency` hors du format ISO 4217 est refusée');

select lives_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'montant', 'Montant', 'money', '{"currency": "EUR"}'::jsonb, 3)
$$, 'un `money` avec une devise ISO 4217 est accepté');

-- Ce que la base **ne** vérifie **pas**, et que la spécification nomme plutôt que de le taire
-- (§2.4) : la forme des entrées de `choices`. Figé par une assertion, de sorte que le jour où
-- `CRM-036` la contraindra, ce test devienne rouge et exige sa révision.
select lives_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'choix-informe', 'Choix informe', 'select', '{"choices": ["salon", 42]}'::jsonb, 4)
$$, 'ÉCART NOMMÉ (§2.4) : la **forme** des entrées de `choices` n''est pas contrainte par la base — '
	'un `CHECK` ne peut porter aucune sous-requête');

-- =============================================================================================
-- 4. Unicité de la clé, totale par workflow
-- =============================================================================================

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'budget-cible', 'Budget cible bis', 'text', 9)
$$, '23505', null, 'la même `key` deux fois dans le **même** workflow est refusée');

select lives_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000012', 'c8a11035-0000-4000-8000-000000000001',
	        'budget-cible', 'Budget cible de B', 'text', 1)
$$, 'la même `key` dans un **autre** workflow est acceptée : l''unicité est par workflow');

-- DÉCISION 96 : un champ archivé garde sa clé réservée. L'unicité est totale, non partielle.
update public.form_fields set archived_at = now()
 where id = 'c8a11035-0000-4000-8000-000000000041';

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'budget-cible', 'Budget cible, nouvelle version', 'text', 9)
$$, '23505', null,
	'un champ **archivé** garde sa clé réservée : la réattribuer rendrait un export ambigu sans '
	'qu''aucune erreur ne le signale (décision 96)');

update public.form_fields set archived_at = null
 where id = 'c8a11035-0000-4000-8000-000000000041';

-- =============================================================================================
-- 5. `position` attribuée dans la portée du **workflow**
-- =============================================================================================
-- Le maximum est pris **sans filtrer les champs archivés** : un champ archivé occupe toujours sa
-- position, et la réutiliser mêlerait le champ neuf aux valeurs conservées lors d'un désarchivage.

insert into public.form_fields (id, workflow_id, workspace_id, key, label, type)
	values ('c8a11035-0000-4000-8000-000000000051', 'c8a11035-0000-4000-8000-000000000011',
	        'c8a11035-0000-4000-8000-000000000001', 'sans-position', 'Sans position', 'text');

select is(
	(select position from public.form_fields
	  where id = 'c8a11035-0000-4000-8000-000000000051'),
	5::numeric,
	'`position` omise est attribuée en fin de formulaire — 5, après les quatre champs de A');

insert into public.form_fields (id, workflow_id, workspace_id, key, label, type)
	values ('c8a11035-0000-4000-8000-000000000052', 'c8a11035-0000-4000-8000-000000000012',
	        'c8a11035-0000-4000-8000-000000000001', 'sans-position', 'Sans position', 'text');

select is(
	(select position from public.form_fields
	  where id = 'c8a11035-0000-4000-8000-000000000052'),
	2::numeric,
	'la portée est le **workflow** : dans B, le compte repart de ses propres champs');

-- =============================================================================================
-- 6. Un champ ne rejoint pas un workflow d'un autre workspace
-- =============================================================================================
-- La clé composite, et non une politique : une politique décide **qui écrit** la ligne, pas **ce
-- que la ligne raconte** (décision 73).

select throws_ok($$
	insert into public.form_fields (workflow_id, workspace_id, key, label, type, position)
	values ('c8a11035-0000-4000-8000-000000000013', 'c8a11035-0000-4000-8000-000000000001',
	        'etranger', 'Champ étranger', 'text', 1)
$$, '23503', null,
	'un champ dont le `workspace_id` ment sur celui de son workflow est refusé par la clé composite');

-- =============================================================================================
-- 7. Les règles, et ce que les clés composites rendent impossible
-- =============================================================================================

select lives_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000031',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'required')
$$, 'une règle liant un champ et une étape du **même** workflow est acceptée');

select throws_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000031',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'hidden')
$$, '23505', null,
	'un second couple champ × étape identique est refusé : au plus une visibilité par couple');

select throws_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000031',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'obligatoire')
$$, '23514', null, 'une `visibility` hors des trois valeurs est refusée');

-- LE CROISEMENT, DANS LES DEUX SENS. C'est la garantie centrale de la décision 95 : quel que soit
-- le `workflow_id` déclaré, l'une des deux clés composites attrape l'erreur. Il n'y a pas de
-- troisième valeur à essayer.
select throws_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000032',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'required')
$$, '23503', null,
	'champ de A, étape de B, `workflow_id` = A : refusé par la clé des **étapes**');

select throws_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000041', 'c8a11035-0000-4000-8000-000000000032',
	        'c8a11035-0000-4000-8000-000000000012', 'c8a11035-0000-4000-8000-000000000001',
	        'required')
$$, '23503', null,
	'champ de A, étape de B, `workflow_id` = B : refusé par la clé des **champs**. Le croisement '
	'est structurellement impossible, pas seulement surveillé');

select throws_ok($$
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000051', 'c8a11035-0000-4000-8000-000000000031',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000002',
	        'visible')
$$, '23503', null,
	'une règle dont le `workspace_id` ment sur celui de son workflow est refusée');

-- =============================================================================================
-- 8. Cascades
-- =============================================================================================

insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	values ('c8a11035-0000-4000-8000-000000000051', 'c8a11035-0000-4000-8000-000000000031',
	        'c8a11035-0000-4000-8000-000000000011', 'c8a11035-0000-4000-8000-000000000001',
	        'hidden');

delete from public.workflow_steps where id = 'c8a11035-0000-4000-8000-000000000031';

select is(
	(select count(*)::int from public.form_field_rules
	  where step_id = 'c8a11035-0000-4000-8000-000000000031'),
	0,
	'supprimer une étape emporte ses règles : une règle sur une étape disparue est une règle cassée');

select is(
	(select count(*)::int from public.form_fields
	  where id = 'c8a11035-0000-4000-8000-000000000041'),
	1,
	'…et n''emporte **pas** les champs : un champ appartient au workflow, non à l''étape');

delete from public.workflows where id = 'c8a11035-0000-4000-8000-000000000012';

select is(
	(select count(*)::int from public.form_fields
	  where workflow_id = 'c8a11035-0000-4000-8000-000000000012'),
	0,
	'supprimer un workflow emporte ses champs, qui n''ont aucune existence hors de lui');

-- =============================================================================================
-- 9. Refus par défaut, politiques et privilèges
-- =============================================================================================

select ok(
	(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'form_fields'),
	'RLS est activée sur `form_fields`');
select ok(
	(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'form_field_rules'),
	'RLS est activée sur `form_field_rules`');

select policies_are('public', 'form_fields',
	array['form_fields_lecture_membre', 'form_fields_insertion_admin', 'form_fields_maj_admin'],
	'`form_fields` porte exactement trois politiques — et **aucune** `for delete` : l''archivage '
	'tient lieu de suppression (décision 96)');

select policies_are('public', 'form_field_rules',
	array['form_field_rules_lecture_membre', 'form_field_rules_insertion_admin',
	      'form_field_rules_maj_admin', 'form_field_rules_suppression_admin'],
	'`form_field_rules` porte quatre politiques, dont la suppression : une règle est la composition '
	'd''un formulaire, non un objet à durée de vie propre');

-- L'asymétrie de privilège, qui double le refus. Une politique absente ne suffirait pas : sans
-- privilège, PostgREST refuse **avant** toute politique.
select ok(
	not has_table_privilege('authenticated', 'public.form_fields', 'DELETE'),
	'`authenticated` n''a **aucun** privilège `DELETE` sur `form_fields` : le refus est double');
select ok(
	has_table_privilege('authenticated', 'public.form_field_rules', 'DELETE'),
	'`authenticated` a le privilège `DELETE` sur `form_field_rules` — la politique décide ensuite');
select ok(
	has_table_privilege('anon', 'public.form_fields', 'SELECT'),
	'`anon` a le privilège `SELECT` : le refus se manifeste par **zéro ligne**, jamais par une '
	'erreur de privilège (docs/SPEC-permissions-rls.md §7)');
select ok(
	not has_table_privilege('anon', 'public.form_fields', 'INSERT'),
	'`anon` n''a aucun privilège d''écriture sur `form_fields`');

-- =============================================================================================
-- 10. Conformité du seed, et l'écart d'INC-037 **compté**
-- =============================================================================================

select is(
	(select count(*)::int from public.form_fields
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	7,
	'le seed pose sept champs sur le workflow par défaut — docs/SPEC-seed.md §2.10');

select is(
	(select count(*)::int from public.form_fields
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and archived_at is not null),
	1,
	'…dont **un archivé**, sans quoi l''état « archivé » serait documenté sans être démontrable');

select is(
	(select count(distinct type)::int from public.form_fields
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	7,
	'sept types distincts, dont les deux — `money` et `select` — dont la base exige des options');

select is(
	(select count(*)::int from public.form_field_rules
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	15,
	'le seed pose quinze règles de visibilité');

select is(
	(select array_agg(distinct visibility order by visibility) from public.form_field_rules
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	array['hidden', 'required', 'visible'],
	'les **trois** visibilités sont exercées par des données réelles, `visible` comprise — sans '
	'quoi rien ne distinguerait « déclaré facultatif » de « non déclaré »');

-- La valeur par défaut du §3.1 : l'absence de règle vaut `visible`. Elle n'est démontrée que si des
-- couples champ × étape restent réellement sans règle.
select is(
	(select count(*)::int
	   from public.form_fields f
	   cross join public.workflow_steps s
	   left join public.form_field_rules r
	          on r.field_id = f.id and r.step_id = s.id
	  where f.workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and s.workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and f.archived_at is null
	    and r.field_id is null),
	27,
	'vingt-sept couples champ × étape restent **sans règle** : c''est ce qui démontre la valeur par '
	'défaut `visible` du §3.1');

select is(
	(select count(*)::int from public.form_field_rules r
	   join public.form_fields f on f.id = r.field_id
	  where f.archived_at is not null),
	0,
	'le champ archivé du seed n''a aucune règle : l''archivage ne demande aucun ménage');

-- INC-037, MESURÉE ET CHIFFRÉE. Cette assertion remplace le `hasnt_table('form_fields')` que
-- `CRM-032` avait posé : la table existe désormais, et ce qui reste à constater est **l'écart**.
-- Elle deviendra rouge le jour où la copie des champs sera écrite, forçant sa révision.
select is(
	(select count(*)::int from public.form_fields f
	   join public.workflows w on w.id = f.workflow_id
	  where w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	0,
	'INC-037 : la copie de portée `track` porte **zéro** champ là où sa source en porte sept — '
	'`copy_workflow_to_track` n''en copie aucun, et le comportement reste inchangé (décision 93)');

-- INC-033 : `require_fields` pourrait désormais désigner des champs réels. Il ne le fait pas, et le
-- motif a changé — aucune garde ne le lit, `move_card` étant `CRM-034` (INC-043).
select is(
	(select count(*)::int from public.workflow_transitions
	  where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and cardinality(require_fields) > 0),
	0,
	'INC-033 : `require_fields` reste vide, non plus faute de champs mais faute de garde qui le '
	'lise — `move_card` est CRM-034, non commencée');

rollback;

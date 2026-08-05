-- @verifies CRM-031 (docs/BACKLOG.md) — workflows, étapes, transitions : structure, ordre, droits
-- @verifies docs/SPEC-workflow-engine.md §3.2 (workflows), §3.3 (étapes), §3.4 (transitions),
--           §3.5 (étape initiale), §3.6 (ordre), §3.7 (autorisations)
-- @verifies docs/SCHEMA.md §2 (channels.workflow_id), §3 (workflows), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 2, n° 3, n° 11)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-029 (clé étrangère livrée, NOT NULL différée),
--           INC-031 (garde d'archivage, moitié du chemin), INC-033 (`require_fields` sans FK)
--
-- Suite pgTAP de l'unité `CRM-031`. Elle prouve sept choses :
--
--   1. la **structure** des trois tables : colonnes, types, contraintes, index, triggers ;
--   2. la **cohérence de portée** : `scope` et `track_id` ne peuvent pas se contredire, et le track
--      d'un workflow appartient à son workspace — garanti par une clé composite, pas surveillé ;
--   3. l'**étape initiale** : au plus une par workflow, ce que la base peut tenir ; et l'autre
--      moitié de l'exigence, qui ne lui est pas imposable (décision 72) ;
--   4. l'**enfermement des transitions** : une arête ne sort pas de son workflow, refus mesuré en
--      `23503` par la clé composite ;
--   5. l'**ordre** : `position` attribuée par le trigger dans la portée du **workflow**, et non du
--      workspace comme pour le catalogue ;
--   6. les **autorisations**, éprouvées contre des comptes réels avec les revendications JWT
--      simulées exactement comme PostgREST les pose, y compris la suppression — ouverte aux étapes
--      et aux transitions, refusée aux workflows ;
--   7. les **écarts figés par des assertions** : `cards` n'existe pas (INC-031), la contrainte
--      `NOT NULL` de `channels.workflow_id` n'est pas posée (INC-029), et `require_fields` ne porte
--      aucune clé étrangère (INC-033). Chacune deviendra rouge le jour où l'état changera.
--
-- Exécution : `npm run test:sql`, `scripts/verify-workflows.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0007_workflows.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes, ni les workspaces de test ne subsistent.
--
-- MESURÉ, et cela a dicté l'écriture de la section 10 : une assertion exécutée dans un savepoint
-- ensuite annulé est **numérotée mais non comptée** par pgTAP — ses résultats vivent dans une table
-- sujette à la même annulation, alors que la numérotation, portée par une séquence, poursuit. Le
-- plan annoncé n'est alors jamais tenu, et `scripts/run-sql-tests.sh` refuse la suite à juste titre
-- (« plan annoncé N, M assertions émises »). Les blocs d'autorisation ne roulent donc **rien** en
-- arrière : ils rendent la main au rôle superutilisateur et défont explicitement leurs écritures.

begin;

create extension if not exists pgtap with schema extensions;

select plan(107);

-- =============================================================================================
-- 1. Structure — docs/SCHEMA.md §3, docs/SPEC-workflow-engine.md §3.2 à §3.4
-- =============================================================================================

select has_table('public', 'workflows',            'la table `public.workflows` existe');
select has_table('public', 'workflow_steps',       'la table `public.workflow_steps` existe');
select has_table('public', 'workflow_transitions', 'la table `public.workflow_transitions` existe');

select columns_are(
	'public', 'workflows',
	array['id', 'workspace_id', 'name', 'scope', 'track_id', 'derived_from_workflow_id',
	      'derived_at', 'is_default', 'archived_at', 'created_at', 'updated_at'],
	'`workflows` porte exactement les colonnes de docs/SPEC-workflow-engine.md §3.2'
);

select columns_are(
	'public', 'workflow_steps',
	array['id', 'workflow_id', 'workspace_id', 'node_id', 'position', 'label_override',
	      'probability_override', 'stale_after_days', 'is_initial', 'created_at', 'updated_at'],
	'`workflow_steps` porte exactement les colonnes du §3.3'
);

select columns_are(
	'public', 'workflow_transitions',
	array['id', 'workflow_id', 'workspace_id', 'from_step_id', 'to_step_id', 'label',
	      'require_comment', 'require_fields', 'created_at', 'updated_at'],
	'`workflow_transitions` porte exactement les colonnes du §3.4'
);

select col_is_pk('public', 'workflows', 'id', '`workflows.id` est la clé primaire');
select col_is_pk('public', 'workflow_steps', 'id', '`workflow_steps.id` est la clé primaire');
select col_is_pk('public', 'workflow_transitions', 'id',
	'`workflow_transitions.id` est la clé primaire');

select col_type_is('public', 'workflow_steps', 'position', 'numeric',
	'`position` est `numeric` : un index fractionnaire, comme partout ailleurs');
select col_type_is('public', 'workflow_steps', 'probability_override', 'numeric(5,2)',
	'`probability_override` reprend le type du catalogue, deux décimales comprises');
select col_type_is('public', 'workflow_transitions', 'require_fields', 'uuid[]',
	'`require_fields` est un tableau d''uuid, comme docs/SCHEMA.md §3 le décrit');

select col_not_null('public', 'workflow_steps', 'workspace_id',
	'`workflow_steps.workspace_id` est non nul : la RLS s''y adosse');
select col_not_null('public', 'workflow_transitions', 'workspace_id',
	'`workflow_transitions.workspace_id` est non nul');
select col_not_null('public', 'workflow_transitions', 'require_fields',
	'`require_fields` est non nul : un tableau vide, jamais `NULL`');
select col_has_default('public', 'workflow_transitions', 'require_fields',
	'`require_fields` a pour défaut le tableau vide');

-- Nullables **à dessein** : `NULL` signifie « prendre la valeur du catalogue », jamais « zéro ».
-- Même distinction qu'au §2.5 du catalogue, et même conséquence sur toute moyenne.
select col_is_null('public', 'workflow_steps', 'label_override',
	'`label_override` est nullable : l''absence de surcharge n''est pas un libellé vide');
select col_is_null('public', 'workflow_steps', 'probability_override',
	'`probability_override` est nullable : ne pas surcharger diffère de surcharger à 0');
select col_is_null('public', 'workflow_steps', 'stale_after_days',
	'`stale_after_days` est nullable');

-- INC-025, QUATRIÈME OCCURRENCE : `docs/SCHEMA.md` §3 n'énumère pas ces colonnes, alors que ses
-- conventions générales les exigent de toute table métier.
select col_not_null('public', 'workflows', 'created_at',
	'INC-025 : `workflows.created_at` est livrée et non nulle');
select col_not_null('public', 'workflows', 'updated_at', 'INC-025 : `workflows.updated_at` aussi');
select col_not_null('public', 'workflow_steps', 'created_at',
	'INC-025 : `workflow_steps.created_at` est livrée');
select col_not_null('public', 'workflow_transitions', 'created_at',
	'INC-025 : `workflow_transitions.created_at` est livrée');

select col_hasnt_default('public', 'workflow_steps', 'position',
	'`position` n''a **aucun défaut de colonne** : c''est le trigger qui la renseigne, ce qui '
	'laisse une valeur explicite intacte');

select has_index('public', 'workflows', 'workflows_workspace_default_uk',
	'index unique partiel : au plus un workflow par défaut par workspace');
select has_index('public', 'workflow_steps', 'workflow_steps_workflow_initial_uk',
	'index unique partiel : au plus une étape initiale par workflow');
select has_index('public', 'workflow_steps', 'workflow_steps_workflow_position_idx',
	'index de l''ordre des colonnes du board');

select has_trigger('public', 'workflows', 'workflows_set_updated_at',
	'`workflows.updated_at` est maintenue par un trigger');
select has_trigger('public', 'workflow_steps', 'workflow_steps_attribuer_position',
	'`position` est attribuée par un trigger');
select has_function('app', 'workflow_steps_attribuer_position',
	'la fonction du trigger d''ordre existe');

-- =============================================================================================
-- 2. Les écarts figés par des assertions
-- =============================================================================================
-- INC-031 : la garde d'archivage d'un nœud occupé traverse `workflow_steps` — livrée ici — et
-- `cards`. Les deux assertions qui suivent ont été écrites pour devenir rouges le jour où `cards`
-- arriverait ; elles l'ont fait à `CRM-040`, et sont RÉVISÉES ici plutôt que retirées (décision 51).
-- La garde existe désormais, et son comportement est prouvé par
-- supabase/tests/0012_cards.test.sql §9 — cette suite se borne à constater qu'elle a été écrite.

select has_table('public', 'cards',
	'INC-031 : `cards` est livrée par `CRM-040`, et le chemin de la garde d''archivage est complet');

select is(
	(select count(*)::int from pg_trigger
	  where tgrelid = 'public.workflow_nodes_catalog'::regclass and not tgisinternal),
	3,
	'INC-031 : trois triggers sur le catalogue — `updated_at`, `position`, et la garde d''archivage '
	'que `CRM-040` a écrite en même temps que sa cible (décision 111)');

-- INC-029 : la clé étrangère est livrée, la contrainte `NOT NULL` ne l'est pas — elle change le
-- contrat de création d'un channel et revient à `CRM-033`.
select ok(
	exists (select 1 from pg_constraint
	         where conname = 'channels_workflow_id_workspace_id_fkey'
	           and conrelid = 'public.channels'::regclass),
	'INC-029 levée pour la clé étrangère : `channels.workflow_id` est enfin référencée, et de '
	'façon **composite** — le workflow d''un channel appartient à son workspace');

-- Révisée par `CRM-033`, qui a soldé INC-029 : l'assertion constatait la colonne nullable et
-- annonçait qu'elle deviendrait rouge le jour où la contrainte serait posée. Elle l'est devenue, et
-- elle est révisée plutôt que supprimée (décision 51, sixième occurrence).
select col_not_null('public', 'channels', 'workflow_id',
	'INC-029 SOLDÉE par `CRM-033` : `channels.workflow_id` est **obligatoire**, comme '
	'docs/SCHEMA.md §2 l''exige depuis l''origine');

-- INC-033 : aucune clé étrangère ne peut partir d'une colonne tableau. Ce n'est pas un différé,
-- c'est une propriété du type — l'assertion le fige pour que personne ne la croie oubliée.
select is(
	(select count(*)::int from pg_constraint
	  where conrelid = 'public.workflow_transitions'::regclass
	    and contype = 'f'),
	3,
	'INC-033 : exactement trois clés étrangères sur les transitions — le workflow et les deux '
	'étapes. Aucune ne part de `require_fields` : PostgreSQL refuse une clé étrangère depuis un '
	'tableau, et cela ne changera pas quand `form_fields` existera');

-- GARDE-FOU RÉVISÉ PAR `CRM-035`, NON RETIRÉ (mécanisme de la décision 51, septième occurrence).
-- Il constatait que `form_fields` n'existait pas. La table existe désormais, et ce qui doit être
-- constaté a changé deux fois : à `CRM-035`, `require_fields` **pouvait** désigner des champs
-- réels et restait vide, faute de garde qui le lise ; à `CRM-036`, la sixième vérification de
-- `move_card` la lit, et le seed en porte une (décision 97, puis décision 123).
select has_table('public', 'form_fields',
	'`form_fields` existe depuis `CRM-035` : l''assertion d''absence posée ici a été révisée, non '
	'retirée');

-- RÉVISÉE À `CRM-036`, NON RETIRÉE — mécanisme de la décision 51. Le motif du vide a disparu :
-- la sixième vérification de `move_card` LIT désormais cette colonne, et une donnée qu'une garde
-- exerce n'est plus une décoration. Le seed en porte exactement UNE, sur « Démarrer la
-- réalisation ». L'assertion COMPTE plutôt que de constater le vide, de sorte qu'une seconde
-- posée sans preuve la fasse rougir à son tour.
select is(
	(select count(*)::int from public.workflow_transitions
	  where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and cardinality(require_fields) > 0),
	1,
	'INC-033 : `require_fields` porte UNE entrée dans le seed depuis `CRM-036` — non plus faute de '
	'champs, mais parce que la sixième vérification de `move_card` la LIT désormais. Aucune '
	'intégrité référentielle n''est possible sur un `uuid[]` — INC-033, propriété du type');

-- =============================================================================================
-- 3. Fixtures
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	('88880000-0000-4000-8000-000000000001', 'Atelier WF A', 'atelier-wf-a'),
	('88880000-0000-4000-8000-000000000002', 'Atelier WF B', 'atelier-wf-b');

insert into public.tracks (id, workspace_id, slug, name, position) values
	('88880000-0000-4000-8000-0000000000a1', '88880000-0000-4000-8000-000000000001',
	 'track-a', 'Track A', 1),
	('88880000-0000-4000-8000-0000000000a2', '88880000-0000-4000-8000-000000000002',
	 'track-b', 'Track B', 1);

insert into public.workflow_nodes_catalog (id, workspace_id, key, label, position) values
	('88880000-0000-4000-8000-0000000000b1', '88880000-0000-4000-8000-000000000001',
	 'depart', 'Départ', 1),
	('88880000-0000-4000-8000-0000000000b2', '88880000-0000-4000-8000-000000000001',
	 'milieu', 'Milieu', 2),
	('88880000-0000-4000-8000-0000000000b3', '88880000-0000-4000-8000-000000000001',
	 'fin', 'Fin', 3),
	('88880000-0000-4000-8000-0000000000b4', '88880000-0000-4000-8000-000000000001',
	 'annexe', 'Annexe', 4),
	('88880000-0000-4000-8000-0000000000b9', '88880000-0000-4000-8000-000000000002',
	 'depart', 'Départ B', 1);

-- =============================================================================================
-- 4. `workflows` : portée, dérivation, défaut — docs/SPEC-workflow-engine.md §3.2
-- =============================================================================================

select lives_ok(
	$$insert into public.workflows (id, workspace_id, name)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          'Global A')$$,
	'un workflow `global` sans track est accepté — c''est le défaut de la colonne `scope`');

select lives_ok(
	$$insert into public.workflows (id, workspace_id, name, scope, track_id)
	  values ('88880000-0000-4000-8000-0000000000c2', '88880000-0000-4000-8000-000000000001',
	          'Track A', 'track', '88880000-0000-4000-8000-0000000000a1')$$,
	'un workflow `track` avec son track est accepté');

select throws_ok(
	$$insert into public.workflows (workspace_id, name, scope, track_id)
	  values ('88880000-0000-4000-8000-000000000001', 'Global fautif', 'global',
	          '88880000-0000-4000-8000-0000000000a1')$$,
	'23514', null,
	'un workflow `global` portant un `track_id` est refusé : personne ne saurait dire s''il est '
	'disponible pour tout le workspace ou pour un seul track');

select throws_ok(
	$$insert into public.workflows (workspace_id, name, scope)
	  values ('88880000-0000-4000-8000-000000000001', 'Track sans track', 'track')$$,
	'23514', null, 'un workflow `track` sans `track_id` est refusé');

select throws_ok(
	$$insert into public.workflows (workspace_id, name, scope)
	  values ('88880000-0000-4000-8000-000000000001', 'Portée inconnue', 'departemental')$$,
	'23514', null, 'une portée hors de `global` / `track` est refusée');

select throws_ok(
	$$insert into public.workflows (workspace_id, name)
	  values ('88880000-0000-4000-8000-000000000001', '   ')$$,
	'23514', null,
	'un nom réduit à des blancs est refusé : `not null` seul ne l''aurait pas attrapé');

-- LE POINT DÉCISIF DE LA SECTION. Une clé étrangère simple aurait accepté cette ligne, et aucune
-- politique RLS ne l'aurait rattrapée : une politique décide **qui écrit** la ligne, pas **ce que
-- la ligne raconte** (docs/JOURNAL.md, décision 73).
select throws_ok(
	$$insert into public.workflows (workspace_id, name, scope, track_id)
	  values ('88880000-0000-4000-8000-000000000001', 'Track étranger', 'track',
	          '88880000-0000-4000-8000-0000000000a2')$$,
	'23503', null,
	'un workflow ne peut pas se rattacher au track d''un **autre** workspace : la clé étrangère '
	'est composite');

-- Au plus un défaut par workspace, et « au plus » et non « exactement » : un workspace neuf n'a
-- aucun workflow.
select lives_ok(
	$$update public.workflows set is_default = true
	   where id = '88880000-0000-4000-8000-0000000000c1'$$,
	'un premier workflow par défaut est accepté');

select throws_ok(
	$$update public.workflows set is_default = true
	   where id = '88880000-0000-4000-8000-0000000000c2'$$,
	'23505', null,
	'un second workflow par défaut dans le même workspace est refusé');

select lives_ok(
	$$insert into public.workflows (workspace_id, name, is_default)
	  values ('88880000-0000-4000-8000-000000000002', 'Défaut de B', true)$$,
	'un autre workspace a son propre workflow par défaut : l''unicité est **par workspace**');

-- La dérivation est une trace, et une trace incomplète n'en est pas une.
select throws_ok(
	$$insert into public.workflows (workspace_id, name, derived_from_workflow_id)
	  values ('88880000-0000-4000-8000-000000000001', 'Copie sans date',
	          '88880000-0000-4000-8000-0000000000c1')$$,
	'23514', null, 'une origine de copie sans date de copie est refusée');

select throws_ok(
	$$insert into public.workflows (workspace_id, name, derived_at)
	  values ('88880000-0000-4000-8000-000000000001', 'Date sans origine', now())$$,
	'23514', null, 'une date de copie sans origine est refusée');

select throws_ok(
	$$update public.workflows
	     set derived_from_workflow_id = id, derived_at = now()
	   where id = '88880000-0000-4000-8000-0000000000c1'$$,
	'23514', null,
	'un workflow ne dérive pas de lui-même : la clé étrangère l''accepterait, la contrainte le '
	'refuse');

-- =============================================================================================
-- 5. `workflow_steps` : instanciation, unicité, étape initiale — §3.3, §3.5
-- =============================================================================================

select lives_ok(
	$$insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position,
	                                     is_initial)
	  values ('88880000-0000-4000-8000-0000000000d1', '88880000-0000-4000-8000-0000000000c1',
	          '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000b1',
	          1, true)$$,
	'une étape initiale est acceptée');

select lives_ok(
	$$insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000d2', '88880000-0000-4000-8000-0000000000c1',
	          '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000b2', 2)$$,
	'une étape ordinaire est acceptée');

select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b1', 3)$$,
	'23505', null,
	'le même nœud ne s''instancie pas deux fois dans un workflow — docs/SCHEMA.md §3');

select lives_ok(
	$$insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position,
	                                     is_initial)
	  values ('88880000-0000-4000-8000-0000000000d3', '88880000-0000-4000-8000-0000000000c2',
	          '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000b1',
	          1, true)$$,
	'le même nœud s''instancie dans un **autre** workflow : c''est ce qui rend l''analytique '
	'comparable d''un channel à l''autre');

select lives_ok(
	$$insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000d4', '88880000-0000-4000-8000-0000000000c2',
	          '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000b2', 2)$$,
	'et un second nœud, pour que ce workflow porte une arête à son tour');

select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, is_initial)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 4, true)$$,
	'23505', null,
	'AU PLUS UNE ÉTAPE INITIALE par workflow : la seconde est refusée par l''index unique partiel');

-- L'AUTRE MOITIÉ DE L'EXIGENCE, et la raison pour laquelle elle n'est pas imposée ici. Mesuré sur
-- une sonde : un `constraint trigger` différé accepte l'insertion isolée d'un workflow puis fait
-- échouer le `commit` — donc rendrait la création impossible par l'API, une requête PostgREST
-- valant une transaction. Un workflow sans étape initiale est un **brouillon**
-- (docs/SPEC-workflow-engine.md §3.5, docs/JOURNAL.md décision 72).
select lives_ok(
	$$insert into public.workflows (id, workspace_id, name)
	  values ('88880000-0000-4000-8000-0000000000c9', '88880000-0000-4000-8000-000000000001',
	          'Brouillon sans étape')$$,
	'un workflow SANS aucune étape est accepté : « au moins une étape initiale » n''est pas '
	'imposable à l''écriture, c''est une condition d''emploi (décision 72)');

-- Le nœud instancié appartient au workspace du workflow, garanti par la clé composite.
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b9', 9)$$,
	'23503', null,
	'une étape ne peut pas instancier un nœud du catalogue d''un **autre** workspace');

-- Les surcharges reprennent les bornes du catalogue : une surcharge ne doit pas pouvoir exprimer
-- ce que le nœud lui-même ne pourrait pas.
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position,
	                                     probability_override)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 5, 100.01)$$,
	'23514', null, 'une probabilité surchargée au-delà de 100 est refusée');

select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position,
	                                     stale_after_days)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 5, 0)$$,
	'23514', null,
	'un seuil de relance surchargé à zéro est refusé : il signalerait toute card dès son arrivée');

select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position,
	                                     label_override)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 5, '   ')$$,
	'23514', null,
	'un libellé surchargé réduit à des blancs est refusé : ce n''est pas une surcharge, c''est une '
	'colonne à effacer');

-- Le `workspace_id` dénormalisé ne peut pas mentir : la clé composite l'interdit.
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000002',
	          '88880000-0000-4000-8000-0000000000b9', 6)$$,
	'23503', null,
	'un `workspace_id` qui ne serait pas celui du workflow est refusé : la dénormalisation est '
	'**garantie**, pas supposée');

-- =============================================================================================
-- 6. Ordre des étapes — §3.6
-- =============================================================================================
-- La portée est le **workflow**, et non le workspace comme pour le catalogue, ni le track comme
-- pour les channels : l'ordre servi est celui des colonnes d'un board.

savepoint avant_ordre;

insert into public.workflow_steps (workflow_id, workspace_id, node_id)
	values ('88880000-0000-4000-8000-0000000000c9', '88880000-0000-4000-8000-000000000001',
	        '88880000-0000-4000-8000-0000000000b1');
insert into public.workflow_steps (workflow_id, workspace_id, node_id)
	values ('88880000-0000-4000-8000-0000000000c9', '88880000-0000-4000-8000-000000000001',
	        '88880000-0000-4000-8000-0000000000b2');

select is(
	(select array_agg(position order by position)::text
	   from public.workflow_steps where workflow_id = '88880000-0000-4000-8000-0000000000c9'),
	'{1,2}',
	'deux insertions sans `position` dans un workflow vide rendent 1 puis 2');

insert into public.workflow_steps (workflow_id, workspace_id, node_id)
	values ('88880000-0000-4000-8000-0000000000c2', '88880000-0000-4000-8000-000000000001',
	        '88880000-0000-4000-8000-0000000000b3');

select is(
	(select max(position)::text from public.workflow_steps
	  where workflow_id = '88880000-0000-4000-8000-0000000000c2'),
	'3',
	'l''ordre est attribué **dans la portée du workflow** : une insertion dans un autre workflow '
	'ne poursuit pas la numérotation du premier');

-- Un trigger `BEFORE INSERT` ne distingue pas une colonne omise d'une colonne écrite à `NULL`.
insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	values ('88880000-0000-4000-8000-0000000000c9', '88880000-0000-4000-8000-000000000001',
	        '88880000-0000-4000-8000-0000000000b3', null);

select is(
	(select max(position)::text from public.workflow_steps
	  where workflow_id = '88880000-0000-4000-8000-0000000000c9'),
	'3',
	'écrire `position: null` équivaut à l''omettre : le trigger ne peut pas distinguer les deux');

select lives_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b4', 42)$$,
	'une `position` explicite est conservée : le trigger ne l''écrase pas');

select is(
	(select position::text from public.workflow_steps
	  where workflow_id = '88880000-0000-4000-8000-0000000000c1'
	    and node_id = '88880000-0000-4000-8000-0000000000b4'),
	'42', 'et elle vaut exactement la valeur fournie');

rollback to savepoint avant_ordre;

-- =============================================================================================
-- 7. `workflow_transitions` : enfermement, cycles, unicité — §3.4
-- =============================================================================================

select lives_ok(
	$$insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id,
	                                           to_step_id, label)
	  values ('88880000-0000-4000-8000-0000000000e1', '88880000-0000-4000-8000-0000000000c1',
	          '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000d1',
	          '88880000-0000-4000-8000-0000000000d2', 'Avancer')$$,
	'une transition entre deux étapes du même workflow est acceptée');

select lives_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id,
	                                           label)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d2', '88880000-0000-4000-8000-0000000000d1',
	          'Revenir')$$,
	'LE CYCLE EST AUTORISÉ : A → B et B → A coexistent. Un workflow n''est pas un graphe acyclique');

select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d1', '88880000-0000-4000-8000-0000000000d2')$$,
	'23505', null, 'la même arête n''est pas déclarée deux fois');

select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d1', '88880000-0000-4000-8000-0000000000d1')$$,
	'23514', null,
	'une transition d''une étape vers elle-même est refusée : ce n''est pas un déplacement');

-- LE POINT DÉCISIF DE LA SECTION : une transition ne sort pas de son workflow, et c'est
-- structurel. L'étape ci-dessous existe, mais dans le workflow `c2`.
select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	  select '88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	         '88880000-0000-4000-8000-0000000000d1', s.id
	    from public.workflow_steps s
	   where s.workflow_id = '88880000-0000-4000-8000-0000000000c2' limit 1$$,
	'23503', null,
	'une transition dont l''étape cible appartient à un **autre** workflow est refusée : la clé '
	'étrangère est composite `(step_id, workflow_id)`');

-- MESURÉ, et contraire à l'attente : lorsqu'une ligne viole **à la fois** une contrainte de valeur
-- et une unicité, c'est la contrainte de valeur qui parle — `23514`, et non `23505`. L'assertion
-- avait d'abord été écrite dans l'autre sens et a **échoué**, ce qui a établi le fait. Il compte :
-- une preuve future qui attendrait un conflit d'unicité sur une ligne par ailleurs invalide
-- échouerait pour une raison sans rapport avec ce qu'elle croit vérifier.
select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id,
	                                           label)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d2', '88880000-0000-4000-8000-0000000000d1',
	          '   ')$$,
	'23514', null,
	'un libellé réduit à des blancs est refusé — et il l''est **avant** l''unicité, que cette même '
	'ligne viole pourtant aussi : la contrainte de valeur parle la première');

-- Supprimer une étape emporte ses arêtes : une arête vers une étape disparue est cassée, pas
-- conservable.
savepoint avant_cascade;
delete from public.workflow_steps where id = '88880000-0000-4000-8000-0000000000d2';
select is(
	(select count(*)::int from public.workflow_transitions
	  where workflow_id = '88880000-0000-4000-8000-0000000000c1'),
	0,
	'supprimer une étape emporte les deux arêtes qui la touchaient');
rollback to savepoint avant_cascade;

-- Supprimer un workflow emporte ses étapes et ses arêtes ; c'est ce que `on delete cascade` dit.
savepoint avant_cascade_wf;
delete from public.workflows where id = '88880000-0000-4000-8000-0000000000c1';
select is(
	(select count(*)::int from public.workflow_steps
	  where workflow_id = '88880000-0000-4000-8000-0000000000c1'),
	0, 'supprimer un workflow emporte ses étapes');
rollback to savepoint avant_cascade_wf;

-- `require_fields` accepte n'importe quel uuid : c'est précisément ce qu'INC-033 nomme.
select lives_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id,
	                                           require_fields)
	  values ('88880000-0000-4000-8000-0000000000c2', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d3', '88880000-0000-4000-8000-0000000000d4',
	          array['99999999-9999-4999-8999-999999999999'::uuid])$$,
	'INC-033 : un identifiant de champ qui ne désigne rien est **accepté** dans `require_fields`. '
	'Aucune intégrité référentielle n''est possible sur un tableau, et l''écart est ici mesuré '
	'plutôt que commenté');

-- =============================================================================================
-- 8. Le nœud d'une étape ne se supprime pas sous elle
-- =============================================================================================
-- `on delete restrict` et non `cascade` : le catalogue n'expose aucune suppression, mais si une
-- purge en supprimait un, l'effacement silencieux des étapes qui l'instancient détruirait des
-- workflows entiers sans le dire.

select throws_ok(
	$$delete from public.workflow_nodes_catalog
	   where id = '88880000-0000-4000-8000-0000000000b1'$$,
	'23503', null,
	'supprimer un nœud instancié par une étape est refusé : `on delete restrict`');

-- =============================================================================================
-- 9. Politiques et privilèges — docs/SPEC-permissions-rls.md §4, §3.7
-- =============================================================================================

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflows'),
	3, '`workflows` porte trois politiques : lecture, insertion, mise à jour');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflow_steps'),
	4, '`workflow_steps` en porte quatre : la suppression s''y ajoute');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflow_transitions'),
	4, '`workflow_transitions` en porte quatre également');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflows' and cmd = 'DELETE'),
	0,
	'AUCUNE politique de suppression sur `workflows` : un workflow s''archive, il ne se supprime '
	'pas — même règle que les tracks, les channels et le catalogue');

select ok(
	not has_table_privilege('authenticated', 'public.workflows', 'DELETE'),
	'et le privilège `DELETE` n''est pas davantage accordé : le refus est double');

select ok(
	has_table_privilege('authenticated', 'public.workflow_steps', 'DELETE'),
	'`DELETE` **est** accordé sur les étapes : un éditeur qui ne peut pas retirer une colonne ne '
	'peut pas éditer (décision 74)');

select ok(
	has_table_privilege('authenticated', 'public.workflow_transitions', 'DELETE'),
	'`DELETE` est accordé sur les transitions, pour la même raison');

select ok(
	has_table_privilege('anon', 'public.workflows', 'SELECT'),
	'`anon` a le privilège `SELECT` : son refus doit venir de la politique, donc valoir zéro ligne '
	'et non une erreur de privilège');

select ok(
	not has_table_privilege('anon', 'public.workflows', 'INSERT'),
	'`anon` n''a aucun privilège d''écriture');

select ok(
	not has_table_privilege('anon', 'public.workflow_steps', 'DELETE'),
	'`anon` ne peut pas davantage supprimer une étape');

-- =============================================================================================
-- 10. Autorisations éprouvées contre des comptes réels
-- =============================================================================================
-- Revendications JWT simulées **exactement** comme PostgREST les pose : `request.jwt.claims` en
-- réglage local, rôle applicatif endossé par `set local role`. Même procédé que les suites `0002`,
-- `0004`, `0005` et `0006`.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
	('99990000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'wf-admin-a@exemple.test', '{"full_name": "Admin WF A"}'),
	('99990000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'wf-viewer-a@exemple.test', '{"full_name": "Viewer WF A"}'),
	('99990000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'wf-bizdev-a@exemple.test', '{"full_name": "Bizdev WF A"}'),
	('99990000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'wf-admin-b@exemple.test', '{"full_name": "Admin WF B"}');

insert into public.workspace_members (workspace_id, user_id, role) values
	('88880000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-00000000000a', 'admin'),
	('88880000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-00000000000b', 'viewer'),
	('88880000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-00000000000c',
	 'business_developer'),
	('88880000-0000-4000-8000-000000000002', '99990000-0000-4000-8000-00000000000d', 'admin');

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role anon';
end;
$$;

-- --- 10.1 Lecture ------------------------------------------------------------------------------
-- MESURÉ, et c'est la raison pour laquelle ces blocs n'emploient PAS `rollback to savepoint` :
-- une assertion exécutée dans un savepoint ensuite annulé est **numérotée mais non comptée** par
-- pgTAP, dont les résultats vivent dans une table sujette à la même annulation. Le plan annoncé ne
-- serait alors jamais tenu, et `scripts/run-sql-tests.sh` le refuserait à juste titre. Les blocs
-- qui suivent n'annulent donc rien : ils rendent la main au rôle superutilisateur, et défont
-- explicitement ce qu'ils ont écrit.

select pg_temp.endosser('99990000-0000-4000-8000-00000000000a');
select ok(
	(select count(*) from public.workflows
	  where workspace_id = '88880000-0000-4000-8000-000000000001') > 0,
	'un administrateur du workspace A lit les workflows de A');
select is(
	(select count(*)::int from public.workflows
	  where workspace_id = '88880000-0000-4000-8000-000000000002'),
	0,
	'PREUVE DE REFUS N° 3 : le membre du workspace A ne voit aucun workflow de B — et B en a un, '
	'inséré plus haut avec la clé de service');
select ok(
	(select count(*) from public.workflow_steps) > 0,
	'il lit également les étapes de son workspace');
select ok(
	(select count(*) from public.workflow_transitions) > 0,
	'et les transitions');
reset role;

select pg_temp.endosser('99990000-0000-4000-8000-00000000000b');
select ok(
	(select count(*) from public.workflows
	  where workspace_id = '88880000-0000-4000-8000-000000000001') > 0,
	'un `viewer` lit les workflows de son workspace : lire n''exige pas d''écrire');
reset role;

select pg_temp.anonyme();
select is(
	(select count(*)::int from public.workflows),
	0,
	'PREUVE DE REFUS N° 11 : l''appelant anonyme lit **zéro** workflow, alors que la table n''est '
	'pas vide. Le refus est calme — aucune erreur de privilège');
select is(
	(select count(*)::int from public.workflow_steps), 0,
	'zéro étape pour l''anonyme');
select is(
	(select count(*)::int from public.workflow_transitions), 0,
	'zéro transition pour l''anonyme');
reset role;

-- --- 10.2 Écriture -----------------------------------------------------------------------------

select pg_temp.endosser('99990000-0000-4000-8000-00000000000a');
select lives_ok(
	$$insert into public.workflows (id, workspace_id, name)
	  values ('88880000-0000-4000-8000-0000000000cf', '88880000-0000-4000-8000-000000000001',
	          'Écrit par l''administrateur')$$,
	'un administrateur crée un workflow dans son workspace');
select throws_ok(
	$$insert into public.workflows (workspace_id, name)
	  values ('88880000-0000-4000-8000-000000000002', 'Écrit chez le voisin')$$,
	'42501', null,
	'mais pas dans un autre workspace : le `WITH CHECK` de la politique d''insertion refuse');
reset role;
delete from public.workflows where id = '88880000-0000-4000-8000-0000000000cf';

select pg_temp.endosser('99990000-0000-4000-8000-00000000000c');
select throws_ok(
	$$insert into public.workflows (workspace_id, name)
	  values ('88880000-0000-4000-8000-000000000001', 'Écrit par le bizdev')$$,
	'42501', null,
	'PREUVE DE REFUS N° 2 : un `business_developer` ne crée aucun workflow — il travaille dans un '
	'workflow, il ne le dessine pas');
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 8)$$,
	'42501', null, 'ni aucune étape');
select throws_ok(
	$$insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000d2', '88880000-0000-4000-8000-0000000000d1')$$,
	'42501', null, 'ni aucune transition');

-- Une mise à jour refusée par le `USING` ne lève **aucune erreur** : elle porte sur zéro ligne
-- (décision 70). La preuve relit donc la ligne et la constate inchangée.
update public.workflows set name = 'Renommé par le bizdev'
 where id = '88880000-0000-4000-8000-0000000000c1';
reset role;
select is(
	(select name from public.workflows where id = '88880000-0000-4000-8000-0000000000c1'),
	'Global A',
	'PREUVE DE REFUS N° 2, suite : le renommage par un `business_developer` ne lève pas d''erreur '
	'— il ne modifie **rien**, et la ligne est relue inchangée');

select pg_temp.endosser('99990000-0000-4000-8000-00000000000a');
select throws_ok(
	$$update public.workflows set workspace_id = '88880000-0000-4000-8000-000000000002'
	   where id = '88880000-0000-4000-8000-0000000000c1'$$,
	'42501', null,
	'le `WITH CHECK` interdit à un administrateur de A de déplacer son workflow vers B — refus que '
	'le `USING` seul aurait laissé passer');
reset role;

-- --- 10.3 Suppression --------------------------------------------------------------------------

select pg_temp.endosser('99990000-0000-4000-8000-00000000000a');
select lives_ok(
	$$delete from public.workflow_transitions
	   where id = '88880000-0000-4000-8000-0000000000e1'$$,
	'un administrateur retire une arête de son workflow');
select is(
	(select count(*)::int from public.workflow_transitions
	  where id = '88880000-0000-4000-8000-0000000000e1'),
	0, 'et elle a bien disparu');
reset role;

-- L'arête est rétablie avec la clé de service, pour que la preuve suivante porte sur une arête
-- réellement présente : sans elle, « le bizdev n'a rien supprimé » serait vrai pour la mauvaise
-- raison.
insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id, to_step_id,
                                         label)
	values ('88880000-0000-4000-8000-0000000000e1', '88880000-0000-4000-8000-0000000000c1',
	        '88880000-0000-4000-8000-000000000001', '88880000-0000-4000-8000-0000000000d1',
	        '88880000-0000-4000-8000-0000000000d2', 'Avancer');

select pg_temp.endosser('99990000-0000-4000-8000-00000000000c');
delete from public.workflow_transitions where id = '88880000-0000-4000-8000-0000000000e1';
reset role;
select is(
	(select count(*)::int from public.workflow_transitions
	  where id = '88880000-0000-4000-8000-0000000000e1'),
	1,
	'un `business_developer` ne supprime aucune arête : la suppression porte sur zéro ligne, et '
	'l''arête est **relue présente**');

select pg_temp.endosser('99990000-0000-4000-8000-00000000000a');
select throws_ok(
	$$delete from public.workflows where id = '88880000-0000-4000-8000-0000000000c1'$$,
	'42501', null,
	'même un administrateur ne supprime pas un workflow : aucun privilège `DELETE`, le refus se '
	'manifeste avant même la politique');
reset role;

-- --- 10.4 L'administrateur d'un autre workspace ------------------------------------------------

select pg_temp.endosser('99990000-0000-4000-8000-00000000000d');
select throws_ok(
	$$insert into public.workflow_steps (workflow_id, workspace_id, node_id, position)
	  values ('88880000-0000-4000-8000-0000000000c1', '88880000-0000-4000-8000-000000000001',
	          '88880000-0000-4000-8000-0000000000b3', 7)$$,
	'42501', null,
	'un administrateur du workspace B n''ajoute aucune étape à un workflow de A : être '
	'administrateur quelque part n''ouvre rien ailleurs');
reset role;

select * from finish();
rollback;

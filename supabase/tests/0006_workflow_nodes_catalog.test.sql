-- @verifies CRM-030 (docs/BACKLOG.md) — catalogue de nœuds : structure, ordre, archivage, droits
-- @verifies docs/SPEC-workflow-engine.md §2.2 (modèle), §2.3 (clé stable), §2.4 (ordre),
--           §2.5 (probabilité et seuil), §2.6 (archivage), §2.7 (autorisations)
-- @verifies docs/SCHEMA.md §3 (workflows), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et n° 11)
-- @verifies docs/DESIGN_SYSTEM.md §1 (couleurs de données)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-031 (garde d'archivage différée)
--
-- Suite pgTAP de l'unité `CRM-030`. Elle prouve six choses :
--
--   1. la **structure** : colonnes, types, contraintes de valeur, index partiel, unicité de la clé
--      **par workspace** ;
--   2. les **bornes**, y compris celle qui surprend : `numeric(5,2)` arrondit avant que la
--      contrainte ne soit évaluée, si bien que `99.999` est accepté et stocké `100.00` ;
--   3. l'**ordre** : `position` attribuée par le trigger dans la portée du **workspace**, et non
--      du track comme pour `channels` ;
--   4. l'**archivage** : doux, réversible, sans suppression physique exposée ;
--   5. les **autorisations**, éprouvées contre des comptes réels avec les revendications JWT
--      simulées exactement comme PostgREST les pose ;
--   6. l'**écart figé par des assertions** : la garde qui refuse d'archiver un nœud occupé n'est
--      pas livrable, ses tables cibles n'existant pas (INC-031). Trois assertions `hasnt_table`
--      deviendront rouges à `CRM-031` et à `CRM-040`, et forceront l'écriture de la garde plutôt
--      que de laisser l'omission dériver en silence (docs/JOURNAL.md, décisions 51 et 66).
--
-- Exécution : `npm run test:sql`, `scripts/verify-catalogue.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0006_workflow_nodes_catalog.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes, ni les workspaces de test ne subsistent.

begin;

create extension if not exists pgtap with schema extensions;

select plan(80);

-- =============================================================================================
-- 1. Structure — docs/SCHEMA.md §3, docs/SPEC-workflow-engine.md §2.2
-- =============================================================================================

select has_table('public', 'workflow_nodes_catalog',
	'la table `public.workflow_nodes_catalog` existe');

select columns_are(
	'public', 'workflow_nodes_catalog',
	array['id', 'workspace_id', 'key', 'label', 'kind', 'color', 'default_probability',
	      'default_stale_after_days', 'position', 'archived_at', 'created_at', 'updated_at'],
	'le catalogue porte exactement les colonnes de docs/SPEC-workflow-engine.md §2.2'
);

select col_is_pk('public', 'workflow_nodes_catalog', 'id',
	'`workflow_nodes_catalog.id` est la clé primaire');

select col_type_is('public', 'workflow_nodes_catalog', 'position', 'numeric',
	'`position` est `numeric` : un index fractionnaire, comme `tracks.position`');
select col_type_is('public', 'workflow_nodes_catalog', 'default_probability', 'numeric(5,2)',
	'`default_probability` est `numeric(5,2)` — deux décimales, comme docs/SCHEMA.md §3 l''exige');
select col_type_is('public', 'workflow_nodes_catalog', 'default_stale_after_days', 'integer',
	'`default_stale_after_days` est un entier de jours');

select col_not_null('public', 'workflow_nodes_catalog', 'workspace_id', '`workspace_id` est non nul');
select col_not_null('public', 'workflow_nodes_catalog', 'key',   '`key` est non nulle');
select col_not_null('public', 'workflow_nodes_catalog', 'label', '`label` est non nul');
select col_not_null('public', 'workflow_nodes_catalog', 'kind',  '`kind` est non nul');
select col_not_null('public', 'workflow_nodes_catalog', 'color', '`color` est non nulle');
select col_not_null('public', 'workflow_nodes_catalog', 'position',
	'`position` est non nulle — le trigger la renseigne, elle n''est jamais absente');

-- Nullable **à dessein**, et l'assertion le dit : `0` n'est pas `NULL`. « Perdu à coup sûr » et
-- « aucune signification prévisionnelle » sont deux états différents, et les confondre rendrait
-- toute moyenne fausse (docs/SPEC-workflow-engine.md §2.5).
select col_is_null('public', 'workflow_nodes_catalog', 'default_probability',
	'`default_probability` est **nullable** : un nœud peut ne pas se prononcer, ce qui diffère de '
	'se prononcer à 0');
select col_is_null('public', 'workflow_nodes_catalog', 'default_stale_after_days',
	'`default_stale_after_days` est nullable : un nœud terminal n''a pas de seuil de relance');

-- INC-025, TROISIÈME OCCURRENCE. `docs/SCHEMA.md` §3 n'énumère pas ces colonnes, alors que ses
-- conventions générales les exigent de toute table. Le même oubli avait été relevé pour `tracks`
-- et `channels`.
select col_not_null('public', 'workflow_nodes_catalog', 'created_at',
	'INC-025 : `created_at` est livrée et non nulle, comme les conventions générales l''exigent');
select col_not_null('public', 'workflow_nodes_catalog', 'updated_at',
	'INC-025 : `updated_at` est livrée et non nulle');

select col_has_default('public', 'workflow_nodes_catalog', 'kind',
	'`kind` a un défaut — `open`, l''état de travail ordinaire');
select col_has_default('public', 'workflow_nodes_catalog', 'color',
	'`color` a un défaut — `neutral`, et non `brand` : un nœud sans couleur choisie ne revendique '
	'pas celle de la marque');
select col_hasnt_default('public', 'workflow_nodes_catalog', 'position',
	'`position` n''a **aucun défaut de colonne** : c''est le trigger qui la renseigne, ce qui '
	'laisse une valeur explicite intacte');

-- L'index sert la seule question que le catalogue et tout sélecteur de nœud posent : « les nœuds
-- non archivés de ce workspace, dans l'ordre ». Partiel, il ne porte que les lignes réellement
-- listées.
select has_index('public', 'workflow_nodes_catalog',
	'workflow_nodes_catalog_workspace_position_idx',
	'index partiel sur `(workspace_id, position, label)` pour les nœuds actifs');

select has_trigger('public', 'workflow_nodes_catalog', 'workflow_nodes_catalog_set_updated_at',
	'`updated_at` est maintenue par un trigger');
select has_trigger('public', 'workflow_nodes_catalog',
	'workflow_nodes_catalog_attribuer_position',
	'`position` est attribuée par un trigger');
select has_function('app', 'catalogue_noeuds_attribuer_position',
	'la fonction du trigger d''ordre existe');

-- =============================================================================================
-- 2. INC-031 — la garde d'archivage manquante, constatée et non commentée
-- =============================================================================================
-- `docs/SPEC-workflow-engine.md` §2.6 exige que l'archivage d'un nœud soit refusé tant qu'une card
-- active s'y trouve. Le chemin est `cards.current_step_id → workflow_steps.node_id → catalogue`.
-- Aucune de ces deux tables n'existe : `workflow_steps` arrive avec `CRM-031`, `cards` avec
-- `CRM-040`.
--
-- Les trois assertions qui suivaient ont été écrites pour **devenir rouges** ce jour-là. Deux
-- l'ont fait à `CRM-031`, qui a livré `workflows` et `workflow_steps` : elles sont révisées ici,
-- avec le code, et disent désormais l'état réel. C'est le mécanisme de la décision 51 — une limite
-- figée par une assertion force sa révision, alors qu'une limite commentée survit à sa cause.

select ok(
	to_regclass('public.workflows') is not null
	  and to_regclass('public.workflow_steps') is not null,
	'INC-031 : `workflows` et `workflow_steps` existent depuis `CRM-031` — la moitié du chemin de '
	'la garde d''archivage est désormais praticable');
select has_table('public', 'cards',
	'INC-031 : `cards` est livrée par `CRM-040` — le chemin de la garde d''archivage est complet, '
	'et la garde est écrite (décision 111)');

-- RÉVISÉE À `CRM-040`. Cette assertion comptait les triggers pour que personne ne puisse croire
-- que la garde existait parce qu'un trigger portait un nom voisin. Elle est devenue rouge dès que
-- la garde a été écrite : elle compte désormais TROIS triggers, et NOMME le troisième — ce qui est
-- une preuve plus forte que le comptage seul.
select is(
	(select count(*)::int from pg_trigger
	  where tgrelid = 'public.workflow_nodes_catalog'::regclass and not tgisinternal),
	3,
	'exactement trois triggers — `updated_at`, `position`, et la garde d''archivage livrée par '
	'`CRM-040` (INC-031, décision 111)');
select has_trigger('public', 'workflow_nodes_catalog',
	'workflow_nodes_catalog_refuser_archivage_occupe',
	'et le troisième est bien la garde attendue depuis `CRM-030`, nommée et non déduite. Son '
	'comportement est prouvé par supabase/tests/0012_cards.test.sql §9');

-- =============================================================================================
-- 3. Fixtures
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	('66660000-0000-4000-8000-000000000001', 'Atelier NODE A', 'atelier-node-a'),
	('66660000-0000-4000-8000-000000000002', 'Atelier NODE B', 'atelier-node-b');

-- =============================================================================================
-- 4. Contraintes de valeur — docs/SPEC-workflow-engine.md §2.3, §2.5
-- =============================================================================================

select lives_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'prospection', 'Prospection', 10)$$,
	'une clé en minuscules est acceptée');

select lives_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'relance-longue', 'Relance longue', 11)$$,
	'une clé à tiret simple est acceptée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'Majuscule', 'M', 12)$$,
	'23514', null, 'une clé en majuscules est refusée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'deux--tirets', 'D', 13)$$,
	'23514', null, 'une clé à tirets doublés est refusée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'avec_underscore', 'U', 14)$$,
	'23514', null,
	'un tiret bas est refusé : la clé doit rester utilisable dans une URL comme dans un nom de '
	'colonne de rapport');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', '', 'Vide', 15)$$,
	'23514', null, 'une clé vide est refusée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'label-blanc', '   ', 16)$$,
	'23514', null,
	'un libellé réduit à des blancs est refusé : `not null` seul ne l''aurait pas attrapé');

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, position)
	  values ('66660000-0000-4000-8000-000000000001', 'kind-faux', 'K', 'inconnu', 17)$$,
	'23514', null,
	'un `kind` hors de `open` / `won` / `lost` est refusé : l''analytique de conversion en dépend');

-- `docs/DESIGN_SYSTEM.md` §1 : la couleur d'une donnée est un **nom de jeton**, jamais un
-- hexadécimal. Un hexadécimal en base signifierait que le thème ne peut plus changer.
select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, color, position)
	  values ('66660000-0000-4000-8000-000000000001', 'couleur-hex', 'C', '#ff0000', 18)$$,
	'23514', null,
	'un hexadécimal est refusé comme couleur : docs/DESIGN_SYSTEM.md §1 exige un nom de jeton');

select lives_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, color, kind, position)
	  values ('66660000-0000-4000-8000-000000000001', 'perdu', 'Perdu', 'danger', 'lost', 19)$$,
	'les cinq jetons du design system sont acceptés, `danger` compris');

-- --- 4.1 Les bornes de la probabilité, et l'arrondi qui les précède ---------------------------

select lives_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_probability, position)
	  values ('66660000-0000-4000-8000-000000000001', 'borne-zero', 'Zéro', 0, 20)$$,
	'une probabilité de 0 est acceptée');

select lives_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_probability, position)
	  values ('66660000-0000-4000-8000-000000000001', 'borne-cent', 'Cent', 100, 21)$$,
	'une probabilité de 100 est acceptée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_probability, position)
	  values ('66660000-0000-4000-8000-000000000001', 'borne-haute', 'Haute', 100.01, 22)$$,
	'23514', null, 'une probabilité supérieure à 100 est refusée');

select throws_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_probability, position)
	  values ('66660000-0000-4000-8000-000000000001', 'borne-basse', 'Basse', -0.01, 23)$$,
	'23514', null, 'une probabilité négative est refusée');

-- LE COMPORTEMENT QUI SURPRENDRAIT UN LECTEUR PRESSÉ, MESURÉ AVANT D'ÊTRE ÉCRIT.
-- `numeric(5,2)` arrondit **avant** que la contrainte de valeur ne soit évaluée. La contrainte
-- porte donc sur la valeur arrondie par le type, jamais sur celle que le client a envoyée. Sans
-- cette assertion, un test futur insérant `99.999` et attendant `99.999` échouerait pour une raison
-- sans rapport avec la règle métier — et serait « corrigé » en relâchant la contrainte
-- (docs/JOURNAL.md, décision 68).
insert into public.workflow_nodes_catalog (workspace_id, key, label, default_probability, position)
	values ('66660000-0000-4000-8000-000000000001', 'arrondi', 'Arrondi', 99.999, 24);
select is(
	(select n.default_probability from public.workflow_nodes_catalog n where n.key = 'arrondi'),
	100.00::numeric(5,2),
	'`numeric(5,2)` **arrondit avant** la contrainte : `99.999` est accepté et stocké `100.00`');

-- --- 4.2 Le seuil de relance ------------------------------------------------------------------

select throws_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_stale_after_days, position)
	  values ('66660000-0000-4000-8000-000000000001', 'seuil-zero', 'Seuil zéro', 0, 25)$$,
	'23514', null,
	'un seuil de zéro jour est refusé : il signalerait toute card dès son arrivée, et masquerait '
	'l''absence de seuil sous une valeur qui a l''air d''en être une');

select throws_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_stale_after_days, position)
	  values ('66660000-0000-4000-8000-000000000001', 'seuil-negatif', 'Seuil négatif', -3, 26)$$,
	'23514', null, 'un seuil négatif est refusé');

select lives_ok(
	$$insert into public.workflow_nodes_catalog
	         (workspace_id, key, label, default_stale_after_days, position)
	  values ('66660000-0000-4000-8000-000000000001', 'seuil-nul', 'Seuil nul', null, 27)$$,
	'un seuil nul est accepté : c''est l''état d''un nœud terminal, qui n''est jamais en retard');

-- --- 4.3 Unicité de la clé, par workspace -----------------------------------------------------

select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'prospection', 'Doublon', 30)$$,
	'23505', null, 'la même clé deux fois dans le **même** workspace est refusée');

select lives_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000002', 'prospection', 'Prospection B', 1)$$,
	'la même clé dans un **autre** workspace est acceptée : c''est la condition pour que le '
	'catalogue soit réellement propre à un workspace');

-- La cascade suit le workspace : un catalogue n'a aucun sens hors du sien.
savepoint avant_cascade;
delete from public.workspaces where id = '66660000-0000-4000-8000-000000000002';
select is(
	(select count(*)::int from public.workflow_nodes_catalog
	  where workspace_id = '66660000-0000-4000-8000-000000000002'),
	0,
	'la suppression d''un workspace emporte son catalogue (`ON DELETE CASCADE`)');
rollback to savepoint avant_cascade;

-- =============================================================================================
-- 5. Ordre — docs/SPEC-workflow-engine.md §2.4
-- =============================================================================================
-- La portée du compteur est le **workspace**, et non le track comme pour `channels` (décision 61) :
-- le catalogue est une liste unique par workspace, sans conteneur intermédiaire (décision 67).
-- Mesuré avant écriture sur une table sonde ; réaffirmé ici sur la table réelle.

insert into public.workflow_nodes_catalog (workspace_id, key, label)
	values ('66660000-0000-4000-8000-000000000001', 'ordre-un', 'Ordre un');
insert into public.workflow_nodes_catalog (workspace_id, key, label)
	values ('66660000-0000-4000-8000-000000000001', 'ordre-deux', 'Ordre deux');

select is(
	(select n.position from public.workflow_nodes_catalog n where n.key = 'ordre-un'),
	28::numeric,
	'la première insertion sans `position` prend la place suivante de son workspace — 28, la plus '
	'haute déjà posée valant 27');
select is(
	(select n.position from public.workflow_nodes_catalog n where n.key = 'ordre-deux'),
	29::numeric,
	'la deuxième suit la première');

-- Le compteur redémarre à chaque workspace : un catalogue vide commence à 1, quelle que soit
-- l'activité des autres workspaces.
insert into public.workflow_nodes_catalog (workspace_id, key, label)
	values ('66660000-0000-4000-8000-000000000002', 'ordre-b', 'Ordre B');
select is(
	(select n.position from public.workflow_nodes_catalog n where n.key = 'ordre-b'),
	2::numeric,
	'le compteur de `position` est propre au **workspace** : il ne dépend pas de l''activité d''un '
	'autre workspace');

-- Propriété héritée de `CRM-020` et `CRM-021`, vérifiée ici plutôt que supposée : un trigger
-- `BEFORE INSERT` ne distingue pas une `position` omise d'une `position` écrite `null`.
insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	values ('66660000-0000-4000-8000-000000000001', 'ordre-nul', 'Ordre nul', null);
select is(
	(select n.position from public.workflow_nodes_catalog n where n.key = 'ordre-nul'),
	30::numeric,
	'un `null` explicite à l''insertion est traité comme une omission : le trigger ne peut pas les '
	'distinguer');

select throws_ok(
	$$update public.workflow_nodes_catalog set position = null where key = 'ordre-nul'$$,
	'23502', null,
	'une mise à jour vers `null` est refusée : le trigger ne couvre que l''insertion');

-- Une `position` fournie n'est jamais écrasée par le trigger.
insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	values ('66660000-0000-4000-8000-000000000001', 'intercale', 'Intercalé', 29.5);
select is(
	(select n.position from public.workflow_nodes_catalog n where n.key = 'intercale'),
	29.5::numeric,
	'une `position` fractionnaire fournie est conservée : c''est ce qui permettra d''insérer un '
	'nœud entre deux autres sans renuméroter le catalogue');

-- =============================================================================================
-- 6. Archivage — docs/SPEC-workflow-engine.md §2.6
-- =============================================================================================

update public.workflow_nodes_catalog set archived_at = now() where key = 'ordre-un';
select is(
	(select count(*)::int from public.workflow_nodes_catalog n
	  where n.workspace_id = '66660000-0000-4000-8000-000000000001' and n.archived_at is null),
	10,
	'un nœud archivé sort du catalogue actif');

update public.workflow_nodes_catalog set archived_at = null where key = 'ordre-un';
select is(
	(select count(*)::int from public.workflow_nodes_catalog n
	  where n.workspace_id = '66660000-0000-4000-8000-000000000001' and n.archived_at is null),
	11,
	'l''archivage est réversible : c''est une suppression douce, pas une suppression');

-- `updated_at` est tenue par le serveur, pas par l'appelant. Même procédé qu'à `CRM-020` et
-- `CRM-021` : à l'intérieur d'une transaction, `now()` est constante, et ce qui se prouve est que
-- le trigger **écrase** la valeur écrite par le client.
update public.workflow_nodes_catalog set updated_at = '2000-01-01T00:00:00Z' where key = 'ordre-un';
select ok(
	(select n.updated_at from public.workflow_nodes_catalog n where n.key = 'ordre-un')
		> '2020-01-01'::timestamptz,
	'`app.set_updated_at()` écrase la valeur fournie par le client');

-- =============================================================================================
-- 7. Refus par défaut et politiques — docs/SPEC-permissions-rls.md §4
-- =============================================================================================

select is(
	(select c.relrowsecurity from pg_class c
	  join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public' and c.relname = 'workflow_nodes_catalog'),
	true,
	'RLS est activée sur le catalogue');

select policies_are('public', 'workflow_nodes_catalog',
	array['catalogue_noeuds_lecture_membre', 'catalogue_noeuds_insertion_admin',
	      'catalogue_noeuds_maj_admin'],
	'exactement trois politiques : lecture, insertion, mise à jour');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflow_nodes_catalog' and cmd = 'DELETE'),
	0,
	'aucune politique de suppression : la suppression du produit est l''archivage');

select isnt(
	(select p.with_check from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'workflow_nodes_catalog'
	    and p.policyname = 'catalogue_noeuds_maj_admin'),
	null,
	'la politique de mise à jour porte un `WITH CHECK`, sans quoi un nœud pourrait changer de '
	'workspace');

select table_privs_are('public', 'workflow_nodes_catalog', 'anon', array['SELECT'],
	'`anon` n''a que `SELECT` : un refus de lecture est zéro ligne, pas une erreur de privilège');
select table_privs_are('public', 'workflow_nodes_catalog', 'authenticated',
	array['SELECT', 'INSERT', 'UPDATE'],
	'`authenticated` n''a ni `DELETE` ni `TRUNCATE` : la suppression physique n''est pas exposée');

-- =============================================================================================
-- 8. Autorisations éprouvées contre des comptes réels
-- =============================================================================================
-- Revendications JWT simulées **exactement** comme PostgREST les pose : `request.jwt.claims` en
-- réglage local, rôle applicatif endossé par `set local role`. Même procédé que les suites `0002`,
-- `0004` et `0005`.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
	('77770000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'nd-admin-a@exemple.test', '{"full_name": "Admin ND A"}'),
	('77770000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'nd-viewer-a@exemple.test', '{"full_name": "Viewer ND A"}'),
	('77770000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'nd-bizdev-a@exemple.test', '{"full_name": "Bizdev ND A"}'),
	('77770000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'nd-admin-b@exemple.test', '{"full_name": "Admin ND B"}');

insert into public.workspace_members (workspace_id, user_id, role) values
	('66660000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-00000000000a', 'admin'),
	('66660000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-00000000000b', 'viewer'),
	('66660000-0000-4000-8000-000000000001', '77770000-0000-4000-8000-00000000000c',
	 'business_developer'),
	('66660000-0000-4000-8000-000000000002', '77770000-0000-4000-8000-00000000000d', 'admin');

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

-- --- 8.1 Lecture ------------------------------------------------------------------------------

savepoint avant_roles;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000a');
select ok(
	(select count(*) from public.workflow_nodes_catalog
	  where workspace_id = '66660000-0000-4000-8000-000000000001') > 0,
	'un administrateur du workspace A lit le catalogue de A');
select is(
	(select count(*)::int from public.workflow_nodes_catalog n
	  where n.workspace_id = '66660000-0000-4000-8000-000000000002'),
	0,
	'PREUVE DE REFUS N° 3 : le membre du workspace A ne voit aucun nœud du workspace B');
reset role;
rollback to savepoint avant_roles;

savepoint avant_viewer;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000b');
select ok(
	(select count(*) from public.workflow_nodes_catalog
	  where workspace_id = '66660000-0000-4000-8000-000000000001') > 0,
	'un `viewer` lit le catalogue de son workspace : lire n''exige pas d''écrire');
reset role;
rollback to savepoint avant_viewer;

savepoint avant_bizdev_lit;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000c');
select ok(
	(select count(*) from public.workflow_nodes_catalog
	  where workspace_id = '66660000-0000-4000-8000-000000000001') > 0,
	'un `business_developer` lit le catalogue : il travaille dans le vocabulaire du workspace');
reset role;
rollback to savepoint avant_bizdev_lit;

savepoint avant_anon;
select pg_temp.anonyme();
select is(
	(select count(*)::int from public.workflow_nodes_catalog),
	0,
	'PREUVE DE REFUS N° 11 : un appelant anonyme ne lit aucun nœud, alors que la table en '
	'contient — et il obtient zéro ligne, pas une erreur');
reset role;
rollback to savepoint avant_anon;

-- --- 8.2 Écriture -----------------------------------------------------------------------------

savepoint avant_viewer_ecrit;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000b');
select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'par-viewer', 'Par un viewer', 50)$$,
	'42501', null,
	'un `viewer` ne crée aucun nœud');
reset role;
rollback to savepoint avant_viewer_ecrit;

savepoint avant_bizdev;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000c');
select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'par-bizdev', 'Par un bizdev', 51)$$,
	'42501', null,
	'PREUVE DE REFUS N° 2 : un `business_developer` ne modifie pas le vocabulaire du workspace. '
	'docs/SPEC-permissions-rls.md §2.1 range nommément le catalogue de nœuds dans les '
	'prérogatives d''administration');
-- LE REFUS DE MISE À JOUR NE LÈVE AUCUNE EXCEPTION, ET CETTE ASSERTION L'A PROUVÉ EN ÉCHOUANT.
-- Écrite d'abord en `throws_ok('42501')` par symétrie avec l'insertion, elle a rendu
-- « caught: no exception ». La cause est structurelle : une clause `USING` ne **refuse** pas une
-- ligne, elle la rend **invisible** — l'ordre `UPDATE` ne trouve alors rien à modifier et réussit
-- sur zéro ligne. Ce n'est donc pas une particularité de PostgREST, qui rend `200` et un tableau
-- vide (docs/SPEC-workflow-engine.md §2.8, ligne h), mais du moteur lui-même.
--
-- La preuve correcte relit la ligne et la constate **inchangée**. Une preuve qui se contenterait
-- de l'absence d'erreur conclurait que l'écriture a réussi (docs/JOURNAL.md, décision 70).
update public.workflow_nodes_catalog set label = 'Renommé' where key = 'prospection';
select is(
	(select n.label from public.workflow_nodes_catalog n where n.key = 'prospection'),
	'Prospection',
	'un `business_developer` ne renomme aucun nœud : la mise à jour ne lève **aucune erreur**, '
	'elle ne touche simplement aucune ligne — le libellé est relu et constaté inchangé');
reset role;
rollback to savepoint avant_bizdev;

savepoint avant_admin;
select pg_temp.endosser('77770000-0000-4000-8000-00000000000a');
select lives_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000001', 'par-admin', 'Par un admin', 52)$$,
	'un administrateur crée un nœud dans son workspace');
select throws_ok(
	$$insert into public.workflow_nodes_catalog (workspace_id, key, label, position)
	  values ('66660000-0000-4000-8000-000000000002', 'intrusion', 'Intrusion', 53)$$,
	'42501', null,
	'un administrateur du workspace A ne crée aucun nœud dans le workspace B');
select throws_ok(
	$$update public.workflow_nodes_catalog
	     set workspace_id = '66660000-0000-4000-8000-000000000002'
	   where key = 'par-admin'$$,
	'42501', null,
	'le `WITH CHECK` interdit de **déplacer** un nœud vers un workspace où l''appelant n''est pas '
	'administrateur');
select lives_ok(
	$$update public.workflow_nodes_catalog set archived_at = now() where key = 'par-admin'$$,
	'un administrateur archive son propre nœud');
select lives_ok(
	$$update public.workflow_nodes_catalog set archived_at = null where key = 'par-admin'$$,
	'et le désarchive : l''archivage est réversible pour lui aussi');
select throws_ok(
	$$delete from public.workflow_nodes_catalog where key = 'par-admin'$$,
	'42501', null,
	'la suppression physique est refusée même à un administrateur : le privilège n''est accordé à '
	'personne');
reset role;
rollback to savepoint avant_admin;

-- --- 8.3 Les droits ne sont pas portés par le jeton -------------------------------------------

savepoint avant_revocation;
delete from public.workspace_members
 where user_id = '77770000-0000-4000-8000-00000000000b';
select pg_temp.endosser('77770000-0000-4000-8000-00000000000b');
select is(
	(select count(*)::int from public.workflow_nodes_catalog),
	0,
	'l''appartenance retirée, le même appelant ne lit plus aucun nœud — les droits ne sont pas '
	'portés par le jeton');
reset role;
rollback to savepoint avant_revocation;

-- =============================================================================================
-- 9. Ce que le catalogue **n'a pas** à porter, et pourquoi ce n'est pas un écart
-- =============================================================================================
-- `tracks` et `channels` portent chacun une entrée ouverte — INC-024, INC-030 — parce que leur
-- politique de lecture devrait consulter un droit fin et ne le fait pas encore. Le catalogue n'est
-- pas dans ce cas : `track_members` et `channel_members` portent sur un sous-arbre d'organisation,
-- et le catalogue n'appartient ni à un track ni à un channel.
--
-- L'assertion ci-dessous **constate** que la politique de lecture n'interroge que
-- `app.is_workspace_member`, de sorte qu'un futur resserrement soit un choix visible et non un
-- glissement.

select matches(
	(select p.qual from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'workflow_nodes_catalog'
	    and p.policyname = 'catalogue_noeuds_lecture_membre'),
	'is_workspace_member',
	'la lecture s''appuie sur `app.is_workspace_member` — la règle **spécifiée**, non un repli : '
	'aucun droit fin ne gouverne le catalogue (docs/SPEC-workflow-engine.md §2.7)');

select doesnt_match(
	(select p.qual from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'workflow_nodes_catalog'
	    and p.policyname = 'catalogue_noeuds_lecture_membre'),
	'can_read',
	'et elle n''appelle aucune des quatre fonctions différées par INC-013 : le catalogue ne les '
	'attend pas');

select * from finish();
rollback;

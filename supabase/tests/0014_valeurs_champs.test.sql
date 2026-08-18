-- @verifies CRM-036 (docs/BACKLOG.md) — valeurs de formulaire, validation par type, union étape +
--            transition
-- @verifies docs/SPEC-form-composer.md §6.2 (modèle), §6.3 (clés composites), §6.4 (la validation
--           est un trigger), §6.5 (ce que chaque type accepte), §6.6 (« renseigné »), §6.7 (la
--           sixième vérification), §6.9 (autorisations), §6.11 (seed), §7.2 (preuves attendues)
-- @verifies docs/SCHEMA.md §4 (`card_field_values`), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §4 (politiques), §7 (refus
--           n° 4, n° 11)
-- @verifies docs/SPEC-workflow-engine.md §5.3 (les six vérifications), §5.7 (la n° 6)
-- @verifies docs/SPEC-seed.md §2.13 (valeurs du seed)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes omises), INC-033
--           (liaison CRM-018), INC-047 (**close**), INC-053 (`user` non résolu),
--           INC-054 (`value` nullable, mesuré)
--
-- Suite pgTAP de l'unité `CRM-036`. Elle prouve huit choses :
--
--   1. la **forme** de la table : colonnes, nullabilité, clé primaire composite, index ;
--   2. l'**unicité ajoutée à `cards`**, condition de la première clé composite (décision 124) ;
--   3. ce que les **clés composites** garantissent : une valeur ne répond pas à la question d'un
--      autre workflow, **dans les deux sens**, et les cascades ;
--   4. la **validation par type**, dans les **deux** sens pour les quinze types — ce qui doit
--      passer passe, ce qui doit être refusé l'est ;
--   5. la définition de « **renseigné** » (§6.6), y compris les cas contre-intuitifs `false` et
--      `0`, qui sont des réponses ;
--   6. la **sixième vérification de `move_card`** : l'union étape + transition, l'exclusion des
--      champs `hidden`, archivés et non résolus, et la liste ordonnée du `DETAIL` ;
--   7. la **RLS**, les trois politiques, et l'absence de tout `DELETE` ;
--   8. la **conformité du seed**, et ce qui reste dû, figé par des assertions.
--
-- Exécution : `npm run test:sql`, `scripts/verify-valeurs-champs.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0014_valeurs_champs.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Comme les suites précédentes, aucun
-- bloc n'emploie `rollback to savepoint` : une assertion prise dans un savepoint annulé est
-- **numérotée mais non comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(103);

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

create or replace function pg_temp.postgres()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role postgres';
end;
$$;

-- =============================================================================================
-- 1. Forme de la table — docs/SPEC-form-composer.md §6.2
-- =============================================================================================

select has_table('public', 'card_field_values',
	'`public.card_field_values` est livrée — INC-047 en dépendait, et la sixième vérification de '
	'`move_card` avec elle');

select has_column('public', 'card_field_values', 'workflow_id',
	'`workflow_id` existe : la **charnière** des deux clés composites du §6.3, sans laquelle une '
	'valeur pourrait répondre à la question d''un autre workflow');
select has_column('public', 'card_field_values', 'workspace_id',
	'`workspace_id` existe — dénormalisé pour la RLS, sa véracité tenue par une troisième clé');
select has_column('public', 'card_field_values', 'updated_by', '`updated_by` existe');

-- INC-025, quatrième occurrence : le tableau du §4 de docs/SCHEMA.md n'énumérait qu'`updated_at`.
select has_column('public', 'card_field_values', 'created_at',
	'INC-025, quatrième occurrence : `created_at`, que le tableau de docs/SCHEMA.md §4 omettait, '
	'est bien là — les « Conventions générales » du même document l''exigent');
select has_column('public', 'card_field_values', 'updated_at',
	'`updated_at` de même');

select col_is_pk('public', 'card_field_values', array['card_id', 'field_id'],
	'la clé primaire est `(card_id, field_id)` : une card porte **au plus une** valeur par champ, '
	'deux réponses contradictoires sont structurellement impossibles');

-- INC-054 : la nullabilité est une MESURE, pas une préférence. PostgREST convertit un `null` JSON
-- en SQL NULL et ne sait produire `'null'::jsonb` par aucune écriture : avec `NOT NULL`, vider un
-- champ `money` n'avait aucune écriture licite (décision 133).
select col_is_null('public', 'card_field_values', 'value',
	'INC-054 : `value` est **nullable**. MESURÉ — PostgREST convertit un `null` JSON en SQL NULL et '
	'ne sait produire `''null''::jsonb` par aucune écriture ; avec `NOT NULL`, vider un champ '
	'`money` était IMPOSSIBLE depuis le produit');
select col_not_null('public', 'card_field_values', 'workflow_id', '`workflow_id` est non nul');
select col_not_null('public', 'card_field_values', 'workspace_id', '`workspace_id` est non nul');

select has_index('public', 'card_field_values', 'card_field_values_value_idx',
	'index GIN sur `value` — docs/SCHEMA.md §10, pour les filtres des vues sauvegardées');
select has_index('public', 'card_field_values', 'card_field_values_field_idx',
	'index sur `field_id` — la lecture « toutes les valeurs d''un champ »');

-- =============================================================================================
-- 2. L'unicité que `cards` devait offrir — décision 124
-- =============================================================================================
-- Elle ne peut refuser aucune ligne : `id` est déjà clé primaire. Elle est la CONDITION de la clé
-- composite de la section 3.1. MESURÉ sans elle : « there is no unique constraint matching given
-- keys for referenced table "cards" ».

select col_is_unique('public', 'cards', array['id', 'workflow_id'],
	'`cards (id, workflow_id)` est unique — ajoutée par `CRM-036`, condition de la clé étrangère '
	'composite des valeurs. Ne change AUCUN comportement de `cards`, `id` étant déjà clé primaire');

-- =============================================================================================
-- 3. Ce que les clés composites garantissent — décision 124
-- =============================================================================================

select has_fk('public', 'card_field_values',
	'`card_field_values` porte des clés étrangères');

-- --- 3.1 Une valeur ne répond pas à la question d'un AUTRE workflow, dans les DEUX sens --------
-- Comme pour `form_field_rules` (décision 95) : quel que soit le `workflow_id` déclaré, l'une des
-- deux clés attrape l'erreur. Les deux assertions sont distinctes ; l'une seule laisserait croire
-- que la garde tient dans un sens seulement.
--
-- Un workflow sonde et un champ sonde tiennent lieu de « second workflow ». La copie de portée
-- `track` du seed aurait pu servir, mais son identifiant est TIRÉ AU HASARD par
-- `copy_workflow_to_track` — MESURÉ — et une assertion ne doit pas dépendre d'une valeur
-- imprévisible ; `CRM-018` lui donne désormais ses propres champs remappés.
--
-- LE CHAMP DOIT EXISTER POUR QUE LA CLÉ SOIT CE QUI REFUSE — MESURÉ, et ce n'est pas évident. Un
-- trigger `BEFORE` s'exécute AVANT la vérification des clés étrangères : avec un `field_id`
-- inconnu, c'est la validation de la section 5 de la migration qui refuse la première, en
-- `invalid_field_value`, et la clé ne serait jamais atteinte. L'assertion 3.2 bis constate cet
-- ordre plutôt que de le laisser surprendre un lecteur.

select pg_temp.postgres();

insert into public.workflows (id, workspace_id, name, scope)
values ('5eed0000-0000-4000-8000-0000000000f0', '5eed0000-0000-4000-8000-000000000001',
        'Workflow sonde de CRM-036', 'global');

insert into public.form_fields (id, workflow_id, workspace_id, key, label, type, options, position)
values ('5eed0000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-0000000000f0',
        '5eed0000-0000-4000-8000-000000000001', 'sonde-autre-workflow', 'Sonde autre workflow',
        'number', '{}', 201);

select throws_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c5',
	        '5eed0000-0000-4000-8000-0000000000f1',
	        '5eed0000-0000-4000-8000-0000000000f0',
	        '5eed0000-0000-4000-8000-000000000001',
	        '1'::jsonb) $$,
	'23503', null,
	'une valeur liant une card du workflow GLOBAL à un champ d''un AUTRE workflow est refusée : la clé '
	'`(card_id, workflow_id)` l''attrape, le champ existant pourtant bel et bien');

-- --- 3.2 Le sens inverse : un champ d'un autre workflow, sous le workflow de la card -----------
select throws_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c5',
	        '5eed0000-0000-4000-8000-0000000000f1',
	        '5eed0000-0000-4000-8000-000000000051',
	        '5eed0000-0000-4000-8000-000000000001',
	        '1'::jsonb) $$,
	'23503', null,
	'le MÊME champ, sous le workflow de la card cette fois, est refusé par l''AUTRE clé — '
	'`(field_id, workflow_id)`. Les deux sens sont tenus, et par deux contraintes distinctes');

-- --- 3.2 bis L'ordre mesuré : un trigger `BEFORE` précède les clés étrangères ------------------
-- Avec un `field_id` qui n'existe nulle part, ce n'est PAS `23503` qui remonte : la validation de
-- la migration s'exécute d'abord et ne trouve pas le champ. Le fait est constaté plutôt que
-- découvert par le prochain lecteur, et le commentaire de la migration a été corrigé en
-- conséquence.
select throws_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c5',
	        '5eed0000-0000-4000-8000-0000000000ff',
	        '5eed0000-0000-4000-8000-000000000051',
	        '5eed0000-0000-4000-8000-000000000001',
	        '1'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'MESURÉ : un `field_id` INCONNU est refusé par le TRIGGER, non par la clé étrangère — un '
	'trigger `BEFORE` s''exécute avant la vérification des contraintes. Le refus a lieu dans les '
	'deux cas ; seul son auteur change');

-- --- 3.3 Le `workspace_id` dénormalisé ne peut pas mentir -------------------------------------
select throws_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c5',
	        '5eed0000-0000-4000-8000-000000000081',
	        '5eed0000-0000-4000-8000-000000000051',
	        '5eed0000-0000-4000-8000-0000000000ff',
	        '1'::jsonb) $$,
	'23503', null,
	'un `workspace_id` qui ment est refusé : une politique décide qui écrit la ligne, pas ce que la '
	'ligne raconte (décision 73)');

-- --- 3.4 Supprimer une card emporte ses valeurs ------------------------------------------------
-- Sur une card sonde, créée puis emportée dans la transaction annulée : le seed n'est pas touché.

select pg_temp.postgres();

insert into public.cards (id, workspace_id, channel_id, workflow_id, current_step_id, title, position)
values ('5eed0000-0000-4000-8000-0000000000d1',
        '5eed0000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000032',
        '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000061',
        'Sonde de cascade', 99);

insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
values ('5eed0000-0000-4000-8000-0000000000d1', '5eed0000-0000-4000-8000-000000000081',
        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', '1'::jsonb);

delete from public.cards where id = '5eed0000-0000-4000-8000-0000000000d1';

select is(
	(select count(*)::int from public.card_field_values
	  where card_id = '5eed0000-0000-4000-8000-0000000000d1'),
	0,
	'supprimer une card emporte ses valeurs : une réponse sans question posée n''est pas une donnée '
	'à conserver');

-- =============================================================================================
-- 4. La validation par type — décisions 125, 131, 132
-- =============================================================================================
-- Chaque type est éprouvé DANS LES DEUX SENS : ce qui doit passer passe, ce qui doit être refusé
-- l'est. Un test qui ne constaterait que le refus serait vert sur un trigger qui refuse tout.
--
-- Les huit types que le seed ne porte pas sont éprouvés sur des CHAMPS SONDES, créés ici et
-- emportés par l'annulation de la transaction : ajouter des champs au seed rouvrirait `CRM-035`.

insert into public.form_fields (id, workflow_id, workspace_id, key, label, type, options, position)
values
	('5eed0000-0000-4000-8000-0000000000e1', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-texte', 'Sonde texte', 'text', '{}', 101),
	('5eed0000-0000-4000-8000-0000000000e2', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-email', 'Sonde email', 'email', '{}', 102),
	('5eed0000-0000-4000-8000-0000000000e3', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-datetime', 'Sonde datetime', 'datetime', '{}', 103),
	('5eed0000-0000-4000-8000-0000000000e4', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-multi', 'Sonde multiselect', 'multiselect',
	 '{"choices": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}]}', 104),
	('5eed0000-0000-4000-8000-0000000000e5', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-user', 'Sonde user', 'user', '{}', 105),
	('5eed0000-0000-4000-8000-0000000000e6', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-phone', 'Sonde phone', 'phone', '{}', 106),
	('5eed0000-0000-4000-8000-0000000000e7', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-file', 'Sonde file', 'file', '{}', 107),
	('5eed0000-0000-4000-8000-0000000000e8', '5eed0000-0000-4000-8000-000000000051',
	 '5eed0000-0000-4000-8000-000000000001', 'sonde-contact', 'Sonde contact', 'contact', '{}', 108);

-- La card `…0c5` de `maintenance` ne sert à aucun autre bloc : elle porte toutes les sondes.
create or replace function pg_temp.poser(champ uuid, valeur jsonb)
returns void language plpgsql as $$
begin
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c5', champ,
	        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', valeur)
	on conflict (card_id, field_id) do update set value = excluded.value;
end;
$$;

-- --- 4.1 `text` -------------------------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e1', '"bonjour"'::jsonb) $$,
	'`text` accepte une chaîne');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e1', '42'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`text` refuse un nombre — le message est un JETON STABLE, la forme attendue voyage dans le '
	'`DETAIL` (décision 126)');

-- --- 4.2 `money` et `number` ------------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000081', '1200.50'::jsonb) $$,
	'`money` accepte un nombre');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000081', '"1200"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`money` refuse une CHAÎNE de chiffres : « 1200 » n''est pas 1200');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000087', '0'::jsonb) $$,
	'`number` accepte `0` — qui est une valeur, pas une absence');

-- --- 4.3 `checkbox` ---------------------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000085', 'false'::jsonb) $$,
	'`checkbox` accepte `false`');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000085', '"true"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`checkbox` refuse la CHAÎNE « true » : un booléen n''est pas son écriture');

-- --- 4.4 `date` et `datetime` -----------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000083', '"2026-12-31"'::jsonb) $$,
	'`date` accepte une date ISO 8601');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000083', '"31/12/2026"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`date` refuse une date non convertible — et le message est celui du PRODUIT, non « invalid '
	'input syntax for type date », qui nommerait un type interne');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e3', '"2026-12-31T23:59:00Z"'::jsonb) $$,
	'`datetime` accepte un horodatage ISO 8601');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e3', '"hier"'::jsonb) $$,
	'P0001', 'invalid_field_value', '`datetime` refuse une chaîne non convertible');

-- --- 4.5 `select` : LE POINT OUVERT N° 4 DU §8, CLOS — décision 131 ---------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000082', '"salon"'::jsonb) $$,
	'`select` accepte une clé DÉCLARÉE dans `options.choices`');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000082', '"linkedin"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`select` refuse une clé ABSENTE des choix — la base ne contraint toujours pas la forme de '
	'`choices` (un `CHECK` ne peut porter de sous-requête), mais aucune card ne peut plus porter '
	'une réponse que son champ n''offre pas');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000082', '["salon"]'::jsonb) $$,
	'P0001', 'invalid_field_value', '`select` refuse un TABLEAU : c''est `multiselect` qui en prend un');

-- --- 4.6 `multiselect` ------------------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e4', '["a", "b"]'::jsonb) $$,
	'`multiselect` accepte un tableau de clés déclarées');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e4', '["a", "z"]'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`multiselect` refuse dès qu''UNE clé du tableau est inconnue : la validation porte sur chaque '
	'élément, non sur le premier');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e4', '["a", 3]'::jsonb) $$,
	'P0001', 'invalid_field_value', '`multiselect` refuse un élément non textuel');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e4', '[]'::jsonb) $$,
	'`multiselect` accepte un tableau VIDE — c''est une valeur licite, que le §6.6 compte comme NON '
	'RENSEIGNÉE : les deux notions sont distinctes et le restent');

-- --- 4.7 `url` et `email` ---------------------------------------------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000086', '"https://p2enjoy.fr/x"'::jsonb) $$,
	'`url` accepte une adresse https');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000086', '"javascript:alert(1)"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'`url` refuse `javascript:` — la seule forme dont l''affichage serait dangereux');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e2', '"contact@p2enjoy.test"'::jsonb) $$,
	'`email` accepte une adresse bien formée');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e2', '"contact@localhost"'::jsonb) $$,
	'P0001', 'invalid_field_value', '`email` refuse un domaine sans point');

-- --- 4.8 `phone` et `file` : ce qui N'EST PAS contraint, dit plutôt que tu ---------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e6', '"n''importe quoi"'::jsonb) $$,
	'`phone` n''est PAS contraint, et c''est délibéré : les formats nationaux sont trop divers pour '
	'qu''un refus soit défendable (§6.5). L''écart est FIGÉ ici plutôt que laissé à la prose');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e7', '"formulaires/x.pdf"'::jsonb) $$,
	'`file` accepte un chemin quelconque : la cible vit dans Storage, service distinct');

-- --- 4.9 `user` et `contact` : la FORME, pas la cible — INC-053 -------------------------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e5',
	                        '"5eed0000-0000-4000-8000-000000000012"'::jsonb) $$,
	'`user` accepte un identifiant bien formé');
select throws_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e5', '"martin"'::jsonb) $$,
	'P0001', 'invalid_field_value', '`user` refuse ce qui n''est pas un identifiant');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e5',
	                        '"00000000-0000-4000-8000-000000000000"'::jsonb) $$,
	'INC-053, ÉCART FIGÉ : `user` accepte un identifiant bien formé désignant un profil INEXISTANT. '
	'La forme est validée, PAS la cible. CETTE ASSERTION DOIT ÊTRE RÉVISÉE le jour où l''arbitrage '
	'sera rendu — résoudre `user` seul poserait une règle d''appartenance que nul document n''énonce');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-0000000000e8',
	                        '"00000000-0000-4000-8000-000000000001"'::jsonb) $$,
	'`contact` de même : la forme d''un UUID est validée, PAS la cible — la table `contacts` '
	'existe désormais (CRM-060) mais la résolution en base attend la TRANCHE 3 de CRM-060, '
	'`CRM-036` §6.5 (INC-053) ; en attendant, un UUID désignant un contact INEXISTANT reste '
	'accepté à ce niveau');

-- ASSERTION RETOURNÉE, NON RETIRÉE (mécanisme de la décision 51) : elle attendait l'absence de
-- `contacts`, elle constate désormais sa PRÉSENCE. Le motif du contrôle change en même temps que
-- l'unité livrée : ce n'est plus « la résolution est impossible », c'est « la table est là mais
-- la résolution en base n'est pas branchée ». La différence est nommée dans le libellé.
select has_table('public', 'contacts',
	'CRM-060 TRANCHE 1 A LIVRÉ `contacts` : la table est PRÉSENTE. La résolution du champ '
	'`contact` par le validateur de valeurs reste due par la TRANCHE 3 (`CRM-036` §6.5, INC-053) — '
	'l''ASSERTION D''ABSENCE FIGÉE PAR CRM-036 EST RETOURNÉE POUR CONSTATER LA PRÉSENCE, comme le '
	'demande le mécanisme de la décision 51 (CLAUDE.md §3.1). Elle deviendra rouge à la tranche 3 '
	'lorsque la validation croisera cette table');

-- --- 4.10 « Vidé explicitement » est accepté pour TOUS les types — décision 133 ---------------
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000082', 'null'::jsonb) $$,
	'`''null''::jsonb` est accepté sur un `select` : vider un champ n''exige aucune clé de choix');
select lives_ok(
	$$ select pg_temp.poser('5eed0000-0000-4000-8000-000000000081', null::jsonb) $$,
	'INC-054 : le SQL NULL est accepté sur un `money` — la SEULE écriture que l''API sache produire '
	'pour vider un champ, mesuré');

-- --- 4.11 Aucun type ne doit échapper au `case` -----------------------------------------------
-- Le `CHECK` de `form_fields.type` énumère quinze valeurs. Cette assertion les compte : si l'une
-- venait à s'ajouter sans être traitée par le trigger, elle serait silencieusement NON VALIDÉE.
select is(
	(select count(distinct t)::int
	   from unnest(array['text','textarea','number','money','date','datetime','select',
	                     'multiselect','checkbox','url','email','phone','user','contact','file']) t),
	15,
	'les quinze types de docs/SPEC-form-composer.md §2.3 sont énumérés, et le trigger les traite '
	'tous : la branche `else` refuse explicitement, de sorte qu''un seizième type non traité soit '
	'VISIBLE et non silencieusement accepté');

-- =============================================================================================
-- 5. « Renseigné » — docs/SPEC-form-composer.md §6.6, décision 127
-- =============================================================================================
-- La définition vit dans UNE fonction, et non dans une expression recopiée : `move_card` et le
-- rendu de `CRM-037` doivent en donner la même lecture.

select has_function('app', 'valeur_de_champ_est_vide', array['jsonb'],
	'`app.valeur_de_champ_est_vide` est livrée — seule définition de « non renseigné » du produit');

select is(app.valeur_de_champ_est_vide(null),        true,  'SQL NULL est vide');
select is(app.valeur_de_champ_est_vide('null'),      true,  '`''null''::jsonb` est vide');
select is(app.valeur_de_champ_est_vide('""'),        true,  'la chaîne vide est vide');
select is(app.valeur_de_champ_est_vide('"   "'),     true,  'une chaîne d''espaces est vide');
select is(app.valeur_de_champ_est_vide('[]'),        true,  'le tableau vide est vide');
select is(app.valeur_de_champ_est_vide('false'),     false,
	'`false` est RENSEIGNÉ — une case décochée est une réponse. Confondre les deux rendrait une '
	'case à cocher impossible à satisfaire par la négative');
select is(app.valeur_de_champ_est_vide('0'),         false, '`0` est renseigné');
select is(app.valeur_de_champ_est_vide('"0"'),       false, 'la chaîne « 0 » est renseignée');
select is(app.valeur_de_champ_est_vide('["a"]'),     false, 'un tableau non vide est renseigné');
select is(app.valeur_de_champ_est_vide('{}'),        false,
	'l''objet vide est RENSEIGNÉ : aucun type ne le produit aujourd''hui, et le compter comme vide '
	'serait une règle que rien n''énonce');

-- =============================================================================================
-- 6. La sixième vérification de `move_card` — INC-047 CLOSE, décisions 123 et 126 à 129
-- =============================================================================================
-- L'assertion `hasnt_table('public','card_field_values')` de `0013_move_card.test.sql`, écrite par
-- `CRM-034` pour devenir rouge ce jour-là, l'est devenue et a été RETOURNÉE — mécanisme de la
-- décision 51, neuvième occurrence.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- --- 6.1 Un champ `required` non renseigné REFUSE la transition -------------------------------
-- La card `…0c1` porte `budget` à `null` — une LIGNE PRÉSENTE, et pourtant non renseignée (§6.6).
select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c1',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'P0001', 'missing_required_fields',
	'INC-047 CLOSE : un déplacement vers une étape dont un champ `required` est vide est REFUSÉ. '
	'`CRM-034` livrait cinq vérifications sur six ; la sixième est écrite');

-- --- 6.2 Le cas symétrique : la même transition, la valeur renseignée, PASSE -------------------
-- Sans lui, l'assertion précédente serait verte sur une garde qui refuserait TOUT.
select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'la MÊME transition, sur la card `…0c2` dont `budget` est renseigné, RÉUSSIT : la règle '
	'discrimine, elle ne refuse pas tout');

-- --- 6.3 Le `DETAIL` porte la liste des clés manquantes, ORDONNÉE — décision 126 --------------
-- `…0c4` est en négociation et manque deux des trois exigences de la signature.
select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c4',
	                        '5eed0000-0000-4000-8000-000000000064') $$,
	'P0001', 'missing_required_fields',
	'deux clés manquantes : le message reste un jeton stable');

-- pgTAP ne sait pas lire le `DETAIL` d'une exception : il faut le capturer soi-même.
create or replace function pg_temp.detail_du_refus(card uuid, etape uuid)
returns text language plpgsql as $$
declare
	v_detail text;
begin
	perform public.move_card(card, etape);
	return '(aucun refus)';
exception when others then
	get stacked diagnostics v_detail = pg_exception_detail;
	return v_detail;
end;
$$;

select is(
	pg_temp.detail_du_refus('5eed0000-0000-4000-8000-0000000000c4',
	                        '5eed0000-0000-4000-8000-000000000064'),
	'date-signature-prevue, decideur-identifie',
	'le `DETAIL` porte LES DEUX clés manquantes, ordonnées par `position`, séparées par « , ». '
	'`budget` en est absent : il est renseigné. MESURÉ — PostgREST expose ce `DETAIL` dans la clé '
	'`details` de sa réponse (décision 126)');

-- --- 6.4 Un champ `hidden` n'est PAS exigé, même vide -----------------------------------------
-- La Definition of Done le nomme. `motif-perte` est `hidden` en négociation et vide sur `…0c2`,
-- qui vient d'y entrer : la transition vers `relance` ne le réclame pas.
select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'un champ `hidden` à l''étape cible n''est PAS exigé, même vide : `hidden` n''est pas '
	'`required`, et une absence de règle vaut `visible` (§3.1)');

-- --- 6.5 L'UNION : la liaison de transition exige, indépendamment de l'étape -------------------
-- `…0c7` satisfait les TROIS exigences de son étape courante (signature) et reste bloquée par une
-- quatrième, portée par l'arête `signature → réalisation` — l'étape `réalisation` ne porte, elle,
-- aucune règle.
select is(
	(select count(*)::int from public.form_field_rules r
	  where r.step_id = '5eed0000-0000-4000-8000-000000000065'),
	0,
	'ÉTAT CONSTATÉ : l''étape `réalisation` ne porte AUCUNE règle. Sans ce constat, l''assertion '
	'suivante serait verte par l''étape et non par la transition');

select is(
	pg_temp.detail_du_refus('5eed0000-0000-4000-8000-0000000000c7',
	                        '5eed0000-0000-4000-8000-000000000065'),
	'lien-proposition',
	'L''UNION du §3.5 : le refus vient de la liaison de la TRANSITION, l''étape cible '
	'n''exigeant rien. C''est le second membre de l''union, et la seule donnée du seed qui l''exerce');

-- --- 6.6 Un champ ARCHIVÉ n'exige rien — décision 129 -----------------------------------------
-- Une règle `required` est posée sur le champ archivé `budget-previsionnel` pour l'étape
-- `réalisation`, et la valeur de `…0c7` sur ce champ est retirée. Sans l'exclusion des champs
-- archivés, la transition réclamerait un champ qu'aucun formulaire n'affiche.
select pg_temp.postgres();

insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
values ('5eed0000-0000-4000-8000-000000000087', '5eed0000-0000-4000-8000-000000000065',
        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', 'required');

-- `lien-proposition` est renseigné pour isoler la seule variable qui compte ici.
insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
values ('5eed0000-0000-4000-8000-0000000000c7', '5eed0000-0000-4000-8000-000000000086',
        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
        '"https://p2enjoy.fr/p/formation"'::jsonb)
on conflict (card_id, field_id) do update set value = excluded.value;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c7',
	                        '5eed0000-0000-4000-8000-000000000065') $$,
	'un champ ARCHIVÉ portant une règle `required` n''exige RIEN (décision 129) : exiger un champ '
	'qu''aucun formulaire n''affiche rendrait la transition impossible à satisfaire depuis le '
	'produit');

-- --- 6.7 Un identifiant non résolu est désormais REFUSÉ structurellement — CRM-018 ------------
select pg_temp.postgres();

select throws_ok($$
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075',
	        '5eed0000-0000-4000-8000-0000000000ff') $$,
	'23503', null,
	'CRM-018 : une liaison vers un champ que la clé étrangère ne résout pas est REFUSÉE');

-- --- 6.8 Un champ `hidden` MAIS lié à la transition EST exigé ----------------------------------
-- Le §3.5 dit « indépendamment de l'étape cible ». Une arête déclarée par un administrateur est un
-- geste explicite, là où l'absence de règle est un défaut. Sans cette assertion, cette lecture ne
-- reposerait que sur la prose.
select pg_temp.postgres();

insert into public.workflow_transition_required_fields (transition_id, field_id)
values ('5eed0000-0000-4000-8000-000000000072',
	    '5eed0000-0000-4000-8000-000000000084')
on conflict do nothing;

select is(
	(select r.visibility from public.form_field_rules r
	  where r.field_id = '5eed0000-0000-4000-8000-000000000084'
	    and r.step_id  = '5eed0000-0000-4000-8000-000000000063'),
	'hidden',
	'ÉTAT CONSTATÉ : `motif-perte` est bien `hidden` en négociation. Sans ce constat, l''assertion '
	'suivante serait verte pour la mauvaise raison');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.detail_du_refus('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000063'),
	'motif-perte',
	'un champ `hidden` à l''étape cible MAIS lié à la transition EST exigé : l''union du '
	'§3.5 vaut « indépendamment de l''étape cible »');

-- --- 6.9 Une règle ajoutée après coup n'invalide pas une card DÉJÀ en place --------------------
-- §3.4 : « les données déjà existantes ne sont jamais invalidées rétroactivement ». La card `…0c4`
-- est en négociation ; poser une règle `required` sur un champ vide de cette étape ne la déplace
-- pas et ne l'empêche pas d'être lue.
select pg_temp.postgres();

insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
values ('5eed0000-0000-4000-8000-000000000083', '5eed0000-0000-4000-8000-000000000063',
        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', 'required')
on conflict (field_id, step_id) do update set visibility = 'required';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(select c.current_step_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c4'),
	'5eed0000-0000-4000-8000-000000000063'::uuid,
	'§3.4 : une règle `required` ajoutée APRÈS COUP ne déplace pas la card déjà en place et ne la '
	'rend pas illisible. Rien n''est invalidé rétroactivement');

select isnt(
	(select count(*)::int from public.card_field_values v
	  where v.card_id = '5eed0000-0000-4000-8000-0000000000c4'),
	0,
	'ses valeurs restent lisibles : la règle nouvelle ne les efface pas');

-- =============================================================================================
-- 7. RLS, politiques et privilèges — docs/SPEC-form-composer.md §6.9
-- =============================================================================================

select pg_temp.postgres();

select is(
	(select relrowsecurity from pg_class where oid = 'public.card_field_values'::regclass),
	true,
	'RLS est ACTIVE sur `card_field_values` — activée dans la migration qui crée la table');

select policies_are('public', 'card_field_values',
	array['card_field_values_lecture', 'card_field_values_insertion', 'card_field_values_maj'],
	'trois politiques, et TROIS seulement : aucune politique `for delete` — vider un champ, c''est '
	'écrire `''null''::jsonb` (§6.9)');

select has_function('app', 'can_write_card', array['uuid'],
	'`app.can_write_card` est livrée — décision 130, symétrique d''`app.can_read_card`');

select is(
	(select prosecdef from pg_proc where oid = 'app.can_write_card(uuid)'::regprocedure),
	true, '`app.can_write_card` est `SECURITY DEFINER`');
select is(
	(select proconfig from pg_proc where oid = 'app.can_write_card(uuid)'::regprocedure),
	array['search_path=""'],
	'`search_path` est vidé sur `app.can_write_card` : toute relation y est pleinement qualifiée');
select is(
	has_function_privilege('anon', 'app.can_write_card(uuid)', 'execute'),
	true,
	'`EXECUTE` est accordé à `anon` : sans lui, un appelant anonyme recevrait une ERREUR DE '
	'PRIVILÈGE là où le comportement exigé par §7 est ZÉRO LIGNE. Le droit n''ouvre rien');

-- Le refus de suppression est DOUBLE — décision 96 : ni privilège, ni politique.
select is(
	has_table_privilege('authenticated', 'public.card_field_values', 'delete'),
	false,
	'`authenticated` n''a AUCUN privilège `DELETE` : première des deux barrières');
select is(
	has_table_privilege('authenticated', 'public.card_field_values', 'select'),
	true, '`authenticated` lit');
select is(
	has_table_privilege('authenticated', 'public.card_field_values', 'insert'),
	true, '`authenticated` insère');
select is(
	has_table_privilege('authenticated', 'public.card_field_values', 'update'),
	true, '`authenticated` met à jour');
select is(
	has_table_privilege('anon', 'public.card_field_values', 'select'),
	true,
	'`anon` a le privilège `SELECT` : sans lui, une lecture anonyme rendrait une ERREUR plutôt que '
	'zéro ligne (docs/SPEC-permissions-rls.md §7, preuve n° 11)');
select is(
	has_table_privilege('anon', 'public.card_field_values', 'insert'),
	false, '`anon` n''insère pas');

-- --- 7.1 Le refus par les DROITS, hors interface -----------------------------------------------

select pg_temp.anonyme();

select is(
	(select count(*)::int from public.card_field_values),
	0,
	'PREUVE N° 11 : l''anonyme lit ZÉRO ligne — pas une erreur. Le seed en pose pourtant vingt et une');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');   -- viewer

select is(
	(select count(*)::int from public.card_field_values v
	   join public.cards c   on c.id = v.card_id
	   join public.channels ch on ch.id = c.channel_id
	  where ch.slug = 'grands-comptes'),
	0,
	'PREUVE N° 4 sur les valeurs : le `viewer`, fermé sur le track par un droit fin, ne voit '
	'AUCUNE valeur des cards de `grands-comptes` — zéro ligne, jamais une erreur');

select throws_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c6', '5eed0000-0000-4000-8000-000000000086',
	        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
	        '"https://x.test/y"'::jsonb) $$,
	'42501', null,
	'le `viewer` ne peut pas ÉCRIRE une valeur, même sur une card qu''il voit : `app.can_write_card` '
	'exige le droit d''écriture sur le channel');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');   -- business_developer

select isnt(
	(select count(*)::int from public.card_field_values),
	0,
	'le `business_developer` lit les valeurs des cards qu''il voit : la politique n''est pas un '
	'refus généralisé');

select lives_ok($$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c6', '5eed0000-0000-4000-8000-000000000086',
	        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
	        '"https://x.test/y"'::jsonb) $$,
	'le `business_developer` ÉCRIT sur une card de son workspace : le `RETURNING` de l''insertion '
	'passe la politique `SELECT`, donc le défaut de la décision 107 ne se reproduit pas ici');

-- =============================================================================================
-- 8. Conformité du seed — docs/SPEC-seed.md §2.13
-- =============================================================================================

select pg_temp.postgres();

-- Les blocs 4 et 6 ont écrit dans cette transaction : le décompte porte donc sur ce que le SEED
-- garantit, non sur le total.
select is(
	(select count(*)::int from public.card_field_values v
	  where v.updated_by = '5eed0000-0000-4000-8000-000000000011'
	    and v.card_id in ('5eed0000-0000-4000-8000-0000000000c1',
	                      '5eed0000-0000-4000-8000-0000000000c3',
	                      '5eed0000-0000-4000-8000-0000000000c6')),
	7,
	'le seed pose bien sept valeurs sur les cards `…0c1`, `…0c3` et `…0c6` — docs/SPEC-seed.md §2.13');

select is(
	(select v.value from public.card_field_values v
	  where v.card_id  = '5eed0000-0000-4000-8000-0000000000c1'
	    and v.field_id = '5eed0000-0000-4000-8000-000000000081'),
	null,
	'la LIGNE de `budget` sur `…0c1` existe et sa valeur est vide : c''est la donnée qui démontre '
	'en permanence qu''une ligne présente n''est pas une valeur renseignée (§6.6)');

select is(
	(select count(*)::int from public.card_field_values v
	  where v.card_id = '5eed0000-0000-4000-8000-0000000000c3'
	    and v.field_id = '5eed0000-0000-4000-8000-000000000087'),
	1,
	'le champ ARCHIVÉ `budget-previsionnel` porte une valeur sur `…0c3` : l''archivage retire le '
	'champ des formulaires, il n''efface pas les valeurs déjà saisies (§5, décision 129)');

select is(
	(select r.visibility from public.form_field_rules r
	  where r.field_id = '5eed0000-0000-4000-8000-000000000081'
	    and r.step_id  = '5eed0000-0000-4000-8000-000000000061'),
	'hidden',
	'`budget` est `hidden` en prospection, et `…0c3` — qui y est — porte pourtant une valeur : '
	'c''est la donnée de la section repliée du §4, que `CRM-037` rendra');

-- =============================================================================================
-- 9. Ce qui reste dû, figé par des assertions
-- =============================================================================================
-- Aucune n'est un constat résigné : chacune devient rouge le jour où l'unité qui la porte livre son
-- objet, et force la révision des preuves plutôt que leur silence (décision 51).

-- RÉVISÉE À `CRM-044`, NON RETIRÉE. Elle constatait qu'une valeur écrasée ne laissait AUCUNE
-- trace ; la trace existe désormais, écrite par un trigger de la migration 16. Ce qui reste vrai,
-- et que l'assertion mesure maintenant : `card_field_values` elle-même ne conserve toujours aucun
-- historique — l'auteur précédent d'une valeur est écrasé par `updated_by`, et seule la timeline
-- se souvient.
select has_trigger('public', 'card_field_values', 'card_events_apres_ecriture_valeur',
	'Une valeur écrasée laisse désormais une trace `field_changed` — mais dans `card_events` '
	'(`CRM-044`), la table des valeurs ne conservant toujours AUCUN historique : `updated_by` est '
	'écrasé à chaque écriture');

-- RÉVISÉE UNE TROISIÈME FOIS, JAMAIS RETIRÉE — INC-048 est CLOSE (décisions 367 et 374). Elle
-- constatait l'absence de la table, puis la perte malgré la table ; elle constate désormais que la
-- fonction écrit. La mesure détaillée vit dans `supabase/tests/0013_move_card.test.sql`, sur une
-- vraie transition ; ce qui reste ici est le lien entre les deux suites.
select has_table('public', 'card_comments',
	'INC-048 : `card_comments` existe depuis `CRM-043`');
select ok(
	(select prosrc like '%card_comments%' from pg_proc
	  where oid = 'public.move_card(uuid, uuid, text)'::regprocedure),
	'INC-048, CLOSE : le commentaire exigé par la cinquième vérification de `move_card` est '
	'désormais CONSERVÉ. L''écart a changé de nature deux fois avant d''être refermé');

-- INC-052, SECONDE OCCURRENCE — REFERMÉE. `app.valeur_de_champ_est_vide` employait
-- `btrim(valeur #>> '{}')`, qui ne retire que `U+0020` : une valeur réduite à `"\t"` était
-- RENSEIGNÉE et satisfaisait un champ `required`, là où le prédicat TypeScript de `CRM-037` la
-- disait vide. La décision 165 avait dû faire converger l'interface VERS ce comportement, faute
-- d'arbitrage. L'arbitrage est rendu (lot G, décision 367) : la fonction s'élargit aux blancs
-- Unicode, et les deux lectures convergent dans l'autre sens.
select ok(
	app.valeur_de_champ_est_vide(to_jsonb(E'\t'::text)),
	'INC-052, SECONDE OCCURRENCE REFERMÉE : une valeur réduite à une TABULATION est VIDE. Elle '
	'était renseignée jusqu''à l''arbitrage du lot G, et satisfaisait un champ `required`');

select ok(
	app.valeur_de_champ_est_vide(to_jsonb(E'\u00A0\u2003'::text)),
	'INC-052 : un espace insécable et un cadratin sont vides eux aussi. L''élargissement porte sur '
	'les blancs UNICODE, non sur les seuls blancs ASCII que `btrim(v, E'' \t\r\n'')` aurait couverts');

-- LES CONTRE-CAS NE BOUGENT PAS, et c'est la moitié qui donne sa valeur à l'élargissement : une
-- fonction qui rendrait `true` partout serait verte sur les trois assertions ci-dessus.
select ok(
	not app.valeur_de_champ_est_vide(to_jsonb('0'::text)),
	'INC-052 : `"0"` reste RENSEIGNÉ. Élargir les blancs ne touche pas aux contre-cas du §6.6');

select ok(
	not app.valeur_de_champ_est_vide(to_jsonb(E' Salon '::text)),
	'INC-052 : un texte ENTOURÉ de blancs Unicode reste renseigné — c''est un `btrim`, pas une '
	'suppression de tous les blancs');

rollback;

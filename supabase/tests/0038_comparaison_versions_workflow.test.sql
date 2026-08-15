-- @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, deuxième tranche :
--            comparaison de deux versions
-- @verifies docs/SPEC-workflow-engine.md §7 ter.11.2 (l'identité est un identifiant, jamais une
--            ressemblance), §7 ter.11.3 (le geste et ses quatre refus), §7 ter.11.4 (ce que la
--            fonction rend), §7 ter.11.5 (un seul algorithme appelé six fois)
-- @verifies docs/SCHEMA.md §9 (fonctions et RPC)
-- @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3 au niveau des versions)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. Que la fonction NE PEUT PAS ÉCRIRE et n'usurpe aucun droit : `stable`, et surtout SANS
--    `security definer`. Ce point est vérifié en premier parce que c'est lui qui rend inutile tout
--    contrôle de workspace écrit à la main : la politique de lecture de `workflow_versions` est la
--    règle d'autorisation, et une fonction `definer` la contournerait sans rien dire.
--
-- 2. Que l'ALGORITHME est juste sur des tableaux fabriqués ici, hors de tout workflow. Un défaut
--    d'appariement se lit sur trois objets ; le chercher directement dans un document de
--    composition de plusieurs milliers de caractères le rendrait invisible.
--
-- 3. Que L'IDENTITÉ EST UN IDENTIFIANT ET JAMAIS UNE RESSEMBLANCE (§7 ter.11.2). C'est la règle qui
--    tranche « aucune étape n'est devinée » de la Definition of Done : deux assertions l'éprouvent
--    par ses deux conséquences — un renommage reste UN élément modifié, une suppression suivie
--    d'une recréation à l'identique rend DEUX éléments, un retrait et un ajout.
--
-- 4. Que le geste fonctionne sur de VRAIES versions, publiées par la vraie RPC avec le compte réel
--    de l'administratrice, et que ses quatre refus tombent dans l'ordre.
--
-- AUCUN IDENTIFIANT NON ÉPINGLÉ N'EST ÉCRIT EN DUR. Les identifiants du seed employés ici sont ceux
-- que le seed fixe lui-même (`5eed0000-…`) ; tout le reste est créé par la suite. Le workflow
-- DÉRIVÉ du seed, dont l'identifiant est engendré à la copie et diffère donc d'une base à l'autre,
-- n'est jamais cité — voir INC-122.
--
-- La suite crée ses fixtures par le propriétaire, joue les gestes avec les comptes réels, et fait
-- `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Les deux fonctions, leur volatilité, et l'absence de `security definer`
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'composition_collection_diff', array['jsonb', 'jsonb', 'text[]'],
	'1 — l''algorithme de différence existe');

select has_function('public', 'compare_workflow_versions', array['uuid', 'uuid'],
	'2 — la RPC de comparaison existe');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'compare_workflow_versions'),
	's',
	'3 — la RPC est `stable` : elle ne peut rien écrire, et la lire ne modifie aucune version');

-- L'assertion décisive de cette section. `security invoker` est un CHOIX (§7 ter.11.3) : il fait
-- porter l'autorisation par la politique de lecture, seule et unique formulation de la règle. Le
-- jour où quelqu'un ajouterait `security definer` pour « simplifier », la RPC rendrait les versions
-- de tous les workspaces, et rien d'autre ne le signalerait.
select is(
	(select prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'compare_workflow_versions'),
	false,
	'4 — la RPC n''est PAS `security definer` : la politique de lecture reste la seule autorisation');

select function_privs_are('public', 'compare_workflow_versions', array['uuid', 'uuid'],
	'authenticated', array['EXECUTE'],
	'5 — `authenticated` exécute la comparaison');

select function_privs_are('public', 'compare_workflow_versions', array['uuid', 'uuid'],
	'anon', array[]::text[],
	'6 — `anon` n''a AUCUN droit d''exécution : la révocation nommée a bien été faite (décision 80)');

-- ---------------------------------------------------------------------------------------------
-- 2. L'algorithme, éprouvé hors de tout workflow
-- ---------------------------------------------------------------------------------------------

select is(
	app.composition_collection_diff(
		'[{"id": "a", "label": "X"}]'::jsonb,
		'[{"id": "a", "label": "X"}, {"id": "b", "label": "Y"}]'::jsonb,
		array['id']) -> 'added',
	'[{"element": {"id": "b", "label": "Y"}, "identity": {"id": "b"}}]'::jsonb,
	'7 — AJOUTÉ = présent dans la cible, absent de la base, et le document COMPLET est rendu');

select is(
	app.composition_collection_diff(
		'[{"id": "a"}, {"id": "b"}]'::jsonb,
		'[{"id": "a"}]'::jsonb,
		array['id']) -> 'removed' -> 0 -> 'identity' ->> 'id',
	'b',
	'8 — RETIRÉ = présent dans la base, absent de la cible');

-- SEULS les attributs réellement différents figurent : un écran qui afficherait les treize
-- attributs d'une étape dont un seul a changé serait illisible.
select is(
	app.composition_collection_diff(
		'[{"id": "a", "label": "X", "position": 1}]'::jsonb,
		'[{"id": "a", "label": "Z", "position": 1}]'::jsonb,
		array['id']) -> 'modified' -> 0 -> 'attributes',
	'[{"name": "label", "after": "Z", "before": "X"}]'::jsonb,
	'9 — MODIFIÉ ne porte QUE les attributs réellement différents, avec `before` et `after`');

-- L'union des clés des deux côtés, et non les seules clés de la base : sans elle, un attribut
-- APPARU serait invisible, et c'est exactement ce que produit l'ajout d'une colonne au document.
select is(
	app.composition_collection_diff(
		'[{"id": "a"}]'::jsonb,
		'[{"id": "a", "note": "neuve"}]'::jsonb,
		array['id']) -> 'modified' -> 0 -> 'attributes',
	'[{"name": "note", "after": "neuve", "before": null}]'::jsonb,
	'10 — un attribut APPARU figure avec `before` nul, et non pas absent du résultat');

-- `rules` et `required_fields` n'ont pas d'identifiant propre : leur identité est un COUPLE. Un
-- algorithme qui n'apparierait que sur la première clé rendrait « modifié » là où deux règles
-- distinctes portent sur le même champ à deux étapes.
select is(
	app.composition_collection_diff(
		'[{"field_id": "f1", "step_id": "s1", "visibility": "hidden"},
		  {"field_id": "f1", "step_id": "s2", "visibility": "hidden"}]'::jsonb,
		'[{"field_id": "f1", "step_id": "s1", "visibility": "required"},
		  {"field_id": "f1", "step_id": "s2", "visibility": "hidden"}]'::jsonb,
		array['field_id', 'step_id']) -> 'modified',
	'[{"identity": {"step_id": "s1", "field_id": "f1"},
	   "attributes": [{"name": "visibility", "after": "required", "before": "hidden"}]}]'::jsonb,
	'11 — l''identité de `rules` est le COUPLE (field_id, step_id) : une seule des deux règles bouge');

-- LA RÈGLE DE FOND, première conséquence. Un renommage ne casse PAS l'appariement : c'est
-- l'identifiant qui apparie, jamais le libellé.
select is(
	(select pg_catalog.jsonb_array_length(
		app.composition_collection_diff(
			'[{"id": "a", "label": "Négociation"}]'::jsonb,
			'[{"id": "a", "label": "Négociation commerciale"}]'::jsonb,
			array['id']) -> 'modified')),
	1,
	'12 — une étape RENOMMÉE reste UNE étape modifiée : le libellé n''entre pas dans l''identité');

-- LA RÈGLE DE FOND, seconde conséquence, et celle qui coûte : supprimée puis recréée à l'identique,
-- une étape porte un AUTRE identifiant, donc ce sont deux étapes. Toute autre réponse serait une
-- supposition, et la Definition of Done exige qu'aucune étape ne soit devinée.
select is(
	(select (app.composition_collection_diff(
			'[{"id": "a", "label": "Négociation"}]'::jsonb,
			'[{"id": "b", "label": "Négociation"}]'::jsonb,
			array['id']) -> 'added' ->> 0 is not null)::text
	     || '|' ||
	     (app.composition_collection_diff(
			'[{"id": "a", "label": "Négociation"}]'::jsonb,
			'[{"id": "b", "label": "Négociation"}]'::jsonb,
			array['id']) -> 'removed' ->> 0 is not null)::text),
	'true|true',
	'13 — supprimée puis RECRÉÉE à l''identique, une étape rend un RETRAIT et un AJOUT, jamais un inchangé');

select is(
	app.composition_collection_diff(
		'[{"id": "a"}, {"id": "b"}, {"id": "c"}]'::jsonb,
		'[]'::jsonb,
		array['id']) -> 'removed',
	'[{"element": {"id": "a"}, "identity": {"id": "a"}},
	  {"element": {"id": "b"}, "identity": {"id": "b"}},
	  {"element": {"id": "c"}, "identity": {"id": "c"}}]'::jsonb,
	'14 — les tableaux sont ORDONNÉS par identité : une fonction stable ne rend pas deux ordres');

select is(
	app.composition_collection_diff(null, null, array['id']),
	'{"added": [], "removed": [], "modified": []}'::jsonb,
	'15 — deux collections absentes rendent trois tableaux vides, et non `null`');

-- ---------------------------------------------------------------------------------------------
-- 3. FIXTURE : un workflow de preuve, et deux versions publiées par la VRAIE RPC
-- ---------------------------------------------------------------------------------------------
-- Un workflow créé ici, et non un workflow du seed : asseoir les assertions sur le seed les
-- rendrait fausses au premier ajout de celui-ci. Les identifiants du catalogue employés ci-dessous
-- sont ÉPINGLÉS par le seed (`5eed0000-…-0004x`), à la différence de ceux du workflow dérivé.

insert into public.workflows (id, workspace_id, name, scope, is_default)
values ('c0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', 'Comparaison — workflow de preuve', 'global', false);

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values ('c0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000041', 1, true),
       ('c0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000043', 2, false);

insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id, to_step_id, label)
values ('c0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000012', 'Engager');

-- Version 1, publiée par Camille, administratrice, avec le vrai geste.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select version_number from public.publish_workflow_version(
	          'c0000000-0000-4000-8000-000000000001', 'avant')),
	1,
	'16 — la version 1 est publiée par la vraie RPC, et non insérée à la main');

-- Comparer une version à ELLE-MÊME est accepté : l'écran de la cinquième tranche en a besoin.
select is(
	(select public.compare_workflow_versions(v.id, v.id) -> 'identical'
	   from public.workflow_versions v
	  where v.workflow_id = 'c0000000-0000-4000-8000-000000000001' and v.version_number = 1),
	'true'::jsonb,
	'17 — une version comparée à elle-même rend `identical` vrai');

select is(
	(select public.compare_workflow_versions(v.id, v.id) -> 'summary'
	   from public.workflow_versions v
	  where v.workflow_id = 'c0000000-0000-4000-8000-000000000001' and v.version_number = 1),
	'{"added": 0, "removed": 0, "modified": 0}'::jsonb,
	'18 — et son `summary` est à zéro sur les trois compteurs');

select pg_temp.redevenir_proprietaire();

-- La composition change : une étape AJOUTÉE, une étape RENOMMÉE, la transition RETIRÉE. Trois
-- natures d'écart dans une seule paire, ce qui éprouve aussi le comptage de `summary`.
insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
values ('c0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000044', 3, false);

update public.workflow_steps set label_override = 'Négociation commerciale'
 where id = 'c0000000-0000-4000-8000-000000000012';

delete from public.workflow_transitions where id = 'c0000000-0000-4000-8000-000000000021';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select version_number from public.publish_workflow_version(
	          'c0000000-0000-4000-8000-000000000001', 'apres')),
	2,
	'19 — la version 2 est publiée : la composition a changé, la cinquième vérification passe');

create or replace function pg_temp.comparer(numero_base integer, numero_cible integer)
returns jsonb language sql stable as $$
	select public.compare_workflow_versions(
		(select id from public.workflow_versions
		  where workflow_id = 'c0000000-0000-4000-8000-000000000001' and version_number = numero_base),
		(select id from public.workflow_versions
		  where workflow_id = 'c0000000-0000-4000-8000-000000000001' and version_number = numero_cible));
$$;

select is(
	pg_temp.comparer(1, 2) -> 'identical',
	'false'::jsonb,
	'20 — deux compositions différentes rendent `identical` faux : l''invariant tient dans les deux sens');

select is(
	pg_temp.comparer(1, 2) -> 'changes' -> 'steps' -> 'added' -> 0 -> 'identity' ->> 'id',
	'c0000000-0000-4000-8000-000000000013',
	'21 — l''étape ajoutée figure en `added`, désignée par son identifiant réel');

select is(
	pg_temp.comparer(1, 2) -> 'changes' -> 'steps' -> 'added' -> 0 -> 'element' ->> 'node_key',
	'signature',
	'22 — et son document COMPLET est rendu : un écran peut la nommer sans relire la base');

select is(
	pg_temp.comparer(1, 2) -> 'changes' -> 'steps' -> 'modified' -> 0 -> 'attributes',
	'[{"name": "label_override", "after": "Négociation commerciale", "before": null}]'::jsonb,
	'23 — l''étape renommée est MODIFIÉE, et seul l''attribut changé est rendu');

select is(
	pg_temp.comparer(1, 2) -> 'changes' -> 'transitions' -> 'removed' -> 0 -> 'identity' ->> 'id',
	'c0000000-0000-4000-8000-000000000021',
	'24 — la transition supprimée figure en `removed`');

-- `summary` compte les ÉLÉMENTS et non les attributs : une étape ajoutée, une modifiée, une
-- transition retirée — et le workflow lui-même inchangé, qui ne compte donc pour rien.
select is(
	pg_temp.comparer(1, 2) -> 'summary',
	'{"added": 1, "removed": 1, "modified": 1}'::jsonb,
	'25 — `summary` compte les ÉLÉMENTS, non les attributs');

-- L'ORIENTATION est celle des arguments, et la fonction ne la corrige pas : l'appelant seul sait
-- s'il regarde un historique ou un projet de restauration.
select is(
	pg_temp.comparer(2, 1) -> 'changes' -> 'steps' -> 'removed' -> 0 -> 'identity' ->> 'id',
	'c0000000-0000-4000-8000-000000000013',
	'26 — arguments INVERSÉS, la même étape est `removed` et non `added`');

-- ---------------------------------------------------------------------------------------------
-- 4. Les refus
-- ---------------------------------------------------------------------------------------------
-- Un identifiant inexistant, joué par l'administratrice : le refus n'est donc pas celui du rôle.
-- Une version d'un autre workspace n'est pas donnée à lire par la RLS et rend le MÊME message —
-- éprouvé hors de cette suite par le harnais d'API (§7 ter.11.6, ligne j), aucun second workspace
-- n'existant dans le seed.
select throws_ok(
	format($$select public.compare_workflow_versions(%L, %L)$$,
		'00000000-0000-4000-8000-000000000000',
		(select id from public.workflow_versions
		  where workflow_id = 'c0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'version introuvable',
	'27 — un identifiant de version inexistant rend « version introuvable », et non une erreur serveur');

-- La CIBLE inexistante rend le MÊME message que la base : la fonction ne dit pas laquelle des deux
-- lui manque, et n'est donc pas un oracle d'existence.
select throws_ok(
	format($$select public.compare_workflow_versions(%L, %L)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'c0000000-0000-4000-8000-000000000001' and version_number = 1),
		'00000000-0000-4000-8000-000000000000'),
	'P0001',
	'version introuvable',
	'28 — une CIBLE inexistante rend le même message que la base');

-- Deux versions de workflows distincts ne partagent aucun identifiant : leur comparaison rendrait
-- « tout retiré, tout ajouté », un document que l'appelant prendrait pour une réponse.
select throws_ok(
	format($$select public.compare_workflow_versions(%L, %L)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'c0000000-0000-4000-8000-000000000001' and version_number = 1),
		(select id from public.workflow_versions
		  where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number limit 1)),
	'P0001',
	'versions de workflows differents',
	'29 — deux versions de workflows DIFFÉRENTS sont refusées, et non comparées à vide');

-- Un `viewer` compare : la comparaison est une LECTURE, elle suit la politique de lecture et non
-- le droit d'administration qu'exige la publication.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select pg_temp.comparer(1, 2) -> 'summary' ->> 'added'),
	'1',
	'30 — un `viewer` du workspace compare : lire une version n''exige pas d''être administrateur');

-- Le rôle `authenticated` SANS revendication : `auth.uid()` est nul, et la première vérification
-- tient les appels qui ne passeraient pas par PostgREST.
select pg_temp.redevenir_proprietaire();
set local role authenticated;
select throws_ok(
	format($$select public.compare_workflow_versions(%L, %L)$$,
		'00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'),
	'42501',
	'authentification requise',
	'31 — sans appelant authentifié, la comparaison est refusée avant toute lecture');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

-- @verifies CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, dernière tranche : la
--            comparaison copie ↔ source
-- @verifies docs/SPEC-workflow-engine.md §4 ter.1 (pourquoi `compare_workflow_versions` ne peut pas
--            servir), §4 ter.2 (les clés naturelles), §4 ter.3 (le document naturalisé),
--            §4 ter.4 (le geste), §4 ter.5 (les quatre refus), §4 ter.6 (ce que la fonction rend),
--            §4 ter.7 (ce qu'elle ne fait pas)
-- @verifies docs/SPEC-workflow-engine.md §4.5 (ce que la copie copie, et le remappage par clé
--            naturelle, dont cet appariement est le miroir)
-- @verifies docs/SCHEMA.md §9 (fonctions et RPC)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. Que les deux fonctions NE PEUVENT PAS ÉCRIRE et n'usurpent aucun droit : `stable`, et surtout
--    SANS `security definer`. Le §4.1 interdit toute réapplication automatique ; une fonction
--    `volatile` ou `definer` serait le premier pas vers une resynchronisation silencieuse.
--
-- 2. QUE LA COMPARAISON PAR IDENTIFIANT EST INAPPLICABLE ICI, et ce n'est pas une opinion : zéro
--    étape de la copie du seed partage son identifiant avec une étape de sa source. C'est
--    l'assertion qui justifie l'existence même de cette fonction plutôt qu'un appel à
--    `compare_workflow_versions` (§4 ter.1).
--
-- 3. Que le document NATURALISÉ ne porte aucun identifiant local, et que celui de la copie du seed
--    est ÉGAL à celui de sa source. Une copie que personne n'a touchée se compare à l'identique :
--    c'est la seule réponse acceptable, et c'est le cas d'emploi principal.
--
-- 4. Que chaque forme d'écart est rendue avec l'identité juste — modification d'attribut, retrait,
--    ajout —, et que le renommage d'un champ rend UN RETRAIT ET UN AJOUT, conséquence assumée du
--    §4 ter.2 puisque `key` est la clé d'appariement.
--
-- 5. Que les quatre refus tombent dans l'ordre, éprouvés contre des comptes RÉELS.
--
-- AUCUN IDENTIFIANT NON ÉPINGLÉ N'EST ÉCRIT EN DUR. L'identifiant du workflow DÉRIVÉ du seed est
-- engendré par la fonction de copie et diffère d'une base à l'autre (INC-122, docs/SPEC-seed.md
-- §2.9) : il est toujours retrouvé par `derived_from_workflow_id is not null`.
--
-- La suite dégrade la copie et la source par le propriétaire, joue les gestes avec les comptes
-- réels, et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

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

-- La copie du seed et sa source, retrouvées par le lignage et jamais par un identifiant écrit en
-- dur (INC-122).
create or replace function pg_temp.copie() returns uuid language sql stable as $$
	select id from public.workflows where derived_from_workflow_id is not null order by created_at limit 1;
$$;
create or replace function pg_temp.source() returns uuid language sql stable as $$
	select derived_from_workflow_id from public.workflows
	 where derived_from_workflow_id is not null order by created_at limit 1;
$$;
create or replace function pg_temp.comparer() returns jsonb language sql stable as $$
	select public.compare_workflow_with_source(pg_temp.copie());
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Les deux fonctions, leur volatilité, l'absence de `security definer`, et leurs privilèges
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'workflow_composition_naturel', array['uuid'],
	'1 — le document naturalisé existe');

select has_function('public', 'compare_workflow_with_source', array['uuid'],
	'2 — la RPC de comparaison copie ↔ source existe');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'compare_workflow_with_source'),
	's',
	'3 — la RPC est `stable` : elle ne peut RIEN écrire, et le §4.1 interdit toute réapplication');

-- L'assertion décisive de cette section. `security invoker` est un CHOIX (§4 ter.4) : il fait
-- porter l'autorisation par la politique de lecture de `workflows`, seule et unique formulation de
-- la règle. Le jour où quelqu'un ajouterait `security definer` pour « simplifier », la RPC
-- comparerait les workflows de tous les workspaces, et rien d'autre ne le signalerait.
select is(
	(select prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'compare_workflow_with_source'),
	false,
	'4 — la RPC n''est PAS `security definer` : la politique de lecture reste la seule autorisation');

select is(
	(select proconfig from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'compare_workflow_with_source'),
	array['search_path=""'],
	'5 — le `search_path` de la RPC est fixé à la chaîne vide, et `proconfig` la stocke entre guillemets');

select function_privs_are('public', 'compare_workflow_with_source', array['uuid'],
	'authenticated', array['EXECUTE'],
	'6 — `authenticated` exécute la comparaison');

select function_privs_are('public', 'compare_workflow_with_source', array['uuid'],
	'anon', array[]::text[],
	'7 — `anon` n''a AUCUN droit d''exécution : la révocation nommée a bien été faite (décision 80)');

-- ---------------------------------------------------------------------------------------------
-- 2. Pourquoi cette fonction existe : l'appariement par identifiant est INAPPLICABLE
-- ---------------------------------------------------------------------------------------------
-- Sans cette assertion, rien n'expliquerait pourquoi `compare_workflow_versions` n'a pas été
-- appelée telle quelle. Elle est le fait mesuré qui fonde tout le §4 ter.

select is(
	(select count(*)
	   from pg_catalog.jsonb_array_elements(
	        app.workflow_composition_document(pg_temp.copie()) -> 'steps') as c(v)
	   join pg_catalog.jsonb_array_elements(
	        app.workflow_composition_document(pg_temp.source()) -> 'steps') as s(v)
	     on c.v ->> 'id' = s.v ->> 'id'),
	0::bigint,
	'8 — ZÉRO étape de la copie partage son identifiant avec la source : comparer par `id` rendrait « tout retiré, tout ajouté »');

-- ---------------------------------------------------------------------------------------------
-- 3. Le document naturalisé
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*) from pg_catalog.jsonb_array_elements(
	        app.workflow_composition_naturel(pg_temp.copie()) -> 'steps') as e(v)
	  where e.v ? 'id' or e.v ? 'workflow_id'),
	0::bigint,
	'9 — aucune étape naturalisée ne porte d''identifiant local : ils n''ont aucun sens partagé');

select is(
	(select count(*) from pg_catalog.jsonb_array_elements(
	        app.workflow_composition_naturel(pg_temp.copie()) -> 'transitions') as e(v)
	  where e.v ? 'from_step_id' or e.v ? 'to_step_id' or e.v ? 'id'),
	0::bigint,
	'10 — aucune arête naturalisée ne porte d''identifiant local : son identité est le couple de nœuds');

select ok(
	not (app.workflow_composition_naturel(pg_temp.copie()) ? 'workflow'),
	'11 — la collection `workflow` est ABSENTE : `name`, `scope`, `track_id` et `is_default` ne sont pas copiés (§4.5), et les comparer rendrait divergente toute copie neuve');

select is(
	app.workflow_composition_naturel(pg_temp.copie()),
	app.workflow_composition_naturel(pg_temp.source()),
	'12 — le document naturalisé de la copie du seed est ÉGAL à celui de sa source');

-- ---------------------------------------------------------------------------------------------
-- 4. Le geste sur la copie du seed, avec les comptes réels
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(pg_temp.comparer() -> 'identical')::text,
	'true',
	'13 — une copie que personne n''a touchée est déclarée identique à sa source');

select is(
	pg_temp.comparer() -> 'summary',
	'{"added": 0, "removed": 0, "modified": 0}'::jsonb,
	'14 — les trois compteurs sont à zéro, et `summary` compte des ÉLÉMENTS');

select is(
	pg_temp.comparer() -> 'source' ->> 'workflow_id',
	pg_temp.source()::text,
	'15 — la source rendue est celle du lignage, lue dans `derived_from_workflow_id`');

-- Comparer est une LECTURE : le §4 ter.8 ligne b l'exige, et un lecteur seul du workspace doit
-- obtenir le même document qu'un administrateur.
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(pg_temp.comparer() -> 'identical')::text,
	'true',
	'16 — un `viewer` compare : ce geste est une lecture, il n''exige pas d''être administrateur');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 5. Chaque forme d'écart, avec l'identité juste
-- ---------------------------------------------------------------------------------------------
-- Les dégradations sont faites par le propriétaire — le point éprouvé ici est l'appariement, pas
-- l'autorisation d'écriture, déjà prouvée par `CRM-031`.

-- 5.a Un attribut d'étape modifié dans la copie.
update public.workflow_steps
   set position = position + 100
 where workflow_id = pg_temp.copie()
   and node_id = (select node_id from public.workflow_steps
                   where workflow_id = pg_temp.copie() order by position limit 1);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(pg_temp.comparer() -> 'identical')::text,
	'false',
	'17 — une position changée dans la copie fait tomber `identical`');

select is(
	pg_temp.comparer() -> 'changes' -> 'steps' -> 'modified' -> 0 -> 'attributes' -> 0 ->> 'name',
	'position',
	'18 — l''attribut qui a changé est NOMMÉ, et lui seul');

select is(
	(pg_temp.comparer() -> 'changes' -> 'steps' -> 'modified' -> 0 -> 'attributes' -> 0 -> 'before')::text,
	'1',
	'19 — la valeur AVANT est celle de la source : l''orientation est fixe, la source est la base');

select pg_temp.redevenir_proprietaire();
update public.workflow_steps
   set position = position - 100
 where workflow_id = pg_temp.copie() and position > 100;

-- 5.b Une étape retirée de la copie.
create temporary table pg_temp_etape_retiree as
	select * from public.workflow_steps
	 where workflow_id = pg_temp.copie() and not is_initial
	 order by position desc limit 1;

-- La table de sauvegarde est lue plus bas SOUS le rôle `authenticated`, qui n'hérite d'aucun droit
-- sur les tables temporaires de la session : sans ce `grant`, l'assertion échouerait sur un défaut
-- de droit du harnais et non sur le produit.
grant select on pg_temp_etape_retiree to authenticated;

delete from public.workflow_steps
 where id in (select id from pg_temp_etape_retiree);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.comparer() -> 'changes' -> 'steps' -> 'removed' -> 0 -> 'identity' ->> 'node_id',
	(select node_id::text from pg_temp_etape_retiree),
	'20 — une étape absente de la copie est RETIRÉE, et son identité est le `node_id`');

select pg_temp.redevenir_proprietaire();
insert into public.workflow_steps select * from pg_temp_etape_retiree;

-- 5.c Le libellé d'une arête modifié dans la SOURCE : la modification se lit dans l'autre sens, et
--     l'identité reste le couple de nœuds.
update public.workflow_transitions
   set label = 'Libellé changé dans la source'
 where id = (select id from public.workflow_transitions
              where workflow_id = pg_temp.source() and label is not null
              order by id limit 1);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.comparer() -> 'changes' -> 'transitions' -> 'modified' -> 0 -> 'attributes' -> 0 ->> 'name',
	'label',
	'21 — un libellé d''arête changé dans la source est une MODIFICATION, jamais un retrait suivi d''un ajout');

select ok(
	(pg_temp.comparer() -> 'changes' -> 'transitions' -> 'modified' -> 0 -> 'identity') ? 'from_node_id',
	'22 — l''identité d''une arête est le couple de nœuds, garanti unique par `workflow_transitions_workflow_from_to_key`');

select pg_temp.redevenir_proprietaire();

-- 5.d Un champ RENOMMÉ dans la copie. Conséquence assumée du §4 ter.2 : `key` étant la clé
--     d'appariement — celle-là même que la copie remappe —, le renommer rend UN RETRAIT ET UN
--     AJOUT, jamais une modification. Toute autre réponse serait une supposition.
update public.form_fields
   set key = 'cle-renommee-par-le-test'
 where id = (select id from public.form_fields
              where workflow_id = pg_temp.copie() order by position limit 1);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.comparer() -> 'changes' -> 'fields' -> 'added' -> 0 -> 'identity' ->> 'key',
	'cle-renommee-par-le-test',
	'23 — un champ renommé dans la copie est AJOUTÉ sous sa nouvelle clé, et retiré sous l''ancienne');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 6. Les quatre refus
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	format($$select public.compare_workflow_with_source(%L)$$, pg_temp.source()),
	'P0001',
	'workflow non derive',
	'24 — le workflow par défaut n''est la copie de personne : refus n° 3, et non une réponse vide');

select throws_ok(
	format($$select public.compare_workflow_with_source(%L)$$, '00000000-0000-4000-8000-000000000000'),
	'P0001',
	'workflow introuvable',
	'25 — un identifiant inexistant est refusé : refus n° 2');

-- Le refus n° 2 vaut aussi pour un workflow d'un AUTRE workspace, que la RLS ne donne pas à lire :
-- le message est le MÊME, la fonction n'est donc pas un oracle d'existence (§4 ter.4). Le workflow
-- de contrôle est créé par le propriétaire dans un workspace dont l'administratrice n'est pas
-- membre, puis retiré par le `rollback` final.
select pg_temp.redevenir_proprietaire();

insert into public.workspaces (id, name, slug)
values ('c0dec0de-0000-4000-8000-000000000001', 'Workspace de contrôle', 'workspace-de-controle');

insert into public.workflows (id, workspace_id, name, scope, derived_from_workflow_id)
values ('c0dec0de-0000-4000-8000-000000000002', 'c0dec0de-0000-4000-8000-000000000001',
        'Workflow étranger', 'global', null);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	format($$select public.compare_workflow_with_source(%L)$$, 'c0dec0de-0000-4000-8000-000000000002'),
	'P0001',
	'workflow introuvable',
	'26 — un workflow d''un AUTRE workspace rend le même message qu''un identifiant inventé : aucun oracle d''existence');

-- Refus n° 4 : la source existe, mais elle n'est pas lisible par l'appelant. Le chemin est distinct
-- de la suppression, que `on delete set null` ramène au refus n° 3 (§4 ter.5).
select pg_temp.redevenir_proprietaire();

update public.workflows
   set derived_from_workflow_id = 'c0dec0de-0000-4000-8000-000000000002'
 where id = pg_temp.copie();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	format($$select public.compare_workflow_with_source(%L)$$, pg_temp.copie()),
	'P0001',
	'source introuvable',
	'27 — une source devenue illisible est refusée en n° 4, et jamais comparée à un document vide');

-- Refus n° 1 : le rôle `authenticated` SANS revendication. `auth.uid()` est nul, et le premier
-- contrôle tient les appels qui ne passeraient pas par PostgREST.
select pg_temp.redevenir_proprietaire();
set local role authenticated;

select throws_ok(
	format($$select public.compare_workflow_with_source(%L)$$, '00000000-0000-4000-8000-000000000000'),
	'42501',
	'authentification requise',
	'28 — sans appelant authentifié, la comparaison est refusée AVANT toute lecture');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

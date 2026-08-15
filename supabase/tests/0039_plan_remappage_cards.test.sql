-- @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, troisième tranche : le plan
--            de remappage des cards
-- @verifies docs/SPEC-workflow-engine.md §7 ter.12.2 (les trois issues d'une card, et la seule qui
--            soit automatique), §7 ter.12.3 (les instructions portent sur les étapes),
--            §7 ter.12.4 (le geste, `security invoker` et ses huit refus), §7 ter.12.5 (quelles
--            cards entrent dans le plan), §7 ter.12.6 (ce que la fonction rend), §7 ter.12.7
--            (liste bornée, troncature annoncée, ordre qui place les blocages en tête)
-- @verifies docs/SPEC-permissions-rls.md §2.2 (règle 2 : un administrateur n'est jamais restreint),
--            §7 (preuve de refus n° 3 au niveau des versions)
-- @verifies docs/SPEC-cards.md §4 (archivage et corbeille sont deux suppressions DOUCES)
-- @verifies docs/SCHEMA.md §9 (fonctions et RPC)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. Que la fonction NE PEUT PAS ÉCRIRE et n'usurpe aucun droit : `stable`, et surtout SANS
--    `security definer`.
--
-- 2. QUE `security invoker` SUFFIT, ET C'EST LA SECTION LA PLUS IMPORTANTE. Un plan partiel est
--    pire qu'un refus : il ferait échouer une restauration après l'avoir déclarée sûre. La suite
--    MESURE donc que l'administratrice lit AUTANT d'affaires que le propriétaire de la base
--    — malgré un droit fin `none` que le seed lui oppose —, et que la lectrice en lit STRICTEMENT
--    MOINS. Sans cette seconde assertion, la première serait vraie sans rien prouver.
--
-- 3. Que la règle de résolution est juste sur de VRAIES affaires : `unchanged`, `unresolved` puis
--    `remapped`, et qu'une étape RÉTABLIE n'est jamais proposée comme destination.
--
-- 4. Que les compteurs ne dépendent PAS de la taille de la page, et que l'ordre place les affaires
--    bloquantes en tête — sans quoi une troncature masquerait exactement ce qu'il faut voir.
--
-- 5. Que les huit refus tombent, dans l'ordre, contre des comptes réels.
--
-- AUCUN IDENTIFIANT NON ÉPINGLÉ N'EST ÉCRIT EN DUR. Les identifiants du seed employés ici sont ceux
-- que le seed fixe lui-même (`5eed0000-…`) ; tout le reste est créé par la suite. Le workflow
-- DÉRIVÉ du seed, dont l'identifiant est engendré à la copie, n'est jamais cité — voir INC-122.
--
-- AUCUN COMPTE DU SEED N'EST FIGÉ EN DUR : les assertions d'exhaustivité comparent des comptes
-- entre eux plutôt qu'à une constante, et restent donc justes au premier ajout du seed.
--
-- La suite crée ses fixtures par le propriétaire, joue les gestes avec les comptes réels, et fait
-- `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

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

-- Compte les affaires du workflow par défaut du seed SOUS L'IDENTITÉ DONNÉE, droits fins compris.
-- C'est la sonde de la section 2 : elle mesure ce que la politique de lecture de `cards` accorde
-- réellement, sans passer par le plan, donc sans que le résultat puisse être une propriété de la
-- fonction éprouvée.
create or replace function pg_temp.compter_sous(utilisateur uuid)
returns bigint language plpgsql as $$
declare nombre bigint;
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
	select pg_catalog.count(*) into nombre
	  from public.cards
	 where workflow_id = '5eed0000-0000-4000-8000-000000000051';
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
	return nombre;
end;
$$;

-- Raccourci de lecture : le plan de la version `n` du workflow de preuve.
create or replace function pg_temp.planifier(numero integer, instructions jsonb default null,
                                             borne integer default 200)
returns jsonb language sql as $$
	select public.plan_card_remapping(v.id, instructions, borne)
	  from public.workflow_versions v
	 where v.workflow_id = 'd0000000-0000-4000-8000-000000000001'
	   and v.version_number = numero;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La fonction, sa volatilité, l'absence de `security definer`, ses privilèges
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'plan_card_remapping', array['uuid', 'jsonb', 'integer'],
	'1 — la RPC de plan de remappage existe');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'plan_card_remapping'),
	's',
	'2 — la RPC est `stable` : planifier ne déplace aucune affaire et ne réserve rien');

-- L'assertion décisive de cette section, et le pendant de l'assertion 4 de la suite 0038. Ici elle
-- porte DEUX règles à la fois : aucune usurpation de droit, ET le fait que l'exhaustivité repose
-- sur la réservation aux administrateurs plutôt que sur un emprunt de privilèges.
select is(
	(select prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'plan_card_remapping'),
	false,
	'3 — la RPC n''est PAS `security definer` : l''exhaustivité vient de la vérification 3, pas d''un emprunt');

select function_privs_are('public', 'plan_card_remapping', array['uuid', 'jsonb', 'integer'],
	'authenticated', array['EXECUTE'],
	'4 — `authenticated` exécute le plan');

select function_privs_are('public', 'plan_card_remapping', array['uuid', 'jsonb', 'integer'],
	'service_role', array['EXECUTE'],
	'5 — `service_role` exécute le plan');

-- La révocation NOMMÉE d'`anon` : sans elle, l'anonyme obtiendrait 403 au lieu de 401, et la
-- première vérification serait le seul rempart (décision 80).
select function_privs_are('public', 'plan_card_remapping', array['uuid', 'jsonb', 'integer'],
	'anon', array[]::text[],
	'6 — `anon` n''a AUCUN privilège : la révocation nommée est en place');

-- ---------------------------------------------------------------------------------------------
-- 2. POURQUOI `security invoker` SUFFIT — et c'est une mesure, pas une intention
-- ---------------------------------------------------------------------------------------------
-- `public.cards` applique les droits fins dès sa politique de lecture. Un plan calculé sous
-- `security invoker` n'est donc exhaustif que si son appelant n'est jamais restreint. La règle 2
-- d'`app.resolve_access` l'affirme des administrateurs ; les trois assertions ci-dessous
-- l'ÉPROUVENT sur les vraies données du seed.

select isnt_empty(
	$$select 1 from public.track_members tm
	   where tm.user_id = '5eed0000-0000-4000-8000-000000000011' and tm.access = 'none'$$,
	'7 — le seed oppose bien un droit fin `none` à l''administratrice : les deux assertions suivantes ne sont pas vides de sens');

select is(
	(select pg_temp.compter_sous('5eed0000-0000-4000-8000-000000000011')),
	(select pg_catalog.count(*)::bigint from public.cards
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	'8 — l''administratrice lit AUTANT d''affaires que le propriétaire : le plan est EXHAUSTIF sous `security invoker`');

select cmp_ok(
	(select pg_temp.compter_sous('5eed0000-0000-4000-8000-000000000013')),
	'<',
	(select pg_catalog.count(*)::bigint from public.cards
	  where workflow_id = '5eed0000-0000-4000-8000-000000000051'),
	'9 — la lectrice en lit STRICTEMENT MOINS : un plan calculé pour elle serait PARTIEL, d''où la vérification 3');

-- ---------------------------------------------------------------------------------------------
-- 3. FIXTURE : un workflow de preuve, son channel, ses affaires — dont une archivée et une en
--    corbeille
-- ---------------------------------------------------------------------------------------------
-- Un workflow créé ici, et non celui du seed : asseoir les assertions sur le seed les rendrait
-- fausses au premier ajout de celui-ci. `scope = 'global'` pour que n'importe quel channel puisse
-- le porter sans buter sur la contrainte d'affectation du §4.12.

insert into public.workflows (id, workspace_id, name, scope, is_default)
values ('d0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', 'Remappage — workflow de preuve', 'global', false);

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial,
                                   label_override)
values ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000041', 1, true,
        'Départ'),
       ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000043', 2, false,
        'Arrivée');

insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position)
values ('d0000000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000022', 'tst CRM-078 remappage', 'tst-crm-078-remappage',
        'd0000000-0000-4000-8000-000000000001', 99);

-- QUATRE affaires, dont une ARCHIVÉE et une en CORBEILLE. Les deux dernières ne sont pas un décor :
-- elles portent un `current_step_id` réel et une clé étrangère opposable, et une restauration qui
-- les ignorerait échouerait en base (docs/SPEC-cards.md §4).
insert into public.cards (id, workspace_id, channel_id, workflow_id, current_step_id, title,
                          position, entered_step_at, archived_at, deleted_at)
values ('d0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000011', 'tst remappage active', 1,
        '2020-01-01T00:00:00Z', null, null),
       ('d0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000012', 'tst remappage seconde', 2,
        '2020-01-01T00:00:00Z', null, null),
       ('d0000000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000011', 'tst remappage archivée', 3,
        '2020-01-01T00:00:00Z', now(), null),
       ('d0000000-0000-4000-8000-0000000000a4', '5eed0000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000011', 'tst remappage corbeille', 4,
        '2020-01-01T00:00:00Z', null, now());

-- Version 1, publiée par Camille, administratrice, avec le VRAI geste.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select version_number from public.publish_workflow_version(
	          'd0000000-0000-4000-8000-000000000001', 'avant remappage')),
	1,
	'10 — la version 1 est publiée par la vraie RPC, et non insérée à la main');

-- ---------------------------------------------------------------------------------------------
-- 4. Le cas nominal : la version décrit la structure vivante, rien ne bouge
-- ---------------------------------------------------------------------------------------------

select is(
	pg_temp.planifier(1) -> 'ready',
	'true'::jsonb,
	'11 — une version égale à la structure vivante rend un plan `ready`');

select is(
	pg_temp.planifier(1) -> 'summary',
	'{"cards_total": 4, "steps_removed": 0, "cards_remapped": 0, "steps_restored": 0,
	  "cards_unchanged": 4, "cards_unresolved": 0}'::jsonb,
	'12 — les quatre affaires sont `unchanged`, et aucune étape n''est retirée ni rétablie');

select is(
	pg_temp.planifier(1) -> 'steps',
	'{"removed": [], "restored": []}'::jsonb,
	'13 — les deux listes d''étapes sont vides, et non `null`');

-- L'ARCHIVÉE ET CELLE EN CORBEILLE SONT DANS LE PLAN, avec leur `state`. Les exclure aurait rendu
-- un plan qui se dit complet et une restauration qui échoue sur une affaire que personne ne
-- regardait plus.
select is(
	(select pg_catalog.jsonb_agg(e.value ->> 'state' order by e.value ->> 'card_id')
	   from pg_catalog.jsonb_array_elements(pg_temp.planifier(1) -> 'cards' -> 'items') as e(value)),
	'["active", "active", "archived", "deleted"]'::jsonb,
	'14 — les affaires ARCHIVÉE et en CORBEILLE sont dans le plan, avec leur `state`');

-- ---------------------------------------------------------------------------------------------
-- 5. Une étape retirée, et l'aveu d'ignorance qui en découle
-- ---------------------------------------------------------------------------------------------
-- La structure vivante gagne une étape que la version 1 ne connaît pas, et deux affaires y sont
-- déplacées. Restaurer la version 1 ferait donc disparaître cette étape sous les affaires.

select pg_temp.redevenir_proprietaire();

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial,
                                   label_override)
values ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000044', 3, false,
        'Étape née après la version');

update public.cards set current_step_id = 'd0000000-0000-4000-8000-000000000013'
 where id in ('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a4');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.planifier(1) -> 'ready',
	'false'::jsonb,
	'15 — deux affaires sur une étape retirée : le plan N''EST PAS prêt');

select is(
	pg_temp.planifier(1) -> 'summary',
	'{"cards_total": 4, "steps_removed": 1, "cards_remapped": 0, "steps_restored": 0,
	  "cards_unchanged": 2, "cards_unresolved": 2}'::jsonb,
	'16 — deux affaires restent `unresolved` : AUCUNE destination n''est devinée');

-- Le libellé d'une étape RETIRÉE est lu sur la structure VIVANTE, seul endroit où elle existe
-- encore au moment du plan.
select is(
	pg_temp.planifier(1) -> 'steps' -> 'removed',
	'[{"label": "Étape née après la version", "step_id": "d0000000-0000-4000-8000-000000000013",
	   "cards_total": 2, "target_step_id": null, "cards_unresolved": 2}]'::jsonb,
	'17 — l''étape retirée est NOMMÉE, avec le compte des affaires qu''elle porte et de celles qui bloquent');

select is(
	(select e.value ->> 'target_step_id'
	   from pg_catalog.jsonb_array_elements(pg_temp.planifier(1) -> 'cards' -> 'items') as e(value)
	  where e.value ->> 'card_id' = 'd0000000-0000-4000-8000-0000000000a1'),
	null,
	'18 — une affaire `unresolved` porte une destination NULLE, et non une étape choisie pour elle');

-- ---------------------------------------------------------------------------------------------
-- 6. L'instruction lève le blocage — et elle seule
-- ---------------------------------------------------------------------------------------------

select is(
	pg_temp.planifier(1, '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	                        "to_step_id":   "d0000000-0000-4000-8000-000000000011"}]'::jsonb) -> 'ready',
	'true'::jsonb,
	'19 — une instruction couvrant l''étape retirée rend le plan prêt');

select is(
	pg_temp.planifier(1, '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	                        "to_step_id":   "d0000000-0000-4000-8000-000000000011"}]'::jsonb)
	  -> 'summary',
	'{"cards_total": 4, "steps_removed": 1, "cards_remapped": 2, "steps_restored": 0,
	  "cards_unchanged": 2, "cards_unresolved": 0}'::jsonb,
	'20 — les deux affaires passent en `remapped`, et aucune ne reste sans destination');

select is(
	(select e.value ->> 'target_step_id'
	   from pg_catalog.jsonb_array_elements(
	        pg_temp.planifier(1, '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	                                "to_step_id":   "d0000000-0000-4000-8000-000000000011"}]'::jsonb)
	        -> 'cards' -> 'items') as e(value)
	  where e.value ->> 'card_id' = 'd0000000-0000-4000-8000-0000000000a4'),
	'd0000000-0000-4000-8000-000000000011',
	'21 — l''affaire en CORBEILLE est remappée comme les autres : elle porte la même clé étrangère');

-- ---------------------------------------------------------------------------------------------
-- 7. UNE ÉTAPE RÉTABLIE EST NOMMÉE, JAMAIS CHOISIE
-- ---------------------------------------------------------------------------------------------
-- L'étape « Arrivée » est supprimée de la structure vivante après le déplacement de son affaire.
-- Elle figure toujours dans la version 1 : la restauration la recréerait. Il serait tentant d'y
-- verser les affaires des étapes retirées « puisqu'elle revient » — ce serait une supposition.

select pg_temp.redevenir_proprietaire();

update public.cards set current_step_id = 'd0000000-0000-4000-8000-000000000011'
 where id = 'd0000000-0000-4000-8000-0000000000a2';
delete from public.workflow_steps where id = 'd0000000-0000-4000-8000-000000000012';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	pg_temp.planifier(1) -> 'steps' -> 'restored',
	'[{"label": "Arrivée", "step_id": "d0000000-0000-4000-8000-000000000012"}]'::jsonb,
	'22 — une étape RÉTABLIE est nommée avec le libellé du DOCUMENT, seul endroit où il subsiste');

-- La preuve de fond : l'étape rétablie est disponible, et pourtant les deux affaires bloquées le
-- restent. Le produit préfère dire « je ne sais pas » plutôt que choisir à la place de l'humain.
select is(
	pg_temp.planifier(1) -> 'summary' -> 'cards_unresolved',
	'2'::jsonb,
	'23 — une étape rétablie n''est JAMAIS proposée comme destination : les affaires restent `unresolved`');

-- ---------------------------------------------------------------------------------------------
-- 8. La liste est bornée, la troncature est annoncée, et l'ordre place les blocages en tête
-- ---------------------------------------------------------------------------------------------

select is(
	(pg_temp.planifier(1, null, 1) -> 'cards') - 'items'::text,
	'{"limit": 1, "total": 4, "returned": 1, "truncated": true}'::jsonb,
	'24 — la liste est bornée et sa troncature est ANNONCÉE : `total` reste le compte réel');

-- LES COMPTEURS NE DÉPENDENT PAS DE LA PAGE. Un verdict qui changerait avec la taille de la page
-- ne serait pas un verdict.
select is(
	pg_temp.planifier(1, null, 1) -> 'summary',
	pg_temp.planifier(1, null, 200) -> 'summary',
	'25 — les compteurs sont IDENTIQUES quelle que soit la borne : ils portent sur la totalité');

-- L'ORDRE EST UNE PROPRIÉTÉ DE SÉCURITÉ D'USAGE, pas une commodité : tronquée à une ligne, la liste
-- montre une affaire BLOQUANTE, jamais une affaire tranquille.
select is(
	pg_temp.planifier(1, null, 1) -> 'cards' -> 'items' -> 0 ->> 'resolution',
	'unresolved',
	'26 — tronquée, la liste montre d''abord ce qui BLOQUE : un ordre par titre aurait masqué le blocage');

select is(
	pg_temp.planifier(1, '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	                        "to_step_id":   "d0000000-0000-4000-8000-000000000011"}]'::jsonb, 1)
	  -> 'cards' -> 'items' -> 0 ->> 'resolution',
	'remapped',
	'27 — plus rien ne bloquant, la liste tronquée montre d''abord les affaires DÉPLACÉES');

-- ---------------------------------------------------------------------------------------------
-- 9. Les huit refus, contre des comptes réels
-- ---------------------------------------------------------------------------------------------

select throws_ok(
	format($$select public.plan_card_remapping(%L)$$, '00000000-0000-4000-8000-000000000000'),
	'P0001',
	'version introuvable',
	'28 — refus n° 2 : un identifiant de version inexistant, et non une erreur serveur');

select throws_ok(
	format($$select public.plan_card_remapping(%L, null, 0)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'limite invalide',
	'29 — refus n° 4 : une borne nulle ou négative est refusée, et non silencieusement corrigée');

select throws_ok(
	format($$select public.plan_card_remapping(%L, '{"a": 1}'::jsonb)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'remappage invalide',
	'30 — refus n° 5 : `step_overrides` qui n''est pas un tableau');

select throws_ok(
	format($$select public.plan_card_remapping(%L,
	         '[{"from_step_id": "pas-un-identifiant",
	            "to_step_id":   "d0000000-0000-4000-8000-000000000011"}]'::jsonb)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'remappage invalide',
	'31 — refus n° 5 : un identifiant mal formé rend un refus de FORME, et non une erreur `22P02` brute');

select throws_ok(
	format($$select public.plan_card_remapping(%L,
	         '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	            "to_step_id":   "d0000000-0000-4000-8000-000000000011"},
	           {"from_step_id": "d0000000-0000-4000-8000-000000000013",
	            "to_step_id":   "d0000000-0000-4000-8000-000000000012"}]'::jsonb)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'remappage ambigu',
	'32 — refus n° 6 : deux destinations pour la même étape ne se départagent pas, et en choisir une serait deviner');

-- Une instruction visant une étape qui SURVIT est soit une erreur, soit un déplacement de masse
-- déguisé : l'accepter en silence ferait du plan un geste d'écriture par procuration.
select throws_ok(
	format($$select public.plan_card_remapping(%L,
	         '[{"from_step_id": "d0000000-0000-4000-8000-000000000011",
	            "to_step_id":   "d0000000-0000-4000-8000-000000000012"}]'::jsonb)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'origine de remappage inconnue',
	'33 — refus n° 7 : une instruction sur une étape CONSERVÉE est refusée, et non appliquée en silence');

select throws_ok(
	format($$select public.plan_card_remapping(%L,
	         '[{"from_step_id": "d0000000-0000-4000-8000-000000000013",
	            "to_step_id":   "00000000-0000-4000-8000-000000000000"}]'::jsonb)$$,
		(select id from public.workflow_versions
		  where workflow_id = 'd0000000-0000-4000-8000-000000000001' and version_number = 1)),
	'P0001',
	'cible de remappage absente de la version',
	'34 — refus n° 8 : remapper vers une étape absente de la version ne rendrait pas le plan applicable');

-- Refus n° 3, contre les DEUX profils non administrateurs, et avec le MÊME message : le plan n'est
-- pas un oracle de droits fins.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	format($$select public.plan_card_remapping(%L)$$,
		(select id from public.workflow_versions
		  where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number limit 1)),
	'42501',
	'plan reserve aux administrateurs',
	'35 — refus n° 3 : un `business_developer` est refusé — son plan serait PARTIEL');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok(
	format($$select public.plan_card_remapping(%L)$$,
		(select id from public.workflow_versions
		  where workflow_id = '5eed0000-0000-4000-8000-000000000051' order by version_number limit 1)),
	'42501',
	'plan reserve aux administrateurs',
	'36 — refus n° 3 : une `viewer` reçoit le MÊME message, et non un refus qui la renseignerait');

-- Le rôle `authenticated` SANS revendication : `auth.uid()` est nul, et la première vérification
-- tient les appels qui ne passeraient pas par PostgREST.
select pg_temp.redevenir_proprietaire();
set local role authenticated;
select throws_ok(
	format($$select public.plan_card_remapping(%L)$$, '00000000-0000-4000-8000-000000000000'),
	'42501',
	'authentification requise',
	'37 — refus n° 1 : sans appelant authentifié, le plan est refusé avant toute lecture');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

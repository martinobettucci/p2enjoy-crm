-- @verifies CRM-045 (docs/BACKLOG.md) — déplacement d'une card entre channels
-- @verifies docs/SPEC-workflow-engine.md §6.2 (signature), §6.3 (ce que la base interdit déjà),
--           §6.4 (les huit vérifications), §6.5 (effets), §6.6 (réponses de formulaire),
--           §6.7 (l'événement), §6.8 (privilèges), §6.12 (seed), §6.13 (preuves attendues)
-- @verifies docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`),
--           §5 (« active »), §14.4 (dix types), §14.6 (payload), §14.8 (immuabilité)
-- @verifies docs/SPEC-permissions-rls.md §3.3 (droits effectifs), §7 (preuves de refus n° 1, n° 5)
-- @verifies docs/SCHEMA.md §5 (card_events), §9 (fonctions)
-- @verifies docs/SPEC-seed.md §2.16 (aller-retour de channel)
-- @verifies docs/JOURNAL.md décisions 213 à 218
-- @verifies docs/INCONSISTENCY_REPORT.md INC-073 (`step_mapping`), INC-046 (non levée)
--
-- Suite pgTAP de l'unité `CRM-045`. Elle prouve huit choses :
--
--   1. la **forme** de la fonction — signature, type de retour composite, `SECURITY DEFINER`,
--      `search_path` vidé, propriétaire — et ses **privilèges**, `anon` nommément exclu ;
--   2. les **huit vérifications**, chacune dans les **DEUX SENS** quand le sens inverse existe.
--      Une assertion qui ne prouverait que le refus serait verte sur une fonction qui refuse tout ;
--   3. la **règle de discrétion**, éprouvée avec le **même profil** dans les deux cas — la seule
--      façon d'exclure que l'écart vienne du profil plutôt que de la règle ;
--   4. les **effets** du succès : les trois colonnes de rattachement, `position` recalculée en fin
--      de colonne d'arrivée, et `entered_step_at` **conditionnelle** (décision 217) ;
--   5. l'**événement**, son `payload` complet, et l'**absence** de `moved` à côté (décision 215) ;
--   6. le fait que le trigger couvre **strictement plus** que la RPC : un `UPDATE` direct sous le
--      propriétaire produit l'événement lui aussi ;
--   7. les **réponses de formulaire** : conservées à workflow identique, refus chiffré sans
--      `discard_field_values`, supprimées avec — et les `field_changed` **conservés** (décision 216) ;
--   8. ce que la migration NE pose PAS : `channel_id` et `workflow_id` fermés depuis `CRM-013`,
--      figés ici pour qu'un relâchement futur soit dénoncé (décision 214).
--
-- Exécution : `npm run test:sql`, `scripts/verify-move-card-to-channel.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0019_move_card_to_channel.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier.

begin;

create extension if not exists pgtap with schema extensions;

select plan(67);

-- Raccourcis vers les objets du seed, seule source de données de cette suite. Les identifiants
-- sont stables par contrat (docs/SPEC-seed.md, docs/SPEC-cards.md §9).
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

-- Première étape du workflow DÉRIVÉ. Ses identifiants sont tirés au hasard par
-- `copy_workflow_to_track` : ils ne peuvent pas être écrits en dur (docs/SPEC-seed.md §2.9).
create or replace function pg_temp.etape_derivee()
returns uuid language sql stable as $$
	select s.id
	  from public.workflow_steps s
	  join public.channels ch on ch.workflow_id = s.workflow_id
	 where ch.id = '5eed0000-0000-4000-8000-000000000031'
	 order by s.position
	 limit 1;
$$;

-- Le seed, rappelé ici parce que chaque assertion s'y adosse (docs/SPEC-seed.md) :
--
--   channels 31 prospection (workflow DÉRIVÉ, track 21) · 32 grands-comptes · 33 appels-offres
--            34 refonte · 35 maintenance · 36 inter-entreprises   ← les cinq sur le workflow global
--   cards    c1 (32, étape 62, 2 réponses) · c5 (35, étape 61, AUCUNE réponse)
--            c8 ARCHIVÉE · c9 CORBEILLE
--   profils  11 admin · 12 business_developer · 13 viewer
--
-- Droits fins seedés, MESURÉS et non supposés (docs/SPEC-permissions-rls.md §2.2) :
--   * le viewer a `none` sur le track 21 → il ne voit AUCUNE card de `grands-comptes` ;
--   * il voit en revanche celles de `inter-entreprises`, sans droit d'écriture ;
--   * le bizdev est rétrogradé en lecture sur le channel 35 par un droit fin de channel.

-- =============================================================================================
-- 0. L'état laissé par le seed, lu AVANT toute mutation — docs/SPEC-seed.md §2.16
-- =============================================================================================
-- CETTE SECTION DOIT VENIR EN PREMIER, et le motif est un défaut trouvé en exécutant : les
-- sections suivantes déplacent réellement des cards du seed dans leur transaction. Une assertion
-- d'ÉTAT placée après elles ne mesurerait plus le seed mais la suite elle-même. Les assertions
-- d'ÉVÉNEMENTS, en revanche, restent vraies partout : un événement ne peut être ni réécrit ni
-- supprimé, et la section 8 les lit à la fin sans que l'ordre y change rien.

-- RÉVISÉE PAR `CRM-046`, ET C'EST LE GARDE-FOU QUI TOURNE (décision 51). Elle figeait « AUCUNE
-- card ne demeure dans `prospection` au repos », propriété vraie tant que le seed y repointait le
-- workflow deux fois par exécution. `CRM-046` a cessé ces écritures — convergence par état,
-- décision 221 — et y a posé DEUX cards, sur le workflow DÉRIVÉ (docs/SPEC-seed.md §9.3).
--
-- CE QUE L'ASSERTION PROUVE MAINTENANT EST PLUS FORT : les cards de `prospection` suivent le
-- workflow du channel, et INC-046 tient toujours — le geste qu'elle interdit est éprouvé dans les
-- deux sens en section 5.
select is(
	(select count(*) from public.cards c
	  where c.channel_id = '5eed0000-0000-4000-8000-000000000031'),
	2::bigint,
	'`prospection` porte DEUX cards au repos depuis CRM-046 — docs/SPEC-seed.md §9.2, §9.3');

select is(
	(select count(*) from public.cards c
	   join public.channels ch on ch.id = c.channel_id
	  where c.channel_id = '5eed0000-0000-4000-8000-000000000031'
	    and c.workflow_id <> ch.workflow_id),
	0::bigint,
	'…et TOUTES suivent le workflow de leur channel : la lecture n° 1 d''INC-046 tient, une card ne '
	'porte jamais un workflow étranger à son dossier (§6.5)');

select is(
	(select c.channel_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c5'),
	'5eed0000-0000-4000-8000-000000000035'::uuid,
	'`…0c5` est rendue à `maintenance` : l''aller-retour du seed est CONVERGENT, et le rejeu ne '
	'déplace la card qu''une fois (docs/SPEC-seed.md §2.16)');

select is(
	(select c.workflow_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c5'),
	'5eed0000-0000-4000-8000-000000000051'::uuid,
	'Et à son workflow GLOBAL : le retour rend les trois colonnes de rattachement, pas seulement '
	'le channel');

-- =============================================================================================
-- 1. La forme de la fonction — docs/SPEC-workflow-engine.md §6.2 et §6.8
-- =============================================================================================

select has_function('public', 'move_card_to_channel',
	array['uuid', 'uuid', 'uuid', 'boolean'],
	'`public.move_card_to_channel(uuid, uuid, uuid, boolean)` est livrée');

select function_returns('public', 'move_card_to_channel',
	array['uuid', 'uuid', 'uuid', 'boolean'], 'cards',
	'Elle rend `public.cards`, non `void` : PostgREST en fait un objet JSON unique, et le client '
	'obtient le channel, le workflow, l''étape et `position` sans relecture (§6.2)');

select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'move_card_to_channel'),
	true,
	'`SECURITY DEFINER` : la fonction écrit `channel_id`, `workflow_id` et `current_step_id`, que '
	'son appelant ne peut PAS écrire depuis `CRM-013` (§6.3)');

select is(
	(select p.proconfig::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'move_card_to_channel'),
	'{"search_path=\"\""}',
	'`search_path` vidé : sans lui, un `SECURITY DEFINER` est une porte ouverte sur le schéma de '
	'l''appelant');

select is(
	(select r.rolname from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	   join pg_roles r     on r.oid = p.proowner
	  where n.nspname = 'public' and p.proname = 'move_card_to_channel'),
	'postgres',
	'Propriétaire `postgres` : c''est de LUI que la fonction tient le droit d''écrire les colonnes '
	'fermées');

-- --- 1.1 Le nom des paramètres est celui du §6.2, et NON celui de `docs/SCHEMA.md` — INC-073 ---
-- Le document de schéma annonçait `step_mapping`, qui décrit une table de correspondance donc un
-- déplacement EN LOT. La lecture la plus faible est retenue (décision 213), et elle est figée ici :
-- si une exécution future revenait au nom d'origine, l'arbitrage aurait été tranché en silence.
select is(
	(select pg_get_function_arguments(p.oid) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'move_card_to_channel'),
	'card_id uuid, to_channel_id uuid, to_step_id uuid DEFAULT NULL::uuid, '
	'discard_field_values boolean DEFAULT false',
	'Les paramètres portent les noms du §6.2 : `to_channel_id` et `to_step_id`, PAS `step_mapping` '
	'(INC-073, décision 213). `to_step_id` et `discard_field_values` ont un défaut');

-- --- 1.2 Privilèges : `anon` nommément exclu, et ce n'est pas une précaution -------------------
-- MESURÉ (décision 80) : l'image Supabase pose des `ALTER DEFAULT PRIVILEGES` qui accordent
-- `EXECUTE` nommément à `anon` sur toute fonction nouvelle de `public`. Un `revoke … from public`
-- seul ne les touche pas, et la fonction resterait appelable sans jeton.
select ok(
	not has_function_privilege('anon', 'public.move_card_to_channel(uuid, uuid, uuid, boolean)',
	                           'execute'),
	'`anon` n''a PAS `EXECUTE` : le `revoke` vise `public` ET `anon`, sans quoi les `ALTER DEFAULT '
	'PRIVILEGES` de l''image laisseraient la fonction ouverte sans jeton (§6.8)');

select ok(
	has_function_privilege('authenticated', 'public.move_card_to_channel(uuid, uuid, uuid, boolean)',
	                       'execute'),
	'`authenticated` a `EXECUTE` : la fonction est appelée DIRECTEMENT par un client, contrairement '
	'aux `app.can_*` appelées depuis des politiques');

select ok(
	has_function_privilege('service_role', 'public.move_card_to_channel(uuid, uuid, uuid, boolean)',
	                       'execute'),
	'`service_role` a `EXECUTE` : le seed l''appelle — mais avec le jeton de l''administratrice, '
	'`auth.uid()` étant nul pour la clé de service (docs/SPEC-seed.md §2.16)');

-- =============================================================================================
-- 2. Le vocabulaire courant compte QUINZE valeurs — docs/SPEC-cards.md §14.4 et §16.5
-- =============================================================================================
-- RÉVISÉE LE 2026-08-24 PAR `CRM-062` TRANCHE 2, ET LA RÉVISION EST LA RAISON D'ÊTRE DE CE
-- GARDE-FOU. `docs/SPEC-relances.md` §9.8 ajoute `stalled` — la quinzième — dans la MÊME migration
-- que la fonction qui l'écrit, ce que cette assertion exige de toute unité qui étend le vocabulaire.
-- Elle est donc mise à jour plutôt que contournée : l'assertion fige l'énumération ENTIÈRE, de
-- sorte qu'une valeur ajoutée en douce, ou une valeur PERDUE par un rejeu partiel, la fasse rougir.
-- C'est la SIXIÈME fois qu'elle évolue de cette façon, et aucune valeur n'a jamais été retirée.
--
-- RÉVISÉE LE 2026-08-25 PAR `CRM-060` TRANCHE 5 — SEPTIÈME ÉVOLUTION. Les trois gestes de
-- rattachement d'un contact portent l'énumération à DIX-HUIT (docs/SPEC-contacts.md §19.3), dans la
-- même migration que le trigger qui les écrit — exactement ce que ce garde-fou exige de toute unité
-- qui étend le vocabulaire. Aucune valeur retirée, la septième fois comme les six précédentes.
--
-- RÉVISÉE LE 2026-08-28 PAR `CRM-055` TRANCHE 2 — HUITIÈME ÉVOLUTION. `mail_unclassified` porte
-- l'énumération à DIX-NEUF (docs/SPEC-mail-subsystem.md §16.5.3), et sa place n'est pas indifférente :
-- il suit `mail_sent`, avec les deux autres gestes de courrier, plutôt que d'être ajouté en queue.
-- L'ORDRE FAIT PARTIE DE CE QUE CETTE ASSERTION FIGE, `pg_get_constraintdef` le rendant tel quel :
-- une valeur glissée ailleurs la ferait rougir, et c'est voulu — le vocabulaire se lit par familles.
-- Aucune valeur retirée, la huitième fois comme les sept précédentes.

select is(
	(select pg_get_constraintdef(c.oid) from pg_constraint c
	  where c.conname = 'card_events_type_check'),
	'CHECK ((type = ANY (ARRAY[''created''::text, ''moved''::text, ''assigned''::text, '
	'''channel_changed''::text, ''workflow_changed''::text, ''archived''::text, '
	'''unarchived''::text, ''trashed''::text, ''restored''::text, ''field_changed''::text, '
	'''mail_received''::text, ''mail_sent''::text, ''mail_unclassified''::text, '
	'''snoozed''::text, ''woken''::text, '
	'''stalled''::text, ''contact_linked''::text, ''contact_unlinked''::text, '
	'''contact_role_changed''::text])))',
	'Le `CHECK` compte DIX-NEUF valeurs : `CRM-055` tranche 2 ajoute le DÉPART d''un message sans '
	'retirer aucune des dix-huit précédentes. Le garde-fou historique ÉVOLUE avec '
	'le vocabulaire au lieu de figer un état périmé — et c''est la HUITIÈME fois qu''il le fait');

-- LE MÉCANISME A JOUÉ UNE FOIS DE PLUS. `CRM-058` a étendu l'énumération dans la même migration
-- que son écriture, exactement comme l'assertion le lui demandait. Elle est donc RETOURNÉE : le
-- type est accepté, et le garde-fou porte désormais sur le suivant.
select lives_ok(
	$$insert into public.card_events (card_id, workspace_id, type)
	  values ('5eed0000-0000-4000-8000-0000000000c5',
	          '5eed0000-0000-4000-8000-000000000001', 'mail_sent')$$,
	'`mail_sent` est ACCEPTÉ depuis `CRM-058`, qui a étendu l''énumération dans la même migration '
	'que son écriture — ce que cette assertion exigeait de lui');

select throws_ok(
	$$insert into public.card_events (card_id, workspace_id, type)
	  values ('5eed0000-0000-4000-8000-0000000000c5',
	          '5eed0000-0000-4000-8000-000000000001', 'mail_bounced')$$,
	'23514',
	null,
	'`mail_bounced` reste REFUSÉ : le garde-fou suit le vocabulaire, il ne le devance pas. Le jour '
	'où le produit traitera les rejets, il devra étendre l''énumération dans la même migration');

-- =============================================================================================
-- 3. Les huit vérifications, dans les DEUX SENS — docs/SPEC-workflow-engine.md §6.4
-- =============================================================================================

-- --- 3.1 La card doit exister, être visible, et être ACTIVE ------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$select public.move_card_to_channel('00000000-0000-4000-8000-00000000dead',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'P0001', 'card_not_found',
	'Card inexistante : `card_not_found`, `P0001` donc `400` — et non `P0002`, rendu **`500`** par '
	'PostgREST (§4.4)');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c8',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'P0001', 'card_not_found',
	'Card ARCHIVÉE traitée comme ABSENTE : « active » a la même définition qu''ailleurs '
	'(docs/SPEC-cards.md §5). Une card qu''on a rangée ne se déplace pas ; on la restaure d''abord');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c9',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'P0001', 'card_not_found',
	'Card en CORBEILLE traitée comme absente, pour le même motif — et non par un refus qui lui '
	'serait propre : le client qui la voit dans sa corbeille sait déjà pourquoi');

-- --- 3.2 La règle de discrétion, éprouvée avec le MÊME profil dans les deux cas ----------------
-- C'est le point qui décide de la valeur de cette section : le viewer porte `none` sur le track 21,
-- donc `grands-comptes` lui est INVISIBLE ; il voit en revanche `inter-entreprises` sans pouvoir y
-- écrire. Le même compte obtient donc les DEUX refus, et l'écart ne peut pas venir du profil.
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c1',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'P0001', 'card_not_found',
	'Card INVISIBLE du viewer : `card_not_found`, JAMAIS `forbidden`. Répondre « interdit » '
	'confirmerait son existence à qui n''a pas le droit de la connaître (§6.4)');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c6',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'42501', 'forbidden',
	'Card VISIBLE mais lecteur seulement : `forbidden`, `42501` donc `403`. **Preuve de refus n° 1** '
	'de docs/SPEC-permissions-rls.md §7, reconduite sur cette fonction');

-- --- 3.3 Le droit sur le channel CIBLE, exigé en plus de celui sur l'origine -------------------
-- Le bizdev écrit sur `inter-entreprises` (36) mais est rétrogradé en LECTURE sur `maintenance`
-- (35) par un droit fin de channel. Il peut donc sortir une card de 36, et ne peut pas la poser
-- dans 35 : c'est exactement la vérification n° 4, et rien d'autre ne la produit.
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c6',
	                                     '5eed0000-0000-4000-8000-000000000035')$$,
	'42501', 'forbidden',
	'Droit d''écriture sur le channel CIBLE exigé : le bizdev sort la card de `inter-entreprises` '
	'mais est rétrogradé en lecture sur `maintenance`. Sans la n° 4, on déposerait une card dans un '
	'channel fermé (§6.4)');

select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c6',
	                                     '5eed0000-0000-4000-8000-000000000034')$$,
	'LE SENS INVERSE, avec le MÊME profil : vers `refonte`, où il écrit, le déplacement PASSE. Sans '
	'cette assertion, la précédente serait verte sur une fonction qui refuse tout');

-- --- 3.4 Channel cible inexistant : `channel_not_found`, jamais `forbidden` --------------------
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c1',
	                                     '00000000-0000-4000-8000-00000000beef')$$,
	'P0001', 'channel_not_found',
	'Channel cible inexistant : `channel_not_found`. Sans cette règle la fonction deviendrait un '
	'ORACLE D''EXISTENCE de channels, interrogeable identifiant par identifiant (§6.4)');

-- --- 3.5 Le déplacement sur place est refusé ---------------------------------------------------
select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c1',
	                                     '5eed0000-0000-4000-8000-000000000032')$$,
	'P0001', 'same_channel',
	'Channel cible = channel courant : `same_channel`. Un « déplacement » qui ne déplace rien '
	'écrirait une trace dont l''avant et l''après seraient identiques, dans une table que personne '
	'ne peut corriger. Rendre `200` sans rien faire serait la simulation de succès de CLAUDE.md §18');

-- --- 3.6 Le remappage est OBLIGATOIRE quand le workflow change ---------------------------------
select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c5',
	                                     '5eed0000-0000-4000-8000-000000000031')$$,
	'P0001', 'step_mapping_required',
	'Workflow différent et `to_step_id` nul : `step_mapping_required`. La fonction ne choisit AUCUNE '
	'étape par défaut — ni la première du graphe, ni celle du même nœud (§6.4)');

select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c5',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'LE SENS INVERSE : workflow IDENTIQUE et `to_step_id` nul, l''étape est CONSERVÉE et le '
	'déplacement passe — « si le workflow cible est identique, l''étape est conservée par défaut », '
	'§6 d''origine');

-- LE MOTIF DU REFUS, FIGÉ : les deux workflows du seed portent LES SEPT MÊMES NŒUDS DANS LE MÊME
-- ORDRE. Un remappage automatique par clé de nœud paraîtrait donc juste sur ce seed, et le
-- paraîtrait jusqu'au jour où deux workflows divergeraient. Une règle qui n'est fausse que plus
-- tard est une règle fausse — c'est pourquoi la n° 6 refuse au lieu de deviner.
select is(
	(select count(*) from public.workflow_steps a
	   join public.workflow_steps b
	     on b.node_id = a.node_id and b.position = a.position
	  where a.workflow_id = '5eed0000-0000-4000-8000-000000000051'
	    and b.workflow_id = (select workflow_id from public.channels
	                          where id = '5eed0000-0000-4000-8000-000000000031')),
	7::bigint,
	'Les deux workflows du seed portent les SEPT MÊMES nœuds aux MÊMES positions : un remappage '
	'automatique par clé y paraîtrait juste, et c''est précisément pourquoi il est refusé (§6.4)');

-- --- 3.7 L'étape fournie doit appartenir au workflow du channel CIBLE --------------------------
select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c5',
	                                     '5eed0000-0000-4000-8000-000000000031',
	                                     '5eed0000-0000-4000-8000-000000000061')$$,
	'P0001', 'step_not_in_workflow',
	'Étape du workflow GLOBAL fournie pour un channel du workflow DÉRIVÉ : `step_not_in_workflow`. '
	'La base le tiendrait par sa clé composite ; la fonction ajoute un MESSAGE et une PLACE DANS '
	'L''ORDRE, avant que la n° 8 ne parle de destruction (§6.4)');

select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c5',
	                                     '5eed0000-0000-4000-8000-000000000034',
	                                     '5eed0000-0000-4000-8000-000000000062')$$,
	'LE SENS INVERSE : la même card vers un channel dont le workflow PORTE l''étape fournie, et le '
	'déplacement passe. Sans cette assertion, la précédente serait verte sur une fonction qui '
	'refuse toute étape');

-- =============================================================================================
-- 4. Les réponses de formulaire — §6.6, décision 216
-- =============================================================================================

-- --- 4.1 Le refus est CHIFFRÉ, et il porte par défaut ------------------------------------------
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(select count(*) from public.card_field_values
	  where card_id = '5eed0000-0000-4000-8000-0000000000c1'),
	2::bigint,
	'La card `…0c1` porte bien 2 réponses au sortir du seed : les deux assertions suivantes n''ont '
	'de sens que si elle en porte');

select throws_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c1',
	                                     '5eed0000-0000-4000-8000-000000000031',
	                                     pg_temp.etape_derivee())$$,
	'P0001', 'field_values_would_be_lost',
	'`discard_field_values` vaut FALSE par défaut, et le déplacement est REFUSÉ : détruire les '
	'réponses d''une affaire en silence, à l''occasion d''un geste présenté comme un rangement, '
	'serait la valeur par défaut trompeuse que CLAUDE.md §18 proscrit (décision 216)');

select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c1',
	                                     '5eed0000-0000-4000-8000-000000000031',
	                                     pg_temp.etape_derivee(), true)$$,
	'LE SENS INVERSE : `discard_field_values` à VRAI, l''appelant a dit ce qu''il détruisait, et le '
	'déplacement passe');

select is(
	(select count(*) from public.card_field_values
	  where card_id = '5eed0000-0000-4000-8000-0000000000c1'),
	0::bigint,
	'Les réponses sont RÉELLEMENT détruites : la charnière `workflow_id` de `card_field_values` '
	'rend impossible une valeur répondant à la question d''un AUTRE workflow (CRM-036)');

-- --- 4.2 LA MÉMOIRE SURVIT À LA DONNÉE ---------------------------------------------------------
-- La suppression porte sur `card_field_values`, JAMAIS sur `card_events` — que rien ne peut
-- supprimer (docs/SPEC-cards.md §14.8). Le fil continue de porter les réponses données, avec leurs
-- dates, alors que les réponses elles-mêmes n'existent plus.
select cmp_ok(
	(select count(*) from public.card_events
	  where card_id = '5eed0000-0000-4000-8000-0000000000c1' and type = 'field_changed'),
	'>=', 2::bigint,
	'LA MÉMOIRE SURVIT À LA DONNÉE : les `field_changed` sont CONSERVÉS alors que les réponses sont '
	'détruites. Le fil dit ce que l''affaire a répondu, même si la réponse n''existe plus (§6.6)');

-- --- 4.3 À workflow IDENTIQUE, rien n'est détruit et la n° 8 ne s'applique pas -----------------
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c2',
	                                     '5eed0000-0000-4000-8000-000000000033')$$,
	'Workflow identique : la vérification n° 8 ne s''applique pas, et le déplacement passe SANS '
	'`discard_field_values` bien que la card porte des réponses');

-- QUATRE, ET NON PLUS DEUX, DEPUIS LA SOUS-TRANCHE 4d DE `CRM-060` (docs/SPEC-contacts.md §13.6) :
-- le seed renseigne `contact-principal` et `referent-technique` sur cette affaire précisément, dont
-- l'organisation est Sogexia. Ce que l'assertion exige est INCHANGÉ — aucune réponse n'est détruite
-- quand la charnière `workflow_id` ne bouge pas —, et elle le vérifie désormais sur quatre.
select is(
	(select count(*) from public.card_field_values
	  where card_id = '5eed0000-0000-4000-8000-0000000000c2'),
	4::bigint,
	'Et les réponses sont CONSERVÉES : la charnière `workflow_id` n''a pas changé, elles restent '
	'valides (§6.6)');

-- =============================================================================================
-- 5. Les effets du succès — §6.5
-- =============================================================================================

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- `…0c7` EST CHOISIE PARCE QU'AUCUNE SECTION PRÉCÉDENTE NE L'A TOUCHÉE, et c'est ce qui rend
-- l'assertion sur `entered_step_at` probante : sa valeur vient du SEED, donc d'une transaction
-- ANTÉRIEURE. `now()` étant l'heure de début de transaction, une card déjà déplacée dans celle-ci
-- porterait déjà cette valeur, et l'assertion serait verte sans rien prouver — défaut réel, trouvé
-- en exécutant.
--
-- Elle part d'`inter-entreprises` (36, étape 64) et va dans `prospection` (31, workflow DÉRIVÉ).
-- Elle porte trois réponses de formulaire : `discard_field_values` est donc exigé, ce que la
-- section 4 vient d'établir.
create temporary table pg_temp_avant as
	select entered_step_at, position, channel_id, workflow_id, current_step_id
	  from public.cards where id = '5eed0000-0000-4000-8000-0000000000c7';

-- LES COMPTES D'ÉVÉNEMENTS SONT DES ÉCARTS, JAMAIS DES CUMULS — décision 210, dont c'est la
-- seconde occurrence. Une timeline enregistre tout, y compris ce que les autres preuves du dépôt
-- font à la même pile : `e2e/api/move-card.spec.ts` et `e2e/api/move-card-to-channel.spec.ts`
-- laissent derrière elles des `moved` que rien ne peut supprimer. Une assertion « zéro moved »
-- serait verte seule et ROUGE dans la suite complète — défaut réel, trouvé en exécutant le
-- harnais. Seul l'écart produit PAR CE DÉPLACEMENT est une propriété du produit.
create temporary table pg_temp_compte_avant as
	select
		count(*) filter (where type = 'moved')           as moved_c7,
		count(*) filter (where type = 'channel_changed') as channel_c7
	  from public.card_events where card_id = '5eed0000-0000-4000-8000-0000000000c7';

create temporary table pg_temp_compte_c6 as
	select count(*) as moved_c6
	  from public.card_events
	 where card_id = '5eed0000-0000-4000-8000-0000000000c6' and type = 'moved';

-- Le rang maximal de la portée d'arrivée, mesuré AVANT le déplacement : c'est lui qui rend
-- l'assertion de `position` indépendante du volume du seed (révision de `CRM-046`).
create temporary table pg_temp_rang_avant as
	select coalesce(max(position), 0) as rang_max
	  from public.cards
	 where channel_id = '5eed0000-0000-4000-8000-000000000031'
	   and current_step_id = pg_temp.etape_derivee();

create temporary table pg_temp_apres as
	select * from public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c7',
	                                          '5eed0000-0000-4000-8000-000000000031',
	                                          pg_temp.etape_derivee(), true);

select is(
	(select channel_id from pg_temp_apres),
	'5eed0000-0000-4000-8000-000000000031'::uuid,
	'`channel_id` vaut le channel cible');

select is(
	(select a.workflow_id from pg_temp_apres a),
	(select ch.workflow_id from public.channels ch
	  where ch.id = '5eed0000-0000-4000-8000-000000000031'),
	'`workflow_id` est DÉRIVÉ du channel, jamais fourni par l''appelant : le workflow d''une card '
	'est celui de son channel (§6.5, lecture n° 1 d''INC-046)');

select is(
	(select current_step_id from pg_temp_apres),
	pg_temp.etape_derivee(),
	'`current_step_id` vaut l''étape fournie, du graphe CIBLE');

-- RÉVISÉE PAR `CRM-046` — MÊME DÉFAUT QUE LES COMPTES D'ÉVÉNEMENTS CI-DESSUS, ET LE COMMENTAIRE
-- QUI LES PRÉCÈDE L'ANNONÇAIT SANS QUE LA POSITION Y SOIT SOUMISE. Le rang `2` était le rang
-- attendu dans une colonne peuplée par la seule section 4 de cette suite ; `CRM-046` a posé une
-- card de plus dans cette portée, et l'assertion est passée à 3. Un rang figé mesure le VOLUME du
-- seed, pas la règle du produit.
--
-- La règle, elle, est « EN FIN de la portée d'arrivée » : le rang obtenu vaut le maximum qui y
-- régnait AVANT le déplacement, plus un. C'est ce qui est désormais mesuré, et la contre-épreuve
-- suivante conserve ce que le rang figé apportait — la portée n'était pas vide, sans quoi « en
-- fin » et « au début » donneraient la même valeur.
select is(
	(select position from pg_temp_apres),
	(select m.rang_max + 1 from pg_temp_rang_avant m),
	'`position` est recalculée EN FIN de la portée d''arrivée `(channel_id, current_step_id)` : le '
	'rang vaut le maximum qui y régnait avant le déplacement, plus un (§6.5, docs/SPEC-cards.md §2.6)');

select cmp_ok(
	(select m.rang_max from pg_temp_rang_avant m), '>', 0::numeric,
	'…et la portée d''arrivée n''était PAS vide : sans une colonne déjà peuplée, « en fin » et '
	'« au début » donneraient la même valeur, et l''assertion précédente serait verte à tort');

select isnt(
	(select a.entered_step_at from pg_temp_apres a),
	(select v.entered_step_at from pg_temp_avant v),
	'`entered_step_at` est remise à `now()` PARCE QUE L''ÉTAPE A CHANGÉ : entrer dans une étape par '
	'remappage est y entrer (décision 217)');

select is(
	(select a.entered_step_at from pg_temp_apres a),
	now(),
	'Et elle vaut exactement `now()`, l''heure de DÉBUT DE TRANSACTION — ce qui est aussi la raison '
	'pour laquelle l''assertion précédente exige une card que le seed, et non cette suite, a posée');

-- --- 5.1 `entered_step_at` est CONDITIONNELLE, et c'est la décision 217 ------------------------
-- Le sens inverse, sur une card dont l'étape ne change pas. Sans cette assertion, la précédente
-- serait verte sur une fonction qui écrase l'horodatage à chaque appel.
create temporary table pg_temp_avant2 as
	select entered_step_at from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3';

create temporary table pg_temp_apres2 as
	select * from public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c3',
	                                          '5eed0000-0000-4000-8000-000000000034');

select is(
	(select a.entered_step_at from pg_temp_apres2 a),
	(select v.entered_step_at from pg_temp_avant2 v),
	'`entered_step_at` est INCHANGÉE à étape constante : un changement de channel ne fait entrer la '
	'card nulle part, et remettre l''horodatage à zéro ferait mentir la seule mesure d''ancienneté '
	'du produit (décision 217)');

select isnt(
	(select position from pg_temp_apres2),
	null,
	'`position` est TOUJOURS recalculée, même à étape constante : changer de channel change de '
	'portée (§6.5)');

-- =============================================================================================
-- 6. L'événement, et l'absence de `moved` à côté — §6.7, décision 215
-- =============================================================================================

select pg_temp.redevenir_proprietaire();

select is(
	(select e.type from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c7'
	  order by e.created_at desc limit 1),
	'channel_changed',
	'Le dernier événement de la card déplacée est un `channel_changed` : le fait n° 2 du §6.3 cesse '
	'— un changement de channel n''est plus silencieux');

-- --- 6.1 Le `payload` porte « l'ancien et le nouveau contexte », six clés ----------------------
select is(
	(select e.payload -> 'from_channel_id' from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c7'
	  order by e.created_at desc limit 1),
	to_jsonb('5eed0000-0000-4000-8000-000000000036'::uuid),
	'`from_channel_id` porte le channel d''ORIGINE');

select is(
	(select e.payload -> 'to_channel_id' from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c7'
	  order by e.created_at desc limit 1),
	to_jsonb('5eed0000-0000-4000-8000-000000000031'::uuid),
	'`to_channel_id` porte le channel de DESTINATION');

select is(
	(select e.payload -> 'from_workflow_id' from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c7'
	  order by e.created_at desc limit 1),
	to_jsonb('5eed0000-0000-4000-8000-000000000051'::uuid),
	'`from_workflow_id` porte le workflow d''origine : c''est ce qui rend le fil lisible quand la '
	'card a changé de graphe');

select is(
	(select e.payload -> 'from_step_id' from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c7'
	  order by e.created_at desc limit 1),
	to_jsonb('5eed0000-0000-4000-8000-000000000064'::uuid),
	'`from_step_id` et `to_step_id` sont PORTÉS : c''est ce qui rend `channel_changed` plus riche '
	'que le `moved` qu''il remplace, et donc ce qui autorise à ne pas écrire les deux (décision 215)');

select is(
	(select jsonb_object_keys_count from (
		select count(*) as jsonb_object_keys_count
		  from jsonb_object_keys(
		    (select e.payload from public.card_events e
		      where e.card_id = '5eed0000-0000-4000-8000-0000000000c5'
		      order by e.created_at desc limit 1))) s),
	6::bigint,
	'SIX clés exactement, et pas une de plus : `payload` ne porte AUCUN LIBELLÉ — ni nom de channel, '
	'ni nom d''étape. Une trace qui les recopierait dirait demain ce qui était vrai hier '
	'(docs/SPEC-cards.md §14.6)');

-- --- 6.2 AUCUN `moved` n'accompagne le déplacement, et c'est le cœur de la décision 215 --------
-- `…0c5` a changé d'étape en même temps que de channel — de l'étape 61 du graphe global à l'étape
-- initiale du graphe dérivé. Sans la condition posée sur la garde `moved`, un `moved` serait né à
-- côté, et il dirait qu'une arête a été franchie là où il n'y en a aucune.
select is(
	(select count(*) from public.card_events e
	   where e.card_id = '5eed0000-0000-4000-8000-0000000000c7' and e.type = 'moved')
	- (select moved_c7 from pg_temp_compte_avant),
	0::bigint,
	'AUCUN `moved` DE PLUS : `…0c7` a pourtant changé d''étape en changeant de channel. La garde '
	'`moved` est conditionnée à `channel_id` inchangé — une card qui change de workflow n''a franchi '
	'AUCUNE arête, et il ne peut pas y en avoir entre deux graphes disjoints (décision 215)');

select is(
	(select count(*) from public.card_events e
	   where e.card_id = '5eed0000-0000-4000-8000-0000000000c7' and e.type = 'channel_changed')
	- (select channel_c7 from pg_temp_compte_avant),
	1::bigint,
	'EXACTEMENT UN `channel_changed` de plus : le déplacement écrit UN événement, jamais deux, '
	'jamais zéro (§6.7)');

-- --- 6.3 `moved` continue de naître quand le channel NE change PAS -----------------------------
-- Le sens inverse. Sans lui, l'assertion précédente serait verte sur un trigger qui n'écrirait
-- plus jamais aucun `moved`.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                          '5eed0000-0000-4000-8000-000000000062')$$,
	'`move_card` fonctionne toujours : cette unité ne rouvre pas `CRM-034`');

select pg_temp.redevenir_proprietaire();

select is(
	(select count(*) from public.card_events e
	   where e.card_id = '5eed0000-0000-4000-8000-0000000000c6' and e.type = 'moved')
	- (select moved_c6 from pg_temp_compte_c6),
	1::bigint,
	'`moved` NAÎT toujours quand le channel ne change pas : la condition de la décision 215 est un '
	'discriminant, pas une suppression. Écart et non cumul, pour la raison de la décision 210');

-- --- 6.4 Le trigger couvre STRICTEMENT PLUS que la RPC -----------------------------------------
-- Décision 203 de `CRM-044`, reprise : l'événement est écrit par le trigger de la TABLE. Un
-- `UPDATE` direct sous le propriétaire — qui contourne entièrement la fonction, ses huit
-- vérifications et le privilège de colonne — produit l'événement lui aussi. Une garde protège les
-- clients ; une trace doit couvrir tout le monde.
update public.cards
   set channel_id = '5eed0000-0000-4000-8000-000000000036'
 where id = '5eed0000-0000-4000-8000-0000000000c3';

select is(
	(select e.type from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c3'
	  order by e.created_at desc limit 1),
	'channel_changed',
	'UN `UPDATE` DIRECT PRODUIT L''ÉVÉNEMENT LUI AUSSI : le trigger est sur la TABLE, non dans la '
	'RPC. `service_role` conserve l''écriture des colonnes (docs/SPEC-permissions-rls.md §4.4.3), et '
	'la trace le couvre malgré tout (décision 215, décision 203)');

-- --- 6.5 L'immuabilité de `CRM-044` s'applique au type nouveau ---------------------------------
select throws_ok(
	$$update public.card_events set type = 'moved'
	   where card_id = '5eed0000-0000-4000-8000-0000000000c7' and type = 'channel_changed'$$,
	'P0001', 'card_event_immutable',
	'Un `channel_changed` est aussi immuable que les huit autres types : le trigger de `CRM-044` ne '
	'connaît pas le vocabulaire, il refuse TOUTE mise à jour (docs/SPEC-cards.md §14.8)');

-- =============================================================================================
-- 7. Ce que la migration NE pose PAS, et qui doit le rester — §6.3, décision 214
-- =============================================================================================
-- `CRM-034` avait dû retirer elle-même le privilège de colonne sur `current_step_id`. Cette unité
-- n'a rien à retirer : `CRM-013` avait fermé `channel_id` et `workflow_id` « par voie de
-- conséquence », sans nommer la conséquence. La nommer ne suffit pas à la tenir — un privilège
-- qu'aucune migration ne pose est un privilège qu'aucune migration ne défend. La défense est ici.

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'channel_id', 'update'),
	'`channel_id` est FERMÉE à `authenticated` : la garde était close AVANT d''exister, et c''est '
	'`CRM-013` qui l''avait fermée (décision 214). **Preuve de refus n° 5** reconduite');

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'workflow_id', 'update'),
	'`workflow_id` est FERMÉE elle aussi : sans quoi un `PATCH` direct ouvrirait la seule '
	'combinaison que la clé composite refuse');

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'`current_step_id` reste fermée : `CRM-045` ne rouvre pas ce que `CRM-034` avait fermé');

select is(
	(select count(*) from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'cards'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE'),
	11::bigint,
	'ONZE colonnes ouvertes, et pas une de plus : l''énumération est celle de `CRM-013`, MOINS '
	'`snoozed_until` que `CRM-081` a fermée (docs/SPEC-cards.md §16.7). Cette assertion '
	'échouerait si une migration future y faisait rentrer `channel_id` — le seul rempart d''un '
	'privilège que plus aucune migration ne pose (décision 214)');

select ok(
	has_column_privilege('service_role', 'public.cards', 'channel_id', 'update'),
	'`service_role` conserve l''écriture : le seed en dépend, et la limite est celle, déjà nommée, '
	'de docs/SPEC-permissions-rls.md §4.4.3 — le trigger la rend au moins VISIBLE');

-- =============================================================================================
-- 8. Le seed — docs/SPEC-seed.md §2.16, décision 218
-- =============================================================================================
-- Cette section lit l'état LAISSÉ PAR LE SEED, que les sections précédentes ont modifié dans leur
-- transaction. Elle porte donc sur les événements, qui s'accumulent, et non sur l'état des cards.

select cmp_ok(
	(select count(*) from public.card_events where type = 'channel_changed'),
	'>=', 2::bigint,
	'Le seed a produit au moins DEUX `channel_changed` : l''aller-retour de `…0c5` vers '
	'`prospection`, par la VRAIE RPC et avec le jeton de l''administratrice. Le seed ne peut PAS '
	'forger un événement — aucun rôle n''a l''`INSERT` (docs/SPEC-seed.md §2.16)');

-- --- 8.1 L'acteur est un profil RÉEL, et non le service ----------------------------------------
select cmp_ok(
	(select count(*) from public.card_events
	  where type = 'channel_changed' and actor_id is not null),
	'>=', 2::bigint,
	'Les événements du seed portent un ACTEUR : ils passent par le jeton réel de l''administratrice, '
	'non par la clé de service dont `auth.uid()` est nul — `card_not_found` sinon');

-- =============================================================================================
-- 9. Frontière du geste unitaire, après livraison du geste pluriel
-- =============================================================================================
-- Mécanisme de la décision 51 : chaque manque est une assertion qui deviendra ROUGE le jour où
-- l'unité qui le porte livre son objet.

select hasnt_function('public', 'move_cards_to_channel', array['uuid[]', 'uuid', 'jsonb'],
	'AUCUN DÉPLACEMENT EN LOT n''est livré : c''est ce que `step_mapping` laissait espérer, et ce '
	'que le §6 ne demande pas. INC-073 attend l''arbitrage ; cette assertion deviendra rouge le jour '
	'où une unité le portera');

select has_function('public', 'change_channel_workflow', array['uuid', 'uuid', 'jsonb', 'boolean'],
	'CRM-019 livre désormais le geste pluriel sous un AUTRE nom et une autre signature : '
	'`move_card_to_channel` reste strictement unitaire (§6.13)');

select * from finish();
rollback;

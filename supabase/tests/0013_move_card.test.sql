-- @verifies CRM-034 (docs/BACKLOG.md) — `move_card`, garde centrale de transition
-- @verifies docs/SPEC-workflow-engine.md §5.2 (signature), §5.3 (les six vérifications),
--           §5.4 (effets), §5.5 (protection de colonne), §5.6 (privilèges),
--           §5.7 (la n° 6 non livrable), §5.9 (seed exercé), §5.10 (preuves attendues)
-- @verifies docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`), §5 (« active »)
-- @verifies docs/SPEC-permissions-rls.md §3.3 (droits effectifs), §7 (preuves de refus n° 1, n° 5)
-- @verifies docs/SCHEMA.md §5 (cards), §9 (fonctions)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-047 (**close par `CRM-036`**), INC-048, INC-049,
--           INC-050, INC-051, INC-052
--
-- Suite pgTAP de l'unité `CRM-034`. Elle prouve sept choses :
--
--   1. la **forme** de la fonction — signature, type de retour composite, `SECURITY DEFINER`,
--      `search_path` vidé, propriétaire — et ses **privilèges**, `anon` nommément exclu ;
--   2. les **cinq vérifications livrées**, chacune dans les **DEUX SENS**. C'est le point qui
--      décide de la valeur de cette suite : une assertion qui ne prouverait que le refus serait
--      verte sur une fonction qui refuse tout, et une qui ne prouverait que le succès serait verte
--      sur une fonction sans aucune garde ;
--   3. la **règle de discrétion** — invisible rend `card_not_found`, visible-mais-lecteur rend
--      `forbidden` —, éprouvée avec le **même profil** dans les deux cas, ce qui est la seule
--      façon d'exclure que l'écart vienne du profil plutôt que de la règle ;
--   4. les **effets** du succès : `current_step_id`, `entered_step_at` remise à l'instant, et
--      `position` recalculée **en fin de la colonne d'arrivée** — sur une colonne qui en contient
--      déjà deux, sans quoi « en fin » et « au début » donneraient la même valeur ;
--   5. la **protection de colonne** : `current_step_id` fermée à `authenticated`, les douze
--      colonnes du §5.5 laissées ouvertes, et `service_role` intact ;
--   6. le fait que la garde **n'est pas contournable** par une mise à jour directe, éprouvé sous le
--      rôle réel et non par la seule lecture du catalogue des privilèges ;
--   7. ce qui **reste dû**, figé par des assertions qui deviendront rouges à leur unité :
--      la vérification n° 6 (`CRM-036`), le commentaire non conservé (`CRM-043`), l'absence de
--      `card_events` (`CRM-044`), et `email_local_part` restée ouverte (`CRM-013`, INC-050).
--
-- Exécution : `npm run test:sql`, `scripts/verify-move-card.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0013_move_card.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier.

begin;

create extension if not exists pgtap with schema extensions;

select plan(74);

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

-- Le graphe seedé, rappelé ici parce que chaque assertion s'y adosse (docs/SPEC-seed.md) :
--
--   étapes   61 prospect (initiale) · 62 relance · 63 négociation · 64 signature
--            65 réalisation · 66 livré · 67 perdu
--   arêtes   61→62 · 62→63 · 63→64 · 64→65 · 65→66 · 63→62
--            61→67 · 62→67 · 63→67 · 64→67   ← les quatre « Marquer perdu », à COMMENTAIRE
--   cards    c1,c2 (channel 32, étape 62, positions 1 et 2) · c3 (32, 61) · c4 (34, 63)
--            c5 (35, 61) · c6,c7 (36, étapes 61 et 64) · c8 ARCHIVÉE · c9 CORBEILLE
--   profils  11 admin · 12 business_developer · 13 viewer
--
-- Droits fins seedés, MESURÉS et non supposés (docs/SPEC-permissions-rls.md §2.2) :
--   * le viewer a `none` sur le track 21 → il ne voit AUCUNE card de `grands-comptes` ;
--   * il voit en revanche celles de `inter-entreprises`, sans droit d'écriture ;
--   * le bizdev est rétrogradé en lecture sur le channel 35 par un droit fin de channel ;
--   * l'administratrice porte elle aussi un `none` sur le track 21, et n'en est PAS restreinte.

-- =============================================================================================
-- 1. La forme de la fonction — docs/SPEC-workflow-engine.md §5.2 et §5.6
-- =============================================================================================

select has_function('public', 'move_card', array['uuid', 'uuid', 'text'],
	'`public.move_card(uuid, uuid, text)` est livrée — l''assertion `hasnt_function` de '
	'`0012_cards.test.sql` est retournée par cette unité (décision 51)');

select function_returns('public', 'move_card', array['uuid', 'uuid', 'text'], 'cards',
	'Elle rend `public.cards`, non `void` : PostgREST en fait un objet JSON unique, et le client '
	'obtient l''étape, `entered_step_at` et `position` sans relecture (§5.2)');

select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'move_card'),
	true,
	'`SECURITY DEFINER` : c''est le mécanisme MÊME de la garde — elle écrit `current_step_id`, que '
	'son appelant ne peut pas écrire depuis la section 2 de la migration (§5.5)');

select is(
	(select p.proconfig::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'move_card'),
	'{"search_path=\"\""}',
	'`search_path` vidé : toute relation est pleinement qualifiée. Sans lui, une fonction '
	'`SECURITY DEFINER` est une porte ouverte sur le schéma de l''appelant');

select is(
	(select r.rolname from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	   join pg_roles r     on r.oid = p.proowner
	  where n.nspname = 'public' and p.proname = 'move_card'),
	'postgres',
	'Propriétaire `postgres` : c''est de LUI que la fonction tient le droit d''écrire la colonne '
	'fermée, un `SECURITY DEFINER` s''exécutant avec les droits de son propriétaire');

-- --- 1.1 Privilèges : `anon` nommément exclu, et ce n'est pas une précaution -------------------
-- MESURÉ (décision 80) : l'image Supabase pose des `ALTER DEFAULT PRIVILEGES` qui accordent
-- `EXECUTE` nommément à `anon` sur toute fonction nouvelle de `public`. Un `revoke … from public`
-- seul ne les touche pas, et la fonction resterait appelable sans jeton.

select ok(
	not has_function_privilege('anon', 'public.move_card(uuid, uuid, text)', 'execute'),
	'`anon` n''a PAS `EXECUTE` — le refus de l''appelant anonyme est un refus de privilège, et '
	'PostgREST le rend en `401`, non `403` (§5.6, MESURÉ)');

select ok(
	has_function_privilege('authenticated', 'public.move_card(uuid, uuid, text)', 'execute'),
	'`authenticated` a `EXECUTE` : la fonction est appelée DIRECTEMENT par un client, contrairement '
	'aux `app.can_*` qui le sont depuis des politiques');

select ok(
	has_function_privilege('service_role', 'public.move_card(uuid, uuid, text)', 'execute'),
	'`service_role` a `EXECUTE`');

-- =============================================================================================
-- 2. La protection de colonne — docs/SPEC-workflow-engine.md §5.5
-- =============================================================================================
-- Sans elle, la section 3 ne prouverait rien : les cinq vérifications ne s'appliqueraient qu'à ceux
-- qui veulent bien passer par la fonction. C'est la **preuve de refus n° 5** de
-- docs/SPEC-permissions-rls.md §7.

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'PREUVE DE REFUS N° 5 : `authenticated` n''a PLUS `UPDATE` sur `cards.current_step_id`. La '
	'garde n''est plus contournable par un `PATCH` (§5.5)');

select ok(
	not has_table_privilege('authenticated', 'public.cards', 'update'),
	'`authenticated` n''a plus l''`UPDATE` de TABLE : le privilège ne se retire pas colonne par '
	'colonne d''un privilège de table, c''est le mécanisme du §2.1 de la migration');

select ok(
	has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'select'),
	'`SELECT` sur `current_step_id` est INTACT : la colonne se lit, elle ne s''écrit plus');

select ok(
	has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'insert'),
	'`INSERT` sur `current_step_id` est INTACT : une card naît à une étape, et la clé composite de '
	'`CRM-040` garantit déjà qu''elle appartient au workflow');

-- Les douze colonnes que le §5.5 laisse ouvertes. Les vérifier une à une n'est pas de la
-- redondance : le `grant` de la migration est une liste, et une liste se tronque.
select ok(has_column_privilege('authenticated', 'public.cards', 'title', 'update'),
	'`title` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'description', 'update'),
	'`description` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'position', 'update'),
	'`position` reste modifiable : réordonner une colonne du board n''est pas un déplacement');
select ok(has_column_privilege('authenticated', 'public.cards', 'owner_id', 'update'),
	'`owner_id` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'amount', 'update'),
	'`amount` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'currency', 'update'),
	'`currency` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'probability_override', 'update'),
	'`probability_override` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'next_action', 'update'),
	'`next_action` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'next_action_at', 'update'),
	'`next_action_at` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'snoozed_until', 'update'),
	'`snoozed_until` reste modifiable');
select ok(has_column_privilege('authenticated', 'public.cards', 'archived_at', 'update'),
	'`archived_at` reste modifiable : archiver reste un geste du client');
select ok(has_column_privilege('authenticated', 'public.cards', 'deleted_at', 'update'),
	'`deleted_at` reste modifiable : la corbeille reste un geste du client');

-- Les colonnes fermées par voie de conséquence. Le §2.3 de la migration les nomme.
select ok(not has_column_privilege('authenticated', 'public.cards', 'workflow_id', 'update'),
	'`workflow_id` est fermée par conséquence : elle ne changeait déjà que par `CRM-045`');
select ok(not has_column_privilege('authenticated', 'public.cards', 'entered_step_at', 'update'),
	'`entered_step_at` est fermée : docs/SPEC-cards.md §2.9 la réserve NOMMÉMENT à `move_card`, et '
	'un client qui la réécrirait fausserait toute mesure d''ancienneté');
select ok(not has_column_privilege('authenticated', 'public.cards', 'workspace_id', 'update'),
	'`workspace_id` est fermée par conséquence');

select ok(
	has_table_privilege('service_role', 'public.cards', 'update'),
	'`service_role` conserve son `UPDATE` : le `revoke` ne vise qu''`authenticated`, et le seed — '
	'qui écrit avec la clé de service — est INCHANGÉ (§5.9)');

-- =============================================================================================
-- 3. Les cinq vérifications livrées, chacune dans les DEUX SENS
-- =============================================================================================

-- --- 3.1 Vérification n° 1 : la card existe, est visible, et est ACTIVE ------------------------

savepoint v1;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000ff',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'P0001', 'card_not_found',
	'N° 1, sens du REFUS : une card inconnue rend `card_not_found`. `P0001` et non `P0002` — ce '
	'dernier est rendu `500` par PostgREST et serait lu comme une panne du produit (§4.4)');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c8',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'P0001', 'card_not_found',
	'N° 1 : une card ARCHIVÉE est traitée comme ABSENTE. « Active » a la définition de '
	'docs/SPEC-cards.md §5 — on restaure d''abord, on déplace ensuite');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c9',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'P0001', 'card_not_found',
	'N° 1 : une card en CORBEILLE de même. Les deux suppressions douces sont distinctes, leur '
	'effet sur la garde est le même');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c3',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'N° 1, sens du SUCCÈS : une card active et visible passe. Sans cette assertion, les trois '
	'précédentes seraient vertes sur une fonction qui refuse TOUT');

rollback to savepoint v1;

-- --- 3.2 La règle de discrétion, éprouvée avec le MÊME profil ---------------------------------
-- docs/SPEC-workflow-engine.md §5.3 : « visible » signifie `app.can_read_channel`, et la n° 1 passe
-- AVANT la n° 2. Une card d'un channel fermé rend `card_not_found` ; une card que l'appelant voit
-- tous les jours rend `forbidden`. Employer deux profils différents laisserait planer le doute que
-- l'écart vienne du profil ; le viewer les exerce ici tous les deux.

savepoint v2;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c1',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'P0001', 'card_not_found',
	'DISCRÉTION : le viewer, à qui le track 21 est fermé, ne se voit PAS répondre « interdit » sur '
	'une card de `grands-comptes` — cela confirmerait son existence à qui n''a pas le droit de la '
	'connaître (§5.3, décision 82)');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'42501', 'forbidden',
	'PREUVE DE REFUS N° 1, et REVERS de la discrétion : LE MÊME viewer, sur une card qu''il VOIT, '
	'obtient `forbidden`. Lui dire qu''elle n''existe pas serait un mensonge inutile. L''écart '
	'entre les deux assertions ne peut donc venir que de la RÈGLE, jamais du profil');

rollback to savepoint v2;

-- Le bizdev, rétrogradé en lecture par un droit fin de CHANNEL — l'autre chemin vers `forbidden`.
savepoint v2b;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c5',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'42501', 'forbidden',
	'N° 2 par un droit fin de CHANNEL : le bizdev écrit partout, sauf sur le channel 35 où il est '
	'rétrogradé en lecture. La garde consulte le droit EFFECTIF, pas le rôle de workspace');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c3',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'N° 2, sens du SUCCÈS : LE MÊME bizdev passe sur un channel où il écrit. La rétrogradation '
	'est bien locale au channel, et non un refus général');

rollback to savepoint v2b;

-- L'administratrice n'est jamais restreinte, alors qu'elle porte un `none` seedé sur le track 21.
--
-- RÉVISÉE À `CRM-036` : la card employée est passée de `…0c1` à `…0c2`, et le motif est nommé.
-- Les deux vivent dans `grands-comptes`, à la même étape, et le `none` du seed porte sur le TRACK :
-- la démonstration est identique. Mais `…0c1` porte `budget` VIDE par contrat de seed, et la
-- sixième vérification la refuse désormais — ce refus-là n'a rien à voir avec le droit fin, et
-- l'assertion aurait mesuré la mauvaise règle. `…0c2` renseigne `budget` : seul le droit fin reste
-- en cause (décision 121, portée générale — faire varier la condition SEULE).
savepoint v2c;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'L''administratrice passe sur `grands-comptes` MALGRÉ le `none` seedé sur son track : « un '
	'administrateur n''est jamais restreint » (docs/SPEC-permissions-rls.md §2.2), et la garde ne '
	'réinvente pas cette règle — elle appelle `app.can_write_channel`');

rollback to savepoint v2c;

-- --- 3.3 Vérification n° 3 : l'étape cible appartient au workflow de la card -------------------

savepoint v3;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	    (select s.id from public.workflow_steps s
	      where s.workflow_id <> '5eed0000-0000-4000-8000-000000000051' limit 1)) $$,
	'P0001', 'step_not_in_workflow',
	'N° 3 : une étape de la COPIE de portée track est refusée avec un message de PRODUIT. La clé '
	'composite de `CRM-040` la refusait déjà en `23503` brut ; la garde ajoute un message et une '
	'PLACE DANS L''ORDRE, avant la n° 4 (§5.3)');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-0000000000ee') $$,
	'P0001', 'step_not_in_workflow',
	'N° 3 : une étape INEXISTANTE rend le même message. « N''appartient pas au workflow » couvre '
	'les deux cas, et distinguer serait divulguer');

-- LE POINT DE L'ORDRE, et il ne se prouve pas autrement : l'étape 65 appartient bien au workflow de
-- la card, et AUCUNE transition ne mène de 62 vers elle. Si la n° 3 était évaluée après la n° 4, ce
-- cas rendrait `step_not_in_workflow` ; il rend `transition_not_allowed`, donc l'ordre est le bon.
select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000065') $$,
	'P0001', 'transition_not_allowed',
	'L''ORDRE des n° 3 et n° 4 est PROUVÉ : une étape DU BON workflow mais non reliée rend '
	'`transition_not_allowed`, jamais `step_not_in_workflow`. Le client est envoyé chercher une '
	'ARÊTE, ce qui est bien le problème');

rollback to savepoint v3;

-- --- 3.4 Vérification n° 4 : une transition est déclarée --------------------------------------

savepoint v4;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'P0001', 'transition_not_allowed',
	'N° 4, sens du REFUS : 61 → 63 n''est pas déclarée. C''EST L''OBJET MÊME DE L''UNITÉ — le '
	'graphe du workflow devient opposable ici, et nulle part ailleurs');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000061') $$,
	'P0001', 'transition_not_allowed',
	'N° 4 : un déplacement SUR PLACE est refusé. `workflow_transitions_distinct_check` interdit '
	'une arête d''une étape vers elle-même, donc aucune ne sera jamais trouvée : ne rien faire '
	'n''est pas un déplacement');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'N° 4, sens du SUCCÈS : 61 → 62 « Relancer » EST déclarée et passe. Sans cette assertion, les '
	'deux précédentes seraient vertes sur une fonction qui refuse toute transition');

-- Le sens de l'arête compte : 63 → 62 « Revenir en relance » est déclarée, 62 → 61 ne l'est pas.
select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c1',
	                        '5eed0000-0000-4000-8000-000000000061') $$,
	'P0001', 'transition_not_allowed',
	'N° 4 : le graphe est ORIENTÉ. 61 → 62 passe, 62 → 61 est refusée. Une garde qui ignorerait le '
	'sens serait verte sur les deux, et ne garderait rien');

rollback to savepoint v4;

-- --- 3.5 Vérification n° 5 : le commentaire exigé ---------------------------------------------

savepoint v5;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000067') $$,
	'P0001', 'comment_required',
	'N° 5, sens du REFUS : « Marquer perdu » (61 → 67) porte `require_comment`, et l''appel sans '
	'commentaire est refusé. C''est la donnée du seed de `CRM-031` qui l''exerce (§5.9)');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000067', '   ') $$,
	'P0001', 'comment_required',
	'N° 5 : UN COMMENTAIRE VIDE N''EST PAS UN COMMENTAIRE. `nullif(btrim(…), '''')` refuse une '
	'barre d''espace comme l''absence, sans quoi la règle « la raison d''une affaire perdue est '
	'exigée » se satisferait de rien (§5.3)');

-- ÉCART MESURÉ, FIGÉ ET NON CORRIGÉ ICI — INC-052.
-- `btrim(text)` à un seul argument ne retire QUE des espaces : MESURÉ, `btrim(E'\t\n ')` rend deux
-- caractères, et `nullif(…, '')` ne les annule donc pas. Une tabulation seule passe pour un motif.
-- Le §5.3 spécifie l'expression `nullif(btrim(comment), '')` CARACTÈRE POUR CARACTÈRE et n'annonce
-- que le refus d'« une chaîne d'espaces » : l'implémentation lui est fidèle, et c'est la RÈGLE
-- ÉCRITE qui est plus étroite que son intention affichée — « un commentaire vide n'est pas un
-- commentaire ». L'élargir à `btrim(comment, E' \t\r\n')` refuserait davantage et ne casserait
-- aucun usage légitime, mais ce serait trancher une règle de produit que la spécification a posée
-- explicitement. `CLAUDE.md` §5 impose de consigner sans résoudre : le comportement reste inchangé,
-- l'écart est consigné en INC-052, et cette assertion le tient.
select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000067', E'\t\n ') $$,
	'INC-052, ÉCART FIGÉ : une tabulation seule PASSE pour un commentaire. `btrim` à un argument ne '
	'retire que des espaces — MESURÉ, il en laisse deux ici. La spécification écrit cette '
	'expression littéralement ; l''élargir serait trancher une règle de produit. CETTE ASSERTION '
	'DOIT DEVENIR ROUGE le jour où l''arbitrage d''INC-052 est rendu');

rollback to savepoint v5;

savepoint v5b;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000067', 'Budget reporté en 2027') $$,
	'N° 5, sens du SUCCÈS : la MÊME transition passe avec un commentaire réel. Sans cette '
	'assertion, les précédentes seraient vertes sur une garde qui refuserait tout `perdu`');

rollback to savepoint v5b;

-- Le revers exact : une transition SANS exigence ne réclame pas de commentaire.
savepoint v5c;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c6',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'N° 5 : une transition SANS `require_comment` passe sans commentaire. L''exigence vient de '
	'l''ARÊTE, non de la fonction — une garde qui exigerait toujours serait verte sur la moitié '
	'des assertions ci-dessus');

rollback to savepoint v5c;

-- =============================================================================================
-- 4. Ce que le succès écrit — docs/SPEC-workflow-engine.md §5.4
-- =============================================================================================

savepoint effets;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- L'état de départ est CONSTATÉ, et non supposé : une assertion sur un état d'arrivée n'a de valeur
-- que si l'état de départ en diffère.
select is(
	(select c.current_step_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	'5eed0000-0000-4000-8000-000000000061'::uuid,
	'ÉTAT DE DÉPART CONSTATÉ : `c3` est à l''étape 61 avant l''appel');

select is(
	(select count(*)::int from public.cards c
	  where c.channel_id = '5eed0000-0000-4000-8000-000000000032'
	    and c.current_step_id = '5eed0000-0000-4000-8000-000000000062'),
	2,
	'ÉTAT DE DÉPART CONSTATÉ : la colonne d''arrivée contient DÉJÀ DEUX cards, aux positions 1 et '
	'2. Sur une colonne vide, « en fin » et « au début » donneraient tous deux 1, et l''assertion '
	'de position ne prouverait rien');

create temporary table t_avant on commit drop as
	select now() as instant,
	       (select c.position from public.cards c
	         where c.id = '5eed0000-0000-4000-8000-0000000000c3') as position_depart;

select lives_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c3',
	                        '5eed0000-0000-4000-8000-000000000062') $$,
	'Le déplacement 61 → 62 de `c3` réussit');

select is(
	(select c.current_step_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	'5eed0000-0000-4000-8000-000000000062'::uuid,
	'`current_step_id` ← l''étape cible : l''objet même de la fonction');

select is(
	(select c.position from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	3::numeric,
	'`position` ← FIN de la colonne d''arrivée, soit 3 après les deux cards constatées. Le trigger '
	'd''attribution de `CRM-040` est un `BEFORE INSERT` : il ne voit pas les déplacements, et sans '
	'ce recalcul deux cards porteraient le même rang (§5.4, docs/SPEC-cards.md §2.6)');

select ok(
	(select c.position from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3')
	<> (select position_depart from t_avant),
	'`position` a bien CHANGÉ : sa valeur de départ était 1 dans la colonne 61, et 1 aurait pu '
	'être verte par hasard dans la colonne d''arrivée si celle-ci avait été vide');

select ok(
	(select c.entered_step_at from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3')
	>= (select instant from t_avant),
	'`entered_step_at` ← l''instant du déplacement. docs/SPEC-cards.md §2.9 la réserve NOMMÉMENT à '
	'`move_card`, et c''est ici qu''elle prend son sens');

select ok(
	(select c.updated_at from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3')
	>= (select instant from t_avant),
	'`updated_at` est écrite par le trigger `app.set_updated_at()` de `CRM-040`, que la fonction '
	'n''a PAS à toucher — la garde ne réimplémente pas ce qui existe');

-- Les colonnes que le déplacement ne doit PAS toucher. Une garde qui écraserait le montant ou le
-- responsable au passage serait un défaut que rien d'autre ne verrait.
select is(
	(select c.title from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	'Audit sécurité applicative',
	'Le déplacement ne touche NI le titre…');
select is(
	(select c.amount from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	15500.00::numeric,
	'…NI le montant…');
select is(
	(select c.owner_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	'5eed0000-0000-4000-8000-000000000011'::uuid,
	'…NI le responsable. La fonction écrit trois colonnes, et trois seulement');

-- Les autres cards de la colonne d'arrivée ne bougent pas : l'insertion en fin ne renumérote rien.
select is(
	(select c.position from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c1'),
	1::numeric,
	'`c1`, déjà dans la colonne d''arrivée, garde sa position : arriver en fin ne renumérote pas '
	'la colonne, et l''ordre que l''utilisateur y avait mis est préservé');

select is(
	(select c.channel_id from public.cards c
	  where c.id = '5eed0000-0000-4000-8000-0000000000c3'),
	'5eed0000-0000-4000-8000-000000000032'::uuid,
	'`channel_id` est INCHANGÉ : changer de channel est `CRM-045`, une autre fonction et une autre '
	'unité');

-- La valeur de retour EST la ligne mise à jour, et non l'ancienne.
select is(
	(select (public.move_card('5eed0000-0000-4000-8000-0000000000c3',
	                          '5eed0000-0000-4000-8000-000000000063')).current_step_id),
	'5eed0000-0000-4000-8000-000000000063'::uuid,
	'La valeur de RETOUR porte l''étape d''ARRIVÉE, non celle de départ : le `returning` de la '
	'mise à jour, et non la copie chargée en 1.1 (§5.2)');

rollback to savepoint effets;

-- =============================================================================================
-- 5. La garde n'est pas contournable — sous le RÔLE RÉEL
-- =============================================================================================
-- La section 2 lit le catalogue des privilèges ; celle-ci exerce le refus. Les deux sont
-- nécessaires : un privilège correct dans `information_schema` et une politique permissive
-- donneraient encore un contournement.

savepoint contournement;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	update public.cards set current_step_id = '5eed0000-0000-4000-8000-000000000067'
	 where id = '5eed0000-0000-4000-8000-0000000000c3' $$,
	'42501', 'permission denied for table cards',
	'CONTOURNEMENT REFUSÉ, sous le rôle réel de l''administratrice : la mise à jour directe de '
	'`current_step_id` échoue en `42501`. C''est l''assertion `lives_ok` de '
	'`0012_cards.test.sql` §11 qui est RETOURNÉE ici — elle avait désigné son moment');

select lives_ok($$
	update public.cards set description = 'sonde de non-régression'
	 where id = '5eed0000-0000-4000-8000-0000000000c3' $$,
	'Les colonnes OUVERTES le restent : le même rôle modifie `description` sans entrave. Sans '
	'cette assertion, un `revoke` trop large serait vert au-dessus et aurait cassé toute écriture');

select lives_ok($$
	update public.cards set archived_at = now()
	 where id = '5eed0000-0000-4000-8000-0000000000c3' $$,
	'`archived_at` de même : archiver une card reste un geste du client, la garde ne ferme que le '
	'chemin du déplacement');

rollback to savepoint contournement;

-- =============================================================================================
-- 6. Ce qui reste dû, figé par des assertions
-- =============================================================================================
-- Aucune de ces assertions n'est un constat résigné : chacune devient rouge le jour où l'unité qui
-- la porte livre son objet, et force la révision des preuves plutôt que leur silence (décision 51).

-- --- INC-047 : LA VÉRIFICATION N° 6 EST ÉCRITE — l'assertion figée a désigné son moment --------
-- docs/SPEC-workflow-engine.md §5.7. Les deux assertions posées ici par `CRM-034` pour DEVENIR
-- ROUGES le jour de `CRM-036` le sont devenues, et sont RETOURNÉES, non retirées — mécanisme de la
-- décision 51, neuvième occurrence. Le détail des preuves de la n° 6 vit dans
-- `supabase/tests/0014_valeurs_champs.test.sql` ; ce qui reste ici est ce que `CRM-034` avait
-- promis de constater.

select has_table('public', 'card_field_values',
	'INC-047 CLOSE : `card_field_values` est livrée par `CRM-036`. L''ensemble des champs EXIGÉS '
	'était calculable dès `CRM-034` ; l''ensemble des champs RENSEIGNÉS a enfin une source');

select is(
	(select count(*)::int from public.form_field_rules r
	  where r.step_id = '5eed0000-0000-4000-8000-000000000063'
	    and r.visibility = 'required'),
	1,
	'ÉTAT CONSTATÉ, inchangé : l''étape 63 porte bien une règle `required` — une et non deux. Sans '
	'ce constat, l''assertion suivante serait verte parce qu''il n''y a RIEN à vérifier');

savepoint inc047;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	select public.move_card('5eed0000-0000-4000-8000-0000000000c1',
	                        '5eed0000-0000-4000-8000-000000000063') $$,
	'P0001', 'missing_required_fields',
	'INC-047, ÉCART REFERMÉ : le déplacement de `…0c1` vers une étape `required` est désormais '
	'REFUSÉ. Cette assertion constatait le contraire jusqu''à `CRM-036` — elle a été RETOURNÉE, non '
	'retirée, et c''est elle qui a désigné le moment d''écrire la n° 6 et son message');

rollback to savepoint inc047;

-- --- INC-048 : le commentaire fourni n'est conservé nulle part ---------------------------------

-- RÉVISÉE À `CRM-043`, NON RETIRÉE, ET LE DÉFAUT SUBSISTE. `card_comments` existe désormais : la
-- cause bloquante d'INC-048 — « la table n'existe pas » — est levée. Le motif d'une affaire perdue
-- disparaît POURTANT toujours, `move_card` n'ayant pas été redéfinie : elle est un livrable de
-- `CRM-034`, et `CRM-043` ne reprend pas les gardes d'une autre unité sans les rejouer sous la
-- sienne (`CLAUDE.md` §13). L'assertion mesure maintenant l'écart lui-même, et non plus son alibi.
select has_table('public', 'card_comments',
	'INC-048 : `card_comments` EXISTE depuis `CRM-043` — la cause bloquante est levée');
select ok(
	(select prosrc not like '%card_comments%' from pg_proc
	  where oid = 'public.move_card(uuid, uuid, text)'::regprocedure),
	'INC-048 : et `move_card` n''écrit TOUJOURS PAS le commentaire qu''elle exige. La vérification '
	'n° 5 le CONTRÔLE, rien ne l''ÉCRIT, et l''utilisateur qui motive une affaire perdue voit son '
	'motif disparaître. L''arbitrage n''est plus théorique : il est EXIGIBLE');

select hasnt_table('public', 'card_events',
	'`card_events` reste due par `CRM-044` : aucun événement `moved` n''est écrit, la trace du '
	'déplacement n''existe pas');

-- --- INC-050 : `email_local_part` est FERMÉE, et la contradiction est éteinte ------------------
-- ASSERTION RETOURNÉE PAR `CRM-013` (décision 51). Elle constatait la colonne ouverte, et disait
-- devoir devenir rouge le jour où l'unité qui la porte serait livrée. Elle l'est : la migration
-- 0014 retire le privilège, et l'état posé coïncide alors EXACTEMENT avec le bloc `GRANT` du §5.5
-- — la contradiction s'éteint par exécution, non par arbitrage (décision 142).
--
-- ELLE FIGE AUSSI LA DÉPENDANCE D'ORDRE 12 → 14 : cette suite s'exécute après le répertoire de
-- migrations entier. Un harnais qui rejouerait la migration 12 SEULE rouvrirait la colonne, et
-- cette assertion le dénoncerait.

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'update'),
	'INC-050 CLOSE : `email_local_part` est FERMÉE par `CRM-013` (migration 0014). Si cette '
	'assertion tombe, c''est que la migration 12 a été rejouée seule — elle rend la colonne, '
	'§5.5 et INC-050 — et le produit est resté dégradé (décisions 108, 135)');

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'INC-049, chevauchement TRANCHÉ du côté de `CRM-034` : seule la colonne que CETTE garde protège '
	'est traitée. Une unité dont la Definition of Done exige une preuve doit livrer ce qui la rend '
	'possible');

select finish();
rollback;

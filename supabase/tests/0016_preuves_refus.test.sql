-- @verifies CRM-014 (docs/BACKLOG.md) — harnais des douze preuves de refus d'autorisation
-- @verifies docs/SPEC-permissions-rls.md §7 (les douze preuves), §7.2 (contrat mesuré),
--           §7.3 (ce qui n'est pas satisfaisable, et comment l'absence est figée),
--           §7.4 (non-complaisance)
-- @verifies docs/SPEC-test-harness.md §4.6 (fichier consolidé du projet `api`)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-014 (aucune politique sur les tables d'identité),
--           INC-057 (un `@verifies` annonçait la preuve n° 3 sans la porter)
-- @verifies docs/SCHEMA.md §1 (tables du socle), §5 (cards)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- Suite pgTAP de l'unité `CRM-014`. Le fichier de scénarios `e2e/api/preuves-refus.spec.ts` prouve
-- que le produit **refuse** ; cette suite prouve que le produit **est en état d'être interrogé**,
-- ce qui est une question distincte et qu'aucune assertion HTTP ne pose :
--
--   1. l'inventaire des politiques est celui attendu, table par table et nom par nom. Une politique
--      retirée, renommée ou ajoutée fait échouer la suite — c'est ce qui rend le harnais capable
--      d'échouer quand le produit se dégrade (§7.4) ;
--   2. les douze tables métier interrogées par la preuve n° 11 sont **réellement peuplées**. Sans
--      cela, « l'anonyme lit zéro ligne » serait vrai que la RLS refuse ou qu'elle autorise tout
--      (décision 50) ;
--   3. les tables d'identité portent **zéro politique**, ce qui est l'état mesuré et la raison pour
--      laquelle la preuve n° 10 obtient son effet sans porter sa règle (décision 148, INC-014) ;
--   4. les cinq preuves non satisfaisables le sont parce que leur objet **n'existe pas**, figé par
--      des assertions d'absence qui deviendront rouges à la naissance de la table ou de la fonction
--      (mécanisme de la décision 51, convention de `CRM-006` puis `CRM-013`).
--
-- Exécution : `npm run test:sql`, `scripts/verify-preuves-refus.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0016_preuves_refus.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Aucun bloc n'emploie
-- `rollback to savepoint` : une assertion prise dans un savepoint annulé est **numérotée mais non
-- comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

-- =============================================================================================
-- 1. Inventaire des politiques — ce qui rend le harnais capable d'échouer (§7.4)
-- =============================================================================================
-- Chaque table métier est énumérée avec les politiques qu'elle doit porter, **nommées**. Un
-- `drop policy` — la dégradation qu'éprouve `scripts/verify-preuves-refus.sh` — fait donc échouer
-- la suite ici, avant même que les scénarios HTTP ne s'en aperçoivent. Compter les politiques
-- sans les nommer laisserait passer un remplacement ; les nommer sans les compter laisserait
-- passer un ajout permissif. Les deux sont donc assérés.

create or replace function pg_temp.politiques(nom_table text)
returns text[] language sql stable as $$
	select coalesce(array_agg(policyname order by policyname), '{}')
	from pg_policies where schemaname = 'public' and tablename = nom_table;
$$;

select is(pg_temp.politiques('cards'),
	array['cards_insertion', 'cards_lecture', 'cards_maj'],
	'`cards` porte ses trois politiques. C''est la table la plus exposée de l''inventaire : trois '
	'des sept preuves acquises en dépendent — n° 3, n° 4 et n° 11 (décision 149)');

select is(pg_temp.politiques('card_field_values'),
	array['card_field_values_insertion', 'card_field_values_lecture', 'card_field_values_maj'],
	'`card_field_values` porte ses trois politiques — la preuve n° 4 les traverse');

select is(pg_temp.politiques('tracks'),
	array['tracks_insertion_admin', 'tracks_lecture_membre', 'tracks_maj_admin'],
	'`tracks` porte ses trois politiques');

select is(pg_temp.politiques('channels'),
	array['channels_insertion_admin', 'channels_lecture_membre', 'channels_maj_admin'],
	'`channels` porte ses trois politiques');

select is(pg_temp.politiques('track_members'),
	array['track_members_insertion_admin', 'track_members_lecture', 'track_members_maj_admin',
	      'track_members_suppression_admin'],
	'`track_members` porte ses quatre politiques');

select is(pg_temp.politiques('channel_members'),
	array['channel_members_insertion_admin', 'channel_members_lecture', 'channel_members_maj_admin',
	      'channel_members_suppression_admin'],
	'`channel_members` porte ses quatre politiques');

select is(pg_temp.politiques('workflows'),
	array['workflows_insertion_admin', 'workflows_lecture_membre', 'workflows_maj_admin'],
	'`workflows` porte ses trois politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_steps'),
	array['workflow_steps_insertion_admin', 'workflow_steps_lecture_membre',
	      'workflow_steps_maj_admin', 'workflow_steps_suppression_admin'],
	'`workflow_steps` porte ses quatre politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_transitions'),
	array['workflow_transitions_insertion_admin', 'workflow_transitions_lecture_membre',
	      'workflow_transitions_maj_admin', 'workflow_transitions_suppression_admin'],
	'`workflow_transitions` porte ses quatre politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('workflow_nodes_catalog'),
	array['catalogue_noeuds_insertion_admin', 'catalogue_noeuds_lecture_membre',
	      'catalogue_noeuds_maj_admin'],
	'`workflow_nodes_catalog` porte ses trois politiques — la preuve n° 2 s''y oppose');

select is(pg_temp.politiques('form_fields'),
	array['form_fields_insertion_admin', 'form_fields_lecture_membre', 'form_fields_maj_admin'],
	'`form_fields` porte ses trois politiques');

select is(pg_temp.politiques('form_field_rules'),
	array['form_field_rules_insertion_admin', 'form_field_rules_lecture_membre',
	      'form_field_rules_maj_admin', 'form_field_rules_suppression_admin'],
	'`form_field_rules` porte ses quatre politiques');

select is(
	(select count(*)::int from pg_policies where schemaname = 'public'),
	45,
	'QUARANTE-CINQ politiques dans `public`, et pas une de plus — 41 jusqu''à `CRM-042`, plus les '
	'TROIS de `card_comments` livrées par `CRM-043`, plus l''UNIQUE politique de lecture de '
	'`card_events` livrée par `CRM-044` — qui n''en porte pas d''autre, écrire n''y étant ouvert à '
	'personne. Une politique ajoutée sans que cette suite '
	'soit étendue — permissive ou non — fait échouer ce compte : c''est la contrepartie du contrôle '
	'par nom, qui à lui seul ne verrait pas un ajout');

-- La RLS activée est ce qui rend les politiques opposables. Une table dont la RLS serait désactivée
-- porterait ses politiques sans les appliquer : le pire des deux mondes, un inventaire rassurant
-- sur une table ouverte.
select ok(
	(select bool_and(c.relrowsecurity)
	 from pg_class c join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public' and c.relkind = 'r'),
	'RLS ACTIVÉE sur TOUTES les tables de `public`, sans exception. Sans elle, l''inventaire '
	'ci-dessus décrirait des politiques inertes');

-- =============================================================================================
-- 2. Condition de validité de la preuve n° 11 — les douze tables métier sont peuplées
-- =============================================================================================
-- « L'anonyme lit zéro ligne » ne prouve rien sur une table vide : l'assertion serait verte que la
-- RLS refuse ou qu'elle autorise tout (décision 50). Les douze tables que le scénario n° 11
-- interroge sont donc d'abord constatées **non vides**, ici, sous un rôle qui contourne la RLS.

select isnt_empty('select 1 from public.tracks',
	'PREUVE N° 11, condition de validité 1/12 : `tracks` est peuplée');
select isnt_empty('select 1 from public.channels',
	'PREUVE N° 11, condition de validité 2/12 : `channels` est peuplée');
select isnt_empty('select 1 from public.workflows',
	'PREUVE N° 11, condition de validité 3/12 : `workflows` est peuplée');
select isnt_empty('select 1 from public.workflow_steps',
	'PREUVE N° 11, condition de validité 4/12 : `workflow_steps` est peuplée');
select isnt_empty('select 1 from public.workflow_transitions',
	'PREUVE N° 11, condition de validité 5/12 : `workflow_transitions` est peuplée');
select isnt_empty('select 1 from public.workflow_nodes_catalog',
	'PREUVE N° 11, condition de validité 6/12 : `workflow_nodes_catalog` est peuplée');
select isnt_empty('select 1 from public.form_fields',
	'PREUVE N° 11, condition de validité 7/12 : `form_fields` est peuplée');
select isnt_empty('select 1 from public.form_field_rules',
	'PREUVE N° 11, condition de validité 8/12 : `form_field_rules` est peuplée');
select isnt_empty('select 1 from public.cards',
	'PREUVE N° 11, condition de validité 9/12 : `cards` est peuplée');
select isnt_empty('select 1 from public.card_field_values',
	'PREUVE N° 11, condition de validité 10/12 : `card_field_values` est peuplée');
select isnt_empty('select 1 from public.track_members',
	'PREUVE N° 11, condition de validité 11/12 : `track_members` est peuplée — elle ne l''était pas '
	'à `CRM-008`, qui l''excluait pour cette raison exacte (docs/SPEC-test-harness.md §4.3)');
select isnt_empty('select 1 from public.channel_members',
	'PREUVE N° 11, condition de validité 12/12 : `channel_members` est peuplée — même remarque');

-- =============================================================================================
-- 3. Preuve n° 10 — l'effet est obtenu, la règle n'existe pas (décision 148, INC-014)
-- =============================================================================================
-- Un administrateur qui tente de se retirer son rôle est bien sans effet. Mais ce n'est pas une
-- règle qui l'arrête : c'est l'absence de toute politique sur `workspace_members`, donc le refus
-- par défaut de `CRM-003`. Le distinguer n'est pas une subtilité : le jour où INC-014 sera
-- arbitrée, la protection disparaîtra au moment précis où le produit deviendra utilisable.

select is(pg_temp.politiques('workspace_members'), '{}'::text[],
	'PREUVE N° 10, ce qu''elle ne prouve PAS : `workspace_members` porte ZÉRO politique. Le refus '
	'vient du refus par défaut de `CRM-003`, pas d''une règle protégeant le dernier administrateur. '
	'Cette assertion deviendra ROUGE dès qu''INC-014 sera arbitrée — et c''est à ce moment-là que '
	'la règle devra être écrite');

select is(pg_temp.politiques('workspaces'), '{}'::text[],
	'`workspaces` porte zéro politique — INC-014, même arbitrage attendu');

select is(pg_temp.politiques('profiles'), '{}'::text[],
	'`profiles` porte zéro politique — INC-014, même arbitrage attendu');

-- L'administratrice du seed est bien la **seule** de son workspace : sans cela, « le dernier
-- administrateur » ne désignerait personne et le scénario n° 10 mesurerait autre chose.
select is(
	(select count(*)::int from public.workspace_members
	 where workspace_id = '5eed0000-0000-4000-8000-000000000001' and role = 'admin'),
	1,
	'PREUVE N° 10, condition de validité : le workspace du seed n''a QU''UN administrateur. Avec '
	'deux, le scénario ne porterait plus sur le « dernier »');

-- =============================================================================================
-- 4. Preuves n° 1, n° 2, n° 5 — ce qui les rend opposables, constaté en base
-- =============================================================================================
-- Ces trois preuves reposent sur des privilèges de table et sur l'existence d'une garde RPC. Les
-- scénarios HTTP mesurent le refus ; ces assertions mesurent la **cause** du refus, de sorte qu'un
-- privilège rendu par mégarde soit dénoncé ici et non par un `403` qui cesserait d'arriver.

select ok(
	not has_table_privilege('authenticated', 'public.cards', 'update'),
	'PREUVE N° 5, sa cause : `authenticated` n''a AUCUN `UPDATE` de table sur `cards`. C''est ce '
	'retrait, posé par `CRM-034`, qui rend `move_card` incontournable');

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'PREUVE N° 5, sa cible exacte : `current_step_id` n''est pas modifiable colonne à colonne non '
	'plus. Un `grant update (…)` trop large la rouvrirait sans toucher au privilège de table');

select has_function('public', 'move_card', array['uuid', 'uuid', 'text'],
	'PREUVE N° 1, son sujet : `move_card` existe avec sa signature. Sans elle, le `403` du '
	'`viewer` serait un `404` et la preuve porterait sur une fonction absente');

select is(
	(select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	true,
	'PREUVE N° 1, sa cause : `move_card` est `SECURITY DEFINER`. C''est ce qui lui permet de '
	'refuser explicitement là où la RLS refuserait silencieusement');

select ok(
	(select prosrc like '%forbidden%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	'PREUVE N° 1, sa forme : `move_card` lève `forbidden`. Un refus muet rendrait `200` et ne '
	'déplacerait rien — le pire des deux mondes (décision 141)');

select ok(
	(select prosrc like '%card_not_found%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'move_card'),
	'PREUVE N° 1'', sa forme : `move_card` distingue `card_not_found` de `forbidden` — règle de '
	'discrétion (docs/SPEC-workflow-engine.md §5.3). Confondre les deux dirait à un appelant '
	'qu''une card existe hors de sa vue');

-- =============================================================================================
-- 5. Preuve n° 4 — le droit fin qui la rend mesurable est bien posé par le seed
-- =============================================================================================

select is(
	(select count(*)::int from public.track_members
	 where user_id = '5eed0000-0000-4000-8000-000000000013' and access = 'none'),
	1,
	'PREUVE N° 4, sa cause : le `viewer` est fermé sur un track par un droit fin `none`. Sans ce '
	'droit, son « zéro ligne » ne distinguerait pas un refus d''une absence de données');

select isnt_empty(
	'select 1 from public.cards where channel_id = ''5eed0000-0000-4000-8000-000000000032''',
	'PREUVE N° 4, sa condition de validité : le channel fermé au `viewer` porte RÉELLEMENT des '
	'cards, constaté sans RLS');

-- =============================================================================================
-- 6. Les cinq preuves non satisfaisables — absences figées, non commentées (§7.3)
-- =============================================================================================
-- Convention posée par `CRM-006` et reprise par `CRM-013` : une limite s'assère, elle ne se
-- commente pas. Chacune de ces assertions deviendra ROUGE le jour où l'objet naîtra, et désignera
-- alors la preuve à écrire — au lieu de laisser la limite survivre à sa cause.

select hasnt_table('public', 'mail_inbound_accounts',
	'PREUVE N° 6 NON SATISFAISABLE : `mail_inbound_accounts` attend `CRM-052`. La lecture de son '
	'`secret_id` par `authenticated` ne peut pas être éprouvée sur une table absente');

select hasnt_table('public', 'mail_outbound_identities',
	'PREUVE N° 7 NON SATISFAISABLE : `mail_outbound_identities` attend `CRM-053`. La lecture du '
	'compte mail d''un autre utilisateur n''a aucun sujet');

-- ASSERTION RETOURNÉE PAR `CRM-044` (décision 51). La moitié de la preuve n° 8 est désormais
-- SATISFAISABLE, et le refus est mesuré ici même plutôt qu'annoncé : aucun privilège d'écriture,
-- pour aucun des trois rôles. `e2e/api/timeline.spec.ts` l'exerce avec les jetons réels.
select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee in ('anon','authenticated','service_role')
	    and privilege_type <> 'SELECT'),
	0,
	'PREUVE N° 8 SATISFAISABLE POUR MOITIÉ, 1/2 : `card_events` est livrée par `CRM-044` et '
	'n''accorde AUCUN privilège d''écriture, `service_role` compris');

select hasnt_table('public', 'audit_log',
	'PREUVE N° 8 NON SATISFAISABLE, 2/2 : `audit_log` attend `CRM-072`');

select is(
	(select count(*)::int from storage.buckets),
	0,
	'PREUVE N° 9 NON SATISFAISABLE : AUCUN bucket de storage. Le téléchargement d''une pièce jointe '
	'`infected` ou `pending` n''a ni fichier, ni statut antiviral, ni politique à éprouver');

select ok(
	to_regclass('public.attachments') is null and to_regclass('public.card_attachments') is null,
	'PREUVE N° 9 NON SATISFAISABLE, suite : aucune table de pièces jointes non plus. Les deux noms '
	'plausibles sont testés — figer l''absence d''un seul laisserait naître l''autre en silence');

select hasnt_function('public', 'queue_outbound_email',
	'PREUVE N° 12 NON SATISFAISABLE : `queue_outbound_email` attend `CRM-058`. Envoyer avec une '
	'identité qui ne vous appartient pas suppose une fonction d''envoi');

-- Ce que ces sept assertions signifient ensemble, dit une fois plutôt que sept : sur les douze
-- preuves de `docs/SPEC-permissions-rls.md` §7, **cinq** portent sur des objets absents. `CRM-014`
-- ne les compense par aucune preuve de substitution, et reste `[~]` pour cette raison — bloquée
-- par une dépendance, non par un défaut de l'unité.
select is(
	(select count(*)::int from (values
		('public.mail_inbound_accounts'), ('public.mail_outbound_identities'),
		('public.audit_log'), ('public.attachments')
	) as cibles(nom) where to_regclass(nom) is not null),
	0,
	'QUATRE PREUVES SUR DOUZE RESTENT HORS D''ATTEINTE — elles étaient CINQ jusqu''à `CRM-044`, qui '
	'a livré `card_events` et rendu la moitié de la n° 8 satisfaisable. Le compte est asséré plutôt '
	'qu''énoncé : le jour où l''une des quatre naît, il cesse de valoir zéro et l''unité doit être '
	'rouverte');

select finish();
rollback;

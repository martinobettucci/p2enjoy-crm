-- @verifies CRM-040 (docs/BACKLOG.md) — cards : table, adresse générée, responsable, montant,
--            archivage, corbeille
-- @verifies docs/SPEC-cards.md §2 (modèle), §3 (adresse), §4 (cycle de vie), §5 (« active »),
--           §6 (autorisations), §7 (garde d'archivage), §9 (seed), §10 (points ouverts)
-- @verifies docs/SCHEMA.md §5 (cards), §9 (fonctions), §10 (index)
-- @verifies docs/SPEC-permissions-rls.md §3 (fonctions), §4 (politiques), §7 (preuves n° 3, 4, 11)
-- @verifies docs/SPEC-workflow-engine.md §2.6 (archivage d'un nœud occupé), §5 (`move_card`)
-- @verifies docs/JOURNAL.md décisions 109, 110, 111, 112 ; INC-013, INC-025, INC-031, INC-046
--
-- Suite pgTAP de l'unité `CRM-040`. Elle prouve huit choses :
--
--   1. la **forme** de la table, ses contraintes de valeur et ses index ;
--   2. les **trois clés composites** de la décision 109, chacune dans les **deux** sens — une
--      assertion qui ne prouverait que le cas accepté serait verte avec ou sans la contrainte ;
--   3. la **conséquence émergente** d'INC-046 : le workflow d'un channel occupé ne se change plus ;
--   4. la **génération de l'adresse** — forme, unicité, valeur du client ignorée — et le fait que
--      c'est l'**index** qui garantit, non la boucle (décision 112) ;
--   5. les **politiques**, éprouvées avec les rôles réels des comptes seedés, y compris l'écart
--      entre la ligne de départ et la ligne d'arrivée d'une mise à jour ;
--   6. `app.can_read_card`, éprouvée **directement** — aucune politique ne l'appelle (décision 110) ;
--   7. la **garde d'archivage d'un nœud occupé** dans ses trois cas — INC-031, décision 111 ;
--   8. ce qui **reste dû**, figé par des assertions : `move_card`, les tables filles, la protection
--      de colonne de `CRM-013`, l'absence de contrainte de signe sur `amount`, et l'absence de card
--      dans `prospection`.
--
-- Exécution : `npm run test:sql`, `scripts/verify-cards.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0012_cards.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier.

begin;

create extension if not exists pgtap with schema extensions;

select plan(89);

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

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role anon';
end;
$$;

-- =============================================================================================
-- 1. La table et ses colonnes — docs/SCHEMA.md §5
-- =============================================================================================

select has_table('public', 'cards', '`public.cards` est livrée — INC-031 et INC-043 en dépendaient');

select has_column('public', 'cards', 'email_local_part', '`email_local_part` existe');
select has_column('public', 'cards', 'owner_id',         '`owner_id` — le responsable de CRM-040');
select has_column('public', 'cards', 'amount',           '`amount` — le montant de CRM-040');
select has_column('public', 'cards', 'archived_at',      '`archived_at` — l''archivage');
select has_column('public', 'cards', 'deleted_at',       '`deleted_at` — la corbeille, distincte');
select has_column('public', 'cards', 'health_score',     '`health_score` — livrée, jamais alimentée (§2.9)');
select has_column('public', 'cards', 'search_tsv',       '`search_tsv` — recherche plein texte');

-- INC-025, troisième occurrence : le tableau du §5 omet les colonnes communes, la convention fait foi.
select has_column('public', 'cards', 'created_at',
	'INC-025 : `created_at`, que le tableau de docs/SCHEMA.md §5 omet, est bien là');
select has_column('public', 'cards', 'updated_at',
	'INC-025 : `updated_at` de même');

select col_type_is('public', 'cards', 'amount',   'numeric(14,2)', '`amount` est `numeric(14,2)`');
select col_type_is('public', 'cards', 'position', 'numeric',
	'`position` est `numeric` : index fractionnaire, comme `tracks` et `channels` (§2.6)');
select col_type_is('public', 'cards', 'search_tsv', 'tsvector', '`search_tsv` est un `tsvector`');

select col_not_null('public', 'cards', 'email_local_part',
	'`email_local_part` est non nul : le trigger précède toujours l''insertion');
select col_not_null('public', 'cards', 'position',
	'`position` est non nul — le trigger la renseigne lorsqu''elle est omise');
select col_not_null('public', 'cards', 'entered_step_at', '`entered_step_at` est non nul');
select col_has_default('public', 'cards', 'currency', '`currency` a un défaut de colonne');
select col_default_is('public', 'cards', 'currency', 'EUR'::text, 'ce défaut vaut `EUR`');

-- `position` n'a **pas** de défaut de colonne : c'est le trigger qui la renseigne, et un défaut
-- l'empêcherait de se déclencher — `new.position` ne serait jamais nul.
select col_hasnt_default('public', 'cards', 'position',
	'`position` n''a AUCUN défaut de colonne : un défaut rendrait le trigger du §2.6 inerte');

select is(
	(select generation_expression is not null
	   from information_schema.columns
	  where table_schema = 'public' and table_name = 'cards' and column_name = 'search_tsv'),
	true,
	'`search_tsv` est une colonne GÉNÉRÉE, non une colonne écrite par un trigger (§2.7)');

-- =============================================================================================
-- 2. Contraintes de valeur
-- =============================================================================================

-- Fixture minimale : un channel du seed dont le workflow ne bouge pas, et une de ses étapes.
create temporary table t_ctx on commit drop as
select c.workspace_id, c.id as channel_id, c.workflow_id,
       (select s.id from public.workflow_steps s
         join public.workflow_nodes_catalog n on n.id = s.node_id
        where s.workflow_id = c.workflow_id and n.key = 'prospection') as step_id
  from public.channels c where c.slug = 'grands-comptes';

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select workspace_id, channel_id, workflow_id, step_id, '   ' from t_ctx $$,
	'23514', null,
	'un titre d''espaces est refusé : `cards_title_check`');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, currency)
	select workspace_id, channel_id, workflow_id, step_id, 'Devise', 'euro' from t_ctx $$,
	'23514', null,
	'`currency = ''euro''` est refusée : la FORME ISO 4217 est tenue par la base (§2.3)');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title,
	                          probability_override)
	select workspace_id, channel_id, workflow_id, step_id, 'Proba', 101 from t_ctx $$,
	'23514', null,
	'`probability_override = 101` est refusée : bornée à [0, 100]');

select lives_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title,
	                          probability_override)
	select workspace_id, channel_id, workflow_id, step_id, 'Proba nulle', null from t_ctx $$,
	'`probability_override` nulle est acceptée : la contrainte ne juge qu''une valeur fournie');

-- =============================================================================================
-- 3. Les trois clés composites — décision 109, DANS LES DEUX SENS
-- =============================================================================================
-- Une assertion qui ne prouverait que le cas accepté serait verte avec ou sans la contrainte.

select has_index('public', 'channels', 'channels_id_workspace_id_key',
	'l''unicité `channels (id, workspace_id)` existe : sans elle, la clé composite est refusée');
select has_index('public', 'channels', 'channels_id_workflow_id_key',
	'l''unicité `channels (id, workflow_id)` existe');

select lives_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select workspace_id, channel_id, workflow_id, step_id, 'Cohérente' from t_ctx $$,
	'une card cohérente est acceptée : les trois clés ne ferment pas le cas nominal');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select '55550000-0000-4000-8000-0000000000ff', channel_id, workflow_id, step_id, 'Faux ws'
	  from t_ctx $$,
	'23503', null,
	'un `workspace_id` autre que celui du channel est refusé : le dénormalisé ne peut pas mentir');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select t.workspace_id, t.channel_id,
	       (select w.id from public.workflows w where w.id <> t.workflow_id limit 1),
	       t.step_id, 'Faux wf'
	  from t_ctx t $$,
	'23503', null,
	'un `workflow_id` autre que celui du channel est refusé — « suit le channel » (§2.5)');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select t.workspace_id, t.channel_id, t.workflow_id,
	       (select s.id from public.workflow_steps s where s.workflow_id <> t.workflow_id limit 1),
	       'Fausse étape'
	  from t_ctx t $$,
	'23503', null,
	'une étape d''un AUTRE workflow est refusée : c''est la vérification n° 3 des six de '
	'`move_card`, acquise structurellement (docs/SPEC-workflow-engine.md §5)');

-- --- 3 bis. INC-046 : la conséquence émergente, mesurée et figée ------------------------------
-- Le jour où l'arbitrage retiendra une autre règle, cette assertion le dira.

select throws_ok($$
	update public.channels
	   set workflow_id = (select w.id from public.workflows w
	                       where w.id <> channels.workflow_id limit 1)
	 where slug = 'grands-comptes' $$,
	'23503', null,
	'INC-046 : changer le workflow d''un channel OCCUPÉ est refusé. Règle défendable, que nulle '
	'spécification n''énonce — arbitrage attendu, docs/SPEC-cards.md §2.4');

-- =============================================================================================
-- 4. L'adresse de la card — §3, décision 112
-- =============================================================================================

select matches(
	(select email_local_part from public.cards where title = 'Cohérente'),
	'^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$',
	'l''adresse générée a la forme `c-<8 base32 Crockford minuscule>` — sans `i`, `l`, `o` ni `u`');

-- La valeur fournie par le client est IGNORÉE : « généré » signifie qu'elle ne vient pas de lui.
insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title,
                          email_local_part)
select workspace_id, channel_id, workflow_id, step_id, 'Adresse imposée', 'c-00000000' from t_ctx;

select isnt(
	(select email_local_part from public.cards where title = 'Adresse imposée'),
	'c-00000000',
	'une adresse fournie par le client est IGNORÉE et remplacée (§3.4) : sans quoi un appelant '
	'choisirait une adresse devinable');

select isnt(
	(select email_local_part from public.cards where title = 'Cohérente'),
	(select email_local_part from public.cards where title = 'Adresse imposée'),
	'deux cards créées de suite portent deux adresses différentes');

-- Ce qui garantit l'unicité est l'index, non la boucle du trigger (décision 112).
select has_index('public', 'cards', 'cards_email_local_part_key',
	'l''index unique existe : c''est LUI qui garantit l''unicité, la boucle ne fait que la rendre '
	'probable (décision 112)');
select is(
	(select indisunique from pg_index where indexrelid = 'public.cards_email_local_part_key'::regclass),
	true,
	'et il est bien UNIQUE');

select throws_ok($$
	update public.cards set email_local_part = 'c-iiiiiiii' where title = 'Cohérente' $$,
	'23514', null,
	'la FORME de l''adresse est tenue par la base, pas seulement par le trigger : `i` n''appartient '
	'pas à l''alphabet de Crockford');

-- =============================================================================================
-- 5. `position` dans sa portée — §2.6
-- =============================================================================================

select is(
	(select position from public.cards where title = 'Adresse imposée'),
	(select position from public.cards where title = 'Cohérente') + 1,
	'`position` est attribuée en fin de COLONNE — portée (channel, étape), non le channel entier');

insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, position)
select workspace_id, channel_id, workflow_id, step_id, 'Position fournie', 42 from t_ctx;

select is(
	(select position from public.cards where title = 'Position fournie'), 42::numeric,
	'une `position` fournie n''est pas écrasée : le trigger ne se déclenche que si elle est omise');

-- Une autre étape du même channel repart de 1 : c'est ce qui distingue « colonne » de « channel ».
insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
select t.workspace_id, t.channel_id, t.workflow_id,
       (select s.id from public.workflow_steps s
         join public.workflow_nodes_catalog n on n.id = s.node_id
        where s.workflow_id = t.workflow_id and n.key = 'perdu'),
       'Autre colonne'
  from t_ctx t;

select is(
	(select position from public.cards where title = 'Autre colonne'), 1::numeric,
	'une autre étape du MÊME channel repart de 1 : la portée est bien la colonne du board');

-- =============================================================================================
-- 6. `search_tsv` et les index — §2.7, §2.8
-- =============================================================================================

update public.cards set description = 'Client historique du studio'
 where title = 'Cohérente';

select is(
	(select search_tsv @@ to_tsquery('french', 'histor') from public.cards where title = 'Cohérente'),
	true,
	'`search_tsv` indexe la DESCRIPTION autant que le titre, et racinise en français');

select has_index('public', 'cards', 'cards_channel_step_position_idx',
	'index d''une colonne de board, docs/SCHEMA.md §10');
select has_index('public', 'cards', 'cards_workspace_next_action_idx',
	'index de la vue « Ma journée »');
select has_index('public', 'cards', 'cards_search_tsv_idx',
	'index GIN de recherche');
select has_index('public', 'cards', 'cards_owner_idx',
	'index sur `owner_id` : ne figure pas au §10, et s''y ajoute — PostgreSQL n''indexe pas la '
	'colonne référençante d''une clé étrangère, et `on delete set null` parcourrait la table');

-- =============================================================================================
-- 7. RLS, politiques et privilèges — §6
-- =============================================================================================

select is(
	(select relrowsecurity from pg_class where oid = 'public.cards'::regclass), true,
	'RLS est activée sur `cards` dès la migration qui la crée');

select policies_are('public', 'cards',
	array['cards_lecture', 'cards_insertion', 'cards_maj'],
	'trois politiques, et TROIS SEULEMENT : aucune politique `for delete` (§4)');

select ok(has_table_privilege('anon', 'public.cards', 'SELECT'),
	'`anon` a `SELECT` : sans lui le refus serait `401` par privilège, non ZÉRO LIGNE (§6.3)');
select ok(not has_table_privilege('anon', 'public.cards', 'INSERT'),
	'`anon` n''a aucun droit d''écriture');
select ok(has_table_privilege('authenticated', 'public.cards', 'INSERT'),
	'`authenticated` peut créer une card — la politique décide ensuite');
-- ASSERTION RETOURNÉE PAR `CRM-034` (décision 51). Elle disait « `authenticated` peut modifier une
-- card » et portait sur la TABLE ; `CRM-034` a retiré ce privilège de table pour fermer la colonne
-- `current_step_id` (docs/SPEC-workflow-engine.md §5.5). Elle n'est pas retirée mais **précisée**,
-- et elle est désormais PLUS FORTE : elle nomme la colonne dont dépendait la politique éprouvée
-- plus bas, au lieu de se contenter d'un droit de table qui ne dit pas QUOI est modifiable.
select ok(has_column_privilege('authenticated', 'public.cards', 'title', 'UPDATE'),
	'`authenticated` peut modifier une card — éprouvé sur `title`. Le privilège est désormais posé '
	'COLONNE PAR COLONNE : `CRM-034` a fermé `current_step_id` pour que sa garde ne soit pas '
	'contournable par un `PATCH` (docs/SPEC-workflow-engine.md §5.5)');
select ok(not has_table_privilege('authenticated', 'public.cards', 'DELETE'),
	'AUCUN privilège `DELETE` : « supprimer » est toujours un horodatage (§4)');
select ok(not has_table_privilege('anon', 'public.cards', 'DELETE'),
	'`anon` non plus, évidemment');

-- --- 7.1 Les politiques éprouvées avec les rôles réels des comptes seedés ---------------------
-- Le `viewer` porte `track_members.access = 'none'` sur « Conseil & IA », qui contient
-- `grands-comptes` : ses cards doivent lui être invisibles. `docs/SPEC-seed.md` §2.11.

savepoint p_roles;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select count(*)::int from public.cards c
	   join public.channels ch on ch.id = c.channel_id
	  where ch.slug = 'grands-comptes'),
	0,
	'PREUVE N° 4 sur les cards : le `viewer`, fermé sur le track par un droit fin, ne voit AUCUNE '
	'card de `grands-comptes` — zéro ligne, jamais une erreur');

select isnt(
	(select count(*)::int from public.cards c
	   join public.channels ch on ch.id = c.channel_id
	  where ch.slug = 'refonte'),
	0,
	'et il voit celles des channels que rien ne lui ferme : la politique cloisonne, elle ne ferme '
	'pas tout');

select throws_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
	select c.workspace_id, c.id, c.workflow_id,
	       (select s.id from public.workflow_steps s where s.workflow_id = c.workflow_id limit 1),
	       'Par un viewer'
	  from public.channels c where c.slug = 'refonte' $$,
	'42501', null,
	'un `viewer` de workspace ne PEUT PAS créer de card, même là où il lit : la création exige le '
	'droit d''ÉCRITURE sur le channel');

rollback to savepoint p_roles;

savepoint p_bizdev;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select isnt(
	(select count(*)::int from public.cards c
	   join public.channels ch on ch.id = c.channel_id
	  where ch.slug = 'maintenance'),
	0,
	'le `business_developer`, restreint en LECTURE SEULE sur `maintenance` par un droit fin, y voit '
	'bien les cards');

-- LE REFUS DU `USING` NE LÈVE AUCUNE ERREUR — leçon de la décision 106, transposée à `update`.
-- MESURÉ : la commande réussit, zéro ligne est touchée, aucun `SQLSTATE` n'est levé. Un test qui
-- constaterait l'absence d'erreur serait vert que la politique tienne ou qu'elle ait été retirée ;
-- le refus se prouve donc en RELISANT la ligne.
update public.cards set title = 'Interdit' where id = '5eed0000-0000-4000-8000-0000000000c5';

select is(
	(select count(*)::int from public.cards
	  where id = '5eed0000-0000-4000-8000-0000000000c5' and title = 'Interdit'),
	0,
	'…mais il ne peut pas les modifier : le `USING` de `cards_maj` FILTRE — aucune erreur, aucune '
	'ligne touchée, la card reste intacte (décision 106, transposée à `update`)');

-- L'écart entre `USING` et `WITH CHECK` : la ligne de départ est permise, la destination non.
select throws_ok($$
	update public.cards
	   set channel_id = (select id from public.channels where slug = 'maintenance'),
	       workflow_id = (select workflow_id from public.channels where slug = 'maintenance')
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'42501', null,
	'et il ne peut pas non plus DÉPLACER une card VERS `maintenance` : la règle appliquée à la '
	'ligne d''ARRIVÉE refuse, celle de la ligne de départ ayant accepté (§6.1)');

rollback to savepoint p_bizdev;

savepoint p_anon;
select pg_temp.anonyme();

select is(
	(select count(*)::int from public.cards), 0,
	'PREUVE N° 11 sur les cards : un appelant anonyme lit ZÉRO LIGNE, et ne reçoit aucune erreur');

rollback to savepoint p_anon;

-- =============================================================================================
-- 8. `app.can_read_card` — décision 110, dernier point d'INC-013
-- =============================================================================================
-- Éprouvée DIRECTEMENT : aucune politique ne l'appelle, et une preuve indirecte n'existerait pas.
-- Ces assertions CONVERTISSENT les `hasnt_function` de `0002` et `0011`, devenues rouges comme la
-- décision 51 l'attendait d'elles.

select has_function('app', 'can_read_card', array['uuid'],
	'`app.can_read_card(uuid)` est livrée — INC-013 s''éteint entièrement');
select function_returns('app', 'can_read_card', array['uuid'], 'boolean',
	'elle rend un BOOLÉEN, jamais NULL — `coalesce(…, false)`, décision 102');
select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'can_read_card'),
	true,
	'`SECURITY DEFINER` : elle lit `cards`, dont la politique l''appellerait sinon en boucle');
select ok(has_function_privilege('anon', 'app.can_read_card(uuid)', 'EXECUTE'),
	'`anon` peut l''exécuter : sinon le refus serait une erreur de privilège, pas zéro ligne');
select ok(not has_function_privilege('public', 'app.can_read_card(uuid)', 'EXECUTE'),
	'`PUBLIC` ne le peut pas : le droit est accordé nommément');

select is(
	app.can_read_card('00000000-0000-4000-8000-000000000000'),
	false,
	'un identifiant inconnu rend FALSE, non NULL : le contrat annonce `boolean` (décision 102)');

savepoint p_can_read;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	app.can_read_card('5eed0000-0000-4000-8000-0000000000c1'), false,
	'pour le `viewer`, une card de `grands-comptes` est illisible — la fonction dérive bien du '
	'channel, droits fins compris');
select is(
	app.can_read_card('5eed0000-0000-4000-8000-0000000000c4'), true,
	'et une card de `refonte` est lisible : la fonction n''est pas un refus systématique');

rollback to savepoint p_can_read;

-- =============================================================================================
-- 9. La garde d'archivage d'un nœud occupé — INC-031, décision 111
-- =============================================================================================
-- Les trois cas. Le troisième — un nœud dont les cards sont toutes archivées — est celui qui donne
-- son sens à la définition d'« active » du §5 : sans lui, un nœud deviendrait inarchivable dès
-- qu'une card y serait passée un jour.

select has_function('app', 'catalogue_refuser_archivage_noeud_occupe', array[]::text[],
	'la garde d''archivage existe : INC-031 attendait `cards` depuis `CRM-030`');

select throws_ok($$
	update public.workflow_nodes_catalog set archived_at = now() where key = 'prospection' $$,
	'42501', null,
	'archiver un nœud qu''une card ACTIVE occupe est refusé — `node_occupied`, rendu `403`');

select lives_ok($$
	update public.workflow_nodes_catalog set label = 'Prospection (renommée)'
	 where key = 'prospection' $$,
	'…mais un simple RENOMMAGE passe : la garde ne se déclenche qu''au passage de `archived_at` de '
	'NULL à une valeur — c''est le défaut qu''INC-031 redoutait');

-- `livre` ne porte que la card ARCHIVÉE du seed. Elle n'occupe rien.
select lives_ok($$
	update public.workflow_nodes_catalog set archived_at = now() where key = 'livre' $$,
	'archiver un nœud dont les seules cards sont ARCHIVÉES est accepté : « active » a une '
	'définition, et elle compte (§5)');

select lives_ok($$
	update public.workflow_nodes_catalog set archived_at = null where key = 'livre' $$,
	'et la réactivation ne réveille pas la garde : elle ne juge que l''archivage');

-- =============================================================================================
-- 10. Conformité du seed — docs/SPEC-cards.md §9
-- =============================================================================================

select is(
	(select count(*)::int from public.cards
	  where id::text like '5eed0000-0000-4000-8000-0000000000c%'),
	9,
	'le seed livre NEUF cards, identifiants stables — docs/SPEC-cards.md §9');

select is(
	(select count(*)::int from public.cards
	  where archived_at is not null and id::text like '5eed%'),
	1,
	'dont exactement UNE archivée : sans elle, l''archivage serait documenté sans être démontrable');

select is(
	(select count(*)::int from public.cards
	  where deleted_at is not null and id::text like '5eed%'),
	1,
	'et exactement UNE en corbeille : les deux suppressions douces sont DISTINCTES (§4)');

select is(
	(select count(*)::int from public.cards c
	  where c.owner_id is null and c.amount is null and c.id::text like '5eed%'),
	1,
	'une card SANS responsable et SANS montant : le caractère nullable des deux est démontré, non '
	'seulement écrit');

select isnt(
	(select count(distinct currency)::int from public.cards where id::text like '5eed%'),
	1,
	'au moins deux devises distinctes : sans quoi le défaut de colonne serait la seule valeur '
	'jamais observée');

select is(
	(select count(distinct email_local_part)::int from public.cards where id::text like '5eed%'),
	9,
	'les neuf adresses seedées sont distinctes');

select is(
	(select count(*)::int from public.cards where id::text like '5eed%'
	   and email_local_part !~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$'),
	0,
	'et toutes conformes à la forme du §3.2');

-- =============================================================================================
-- 11. Ce qui reste dû, figé par des assertions
-- =============================================================================================
-- Aucune de ces assertions n'est un constat résigné : chacune devient rouge le jour où l'unité qui
-- la porte livre son objet, et force la révision des preuves plutôt que leur silence (décision 51).

-- ASSERTION RETOURNÉE PAR `CRM-034` (décision 51). Elle disait « `move_card` reste due » ; l'unité
-- l'a livrée, et l'assertion a donc désigné son moment, exactement comme le mécanisme le prévoit.
-- Ses preuves propres sont dans `supabase/tests/0013_move_card.test.sql` ; ici, seule la PRÉSENCE
-- est constatée — c'est ce dont cette suite-ci a besoin pour que les assertions ci-dessous, qui
-- décrivent ce que la garde ferme, aient un objet.
select has_function('public', 'move_card', array['uuid', 'uuid', 'text'],
	'`move_card` est LIVRÉE par `CRM-034` (INC-043 était son blocage, et `CRM-040` l''a levé), et '
	'porte SIX vérifications sur six depuis `CRM-036`, qui a apporté `card_field_values` et '
	'refermé INC-047');

select hasnt_table('public', 'card_events',
	'`card_events` reste due par `CRM-044` : aucun trigger d''événement n''est écrit ici, il '
	'n''aurait pas de table où écrire');
select hasnt_table('public', 'card_comments',
	'`card_comments` reste due par `CRM-043`');
-- RÉVISÉE À `CRM-036`, NON RETIRÉE — mécanisme de la décision 51, neuvième occurrence. Elle
-- constatait une absence ; elle constate désormais la présence, et la conséquence qui comptait :
-- `app.can_read_card`, livrée sans usage par `CRM-040`, a enfin son premier appelant réel.
select has_table('public', 'card_field_values',
	'`card_field_values` est livrée par `CRM-036` : l''assertion d''absence posée ici a été '
	'RÉVISÉE, non retirée');

select is(
	(select count(*)::int from pg_policy p
	  where p.polrelid = 'public.card_field_values'::regclass
	    and pg_get_expr(p.polqual, p.polrelid) like '%can_read_card%'),
	1,
	'`app.can_read_card`, livrée SANS USAGE par `CRM-040` (décision 110), a son PREMIER appelant '
	'réel : la politique de lecture des valeurs de formulaire');

-- CRM-013 : la protection de colonne. Cette assertion CONSTATE le manque, elle ne le tolère pas.
savepoint p_crm013;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok($$
	update public.cards set email_local_part = 'c-abcdefgh'
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'CRM-013 NON LIVRÉE : `email_local_part` reste MODIFIABLE par qui écrit sur le channel. Le '
	'trigger GÉNÈRE, il ne protège pas (§3.4). Cette assertion doit devenir rouge à `CRM-013`');

-- ASSERTION RETOURNÉE PAR `CRM-034` (décision 51), et c'est la plus significative des trois : elle
-- constatait que `current_step_id` s'écrivait DIRECTEMENT, sans transition déclarée. `CRM-034` a
-- fermé ce chemin. Le `lives_ok` devient un `throws_ok`, et l'assertion est désormais PLUS FORTE —
-- elle ne constate plus un manque, elle oppose un refus.
select throws_ok($$
	update public.cards
	   set current_step_id = (select s.id from public.workflow_steps s
	                           join public.workflow_nodes_catalog n on n.id = s.node_id
	                          where s.workflow_id = public.cards.workflow_id and n.key = 'perdu')
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'42501', 'permission denied for table cards',
	'`CRM-034` EST LIVRÉE : `current_step_id` ne s''écrit PLUS directement. La garde n''est plus '
	'contournable, et `move_card` est le seul chemin. `CRM-013` reste due pour les AUTRES colonnes '
	'— INC-049, INC-050');

rollback to savepoint p_crm013;

-- §10, point ouvert n° 1 : l'absence de contrainte de signe est un CHOIX, figé plutôt que subi.
select lives_ok($$
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, amount)
	select workspace_id, channel_id, workflow_id, step_id, 'Montant négatif', -1200.00 from t_ctx $$,
	'`amount` accepte un NÉGATIF, et c''est délibéré : un avoir, une remise ou une perte constatée '
	'peuvent s''exprimer ainsi. Refuser serait une décision de produit que personne n''a prise '
	'(§10, point ouvert n° 1)');

-- INC-046, seconde conséquence : le seed ne peut pas poser de card dans `prospection`.
select is(
	(select count(*)::int from public.cards c
	   join public.channels ch on ch.id = c.channel_id
	  where ch.slug = 'prospection' and c.id::text like '5eed%'),
	0,
	'INC-046 : AUCUNE card seedée dans `prospection`. MESURÉ — une seule y suffit à faire échouer '
	'le seed en section 4, `23503`. Le motif est écrit en docs/SPEC-cards.md §9.1, pas masqué');

select * from finish();
rollback;

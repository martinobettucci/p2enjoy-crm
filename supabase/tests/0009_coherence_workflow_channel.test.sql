-- @verifies CRM-033 (docs/BACKLOG.md) — cohérence workflow ↔ channel, et la dette NOT NULL d'INC-029
-- @verifies docs/SPEC-workflow-engine.md §4.12.1 (les quatre portes), §4.12.2 (la règle),
--           §4.12.3 (trigger sur channels), §4.12.4 (trigger sur workflows), §4.12.5 (NOT NULL),
--           §4.12.8 (preuves attendues)
-- @verifies docs/SPEC-channels.md §2.5 (l'écart d'INC-029, soldé), §8 (seed)
-- @verifies docs/SCHEMA.md §2 (channels.workflow_id non nulle et référencée)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-029 (soldée), INC-040 (les deux portes oubliées)
--
-- Suite pgTAP de l'unité `CRM-033`. Elle prouve six choses :
--
--   1. les **deux** triggers existent, sur les bonnes tables et les bonnes colonnes — le second
--      n'était demandé par aucune Definition of Done, et c'est la mesure qui l'a imposé (INC-040) ;
--   2. les **trois cas** de la Definition of Done : workflow `global` accepté, workflow `track` du
--      **même** track accepté, workflow `track` **étranger** refusé ;
--   3. le **déplacement d'un channel** est refusé lorsqu'il emporte le channel hors du track de son
--      workflow, et accepté lorsque le workflow est global ;
--   4. les **portes 3 et 4**, que nul trigger sur `channels` ne pouvait voir : déplacer un workflow
--      `track` occupé, et faire basculer un workflow `global` occupé vers `track` ;
--   5. ce que la règle **n'interdit pas**, et qui doit rester permis : un workflow `track` **libre**
--      change de track, et une écriture qui ne change rien passe ;
--   6. la contrainte `NOT NULL`, et le **silence** du trigger lorsque la clé étrangère parle mieux
--      que lui.
--
-- Exécution : `npm run test:sql`, `scripts/verify-coherence-workflow.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0009_coherence_workflow_channel.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Comme les suites précédentes, aucun
-- bloc n'emploie `rollback to savepoint` : une assertion prise dans un savepoint annulé est
-- **numérotée mais non comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

-- =============================================================================================
-- 1. Les deux triggers, et les deux fonctions qui les portent
-- =============================================================================================

select has_function('app', 'channels_verifier_workflow', array[]::text[],
	'la fonction `app.channels_verifier_workflow` existe');
select has_function('app', 'workflows_verifier_portee_occupee', array[]::text[],
	'la fonction `app.workflows_verifier_portee_occupee` existe — celle qu''aucune Definition of '
	'Done ne demandait, et que la mesure a imposée (INC-040)');

-- `search_path` vidé sur les deux : une fonction dont le chemin de recherche est mutable est une
-- surface d'attaque, `SECURITY INVOKER` ou non.
select ok(
	(select coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'channels_verifier_workflow'),
	'`app.channels_verifier_workflow` a son `search_path` vidé');
select ok(
	(select coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'workflows_verifier_portee_occupee'),
	'`app.workflows_verifier_portee_occupee` a son `search_path` vidé');

-- `SECURITY INVOKER` sur les deux : elles ne lisent que des tables sur lesquelles l'appelant a déjà
-- été autorisé — ou non — par les politiques de `CRM-021` et de `CRM-031`. Les droits du
-- propriétaire seraient un privilège gratuit.
select ok(
	(select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'channels_verifier_workflow'),
	'`app.channels_verifier_workflow` est `SECURITY INVOKER` : aucun privilège gratuit');
select ok(
	(select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'workflows_verifier_portee_occupee'),
	'`app.workflows_verifier_portee_occupee` est `SECURITY INVOKER`');

select has_trigger('public', 'channels', 'channels_verifier_workflow',
	'le trigger `channels_verifier_workflow` est posé sur `public.channels`');
select has_trigger('public', 'workflows', 'workflows_verifier_portee_occupee',
	'le trigger `workflows_verifier_portee_occupee` est posé sur `public.workflows`');

-- LES COLONNES SURVEILLÉES, et non seulement l'existence du trigger. `track_id` doit y figurer :
-- déplacer un channel ne touche pas `workflow_id`, et un trigger qui ne se réveille que pour elle
-- laisserait passer la porte n° 2 (docs/SPEC-workflow-engine.md §4.12.3).
select is(
	(select string_agg(a.attname, ',' order by a.attname)
	   from pg_trigger t
	   join unnest(t.tgattr) col(attnum) on true
	   join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
	  where t.tgrelid = 'public.channels'::regclass
	    and t.tgname = 'channels_verifier_workflow'),
	'track_id,workflow_id,workspace_id',
	'le trigger de `channels` surveille `workflow_id`, `track_id` **et** `workspace_id` : sans '
	'`track_id`, un déplacement de channel passerait sans être vu');

select is(
	(select string_agg(a.attname, ',' order by a.attname)
	   from pg_trigger t
	   join unnest(t.tgattr) col(attnum) on true
	   join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
	  where t.tgrelid = 'public.workflows'::regclass
	    and t.tgname = 'workflows_verifier_portee_occupee'),
	'scope,track_id',
	'le trigger de `workflows` surveille `scope` et `track_id` : seule la portée peut casser un '
	'rattachement');

-- =============================================================================================
-- 2. INC-029 soldée
-- =============================================================================================
-- L'assertion jumelle de `supabase/tests/0005_channels.test.sql` et celle de `0007` ont été
-- révisées dans le même changement : elles constataient la colonne **nullable** et annonçaient
-- qu'elles deviendraient rouges ce jour-là. Elles le sont devenues.

select col_not_null('public', 'channels', 'workflow_id',
	'INC-029 SOLDÉE : `channels.workflow_id` est **obligatoire**, comme docs/SCHEMA.md §2 l''exige '
	'depuis l''origine');

-- Aucun défaut de colonne n'adoucit la contrainte : rattacher automatiquement le channel neuf au
-- workflow par défaut serait commode et faux, un workspace pouvant n'avoir aucun défaut
-- (docs/JOURNAL.md, décision 91).
select col_hasnt_default('public', 'channels', 'workflow_id',
	'et **aucun défaut de colonne** ne l''adoucit : une omission du client reste une omission, elle '
	'ne devient pas un choix qu''il n''a pas fait');

-- =============================================================================================
-- 3. Fixtures : deux workspaces, trois tracks, trois workflows
-- =============================================================================================

insert into public.workspaces (id, name, slug) values
	('c0330000-0000-4000-8000-000000000001', 'Atelier CO A', 'atelier-co-a'),
	('c0330000-0000-4000-8000-000000000002', 'Atelier CO B', 'atelier-co-b');

insert into public.tracks (id, workspace_id, name, slug, position) values
	('c0330000-0000-4000-8000-0000000000a1', 'c0330000-0000-4000-8000-000000000001',
	 'Track A1', 'track-a1', 1),
	('c0330000-0000-4000-8000-0000000000a2', 'c0330000-0000-4000-8000-000000000001',
	 'Track A2', 'track-a2', 2),
	('c0330000-0000-4000-8000-0000000000b1', 'c0330000-0000-4000-8000-000000000002',
	 'Track B1', 'track-b1', 1);

insert into public.workflows (id, workspace_id, name, scope, track_id) values
	-- global du workspace A
	('c0330000-0000-4000-8000-0000000000f0', 'c0330000-0000-4000-8000-000000000001',
	 'Global A', 'global', null),
	-- `track` rattaché à A1
	('c0330000-0000-4000-8000-0000000000f1', 'c0330000-0000-4000-8000-000000000001',
	 'Track A1', 'track', 'c0330000-0000-4000-8000-0000000000a1'),
	-- `track` rattaché à A2, et qui restera **libre** : la règle ne protège pas les workflows sans
	-- channel, et il faut un sujet pour le prouver
	('c0330000-0000-4000-8000-0000000000f2', 'c0330000-0000-4000-8000-000000000001',
	 'Track A2 libre', 'track', 'c0330000-0000-4000-8000-0000000000a2');

-- =============================================================================================
-- 4. Les trois cas de la Definition of Done
-- =============================================================================================

select lives_ok(
	$$insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position)
	  values ('c0330000-0000-4000-8000-0000000000c1', 'c0330000-0000-4000-8000-000000000001',
	          'c0330000-0000-4000-8000-0000000000a1', 'c0330000-0000-4000-8000-0000000000f0',
	          'Global sur A1', 'global-a1', 1)$$,
	'CAS 1 — un workflow **global** est accepté sur un channel de n''importe quel track de son '
	'workspace');

select lives_ok(
	$$insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position)
	  values ('c0330000-0000-4000-8000-0000000000c2', 'c0330000-0000-4000-8000-000000000001',
	          'c0330000-0000-4000-8000-0000000000a1', 'c0330000-0000-4000-8000-0000000000f1',
	          'Track sur son track', 'track-son-track', 2)$$,
	'CAS 2 — un workflow `track` est accepté sur un channel de **son** track');

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('c0330000-0000-4000-8000-000000000001', 'c0330000-0000-4000-8000-0000000000a2',
	          'c0330000-0000-4000-8000-0000000000f1', 'Track étranger', 'track-etranger', 3)$$,
	'23514', 'workflow_hors_track',
	'CAS 3 — un workflow `track` est **refusé** sur un channel d''un autre track, en `23514` : une '
	'violation de contrainte, et le message le dit');

-- Le même refus à la **mise à jour**, et pas seulement à l'insertion : sans quoi il suffirait de
-- créer une ligne cohérente puis de la corrompre.
select throws_ok(
	$$update public.channels set workflow_id = 'c0330000-0000-4000-8000-0000000000f2'
	   where id = 'c0330000-0000-4000-8000-0000000000c1'$$,
	'23514', 'workflow_hors_track',
	'et la mise à jour est refusée de la même façon : le trigger ne protège pas seulement la '
	'création');

-- =============================================================================================
-- 5. Le déplacement d'un channel — la porte n° 2
-- =============================================================================================
-- Elle ne touche pas `workflow_id`. C'est elle qui impose que `track_id` figure parmi les colonnes
-- surveillées, et l'assertion de la section 1 le fige.

select throws_ok(
	$$update public.channels set track_id = 'c0330000-0000-4000-8000-0000000000a2'
	   where id = 'c0330000-0000-4000-8000-0000000000c2'$$,
	'23514', 'workflow_hors_track',
	'PORTE 2 — déplacer vers un autre track un channel qui suit un workflow `track` est refusé, '
	'bien que l''écriture ne mentionne pas `workflow_id`');

select lives_ok(
	$$update public.channels set track_id = 'c0330000-0000-4000-8000-0000000000a2'
	   where id = 'c0330000-0000-4000-8000-0000000000c1'$$,
	'mais le même déplacement est **accepté** lorsque le workflow est global : un workflow global '
	'suit son channel partout dans son workspace');

-- Remis à sa place, pour que la suite raisonne sur l'état déclaré et non sur un reste de preuve.
update public.channels set track_id = 'c0330000-0000-4000-8000-0000000000a1'
 where id = 'c0330000-0000-4000-8000-0000000000c1';

-- =============================================================================================
-- 6. Les portes 3 et 4 — celles qu'aucun trigger sur `channels` ne pouvait voir
-- =============================================================================================
-- INC-040. Les deux passent par `workflows`, et les deux étaient acceptées avant cette unité.

select throws_ok(
	$$update public.workflows set track_id = 'c0330000-0000-4000-8000-0000000000a2'
	   where id = 'c0330000-0000-4000-8000-0000000000f1'$$,
	'23514', 'workflow_portee_occupee',
	'PORTE 3 — déplacer un workflow `track` **occupé** vers un autre track est refusé : le '
	'rattachement de son channel deviendrait faux sans qu''aucune écriture ne touche `channels`');

select throws_ok(
	$$update public.workflows
	     set scope = 'track', track_id = 'c0330000-0000-4000-8000-0000000000a2'
	   where id = 'c0330000-0000-4000-8000-0000000000f0'$$,
	'23514', 'workflow_portee_occupee',
	'PORTE 4 — faire basculer de `global` à `track` un workflow **occupé** est refusé. C''est la '
	'plus dommageable : elle invaliderait d''un seul `UPDATE` tous les channels qui le suivent');

-- La bascule vers le track où **tous** ses channels se trouvent doit en revanche passer : la règle
-- refuse ce qui casse un rattachement, pas la portée `track` en elle-même.
select lives_ok(
	$$update public.workflows
	     set scope = 'track', track_id = 'c0330000-0000-4000-8000-0000000000a1'
	   where id = 'c0330000-0000-4000-8000-0000000000f0'$$,
	'mais la bascule vers le track où se trouvent **tous** ses channels est acceptée : la règle '
	'refuse ce qui casse un rattachement, pas la portée `track`');

update public.workflows set scope = 'global', track_id = null
 where id = 'c0330000-0000-4000-8000-0000000000f0';

-- =============================================================================================
-- 7. Ce que la règle n'interdit pas, et qui doit le rester
-- =============================================================================================

select lives_ok(
	$$update public.workflows set track_id = 'c0330000-0000-4000-8000-0000000000a1'
	   where id = 'c0330000-0000-4000-8000-0000000000f2'$$,
	'un workflow `track` **libre** change de track : la règle protège des rattachements, pas des '
	'workflows');

-- Une écriture qui réaffecte les mêmes valeurs passe : la condition porte sur l'état **résultant**,
-- non sur le fait qu'une colonne a été mentionnée.
select lives_ok(
	$$update public.workflows set scope = scope, track_id = track_id
	   where id = 'c0330000-0000-4000-8000-0000000000f1'$$,
	'une écriture qui ne change **rien** passe, bien qu''elle mentionne les deux colonnes '
	'surveillées et que le workflow soit occupé');

-- Un `UPDATE` qui ne touche ni `scope` ni `track_id` ne réveille pas le trigger du tout.
select lives_ok(
	$$update public.workflows set name = 'Track A1 renommé'
	   where id = 'c0330000-0000-4000-8000-0000000000f1'$$,
	'renommer un workflow occupé de portée `track` passe : le trigger ne surveille que la portée');

-- =============================================================================================
-- 8. Le silence du trigger, et la contrainte NOT NULL
-- =============================================================================================

-- MESURÉ, et c'est un choix d'écriture : lorsque le workflow désigné n'existe pas dans le workspace
-- du channel, c'est la **clé étrangère composite** qui refuse, en `23503`, et non le trigger. Une
-- clé étrangère est vérifiée après les triggers `BEFORE` ; le trigger voit une ligne dont il ne peut
-- rien dire d'utile et rend la main plutôt que d'inventer un refus moins précis (décision 90).
select throws_ok(
	$$update public.channels set workflow_id = 'c0330000-0000-4000-8000-00000000dead'
	   where id = 'c0330000-0000-4000-8000-0000000000c1'$$,
	'23503', null,
	'un workflow **introuvable** est refusé par la clé étrangère composite en `23503`, non par le '
	'trigger : celui-ci se tait là où la base parle mieux que lui');

-- Le workflow d'un **autre** workspace tombe sous la même clé, et non sous le trigger : le §4.12.2
-- ne redit pas ce que la clé garantit déjà.
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('c0330000-0000-4000-8000-000000000002', 'c0330000-0000-4000-8000-0000000000b1',
	          'c0330000-0000-4000-8000-0000000000f0', 'Voisin', 'voisin', 1)$$,
	'23503', null,
	'un workflow d''un **autre workspace** est refusé par la même clé composite : le trigger ne '
	'redit pas ce que la base garantit déjà');

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, name, slug, position)
	  values ('c0330000-0000-4000-8000-000000000001', 'c0330000-0000-4000-8000-0000000000a1',
	          'Sans workflow', 'sans-workflow', 9)$$,
	'23502', null,
	'créer un channel **sans workflow** est refusé : c''est le contrat de création que `CRM-033` '
	'change, et INC-029 qu''il solde');

-- =============================================================================================
-- 9. Le seed est conforme à ce que le §4.12.7 déclare
-- =============================================================================================
-- Les six channels du seed sont rattachés, et **un seul** suit la copie de portée `track` — sans
-- quoi le cas accepté le plus intéressant de la règle serait documenté sans être démontrable.

select is(
	(select count(*)::int from public.channels
	  where workspace_id = '5eed0000-0000-4000-8000-000000000001' and workflow_id is null),
	0,
	'aucun channel du seed n''est sans workflow');

select is(
	(select w.scope from public.channels c join public.workflows w on w.id = c.workflow_id
	  where c.id = '5eed0000-0000-4000-8000-000000000031'),
	'track',
	'`prospection` suit un workflow de portée `track` — le cas accepté le plus intéressant de la '
	'règle, rendu démontrable par le seed');

select is(
	(select count(*)::int from public.channels c join public.workflows w on w.id = c.workflow_id
	  where c.workspace_id = '5eed0000-0000-4000-8000-000000000001' and w.scope = 'track'),
	1,
	'et lui seul : les cinq autres channels suivent le workflow global');

-- Le rattachement du seed est **cohérent** au sens de la règle : si le seed produisait un état que
-- le trigger refuserait, le trigger serait contourné par le chemin même qui peuple la base.
select is(
	(select count(*)::int from public.channels c join public.workflows w on w.id = c.workflow_id
	  where c.workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and not (w.scope = 'global' or (w.scope = 'track' and w.track_id = c.track_id))),
	0,
	'et tous les rattachements du seed satisfont la règle : le seed traverse la garde, il ne la '
	'contourne pas');

-- =============================================================================================
-- 10. Ménage explicite
-- =============================================================================================
-- Les workspaces de fixture sont supprimés **après** leurs channels et leurs workflows : INC-039 a
-- établi qu'une suppression de workspace échoue dès qu'un workflow instancie ses nœuds, et l'ordre
-- correct est une contrainte d'exploitation nommée plutôt qu'un accident.

delete from public.channels  where workspace_id::text like 'c0330000%';
delete from public.workflows where workspace_id::text like 'c0330000%';
delete from public.tracks    where workspace_id::text like 'c0330000%';
delete from public.workspaces where id::text like 'c0330000%';

select * from finish();
rollback;

-- @verifies INC-268 (docs/INCONSISTENCY_REPORT.md, décision 619) — un espace de travail se supprime entier, et chaque
--           protection d'une suppression directe tient
-- @verifies docs/SCHEMA.md §1 (cloisonnement par espace : tout cascade depuis `workspaces`) ; docs/SPEC-costs.md §3.2 ;
--           docs/SPEC-workflow-engine.md §2.6 ; docs/SPEC-modeles-emails.md §11 ; migration `0085`
--
-- LE DÉFAUT, MESURÉ LE 2026-10-02 : `delete from workspaces` sur l'espace du seed échouait en 23503 — la cascade
-- atteignait le catalogue de nœuds alors que les étapes qui le visent, protégées par `ON DELETE RESTRICT`, n'étaient
-- pas encore retirées. `RESTRICT` est vérifié IMMÉDIATEMENT, au fil de la cascade ; `NO ACTION` l'est à la FIN de
-- l'ordre, quand la cascade a tout emporté. Pour une suppression DIRECTE, les deux refusent pareil (23503) : les
-- assertions 2 à 7 le prouvent, AVANT la suppression de l'espace.
--
-- Tout se joue dans une transaction annulée, sur l'espace du SEED : c'est le seul qui porte réellement toutes les
-- sortes d'objets — workflows, catalogue, channels, affaires, coûts sur budget et sur occurrence, séquences et
-- modèles. Une inscription de séquence, que le seed n'arme jamais (docs/SPEC-modeles-emails.md §12.12), est posée ici.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create temporary table ids (nom text primary key, valeur uuid) on commit drop;
insert into ids values ('W', '5eed0000-0000-4000-8000-000000000001');
create or replace function pg_temp.id(nom text) returns uuid language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

-- Une inscription de séquence, pour que les deux clés de `card_sequence_enrollments` soient exercées.
insert into public.card_sequence_enrollments (workspace_id, card_id, sequence_id, identity_id, status, closed_reason, closed_at)
select pg_temp.id('W'),
       (select c.id from public.cards c where c.workspace_id = pg_temp.id('W') order by c.id limit 1),
       (select s.id from public.mail_sequences s where s.workspace_id = pg_temp.id('W') order by s.id limit 1),
       (select i.id from public.mail_outbound_identities i where i.workspace_id = pg_temp.id('W') order by i.id limit 1),
       'closed', 'manual', now();

select is(
	(select count(*)::int from pg_constraint
	  where contype = 'f' and connamespace = 'public'::regnamespace and confdeltype = 'r'),
	0, '1 — aucune clé étrangère de `public` n''est plus en RESTRICT');
select is(
	(select string_agg(conname || ':' || confdeltype::text || ':' || condeferrable::text || ':' || condeferred::text, ',' order by conname)
	   from pg_constraint
	  where conname in ('workflow_steps_node_id_workspace_id_fkey', 'channels_workflow_id_workspace_id_fkey',
	                    'card_costs_budget_id_fkey', 'card_costs_occurrence_id_fkey',
	                    'mail_sequence_steps_template_id_fkey', 'mail_sequence_steps_template_workspace_fkey',
	                    'card_sequence_enrollments_identity_fk', 'card_sequence_enrollments_sequence_fk')),
	'card_costs_budget_id_fkey:a:true:false,card_costs_occurrence_id_fkey:a:true:false,'
	|| 'card_sequence_enrollments_identity_fk:a:true:false,card_sequence_enrollments_sequence_fk:a:true:false,'
	|| 'channels_workflow_id_workspace_id_fkey:a:true:false,mail_sequence_steps_template_id_fkey:a:true:false,'
	|| 'mail_sequence_steps_template_workspace_fkey:a:true:false,workflow_steps_node_id_workspace_id_fkey:a:true:false',
	'1 bis — les huit clés : NO ACTION, ajournables, mais contrôlées IMMÉDIATEMENT par défaut');

-- =============================================================================================
-- 2 à 7. Les protections d'une suppression DIRECTE tiennent, en NO ACTION comme en RESTRICT
-- =============================================================================================

select throws_ok(
	$$delete from public.workflow_nodes_catalog n
	   where n.workspace_id = pg_temp.id('W') and exists (select 1 from public.workflow_steps s where s.node_id = n.id)$$,
	'23503', null, '2 — un nœud du catalogue qu''une étape vise ne se supprime pas');
select throws_ok(
	$$delete from public.workflows w
	   where w.workspace_id = pg_temp.id('W') and exists (select 1 from public.channels c where c.workflow_id = w.id)$$,
	'23503', null, '3 — un workflow que suit un channel ne se supprime pas');
select throws_ok(
	$$delete from public.budgets b where exists (select 1 from public.card_costs c where c.budget_id = b.id)$$,
	'23503', null, '4 — un budget qui porte des dépenses ne se supprime pas (docs/SPEC-costs.md §3.2)');
select throws_ok(
	$$delete from public.budget_occurrences o where exists (select 1 from public.card_costs c where c.occurrence_id = o.id)$$,
	'23503', null, '5 — une occurrence qui porte des dépenses ne se supprime pas');
select throws_ok(
	$$delete from public.mail_templates t where exists (select 1 from public.mail_sequence_steps s where s.template_id = t.id)$$,
	'23503', null, '6 — un modèle qu''un palier de séquence emploie ne se supprime pas');
select throws_ok(
	$$delete from public.mail_sequences s where exists (select 1 from public.card_sequence_enrollments e where e.sequence_id = s.id)$$,
	'23503', null, '7 — une séquence qui porte une inscription ne se supprime pas');

-- =============================================================================================
-- 8 à 10. L'espace entier, lui, se supprime — et rien n'en reste
-- =============================================================================================

select lives_ok(
	$$delete from public.workspaces where id = pg_temp.id('W')$$,
	'8 — l''espace du seed se supprime en entier : la cascade va à son terme');
-- La transaction est annulée : le contrôle ajourné à la validation ne tomberait JAMAIS sans ceci. `SET CONSTRAINTS ALL
-- IMMEDIATE` le déclenche maintenant, exactement comme le ferait la validation.
select lives_ok($$set constraints all immediate$$,
	'8 bis — à la validation, les huit clés ajournées ne trouvent aucun orphelin');
select is(
	(select count(*)::int from public.workflows where workspace_id = pg_temp.id('W'))
	+ (select count(*)::int from public.workflow_nodes_catalog where workspace_id = pg_temp.id('W'))
	+ (select count(*)::int from public.channels where workspace_id = pg_temp.id('W'))
	+ (select count(*)::int from public.cards where workspace_id = pg_temp.id('W')),
	0, '9 — ni workflow, ni nœud, ni channel, ni affaire ne survit à son espace');
select is(
	(select count(*)::int from public.card_costs)
	+ (select count(*)::int from public.mail_sequence_steps)
	+ (select count(*)::int from public.card_sequence_enrollments),
	0, '10 — ni dépense, ni palier, ni inscription ne survit à son espace');

select * from finish();
rollback;

-- @verifies CRM-141 (docs/BACKLOG.md) — tranche T1 : les pastilles d'un mail — les défauts, l'unicité, la RLS des trois
--           tables, les gestes d'une personne et leurs refus sous les trois profils du seed, la main qui prime à la
--           clôture d'une évaluation, la prise sans doublon, l'espacement des échecs et l'état `failed`
-- @verifies docs/SPEC-mail-subsystem.md §31.2 à §31.6 ; docs/SCHEMA.md « Migration — les pastilles d'un mail » ;
--           docs/JOURNAL.md décisions 883, 923, 924 et 926 ; CLAUDE.md §10 (la règle prouvée par la base, sous les
--           vrais rôles)
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final : M1, un mail reçu classé dans
-- « Cadrage data — Groupe Vallier » (`…00ca`), que les trois profils lisent ; M2, un mail envoyé dans la même affaire ;
-- M3, un mail reçu dans « Refonte du site vitrine » (`…00c1`), que la lectrice ne lit pas ; un second espace.

begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

\set espace '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set driss '5eed0000-0000-4000-8000-000000000012'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set m1 '01720000-0000-4000-8000-000000000001'
\set m2 '01720000-0000-4000-8000-000000000002'
\set m3 '01720000-0000-4000-8000-000000000003'
\set autre '01720000-0000-4000-8000-0000000000e1'

insert into public.mail_messages (id, workspace_id, rfc822_message_id, card_id, classification, from_address, subject,
                                  body_text, direction)
values
	(:'m1', :'espace', '<t0172-1@sonde.test>', '5eed0000-0000-4000-8000-0000000000ca', 'manual', 'client@sonde.test',
	 'Demande de devis', 'Bonjour, pouvez-vous nous faire un devis ?', 'inbound'),
	(:'m2', :'espace', '<t0172-2@sonde.test>', '5eed0000-0000-4000-8000-0000000000ca', 'outbound', 'nous@sonde.test',
	 'Notre réponse', 'Voici.', 'outbound'),
	(:'m3', :'espace', '<t0172-3@sonde.test>', '5eed0000-0000-4000-8000-0000000000c1', 'manual', 'autre@sonde.test',
	 'Ailleurs', 'Texte.', 'inbound');

insert into public.workspaces (id, name, slug) values (:'autre', 'Sonde 0172', 'sonde-0172');
-- Résolue sous la clé de propriétaire : sous le jeton d'un membre, la RLS cache la pastille d'un autre espace.
select id as autre_lead from public.mail_labels where workspace_id = :'autre' and name = 'Lead' \gset

create or replace function pg_temp.pastille(p_nom text, p_espace uuid default '5eed0000-0000-4000-8000-000000000001')
returns uuid language sql as $$ select id from public.mail_labels where workspace_id = p_espace and name = p_nom $$;

-- 1–5. Les défauts, la file, l'unicité.
select results_eq(
	$$select name from public.mail_labels where workspace_id = '5eed0000-0000-4000-8000-000000000001' and archived_at is null
	   order by name$$,
	$$values ('Administratif'), ('Devis / commande'), ('Facture / paiement'), ('Lead'), ('Newsletter'), ('Partenariat'),
	         ('Recrutement'), ('Spam'), ('Support client')$$,
	'1 — les neuf pastilles par défaut de l''espace du seed');
select is((select count(*)::int from public.mail_labels where workspace_id = :'autre'), 9,
	'2 — un espace créé reçoit ses neuf défauts');
select results_eq(
	format($$select state, priority, attempts from public.mail_label_evaluations where message_id = %L$$, :'m1'),
	$$values ('pending'::text, 0::smallint, 0::smallint)$$,
	'3 — un mail reçu entre dans la file, en tête');
select is((select count(*)::int from public.mail_label_evaluations where message_id = :'m2'), 0,
	'4 — un mail envoyé n''est pas évalué');
select throws_ok(format($$insert into public.mail_labels (workspace_id, name, description) values (%L, 'SPAM', 'x')$$, :'espace'),
	'23505', null, '5 — le nom est unique dans l''espace, casse ignorée');

-- 6–11. La lectrice : elle lit, elle n'écrit rien.
select pg_temp.endosser(:'lectrice');
select is((select count(*)::int from public.mail_labels where workspace_id = :'espace'), 9,
	'6 — la lectrice lit les pastilles de son espace');
select is((select count(*)::int from public.mail_labels where workspace_id = :'autre'), 0,
	'7 — et rien d''un espace dont elle n''est pas membre');
select is((select count(*)::int from public.mail_label_evaluations where message_id = :'m1'), 1,
	'8 — elle lit l''état d''évaluation d''un mail qu''elle voit');
select throws_ok(format($$select public.set_message_label(%L, %L, true)$$, :'m1', pg_temp.pastille('Lead')),
	'42501', 'forbidden', '9 — elle ne pose pas de pastille : elle n''édite pas l''espace');
select throws_ok(format($$select public.request_label_evaluation(%L)$$, :'m1'),
	'42501', 'forbidden', '10 — elle ne demande pas de réévaluation');
select throws_ok(format($$insert into public.mail_labels (workspace_id, name, description) values (%L, 'Lectrice', 'x')$$, :'espace'),
	'42501', null, '11 — elle ne crée pas de pastille');
reset role;

-- 12–19. Le business developer : il pose et retire, il n'administre pas la liste.
select pg_temp.endosser(:'driss');
select lives_ok(format($$select public.set_message_label(%L, %L, true)$$, :'m1', pg_temp.pastille('Lead')),
	'12 — le business developer pose une pastille');
select results_eq(
	format($$select source, applied, set_by from public.mail_message_labels where message_id = %L$$, :'m1'),
	format($$values ('manual'::text, true, %L::uuid)$$, :'driss'),
	'13 — sa pose est un choix manuel, à son nom');
select throws_ok($$insert into public.mail_message_labels (message_id, label_id, workspace_id, source)
                   values ('01720000-0000-4000-8000-000000000001', gen_random_uuid(), '5eed0000-0000-4000-8000-000000000001', 'llm')$$,
	'42501', null, '14 — aucune écriture directe d''une pastille de message');
select throws_ok(format($$insert into public.mail_labels (workspace_id, name, description) values (%L, 'Bizdev', 'x')$$, :'espace'),
	'42501', null, '15 — il ne crée pas de pastille : la liste est aux administrateurs');
update public.mail_labels set name = 'Renommée' where name = 'Lead';
select is((select count(*)::int from public.mail_labels where name = 'Renommée'), 0,
	'16 — sa modification d''une pastille ne touche aucune ligne (la politique l''écarte, sans erreur)');
select throws_ok(format($$select public.request_label_evaluation(%L)$$, :'m2'),
	'22023', 'outbound_message', '17 — un mail envoyé ne se réévalue pas');
select throws_ok(format($$select public.set_message_label(%L, %L, true)$$, :'m1', :'autre_lead'),
	'PGRST', null, '18 — une pastille d''un autre espace est introuvable');
select throws_ok(format($$select public.set_message_label(gen_random_uuid(), %L, true)$$, pg_temp.pastille('Lead')),
	'PGRST', null, '19 — un message inconnu est introuvable');
reset role;

-- 20–24. L'administratrice : la liste, l'archivage, le retrait permis d'une archivée.
select pg_temp.endosser(:'admin');
select lives_ok(format($$insert into public.mail_labels (workspace_id, name, color, description)
                         values (%L, 'Youtube', 'danger', 'Toute demande pour la chaîne youtube.')$$, :'espace'),
	'20 — l''administratrice crée une pastille');
select is((select created_by from public.mail_labels where id = pg_temp.pastille('Youtube')), :'admin'::uuid,
	'21 — son auteur est posé par le serveur');
select lives_ok($$update public.mail_labels set archived_at = now() where name = 'Youtube'$$,
	'22 — elle l''archive');
select throws_ok(format($$select public.set_message_label(%L, %L, true)$$, :'m1', pg_temp.pastille('Youtube')),
	'22023', 'label_archived', '23 — une pastille archivée ne se pose plus');
select lives_ok(format($$select public.set_message_label(%L, %L, false)$$, :'m1', pg_temp.pastille('Youtube')),
	'24 — mais elle se retire encore');
select public.set_message_label(:'m1', pg_temp.pastille('Spam'), false);
reset role;

-- 25–30. La passe : la prise sans doublon, et la main qui prime à la clôture.
-- La pile de développement est vivante : un mail reçu pendant la preuve entre dans la file en tête. Les autres évaluations
-- sont repoussées DANS CETTE TRANSACTION, pour que la passe ne voie que la sonde.
update public.mail_label_evaluations set next_attempt_at = now() + interval '1 day' where message_id <> :'m1';
select is((select message_id from public.claim_label_evaluations(1)), :'m1'::uuid,
	'25 — la passe prend d''abord le mail neuf');
select ok(not exists (select 1 from public.claim_label_evaluations(20) where message_id = :'m1'),
	'26 — une seconde passe ne reprend pas le message réservé');
select lives_ok(format($$select public.record_label_evaluation(%L, array[%L, %L, %L, %L, %L]::uuid[], null)$$, :'m1',
	pg_temp.pastille('Lead'), pg_temp.pastille('Spam'), pg_temp.pastille('Facture / paiement'),
	pg_temp.pastille('Youtube'), pg_temp.pastille('Recrutement', :'autre')),
	'27 — la clôture d''une évaluation réussie');
select set_eq(
	format($$select l.name, x.source, x.applied from public.mail_message_labels x join public.mail_labels l on l.id = x.label_id
	          where x.message_id = %L$$, :'m1'),
	$$values ('Lead'::text, 'manual'::text, true), ('Spam', 'manual', false), ('Youtube', 'manual', false),
	         ('Facture / paiement', 'llm', true)$$,
	'28 — la main prime : ni la pose ni les retraits manuels ne bougent ; ni archivée ni autre espace ne s''ajoutent');
select results_eq(
	format($$select state, attempts, evaluated_at is not null from public.mail_label_evaluations where message_id = %L$$, :'m1'),
	$$values ('done'::text, 0::smallint, true)$$,
	'29 — l''évaluation est faite');
select pg_temp.endosser(:'admin');
select public.request_label_evaluation(:'m1');
reset role;
select count(*) from public.claim_label_evaluations(1);
-- Une demande arrivée PENDANT la passe : dans une transaction, `now()` est constant ; la demande est donc datée après la
-- prise à la main, ce que la course réelle produit.
update public.mail_label_evaluations set requested_at = claimed_at + interval '1 second' where message_id = :'m1';
select public.record_label_evaluation(:'m1', '{}', null);
select is((select state from public.mail_label_evaluations where message_id = :'m1'), 'pending',
	'30 — une demande reçue pendant la passe n''est pas perdue à la clôture');

-- 31–34. Les échecs : l'espacement, puis `failed` au cinquième.
update public.mail_label_evaluations set leased_until = null, next_attempt_at = now() - interval '1 second',
	attempts = 0 where message_id = :'m1';
select count(*) from public.claim_label_evaluations(1);
select public.record_label_evaluation(:'m1', null, 'serveur_injoignable');
select results_eq(
	format($$select state, last_error, next_attempt_at - now() from public.mail_label_evaluations where message_id = %L$$, :'m1'),
	$$values ('pending'::text, 'serveur_injoignable'::text, interval '1 minute')$$,
	'31 — un premier échec espace le suivant d''une minute');
update public.mail_label_evaluations set attempts = 5 where message_id = :'m1';
select public.record_label_evaluation(:'m1', null, 'delai_depasse');
select is((select state from public.mail_label_evaluations where message_id = :'m1'), 'failed',
	'32 — au cinquième échec, le message attend le bouton');
select throws_ok(format($$select public.record_label_evaluation(%L, null, 'inventee')$$, :'m1'),
	'22023', 'invalid_error', '33 — un motif d''échec hors liste est refusé');
select ok(exists (select 1 from public.mail_message_labels where message_id = :'m1' and source = 'manual'),
	'34 — un échec ne touche aucune pastille');

-- 35–36. La passe est fermée aux personnes ; la lecture suit la visibilité du message.
select pg_temp.endosser(:'admin');
select throws_ok($$select * from public.claim_label_evaluations(1)$$, '42501', null,
	'35 — une personne ne prend pas d''évaluation, administratrice comprise');
reset role;
select public.record_label_evaluation(:'m3', array[pg_temp.pastille('Lead')], null);
select pg_temp.endosser(:'lectrice');
select is((select count(*)::int from public.mail_message_labels where message_id = :'m3'), 0,
	'36 — la lectrice ne lit pas les pastilles d''un mail qu''elle ne voit pas');
reset role;

select * from finish();
rollback;

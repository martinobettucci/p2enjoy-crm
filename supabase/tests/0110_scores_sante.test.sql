-- @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé d'une affaire
-- @verifies docs/SPEC-analytique.md §13.2 (pénalités et conditions, jamais contactée = depuis la création, deux
--           pénalités d'action exclusives), §13.3 (les quatre notes, le signal inconnu et la répartition de son poids),
--           §13.4 (aucun score pour une affaire décidée, archivée, à la corbeille), §13.5 (colonnes calculées
--           `SECURITY INVOKER`, paliers) ; docs/JOURNAL.md décisions 708, 723 et 724
--
-- L'AFFAIRE ÉPROUVÉE EST « Audit sécurité applicative » (`…c3`), ouverte, à l'étape Prospection (seuil de 14 jours). Ses
-- colonnes, ses activités et son courrier sont réécrits DANS LA TRANSACTION par le propriétaire de la base, puis le
-- `rollback` final rend le seed intact. Chaque assertion pose l'état exact qu'elle juge.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

create temporary table pg_temp_ref (nom text primary key, valeur uuid);
insert into pg_temp_ref values ('carte', '5eed0000-0000-4000-8000-0000000000c3');
insert into pg_temp_ref select 'etape', current_step_id from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3';
insert into pg_temp_ref
select 'noeud', ws.node_id from public.workflow_steps ws where ws.id = (select valeur from pg_temp_ref where nom = 'etape');

create or replace function pg_temp.carte() returns public.cards language sql as $$
	select c from public.cards c where c.id = (select valeur from pg_temp_ref where nom = 'carte');
$$;
create or replace function pg_temp.m() returns jsonb language sql as $$ select public.health_momentum(pg_temp.carte()); $$;
create or replace function pg_temp.s() returns jsonb language sql as $$ select public.health_commercial(pg_temp.carte()); $$;
create or replace function pg_temp.codes() returns text[] language sql as $$
	select coalesce(array_agg(p ->> 'code' order by p ->> 'code'), '{}') from jsonb_array_elements(pg_temp.m() -> 'penalties') p;
$$;
create or replace function pg_temp.signal(p_code text) returns jsonb language sql as $$
	select s from jsonb_array_elements(pg_temp.s() -> 'signals') s where s ->> 'code' = p_code;
$$;

-- L'ÉTAT DE DÉPART, POSÉ : étape de Prospection depuis 3 jours, échéance dans 2 jours, aucun contact, créée aujourd'hui,
-- probabilité surchargée à 50, seuil de l'étape à 14 jours.
delete from public.card_activities where card_id = (select valeur from pg_temp_ref where nom = 'carte');
update public.mail_messages set card_id = null, classification = 'unclassified', classified_by = null
 where card_id = (select valeur from pg_temp_ref where nom = 'carte');
update public.workflow_steps set stale_after_days = 14, probability_override = null
 where id = (select valeur from pg_temp_ref where nom = 'etape');
update public.cards set created_at = now(), deleted_at = null where id = (select valeur from pg_temp_ref where nom = 'carte');
update public.card_placements set entered_step_at = now() - interval '3 days', next_action = 'Envoyer la proposition', next_action_at = now() + interval '2 days', probability_override = 50, archived_at = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');

-- =============================================================================================
-- 1. Les objets
-- =============================================================================================

select has_function('public', 'health_momentum', array['cards'], '1 — la dynamique est une colonne calculée de cards');
select has_function('public', 'health_commercial', array['cards'], '2 — la santé commerciale aussi');
select is((select bool_or(prosecdef) from pg_proc where proname in ('health_momentum', 'health_commercial',
            'health_context', 'health_last_contact')), false,
	'3 — toutes `SECURITY INVOKER` : le dernier contact se lit sous la RLS de l''appelant');
select ok(not has_function_privilege('anon', 'public.health_momentum(public.cards)', 'execute'),
	'4 — l''anonyme ne l''exécute pas');
select is(array[app.health_tier(39), app.health_tier(40), app.health_tier(69), app.health_tier(70)],
	array['danger', 'watch', 'watch', 'healthy'], '5 — les paliers à 39, 40, 69 et 70 (décision 708)');

-- =============================================================================================
-- 2. La dynamique — §13.2
-- =============================================================================================

select is(pg_temp.m(), '{"score": 100, "tier": "healthy", "penalties": []}'::jsonb,
	'6 — une affaire à jour : 100, sain, aucune pénalité');

update public.card_placements set entered_step_at = now() - interval '14 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.m() -> 'penalties' -> 0, '{"code": "stale_step", "points": 30, "days": 14, "threshold": 14}'::jsonb,
	'7 — au seuil de l''étape, `stale_step` −30, avec les jours et le seuil');

update public.workflow_steps set stale_after_days = null where id = (select valeur from pg_temp_ref where nom = 'etape');
update public.workflow_nodes_catalog set default_stale_after_days = null
 where id = (select valeur from pg_temp_ref where nom = 'noeud');
select is(pg_temp.codes(), '{}'::text[], '8 — sans seuil, aucune pénalité d''étape');
update public.workflow_steps set stale_after_days = 14 where id = (select valeur from pg_temp_ref where nom = 'etape');

update public.card_placements set entered_step_at = now() - interval '3 days', next_action_at = now() - interval '4 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.m() -> 'penalties', '[{"code": "next_action_overdue", "points": 25, "days": 4}]'::jsonb,
	'9 — une échéance passée : `next_action_overdue` −25, jours de retard compris');

update public.card_placements set next_action = null, next_action_at = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.m() ->> 'score')::int, 85, '10 — ni action ni échéance : `next_action_missing` −15');

update public.card_placements set next_action = '   ' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.codes(), '{next_action_missing}'::text[], '11 — une action faite d''espaces est absente');

update public.card_placements set next_action = 'Rappeler' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.codes(), '{}'::text[], '12 — une action écrite sans échéance n''est pas pénalisée');

update public.card_placements set next_action_at = now() - interval '1 day' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.codes(), '{next_action_overdue}'::text[],
	'13 — en retard, l''action n''est pas aussi « absente » : les deux pénalités s''excluent');

update public.cards set created_at = now() - interval '20 days' where id = (select valeur from pg_temp_ref where nom = 'carte');
update public.card_placements set next_action_at = now() + interval '2 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.m() -> 'penalties', '[{"code": "no_contact_14", "points": 20, "days": 20}]'::jsonb,
	'14 — jamais contactée, créée il y a 20 jours : `no_contact_14` −20 — compté depuis la création');

update public.cards set created_at = now() - interval '45 days' where id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.codes(), '{no_contact_30}'::text[], '15 — au-delà de 30 jours : `no_contact_30`, seul');

insert into public.card_activities (card_id, workspace_id, type, occurred_at, subject, author_id)
select id, workspace_id, 'call', now() - interval '2 days', 'Appel pgTAP', '5eed0000-0000-4000-8000-000000000011'
  from public.cards where id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.codes(), '{}'::text[], '16 — une activité récente est un contact : plus aucune pénalité de contact');

update public.card_activities set deleted_at = now()
 where card_id = (select valeur from pg_temp_ref where nom = 'carte') and subject = 'Appel pgTAP';
select is(pg_temp.codes(), '{no_contact_30}'::text[], '17 — une activité retirée n''est plus un contact');

update public.mail_messages
   set card_id = (select valeur from pg_temp_ref where nom = 'carte'), classification = 'manual',
       classified_by = '5eed0000-0000-4000-8000-000000000011', received_at = now() - interval '16 days'
 where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>';
select is(pg_temp.codes(), '{no_contact_14}'::text[], '18 — un courrier classé dans l''affaire est un contact');
update public.mail_messages set card_id = null, classification = 'unclassified', classified_by = null
 where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>';

update public.card_placements set entered_step_at = now() - interval '30 days', next_action_at = now() - interval '5 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.m() - 'penalties', '{"score": 15, "tier": "danger"}'::jsonb,
	'19 — figée, en retard, sans contact depuis 30 jours : 15, en danger');

-- =============================================================================================
-- 3. La santé commerciale — §13.3
-- =============================================================================================

update public.cards set created_at = now() where id = (select valeur from pg_temp_ref where nom = 'carte');
update public.card_placements set entered_step_at = now() - interval '3 days', next_action_at = now() + interval '2 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.s() - 'signals', '{"score": 80, "tier": "healthy"}'::jsonb,
	'20 — probabilité 50, contact du jour, échéance future, étape jeune : (40×50 + 25×100 + 20×100 + 15×100) / 100 = 80');

update public.cards set created_at = now() - interval '18 days' where id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.signal('contact_freshness') ->> 'value')::int, 52, '21 — 18 jours sans contact : 100 × 12 / 23 = 52');
update public.cards set created_at = now() where id = (select valeur from pg_temp_ref where nom = 'carte');

update public.card_placements set next_action_at = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.signal('next_action_timeliness') ->> 'value')::int, 60, '22 — une action sans échéance : 60');
update public.card_placements set next_action = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.signal('next_action_timeliness') ->> 'value')::int, 30, '23 — aucune action : 30');
update public.card_placements set next_action = 'Rappeler', next_action_at = now() - interval '1 day' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.signal('next_action_timeliness') ->> 'value')::int, 0, '24 — une échéance passée : 0');
update public.card_placements set next_action_at = now() + interval '2 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');

update public.card_placements set entered_step_at = now() - interval '14 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is((pg_temp.signal('step_age') ->> 'value')::int, 50, '25 — au seuil : 100 × (21 − 14) / 14 = 50');
update public.card_placements set entered_step_at = now() - interval '3 days' where card_id = (select valeur from pg_temp_ref where nom = 'carte');

-- UN SIGNAL INCONNU NE COMPTE PAS POUR ZÉRO : sans aucune probabilité, son poids de 40 est réparti sur les trois autres.
update public.card_placements set probability_override = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');
update public.workflow_nodes_catalog set default_probability = null where id = (select valeur from pg_temp_ref where nom = 'noeud');
select is(pg_temp.signal('probability'), '{"code": "probability", "weight": 40, "value": null, "status": "unknown"}'::jsonb,
	'26 — sans probabilité effective, le signal est `unknown`');
select is((pg_temp.s() ->> 'score')::int, 100, '27 — et son poids est réparti : les trois autres à 100 donnent 100, pas 60');

-- =============================================================================================
-- 4. Ce qui n'est pas noté — §13.4
-- =============================================================================================

update public.card_placements set archived_at = now() where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(array[pg_temp.m(), pg_temp.s()], array[null, null]::jsonb[], '28 — une affaire archivée n''a aucun score');
update public.cards set deleted_at = now() where id = (select valeur from pg_temp_ref where nom = 'carte');
update public.card_placements set archived_at = null where card_id = (select valeur from pg_temp_ref where nom = 'carte');
select is(pg_temp.m(), null, '29 — une affaire à la corbeille non plus');
update public.cards set deleted_at = null where id = (select valeur from pg_temp_ref where nom = 'carte');
update public.workflow_nodes_catalog set kind = 'won' where id = (select valeur from pg_temp_ref where nom = 'noeud');
select is(pg_temp.s(), null, '30 — ni une affaire décidée');

select * from finish();
rollback;

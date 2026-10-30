-- @verifies CRM-071 (docs/BACKLOG.md) — tranche T6 : l'import des affaires en base — la simulation qui ne laisse rien, les
--           issues ligne par ligne, l'étape posée sans déplacement, le responsable par email ou par nom, le contact, le fil
--           « par import », le refus de qui n'écrit pas le channel, le journal
-- @verifies docs/SPEC-vues-import-export.md §6.3, §6.3 bis, §6.4, §6.5 ; CLAUDE.md §10
--
-- Joué sous le rôle `authenticated` de Driss (business developer, écrit « Refonte de site », lit seulement
-- « Maintenance ») et de Farida (lectrice). Le `rollback` final rend la base intacte, le fil et le journal compris.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''

create temp table pg_temp.lignes as select $j$[
 {"title": "ZZ Refonte Atelier Lumen", "step": "négociation", "owner": "ADMIN@p2enjoy.test", "amount": "12 500,50",
  "currency": "chf", "probability": "60 %", "next_action": "Envoyer le devis", "next_action_at": "15/11/2026",
  "contact_email": "Ines.Morel@atelier-lumen.example"},
 {"title": "ZZ Site vitrine Duval", "owner": "Driss Lemoine", "next_action_at": "2026-11-20T14:30:00+00:00"},
 {"title": "portail adhérents — mgen loire"},
 {"title": "zz refonte atelier lumen"},
 {"step": "Prospection"},
 {"title": "ZZ Étape inconnue", "step": "Signature électronique"},
 {"title": "ZZ Responsable inconnu", "owner": "personne@ailleurs.example"},
 {"title": "ZZ Montant", "amount": "douze mille"},
 {"title": "ZZ Devise", "currency": "euros"},
 {"title": "ZZ Probabilité", "probability": "140"},
 {"title": "ZZ Date", "next_action_at": "31/02/2026"},
 {"title": "ZZ Contact", "contact_email": "inconnu@nulle-part.example"}
]$j$::jsonb as rows;
grant select on pg_temp.lignes to authenticated;
create temp table pg_temp.repere as select coalesce(max(id), 0) as id from public.audit_log;
grant select on pg_temp.repere to authenticated;

-- =============================================================================================
-- 1. Le contrat
-- =============================================================================================

select ok(
	has_function_privilege('authenticated', 'public.import_cards(uuid, jsonb, boolean)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.import_cards(uuid, jsonb, boolean)', 'EXECUTE')
	and (select prosecdef = false from pg_proc where oid = 'public.import_cards(uuid, jsonb, boolean)'::regprocedure)
	and not has_function_privilege('anon', 'app.place_imported_card(uuid, uuid, uuid, uuid, numeric, numeric, text, timestamptz)', 'EXECUTE'),
	'1 — l''import est aux membres connectés, sous leur RLS, jamais à l''anonyme');

-- =============================================================================================
-- 2. La simulation — §6.1, §6.5
-- =============================================================================================

select pg_temp.endosser(:driss);
create temp table pg_temp.simulation as
select * from public.import_cards('5eed0000-0000-4000-8000-000000000034', (select rows from pg_temp.lignes), true);
select is((select string_agg(outcome || coalesce(':' || code, ''), ', ' order by line) from pg_temp.simulation),
	'created, created, skipped:duplicate_title, skipped:duplicate_title, refused:title_required, refused:unknown_step, '
	|| 'refused:not_a_member, refused:invalid_amount, refused:invalid_currency, refused:invalid_probability, '
	|| 'refused:invalid_date, refused:unknown_contact',
	'2 — chaque ligne a son issue : créées, doublon du channel et doublon du fichier (casse ignorée), puis un motif par champ');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.cards where title like 'ZZ %'), 0, '3 — la simulation ne laisse rien en base');
select is((select count(*)::int from public.audit_log where family = 'import' and id > (select id from pg_temp.repere)), 0,
	'4 — et n''est pas journalisée');

-- =============================================================================================
-- 3. L'import confirmé
-- =============================================================================================

select pg_temp.endosser(:driss);
create temp table pg_temp.confirme as
select * from public.import_cards('5eed0000-0000-4000-8000-000000000034', (select rows from pg_temp.lignes), false);
select pg_temp.redevenir_proprietaire();

create temp view pg_temp.importees as
select a.id, a.title, a.currency, a.created_by, p.current_step_id, p.owner_id, p.amount, p.probability_override,
       p.next_action, p.next_action_at, coalesce(s.label_override, n.label) as etape
  from public.cards a join public.card_placements p on p.card_id = a.id
  join public.workflow_steps s on s.id = p.current_step_id join public.workflow_nodes_catalog n on n.id = s.node_id
 where a.title like 'ZZ %';

select is((select string_agg(title, ', ' order by title) from pg_temp.importees), 'ZZ Refonte Atelier Lumen, ZZ Site vitrine Duval',
	'5 — seules les lignes valides sont écrites');
select is((select etape from pg_temp.importees where title = 'ZZ Refonte Atelier Lumen'), 'Négociation',
	'6 — l''étape nommée, sans casse, est posée directement');
select is((select etape from pg_temp.importees where title = 'ZZ Site vitrine Duval'), 'Prospection',
	'7 — sans étape, l''affaire entre à l''étape initiale');
select ok((select owner_id = '5eed0000-0000-4000-8000-000000000011' and amount = 12500.50 and currency = 'CHF'
                  and probability_override = 60 and next_action = 'Envoyer le devis'
                  and next_action_at = '2026-11-15 09:00 Europe/Paris'::timestamptz
             from pg_temp.importees where title = 'ZZ Refonte Atelier Lumen'),
	'8 — responsable par son email sans casse, montant à la française, devise en majuscules, probabilité, date à 9 h de Paris');
select ok((select owner_id = :driss and next_action_at = '2026-11-20 14:30+00'::timestamptz and currency = 'EUR'
             from pg_temp.importees where title = 'ZZ Site vitrine Duval'),
	'9 — responsable par son nom complet, horodatage ISO de l''export, devise par défaut');
select is((select count(*)::int from public.card_contacts cc join pg_temp.importees i on i.id = cc.card_id
            join public.contacts c on c.id = cc.contact_id where c.email = 'ines.morel@atelier-lumen.example' and cc.role is null),
	1, '10 — le contact est retrouvé par son email et rattaché sans rôle');
select is((select string_agg(e.type || coalesce(':' || (e.payload ->> 'source'), ''), ', ' order by e.type)
             from public.card_events e join pg_temp.importees i on i.id = e.card_id where i.title = 'ZZ Refonte Atelier Lumen'),
	'contact_linked, created:import',
	'11 — le fil dit « créée par import », puis le rattachement du contact ; ni déplacement, ni changement de responsable');
select is((select details from public.audit_log where family = 'import' and entity_type = 'card' and id > (select id from pg_temp.repere)),
	'{"created": 2, "skipped": 2, "refused": 8, "channel_id": "5eed0000-0000-4000-8000-000000000034"}'::jsonb,
	'12 — l''import confirmé est journalisé avec ses comptes et son channel');
select ok(not exists (select 1 from public.card_events e join public.cards a on a.id = e.card_id
                       where a.title not like 'ZZ %' and e.type = 'created' and e.payload ? 'source'),
	'13 — une création ordinaire garde son fil d''avant, sans `source`');

-- =============================================================================================
-- 4. Les refus — §6.3, §6.3 bis
-- =============================================================================================

select pg_temp.endosser(:driss);
select is((select outcome || ':' || code from public.import_cards('5eed0000-0000-4000-8000-000000000035',
             '[{"title": "ZZ Maintenance refusée"}]', false)),
	'refused:forbidden', '14 — Driss, qui lit « Maintenance » sans l''écrire : la ligne est refusée');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:farida);
select is((select outcome || ':' || code from public.import_cards('5eed0000-0000-4000-8000-000000000034',
             '[{"title": "ZZ Farida Essai"}]', false)),
	'refused:forbidden', '15 — la lectrice : chaque ligne est refusée, et rien n''est écrit');
select throws_ok($$ select * from public.import_cards('5eed0000-0000-4000-8000-0000000e7299', '[]', true) $$,
	'P0002', 'channel_not_found', '16 — un channel illisible ou inexistant n''existe pas');
select throws_ok($$ select * from public.import_cards('5eed0000-0000-4000-8000-000000000034',
	(select jsonb_agg(jsonb_build_object('title', 'ZZ ' || g)) from generate_series(1, 1001) g), true) $$,
	'22023', 'import_too_large', '17 — au-delà de 1 000 lignes, l''appel est refusé');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

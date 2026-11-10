-- @verifies CRM-137 (docs/BACKLOG.md) — les affaires candidates au classement d'un message : l'expéditeur connu d'abord,
--           la recherche sans casse ni accents par le titre et le chemin, la borne, l'exclusion des affaires rangées, et
--           les droits de l'appelant (`security invoker`)
-- @verifies docs/SPEC-mail-subsystem.md §26.2 et §26.5 ; docs/SCHEMA.md « Migration `0172` — les
--           affaires candidates au classement d'un message » ; docs/JOURNAL.md décisions 877 et 893 ; CLAUDE.md §10
--
-- La sonde : un contact `tst-137` rattaché à trois affaires — `…00c1` (« Refonte du site vitrine », que la lectrice NE
-- lit PAS), `…00c4` et `…00c5` (qu'elle lit) —, et un message de cet expéditeur classé dans `…00c4`, donc lisible des
-- deux profils. L'adresse du contact porte des majuscules : la comparaison les ignore. Le `rollback` final rend la base
-- intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.sonde as
with ct as (
	insert into public.contacts (workspace_id, full_name, email)
	values ('5eed0000-0000-4000-8000-000000000001', 'Expéditeur Tst 137', 'Tst-137.Expediteur@Exemple.test')
	returning id
), liens as (
	insert into public.card_contacts (workspace_id, card_id, contact_id)
	select '5eed0000-0000-4000-8000-000000000001', c, ct.id
	  from ct, unnest(array['5eed0000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-0000000000c4',
	                        '5eed0000-0000-4000-8000-0000000000c5']::uuid[]) as c
	returning card_id
), m as (
	insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, classified_at,
	                                  from_address, subject, direction)
	values ('5eed0000-0000-4000-8000-000000000001', '<tst-137-connu@exemple.test>', '5eed0000-0000-4000-8000-0000000000c4',
	        'manual', now(), 'tst-137.expediteur@exemple.test', 'Sonde CRM-137', 'inbound')
	returning id
), m_cache as (
	-- Un second message, classé dans l'affaire que la lectrice ne lit pas : il lui est illisible.
	insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, classified_at,
	                                  from_address, subject, direction)
	values ('5eed0000-0000-4000-8000-000000000001', '<tst-137-cache@exemple.test>', '5eed0000-0000-4000-8000-0000000000c1',
	        'manual', now(), 'tst-137.expediteur@exemple.test', 'Sonde CRM-137 cachée', 'inbound')
	returning id
)
select (select id from m) as message, (select id from m_cache) as message_cache, (select count(*) from liens) as liens;
grant select on pg_temp.sonde to authenticated;

create or replace function pg_temp.ids(p_known boolean, p_terme text default null, p_limite integer default 100)
returns uuid[] language sql as $$
	select coalesce(array_agg(card_id order by o), '{}')
	  from public.classification_candidates((select message from pg_temp.sonde), p_known, p_terme, p_limite)
	       with ordinality as r(card_id, title, path, known_sender, o)
$$;

-- --- La fonction et ses privilèges ---------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'public.classification_candidates(uuid,boolean,text,integer)'::regprocedure),
	false, '1 — `security invoker` : la RLS de l''appelant filtre chaque lecture');
select ok(not has_function_privilege('anon', 'public.classification_candidates(uuid,boolean,text,integer)', 'execute'),
	'2 — l''anonyme n''exécute pas la fonction');
select ok(has_function_privilege('authenticated', 'public.classification_candidates(uuid,boolean,text,integer)', 'execute'),
	'3 — un membre connecté l''exécute');

-- --- L'administratrice ------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.ids(true),
	array['5eed0000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-0000000000c4',
	      '5eed0000-0000-4000-8000-0000000000c5']::uuid[],
	'4 — case cochée : les trois affaires dont un contact porte l''adresse, majuscules ignorées, dans l''ordre du titre');
select ok((select bool_and(known_sender) from public.classification_candidates((select message from pg_temp.sonde), true, null, 100)),
	'5 — case cochée : toutes portent `known_sender`');
select ok((select count(*) from public.classification_candidates((select message from pg_temp.sonde), false, null, 100)) > 3,
	'6 — case décochée : d''autres affaires lisibles s''ajoutent');
select is((pg_temp.ids(false))[1:3], pg_temp.ids(true),
	'7 — case décochée : les connues viennent d''abord');
select ok((select bool_or(known_sender) = true and bool_and(known_sender) = false
             from public.classification_candidates((select message from pg_temp.sonde), false, null, 100)),
	'8 — case décochée : la colonne dit lesquelles sont connues');
select ok('5eed0000-0000-4000-8000-0000000000c1'::uuid = any (pg_temp.ids(false, '  VITRÎNE ')),
	'9 — la recherche ignore la casse, les accents et les blancs de bord : « VITRÎNE » trouve « Refonte du site vitrine »');
select ok('5eed0000-0000-4000-8000-0000000000c4'::uuid = any (pg_temp.ids(false,
	(select split_part(path, ' › ', 2) from public.classification_candidates((select message from pg_temp.sonde), true, null, 100)
	  where card_id = '5eed0000-0000-4000-8000-0000000000c4'))),
	'10 — la recherche porte aussi sur le chemin : le nom du channel de `…00c4` la trouve');
select is(cardinality(pg_temp.ids(false, null, 0)), 1, '11 — `p_limit` 0 est ramené à 1');
select ok(cardinality(pg_temp.ids(false, null, 1000)) <= 100, '12 — `p_limit` 1000 est ramené à 100 au plus');
select is(pg_temp.ids(false, 'Contrat cadre 2025'), '{}'::uuid[],
	'13 — une affaire sans rattachement non archivé (« Contrat cadre 2025 ») n''est jamais candidate');
reset role;

-- --- Les affaires rangées -------------------------------------------------------------------------------------
update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000c5';
update public.card_placements set archived_at = now() where card_id = '5eed0000-0000-4000-8000-0000000000c1';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.ids(true), array['5eed0000-0000-4000-8000-0000000000c4']::uuid[],
	'14 — une affaire en corbeille, et une affaire aux rattachements tous archivés, ne sont plus candidates');
reset role;
update public.cards set deleted_at = null where id = '5eed0000-0000-4000-8000-0000000000c5';
update public.card_placements set archived_at = null where card_id = '5eed0000-0000-4000-8000-0000000000c1';

-- --- La lectrice ------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(pg_temp.ids(true),
	array['5eed0000-0000-4000-8000-0000000000c4', '5eed0000-0000-4000-8000-0000000000c5']::uuid[],
	'15 — la lectrice ne reçoit jamais `…00c1`, qu''elle ne lit pas, même connue de l''expéditeur');
select ok(not ('5eed0000-0000-4000-8000-0000000000c1'::uuid = any (pg_temp.ids(false, 'vitrine'))),
	'16 — ni par la recherche, case décochée');
select throws_like(
	format('select * from public.classification_candidates(%L, true, null, 50)', (select message_cache from pg_temp.sonde)),
	'%message_not_found%',
	'17 — un message illisible refuse en 404 `message_not_found`, comme un message inexistant');
select throws_like(
	'select * from public.classification_candidates(''00000000-0000-4000-8000-000000000000'', true, null, 50)',
	'%message_not_found%',
	'18 — un message inexistant refuse de même');
reset role;

select * from finish();
rollback;

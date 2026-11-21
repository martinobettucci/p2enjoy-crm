-- @verifies CRM-160 (docs/BACKLOG.md) — « Seulement moi » retient les réponses reçues dans une affaire : (i) qui a écrit dans
--           le fil, (ii) le responsable d'un rattachement non archivé ; jamais un envoi par (ii), jamais un message non
--           rattaché, jamais un écrit de l'identité de service ni un écrit en corbeille, jamais un tiers ; l'arborescence suit
-- @verifies docs/SPEC-mail-subsystem.md §27.2, §27.3, §27.7 ; docs/SCHEMA.md « Migration `0194` » ;
--           docs/JOURNAL.md décisions 959 et 960 (INC-363) ; CLAUDE.md §10 (pas une règle d'accès : la RLS juge les lectures)
--
-- ROUGE AVANT `0194` (CLAUDE.md §18) : les n° 3, 9, 10, 12 et 14 attendent la règle nouvelle ; la définition de `0190` ne
-- connaît que les adresses personnelles et le transfert, et une réponse adressée à la seule adresse `c-*` d'une affaire ne
-- concerne personne.
--
-- Les sondes, posées sous la clé de propriétaire et défaites par le `rollback` final :
-- - fil A, dans Vertuo (`…d012`, Driss seul responsable) : l'envoi de Camille, sa réponse reçue à la seule adresse de
--   l'affaire, et un message du même fil NON rattaché, relevé dans la boîte système ;
-- - trois fils dans `…00c1` (Driss seul responsable), chacun d'un écrit puis d'une réponse reçue à l'adresse de l'affaire :
--   écrit par l'identité de service ; écrit par Camille puis mis en corbeille ; écrit par Driss ;
-- - pour finir, un second rattachement de `…00c1`, à Camille, puis archivé.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Le message de la sonde `p_message_id`, lu SOUS LES DROITS de la personne endossée, et s'il la concerne.
create or replace function pg_temp.concerne(p_message_id text) returns boolean language sql as $$
	select public.concerns_me(m) from public.mail_messages m where m.rfc822_message_id = p_message_id;
$$;
grant execute on function pg_temp.concerne(text) to authenticated;

\set espace '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set driss '5eed0000-0000-4000-8000-000000000012'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set c1 '5eed0000-0000-4000-8000-0000000000c1'
\set vertuo '5eed0000-0000-4000-8000-00000000d012'

insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, to_addresses,
                                  cc_addresses, bcc_addresses, subject, direction, references_ids, deleted_at)
values
	-- Fil A : Camille écrit depuis Vertuo ; la réponse ne nomme que l'adresse de l'affaire.
	(:'espace', '<tst-160-a-envoi@exemple.test>', :'vertuo', 'outbound', 'admin@p2enjoy.test', array['client@exemple.test'], '{}', '{}',
	 'Sonde 160 A', 'outbound', '{}', null),
	(:'espace', '<tst-160-a-reponse@exemple.test>', :'vertuo', 'auto', 'client@exemple.test', array['c-gpae73kx@crm.p2enjoy.test'], '{}', '{}',
	 'Re: Sonde 160 A', 'inbound', array['<tst-160-a-envoi@exemple.test>'], null),
	(:'espace', '<tst-160-a-non-classe@exemple.test>', null, 'unclassified', 'client@exemple.test', array['systeme@crm.p2enjoy.test'], '{}', '{}',
	 'Re: Sonde 160 A, hors affaire', 'inbound', array['<tst-160-a-envoi@exemple.test>'], null),
	-- Fil S : l'identité de service écrit ; la réponse revient à l'affaire.
	(:'espace', '<tst-160-s-envoi@exemple.test>', :'c1', 'outbound', 'systeme@crm.p2enjoy.test', array['client@exemple.test'], '{}', '{}',
	 'Sonde 160 S', 'outbound', '{}', null),
	(:'espace', '<tst-160-s-reponse@exemple.test>', :'c1', 'auto', 'client@exemple.test', array['c-mfmzk0cj@crm.p2enjoy.test'], '{}', '{}',
	 'Re: Sonde 160 S', 'inbound', array['<tst-160-s-envoi@exemple.test>'], null),
	-- Fil C : Camille écrit, mais son envoi est en corbeille.
	(:'espace', '<tst-160-c-envoi@exemple.test>', :'c1', 'outbound', 'admin@p2enjoy.test', array['client@exemple.test'], '{}', '{}',
	 'Sonde 160 C', 'outbound', '{}', now()),
	(:'espace', '<tst-160-c-reponse@exemple.test>', :'c1', 'auto', 'client@exemple.test', array['c-mfmzk0cj@crm.p2enjoy.test'], '{}', '{}',
	 'Re: Sonde 160 C', 'inbound', array['<tst-160-c-envoi@exemple.test>'], null),
	-- Fil D : Driss écrit, depuis son identité personnelle.
	(:'espace', '<tst-160-d-envoi@exemple.test>', :'c1', 'outbound', 'contact@p2enjoy.test', array['client@exemple.test'], '{}', '{}',
	 'Sonde 160 D', 'outbound', '{}', null),
	(:'espace', '<tst-160-d-reponse@exemple.test>', :'c1', 'auto', 'client@exemple.test', array['c-mfmzk0cj@crm.p2enjoy.test'], '{}', '{}',
	 'Re: Sonde 160 D', 'inbound', array['<tst-160-d-envoi@exemple.test>'], null);

-- UN NON CLASSÉ N'EST LISIBLE QUE PAR SA BOÎTE : la sonde hors affaire est relevée dans la boîte système, que Camille lit.
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 160001
  from public.mail_messages m
  join public.mail_inbound_accounts a on a.imap_username = 'systeme@crm.p2enjoy.test' and a.owner_id is null
 where m.rfc822_message_id = '<tst-160-a-non-classe@exemple.test>';

-- L'ORACLE INDÉPENDANT du dossier de Vertuo sous le filtre de Camille, calculé par la clé de propriétaire sur ses adresses
-- écrites en clair, sans `concerns_me` : ce qui lui est adressé ou qu'elle a écrit, et chaque message reçu d'un fil où elle a
-- écrit un message que la corbeille n'a pas pris. Camille n'est responsable d'aucun rattachement de Vertuo.
create temp table pg_temp.attendu_vertuo as
with adresses(a) as (
	select lower(btrim(i.from_address)) from public.mail_outbound_identities i where i.owner_id = '5eed0000-0000-4000-8000-000000000011'
)
select count(*)::bigint as nombre
  from public.mail_messages m
 where m.card_id = '5eed0000-0000-4000-8000-00000000d012'
   and m.deleted_at is null
   and (array(select a from adresses) && (m.to_addresses || m.cc_addresses || m.bcc_addresses || array[lower(m.from_address)])
        or (m.direction = 'inbound'
            and exists (select 1 from public.mail_messages o
                         where o.workspace_id = m.workspace_id and o.deleted_at is null
                           and coalesce(o.references_ids[1], o.rfc822_message_id) = coalesce(m.references_ids[1], m.rfc822_message_id)
                           and lower(btrim(o.from_address)) in (select a from adresses))));
grant select on pg_temp.attendu_vertuo to authenticated;

-- 1–2. La forme : la signature de `0175`, `stable`, `security invoker` ; l'anonyme ne l'exécute pas.
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'public.concerns_me(public.mail_messages)'::regprocedure),
	'sfalse', '1 — `concerns_me` garde sa signature, `stable` et `security invoker`');
select ok(not has_function_privilege('anon', 'public.concerns_me(public.mail_messages)', 'execute'),
	'2 — l''anonyme n''exécute pas `concerns_me`');

select pg_temp.endosser(:'admin');

-- 3–9. Camille : elle a écrit dans le fil A, elle n'est responsable ni de Vertuo ni de `…00c1`.
select ok(pg_temp.concerne('<tst-160-a-reponse@exemple.test>'),
	'3 — (i) la réponse reçue à la seule adresse de Vertuo concerne Camille, qui a écrit dans ce fil');
select ok(not pg_temp.concerne('<tst-160-a-non-classe@exemple.test>'),
	'4 — un message du même fil qui n''est rattaché à aucune affaire reste comme avant : il ne la concerne pas');
select ok(pg_temp.concerne('<tst-160-a-envoi@exemple.test>'),
	'5 — témoin : son envoi la concerne, comme avant (son adresse est l''expéditrice)');
select ok(not pg_temp.concerne('<tst-160-s-reponse@exemple.test>'),
	'6 — un fil où seule l''identité de service a écrit ne fait écrire personne : la réponse ne concerne pas Camille');
select ok(not pg_temp.concerne('<tst-160-c-reponse@exemple.test>'),
	'7 — son écrit en corbeille ne compte pas : la réponse ne la concerne pas');
select ok(not pg_temp.concerne('<tst-160-d-reponse@exemple.test>'),
	'8 — un fil où Driss a écrit ne concerne pas l''administratrice, qui lit pourtant l''affaire');
select is((select nombre from public.inbox_arborescence(true) where card_id = :'vertuo'),
	(select nombre from pg_temp.attendu_vertuo),
	'9 — le dossier de Vertuo, filtre posé : la réponse y est comptée, égal à l''oracle');

reset role;
select pg_temp.endosser(:'driss');

-- 10–12. Driss : seul responsable de Vertuo et de `…00c1`.
select ok(pg_temp.concerne('<tst-160-a-reponse@exemple.test>'),
	'10 — (ii) la réponse reçue dans Vertuo concerne Driss, son responsable, qui n''a rien écrit dans le fil');
select ok(not pg_temp.concerne('<tst-160-a-envoi@exemple.test>'),
	'11 — un ENVOI de l''affaire n''est pas retenu par (ii) : l''envoi de Camille ne concerne pas Driss');
select ok(pg_temp.concerne('<tst-160-d-reponse@exemple.test>'),
	'12 — la réponse à son propre envoi, reçue à l''adresse de l''affaire, concerne Driss');

reset role;
select pg_temp.endosser(:'lectrice');

select ok(not pg_temp.concerne('<tst-160-a-reponse@exemple.test>'),
	'13 — la lectrice, qui n''a ni écrit ni la responsabilité de l''affaire : la réponse ne la concerne pas');

reset role;

-- 14–15. Un second rattachement de `…00c1`, à Camille : (ii) vaut pour chaque rattachement actif, pas pour un archivé.
insert into public.card_placements (workspace_id, card_id, channel_id, workflow_id, current_step_id, owner_id, created_by)
values (:'espace', :'c1', '5eed0000-0000-4000-8000-000000000034', '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000062', :'admin', :'admin');

select pg_temp.endosser(:'admin');
select ok(pg_temp.concerne('<tst-160-s-reponse@exemple.test>'),
	'14 — (ii) responsable d''un second rattachement de l''affaire : la réponse concerne Camille');
reset role;

update public.card_placements set archived_at = now()
 where card_id = :'c1' and channel_id = '5eed0000-0000-4000-8000-000000000034';

select pg_temp.endosser(:'admin');
select ok(not pg_temp.concerne('<tst-160-s-reponse@exemple.test>'),
	'15 — ce rattachement archivé, elle n''est plus responsable : la réponse ne la concerne plus');
reset role;

select * from finish();
rollback;

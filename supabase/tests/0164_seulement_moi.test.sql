-- @verifies CRM-139 (docs/BACKLOG.md) — « Seulement moi » : `concerns_me` par À, Cc, Cci et l'expéditeur, sans casse ;
--           jamais l'identité de service ni celle d'une autre personne, y compris sous un administrateur ; fausse sans
--           identité ; `inbox_arborescence(p_only_me)` et ses compteurs, l'appel sans argument inchangé ; l'anonyme refusé
-- @verifies docs/SPEC-mail-subsystem.md §27.2, §27.3, §27.6 ; docs/SCHEMA.md « Migration `0175` » ;
--           docs/JOURNAL.md décisions 879 et 902 ; CLAUDE.md §10
--
-- La sonde, posée sous la clé de propriétaire et défaite par le `rollback` final :
-- - une SECONDE identité personnelle de l'administratrice (`…011`), à l'adresse écrite avec des majuscules ;
-- - six messages : non classés, À sa première adresse et Cc sa seconde ; classés dans `…00c1`, Cci sa première adresse,
--   puis expédié par elle ; À l'identité de service seule ; À l'identité de Driss (`…012`), dans `…00c1`, qu'il lit.
-- La lectrice (`…013`) n'a aucune identité.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
\set c1 '5eed0000-0000-4000-8000-0000000000c1'

insert into public.mail_outbound_identities (workspace_id, owner_id, label, smtp_host, smtp_port, smtp_username, from_address)
values (:'espace', :'admin', 'Sonde CRM-139', 'smtp.exemple.test', 587, 'sonde-139', 'Camille.Sonde139@P2Enjoy.test');

insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, to_addresses,
                                  cc_addresses, bcc_addresses, subject, direction)
values
	(:'espace', '<tst-139-a@exemple.test>', null, 'unclassified', 'tiers@exemple.test', array['admin@p2enjoy.test'], '{}', '{}', 'Sonde 139 À', 'inbound'),
	(:'espace', '<tst-139-cc@exemple.test>', null, 'unclassified', 'tiers@exemple.test', array['systeme@crm.p2enjoy.test'], array['camille.sonde139@p2enjoy.test'], '{}', 'Sonde 139 Cc', 'inbound'),
	(:'espace', '<tst-139-cci@exemple.test>', :'c1', 'manual', 'tiers@exemple.test', array['autre@exemple.test'], '{}', array['admin@p2enjoy.test'], 'Sonde 139 Cci', 'inbound'),
	(:'espace', '<tst-139-de@exemple.test>', :'c1', 'outbound', 'admin@p2enjoy.test', array['client@exemple.test'], '{}', '{}', 'Sonde 139 De', 'outbound'),
	(:'espace', '<tst-139-service@exemple.test>', null, 'unclassified', 'tiers@exemple.test', array['systeme@crm.p2enjoy.test'], '{}', '{}', 'Sonde 139 service', 'inbound'),
	(:'espace', '<tst-139-driss@exemple.test>', :'c1', 'manual', 'tiers@exemple.test', array['contact@p2enjoy.test'], '{}', '{}', 'Sonde 139 Driss', 'inbound');

-- UN NON CLASSÉ N'EST LISIBLE QUE PAR SA BOÎTE (`app.boite_du_message_lisible`) : les trois sondes non classées sont
-- relevées dans la boîte système, sans propriétaire, que l'administratrice lit.
insert into public.mail_message_occurrences (message_id, account_id, folder, uid)
select m.id, a.id, 'INBOX', 139000 + row_number() over (order by m.rfc822_message_id)
  from public.mail_messages m
  join public.mail_inbound_accounts a on a.imap_username = 'systeme@crm.p2enjoy.test' and a.owner_id is null
 where m.rfc822_message_id in ('<tst-139-a@exemple.test>', '<tst-139-cc@exemple.test>', '<tst-139-service@exemple.test>');

-- L'ORACLE INDÉPENDANT des compteurs : ce que l'administratrice devrait voir sous le filtre, calculé par la clé de
-- propriétaire sur ses deux adresses écrites en clair, sans `concerns_me`.
-- RÉVISÉ par `CRM-138` T5 (décision 51), non relâché : un message EN CORBEILLE n'est vu nulle part
-- (docs/SPEC-mail-subsystem.md §29.4), et l'oracle, qui lit en propriétaire sous aucune politique, l'écarte comme l'écran —
-- le seed en efface un adressé à `admin@` (docs/SPEC-seed.md §45).
create temp table pg_temp.attendu as
select m.card_id, count(*)::bigint as nombre
  from public.mail_messages m
 where array['admin@p2enjoy.test', 'camille.sonde139@p2enjoy.test']
       && (m.to_addresses || m.cc_addresses || m.bcc_addresses || array[lower(m.from_address)])
   and m.deleted_at is null
 group by m.card_id;
grant select on pg_temp.attendu to authenticated;

-- 1–2. La forme.
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'public.concerns_me(public.mail_messages)'::regprocedure),
	'sfalse', '1 — `concerns_me` est `stable` et `security invoker`');
select ok(not has_function_privilege('anon', 'public.concerns_me(public.mail_messages)', 'execute')
          and not has_function_privilege('anon', 'public.inbox_arborescence(boolean)', 'execute')
          and has_function_privilege('authenticated', 'public.inbox_arborescence(boolean)', 'execute'),
	'2 — l''anonyme n''exécute ni `concerns_me` ni `inbox_arborescence` ; `authenticated` exécute l''arborescence');

select pg_temp.endosser(:'admin');

-- 3–8. L'administratrice : ses deux adresses, par les quatre champs ; jamais le service, jamais Driss.
select ok((select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-a@exemple.test>'),
	'3 — À sa première adresse : le message la concerne');
select ok((select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-cc@exemple.test>'),
	'4 — Cc sa seconde adresse, déclarée avec des majuscules : la comparaison les ignore');
select ok((select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-cci@exemple.test>'),
	'5 — Cci sa première adresse : le message la concerne');
select ok((select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-de@exemple.test>'),
	'6 — expédié par elle : ses envois restent dans son courrier');
select ok(not (select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-service@exemple.test>'),
	'7 — adressé à la seule identité de service, qu''elle lit pourtant : le message ne la concerne pas');
select ok(not (select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-driss@exemple.test>'),
	'8 — adressé à l''identité de Driss, qu''elle lit pourtant en administratrice : le message ne la concerne pas');

-- 9–12. Les compteurs.
select is((select nombre from public.inbox_arborescence(true) where card_id is null),
	(select coalesce((select nombre from pg_temp.attendu where card_id is null), 0)),
	'9 — « Non classés », filtre posé : le compte de ses seuls messages, égal à l''oracle');
select is((select nombre from public.inbox_arborescence(true) where card_id = :'c1'),
	(select nombre from pg_temp.attendu where card_id = :'c1'),
	'10 — le dossier de `…00c1`, filtre posé : ses seuls messages, égal à l''oracle');
select is((select unread_count from public.inbox_arborescence(true) where card_id is null),
	(select count(*) from public.mail_messages m where m.card_id is null and public.concerns_me(m) and not public.is_read(m)),
	'11 — les non-lus de « Non classés » suivent le filtre');
select set_eq('select * from public.inbox_arborescence()', 'select * from public.inbox_arborescence(false)',
	'12 — l''appel sans argument rend exactement l''arborescence d''avant, filtre ôté');
select ok((select nombre from public.inbox_arborescence() where card_id is null)
          > (select nombre from public.inbox_arborescence(true) where card_id is null),
	'13 — témoin : le filtre retire réellement des messages de « Non classés »');

reset role;
select pg_temp.endosser(:'driss');

select ok((select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-driss@exemple.test>'),
	'14 — Driss : le message adressé à son identité le concerne');
select ok(not (select public.concerns_me(m) from public.mail_messages m where rfc822_message_id = '<tst-139-cci@exemple.test>'),
	'15 — Driss : le message adressé à l''administratrice ne le concerne pas');

reset role;
select pg_temp.endosser(:'lectrice');

select is((select count(*)::int from public.mail_messages m where public.concerns_me(m)), 0,
	'16 — la lectrice, sans identité : aucun message ne la concerne');

reset role;

select * from finish();
rollback;

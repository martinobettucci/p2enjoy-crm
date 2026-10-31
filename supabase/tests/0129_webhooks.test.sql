-- @verifies CRM-073 (docs/BACKLOG.md) — tranche T1 : les webhooks sortants en base — la création réservée à
--           l'administrateur et son secret rendu une fois, les règles de forme, l'inscription des neuf événements par les
--           déclencheurs et le filtre de channel, la prise et le résultat des remises, le renvoi, la régénération du
--           secret, la purge et le journal
-- @verifies docs/SPEC-webhooks.md §3, §4, §5.1, §5.2, §5.3, §6 ; docs/JOURNAL.md décision 784 ; CLAUDE.md §10
--
-- Joué sous le rôle `authenticated` de l'administratrice, de Driss (business developer) et de Farida (lectrice), et sous
-- `service_role` pour la prise des remises. Le `rollback` final rend la base intacte, Vault et le journal compris.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

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

\set admin '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set espace '\'5eed0000-0000-4000-8000-000000000001\''
\set refonte '\'5eed0000-0000-4000-8000-000000000034\''
\set maintenance '\'5eed0000-0000-4000-8000-000000000035\''
\set affaire '\'5eed0000-0000-4000-8000-0000000000c4\''

create temp table pg_temp.cree (nom text primary key, id uuid, secret text);
grant all on pg_temp.cree to authenticated, service_role;
create temp table pg_temp.repere as select coalesce(max(id), 0) as id from public.audit_log;
grant select on pg_temp.repere to authenticated;

-- =============================================================================================
-- 1. Le contrat — §4.1, §4.2, §6
-- =============================================================================================

select ok(
	(select relrowsecurity from pg_class where oid = 'public.webhook_endpoints'::regclass)
	and (select relrowsecurity from pg_class where oid = 'public.webhook_deliveries'::regclass)
	and not has_table_privilege('authenticated', 'public.webhook_endpoints', 'INSERT')
	and not has_column_privilege('authenticated', 'public.webhook_endpoints', 'secret_id', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.webhook_endpoints', 'workspace_id', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.webhook_deliveries', 'INSERT')
	and not has_table_privilege('authenticated', 'public.webhook_deliveries', 'UPDATE')
	and not has_table_privilege('anon', 'public.webhook_endpoints', 'SELECT'),
	'1 — RLS active ; on ne crée un webhook que par la fonction, on n''écrit ni son secret ni une remise');

select ok(
	has_function_privilege('authenticated', 'public.create_webhook_endpoint(uuid, text, text, text[], uuid, boolean)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.create_webhook_endpoint(uuid, text, text, text[], uuid, boolean)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.claim_webhook_deliveries(integer)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.record_webhook_attempt(uuid, integer, text)', 'EXECUTE')
	and has_function_privilege('service_role', 'public.claim_webhook_deliveries(integer)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'app.webhooks_on_card_event()', 'EXECUTE'),
	'2 — la prise et le résultat des remises sont à la clé de service seule (§6)');

-- =============================================================================================
-- 2. La création — §4.1
-- =============================================================================================

select pg_temp.endosser(:driss);
select throws_ok(
	$$select * from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 Driss',
	  'https://recepteur.example/hook', array['card.created'])$$,
	'42501', 'forbidden', '3 — un business developer ne crée pas de webhook');
select is((select count(*) from public.webhook_endpoints), 0::bigint,
	'4 — …et il n''en lit aucun, pas même par la table');

select pg_temp.endosser(:admin);
insert into pg_temp.cree
select 'tout', id, secret from public.create_webhook_endpoint(:espace, '  tst-crm073 Tout  ', 'https://recepteur.example/tout',
	array['card.created', 'card.step_changed', 'card.owner_changed', 'card.archived', 'card.trashed', 'card.restored',
	      'contact.created', 'contact.updated', 'contact.deleted']);
insert into pg_temp.cree
select 'refonte', id, secret from public.create_webhook_endpoint(:espace, 'tst-crm073 Refonte', 'https://recepteur.example/refonte',
	array['card.created', 'card.step_changed', 'card.trashed'], :refonte);
insert into pg_temp.cree
select 'maintenance', id, secret from public.create_webhook_endpoint(:espace, 'tst-crm073 Maintenance',
	'https://recepteur.example/maintenance', array['card.step_changed'], :maintenance);
insert into pg_temp.cree
select 'eteint', id, secret from public.create_webhook_endpoint(:espace, 'tst-crm073 Éteint', 'https://recepteur.example/eteint',
	array['card.step_changed', 'contact.created'], null, false);

select ok(
	(select bool_and(secret ~ '^whsec_[0-9a-f]{64}$') from pg_temp.cree)
	and (select count(distinct secret) from pg_temp.cree) = 4,
	'5 — chaque création rend un secret `whsec_` de 64 chiffres hexadécimaux, distinct des autres');
select is((select name from public.webhook_endpoints where id = (select id from pg_temp.cree where nom = 'tout')),
	'tst-crm073 Tout', '6 — le nom est rangé sans ses blancs de bord');

select throws_ok(
	$$select * from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 http',
	  'http://recepteur.example/hook', array['card.created'])$$,
	'23514', null, '7 — une adresse en http:// est refusée : HTTPS obligatoire (§6)');
select throws_ok(
	$$select * from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 vide',
	  'https://recepteur.example/hook', array[]::text[])$$,
	'23514', null, '8 — aucun événement : refusé');
select throws_ok(
	$$select * from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 inconnu',
	  'https://recepteur.example/hook', array['card.created', 'card.created'])$$,
	'23514', null, '9 — un événement en double : refusé');
select throws_ok(
	$$select * from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 contact',
	  'https://recepteur.example/hook', array['contact.created'], '5eed0000-0000-4000-8000-000000000034')$$,
	'23514', null, '10 — un événement de contact sous filtre de channel : refusé (décision 784, point 2)');
select throws_ok(
	$$update public.webhook_endpoints set events = array['card.created', 'contact.deleted']
	   where name = 'tst-crm073 Refonte'$$,
	'23514', null, '11 — …et l''administrateur ne l''ajoute pas davantage par la suite');

select pg_temp.redevenir_proprietaire();
select ok(
	(select count(*) from vault.decrypted_secrets s join public.webhook_endpoints e on e.secret_id = s.id
	  join pg_temp.cree c on c.id = e.id where s.decrypted_secret = c.secret) = 4,
	'12 — le secret est rangé dans Vault, sous la référence du webhook');
select pg_temp.endosser(:admin);
select throws_ok($$select count(*) from vault.decrypted_secrets$$, '42501', null,
	'13 — l''administrateur lui-même ne relit pas les secrets (§6)');

-- =============================================================================================
-- 3. L'inscription des événements d'affaire — §3, §5.1
-- =============================================================================================

select pg_temp.redevenir_proprietaire();
update public.card_placements set current_step_id = '5eed0000-0000-4000-8000-000000000064'
 where card_id = :affaire and channel_id = :refonte;

select is(
	(select string_agg(e.name, ', ' order by e.name) from public.webhook_deliveries d
	  join public.webhook_endpoints e on e.id = d.endpoint_id where d.event = 'card.step_changed'),
	'tst-crm073 Refonte, tst-crm073 Tout',
	'14 — une étape changée en « Refonte » : une remise au webhook de tout l''espace et à celui de « Refonte », aucune à '
	'celui de « Maintenance » ni au webhook éteint');

select is(
	(select (((payload #- '{data,step,id}'::text[]) #- '{data,from_step,id}'::text[]) #- '{data,placement_id}'::text[])
	          - 'id'::text - 'occurred_at'::text
	   from public.webhook_deliveries d join public.webhook_endpoints e on e.id = d.endpoint_id
	  where d.event = 'card.step_changed' and e.name = 'tst-crm073 Tout'),
	jsonb_build_object('event', 'card.step_changed', 'workspace_id', :espace::uuid, 'data', jsonb_build_object(
		'card_id', :affaire::uuid, 'title', 'Refonte intranet Ville de Lyon', 'currency', 'EUR',
		'channel_id', :refonte::uuid, 'channel_name', 'Refonte de site',
		'step', jsonb_build_object('label', 'Signature'), 'from_step', jsonb_build_object('label', 'Négociation'),
		'owner', jsonb_build_object('id', :driss::uuid, 'full_name', 'Driss Lemoine'),
		'amount', (select amount from public.card_placements where card_id = :affaire and channel_id = :refonte))),
	'15 — la charge utile : identifiants, affaire, rattachement, étape et étape quittée, responsable (§5.1)');

select ok(
	(select bool_and(d.status = 'pending' and d.attempts = 0 and d.next_attempt_at <= now()
	                 and d.event_id in (select id from public.card_events where card_id = :affaire and type = 'moved'))
	   from public.webhook_deliveries d where d.event = 'card.step_changed'),
	'16 — chaque remise est due aussitôt, sans essai, et porte l''identifiant de l''événement du fil');

update public.card_placements set owner_id = '5eed0000-0000-4000-8000-000000000011'
 where card_id = :affaire and channel_id = :refonte;
select is(
	(select payload -> 'data' -> 'from_owner' ->> 'full_name' from public.webhook_deliveries where event = 'card.owner_changed'),
	'Driss Lemoine', '17 — un responsable changé nomme le précédent ; seul le webhook qui l''écoute le reçoit');

update public.cards set deleted_at = now() where id = :affaire;
select is(
	(select string_agg(e.name, ', ' order by e.name) from public.webhook_deliveries d
	  join public.webhook_endpoints e on e.id = d.endpoint_id where d.event = 'card.trashed'),
	'tst-crm073 Refonte, tst-crm073 Tout',
	'18 — la corbeille porte sur l''affaire : le webhook de « Refonte » la reçoit parce qu''elle y est rattachée');
select ok(
	(select not (payload -> 'data' ? 'placement_id') from public.webhook_deliveries
	  where event = 'card.trashed' limit 1),
	'19 — …et sa charge utile ne désigne aucun rattachement');
update public.cards set deleted_at = null where id = :affaire;

-- Une affaire neuve dans « Refonte » : la naissance s'écrit au premier rattachement (décision 768).
insert into public.cards (id, workspace_id, title) values ('c0730000-0000-4000-8000-000000000001', :espace, 'tst-crm073 Neuve');
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id)
select 'c0730000-0000-4000-8000-000000000001', :espace, :refonte, ch.workflow_id, '5eed0000-0000-4000-8000-000000000061'
  from public.channels ch where ch.id = :refonte;
select is(
	(select string_agg(e.name || ':' || (d.payload -> 'data' -> 'step' ->> 'label'), ', ' order by e.name)
	   from public.webhook_deliveries d join public.webhook_endpoints e on e.id = d.endpoint_id
	  where d.event = 'card.created'),
	'tst-crm073 Refonte:Prospection, tst-crm073 Tout:Prospection',
	'20 — une affaire créée : son rattachement retrouvé, son étape initiale dite');

-- =============================================================================================
-- 4. Les contacts — §3 (décision 784, points 2 et 3)
-- =============================================================================================

insert into public.contacts (id, workspace_id, full_name, email, phone)
values ('c0730000-0000-4000-8000-0000000000c1', :espace, 'tst-crm073 Contact', 'contact@crm073.example', '0102030405');
update public.contacts set phone = '0607080910' where id = 'c0730000-0000-4000-8000-0000000000c1';
update public.contacts set updated_at = now() where id = 'c0730000-0000-4000-8000-0000000000c1';
select is(
	(select string_agg(d.event || coalesce(':' || (d.payload -> 'data' ->> 'changed'), ''), ', ' order by d.created_at, d.event)
	   from public.webhook_deliveries d where d.event like 'contact.%'),
	'contact.created, contact.updated:["phone"]',
	'21 — création puis téléphone changé : `changed` nomme le champ sans le recopier ; une écriture sans changement '
	'n''émet rien ; seul le webhook sans channel les reçoit');
select ok(
	(select not (payload -> 'data' ? 'phone') from public.webhook_deliveries where event = 'contact.updated'),
	'22 — le téléphone ne sort pas : la charge utile validée porte nom, email et organisation');

update public.contacts set anonymized_at = now(), full_name = 'Contact anonymisé', email = null, phone = null
 where id = 'c0730000-0000-4000-8000-0000000000c1';
delete from public.contacts where id = 'c0730000-0000-4000-8000-0000000000c1';
select is(
	(select count(*)::text || ':' || max(payload -> 'data' ->> 'contact_id') from public.webhook_deliveries
	  where event = 'contact.deleted' and payload -> 'data' = jsonb_build_object('contact_id', 'c0730000-0000-4000-8000-0000000000c1')),
	'1:c0730000-0000-4000-8000-0000000000c1',
	'23 — l''anonymisation émet `contact.deleted`, son seul identifiant ; la suppression qui suit n''émet rien de plus');

-- =============================================================================================
-- 5. La prise, le résultat, le renvoi — §5.2, §5.3
-- =============================================================================================

update public.webhook_deliveries set next_attempt_at = now() + interval '1 day'
 where endpoint_id <> (select id from pg_temp.cree where nom = 'refonte');
set local role service_role;
create temp table pg_temp.prises as select * from public.claim_webhook_deliveries(50);
select is(
	(select count(*)::text || ':' || bool_and(attempt = 1)::text || ':'
	        || bool_and(secret = (select secret from pg_temp.cree where nom = 'refonte'))::text
	        || ':' || bool_and(url = 'https://recepteur.example/refonte')::text from pg_temp.prises),
	'3:true:true:true',
	'24 — la prise rend les remises dues avec l''adresse et le secret de leur webhook, l''essai compté');
select is((select count(*) from public.claim_webhook_deliveries(50)), 0::bigint,
	'25 — une remise prise est réservée : un second passage ne la reprend pas');

select is(public.record_webhook_attempt((select delivery_id from pg_temp.prises order by delivery_id limit 1), 204),
	'delivered', '26 — un code 2xx clôt la remise');

create temp table pg_temp.echec as select delivery_id as id from pg_temp.prises order by delivery_id offset 1 limit 1;
grant select on pg_temp.echec to authenticated;
select public.record_webhook_attempt((select id from pg_temp.echec), 500);
select is(
	(select (next_attempt_at - last_attempt_at)::text || ':' || status || ':' || last_status_code
	   from public.webhook_deliveries where id = (select id from pg_temp.echec)),
	'00:01:00:pending:500', '27 — un premier échec : le prochain essai une minute plus tard');
update public.webhook_deliveries set attempts = 5 where id = (select id from pg_temp.echec);
select is(public.record_webhook_attempt((select id from pg_temp.echec), null, 'timeout'), 'failed',
	'28 — le cinquième échec clôt la remise en `failed`, motif gardé, aucun prochain essai');

reset role;
select pg_temp.endosser(:admin);
create temp table pg_temp.renvoi as select public.redeliver_webhook((select id from pg_temp.echec)) as id;
select is(
	(select d.status || ':' || d.attempts || ':' || (d.event_id = o.event_id)::text || ':' || (d.payload = o.payload)::text
	   from public.webhook_deliveries d join public.webhook_deliveries o on o.id = d.redelivery_of
	  where d.id = (select id from pg_temp.renvoi)),
	'pending:0:true:true',
	'29 — le renvoi crée une nouvelle remise du même événement et du même corps, cinq essais à nouveau');

-- =============================================================================================
-- 6. Le secret régénéré, la suppression, la purge, le journal — §4.1, §4.2, §4.3
-- =============================================================================================

create temp table pg_temp.rotation as
select public.rotate_webhook_secret((select id from pg_temp.cree where nom = 'refonte')) as secret;
delete from public.webhook_endpoints where id = (select id from pg_temp.cree where nom = 'eteint');
select pg_temp.redevenir_proprietaire();
update public.webhook_deliveries set created_at = now() - interval '31 days'
 where status <> 'pending' or id = (select id from pg_temp.renvoi);
select app.purge_webhook_deliveries();

select ok(
	(select s.decrypted_secret = (select secret from pg_temp.rotation)
	   from public.webhook_endpoints e join vault.decrypted_secrets s on s.id = e.secret_id
	  where e.id = (select id from pg_temp.cree where nom = 'refonte'))
	and not exists (select 1 from vault.decrypted_secrets s
	                 where s.decrypted_secret in (select secret from pg_temp.cree where nom in ('refonte', 'eteint')))
	and not exists (select 1 from public.webhook_deliveries where status <> 'pending')
	and exists (select 1 from public.webhook_deliveries where id = (select id from pg_temp.renvoi))
	and (select string_agg(action || ':' || coalesce(details ->> 'changed', ''), ', ' order by id)
	       from public.audit_log where entity_type = 'webhook' and id > (select id from pg_temp.repere))
	    = 'created:, created:, created:, created:, updated:["secret_id"], deleted:'
	and not exists (select 1 from public.audit_log where entity_type = 'webhook' and id > (select id from pg_temp.repere)
	                   and details::text ~ 'whsec_|recepteur\.example'),
	'30 — le secret régénéré remplace l''ancien, retiré de Vault comme celui du webhook supprimé ; la purge retire les '
	'remises closes de plus de 30 jours, jamais une remise en attente ; le journal dit chaque geste sans adresse ni secret');

select * from finish();
rollback;

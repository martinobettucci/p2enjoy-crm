-- @verifies CRM-072 (docs/BACKLOG.md) — tranche T3 : le volet RGPD d'un contact, export et anonymisation
-- @verifies docs/SPEC-audit.md §7.1 (l'export versionné : contact, organisation, affaires, activités, messages, valeurs
--           de champ ; journalisé sans nom), §7.2 (l'anonymisation : confirmation par le nom, effets, messages intacts —
--           R1 option A —, un contact anonymisé ne se modifie plus mais reste supprimable, l'organisation reste
--           supprimable), §7.3 (le journal ne garde jamais le nom) ; docs/JOURNAL.md décisions 725, 726 et 732
--
-- LES GESTES SONT JOUÉS SOUS LE RÔLE `authenticated` DE CHAQUE PERSONNE : Camille (admin), Driss (business developer),
-- Sabine (superadministratrice, membre d'aucun espace). Le contact éprouvé est créé dans la transaction, avec une
-- adresse qui paraît dans un message ; le `rollback` final rend le seed intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

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

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set sabine '\'5eed0000-0000-4000-8000-000000000018\''
\set contact '\'a0d17000-0000-4000-8000-0000000000c1\''

-- Le contact éprouvé : rattaché à une affaire, participant d'une activité, désigné par un message, rattaché à une
-- organisation créée pour l'occasion.
insert into public.organizations (id, workspace_id, name) values ('a0d17000-0000-4000-8000-0000000000a1', :ws, 'Orga RGPD');
insert into public.contacts (id, workspace_id, organization_id, full_name, email, phone, role_title)
values (:contact, :ws, 'a0d17000-0000-4000-8000-0000000000a1', 'Régis Témoin', 'regis.temoin@exemple.test', '+33 6 00 00 00 00', 'DSI');
insert into public.card_contacts (workspace_id, card_id, contact_id, role)
values (:ws, '5eed0000-0000-4000-8000-0000000000c1', :contact, 'Décideur');
insert into public.mail_messages (workspace_id, rfc822_message_id, classification, from_address, from_name, to_addresses,
                                  subject, body_text, received_at, direction)
values (:ws, '<rgpd-test@exemple.test>', 'unclassified', 'Regis.Temoin@exemple.test', 'Régis Témoin',
        array['commercial@p2enjoy.test'], 'Question RGPD', 'Bonjour, Régis.', now(), 'inbound');

-- =============================================================================================
-- 1. Les objets et leurs droits
-- =============================================================================================

select has_column('public', 'contacts', 'anonymized_at', '1 — contacts.anonymized_at existe');
select ok(has_function_privilege('authenticated', 'public.export_contact(uuid)', 'execute')
	and not has_function_privilege('anon', 'public.export_contact(uuid)', 'execute'),
	'2 — export_contact : authenticated, jamais l''anonyme');
select ok(has_function_privilege('authenticated', 'public.anonymize_contact(uuid, text)', 'execute')
	and not has_function_privilege('anon', 'public.anonymize_contact(uuid, text)', 'execute'),
	'3 — anonymize_contact : authenticated, jamais l''anonyme');

-- =============================================================================================
-- 2. Les gardes
-- =============================================================================================

select pg_temp.endosser(:driss);
select throws_ok($$ select public.export_contact('a0d17000-0000-4000-8000-0000000000c1') $$, '42501', 'reserved_to_admins',
	'4 — un business developer de l''espace : réservé aux administrateurs');
select throws_ok($$ select public.anonymize_contact('a0d17000-0000-4000-8000-0000000000c1', 'Régis Témoin') $$, '42501',
	'reserved_to_admins', '5 — même refus pour l''anonymisation');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:sabine);
select throws_ok($$ select public.export_contact('a0d17000-0000-4000-8000-0000000000c1') $$, 'P0002', 'contact_not_found',
	'6 — hors de l''espace : introuvable, sans dire qu''il existe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:camille);
select throws_ok($$ select public.export_contact('a0d17000-0000-4000-8000-00000000ffff') $$, 'P0002', 'contact_not_found',
	'7 — un identifiant inconnu : introuvable');

-- =============================================================================================
-- 3. L'export — §7.1
-- =============================================================================================

create temporary table pg_temp_export as select public.export_contact('a0d17000-0000-4000-8000-0000000000c1') as e;
select is((select e ->> 'format' from pg_temp_export), 'p2enjoy-crm/contact-export/1', '8 — le format est versionné');
select is((select e -> 'contact' ->> 'email' from pg_temp_export), 'regis.temoin@exemple.test', '9 — le contact entier');
select is((select e -> 'organization' ->> 'name' from pg_temp_export), 'Orga RGPD', '10 — son organisation');
select is((select e -> 'cards' -> 0 ->> 'role' from pg_temp_export), 'Décideur', '11 — ses affaires, avec son rôle');
select is((select jsonb_array_length(e -> 'messages') from pg_temp_export), 1,
	'12 — les messages où son adresse paraît, la casse ignorée');
select is((select e -> 'messages' -> 0 ->> 'subject' from pg_temp_export), 'Question RGPD', '13 — avec leur objet');
select pg_temp.redevenir_proprietaire();
select is((select array[family, action, entity_type, coalesce(entity_label, '∅')] from public.audit_log order by id desc limit 1),
	array['export', 'exported', 'contact', '∅'], '14 — l''export est journalisé, sans le nom du contact');

-- =============================================================================================
-- 4. L'anonymisation — §7.2
-- =============================================================================================

select pg_temp.endosser(:camille);
select throws_ok($$ select public.anonymize_contact('a0d17000-0000-4000-8000-0000000000c1', 'Regis Temoin') $$, '22023',
	'confirmation_mismatch', '15 — le nom retapé diffère : refusé');
select lives_ok($$ select public.anonymize_contact('a0d17000-0000-4000-8000-0000000000c1', 'Régis Témoin') $$,
	'16 — le nom retapé à l''identique : anonymisé');
select pg_temp.redevenir_proprietaire();

select is((select array[full_name, coalesce(email, '∅'), coalesce(phone, '∅'), coalesce(role_title, '∅')]
             from public.contacts where id = :contact),
	array['Contact anonymisé', '∅', '∅', '∅'], '17 — nom, email, téléphone et fonction effacés');
select ok((select anonymized_at is not null from public.contacts where id = :contact), '18 — anonymized_at est posée');
select is((select count(*)::int from public.card_contacts where contact_id = :contact), 1,
	'19 — l''affaire garde ce contact, anonyme');
select is((select from_address from public.mail_messages where rfc822_message_id = '<rgpd-test@exemple.test>'),
	'Regis.Temoin@exemple.test', '20 — R1 option A : les messages restent intacts');
select is((select array[family, action, coalesce(entity_label, '∅')] from public.audit_log order by id desc limit 1),
	array['deletion', 'anonymized', '∅'], '21 — l''anonymisation est journalisée, sans le nom');
select ok(position('Régis' in (select string_agg(coalesce(entity_label, '') || details::text, ' ')
                               from public.audit_log where entity_id = :contact)) = 0,
	'22 — aucune entrée du journal ne garde le nom du contact');

-- =============================================================================================
-- 5. Après l'anonymisation
-- =============================================================================================

select pg_temp.endosser(:camille);
select throws_ok($$ select public.anonymize_contact('a0d17000-0000-4000-8000-0000000000c1', 'Contact anonymisé') $$,
	'P0001', 'contact_anonymized', '23 — une seconde anonymisation est refusée');
select pg_temp.redevenir_proprietaire();
select throws_ok($$ update public.contacts set full_name = 'Régis Témoin' where id = 'a0d17000-0000-4000-8000-0000000000c1' $$,
	'P0001', 'contact_anonymized', '24 — un contact anonymisé ne se modifie plus, propriétaire compris');
select lives_ok($$ delete from public.organizations where id = 'a0d17000-0000-4000-8000-0000000000a1' $$,
	'25 — son organisation reste supprimable : l''organisation passe à null, seule exception');
select lives_ok($$ delete from public.contacts where id = 'a0d17000-0000-4000-8000-0000000000c1' $$,
	'26 — le contact anonymisé reste supprimable');

select * from finish();
rollback;

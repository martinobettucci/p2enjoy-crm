-- @verifies CRM-163 (docs/BACKLOG.md) — le bail de la passe des pastilles : le réveil le prend et appelle ; une passe en
--           cours le garde, et le réveil suivant n'appelle pas ; rendu ou échu, le réveil appelle de nouveau ; rien à
--           évaluer, rien n'est pris ; `release_label_pass` à la clé de service seule, la table fermée aux clients
-- @verifies docs/SPEC-ia.md §16.3 ; docs/SPEC-mail-subsystem.md §31.5 ; docs/SCHEMA.md « Migration `0199` » ; CLAUDE.md §10
--
-- Tout vit dans une transaction annulée : la requête que `pg_net` met en file à chaque réveil part avec elle. Le bail réel
-- — une passe de la minute peut le tenir — est remis à zéro dans la transaction, et rendu tel quel à la fin.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

update app.label_pass_lease set leased_until = null;
-- Un message dû, quel que soit l'état de la file du seed.
insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, subject, body_text, direction)
values ('5eed0000-0000-4000-8000-000000000001', '<t0185-1@sonde.test>', '5eed0000-0000-4000-8000-0000000000c1', 'manual',
        'client@sonde.test', 'Demande de devis', 'Bonjour.', 'inbound');

-- 1. La forme.
select is((select count(*)::integer from app.label_pass_lease), 1, '1 — le bail est une ligne unique');
select ok(not has_table_privilege('authenticated', 'app.label_pass_lease', 'select')
          and not has_table_privilege('anon', 'app.label_pass_lease', 'select')
          and not has_table_privilege('authenticated', 'app.label_pass_lease', 'update'),
	'2 — la table du bail est fermée aux clients');
select ok(not has_function_privilege('authenticated', 'public.release_label_pass()', 'execute')
          and not has_function_privilege('anon', 'public.release_label_pass()', 'execute')
          and has_function_privilege('service_role', 'public.release_label_pass()', 'execute'),
	'3 — `release_label_pass` : la clé de service seule');

-- 2. Le bail pris, gardé, rendu, échu.
select isnt(app.pastilles_reveiller(), null::bigint, '4 — bail libre et évaluation due : le réveil appelle');
select ok((select leased_until >= now() + interval '159 seconds' from app.label_pass_lease),
	'5 — le réveil a pris le bail pour 160 s');
select is(app.pastilles_reveiller(), null::bigint, '6 — une passe en cours garde le bail : le réveil suivant n''appelle pas');

select public.release_label_pass();
select is((select leased_until from app.label_pass_lease), null::timestamptz, '7 — la passe rend le bail');
select isnt(app.pastilles_reveiller(), null::bigint, '8 — rendu, le bail se reprend : le réveil appelle de nouveau');

update app.label_pass_lease set leased_until = now() - interval '1 second';
select isnt(app.pastilles_reveiller(), null::bigint, '9 — échu, le bail se reprend : une passe interrompue ne bloque pas la cadence');

-- 3. Rien à évaluer : le réveil ne prend pas le bail.
select public.release_label_pass();
update public.mail_label_evaluations set next_attempt_at = now() + interval '1 day' where state = 'pending';
select is(app.pastilles_reveiller(), null::bigint, '10 — rien de dû : le réveil n''appelle pas');
select is((select leased_until from app.label_pass_lease), null::timestamptz, '11 — …et ne prend pas le bail');

-- 4. La requête du réveil vise toujours la même adresse (docs/SPEC-ia.md §16.2 : l'adresse ne change pas).
select ok(pg_catalog.pg_get_functiondef('app.pastilles_reveiller()'::regprocedure) like '%http://functions:9000/ia/pastilles/evaluer%',
	'12 — le réveil appelle toujours `ia/pastilles/evaluer` : la voie se choisit dans `main`');

select * from finish();
rollback;

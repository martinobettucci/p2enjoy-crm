-- @verifies CRM-060 tranche 2 (docs/BACKLOG.md) — activation de la règle 3 du classement
-- @verifies docs/SPEC-contacts.md §8 (la suggestion par expéditeur connu : colonnes, algorithme,
--           cas a à h du §8.5)
-- @verifies docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.2 (la chaîne, la règle 3)
-- @verifies CLAUDE.md §10 (une règle se prouve hors interface), §15 (preuves propres)
--
-- CE QUE CETTE SUITE PROUVE.
--
-- 1. Les deux colonnes de la suggestion existent sur `mail_messages` et sont facultatives.
-- 2. La règle 3 SUGGÈRE sans classer : un expéditeur contact rattaché à EXACTEMENT une card active
--    reçoit sa card en `suggested_card_id`, mais le message reste `unclassified`, `card_id` nul, et
--    AUCUN `card_event` n'est écrit.
-- 3. La sémantique « exactement une » : zéro card active n'invente rien, deux se taisent, une
--    suggère. Une card archivée ne compte pas. La casse de l'email est ignorée. Le workspace borne
--    l'appariement (cloisonnement).
-- 4. La règle 3 n'est PAS atteinte quand les règles 1 (adresse) ou 2 (filiation) ont classé : la
--    suggestion reste nulle.
-- 5. `classer_message_automatiquement` reste réservée à `service_role`.
--
-- La suite s'exécute en transaction et fait `rollback` ; les cas mutants sont isolés par des
-- savepoints pour ne pas polluer les suivants. Le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

-- Constantes du seed, mesurées le 2026-08-18 (docs/SPEC-contacts.md §8.5).
--   WS  = 5eed…0001   : le workspace P2Enjoy SAS
--   LEO = …0091        : Léo Marchand, leo.marchand@sogexia.example, une seule card active (…00c2)
--   C2  = …00c2        : « Migration ERP Sogexia », active
--   C1  = …00c1        : une autre card active du workspace (sert au cas « deux cards »)

-- =============================================================================================
-- 1. Les deux colonnes de la suggestion
-- =============================================================================================

select has_column('public', 'mail_messages', 'suggested_card_id',
	'1 — mail_messages porte suggested_card_id : la suggestion a un endroit où vivre');
select has_column('public', 'mail_messages', 'suggested_at',
	'2 — mail_messages porte suggested_at : la suggestion est horodatée');
select col_type_is('public', 'mail_messages', 'suggested_card_id', 'uuid',
	'3 — suggested_card_id est une référence de card (uuid)');
select col_is_null('public', 'mail_messages', 'suggested_card_id',
	'4 — suggested_card_id est FACULTATIF : un message sans suggestion en est dépourvu');

-- =============================================================================================
-- 2. Cas a — expéditeur = un contact à exactement une card active : suggestion, PAS classement
-- =============================================================================================

insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-a>', 'leo.marchand@sogexia.example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000a1', null, null);

select is(
	(select suggested_card_id from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a1'),
	'5eed0000-0000-4000-8000-0000000000c2'::uuid,
	'5 — CAS a : Léo est suggéré vers sa seule card active …00c2');
select is(
	(select classification from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a1'),
	'unclassified',
	'6 — CAS a : le message reste NON CLASSÉ — la règle 3 ne classe pas');
select ok(
	(select card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a1'),
	'7 — CAS a : card_id reste nul — une suggestion n''est pas un rattachement');
select ok(
	(select suggested_at is not null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a1'),
	'8 — CAS a : suggested_at est horodaté');
select is(
	(select count(*) from public.card_events
	  where card_id = '5eed0000-0000-4000-8000-0000000000c2'
	    and type = 'mail_received'
	    and payload->>'message_id' = 'aaaa0000-0000-4000-8000-0000000000a1'),
	0::bigint,
	'9 — CAS a : AUCUN card_event n''est écrit — suggérer n''entre rien dans la timeline');

-- =============================================================================================
-- 3. Cas b — la casse de l'email est ignorée
-- =============================================================================================

insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-b>', 'LEO.MARCHAND@Sogexia.Example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000b1', null, null);
select is(
	(select suggested_card_id from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000b1'),
	'5eed0000-0000-4000-8000-0000000000c2'::uuid,
	'10 — CAS b : la casse est ignorée, même suggestion');

-- =============================================================================================
-- 4. Cas c — expéditeur inconnu : aucune suggestion
-- =============================================================================================

insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-c>', 'inconnu@nulle-part.test');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000c1', null, null);
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000c1'),
	'11 — CAS c : un expéditeur qui n''est aucun contact ne suggère rien');

-- =============================================================================================
-- 5. Cas d — la seule card du contact est archivée : zéro card ACTIVE, aucune suggestion
-- =============================================================================================

savepoint cas_d;
update public.cards set archived_at = now() where id = '5eed0000-0000-4000-8000-0000000000c2';
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000d1', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-d>', 'leo.marchand@sogexia.example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000d1', null, null);
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000d1'),
	'12 — CAS d : une card archivée ne compte pas — aucune suggestion vers un dossier fermé');
rollback to savepoint cas_d;

-- =============================================================================================
-- 6. Cas e — le contact est rattaché à DEUX cards actives : ambiguïté, aucune suggestion
-- =============================================================================================

savepoint cas_e;
insert into public.card_contacts (workspace_id, card_id, contact_id)
values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-0000000000c1',
        '5eed0000-0000-4000-8000-000000000091');
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000e1', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-e>', 'leo.marchand@sogexia.example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000e1', null, null);
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000e1'),
	'13 — CAS e : deux cards actives, on se tait plutôt que de choisir au hasard');
rollback to savepoint cas_e;

-- =============================================================================================
-- 7. Cas f — cloisonnement : le même expéditeur, mais dans un AUTRE workspace, ne suggère rien
-- =============================================================================================
--
-- Le contact de Léo appartient au workspace A. Un message identique, posté dans un workspace B,
-- ne doit PAS hériter de sa suggestion : le prédicat filtre `ct.workspace_id = message.workspace_id`.

savepoint cas_f;
insert into public.workspaces (id, name, slug)
values ('bbbb0000-0000-4000-8000-0000000000f0', 'Workspace B (test)', 'ws-b-test');
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000f1', 'bbbb0000-0000-4000-8000-0000000000f0',
        '<regle3-f>', 'leo.marchand@sogexia.example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000f1', null, null);
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000f1'),
	'14 — CAS f : le contact d''un autre workspace ne fuit pas — le workspace borne l''appariement');
rollback to savepoint cas_f;

-- =============================================================================================
-- 8. Cas g — la règle 1 classe : la règle 3 n'est pas atteinte
-- =============================================================================================
--
-- L'adresse de la card …00c2 figure dans les destinataires ET l'expéditeur est Léo. La règle 1
-- classe `auto`, et la chaîne s'arrête : aucune suggestion.

insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address, to_addresses)
values ('aaaa0000-0000-4000-8000-0000000000a7'::uuid, '5eed0000-0000-4000-8000-000000000001',
        '<regle3-g>', 'leo.marchand@sogexia.example',
        array[(select c.email_local_part || '@' || w.inbound_domain
                 from public.cards c join public.workspaces w on w.id = c.workspace_id
                where c.id = '5eed0000-0000-4000-8000-0000000000c2')]);
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000a7'::uuid, null, null);
select is(
	(select classification from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a7'::uuid),
	'auto',
	'15 — CAS g : une adresse de card classe le message (règle 1)');
select is(
	(select card_id from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a7'::uuid),
	'5eed0000-0000-4000-8000-0000000000c2'::uuid,
	'16 — CAS g : classé vers la card de la règle 1');
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000a7'::uuid),
	'17 — CAS g : la règle 3 n''est pas atteinte — aucune suggestion sur un message déjà classé');

-- =============================================================================================
-- 9. Cas h — la règle 2 classe (filiation) : la règle 3 n'est pas atteinte
-- =============================================================================================

savepoint cas_h;
-- Un parent déjà classé vers la card active …00c1.
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address, classification, card_id)
values ('aaaa0000-0000-4000-8000-0000000000b7', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-parent-h>', 'quelqu-un@ailleurs.test', 'auto', '5eed0000-0000-4000-8000-0000000000c1');
-- L'enfant, de Léo, répond au parent : la filiation classe avant que la règle 3 ne joue.
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000c7', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-enfant-h>', 'leo.marchand@sogexia.example');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000c7', '<regle3-parent-h>', null);
select is(
	(select card_id from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000c7'),
	'5eed0000-0000-4000-8000-0000000000c1'::uuid,
	'18 — CAS h : la filiation classe l''enfant vers la card du parent (règle 2)');
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000c7'),
	'19 — CAS h : la règle 3 n''est pas atteinte — aucune suggestion');
rollback to savepoint cas_h;

-- =============================================================================================
-- 10. Déterminisme : un second passage qui n'a plus « exactement une » card EFFACE la suggestion
-- =============================================================================================
--
-- Le message a du dans le cas a — mais il a été inséré dans le tronc, hors savepoint. On repart
-- d'un message neuf pour ne rien supposer de l'ordre.

savepoint cas_det;
insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address)
values ('aaaa0000-0000-4000-8000-0000000000d2', '5eed0000-0000-4000-8000-000000000001',
        '<regle3-det>', 'leo.marchand@sogexia.example');
-- Premier passage : une seule card active → suggestion …00c2.
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000d2', null, null);
-- L'état change : Léo gagne une seconde card active. Second passage → la suggestion s'EFFACE.
insert into public.card_contacts (workspace_id, card_id, contact_id)
values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-0000000000c1',
        '5eed0000-0000-4000-8000-000000000091');
select public.classer_message_automatiquement('aaaa0000-0000-4000-8000-0000000000d2', null, null);
select ok(
	(select suggested_card_id is null from public.mail_messages where id = 'aaaa0000-0000-4000-8000-0000000000d2'),
	'20 — DÉTERMINISME : un second passage devenu ambigu efface la suggestion, il ne la fige pas');
rollback to savepoint cas_det;

-- =============================================================================================
-- 11. Le classement automatique reste un constat de la relève
-- =============================================================================================

select is(
	has_function_privilege('authenticated',
		'public.classer_message_automatiquement(uuid, text, text[])', 'execute'),
	false,
	'21 — le classement automatique n''est pas offert au client : réservé à service_role');

select * from finish();
rollback;

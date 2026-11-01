-- @verifies CRM-055 (docs/BACKLOG.md) — tranche INC-326 : une pièce jointe hérite de l'affaire de son message — à
--           l'insertion sans affaire (message classé, message non classé), une affaire posée gardée, le rattrapage de
--           l'existant, l'invariant « aucune pièce ne diffère de son message »
-- @verifies docs/SCHEMA.md « Migration `0142` » ; docs/JOURNAL.md décision 795 ; docs/INCONSISTENCY_REPORT.md INC-326
--
-- Les pièces de la preuve sont posées sur deux messages du seed : le courrier reçu « Dossier de consultation — monitoring
-- Vertuo », classé par la règle 1 (docs/SPEC-seed.md §35), et un courrier reçu non classé. Le `rollback` final rend la base
-- intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

create temp table pg_temp.messages (role text primary key, id uuid);
insert into pg_temp.messages values
	('classe', (select m.id from public.mail_messages m where m.rfc822_message_id = '<seed-pieces-jointes@p2enjoy.test>')),
	('non_classe', (select m.id from public.mail_messages m
	                 where m.card_id is null and m.direction = 'inbound' order by m.received_at, m.id limit 1));

-- Une pièce de la preuve, sur le message du rôle donné, avec ou sans affaire posée.
create or replace function pg_temp.piece(p_role text, p_nom text, p_card uuid default null) returns uuid language plpgsql as $$
declare
	v_message uuid := (select id from pg_temp.messages where role = p_role);
	v_empreinte text := encode(extensions.digest(p_nom, 'sha256'), 'hex');
	v_id uuid;
begin
	insert into public.mail_attachments (message_id, card_id, filename, mime_type, size_bytes, storage_path, sha256, av_status)
	values (v_message, p_card, p_nom, 'text/plain', 10,
	        '5eed0000-0000-4000-8000-000000000001/' || v_message::text || '/' || v_empreinte, v_empreinte, 'clean')
	returning id into v_id;
	return v_id;
end;
$$;

select ok(
	(select m.card_id from public.mail_messages m where m.id = (select id from pg_temp.messages where role = 'classe')) is not null
	and (select id from pg_temp.messages where role = 'non_classe') is not null,
	'0 — le seed porte un courrier reçu classé (§35) et un courrier reçu non classé');

-- 1. Le déclencheur
select has_trigger('public', 'mail_attachments', 'mail_attachments_card_from_message',
	'1 — le déclencheur `mail_attachments_card_from_message` existe sur `mail_attachments`');

-- Les pièces sont inscrites D'ABORD, puis relues : une fonction volatile appelée dans un `where` le serait par ligne, et
-- la requête ne verrait pas ses propres insertions.
create temp table pg_temp.ids (nom text primary key, id uuid);
insert into pg_temp.ids values
	('classe', pg_temp.piece('classe', 'tst-inc326-classe.txt')),
	('non_classe', pg_temp.piece('non_classe', 'tst-inc326-non-classe.txt')),
	('posee', pg_temp.piece('classe', 'tst-inc326-posee.txt',
	                        (select m.card_id from public.mail_messages m where m.id = (select id from pg_temp.messages where role = 'classe'))));

select is(
	(select a.card_id from public.mail_attachments a where a.id = (select id from pg_temp.ids where nom = 'classe')),
	(select m.card_id from public.mail_messages m where m.id = (select id from pg_temp.messages where role = 'classe')),
	'2 — une pièce insérée sans affaire sur un message classé prend l''affaire du message');

select ok(
	exists (select 1 from public.mail_attachments a where a.id = (select id from pg_temp.ids where nom = 'non_classe') and a.card_id is null),
	'3 — une pièce insérée sur un message non classé existe, et reste sans affaire');

select is(
	(select a.card_id from public.mail_attachments a where a.id = (select id from pg_temp.ids where nom = 'posee')),
	(select m.card_id from public.mail_messages m where m.id = (select id from pg_temp.messages where role = 'classe')),
	'4 — une pièce insérée avec son affaire la garde (l''archive d''un envoi, 0106)');

-- 2. Le rattrapage et l'invariant — mesurés sur la base telle que le seed l'a écrite : ses pièces reçues sont inscrites
-- APRÈS le classement de leur message, si bien que, sans la migration, elles naissent sans affaire.
select is(
	(select count(*)::int from public.mail_attachments a
	   join pg_temp.messages p on p.id = a.message_id and p.role = 'classe'
	  where a.filename not like 'tst-inc326-%' and a.card_id is null),
	0,
	'5 — les cinq pièces du courrier classé du seed portent l''affaire de leur message');

select is(
	(select count(*)::int from public.mail_attachments a join public.mail_messages m on m.id = a.message_id
	  where a.card_id is distinct from m.card_id),
	0,
	'6 — aucune pièce de la base ne diffère de son message sur l''affaire');

select * from finish();
rollback;

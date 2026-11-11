-- @verifies CRM-140 (docs/BACKLOG.md) — tranche T1 : la colonne `content_id` des pièces, sa borne, et la RLS de la pièce
--           inchangée : qui ne voit pas le message ne lit pas le `Content-ID` de sa pièce ; `authenticated` ne l'écrit pas
-- @verifies docs/SPEC-mail-subsystem.md §30.6, §30.11 (ligne « pgTAP ») ; docs/SCHEMA.md « Migration `0179` » ;
--           docs/JOURNAL.md décisions 881 et 918 ; CLAUDE.md §10
--
-- La pièce de la preuve est posée sur « Candidature spontanée », le non classé du seed (§18.7), lisible par Camille, qui
-- administre, et invisible à Farida, lectrice (§18.1). Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

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

create temp table pg_temp.preuve (cle text primary key, id uuid);
grant select on pg_temp.preuve to authenticated;
insert into pg_temp.preuve (cle, id)
select 'message', m.id from public.mail_messages m where m.subject = 'Candidature spontanée' limit 1;

insert into public.mail_attachments (message_id, filename, mime_type, size_bytes, storage_path, sha256, av_status, content_id)
select p.id, 'tst-crm140-logo.png', 'image/png', 4,
       '5eed0000-0000-4000-8000-000000000001/' || p.id::text || '/' || encode(extensions.digest('tst-crm140', 'sha256'), 'hex'),
       encode(extensions.digest('tst-crm140', 'sha256'), 'hex'), 'clean', 'Logo@P2enjoy'
from pg_temp.preuve p where p.cle = 'message';
insert into pg_temp.preuve (cle, id) select 'piece', a.id from public.mail_attachments a where a.filename = 'tst-crm140-logo.png';

-- La borne, éprouvée sur une copie de la pièce : l'état SQL du refus, ou « accepté ».
create or replace function pg_temp.borne(p_valeur text) returns text language plpgsql as $$
declare v_etat text;
begin
	begin
		update public.mail_attachments set content_id = p_valeur where id = (select id from pg_temp.preuve where cle = 'piece');
		v_etat := 'accepté';
		raise exception using errcode = 'P0001';
	exception when sqlstate 'P0001' then return v_etat;
	when others then get stacked diagnostics v_etat = returned_sqlstate; return v_etat;
	end;
end;
$$;

-- 1 à 3. La colonne et sa borne
select col_type_is('public', 'mail_attachments', 'content_id', 'text', '1 — `content_id` est un texte');
select col_is_null('public', 'mail_attachments', 'content_id', '2 — `content_id` est facultatif : une pièce relevée avant n''en a pas');
select is(
	(select array[
		(select count(*) from pg_constraint where conname = 'mail_attachments_content_id_borne')::text,
		pg_temp.borne(''), pg_temp.borne(repeat('x', 256)), pg_temp.borne(repeat('x', 255))]),
	array['1', '23514', '23514', 'accepté'],
	'3 — la contrainte nommée refuse un identifiant vide et un de 256 caractères, accepte 255');

-- 4 à 6. La RLS de la pièce, inchangée
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select content_id from public.mail_attachments where id = (select id from pg_temp.preuve where cle = 'piece')),
	'Logo@P2enjoy',
	'4 — Camille, qui voit le message, lit le `Content-ID` tel que le message l''a écrit');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.mail_messages where id = (select id from pg_temp.preuve where cle = 'message')),
	0,
	'5 — prémisse : Farida, lectrice, ne voit pas le non classé');
select is(
	(select count(*)::int from public.mail_attachments where id = (select id from pg_temp.preuve where cle = 'piece')),
	0,
	'6 — Farida ne lit ni la pièce ni son `Content-ID`');
select pg_temp.redevenir_proprietaire();

-- 7 à 9. Personne d'autre que le service ne l'écrit
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$ update public.mail_attachments set content_id = 'pirate' where id = (select id from pg_temp.preuve where cle = 'piece') $$,
	'42501', null,
	'7 — même une administratrice ne réécrit pas le `Content-ID` d''une pièce');
select pg_temp.redevenir_proprietaire();
select is(
	(select content_id from public.mail_attachments where id = (select id from pg_temp.preuve where cle = 'piece')),
	'Logo@P2enjoy',
	'8 — la valeur est restée celle du message');
select ok(
	not has_column_privilege('authenticated', 'public.mail_attachments', 'content_id', 'INSERT'),
	'9 — `authenticated` n''insère pas de pièce, `content_id` compris');

select * from finish();
rollback;

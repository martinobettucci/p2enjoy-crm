-- @verifies CRM-074 (docs/BACKLOG.md) — tranche T1 : le texte extrait des pièces jointes en base — l'éligibilité, le
--           déclencheur (seule une pièce saine et d'un type retenu passe `pending`), les contraintes, la prise avec son bail,
--           le résultat et ses trois essais, les privilèges, la lecture sous la RLS de la pièce
-- @verifies docs/SPEC-pieces-jointes.md §3, §4.3, §7 ; docs/JOURNAL.md décisions 788 et 789 ; CLAUDE.md §10
--
-- Les pièces de la preuve sont posées sur le message envoyé du seed qui porte `proposition-monitoring.txt` (affaire
-- « Refonte du monitoring — Vertuo »), donc lisible par Camille. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Une pièce de la preuve : nom, type, statut antivirus ; l'empreinte se dérive du nom pour rester unique.
create or replace function pg_temp.piece(p_nom text, p_type text, p_av text) returns uuid language plpgsql as $$
declare
	v_message uuid := (select a.message_id from public.mail_attachments a where a.filename = 'proposition-monitoring.txt' limit 1);
	v_empreinte text := encode(extensions.digest(p_nom, 'sha256'), 'hex');
	v_id uuid;
begin
	insert into public.mail_attachments (message_id, filename, mime_type, size_bytes, storage_path, sha256, av_status)
	values (v_message, p_nom, p_type, 10, '5eed0000-0000-4000-8000-000000000001/' || v_message::text || '/' || v_empreinte,
	        v_empreinte, p_av)
	returning id into v_id;
	return v_id;
end;
$$;

grant execute on function pg_temp.piece(text, text, text) to service_role;

select ok(
	(select a.message_id from public.mail_attachments a where a.filename = 'proposition-monitoring.txt' limit 1) is not null,
	'0 — le message porteur du seed existe (proposition-monitoring.txt)');

-- 1. L'éligibilité — §3
select ok(
	app.attachment_text_eligible('application/pdf', 'devis.pdf')
	and app.attachment_text_eligible('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a')
	and app.attachment_text_eligible('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a')
	and app.attachment_text_eligible('application/vnd.oasis.opendocument.text', 'a')
	and app.attachment_text_eligible('application/vnd.oasis.opendocument.spreadsheet', 'a')
	and app.attachment_text_eligible('Application/PDF; name=x', 'x'),
	'1 — le PDF, Word, Excel et OpenDocument sont retenus, quelle que soit la casse du type');
select ok(
	app.attachment_text_eligible('application/zip', 'Bilan.DOCX')
	and app.attachment_text_eligible('application/octet-stream', 'tableau.ods')
	and not app.attachment_text_eligible('application/zip', 'archive.zip')
	and not app.attachment_text_eligible('text/plain', 'faux.pdf')
	and not app.attachment_text_eligible('image/png', 'photo.png')
	and not app.attachment_text_eligible('application/msword', 'ancien.doc')
	and not app.attachment_text_eligible(null, null),
	'2 — un type générique est retenu par l''extension ; un type précis non retenu ne l''est jamais par l''extension');

-- 2. Le déclencheur
create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to service_role, authenticated;
insert into pg_temp.ids values
	('pdf_sain', pg_temp.piece('tst-crm074-sain.pdf', 'application/pdf', 'clean')),
	('texte_sain', pg_temp.piece('tst-crm074-note.txt', 'text/plain', 'clean')),
	('pdf_attente', pg_temp.piece('tst-crm074-attente.pdf', 'application/pdf', 'pending')),
	('pdf_infecte', pg_temp.piece('tst-crm074-infecte.pdf', 'application/pdf', 'infected'));

select is(
	(select array_agg(coalesce(a.text_status, '∅') order by i.nom) from pg_temp.ids i join public.mail_attachments a on a.id = i.id),
	array['∅', '∅', 'pending', '∅'],
	'3 — à l''insertion, seul le PDF sain passe `pending` ; ni le texte brut, ni une pièce en analyse, ni une pièce infectée');

update public.mail_attachments set av_status = 'clean' where id = (select id from pg_temp.ids where nom = 'pdf_attente');
select is((select text_status from public.mail_attachments where id = (select id from pg_temp.ids where nom = 'pdf_attente')),
	'pending', '4 — une pièce qui devient saine après l''analyse passe `pending`');

-- 3. Les contraintes
select throws_ok(
	$$ update public.mail_attachments set text_status = 'extracted'
	    where id = (select id from pg_temp.ids where nom = 'pdf_sain') $$,
	'23514', null, '5 — `extracted` sans texte est refusé');
select throws_ok(
	$$ update public.mail_attachments set text_status = 'pending'
	    where id = (select id from pg_temp.ids where nom = 'pdf_infecte') $$,
	'23514', null, '6 — une pièce non saine ne peut pas être à extraire');
select throws_ok(
	$$ update public.mail_attachments set text_status = 'done'
	    where id = (select id from pg_temp.ids where nom = 'pdf_sain') $$,
	'23514', null, '7 — un statut hors de la liste fermée est refusé');

-- 4. Les privilèges — §7
select ok(
	has_function_privilege('service_role', 'public.claim_attachment_texts(integer)', 'EXECUTE')
	and has_function_privilege('service_role', 'public.record_attachment_text(uuid, text, text, boolean)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.claim_attachment_texts(integer)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.record_attachment_text(uuid, text, text, boolean)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.claim_attachment_texts(integer)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.record_attachment_text(uuid, text, text, boolean)', 'EXECUTE'),
	'8 — la prise et le résultat sont à la clé de service seule');
select ok(
	not has_column_privilege('authenticated', 'public.mail_attachments', 'extracted_text', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.mail_attachments', 'text_status', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.mail_attachments', 'extracted_text', 'INSERT'),
	'9 — `authenticated` ne peut écrire ni le texte ni son statut');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$ select * from public.claim_attachment_texts(5) $$, '42501', null,
	'10 — refus direct : une administratrice ne peut pas prendre une extraction');
select throws_ok(
	$$ select public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_sain'), 'extracted', 'falsifié') $$,
	'42501', null, '11 — refus direct : une administratrice ne peut pas écrire un texte');
reset role;

-- 5. La prise — §3 : bail, essai compté, borne
set local role service_role;
create temp table pg_temp.prises as select * from public.claim_attachment_texts(10);
select ok(
	(select count(*) from pg_temp.prises where attachment_id in (select id from pg_temp.ids where nom in ('pdf_sain', 'pdf_attente'))) = 2
	and (select bool_and(attempt = 1) from pg_temp.prises where attachment_id in (select id from pg_temp.ids)),
	'12 — la prise rend les deux pièces à extraire, au premier essai, avec leur chemin de stockage');
select is(
	(select count(*) from public.claim_attachment_texts(10) where attachment_id in (select id from pg_temp.ids)), 0::bigint,
	'13 — une pièce prise ne se reprend pas pendant son bail');

-- 6. Le résultat — §3, §4.3
select is(public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_sain'), 'extracted', '  Devis n° 42  '),
	'extracted', '14 — un texte rendu est inscrit');
reset role;
select is((select extracted_text || '|' || text_truncated::text from public.mail_attachments where id = (select id from pg_temp.ids where nom = 'pdf_sain')),
	'Devis n° 42|false', '15 — le texte est gardé sans ses blancs de bord, non tronqué');

set local role service_role;
select throws_ok(
	$$ select public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_sain'), 'extracted', 'encore') $$,
	'PGRST', null, '16 — une pièce déjà rendue ne se réécrit pas');
select throws_ok(
	$$ select public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_attente'), 'parfait') $$,
	'22023', null, '17 — un statut de résultat inconnu est refusé');
select is(public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_attente'), 'retry'),
	'pending', '18 — une erreur passagère au premier essai rend la pièce `pending`, sous bail');
reset role;

-- Le troisième essai clôt ; un troisième essai abandonné (bail échu sans résultat) passe `failed` à la prise suivante.
update public.mail_attachments set text_attempts = 3 where id = (select id from pg_temp.ids where nom = 'pdf_attente');
set local role service_role;
select is(public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_attente'), 'retry'),
	'failed', '19 — une erreur au troisième essai clôt la pièce en `failed`');
reset role;
update public.mail_attachments set text_status = 'pending', text_attempts = 3, text_claimed_at = now() - interval '16 minutes'
 where id = (select id from pg_temp.ids where nom = 'pdf_attente');
set local role service_role;
select is(
	(select count(*) from public.claim_attachment_texts(10) where attachment_id = (select id from pg_temp.ids where nom = 'pdf_attente')),
	0::bigint, '20 — un troisième essai abandonné n''est pas repris…');
reset role;
select is((select text_status from public.mail_attachments where id = (select id from pg_temp.ids where nom = 'pdf_attente')),
	'failed', '21 — … il passe `failed`');

-- 7. La lecture sous la RLS de la pièce, et un texte trop long coupé à la borne
update public.mail_attachments set text_status = 'pending', text_claimed_at = now()
 where id = (select id from pg_temp.ids where nom = 'pdf_attente');
set local role service_role;
select public.record_attachment_text((select id from pg_temp.ids where nom = 'pdf_attente'), 'extracted', repeat('a', 200001));
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.lu_camille as
	select id, char_length(extracted_text) as longueur, text_truncated from public.mail_attachments
	 where id in (select id from pg_temp.ids where nom in ('pdf_sain', 'pdf_attente'));
reset role;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
create temp table pg_temp.lu_sabine as
	select id from public.mail_attachments where id in (select id from pg_temp.ids);
reset role;
select ok(
	(select count(*) from pg_temp.lu_camille) = 2
	and (select longueur = 200000 and text_truncated from pg_temp.lu_camille where id = (select id from pg_temp.ids where nom = 'pdf_attente'))
	and (select count(*) from pg_temp.lu_sabine) = 0,
	'22 — Camille lit le texte des pièces de son espace (le trop long coupé à 200 000 et marqué) ; une personne hors de l''espace ne lit rien');

select * from finish();
rollback;

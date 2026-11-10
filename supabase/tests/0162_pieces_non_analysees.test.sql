-- @verifies CRM-143 (docs/BACKLOG.md) — tranche T1 : la confirmation d'une pièce non analysée, la règle du téléchargement
--           qui la lit, la reprise réservée au service, les pièces d'un mail préparé
-- @verifies docs/SPEC-pieces-jointes.md §17.3, §17.5, §17.6, §17.9 (preuves pgTAP) ; docs/SCHEMA.md « Migration `0173` » ;
--           docs/JOURNAL.md décisions 889 et 892 ; CLAUDE.md §10 (la base décide)
--
-- Les pièces de la preuve sont posées sur le message du seed qui porte `proposition-monitoring.txt`, lisible par Camille
-- et par Driss. La règle du téléchargement est éprouvée sur la fonction que la politique du bucket appelle (`0029`) ; le
-- téléchargement réel, par l'API de stockage, est prouvé par `e2e/api/pieces-non-analysees.spec.ts`. Le `rollback` final
-- rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.refus(p_sql text) returns text[] language plpgsql as $$
declare
	v_etat text; v_message text; v_detail text;
begin
	execute p_sql;
	return array['aucun refus'];
exception when others then
	get stacked diagnostics v_etat = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
	return array[v_etat, v_message, v_detail];
end;
$$;
grant execute on function pg_temp.refus(text) to authenticated, service_role;

create or replace function pg_temp.camille() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;

-- Une pièce de la preuve : nom, statut, raison, âge.
create or replace function pg_temp.piece(p_nom text, p_av text, p_raison text, p_age interval default '0') returns uuid
language plpgsql as $$
declare
	v_message uuid := (select a.message_id from public.mail_attachments a where a.filename = 'proposition-monitoring.txt' limit 1);
	v_empreinte text := encode(extensions.digest(p_nom, 'sha256'), 'hex');
	v_id uuid;
begin
	insert into public.mail_attachments (message_id, filename, mime_type, size_bytes, storage_path, sha256, av_status,
	                                     av_skip_reason, created_at)
	values (v_message, p_nom, 'application/pdf', 10,
	        '5eed0000-0000-4000-8000-000000000001/' || v_message::text || '/' || v_empreinte,
	        v_empreinte, p_av, p_raison, now() - p_age)
	returning id into v_id;
	return v_id;
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid, chemin text);
grant select on pg_temp.ids to authenticated, service_role;
insert into pg_temp.ids (nom, id) values
	('sain',          pg_temp.piece('tst-crm143-sain.pdf', 'clean', null)),
	('infecte',       pg_temp.piece('tst-crm143-infecte.pdf', 'infected', null)),
	('sans_antivirus', pg_temp.piece('tst-crm143-muet.pdf', 'skipped', 'scanner_unavailable')),
	('trop_lourde',   pg_temp.piece('tst-crm143-lourde.pdf', 'skipped', 'too_large')),
	('attente_jeune', pg_temp.piece('tst-crm143-jeune.pdf', 'pending', null)),
	('attente_vieille', pg_temp.piece('tst-crm143-vieille.pdf', 'pending', null, interval '20 minutes'));
update pg_temp.ids i set chemin = a.storage_path from public.mail_attachments a where a.id = i.id;

create or replace function pg_temp.id(p_nom text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p_nom $$;
create or replace function pg_temp.chemin(p_nom text) returns text language sql stable as $$ select chemin from pg_temp.ids where nom = p_nom $$;
grant execute on function pg_temp.id(text), pg_temp.chemin(text) to authenticated, service_role;

-- 1. La raison d'un `skipped`
insert into pg_temp.ids (nom, id) values ('sans_raison', pg_temp.piece('tst-crm143-sans-raison.pdf', 'skipped', null));
select is(
	(select av_skip_reason from public.mail_attachments where id = pg_temp.id('sans_raison')),
	'too_large',
	'1 — un `skipped` écrit sans raison reçoit la raison constatée : sans objet déposé, `too_large`');
select throws_ok(
	$$ update public.mail_attachments set av_skip_reason = 'inconnue' where id = pg_temp.id('trop_lourde') $$,
	'23514', null, '2 — une raison hors des deux valeurs est refusée');

-- 2. Les droits
select ok(
	has_function_privilege('authenticated', 'public.acknowledge_unscanned_attachment(uuid)', 'execute')
	and not has_function_privilege('anon', 'public.acknowledge_unscanned_attachment(uuid)', 'execute'),
	'3 — la confirmation est à `authenticated`, jamais à `anon`');
select ok(
	not has_function_privilege('authenticated', 'public.mail_attachments_to_rescan(integer)', 'execute')
	and not has_function_privilege('authenticated', 'public.mail_attachment_record_scan(uuid, text)', 'execute')
	and not has_function_privilege('anon', 'public.mail_attachment_record_scan(uuid, text)', 'execute')
	and has_function_privilege('service_role', 'public.mail_attachment_record_scan(uuid, text)', 'execute'),
	'4 — la reprise est à la clé de service seule');
select ok(
	not has_table_privilege('authenticated', 'public.mail_attachment_risk_acknowledgments', 'insert')
	and not has_table_privilege('anon', 'public.mail_attachment_risk_acknowledgments', 'select'),
	'5 — personne n''écrit une confirmation directement, et l''anonyme ne la lit pas');

-- 3. Avant toute confirmation, seule la pièce saine se télécharge
select pg_temp.endosser(pg_temp.driss());
select is(
	array[app.piece_jointe_telechargeable(pg_temp.chemin('sain')), app.piece_jointe_telechargeable(pg_temp.chemin('sans_antivirus')),
	      app.piece_jointe_telechargeable(pg_temp.chemin('attente_vieille')), app.piece_jointe_telechargeable(pg_temp.chemin('infecte'))],
	array[true, false, false, false],
	'6 — sans confirmation : la pièce saine seule, ni la non analysée, ni l''attente ancienne, ni l''infectée');

-- 4. Les refus de la confirmation
select is((pg_temp.refus($$ select public.acknowledge_unscanned_attachment(pg_temp.id('infecte')) $$))[2],
	'attachment_infected', '7 — une pièce infectée ne se confirme jamais');
select is((pg_temp.refus($$ select public.acknowledge_unscanned_attachment(pg_temp.id('sain')) $$))[2],
	'attachment_clean', '8 — une pièce saine n''a rien à confirmer');
select is((pg_temp.refus($$ select public.acknowledge_unscanned_attachment(pg_temp.id('trop_lourde')) $$))[2],
	'attachment_not_stored', '9 — une pièce trop volumineuse n''a pas été conservée');
select is((pg_temp.refus($$ select public.acknowledge_unscanned_attachment(pg_temp.id('attente_jeune')) $$))[2],
	'attachment_scanning', '10 — une analyse en cours depuis moins de quinze minutes n''est pas une panne');
select is(pg_temp.refus($$ select public.acknowledge_unscanned_attachment('c1430000-0000-4000-8000-0000000000ff') $$),
	array['PGRST', '{"code": "P0002", "message": "attachment_not_found"}', '{"status": 404, "headers": {}}'],
	'11 — une pièce inconnue rend 404, comme une pièce d''un message invisible');

-- 5. La confirmation, et ce qu'elle ouvre
select isnt(public.acknowledge_unscanned_attachment(pg_temp.id('sans_antivirus')), null,
	'12 — Driss confirme la pièce non analysée');
select is(public.acknowledge_unscanned_attachment(pg_temp.id('sans_antivirus')),
	(select acknowledged_at from public.mail_attachment_risk_acknowledgments
	  where attachment_id = pg_temp.id('sans_antivirus') and user_id = pg_temp.driss()),
	'13 — une seconde confirmation rend la date de la première');
select ok(app.piece_jointe_telechargeable(pg_temp.chemin('sans_antivirus')),
	'14 — la pièce confirmée se télécharge pour Driss');
select isnt(public.acknowledge_unscanned_attachment(pg_temp.id('attente_vieille')), null,
	'15 — une attente de plus de quinze minutes se confirme');
select ok(app.piece_jointe_telechargeable(pg_temp.chemin('attente_vieille')),
	'16 — et se télécharge alors');
select is((select count(*)::int from public.mail_attachment_risk_acknowledgments), 2,
	'17 — Driss lit ses deux confirmations, et elles seules');
reset role;

select pg_temp.endosser(pg_temp.camille());
select ok(not app.piece_jointe_telechargeable(pg_temp.chemin('sans_antivirus')),
	'18 — la confirmation de Driss n''ouvre rien à Camille');
select is((select count(*)::int from public.mail_attachment_risk_acknowledgments), 0,
	'19 — Camille ne lit pas les confirmations de Driss');
reset role;

-- 6. La reprise
set local role service_role;
select ok(
	(select array_agg(id) from public.mail_attachments_to_rescan(100))
	@> array[pg_temp.id('sans_antivirus'), pg_temp.id('attente_vieille')]
	and not (select array_agg(id) from public.mail_attachments_to_rescan(100))
	&& array[pg_temp.id('sain'), pg_temp.id('infecte'), pg_temp.id('trop_lourde'), pg_temp.id('attente_jeune')],
	'20 — la reprise rend les non analysées, ni les jugées, ni la trop volumineuse, ni l''attente jeune');
select public.mail_attachment_record_scan(pg_temp.id('sans_antivirus'), 'infected');
select public.mail_attachment_record_scan(pg_temp.id('sain'), 'infected');
reset role;
select is(
	array[(select av_status from public.mail_attachments where id = pg_temp.id('sans_antivirus')),
	      (select av_status from public.mail_attachments where id = pg_temp.id('sain'))],
	array['infected', 'clean'],
	'21 — le verdict s''écrit sur une pièce non analysée, jamais sur une pièce déjà jugée');

select pg_temp.endosser(pg_temp.driss());
select ok(not app.piece_jointe_telechargeable(pg_temp.chemin('sans_antivirus')),
	'22 — devenue infectée, la pièce confirmée par Driss ne se télécharge plus');
reset role;

-- 7. Les pièces d'un mail préparé
select has_function('public', 'prepare_email',
	array['uuid', 'text[]', 'text', 'text', 'uuid', 'text[]', 'text[]', 'uuid', 'jsonb'],
	'23 — `prepare_email` porte `p_attachments`');
select hasnt_function('public', 'prepare_email', array['uuid', 'text[]', 'text', 'text', 'uuid', 'text[]', 'text[]', 'uuid'],
	'24 — l''ancienne signature est retirée : PostgREST ne départage pas deux surcharges');

select * from finish();

rollback;

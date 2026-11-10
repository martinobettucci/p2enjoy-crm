-- @verifies CRM-144 (docs/BACKLOG.md) — tranche T1 : l'outbox — annuler un envoi en file et réessayer un échec, chaque refus
--           nommé, l'issue incertaine refusée, qui exerce les gestes, l'événement `mail_cancelled`, l'adresse d'expédition
--           gardée, la purge qui épargne un échec ; et, d'une seule connexion, ce que la course exige : un envoi annulé n'est
--           jamais réservé, un envoi réservé n'est jamais annulé
-- @verifies INC-354 (docs/INCONSISTENCY_REPORT.md) — la branche du quota de `reserver_envois` ne fait plus échouer la passe
-- @verifies docs/SPEC-mail-subsystem.md §28.2 à §28.5, §28.11 (preuves pgTAP) ; docs/SCHEMA.md « Migration `0176` » ;
--           docs/JOURNAL.md décisions 898 et 906 ; CLAUDE.md §10 (la base décide)
--
-- Les envois de la preuve sont posés sur « Refonte du site vitrine » (`…c1`), que Camille (administratrice) et Driss
-- (business developer) écrivent, et que la lectrice ne lit pas. Tout vit dans la transaction de la preuve, défaite par le
-- `rollback` final. Les deux ordres du verrou, à deux connexions, sont prouvés par `scripts/verify-outbox-course.sh`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

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
create or replace function pg_temp.refus(p_sql text) returns text[] language plpgsql as $$
declare
	v_etat text; v_message text;
begin
	execute p_sql;
	return array['aucun refus'];
exception when others then
	get stacked diagnostics v_etat = returned_sqlstate, v_message = message_text;
	return array[v_etat, v_message];
end;
$$;
grant execute on function pg_temp.refus(text) to authenticated;

create or replace function pg_temp.camille() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.carte() returns uuid language sql immutable as $$ select '5eed0000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.refus_http(p_code text) returns text[] language sql immutable as $$
	select array['PGRST', json_build_object('code', 'P0002', 'message', p_code)::jsonb::text]
$$;

-- Un envoi de la preuve, posé tel qu'il serait dans la file : auteur, état, motif.
create or replace function pg_temp.envoi(p_auteur uuid, p_status text, p_motif text default null) returns uuid
language plpgsql as $$
declare
	v_id uuid;
begin
	insert into public.mail_outbox (workspace_id, identity_id, card_id, to_addrs, subject, body_text, status, last_error,
	                                created_by, next_attempt_at)
	values ('5eed0000-0000-4000-8000-000000000001',
	        (select i.id from public.mail_outbound_identities i where i.owner_id = p_auteur order by i.created_at limit 1),
	        pg_temp.carte(), array['client@exterieur.test'], 'Preuve CRM-144 ' || p_status, 'Corps de la preuve.',
	        p_status, p_motif, p_auteur, now() + interval '1 day')
	returning id into v_id;
	return v_id;
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select on pg_temp.ids to authenticated;
insert into pg_temp.ids values
	('driss_file', pg_temp.envoi(pg_temp.driss(), 'queued')),
	('driss_file_2', pg_temp.envoi(pg_temp.driss(), 'queued')),
	('camille_file', pg_temp.envoi(pg_temp.camille(), 'queued')),
	('envoi_en_cours', pg_temp.envoi(pg_temp.driss(), 'sending')),
	('parti', pg_temp.envoi(pg_temp.driss(), 'sent')),
	('echec', pg_temp.envoi(pg_temp.driss(), 'failed', 'auth_failed')),
	('echec_quota', pg_temp.envoi(pg_temp.driss(), 'failed', 'quota_exceeded')),
	('incertain', pg_temp.envoi(pg_temp.driss(), 'queued', 'worker_interrompu'));
create or replace function pg_temp.id(p_nom text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p_nom $$;
grant execute on function pg_temp.id(text) to authenticated;

-- =============================================================================================
-- 1. Le schéma et l'adresse d'expédition (§28.2)
-- =============================================================================================

select has_column('public', 'mail_outbox', 'from_address', '1 — `mail_outbox.from_address` existe');
select is((select from_address from public.mail_outbox where id = pg_temp.id('driss_file')),
          (select i.from_address from public.mail_outbound_identities i where i.owner_id = pg_temp.driss()
            order by i.created_at limit 1),
	'2 — le déclencheur pose l''adresse de l''identité à la mise en file');
select is((select count(*) from public.mail_outbox where from_address is null), 0::bigint,
	'3 — la reprise : aucun envoi sans adresse d''expédition');
select ok(not has_function_privilege('anon', 'public.cancel_outbound_email(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.retry_outbound_email(uuid)', 'execute'),
	'4 — l''anonyme n''exécute aucun des deux gestes');

-- =============================================================================================
-- 2. Qui exerce les gestes — décision 906, Q1
-- =============================================================================================

select pg_temp.endosser(pg_temp.driss());
select ok((select public.outbox_gestes_permis(o) from public.mail_outbox o where o.id = pg_temp.id('driss_file')),
	'5 — Driss, auteur, peut annuler son envoi');
select ok(not (select public.outbox_gestes_permis(o) from public.mail_outbox o where o.id = pg_temp.id('camille_file')),
	'6 — Driss, ni auteur ni administrateur, ne peut pas annuler l''envoi de Camille');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('camille_file'))),
	array['42501', 'forbidden'],
	'7 — et la base le refuse : `forbidden`');

-- =============================================================================================
-- 3. Annuler (§28.3)
-- =============================================================================================

select isnt(public.cancel_outbound_email(pg_temp.id('driss_file')), null,
	'8 — Driss annule son envoi en file, et la date en est rendue');
select pg_temp.redevenir_proprietaire();
select is((select status || ':' || cancelled_by::text from public.mail_outbox where id = pg_temp.id('driss_file')),
	'cancelled:' || pg_temp.driss()::text,
	'9 — l''envoi est `cancelled`, signé par Driss');
select is((select count(*) from public.card_events e
            where e.type = 'mail_cancelled' and e.payload ->> 'outbox_id' = pg_temp.id('driss_file')::text
              and e.actor_id = pg_temp.driss() and e.card_id = pg_temp.carte()), 1::bigint,
	'10 — le fil de l''affaire garde « Envoi annulé », Driss pour acteur (décision 906, Q2)');

select pg_temp.endosser(pg_temp.camille());
select isnt(public.cancel_outbound_email(pg_temp.id('driss_file_2')), null,
	'11 — Camille, administratrice, annule l''envoi de Driss (décision 906, Q1)');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('driss_file'))),
	pg_temp.refus_http('outbox_cancelled'), '12 — déjà annulé : `outbox_cancelled`');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('envoi_en_cours'))),
	pg_temp.refus_http('outbox_sending'), '13 — en cours d''envoi : `outbox_sending`');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('parti'))),
	pg_temp.refus_http('outbox_sent'), '14 — déjà parti : `outbox_sent`');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('echec'))),
	pg_temp.refus_http('outbox_failed'), '15 — en échec : `outbox_failed`');
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('incertain'))),
	pg_temp.refus_http('outbox_uncertain'), '16 — issue incertaine : `outbox_uncertain` (décision 906, Q3)');
select pg_temp.redevenir_proprietaire();
select is((select status from public.mail_outbox where id = pg_temp.id('incertain')), 'queued',
	'17 — et l''envoi incertain reste en file : rien n''est dit « annulé »');
select is((select status from public.mail_outbox where id = pg_temp.id('envoi_en_cours')), 'sending',
	'18 — l''envoi en cours n''est pas touché');

-- La lectrice ne lit pas l'affaire : l'envoi n'existe pas pour elle, et un récapitulatif quotidien non plus.
select pg_temp.endosser((select m.user_id from public.workspace_members m
                          where m.workspace_id = '5eed0000-0000-4000-8000-000000000001' and m.role = 'viewer' limit 1));
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)', pg_temp.id('camille_file'))),
	pg_temp.refus_http('outbox_not_found'), '19 — la lectrice : `outbox_not_found`, sans distinguer l''interdit');
select is(pg_temp.refus(format('select public.retry_outbound_email(%L)', pg_temp.id('echec'))),
	pg_temp.refus_http('outbox_not_found'), '20 — ni réessayer');
select is((select count(*) from public.mail_outbox where id = pg_temp.id('camille_file')), 0::bigint,
	'21 — et elle ne lit pas l''envoi (RLS inchangée)');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(pg_temp.camille());
select is(pg_temp.refus(format('select public.cancel_outbound_email(%L)',
	(select o.id from public.mail_outbox o where o.kind = 'digest' order by o.created_at limit 1))),
	pg_temp.refus_http('outbox_not_found'), '22 — un récapitulatif quotidien est hors de l''outbox : `outbox_not_found`');
select is(pg_temp.refus($$ select public.cancel_outbound_email('c1440000-0000-4000-8000-0000000000ff') $$),
	pg_temp.refus_http('outbox_not_found'), '23 — un envoi inconnu : `outbox_not_found`');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. Réessayer (§28.4)
-- =============================================================================================

select pg_temp.endosser(pg_temp.driss());
select is(public.retry_outbound_email(pg_temp.id('echec')), pg_temp.id('echec'),
	'24 — Driss réessaie son échec');
select pg_temp.redevenir_proprietaire();
select is((select status || ':' || coalesce(last_error, '-') || ':' || (next_attempt_at <= now())::text
             from public.mail_outbox where id = pg_temp.id('echec')),
	'queued:-:true', '25 — en file, motif effacé, au prochain passage');
select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(format('select public.retry_outbound_email(%L)', pg_temp.id('echec'))),
	pg_temp.refus_http('outbox_queued'), '26 — réessayer un envoi en file : `outbox_queued`');
select is(pg_temp.refus(format('select public.retry_outbound_email(%L)', pg_temp.id('parti'))),
	pg_temp.refus_http('outbox_sent'), '27 — réessayer un envoi parti : `outbox_sent`');
select is(pg_temp.refus(format('select public.retry_outbound_email(%L)', pg_temp.id('driss_file'))),
	pg_temp.refus_http('outbox_cancelled'), '28 — réessayer un envoi annulé : `outbox_cancelled`');
select pg_temp.redevenir_proprietaire();

-- Le quota de l'identité, compté comme à la mise en file.
update public.mail_outbound_identities set daily_quota = 0
 where id = (select identity_id from public.mail_outbox where id = pg_temp.id('echec_quota'));
select pg_temp.endosser(pg_temp.driss());
select is(pg_temp.refus(format('select public.retry_outbound_email(%L)', pg_temp.id('echec_quota'))),
	array['23505', 'quota_exceeded'], '29 — le quota atteint : `quota_exceeded`');
select pg_temp.redevenir_proprietaire();
select is((select status from public.mail_outbox where id = pg_temp.id('echec_quota')), 'failed',
	'30 — et l''échec reste un échec');

-- =============================================================================================
-- 5. La passe d'envoi ne prend jamais un envoi annulé (§28.5, dans une seule connexion)
-- =============================================================================================

update public.mail_outbox set next_attempt_at = now() - interval '1 minute', created_at = '2000-01-01'
 where id = pg_temp.id('driss_file');
select is((select count(*) from public.reserver_envois(100) r where r.outbox_id = pg_temp.id('driss_file')), 0::bigint,
	'31 — un envoi annulé, même échu et le plus ancien, n''est jamais réservé');
-- INC-354 : la même passe rencontre l'échec réessayé du n° 24, échu, sur l'identité au quota atteint (n° 29). Elle ne doit
-- pas échouer en entier : cet envoi seul passe `failed`, avec son motif.
select is((select status || ':' || last_error from public.mail_outbox where id = pg_temp.id('echec')), 'failed:quota_exceeded',
	'34 — INC-354 : un envoi échu au quota atteint passe `failed` (`quota_exceeded`), et la passe n''échoue pas');
select is((select attempts from public.mail_outbox where id = pg_temp.id('echec')), 1,
	'35 — INC-354 : et son compte d''essais avance d''un');

-- =============================================================================================
-- 6. La purge épargne les pièces d'un échec (§28.4)
-- =============================================================================================

insert into storage.objects (bucket_id, name, owner, created_at, metadata)
values ('mail-outbound-attachments', 'preuve-crm144/echec.pdf', pg_temp.driss(), now() - interval '2 days', '{"size": 10}'),
       ('mail-outbound-attachments', 'preuve-crm144/annule.pdf', pg_temp.driss(), now() - interval '2 days', '{"size": 10}');
update public.mail_outbox set status = 'failed', attachments = '[{"path": "preuve-crm144/echec.pdf"}]'::jsonb
 where id = pg_temp.id('echec_quota');
update public.mail_outbox set attachments = '[{"path": "preuve-crm144/annule.pdf"}]'::jsonb
 where id = pg_temp.id('driss_file_2');
select ok(not exists (select 1 from public.depots_envoi_abandonnes() d where d.name = 'preuve-crm144/echec.pdf'),
	'32 — la pièce d''un échec est épargnée : un nouvel essai la trouvera');
select ok(exists (select 1 from public.depots_envoi_abandonnes() d where d.name = 'preuve-crm144/annule.pdf'),
	'33 — celle d''un envoi annulé redevient purgeable');

-- =============================================================================================
-- 7. LA COURSE à deux connexions — prouvée hors de pgTAP (§28.5)
-- =============================================================================================
--
-- Une preuve pgTAP vit dans une transaction, qu'une seconde connexion ne voit pas ; et `dblink` exige un mot de passe, le
-- rôle `postgres` de l'image n'étant pas superutilisateur — aucun secret n'entre dans une preuve versionnée. Les deux ordres
-- du verrou sont donc joués pas à pas par `scripts/verify-outbox-course.sh`, deux sessions `psql` réelles dans le conteneur
-- de la base, et la course en parallèle par l'intégration pytest du connecteur. Ici : les invariants d'une seule connexion
-- (n° 8, 13, 16 à 18, 31).

select * from finish();
rollback;

-- @verifies CRM-143 (docs/BACKLOG.md) — l'assertion 6 vise la signature de `prepare_email` qui porte `p_attachments`
--           (migration 0173, docs/SPEC-pieces-jointes.md §17.6)
-- @verifies CRM-128 (docs/BACKLOG.md) — tranche T2 : les mails préparés en base, et le refus de tout envoi direct sous
--           le jeton du connecteur MCP
-- @verifies docs/SPEC-mails-prepares.md §3.1 à §3.5 (table, droits, `prepare_email`, `send_email_draft`,
--           `discard_email_draft`), §4.1 à §4.3 (`app.via_connector`, la garde des deux files, le recensement des voies
--           d'envoi, les relances automatiques) ; docs/SCHEMA.md « Migration `0162` » ; docs/JOURNAL.md décision 829
--
-- LE JETON DU CONNECTEUR EST IMITÉ PAR SES REVENDICATIONS, `canal` et `iss`, comme `mcp/crm_mcp/jeton_interne.py` les
-- frappe. Le jeton réellement frappé par le connecteur est éprouvé par l'intégration de T3, contre PostgREST.

begin;

create extension if not exists pgtap with schema extensions;

select plan(44);

create or replace function pg_temp.endosser(utilisateur uuid, revendications jsonb default '{}')
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		(jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated') || revendications)::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

create temporary table pg_temp_ref (nom text primary key, valeur text);
grant all on pg_temp_ref to authenticated, service_role;
insert into pg_temp_ref values
	('camille', '5eed0000-0000-4000-8000-000000000011'),
	('driss', '5eed0000-0000-4000-8000-000000000012'),
	('lectrice', '5eed0000-0000-4000-8000-000000000013'),
	('affaire', '5eed0000-0000-4000-8000-0000000000c1');
insert into pg_temp_ref
select 'identite', id::text from public.mail_outbound_identities where owner_id = '5eed0000-0000-4000-8000-000000000011';
insert into pg_temp_ref
select 'identite_driss', id::text from public.mail_outbound_identities where owner_id = '5eed0000-0000-4000-8000-000000000012';
insert into pg_temp_ref
select 'message', id::text from public.mail_messages where card_id = '5eed0000-0000-4000-8000-0000000000c1' limit 1;
insert into pg_temp_ref
select 'message_ailleurs', id::text from public.mail_messages
 where card_id is not null and card_id <> '5eed0000-0000-4000-8000-0000000000c1' limit 1;

create or replace function pg_temp.ref(n text) returns text language sql as $$
	select valeur from pg_temp_ref where nom = n;
$$;

select ok((select count(*) from pg_temp_ref where valeur is not null) = 8,
	'1 — TÉMOIN : le seed fournit les deux identités et les deux messages employés');

-- =============================================================================================
-- 1. Le modèle et les droits — §3.1, §3.2
-- =============================================================================================

select has_table('public', 'mail_drafts', '2 — la table des mails préparés existe');
select is((select relrowsecurity from pg_class where oid = 'public.mail_drafts'::regclass), true,
	'3 — la RLS est active');
select ok(has_table_privilege('authenticated', 'public.mail_drafts', 'select')
          and not has_table_privilege('authenticated', 'public.mail_drafts', 'insert')
          and not has_table_privilege('authenticated', 'public.mail_drafts', 'update')
          and not has_table_privilege('authenticated', 'public.mail_drafts', 'delete'),
	'4 — `authenticated` lit seulement : toute écriture passe par les fonctions');
select ok(not has_table_privilege('anon', 'public.mail_drafts', 'select'), '5 — `anon` n''a rien');
-- RÉVISÉE PAR `CRM-143` (migration 0173, docs/SPEC-pieces-jointes.md §17.6) : `prepare_email` gagne `p_attachments`, et
-- l'ancienne signature est retirée. L'assertion vise la nouvelle, non relâchée.
select ok(not has_function_privilege('anon', 'public.prepare_email(uuid,text[],text,text,uuid,text[],text[],uuid,jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.send_email_draft(uuid,uuid,text[],text,text,text[],text[],jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.discard_email_draft(uuid)', 'execute'),
	'6 — `anon` n''exécute aucune des trois fonctions');

-- =============================================================================================
-- 2. Reconnaître le connecteur — §4.1
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
select is(app.via_connector(), false, '7 — un jeton de session n''est pas le connecteur');
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"canal": "mcp"}');
select is(app.via_connector(), true, '8 — `canal = mcp` suffit');
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/mcp"}');
select is(app.via_connector(), true, '9 — `iss = p2enjoy-crm/mcp` suffit');
select pg_temp.redevenir_proprietaire();
select is(app.via_connector(), false, '10 — sans jeton (pg_cron, clé de service), ce n''est pas le connecteur');

-- =============================================================================================
-- 3. Préparer — §3.3
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/mcp", "canal": "mcp"}');

select lives_ok(
	format($$insert into pg_temp_ref select 'brouillon', public.prepare_email(%L, array['client@exterieur.test'],
		'Bonjour, voici notre proposition.', 'Proposition', %L, array['copie@exterieur.test'], '{}', %L)::text$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite'), pg_temp.ref('message')),
	'11 — le connecteur prépare un mail sur une affaire que Camille écrit, en réponse à un message de cette affaire');
select is((select count(*)::int from public.mail_outbox where body_text like 'Bonjour, voici notre proposition.%'), 0,
	'12 — RIEN N''EST ENVOYÉ : aucune ligne dans la file d''envoi');
select results_eq(
	format($$select status, origin, card_id::text, created_by::text, to_addrs, cc_addrs, in_reply_to_message_id::text
	           from public.mail_drafts where id = %L$$, pg_temp.ref('brouillon')),
	format($$values ('pending', 'mcp', %L, %L, array['client@exterieur.test'], array['copie@exterieur.test'], %L)$$,
		pg_temp.ref('affaire'), pg_temp.ref('camille'), pg_temp.ref('message')),
	'13 — le mail préparé est en attente, d''origine `mcp`, à Camille, rattaché à son affaire');

select throws_ok(
	format($$select public.prepare_email(%L, array['a@exterieur.test'], 'C.', 'O', %L)$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite_driss')),
	'42501', 'identity_not_available', '14 — l''identité de Driss ne s''emprunte pas');
select throws_ok(
	format($$select public.prepare_email(%L, array['a@exterieur.test'], 'C.', 'O', null, '{}', '{}', %L)$$,
		pg_temp.ref('affaire'), pg_temp.ref('message_ailleurs')),
	'23514', 'reply_outside_card', '15 — une réponse à un message d''une autre affaire est refusée');
select throws_ok(
	format($$select public.prepare_email(%L, '{}'::text[], 'C.')$$, pg_temp.ref('affaire')),
	'23514', 'recipient_required', '16 — un destinataire au moins');
select throws_ok(
	format($$select public.prepare_email(%L, array['a@exterieur.test'], '')$$, pg_temp.ref('affaire')),
	'23514', 'body_required', '17 — un corps non vide');
select throws_ok(
	$$select public.prepare_email('00000000-0000-4000-8000-000000000000', array['a@exterieur.test'], 'C.')$$,
	'42501', 'forbidden', '18 — une affaire inconnue rend le refus d''écriture');

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
insert into pg_temp_ref select 'web',
	public.prepare_email(pg_temp.ref('affaire')::uuid, array['b@exterieur.test'], 'Préparé dans le CRM.')::text;
select is((select origin from public.mail_drafts where id = pg_temp.ref('web')::uuid),
	'web', '19 — sous un jeton de session, l''origine est `web`');

select pg_temp.endosser(pg_temp.ref('lectrice')::uuid, '{"canal": "mcp"}');
select throws_ok(
	format($$select public.prepare_email(%L, array['a@exterieur.test'], 'C.')$$, pg_temp.ref('affaire')),
	'42501', 'forbidden', '20 — la lectrice n''écrit pas l''affaire : elle ne prépare rien');

-- La borne des 200 : 199 de plus pour Camille, posés par la clé de service, puis un deux-centième refusé.
select pg_temp.redevenir_proprietaire();
insert into public.mail_drafts (workspace_id, card_id, to_addrs, body_text, origin, created_by)
select '5eed0000-0000-4000-8000-000000000001', pg_temp.ref('affaire')::uuid, array['n@exterieur.test'], 'Lot.', 'mcp',
       pg_temp.ref('camille')::uuid
  from generate_series(1, 200 - (select count(*)::int from public.mail_drafts
                                  where created_by = pg_temp.ref('camille')::uuid and status = 'pending'));
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"canal": "mcp"}');
select throws_ok(
	format($$select public.prepare_email(%L, array['a@exterieur.test'], 'C.')$$, pg_temp.ref('affaire')),
	'23514', 'draft_limit_reached', '21 — au-delà de 200 mails en attente, la préparation est refusée');
select pg_temp.redevenir_proprietaire();
delete from public.mail_drafts where body_text = 'Lot.';

-- =============================================================================================
-- 4. La personne seule — §3.2
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid);
select is((select count(*)::int from public.mail_drafts where id = pg_temp.ref('brouillon')::uuid), 1,
	'22 — Camille lit son mail préparé');
select pg_temp.endosser(pg_temp.ref('driss')::uuid);
select is((select count(*)::int from public.mail_drafts where id = pg_temp.ref('brouillon')::uuid), 0,
	'23 — Driss ne le lit pas');
select throws_ok(format($$select public.discard_email_draft(%L)$$, pg_temp.ref('brouillon')),
	'PGRST', '{"code": "P0002", "message": "draft_not_found"}', '24 — ni ne l''écarte : 404, comme un mail absent');
select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['a@exterieur.test'], 'C.')$$,
		pg_temp.ref('brouillon'), pg_temp.ref('identite_driss')),
	'PGRST', '{"code": "P0002", "message": "draft_not_found"}', '25 — ni ne l''envoie');
select throws_ok(
	$$select public.discard_email_draft('00000000-0000-4000-8000-000000000000')$$,
	'PGRST', '{"code": "P0002", "message": "draft_not_found"}', '26 — un mail absent rend le même 404');

-- =============================================================================================
-- 5. Aucun détournement — §4.2
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/mcp", "canal": "mcp"}');
select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['client@exterieur.test'], 'Corps.')$$,
		pg_temp.ref('brouillon'), pg_temp.ref('identite')),
	'42501', 'review_required', '27 — le connecteur n''envoie pas un mail préparé, même le sien');
select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'O', 'Envoi direct.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'42501', 'review_required', '28 — le connecteur n''envoie pas directement, tous les autres contrôles passés');
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"canal": "mcp"}');
select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'O', 'Envoi direct.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'42501', 'review_required', '29 — `canal = mcp` seul suffit à refuser');
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/mcp"}');
select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'O', 'Envoi direct.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'42501', 'review_required', '30 — `iss = p2enjoy-crm/mcp` seul suffit à refuser');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.mail_outbox where body_text like 'Envoi direct.%'), 0,
	'31 — aucune ligne écrite par les tentatives');

-- La garde est un DÉCLENCHEUR : même le propriétaire de la table, sous le jeton du connecteur, n'écrit pas.
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"canal": "mcp"}');
reset role;
select throws_ok(
	format($$insert into public.card_sequence_enrollments (workspace_id, card_id, placement_id, sequence_id, identity_id)
	         select '5eed0000-0000-4000-8000-000000000001', %L, p.id, '5e900000-0000-4000-8000-000000000001', %L
	           from public.card_placements p where p.card_id = %L limit 1$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite'), pg_temp.ref('affaire')),
	'42501', 'review_required', '32 — armer une cadence sous le jeton du connecteur est refusé à l''insertion');
select throws_ok(
	format($$select app.mail_outbox_inserer('5eed0000-0000-4000-8000-000000000001', %L, %L, null,
	         array['x@exterieur.test'], '{}', 'O', 'Par la porte interne.', null, %L)$$,
		pg_temp.ref('identite'), pg_temp.ref('affaire'), pg_temp.ref('camille')),
	'42501', 'review_required', '33 — la porte interne de la file est fermée de même');
select pg_temp.redevenir_proprietaire();

-- LE RECENSEMENT (§4.2) : toute fonction exécutable par `authenticated` dont le corps écrit l'une des deux files est
-- rangée ici. Une fonction nouvelle fait échouer la preuve jusqu'à ce qu'elle soit lue et rangée.
select set_eq(
	$$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname in ('public', 'app')
	     and has_function_privilege('authenticated', p.oid, 'execute')
	     and p.prokind = 'f'
	     and (pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.(mail_outbox|card_sequence_enrollments)'
	          or pg_get_functiondef(p.oid) ~* 'app\.mail_outbox_inserer\s*\(')
	     and p.proname <> 'mail_outbox_inserer'$$,
	array['queue_outbound_email', 'armer_sequence_relance'],
	'34 — seules `queue_outbound_email` et `armer_sequence_relance` écrivent une file pour un jeton de personne');

-- =============================================================================================
-- 6. Envoyer et écarter depuis l'interface — §3.4, §3.5
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
select lives_ok(
	format($$insert into pg_temp_ref select 'envoi', public.send_email_draft(%L, %L, array['client@exterieur.test'],
		'Bonjour, voici notre proposition, relue.', 'Proposition relue', array['copie@exterieur.test'])::text$$,
		pg_temp.ref('brouillon'), pg_temp.ref('identite')),
	'35 — Camille, depuis le CRM, envoie le mail relu');
select pg_temp.redevenir_proprietaire();
select results_eq(
	format($$select subject, card_id::text, in_reply_to_message_id::text, status from public.mail_outbox where id = %L$$,
		pg_temp.ref('envoi')),
	format($$values ('Proposition relue', %L, %L, 'queued')$$, pg_temp.ref('affaire'), pg_temp.ref('message')),
	'36 — CE QUI PART EST CE QUI A ÉTÉ RELU : l''objet du formulaire, l''affaire et la réponse du mail préparé');
select ok((select body_text like 'Bonjour, voici notre proposition, relue.%' from public.mail_outbox
            where id = pg_temp.ref('envoi')::uuid), '37 — le corps relu, signé par la porte habituelle');
select results_eq(
	format($$select status, outbox_id::text, sent_at is not null from public.mail_drafts where id = %L$$,
		pg_temp.ref('brouillon')),
	format($$values ('sent', %L, true)$$, pg_temp.ref('envoi')),
	'38 — le mail préparé est marqué envoyé, avec son envoi');

select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['client@exterieur.test'], 'Encore.')$$,
		pg_temp.ref('brouillon'), pg_temp.ref('identite')),
	'23514', 'draft_not_pending', '39 — un mail déjà envoyé ne repart pas');

-- Écarter, par le connecteur : permis.
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"canal": "mcp"}');
insert into pg_temp_ref select 'a_ecarter',
	public.prepare_email(pg_temp.ref('affaire')::uuid, array['c@exterieur.test'], 'À écarter.')::text;
select lives_ok(format($$select public.discard_email_draft(%L)$$, pg_temp.ref('a_ecarter')),
	'40 — le connecteur écarte un mail qu''il a préparé');
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['c@exterieur.test'], 'À écarter.')$$,
		pg_temp.ref('a_ecarter'), pg_temp.ref('identite')),
	'23514', 'draft_not_pending', '41 — un mail écarté pendant la relecture ne part pas');
select pg_temp.redevenir_proprietaire();
select results_eq(
	format($$select status, discarded_at is not null from public.mail_drafts where id = %L$$, pg_temp.ref('a_ecarter')),
	$$values ('discarded', true)$$, '42 — le mail écarté le reste, daté');

-- Un refus de l'envoi laisse le mail en attente.
select pg_temp.endosser(pg_temp.ref('camille')::uuid, '{"iss": "p2enjoy-crm/session"}');
insert into pg_temp_ref select 'refuse',
	public.prepare_email(pg_temp.ref('affaire')::uuid, array['d@exterieur.test'], 'Refusé.')::text;
select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['d@exterieur.test'], 'Refusé.')$$,
		pg_temp.ref('refuse'), pg_temp.ref('identite_driss')),
	'42501', 'identity_not_available', '43 — l''envoi applique la règle d''emprunt, et son refus remonte tel quel');
select pg_temp.redevenir_proprietaire();
select is((select status from public.mail_drafts where id = pg_temp.ref('refuse')::uuid), 'pending',
	'44 — après le refus, le mail reste en attente');

select * from finish();
rollback;

-- @verifies CRM-157 (docs/BACKLOG.md) — tranche T1 : sans domaine d'adresses d'affaire, l'envoi d'une personne, la mise en
--           file d'un mail préparé et l'armement d'une relance sont refusés par `workspace_reply_domain_missing` ; l'ordre
--           des contrôles est gardé ; une relance due ferme son inscription sans rien mettre en file ; rien ne change avec
--           un domaine
-- @verifies docs/SPEC-mail-subsystem.md §33.2, §33.2 bis, §33.7 ; docs/SPEC-modeles-emails.md §12.7 ; docs/SCHEMA.md
--           « Migration `0192` » ; docs/JOURNAL.md décisions 951, 953 et 955
--
-- LE MONTAGE VIDE LE DOMAINE DE L'ESPACE DU SEED, DANS LA TRANSACTION DE LA PREUVE, QUI EST ANNULÉE : le seed garde son
-- espace unique (`CRM-005`, docs/SPEC-mail-subsystem.md §33.6). Chaque refus est précédé du témoin de son montage.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated', 'iss', 'p2enjoy-crm/session')::text, true);
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
	('espace', '5eed0000-0000-4000-8000-000000000001'),
	('camille', '5eed0000-0000-4000-8000-000000000011'),
	-- « Refonte du site vitrine », que Camille écrit.
	('affaire', '5eed0000-0000-4000-8000-0000000000c1'),
	-- « Refonte intranet Ville de Lyon », figée depuis trente-cinq jours dans le seed, sans message entrant.
	('figee', '5eed0000-0000-4000-8000-0000000000c4'),
	('sequence', '5e900000-0000-4000-8000-000000000001');
insert into pg_temp_ref
select 'identite', id::text from public.mail_outbound_identities
 where owner_id = '5eed0000-0000-4000-8000-000000000011' and is_default;

create or replace function pg_temp.ref(n text) returns text language sql as $$
	select valeur from pg_temp_ref where nom = n;
$$;

-- =============================================================================================
-- 1. Le montage — docs/SPEC-mail-subsystem.md §33.6
-- =============================================================================================

select ok(
	(select inbound_domain from public.workspaces where id = pg_temp.ref('espace')::uuid) is not null
	and pg_temp.ref('identite') is not null
	and exists (select 1 from public.cards_figees() f where f.card_id = pg_temp.ref('figee')::uuid),
	'1 — TÉMOIN : l''espace du seed a son domaine, Camille son identité, l''affaire c4 est figée');

select ok(
	pg_get_constraintdef((select oid from pg_constraint
	                       where conname = 'card_sequence_enrollments_motif_borne'))
		like '%workspace_reply_domain_missing%',
	'2 — la sixième fin est admise par `card_sequence_enrollments_motif_borne` (§12.7)');

-- Une inscription ACTIVE et DUE sur la figée, posée en propriétaire (le job, seul, l'écrit d'ordinaire) : armée il y a
-- cent jours, son premier palier (trois jours) est échu. Aucun message entrant ne la ferme par `reply`.
insert into public.card_sequence_enrollments (workspace_id, card_id, placement_id, sequence_id, identity_id, armed_at)
values (pg_temp.ref('espace')::uuid, pg_temp.ref('figee')::uuid, app.card_first_placement(pg_temp.ref('figee')::uuid),
        pg_temp.ref('sequence')::uuid, pg_temp.ref('identite')::uuid, now() - interval '100 days');
insert into pg_temp_ref
select 'inscription', id::text from public.card_sequence_enrollments
 where card_id = pg_temp.ref('figee')::uuid and status = 'active';

-- Un mail préparé par Camille, à mettre en file une fois le domaine retiré.
select pg_temp.endosser(pg_temp.ref('camille')::uuid);
insert into pg_temp_ref select 'brouillon',
	public.prepare_email(pg_temp.ref('affaire')::uuid, array['client@exterieur.test'], 'Préparé pour la preuve.')::text;
select pg_temp.redevenir_proprietaire();

insert into pg_temp_ref select 'file_avant', count(*)::text from public.mail_outbox;

update public.workspaces set inbound_domain = null where id = pg_temp.ref('espace')::uuid;
select is((select inbound_domain from public.workspaces where id = pg_temp.ref('espace')::uuid), null,
	'3 — TÉMOIN : l''espace n''a plus de domaine (dans la transaction de la preuve)');

-- =============================================================================================
-- 2. Les refus nommés — §33.2
-- =============================================================================================

select pg_temp.endosser(pg_temp.ref('camille')::uuid);

select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'Objet', 'Corps.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'23514', 'workspace_reply_domain_missing',
	'4 — l''envoi d''une personne est refusé par le nom du domaine absent, plus par `card_not_available`');

select throws_ok(
	format($$select public.send_email_draft(%L, %L, array['client@exterieur.test'], 'Corps relu.')$$,
		pg_temp.ref('brouillon'), pg_temp.ref('identite')),
	'23514', 'workspace_reply_domain_missing',
	'5 — la mise en file d''un mail préparé porte le même refus, par `queue_outbound_email`');

select is((select status from public.mail_drafts where id = pg_temp.ref('brouillon')::uuid), 'pending',
	'6 — le mail préparé reste en attente : rien n''est perdu');

select throws_ok(
	format($$select public.armer_sequence_relance(app.card_first_placement(%L), %L, %L)$$,
		pg_temp.ref('figee'), pg_temp.ref('sequence'), pg_temp.ref('identite')),
	'23514', 'workspace_reply_domain_missing',
	'7 — armer une relance est refusé par le même nom');

-- L'ORDRE DES CONTRÔLES EST GARDÉ : la cause la plus proche de la personne d'abord.
select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'Objet', '')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'23514', 'workspace_reply_domain_missing',
	'8 — le domaine se dit avant le corps vide : un geste de la personne ne le réglerait pas');

select pg_temp.redevenir_proprietaire();
update public.cards set deleted_at = now() where id = pg_temp.ref('affaire')::uuid;
select pg_temp.endosser(pg_temp.ref('camille')::uuid);
select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'Objet', 'Corps.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'23514', 'card_not_available',
	'9 — une affaire en corbeille dans un espace sans domaine reste `card_not_available`');
select pg_temp.redevenir_proprietaire();
update public.cards set deleted_at = null where id = pg_temp.ref('affaire')::uuid;

select is((select count(*)::text from public.mail_outbox), pg_temp.ref('file_avant'),
	'10 — aucun refus n''a écrit dans la file d''envoi');

-- =============================================================================================
-- 3. La relance due — §33.2 bis, décision 955
-- =============================================================================================

select lives_ok($$select app.executer_sequences_relance()$$,
	'11 — le passage du job aboutit : une inscription sans domaine ne le fait pas échouer');

select results_eq(
	format($$select status, closed_reason from public.card_sequence_enrollments where id = %L$$, pg_temp.ref('inscription')),
	$$values ('closed'::text, 'workspace_reply_domain_missing'::text)$$,
	'12 — l''inscription due est fermée par `workspace_reply_domain_missing`');

select is((select count(*)::int from public.mail_outbox where card_id = pg_temp.ref('figee')::uuid
                                                       and created_at >= now()), 0,
	'13 — rien n''est mis en file pour elle : aucun destinataire nul');

-- `unnest`, et non `@> array[null]` : une comparaison avec `null` n'est jamais vraie, et l'inclusion ne le verrait pas.
select is((select count(*)::int from public.mail_outbox o cross join lateral unnest(o.to_addrs) a(adresse)
            where a.adresse is null), 0,
	'14 — aucune ligne de la file ne porte un destinataire nul');

-- =============================================================================================
-- 4. Avec un domaine, rien ne change — §33.2
-- =============================================================================================

update public.workspaces set inbound_domain = 'crm.p2enjoy.test' where id = pg_temp.ref('espace')::uuid;
select pg_temp.endosser(pg_temp.ref('camille')::uuid);

select lives_ok(
	format($$select public.queue_outbound_email(%L, %L, array['client@exterieur.test'], 'Objet', 'Corps.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'15 — avec un domaine, l''envoi est mis en file comme avant');

select throws_ok(
	format($$select public.queue_outbound_email(%L, %L, '{}'::text[], 'Objet', 'Corps.')$$,
		pg_temp.ref('affaire'), pg_temp.ref('identite')),
	'23514', 'recipient_required',
	'16 — avec un domaine, les autres refus gardent leur nom');

select * from finish();
rollback;

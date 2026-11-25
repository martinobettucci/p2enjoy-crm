-- @verifies CRM-162 (docs/BACKLOG.md) — tranche T1 : déplacer un track entier d'un espace à un autre, en base — le
--           super-administrateur seul ; chaque refus par son montage ; la confirmation par le nom ; le déplacement complet
--           (le track, ses channels, ses affaires et ce qui leur est rattaché changent d'espace ; budgets et membres
--           suivent ; les référentiels réutilisés ou créés) ; l'ancienne adresse qui aboutit (règle 1 bis) ; le mail déjà
--           présent à l'arrivée ; la redirection d'une adresse ; l'aller-retour qui rend l'état de départ
-- @verifies CRM-162 (docs/BACKLOG.md) — tranche T2 : les tracks d'un espace lus par le seul super-administrateur
--           (`plateforme_tracks`), et les noms des deux espaces dans l'événement et le journal (migration `0198`)
-- @verifies docs/SPEC-deplacement-track.md §2 à §13 ; docs/SCHEMA.md « Migration — `CRM-162` T1 » ; docs/JOURNAL.md
--           décisions 964, 966, 968, 969 et 972 ; CLAUDE.md §10 (le refus par requête directe)
--
-- L'ESPACE D'ARRIVÉE EST PROPRE À LA PREUVE (« Sonde 162 »), posé dans la transaction de la preuve, qui est annulée : la
-- preuve ne dépend ni de l'ordre des sections du seed, ni de « Studio Lumen ». Le track déplacé est « Formation » du seed,
-- trois affaires (docs/SPEC-seed.md). Chaque refus est précédé du témoin de son montage.

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

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
	('depart', '5eed0000-0000-4000-8000-000000000001'),
	('arrivee', 'e1620000-0000-4000-8000-000000000001'),
	('track', '5eed0000-0000-4000-8000-000000000023'),
	('camille', '5eed0000-0000-4000-8000-000000000011'),
	('driss', '5eed0000-0000-4000-8000-000000000012'),
	('sabine', '5eed0000-0000-4000-8000-000000000018'),
	('c7', '5eed0000-0000-4000-8000-0000000000c7'),
	('c6', '5eed0000-0000-4000-8000-0000000000c6');
create or replace function pg_temp.ref(n text) returns text language sql as $$
	select valeur from pg_temp_ref where nom = n;
$$;
create or replace function pg_temp.id(n text) returns uuid language sql as $$
	select valeur::uuid from pg_temp_ref where nom = n;
$$;
-- Les codes de refus de l'aperçu, sous le super-administrateur.
create or replace function pg_temp.refus() returns text[] language plpgsql as $$
declare
	v text[];
begin
	perform pg_temp.endosser(pg_temp.id('sabine'));
	select array_agg(r ->> 'code' order by r ->> 'code') into v
	  from jsonb_array_elements(public.track_move_preview(pg_temp.id('track'), pg_temp.id('arrivee')) -> 'refusals') r;
	perform pg_temp.redevenir_proprietaire();
	return coalesce(v, '{}');
end;
$$;

-- L'espace d'arrivée, Camille administratrice. Driss n'en est pas membre : c'est le premier refus.
insert into public.workspaces (id, name, slug) values (pg_temp.id('arrivee'), 'Sonde 162', 'sonde-162');
insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('arrivee'), pg_temp.id('camille'), 'admin');
insert into pg_temp_ref select 'etat_cards', string_agg(c.id || ':' || c.workspace_id, ',' order by c.id)
  from public.cards c where c.id in (select pl.card_id from public.card_placements pl
                                     join public.channels ch on ch.id = pl.channel_id where ch.track_id = pg_temp.id('track'));
insert into pg_temp_ref select 'etat_placements', string_agg(p.id || ':' || p.workflow_id || ':' || p.current_step_id, ',' order by p.id)
  from public.card_placements p where p.card_id in (select pl.card_id from public.card_placements pl
                                     join public.channels ch on ch.id = pl.channel_id where ch.track_id = pg_temp.id('track'));

-- =============================================================================================
-- 1. Le super-administrateur seul — §2
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('camille'));
select throws_ok(format($$select public.track_move_preview(%L, %L)$$, pg_temp.ref('track'), pg_temp.ref('arrivee')),
	'42501', null, '1 — l''administratrice des deux espaces ne prévisualise pas : super-administrateur seul');
select throws_ok(format($$select public.move_track(%L, %L, 'Formation')$$, pg_temp.ref('track'), pg_temp.ref('arrivee')),
	'42501', null, '2 — ni ne déplace, par requête directe');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 2. Les refus — §4
-- =============================================================================================

select is(pg_temp.refus(), array['non_member'], '3 — Driss, responsable d''une affaire, n''est pas membre de l''arrivée');
select pg_temp.endosser(pg_temp.id('sabine'));
select throws_ok(format($$select public.move_track(%L, %L, 'Formation')$$, pg_temp.ref('track'), pg_temp.ref('arrivee')),
	'22023', 'track_move_refused', '4 — le déplacement refuse avec la même liste');
select pg_temp.redevenir_proprietaire();
select is((select workspace_id from public.tracks where id = pg_temp.id('track')), pg_temp.id('depart'),
	'5 — et rien n''est écrit');

insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('arrivee'), pg_temp.id('driss'), 'business_developer');
select is(pg_temp.refus(), '{}'::text[], '6 — TÉMOIN : Driss membre, plus aucun refus');

select pg_temp.endosser(pg_temp.id('sabine'));
select throws_ok(format($$select public.move_track(%L, %L, 'Formation ')$$, pg_temp.ref('track'), pg_temp.ref('depart')),
	'22023', 'track_move_refused', '7 — vers son propre espace : refusé (same_workspace)');
select throws_ok(format($$select public.move_track(%L, %L, 'formation')$$, pg_temp.ref('track'), pg_temp.ref('arrivee')),
	'22023', 'confirmation_mismatch', '8 — un nom saisi qui diffère refuse ; la casse compte');
select pg_temp.redevenir_proprietaire();

-- Un track homonyme à l'arrivée.
insert into public.tracks (id, workspace_id, name, slug, position) values ('e1620000-0000-4000-8000-0000000000a1', pg_temp.id('arrivee'), 'Formation', 'formations', 1);
select ok('homonym_track' = any (pg_temp.refus()), '9 — un track du même nom à l''arrivée refuse');
delete from public.tracks where id = 'e1620000-0000-4000-8000-0000000000a1';

-- Une affaire rattachée aussi à un autre track.
insert into public.card_placements (workspace_id, card_id, channel_id, workflow_id, current_step_id, position)
select pg_temp.id('depart'), pg_temp.id('c6'), ch.id, ch.workflow_id,
       (select s.id from public.workflow_steps s where s.workflow_id = ch.workflow_id and s.is_initial limit 1), 99
  from public.channels ch join public.tracks t on t.id = ch.track_id
 where t.slug = 'conseil-ia' and t.workspace_id = pg_temp.id('depart') and ch.deleted_at is null and ch.archived_at is null
 limit 1;
select ok('shared_card' = any (pg_temp.refus()), '10 — une affaire aussi rattachée à un track qui reste refuse');
delete from public.card_placements where card_id = pg_temp.id('c6') and position = 99;

-- Un envoi en file, un mail préparé en attente, une relance armée.
insert into public.mail_outbox (workspace_id, kind, card_id, identity_id, to_addrs, subject, body_text, status, created_by)
select pg_temp.id('depart'), 'card', pg_temp.id('c7'), i.id, array['client@exterieur.test'], 'Sonde 162', 'Corps.', 'queued', pg_temp.id('camille')
  from public.mail_outbound_identities i where i.owner_id = pg_temp.id('camille') and i.is_default;
select ok('queued_send' = any (pg_temp.refus()), '11 — un envoi en file refuse');
delete from public.mail_outbox where subject = 'Sonde 162';
insert into public.mail_drafts (workspace_id, card_id, to_addrs, subject, body_text, origin, status, created_by)
values (pg_temp.id('depart'), pg_temp.id('c7'), array['client@exterieur.test'], 'Sonde 162', 'Corps.', 'mcp', 'pending', pg_temp.id('camille'));
select ok('pending_draft' = any (pg_temp.refus()), '12 — un mail préparé en attente refuse');
delete from public.mail_drafts where subject = 'Sonde 162';

-- Un champ commun homonyme d'un autre type à l'arrivée.
insert into public.card_common_fields (workspace_id, key, label, type, position)
select pg_temp.id('arrivee'), 'sonde-' || f.key, f.label, case when f.type = 'text' then 'date' else 'text' end, 1
  from public.card_common_fields f
 where f.id = (select v.field_id from public.card_common_field_values v where v.card_id = pg_temp.id('c7') limit 1);
select ok('field_type_conflict' = any (pg_temp.refus()), '13 — un champ commun homonyme d''un autre type refuse');
delete from public.card_common_fields where workspace_id = pg_temp.id('arrivee') and key like 'sonde-%';

-- Le plafond de 7 h par jour, à l'arrivée (décision 969).
-- RÉVISÉ le 2026-11-25 (CRM-161 T3.d, migration 0203, décision 981) : le plafond compte désormais tous les espaces de la
-- personne ; deux saisies de 300 minutes le même jour dans deux espaces ne se posent plus normalement. L'état que la garde du
-- déplacement défend est celui des DONNÉES D'AVANT : il est posé ici déclencheurs suspendus, comme la suite 0082 le fait.
insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id, created_by)
values (pg_temp.id('depart'), pg_temp.id('camille'), current_date - 400, 300, pg_temp.id('c7'), pg_temp.id('camille'));
insert into public.tracks (id, workspace_id, name, slug, position) values ('e1620000-0000-4000-8000-0000000000a2', pg_temp.id('arrivee'), 'Sonde piste', 'sonde-piste', 1);
set local session_replication_role = replica;
insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id, created_by)
values (pg_temp.id('arrivee'), pg_temp.id('camille'), current_date - 400, 300, 'e1620000-0000-4000-8000-0000000000a2', pg_temp.id('camille'));
set local session_replication_role = origin;
select ok('daily_cap_exceeded' = any (pg_temp.refus()), '14 — 300 minutes déplacées et 300 à l''arrivée le même jour : plus de 7 h, refusé');
delete from public.saisies_temps where track_id = 'e1620000-0000-4000-8000-0000000000a2';
delete from public.tracks where id = 'e1620000-0000-4000-8000-0000000000a2';

-- =============================================================================================
-- 3. Le déplacement — §3, §6, §7, §8
-- =============================================================================================

-- Un mail classé dans l'affaire c7, et le même mail déjà présent, non classé, à l'arrivée (décision 972).
insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, subject, direction)
values (pg_temp.id('depart'), '<sonde-162-doublon@exemple.test>', pg_temp.id('c7'), 'manual', 'client@exemple.test', 'Sonde 162 doublon', 'inbound');
insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, from_address, subject, direction)
values (pg_temp.id('arrivee'), '<sonde-162-doublon@exemple.test>', null, 'unclassified', 'client@exemple.test', 'Sonde 162 doublon', 'inbound');

select pg_temp.endosser(pg_temp.id('sabine'));
insert into pg_temp_ref select 'bilan', public.move_track(pg_temp.id('track'), pg_temp.id('arrivee'), 'Formation')::text;
select pg_temp.redevenir_proprietaire();

select is((select workspace_id from public.tracks where id = pg_temp.id('track')), pg_temp.id('arrivee'),
	'15 — le track change d''espace');
select is((select count(*)::int from public.channels where track_id = pg_temp.id('track') and workspace_id <> pg_temp.id('arrivee')), 0,
	'16 — ses channels aussi');
select is((select count(*)::int from public.cards where id in (pg_temp.id('c7'), pg_temp.id('c6')) and workspace_id = pg_temp.id('arrivee')), 2,
	'17 — ses affaires aussi');
select is((select count(*)::int from public.card_placements p join public.channels c on c.id = p.channel_id
            where c.track_id = pg_temp.id('track') and p.workspace_id <> pg_temp.id('arrivee')), 0,
	'18 — leurs rattachements aussi');
select is((select count(*)::int from public.card_placements p join public.workflows w on w.id = p.workflow_id
            where p.card_id = pg_temp.id('c7') and w.workspace_id = pg_temp.id('arrivee')), 1,
	'19 — le rattachement cite un workflow de l''arrivée (copié ou réutilisé)');
select is((select count(*)::int from public.card_common_field_values v join public.card_common_fields f on f.id = v.field_id
            where v.card_id = pg_temp.id('c7') and f.workspace_id <> pg_temp.id('arrivee')), 0,
	'20 — les valeurs communes citent des champs de l''arrivée');
select is((select count(*)::int from public.saisies_temps where card_id = pg_temp.id('c7') and workspace_id = pg_temp.id('arrivee')), 1,
	'21 — les temps saisis suivent, valorisés à l''arrivée (décision 966)');
select is((select count(*)::int from public.budgets b join public.tracks t on t.id = b.track_id where t.id = pg_temp.id('track')),
	(select count(*)::int from public.budgets where track_id = pg_temp.id('track')),
	'22 — les budgets suivent par leur track');
select is((select count(*)::int from public.mail_messages where rfc822_message_id = '<sonde-162-doublon@exemple.test>'), 1,
	'23 — le mail en double : un seul exemplaire reste (décision 972)');
select is((select workspace_id || ':' || card_id from public.mail_messages where rfc822_message_id = '<sonde-162-doublon@exemple.test>'),
	pg_temp.ref('arrivee') || ':' || pg_temp.ref('c7'),
	'24 — l''exemplaire d''arrivée est gardé, classé dans l''affaire déplacée');
select is((select count(*)::int from public.card_address_aliases where workspace_id = pg_temp.id('depart')
            and card_id in (pg_temp.id('c7'), pg_temp.id('c6'))), 2,
	'25 — l''ancienne adresse de chaque affaire est un alias de l''espace quitté');
-- Bornés à la transaction de la preuve (`now()` est son instant) : un déplacement joué par une autre preuve en laisse.
select is((select count(*)::int from public.track_moves where track_id = pg_temp.id('track') and moved_at = now()), 1,
	'26 — la trace du déplacement');
select is((select count(*)::int from public.plateforme_journal where geste = 'track_moved' and cree_le = now()), 1,
	'27 — le journal de la plateforme');
select is((select count(*)::int from public.card_events where card_id = pg_temp.id('c7') and type = 'track_moved' and created_at >= now()), 1,
	'28 — l''événement de l''affaire');
select is((select count(*)::int from public.card_common_field_values v
            where v.card_id = pg_temp.id('c7') and v.updated_by = pg_temp.id('sabine')), 0,
	'29 — aucune ligne déplacée n''est attribuée au super-administrateur');
select is((select payload ->> 'from_name' || ' → ' || (payload ->> 'to_name') from public.card_events
            where card_id = pg_temp.id('c7') and type = 'track_moved' and created_at >= now()),
	'P2Enjoy SAS → Sonde 162', '29 bis — l''événement porte le nom des deux espaces (migration 0198)');
select is((select cible ->> 'from_name' || ' → ' || (cible ->> 'to_name') from public.plateforme_journal
            where geste = 'track_moved' and cree_le = now()),
	'P2Enjoy SAS → Sonde 162', '29 ter — le journal aussi');

-- =============================================================================================
-- 4. L'ancienne adresse aboutit (§8), la redirection (§12)
-- =============================================================================================

insert into public.mail_messages (id, workspace_id, rfc822_message_id, from_address, subject, direction, to_addresses)
values ('e1620000-0000-4000-8000-0000000000f1', pg_temp.id('depart'), '<sonde-162-alias@exemple.test>', 'client@exemple.test',
        'Réponse à l''ancienne adresse', 'inbound',
        array[(select email_local_part from public.cards where id = pg_temp.id('c7')) || '@crm.p2enjoy.test']);
select is(public.classer_message_automatiquement('e1620000-0000-4000-8000-0000000000f1'), pg_temp.id('c7'),
	'30 — un mail à l''ancienne adresse est classé dans l''affaire (règle 1 bis)');
select is((select workspace_id from public.mail_messages where id = 'e1620000-0000-4000-8000-0000000000f1'), pg_temp.id('arrivee'),
	'31 — et passe dans l''espace de l''affaire');

select pg_temp.endosser(pg_temp.id('camille'));
select results_eq($$select workspace_slug, track_slug from public.track_current_address('p2enjoy', 'formation')$$,
	$$values ('sonde-162'::text, 'formation'::text)$$,
	'32 — l''ancienne adresse du track se résout en son adresse actuelle, pour qui le lit');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.id('sabine'));
select is((select count(*)::int from public.track_current_address('p2enjoy', 'formation')), 0,
	'33 — rien pour qui ne lit pas le track (la RLS de tracks)');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(pg_temp.id('camille'));
select throws_ok(format($$select * from public.plateforme_tracks(%L)$$, pg_temp.ref('arrivee')), '42501', null,
	'33 bis — les tracks d''un espace, par la plateforme : super-administrateur seul');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.id('sabine'));
select results_eq(format($$select name, channels, cards from public.plateforme_tracks(%L) where id = %L$$,
                         pg_temp.ref('arrivee'), pg_temp.ref('track')),
	$$values ('Formation'::text, 1, 3)$$,
	'33 ter — la super-administratrice lit le track déplacé, ses channels et ses affaires');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. L'aller-retour rend l'état de départ — §11
-- =============================================================================================

delete from public.mail_messages where id = 'e1620000-0000-4000-8000-0000000000f1';
select pg_temp.endosser(pg_temp.id('sabine'));
select lives_ok(format($$select public.move_track(%L, %L, 'Formation')$$, pg_temp.ref('track'), pg_temp.ref('depart')),
	'34 — le déplacement inverse aboutit');
select pg_temp.redevenir_proprietaire();
select is((select string_agg(c.id || ':' || c.workspace_id, ',' order by c.id) from public.cards c
            where c.id in (select pl.card_id from public.card_placements pl join public.channels ch on ch.id = pl.channel_id
                            where ch.track_id = pg_temp.id('track'))), pg_temp.ref('etat_cards'),
	'35 — les affaires retrouvent leur espace');
select is((select string_agg(p.id || ':' || p.workflow_id || ':' || p.current_step_id, ',' order by p.id) from public.card_placements p
            where p.card_id in (select pl.card_id from public.card_placements pl join public.channels ch on ch.id = pl.channel_id
                                 where ch.track_id = pg_temp.id('track'))), pg_temp.ref('etat_placements'),
	'36 — leurs rattachements retrouvent leur workflow et leur étape d''origine');

select * from finish();
rollback;

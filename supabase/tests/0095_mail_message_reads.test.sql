-- @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : lu / non lu dans l'inbox
-- @verifies docs/SPEC-mail-subsystem.md §18 bis.2 (état personnel, courrier reçu seul, total gardé), §18 bis.3 (la table,
--           sa RLS, `mark_messages_read`, `mark_message_unread`, `is_read`, `unread_count`) ; docs/SCHEMA.md
--           `mail_message_reads` ; docs/SPEC-permissions-rls.md §7 (la discrétion) ; docs/JOURNAL.md décisions 715, 716
--
-- LA SUITE S'APPUIE SUR LE COURRIER DU SEED (§2.19), sans en fabriquer : Camille (admin) voit les quatre messages,
-- Driss (business_developer) les deux classés seulement. Les lectures sont REMISES À ZÉRO dans la transaction, pour
-- que la suite ne dépende pas de ce que le seed ou une session a déjà lu ; le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
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

create temporary table pg_temp_ref (nom text primary key, valeur uuid);
grant all on pg_temp_ref to authenticated, service_role;

insert into pg_temp_ref
select 'non_classe', id from public.mail_messages where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'classe', id from public.mail_messages where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'reponse', id from public.mail_messages where rfc822_message_id = '<seed-inbox-reponse@p2enjoy.test>';

delete from public.mail_message_reads;

-- TÉMOIN (décision 50) : sans les messages du seed, chaque « zéro » ci-dessous serait vrai pour une mauvaise raison.
select is((select count(*) from pg_temp_ref where valeur is not null), 3::bigint,
	'1 — TÉMOIN : les trois messages du seed employés ici existent');

-- =============================================================================================
-- 1. Les objets et leurs privilèges
-- =============================================================================================

select has_table('public', 'mail_message_reads', '2 — la table des lectures existe');
select col_is_pk('public', 'mail_message_reads', array['message_id', 'user_id'],
	'3 — une ligne par message ET par personne : l''état est personnel');
select ok((select relrowsecurity from pg_class where oid = 'public.mail_message_reads'::regclass),
	'4 — la RLS est activée sur la table');
select ok(not has_table_privilege('authenticated', 'public.mail_message_reads', 'insert'),
	'5 — aucune insertion directe : les fonctions sont les seules portes');
select ok(not has_table_privilege('authenticated', 'public.mail_message_reads', 'delete'),
	'6 — aucune suppression directe');
select ok(not has_table_privilege('anon', 'public.mail_message_reads', 'select'),
	'7 — l''anonyme ne lit rien');
select ok(not has_function_privilege('anon', 'public.mark_messages_read(uuid[])', 'execute'),
	'8 — l''anonyme ne peut pas marquer lu');
select ok(not has_function_privilege('anon', 'public.mark_message_unread(uuid)', 'execute'),
	'9 — l''anonyme ne peut pas marquer non lu');
select is((select prosecdef from pg_proc where oid = 'public.inbox_arborescence'::regproc), false,
	'10 — l''arborescence reste `SECURITY INVOKER` : ses compteurs suivent l''appelant');

-- =============================================================================================
-- 2. Camille marque lu — l'état d'une personne
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, admin

select is((select count(*) from public.mail_messages m where not public.is_read(m)), 4::bigint,
	'11 — au départ, les quatre messages reçus sont non lus pour Camille : aucune lecture fabriquée');
select is((select unread_count from public.inbox_arborescence() where card_id is null), 2::bigint,
	'12 — « Non classés » : deux non lus pour Camille');
select is((select nombre from public.inbox_arborescence() where card_id is null), 2::bigint,
	'13 — et le TOTAL reste à deux (décision 716)');

select is(public.mark_messages_read(array[(select valeur from pg_temp_ref where nom = 'classe'),
                                          (select valeur from pg_temp_ref where nom = 'reponse')]), 2,
	'14 — ouvrir le fil « Demande de devis » marque ses deux messages lus');
select is(public.mark_messages_read(array[(select valeur from pg_temp_ref where nom = 'classe')]), 1,
	'15 — idempotente : remarquer un message lu le compte sans dupliquer');
select is((select count(*) from public.mail_message_reads), 2::bigint,
	'16 — Camille lit ses deux lignes, et seulement elles');
select ok((select public.is_read(m) from public.mail_messages m
            where m.id = (select valeur from pg_temp_ref where nom = 'classe')),
	'17 — `is_read` rend vrai pour un message lu');
select is((select sum(unread_count) from public.inbox_arborescence() where card_id is not null), 0::numeric,
	'18 — le dossier de l''affaire n''a plus de non lu pour Camille');
select is((select sum(nombre) from public.inbox_arborescence() where card_id is not null), 2::numeric,
	'19 — son total reste à deux');

select throws_ok(
	format('select public.mark_messages_read(array(select gen_random_uuid() from generate_series(1, 201)))'),
	'22023', 'too_many_messages',
	'20 — plus de 200 identifiants : refus nommé');

select is(public.mark_messages_read(array[gen_random_uuid()]), 0,
	'21 — un identifiant inconnu est ignoré sans erreur : la discrétion');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. Driss — un autre état, et la garde de visibilité
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');  -- Driss, business_developer

select is((select count(*) from public.mail_message_reads), 0::bigint,
	'22 — Driss ne lit AUCUNE lecture de Camille');
select ok((select not public.is_read(m) from public.mail_messages m
            where m.id = (select valeur from pg_temp_ref where nom = 'classe')),
	'23 — ce que Camille a lu reste non lu pour Driss : l''état est personnel');
select is(public.mark_messages_read(array[(select valeur from pg_temp_ref where nom = 'non_classe')]), 0,
	'24 — Driss ne marque pas un message qu''il ne voit pas : zéro, sans erreur');
select throws_ok(
	format('insert into public.mail_message_reads (message_id, user_id) values (%L, %L)',
		(select valeur from pg_temp_ref where nom = 'non_classe'), '5eed0000-0000-4000-8000-000000000012'),
	'42501', null,
	'25 — l''insertion directe est refusée, même pour soi');
select is(public.mark_message_unread((select valeur from pg_temp_ref where nom = 'non_classe')), false,
	'26 — marquer non lu un message invisible rend faux');

select pg_temp.redevenir_proprietaire();

select is((select count(*) from public.mail_message_reads
            where message_id = (select valeur from pg_temp_ref where nom = 'non_classe')), 0::bigint,
	'27 — aucune lecture du message invisible n''a été posée, vu par le propriétaire de la base');

-- =============================================================================================
-- 4. Remettre non lu
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(public.mark_message_unread((select valeur from pg_temp_ref where nom = 'reponse')), true,
	'28 — Camille remet la réponse non lue');
select is((select sum(unread_count) from public.inbox_arborescence() where card_id is not null), 1::numeric,
	'29 — le dossier de l''affaire porte de nouveau un non lu');
select is(public.mark_message_unread((select valeur from pg_temp_ref where nom = 'reponse')), false,
	'30 — la remettre non lue une seconde fois ne retire rien');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Le courrier ENVOYÉ est toujours lu — §18 bis.2 point 2
-- =============================================================================================
--
-- Le seed ne porte aucun envoi (§18 bis.1) : un message sortant JETABLE est posé dans la transaction, classé dans
-- l'affaire du fil, et disparaît au `rollback`. Il ne sert qu'à éprouver la règle, jamais à démontrer le produit.

insert into public.mail_messages (workspace_id, rfc822_message_id, card_id, classification, direction, subject,
                                  from_address, received_at)
select m.workspace_id, '<pgtap-sortant-0095@p2enjoy.test>', m.card_id, 'manual', 'outbound', 'Envoi jetable',
       'bizdev@p2enjoy.test', now()
  from public.mail_messages m
 where m.id = (select valeur from pg_temp_ref where nom = 'classe');
insert into pg_temp_ref
select 'sortant', id from public.mail_messages where rfc822_message_id = '<pgtap-sortant-0095@p2enjoy.test>';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select ok((select public.is_read(m) from public.mail_messages m
            where m.id = (select valeur from pg_temp_ref where nom = 'sortant')),
	'31 — un message ENVOYÉ est lu, sans aucune ligne de lecture');
select is(public.mark_messages_read(array[(select valeur from pg_temp_ref where nom = 'sortant')]), 0,
	'32 — le marquer lu n''écrit rien : seul le courrier reçu porte un état');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

-- @verifies CRM-055 (docs/BACKLOG.md) — classement assisté, tranche 2 : le DÉCLASSEMENT
-- @verifies docs/SPEC-mail-subsystem.md §16.5.2 (les cinq lignes du contrat opposable, et la BORNE
--           mesurée de l'idempotence), §16.5.3 (l'historique conservé, le départ écrit, le
--           vocabulaire à dix-neuf types), §16.5.4 (ce que la tranche NE fait pas :
--           `suggested_card_id` intact, aucune politique ouverte)
-- @verifies docs/SPEC-mail-subsystem.md §16.3 (le classement manuel, dont ceci est l'exact inverse)
-- @verifies docs/SPEC-permissions-rls.md §7 (le refus se mesure avec le rôle réel de l'appelant)
-- @verifies docs/SPEC-cards.md §14.4 (vocabulaire de la timeline) ; docs/SCHEMA.md §7, §9
-- @verifies docs/JOURNAL.md décision 536
--
-- CE QUE CETTE SUITE MESURE, ET QUI NE SE DÉDUIT PAS À LA LECTURE. Le déclassement est le seul
-- geste du produit qui puisse retirer à son auteur le droit de le refaire : le `bizdev` voit le
-- message classé par sa CARD seule, et le `card_id` remis à nul l'en prive. Les assertions 12 à 15
-- figent cette borne dans les DEUX sens — l'appelant qui garde la visibilité obtient l'idempotence,
-- celui qui la perd obtient un refus, et ce refus est juste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

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

create temporary table pg_temp_ref (nom text primary key, valeur text);
grant all on pg_temp_ref to authenticated, service_role;

insert into pg_temp_ref
select 'classe', id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'card', card_id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';
insert into pg_temp_ref
select 'non_classe', id::text from public.mail_messages
 where rfc822_message_id = '<seed-inbox-non-classe@p2enjoy.test>';
-- RELEVÉE AVANT LE GESTE, sans quoi l'assertion 19 se comparerait à elle-même et serait verte quoi
-- qu'il arrive. `coalesce` porte le cas où la relève n'a rien suggéré : « nul avant » doit rester
-- « nul après », et une comparaison à `null` n'aurait rien mesuré.
insert into pg_temp_ref
select 'suggestion_avant', coalesce(suggested_card_id::text, 'aucune')
  from public.mail_messages where rfc822_message_id = '<seed-inbox-classe@p2enjoy.test>';

-- LES COMPTES D'ÉVÉNEMENTS SONT RELEVÉS AVANT LE GESTE, ET LES ASSERTIONS MESURENT UN DELTA.
--
-- ÉCRITES EN ABSOLU — « zéro `mail_unclassified` », « exactement un » —, elles étaient VRAIES sur
-- une base neuve et FAUSSES au second passage : `card_events` n'accorde AUCUNE suppression, à
-- personne (`CRM-044`), si bien que les événements laissés par les preuves d'API et d'interface
-- s'accumulent pour de bon. C'est le harnais qui l'a montré, en rejouant cette suite APRÈS elles.
-- Une preuve qui ne survit pas à son propre produit n'est pas une preuve.
insert into pg_temp_ref
select 'departs_avant', count(*)::text from public.card_events where type = 'mail_unclassified';
insert into pg_temp_ref
select 'departs_du_message_avant', count(*)::text from public.card_events
 where type = 'mail_unclassified'
   and payload->>'message_id' = (select valeur from pg_temp_ref where nom = 'classe');

-- TÉMOIN AVANT TOUTE ASSERTION DE REFUS (décision 50) : sans lui, « le geste a échoué » serait vrai
-- que la garde refuse ou que le message manque.
select is(
	(select count(*) from pg_temp_ref
	  where nom in ('classe', 'card', 'non_classe', 'suggestion_avant',
	                'departs_avant', 'departs_du_message_avant')),
	6::bigint,
	'1 — TÉMOIN : le seed porte bien un message CLASSÉ, sa card, un message NON CLASSÉ, l''état de '
	'sa suggestion et les deux comptes d''événements, tous relevés AVANT le geste');

-- =============================================================================================
-- 1. Ce que la migration livre — §16.5.2, §16.5.3
-- =============================================================================================

select has_function('public', 'unclassify_message', array['uuid'],
	'2 — le déclassement existe, et il ne prend que le message : la card se déduit');

select is(
	has_function_privilege('authenticated', 'public.unclassify_message(uuid)', 'execute'),
	true,
	'3 — il est offert à un membre connecté, comme le classement manuel');

select ok(
	not has_function_privilege('anon', 'public.unclassify_message(uuid)', 'execute'),
	'4 — et refusé à l''anonyme');

-- ASSERTION RÉVISÉE, NON RETIRÉE (mécanisme de la décision 51). Les suites `0027`, `0018`, `0019`
-- et `0022` figent le vocabulaire à chaque extension ; celle-ci fige la DIX-NEUVIÈME valeur. Le
-- jour d'une vingtième, c'est cette ligne qui désignera la preuve à réviser.
select ok(
	(select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check')
	  like '%mail_unclassified%',
	'5 — le vocabulaire de la timeline compte DIX-NEUF types : le départ d''un message est un fait '
	'au même titre que son arrivée (§16.5.3)');

-- =============================================================================================
-- 2. Les refus — §16.5.2, lignes b, c et d
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');  -- Farida, viewer

select throws_ok(
	format('select public.unclassify_message(%L)', (select valeur from pg_temp_ref where nom = 'classe')),
	'42501',
	'forbidden',
	'6 — LIGNE c : la lectrice ne voit pas ce message, et le refus tombe avant toute écriture');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- Camille, admin

select throws_ok(
	'select public.unclassify_message(''00000000-0000-4000-8000-000000000000'')',
	'P0002',
	'message_not_found',
	'7 — LIGNE b : un message inconnu se dit inconnu, et non « interdit »');

-- LIGNE e, PREMIER SENS : l'appelant qui VOIT le message et le trouve déjà non classé obtient
-- `null`, sans aucune écriture. L'administratrice voit la boîte du workspace : sa visibilité ne
-- dépend d'aucune card.
select is(
	public.unclassify_message((select valeur::uuid from pg_temp_ref where nom = 'non_classe')),
	null::uuid,
	'8 — LIGNE e : un message déjà non classé rend `null`, sans refus et sans écriture');

select is(
	(select count(*) from public.card_events where type = 'mail_unclassified'),
	(select valeur::bigint from pg_temp_ref where nom = 'departs_avant'),
	'9 — et il n''a écrit AUCUN événement : le compte des départs est celui d''avant l''appel, et '
	'deux clics ne racontent pas deux histoires');

-- =============================================================================================
-- 3. Le geste, par l'administratrice qui CONSERVE la visibilité — §16.5.2, §16.5.3
-- =============================================================================================

select is(
	public.unclassify_message((select valeur::uuid from pg_temp_ref where nom = 'classe')),
	(select valeur::uuid from pg_temp_ref where nom = 'card'),
	'10 — le geste rend LA CARD QUITTÉE : seule trace qui resterait à un appelant que le '
	'déclassement prive de la visibilité du message');

select results_eq(
	format($q$select classification, card_id, classified_by, classified_at
	            from public.mail_messages where id = %L$q$,
	       (select valeur from pg_temp_ref where nom = 'classe')),
	$q$values ('unclassified'::text, null::uuid, null::uuid, null::timestamptz)$q$,
	'11 — l''exact inverse du classement : la classification, la card, l''auteur et l''horodatage '
	'sont tous défaits');

-- =============================================================================================
-- 4. LA BORNE DE L'IDEMPOTENCE, DANS LES DEUX SENS — §16.5.2
-- =============================================================================================
--
-- C'est le premier appel réel sur la pile qui a montré que la ligne e, écrite sans borne, était
-- FAUSSE pour l'appelant qui en a le plus besoin. Ces quatre assertions figent la borne mesurée.

select ok(
	app.peut_voir_message((select valeur::uuid from pg_temp_ref where nom = 'classe')),
	'12 — l''administratrice voit ENCORE le message après l''avoir déclassé : elle le voit par la '
	'BOÎTE, que le geste ne touche pas');

select is(
	public.unclassify_message((select valeur::uuid from pg_temp_ref where nom = 'classe')),
	null::uuid,
	'13 — elle obtient donc bien l''idempotence : un second appel rend `null`');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');  -- Driss, business_developer

select ok(
	not app.peut_voir_message((select valeur::uuid from pg_temp_ref where nom = 'classe')),
	'14 — le `bizdev`, lui, voyait ce message par sa CARD SEULE : déclassé, il ne le voit plus');

select throws_ok(
	format('select public.unclassify_message(%L)', (select valeur from pg_temp_ref where nom = 'classe')),
	'42501',
	'forbidden',
	'15 — LA BORNE : à qui perd la visibilité dans le geste, un second appel oppose `forbidden`. Ce '
	'refus est JUSTE, et l''ordre des gardes n''est PAS révisé pour le contourner : déplacer la '
	'ligne e devant la ligne c ferait de la fonction une sonde à messages');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. L'historique n'est pas réécrit, et le départ est écrit — §16.5.3
-- =============================================================================================

select is(
	(select count(*) from public.card_events
	  where card_id = (select valeur::uuid from pg_temp_ref where nom = 'card')
	    and type = 'mail_received'
	    and payload->>'message_id' = (select valeur from pg_temp_ref where nom = 'classe')),
	1::bigint,
	'16 — le `mail_received` d''origine est CONSERVÉ : le courrier EST arrivé dans cette card, et '
	'réécrire une histoire vraie n''est pas une correction');

select is(
	(select count(*) from public.card_events
	  where card_id = (select valeur::uuid from pg_temp_ref where nom = 'card')
	    and type = 'mail_unclassified'
	    and payload->>'message_id' = (select valeur from pg_temp_ref where nom = 'classe')),
	(select valeur::bigint + 1 from pg_temp_ref where nom = 'departs_du_message_avant'),
	'17 — le départ est écrit, UNE seule fois de plus qu''avant l''appel : sans lui la timeline dirait « courrier reçu » en '
	'désignant un message qui n''y est plus — la perte silencieuse');

-- LE DERNIER, ET NON « LE » : la sous-requête sans ordre ni borne rendait plusieurs lignes dès
-- qu'une preuve antérieure avait laissé son propre départ, et la suite mourait sur
-- « more than one row returned by a subquery ». C'est celui que CE geste vient d'écrire qui est
-- mesuré.
select is(
	(select payload->>'subject' from public.card_events
	  where type = 'mail_unclassified'
	    and payload->>'message_id' = (select valeur from pg_temp_ref where nom = 'classe')
	  order by created_at desc, id desc limit 1),
	(select subject from public.mail_messages
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'classe')),
	'18 — et il porte l''OBJET du message : la ligne doit rester lisible à qui ne peut plus ouvrir '
	'le message qu''elle désigne');

-- =============================================================================================
-- 6. Ce que la tranche NE fait PAS — §16.5.4
-- =============================================================================================

select is(
	(select coalesce(suggested_card_id::text, 'aucune') from public.mail_messages
	  where id = (select valeur::uuid from pg_temp_ref where nom = 'classe')),
	(select valeur from pg_temp_ref where nom = 'suggestion_avant'),
	'19 — `suggested_card_id` n''est PAS recalculé : la règle 3 est un constat de la RELÈVE, jamais '
	'd''un geste humain, et la rejouer ferait réapparaître une proposition automatique derrière une '
	'décision explicite de l''utilisateur');

select * from finish();

rollback;

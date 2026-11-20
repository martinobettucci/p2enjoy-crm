-- @verifies CRM-159 (docs/BACKLOG.md) — tranche T1 : les pastilles cachées en base — le drapeau, Spam cochée dans
--           l'espace du seed et dans un espace créé, le drapeau réservé à qui administre ; la règle de masquage par fil
--           (une cachée activée suffit, le caché l'emporte sur une visible, archivée encore masquante, retirée à la main,
--           message invisible, corbeille) ; la liste `inbox_messages`, la mention `inbox_hidden_counts`, les compteurs
--           `inbox_arborescence`, la portée `inbox_bulk_count`, la recherche (`app.search_query`, `recherche_globale`,
--           `search_hidden_mail_counts`)
-- @verifies docs/SPEC-mail-subsystem.md §31.13.1 à §31.13.6 ; docs/SCHEMA.md « Migration `0193` » ;
--           docs/JOURNAL.md décisions 957 et 958 ; CLAUDE.md §10
--
-- LES POSES SONT ÉCRITES EN PROPRIÉTAIRE, DANS LA TRANSACTION DE LA PREUVE, QUI EST ANNULÉE. Chaque refus et chaque masquage
-- est précédé du témoin de son montage. Les pastilles sont lues par leur nom : leurs identifiants ne sont pas stables d'un
-- seed à l'autre. *Révisé avec le seed §52 (T4, 2026-11-20, décision 51)* : « Non classés » porte déjà deux fils Spam du
-- seed, masqués ; les comptes de la mention et de la portée sont donc mesurés AVANT le montage et la preuve y ajoute les
-- siens.

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

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
	('driss', '5eed0000-0000-4000-8000-000000000012'),
	('lectrice', '5eed0000-0000-4000-8000-000000000013');
insert into pg_temp_ref
select 'pastille:' || lower(name), id::text from public.mail_labels
 where workspace_id = '5eed0000-0000-4000-8000-000000000001';
-- Quatre mails NON CLASSÉS que Camille voit (docs/SPEC-seed.md §44, §46, §49) : chacun est seul dans son fil.
insert into pg_temp_ref
select v.nom, m.id::text
  from (values ('a', '<seed-inbox-inconnu@atelier-lumen.example>'),
               ('b', '<seed-inbox-suggere@sogexia.example>'),
               ('c', '<seed-inbox-non-classe@p2enjoy.test>'),
               ('d', '<seed-corps-html@p2enjoy.test>')) v(nom, rfc)
  join public.mail_messages m on m.rfc822_message_id = v.rfc;

create or replace function pg_temp.ref(n text) returns text language sql as $$
	select valeur from pg_temp_ref where nom = n;
$$;
create or replace function pg_temp.id(n text) returns uuid language sql as $$
	select valeur::uuid from pg_temp_ref where nom = n;
$$;
-- Les identifiants rendus par la liste de Camille, sous ses droits.
create or replace function pg_temp.liste(p_pastilles text[] default '{}') returns uuid[] language sql as $$
	select coalesce(array_agg(m.id), '{}') from public.inbox_messages(
		p_label_ids => (select coalesce(array_agg(pg_temp.id('pastille:' || p)), '{}') from unnest(p_pastilles) p)) m;
$$;
create or replace function pg_temp.poser(p_message text, p_pastille text) returns void language sql as $$
	insert into public.mail_message_labels (message_id, label_id, workspace_id, source, applied)
	values (pg_temp.id(p_message), pg_temp.id('pastille:' || p_pastille), pg_temp.id('espace'), 'llm', true)
	on conflict (message_id, label_id) do update set applied = true, source = 'llm';
$$;

-- =============================================================================================
-- 1. Le drapeau — §31.13.1
-- =============================================================================================

select col_not_null('public', 'mail_labels', 'hidden', '1 — `mail_labels.hidden` est non nul');
select col_default_is('public', 'mail_labels', 'hidden', 'false', '2 — et décoché par défaut');

select results_eq(
	$$select name, hidden from public.mail_labels where workspace_id = pg_temp.id('espace') and hidden order by name$$,
	$$values ('Spam'::text, true)$$,
	'3 — dans l''espace du seed, Spam est cachée, et elle seule');

insert into public.workspaces (id, name, slug) values ('e1590000-0000-4000-8000-000000000001', 'Sonde 159', 'sonde-159');
select results_eq(
	$$select count(*)::int, count(*) filter (where hidden)::int, bool_and(hidden = (name = 'Spam'))
	    from public.mail_labels where workspace_id = 'e1590000-0000-4000-8000-000000000001'$$,
	$$values (9, 1, true)$$,
	'4 — un espace créé reçoit ses neuf défauts, Spam cachée, les huit autres visibles');

-- Le drapeau : qui administre l'écrit ; la lectrice et le business developer non (la politique `UPDATE`, §31.3).
select pg_temp.endosser(pg_temp.id('lectrice'));
update public.mail_labels set hidden = true where id = pg_temp.id('pastille:lead');
select pg_temp.endosser(pg_temp.id('driss'));
update public.mail_labels set hidden = true where id = pg_temp.id('pastille:lead');
select pg_temp.redevenir_proprietaire();
select is((select hidden from public.mail_labels where id = pg_temp.id('pastille:lead')), false,
	'5 — la lectrice et le business developer n''écrivent pas le drapeau : la politique les écarte');

select pg_temp.endosser(pg_temp.id('camille'));
update public.mail_labels set hidden = true where id = pg_temp.id('pastille:lead');
select pg_temp.redevenir_proprietaire();
select is((select hidden from public.mail_labels where id = pg_temp.id('pastille:lead')), true,
	'6 — l''administratrice écrit le drapeau');
update public.mail_labels set hidden = false where id = pg_temp.id('pastille:lead');

-- =============================================================================================
-- 2. La liste et la règle — §31.13.2, §31.13.4
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('camille'));
insert into pg_temp_ref select 'liste_avant', count(*)::text from public.inbox_messages();
-- Les fils Spam du seed (§52), masqués avant toute pose de la preuve.
insert into pg_temp_ref select 'spam_seed', coalesce((select thread_count from public.inbox_hidden_counts()
                                                     where label_id = pg_temp.id('pastille:spam')), 0)::text;
insert into pg_temp_ref select 'portee_seed', (select thread_count || ',' || message_count from public.inbox_bulk_count(
	jsonb_build_object('folder', 'unclassified', 'label_ids', jsonb_build_array(pg_temp.ref('pastille:spam')))));
select pg_temp.redevenir_proprietaire();

select is(pg_temp.ref('liste_avant')::int, 4,
	'7 — TÉMOIN : sans pastille cachée posée, la liste de Camille rend ses quatre non classés');

select pg_temp.poser('a', 'spam');
select pg_temp.poser('b', 'spam');
select pg_temp.poser('b', 'lead');

select pg_temp.endosser(pg_temp.id('camille'));
select ok(not (pg_temp.liste() && array[pg_temp.id('a'), pg_temp.id('b')]) and pg_temp.id('c') = any (pg_temp.liste()),
	'8 — sans filtre, les fils Spam sont masqués, les autres restent');
select ok(not (pg_temp.id('b') = any (pg_temp.liste(array['lead']))),
	'9 — le caché l''emporte : sous « Lead » seule, le fil Spam et Lead reste masqué');
select is(pg_temp.liste(array['spam']) @> array[pg_temp.id('a'), pg_temp.id('b')], true,
	'10 — sous « Spam », les deux fils paraissent');
select ok(pg_temp.id('b') = any (pg_temp.liste(array['lead', 'spam'])),
	'11 — sous « Lead » et « Spam », le fil Spam et Lead paraît');

-- L'ordre et la limite : le masquage s'applique AVANT la limite.
select is((select array_agg(m.id) from public.inbox_messages(p_limit => 1) m),
	(select array_agg(id) from (select m.id from public.inbox_messages() m limit 1) x),
	'12 — la limite rend le plus récent des messages NON masqués');
select is((select count(*)::int from public.inbox_messages(p_limit => 1000)),
	(select count(*)::int from public.inbox_messages(p_limit => 200)),
	'13 — la limite est bornée à 200 côté serveur');
select is((select array_agg(m.id) from public.inbox_messages(p_sender => ' NORA.NOUVEAU@atelier-lumen.example ') m),
	null::uuid[],
	'14 — l''expéditeur sans casse ni blancs : le seul mail de Nora est masqué, rien ne sort');
select is((select array_agg(m.id) from public.inbox_messages(p_label_ids => array[pg_temp.id('pastille:spam')],
	                                                          p_sender => 'Nora.Nouveau@Atelier-Lumen.example') m),
	array[pg_temp.id('a')],
	'15 — sous « Spam », le filtre par expéditeur le retrouve');
select pg_temp.redevenir_proprietaire();

-- Deux pastilles cachées : une seule activée suffit (décision 958).
insert into public.mail_labels (workspace_id, name, color, description, hidden)
values (pg_temp.id('espace'), 'Promo 159', 'neutral', 'Les promotions de la preuve 0180.', true);
insert into pg_temp_ref select 'pastille:promo 159', id::text from public.mail_labels
 where workspace_id = pg_temp.id('espace') and name = 'Promo 159';
select pg_temp.poser('c', 'spam');
select pg_temp.poser('c', 'promo 159');
select pg_temp.endosser(pg_temp.id('camille'));
select ok(pg_temp.id('c') = any (pg_temp.liste(array['promo 159'])) and pg_temp.id('c') = any (pg_temp.liste(array['spam'])),
	'16 — deux pastilles cachées sur un fil : activer l''une ou l''autre le montre');
select pg_temp.redevenir_proprietaire();

-- Une cachée ARCHIVÉE masque encore.
select pg_temp.poser('d', 'promo 159');
update public.mail_labels set archived_at = now() where id = pg_temp.id('pastille:promo 159');
select pg_temp.endosser(pg_temp.id('camille'));
select ok(not (pg_temp.id('d') = any (pg_temp.liste())) and pg_temp.id('d') = any (pg_temp.liste(array['promo 159'])),
	'17 — une pastille cachée et archivée masque encore ; l''activer montre le fil');
select pg_temp.redevenir_proprietaire();

-- Retirée à la main : la pastille ne compte plus.
update public.mail_message_labels set applied = false, source = 'manual', set_by = pg_temp.id('camille')
 where message_id = pg_temp.id('d') and label_id = pg_temp.id('pastille:promo 159');
select pg_temp.endosser(pg_temp.id('camille'));
select ok(pg_temp.id('d') = any (pg_temp.liste()), '18 — une pastille cachée retirée à la main ne masque plus');
select pg_temp.redevenir_proprietaire();

-- Un message que la personne ne voit pas ne masque rien pour elle, et ne lui révèle rien.
select pg_temp.endosser(pg_temp.id('lectrice'));
select is(app.peut_voir_message(pg_temp.id('a')), false, '19 — TÉMOIN : la lectrice ne voit pas le mail de Nora');
select is((select count(*)::int from app.mail_hidden_threads() t
            where t.thread_key = (select app.cle_fil(references_ids, rfc822_message_id) from public.mail_messages
                                   where id = pg_temp.id('a'))), 0,
	'20 — pour la lectrice, le fil du mail de Nora ne porte aucune pastille cachée');
select pg_temp.redevenir_proprietaire();

-- La corbeille : un message effacé ne masque pas.
update public.mail_messages set deleted_at = now() where id = pg_temp.id('c');
select pg_temp.endosser(pg_temp.id('camille'));
select is((select count(*)::int from app.mail_hidden_threads() t
            where t.thread_key = (select app.cle_fil(references_ids, rfc822_message_id) from public.mail_messages
                                   where id = pg_temp.id('c'))), 0,
	'21 — un message à la corbeille ne masque pas son fil');
select pg_temp.redevenir_proprietaire();
update public.mail_messages set deleted_at = null where id = pg_temp.id('c');

-- =============================================================================================
-- 3. La mention — §31.13.5
-- =============================================================================================

-- État : a (Spam), b (Spam, Lead), c (Spam, Promo archivée), d visible.
select pg_temp.endosser(pg_temp.id('camille'));
select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts()$$,
	$$values (pg_temp.id('pastille:promo 159'), 1), (pg_temp.id('pastille:spam'), pg_temp.ref('spam_seed')::int + 3)$$,
	'22 — sans filtre : Promo 159 masque un fil, Spam trois de plus que le seed, dans l''ordre du nom');
select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts(p_label_ids => array[pg_temp.id('pastille:lead')])$$,
	$$values (pg_temp.id('pastille:promo 159'), 1), (pg_temp.id('pastille:spam'), pg_temp.ref('spam_seed')::int + 3)$$,
	'23 — sous « Lead » : ce que montrerait chaque pastille cachée ajoutée');
select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts(p_label_ids => array[pg_temp.id('pastille:spam')])$$,
	$$select null::uuid, null::integer where false$$,
	'24 — sous « Spam » : plus rien à dire — Promo 159 ne masque que le fil c, montré par Spam');
select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts(p_sender => 'nora.nouveau@atelier-lumen.example')$$,
	$$values (pg_temp.id('pastille:spam'), 1)$$,
	'25 — la mention suit le filtre par expéditeur');
select results_eq(
	$$select label_id, thread_count from public.inbox_hidden_counts(p_card_id => '5eed0000-0000-4000-8000-0000000000c1')$$,
	$$select null::uuid, null::integer where false$$,
	'26 — le dossier d''une affaire sans fil masqué n''a pas de mention');

-- =============================================================================================
-- 4. Les compteurs et la portée — §31.13.3
-- =============================================================================================

select is((select nombre::int from public.inbox_arborescence(false) where card_id is null),
	(select count(*)::int from public.inbox_messages(p_limit => 200)),
	'27 — « Non classés » compte ce que la liste montre sans filtre');
select is((select count(*)::int from public.inbox_arborescence(false) where card_id is null), 1,
	'28 — la ligne des non classés existe toujours');
select results_eq(
	$$select thread_count, message_count from public.inbox_bulk_count(
		jsonb_build_object('folder', 'unclassified', 'label_ids', jsonb_build_array(pg_temp.ref('pastille:lead'))))$$,
	$$values (0, 0)$$,
	'29 — « Tout sélectionner » sous « Lead » n''agit pas sur le fil masqué Spam et Lead');
select results_eq(
	$$select thread_count, message_count from public.inbox_bulk_count(
		jsonb_build_object('folder', 'unclassified', 'label_ids', jsonb_build_array(pg_temp.ref('pastille:spam'))))$$,
	$$select split_part(pg_temp.ref('portee_seed'), ',', 1)::int + 3, split_part(pg_temp.ref('portee_seed'), ',', 2)::int + 3$$,
	'30 — sous « Spam », les trois fils Spam de la preuve s''ajoutent à la portée');

-- =============================================================================================
-- 5. La recherche — §31.13.6
-- =============================================================================================

select is(app.search_query('le la de'), null::tsquery, '31 — un terme de mots vides ne fait pas de requête');
select is(app.search_query('Audit Sécu!!'), to_tsquery('app.francais_sans_accent', 'audit:* & sécu:*'),
	'32 — la découpe est celle de la recherche, inchangée');
select is((select count(*)::int from public.recherche_globale('formation', 50) r where r.id = pg_temp.id('a')), 0,
	'33 — la recherche n''offre pas le mail masqué');
select results_eq(
	$$select label_id, mail_count from public.search_hidden_mail_counts('formation')$$,
	$$values (pg_temp.id('pastille:spam'), 1)$$,
	'34 — et elle le dit : un mail masqué par Spam');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

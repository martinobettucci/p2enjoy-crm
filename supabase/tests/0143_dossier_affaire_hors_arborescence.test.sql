-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T6.1 : le dossier d'une affaire hors de l'arborescence
-- @verifies docs/SPEC-rattachements.md §7 (décisions 657, 818 et 820 : `CRM/Affaires/<titre> (<8 derniers caractères de
--           l'identifiant>)`, une affaire partagée n'a qu'un dossier, l'inbox ne range plus les affaires sous leurs
--           channels) ; docs/SPEC-mail-subsystem.md §4.5 ; docs/SCHEMA.md « Migration `0154` »
--
-- Sur le seed migré ; tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

\set admin '5eed0000-0000-4000-8000-000000000011'
\set c1 '5eed0000-0000-4000-8000-0000000000c1'
\set c4 '5eed0000-0000-4000-8000-0000000000c4'
\set grands_comptes '5eed0000-0000-4000-8000-000000000032'

-- =============================================================================================
-- 1. Le chemin
-- =============================================================================================

select is(public.chemin_dossier_card(:'c4'),
          'CRM/Affaires/' || app.assainir_segment_dossier((select title from public.cards where id = :'c4'))
          || ' (' || right(:'c4', 8) || ')',
	'le dossier de …0c4 est CRM/Affaires/<titre assaini> (<8 derniers caractères de l''identifiant>)');

-- Deux affaires de même titre : deux dossiers.
update public.cards set title = (select title from public.cards where id = :'c4') where id = :'c1';
select isnt(public.chemin_dossier_card(:'c1'), public.chemin_dossier_card(:'c4'),
	'deux affaires de même titre ont deux dossiers : l''identifiant les distingue');
select is(public.chemin_dossier_entite('card', :'c4'), public.chemin_dossier_card(:'c4'),
	'`chemin_dossier_entite` suit : une seule définition du chemin d''une affaire');

-- Une affaire partagée n'a qu'un dossier, quel que soit le nombre de ses rattachements.
select pg_temp.endosser(:'admin');
select lives_ok(format('select public.attach_card(%L, %L)', :'c4', :'grands_comptes'),
	'…0c4 est rattachée en plus à `grands-comptes`');
select pg_temp.proprietaire();
select is(public.chemin_dossier_card(:'c4'),
          'CRM/Affaires/' || app.assainir_segment_dossier((select title from public.cards where id = :'c4'))
          || ' (' || right(:'c4', 8) || ')',
	'… et garde LE MÊME dossier : il ne dépend d''aucun rattachement');

-- =============================================================================================
-- 2. Le registre voit l'ancien dossier diverger : mail-sync le renommera
-- =============================================================================================

insert into public.mail_folder_map (account_id, entity_type, entity_id, requested_path, actual_path)
select a.id, 'card', :'c4', 'CRM/Studio web/Refonte de site/Ancien', 'CRM/Studio web/Refonte de site/Ancien'
  from public.mail_inbound_accounts a limit 1;
select is((select d.nouveau_chemin from public.dossiers_a_renommer((select id from public.mail_inbound_accounts limit 1)) d
            where d.entity_type = 'card' and d.entity_id = :'c4'),
          public.chemin_dossier_card(:'c4'),
	'un dossier d''affaire inscrit sous l''ancien chemin diverge vers CRM/Affaires/… : la relève le renommera');

-- =============================================================================================
-- 3. L'arbre de l'inbox
-- =============================================================================================

select pg_temp.endosser(:'admin');
select ok((select bool_and(track_id is null and channel_id is null) from public.inbox_arborescence()),
	'aucune ligne de l''arbre ne porte plus de track ni de channel');
select is((select count(*)::int from public.inbox_arborescence() where card_id = :'c4'),
          (select least(count(*), 1)::int from public.mail_messages where card_id = :'c4'),
	'une affaire partagée n''a qu''UNE ligne dans l''arbre, sous « Affaires »');

select * from finish();
rollback;

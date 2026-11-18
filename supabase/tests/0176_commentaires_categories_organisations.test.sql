-- @verifies CRM-153 (docs/BACKLOG.md) — tranche T1 : le catalogue des catégories (administrateur seul, unicité sans casse
--           archivées comprises, pas de suppression), leur pose (business developer et administrateur, refus d'une
--           catégorie archivée ou d'un autre espace, retrait d'une archivée), le fil de commentaires (comme une affaire :
--           pierre tombale, colonnes figées, modération limitée, la lectrice lit sans écrire), les mentions et la
--           notification sous la règle du sujet, le filtre p_category_ids
-- @verifies docs/SPEC-organisations.md §9.1, §9.2, §9.5 ; docs/SPEC-notifications.md §51 ; docs/SCHEMA.md « Migration
--           `0188` » ; docs/JOURNAL.md décisions 932 et 939 ; CLAUDE.md §10
--
-- Sur le seed : Camille administratrice (…011), Driss business developer (…012), Farida lectrice (…013) ; Vertigo Conseil
-- et Sogexia (…081). Les écritures de la preuve vivent dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temp table pg_temp.ids (nom text primary key, id uuid);
grant select, insert, update on pg_temp.ids to authenticated;
insert into pg_temp.ids select 'vertigo', id from public.organizations where name = 'Vertigo Conseil';
insert into pg_temp.ids values
	('sogexia', '5eed0000-0000-4000-8000-000000000081'),
	('camille', '5eed0000-0000-4000-8000-000000000011'),
	('driss',   '5eed0000-0000-4000-8000-000000000012'),
	('farida',  '5eed0000-0000-4000-8000-000000000013'),
	('espace',  '5eed0000-0000-4000-8000-000000000001'),
	('autre_espace', '0c176000-0000-4000-8000-000000000001'),
	('etranger', '0c176000-0000-4000-8000-000000000002');
create or replace function pg_temp.id(p text) returns uuid language sql stable as $$ select id from pg_temp.ids where nom = p $$;
create or replace function pg_temp.garder(p text, v uuid) returns void language sql as $$
	insert into pg_temp.ids values (p, v) on conflict (nom) do update set id = excluded.id
$$;
create or replace function pg_temp.noms(p_categories uuid[]) returns text language sql stable as $$
	select coalesce(string_agg(name, '|' order by name), '')
	  from public.organization_list('5eed0000-0000-4000-8000-000000000001', p_limit => 100, p_category_ids => p_categories)
$$;

-- Un second espace et sa catégorie, et un profil qui n'est membre de rien : posés par la clé de service.
insert into public.workspaces (id, name, slug) values (pg_temp.id('autre_espace'), 'Atelier 0176', 'atelier-0176');
insert into public.organization_categories (id, workspace_id, name)
	values ('0c176000-0000-4000-8000-0000000000c1', pg_temp.id('autre_espace'), 'Ailleurs');
insert into auth.users (id, email) values (pg_temp.id('etranger'), 'etranger-0176@exemple.test');

-- ------------------------------------------------------------------------------------------------------------------
-- La forme
-- ------------------------------------------------------------------------------------------------------------------
select is((select prosecdef from pg_proc
            where oid = 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])'::regprocedure),
	false, '1 — la liste, qui gagne p_category_ids, reste SECURITY INVOKER');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'organization_list'),
	1, '2 — l''ancienne signature est retirée : aucune surcharge ne rend l''appel ambigu');
select is((select count(*)::int from pg_class
            where relname in ('organization_categories', 'organization_category_links', 'organization_comments',
                              'organization_comment_mentions')
              and relrowsecurity),
	4, '3 — la RLS est active sur les quatre tables');
select ok(not has_function_privilege('anon', 'public.organization_list(uuid, text, uuid[], text, text, boolean, integer, integer, uuid[])', 'execute'),
	'4 — l''anonyme n''appelle pas la liste');

-- ------------------------------------------------------------------------------------------------------------------
-- Le catalogue (§9.1) : l'administrateur seul
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser(pg_temp.id('camille'));
with i as (insert into public.organization_categories (workspace_id, name, color)
            values (pg_temp.id('espace'), '  Partenaire  ', 'brand') returning id)
select pg_temp.garder('partenaire', id) from i;
with i as (insert into public.organization_categories (workspace_id, name, color)
            values (pg_temp.id('espace'), 'Client', 'success') returning id)
select pg_temp.garder('client', id) from i;
select is((select name || '|' || created_by::text from public.organization_categories where id = pg_temp.id('partenaire')),
	'Partenaire|' || pg_temp.id('camille')::text, '5 — l''administratrice crée une catégorie : nom rogné, auteur posé');
select throws_ok($$ insert into public.organization_categories (workspace_id, name) values (pg_temp.id('espace'), 'PARTENAIRE') $$,
	'23505', null, '6 — le nom est unique dans l''espace, sans casse');
select throws_ok($$ insert into public.organization_categories (workspace_id, name) values (pg_temp.id('espace'), repeat('x', 41)) $$,
	'23514', null, '7 — 40 caractères au plus');
select throws_ok($$ insert into public.organization_categories (workspace_id, name) values (pg_temp.id('espace'), '   ') $$,
	'23514', null, '8 — un nom vide est refusé');
select throws_ok($$ insert into public.organization_categories (workspace_id, name, color) values (pg_temp.id('espace'), 'Rose', 'pink') $$,
	'23514', null, '9 — la couleur est dans la liste fermée des étiquettes');
select throws_ok($$ delete from public.organization_categories where id = pg_temp.id('client') $$,
	'42501', null, '10 — aucune suppression physique, même pour l''administratrice');
reset role;

select pg_temp.endosser(pg_temp.id('driss'));
select throws_ok($$ insert into public.organization_categories (workspace_id, name) values (pg_temp.id('espace'), 'Fournisseur') $$,
	'42501', null, '11 — le business developer ne crée pas de catégorie');
with m as (update public.organization_categories set name = 'Renommée' where id = pg_temp.id('client') returning 1)
select is((select count(*)::int from m), 0, '12 — ni ne la renomme : aucune ligne touchée');
-- Les poses de la suite : Client sur Vertigo et Sogexia, avant son archivage ; Partenaire sur Vertigo.
insert into public.organization_category_links (organization_id, category_id) values
	(pg_temp.id('vertigo'), pg_temp.id('client')),
	(pg_temp.id('sogexia'), pg_temp.id('client')),
	(pg_temp.id('vertigo'), pg_temp.id('partenaire'));
reset role;

select pg_temp.endosser(pg_temp.id('farida'));
select is((select count(*)::int from public.organization_categories where workspace_id = pg_temp.id('espace')),
	2, '13 — la lectrice lit le catalogue');
select is((select count(*)::int from public.organization_categories where id = '0c176000-0000-4000-8000-0000000000c1'),
	0, '14 — elle ne lit pas celui d''un autre espace');
reset role;

select pg_temp.endosser(pg_temp.id('camille'));
update public.organization_categories set archived_at = '2000-01-01' where id = pg_temp.id('client');
select is((select archived_at from public.organization_categories where id = pg_temp.id('client')),
	now(), '15 — l''administratrice archive : l''heure est celle de la base, la date envoyée est ignorée');
select throws_ok($$ insert into public.organization_categories (workspace_id, name) values (pg_temp.id('espace'), 'client') $$,
	'23505', null, '16 — une catégorie archivée garde son nom : l''unicité la compte');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- La pose (§9.1)
-- ------------------------------------------------------------------------------------------------------------------
select is((select workspace_id::text || '|' || created_by::text from public.organization_category_links
            where organization_id = pg_temp.id('vertigo') and category_id = pg_temp.id('partenaire')),
	pg_temp.id('espace')::text || '|' || pg_temp.id('driss')::text,
	'17 — le business developer pose : l''espace est dérivé de l''organisation, l''auteur posé');

select pg_temp.endosser(pg_temp.id('driss'));
select throws_ok($$ insert into public.organization_category_links (organization_id, category_id)
                    values ('0c176000-0000-4000-8000-0000000000ff', pg_temp.id('partenaire')) $$,
	'P0001', 'organization_not_found', '18 — une organisation introuvable est refusée');
select throws_ok($$ insert into public.organization_category_links (organization_id, category_id)
                    values (pg_temp.id('vertigo'), pg_temp.id('partenaire')) $$,
	'23505', null, '19 — une catégorie ne se pose qu''une fois');
reset role;
savepoint archivee;
delete from public.organization_category_links where organization_id = pg_temp.id('sogexia');
select pg_temp.endosser(pg_temp.id('driss'));
select throws_ok($$ insert into public.organization_category_links (organization_id, category_id)
                    values (pg_temp.id('sogexia'), pg_temp.id('client')) $$,
	'22023', 'category_archived', '20 — une catégorie archivée ne se pose plus');
reset role;
rollback to savepoint archivee;
select pg_temp.endosser(pg_temp.id('driss'));
select throws_ok($$ insert into public.organization_category_links (organization_id, category_id)
                    values (pg_temp.id('sogexia'), '0c176000-0000-4000-8000-0000000000c1') $$,
	'22023', 'category_other_workspace', '21 — une catégorie d''un autre espace est refusée');
reset role;

select pg_temp.endosser(pg_temp.id('farida'));
select throws_ok($$ insert into public.organization_category_links (organization_id, category_id)
                    values (pg_temp.id('sogexia'), pg_temp.id('partenaire')) $$,
	'42501', null, '22 — la lectrice ne pose pas');
with m as (delete from public.organization_category_links where organization_id = pg_temp.id('vertigo') returning 1)
select is((select count(*)::int from m), 0, '23 — ni ne retire');
select is((select count(*)::int from public.organization_category_links where organization_id = pg_temp.id('vertigo')),
	2, '24 — mais elle lit les poses');
-- Le filtre (§9.1) : l'une des catégories données, archivées comprises ; vide, aucun filtre.
select is(pg_temp.noms(array[pg_temp.id('partenaire')]), 'Vertigo Conseil', '25 — le filtre rend les organisations de la catégorie');
select is(pg_temp.noms(array[pg_temp.id('client')]), 'Sogexia|Vertigo Conseil', '26 — une catégorie archivée filtre encore');
select is(pg_temp.noms('{}'), pg_temp.noms(null), '27 — un filtre vide ne filtre pas');
reset role;

select pg_temp.endosser(pg_temp.id('driss'));
with m as (delete from public.organization_category_links
            where organization_id = pg_temp.id('sogexia') and category_id = pg_temp.id('client') returning 1)
select is((select count(*)::int from m), 1, '28 — une catégorie archivée se retire');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Le fil de commentaires (§9.2) — comme une affaire
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser(pg_temp.id('driss'));
with i as (insert into public.organization_comments (organization_id, body)
            values (pg_temp.id('vertigo'), 'Premier échange avec la direction.') returning id)
select pg_temp.garder('commentaire', id) from i;
select is((select workspace_id::text || '|' || author_id::text from public.organization_comments where id = pg_temp.id('commentaire')),
	pg_temp.id('espace')::text || '|' || pg_temp.id('driss')::text, '29 — le business developer commente, en son nom');
select throws_ok($$ insert into public.organization_comments (organization_id, author_id, body)
                    values (pg_temp.id('vertigo'), pg_temp.id('camille'), 'Signé d''un autre') $$,
	'42501', null, '30 — personne ne signe au nom d''un autre');
select throws_ok($$ insert into public.organization_comments (organization_id, body) values (pg_temp.id('vertigo'), '  ') $$,
	'23514', null, '31 — un commentaire vide est refusé');
update public.organization_comments set body = 'Premier échange avec la direction générale.' where id = pg_temp.id('commentaire');
select ok((select edited_at is not null from public.organization_comments where id = pg_temp.id('commentaire')),
	'32 — l''auteur modifie le sien : edited_at posé');
reset role;
select throws_ok($$ update public.organization_comments set organization_id = pg_temp.id('sogexia') where id = pg_temp.id('commentaire') $$,
	'P0001', 'comment_immutable_column', '33 — un commentaire ne change pas d''organisation, même par la clé de service');

select pg_temp.endosser(pg_temp.id('farida'));
select throws_ok($$ insert into public.organization_comments (organization_id, body) values (pg_temp.id('vertigo'), 'Lectrice') $$,
	'42501', null, '34 — la lectrice ne commente pas');
select is((select count(*)::int from public.organization_comments where organization_id = pg_temp.id('vertigo')),
	1, '35 — mais elle lit le fil');
with m as (update public.organization_comments set deleted_at = now() where id = pg_temp.id('commentaire') returning 1)
select is((select count(*)::int from m), 0, '36 — et ne supprime pas le commentaire d''un autre');
reset role;

select pg_temp.endosser(pg_temp.id('etranger'));
select is((select count(*)::int from public.organization_comments), 0, '37 — qui n''est pas membre ne lit rien');
reset role;

-- Les mentions (§9.2), posées avant la modération.
select pg_temp.endosser(pg_temp.id('driss'));
insert into public.organization_comment_mentions (comment_id, profile_id) values
	(pg_temp.id('commentaire'), pg_temp.id('farida')),
	(pg_temp.id('commentaire'), pg_temp.id('driss'));
select throws_ok($$ insert into public.organization_comment_mentions (comment_id, profile_id)
                    values (pg_temp.id('commentaire'), pg_temp.id('etranger')) $$,
	'P0001', 'mention_destinataire_sans_acces', '38 — on ne mentionne que qui lit l''organisation');
reset role;
select is((select count(*)::int from public.notifications where payload ->> 'comment_id' = pg_temp.id('commentaire')::text),
	1, '39 — la mention de la lectrice la notifie ; l''auteur qui se mentionne ne l''est pas');
select is((select type || '|' || subject_organization_id::text || '|' || coalesce(subject_card_id::text, '-') || '|'
                  || (payload ->> 'author_id')
             from public.notifications where payload ->> 'comment_id' = pg_temp.id('commentaire')::text),
	'mention|' || pg_temp.id('vertigo')::text || '|-|' || pg_temp.id('driss')::text,
	'40 — type mention, sujet l''organisation, aucune affaire, l''auteur au payload');

select pg_temp.endosser(pg_temp.id('camille'));
select throws_ok($$ insert into public.organization_comment_mentions (comment_id, profile_id)
                    values (pg_temp.id('commentaire'), pg_temp.id('camille')) $$,
	'42501', null, '41 — seul l''auteur pose les mentions de son commentaire');
select throws_ok($$ update public.organization_comments set body = 'Réécrit par la modération' where id = pg_temp.id('commentaire') $$,
	'P0001', 'comment_moderation_limitee', '42 — l''administratrice ne modifie pas le commentaire d''un tiers');
update public.organization_comments set deleted_at = '2000-01-01' where id = pg_temp.id('commentaire');
select is((select body || '|' || deleted_by::text || '|' || (deleted_at = now())::text
             from public.organization_comments where id = pg_temp.id('commentaire')),
	'|' || pg_temp.id('camille')::text || '|true', '43 — elle le supprime : pierre tombale vidée, modératrice nommée');
reset role;

select pg_temp.endosser(pg_temp.id('driss'));
select throws_ok($$ update public.organization_comments set body = 'Ressuscité' where id = pg_temp.id('commentaire') $$,
	'P0001', 'comment_deleted', '44 — une pierre tombale ne se modifie plus');
reset role;

-- La notification sous la règle du sujet (§51)
select pg_temp.endosser(pg_temp.id('farida'));
with m as (update public.notifications set read_at = now()
            where subject_organization_id = pg_temp.id('vertigo') returning 1)
select is((select count(*)::int from m), 1, '45 — la lectrice lit et marque lue sa notification');
reset role;
select throws_ok($$ insert into public.notifications (workspace_id, recipient_id, type, subject_card_id, subject_organization_id)
                    values (pg_temp.id('espace'), pg_temp.id('farida'), 'mention', '5eed0000-0000-4000-8000-0000000000c2',
                            pg_temp.id('vertigo')) $$,
	'23514', null, '46 — une notification désigne au plus un sujet');

select * from finish();
rollback;

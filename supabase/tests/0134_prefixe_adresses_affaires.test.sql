-- @verifies CRM-123 (docs/BACKLOG.md) — tranche T2 : le préfixe des adresses d'affaire, réglé par espace, et la
--           régénération qui l'applique aux affaires existantes
-- @verifies docs/SPEC-cards.md §3.6 (points 1 à 8) ; docs/SPEC-plateforme.md §6.1, §6.2 ; docs/SCHEMA.md §5 ;
--           docs/JOURNAL.md décision 804 ; CLAUDE.md §10 (la garde éprouvée sous les vrais rôles)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : la colonne, son défaut `c-`, l'espace seedé resté à `c-`, la normalisation et ses refus aux limites, la
--    contrainte de la colonne et celle, élargie, de la card ; la reconnaissance exacte d'un préfixe.
-- 2. La garde : la lectrice, l'administratrice d'espace et l'anonyme ne règlent ni ne régénèrent.
-- 3. Le réglage par le superadministrateur, son journal, le `null` qui laisse le préfixe, le refus qui ne l'altère pas.
-- 4. La génération au préfixe de l'espace, la régénération limitée aux affaires hors préfixe — corbeille comprise —,
--    l'autre espace intact, le rejeu sans effet ni journal, et le classement qui suit la nouvelle adresse.
--
-- La suite pose ses fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

create or replace function pg_temp.endosser(utilisateur uuid, admin_domaine boolean default false)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated', 'lelabs_admin', admin_domaine)::text, true);
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

-- Espace seedé « p2enjoy » (…001) ; Camille …011 administratrice, Farida …013 lectrice. Le porteur de `lelabs_admin`
-- est superadministrateur (docs/SPEC-plateforme.md §2).
create temporary table depart_journal on commit drop as
	select coalesce(max(id), 0) as id from public.plateforme_journal;
grant select on depart_journal to authenticated;

-- Un second espace, avec une affaire, pour constater que la régénération ne déborde pas.
insert into public.workspaces (id, name, slug) values ('a0123000-0000-4000-8000-000000000001', 'Témoin 0134', 'temoin-0134');
insert into public.cards (id, workspace_id, title) values
	('a0123000-0000-4000-8000-0000000000c1', 'a0123000-0000-4000-8000-000000000001', 'Affaire témoin');
create temporary table temoin on commit drop as
	select email_local_part from public.cards where id = 'a0123000-0000-4000-8000-0000000000c1';

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_column('public', 'workspaces', 'card_address_prefix', 'la colonne du préfixe existe');
select col_default_is('public', 'workspaces', 'card_address_prefix', 'c-', 'son défaut est « c- »');
select col_not_null('public', 'workspaces', 'card_address_prefix', 'elle n''est jamais nulle');
select is((select card_address_prefix from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'),
	'c-', 'l''espace seedé garde « c- », et ses adresses ne changent pas à la migration');
select is((select card_address_prefix from public.workspaces where id = 'a0123000-0000-4000-8000-000000000001'),
	'c-', 'un espace créé sans préfixe reçoit « c- »');

select is(app.card_address_prefix_normalize('  APP- '), 'app-', 'la saisie est réduite en minuscules et sans blancs');
select is(app.card_address_prefix_normalize('crm+'), 'crm+', 'le « + » des serveurs à sous-adresses est admis');
select is(app.card_address_prefix_normalize('abcdefghijklmnopqrstuvwx'), 'abcdefghijklmnopqrstuvwx',
	'vingt-quatre caractères sont admis');
select throws_ok($$select app.card_address_prefix_normalize('abcdefghijklmnopqrstuvwxy')$$,
	'22023', 'invalid_card_address_prefix', 'vingt-cinq caractères sont refusés');
select throws_ok($$select app.card_address_prefix_normalize('   ')$$,
	'22023', 'invalid_card_address_prefix', 'un préfixe vide est refusé');
select throws_ok($$select app.card_address_prefix_normalize('a..b-')$$,
	'22023', 'invalid_card_address_prefix', '« .. » est refusé');
select throws_ok($$select app.card_address_prefix_normalize('-app')$$,
	'22023', 'invalid_card_address_prefix', 'un préfixe qui ne commence ni par une lettre ni par un chiffre est refusé');
select throws_ok($$select app.card_address_prefix_normalize('app*')$$,
	'22023', 'invalid_card_address_prefix', 'un caractère hors de la liste est refusé');

select throws_ok($$update public.workspaces set card_address_prefix = 'App-' where id = 'a0123000-0000-4000-8000-000000000001'$$,
	'23514', null, 'la contrainte de la colonne refuse une écriture directe hors forme');
select throws_ok($$update public.cards set email_local_part = 'C-abcdefgh' where id = 'a0123000-0000-4000-8000-0000000000c1'$$,
	'23514', null, 'la contrainte de la card refuse toujours une adresse hors forme');
select lives_ok($$update public.cards set email_local_part = 'app-abcdefgh' where id = 'a0123000-0000-4000-8000-0000000000c1'$$,
	'la contrainte de la card, élargie, admet un autre préfixe');
update public.cards set email_local_part = (select email_local_part from temoin) where id = 'a0123000-0000-4000-8000-0000000000c1';

select ok(app.card_address_has_prefix('c-abcdefgh', 'c-'), '« c-abcdefgh » porte le préfixe « c- »');
select ok(not app.card_address_has_prefix('c-abcdefgh', 'c'), '« c-abcdefgh » ne porte pas le préfixe « c » : le jeton fait huit caractères');
select ok(not app.card_address_has_prefix('c-abcdefgh', 'app-'), '« c-abcdefgh » ne porte pas le préfixe « app- »');

-- =============================================================================================
-- 2. La garde
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$select public.platform_regenerate_card_addresses('5eed0000-0000-4000-8000-000000000001')$$,
	'42501', 'reserve_aux_superadministrateurs', 'la lectrice ne régénère pas');
select throws_ok($$select public.plateforme_modifier_espace('5eed0000-0000-4000-8000-000000000001', 'P2Enjoy SAS', null, 'app-')$$,
	'42501', 'reserve_aux_superadministrateurs', 'la lectrice ne règle pas le préfixe');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$select public.platform_regenerate_card_addresses('5eed0000-0000-4000-8000-000000000001')$$,
	'42501', 'reserve_aux_superadministrateurs',
	'l''administratrice d''espace ne régénère pas : un pouvoir d''espace n''est pas de plateforme');
select throws_ok($$select public.plateforme_modifier_espace('5eed0000-0000-4000-8000-000000000001', 'P2Enjoy SAS', null, 'app-')$$,
	'42501', 'reserve_aux_superadministrateurs', 'l''administratrice d''espace ne règle pas le préfixe');
select throws_ok($$update public.workspaces set card_address_prefix = 'app-' where id = '5eed0000-0000-4000-8000-000000000001'$$,
	'42501', null, 'aucune écriture directe de la colonne par un client');
select pg_temp.redevenir_proprietaire();

select ok(not has_function_privilege('anon', 'public.platform_regenerate_card_addresses(uuid)', 'execute')
	and not has_function_privilege('anon', 'public.plateforme_modifier_espace(uuid, text, text, text)', 'execute')
	and has_function_privilege('authenticated', 'public.platform_regenerate_card_addresses(uuid)', 'execute'),
	'l''anonyme n''exécute aucune des deux fonctions ; authenticated les atteint, et la garde tranche');
select is((select pg_catalog.count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	 where n.nspname = 'public' and p.proname = 'plateforme_modifier_espace'),
	1, 'l''ancienne signature à trois arguments est retirée');

-- =============================================================================================
-- 3. Le réglage par le superadministrateur
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select lives_ok($$select public.plateforme_modifier_espace('5eed0000-0000-4000-8000-000000000001',
	(select name from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'),
	(select inbound_domain from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'), ' APP- ')$$,
	'le superadministrateur règle le préfixe');
select is((select card_address_prefix from public.plateforme_espaces() where id = '5eed0000-0000-4000-8000-000000000001'),
	'app-', 'le préfixe est enregistré normalisé, et la liste des espaces le rend');
select pg_temp.redevenir_proprietaire();

select is((select (cible -> 'avant' ->> 'card_address_prefix') || '>' || (cible -> 'apres' ->> 'card_address_prefix')
	  from public.plateforme_journal where id > (select id from depart_journal) and geste = 'espace_modifie'
	 order by id desc limit 1),
	'c->app-', 'le journal « espace_modifie » porte le préfixe avant et après');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select lives_ok($$select public.plateforme_modifier_espace('5eed0000-0000-4000-8000-000000000001',
	(select name from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'),
	(select inbound_domain from public.workspaces where id = '5eed0000-0000-4000-8000-000000000001'))$$,
	'un appel à trois arguments résout toujours');
select is((select card_address_prefix from public.plateforme_espaces() where id = '5eed0000-0000-4000-8000-000000000001'),
	'app-', 'sans préfixe transmis, le préfixe est laissé tel quel');
select throws_ok($$select public.plateforme_modifier_espace('5eed0000-0000-4000-8000-000000000001', 'P2Enjoy SAS', null, 'app*')$$,
	'22023', 'invalid_card_address_prefix', 'un préfixe hors forme est refusé par son code');
select is((select card_address_prefix from public.plateforme_espaces() where id = '5eed0000-0000-4000-8000-000000000001'),
	'app-', 'le refus laisse le préfixe inchangé');

-- =============================================================================================
-- 4. Génération, régénération, classement
-- =============================================================================================

select pg_temp.redevenir_proprietaire();
-- Une affaire née après le réglage porte le nouveau préfixe ; une affaire du seed est en corbeille.
insert into public.cards (id, workspace_id, title) values
	('a0123000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-000000000001', 'Affaire née après le réglage');
create temporary table avant_regeneration on commit drop as
	select id, email_local_part, deleted_at is not null as en_corbeille
	  from public.cards where workspace_id = '5eed0000-0000-4000-8000-000000000001';
grant select on avant_regeneration to authenticated;

select matches((select email_local_part from public.cards where id = 'a0123000-0000-4000-8000-0000000000c2'),
	'^app-[0-9abcdefghjkmnpqrstvwxyz]{8}$', 'une affaire créée après le réglage reçoit une adresse au nouveau préfixe');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013', true);
select is((select card_addresses_to_regenerate from public.plateforme_espaces() where id = '5eed0000-0000-4000-8000-000000000001'),
	(select pg_catalog.count(*)::integer from avant_regeneration where email_local_part like 'c-%'),
	'le décompte nomme les affaires hors du préfixe courant, et elles seules');
select is(public.platform_regenerate_card_addresses('5eed0000-0000-4000-8000-000000000001'),
	(select pg_catalog.count(*)::integer from avant_regeneration where email_local_part like 'c-%'),
	'la régénération rend le nombre d''affaires réécrites');
select is((select card_addresses_to_regenerate from public.plateforme_espaces() where id = '5eed0000-0000-4000-8000-000000000001'),
	0, 'plus aucune affaire hors du préfixe après la régénération');
select is(public.platform_regenerate_card_addresses('5eed0000-0000-4000-8000-000000000001'), 0,
	'le rejeu ne réécrit rien');
select pg_temp.redevenir_proprietaire();

select is((select pg_catalog.count(*)::integer from public.cards c
	 where c.workspace_id = '5eed0000-0000-4000-8000-000000000001'
	   and c.email_local_part !~ '^app-[0-9abcdefghjkmnpqrstvwxyz]{8}$'),
	0, 'toutes les adresses de l''espace sont au nouveau préfixe, à la forme générée');
select ok((select c.email_local_part like 'app-%' from public.cards c join avant_regeneration a on a.id = c.id where a.en_corbeille limit 1),
	'l''affaire en corbeille est régénérée elle aussi');
select is((select email_local_part from public.cards where id = 'a0123000-0000-4000-8000-0000000000c2'),
	(select email_local_part from avant_regeneration where id = 'a0123000-0000-4000-8000-0000000000c2'),
	'une affaire qui portait déjà le préfixe garde son adresse');
select is((select email_local_part from public.cards where id = 'a0123000-0000-4000-8000-0000000000c1'),
	(select email_local_part from temoin), 'l''affaire d''un autre espace est intacte');
select is((select pg_catalog.count(*)::integer || '|' || max(cible ->> 'card_address_prefix') || '|' || max(cible ->> 'count')
	  from public.plateforme_journal where id > (select id from depart_journal) and geste = 'card_addresses_regenerated'),
	'1|app-|' || (select pg_catalog.count(*) from avant_regeneration where email_local_part like 'c-%'),
	'une seule entrée « card_addresses_regenerated » — le rejeu sans effet ne journalise rien —, avec préfixe et nombre');

-- Le classement suit l'adresse stockée : la nouvelle désigne l'affaire, l'ancienne ne désigne plus rien.
select is(app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
	array[(select c.email_local_part || '@' || w.inbound_domain from public.cards c join public.workspaces w on w.id = c.workspace_id
	        join avant_regeneration a on a.id = c.id where not a.en_corbeille and a.email_local_part like 'c-%'
	         and app.card_has_active_placement(c.id) order by c.id limit 1)]),
	(select a.id from avant_regeneration a where not a.en_corbeille and a.email_local_part like 'c-%'
	   and app.card_has_active_placement(a.id) order by a.id limit 1),
	'la nouvelle adresse classe dans l''affaire');
select is(app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
	array[(select a.email_local_part || '@' || w.inbound_domain from avant_regeneration a
	        join public.workspaces w on w.id = '5eed0000-0000-4000-8000-000000000001'
	        where not a.en_corbeille and a.email_local_part like 'c-%' and app.card_has_active_placement(a.id)
	        order by a.id limit 1)]),
	null::uuid, 'l''ancienne adresse ne classe plus');

select * from finish();

rollback;

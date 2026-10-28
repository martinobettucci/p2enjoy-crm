-- @verifies CRM-069 (docs/BACKLOG.md) — tranche T1 : les étiquettes en base
-- @verifies docs/SPEC-etiquettes-digest.md §2.1 (catalogue : écriture administrateur, lecture membre, palette fermée, nom
--           unique parmi les non archivées), §2.2 (posées par qui écrit l'affaire, espace et auteur posés par la base,
--           étiquette archivée refusée, étiquette d'un autre espace refusée, le fil) ; docs/JOURNAL.md décisions 769 et 771
--
-- Joué sous le rôle `authenticated` de Camille (administratrice), Driss (business developer) et Farida (lectrice). Le
-- `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

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
create temp table pg_temp.ctx (cle text primary key, valeur uuid);
grant all on pg_temp.ctx to authenticated;

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set channel '\'5eed0000-0000-4000-8000-000000000036\''

-- =============================================================================================
-- 1. Le contrat des tables
-- =============================================================================================

select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.labels'::regclass, 'public.card_labels'::regclass)), '1 — la RLS est activée sur les deux tables');
select ok(
	not has_table_privilege('authenticated', 'public.labels', 'DELETE')
	and not has_column_privilege('authenticated', 'public.labels', 'created_by', 'INSERT')
	and not has_column_privilege('authenticated', 'public.card_labels', 'workspace_id', 'INSERT')
	and not has_column_privilege('authenticated', 'public.card_labels', 'created_by', 'INSERT')
	and not has_table_privilege('authenticated', 'public.card_labels', 'UPDATE')
	and not has_table_privilege('anon', 'public.labels', 'SELECT'),
	'2 — aucune suppression du catalogue ; l''espace et l''auteur d''une pose sont posés par la base ; rien pour anon');

-- =============================================================================================
-- 2. Le catalogue : l'administratrice écrit, la lectrice lit
-- =============================================================================================

select pg_temp.endosser(:camille);
select lives_ok($$ with pose as (
	insert into public.labels (workspace_id, name, color)
	values ('5eed0000-0000-4000-8000-000000000001', 'ZZ Prioritaire', 'danger') returning id)
	insert into pg_temp.ctx select 'prioritaire', id from pose $$, '3 — l''administratrice pose une étiquette');
select is((select created_by from public.labels where id = (select valeur from pg_temp.ctx where cle = 'prioritaire')),
	:camille::uuid, '4 — la base la signe');
select throws_ok($$ insert into public.labels (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'zz PRIORITAIRE') $$,
	'23505', null, '5 — un nom déjà pris, à la casse près, est refusé');
select throws_ok($$ insert into public.labels (workspace_id, name, color)
	values ('5eed0000-0000-4000-8000-000000000001', 'ZZ Violet', 'purple') $$,
	'23514', null, '6 — une couleur hors de la palette fermée est refusée');
select throws_ok($$ insert into public.labels (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '   ') $$,
	'23514', null, '7 — un nom blanc est refusé');
with pose as (
	insert into public.labels (workspace_id, name) values ('5eed0000-0000-4000-8000-000000000001', 'ZZ Ancienne')
	returning id)
insert into pg_temp.ctx select 'ancienne', id from pose;
update public.labels set archived_at = now() where id = (select valeur from pg_temp.ctx where cle = 'ancienne');
select lives_ok($$ insert into public.labels (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'ZZ Ancienne') $$, '8 — archiver libère le nom');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.labels (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'ZZ Interdite') $$,
	'42501', null, '9 — le business developer n''écrit pas le catalogue');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:farida);
select is((select count(*)::int from public.labels where name = 'ZZ Prioritaire'), 1, '10 — la lectrice lit le catalogue');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. Poser et retirer une étiquette sur une affaire
-- =============================================================================================

select pg_temp.endosser(:driss);
insert into pg_temp.ctx select 'affaire', public.creer_affaire(:channel, 'ZZ Affaire étiquetée');
select lives_ok($$ insert into public.card_labels (card_id, label_id)
	select (select valeur from pg_temp.ctx where cle = 'affaire'), (select valeur from pg_temp.ctx where cle = 'prioritaire') $$,
	'11 — qui écrit l''affaire y pose une étiquette');
select pg_temp.redevenir_proprietaire();

select is((select workspace_id::text || '|' || created_by::text from public.card_labels
            where card_id = (select valeur from pg_temp.ctx where cle = 'affaire')),
	'5eed0000-0000-4000-8000-000000000001|5eed0000-0000-4000-8000-000000000012',
	'12 — l''espace est celui de l''affaire, l''auteur celui qui pose');
select is((select actor_id::text || '|' || (payload ->> 'name') from public.card_events
            where card_id = (select valeur from pg_temp.ctx where cle = 'affaire') and type = 'label_added'),
	'5eed0000-0000-4000-8000-000000000012|ZZ Prioritaire', '13 — le fil nomme l''étiquette et la personne');

select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.card_labels (card_id, label_id)
	select (select valeur from pg_temp.ctx where cle = 'affaire'), (select valeur from pg_temp.ctx where cle = 'ancienne') $$,
	'22023', 'label_archived', '14 — une étiquette archivée n''est plus posée');
select pg_temp.redevenir_proprietaire();

-- Une étiquette d'un AUTRE espace, posée par le propriétaire pour la preuve.
insert into public.workspaces (id, name, slug) values ('5eed0000-0000-4000-8000-0000000e7101', 'ZZ Ailleurs', 'zz-ailleurs');
with pose as (
	insert into public.labels (workspace_id, name) values ('5eed0000-0000-4000-8000-0000000e7101', 'ZZ Étrangère')
	returning id)
insert into pg_temp.ctx select 'etrangere', id from pose;

select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.card_labels (card_id, label_id)
	select (select valeur from pg_temp.ctx where cle = 'affaire'), (select valeur from pg_temp.ctx where cle = 'etrangere') $$,
	'23503', null, '15 — une étiquette d''un autre espace est refusée');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:farida);
select is((select count(*)::int from public.card_labels where card_id = (select valeur from pg_temp.ctx where cle = 'affaire')),
	1, '16 — la lectrice lit les étiquettes d''une affaire qu''elle lit');
select throws_ok($$ insert into public.card_labels (card_id, label_id)
	select (select valeur from pg_temp.ctx where cle = 'affaire'),
	       (select id from public.labels where name = 'ZZ Ancienne' and archived_at is null) $$,
	'42501', null, '17 — la lectrice ne pose rien');
delete from public.card_labels where card_id = (select valeur from pg_temp.ctx where cle = 'affaire');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.card_labels where card_id = (select valeur from pg_temp.ctx where cle = 'affaire')),
	1, '18 — son retrait est filtré par la politique : rien n''est retiré');

select pg_temp.endosser(:driss);
delete from public.card_labels where card_id = (select valeur from pg_temp.ctx where cle = 'affaire');
select pg_temp.redevenir_proprietaire();
select is((select actor_id::text || '|' || (payload ->> 'name') from public.card_events
            where card_id = (select valeur from pg_temp.ctx where cle = 'affaire') and type = 'label_removed'),
	'5eed0000-0000-4000-8000-000000000012|ZZ Prioritaire', '19 — le retrait est tracé au fil');

-- Une affaire effacée emporte ses étiquettes sans que le fil l'en empêche.
insert into public.card_labels (card_id, label_id)
select (select valeur from pg_temp.ctx where cle = 'affaire'), (select valeur from pg_temp.ctx where cle = 'prioritaire');
select lives_ok($$ delete from public.cards where id = (select valeur from pg_temp.ctx where cle = 'affaire') $$,
	'20 — l''effacement d''une affaire étiquetée passe, sans ligne de fil orpheline');

select * from finish();
rollback;

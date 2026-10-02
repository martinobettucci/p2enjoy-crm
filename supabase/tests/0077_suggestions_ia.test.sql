-- @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : les suggestions de l'assistant IA et leur historique
-- @verifies docs/SPEC-ia.md §2 (rien dans la configuration avant « Accepter »), §5, §11.2 (qui écrit quoi),
--           §11.4 (le verrou) ; docs/SCHEMA.md §9 ter ; docs/JOURNAL.md décision 617
-- @verifies CLAUDE.md §10 (le refus vient de la base, avec les rôles réels)
--
-- Ce que ce fichier tient le plus fort : seuls les ADMINISTRATEURS de l'espace atteignent l'assistant,
-- un client ne peut faire passer sa correction pour une suggestion du modèle, ni accepter par une simple
-- mise à jour, et une suggestion décidée est figée. Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W',    '0c970000-0000-4000-8000-0000000000e1'),
	('W2',   '0c970000-0000-4000-8000-0000000000e2'),
	('ADM',  '0c970000-0000-4000-8000-000000000011'),
	('BIZ',  '0c970000-0000-4000-8000-000000000012'),
	('LECT', '0c970000-0000-4000-8000-000000000013'),
	('ETR',  '0c970000-0000-4000-8000-000000000014'),
	('S1',   '0c970000-0000-4000-8000-0000000000a1'),
	('S2',   '0c970000-0000-4000-8000-0000000000a2');
grant select on ids to authenticated, service_role;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated;

insert into public.workspaces (id, name, slug) values
	(pg_temp.id('W'), 'Espace 0077', 'espace-0077'),
	(pg_temp.id('W2'), 'Autre espace 0077', 'autre-espace-0077');
insert into public.profiles (id, full_name) values
	(pg_temp.id('ADM'), 'Administratrice 0077'),
	(pg_temp.id('BIZ'), 'Commercial 0077'),
	(pg_temp.id('LECT'), 'Lectrice 0077'),
	(pg_temp.id('ETR'), 'Étrangère 0077');
insert into public.workspace_members (workspace_id, user_id, role) values
	(pg_temp.id('W'), pg_temp.id('ADM'), 'admin'),
	(pg_temp.id('W'), pg_temp.id('BIZ'), 'business_developer'),
	(pg_temp.id('W'), pg_temp.id('LECT'), 'viewer'),
	(pg_temp.id('W2'), pg_temp.id('ETR'), 'admin');

select pg_temp.endosser(pg_temp.id('ADM'));
insert into mesures values ('workflow', public.creer_workflow_de_depart(pg_temp.id('W'))::text);
reset role;

-- =============================================================================================
-- 1. Les tables et leurs privilèges
-- =============================================================================================

select ok(
	(select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.suggestions_ia'::regclass)
	and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.suggestions_ia_revisions'::regclass),
	'1 — RLS activée et forcée sur les deux tables');
select ok(
	has_column_privilege('authenticated', 'public.suggestions_ia', 'demande', 'INSERT')
	and not has_column_privilege('authenticated', 'public.suggestions_ia', 'empreinte_initiale', 'INSERT')
	and not has_column_privilege('authenticated', 'public.suggestions_ia', 'created_by', 'INSERT')
	and has_column_privilege('authenticated', 'public.suggestions_ia', 'statut', 'UPDATE')
	and not has_column_privilege('authenticated', 'public.suggestions_ia', 'derniere_erreur', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.suggestions_ia', 'DELETE'),
	'2 — le client crée, verrouille et abandonne : ni empreinte, ni auteur, ni erreur, ni suppression');
select ok(
	not has_table_privilege('authenticated', 'public.suggestions_ia_revisions', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.suggestions_ia_revisions', 'DELETE')
	and not has_column_privilege('authenticated', 'public.suggestions_ia_revisions', 'modele', 'INSERT'),
	'3 — une révision ne se modifie ni ne s''efface, et le client n''écrit pas de mesure de génération');

-- =============================================================================================
-- 2. L'administratrice crée ; l'empreinte est calculée par la base
-- =============================================================================================

-- L'identifiant n'est pas choisi par le client (aucun privilège sur `id`) : il est RELU de l'insertion,
-- comme la fonction `ia` le relit.
select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (
	insert into public.suggestions_ia (workspace_id, portee, demande, generation_depuis)
	values (pg_temp.id('W'), 'workflow', 'Un cycle de vente pour une agence web', now())
	returning id)
insert into mesures select 'S1', id::text from cree;
with cree as (
	insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
	values (pg_temp.id('W'), (select valeur::uuid from mesures where cle = 'workflow'), 'etapes',
	        'Ajoute une étape de maquette')
	returning id)
insert into mesures select 'S2', id::text from cree;
reset role;
update ids set valeur = (select valeur::uuid from mesures where cle = ids.nom) where nom in ('S1', 'S2');

select is(
	(select statut || '|' || coalesce(empreinte_initiale, 'nulle') || '|' || created_by::text
	   from public.suggestions_ia where id = pg_temp.id('S1')),
	'en_revue|nulle|' || pg_temp.id('ADM')::text,
	'4 — une création de workflow naît en revue, sans empreinte, signée par son auteur');
select is(
	(select empreinte_initiale from public.suggestions_ia where id = pg_temp.id('S2')),
	app.workflow_composition_fingerprint((select valeur::uuid from mesures where cle = 'workflow')),
	'5 — pour un workflow existant, la base calcule l''empreinte de composition');

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande, empreinte_initiale)
	  values (pg_temp.id('W'), 'workflow', 'x', repeat('a', 64))$$,
	'42501', null,
	'6 — une empreinte fournie par le client est refusée par le privilège');
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'etapes', 'x')$$,
	'23514', null,
	'7 — une portée autre que `workflow` exige un workflow cible');
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', '   ')$$,
	'23514', null,
	'8 — une demande blanche est refusée');
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', repeat('a', 4001))$$,
	'23514', null,
	'9 — une demande de plus de 4 000 caractères est refusée');
reset role;

-- =============================================================================================
-- 3. Les autres rôles : refusés par la base
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('BIZ'));
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'x')$$,
	'42501', null,
	'10 — le commercial ne crée aucune suggestion (RLS)');
select is((select count(*)::int from public.suggestions_ia), 0, '11 — le commercial ne lit aucune suggestion');
update public.suggestions_ia set generation_depuis = now() where id = pg_temp.id('S2');
insert into mesures select 'biz_verrou', count(*)::text from public.suggestions_ia where generation_depuis is not null;
reset role;
select is(
	(select generation_depuis is null from public.suggestions_ia where id = pg_temp.id('S2')),
	true,
	'12 — le commercial ne pose aucun verrou de génération');

select pg_temp.endosser(pg_temp.id('LECT'));
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'x')$$,
	'42501', null,
	'13 — la lectrice ne crée aucune suggestion');
select is((select count(*)::int from public.suggestions_ia_revisions), 0, '14 — la lectrice ne lit aucune révision');
reset role;

select pg_temp.endosser(pg_temp.id('ETR'));
select is((select count(*)::int from public.suggestions_ia), 0,
	'15 — l''administratrice d''un AUTRE espace ne lit rien');
select throws_ok(
	$$insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'x')$$,
	'42501', null,
	'16 — l''administratrice d''un autre espace ne crée rien dans celui-ci');
reset role;

-- =============================================================================================
-- 4. Les révisions : le client corrige, la fonction (clé de service) suggère
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
insert into public.suggestions_ia_revisions (suggestion_id, origine, consigne, proposition)
values (pg_temp.id('S1'), 'correction', 'renommé', '{"version": 1}');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
	  values (pg_temp.id('S1'), 'ia', '{"version": 1}')$$,
	'42501', null,
	'17 — le client ne fait pas passer sa révision pour une suggestion du modèle');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition, defauts)
	  values (pg_temp.id('S1'), 'correction', '{"version": 1}', '{}')$$,
	'23514', null,
	'18 — les défauts sont un tableau');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
	  values (pg_temp.id('S1'), 'correction', '{"etapes": []}')$$,
	'23514', null,
	'19 — une proposition sans version est refusée');
reset role;

set local role service_role;
insert into public.suggestions_ia_revisions
	(suggestion_id, workspace_id, origine, consigne, proposition, modele, jetons_entree, jetons_sortie, duree_ms, created_by)
values (pg_temp.id('S1'), pg_temp.id('W2'), 'ia', 'Un cycle de vente', '{"version": 1}', 'gemma4:e2b', 537, 668, 32500, pg_temp.id('ADM'));
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.id('S1'), 'ia', '{"version": 1}')$$,
	'23514', null,
	'20 — une révision du modèle porte ses mesures');
select throws_ok(
	$$update public.suggestions_ia_revisions set consigne = 'réécrite' where suggestion_id = pg_temp.id('S1')$$,
	'P0001', 'revision immuable',
	'21 — une révision est immuable, même pour la clé de service');
reset role;

select is(
	(select string_agg(numero::text || ':' || origine || ':' || (workspace_id = pg_temp.id('W'))::text, ',' order by numero)
	   from public.suggestions_ia_revisions where suggestion_id = pg_temp.id('S1')),
	'1:correction:true,2:ia:true',
	'22 — les numéros se suivent, et l''espace d''une révision est RECOPIÉ de sa suggestion, jamais reçu');

-- =============================================================================================
-- 5. Décider : abandonner fige ; accepter n'appartient pas au client
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(
	$$update public.suggestions_ia set statut = 'acceptee' where id = pg_temp.id('S2')$$,
	'42501', null,
	'23 — le client n''accepte pas par une mise à jour : l''acceptation est un geste');
update public.suggestions_ia set statut = 'abandonnee' where id = pg_temp.id('S1');
reset role;

select is(
	(select statut || '|' || (decided_at is not null)::text || '|' || decided_by::text || '|' || (generation_depuis is null)::text
	   from public.suggestions_ia where id = pg_temp.id('S1')),
	'abandonnee|true|' || pg_temp.id('ADM')::text || '|true',
	'24 — abandonner date et signe la décision, et lève le verrou de génération');

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(
	$$update public.suggestions_ia set statut = 'en_revue' where id = pg_temp.id('S1')$$,
	'P0001', 'suggestion figee',
	'25 — une suggestion décidée ne revient pas en revue');
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition)
	  values (pg_temp.id('S1'), 'correction', '{"version": 1}')$$,
	'P0001', 'suggestion figee',
	'26 — une suggestion décidée n''accepte plus de révision');
reset role;

set local role service_role;
select throws_ok(
	$$insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition, modele, jetons_entree, jetons_sortie, duree_ms)
	  values (pg_temp.id('S1'), 'ia', '{"version": 1}', 'gemma4:e2b', 1, 1, 1)$$,
	'P0001', 'suggestion figee',
	'27 — une génération qui finit après l''abandon n''écrit rien, même par la clé de service');
reset role;

-- =============================================================================================
-- 6. Rien dans la configuration
-- =============================================================================================

select is(
	(select count(*)::int from public.workflows where workspace_id = pg_temp.id('W')),
	1,
	'28 — aucune suggestion n''a écrit de workflow : seul celui de départ existe');

-- =============================================================================================
-- 7. La suppression : jamais par un client, toujours par cascade
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
select throws_ok(
	$$delete from public.suggestions_ia_revisions where suggestion_id = pg_temp.id('S1')$$,
	'42501', null,
	'29 — l''administratrice n''efface aucune révision');
reset role;

set local role service_role;
delete from public.suggestions_ia where id = pg_temp.id('S1');
reset role;
select is(
	(select count(*)::int from public.suggestions_ia_revisions where suggestion_id = pg_temp.id('S1')),
	0,
	'30 — supprimer une suggestion emporte ses révisions : l''immuabilité ne bloque aucune cascade');

select * from finish();
rollback;

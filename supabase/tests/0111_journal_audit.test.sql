-- @verifies CRM-072 (docs/BACKLOG.md) — tranche T1 : le journal d'audit en base
-- @verifies docs/SPEC-audit.md §3.2 (seuls les administrateurs lisent), §3.3 (personne n'écrit, sauf la base), §3.4
--           (l'ajout seul des trois journaux, propriétaire compris, et ses deux exceptions), §4 (chaque famille de
--           gestes), §5 (ce que `details` contient, et ce qu'il tait), §6 (la purge d'un an, journalisée) ;
--           docs/SPEC-permissions-rls.md §4 (ligne `audit_log`) ; docs/JOURNAL.md décisions 708, 725 et 726
--
-- LES GESTES SONT JOUÉS PAR LE PROPRIÉTAIRE DE LA BASE, AVEC L'IDENTITÉ DE CAMILLE dans les claims : `auth.uid()` la
-- désigne, la RLS des tables métier ne s'interpose pas, et c'est le déclencheur qu'on juge. La lecture, elle, est jugée
-- sous le rôle `authenticated` de chaque personne. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

create or replace function pg_temp.claims(utilisateur uuid) returns void language sql as $$
	select set_config('request.jwt.claims',
		case when utilisateur is null then '' else json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text end,
		true);
$$;
create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform pg_temp.claims(utilisateur);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform pg_temp.claims(null);
end;
$$;
-- La dernière entrée écrite, et le nombre d'entrées.
create or replace function pg_temp.derniere() returns jsonb language sql as $$
	select to_jsonb(l) from public.audit_log l order by l.id desc limit 1;
$$;
create or replace function pg_temp.n() returns bigint language sql as $$ select count(*) from public.audit_log; $$;
create temporary table pg_temp_compte (nom text primary key, valeur bigint);

-- Les acteurs : Camille (admin), Driss (business developer), Farida (lectrice) ; Sabine n'est membre de rien.
\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set sabine '\'5eed0000-0000-4000-8000-000000000018\''

-- =============================================================================================
-- 1. La table, ses privilèges — §3.1 à §3.3
-- =============================================================================================

select has_table('public', 'audit_log', '1 — la table audit_log existe');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), '2 — sa RLS est activée');
select ok(has_table_privilege('authenticated', 'public.audit_log', 'select')
	and not has_table_privilege('authenticated', 'public.audit_log', 'insert')
	and not has_table_privilege('authenticated', 'public.audit_log', 'update')
	and not has_table_privilege('authenticated', 'public.audit_log', 'delete'),
	'3 — authenticated : la lecture seule');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'insert')
	and not has_table_privilege('service_role', 'public.audit_log', 'update')
	and not has_table_privilege('service_role', 'public.audit_log', 'delete')
	and not has_table_privilege('service_role', 'public.audit_log', 'truncate'),
	'4 — la clé de service n''écrit pas le journal');
select ok(not has_table_privilege('anon', 'public.audit_log', 'select'), '5 — l''anonyme ne le lit pas');
select ok(not has_function_privilege('authenticated', 'app.audit_record(uuid, text, text, uuid, text, jsonb, uuid)', 'execute')
	and not has_function_privilege('service_role', 'app.audit_record(uuid, text, text, uuid, text, jsonb, uuid)', 'execute'),
	'6 — l''écrivain est fermé à tous les rôles applicatifs');

-- =============================================================================================
-- 2. Droits et appartenances — §4.1
-- =============================================================================================

select pg_temp.claims(:camille);

insert into public.workspace_members (workspace_id, user_id, role) values (:ws, :sabine, 'viewer');
select is(pg_temp.derniere() - 'id' - 'occurred_at' - 'entity_id',
	jsonb_build_object('workspace_id', :ws, 'actor_id', :camille, 'family', 'access', 'action', 'added',
		'entity_type', 'member', 'entity_label', 'Sabine Plateforme',
		'details', jsonb_build_object('user_id', :sabine, 'role', 'viewer')),
	'7 — un membre ajouté : famille access, acteur Camille, nom et rôle');

update public.workspace_members set role = 'business_developer' where workspace_id = :ws and user_id = :sabine;
select is(pg_temp.derniere() -> 'details', jsonb_build_object('user_id', :sabine, 'before', 'viewer', 'after', 'business_developer'),
	'8 — un rôle changé : avant et après');

insert into pg_temp_compte values ('avant_maj_vide', pg_temp.n());
update public.workspace_members set role = 'business_developer' where workspace_id = :ws and user_id = :sabine;
select is(pg_temp.n(), (select valeur from pg_temp_compte where nom = 'avant_maj_vide'),
	'9 — une mise à jour sans changement de rôle n''écrit rien');

delete from public.workspace_members where workspace_id = :ws and user_id = :sabine;
select is(pg_temp.derniere() ->> 'action', 'removed', '10 — un membre retiré');

insert into public.workspace_invitations (workspace_id, email, role, invited_by)
values (:ws, 'audit@p2enjoy.test', 'viewer', :camille);
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action', pg_temp.derniere() ->> 'entity_label'],
	array['invitation', 'created', 'audit@p2enjoy.test'], '11 — une invitation posée, l''adresse en libellé');
delete from public.workspace_invitations where workspace_id = :ws and email = 'audit@p2enjoy.test';
select is(pg_temp.derniere() ->> 'action', 'removed', '12 — une invitation retirée');

insert into public.track_members (track_id, user_id, access)
values ('5eed0000-0000-4000-8000-000000000022', :farida, 'viewer')
on conflict (track_id, user_id) do update set access = 'viewer';
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action',
		pg_temp.derniere() -> 'details' ->> 'after', pg_temp.derniere() ->> 'workspace_id'],
	array['track_access', 'granted', 'viewer', :ws],
	'13 — un accès de track accordé, l''espace lu sur le track');
delete from public.track_members where track_id = '5eed0000-0000-4000-8000-000000000022' and user_id = :farida;
select is(pg_temp.derniere() ->> 'action', 'revoked', '14 — un accès de track retiré');

insert into public.channel_members (channel_id, user_id, access)
values ('5eed0000-0000-4000-8000-000000000033', :farida, 'member')
on conflict (channel_id, user_id) do update set access = 'member';
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action'],
	array['channel_access', 'granted'], '15 — un accès de channel accordé');

-- =============================================================================================
-- 3. Configuration — §4.2, §5
-- =============================================================================================

insert into public.tracks (workspace_id, name, slug) values (:ws, 'Audit éphémère', 'audit-ephemere');
select is(array[pg_temp.derniere() ->> 'family', pg_temp.derniere() ->> 'action', pg_temp.derniere() ->> 'entity_label'],
	array['configuration', 'created', 'Audit éphémère'], '16 — un track créé : famille configuration');

insert into pg_temp_compte values ('avant_position', pg_temp.n());
update public.tracks set position = position + 1000 where slug = 'audit-ephemere' and workspace_id = :ws;
select is(pg_temp.n(), (select valeur from pg_temp_compte where nom = 'avant_position'),
	'17 — déplacer un track (position seule) n''écrit rien');

update public.tracks set name = 'Audit renommé' where slug = 'audit-ephemere' and workspace_id = :ws;
select is(pg_temp.derniere() -> 'details',
	jsonb_build_object('changed', jsonb_build_array('name'),
		'before', jsonb_build_object('name', 'Audit éphémère'), 'after', jsonb_build_object('name', 'Audit renommé')),
	'18 — un track renommé : la colonne changée, avant et après');

update public.workspaces set settings = settings || jsonb_build_object('audit_cle_secrete', 'valeur-a-taire') where id = :ws;
select is(pg_temp.derniere() -> 'details' -> 'settings_keys', jsonb_build_array('audit_cle_secrete'),
	'19 — un réglage changé : sa clé est nommée');
select ok(position('valeur-a-taire' in (pg_temp.derniere())::text) = 0,
	'20 — … et sa valeur n''est jamais recopiée (§5)');

-- L'étape et le workflow sont choisis dans l'espace, jamais par un identifiant : le seed crée les workflows dérivés avec
-- des identifiants neufs à chaque reconstruction (défaut relevé sur base reconstruite, assertions 21 et 22).
-- `CRM-118` T1.b (migration 0130) : un workflow employé par un channel ne s'archive plus ; l'archivage journalisé porte
-- donc sur un workflow libre, posé ici (rendu par le rollback).
insert into public.workflows (id, workspace_id, name)
values ('11820000-0000-4000-8000-000000000001', :ws, 'pgTAP audit — workflow libre');
create temporary table pg_temp_cible as
select (select s.id from public.workflow_steps s where s.workspace_id = :ws
         and s.stale_after_days is distinct from 21 order by s.id limit 1) as etape,
       '11820000-0000-4000-8000-000000000001'::uuid as workflow;
update public.workflow_steps set stale_after_days = 21 where id = (select etape from pg_temp_cible);
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action',
		pg_temp.derniere() -> 'details' -> 'after' ->> 'stale_after_days'],
	array['workflow_step', 'updated', '21'], '21 — une étape de workflow modifiée');

update public.workflows set archived_at = now() where id = (select workflow from pg_temp_cible);
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action'], array['workflow', 'archived'],
	'22 — un workflow archivé');

-- =============================================================================================
-- 4. Effacements et corbeille — §4.3
-- =============================================================================================

update public.cards set deleted_at = now(), deleted_by = :camille where id = '5eed0000-0000-4000-8000-00000000d010';
select is(array[pg_temp.derniere() ->> 'family', pg_temp.derniere() ->> 'action', pg_temp.derniere() ->> 'entity_label'],
	array['deletion', 'trashed', 'Mise à niveau PHP — intranet Duchamp'], '23 — une affaire mise à la corbeille');
update public.cards set deleted_at = null, deleted_by = null where id = '5eed0000-0000-4000-8000-00000000d010';
select is(pg_temp.derniere() ->> 'action', 'restored', '24 — une affaire restaurée');

update public.card_comments set deleted_at = now(), deleted_by = :camille where id = '5eed0000-0000-4000-8000-0000000000d1';
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action',
		pg_temp.derniere() ->> 'entity_label', pg_temp.derniere() -> 'details' ->> 'card_id'],
	array['comment', 'deleted', null, '5eed0000-0000-4000-8000-0000000000c1'],
	'25 — un commentaire retiré : sans libellé (un contenu), l''affaire nommée');

delete from public.card_contacts where contact_id = '5eed0000-0000-4000-8000-000000000092';
delete from public.card_activity_participants where contact_id = '5eed0000-0000-4000-8000-000000000092';
delete from public.contacts where id = '5eed0000-0000-4000-8000-000000000092';
select is(array[pg_temp.derniere() ->> 'family', pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action',
		pg_temp.derniere() ->> 'entity_label'],
	array['deletion', 'contact', 'deleted', null], '26 — un contact supprimé : jamais son nom (§7.3)');

delete from public.tracks where slug = 'audit-ephemere' and workspace_id = :ws;
select is(array[pg_temp.derniere() ->> 'entity_type', pg_temp.derniere() ->> 'action'], array['track', 'destroyed'],
	'27 — un track détruit définitivement');

-- =============================================================================================
-- 5. Connexions — §4.4
-- =============================================================================================

select pg_temp.claims(null);
insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
values (:driss, decode(repeat('ab', 32), 'hex'), 'jeton-de-rafraichissement-de-test', now() + interval '1 hour');
select is(array[pg_temp.derniere() ->> 'family', pg_temp.derniere() ->> 'action', pg_temp.derniere() ->> 'actor_id',
		pg_temp.derniere() ->> 'workspace_id'],
	array['sign_in', 'signed_in', :driss, :ws],
	'28 — une connexion : l''acteur est la personne, pas l''échangeur à la clé de service');
select ok(position('jeton-de-rafraichissement' in (pg_temp.derniere())::text) = 0, '29 — … et aucun jeton n''est recopié');

-- =============================================================================================
-- 6. Rien pour un espace qui disparaît — §3.3, §6.3
-- =============================================================================================

insert into public.workspaces (id, name, slug) values ('a0d17000-0000-4000-8000-000000000001', 'Espace éphémère', 'espace-ephemere');
insert into public.workspace_members (workspace_id, user_id, role)
values ('a0d17000-0000-4000-8000-000000000001', :camille, 'admin');
insert into public.tracks (workspace_id, name, slug) values ('a0d17000-0000-4000-8000-000000000001', 'Éphémère', 'ephemere');
insert into pg_temp_compte values ('avant_suppression_espace', pg_temp.n());
delete from public.workspaces where id = 'a0d17000-0000-4000-8000-000000000001';
select is(pg_temp.n(), (select valeur from pg_temp_compte where nom = 'avant_suppression_espace'),
	'30 — supprimer un espace n''écrit rien : la cascade ne produit aucune entrée orpheline');

-- =============================================================================================
-- 7. L'ajout seul, propriétaire compris — §3.4
-- =============================================================================================

select throws_ok($$ update public.audit_log set details = '{}' where id = (select max(id) from public.audit_log) $$,
	'P0001', 'audit_log_immutable', '31 — le propriétaire ne modifie pas une entrée');
select throws_ok($$ delete from public.audit_log where id = (select max(id) from public.audit_log) $$,
	'P0001', 'audit_log_immutable', '32 — le propriétaire ne supprime pas une entrée');
select throws_ok($$ truncate public.audit_log $$, 'P0001', 'audit_log_immutable', '33 — ni ne vide le journal');
select throws_ok($$ select set_config('app.audit_purge', 'on', true);
                   delete from public.audit_log where id = (select max(id) from public.audit_log) $$,
	'P0001', 'audit_log_immutable', '34 — même la variable de purge posée, une entrée récente ne s''efface pas');
select set_config('app.audit_purge', 'off', true);
select lives_ok($$ update public.audit_log set actor_id = null where id = (
		select max(id) from public.audit_log where actor_id is not null) $$,
	'35 — exception 1 : l''acteur passé à null seul (la suppression d''un profil)');
select throws_ok($$ update public.audit_log set actor_id = null, entity_label = 'x' where id = (
		select max(id) from public.audit_log where actor_id is not null) $$,
	'P0001', 'audit_log_immutable', '36 — … mais rien d''autre avec lui');
select throws_ok($$ update public.plateforme_journal set cible = '{}' where id = (select max(id) from public.plateforme_journal) $$,
	'P0001', 'audit_log_immutable', '37 — plateforme_journal : même règle');
insert into public.mcp_journal (sub, outil, workspace_id, issue, duree_ms) values (:camille, 'crm_card_get', :ws, 'ok', 3);
select throws_ok($$ delete from public.mcp_journal where id = (select max(id) from public.mcp_journal) $$,
	'P0001', 'audit_log_immutable', '38 — mcp_journal : même règle');

-- =============================================================================================
-- 8. La purge — §6
-- =============================================================================================
-- Des entrées vieilles de 400 jours, posées directement par le propriétaire : l'ajout est permis, la date est libre
-- pour lui seul. Le seed n'en fabrique jamais.

insert into public.audit_log (workspace_id, family, action, entity_type, entity_label, occurred_at)
values (:ws, 'configuration', 'created', 'track', 'Très ancien', now() - interval '400 days'),
       (:ws, 'configuration', 'created', 'track', 'Ancien aussi', now() - interval '370 days'),
       (:ws, 'configuration', 'created', 'track', 'Récent', now() - interval '300 days');
insert into public.plateforme_journal (geste, cible, cree_le) values ('espace_modifie', '{}', now() - interval '400 days');
insert into public.mcp_journal (sub, outil, issue, duree_ms, cree_le)
values (:camille, 'crm_search', 'ok', 1, now() - interval '400 days');

select is(app.purge_audit_logs(), 4, '39 — la purge efface les quatre entrées de plus d''un an des trois journaux');
select is((select array_agg(entity_label order by entity_label) from public.audit_log
            where entity_label in ('Très ancien', 'Ancien aussi', 'Récent')),
	array['Récent'], '40 — … et garde celle de 300 jours');
select is(array[pg_temp.derniere() ->> 'family', pg_temp.derniere() ->> 'action', pg_temp.derniere() -> 'details' ->> 'count'],
	array['retention', 'purged', '2'], '41 — l''effacement est journalisé dans l''espace, avec son compte');
select is((select cible - 'before' from public.plateforme_journal where geste = 'logs_purged' order by id desc limit 1),
	jsonb_build_object('platform', 1, 'connector', 1), '42 — et à la plateforme, pour ses deux journaux');
insert into pg_temp_compte values ('avant_purge_vide', pg_temp.n());
select is(app.purge_audit_logs(), 0, '43 — une purge sans rien à effacer rend 0 …');
select is(pg_temp.n(), (select valeur from pg_temp_compte where nom = 'avant_purge_vide'), '44 — … et n''écrit rien');

-- =============================================================================================
-- 9. Qui lit — §3.2
-- =============================================================================================

select pg_temp.endosser(:camille);
select ok((select count(*) from public.audit_log) > 0, '45 — Camille, administratrice, lit le journal de son espace');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:driss);
create temporary table pg_temp_lu as select (select count(*) from public.audit_log) as driss;
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:farida);
update pg_temp_lu set driss = driss + (select count(*) from public.audit_log);
select pg_temp.redevenir_proprietaire();
select is((select driss from pg_temp_lu), 0::bigint,
	'46 — le business developer et la lectrice ne lisent rien du journal (RLS, pas l''écran)');

select * from finish();
rollback;

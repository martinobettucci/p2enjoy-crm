-- @verifies CRM-068 (docs/BACKLOG.md) — tranche T4a : les modèles d'affaires, en base
-- @verifies docs/SPEC-checklists.md §3.5 (`card_templates` : écriture administrateur, lecture membre, nom unique parmi les
--           non archivés, valeurs validées par la règle d'une valeur d'affaire), §3.6 (`creer_affaire` applique le modèle,
--           `save_card_as_template`) ; docs/JOURNAL.md décisions 747 à 749
--
-- Joué sous le rôle `authenticated` de Camille (administratrice), Driss (business developer) et Farida (lectrice). Le
-- `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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
\set wf '\'5eed0000-0000-4000-8000-000000000051\''
\set channel '\'5eed0000-0000-4000-8000-000000000036\''

-- =============================================================================================
-- 1. Le contrat de la table
-- =============================================================================================

select ok((select relrowsecurity from pg_class where oid = 'public.card_templates'::regclass), '1 — la RLS est activée');
select ok(
	not has_table_privilege('authenticated', 'public.card_templates', 'DELETE')
	and not has_column_privilege('authenticated', 'public.card_templates', 'created_by', 'INSERT')
	and not has_column_privilege('authenticated', 'public.card_templates', 'created_by', 'UPDATE'),
	'2 — aucune suppression, l''auteur posé par la base');

-- =============================================================================================
-- 2. L'écriture est à l'administratrice, la lecture à tout membre
-- =============================================================================================

select pg_temp.endosser(:camille);
-- L'identifiant n'est pas ouvert au client (privilège de colonne) : il est rendu par `returning`.
select lives_ok($$ with pose as (
	insert into public.card_templates
		(workspace_id, workflow_id, name, title, description, amount, currency, field_values, checklist)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ Audit flash',
	        'Audit flash', 'Deux jours sur site.', 4800, 'EUR', '{"budget": 4800, "source": "salon"}',
	        '["Envoyer la convention", "Planifier l''atelier"]')
	returning id)
	insert into pg_temp.ctx select 'modele', id from pose $$, '3 — l''administratrice pose un modèle, valeurs et points compris');
select is((select created_by from public.card_templates where id = (select valeur from pg_temp.ctx where cle = 'modele')),
	:camille::uuid, '4 — la base signe le modèle');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:driss);
select throws_ok($$ insert into public.card_templates (workspace_id, workflow_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ interdit') $$,
	'42501', null, '5 — le business developer n''écrit pas un modèle');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:farida);
select is((select count(*)::int from public.card_templates where name = 'ZZ Audit flash'), 1, '6 — la lectrice le lit');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 3. La forme d'un modèle, tenue par la base
-- =============================================================================================

select pg_temp.endosser(:camille);
select throws_ok($$ insert into public.card_templates (workspace_id, workflow_id, name, field_values)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ clé', '{"inconnue": 1}') $$,
	'22023', 'template_field_unknown', '7 — une clé qui ne répond à aucune question du workflow est refusée');
select throws_ok($$ insert into public.card_templates (workspace_id, workflow_id, name, field_values)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ valeur', '{"budget": "beaucoup"}') $$,
	'P0001', 'invalid_field_value', '8 — une valeur que l''affaire refuserait est refusée, par la même règle');
select throws_ok($$ insert into public.card_templates (workspace_id, workflow_id, name, checklist)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ point', '["  "]') $$,
	'22023', 'template_checklist_invalid', '9 — un point blanc est refusé');
select throws_ok($$ insert into public.card_templates (workspace_id, workflow_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'zz AUDIT flash') $$,
	'23505', null, '10 — un nom déjà pris, à la casse près, est refusé');
with pose as (
	insert into public.card_templates (workspace_id, workflow_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ archivé')
	returning id)
insert into pg_temp.ctx select 'archive', id from pose;
update public.card_templates set archived_at = now() where id = (select valeur from pg_temp.ctx where cle = 'archive');
select lives_ok($$ insert into public.card_templates (workspace_id, workflow_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051', 'ZZ archivé') $$,
	'11 — archiver libère le nom');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. `creer_affaire` applique le modèle
-- =============================================================================================

select pg_temp.endosser(:driss);
insert into pg_temp.ctx
select 'affaire', public.creer_affaire(:channel, 'ZZ Audit flash — Cerfrance', valeur) from pg_temp.ctx where cle = 'modele';
select pg_temp.redevenir_proprietaire();
insert into pg_temp.ctx
select 'rattachement', p.id from public.card_placements p where p.card_id = (select valeur from pg_temp.ctx where cle = 'affaire');

select is((select title || '|' || description || '|' || currency from public.cards where id = (select valeur from pg_temp.ctx where cle = 'affaire')),
	'ZZ Audit flash — Cerfrance|Deux jours sur site.|EUR', '12 — le titre saisi, la description et la devise du modèle');
select is((select amount from public.card_placements where id = (select valeur from pg_temp.ctx where cle = 'rattachement')),
	4800.00::numeric, '13 — le montant, sur le rattachement');
select is((select jsonb_object_agg(f.key, v.value) from public.card_field_values v join public.form_fields f on f.id = v.field_id
	where v.placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')),
	'{"budget": 4800, "source": "salon"}'::jsonb, '14 — les valeurs de champ, sur le rattachement');
select is((select array_agg(label order by position) from public.card_checklist_items
	where card_id = (select valeur from pg_temp.ctx where cle = 'affaire') and placement_id is null),
	array['Envoyer la convention', 'Planifier l''atelier'], '15 — les points du modèle, devenus points libres');
select ok((select count(*) from public.card_checklist_items
	where placement_id = (select valeur from pg_temp.ctx where cle = 'rattachement')) >= 1,
	'16 — les points de l''étape initiale s''y ajoutent, comme à toute création');

select pg_temp.endosser(:driss);
select throws_ok($$ select public.creer_affaire('5eed0000-0000-4000-8000-0000000c6841', 'ZZ autre workflow',
	(select valeur from pg_temp.ctx where cle = 'modele')) $$,
	'22023', 'template_workflow_mismatch', '17 — un modèle d''un autre workflow que celui du channel est refusé');
select throws_ok($$ select public.creer_affaire('5eed0000-0000-4000-8000-000000000036', 'ZZ archivé',
	(select valeur from pg_temp.ctx where cle = 'archive')) $$,
	'P0002', 'template_not_found', '18 — un modèle archivé n''est plus proposé');
select lives_ok($$ select public.creer_affaire('5eed0000-0000-4000-8000-000000000036', 'ZZ sans modèle') $$,
	'19 — l''appel à deux arguments garde sa forme');

-- =============================================================================================
-- 5. « Enregistrer comme modèle »
-- =============================================================================================

select throws_ok($$ select public.save_card_as_template((select valeur from pg_temp.ctx where cle = 'rattachement'), 'ZZ copie') $$,
	'42501', 'reserved_to_admins', '20 — réservé à l''administratrice');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser(:camille);
insert into pg_temp.ctx
select 'copie', public.save_card_as_template(valeur, '  ZZ Copie de l''audit  ') from pg_temp.ctx where cle = 'rattachement';
select is((select name || '|' || title || '|' || amount::text || '|' || (field_values = '{"budget": 4800, "source": "salon"}'::jsonb)::text
	from public.card_templates where id = (select valeur from pg_temp.ctx where cle = 'copie')),
	'ZZ Copie de l''audit|ZZ Audit flash — Cerfrance|4800.00|true',
	'21 — le modèle reprend le titre, le montant et les valeurs du rattachement, le nom débarrassé de ses blancs');
select ok((select checklist @> '["Envoyer la convention", "Planifier l''atelier"]'::jsonb
	        and jsonb_array_length(checklist) >= 3
	   from public.card_templates where id = (select valeur from pg_temp.ctx where cle = 'copie')),
	'22 — il reprend les libellés de tous les points, d''étape et libres');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

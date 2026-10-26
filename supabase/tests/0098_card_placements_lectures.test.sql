-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.2 : les lectures. Les tables filles désignent le rattachement, la
--           timeline distingue l'affaire du rattachement, et les fonctions de lecture jugent par les rattachements
-- @verifies docs/SPEC-rattachements.md §2 bis.1 (les fonctions), §3.3 (valeurs par rattachement), §4 (lire, écrire la
--           partie commune), §5 (timeline, décision 670), §7 (messagerie), §10 (reprise) ; docs/SCHEMA.md « Migration
--           `0109` » ; docs/JOURNAL.md décisions 639, 642, 657, 670, 705
--
-- CE QUE CETTE SUITE PROUVE, sur le seed migré :
--   1. la FORME : les trois colonnes `placement_id`, leurs contraintes, les déclencheurs, les deux auxiliaires ;
--   2. la REPRISE : chaque ligne existante désigne un rattachement de SON affaire, et l'exception de la décision 670 est
--      close ;
--   3. le RENSEIGNEMENT : une valeur, un événement, une inscription écrits par les vrais chemins reçoivent le leur ;
--   4. les DROITS jugés par les rattachements, et un rattachement ARCHIVÉ qui ferme l'affaire au courrier.
-- L'équivalence des vingt lectures réécrites est MESURÉE, avant et après la migration, par
-- `docs/mesures/CRM-111/06-lectures-equivalentes.sql` : une suite ne peut pas comparer à une définition qu'elle a remplacée.
--
-- Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

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

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_column('public', 'card_field_values', 'placement_id', '`card_field_values.placement_id` existe');
select has_column('public', 'card_events', 'placement_id', '`card_events.placement_id` existe');
select has_column('public', 'card_sequence_enrollments', 'placement_id', '`card_sequence_enrollments.placement_id` existe');
select col_not_null('public', 'card_field_values', 'placement_id',
	'une valeur a TOUJOURS un rattachement — `NOT NULL` depuis T2.3.6, qui retire la contrainte d''attente de la T2.2 '
	'(révisée, décision 51)');
select col_not_null('public', 'card_sequence_enrollments', 'placement_id',
	'une inscription a toujours un rattachement : aucun client n''écrit la table');
select is(
	(select array_agg(conname::text order by conname) from pg_constraint
	  where conname in ('card_field_values_placement_card_fk', 'card_sequence_enrollments_placement_fk')
	    and pg_get_constraintdef(oid) like '%REFERENCES card_placements(id, card_id) ON DELETE CASCADE'),
	array['card_field_values_placement_card_fk', 'card_sequence_enrollments_placement_fk'],
	'les deux clés `(placement_id, card_id)` : le rattachement désigné est un rattachement de LA MÊME affaire');
select ok(not exists (select 1 from pg_constraint where conrelid = 'public.card_events'::regclass and contype = 'f'
                                                   and pg_get_constraintdef(oid) like '%card_placements%'),
	'`card_events` ne porte AUCUNE clé vers le rattachement : un événement survit à son rattachement (T3)');
select is(
	(select array_agg(tgname::text order by tgname) from pg_trigger
	  where tgname in ('card_field_values_fill_placement', 'card_sequence_enrollments_fill_placement',
	                   'card_events_fill_placement')),
	array['card_events_fill_placement', 'card_field_values_fill_placement', 'card_sequence_enrollments_fill_placement'],
	'trois déclencheurs renseignent le rattachement des lignes neuves');
select is(
	(select string_agg(p.proname || ':' || p.provolatile::text || ':' || p.prosecdef::text, ',' order by p.proname)
	   from pg_proc p where p.pronamespace = 'app'::regnamespace
	    and p.proname in ('card_first_placement', 'card_has_active_placement')),
	'card_first_placement:s:true,card_has_active_placement:s:true',
	'les deux auxiliaires sont STABLE et SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'app.card_has_active_placement(uuid)', 'execute'),
	'`anon` n''exécute pas les auxiliaires');

-- =============================================================================================
-- 2. La reprise — §10, décision 670
-- =============================================================================================

select is(
	(select count(*)::int from public.card_field_values v
	   join public.card_placements p on p.id = v.placement_id
	  where p.card_id <> v.card_id),
	0, 'chaque valeur désigne un rattachement de SON affaire');
select isnt((select count(*)::int from public.card_field_values), 0, '(témoin) le seed porte des valeurs');
select is(
	(select count(*)::int from public.card_events e
	  where e.type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                   'snoozed', 'woken', 'stalled', 'field_changed')
	    and e.placement_id is distinct from app.card_first_placement(e.card_id)),
	0, 'décision 670 : tout événement de rattachement de l''historique désigne le rattachement de son affaire');
select is(
	(select count(*)::int from public.card_events e
	  where e.type not in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                       'snoozed', 'woken', 'stalled', 'field_changed')
	    and e.placement_id is not null),
	0, 'les événements de l''AFFAIRE — création, corbeille, contacts, mails — n''en désignent aucun');
select is(
	(select tgenabled::text from pg_trigger
	  where tgrelid = 'public.card_events'::regclass and tgname = 'card_events_refuser_maj'),
	'O', 'le déclencheur d''immuabilité est RÉACTIVÉ : l''exception de la décision 670 est close');
select throws_ok(
	$$update public.card_events set placement_id = null where type = 'moved'$$,
	null, null,
	'hors de la migration, l''historique reste immuable, `placement_id` compris');
select throws_ok(
	$$insert into public.card_events (card_id, workspace_id, type, placement_id)
	  values ('5eed0000-0000-4000-8000-0000000000c5', '5eed0000-0000-4000-8000-000000000001', 'mail_sent',
	          app.card_first_placement('5eed0000-0000-4000-8000-0000000000c5'))$$,
	'23514', null,
	'un événement de l''affaire qui désignerait un rattachement est refusé (`card_events_placement_by_type`)');

-- =============================================================================================
-- 3. Le renseignement, par les vrais chemins
-- =============================================================================================

-- 3.1 Une valeur écrite comme l'écrit la webapp : `upsert` par `(card_id, field_id)`, sans `placement_id`.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table t_champ on commit drop as
	select f.id as field_id, f.workflow_id, c.id as card_id, c.workspace_id
	  from public.cards c
	  join public.form_fields f on f.workflow_id = c.workflow_id and f.archived_at is null and f.type = 'textarea'
	 where c.deleted_at is null
	   and not exists (select 1 from public.card_field_values v where v.card_id = c.id and v.field_id = f.id)
	 order by c.id, f.id
	 limit 1;
select pg_temp.proprietaire();
select isnt((select count(*)::int from t_champ), 0, '(témoin) une affaire du seed a un champ « textarea » vide');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
select card_id, field_id, workflow_id, workspace_id, to_jsonb('Sonde T2.2'::text) from t_champ
on conflict (placement_id, field_id) do update set value = excluded.value;
select pg_temp.proprietaire();
select is(
	(select v.placement_id from public.card_field_values v join t_champ t using (card_id, field_id)),
	(select app.card_first_placement(card_id) from t_champ),
	'une valeur écrite SANS rattachement reçoit celui de son affaire');
select is(
	(select e.placement_id from public.card_events e join t_champ t on t.card_id = e.card_id
	  where e.type = 'field_changed' order by e.created_at desc, e.id desc limit 1),
	(select app.card_first_placement(card_id) from t_champ),
	'…et l''événement `field_changed` qu''elle écrit désigne le même rattachement');

-- 3.2 Un déplacement : l'événement `moved` écrit par `move_card` désigne le rattachement.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.move_card(app.card_first_placement('5eed0000-0000-4000-8000-0000000000c2'), '5eed0000-0000-4000-8000-000000000063');
select pg_temp.proprietaire();
select is(
	(select e.placement_id from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c2' and e.type = 'moved'
	  order by e.created_at desc, e.id desc limit 1),
	app.card_first_placement('5eed0000-0000-4000-8000-0000000000c2'),
	'`move_card` : l''événement `moved` désigne le rattachement déplacé');
select is(
	(select e.placement_id from public.card_events e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c2' and e.type = 'created'),
	null::uuid,
	'la création de l''affaire n''en désigne aucun');

-- 3.3 Une inscription à une cadence, écrite SANS rattachement — comme l'écrivait `armer_sequence_relance` avant
--     `CRM-111` T2.3.5, qui le nomme désormais : le déclencheur de remplissage reste le filet, et le rattachement est posé. Le seed n'arme aucune cadence ; la ligne est écrite en
--     propriétaire, la table étant fermée à tout client.
insert into public.card_sequence_enrollments (card_id, workspace_id, sequence_id, identity_id)
select '5eed0000-0000-4000-8000-0000000000c2', s.workspace_id, s.id, i.id
  from public.mail_sequences s
  join public.mail_outbound_identities i on i.workspace_id = s.workspace_id
 where s.workspace_id = '5eed0000-0000-4000-8000-000000000001'
 order by s.id, i.id
 limit 1;
select is(
	(select e.placement_id from public.card_sequence_enrollments e
	  where e.card_id = '5eed0000-0000-4000-8000-0000000000c2'),
	app.card_first_placement('5eed0000-0000-4000-8000-0000000000c2'),
	'une inscription écrite sans rattachement reçoit celui de son affaire');

-- =============================================================================================
-- 4. Les droits jugés par les rattachements, et l'archivage d'un rattachement
-- =============================================================================================

-- La lectrice (…013) est fermée sur « Conseil & IA », qui porte `grands-comptes` (…032) et `…0c1`.
select is(app.can_read_card_pour('5eed0000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-000000000013'), false,
	'`can_read_card_pour` : la lectrice ne lit pas une affaire dont aucun rattachement ne lui est ouvert');
select is(app.can_read_card_pour('5eed0000-0000-4000-8000-0000000000c4', '5eed0000-0000-4000-8000-000000000013'), true,
	'…et lit celle dont le rattachement est dans un channel ouvert');
select is(app.can_read_card_pour('00000000-0000-4000-8000-00000000dead', '5eed0000-0000-4000-8000-000000000011'), false,
	'une affaire inexistante n''est lue par personne, administratrice comprise');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(app.can_write_card('5eed0000-0000-4000-8000-0000000000c5'), false,
	'`can_write_card` : le business developer, `viewer` sur Maintenance, n''écrit pas l''affaire qui n''y est rattachée');
select pg_temp.proprietaire();

-- Un rattachement archivé ferme l'affaire au courrier : c'est désormais le rattachement qui porte l'archivage.
select is(app.card_has_active_placement('5eed0000-0000-4000-8000-0000000000c4'), true,
	'(témoin) `…0c4` a un rattachement actif');
update public.cards set archived_at = now() where id = '5eed0000-0000-4000-8000-0000000000c4';
select is(app.card_has_active_placement('5eed0000-0000-4000-8000-0000000000c4'), false,
	'archivée par `cards`, le miroir archive le rattachement : l''affaire n''a plus de rattachement actif');
select is(
	app.card_par_adresse('5eed0000-0000-4000-8000-000000000001',
		array[(select c.email_local_part || '@' || w.inbound_domain from public.cards c
		         join public.workspaces w on w.id = c.workspace_id
		        where c.id = '5eed0000-0000-4000-8000-0000000000c4')]),
	null::uuid,
	'`card_par_adresse` : l''adresse d''une affaire sans rattachement actif ne reçoit plus');

select * from finish();
rollback;

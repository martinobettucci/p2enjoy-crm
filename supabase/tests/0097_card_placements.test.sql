-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.1 : la table des rattachements et la reprise (décision 705). Chaque
--           affaire a UN rattachement, égal à ses colonnes de rattachement après la reprise et après chaque geste ;
--           `cards` reste le seul chemin d'écriture ; la lecture suit la forme optimisée et ses trois gardes
-- @verifies docs/SPEC-rattachements.md §2 bis.3 et §2 bis.3 bis (forme optimisée, fraîcheur des droits), §3.1 (la table),
--           §4 (lecture d'un rattachement), §10 (la reprise), §14 (le découpage) ; docs/SCHEMA.md « Migration `0108` » ;
--           docs/JOURNAL.md décisions 642, 667, 705
--
-- CE QUE CETTE SUITE PROUVE, sur le seed migré :
--   1. la FORME de `card_placements`, et que `cards` n'a rien perdu ;
--   2. la REPRISE : une affaire, un rattachement, aux mêmes valeurs ;
--   3. le MIROIR : après chaque geste réel, sous les rôles réels du seed, le rattachement reste égal à l'affaire ;
--   4. les TROIS GARDES de la forme optimisée : `STABLE`, aucun cache, fraîcheur en requête préparée (décision 667) ;
--   5. la RLS et les PRIVILÈGES : on lit ce que son channel permet, personne n'écrit la table directement.
--
-- Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

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

-- LA MESURE DU MIROIR : le nombre d'affaires dont le rattachement manque, est en double, ou diffère d'au moins une des
-- treize colonnes. Lue en propriétaire : la RLS ne doit rien cacher à la mesure.
create or replace function pg_temp.divergences()
returns bigint language sql stable as $$
	select count(*)
	  from public.cards c
	  left join public.card_placements p on p.card_id = c.id
	 where p.id is null
	    or (select count(*) from public.card_placements q where q.card_id = c.id) <> 1
	    or (c.workspace_id, c.channel_id, c.workflow_id, c.current_step_id, c.position, c.owner_id, c.amount,
	        c.probability_override, c.next_action, c.next_action_at, c.entered_step_at, c.health_score,
	        c.snoozed_until, c.archived_at)
	       is distinct from
	       (p.workspace_id, p.channel_id, p.workflow_id, p.current_step_id, p.position, p.owner_id, p.amount,
	        p.probability_override, p.next_action, p.next_action_at, p.entered_step_at, p.health_score,
	        p.snoozed_until, p.archived_at);
$$;

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select has_table('public', 'card_placements', '`public.card_placements` existe');
select is((select relrowsecurity from pg_class where oid = 'public.card_placements'::regclass), true,
	'RLS est activée sur `card_placements`');
select columns_are('public', 'card_placements',
	array['id', 'workspace_id', 'card_id', 'channel_id', 'workflow_id', 'current_step_id', 'position', 'owner_id',
	      'amount', 'probability_override', 'next_action', 'next_action_at', 'entered_step_at', 'health_score',
	      'snoozed_until', 'archived_at', 'created_by', 'created_at', 'updated_at'],
	'les colonnes du rattachement sont exactement celles du §3.1');
select col_is_unique('public', 'card_placements', array['card_id', 'channel_id'],
	'une affaire n''est rattachée qu''une fois à un channel');
select ok(exists (select 1 from pg_index i where i.indexrelid = 'public.card_placements_one_per_card_idx'::regclass
                                              and i.indisunique),
	'pendant la transition, un rattachement au plus par affaire : le miroir n''a jamais à choisir');
select is(
	(select array_agg(conname::text order by conname) from pg_constraint
	  where conrelid = 'public.card_placements'::regclass and contype = 'f'),
	array['card_placements_card_fk', 'card_placements_channel_fk', 'card_placements_channel_workflow_fk',
	      'card_placements_created_by_fkey', 'card_placements_owner_id_fkey', 'card_placements_step_fk'],
	'six clés étrangères : l''affaire, le channel, le couple channel/workflow, l''étape, le responsable, le créateur');
select is(
	(select condeferrable::text || '|' || condeferred::text from pg_constraint
	  where conname = 'card_placements_channel_workflow_fk'),
	'true|true',
	'la clé channel/workflow est vérifiée en fin de transaction, pour `change_channel_workflow`');
select is(
	(select count(*)::int from information_schema.columns
	  where table_schema = 'public' and table_name = 'cards'
	    and column_name in ('channel_id', 'workflow_id', 'current_step_id', 'position', 'owner_id', 'amount',
	                        'probability_override', 'next_action', 'next_action_at', 'entered_step_at',
	                        'health_score', 'snoozed_until', 'archived_at')),
	13, '`cards` garde ses treize colonnes de rattachement : elle reste le chemin d''écriture (T2.4 les retirera)');

-- =============================================================================================
-- 2. La reprise — §10
-- =============================================================================================

select isnt((select count(*)::int from public.cards), 0, 'le seed porte des affaires : la reprise a une matière');
select is(pg_temp.divergences(), 0::bigint,
	'après la reprise, chaque affaire a exactement UN rattachement, égal à ses treize colonnes');
select is(
	(select count(*)::int from public.card_placements p
	   join public.channels ch on ch.id = p.channel_id
	  where p.workflow_id <> ch.workflow_id),
	0, 'chaque rattachement suit le workflow de son channel');
select ok(
	exists (select 1 from public.cards c join public.card_placements p on p.card_id = c.id where c.deleted_at is not null)
	or not exists (select 1 from public.cards where deleted_at is not null),
	'les affaires à la corbeille ont aussi leur rattachement : leur restauration le retrouvera');

-- =============================================================================================
-- 3. Le miroir — chaque geste réel, sous les rôles réels du seed
-- =============================================================================================

-- 3.1 Créer une affaire. L'administratrice (…011) crée dans `grands-comptes` (…032).
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table t_nouvelle on commit drop as
	select public.creer_affaire('5eed0000-0000-4000-8000-000000000032', 'Sonde du miroir') as card_id;
select pg_temp.proprietaire();
select is(
	(select count(*)::int from public.card_placements p join t_nouvelle n on n.card_id = p.card_id), 1,
	'`creer_affaire` : l''affaire reçoit son rattachement dans la même transaction');
select is(pg_temp.divergences(), 0::bigint, '…égal à l''affaire, position et ancienneté comprises');

-- 3.2 Les sept colonnes qu'un client écrit directement, par un `UPDATE` comme celui de PostgREST.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.cards
   set owner_id = '5eed0000-0000-4000-8000-000000000012', amount = 4200.50, probability_override = 35,
       next_action = 'Relancer le client', next_action_at = '2026-11-02 09:00+01', position = 9.5
 where id = (select card_id from t_nouvelle);
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint,
	'`UPDATE` des colonnes ouvertes : responsable, montant, probabilité, prochaine action, position reportés');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.cards set archived_at = now() where id = (select card_id from t_nouvelle);
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, 'archiver : `archived_at` reporté');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.cards set archived_at = null where id = (select card_id from t_nouvelle);
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, 'désarchiver : reporté');

-- 3.3 Un changement de la seule partie commune ne touche pas le rattachement.
--     Toute écriture d'une ligne en crée une version nouvelle, d'adresse (`ctid`) nouvelle : une adresse inchangée
--     prouve qu'aucune écriture n'a eu lieu, même dans la transaction qui l'a déjà modifiée.
create temp table t_avant on commit drop as
	select p.ctid::text as adresse from public.card_placements p join t_nouvelle n on n.card_id = p.card_id;
update public.cards set title = 'Sonde du miroir, renommée', description = 'Partie commune'
 where id = (select card_id from t_nouvelle);
select is(
	(select p.ctid::text from public.card_placements p join t_nouvelle n on n.card_id = p.card_id),
	(select adresse from t_avant),
	'renommer une affaire n''écrit pas son rattachement');
select is(
	(select count(*)::int from pg_trigger
	  where tgrelid = 'public.cards'::regclass and tgname = 'card_placements_mirror_update'
	    and pg_get_triggerdef(oid) like '%WHEN%'),
	1, 'le report ne se déclenche que si une colonne de rattachement change : renommer n''écrit pas le rattachement');

-- 3.4 Faire avancer une affaire. `…0c2` renseigne `budget` : la garde de transition la laisse passer (cf. 0013).
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$select public.move_card('5eed0000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-000000000063')$$,
	'`move_card` passe, comme avant');
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, '`move_card` : étape, position et ancienneté reportées');

-- 3.5 Changer de channel. Le business developer (…012) écrit `refonte` (…034) (cf. 0019).
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(
	$$select public.move_card_to_channel('5eed0000-0000-4000-8000-0000000000c6', '5eed0000-0000-4000-8000-000000000034')$$,
	'`move_card_to_channel` passe, comme avant');
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, '`move_card_to_channel` : channel, workflow, étape et position reportés');

-- 3.6 Endormir puis réveiller.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$select public.snooze_card('5eed0000-0000-4000-8000-0000000000c3', now() + interval '3 days')$$,
	'`snooze_card` passe');
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, '`snooze_card` : `snoozed_until` reporté');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$select public.wake_card('5eed0000-0000-4000-8000-0000000000c3')$$, '`wake_card` passe');
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, '`wake_card` : reporté');

-- 3.7 Changer le workflow d'un channel occupé : le geste qui change le workflow du CHANNEL avant celui des affaires.
--     Toutes les étapes du workflow d'origine vont à la première étape du workflow de `…031`.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$select count(*) from public.change_channel_workflow(
		'5eed0000-0000-4000-8000-000000000032',
		(select workflow_id from public.channels where id = '5eed0000-0000-4000-8000-000000000031'),
		(select jsonb_agg(jsonb_build_object('from_step_id', s.id, 'to_step_id',
		        (select t.id from public.workflow_steps t
		          where t.workflow_id = (select workflow_id from public.channels
		                                  where id = '5eed0000-0000-4000-8000-000000000031')
		          order by t.position, t.id limit 1)))
		   from public.workflow_steps s
		  where s.workflow_id = (select workflow_id from public.channels
		                          where id = '5eed0000-0000-4000-8000-000000000032')
		    and exists (select 1 from public.cards c
		                 where c.channel_id = '5eed0000-0000-4000-8000-000000000032' and c.current_step_id = s.id)),
		true)$$,
	'`change_channel_workflow` passe sur un channel qui porte des affaires : la clé ajournée ne le refuse pas');
select pg_temp.proprietaire();
select is(pg_temp.divergences(), 0::bigint, '`change_channel_workflow` : workflow, étapes et positions reportés');
select lives_ok($$set constraints all immediate$$,
	'à la validation, aucune clé ajournée ne trouve de rattachement hors du workflow de son channel');

-- 3.8 Supprimer une affaire : son rattachement part avec elle.
delete from public.cards where id = (select card_id from t_nouvelle);
select is((select count(*)::int from public.card_placements p join t_nouvelle n on n.card_id = p.card_id), 0,
	'supprimer une affaire supprime son rattachement (clé en cascade)');

-- =============================================================================================
-- 4. Les trois gardes de la forme optimisée — §2 bis.3 bis, décision 667
-- =============================================================================================

select is(
	(select provolatile::text || '|' || prosecdef::text || '|' || array_to_string(proconfig, ',')
	   from pg_proc where oid = 'app.readable_channel_ids()'::regprocedure),
	's|true|search_path=""',
	'GARDE 1 : `app.readable_channel_ids` est STABLE — jamais IMMUTABLE, qui la figerait dans un plan préparé —, '
	'SECURITY DEFINER, `search_path` vide');
select is(
	(select pg_get_expr(polqual, polrelid) from pg_policy
	  where polrelid = 'public.card_placements'::regclass and polname = 'card_placements_select'),
	'(channel_id IN ( SELECT unnest(app.readable_channel_ids()) AS unnest))',
	'GARDE 2 : la politique de lecture appelle la liste à chaque requête, sans table ni cache intermédiaire');

-- GARDE 3 : la fraîcheur, en requête PRÉPARÉE sous plan GÉNÉRIQUE, comme PostgREST. Le business developer du seed est
-- `viewer` sur Maintenance (…035) : on lui retire le droit, puis on le lui rend, SANS repréparer la requête. Aucun
-- savepoint : un `rollback to savepoint` effacerait ces assertions du compte de `finish()` (décision 79).
set local plan_cache_mode = force_generic_plan;
create temp table t_fraicheur (n bigint);
grant all on t_fraicheur to authenticated;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
prepare lire_maintenance as
	select count(*) from public.card_placements p where p.channel_id = '5eed0000-0000-4000-8000-000000000035';
insert into t_fraicheur select count(*) from public.card_placements p
                             where p.channel_id = '5eed0000-0000-4000-8000-000000000035';
create function pg_temp.executer() returns bigint language plpgsql as $$
declare n bigint; begin execute 'execute lire_maintenance' into n; return n; end $$;
select pg_temp.proprietaire();
select isnt((select n from t_fraicheur), 0::bigint, '(témoin) le business developer lit des rattachements de Maintenance');
update public.channel_members set access = 'none'
 where user_id = '5eed0000-0000-4000-8000-000000000012' and channel_id = '5eed0000-0000-4000-8000-000000000035';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.executer(), 0::bigint,
	'GARDE 3 : droit RETIRÉ, la même requête préparée ne rend plus AUCUN rattachement — aucun résultat figé');
select pg_temp.proprietaire();
update public.channel_members set access = 'viewer'
 where user_id = '5eed0000-0000-4000-8000-000000000012' and channel_id = '5eed0000-0000-4000-8000-000000000035';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.executer(), (select n from t_fraicheur),
	'…et droit RENDU, elle les rend de nouveau tous');
select pg_temp.proprietaire();
deallocate lire_maintenance;
set local plan_cache_mode = auto;

-- =============================================================================================
-- 5. La RLS et les privilèges, sous les rôles réels
-- =============================================================================================

select policies_are('public', 'card_placements', array['card_placements_select'],
	'une seule politique, de lecture : en T2.1, aucun client n''écrit la table');
select is(
	(select array_agg(privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_placements'
	    and grantee in ('anon', 'authenticated', 'service_role')),
	array['SELECT', 'SELECT', 'SELECT'],
	'`anon`, `authenticated` et `service_role` LISENT seulement : le miroir est le seul écrivain');
select ok(not has_function_privilege('authenticated', 'app.card_placements_mirror_update()', 'execute'),
	'les fonctions du miroir ne s''appellent pas');

-- La lectrice est fermée sur le track « Conseil & IA » (…021), qui porte `grands-comptes` (…032).
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.card_placements where channel_id = '5eed0000-0000-4000-8000-000000000032'),
	0, 'la lectrice ne voit AUCUN rattachement d''un channel qui lui est fermé — existence comprise (décision 642)');
select is(
	(select count(*)::int from public.card_placements),
	(select count(*)::int from public.cards),
	'elle voit exactement un rattachement par affaire qu''elle lit : la règle est celle de `cards`');
select throws_ok(
	$$update public.card_placements set next_action = 'interdit'$$,
	'42501', null,
	'un `UPDATE` direct est une erreur de privilège, pas une écriture');
select pg_temp.proprietaire();

set local role anon;
select is((select count(*)::int from public.card_placements), 0, '`anon` lit zéro ligne, sans erreur de privilège');
reset role;

select * from finish();
rollback;

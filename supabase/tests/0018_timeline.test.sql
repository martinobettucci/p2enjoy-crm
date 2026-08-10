-- @verifies CRM-044 (docs/BACKLOG.md) — timeline unifiée, `card_events` alimentée par triggers
-- @verifies docs/SPEC-cards.md §14.2 (modèle), §14.3 (`clock_timestamp()`), §14.4 (les huit
--           types), §14.5 (triggers `SECURITY DEFINER`), §14.6 (payloads), §14.7 (autorisations —
--           AUCUNE écriture cliente), §14.8 (immuabilité), §14.11 (seed), §14.14 (preuves)
-- @verifies docs/SCHEMA.md §5 (`card_events`), §10 (index), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §4 (politiques), §7 (refus
--           n° 8, satisfaisable pour moitié depuis cette unité)
-- @verifies docs/SPEC-seed.md §2.15 (événements du seed, convergence)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes), INC-048 (le motif d'une
--           transition, toujours perdu), INC-014 (fermée depuis par CRM-022)
--
-- Suite pgTAP de l'unité `CRM-044`. Elle prouve huit choses :
--
--   1. la **forme** de la table : colonnes, nullabilité, défauts, clé primaire, index ;
--   2. le **vocabulaire** tenu par la base : les huit types acceptés, et les autres refusés ;
--   3. **AUCUNE ÉCRITURE CLIENTE N'EST POSSIBLE** — ce que la Definition of Done exige nommément :
--      aucun privilège pour les trois rôles, une seule politique, et le refus mesuré ;
--   4. l'**immuabilité**, opposable même au propriétaire ;
--   5. les **cinq triggers**, leur `SECURITY DEFINER` et leur `search_path` vidé ;
--   6. ce que chaque trigger écrit **réellement**, et ce qu'il n'écrit pas ;
--   7. la **conformité du seed** : quatorze naissances exactes et les allers-retours réels bornés ;
--   8. ce qui reste dû, **figé par des assertions** plutôt que commenté.
--
-- Exécution : `npm run test:sql`, `scripts/verify-timeline.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0018_timeline.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier, et aucun bloc n'emploie
-- `rollback to savepoint` : une assertion prise dans un savepoint annulé est numérotée mais non
-- comptée par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(87);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.postgres()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role postgres';
end;
$$;

-- Identités et objets du seed :
--   …011 Camille Aubert, admin        …0c1 Refonte du site vitrine, channel `grands-comptes`
--   …012 Driss Lemoine, bizdev        …0c4 Refonte intranet, channel `refonte`
--   …013 Farida Nowak, viewer         …0c5 Support niveau 2, channel `maintenance`

-- =============================================================================================
-- 1. Forme de la table — docs/SPEC-cards.md §14.2
-- =============================================================================================

select has_table('public', 'card_events', '`public.card_events` existe');

select has_column('public', 'card_events', c, format('`card_events.%s` existe', c))
  from unnest(array['id','card_id','workspace_id','type','actor_id','payload','created_at']) c;

select col_is_pk('public', 'card_events', 'id', '`id` est la clé primaire');

select col_not_null('public', 'card_events', c, format('`%s` est non nulle', c))
  from unnest(array['id','card_id','workspace_id','type','payload','created_at']) c;

select col_is_null('public', 'card_events', 'actor_id',
	'`actor_id` est NULLABLE : « nul si l''auteur est un service » (docs/SCHEMA.md §5)');

-- L'écart de la table aux conventions générales, et il est une CONSÉQUENCE et non un oubli :
-- une ligne qu'aucun rôle ne peut modifier n'a pas de date de dernière modification (INC-025,
-- sixième mention).
select hasnt_column('public', 'card_events', 'updated_at',
	'AUCUNE colonne `updated_at` : une ligne immuable n''a pas de date de modification');

-- --- `clock_timestamp()` et non `now()` — décision 204 ----------------------------------------
select is(
	(select pg_get_expr(d.adbin, d.adrelid)
	   from pg_attrdef d
	   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
	  where d.adrelid = 'public.card_events'::regclass and a.attname = 'created_at'),
	'clock_timestamp()',
	'`created_at` a pour défaut `clock_timestamp()` et NON `now()` : sans quoi trois événements '
	'nés d''un seul UPDATE porteraient le même horodatage (décision 204)');

select is(
	(select pg_get_expr(d.adbin, d.adrelid)
	   from pg_attrdef d
	   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
	  where d.adrelid = 'public.card_events'::regclass and a.attname = 'payload'),
	'''{}''::jsonb',
	'`payload` a pour défaut un objet vide');

select has_index('public', 'card_events', 'card_events_card_id_created_at_idx',
	'L''index de docs/SCHEMA.md §10 est posé');

select is(
	(select array_agg(conname order by conname)::text from pg_constraint
	  where conrelid = 'public.card_events'::regclass and contype = 'f'),
	'{card_events_actor_id_fkey,card_events_card_id_workspace_id_fkey}',
	'DEUX clés étrangères, et deux seulement : la composite vers `cards (id, workspace_id)` et '
	'celle de l''acteur vers `profiles`');

select is(
	(select confdeltype::text from pg_constraint where conname = 'card_events_actor_id_fkey'),
	'n', '`actor_id` porte ON DELETE SET NULL : un profil supprimé fait perdre l''acteur de sa '
	     'trace — point ouvert n° 3 du §14.13, décision de conformité non prise ici');

select is(
	(select confdeltype::text from pg_constraint
	  where conname = 'card_events_card_id_workspace_id_fkey'),
	'c', 'La clé composite porte ON DELETE CASCADE — ce qui INTERDIT un trigger de refus de '
	     'suppression (décision 207)');

-- =============================================================================================
-- 2. Le vocabulaire, tenu par la base — docs/SPEC-cards.md §14.4
-- =============================================================================================
-- Les huit types sont éprouvés un à un EN ÉCRIVANT, non en relisant la définition de la
-- contrainte : une contrainte se lit toujours comme on l'a écrite, et ne prouve rien.

create or replace function pg_temp.essayer_type(t text)
returns text language plpgsql as $$
begin
	insert into public.card_events (card_id, workspace_id, type)
	select id, workspace_id, t from public.cards
	 where id = '5eed0000-0000-4000-8000-0000000000c1';
	delete from public.card_events where type = t and payload = '{}'::jsonb;
	return 'accepte';
exception when check_violation then
	return 'refuse';
end;
$$;

select is(pg_temp.essayer_type(t), 'accepte', format('Le type `%s` est ACCEPTÉ', t))
  from unnest(array['created','moved','assigned','archived','unarchived','trashed','restored',
                    'field_changed']) t;

-- ASSERTION RETOURNÉE POUR MOITIÉ PAR `CRM-055` (décision 51, dixième occurrence) : elle
-- annonçait « le jour où `CRM-054` et `CRM-058` les écriront ». Le classement écrit désormais
-- `mail_received`, et le type est ACCEPTÉ ; `mail_sent` reste refusé, faute d'envoi.
select is(pg_temp.essayer_type('mail_received'), 'accepte',
	'Le type `mail_received` est ACCEPTÉ depuis CRM-055 : un message qui entre dans une card est '
	'un fait, et le taire laisserait un trou dans sa mémoire');

select is(pg_temp.essayer_type('mail_sent'), 'refuse',
	'Le type `mail_sent` reste REFUSÉ tant qu''aucun envoi n''existe (CRM-058)');

select is(pg_temp.essayer_type('commented'), 'refuse',
	'Le type `commented` est REFUSÉ : un commentaire n''écrit AUCUN événement, le fil est unifié à '
	'la LECTURE (décision 209)');

select is(pg_temp.essayer_type('n''importe quoi'), 'refuse',
	'Un type inventé est refusé : le vocabulaire est tenu par la base');

-- =============================================================================================
-- 3. AUCUNE ÉCRITURE CLIENTE — la Definition of Done de `CRM-044`
-- =============================================================================================

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee in ('anon','authenticated','service_role')
	    and privilege_type <> 'SELECT'),
	0,
	'AUCUN privilège autre que SELECT sur `card_events`, pour AUCUN des trois rôles — '
	'`service_role` COMPRIS (décision 205)');

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee = r and privilege_type = 'SELECT'),
	1, format('`%s` détient SELECT, et lui seul', r))
  from unnest(array['anon','authenticated','service_role']) r;

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'card_events'),
	1, 'UNE SEULE politique sur `card_events` : la lecture. Écrire n''est ouvert à personne');

select is(
	(select cmd from pg_policies where tablename = 'card_events'),
	'SELECT', 'Cette politique est bien une politique de LECTURE');

select is(
	(select qual from pg_policies where tablename = 'card_events'),
	'app.can_read_card(card_id)',
	'La lecture passe par `app.can_read_card` — troisième table à l''appeler');

select is(
	(select roles::text from pg_policies where tablename = 'card_events'),
	'{anon,authenticated}',
	'La politique est accordée à `anon` AUSSI, pour que le refus soit ZÉRO LIGNE et non une '
	'erreur de privilège (docs/SPEC-permissions-rls.md §3.2)');

select ok(
	(select relrowsecurity from pg_class where oid = 'public.card_events'::regclass),
	'RLS est activée sur `card_events`');

-- --- Le refus, MESURÉ plutôt que déduit des privilèges -----------------------------------------

create or replace function pg_temp.essayer_insertion()
returns text language plpgsql as $$
begin
	insert into public.card_events (card_id, workspace_id, type)
	select id, workspace_id, 'created' from public.cards limit 1;
	return 'accepte';
exception
	when insufficient_privilege then return 'privilege';
	when others then return sqlstate;
end;
$$;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.essayer_insertion(), 'privilege',
	'L''administratrice ne peut PAS forger un événement : refus de PRIVILÈGE');

select pg_temp.anonyme();
select is(pg_temp.essayer_insertion(), 'privilege',
	'L''anonyme ne peut pas davantage en forger un');

select pg_temp.postgres();
set local role service_role;
select is(pg_temp.essayer_insertion(), 'privilege',
	'LE COMPTE DE SERVICE NON PLUS — le seed ne PEUT PAS fabriquer une trace (CLAUDE.md §8, '
	'décision 205)');
select pg_temp.postgres();

-- =============================================================================================
-- 4. Immuabilité — docs/SPEC-cards.md §14.8
-- =============================================================================================

create or replace function pg_temp.essayer_maj()
returns text language plpgsql as $$
begin
	update public.card_events set payload = '{"forge": true}'::jsonb
	 where id = (select id from public.card_events limit 1);
	return 'accepte';
exception
	when insufficient_privilege then return 'privilege';
	when raise_exception then return sqlerrm;
	when others then return sqlstate;
end;
$$;

-- Le propriétaire de la base contourne la RLS et détient tous les privilèges : s'il est refusé,
-- c'est que le trigger tient, et lui seul.
select is(pg_temp.essayer_maj(), 'card_event_immutable',
	'Le PROPRIÉTAIRE lui-même ne peut pas modifier un événement : le trigger d''immuabilité tient '
	'la porte que les privilèges laisseraient ouverte');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(pg_temp.essayer_maj(), 'privilege',
	'Un client est refusé plus tôt encore, par le privilège');
select pg_temp.postgres();

select has_trigger('public', 'card_events', 'card_events_refuser_maj',
	'Le trigger d''immuabilité est posé');

select hasnt_trigger('public', 'card_events', 'card_events_refuser_suppression',
	'AUCUN trigger de refus sur la suppression, et c''est mesuré : il rendrait impossible la '
	'cascade depuis `cards` (décision 207)');

-- =============================================================================================
-- 5. Les cinq triggers, et leur `SECURITY DEFINER` — docs/SPEC-cards.md §14.5
-- =============================================================================================

select has_trigger('public', 'cards', t, format('Le trigger `%s` est posé sur `cards`', t))
  from unnest(array['card_events_apres_insertion','card_events_apres_maj']) t;

select has_trigger('public', 'card_field_values', 'card_events_apres_ecriture_valeur',
	'Le trigger de valeurs de formulaire est posé');

-- `SECURITY DEFINER` n'est pas un confort : MESURÉ, le même corps en `INVOKER` rend
-- « permission denied » et FAIT ÉCHOUER l'écriture métier qui l'a déclenché.
select ok(p.prosecdef, format('`app.%s` est SECURITY DEFINER', p.proname))
  from pg_proc p
 where p.pronamespace = 'app'::regnamespace
   and p.proname in ('card_event_ecrire', 'card_events_apres_insertion_card',
                     'card_events_apres_maj_card', 'card_events_apres_ecriture_valeur');

-- Une fonction `SECURITY DEFINER` sans `search_path` figé est une porte ouverte : la garde est
-- écrite comme un INVENTAIRE, de sorte qu'elle tombe le jour où une fonction en oublie un.
select is(
	(select count(*)::int from pg_proc p
	  where p.pronamespace = 'app'::regnamespace
	    and p.proname like 'card_event%'
	    and p.prosecdef
	    and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])),
	0, 'Toute fonction `SECURITY DEFINER` de la timeline a son `search_path` VIDÉ');

select ok(not p.prosecdef, '`app.card_events_refuser_maj` est SECURITY INVOKER : elle ne fait que '
	'lever, elle n''a besoin d''aucun droit')
  from pg_proc p
 where p.pronamespace = 'app'::regnamespace and p.proname = 'card_events_refuser_maj';

-- =============================================================================================
-- 6. Ce que les triggers écrivent RÉELLEMENT
-- =============================================================================================
-- Les assertions qui suivent agissent, puis relisent. Une garde qui se contenterait de lire le
-- corps du trigger prouverait qu'il est écrit, non qu'il fonctionne.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- --- 6.1 Naissance ----------------------------------------------------------------------------
insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title)
select workspace_id, channel_id, workflow_id, current_step_id, 'Sonde timeline'
  from public.cards where id = '5eed0000-0000-4000-8000-0000000000c1';

select is(
	(select type from public.card_events e
	   join public.cards c on c.id = e.card_id
	  where c.title = 'Sonde timeline'),
	'created', 'Une card qui naît écrit un événement `created`');

select is(
	(select e.payload->>'title' from public.card_events e
	   join public.cards c on c.id = e.card_id where c.title = 'Sonde timeline'),
	'Sonde timeline', 'Le `payload` de `created` porte le titre de naissance');

select is(
	(select e.actor_id from public.card_events e
	   join public.cards c on c.id = e.card_id where c.title = 'Sonde timeline'),
	'5eed0000-0000-4000-8000-000000000011'::uuid,
	'`actor_id` porte l''identifiant RÉEL de l''appelant, atteint depuis une fonction SECURITY '
	'DEFINER — MESURÉ, la revendication JWT survit au changement de rôle');

-- --- 6.2 Cycle de vie, et les quatre gardes ---------------------------------------------------
update public.cards set archived_at = now() where title = 'Sonde timeline';
update public.cards set archived_at = null  where title = 'Sonde timeline';
update public.cards set deleted_at  = now() where title = 'Sonde timeline';
update public.cards set deleted_at  = null  where title = 'Sonde timeline';
update public.cards set owner_id = '5eed0000-0000-4000-8000-000000000012'
 where title = 'Sonde timeline';

select is(
	(select array_agg(e.type order by e.created_at)::text
	   from public.card_events e join public.cards c on c.id = e.card_id
	  where c.title = 'Sonde timeline'),
	'{created,archived,unarchived,trashed,restored,assigned}',
	'Les six événements du cycle de vie sont écrits, DANS L''ORDRE RÉEL — ce que `clock_timestamp()` '
	'rend possible et que `now()` rendrait aléatoire');

-- --- 6.3 Une écriture qui ne change rien n'écrit rien -----------------------------------------
update public.cards set title = title where title = 'Sonde timeline';
update public.cards set owner_id = '5eed0000-0000-4000-8000-000000000012'
 where title = 'Sonde timeline';

select is(
	(select count(*)::int from public.card_events e
	   join public.cards c on c.id = e.card_id where c.title = 'Sonde timeline'),
	6, 'Une écriture qui ne change AUCUNE colonne surveillée n''écrit AUCUN événement : c''est ce '
	   'qui rend le seed convergent');

-- --- 6.4 Horodatages distincts au sein d'une même transaction ---------------------------------
select is(
	(select count(distinct e.created_at)::int from public.card_events e
	   join public.cards c on c.id = e.card_id where c.title = 'Sonde timeline'),
	6, 'Les six horodatages sont DISTINCTS bien qu''écrits dans une seule transaction — `now()` '
	   'les rendrait tous égaux (décision 204)');

-- --- 6.5 Valeurs de formulaire, et la clé `from` absente --------------------------------------
select pg_temp.postgres();

-- RÉVISÉE PAR `CRM-046`, ET LE MOTIF EST UN DÉFAUT DE L'ASSERTION, PAS DU PRODUIT
-- (décision 226, seconde forme de la décision 210).
--
-- Elle comptait un CUMUL : « aucun `field_changed` de la base ne porte la clé `from` ». C'était
-- vrai d'une base fraîchement seedée, et faux dès la première modification d'une valeur — par un
-- utilisateur, par une preuve d'API, ou par la non-complaisance de `scripts/verify-seed-demo.sh`,
-- qui vide puis remplit une valeur à chaque exécution. MESURÉ : 10 événements portaient `from`
-- après quatre passages de ce harnais, et l'assertion était rouge sans qu'aucune règle n'ait bougé.
--
-- CE QUI EST INVARIANT, ET QUI EST DÉSORMAIS ÉPROUVÉ : la NAISSANCE d'une valeur n'a pas de
-- prédécesseur. Pour chaque couple (card, champ), le PREMIER `field_changed` ne porte jamais
-- `from` — quelles qu'aient été les modifications ultérieures. C'est la propriété que la
-- décision 208 énonçait ; l'ancienne rédaction en éprouvait un cas particulier périssable.
select is(
	(select count(*)::int from (
	   select distinct on (e.card_id, e.payload ->> 'field_id') e.payload ? 'from' as porte_from
	     from public.card_events e
	    where e.type = 'field_changed'
	    order by e.card_id, e.payload ->> 'field_id', e.created_at
	 ) premiers where porte_from),
	0, 'AUCUNE NAISSANCE de valeur ne porte la clé `from` : pour chaque couple (card, champ), le '
	   'PREMIER `field_changed` est sans prédécesseur. Une modification ultérieure en porte une, et '
	   'c''est le produit qui fonctionne — décisions 208 et 226');

select ok(
	(select bool_and(payload ? 'field_id' and payload ? 'to') from public.card_events
	  where type = 'field_changed'),
	'Tout `field_changed` porte `field_id` et `to`');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

update public.card_field_values set value = '77000'::jsonb
 where card_id = '5eed0000-0000-4000-8000-0000000000c1'
   and field_id = '5eed0000-0000-4000-8000-000000000081';

select ok(
	(select payload ? 'from' from public.card_events
	  where type = 'field_changed' and payload->>'to' = '77000'),
	'Un `field_changed` de MISE À JOUR porte la clé `from`, toujours — « la clé n''est pas là » '
	'signifie « il n''y avait rien », « la clé vaut null » signifie « il y avait le vide »');

update public.card_field_values set value = '77000'::jsonb
 where card_id = '5eed0000-0000-4000-8000-0000000000c1'
   and field_id = '5eed0000-0000-4000-8000-000000000081';

select is(
	(select count(*)::int from public.card_events
	  where type = 'field_changed' and payload->>'to' = '77000'),
	1, 'Une valeur réécrite À L''IDENTIQUE n''écrit AUCUN événement supplémentaire');

-- --- 6.6 Le `payload` ne porte AUCUN libellé --------------------------------------------------
select pg_temp.postgres();

select is(
	(select count(*)::int from public.card_events
	  where type = 'moved' and (payload ? 'from_label' or payload ? 'to_label')),
	0, 'Un `moved` ne recopie AUCUN libellé d''étape : une trace qui les porterait dirait demain ce '
	   'qui était vrai hier (§14.6)');

-- =============================================================================================
-- 7. Lecture : ce que chaque profil voit
-- =============================================================================================

select pg_temp.anonyme();
select is((select count(*)::int from public.card_events), 0,
	'L''anonyme ne voit AUCUN événement : refus par défaut');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.card_events
	  where card_id = '5eed0000-0000-4000-8000-0000000000c1'),
	0, 'Le `viewer` ne voit AUCUN événement de `…0c1`, dont le track lui est fermé');

select cmp_ok(
	(select count(*)::int from public.card_events
	  where card_id = '5eed0000-0000-4000-8000-0000000000c5'), '>', 0,
	'Le `viewer` VOIT les événements d''une card qu''il lit : lire la mémoire n''exige que de LIRE, '
	'à la différence d''écrire un commentaire (INC-071)');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select cmp_ok((select count(*)::int from public.card_events), '>', 0,
	'L''administratrice voit les événements');

select pg_temp.postgres();

-- =============================================================================================
-- 8. Conformité du seed — docs/SPEC-seed.md §2.15
-- =============================================================================================
-- Ces assertions comptent les événements du SEED seul : la sonde de la section 6 a été écrite
-- dans la même transaction, et ses lignes sont exclues par leur card.

create or replace view pg_temp.evenements_du_seed as
	select e.* from public.card_events e
	  join public.cards c on c.id = e.card_id
	 where c.id in (
		'5eed0000-0000-4000-8000-0000000000c1',
		'5eed0000-0000-4000-8000-0000000000c2',
		'5eed0000-0000-4000-8000-0000000000c3',
		'5eed0000-0000-4000-8000-0000000000c4',
		'5eed0000-0000-4000-8000-0000000000c5',
		'5eed0000-0000-4000-8000-0000000000c6',
		'5eed0000-0000-4000-8000-0000000000c7',
		'5eed0000-0000-4000-8000-0000000000c8',
		'5eed0000-0000-4000-8000-0000000000c9',
		'5eed0000-0000-4000-8000-0000000000ca',
		'5eed0000-0000-4000-8000-0000000000cb',
		'5eed0000-0000-4000-8000-0000000000cc',
		'5eed0000-0000-4000-8000-0000000000cd',
		'5eed0000-0000-4000-8000-0000000000ce'
	);

-- LE SEUL COMPTE EXACT QUI TIENNE DANS LE TEMPS : une card ne naît qu'une fois.
-- RÉVISÉ par CRM-046 : neuf cards devenues quatorze (docs/SPEC-seed.md §9.3).
select is((select count(*)::int from pg_temp.evenements_du_seed where type = 'created'), 14,
	'Le seed a produit QUATORZE `created` — un par card insérée, sans en écrire aucun lui-même. C''est '
	'le SEUL compte exact que la suite assère : la naissance d''une card est idempotente, son '
	'histoire ne l''est pas (décision 210)');

-- LES COMPTES DE `moved` ET D'`assigned` SONT DES BORNES INFÉRIEURES, ET LE MOTIF EST UNE
-- PROPRIÉTÉ DE L'UNITÉ (décision 210). Une timeline enregistre TOUT, y compris ce que les autres
-- fichiers de preuve font à la même pile : `e2e/api/move-card.spec.ts` déplace des cards du seed et
-- les remet, et chacun de ces gestes laisse sa trace. Seule la NAISSANCE d'une card est idempotente
-- — une card ne naît qu'une fois —, et c'est la seule assertion de compte exact qui puisse tenir.
select cmp_ok((select count(*)::int from pg_temp.evenements_du_seed where type = 'moved'), '>=', 2,
	'AU MOINS DEUX `moved` : l''aller-retour d''étape de `…0c4`, par la vraie RPC `move_card`. Le '
	'compte croît si d''autres preuves déplacent des cards du seed — une timeline enregistre tout');

select cmp_ok((select count(*)::int from pg_temp.evenements_du_seed where type = 'assigned'),
	'>=', 2, 'AU MOINS DEUX `assigned` : l''aller-retour de responsable de `…0c1`, par un vrai PATCH');

select cmp_ok(
	(select count(*)::int from pg_temp.evenements_du_seed
	  where type in ('moved','assigned') and actor_id = '5eed0000-0000-4000-8000-000000000011'),
	'>=', 4, 'AU MOINS QUATRE événements portent un acteur RÉEL — le jeton de l''administratrice, '
	         'non la clé de service. Ce sont les quatre des allers-retours du seed');

select is(
	(select count(*)::int from pg_temp.evenements_du_seed
	  where type = 'created' and actor_id is not null),
	0, 'Les quatorze `created` n''ont AUCUN acteur : la clé de service ne porte pas de revendication '
	   '`sub`, et `auth.uid()` y est nul (docs/SCHEMA.md §5)');

-- L'ÉTAT DU SEED EST INCHANGÉ PAR LES ALLERS-RETOURS. Sans cette assertion, la démonstration de la
-- timeline se paierait d'une dérive silencieuse des autres unités.
select is(
	(select current_step_id from public.cards where id = '5eed0000-0000-4000-8000-0000000000c4'),
	'5eed0000-0000-4000-8000-000000000063'::uuid,
	'`…0c4` est RENDUE à son étape de négociation : l''aller-retour ne laisse aucune trace d''état');

select is(
	(select owner_id from public.cards where id = '5eed0000-0000-4000-8000-0000000000c1'),
	'5eed0000-0000-4000-8000-000000000012'::uuid,
	'`…0c1` est RENDUE à son responsable déclaré');

-- =============================================================================================
-- 9. Ce qui reste dû, figé par des assertions — mécanisme de la décision 51
-- =============================================================================================

select hasnt_table('public', 'card_activities',
	'`card_activities` n''existe pas : appels, réunions et visios ne sont portés par AUCUNE unité '
	'du chunk 3, et le fil unifié s''en tient à deux sources sur cinq');

select hasnt_table('public', 'audit_log',
	'`audit_log` reste due par `CRM-072` : la preuve de refus n° 8 n''est satisfaisable que pour '
	'MOITIÉ depuis cette unité');

select is(
	(select count(*)::int from pg_publication_tables
	  where pubname = 'supabase_realtime' and tablename = 'card_events'),
	0, '`card_events` n''est PAS publiée au temps réel : le fil se relit à l''ouverture de la card '
	   '(§14.1)');

-- INC-048, troisième constat : le motif d'une transition n'est conservé nulle part, bien que sa
-- destination existe désormais DEUX fois.
select is(
	(select count(*)::int from public.card_events where type = 'moved' and payload ? 'comment'),
	0, 'INC-048 : le `comment` de `move_card` n''atteint PAS le `payload` — un trigger sur `cards` '
	   'ne voit pas les arguments de la fonction qui a fait l''UPDATE');

select is(
	(select count(*)::int from pg_proc
	  where pronamespace = 'public'::regnamespace and proname = 'move_card'
	    and prosrc like '%card_events%'),
	0, '`public.move_card` n''a PAS été rouverte : elle appartient à `CRM-034` (décision 203)');

select * from finish();
rollback;

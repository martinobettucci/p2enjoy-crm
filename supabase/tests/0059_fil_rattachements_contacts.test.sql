-- @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, TRANCHE 5 : le fil de l'affaire
--           apprend les rattachements
-- @verifies docs/SPEC-contacts.md §19.2 (un trigger de TABLE, non les écrans), §19.3 (les trois
--           types et leurs payloads exacts), §19.4 (les DEUX gardes de convergence), §19.6 (aucune
--           autorisation ajoutée), §19.7 (contrat de comportement, cas a à e)
-- @verifies docs/SPEC-cards.md §14.4 (le vocabulaire), §14.5 (`app.card_event_ecrire`, seule voie),
--           §14.6 (aucun libellé dans un payload), §14.7 (aucun privilège d'écriture)
-- @verifies docs/ARBITRAGES.md §5 décision 517 ; docs/PROD_MIGRATIONS.md §3 (migration 61)
-- @verifies CLAUDE.md §10 (une règle de produit se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS les politiques de `card_contacts` ni celles de `card_events` : la tranche 1
-- et `CRM-044` les tiennent, et cette tranche n'en ajoute aucune. Ce qu'elle prouve, et que rien
-- d'autre ne prouve :
--
-- 1. QUE LA TRACE SUIT LA DONNÉE, NON LE GESTE. Le trigger est sur la TABLE : une écriture faite
--    hors de tout écran — ici, en SQL direct — laisse sa trace. C'est ce qui garantit qu'une
--    quatrième surface ne pourra pas l'oublier (§19.2).
-- 2. QUE LE PAYLOAD NE PORTE AUCUN LIBELLÉ (§14.6). L'assertion compare l'ENSEMBLE DES CLÉS, non
--    leur présence : ajouter `contact_name` demain ferait rougir la suite, ce qu'une assertion
--    « contient contact_id » ne ferait pas.
-- 3. QUE LE RÔLE RÉÉCRIT À L'IDENTIQUE N'ÉCRIT RIEN. Sans `is distinct from`, une mise à jour de
--    routine allongerait l'histoire d'une ligne qui ne dit rien, et le rejeu cesserait d'être
--    convergent.
--
-- CHAQUE REFUS EST PRÉCÉDÉ DE SON TÉMOIN : un compte qui reste à zéro ne prouve rien tant qu'on n'a
-- pas vu le même chemin écrire quelque chose.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Les identifiants du seed employés ici — docs/SPEC-seed.md §2.3 et §2.18.
create temporary table sonde as
select '5eed0000-0000-4000-8000-000000000001'::uuid as workspace,
       '5eed0000-0000-4000-8000-0000000000c1'::uuid as card,
       (select c.id from public.contacts c
         where not exists (
           select 1 from public.card_contacts cc
            where cc.card_id = '5eed0000-0000-4000-8000-0000000000c1'::uuid
              and cc.contact_id = c.id)
         order by c.id limit 1) as contact;

-- =============================================================================================
-- 1. Le vocabulaire, et la forme du trigger — §19.3, §19.4
-- =============================================================================================

select ok(
	(select pg_get_constraintdef(oid) like '%contact_linked%'
	   from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check'),
	'le vocabulaire porte contact_linked : la migration 61 a convergé');

select ok(
	(select pg_get_constraintdef(oid) like '%contact_unlinked%' and
	        pg_get_constraintdef(oid) like '%contact_role_changed%'
	   from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check'),
	'les deux autres valeurs y sont aussi : le vocabulaire compte dix-huit valeurs');

-- LA CONTRAINTE EST `VALID`, ET C'EST INC-210 QUI L'EXIGE. Une contrainte `NOT VALID` ne garde que
-- les écritures futures et laisse passer ce que les lignes portent déjà : elle serait une
-- déclaration d'intention, non une garde.
select ok(
	(select convalidated from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check'),
	'la contrainte est VALID : elle garde les lignes existantes autant que les futures');

select is(
	(select count(*) from pg_trigger
	  where tgrelid = 'public.card_contacts'::regclass and not tgisinternal),
	3::bigint,
	'trois triggers sur card_contacts : l''ajout, le retrait et le changement de rôle');

select is(
	(select p.prosecdef::text || '|' || pg_get_userbyid(p.proowner)
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'card_events_apres_maj_contacts'),
	'true|postgres',
	'la fonction est SECURITY DEFINER et appartient à postgres : card_events n''accorde aucune '
	'écriture, pas même à service_role');

select is(
	(select p.proconfig[1]
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'card_events_apres_maj_contacts'),
	'search_path=""',
	'son search_path est vide : une fonction SECURITY DEFINER sans search_path fixé est une '
	'élévation de privilège qui attend son heure');

-- =============================================================================================
-- 2. Cas a — rattacher écrit UNE ligne, et son payload n'a que deux clés — §19.7
-- =============================================================================================

-- TÉMOIN D'ABORD : sans lui, les comptes ci-dessous seraient vrais sur une affaire qui n'a jamais
-- rien porté, et ne diraient rien du trigger.
select is(
	(select count(*) from public.card_events e, sonde s
	  where e.card_id = s.card and e.type like 'contact%'),
	0::bigint,
	'témoin : l''affaire ne porte aucun événement de rattachement avant le geste');

insert into public.card_contacts (workspace_id, card_id, contact_id, role)
select s.workspace, s.card, s.contact, 'decideur' from sonde s;

select is(
	(select count(*) from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_linked'),
	1::bigint,
	'cas a : rattacher écrit EXACTEMENT un contact_linked');

select is(
	(select array_agg(cle order by cle)
	   from public.card_events e, sonde s, jsonb_object_keys(e.payload) as cle
	  where e.card_id = s.card and e.type = 'contact_linked'),
	array['contact_id', 'role'],
	'le payload porte DEUX clés et pas une de plus : aucun libellé recopié (§14.6)');

select is(
	(select e.payload ->> 'contact_id' from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_linked'),
	(select s.contact::text from sonde s),
	'le payload désigne le contact rattaché, par son identifiant');

-- =============================================================================================
-- 3. Cas d puis c — le rôle réécrit à l'identique n'écrit rien, le rôle DÉPLACÉ écrit — §19.7
-- =============================================================================================

update public.card_contacts cc set role = 'decideur'
  from sonde s where cc.card_id = s.card and cc.contact_id = s.contact;

select is(
	(select count(*) from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_role_changed'),
	0::bigint,
	'cas d : le MÊME rôle réécrit n''allonge pas l''histoire — is distinct from');

update public.card_contacts cc set role = 'prescripteur'
  from sonde s where cc.card_id = s.card and cc.contact_id = s.contact;

select is(
	(select count(*) from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_role_changed'),
	1::bigint,
	'cas c : le rôle DÉPLACÉ écrit exactement un contact_role_changed');

select is(
	(select (e.payload ->> 'from') || '→' || (e.payload ->> 'to')
	   from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_role_changed'),
	'decideur→prescripteur',
	'le payload porte les DEUX bornes : un « avant » sans « après » serait une phrase tronquée');

-- =============================================================================================
-- 4. Cas b — détacher écrit le rôle QU'IL PORTAIT — §19.3
-- =============================================================================================

delete from public.card_contacts cc using sonde s
 where cc.card_id = s.card and cc.contact_id = s.contact;

select is(
	(select count(*) from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_unlinked'),
	1::bigint,
	'cas b : détacher écrit exactement un contact_unlinked');

-- LE RÔLE EST LU DANS `old`, ET C'EST LA SEULE FAÇON DE LE CONNAÎTRE APRÈS COUP : la ligne a
-- disparu, et rien d'autre ne dit quel rôle le contact portait au moment du détachement.
select is(
	(select e.payload ->> 'role' from public.card_events e, sonde s
	  where e.card_id = s.card and e.type = 'contact_unlinked'),
	'prescripteur',
	'le détachement conserve le rôle porté au moment du geste, lu dans OLD');

-- =============================================================================================
-- 5. Ce que la tranche N'A PAS touché — §19.6
-- =============================================================================================

select is(
	(select count(*) from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee in ('anon', 'authenticated', 'service_role')
	    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
	0::bigint,
	'aucun rôle client ne gagne d''écriture sur card_events : la tranche n''ouvre rien');

select * from finish();
rollback;

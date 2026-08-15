-- @verifies CRM-013 (docs/BACKLOG.md) — colonnes protégées
-- @verifies docs/SPEC-permissions-rls.md §4.3 (le mécanisme), §4.4 (ce que `CRM-013` ferme),
--           §4.4.2 (le chemin d'insertion est déjà sûr), §4.4.3 (la forme retenue),
--           §4.4.6 (preuves attendues), §7 (refus n° 6 et n° 8, non satisfaisables ici)
-- @verifies docs/SPEC-cards.md §3.3 (non-devinabilité), §3.4 (le trigger génère, il ne protège
--           pas), §6.3 (privilèges)
-- @verifies docs/SPEC-workflow-engine.md §5.5 (bloc `GRANT`, INC-050)
-- @verifies docs/SCHEMA.md §5 (cards)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-049 (chevauchement tranché du côté de `CRM-034`),
--           INC-050 (**close par exécution**)
--
-- Suite pgTAP de l'unité `CRM-013`. Elle prouve cinq choses :
--
--   1. `authenticated` n'a **plus** `UPDATE` sur `cards.email_local_part`, et la lecture, elle,
--      reste ouverte — l'adresse d'une card est une identité, pas un secret ;
--   2. les **douze** colonnes qui restent ouvertes le sont, énumérées **une par une**, de sorte
--      qu'une fermeture trop large fasse échouer la suite et non passer inaperçue ;
--   3. le refus est **opposable en base**, pas seulement à travers PostgREST : une mise à jour
--      tentée sous le rôle `authenticated` lève `42501` ;
--   4. le **chemin d'insertion reste celui de `CRM-040`** : le trigger existe, et il écrase la
--      valeur fournie — ce que cette unité ne devait PAS changer (décision 140) ;
--   5. ce qui **reste dû** à `CRM-013`, figé par quatre assertions d'absence, et `card_events`,
--      désormais livrée, sans aucun privilège d'écriture pour les trois rôles API. Chaque
--      assertion d'absence deviendra rouge le jour où sa table naîtra sans protection
--      (mécanisme de la décision 51).
--
-- Exécution : `npm run test:sql`, `scripts/verify-colonnes-protegees.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0015_colonnes_protegees.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Aucun bloc n'emploie
-- `rollback to savepoint` : une assertion prise dans un savepoint annulé est **numérotée mais non
-- comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- =============================================================================================
-- 1. La colonne fermée — §4.4.3
-- =============================================================================================

select ok(
	not has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'update'),
	'CRM-013 LIVRÉE : `authenticated` n''a plus `UPDATE` sur `email_local_part`. Le trigger de '
	'`CRM-040` GÉNÈRE l''adresse, il ne la PROTÈGE pas (docs/SPEC-cards.md §3.4) : sans ce retrait, '
	'un membre qui écrit sur le channel remplace 40 bits de hasard par « c-00000000 »');

-- La lecture reste ouverte, et c'est délibéré : l'adresse d'une card est affichée à qui peut lire
-- la card. La fermer ferait de `CRM-013` autre chose que ce que son énoncé demande.
select ok(
	has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'select'),
	'la LECTURE reste ouverte : l''adresse d''une card est une IDENTITÉ, non un secret — à la '
	'différence de `secret_id`, que le §4.3 range en `REVOKE SELECT`');

-- L'insertion reste de table, et le §4.4.2 en donne le motif mesuré : le trigger écrase déjà la
-- valeur fournie. Fermer ce chemin refuserait une requête que le produit accepte sans dommage.
select ok(
	has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'insert'),
	'l''INSERTION reste de table (décision 140) : le trigger écrase la valeur fournie, MESURÉ. La '
	'fermer casserait tout client qui renvoie la ligne entière, sans rien protéger de plus');

-- `service_role` conserve tout : le seed écrit avec la clé de service, et il est inchangé.
select ok(
	has_column_privilege('service_role', 'public.cards', 'email_local_part', 'update'),
	'`service_role` conserve l''écriture : le seed en dépend. La limite est NOMMÉE au §4.4.3 — un '
	'service qui se tromperait de colonne ne serait arrêté par rien');

-- `anon` n'a jamais eu d'`UPDATE` sur `cards` : la migration 0011 ne le lui a pas accordé. Le
-- constater évite de croire que cette unité l'a retiré.
select ok(
	not has_column_privilege('anon', 'public.cards', 'email_local_part', 'update'),
	'`anon` n''a pas `UPDATE`, et ne l''a JAMAIS eu : la migration 0011 ne le lui accorde pas. '
	'Cette unité ne lui a rien retiré — le constater évite de s''en attribuer le mérite');

-- =============================================================================================
-- 2. Les douze colonnes qui restent ouvertes — §4.4.6, preuve n° 2
-- =============================================================================================
-- Énumérées UNE PAR UNE. Une fermeture trop large — le risque réel du mécanisme du §4.3 — ferait
-- échouer l'assertion correspondante au lieu de passer pour un durcissement bienvenu.

select ok(has_column_privilege('authenticated', 'public.cards', 'title', 'update'),
	'`title` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'description', 'update'),
	'`description` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'position', 'update'),
	'`position` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'owner_id', 'update'),
	'`owner_id` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'amount', 'update'),
	'`amount` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'currency', 'update'),
	'`currency` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'probability_override', 'update'),
	'`probability_override` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'next_action', 'update'),
	'`next_action` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'next_action_at', 'update'),
	'`next_action_at` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'snoozed_until', 'update'),
	'`snoozed_until` reste ouverte');
select ok(has_column_privilege('authenticated', 'public.cards', 'archived_at', 'update'),
	'`archived_at` reste ouverte : l''archivage est une suppression douce, pas une transition');
select ok(has_column_privilege('authenticated', 'public.cards', 'deleted_at', 'update'),
	'`deleted_at` reste ouverte : la corbeille non plus n''est pas une transition');

-- Le compte exact, pour qu'une treizième colonne rouverte à la main ne passe pas inaperçue.
select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'cards'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE'),
	12,
	'DOUZE colonnes ouvertes, ni onze ni treize : le compte exact rend visible aussi bien une '
	'fermeture de trop qu''une réouverture à la main');

-- Les colonnes fermées par conséquence du mécanisme, reconduites de `CRM-034`.
select ok(not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'INC-049 : `current_step_id` reste fermée par `CRM-034` — cette unité ne la rouvre pas');
select ok(not has_column_privilege('authenticated', 'public.cards', 'entered_step_at', 'update'),
	'`entered_step_at` reste fermée : `docs/SPEC-cards.md` §2.9 la réserve à `move_card`');
select ok(not has_column_privilege('authenticated', 'public.cards', 'workspace_id', 'update'),
	'`workspace_id` reste fermée');
select ok(not has_column_privilege('authenticated', 'public.cards', 'channel_id', 'update'),
	'`channel_id` reste fermée');
select ok(not has_column_privilege('authenticated', 'public.cards', 'workflow_id', 'update'),
	'`workflow_id` reste fermée');
select ok(not has_column_privilege('authenticated', 'public.cards', 'health_score', 'update'),
	'`health_score` reste fermée : jamais alimentée, `docs/SPEC-cards.md` §2.9');

-- =============================================================================================
-- 3. Le refus est opposable EN BASE, pas seulement à travers PostgREST — §4.4.6, preuve n° 1
-- =============================================================================================
-- Un privilège se vérifie par le moteur : le prouver sous le rôle réel vaut mieux que de s'en
-- remettre au code HTTP rendu par une passerelle.

savepoint p_refus;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$
	update public.cards set email_local_part = 'c-00000000'
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'42501', 'permission denied for table cards',
	'ASSERTION RETOURNÉE (décision 51) : `supabase/tests/0012_cards.test.sql` constatait cette '
	'mise à jour POSSIBLE et annonçait qu''elle deviendrait rouge à `CRM-013`. Elle l''est. Le '
	'`lives_ok` devient un `throws_ok`, et l''assertion ne constate plus un manque : elle oppose '
	'un refus');

-- Le privilège se vérifie sur les colonnes NOMMÉES, non sur les valeurs changées : réécrire la
-- valeur courante est refusé tout autant. MESURÉ à travers l'API, ligne d du contrat §4.4.4.
select throws_ok($$
	update public.cards
	   set email_local_part = (select email_local_part from public.cards
	                            where id = '5eed0000-0000-4000-8000-0000000000c1')
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'42501', 'permission denied for table cards',
	'ligne d du contrat : réécrire la valeur COURANTE est refusé aussi. Le privilège porte sur les '
	'colonnes nommées, pas sur les valeurs modifiées — un test qui n''éprouverait que le changement '
	'laisserait croire à une garde de valeur');

-- Une mise à jour qui touche une colonne ouverte ET la colonne fermée est refusée EN ENTIER :
-- ligne c du contrat. Sans cette assertion, on pourrait croire que PostgreSQL applique la partie
-- permise.
select throws_ok($$
	update public.cards set title = 'TITRE QUI NE DOIT PAS PASSER', email_local_part = 'c-00000000'
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'42501', 'permission denied for table cards',
	'ligne c du contrat : l''instruction entière est refusée, le titre compris. Le refus n''est pas '
	'partiel');

-- Contre-épreuve : sans quoi les trois refus ci-dessus seraient verts même si TOUTE écriture était
-- fermée, ce qui serait une régression et non une protection.
select lives_ok($$
	update public.cards set title = 'Refonte du site vitrine'
	 where id = '5eed0000-0000-4000-8000-0000000000c1' $$,
	'CONTRE-ÉPREUVE, ligne b du contrat : une colonne ouverte s''écrit toujours. Sans elle, les '
	'refus ci-dessus seraient verts même si l''unité avait tout fermé');

reset role;
release savepoint p_refus;

-- =============================================================================================
-- 4. Le chemin d'insertion, INCHANGÉ — §4.4.2, décision 140
-- =============================================================================================
-- Ce que cette unité ne devait PAS changer mérite une preuve autant que ce qu'elle change : un
-- retrait futur du trigger rouvrirait le choix de l'adresse au client, sans que le privilège
-- `UPDATE` n'y voie rien.

select has_trigger('public', 'cards', 'cards_generer_email_local_part',
	'le trigger `BEFORE INSERT` de `CRM-040` est TOUJOURS là : c''est lui, et non le privilège, '
	'qui neutralise une adresse choisie à l''insertion');

-- `pg_trigger.tgtype` : bit 2 = BEFORE, bit 4 = INSERT. Les deux doivent être posés — un `AFTER`
-- ne pourrait pas remplacer la valeur, et un trigger d'`UPDATE` protégerait autre chose.
select is(
	(select t.tgtype::int & 6 from pg_trigger t
	  where t.tgrelid = 'public.cards'::regclass
	    and t.tgname = 'cards_generer_email_local_part'),
	6,
	'et il est bien `BEFORE INSERT` : un `AFTER` ne pourrait pas remplacer la valeur');

savepoint p_insert;
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title,
                          email_local_part, created_by)
values ('5eed0000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000032',
        '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000062',
        'tst-crm013-insertion',
        'c-zzzzzzzz',
        '5eed0000-0000-4000-8000-000000000011');

select isnt(
	(select email_local_part from public.cards where title = 'tst-crm013-insertion'),
	'c-zzzzzzzz',
	'ligne h du contrat : l''adresse CHOISIE par l''appelant est ignorée. L''insertion est acceptée '
	'— ce qui est voulu —, et la valeur fournie ne survit pas');

select matches(
	(select email_local_part from public.cards where title = 'tst-crm013-insertion'),
	'^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$',
	'et la valeur enregistrée est bien une adresse GÉNÉRÉE, à la forme de `docs/SPEC-cards.md` §3.2');

-- `reset role` AVANT la suppression : `authenticated` n'a pas le privilège `DELETE` sur `cards`
-- (migration 0011), et l'y tenter lèverait `42501` — la suite s'arrêterait pour une raison sans
-- rapport avec son objet. La sonde est donc retirée par le rôle qui l'a le droit.
reset role;
delete from public.cards where title = 'tst-crm013-insertion';
release savepoint p_insert;

-- =============================================================================================
-- 5. Le seed, inchangé
-- =============================================================================================
-- Une protection qui casserait le seed serait découverte au prochain `resetMe.sh`, c'est-à-dire
-- trop tard. Le constater ici la met sous surveillance permanente.

-- RÉVISÉES PAR `CRM-046` (décision 51) : le seed livrait NEUF cards, il en livre QUATORZE
-- (docs/SPEC-seed.md §9.3). Les trois assertions gardent leur fonction — la protection de colonne
-- ne doit toucher ni le nombre, ni la forme, ni l'unicité des adresses.
--
-- RÉVISÉES UNE SECONDE FOIS PAR `CRM-077`, cinquième tranche : l'affaire `…0cf`
-- (docs/SPEC-seed.md §10.4 bis) porte le seed à QUINZE cards. AUCUNE des trois n'est retirée ni
-- relâchée, et c'est le point : ce qu'elles surveillent — le nombre, la FORME générée, l'unicité —
-- est exactement ce qu'un retrait de privilège pourrait abîmer sans que rien d'autre le dise. Une
-- card ajoutée par une autre unité déplace leur compte ; elle ne change pas leur objet.
select is(
	(select count(*)::int from public.cards),
	15,
	'les quinze cards du seed sont intactes : cette unité ne touche aucun contenu');

select is(
	(select count(*)::int from public.cards
	  where email_local_part ~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$'),
	15,
	'et leurs quinze adresses ont toujours la forme générée : aucune n''a été réécrite');

select is(
	(select count(distinct email_local_part)::int from public.cards),
	15,
	'quinze adresses DISTINCTES : l''index unique tient, et le retrait du privilège ne l''a pas '
	'relâché');

-- =============================================================================================
-- 6. Ce qui reste dû à `CRM-013`, et la cible `card_events` désormais livrée
-- =============================================================================================
-- Quatre cibles portent encore sur des tables qui n'existent pas. Chaque assertion d'absence
-- ci-dessous deviendra ROUGE le jour où la table naîtra — et désignera alors le moment d'écrire
-- la protection correspondante (mécanisme de la décision 51). `card_events`, arrivée depuis, est
-- contrôlée positivement au même endroit.

-- CIBLE 1/6 LIVRÉE PAR `CRM-052`, ET L'ASSERTION EST RETOURNÉE — pas retirée (décision 51). Elle
-- annonçait « CETTE ASSERTION DOIT DEVENIR ROUGE À `CRM-052`, et désigner alors le `REVOKE SELECT`
-- à écrire » : elle l'a fait, et voici ce qu'elle mesure désormais. La protection est un privilège
-- de COLONNE, donc elle ne dépend d'aucune ligne et ne peut pas être contournée par un `select`
-- bien choisi (docs/SPEC-mail-subsystem.md §13.4).
select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_inbound_accounts'
	    and grantee = 'authenticated' and column_name = 'secret_id'),
	0,
	'CIBLE 1/6 LIVRÉE : `mail_inbound_accounts.secret_id` n''accorde AUCUN privilège à '
	'`authenticated`. La preuve de refus n° 6 de `docs/SPEC-permissions-rls.md` §7 est ACQUISE');

-- CIBLE 2/6 LIVRÉE PAR `CRM-053`, et l'assertion est retournée comme la précédente (décision 51).
select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'mail_outbound_identities'
	    and grantee = 'authenticated' and column_name = 'secret_id'),
	0,
	'CIBLE 2/6 LIVRÉE : `mail_outbound_identities.secret_id` n''accorde AUCUN privilège à '
	'`authenticated`. La preuve de refus n° 6 est acquise sur ses DEUX tables');

select hasnt_table('public', 'api_tokens',
	'CIBLE 3/6 NON LIVRÉE : `api_tokens.token_hash` attend `CRM-073`');

-- CIBLE 4/6 LIVRÉE PAR `CRM-044`, ET L'ASSERTION EST RETOURNÉE (décision 51). La preuve de refus
-- n° 8 est désormais satisfaisable pour MOITIÉ, et le refus y est plus fort qu'une colonne
-- protégée : ce n'est pas une colonne qui est fermée, c'est la table entière, pour les TROIS rôles.
select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_events'
	    and grantee in ('anon','authenticated','service_role')
	    and privilege_type <> 'SELECT'),
	0,
	'CIBLE 4/6 LIVRÉE : `card_events` n''accorde AUCUN privilège d''écriture, à AUCUN des trois '
	'rôles — `service_role` compris. La preuve de refus n° 8 est satisfaisable pour moitié '
	'(`audit_log` reste due par `CRM-072`)');

select hasnt_table('public', 'audit_log',
	'CIBLE 5/6 NON LIVRÉE : `audit_log` attend `CRM-072`, même refus n° 8');

-- La sixième cible, elle, est livrée — mais par `CRM-034`, et le rappeler tient INC-049 sous les
-- yeux plutôt que dans un rapport.
select ok(
	not has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update'),
	'CIBLE 6/6 : livrée, mais par `CRM-034` — INC-049, chevauchement de Definition of Done tranché '
	'du côté de l''unité dont la preuve n° 5 dépendait');

select finish();
rollback;

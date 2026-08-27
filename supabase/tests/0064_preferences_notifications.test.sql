-- @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 4
-- @verifies docs/SPEC-notifications.md §43 (le modèle et la clé naturelle), §43.1 (une table et
--            non une colonne de `profiles`), §43.2 (les colonnes, le `check` fermé, la date
--            posée par la base), §43.4 (l'absence de ligne vaut consentement), §44 (le filtrage
--            est À LA LECTURE), §45.1 (`app.notification_consentie` : `stable`, `security
--            invoker`, `search_path` vide, le `coalesce` explicite), §45.2 (la troisième
--            condition de `notifications_lecture`), §46 (politiques, privilèges, et l'unique
--            chemin d'écriture), §49 (preuves attendues)
-- @verifies docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3 (migration 67)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve NI l'éligibilité d'une mention (`0061` la tient), NI la production d'une
-- notification (`0062`), NI la liste du sélecteur (`0063`). Ces trois suites doivent rester
-- VERTES SANS AUCUNE MODIFICATION, et c'est là qu'est la preuve de non-régression de la tranche
-- 4 — pas ici. Le §48 bis explique pourquoi elle est ATTENDUE et non espérée : le seed ne pose
-- aucune préférence, et l'absence de ligne vaut « je reçois ».
--
-- Ce que ce fichier prouve, et que rien d'autre ne prouve :
--
-- 1. QUE LE DÉFAUT EST « JE REÇOIS », ET QU'IL VIENT D'UN `coalesce` EXPLICITE (§45.1). C'est le
--    piège le plus coûteux de la tranche : sans lui, la sous-requête rend NULL pour une
--    préférence absente, `NULL and …` se comporte comme FAUX dans une politique, et L'ABSENCE DE
--    DÉCISION COUPERAIT TOUT — c'est-à-dire que la migration livrerait un produit où plus
--    personne ne reçoit rien. Aucune preuve d'API ne le verrait tant que le seed ne pose aucune
--    préférence : elle mesurerait deux notifications lisibles, ce qu'elle mesure déjà.
--
-- 2. QUE `app.notification_consentie` EST `SECURITY INVOKER` (§45.1). En `DEFINER`, elle
--    deviendrait un ORACLE : appelable avec n'importe quel `uuid`, elle dirait si un TIERS a
--    coupé ses notifications. La propriété ne se lit que dans le catalogue.
--
-- 3. QUE LA POLITIQUE `notifications_lecture` DÉLÈGUE, au lieu de recopier le prédicat (§45.2).
--    C'est la contre-épreuve de la « seconde écriture de la règle » : une politique qui
--    interrogerait `notification_preferences` en ligne passerait toutes les assertions de
--    résultat et rendrait aujourd'hui exactement les mêmes lignes. L'assertion lit la DÉFINITION.
--
-- 4. QUE LA TABLE N'A QU'UNE POLITIQUE, ET QUE LES TROIS AUTRES SONT ABSENTES (§46.1). Une
--    politique d'écriture ajoutée par mégarde ferait tomber la moitié du refus double du §46.2
--    sans qu'aucune preuve de comportement ne bouge, le privilège tenant encore.
--
-- 5. QUE `anon` N'A PAS `execute` SUR LA RPC, ET QUE `authenticated` L'A (§46.3). Leçon payée par
--    la migration `0053` : `pg_default_acl` accorde `execute` à `anon` sur toute fonction neuve
--    de `public`, et `revoke … from public` ne lui retire rien.
--
-- 6. QUE LA DATE EST POSÉE PAR LA BASE (§43.2), y compris sous le PROPRIÉTAIRE, qui traverse la
--    RLS et les privilèges de colonne mais PAS les triggers. C'est la seule barrière qui tienne
--    pour la clé de service, chemin du seed et des harnais.
--
-- 7. QUE LA TABLE N'EST PAS PUBLIÉE AU TEMPS RÉEL (§46.4). Ne rien faire EST la décision ; sans
--    assertion, une publication ajoutée par précaution poserait une surface d'autorisation sans
--    preuve.
--
-- La suite écrit puis fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.p_admin() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.p_bizdev() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 6. Le modèle — docs/SPEC-notifications.md §43
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'notification_preferences',
	'CRM-064 §43 — la table existe : sans elle, la tranche 4 n''a aucun endroit où poser une '
	'décision, et le §18 point 3 reste ouvert');

select columns_are('public', 'notification_preferences',
	array['profile_id', 'type', 'in_app', 'updated_at'],
	'CRM-064 §43.2 — QUATRE colonnes, et pas une de plus. AUCUNE `created_at` : la date qui '
	'compte est celle de la DERNIÈRE décision (§43.2). AUCUN `workspace_id` : une préférence est '
	'une décision sur SOI, non sur un contexte de travail (§43.3). AUCUNE colonne `channel` : le '
	'§42.1 mesure qu''aucun canal sortant n''existe');

-- CLÉ PRIMAIRE NATURELLE, ET C'EST L'INVERSE DE `notifications`. Une clé technique autoriserait
-- deux lignes contradictoires pour la même personne et le même type, que rien ne départagerait.
select col_is_pk('public', 'notification_preferences', array['profile_id', 'type'],
	'CRM-064 §43.2 — clé primaire NATURELLE `(profile_id, type)` : une préférence n''a pas '
	'd''existence propre, elle EST la décision d''une personne sur un type. C''est l''inverse de '
	'la clé technique de `notifications` (§13.2), et c''est délibéré');

select col_is_fk('public', 'notification_preferences', 'profile_id',
	'CRM-064 §43.2 — `profile_id` est une clé étrangère : une préférence sans compte n''existe pas');

select is(
	(select confdeltype from pg_catalog.pg_constraint
	  where conrelid = 'public.notification_preferences'::regclass and contype = 'f'),
	'c',
	'CRM-064 §43.2 — `ON DELETE CASCADE` : un compte supprimé emporte ses préférences. Les '
	'conserver laisserait une décision orpheline qu''aucune politique ne rendrait plus lisible');

-- LE `check` EST FERMÉ, ET C'EST LA MÊME GARDE QU'AU §13.3. Sans lui, une tranche future
-- écrirait un type inventé, et deux lecteurs interpréteraient différemment la même ligne.
select is(
	(select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
	  where conrelid = 'public.notification_preferences'::regclass
	    and conname  = 'notification_preferences_type_check'),
	'CHECK ((type = ANY (ARRAY[''mention''::text])))',
	'CRM-064 §43.2 — `check` FERMÉ sur « mention », et sous la MÊME forme normalisée que '
	'`notifications_type_check` : une définition non normalisée ferait détruire puis reposer la '
	'contrainte à chaque rejeu du répertoire. L''ouvrir aujourd''hui à des sources qui n''existent '
	'pas serait l''anticipation que `CLAUDE.md` §1 interdit. La contrainte '
	'autoriserait sinon des préférences que rien ne produit');

-- ---------------------------------------------------------------------------------------------
-- 7 à 10. `app.notification_consentie` — docs/SPEC-notifications.md §45.1
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'notification_consentie', array['uuid', 'text'],
	'CRM-064 §45.1 — la fonction existe : c''est le seul endroit où la préférence agit, et la '
	'politique du §45.2 lui délègue');

-- `SECURITY INVOKER` PAR DISCRÉTION, et c'est l'écart avec le §14.1 comme c'était celui du §34.2.
select is(
	(select p.prosecdef from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notification_consentie'),
	false,
	'CRM-064 §45.1 — `security invoker`, JAMAIS `definer` : en `definer` la fonction serait un '
	'ORACLE, appelable avec n''importe quel uuid, disant si un TIERS a coupé ses notifications');

select is(
	(select p.provolatile from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notification_consentie'),
	's'::"char",
	'CRM-064 §45.1 — `stable`, jamais `immutable` : elle lit une table. Un `immutable` autoriserait '
	'le planificateur à mettre son résultat en cache au-delà de l''instruction');

select is(
	(select p.proconfig from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notification_consentie'),
	array['search_path=""'],
	'CRM-064 §45.1 — `search_path` VIDE et noms pleinement qualifiés, comme les onze fonctions du '
	'schéma `app` : un `search_path` hérité laisserait un appelant détourner la table lue');

-- ---------------------------------------------------------------------------------------------
-- 11 à 13. LE DÉFAUT EST « JE REÇOIS », et c'est le `coalesce` qui le porte — §43.4, §45.1
-- ---------------------------------------------------------------------------------------------
-- C'EST L'ASSERTION LA PLUS IMPORTANTE DE LA SUITE, et elle est la seule qui puisse voir ce
-- défaut : le seed ne posant aucune préférence, une preuve d'API mesurerait exactement ce qu'elle
-- mesurait avant la migration.

select is(
	app.notification_consentie(pg_temp.p_bizdev(), 'mention'),
	true,
	'CRM-064 §43.4 — SANS AUCUNE LIGNE, le consentement vaut VRAI. Sans le `coalesce` explicite '
	'de la migration, la sous-requête rendrait NULL, et `NULL and …` se comporte comme FAUX dans '
	'une politique : l''absence de décision COUPERAIT TOUT, et le produit livré ne notifierait '
	'plus personne');

insert into public.notification_preferences (profile_id, type, in_app)
values (pg_temp.p_bizdev(), 'mention', false);

select is(
	app.notification_consentie(pg_temp.p_bizdev(), 'mention'),
	false,
	'CRM-064 §45.1 — une ligne posée à faux coupe, et elle seule');

select is(
	app.notification_consentie(pg_temp.p_admin(), 'mention'),
	true,
	'CRM-064 §43.1 — la décision de l''un ne touche pas l''autre : la préférence est PERSONNELLE, '
	'et c''est le motif même de la table séparée (M7)');

-- ---------------------------------------------------------------------------------------------
-- 14. LA DATE EST POSÉE PAR LA BASE, ET LE TRIGGER TIENT SOUS LE PROPRIÉTAIRE — §43.2
-- ---------------------------------------------------------------------------------------------
-- Cette suite s'exécute sous le PROPRIÉTAIRE, qui traverse la RLS et les privilèges de colonne
-- mais PAS les triggers. C'est exactement le chemin de la clé de service, celui du seed et des
-- harnais : une date antidatée y passerait si le trigger manquait.

update public.notification_preferences
   set updated_at = '2016-01-01T00:00:00Z'::timestamptz
 where profile_id = pg_temp.p_bizdev() and type = 'mention';

select ok(
	(select updated_at from public.notification_preferences
	  where profile_id = pg_temp.p_bizdev() and type = 'mention') > now() - interval '1 minute',
	'CRM-064 §43.2 — une date VIEILLE DE DIX ANS envoyée sous le PROPRIÉTAIRE ne survit pas : le '
	'trigger la remplace par `now()`. C''est la seconde barrière du §43.2, et la seule qui tienne '
	'pour la clé de service — le privilège de colonne, lui, ne la voit même pas');

-- ---------------------------------------------------------------------------------------------
-- 15 à 18. Autorisations et privilèges — docs/SPEC-notifications.md §46.1 et §46.2
-- ---------------------------------------------------------------------------------------------

select ok(
	(select relrowsecurity from pg_catalog.pg_class
	  where oid = 'public.notification_preferences'::regclass),
	'CRM-064 §46.1 — la RLS est ACTIVE : sans elle, le privilège `select` accordé à `anon` et à '
	'`authenticated` rendrait la table entière, préférences d''autrui comprises');

-- UNE SEULE POLITIQUE, ET L'ABSENCE DES TROIS AUTRES EST LA MOITIÉ DU REFUS DOUBLE DU §46.2.
select is(
	(select string_agg(polname::text || ':' || polcmd::text, ', ' order by polname::text)
	   from pg_catalog.pg_policy
	  where polrelid = 'public.notification_preferences'::regclass),
	'notification_preferences_lecture:r',
	'CRM-064 §46.1 — UNE politique, et une seule, en lecture. Aucune politique `insert`, `update` '
	'ni `delete` : la table est fermée en écriture et la RPC du §46.3 est le seul chemin. Une '
	'politique ajoutée par mégarde ferait tomber la moitié du refus double sans qu''aucune preuve '
	'de comportement ne bouge, le privilège tenant encore');

-- LE REFUS EST DOUBLE : ni politique (ci-dessus), ni privilège (ici).
select ok(
	not has_table_privilege('authenticated', 'public.notification_preferences', 'INSERT')
	and not has_table_privilege('authenticated', 'public.notification_preferences', 'UPDATE')
	and not has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE'),
	'CRM-064 §46.2 — `authenticated` n''a AUCUN privilège d''écriture, d''aucune sorte. C''est la '
	'seconde moitié du refus double, et c''est elle que M10 mesure : le PATCH direct rend '
	'`403 / 42501`');

-- `anon` REÇOIT `SELECT`, et ce n'est pas un relâchement : sans le privilège, un anonyme
-- recevrait une ERREUR là où le comportement exigé est ZÉRO LIGNE (§46.1, §15.2).
select ok(
	has_table_privilege('anon', 'public.notification_preferences', 'SELECT')
	and has_table_privilege('authenticated', 'public.notification_preferences', 'SELECT'),
	'CRM-064 §46.1 — les DEUX rôles clients ont `select` : `auth.uid()` étant nul pour l''anonyme, '
	'le prédicat est faux et le refus se mesure comme ZÉRO LIGNE, jamais comme une erreur');

-- ---------------------------------------------------------------------------------------------
-- 19 à 21. L'unique chemin d'écriture — docs/SPEC-notifications.md §46.3
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'definir_preference_notification', array['text', 'boolean'],
	'CRM-064 §46.3 — la RPC existe, dans `public` : PostgREST n''expose que `public`, `storage` et '
	'`graphql_public`, et une RPC de `app` serait inatteignable');

select is(
	(select p.prosecdef from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'definir_preference_notification'),
	true,
	'CRM-064 §46.3 — `security definer` par NÉCESSITÉ : la table est fermée en écriture aux deux '
	'rôles clients, et en `invoker` l''insertion rendrait `42501` — même famille que M9/M10 de la '
	'tranche 2');

-- `anon` RÉVOQUÉ NOMMÉMENT — leçon de la migration `0053`, redite par le §34.4.
select ok(
	not has_function_privilege('anon', 'public.definir_preference_notification(text, boolean)', 'EXECUTE')
	and has_function_privilege('authenticated', 'public.definir_preference_notification(text, boolean)', 'EXECUTE'),
	'CRM-064 §46.3 — `anon` n''a PAS `execute`, `authenticated` l''a. `pg_default_acl` accorde '
	'`execute` à `anon` sur toute fonction neuve de `public`, et `revoke … from public` ne lui '
	'retire rien : sans la ligne nominative, l''anonyme obtiendrait un refus MÉTIER là où le '
	'contrat annonce un refus de PRIVILÈGE');

-- ---------------------------------------------------------------------------------------------
-- 22 à 23. La politique de `notifications` DÉLÈGUE — docs/SPEC-notifications.md §45.2
-- ---------------------------------------------------------------------------------------------
-- CONTRE-ÉPREUVE DE LA « SECONDE ÉCRITURE DE LA RÈGLE ». Une politique qui interrogerait
-- `notification_preferences` en ligne passerait toutes les assertions de résultat et rendrait
-- aujourd'hui exactement les mêmes lignes. Elle divergerait au premier changement de défaut.

select ok(
	(select pg_catalog.pg_get_expr(polqual, polrelid) from pg_catalog.pg_policy
	  where polrelid = 'public.notifications'::regclass and polname = 'notifications_lecture')
	like '%notification_consentie%',
	'CRM-064 §45.2 — la politique de lecture DÉLÈGUE à `app.notification_consentie` : c''est là '
	'que la préférence agit, et la liste, le compteur et le temps réel la subissent tous les '
	'trois d''un coup puisqu''ils lisent tous cette table sous cette politique');

select ok(
	(select pg_catalog.pg_get_expr(polqual, polrelid) from pg_catalog.pg_policy
	  where polrelid = 'public.notifications'::regclass and polname = 'notifications_lecture')
	not like '%notification_preferences%',
	'CRM-064 §45.2 — et elle ne RECOPIE PAS la lecture de la table : une politique qui '
	'interrogerait `notification_preferences` en ligne serait la seconde écriture de la règle, et '
	'rendrait aujourd''hui exactement les mêmes lignes — donc invisible à toute assertion de '
	'résultat');

-- ---------------------------------------------------------------------------------------------
-- 24. La table n'est PAS publiée au temps réel — docs/SPEC-notifications.md §46.4
-- ---------------------------------------------------------------------------------------------
-- NE RIEN FAIRE EST LA DÉCISION, et c'est cette assertion qui la garde. Publier une table que
-- personne n'écoute serait poser une surface d'autorisation sans preuve. La ligne de base est
-- M13 : `card_comments` et `notifications`, et elles seules.

select is(
	(select count(*)::integer from pg_catalog.pg_publication_tables
	  where pubname = 'supabase_realtime'
	    and schemaname = 'public'
	    and tablename = 'notification_preferences'),
	0,
	'CRM-064 §46.4 — la table n''est PAS publiée : rien ne s''y abonne. Une préférence change là '
	'où on la change, et la RPC rend la ligne retenue à l''écran qui la change');

select * from finish();

rollback;

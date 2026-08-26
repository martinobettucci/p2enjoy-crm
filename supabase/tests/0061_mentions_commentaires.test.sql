-- @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 1 :
--            la mention en base
-- @verifies docs/SPEC-notifications.md §4 (modèle, clé primaire, trois clés étrangères, index),
--            §5 (la règle d'éligibilité et sa généralisation par délégation), §6 (le trigger et
--            ses trois refus), §7.1 (les trois politiques et l'absence de la quatrième),
--            §7.2 (privilèges), §7.3 (aucune publication au temps réel), §7.4 (le retrait de
--            `card_comments.mentions`), §8.1 (la clé étrangère est la SECONDE barrière), §9 (seed)
-- @verifies docs/SPEC-cards.md §13.2 (ce que `card_comments` porte désormais), §13.7
-- @verifies docs/SPEC-permissions-rls.md §2.2 (`app.resolve_access` inchangée), §3.3, §3.5, §7
-- @verifies docs/SCHEMA.md §5 ; docs/PROD_MIGRATIONS.md §3 (migration 63)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS la règle d'accès elle-même : `0002_fonctions_autorisation.test.sql` et
-- `0011_droits_fins.test.sql` la tiennent, rôle par rôle et combinaison par combinaison. La
-- tranche 1 GÉNÉRALISE cette chaîne par un paramètre et fait des quatre fonctions existantes des
-- délégations d'une ligne (docs/SPEC-notifications.md §5.3) ; ces deux suites doivent donc rester
-- VERTES SANS ÊTRE MODIFIÉES, et c'est LÀ qu'est la preuve de non-régression — pas ici.
--
-- Ce que ce fichier prouve, et que rien d'autre ne prouve :
--
-- 1. QUE LA DÉLÉGATION EST FIDÈLE. Pour chacun des trois profils du seed et pour chaque channel,
--    `app.can_read_card_pour(card, profil)` rend ce que la fonction historique rendrait pour cet
--    appelant. L'assertion compare les DEUX chaînes plutôt que d'affirmer leur équivalence.
--
-- 2. QUE LA CLÉ ÉTRANGÈRE EST UNE BARRIÈRE RÉELLE, et non une contrainte que le trigger rend
--    inatteignable. Le §8.1 mesure que le refus métier tombe le PREMIER — le trigger est
--    `BEFORE INSERT` —, si bien qu'aucun appel d'API ne peut faire parler la clé. Elle est donc
--    éprouvée trigger DÉSACTIVÉ : sans cette assertion, une clé étrangère oubliée passerait
--    inaperçue.
--
-- 3. QUE LE REFUS DE LA MISE À JOUR EST DOUBLE (§7.1) — aucun privilège ET aucune politique. Les
--    deux sont figés séparément : sans cela, on ne saurait pas lequel des deux refuse.
--
-- 4. QUE LA TABLE N'EST PAS PUBLIÉE AU TEMPS RÉEL (§7.3). L'absence est figée pour qu'une
--    publication ajoutée « par précaution » se voie ici d'abord.
--
-- 5. QUE `card_comments.mentions` A DISPARU (§7.4), et que la table de liaison la remplace.
--
-- La suite modifie des lignes puis fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.p_admin() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.p_bizdev() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.p_viewer() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- `…0d1` : commentaire de l'administratrice sur `…0c1`, qui vit dans `grands-comptes` — channel
-- FERMÉ à la lectrice (docs/SPEC-notifications.md §2, mesures M5 et M6).
create or replace function pg_temp.c_ferme() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000d1'::uuid $$;
-- `…0d4` : la pierre tombale.
create or replace function pg_temp.c_tombale() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000d4'::uuid $$;
-- `…0d5` : commentaire de la lectrice sur `…0c5`, dans `maintenance` — lisible par les trois.
create or replace function pg_temp.c_ouvert() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000d5'::uuid $$;

create or replace function pg_temp.card_fermee() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.card_ouverte() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c5'::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 8. La forme de la table — docs/SPEC-notifications.md §4.1
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'card_comment_mentions',
	'CRM-064 §4 — `public.card_comment_mentions` existe : la mention est une RELATION, non un '
	'tableau d''identifiants sans intégrité (INC-033)');

select has_column('public', 'card_comment_mentions', 'comment_id', 'colonne `comment_id`');
select has_column('public', 'card_comment_mentions', 'profile_id', 'colonne `profile_id`');
select has_column('public', 'card_comment_mentions', 'workspace_id', 'colonne `workspace_id`');
select has_column('public', 'card_comment_mentions', 'created_at', 'colonne `created_at`');

-- L'ENSEMBLE des colonnes, non leur présence une à une : ajouter une colonne demain doit faire
-- rougir cette suite, ce qu'une série de `has_column` ne ferait pas.
select is(
	(select array_agg(a.attname::text order by a.attnum)
	   from pg_catalog.pg_attribute a
	  where a.attrelid = 'public.card_comment_mentions'::regclass
	    and a.attnum > 0 and not a.attisdropped),
	array['comment_id', 'profile_id', 'workspace_id', 'created_at'],
	'CRM-064 §4.1 — QUATRE colonnes et quatre seulement : aucune clé technique de substitution '
	'(la ligne EST le lien), aucune `updated_at` (une mention se pose ou se retire)');

select col_is_pk('public', 'card_comment_mentions', array['comment_id', 'profile_id'],
	'CRM-064 §4.1 — la clé primaire `(comment_id, profile_id)` porte « on ne mentionne pas deux '
	'fois la même personne dans le même commentaire » sans qu''aucun code ne le vérifie');

select has_index('public', 'card_comment_mentions',
	'card_comment_mentions_profile_id_created_at_idx',
	'CRM-064 §4.3 — l''index de la lecture INVERSE, « qu''est-ce qui me mentionne », posé avec la '
	'table qu''il indexe plutôt que rattaché après coup à la tranche 2');

-- ---------------------------------------------------------------------------------------------
-- 9 à 11. Les trois clés étrangères — docs/SPEC-notifications.md §4.2
-- ---------------------------------------------------------------------------------------------

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.card_comment_mentions'::regclass
	    and c.conname  = 'card_comment_mentions_comment_id_workspace_id_fkey'),
	'FOREIGN KEY (comment_id, workspace_id) REFERENCES card_comments(id, workspace_id) ON DELETE CASCADE',
	'CRM-064 §4.2 — clé composite vers `card_comments (id, workspace_id)` : une mention dont le '
	'workspace diffère de celui de son commentaire est impossible, même par la clé de service');

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.card_comment_mentions'::regclass
	    and c.conname  = 'card_comment_mentions_profile_id_fkey'),
	'FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE',
	'CRM-064 §4.2 — `profile_id` en CASCADE : la colonne est partie de la clé primaire, donc non '
	'nulle. Supprimer un compte efface ses mentions, et c''est NOMMÉ plutôt que subi');

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.card_comment_mentions'::regclass
	    and c.conname  = 'card_comment_mentions_workspace_id_fkey'),
	'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE',
	'CRM-064 §4.2 — `workspace_id` référence `workspaces` : aucune mention hors de tout espace');

-- ---------------------------------------------------------------------------------------------
-- 12. L'unicité que la clé composite exigeait — docs/SPEC-notifications.md §4.2, mesures M3/M4
-- ---------------------------------------------------------------------------------------------

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.card_comments'::regclass
	    and c.conname  = 'card_comments_id_workspace_id_key'),
	'UNIQUE (id, workspace_id)',
	'CRM-064 §4.2 — l''unicité redondante posée sur `card_comments` : sans elle, « there is no '
	'unique constraint matching given keys » — MESURÉ. Aucun comportement ne change');

-- ---------------------------------------------------------------------------------------------
-- 13 à 15. `card_comments.mentions` a disparu — docs/SPEC-notifications.md §7.4
-- ---------------------------------------------------------------------------------------------
-- ASSERTION RETOURNÉE, JAMAIS RETIRÉE (mécanisme de la décision 51). `0017_commentaires.test.sql`
-- figeait la PRÉSENCE d'une colonne « alimentée par rien » ; la tranche 1 l'a remplacée par une
-- relation, et l'assertion mesure désormais l'ABSENCE. Le motif est écrit là-bas comme ici.

select hasnt_column('public', 'card_comments', 'mentions',
	'CRM-064 §7.4 — `card_comments.mentions` est RETIRÉE. Un `uuid[]` ne portait ni intégrité '
	'référentielle (INC-033) ni règle d''éligibilité, et il était ouvert à l''insertion — MESURÉ, '
	'mesure M8. Deux porteurs du même fait divergeraient au premier écart');

-- La comparaison de `mentions` a disparu du trigger de mise à jour AVEC la colonne. La laisser
-- aurait fait échouer la fonction au premier détachement d'identité.
-- Le motif du retrait est ÉCRIT dans le corps, en commentaire : l'assertion vise donc
-- `new.mentions`, la référence à la colonne, et non le mot `mentions` — qui subsiste dans la
-- phrase qui explique pourquoi la comparaison a disparu.
select isnt(
	(select p.prosrc from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'card_comments_avant_maj') ~ 'new\.mentions',
	true,
	'CRM-064 §7.4 — `app.card_comments_avant_maj` ne LIT plus `new.mentions` : la comparaison a '
	'disparu avec la colonne, le reste du corps étant repris mot pour mot. La laisser aurait fait '
	'échouer la fonction au premier détachement d''identité, sur une colonne absente');

-- Les deux portes étroites d'INC-076 restent aussi ÉTROITES : retirer une comparaison ne doit pas
-- élargir ce qu'elles laissent passer.
select is(
	(select count(*) from regexp_matches(
		(select p.prosrc from pg_catalog.pg_proc p
		   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		  where n.nspname = 'app' and p.proname = 'card_comments_avant_maj'),
		'is not distinct from', 'g')),
	16::bigint,
	'CRM-064 §7.4 — les DEUX portes étroites d''INC-076 comptent seize comparaisons « rien '
	'd''autre n''a changé », huit chacune : une de moins qu''avant, `mentions` ayant disparu des '
	'deux. Une porte élargie se verrait ICI');

-- ---------------------------------------------------------------------------------------------
-- 16 à 21. Les cinq fonctions du §5.3, et la délégation
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'workspace_role_pour', array['uuid', 'uuid'],
	'CRM-064 §5.3 — `app.workspace_role_pour`');
select has_function('app', 'resolve_channel_access_pour', array['uuid', 'uuid', 'uuid', 'uuid'],
	'CRM-064 §5.3 — `app.resolve_channel_access_pour`');
select has_function('app', 'can_read_channel_pour', array['uuid', 'uuid'],
	'CRM-064 §5.3 — `app.can_read_channel_pour`');
select has_function('app', 'can_read_card_pour', array['uuid', 'uuid'],
	'CRM-064 §5.1 — `app.can_read_card_pour`, la fonction que la tranche existe pour poser');
select has_function('app', 'card_du_commentaire', array['uuid'],
	'CRM-064 §7.1 — `app.card_du_commentaire`, pour que trois politiques n''écrivent pas trois '
	'fois la même lecture');

-- `app.resolve_access` N'EST PAS TOUCHÉE : c'est elle qui porte la règle. Son corps est figé ici
-- pour qu'une seconde écriture de la règle, où qu'elle naisse, se voie d'abord dans cette suite.
select is(
	(select p.prosrc from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'resolve_access') ~ 'ws_role = ''admin''  then ''write''',
	true,
	'CRM-064 §5.3 — `app.resolve_access` porte TOUJOURS la règle, et la généralisation ne l''a pas '
	'touchée : elle lui apporte seulement les mêmes entrées pour quelqu''un d''autre');

-- ---------------------------------------------------------------------------------------------
-- 22 à 25. Les cinq fonctions sont `security definer`, `search_path` vide, propriétaire postgres
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*) from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('workspace_role_pour', 'resolve_channel_access_pour',
	                      'can_read_channel_pour', 'can_read_card_pour', 'card_du_commentaire')
	    and p.prosecdef),
	5::bigint,
	'CRM-064 §5.5 — les cinq fonctions sont `SECURITY DEFINER` : sans cela, elles liraient les '
	'tables d''appartenance sous la RLS de l''appelant et la règle dépendrait de qui la pose');

select is(
	(select count(*) from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('workspace_role_pour', 'resolve_channel_access_pour',
	                      'can_read_channel_pour', 'can_read_card_pour', 'card_du_commentaire')
	    and p.proconfig @> array['search_path=""']),
	5::bigint,
	'CRM-064 §5.5 — `search_path` vide sur les cinq : recensement du §3.8 de '
	'docs/SPEC-permissions-rls.md, appliqué DÈS la migration qui les crée');

select is(
	(select count(*) from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('workspace_role_pour', 'resolve_channel_access_pour',
	                      'can_read_channel_pour', 'can_read_card_pour', 'card_du_commentaire')
	    and p.proowner = 'postgres'::regrole),
	5::bigint,
	'CRM-064 §5.5 — propriétaire `postgres` sur les cinq : un `SECURITY DEFINER` d''un autre '
	'propriétaire s''exécuterait avec d''autres droits que ceux qui ont été raisonnés');

-- LE TRIGGER EST `SECURITY INVOKER`, ET C'EST UN CHOIX DE DISCRÉTION (§6). En `DEFINER`, un
-- appelant distinguerait un commentaire fermé d'un commentaire inexistant.
select is(
	(select p.prosecdef from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'card_comment_mentions_avant_insertion'),
	false,
	'CRM-064 §6 — le trigger est `SECURITY INVOKER` : un commentaire fermé et un commentaire '
	'inexistant doivent rendre le MÊME refus (ligne h bis du §8)');

-- ---------------------------------------------------------------------------------------------
-- 26 à 28. Les privilèges d'exécution — docs/SPEC-notifications.md §5.5
-- ---------------------------------------------------------------------------------------------
-- `app.can_read_card_pour` EST accordée à `authenticated`, et c'est une preuve qui l'a imposé
-- (décision 522) : le trigger étant `SECURITY INVOKER`, il l'exécute sous ce rôle. Sans le
-- privilège, les refus MÉTIER du §8 sont masqués par un `42501` — MESURÉ.

select ok(
	has_function_privilege('authenticated', 'app.can_read_card_pour(uuid, uuid)', 'execute'),
	'CRM-064 §5.5 — `authenticated` EXÉCUTE `app.can_read_card_pour` : le trigger est '
	'`SECURITY INVOKER`, donc il l''exécute sous ce rôle. Sans ce privilège, un `42501` masque la '
	'règle — MESURÉ, décision 522');

select ok(
	not has_function_privilege('anon', 'app.can_read_card_pour(uuid, uuid)', 'execute'),
	'CRM-064 §5.5 — `anon` ne l''exécute PAS : il ne détient aucun privilège `INSERT` sur la '
	'table, donc le trigger ne s''exécute jamais sous son rôle. Lui accorder n''ouvrirait aucun '
	'chemin et élargirait la surface sans contrepartie');

-- Les trois autres variantes `_pour` ne sont atteintes que DEPUIS `can_read_card_pour`, qui est
-- `SECURITY DEFINER` de propriétaire `postgres` : elles s'exécutent donc sous `postgres`.
select is(
	(select count(*) from (values
		('app.workspace_role_pour(uuid, uuid)'),
		('app.resolve_channel_access_pour(uuid, uuid, uuid, uuid)'),
		('app.can_read_channel_pour(uuid, uuid)')) as f(sig)
	  where has_function_privilege('authenticated', f.sig, 'execute')
	     or has_function_privilege('anon', f.sig, 'execute')),
	0::bigint,
	'CRM-064 §5.5 — les TROIS autres variantes `_pour` sont fermées aux deux rôles clients : '
	'elles ne sont atteintes que depuis `can_read_card_pour`, exécutée sous `postgres`');

-- ---------------------------------------------------------------------------------------------
-- 29 à 32. La délégation est FIDÈLE — docs/SPEC-notifications.md §5.4
-- ---------------------------------------------------------------------------------------------
-- L'assertion ne se contente pas d'affirmer l'équivalence « par construction » : elle compare le
-- verdict de la chaîne paramétrée à la matrice d'accès MESURÉE du §2 (mesure M5), profil par
-- profil et channel par channel.

select is(
	(select count(*) from public.channels ch
	  where app.can_read_channel_pour(ch.id, pg_temp.p_admin())),
	8::bigint,
	'CRM-064 §5.4 — l''administratrice lit les HUIT channels : `resolve_access` rend « write » '
	'pour un `admin` avant même de regarder les droits fins, et la délégation le préserve');

select is(
	(select count(*) from public.channels ch
	  where app.can_read_channel_pour(ch.id, pg_temp.p_viewer())),
	6::bigint,
	'CRM-064 §5.4 — la lectrice lit SIX channels sur huit : `appels-offres` et `grands-comptes` '
	'lui sont fermés par le droit fin « none » posé sur leur track (mesure M5)');

select ok(
	not app.can_read_card_pour(pg_temp.card_fermee(), pg_temp.p_viewer()),
	'CRM-064 §5.1 — la lectrice ne lit PAS `…0c1`, qui vit dans `grands-comptes`. C''est le cas '
	'de refus de la tranche, et il est DÉJÀ dans le seed (mesures M5 et M6)');

select ok(
	app.can_read_card_pour(pg_temp.card_ouverte(), pg_temp.p_viewer()),
	'CRM-064 §5.1 — mais elle lit `…0c5`, qui vit dans `maintenance`. Le refus se mesure donc '
	'comme une ligne ABSENTE d''une liste peuplée, non comme un écran vide');

-- ---------------------------------------------------------------------------------------------
-- 33 à 36. Les trois refus du trigger — docs/SPEC-notifications.md §6
-- ---------------------------------------------------------------------------------------------

select throws_ok(
	format($$insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	         values (%L, %L, %L)$$,
	       '00000000-0000-4000-8000-00000000beef', pg_temp.p_bizdev(),
	       '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'comment_not_found',
	'CRM-064 §6 refus 1 — un commentaire inconnu rend `comment_not_found`');

select throws_ok(
	format($$insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	         values (%L, %L, %L)$$,
	       pg_temp.c_tombale(), pg_temp.p_bizdev(), '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'comment_deleted',
	'CRM-064 §6 refus 2 — une pierre tombale ne mentionne plus personne, et le vocable est celui '
	'que `app.card_comments_avant_maj` rend déjà : un second vocable ferait diverger deux '
	'dictionnaires de refus');

select throws_ok(
	format($$insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	         values (%L, %L, %L)$$,
	       pg_temp.c_ferme(), pg_temp.p_viewer(), '5eed0000-0000-4000-8000-000000000001'),
	'P0001', 'mention_destinataire_sans_acces',
	'CRM-064 §6 refus 3 — la lectrice ne peut pas être mentionnée sur `…0c1` : la mention lui '
	'adresserait, en tranche 2, une notification vers un écran qui lui répondrait « rien à voir »');

-- LE REFUS 3 NE DIT PAS QUI. Le message nomme la règle, jamais la personne ni son niveau d'accès :
-- un refus ne doit pas devenir un moyen de sonder les droits d'autrui.
-- L'ASSERTION PORTE SUR L'INTERPOLATION, ET C'EST PLUS FORT QUE DE CHERCHER UN NOM. Le corps ne
-- contient AUCUN `%` : `raise` n'a donc aucun moyen de faire entrer une valeur dans un message,
-- quelle qu'elle soit. Chercher `full_name` n'aurait interdit qu'une formulation ; interdire
-- l'interpolation les interdit toutes.
select ok(
	(select p.prosrc from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'card_comment_mentions_avant_insertion')
	  !~ '%',
	'CRM-064 §6 — aucun `%` dans le corps du trigger : ses trois refus ne peuvent interpoler '
	'AUCUNE valeur. Le refus nomme la règle, jamais la personne, son identifiant ou son niveau '
	'd''accès — un refus ne doit pas devenir un moyen de sonder les droits d''autrui');

-- ---------------------------------------------------------------------------------------------
-- 37 à 39. Le cas nominal, la dérivation, et l'unicité
-- ---------------------------------------------------------------------------------------------

-- La sonde vise `…0d5` × l'administratrice : un couple que le seed ne pose PAS (§9), et qui est
-- éligible — Camille lit `…0c5`. Viser un couple seedé ferait rougir l'insertion sur le doublon.
--
-- ELLE ENVOIE DEUX VALEURS FAUSSES, ET C'EST INDISPENSABLE : un `workspace_id` qui n'est pas celui
-- du commentaire, et un `created_at` d'il y a dix ans. Sans elles, les deux assertions qui suivent
-- resteraient vertes sur un trigger qui se contenterait d'un `coalesce` — MESURÉ par la dégradation
-- D-D de `scripts/verify-mentions.sh`, qui a trouvé cette suite COMPLAISANTE sur `created_at`.
insert into public.card_comment_mentions (comment_id, profile_id, workspace_id, created_at)
values (pg_temp.c_ouvert(), pg_temp.p_admin(), '00000000-0000-4000-8000-000000000000',
        now() - interval '10 years');

select is(
	(select workspace_id from public.card_comment_mentions
	  where comment_id = pg_temp.c_ouvert() and profile_id = pg_temp.p_admin()),
	'5eed0000-0000-4000-8000-000000000001'::uuid,
	'CRM-064 §6 — `workspace_id` est DÉRIVÉ du commentaire, quelle que soit la valeur envoyée : '
	'l''appel ci-dessus en proposait une fausse, et la clé composite l''aurait refusée de toute '
	'façon — deux barrières, et c''est voulu');

select ok(
	(select created_at from public.card_comment_mentions
	  where comment_id = pg_temp.c_ouvert() and profile_id = pg_temp.p_admin())
	  > now() - interval '1 minute',
	'CRM-064 §4.1 — `created_at` est RÉÉCRIT par le trigger : l''insertion ci-dessus en envoyait '
	'un vieux de DIX ANS, et il ne survit pas. Une mention antidatée fausserait l''ordre de la '
	'lecture « qu''est-ce qui me mentionne », qui est LA lecture de la tranche 2');

select throws_ok(
	format($$insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	         values (%L, %L, %L)$$,
	       pg_temp.c_ouvert(), pg_temp.p_admin(), '5eed0000-0000-4000-8000-000000000001'),
	'23505', null,
	'CRM-064 §4.1 — la clé primaire refuse le doublon : « on ne mentionne pas deux fois la même '
	'personne dans le même commentaire » sans qu''aucun code ne le vérifie');

-- ---------------------------------------------------------------------------------------------
-- 40. LA CLÉ ÉTRANGÈRE EST LA SECONDE BARRIÈRE — docs/SPEC-notifications.md §8.1
-- ---------------------------------------------------------------------------------------------
-- Le trigger est `BEFORE INSERT` : il refuse AVANT que la clé étrangère ne soit vérifiée, si bien
-- qu'aucun appel d'API ne peut la faire parler. C'est une propriété désirable — le refus ne dit
-- pas si le profil existe —, mais elle rend la clé INVISIBLE. Éprouvée ici trigger désactivé :
-- sans cette assertion, une clé étrangère oubliée passerait inaperçue.

alter table public.card_comment_mentions disable trigger card_comment_mentions_avant_insertion;

select throws_ok(
	format($$insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
	         values (%L, %L, %L)$$,
	       pg_temp.c_ouvert(), '00000000-0000-4000-8000-00000000dead',
	       '5eed0000-0000-4000-8000-000000000001'),
	'23503', null,
	'CRM-064 §8.1 — la clé étrangère vers `profiles` est une barrière RÉELLE, et non une '
	'contrainte que le trigger rend inatteignable. INC-033, refermée pour de bon');

alter table public.card_comment_mentions enable trigger card_comment_mentions_avant_insertion;

-- ---------------------------------------------------------------------------------------------
-- 41 à 44. Les politiques et les privilèges — docs/SPEC-notifications.md §7.1, §7.2
-- ---------------------------------------------------------------------------------------------

select ok(
	(select c.relrowsecurity from pg_catalog.pg_class c
	   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'card_comment_mentions'),
	'CRM-064 §7.1 — RLS activée dans la migration qui crée la table : même le temps d''une '
	'instruction, elle ne doit pas être ouverte à quiconque détient la clé anonyme');

select is(
	(select array_agg(p.polname::text order by p.polname)
	   from pg_catalog.pg_policy p
	  where p.polrelid = 'public.card_comment_mentions'::regclass),
	array['card_comment_mentions_insertion', 'card_comment_mentions_lecture',
	      'card_comment_mentions_suppression'],
	'CRM-064 §7.1 — TROIS politiques et trois seulement. L''ABSENCE de la quatrième est la moitié '
	'du refus double : une mention se retire, elle ne se modifie pas — changer `profile_id` ne '
	'serait pas une correction mais une SUBSTITUTION de destinataire');

select is(
	(select array_agg(distinct privilege_type::text order by privilege_type::text)
	   from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_comment_mentions'
	    and grantee = 'authenticated'),
	array['DELETE', 'INSERT', 'SELECT'],
	'CRM-064 §7.2 — `authenticated` lit, insère et supprime. AUCUN `UPDATE` : c''est l''autre '
	'moitié du refus double, et les deux sont figés séparément — sans cela, on ne saurait pas '
	'lequel des deux refuse');

select is(
	(select array_agg(distinct privilege_type::text order by privilege_type::text)
	   from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'card_comment_mentions'
	    and grantee = 'anon'),
	array['SELECT'],
	'CRM-064 §7.2 — `anon` LIT, et rien d''autre. Le privilège de lecture existe pour que son '
	'refus soit ZÉRO LIGNE et non une erreur : `auth.uid()` étant nul, le prédicat est faux');

-- ---------------------------------------------------------------------------------------------
-- 45. La table n'est PAS publiée au temps réel — docs/SPEC-notifications.md §7.3
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*) from pg_catalog.pg_publication_tables
	  where pubname = 'supabase_realtime' and schemaname = 'public'
	    and tablename = 'card_comment_mentions'),
	0::bigint,
	'CRM-064 §7.3 — la table n''est PAS publiée : rien ne s''y abonne, la surface étant la '
	'tranche 3. Publier une table que personne n''écoute serait poser une surface d''autorisation '
	'sans preuve. L''absence est figée pour qu''un ajout « par précaution » se voie ICI d''abord');

-- ---------------------------------------------------------------------------------------------
-- 46. Ce que le seed livre — docs/SPEC-notifications.md §9
-- ---------------------------------------------------------------------------------------------
-- L'insertion des assertions 37 à 40 vit dans la transaction ; le compte porte donc sur les
-- mentions du SEED, plus celle-là. L'assertion vérifie le seed en excluant sa propre sonde.

select is(
	(select array_agg(p.full_name::text order by p.full_name::text)
	   from public.card_comment_mentions m
	   join public.profiles p on p.id = m.profile_id
	  where not (m.comment_id = pg_temp.c_ouvert() and m.profile_id = pg_temp.p_admin())),
	array['Camille Aubert', 'Driss Lemoine'],
	'CRM-064 §9 — le seed pose DEUX mentions hors de la sonde de cette suite, et la LECTRICE n''en '
	'porte aucune : elle est « none » sur `grands-comptes`, où vivent les deux commentaires '
	'porteurs. Le seed démontre donc la règle par ce qu''il ne parvient PAS à écrire');

select * from finish();

rollback;

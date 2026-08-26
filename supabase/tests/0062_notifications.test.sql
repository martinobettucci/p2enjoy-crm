-- @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 2 :
--            la notification
-- @verifies docs/SPEC-notifications.md §13 (modèle, colonnes, `check` de `type`, clés étrangères,
--            index), §14 (la production : `SECURITY DEFINER`, `AFTER`, l'auto-mention écartée,
--            l'absence de clé étrangère vers la mention), §15 (le seul geste ouvert, privilèges,
--            refus double à l'insertion et à la suppression), §16 (les deux politiques, l'absence
--            des deux autres, aucune publication au temps réel), §19 (ce que le seed livre)
-- @verifies docs/SPEC-permissions-rls.md §3.2 (`anon` reçoit `SELECT` pour que le refus soit
--            ZÉRO LIGNE), §7
-- @verifies docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3 (migration 64)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS la règle d'éligibilité d'une mention : `0061_mentions_commentaires.test.sql`
-- la tient, et la tranche 2 ne la touche pas. Elle ajoute une CONSÉQUENCE à la pose d'une mention,
-- elle n'en change pas la règle — si bien que `0061` doit rester VERTE SANS ÊTRE MODIFIÉE, et
-- c'est LÀ qu'est la preuve de non-régression de cette tranche, pas ici.
--
-- Ce que ce fichier prouve, et que rien d'autre ne prouve :
--
-- 1. QUE LA PRODUCTION A LIEU, et qu'elle écrit ce que le §14.5 annonce, colonne par colonne. Une
--    notification qui naîtrait sans `subject_card_id`, ou avec la charge utile d'un autre
--    commentaire, passerait toutes les assertions de forme.
--
-- 2. QU'UNE AUTO-MENTION NE PRODUIT RIEN (§14.3), ET QUE LA MENTION RESTE POSÉE. Le cas est réel :
--    M5 le mesure accepté par la tranche 1, avec le jeton réel. Les deux moitiés sont figées
--    séparément — sans la seconde, un trigger qui refuserait l'auto-mention entière passerait.
--
-- 3. QUE LA COMPARAISON DE L'AUTO-MENTION PORTE SUR `author_id` ET NON SUR `auth.uid()` (§14.3).
--    Cette suite s'exécute sous le PROPRIÉTAIRE, où `auth.uid()` est NUL : un trigger qui
--    comparerait à l'appelant produirait donc ici une notification que la vraie route ne produit
--    pas. L'assertion 24 est exactement cette contre-épreuve, et elle n'est possible QUE depuis
--    ce chemin — l'API ne peut pas l'écrire.
--
-- 4. QUE RETIRER UNE MENTION N'EFFACE PAS SA NOTIFICATION (§14.4), le point ouvert n° 3 du §10
--    étant tranché ainsi. L'absence de clé étrangère vers `card_comment_mentions` est figée EN
--    PLUS du comportement : sans elle, un `ON DELETE CASCADE` ajouté demain ne se verrait qu'au
--    moment où quelqu'un retire une mention.
--
-- 5. QUE LA DATE DE LECTURE EST IMPOSÉE PAR LA BASE (§15.1). L'assertion envoie une date vieille
--    de dix ans et exige qu'elle ne survive pas — c'est la leçon que le harnais de la tranche 1 a
--    apprise à sa suite pgTAP, qui n'envoyait aucune valeur et qu'un `coalesce` aurait satisfaite.
--
-- 6. QUE LES DEUX REFUS SONT DOUBLES (§15.3, §15.4) — ni privilège, ni politique, pour
--    l'insertion comme pour la suppression. Les quatre sont figés séparément : sans cela, on ne
--    saurait pas lequel refuse.
--
-- 7. QUE LA TABLE EST PUBLIÉE AU TEMPS RÉEL (§25.1). **ASSERTION RÉVISÉE, JAMAIS RETIRÉE**, le
--    2026-08-26 par la sous-tranche 3a (mécanisme de la décision 51). Elle exigeait l'ABSENCE de
--    publication, en écrivant elle-même la condition de sa levée : « la tranche 3 la publiera DANS
--    LE MÊME CHANGEMENT que l'écran qui l'écoute ». La condition est remplie — la migration 0065
--    publie la table, et `webapp/src/app/Notifications.tsx` l'écoute —, donc l'assertion suit le
--    fait vers ce qui le porte. Elle garde son office : une publication RETIRÉE par mégarde se
--    verrait ici d'abord, et le temps réel cesserait de délivrer sans qu'aucun écran ne le dise.
--
-- La suite écrit puis fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.p_admin() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.p_bizdev() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.p_viewer() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- `…0d3` : troisième commentaire de l'administratrice sur `…0c1`, et le SEUL des cinq que le seed
-- ne mentionne pas. C'est donc le support des sondes : y écrire ne perturbe aucune assertion du
-- seed, que l'assertion 41 relit.
create or replace function pg_temp.c_libre() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000d3'::uuid $$;
create or replace function pg_temp.card_libre() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.espace() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 6. La forme de la table — docs/SPEC-notifications.md §13.2
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'notifications',
	'CRM-064 §13 — `public.notifications` existe : le §8 de `docs/SCHEMA.md` l''annonçait en une '
	'ligne, aucun chapitre ne la décrivait (§12, M1)');

-- L'ENSEMBLE des colonnes, non leur présence une à une : ajouter une colonne demain doit faire
-- rougir cette suite, ce qu'une série de `has_column` ne ferait pas.
select is(
	(select array_agg(a.attname::text order by a.attnum)
	   from pg_catalog.pg_attribute a
	  where a.attrelid = 'public.notifications'::regclass
	    and a.attnum > 0 and not a.attisdropped),
	array['id', 'workspace_id', 'recipient_id', 'type', 'subject_card_id', 'payload', 'read_at',
	      'created_at'],
	'CRM-064 §13.2 — HUIT colonnes et huit seulement. Aucune `updated_at` : `read_at` est la seule '
	'mutation ouverte et porte sa propre date (INC-025)');

select col_is_pk('public', 'notifications', array['id'],
	'CRM-064 §13.2 — une clé primaire TECHNIQUE, et c''est l''INVERSE de la mention : une '
	'notification n''est pas un fait mais un MESSAGE, une chose qui a sa propre existence. Deux '
	'messages identiques à deux instants sont deux messages');

select col_is_null('public', 'notifications', 'subject_card_id',
	'CRM-064 §13.5 — `subject_card_id` est NULLABLE : une notification de mention parle toujours '
	'd''une affaire, une notification future peut n''en désigner aucune, et le §16.1 traite ce cas '
	'explicitement plutôt que d''exiger une card fictive');

select col_is_null('public', 'notifications', 'read_at',
	'CRM-064 §15.1 — `read_at` est NULLABLE : nul tant que le message n''est pas lu');

select col_not_null('public', 'notifications', 'recipient_id',
	'CRM-064 §13.2 — un message s''adresse toujours à quelqu''un');

-- ---------------------------------------------------------------------------------------------
-- 7 à 8. Le `check` de `type`, FERMÉ — docs/SPEC-notifications.md §13.3
-- ---------------------------------------------------------------------------------------------
-- La colonne existe alors qu'elle n'a qu'une valeur, et c'est délibéré : elle est la GARDE qui
-- empêche d'écrire un type inventé. L'assertion 8 est celle qui compte — un `check` élargi « pour
-- plus tard » autoriserait des lignes que rien ne produit et qu'aucune preuve n'éprouve.

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.notifications'::regclass
	    and c.conname  = 'notifications_type_check'),
	$$CHECK ((type = ANY (ARRAY['mention'::text])))$$,
	'CRM-064 §13.3 — le `check` de `type` est FERMÉ sur la seule source que la tranche livre');

select throws_ok(
	format($$insert into public.notifications (workspace_id, recipient_id, type, subject_card_id)
	         values (%L, %L, 'echeance', %L)$$,
	       pg_temp.espace(), pg_temp.p_bizdev(), pg_temp.card_libre()),
	'23514',
	null,
	'CRM-064 §13.3 — un type INVENTÉ est refusé par la contrainte : sans elle, une tranche '
	'ultérieure écrirait ce qu''elle veut et deux lecteurs interpréteraient différemment la même '
	'ligne');

-- ---------------------------------------------------------------------------------------------
-- 9 à 12. Les trois clés étrangères, et celle qui N'EXISTE PAS — §13.6 et §14.4
-- ---------------------------------------------------------------------------------------------

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.notifications'::regclass
	    and c.conname  = 'notifications_recipient_id_fkey'),
	'FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE',
	'CRM-064 §13.6 — un message adressé à un compte qui n''existe pas est impossible');

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.notifications'::regclass
	    and c.conname  = 'notifications_workspace_id_fkey'),
	'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE',
	'CRM-064 §13.6 — un message hors de tout espace est impossible');

select is(
	(select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
	  where c.conrelid = 'public.notifications'::regclass
	    and c.conname  = 'notifications_subject_card_id_workspace_id_fkey'),
	'FOREIGN KEY (subject_card_id, workspace_id) REFERENCES cards(id, workspace_id) ON DELETE CASCADE',
	'CRM-064 §13.6 — clé COMPOSITE : une notification dont l''affaire vit dans un AUTRE espace '
	'qu''elle est impossible, même par la clé de service, qui contourne la RLS mais pas les '
	'contraintes');

-- L'ABSENCE est figée EN PLUS du comportement de l'assertion 27 : sans elle, un `ON DELETE
-- CASCADE` ajouté demain ne se verrait qu'au moment où quelqu'un retire une mention.
select is(
	(select count(*)::int from pg_catalog.pg_constraint c
	  where c.conrelid  = 'public.notifications'::regclass
	    and c.contype   = 'f'
	    and c.confrelid = 'public.card_comment_mentions'::regclass),
	0,
	'CRM-064 §14.4 — AUCUNE clé étrangère vers la mention, et c''est une DÉCISION : retirer une '
	'mention est « la correction d''une erreur de frappe » (§7.1), une notification est un message '
	'DÉJÀ DÉLIVRÉ. L''effacer réécrirait le passé du destinataire');

-- ---------------------------------------------------------------------------------------------
-- 13 à 14. Les deux index, dont le PARTIEL — docs/SPEC-notifications.md §13.7
-- ---------------------------------------------------------------------------------------------

select has_index('public', 'notifications', 'notifications_recipient_id_created_at_idx',
	'CRM-064 §13.7 — « mes notifications, les plus récentes d''abord », la liste de la tranche 3');

-- Le caractère PARTIEL est ce qui le rend petit ; un index total servirait la même question en
-- croissant indéfiniment. L'assertion porte donc sur la définition, non sur la seule présence.
select matches(
	(select pg_catalog.pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
	  where i.indrelid = 'public.notifications'::regclass
	    and i.indexrelid::regclass::text = 'notifications_recipient_id_non_lues_idx'),
	'WHERE \(read_at IS NULL\)',
	'CRM-064 §13.7 — l''index du compteur de non-lues est PARTIEL : il n''indexe que la fraction '
	'qui décroît avec l''usage, là où un index total croîtrait indéfiniment pour servir une '
	'question qui ne porte que sur la queue');

-- ---------------------------------------------------------------------------------------------
-- 15 à 17. Le trigger producteur, et sa forme — docs/SPEC-notifications.md §14.1 et §14.2
-- ---------------------------------------------------------------------------------------------

select has_trigger('public', 'card_comment_mentions', 'notifications_apres_mention',
	'CRM-064 §14 — la production est un trigger porté par la MENTION, non par le commentaire : '
	'c''est la mention qui désigne quelqu''un');

-- L'ASSERTION PORTE SUR LA DÉFINITION RENDUE, ET NON SUR UN BIT DE `tgtype`. Première écriture :
-- `tgtype & 1 = 0`, qui a rougi — le bit 0 de `tgtype` est `ROW`, le bit 1 est `BEFORE`. La preuve
-- était fausse, le produit ne l'était pas, et une assertion illisible est une assertion qu'on
-- corrige mal. Celle-ci dit ce qu'elle vérifie, et couvre les DEUX propriétés d'un coup.
select matches(
	(select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t
	  where t.tgrelid = 'public.card_comment_mentions'::regclass
	    and t.tgname  = 'notifications_apres_mention'),
	'AFTER INSERT ON public.card_comment_mentions FOR EACH ROW',
	'CRM-064 §14.2 — `AFTER`, jamais `BEFORE` : ce trigger ne modifie pas la mention, il en '
	'CONSÉQUENCE une autre ligne. En `BEFORE`, la notification naîtrait avant que les clés '
	'étrangères de la migration 0063 n''aient parlé');

-- MESURÉ (§12, M9 et M10) : en `SECURITY INVOKER`, l'insertion est refusée par 42501 sous
-- `authenticated`, qui n'a aucun privilège sur cette table — et la pose de la mention échouerait
-- AVEC elle, les deux étant dans la même transaction. Ce n'est donc pas un choix de style.
select is(
	(select p.prosecdef from pg_catalog.pg_proc p
	   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'notifications_apres_mention'),
	true,
	'CRM-064 §14.1 — `SECURITY DEFINER` par NÉCESSITÉ, et c''est MESURÉ : le trigger de la '
	'tranche 1 est `INVOKER` par discrétion, mais les deux ne font pas la même chose — l''un LIT '
	'POUR JUGER, l''autre ÉCRIT POUR LE COMPTE D''UN TIERS');

-- ---------------------------------------------------------------------------------------------
-- 18 à 23. LA PRODUCTION A LIEU, et elle écrit ce que le §14.5 annonce
-- ---------------------------------------------------------------------------------------------
-- La sonde vit dans la transaction ; l'assertion 41 relit le seed en l'excluant.

insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
values (pg_temp.c_libre(), pg_temp.p_bizdev(), pg_temp.espace());

create or replace function pg_temp.produite() returns public.notifications language sql stable as $$
	select n.* from public.notifications n
	 where n.payload->>'comment_id' = pg_temp.c_libre()::text
	   and n.recipient_id = pg_temp.p_bizdev()
$$;

select isnt((select (pg_temp.produite()).id), null,
	'CRM-064 §14 — poser une mention PRODUIT une notification. C''est l''objet de la tranche, et '
	'toutes les assertions de forme passeraient sans que ce soit vrai');

select is((select (pg_temp.produite()).recipient_id), pg_temp.p_bizdev(),
	'CRM-064 §14.5 — elle s''adresse au MENTIONNÉ, non à l''auteur');

select is((select (pg_temp.produite()).type), 'mention',
	'CRM-064 §14.5 — son type nomme la source qui l''a produite');

select is((select (pg_temp.produite()).subject_card_id), pg_temp.card_libre(),
	'CRM-064 §14.5 — elle désigne l''affaire du commentaire, et c''est la colonne sur laquelle la '
	'politique de LECTURE s''appuie (§13.5)');

-- LA CHARGE UTILE NE PORTE AUCUN CONTENU, et M7 le décide : une mention SURVIT à la pierre
-- tombale de son commentaire, dont le corps est réellement vidé. Un instantané du texte
-- survivrait donc à son effacement, et la suppression d'un commentaire cesserait d'en être une.
select is((select (pg_temp.produite()).payload),
	jsonb_build_object('comment_id', pg_temp.c_libre()::text, 'author_id', pg_temp.p_admin()::text),
	'CRM-064 §13.4 — la charge utile porte de quoi DÉSIGNER, jamais de quoi lire : ni le corps du '
	'commentaire, ni le titre de la card, ni le nom de l''auteur');

select is((select (pg_temp.produite()).read_at), null,
	'CRM-064 §15.1 — une notification naît NON LUE, et le compteur de la tranche 3 s''appuie '
	'dessus');

-- ---------------------------------------------------------------------------------------------
-- 24 à 26. L'AUTO-MENTION NE PRODUIT RIEN, MAIS RESTE POSÉE — §14.3
-- ---------------------------------------------------------------------------------------------
-- LE CAS EST RÉEL : M5 le mesure accepté par la tranche 1, `201`, avec le jeton réel de
-- l'administratrice sur son propre commentaire. Ce n'est pas un défaut — la règle d'éligibilité
-- demande que le destinataire puisse LIRE l'affaire, et l'auteur le peut toujours.
--
-- CETTE SUITE S'EXÉCUTE SOUS LE PROPRIÉTAIRE, OÙ `auth.uid()` EST NUL. C'est précisément ce qui
-- rend l'assertion 24 probante : un trigger qui comparerait à `auth.uid()` au lieu d'`author_id`
-- produirait ici une notification, alors que la vraie route n'en produit pas. L'API ne peut pas
-- écrire cette contre-épreuve — seul ce chemin le peut.

insert into public.card_comment_mentions (comment_id, profile_id, workspace_id)
values (pg_temp.c_libre(), pg_temp.p_admin(), pg_temp.espace());

select is(
	(select count(*)::int from public.notifications n
	  where n.payload->>'comment_id' = pg_temp.c_libre()::text
	    and n.recipient_id = pg_temp.p_admin()),
	0,
	'CRM-064 §14.3 — une AUTO-MENTION ne produit AUCUNE notification : se prévenir soi-même de ce '
	'qu''on vient d''écrire n''est pas une information, c''est du bruit dans la seule liste où le '
	'bruit se paie en confiance');

select is(
	(select count(*)::int from public.card_comment_mentions m
	  where m.comment_id = pg_temp.c_libre() and m.profile_id = pg_temp.p_admin()),
	1,
	'CRM-064 §14.3 — LA MENTION RESTE POSÉE : la tranche 1 n''est pas rejugée, le fait est '
	'enregistré, seul le message ne l''est pas. Sans cette assertion, un trigger qui refuserait '
	'l''auto-mention entière passerait la précédente');

select is(
	(select count(*)::int from public.notifications n
	  where n.payload->>'comment_id' = pg_temp.c_libre()::text),
	1,
	'CRM-064 §14.3 — deux mentions posées, UNE seule notification : la production discrimine, elle '
	'ne compte pas');

-- ---------------------------------------------------------------------------------------------
-- 27. RETIRER UNE MENTION N'EFFACE PAS SA NOTIFICATION — §14.4, le point ouvert n° 3 tranché
-- ---------------------------------------------------------------------------------------------

delete from public.card_comment_mentions
 where comment_id = pg_temp.c_libre() and profile_id = pg_temp.p_bizdev();

select is(
	(select count(*)::int from public.notifications n
	  where n.payload->>'comment_id' = pg_temp.c_libre()::text
	    and n.recipient_id = pg_temp.p_bizdev()),
	1,
	'CRM-064 §14.4 — la notification DEMEURE quand sa mention est retirée. Le prix est nommé : le '
	'destinataire trouvera une affaire où son nom n''apparaît plus. C''est honnête ; effacer '
	'rétroactivement un message déjà lu ne l''est pas');

-- ---------------------------------------------------------------------------------------------
-- 28 à 30. LA DATE DE LECTURE EST IMPOSÉE PAR LA BASE — §15.1
-- ---------------------------------------------------------------------------------------------
-- L'assertion envoie une date VIEILLE DE DIX ANS et exige qu'elle ne survive pas. C'est la leçon
-- que le harnais de la tranche 1 a apprise à sa suite pgTAP, qui n'envoyait aucune valeur et
-- qu'un simple `coalesce` aurait satisfaite.

update public.notifications set read_at = '2016-01-01 00:00:00+00'::timestamptz
 where payload->>'comment_id' = pg_temp.c_libre()::text
   and recipient_id = pg_temp.p_bizdev();

select ok(
	(select (pg_temp.produite()).read_at) > now() - interval '1 minute',
	'CRM-064 §15.1 — une date ANTIDATÉE de dix ans ne survit pas : la base pose celle du geste '
	'(mécanisme de la décision 95). Une date choisie par le client fausserait l''ordre de lecture '
	'et rendrait le compteur incohérent avec ce que l''écran affiche');

update public.notifications set read_at = null
 where payload->>'comment_id' = pg_temp.c_libre()::text
   and recipient_id = pg_temp.p_bizdev();

select is((select (pg_temp.produite()).read_at), null,
	'CRM-064 §15.1 — `null` RESTE `null` : marquer NON LU est ouvert. Un état à deux valeurs qu''on '
	'ne peut parcourir que dans un sens est un compteur, pas un état');

select has_trigger('public', 'notifications', 'notifications_avant_maj',
	'CRM-064 §15.1 — le trigger qui impose la date existe, et il est `BEFORE UPDATE`');

-- ---------------------------------------------------------------------------------------------
-- 31 à 34. Les deux politiques, et l'ABSENCE des deux autres — §16.1 et §16.2
-- ---------------------------------------------------------------------------------------------

select is(
	(select array_agg(p.policyname::text order by p.policyname::text)
	   from pg_policies p where p.schemaname = 'public' and p.tablename = 'notifications'),
	array['notifications_lecture', 'notifications_marquage'],
	'CRM-064 §16.2 — DEUX politiques, et deux seulement. Leur nombre est figé pour qu''une '
	'politique ajoutée par mégarde — une insertion « pratique », une suppression « évidente » — se '
	'voie ici d''abord');

select is(
	(select p.roles::text[] from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'notifications'
	    and p.policyname = 'notifications_lecture'),
	array['anon', 'authenticated'],
	'CRM-064 §16.1 — la lecture est accordée à `anon` pour que le refus soit ZÉRO LIGNE et non une '
	'erreur de privilège (docs/SPEC-permissions-rls.md §3.2) : `auth.uid()` étant nul, le prédicat '
	'est faux');

-- LA SECONDE CONDITION EST CELLE QUI TRANCHE LE POINT OUVERT N° 3. Elle DÉLÈGUE à
-- `app.can_read_card`, que la tranche 1 vient de généraliser : la règle d'accès n'a TOUJOURS
-- QU'UNE SEULE ÉCRITURE. Un prédicat qui relirait `channel_members` ici serait la seconde
-- écriture que le §5.3 a refusée — et cette assertion est ce qui l'empêche.
select matches(
	(select p.qual from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'notifications'
	    and p.policyname = 'notifications_lecture'),
	'can_read_card',
	'CRM-064 §16.1 — la lecture DÉLÈGUE à `app.can_read_card` : une perte d''accès masque la '
	'notification sans détruire aucune ligne (§14.4), et la règle d''accès n''est pas réécrite');

select matches(
	(select p.with_check from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'notifications'
	    and p.policyname = 'notifications_marquage'),
	'recipient_id',
	'CRM-064 §16.1 — le marquage porte un `WITH CHECK` autant qu''un `USING` : le privilège de '
	'colonne rend déjà `recipient_id` immuable, et ceci est la SECONDE barrière contre une sortie '
	'de périmètre');

-- ---------------------------------------------------------------------------------------------
-- 35 à 39. Privilèges — REFUS DOUBLE à l'insertion et à la suppression — §15.2 à §15.4
-- ---------------------------------------------------------------------------------------------
-- Les quatre moitiés sont figées SÉPARÉMENT (les assertions 31, 35, 36) : sans cela, on ne
-- saurait pas lequel des deux refuse, et la dégradation du harnais ne pourrait pas éprouver la
-- seconde barrière en relâchant la première.

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'notifications'
	    and grantee in ('anon', 'authenticated') and privilege_type = 'INSERT'),
	0,
	'CRM-064 §15.3 — AUCUN privilège `INSERT` : une notification se PRODUIT, elle ne se demande '
	'pas. Sans ce refus, un client s''écrirait des messages — ou, bien pire, en écrirait à '
	'quelqu''un d''autre');

select is(
	(select count(*)::int from information_schema.role_table_grants
	  where table_schema = 'public' and table_name = 'notifications'
	    and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE'),
	0,
	'CRM-064 §15.4 — AUCUN privilège `DELETE`. Ce n''est pas une omission mais le périmètre : '
	'vider une liste est une décision de RÉTENTION qu''aucune mesure ne donne (point ouvert n° 1)');

-- `grant update (read_at)` SEUL fige toutes les autres colonnes, et M11 le mesure : un `PATCH` sur
-- une colonne non accordée rend 403 / 42501 — un refus de PRIVILÈGE, pas un silence.
select is(
	(select array_agg(g.column_name::text order by g.column_name::text)
	   from information_schema.column_privileges g
	  where g.table_schema = 'public' and g.table_name = 'notifications'
	    and g.grantee = 'authenticated' and g.privilege_type = 'UPDATE'),
	array['read_at'],
	'CRM-064 §15.2 — la mise à jour est bornée à la SEULE colonne `read_at` par un privilège de '
	'COLONNE : `type`, `payload`, `recipient_id`, `subject_card_id`, `workspace_id` et '
	'`created_at` sont fermés sans qu''aucune politique n''ait à s''en occuper');

select is(
	(select array_agg(distinct g.privilege_type::text order by g.privilege_type::text)
	   from information_schema.role_table_grants g
	  where g.table_schema = 'public' and g.table_name = 'notifications' and g.grantee = 'anon'),
	array['SELECT'],
	'CRM-064 §15.2 — `anon` ne reçoit QUE `SELECT`, et il le reçoit pour que le refus soit zéro '
	'ligne. Le `revoke all` écrit AVANT les `grant` est ce qui l''assure : l''image Supabase '
	'accorde tout par défaut sur toute table nouvelle (décision 134)');

select ok(
	(select c.relrowsecurity from pg_catalog.pg_class c
	   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
	  where n.nspname = 'public' and c.relname = 'notifications'),
	'CRM-064 §16 — la RLS est activée DANS la migration qui crée la table : même le temps d''une '
	'instruction, elle ne doit pas être ouverte à quiconque détient la clé anonyme');

-- ---------------------------------------------------------------------------------------------
-- 40. LA TABLE EST PUBLIÉE AU TEMPS RÉEL — §25.1 (assertion RÉVISÉE, jamais retirée)
-- ---------------------------------------------------------------------------------------------
-- Elle exigeait `0` jusqu'au 2026-08-26, et elle avait raison de le faire : rien ne s'y abonnait,
-- et publier une table que personne n'écoute revient à poser une surface d'autorisation sans
-- preuve. La condition qu'elle écrivait elle-même est remplie — la migration `0065` publie la
-- table, et la cloche de la sous-tranche 3a l'écoute —, donc elle mesure désormais le NOUVEL état.
-- Elle n'est pas devenue décorative pour autant : une publication retirée par mégarde ferait
-- cesser toute délivrance en temps réel sans qu'aucun écran ne le dise, et c'est ici que cela se
-- verrait d'abord.

select is(
	(select count(*)::int from pg_publication_tables
	  where pubname = 'supabase_realtime' and schemaname = 'public'
	    and tablename = 'notifications'),
	1,
	'CRM-064 §25.1 — la table EST publiée, dans le même changement que l''écran qui l''écoute. Le '
	'temps réel évalue la politique `SELECT` de chaque abonné : c''est une surface d''autorisation, '
	'et les lignes u, v et w du §27 l''exercent comme telle');

-- ---------------------------------------------------------------------------------------------
-- 41 à 42. Ce que le seed livre — docs/SPEC-notifications.md §19
-- ---------------------------------------------------------------------------------------------
-- Les sondes des assertions 18 à 30 vivent dans la transaction ; le compte les EXCLUT pour porter
-- sur le seul seed.

select is(
	(select array_agg(p.full_name::text order by p.full_name::text)
	   from public.notifications n
	   join public.profiles p on p.id = n.recipient_id
	  where n.payload->>'comment_id' <> pg_temp.c_libre()::text),
	array['Camille Aubert', 'Driss Lemoine'],
	'CRM-064 §19 — le seed livre DEUX notifications, PRODUITES par ses deux mentions et non '
	'posées, et la LECTRICE n''en porte aucune : aucune mention ne la désigne, la règle '
	'd''éligibilité de la tranche 1 la refusant sur `grands-comptes`');

select is(
	(select count(*)::int from public.notifications n
	  where n.payload->>'comment_id' <> pg_temp.c_libre()::text and n.read_at is null),
	2,
	'CRM-064 §19 — les deux notifications du seed sont NON LUES : une notification naît non lue, '
	'et le compteur de la tranche 3 s''appuie dessus');

select * from finish();

rollback;

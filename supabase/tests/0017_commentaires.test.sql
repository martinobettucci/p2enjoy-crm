-- @verifies CRM-043 (docs/BACKLOG.md) — commentaires d'une card
-- @verifies docs/SPEC-cards.md §13.2 (modèle), §13.3 (unicité et clé composite), §13.4 (la
--           pierre tombale), §13.5 (`edited_at` par trigger), §13.6 (autorisations), §13.7
--           (colonnes protégées), §13.9 (temps réel), §13.11 (seed), §13.14 (preuves attendues)
-- @verifies docs/SCHEMA.md §5 (`card_comments`), §10 (index), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §3.7 (`app.can_write_card`),
--           §4 (politiques), §4.3 (colonnes protégées), §7 (refus n° 4)
-- @verifies docs/SPEC-seed.md §2.14 (commentaires du seed)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-071 (qui peut commenter), INC-072 (la modération),
--           INC-025 (colonnes communes), INC-033 (aucune intégrité sur un `uuid[]`),
--           INC-048 (le commentaire de `move_card`, toujours perdu)
--
-- Suite pgTAP de l'unité `CRM-043`. Elle prouve neuf choses :
--
--   1. la **forme** de la table : colonnes, nullabilité, défauts, clé primaire, index ;
--   2. l'**unicité ajoutée à `cards`**, condition de la clé composite ;
--   3. ce que la **clé composite** garantit, et ce que le **trigger d'insertion** dérive ;
--   4. la **pierre tombale** : le corps réellement vidé, la date imposée, l'irréversibilité ;
--   5. `edited_at` : posé si et seulement si le corps change, et **fermé au client** ;
--   6. les **colonnes gelées**, y compris pour un rôle qui contourne la RLS ;
--   7. les **trois politiques**, l'absence de tout `DELETE`, et le refus opposé au `viewer` ;
--   8. l'appartenance à la **publication de temps réel** ;
--   9. la **conformité du seed**, et ce qui reste dû, figé par des assertions.
--
-- Exécution : `npm run test:sql`, `scripts/verify-commentaires.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0017_commentaires.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier. Comme les suites précédentes, aucun
-- bloc n'emploie `rollback to savepoint` : une assertion prise dans un savepoint annulé est
-- **numérotée mais non comptée** par pgTAP, et le plan ne serait jamais tenu (décision 79).

begin;

create extension if not exists pgtap with schema extensions;

select plan(84);

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

-- Identités et objets du seed, écrits une fois pour que les assertions se lisent.
--   …011 Camille Aubert, admin        …0c1 Refonte du site vitrine, channel `grands-comptes`
--   …012 Driss Lemoine, bizdev        …0c4 Refonte intranet, channel `refonte`
--   …013 Farida Nowak, viewer         …0c5 Support niveau 2, channel `maintenance`
--
-- MESURÉ : le `viewer` LIT `…0c4`, `…0c5`, `…0c6` et `…0c7`, et n'ÉCRIT sur AUCUNE. Il ne lit pas
-- `…0c1`, dont le track lui est fermé par `track_members.access = 'none'`.

-- =============================================================================================
-- 1. Forme de la table — docs/SPEC-cards.md §13.2
-- =============================================================================================

select has_table('public', 'card_comments',
	'`public.card_comments` est livrée : le produit sait enfin parler de ses affaires');

select has_column('public', 'card_comments', 'card_id', '`card_id` existe');
select has_column('public', 'card_comments', 'workspace_id',
	'`workspace_id` existe — dénormalisé pour la RLS, sa véracité tenue par le trigger ET par la '
	'clé composite');
select has_column('public', 'card_comments', 'author_id', '`author_id` existe');
select has_column('public', 'card_comments', 'body', '`body` existe');
select has_column('public', 'card_comments', 'mentions',
	'`mentions` existe — livrée par docs/SCHEMA.md §5, ALIMENTÉE PAR RIEN (INC-033)');
select has_column('public', 'card_comments', 'created_at', '`created_at` existe');
select has_column('public', 'card_comments', 'edited_at', '`edited_at` existe');
select has_column('public', 'card_comments', 'deleted_at', '`deleted_at` existe');

-- INC-025, cinquième occurrence, ET LA PREMIÈRE OÙ LE TABLEAU DE `SCHEMA` EST SUIVI À LA LETTRE :
-- `updated_at` est délibérément absente, `edited_at` et `deleted_at` nommant les deux seules
-- évolutions possibles d'un commentaire (docs/SPEC-cards.md §13.2).
select hasnt_column('public', 'card_comments', 'updated_at',
	'INC-025, cinquième occurrence : `updated_at` est ABSENTE, et c''est un écart assumé — '
	'`edited_at` et `deleted_at` disent mieux ce qu''elle dirait confusément');

select col_is_pk('public', 'card_comments', 'id', 'la clé primaire est `id`');
select col_not_null('public', 'card_comments', 'card_id', '`card_id` est non nul');
select col_not_null('public', 'card_comments', 'workspace_id', '`workspace_id` est non nul');
select col_not_null('public', 'card_comments', 'author_id', '`author_id` est non nul');
select col_not_null('public', 'card_comments', 'body', '`body` est non nul');
select col_not_null('public', 'card_comments', 'mentions', '`mentions` est non nul');
select col_is_null('public', 'card_comments', 'edited_at',
	'`edited_at` est nullable : un commentaire non modifié n''a pas de date de modification');
select col_is_null('public', 'card_comments', 'deleted_at', '`deleted_at` est nullable');

select ok(
	(select pg_get_expr(d.adbin, d.adrelid) = '''{}''::uuid[]'
	   from pg_attrdef d
	   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
	  where d.adrelid = 'public.card_comments'::regclass and a.attname = 'mentions'),
	'`mentions` vaut le tableau vide par défaut : aucun client n''a à l''envoyer');

-- Décision 196 : le défaut est un CONFORT, la politique est la RÈGLE. Les deux existent.
select ok(
	(select pg_get_expr(d.adbin, d.adrelid) = 'auth.uid()'
	   from pg_attrdef d
	   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
	  where d.adrelid = 'public.card_comments'::regclass and a.attname = 'author_id'),
	'`author_id` vaut `auth.uid()` par défaut — MESURÉ acceptable comme défaut de colonne '
	'(décision 196) : l''interface n''a pas à connaître son propre identifiant');

select has_index('public', 'card_comments', 'card_comments_card_id_created_at_idx',
	'index `(card_id, created_at, id)` — la seule lecture du produit, terminée par la clé primaire '
	'pour que le fil puisse être paginé sans changer d''ordre (leçon de `CRM-042`)');

-- =============================================================================================
-- 2. L'unicité que `cards` devait offrir — docs/SPEC-cards.md §13.3
-- =============================================================================================
-- Elle ne peut refuser aucune ligne : `id` est déjà clé primaire. Elle est la CONDITION de la clé
-- composite. MESURÉ sans elle : « there is no unique constraint matching given keys for
-- referenced table "cards" ».

select col_is_unique('public', 'cards', array['id', 'workspace_id'],
	'`cards (id, workspace_id)` est unique — ajoutée par `CRM-043`, condition de la clé étrangère '
	'composite des commentaires. Ne change AUCUN comportement de `cards`');

select col_is_unique('public', 'cards', array['id', 'workflow_id'],
	'`cards (id, workflow_id)` est toujours là — celle de `CRM-036` : cette unité n''a pas défait '
	'ce que l''autre avait posé');

select has_fk('public', 'card_comments', '`card_comments` porte une clé étrangère');

-- =============================================================================================
-- 3. Le trigger d'insertion dérive, et n'invente rien — §13.3
-- =============================================================================================

select pg_temp.postgres();

-- La valeur envoyée est IGNORÉE au profit de celle de la card. C'est une dérivation, pas une
-- question posée au client.
insert into public.card_comments (id, card_id, workspace_id, author_id, body)
values ('5eed0000-0000-4000-8000-0000000000e1',
        '5eed0000-0000-4000-8000-0000000000c1',
        '00000000-0000-4000-8000-000000000999',
        '5eed0000-0000-4000-8000-000000000011',
        'Sonde de dérivation.');

select is(
	(select workspace_id from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	'5eed0000-0000-4000-8000-000000000001'::uuid,
	'`workspace_id` est DÉRIVÉ de la card, quelle que soit la valeur envoyée — un workspace '
	'inventé n''atteint pas la ligne');

select is(
	(select edited_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	null,
	'un commentaire ne naît pas modifié');
select is(
	(select deleted_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	null,
	'un commentaire ne naît pas supprimé');
select is(
	(select mentions from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	'{}'::uuid[],
	'`mentions` naît vide : rien ne l''alimente (INC-033)');

-- Un commentaire né supprimé est refusé : le trigger remet `deleted_at` à nul, et le `CHECK`
-- exige alors un corps non vide.
select throws_ok($$
	insert into public.card_comments (card_id, author_id, body, deleted_at)
	values ('5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', '', now())
$$, '23514', null,
	'un commentaire NÉ SUPPRIMÉ est refusé : le trigger annule `deleted_at`, et le `CHECK` réclame '
	'alors un corps');

select throws_ok($$
	insert into public.card_comments (card_id, author_id, body)
	values ('00000000-0000-4000-8000-000000000404',
	        '5eed0000-0000-4000-8000-000000000011', 'Sur une card inexistante.')
$$, 'P0001', 'card_not_found',
	'une card inexistante rend `card_not_found` — et une card fermée rendra le MÊME refus, le '
	'trigger étant `SECURITY INVOKER` par discrétion');

-- =============================================================================================
-- 4. Le `CHECK` du corps — §13.4
-- =============================================================================================

select throws_ok($$
	insert into public.card_comments (card_id, author_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', '   ')
$$, '23514', null,
	'un corps fait de blancs est refusé : `btrim` est ce qui distingue un message d''un espace');

select throws_ok($$
	insert into public.card_comments (card_id, author_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', repeat('x', 10001))
$$, '23514', null,
	'10 001 caractères sont refusés : un commentaire est un message, pas un document, et la borne '
	'appartient à la base — seul endroit que tous les chemins d''écriture traversent');

select lives_ok($$
	insert into public.card_comments (id, card_id, author_id, body)
	values ('5eed0000-0000-4000-8000-0000000000e2',
	        '5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', repeat('x', 10000))
$$, '10 000 caractères passent : la borne est bien à 10 000, non à 9 999');

-- =============================================================================================
-- 5. `edited_at` : posé si et seulement si le corps change — §13.5
-- =============================================================================================

update public.card_comments set body = 'Sonde de dérivation, corrigée.'
 where id = '5eed0000-0000-4000-8000-0000000000e1';

select isnt(
	(select edited_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	null,
	'`edited_at` est posé par le trigger dès que le corps change : corriger et le dire sont le '
	'même geste');

-- Une écriture qui ne change pas le corps ne marque rien — ce que fait tout client renvoyant la
-- ligne entière.
update public.card_comments set edited_at = null, body = 'Sonde de dérivation, corrigée.'
 where id = '5eed0000-0000-4000-8000-0000000000e1';

select isnt(
	(select edited_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	null,
	'`edited_at` N''EST PAS EFFAÇABLE par le client : le trigger restaure la valeur précédente '
	'quand le corps ne change pas');

-- =============================================================================================
-- 6. Les colonnes gelées, MÊME pour un rôle qui contourne la RLS — §13.7
-- =============================================================================================
-- Le privilège de colonne ferme ces colonnes à `authenticated`. Ce bloc prouve la SECONDE
-- barrière, celle qui vaut pour tout le monde — le seed compris.

select throws_ok($$
	update public.card_comments set author_id = '5eed0000-0000-4000-8000-000000000012'
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_immutable_column',
	'`author_id` est GELÉ même pour `postgres` : une ligne ne peut pas être recyclée pour faire '
	'dire à quelqu''un ce qu''il n''a pas écrit');

select throws_ok($$
	update public.card_comments set card_id = '5eed0000-0000-4000-8000-0000000000c4'
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_immutable_column',
	'`card_id` est gelé : un commentaire ne change pas d''affaire');

select throws_ok($$
	update public.card_comments set created_at = now() - interval '1 year'
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_immutable_column',
	'`created_at` est gelé : la chronologie d''un fil n''est pas réécrivable');

select throws_ok($$
	update public.card_comments set workspace_id = '00000000-0000-4000-8000-000000000999'
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_immutable_column',
	'`workspace_id` est gelé : la dénormalisation ne se corrige pas à la main');

-- =============================================================================================
-- 7. La pierre tombale — §13.4, décision 193
-- =============================================================================================

update public.card_comments set deleted_at = timestamptz '2001-01-01 00:00:00Z'
 where id = '5eed0000-0000-4000-8000-0000000000e1';

select is(
	(select body from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	'',
	'LE CORPS EST RÉELLEMENT VIDÉ : ce n''est pas un contenu masqué par l''interface, c''est un '
	'contenu détruit — propriété de la base, opposable à tous les chemins d''écriture');

select ok(
	(select deleted_at > timestamptz '2020-01-01 00:00:00Z'
	   from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000e1'),
	'la date de suppression est celle du GESTE, non celle que l''appelant a envoyée : `2001` est '
	'ignorée au profit de `now()`');

select ok(
	(select count(*) = 1 from public.card_comments
	  where id = '5eed0000-0000-4000-8000-0000000000e1'),
	'LA LIGNE SURVIT, et c''est ce qui fait que la suppression se PROPAGE au temps réel — lequel '
	'n''émet que ce que l''abonné peut lire (décision 193)');

select throws_ok($$
	update public.card_comments set body = 'Je reviens sur ce que j''ai dit.'
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_deleted',
	'une pierre tombale est DÉFINITIVE : aucune écriture ultérieure');

select throws_ok($$
	update public.card_comments set deleted_at = null
	 where id = '5eed0000-0000-4000-8000-0000000000e1'
$$, 'P0001', 'comment_deleted',
	'aucune RÉSURRECTION : `deleted_at` ne redevient jamais nul');

-- =============================================================================================
-- 8. Les politiques — §13.6
-- =============================================================================================

select is(
	(select relrowsecurity from pg_class where oid = 'public.card_comments'::regclass),
	true,
	'RLS est activée sur `card_comments` dès la migration qui la crée : la table n''est jamais '
	'ouverte, fût-ce le temps d''une instruction, à quiconque détient la clé anonyme');

select policies_are('public', 'card_comments',
	array['card_comments_lecture', 'card_comments_insertion', 'card_comments_maj'],
	'TROIS politiques, et trois seulement : aucune `for delete` — supprimer, c''est poser '
	'`deleted_at` (§13.4)');

-- --- 8.1 Le refus opposé au `viewer`, EXIGÉ NOMMÉMENT PAR LA DEFINITION OF DONE ----------------
-- INC-071, décision 192 : commenter est un droit d'ÉCRITURE. `docs/SCHEMA.md` §5 disait le
-- contraire, et cette assertion est ce qui rend la contradiction opposable.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok($$
	insert into public.card_comments (card_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c5', 'Un viewer qui commente.')
$$, '42501', null,
	'INC-071 : le `viewer` NE COMMENTE PAS une card qu''il VOIT pourtant. C''est la preuve que la '
	'Definition of Done exige nommément, et elle est incompatible avec « tout membre pouvant lire '
	'la card peut commenter »');

select ok(
	(select count(*) = 1 from public.card_comments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c5'),
	'…et il LIT ce commentaire : lire n''est pas écrire. Le témoin du seed rend cette assertion '
	'probante — sans lui, elle serait vraie sur une table vide (décision 50)');

select ok(
	(select count(*) = 0 from public.card_comments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c1'),
	'le `viewer` ne voit AUCUN commentaire de `…0c1`, dont le track lui est fermé : les droits '
	'fins traversent `app.can_read_card` — preuve n° 4, reconduite sur une table fille');

-- --- 8.2 L'auteur, et lui seul — INC-072 ------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

-- Driss (business_developer) ÉCRIT sur `grands-comptes` : ce n'est donc pas le droit de channel
-- qui le refuse ci-dessous, mais bien la clause d'auteur.
select ok(app.can_write_card('5eed0000-0000-4000-8000-0000000000c1'),
	'Driss Lemoine PEUT écrire sur la card `…0c1` — sans quoi l''assertion suivante ne prouverait '
	'pas ce qu''elle prétend');

update public.card_comments set body = 'Réécrit par quelqu''un d''autre.'
 where id = '5eed0000-0000-4000-8000-0000000000d1';

select is(
	(select body from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d1'),
	'La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq.',
	'un TIERS qui a pourtant le droit d''écrire ne modifie PAS le commentaire d''un autre : le '
	'`USING` filtre, aucune erreur n''est levée, et LA LIGNE EST INTACTE (INC-072)');

select lives_ok($$
	insert into public.card_comments (card_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c1', 'Driss commente sa propre affaire.')
$$, 'Driss écrit son PROPRE commentaire : la politique d''insertion n''est pas un refus général');

select throws_ok($$
	insert into public.card_comments (card_id, author_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', 'Signé du nom d''une autre.')
$$, '42501', null,
	'décision 196 : `author_id = auth.uid()` REFUSE la signature d''autrui — ce que le seul défaut '
	'de colonne ne ferait pas, un défaut ne s''appliquant qu''à une colonne omise');

-- --- 8.3 L'auteur modifie et supprime le sien -------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

update public.card_comments set body = 'La DSI a confirmé : trois gabarits.'
 where id = '5eed0000-0000-4000-8000-0000000000d1';

select is(
	(select body from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d1'),
	'La DSI a confirmé : trois gabarits.',
	'l''AUTEUR modifie le sien');

select isnt(
	(select edited_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d1'),
	null,
	'…et la modification est MARQUÉE, sans que le client ait pu écrire `edited_at` lui-même');

-- --- 8.4 L'anonyme ----------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select ok((select count(*) > 0 from public.card_comments),
	'la table est NON VIDE pour l''administratrice — sans ce constat, l''assertion suivante serait '
	'verte que la RLS refuse ou qu''elle autorise tout (décision 50)');

select pg_temp.anonyme();

select ok((select count(*) = 0 from public.card_comments),
	'l''anonyme ne voit AUCUN commentaire : le refus est ZÉRO LIGNE, non une erreur de privilège '
	'(docs/SPEC-permissions-rls.md §3.2)');

select throws_ok($$
	insert into public.card_comments (card_id, author_id, body)
	values ('5eed0000-0000-4000-8000-0000000000c1',
	        '5eed0000-0000-4000-8000-000000000011', 'Écrit sans jeton.')
$$, '42501', null,
	'l''anonyme n''écrit rien : aucun privilège `INSERT` ne lui est accordé');

-- =============================================================================================
-- 9. Privilèges et colonnes protégées — §13.7
-- =============================================================================================

select pg_temp.postgres();

select ok(not has_table_privilege('authenticated', 'public.card_comments', 'DELETE'),
	'`authenticated` n''a AUCUN privilège `DELETE` : c''est la première des deux barrières, la '
	'seconde étant l''absence de politique (§13.4)');
select ok(not has_table_privilege('anon', 'public.card_comments', 'DELETE'),
	'`anon` non plus');
select ok(not has_table_privilege('anon', 'public.card_comments', 'INSERT'),
	'`anon` n''a pas `INSERT` : la lecture seule est un privilège, pas seulement une politique');
select ok(has_table_privilege('authenticated', 'public.card_comments', 'INSERT'),
	'`authenticated` a `INSERT` — de TABLE, comme pour `cards` (décision 140)');
select ok(has_table_privilege('anon', 'public.card_comments', 'SELECT'),
	'`anon` a `SELECT` : sans lui, le refus serait une erreur de privilège là où il doit être zéro '
	'ligne');

select ok(has_column_privilege('authenticated', 'public.card_comments', 'body', 'UPDATE'),
	'`body` est ouvert en mise à jour : l''auteur peut corriger');
select ok(has_column_privilege('authenticated', 'public.card_comments', 'deleted_at', 'UPDATE'),
	'`deleted_at` est ouvert : sans lui, le geste « supprimer » n''existerait pas');

-- Décision 197 : `edited_at` est FERMÉE et pourtant écrite par le trigger. Les deux assertions
-- ci-dessus et ci-dessous sont ce qui rend cette affirmation vérifiable.
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'edited_at', 'UPDATE'),
	'décision 197 : `edited_at` est FERMÉE au client, et pourtant tenue à jour par le trigger — le '
	'privilège de colonne juge la cible du client, pas les affectations d''un trigger');
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'author_id', 'UPDATE'),
	'`author_id` est fermé');
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'card_id', 'UPDATE'),
	'`card_id` est fermé');
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'workspace_id', 'UPDATE'),
	'`workspace_id` est fermé');
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'created_at', 'UPDATE'),
	'`created_at` est fermé');
select ok(not has_column_privilege('authenticated', 'public.card_comments', 'mentions', 'UPDATE'),
	'`mentions` est fermée : rien ne l''alimente, et l''ouvrir donnerait un champ libre sans usage');

-- =============================================================================================
-- 10. Le temps réel — §13.9, décision 195
-- =============================================================================================

select ok(
	(select count(*) = 1 from pg_publication_tables
	  where pubname = 'supabase_realtime' and schemaname = 'public'
	    and tablename = 'card_comments'),
	'`card_comments` est publiée sur `supabase_realtime` — PREMIÈRE table du produit à l''être, le '
	'§4 de docs/DAT.md l''annonçant depuis le socle documentaire sans que rien fût branché');

select is(
	(select relreplident from pg_class where oid = 'public.card_comments'::regclass),
	'd'::"char",
	'`REPLICA IDENTITY` reste par DÉFAUT — la clé primaire suffit, aucune suppression physique '
	'n''étant exposée et une pierre tombale étant un `UPDATE` dont la ligne d''arrivée est lisible');

-- =============================================================================================
-- 11. Conformité du seed — docs/SPEC-seed.md §2.14
-- =============================================================================================
-- Les lignes sondes créées plus haut portent le préfixe `…0000e`, et sont exclues des comptes.

select is(
	(select count(*) from public.card_comments where id::text like '5eed%d_'),
	5::bigint,
	'le seed pose CINQ commentaires — docs/SPEC-seed.md §2.14');

select is(
	(select count(distinct card_id) from public.card_comments where id::text like '5eed%d_'),
	3::bigint,
	'…sur TROIS cards : un fil isolé ne démontrerait pas un fil');

select is(
	(select count(distinct author_id) from public.card_comments where id::text like '5eed%d_'),
	3::bigint,
	'…par les TROIS comptes, dont le `viewer` — témoin de la preuve de lecture');

-- Nommément `…d3`, et non « un seul du lot » : la section 8.3 a modifié `…d1` DANS CETTE
-- TRANSACTION pour prouver que l'auteur le peut, et un compte global mesurerait ce test lui-même
-- plutôt que le seed.
select isnt(
	(select edited_at from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d3'),
	null,
	'le commentaire `…d3` du seed est MODIFIÉ : l''état est démontré par une donnée, non seulement '
	'décrit. La marque a été posée par le trigger, le seed ayant réellement changé le corps');

select is(
	(select count(*) from public.card_comments
	  where id::text like '5eed%d_' and deleted_at is not null),
	1::bigint,
	'un commentaire du seed est SUPPRIMÉ');

select is(
	(select body from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d4'),
	'',
	'…et son corps est VIDE : le seed ne fabrique pas la pierre tombale, il demande la suppression '
	'et le produit la réalise (`CLAUDE.md` §8)');

select is(
	(select author_id from public.card_comments where id = '5eed0000-0000-4000-8000-0000000000d5'),
	'5eed0000-0000-4000-8000-000000000013'::uuid,
	'le commentaire de `…0c5` porte pour auteur le `viewer` : posé par la clé de service, il est la '
	'SEULE ligne du seed que son auteur ne pourrait pas écrire lui-même, et le seed le dit');

-- =============================================================================================
-- 12. Ce qui reste dû, figé par des assertions — mécanisme de la décision 51
-- =============================================================================================
-- Chacune devient ROUGE le jour où la table naît, obligeant l'unité concernée à revenir ici.

-- RÉVISÉE À `CRM-044`, NON RETIRÉE. La table est née, et le constat qu'elle portait reste vrai
-- pour une autre raison : un commentaire n'écrit toujours aucun événement, parce que le fil est
-- unifié À LA LECTURE (décision 209). Dupliquer produirait deux représentations d'un même fait,
-- dont l'une — immuable — survivrait à la pierre tombale de l'autre.
select is(
	(select count(*)::int from pg_trigger
	  where tgrelid = 'public.card_comments'::regclass and not tgisinternal
	    and tgname like 'card_events%'),
	0, '`card_comments` ne porte AUCUN trigger de timeline : un commentaire n''écrit pas '
	   'd''événement, le fil est unifié à la LECTURE (`CRM-044`, décision 209)');

select is(to_regclass('public.notifications')::text, null,
	'`notifications` n''existe pas : `mentions` n''a aucun destinataire à servir. `CRM-063`');

select is(to_regclass('public.card_activities')::text, null,
	'`card_activities` n''existe pas : le §5 de docs/SCHEMA.md la décrit, aucune unité du chunk 3 '
	'ne la porte');

-- INC-048 : la cause bloquante est LEVÉE — `card_comments` existe — et le commentaire de
-- `move_card` reste pourtant perdu. `move_card` est un livrable de `CRM-034` ; le reprendre ici
-- toucherait ses gardes sans les rejouer sous son unité (`CLAUDE.md` §13). L'arbitrage est dû.
select ok(
	(select prosrc not like '%card_comments%' from pg_proc
	  where oid = 'public.move_card(uuid, uuid, text)'::regprocedure),
	'INC-048 : `move_card` n''écrit TOUJOURS PAS le commentaire qu''elle exige — la cause '
	'bloquante est pourtant levée par cette migration. Elle appartient à `CRM-034`, et '
	'l''arbitrage devient exigible plutôt que théorique');

select * from finish();
rollback;

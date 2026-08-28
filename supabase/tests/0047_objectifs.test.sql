-- @verifies CRM-082 (docs/BACKLOG.md) — objectifs : modèle, RLS et API
-- @verifies docs/SPEC-goals.md §1 (aucun calcul), §2.1 à §2.4 (objets et contraintes),
--           §4.1 (lecture, et le bloc invisible), §4.2 (écriture, et le lien qui engage)
-- @verifies docs/SCHEMA.md §9 bis.1 à §9 bis.3 (colonnes), §9 bis.7 (politiques)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.5 (récursion)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME des trois tables et l'activation de la RLS. Une table livrée sans RLS serait
--    ouverte à tout porteur de jeton, et le reste de la suite mesurerait des refus imaginaires.
--
-- 2. LES QUATRE GARDES QUE LA DoD NOMME, chacune contre son succès correspondant : une assertion
--    qui ne prouverait que le refus serait verte sur une contrainte qui refuse tout.
--      * le lien inter-tableaux est refusé — c'est la raison d'être de `goal_links.board_id` ;
--      * `fill_percent` hors bornes est refusé, ET les deux bornes exactes sont acceptées ;
--      * la boucle d'un bloc sur lui-même est refusée ;
--      * LE CYCLE EST ACCEPTÉ — « A nourrit B, B nourrit A » est une intention légitime, et une
--        implémentation zélée qui refuserait les cycles passerait toutes les autres assertions.
--
-- 3. La FORME des quatre fonctions d'appui — `security definer`, `search_path` vidé, propriétaire
--    — et leurs privilèges. C'est la condition de la décision 27 : une fonction `invoker` lue par
--    la politique de `goal_links` relancerait la politique de `goal_blocks` à chaque ligne.
--
-- 4. LES SIX RÈGLES DE POLITIQUE, jouées avec les TROIS PROFILS RÉELS du seed, et fondées sur des
--    mesures relevées sur la pile plutôt que supposées :
--      * Camille (admin) lit et écrit les HUIT channels ;
--      * Driss (business_developer) lit les huit mais **n'écrit pas « Maintenance »** ;
--      * Farida (viewer) **ne lit ni « Grands comptes » ni « Appels d'offres »** — six sur huit.
--    Ces trois écarts ne sont pas décoratifs : chacun porte une assertion qu'aucun autre profil
--    ne pourrait produire.
--
-- 5. LE BLOC INVISIBLE, sur le cas qui le motive : le même tableau, lu par deux personnes, ne rend
--    pas le même nombre de blocs. Et sa flèche, elle, reste lisible — l'écran la rendra « vers le
--    vide » (§5.4) plutôt que de faire disparaître le dessin.
--
-- 6. L'ASYMÉTRIE DU `using` ET DU `with check` de la mise à jour d'un bloc, qui est la règle du
--    §4.2 et non un oubli : Driss ne peut PAS poser un lien vers « Maintenance », qu'il lit sans
--    l'écrire, mais il PEUT retirer ce lien — « on peut toujours défaire ce qui gêne ».
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

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
	perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire — donc hors RLS. Les identifiants sont STABLES pour que les
-- messages d'assertion restent lisibles d'une exécution à l'autre.
-- ---------------------------------------------------------------------------------------------
-- LE NOM DU TABLEAU D'ESSAI NE DOIT PAS ÊTRE CELUI DU SEED, et cette contrainte a été MESURÉE :
-- la première rédaction nommait sa fixture « Objectifs du trimestre », nom que le seed a pris
-- ensuite pour son propre tableau. L'unicité par workspace du §2.1 a fait ce qu'elle doit faire —
-- `duplicate key value violates unique constraint "goal_boards_workspace_name_key"` —, et la
-- suite entière est morte à sa première insertion. Ce n'était pas un défaut du produit mais une
-- collision de fixture, et le nom porte désormais celui du fichier pour qu'elle ne se reproduise
-- pas.
-- Les trois channels retenus le sont pour ce qu'ils SÉPARENT, mesuré sur la pile seedée :
--   * « Prospection »    (…031) — lu ET écrit par Camille et Driss ;
--   * « Grands comptes » (…032) — INVISIBLE à Farida, et c'est le seul cas qui prouve le §4.1 ;
--   * « Maintenance »    (…035) — lu par Driss, qui ne l'ÉCRIT PAS : le seul cas qui sépare le
--     `using` du `with check` de la mise à jour d'un bloc.

insert into public.goal_boards (id, workspace_id, name, description, position, created_by)
values
	('a0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
	 'Tableau d''essai de la suite 0047', 'Fixture locale, distincte du tableau du seed', 1,
	 '5eed0000-0000-4000-8000-000000000011'),
	('a0000000-0000-4000-8000-0000000000b2', '5eed0000-0000-4000-8000-000000000001',
	 'Second tableau', 'Sert au refus du lien inter-tableaux', 2,
	 '5eed0000-0000-4000-8000-000000000011');

insert into public.goal_blocks (id, board_id, title, fill_percent, channel_id,
                                pos_x, pos_y, width, height, color, created_by)
values
	-- Sans lien : lisible par les trois profils.
	('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000b1',
	 'Bloc libre', 40, null, 0, 0, 240, 120, 'brand',
	 '5eed0000-0000-4000-8000-000000000011'),
	-- Lié à « Prospection » : lisible par les trois.
	('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-0000000000b1',
	 'Bloc lié à Prospection', 10, '5eed0000-0000-4000-8000-000000000031', 300, 0, 240, 120,
	 'success', '5eed0000-0000-4000-8000-000000000011'),
	-- Lié à « Grands comptes » : INVISIBLE à Farida.
	('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-0000000000b1',
	 'Bloc lié à Grands comptes', 75, '5eed0000-0000-4000-8000-000000000032', 600, 0, 240, 120,
	 'accent', '5eed0000-0000-4000-8000-000000000011'),
	-- Lié à « Maintenance » : Driss le LIT, ne l'ÉCRIT PAS.
	('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-0000000000b1',
	 'Bloc lié à Maintenance', 0, '5eed0000-0000-4000-8000-000000000035', 900, 0, 240, 120,
	 'neutral', '5eed0000-0000-4000-8000-000000000011'),
	-- Sur le SECOND tableau : sert au refus du lien inter-tableaux.
	('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-0000000000b2',
	 'Bloc d''un autre tableau', 0, null, 0, 0, 240, 120, 'neutral',
	 '5eed0000-0000-4000-8000-000000000011');

-- =============================================================================================
-- 1. Forme des tables et refus par défaut
-- =============================================================================================

select has_table('public', 'goal_boards', 'CRM-082 : la table goal_boards existe');
select has_table('public', 'goal_blocks', 'CRM-082 : la table goal_blocks existe');
select has_table('public', 'goal_links',  'CRM-082 : la table goal_links existe');

select is(
	(select count(*) from pg_class
	  where oid in ('public.goal_boards'::regclass, 'public.goal_blocks'::regclass,
	                'public.goal_links'::regclass)
	    and relrowsecurity),
	3::bigint,
	'CRM-082 : les TROIS tables sont en refus par défaut — RLS activée');

-- `on delete set null` sur le channel, et non `cascade` : un channel mis à la corbeille ne fait
-- pas disparaître un objectif (docs/SPEC-goals.md §2.2). Constaté au CATALOGUE plutôt que par une
-- suppression de channel, qui déclencherait la corbeille de CRM-077 et prouverait autre chose.
select is(
	(select confdeltype from pg_constraint
	  where conrelid = 'public.goal_blocks'::regclass
	    and confrelid = 'public.channels'::regclass),
	'n'::"char",
	'CRM-082 : goal_blocks.channel_id est ON DELETE SET NULL — le bloc survit à sa destination');

-- =============================================================================================
-- 2. Les quatre gardes que la DoD nomme, chacune contre son succès
-- =============================================================================================

-- --- 2.1 Le lien inter-tableaux ---------------------------------------------------------------
-- C'est la RAISON D'ÊTRE de la redondance de `goal_links.board_id` (docs/SPEC-goals.md §2.4).

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000005', 'forward')$$,
	'23514',
	'Une flèche relie deux blocs du même tableau (docs/SPEC-goals.md §2.4).',
	'CRM-082 : une flèche dont la CIBLE vit sur un autre tableau est refusée');

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b2',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000005', 'forward')$$,
	'23514',
	'Une flèche relie deux blocs du même tableau (docs/SPEC-goals.md §2.4).',
	'CRM-082 : une flèche dont la SOURCE vit sur un autre tableau est refusée');

select lives_ok(
	$$insert into public.goal_links (id, board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-00000000000a',
	          'a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000002', 'forward')$$,
	'CRM-082 : la MÊME flèche, ses deux blocs sur le bon tableau, est acceptée');

-- --- 2.2 `fill_percent`, ses deux bornes et son hors-bornes -----------------------------------

select throws_ok(
	$$update public.goal_blocks set fill_percent = 101
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'23514',
	null,
	'CRM-082 : fill_percent = 101 est refusé');

select throws_ok(
	$$update public.goal_blocks set fill_percent = -1
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'23514',
	null,
	'CRM-082 : fill_percent = -1 est refusé');

-- LES DEUX BORNES EXACTES, sans quoi l'assertion précédente serait verte sur une contrainte qui
-- refuserait tout.
select lives_ok(
	$$update public.goal_blocks set fill_percent = 0
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'CRM-082 : fill_percent = 0 est accepté — la borne basse EST une valeur');

select lives_ok(
	$$update public.goal_blocks set fill_percent = 100
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'CRM-082 : fill_percent = 100 est accepté — la borne haute EST une valeur');

-- --- 2.3 La boucle sur soi ---------------------------------------------------------------------

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000001', 'forward')$$,
	'23514',
	null,
	'CRM-082 : une flèche d''un bloc vers LUI-MÊME est refusée');

-- --- 2.4 LE CYCLE EST ACCEPTÉ ------------------------------------------------------------------
-- `docs/SPEC-goals.md` §2.3 : « un diagramme d'objectifs n'est pas un graphe acyclique ». Une
-- implémentation zélée qui refuserait les cycles passerait TOUTES les autres assertions de cette
-- suite ; celle-ci est la seule qui la rendrait rouge.

select lives_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000002',
	          'a0000000-0000-4000-8000-000000000001', 'backward')$$,
	'CRM-082 : le CYCLE est ACCEPTÉ — A nourrit B et B nourrit A est une intention légitime');

-- --- 2.5 Les autres contraintes de forme -------------------------------------------------------

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000002', 'both')$$,
	'23505',
	null,
	'CRM-082 : une SECONDE flèche entre les mêmes blocs est refusée — changer la direction est '
	'une modification, pas un ajout');

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000004',
	          'a0000000-0000-4000-8000-000000000003', 'sideways')$$,
	'23514',
	null,
	'CRM-082 : une direction hors des trois nommées est refusée');

-- Un hexadécimal en base survivrait à tout changement de charte et la contredirait en silence
-- (docs/DESIGN_SYSTEM.md §1).
select throws_ok(
	$$update public.goal_blocks set color = '#23468C'
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'23514',
	null,
	'CRM-082 : une couleur HEXADÉCIMALE est refusée — seuls les noms de jeton sont admis');

select throws_ok(
	$$update public.goal_blocks set width = 0
	   where id = 'a0000000-0000-4000-8000-000000000001'$$,
	'23514',
	null,
	'CRM-082 : un bloc de largeur nulle est refusé — il serait invisible et non ressaisissable');

select throws_ok(
	$$update public.goal_boards set name = '   '
	   where id = 'a0000000-0000-4000-8000-0000000000b1'$$,
	'23514',
	null,
	'CRM-082 : un nom de tableau fait de blancs est refusé');

-- --- 2.6 L'unicité du nom porte sur la forme NORMALISÉE ---------------------------------------

select throws_ok(
	$$insert into public.goal_boards (workspace_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000001',
	          '  Tableau d''essai de la suite 0047  ', 9)$$,
	'23505',
	null,
	'CRM-082 : le même nom entouré de blancs entre en collision — l''unicité porte sur la forme '
	'normalisée (docs/SPEC-goals.md §2.1)');

-- --- 2.6 bis L'unicité NE S'ARRÊTE PAS aux tableaux vivants — décision 542 --------------------
--
-- Trois assertions pour une seule règle, et aucune n'est redondante : la première la mesure au
-- CATALOGUE, la deuxième par le COMPORTEMENT, la troisième par sa CONSÉQUENCE. La première seule
-- serait verte sur un index correct que rien n'appliquerait ; la deuxième seule serait verte sur
-- une collision due à toute autre cause ; la troisième seule ne dirait rien de l'unicité.
--
-- La règle est écrite dans `docs/SPEC-goals.md` §2.1 bis, tranchée le 2026-08-28 : un tableau
-- archivé RETIENT son nom, comme un track et un channel archivés retiennent leur `slug`. Elle est
-- figée ici parce qu'un commentaire de migration ne résiste pas à une session qui « harmoniserait »
-- cet index sur celui des budgets — `budgets_track_name_ouvert_key`, lui, est partiel, et cet écart
-- est VOULU (§2.1 bis.2).
--
-- LA NON-COMPLAISANCE EST MESURÉE, PAS SUPPOSÉE. Le 2026-08-28, l'index a été refait `where
-- archived_at is null` sur la base de développement, et la suite est passée de 48 vertes à
-- **4 rouges** : les trois assertions ci-dessous, plus la 24 du §2.7 — l'insertion qui aurait dû
-- être refusée ayant abouti en position 8, le trigger attribue 9 au lieu de 3. Cette quatrième
-- rougeur est une CONSÉQUENCE de la même dégradation, pas un second défaut ; elle est nommée ici
-- pour qu'une session future ne la cherche pas ailleurs. L'index a ensuite été rétabli, et la suite
-- rend de nouveau 48 vertes.

select is(
	(select pg_get_expr(ix.indpred, ix.indrelid)
	   from pg_index ix
	   join pg_class i on i.oid = ix.indexrelid
	  where i.relname = 'goal_boards_workspace_name_key'),
	null,
	'CRM-082 : l''index d''unicité du nom est TOTAL — aucun prédicat ne le restreint aux tableaux '
	'vivants (docs/SPEC-goals.md §2.1 bis)');

-- LE COMPORTEMENT, ET IL PASSE PAR L'ARCHIVAGE RÉEL : la fixture est archivée, puis son nom est
-- repris. Sans l'archivage, cette assertion doublerait celle du §2.6 et serait verte quel que soit
-- le prédicat de l'index.
update public.goal_boards set archived_at = now()
 where id = 'a0000000-0000-4000-8000-0000000000b1';

select throws_ok(
	$$insert into public.goal_boards (workspace_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000001',
	          'Tableau d''essai de la suite 0047', 8)$$,
	'23505',
	null,
	'CRM-082 : ARCHIVER un tableau ne LIBÈRE PAS son nom — la reprise est refusée, comme celle du '
	'`slug` d''un track archivé (décision 542)');

-- LA CONSÉQUENCE, qui est le motif de la règle : le nom n'ayant jamais été libéré, le désarchivage
-- ne peut heurter aucun doublon. C'est ce que `docs/SPEC-goals.md` §5.6.1 mesure 6 affirme, et une
-- assertion le FIGE plutôt qu'un commentaire l'affirme.
select lives_ok(
	$$update public.goal_boards set archived_at = null
	   where id = 'a0000000-0000-4000-8000-0000000000b1'$$,
	'CRM-082 : DÉSARCHIVER ne peut jamais échouer sur un doublon — le nom n''avait pas été libéré '
	'(docs/SPEC-goals.md §5.6.1, mesure 6)');

-- --- 2.7 `position` attribuée par trigger lorsqu'elle est omise -------------------------------

insert into public.goal_boards (id, workspace_id, name)
values ('a0000000-0000-4000-8000-0000000000b3', '5eed0000-0000-4000-8000-000000000001',
        'Tableau sans position');

select is(
	(select position from public.goal_boards
	  where id = 'a0000000-0000-4000-8000-0000000000b3'),
	3::numeric,
	'CRM-082 : position omise, le trigger attribue la suivante DANS SON WORKSPACE');

-- =============================================================================================
-- 3. Forme et privilèges des quatre fonctions d'appui
-- =============================================================================================
-- La décision 27 a mesuré la récursion qu'une fonction `invoker` provoque lorsqu'une politique
-- l'appelle. `search_path` vidé ferme en outre la substitution de schéma.

select is(
	(select count(*) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('can_read_goal_board', 'can_write_goal_board',
	                      'can_read_goal_block', 'can_write_goal_block')
	    and p.prosecdef
	    and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
	    and p.proowner = 'postgres'::regrole),
	4::bigint,
	'CRM-082 : les QUATRE fonctions d''appui sont SECURITY DEFINER, search_path vidé, postgres');

-- Un `revoke ... from public` ne suffit pas : `anon` conserverait son EXECUTE, posé par les
-- privilèges par défaut de la distribution (décision 80). On mesure donc l'octroi NOMINATIF.
select is(
	(select count(*) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('can_read_goal_board', 'can_write_goal_board',
	                      'can_read_goal_block', 'can_write_goal_block')
	    and has_function_privilege('authenticated', p.oid, 'execute')
	    and has_function_privilege('service_role', p.oid, 'execute')),
	4::bigint,
	'CRM-082 : authenticated et service_role exécutent les quatre fonctions d''appui');

-- Les deux triggers sont eux aussi `definer`, et pour un motif DIFFÉRENT, écrit dans la
-- migration : un bloc masqué par la RLS ferait rendre au trigger un refus faux, qui fuirait.
select is(
	(select count(*) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('goal_boards_attribuer_position', 'goal_links_verifier_tableau')
	    and p.prosecdef
	    and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
	2::bigint,
	'CRM-082 : les deux fonctions de trigger sont SECURITY DEFINER, search_path vidé');

-- =============================================================================================
-- 4. Les six règles de politique, jouées avec les trois profils réels
-- =============================================================================================

-- --- 4.1 L'appelant ANONYME ne lit rien -------------------------------------------------------
-- Les politiques de lecture sont ouvertes `to anon`, et c'est délibéré : le refus se fait par
-- ZÉRO LIGNE, `auth.uid()` valant NULL, et non par une erreur de privilège
-- (docs/SPEC-permissions-rls.md §7).

select pg_temp.anonyme();

select is(
	(select count(*) from public.goal_boards),
	0::bigint,
	'CRM-082 : l''appelant anonyme lit ZÉRO tableau — refus par filtrage, sans erreur');

select is(
	(select count(*) from public.goal_blocks),
	0::bigint,
	'CRM-082 : l''appelant anonyme lit ZÉRO bloc');

select pg_temp.redevenir_proprietaire();

-- --- 4.2 Farida, `viewer` : elle LIT le tableau, et n'écrit RIEN ------------------------------
-- « Un viewer n'écrit rien, tableau libre compris » : c'est l'invariant du §2.1 de
-- docs/SPEC-permissions-rls.md, qu'aucune table n'est autorisée à percer (docs/SPEC-goals.md
-- §4.2). MESURÉ : Farida porte pourtant `can_write_channel` VRAI sur « Prospection », par un
-- droit fin. La garde des objectifs tient au RÔLE DE WORKSPACE, et cette assertion l'établit.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select count(*) from public.goal_boards
	  where id = 'a0000000-0000-4000-8000-0000000000b1'),
	1::bigint,
	'CRM-082 : Farida, viewer et membre, LIT le tableau');

select throws_ok(
	$$insert into public.goal_boards (workspace_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000001', 'Tableau de la lectrice', 50)$$,
	'42501',
	null,
	'CRM-082 : Farida, viewer, n''INSÈRE aucun tableau — malgré son droit fin d''écriture sur '
	'Prospection');

-- Un `UPDATE` refusé par le `using` FILTRE, il ne lève pas d'erreur (décision 106). La preuve est
-- donc le nombre de lignes touchées, et non un code.
with tentative as (
	update public.goal_boards set name = 'Renommé par la lectrice'
	 where id = 'a0000000-0000-4000-8000-0000000000b1'
	returning 1
)
select is((select count(*) from tentative), 0::bigint,
	'CRM-082 : Farida, viewer, ne RENOMME aucun tableau — zéro ligne touchée, sans erreur');

with tentative as (
	delete from public.goal_boards
	 where id = 'a0000000-0000-4000-8000-0000000000b1'
	returning 1
)
select is((select count(*) from tentative), 0::bigint,
	'CRM-082 : Farida, viewer, ne SUPPRIME aucun tableau');

select throws_ok(
	$$insert into public.goal_blocks (board_id, title, pos_x, pos_y, width, height)
	  values ('a0000000-0000-4000-8000-0000000000b1', 'Bloc de la lectrice', 0, 300, 200, 100)$$,
	'42501',
	null,
	'CRM-082 : Farida, viewer, ne POSE aucun bloc');

-- --- 4.3 LE BLOC INVISIBLE, sur le cas qui le motive ------------------------------------------
-- Farida ne lit ni « Grands comptes » ni « Appels d'offres » : six channels sur huit, MESURÉ. Le
-- bloc lié à « Grands comptes » lui est donc INVISIBLE — pas grisé. Le griser révélerait qu'un
-- objectif existe sur un channel interdit, et son titre en dirait déjà trop (§4.1).

select is(
	(select count(*) from public.goal_blocks
	  where board_id = 'a0000000-0000-4000-8000-0000000000b1'),
	3::bigint,
	'CRM-082 : Farida lit TROIS blocs sur quatre — celui de Grands comptes lui est INVISIBLE');

select is(
	(select count(*) from public.goal_blocks
	  where id = 'a0000000-0000-4000-8000-000000000003'),
	0::bigint,
	'CRM-082 : le bloc lié à Grands comptes ne rend AUCUNE ligne à Farida, même nommément');

-- LA FLÈCHE, ELLE, RESTE LISIBLE. La lecture d'un lien ne dépend QUE du tableau (§9 bis.7), et
-- l'écran la rendra « en pointillés vers le vide, sans libellé et sans infobulle » (§5.4) plutôt
-- que de faire disparaître le dessin.
select is(
	(select count(*) from public.goal_links
	  where id = 'a0000000-0000-4000-8000-00000000000a'),
	1::bigint,
	'CRM-082 : Farida lit la FLÈCHE, la lecture d''un lien ne dépendant que du tableau');

select pg_temp.redevenir_proprietaire();

-- --- 4.4 Driss, `business_developer` : il écrit, mais pas n'importe où ------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select count(*) from public.goal_blocks
	  where board_id = 'a0000000-0000-4000-8000-0000000000b1'),
	4::bigint,
	'CRM-082 : Driss lit les QUATRE blocs — le même tableau ne rend pas le même dessin à deux '
	'personnes, et c''est la conséquence assumée du §4.1');

select lives_ok(
	$$insert into public.goal_boards (workspace_id, name, position)
	  values ('5eed0000-0000-4000-8000-000000000001', 'Tableau de Driss', 60)$$,
	'CRM-082 : Driss, business_developer, CRÉE un tableau sans demander un administrateur');

select lives_ok(
	$$insert into public.goal_blocks (board_id, title, pos_x, pos_y, width, height)
	  values ('a0000000-0000-4000-8000-0000000000b1', 'Bloc sans lien de Driss',
	          0, 300, 200, 100)$$,
	'CRM-082 : Driss pose un bloc SANS lien');

-- POSER UN LIEN EXIGE L'ÉCRITURE SUR LE CHANNEL, pas seulement sa lecture. MESURÉ : Driss LIT
-- « Maintenance » et ne l'ÉCRIT PAS. C'est le seul channel du seed qui sépare les deux, et donc
-- la seule assertion qui puisse prouver cette règle.
select throws_ok(
	$$insert into public.goal_blocks (board_id, title, channel_id, pos_x, pos_y, width, height)
	  values ('a0000000-0000-4000-8000-0000000000b1', 'Bloc que Driss lie à Maintenance',
	          '5eed0000-0000-4000-8000-000000000035', 0, 500, 200, 100)$$,
	'42501',
	null,
	'CRM-082 : Driss ne POSE PAS un lien vers Maintenance, qu''il lit sans l''écrire — un lien '
	'est une affirmation publique sur le dossier d''autrui');

select lives_ok(
	$$insert into public.goal_blocks (board_id, title, channel_id, pos_x, pos_y, width, height)
	  values ('a0000000-0000-4000-8000-0000000000b1', 'Bloc que Driss lie à Prospection',
	          '5eed0000-0000-4000-8000-000000000031', 0, 700, 200, 100)$$,
	'CRM-082 : Driss POSE un lien vers Prospection, qu''il écrit');

-- L'ASYMÉTRIE, ET C'EST LA RÈGLE. Le `using` ne porte que la LECTURE du channel actuel : retirer
-- un lien reste donc possible à qui écrit le bloc — « on peut toujours défaire ce qui gêne »
-- (§4.2). Sans cette asymétrie, un bloc lié à un channel qu'on ne peut plus écrire deviendrait
-- définitivement figé.
with retrait as (
	update public.goal_blocks set channel_id = null
	 where id = 'a0000000-0000-4000-8000-000000000004'
	returning 1
)
select is((select count(*) from retrait), 1::bigint,
	'CRM-082 : Driss RETIRE le lien vers Maintenance, qu''il n''aurait pas pu poser — asymétrie '
	'voulue du using et du with check (docs/SPEC-goals.md §4.2)');

-- Et il ne peut pas le REPOSER : la règle n'a pas été contournée, elle a été appliquée dans le
-- seul sens où elle s'applique.
--
-- LE CODE ATTENDU N'EST PAS CELUI DU RETRAIT, ET LA PREMIÈRE RÉDACTION DE CETTE ASSERTION S'EST
-- TROMPÉE. Un refus par le `using` FILTRE — zéro ligne touchée, aucune erreur (décision 106) —,
-- tandis qu'un refus par le `with check` LÈVE `42501` : la ligne existe, elle est atteinte, et
-- c'est la valeur proposée qui est rejetée. Les deux refus de cette unité ne se mesurent donc pas
-- de la même façon, et l'assertion le dit maintenant explicitement.
select throws_ok(
	$$update public.goal_blocks set channel_id = '5eed0000-0000-4000-8000-000000000035'
	   where id = 'a0000000-0000-4000-8000-000000000004'$$,
	'42501',
	null,
	'CRM-082 : Driss ne REPOSE PAS le lien qu''il vient de retirer — le with check l''oppose, et '
	'il LÈVE 42501 là où le using filtrerait en silence');

select pg_temp.redevenir_proprietaire();

-- --- 4.5 L'écriture d'une flèche suit les deux blocs qu'elle relie ----------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000004', 'both')$$,
	'42501',
	null,
	'CRM-082 : Farida, viewer, ne TRACE aucune flèche');

select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select lives_ok(
	$$insert into public.goal_links (board_id, source_block_id, target_block_id, direction,
	                                 label)
	  values ('a0000000-0000-4000-8000-0000000000b1',
	          'a0000000-0000-4000-8000-000000000001',
	          'a0000000-0000-4000-8000-000000000004', 'both', 'nourrit')$$,
	'CRM-082 : Driss TRACE une flèche entre deux blocs qu''il écrit, dans la direction <->');

-- Une flèche vers un bloc qu'il ne PEUT PAS écrire — ici parce qu'il ne le voit pas — est
-- refusée. Farida joue ce rôle : le bloc de « Grands comptes » lui est invisible, donc
-- `app.can_write_goal_block` est faux pour elle. La règle est éprouvée sur le profil qui la
-- rend fausse, et non sur celui qui la rendrait vraie par hasard.
select pg_temp.redevenir_proprietaire();

select is(
	(select app.can_write_goal_block('a0000000-0000-4000-8000-000000000003')),
	false,
	'CRM-082 : en propriétaire hors session, can_write_goal_block est faux — la fonction ne '
	'confère aucun droit par elle-même');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(select app.can_write_goal_block('a0000000-0000-4000-8000-000000000003')),
	true,
	'CRM-082 : Camille, administratrice qui écrit les huit channels, ÉCRIT le bloc de Grands '
	'comptes');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Le seed est rendu intact
-- =============================================================================================

select * from finish();

rollback;

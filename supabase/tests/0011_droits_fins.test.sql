-- @verifies CRM-012 (docs/BACKLOG.md) — droits fins par track et channel
-- @verifies docs/SPEC-permissions-rls.md §2.2 (matrice), §3.3 (fonctions can_*), §3.4 (appui),
--           §4.1 (politiques des tables de droits fins), §7 (preuves de refus n° 3, 4 et 11)
-- @verifies docs/SCHEMA.md §1 (`track_members`, `channel_members`), §9 (fonctions)
-- @verifies docs/SPEC-tracks.md §5.3 ; docs/SPEC-channels.md §6.3
-- @verifies docs/JOURNAL.md décisions 103, 104, 105 ; INC-013, INC-045
--
-- Suite pgTAP de l'unité `CRM-012`. Elle prouve six choses :
--
--   1. les **cinq fonctions** existent avec la forme exigée — volatilité, `SECURITY DEFINER`,
--      `search_path` vide, privilèges d'exécution ;
--   2. la **matrice de résolution** du §2.2, appliquée à des lignes réelles et non à trois
--      valeurs passées en argument : c'est ce que `CRM-010` ne pouvait pas prouver ;
--   3. la **jointure externe** — décision 104. Les deux cas, avec et sans droit fin, sont deux
--      assertions distinctes : une jointure interne rendrait la seconde verte et la première
--      fausse, et une assertion unique n'aurait pas vu la différence ;
--   4. les **politiques de lecture resserrées** de `tracks` et `channels`, y compris la
--      réouverture d'un channel sous un track fermé ;
--   5. les **politiques des tables de droits fins** — §4.1, lecture par l'administration et par
--      l'intéressé, écriture et suppression par l'administration seule ;
--   6. ce qui **reste dû** : `app.can_read_card`, figée par une assertion d'absence.
--
-- Exécution : `npm run test:sql`, `scripts/verify-droits-fins.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0011_droits_fins.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier.

begin;

create extension if not exists pgtap with schema extensions;

select plan(71);

-- =============================================================================================
-- 1. Les cinq fonctions existent, et avec la forme exigée
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.3 et §3.4. Ces assertions **remplacent** les `hasnt_function`
-- de `supabase/tests/0002_fonctions_autorisation.test.sql`, devenues rouges comme la décision 51
-- l'attendait d'elles : elles n'ont pas été retirées, elles ont été converties.

select has_function('app', 'can_read_track',    array['uuid'],
	'`app.can_read_track(uuid)` est livrée — INC-013 éteinte pour elle');
select has_function('app', 'can_read_channel',  array['uuid'],
	'`app.can_read_channel(uuid)` est livrée');
select has_function('app', 'can_write_channel', array['uuid'],
	'`app.can_write_channel(uuid)` est livrée');
select has_function('app', 'track_workspace',   array['uuid'],
	'`app.track_workspace(uuid)` est livrée — support des politiques du §4.1');
select has_function('app', 'channel_workspace', array['uuid'],
	'`app.channel_workspace(uuid)` est livrée');

select function_returns('app', 'can_read_track',    array['uuid'], 'boolean',
	'`can_read_track` rend un **booléen**, jamais NULL — `coalesce(…, false)`');
select function_returns('app', 'can_read_channel',  array['uuid'], 'boolean',
	'`can_read_channel` rend un booléen');
select function_returns('app', 'can_write_channel', array['uuid'], 'boolean',
	'`can_write_channel` rend un booléen');

-- `SECURITY DEFINER` n'est pas décoratif : sans lui, la politique de `tracks` s'interroge
-- elle-même et épuise la pile. Mesuré pendant la spécification, décision 103.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('can_read_track', 'can_read_channel', 'can_write_channel',
	                      'track_workspace', 'channel_workspace')
	    and p.prosecdef),
	5,
	'les cinq fonctions sont `SECURITY DEFINER` — sans quoi la politique de `tracks` récurse');

select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('can_read_track', 'can_read_channel', 'can_write_channel',
	                      'track_workspace', 'channel_workspace')
	    and p.provolatile = 's'),
	5,
	'les cinq fonctions sont `STABLE` : elles lisent des tables, elles n''écrivent rien');

-- `search_path` vide, et pas seulement « fixé » : une chaîne non vide rouvrirait la porte que la
-- convention ferme (docs/SCHEMA.md, conventions générales).
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('can_read_track', 'can_read_channel', 'can_write_channel',
	                      'track_workspace', 'channel_workspace')
	    and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
	5,
	'les cinq fonctions vident `search_path` : aucune table homonyme ne peut être substituée');

-- `EXECUTE` à `anon` : sans lui, un appelant anonyme atteignant `tracks` recevrait une erreur de
-- privilège là où le §7 exige zéro ligne.
select ok(
	has_function_privilege('anon', 'app.can_read_track(uuid)', 'EXECUTE'),
	'`anon` peut exécuter `can_read_track` — sinon le refus serait une erreur, pas zéro ligne');
select ok(
	has_function_privilege('anon', 'app.can_read_channel(uuid)', 'EXECUTE'),
	'`anon` peut exécuter `can_read_channel`');
select ok(
	not has_function_privilege('public', 'app.can_read_track(uuid)', 'EXECUTE'),
	'`PUBLIC` ne peut pas les exécuter : le droit est accordé nommément, jamais globalement');

-- =============================================================================================
-- 2. Fixtures : deux workspaces, deux tracks, deux channels, quatre comptes
-- =============================================================================================
-- Les comptes sont créés dans `auth.users`, le trigger de `CRM-003` en dérive les profils. Les
-- appartenances sont posées directement : CRM-022 réserve désormais leur création à un
-- administrateur existant, et CRM-070 reste propriétaire du parcours d'invitation.

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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       courriel, 'x', now(), now(), now()
  from (values
	('55550000-0000-4000-8000-00000000000a'::uuid, 'df-admin@exemple.test'),
	('55550000-0000-4000-8000-00000000000b'::uuid, 'df-bizdev@exemple.test'),
	('55550000-0000-4000-8000-00000000000c'::uuid, 'df-viewer@exemple.test'),
	('55550000-0000-4000-8000-00000000000d'::uuid, 'df-etranger@exemple.test')
  ) as v(id, courriel);

insert into public.workspaces (id, name, slug) values
	('55550000-0000-4000-8000-000000000001', 'Atelier DF A', 'atelier-df-a'),
	('55550000-0000-4000-8000-000000000002', 'Atelier DF B', 'atelier-df-b');

insert into public.workspace_members (workspace_id, user_id, role) values
	('55550000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-00000000000a', 'admin'),
	('55550000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-00000000000b', 'business_developer'),
	('55550000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-00000000000c', 'viewer'),
	('55550000-0000-4000-8000-000000000002', '55550000-0000-4000-8000-00000000000d', 'admin');

insert into public.tracks (id, workspace_id, name, slug, position) values
	('55550000-0000-4000-8000-0000000000a1', '55550000-0000-4000-8000-000000000001', 'Track DF 1', 'track-df-1', 1),
	('55550000-0000-4000-8000-0000000000a2', '55550000-0000-4000-8000-000000000001', 'Track DF 2', 'track-df-2', 2),
	('55550000-0000-4000-8000-0000000000b1', '55550000-0000-4000-8000-000000000002', 'Track DF B', 'track-df-b', 1);

insert into public.workflows (id, workspace_id, name, scope) values
	('55550000-0000-4000-8000-0000000000f1', '55550000-0000-4000-8000-000000000001', 'Workflow DF A', 'global'),
	('55550000-0000-4000-8000-0000000000f2', '55550000-0000-4000-8000-000000000002', 'Workflow DF B', 'global');

insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position) values
	('55550000-0000-4000-8000-0000000000c1', '55550000-0000-4000-8000-000000000001',
	 '55550000-0000-4000-8000-0000000000a1', '55550000-0000-4000-8000-0000000000f1', 'Channel 1', 'channel-df-1', 1),
	('55550000-0000-4000-8000-0000000000c2', '55550000-0000-4000-8000-000000000001',
	 '55550000-0000-4000-8000-0000000000a1', '55550000-0000-4000-8000-0000000000f1', 'Channel 2', 'channel-df-2', 2),
	('55550000-0000-4000-8000-0000000000c3', '55550000-0000-4000-8000-000000000001',
	 '55550000-0000-4000-8000-0000000000a2', '55550000-0000-4000-8000-0000000000f1', 'Channel 3', 'channel-df-3', 1);

-- =============================================================================================
-- 3. Les deux fonctions d'appui rendent le workspace, ou NULL
-- =============================================================================================

select is(app.track_workspace('55550000-0000-4000-8000-0000000000a1'),
	'55550000-0000-4000-8000-000000000001'::uuid,
	'`track_workspace` remonte au workspace propriétaire du track');
select is(app.channel_workspace('55550000-0000-4000-8000-0000000000c1'),
	'55550000-0000-4000-8000-000000000001'::uuid,
	'`channel_workspace` remonte au workspace propriétaire du channel');
select is(app.track_workspace('55550000-0000-4000-8000-00000000dead'), null::uuid,
	'un track inexistant rend NULL — et `is_workspace_admin(NULL)` refuse **calmement**');

-- =============================================================================================
-- 4. Décision 104 — la jointure est externe, et les deux cas sont deux assertions
-- =============================================================================================
-- C'est le cœur de l'unité. Un `left join` mal écrit — condition portée par le `where` au lieu de
-- l'`on` — transformerait « aucun droit fin » en refus, c'est-à-dire fermerait le produit par
-- défaut là où la spécification le veut hérité par défaut.
--
-- La première assertion est celle qui l'attrape : elle porte sur un track **sans aucune ligne**
-- `track_members`, le cas de très loin le plus courant. La seconde ne l'attraperait pas.

savepoint avant_matrice;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000c');

select ok(app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'DÉCISION 104 : sans aucune ligne `track_members`, le `viewer` lit — l''accès est **hérité**, '
	'et une jointure interne aurait ici rendu NULL donc refusé');
select ok(app.can_read_channel('55550000-0000-4000-8000-0000000000c1'),
	'sans aucun droit fin, le `viewer` lit le channel');
select ok(not app.can_write_channel('55550000-0000-4000-8000-0000000000c1'),
	'un `viewer` de workspace n''écrit pas, faute de droit fin qui l''y autorise');

reset role;
rollback to savepoint avant_matrice;

-- Le `business_developer`, sans droit fin : il écrit partout dans son workspace.
savepoint avant_bizdev;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000b');
select ok(app.can_write_channel('55550000-0000-4000-8000-0000000000c1'),
	'un `business_developer` sans droit fin écrit dans les channels de son workspace');
reset role;
rollback to savepoint avant_bizdev;

-- L'appelant anonyme : refus **calme**, jamais une erreur.
savepoint avant_anon;
select pg_temp.anonyme();
select ok(not app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'PREUVE DE REFUS N° 11 : l''appelant anonyme ne lit aucun track');
select ok(not app.can_read_channel('55550000-0000-4000-8000-0000000000c1'),
	'PREUVE DE REFUS N° 11 : l''appelant anonyme ne lit aucun channel');
reset role;
rollback to savepoint avant_anon;

-- Le membre d'un autre workspace : preuve n° 3, au niveau de la fonction.
savepoint avant_etranger;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000d');
select ok(not app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'PREUVE DE REFUS N° 3 : l''administrateur du workspace B ne lit pas un track de A');
reset role;
rollback to savepoint avant_etranger;

-- Un identifiant inconnu : `coalesce(…, false)`, et non NULL.
savepoint avant_inconnu;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');
select is(app.can_read_track('55550000-0000-4000-8000-00000000dead'), false,
	'un track inexistant rend **false**, pas NULL — décision 103, leçon de la décision 102');
select is(app.can_read_channel('55550000-0000-4000-8000-00000000dead'), false,
	'un channel inexistant rend false');
select is(app.can_write_channel('55550000-0000-4000-8000-00000000dead'), false,
	'idem en écriture');
reset role;
rollback to savepoint avant_inconnu;

-- =============================================================================================
-- 5. La matrice de résolution, appliquée à des lignes réelles
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §2.2. `CRM-010` a prouvé l'**algorithme** sur ses 64 combinaisons
-- d'entrées ; ce qui est prouvé ici est le **chemin** : la bonne ligne est lue, pour le bon
-- utilisateur, et passée dans le bon argument.

savepoint avant_droits_fins;

insert into public.track_members (track_id, user_id, access) values
	('55550000-0000-4000-8000-0000000000a1', '55550000-0000-4000-8000-00000000000c', 'none'),
	('55550000-0000-4000-8000-0000000000a1', '55550000-0000-4000-8000-00000000000a', 'none'),
	('55550000-0000-4000-8000-0000000000a2', '55550000-0000-4000-8000-00000000000b', 'viewer');

insert into public.channel_members (channel_id, user_id, access) values
	('55550000-0000-4000-8000-0000000000c1', '55550000-0000-4000-8000-00000000000c', 'member');

-- 5.1 Le `viewer` : le track est fermé, un de ses channels est rouvert.
savepoint m_viewer;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000c');

select ok(not app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'`track_members.access = ''none''` **ferme** le track : INC-024 close');
select ok(not app.can_read_channel('55550000-0000-4000-8000-0000000000c2'),
	'et ferme aussi ses channels, sans qu''aucune ligne `channel_members` soit nécessaire — '
	'INC-030 close');
select ok(app.can_read_channel('55550000-0000-4000-8000-0000000000c1'),
	'mais un `channel_members.access = ''member''` **rouvre** ce channel-là : « le plus '
	'spécifique gagne » vaut dans les deux sens (§3.1)');
select ok(app.can_write_channel('55550000-0000-4000-8000-0000000000c1'),
	'et il le rouvre **en écriture**, alors que le rôle de workspace est `viewer`');
select ok(app.can_read_track('55550000-0000-4000-8000-0000000000a2'),
	'le track voisin, sur lequel aucun droit fin ne porte, reste lisible : la restriction est '
	'bornée au sous-arbre visé');

reset role;
rollback to savepoint m_viewer;

-- 5.2 L'administrateur, porteur du **même** droit fin restrictif.
savepoint m_admin;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');

select ok(app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'RÈGLE 2 DU §2.2 : un administrateur porteur d''un `access = ''none''` lit quand même — une '
	'restriction silencieuse d''un administrateur produirait des situations irrécupérables');
select ok(app.can_write_channel('55550000-0000-4000-8000-0000000000c2'),
	'et il écrit dans les channels de ce même track');

reset role;
rollback to savepoint m_admin;

-- 5.3 Le `business_developer` restreint en lecture seule par un droit fin de track.
savepoint m_bizdev;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000b');

select ok(app.can_read_track('55550000-0000-4000-8000-0000000000a2'),
	'`track_members.access = ''viewer''` laisse **lire**');
select ok(not app.can_write_channel('55550000-0000-4000-8000-0000000000c3'),
	'mais retire l''écriture à un `business_developer`, qui écrirait sans lui');
select ok(app.can_write_channel('55550000-0000-4000-8000-0000000000c1'),
	'sur le track voisin, non visé, il écrit toujours');

reset role;
rollback to savepoint m_bizdev;

-- =============================================================================================
-- 6. Les politiques de lecture resserrées, vues depuis les tables
-- =============================================================================================
-- Les assertions précédentes portent sur les **fonctions**. Celles-ci portent sur les
-- **politiques** : une fonction juste dont la politique ne l'appelle pas ne protège rien.

savepoint p_viewer;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000c');

select is(
	(select count(*)::int from public.tracks
	  where workspace_id = '55550000-0000-4000-8000-000000000001'),
	1,
	'le `viewer` ne voit qu''un des deux tracks de son workspace : la politique de `tracks` '
	'applique bien le droit fin');
select is(
	(select count(*)::int from public.channels
	  where workspace_id = '55550000-0000-4000-8000-000000000001'),
	2,
	'et deux des trois channels : celui du track fermé qui a été rouvert, plus celui du track '
	'voisin');
select is(
	(select count(*)::int from public.channels
	  where id = '55550000-0000-4000-8000-0000000000c2'),
	0,
	'PREUVE DE REFUS N° 4, au niveau du channel : zéro ligne, et non une erreur');

reset role;
rollback to savepoint p_viewer;

savepoint p_admin;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');
select is(
	(select count(*)::int from public.tracks
	  where workspace_id = '55550000-0000-4000-8000-000000000001'),
	2,
	'l''administrateur voit ses deux tracks malgré son droit fin restrictif');
select is(
	(select count(*)::int from public.tracks
	  where workspace_id = '55550000-0000-4000-8000-000000000002'),
	0,
	'PREUVE DE REFUS N° 3 : et aucun track du workspace B — le resserrement n''a rien relâché');
reset role;
rollback to savepoint p_admin;

savepoint p_anon;
select pg_temp.anonyme();
select is((select count(*)::int from public.tracks),   0,
	'PREUVE DE REFUS N° 11 : l''anonyme ne voit aucun track');
select is((select count(*)::int from public.channels), 0,
	'PREUVE DE REFUS N° 11 : ni aucun channel');
reset role;
rollback to savepoint p_anon;

-- =============================================================================================
-- 7. Politiques des tables de droits fins — docs/SPEC-permissions-rls.md §4.1
-- =============================================================================================

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'track_members'),
	4,
	'`track_members` porte quatre politiques : lecture, insertion, mise à jour, suppression');
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'channel_members'),
	4,
	'`channel_members` en porte quatre également');

-- 7.1 Lecture : l'administration voit tout, l'intéressé voit sa ligne, les autres rien.
savepoint l_admin;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');
select is(
	(select count(*)::int from public.track_members
	  where track_id in ('55550000-0000-4000-8000-0000000000a1',
	                     '55550000-0000-4000-8000-0000000000a2')),
	3,
	'l''administrateur du workspace lit **toutes** les lignes de droits fins de ses tracks');
reset role;
rollback to savepoint l_admin;

savepoint l_viewer;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000c');
select is(
	(select count(*)::int from public.track_members
	  where track_id in ('55550000-0000-4000-8000-0000000000a1',
	                     '55550000-0000-4000-8000-0000000000a2')),
	1,
	'le `viewer` ne lit que **sa** ligne : trois existent, une seule le concerne');
select is(
	(select count(*)::int from public.track_members
	  where user_id <> '55550000-0000-4000-8000-00000000000c'),
	0,
	'et aucune ligne d''un collègue — un droit fin n''est pas une donnée d''équipe (décision 105)');
reset role;
rollback to savepoint l_viewer;

savepoint l_anon;
select pg_temp.anonyme();
select is((select count(*)::int from public.track_members),   0,
	'PREUVE DE REFUS N° 11 : l''anonyme ne lit aucun droit fin de track');
select is((select count(*)::int from public.channel_members), 0,
	'PREUVE DE REFUS N° 11 : ni aucun droit fin de channel');
reset role;
rollback to savepoint l_anon;

-- 7.2 Écriture : l'administrateur du workspace, et lui seul.
savepoint e_bizdev;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000b');
select throws_ok(
	$$insert into public.track_members (track_id, user_id, access)
	  values ('55550000-0000-4000-8000-0000000000a2',
	          '55550000-0000-4000-8000-00000000000c', 'none')$$,
	'42501', null,
	'un `business_developer` ne pose aucun droit fin : c''est une prérogative d''administration');
-- UN REFUS DE SUPPRESSION NE LÈVE AUCUNE ERREUR — décision 106, mesurée par cette suite.
-- Le `USING` d'une politique `for delete` **filtre** les lignes candidates : la commande réussit
-- et n'en supprime aucune. Seul un `WITH CHECK` lève `42501`, et une politique de suppression n'en
-- porte pas. Une assertion `throws_ok` aurait donc été **rouge pour la mauvaise raison**, et un
-- test qui se contenterait de « la commande n'a pas échoué » ne prouverait rien du tout.
-- Le refus se prouve ici en **relisant la ligne**.
select lives_ok(
	$$delete from public.track_members
	   where track_id = '55550000-0000-4000-8000-0000000000a1'
	     and user_id  = '55550000-0000-4000-8000-00000000000c'$$,
	'la suppression par un `business_developer` ne lève **aucune** erreur : le `USING` filtre');
reset role;
select is(
	(select count(*)::int from public.track_members
	  where track_id = '55550000-0000-4000-8000-0000000000a1'
	    and user_id  = '55550000-0000-4000-8000-00000000000c'),
	1,
	'ET POURTANT LA LIGNE EST INTACTE : c''est la seule preuve qui vaille pour une suppression '
	'refusée — relire, jamais se fier à l''absence d''erreur (décision 106)');
rollback to savepoint e_bizdev;

-- Le `viewer` ne peut pas non plus retirer **sa propre** restriction, qu'il voit pourtant.
savepoint e_viewer;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000c');
select lives_ok(
	$$delete from public.track_members
	   where track_id = '55550000-0000-4000-8000-0000000000a1'
	     and user_id  = '55550000-0000-4000-8000-00000000000c'$$,
	'la suppression de sa propre restriction ne lève aucune erreur non plus');
reset role;
select is(
	(select count(*)::int from public.track_members
	  where track_id = '55550000-0000-4000-8000-0000000000a1'
	    and user_id  = '55550000-0000-4000-8000-00000000000c'),
	1,
	'LE REFUS QUI COMPTE : voir sa propre restriction ne permet pas de la lever — la ligne '
	'survit à la tentative');
rollback to savepoint e_viewer;

savepoint e_admin;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');
select lives_ok(
	$$insert into public.track_members (track_id, user_id, access)
	  values ('55550000-0000-4000-8000-0000000000a2',
	          '55550000-0000-4000-8000-00000000000c', 'none')$$,
	'l''administrateur pose un droit fin');
select lives_ok(
	$$delete from public.track_members
	   where track_id = '55550000-0000-4000-8000-0000000000a2'
	     and user_id  = '55550000-0000-4000-8000-00000000000c'$$,
	'et le retire — le retour à l''accès hérité est un geste exposé (décision 105)');

-- Le cloisonnement tient aussi ici : l'administrateur de A ne pose rien sur un track de B.
select throws_ok(
	$$insert into public.track_members (track_id, user_id, access)
	  values ('55550000-0000-4000-8000-0000000000b1',
	          '55550000-0000-4000-8000-00000000000c', 'none')$$,
	'42501', null,
	'PREUVE DE REFUS N° 3 : l''administrateur de A ne pose aucun droit fin sur un track de B');

-- `WITH CHECK` sur l'`UPDATE` : sans lui, la ligne pourrait être déplacée vers un autre workspace.
select throws_ok(
	$$update public.track_members
	     set track_id = '55550000-0000-4000-8000-0000000000b1'
	   where track_id = '55550000-0000-4000-8000-0000000000a1'
	     and user_id  = '55550000-0000-4000-8000-00000000000c'$$,
	'42501', null,
	'le `WITH CHECK` interdit de **déplacer** un droit fin vers un track d''un autre workspace');
reset role;
rollback to savepoint e_admin;

-- 7.3 Un administrateur peut se restreindre lui-même, et cela ne l'atteint pas (décision 105).
savepoint e_auto;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');
select is(
	(select count(*)::int from public.track_members
	  where track_id = '55550000-0000-4000-8000-0000000000a1'
	    and user_id  = '55550000-0000-4000-8000-00000000000a'),
	1,
	'la ligne restrictive posée sur l''administrateur **existe** et lui est lisible');
select ok(app.can_read_track('55550000-0000-4000-8000-0000000000a1'),
	'elle est pourtant sans effet : la règle 2 s''applique à la résolution, pas à l''écriture. '
	'Elle redeviendra opposante si ce compte cesse d''être administrateur');
reset role;
rollback to savepoint e_auto;

rollback to savepoint avant_droits_fins;

-- =============================================================================================
-- 7 bis. DÉCISION 107 — `insert … returning` doit passer, et c'est ce qui fige la régression
-- =============================================================================================
-- La première version de cette migration adossait la politique de lecture de `tracks` à une
-- fonction qui **relisait `tracks`**. La suite pgTAP était verte : le défaut ne se voyait qu'à
-- l'écriture, et c'est `e2e/api/tracks.spec.ts` — livré par `CRM-020` — qui l'a trouvé.
--
-- Ces deux assertions le ramènent ici, où il aurait dû être attrapé. Elles échouent si l'une des
-- deux politiques revient à relire sa propre table : le `RETURNING` d'un `INSERT` est soumis à la
-- politique `SELECT`, et une fonction `STABLE` ne voit pas la ligne que l'instruction en cours
-- vient d'écrire.

savepoint avant_returning;
select pg_temp.endosser('55550000-0000-4000-8000-00000000000a');

select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('55550000-0000-4000-8000-000000000001', 'Track RETURNING', 'track-returning', 90)
	  returning id$$,
	'DÉCISION 107 : `insert … returning` sur `tracks` passe — la politique n''évalue que les '
	'colonnes de la ligne, jamais une relecture de la table');

select lives_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('55550000-0000-4000-8000-000000000001', '55550000-0000-4000-8000-0000000000a1',
	          '55550000-0000-4000-8000-0000000000f1', 'Channel RETURNING', 'channel-returning', 90)
	  returning id$$,
	'DÉCISION 107 : `insert … returning` sur `channels` passe également');

reset role;
rollback to savepoint avant_returning;

-- Et les deux fonctions de résolution sont livrées avec la forme exigée par le §3.5.
select has_function('app', 'resolve_track_access',   array['uuid', 'uuid'],
	'`app.resolve_track_access(uuid, uuid)` est livrée — §3.5');
select has_function('app', 'resolve_channel_access', array['uuid', 'uuid', 'uuid'],
	'`app.resolve_channel_access(uuid, uuid, uuid)` est livrée — §3.5');

-- =============================================================================================
-- 8. Privilèges de table
-- =============================================================================================

select ok(has_table_privilege('anon', 'public.track_members', 'SELECT'),
	'`anon` conserve `SELECT` : le refus doit venir de la politique, pas du privilège');
select ok(has_table_privilege('authenticated', 'public.track_members', 'DELETE'),
	'`authenticated` a `DELETE` : la suppression est un geste du produit, filtré par la politique');
select ok(not has_table_privilege('anon', 'public.channel_members', 'INSERT'),
	'`anon` n''a aucun droit d''écriture sur les droits fins');

-- =============================================================================================
-- 9. Ce qui reste dû — `app.can_read_card`
-- =============================================================================================
-- Cette assertion est le pendant de celles que cette suite vient de convertir : elle deviendra
-- rouge le jour où `CRM-040` livrera `cards` et écrira la quatrième fonction, et forcera
-- l'extension des preuves plutôt que leur silence.

-- RÉVISÉES À `CRM-040`, converties et non retirées : les deux sont devenues rouges exactement
-- comme cette suite l'annonçait, et le report a pris fin avec sa cause.
select has_function('app', 'can_read_card', array['uuid'],
	'INC-013 ÉTEINTE : `app.can_read_card` est livrée par `CRM-040`. La quatrième et dernière des '
	'fonctions différées ; ses preuves de comportement vivent dans 0012_cards.test.sql §8');

select has_table('public', 'cards',
	'`cards` existe : c''était la raison, et la seule, du report — elle a disparu avec lui');

select * from finish();
rollback;

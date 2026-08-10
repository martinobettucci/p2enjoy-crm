-- @verifies CRM-010 (docs/BACKLOG.md) — fonctions d'autorisation
-- @verifies CRM-022 (docs/BACKLOG.md) — rotation différée et politiques d'identité
-- @verifies docs/SPEC-permissions-rls.md §2 (rôles et droits fins), §3 (fonctions),
--           §3.3 (fonctions can_*), §3.6 (can_read_card), §3.8 (ce que CRM-010 doit prouver des
--           six fonctions), §7 (preuves)
-- @verifies docs/SCHEMA.md §9 (fonctions et RPC)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-013 (quatre fonctions différées — close le 2026-08-05)
-- @verifies docs/JOURNAL.md décisions 27, 51, 155, 156
--
-- Suite pgTAP de l'unité `CRM-010`. Elle prouve sept choses — les quatre premières depuis le
-- 2026-08-03, les trois dernières depuis la reprise de l'unité le 2026-08-05, quand les quatre
-- fonctions différées par INC-013 sont toutes devenues écrivables :
--
--   1. le **contrat** des fonctions livrées : signature, type de retour, `SECURITY DEFINER` ou
--      `INVOKER`, propriétaire, volatilité, `search_path` fixé, privilèges d'exécution ;
--   2. l'**algorithme** de résolution des droits fins, par énumération **exhaustive** de ses
--      64 combinaisons d'entrées (`docs/SPEC-permissions-rls.md` §2.2) ;
--   3. la **résolution du rôle** contre des comptes réels, avec des revendications JWT simulées
--      exactement comme PostgREST les pose, y compris l'appelant anonyme et la révocation
--      immédiate d'un rôle ;
--   4. l'**absence de récursion**, mesurée et non affirmée : une politique qui interroge
--      directement sa propre table échoue en `42P17`, une jumelle `SECURITY INVOKER` épuise la
--      pile en `54001`, tandis que la fonction `SECURITY DEFINER` livrée répond normalement ;
--   5. la **matrice à travers des lignes réelles** — la jointure qu'INC-013 nommait comme
--      manquante : 64 triplets construits par des lignes distinctes, comparés à `resolve_access`,
--      et une discrimination qui interdit l'oracle dégénéré (§3.8 a) ;
--   6. l'**absence de récursion sur les trois tables protégées** — `tracks`, `channels`, `cards` —,
--      démontrée en la provoquant sur chacune, la fonction livrée répondant là où sa jumelle
--      `SECURITY INVOKER` épuise la pile (§3.8 b) ;
--   7. le **recensement** des fonctions `SECURITY DEFINER` : aucune, dans `app` ni dans `public`,
--      ne laisse son `search_path` au hasard — une preuve qui tombera d'elle-même le jour où une
--      unité en ajoutera une sans le sien (§3.8 c).
--
-- Exécution : `scripts/verify-authz.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0002_fonctions_autorisation.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes de test, ni les politiques temporaires ne subsistent dans la base.

begin;

create extension if not exists pgtap with schema extensions;

select plan(153);

-- =============================================================================================
-- 1. Contrat des fonctions livrées — docs/SPEC-permissions-rls.md §3
-- =============================================================================================

select has_function('app', 'resolve_access', array['text', 'text', 'text'],
	'la fonction `app.resolve_access(text, text, text)` existe');
select has_function('app', 'workspace_role', array['uuid'],
	'la fonction `app.workspace_role(uuid)` existe');
select has_function('app', 'is_workspace_member', array['uuid'],
	'la fonction `app.is_workspace_member(uuid)` existe');
select has_function('app', 'is_workspace_admin', array['uuid'],
	'la fonction `app.is_workspace_admin(uuid)` existe');

select function_returns('app', 'resolve_access', array['text', 'text', 'text'], 'text',
	'`app.resolve_access` rend un `text` — none, read ou write');
select function_returns('app', 'workspace_role', array['uuid'], 'text',
	'`app.workspace_role` rend un `text` — le rôle, ou NULL');
select function_returns('app', 'is_workspace_member', array['uuid'], 'boolean',
	'`app.is_workspace_member` rend un booléen');
select function_returns('app', 'is_workspace_admin', array['uuid'], 'boolean',
	'`app.is_workspace_admin` rend un booléen');

-- `resolve_access` ne lit aucune table : lui donner les droits du propriétaire serait un
-- privilège gratuit, donc une surface d'attaque gratuite.
select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'resolve_access'),
	false,
	'`app.resolve_access` est SECURITY INVOKER : fonction pure, aucun privilège nécessaire'
);

-- Les trois fonctions qui lisent `workspace_members` doivent contourner ses politiques, sans quoi
-- toute politique posée sur cette table les ferait récurser (§3, et section 4 de cette suite).
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('workspace_role', 'is_workspace_member', 'is_workspace_admin')
	    and p.prosecdef),
	3,
	'les trois fonctions lisant `workspace_members` sont SECURITY DEFINER'
);

select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('resolve_access', 'workspace_role',
	                      'is_workspace_member', 'is_workspace_admin')
	    and pg_get_userbyid(p.proowner) = 'postgres'),
	4,
	'les quatre fonctions appartiennent à `postgres`, qui n''est pas soumis à RLS'
);

select is(
	(select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'resolve_access'),
	'i',
	'`app.resolve_access` est IMMUTABLE : même entrée, même sortie, toujours'
);

-- STABLE et non IMMUTABLE : les droits sont relus à chaque appel, donc une révocation prend effet
-- immédiatement (§3, dernier paragraphe). La section 3 de cette suite le mesure.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('workspace_role', 'is_workspace_member', 'is_workspace_admin')
	    and p.provolatile = 's'),
	3,
	'les trois fonctions de rôle sont STABLE : les droits sont relus, jamais mis en cache'
);

-- Reprise du contrôle de `CRM-003` : il porte désormais sur sept fonctions au lieu de trois.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
	                     where c like 'search\_path=%')),
	0,
	'toutes les fonctions du schéma `app` fixent `search_path`'
);

select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('resolve_access', 'workspace_role',
	                      'is_workspace_member', 'is_workspace_admin')
	    and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
	4,
	'les quatre fonctions vident `search_path` : aucune table homonyme ne peut être substituée'
);

-- =============================================================================================
-- 2. `app.resolve_access` — les 64 combinaisons de docs/SPEC-permissions-rls.md §2.2
-- =============================================================================================
-- Énumération complète : 4 valeurs de rôle de workspace — dont l'absence de rôle — par 4 états
-- du droit fin de track, par 4 états du droit fin de channel. NULL signifie « aucune ligne »,
-- c'est-à-dire « pas d'avis à ce niveau », ce qui n'est pas la même chose que `'none'`.
--
-- Le tableau attendu est écrit **en clair**, valeur par valeur : c'est la spécification rendue
-- exécutable, et non une seconde implémentation de la même formule.

select is(
	app.resolve_access(t.ws_role, t.track_access, t.channel_access),
	t.attendu,
	format('resolve_access(ws=%s, track=%s, channel=%s) = %s',
	       coalesce(t.ws_role, '(non membre)'),
	       coalesce(t.track_access, '(aucune ligne)'),
	       coalesce(t.channel_access, '(aucune ligne)'),
	       t.attendu)
)
from (values
	-- Règle 1 — non-membre : aucun droit fin ne crée d'accès.
	( 1, null, null,     null,     'none'),
	( 2, null, null,     'member', 'none'),
	( 3, null, null,     'viewer', 'none'),
	( 4, null, null,     'none',   'none'),
	( 5, null, 'member', null,     'none'),
	( 6, null, 'member', 'member', 'none'),
	( 7, null, 'member', 'viewer', 'none'),
	( 8, null, 'member', 'none',   'none'),
	( 9, null, 'viewer', null,     'none'),
	(10, null, 'viewer', 'member', 'none'),
	(11, null, 'viewer', 'viewer', 'none'),
	(12, null, 'viewer', 'none',   'none'),
	(13, null, 'none',   null,     'none'),
	(14, null, 'none',   'member', 'none'),
	(15, null, 'none',   'viewer', 'none'),
	(16, null, 'none',   'none',   'none'),

	-- Règle 2 — un administrateur n'est jamais restreint, quel que soit le droit fin posé.
	(17, 'admin', null,     null,     'write'),
	(18, 'admin', null,     'member', 'write'),
	(19, 'admin', null,     'viewer', 'write'),
	(20, 'admin', null,     'none',   'write'),
	(21, 'admin', 'member', null,     'write'),
	(22, 'admin', 'member', 'member', 'write'),
	(23, 'admin', 'member', 'viewer', 'write'),
	(24, 'admin', 'member', 'none',   'write'),
	(25, 'admin', 'viewer', null,     'write'),
	(26, 'admin', 'viewer', 'member', 'write'),
	(27, 'admin', 'viewer', 'viewer', 'write'),
	(28, 'admin', 'viewer', 'none',   'write'),
	(29, 'admin', 'none',   null,     'write'),
	(30, 'admin', 'none',   'member', 'write'),
	(31, 'admin', 'none',   'viewer', 'write'),
	(32, 'admin', 'none',   'none',   'write'),

	-- Règles 3 et 4 — business_developer : écrit par défaut, sauf avis plus spécifique.
	(33, 'business_developer', null,     null,     'write'),
	(34, 'business_developer', null,     'member', 'write'),
	(35, 'business_developer', null,     'viewer', 'read'),
	(36, 'business_developer', null,     'none',   'none'),
	(37, 'business_developer', 'member', null,     'write'),
	(38, 'business_developer', 'member', 'member', 'write'),
	(39, 'business_developer', 'member', 'viewer', 'read'),
	(40, 'business_developer', 'member', 'none',   'none'),
	(41, 'business_developer', 'viewer', null,     'read'),
	(42, 'business_developer', 'viewer', 'member', 'write'),
	(43, 'business_developer', 'viewer', 'viewer', 'read'),
	(44, 'business_developer', 'viewer', 'none',   'none'),
	(45, 'business_developer', 'none',   null,     'none'),
	-- Le channel l'emporte sur le track : « le plus spécifique gagne » vaut dans les deux sens.
	(46, 'business_developer', 'none',   'member', 'write'),
	(47, 'business_developer', 'none',   'viewer', 'read'),
	(48, 'business_developer', 'none',   'none',   'none'),

	-- Règles 3 et 4 — viewer : lit par défaut, mais un droit fin `member` lui ouvre l'écriture
	-- sur ce sous-arbre (§2.2, « même si le rôle de workspace est viewer »).
	(49, 'viewer', null,     null,     'read'),
	(50, 'viewer', null,     'member', 'write'),
	(51, 'viewer', null,     'viewer', 'read'),
	(52, 'viewer', null,     'none',   'none'),
	(53, 'viewer', 'member', null,     'write'),
	(54, 'viewer', 'member', 'member', 'write'),
	(55, 'viewer', 'member', 'viewer', 'read'),
	(56, 'viewer', 'member', 'none',   'none'),
	(57, 'viewer', 'viewer', null,     'read'),
	(58, 'viewer', 'viewer', 'member', 'write'),
	(59, 'viewer', 'viewer', 'viewer', 'read'),
	(60, 'viewer', 'viewer', 'none',   'none'),
	(61, 'viewer', 'none',   null,     'none'),
	(62, 'viewer', 'none',   'member', 'write'),
	(63, 'viewer', 'none',   'viewer', 'read'),
	(64, 'viewer', 'none',   'none',   'none')
) as t(rang, ws_role, track_access, channel_access, attendu)
order by t.rang;

-- =============================================================================================
-- 3. Résolution du rôle contre des comptes réels
-- =============================================================================================
-- Les comptes sont insérés dans `auth.users`, ce que fait GoTrue ; le trigger de `CRM-003` crée
-- les profils. La preuve par le **véritable** chemin applicatif — comptes créés par l'API
-- d'administration, jeton obtenu par la route de connexion — est rejouée hors interface par
-- `scripts/verify-authz.sh`.
--
-- La session est simulée en posant `request.jwt.claims`, exactement le réglage que PostgREST
-- positionne à partir du jeton : `auth.uid()` en dérive (voir sa définition dans le schéma
-- `auth`). Rien n'est contourné, c'est le mécanisme réel.

insert into auth.users (id, email, raw_user_meta_data) values
	('00000000-0000-4000-8000-000000000001', 'anne@exemple.test',   '{"full_name":"Anne Admin"}'),
	('00000000-0000-4000-8000-000000000002', 'bruno@exemple.test',  '{"full_name":"Bruno Biz"}'),
	('00000000-0000-4000-8000-000000000003', 'chloe@exemple.test',  '{"full_name":"Chloé Viewer"}'),
	('00000000-0000-4000-8000-000000000004', 'david@exemple.test',  '{"full_name":"David Autre"}'),
	('00000000-0000-4000-8000-000000000005', 'elise@exemple.test',  '{"full_name":"Élise Sans"}');

insert into public.workspaces (id, name, slug) values
	('00000000-0000-4000-8000-000000000a01', 'Workspace Un',   'ws-un'),
	('00000000-0000-4000-8000-000000000a02', 'Workspace Deux', 'ws-deux');

insert into public.workspace_members (workspace_id, user_id, role) values
	('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000001', 'admin'),
	('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000002',
	 'business_developer'),
	('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000003', 'viewer'),
	('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000004', 'admin');

-- 3.1 Administrateur du workspace 1
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), 'admin',
	'Anne : `workspace_role` rend « admin » sur le workspace 1');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), true,
	'Anne : membre du workspace 1');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), true,
	'Anne : administratrice du workspace 1');

-- 3.2 Business developer
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), 'business_developer',
	'Bruno : `workspace_role` rend « business_developer »');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), true,
	'Bruno : membre du workspace 1');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'Bruno : n''est pas administrateur');

-- 3.3 Viewer
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), 'viewer',
	'Chloé : `workspace_role` rend « viewer »');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), true,
	'Chloé : membre du workspace 1');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'Chloé : n''est pas administratrice');

-- 3.4 Membre d'un **autre** workspace — cloisonnement de premier niveau.
--     Preuve n° 3 de docs/SPEC-permissions-rls.md §7, au niveau de la fonction : être
--     administrateur du workspace 2 ne donne aucun droit sur le workspace 1.
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), null,
	'David, administrateur du workspace 2 : aucun rôle dans le workspace 1');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), false,
	'David : non membre du workspace 1');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'David : administrateur ailleurs n''est pas administrateur ici');

-- 3.5 Compte authentifié sans aucune appartenance
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), null,
	'Élise : aucun rôle — il n''existe pas de rôle implicite');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), false,
	'Élise : non membre');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'Élise : non administratrice');

-- 3.6 Appelant anonyme : `auth.uid()` est NULL. Le résultat attendu est un refus **calme** —
--     faux et NULL —, jamais une erreur (docs/SPEC-permissions-rls.md §7).
set local request.jwt.claims = '';

select is(app.workspace_role('00000000-0000-4000-8000-000000000a01'), null,
	'anonyme : aucun rôle, sans erreur');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), false,
	'anonyme : non membre, sans erreur');
select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'anonyme : non administrateur, sans erreur');

-- 3.7 Workspace inconnu ou nul : refus, pas d'erreur.
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(app.is_workspace_member('00000000-0000-4000-8000-00000000ffff'), false,
	'workspace inexistant : non membre');
select is(app.is_workspace_admin('00000000-0000-4000-8000-00000000ffff'), false,
	'workspace inexistant : non administrateur');
select is(app.is_workspace_member(null), false,
	'workspace nul : non membre, sans erreur');
select is(app.is_workspace_admin(null), false,
	'workspace nul : non administrateur, sans erreur');

-- 3.8 Le jeton ne porte pas les droits. La revendication `role` du JWT désigne le rôle
--     PostgreSQL, pas le rôle de workspace : la revendiquer `service_role` ne rend administrateur
--     de rien du tout.
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000003","role":"service_role"}';

select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'une revendication `role` privilégiée dans le jeton ne confère aucun rôle de workspace');

-- 3.9 Révocation immédiate : le rôle est relu à chaque appel, pas porté par le jeton. Le même
--     jeton, inchangé, cesse d'ouvrir des droits dès la ligne supprimée.
set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- CRM-022 protège le dernier admin. Cette suppression transitoire est une rotation contrôlée :
-- la contrainte est explicitement différée et redevient immédiate après restauration de la ligne.
set constraints workspace_members_garder_admin deferred;
delete from public.workspace_members
 where workspace_id = '00000000-0000-4000-8000-000000000a01'
   and user_id = '00000000-0000-4000-8000-000000000001';

select is(app.is_workspace_admin('00000000-0000-4000-8000-000000000a01'), false,
	'révocation : le même jeton ne donne plus l''administration, sans attendre son expiration');
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), false,
	'révocation : le même jeton ne donne plus l''appartenance');

insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-4000-8000-000000000a01',
        '00000000-0000-4000-8000-000000000001', 'admin');
set constraints workspace_members_garder_admin immediate;

-- =============================================================================================
-- 4. Absence de récursion — docs/SPEC-permissions-rls.md §3
-- =============================================================================================
-- La raison d'être de `SECURITY DEFINER` est ici mesurée, et non affirmée. Les trois contrôles se
-- lisent ensemble : deux façons de récurser, puis la fonction livrée qui ne récurse pas.
--
-- Les politiques créées ci-dessous sont **temporaires** : la transaction est annulée en fin de
-- fichier, et chacune est retirée immédiatement après son contrôle.

set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';

-- 4.1 La fonction livrée lit `workspace_members` même sous un rôle qui n'y voit rien : c'est
--     précisément l'effet de `SECURITY DEFINER`, et la condition pour qu'une politique puisse
--     s'appuyer dessus.
set local role authenticated;
select is(app.is_workspace_member('00000000-0000-4000-8000-000000000a01'), true,
	'sous le rôle `authenticated`, la fonction voit la table que RLS lui cache');
reset role;

-- CRM-022 livre déjà une politique permissive et sûre sur cette table. La neutraliser pendant les
-- deux contre-exemples empêche son résultat vrai de court-circuiter leur branche récursive.
alter policy workspace_members_lecture_membre on public.workspace_members using (false);

-- 4.2 Le cas nommé par la spécification : une politique sur `workspace_members` qui interroge
--     `workspace_members`. PostgreSQL le détecte et refuse — `42P17`.
create policy tst_recursion_directe on public.workspace_members
	for select to authenticated
	using (workspace_id in (select m.workspace_id from public.workspace_members m
	                         where m.user_id = (select auth.uid())));

set local role authenticated;
select throws_ok(
	'select count(*) from public.workspace_members',
	'42P17',
	null,
	'une politique interrogeant sa propre table récurse — c''est ce que les fonctions évitent'
);
reset role;
drop policy tst_recursion_directe on public.workspace_members;

-- 4.3 Une jumelle `SECURITY INVOKER` de `app.is_workspace_member` : la récursion passe par la
--     fonction, PostgreSQL ne la détecte donc pas comme telle et la pile est épuisée — `54001`.
--     C'est la démonstration que c'est bien `SECURITY DEFINER`, et non l'encapsulation dans une
--     fonction, qui règle le problème.
create function app.tst_is_member_invoker(ws uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select exists (
		select 1 from public.workspace_members m
		 where m.workspace_id = ws and m.user_id = (select auth.uid())
	);
$$;

grant execute on function app.tst_is_member_invoker(uuid) to authenticated;

create policy tst_recursion_invoker on public.workspace_members
	for select to authenticated
	using (app.tst_is_member_invoker(workspace_id));

set local role authenticated;
select throws_ok(
	'select count(*) from public.workspace_members',
	'54001',
	null,
	'une jumelle SECURITY INVOKER récurse jusqu''à épuiser la pile'
);
reset role;
drop policy tst_recursion_invoker on public.workspace_members;
drop function app.tst_is_member_invoker(uuid);

-- 4.4 La fonction livrée, employée dans une politique sur la table qu'elle lit : aucune erreur,
--     et le filtrage attendu — Chloé voit les trois membres de son workspace, pas celui de
--     l'autre workspace.
create policy tst_politique_definer on public.workspace_members
	for select to authenticated
	using (app.is_workspace_member(workspace_id));

set local role authenticated;

select lives_ok(
	'select count(*) from public.workspace_members',
	'la même politique, adossée à la fonction SECURITY DEFINER, ne récurse pas'
);

select is(
	(select count(*)::int from public.workspace_members),
	3,
	'la politique filtre réellement : les 3 membres du workspace 1, aucun du workspace 2'
);

reset role;
drop policy tst_politique_definer on public.workspace_members;
alter policy workspace_members_lecture_membre on public.workspace_members
	using (app.is_workspace_member(workspace_id));

-- =============================================================================================
-- 5. Privilèges d'exécution — docs/SPEC-permissions-rls.md §3
-- =============================================================================================
-- `anon` est inclus délibérément : sans `EXECUTE`, une politique appelant ces fonctions
-- refuserait un appelant anonyme par une **erreur de privilège** au lieu des zéro ligne
-- spécifiées au §7. Le droit n'ouvre rien — la section 3.6 mesure que la réponse reste « faux ».

select ok(has_function_privilege(t.role, t.fonction, 'EXECUTE'),
	format('%s détient EXECUTE sur %s', t.role, t.fonction))
from (values
	('anon',          'app.resolve_access(text,text,text)'),
	('authenticated', 'app.resolve_access(text,text,text)'),
	('service_role',  'app.resolve_access(text,text,text)'),
	('anon',          'app.workspace_role(uuid)'),
	('authenticated', 'app.workspace_role(uuid)'),
	('service_role',  'app.workspace_role(uuid)'),
	('anon',          'app.is_workspace_member(uuid)'),
	('authenticated', 'app.is_workspace_member(uuid)'),
	('service_role',  'app.is_workspace_member(uuid)'),
	('anon',          'app.is_workspace_admin(uuid)'),
	('authenticated', 'app.is_workspace_admin(uuid)'),
	('service_role',  'app.is_workspace_admin(uuid)')
) as t(role, fonction);

-- `PUBLIC` n'est jamais bénéficiaire : dans un ACL, une entrée sans grantee (`=X/postgres`)
-- signifierait que tout rôle de la base peut exécuter la fonction.
select is(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and p.proname in ('resolve_access', 'workspace_role',
	                      'is_workspace_member', 'is_workspace_admin')
	    and array_to_string(coalesce(p.proacl, array[]::aclitem[]), ',') ~ '(^|,)=X'),
	0,
	'aucune des quatre fonctions n''est exécutable par `PUBLIC`'
);

-- =============================================================================================
-- 6. Ce que les unités ultérieures ont livré — non-régression et INC-013
-- =============================================================================================
-- `CRM-010` n'écrivait aucune politique. CRM-012 a livré les droits fins et CRM-022 a fermé
-- INC-014 sur les trois tables d'identité ; cette suite historique retourne ses comptes exacts.

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public'
	    and tablename in ('profiles', 'workspaces', 'workspace_members')),
	7,
	'CRM-022 ferme INC-014 avec exactement sept politiques sur profiles, workspaces et '
	'workspace_members'
);

-- Le pendant de l'assertion ci-dessus : ce que `CRM-012` a **bien** posé. Sans elle, restreindre
-- la précédente à trois tables reviendrait à effacer la trace des deux autres.
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public'
	    and tablename in ('track_members', 'channel_members')),
	8,
	'CRM-012 a posé quatre politiques sur chacune des deux tables de droits fins (§4.1)'
);

-- Les quatre fonctions restantes de `docs/SPEC-permissions-rls.md` §3 dépendent de `tracks`,
-- `channels` et `cards`, livrées par `CRM-020`, `CRM-021` et `CRM-040`. La suite **constate**
-- leur absence plutôt que de la taire, afin de devenir rouge le jour où elles seront écrites sans
-- que ces preuves soient étendues (INC-013, même procédé qu'INC-010 dans la suite `0001`).

-- RÉVISÉES À `CRM-012`, converties et non retirées : trois des quatre fonctions sont livrées, et
-- ce sont leurs tables qui n'existaient pas. Les `hasnt_function` sont devenues rouges exactement
-- comme prévu ; les remplacer par des `has_function` est ce que la décision 51 attend d'elles, et
-- leurs preuves de comportement sont étendues par `supabase/tests/0011_droits_fins.test.sql`.
select has_function('app', 'can_read_track', array['uuid'],
	'INC-013 éteinte pour elle : `app.can_read_track` est livrée par CRM-012');
select has_function('app', 'can_read_channel', array['uuid'],
	'INC-013 éteinte pour elle : `app.can_read_channel` est livrée par CRM-012');
select has_function('app', 'can_write_channel', array['uuid'],
	'INC-013 éteinte pour elle : `app.can_write_channel` est livrée par CRM-012');

-- RÉVISÉE À `CRM-040`, convertie et non retirée — deuxième passage du même mécanisme sur cette
-- assertion. La quatrième fonction est livrée maintenant que `cards` existe, et **INC-013 est
-- entièrement éteinte**. Son comportement est prouvé par
-- `supabase/tests/0012_cards.test.sql` §8, directement : aucune politique ne l'appelle, la
-- politique de `cards` jugeant sur `channel_id` pour ne pas relire sa propre table (décision 110).
select has_function('app', 'can_read_card', array['uuid'],
	'INC-013 ÉTEINTE : `app.can_read_card` est livrée par CRM-040, avec `cards`');

-- =============================================================================================
-- 7. La matrice à travers des lignes réelles — docs/SPEC-permissions-rls.md §3.8 a
-- =============================================================================================
-- Ajoutée le 2026-08-05 (décisions 155 et 156). La section 2 énumère les 64 combinaisons du §2.2
-- sur `app.resolve_access`, fonction **pure** : elle prouve la règle métier, pas la **jointure**
-- qui l'alimente. C'est exactement ce qu'INC-013 nommait comme manquant, et ce que les quatre
-- fonctions livrées depuis rendent enfin prouvable.
--
-- Le dispositif : **un seul utilisateur**, quatre workspaces qui lui donnent les quatre états du
-- rôle — `admin`, `business_developer`, `viewer`, et l'absence d'appartenance —, quatre tracks par
-- workspace pour les quatre états du droit fin de track, quatre channels par track pour ceux du
-- droit fin de channel, et une card par channel. Soit **64 triplets**, tous les états d'un même
-- axe étant obtenus par des lignes distinctes plutôt qu'en modifiant les mêmes.
--
-- L'attendu est calculé par `app.resolve_access`, ce qui n'est pas une tautologie : la section 2 a
-- déjà prouvé cette fonction contre des valeurs écrites à la main, et ce qu'on éprouve ici est le
-- **chemin** qui va d'un identifiant de track ou de channel aux trois arguments qu'elle reçoit —
-- jointures externes comprises. Les assertions de discrimination qui suivent chaque comparaison
-- interdisent qu'un oracle dégénéré (« tout faux ») la rende verte.

-- Le quatrième état de chaque axe est l'**absence de ligne** : `t1` n'a pas de `track_members`,
-- `c1` pas de `channel_members`. C'est le cas de très loin le plus courant, et celui que la
-- jointure externe du §3.3 doit rendre `NULL` plutôt que refuser (décision 104).
create temporary table tst_matrice (
	w int, t int, c int,
	role_ws text, acces_track text, acces_channel text,
	track_id uuid, channel_id uuid, card_id uuid
) on commit drop;

insert into tst_matrice (w, t, c, role_ws, acces_track, acces_channel,
                         track_id, channel_id, card_id)
select w, t, c,
       (array[null, 'admin', 'business_developer', 'viewer'])[w + 1],
       (array[null, 'none', 'viewer', 'member'])[t],
       (array[null, 'none', 'viewer', 'member'])[c],
       ('00000000-0000-4000-8000-b1' || '00000000' || w || t)::uuid,
       ('00000000-0000-4000-8000-b2' || '0000000'  || w || t || c)::uuid,
       ('00000000-0000-4000-8000-b4' || '0000000'  || w || t || c)::uuid
  from generate_series(1, 4) w,
       generate_series(1, 4) t,
       generate_series(1, 4) c;

-- `w = 4` est le workspace où l'utilisateur n'a **aucune** appartenance : `role_ws` y vaut NULL.
update tst_matrice set role_ws = null where w = 4;
update tst_matrice set role_ws = 'admin'              where w = 1;
update tst_matrice set role_ws = 'business_developer' where w = 2;
update tst_matrice set role_ws = 'viewer'             where w = 3;

insert into auth.users (id, email, raw_user_meta_data) values
	('00000000-0000-4000-8000-000000000006', 'mathis@exemple.test',
	 '{"full_name":"Mathis Matrice"}'),
	('00000000-0000-4000-8000-000000000007', 'gardienne-matrice@exemple.test',
	 '{"full_name":"Gardienne Matrice"}');

insert into public.workspaces (id, name, slug)
select ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       'Matrice ' || w, 'matrice-' || w
	  from generate_series(1, 4) w;

-- CRM-022 : chaque workspace peuplé reçoit d'abord son administratrice. Mathis peut alors porter
-- chacun des rôles de la matrice sans que la fixture contourne l'invariant du produit.
insert into public.workspace_members (workspace_id, user_id, role)
select ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
	   '00000000-0000-4000-8000-000000000007'::uuid,
	   'admin'
	from generate_series(1, 4) w;

insert into public.workspace_members (workspace_id, user_id, role)
select ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       '00000000-0000-4000-8000-000000000006'::uuid,
       (array['admin', 'business_developer', 'viewer'])[w]
  from generate_series(1, 3) w;

insert into public.workflow_nodes_catalog (id, workspace_id, key, label, position)
select ('00000000-0000-4000-8000-b500000000' || w || '1')::uuid,
       ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       'matrice-noeud', 'Nœud matrice', 1
  from generate_series(1, 4) w;

insert into public.workflows (id, workspace_id, name, scope)
select ('00000000-0000-4000-8000-b30000000' || '00' || w)::uuid,
       ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       'Workflow matrice ' || w, 'global'
  from generate_series(1, 4) w;

insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
select ('00000000-0000-4000-8000-b600000000' || w || '1')::uuid,
       ('00000000-0000-4000-8000-b30000000' || '00' || w)::uuid,
       ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       ('00000000-0000-4000-8000-b500000000' || w || '1')::uuid,
       1, true
  from generate_series(1, 4) w;

insert into public.tracks (id, workspace_id, name, slug, position)
select ('00000000-0000-4000-8000-b1' || '00000000' || w || t)::uuid,
       ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       'Track ' || w || t, 'track-' || w || '-' || t, t
  from generate_series(1, 4) w, generate_series(1, 4) t;

insert into public.channels (id, workspace_id, track_id, workflow_id, name, slug, position)
select ('00000000-0000-4000-8000-b2' || '0000000' || w || t || c)::uuid,
       ('00000000-0000-4000-8000-b0000000000' || w)::uuid,
       ('00000000-0000-4000-8000-b1' || '00000000' || w || t)::uuid,
       ('00000000-0000-4000-8000-b30000000' || '00' || w)::uuid,
       'Channel ' || w || t || c, 'channel-' || w || '-' || t || '-' || c, c
  from generate_series(1, 4) w, generate_series(1, 4) t, generate_series(1, 4) c;

insert into public.cards (id, workspace_id, channel_id, workflow_id, current_step_id, title)
select m.card_id,
       ('00000000-0000-4000-8000-b0000000000' || m.w)::uuid,
       m.channel_id,
       ('00000000-0000-4000-8000-b30000000' || '00' || m.w)::uuid,
       ('00000000-0000-4000-8000-b600000000' || m.w || '1')::uuid,
       'Card ' || m.w::text || m.t::text || m.c::text
  from tst_matrice m;

insert into public.track_members (track_id, user_id, access)
select distinct m.track_id, '00000000-0000-4000-8000-000000000006'::uuid, m.acces_track
  from tst_matrice m where m.acces_track is not null;

insert into public.channel_members (channel_id, user_id, access)
select m.channel_id, '00000000-0000-4000-8000-000000000006'::uuid, m.acces_channel
  from tst_matrice m where m.acces_channel is not null;

select is((select count(*)::int from tst_matrice), 64,
	'les 64 combinaisons de rôle × droit fin de track × droit fin de channel sont construites');
select is((select count(distinct track_id)::int from tst_matrice), 16,
	'16 tracks distincts : 4 états du droit fin de track dans chacun des 4 états du rôle');

set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}';

-- `can_read_track` ne dépend que du rôle et du droit fin de **track** : la comparaison porte donc
-- sur les 16 tracks distincts, pas sur les 64 lignes, pour ne pas compter seize fois la même chose.
select is(
	(select string_agg(distinct m.w::text || m.t::text, ', ' order by m.w::text || m.t::text)
	   from tst_matrice m
	  where app.can_read_track(m.track_id)
	        <> (app.resolve_access(m.role_ws, m.acces_track, null) <> 'none')),
	null,
	'`can_read_track` : aucune divergence avec `resolve_access` sur les 16 combinaisons '
	'(rôle × droit fin de track) — la jointure qu''INC-013 attendait est prouvée');

select is(
	(select count(distinct m.track_id)::int from tst_matrice m
	  where app.can_read_track(m.track_id)),
	10,
	'…et elle discrimine : 10 des 16 tracks sont lisibles — 4 en `admin`, 3 en '
	'`business_developer`, 3 en `viewer`, 0 sans appartenance');

select is(
	(select string_agg(m.w::text || m.t::text || m.c::text, ', ' order by m.w::text || m.t::text || m.c::text)
	   from tst_matrice m
	  where app.can_read_channel(m.channel_id)
	        <> (app.resolve_access(m.role_ws, m.acces_track, m.acces_channel) <> 'none')),
	null,
	'`can_read_channel` : aucune divergence sur les 64 combinaisons, précédence '
	'channel → track → workspace comprise');

select is(
	(select count(*)::int from tst_matrice m where app.can_read_channel(m.channel_id)),
	38,
	'…et elle discrimine : 38 des 64 channels sont lisibles');

select is(
	(select string_agg(m.w::text || m.t::text || m.c::text, ', ' order by m.w::text || m.t::text || m.c::text)
	   from tst_matrice m
	  where app.can_write_channel(m.channel_id)
	        <> (app.resolve_access(m.role_ws, m.acces_track, m.acces_channel) = 'write')),
	null,
	'`can_write_channel` : aucune divergence sur les 64 combinaisons — `read` n''y suffit pas');

select is(
	(select count(*)::int from tst_matrice m where app.can_write_channel(m.channel_id)),
	27,
	'…et elle discrimine : 27 des 64 channels sont accessibles en écriture, soit 11 de moins '
	'qu''en lecture — un `viewer` de channel lit sans écrire');

-- `app.can_read_card` n'a **aucune règle propre** : le §3.6 la définit comme la délégation
-- `can_read_channel(card.channel_id)`. Ce qui est éprouvé ici est donc que la délégation reste
-- stricte — qu'aucune réécriture ultérieure n'y glisse un critère de workspace, d'archivage ou de
-- corbeille que la spécification ne porte pas.
select is(
	(select string_agg(m.w::text || m.t::text || m.c::text, ', ' order by m.w::text || m.t::text || m.c::text)
	   from tst_matrice m
	  where app.can_read_card(m.card_id) <> app.can_read_channel(m.channel_id)),
	null,
	'`can_read_card` délègue strictement à `can_read_channel` sur les 64 combinaisons (§3.6)');

select is(
	(select count(*)::int from tst_matrice m where app.can_read_card(m.card_id)),
	38,
	'…et la délégation transporte la discrimination : 38 des 64 cards sont lisibles');

-- Un identifiant inconnu : refus **calme**, et un booléen plutôt que NULL (décision 102).
select is(app.can_read_card('00000000-0000-4000-8000-00000000dead'), false,
	'une card inexistante rend `false`, pas NULL et pas une erreur');

reset role;

-- =============================================================================================
-- 8. Absence de récursion sur les trois tables protégées — docs/SPEC-permissions-rls.md §3.8 b
-- =============================================================================================
-- La section 4 démontre l'absence de récursion sur `app.is_workspace_member` et
-- `public.workspace_members`, seule table qui existât en 2026-08-03. Les trois fonctions livrées
-- depuis lisent chacune une table **elle-même protégée par RLS** — `tracks`, `channels`, `cards` —
-- et n'ont jamais eu de démonstration mécanique : `docs/SPEC-permissions-rls.md` §3.3 en affirmait
-- une, mesurée à la main pendant `CRM-012` et figée par aucune assertion.
--
-- Le procédé est celui de la décision 27, répété sur chaque table : la politique de lecture livrée
-- est retirée, remplacée par une politique adossée à la fonction — laquelle relit alors sa propre
-- table —, et l'on mesure. La fonction livrée répond avec le filtrage exact de la matrice ; une
-- jumelle `SECURITY INVOKER`, définition identique au mode d'exécution près, épuise la pile.
--
-- C'est la propriété qui compte : la non-récursion n'est pas dans le texte de ces fonctions, elle
-- est dans leur mode d'exécution, qu'un seul `alter function` suffirait à détruire.

set local request.jwt.claims =
	'{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}';

-- 8.1 `tracks`
drop policy tracks_lecture_membre on public.tracks;
create policy tst_rec_tracks_definer on public.tracks
	for select to authenticated using (app.can_read_track(id));

set local role authenticated;
select lives_ok(
	'select count(*) from public.tracks',
	'`can_read_track` dans une politique sur `tracks` : la lecture aboutit, aucune récursion');
select is((select count(*)::int from public.tracks), 10,
	'…et rend exactement les 10 tracks de la matrice : la politique filtre réellement');
reset role;

drop policy tst_rec_tracks_definer on public.tracks;

create function app.tst_can_read_track_invoker(track uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
	select coalesce((
		select app.resolve_access(app.workspace_role(t.workspace_id), tm.access, null) <> 'none'
		  from public.tracks t
		  left join public.track_members tm
		    on tm.track_id = t.id and tm.user_id = (select auth.uid())
		 where t.id = track), false);
$$;
grant execute on function app.tst_can_read_track_invoker(uuid) to authenticated;

create policy tst_rec_tracks_invoker on public.tracks
	for select to authenticated using (app.tst_can_read_track_invoker(id));

set local role authenticated;
select throws_ok(
	'select count(*) from public.tracks',
	'54001',
	null,
	'la jumelle SECURITY INVOKER de `can_read_track` épuise la pile : c''est bien le mode '
	'd''exécution qui règle la récursion, pas l''encapsulation dans une fonction');
reset role;

drop policy tst_rec_tracks_invoker on public.tracks;
drop function app.tst_can_read_track_invoker(uuid);
create policy tracks_lecture_membre on public.tracks
	for select to authenticated
	using (app.resolve_track_access(workspace_id, id) <> 'none');

-- 8.2 `channels`
drop policy channels_lecture_membre on public.channels;
create policy tst_rec_channels_definer on public.channels
	for select to authenticated using (app.can_read_channel(id));

set local role authenticated;
select lives_ok(
	'select count(*) from public.channels',
	'`can_read_channel` dans une politique sur `channels` : aucune récursion');
select is((select count(*)::int from public.channels), 38,
	'…et rend exactement les 38 channels lisibles de la matrice');
reset role;

drop policy tst_rec_channels_definer on public.channels;

create function app.tst_can_read_channel_invoker(ch uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
	select coalesce((
		select app.resolve_access(app.workspace_role(c.workspace_id), tm.access, cm.access)
		       <> 'none'
		  from public.channels c
		  left join public.track_members tm
		    on tm.track_id = c.track_id and tm.user_id = (select auth.uid())
		  left join public.channel_members cm
		    on cm.channel_id = c.id and cm.user_id = (select auth.uid())
		 where c.id = ch), false);
$$;
grant execute on function app.tst_can_read_channel_invoker(uuid) to authenticated;

create policy tst_rec_channels_invoker on public.channels
	for select to authenticated using (app.tst_can_read_channel_invoker(id));

set local role authenticated;
select throws_ok(
	'select count(*) from public.channels',
	'54001',
	null,
	'la jumelle SECURITY INVOKER de `can_read_channel` épuise la pile');
reset role;

drop policy tst_rec_channels_invoker on public.channels;
drop function app.tst_can_read_channel_invoker(uuid);
create policy channels_lecture_membre on public.channels
	for select to authenticated
	using (app.resolve_channel_access(workspace_id, track_id, id) <> 'none');

-- 8.3 `cards`. Le cas est celui que le §3.6 interdit en production — une politique de `cards` qui
--     appellerait `can_read_card` relirait `cards` et casserait le `RETURNING` d'un `INSERT`
--     (décision 107). On le pose ici **exprès**, et pour la seule durée de ces deux assertions.
drop policy cards_lecture on public.cards;
create policy tst_rec_cards_definer on public.cards
	for select to authenticated using (app.can_read_card(id));

set local role authenticated;
select lives_ok(
	'select count(*) from public.cards',
	'`can_read_card` dans une politique sur `cards` : aucune récursion');
select is((select count(*)::int from public.cards), 38,
	'…et rend exactement les 38 cards lisibles de la matrice');
reset role;

drop policy tst_rec_cards_definer on public.cards;

create function app.tst_can_read_card_invoker(card uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
	select coalesce((select app.can_read_channel(c.channel_id)
	                   from public.cards c where c.id = card), false);
$$;
grant execute on function app.tst_can_read_card_invoker(uuid) to authenticated;

create policy tst_rec_cards_invoker on public.cards
	for select to authenticated using (app.tst_can_read_card_invoker(id));

set local role authenticated;
select throws_ok(
	'select count(*) from public.cards',
	'54001',
	null,
	'la jumelle SECURITY INVOKER de `can_read_card` épuise la pile');
reset role;

drop policy tst_rec_cards_invoker on public.cards;
drop function app.tst_can_read_card_invoker(uuid);
create policy cards_lecture on public.cards
	for select to authenticated using (app.can_read_channel(channel_id));

-- 8.4 Le graphe **réellement livré** ne referme aucun de ces cycles, et sa plus longue chaîne
--     répond : `card_field_values` → `can_read_card` → `cards` → `can_read_channel` → `channels`
--     → `resolve_channel_access` → `workspace_members`. Aucune card de la matrice ne porte de
--     valeur ; celles du seed en portent, et l'assertion se lit donc sous une identité seedée.
set local request.jwt.claims =
	'{"sub":"5eed0000-0000-4000-8000-000000000013","role":"authenticated"}';
set local role authenticated;
select lives_ok(
	'select count(*) from public.card_field_values',
	'la plus longue chaîne du produit — quatre fonctions et trois tables — répond sans récurser');
select cmp_ok((select count(*)::int from public.card_field_values), '>', 0,
	'…et elle rend des lignes : la chaîne n''est pas verte parce qu''elle ne traverse rien');
reset role;

-- =============================================================================================
-- 9. Recensement des fonctions `SECURITY DEFINER` — docs/SPEC-permissions-rls.md §3.8 c
-- =============================================================================================
-- La Definition of Done dit « toutes les fonctions `SECURITY DEFINER` ». En 2026-08-03, « toutes »
-- valait sept, les seules qui existassent. Onze migrations plus tard, tenir une liste à la main
-- serait la garantie qu'elle dérive : l'exigence est donc écrite comme un **recensement**, qui
-- tombera de lui-même le jour où une unité ajoutera une fonction `SECURITY DEFINER` sans
-- `search_path` — sans qu'aucun fichier ait à être mis à jour (décision 51).

select is(
	(select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('app', 'public')
	    and p.prosecdef
	    and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""'),
	null,
	'aucune fonction `SECURITY DEFINER` des schémas `app` et `public` n''est sans '
	'`search_path` vide');

-- Le pendant du recensement : sans lui, « aucune anomalie » resterait vrai sur un schéma vide.
select cmp_ok(
	(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname in ('app', 'public') and p.prosecdef),
	'>=', 18,
	'le recensement porte sur au moins les 18 fonctions `SECURITY DEFINER` mesurées le '
	'2026-08-05 — la borne est basse à dessein, chaque unité en ajoutant');

-- `search_path` vide est également exigé des fonctions `SECURITY INVOKER` du projet : elles sont
-- appelées depuis des politiques, où le `search_path` de l''appelant n''est pas maîtrisé.
select is(
	(select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
	   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app'
	    and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""'),
	null,
	'aucune fonction du schéma `app`, `SECURITY INVOKER` comprise, ne laisse son `search_path` '
	'au hasard');

select * from finish();

rollback;

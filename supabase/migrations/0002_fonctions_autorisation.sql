-- @spec CRM-010 (docs/BACKLOG.md) — fonctions d'autorisation
-- @spec docs/SPEC-permissions-rls.md §2 (rôles et droits fins), §3 (fonctions d'autorisation)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC), « Conventions générales »
-- @spec docs/DAT.md §7 (autorisations)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Socle d'autorisation du produit. Cette migration livre les fonctions qui répondent, pour
-- l'appelant courant, à la question « qu'a-t-il le droit de faire ici ? ». Elle **n'écrit aucune
-- politique RLS** : les tables restent en refus par défaut, comme les a laissées `CRM-003`.
--
-- ---------------------------------------------------------------------------------------------
-- Périmètre réellement livré, et ce qui ne l'est pas.
-- ---------------------------------------------------------------------------------------------
-- `docs/SPEC-permissions-rls.md` §3 énumère six fonctions. Quatre d'entre elles —
-- `app.can_read_track`, `app.can_read_channel`, `app.can_write_channel`, `app.can_read_card` —
-- doivent remonter d'un track, d'un channel ou d'une card jusqu'à son workspace. Ce chemin passe
-- par les tables `tracks`, `channels` et `cards`, livrées par `CRM-020`, `CRM-021` et `CRM-040`,
-- soit **après** cette unité dans `docs/MASTER_PLAN.md` §2. Elles ne sont donc **pas** créées ici :
-- une fonction PL/pgSQL référençant une table absente serait acceptée par le serveur et
-- échouerait au premier appel, sans qu'aucune preuve puisse être produite d'ici là.
--
-- Contradiction d'ordonnancement consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-013, et
-- **non résolue implicitement** : aucune table n'est créée par anticipation pour la faire
-- disparaître, ce qui préempterait trois unités.
--
-- Ce qui est livré est ce qui est démontrable aujourd'hui :
--
--   * `app.resolve_access()` — l'**algorithme** de résolution du §2.2, isolé de toute table, donc
--     éprouvable de façon exhaustive dès maintenant. C'est la partie difficile et la seule qui
--     porte une règle métier ; les quatre fonctions différées n'auront plus qu'à l'appeler après
--     avoir lu leur ligne.
--   * `app.workspace_role()`, `app.is_workspace_member()`, `app.is_workspace_admin()` — la
--     résolution du rôle de workspace, qui ne dépend que de `workspace_members`.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi `SECURITY DEFINER`.
-- ---------------------------------------------------------------------------------------------
-- `docs/SPEC-permissions-rls.md` §3 : ces fonctions existent d'abord pour éviter la **récursion**.
-- Une politique posée sur `workspace_members` qui interrogerait `workspace_members` provoquerait
-- l'erreur `42P17` — « infinite recursion detected in policy for relation ». Exécutées avec les
-- droits de `postgres`, qui n'est pas soumis à RLS (`CRM-003` §9 : `FORCE ROW LEVEL SECURITY`
-- n'est pas utilisée), les fonctions lisent la table sans déclencher ses propres politiques.
-- La suite pgTAP de cette unité **mesure** les deux comportements : la version `SECURITY DEFINER`
-- ne récurse pas, une version `SECURITY INVOKER` équivalente récurse bien.
--
-- `search_path` est vidé sur chacune : une fonction `SECURITY DEFINER` dont le chemin de
-- résolution serait laissé à l'appelant permettrait de lui substituer une table homonyme.
--
-- ---------------------------------------------------------------------------------------------
-- Les droits ne sont pas portés par le jeton.
-- ---------------------------------------------------------------------------------------------
-- Les fonctions lisent `workspace_members` à chaque appel plutôt que de se fier à une
-- revendication du JWT. Une révocation prend donc effet immédiatement, sans attendre l'expiration
-- du jeton (`docs/SPEC-permissions-rls.md` §3, dernier paragraphe). C'est la raison pour laquelle
-- elles sont `STABLE` et non `IMMUTABLE`.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage (`docs/JOURNAL.md`, décision 20). Tout est donc écrit en `create or replace`,
-- et les `grant` sont rejouables par nature.

-- =============================================================================================
-- 1. `app.resolve_access` — algorithme de résolution des droits fins
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §2.2. Fonction **pure** : elle ne lit aucune table et ne dépend
-- ni de la session ni de l'horloge. C'est délibéré — ainsi la règle métier se prouve par
-- énumération complète de ses entrées, sans fixtures, et les fonctions qui l'appelleront n'ont
-- plus qu'à fournir trois valeurs déjà lues.
--
-- Entrées, chacune pouvant être nulle :
--
--   * `ws_role`        — `workspace_members.role`, ou NULL si l'appelant n'est pas membre ;
--   * `track_access`   — `track_members.access`, ou NULL si **aucune ligne** n'existe ;
--   * `channel_access` — `channel_members.access`, ou NULL si aucune ligne n'existe.
--
-- Sortie : `none`, `read` ou `write`, par ordre croissant de droit.
--
-- Les quatre règles, dans l'ordre où elles s'appliquent :
--
--   1. **Non-membre : aucun accès.** Un droit fin ne crée jamais d'accès à un workspace dont on
--      n'est pas membre — sinon une ligne oubliée dans `channel_members` rouvrirait une porte
--      qu'aucun retrait de membre ne refermerait.
--   2. **Un administrateur n'est jamais restreint.** §2.2 : « une restriction silencieuse d'un
--      administrateur produirait des situations irrécupérables ». La règle passe donc *avant* les
--      droits fins, et non après.
--   3. **La règle la plus spécifique gagne** : channel, puis track. L'absence de ligne — et non la
--      valeur `none` — signifie « pas d'avis à ce niveau », d'où la distinction stricte entre NULL
--      et `'none'`. Conséquence assumée : un `channel_members.access = 'member'` l'emporte sur un
--      `track_members.access = 'none'` du track qui contient ce channel, ce qui est exactement ce
--      que « le plus spécifique gagne » veut dire.
--   4. **À défaut, le rôle de workspace décide** : `business_developer` écrit, `viewer` lit.
--
-- Toute valeur inattendue retombe sur `none` : la fonction échoue en refusant, jamais en
-- autorisant.

create or replace function app.resolve_access(
	ws_role        text,
	track_access   text,
	channel_access text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
	select case
		when ws_role is null    then 'none'
		when ws_role = 'admin'  then 'write'
		when coalesce(channel_access, track_access) is not null then
			case coalesce(channel_access, track_access)
				when 'member' then 'write'
				when 'viewer' then 'read'
				else               'none'
			end
		when ws_role = 'business_developer' then 'write'
		when ws_role = 'viewer'             then 'read'
		else                                     'none'
	end;
$$;

alter function app.resolve_access(text, text, text) owner to postgres;

comment on function app.resolve_access(text, text, text) is
	'CRM-010 — docs/SPEC-permissions-rls.md §2.2. Résolution « le plus spécifique gagne » : '
	'rend « none », « read » ou « write ». Pure, sans accès aux tables.';

-- =============================================================================================
-- 2. `app.workspace_role` — rôle de l'appelant dans un workspace
-- =============================================================================================
-- Brique commune des deux prédicats qui suivent, et de `app.resolve_access` une fois les tables
-- `tracks` et `channels` livrées. Rend NULL lorsque l'appelant n'est pas membre : `docs/SPEC-
-- permissions-rls.md` §2.1, « il n'existe pas de rôle implicite ».
--
-- `auth.uid()` vaut NULL en l'absence de jeton — cas de l'appelant anonyme. La comparaison
-- `user_id = null` n'est alors jamais vraie : la fonction rend NULL sans erreur, et une politique
-- qui s'appuie dessus refusera par **zéro ligne** plutôt que par une erreur de privilège
-- (`docs/SPEC-permissions-rls.md` §7, dernier paragraphe).

create or replace function app.workspace_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select m.role
	  from public.workspace_members m
	 where m.workspace_id = ws
	   and m.user_id = (select auth.uid());
$$;

alter function app.workspace_role(uuid) owner to postgres;

comment on function app.workspace_role(uuid) is
	'CRM-010 — docs/SPEC-permissions-rls.md §2.1. Rôle de l''appelant dans le workspace, NULL '
	's''il n''en est pas membre. SECURITY DEFINER : évite la récursion des politiques.';

-- =============================================================================================
-- 3. `app.is_workspace_member` et `app.is_workspace_admin`
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3. Prédicats destinés aux politiques RLS (`CRM-012`). Ils sont
-- écrits en `exists` plutôt qu'en `app.workspace_role(ws) is not null` afin que le planificateur
-- puisse s'arrêter à la première ligne et exploiter la clé primaire `(workspace_id, user_id)`.

create or replace function app.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.workspace_members m
		 where m.workspace_id = ws
		   and m.user_id = (select auth.uid())
	);
$$;

alter function app.is_workspace_member(uuid) owner to postgres;

comment on function app.is_workspace_member(uuid) is
	'CRM-010 — docs/SPEC-permissions-rls.md §3. L''appelant appartient-il au workspace ?';

create or replace function app.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.workspace_members m
		 where m.workspace_id = ws
		   and m.user_id = (select auth.uid())
		   and m.role = 'admin'
	);
$$;

alter function app.is_workspace_admin(uuid) owner to postgres;

comment on function app.is_workspace_admin(uuid) is
	'CRM-010 — docs/SPEC-permissions-rls.md §3. L''appelant est-il administrateur du workspace ?';

-- =============================================================================================
-- 4. Privilèges d'exécution
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3 demande que ces fonctions soient « accordées à
-- `authenticated` ». `EXECUTE` est également accordé à `anon`, pour la même raison que `CRM-003`
-- accorde `SELECT` à `anon` sur les cinq tables : une politique RLS est évaluée avec les droits du
-- rôle courant, et un appelant anonyme dépourvu d'`EXECUTE` recevrait une **erreur de privilège**
-- là où le comportement spécifié est **zéro ligne** (§7, dernier paragraphe). Le droit accordé
-- n'ouvre rien : `auth.uid()` étant NULL sans jeton, les trois prédicats rendent faux ou NULL.
--
-- `PUBLIC` reste exclu : `CRM-003` a posé
-- `alter default privileges in schema app revoke execute on functions from public`, et le
-- `revoke` ci-dessous le confirme pour les fonctions créées par `create or replace` sur une base
-- où une version antérieure aurait porté un autre ACL.

revoke all on function app.resolve_access(text, text, text) from public;
revoke all on function app.workspace_role(uuid)             from public;
revoke all on function app.is_workspace_member(uuid)        from public;
revoke all on function app.is_workspace_admin(uuid)         from public;

grant execute on function app.resolve_access(text, text, text)
	to anon, authenticated, service_role;
grant execute on function app.workspace_role(uuid)
	to anon, authenticated, service_role;
grant execute on function app.is_workspace_member(uuid)
	to anon, authenticated, service_role;
grant execute on function app.is_workspace_admin(uuid)
	to anon, authenticated, service_role;

-- Le schéma `app` n'est pas exposé par PostgREST (`PGRST_DB_SCHEMAS`) : aucune de ces fonctions
-- n'est appelable en RPC. Elles ne servent qu'aux politiques et aux triggers. Le signal de
-- rechargement reste utile — il fait reprendre à PostgREST les privilèges modifiés.
notify pgrst, 'reload schema';

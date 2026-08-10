-- @spec CRM-012 (docs/BACKLOG.md) — droits fins par track et channel
-- @spec docs/SPEC-permissions-rls.md §2.2 (résolution), §3.3 (fonctions can_*), §3.4 (appui),
--       §4 (politiques), §4.1 (tables de droits fins), §4.2 (contrat d'API), §7 (preuves 3, 4, 11)
-- @spec docs/SCHEMA.md §1 (`track_members`, `channel_members`), §9 (fonctions et RPC)
-- @spec docs/SPEC-tracks.md §5.3 ; docs/SPEC-channels.md §6.3
-- @spec docs/JOURNAL.md décisions 103, 104, 105 ; docs/INCONSISTENCY_REPORT.md INC-045
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- Cette migration rend les droits fins **opposables**. Jusqu'ici la règle du §2.2 était écrite,
-- éprouvée sur ses 64 combinaisons d'entrées par `CRM-010`, et sans effet : les politiques de
-- `tracks` et de `channels` s'arrêtaient au rôle de workspace, et une ligne `track_members`
-- restrictive ne masquait rien (INC-024, INC-030).
--
-- ---------------------------------------------------------------------------------------------
-- Ce qui est livré, et ce qui ne l'est pas.
-- ---------------------------------------------------------------------------------------------
-- `docs/SPEC-permissions-rls.md` §3 énumère six fonctions. `CRM-010` en a livré deux ; cette
-- migration en livre **trois** de plus — `app.can_read_track`, `app.can_read_channel`,
-- `app.can_write_channel` — plus deux fonctions d'appui.
--
-- `app.can_read_card` n'est **pas** écrite. `cards` est livrée par `CRM-040` : une fonction
-- PL/pgSQL référençant une table absente serait acceptée par le serveur et échouerait au premier
-- appel, sans qu'aucune preuve puisse être produite. Le motif d'origine d'INC-013 vaut encore
-- pour elle, et pour elle seule (docs/JOURNAL.md, décision 103).
--
-- Les politiques des tables d'identité — `profiles`, `workspaces`, `workspace_members` — ne sont
-- **pas** écrites ici : cette frontière historique a été fermée depuis par CRM-022, migration 21.
-- Un rejeu partiel doit donc toujours se terminer par les migrations plus récentes.
--
-- ---------------------------------------------------------------------------------------------
-- Rejouabilité.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage (docs/JOURNAL.md, décision 20). Tout est écrit en `create or replace`,
-- `drop policy if exists` avant `create policy`, et les `grant` sont rejouables par nature.

-- =============================================================================================
-- 1. Fonctions d'appui : le workspace d'un track, le workspace d'un channel
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.4. Elles existent parce que `track_members` et
-- `channel_members` ne portent **pas** `workspace_id` — écart INC-011, consigné par `CRM-003` et
-- non résolu ici. Leurs politiques doivent donc remonter par `tracks` ou par `channels` pour
-- savoir de quel workspace relève une ligne.
--
-- `SECURITY DEFINER` n'est pas un confort : sans lui, la politique de `track_members`
-- interrogerait `tracks`, dont la politique interroge `track_members`. MESURÉ pendant la
-- spécification : adossée à une fonction `SECURITY DEFINER`, la lecture répond avec le filtrage
-- attendu ; une jumelle `SECURITY INVOKER` épuise la pile d'appels (`54001`). Seconde occurrence
-- de la décision 27.
--
-- Elles rendent `NULL` sur un identifiant inconnu, et c'est voulu : `app.is_workspace_admin(NULL)`
-- rend `false`, donc le refus est **calme**, jamais une erreur.

create or replace function app.track_workspace(track uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select t.workspace_id from public.tracks t where t.id = track;
$$;

alter function app.track_workspace(uuid) owner to postgres;

comment on function app.track_workspace(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.4. Workspace propriétaire du track, NULL s''il '
	'n''existe pas. SECURITY DEFINER : évite la récursion entre `track_members` et `tracks`.';

create or replace function app.channel_workspace(ch uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select c.workspace_id from public.channels c where c.id = ch;
$$;

alter function app.channel_workspace(uuid) owner to postgres;

comment on function app.channel_workspace(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.4. Workspace propriétaire du channel, NULL s''il '
	'n''existe pas. SECURITY DEFINER, même motif.';

-- =============================================================================================
-- 1 bis. Résolution à partir des colonnes déjà en main
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.5, docs/JOURNAL.md décision 107.
--
-- UN DÉFAUT RÉEL, TROUVÉ PAR LES PREUVES DE `CRM-020` ET CORRIGÉ DANS LE MÊME CHANGEMENT.
--
-- La première version de cette migration adossait la politique de lecture de `tracks` à
-- `app.can_read_track(id)`, qui **relit `public.tracks`** pour retrouver le workspace. MESURÉ :
-- `insert … returning`, c'est-à-dire toute écriture avec `Prefer: return=representation`, échoue
-- alors en `42501`. Une fonction `STABLE` voit le cliché du **début de l'instruction** : la ligne
-- qui vient d'être insérée par cette même instruction lui est invisible, la politique `SELECT` du
-- `RETURNING` refuse, et l'`INSERT` entier est annulé. Un administrateur ne pouvait plus créer un
-- track depuis l'API.
--
-- La correction n'est pas de rendre la fonction `VOLATILE` — ce serait payer un rechargement de
-- cliché par ligne pour contourner un symptôme. Une politique est évaluée **sur une ligne dont
-- elle a déjà toutes les colonnes** : relire la table par son identifiant est à la fois inutile et
-- la cause du défaut. Ces deux fonctions prennent donc le workspace en argument et ne lisent que
-- les tables de droits fins, que l'instruction en cours ne touche pas.
--
-- Les fonctions `can_*` du §3.3 restent livrées telles que la spécification les décrit : elles
-- s'adressent aux appelants qui n'ont qu'un identifiant en main, et délèguent ici.

create or replace function app.resolve_track_access(ws uuid, track uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.resolve_access(
		app.workspace_role(ws),
		(select tm.access from public.track_members tm
		  where tm.track_id = track and tm.user_id = (select auth.uid())),
		null
	);
$$;

alter function app.resolve_track_access(uuid, uuid) owner to postgres;

comment on function app.resolve_track_access(uuid, uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.5. Accès effectif à un track, le workspace étant '
	'fourni par l''appelant. Ne lit **pas** `tracks` : c''est ce qui rend `insert … returning` '
	'possible (décision 107).';

create or replace function app.resolve_channel_access(ws uuid, track uuid, ch uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.resolve_access(
		app.workspace_role(ws),
		(select tm.access from public.track_members tm
		  where tm.track_id = track and tm.user_id = (select auth.uid())),
		(select cm.access from public.channel_members cm
		  where cm.channel_id = ch and cm.user_id = (select auth.uid()))
	);
$$;

alter function app.resolve_channel_access(uuid, uuid, uuid) owner to postgres;

comment on function app.resolve_channel_access(uuid, uuid, uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.5. Accès effectif à un channel, le workspace et le '
	'track étant fournis par l''appelant. Ne lit ni `channels` ni `tracks`.';

-- Les sous-requêtes scalaires ci-dessus remplacent les jointures externes de la première version,
-- et pour la même raison qu'elles : une sous-requête sans ligne rend `NULL`, que
-- `app.resolve_access` interprète comme « aucun avis à ce niveau ». La distinction stricte entre
-- `NULL` et `'none'` du §2.2 est donc préservée mot pour mot (décision 104).

-- =============================================================================================
-- 2. `app.can_read_track` — droit de lecture effectif sur un track
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.3. La fonction fait exactement ce que le §3.1 annonçait des
-- quatre fonctions différées : elle lit une ligne, puis appelle `app.resolve_access`.
--
-- ---------------------------------------------------------------------------------------------
-- La jointure est **externe**, et l'inverse serait un refus par défaut.
-- ---------------------------------------------------------------------------------------------
-- docs/JOURNAL.md, décision 104. `app.resolve_access` distingue strictement `NULL` — « aucun avis
-- à ce niveau » — de `'none'` — « accès explicitement fermé ». Cette distinction ne survit que si
-- l'absence de ligne `track_members` produit `NULL`.
--
-- Une jointure **interne** ne rendrait aucune ligne dans le cas de très loin le plus courant —
-- l'appelant n'a pas de droit fin —, la fonction rendrait `NULL`, la politique refuserait, et
-- tout membre du workspace perdrait l'accès à tout ce sur quoi personne ne lui a rien accordé.
-- Le produit serait fermé par défaut là où la spécification le veut **hérité** par défaut.
--
-- Pour la même raison, `tm.user_id = auth.uid()` est dans la **condition de jointure** et non
-- dans le `where` : un `where` sur une colonne de la table jointe annule l'effet du `left join`
-- et reproduit exactement ce défaut.
--
-- ---------------------------------------------------------------------------------------------
-- `coalesce(…, false)` : la fonction rend un booléen, jamais NULL.
-- ---------------------------------------------------------------------------------------------
-- MESURÉ : appelée sur un track inexistant, la requête ne rend aucune ligne, donc la fonction
-- rend `NULL`. Dans un `USING` de politique, `NULL` refuse déjà — mais une fonction dont le
-- contrat annonce `boolean` doit rendre un booléen, et le comportement correct **ici** serait
-- incorrect ailleurs. C'est la leçon de la décision 102, appliquée avant d'en payer le prix.
-- Le `coalesce` est **à l'extérieur** du `select` : à l'intérieur, il n'aurait rien changé, la
-- valeur nulle ne venant pas de l'expression mais de l'absence de ligne.

create or replace function app.can_read_track(track uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.resolve_track_access(t.workspace_id, t.id) <> 'none'
		   from public.tracks t
		  where t.id = track),
		false);
$$;

alter function app.can_read_track(uuid) owner to postgres;

comment on function app.can_read_track(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.3. Droit de lecture effectif sur le track, droit '
	'fin appliqué. Jointure externe : aucune ligne `track_members` signifie « accès hérité », '
	'jamais « refus ».';

-- =============================================================================================
-- 3. `app.can_read_channel` et `app.can_write_channel`
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §3.3. Même forme, à deux jointures externes cette fois : un
-- channel hérite du droit fin de **son track**, que son propre droit fin peut surcharger.
--
-- Conséquence contre-intuitive, explicitée par le §3.1 et **mesurée** : un
-- `channel_members.access = 'member'` l'emporte sur un `track_members.access = 'none'` posé sur
-- le track qui contient ce channel. « Le plus spécifique gagne » vaut dans les deux sens, y
-- compris lorsqu'il rouvre plus bas ce qui est fermé plus haut.
--
-- Les deux fonctions ne diffèrent que par le seuil : `<> 'none'` pour lire, `= 'write'` pour
-- écrire. Elles ne sont volontairement pas écrites l'une en fonction de l'autre — une seule
-- fonction rendant `text` aurait été plus courte, mais une politique appelant
-- `app.channel_access(id) = 'write'` déplace la règle dans la politique, où elle se duplique et
-- où une faute de frappe ouvre au lieu de fermer.

create or replace function app.can_read_channel(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.resolve_channel_access(c.workspace_id, c.track_id, c.id) <> 'none'
		   from public.channels c
		  where c.id = ch),
		false);
$$;

alter function app.can_read_channel(uuid) owner to postgres;

comment on function app.can_read_channel(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.3. Droit de lecture effectif sur le channel. Le '
	'droit fin du channel surcharge celui de son track, y compris pour rouvrir.';

create or replace function app.can_write_channel(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.resolve_channel_access(c.workspace_id, c.track_id, c.id) = 'write'
		   from public.channels c
		  where c.id = ch),
		false);
$$;

alter function app.can_write_channel(uuid) owner to postgres;

comment on function app.can_write_channel(uuid) is
	'CRM-012 — docs/SPEC-permissions-rls.md §3.3. Droit d''écriture effectif sur le channel. '
	'Gouvernera l''écriture des tables filles à partir de CRM-040.';

-- =============================================================================================
-- 4. Privilèges d'exécution
-- =============================================================================================
-- Même règle qu'à `CRM-010` : `EXECUTE` est accordé à `anon` **et** à `authenticated`. Une
-- politique RLS est évaluée avec les droits du rôle courant, et un appelant anonyme dépourvu
-- d'`EXECUTE` recevrait une **erreur de privilège** là où le comportement spécifié est **zéro
-- ligne** (docs/SPEC-permissions-rls.md §7, dernier paragraphe).
--
-- Le droit n'ouvre rien : `auth.uid()` étant nul sans jeton, `app.workspace_role` rend `NULL` et
-- `app.resolve_access` rend `none` par sa première règle.
--
-- `PUBLIC` reste exclu, et le `revoke` le confirme pour les fonctions créées par
-- `create or replace` sur une base où une version antérieure aurait porté un autre ACL.

revoke all on function app.resolve_track_access(uuid, uuid)          from public;
revoke all on function app.resolve_channel_access(uuid, uuid, uuid)  from public;
revoke all on function app.track_workspace(uuid)   from public;
revoke all on function app.channel_workspace(uuid) from public;
revoke all on function app.can_read_track(uuid)    from public;
revoke all on function app.can_read_channel(uuid)  from public;
revoke all on function app.can_write_channel(uuid) from public;

grant execute on function app.resolve_track_access(uuid, uuid)
	to anon, authenticated, service_role;
grant execute on function app.resolve_channel_access(uuid, uuid, uuid)
	to anon, authenticated, service_role;
grant execute on function app.track_workspace(uuid)   to anon, authenticated, service_role;
grant execute on function app.channel_workspace(uuid) to anon, authenticated, service_role;
grant execute on function app.can_read_track(uuid)    to anon, authenticated, service_role;
grant execute on function app.can_read_channel(uuid)  to anon, authenticated, service_role;
grant execute on function app.can_write_channel(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 5. Resserrement des politiques de lecture de `tracks` et `channels`
-- =============================================================================================
-- docs/SPEC-tracks.md §5.3, docs/SPEC-channels.md §6.3. Les deux politiques gardent leur **nom**
-- alors que leur prédicat change : le nom désigne la règle du produit — « un membre lit » —, non
-- son implémentation. Le renommer casserait les assertions de deux suites pgTAP et les scripts de
-- dégradation de deux harnais, sans rien apprendre à personne.
--
-- Seule la **lecture** change. L'écriture reste `app.is_workspace_admin` : un droit fin ne
-- restreint jamais un administrateur (§2.2, règle 2), et l'organisation reste une prérogative
-- d'administration (§2.1).

drop policy if exists tracks_lecture_membre on public.tracks;
create policy tracks_lecture_membre
	on public.tracks
	for select
	to anon, authenticated
	using (app.resolve_track_access(workspace_id, id) <> 'none');

comment on policy tracks_lecture_membre on public.tracks is
	'CRM-012 — lecture par les membres du workspace, droit fin appliqué. INC-024 close. Le '
	'prédicat emploie les colonnes de la ligne, jamais une relecture de la table : décision 107.';

drop policy if exists channels_lecture_membre on public.channels;
create policy channels_lecture_membre
	on public.channels
	for select
	to anon, authenticated
	using (app.resolve_channel_access(workspace_id, track_id, id) <> 'none');

comment on policy channels_lecture_membre on public.channels is
	'CRM-012 — lecture par les membres du workspace, droit fin appliqué, hérité du track. '
	'INC-030 close. Prédicat sur les colonnes de la ligne : décision 107.';

-- =============================================================================================
-- 6. Politiques des tables de droits fins
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §4.1, docs/JOURNAL.md décision 105. Ces deux tables étaient en
-- refus par défaut depuis `CRM-003` : sans ces politiques, `CRM-012` rendrait les droits fins
-- opposables sans que quiconque puisse en poser un depuis le produit. Aucun chapitre ne les
-- nommait avant cette unité — lacune consignée en INC-045.
--
-- ---------------------------------------------------------------------------------------------
-- 6.1 Lecture : l'administration, et l'intéressé.
-- ---------------------------------------------------------------------------------------------
-- Savoir qui est écarté de quel channel est une donnée d'administration, non un élément de
-- travail partagé. L'intéressé y a droit — une restriction invisible à celui qui la subit est une
-- mauvaise règle — mais un `viewer` n'a pas à connaître les restrictions de ses collègues.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, les deux membres
-- de la disjonction rendent faux, et le refus se manifeste par **zéro ligne** plutôt que par une
-- erreur de privilège.

drop policy if exists track_members_lecture on public.track_members;
create policy track_members_lecture
	on public.track_members
	for select
	to anon, authenticated
	using (
		app.is_workspace_admin(app.track_workspace(track_id))
		or user_id = (select auth.uid())
	);

comment on policy track_members_lecture on public.track_members is
	'CRM-012 — docs/SPEC-permissions-rls.md §4.1. Lecture par l''administrateur du workspace '
	'propriétaire, et par l''intéressé pour sa propre ligne.';

drop policy if exists channel_members_lecture on public.channel_members;
create policy channel_members_lecture
	on public.channel_members
	for select
	to anon, authenticated
	using (
		app.is_workspace_admin(app.channel_workspace(channel_id))
		or user_id = (select auth.uid())
	);

comment on policy channel_members_lecture on public.channel_members is
	'CRM-012 — docs/SPEC-permissions-rls.md §4.1. Même règle que `track_members`.';

-- ---------------------------------------------------------------------------------------------
-- 6.2 Écriture : l'administrateur du workspace, et lui seul.
-- ---------------------------------------------------------------------------------------------
-- `USING` **et** `WITH CHECK` sur l'`UPDATE`, pour le motif déjà mesuré sur `tracks` : sans le
-- second, un administrateur de A pourrait déplacer une ligne vers un track de B, où il n'a aucun
-- droit — le `USING` seul l'aurait laissé passer, la ligne d'origine relevant de son workspace.
--
-- La **suppression est exposée**, contrairement aux tracks et aux channels. Ces tables n'ont pas
-- d'`archived_at`, et retirer un droit fin n'est pas supprimer une donnée métier : c'est revenir
-- à l'accès hérité, l'état par défaut du §2.2. Un archivage obligerait `app.resolve_access` à
-- distinguer « aucune ligne » de « ligne archivée », deux états qu'elle traite — et doit traiter —
-- identiquement. Même raisonnement que la décision 96 pour `form_field_rules`.

drop policy if exists track_members_insertion_admin on public.track_members;
create policy track_members_insertion_admin
	on public.track_members
	for insert
	to authenticated
	with check (app.is_workspace_admin(app.track_workspace(track_id)));

drop policy if exists track_members_maj_admin on public.track_members;
create policy track_members_maj_admin
	on public.track_members
	for update
	to authenticated
	using      (app.is_workspace_admin(app.track_workspace(track_id)))
	with check (app.is_workspace_admin(app.track_workspace(track_id)));

drop policy if exists track_members_suppression_admin on public.track_members;
create policy track_members_suppression_admin
	on public.track_members
	for delete
	to authenticated
	using (app.is_workspace_admin(app.track_workspace(track_id)));

drop policy if exists channel_members_insertion_admin on public.channel_members;
create policy channel_members_insertion_admin
	on public.channel_members
	for insert
	to authenticated
	with check (app.is_workspace_admin(app.channel_workspace(channel_id)));

drop policy if exists channel_members_maj_admin on public.channel_members;
create policy channel_members_maj_admin
	on public.channel_members
	for update
	to authenticated
	using      (app.is_workspace_admin(app.channel_workspace(channel_id)))
	with check (app.is_workspace_admin(app.channel_workspace(channel_id)));

drop policy if exists channel_members_suppression_admin on public.channel_members;
create policy channel_members_suppression_admin
	on public.channel_members
	for delete
	to authenticated
	using (app.is_workspace_admin(app.channel_workspace(channel_id)));

comment on policy track_members_insertion_admin on public.track_members is
	'CRM-012 — création d''un droit fin réservée aux administrateurs du workspace.';
comment on policy track_members_maj_admin on public.track_members is
	'CRM-012 — modification réservée aux administrateurs. WITH CHECK interdit le déplacement '
	'vers un track d''un autre workspace.';
comment on policy track_members_suppression_admin on public.track_members is
	'CRM-012 — suppression réservée aux administrateurs. Elle est exposée : retirer un droit fin '
	'est le retour à l''accès hérité, non la suppression d''une donnée métier.';
comment on policy channel_members_insertion_admin on public.channel_members is
	'CRM-012 — création d''un droit fin réservée aux administrateurs du workspace.';
comment on policy channel_members_maj_admin on public.channel_members is
	'CRM-012 — modification réservée aux administrateurs, WITH CHECK compris.';
comment on policy channel_members_suppression_admin on public.channel_members is
	'CRM-012 — suppression réservée aux administrateurs, et exposée à dessein.';

-- =============================================================================================
-- 7. Privilèges de table
-- =============================================================================================
-- `CRM-003` les a déjà posés — `select` à `anon` et `authenticated`, `insert, update, delete` à
-- `authenticated`, tout à `service_role`. Ils sont **réaffirmés** ici plutôt que supposés : cette
-- migration est la première à leur donner un effet, et une preuve d'autorisation qui reposerait
-- sur un privilège posé trois migrations plus tôt serait fragile au réordonnancement.
--
-- `DELETE` est accordé à `authenticated` **et** gouverné par une politique : le refus opposé à un
-- non-administrateur vient donc de la politique, pas du privilège. C'est délibéré — sur `tracks`,
-- le refus est double et se manifeste dès le privilège ; ici, la suppression est un geste légitime
-- du produit, et seul l'appelant doit être filtré.

revoke all on public.track_members   from anon, authenticated;
grant select                 on public.track_members to anon, authenticated;
grant insert, update, delete on public.track_members to authenticated;
grant all privileges         on public.track_members to service_role;

revoke all on public.channel_members from anon, authenticated;
grant select                 on public.channel_members to anon, authenticated;
grant insert, update, delete on public.channel_members to authenticated;
grant all privileges         on public.channel_members to service_role;

-- PostgREST met son schéma en cache : sans ce signal, les privilèges modifiés ne sont pas repris.
notify pgrst, 'reload schema';

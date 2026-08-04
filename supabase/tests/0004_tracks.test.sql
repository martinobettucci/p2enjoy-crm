-- @verifies CRM-020 (docs/BACKLOG.md) — tracks : structure, ordre, archivage, politiques
-- @verifies docs/SPEC-tracks.md §2 (modèle), §3 (ordre), §4 (archivage), §5 (autorisations)
-- @verifies docs/SCHEMA.md §2 (organisation), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et n° 11)
-- @verifies docs/DESIGN_SYSTEM.md §1 (couleurs de données : un nom de jeton)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-010 (clé étrangère rétablie), INC-024 (droits fins)
--
-- Suite pgTAP de l'unité `CRM-020`. Elle prouve cinq choses :
--
--   1. la **structure** : colonnes, types, contraintes, index, unicité par workspace ;
--   2. l'**ordre** : `position` attribuée par le trigger, par workspace, sans écraser une valeur
--      fournie, et `null` refusé explicitement ;
--   3. l'**archivage** : réversible, et sans suppression physique exposée ;
--   4. les **autorisations**, éprouvées contre des comptes réels avec les revendications JWT
--      simulées exactement comme PostgREST les pose — les trois rôles, l'anonyme, et un membre
--      d'un **autre** workspace ;
--   5. l'**écart de droit fin**, figé par une assertion : un `track_members` restrictif ne masque
--      rien encore (INC-024), et cette suite deviendra rouge lorsque `CRM-012` le corrigera.
--
-- Exécution : `npm run test:sql`, `scripts/verify-tracks.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0004_tracks.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes, ni les workspaces de test ne subsistent.

begin;

create extension if not exists pgtap with schema extensions;

select plan(78);

-- =============================================================================================
-- 1. Structure — docs/SCHEMA.md §2, docs/SPEC-tracks.md §2.1
-- =============================================================================================

select has_table('public', 'tracks', 'la table `public.tracks` existe');

select has_column('public', 'tracks', 'id',           '`tracks.id` existe');
select has_column('public', 'tracks', 'workspace_id', '`tracks.workspace_id` existe');
select has_column('public', 'tracks', 'name',         '`tracks.name` existe');
select has_column('public', 'tracks', 'slug',         '`tracks.slug` existe');
select has_column('public', 'tracks', 'description',  '`tracks.description` existe');
select has_column('public', 'tracks', 'color',        '`tracks.color` existe');
select has_column('public', 'tracks', 'icon',         '`tracks.icon` existe');
select has_column('public', 'tracks', 'position',     '`tracks.position` existe');
select has_column('public', 'tracks', 'archived_at',  '`tracks.archived_at` existe');

-- INC-025 : `docs/SCHEMA.md` §2 omettait ces deux colonnes, que ses « Conventions générales »
-- exigent de toute table. Elles sont livrées, et le tableau du §2 est corrigé.
select has_column('public', 'tracks', 'created_at',
	'INC-025 : `tracks.created_at` existe, conformément aux conventions générales');
select has_column('public', 'tracks', 'updated_at',
	'INC-025 : `tracks.updated_at` existe, conformément aux conventions générales');

select col_type_is('public', 'tracks', 'id',          'uuid',        '`id` est un uuid');
select col_type_is('public', 'tracks', 'position',    'numeric',
	'`position` est `numeric` : index fractionnaire, comme `cards.position`');
select col_type_is('public', 'tracks', 'archived_at', 'timestamp with time zone',
	'`archived_at` est un `timestamptz`');

select col_is_pk('public', 'tracks', 'id', '`id` est la clé primaire');
select col_not_null('public', 'tracks', 'workspace_id', '`workspace_id` est non nul');
select col_not_null('public', 'tracks', 'name',         '`name` est non nul');
select col_not_null('public', 'tracks', 'slug',         '`slug` est non nul');
select col_not_null('public', 'tracks', 'color',        '`color` est non nul');
select col_not_null('public', 'tracks', 'icon',         '`icon` est non nul');
select col_not_null('public', 'tracks', 'position',
	'`position` est non nul — le trigger la renseigne, un client ne peut pas y écrire null');
select col_is_null('public', 'tracks', 'archived_at',
	'`archived_at` est nullable : son absence signifie « actif »');

select col_default_is('public', 'tracks', 'color', 'neutral',
	'le défaut de `color` est `neutral`, pas `brand` — le bleu est réservé au track actif');
select col_default_is('public', 'tracks', 'icon', 'folder',
	'le défaut de `icon` est `folder`');

select fk_ok('public', 'tracks', 'workspace_id', 'public', 'workspaces', 'id',
	'`tracks.workspace_id` référence `workspaces.id`');

select col_is_unique('public', 'tracks', array['workspace_id', 'slug'],
	'`(workspace_id, slug)` est unique : un slug est unique **par workspace**, pas globalement');

select has_index('public', 'tracks', 'tracks_workspace_position_idx',
	'l''index partiel de la barre latérale existe');

select has_trigger('public', 'tracks', 'tracks_set_updated_at',
	'`updated_at` est maintenue par un trigger');
select has_trigger('public', 'tracks', 'tracks_attribuer_position',
	'`position` est attribuée par un trigger');

-- =============================================================================================
-- 2. INC-010 : la clé étrangère différée par `CRM-003` est rétablie
-- =============================================================================================
-- `track_members.track_id` ne pouvait pas référencer `tracks` avant que la table n'existe. La
-- suite `0001` **constatait** cette absence ; celle-ci constate son rétablissement.

select fk_ok('public', 'track_members', 'track_id', 'public', 'tracks', 'id',
	'INC-010 : `track_members.track_id` référence désormais `tracks.id`');

select is(
	(select c.confdeltype from pg_constraint c
	  where c.conname = 'track_members_track_id_fkey'
	    and c.conrelid = 'public.track_members'::regclass),
	'c'::"char",
	'la clé étrangère est en `ON DELETE CASCADE` : un droit fin n''a pas de sens sans son track'
);

-- =============================================================================================
-- 3. Contraintes de valeur — docs/DESIGN_SYSTEM.md §1, docs/SPEC-tracks.md §2.2 et §2.4
-- =============================================================================================

create temporary table zz_ws (id uuid) on commit drop;
insert into public.workspaces (id, name, slug)
	values ('11110000-0000-4000-8000-000000000001', 'Atelier A', 'atelier-a'),
	       ('11110000-0000-4000-8000-000000000002', 'Atelier B', 'atelier-b');

-- Les cinq jetons du design system sont acceptés, et eux seuls.
select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, color, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Jeton brand', 'jeton-brand', 'brand', 100)$$,
	'`color = brand` est accepté');
select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, color, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Jeton neutre', 'jeton-neutre', 'neutral', 101)$$,
	'`color = neutral` est accepté');

-- La règle du design system — « jamais d'hexadécimal libre » — est opposable **en base**, où un
-- appel direct à l'API ne peut pas la contourner.
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, color, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Hexa', 'hexa', '#23468C', 102)$$,
	'23514',
	null,
	'docs/DESIGN_SYSTEM.md §1 : un hexadécimal est refusé par la contrainte `CHECK`');
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, color, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Inconnue', 'inconnue', 'turquoise', 103)$$,
	'23514',
	null,
	'un jeton qui n''existe pas dans le design system est refusé');

-- `slug` : forme d'identifiant d'URL.
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Majuscules', 'Conseil-IA', 104)$$,
	'23514', null, 'un slug en majuscules est refusé');
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Tirets', 'conseil--ia', 105)$$,
	'23514', null, 'un slug à tirets doublés est refusé');
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Vide', '', 106)$$,
	'23514', null, 'un slug vide est refusé');

-- `name` : un nom fait de blancs n'est pas un nom. `not null` seul ne l'aurait pas attrapé.
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', '   ', 'nom-blanc', 107)$$,
	'23514', null, 'un nom réduit à des blancs est refusé');

-- `icon` : la contrainte porte sur la forme, pas sur l'existence (décision 54).
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, icon, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Icône', 'icone-majuscule', 'GraduationCap', 108)$$,
	'23514', null, 'un nom d''icône hors kebab-case est refusé');
select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, icon, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Icône inexistante', 'icone-inexistante',
	          'cette-icone-nexiste-pas', 109)$$,
	'un nom d''icône bien formé mais inexistant est accepté : l''existence est traitée par '
	'l''interface, avec un repli documenté (docs/SPEC-tracks.md §2.4)');

-- Unicité **par workspace**, et non globale.
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Doublon', 'jeton-brand', 110)$$,
	'23505', null, 'le même slug deux fois dans le même workspace est refusé');
select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000002', 'Homonyme', 'jeton-brand', 110)$$,
	'le même slug dans un **autre** workspace est accepté');

-- =============================================================================================
-- 4. Ordre — docs/SPEC-tracks.md §3
-- =============================================================================================
-- Le trigger `BEFORE INSERT` renseigne `position` lorsqu'elle est omise. C'est la mesure qui a
-- décidé de la conception (docs/JOURNAL.md, décision 52) : une colonne `NOT NULL` sans défaut de
-- colonne reste renseignable par un trigger, ce qui interdit à un client d'y écrire `null` tout
-- en lui permettant de l'omettre.

create temporary table zz_ordre (id uuid, ordre numeric) on commit drop;

insert into public.tracks (workspace_id, name, slug)
	values ('11110000-0000-4000-8000-000000000002', 'Premier', 'ordre-premier');
insert into public.tracks (workspace_id, name, slug)
	values ('11110000-0000-4000-8000-000000000002', 'Deuxième', 'ordre-deuxieme');

select is(
	(select t.position from public.tracks t where t.slug = 'ordre-premier'
	  and t.workspace_id = '11110000-0000-4000-8000-000000000002'),
	111::numeric,
	'`position` omise reprend après le maximum du workspace (110 posé plus haut)'
);
select is(
	(select t.position from public.tracks t where t.slug = 'ordre-deuxieme'
	  and t.workspace_id = '11110000-0000-4000-8000-000000000002'),
	112::numeric,
	'la seconde insertion sans `position` suit la première'
);

-- Le trigger n'écrase jamais une valeur fournie : réordonner reste possible.
insert into public.tracks (workspace_id, name, slug, position)
	values ('11110000-0000-4000-8000-000000000002', 'Intercalé', 'ordre-intercale', 111.5);
select is(
	(select t.position from public.tracks t where t.slug = 'ordre-intercale'),
	111.5::numeric,
	'une `position` fournie est conservée telle quelle, y compris fractionnaire'
);

-- L'index fractionnaire tient sa promesse : intercaler ne renumérote rien.
select is(
	(select string_agg(t.slug, ',' order by t.position)
	   from public.tracks t
	  where t.workspace_id = '11110000-0000-4000-8000-000000000002'
	    and t.slug like 'ordre-%'),
	'ordre-premier,ordre-intercale,ordre-deuxieme',
	'l''ordre résultant place bien le track intercalé entre les deux autres'
);

-- Le compteur est propre à chaque workspace : l'ordre d'un workspace ne dépend pas de l'activité
-- d'un autre.
insert into public.tracks (workspace_id, name, slug)
	values ('11110000-0000-4000-8000-000000000001', 'Suite A', 'ordre-suite-a');
select is(
	(select t.position from public.tracks t where t.slug = 'ordre-suite-a'),
	110::numeric,
	'le compteur de `position` est propre au workspace, il n''est pas global'
);

-- MESURE QUI A CORRIGÉ LA SPÉCIFICATION. `docs/SPEC-tracks.md` §3 affirmait d'abord qu'écrire
-- `null` explicitement resterait refusé. C'est FAUX, et la première exécution de cette suite l'a
-- établi : un trigger `BEFORE INSERT` reçoit `new.position` à `null` dans les deux cas, et ne peut
-- pas distinguer l'omission de la négation. Les deux écritures sont donc équivalentes.
-- La spécification a été corrigée sur ce point plutôt que l'assertion ajustée.
insert into public.tracks (workspace_id, name, slug, position)
	values ('11110000-0000-4000-8000-000000000001', 'Nulle', 'ordre-nul', null);
select is(
	(select t.position from public.tracks t where t.slug = 'ordre-nul'),
	111::numeric,
	'un `null` explicite à l''insertion est traité comme une omission : le trigger le remplace, '
	'car il ne peut pas les distinguer');

-- La protection subsiste après la création : le trigger étant `BEFORE INSERT`, une mise à jour
-- vers `null` se heurte bien à la contrainte `NOT NULL`.
select throws_ok(
	$$update public.tracks set position = null where slug = 'ordre-nul'$$,
	'23502', null,
	'une mise à jour vers `null` est refusée : le trigger ne couvre que l''insertion');

-- =============================================================================================
-- 5. Archivage — docs/SPEC-tracks.md §4
-- =============================================================================================

update public.tracks set archived_at = now() where slug = 'ordre-premier';
select is(
	(select count(*)::int from public.tracks t
	  where t.workspace_id = '11110000-0000-4000-8000-000000000002'
	    and t.slug like 'ordre-%' and t.archived_at is null),
	2,
	'un track archivé sort de la liste des tracks actifs');

update public.tracks set archived_at = null where slug = 'ordre-premier';
select is(
	(select count(*)::int from public.tracks t
	  where t.workspace_id = '11110000-0000-4000-8000-000000000002'
	    and t.slug like 'ordre-%' and t.archived_at is null),
	3,
	'l''archivage est réversible : c''est une suppression douce, pas une suppression');

-- `updated_at` est réellement reprise en main par le trigger, et non laissée au client.
--
-- MESURE QUI A CORRIGÉ CETTE ASSERTION. La formulation initiale — `updated_at > created_at` —
-- ne pouvait pas passer : `now()` rend l'**heure de transaction**, constante dans toute la suite,
-- et une comparaison `>=` aurait été vraie sans rien prouver. Ce qui se prouve à l'intérieur
-- d'une transaction, c'est que le trigger **écrase** la valeur écrite par le client.
update public.tracks set updated_at = '2000-01-01T00:00:00Z' where slug = 'ordre-premier';
select ok(
	(select t.updated_at from public.tracks t where t.slug = 'ordre-premier') > '2020-01-01'::timestamptz,
	'`app.set_updated_at()` écrase la valeur fournie par le client : `updated_at` est tenue par '
	'le serveur, pas par l''appelant');

-- =============================================================================================
-- 6. Refus par défaut et politiques — docs/SPEC-permissions-rls.md §4
-- =============================================================================================

select is(
	(select c.relrowsecurity from pg_class c
	  join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public' and c.relname = 'tracks'),
	true,
	'RLS est activée sur `tracks`');

select policies_are('public', 'tracks',
	array['tracks_lecture_membre', 'tracks_insertion_admin', 'tracks_maj_admin'],
	'exactement trois politiques : lecture, insertion, mise à jour');

-- L'absence de politique de suppression n'est pas un oubli : c'est la traduction de « la
-- suppression physique est réservée aux purges RGPD » (docs/SCHEMA.md).
select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'tracks' and cmd = 'DELETE'),
	0,
	'aucune politique de suppression : la suppression du produit est l''archivage');

select is(
	(select p.cmd from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'tracks'
	    and p.policyname = 'tracks_lecture_membre'),
	'SELECT', 'la politique de lecture porte bien sur `SELECT`');

-- `WITH CHECK` sur l'`UPDATE` n'est pas une redondance : sans lui, un administrateur du workspace
-- A déplacerait un track vers le workspace B, la ligne d'origine lui appartenant (décision 52).
select isnt(
	(select p.with_check from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'tracks'
	    and p.policyname = 'tracks_maj_admin'),
	null,
	'la politique de mise à jour porte un `WITH CHECK`, sans quoi un track pourrait changer '
	'de workspace');

-- Privilèges : lire est possible pour tous — le refus se manifeste par zéro ligne —, écrire non,
-- et supprimer n'est accordé à personne.
select table_privs_are('public', 'tracks', 'anon', array['SELECT'],
	'`anon` n''a que `SELECT` : un refus de lecture est zéro ligne, pas une erreur de privilège');
select table_privs_are('public', 'tracks', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
	'`authenticated` n''a ni `DELETE` ni `TRUNCATE` : la suppression physique n''est pas exposée');

-- =============================================================================================
-- 7. Autorisations éprouvées contre des comptes réels
-- =============================================================================================
-- Les revendications JWT sont simulées **exactement** comme PostgREST les pose : `request.jwt.
-- claims` en réglage local, et le rôle applicatif endossé par `set local role`. C'est le même
-- procédé que la suite `0002` de `CRM-010`.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
	values
		('22220000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
		 'authenticated', 'authenticated', 'admin-a@exemple.test', '{"full_name": "Admin A"}'),
		('22220000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
		 'authenticated', 'authenticated', 'viewer-a@exemple.test', '{"full_name": "Viewer A"}'),
		('22220000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
		 'authenticated', 'authenticated', 'admin-b@exemple.test', '{"full_name": "Admin B"}');

insert into public.workspace_members (workspace_id, user_id, role) values
	('11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-00000000000a', 'admin'),
	('11110000-0000-4000-8000-000000000001', '22220000-0000-4000-8000-00000000000b', 'viewer'),
	('11110000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-00000000000c', 'admin');

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

-- --- 7.1 Lecture ------------------------------------------------------------------------------

savepoint avant_roles;

select pg_temp.endosser('22220000-0000-4000-8000-00000000000a');
select ok(
	(select count(*) from public.tracks) > 0,
	'un administrateur du workspace A lit les tracks de A');
select is(
	(select count(*)::int from public.tracks t
	  where t.workspace_id = '11110000-0000-4000-8000-000000000002'),
	0,
	'PREUVE DE REFUS N° 3 : le membre du workspace A ne voit aucun track du workspace B');
reset role;
rollback to savepoint avant_roles;

savepoint avant_viewer;
select pg_temp.endosser('22220000-0000-4000-8000-00000000000b');
select ok(
	(select count(*) from public.tracks) > 0,
	'un `viewer` lit les tracks de son workspace : lire n''exige pas d''écrire');
reset role;
rollback to savepoint avant_viewer;

savepoint avant_anon;
select pg_temp.anonyme();
select is(
	(select count(*)::int from public.tracks),
	0,
	'PREUVE DE REFUS N° 11 : un appelant anonyme ne lit aucun track, alors que la table en '
	'contient — et il obtient zéro ligne, pas une erreur');
reset role;
rollback to savepoint avant_anon;

-- --- 7.2 Écriture -----------------------------------------------------------------------------

savepoint avant_ecriture;
select pg_temp.endosser('22220000-0000-4000-8000-00000000000b');
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Par un viewer', 'par-viewer', 200)$$,
	'42501', null,
	'un `viewer` ne crée aucun track : l''organisation est une prérogative d''administration');
reset role;
rollback to savepoint avant_ecriture;

savepoint avant_admin;
select pg_temp.endosser('22220000-0000-4000-8000-00000000000a');
select lives_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000001', 'Par un admin', 'par-admin', 201)$$,
	'un administrateur crée un track dans son workspace');
select throws_ok(
	$$insert into public.tracks (workspace_id, name, slug, position)
	  values ('11110000-0000-4000-8000-000000000002', 'Intrusion', 'intrusion', 202)$$,
	'42501', null,
	'un administrateur du workspace A ne crée aucun track dans le workspace B');
select throws_ok(
	$$update public.tracks set workspace_id = '11110000-0000-4000-8000-000000000002'
	   where slug = 'par-admin'$$,
	'42501', null,
	'le `WITH CHECK` interdit de **déplacer** un track vers un workspace où l''appelant n''est '
	'pas administrateur');
select lives_ok(
	$$update public.tracks set archived_at = now() where slug = 'par-admin'$$,
	'un administrateur archive son propre track');
select throws_ok(
	$$delete from public.tracks where slug = 'par-admin'$$,
	'42501', null,
	'la suppression physique est refusée même à un administrateur : le privilège n''est accordé '
	'à personne');
reset role;
rollback to savepoint avant_admin;

-- --- 7.3 Les droits ne sont pas portés par le jeton -------------------------------------------
-- Même procédé que `CRM-010` : l'appartenance retirée, le même appelant cesse immédiatement de
-- lire, sans qu'aucun jeton n'ait expiré.

savepoint avant_revocation;
delete from public.workspace_members
 where user_id = '22220000-0000-4000-8000-00000000000b';
select pg_temp.endosser('22220000-0000-4000-8000-00000000000b');
select is(
	(select count(*)::int from public.tracks),
	0,
	'l''appartenance retirée, le même appelant ne lit plus aucun track — les droits ne sont pas '
	'portés par le jeton');
reset role;
rollback to savepoint avant_revocation;

-- =============================================================================================
-- 8. INC-024 — l'écart de droit fin, figé par une assertion
-- =============================================================================================
-- LIMITE FIGÉE PAR UNE ASSERTION, ET NON PAR UN COMMENTAIRE (docs/JOURNAL.md, décision 51).
--
-- `docs/SPEC-permissions-rls.md` §4 prescrit `app.can_read_track`, différée par INC-013. La
-- politique livrée s'arrête au rôle de workspace : un `track_members.access = 'none'` ne masque
-- donc rien encore.
--
-- Les deux assertions ci-dessous **constatent** cet état. Le jour où `CRM-012` resserrera la
-- politique, elles deviendront rouges et forceront leur révision, au lieu de laisser la limite
-- survivre à sa cause.

savepoint avant_droit_fin;

insert into public.track_members (track_id, user_id, access)
	select t.id, '22220000-0000-4000-8000-00000000000b', 'none'
	  from public.tracks t where t.slug = 'jeton-brand';

select pg_temp.endosser('22220000-0000-4000-8000-00000000000b');
select is(
	(select count(*)::int from public.tracks t where t.slug = 'jeton-brand'),
	1,
	'INC-024 : un `track_members.access = ''none''` ne masque PAS encore le track — la politique '
	'de CRM-020 s''arrête au rôle de workspace. Cette assertion doit devenir rouge à CRM-012');
reset role;

select hasnt_function('app', 'can_read_track', array['uuid'],
	'INC-013 : `app.can_read_track` n''est toujours pas livrée — son arbitrage reste ouvert, et '
	'CRM-020 ne le tranche pas à la place du responsable');

rollback to savepoint avant_droit_fin;

-- =============================================================================================
-- 9. Le seed est conforme au contrat — docs/SPEC-tracks.md §8
-- =============================================================================================
-- La suite s'exécute sur la base de développement, où le seed est appliqué. Ces assertions
-- valent donc contrat opposable, comme celles de `0003_seed_socle.test.sql`.

select is(
	(select count(*)::int from public.tracks t
	  where t.workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	4,
	'le seed pose quatre tracks dans le workspace de démonstration');

select is(
	(select count(*)::int from public.tracks t
	  where t.workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and t.archived_at is not null),
	1,
	'l''un d''eux est archivé : l''état « archivé » est démontrable, pas seulement documenté');

select is(
	(select string_agg(t.slug, ',' order by t.position)
	   from public.tracks t
	  where t.workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and t.archived_at is null),
	'conseil-ia,studio-web,formation',
	'les tracks actifs du seed sortent dans l''ordre de leur `position`');

select is(
	(select count(distinct t.color)::int from public.tracks t
	  where t.workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	4,
	'le seed couvre quatre des cinq jetons de couleur du design system');

select * from finish();

rollback;

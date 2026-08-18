-- @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, première tranche : versions
--            immuables et publication
-- @verifies docs/SPEC-workflow-engine.md §7 ter.2 (empreinte inchangée par l'extraction),
--            §7 ter.3 (modèle), §7 ter.4 (les trois barrières d'immuabilité),
--            §7 ter.5 (le geste et ses cinq refus), §7 ter.6 (autorisations)
-- @verifies docs/SCHEMA.md §3 (workflow_versions), §9 (fonctions et RPC)
-- @verifies docs/SPEC-permissions-rls.md §4 (écriture réservée aux administrateurs)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. Que l'EXTRACTION du document canonique n'a rien changé. C'est la première assertion parce que
--    c'est le seul risque de régression de cette migration : `workflows.source_composition_
--    fingerprint` porte des valeurs figées, et la vue `workflow_derivations` les compare à
--    l'empreinte courante. L'empreinte du workflow PAR DÉFAUT est figée ici en dur : si une écriture
--    future modifie l'ordre des clés ou le tri d'une collection, cette assertion rougit AVANT que
--    toutes les copies du produit ne divergent en silence. Celle du workflow DÉRIVÉ ne peut pas
--    l'être — son identifiant est engendré à la copie et le document le contient —, et elle est
--    éprouvée par sa propriété RELATIVE : la fonction appelante rend exactement le condensé du
--    document extrait (arbitrage de la décision 430, INC-122).
--
-- 2. Que la table refuse l'écriture aux TROIS niveaux annoncés, et notamment que le trigger tient
--    face à `service_role` — la seule des trois barrières qui ait ce pouvoir, et celle sans
--    laquelle « immuable » ne serait qu'un mot.
--
-- 3. Que les cinq refus de la RPC tombent DANS L'ORDRE, avec des comptes réels et les revendications
--    JWT telles que PostgREST les pose. Un refus qui tomberait dans le désordre — par exemple
--    « archivé » avant « réservé aux administrateurs » — divulguerait au non-administrateur l'état
--    d'un workflow qu'il n'a pas le droit d'administrer.
--
-- 4. Que le geste FONCTIONNE. Une suite qui ne prouverait que des refus serait tout aussi verte sur
--    un produit où publier est impossible (même raisonnement qu'au §2 du catalogue, ligne h).
--
-- La suite crée ses fixtures par le propriétaire, joue les gestes avec les comptes réels, et fait
-- `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
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
-- 1. L'extraction du document n'a pas déplacé l'empreinte
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'workflow_composition_document', array['uuid'],
	'1 — `app.workflow_composition_document` existe');

-- EMPREINTE RÉVISÉE PAR LA SOUS-TRANCHE 4d DE `CRM-060` (docs/SPEC-contacts.md §13.6), ET LE MOTIF
-- COMPTE : ce que cette assertion garde est qu'un REFACTOR de l'extraction ne déplace pas
-- l'empreinte. Ici ce n'est pas l'extraction qui a bougé, c'est la COMPOSITION elle-même — le seed
-- pose deux champs de plus —, et une empreinte qui n'aurait pas bougé serait alors le vrai défaut.
-- Nouvelle valeur MESURÉE sur la pile seedée, jamais recopiée d'une exécution de test.
select is(
	app.workflow_composition_fingerprint('5eed0000-0000-4000-8000-000000000051'),
	'5ae889f8427111c0faf96a64edffaf98210deda1a37d5e1ec79b16fa1bb42725',
	'2 — empreinte du workflow par défaut, révisée par la composition et non par l''extraction');

-- RÉVISÉE PAR L'ARBITRAGE DE LA DÉCISION 430, ET NON CONTOURNÉE (INC-122). Cette assertion citait
-- en dur `352d02ac-…` comme identifiant du workflow DÉRIVÉ, et une empreinte constante. Or le seed
-- n'épingle pas cet identifiant : il est engendré par `copy_workflow_to_track` et vaut une autre
-- valeur à chaque base. L'assertion était donc rouge sur toute pile fraîchement seedée.
--
-- Deux corrections, et elles viennent du même raisonnement. Le workflow dérivé se désigne PAR SON
-- NOM, seule de ses propriétés que le seed fixe. Et l'empreinte cesse d'être comparée à une
-- CONSTANTE : ce que cette assertion affirme est une propriété RELATIVE — « l'extraction n'a pas
-- déplacé l'empreinte » —, c'est-à-dire que la fonction appelante rend toujours exactement le
-- condensé du document extrait. Les DEUX états sont donc mesurés et leur égalité exigée, ce qui
-- reste vrai sur n'importe quelle base sans rien perdre du pouvoir d'anti-régression : le jour où
-- quelqu'un modifierait l'un des deux sans l'autre, l'assertion rougirait.
--
-- L'assertion 2, elle, GARDE sa constante : l'identifiant du workflow par défaut est épinglé par le
-- seed, et cette constante est la seule qui protège la FORME même du document — un changement
-- d'ordre de clés déplacerait les deux membres de l'assertion 3 ensemble, et lui échapperait.
select is(
	(select app.workflow_composition_fingerprint(w.id)
	   from public.workflows w where w.name = 'Cycle commercial — Conseil IA'),
	(select pg_catalog.encode(
	          extensions.digest(
	            pg_catalog.convert_to(app.workflow_composition_document(w.id)::text, 'UTF8'),
	            'sha256'),
	          'hex')
	   from public.workflows w where w.name = 'Cycle commercial — Conseil IA'),
	'3 — empreinte du workflow dérivé INCHANGÉE par l''extraction : la fonction rend le condensé du document');

-- Le document porte les six clés du contrat, et rien d'autre : une clé ajoutée ou retirée
-- changerait toutes les empreintes du produit.
select is(
	(select array_agg(k order by k)
	   from jsonb_object_keys(
	          app.workflow_composition_document('5eed0000-0000-4000-8000-000000000051')) as k),
	array['fields', 'required_fields', 'rules', 'steps', 'transitions', 'workflow'],
	'4 — le document canonique porte exactement les six clés du §7 ter.2');

select is(
	app.workflow_composition_document('00000000-0000-4000-8000-000000000000'),
	null::jsonb,
	'5 — un workflow inexistant rend `NULL`, et non un document vide');

-- ---------------------------------------------------------------------------------------------
-- 2. Structure et contraintes
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'workflow_versions', '6 — la table `workflow_versions` existe');

select hasnt_column('public', 'workflow_versions', 'updated_at',
	'7 — AUCUNE colonne `updated_at` : une ligne immuable n''a pas de date de modification');

select col_is_pk('public', 'workflow_versions', 'id', '8 — `id` est la clé primaire');

select col_is_unique('public', 'workflow_versions', array['workflow_id', 'version_number'],
	'9 — le numéro de version est unique DANS LA PORTÉE du workflow, et non globalement');

select is(
	(select count(*)::int from pg_constraint
	  where conrelid = 'public.workflow_versions'::regclass
	    and contype = 'f'
	    and conname = 'workflow_versions_workflow_id_workspace_id_fkey'),
	1,
	'10 — la clé étrangère porte le COUPLE (workflow_id, workspace_id) : aucune version ne se rattache au workflow d''un autre workspace');

-- FIXTURE PROPRE À LA PREUVE : un workflow créé ici, et non un workflow du seed. Le seed publie
-- une version du workflow par défaut (§7 ter.8) ; asseoir les assertions de numérotation sur lui
-- rendrait la suite dépendante de cet état et fausse au premier ajout. Le workflow ci-dessous n'a
-- ni étape ni champ : sa composition est donc six collections vides, ce qui se photographie
-- parfaitement — et c'est exactement le cas limite qu'il faut couvrir.
insert into public.workflows (id, workspace_id, name, scope, is_default)
values ('b0000000-0000-4000-8000-000000000009',
        '5eed0000-0000-4000-8000-000000000001', 'Versionnement — workflow de preuve', 'global', false);

insert into public.workflow_versions
	(id, workspace_id, workflow_id, version_number, composition, composition_fingerprint, note, published_by)
values
	('b0000000-0000-4000-8000-000000000001',
	 '5eed0000-0000-4000-8000-000000000001',
	 'b0000000-0000-4000-8000-000000000009',
	 1,
	 app.workflow_composition_document('b0000000-0000-4000-8000-000000000009'),
	 app.workflow_composition_fingerprint('b0000000-0000-4000-8000-000000000009'),
	 'photographie de preuve',
	 '5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$insert into public.workflow_versions
	    (workspace_id, workflow_id, version_number, composition, composition_fingerprint)
	  values ('5eed0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009',
	          0, '{}'::jsonb, '6b2f5f2adbadd48680d38b8d4bc19a004ff35881df654593e43d2eb4f577e7c8')$$,
	'23514',
	null,
	'11 — un numéro de version nul ou négatif est refusé');

select throws_ok(
	$$insert into public.workflow_versions
	    (workspace_id, workflow_id, version_number, composition, composition_fingerprint)
	  values ('5eed0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009',
	          2, '[]'::jsonb, '6b2f5f2adbadd48680d38b8d4bc19a004ff35881df654593e43d2eb4f577e7c8')$$,
	'23514',
	null,
	'12 — une composition qui n''est pas un OBJET jsonb est refusée');

select throws_ok(
	$$insert into public.workflow_versions
	    (workspace_id, workflow_id, version_number, composition, composition_fingerprint)
	  values ('5eed0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009',
	          2, '{}'::jsonb, 'PAS-UNE-EMPREINTE')$$,
	'23514',
	null,
	'13 — une empreinte hors du motif SHA-256 hexadécimal est refusée');

select throws_ok(
	$$insert into public.workflow_versions
	    (workspace_id, workflow_id, version_number, composition, composition_fingerprint, note)
	  values ('5eed0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009',
	          2, '{}'::jsonb, '6b2f5f2adbadd48680d38b8d4bc19a004ff35881df654593e43d2eb4f577e7c8',
	          '   ')$$,
	'23514',
	null,
	'14 — une note réduite à des blancs est refusée : elle doit être absente ou porter du texte');

select throws_ok(
	$$insert into public.workflow_versions
	    (workspace_id, workflow_id, version_number, composition, composition_fingerprint)
	  values ('5eed0000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009',
	          1, '{}'::jsonb, '6b2f5f2adbadd48680d38b8d4bc19a004ff35881df654593e43d2eb4f577e7c8')$$,
	'23505',
	null,
	'15 — un numéro déjà pris sur ce workflow est refusé');

-- ---------------------------------------------------------------------------------------------
-- 3. Les trois barrières d'immuabilité
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'workflow_versions'),
	1,
	'16 — UNE seule politique : ni mise à jour, ni suppression, ni insertion directe');

select policy_cmd_is('public', 'workflow_versions', 'workflow_versions_lecture_membre', 'SELECT',
	'17 — l''unique politique est une politique de LECTURE');

select table_privs_are('public', 'workflow_versions', 'authenticated', array['SELECT'],
	'18 — `authenticated` n''a que la lecture : le refus d''écriture se manifeste dès le privilège');

select table_privs_are('public', 'workflow_versions', 'anon', array['SELECT'],
	'19 — `anon` n''a que la lecture, filtrée ensuite par la politique');

-- La barrière décisive : elle tient sous `service_role`, à qui le projet accorde `all privileges`
-- partout, et que `mail-sync` porte. Sans elle, « immuable » ne serait qu'un mot.
select has_trigger('public', 'workflow_versions', 'workflow_versions_refuser_mutation',
	'20 — le trigger de refus de mutation est posé');

select throws_ok(
	$$update public.workflow_versions set note = 'reecrit'
	   where id = 'b0000000-0000-4000-8000-000000000001'$$,
	'42501',
	'une version publiee est immuable',
	'21 — la mise à jour est refusée MÊME pour le propriétaire de la base');

select is(
	(select note from public.workflow_versions where id = 'b0000000-0000-4000-8000-000000000001'),
	'photographie de preuve',
	'22 — et la ligne est relue INCHANGÉE : l''absence d''effet est constatée, pas supposée');

-- Le trigger ne porte PAS sur `delete`, et c'est intentionnel : il rendrait la suppression en
-- cascade impossible (mode de défaillance d'INC-039). La cascade doit donc fonctionner.
select lives_ok(
	$$delete from public.workflow_versions where id = 'b0000000-0000-4000-8000-000000000001'$$,
	'23 — la suppression directe par le propriétaire reste possible : le trigger ne porte pas sur `delete`');

-- ---------------------------------------------------------------------------------------------
-- 4. La RPC : ses cinq refus, dans l'ordre, contre des comptes réels
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'publish_workflow_version', array['uuid', 'text'],
	'24 — la RPC `publish_workflow_version` existe');

select function_privs_are('public', 'publish_workflow_version', array['uuid', 'text'], 'anon',
	array[]::text[],
	'25 — `anon` n''a AUCUN droit d''exécution : la révocation nommée a bien été faite (décision 80)');

-- Refus 3 : la publication est réservée aux administrateurs. Joué par Driss, `business_developer`.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok(
	$$select public.publish_workflow_version('b0000000-0000-4000-8000-000000000009')$$,
	'42501',
	'publication reservee aux administrateurs',
	'26 — un `business_developer` ne publie pas : preuve de refus n° 2 au niveau des versions');

-- Refus 2 : un identifiant inexistant. Joué par Camille, administratrice — le refus n'est donc pas
-- celui du rôle.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$select public.publish_workflow_version('00000000-0000-4000-8000-000000000000')$$,
	'P0001',
	'workflow introuvable',
	'27 — un identifiant inexistant rend « workflow introuvable » et non une erreur serveur');

select pg_temp.redevenir_proprietaire();

-- Refus 4 : un workflow archivé. Le dérivé est archivé pour la preuve, puis rendu par le rollback.
-- RÉVISÉE PAR L'ARBITRAGE DE LA DÉCISION 430 (INC-122), par le même geste qu'à l'assertion 3 : le
-- workflow dérivé se désigne PAR SON NOM. Son identifiant est engendré par `copy_workflow_to_track`
-- et le seed ne l'épingle pas — cité en dur, il n'archivait rien et la RPC rendait « workflow
-- introuvable » là où la preuve attendait « workflow archive ».
update public.workflows set archived_at = now()
 where name = 'Cycle commercial — Conseil IA';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	format($$select public.publish_workflow_version(%L)$$,
		(select w.id from public.workflows w where w.name = 'Cycle commercial — Conseil IA')),
	'P0001',
	'workflow archive',
	'28 — un workflow archivé ne se photographie pas');

-- 5. LE GESTE FONCTIONNE. Sans cette assertion, les quatre refus ci-dessus seraient tout aussi
--    verts sur un produit où publier est IMPOSSIBLE.
select is(
	(select version_number from public.publish_workflow_version(
	          'b0000000-0000-4000-8000-000000000009', '  premiere  ')),
	1,
	'29 — l''administratrice publie, et la première version porte le numéro 1');

select is(
	(select note || '|' || (published_by = '5eed0000-0000-4000-8000-000000000011')::text
	   from public.workflow_versions
	  where workflow_id = 'b0000000-0000-4000-8000-000000000009'),
	'premiere|true',
	'30 — la note est `btrim`ée et l''auteur est l''appelant réel, non le propriétaire de la fonction');

-- Refus 5 : republier la même composition. C'est la règle de fond de l'unité.
select throws_ok(
	$$select public.publish_workflow_version('b0000000-0000-4000-8000-000000000009')$$,
	'P0001',
	'composition inchangee',
	'31 — republier une composition identique à la DERNIÈRE version est refusé');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

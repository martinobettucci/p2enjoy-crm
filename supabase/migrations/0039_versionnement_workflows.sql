-- @spec CRM-078 (docs/BACKLOG.md) — versionnement des workflows, première tranche : versions
--       immuables et publication
-- @spec docs/SPEC-workflow-engine.md §7 ter.2 (document canonique et empreinte inchangée),
--       §7 ter.3 (modèle), §7 ter.4 (les trois barrières d'immuabilité),
--       §7 ter.5 (le geste et ses cinq refus), §7 ter.6 (autorisations),
--       §7 ter.7 (contrat d'API), §7 ter.9 (ce qui n'est pas livré)
-- @spec docs/SCHEMA.md §3 (workflow_versions), §9 (fonctions et RPC)
-- @spec docs/SPEC-permissions-rls.md §4 (écriture réservée aux administrateurs),
--       §7 (preuves de refus n° 3 et n° 11)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- Un workflow est une structure VIVANTE : l'éditeur de `CRM-076` en change les étapes, les arêtes,
-- les champs et les règles à tout moment, et rien ne garde trace de ce qu'il était hier. Une
-- affaire qui a circulé sous un graphe donné devient donc illisible dès que ce graphe change.
--
-- Livré ici : la photographie. `public.workflow_versions` conserve, à la demande d'un
-- administrateur, une composition figée, numérotée, datée et attribuée ;
-- `public.publish_workflow_version` est le SEUL chemin qui l'écrit.
--
-- Non livré, et nommé (docs/SPEC-workflow-engine.md §7 ter.9) : la comparaison de deux versions, le
-- plan de remappage des cards, son application transactionnelle et son retour arrière, et tout
-- écran. Publier une version NE CHANGE RIEN au comportement du produit : `move_card` ne consulte
-- aucune version, et les cards continuent de circuler sur la structure vivante. Une version est un
-- TÉMOIN, pas une cible d'exécution.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LE DOCUMENT CANONIQUE EST EXTRAIT, ET CE QUE CETTE EXTRACTION NE DOIT PAS CHANGER.
-- ---------------------------------------------------------------------------------------------
-- `CRM-032` a livré `app.workflow_composition_fingerprint`, qui construit un document `jsonb`
-- canonique et n'en rend que l'empreinte SHA-256 : le document lui-même était JETÉ. Le
-- versionnement a besoin des deux. Le document est donc extrait dans
-- `app.workflow_composition_document`, et l'empreinte devient son appelant — la forme canonique
-- n'a plus qu'une seule définition, au lieu de deux qui dériveraient l'une de l'autre.
--
-- EXIGENCE NON NÉGOCIABLE : l'empreinte rendue doit rester IDENTIQUE, caractère pour caractère.
-- `workflows.source_composition_fingerprint` porte des valeurs figées par la copie, et la vue
-- `public.workflow_derivations` compare l'empreinte courante à ces valeurs. Un changement d'ordre
-- de clés ou de tri ferait diverger toutes les copies existantes sans qu'aucune n'ait bougé. Le
-- corps du `jsonb_build_object` est donc REPRIS SANS UNE VIRGULE DE DIFFÉRENCE, et deux assertions
-- pgTAP figent les empreintes des deux workflows du seed.
--
-- ---------------------------------------------------------------------------------------------
-- IDEMPOTENCE ET CONVERGENCE : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). Chaque objet est donc créé avec
-- `if not exists`, `create or replace`, ou précédé de son `drop … if exists` ; et les contraintes,
-- politiques et privilèges sont RÉAFFIRMÉS à chaque passage, de sorte qu'une contrainte retirée à
-- la main soit RÉTABLIE par un rejeu (décision 57) et non simplement laissée en l'état.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Le document canonique de composition, extrait de l'empreinte
-- ---------------------------------------------------------------------------------------------
-- `stable` et non `immutable` : le document dépend de lignes qui changent. `search_path` vide et
-- qualification complète de chaque objet, convention du projet pour toute fonction du schéma `app`.

create or replace function app.workflow_composition_document(target_workflow_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
	select pg_catalog.jsonb_build_object(
		'workflow', pg_catalog.jsonb_build_object(
			'id', w.id,
			'name', w.name,
			'scope', w.scope,
			'track_id', w.track_id,
			'is_default', w.is_default,
			'archived_at', w.archived_at
		),
		'steps', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', s.id,
					'node_id', s.node_id,
					'node_key', n.key,
					'node_label', n.label,
					'node_kind', n.kind,
					'node_color', n.color,
					'node_default_probability', n.default_probability,
					'node_default_stale_after_days', n.default_stale_after_days,
					'node_archived_at', n.archived_at,
					'position', s.position,
					'label_override', s.label_override,
					'probability_override', s.probability_override,
					'stale_after_days', s.stale_after_days,
					'is_initial', s.is_initial
				) order by s.id
			)
			  from public.workflow_steps s
			  join public.workflow_nodes_catalog n on n.id = s.node_id
			 where s.workflow_id = w.id
		), '[]'::jsonb),
		'transitions', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', t.id,
					'from_step_id', t.from_step_id,
					'to_step_id', t.to_step_id,
					'label', t.label,
					'require_comment', t.require_comment
				) order by t.id
			)
			  from public.workflow_transitions t
			 where t.workflow_id = w.id
		), '[]'::jsonb),
		'fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'id', f.id,
					'key', f.key,
					'label', f.label,
					'type', f.type,
					'options', f.options,
					'help_text', f.help_text,
					'position', f.position,
					'archived_at', f.archived_at
				) order by f.id
			)
			  from public.form_fields f
			 where f.workflow_id = w.id
		), '[]'::jsonb),
		'rules', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'field_id', r.field_id,
					'step_id', r.step_id,
					'visibility', r.visibility
				) order by r.field_id, r.step_id
			)
			  from public.form_field_rules r
			 where r.workflow_id = w.id
		), '[]'::jsonb),
		'required_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'transition_id', rf.transition_id,
					'field_id', rf.field_id
				) order by rf.transition_id, rf.field_id
			)
			  from public.workflow_transition_required_fields rf
			  join public.workflow_transitions t on t.id = rf.transition_id
			 where t.workflow_id = w.id
		), '[]'::jsonb)
	)
	  from public.workflows w
	 where w.id = target_workflow_id;
$$;

comment on function app.workflow_composition_document(uuid) is
	'Document jsonb canonique de la composition d''un workflow — six clés, chaque collection triée '
	'par identifiant. Source unique de la forme canonique : app.workflow_composition_fingerprint '
	'n''en est que le condensé. CRM-078, docs/SPEC-workflow-engine.md §7 ter.2.';

revoke all on function app.workflow_composition_document(uuid) from public;
grant execute on function app.workflow_composition_document(uuid) to anon, authenticated, service_role;

-- L'empreinte devient l'appelant du document. Le corps était strictement celui ci-dessus : la
-- valeur rendue est donc inchangée, ce que deux assertions pgTAP figent sur le seed.
create or replace function app.workflow_composition_fingerprint(target_workflow_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
	select pg_catalog.encode(
		extensions.digest(
			pg_catalog.convert_to(
				app.workflow_composition_document(target_workflow_id)::text,
				'UTF8'
			),
			'sha256'
		),
		'hex'
	)
	 where app.workflow_composition_document(target_workflow_id) is not null;
$$;

comment on function app.workflow_composition_fingerprint(uuid) is
	'Empreinte SHA-256 du document canonique de composition. Condensé de '
	'app.workflow_composition_document, dont elle ne redéfinit plus la forme. CRM-032, révisée par '
	'CRM-078.';

revoke all on function app.workflow_composition_fingerprint(uuid) from public;
grant execute on function app.workflow_composition_fingerprint(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. La table des versions
-- ---------------------------------------------------------------------------------------------
-- Aucune colonne `updated_at`, et c'est intentionnel : une ligne immuable n'a pas de date de
-- modification, et en poser une laisserait croire que la mise à jour existe.
--
-- La clé étrangère porte le COUPLE (workflow_id, workspace_id) et non le seul workflow_id, comme
-- toutes les tables filles du projet : elle interdit qu'une version soit rattachée au workflow d'un
-- autre workspace, ce qu'une clé simple laisserait passer.

create table if not exists public.workflow_versions (
	id                      uuid        primary key default gen_random_uuid(),
	workspace_id            uuid        not null,
	workflow_id             uuid        not null,
	version_number          integer     not null,
	composition             jsonb       not null,
	composition_fingerprint text        not null,
	note                    text,
	published_by            uuid        references public.profiles (id) on delete set null,
	published_at            timestamptz not null default now()
);

-- Contraintes réaffirmées à chaque passage : une contrainte retirée à la main est RÉTABLIE par un
-- rejeu, et non seulement absente sans erreur (décision 57).
alter table public.workflow_versions
	drop constraint if exists workflow_versions_workspace_id_fkey,
	drop constraint if exists workflow_versions_workflow_id_workspace_id_fkey,
	drop constraint if exists workflow_versions_number_check,
	drop constraint if exists workflow_versions_composition_check,
	drop constraint if exists workflow_versions_fingerprint_check,
	drop constraint if exists workflow_versions_note_check,
	drop constraint if exists workflow_versions_workflow_id_version_number_key;

alter table public.workflow_versions
	add constraint workflow_versions_workspace_id_fkey
		foreign key (workspace_id) references public.workspaces (id) on delete cascade,
	add constraint workflow_versions_workflow_id_workspace_id_fkey
		foreign key (workflow_id, workspace_id)
		references public.workflows (id, workspace_id) on delete cascade,
	add constraint workflow_versions_number_check
		check (version_number > 0),
	add constraint workflow_versions_composition_check
		check (jsonb_typeof(composition) = 'object'),
	add constraint workflow_versions_fingerprint_check
		check (composition_fingerprint ~ '^[0-9a-f]{64}$'),
	add constraint workflow_versions_note_check
		check (note is null or btrim(note) <> ''),
	add constraint workflow_versions_workflow_id_version_number_key
		unique (workflow_id, version_number);

-- Toute lecture utile est « les versions de ce workflow, la plus récente d'abord ».
create index if not exists workflow_versions_workflow_recent_idx
	on public.workflow_versions (workflow_id, version_number desc);

comment on table public.workflow_versions is
	'Photographies immuables de la composition d''un workflow. Écriture par la seule RPC '
	'public.publish_workflow_version. CRM-078, docs/SPEC-workflow-engine.md §7 ter.3.';
comment on column public.workflow_versions.composition is
	'Document canonique rendu par app.workflow_composition_document au moment de la publication. '
	'Structure seulement : aucune card, aucune valeur de champ, aucune donnée personnelle.';

-- ---------------------------------------------------------------------------------------------
-- 3. L'immuabilité, troisième barrière : le trigger
-- ---------------------------------------------------------------------------------------------
-- Les deux premières barrières — aucune politique de mise à jour, aucun privilège d'écriture —
-- sont posées aux sections 4 et 5. Elles n'arrêtent PAS `service_role`, à qui le projet accorde
-- partout `all privileges`, et que `mail-sync` porte. Une version réécrite en silence ne serait
-- plus une preuve de rien : le trigger refuse donc en 42501, y compris sous `service_role` et sous
-- `postgres`.
--
-- IL PORTE SUR `update` ET SUR LUI SEUL. Un trigger `before delete` s'exécuterait aussi lors de la
-- suppression EN CASCADE d'un workspace ou d'un workflow et la rendrait impossible — c'est
-- exactement le mode de défaillance d'INC-039. La suppression directe reste tenue par le privilège
-- et par l'absence de politique ; la suppression en cascade reste possible, et elle est voulue :
-- les versions d'un workflow disparu n'ont plus d'objet.

create or replace function app.workflow_versions_refuser_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	raise exception 'une version publiee est immuable'
		using errcode = '42501',
		      detail  = 'workflow_versions n''accepte aucune mise a jour, y compris sous service_role',
		      hint    = 'publier une nouvelle version plutot que de reecrire celle-ci';
end;
$$;

comment on function app.workflow_versions_refuser_mutation() is
	'Refuse toute mise à jour d''une version publiée, y compris sous service_role. Troisième '
	'barrière d''immuabilité. CRM-078, docs/SPEC-workflow-engine.md §7 ter.4.';

revoke all on function app.workflow_versions_refuser_mutation() from public;

drop trigger if exists workflow_versions_refuser_mutation on public.workflow_versions;
create trigger workflow_versions_refuser_mutation
	before update on public.workflow_versions
	for each row execute function app.workflow_versions_refuser_mutation();

-- ---------------------------------------------------------------------------------------------
-- 4. Politiques : deux, et deux seulement
-- ---------------------------------------------------------------------------------------------
-- Ni mise à jour ni suppression : sans politique, l'opération ne voit aucune ligne. La lecture suit
-- `app.is_workspace_member`, comme `workflows` — une version décrit une structure d'organisation,
-- pas une affaire, et les droits fins de track et de channel ne s'y appliquent pas (§2.7).
--
-- L'insertion directe n'a AUCUNE politique : la RPC est `security definer` et n'en a pas besoin.

alter table public.workflow_versions enable row level security;
alter table public.workflow_versions force row level security;

drop policy if exists workflow_versions_lecture_membre on public.workflow_versions;
create policy workflow_versions_lecture_membre
	on public.workflow_versions
	for select
	to anon, authenticated
	using (app.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------------------------
-- 5. Privilèges explicites
-- ---------------------------------------------------------------------------------------------
-- MESURÉ pendant CRM-032 (décision 80) : l'image livre des `alter default privileges` qui accordent
-- nommément à anon, authenticated et service_role tous les droits de toute table nouvelle du schéma
-- public. Un objet créé ici doit donc être FERMÉ en nommant les rôles, avant d'être rouvert au
-- strict nécessaire.

revoke all on public.workflow_versions from anon, authenticated;
grant select on public.workflow_versions to anon, authenticated;
grant all privileges on public.workflow_versions to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Le geste : publier une version
-- ---------------------------------------------------------------------------------------------
-- Les cinq vérifications sont dans l'ordre du §7 ter.5, et chacune rend le code qui y est écrit.
-- P0002 n'est employé nulle part : PostgREST le rend en 500 (§4.4), ce qui ferait passer une donnée
-- mal désignée par le client pour une panne du produit.

drop function if exists public.publish_workflow_version(uuid, text);
create function public.publish_workflow_version(
	target_workflow_id uuid,
	note               text default null
)
returns public.workflow_versions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	appelant        uuid := auth.uid();
	le_workflow     public.workflows;
	empreinte       text;
	document        jsonb;
	derniere        public.workflow_versions;
	note_propre     text := nullif(btrim(coalesce(note, '')), '');
	nouvelle        public.workflow_versions;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Le workflow existe et appartient à un workspace de l'appelant. Un identifiant inexistant
	--    et un identifiant appartenant à autrui rendent LE MÊME refus : la fonction n'est pas un
	--    oracle d'existence (§4.3).
	select w.* into le_workflow
	  from public.workflows w
	 where w.id = target_workflow_id
	 for update;

	if not found or not app.is_workspace_member(le_workflow.workspace_id) then
		raise exception 'workflow introuvable'
			using errcode = 'P0001',
			      detail  = 'aucun workflow lisible ne porte cet identifiant';
	end if;

	-- 3. Publication réservée aux administrateurs du workspace.
	if not app.is_workspace_admin(le_workflow.workspace_id) then
		raise exception 'publication reservee aux administrateurs'
			using errcode = '42501',
			      detail  = 'le role requis est admin sur ce workspace';
	end if;

	-- 4. Un workflow archivé ne se photographie pas : sa composition ne bougera plus, et une version
	--    n'aurait aucun usage.
	if le_workflow.archived_at is not null then
		raise exception 'workflow archive'
			using errcode = 'P0001',
			      detail  = 'desarchiver le workflow avant de publier une version';
	end if;

	document  := app.workflow_composition_document(le_workflow.id);
	empreinte := app.workflow_composition_fingerprint(le_workflow.id);

	-- 5. La composition diffère de celle de la DERNIÈRE version. La comparaison porte sur
	--    l'empreinte, jamais sur le document : c'est à cela que sert l'empreinte, et cela reste
	--    juste quand la composition grossit. Elle ne porte que sur la dernière : republier une
	--    composition identique à une version PLUS ANCIENNE, après un aller-retour, est accepté, et
	--    le numéro avance. Une version dit « voici la structure à cette date ».
	select v.* into derniere
	  from public.workflow_versions v
	 where v.workflow_id = le_workflow.id
	 order by v.version_number desc
	 limit 1;

	if found and derniere.composition_fingerprint = empreinte then
		raise exception 'composition inchangee'
			using errcode = 'P0001',
			      detail  = 'la version ' || derniere.version_number || ' porte deja cette composition';
	end if;

	insert into public.workflow_versions (
		workspace_id, workflow_id, version_number, composition, composition_fingerprint,
		note, published_by
	)
	values (
		le_workflow.workspace_id,
		le_workflow.id,
		coalesce(derniere.version_number, 0) + 1,
		document,
		empreinte,
		note_propre,
		appelant
	)
	returning * into nouvelle;

	return nouvelle;
end;
$$;

comment on function public.publish_workflow_version(uuid, text) is
	'Fige une photographie immuable de la composition d''un workflow : numéro suivant, document, '
	'empreinte, auteur. Sérialise sur la ligne du workflow avant de lire le numéro. Cinq refus. '
	'CRM-078, docs/SPEC-workflow-engine.md §7 ter.5.';

revoke all on function public.publish_workflow_version(uuid, text) from public, anon;
grant execute on function public.publish_workflow_version(uuid, text) to authenticated, service_role;

commit;

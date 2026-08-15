-- @spec CRM-078 (docs/BACKLOG.md) — versionnement des workflows, troisième tranche : le plan de
--       remappage des cards
-- @spec docs/SPEC-workflow-engine.md §7 ter.12 (la tranche), §7 ter.12.2 (les trois issues d'une
--       card), §7 ter.12.3 (les instructions portent sur les étapes), §7 ter.12.4 (le geste et ses
--       huit refus), §7 ter.12.5 (quelles cards entrent dans le plan), §7 ter.12.6 (ce que la
--       fonction rend), §7 ter.12.7 (liste bornée et troncature annoncée), §7 ter.12.8
--       (autorisations), §7 ter.12.9 (contrat d'API), §7 ter.12.10 (ce qui n'est pas livré)
-- @spec docs/SPEC-workflow-engine.md §7 ter.2 (document canonique conservé par la version)
-- @spec docs/SPEC-permissions-rls.md §2.2 (règle 2 : un administrateur n'est jamais restreint), §7
--       (preuve de refus n° 3)
-- @spec docs/SPEC-cards.md §3.3 (current_step_id lié au workflow), §4 (archivage et corbeille sont
--       deux suppressions DOUCES)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- Restaurer une version — quatrième tranche — rend le workflow égal à la composition
-- photographiée. Les étapes créées DEPUIS la publication n'y figurent pas : elles disparaîtront.
-- Or des affaires s'y trouvent, et `cards.current_step_id` est `not null` et lié par clé étrangère
-- composite à une étape du workflow. Une restauration muette sur ces affaires échouerait en base,
-- ou pire, les déplacerait sans que personne l'ait demandé.
--
-- Livré ici : `public.plan_card_remapping` dit, AVANT toute restauration, card par card où elle
-- atterrit, et nomme celles pour lesquelles la base ne le dit pas.
--
-- Non livré, et nommé (§7 ter.12.10) : l'application et son retour arrière, tout écran, toute
-- instruction par card, et tout seed. La fonction est `stable` : elle n'écrit RIEN, pas même une
-- réservation.
--
-- ---------------------------------------------------------------------------------------------
-- LA RÈGLE DE FOND : AUCUNE DESTINATION N'EST DEVINÉE.
-- ---------------------------------------------------------------------------------------------
-- Une seule issue est automatique, et elle l'est parce qu'elle ne suppose rien : l'étape courante
-- existe des DEUX côtés, avec le MÊME identifiant, donc la card ne bouge pas. Toute autre
-- destination vient d'un humain, par `step_overrides`.
--
-- En particulier, une étape RÉTABLIE — présente dans la version, disparue depuis, que la
-- restauration recréera — n'est JAMAIS proposée comme destination par défaut. Elle est vide par
-- construction et il serait tentant d'y verser les affaires des étapes retirées « puisqu'elle
-- revient » : ce serait une supposition sur l'intention. Elle est NOMMÉE dans le plan pour qu'un
-- humain puisse la choisir ; elle n'est jamais choisie à sa place.
--
-- ---------------------------------------------------------------------------------------------
-- `SECURITY INVOKER`, ET C'EST LA CONDITION DE JUSTESSE DU RÉSULTAT, PAS UN CHOIX DE STYLE.
-- ---------------------------------------------------------------------------------------------
-- Un plan qui annoncerait « trois affaires concernées » là où quarante le sont ferait échouer la
-- restauration après l'avoir déclarée sûre. Or `public.cards` applique les droits fins dès sa
-- politique de lecture (`app.can_read_channel`). La question est donc : `security invoker`
-- rend-il un plan COMPLET ?
--
-- Oui, et uniquement parce que le plan est réservé aux administrateurs (vérification 3). La règle 2
-- de `app.resolve_access` — « un administrateur n'est jamais restreint » — s'applique AVANT les
-- droits fins. MESURÉ le 2026-08-15 sur la pile seedée : le seed pose
-- `track_members.access = 'none'` pour l'administratrice sur le track « Conseil & IA », dont le
-- channel « Grands comptes » porte SIX des treize affaires du workflow par défaut ;
-- l'administratrice en lit néanmoins 13 sur 13, là où la lectrice n'en lit que 7 sur 13.
--
-- La vérification 3 n'est donc pas une formalité d'autorisation : sans elle, le plan serait PARTIEL
-- pour un membre ordinaire, et un plan partiel est pire qu'un refus.
--
-- ---------------------------------------------------------------------------------------------
-- IDEMPOTENCE ET CONVERGENCE : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de CRM-001 ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). La fonction est posée en `create or
-- replace`, et ses privilèges sont RÉAFFIRMÉS à chaque passage, de sorte qu'un `grant` retiré à la
-- main soit RÉTABLI par un rejeu (décision 57) et non simplement laissé en l'état.

begin;

-- ---------------------------------------------------------------------------------------------
-- Le geste : planifier le remappage des cards avant la restauration d'une version
-- ---------------------------------------------------------------------------------------------

create or replace function public.plan_card_remapping(
	target_version_id uuid,
	step_overrides    jsonb   default null,
	card_limit        integer default 200
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
	version_cible      public.workflow_versions;
	etapes_version     uuid[];
	etapes_vivantes    uuid[];
	etapes_retirees    uuid[];
	instructions       jsonb := '[]'::jsonb;
	origine_invalide   uuid;
	cible_invalide     uuid;
	resume             jsonb;
	etapes_rendues     jsonb;
	cards_rendues      jsonb;
	total_cards        bigint;
	rendues            bigint;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. La version cible existe ET est lisible par l'appelant. La RLS fait les deux, et le refus
	--    est le MÊME pour une version d'autrui que pour un identifiant inexistant : la fonction
	--    n'est pas un oracle d'existence (§4.3). Ce contrôle PRÉCÈDE celui d'administration, faute
	--    de quoi le message d'administration révélerait l'existence d'une version d'autrui.
	select v.* into version_cible
	  from public.workflow_versions v
	 where v.id = target_version_id;

	if not found then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 3. Administrateur du workspace de la version. C'est ce contrôle qui rend le plan EXHAUSTIF
	--    sous `security invoker` — voir l'en-tête.
	if not app.is_workspace_admin(version_cible.workspace_id) then
		raise exception 'plan reserve aux administrateurs'
			using errcode = '42501',
			      detail  = 'le plan de remappage n''est complet que pour un administrateur';
	end if;

	-- 4. La liste des affaires est BORNÉE : lister n'est pas compter, et un workflow peut porter des
	--    milliers d'affaires (CLAUDE.md §21).
	if card_limit is null or card_limit < 1 or card_limit > 1000 then
		raise exception 'limite invalide'
			using errcode = 'P0001',
			      detail  = 'card_limit doit etre compris entre 1 et 1000';
	end if;

	-- Les étapes de la version, et celles qui vivent aujourd'hui. `V` et `L` du §7 ter.12.2.
	select coalesce(pg_catalog.array_agg((e.value ->> 'id')::uuid), array[]::uuid[])
	  into etapes_version
	  from pg_catalog.jsonb_array_elements(
	       coalesce(version_cible.composition -> 'steps', '[]'::jsonb)
	  ) as e(value);

	select coalesce(pg_catalog.array_agg(s.id), array[]::uuid[])
	  into etapes_vivantes
	  from public.workflow_steps s
	 where s.workflow_id = version_cible.workflow_id;

	-- ÉTAPES RETIRÉES = vivantes aujourd'hui, absentes de la version : elles disparaîtront, et ce
	-- sont les SEULES dont les affaires appellent une décision.
	select coalesce(pg_catalog.array_agg(v), array[]::uuid[])
	  into etapes_retirees
	  from pg_catalog.unnest(etapes_vivantes) as v
	 where not (v = any (etapes_version));

	-- 5. Les instructions sont VALIDÉES, jamais interprétées. Un tableau d'objets portant deux clés
	--    et deux `uuid` valides, et rien d'autre.
	--
	--    La FORME est celle de `change_channel_workflow.step_mapping` (CRM-019), et le contrôle est
	--    écrit avec le même idiome — `pg_input_is_valid` plutôt qu'un `cast` sous `exception`. Les
	--    deux gestes disent la même chose — « les affaires de cette étape vont là » — et deux
	--    formes différentes pour la même décision auraient obligé tout écran à les traduire l'une
	--    dans l'autre.
	if step_overrides is not null then
		if pg_catalog.jsonb_typeof(step_overrides) <> 'array' then
			raise exception 'remappage invalide'
				using errcode = 'P0001',
				      detail  = 'step_overrides doit etre un tableau d''objets '
				                '{from_step_id, to_step_id}';
		end if;

		if exists (
			select 1
			  from pg_catalog.jsonb_array_elements(step_overrides) as e(value)
			 where pg_catalog.jsonb_typeof(e.value) <> 'object'
			    or not (e.value ? 'from_step_id' and e.value ? 'to_step_id')
			    or (select pg_catalog.count(*)
			          from pg_catalog.jsonb_object_keys(e.value)) <> 2
			    or pg_catalog.jsonb_typeof(e.value -> 'from_step_id') <> 'string'
			    or pg_catalog.jsonb_typeof(e.value -> 'to_step_id') <> 'string'
			    or not pg_catalog.pg_input_is_valid(e.value ->> 'from_step_id', 'uuid')
			    or not pg_catalog.pg_input_is_valid(e.value ->> 'to_step_id', 'uuid')
		) then
			raise exception 'remappage invalide'
				using errcode = 'P0001',
				      detail  = 'chaque instruction porte exactement from_step_id et to_step_id, '
				                'deux identifiants';
		end if;

		instructions := step_overrides;
	end if;

	-- 6. Aucune `from_step_id` deux fois : deux destinations pour la même étape ne se départagent
	--    pas, et en choisir une serait deviner.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(instructions) as e(value)
		 group by e.value ->> 'from_step_id'
		having pg_catalog.count(*) > 1
	) then
		raise exception 'remappage ambigu'
			using errcode = 'P0001',
			      detail  = 'une meme etape d''origine porte deux instructions';
	end if;

	-- 7. Chaque origine est une étape RETIRÉE. Une instruction visant une étape qui survit est soit
	--    une erreur de l'appelant, soit un déplacement de masse déguisé : l'accepter en silence
	--    ferait du plan un geste d'écriture par procuration.
	select (e.value ->> 'from_step_id')::uuid into origine_invalide
	  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	 where not ((e.value ->> 'from_step_id')::uuid = any (etapes_retirees))
	 limit 1;

	if origine_invalide is not null then
		raise exception 'origine de remappage inconnue'
			using errcode = 'P0001',
			      detail  = 'l''etape ' || origine_invalide::text
			                || ' n''est pas une etape retiree par cette version';
	end if;

	-- 8. Chaque cible existe DANS LA VERSION : remapper vers une étape qui n'existera pas après la
	--    restauration ne rendrait pas le plan applicable.
	select (e.value ->> 'to_step_id')::uuid into cible_invalide
	  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	 where not ((e.value ->> 'to_step_id')::uuid = any (etapes_version))
	 limit 1;

	if cible_invalide is not null then
		raise exception 'cible de remappage absente de la version'
			using errcode = 'P0001',
			      detail  = 'l''etape ' || cible_invalide::text
			                || ' n''appartient pas a la composition de cette version';
	end if;

	-- ---------------------------------------------------------------------------------------
	-- La résolution, card par card, EN UNE SEULE REQUÊTE.
	--
	-- Une seule requête, et c'est délibéré : la règle de résolution n'est écrite QU'UNE FOIS. La
	-- compter d'un côté et la lister de l'autre aurait donné deux formulations de la même règle,
	-- et deux formulations finissent toujours par diverger — c'est exactement le défaut qu'a
	-- corrigé l'extraction du document canonique en migration 39.
	--
	-- AUCUNE TABLE TEMPORAIRE : la fonction est `stable`, et PostgREST autorise `GET` sur une
	-- fonction `stable`, donc une transaction en LECTURE SEULE. Un `create temporary table` y
	-- échouerait, et la RPC ne fonctionnerait que par le verbe qui a servi à l'éprouver.
	--
	-- TOUTES les cards du workflow entrent dans le plan, y compris les ARCHIVÉES et celles en
	-- CORBEILLE : ce ne sont pas des lignes disparues, elles portent un `current_step_id` réel et
	-- une clé étrangère opposable (docs/SPEC-cards.md §4). Les exclure rendrait un plan qui se dit
	-- complet et une restauration qui échoue en base sur une affaire que personne ne regardait
	-- plus.
	-- ---------------------------------------------------------------------------------------
	with instructions_par_etape as (
		select (e.value ->> 'from_step_id')::uuid as from_step_id,
		       (e.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	),
	resolues as (
		select
			c.id                as card_id,
			c.title             as title,
			-- La corbeille l'emporte : une card supprimée puis archivée reste supprimée.
			case
				when c.deleted_at  is not null then 'deleted'
				when c.archived_at is not null then 'archived'
				else                                'active'
			end                 as state,
			c.channel_id        as channel_id,
			c.current_step_id   as current_step_id,
			-- LA SEULE ISSUE AUTOMATIQUE EST `unchanged`, et elle l'est parce qu'elle ne suppose
			-- rien : l'étape existe des deux côtés, avec le même identifiant. Toute autre
			-- destination vient d'un humain, par `step_overrides`.
			case
				when c.current_step_id = any (etapes_version) then c.current_step_id
				else i.to_step_id
			end                 as target_step_id,
			case
				when c.current_step_id = any (etapes_version) then 'unchanged'
				when i.to_step_id is not null                 then 'remapped'
				else                                               'unresolved'
			end                 as resolution,
			-- L'ORDRE PLACE LES BLOCAGES EN TÊTE. Si la liste est tronquée, ce qu'un humain doit
			-- voir en premier est exactement ce qui l'empêche d'appliquer (§7 ter.12.7).
			case
				when c.current_step_id = any (etapes_version) then 2
				when i.to_step_id is not null                 then 1
				else                                               0
			end                 as rang
		  from public.cards c
		  left join instructions_par_etape i on i.from_step_id = c.current_step_id
		 where c.workflow_id = version_cible.workflow_id
	),
	-- Les compteurs portent sur la TOTALITÉ des affaires, jamais sur la seule page rendue : un plan
	-- dont le verdict dépendrait de la taille de la page ne serait pas un verdict.
	comptes as (
		select
			pg_catalog.count(*)                                                  as total,
			pg_catalog.count(*) filter (where r.resolution = 'unchanged')        as inchangees,
			pg_catalog.count(*) filter (where r.resolution = 'remapped')         as remappees,
			pg_catalog.count(*) filter (where r.resolution = 'unresolved')       as non_resolues
		  from resolues r
	),
	page as (
		select r.* from resolues r
		 order by r.rang, r.current_step_id, r.card_id
		 limit card_limit
	),
	liste as (
		select
			coalesce(pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'card_id',         p.card_id,
					'title',           p.title,
					'state',           p.state,
					'channel_id',      p.channel_id,
					'current_step_id', p.current_step_id,
					'target_step_id',  p.target_step_id,
					'resolution',      p.resolution
				) order by p.rang, p.current_step_id, p.card_id
			), '[]'::jsonb) as document,
			pg_catalog.count(*) as rendues
		  from page p
	),
	-- Les étapes RETIRÉES portent le libellé lu sur la structure VIVANTE ; les étapes RÉTABLIES
	-- celui du DOCUMENT de la version, seul endroit où il subsiste. C'est précisément à cela que
	-- sert la conservation du document entier : un écran doit pouvoir nommer une étape que la base
	-- ne porte plus.
	retirees as (
		select coalesce(pg_catalog.jsonb_agg(
			pg_catalog.jsonb_build_object(
				'step_id',          s.id,
				'label',            coalesce(s.label_override, n.label),
				'cards_total',      k.total,
				'cards_unresolved', k.non_resolues,
				'target_step_id',   i.to_step_id
			) order by s.position, s.id
		), '[]'::jsonb) as document
		  from public.workflow_steps s
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		  left join instructions_par_etape i on i.from_step_id = s.id
		  cross join lateral (
			select pg_catalog.count(*)                                            as total,
			       pg_catalog.count(*) filter (where r.resolution = 'unresolved') as non_resolues
			  from resolues r
			 where r.current_step_id = s.id
		  ) k
		 where s.id = any (etapes_retirees)
	),
	-- UNE ÉTAPE RÉTABLIE N'EST JAMAIS PROPOSÉE COMME DESTINATION. Elle est vide par construction,
	-- et il serait tentant d'y verser les affaires des étapes retirées « puisqu'elle revient » :
	-- ce serait une supposition sur l'intention. Elle est NOMMÉE ici, pour qu'un humain puisse la
	-- choisir ; elle n'est jamais choisie à sa place.
	retablies as (
		select coalesce(pg_catalog.jsonb_agg(
			pg_catalog.jsonb_build_object(
				'step_id', (e.value ->> 'id')::uuid,
				'label',   coalesce(e.value ->> 'label_override', e.value ->> 'node_label')
			) order by (e.value ->> 'position')::numeric, (e.value ->> 'id')
		), '[]'::jsonb) as document
		  from pg_catalog.jsonb_array_elements(
		       coalesce(version_cible.composition -> 'steps', '[]'::jsonb)
		  ) as e(value)
		 where not ((e.value ->> 'id')::uuid = any (etapes_vivantes))
	)
	select
		c.total,
		l.rendues,
		pg_catalog.jsonb_build_object(
			'cards_total',      c.total,
			'cards_unchanged',  c.inchangees,
			'cards_remapped',   c.remappees,
			'cards_unresolved', c.non_resolues,
			'steps_removed',    pg_catalog.cardinality(etapes_retirees),
			'steps_restored',   (
				select pg_catalog.count(*)
				  from pg_catalog.unnest(etapes_version) as v
				 where not (v = any (etapes_vivantes))
			)
		),
		pg_catalog.jsonb_build_object('removed', d.document, 'restored', b.document),
		l.document
	  into total_cards, rendues, resume, etapes_rendues, cards_rendues
	  from comptes c, liste l, retirees d, retablies b;

	return pg_catalog.jsonb_build_object(
		'version', pg_catalog.jsonb_build_object(
			'version_id',              version_cible.id,
			'version_number',          version_cible.version_number,
			'workflow_id',             version_cible.workflow_id,
			'published_at',            version_cible.published_at,
			'composition_fingerprint', version_cible.composition_fingerprint
		),
		-- `ready` ne dit PAS que la restauration réussira — la quatrième tranche a ses propres
		-- refus, et la structure vivante peut bouger entre le plan et son application. Il dit que
		-- plus aucune affaire n'attend une décision humaine.
		'ready',   (resume ->> 'cards_unresolved')::bigint = 0,
		'summary', resume,
		'steps',   etapes_rendues,
		'cards',   pg_catalog.jsonb_build_object(
			'total',     total_cards,
			'returned',  rendues,
			-- UNE TRONCATURE SILENCIEUSE SERAIT UN MENSONGE : elle ferait lire « voici les affaires
			-- concernées » là où il faut lire « en voici les deux cents premières ».
			'truncated', rendues < total_cards,
			'limit',     card_limit,
			'items',     cards_rendues
		)
	);
end;
$$;

comment on function public.plan_card_remapping(uuid, jsonb, integer) is
	'CRM-078 — docs/SPEC-workflow-engine.md §7 ter.12. Avant de restaurer une version, dit card '
	'par card où elle atterrit : unchanged quand l''étape existe des deux côtés, remapped quand '
	'l''appelant a donné une instruction, unresolved sinon. AUCUNE destination n''est devinée. '
	'Couvre les cards archivées et en corbeille. Liste bornée dont la troncature est annoncée. '
	'Huit refus. SECURITY INVOKER : exhaustif parce que réservé aux administrateurs, qu''un droit '
	'fin ne restreint jamais.';

-- La révocation nommée d'`anon` est obligatoire : le `grant execute` par défaut de l'image porte
-- sur `anon` aussi (décision 80). Sans elle, l'anonyme obtiendrait 403 au lieu de 401, et le
-- contrôle 1 serait le seul rempart.
revoke all on function public.plan_card_remapping(uuid, jsonb, integer) from public, anon;
grant execute on function public.plan_card_remapping(uuid, jsonb, integer)
	to authenticated, service_role;

commit;

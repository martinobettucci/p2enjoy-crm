-- @spec CRM-033 (docs/BACKLOG.md) — cohérence workflow ↔ channel, et la dette NOT NULL d'INC-029
-- @spec docs/SPEC-workflow-engine.md §4.12.2 (la règle), §4.12.3 (trigger sur channels),
--       §4.12.4 (trigger sur workflows), §4.12.5 (NOT NULL), §4.12.6 (contrat d'API)
-- @spec docs/SPEC-channels.md §2.5 (l'écart d'INC-029, soldé ici), §8 (seed)
-- @spec docs/SCHEMA.md §2 (channels.workflow_id, non nulle et référencée), §3 (workflows)
-- @spec docs/SPEC-permissions-rls.md §4 (l'écriture reste réservée aux administrateurs)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/INCONSISTENCY_REPORT.md INC-029 (dette soldée ici), INC-040 (quatre portes mesurées)
--
-- Un channel suit un workflow **global** de son workspace, ou un workflow **track** rattaché à son
-- propre track. Toute autre valeur est refusée.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi deux triggers, et non un seul comme la Definition of Done le demandait.
-- ---------------------------------------------------------------------------------------------
-- MESURÉ, et c'est ce qui a dicté l'écriture (docs/JOURNAL.md, décision 89) : quatre écritures
-- cassent la cohérence, et non deux. Les deux connues passent par `channels` — affecter un workflow,
-- déplacer le channel. Les deux autres passent par `workflows` :
--
--   * changer le `track_id` d'un workflow `track` **sous** les channels qui le suivent ;
--   * faire passer le workflow **par défaut** de `global` à `track`, ce qui invalide d'un seul
--     `UPDATE` le rattachement des **six** channels du seed.
--
-- Les quatre ont été appliquées sur la base réelle, et les quatre ont été **acceptées**. Un
-- invariant gardé d'un seul côté n'est pas un invariant : c'est une convention, et l'écriture qui la
-- contourne n'est pas signalée. INC-040.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration ne fait pas, et pourquoi.
-- ---------------------------------------------------------------------------------------------
-- Elle **ne revérifie pas** que le workflow appartient au workspace du channel :
-- `channels_workflow_id_workspace_id_fkey`, composite depuis `CRM-031`, le garantit déjà. La redire
-- coûterait une lecture à chaque écriture pour une garantie acquise, et le jour où la clé serait
-- relâchée, le trigger **masquerait** la perte au lieu de la révéler
-- (docs/SPEC-workflow-engine.md §4.12.2).
--
-- Elle **ne pose aucun défaut de colonne** sur `workflow_id`. Rattacher automatiquement le channel
-- neuf au workflow par défaut du workspace serait commode et faux : un workspace peut n'avoir aucun
-- défaut — le §3.2 dit « au plus un », jamais « exactement un » —, et un défaut silencieux
-- transformerait une omission du client en un choix qu'il n'a pas fait (décision 91).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). `create or replace function` puis
-- `drop trigger if exists` / `create trigger` reconstruisent les deux triggers à chaque rejeu : un
-- trigger retiré à la main est **rétabli**, et non seulement laissé manquant (décision 57).
-- `alter column … set not null` est convergent par nature — sans effet si la contrainte est déjà là,
-- et **en échec bruyant** si une ligne nulle subsiste, ce qui est le comportement voulu.

-- =============================================================================================
-- 1. La règle, vue depuis `channels`
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.12.3.
--
-- `BEFORE INSERT OR UPDATE OF workflow_id, track_id, workspace_id`. Les trois colonnes, et pas la
-- seule `workflow_id` : déplacer un channel vers un autre track ne touche pas `workflow_id`, et un
-- trigger qui ne se réveille que pour elle laisserait passer la porte n° 2.
--
-- `SECURITY INVOKER` : la fonction ne lit que `workflows`, table sur laquelle l'appelant a déjà été
-- autorisé — ou non — par les politiques de `CRM-031`. Lui donner les droits du propriétaire serait
-- un privilège gratuit. `search_path` vidé, comme toute fonction du schéma `app`.
--
-- ATTENTION, et c'est mesuré : la fonction lit `public.workflows` **sans RLS applicable**, un
-- trigger s'exécutant hors du contexte de politique de la table lue lorsque son propriétaire est
-- celui des tables. Elle ne rend donc aucune information à l'appelant : elle refuse ou elle se tait,
-- et le message d'erreur ne nomme ni le workflow ni son track.

create or replace function app.channels_verifier_workflow()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_scope    text;
	v_track_id uuid;
begin
	-- Premier silence : aucune obligation à faire respecter ici. L'obligation de désigner un
	-- workflow est portée par la contrainte `NOT NULL` de la section 3, qui la dit mieux et plus
	-- tôt. Ce cas subsiste pour que le trigger reste correct si la contrainte était un jour retirée.
	if new.workflow_id is null then
		return new;
	end if;

	select w.scope, w.track_id
	  into v_scope, v_track_id
	  from public.workflows w
	 where w.id = new.workflow_id
	   and w.workspace_id = new.workspace_id;

	-- Second silence, et c'est un choix. MESURÉ : lorsque le workflow désigné n'existe pas dans le
	-- workspace du channel, la clé étrangère composite répond `23503` → `409`, en nommant la
	-- contrainte et la table. Une clé étrangère est vérifiée **après** les triggers `BEFORE` : le
	-- trigger voit ici une ligne dont il ne peut rien dire d'utile. Il rend la main plutôt que
	-- d'inventer un refus moins précis que celui que la base rendra de toute façon.
	if not found then
		return new;
	end if;

	if v_scope = 'global' then
		return new;
	end if;

	if v_scope = 'track' and v_track_id = new.track_id then
		return new;
	end if;

	-- `23514` — `check_violation` — et non `P0001`. Les deux rendent `400`, MESURÉ ; le premier dit
	-- en outre de quelle **nature** est le refus : une règle d'intégrité, à ranger avec
	-- `channels_name_check` et `channels_slug_check`, et non une règle applicative
	-- (docs/JOURNAL.md, décision 90).
	raise exception 'workflow_hors_track' using errcode = '23514';
end;
$$;

comment on function app.channels_verifier_workflow() is
	'CRM-033 — docs/SPEC-workflow-engine.md §4.12.3. Un channel suit un workflow `global` de son '
	'workspace ou un workflow `track` de **son** track. Se tait lorsque la clé étrangère parle '
	'mieux que lui.';

revoke all on function app.channels_verifier_workflow() from public;

drop trigger if exists channels_verifier_workflow on public.channels;
create trigger channels_verifier_workflow
	before insert or update of workflow_id, track_id, workspace_id on public.channels
	for each row execute function app.channels_verifier_workflow();

-- =============================================================================================
-- 2. La même règle, vue depuis `workflows` — les portes 3 et 4
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §4.12.4. `BEFORE UPDATE OF scope, track_id`.
--
-- Le trigger refuse la modification dès qu'elle laisserait **au moins un** channel rattaché à un
-- workflow qui ne lui convient plus. Il ne s'intéresse ni à `is_default`, ni au nom, ni à
-- l'archivage : seule la portée peut casser un rattachement.
--
-- Il ne refuse pas les écritures qui ne changent rien : la condition porte sur l'**état résultant**,
-- non sur le fait qu'une colonne a été mentionnée. Un `UPDATE` qui réaffecte les mêmes valeurs
-- passe.
--
-- Il n'interdit pas non plus qu'un workflow `track` **sans aucun channel** change de track : la
-- règle protège des rattachements, pas des workflows.
--
-- Le même `SQLSTATE` que la section 1, à dessein : c'est la même règle vue de l'autre côté, et lui
-- donner un autre code laisserait croire à une autre règle. Le **message** diffère, lui, parce que
-- la faute n'est pas la même — ici, on déplace le workflow sous ses occupants.

create or replace function app.workflows_verifier_portee_occupee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.scope is not distinct from old.scope
	   and new.track_id is not distinct from old.track_id then
		return new;
	end if;

	if exists (
		select 1
		  from public.channels c
		 where c.workflow_id = new.id
		   and not (new.scope = 'global'
		            or (new.scope = 'track' and new.track_id = c.track_id))
	) then
		raise exception 'workflow_portee_occupee' using errcode = '23514';
	end if;

	return new;
end;
$$;

comment on function app.workflows_verifier_portee_occupee() is
	'CRM-033 — docs/SPEC-workflow-engine.md §4.12.4. Refuse de changer la portée d''un workflow sous '
	'les channels qui le suivent. Ferme les portes 3 et 4 d''INC-040, qu''aucun trigger sur '
	'`channels` ne pouvait voir.';

revoke all on function app.workflows_verifier_portee_occupee() from public;

drop trigger if exists workflows_verifier_portee_occupee on public.workflows;
create trigger workflows_verifier_portee_occupee
	before update of scope, track_id on public.workflows
	for each row execute function app.workflows_verifier_portee_occupee();

-- =============================================================================================
-- 3. `channels.workflow_id` devient obligatoire — INC-029 soldée
-- =============================================================================================
-- `docs/SCHEMA.md` §2 la décrit **non nulle** depuis l'origine. `CRM-021` ne pouvait pas la poser,
-- `workflows` n'existant pas ; `CRM-031` s'y est refusée parce qu'elle change le **contrat de
-- création d'un channel**, ce qui relevait de l'unité qui porte ce contrat. C'est celle-ci.
--
-- MESURÉ avant de la poser : `select count(*) from public.channels where workflow_id is null` rend
-- `0`. Aucune reprise de données n'est nécessaire.
--
-- Si une ligne nulle subsistait, cette instruction **échouerait bruyamment** et le démarrage de la
-- pile s'arrêterait là. C'est le comportement voulu : une base dont le contrat de schéma n'est pas
-- tenable doit le dire, et non démarrer en laissant croire qu'il l'est.

alter table public.channels alter column workflow_id set not null;

comment on column public.channels.workflow_id is
	'Workflow suivi par le channel. **Obligatoire depuis CRM-033** (INC-029 soldée). Clé étrangère '
	'composite avec `workspace_id` depuis CRM-031 ; sa portée est vérifiée par le trigger '
	'`channels_verifier_workflow` (docs/SPEC-workflow-engine.md §4.12).';

-- PostgREST met son schéma en cache : sans ce signal, la nullabilité changée n'est pas reflétée dans
-- la description d'`OpenAPI` qu'il sert, ni dans les types générés à partir d'elle.
notify pgrst, 'reload schema';

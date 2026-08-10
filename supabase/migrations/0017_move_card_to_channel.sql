-- @spec CRM-045 (docs/BACKLOG.md) — déplacement d'une card entre channels
-- @spec docs/SPEC-workflow-engine.md §6.2 (signature), §6.3 (ce que la base interdit déjà),
--       §6.4 (les huit vérifications), §6.5 (effets), §6.6 (réponses de formulaire),
--       §6.7 (l'événement), §6.8 (privilèges)
-- @spec docs/SCHEMA.md §5 (card_events, neuf types), §9 (fonctions)
-- @spec docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`), §5 (« active »),
--       §14.4 (vocabulaire), §14.6 (payload)
-- @spec docs/SPEC-permissions-rls.md §3.3 (droits effectifs sur un channel), §7 (refus n° 1, n° 5)
-- @spec docs/SPEC-seed.md §2.16 (aller-retour du seed)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décisions 213 (nom du paramètre), 214 (garde close d'avance),
--       215 (un seul événement), 216 (les réponses détruites, jamais en silence),
--       217 (`entered_step_at` conditionnelle)
-- @spec docs/INCONSISTENCY_REPORT.md INC-073 (`step_mapping` désignait une autre fonction),
--       INC-046 (le workflow d'un channel peuplé, non levé par cette unité)
--
-- `move_card` (migration 12) déplace une card DANS son graphe : elle franchit une arête déclarée.
-- Cette migration livre le geste voisin et distinct — déplacer une card d'un graphe à un AUTRE.
-- Il n'y a aucune arête entre deux workflows et il ne peut pas y en avoir : ce sont deux graphes
-- disjoints. C'est pourquoi le remappage est FOURNI par l'appelant et non calculé — aucune donnée
-- de la base ne permettrait de le calculer (docs/SPEC-workflow-engine.md §6.1).
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'A PAS À FAIRE, ET C'EST MESURÉ — décision 214.
-- ---------------------------------------------------------------------------------------------
-- `CRM-034` avait dû retirer elle-même le privilège de colonne sur `current_step_id` : sans quoi
-- `move_card` eût été une commodité que seuls les clients bien intentionnés empruntent. Ici, rien
-- de tel. MESURÉ le 2026-08-06 — les douze colonnes qu'`authenticated` peut écrire sur `cards`
-- sont `amount, archived_at, currency, deleted_at, description, next_action, next_action_at,
-- owner_id, position, probability_override, snoozed_until, title`. Ni `channel_id`, ni
-- `workflow_id`, ni `current_step_id`.
--
-- `CRM-013` les avait fermées « par voie de conséquence ». La conséquence n'avait pas été nommée :
-- elle rend cette fonction opposable DÈS SA NAISSANCE. La section 4 ne pose donc aucun privilège de
-- colonne — elle en fige un, pour qu'un relâchement futur soit dénoncé et non subi.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). `drop … if exists` précède la création :
-- `create or replace function` refuse de renommer un paramètre. La section 1 emploie le mécanisme
-- de convergence des migrations 11, 13, 15 et 16 : la contrainte est REMPLACÉE lorsque sa
-- définition diffère, et non seulement créée si elle manque (INC-035).
--
-- DÉPENDANCES D'ORDRE : `cards` (11), `move_card` (12), `card_field_values` (13), les privilèges de
-- colonne (14), `card_events` et ses triggers (16).

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Même fonction que les migrations 11, 13, 15 et 16, sous un nom propre à celle-ci : toutes sont
-- retirées en fin de fichier, et un nom partagé rendrait l'ordre de suppression significatif.

create or replace function app.migration_0017_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname  = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

-- =============================================================================================
-- 1. Le vocabulaire passe de huit à NEUF valeurs
-- =============================================================================================
-- docs/SPEC-cards.md §14.4, docs/SCHEMA.md §5.
--
-- LE MÉCANISME DE `CRM-044` A FONCTIONNÉ, SUR LA PREMIÈRE UNITÉ À L'ÉPROUVER. La migration 16
-- écrivait : « le jour où une unité écrira un type nouveau, elle devra étendre cette énumération
-- DANS LA MÊME MIGRATION que son trigger, et la base le lui rappellera par un 23514 ». C'est ce
-- jour, et la base l'a bien rappelé — MESURÉ le 2026-08-06, `app.card_event_ecrire(…,
-- 'channel_changed', …)` refusé en 23514 avant cette section.
--
-- `mail_received` et `mail_sent` restent REFUSÉS : `CRM-054` et `CRM-058` ne les écrivent pas, et
-- une valeur autorisée que rien ne produit laisse croire à une capacité inexistante. Le mécanisme
-- est donc reconduit tel quel pour l'unité suivante.

-- LE VOCABULAIRE NE SE RÉTRÉCIT JAMAIS À LA RÉAPPLICATION, ET C'EST UN CORRECTIF MESURÉ.
-- Le `migrations-runner` rejoue TOUT le répertoire à chaque démarrage (`CRM-001`). Écrite sans
-- garde, cette convergence remettait la liste dans son état d'origine — et faisait échouer le
-- rejeu en `23514` dès qu'une unité ultérieure produisait un type qu'elle ne connaît pas :
-- `mail_received`, livré par `CRM-055`, a réellement bloqué le runner. Un démarrage de pile
-- s'arrêtait alors avant PostgREST.
--
-- La convergence ne s'applique donc que si le type que CETTE migration introduit est absent.
-- Elle garde ainsi son rôle — poser son propre ajout sur une base qui ne l'a pas — sans jamais
-- défaire celui d'une migration postérieure.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%channel_changed%'
	) then
		perform app.migration_0017_converger_contrainte(
			'public.card_events', 'card_events_type_check',
			'CHECK ((type = ANY (ARRAY[''created''::text, ''moved''::text, ''assigned''::text, '
			'''channel_changed''::text, ''archived''::text, ''unarchived''::text, ''trashed''::text, '
			'''restored''::text, ''field_changed''::text])))');
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-045 — docs/SPEC-cards.md §14.4. NEUF valeurs livrées : `channel_changed` s''ajoute aux '
	'huit de CRM-044. `mail_received` et `mail_sent`, que docs/SCHEMA.md §5 nomme, restent REFUSÉS '
	'tant que CRM-054 et CRM-058 ne les écrivent pas.';

-- =============================================================================================
-- 2. Le trigger de `cards` : une cinquième garde, et une quatrième rendue exclusive
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §6.7, décision 215.
--
-- LE TRIGGER EST SUR LA TABLE, NON DANS LA RPC — décision 203 de `CRM-044`, reprise et non
-- réinventée. Un trigger sur la table couvre STRICTEMENT PLUS que la fonction : un `PATCH` direct
-- sous `service_role`, que la fermeture de colonne n'arrête pas (docs/SPEC-permissions-rls.md
-- §4.4.3), produit lui aussi l'événement. Une garde protège les clients ; une trace doit couvrir
-- tout le monde.
--
-- CE QUE CETTE SECTION CORRIGE, ET QUI EST MESURÉ. Avant elle, un changement de channel était
-- PARFAITEMENT SILENCIEUX : le trigger surveillait quatre colonnes et `channel_id` n'en faisait
-- pas partie. MESURÉ — `…0c1` déplacée de `grands-comptes` vers `appels-offres` sous `postgres`
-- produisait ZÉRO événement. La mémoire d'une affaire ne disait pas qu'elle avait changé de
-- dossier.
--
-- `moved` ET `channel_changed` S'EXCLUENT, et c'est le cœur de la décision 215. La garde `moved`
-- est désormais conditionnée à `channel_id` INCHANGÉ. Motif : `moved` signifie, depuis `CRM-044`,
-- « la card a franchi une arête du graphe ». Une card qui change de workflow n'en a franchi aucune,
-- et il ne peut pas y en avoir. Écrire les deux ferait dire à la mémoire d'une affaire qu'une
-- transition a eu lieu là où il n'y en avait pas — dans une table que personne ne peut corriger.
--
-- RIEN N'EST PERDU : `from_step_id` et `to_step_id` figurent dans le `payload` de
-- `channel_changed`, qui dit PLUS que le `moved` qu'il remplace, et le dit sans mentir sur la
-- nature du geste.
--
-- L'ordre des gardes reste signifiant, `clock_timestamp()` étant réévaluée à chaque insertion :
-- `channel_changed` précède `assigned`, parce qu'un déplacement qui changerait aussi le
-- responsable doit se lire dans cet ordre-là — on range l'affaire, puis on la confie.

create or replace function app.card_events_apres_maj_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- CRM-045, décision 215 : conditionnée à `channel_id` inchangé. Un déplacement entre channels
	-- écrit `channel_changed` et lui seul.
	if new.current_step_id is distinct from old.current_step_id
	   and new.channel_id is not distinct from old.channel_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'moved',
			jsonb_build_object('from_step_id', old.current_step_id,
			                   'to_step_id',   new.current_step_id));
	end if;

	-- CRM-045 — « conservant l'ancien et le nouveau contexte », docs/SPEC-workflow-engine.md §6.7.
	-- Les trois couples sont portés, y compris lorsque le workflow ou l'étape ne changent pas :
	-- une clé toujours présente se lit sans condition, et l'égalité de l'avant et de l'après est
	-- elle-même une information (le channel a changé, le graphe non).
	if new.channel_id is distinct from old.channel_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'channel_changed',
			jsonb_build_object('from_channel_id',  old.channel_id,
			                   'to_channel_id',    new.channel_id,
			                   'from_workflow_id', old.workflow_id,
			                   'to_workflow_id',   new.workflow_id,
			                   'from_step_id',     old.current_step_id,
			                   'to_step_id',       new.current_step_id));
	end if;

	-- Y COMPRIS VERS `NULL` : une affaire dont on retire le responsable change d'état, et
	-- docs/SPEC-permissions-rls.md §8.1 retient la conservation plutôt que la réaffectation forcée.
	if new.owner_id is distinct from old.owner_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'assigned',
			jsonb_build_object('from_owner_id', old.owner_id,
			                   'to_owner_id',   new.owner_id));
	end if;

	if new.archived_at is distinct from old.archived_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.archived_at is null then 'unarchived' else 'archived' end,
			'{}'::jsonb);
	end if;

	if new.deleted_at is distinct from old.deleted_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.deleted_at is null then 'restored' else 'trashed' end,
			'{}'::jsonb);
	end if;

	return null;
end;
$$;

comment on function app.card_events_apres_maj_card() is
	'CRM-045 — docs/SPEC-cards.md §14.4, décisions 203 et 215. CINQ colonnes surveillées : '
	'`current_step_id`, `channel_id`, `owner_id`, `archived_at`, `deleted_at`. Chaque garde compare '
	'`is distinct from` — MESURÉ, une écriture qui ne change rien ne produit AUCUN événement, ce '
	'qui rend le seed convergent. `moved` est CONDITIONNÉ à `channel_id` inchangé : une card qui '
	'change de channel n''a franchi aucune arête du graphe, et son payload porte l''étape d''avant '
	'et celle d''après. Le trigger est sur la TABLE, non dans la RPC : un PATCH sous `service_role` '
	'produit l''événement lui aussi.';

-- Le trigger lui-même est inchangé — il pointe la même fonction, remplacée ci-dessus. Il est
-- recréé pour que la migration reste rejouable sur une base dont le trigger aurait été retiré à la
-- main (même motif que la section 2.2 de la migration 12).
drop trigger if exists card_events_apres_maj on public.cards;
create trigger card_events_apres_maj
	after update on public.cards
	for each row execute function app.card_events_apres_maj_card();

-- =============================================================================================
-- 3. `public.move_card_to_channel`
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §6.2 et §6.4.
--
-- `SECURITY DEFINER` pour le même motif que `move_card` : le privilège de colonne s'applique au
-- rôle qui exécute l'instruction, et une fonction `SECURITY DEFINER` s'exécute avec les droits de
-- son PROPRIÉTAIRE. La fonction écrit donc précisément ce que son appelant ne peut pas écrire.
--
-- Elle porte par conséquent ELLE-MÊME sa règle d'accès : les politiques RLS de `cards` ne
-- s'appliquent pas au propriétaire de la table, donc elle les contourne par construction et ne
-- peut rien leur déléguer.

drop function if exists public.move_card_to_channel(uuid, uuid, uuid, boolean);

create function public.move_card_to_channel(
	card_id              uuid,
	to_channel_id        uuid,
	to_step_id           uuid    default null,
	discard_field_values boolean default false
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Recopiés AVANT tout usage, comme dans `move_card` et `copy_workflow_to_track` : `card_id`,
	-- `to_channel_id` et `to_step_id` sont aussi des noms de colonnes des tables lues plus bas, et
	-- PL/pgSQL refuse une référence ambiguë (42702) plutôt que d'en choisir une.
	--
	-- `to_channel_id` porte ce nom et non `channel_id` — décision 213 : `channel_id` est une
	-- colonne de `cards` que le corps lit ET écrit, et l'homonymie y serait une source d'erreur
	-- silencieuse. `to_step_id` reprend la convention de `move_card`, et NON le `step_mapping`
	-- qu'annonçait docs/SCHEMA.md §9, lequel décrivait un déplacement en lot — INC-073.
	v_card_id  uuid := card_id;
	v_channel  uuid := to_channel_id;
	v_etape    uuid := to_step_id;
	v_card     public.cards%rowtype;
	v_cible    public.channels%rowtype;
	v_valeurs  integer;
begin
	-- --- 3.1 La card existe, est visible de l'appelant, et elle est **active** ------------------
	-- Règle de discrétion du §4.3, reprise mot pour mot de `move_card` 1.1 : une card d'un autre
	-- workspace, ou d'un channel fermé par un droit fin, rend `card_not_found` et JAMAIS
	-- `forbidden`. Répondre « interdit » confirmerait son existence à qui n'a pas le droit de la
	-- connaître.
	--
	-- « Active » a la même définition qu'ailleurs — `archived_at is null and deleted_at is null`,
	-- docs/SPEC-cards.md §5. Une card qu'on a rangée ne se déplace pas ; on la restaure d'abord.
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- --- 3.2 Droit d'écriture sur le channel D'ORIGINE ------------------------------------------
	-- UN DÉPLACEMENT EST UNE ÉCRITURE SUR DEUX CHANNELS : il retire une card d'un endroit et la
	-- pose ailleurs. Le refus porte sur l'origine D'ABORD, parce que c'est le seul des deux que
	-- l'appelant est certain de connaître — il vient d'y lire la card (§6.4).
	--
	-- `42501` → `403`, MESURÉ. C'est la **preuve de refus n° 1** de docs/SPEC-permissions-rls.md §7.
	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 3.3 Le channel cible existe et est visible de l'appelant -------------------------------
	-- `channel_not_found` ET NON `forbidden`, pour la même raison qu'en 3.1 : sans cela la fonction
	-- deviendrait un ORACLE D'EXISTENCE de channels, interrogeable identifiant par identifiant par
	-- quiconque possède une card à déplacer.
	--
	-- Le cloisonnement des workspaces est tenu ici : `app.can_read_channel` est fausse pour un
	-- channel d'un autre workspace. Il l'est AUSSI, structurellement, par la clé composite
	-- `cards (channel_id, workspace_id) → channels (id, workspace_id)` — la fonction ne s'appuie
	-- pas sur ce filet, un message de contrainte PostgreSQL n'étant pas un message de produit, mais
	-- il existe et une assertion le fige.
	select ch.* into v_cible
	  from public.channels ch
	 where ch.id = v_channel
	   and app.can_read_channel(ch.id);

	if not found then
		raise exception 'channel_not_found';
	end if;

	-- --- 3.4 Droit d'écriture sur le channel CIBLE ----------------------------------------------
	-- N'exiger que le droit sur l'origine laisserait déposer une card dans un channel fermé.
	if not app.can_write_channel(v_cible.id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 3.5 Le channel cible n'est pas le channel courant --------------------------------------
	-- Un « déplacement » qui ne déplace rien écrirait un `channel_changed` dont l'avant et l'après
	-- seraient identiques : une trace mensongère dans une table que personne ne peut corriger.
	-- Rendre `200` sans rien faire serait la « simulation de succès » que CLAUDE.md §18 proscrit.
	if v_cible.id = v_card.channel_id then
		raise exception 'same_channel';
	end if;

	-- --- 3.6 Le remappage est OBLIGATOIRE quand le workflow change ------------------------------
	-- C'est le « remappage obligatoire » de la Definition of Done. La fonction ne choisit AUCUNE
	-- étape par défaut : ni la première du graphe cible, ni celle qui porterait le même nœud.
	--
	-- Le §6 l'interdit — « deux workflows peuvent partager une clé sans que le déplacement soit
	-- sémantiquement équivalent » — et le seed le démontre : les deux workflows livrés portent LES
	-- SEPT MÊMES NŒUDS DANS LE MÊME ORDRE. Un remappage par clé de nœud paraîtrait donc juste sur
	-- ce seed, et le paraîtrait jusqu'au jour où deux workflows divergeraient. Une règle qui n'est
	-- fausse que plus tard est une règle fausse.
	--
	-- Si le workflow est identique, `to_step_id` est facultatif et l'étape est CONSERVÉE, comme le
	-- §6 d'origine l'exige. Le fournir explicitement reste licite — c'est un changement de channel
	-- ET de colonne en un geste, et rien ne justifie de l'interdire.
	if v_cible.workflow_id is distinct from v_card.workflow_id and v_etape is null then
		raise exception 'step_mapping_required';
	end if;

	v_etape := coalesce(v_etape, v_card.current_step_id);

	-- --- 3.7 L'étape appartient au workflow du channel cible ------------------------------------
	-- REFAITE ALORS QUE LA BASE LA TIENT, exactement comme la 1.3 de `move_card` : la clé composite
	-- `cards (current_step_id, workflow_id) → workflow_steps (id, workflow_id)` la garantit. La
	-- refaire n'ajoute aucune garantie — elle ajoute UN MESSAGE, et UNE PLACE DANS L'ORDRE, avant
	-- que la 3.8 ne parle de destruction.
	if not exists (
		select 1
		  from public.workflow_steps s
		 where s.id = v_etape
		   and s.workflow_id = v_cible.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- --- 3.8 Les réponses de formulaire, et la perte assumée ------------------------------------
	-- docs/SPEC-workflow-engine.md §6.6, décision 216.
	--
	-- LE FAIT, MESURÉ : `card_field_values` porte `(card_id, workflow_id) → cards (id, workflow_id)
	-- ON DELETE CASCADE`. La cascade joue sur la SUPPRESSION d'une card, pas sur la MISE À JOUR de
	-- son `workflow_id` — il n'y a pas d'`ON UPDATE CASCADE`. Changer le workflow d'une card qui
	-- porte une réponse est donc refusé en 23503. Ce n'est pas un cas limite : MESURÉ, SIX CARDS DU
	-- SEED SUR NEUF portent des réponses.
	--
	-- Une réponse répond à la question d'un workflow, et la charnière `workflow_id` de
	-- `card_field_values` existe précisément pour « rendre impossible une valeur répondant à la
	-- question d'un AUTRE workflow » (CRM-036). Une card qui change de workflow n'a donc plus de
	-- réponses valides. Les remapper par clé de champ serait le remappage automatique que le §6
	-- interdit, transposé des nœuds aux champs ; refuser tout déplacement rendrait la fonction
	-- inutile aux deux tiers du seed.
	--
	-- ELLES SONT DONC DÉTRUITES — MAIS JAMAIS SANS QUE L'APPELANT L'AIT DIT. `discard_field_values`
	-- vaut `false`, et le refus porte leur NOMBRE en DETAIL. Le §6 tient en une phrase : « le
	-- remappage est EXPLICITE ». Détruire les réponses d'une affaire en silence, à l'occasion d'un
	-- geste présenté comme un rangement, en serait l'exact contraire, et un défaut destructeur eût
	-- été la « valeur par défaut trompeuse » que CLAUDE.md §18 proscrit.
	--
	-- CE QUE LA MÉMOIRE EN GARDE : la suppression porte sur `card_field_values`, JAMAIS sur
	-- `card_events` — que rien ne peut supprimer (CRM-044 §14.8). Le fil continue de porter les
	-- `field_changed` produits par ces réponses, avec leurs dates. La mémoire survit à la donnée.
	if v_cible.workflow_id is distinct from v_card.workflow_id then
		select count(*) into v_valeurs
		  from public.card_field_values v
		 where v.card_id = v_card_id;

		if v_valeurs > 0 and not coalesce(discard_field_values, false) then
			raise exception 'field_values_would_be_lost'
				using detail = format('%s réponse(s) de formulaire seraient perdues.', v_valeurs);
		end if;

		if v_valeurs > 0 then
			delete from public.card_field_values v where v.card_id = v_card_id;
		end if;
	end if;

	-- --- 3.9 L'écriture -------------------------------------------------------------------------
	-- LES TROIS COLONNES S'ÉCRIVENT EN UN SEUL `UPDATE`, ET IL LE FAUT. MESURÉ : écrire `channel_id`
	-- seul rend « insert or update on table "cards" violates foreign key constraint
	-- "cards_channel_id_workflow_id_fkey" ». Les clés composites sont vérifiées en FIN
	-- D'INSTRUCTION, non en fin de transaction : deux `UPDATE` successifs échoueraient là où un
	-- seul passe. Ce n'est pas une préférence de style.
	--
	-- `workflow_id` N'EST PAS UN PARAMÈTRE : il est LU dans `channels`. Le workflow d'une card est
	-- celui de son channel — lecture n° 1 de docs/SCHEMA.md §5 retenue par `CRM-040` (INC-046). Le
	-- laisser fournir par l'appelant n'ouvrirait que la seule combinaison que la clé composite
	-- refuse, pour n'obtenir qu'un 23503.
	--
	-- `entered_step_at` N'EST TOUCHÉE QUE SI L'ÉTAPE CHANGE — décision 217. docs/SPEC-cards.md §2.9
	-- la réserve à `move_card` ; l'étendre ici est une décision : entrer dans une étape par
	-- remappage est y entrer. Mais un changement de channel À ÉTAPE CONSTANTE ne fait entrer la
	-- card nulle part, et remettre l'horodatage à zéro ferait mentir la seule mesure d'ancienneté
	-- du produit — une affaire en négociation depuis trois semaines paraîtrait y être entrée à
	-- l'instant parce qu'on l'a rangée dans un autre dossier.
	--
	-- `position` EST TOUJOURS RECALCULÉE, même à étape constante : sa portée est le couple
	-- `(channel_id, current_step_id)` (docs/SPEC-cards.md §2.6), et changer de channel change de
	-- portée. Sans recalcul, deux cards porteraient le même rang dans la colonne d'arrivée et
	-- l'ordre du board deviendrait arbitraire. La card ne se compte pas elle-même : sa `position`
	-- courante appartient à la colonne de départ, dans un AUTRE channel.
	--
	-- `updated_at` n'est pas écrite ici : le trigger `app.set_updated_at()` de `CRM-040` s'en
	-- charge. `channel_changed` non plus : le trigger de la section 2 s'en charge.
	update public.cards c
	   set channel_id      = v_cible.id,
	       workflow_id     = v_cible.workflow_id,
	       current_step_id = v_etape,
	       entered_step_at = case
	           when v_etape is distinct from v_card.current_step_id then now()
	           else c.entered_step_at
	       end,
	       position        = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.cards autre
	            where autre.channel_id      = v_cible.id
	              and autre.current_step_id = v_etape
	       )
	 where c.id = v_card_id
	returning c.* into v_card;

	-- Elle rend la ligne mise à jour, et non `void` : PostgREST rend un type composite
	-- `public.cards` comme un objet JSON unique (§6.2). Sans conséquence sur la confidentialité —
	-- la 3.4 ayant réussi, l'appelant a le droit d'écrire donc de lire ce channel.
	return v_card;
end;
$$;

alter function public.move_card_to_channel(uuid, uuid, uuid, boolean) owner to postgres;

comment on function public.move_card_to_channel(uuid, uuid, uuid, boolean) is
	'CRM-045 — docs/SPEC-workflow-engine.md §6. Déplace une card d''un graphe de workflow à un '
	'AUTRE : aucune arête n''est franchie, aucune transition n''est consultée. Le remappage est '
	'EXPLICITE — aucun remappage automatique par clé de nœud. Le droit d''écriture est exigé sur '
	'les DEUX channels. Huit refus : card_not_found, forbidden (origine), channel_not_found, '
	'forbidden (cible), same_channel, step_mapping_required, step_not_in_workflow, '
	'field_values_would_be_lost. Les réponses de formulaire sont DÉTRUITES quand le workflow '
	'change, et jamais sans que `discard_field_values` l''ait dit (décision 216). L''événement '
	'`channel_changed` est écrit par le TRIGGER de `cards`, non par cette fonction (décision 215).';

-- --- 3.10 Privilèges de la fonction -----------------------------------------------------------
-- docs/SPEC-workflow-engine.md §6.8, et les trois faits mesurés du §5.6 repris tels quels.
--
-- `revoke … from public` NE SUFFIT PAS (décision 80) : l'image Supabase pose des `ALTER DEFAULT
-- PRIVILEGES IN SCHEMA public` qui accordent `EXECUTE` NOMMÉMENT à `anon`, `authenticated` et
-- `service_role` sur toute fonction nouvelle. Le `revoke` doit viser `public` ET `anon`.
--
-- Le refus de l'appelant anonyme rend alors `401`, non `403` — PostgREST traite l'absence de droit
-- d'un appelant non authentifié comme une invitation à s'authentifier (§4.4). Le refus est double —
-- privilège, puis vérification 3.1 —, et le premier suffit.

revoke all on function public.move_card_to_channel(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.move_card_to_channel(uuid, uuid, uuid, boolean)
	to authenticated, service_role;

-- =============================================================================================
-- 4. Ce que cette migration NE fait PAS aux privilèges de colonne, et pourquoi
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §6.3, décision 214.
--
-- `CRM-034` avait dû, dans sa propre migration, retirer `UPDATE` sur `current_step_id`. Cette
-- unité n'a rien à retirer : `channel_id` et `workflow_id` sont déjà fermés à `authenticated`
-- depuis la migration 14, qui les avait fermés « par voie de conséquence » sans nommer la
-- conséquence.
--
-- LA NOMMER SUFFIT-IL À LA TENIR ? Non — et c'est pourquoi une assertion de
-- `supabase/tests/0019_move_card_to_channel.test.sql` énumère les colonnes ouvertes et échouerait
-- si `channel_id` ou `workflow_id` y rentraient. Un privilège qu'aucune migration ne pose est un
-- privilège qu'aucune migration ne défend : la défense est ici dans la preuve, à sa place.
--
-- Reproduire ici le `revoke`/`grant` de la migration 14 serait plus mauvais : deux migrations
-- énonceraient la même liste de douze colonnes, et la prochaine unité qui en ouvre une devrait
-- penser à modifier les deux.

-- =============================================================================================
-- 5. Retrait de l'échafaudage
-- =============================================================================================

drop function if exists app.migration_0017_converger_contrainte(text, text, text);

notify pgrst, 'reload schema';

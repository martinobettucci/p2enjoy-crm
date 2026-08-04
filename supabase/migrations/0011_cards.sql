-- @spec CRM-040 (docs/BACKLOG.md) — cards : table, adresse générée, responsable, montant,
--       archivage, corbeille
-- @spec docs/SPEC-cards.md §2 (modèle), §3 (adresse), §4 (cycle de vie), §5 (« active »),
--       §6 (autorisations), §7 (garde d'archivage d'un nœud occupé)
-- @spec docs/SCHEMA.md §5 (cards), §9 (fonctions), §10 (index), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §3 (fonctions d'autorisation), §4 (politiques), §7 (preuves)
-- @spec docs/SPEC-workflow-engine.md §2.6 (archivage d'un nœud occupé), §5 (`move_card`)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décisions 109 (clés composites), 110 (la politique ne relit pas sa table),
--       111 (garde d'archivage rattachée à cette unité), 112 (la boucle n'est pas la garantie)
-- @spec docs/INCONSISTENCY_REPORT.md INC-013 (dernier point : `app.can_read_card`),
--       INC-025 (colonnes communes omises par les tableaux), INC-031 (garde d'archivage),
--       INC-035 (contraintes idempotentes sans être convergentes), INC-046 (le workflow d'un
--       channel occupé)
--
-- L'objet métier principal du produit, au sens de `CLAUDE.md` §4. Jusqu'ici le CRM décrivait une
-- organisation **vide** : des tracks, des channels, un catalogue d'états, des workflows et un
-- vocabulaire de formulaire, sans rien à y ranger.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la table `cards`, les **trois clés étrangères composites** qui tiennent la cohérence
-- workspace / workflow / étape, la génération non devinable de `email_local_part`, l'attribution
-- automatique de `position` dans la portée `(channel, étape)`, la colonne générée `search_tsv`,
-- cinq index, trois politiques RLS, les privilèges explicites, `app.can_read_card` — dernier point
-- d'INC-013 —, et la **garde d'archivage d'un nœud occupé** qu'INC-031 attendait depuis `CRM-030`.
--
-- Non livré, et nommé :
--
--   * **`move_card` et ses six vérifications** (`CRM-034`). Cette migration livre sa **cible**, pas
--     la garde. Tant qu'elle n'existe pas, `current_step_id` s'écrit directement par un `PATCH`, et
--     la seule garde qui tienne est structurelle : la section 3.3 impose que l'étape appartienne au
--     workflow de la card. La vérification n° 3 des six est donc acquise, gratuitement et
--     définitivement ; les cinq autres restent dues ;
--
--   * **la protection de colonne** de `current_step_id` et d'`email_local_part` — `REVOKE`, non
--     modifiables directement. C'est mot pour mot la Definition of Done de `CRM-013`, unité `[ ]`
--     distincte. Le trigger de la section 4.1 **génère** l'adresse à l'insertion ; il ne la protège
--     pas en mise à jour. L'écart est figé par une assertion de la suite pgTAP, non par ce
--     commentaire ;
--
--   * **`card_events`, `card_comments`, `card_field_values`, `card_activities`** et les tables
--     satellites de `docs/SCHEMA.md` §5. Aucun trigger d'événement n'est écrit : il n'aurait aucune
--     table où écrire, et créer les tables par anticipation préempterait `CRM-036`, `CRM-043` et
--     `CRM-044` en même temps ;
--
--   * **le recalcul de `health_score`** et la **remise à zéro d'`entered_step_at`** : aucun
--     ordonnanceur n'existe, et la seconde appartient à `move_card`. Les colonnes existent parce que
--     le schéma de référence les nomme et que les types générés doivent les porter.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (`docs/JOURNAL.md`, décision 20). Tout est donc rejouable — et
-- **convergent**, au sens d'INC-035 : une contrainte remplacée à la main par une contrainte plus
-- faible portant le même nom est **réparée** par le rejeu, non conservée.

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Reprise du mécanisme livré par `CRM-031` (décision 78, INC-035). La définition réelle est
-- comparée à celle attendue, et la contrainte n'est refaite que si elles diffèrent : un
-- `drop`/`add` inconditionnel reconstruirait un index à chaque démarrage de la pile.
--
-- `search_path` vidé n'est pas une convention de style : `pg_get_constraintdef` rend les noms de
-- relations **selon le `search_path`**, et avec un chemin vide il les rend pleinement qualifiés.
-- Les deux côtés de la comparaison s'écrivent donc de la même façon.
--
-- La fonction est **retirée en fin de migration**, section 9.

create or replace function app.migration_0011_converger_contrainte(
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
-- 1. Les deux unicités que `channels` doit offrir à ses cards
-- =============================================================================================
-- MESURÉ avant écriture, sur une table sonde : sans elles, toute clé étrangère composite vers
-- `channels` est refusée à la création —
-- « there is no unique constraint matching given keys for referenced table "channels" ».
--
-- Elles sont **structurellement redondantes** : `id` étant déjà la clé primaire de `channels`,
-- `(id, workspace_id)` et `(id, workflow_id)` ne peuvent pas contenir de doublon. Elles ne servent
-- qu'à rendre la référence composite légale, et ne changent rien au comportement de `channels`.
--
-- C'est exactement ce que `CRM-021` avait dû faire sur `tracks` depuis la migration des channels,
-- et `CRM-031` sur le catalogue depuis celle des workflows.

select app.migration_0011_converger_contrainte(
	'public.channels', 'channels_id_workspace_id_key', 'UNIQUE (id, workspace_id)');

select app.migration_0011_converger_contrainte(
	'public.channels', 'channels_id_workflow_id_key', 'UNIQUE (id, workflow_id)');

comment on constraint channels_id_workspace_id_key on public.channels is
	'CRM-040 — docs/SPEC-cards.md §2.4. Unicité redondante, exigée par la clé étrangère composite '
	'`cards (channel_id, workspace_id)`. Sans elle : « there is no unique constraint matching '
	'given keys ».';

comment on constraint channels_id_workflow_id_key on public.channels is
	'CRM-040 — docs/SPEC-cards.md §2.4. Unicité redondante, exigée par la clé étrangère composite '
	'`cards (channel_id, workflow_id)`, qui garantit qu''une card porte le workflow de son channel.';

-- =============================================================================================
-- 2. La table
-- =============================================================================================
-- docs/SCHEMA.md §5, complété par les « Conventions générales » du même document pour `created_at`
-- et `updated_at`, que le tableau du §5 omet pour cette table comme pour `tracks`, `channels` et
-- le catalogue — troisième occurrence d'INC-025.

create table if not exists public.cards (
	id                   uuid        primary key default gen_random_uuid(),
	-- Dénormalisé, et rendu véridique par la contrainte composite de la section 3.1.
	workspace_id         uuid        not null references public.workspaces (id) on delete cascade,
	-- Aucune clé étrangère **simple** vers `channels` : les deux composites de la section 3 la
	-- contiennent. En ajouter une troisième coûterait une vérification par écriture sans rien
	-- garantir de plus.
	channel_id           uuid        not null,
	-- Toujours le workflow du channel — section 3.2. « Figé à la création » est tenu au sens de
	-- « toujours cohérent », non au sens d'un gel de colonne : un gel littéral interdirait
	-- `move_card_to_channel` (`CRM-045`), dont l'objet est de changer `channel_id` **et**
	-- `workflow_id` ensemble (INC-046, docs/SPEC-cards.md §2.5).
	workflow_id          uuid        not null,
	-- Toujours une étape de `workflow_id` — section 3.3.
	current_step_id      uuid        not null,
	title                text        not null,
	description          text,
	-- `numeric` et non `integer` : index fractionnaire, comme `tracks.position` et
	-- `channels.position`. `not null` **sans défaut de colonne** : le trigger de la section 4.2 la
	-- renseigne lorsqu'elle est omise.
	position             numeric     not null,
	-- Le responsable. Nullable, et `on delete set null` : `docs/SPEC-permissions-rls.md` §8.1
	-- retient la **conservation** de la card plutôt que la réaffectation forcée.
	owner_id             uuid        references public.profiles (id) on delete set null,
	amount               numeric(14,2),
	currency             text        not null default 'EUR',
	probability_override numeric(5,2),
	next_action          text,
	next_action_at       timestamptz,
	-- Alimentée à la création par son défaut. Sa **remise à zéro** appartient à `move_card`
	-- (`CRM-034`), non livrée : docs/SPEC-cards.md §2.9.
	entered_step_at      timestamptz not null default now(),
	-- Recalculé par un ordonnanceur qui n'existe pas, et qu'aucune unité ne porte. Livrée parce que
	-- le schéma de référence la nomme ; **jamais alimentée** — docs/SPEC-cards.md §2.9.
	health_score         integer,
	-- Renseignée par le trigger de la section 4.1, quelle que soit la valeur fournie par
	-- l'appelant. `not null` sans défaut : le trigger précède toujours l'insertion.
	email_local_part     text        not null,
	snoozed_until        timestamptz,
	-- Deux suppressions douces **distinctes** : archiver n'est pas supprimer
	-- (docs/SPEC-cards.md §4). Aucune suppression physique n'est exposée — section 7, aucun
	-- `grant delete`.
	archived_at          timestamptz,
	deleted_at           timestamptz,
	created_by           uuid        references public.profiles (id) on delete set null,
	created_at           timestamptz not null default now(),
	updated_at           timestamptz not null default now(),
	-- MESURÉ : la configuration de recherche doit être **explicite**. `to_tsvector(title)` dépend
	-- de `default_text_search_config`, paramètre de session, et l'expression n'est alors pas
	-- immuable — la colonne générée est refusée. Le choix de `'french'` est celui de la langue par
	-- défaut du produit, et il est assumé : une card rédigée en anglais sera mal racinisée
	-- (docs/SPEC-cards.md §2.7).
	search_tsv           tsvector    generated always as (
		to_tsvector('french', coalesce(title, '') || ' ' || coalesce(description, ''))
	) stored
);

comment on table public.cards is
	'CRM-040 — docs/SPEC-cards.md. Objet métier principal : une affaire, dans un channel, à une '
	'étape d''un workflow. Archivage et corbeille sont deux suppressions douces distinctes.';

comment on column public.cards.email_local_part is
	'CRM-040 — docs/SPEC-cards.md §3. Partie locale de l''adresse de la card, générée par trigger, '
	'non devinable. L''adresse complète — avec `workspaces.inbound_domain` — n''est pas stockée : '
	'c''est une dérivation, et un domaine peut changer (§3.5).';

comment on column public.cards.health_score is
	'CRM-040 — docs/SPEC-cards.md §2.9. Livrée, JAMAIS alimentée : aucun ordonnanceur n''existe et '
	'aucune unité du backlog n''en porte un.';

-- --- 2.1 Contraintes de valeur, convergentes -------------------------------------------------
-- `drop`/`add` inconditionnel : le prix d'une revalidation de `CHECK` est négligeable, et un rejeu
-- **répare** une contrainte retirée à la main (décision 57, généralisée par `CRM-021`).

alter table public.cards drop constraint if exists cards_title_check;
alter table public.cards add  constraint cards_title_check check (btrim(title) <> '');

-- La **forme** ISO 4217, jamais la liste : la base ne connaît pas les devises réelles, et une
-- liste figée vieillirait sans que rien ne le signale.
alter table public.cards drop constraint if exists cards_currency_check;
alter table public.cards add  constraint cards_currency_check check (currency ~ '^[A-Z]{3}$');

-- Nullable : la contrainte ne s'applique qu'à une valeur fournie. Même borne que
-- `workflow_nodes_catalog.default_probability`.
alter table public.cards drop constraint if exists cards_probability_override_check;
alter table public.cards add  constraint cards_probability_override_check
	check (probability_override is null or probability_override between 0 and 100);

-- La forme de l'adresse est tenue par la **base**, non seulement par le trigger qui la produit :
-- une valeur écrite par `service_role`, qui contourne les politiques mais non les contraintes,
-- reste soumise à cette règle. L'alphabet est celui de Crockford en minuscules — sans `i`, `l`,
-- `o` ni `u` (docs/SPEC-cards.md §3.2).
alter table public.cards drop constraint if exists cards_email_local_part_check;
alter table public.cards add  constraint cards_email_local_part_check
	check (email_local_part ~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$');

-- AUCUNE contrainte de signe sur `amount`, et c'est délibéré : un avoir, une remise ou une perte
-- constatée peuvent légitimement s'exprimer en négatif. Refuser les négatifs est une décision de
-- produit que personne n'a prise — docs/SPEC-cards.md §10, point ouvert n° 1. L'absence est figée
-- par une assertion de la suite pgTAP, non laissée au hasard.

-- =============================================================================================
-- 3. Trois clés étrangères composites — décision 109
-- =============================================================================================
-- Aucune de ces trois règles n'est confiée à un trigger. Un trigger se contourne par un
-- `DISABLE TRIGGER`, ne dit rien de l'état déjà en base, et doit être écrit deux fois — insertion
-- et mise à jour. Une clé composite est vérifiée par le moteur, des deux côtés de la relation.

-- --- 3.1 Le cloisonnement ---------------------------------------------------------------------
-- Rend impossible une card dont le `workspace_id` dénormalisé diffère de celui de son channel.

select app.migration_0011_converger_contrainte(
	'public.cards', 'cards_channel_id_workspace_id_fkey',
	'FOREIGN KEY (channel_id, workspace_id) REFERENCES public.channels(id, workspace_id) ON DELETE CASCADE');

-- --- 3.2 Le workflow suit le channel ----------------------------------------------------------
-- Rend impossible une card dont le workflow n'est pas celui de son channel.
--
-- CONSÉQUENCE ÉMERGENTE, MESURÉE, ET QUI N'EST ÉCRITE DANS AUCUNE SPÉCIFICATION — INC-046.
-- Changer `channels.workflow_id` d'un channel qui porte au moins une card devient **refusé**, en
-- `23503`. La règle est défendable — repointer le workflow d'un channel sous ses cards les
-- laisserait sur des étapes d'un graphe qu'elles ne suivent plus — mais elle n'a pas été décidée
-- par le responsable. Elle est écrite, figée par une assertion, et soumise à arbitrage.
--
-- Pas de `ON DELETE CASCADE` ici : la clé de la section 3.1 le porte déjà pour le même parent, et
-- deux cascades sur la même relation n'apportent rien.

select app.migration_0011_converger_contrainte(
	'public.cards', 'cards_channel_id_workflow_id_fkey',
	'FOREIGN KEY (channel_id, workflow_id) REFERENCES public.channels(id, workflow_id)');

-- --- 3.3 L'étape appartient au workflow -------------------------------------------------------
-- Rend impossible une card posée sur une étape d'un autre workflow.
--
-- Cette clé livre **la vérification n° 3 des six de `move_card`** (`docs/SPEC-workflow-engine.md`
-- §5) : « l'étape cible appartient au workflow de la card ». `CRM-034` n'aura pas à l'écrire, et
-- la garantie vaut aussi pour un `PATCH` direct qu'aucune garde applicative ne verrait passer.
--
-- Elle est possible sans rien ajouter à `workflow_steps` : `(id, workflow_id)` y est déjà unique
-- depuis `CRM-031`. MESURÉ sur sonde : une étape associée à son propre workflow est acceptée, la
-- même associée à un autre est refusée en `23503`.

select app.migration_0011_converger_contrainte(
	'public.cards', 'cards_current_step_id_workflow_id_fkey',
	'FOREIGN KEY (current_step_id, workflow_id) REFERENCES public.workflow_steps(id, workflow_id)');

-- =============================================================================================
-- 4. Triggers
-- =============================================================================================

-- --- 4.0 `updated_at` -------------------------------------------------------------------------

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
	before update on public.cards
	for each row execute function app.set_updated_at();

-- --- 4.1 L'adresse de la card — décision 112 --------------------------------------------------
-- MESURÉ : une colonne `GENERATED ALWAYS AS` contenant `gen_random_bytes` est refusée,
-- « generation expression is not immutable ». Le trigger est une nécessité mesurée.
--
-- Huit caractères base32 portent exactement 40 bits, soit cinq octets, soit environ 1,1 × 10¹²
-- adresses. PostgreSQL ne sait pas encoder en base32 — `encode()` connaît `hex`, `base64` et
-- `escape` : la conversion lit les cinq octets comme un entier et le déplie par groupes de cinq
-- bits, poids fort en tête, **sans supprimer les zéros de tête**.
--
-- CE QUE LA BOUCLE NE GARANTIT PAS. Elle réessaie dix fois, et deux transactions concurrentes ne
-- voient pas leurs lignes non validées respectives. Ce qui garantit l'unicité est l'index unique
-- de la section 5, et lui seul ; la boucle rend l'erreur visible improbable. Le dire fait partie
-- du livrable : une boucle qui **passerait** pour la garantie serait la fausse sécurité que
-- `CLAUDE.md` §18 proscrit.
--
-- La valeur fournie par l'appelant est **ignorée et remplacée** : « généré » signifie que la
-- valeur ne vient pas du client. L'accepter laisserait choisir une adresse devinable, ce qui
-- annulerait l'exigence de non-devinabilité de `docs/SCHEMA.md` §5.
--
-- `SECURITY DEFINER` : la boucle lit `public.cards` pour écarter une valeur déjà prise, et doit
-- voir **toutes** les cards, pas celles que la RLS de l'appelant lui montre. Une lecture soumise
-- aux politiques rendrait la vérification aveugle aux cards des autres channels.

create or replace function app.cards_generer_email_local_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
	tirage   bigint;
	candidat text;
	i        integer;
	essai    integer := 0;
begin
	loop
		essai := essai + 1;

		tirage   := ('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40)::bigint;
		candidat := 'c-';
		for i in 0..7 loop
			candidat := candidat || substr(alphabet, ((tirage >> (5 * (7 - i))) & 31)::int + 1, 1);
		end loop;

		exit when not exists (
			select 1 from public.cards c where c.email_local_part = candidat
		);

		if essai >= 10 then
			raise exception
				'email_local_part : dix tirages consécutifs déjà pris, ce qui est anormal sur un espace de 2^40'
				using errcode = 'unique_violation';
		end if;
	end loop;

	new.email_local_part := candidat;
	return new;
end;
$$;

comment on function app.cards_generer_email_local_part() is
	'CRM-040 — docs/SPEC-cards.md §3. Trigger BEFORE INSERT : renseigne `email_local_part` quelle '
	'que soit la valeur fournie. La boucle ne garantit rien — l''index unique le fait (décision 112).';

revoke all on function app.cards_generer_email_local_part() from public;

drop trigger if exists cards_generer_email_local_part on public.cards;
create trigger cards_generer_email_local_part
	before insert on public.cards
	for each row execute function app.cards_generer_email_local_part();

-- --- 4.2 L'ordre dans une colonne de board ----------------------------------------------------
-- La portée est le couple `(channel_id, current_step_id)` — **une colonne du board**, non le
-- channel entier.
--
-- `SECURITY INVOKER` : la fonction ne lit que `cards`, table sur laquelle l'appelant a déjà été
-- autorisé par la politique d'insertion. Lui donner les droits du propriétaire serait un privilège
-- gratuit — à la différence de 4.1, dont la lecture doit être exhaustive.

create or replace function app.cards_attribuer_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(c.position), 0) + 1
			  from public.cards c
			 where c.channel_id      = new.channel_id
			   and c.current_step_id = new.current_step_id
		);
	end if;
	return new;
end;
$$;

comment on function app.cards_attribuer_position() is
	'CRM-040 — docs/SPEC-cards.md §2.6. Trigger BEFORE INSERT : place la card en fin de **colonne '
	'du board** — portée (channel, étape) — lorsque `position` est omise.';

revoke all on function app.cards_attribuer_position() from public;

drop trigger if exists cards_attribuer_position on public.cards;
create trigger cards_attribuer_position
	before insert on public.cards
	for each row execute function app.cards_attribuer_position();

-- =============================================================================================
-- 5. Index — docs/SCHEMA.md §10
-- =============================================================================================

-- L'unicité **globale** de l'adresse : c'est elle, et elle seule, qui garantit ce que la boucle de
-- la section 4.1 se contente de rendre improbable.
create unique index if not exists cards_email_local_part_key
	on public.cards (email_local_part);

-- Une colonne de board, dans l'ordre.
create index if not exists cards_channel_step_position_idx
	on public.cards (channel_id, current_step_id, position);

-- La vue « Ma journée ».
create index if not exists cards_workspace_next_action_idx
	on public.cards (workspace_id, next_action_at);

create index if not exists cards_search_tsv_idx
	on public.cards using gin (search_tsv);

-- Ne figure pas dans `docs/SCHEMA.md` §10, et s'y ajoute pour une raison mesurable : PostgreSQL
-- n'indexe pas la colonne **référençante** d'une clé étrangère. Sans cet index, chaque suppression
-- d'un profil — qui déclenche `on delete set null` — imposerait un parcours complet de `cards`.
create index if not exists cards_owner_idx
	on public.cards (owner_id);

-- =============================================================================================
-- 6. `app.can_read_card` — dernier point d'INC-013
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3 la prescrit depuis `CRM-010` ; INC-013 l'a différée quatre
-- fois, faute de `cards`. Sa cible existe : elle est livrée, et INC-013 s'éteint.
--
-- ELLE N'EST PAS EMPLOYÉE PAR LES POLITIQUES DE `cards` — décision 110. Une politique qui
-- l'appellerait relirait `cards`, et une fonction `STABLE` ne voit pas la ligne que l'instruction
-- en cours vient d'écrire : le `RETURNING` d'un `INSERT` étant soumis à la politique `SELECT`,
-- **toute création de card rendrait `403`**. C'est le défaut réel trouvé par `CRM-012` sur
-- `tracks` (décision 107), dont la règle générale est écrite au §3.5 de
-- `docs/SPEC-permissions-rls.md`. La leçon est appliquée avant d'être payée une seconde fois.
--
-- Ses appelants sont les tables **filles** — `card_comments` (`CRM-043`), `card_field_values`
-- (`CRM-036`), `card_events` (`CRM-044`), `mail_messages` (`CRM-054`), les politiques de Storage —,
-- dont les politiques ne disposent que d'un `card_id`. Livrer une fonction sans usage immédiat est
-- assumé et dit ; la suite pgTAP l'éprouve **directement**.
--
-- `coalesce(…, false)` : un identifiant inconnu rend zéro ligne, donc `NULL`, et une fonction qui
-- annonce `boolean` doit rendre un booléen (décision 102).

create or replace function app.can_read_card(card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_read_channel(c.channel_id) from public.cards c where c.id = card),
		false);
$$;

comment on function app.can_read_card(uuid) is
	'CRM-040 — docs/SPEC-permissions-rls.md §3, docs/SPEC-cards.md §6.2. Droit de lecture effectif '
	'sur une card, dérivé de son channel. Destinée aux tables FILLES : les politiques de `cards` '
	'elles-mêmes jugent sur `channel_id` (décision 110). Dernier point d''INC-013.';

revoke all on function app.can_read_card(uuid) from public;

-- `EXECUTE` à `anon` aussi : sans lui, un appelant anonyme atteignant une table dont la politique
-- appelle cette fonction recevrait une **erreur de privilège**, alors que le comportement exigé
-- par `docs/SPEC-permissions-rls.md` §7 est **zéro ligne**. Le droit n'ouvre rien : `auth.uid()`
-- étant nul, `app.can_read_channel` rend faux.
grant execute on function app.can_read_card(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 7. Refus par défaut, puis politiques
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.cards enable row level security;

-- --- 7.1 Lecture ------------------------------------------------------------------------------
-- Le prédicat porte sur `channel_id`, **colonne de la ligne jugée**, jamais sur l'identifiant de
-- la card — décision 110, et règle générale du §3.5 de `docs/SPEC-permissions-rls.md`.
--
-- Les droits fins de `CRM-012` s'appliquent donc pleinement, dès la première card : un
-- `channel_members.access = 'none'` masque les cards du channel, et un `access = 'member'` sur un
-- channel rouvre celles-ci alors même que le track est fermé. Contrairement à `tracks` et
-- `channels`, cette table naît avec ses droits fins appliqués : INC-024 et INC-030 n'ont pas
-- d'équivalent ici.
--
-- Accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le prédicat rend
-- faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de privilège.

drop policy if exists cards_lecture on public.cards;
create policy cards_lecture
	on public.cards
	for select
	to anon, authenticated
	using (app.can_read_channel(channel_id));

comment on policy cards_lecture on public.cards is
	'CRM-040 — docs/SPEC-cards.md §6.1. Lecture par droit effectif sur le channel, droits fins '
	'appliqués. Le prédicat lit la COLONNE de la ligne, jamais la card par son identifiant.';

-- --- 7.2 Insertion ----------------------------------------------------------------------------

drop policy if exists cards_insertion on public.cards;
create policy cards_insertion
	on public.cards
	for insert
	to authenticated
	with check (app.can_write_channel(channel_id));

comment on policy cards_insertion on public.cards is
	'CRM-040 — docs/SPEC-cards.md §6.1. Création réservée à qui a le droit d''ÉCRITURE sur le '
	'channel : un `viewer` de workspace est refusé, un droit fin `member` le rouvre.';

-- --- 7.3 Mise à jour --------------------------------------------------------------------------
-- LE `WITH CHECK` EST REDONDANT, ET ÉCRIT QUAND MÊME — le dire vaut mieux que de laisser croire
-- qu'il protège seul. Le `USING` juge la ligne **avant** modification, le `WITH CHECK` la juge
-- **après** : sans une règle sur la ligne d'arrivée, un appelant ayant le droit d'écriture sur le
-- channel A déplacerait une card **vers** le channel B. Mais MESURÉ sur une politique sonde
-- `for update` écrite sans `with check`, `pg_get_expr(polwithcheck, …)` rend `NULL` et PostgreSQL
-- **réutilise le `USING`** : l'omettre ne rouvrirait rien.
--
-- La clause est conservée parce qu'elle rend la règle lisible sans connaître ce détail du moteur,
-- et parce qu'elle protège d'une réécriture qui donnerait au `USING` une expression plus large que
-- celle voulue à l'arrivée. La dégradation du harnais la rend donc **permissive** plutôt que de la
-- retirer — la retirer serait une dégradation complaisante.

drop policy if exists cards_maj on public.cards;
create policy cards_maj
	on public.cards
	for update
	to authenticated
	using      (app.can_write_channel(channel_id))
	with check (app.can_write_channel(channel_id));

comment on policy cards_maj on public.cards is
	'CRM-040 — docs/SPEC-cards.md §6.1. `USING` juge la ligne avant modification, `WITH CHECK` '
	'après. Le second est REDONDANT — mesuré : PostgreSQL réutilise le `USING` quand il manque — et '
	'écrit quand même, pour que la règle soit lisible et survive à une réécriture du `USING`.';

-- --- 7.4 Aucune politique `for delete` --------------------------------------------------------
-- Ce que le produit appelle « archiver » et « mettre à la corbeille » sont deux horodatages. La
-- suppression physique n'est exposée à personne — même règle que `tracks`, `channels`,
-- `workflow_nodes_catalog` et `form_fields`.

-- --- 7.5 Privilèges ---------------------------------------------------------------------------
-- `SELECT` à `anon` : sans lui, un appelant sans jeton recevrait `401` par le privilège avant
-- qu'une politique ne s'exprime, et le refus mesuré ne serait pas celui qui est exigé — zéro ligne.

revoke all on public.cards from anon, authenticated;
grant select         on public.cards to anon, authenticated;
grant insert, update on public.cards to authenticated;
grant all privileges on public.cards to service_role;

-- =============================================================================================
-- 8. La garde d'archivage d'un nœud occupé — INC-031, décision 111
-- =============================================================================================
-- `docs/SPEC-workflow-engine.md` §2.6 énonce la règle depuis `CRM-030` : « l'archivage d'un nœud du
-- catalogue est refusé tant qu'une card active s'y trouve ». Son chemin est
-- `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`. Il traversait deux
-- tables absentes ; `workflow_steps` est arrivée à `CRM-031`, `cards` arrive ici.
--
-- Deux harnais livrés par des unités précédentes **exigent** ce moment :
-- `scripts/verify-catalogue.sh` et `scripts/verify-workflows.sh` portent un contrôle dont le
-- message dit « si `cards` existe, la garde d'archivage doit être écrite ». Les laisser rouges
-- serait masquer ; les amender pour les rendre verts serait pire.
--
-- « ACTIVE » A UNE DÉFINITION, ET ELLE COMPTE : `archived_at is null and deleted_at is null`. Une
-- card archivée ou en corbeille **n'occupe pas** son étape. Sans cette définition, un nœud
-- deviendrait inarchivable dès qu'une seule card y serait passée un jour, ce qui viderait la garde
-- de son sens (docs/SPEC-cards.md §5).
--
-- `SECURITY DEFINER` : la garde doit juger sur **toutes** les cards, pas sur celles que la RLS de
-- l'appelant lui montre. Une garde soumise aux politiques de l'appelant laisserait archiver un nœud
-- occupé par des cards invisibles pour lui — précisément le cas qu'elle doit refuser.
--
-- ELLE NE SE DÉCLENCHE QU'AU PASSAGE de `archived_at` de `NULL` à une valeur. Un renommage, un
-- changement de couleur, une réactivation ne la réveillent pas : c'est le défaut qu'INC-031
-- redoutait — une garde qui ferait échouer toute mise à jour du catalogue.
--
-- `42501` est rendu `403` par PostgREST (mesuré, docs/SPEC-workflow-engine.md §4.4), et c'est le
-- code juste : l'opération est interdite, non malformée.

create or replace function app.catalogue_refuser_archivage_noeud_occupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	occupantes integer;
begin
	if old.archived_at is null and new.archived_at is not null then
		select count(*) into occupantes
		  from public.cards c
		  join public.workflow_steps s on s.id = c.current_step_id
		 where s.node_id      = new.id
		   and c.archived_at is null
		   and c.deleted_at  is null;

		if occupantes > 0 then
			raise exception
				'node_occupied : % card(s) active(s) se trouvent encore sur ce nœud', occupantes
				using errcode = 'insufficient_privilege';
		end if;
	end if;

	return new;
end;
$$;

comment on function app.catalogue_refuser_archivage_noeud_occupe() is
	'CRM-040 — docs/SPEC-cards.md §7, docs/SPEC-workflow-engine.md §2.6, INC-031. Trigger BEFORE '
	'UPDATE sur le catalogue : refuse l''archivage d''un nœud qu''une card ACTIVE occupe. Une card '
	'archivée ou en corbeille n''occupe rien.';

revoke all on function app.catalogue_refuser_archivage_noeud_occupe() from public;

drop trigger if exists workflow_nodes_catalog_refuser_archivage_occupe
	on public.workflow_nodes_catalog;
create trigger workflow_nodes_catalog_refuser_archivage_occupe
	before update on public.workflow_nodes_catalog
	for each row execute function app.catalogue_refuser_archivage_noeud_occupe();

-- =============================================================================================
-- 9. Retrait de l'outil de convergence
-- =============================================================================================
-- Laisser dans le schéma `app` une fonction capable de reconstruire n'importe quelle contrainte de
-- n'importe quelle table en ferait une surface publique que rien ne documente.

drop function if exists app.migration_0011_converger_contrainte(text, text, text);

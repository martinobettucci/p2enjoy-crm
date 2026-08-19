-- @spec CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire : modèle
-- @spec docs/SPEC-costs.md §1 (le modèle), §2.3 (card_costs), §3.1 (double condition de lecture),
--       §3.2 (écriture), §4.6 (section de la fiche), §5 (hors périmètre)
-- @spec docs/SCHEMA.md §9 bis.6 (card_costs), §9 bis.7 (politiques)
-- @spec docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §3.5 (une politique ne relit
--       pas sa propre table), §4 (familles de tables)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 51)
--
-- Une affaire porte AUTANT DE LIGNES DE COÛT qu'elle a de natures de dépense. Le cas qui a motivé
-- la demande, et qu'aucune colonne unique ne rendrait : « Publicité — estimé 100, réel inconnu »
-- et « Production — estimé 350, réel 375 », sur la MÊME affaire (`docs/SPEC-costs.md` §1).
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'AUTORISERA JAMAIS, ET C'EST ÉCRIT EN TÊTE.
-- ---------------------------------------------------------------------------------------------
-- 1. `actual_cost` NUL N'EST PAS ZÉRO (§2.3). Aucun défaut, aucune coercition, aucun `coalesce`
--    n'est posé ici : une dépense dont le réel n'est pas encore connu doit rester DISCERNABLE
--    d'une dépense nulle constatée. Confondre les deux ferait lire un retard de saisie comme une
--    économie, et c'est la principale façon dont l'histogramme de `CRM-086` mentirait.
--
-- 2. AUCUNE COLONNE `currency` (§2.3, `docs/SCHEMA.md` §9 bis.6). La devise d'une ligne est celle
--    de son budget. La porter ici permettrait d'additionner deux devises dans un même total, ce
--    qu'aucun écran ne saurait rendre honnêtement.
--
-- 3. AUCUNE UNICITÉ sur `(card_id, budget_id)` ni sur `(card_id, label)` (§2.3). Deux achats de
--    même nature restent deux lignes ; c'est à l'utilisateur de les nommer, pas au schéma de les
--    refuser.
--
-- 4. AUCUNE CONTRAINTE DE DATE. `period_start` et `period_end` d'une occurrence sont « purement
--    descriptives » (§2.2) : aucun trigger de ce fichier ne compare la date d'une dépense à la
--    période de son occurrence. Le rattachement est un CHOIX de l'utilisateur, pas une déduction.
--
-- 5. AUCUNE CONTRAINTE DE SIGNE sur les montants, même doctrine que `cards.amount` et
--    `budgets.planned_amount` : un avoir, une remise ou un remboursement sont des coûts négatifs
--    légitimes.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la table, ses contraintes de forme, ses index, le trigger de cohérence du rattachement
-- — récurrence, appartenance de l'occurrence au budget, clôtures —, le trigger qui tient
-- l'invariant de récurrence DEPUIS `budgets`, les deux fonctions d'appui `SECURITY DEFINER`, la
-- RLS activée, les quatre politiques nommées par action et les privilèges explicites.
--
-- Non livré, et NOMMÉ plutôt que tu :
--   * la section « Coûts » de la fiche d'affaire (`docs/SPEC-costs.md` §4.6) est la tranche 2 de
--     `CRM-085` ;
--   * les écrans de coûts et l'onglet « À saisir » (§4.2, §4.3, §4.5, §4.8) sont `CRM-086`.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage de la pile. Tout est donc écrit pour être rejouable : `create table if not
-- exists`, `create or replace function`, `drop trigger if exists` avant `create trigger`, `drop
-- policy if exists` avant `create policy`, et les contraintes de valeur posées de façon
-- **convergente** — `drop constraint if exists` puis `add constraint` — pour que la définition du
-- fichier fasse autorité à chaque passage (même patron que `CRM-084`).

-- =============================================================================================
-- 1. `public.card_costs` — les lignes de coût d'une affaire
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.6, docs/SPEC-costs.md §2.3.

create table if not exists public.card_costs (
	id             uuid        primary key default gen_random_uuid(),
	-- `cascade` : supprimer une affaire supprime ses lignes. Elles n'ont aucun sens sans elle, et
	-- la corbeille de `CRM-046` gouverne déjà le sort d'une affaire supprimée.
	card_id        uuid        not null references public.cards (id) on delete cascade,
	-- `restrict`, ET C'EST LA RÈGLE DE PRODUIT RENDUE STRUCTURELLE. « Un budget ne se supprime
	-- pas : il se clôture » (§3.2). `CRM-084` a laissé la suppression ouverte à l'administrateur
	-- pour qu'une erreur de saisie sur un budget VIERGE reste défaisable ; à partir d'ici, un
	-- budget qui PORTE des dépenses devient indestructible par la base elle-même. Les deux
	-- décisions se complètent : ce qui n'a rien coûté se défait, ce qui a coûté se clôture.
	budget_id      uuid        not null references public.budgets (id) on delete restrict,
	-- `restrict` pour la même raison, et c'est le seul choix cohérent avec le trigger du §3 : une
	-- occurrence détruite sous ses lignes laisserait `occurrence_id` nul sur un budget récurrent,
	-- c'est-à-dire l'invariant faux SANS qu'aucune ligne interdite n'ait jamais été écrite. Le
	-- §9 bis.6 de `docs/SCHEMA.md` ne nommait pas cette action référentielle ; elle est posée ici
	-- et écrite dans le même geste dans la spécification.
	occurrence_id  uuid        references public.budget_occurrences (id) on delete restrict,
	label          text        not null,
	-- OBLIGATOIRE, quand `actual_cost` ne l'est pas : c'est l'asymétrie du cas d'usage (§2.3). On
	-- engage une dépense en la PRÉVOYANT, on la constate plus tard. Une ligne sans estimé n'aurait
	-- rien à comparer.
	estimated_cost numeric(14,2) not null,
	-- NULLABLE, ET NUL N'EST PAS ZÉRO (§2.3). « Le réel, on le saisira après. »
	actual_cost    numeric(14,2),
	-- Trace, JAMAIS un droit : l'écriture d'une ligne est gouvernée par `app.can_write_card`, et
	-- l'auteur d'une ligne n'en obtient aucun privilège particulier. Même convention que
	-- `budgets.created_by` et `goal_blocks.created_by`.
	created_by     uuid        references public.profiles (id) on delete set null,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);

-- --- 1.1 Contraintes de valeur, posées de façon convergente -----------------------------------

alter table public.card_costs drop constraint if exists card_costs_label_check;
alter table public.card_costs add  constraint card_costs_label_check
	check (app.btrim_blancs(label) <> '');

comment on table public.card_costs is
	'CRM-085 — docs/SCHEMA.md §9 bis.6, docs/SPEC-costs.md §2.3. Ligne de coût d''une affaire, '
	'rattachée à un budget. Une affaire en porte autant qu''elle a de natures de dépense.';

comment on column public.card_costs.actual_cost is
	'NULLABLE, et nul n''est PAS zéro (docs/SPEC-costs.md §2.3) : un réel inconnu ne compte pas '
	'comme un réel nul dans les agrégats, et l''écran distingue les deux (§4.4).';

comment on column public.card_costs.occurrence_id is
	'Nul si le budget n''est pas récurrent, NON NUL s''il l''est — tenu par '
	'app.card_costs_verifier_rattachement, dans les deux sens (docs/SCHEMA.md §9 bis.6).';

comment on column public.card_costs.budget_id is
	'`on delete restrict` : un budget qui porte des dépenses est indestructible par la base '
	'elle-même (docs/SPEC-costs.md §3.2, « un budget ne se supprime pas : il se clôture »).';

-- --- 1.2 Index ---------------------------------------------------------------------------------
-- La section de la fiche (§4.6) lit par affaire ; les écrans de `CRM-086` lisent par budget puis
-- par occurrence ; l'onglet « À saisir » (§4.8) liste les lignes SANS réel, du plus ancien au plus
-- récent, sur toute la portée de l'écran — d'où l'index PARTIEL, qui ne porte que les lignes en
-- attente et reste petit quel que soit le volume des lignes soldées.

create index if not exists card_costs_card_idx
	on public.card_costs (card_id, created_at);

create index if not exists card_costs_budget_idx
	on public.card_costs (budget_id, occurrence_id);

create index if not exists card_costs_sans_reel_idx
	on public.card_costs (created_at, id)
	where actual_cost is null;

drop trigger if exists card_costs_set_updated_at on public.card_costs;
create trigger card_costs_set_updated_at
	before update on public.card_costs
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. Cohérence du rattachement — récurrence, appartenance, clôtures
-- =============================================================================================
-- `docs/SCHEMA.md` §9 bis.6 : « refus d'insertion sur un budget ou une occurrence CLÔTURÉS ;
-- l'occurrence appartient au budget cité » ; et `occurrence_id` « nul si le budget n'est pas
-- récurrent, non nul s'il l'est ».
--
-- CE TRIGGER TIENT QUATRE RÈGLES, ET LA QUATRIÈME EST CELLE QUE LA LECTURE RAPIDE MANQUE.
--
--   (a) `occurrence_id` est exigée SI ET SEULEMENT SI le budget est récurrent. Les deux sens : une
--       occurrence sur un budget simple est refusée, une occurrence absente sur un budget
--       récurrent aussi. Un budget récurrent SANS occurrence est légitime — il vient d'être créé —
--       mais aucune ligne ne peut lui être rattachée tant qu'il n'en porte pas (§2.2).
--
--   (b) L'occurrence citée APPARTIENT au budget cité. Sans cette règle, une ligne pourrait
--       rattacher « Janvier 2026 » de « Publicité » à l'enveloppe « Salon », et les deux vues de
--       `CRM-086` — agrégée par budget, détaillée par occurrence — cesseraient de sommer la même
--       chose.
--
--   (c) L'INSERTION est refusée sur un budget clôturé et sur une occurrence clôturée. Les lignes
--       déjà rattachées restent, intactes et lisibles : clôturer n'efface pas l'histoire (§2.3).
--
--   (d) LE CHANGEMENT DE RATTACHEMENT EST REFUSÉ DÈS QU'UN CÔTÉ EST CLOS, ET C'EST LA FRONTIÈRE
--       EXACTE DU §2.3. « On clôt une campagne PUIS les factures arrivent » : `actual_cost` et
--       `label` restent modifiables après la clôture, sans quoi il faudrait rouvrir le budget ou
--       renoncer à la seule donnée qui rend la comparaison honnête. Mais DÉPLACER une ligne
--       réécrirait un total déjà arrêté — des deux côtés à la fois : celui qu'elle quitte et celui
--       qu'elle rejoint. Le refus porte donc sur les DEUX, l'ancien rattachement comme le nouveau.
--       Une mise à jour qui ne touche NI `budget_id` NI `occurrence_id` ne rencontre aucune de ces
--       gardes, et c'est précisément ce que la spécification garantit.
--
-- `security definer` : la fonction lit `budgets` et `budget_occurrences`, dont la RLS masque ce
-- qui relève d'un track illisible. Sans `definer`, un appelant recevrait « budget introuvable » au
-- lieu du refus de sa politique — un message trompeur, et un aveu par l'erreur. Ici la politique
-- tranche d'abord, le trigger ensuite. Même raisonnement qu'au §4.1 de `0050_budgets.sql`.

create or replace function app.card_costs_verifier_rattachement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	recurrent      boolean;
	budget_clos    timestamptz;
	occ_budget     uuid;
	occ_close      timestamptz;
	ancien_clos    timestamptz;
	rattachement_change boolean;
begin
	select b.is_recurrent, b.closed_at
	  into recurrent, budget_clos
	  from public.budgets b
	 where b.id = new.budget_id;

	if recurrent is null then
		raise exception 'le budget « % » n''existe pas', new.budget_id
			using errcode = '23503';
	end if;

	-- (a) `occurrence_id` exigée si et seulement si le budget est récurrent.
	if recurrent and new.occurrence_id is null then
		raise exception
			'ce budget est récurrent : une ligne de coût doit citer une occurrence (docs/SPEC-costs.md §2.3)'
			using errcode = '23514';
	end if;

	if not recurrent and new.occurrence_id is not null then
		raise exception
			'ce budget n''est pas récurrent : une ligne de coût ne cite aucune occurrence (docs/SPEC-costs.md §2.3)'
			using errcode = '23514';
	end if;

	if new.occurrence_id is not null then
		select o.budget_id, o.closed_at
		  into occ_budget, occ_close
		  from public.budget_occurrences o
		 where o.id = new.occurrence_id;

		if occ_budget is null then
			raise exception 'l''occurrence « % » n''existe pas', new.occurrence_id
				using errcode = '23503';
		end if;

		-- (b) L'occurrence appartient au budget cité.
		if occ_budget <> new.budget_id then
			raise exception
				'cette occurrence appartient à un autre budget (docs/SPEC-costs.md §2.3)'
				using errcode = '23514';
		end if;
	end if;

	rattachement_change := tg_op = 'UPDATE'
		and (new.budget_id is distinct from old.budget_id
		     or new.occurrence_id is distinct from old.occurrence_id);

	-- (c) et (d) : les clôtures ne sont opposées qu'à l'insertion et au CHANGEMENT de
	-- rattachement, jamais à la mise à jour d'`actual_cost` ni du `label` (§2.3).
	if tg_op = 'INSERT' or rattachement_change then
		if budget_clos is not null then
			raise exception
				'ce budget est clôturé : il n''accepte aucun rattachement (docs/SPEC-costs.md §2.3)'
				using errcode = '23514';
		end if;

		if occ_close is not null then
			raise exception
				'cette occurrence est clôturée : elle n''accepte aucun rattachement (docs/SPEC-costs.md §2.3)'
				using errcode = '23514';
		end if;
	end if;

	-- (d), l'autre côté : la ligne ne QUITTE pas davantage un rattachement clos qu'elle n'en
	-- rejoint un. Sans ce contrôle, déplacer une ligne hors d'un budget clôturé réécrirait un
	-- total déjà arrêté, en le diminuant — l'inverse exact du cas interdit ci-dessus.
	if rattachement_change then
		select b.closed_at into ancien_clos
		  from public.budgets b
		 where b.id = old.budget_id;

		if ancien_clos is not null then
			raise exception
				'cette ligne est rattachée à un budget clôturé : son rattachement ne change plus (docs/SPEC-costs.md §2.3)'
				using errcode = '23514';
		end if;

		if old.occurrence_id is not null then
			select o.closed_at into ancien_clos
			  from public.budget_occurrences o
			 where o.id = old.occurrence_id;

			if ancien_clos is not null then
				raise exception
					'cette ligne est rattachée à une occurrence clôturée : son rattachement ne change plus (docs/SPEC-costs.md §2.3)'
					using errcode = '23514';
			end if;
		end if;
	end if;

	return new;
end;
$$;

alter function app.card_costs_verifier_rattachement() owner to postgres;

comment on function app.card_costs_verifier_rattachement() is
	'CRM-085 — docs/SCHEMA.md §9 bis.6, docs/SPEC-costs.md §2.3. Récurrence, appartenance de '
	'l''occurrence au budget, refus des clôtures à l''insertion ET au changement de rattachement. '
	'Ne s''oppose jamais à la mise à jour d''`actual_cost` ni du `label`.';

revoke all on function app.card_costs_verifier_rattachement() from public;

drop trigger if exists card_costs_verifier_rattachement on public.card_costs;
create trigger card_costs_verifier_rattachement
	before insert or update of budget_id, occurrence_id on public.card_costs
	for each row execute function app.card_costs_verifier_rattachement();

-- =============================================================================================
-- 3. L'INVARIANT DE RÉCURRENCE SE TIENT AUSSI DEPUIS `budgets` — LE PENDANT DE LA DÉCISION 471
-- =============================================================================================
-- `CRM-084` a posé `app.budgets_verifier_recurrence`, qui refuse de RETIRER la récurrence d'un
-- budget portant des occurrences. Son motif, écrit à la décision 471 : « une occurrence n'existe
-- que sur un budget récurrent » décrit un INVARIANT, et une garde posée d'un seul côté le laisse
-- devenir faux sans qu'aucune ligne interdite n'ait jamais été insérée.
--
-- LA MÊME BRÈCHE EXISTE DANS L'AUTRE SENS, ET C'EST `card_costs` QUI L'OUVRE. Rendre RÉCURRENT un
-- budget simple qui porte déjà des lignes de coût laisse ces lignes avec `occurrence_id` nul sur
-- un budget désormais récurrent : la règle (a) du §2 est alors fausse pour des lignes que le
-- trigger ne reverra jamais, et `CRM-086` sommerait par occurrence des lignes qui n'en ont pas.
--
-- Le trigger de `CRM-084` ne pouvait pas la fermer : `card_costs` n'existait pas. C'est donc à
-- cette migration de la fermer, dans un trigger DISTINCT et sur la même table — ils cohabitent,
-- chacun gardant le sens que sa migration connaît.
--
-- LE REMÈDE EST NOMMÉ DANS LE MESSAGE : sans lui, un administrateur qui lit « des lignes de coût
-- existent » ne sait pas si le produit lui demande de les supprimer, de les déplacer, ou s'il
-- vient de rencontrer un défaut. Ici le geste attendu est de créer d'abord l'occurrence — mais
-- elle exige un budget déjà récurrent —, donc de DÉTACHER les lignes, c'est-à-dire de les
-- supprimer ou de les rattacher ailleurs.

create or replace function app.budgets_verifier_recurrence_lignes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	lignes integer;
begin
	if not old.is_recurrent and new.is_recurrent then
		select count(*) into lignes
		  from public.card_costs c
		 where c.budget_id = new.id;

		if lignes > 0 then
			raise exception
				'ce budget porte % ligne(s) de coût sans occurrence : détachez-les avant de le rendre récurrent (docs/SPEC-costs.md §2.3)',
				lignes
				using errcode = '23514';
		end if;
	end if;

	return new;
end;
$$;

alter function app.budgets_verifier_recurrence_lignes() owner to postgres;

comment on function app.budgets_verifier_recurrence_lignes() is
	'CRM-085 — docs/SPEC-costs.md §2.3. Refuse de rendre récurrent un budget qui porte déjà des '
	'lignes de coût sans occurrence. Pendant de app.budgets_verifier_recurrence (CRM-084), qui '
	'garde le sens inverse.';

revoke all on function app.budgets_verifier_recurrence_lignes() from public;

drop trigger if exists budgets_verifier_recurrence_lignes on public.budgets;
create trigger budgets_verifier_recurrence_lignes
	before update of is_recurrent on public.budgets
	for each row execute function app.budgets_verifier_recurrence_lignes();

-- =============================================================================================
-- 4. Fonctions d'appui des politiques
-- =============================================================================================
-- `docs/SPEC-permissions-rls.md` §3.5 interdit qu'une politique relise sa propre table. Aucune de
-- celles du §5 ne le fait : elles lisent `cards` par `app.can_read_card` / `app.can_write_card`
-- (`CRM-040`, `CRM-036`), et `budgets` par `app.can_read_budget` (`CRM-084`) et par la fonction
-- ci-dessous.
--
-- `SECURITY DEFINER` pour la raison de la décision 27 : une fonction `invoker` appelée depuis la
-- politique de `card_costs` rejouerait la RLS de `budgets` à chaque ligne, qui rejouerait à son
-- tour `app.can_read_track`.

-- --- 4.1 Le budget est-il OUVERT ---------------------------------------------------------------
-- SÉPARÉE DE `app.can_read_budget`, ET CE N'EST PAS UNE COMMODITÉ. Les deux conditions ne portent
-- pas sur les mêmes gestes : la LECTURE d'une ligne n'exige que le budget lisible (§3.1), tandis
-- que sa CRÉATION exige en outre qu'il soit ouvert (§3.2, `docs/SCHEMA.md` §9 bis.7). Les fondre
-- rendrait invisibles les lignes des budgets clôturés — exactement ce que le §2.3 interdit :
-- « les lignes déjà rattachées restent, intactes et lisibles ».
--
-- Elle ne dit RIEN du droit : un budget illisible et ouvert lui rend vrai. C'est délibéré — la
-- politique compose les deux conditions, et chacune reste lisible pour ce qu'elle est.

create or replace function app.budget_est_ouvert(budget uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.budgets b
		 where b.id = budget
		   and b.closed_at is null
	);
$$;

alter function app.budget_est_ouvert(uuid) owner to postgres;

comment on function app.budget_est_ouvert(uuid) is
	'CRM-085 — docs/SPEC-costs.md §3.2. Le budget est-il ouvert ? Ne dit RIEN du droit de lecture, '
	'que app.can_read_budget porte seul : la politique compose les deux.';

revoke all on function app.budget_est_ouvert(uuid) from public;

-- `EXECUTE` à `anon` pour la raison de `CRM-084` §5.3 : une politique RLS est évaluée avec les
-- droits du rôle courant, et un appelant anonyme dépourvu d'`EXECUTE` recevrait une ERREUR DE
-- PRIVILÈGE au lieu du refus silencieux attendu — une table vide, jamais un aveu.
grant execute on function app.budget_est_ouvert(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 5. Row Level Security
-- =============================================================================================
-- docs/SCHEMA.md §9 bis.7. Refus par défaut : la RLS est activée et aucune politique n'est
-- implicite.

alter table public.card_costs enable row level security;

-- --- 5.1 Lecture : LA DOUBLE CONDITION, ET LE CAS QUI LA MOTIVE --------------------------------
-- `docs/SPEC-costs.md` §3.1 : « l'appelant lit LA CARD et LE BUDGET ». Ce n'est PAS une précaution
-- redondante, et le cas qui la motive est concret : une card et un budget peuvent relever de deux
-- tracks dont l'appelant ne lit que l'un.
--
--   * rendre la ligne au vu du seul droit sur la CARD révélerait le nom et le montant d'un budget
--     interdit ;
--   * la rendre au vu du seul droit sur le BUDGET révélerait l'existence d'une affaire.
--
-- Le seed pose exactement ce cas — « Prospection sortante » vit sur un track que la lectrice ne
-- lit pas —, et la DoD de `CRM-085` exige qu'il soit PROUVÉ : une card lisible rattachée à un
-- budget d'un track fermé rend ZÉRO ligne.

drop policy if exists card_costs_lecture_card_et_budget on public.card_costs;
create policy card_costs_lecture_card_et_budget
	on public.card_costs
	for select
	to anon, authenticated
	using (app.can_read_card(card_id) and app.can_read_budget(budget_id));

-- --- 5.2 Insertion : écrire la card, LIRE le budget, et le budget OUVERT ------------------------
-- `docs/SPEC-costs.md` §3.2 : « quiconque a `app.can_write_card(card_id)` », et « une ligne de
-- coût exige en outre que le budget soit lisible et ouvert ». C'est la ligne de partage du
-- sous-système, arbitrée le 2026-08-19 : le BUDGET est un cadre — administrateur du workspace —,
-- l'AFFECTATION est un geste quotidien — quiconque travaille l'affaire.
--
-- `app.can_read_budget` et non `app.can_write_budget` : on rattache une dépense à une enveloppe
-- qu'on a le droit de VOIR, sans avoir celui de la modifier. Exiger l'écriture du budget
-- reviendrait à réserver toute affectation aux administrateurs, c'est-à-dire à bloquer le travail
-- quotidien que cet arbitrage protège.
--
-- LA CLÔTURE EST OPPOSÉE ICI *ET* PAR LE TRIGGER DU §2, et les deux couches ne font pas double
-- emploi : la politique parle la première et rend `403` à l'appelant HTTP, le trigger tient la
-- même règle pour tout écrivain qui traverse la RLS — `service_role`, une fonction `definer`, une
-- migration. Une garde qui ne vivrait que dans la politique serait franchissable par la clé de
-- service, dont le seed et les fonctions Edge se servent.

drop policy if exists card_costs_insertion_ecriture_card on public.card_costs;
create policy card_costs_insertion_ecriture_card
	on public.card_costs
	for insert
	to authenticated
	with check (
		app.can_write_card(card_id)
		and app.can_read_budget(budget_id)
		and app.budget_est_ouvert(budget_id)
	);

-- --- 5.3 Mise à jour : LE BUDGET CLOS N'EST PAS OPPOSÉ, ET C'EST LE §2.3 ------------------------
-- « Leur `actual_cost` reste modifiable après la clôture. On clôt une campagne PUIS les factures
-- arrivent. » Exiger `app.budget_est_ouvert` ici obligerait à rouvrir le budget pour saisir un
-- réel, ou à renoncer à la seule donnée qui rend la comparaison honnête — et viderait de son sens
-- l'onglet « À saisir » du §4.8, qui liste précisément les lignes des budgets clôturés.
--
-- CE QUI RESTE INTERDIT SUR UN BUDGET CLOS, C'EST LE DÉPLACEMENT, et c'est le trigger du §2 qui le
-- tient — pas cette politique. La frontière est exacte : `actual_cost` et `label` oui,
-- `budget_id` et `occurrence_id` non.
--
-- `using` ET `with check` portent la même condition : sans le `with check`, une ligne pourrait
-- être déplacée vers une card qu'on n'écrit pas ou vers un budget qu'on ne lit pas, ce qui serait
-- une porte de sortie du cloisonnement.

drop policy if exists card_costs_maj_ecriture_card on public.card_costs;
create policy card_costs_maj_ecriture_card
	on public.card_costs
	for update
	to authenticated
	using      (app.can_write_card(card_id) and app.can_read_budget(budget_id))
	with check (app.can_write_card(card_id) and app.can_read_budget(budget_id));

-- --- 5.4 Suppression : comme l'insertion, budget OUVERT exigé -----------------------------------
-- `docs/SCHEMA.md` §9 bis.7 pose « budget lisible et OUVERT » pour l'écriture, et le §2.3 n'ouvre
-- d'exception que pour la mise à jour d'`actual_cost` et du `label`. Supprimer une ligne d'un
-- budget clôturé retirerait une dépense d'un total déjà arrêté : c'est le même geste que le
-- déplacement interdit au §2 (d), et il reçoit le même refus.
--
-- Une ligne posée par erreur sur un budget OUVERT reste, elle, librement supprimable par quiconque
-- écrit l'affaire.

drop policy if exists card_costs_suppression_ecriture_card on public.card_costs;
create policy card_costs_suppression_ecriture_card
	on public.card_costs
	for delete
	to authenticated
	using (
		app.can_write_card(card_id)
		and app.can_read_budget(budget_id)
		and app.budget_est_ouvert(budget_id)
	);

-- =============================================================================================
-- 6. Privilèges explicites
-- =============================================================================================
-- `revoke all` puis `grant` par action, de sorte que le comportement du produit ne dépende pas des
-- privilèges par défaut de la distribution (même patron que `CRM-084`).

revoke all on public.card_costs from anon, authenticated;
grant select                 on public.card_costs to anon, authenticated;
grant insert, update, delete on public.card_costs to authenticated;
grant all privileges         on public.card_costs to service_role;

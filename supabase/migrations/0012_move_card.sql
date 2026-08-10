-- @spec CRM-034 (docs/BACKLOG.md) — `move_card`, garde centrale de transition
-- @spec docs/SPEC-workflow-engine.md §5.2 (signature), §5.3 (les six vérifications), §5.4 (effets),
--       §5.5 (protection de colonne), §5.6 (privilèges), §5.7 (la n° 6 non livrable)
-- @spec docs/SCHEMA.md §3 (workflows, étapes, transitions), §5 (cards), §9 (fonctions)
-- @spec docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`), §5 (« active »)
-- @spec docs/SPEC-permissions-rls.md §3.3 (droits effectifs sur un channel), §7 (refus n° 1, n° 5)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/INCONSISTENCY_REPORT.md INC-047 (vérification n° 6 non livrable — `CRM-036`),
--       INC-048 (le commentaire fourni n'est conservé nulle part — `CRM-043`),
--       INC-049 (chevauchement de Definition of Done avec `CRM-013`),
--       INC-050 (le §5.5 se contredit sur `email_local_part`)
--
-- Depuis `CRM-040`, `cards.current_step_id` s'écrit par un simple `PATCH` : une card franchit une
-- arête que personne n'a déclarée. La Definition of Done de `CRM-040` le nomme plutôt que de le
-- taire. Cette migration ferme le passage, et c'est **le premier endroit du produit où le graphe
-- du workflow devient opposable** (docs/SPEC-workflow-engine.md §5.1).
--
-- ---------------------------------------------------------------------------------------------
-- La garde ne vaut que par la porte qu'elle ferme, et la fermer est la moitié de l'unité.
-- ---------------------------------------------------------------------------------------------
-- Une fonction que l'on contourne par un `PATCH` n'est pas une garde : c'est une commodité que
-- seuls les clients bien intentionnés empruntent. La section 2 retire donc à `authenticated` le
-- privilège `UPDATE` sur **la colonne** `current_step_id`, ce que PostgreSQL n'exprime que par un
-- `revoke` de table suivi d'un `grant` colonne par colonne. Sans elle, les cinq vérifications de
-- la section 1 ne s'appliqueraient qu'à ceux qui veulent bien passer par elles.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : la fonction `public.move_card`, **cinq** de ses six vérifications, la mise à jour
-- d'`entered_step_at` et de `position`, le privilège de colonne de `current_step_id`, et les
-- privilèges explicites de la fonction.
--
-- Non livré, et nommé — chaque manque est **figé par une assertion** de
-- `supabase/tests/0013_move_card.test.sql`, qui deviendra rouge le jour où l'unité qui le porte
-- livre son objet (mécanisme de la décision 51) :
--
--   * la **vérification n° 6** — « les champs requis de l'étape cible sont renseignés ». L'ensemble
--     exigé est calculable ; l'ensemble **renseigné** n'a aucune source, `card_field_values` étant
--     le livrable de `CRM-036`. MESURÉ : `to_regclass('public.card_field_values')` rend `NULL`.
--     Les deux écritures possibles sont écartées au §5.7 : refuser toute transition dont l'ensemble
--     exigé n'est pas vide interdirait — MESURÉ sur le seed — les entrées en négociation, en
--     signature et les **quatre** transitions « Marquer perdu » ; prétendre vérifier sans vérifier
--     est le faux vert que `CLAUDE.md` §17 proscrit. La n° 6 n'est donc **pas écrite**, et le
--     message « liste des clés manquantes » naîtra avec elle. INC-047 ;
--
--   * l'**écriture du commentaire fourni**. La vérification n° 5 l'exige, cette fonction le
--     contrôle, et rien ne le conserve : `card_comments` est livrée par `CRM-043`. Un utilisateur
--     qui motive une affaire perdue verra sa transition acceptée et son motif disparaître.
--     INC-048 ;
--
--   * le `card_event` de type `moved` : `card_events` est livrée par `CRM-044`. La trace du
--     déplacement n'existe pas ;
--
--   * l'**arrêt des cadences de relance** : aucune table de cadence n'existe, et **aucune unité du
--     backlog n'en porte** ;
--
--   * la protection d'`email_local_part`, qui **reste à `CRM-013`** — voir la section 2.3.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). `drop … if exists` précède la création :
-- `create or replace function` refuse de renommer un paramètre. La section 2 réapplique les
-- privilèges de colonne à chaque rejeu, de sorte qu'un `grant update on public.cards` relâché à la
-- main soit **réparé** et non seulement laissé en l'état (décision 57).

-- =============================================================================================
-- 1. `public.move_card`
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §5.2 et §5.3.
--
-- `SECURITY DEFINER` n'est pas une facilité, et ici moins qu'ailleurs : c'est le mécanisme même de
-- la garde. Le privilège de colonne posé en section 2 s'applique au rôle qui exécute
-- l'instruction ; une fonction `SECURITY DEFINER` s'exécute avec les droits de son **propriétaire**.
-- La fonction écrit donc précisément ce que son appelant ne peut pas écrire (§5.5).
--
-- Elle porte par conséquent **elle-même** sa règle d'accès, par les vérifications 1.1 et 1.2 : les
-- politiques RLS de `cards` ne s'appliquent pas au propriétaire de la table, donc elle les
-- contourne par construction et ne peut rien leur déléguer.
--
-- `search_path` vidé : toute relation est pleinement qualifiée, y compris `auth.uid()` atteinte à
-- travers les fonctions du schéma `app`.

drop function if exists public.move_card(uuid, uuid, text);

create function public.move_card(
	card_id    uuid,
	to_step_id uuid,
	comment    text default null
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Les arguments sont recopiés dans des variables locales **avant tout usage**, comme dans
	-- `copy_workflow_to_track` : `card_id` et `to_step_id` sont aussi des noms de colonnes des
	-- tables lues plus bas, et PL/pgSQL refuse une référence ambiguë (`42702`) plutôt que d'en
	-- choisir une.
	v_card_id uuid := card_id;
	v_cible   uuid := to_step_id;
	-- « Un commentaire vide n'est pas un commentaire » (§5.3). Sans cette normalisation, la règle
	-- « la raison d'une affaire perdue est exigée » se satisferait d'une barre d'espace.
	v_comment text := nullif(btrim(comment), '');
	v_card    public.cards%rowtype;
	v_transition public.workflow_transitions%rowtype;
begin
	-- --- 1.1 La card existe, est visible de l'appelant, et elle est **active** ------------------
	-- « Visible » signifie `app.can_read_channel` sur le channel de la card
	-- (docs/SPEC-permissions-rls.md §3.3), et cette vérification passe **avant** celle du droit
	-- d'écriture : une card d'un autre workspace, ou d'un channel fermé par un droit fin, rend
	-- `card_not_found`, jamais `forbidden`. Répondre « interdit » confirmerait son existence à
	-- quelqu'un qui n'a pas le droit de la connaître. C'est la règle de discrétion du §4.3, reprise
	-- et non réinventée (docs/JOURNAL.md, décision 82).
	--
	-- « ACTIVE » A LA MÊME DÉFINITION QU'AILLEURS : `archived_at is null and deleted_at is null`
	-- (docs/SPEC-cards.md §5), celle qu'emploie déjà la garde d'archivage d'un nœud occupé. Une
	-- card qu'on a rangée ne se déplace pas ; on la restaure d'abord. Elle est donc traitée comme
	-- **absente**, et non par un refus qui lui serait propre : le client qui la voit dans sa
	-- corbeille sait déjà pourquoi.
	--
	-- `P0001` par défaut, donc `400` — MESURÉ (§4.4). `P0002`, le code naturel pour « rien ne
	-- correspond », est rendu **`500`** par PostgREST et serait lu comme une panne du produit.
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- --- 1.2 L'appelant a le droit d'écriture sur le channel de la card ------------------------
	-- `app.can_write_channel` exige `= 'write'` ; `app.can_read_channel` exige `<> 'none'`. La 1.1
	-- ayant réussi, un refus ici désigne bien un lecteur, et non un inconnu. `42501` → `403`,
	-- MESURÉ. C'est la **preuve de refus n° 1** de docs/SPEC-permissions-rls.md §7.
	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 1.3 L'étape cible existe et appartient au workflow de la card -------------------------
	-- CETTE VÉRIFICATION EST DÉJÀ TENUE PAR LA BASE, ET ELLE EST REFAITE QUAND MÊME. La clé
	-- composite `cards (current_step_id, workflow_id) → workflow_steps (id, workflow_id)` livrée
	-- par `CRM-040` la garantit sans exception, y compris contre un `PATCH` direct. La refaire
	-- n'ajoute aucune garantie : elle ajoute **un message** — `step_not_in_workflow` plutôt qu'un
	-- `23503` brut nommant une contrainte — et **une place dans l'ordre**, avant la 1.4, de sorte
	-- qu'une étape d'un autre workflow ne soit jamais rapportée comme une « transition non
	-- déclarée », ce qui enverrait le client chercher une arête à créer là où le problème est
	-- ailleurs (§5.3).
	if not exists (
		select 1
		  from public.workflow_steps s
		 where s.id = v_cible
		   and s.workflow_id = v_card.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- --- 1.4 Une transition est déclarée de l'étape courante vers la cible ---------------------
	-- L'objet même de la garde. `workflow_transitions_distinct_check` interdit déjà une arête d'une
	-- étape vers elle-même, donc un déplacement « sur place » ne trouve aucune transition et est
	-- refusé ici — ce qui est le comportement voulu : ne rien faire n'est pas un déplacement.
	--
	-- La ligne entière est chargée, et non un simple `exists` : la 1.5 a besoin de
	-- `require_comment`, et la relire serait une seconde lecture de la même arête.
	select t.* into v_transition
	  from public.workflow_transitions t
	 where t.workflow_id  = v_card.workflow_id
	   and t.from_step_id = v_card.current_step_id
	   and t.to_step_id   = v_cible;

	if not found then
		raise exception 'transition_not_allowed';
	end if;

	-- --- 1.5 Le commentaire est fourni si la transition l'exige --------------------------------
	-- `v_comment` est déjà normalisé : une chaîne d'espaces vaut `NULL` ici.
	if v_transition.require_comment and v_comment is null then
		raise exception 'comment_required';
	end if;

	-- --- 1.6 LA VÉRIFICATION N° 6 N'EST PAS ÉCRITE, ET C'EST DÉLIBÉRÉ -------------------------
	-- docs/SPEC-workflow-engine.md §5.7, INC-047. `card_field_values` est le livrable de `CRM-036`.
	-- L'ensemble des champs **exigés** est calculable dès aujourd'hui — les règles `required` de
	-- l'étape cible, plus les liaisons de `v_transition` ; l'ensemble des champs **renseignés** n'a
	-- aucune source. Aucune des deux écritures possibles n'est tenable, et prétendre vérifier
	-- serait pire que ne pas vérifier. L'écart est figé par une assertion de la suite pgTAP.

	-- --- 1.7 L'écriture -------------------------------------------------------------------------
	-- `position` est **recalculée**, et ce n'est pas un ajout de périmètre : docs/SPEC-cards.md §2.6
	-- définit sa portée comme le couple `(channel_id, current_step_id)` — une colonne du board.
	-- Changer l'étape sans recalculer laisserait la card dans une portée où sa valeur n'a jamais été
	-- attribuée : deux cards y porteraient le même rang. Le trigger d'attribution de `CRM-040` est
	-- un `BEFORE INSERT` ; il ne voit pas les déplacements. La card est placée **en fin** de la
	-- colonne d'arrivée, exactement comme une card qui y naîtrait — même expression que
	-- `app.cards_attribuer_position()`, et elle ne se compte pas elle-même, sa `position` courante
	-- appartenant à la colonne de départ.
	--
	-- `entered_step_at` est remise à `now()` : docs/SPEC-cards.md §2.9 la réserve **nommément** à
	-- `move_card`, et c'est ici qu'elle prend son sens.
	--
	-- `updated_at` n'est pas écrite ici : le trigger `app.set_updated_at()` de `CRM-040` s'en charge.
	update public.cards c
	   set current_step_id = v_cible,
	       entered_step_at = now(),
	       position        = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.cards autre
	            where autre.channel_id      = v_card.channel_id
	              and autre.current_step_id = v_cible
	       )
	 where c.id = v_card_id
	returning c.* into v_card;

	-- **Elle rend la ligne mise à jour**, et non `void`. MESURÉ contre PostgREST `v14.12` : une
	-- fonction rendant un type composite `public.cards` est rendue par l'API comme un objet JSON
	-- unique, non comme un tableau. Le client obtient l'étape, `entered_step_at` et `position`
	-- recalculés en une requête, sans relecture qu'une politique pourrait entre-temps refuser.
	--
	-- Sans conséquence sur la confidentialité, et ce n'est pas une intuition : la 1.2 ayant réussi,
	-- la 1.1 l'a précédée, donc l'appelant a le droit de lire cette ligne (§5.2).
	return v_card;
end;
$$;

alter function public.move_card(uuid, uuid, text) owner to postgres;

comment on function public.move_card(uuid, uuid, text) is
	'CRM-034 — docs/SPEC-workflow-engine.md §5. Seul chemin par lequel une card change d''étape : '
	'le graphe du workflow y devient opposable. Refus : card_not_found, forbidden, '
	'step_not_in_workflow, transition_not_allowed, comment_required. La sixième vérification — '
	'champs requis renseignés — n''est PAS écrite : card_field_values est due par CRM-036 '
	'(INC-047). Le commentaire fourni n''est conservé nulle part (INC-048, CRM-043).';

-- --- 1.8 Privilèges de la fonction ------------------------------------------------------------
-- docs/SPEC-workflow-engine.md §5.6, et trois faits mesurés.
--
-- `revoke … from public` NE SUFFIT PAS, et c'est mesuré (décision 80) : l'image Supabase pose des
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accordent `EXECUTE` **nommément** à `anon`,
-- `authenticated` et `service_role` sur toute fonction nouvelle. Une fonction « protégée » par le
-- seul `revoke all … from public` reste exécutable par la clé anonyme. Le `revoke` doit viser
-- `public` **et** `anon`, comme `copy_workflow_to_track` le fait depuis cette décision.
--
-- `EXECUTE` n'est accordé qu'à `authenticated`. Contrairement aux fonctions `app.can_*`, appelées
-- **depuis des politiques** et qui doivent donc être exécutables par `anon` pour que le refus se
-- manifeste par zéro ligne, `move_card` est appelée **directement** par un client : lui refuser le
-- privilège est le comportement voulu.
--
-- Le refus de l'appelant anonyme rend alors `401`, non `403` — MESURÉ : PostgREST traite l'absence
-- de droit d'un appelant non authentifié comme une invitation à s'authentifier (§4.4). Le refus est
-- donc double — privilège, puis vérification 1.2 —, et le premier suffit.

revoke all on function public.move_card(uuid, uuid, text) from public, anon;
grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;

-- =============================================================================================
-- 2. La protection de colonne, sans laquelle la garde ne garde rien
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §5.5. Tant qu'`authenticated` détient `UPDATE` sur **toute** la
-- table `cards`, la section 1 est facultative. C'est la **preuve de refus n° 5** de
-- docs/SPEC-permissions-rls.md §7 — « mise à jour directe de `cards.current_step_id` par PostgREST
-- → refus » —, qui figure dans la Definition of Done de `CRM-034` **et** dans celle de `CRM-013`.
-- Le chevauchement est réel, il est consigné (INC-049), et il est tranché du côté de `CRM-034` :
-- une unité dont la Definition of Done exige une preuve doit livrer ce qui la rend possible.
--
-- --- 2.1 Le mécanisme -------------------------------------------------------------------------
-- Le privilège `UPDATE` de PostgreSQL s'accorde colonne par colonne, mais il ne se **retire** pas
-- colonne par colonne d'un privilège de table : `revoke update (col) on t from r` ne fait rien
-- lorsque `r` détient l'`UPDATE` de la table entière. Le seul chemin est donc de retirer le
-- privilège de table, puis de rendre nommément les colonnes qui doivent rester ouvertes.
--
-- --- 2.2 Ce que le rejeu répare ---------------------------------------------------------------
-- Le `revoke` porte sur `update` seulement : `select` et `insert`, posés par la migration 0011,
-- sont laissés intacts. Un rejeu de la migration réapplique l'ensemble, donc un
-- `grant update on public.cards to authenticated` relâché à la main est **réparé** au prochain
-- démarrage de la pile, et non seulement laissé en l'état.

revoke update on public.cards from authenticated;

-- --- 2.3 Les colonnes qui restent ouvertes, et la seule qui surprenne --------------------------
-- La liste est celle du §5.5, à une exception **nommée** : `email_local_part` y est ajoutée.
--
-- LE §5.5 SE CONTREDIT SUR CETTE COLONNE, ET LA CONTRADICTION N'EST PAS RÉSOLUE ICI — INC-050. Son
-- bloc `GRANT` ne la liste pas, ce qui la fermerait ; sa prose énumère au contraire, sous « Ce qui
-- n'est PAS livré par `CRM-034`, et reste à `CRM-013` », « `email_local_part`, dont l'écriture
-- directe reste ouverte », et conclut « Seule la colonne que cette garde protège est traitée ici ».
--
-- `CLAUDE.md` §5 tranche le cas d'une contradiction relevée en relecture : la consigner, et
-- **laisser le comportement inchangé**. La colonne reste donc ouverte, exactement comme depuis
-- `CRM-040`, et l'assertion de `supabase/tests/0012_cards.test.sql` qui constate ce manque reste
-- verte jusqu'à `CRM-013` — l'unité qui le porte. La fermer ici livrerait la moitié d'une autre
-- unité en silence, et laisserait sa Definition of Done à demi faite sans que rien ne le dise.
--
-- Les colonnes absentes de cette liste sont fermées par voie de conséquence : `id`, `workspace_id`,
-- `channel_id`, `workflow_id`, `entered_step_at`, `health_score`, `created_by`, `created_at`,
-- `updated_at`. Aucune n'est écrite par le client aujourd'hui — `updated_at` est posée par un
-- trigger, `health_score` n'est jamais alimentée, et les quatre identifiants de rattachement sont
-- déjà tenus cohérents par les clés composites de `CRM-040`. `search_tsv` est générée et n'a
-- jamais été modifiable. Fermer ces colonnes n'est pas un choix mais une conséquence du mécanisme
-- du §2.1 : on ne retire pas `current_step_id` sans nommer ce qu'on rend.

grant update (
	title, description, position, owner_id, amount, currency,
	probability_override, next_action, next_action_at, snoozed_until,
	archived_at, deleted_at,
	-- INC-050 — ouverte à dessein, jusqu'à `CRM-013`. Voir 2.3.
	email_local_part
) on public.cards to authenticated;

-- `service_role` conserve `all privileges` de la migration 0011 : le `revoke` ci-dessus ne vise
-- qu'`authenticated`. Le seed, qui écrit avec la clé de service, est donc **inchangé** — et
-- docs/SPEC-workflow-engine.md §5.9 l'annonce : le graphe seedé fournit déjà les transitions
-- déclarées, les paires d'étapes non reliées et les quatre transitions à commentaire.

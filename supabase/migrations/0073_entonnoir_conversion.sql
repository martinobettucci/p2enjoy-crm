-- @spec CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré, TRANCHE 2 a :
--       l'agrégat descend en base
-- @spec docs/SPEC-analytique.md §3 (probabilité effective, résolution à trois niveaux et absence
--       assumée), §4 (les deux exclusions, et l'inclusion du sommeil), §5.1 (signature et grain),
--       §5.2 (aucun paramètre de portée), §5.3 (`security invoker` obligatoire), §5.4 (`anon`
--       révoqué nommément), §5.5 (ce que la fonction ne fait pas), §6 (contrat d'API)
-- @spec docs/SCHEMA.md §4 (`workflow_steps`, `workflow_nodes_catalog`), §5 (`cards`),
--       §9 bis.11 (contrat de cette fonction)
-- @spec docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §7 (le refus est ZÉRO LIGNE)
-- @spec docs/SPEC-costs.md §2.3 (« nul n'est pas zéro »), §4.5 (un cumul se calcule APRÈS la RLS)
-- @spec docs/SPEC-relances.md §2.2 (une valeur absente n'est jamais remplacée par un défaut)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 73)
--
-- CETTE MIGRATION AJOUTE UNE SEULE FONCTION, ET NE CRÉE AUCUNE TABLE.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI L'AGRÉGAT EST ICI, ET NON DANS LA WEBAPP (docs/SPEC-analytique.md §5.2).
-- ---------------------------------------------------------------------------------------------
-- Deux contraintes se rencontrent, et une seule forme les satisfait toutes les deux.
--
-- 1. `docs/SPEC-costs.md` §4.5 : « le cumul est calculé APRÈS application de la RLS, jamais avant.
--    Un total qui inclurait un budget interdit le divulguerait par soustraction. » La règle vaut
--    identiquement pour un prévisionnel : additionner avec la clé de service rendrait à chacun le
--    portefeuille de tout le monde.
--
-- 2. `CLAUDE.md` §21 : un écran ne télécharge pas toutes les affaires pour en écarter la
--    quasi-totalité côté client. `webapp/src/lib/couts-ecrans.ts` le fait pour les coûts, et le
--    peut : les lignes de coût d'un budget sont bornées par le budget. Le portefeuille d'un
--    workspace ne l'est par rien.
--
-- `SECURITY INVOKER` réconcilie les deux : l'agrégat s'exécute en base, sous l'identité de
-- l'appelant, et la RLS de `cards` filtre AVANT le `group by`. Le résultat est borné par
-- `channels × nœuds × devises présentes` — HUIT lignes sur le seed pour 39 affaires — et non par le
-- nombre d'affaires.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'EST PAS.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UNE AUTORISATION NOUVELLE. `SECURITY INVOKER` : la fonction n'ajoute aucune règle
--    d'accès et hérite intégralement de la politique de lecture de `cards`, donc des droits fins de
--    `CRM-012`. MESURÉ le 2026-08-30 sur le seed (docs/SPEC-analytique.md M7) : l'administratrice et
--    le business developer lisent 39 affaires actives, la lectrice 35 — le track `conseil-ia` lui
--    est fermé et seul son channel `prospection` lui est rouvert.
--
-- 2. CE N'EST PAS L'ÉCRAN. Aucune route n'est ajoutée. `/pilotage` est la tranche 3, et sa
--    spécification visuelle est écrite AVANT son code, dans `docs/DESIGN_SYSTEM.md`.
--
-- 3. CE N'EST PAS LE SCORE DE SANTÉ. `cards.health_score` reste alimentée par rien. `CRM-P02` est la
--    tranche 4, et elle commence par son arbitrage (docs/SPEC-analytique.md §11.4).
--
-- 4. AUCUNE TABLE N'EST CRÉÉE NI MODIFIÉE, aucune colonne n'est ajoutée, aucune politique n'est
--    touchée, aucun trigger n'est posé, aucune ligne n'est écrite. Le point de sûreté des migrations
--    48 à 52 — les `alter default privileges` de la plateforme — ne porte donc sur aucune table ici,
--    MAIS IL PORTE SUR LA FONCTION : voir le bloc de privilèges en bas de fichier.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du répertoire
-- à chaque démarrage de la pile (`docs/DAT.md` §3.2). `create or replace function` puis `revoke` et
-- `grant` nominatifs sont rejouables sans effet de bord.

-- =============================================================================================
-- 1. `public.entonnoir_conversion()` — le portefeuille de l'appelant, par nœud et par devise
-- =============================================================================================
-- docs/SPEC-analytique.md §5.1.

create or replace function public.entonnoir_conversion()
returns table (
	workspace_id uuid,
	track_id uuid,
	channel_id uuid,
	node_id uuid,
	node_key text,
	node_label text,
	node_kind text,
	node_position numeric,
	currency text,
	affaires integer,
	affaires_sans_montant integer,
	affaires_sans_probabilite integer,
	montant numeric,
	montant_pondere numeric
)
language sql
-- `STABLE` : le corps ne lit pas `now()`, mais il lit des tables — `immutable` serait faux. Et non
-- `VOLATILE` : PostgREST n'expose en `GET` que les fonctions non volatiles, et une fonction volatile
-- perdrait le droit d'être appelée dans un contexte de lecture seule.
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI LE POINT MÊME DE LA FONCTION (§5.3).
--
-- En `DEFINER`, cette fonction répondrait pour `postgres`, qui traverse toute la RLS, et rendrait
-- donc à CHAQUE appelant le portefeuille de tout le monde, channels fermés compris. Un total est une
-- divulgation : un prévisionnel qui inclut une affaire interdite la divulgue par soustraction. En
-- `INVOKER`, la fonction n'ajoute AUCUNE règle : elle hérite d'`app.can_read_card`, et le refus se
-- mesure comme ZÉRO LIGNE, jamais comme une erreur.
--
-- `search_path` VIDE : tous les objets du corps sont pleinement qualifiés, comme
-- `public.cards_figees`, `public.etat_messagerie` et `public.inbox_arborescence`.
set search_path to ''
as $$
	select c.workspace_id,
	       ch.track_id,
	       c.channel_id,
	       n.id,
	       n.key,
	       -- LE LIBELLÉ DU CATALOGUE, JAMAIS `workflow_steps.label_override` (§5.1). Une étape
	       -- renomme son nœud À L'INTÉRIEUR d'un workflow ; l'entonnoir compare des affaires À
	       -- TRAVERS les workflows — c'est la raison pour laquelle `docs/MASTER_PLAN.md` §2 pose que
	       -- cette unité exige le catalogue partagé de `CRM-030`. Rendre le libellé de l'étape ferait
	       -- porter deux noms à une même ligne dès que deux workflows renomment le même nœud.
	       n.label,
	       n.kind,
	       n."position",
	       c.currency,
	       count(*)::integer,
	       -- CE QUE LE TOTAL NE DIT PAS, ET QUE L'ÉCRAN DOIT DIRE (§7.3). Un montant absent n'est
	       -- pas zéro (`docs/SPEC-costs.md` §2.3) : l'affaire est comptée, et son absence l'est
	       -- séparément. Sans ces deux compteurs, un prévisionnel bas se lirait comme un
	       -- portefeuille pauvre au lieu d'un portefeuille mal renseigné.
	       count(*) filter (where c.amount is null)::integer,
	       count(*) filter (
	           where coalesce(c.probability_override,
	                          s.probability_override,
	                          n.default_probability) is null)::integer,
	       -- ARRONDI UNE SEULE FOIS, SUR LA SOMME (§5.1). `coalesce` enveloppe la somme et non
	       -- chaque terme : `sum` d'un ensemble entièrement nul rend NULL, et le contrat annonce un
	       -- nombre. Ce `coalesce`-ci ne remplace aucune valeur absente par un défaut — il nomme le
	       -- total d'un ensemble vide, qui est bien zéro.
	       round(coalesce(sum(c.amount), 0), 2),
	       -- LE PONDÉRÉ N'EXISTE QUE SI LES DEUX EXISTENT (§3). Le `filter` porte sur les DEUX
	       -- conditions : un montant connu ET une probabilité effective connue. Écrire
	       -- `coalesce(probabilite, 0)` transformerait « personne n'a estimé cette affaire » en
	       -- « cette affaire ne vaut rien », et `coalesce(amount, 0)` ferait de même pour le montant.
	       -- La probabilité effective se résout à TROIS niveaux, le plus spécifique gagnant :
	       -- l'affaire, puis son étape, puis le nœud du catalogue. C'est la résolution exacte du
	       -- seuil d'ancienneté dans `public.cards_figees`, appliquée à une seconde colonne.
	       round(coalesce(sum(
	           c.amount * coalesce(c.probability_override,
	                               s.probability_override,
	                               n.default_probability) / 100.0
	       ) filter (
	           where c.amount is not null
	             and coalesce(c.probability_override,
	                          s.probability_override,
	                          n.default_probability) is not null
	       ), 0), 2)
	  from public.cards c
	  join public.channels ch on ch.id = c.channel_id
	  join public.workflow_steps s on s.id = c.current_step_id
	  join public.workflow_nodes_catalog n on n.id = s.node_id
	 -- DEUX EXCLUSIONS, ET AUCUNE TROISIÈME (§4).
	 --
	 -- `snoozed_until` N'EST PAS NOMMÉE, et c'est une divergence VOULUE avec `public.cards_figees`,
	 -- qui exclut les cards encore endormies. Ici, rien n'est relancé : le sommeil dit « ne me
	 -- réveille pas », jamais « cette affaire n'est plus au portefeuille ». L'écarter ferait
	 -- disparaître un montant d'un total du seul fait qu'on a demandé le silence — la perte
	 -- silencieuse que `CLAUDE.md` §18 interdit. Figé par une assertion.
	 --
	 -- Les nœuds ARCHIVÉS du catalogue ne sont pas nommés non plus : `workflow_steps` les référence
	 -- en `ON DELETE RESTRICT` et `workflow_nodes_catalog_refuser_archivage_occupe` refuse
	 -- d'archiver un nœud occupé, si bien qu'un nœud archivé ne peut porter aucune affaire. Une
	 -- condition sur `archived_at` serait une condition sans objet.
	 where c.archived_at is null
	   and c.deleted_at is null
	 group by c.workspace_id, ch.track_id, c.channel_id,
	          n.id, n.key, n.label, n.kind, n."position", c.currency
	 -- L'ordre du catalogue est celui de l'entonnoir ; la devise et le channel départagent, afin que
	 -- deux appels successifs rendent la MÊME suite (§5.1).
	 order by n."position", c.currency, c.channel_id;
$$;

comment on function public.entonnoir_conversion() is
	'CRM-066 tranche 2 a — docs/SPEC-analytique.md §3 à §6. Le portefeuille d''affaires ACTIVES du '
	'seul appelant, agrégé par (channel, nœud du catalogue, devise) : nombre d''affaires, affaires '
	'sans montant, affaires sans probabilité, montant et montant pondéré. SECURITY INVOKER '
	'obligatoire : la RLS de « cards » décide seule, un total étant une divulgation, et le refus est '
	'ZÉRO LIGNE. Deux exclusions et aucune troisième — archivée, en corbeille ; une affaire EN '
	'SOMMEIL compte, à la différence de « cards_figees ». La probabilité effective se résout à trois '
	'niveaux — affaire, étape, nœud — et une absence n''est JAMAIS remplacée par un défaut.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite.
--
-- `ANON` EST RÉVOQUÉ NOMMÉMENT, ET LE POINT DE SÛRETÉ A DÉJÀ ÉTÉ PAYÉ (docs/SPEC-analytique.md §5.4).
-- `pg_default_acl` porte `alter default privileges in schema public ... on functions to anon`, si
-- bien que TOUTE fonction neuve de `public` naît avec `anon=X`. Or `revoke ... from public` ne
-- retire rien à `anon` : `public` est le pseudo-rôle, `anon` un rôle NOMMÉ, et les deux droits
-- coexistent. La migration 53 l'a mesuré à ses dépens — `public.cards_figees` rendait `200` et `[]`
-- là où son contrat annonçait `401`.
--
-- L'appelant anonyme est donc refusé PAR LE PRIVILÈGE, avant toute politique : `401` / `42501` à
-- travers PostgREST. C'est plus strict qu'un tableau vide, et c'est l'ACL de
-- `public.etat_messagerie`, `public.previsualiser_exigence` et `public.cards_figees`.
revoke all on function public.entonnoir_conversion() from public, anon;
grant execute on function public.entonnoir_conversion() to authenticated, service_role;

-- =============================================================================================
-- 2. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une fonction neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement :
-- `rpc/entonnoir_conversion` rendrait `404 / PGRST202` sur une pile déjà démarrée. Le
-- `migrations-runner` s'exécute avant le service `rest` au premier démarrage, mais il rejoue aussi
-- le répertoire sur une pile chaude (`docs/JOURNAL.md` décision 471) : la notification est donc
-- posée ici plutôt que laissée à un redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

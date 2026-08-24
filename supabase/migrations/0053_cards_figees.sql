-- @spec CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1 : la règle
--       descend en base
-- @spec docs/SPEC-relances.md §2 (ce qu'une card figée est), §2.2 (seuil effectif), §2.3 (les nœuds
--       terminaux ne sont pas nommés par la règle), §2.4 (les trois exclusions), §2.5 (la borne et
--       les jours révolus), §3 (contrat de `public.cards_figees`), §4 (contrat d'API)
-- @spec docs/SCHEMA.md §4 (`workflow_steps`, `workflow_nodes_catalog`), §5 (`cards`)
-- @spec docs/SPEC-permissions-rls.md §3.7 (`app.can_read_card`), §7 (le refus est zéro ligne)
-- @spec docs/SPEC-workflow-engine.md §3.3 (résolution du seuil), §7.4 (pastille d'ancienneté)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 53)
--
-- CETTE MIGRATION AJOUTE UNE SEULE FONCTION, ET NE CRÉE AUCUNE TABLE.
--
-- La notion de « card figée » existe dans ce produit depuis `CRM-041` — mais UNIQUEMENT dans un
-- composant d'interface : `webapp/src/lib/board.ts` calcule `ancienneteDepassee` et allume la
-- pastille `danger` du §7.4. Rien en base ne dit ce qu'être figée signifie.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LA RÈGLE DESCEND ICI, ET CE N'EST PAS UNE PRÉFÉRENCE DE STYLE (§2.1).
-- ---------------------------------------------------------------------------------------------
-- 1. `CLAUDE.md` §10 : « à relancer » est une règle de produit, et une règle de produit s'applique
--    là où l'interface ne peut pas être contournée.
--
-- 2. Une relance AUTOMATIQUE s'exécute sans navigateur. L'ordonnanceur de `CRM-017` — tranche 2 de
--    cette unité — n'a pas de `board.ts`.
--
-- 3. L'écran de la tranche 3 devrait sinon TÉLÉCHARGER TOUTES LES CARDS pour en écarter la
--    quasi-totalité côté client, ce que `CLAUDE.md` §21 interdit dès que le volume croît.
--
-- La pastille du board n'est PAS retirée pour autant : elle qualifie une carte déjà téléchargée
-- pour une autre raison, et la faire dépendre d'un second aller-retour serait une régression. Les
-- deux définitions doivent rester IDENTIQUES, et `scripts/verify-relances.sh` les compare sur la
-- donnée réelle plutôt que de le supposer.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION N'EST PAS.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UNE AUTORISATION NOUVELLE. La fonction est `SECURITY INVOKER` : elle n'ajoute
--    aucune règle d'accès et hérite intégralement de la RLS de `cards`, donc des droits fins de
--    `CRM-012`. MESURÉ le 2026-08-24 sur le seed : l'administratrice et le business developer
--    obtiennent une ligne, la lectrice ZÉRO — le track `grands-comptes` lui est fermé.
--
-- 2. CE N'EST PAS LA RELANCE. Aucun job n'est enregistré, aucun événement n'est écrit, aucun email
--    ne part. La tranche 2 le fera, et ses trois propriétés — idempotence ancrée sur
--    `entered_step_at`, acteur nul, `payload` sans libellé — sont à spécifier AVANT de l'écrire
--    (§7.2). Un email de relance suppose un modèle, un expéditeur et une cadence : les trois objets
--    de `CRM-063`, qu'aucune table ne tient aujourd'hui.
--
-- 3. AUCUNE TABLE N'EST CRÉÉE NI MODIFIÉE, aucune politique n'est touchée, aucun trigger n'est
--    posé. Le point de sûreté des migrations 48 à 52 — les `alter default privileges` de la
--    plateforme — ne porte donc sur aucune table ici, MAIS IL PORTE SUR LA FONCTION : voir le bloc
--    de privilèges en bas de fichier, où la mesure a corrigé une première écriture fautive.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du répertoire
-- à chaque démarrage de la pile (`docs/DAT.md` §3.2). `create or replace function` puis `revoke` et
-- `grant` nominatifs sont rejouables sans effet de bord.

-- =============================================================================================
-- 1. `public.cards_figees()` — les affaires restées trop longtemps dans leur étape
-- =============================================================================================
-- docs/SPEC-relances.md §3.1.

create or replace function public.cards_figees()
returns table (
	card_id uuid,
	workspace_id uuid,
	channel_id uuid,
	title text,
	owner_id uuid,
	step_id uuid,
	entered_step_at timestamptz,
	seuil_jours integer,
	jours_dans_etape integer,
	retard_jours integer
)
language sql
-- `STABLE` et non `IMMUTABLE` : le corps lit `now()`. Et non `VOLATILE` : PostgREST n'expose en
-- `GET` que les fonctions non volatiles, et une fonction volatile perdrait le droit d'être appelée
-- dans un contexte de lecture seule.
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI LE POINT MÊME DE LA FONCTION (§3.2).
--
-- En `SECURITY DEFINER`, cette fonction répondrait pour `postgres`, qui traverse toute la RLS, et
-- rendrait donc à CHAQUE appelant les affaires figées de tout le monde — y compris celles des
-- channels qui lui sont fermés par les droits fins de `CRM-012`. Ce serait une fuite, pas une
-- commodité. En `INVOKER`, la fonction n'ajoute AUCUNE règle : elle hérite d'`app.can_read_card`,
-- et le refus se mesure comme ZÉRO LIGNE, jamais comme une erreur — la forme exigée par la preuve
-- de refus n° 4 de `docs/SPEC-permissions-rls.md` §7.
--
-- `search_path` VIDE : tous les objets du corps sont pleinement qualifiés. La consigne vise en
-- premier lieu les fonctions `SECURITY DEFINER`, mais la poser ici ne coûte rien et aligne cette
-- fonction sur `public.etat_messagerie` et `public.inbox_arborescence`, ses deux jumelles de forme.
set search_path to ''
as $$
	select c.id,
	       c.workspace_id,
	       c.channel_id,
	       c.title,
	       c.owner_id,
	       ws.id,
	       c.entered_step_at,
	       -- LE SEUIL EFFECTIF (§2.2) : celui de l'étape s'il est posé, sinon celui du nœud. Un
	       -- seuil absent n'est JAMAIS remplacé par un défaut — une étape sans seuil est une étape
	       -- dont personne n'a dit au bout de combien de temps elle est en retard. C'est la
	       -- résolution exacte de `resoudreEtape` dans `board.ts`.
	       coalesce(ws.stale_after_days, n.default_stale_after_days),
	       -- JOURS RÉVOLUS (§2.5), comme `Math.floor` sur des millisecondes dans `board.ts`.
	       floor(extract(epoch from (now() - c.entered_step_at)) / 86400.0)::integer,
	       floor(extract(epoch from (now() - c.entered_step_at)) / 86400.0)::integer
	         - coalesce(ws.stale_after_days, n.default_stale_after_days)
	  from public.cards c
	  join public.workflow_steps ws on ws.id = c.current_step_id
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 -- LES TROIS EXCLUSIONS DU §2.4, et aucune quatrième.
	 --
	 -- Les nœuds terminaux (`kind` valant `won` ou `lost`) NE SONT PAS NOMMÉS ICI, et c'est une
	 -- décision écrite (§2.3) : ils ne portent aucun seuil au catalogue, donc la condition sur
	 -- `coalesce(...) is not null` les écarte déjà. Ajouter `kind not in ('won','lost')` créerait
	 -- une SECONDE définition de « terminal » à maintenir. La conséquence est assumée et figée par
	 -- une assertion : un administrateur qui poserait un seuil sur un nœud terminal rendrait ses
	 -- cards relançables — le §2.5 de `docs/SPEC-workflow-engine.md` lui en laisse le droit, et le
	 -- produit l'honore au lieu de le contredire en silence.
	 where c.archived_at is null
	   and c.deleted_at is null
	   -- EN SOMMEIL : le prédicat d'`estEnSommeil` (`CRM-081` §16.2), au caractère près — non nul
	   -- ET STRICTEMENT postérieur. Une échéance ÉCHUE ne protège plus : la card est réveillée de
	   -- fait. Relancer une card encore endormie annulerait le seul geste que l'utilisateur a posé
	   -- contre les relances.
	   and (c.snoozed_until is null or c.snoozed_until <= now())
	   and coalesce(ws.stale_after_days, n.default_stale_after_days) is not null
	   and floor(extract(epoch from (now() - c.entered_step_at)) / 86400.0)
	       >= coalesce(ws.stale_after_days, n.default_stale_after_days)
	 -- Le retard décroissant est le seul ordre que la donnée porte et que l'utilisateur attend ; le
	 -- titre départage, afin que deux appels successifs rendent la MÊME suite (§3.4).
	 order by 10 desc, c.title;
$$;

comment on function public.cards_figees() is
	'CRM-062 tranche 1 — docs/SPEC-relances.md §2 et §3. Les affaires restées dans leur étape '
	'au-delà du seuil de relance de cette étape, pour le seul appelant. SECURITY INVOKER '
	'obligatoire : la RLS de « cards » décide seule, et le refus est ZÉRO LIGNE. Trois exclusions '
	'et aucune quatrième — archivée, en corbeille, en sommeil (échéance STRICTEMENT future). Les '
	'nœuds terminaux ne sont pas nommés : ils ne portent aucun seuil, et une seconde définition de '
	'« terminal » serait une définition de trop.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite.
--
-- `anon` NE REÇOIT RIEN, et c'est l'ACL mesurée de `public.etat_messagerie` et de
-- `public.previsualiser_exigence`. Un appelant anonyme est donc refusé PAR LE PRIVILÈGE, avant
-- toute politique — `401` / `42501` à travers PostgREST. C'est plus strict qu'un tableau vide, et
-- l'écart avec `public.reel_saisissable` — qui, elle, accorde `anon` — est voulu : celle-là est une
-- colonne calculée d'une table que l'anonyme atteint, et lui refuser `execute` transformerait un
-- « zéro ligne » en erreur de privilège. Ici, la fonction est le seul objet appelé.
--
-- `ANON` EST RÉVOQUÉ NOMMÉMENT, ET C'EST MESURÉ, PAS SUPPOSÉ (docs/SPEC-relances.md §3.3).
--
-- La première écriture de cette migration ne révoquait que `public`. MESURÉ le 2026-08-24, migration
-- appliquée : l'appelant anonyme obtenait `200` et `[]` là où le contrat annonce `401`. La cause
-- n'est pas dans le corps de la fonction, elle est dans la plateforme — `pg_default_acl` porte
-- `alter default privileges in schema public ... on functions to anon`, si bien que TOUTE fonction
-- neuve de `public` naît avec `anon=X`. Or `revoke ... from public` ne retire rien à `anon` :
-- `public` est le pseudo-rôle, `anon` un rôle NOMMÉ, et les deux droits coexistent. C'est le même
-- point de sûreté que les migrations 48 à 52 nomment pour les TABLES, et il vaut pour les fonctions.
-- `public.etat_messagerie` révoque `public, anon` depuis la migration 31 pour cette raison exacte.
revoke all on function public.cards_figees() from public, anon;
grant execute on function public.cards_figees() to authenticated, service_role;

-- =============================================================================================
-- 2. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une fonction neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement : `rpc/cards_figees`
-- rendrait `404 / PGRST202` sur une pile déjà démarrée. Le `migrations-runner` s'exécute avant le
-- service `rest` au premier démarrage, mais il rejoue aussi le répertoire sur une pile chaude
-- (`docs/JOURNAL.md` décision 471) : la notification est donc posée ici plutôt que laissée à un
-- redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

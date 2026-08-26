-- @spec CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : l'émission
-- @spec docs/SPEC-notifications.md §34 (d'où vient la liste du sélecteur), §34.2 (la forme et
--       `SECURITY INVOKER`), §34.3 (l'appelant ne figure pas dans sa propre liste), §34.4
--       (privilèges), §5.1 (la règle d'éligibilité), §5.3 (la chaîne généralisée)
-- @spec docs/SCHEMA.md §5 ; docs/PROD_MIGRATIONS.md §3
--
-- CETTE MIGRATION NE FAIT QU'UNE CHOSE : elle donne au sélecteur du composeur la liste des
-- personnes qu'un commentaire peut mentionner. Aucune table, aucune colonne, aucune politique,
-- aucun privilège de table ne bouge — la sous-tranche 3b ne change AUCUNE règle des deux tables
-- de `CRM-064`, elle leur donne une surface d'émission. `0061_mentions_commentaires.test.sql` et
-- `0062_notifications.test.sql` doivent rester verts SANS AUCUNE modification.
--
-- LE PROBLÈME QUE CETTE FONCTION RÉSOUT EST MESURÉ (docs/SPEC-notifications.md §32, M2 et M3).
-- Le §30 exigeait deux choses en apparence contradictoires : que le sélecteur n'offre que des
-- personnes ÉLIGIBLES au sens du §5.1, et que l'écran ne calcule AUCUN droit (`CLAUDE.md` §10).
-- Or la seule liste que l'écran sait lire aujourd'hui — les membres du workspace — ignore
-- l'éligibilité, qui dépend de l'affaire :
--
--   GET /rest/v1/workspace_members?select=user_id,profiles(full_name)   (jetons A, B et V)
--     => 200, LES TROIS MEMBRES pour chacun des trois profils, `viewer` compris
--
--   POST /rest/v1/card_comment_mentions  { comment_id: …0d1, profile_id: …013 }   (jeton de A)
--     => 400  P0001  mention_destinataire_sans_acces
--
-- Un sélecteur alimenté par la première mesure proposerait donc un nom que la seconde refuse : la
-- commande morte que le §5.10 du design system interdit.
--
-- LA RÈGLE N'A TOUJOURS QU'UNE SEULE ÉCRITURE, et c'est le point de cette migration. Filtrer dans
-- l'écran aurait été la SECONDE écriture de la règle d'accès que le §5.3 a refusée en base,
-- réécrite cette fois en TypeScript — donc divergente au premier niveau de droit ajouté, et
-- invérifiable hors navigateur. La fonction ci-dessous ne juge rien : elle appelle
-- `app.can_read_card_pour` pour chaque membre, c'est-à-dire la chaîne que la tranche 1 a
-- généralisée, employée ici pour la première fois par une surface.

-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). `create or replace function`
-- puis `revoke` et `grant` nominatifs sont rejouables sans effet de bord.

-- =============================================================================================
-- 1. `public.mentionnables(card_id uuid)` — qui ce commentaire peut mentionner
-- =============================================================================================
-- docs/SPEC-notifications.md §34.2.

create or replace function public.mentionnables(card_id uuid)
returns table (
	profile_id uuid,
	full_name  text,
	avatar_url text
)
language sql
-- `STABLE` et non `VOLATILE` : PostgREST n'expose en `GET` que les fonctions non volatiles, et
-- l'écran LIT cette liste, il ne la modifie pas. Non `IMMUTABLE` non plus — le corps lit des
-- tables. C'est la volatilité de `public.cards_figees`, pour la même raison.
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI LE POINT MÊME DE LA FONCTION (§34.2).
--
-- En `SECURITY DEFINER`, cette fonction répondrait pour `postgres`, qui traverse toute la RLS, et
-- rendrait donc à CHAQUE appelant les membres d'un workspace qu'il n'atteint pas, sur une affaire
-- qui ne lui est pas ouverte. Ce serait une fuite, pas une commodité. En `INVOKER`, la lecture de
-- `public.cards` applique la RLS de l'appelant : une affaire fermée rend ZÉRO LIGNE, jamais une
-- erreur — la forme exigée par la preuve de refus n° 4 de `docs/SPEC-permissions-rls.md` §7, et
-- celle qu'a établie `public.cards_figees` pour une RPC de lecture.
--
-- MESURÉ (§32, M8), sonde créée dans une transaction ANNULÉE : sous Farida, sur la card `…0c1`
-- qu'elle ne lit pas, la fonction rend 0 ligne.
--
-- `search_path` VIDE : tous les objets du corps sont pleinement qualifiés. La consigne vise en
-- premier lieu les fonctions `SECURITY DEFINER`, mais la poser ici ne coûte rien et aligne cette
-- fonction sur `public.cards_figees` et `public.inbox_arborescence`, ses jumelles de forme.
set search_path to ''
as $$
	select p.id, p.full_name, p.avatar_url
	  from public.cards c
	  -- `workspace_members` EST L'UNIVERSEL, et le §5.1 le justifie : l'accès effectif se résout
	  -- depuis le rôle de workspace, puis les surcharges de track et de channel. Une personne
	  -- absente de cette table n'a aucun rôle, donc aucun accès — la joindre par une autre table
	  -- ajouterait un chemin qu'`app.resolve_access` ne connaît pas.
	  join public.workspace_members m on m.workspace_id = c.workspace_id
	  -- Un membre dont le profil n'est pas lisible est ÉCARTÉ plutôt que rendu sans nom : une
	  -- entrée de liste anonyme ne se choisit pas. C'est la règle de `lireMembresAffectables`
	  -- (`CRM-060`), transposée en SQL par la jointure interne.
	  join public.profiles p on p.id = m.user_id
	 where c.id = mentionnables.card_id
	   -- L'APPELANT NE FIGURE PAS DANS SA PROPRE LISTE (§34.3). Le §14.3 a mesuré qu'une
	   -- auto-mention est ACCEPTÉE et ne produit AUCUNE notification : l'offrir serait offrir un
	   -- geste voué au néant, la commande morte du §5.10 du design system.
	   --
	   -- SOUS LA CLÉ DE SERVICE, `auth.uid()` EST NUL et personne n'est exclu : la fonction rend
	   -- alors tous les membres éligibles. C'est nommé plutôt que masqué — même limite que le
	   -- §14.3 pour le trigger de production. Le `coalesce` sur l'UUID nul est ce qui rend cette
	   -- limite explicite : sans lui, `p.id <> null` serait NULL, donc faux, et la fonction
	   -- rendrait ZÉRO LIGNE à la clé de service au lieu de tout rendre — un silence dont aucune
	   -- preuve n'aurait dit la cause.
	   and p.id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
	   -- LA RÈGLE, ET SON UNIQUE ÉCRITURE (§5.3). La fonction ne relit ni `track_members` ni
	   -- `channel_members` : elle délègue à la chaîne généralisée par la tranche 1.
	   and app.can_read_card_pour(c.id, p.id)
	 -- Ordonnés par nom : ni `workspace_members` ni `profiles` ne portent d'ordre, et une liste
	 -- dont l'ordre change d'un chargement à l'autre se parcourt mal. `collate "fr-FR-x-icu"`
	 -- plutôt que l'ordre binaire : « Émile » se rangerait après « Emma » avec le second, et
	 -- c'est le tri que `lireMembresAffectables` obtient déjà côté client par `localeCompare`.
	 order by p.full_name collate "fr-FR-x-icu";
$$;

comment on function public.mentionnables(uuid) is
	'CRM-064 sous-tranche 3b — docs/SPEC-notifications.md §34. Les personnes qu''un commentaire de '
	'cette affaire peut mentionner : les membres du workspace pour lesquels '
	'app.can_read_card_pour est vrai, l''appelant excepté. SECURITY INVOKER obligatoire : la RLS '
	'de « cards » décide seule, et le refus est ZÉRO LIGNE, jamais une erreur. L''appelant est '
	'retiré parce qu''une auto-mention ne produit aucune notification (§14.3) ; sous la clé de '
	'service, auth.uid() est nul et personne n''est retiré.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite.
--
-- `ANON` EST RÉVOQUÉ NOMMÉMENT, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE : c'est la leçon payée par
-- la migration `0053` (`CRM-062`). `pg_default_acl` porte
-- `alter default privileges in schema public … on functions to anon`, si bien que TOUTE fonction
-- neuve de `public` naît avec `anon=X` — et `revoke … from public` ne lui retire rien, `public`
-- étant le pseudo-rôle et `anon` un rôle NOMMÉ. Sans cette ligne, un appelant anonyme obtiendrait
-- `200 []` là où le contrat annonce `401` : un refus par le privilège est plus strict qu'une liste
-- vide, et c'est ce que la ligne *x* du §37 mesure.
revoke all on function public.mentionnables(uuid) from public, anon;
grant execute on function public.mentionnables(uuid) to authenticated, service_role;

-- =============================================================================================
-- 2. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une fonction neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement :
-- `rpc/mentionnables` rendrait `404 / PGRST202` sur une pile déjà démarrée. Le `migrations-runner`
-- s'exécute avant le service `rest` au premier démarrage, mais il rejoue aussi le répertoire sur
-- une pile chaude (`docs/JOURNAL.md` décision 471) : la notification est donc posée ici plutôt que
-- laissée à un redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

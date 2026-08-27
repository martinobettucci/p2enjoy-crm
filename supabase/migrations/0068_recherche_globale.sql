-- @spec CRM-065 (docs/BACKLOG.md) — tranche 1 : la recherche en base
-- @spec docs/SPEC-recherche.md §3 (le vocabulaire `app.francais_sans_accent`), §4 (les cinq
--       familles et leurs poids), §5 (les index d'expression), §6 (le contrat de
--       `public.recherche_globale`), §6.7 (les quinze lignes de refus et de cas limites),
--       §7 (ce que la migration ne change pas)
-- @spec docs/SCHEMA.md §9 bis.9 ter ; docs/PROD_MIGRATIONS.md §3
--
-- CETTE MIGRATION N'OUVRE RIEN. Aucune table, aucune colonne, aucune politique, aucun privilège de
-- table, aucun trigger, aucune valeur ne bouge (docs/SPEC-recherche.md §7). Elle ajoute un CHEMIN DE
-- LECTURE vers ce que l'appelant peut déjà lire, et c'est tout. Les suites pgTAP des cinq unités qui
-- portent les cinq tables cherchées — CRM-040, CRM-060, CRM-043, CRM-054 — doivent rester vertes
-- SANS AUCUNE modification ; si l'une rougit, c'est cette migration qui a tort.
--
-- LE PROBLÈME QUE LE VOCABULAIRE RÉSOUT EST MESURÉ (docs/SPEC-recherche.md §2, M2 et M3), et il
-- contredit l'intuition. La configuration `french` livrée avec PostgreSQL n'est PAS insensible aux
-- accents : son radicaliseur en retire certains et en conserve d'autres, sans règle qu'un
-- utilisateur puisse deviner.
--
--   to_tsvector('french','Amélie Dupont créance échéance')
--     =>  'amel':1 'dupont':2 'créanc':3 'échéanc':4
--
--   « amelie » trouve « Amélie »   |   « creance » NE TROUVE PAS « créance »
--   « societe » trouve « société » |   « proces »  NE TROUVE PAS « procès »
--
-- Un comportement juste une fois sur deux est pire qu'un comportement uniformément strict : il
-- apprend à l'utilisateur une règle fausse. D'où la configuration dérivée du bloc 2, qui place
-- `unaccent` DEVANT le radicaliseur et rend les cinq cas justes dans les deux sens.
--
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du répertoire
-- à chaque démarrage de la pile (docs/DAT.md §3.2). Chaque objet ci-dessous est donc créé sous une
-- forme rejouable : `create extension if not exists`, un `do` gardé pour la configuration — qui n'a
-- pas de forme `or replace` —, `create index if not exists`, `create or replace function`.

-- =============================================================================================
-- 1. L'extension `unaccent`
-- =============================================================================================
-- docs/SPEC-recherche.md §2 M1 : elle est DISPONIBLE (`pg_available_extensions`, version 1.1) mais
-- n'était PAS installée. Elle l'est ici dans `extensions`, comme `pgcrypto` à la migration 1 : le
-- schéma existe déjà et c'est la convention du dépôt.
create extension if not exists unaccent with schema extensions;

-- =============================================================================================
-- 2. Le vocabulaire de recherche — `app.francais_sans_accent`
-- =============================================================================================
-- docs/SPEC-recherche.md §3.1.
--
-- Dans `app` et non dans `public` : le schéma `app` porte déjà les fonctions d'autorisation
-- (docs/SPEC-permissions-rls.md §3) et n'est PAS exposé par PostgREST. Une configuration de
-- recherche n'est pas un objet de l'API.
--
-- `pg_catalog.french` est nommée explicitement plutôt que laissée au `search_path`, et la
-- configuration produite est elle aussi TOUJOURS nommée explicitement dans les index et dans la
-- requête. `default_text_search_config` n'est modifiée NULLE PART, ni pour la base ni pour un rôle
-- (§3.3) : la changer altérerait silencieusement tout appel à un argument de `to_tsvector` écrit
-- ailleurs dans le produit, aujourd'hui ou demain.
do $bloc$
begin
	if not exists (
		select 1
		  from pg_ts_config c
		  join pg_namespace n on n.oid = c.cfgnamespace
		 where n.nspname = 'app'
		   and c.cfgname = 'francais_sans_accent'
	) then
		create text search configuration app.francais_sans_accent ( copy = pg_catalog.french );

		-- `unaccent` D'ABORD, `french_stem` ENSUITE. L'ordre est le point de tout le bloc : un
		-- dictionnaire qui rend un lexème arrête la chaîne, et `unaccent` rend TOUJOURS un
		-- résultat — il désaccentue puis passe la main. Inverser les deux ne changerait rien pour
		-- « amelie » et laisserait « créanc » accentué, c'est-à-dire l'écart mesuré au §2 M2.
		alter text search configuration app.francais_sans_accent
			alter mapping for hword, hword_part, word
			with extensions.unaccent, pg_catalog.french_stem;
	end if;
end
$bloc$;

comment on text search configuration app.francais_sans_accent is
	'CRM-065 — docs/SPEC-recherche.md §3. « french » avec « unaccent » placé devant le '
	'radicaliseur, parce que « french » seule n''est PAS insensible aux accents : elle trouve '
	'« Amélie » sur « amelie » mais pas « créance » sur « creance » (§2 M2). Ne jamais la '
	'substituer à default_text_search_config : elle est nommée explicitement partout.';

-- =============================================================================================
-- 3. Les cinq index GIN d'expression
-- =============================================================================================
-- docs/SPEC-recherche.md §5.
--
-- AUCUNE COLONNE N'EST AJOUTÉE, et c'est délibéré (§5.1). Une colonne générée `tsvector` serait
-- exposée par PostgREST sur ces cinq tables, donc rendue par tout `select=*` déjà écrit, et elle
-- apparaîtrait dans `webapp/src/lib/database.types.ts`. Elle changerait la forme PUBLIQUE de cinq
-- tables du produit pour un besoin interne au moteur de recherche. L'index d'expression obtient le
-- même service sans rien changer de ce que l'API rend.
--
-- `public.cards` PORTE DÉJÀ UNE COLONNE ET UN INDEX DE RECHERCHE, ET ILS RESTENT INTACTS (§5.4,
-- mesure M12). `cards.search_tsv`, colonne générée de la migration 11 (`CRM-040`), et
-- `cards_search_tsv_idx` servent la recherche LOCALE de la vue liste, que `liste-cards.ts` appelle
-- par `textSearch('search_tsv', …, { config: 'french' })`. `cards_recherche_idx` ci-dessous est
-- donc un SECOND index GIN sur la même table, et c'est voulu : les deux servent des requêtes
-- différentes — l'une sans poids, en `french`, sur deux colonnes ; l'autre pondérée, en
-- `app.francais_sans_accent`, sur trois. Cette migration ne touche NI la colonne, NI son index, NI
-- l'écran qui les emploie. L'écart de vocabulaire entre les deux recherches est consigné à
-- `docs/INCONSISTENCY_REPORT.md`, INC-230, et laissé inchangé : il appartient à `CRM-042`.
--
-- L'EXPRESSION DE CHAQUE INDEX EST RECOPIÉE À L'IDENTIQUE DANS LA FONCTION DU BLOC 4, ET LA
-- DUPLICATION EST ASSUMÉE (§5.2). L'optimiseur ne retient un index d'expression que si la clause
-- `where` lui est STRUCTURELLEMENT identique. Interposer une fonction enveloppante — plus propre à
-- lire — exposerait à ce qu'elle soit « inlinée » à la planification de la requête et pas dans la
-- définition de l'index : les deux expressions cesseraient alors de correspondre SANS LE MOINDRE
-- SIGNAL. La recherche resterait juste, et deviendrait lente. Mesuré vert au §2 M9 : `explain`
-- rend bien un `Bitmap Index Scan`.
--
-- Les index ne portent PAS `deleted_at is null` (§5.3) : la corbeille de `CRM-077` RESTAURE des
-- lignes, et un index partiel les réintégrerait par une écriture au moment de la restauration.

-- 3.1 `affaire` — titre (A), prochaine action (B), description (C)
create index if not exists cards_recherche_idx
	on public.cards using gin ((
		setweight(to_tsvector('app.francais_sans_accent', coalesce(title, '')), 'A') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(next_action, '')), 'B') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(description, '')), 'C')
	));

-- 3.2 `contact` — nom (A), adresse (B), fonction (C)
create index if not exists contacts_recherche_idx
	on public.contacts using gin ((
		setweight(to_tsvector('app.francais_sans_accent', coalesce(full_name, '')), 'A') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(email, '')), 'B') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(role_title, '')), 'C')
	));

-- 3.3 `organisation` — nom (A), domaine (B)
-- `website` est EXCLUE (§4) : c'est une URL, dont les lexèmes — `https`, `www`, `com` —
-- bruiteraient chaque recherche sans jamais être ce qu'on cherche.
create index if not exists organizations_recherche_idx
	on public.organizations using gin ((
		setweight(to_tsvector('app.francais_sans_accent', coalesce(name, '')), 'A') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(domain, '')), 'B')
	));

-- 3.4 `commentaire` — corps seul (C)
-- Un commentaire n'a pas de titre, et lui en fabriquer un à partir de son affaire fausserait le
-- classement en donnant le poids `A` à un texte que le commentaire ne contient pas (§4).
create index if not exists card_comments_recherche_idx
	on public.card_comments using gin ((
		setweight(to_tsvector('app.francais_sans_accent', coalesce(body, '')), 'C')
	));

-- 3.5 `message` — objet (A), expéditeur (B), corps (C)
create index if not exists mail_messages_recherche_idx
	on public.mail_messages using gin ((
		setweight(to_tsvector('app.francais_sans_accent', coalesce(subject, '')), 'A') ||
		setweight(to_tsvector('app.francais_sans_accent',
			coalesce(from_name, '') || ' ' || coalesce(from_address, '')), 'B') ||
		setweight(to_tsvector('app.francais_sans_accent', coalesce(body_text, '')), 'C')
	));

-- =============================================================================================
-- 4. `public.recherche_globale(p_terme, p_limite)` — le contrat
-- =============================================================================================
-- docs/SPEC-recherche.md §6.

create or replace function public.recherche_globale(
	p_terme  text,
	p_limite integer default 20
)
returns table (
	objet        text,
	id           uuid,
	workspace_id uuid,
	titre        text,
	sous_titre   text,
	extrait      text,
	rang         real
)
language plpgsql
-- `STABLE` et non `VOLATILE` : PostgREST n'expose en `GET` que les fonctions non volatiles, et la
-- recherche LIT. Non `IMMUTABLE` non plus — le corps lit des tables. C'est la volatilité de
-- `public.cards_figees` et de `public.mentionnables`, pour la même raison.
stable
-- `SECURITY INVOKER` — LE DÉFAUT, ET IL EST ICI LE POINT MÊME DE LA FONCTION (§1.3, §6.3).
--
-- En `DEFINER`, cette fonction répondrait pour `postgres`, qui traverse toute la RLS : elle
-- rendrait à CHAQUE appelant les affaires, les contacts et les messages de TOUS. Ce ne serait pas
-- une commodité, ce serait une fuite. En `INVOKER`, chacune des cinq tables applique la politique
-- de lecture écrite par l'unité qui la porte — `cards_lecture`, `contacts_lecture_membre`,
-- `organizations_lecture_membre`, `card_comments_lecture`, `mail_messages_lecture` —, et le refus
-- est ZÉRO LIGNE, jamais une erreur : un objet qu'on ne peut pas lire ne se distingue en rien d'un
-- objet qui n'existe pas.
security invoker
set search_path = ''
as $fonction$
declare
	v_mots    text;
	v_limite  integer;
	v_requete tsquery;
begin
	-- ------------------------------------------------------------------------------------
	-- 4.1 La borne — §6.6, et lignes *g* et *h* du §6.7
	-- ------------------------------------------------------------------------------------
	-- Bornée à 50 CÔTÉ SERVEUR, parce qu'un client peut demander ce qu'il veut. Une palette
	-- n'affiche pas cent lignes.
	v_limite := least(coalesce(p_limite, 0), 50);

	if v_limite <= 0 then
		return;
	end if;

	-- ------------------------------------------------------------------------------------
	-- 4.2 Le terme devient une requête — §6.2
	-- ------------------------------------------------------------------------------------
	-- Découpe sur toute suite de caractères NON alphanumériques. Les lettres accentuées sont
	-- alphanumériques dans la locale de la base et survivent au découpage — mesuré : « Audit
	-- Sécu!! » rend « audit », « sécu ».
	--
	-- L'ÉCHAPPEMENT EST STRUCTUREL, et ce n'est pas une précaution de style : après cette
	-- découpe, un fragment ne contient QUE des caractères alphanumériques. Aucun métacaractère
	-- de `tsquery` — & | ! ( ) : ' — ne peut donc atteindre `to_tsquery`, qui LÈVE UNE ERREUR
	-- sur une syntaxe invalide. Une erreur serveur à chaque frappe d'une palette serait un
	-- défaut visible.
	--
	-- Le suffixe `:*` fait la recherche par préfixe, sans laquelle une palette est inutile —
	-- « audi » doit trouver « Audit sécurité applicative » avant que l'utilisateur ait fini de
	-- taper. `to_tsquery` applique le dictionnaire — désaccentuation PUIS radicalisation —
	-- AVANT de poser le préfixe : mesuré, « societe:* » rend « 'societ':* » (§2 M7).
	--
	-- ` & ` et non ` | ` : CONJONCTION. Une palette qui rendrait l'union noierait la ligne
	-- cherchée dès le deuxième mot saisi.
	select coalesce(string_agg(mot || ':*', ' & '), '')
	  into v_mots
	  from unnest(regexp_split_to_array(lower(coalesce(p_terme, '')), '[^[:alnum:]]+')) as mot
	 where mot <> '';

	-- Lignes *d* et *e* du §6.7 : terme nul, vide, ou fait de blancs et de ponctuation.
	if v_mots = '' then
		return;
	end if;

	-- Ligne *f* du §6.7 : terme fait UNIQUEMENT de mots vides français (« le la de »).
	--
	-- Le contrôle passe par `to_tsvector` et NON par `to_tsquery`, et c'est mesuré (§2 M8) :
	-- `to_tsquery` émet un `NOTICE: text-search query contains only stop words` dès que sa
	-- requête ne porte aucun lexème. Ce n'est pas une erreur, mais ce serait une ligne de
	-- journal du serveur À CHAQUE FRAPPE d'une palette. `to_tsvector` emploie exactement les
	-- mêmes dictionnaires et n'émet rien.
	if to_tsvector('app.francais_sans_accent', p_terme) = ''::tsvector then
		return;
	end if;

	v_requete := to_tsquery('app.francais_sans_accent', v_mots);

	-- ------------------------------------------------------------------------------------
	-- 4.3 Les cinq familles — §4, §6.4
	-- ------------------------------------------------------------------------------------
	-- TOUTES LES JOINTURES DE CONTEXTE SONT EXTERNES, et le motif est celui de la décision 104
	-- de `CRM-012` : une jointure interne transformerait une politique de lecture absente sur la
	-- table de contexte en DISPARITION du résultat principal, c'est-à-dire un refus par
	-- accident. Le contexte manquant se dit par `null` ; la ligne, elle, reste.
	--
	-- `deleted_at is null` là où la colonne existe — ligne *i* du §6.7. Une affaire à la
	-- corbeille reste lisible par la RLS, c'est précisément ce qui permet de la restaurer
	-- (`CRM-077`) : l'exclure est une décision de la RECHERCHE, pas une conséquence de la
	-- sécurité. `contacts`, `organizations` et `mail_messages` ne portent pas la colonne.
	return query
	with resultats as (

		-- 4.3.1 `affaire`
		select
			'affaire'::text                                          as objet,
			c.id                                                     as id,
			c.workspace_id                                           as workspace_id,
			c.title                                                  as titre,
			ch.name                                                  as sous_titre,
			null::text                                               as extrait,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.next_action, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C'),
				v_requete
			)                                                        as rang
		  from public.cards c
		  left join public.channels ch on ch.id = c.channel_id
		 where c.deleted_at is null
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.next_action, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.2 `contact`
		select
			'contact'::text,
			ct.id,
			ct.workspace_id,
			ct.full_name,
			coalesce(o.name, ct.email),
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C'),
				v_requete
			)
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.3 `organisation`
		select
			'organisation'::text,
			o.id,
			o.workspace_id,
			o.name,
			o.domain,
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B'),
				v_requete
			)
		  from public.organizations o
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B')
		   ) @@ v_requete

		union all

		-- 4.3.4 `commentaire`
		-- L'extrait est REPLIÉ sur une ligne : mesuré (§2 M11), `ts_headline` rend un corps
		-- court EN ENTIER, retours à la ligne compris, et une palette n'affiche qu'une ligne.
		-- `StartSel` et `StopSel` VIDES : la donnée rendue est du texte pur, sans balise à
		-- échapper côté client.
		select
			'commentaire'::text,
			cc.id,
			cc.workspace_id,
			c2.title,
			p.full_name,
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(cc.body, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C'),
				v_requete
			)
		  from public.card_comments cc
		  left join public.cards c2 on c2.id = cc.card_id
		  left join public.profiles p on p.id = cc.author_id
		 where cc.deleted_at is null
		   -- UN COMMENTAIRE D'AFFAIRE MISE À LA CORBEILLE SORT AUSSI (§6.7, ligne *i*), et le
		   -- besoin a été trouvé par une assertion de la suite pgTAP, pas supposé : `card_comments`
		   -- porte son propre `deleted_at`, que mettre l'affaire à la corbeille ne touche pas. Sans
		   -- cette clause, la palette de la tranche 2 offrirait une destination morte — ce que le
		   -- §5.10 du design system interdit.
		   --
		   -- `not exists` et non une condition sur la jointure externe : si l'affaire n'est PAS
		   -- lisible, la sous-requête ne la voit pas non plus et le commentaire reste — le contexte
		   -- manquant se dit par `null`, il ne fait pas disparaître la ligne (§6.4). En pratique le
		   -- cas ne se produit pas, `card_comments_lecture` exigeant déjà de lire l'affaire.
		   and not exists (
				select 1
				  from public.cards cx
				 where cx.id = cc.card_id
				   and cx.deleted_at is not null
		   )
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.5 `message`
		select
			'message'::text,
			m.id,
			m.workspace_id,
			m.subject,
			coalesce(nullif(m.from_name, ''), m.from_address),
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(m.body_text, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C'),
				v_requete
			)
		  from public.mail_messages m
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C')
		   ) @@ v_requete
	)
	select r.objet, r.id, r.workspace_id, r.titre, r.sous_titre, r.extrait, r.rang
	  from resultats r
	-- L'ORDRE PORTE TROIS CRITÈRES, ET LES DEUX DERNIERS NE SONT PAS DÉCORATIFS (§6.6) : sans
	-- eux, deux lignes de rang égal — cas courant d'un terme trouvé une seule fois dans deux
	-- titres — s'ordonneraient au gré du plan d'exécution, et la palette changerait d'ordre
	-- d'une frappe à l'autre. `collate "fr-FR-x-icu"` plutôt que l'ordre binaire : « Émile » se
	-- rangerait après « Emma » avec le second.
	 order by r.rang desc, r.titre collate "fr-FR-x-icu", r.id
	 limit v_limite;
end;
$fonction$;

comment on function public.recherche_globale(text, integer) is
	'CRM-065 tranche 1 — docs/SPEC-recherche.md §6. La recherche transverse sur cinq familles : '
	'affaire, contact, organisation, commentaire, message. SECURITY INVOKER obligatoire : la RLS '
	'de chaque table décide seule, et le refus est ZÉRO LIGNE, jamais une erreur. Le terme est '
	'découpé sur tout ce qui n''est pas alphanumérique, chaque fragment reçoit « :* » et les '
	'fragments sont joints par « & » — donc préfixe et conjonction. Bornée à 50 lignes côté '
	'serveur. N''ouvre aucune politique et n''accorde aucun privilège de table.';

-- Les privilèges sont posés EXPLICITEMENT, comme partout dans ce dépôt : `revoke` d'abord, `grant`
-- nominatif ensuite.
--
-- `ANON` EST RÉVOQUÉ NOMMÉMENT, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE : c'est la leçon payée par
-- la migration `0053` (`CRM-062`). `pg_default_acl` porte
-- `alter default privileges in schema public … on functions to anon`, si bien que TOUTE fonction
-- neuve de `public` naît avec `anon=X` — et `revoke … from public` ne lui retire rien, `public`
-- étant le pseudo-rôle et `anon` un rôle NOMMÉ. Sans cette ligne, un appelant anonyme obtiendrait
-- `200 []` là où la ligne *a* du §6.7 annonce `401` : un refus par le privilège est plus strict
-- qu'une liste vide.
--
-- `create or replace function` CONSERVE l'ACL existante : sur une base où la fonction existe déjà,
-- ces deux lignes sont ce qui garantit l'ACL attendue, et elles sont rejouables.
revoke all on function public.recherche_globale(text, integer) from public, anon;
grant execute on function public.recherche_globale(text, integer) to authenticated, service_role;

-- =============================================================================================
-- 5. Rechargement du cache de schéma de PostgREST
-- =============================================================================================
-- Une fonction neuve reste INVISIBLE au cache de schéma jusqu'à son rechargement :
-- `rpc/recherche_globale` rendrait `404 / PGRST202` sur une pile déjà démarrée. Le
-- `migrations-runner` s'exécute avant le service `rest` au premier démarrage, mais il rejoue aussi
-- le répertoire sur une pile chaude (docs/JOURNAL.md décision 471) : la notification est donc posée
-- ici plutôt que laissée à un redémarrage manuel.
--
-- `notify` est sans effet si personne n'écoute, et n'échoue jamais : la ligne est rejouable.
notify pgrst, 'reload schema';

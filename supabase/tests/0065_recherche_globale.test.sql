-- @verifies CRM-065 (docs/BACKLOG.md) — recherche globale, TRANCHE 1 : la recherche en base
-- @verifies docs/SPEC-recherche.md §3 (le vocabulaire `app.francais_sans_accent` et ce qu'il
--            garantit), §4 (les cinq familles et leurs poids), §5 (les index d'expression),
--            §6.1 (la signature), §6.2 (le terme devient une requête), §6.3 (volatilité,
--            `security invoker`, privilèges), §6.4 (titre et sous-titre), §6.5 (l'extrait),
--            §6.6 (ordre et bornes), §6.7 (les quinze lignes du contrat), §9 (preuves dues)
-- @verifies docs/SCHEMA.md §9 bis.9 ter ; docs/PROD_MIGRATIONS.md §3 (migration 68)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve AUCUNE des cinq politiques de lecture qu'elle traverse : `cards_lecture`,
-- `contacts_lecture_membre`, `organizations_lecture_membre`, `card_comments_lecture` et
-- `mail_messages_lecture` sont tenues par les suites de `CRM-040`, `CRM-060`, `CRM-043` et
-- `CRM-054`. Ces suites doivent rester VERTES SANS AUCUNE MODIFICATION, et c'est là qu'est la
-- preuve de non-régression de cette tranche, pas ici.
--
-- Ce que ce fichier prouve, et que rien d'autre ne prouve :
--
-- 1. QUE LE VOCABULAIRE CORRIGE UN ÉCART RÉEL DE `french` (§2 M2). L'assertion 3 est une
--    contre-épreuve : elle mesure que `french` seule NE TROUVE PAS « créance » sur « creance »,
--    et que la configuration dérivée le trouve. Sans elle, on pourrait croire la configuration
--    superflue et la retirer « pour simplifier » — la recherche resterait juste une fois sur deux.
--
-- 2. QUE LA FONCTION EST `SECURITY INVOKER` (§6.3). En `DEFINER`, elle répondrait pour `postgres`,
--    qui traverse toute la RLS, et rendrait à chacun les affaires, les contacts et les messages de
--    TOUS. Aucune preuve d'API ne peut voir cette propriété : elle ne se lit que dans le catalogue.
--
-- 3. QUE `anon` N'A PAS `execute`, ET QUE `authenticated` L'A. C'est la leçon payée par la
--    migration `0053` : `pg_default_acl` accorde `execute` à `anon` sur toute fonction neuve de
--    `public`, et `revoke … from public` ne lui retire rien. Un oubli de la ligne `revoke` rendrait
--    `200 []` là où la ligne *a* du §6.7 annonce `401`.
--
-- 4. QUE LE REFUS EST ZÉRO LIGNE SUR LES TROIS FAMILLES OÙ LE SEED REND LES PROFILS ASYMÉTRIQUES
--    (§2 M6), et non sur une seule : une affaire (« vitrine »), un commentaire (« gabarit ») et un
--    message (« candidature »). Une fonction qui aurait oublié le filtre sur UNE famille passerait
--    une preuve à famille unique.
--
-- 5. QUE LA BORNE DE 50 EST CELLE DU SERVEUR (ligne *h*). Le seed ne porte pas assez de lignes pour
--    que l'assertion morde : la suite POSE donc soixante contacts jetables, dans sa propre
--    transaction, pour que le plafond soit réellement franchi. Sans eux, l'assertion serait verte
--    sur une fonction qui n'aurait aucune borne.
--
-- La suite écrit — soixante contacts, un effacement doux — et fait `rollback` : le seed est rendu
-- intact. La transaction sert aussi à ce que les `set local role` et `set local request.jwt.claims`
-- ne fuient pas hors de la suite.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.p_admin() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.p_bizdev() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.p_viewer() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- `…0c1` : « Refonte du site vitrine », channel « Grands comptes », que la lectrice NE LIT PAS.
-- `…0d1` : son commentaire « La DSI a confirmé le périmètre de la refonte : trois gabarits ».
-- Les deux portent l'asymétrie de la mesure M6, DÉJÀ présente dans le seed : rien n'est fabriqué.
create or replace function pg_temp.card_fermee_a_la_lectrice() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c1'::uuid $$;
create or replace function pg_temp.commentaire_ferme_a_la_lectrice() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000d1'::uuid $$;
create or replace function pg_temp.workspace_seed() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 3. Le vocabulaire — docs/SPEC-recherche.md §3
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*)::integer
	   from pg_ts_config c
	   join pg_namespace n on n.oid = c.cfgnamespace
	  where n.nspname = 'app' and c.cfgname = 'francais_sans_accent'),
	1,
	'CRM-065 §3.1 — la configuration `app.francais_sans_accent` existe, et dans `app` : le schéma '
	'n''est pas exposé par PostgREST, une configuration de recherche n''étant pas un objet d''API');

select is(
	(select array_agg(d.dictname::text order by m.mapseqno)
	   from pg_ts_config c
	   join pg_namespace n on n.oid = c.cfgnamespace
	   join pg_ts_config_map m on m.mapcfg = c.oid
	   join pg_ts_dict d on d.oid = m.mapdict
	   join pg_ts_parser pa on pa.oid = c.cfgparser
	  where n.nspname = 'app' and c.cfgname = 'francais_sans_accent'
	    and m.maptokentype = (select tokid from ts_token_type(pa.oid) where alias = 'word')),
	array['unaccent', 'french_stem'],
	'CRM-065 §3.1 — `unaccent` est placé DEVANT `french_stem`, et l''ordre est le point : un '
	'dictionnaire qui rend un lexème arrête la chaîne');

-- LA CONTRE-ÉPREUVE. Sans elle, rien ne dirait que cette configuration sert à quelque chose.
select is(
	array[
		to_tsvector('pg_catalog.french', 'créance') @@ plainto_tsquery('pg_catalog.french', 'creance'),
		to_tsvector('app.francais_sans_accent', 'créance') @@ plainto_tsquery('app.francais_sans_accent', 'creance'),
		to_tsvector('app.francais_sans_accent', 'creance') @@ plainto_tsquery('app.francais_sans_accent', 'créance')
	],
	array[false, true, true],
	'CRM-065 §2 M2, §3.2 — `french` seule NE TROUVE PAS « créance » sur « creance » ; la '
	'configuration dérivée le trouve, et dans les DEUX SENS. C''est l''écart mesuré qui la motive');

-- ---------------------------------------------------------------------------------------------
-- 4. Les index — docs/SPEC-recherche.md §5
-- ---------------------------------------------------------------------------------------------

select is(
	(select array_agg(c.relname::text order by c.relname)
	   from pg_class c
	   join pg_namespace n on n.oid = c.relnamespace
	   join pg_index i on i.indexrelid = c.oid
	   join pg_am am on am.oid = c.relam
	  where n.nspname = 'public' and c.relname like '%\_recherche\_idx' and am.amname = 'gin'),
	array['card_comments_recherche_idx', 'cards_recherche_idx', 'contacts_recherche_idx',
	      'mail_messages_recherche_idx', 'organizations_recherche_idx'],
	'CRM-065 §5.1 — les CINQ index GIN d''expression existent, un par famille');

-- ASSERTION RÉVISÉE À L'ÉCRITURE, JAMAIS RETIRÉE, et son motif est écrit ici (mécanisme de la
-- décision 51). Elle figeait « aucune colonne `tsvector` sur les cinq tables », et elle a rougi :
-- `public.cards` en porte une depuis la migration 11 (`CRM-040`), `search_tsv`, générée et INDEXÉE,
-- qui sert la recherche LOCALE de la vue liste (`liste-cards.ts`). C'est la mesure M12 du §2, et
-- c'est ce que la version d'origine ignorait. L'assertion nomme donc désormais l'unique colonne
-- attendue au lieu de compter zéro : elle rougira si la tranche 1 en ajoute une, ce qui est ce
-- qu'elle doit surveiller, ET si `CRM-040` perd la sienne.
select is(
	(select array_agg(table_name || '.' || column_name order by table_name)
	   from information_schema.columns
	  where table_schema = 'public'
	    and table_name in ('cards', 'contacts', 'organizations', 'card_comments', 'mail_messages')
	    and data_type = 'tsvector'),
	array['cards.search_tsv'],
	'CRM-065 §5.1, §5.4 — la tranche 1 n''ajoute AUCUNE colonne `tsvector` : la seule est '
	'`cards.search_tsv`, héritée de `CRM-040` et laissée intacte. Une colonne générée neuve serait '
	'exposée par PostgREST et changerait la forme publique de ces tables');

select is(
	(select array_agg(indexname::text order by indexname)
	   from pg_indexes where tablename = 'cards' and indexdef ilike '%gin%'),
	array['cards_recherche_idx', 'cards_search_tsv_idx'],
	'CRM-065 §5.4 — `public.cards` porte DEUX index GIN, et c''est voulu : celui de `CRM-040` sert '
	'la recherche locale de la vue liste en `french`, celui-ci la recherche transverse pondérée en '
	'`app.francais_sans_accent`. La tranche 1 ne touche pas le premier');

-- ---------------------------------------------------------------------------------------------
-- 6 à 10. La forme de la fonction et ses privilèges — docs/SPEC-recherche.md §6.3
-- ---------------------------------------------------------------------------------------------

select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale'),
	false,
	'CRM-065 §6.3 — `SECURITY INVOKER`. En `DEFINER`, la fonction répondrait pour `postgres`, qui '
	'traverse toute la RLS : elle rendrait à chacun les objets de tous. Ne jamais la convertir');

select is(
	(select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale'),
	's',
	'CRM-065 §6.3 — `stable` : PostgREST n''expose en `GET` que les fonctions non volatiles, et la '
	'recherche lit. Pas `immutable` non plus — le corps lit des tables');

select is(
	(select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'recherche_globale'),
	array['search_path=""'],
	'CRM-065 §6.3 — `search_path` vide, comme toute fonction du dépôt : tous les objets sont '
	'qualifiés');

select is(
	has_function_privilege('anon', 'public.recherche_globale(text, integer)', 'EXECUTE'),
	false,
	'CRM-065 §6.3, ligne *a* — `anon` N''A PAS `execute`. `pg_default_acl` le lui accorde sur toute '
	'fonction neuve de `public` : sans le `revoke` nominatif, l''anonyme aurait `200 []` au lieu '
	'de `401` — un refus par le privilège est plus strict qu''une liste vide');

select is(
	array[
		has_function_privilege('authenticated', 'public.recherche_globale(text, integer)', 'EXECUTE'),
		has_function_privilege('service_role', 'public.recherche_globale(text, integer)', 'EXECUTE')
	],
	array[true, true],
	'CRM-065 §6.3 — `authenticated` et `service_role` ont `execute`');

-- ---------------------------------------------------------------------------------------------
-- 11 à 18. Ce que la fonction REND, sous l'administratrice
-- ---------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000011","role":"authenticated"}';

select is(
	(select array_agg(r.titre order by r.titre)
	   from public.recherche_globale('audi', 20) r),
	array['Audit de performance — portail Meunier', 'Audit sécurité applicative'],
	'CRM-065 §6.7 lignes *b* et *m* — « audi » trouve les deux affaires « Audit… » par PRÉFIXE. '
	'Sans le suffixe `:*` du §6.2, une palette ne rendrait rien avant le dernier caractère');

select is(
	(select count(*)::integer from public.recherche_globale('astreint', 20)),
	5,
	'CRM-065 §6.7 ligne *m* — « astreint » trouve les CINQ lignes du seed qui le portent');

select is(
	array[
		(select count(*)::integer from public.recherche_globale('elise', 20)),
		(select count(*)::integer from public.recherche_globale('Élise', 20))
	],
	array[1, 1],
	'CRM-065 §6.7 lignes *k* et *l* — « Élise Fabre » se trouve saisie SANS accent comme AVEC. '
	'Avec `french` seule, l''un des deux sens échouerait (assertion 3)');

select is(
	(select r.objet from public.recherche_globale('elise', 20) r),
	'contact',
	'CRM-065 §4 — le discriminant de famille est `contact`, valeur STABLE dont la tranche 2 '
	'dépendra pour router vers l''écran');

select is(
	(select count(*)::integer from public.recherche_globale('audit zzzzz', 20)),
	0,
	'CRM-065 §6.7 ligne *n* — CONJONCTION : deux mots saisis, un seul présent, aucune ligne. '
	'L''union noierait la ligne cherchée dès le deuxième mot');

select is(
	(select array_agg(distinct r.objet order by r.objet)
	   from public.recherche_globale('refonte', 20) r),
	array['affaire', 'commentaire', 'message'],
	'CRM-065 §6.7 ligne *j* — « refonte » traverse TROIS familles, classées entre elles');

-- L'EXTRAIT — §6.5. Il n'existe que là où il y a un corps long, et il est replié sur une ligne :
-- mesuré (M11), `ts_headline` rend un corps court EN ENTIER, retours à la ligne compris.
select is(
	(select r.extrait ~ '\s\s' or r.extrait ~ E'\n'
	   from public.recherche_globale('gabarit', 20) r where r.objet = 'commentaire'),
	false,
	'CRM-065 §6.5 — l''extrait d''un commentaire est REPLIÉ : ni retour à la ligne, ni double '
	'blanc. Une palette n''affiche qu''une ligne');

select is(
	(select array_agg(r.extrait) from public.recherche_globale('audi', 20) r),
	array[null, null]::text[],
	'CRM-065 §6.5 — une affaire n''a pas d''extrait : `null`, et non une chaîne vide qui se '
	'confondrait avec un corps sans correspondance');

-- ---------------------------------------------------------------------------------------------
-- 19 à 21. LE REFUS EST ZÉRO LIGNE, SUR LES TROIS FAMILLES ASYMÉTRIQUES — §6.7 ligne *c*
-- ---------------------------------------------------------------------------------------------
-- Chaque assertion mesure les DEUX côtés dans la même expression : ce que l'administratrice voit,
-- ce que l'autre profil ne voit pas. Une fonction qui rendrait zéro partout passerait la moitié
-- droite de chacune.

select is(
	array[
		(select count(*)::integer from public.recherche_globale('vitrine', 20)),
		(select count(*)::integer from public.recherche_globale('gabarit', 20)),
		(select count(*)::integer from public.recherche_globale('candidature', 20))
	],
	array[2, 1, 1],
	'CRM-065 §2 M6 — sous l''administratrice : DEUX LIGNES sur « vitrine » — l''affaire et le '
	'message dont le corps la nomme, ce qui en fait un meilleur témoin qu''une famille unique —, le '
	'commentaire aux '
	'« gabarits », le message « Candidature spontanée »');

set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000013","role":"authenticated"}';

select is(
	array[
		(select count(*)::integer from public.recherche_globale('vitrine', 20)),
		(select count(*)::integer from public.recherche_globale('gabarit', 20)),
		(select count(*)::integer from public.recherche_globale('candidature', 20)),
		(select count(*)::integer from public.recherche_globale('astreint', 20))
	],
	array[0, 0, 0, 5],
	'CRM-065 §6.7 ligne *c* — sous la lectrice, les TROIS familles se taisent : l''affaire de '
	'« Grands comptes », son commentaire et le message ne lui sont pas ouverts. ZÉRO LIGNE, jamais '
	'une erreur. Et « astreint » rend ses cinq lignes : ce n''est pas la fonction qui est muette');

set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000012","role":"authenticated"}';

select is(
	array[
		(select count(*)::integer from public.recherche_globale('candidature', 20)),
		(select count(*)::integer from public.recherche_globale('vitrine', 20))
	],
	array[0, 2],
	'CRM-065 §2 M6 — le business developer LIT les deux lignes de « vitrine » mais NE LIT PAS le '
	'message non classé : le filtrage est bien celui de chaque table, jamais un filtrage global');

-- ---------------------------------------------------------------------------------------------
-- 22 à 27. Les cas limites du terme et de la borne — §6.7 lignes *d* à *h*
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000011","role":"authenticated"}';

select is(
	array[
		(select count(*)::integer from public.recherche_globale(null, 20)),
		(select count(*)::integer from public.recherche_globale('', 20)),
		(select count(*)::integer from public.recherche_globale('   !!  ---  ', 20))
	],
	array[0, 0, 0],
	'CRM-065 §6.7 lignes *d* et *e* — terme nul, vide, ou fait de blancs et de ponctuation : zéro '
	'ligne, et AUCUNE erreur. `to_tsquery` lève sur une syntaxe invalide, et une erreur serveur à '
	'chaque frappe serait un défaut visible');

select is(
	(select count(*)::integer from public.recherche_globale('le la de', 20)),
	0,
	'CRM-065 §6.7 ligne *f* — un terme fait uniquement de mots vides français rend zéro ligne. Le '
	'garde-fou passe par `to_tsvector` et non `to_tsquery`, qui journaliserait un NOTICE à chaque '
	'frappe (§2 M8)');

select is(
	array[
		(select count(*)::integer from public.recherche_globale('astreint', 0)),
		(select count(*)::integer from public.recherche_globale('astreint', -3)),
		(select count(*)::integer from public.recherche_globale('astreint', null))
	],
	array[0, 0, 0],
	'CRM-065 §6.7 ligne *g* — une borne nulle, zéro ou négative rend zéro ligne');

select is(
	(select count(*)::integer from public.recherche_globale('astreint', 2)),
	2,
	'CRM-065 §6.6 — la borne demandée est RESPECTÉE quand elle est inférieure au nombre de lignes');

-- LA BORNE DE 50 — ligne *h*. Le seed ne porte pas assez de lignes pour que l''assertion morde :
-- soixante contacts jetables sont posés ici, et la transaction les emporte.
reset role;
insert into public.contacts (workspace_id, full_name)
select pg_temp.workspace_seed(), 'Plafondier ' || g
  from generate_series(1, 60) g;

set local role authenticated;
set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000011","role":"authenticated"}';

select is(
	(select count(*)::integer from public.recherche_globale('plafondier', 999)),
	50,
	'CRM-065 §6.7 ligne *h* — soixante lignes correspondent, neuf cent quatre-vingt-dix-neuf sont '
	'demandées, CINQUANTE sont rendues. La borne est celle du SERVEUR : un client demande ce '
	'qu''il veut');

select is(
	(select count(*)::integer from public.recherche_globale('plafondier', 7)),
	7,
	'CRM-065 §6.6 — sous le plafond, c''est la borne demandée qui s''applique');

-- ---------------------------------------------------------------------------------------------
-- 28 à 30. L'effacement doux, l'ordre, et l'absence de revendication — §6.7 lignes *i* et *o*
-- ---------------------------------------------------------------------------------------------

-- L'ORDRE — §6.6. `rang` décroissant d'abord. L'assertion mesure la MONOTONIE de la suite rendue,
-- pas une valeur : le rang dépend du nombre de correspondances et figer un flottant serait figer
-- l'implémentation de `ts_rank_cd`.
select is(
	(select bool_and(ordonne)
	   from (select r.rang <= lag(r.rang) over (order by ordinality) as ordonne
	           from public.recherche_globale('refonte', 20) with ordinality as r(objet, id,
	                workspace_id, titre, sous_titre, extrait, rang, ordinality)) t
	  where ordonne is not null),
	true,
	'CRM-065 §6.6 — les lignes sortent par rang DÉCROISSANT');

reset role;
update public.cards set deleted_at = now() where id = pg_temp.card_fermee_a_la_lectrice();

set local role authenticated;
set local request.jwt.claims to '{"sub":"5eed0000-0000-4000-8000-000000000011","role":"authenticated"}';

select is(
	array[
		(select count(*)::integer from public.recherche_globale('vitrine', 20)),
		(select count(*)::integer from public.recherche_globale('gabarit', 20))
	],
	array[1, 0],
	'CRM-065 §6.7 ligne *i* — une affaire mise à la CORBEILLE sort de la recherche, ET SON '
	'COMMENTAIRE AVEC ELLE. La ligne reste lisible — c''est ce qui permet de la restaurer '
	'(`CRM-077`) : l''exclure est une décision de la RECHERCHE, pas de la sécurité. La seconde '
	'moitié de cette assertion a été écrite AVANT le `not exists` de la migration et l''a rendue '
	'nécessaire : `card_comments` porte son propre `deleted_at`, que la corbeille de l''affaire ne '
	'touche pas, et la palette aurait offert une destination morte');

reset role;
set local request.jwt.claims to '';

select is(
	(select count(*)::integer from public.recherche_globale('candidature', 20)),
	1,
	'CRM-065 §6.7 ligne *o* — sans revendication, le propriétaire traverse la RLS et voit le '
	'message non classé. La fonction ne pose AUCUN filtre qui lui soit propre : elle laisse '
	'décider les politiques');

select * from finish();

rollback;

-- @spec CRM-042 (docs/BACKLOG.md) — vue liste : la recherche locale passe au vocabulaire unique
-- @spec docs/JOURNAL.md décision 532 §2 — arbitrage du responsable fermant INC-230 : « on veut le
--       même comportement et le plus simple le mieux, donc on cherche en ignorant les
--       diacritiques ». Issue 1 des trois consignées, les deux autres écartées avec leur motif.
-- @spec docs/SPEC-recherche.md §3 (le vocabulaire `app.francais_sans_accent`), §2 M2 (la mesure
--       qui établit que `french` n'est PAS insensible aux accents), §16.3 (INC-230, désormais
--       fermée) ; docs/SCHEMA.md §10 ; docs/PROD_MIGRATIONS.md
--
-- CE QUE CETTE MIGRATION CORRIGE, ET IL EST MESURÉ, PAS SUPPOSÉ. La configuration `french` livrée
-- avec PostgreSQL retire l'accent de certains mots et le conserve dans d'autres, sans règle qu'un
-- utilisateur puisse deviner :
--
--   to_tsvector('french','Amélie Dupont créance échéance')
--     =>  'amel':1 'dupont':2 'créanc':3 'échéanc':4
--
--   | Saisie    | Document   | `french`        |
--   | amelie    | Amélie     | TROUVE          |
--   | societe   | société    | TROUVE          |
--   | creance   | créance    | NE TROUVE PAS   |
--   | echeance  | échéance   | NE TROUVE PAS   |
--   | proces    | procès     | NE TROUVE PAS   |
--
-- `CRM-065` a livré `app.francais_sans_accent` (migration 68) et l'a employée pour la recherche
-- TRANSVERSE seulement, laissant la vue liste sur `french` : le produit portait donc **deux
-- vocabulaires**, et c'est ce qu'INC-230 consignait. Le motif de la décision est celui déjà écrit
-- dans l'entrée du registre — **un comportement juste une fois sur deux est pire qu'un
-- comportement uniformément strict, parce qu'il apprend à l'utilisateur une règle fausse** : qui
-- constate que `amelie` trouve « Amélie » conclura que `creance` trouve « créance ».
--
-- CE QU'ELLE NE FAIT PAS. Elle ne touche NI `public.recherche_globale`, NI les cinq index de la
-- migration 68, NI aucune politique, NI aucun privilège. Aucune colonne n'est ajoutée ni retirée :
-- `search_tsv` garde son nom, son type et sa nature de colonne générée. La **forme publique** de
-- `public.cards` est donc inchangée — un `select=*` rend exactement les mêmes colonnes.
--
-- ELLE NE TOUCHE PAS NON PLUS `default_text_search_config` (docs/SPEC-recherche.md §3.3) : la
-- configuration est nommée **explicitement** ici comme partout ailleurs. Un paramètre de session
-- rendrait l'expression non immuable, et une colonne générée l'exige — c'est la mesure qui avait
-- imposé `'french'` explicite dans la migration 11, et elle vaut identiquement pour celle-ci.

-- =============================================================================================
-- 1. La colonne générée est redéfinie
-- =============================================================================================
--
-- `alter column … set expression` RÉÉCRIT LA TABLE ET RECONSTRUIT SES INDEX. C'est le coût de
-- cette correction, il est assumé, et `docs/PROD_MIGRATIONS.md` porte le point de vigilance : en
-- production peuplée, l'opération prend un verrou exclusif sur `public.cards` le temps de la
-- réécriture, et se passe en fenêtre — comme les cinq index de `CRM-065`.
--
-- POURQUOI PAS UN `drop` SUIVI D'UN `add`. Les deux réécrivent la table de la même façon, mais
-- `drop column` déplacerait `search_tsv` en fin d'ordre de colonnes et la ferait disparaître de
-- toute vue ou politique qui la nommerait — le remède serait alors plus risqué que le mal.
--
-- REJOUABLE SANS ERREUR, comme toutes les migrations de ce dépôt : le `migrations-runner` ne tient
-- aucun registre et rejoue le répertoire entier. Poser deux fois la même expression est un
-- non-événement pour PostgreSQL — la table est réécrite à l'identique — mais la garde ci-dessous
-- lui épargne cette réécriture quand elle est déjà en place, ce qui n'est pas une optimisation de
-- confort : sur une base peuplée, c'est la différence entre un rejeu instantané et un verrou.
do $bloc$
begin
	if exists (
		select 1
		from pg_attrdef d
		join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
		where d.adrelid = 'public.cards'::regclass
		  and a.attname = 'search_tsv'
		  and pg_get_expr(d.adbin, d.adrelid) like '%francais_sans_accent%'
	) then
		raise notice 'cards.search_tsv emploie déjà app.francais_sans_accent : rien à faire.';
	else
		alter table public.cards
			alter column search_tsv
			set expression as (
				to_tsvector(
					'app.francais_sans_accent',
					coalesce(title, '') || ' ' || coalesce(description, '')
				)
			);
	end if;
end
$bloc$;

comment on column public.cards.search_tsv is
	'CRM-040, RÉVISÉE par CRM-042 — docs/JOURNAL.md décision 532. Recherche LOCALE de la vue '
	'liste. Le vocabulaire est « app.francais_sans_accent », le MÊME que public.recherche_globale : '
	'le produit n''a qu''une seule façon de comprendre un accent. La configuration est nommée '
	'explicitement — implicite, l''expression ne serait pas immuable et la colonne générée serait '
	'refusée.';

-- =============================================================================================
-- 2. L'index suit la colonne, sans être touché
-- =============================================================================================
--
-- `cards_search_tsv_idx` porte sur la COLONNE, non sur une expression : il est donc reconstruit
-- automatiquement par la réécriture ci-dessus, et n'a pas à être supprimé puis recréé. C'est la
-- différence avec les cinq index de la migration 68, qui sont des index d'EXPRESSION et dont
-- l'expression doit être écrite à l'identique de la requête (docs/SPEC-recherche.md §5.2).
--
-- La ligne ci-dessous ne le recrée donc pas : elle CONSTATE qu'il est là. Un index disparu en
-- silence transformerait chaque frappe de la vue liste en parcours complet de `cards`, et cette
-- dégradation ne se verrait sur aucun écran.
do $bloc$
begin
	if not exists (
		select 1 from pg_class where relname = 'cards_search_tsv_idx' and relkind = 'i'
	) then
		raise exception 'cards_search_tsv_idx a disparu : la vue liste chercherait sans index.';
	end if;
end
$bloc$;

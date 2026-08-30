-- @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
--            TRANCHE 2 a : l'agrégat descend en base
-- @verifies docs/SPEC-analytique.md §3 (probabilité effective à trois niveaux, absence assumée),
--            §4 (les deux exclusions, et l'inclusion du sommeil), §5.1 (signature, grain, libellé du
--            catalogue, arrondi), §5.3 (`security invoker` obligatoire), §5.4 (`anon` révoqué
--            nommément), §5.5 (ce que la fonction ne fait pas), §6 (contrat d'API, lignes b à n)
-- @verifies docs/SCHEMA.md §9 bis.11 (contrat de `public.entonnoir_conversion`)
-- @verifies docs/SPEC-permissions-rls.md §2.2 (le plus spécifique gagne), §3.3 bis (un channel
--            rouvert sous un track fermé), §7 (le refus est zéro ligne)
-- @verifies docs/SPEC-costs.md §2.3 (« nul n'est pas zéro »), §4.5 (un cumul se calcule APRÈS la RLS)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les identités réelles)
--
-- CE QUE CETTE SUITE PROUVE, ET POURQUOI CHAQUE GROUPE EXISTE.
--
-- 1. LA FORME DE LA FONCTION, et c'est le groupe le plus important. `security invoker` n'est pas ici
--    un défaut accepté : en `definer`, la fonction répondrait pour `postgres`, qui traverse toute la
--    RLS, et rendrait à CHAQUE appelant le portefeuille de tout le monde. Une suite qui ne
--    mesurerait que des montants resterait VERTE sur cette régression tant qu'elle n'éprouverait
--    qu'un seul profil. C'est pourquoi le groupe 3 fait lire la MÊME fonction aux trois profils
--    réels du seed et exige DEUX totaux différents.
--
-- 2. LES PRIVILÈGES, `anon` NOMMÉMENT. `pg_default_acl` fait naître toute fonction de `public` avec
--    `anon=X` : sans révocation nominative, l'appelant anonyme obtiendrait `200` et un tableau vide
--    là où le contrat annonce `401`. La migration 53 a payé ce point de sûreté.
--
-- 3. « NUL N'EST PAS ZÉRO », dans les cas qui se ressemblent. Un montant absent ne doit pas être
--    compté comme zéro, et une probabilité absente ne doit pas être remplacée par un défaut — mais
--    une probabilité qui VAUT zéro, elle, doit bien produire un pondéré nul. Ces cas se ressemblent
--    dans le résultat et diffèrent dans la donnée ; une seule assertion les confondrait.
--
-- 4. LA RÉSOLUTION À TROIS NIVEAUX, dans ses trois sens, sur la MÊME affaire. Éprouver le seul
--    niveau du catalogue laisserait passer un `coalesce` écrit à l'envers.
--
-- 5. LA MÊME RÉSOLUTION, MAIS EXERCÉE PAR LE SEED SEUL — groupe 6 bis, ajouté par la TRANCHE 2 c.
--    Le groupe 4 écrit ses propres surcharges puis les retire ; il prouve la règle, mais il ne
--    prouve pas que les DONNÉES DE DÉVELOPPEMENT l'exercent. Depuis `CRM-066` tranche 2 c, le seed
--    pose les deux surcharges manquantes — 65 % sur l'étape `negociation`, 30 % sur « Reprise du
--    dossier Marchand » —, et le groupe 6 bis lit cet état SANS RIEN ÉCRIRE. L'encadrement
--    30 < 50 < 65 est ce qui le rend opposable : une résolution écrite à l'envers rendrait 50, un
--    `greatest` rendrait 65, un `least` rendrait 50 sur les huit autres affaires du nœud.
--
-- La suite pose ses fixtures DANS la transaction et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'reset role';
end;
$$;

-- Identités du seed, stables par contrat (`docs/SPEC-seed.md`).
create or replace function pg_temp.camille() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$;
create or replace function pg_temp.driss() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$;
create or replace function pg_temp.farida() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$;

-- Channels du seed.
create or replace function pg_temp.ch_grands_comptes() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000032'::uuid $$;
create or replace function pg_temp.ch_prospection() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000031'::uuid $$;
create or replace function pg_temp.ch_inter_entreprises() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000036'::uuid $$;
create or replace function pg_temp.ch_maintenance() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000035'::uuid $$;
-- Les deux channels du groupe 6 bis : `dossiers-2023` porte l'affaire SURCHARGÉE et elle seule au
-- nœud `negociation`, `refonte` en porte une autre, NON surchargée, à la MÊME étape.
create or replace function pg_temp.ch_dossiers_2023() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000037'::uuid $$;
create or replace function pg_temp.ch_refonte() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-000000000034'::uuid $$;

-- Cards témoins. « Cadrage data » est la SEULE affaire de `conseil-ia/prospection` au nœud
-- `prospection`, et elle est ENCORE ENDORMIE : elle sert à la fois de témoin du sommeil (groupe 4)
-- et de sujet unique de la résolution à trois niveaux (groupe 6), où l'isolement est indispensable —
-- le pondéré de sa ligne est alors exactement sa probabilité effective appliquée à son montant.
create or replace function pg_temp.cadrage_data() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000ca'::uuid $$;

-- L'étape de « Cadrage data » : le workflow de `conseil-ia` est une COPIE DÉRIVÉE (`CRM-032`) et ses
-- identifiants d'étape sont engendrés, jamais seedés. La résoudre depuis la card est donc la seule
-- écriture stable — coder l'identifiant en dur rendrait cette suite fausse au prochain seed.
create or replace function pg_temp.etape_cadrage() returns uuid language sql stable as
	$$ select current_step_id from public.cards where id = pg_temp.cadrage_data() $$;

-- « Reprise du dossier Marchand » : 22 000,00 EUR, SEULE affaire active de `dossiers-2023` au nœud
-- `negociation`, et la seule affaire du seed qui porte une `probability_override` (tranche 2 c).
create or replace function pg_temp.reprise_marchand() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000cf'::uuid $$;

-- =============================================================================================
-- 1. La FORME de la fonction — `invoker`, `stable`, `search_path` vide
-- =============================================================================================
-- docs/SPEC-analytique.md §5.1 et §5.3, docs/SCHEMA.md §9 bis.11.

select has_function(
	'public', 'entonnoir_conversion', '{}'::text[],
	'CRM-066 : `public.entonnoir_conversion()` existe');

select is(
	(select prosecdef from pg_proc where oid = 'public.entonnoir_conversion()'::regprocedure),
	false,
	'CRM-066 : elle est `security INVOKER` — en `definer` elle rendrait à chacun le portefeuille de '
	'tout le monde, et un prévisionnel incluant une affaire interdite la divulguerait par '
	'soustraction');

select is(
	(select provolatile from pg_proc where oid = 'public.entonnoir_conversion()'::regprocedure),
	's'::"char",
	'CRM-066 : elle est `stable` — PostgREST n''expose en `GET` que les fonctions non volatiles');

select ok(
	(select proconfig from pg_proc where oid = 'public.entonnoir_conversion()'::regprocedure)
		@> array['search_path=""'],
	'CRM-066 : son `search_path` est VIDE — tous les objets du corps sont pleinement qualifiés');

-- =============================================================================================
-- 2. Les privilèges, `anon` NOMMÉMENT
-- =============================================================================================
-- docs/SPEC-analytique.md §5.4. Point de sûreté payé par la migration 53.

select ok(
	not has_function_privilege('anon', 'public.entonnoir_conversion()', 'EXECUTE'),
	'CRM-066 : `anon` NE l''exécute PAS — il est refusé par le PRIVILÈGE, `401` / `42501`, et non '
	'par un tableau vide. `revoke ... from public` seul ne lui retirerait rien');

select ok(
	has_function_privilege('authenticated', 'public.entonnoir_conversion()', 'EXECUTE'),
	'CRM-066 : `authenticated` l''exécute');

select ok(
	has_function_privilege('service_role', 'public.entonnoir_conversion()', 'EXECUTE'),
	'CRM-066 : `service_role` l''exécute — la contre-épreuve du §6 ligne h en dépend');

-- =============================================================================================
-- 3. Trois profils réels, DEUX totaux — la seule preuve que `invoker` tient
-- =============================================================================================
-- docs/SPEC-analytique.md §5.3 et §6, lignes b, e et f.

select pg_temp.endosser(pg_temp.camille());

select is(
	(select sum(e.affaires)::integer from public.entonnoir_conversion() e),
	39,
	'CRM-066 : Camille, administratrice, totalise 39 affaires actives — un droit fin `none` sur '
	'`conseil-ia` ne restreint JAMAIS un administrateur de workspace');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.driss());

select is(
	(select sum(e.affaires)::integer from public.entonnoir_conversion() e),
	39,
	'CRM-066 : Driss, business developer, totalise lui aussi 39 affaires');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.farida());

select is(
	(select sum(e.affaires)::integer from public.entonnoir_conversion() e),
	35,
	'CRM-066 : Farida, lectrice, totalise 35 affaires — QUATRE de moins. C''EST LA PREUVE que '
	'l''agrégat s''exécute sous l''identité de l''appelant : en `definer` elle en verrait 39');

select is(
	(select count(*)::integer from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_grands_comptes()),
	0,
	'CRM-066 : et les quatre manquantes sont celles de `grands-comptes`, dont AUCUNE ligne ne lui '
	'est rendue — son track lui est fermé');

select is(
	(select e.affaires from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	1,
	'CRM-066 : le channel qui lui est ROUVERT sous ce même track lui rend bien sa ligne — « le plus '
	'spécifique gagne » vaut dans les deux sens (docs/SPEC-permissions-rls.md §3.3 bis)');

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(pg_temp.camille());

-- =============================================================================================
-- 4. Les DEUX exclusions, et l'INCLUSION du sommeil
-- =============================================================================================
-- docs/SPEC-analytique.md §4.

select is(
	(select e.affaires from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_grands_comptes() and e.node_key = 'prospection'),
	1,
	'CRM-066 : la card EN CORBEILLE (« Saisie erronée ») n''est pas comptée — `grands-comptes` en '
	'porte deux au nœud `prospection`, dont une supprimée');

select is(
	(select e.affaires from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_grands_comptes() and e.node_key = 'livre'),
	1,
	'CRM-066 : la card ARCHIVÉE (« Contrat cadre 2025 ») n''est pas comptée — `grands-comptes` en '
	'porte deux au nœud `livre`, dont une rangée');

select is(
	(select e.affaires from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	1,
	'CRM-066 : l''affaire EN SOMMEIL (« Cadrage data ») EST comptée — divergence VOULUE avec '
	'`cards_figees`, qui l''exclut : le sommeil dit « ne me réveille pas », jamais « cette affaire '
	'n''est plus au portefeuille »');

select is(
	(select count(*)::integer from public.cards_figees() f
	  where f.card_id = pg_temp.cadrage_data()),
	0,
	'CRM-066 : contre-épreuve de la divergence — `cards_figees` ne rend PAS cette même affaire. '
	'Sans elle, l''assertion précédente serait vraie même si les deux règles étaient identiques');

-- =============================================================================================
-- 5. « Nul n'est pas zéro », dans les cas qui se ressemblent
-- =============================================================================================
-- docs/SPEC-analytique.md §3, docs/SPEC-costs.md §2.3.

select is(
	(select array[e.affaires, e.affaires_sans_montant] from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_inter_entreprises() and e.node_key = 'prospection'),
	array[1, 1],
	'CRM-066 : l''affaire SANS MONTANT est comptée dans `affaires` ET comptée à part — sans quoi un '
	'prévisionnel bas se lirait comme un portefeuille pauvre au lieu d''un portefeuille mal '
	'renseigné');

select is(
	(select array[e.montant, e.montant_pondere] from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_inter_entreprises() and e.node_key = 'prospection'),
	array[0.00::numeric, 0.00::numeric],
	'CRM-066 : et elle ne contribue à AUCUN total, bien que sa probabilité soit connue (10 %) — le '
	'pondéré n''existe que si le montant ET la probabilité existent');

select is(
	(select array[e.affaires_sans_probabilite, e.montant_pondere::integer]
	   from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_inter_entreprises() and e.node_key = 'perdu'),
	array[0, 0],
	'CRM-066 : une probabilité qui VAUT zéro n''est pas une probabilité ABSENTE — le nœud `perdu` '
	'rend un pondéré nul avec `affaires_sans_probabilite` à ZÉRO. Les deux cas se ressemblent dans '
	'le résultat et diffèrent dans la donnée');

-- =============================================================================================
-- 6. La résolution à TROIS niveaux, dans ses trois sens, sur la MÊME affaire
-- =============================================================================================
-- docs/SPEC-analytique.md §3. « Cadrage data » vaut 38 000,00 EUR et est SEULE sur sa ligne.

select is(
	(select e.montant_pondere from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	3800.00::numeric,
	'CRM-066 : NIVEAU 3, le catalogue seul — 38 000,00 × 10 %. L''éprouver seul laisserait passer '
	'un `coalesce` écrit à l''envers, d''où les deux niveaux qui suivent');

select pg_temp.redevenir_proprietaire();

update public.workflow_steps set probability_override = 25 where id = pg_temp.etape_cadrage();

select pg_temp.endosser(pg_temp.camille());

select is(
	(select e.montant_pondere from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	9500.00::numeric,
	'CRM-066 : NIVEAU 2, l''ÉTAPE l''emporte sur le catalogue — 38 000,00 × 25 %');

select pg_temp.redevenir_proprietaire();

update public.cards set probability_override = 75 where id = pg_temp.cadrage_data();

select pg_temp.endosser(pg_temp.camille());

select is(
	(select e.montant_pondere from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	28500.00::numeric,
	'CRM-066 : NIVEAU 1, l''AFFAIRE l''emporte sur l''étape — 38 000,00 × 75 %. Le plus spécifique '
	'gagne, comme partout dans ce produit');

select pg_temp.redevenir_proprietaire();

-- Les trois niveaux retirés : la probabilité devient INCONNUE. Elle ne doit pas devenir zéro.
update public.cards set probability_override = null where id = pg_temp.cadrage_data();
update public.workflow_steps set probability_override = null where id = pg_temp.etape_cadrage();
update public.workflow_nodes_catalog set default_probability = null
 where id = (select node_id from public.workflow_steps where id = pg_temp.etape_cadrage());

select pg_temp.endosser(pg_temp.camille());

select is(
	(select array[e.affaires_sans_probabilite, e.montant::integer, e.montant_pondere::integer]
	   from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_prospection() and e.node_key = 'prospection'),
	array[1, 38000, 0],
	'CRM-066 : les TROIS niveaux nuls — l''affaire est comptée SANS PROBABILITÉ, son montant reste '
	'entier, et son pondéré est absent du total. Substituer `0` dirait « cette affaire ne vaut '
	'rien » là où la donnée dit « personne ne l''a estimée »');

-- =============================================================================================
-- 6 bis. La MÊME résolution, exercée par le SEED SEUL — CRM-066 tranche 2 c
-- =============================================================================================
-- docs/SPEC-analytique.md §9. Le groupe 6 écrit ses surcharges puis les retire : il prouve la
-- RÈGLE. Ce groupe-ci n'écrit RIEN et lit l'état que le seed a posé : il prouve que les DONNÉES DE
-- DÉVELOPPEMENT l'exercent, ce que `CLAUDE.md` §8 exige d'une règle métier neuve.

select is(
	(select array[
		(select n.default_probability from public.workflow_nodes_catalog n where n.key = 'negociation'),
		(select s.probability_override from public.workflow_steps s
		  where s.id = '5eed0000-0000-4000-8000-000000000063'::uuid),
		(select c.probability_override from public.cards c where c.id = pg_temp.reprise_marchand())
	]),
	array[50.00::numeric, 65.00::numeric, 30.00::numeric],
	'CRM-066 : le seed pose les TROIS niveaux, et il pose trois nombres DISTINCTS — catalogue 50 %, '
	'étape 65 %, affaire 30 %. Deux valeurs égales ne distingueraient pas une résolution correcte '
	'd''une résolution qui s''arrête au mauvais niveau');

select is(
	(select e.montant_pondere from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_dossiers_2023() and e.node_key = 'negociation'),
	6600.00::numeric,
	'CRM-066 : l''AFFAIRE l''emporte sur son étape et sur le catalogue, sur la donnée seedée — '
	'22 000,00 × 30 %. Une résolution écrite à l''envers rendrait 11 000,00, un `greatest` 14 300,00');

select is(
	(select e.montant_pondere from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_refonte() and e.node_key = 'negociation'),
	46800.00::numeric,
	'CRM-066 : à la MÊME étape, une affaire SANS surcharge propre prend celle de l''étape — '
	'72 000,00 × 65 %. Sans cette ligne, « 30 % » pourrait aussi bien être une valeur appliquée à '
	'toutes les affaires du nœud');

select is(
	(select sum(e.montant_pondere) from public.entonnoir_conversion() e
	  where e.node_key = 'negociation'),
	230752.50::numeric,
	'CRM-066 : le nœud entier rend 230 752,50 — et non 183 425,00, qui serait le total si le '
	'catalogue l''emportait partout. Un seul nombre, qui tombe dès qu''un niveau de la résolution '
	'cesse d''être lu');

-- =============================================================================================
-- 7. Le libellé du CATALOGUE, jamais celui de l'étape
-- =============================================================================================
-- docs/SPEC-analytique.md §5.1. Le seed pose déjà la divergence : les DEUX workflows renomment le
-- nœud `realisation` en « Réalisation en cours » au niveau de l'étape.

select is(
	(select count(distinct e.node_label)::integer from public.entonnoir_conversion() e
	  where e.node_key = 'realisation' and e.node_label = 'Réalisation'),
	1,
	'CRM-066 : `node_label` est celui du CATALOGUE — les deux workflows du seed renomment pourtant '
	'cette étape « Réalisation en cours ». L''entonnoir compare des affaires à TRAVERS les '
	'workflows : le libellé de l''étape ferait porter deux noms à une même ligne');

-- =============================================================================================
-- 8. Le grain — par devise, et seulement là où il y a des affaires
-- =============================================================================================
-- docs/SPEC-analytique.md §5.1 et §5.2.

select is(
	(select array_agg(e.currency order by e.currency) from public.entonnoir_conversion() e
	  where e.channel_id = pg_temp.ch_maintenance() and e.node_key = 'relance'),
	array['CHF', 'EUR'],
	'CRM-066 : deux devises au même nœud du même channel rendent DEUX lignes — les additionner '
	'exigerait un taux de change que personne n''a arbitré');

select is(
	(select count(*)::integer from public.entonnoir_conversion() e where e.affaires = 0),
	0,
	'CRM-066 : aucune ligne vide n''est émise — un nœud sans affaire se tait, et l''écran compose la '
	'liste complète depuis `workflow_nodes_catalog`');

select pg_temp.redevenir_proprietaire();

select is(
	(select count(*)::integer from public.workflow_steps s
	  join public.workflow_nodes_catalog n on n.id = s.node_id
	 where n.archived_at is not null),
	0,
	'CRM-066 : aucune étape ne se rattache à un nœud ARCHIVÉ du catalogue — c''est pourquoi la '
	'fonction ne nomme pas `archived_at`, et une condition qui l''aurait nommé serait une condition '
	'sans objet');

select * from finish();

rollback;

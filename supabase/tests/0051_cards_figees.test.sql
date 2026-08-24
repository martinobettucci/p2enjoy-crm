-- @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1 : la
--           règle descend en base
-- @verifies docs/SPEC-relances.md §2.2 (seuil effectif, et jamais de défaut inventé), §2.3 (les
--           nœuds terminaux ne sont pas nommés par la règle, et la conséquence est figée ici),
--           §2.4 (les trois exclusions, éprouvées dans les deux sens), §2.5 (la borne et les jours
--           révolus), §3.2 (`stable`, `search_path` vide, JAMAIS `security definer`),
--           §3.3 (l'ACL rôle par rôle, et `anon` révoqué NOMMÉMENT), §3.4 (l'ordre),
--           §5 (conformité du seed)
-- @verifies docs/SCHEMA.md §9 bis.9 (`public.cards_figees`)
-- @verifies docs/SPEC-permissions-rls.md §3.7 (`app.can_read_card`), §7 (le refus est zéro ligne)
-- @verifies docs/SPEC-seed.md §9.12.6 (l'unique card du seed au-delà de son seuil)
-- @verifies docs/PROD_MIGRATIONS.md §3 (migration 53 : `prosecdef` doit être FAUX, `anon` sans
--           `execute`)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS le contrat d'ancienneté du seed — « exactement une card active au-delà de
-- son seuil, et c'est `…00c3` ». `docs/SPEC-seed.md` §9.12.6 le porte, et `scripts/verify-board.sh`
-- le mesure avec sa contre-épreuve depuis `CRM-046` tranche 3. Ce qu'elle mesure ici, c'est que
-- `public.cards_figees()` **rend ce même fait**, ce que rien d'autre ne vérifie.
--
-- Ce qu'elle prouve, et que rien d'autre ne prouve :
--
-- 1. SA FORME DANS LE CATALOGUE. `prosecdef` FAUX est l'assertion la plus importante du fichier.
--    En `SECURITY DEFINER`, la fonction répondrait pour `postgres`, qui traverse toute la RLS, et
--    rendrait donc à CHAQUE appelant les affaires figées de tout le monde — droits fins de
--    `CRM-012` compris. Ce défaut ne se voit ni à la lecture du SQL — `security invoker` étant le
--    DÉFAUT, il ne s'écrit pas — ni à l'usage sous un compte qui lit tout de toute façon.
--
-- 2. SON ACL RÔLE PAR RÔLE. `anon` sans `execute` n'est pas acquis par un `revoke ... from public` :
--    `pg_default_acl` porte `alter default privileges in schema public ... on functions to anon`,
--    si bien qu'une fonction neuve de `public` naît avec `anon=X`, et que `public` — pseudo-rôle —
--    n'est pas `anon` — rôle nommé. La première écriture de la migration 53 est tombée exactement
--    là, et l'appelant anonyme obtenait `200 []` au lieu de `401`. L'assertion fige les trois rôles.
--
-- 3. SES TROIS EXCLUSIONS, DANS LES DEUX SENS. Chacune est éprouvée en VIEILLISSANT la card de
--    quatre-vingt-dix jours : une exclusion qui ne serait jamais mise à l'épreuve par une card
--    assez vieille pour être figée ne prouverait rien du tout.
--
-- 4. LA DIFFÉRENCE ENTRE « ENDORMIE » ET « A ÉTÉ ENDORMIE ». Le seed porte les deux cas — une
--    échéance future et une échéance échue —, et le prédicat doit les séparer. Un prédicat écrit
--    `snoozed_until is null` seul écarterait les deux ; écrit `snoozed_until < now()` il inclurait
--    les deux. Les deux assertions se tiennent l'une l'autre.
--
-- 5. LES DEUX CÔTÉS DE LA BORNE. `>=` sur des jours révolus, comme `evaluerAnciennete` dans
--    `board.ts`. Écrire `>` en base ferait diverger la pastille du board et la relance d'une
--    journée entière, et personne ne saurait laquelle a raison.
--
-- 6. LA CONSÉQUENCE DE LA DÉCISION DU §2.3, POSITIVEMENT. Les nœuds terminaux ne sont pas nommés
--    par la règle : un seuil posé sur `livre` rend donc ses cards relançables. Ce n'est pas un
--    défaut, c'est le prix — écrit — de n'avoir qu'UNE définition de « terminal ». L'assertion le
--    constate, de sorte que le jour où cette liberté devient gênante, la preuve le dise plutôt
--    qu'un utilisateur.
--
-- La suite modifie des lignes du seed et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

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
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Le nombre de lignes que la fonction rend à l'appelant COURANT. Exécutée sous un rôle endossé,
-- elle subit la RLS que l'assertion mesure — `security invoker` est la condition de validité de
-- cette mesure, et c'est aussi ce que l'assertion 3 fige.
create or replace function pg_temp.figees_pour(carte uuid)
returns bigint language sql stable as $$
	select count(*) from public.cards_figees() f where f.card_id = carte;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1 à 5. La forme de la fonction dans le catalogue, et son ACL rôle par rôle.
-- ---------------------------------------------------------------------------------------------
-- docs/SPEC-relances.md §3.2 et §3.3, docs/PROD_MIGRATIONS.md §3 (migration 53).

select has_function('public', 'cards_figees', array[]::text[],
	'public.cards_figees() existe, sans argument');

select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'cards_figees'),
	false,
	'public.cards_figees() est SECURITY INVOKER — en DEFINER elle rendrait à chacun les affaires '
	'figées de tout le monde, droits fins compris');

select is(
	(select p.provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'cards_figees'),
	's',
	'public.cards_figees() est STABLE : elle lit now(), et PostgREST n''expose en GET que les '
	'fonctions non volatiles');

select is(
	(select p.proconfig from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'cards_figees'),
	array['search_path=""'],
	'public.cards_figees() fixe son search_path à la chaîne vide');

select results_eq(
	$$ select r.rolname::text,
	          has_function_privilege(r.rolname, 'public.cards_figees()', 'execute')
	     from (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
	    order by 1 $$,
	$$ values ('anon', false), ('authenticated', true), ('service_role', true) $$,
	'ACL rôle par rôle : anon N''A PAS execute — un revoke ... from public seul ne le lui retire '
	'pas, pg_default_acl le lui ayant accordé NOMMÉMENT à la création');

-- ---------------------------------------------------------------------------------------------
-- 6 à 10. Conformité du seed, sous les trois identités réelles. AVANT toute dégradation.
-- ---------------------------------------------------------------------------------------------
-- docs/SPEC-relances.md §5, docs/SPEC-seed.md §9.12.6.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- RÉVISÉ LE 2026-08-24 — `CRM-062` tranche 3a, docs/SPEC-relances.md §10.2.
--
-- Ces quatre assertions posaient UNE affaire figée, et c'était le contrat du seed tant que la
-- tranche 1 était seule à l'écrire. Le jeu en pose désormais QUATRE : le §5 nomme depuis la tranche
-- 1 qu'une seule ligne ne démontre ni classement, ni regroupement. Les assertions ne sont ni
-- retirées ni relâchées — un `>= 1` aurait été le contournement que CLAUDE.md §18 interdit : elles
-- comptent quatre, et la suivante assère l'ORDRE ENTIER, qui est ce que l'écran rend.

select is(
	(select count(*) from public.cards_figees()),
	4::bigint,
	'seed : l''administratrice voit EXACTEMENT quatre affaires figées (§10.2.1)');

-- L'ORDRE EST ASSÉRÉ ENTIER, ET PAS SEULEMENT SON CONTENU. Les quatre retards sont deux à deux
-- distincts (§10.2.1 point 1), donc l'ordre `retard_jours desc` du §3.4 est TOTAL sur ce jeu : la
-- suite est reproductible, et une assertion peut porter dessus. `…0c3` y est en troisième position
-- et son retard vaut toujours 16 — la tranche 3a AJOUTE, elle ne déplace pas.
select results_eq(
	$$ select f.card_id, f.retard_jours from public.cards_figees() f $$,
	$$ values ('5eed0000-0000-4000-8000-0000000000c4'::uuid, 35),
	          ('5eed0000-0000-4000-8000-00000000d007'::uuid, 18),
	          ('5eed0000-0000-4000-8000-0000000000c3'::uuid, 16),
	          ('5eed0000-0000-4000-8000-0000000000cf'::uuid,  7) $$,
	'seed : les quatre affaires figées, dans l''ordre du §3.4, « Audit sécurité applicative » '
	'comprise et inchangée à 16 jours de retard');

-- Le regroupement de l'écran porte sur le CHANNEL (§10.7), et il n'aurait rien à regrouper si les
-- quatre vivaient dans un seul dossier — ni rien à distinguer si chaque track n'en portait qu'un.
select results_eq(
	$$ select count(distinct f.channel_id), count(distinct ch.track_id)
	     from public.cards_figees() f
	     join public.channels ch on ch.id = f.channel_id $$,
	$$ values (4::bigint, 3::bigint) $$,
	'seed : quatre dossiers pour trois tracks — un track en porte deux, seul cas qui prouve que '
	'le regroupement porte sur le channel');

select results_eq(
	$$ select f.seuil_jours, f.jours_dans_etape >= 30, f.retard_jours = f.jours_dans_etape - f.seuil_jours
	     from public.cards_figees() f
	    where f.card_id = '5eed0000-0000-4000-8000-0000000000c3' $$,
	$$ values (14, true, true) $$,
	'seed : seuil de 14 jours hérité du nœud, au moins 30 jours dans l''étape, et retard_jours '
	'cohérent avec les deux autres colonnes');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select is(
	(select count(*) from public.cards_figees()),
	4::bigint,
	'seed : le business developer voit les mêmes quatre affaires figées — les tracks lui sont '
	'ouverts');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

-- LE REFUS EST ZÉRO LIGNE, JAMAIS UNE ERREUR (docs/SPEC-permissions-rls.md §7). La fonction
-- n'ajoute aucune règle : c'est `app.can_read_card` qui écarte la card, le track « Grands comptes »
-- étant fermé à la lectrice par un droit fin de `CRM-012`.
--
-- RÉVISÉ PAR LA TRANCHE 3a, ET LA PREUVE EN SORT RENFORCÉE. La lectrice obtenait ZÉRO ligne, ce
-- qu'un défaut de la fonction — ou une fonction qui ne rendrait jamais rien — aurait rendu tout
-- aussi vert. Elle en obtient désormais TROIS sur quatre, et l'assertion nomme celle qui manque :
-- le refus se mesure comme un trou dans une liste peuplée, forme bien plus stricte.
select is(
	(select count(*) from public.cards_figees()),
	3::bigint,
	'seed : la lectrice voit TROIS des quatre affaires figées — le refus est une ligne manquante '
	'dans une liste peuplée, jamais une erreur');

select is(
	(select count(*) from public.cards_figees() f
	  where f.card_id = '5eed0000-0000-4000-8000-0000000000c3'),
	0::bigint,
	'seed : et celle qui manque à la lectrice est « Audit sécurité applicative », dont le track '
	'« Conseil & IA » lui est fermé par un droit fin de CRM-012');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- Dégradations : chaque card de l'épreuve est vieillie de 90 jours, hors RLS.
-- ---------------------------------------------------------------------------------------------
-- QUATRE-VINGT-DIX JOURS, et non huit : le plus grand seuil du catalogue est de trente. Une card
-- vieillie en deçà d'un seuil ne prouverait pas qu'une exclusion l'écarte — elle serait écartée par
-- la borne, et l'assertion serait complaisante.
--
-- `…00c6` est ARCHIVÉE ICI, et ce n'est pas un raccourci : la seule card archivée du seed
-- (« Contrat cadre 2025 ») est à l'étape « Livré », donc SANS SEUIL. L'employer écarterait la card
-- par l'absence de seuil et non par l'archivage, et l'assertion ne dirait rien.

update public.cards
   set entered_step_at = now() - interval '90 days'
 where id in (
	'5eed0000-0000-4000-8000-0000000000c6',  -- prospection, seuil 14 — archivée juste après
	'5eed0000-0000-4000-8000-0000000000c9',  -- prospection, seuil 14 — déjà en corbeille
	'5eed0000-0000-4000-8000-0000000000ca',  -- prospection, seuil 14 — sommeil FUTUR
	'5eed0000-0000-4000-8000-0000000000c1',  -- relance, seuil 7 — sommeil ÉCHU
	'5eed0000-0000-4000-8000-0000000000cd'); -- « Livré », AUCUN seuil

update public.cards
   set archived_at = now()
 where id = '5eed0000-0000-4000-8000-0000000000c6';

-- La surcharge d'étape : « Négociation » porte 5 jours là où son nœud en porte 10. Vieillie de
-- SIX jours, la card n'est figée QUE si la surcharge l'emporte — à 10 jours elle ne le serait pas.
update public.cards
   set entered_step_at = now() - interval '6 days'
 where id = '5eed0000-0000-4000-8000-0000000000cf';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- ---------------------------------------------------------------------------------------------
-- 11 à 16. Les trois exclusions, chacune dans les deux sens.
-- ---------------------------------------------------------------------------------------------
-- docs/SPEC-relances.md §2.4.

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000c6'), 0::bigint,
	'exclusion 1 : une card ARCHIVÉE vieillie de 90 jours n''est pas figée — une affaire rangée '
	'n''est pas en retard, elle est rangée');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000c9'), 0::bigint,
	'exclusion 2 : une card EN CORBEILLE vieillie de 90 jours n''est pas figée — elle est sortie '
	'du produit');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000ca'), 0::bigint,
	'exclusion 3 : une card EN SOMMEIL, échéance FUTURE, vieillie de 90 jours n''est pas figée — '
	'relancer une card endormie annulerait le seul geste posé contre les relances');

-- LE SENS INVERSE DE L'EXCLUSION 3, et c'est elle qui la rend non complaisante.
select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000c1'), 1::bigint,
	'sens inverse : une échéance de sommeil ÉCHUE ne protège plus — la card est réveillée de fait, '
	'et « endormie » se distingue de « a été endormie »');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000cd'), 0::bigint,
	'seuil ABSENT : une card à « Livré » vieillie de 90 jours n''est jamais figée — un seuil absent '
	'n''est pas remplacé par un défaut inventé');

select results_eq(
	$$ select f.seuil_jours from public.cards_figees() f
	    where f.card_id = '5eed0000-0000-4000-8000-0000000000cf' $$,
	$$ values (5) $$,
	'seuil effectif : la surcharge de l''étape « Négociation » (5 j) l''emporte sur celle du nœud '
	'(10 j) — à 6 jours, la card est figée par la première et ne le serait pas par la seconde');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 17 à 19. Les deux côtés de la borne, et le signe de `retard_jours`.
-- ---------------------------------------------------------------------------------------------
-- docs/SPEC-relances.md §2.5. « Contrat TMA 2026 — Mairie de Vaulx » est à « Relance », seuil 7.

update public.cards
   set entered_step_at = now() - interval '7 days'
 where id = '5eed0000-0000-4000-8000-00000000d007';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-00000000d007'), 1::bigint,
	'borne ATTEINTE : sept jours révolus contre un seuil de sept, la card est figée — le '
	'dépassement est large, comme evaluerAnciennete dans board.ts');

select pg_temp.redevenir_proprietaire();

update public.cards
   set entered_step_at = now() - interval '7 days' + interval '1 hour'
 where id = '5eed0000-0000-4000-8000-00000000d007';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-00000000d007'), 0::bigint,
	'borne NON ATTEINTE : une heure de moins, et les jours RÉVOLUS tombent à six — la card n''est '
	'plus figée');

select is(
	(select bool_and(f.retard_jours >= 0) from public.cards_figees() f),
	true,
	'retard_jours est toujours positif ou nul : la ligne n''existe que si la borne est atteinte');

select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 20. Un seuil posé sur un nœud TERMINAL rend ses cards relançables — la ligne *k* du §2.3.
-- ---------------------------------------------------------------------------------------------
-- CE N'EST PAS UN DÉFAUT, C'EST LE PRIX ÉCRIT de n'avoir qu'UNE définition de « terminal ». La
-- règle n'énumère pas `kind`, parce que l'absence de seuil écarte déjà les nœuds terminaux ;
-- l'administrateur qui pose un seuil sur « Livré » exerce une liberté que le §2.5 de
-- docs/SPEC-workflow-engine.md lui laisse, et le produit l'honore au lieu de le contredire en
-- silence. L'assertion existe pour que le jour où cette liberté devient gênante, la preuve le dise.

update public.workflow_nodes_catalog
   set default_stale_after_days = 3
 where key = 'livre';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(pg_temp.figees_pour('5eed0000-0000-4000-8000-0000000000cd'), 1::bigint,
	'nœud TERMINAL doté d''un seuil : ses cards deviennent relançables — conséquence assumée et '
	'écrite du §2.3, figée ici plutôt que tue');

select pg_temp.redevenir_proprietaire();

update public.workflow_nodes_catalog
   set default_stale_after_days = null
 where key = 'livre';

-- ---------------------------------------------------------------------------------------------
-- 21 à 24. L'ordre, mesuré sur une suite construite pour qu'il ait quelque chose à trancher.
-- ---------------------------------------------------------------------------------------------
-- docs/SPEC-relances.md §3.4 : `retard_jours desc, title asc`.
--
-- TOUTES LES CARDS ACTIVES SONT D'ABORD RAMENÉES À `now()`, puis trois seulement sont vieillies.
-- Sans cette remise à plat, la suite rendue dépendrait des dégradations précédentes et l'assertion
-- mesurerait l'ordre des fixtures plutôt que celui de la fonction. Les titres sont réécrits pour
-- que l'ordre alphabétique soit PRÉDIT et non constaté : deux retards égaux ne se départagent
-- autrement par rien de lisible.

update public.cards set entered_step_at = now(), snoozed_until = null;

update public.cards set title = 'zzz-figee-b', entered_step_at = now() - interval '24 days'
 where id = '5eed0000-0000-4000-8000-00000000d003';  -- prospection, seuil 14 → retard 10
update public.cards set title = 'zzz-figee-a', entered_step_at = now() - interval '24 days'
 where id = '5eed0000-0000-4000-8000-00000000d005';  -- prospection, seuil 14 → retard 10
update public.cards set title = 'zzz-figee-c', entered_step_at = now() - interval '34 days'
 where id = '5eed0000-0000-4000-8000-00000000d006';  -- prospection, seuil 14 → retard 20

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(
	(select count(*) from public.cards_figees()),
	3::bigint,
	'ordre : la suite construite rend exactement les trois cards vieillies, et aucune autre');

select results_eq(
	$$ select f.title, f.retard_jours from public.cards_figees() f $$,
	$$ values ('zzz-figee-c', 20), ('zzz-figee-a', 10), ('zzz-figee-b', 10) $$,
	'ordre : retard décroissant D''ABORD, puis titre croissant — « c » passe devant malgré son '
	'titre, et « a » devant « b » à retard égal');

select is(
	(select f.title from public.cards_figees() f limit 1),
	'zzz-figee-c',
	'ordre : la première ligne est la plus en retard — c''est ce que l''écran de la tranche 3 '
	'classera, et ce que l''utilisateur lit');

-- Deux appels successifs rendent la MÊME suite : c'est ce que le titre départageur garantit, et
-- sans lui deux lignes de même retard pourraient permuter d'un appel à l'autre.
select results_eq(
	$$ select f.title from public.cards_figees() f $$,
	$$ select f.title from public.cards_figees() f $$,
	'ordre : deux appels successifs rendent la même suite — l''ordre est TOTAL');

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;

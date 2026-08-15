-- @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, sixième tranche :
--            la prévisualisation des effets
-- @verifies docs/SPEC-workflow-engine.md §7 bis.13.1 (les DEUX effets et leurs comptes mesurés),
--            §7 bis.13.2 (`security invoker`), §7 bis.13.3 (contrat, refus, exclusions),
--            §7 bis.13.6 (preuves attendues), §5.3 (la sixième garde de `move_card`)
-- @verifies docs/SPEC-form-composer.md §6.6 (« renseigné »)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §15 (preuves propres)
--
-- CE QUE CETTE SUITE MESURE, ET CE QU'ELLE NE MESURE PAS.
--
-- `previsualiser_exigence` n'est pas une garde : elle ne refuse rien et n'écrit rien. La seule
-- propriété qui compte vraiment est donc sa PARENTÉ avec `move_card` — une affaire annoncée
-- « bloquée à l'entrée » doit réellement se voir refuser son déplacement une fois la règle posée.
-- L'assertion 8 le prouve en posant la règle, en appelant `move_card` et en constatant
-- `missing_required_fields` ; sans elle, le reste ne prouverait que la cohérence de la fonction
-- avec elle-même.
--
-- LES COMPTES ATTENDUS SONT CEUX DU SEED, mesurés sur la pile le 2026-08-15 et consignés au
-- §7 bis.13.1. Ils sont écrits en clair plutôt que recalculés par la requête que la fonction
-- exécute : une assertion qui recopierait l'implémentation serait verte quelle que soit sa justesse.
--
-- La suite s'exécute en transaction et fait `rollback` : le seed est rendu intact, y compris la
-- règle posée par l'assertion 8.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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

-- 1. La fonction est `stable` et n'est PAS `security definer`. Le §7 bis.13.2 fait de ce second
--    point une propriété de sécurité : un `definer` annoncerait un nombre d'affaires que son
--    lecteur ne peut pas ouvrir.
select is(
	(select p.provolatile::text || case when p.prosecdef then 'D' else 'I' end
	   from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'previsualiser_exigence'),
	'sI',
	'1 — `previsualiser_exigence` est `stable` et `security invoker`');

-- 2. Exécutable par `authenticated`, jamais par `anon`.
select ok(
	has_function_privilege('authenticated', 'public.previsualiser_exigence(uuid,uuid,uuid)', 'execute')
	and not has_function_privilege('anon', 'public.previsualiser_exigence(uuid,uuid,uuid)', 'execute'),
	'2 — `authenticated` peut l''appeler, `anon` non');

-- 3 et 4. Les deux refus de cible. Aucune cible et deux cibles lèvent le même `previsualisation_cible`.
select throws_ok(
	$$select * from public.previsualiser_exigence('5eed0000-0000-4000-8000-000000000083')$$,
	'P0001',
	'previsualisation_cible',
	'3 — sans cible, la prévisualisation est refusée');

select throws_ok(
	$$select * from public.previsualiser_exigence(
		'5eed0000-0000-4000-8000-000000000083',
		'5eed0000-0000-4000-8000-000000000067',
		'5eed0000-0000-4000-8000-000000000077')$$,
	'P0001',
	'previsualisation_cible',
	'4 — avec deux cibles, la prévisualisation est refusée');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

-- 5. LES DEUX NOMBRES NE SONT PAS LE MÊME, et c'est la mesure qui justifie l'écran. Le même champ
--    `date-signature-prevue` rend 4/0 sur `Prospection` — aucune arête ne mène à l'étape initiale —
--    et 0/1 sur `Signature`, exactement l'inverse.
select is(
	(select array[sur_place, a_l_entree]
	   from public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000083',
	        '5eed0000-0000-4000-8000-000000000061')),
	array[4::bigint, 0::bigint],
	'5 — `date-signature-prevue` × `Prospection` : 4 sur place, 0 à l''entrée');

-- RÉVISÉE PAR `CRM-077`, cinquième tranche, et le motif est celui-là même que l'assertion mesure.
-- `a_l_entree` compte les affaires qu'une arête amènerait sur l'étape ; l'affaire `…0cf`
-- (docs/SPEC-seed.md §10.4 bis) est posée sur `Negociation`, d'où part une arête vers `Signature`.
-- Elle est donc la SECONDE affaire à l'entrée, et le nombre passe de 1 à 2 — MESURÉ.
--
-- Ce n'est pas la fonction qui a changé, c'est la donnée qu'elle compte, et l'assertion continue
-- d'affirmer ce qu'elle affirmait : les deux nombres NE SONT PAS le même, `sur_place` restant à 0
-- quand `a_l_entree` ne l'est pas. C'est cette inversion, et non la valeur `1`, qui justifie
-- l'écran de prévisualisation.
select is(
	(select array[sur_place, a_l_entree]
	   from public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000083',
	        '5eed0000-0000-4000-8000-000000000064')),
	array[0::bigint, 2::bigint],
	'6 — `date-signature-prevue` × `Signature` : 0 sur place, 2 à l''entrée — l''inverse exact');

-- 7. LE COMPTE D'UNE ÉTAPE EST L'UNION DE SES ARÊTES. Cinq arêtes mènent à `Perdu` ; prises une à
--    une elles rendent 4, 2, 1, 0 et 1, et l'étape rend 8. L'assertion vérifie l'égalité, et non
--    une inégalité stricte : la contrainte `workflow_transitions_workflow_from_to_key` rend unique
--    le couple (départ, arrivée) d'un workflow, si bien qu'AUCUNE affaire ne peut aujourd'hui être
--    comptée deux fois. Le `count(distinct)` de la fonction est donc une défense qui ne change
--    rien tant que cette contrainte tient — ce que cette assertion dit, plutôt que de prétendre
--    observer un dédoublonnage que le modèle rend impossible.
select is(
	(select a_l_entree
	   from public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000083',
	        '5eed0000-0000-4000-8000-000000000067')),
	(select sum(p.a_l_entree)::bigint
	   from public.workflow_transitions t
	   cross join lateral public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000083', null, t.id) p
	  where t.to_step_id = '5eed0000-0000-4000-8000-000000000067'),
	'7 — le compte d''une étape est l''union de ses arêtes : 8 pour `Perdu`, comme la somme de ses cinq chemins');

-- 8. LA PARENTÉ AVEC `move_card`, et c'est l'assertion qui donne sa valeur aux autres. La
--    prévisualisation annonce 4 affaires bloquées sur `Prospection → Perdu` ; la règle est posée,
--    et l'une d'elles se voit réellement refuser son déplacement.
select pg_temp.redevenir_proprietaire();

insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
values ('5eed0000-0000-4000-8000-000000000083', '5eed0000-0000-4000-8000-000000000067',
        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', 'required')
on conflict (field_id, step_id) do update set visibility = 'required';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

select throws_ok(
	$$select public.move_card(
		'5eed0000-0000-4000-8000-0000000000c3',
		'5eed0000-0000-4000-8000-000000000067',
		'Motif de la preuve 0034')$$,
	'missing_required_fields',
	'8 — une affaire comptée « à l''entrée » se voit RÉELLEMENT refuser son déplacement');

-- 9. Un champ ARCHIVÉ rend `0, 0` : la sixième garde le filtre, donc l'exigence serait sans effet.
select is(
	(select array[sur_place, a_l_entree]
	   from public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000087',
	        '5eed0000-0000-4000-8000-000000000067')),
	array[0::bigint, 0::bigint],
	'9 — un champ archivé ne promet aucune contrainte : 0 et 0');

-- 10. Une cible INCONNUE ne lève pas, et rend `0, 0`. C'est une course ordinaire entre la lecture
--     de l'écran et l'appel ; l'écriture qui suit la signalera par son `23503`.
select is(
	(select array[sur_place, a_l_entree]
	   from public.previsualiser_exigence(
	        '5eed0000-0000-4000-8000-000000000083',
	        '00000000-0000-4000-8000-0000000000ff')),
	array[0::bigint, 0::bigint],
	'10 — une étape inconnue rend 0 et 0, sans lever');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

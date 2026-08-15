-- @verifies CRM-077 (docs/BACKLOG.md) — corbeille et restauration, première tranche : le modèle
-- @verifies docs/SPEC-corbeille.md §3.1 (les trois états), §3.2 (la migration et l'audit fermé au
--            client), §2.2 (la corbeille est une VUE, non une frontière de confidentialité)
-- @verifies docs/SPEC-cards.md §4 (archivage et corbeille sont indépendants)
-- @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface), §15 (preuves propres)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE REFUSE DE PROUVER.
--
-- Elle prouve que `deleted_by` est FERMÉE AU CLIENT : quoi qu'un appelant authentifié envoie, la
-- base écrit l'identité du geste, la fige tant que la ligne reste en corbeille, et l'efface à la
-- restauration. C'est la seule propriété de cette tranche qu'un écran ne pourra jamais garantir.
--
-- Elle NE prouve PAS que la corbeille est invisible : elle ne l'est pas, et c'est mesuré et voulu
-- (§2.2 de la spécification). Une assertion d'invisibilité fixerait une règle que le produit n'a
-- pas et rendrait tout écran de corbeille impossible à écrire.
--
-- La suite s'exécute en transaction et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

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

-- L'administratrice du seed, et un track seedé.
-- 1 à 3. LA FORME : les trois colonnes existent, nullables, et `deleted_by` porte sa clé étrangère.
select has_column('public', 'tracks', 'deleted_at', '1 — `tracks.deleted_at` existe');
select has_column('public', 'channels', 'deleted_at', '2 — `channels.deleted_at` existe');
select is(
	(select count(*)::int
	   from pg_constraint c
	   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
	  where c.contype = 'f'
	    and c.confrelid = 'public.profiles'::regclass
	    and a.attname = 'deleted_by'
	    and c.confdeltype = 'n'
	    and c.conrelid in ('public.tracks'::regclass, 'public.channels'::regclass, 'public.cards'::regclass)),
	3,
	'3 — les trois `deleted_by` référencent `profiles` en `on delete set null`');

-- 4. LES DEUX ÉTATS SONT INDÉPENDANTS : archiver n'est pas supprimer (§3.1).
select ok(
	(select count(*)::int from information_schema.columns
	  where table_schema = 'public' and table_name = 'tracks'
	    and column_name in ('archived_at', 'deleted_at')) = 2,
	'4 — un track porte les DEUX horodatages, et ils ne se remplacent pas');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

-- 5, 6 et 7. L'AUDIT EST FERMÉ AU CLIENT PAR LE PRIVILÈGE, sur les TROIS tables, et c'est plus
--     fort qu'un trigger : le refus tombe avant toute politique et avant tout déclenchement.
--     MESURÉ : `CRM-013` avait posé sur `cards` des droits COLONNE PAR COLONNE, si bien que la
--     nouvelle `deleted_by` n'y a hérité d'aucun `UPDATE` ; `tracks` et `channels` portaient au
--     contraire un droit de TABLE, et leur `deleted_by` était donc écrivable par le client. La
--     migration a refermé cet écart en énumérant leurs colonnes. Les trois assertions le vérifient
--     séparément : une porte fermée sur deux tables et ouverte sur la troisième serait exactement
--     le genre d'asymétrie que personne ne retrouve en relisant.
select throws_ok(
	$$update public.tracks set deleted_at = now(), deleted_by = '5eed0000-0000-4000-8000-000000000013'
	   where id = (select id from public.tracks order by id limit 1)$$,
	'42501',
	null,
	'5 — `tracks` : écrire `deleted_by` est refusé par le PRIVILÈGE');

select throws_ok(
	$$update public.channels set deleted_at = now(), deleted_by = '5eed0000-0000-4000-8000-000000000013'
	   where id = (select id from public.channels order by id limit 1)$$,
	'42501',
	null,
	'6 — `channels` : le même refus, par le même mécanisme');

select throws_ok(
	$$update public.cards set deleted_at = now(), deleted_by = '5eed0000-0000-4000-8000-000000000013'
	   where id = '5eed0000-0000-4000-8000-0000000000c3'$$,
	'42501',
	null,
	'7 — `cards` : le même refus, hérité de `CRM-013` et non ajouté ici');

-- 8. LA MISE EN CORBEILLE, ELLE, PASSE — et le trigger renseigne seul l'audit que le client ne peut
--    pas écrire. Sans cette assertion, les trois refus ci-dessus prouveraient seulement que la
--    colonne est inaccessible, jamais qu'elle est RENSEIGNÉE.
update public.tracks
   set deleted_at = now()
 where id = (select id from public.tracks order by id limit 1);

select is(
	(select deleted_by from public.tracks order by id limit 1),
	'5eed0000-0000-4000-8000-000000000011'::uuid,
	'8 — le trigger écrit l''auteur du geste, que le client n''a pas pu envoyer');

-- 9. L'AUDIT EST FIGÉ tant que la ligne reste en corbeille. La preuve est jouée sur `cards`, seule
--    des trois dont la politique d'écriture (`cards_maj`, par `app.can_write_channel`) laisse
--    passer un profil DIFFÉRENT de celui qui a supprimé : sur `tracks` et `channels`, réservés à
--    l'administrateur, la même preuve n'aurait comparé l'audit qu'à lui-même.
update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000c3';

select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012'::uuid);

update public.cards
   set description = coalesce(description, '') || ' (touchée par un tiers)'
 where id = '5eed0000-0000-4000-8000-0000000000c3';

select is(
	(select deleted_by from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3'),
	'5eed0000-0000-4000-8000-000000000011'::uuid,
	'9 — une écriture ultérieure par un TIERS ne se réattribue pas la suppression');

-- 10 et 11. LA RESTAURATION efface l'audit avec l'état qu'il documentait. Jouée par
--    l'administratrice : `tracks_maj_admin` ne laisse écrire qu'elle, et une restauration tentée
--    par un autre profil ne modifierait AUCUNE ligne — l'assertion aurait alors constaté un
--    `deleted_at` inchangé et accusé le trigger d'un refus de politique.
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

update public.tracks
   set deleted_at = null
 where id = (select id from public.tracks order by id limit 1);

select is(
	(select deleted_at from public.tracks order by id limit 1),
	null::timestamptz,
	'10 — restaurer remet `deleted_at` à NULL');
select is(
	(select deleted_by from public.tracks order by id limit 1),
	null::uuid,
	'11 — et l''audit ne survit pas : « supprimé par X » sur un objet vivant serait un mensonge');

-- 12. LA CORBEILLE RESTE LISIBLE, et c'est une propriété VOULUE (§2.2). L'assertion la FIGE : si une
--     politique venait un jour la masquer, tout écran de corbeille cesserait de fonctionner, et
--     c'est ici que cela se verrait d'abord.
select is(
	(select count(*)::int from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3'),
	1,
	'12 — une card en corbeille reste LISIBLE de qui pouvait lire son channel : la corbeille est une vue, pas une frontière');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;

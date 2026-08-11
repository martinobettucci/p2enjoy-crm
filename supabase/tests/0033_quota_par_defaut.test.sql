-- @verifies CRM-053 (docs/BACKLOG.md), CRM-058 (docs/BACKLOG.md) — chemin d'écriture de
--           `mail_outbound_identities.daily_quota`
-- @verifies docs/SPEC-mail-subsystem.md §19.4 (le quota, ses deux lectures)
-- @verifies docs/JOURNAL.md décision 330 (§8), décision 347 (ce correctif)
--
-- CE QUE CETTE SUITE MESURE. `upsert_mail_outbound_identity` appelée SANS `p_daily_quota` doit
-- laisser la colonne à `NULL` (aucun plafond) — jamais `0` (interdiction totale), qui était le
-- défaut fautif réinstallé à chaque appel avant la migration 0033 (décision 347). La suite retire
-- les identités seedées dans sa transaction, comme la 0025 : l'index unique partiel de l'identité
-- par défaut buterait sinon sur ce que le seed a déjà posé.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

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

delete from public.mail_outbound_identities;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

-- 1. Omis à la création : NULL, pas 0.
select public.upsert_mail_outbound_identity(
	'5eed0000-0000-4000-8000-000000000001'::uuid, 'Sonde sans quota', 'stalwart', 587, 'none',
	'sonde-quota@p2enjoy.test', 'sonde-quota@p2enjoy.test', 'motdepasse-sonde'
);

select is(
	(select daily_quota from public.mail_outbound_identities
	  where from_address = 'sonde-quota@p2enjoy.test' and owner_id is null),
	null::integer,
	'1 — `p_daily_quota` omis à la création laisse `NULL` (aucun plafond), jamais `0`');

-- 2. Précisé à la création : la valeur demandée, pas un défaut.
select public.upsert_mail_outbound_identity(
	'5eed0000-0000-4000-8000-000000000001'::uuid, 'Sonde plafonnée', 'stalwart', 587, 'none',
	'sonde-plafond@p2enjoy.test', 'sonde-plafond@p2enjoy.test', 'motdepasse-sonde',
	null, null, null, true, 5
);

select is(
	(select daily_quota from public.mail_outbound_identities
	  where from_address = 'sonde-plafond@p2enjoy.test' and owner_id is null),
	5,
	'2 — `p_daily_quota` précisé à la création pose exactement cette valeur');

-- 3. Omis à une mise à jour : la valeur EXISTANTE est préservée, ni effacée ni remise à 0.
select public.upsert_mail_outbound_identity(
	'5eed0000-0000-4000-8000-000000000001'::uuid, 'Sonde plafonnée', 'stalwart', 587, 'none',
	'sonde-plafond@p2enjoy.test', 'sonde-plafond@p2enjoy.test'
);

select is(
	(select daily_quota from public.mail_outbound_identities
	  where from_address = 'sonde-plafond@p2enjoy.test' and owner_id is null),
	5,
	'3 — `p_daily_quota` omis à une mise à jour préserve la valeur existante');

select pg_temp.redevenir_proprietaire();

-- 4. La contre-épreuve du témoin n° 1 : la colonne accepte bien `NULL` en base, ce n'est pas un
-- artefact du cast pgTAP.
select is(
	(select count(*)::int from public.mail_outbound_identities
	  where from_address = 'sonde-quota@p2enjoy.test' and daily_quota is null),
	1,
	'4 — la ligne créée sans quota porte réellement `NULL` en base');

select * from finish();
rollback;

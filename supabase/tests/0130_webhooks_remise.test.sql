-- @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : la cadence de la remise en base — le secret d'appel rangé dans Vault
--           et vérifié pour la seule clé de service, le réveil qui n'appelle la fonction que lorsqu'une remise est due, la
--           tâche `pg_cron` de la minute
-- @verifies docs/SPEC-webhooks.md §2, §12 ; docs/JOURNAL.md décision 784 ; CLAUDE.md §10
--
-- Le réveil réel (`pg_net`, puis la fonction edge et le récepteur local) est prouvé de bout en bout par
-- `e2e/api/webhooks-remise.spec.ts` ; ici, la décision de réveiller et ses refus. Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

select is(
	(select count(*) from vault.secrets where name = 'p2enjoy-webhooks-dispatch'), 1::bigint,
	'1 — un secret d''appel, et un seul, rangé dans Vault à l''application de la migration');

select ok(
	has_function_privilege('service_role', 'public.verify_webhook_dispatch(text)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'public.verify_webhook_dispatch(text)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.verify_webhook_dispatch(text)', 'EXECUTE')
	and not has_function_privilege('authenticated', 'app.webhooks_reveiller()', 'EXECUTE'),
	'2 — la vérification du secret est à la clé de service seule ; le réveil n''est à aucun client');

select ok(
	public.verify_webhook_dispatch((select decrypted_secret from vault.decrypted_secrets where name = 'p2enjoy-webhooks-dispatch'))
	and not public.verify_webhook_dispatch('un-faux-secret')
	and not public.verify_webhook_dispatch('')
	and not coalesce(public.verify_webhook_dispatch(null), false),
	'3 — le bon secret est reconnu ; un faux, un vide ou un nul ne le sont pas');

select is(
	(select schedule || ' ' || command from cron.job where jobname = 'p2enjoy-webhooks-remise'),
	'* * * * * select app.webhooks_reveiller();',
	'4 — la tâche `pg_cron` réveille chaque minute (§2)');

-- Rien de dû : le réveil n'appelle pas la fonction.
delete from public.webhook_endpoints;
select is(app.webhooks_reveiller(), null::bigint, '5 — aucune remise due : aucun appel à la fonction');

-- Une remise due d'un webhook désactivé ne réveille pas davantage ; active, elle réveille.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
create temp table pg_temp.cree as
select id from public.create_webhook_endpoint('5eed0000-0000-4000-8000-000000000001', 'tst-crm073 Réveil',
	'https://webhook-sink:8443/crm/reveil', array['contact.created'], null, false);
reset role;
insert into public.webhook_deliveries (workspace_id, endpoint_id, event, event_id, payload, next_attempt_at)
select '5eed0000-0000-4000-8000-000000000001', id, 'contact.created', gen_random_uuid(), '{}'::jsonb, now() - interval '1 second'
  from pg_temp.cree;
select is(app.webhooks_reveiller(), null::bigint, '6 — une remise due d''un webhook désactivé ne réveille pas la fonction');

update public.webhook_endpoints set enabled = true where id = (select id from pg_temp.cree);
select ok(app.webhooks_reveiller() is not null,
	'7 — une remise due d''un webhook actif : la requête `pg_net` est inscrite');

select * from finish();
rollback;

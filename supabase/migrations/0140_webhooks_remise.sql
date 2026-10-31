-- @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : la cadence de la remise — `pg_cron` réveille la fonction edge `webhooks`
--       chaque minute par `pg_net`, sur le réseau interne de la pile, avec un secret d'appel que la fonction fait vérifier
-- @spec docs/SPEC-webhooks.md §2 (`pg_cron` cadence), §12 (le secret d'appel rangé dans Vault) ; docs/SCHEMA.md
--       « Migration `0140` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 784
--
-- LE SECRET D'APPEL VIT DANS LA BASE, NON DANS L'ENVIRONNEMENT : la tâche `pg_cron` qui l'envoie ne lit aucune variable
-- d'environnement, et la fonction edge le fait vérifier par `verify_webhook_dispatch`, sous la clé de service. Il est tiré
-- au hasard à la première application et n'est jamais rendu à un client.
--
-- LE RÉVEIL NE COÛTE RIEN QUAND IL N'Y A RIEN À REMETTRE : la tâche n'appelle la fonction que si une remise est due.
--
-- IDEMPOTENCE : le secret n'est créé que s'il manque ; `create or replace` ; la tâche est reprogrammée sous son nom.

-- =============================================================================================
-- 1. Le secret d'appel
-- =============================================================================================

do $$
begin
	if not exists (select 1 from vault.secrets where name = 'p2enjoy-webhooks-dispatch') then
		perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'), 'p2enjoy-webhooks-dispatch',
		                            'Secret d''appel de la fonction edge webhooks par pg_cron (CRM-073)');
	end if;
end;
$$;

-- La fonction edge présente le secret reçu ; la base dit s'il est le bon. Réservée à la clé de service.
create or replace function public.verify_webhook_dispatch(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(p_secret, '') <> '' and exists (
		select 1 from vault.decrypted_secrets s
		 where s.name = 'p2enjoy-webhooks-dispatch' and s.decrypted_secret = p_secret)
$$;

-- =============================================================================================
-- 2. Le réveil — §2
-- =============================================================================================

-- Appelle la fonction edge si une remise d'un webhook actif est due ; rend l'identifiant de la requête `pg_net`, ou nul.
-- `functions` est le nom du service Compose, en développement comme en production : l'appel ne passe jamais par Kong.
create or replace function app.webhooks_reveiller()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_secret text;
begin
	if not exists (
		select 1 from public.webhook_deliveries d
		  join public.webhook_endpoints e on e.id = d.endpoint_id
		 where d.status = 'pending' and d.next_attempt_at <= now() and e.enabled) then
		return null;
	end if;
	select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'p2enjoy-webhooks-dispatch';
	return net.http_post(
		url := 'http://functions:9000/webhooks/remettre',
		body := '{}'::jsonb,
		headers := pg_catalog.jsonb_build_object('content-type', 'application/json', 'x-webhooks-dispatch', v_secret),
		timeout_milliseconds := 60000);
end;
$$;

do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-webhooks-remise', '* * * * *', 'select app.webhooks_reveiller();') into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

-- =============================================================================================
-- 3. Privilèges
-- =============================================================================================

revoke all on function public.verify_webhook_dispatch(text) from public, anon, authenticated;
grant execute on function public.verify_webhook_dispatch(text) to service_role;
revoke all on function app.webhooks_reveiller() from public, anon, authenticated;

notify pgrst, 'reload schema';

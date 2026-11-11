-- @spec CRM-141 (docs/BACKLOG.md) — tranche T2 : la cadence de l'évaluation des pastilles — `pg_cron` réveille la route
--       `POST /ia/pastilles/evaluer` de la fonction `ia` chaque minute par `pg_net`, sur le réseau interne, avec un secret
--       d'appel que la fonction fait vérifier ; seulement si une évaluation est due
-- @spec docs/SPEC-mail-subsystem.md §31.5 (« la base décide, la fonction évalue, `pg_cron` cadence » ; le développement
--       déterministe) ; docs/SPEC-ia.md §15.4, §15.5 ; docs/SCHEMA.md « Migration `0184` » ; le patron de la migration
--       `0140` (les webhooks), repris ; docs/JOURNAL.md décisions 883 et 923
--
-- LE SECRET D'APPEL VIT DANS LA BASE : la tâche `pg_cron` ne lit aucune variable d'environnement, et la fonction le fait
-- vérifier par `verify_label_dispatch`, sous la clé de service. Tiré au hasard à la première application, jamais rendu à
-- un client.
--
-- LE SIMULATEUR, EN DÉVELOPPEMENT SEULEMENT : si le secret `p2enjoy-pastilles-simulateur` existe — seul le seed de
-- développement le crée —, l'appel porte `x-ia-simulateur` avec sa valeur ; la fonction ne le suit que si
-- `IA_SIMULATEUR_HOST` lui est remise (docs/SPEC-ia.md §11.6). En production, ni le secret ni la variable n'existent.
--
-- IDEMPOTENCE : le secret n'est créé que s'il manque ; `create or replace` ; la tâche est reprogrammée sous son nom.

-- =============================================================================================
-- 1. Le secret d'appel
-- =============================================================================================

do $$
begin
	if not exists (select 1 from vault.secrets where name = 'p2enjoy-pastilles-dispatch') then
		perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'), 'p2enjoy-pastilles-dispatch',
		                            'Secret d''appel de la passe des pastilles de la fonction edge ia par pg_cron (CRM-141)');
	end if;
end;
$$;

create or replace function public.verify_label_dispatch(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(p_secret, '') <> '' and exists (
		select 1 from vault.decrypted_secrets s
		 where s.name = 'p2enjoy-pastilles-dispatch' and s.decrypted_secret = p_secret)
$$;
comment on function public.verify_label_dispatch(text) is
	'CRM-141 — docs/SPEC-ia.md §15.4. La fonction ia présente le secret reçu ; la base dit s''il est le bon. service_role seul.';

-- =============================================================================================
-- 2. Le réveil
-- =============================================================================================

-- Appelle la passe si une évaluation est due ; rend l'identifiant de la requête `pg_net`, ou nul. `functions` est le nom
-- du service Compose, en développement comme en production : l'appel ne passe jamais par Kong. La passe vit 100 s au plus
-- sous la borne de 150 s du worker `ia` ; `pg_net` n'attend pas sa réponse pour rendre la main à `pg_cron`.
create or replace function app.pastilles_reveiller()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_secret    text;
	v_scenario  text;
	v_entetes   jsonb;
begin
	if not exists (
		select 1 from public.mail_label_evaluations e
		  join public.mail_messages m on m.id = e.message_id and m.deleted_at is null
		 where e.state = 'pending' and e.next_attempt_at <= now()
		   and (e.leased_until is null or e.leased_until < now())) then
		return null;
	end if;
	select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'p2enjoy-pastilles-dispatch';
	select s.decrypted_secret into v_scenario from vault.decrypted_secrets s where s.name = 'p2enjoy-pastilles-simulateur';
	v_entetes := pg_catalog.jsonb_build_object('content-type', 'application/json', 'x-pastilles-dispatch', v_secret);
	if v_scenario is not null and v_scenario <> '' then
		v_entetes := v_entetes || pg_catalog.jsonb_build_object('x-ia-simulateur', v_scenario);
	end if;
	return net.http_post(
		url := 'http://functions:9000/ia/pastilles/evaluer',
		body := '{}'::jsonb,
		headers := v_entetes,
		timeout_milliseconds := 150000);
end;
$$;
comment on function app.pastilles_reveiller() is
	'CRM-141 — docs/SPEC-mail-subsystem.md §31.5. Réveille la passe des pastilles si une évaluation est due.';

do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-pastilles-evaluation', '* * * * *', 'select app.pastilles_reveiller();') into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

-- =============================================================================================
-- 3. Privilèges
-- =============================================================================================

revoke all on function public.verify_label_dispatch(text) from public, anon, authenticated;
grant execute on function public.verify_label_dispatch(text) to service_role;
revoke all on function app.pastilles_reveiller() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- @spec CRM-163 (docs/BACKLOG.md) — le bail de la passe des pastilles : `pg_cron` ne réveille plus une passe tant que la
--       précédente tourne, et la passe rend le bail en finissant
-- @spec docs/SPEC-ia.md §16.3 ; docs/SPEC-mail-subsystem.md §31.5 ; docs/SCHEMA.md « Migration `0199` » ; décision 973
--
-- POURQUOI UN BAIL : le runtime ne sert qu'un worker à la fois par répertoire de fonction (docs/SPEC-ia.md §16.1). Un
-- réveil tombé pendant une passe attendait 10 s, puis échouait (`edge_request_failed`) — à chaque minute du rattrapage.
-- 160 s couvrent la borne de 150 s du worker et ses 10 s d'attente : une passe interrompue laisse le bail échoir.
--
-- IDEMPOTENCE : la table et sa ligne ne sont créées que si elles manquent ; `create or replace`.

-- =============================================================================================
-- 1. Le bail : une ligne
-- =============================================================================================

create table if not exists app.label_pass_lease (
	id           boolean primary key default true check (id),
	leased_until timestamptz
);
comment on table app.label_pass_lease is
	'CRM-163 — docs/SPEC-ia.md §16.3. Le bail de la passe des pastilles : une ligne ; pris par app.pastilles_reveiller, '
	'rendu par public.release_label_pass.';
insert into app.label_pass_lease (id, leased_until) values (true, null) on conflict (id) do nothing;
revoke all on table app.label_pass_lease from public, anon, authenticated;

-- =============================================================================================
-- 2. Le réveil prend le bail — reprise de `0184`, seul le bail ajouté
-- =============================================================================================

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
	-- `CRM-163` : une passe en cours garde le bail ; le réveil n'appelle pas.
	update app.label_pass_lease
	   set leased_until = now() + interval '160 seconds'
	 where id and (leased_until is null or leased_until < now());
	if not found then
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
	'CRM-141, CRM-163 — docs/SPEC-mail-subsystem.md §31.5, docs/SPEC-ia.md §16.3. Réveille la passe des pastilles si une '
	'évaluation est due et si le bail de la passe est libre.';
revoke all on function app.pastilles_reveiller() from public, anon, authenticated;

-- =============================================================================================
-- 3. La passe rend le bail
-- =============================================================================================

create or replace function public.release_label_pass()
returns void
language sql
security definer
set search_path = ''
as $$
	update app.label_pass_lease set leased_until = null where id;
$$;
comment on function public.release_label_pass() is
	'CRM-163 — docs/SPEC-ia.md §16.3. La passe des pastilles rend son bail en finissant. service_role seul.';
revoke all on function public.release_label_pass() from public, anon, authenticated;
grant execute on function public.release_label_pass() to service_role;

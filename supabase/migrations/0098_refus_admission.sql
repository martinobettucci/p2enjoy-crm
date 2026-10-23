-- @spec CRM-109 (docs/BACKLOG.md) — tranche T1 : le journal des refus d'admission d'une adresse attendue
-- @spec docs/SPEC-refus-admission.md §2 (ce qui est journalisé : trois motifs, une adresse attendue, rien d'autre), §3
--       (la table, la fonction d'écriture, la purge, la lecture) ; docs/SPEC-session-sso.md §6.1 (minimisation) ;
--       docs/SCHEMA.md §9 bis.8 sexies ; docs/JOURNAL.md décisions 640 et 644 ; docs/PROD_MIGRATIONS.md §3 (migration 98)
--
-- UNE TRACE PAR ATTENTE, ET SEULEMENT PAR ATTENTE. La clé `(workspace_id, email)` est celle de `workspace_invitations`,
-- et la clé étrangère `on delete cascade` fait partir la trace avec son attente : consommée à l'admission, retirée, ou
-- remplacée par `inscrire_attente` (migration 97), qui la retire puis la réinscrit (décision 644). Une adresse que
-- personne n'attend n'a pas d'attente, donc ne peut pas avoir de trace : la minimisation de `SPEC-session-sso.md` §6.1
-- est tenue par le schéma, pas seulement par l'échangeur.
--
-- ÉCRITURE PAR L'ÉCHANGEUR SEUL. `journaliser_refus_admission` est `SECURITY DEFINER` et exécutable par `service_role`
-- seul — la clé avec laquelle l'échangeur appelle déjà `ouvrir_session_sso`. Aucune politique d'écriture.
--
-- LECTURE PAR L'ADMINISTRATEUR DE L'ESPACE, 90 JOURS AU PLUS. La politique suit `app.is_workspace_admin`, et filtre ce
-- que la purge quotidienne n'aurait pas encore retiré. Ordinaire, rejouable.

create table if not exists public.admission_refus (
	workspace_id  uuid        not null,
	email         text        not null,
	motif         text        not null,
	premier_refus timestamptz not null default now(),
	dernier_refus timestamptz not null default now(),
	refus         integer     not null default 1,
	constraint admission_refus_pkey primary key (workspace_id, email),
	constraint admission_refus_attente_fkey foreign key (workspace_id, email)
		references public.workspace_invitations (workspace_id, email) on delete cascade,
	constraint admission_refus_motif_check
		check (motif in ('adresse_non_verifiee', 'attente_verification', 'attente_administrateur')),
	constraint admission_refus_refus_check check (refus >= 1),
	constraint admission_refus_dates_check check (dernier_refus >= premier_refus)
);

comment on table public.admission_refus is
	'CRM-109 — docs/SPEC-refus-admission.md §3. Le dernier refus d''admission d''une adresse attendue, par attente : '
	'motif, premier et dernier refus, nombre. Part avec l''attente (cascade) et au plus tard 90 jours après le dernier '
	'refus. Écrite par l''échangeur seul (journaliser_refus_admission), lue par l''administrateur de l''espace.';

alter table public.admission_refus enable row level security;

revoke all on table public.admission_refus from public, anon, authenticated;
grant select on table public.admission_refus to authenticated;

drop policy if exists admission_refus_lecture_admin on public.admission_refus;
create policy admission_refus_lecture_admin on public.admission_refus
	for select to authenticated
	using (app.is_workspace_admin(workspace_id) and dernier_refus > now() - interval '90 days');

-- ---------------------------------------------------------------------------------------------
-- L'écriture : une trace par attente de l'adresse, rien sans attente
-- ---------------------------------------------------------------------------------------------

create or replace function public.journaliser_refus_admission(p_email text, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	adresse text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
begin
	if p_motif is null or p_motif not in ('adresse_non_verifiee', 'attente_verification', 'attente_administrateur') then
		raise exception 'motif_invalide' using errcode = '22023';
	end if;

	-- Sans attente, aucune ligne n'est sélectionnée, rien n'est écrit, et l'appelant n'en apprend rien.
	insert into public.admission_refus as r (workspace_id, email, motif, premier_refus, dernier_refus, refus)
	select i.workspace_id, i.email, p_motif, now(), now(), 1
	  from public.workspace_invitations i
	 where i.email = adresse
	on conflict (workspace_id, email) do update
	   set motif         = excluded.motif,
	       dernier_refus = excluded.dernier_refus,
	       refus         = r.refus + 1;
end;
$$;

alter function public.journaliser_refus_admission(text, text) owner to postgres;

comment on function public.journaliser_refus_admission(text, text) is
	'CRM-109 — docs/SPEC-refus-admission.md §3, §4. Pose ou met à jour la trace de refus de chaque attente de '
	'l''adresse, et seulement de celles-là. Trois motifs (22023 sinon). Exécutable par service_role seul.';

revoke all on function public.journaliser_refus_admission(text, text) from public, anon, authenticated;
grant execute on function public.journaliser_refus_admission(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- La purge quotidienne : 90 jours au plus après le dernier refus (décision 640, point 3)
-- ---------------------------------------------------------------------------------------------

create or replace function app.purger_refus_admission()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
	with purgees as (
		delete from public.admission_refus where dernier_refus <= now() - interval '90 days' returning 1
	)
	select pg_catalog.count(*)::integer from purgees
$$;

alter function app.purger_refus_admission() owner to postgres;
revoke all on function app.purger_refus_admission() from public, anon, authenticated, service_role;

comment on function app.purger_refus_admission() is
	'CRM-109 — docs/SPEC-refus-admission.md §3. Supprime les traces de refus de plus de 90 jours ; rend leur nombre. '
	'Appelée chaque jour par pg_cron (p2enjoy-purge-refus-admission).';

-- Une fois par jour, à la minute 53 de 3 h : l'heure creuse, sans disputer une minute déjà prise — la 7 (heartbeat), la
-- 23 (relances des affaires figées), la 41 (séquences de relance) ; `verify-armement-sequences.sh` exige des minutes
-- distinctes. Un nom stable fait converger `cron.schedule` sur le même job à chaque rejeu.
do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-purge-refus-admission', '53 3 * * *', 'select app.purger_refus_admission();')
	  into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

notify pgrst, 'reload schema';

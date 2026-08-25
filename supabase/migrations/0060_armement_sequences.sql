-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 4, SOUS-TRANCHE 4b : l'armement et l'exécution
-- @spec docs/SPEC-modeles-emails.md §12 (contrat exécutable de 4b), §12.1 (les quatre questions et
--       la mesure qui tranche chacune), §12.2 (qui arme), §12.3 (`card_sequence_enrollments`),
--       §12.4 (les huit refus de l'armement), §12.5 (quand un palier est dû), §12.6 (ce qu'une
--       réponse produit), §12.7 (les quatre fins), §12.8 (`app.mail_outbox_inserer`), §12.9 (le
--       job), §12.10 (autorisations)
-- @spec docs/SPEC-modeles-emails.md §10.3 (le corps mis en file est le corps SIGNÉ), §11.4 (le
--       délai se compte depuis le palier précédent)
-- @spec docs/SPEC-relances.md §2.4 (les trois exclusions de `cards_figees`), §9.2 (le job APPELLE
--       la règle, il ne la recopie pas), §9.5 (l'acteur nul est obtenu, jamais affecté),
--       §9.7 (le job `pg_cron` et son démarrage observable)
-- @spec docs/SPEC-scheduler.md §1 (chaque unité enregistre son job par migration), §3 (démarrage
--       observable), §4 (fermeture des privilèges)
-- @spec docs/SPEC-mail-subsystem.md §19.4 (`queue_outbound_email`, seule porte de la file)
-- @spec docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §3.7 (`app.can_write_card`),
--       §7 (le refus est zéro ligne)
-- @spec docs/SCHEMA.md §7 (`card_sequence_enrollments`) ; docs/PROD_MIGRATIONS.md migration 60
--
-- CETTE MIGRATION CRÉE UNE TABLE, TROIS FONCTIONS, EN RÉVISE UNE, ET ENREGISTRE UN JOB.
--
-- La sous-tranche 4a a livré la CADENCE — une séquence et ses paliers, objet éditorial que
-- personne n'applique. Celle-ci livre l'APPLICATION : le lien entre une affaire et une cadence, le
-- job qui fait partir les messages, et les quatre façons dont ce lien se termine.
--
-- ---------------------------------------------------------------------------------------------
-- CE QU'ELLE N'EST PAS.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UNE SECONDE DÉFINITION DE « FIGÉE ». Le job APPELLE `public.cards_figees()`
--    (§12.7). Un seul prédicat, déjà livré, couvre QUATRE interruptions : le déplacement d'étape
--    repose `entered_step_at` (migration 12), et le sommeil, l'archivage et la corbeille sont les
--    trois exclusions du §2.4 de `docs/SPEC-relances.md`. Recopier ces prédicats ici aurait créé
--    la seconde définition que le §2.1 de ce document existe pour empêcher.
--
-- 2. CE N'EST PAS UN SECOND CHEMIN D'ENVOI. L'insertion dans `mail_outbox` est EXTRAITE dans
--    `app.mail_outbox_inserer`, que `public.queue_outbound_email` et le job appellent tous deux
--    (§12.8). La règle « ce qui est stocké est ce qui part » — le corps SIGNÉ du §10.3 — garde
--    ainsi UNE seule définition. Ce qui est écrit deux fois diverge une fois : la migration 59 l'a
--    payé sur ses clés étrangères déclarées en ligne.
--
-- 3. LES SEPT REFUS DE `queue_outbound_email` NE BOUGENT PAS. Seules les cinq lignes de son
--    `insert` se déplacent. Assouplir son premier refus — rendre `auth.uid()` facultatif pour que
--    le job l'emprunte — était l'autre issue : elle est ÉCARTÉE, et le §12.8 dit pourquoi. Elle
--    aurait ouvert à `anon` un chemin d'envoi que sept refus protègent.
--
-- 4. AUCUNE COLONNE `next_due_at`. L'échéance se DÉRIVE de `last_sent_at` (ou d'`armed_at`) et du
--    `delai_jours` du palier suivant (§12.5). Une colonne recopiée serait la seconde source de
--    vérité que le §9.4 de `docs/SPEC-relances.md` a déjà refusée, et elle divergerait dès qu'un
--    palier serait modifié.
--
-- 5. AUCUNE SEIZIÈME VALEUR AU VOCABULAIRE DU FIL. Mettre en file n'est pas envoyer : le
--    `mail_sent` de la timeline est écrit quand le worker a réellement expédié, et l'inscrire à la
--    mise en file dirait au lecteur qu'un message est parti alors qu'il attend encore (§12.9).
--
-- 6. AUCUN ÉCRAN. Armer se fait par la RPC, donc par les preuves. L'écran est 4c (§12.15).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout est écrit pour être rejoué :
-- `create table if not exists`, `drop constraint if exists` avant `add constraint`,
-- `drop policy if exists` avant `create policy`, `drop index if exists` avant `create index`,
-- `create or replace function`, et `cron.schedule` sur un nom stable.
--
-- LES CLÉS ÉTRANGÈRES SONT POSÉES PAR `alter table`, JAMAIS EN LIGNE. C'est la leçon que la
-- migration 59 a payée : ce qui est déclaré dans un `create table if not exists` est un NO-OP sur
-- une table existante, si bien qu'une règle corrigée n'atteindrait aucune base déjà migrée,
-- production comprise, et la divergence serait muette.

-- =============================================================================================
-- 1. `public.card_sequence_enrollments` — l'inscription — §12.3
-- =============================================================================================
-- LE NOM N'EST PAS CHOISI ICI : `docs/SCHEMA.md` §7 l'annonce depuis `CRM-000`, avec sa définition
-- en une ligne — « inscription d'une card à une cadence, arrêtée dès qu'une réponse arrive ». La
-- sous-tranche livre ce que le schéma promettait ; la question 3 du §12.1 ne fait que confirmer
-- par la mesure ce que cette ligne disait déjà.

create table if not exists public.card_sequence_enrollments (
	id            uuid        primary key default gen_random_uuid(),
	workspace_id  uuid        not null,
	card_id       uuid        not null,
	sequence_id   uuid        not null,
	identity_id   uuid        not null,
	armed_by      uuid,
	armed_at      timestamptz not null default now(),
	last_position integer,
	last_sent_at  timestamptz,
	status        text        not null default 'active',
	closed_reason text,
	closed_at     timestamptz,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

comment on table public.card_sequence_enrollments is
	'CRM-063 sous-tranche 4b — docs/SPEC-modeles-emails.md §12.3. Inscription d''une affaire à une '
	'cadence de relance. Armée par un GESTE humain qui choisit l''identité expéditrice, la séquence '
	'n''en portant aucune (§11.2). Fermée par une réponse, la sortie de `cards_figees()`, un geste '
	'explicite, ou l''épuisement des paliers. Une inscription fermée n''est JAMAIS rouverte : '
	'réarmer, c''est armer de nouveau.';

comment on column public.card_sequence_enrollments.armed_at is
	'Ancre du PREMIER palier (§12.5) ET borne de la détection de réponse (§12.6) : un message '
	'entrant arrivé après cet instant est une réponse, même si aucune relance n''est encore partie.';

comment on column public.card_sequence_enrollments.last_position is
	'Position du DERNIER palier mis en file. `null` = aucun encore. Renseignée avec `last_sent_at` '
	'ou nulle avec elle : une position sans son instant ne saurait pas quand le palier suivant est '
	'dû, et l''inverse ne saurait pas lequel.';

comment on column public.card_sequence_enrollments.closed_reason is
	'Les QUATRE fins du §12.7 : `reply` (un message entrant après l''armement), `card_ineligible` '
	'(l''affaire n''est plus rendue par `public.cards_figees()` — un seul prédicat pour quatre '
	'interruptions), `manual` (`interrompre_sequence_relance`), `exhausted` (le dernier palier a '
	'été mis en file).';

-- --- Bornes et cohérence -----------------------------------------------------------------------
-- `status` ne porte que DEUX valeurs, et il n'y en a pas de troisième (§12.7) : une inscription est
-- en cours ou elle est finie, `closed_reason` disant POURQUOI. Un `paused` supposerait un geste de
-- reprise que le produit n'offre pas, et une valeur d'état qu'aucun chemin ne quitte est la colonne
-- sans lecteur que le §11.3 refuse.

alter table public.card_sequence_enrollments
	drop constraint if exists card_sequence_enrollments_status_borne;
alter table public.card_sequence_enrollments
	add constraint card_sequence_enrollments_status_borne
	check (status in ('active', 'closed'));

alter table public.card_sequence_enrollments
	drop constraint if exists card_sequence_enrollments_motif_borne;
alter table public.card_sequence_enrollments
	add constraint card_sequence_enrollments_motif_borne
	check (closed_reason is null
	       or closed_reason in ('reply', 'card_ineligible', 'manual', 'exhausted'));

-- LA FERMETURE EST UN TOUT : `status`, `closed_reason` et `closed_at` sont cohérents ou l'écriture
-- est refusée. Une inscription `closed` sans motif ne dirait pas ce qui l'a terminée ; une
-- inscription `active` portant un motif dirait deux choses contradictoires.
alter table public.card_sequence_enrollments
	drop constraint if exists card_sequence_enrollments_fermeture_coherente;
alter table public.card_sequence_enrollments
	add constraint card_sequence_enrollments_fermeture_coherente
	check (
		(status = 'active' and closed_reason is null and closed_at is null)
		or
		(status = 'closed' and closed_reason is not null and closed_at is not null)
	);

-- LA PROGRESSION EST UN TOUT ELLE AUSSI (§12.3). La borne haute de `last_position` est celle de
-- `mail_sequence_steps.position` — 50 —, et la basse est 1 : la valeur `0` est portée par le `null`,
-- qui dit « aucun palier encore ».
alter table public.card_sequence_enrollments
	drop constraint if exists card_sequence_enrollments_progression_coherente;
alter table public.card_sequence_enrollments
	add constraint card_sequence_enrollments_progression_coherente
	check (
		(last_position is null     and last_sent_at is null)
		or
		(last_position is not null and last_sent_at is not null
		 and last_position between 1 and 50)
	);

-- --- Clés étrangères, posées par `alter table` (leçon de la migration 59) -----------------------
-- L'ASYMÉTRIE EST VOULUE (§12.3) : une affaire supprimée emporte tout ce qui la décrit, mais
-- supprimer une cadence ou une adresse PENDANT QU'ELLE RELANCE laisserait une inscription qui ne
-- sait plus quoi envoyer ni d'où. Le refus rend `23503`, que PostgREST classe en 409.
--
-- LES CLÉS COMPOSITES INTERDISENT LA DIVERGENCE DE WORKSPACE, patron de la migration 59 : une
-- inscription dont la card et la séquence appartiendraient à deux workspaces différents serait une
-- fuite, et la RLS ne la verrait pas.

do $$
begin
	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.card_sequence_enrollments'::regclass
	                  and conname  = 'card_sequence_enrollments_workspace_fk') then
		alter table public.card_sequence_enrollments
			add constraint card_sequence_enrollments_workspace_fk
			foreign key (workspace_id) references public.workspaces (id) on delete cascade;
	end if;

	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.card_sequence_enrollments'::regclass
	                  and conname  = 'card_sequence_enrollments_card_fk') then
		alter table public.card_sequence_enrollments
			add constraint card_sequence_enrollments_card_fk
			foreign key (card_id, workspace_id)
			references public.cards (id, workspace_id) on delete cascade;
	end if;

	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.card_sequence_enrollments'::regclass
	                  and conname  = 'card_sequence_enrollments_sequence_fk') then
		alter table public.card_sequence_enrollments
			add constraint card_sequence_enrollments_sequence_fk
			foreign key (sequence_id, workspace_id)
			references public.mail_sequences (id, workspace_id) on delete restrict;
	end if;

	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.card_sequence_enrollments'::regclass
	                  and conname  = 'card_sequence_enrollments_identity_fk') then
		alter table public.card_sequence_enrollments
			add constraint card_sequence_enrollments_identity_fk
			foreign key (identity_id) references public.mail_outbound_identities (id)
			on delete restrict;
	end if;

	if not exists (select 1 from pg_constraint
	                where conrelid = 'public.card_sequence_enrollments'::regclass
	                  and conname  = 'card_sequence_enrollments_armed_by_fk') then
		alter table public.card_sequence_enrollments
			add constraint card_sequence_enrollments_armed_by_fk
			foreign key (armed_by) references public.profiles (id) on delete set null;
	end if;
end;
$$;

-- --- Les index composites que ces clés exigent -------------------------------------------------
-- `cards` et `mail_sequences` doivent porter un index unique sur `(id, workspace_id)` pour être
-- référencées ainsi. La migration 59 a déjà posé celui de `mail_sequences` et celui de
-- `mail_templates` ; celui de `cards` est ajouté ici. C'est un ajout ADDITIF : il ne refuse aucune
-- écriture que la clé primaire n'interdisait déjà, `id` y étant déjà unique à lui seul.

create unique index if not exists cards_id_workspace_idx
	on public.cards (id, workspace_id);

comment on index public.cards_id_workspace_idx is
	'CRM-063 sous-tranche 4b — support de la clé étrangère composite de '
	'`card_sequence_enrollments`. ADDITIF : `id` est déjà unique par la clé primaire.';

-- --- UNE SEULE INSCRIPTION ACTIVE PAR AFFAIRE, et c'est un index PARTIEL --------------------
-- §12.2. Deux cadences armées sur la même affaire enverraient deux messages le même jour sans
-- qu'aucune contrainte ne le voie — exactement le défaut que le délai relatif du §11.4 existe pour
-- empêcher À L'INTÉRIEUR d'une cadence. La garde est en base, pas dans l'applicatif : une garde
-- applicative laisserait passer deux appels concurrents.
--
-- L'index est PARTIEL : une affaire peut porter autant d'inscriptions FERMÉES que son histoire en
-- compte, et une seule active.

drop index if exists public.card_sequence_enrollments_active_unique;
create unique index card_sequence_enrollments_active_unique
	on public.card_sequence_enrollments (card_id)
	where status = 'active';

comment on index public.card_sequence_enrollments_active_unique is
	'CRM-063 §12.2 — UNE seule inscription active par affaire. Partiel : l''histoire d''une affaire '
	'peut compter autant d''inscriptions fermées qu''elle a connu de cadences.';

-- Index de travail du job : il balaie les inscriptions actives à chaque passage.
create index if not exists card_sequence_enrollments_actives_idx
	on public.card_sequence_enrollments (status, workspace_id)
	where status = 'active';

-- --- `updated_at` -------------------------------------------------------------------------------
drop trigger if exists card_sequence_enrollments_set_updated_at
	on public.card_sequence_enrollments;
create trigger card_sequence_enrollments_set_updated_at
	before update on public.card_sequence_enrollments
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 2. `app.mail_outbox_inserer` — la porte EXTRAITE, et non dupliquée — §12.8
-- =============================================================================================
-- LA RÈGLE « CE QUI EST STOCKÉ EST CE QUI PART » DOIT AVOIR UNE SEULE DÉFINITION (§10.3). Le corps
-- mis en file est le corps SIGNÉ par `app.mail_corps_signe`. Écrire un second `insert` dans le job
-- aurait produit DEUX endroits où la signature s'ajoute, et le jour où l'un change, l'autre
-- enverrait autre chose sans que rien ne le dise.
--
-- ELLE NE PORTE AUCUN REFUS, et c'est délibéré : les refus appartiennent aux APPELANTS, dont les
-- droits diffèrent — `queue_outbound_email` en oppose sept à un humain, `armer_sequence_relance`
-- en oppose huit, et le job n'a personne à refuser puisqu'il n'est le geste de personne. Une porte
-- privée qui rejouerait les refus de ses appelants les rendrait tous faux dès que l'un divergerait.
--
-- Elle vit dans `app`, que PostgREST n'expose pas, et ses privilèges sont révoqués des QUATRE
-- rôles nommément.

create or replace function app.mail_outbox_inserer(
	p_workspace_id           uuid,
	p_identity_id            uuid,
	p_card_id                uuid,
	p_in_reply_to_message_id uuid,
	p_to                     text[],
	p_cc                     text[],
	p_subject                text,
	p_body_text              text,
	p_signature              text,
	p_created_by             uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_file uuid;
begin
	insert into public.mail_outbox (
		workspace_id, identity_id, card_id, in_reply_to_message_id,
		to_addrs, cc_addrs, subject, body_text, created_by
	)
	values (
		p_workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), p_subject,
		-- CE QUI EST STOCKÉ EST CE QUI PART (§10.3). Seule occurrence de cette règle dans le dépôt.
		app.mail_corps_signe(p_body_text, p_signature),
		p_created_by
	)
	returning id into v_file;

	return v_file;
end;
$$;

alter function app.mail_outbox_inserer(uuid, uuid, uuid, uuid, text[], text[], text, text, text, uuid)
	owner to postgres;

comment on function app.mail_outbox_inserer(uuid, uuid, uuid, uuid, text[], text[], text, text, text, uuid) is
	'CRM-063 §12.8 — SEULE ligne d''insertion dans `mail_outbox`. Extraite de '
	'`public.queue_outbound_email` pour que la règle du §10.3 — le corps mis en file est le corps '
	'SIGNÉ — garde UNE définition. Elle ne porte AUCUN refus : les refus appartiennent aux '
	'appelants, dont les droits diffèrent. `p_created_by` nul = mise en file par un job.';

revoke all on function app.mail_outbox_inserer(uuid, uuid, uuid, uuid, text[], text[], text, text, text, uuid)
	from public, anon, authenticated, service_role;

-- =============================================================================================
-- 3. `public.queue_outbound_email` — RÉVISÉE, ses sept refus INTACTS — §12.8
-- =============================================================================================
-- CE QUI CHANGE PAR RAPPORT À LA MIGRATION 58, ET RIEN D'AUTRE : les cinq lignes de l'`insert`
-- deviennent un appel à `app.mail_outbox_inserer`. Les sept refus, leur ORDRE et leurs `SQLSTATE`
-- sont repris à l'identique, et le corps mis en file est le même corps signé — c'est désormais la
-- porte extraite qui le compose, au lieu que cette fonction le fasse elle-même.

create or replace function public.queue_outbound_email(
	p_card_id     uuid,
	p_identity_id uuid,
	p_to          text[],
	p_subject     text default null,
	p_body_text   text default '',
	p_cc          text[] default '{}',
	p_in_reply_to_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant  uuid := (select auth.uid());
	v_identite  public.mail_outbound_identities%rowtype;
	v_card      public.cards%rowtype;
	v_adresse   text;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU : le droit d'ÉCRITURE est exigé,
	-- comme pour un commentaire ou un classement.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     -- L'identité de SERVICE — sans propriétaire — appartient au workspace : seuls ses
	     -- administrateurs l'empruntent.
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		-- `42501` ET NON `P0002`, ET C'EST MESURÉ : PostgREST traduit `P0002` en **500**, et un
		-- refus d'autorisation qui se présente comme une panne de serveur enverrait l'exploitant
		-- chercher un incident là où le produit a simplement dit non.
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	select * into v_card
	  from public.cards c
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and c.archived_at is null
	   and c.deleted_at is null;
	if v_card.id is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- LA CARD DOIT AVOIR UNE ADRESSE, et le motif est mesuré (§19.1) : le serveur transmet le
	-- `Reply-To` sans le vérifier. Un envoi dont la réponse ne reviendrait nulle part est pire
	-- qu'un envoi refusé.
	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	-- LE SEPTIÈME REFUS — CRM-063 §10.3. Il porte sur ce que l'UTILISATEUR a écrit, jamais sur le
	-- corps composé : une signature ne rattrape pas un message vide.
	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LE QUOTA, PAR POLITESSE : la règle est celle du worker, qui dépense réellement (§19.4).
	-- Ce contrôle-ci rend le refus immédiat et visible par celui qui écrit.
	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	-- L'INSERTION EST EXTRAITE (§12.8) : une seule définition de « ce qui est stocké est ce qui
	-- part », partagée avec le job des séquences de relance.
	return app.mail_outbox_inserer(
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, p_cc, p_subject, p_body_text, v_identite.signature_text, v_appelant);
end;
$$;

comment on function public.queue_outbound_email is
	'CRM-058 §19.4, révisée par CRM-063 §10.3 puis §12.8 — seule porte HUMAINE de la file d''envoi. '
	'SEPT refus : not_authenticated, forbidden, identity_not_available, card_not_available, '
	'recipient_required, body_required, quota_exceeded. L''insertion est déléguée à '
	'`app.mail_outbox_inserer`, que le job des séquences emprunte aussi : le corps stocké est le '
	'corps SIGNÉ, et cette règle a UNE définition.';

revoke all on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	to authenticated, service_role;

-- =============================================================================================
-- 4. `public.armer_sequence_relance` — le geste, et ses huit refus — §12.4
-- =============================================================================================
-- ARMER, C'EST CHOISIR DEUX CHOSES : quelle cadence, et DE QUELLE ADRESSE les messages partent. La
-- séquence ne porte aucune identité (§11.2), et MESURÉ : le workspace de démonstration en porte
-- DEUX. Un job qui armerait tout seul devrait choisir entre elles, et toute règle qu'il
-- appliquerait — « la première », « celle du responsable » — serait la valeur par défaut trompeuse
-- que `CLAUDE.md` §18 proscrit. L'armement est donc un GESTE, et l'identité est STOCKÉE.
--
-- `security definer` : `authenticated` ne détient aucun `insert` sur la table (section 6),
-- exactement comme pour `mail_outbox`.

create or replace function public.armer_sequence_relance(
	p_card_id     uuid,
	p_sequence_id uuid,
	p_identity_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_appelant    uuid := (select auth.uid());
	v_sequence    public.mail_sequences%rowtype;
	v_identite    public.mail_outbound_identities%rowtype;
	v_paliers     integer;
	v_figee       boolean;
	v_adresse     text;
	v_inscription uuid;
begin
	-- (a) Le geste est HUMAIN par construction (§12.2).
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- (b) Relancer au nom d'une affaire, c'est y ajouter du contenu : même exigence qu'au §19.4.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- (e) L'identité doit être empruntable : règle reprise TELLE QUELLE de `queue_outbound_email`.
	-- Elle est évaluée AVANT la séquence parce que c'est elle qui fixe le workspace de référence,
	-- exactement comme dans `queue_outbound_email`.
	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	-- (c) La séquence doit exister DANS LE WORKSPACE de l'identité. Armer une cadence d'un autre
	-- workspace serait la divergence que les clés composites interdisent en base ; le refus la
	-- NOMME plutôt que de laisser la contrainte parler en `23503`.
	select * into v_sequence
	  from public.mail_sequences s
	 where s.id = p_sequence_id
	   and s.workspace_id = v_identite.workspace_id;
	if v_sequence.id is null then
		raise exception 'sequence_not_available' using errcode = '23514';
	end if;

	-- (d) Une cadence VIDE n'enverrait jamais rien, et l'inscription serait un objet mort.
	select count(*)::integer into v_paliers
	  from public.mail_sequence_steps st
	 where st.sequence_id = p_sequence_id;
	if v_paliers = 0 then
		raise exception 'sequence_empty' using errcode = '23514';
	end if;

	-- (f) L'AFFAIRE DOIT ÊTRE FIGÉE, au sens de `public.cards_figees()` et d'AUCUN autre (§12.2).
	-- La fonction est `SECURITY INVOKER` : elle rend à l'appelant ses seules affaires, et le refus
	-- porte donc aussi sur une affaire figée qu'il ne verrait pas — ce que le refus (b) a déjà
	-- écarté.
	select exists (select 1 from public.cards_figees() f where f.card_id = p_card_id)
	  into v_figee;
	if not v_figee then
		raise exception 'card_not_stalled' using errcode = '23514';
	end if;

	-- (g) LA CARD DOIT AVOIR UNE ADRESSE : une relance dont la réponse ne reviendrait nulle part
	-- est pire qu'un refus. Reprise de `queue_outbound_email`, et opposée ICI plutôt qu'au premier
	-- palier — un refus quatre jours après le geste ne dirait plus à personne ce qui l'a causé.
	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- (h) UNE SEULE INSCRIPTION ACTIVE PAR AFFAIRE. L'index unique partiel l'impose en base ; ce
	-- contrôle-ci donne au refus un NOM, là où la contrainte rendrait un message de catalogue.
	if exists (
		select 1 from public.card_sequence_enrollments e
		 where e.card_id = p_card_id and e.status = 'active'
	) then
		raise exception 'enrollment_exists' using errcode = '23505';
	end if;

	insert into public.card_sequence_enrollments (
		workspace_id, card_id, sequence_id, identity_id, armed_by
	)
	values (
		v_identite.workspace_id, p_card_id, p_sequence_id, p_identity_id,
		-- TRACE, JAMAIS UN DROIT (§2.2) : le profil est relu, jamais recopié depuis la revendication.
		(select p.id from public.profiles p where p.id = v_appelant)
	)
	returning id into v_inscription;

	return v_inscription;
end;
$$;

alter function public.armer_sequence_relance(uuid, uuid, uuid) owner to postgres;

comment on function public.armer_sequence_relance(uuid, uuid, uuid) is
	'CRM-063 §12.4 — seule porte d''armement. HUIT refus, dans cet ordre : not_authenticated, '
	'forbidden, identity_not_available, sequence_not_available, sequence_empty, card_not_stalled, '
	'card_not_available, enrollment_exists. L''affaire doit être FIGÉE au sens de '
	'`public.cards_figees()`, et l''identité expéditrice est choisie ICI parce que la séquence n''en '
	'porte aucune (§11.2).';

revoke all on function public.armer_sequence_relance(uuid, uuid, uuid) from public, anon;
grant execute on function public.armer_sequence_relance(uuid, uuid, uuid)
	to authenticated, service_role;

-- =============================================================================================
-- 5. `public.interrompre_sequence_relance` — le geste explicite — §12.4
-- =============================================================================================
-- FERMER UNE INSCRIPTION DÉJÀ FERMÉE NE LÈVE RIEN ET N'ÉCRIT RIEN. L'idempotence est celle d'un
-- geste que l'on peut poser deux fois sans le savoir — deux onglets, un double clic —, et un
-- second refus n'apprendrait rien à l'utilisateur. Ce n'est PAS un `try/catch` vide : rien n'est
-- masqué, la ligne est simplement déjà dans l'état demandé.

create or replace function public.interrompre_sequence_relance(p_enrollment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_card     uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select e.card_id into v_card
	  from public.card_sequence_enrollments e
	 where e.id = p_enrollment_id;

	-- UNE INSCRIPTION INTROUVABLE ET UNE INSCRIPTION INTERDITE RENDENT LE MÊME REFUS, et c'est
	-- voulu : distinguer les deux dirait à qui n'a pas le droit de lire qu'une ligne existe.
	if v_card is null or not app.can_write_card(v_card) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	update public.card_sequence_enrollments
	   set status        = 'closed',
	       closed_reason = 'manual',
	       closed_at     = now()
	 where id     = p_enrollment_id
	   and status = 'active';
end;
$$;

alter function public.interrompre_sequence_relance(uuid) owner to postgres;

comment on function public.interrompre_sequence_relance(uuid) is
	'CRM-063 §12.4 — ferme une inscription active avec le motif `manual`. DEUX refus : '
	'not_authenticated, forbidden. IDEMPOTENTE : fermer une inscription déjà fermée ne lève rien '
	'et n''écrit rien. Introuvable et interdite rendent le MÊME refus — les distinguer dirait à qui '
	'n''a pas le droit de lire qu''une ligne existe.';

revoke all on function public.interrompre_sequence_relance(uuid) from public, anon;
grant execute on function public.interrompre_sequence_relance(uuid)
	to authenticated, service_role;

-- =============================================================================================
-- 6. Autorisations de la table — §12.10
-- =============================================================================================
-- LECTURE : ceux qui peuvent lire la card, patron des tables filles (§3.6 de
-- `docs/SPEC-permissions-rls.md`).
--
-- ÉCRITURE : PERSONNE, directement. `armer_sequence_relance` est la seule porte d'insertion,
-- `interrompre_sequence_relance` et le job les seules de mise à jour, et aucune suppression n'est
-- exposée — une inscription est une TRACE : on la ferme, on ne l'efface pas. C'est la fermeture de
-- `mail_outbox`, et pour la même raison : une file d'envoi que le client écrirait lui-même n'aurait
-- plus aucun refus.

alter table public.card_sequence_enrollments enable row level security;

drop policy if exists card_sequence_enrollments_lecture on public.card_sequence_enrollments;
create policy card_sequence_enrollments_lecture
	on public.card_sequence_enrollments
	for select
	to anon, authenticated
	using (app.can_read_card(card_id));

-- LE POINT DE SÛRETÉ DES MIGRATIONS 48 À 59 S'APPLIQUE : la plateforme porte des
-- `alter default privileges … to anon`, si bien qu'un `revoke … from public` ne retire RIEN à un
-- rôle NOMMÉ. Les rôles sont révoqués nommément avant toute attribution.
revoke all on public.card_sequence_enrollments from anon, authenticated;
grant select        on public.card_sequence_enrollments to anon, authenticated;
grant all privileges on public.card_sequence_enrollments to service_role;

-- =============================================================================================
-- 7. `app.executer_sequences_relance()` — le job — §12.9
-- =============================================================================================
-- L'ORDRE DU PASSAGE EST FERMER D'ABORD, ENVOYER ENSUITE, et il n'est pas indifférent : envoyer
-- avant de fermer ferait partir une relance chez quelqu'un qui a répondu la veille.
--
-- `security definer`, propriétaire `postgres` : aucun rôle ne détient `insert` sur `mail_outbox`
-- (mesuré, `authenticated=r/postgres`), et la table des inscriptions est fermée en écriture.
--
-- L'ACTEUR EST NUL, ET IL EST OBTENU PLUTÔT QU'AFFECTÉ (§9.5 de `docs/SPEC-relances.md`) :
-- `mail_outbox.created_by` est nullable (mesuré), et le job passe `null` parce qu'une relance
-- automatique n'a pas d'auteur humain.

create or replace function app.executer_sequences_relance()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_inscription record;
	v_palier      record;
	v_rendu       record;
	v_identite    public.mail_outbound_identities%rowtype;
	v_mises       integer := 0;
	v_dernier     integer;
	v_job_id      bigint;
begin
	-- --- 1 Fermer ce que l'affaire a rendu inéligible — motif `card_ineligible` ---------------
	-- UN SEUL PRÉDICAT COUVRE QUATRE INTERRUPTIONS (§12.7), et aucun n'est réécrit ici : le
	-- déplacement d'étape repose `entered_step_at` (migration 12), et le sommeil, l'archivage et
	-- la corbeille sont les trois exclusions du §2.4 de `docs/SPEC-relances.md`.
	--
	-- La fonction est APPELÉE, jamais recopiée (§9.2). MESURÉ le 2026-08-24 pour `CRM-062` :
	-- `postgres` porte `rolbypassrls`, donc `cards_figees()` — `SECURITY INVOKER` — lui rend
	-- l'ensemble GLOBAL, là où elle rend à chaque client ses seules affaires.
	update public.card_sequence_enrollments e
	   set status        = 'closed',
	       closed_reason = 'card_ineligible',
	       closed_at     = now()
	 where e.status = 'active'
	   and not exists (select 1 from public.cards_figees() f where f.card_id = e.card_id);

	-- --- 2 Fermer ce qu'une réponse a terminé — motif `reply` ----------------------------------
	-- L'ANCRE EST `created_at` ET NON `sent_at`, ET C'EST UNE MESURE QUI L'IMPOSE (§12.1) :
	-- `sent_at` est NULLE sur les quatre messages du seed. C'est la date que l'en-tête DÉCLARE, et
	-- rien n'oblige un correspondant à la renseigner ni à la renseigner juste. `created_at` est
	-- l'instant où le produit a VU le message.
	--
	-- LA BORNE EST `armed_at` ET NON `last_sent_at` (§12.6) : un message arrivé entre l'armement et
	-- le premier palier est une réponse à la conversation, même si aucune relance n'est encore
	-- partie. Prendre `last_sent_at` laisserait partir un premier palier chez quelqu'un qui avait
	-- déjà répondu.
	--
	-- AUCUN TRIGGER SUR `mail_messages` : la détection est LUE au passage, comme l'idempotence de
	-- `CRM-062` est lue et non stockée. Un trigger ferait de l'ingestion IMAP — chemin chaud tenu
	-- par `mail-sync` — le porteur d'une règle de relance.
	update public.card_sequence_enrollments e
	   set status        = 'closed',
	       closed_reason = 'reply',
	       closed_at     = now()
	 where e.status = 'active'
	   and exists (
	       select 1
	         from public.mail_messages m
	        where m.card_id    = e.card_id
	          and m.direction  = 'inbound'
	          and m.created_at > e.armed_at
	   );

	-- --- 3 Mettre en file le palier dû, UN SEUL par passage — §12.5 ----------------------------
	for v_inscription in
		select e.*
		  from public.card_sequence_enrollments e
		 where e.status = 'active'
		 order by e.armed_at
	loop
		-- LE PALIER DÛ : celui qui suit immédiatement le dernier expédié, et dont le délai — compté
		-- DEPUIS LE PALIER PRÉCÉDENT, ou depuis l'armement pour le premier (§11.4) — est écoulé.
		--
		-- L'unité est `interval '1 day'` et non le `floor` sur 86 400 secondes du §2.5 de
		-- `docs/SPEC-relances.md` : là-bas il s'agit de compter des jours RÉVOLUS pour les comparer
		-- à un seuil affiché ; ici, d'AJOUTER un délai à un instant. `interval` respecte les
		-- changements d'heure, ce qu'une arithmétique en secondes ne fait pas.
		select st.* into v_palier
		  from public.mail_sequence_steps st
		 where st.sequence_id = v_inscription.sequence_id
		   and st.position    = coalesce(v_inscription.last_position, 0) + 1
		   and now() >= coalesce(v_inscription.last_sent_at, v_inscription.armed_at)
		               + (st.delai_jours * interval '1 day');

		-- UN SEUL PALIER PAR PASSAGE (§12.5) : un job resté arrêté trois jours ne doit pas déverser
		-- trois messages d'un coup chez le destinataire. La cadence GLISSE — le palier suivant se
		-- compte depuis l'envoi RÉEL —, conséquence directe du délai relatif.
		continue when v_palier.id is null;

		select * into v_identite
		  from public.mail_outbound_identities i
		 where i.id = v_inscription.identity_id;

		-- LE CORPS EST COMPOSÉ PAR `public.rendre_modele_email`, JAMAIS RECOPIÉ. Elle est
		-- `SECURITY INVOKER` (mesuré, `prosecdef=false`) et `postgres` porte `rolbypassrls` : sous
		-- le job elle rend donc l'ensemble global, exactement comme `cards_figees()`. Le
		-- `p_identity_id` passé est celui de l'INSCRIPTION, de sorte que les variables
		-- d'expéditeur du §8.5 soient celles de l'adresse qui expédie réellement.
		select r.subject, r.body_text into v_rendu
		  from public.rendre_modele_email(
		         v_palier.template_id, v_inscription.card_id, null, v_inscription.identity_id) r;

		-- LE DESTINATAIRE EST L'ADRESSE DE L'AFFAIRE. Le sous-système la garantit non nulle : le
		-- refus (g) de l'armement l'a exigée, et `queue_outbound_email` l'exige aussi. Si elle a
		-- disparu depuis, le passage ÉCHOUE plutôt que d'expédier dans le vide — aucun `try/catch`
		-- vide, aucune valeur par défaut trompeuse (`CLAUDE.md` §18).
		perform app.mail_outbox_inserer(
			v_inscription.workspace_id,
			v_inscription.identity_id,
			v_inscription.card_id,
			null,
			array[(select c.email_local_part || '@' || w.inbound_domain
			         from public.cards c join public.workspaces w on w.id = c.workspace_id
			        where c.id = v_inscription.card_id)],
			'{}'::text[],
			v_rendu.subject,
			v_rendu.body_text,
			v_identite.signature_text,
			-- L'ACTEUR EST NUL (§9.5) : une relance automatique n'a pas d'auteur humain.
			null);

		update public.card_sequence_enrollments
		   set last_position = v_palier.position,
		       last_sent_at  = now()
		 where id = v_inscription.id;

		v_mises := v_mises + 1;

		-- --- 4 Fermer si le palier expédié était le dernier — motif `exhausted` -----------------
		select max(st.position) into v_dernier
		  from public.mail_sequence_steps st
		 where st.sequence_id = v_inscription.sequence_id;

		if v_palier.position >= v_dernier then
			update public.card_sequence_enrollments
			   set status        = 'closed',
			       closed_reason = 'exhausted',
			       closed_at     = now()
			 where id = v_inscription.id;
		end if;
	end loop;

	-- --- 5 Promotion de la cadence d'amorçage vers la cadence nominale -------------------------
	-- Démarrage observable du §3 de `docs/SPEC-scheduler.md`, repris tel quel. Un job QUOTIDIEN
	-- serait autrement invérifiable : une preuve froide attendrait jusqu'à vingt-quatre heures.
	--
	-- Mises en file et promotion sont dans la MÊME transaction : si `cron.alter_job` échoue, les
	-- messages de ce passage sont annulés et `cron.job_run_details` le dit.
	select jobid
	  into v_job_id
	  from cron.job
	 where jobname = 'p2enjoy-sequences-relance'
	   and username = 'postgres';

	if v_job_id is null then
		raise exception 'sequences_job_absent';
	end if;

	perform cron.alter_job(v_job_id, schedule => '41 3 * * *', database => 'postgres', active => true);

	return v_mises;
end;
$$;

alter function app.executer_sequences_relance() owner to postgres;

-- AUCUN CLIENT NE DÉCLENCHE UNE RELANCE, et c'est la fermeture du §4 de `docs/SPEC-scheduler.md`.
-- Les quatre rôles sont NOMMÉS : `revoke … from public` ne retire rien à un rôle nommé.
revoke all on function app.executer_sequences_relance()
	from public, anon, authenticated, service_role;

comment on function app.executer_sequences_relance() is
	'CRM-063 §12.9 — passage quotidien des séquences de relance. FERME D''ABORD, ENVOIE ENSUITE : '
	'envoyer avant de fermer ferait partir une relance chez quelqu''un qui a répondu la veille. '
	'Rend le nombre de messages RÉELLEMENT mis en file. Un seul palier par inscription et par '
	'passage : un job arrêté trois jours ne déverse pas trois messages d''un coup.';

-- =============================================================================================
-- 8. Le job quotidien — §12.9, docs/SPEC-scheduler.md §1 et §3
-- =============================================================================================
-- La minute 41 évite le heartbeat de `CRM-017` (minute 7) et les relances de `CRM-062` (minute 23).
--
-- `cron.schedule` portant un nom stable converge sur le même `jobid` et répare commande, base,
-- rôle, activation et cadence. La cadence d'amorçage de dix secondes est TRANSITOIRE : le premier
-- passage la promeut lui-même (section 7).

do $$
declare
	job_id bigint;
begin
	select cron.schedule(
		'p2enjoy-sequences-relance',
		'10 seconds',
		'select app.executer_sequences_relance();'
	) into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

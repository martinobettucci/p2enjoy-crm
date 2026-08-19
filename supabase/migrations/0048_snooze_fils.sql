-- @spec CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 2 c : le sommeil d'un
--       FIL de messagerie, sa règle, sa garde et sa trace
-- @spec docs/SPEC-cards.md §16.14 (le chapitre), §16.14.1 (les six mesures), §16.14.2 (ce qu'est
--       un fil, et pourquoi ce n'est pas une table), §16.14.3 (l'état est une ligne, son absence
--       est « éveillé »), §16.14.4 (`snooze_thread` et ses TROIS refus), §16.14.5 (`wake_thread`
--       et son idempotence), §16.14.6 (qui lit la ligne), §16.14.7 (ce qui n'est pas livré)
-- @spec docs/SPEC-cards.md §16.2 (ce que « en sommeil » signifie, et pourquoi aucun réveil
--       planifié n'est écrit), §16.3 (le patron des gardes de l'affaire)
-- @spec docs/SPEC-mail-subsystem.md §18.1 (qui voit quel message)
-- @spec docs/SPEC-permissions-rls.md §4.3 (règle de discrétion), §4.4 (une colonne constatée par
--       le serveur n'est pas offerte au client)
-- @spec docs/SCHEMA.md §7 (sous-système de messagerie), §9 (fonctions et RPC)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- L'énoncé de CRM-081 nomme « les fils ET les cards ». Les cards l'ont depuis la migration 44 ;
-- les fils n'avaient RIEN — MESURÉ le 2026-08-19, `information_schema.columns` ne rend aucune
-- colonne dont le nom porte `thread` dans tout le schéma `public`, et `public.threads` n'existe
-- pas. Le manque du §16.10 est donc constaté, non supposé.
--
-- Livré ici : la clé d'un fil, l'état de sommeil, ses deux gestes gardés, et la lecture de la
-- ligne.
--
-- Non livré, et nommé (§16.14.7) : toute surface — groupement des messages en fils dans l'inbox,
-- pastille, geste, filtre —, toute trace dans un journal, et toute donnée de démonstration
-- nouvelle. Le seed n'est PAS touché.
--
-- CE QUI N'EST PAS REPRIS DU PATRON DE LA TRANCHE 1, ET LA MESURE QUI L'INTERDIT : la section
-- « la colonne se ferme » du §16.7. MESURÉ, `authenticated` détient sur `public.mail_messages` le
-- privilège `SELECT` et lui seul. Il n'y a rien à fermer ; la symétrie serait trompeuse.
--
-- IDEMPOTENTE ET CONVERGENTE au sens d'INC-035 : la table et l'index sont créés « if not exists »,
-- les fonctions sont recréées, la politique est déposée puis reposée, et les privilèges se
-- rejouent sans erreur.

-- =============================================================================================
-- 1. La clé d'un fil — docs/SPEC-cards.md §16.14.2
-- =============================================================================================
-- Le premier élément de `References` est, par la RFC 5322, le message qui a ouvert la chaîne ; un
-- message qui n'en cite aucun EST cette racine. MESURÉ : les deux messages du seed portent
-- `references_ids` vide, donc le second cas est le cas courant, non un cas dégradé.
--
-- UNE FONCTION, ET NON UNE EXPRESSION RECOPIÉE. Elle sert l'index de la section 2, les deux
-- gardes des sections 5 et 6, et elle servira l'écran de la tranche suivante — qui devra
-- recalculer la clé tant qu'aucune colonne ne la porte (§16.14.2). Une définition, un seul endroit
-- où elle change.
--
-- `immutable` : elle ne lit rien et rend toujours la même valeur pour les mêmes arguments, ce que
-- l'index d'expression de la section 2 EXIGE.

create or replace function app.cle_fil(
	p_references_ids     text[],
	p_rfc822_message_id  text
) returns text
language sql
immutable
set search_path = ''
as $$
	select coalesce(p_references_ids[1], p_rfc822_message_id);
$$;

alter function app.cle_fil(text[], text) owner to postgres;

comment on function app.cle_fil(text[], text) is
	'CRM-081 — docs/SPEC-cards.md §16.14.2. Racine RFC 5322 d''un fil : le premier `References`, '
	'ou le `Message-ID` propre quand la chaîne est vide. `immutable`, condition de l''index '
	'd''expression de `mail_messages`.';

-- =============================================================================================
-- 2. L'index d'expression — docs/SPEC-cards.md §16.14.2
-- =============================================================================================
-- AUCUNE COLONNE GÉNÉRÉE SUR `mail_messages`, et le motif est écrit plutôt que sous-entendu : une
-- colonne déplacerait la liste des colonnes de la table, que plusieurs preuves du dépôt figent —
-- privilèges énumérés colonne par colonne, comptes de colonnes, types engendrés. Ce coût ne sert
-- AUCUNE règle de cette tranche. Il sera payé par la tranche qui groupera les messages à l'écran,
-- où la colonne sera réellement utile.
--
-- L'index porte le couple exact des deux gardes, `mail_messages_dedoublonnage` ayant établi que la
-- clé n'est unique qu'à l'intérieur d'un workspace (§16.14.1, mesure 5).

create index if not exists mail_messages_cle_fil_idx
	on public.mail_messages (workspace_id, app.cle_fil(references_ids, rfc822_message_id));

comment on index public.mail_messages_cle_fil_idx is
	'CRM-081 — docs/SPEC-cards.md §16.14.2. Sert le prédicat de `app.fil_lisible`, appelé par les '
	'deux gardes et par la politique de lecture de `mail_thread_snoozes`.';

-- =============================================================================================
-- 3. L'état de sommeil d'un fil — docs/SPEC-cards.md §16.14.3
-- =============================================================================================
-- UN FIL EST EN SOMMEIL SI SA LIGNE EXISTE ET QUE `snoozed_until` EST STRICTEMENT POSTÉRIEURE À
-- `now()` — le prédicat du §16.2, transposé sans changement. La sortie reste IMPLICITE : aucune
-- tâche planifiée n'est écrite, ici pas davantage que pour l'affaire.
--
-- `snoozed_until` est `not null` PAR CONTRAINTE DE COLONNE : une ligne sans échéance n'a pas de
-- sens que l'absence de ligne ne dise mieux. C'est la même raison qui fait SUPPRIMER la ligne au
-- réveil (section 6) plutôt que la vider.

create table if not exists public.mail_thread_snoozes (
	workspace_id  uuid        not null references public.workspaces(id) on delete cascade,
	thread_key    text        not null,
	snoozed_until timestamptz not null,
	snoozed_by    uuid                 references public.profiles(id)   on delete set null,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now(),
	constraint mail_thread_snoozes_pkey primary key (workspace_id, thread_key),
	-- Une clé blanche désignerait tous les fils sans racine à la fois : elle est refusée, et non
	-- rabattue silencieusement sur une valeur de repli qui mentirait sur ce qui a été demandé.
	constraint mail_thread_snoozes_cle_non_blanche check (btrim(thread_key) <> '')
);

comment on table public.mail_thread_snoozes is
	'CRM-081 — docs/SPEC-cards.md §16.14.3. Sommeil d''un FIL de messagerie. L''ABSENCE de ligne '
	'est « éveillé » : le réveil supprime, il ne vide pas. Écriture réservée à '
	'`public.snooze_thread` et `public.wake_thread` PAR LE PRIVILÈGE (§16.14.6).';

comment on column public.mail_thread_snoozes.thread_key is
	'CRM-081 — docs/SPEC-cards.md §16.14.2. Racine du fil, rendue par `app.cle_fil`. Unique dans '
	'son workspace seulement (mesure 5) : la clé primaire porte le couple.';

comment on column public.mail_thread_snoozes.snoozed_by is
	'CRM-081 — docs/SPEC-cards.md §16.14.3. Écrit PAR LA FONCTION, jamais offert au client. '
	'`on delete set null` : la suppression d''un profil ne doit pas réveiller un fil.';

drop trigger if exists mail_thread_snoozes_set_updated_at on public.mail_thread_snoozes;
create trigger mail_thread_snoozes_set_updated_at
	before update on public.mail_thread_snoozes
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 4. La lisibilité d'un fil — docs/SPEC-cards.md §16.14.4
-- =============================================================================================
-- AUCUN PRÉDICAT NOUVEAU N'EST INVENTÉ. MESURÉ : la politique `mail_messages_lecture` porte pour
-- tout `USING` l'expression que `app.peut_voir_message(uuid)` rend déjà telle quelle. La
-- lisibilité d'un fil est donc, exactement, l'existence d'un de ses messages que l'appelant lit.
--
-- `security definer` : la fonction doit interroger `mail_messages` SANS que la RLS ne s'y
-- applique deux fois, `app.peut_voir_message` portant déjà la décision. `stable` : elle ne lit que
-- la base, dans une même instruction.

create or replace function app.fil_lisible(
	p_workspace_id uuid,
	p_thread_key   text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.mail_messages m
		 where m.workspace_id = p_workspace_id
		   and app.cle_fil(m.references_ids, m.rfc822_message_id) = p_thread_key
		   and app.peut_voir_message(m.id)
	);
$$;

alter function app.fil_lisible(uuid, text) owner to postgres;

comment on function app.fil_lisible(uuid, text) is
	'CRM-081 — docs/SPEC-cards.md §16.14.4. Vrai si l''appelant lit AU MOINS UN message du fil. '
	'Même prédicat pour les deux gardes et pour la politique de lecture, afin que la ligne '
	'visible et le fil visible ne puissent jamais diverger.';

-- =============================================================================================
-- 5. `public.snooze_thread` — docs/SPEC-cards.md §16.14.4
-- =============================================================================================
-- TROIS REFUS, ET PAS QUATRE. Le §16.3 oppose `forbidden` à qui lit une affaire sans pouvoir
-- l'écrire, parce que `app.can_write_channel` existe et que le produit a défini ce droit. Sur un
-- fil de messagerie, AUCUN droit d'écriture n'est défini nulle part — MESURÉ, le client détient
-- `SELECT` et rien d'autre sur `mail_messages`. Inventer ici une seconde autorisation serait
-- trancher une question de produit que personne n'a posée. La règle retenue est celle que les
-- données portent déjà : qui lit le fil peut l'endormir.
--
-- `security definer` : la table n'accorde aucune écriture au client, et ses politiques ne
-- s'appliquent pas à son propriétaire — la fonction ne peut RIEN leur déléguer et vérifie
-- elle-même ce qu'elle a le droit de faire. `search_path` vidé, relations pleinement qualifiées.

drop function if exists public.snooze_thread(uuid, text, timestamptz);

create function public.snooze_thread(
	workspace   uuid,
	thread_key  text,
	until       timestamptz
) returns public.mail_thread_snoozes
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Recopiés avant tout usage : `workspace` et `thread_key` sont aussi des noms de colonnes des
	-- relations écrites plus bas, et PL/pgSQL refuse une référence ambiguë (`42702`) plutôt que
	-- d'en choisir une. Même précaution qu'à `snooze_card`.
	v_workspace  uuid        := workspace;
	v_cle        text        := thread_key;
	v_until      timestamptz := until;
	v_ligne      public.mail_thread_snoozes%rowtype;
begin
	-- --- 1 Le fil existe et l'appelant en lit au moins un message -----------------------------
	-- Un fil invisible est ABSENT, jamais « interdit » : répondre « interdit » confirmerait son
	-- existence à qui n'a pas le droit de la connaître (docs/SPEC-permissions-rls.md §4.3).
	--
	-- `P0001` par défaut, donc `400`. `P0002` serait rendu `500` par PostgREST et lu comme une
	-- panne du produit.
	if v_cle is null or not app.fil_lisible(v_workspace, v_cle) then
		raise exception 'thread_not_found';
	end if;

	-- --- 2 L'échéance est fournie -------------------------------------------------------------
	-- Une mise en sommeil sans échéance n'aurait pas de ligne où s'écrire : `snoozed_until` est
	-- `not null` (§16.14.3), et le refus le dit AVANT que la contrainte ne le dise moins bien.
	if v_until is null then
		raise exception 'snooze_date_required';
	end if;

	-- --- 3 L'échéance est future --------------------------------------------------------------
	-- Le prédicat du §16.14.3 rendrait le fil immédiatement hors sommeil : l'écriture serait
	-- acceptée et sans effet observable, succès simulé que CLAUDE.md §18 proscrit.
	if v_until <= now() then
		raise exception 'snooze_date_in_past';
	end if;

	-- Un fil DÉJÀ en sommeil est accepté : reporter une échéance est un geste ordinaire (§16.3),
	-- et `snoozed_by` devient celui qui a reporté. `updated_at` est posée par le trigger de la
	-- section 3.
	--
	-- `on conflict ON CONSTRAINT`, et non `on conflict (workspace_id, thread_key)` : MESURÉ, la
	-- seconde forme échoue en `42702`, le paramètre `thread_key` — dont le nom EST le contrat
	-- d'API de PostgREST — masquant la colonne du même nom dans la liste d'inférence, là où la
	-- recopie en variable suffit partout ailleurs. Nommer la contrainte lève l'ambiguïté sans
	-- toucher au contrat.
	insert into public.mail_thread_snoozes as s (workspace_id, thread_key, snoozed_until, snoozed_by)
	values (v_workspace, v_cle, v_until, (select auth.uid()))
	on conflict on constraint mail_thread_snoozes_pkey do update
		set snoozed_until = excluded.snoozed_until,
		    snoozed_by    = excluded.snoozed_by
	returning s.* into v_ligne;

	return v_ligne;
end;
$$;

alter function public.snooze_thread(uuid, text, timestamptz) owner to postgres;

comment on function public.snooze_thread(uuid, text, timestamptz) is
	'CRM-081 — docs/SPEC-cards.md §16.14.4. Seul chemin par lequel un fil entre en sommeil. '
	'Refus, dans l''ordre où la garde les oppose : thread_not_found, snooze_date_required, '
	'snooze_date_in_past. PAS de `forbidden` : aucun droit d''écriture n''est défini sur un fil '
	'(mesure 3), et en inventer un trancherait une question de produit que personne n''a posée.';

-- =============================================================================================
-- 6. `public.wake_thread` — docs/SPEC-cards.md §16.14.5
-- =============================================================================================
-- LE RÉVEIL SUPPRIME LA LIGNE, IL NE LA VIDE PAS. Une ligne réveillée ne porterait plus qu'une
-- échéance nulle interdite par sa propre contrainte, ou une échéance passée que le prédicat écarte
-- déjà : dans les deux cas une coquille que toute lecture devrait ensuite exclure par une seconde
-- condition. L'absence de ligne est la représentation honnête de « éveillé ».
--
-- Conséquence ASSUMÉE et nommée au §16.14.7 : le réveil efface la trace du sommeil, et rien ne la
-- recueille ailleurs, faute d'un journal de fil.

drop function if exists public.wake_thread(uuid, text);

create function public.wake_thread(
	workspace   uuid,
	thread_key  text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_workspace uuid := workspace;
	v_cle       text := thread_key;
	v_retirees  integer;
begin
	-- Réveiller un fil qu'on ne lit pas n'est pas plus permis que l'endormir, et le refus ne dit
	-- pas davantage : même garde, même message.
	if v_cle is null or not app.fil_lisible(v_workspace, v_cle) then
		raise exception 'thread_not_found';
	end if;

	delete from public.mail_thread_snoozes s
	 where s.workspace_id = v_workspace
	   and s.thread_key   = v_cle;

	get diagnostics v_retirees = row_count;

	-- Un réveil sans sommeil N'EST PAS une erreur du demandeur (§16.4) : rendre `false` dit ce qui
	-- s'est passé sans le lui reprocher, et un appelant qui n'en a que faire peut l'ignorer.
	return v_retirees > 0;
end;
$$;

alter function public.wake_thread(uuid, text) owner to postgres;

comment on function public.wake_thread(uuid, text) is
	'CRM-081 — docs/SPEC-cards.md §16.14.5. IDEMPOTENTE : rend `true` si une ligne a réellement '
	'été retirée, `false` sinon, et ne refuse que `thread_not_found`.';

-- =============================================================================================
-- 7. Qui lit la ligne — docs/SPEC-cards.md §16.14.6
-- =============================================================================================
-- La table naît sans aucun privilège : une table neuve n'en accorde à personne. La fermeture en
-- écriture est donc ACQUISE, et non reprise — c'est le cas facile, à la différence du §16.7 qui
-- devait retirer un privilège déjà accordé.
--
-- Les deux fonctions des sections 5 et 6 sont le seul chemin d'écriture, et l'être PAR LE
-- PRIVILÈGE vaut mieux que l'être par une politique qu'on pourrait élargir sans y penser.

alter table public.mail_thread_snoozes enable row level security;

grant select on public.mail_thread_snoozes to authenticated;
grant all privileges on public.mail_thread_snoozes to service_role;

drop policy if exists mail_thread_snoozes_lecture on public.mail_thread_snoozes;
create policy mail_thread_snoozes_lecture
	on public.mail_thread_snoozes
	for select
	to authenticated
	using (app.fil_lisible(workspace_id, thread_key));

comment on policy mail_thread_snoozes_lecture on public.mail_thread_snoozes is
	'CRM-081 — docs/SPEC-cards.md §16.14.6. Le MÊME prédicat que les deux gardes, afin que la '
	'ligne visible et le fil visible ne puissent jamais diverger.';

-- Les deux RPC sont appelables par un membre authentifié ; leurs gardes décident du reste.
grant execute on function public.snooze_thread(uuid, text, timestamptz) to authenticated;
grant execute on function public.wake_thread(uuid, text)                to authenticated;

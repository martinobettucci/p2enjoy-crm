-- @spec CRM-064 (docs/BACKLOG.md) — tranche 2 : la notification
-- @spec docs/SPEC-notifications.md §13 à §16
-- @spec docs/SPEC-permissions-rls.md §3.2, §7
-- @spec docs/SCHEMA.md §8 ; docs/PROD_MIGRATIONS.md §3
--
-- MESURÉ le 2026-08-26, avant cette migration (docs/SPEC-notifications.md §12) :
--
--   trigger SECURITY INVOKER qui écrit dans une table fermée à `authenticated`
--     => 42501 / permission denied for table          (M9)
--   le MÊME trigger en SECURITY DEFINER de propriétaire `postgres`
--     => insertion acceptée                            (M10)
--
--   POST /rest/v1/card_comment_mentions {"comment_id":"…0d3","profile_id":"…011"}
--     => 201 — l'AUTO-MENTION est acceptée par la tranche 1 (M5)
--
--   une mention SURVIT à la pierre tombale de son commentaire, dont le corps est vidé (M7)
--
-- Ces trois mesures décident respectivement : la forme du trigger (section 3), le cas qu'il
-- écarte (section 3.2), et le fait que la charge utile ne porte AUCUN contenu (section 2.3).
--
-- CETTE MIGRATION NE REJUGE RIEN DE LA TRANCHE 1. Elle ajoute une CONSÉQUENCE à la pose d'une
-- mention ; la règle qui décide si une mention est posée reste celle de la migration 0063, et
-- `0061_mentions_commentaires.test.sql` doit rester vert sans une modification.

-- =============================================================================================
-- 0. Convergence des contraintes — le mécanisme des migrations 0015, 0019 et 0063
-- =============================================================================================
-- Le `migrations-runner` rejoue le répertoire entier à chaque démarrage : tout ce qui suit doit
-- être rejouable. `alter table … add constraint` rend 42710 sur une contrainte déjà posée, et
-- `if not exists` n'existe pas pour les contraintes.

create or replace function app.migration_0064_converger_contrainte(
	table_cible     text,
	nom_contrainte  text,
	definition      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	definition_actuelle text;
begin
	select pg_catalog.pg_get_constraintdef(c.oid)
	  into definition_actuelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = table_cible::regclass
	   and c.conname  = nom_contrainte;

	if definition_actuelle is not distinct from definition then
		return;
	end if;

	if definition_actuelle is not null then
		execute format('alter table %s drop constraint %I', table_cible, nom_contrainte);
	end if;

	execute format('alter table %s add constraint %I %s', table_cible, nom_contrainte, definition);
end;
$$;

alter function app.migration_0064_converger_contrainte(text, text, text) owner to postgres;

comment on function app.migration_0064_converger_contrainte(text, text, text) is
	'CRM-064 — outil de migration, rejouable. Pose la contrainte si elle manque, la remplace si '
	'sa définition diffère, ne fait rien si elle est déjà conforme.';

-- =============================================================================================
-- 1. `public.notifications` — docs/SPEC-notifications.md §13
-- =============================================================================================
-- UNE CLÉ PRIMAIRE TECHNIQUE, ET C'EST L'INVERSE DE LA MENTION. Le §4.1 refuse une colonne `id`
-- à `card_comment_mentions` parce qu'une mention EST le fait que deux entités sont liées. Une
-- notification n'est pas un fait : c'est un MESSAGE, une chose qui a sa propre existence, qu'on
-- lit, qu'on marque, qu'on compte. Deux messages identiques adressés à la même personne à deux
-- instants sont deux messages ; une clé naturelle prétendrait le contraire.
--
-- AUCUNE COLONNE `updated_at` : `read_at` est la seule mutation ouverte, et elle porte sa propre
-- date. Même écart assumé aux conventions générales que `card_comments` (INC-025).

create table if not exists public.notifications (
	id              uuid        not null default gen_random_uuid(),
	-- DÉRIVÉE de la mention par le trigger de la section 3, jamais décidée par le client, et
	-- tenue en outre par la clé étrangère composite ci-dessous.
	workspace_id    uuid        not null,
	recipient_id    uuid        not null,
	type            text        not null,
	-- NULLABLE, et c'est délibéré (§13.5) : une notification de mention parle toujours d'une
	-- affaire, une notification future peut n'en désigner aucune.
	subject_card_id uuid,
	payload         jsonb       not null default '{}'::jsonb,
	read_at         timestamptz,
	created_at      timestamptz not null default now(),
	primary key (id)
);

comment on table public.notifications is
	'CRM-064 — docs/SPEC-notifications.md §13. Un message adressé à une personne, produit par un '
	'fait. Aucun client ne peut en écrire : le seul chemin est le trigger de la section 3 '
	'(refus DOUBLE — ni privilège `INSERT`, ni politique). Aucune suppression non plus : la '
	'rétention est une décision de produit que rien ne porte encore (§15.4, point ouvert n° 1).';

comment on column public.notifications.recipient_id is
	'CRM-064 — docs/SPEC-notifications.md §13.2. La personne à qui le message s''adresse, et la '
	'seule qui le lise : ni un collègue, ni un administrateur du workspace. La boîte de '
	'quelqu''un n''est pas une donnée d''exploitation (§16.1).';

comment on column public.notifications.type is
	'CRM-064 — docs/SPEC-notifications.md §13.3. Une seule valeur aujourd''hui, et la colonne '
	'existe pour cela : elle est la GARDE qui empêche d''écrire un type inventé. Le `check` est '
	'fermé sur `mention` et se REMPLACE — jamais ne s''élargit par précaution — quand une source '
	'nouvelle est réellement livrée et prouvée.';

comment on column public.notifications.subject_card_id is
	'CRM-064 — docs/SPEC-notifications.md §13.5. L''affaire dont le message parle. Ce n''est PAS '
	'une redondance du `payload` : c''est la colonne sur laquelle la politique de LECTURE '
	's''appuie, une politique ne pouvant raisonnablement extraire un uuid d''un jsonb pour le '
	'passer à une fonction d''accès.';

comment on column public.notifications.payload is
	'CRM-064 — docs/SPEC-notifications.md §13.4. De quoi DÉSIGNER, jamais de quoi lire : ni le '
	'corps du commentaire, ni le titre de la card, ni le nom de l''auteur. MESURÉ (M7) : une '
	'mention survit à la pierre tombale de son commentaire, dont le corps est réellement vidé. '
	'Un instantané du texte survivrait donc à son effacement, et la suppression d''un '
	'commentaire cesserait d''être une suppression.';

comment on column public.notifications.read_at is
	'CRM-064 — docs/SPEC-notifications.md §15.1. Nul tant que le message n''est pas lu. Le seul '
	'geste ouvert au destinataire, dans les DEUX sens — un état à deux valeurs qu''on ne peut '
	'parcourir que dans un sens est un compteur, pas un état. La date est posée par la BASE, '
	'jamais par le client (trigger de la section 4, mécanisme de la décision 95).';

-- --- 1.1 Le `check` de `type` -----------------------------------------------------------------
-- docs/SPEC-notifications.md §13.3. Fermé sur la seule source que la tranche livre. L'élargir
-- pour des sources qui n'existent pas autoriserait des lignes que rien ne produit et qu'aucune
-- preuve n'éprouve — c'est cela, l'anticipation que CLAUDE.md §1 interdit.

select app.migration_0064_converger_contrainte(
	'public.notifications', 'notifications_type_check', $$CHECK ((type = ANY (ARRAY['mention'::text])))$$);

-- --- 1.2 Les trois clés étrangères ------------------------------------------------------------
-- docs/SPEC-notifications.md §13.6. Le mécanisme de la décision 95 : le moteur vérifie des deux
-- côtés, y compris contre un `insert` direct qu'aucune garde applicative ne verrait passer.
--
-- LA TROISIÈME EST COMPOSITE, et pour la raison du §4.2 : elle interdit qu'une notification
-- désigne une card vivant dans un AUTRE espace qu'elle, MÊME PAR LA CLÉ DE SERVICE, qui
-- contourne la RLS mais pas les contraintes. `cards` porte déjà `UNIQUE (id, workspace_id)`
-- (migration 0015 §1) : rien à ajouter.
--
-- Une clé composite dont une colonne est NULL n'est PAS vérifiée (`MATCH SIMPLE`) : une
-- notification sans card passe, et c'est exactement ce que le §13.5 demande.
--
-- AUCUNE CLÉ ÉTRANGÈRE VERS `card_comment_mentions`, et c'est une DÉCISION (§14.4) : retirer une
-- mention n'efface pas la notification. Le retrait d'une mention est « la correction d'une erreur
-- de frappe » (§7.1) ; une notification est un message DÉJÀ DÉLIVRÉ, possiblement déjà lu, et
-- l'effacer réécrirait le passé du destinataire. Le dépôt tranche déjà ainsi pour le propos d'un
-- compte supprimé (CRM-022, INC-014). La règle d'accès la rattrape autrement : la politique de
-- lecture porte `app.can_read_card(subject_card_id)`.

select app.migration_0064_converger_contrainte(
	'public.notifications', 'notifications_recipient_id_fkey',
	'FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE');

select app.migration_0064_converger_contrainte(
	'public.notifications', 'notifications_workspace_id_fkey',
	'FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE');

select app.migration_0064_converger_contrainte(
	'public.notifications', 'notifications_subject_card_id_workspace_id_fkey',
	'FOREIGN KEY (subject_card_id, workspace_id) REFERENCES public.cards(id, workspace_id) ON DELETE CASCADE');

-- --- 1.3 Les deux index -----------------------------------------------------------------------
-- docs/SPEC-notifications.md §13.7. Le second est PARTIEL, et c'est ce qui le rend petit : il
-- n'indexe que les lignes non lues, fraction qui décroît avec l'usage, là où un index total
-- croîtrait indéfiniment pour servir une question qui ne porte que sur la queue.

create index if not exists notifications_recipient_id_created_at_idx
	on public.notifications (recipient_id, created_at desc);

create index if not exists notifications_recipient_id_non_lues_idx
	on public.notifications (recipient_id) where read_at is null;

-- =============================================================================================
-- 2. La production : de la mention au message — docs/SPEC-notifications.md §14
-- =============================================================================================

-- --- 2.1 `SECURITY DEFINER`, et pourquoi la tranche 2 diverge de la tranche 1 ------------------
-- Le trigger de la migration 0063 est `SECURITY INVOKER` par DISCRÉTION, pour qu'un commentaire
-- fermé et un commentaire inexistant rendent le même refus. Celui-ci est `SECURITY DEFINER`, et
-- la divergence n'est pas une inconstance : les deux ne font pas la même chose. Le premier LIT
-- POUR JUGER — ce qu'il ne voit pas doit lui rester caché. Le second ÉCRIT POUR LE COMPTE D'UN
-- TIERS — le destinataire n'a rien demandé, et l'appelant n'a aucun droit sur sa boîte.
--
-- ET CE N'EST PAS UN RAISONNEMENT, C'EST UNE MESURE (§12, M9 et M10) :
--
--   trigger SECURITY INVOKER  => 42501 / permission denied for table  (l'insertion ÉCHOUE)
--   trigger SECURITY DEFINER  => insertion acceptée
--
-- En INVOKER, il s'exécuterait sous `authenticated`, qui n'a AUCUN privilège `INSERT` sur cette
-- table (section 5) — et qui ne doit pas en avoir, sinon un client s'écrirait des messages, ou
-- pire, en écrirait à quelqu'un d'autre. La production serait refusée, et LA POSE DE LA MENTION
-- ÉCHOUERAIT AVEC ELLE, les deux étant dans la même transaction.
--
-- `AFTER`, jamais `BEFORE` : ce trigger ne modifie pas la mention, il en CONSÉQUENCE une autre
-- ligne. En `BEFORE`, la notification naîtrait avant que la mention ne soit acquise — avant,
-- notamment, que les clés étrangères de la migration 0063 n'aient parlé.

create or replace function app.notifications_apres_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card   uuid;
	v_auteur uuid;
begin
	select cc.card_id, cc.author_id
	  into v_card, v_auteur
	  from public.card_comments cc
	 where cc.id = new.comment_id;

	-- UNE AUTO-MENTION NE PRODUIT AUCUNE NOTIFICATION — docs/SPEC-notifications.md §14.3.
	--
	-- LE CAS EST RÉEL, ET M5 LE MESURE : l'auto-mention est acceptée par la tranche 1, avec le
	-- jeton réel, sur son propre commentaire. Ce n'est pas un défaut — la règle d'éligibilité
	-- demande que le destinataire puisse LIRE l'affaire, et l'auteur le peut toujours. Mais une
	-- notification n'est pas un fait, c'est un MESSAGE : se prévenir soi-même de ce qu'on vient
	-- d'écrire n'est pas une information, c'est du bruit dans la seule liste où le bruit se paie
	-- en confiance.
	--
	-- LA COMPARAISON PORTE SUR `author_id`, ET JAMAIS SUR `auth.uid()`. La politique
	-- `card_comment_mentions_insertion` exige déjà que l'appelant SOIT l'auteur, si bien que les
	-- deux coïncident PAR LA VRAIE ROUTE. Mais la clé de service contourne la RLS — pas les
	-- triggers — et `auth.uid()` y est NUL : comparer à l'appelant produirait, par ce chemin,
	-- une notification que la vraie route n'aurait pas produite. Le seed et les harnais
	-- empruntent précisément ce chemin.
	--
	-- LA MENTION RESTE POSÉE : la tranche 1 n'est pas rejugée. Le fait est enregistré, seul le
	-- message ne l'est pas.
	if v_auteur is not null and v_auteur = new.profile_id then
		return null;
	end if;

	-- `workspace_id` est REPRIS de la mention, jamais relu : la tranche 1 l'a dérivé du
	-- commentaire et sa clé composite le tient. Le relire ouvrirait la possibilité qu'il diverge.
	insert into public.notifications
		(workspace_id, recipient_id, type, subject_card_id, payload, created_at, read_at)
	values (
		new.workspace_id,
		new.profile_id,
		'mention',
		v_card,
		jsonb_build_object('comment_id', new.comment_id, 'author_id', v_auteur),
		now(),
		null
	);

	return null;
end;
$$;

alter function app.notifications_apres_mention() owner to postgres;

comment on function app.notifications_apres_mention() is
	'CRM-064 — docs/SPEC-notifications.md §14. Produit LA notification d''une mention. '
	'SECURITY DEFINER par NÉCESSITÉ, et c''est MESURÉ (§12, M9/M10) : en INVOKER l''insertion '
	'est refusée par 42501, `authenticated` n''ayant aucun privilège sur cette table — et la '
	'pose de la mention échouerait avec elle. Une AUTO-MENTION ne produit rien, la comparaison '
	'portant sur `author_id` et jamais sur `auth.uid()`, nul sous la clé de service.';

drop trigger if exists notifications_apres_mention on public.card_comment_mentions;
create trigger notifications_apres_mention
	after insert on public.card_comment_mentions
	for each row execute function app.notifications_apres_mention();

-- AUCUNE CONVERGENCE PROPRE À CE TRIGGER, et c'est délibéré (§14.5) : poser deux fois la même
-- mention est impossible, la clé primaire `(comment_id, profile_id)` de la migration 0063 le
-- refuse. Retirer une mention puis la reposer produit, elle, une SECONDE notification — et c'est
-- correct : c'est un second geste, à un second instant.

-- =============================================================================================
-- 3. La date de lecture est posée par la BASE — docs/SPEC-notifications.md §15.1
-- =============================================================================================
-- Mécanisme de la décision 95, déjà appliqué au `created_at` de la mention : une date antidatée
-- fausserait l'ordre de lecture et rendrait le compteur de non-lues incohérent avec ce que
-- l'écran affiche. Envoyer `null` RESTE `null` — c'est le « marquer non lu ».
--
-- `SECURITY INVOKER` : il ne lit ni n'écrit rien d'autre que la ligne qu'on lui passe.

create or replace function app.notifications_avant_maj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if new.read_at is not null then
		new.read_at := now();
	end if;
	return new;
end;
$$;

comment on function app.notifications_avant_maj() is
	'CRM-064 — docs/SPEC-notifications.md §15.1. Impose la date du geste : toute valeur non nulle '
	'envoyée est remplacée par `now()`. `null` reste `null` — marquer non lu. Les autres colonnes '
	'n''ont pas besoin d''être gelées ici : le privilège de colonne `grant update (read_at)` les '
	'ferme déjà, et le refus est un 42501 (MESURÉ, §12 M11).';

drop trigger if exists notifications_avant_maj on public.notifications;
create trigger notifications_avant_maj
	before update on public.notifications
	for each row execute function app.notifications_avant_maj();

-- =============================================================================================
-- 4. Refus par défaut, puis politiques — docs/SPEC-notifications.md §16
-- =============================================================================================
-- RLS activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) : même
-- le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.notifications enable row level security;

-- --- 4.1 Lecture ------------------------------------------------------------------------------
-- DEUX CONDITIONS.
--
-- La première est celle qu'on attend : mes notifications sont à moi. Personne d'autre — ni un
-- collègue, ni un administrateur du workspace.
--
-- LA SECONDE TRANCHE LE POINT OUVERT N° 3 DU §10. Elle DÉLÈGUE à `app.can_read_card`, qui existe
-- déjà et que la migration 0063 vient de généraliser : la règle d'accès n'a TOUJOURS QU'UNE SEULE
-- ÉCRITURE. Un prédicat qui relirait `channel_members` ici serait exactement la seconde écriture
-- que le §5.3 a refusée. Un destinataire dont le droit retombe à `none` CESSE DE VOIR la
-- notification, sans qu'aucune ligne ne soit détruite, et la revoit si le droit revient.
--
-- Le `is null` traite le cas d'une notification sans affaire — aucune aujourd'hui, mais la
-- colonne est nullable (§13.5) — plutôt que de le laisser tomber dans un NULL que le moteur
-- interpréterait comme faux.
--
-- Accordée à `anon` pour que le refus soit ZÉRO LIGNE et non une erreur de privilège
-- (docs/SPEC-permissions-rls.md §3.2) : `auth.uid()` étant nul, le prédicat est faux.

drop policy if exists notifications_lecture on public.notifications;
create policy notifications_lecture
	on public.notifications
	for select
	to anon, authenticated
	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
	);

comment on policy notifications_lecture on public.notifications is
	'CRM-064 — docs/SPEC-notifications.md §16.1. Mes notifications sont à moi, et elles suivent '
	'l''accès à l''affaire dont elles parlent : la seconde condition DÉLÈGUE à '
	'`app.can_read_card`, si bien qu''une perte d''accès masque la notification sans détruire '
	'aucune ligne (§14.4). Accordée à `anon` pour que le refus soit ZÉRO LIGNE.';

-- --- 4.2 Marquage lu / non lu -----------------------------------------------------------------
-- Le MÊME prédicat, en `USING` et en `WITH CHECK`. Sans le second, un destinataire pourrait faire
-- sortir une ligne de son propre périmètre. Le privilège de colonne (section 5) le rend déjà
-- impossible, `recipient_id` n'étant pas modifiable ; le `WITH CHECK` est la SECONDE barrière, et
-- le dépôt en pose systématiquement deux.

drop policy if exists notifications_marquage on public.notifications;
create policy notifications_marquage
	on public.notifications
	for update
	to authenticated
	using (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
	)
	with check (
		recipient_id = (select auth.uid())
		and (subject_card_id is null or app.can_read_card(subject_card_id))
	);

comment on policy notifications_marquage on public.notifications is
	'CRM-064 — docs/SPEC-notifications.md §16.1. Le destinataire marque SA notification lue ou '
	'non lue. Un tiers ne reçoit pas d''erreur : le `USING` filtre, et son `PATCH` ne touche '
	'aucune ligne. Le `WITH CHECK` est la seconde barrière contre une sortie de périmètre.';

-- --- 4.3 Aucune politique `for insert`, aucune politique `for delete` -------------------------
-- docs/SPEC-notifications.md §15.3 et §15.4.
--
-- INSERTION : une notification se PRODUIT, elle ne se demande pas. Le seul chemin est le trigger
-- de la section 2. Le refus est DOUBLE — aucun privilège en section 5, aucune politique ici —,
-- comme celui de la mise à jour d'une mention (décision 96) : sans les deux, on ne saurait pas
-- lequel refuse, et la dégradation du harnais ne pourrait pas éprouver la seconde barrière en
-- relâchant la première.
--
-- SUPPRESSION : ce n'est pas une omission, c'est le périmètre. Vider une liste est une décision
-- de RÉTENTION — au bout de combien de temps ? avec quel effet sur le compteur ? avec ou sans
-- archive ? — qu'aucune mesure ne donne et qu'aucun document du dépôt ne porte. Point ouvert
-- n° 1 du §18.

-- =============================================================================================
-- 5. Privilèges — docs/SPEC-notifications.md §15.2
-- =============================================================================================
-- Le `revoke all` est écrit AVANT les `grant`, et c'est la décision 134 : l'image Supabase pose
-- un `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout, nommément, à `anon` et
-- `authenticated` sur toute table nouvelle. Sans ce `revoke`, il n'y aurait ni refus
-- d'insertion, ni refus de suppression, ni colonnes figées. Un rejeu RÉPARE en outre un
-- privilège relâché à la main (décision 57).
--
-- `grant update (read_at)` SEUL FIGE TOUTES LES AUTRES COLONNES, et M11 le mesure sur
-- `card_comments` : un `PATCH` sur une colonne non accordée rend 403 / 42501 — un refus de
-- PRIVILÈGE, pas un silence. `type`, `payload`, `recipient_id`, `subject_card_id`,
-- `workspace_id` et `created_at` sont donc fermés sans qu'aucune politique ne s'en occupe.

revoke all on public.notifications from anon, authenticated;

grant select           on public.notifications to anon;
grant select           on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all privileges   on public.notifications to service_role;

-- =============================================================================================
-- 6. LA TABLE N'EST PAS PUBLIÉE AU TEMPS RÉEL — docs/SPEC-notifications.md §16.3
-- =============================================================================================
-- Même motif qu'au §7.3, et il tient toujours : rien ne s'y abonne. La cloche, la liste et
-- l'abonnement `Realtime` sont la tranche 3, qui publiera la table DANS LE MÊME CHANGEMENT que
-- l'écran qui l'écoute. Publier une table que personne n'écoute serait poser une surface
-- d'autorisation sans preuve — le temps réel évalue la politique `SELECT` de chaque abonné, et
-- c'est une propriété qui se prouve, pas qui s'ajoute par précaution.
--
-- MESURÉ le 2026-08-26 (§12, M3) : seule `card_comments` est publiée. L'absence est FIGÉE par une
-- assertion pgTAP.

-- @spec CRM-064 (docs/BACKLOG.md) — tranche 1 : la mention en base
-- @spec docs/SPEC-notifications.md §3 à §7
-- @spec docs/SPEC-cards.md §13.1, §13.2 (ce que CRM-043 avait écarté)
-- @spec docs/SPEC-permissions-rls.md §2.2, §3.3, §3.5, §7
-- @spec docs/SCHEMA.md §5 ; docs/PROD_MIGRATIONS.md §3
--
-- MESURÉ le 2026-08-26, avant cette migration (docs/SPEC-notifications.md §2) :
--
--   POST /rest/v1/card_comments {"card_id":"…0c5","body":"…",
--                                "mentions":["00000000-0000-4000-8000-00000000dead"]}
--   => 201, mentions = {00000000-0000-4000-8000-00000000dead}
--
--   POST /rest/v1/card_comments {"card_id":"…0c1","body":"…","mentions":["…013"]}
--   => 201, alors que …013 n'a AUCUN accès au channel de cette card
--
-- `card_comments.mentions` est donc **ouverte à l'insertion** — le privilège `INSERT` de la table
-- est de table (migration 0015 §7, décision 140) — et ne porte NI intégrité référentielle (INC-033)
-- NI règle d'éligibilité. Le `PATCH`, lui, rend bien 403/42501 : la colonne est fermée en mise à
-- jour seulement.
--
-- Cette migration remplace la colonne par une RELATION, comme CRM-018 l'a fait pour
-- `workflow_transitions.require_fields` (décision 262, migration 0019), et donne à la mention la
-- règle d'accès qui lui manquait — écrite UNE SEULE FOIS (section 2).

-- =============================================================================================
-- 0. Convergence des contraintes — le mécanisme des migrations 0015 et 0019
-- =============================================================================================
-- Le `migrations-runner` rejoue le répertoire entier à chaque démarrage : tout ce qui suit doit
-- être rejouable. `alter table … add constraint` rend 42710 sur une contrainte déjà posée, et
-- `if not exists` n'existe pas pour les contraintes.

create or replace function app.migration_0063_converger_contrainte(
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

alter function app.migration_0063_converger_contrainte(text, text, text) owner to postgres;

comment on function app.migration_0063_converger_contrainte(text, text, text) is
	'CRM-064 — outil de migration, rejouable. Pose la contrainte si elle manque, la remplace si '
	'sa définition diffère, ne fait rien si elle est déjà conforme.';

-- =============================================================================================
-- 1. L'unicité que `card_comments` devait offrir, et qui manquait
-- =============================================================================================
-- docs/SPEC-notifications.md §2, mesures M3 et M4. Sonde créée puis annulée le 2026-08-26 :
--
--   create table sonde (comment_id uuid, workspace_id uuid,
--     foreign key (comment_id, workspace_id) references public.card_comments (id, workspace_id));
--   ERROR:  there is no unique constraint matching given keys for referenced table "card_comments"
--
-- Exactement l'erreur de la décision 124 sur `cards`, et celle que la migration 0015 §1 a levée
-- pour le couple `(id, workspace_id)` de CETTE table. Le geste est le même, refait pour l'autre
-- couple.
--
-- ELLE NE CHANGE AUCUN COMPORTEMENT. `id` étant déjà clé primaire, le couple était déjà unique ;
-- elle rend seulement la relation exprimable.

select app.migration_0063_converger_contrainte(
	'public.card_comments', 'card_comments_id_workspace_id_key', 'UNIQUE (id, workspace_id)');

comment on constraint card_comments_id_workspace_id_key on public.card_comments is
	'CRM-064 — docs/SPEC-notifications.md §4.2. Unicité redondante, exigée par la clé étrangère '
	'composite de `card_comment_mentions` : sans elle, « there is no unique constraint matching '
	'given keys for referenced table "card_comments" » — MESURÉ. Aucun comportement ne change.';

-- =============================================================================================
-- 2. LA RÈGLE D'ACCÈS, GÉNÉRALISÉE PAR UN PARAMÈTRE — docs/SPEC-notifications.md §5
-- =============================================================================================
-- L'éligibilité d'une mention porte sur un TIERS — « cette personne-là peut-elle lire cette
-- card ? » —, alors que les onze fonctions du schéma `app` jugent toutes l'APPELANT, par
-- `auth.uid()` directement ou par `app.workspace_role`.
--
-- ---------------------------------------------------------------------------------------------
-- DÉLÉGATION, ET JAMAIS SECONDE ÉCRITURE DE LA RÈGLE.
-- ---------------------------------------------------------------------------------------------
-- Un prédicat neuf qui relirait `workspace_members`, `track_members` et `channel_members` pour le
-- profil visé aurait donné DEUX écritures de la même règle. Deux écritures de la même règle
-- divergent au premier niveau de droit ajouté — c'est ce que la décision de CRM-063 sous-tranche
-- 4c a refusé pour sa RPC de réordonnancement.
--
-- Les quatre fonctions existantes deviennent donc des DÉLÉGATIONS D'UNE LIGNE vers leur variante
-- paramétrée : `f(x) := f_pour(x, (select auth.uid()))`. `app.resolve_access` — qui porte la règle
-- elle-même, « le plus spécifique gagne », `admin` toujours en écriture, `NULL` distinct de
-- `'none'` — n'est PAS touchée.
--
-- `app.resolve_track_access` et `app.can_write_channel` ne sont PAS généralisées : l'éligibilité
-- porte sur la LECTURE d'une CARD, jamais sur un track seul ni sur l'écriture. Les généraliser
-- « pendant qu'on y est » élargirait la surface de sécurité modifiée sans qu'aucune ligne du
-- produit les appelle (CLAUDE.md §1).
--
-- LA PREUVE DE NON-RÉGRESSION EST NOMMÉE D'AVANCE (docs/SPEC-notifications.md §5.4) : les suites
-- `0002_fonctions_autorisation.test.sql` et `0011_droits_fins.test.sql` éprouvent déjà ces quatre
-- fonctions sous des comptes réels. Elles doivent rester VERTES SANS ÊTRE MODIFIÉES. Une seule
-- assertion révisée y serait un signal, pas un détail.

-- --- 2.1 `app.workspace_role_pour` ------------------------------------------------------------
-- Corps identique à celui de `app.workspace_role`, `auth.uid()` remplacé par le paramètre. Rend
-- NULL lorsque le profil n'est pas membre : docs/SPEC-permissions-rls.md §2.1, « il n'existe pas
-- de rôle implicite ». Un `p_user` nul ne trouve aucune ligne et rend NULL, sans erreur.

create or replace function app.workspace_role_pour(ws uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select m.role
	  from public.workspace_members m
	 where m.workspace_id = ws
	   and m.user_id = p_user;
$$;

alter function app.workspace_role_pour(uuid, uuid) owner to postgres;

comment on function app.workspace_role_pour(uuid, uuid) is
	'CRM-064 — docs/SPEC-notifications.md §5.3. Rôle d''un profil DONNÉ dans un workspace, NULL '
	's''il n''en est pas membre. Généralisation de `app.workspace_role`, qui la délègue désormais.';

create or replace function app.workspace_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.workspace_role_pour(ws, (select auth.uid()));
$$;

alter function app.workspace_role(uuid) owner to postgres;

comment on function app.workspace_role(uuid) is
	'CRM-010, généralisée par CRM-064 — docs/SPEC-permissions-rls.md §2.1, '
	'docs/SPEC-notifications.md §5.3. Rôle de l''APPELANT dans le workspace, NULL s''il n''en est '
	'pas membre. Délègue à `app.workspace_role_pour` : la règle n''a qu''une seule écriture.';

-- --- 2.2 `app.resolve_channel_access_pour` ----------------------------------------------------
-- Les sous-requêtes scalaires sont conservées telles quelles, et pour la raison de la décision
-- 104 : une sous-requête sans ligne rend NULL, que `app.resolve_access` interprète comme « aucun
-- avis à ce niveau ». La distinction stricte entre NULL et 'none' du §2.2 est préservée mot pour
-- mot. Une jointure interne, elle, fermerait par défaut ce que la spécification veut HÉRITÉ.

create or replace function app.resolve_channel_access_pour(ws uuid, track uuid, ch uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.resolve_access(
		app.workspace_role_pour(ws, p_user),
		(select tm.access from public.track_members tm
		  where tm.track_id = track and tm.user_id = p_user),
		(select cm.access from public.channel_members cm
		  where cm.channel_id = ch and cm.user_id = p_user)
	);
$$;

alter function app.resolve_channel_access_pour(uuid, uuid, uuid, uuid) owner to postgres;

comment on function app.resolve_channel_access_pour(uuid, uuid, uuid, uuid) is
	'CRM-064 — docs/SPEC-notifications.md §5.3. Accès effectif d''un profil DONNÉ à un channel, le '
	'workspace et le track étant fournis par l''appelant. Ne lit ni `channels` ni `tracks`.';

create or replace function app.resolve_channel_access(ws uuid, track uuid, ch uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.resolve_channel_access_pour(ws, track, ch, (select auth.uid()));
$$;

alter function app.resolve_channel_access(uuid, uuid, uuid) owner to postgres;

comment on function app.resolve_channel_access(uuid, uuid, uuid) is
	'CRM-012, généralisée par CRM-064 — docs/SPEC-permissions-rls.md §3.5, '
	'docs/SPEC-notifications.md §5.3. Accès effectif de l''APPELANT à un channel. Délègue à '
	'`app.resolve_channel_access_pour` : la règle n''a qu''une seule écriture.';

-- --- 2.3 `app.can_read_channel_pour` ----------------------------------------------------------

create or replace function app.can_read_channel_pour(ch uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.resolve_channel_access_pour(c.workspace_id, c.track_id, c.id, p_user) <> 'none'
		   from public.channels c
		  where c.id = ch),
		false);
$$;

alter function app.can_read_channel_pour(uuid, uuid) owner to postgres;

comment on function app.can_read_channel_pour(uuid, uuid) is
	'CRM-064 — docs/SPEC-notifications.md §5.3. Droit de lecture effectif d''un profil DONNÉ sur '
	'un channel. `coalesce` externe : un channel inexistant rend `false`, jamais NULL (décision 102).';

create or replace function app.can_read_channel(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select app.can_read_channel_pour(ch, (select auth.uid()));
$$;

alter function app.can_read_channel(uuid) owner to postgres;

comment on function app.can_read_channel(uuid) is
	'CRM-012, généralisée par CRM-064 — docs/SPEC-permissions-rls.md §3.3, '
	'docs/SPEC-notifications.md §5.3. Droit de lecture effectif de l''APPELANT sur le channel. Le '
	'droit fin du channel surcharge celui de son track, y compris pour rouvrir. Délègue.';

-- --- 2.4 `app.can_read_card_pour` -------------------------------------------------------------
-- LA FONCTION QUE LA TRANCHE EXISTE POUR POSER.
--
-- ELLE EST ACCORDÉE À `authenticated`, ET C'EST UNE PREUVE QUI L'A IMPOSÉ (décision 522). La
-- première écriture la refusait aux deux rôles clients, au motif que « le trigger n'est atteint
-- que par un authentifié ». Le raisonnement se contredisait : le trigger de la section 5 est
-- `SECURITY INVOKER`, donc il l'exécute PRÉCISÉMENT SOUS CE RÔLE. MESURÉ — les quatre premières
-- lignes du contrat du §8 rendaient
--
--   403 / 42501 — permission denied for function can_read_card_pour
--
-- là où trois d'entre elles attendaient un refus MÉTIER et une un succès. Un refus de privilège
-- qui masque la règle n'est pas la règle.
--
-- LA DIVULGATION QUE LE REFUS VOULAIT ÉVITER N'A AUCUN CANAL, et c'est mesuré aussi : PostgREST
-- expose `public, storage, graphql_public` — jamais `app`. Un appel direct rend `404 / PGRST202`,
-- comme `app.relancer_cards_figees` l'a établi pour CRM-062. Le privilège sert l'exécution EN
-- BASE sous le trigger, et rien d'autre.
--
-- `anon` reste exclu : il ne détient aucun privilège `INSERT` sur la table (section 7), donc le
-- trigger ne s'exécute jamais sous son rôle. Lui accorder l'exécution n'ouvrirait aucun chemin et
-- élargirait la surface sans contrepartie.
--
-- Les trois autres variantes `_pour` restent refusées aux deux rôles : elles ne sont atteintes que
-- DEPUIS celle-ci, qui est `SECURITY DEFINER` de propriétaire `postgres`, donc exécutées sous
-- `postgres` et non sous l'appelant. C'est vérifié par le contrat, non supposé.

create or replace function app.can_read_card_pour(card uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_read_channel_pour(c.channel_id, p_user) from public.cards c where c.id = card),
		false);
$$;

alter function app.can_read_card_pour(uuid, uuid) owner to postgres;

comment on function app.can_read_card_pour(uuid, uuid) is
	'CRM-064 — docs/SPEC-notifications.md §5.1, §5.5. Droit de lecture effectif d''un profil DONNÉ '
	'sur une card, dérivé de son channel. Porte la règle d''éligibilité d''une mention. NON '
	'accordée à `anon` : la question ne se pose que pour un appelant authentifié.';

create or replace function app.can_read_card(card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select app.can_read_card_pour(card, (select auth.uid()));
$$;

alter function app.can_read_card(uuid) owner to postgres;

comment on function app.can_read_card(uuid) is
	'CRM-040, généralisée par CRM-064 — docs/SPEC-permissions-rls.md §3, docs/SPEC-cards.md §6.2, '
	'docs/SPEC-notifications.md §5.3. Droit de lecture effectif de l''APPELANT sur une card, '
	'dérivé de son channel. Destinée aux tables FILLES. Délègue.';

-- --- 2.5 Privilèges d'exécution ---------------------------------------------------------------
-- Les quatre déléguées conservent EXACTEMENT les privilèges qu'elles avaient : `create or replace`
-- ne les touche pas, et ils sont réaffirmés ici pour qu'un rejeu répare un privilège relâché à la
-- main (décision 57).
--
-- Les variantes `_pour` ne sont accordées ni à `anon` — aucune ne sert un refus par zéro ligne —,
-- ni à `authenticated` — aucune n'est appelée depuis une politique évaluée sous ce rôle : elles ne
-- sont atteintes que depuis les déléguées et depuis le trigger, tous deux `SECURITY DEFINER` ou
-- exécutés sous le propriétaire.

revoke all on function app.workspace_role_pour(uuid, uuid)                        from public;
revoke all on function app.resolve_channel_access_pour(uuid, uuid, uuid, uuid)    from public;
revoke all on function app.can_read_channel_pour(uuid, uuid)                      from public;
revoke all on function app.can_read_card_pour(uuid, uuid)                         from public;

revoke all on function app.workspace_role_pour(uuid, uuid)                        from anon, authenticated;
revoke all on function app.resolve_channel_access_pour(uuid, uuid, uuid, uuid)    from anon, authenticated;
revoke all on function app.can_read_channel_pour(uuid, uuid)                      from anon, authenticated;
revoke all on function app.can_read_card_pour(uuid, uuid)                         from anon, authenticated;

-- Le trigger de la section 5 est `SECURITY INVOKER` : il exécute celle-ci SOUS LE RÔLE DE
-- L'APPELANT. Sans ce `grant`, les refus métier du §8 sont masqués par un `42501` — MESURÉ.
grant execute on function app.can_read_card_pour(uuid, uuid) to authenticated, service_role;

grant execute on function app.workspace_role(uuid)                     to anon, authenticated, service_role;
grant execute on function app.resolve_channel_access(uuid, uuid, uuid) to anon, authenticated, service_role;
grant execute on function app.can_read_channel(uuid)                   to anon, authenticated, service_role;
grant execute on function app.can_read_card(uuid)                      to anon, authenticated, service_role;

-- =============================================================================================
-- 3. `app.card_du_commentaire` — une seule écriture de la lecture, pour trois politiques
-- =============================================================================================
-- docs/SPEC-notifications.md §7.1. Sans elle, les trois politiques porteraient chacune leur
-- sous-requête sur `card_comments` : trois écritures de la même lecture.
--
-- `SECURITY DEFINER` : appelée DEPUIS une politique de `card_comment_mentions`, elle doit lire
-- `card_comments` sans que la RLS de cette dernière ne s'applique — sans quoi la politique de
-- lecture des mentions dépendrait de celle des commentaires, et une récursion de politiques
-- naîtrait à la première évolution de l'une des deux.

create or replace function app.card_du_commentaire(comment uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select cc.card_id from public.card_comments cc where cc.id = comment;
$$;

alter function app.card_du_commentaire(uuid) owner to postgres;

comment on function app.card_du_commentaire(uuid) is
	'CRM-064 — docs/SPEC-notifications.md §7.1. Card portant un commentaire, NULL si le '
	'commentaire n''existe pas. Existe pour que les trois politiques de `card_comment_mentions` '
	'n''écrivent pas trois fois la même lecture.';

revoke all    on function app.card_du_commentaire(uuid) from public;
grant execute on function app.card_du_commentaire(uuid) to anon, authenticated, service_role;

-- =============================================================================================
-- 4. `public.card_comment_mentions` — docs/SPEC-notifications.md §4
-- =============================================================================================
-- AUCUNE COLONNE `id` DE SUBSTITUTION : la ligne n'a pas d'existence propre, elle EST le fait que
-- ces deux-là sont liés. AUCUNE COLONNE `updated_at` : une mention se pose ou se retire, elle ne
-- se modifie pas — même écart assumé aux conventions générales que `card_comments` (INC-025).

create table if not exists public.card_comment_mentions (
	comment_id   uuid        not null,
	profile_id   uuid        not null,
	-- DÉRIVÉE du commentaire par le trigger de la section 5, jamais décidée par le client, et
	-- tenue en outre par la clé étrangère composite ci-dessous.
	workspace_id uuid        not null,
	created_at   timestamptz not null default now(),
	primary key (comment_id, profile_id)
);

comment on table public.card_comment_mentions is
	'CRM-064 — docs/SPEC-notifications.md §4. Une personne nommément désignée dans un commentaire. '
	'Remplace `card_comments.mentions`, un `uuid[]` qui ne portait NI intégrité référentielle '
	'(INC-033) NI règle d''éligibilité — MESURÉ, §2 mesure M8. La clé primaire porte « on ne '
	'mentionne pas deux fois la même personne dans le même commentaire » sans qu''aucun code ne '
	'le vérifie. Poser une mention ne prévient PERSONNE : les notifications sont la tranche 2.';

comment on column public.card_comment_mentions.workspace_id is
	'CRM-064 — docs/SPEC-notifications.md §4.1. Dénormalisation DÉRIVÉE du commentaire par '
	'trigger, quelle que soit la valeur envoyée, et tenue par la clé composite vers '
	'`card_comments (id, workspace_id)`.';

comment on column public.card_comment_mentions.created_at is
	'CRM-064 — docs/SPEC-notifications.md §4.1. Posée par le trigger, jamais par le client : une '
	'mention antidatée fausserait l''ordre de la lecture « qu''est-ce qui me mentionne » (§4.3).';

-- --- 4.1 Les trois clés étrangères ------------------------------------------------------------
-- docs/SPEC-notifications.md §4.2. Le mécanisme de la décision 95 : le moteur vérifie des deux
-- côtés de la relation, y compris contre un POST direct qu'aucune garde applicative ne verrait
-- passer. Le trigger DÉRIVE `workspace_id` ; ces contraintes rendent l'incohérence impossible même
-- par la clé de service, qui contourne la RLS mais PAS les contraintes.
--
-- `profile_id` en CASCADE, et non en SET NULL : la colonne est partie de la clé primaire, donc non
-- nulle par construction. La conséquence est NOMMÉE plutôt que subie — supprimer un compte efface
-- ses mentions, là où `card_comments.author_id` conserve le commentaire avec son repli « Compte
-- supprimé » (CRM-022, INC-014). Les deux traitements diffèrent parce que les deux faits
-- diffèrent : un commentaire écrit reste un propos tenu ; une mention adressée à un compte disparu
-- n'adresse plus rien à personne.

select app.migration_0063_converger_contrainte(
	'public.card_comment_mentions', 'card_comment_mentions_comment_id_workspace_id_fkey',
	'FOREIGN KEY (comment_id, workspace_id) REFERENCES public.card_comments(id, workspace_id) ON DELETE CASCADE');

select app.migration_0063_converger_contrainte(
	'public.card_comment_mentions', 'card_comment_mentions_profile_id_fkey',
	'FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE');

select app.migration_0063_converger_contrainte(
	'public.card_comment_mentions', 'card_comment_mentions_workspace_id_fkey',
	'FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE');

-- --- 4.2 L'index de la lecture inverse --------------------------------------------------------
-- La clé primaire sert « qui est mentionné dans ce commentaire ». Celui-ci sert « qu'est-ce qui me
-- mentionne », qui est LA lecture de la tranche 2. Il est posé ici, avec la table qu'il indexe,
-- plutôt que rattaché après coup à une tranche qui ne crée pas la table.

create index if not exists card_comment_mentions_profile_id_created_at_idx
	on public.card_comment_mentions (profile_id, created_at desc);

-- =============================================================================================
-- 5. Le trigger et ses trois refus — docs/SPEC-notifications.md §6
-- =============================================================================================
-- `SECURITY INVOKER`, et c'est un choix de DISCRÉTION, non un oubli — celui de
-- `app.card_comments_avant_insertion` (migration 0015 §4.1). En `SECURITY DEFINER`, la recherche du
-- commentaire ignorerait la RLS : un appelant distinguerait alors un commentaire qui ne lui est pas
-- ouvert d'un commentaire inexistant. En `SECURITY INVOKER`, les deux rendent le même refus.
--
-- L'ORDRE DES REFUS COMPTE : le troisième a besoin de la card, qui vient du commentaire.
--
-- `comment_deleted` RÉEMPLOIE le vocabulaire existant, rendu par `app.card_comments_avant_maj`
-- pour dire « ce commentaire ne reçoit plus rien ». Un second vocable pour le même fait ferait
-- diverger deux dictionnaires de refus.
--
-- `mention_destinataire_sans_acces` NE DIT PAS QUI : il nomme la règle, jamais la personne ni son
-- niveau d'accès. Le message d'un refus ne doit pas devenir un moyen de sonder les droits d'autrui.

create or replace function app.card_comment_mentions_avant_insertion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_card      uuid;
	v_espace    uuid;
	v_supprime  timestamptz;
begin
	select cc.card_id, cc.workspace_id, cc.deleted_at
	  into v_card, v_espace, v_supprime
	  from public.card_comments cc
	 where cc.id = new.comment_id;

	if v_card is null then
		raise exception 'comment_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucun commentaire lisible ne porte cet identifiant.';
	end if;

	if v_supprime is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus mentionner personne.';
	end if;

	if not app.can_read_card_pour(v_card, new.profile_id) then
		raise exception 'mention_destinataire_sans_acces'
			using errcode = 'P0001',
			      detail  = 'Une mention ne désigne que quelqu''un qui peut lire cette affaire.';
	end if;

	new.workspace_id := v_espace;
	new.created_at   := now();
	return new;
end;
$$;

comment on function app.card_comment_mentions_avant_insertion() is
	'CRM-064 — docs/SPEC-notifications.md §6. Dérive `workspace_id` et `created_at`, et rend trois '
	'refus dans cet ordre : `comment_not_found`, `comment_deleted`, '
	'`mention_destinataire_sans_acces`. SECURITY INVOKER par DISCRÉTION : un commentaire fermé et '
	'un commentaire inexistant doivent rendre le même refus.';

drop trigger if exists card_comment_mentions_avant_insertion on public.card_comment_mentions;
create trigger card_comment_mentions_avant_insertion
	before insert on public.card_comment_mentions
	for each row execute function app.card_comment_mentions_avant_insertion();

-- AUCUN TRIGGER DE MISE À JOUR, parce qu'aucune mise à jour n'est ouverte (section 6.4).

-- =============================================================================================
-- 6. Refus par défaut, puis politiques — docs/SPEC-notifications.md §7.1
-- =============================================================================================
-- RLS activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) : même
-- le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.card_comment_mentions enable row level security;

-- --- 6.1 Lecture ------------------------------------------------------------------------------
-- Qui lit l'affaire lit ses mentions. Accordée à `anon` pour que le refus soit ZÉRO LIGNE et non
-- une erreur de privilège (docs/SPEC-permissions-rls.md §3.2) : `auth.uid()` étant nul, le
-- prédicat est faux.

drop policy if exists card_comment_mentions_lecture on public.card_comment_mentions;
create policy card_comment_mentions_lecture
	on public.card_comment_mentions
	for select
	to anon, authenticated
	using (app.can_read_card(app.card_du_commentaire(comment_id)));

comment on policy card_comment_mentions_lecture on public.card_comment_mentions is
	'CRM-064 — docs/SPEC-notifications.md §7.1. Qui lit l''affaire lit ses mentions, droits fins '
	'appliqués. Accordée à `anon` pour que le refus soit ZÉRO LIGNE et non une erreur.';

-- --- 6.2 Insertion ----------------------------------------------------------------------------
-- DEUX CONDITIONS, et la seconde n'est pas redondante avec la première : `app.can_write_card`
-- ouvre le geste à tout membre en écriture sur le channel, y compris sur le propos d'autrui.
-- Mentionner quelqu'un dans le commentaire d'un tiers reviendrait à lui faire dire ce qu'il n'a
-- pas écrit. La règle est celle de l'édition du corps (`card_comments_maj`) : l'auteur, et lui
-- seul, complète son propre propos.
--
-- Le droit d'ÉCRITURE, non celui de lecture : un auteur dont le droit fin est retombé à `viewer`
-- depuis qu'il a écrit ne complète plus rien. C'est la règle du droit COURANT, celle d'INC-071.

drop policy if exists card_comment_mentions_insertion on public.card_comment_mentions;
create policy card_comment_mentions_insertion
	on public.card_comment_mentions
	for insert
	to authenticated
	with check (
		app.can_write_card(app.card_du_commentaire(comment_id))
		and exists (
			select 1 from public.card_comments cc
			 where cc.id = comment_id and cc.author_id = (select auth.uid())
		)
	);

comment on policy card_comment_mentions_insertion on public.card_comment_mentions is
	'CRM-064 — docs/SPEC-notifications.md §7.1. L''AUTEUR du commentaire, et lui seul, y pose une '
	'mention, et seulement tant qu''il conserve le droit d''ÉCRITURE sur le channel (INC-071). Un '
	'tiers en écriture est refusé : compléter le propos d''autrui reviendrait à le lui faire dire.';

-- --- 6.3 Suppression --------------------------------------------------------------------------
-- Retirer une mention est la correction d'une erreur de frappe, et c'est la même règle que
-- l'édition du corps. Un tiers n'obtient PAS d'erreur : le `USING` filtre, et son `DELETE` ne
-- touche AUCUNE ligne.

drop policy if exists card_comment_mentions_suppression on public.card_comment_mentions;
create policy card_comment_mentions_suppression
	on public.card_comment_mentions
	for delete
	to authenticated
	using (
		app.can_write_card(app.card_du_commentaire(comment_id))
		and exists (
			select 1 from public.card_comments cc
			 where cc.id = comment_id and cc.author_id = (select auth.uid())
		)
	);

comment on policy card_comment_mentions_suppression on public.card_comment_mentions is
	'CRM-064 — docs/SPEC-notifications.md §7.1. L''AUTEUR retire une mention qu''il a posée. Un '
	'tiers ne reçoit pas d''erreur : le `USING` filtre, et son `DELETE` ne touche aucune ligne.';

-- --- 6.4 Aucune politique `for update` --------------------------------------------------------
-- docs/SPEC-notifications.md §7.1. Une mention se retire, elle ne se modifie pas : changer
-- `profile_id` ne serait pas une correction mais une SUBSTITUTION de destinataire. Le refus est
-- DOUBLE — aucun privilège `UPDATE` en section 7, aucune politique ici —, comme pour la
-- suppression de `card_comments` (décision 96) : la dégradation du harnais accorde le privilège
-- pour constater que la politique tient encore la seconde barrière. Sans les deux, on ne saurait
-- pas lequel des deux refuse.

-- =============================================================================================
-- 7. Privilèges — docs/SPEC-notifications.md §7.2
-- =============================================================================================
-- Le `revoke all` est écrit AVANT les `grant`, et c'est la décision 134 : l'image Supabase pose un
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout, nommément, à `anon` et
-- `authenticated` sur toute table nouvelle. Sans ce `revoke`, le « refus DOUBLE » du §6.4
-- n'existerait pas. C'est aussi le point de sûreté que la migration 0053 a payé pour l'avoir
-- oublié sur une FONCTION (CRM-062). Un rejeu RÉPARE en outre un privilège relâché à la main
-- (décision 57).

revoke all on public.card_comment_mentions from anon, authenticated;

grant select                 on public.card_comment_mentions to anon;
grant select, insert, delete on public.card_comment_mentions to authenticated;
grant all privileges         on public.card_comment_mentions to service_role;

-- =============================================================================================
-- 8. LA TABLE N'EST PAS PUBLIÉE AU TEMPS RÉEL — docs/SPEC-notifications.md §7.3
-- =============================================================================================
-- `card_comments` l'est depuis la décision 195, parce que le panneau de commentaires s'y abonne.
-- Rien ne s'abonne aux mentions : la surface est la tranche 3, la notification est la tranche 2.
-- Publier une table que personne n'écoute serait poser une surface d'autorisation sans preuve — le
-- temps réel évalue la politique `SELECT` de chaque abonné, et c'est une propriété qui se prouve,
-- pas qui s'ajoute par précaution. L'absence est FIGÉE par une assertion pgTAP.

-- =============================================================================================
-- 9. Le retrait de `card_comments.mentions` — docs/SPEC-notifications.md §7.4
-- =============================================================================================
-- LA GARDE D'ABORD, LE RETRAIT ENSUITE. C'est celle que la migration 0019 a posée avant de retirer
-- `require_fields` : une migration ne détruit pas des données qu'elle ne sait pas transposer. M1
-- mesure le retrait sûr — 0 mention sur 5 commentaires —, et cette garde le VÉRIFIE au lieu de s'en
-- remettre à la mesure de la veille.

do $$
declare
	restantes bigint;
begin
	if exists (
		select 1 from pg_catalog.pg_attribute a
		 where a.attrelid = 'public.card_comments'::regclass
		   and a.attname  = 'mentions'
		   and a.attnum   > 0
		   and not a.attisdropped
	) then
		execute 'select count(*) from public.card_comments where mentions <> ''{}''::uuid[]'
		   into restantes;

		if restantes > 0 then
			raise exception 'card_comments_mentions_non_vide: % ligne(s)', restantes
				using detail = 'Le retrait de la colonne détruirait des mentions que cette '
				               'migration ne sait pas transposer. Transposer d''abord vers '
				               'public.card_comment_mentions, puis rejouer.';
		end if;
	end if;
end;
$$;

-- LE TRIGGER DE MISE À JOUR EST RÉÉCRIT SANS LA COLONNE, dans la même migration que le retrait.
-- Sa dernière autorité était la migration 0035 (lot G, décision 374) ; elle comparait
-- `new.mentions` à `old.mentions` parmi les colonnes gelées de ses deux portes étroites. La
-- comparaison disparaît AVEC la colonne — la laisser ferait échouer la fonction au premier
-- détachement d'identité, sur une colonne qui n'existe plus. Le RESTE du corps est repris mot pour
-- mot : cette migration retire une comparaison, elle ne rejuge aucune règle.

create or replace function app.card_comments_avant_maj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	-- Porte étroite de `CRM-022` (INC-076), étendue à `deleted_by` : l'action référentielle qui
	-- détache une identité supprimée ne touche QUE `author_id`.
	--
	-- CRM-064 : `mentions` a disparu de l'énumération avec la colonne elle-même. La porte reste
	-- aussi étroite qu'avant — elle exige toujours que RIEN d'autre que la clé détachée ne change.
	detachement_fk boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.author_id is not null
		and new.author_id is null
		and new.id           is not distinct from old.id
		and new.card_id      is not distinct from old.card_id
		and new.workspace_id is not distinct from old.workspace_id
		and new.created_at   is not distinct from old.created_at
		and new.body         is not distinct from old.body
		and new.edited_at    is not distinct from old.edited_at
		and new.deleted_at   is not distinct from old.deleted_at
		and new.deleted_by   is not distinct from old.deleted_by;

	-- Le MÊME détachement, appliqué à `deleted_by` : un modérateur dont le compte est supprimé.
	detachement_fk_moderateur boolean :=
		pg_catalog.pg_trigger_depth() > 1
		and old.deleted_by is not null
		and new.deleted_by is null
		and new.id           is not distinct from old.id
		and new.card_id      is not distinct from old.card_id
		and new.workspace_id is not distinct from old.workspace_id
		and new.author_id    is not distinct from old.author_id
		and new.created_at   is not distinct from old.created_at
		and new.body         is not distinct from old.body
		and new.edited_at    is not distinct from old.edited_at
		and new.deleted_at   is not distinct from old.deleted_at;

	v_appelant uuid := (select auth.uid());
begin
	if detachement_fk or detachement_fk_moderateur then
		return new;
	end if;

	if old.deleted_at is not null then
		raise exception 'comment_deleted'
			using errcode = 'P0001',
			      detail  = 'Un commentaire supprimé ne peut plus être ni modifié ni restauré.';
	end if;

	if new.id           is distinct from old.id
	or new.card_id      is distinct from old.card_id
	or new.workspace_id is distinct from old.workspace_id
	or new.author_id    is distinct from old.author_id
	or new.created_at   is distinct from old.created_at then
		raise exception 'comment_immutable_column'
			using errcode = 'P0001',
			      detail  = 'id, card_id, workspace_id, author_id et created_at sont figés.';
	end if;

	-- LA BORNE DE LA MODÉRATION — INC-072, décision 374, reprise mot pour mot.
	if v_appelant is not null
	   and old.author_id is distinct from v_appelant
	   and new.deleted_at is null then
		raise exception 'comment_moderation_limitee'
			using errcode = 'P0001',
			      detail  = 'Un tiers ne peut que supprimer un commentaire, jamais le modifier.';
	end if;

	if new.deleted_at is not null then
		-- LA SUPPRESSION VIDE RÉELLEMENT LE CORPS (décision 193). La date est celle du geste, non
		-- celle que l'appelant a envoyée, et l'AUTEUR DU GESTE est relevé au passage (INC-072).
		new.deleted_at := now();
		new.deleted_by := v_appelant;
		new.body       := '';
		new.edited_at  := old.edited_at;
		return new;
	end if;

	new.deleted_by := old.deleted_by;

	if new.body is distinct from old.body then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$$;

comment on function app.card_comments_avant_maj() is
	'CRM-022 + CRM-043, étendue par le lot G (décision 374, INC-072), ALLÉGÉE par CRM-064 — garde '
	'la pierre tombale et les colonnes immuables, BORNE un tiers à la seule suppression '
	'(`comment_moderation_limitee`) et relève l''auteur du geste dans `deleted_by`. La comparaison '
	'de `mentions` a disparu avec la colonne (docs/SPEC-notifications.md §7.4) ; les deux portes '
	'étroites restent aussi étroites, exigeant que rien d''autre que la clé détachée ne change.';

-- Le retrait lui-même. `if exists` le rend rejouable ; la garde ci-dessus l'a autorisé.
alter table public.card_comments drop column if exists mentions;

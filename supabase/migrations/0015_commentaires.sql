-- @spec CRM-043 (docs/BACKLOG.md) — commentaires d'une card
-- @spec docs/SPEC-cards.md §13.2 (modèle), §13.3 (unicité et clé composite), §13.4 (la pierre
--       tombale), §13.5 (`edited_at` par trigger), §13.6 (autorisations), §13.7 (colonnes
--       protégées), §13.9 (temps réel)
-- @spec docs/SCHEMA.md §5 (`card_comments`), §10 (index), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §3.7 (`app.can_write_card`),
--       §4 (politiques par famille), §4.3 (colonnes protégées), §7 (refus n° 4)
-- @spec docs/DAT.md §4 (flux Realtime), §3.5 (services)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décisions 192 (commenter est un droit d'écriture), 193 (la pierre
--       tombale), 194 (l'auteur seul), 195 (le temps réel mesuré), 196 (`auth.uid()` en défaut
--       ET dans le `WITH CHECK`), 197 (un trigger écrit une colonne fermée au client)
-- @spec docs/INCONSISTENCY_REPORT.md INC-071 (qui peut commenter — trois documents se
--       contredisent), INC-072 (la modération), INC-014 (`profiles` illisible), INC-025
--       (colonnes communes), INC-033 (aucune intégrité sur un `uuid[]`), INC-048 (le commentaire
--       de `move_card`, dont la cause bloquante est levée par cette migration)
--
-- Le produit sait ranger des affaires, poser des questions et recevoir des réponses. Il ne sait
-- pas encore en parler. Cette migration livre la table des commentaires, ses gardes, et la
-- première publication au temps réel du produit.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : l'unicité que `cards` devait offrir pour que la clé composite soit légale,
-- `public.card_comments` et son `CHECK` conditionnel, ses deux triggers, ses trois politiques,
-- ses privilèges de colonne, son index, et son appartenance à `supabase_realtime`.
--
-- Non livré, et nommé — chaque manque est **figé par une assertion** de
-- `supabase/tests/0017_commentaires.test.sql` :
--
--   * **aucune notification.** `mentions` est livrée par docs/SCHEMA.md §5 et n'est alimentée par
--     rien : ni analyse du corps, ni écriture par l'interface. `CRM-063`, et la table
--     `notifications` n'existe pas. INC-033 : un `uuid[]` ne porte aucune intégrité référentielle ;
--
--   * **aucun événement de timeline.** `card_events` est due par `CRM-044` : un commentaire écrit,
--     modifié ou supprimé ne laisse aucune trace typée ;
--
--   * **aucune modération.** docs/SPEC-permissions-rls.md §4 ouvre la suppression aux `admin`,
--     l'énoncé de `CRM-043` ne l'ouvre qu'à l'auteur. L'INTERSECTION est livrée — INC-072 ;
--
--   * **`public.move_card` n'est PAS redéfinie ici.** Son paramètre `comment` reste perdu
--     (INC-048). La cause bloquante — « `card_comments` n'existe pas » — est levée par cette
--     migration, et l'arbitrage devient exigible ; mais `move_card` est un livrable de `CRM-034`,
--     et le reprendre sous une unité qui ne le porte pas toucherait ses gardes sans les rejouer
--     sous la sienne (`CLAUDE.md` §13). Le point est écrit dans INC-048 plutôt que tranché ici.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence et convergence.
-- ---------------------------------------------------------------------------------------------
-- Tout est rejouable et **convergent** au sens d'INC-035 : une contrainte remplacée à la main par
-- une contrainte plus faible portant le même nom est réparée par le rejeu. Le mécanisme est celui
-- de la décision 78, repris des migrations 11 et 13.
--
-- AUCUNE DÉPENDANCE D'ORDRE NOUVELLE. Cette migration ne repose aucun privilège d'une table
-- qu'une autre migration touche : la troisième occurrence de la décision 108 — le piège 12 → 14 —
-- ne se reproduit pas ici. Elle exige seulement que `cards` (11) et `app.can_write_card` (13)
-- existent, ce que l'ordre du répertoire garantit.

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Même fonction que les migrations 11 et 13, sous un nom propre à celle-ci : les trois sont
-- retirées en fin de fichier, et un nom partagé rendrait l'ordre de suppression significatif.

create or replace function app.migration_0015_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname  = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

-- =============================================================================================
-- 1. L'unicité que `cards` devait offrir, et qui manquait — docs/SPEC-cards.md §13.3
-- =============================================================================================
-- MESURÉ le 2026-08-05, sur une table sonde créée puis annulée :
--
--   create table sonde_c1 (card_id uuid, workspace_id uuid,
--     foreign key (card_id, workspace_id) references public.cards (id, workspace_id));
--   ERROR:  there is no unique constraint matching given keys for referenced table "cards"
--
-- `cards` porte `PRIMARY KEY (id)` et, depuis `CRM-036`, `UNIQUE (id, workflow_id)` — rien de
-- plus. C'est exactement le geste de la décision 124, refait pour l'autre couple.
--
-- ELLE NE CHANGE AUCUN COMPORTEMENT. `id` étant déjà clé primaire, le couple était déjà unique ;
-- elle rend seulement la relation exprimable.

select app.migration_0015_converger_contrainte(
	'public.cards', 'cards_id_workspace_id_key', 'UNIQUE (id, workspace_id)');

comment on constraint cards_id_workspace_id_key on public.cards is
	'CRM-043 — docs/SPEC-cards.md §13.3. Unicité redondante, exigée par la clé étrangère composite '
	'de `card_comments` : sans elle, « there is no unique constraint matching given keys for '
	'referenced table "cards" » — MESURÉ. Aucun comportement ne change.';

-- =============================================================================================
-- 2. `public.card_comments`
-- =============================================================================================
-- docs/SPEC-cards.md §13.2, docs/SCHEMA.md §5.
--
-- `updated_at` N'EST PAS AJOUTÉE, et c'est le seul écart assumé aux « Conventions générales » de
-- docs/SCHEMA.md — cinquième occurrence d'INC-025, et la première où le tableau du §5 est suivi à
-- la lettre plutôt que complété. `edited_at` et `deleted_at` nomment les deux seules évolutions
-- possibles d'un commentaire ; une colonne `updated_at` les confondrait.

create table if not exists public.card_comments (
	id           uuid        primary key default gen_random_uuid(),
	card_id      uuid        not null,
	-- DÉRIVÉE de la card par le trigger de la section 4, jamais décidée par le client, et tenue
	-- en outre par la clé composite de la section 3 (docs/SPEC-cards.md §13.3).
	workspace_id uuid        not null,
	-- `auth.uid()` en DÉFAUT dispense l'interface d'envoyer la colonne ; la politique d'insertion
	-- de la section 6 est ce qui REFUSE d'écrire sous le nom d'autrui. Les deux, décision 196 :
	-- un défaut ne s'applique qu'à une colonne omise, et un client qui l'envoie le contourne.
	author_id    uuid        not null default auth.uid() references public.profiles (id),
	body         text        not null,
	-- Livrée par docs/SCHEMA.md §5, ALIMENTÉE PAR RIEN (INC-033).
	mentions     uuid[]      not null default '{}',
	created_at   timestamptz not null default now(),
	edited_at    timestamptz,
	deleted_at   timestamptz
);

-- --- 2.1 Le `CHECK` conditionnel du corps — décision 193 --------------------------------------
-- LA PIERRE TOMBALE EST UNE PROPRIÉTÉ DE LA BASE, PAS UNE POLITESSE DU CODE. Un commentaire
-- supprimé ne porte plus AUCUN contenu : ce n'est pas caché, c'est détruit. Tout chemin
-- d'écriture traverse cette contrainte, y compris la clé de service.
--
-- La borne haute est écrite parce qu'une colonne `text` sans borne est une promesse qu'aucune
-- couche ne tient : un commentaire est un message, pas un document.

select app.migration_0015_converger_contrainte(
	'public.card_comments', 'card_comments_body_check',
	'CHECK ((deleted_at IS NULL AND length(btrim(body)) >= 1 AND length(body) <= 10000) '
	'OR (deleted_at IS NOT NULL AND body = ''''::text))');

comment on table public.card_comments is
	'CRM-043 — docs/SPEC-cards.md §13. Fil de discussion d''une card. ÉCRIRE exige le droit '
	'd''ÉCRITURE sur le channel, non celui de lecture : docs/SCHEMA.md §5 disait le contraire, '
	'INC-071 le consigne. Modifier et supprimer sont réservés à l''AUTEUR (INC-072). Un '
	'commentaire supprimé est une PIERRE TOMBALE : la ligne survit, vidée de son corps, pour que '
	'la suppression se propage au temps réel — qui n''émet que ce que l''abonné peut lire.';

comment on column public.card_comments.workspace_id is
	'CRM-043 — docs/SPEC-cards.md §13.3. Dénormalisation DÉRIVÉE de la card par trigger, quelle '
	'que soit la valeur envoyée, et tenue par la clé composite vers `cards (id, workspace_id)`.';

comment on column public.card_comments.author_id is
	'CRM-043 — docs/SPEC-cards.md §13.6, décision 196. Défaut `auth.uid()` pour le confort du '
	'client ; la politique d''insertion `author_id = auth.uid()` est ce qui refuse la signature '
	'd''autrui. GELÉE par le trigger de mise à jour ET fermée par le privilège de colonne.';

comment on column public.card_comments.body is
	'CRM-043 — docs/SPEC-cards.md §13.4. Markdown STOCKÉ, rendu en TEXTE BRUT par le produit : '
	'aucune unité ne porte l''assainissement qu''un rendu exigerait (§13.13). Vidé — non masqué — '
	'dès que le commentaire est supprimé, et le `CHECK` conditionnel le tient.';

comment on column public.card_comments.mentions is
	'CRM-043 — docs/SCHEMA.md §5. Destinataires de notification. ALIMENTÉE PAR RIEN : les '
	'notifications sont `CRM-063`, et un `uuid[]` ne porte aucune intégrité (INC-033).';

comment on column public.card_comments.edited_at is
	'CRM-043 — docs/SPEC-cards.md §13.5, décision 197. Posée par le trigger SI ET SEULEMENT SI le '
	'corps change. FERMÉE à `authenticated` par le privilège de colonne, et pourtant écrite : le '
	'privilège juge la cible du client, pas les affectations d''un trigger — MESURÉ.';

comment on column public.card_comments.deleted_at is
	'CRM-043 — docs/SPEC-cards.md §13.4. OUVERTE en écriture pour que le geste « supprimer » '
	'existe, mais RÉÉCRITE à `now()` par le trigger : une date antidatée est ignorée, non refusée. '
	'IRRÉVERSIBLE — aucune résurrection, et toute écriture ultérieure rend `comment_deleted`.';

-- =============================================================================================
-- 3. La clé étrangère composite — docs/SPEC-cards.md §13.3
-- =============================================================================================
-- Le mécanisme de la décision 95 : le moteur vérifie des deux côtés de la relation, y compris
-- contre un `PATCH` direct qu'aucune garde applicative ne verrait passer. Le trigger de la
-- section 4 dérive la valeur ; cette contrainte rend l'incohérence impossible même par la clé de
-- service, qui contourne la RLS mais **pas** les contraintes.
--
-- `ON DELETE CASCADE` : `cards` n'expose aucune suppression (§4), l'archivage et la corbeille en
-- tiennent lieu. La cascade protège la cohérence d'un geste d'exploitation, pas d'un geste
-- d'utilisateur.

select app.migration_0015_converger_contrainte(
	'public.card_comments', 'card_comments_card_id_workspace_id_fkey',
	'FOREIGN KEY (card_id, workspace_id) REFERENCES public.cards(id, workspace_id) ON DELETE CASCADE');

-- =============================================================================================
-- 4. Les deux triggers — docs/SPEC-cards.md §13.4, §13.5
-- =============================================================================================

-- --- 4.1 À l'insertion : dérivation, et rien d'autre ------------------------------------------
-- `SECURITY INVOKER`, et c'est un choix de DISCRÉTION, non un oubli. En `SECURITY DEFINER`, la
-- recherche de la card ignorerait la RLS : un appelant distinguerait alors une card qui ne lui
-- est pas ouverte (`403` de la politique) d'une card inexistante (`card_not_found` d'ici), ce que
-- la règle de discrétion de docs/SPEC-workflow-engine.md §5.3 proscrit. En `SECURITY INVOKER`,
-- les deux cas rendent le même refus.
--
-- Le trigger NE TOUCHE PAS `author_id` : le forcer rendrait la politique `WITH CHECK` de la
-- section 6 toujours vraie — la RLS jugeant la ligne APRÈS les triggers —, donc invérifiable
-- (décision 196).

create or replace function app.card_comments_avant_insertion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
	espace uuid;
begin
	select c.workspace_id into espace from public.cards c where c.id = new.card_id;

	if espace is null then
		raise exception 'card_not_found'
			using errcode = 'P0001',
			      detail  = 'Aucune card lisible ne porte cet identifiant.';
	end if;

	new.workspace_id := espace;
	new.created_at   := now();
	-- Un commentaire ne naît ni modifié, ni supprimé, quoi que le client envoie.
	new.edited_at    := null;
	new.deleted_at   := null;
	return new;
end;
$$;

comment on function app.card_comments_avant_insertion() is
	'CRM-043 — docs/SPEC-cards.md §13.3. Dérive `workspace_id` de la card et interdit un '
	'commentaire né modifié ou supprimé. `SECURITY INVOKER` par DISCRÉTION : en `DEFINER`, une '
	'card fermée se distinguerait d''une card inexistante.';

drop trigger if exists card_comments_avant_insertion on public.card_comments;
create trigger card_comments_avant_insertion
	before insert on public.card_comments
	for each row execute function app.card_comments_avant_insertion();

-- --- 4.2 À la mise à jour : la pierre tombale, et les colonnes gelées --------------------------
-- Trois gardes, dans cet ordre :
--
--   1. une pierre tombale est DÉFINITIVE — aucune écriture, aucune résurrection ;
--   2. cinq colonnes sont GELÉES. Le privilège de colonne de la section 7 les ferme déjà à
--      `authenticated` ; ce bloc les ferme à TOUT LE MONDE, `service_role` compris. C'est le
--      refus DOUBLE de la migration 13 §8.4, appliqué aux colonnes plutôt qu'à la suppression :
--      sans lui, le seed n'aurait aucune barrière ;
--   3. `edited_at` et `deleted_at` ne sont jamais décidées par l'appelant.

create or replace function app.card_comments_avant_maj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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

	if new.deleted_at is not null then
		-- LA SUPPRESSION VIDE RÉELLEMENT LE CORPS (décision 193). La date est celle du geste, non
		-- celle que l'appelant a envoyée.
		new.deleted_at := now();
		new.body       := '';
		new.edited_at  := old.edited_at;
		return new;
	end if;

	if new.body is distinct from old.body then
		new.edited_at := now();
	else
		new.edited_at := old.edited_at;
	end if;
	return new;
end;
$$;

comment on function app.card_comments_avant_maj() is
	'CRM-043 — docs/SPEC-cards.md §13.4, §13.5. Refuse toute écriture sur une pierre tombale '
	'(`comment_deleted`), gèle cinq colonnes pour TOUS les rôles (`comment_immutable_column`), '
	'vide le corps à la suppression et pose `edited_at` si et seulement si le corps change.';

drop trigger if exists card_comments_avant_maj on public.card_comments;
create trigger card_comments_avant_maj
	before update on public.card_comments
	for each row execute function app.card_comments_avant_maj();

-- =============================================================================================
-- 5. Index — docs/SCHEMA.md §10
-- =============================================================================================
-- La seule lecture du produit est « les commentaires d'une card, du plus ancien au plus récent »
-- (docs/SPEC-cards.md §13.10). L'ordre est TERMINÉ PAR `id` pour la raison mesurée par `CRM-042`
-- sur la sonde `sonde_l2` : un ordre non total parcouru page par page perd des lignes. Le fil
-- n'est pas paginé aujourd'hui, et l'index est écrit de sorte qu'il puisse l'être sans changer
-- l'ordre servi.

create index if not exists card_comments_card_id_created_at_idx
	on public.card_comments (card_id, created_at, id);

-- =============================================================================================
-- 6. Refus par défaut, puis politiques — docs/SPEC-cards.md §13.6
-- =============================================================================================
-- RLS est activée dans la migration qui crée la table (docs/SCHEMA.md, conventions générales) :
-- même le temps d'une instruction, la table ne doit pas être ouverte à quiconque détient la clé
-- anonyme, qui est publique par construction.

alter table public.card_comments enable row level security;

-- --- 6.1 Lecture ------------------------------------------------------------------------------
-- `card_comments` est le DEUXIÈME appelant réel d'`app.can_read_card`, après `card_field_values`
-- (docs/SPEC-permissions-rls.md §3.6, qui la nommait déjà). Le défaut de la décision 107 ne s'y
-- reproduit pas : la fonction lit `cards`, une AUTRE table, déjà écrite.
--
-- LA LIGNE SUPPRIMÉE RESTE LISIBLE, et c'est délibéré (décision 193) : elle ne porte plus aucun
-- corps, et sa lisibilité est ce qui fait que la suppression se PROPAGE au temps réel — lequel
-- n'émet que ce que l'abonné peut lire. Une politique excluant `deleted_at is not null` rendrait
-- toute suppression silencieuse pour les autres écrans.

drop policy if exists card_comments_lecture on public.card_comments;
create policy card_comments_lecture
	on public.card_comments
	for select
	to anon, authenticated
	using (app.can_read_card(card_id));

comment on policy card_comments_lecture on public.card_comments is
	'CRM-043 — docs/SPEC-cards.md §13.6. Lecture par droit effectif sur la card, droits fins '
	'appliqués. Accordée à `anon` pour que le refus soit ZÉRO LIGNE et non une erreur de '
	'privilège (docs/SPEC-permissions-rls.md §3.2) : `auth.uid()` étant nul, le prédicat est faux.';

-- --- 6.2 Insertion ----------------------------------------------------------------------------
-- LE POINT LE PLUS DISPUTÉ DE L'UNITÉ — INC-071, décision 192. `app.can_write_card`, non
-- `app.can_read_card` : un `viewer` de workspace est REFUSÉ, ce que la Definition of Done exige
-- nommément, et un droit fin `member` sur le channel le rouvre.
--
-- `author_id = auth.uid()` n'est pas redondant avec le défaut de colonne : le défaut ne s'applique
-- qu'à une colonne omise (décision 196).

drop policy if exists card_comments_insertion on public.card_comments;
create policy card_comments_insertion
	on public.card_comments
	for insert
	to authenticated
	with check (app.can_write_card(card_id) and author_id = auth.uid());

comment on policy card_comments_insertion on public.card_comments is
	'CRM-043 — docs/SPEC-cards.md §13.6, INC-071. Écrire un commentaire exige le droit d''ÉCRITURE '
	'sur le channel de la card : un `viewer` est refusé. `author_id = auth.uid()` refuse la '
	'signature d''autrui, ce que le seul défaut de colonne ne ferait pas.';

-- --- 6.3 Mise à jour : l'auteur, et lui seul --------------------------------------------------
-- INC-072 : docs/SPEC-permissions-rls.md §4 y ajoute les `admin`, l'énoncé de `CRM-043` ne
-- l'ouvre qu'à l'auteur. L'INTERSECTION est livrée (décision 194).
--
-- `app.can_write_card` n'est pas redondant avec `author_id = auth.uid()` : un auteur dont le droit
-- fin est retombé à `viewer` depuis qu'il a écrit ne doit plus pouvoir modifier. La règle est
-- celle du droit COURANT, non de celui du jour de l'écriture.
--
-- Le `WITH CHECK` juge la ligne d'arrivée, APRÈS les triggers. Il est identique au `USING` parce
-- que les deux colonnes qu'il éprouve sont gelées par le trigger de la section 4.2 : il ne peut
-- donc rien refuser que le trigger n'ait déjà refusé, et il est écrit pour que la règle soit
-- lisible sans connaître ce détail.

drop policy if exists card_comments_maj on public.card_comments;
create policy card_comments_maj
	on public.card_comments
	for update
	to authenticated
	using      (author_id = auth.uid() and app.can_write_card(card_id))
	with check (author_id = auth.uid() and app.can_write_card(card_id));

comment on policy card_comments_maj on public.card_comments is
	'CRM-043 — docs/SPEC-cards.md §13.6, INC-072. L''AUTEUR seul modifie et supprime, et seulement '
	'tant qu''il conserve le droit d''écriture sur le channel. Un tiers n''obtient pas d''erreur : '
	'le `USING` filtre, et son `PATCH` ne touche AUCUNE ligne.';

-- --- 6.4 Aucune politique `for delete` --------------------------------------------------------
-- docs/SPEC-cards.md §13.4 : supprimer, c'est poser `deleted_at`, et la ligne devient une pierre
-- tombale. La suppression physique n'est exposée à personne. Le refus est DOUBLE — aucun
-- privilège `DELETE` en section 7, aucune politique ici —, comme pour `card_field_values`
-- (décision 96) : la dégradation du harnais accorde le privilège pour constater que la politique
-- tient encore la seconde barrière. Sans les deux, on ne saurait pas lequel des deux refuse.

-- =============================================================================================
-- 7. Privilèges, et colonnes protégées — docs/SPEC-cards.md §13.7
-- =============================================================================================
-- Le mécanisme du §4.3 de docs/SPEC-permissions-rls.md, appliqué DÈS LA MIGRATION QUI CRÉE LA
-- TABLE, et non deux unités plus tard comme pour `cards` (`CRM-013`).
--
-- Le `revoke all` est écrit AVANT les `grant` pour deux raisons. La première est la décision 134 :
-- l'image Supabase pose un `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout,
-- nommément, à `anon` et `authenticated` sur toute table nouvelle — sans ce `revoke`, le « refus
-- DOUBLE » du §6.4 n'existerait pas. La seconde est la décision 57 : un rejeu RÉPARE un privilège
-- relâché à la main.
--
-- DEUX COLONNES OUVERTES EN MISE À JOUR, ET DEUX SEULEMENT. `id`, `card_id`, `workspace_id`,
-- `author_id`, `created_at` et `mentions` sont fermées par voie de conséquence : un commentaire ne
-- change ni de card, ni d'auteur, ni de date de naissance. `edited_at` est fermée ET POURTANT
-- ÉCRITE, par le trigger — MESURÉ (décision 197).
--
-- Le privilège `INSERT` reste DE TABLE, comme pour `cards` (décision 140) : le défaut de colonne
-- et la politique tiennent déjà `author_id`, et fermer l'insertion colonne par colonne ferait
-- `403` à des clients qui envoient la ligne entière sans dommage.

revoke all on public.card_comments from anon, authenticated;

grant select                    on public.card_comments to anon;
grant select, insert            on public.card_comments to authenticated;
grant update (body, deleted_at) on public.card_comments to authenticated;
grant all privileges            on public.card_comments to service_role;

-- =============================================================================================
-- 8. Publication au temps réel — docs/SPEC-cards.md §13.9, décision 195
-- =============================================================================================
-- PREMIÈRE TABLE DU PRODUIT PUBLIÉE. MESURÉ le 2026-08-05, avant cette migration :
-- `select count(*) from pg_publication_tables where pubname = 'supabase_realtime'` rend **0**. Le
-- §4 de docs/DAT.md annonce des « abonnements Realtime pour les commentaires » depuis le socle
-- documentaire ; rien n'avait jamais été branché.
--
-- `realtime.apply_rls` évalue la politique `SELECT` de la table pour le rôle et les revendications
-- de chaque abonné : un membre sans accès à la card ne reçoit RIEN. Le temps réel est donc une
-- surface d'autorisation, et la preuve d'API l'exerce comme telle.
--
-- `REPLICA IDENTITY` reste à sa valeur par défaut — la clé primaire. Elle suffit : aucune
-- suppression physique n'est exposée (§6.4), et une pierre tombale est un `UPDATE` dont la ligne
-- d'arrivée est lisible.
--
-- Idempotent, et il le doit : le `migrations-runner` rejoue le répertoire à chaque démarrage, et
-- `alter publication … add table` rend `42710` sur une table déjà publiée.

do $$
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		-- La publication est posée par l'image Supabase. La créer ici garde la migration
		-- rejouable sur une base neuve dont l'image ne l'aurait pas fait.
		create publication supabase_realtime;
	end if;

	if not exists (
		select 1 from pg_publication_tables
		 where pubname = 'supabase_realtime'
		   and schemaname = 'public'
		   and tablename  = 'card_comments'
	) then
		alter publication supabase_realtime add table public.card_comments;
	end if;
end;
$$;

-- =============================================================================================
-- 9. Retrait de l'échafaudage
-- =============================================================================================

drop function if exists app.migration_0015_converger_contrainte(text, text, text);

notify pgrst, 'reload schema';

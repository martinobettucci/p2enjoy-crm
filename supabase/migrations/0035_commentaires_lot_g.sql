-- @spec CRM-034 (docs/BACKLOG.md) — `move_card` conserve enfin le motif qu'elle exige
-- @spec CRM-036 (docs/BACKLOG.md) — « renseigné » s'élargit aux blancs Unicode
-- @spec CRM-043 (docs/BACKLOG.md) — la modération d'un commentaire, auditée
-- @spec docs/SPEC-workflow-engine.md §5.3 (vérifications n° 5 et 5 bis), §5.4 (ce qui est écrit
--       en cas de succès)
-- @spec docs/SPEC-form-composer.md §4.3 (les deux lectures convergent), §6.6 (« renseigné »)
-- @spec docs/SPEC-cards.md §13.2 (modèle), §13.4 (la pierre tombale), §13.5 (les triggers),
--       §13.6 (autorisations et modération), §13.7 (colonnes protégées)
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille), §3.6 (`app.can_read_card`),
--       §3.7 (`app.can_write_card`), §2.1 (l'invariant du `viewer`)
-- @spec docs/SCHEMA.md §5 (`card_comments`), « Conventions générales »
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 367 (arbitrage du lot G), décision 374 (mise en œuvre),
--       décisions 51 (une assertion se révise, ne se retire pas), 165, 192, 193, 194, 196, 197
-- @spec docs/INCONSISTENCY_REPORT.md INC-048, INC-052, INC-071, INC-072 — les quatre entrées du
--       lot G, closes par cette migration et par les preuves qui l'accompagnent
--
-- LE LOT G TIENT EN UNE MIGRATION PARCE QU'IL TIENT EN UNE TABLE.
--
-- Les quatre entrées touchent `card_comments`, sa garde d'entrée `move_card`, et la définition de
-- « vide » que les deux partagent. Les livrer séparément aurait demandé trois migrations dont
-- chacune aurait laissé la suite pgTAP dans un état intermédiaire qu'aucune règle ne décrit.
--
-- Ce que cette migration livre, dans l'ordre où elle le livre :
--
--   1. `app.btrim_blancs(text)` — la classe des blancs, énoncée UNE FOIS (INC-052) ;
--   2. `app.valeur_de_champ_est_vide(jsonb)` réécrite sur elle (INC-052, second appelant) ;
--   3. `card_comments.deleted_by` — l'audit de la modération (INC-072) ;
--   4. `app.card_comments_avant_maj()` — la borne « supprimer sans modifier » (INC-072) ;
--   5. la politique de modération (INC-072) ;
--   6. `move_card` — le motif devient un vrai commentaire (INC-048), et sa normalisation passe aux
--      blancs Unicode (INC-052, premier appelant).
--
-- INC-071 n'apparaît pas dans cette liste, et c'est normal : son comportement est livré depuis la
-- migration 15 — commenter exige `app.can_write_card` —, et ce qui était faux était l'ÉNONCÉ du
-- backlog, corrigé dans le même changement. Aucune ligne de SQL ne lui est due.
--
-- ---------------------------------------------------------------------------------------------
-- Rejouabilité et convergence.
-- ---------------------------------------------------------------------------------------------
-- Tout est rejouable : `create or replace` pour les fonctions, `add column if not exists` pour la
-- colonne, `drop policy if exists` avant chaque politique. La migration ne suppose jamais l'état
-- laissé par une exécution précédente d'elle-même.
--
-- AUCUNE DÉPENDANCE D'ORDRE NOUVELLE. Elle exige `card_comments` (15), `app.can_read_card` (11),
-- `app.is_workspace_admin` (2) et `move_card` (19), toutes antérieures dans l'ordre du répertoire.

begin;

-- =============================================================================================
-- 1. `app.btrim_blancs` — la classe des blancs, énoncée une seule fois
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §5.3, docs/SPEC-form-composer.md §6.6, INC-052.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi une fonction, et non l'expression recopiée chez ses deux appelants.
-- ---------------------------------------------------------------------------------------------
-- INC-052 décrit littéralement le défaut que la recopie produit : la MÊME propriété de `btrim`,
-- relevée d'abord sur le commentaire de `move_card`, puis retrouvée quinze jours plus tard sur
-- `app.valeur_de_champ_est_vide`, à un endroit que personne n'avait relié au premier. Deux
-- expressions séparées divergent le jour où l'une bouge ; une fonction partagée ne le peut pas.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi la classe est ÉNUMÉRÉE, et non écrite `\s` ou `[[:space:]]`.
-- ---------------------------------------------------------------------------------------------
-- Ces deux formes dépendent du `ctype` de la base : selon la locale, `U+00A0` est ou n'est pas de
-- l'espace blanche. Une règle d'autorisation — car c'en est une : elle décide si une transition
-- passe — ne se règle pas par la configuration d'un serveur, et un environnement de production
-- monté avec une autre locale donnerait alors un produit qui ne refuse pas les mêmes valeurs.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi CET ensemble, et pas un autre.
-- ---------------------------------------------------------------------------------------------
-- C'est exactement l'ensemble de `String.prototype.trim()` : l'espace blanche Unicode, les
-- terminateurs de ligne, et `U+FEFF`. Le motif est la convergence exigée par le §4.3 de
-- docs/SPEC-form-composer.md — l'interface et la garde doivent donner la MÊME lecture. En
-- adoptant l'ensemble que le navigateur applique déjà, le prédicat TypeScript redevient un appel
-- à `trim()` et ne peut PLUS diverger par une réimplémentation. C'est le sens inverse de la
-- décision 165, qui avait dû faire converger l'interface vers `btrim` faute d'arbitrage.
--
-- `U+0085` (NEL) n'y est PAS : `String.prototype.trim()` ne le retire pas. L'ajouter rendrait la
-- base plus stricte que l'interface, ce qui est exactement la divergence à éviter — dans l'autre
-- sens, celui où l'interface annonce passable ce que la garde refuse.

create or replace function app.btrim_blancs(texte text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
	-- Les caractères sont écrits en ÉCHAPPEMENTS UNICODE et non en clair : un blanc invisible
	-- recopié dans un fichier source est indistinguable d'un autre, et une relecture ne pourrait
	-- pas vérifier cette liste. `E'\uXXXX'` exige un encodage serveur UTF-8, que `docs/DAT.md`
	-- impose déjà.
	--
	-- UN SEUL littéral, et non une tranche annotée par ligne : la concaténation implicite de deux
	-- constantes exige un saut de ligne SANS commentaire entre elles. Les tranches sont donc
	-- énoncées ici, et la liste les suit dans cet ordre :
	--
	--   ASCII    U+0009 U+000A U+000B U+000C U+000D U+0020
	--   Unicode  U+00A0 U+1680 U+2000..U+200A U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
	select btrim(texte, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF');
$$;

comment on function app.btrim_blancs(text) is
	'Lot G, décision 374 — INC-052. Retire les BLANCS de tête et de fin, au sens exact de '
	'`String.prototype.trim()` : espace blanche Unicode, terminateurs de ligne et U+FEFF. Classe '
	'ÉNUMÉRÉE et non `\s`, qui dépend du `ctype` de l''instance. Seule définition du produit : '
	'`app.valeur_de_champ_est_vide` et `public.move_card` l''appellent, aucune ne la recopie.';

revoke all on function app.btrim_blancs(text) from public;
grant execute on function app.btrim_blancs(text) to anon, authenticated, service_role;

-- =============================================================================================
-- 2. `app.valeur_de_champ_est_vide` — premier appelant, et le défaut mesuré de la décision 165
-- =============================================================================================
-- docs/SPEC-form-composer.md §6.6. La fonction employait `btrim(valeur #>> '{}')`, qui ne retire
-- que `U+0020` : une valeur réduite à `"\t"` était RENSEIGNÉE et satisfaisait un champ `required`.
--
-- Rien d'autre ne change : `false`, `0` et `"0"` restent renseignés, le tableau vide reste vide,
-- et les deux façons d'exprimer `null` restent confondues (INC-054).

create or replace function app.valeur_de_champ_est_vide(valeur jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
	select valeur is null
	    or jsonb_typeof(valeur) = 'null'
	    or (jsonb_typeof(valeur) = 'string' and app.btrim_blancs(valeur #>> '{}') = '')
	    or (jsonb_typeof(valeur) = 'array'  and jsonb_array_length(valeur) = 0);
$$;

comment on function app.valeur_de_champ_est_vide(jsonb) is
	'CRM-036 — docs/SPEC-form-composer.md §6.6, élargie par le lot G (décision 374, INC-052). '
	'Seule définition de « non renseigné » du produit : `null` jsonb, chaîne vide ou de BLANCS '
	'UNICODE, tableau vide. `false`, `0` et `"0"` sont RENSEIGNÉS.';

-- =============================================================================================
-- 3. `card_comments.deleted_by` — l'audit sans lequel la modération n'en est pas une
-- =============================================================================================
-- docs/SPEC-cards.md §13.2 et §13.6, INC-072.
--
-- Une pierre tombale qui ne dit pas qui l'a posée n'est pas auditée. La colonne rend la modération
-- immédiatement lisible : `deleted_by` DIFFÉRENT de `author_id` signale un retrait par un tiers.
--
-- `ON DELETE SET NULL`, comme `author_id` depuis `CRM-022` (INC-076) : la suppression d'un compte
-- de modérateur ne doit pas plus être bloquée par une pierre tombale que celle d'un auteur.
--
-- La colonne n'est PAS ajoutée aux privilèges de la section 7 de la migration 15 : elle est
-- fermée au client exactement comme `edited_at`, et écrite par le trigger — le privilège de
-- colonne juge la cible du client, pas les affectations d'un trigger (décision 197, MESURÉ).

alter table public.card_comments
	add column if not exists deleted_by uuid;

do $$
declare
	v_contrainte record;
begin
	select c.conname, c.confdeltype
	  into v_contrainte
	  from pg_catalog.pg_constraint c
	 where c.conrelid = 'public.card_comments'::regclass
	   and c.conname = 'card_comments_deleted_by_fkey'
	   and c.contype = 'f';

	if v_contrainte.conname is null or v_contrainte.confdeltype <> 'n' then
		alter table public.card_comments drop constraint if exists card_comments_deleted_by_fkey;
		alter table public.card_comments
			add constraint card_comments_deleted_by_fkey
			foreign key (deleted_by) references public.profiles(id) on delete set null;
	end if;
end;
$$;

comment on column public.card_comments.deleted_by is
	'CRM-043 — docs/SPEC-cards.md §13.6, INC-072, décision 374. AUDIT de la modération : qui a '
	'posé la pierre tombale. Écrite PAR LE TRIGGER à `auth.uid()`, jamais par le client, et '
	'fermée en écriture comme `edited_at`. Différente de `author_id` = retrait par un tiers.';

-- =============================================================================================
-- 4. `app.card_comments_avant_maj` — la borne que la politique ne peut pas porter
-- =============================================================================================
-- docs/SPEC-cards.md §13.5 et §13.6, INC-072.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi la restriction vit ICI, et nulle part ailleurs.
-- ---------------------------------------------------------------------------------------------
-- L'arbitrage ouvre aux `admin` la SUPPRESSION, et à eux seuls parmi les gestes : modifier le
-- propos d'autrui n'est pas de la modération mais une falsification (décision 194, dont le motif
-- de fond est maintenu).
--
-- Or « tu peux écrire cette colonne, pas celle-là » n'est exprimable :
--
--   * ni par une politique RLS — son `WITH CHECK` n'a pas d'`OLD`, et ne sait donc pas comparer
--     la ligne d'arrivée à la ligne de départ ;
--   * ni par un privilège de colonne — il est attaché au RÔLE `authenticated`, que l'auteur et le
--     modérateur partagent ; le retirer fermerait le geste aux deux.
--
-- Le trigger est le seul endroit qui voie `OLD`, `NEW` et `auth.uid()` en même temps. La politique
-- OUVRE, le trigger BORNE, et les deux sont nécessaires : sans la politique, le modérateur ne voit
-- aucune ligne à écrire ; sans le trigger, il pourrait réécrire le corps.
--
-- ---------------------------------------------------------------------------------------------
-- Ce qui est CONSERVÉ de la version de `CRM-022`, et pourquoi il ne faut pas y toucher.
-- ---------------------------------------------------------------------------------------------
-- La porte `detachement_fk` reconnaît l'`UPDATE` émis par l'action référentielle `SET NULL` de la
-- clé d'auteur, à sa profondeur et à l'absence de toute autre modification. Sans elle, la FK
-- annoncerait la conservation de la parole tout en bloquant chaque suppression réelle de compte.
-- `deleted_by` REJOINT la liste des colonnes qui doivent rester identiques pour que cette porte
-- s'ouvre : sans cet ajout, une pierre tombale modérée bloquerait à nouveau la suppression du
-- compte de son auteur — le défaut d'INC-076, réintroduit par une colonne oubliée.

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
	-- CRM-064, INC-240, 2026-08-29 : les DEUX portes comparaient aussi `new.mentions` à
	-- `old.mentions`. La migration 0063 a SUPPRIMÉ `public.card_comments.mentions` au profit de la
	-- table `public.card_comment_mentions`, et la comparaison a disparu de la définition finale —
	-- mais elle subsistait ici. Le rejeu du répertoire complet le masquait, 0063 réécrivant la
	-- fonction après ; tout rejeu qui s'arrête ou qui VISE le lot G reposait cette définition sur
	-- une base sans la colonne, et le trigger `before update` de `card_comments` sortait en 42703 :
	-- plus aucun commentaire modifiable ni supprimable, plus aucun compte supprimable. Les deux
	-- comparaisons sont retirées comme elles l'ont été dans 0015 et 0063 ; le reste du corps est
	-- repris MOT POUR MOT, et les deux portes restent exactement aussi étroites — elles exigent
	-- toujours que RIEN d'autre que la clé détachée ne change. Voir docs/SPEC-notifications.md §7.4.1.
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

	-- LA BORNE DE LA MODÉRATION — INC-072, décision 374.
	--
	-- Un appelant qui n'est PAS l'auteur ne peut faire qu'une chose : poser `deleted_at`. Le
	-- refus porte sur le corps, seule donnée éditable restante : `edited_at` et `deleted_by` sont
	-- réécrites plus bas quoi que l'appelant envoie, et les cinq colonnes gelées viennent d'être
	-- refusées.
	--
	-- `v_appelant` nul — la clé de service, qui ne porte aucune revendication `sub` — n'est PAS
	-- traité comme un tiers : le seed écrit par ce chemin, et `service_role` contourne de toute
	-- façon la RLS. La barrière que cette section pose est celle des CLIENTS authentifiés.
	--
	-- Le test est écrit sur `deleted_at`, et non sur `body`, et c'est plus étroit qu'il n'y
	-- paraît : un tiers dont l'écriture NE pose PAS la pierre tombale est refusé, quelle que soit
	-- la colonne qu'il visait. Tester `body` seul laisserait passer une écriture qui ne change
	-- rien et poserait `edited_at` sur le propos d'autrui.
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
	'CRM-022 + CRM-043, étendue par le lot G (décision 374, INC-072) — garde la pierre tombale et '
	'les colonnes immuables, BORNE un tiers à la seule suppression (`comment_moderation_limitee`) '
	'et relève l''auteur du geste dans `deleted_by`. Seuls les SET NULL internes des deux clés '
	'd''identité, reconnaissables à leur profondeur et à l''absence de toute autre modification, '
	'détachent une identité supprimée sans perdre la parole ni la trace de modération.';

-- Le trigger lui-même est inchangé et n'est pas recréé : `create or replace function` suffit,
-- et le recréer romprait inutilement l'ordre d'exécution si un jour un second trigger s'ajoutait.

-- =============================================================================================
-- 5. La politique de modération — ce que le trigger borne, il faut d'abord l'ouvrir
-- =============================================================================================
-- docs/SPEC-cards.md §13.6, docs/SPEC-permissions-rls.md §4, INC-072.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi `app.can_read_card` et non `app.can_write_card`.
-- ---------------------------------------------------------------------------------------------
-- Un administrateur de workspace dont le droit fin sur le channel est retombé à `viewer` doit
-- pouvoir retirer un propos déplacé qu'il VOIT. Exiger de lui en plus le droit d'écrire ferait
-- dépendre la modération d'un droit métier qui n'a rien à voir avec elle, et rouvrirait
-- exactement le trou qu'INC-072 décrit : « aucun modérateur ne peut retirer un commentaire
-- déplacé ». Il ne gagne pour autant aucun pouvoir d'écriture — le trigger de la section 4 ne lui
-- laisse que `deleted_at`.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi une SECONDE politique, et non l'élargissement de `card_comments_maj`.
-- ---------------------------------------------------------------------------------------------
-- Les politiques permissives d'une même commande s'unissent par OU. Deux politiques distinctes
-- disent donc la même chose qu'un prédicat unique avec un OU, et le disent mieux : chacune porte
-- son propre commentaire de règle, et l'une peut être retirée sans réécrire l'autre. Surtout, la
-- dégradation d'un harnais peut supprimer la politique de modération SEULE et constater que
-- l'auteur conserve son geste — ce qu'un prédicat unique ne permettrait pas de mesurer.
--
-- `app.is_workspace_admin` juge sur `workspace_id`, colonne de la ligne elle-même : la politique
-- ne relit donc PAS `card_comments`, et le défaut de la décision 107 ne s'y reproduit pas.

drop policy if exists card_comments_moderation on public.card_comments;
create policy card_comments_moderation
	on public.card_comments
	for update
	to authenticated
	using      (app.is_workspace_admin(workspace_id) and app.can_read_card(card_id))
	with check (app.is_workspace_admin(workspace_id) and app.can_read_card(card_id));

comment on policy card_comments_moderation on public.card_comments is
	'CRM-043 — docs/SPEC-cards.md §13.6, INC-072, décision 374. Un `admin` du workspace SUPPRIME '
	'un commentaire qu''il peut LIRE. La politique ouvre le geste ; le trigger '
	'`card_comments_avant_maj` le borne à la seule pose de `deleted_at` et relève `deleted_by`. '
	'`can_read_card` et non `can_write_card` : modérer ne dépend pas d''un droit métier.';

-- =============================================================================================
-- 6. `move_card` — le motif exigé est enfin conservé
-- =============================================================================================
-- docs/SPEC-workflow-engine.md §5.3 et §5.4, INC-048 et INC-052.
--
-- ---------------------------------------------------------------------------------------------
-- Ce qui change, et ce qui ne change pas.
-- ---------------------------------------------------------------------------------------------
-- Les six vérifications sont REPRISES À L'IDENTIQUE, dans le même ordre, avec les mêmes messages
-- et les mêmes `SQLSTATE`. Deux ajouts, et deux seulement :
--
--   * la normalisation passe de `btrim` à `app.btrim_blancs` (INC-052) ;
--   * une vérification n° 5 bis borne la longueur, puis le motif fourni est INSÉRÉ dans
--     `card_comments` avant le `UPDATE` de la card (INC-048).
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi une vérification n° 5 bis, alors que l'arbitrage n'en demandait pas.
-- ---------------------------------------------------------------------------------------------
-- Ce n'est pas un élargissement de périmètre, c'est la conséquence directe de l'arbitrage. Le
-- motif devenant un commentaire ORDINAIRE, il hérite du `CHECK` de la migration 15, qui borne le
-- corps à 10 000 caractères. Sans la n° 5 bis, un motif plus long — accepté puis JETÉ avant ce
-- changement — remonterait un `23514` nommant `card_comments_body_check` sur un appel à
-- `move_card` : une erreur exacte, opaque, et impossible à rattacher au paramètre fautif. La n° 5
-- bis rend `comment_too_long`, du même genre que les six autres.
--
-- ---------------------------------------------------------------------------------------------
-- Pourquoi l'insertion précède le `UPDATE`.
-- ---------------------------------------------------------------------------------------------
-- L'ordre est sans effet sur le résultat — les deux écritures sont dans la MÊME transaction, et
-- l'échec de l'une annule l'autre. Il est choisi pour la lisibilité de l'échec : si le commentaire
-- ne peut pas être écrit, rien n'a encore bougé, et l'état de la base au moment de l'exception est
-- exactement celui d'avant l'appel.
--
-- ---------------------------------------------------------------------------------------------
-- L'auteur ne peut pas être nul, et ce n'est pas une supposition.
-- ---------------------------------------------------------------------------------------------
-- `move_card` refuse `service_role` à sa PREMIÈRE garde : `auth.uid()` y étant nul,
-- `app.can_read_channel` est faux et la fonction rend `card_not_found`. C'est écrit dans
-- `supabase/seed/apply-seed.sh` l. 1670, et le seed appelle donc `move_card` avec le jeton d'un
-- administrateur réel. Tout appel qui atteint l'insertion porte un `auth.uid()` non nul.
--
-- ---------------------------------------------------------------------------------------------
-- L'insertion contourne la RLS, et c'est voulu — mais elle ne contourne AUCUNE garde.
-- ---------------------------------------------------------------------------------------------
-- La fonction est `SECURITY DEFINER` et appartient à `postgres` : la politique d'insertion de
-- `card_comments` ne s'applique pas. Ce n'est pas une porte dérobée. Cette politique exige
-- `app.can_write_card(card_id) and author_id = auth.uid()` ; or la vérification n° 2 vient
-- d'exiger `app.can_write_channel` sur le channel de la card — ce dont `app.can_write_card` est
-- exactement dérivée —, et `author_id` est écrit à `auth.uid()` sans que l'appelant puisse le
-- choisir. Les deux moitiés du prédicat sont donc tenues, par un autre chemin.

create or replace function public.move_card(
	card_id    uuid,
	to_step_id uuid,
	comment    text default null
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card_id    uuid := card_id;
	v_cible      uuid := to_step_id;
	-- INC-052, décision 374 : la classe des blancs est celle d'`app.btrim_blancs`, non celle de
	-- `btrim` à un argument, qui laissait une tabulation seule passer pour un motif.
	v_comment    text := nullif(app.btrim_blancs(comment), '');
	v_card       public.cards%rowtype;
	v_transition public.workflow_transitions%rowtype;
	v_manquants  text[];
begin
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (
		select 1 from public.workflow_steps s
		 where s.id = v_cible and s.workflow_id = v_card.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	select t.* into v_transition
	  from public.workflow_transitions t
	 where t.workflow_id = v_card.workflow_id
	   and t.from_step_id = v_card.current_step_id
	   and t.to_step_id = v_cible;

	if not found then
		raise exception 'transition_not_allowed';
	end if;

	if v_transition.require_comment and v_comment is null then
		raise exception 'comment_required';
	end if;

	-- Vérification n° 5 bis — INC-048, décision 374. Le motif est un commentaire : il en a les
	-- bornes, et le dire vaut mieux que laisser remonter la contrainte de la migration 15.
	if v_comment is not null and length(v_comment) > 10000 then
		raise exception 'comment_too_long'
			using errcode = 'P0001',
			      detail  = 'Un motif de transition est un commentaire : 10 000 caractères au plus.';
	end if;

	select array_agg(f.key order by f.position, f.key)
	  into v_manquants
	  from public.form_fields f
	 where f.workflow_id = v_card.workflow_id
	   and f.archived_at is null
	   and (
	       exists (
	           select 1
	             from public.form_field_rules r
	            where r.field_id = f.id
	              and r.step_id = v_cible
	              and r.visibility = 'required'
	       )
	       or exists (
	           select 1
	             from public.workflow_transition_required_fields trf
	            where trf.transition_id = v_transition.id
	              and trf.field_id = f.id
	       )
	   )
	   and not exists (
	       select 1
	         from public.card_field_values v
	        where v.card_id = v_card_id
	          and v.field_id = f.id
	          and not app.valeur_de_champ_est_vide(v.value)
	   );

	if v_manquants is not null and array_length(v_manquants, 1) > 0 then
		raise exception 'missing_required_fields'
			using detail = array_to_string(v_manquants, ', ');
	end if;

	-- INC-048 — LE MOTIF EST CONSERVÉ, et il l'est AVANT le déplacement pour que l'échec laisse
	-- la base exactement dans l'état d'avant l'appel. Les deux écritures sont dans la même
	-- transaction : soit la card bouge et le motif est écrit, soit ni l'un ni l'autre.
	--
	-- Écrit dès qu'il est FOURNI, et non seulement lorsque la transition l'EXIGE : le §5.4 dit
	-- « insertion du commentaire s'il est fourni », et deux régimes pour un même paramètre
	-- perdraient sans le dire le motif d'un déplacement volontairement commenté.
	if v_comment is not null then
		insert into public.card_comments (card_id, workspace_id, author_id, body)
		values (v_card_id, v_card.workspace_id, (select auth.uid()), v_comment);
	end if;

	update public.cards c
	   set current_step_id = v_cible,
	       entered_step_at = now(),
	       position = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.cards autre
	            where autre.channel_id = v_card.channel_id
	              and autre.current_step_id = v_cible
	       )
	 where c.id = v_card_id
	returning c.* into v_card;

	return v_card;
end;
$$;

alter function public.move_card(uuid, uuid, text) owner to postgres;
comment on function public.move_card(uuid, uuid, text) is
	'CRM-034, étendue par CRM-036, révisée par CRM-018 puis par le lot G (décision 374) — seul '
	'chemin de changement d''étape. Six gardes, plus la n° 5 bis qui borne la longueur du motif. '
	'Le motif fourni est CONSERVÉ comme un commentaire ordinaire dans la même transaction '
	'(INC-048), et « vide » s''entend des blancs Unicode (INC-052).';
revoke all on function public.move_card(uuid, uuid, text) from public, anon;
grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;

commit;

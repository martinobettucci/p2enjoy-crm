-- @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration, première tranche : le modèle
-- @spec docs/SPEC-corbeille.md §2.1 (ce qui manque, mesuré), §3.1 (les trois états),
--       §3.2 (la migration due), §3.3 (la mise en corbeille d'un parent ne descend pas)
-- @spec docs/SPEC-cards.md §4 (cycle de vie : archivage et corbeille sont indépendants),
--       §5 (« active »), §10 point 2 (la purge reste ouverte)
-- @spec docs/SCHEMA.md §3 et §4, « Conventions générales »
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 398
--
-- CE QUE CETTE MIGRATION CORRIGE, ET QUI EST UN MANQUE DE MODÈLE, PAS D'ÉCRAN.
--
-- MESURÉ le 2026-08-15 : `deleted_at` n'existait que sur `cards` et `card_comments`. `tracks` et
-- `channels` n'avaient que l'ARCHIVAGE, alors que la Definition of Done de `CRM-077` les couvre
-- explicitement. Un produit qui dit « supprimer » sur un track n'avait donc aucune colonne pour
-- l'écrire.
--
-- CE QU'ELLE NE FAIT PAS, ET C'EST DÉLIBÉRÉ :
--
--   * elle ne touche AUCUNE cascade. Les cascades physiques mesurées au §2.3 de la spécification
--     — `tracks → channels → cards → commentaires, événements, valeurs, file d'envoi` — restent
--     exactement ce qu'elles sont. La corbeille n'efface jamais physiquement, donc elle ne les
--     emprunte jamais ;
--   * elle n'ajoute AUCUNE politique. Les politiques d'écriture de `tracks`, `channels` et `cards`
--     existent déjà (`tracks_maj_admin`, `channels_maj_admin`, `cards_maj`) et couvrent ces
--     colonnes comme les autres. En ajouter serait dupliquer une règle ;
--   * elle ne filtre RIEN en lecture. Le §2.2 de la spécification le mesure et l'explique : la
--     corbeille est une VUE, non une frontière de confidentialité — sans quoi aucun écran de
--     corbeille ne pourrait afficher ce qu'il doit restaurer ;
--   * elle n'écrit AUCUNE purge. La rétention est une décision de conformité que le responsable
--     n'a pas prise (`docs/SPEC-cards.md` §10 point 2, `docs/SPEC-corbeille.md` §6).
--
-- CHANGEMENT DE SCHÉMA ADDITIF : trois colonnes nullables, une fonction, trois triggers. Aucune
-- donnée n'est réécrite, aucune colonne n'est retirée.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Les colonnes
-- ---------------------------------------------------------------------------------------------
--
-- `deleted_by` est FERMÉE AU CLIENT et écrite par trigger, sur le patron déjà éprouvé de
-- `card_comments.deleted_by` (`CRM-043`, INC-072) : un audit qu'un client peut écrire n'est pas un
-- audit. `on delete set null` parce qu'un profil supprimé ne doit pas empêcher la ligne de vivre —
-- même choix que pour la modération des commentaires.

alter table public.tracks
	add column if not exists deleted_at timestamptz,
	add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

alter table public.channels
	add column if not exists deleted_at timestamptz,
	add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

-- `cards.deleted_at` existe depuis `CRM-040` ; seul l'audit manquait.
alter table public.cards
	add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

comment on column public.tracks.deleted_at is
	'CRM-077 — corbeille (docs/SPEC-corbeille.md §3.1). INDÉPENDANTE d''archived_at : archiver '
	'n''est pas supprimer. Aucune suppression physique n''est exposée.';
comment on column public.channels.deleted_at is
	'CRM-077 — corbeille (docs/SPEC-corbeille.md §3.1). INDÉPENDANTE d''archived_at.';
comment on column public.tracks.deleted_by is
	'CRM-077 — qui a mis à la corbeille. ÉCRITE PAR TRIGGER, jamais par le client.';
comment on column public.channels.deleted_by is
	'CRM-077 — qui a mis à la corbeille. ÉCRITE PAR TRIGGER, jamais par le client.';
comment on column public.cards.deleted_by is
	'CRM-077 — qui a mis à la corbeille. ÉCRITE PAR TRIGGER, jamais par le client.';

-- ---------------------------------------------------------------------------------------------
-- 2. L'audit, écrit par la base et par elle seule
-- ---------------------------------------------------------------------------------------------
--
-- UNE SEULE FONCTION POUR TROIS TABLES, et c'est possible parce qu'elle ne nomme que les deux
-- colonnes qu'elles partagent. La tripler aurait triplé la surface à réviser le jour où la règle
-- change.

create or replace function app.corbeille_avant_ecriture()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
	v_appelant uuid := (select auth.uid());
begin
	-- PORTE ÉTROITE POUR L'ACTION RÉFÉRENTIELLE, reprise de `card_comments` (INC-076) : lorsqu'un
	-- profil est supprimé, `on delete set null` détache `deleted_by` par une mise à jour IMBRIQUÉE.
	-- Sans cette porte, le trigger la réécrirait aussitôt et la clé étrangère ne pourrait jamais
	-- être satisfaite. La porte est étroite : profondeur > 1, et SEULE `deleted_by` change.
	if pg_catalog.pg_trigger_depth() > 1
	   and tg_op = 'UPDATE'
	   and old.deleted_by is not null
	   and new.deleted_by is null
	   and new.deleted_at is not distinct from old.deleted_at then
		return new;
	end if;

	if new.deleted_at is null then
		-- RESTAURATION — ou ligne qui n'a jamais été en corbeille. L'audit est effacé avec l'état
		-- qu'il documentait : conserver « supprimé par X » sur un objet vivant serait un mensonge
		-- de plus, pas une trace de plus. La trace DURABLE d'un geste appartient au journal
		-- d'événements, non à cette colonne — limite assumée et écrite au §3.2 de la spécification.
		new.deleted_by := null;
		return new;
	end if;

	if tg_op = 'INSERT' or old.deleted_at is null then
		-- MISE EN CORBEILLE : l'auteur est celui du geste courant, quoi que le client ait envoyé.
		-- `v_appelant` nul — la clé de service, qui ne porte aucune revendication `sub` — écrit
		-- donc `null` : le seed passe par ce chemin, et `service_role` contourne la RLS de toute
		-- façon. La barrière posée ici est celle des CLIENTS authentifiés.
		new.deleted_by := v_appelant;
	else
		-- DÉJÀ EN CORBEILLE : l'audit est FIGÉ. Sans cette branche, une mise à jour quelconque sur
		-- une ligne déjà supprimée réattribuerait la suppression à qui passe par là.
		new.deleted_by := old.deleted_by;
	end if;

	return new;
end;
$$;

alter function app.corbeille_avant_ecriture() owner to postgres;

comment on function app.corbeille_avant_ecriture() is
	'CRM-077 (docs/SPEC-corbeille.md §3.2) — écrit `deleted_by` côté serveur pour tracks, channels '
	'et cards. Le client ne peut pas la poser, la modifier, ni la conserver en restaurant.';

drop trigger if exists tracks_corbeille on public.tracks;
create trigger tracks_corbeille
	before insert or update on public.tracks
	for each row execute function app.corbeille_avant_ecriture();

drop trigger if exists channels_corbeille on public.channels;
create trigger channels_corbeille
	before insert or update on public.channels
	for each row execute function app.corbeille_avant_ecriture();

drop trigger if exists cards_corbeille on public.cards;
create trigger cards_corbeille
	before insert or update on public.cards
	for each row execute function app.corbeille_avant_ecriture();

-- ---------------------------------------------------------------------------------------------
-- 3. L'audit est fermé au client PAR LE PRIVILÈGE, et pas seulement par le trigger
-- ---------------------------------------------------------------------------------------------
--
-- MESURÉ le 2026-08-15, et c'est ce qui motive cette section. `cards` porte des droits COLONNE PAR
-- COLONNE depuis `CRM-013` : sa nouvelle colonne `deleted_by` n'a hérité d'aucun `UPDATE`, et un
-- client qui tenterait de l'écrire reçoit « permission denied for table cards » AVANT toute
-- politique et avant tout trigger. `tracks` et `channels`, eux, portaient un `UPDATE` au niveau
-- TABLE : leur `deleted_by` était donc écrivable par le client, et seul le trigger du §2 s'y
-- opposait.
--
-- Deux tables sur trois protégées par le privilège et la troisième par un trigger seul, c'est une
-- asymétrie que personne ne retrouverait en relisant le produit. L'écart est refermé ici, sur le
-- patron exact de `CRM-013` : le droit de table est retiré, puis rendu colonne par colonne, à
-- l'exception de `deleted_by`.
--
-- POURQUOI ÉNUMÉRER PLUTÔT QUE RÉVOQUER UNE SEULE COLONNE : un privilège accordé au niveau TABLE
-- implique toutes les colonnes, y compris futures, et PostgreSQL n'en laisse pas retirer une seule.
-- L'énumération est la seule forme qui tienne — et elle a un coût assumé : toute colonne ajoutée
-- plus tard à ces deux tables devra être accordée explicitement, faute de quoi elle sera muette.
-- C'est le même contrat que `cards` porte déjà, et la même vigilance.

revoke update on public.tracks from authenticated;
grant update (id, workspace_id, name, slug, description, color, icon, position,
              archived_at, created_at, updated_at, deleted_at)
	on public.tracks to authenticated;

revoke update on public.channels from authenticated;
grant update (id, workspace_id, track_id, name, slug, description, workflow_id, position,
              archived_at, created_at, updated_at, deleted_at)
	on public.channels to authenticated;

commit;

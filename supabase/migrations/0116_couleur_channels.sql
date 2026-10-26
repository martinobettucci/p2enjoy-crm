-- @spec CRM-116 (docs/BACKLOG.md) — tranche T2 : la couleur d'un channel
-- @spec docs/SPEC-administration-arborescence.md §14.2 (la donnée) ; docs/SPEC-channels.md §2.1 (position révisée) ;
--       docs/SCHEMA.md (`channels`) ; docs/DESIGN_SYSTEM.md §1 (couleurs de données), §5.68 ; docs/PROD_MIGRATIONS.md ;
--       docs/JOURNAL.md décision 729 ; docs/DAT.md §12 bis (les noms)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION AJOUTE : `channels.color`, la forme exacte de `tracks.color` (migration 3).
-- ---------------------------------------------------------------------------------------------
--
-- Un des cinq jetons du design system, jamais un hexadécimal : la contrainte rend le §1 de la charte opposable à un
-- appel direct de l'API, comme pour les tracks. Les channels existants prennent le défaut `neutral`.
--
-- AUCUNE POLITIQUE NOUVELLE : insérer et modifier un channel restent réservés à `app.is_workspace_admin` par les
-- politiques existantes, qui décident donc aussi de qui écrit la couleur.
--
-- LE PRIVILÈGE `UPDATE` EST ACCORDÉ COLONNE PAR COLONNE depuis la migration 37 (corbeille), qui l'annonçait : « toute
-- colonne ajoutée plus tard à ces deux tables devra être accordée explicitement, faute de quoi elle sera muette ». Sans
-- l'accord ci-dessous, l'administrateur ne pourrait pas changer la couleur d'un channel existant. `INSERT` est accordé
-- sur la table entière (migration 4) et couvre la colonne.
--
-- Retour arrière : `alter table public.channels drop column color;` — aucune autre donnée n'en dépend.
-- Rejouable : `if not exists`, et la contrainte reposée.

begin;

alter table public.channels add column if not exists color text not null default 'neutral';

alter table public.channels drop constraint if exists channels_color_check;
alter table public.channels add  constraint channels_color_check
	check (color in ('brand', 'success', 'accent', 'danger', 'neutral'));

comment on column public.channels.color is
	'CRM-116 — nom de jeton du design system (docs/DESIGN_SYSTEM.md §1), jamais un hexadécimal. Pastille de l''onglet '
	'et de l''arborescence (§5.68).';

grant update (color) on public.channels to authenticated;

commit;

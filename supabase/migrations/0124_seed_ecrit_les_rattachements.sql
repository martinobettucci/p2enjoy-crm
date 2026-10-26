-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.3 : le seed écrit les rattachements de ses affaires par la clé de
--       service (décision 746). docs/SPEC-rattachements.md §12 (écriture par le seed), §4 (aucun droit nouveau pour
--       `authenticated`), §14 ; docs/JOURNAL.md décision 746
-- @spec docs/SCHEMA.md « Migration `0124` », §5 (card_placements) ; docs/PROD_MIGRATIONS.md §3
--
-- LE SEED GARDE SES IDENTIFIANTS STABLES. Il crée ses affaires par la clé de service, et le miroir d'insertion de la
-- migration 108 en faisait le premier rattachement. T2.4.5 retire les miroirs : le seed postera alors l'affaire puis
-- son rattachement, à l'identifiant qu'il choisit. `service_role` reçoit l'INSERTION sur `card_placements` et la MISE À
-- JOUR des colonnes que le seed pose : il converge par UPSERT (`resolution=merge-duplicates`, comme pour `cards`), que
-- PostgREST écrit `on conflict (id) do update set` sur chaque colonne envoyée, et il réarme le sommeil
-- (`snoozed_until`) à chaque rejeu. Il avait déjà tout sur `cards`. Il ne reçoit ici ni la suppression, ni la mise à jour
-- de ce que la base tient seule : `health_score`, `created_at`, `updated_at`.
--
-- `authenticated` et `anon` ne changent pas : un utilisateur n'écrit un rattachement que par les fonctions et les
-- colonnes ouvertes de la migration 110.
--
-- IDEMPOTENCE : un `grant` répété est sans effet.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : `revoke insert, update on public.card_placements from service_role;`, avec
-- le seed d'avant.

grant insert on public.card_placements to service_role;
grant update (id, workspace_id, card_id, channel_id, workflow_id, current_step_id, position, owner_id, amount,
	probability_override, next_action, next_action_at, entered_step_at, snoozed_until, archived_at, created_by)
	on public.card_placements to service_role;

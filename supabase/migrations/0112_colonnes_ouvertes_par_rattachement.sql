-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.2 : les colonnes ouvertes et l'archivage s'écrivent sur le rattachement
--       (décision 705). docs/SPEC-rattachements.md §3.2 (ce qui quitte l'affaire), §4 (écrire un rattachement, c'est
--       écrire son channel), §5 (« Archiver, désarchiver : mise à jour de `archived_at` du rattachement »), §14 ;
--       docs/SPEC-permissions-rls.md §4.3 (privilège de colonne retiré) ; docs/JOURNAL.md décisions 661, 705
-- @spec docs/SCHEMA.md « Migration `0112` », §5 (cards, card_placements) ; docs/PROD_MIGRATIONS.md §3
--
-- UN SEUL CHEMIN D'ÉCRITURE PAR COLONNE (décision 661, tenue colonne par colonne). Le responsable, le montant, la
-- probabilité, la prochaine action et son échéance, la position et l'archivage s'écrivent sur `card_placements` depuis
-- T2.3.0 ; cette migration les FERME sur `cards` à `authenticated`. L'affaire garde ce qui lui appartient : le titre,
-- la description, la devise, la corbeille. Le miroir inverse tient `cards` égale tant que des lecteurs l'y lisent
-- (T2.4 retire ces colonnes). `service_role` et le propriétaire gardent l'écriture, dont le seed dépend.
--
-- IDEMPOTENCE : un `revoke` répété est sans effet.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : `grant update (owner_id, amount, probability_override, next_action,
-- next_action_at, position, archived_at) on public.cards to authenticated;`, avec la webapp et l'image `mcp` d'avant.

revoke update (owner_id, amount, probability_override, next_action, next_action_at, position, archived_at)
	on public.cards from authenticated;

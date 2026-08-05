-- @spec CRM-013 (docs/BACKLOG.md) — colonnes protégées
-- @spec docs/SPEC-permissions-rls.md §4.3 (le mécanisme, mesuré par `CRM-034`),
--       §4.4 (ce que `CRM-013` ferme), §4.4.2 (ce qui n'est PAS un défaut),
--       §4.4.3 (la forme retenue), §4.4.4 (contrat d'API), §4.4.5 (INC-050)
-- @spec docs/SPEC-cards.md §3.3 (la non-devinabilité), §3.4 (ce que le trigger ne fait pas à la
--       mise à jour), §6.3 (privilèges)
-- @spec docs/SPEC-workflow-engine.md §5.5 (protection de colonne, bloc `GRANT`)
-- @spec docs/SCHEMA.md §5 (cards)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente, dépendance d'ordre 11 → 12 → 14)
-- @spec docs/INCONSISTENCY_REPORT.md INC-049 (chevauchement de Definition of Done avec `CRM-034`),
--       INC-050 (le §5.5 se contredit sur `email_local_part` — CLOSE par cette migration),
--       INC-026 (le refus divulgue la commande `GRANT`)
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration corrige, et ce n'est pas une imperfection de confort.
-- ---------------------------------------------------------------------------------------------
-- `cards.email_local_part` porte quarante bits tirés au hasard, et docs/SPEC-cards.md §3.3 fonde
-- sur eux la seule propriété de sécurité de cette colonne : on ne peut pas écrire à une card dont
-- on ignore l'adresse. Le trigger de `CRM-040` **génère** cette valeur ; il ne la **protège** pas,
-- et son §3.4 le dit en toutes lettres.
--
-- MESURÉ le 2026-08-05 avec le jeton réel de `admin@p2enjoy.test`, obtenu par la véritable route
-- de connexion (docs/JOURNAL.md, décision 139) :
--
--   PATCH /rest/v1/cards?id=eq.5eed…00c1   {"email_local_part":"c-00000000"}
--   → HTTP 200 ; relecture : « c-00000000 »
--
-- Tout membre qui écrit sur un channel pouvait donc donner à une card une adresse triviale, donc
-- devinable, donc atteignable par quiconque connaît le domaine entrant. Le tirage au hasard
-- achetait une propriété qu'une simple mise à jour rendait au client.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration ne touche PAS, et le motif est mesuré.
-- ---------------------------------------------------------------------------------------------
-- Le privilège `INSERT` reste **de table**. MESURÉ (décision 140) : un `POST` portant
-- `"email_local_part":"c-zzzzzzzz"` rend `201` et enregistre « c-2c3qgad2 » — le trigger
-- `BEFORE INSERT` de `CRM-040` écrase la valeur fournie quelle qu'elle soit. Le chemin
-- d'insertion est donc déjà sûr ; le fermer ferait rendre `403` à une requête que le produit
-- accepte aujourd'hui sans dommage, et casserait tout client qui renvoie la ligne entière.
--
-- Aucun trigger n'est ajouté non plus (décision 141). Un `BEFORE UPDATE` qui restaurerait
-- `OLD.email_local_part` rendrait `200` à un appelant qui croirait avoir renommé l'adresse : c'est
-- la « valeur par défaut trompeuse » que `CLAUDE.md` §18 range parmi les manières de masquer une
-- erreur. Un trigger qui lèverait une exception ferait double emploi avec le privilège, lequel est
-- vérifié par le moteur avant toute exécution et vaut pour tout chemin SQL.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration ne livre pas, et qui reste à `CRM-013`.
-- ---------------------------------------------------------------------------------------------
-- L'énoncé de `CRM-013` porte six cibles. Cinq portent sur des tables qui n'existent pas, et
-- `to_regclass` le mesure plutôt que de le supposer : `mail_inbound_accounts` et
-- `mail_outbound_identities` (`CRM-052`, `CRM-053`), `api_tokens` (`CRM-073`), `card_events`
-- (`CRM-044`), `audit_log` (`CRM-072`). L'unité reste donc `[~]`, et les preuves de refus n° 6 et
-- n° 8 de docs/SPEC-permissions-rls.md §7 restent hors d'atteinte. Chaque absence est **figée par
-- une assertion** de `supabase/tests/0015_colonnes_protegees.test.sql`, qui deviendra rouge le
-- jour où la table naîtra sans que la protection soit écrite (mécanisme de la décision 51).
--
-- ---------------------------------------------------------------------------------------------
-- INC-050 est CLOSE, et par exécution — non par arbitrage.
-- ---------------------------------------------------------------------------------------------
-- Le §5.5 de docs/SPEC-workflow-engine.md se contredisait : sa prose rangeait `email_local_part`
-- parmi ce qui « reste à `CRM-013` », son bloc `GRANT` ne la listait pas. Les deux branches de
-- l'arbitrage attendu ne portaient que sur **l'attribution** — quelle unité ferme la colonne — et
-- non sur le comportement final, identique des deux côtés. Exécuter `CRM-013` tranche
-- l'attribution par son propre énoncé de backlog, sans rien décider à la place du responsable :
-- l'état posé ci-dessous coïncide **exactement** avec le bloc `GRANT` du §5.5 (décision 142).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence, et dépendance d'ordre.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue tout le répertoire à
-- chaque démarrage (docs/JOURNAL.md, décision 20). Cette migration ne fait que poser des
-- privilèges : elle est idempotente par nature, et un `grant update on public.cards` relâché à la
-- main est **réparé** au prochain démarrage.
--
-- DÉPENDANCE D'ORDRE 12 → 14, ET ELLE EST RÉELLE. La migration 12 réapplique elle aussi les
-- privilèges de colonne, `email_local_part` **comprise** (INC-050). Rejouer la 12 seule **rouvre**
-- donc la colonne, sans aucun signal. C'est la troisième occurrence exacte de la décision 108 —
-- après la 3 → 10 de `CRM-012` et la 12 → 13 de `CRM-036`. Tout harnais qui rejoue la 12 doit
-- rejouer la 14 derrière elle ; `scripts/verify-move-card.sh` et
-- `scripts/verify-colonnes-protegees.sh` le font, et la dépendance est inscrite dans
-- docs/PROD_MIGRATIONS.md §3.

-- =============================================================================================
-- 1. `cards.email_local_part` — retrait du privilège d'écriture à `authenticated`
-- =============================================================================================
-- docs/SPEC-permissions-rls.md §4.4.3. Le mécanisme est celui du §4.3, déjà mesuré par `CRM-034` :
-- le privilège `UPDATE` de PostgreSQL s'accorde colonne par colonne, mais il ne se **retire** pas
-- colonne par colonne d'un privilège de table. Le seul chemin est de retirer le privilège de
-- table, puis de rendre nommément les colonnes qui doivent rester ouvertes.
--
-- Le `revoke` porte sur `update` seulement : `select` et `insert`, posés par la migration 0011,
-- sont laissés intacts — le premier parce que l'adresse d'une card est une **identité** et non un
-- secret (elle est affichée à qui peut lire la card), le second pour le motif mesuré ci-dessus.

revoke update on public.cards from authenticated;

-- --- 1.1 Les douze colonnes qui restent ouvertes ----------------------------------------------
-- La liste est celle du §5.5 de docs/SPEC-workflow-engine.md, **à la lettre** : `email_local_part`
-- n'y figure pas, et c'est tout l'objet de cette migration.
--
-- Les colonnes absentes sont fermées par voie de conséquence, et aucune n'est écrite par le client
-- aujourd'hui : `id`, `workspace_id`, `channel_id`, `workflow_id` sont tenus cohérents par les
-- clés composites de `CRM-040` ; `current_step_id` et `entered_step_at` appartiennent à
-- `move_card` (`CRM-034`) ; `health_score` n'est jamais alimentée ; `created_by`, `created_at` et
-- `updated_at` sont posés à l'insertion ou par trigger ; `search_tsv` est générée et n'a jamais
-- été modifiable.
--
-- CONSÉQUENCE À CONNAÎTRE AVANT D'AJOUTER UNE COLONNE À `cards` : toute colonne nouvelle est
-- **fermée par défaut** par ce mécanisme. `supabase/tests/0015_colonnes_protegees.test.sql`
-- énumère les douze ouvertes une par une, de sorte qu'une fermeture trop large — ou un oubli
-- d'énumération dans une migration ultérieure — fasse échouer la suite.

grant update (
	title, description, position, owner_id, amount, currency,
	probability_override, next_action, next_action_at, snoozed_until,
	archived_at, deleted_at
) on public.cards to authenticated;

-- `service_role` conserve `all privileges` de la migration 0011 : le `revoke` ci-dessus ne vise
-- qu'`authenticated`. Le seed, qui écrit avec la clé de service, est donc **inchangé**.
--
-- CE QUE CELA LAISSE OUVERT, ET QUI EST NOMMÉ (décision 141, docs/SPEC-permissions-rls.md §4.4.3) :
-- un service porteur de `service_role` peut encore écrire cette colonne. C'est voulu — le seed en
-- dépend —, mais cela signifie qu'un service qui se tromperait de colonne ne serait arrêté par
-- rien. Aucun consommateur n'existe aujourd'hui ; la question devra être reposée le jour où
-- `mail-sync` (`CRM-051`) écrira sur `cards`.

comment on column public.cards.email_local_part is
	'CRM-040 — docs/SPEC-cards.md §3. Partie locale de l''adresse de la card, générée par trigger, '
	'non devinable. L''adresse complète — avec `workspaces.inbound_domain` — n''est pas stockée : '
	'c''est une dérivation, et un domaine peut changer (§3.5). '
	'CRM-013 — docs/SPEC-permissions-rls.md §4.4 : NON MODIFIABLE par `authenticated`, le privilège '
	'UPDATE lui est retiré. `service_role` conserve l''écriture.';

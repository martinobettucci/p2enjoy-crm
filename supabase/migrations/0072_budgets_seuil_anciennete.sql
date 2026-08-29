-- @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 4b : le socle du seuil
--       d'ancienneté d'une ligne de coût
-- @spec docs/SPEC-costs.md §2.1 (attributs de `budgets`), §2.1 bis (l'arbitrage d'INC-183, ligne à
--       ligne), §4.1 (le champ s'administre dans le track), §4.8.1 point 2 (révisé par livraison)
-- @spec docs/SCHEMA.md §9 bis.4 (`budgets`)
-- @spec docs/DESIGN_SYSTEM.md §5.31 (les trois états de la colonne « Ancienneté »)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 72)
-- @spec docs/JOURNAL.md décision 549 (l'arbitrage, ses huit mesures, les issues écartées)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET C'EST TOUT.
-- ---------------------------------------------------------------------------------------------
-- Une colonne et sa contrainte de forme. **Aucune politique, aucun privilège, aucun trigger,
-- aucune fonction, aucun index.** L'écriture d'un budget est celle que la migration 50 a posée —
-- `app.is_workspace_admin` —, et une colonne de plus sur une table dont la RLS est déjà écrite
-- n'ouvre rien : elle n'est rendue que sur une ligne que la politique a déjà consentie, et elle
-- n'est écrite que sur une ligne que la politique laisse écrire. MESURÉ le 2026-08-29 (mesure M8
-- de la décision 549) : un `PATCH` de `budgets` par un membre non administrateur rend `200` et
-- **zéro ligne**, la clause `USING` filtrant la ligne — jamais un `403`.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LE SEUIL EST UNE DONNÉE, ET POURQUOI IL N'A AUCUN REPLI.
-- ---------------------------------------------------------------------------------------------
-- `docs/DESIGN_SYSTEM.md` §5.31 promettait depuis le premier jour que la colonne « Ancienneté »
-- de la table de saisie passe en danger « au delà d'un seuil, comme la pastille d'ancienneté
-- d'une card ». Ce seuil n'existait nulle part pour une ligne de coût : celui d'une card vit sur
-- son étape de workflow (`workflow_steps.stale_after_days`, migration 6), avec le repli du
-- catalogue (`workflow_nodes_catalog.default_stale_after_days`, migration 5). C'était INC-183,
-- consignée le 2026-08-20 et tranchée le 2026-08-29 par la décision 549.
--
-- L'objet qui gouverne le rythme d'une ligne de coût est son **budget** : un achat d'espace
-- publicitaire se facture en quelques jours, un salon se solde après l'événement. La colonne vit
-- donc ici, et le parallèle du §5.31 est exact des deux côtés — même forme visuelle, et même
-- doctrine de résolution.
--
-- **AUCUN REPLI, et c'est délibéré.** Le repli d'une card existe parce qu'une étape est la COPIE
-- d'un nœud du catalogue, et que le catalogue porte la valeur par défaut. Un budget n'est la copie
-- de rien : ni `budget_occurrences`, ni `tracks`, ni `workspaces` ne reçoivent de seuil, et la
-- résolution se fait en un seul temps — le sien, ou rien. *Un seuil absent ne devient jamais un
-- seuil par défaut* (`docs/SPEC-relances.md` §2.2, tenue côté client par `seuilEffectif` de
-- `webapp/src/lib/carte-figee.ts`). Une ligne d'un budget sans seuil n'est donc JAMAIS en retard,
-- fût-elle vieille de mille jours, exactement comme une affaire posée sur l'étape `Livré` du seed,
-- qui ne déclare aucun seuil et dont les affaires ne sont jamais figées.
--
-- ---------------------------------------------------------------------------------------------
-- LA FORME EST CELLE DES DEUX AUTRES SEUILS DU DÉPÔT, ET C'EST VOULU.
-- ---------------------------------------------------------------------------------------------
-- `integer` nullable sans défaut, `CHECK (is null or > 0)`, contrainte nommée
-- `<table>_stale_check` : c'est mot pour mot `workflow_steps_stale_check` (migration 6) et
-- `workflow_nodes_catalog_stale_check` (migration 5). Trois seuils de même nature écrits de trois
-- façons différentes se seraient mis à diverger au premier ajustement.
--
-- **`0` EST REFUSÉ, ET CE N'EST PAS UN DÉTAIL.** Un seuil de zéro jour rendrait toute ligne en
-- retard dès sa création, c'est-à-dire un signal qui ne distingue plus rien. Il serait de surcroît
-- indistinguable, à la lecture d'un formulaire, d'un champ qu'on a voulu vider : le vide envoie
-- `null` — *aucun seuil décidé* —, et il n'existe aucune saisie légitime qui envoie `0`.
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE LE RETOUR ARRIÈRE COÛTE.
-- ---------------------------------------------------------------------------------------------
-- `alter table public.budgets drop column stale_after_days;` — la contrainte tombe avec la
-- colonne. La perte est réelle mais bornée : les seuils saisis par les administrateurs
-- disparaissent, et rien d'autre. Aucune ligne de coût, aucun budget n'est touché.
-- `docs/PROD_MIGRATIONS.md` §3 porte la requête de sauvegarde préalable.
--
-- AUCUN `begin` / `commit` DANS CE FICHIER, et c'est la convention des migrations voisines (50, 71)
-- plutôt qu'un oubli : le `migrations-runner` enveloppe déjà chaque fichier dans sa transaction, et
-- un `begin` de plus rend « there is already a transaction in progress », suivi d'un `commit` qui
-- ferme la transaction du runner — MESURÉ le 2026-08-29 en écrivant ce fichier.

-- La colonne est ajoutée **nullable et sans défaut** : PostgreSQL ne réécrit alors pas la table,
-- et surtout toutes les lignes existantes naissent à `null`, c'est-à-dire *aucun seuil décidé*.
-- Un défaut, même « raisonnable », serait la règle de gestion que personne n'a prise — et il
-- allumerait rétroactivement le signal sur des budgets dont personne n'a jamais décidé le rythme.
alter table public.budgets
	add column if not exists stale_after_days integer;

-- `drop … if exists` puis `add` : la migration est rejouable, le `migrations-runner` ne tenant
-- aucun registre et rejouant tout le répertoire (`docs/CloudWorker.md` §2.2 bis).
alter table public.budgets drop constraint if exists budgets_stale_check;
alter table public.budgets add  constraint budgets_stale_check
	check (stale_after_days is null or stale_after_days > 0);

comment on column public.budgets.stale_after_days is
	'Seuil d''ancienneté, en jours, des lignes de coût de ce budget restées sans coût réel. '
	'NUL = aucun seuil décidé, et AUCUNE ligne n''est alors signalée en retard : un seuil absent '
	'ne devient jamais un seuil par défaut (docs/SPEC-costs.md §2.1 bis, arbitrage d''INC-183). '
	'Aucun repli sur l''occurrence, le track ou le workspace. Une ligne est en retard lorsque son '
	'ancienneté en jours révolus est STRICTEMENT supérieure à cette valeur.';

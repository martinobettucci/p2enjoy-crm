# Spécification — Rattacher une affaire à plusieurs channels

- Unité de backlog : **`CRM-111`** — « Rattachements multiples d'une affaire ». Les champs personnalisés communs de
  portée espace forment une **seconde unité**, `CRM-112`, livrée **après** celle-ci (décision 645) ; elle n'est pas
  spécifiée ici (§16).
- Arbitrages : `docs/JOURNAL.md`, décisions **637** (CRM se lit *Company Resource Mastering*), **638** (exploration, sens
  arbitré), **639**, **642** et **643** (arbitrages des points ouverts), **645** (découpage, ordre, vocabulaire), **657**
  (messagerie), **658** (langue des noms), **661** (signatures remplacées d'un coup), **662** (validation).
- Documents liés : `docs/SCHEMA.md` §4 et §5, `docs/SPEC-cards.md`, `docs/SPEC-form-composer.md` §2 et §6,
  `docs/SPEC-permissions-rls.md` §3 et §4, `docs/SPEC-workflow-engine.md` §6, `docs/SPEC-change-channel-workflow.md`,
  `docs/SPEC-analytique.md`, `docs/SPEC-relances.md`, `docs/SPEC-recettes.md` §4 à §7, `docs/SPEC-costs.md` §3,
  `docs/SPEC-mail-subsystem.md`, `docs/SPEC-mcp.md` §6.1 et §9.2, `docs/SPEC-webapp.md` §5.1 bis.
- État : **validée par le responsable le 2026-10-24** (décision 662). Les passages encore marqués **[proposition]** sont
  acceptés avec la spécification ; la tranche T1 les confronte aux mesures, et tout écart revient au responsable.

Les passages marqués **[proposition]** sont des choix de rédaction de l'agent, non arbitrés ; ceux marqués **[à
trancher]** sont des questions nouvelles, apparues en lisant le schéma réel, et listées au §15.

---

## 1. Objet

Une **affaire** peut être **rattachée à plusieurs channels**, y compris de tracks différents. Le sens retenu (décision
638, arbitrage 1) : **la même affaire traverse plusieurs processus en parallèle** — vente, production, administration.
Plusieurs ventes au même client restent **plusieurs affaires**.

- **Chaque rattachement a son propre état** : étape du workflow de son channel, responsable, prochaine action, montant,
  issue, sommeil, archivage (décision 639).
- **La fiche montre une partie commune et un bloc par rattachement.** Le bloc porte les champs du workflow du channel ;
  la partie commune porte ce qui appartient à l'affaire.
- **Coûts, recettes et temps sont comptés une seule fois**, par l'affaire, et se reportent dans la vue de chaque
  rattachement.

**Vocabulaire** (décision 645, arbitrage 4) : l'interface et le manuel disent **« rattachement »** — « rattacher à un
channel », « retirer le rattachement », « aussi rattachée à … ». « Suivre » est réservé à l'abonnement aux
notifications.

**Connecteur MCP : oui** (décision 639, arbitrage 4), famille `affaires` — §11.

## 2. Ce que la base porte aujourd'hui — mesuré le 2026-10-23 sur la pile locale

**`public.cards`** porte en une ligne l'identité de l'affaire **et** son unique rattachement :

```
id, workspace_id, channel_id, workflow_id, current_step_id, title, description, position, owner_id, amount,
currency, probability_override, next_action, next_action_at, entered_step_at, health_score, email_local_part,
snoozed_until, archived_at, deleted_at, created_by, created_at, updated_at, search_tsv, deleted_by
```

- **Trois politiques**, toutes sur la colonne `channel_id` : lecture `app.can_read_channel(channel_id)`, insertion et
  mise à jour `app.can_write_channel(channel_id)`. Aucune suppression.
- **Colonnes modifiables par `authenticated`** : `amount`, `archived_at`, `currency`, `deleted_at`, `description`,
  `next_action`, `next_action_at`, `owner_id`, `position`, `probability_override`, `title`.
- **Clés sortantes** : `(channel_id, workflow_id) → channels (id, workflow_id)` *deferrable* — l'affaire suit le workflow
  de son channel ; `(current_step_id, workflow_id) → workflow_steps` ; `(channel_id, workspace_id) → channels`.
- **Tables filles** : `card_field_values` par `(card_id, workflow_id)` ; `card_comments`, `card_contacts`, `card_events`,
  `card_sequence_enrollments`, `notifications`, `saisies_temps` par `(card_id, workspace_id)` ; `card_costs`,
  `card_revenues`, `mail_messages`, `mail_attachments`, `mail_outbox` par `card_id`.
- **Huit déclencheurs** : événements de timeline (insertion, mise à jour, sommeil), position, corbeille, devise
  verrouillée, adresse mail, restauration, `updated_at`.
- **Trente-neuf fonctions** des schémas `public` et `app` lisent `cards`. Celles qui lisent au moins une colonne qui
  change de table (§3.2), par groupe :

| Groupe | Fonctions |
|---|---|
| Droits | `app.can_read_card_pour`, `app.can_write_card` (`channel_id`) |
| Gestes | `creer_affaire`, `move_card`, `move_card_to_channel`, `snooze_card`, `wake_card`, `change_channel_workflow`, `plan_card_remapping`, `restore_workflow_version`, `app.appliquer_composition`, `app.cards_attribuer_position` |
| Lectures métier | `cards_figees`, `entonnoir_conversion`, `rentabilite_affaires`, `temps_valorise`, `recherche_globale`, `occupation_du_workflow`, `previsualiser_exigence`, `app.catalogue_refuser_archivage_noeud_occupe`, `app.defauts_proposition_ia` |
| Ordonnanceur | `app.relancer_cards_figees`, `app.executer_sequences_relance` (`entered_step_at`), `armer_sequence_relance` (`owner_id`) |
| Messagerie | `chemin_dossier_card`, `inbox_arborescence` (`channel_id`), `rendre_modele_email`, `app.mail_template_variables` (`amount`, `next_action`, `next_action_at`), `queue_outbound_email` (`owner_id`), `app.card_par_adresse`, `classify_message`, `classer_message_automatiquement` |

Certaines occurrences d'`archived_at` visent celui d'un channel ou d'un track, non de l'affaire : la tranche T1 relit
chaque fonction et rend la liste exacte, **mesurée**, de celles qui changent.

- **Côté webapp**, dix-neuf modules lisent `channel_id` et une trentaine `archived_at` ; écrans directement concernés :
  `Board`, `ListeCards`, `RouteCard`, `EnTeteCard`, `FormulaireCard`, `MaJournee`, `AffairesFigees`, `Pilotage`,
  `Rentabilite`, `BlocRentabiliteCard`, `BlocSequenceCard`.
- **Volume** : 41 affaires dans la base de développement seedée.

## 2 bis. Mesures de la tranche T1 — 2026-10-24, base jetable

Mesurées sur `crm111_mesure`, copie par `pg_dump` de la base de développement dans le même conteneur. La copie a été
supprimée ensuite, et la base de développement n'a reçu aucune écriture. Scripts : `docs/mesures/CRM-111/`.

### 2 bis.1 Ce que le retrait des colonnes casse — relevé exact

Les treize colonnes du §3.2 sont retirées de `cards` dans une transaction annulée. `plpgsql_check` contrôle ensuite
chaque fonction plpgsql de `public` et `app`, déclencheurs compris, et chaque fonction SQL est recréée telle quelle.

**Dépendances déclarées emportées par le retrait** : les trois politiques de `cards`, la clé
`card_field_values_card_id_workflow_id_fkey`, et le déclencheur `card_events_apres_maj_sommeil`. Aucune vue n'en
dépend, ni la colonne `search_tsv`.

**31 fonctions cassent** (contre une erreur sur la copie intacte, hors de propos) :

| Groupe | Fonctions |
|---|---|
| Droits | `app.can_read_card_pour`, `app.can_write_card`, `public.ecriture_permise` (colonne calculée) |
| Déclencheurs de `cards` | `app.card_events_apres_insertion_card`, `app.card_events_apres_maj_card`, `app.cards_attribuer_position`, `app.cards_restauration_verifier_parent` |
| Gestes | `creer_affaire`, `move_card`, `move_card_to_channel`, `snooze_card`, `wake_card`, `change_channel_workflow`, `plan_card_remapping`, `app.appliquer_composition` |
| Lectures métier | `cards_figees`, `entonnoir_conversion`, `rentabilite_affaires`, `temps_valorise`, `recherche_globale`, `occupation_du_workflow`, `previsualiser_exigence`, `app.catalogue_refuser_archivage_noeud_occupe`, `app.defauts_proposition_ia` |
| Messagerie | `chemin_dossier_card`, `inbox_arborescence`, `rendre_modele_email`, `queue_outbound_email`, `classify_message`, `classer_message_automatiquement`, `app.card_par_adresse` |

**Ce que le relevé textuel du §2 avait mal vu.**
- Il manquait quatre fonctions : les deux déclencheurs de timeline, `app.cards_restauration_verifier_parent` et
  `public.ecriture_permise`.
- D'autres qu'il citait ne cassent pas directement : `armer_sequence_relance`, `app.mail_template_variables`,
  `app.relancer_cards_figees`, `app.executer_sequences_relance`, `restore_workflow_version`. Elles changent pourtant en
  T2 ou T6 : les deux premières par la décision 657, les relances parce qu'elles passent par `cards_figees()`.

**Hors de propos, consigné pour ne pas le reprendre** : `plpgsql_check` signale « `attempts` is ambiguous » dans
`reserver_envois` dès la copie intacte. Exécutée sur un envoi réel de la copie, la fonction réserve la ligne sans
erreur : c'est un faux positif de l'analyse statique, pas un défaut.

### 2 bis.2 Les appelants dans le dépôt

Fichiers qui lisent `cards` par PostgREST ou appellent l'une des fonctions touchées. La lecture et l'appel se
recoupent, d'où le total.

| Zone | Fichiers |
|---|---|
| `webapp/src` | 79 |
| `e2e` | 104 |
| `supabase/tests` (pgTAP) | 37, dont 35 lisent `cards` directement, sur 92 |
| `scripts` | 27 |
| `mcp` | 14 |
| `mail-sync` | 4 |
| seed (`supabase/seed/apply-seed.sh`) | 1 |
| **Total** | **266** |

Aucune fonction edge n'est concernée. C'est le périmètre de la bascule T2 (décision 661).

### 2 bis.3 Le coût de la RLS — la politique livrée paie déjà à chaque ligne

Les requêtes mesurées sont celles du produit : `COLONNES_CARD_BOARD`, et la page de liste de `liste-cards.ts`. Elles
sont exécutées sous le rôle `authenticated` et les claims de trois profils du seed : l'administratrice, le business
developer, la lectrice. Le volume synthétique est concentré dans le channel « Maintenance », autant dans les autres
channels. Valeurs en millisecondes.

| Volume par channel | Requête | Livrée | Livrée optimisée | Rattachements | Rattachements optimisés |
|---|---|---|---|---|---|
| 27 (seed) | board | 7 | — | 20 | — |
| 2 027 | board | 542 | 7 | 1 705 | 20 |
| 2 027 | liste, page de 50 | 516 | 7 | 1 724 | 19 |
| 2 027 | fiche | 2 | 6 | 2 | 13 |
| 20 027 | board | 5 133 | 16 | 11 381 | 47 |
| 20 027 | liste, page de 50 | 5 073 | 14 | 11 250 | 45 |
| 20 027 | recherche | 10 213 | 13 | 11 989 | 28 |
| 20 027 | fiche | 4 | 10 | 3 | 26 |

À 2 027 lignes : médiane de cinq exécutions ; à 20 027 lignes : une exécution. Les trois profils donnent les mêmes
valeurs à quelques pour cent près. Toutes les variantes rendent **les mêmes lignes**.

**Constat 1 — la politique livrée coûte environ 0,25 ms par ligne lue**, parce que `app.can_read_channel(channel_id)`
est évaluée **à chaque ligne**. Un board de 2 000 affaires coûte une demi-seconde, et un de 20 000 en coûte cinq. C'est
vrai **aujourd'hui**, sans rattachement. Avec 41 affaires dans le seed, rien ne le montre encore.

**Constat 2 — la forme proposée au §4 double ce coût** : une fonction `security definer` par ligne, qui relit les
rattachements et appelle encore `app.can_read_channel`.

**Constat 3 — la forme optimisée le rend presque constant.**
- La liste des channels lisibles par l'appelant est calculée **une fois** par requête, par `app.readable_channel_ids()`
  (`security definer`), qui applique `app.can_read_channel` à chaque channel de l'espace.
- La politique compare chaque ligne à cette liste : `channel_id in (select unnest(app.readable_channel_ids()))`. Pour
  `cards`, elle prend la forme `id in (select card_id from card_placements where channel_id in (…))`.
- La **sémantique est identique**, puisque la même fonction décide, et les lignes rendues le confirment. Le surcoût fixe
  d'environ 5 ms (le calcul de la liste) se voit sur la fiche ; il est négligeable sur une liste.

**Variante écartée** : une sous-requête corrélée (`exists (… where p.card_id = cards.id and p.channel_id in (…))`)
recalcule la liste à chaque ligne : 4,4 s pour un board de 2 027 affaires.

### 2 bis.3 bis Fraîcheur des droits — la forme optimisée ne donne pas de faux positif, à une condition

Question du responsable : la forme optimisée risque-t-elle de laisser lire une affaire après un changement des
droits ? Preuve sur la base jetable (`04-fraicheur-des-droits.sql`). Les deux requêtes sont préparées **avant** tout
changement et exécutées sous **plan générique**, comme le fait PostgREST. La politique livrée est neutralisée, pour que
chaque requête ne dépende que de sa propre forme. Le profil est le business developer du seed, sur Maintenance.

| Étape | Forme livrée | Forme optimisée (`STABLE`) |
|---|---|---|
| 1. droit initial : `viewer` sur le channel | 27 | 27 |
| 2. droit retiré : `none` | 0 | 0 |
| 3. droit rendu : `member` | 27 | 27 |
| 4. surcharge du channel retirée : droit du track | 27 | 27 |
| 5. rôle d'espace changé, channel fermé | 0 | 0 |
| 6. retiré de l'espace | 0 | 0 |

**Les deux formes suivent chaque changement immédiatement, et à l'identique.** La liste des channels lisibles n'est
mise en cache nulle part : elle est recalculée à chaque requête, sur l'instantané des droits de cette requête, comme la
forme livrée l'est à chaque ligne.

**La condition, prouvée par contre-preuve** (`05-contre-preuve-immutable.sql`). La même fonction déclarée
**`IMMUTABLE`** est figée dans le plan préparé : elle rend **27** affaires aux étapes 2, 5 et 6, c'est-à-dire à une
personne qui a perdu le droit, puis qui a quitté l'espace. D'où trois règles, opposables à toute révision :
- `app.readable_channel_ids()` est **`STABLE`**, jamais `IMMUTABLE` ; un test pgTAP vérifie sa volatilité au catalogue
  (`provolatile = 's'`) ;
- son résultat n'est **jamais mis en cache** hors de la requête : ni dans une variable de session, ni dans une table, ni
  dans une vue matérialisée ;
- la preuve de fraîcheur, avec requêtes préparées sous plan générique, entre dans la suite pgTAP de la tranche T2.

### 2 bis.4 Ce que les mesures changent à la spécification — arbitré le 2026-10-24 (décision 667)

- **Forme des politiques** : le §4 proposait une fonction `security definer` par ligne, 2,2 fois plus lente que la
  politique livrée. **Arbitré : la forme optimisée du §2 bis.3**, avec les trois gardes du §2 bis.3 bis, pour
  `card_placements`, `cards` et `card_field_values`. Le §4 est révisé en conséquence.
- **Le coût par ligne des autres tables filles** (`card_events`, `card_comments`, `card_comment_mentions`,
  `card_contacts`, `card_costs`, `card_revenues`, `card_activities`, `card_activity_participants`,
  `card_sequence_enrollments`, `mail_messages`, `mail_outbox`, `notifications`), qui jugent par `app.can_read_card` à
  chaque ligne : **arbitré, hors de `CRM-111`**. La tranche T2 n'optimise que les tables qu'elle réécrit déjà ; la
  dette restante est consignée en **INC-288**, en attente d'une unité.

### 2 bis.5 Mode opératoire

```bash
source scripts/lib/conteneur.sh; DB=$(conteneur db)   # le service, jamais un nom écrit (CRM-115 T2)
docker exec "$DB" psql -U supabase_admin -d postgres -c 'create database crm111_mesure'
docker exec "$DB" bash -c 'pg_dump -U supabase_admin -d postgres -Fc --exclude-schema=cron > /tmp/m.dump \
  && pg_restore -U supabase_admin -d crm111_mesure /tmp/m.dump; rm -f /tmp/m.dump'   # seules les erreurs cron sont attendues
docker cp docs/mesures/CRM-111/. "$DB":/tmp/mesures/
docker exec "$DB" psql -U supabase_admin -d crm111_mesure -f /tmp/mesures/01-cron-factice.sql
docker exec "$DB" psql -U supabase_admin -d crm111_mesure -f /tmp/mesures/02-fonctions-cassees.sql
docker exec "$DB" psql -U supabase_admin -d crm111_mesure -v vol=2000 -v reps=5 -f /tmp/mesures/03-cout-rls.sql
docker exec "$DB" psql -U supabase_admin -d crm111_mesure -f /tmp/mesures/04-fraicheur-des-droits.sql
docker exec "$DB" psql -U supabase_admin -d crm111_mesure -f /tmp/mesures/05-contre-preuve-immutable.sql
docker exec "$DB" psql -U supabase_admin -d postgres -c 'drop database crm111_mesure'
```

`supabase_admin` est nécessaire : `postgres` n'est pas superutilisateur dans l'image Supabase. Annoncer la copie aux
autres sessions, qui partagent le conteneur.

## 3. Le modèle

### 3.1 `public.card_placements` — table nouvelle

**Nommage** (décision 658, `docs/DAT.md` §12 bis) : les identifiants sont en anglais, le code et l'interface disent
« rattachement ». `card_attachments` est écarté, car « attachments » désigne déjà les pièces jointes
(`mail_attachments`). D'où `card_placements`, `placement_id`, `attach_card`, `detach_card`, et
les événements `attached` et `detached`.

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul ; clé composite `(card_id, workspace_id) → cards (id, workspace_id)` `on delete cascade` |
| `card_id` | `uuid` | non nul |
| `channel_id` | `uuid` | non nul ; clés composites `(channel_id, workspace_id) → channels` et `(channel_id, workflow_id) → channels (id, workflow_id)` *deferrable* — reprises de `cards` |
| `workflow_id` | `uuid` | non nul ; suit le channel, comme aujourd'hui |
| `current_step_id` | `uuid` | non nul ; `(current_step_id, workflow_id) → workflow_steps` ; **non modifiable directement**, comme aujourd'hui |
| `position` | `numeric` | position dans le board du channel ; attribuée par déclencheur |
| `owner_id` | `uuid` | responsable du rattachement ; FK `profiles` `on delete set null` |
| `amount` | `numeric(14,2)` | montant du rattachement ; **devise de l'affaire** (décision 642, arbitrage 3) |
| `probability_override` | `numeric(5,2)` | sinon celle de l'étape |
| `next_action`, `next_action_at` | `text`, `timestamptz` | prochaine action du rattachement |
| `entered_step_at` | `timestamptz` | base des relances |
| `health_score` | `integer` | |
| `snoozed_until` | `timestamptz` | fermée en écriture, écrite par `snooze_card` et `wake_card` |
| `archived_at` | `timestamptz` | rattachement archivé |
| `created_by`, `created_at`, `updated_at` | | posés par la base |

**Contraintes.**

- `UNIQUE (card_id, channel_id)` : une affaire n'est rattachée qu'une fois à un channel. Un rattachement archivé compte :
  rattacher de nouveau, c'est désarchiver **[proposition]**.
- `UNIQUE (id, workflow_id)` : condition de la clé composite de `card_field_values` (§3.3).
- **Toute affaire a au moins un rattachement**, archivé ou non. Tenu par un déclencheur de contrainte *deferred* : la
  création insère l'affaire puis son rattachement dans la même transaction.

### 3.2 Ce qui reste à l'affaire, et ce qui la quitte

**Restent sur `cards`** : `id`, `workspace_id`, `title`, `description`, `currency`, `email_local_part`, `deleted_at`,
`deleted_by`, `created_by`, `created_at`, `updated_at`, `search_tsv`. Restent aussi attachés à l'affaire : commentaires,
contacts, mails, coûts, recettes, saisies de temps, notifications.

**Quittent `cards`** : `channel_id`, `workflow_id`, `current_step_id`, `position`, `owner_id`, `amount`,
`probability_override`, `next_action`, `next_action_at`, `entered_step_at`, `health_score`, `snoozed_until`,
`archived_at`.

**Une affaire archivée** est une affaire dont **tous** les rattachements sont archivés (décision 639). La corbeille reste
un geste de l'affaire entière : `deleted_at` est sur `cards`, et une affaire à la corbeille disparaît de tous ses
channels.

**[proposition] Les colonnes sont retirées de `cards`, pas conservées en miroir.** Une copie synchronisée par
déclencheur serait une seconde vérité, qui mentirait dès qu'une affaire a deux rattachements.

### 3.3 `card_field_values` — les valeurs appartiennent au rattachement

Décision 642, arbitrage 2. La clé passe de `(card_id, field_id)` à **`(placement_id, field_id)`**. La charnière
`workflow_id` est conservée, avec la clé composite `(placement_id, workflow_id) → card_placements (id,
workflow_id)` : elle garantit, comme aujourd'hui, qu'une valeur ne répond qu'à une question de son workflow.

**[proposition]** `card_id` est conservé et dénormalisé, sa vérité garantie par une clé composite `(placement_id,
card_id)`. Il sert la timeline (`field_changed`) et la recherche, sans relire le rattachement.

### 3.4 Champs obligatoires et transitions

Les champs exigés par une transition (`workflow_transition_required_fields`) et la visibilité par étape
(`form_field_rules`) se lisent **sur le rattachement** : son étape, ses valeurs. Rien ne change dans leurs tables.

## 4. Autorisations — toutes appliquées en base (`CLAUDE.md` §10)

| Objet ou geste | Autorisé lorsque |
|---|---|
| Lire l'**affaire** et sa partie commune (commentaires, contacts, mails, coûts, recettes, temps) | l'appelant lit **au moins un** des channels rattachés, archivés compris (décision 642, arbitrage 1) |
| Lire un **rattachement** et ses **valeurs de bloc** | `app.can_read_channel(channel_id)` du rattachement |
| Écrire la **partie commune** (titre, description, contacts, coûts, recettes) | l'appelant écrit **au moins un** des channels rattachés (décision 639, arbitrage 3) |
| Écrire un **rattachement** : bloc, étape, responsable, prochaine action, montant, sommeil, archivage | `app.can_write_channel(channel_id)` du rattachement |
| **Rattacher** à un channel | l'appelant écrit l'affaire (un channel suffit) **et** écrit le channel cible |
| **Retirer** un rattachement | `app.is_workspace_admin` ; jamais le dernier (décision 643, arbitrage 3) |

**Un rattachement à un channel illisible est masqué, existence comprise.** La RLS de `card_placements` ne le rend
pas. Aucune fonction ne révèle le nombre total de rattachements d'une affaire à qui ne les lit pas tous.

**Ce qui change dans la chaîne d'accès.** `app.can_read_card_pour` et `app.can_write_card` deviennent « il existe un
rattachement dont le channel est lisible (ou écrivable) ».

**Les politiques de lecture prennent la forme optimisée** (décision 667, mesures du §2 bis.3). La liste des channels
lisibles par l'appelant est calculée **une fois par requête** par `app.readable_channel_ids()` — `STABLE`,
`security definer`, qui applique `app.can_read_channel` à chaque channel —, puis chaque ligne lui est comparée :

```sql
-- card_placements
using (channel_id in (select unnest(app.readable_channel_ids())))
-- cards
using (id in (select p.card_id from public.card_placements p
              where p.channel_id in (select unnest(app.readable_channel_ids()))))
-- card_field_values
using (placement_id in (select p.id from public.card_placements p
                        where p.channel_id in (select unnest(app.readable_channel_ids()))))
```

La politique de `cards` lit `card_placements`, une **autre** table : la règle du §3.5 de
`docs/SPEC-permissions-rls.md` est respectée. **Trois gardes**, prouvées en T2 (§2 bis.3 bis) : la fonction est `STABLE`
et un test pgTAP vérifie `provolatile = 's'` ; son résultat n'est jamais mis en cache hors de la requête ; une preuve de
fraîcheur rejoue, en requêtes préparées sous plan générique, un retrait et un rendu de droit. Les politiques
d'**écriture** restent jugées ligne à ligne : elles ne portent que sur la ligne écrite.

**Conséquences pour les tables filles.**
- `card_costs` garde sa double condition (affaire **et** budget, `docs/SPEC-costs.md` §3.1).
- Les mentions et notifications s'appuient sur `app.can_read_card_pour`, donc sur la nouvelle règle.
- Un changement d'étape du rattachement B ne prévient que qui lit le channel de B **[proposition]**.

## 5. Les gestes

| Geste | Fonction | Règle |
|---|---|---|
| Créer une affaire | `creer_affaire(p_channel, p_titre)` — signature inchangée | crée l'affaire **et** son premier rattachement, à l'étape initiale |
| Rattacher | `attach_card(p_card, p_channel)` — nouvelle | **étape initiale** du workflow du channel, bloc vide (décision 643, arbitrage 2) ; si un rattachement archivé existe déjà, il est désarchivé tel quel |
| Faire avancer | `move_card(p_placement, to_step_id, comment)` — signature **remplacée** | fait avancer un rattachement ; les champs exigés se lisent sur ses valeurs |
| Déplacer vers un autre channel | `move_card_to_channel(p_placement, to_channel_id, to_step_id, discard_field_values)` — signature **remplacée** | déplace **un rattachement** ; refusé si l'affaire est déjà rattachée au channel cible |
| Sommeil, réveil | `snooze_card(p_placement, until)`, `wake_card(p_placement)` — signatures **remplacées** | par rattachement |
| Armer une cadence | `armer_sequence_relance(p_placement, p_sequence_id, p_identity_id)` — signature **remplacée** | l'inscription désigne le rattachement (décision 657, arbitrage 2) |
| Archiver, désarchiver | mise à jour de `archived_at` du rattachement | droit d'écriture sur son channel |
| Retirer | `detach_card(p_placement, discard_field_values)` — nouvelle | administrateur ; refusé sur le dernier ; la perte des valeurs exige `discard_field_values = true`, selon la doctrine de `move_card_to_channel` |
| Changer le workflow d'un channel | `change_channel_workflow` | remappe **les rattachements** du channel |

**Les signatures sont remplacées d'un coup** (décision 661). Aucune forme par `card_id` ne survit pour les gestes d'un
rattachement, et aucun double contrat n'est maintenu. Les anciennes signatures sont **supprimées** (`drop function`), et
non surchargées : PostgREST choisit une surcharge par le nom de ses arguments, et une ancienne forme oubliée continuerait
de répondre. Tous les appelants passent dans le **même** changement — webapp, connecteur MCP, seed, scripts, pgTAP,
E2E : une centaine de fichiers au relevé du 2026-10-24. C'est la tranche de bascule du §14. `creer_affaire` garde sa
signature, car elle désigne un channel et non un rattachement.

**Timeline.** `card_events` reçoit une colonne `placement_id`, nulle pour les événements de l'affaire (création,
corbeille, contacts, mails), et renseignée pour `moved`, `assigned`, `snoozed`, `woken`, `stalled`, `archived`,
`unarchived` et `field_changed`. **Deux valeurs s'ajoutent au vocabulaire** : `attached` et `detached`. Elles sont
ajoutées dans le **même** changement que le déclencheur qui les écrit, comme l'a été `channel_changed`. Les événements
existants reçoivent le rattachement unique de leur affaire à la migration (décision 670).

**L'exception à l'immuabilité, et sa seule forme permise** (décision 670). `card_events` refuse toute mise à jour, par le
déclencheur `card_events_refuser_maj` (`docs/SCHEMA.md` §5). La migration le **suspend** dans sa propre transaction, le
temps d'une seule instruction : `update … set placement_id = …` sur les événements de rattachement (`moved`, `assigned`,
`channel_changed`, `workflow_changed`, `archived`, `unarchived`, `snoozed`, `woken`, `stalled`, `field_changed`) dont
`placement_id` est nul. Elle le **réactive** aussitôt. Aucune autre colonne n'est écrite, et une assertion pgTAP prouve
que type, charge utile, acteur et horodatage des événements existants sont inchangés. Hors de cette migration, le
déclencheur n'est jamais suspendu.

## 6. Analytique et relances

- **Entonnoir** (`entonnoir_conversion`) : une ligne par **rattachement**, montant et probabilité du rattachement. Le
  total de l'espace **additionne** les montants des rattachements (décision 639, arbitrage 2).
- **Affaires figées** (`cards_figees`, `app.relancer_cards_figees`) : par rattachement, sur son `entered_step_at`. Un
  rattachement peut être figé pendant que l'autre avance.
- **Ma journée** : les prochaines actions des rattachements dont l'appelant est responsable.
- **Rentabilité** (`rentabilite_affaires`) : **une ligne par rattachement × devise** (décision 643, arbitrage 1).
  L'état et le montant sont ceux du rattachement. Les coûts, les recettes et le personnel de l'affaire sont rappelés
  sur chaque ligne avec une colonne `shared` (vrai quand l'affaire a plusieurs rattachements lisibles), et le total de
  l'écran ne les compte **qu'une fois**. Le filtre d'état s'applique à l'état du rattachement. Le contrat d'API change :
  `docs/SPEC-recettes.md` §5 et l'outil `crm_profitability_report` sont mis à jour dans la même tranche.
- **Temps valorisé** (`temps_valorise`) : les saisies restent attachées à l'affaire. La ventilation par channel montre
  l'affaire dans chaque channel rattaché, marquée partagée, comme la rentabilité **[proposition]**.

## 7. Messagerie

- **L'adresse de l'affaire ne change pas** (`email_local_part` reste sur `cards`), et un mail classé appartient à
  l'affaire : il est lisible depuis tout rattachement lisible (décision 642, arbitrage 1).
- **Le dossier IMAP de l'affaire sort de l'arborescence** (décision 657, arbitrage 1). `chemin_dossier_card` rend
  aujourd'hui `CRM/<track>/<channel>/<affaire>`, et ce dossier existe réellement sur le serveur IMAP. Il devient
  `CRM/Affaires/<affaire>` pour **toutes** les affaires, quel que soit leur nombre de rattachements. Conséquences : les
  dossiers existants sont **déplacés** sur le serveur IMAP par `mail-sync`, qui est le seul à écrire dans la boîte ;
  `inbox_arborescence` ne range plus les affaires sous leurs channels ; deux affaires de même titre restent
  distinguées par la règle de nommage en vigueur, à relire en T6.
- **Une cadence de relance s'inscrit à un rattachement** (décision 657, arbitrage 2). `card_sequence_enrollments` reçoit
  le rattachement ; `armer_sequence_relance` prend son responsable comme expéditeur par défaut, et
  `app.executer_sequences_relance` lit son `entered_step_at`. Une affaire peut avoir une cadence par rattachement.
- **Les variables des modèles d'email viennent du rattachement d'où l'on écrit** (décision 657, arbitrage 3).
  `app.mail_template_variables` et `rendre_modele_email` reçoivent le rattachement : le bloc depuis lequel l'email est
  rédigé dans la webapp, ou le rattachement désigné par un envoi MCP (`crm_mail_send`).

## 8. Écrans

- **Board et liste d'un channel** : l'affaire paraît dans chaque channel où elle est rattachée, à l'étape de **ce**
  rattachement, avec ses responsable, montant et prochaine action. Une pastille « aussi rattachée à N » ne compte que
  les rattachements lisibles ; son survol, ou son focus, les nomme.
- **La fiche** (`/tracks/:slugTrack/:slugChannel/cards/:idCard`) :
  - **en tête, la partie commune** : titre, description, contacts, mails, commentaires, coûts, recettes, temps ;
  - **puis un bloc par rattachement lisible**. Le bloc du channel de l'adresse vient en premier et est ouvert ; les
    autres sont repliés **[proposition]**. Chaque bloc porte l'étape et ses transitions, les champs du workflow, le
    responsable, la prochaine action, le montant, le sommeil et l'archivage ;
  - le bouton **« Rattacher à un channel »** propose les channels que l'appelant écrit et auxquels l'affaire n'est pas
    rattachée ;
  - **« Retirer le rattachement »** n'est rendu qu'aux administrateurs, désactivé sur le dernier rattachement, avec une
    confirmation qui nomme la perte des valeurs.
- **Adresse d'un channel sans rattachement** : l'affaire n'est pas introuvable, mais elle n'est pas là. L'écran le dit
  et propose les rattachements lisibles **[proposition]**. Le fil d'Ariane de `CRM-110` suit le channel de l'adresse.
- **Ma journée, Affaires figées, Pilotage, Rentabilité** : une ligne par rattachement, la partie commune rappelée.
- `docs/DESIGN_SYSTEM.md` recevra le bloc de rattachement, la pastille « aussi rattachée à » et la confirmation de
  retrait, et `docs/manual.md` un chapitre « Rattacher une affaire à plusieurs channels », dans les tranches qui les
  livrent.

## 9. Recherche

`recherche_globale` rend **une ligne par affaire**. Elle nomme les rattachements lisibles, et le lien mène au premier
d'entre eux dans l'ordre des tracks et des channels **[proposition]**.

## 10. Migration et reprise

1. Créer `card_placements`, puis y copier une ligne par affaire depuis les colonnes de `cards`, en conservant les
   valeurs. Le rattachement unique de chaque affaire existante a l'`id` d'une nouvelle ligne.
2. Repointer `card_field_values` vers le rattachement unique de son affaire, puis renseigner `card_events.placement_id`
   pour les événements de rattachement.
3. Réécrire les fonctions du §2, les politiques et les déclencheurs ; retirer les colonnes de `cards` en dernier.
4. Régénérer les types (`webapp/src/lib/database.types.ts`).

**Retour arrière.** Il reste possible tant que chaque affaire n'a qu'un rattachement : on recopie les colonnes. Il ne
l'est plus dès qu'une affaire en a deux, car il faudrait choisir lequel perdre. `docs/PROD_MIGRATIONS.md` le dit, et
recommande une sauvegarde avant application.

**Production** : migration à appliquer par l'humain, jamais automatiquement (`CLAUDE.md` §9 et §24).

## 11. Connecteur MCP — famille `affaires`

`CRM-104` n'est pas livrée : ses outils s'inscrivent à son catalogue (`docs/SPEC-mcp.md` §9.2), mis à jour à la
validation de cette spécification. La famille s'appellera `cards` quand le lot 1 du plan d'INC-286 aura renommé la
matrice ; d'ici là, c'est `affaires`.

| Action | Outils |
|---|---|
| `consulter` | `crm_card_get` rend la partie commune et les rattachements lisibles ; `crm_card_list` liste les rattachements d'un channel |
| `ajouter` | `crm_card_attach` — rattacher à un channel |
| `modifier` | `crm_card_move` et `crm_card_move_to_channel` désignent **un rattachement** ; `crm_card_snooze`, `crm_card_wake` ; `crm_card_placement_update` — responsable, prochaine action, montant, champs du bloc |
| `supprimer` | `crm_card_placement_archive` — **archiver** un rattachement ; **aucun outil de retrait** : c'est un geste d'administrateur dans la webapp (décision 643) |

**Famille `recettes`** : `crm_profitability_report` suit le nouveau contrat de `rentabilite_affaires` (§6).

## 12. Seed

Le seed doit démontrer chaque règle, par les vraies fonctions (`creer_affaire`, `attach_card`) :

- une affaire rattachée à **deux channels de deux tracks** — une vente et une production —, avec deux responsables,
  deux montants et deux étapes ;
- une affaire avec un **rattachement archivé** et un actif ;
- un **rattachement en sommeil** sur une affaire dont l'autre rattachement est actif ;
- deux rattachements qui suivent le **même workflow** global, avec des valeurs de bloc différentes ;
- la **lectrice** du seed lit un seul des deux channels : elle voit la partie commune et un seul bloc, et rien ne lui
  révèle l'autre.

## 13. Preuves attendues

| Niveau | Preuve |
|---|---|
| pgTAP | invariants (au moins un rattachement, unicité, clés composites, dernier rattachement non retirable) ; masquage d'un rattachement illisible ; **aucune** ancienne signature par `card_id` ne subsiste (catalogue) ; vocabulaire `attached` et `detached` ; une mutation tuée par règle |
| API, avec les jetons réels | la lectrice ne lit ni le rattachement ni les valeurs du channel qu'elle ne lit pas ; un membre qui écrit un seul channel modifie le titre mais pas le bloc de l'autre ; un non-administrateur ne retire pas ; entonnoir et rentabilité rejoués sur le seed |
| Unitaires | la fiche (partie commune et blocs), la pastille, la confirmation de retrait, l'agrégation « comptée une fois » |
| E2E | rattacher une affaire depuis la fiche, la voir dans le board de l'autre channel, la faire avancer dans un seul, archiver un rattachement, retrait par l'administratrice, masquage pour la lectrice |
| Visuel | captures JPEG de la fiche à deux blocs aux quatre paliers, du board avec la pastille, de la confirmation de retrait, de l'état de la lectrice |
| MCP | les outils du §11 contre la vraie base, refusés par la matrice puis par le CRM |

## 14. Tranches proposées

**Révisé par la décision 705 (option B du responsable).** La bascule se livre en **quatre étapes**, chacune laissant
`main` vert : T2.1 la table `card_placements` et la reprise, `cards` restant le chemin d'écriture et synchronisée par
déclencheur ; T2.2 les lectures ; T2.3 les signatures, par groupe ; T2.4 le retrait des colonnes. La règle de la décision
661 est tenue **fonction par fonction** : aucune fonction n'expose jamais deux contrats à la fois. Le §3.2 ne conserve
donc les colonnes en miroir que pendant la transition, jamais au terme de T2. Le texte d'origine suit.

**T2.1, livrée en développement le 2026-10-26** (migration `0108`). Trois choix de transition, que T2.3 et T3 lèvent :
la clé `(channel_id, workflow_id)` du rattachement est **`initially deferred`**, car `change_channel_workflow` change le
workflow du channel avant celui des affaires en ne différant que la clé de `cards` ; un index unique sur `card_id` garde
**un rattachement par affaire**, ce qui permet au miroir de désigner « le » rattachement sans choisir — T3 le retire avec
`attach_card` ; et **personne n'écrit la table**, `service_role` compris, le déclencheur de `cards` étant son seul
écrivain. Mesuré avant la livraison : sous une sentinelle qui vérifie l'égalité après chaque instruction écrivant `cards`,
toute la suite pgTAP reste sans écart, et la même sentinelle, miroir désactivé, fait échouer 25 suites ; PostgREST ne voit
dans la table aucune relation plusieurs-à-plusieurs, et les plongements existants sont inchangés.

**Le remplacement d'un coup impose une tranche de bascule** (décision 661). Dès que les colonnes quittent `cards`, tout
ce qui les lit casse : la migration, les fonctions et leurs appelants ne peuvent pas se livrer séparément. La bascule ne
change **rien de visible**, car chaque affaire garde son unique rattachement : c'est sa preuve, puisque toute la suite
existante reste verte. Les fonctionnalités nouvelles s'y ajoutent ensuite, tranche par tranche.

| Tranche | Contenu |
|---|---|
| T1 | **Mesures, sans code livré** : la liste exacte des fonctions, déclencheurs, politiques et appelants touchés ; le coût de la nouvelle RLS (`EXPLAIN ANALYZE` du board et de la liste sur le seed, sur une copie jetable) |
| T2 | **Bascule, en un seul changement** : migration (table, reprise des données, `card_field_values`, `card_events`, `card_sequence_enrollments`, invariants, politiques, retrait des colonnes de `cards`) ; réécriture de toutes les fonctions du §2 et remplacement des signatures du §5 ; types régénérés ; **tous** les appelants — webapp, connecteur, seed, scripts, pgTAP, API, E2E. Une affaire, un rattachement : aucun changement visible, toute la suite existante verte |
| T3 | Rattacher et retirer : `attach_card`, `detach_card`, `attached` et `detached` ; droits prouvés par l'API avec les jetons réels |
| T4 | Lectures à plusieurs rattachements : entonnoir, figées et relances, Ma journée, recherche, temps valorisé |
| T5 | Rentabilité ventilée : fonction, écran, outil `crm_profitability_report` |
| T6 | Messagerie : dossier `CRM/Affaires/<affaire>` et déplacement des dossiers existants par `mail-sync`, cadences et variables par rattachement (décision 657) |
| T7 | Webapp : fiche à blocs, pastille « aussi rattachée à », rattacher, archiver, retirer ; design system ; manuel ; captures |
| T8 | Seed du §12 et campagne E2E complète |
| T9 | Outils MCP du §11, au catalogue de `CRM-104` |

## 15. Points à trancher avant validation

Les points 1 à 3 sont tranchés par la décision 657 : le dossier IMAP sort de l'arborescence, une cadence s'inscrit à
un rattachement, les variables des modèles viennent du rattachement d'où l'on écrit (§7).

4. **Les noms** suivent les règles de nommage arrêtées par la décision 658 (`docs/DAT.md` §12 bis) : `card_placements`,
   `placement_id`, `attach_card`, `detach_card`, `attached`, `detached`, et les outils `crm_card_attach`,
   `crm_card_placement_update`, `crm_card_placement_archive`. **Les signatures sont remplacées d'un coup** (décision
   661, §5), dans la tranche de bascule (§14) ; `placement_ambiguous`, qui ne servait que la compatibilité, disparaît.

**Tous les points sont tranchés**, et la spécification est validée (décision 662) : `CRM-111` est inscrite au backlog
avec ses tranches T1 à T9 ; `CRM-112` y est réservée, sa spécification étant à écrire.

## 16. Hors périmètre

- **Les champs personnalisés communs de portée espace** (décision 642, arbitrage 4) : seconde unité, proposée
  `CRM-112`, spécifiée après celle-ci (décision 645). Elle posera son champ dans la partie commune de la fiche, que la
  présente unité aura séparée des blocs.
- **Plusieurs ventes au même client** : plusieurs affaires, sans lien nouveau (décision 638).
- **Une affaire rattachée à deux espaces** : un rattachement reste dans l'espace de son affaire, par les clés
  composites.

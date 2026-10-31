# Webhooks sortants signés — `CRM-073`

*Proposée le 2026-10-31, après l'arbitrage du responsable (décision 779). **Validée telle quelle le 2026-10-31** (décision
784) : les six points du §11 sont acceptés, et le découpage du §10 aussi.*

## 1. Intention et frontière

Un outil tiers (un tableur partagé, un automate, la comptabilité, un entrepôt de données) veut **savoir aussitôt** qu'une
affaire ou un contact a changé dans le CRM, sans l'interroger en boucle. L'administrateur d'un espace déclare un
**webhook** : une adresse HTTPS, les événements qui l'intéressent, éventuellement un seul channel. À chaque événement
retenu, le CRM envoie à cette adresse une requête `POST` **signée**, en arrière-plan, et la réessaie si elle échoue.
L'administrateur voit l'historique des remises et peut renvoyer une remise.

**Hors périmètre** (décision 779) :
- les **jetons d'API** — abandonnés : l'accès programmatique au CRM est le connecteur MCP (`docs/SPEC-mcp.md`) ;
- les webhooks **entrants** (un tiers qui écrit dans le CRM) ;
- tout autre événement que ceux du §3 : messagerie, temps, coûts, recettes, commentaires, réglages ;
- le **connecteur MCP** : les webhooks restent un réglage d'administrateur à l'écran, aucun outil ni famille nouvelle
  (décisions 627, 659, réponse du responsable à la décision 779).

## 2. Où le travail se fait

Trois pièces, chacune à sa place dans l'architecture existante (`docs/DAT.md`, décision 260) :

1. **PostgreSQL décide.** Des déclencheurs transforment chaque événement retenu en **lignes de remise** dans la même
   transaction que le changement (`webhook_deliveries`, §4.2) : une remise par webhook concerné. Un changement annulé ne
   laisse aucune remise ; une remise inscrite ne se perd pas.
2. **La fonction edge `webhooks` remet.** Elle prend les remises dues, signe, envoie, inscrit le résultat et la date du
   prochain essai. Elle ne décide de rien : ni qui reçoit, ni quoi. La signature et l'envoi HTTP sortant vivent là, hors
   de la base, comme le prévoyait la décision 260.
3. **`pg_cron` cadence.** Une tâche, chaque minute, réveille la fonction par `pg_net` sur le réseau interne de la pile
   (`http://functions:9000/webhooks/remettre`, jamais par Kong). L'appel porte un secret partagé
   (`WEBHOOKS_DISPATCH_SECRET`) que la fonction compare avant toute lecture ; sans lui, `401`. Un événement part donc
   **dans la minute** ; aucun ordre n'est garanti entre deux remises.

## 3. Les événements

Liste fermée, identifiants en anglais (`docs/DAT.md` §12 bis), tirés des faits que la base inscrit déjà :

| Événement | Quand | Source |
|---|---|---|
| `card.created` | une affaire naît (premier rattachement, décision 768) | `card_events.type = 'created'` |
| `card.step_changed` | un rattachement change d'étape | `card_events.type = 'moved'` |
| `card.owner_changed` | un rattachement change de responsable | `card_events.type = 'assigned'` |
| `card.archived` | un rattachement est archivé | `card_events.type = 'archived'` |
| `card.trashed` | l'affaire part à la corbeille | `card_events.type = 'trashed'` |
| `card.restored` | l'affaire revient de la corbeille | `card_events.type = 'restored'` |
| `contact.created` | un contact est créé | `INSERT` sur `contacts` |
| `contact.updated` | nom, email, téléphone, fonction ou organisation changent | `UPDATE` sur `contacts` |
| `contact.deleted` | un contact est supprimé **ou anonymisé** (§11, point 3) | `DELETE`, ou `anonymized_at` posé |

Les événements d'affaire suivent `card_events`, journal immuable déjà alimenté par les déclencheurs du produit : le
webhook dit exactement ce que le fil de l'affaire dit, et rien de ce qu'il ne dit pas. Un import (`CRM-071`) produit les
mêmes `card.created`, avec `source: "import"`.

**Le filtre de channel.** Un webhook peut se limiter à **un** channel. Il reçoit alors un événement d'affaire si le
rattachement concerné est dans ce channel (`card.created`, `card.step_changed`, `card.owner_changed`, `card.archived`),
ou si l'affaire a un rattachement dans ce channel (`card.trashed`, `card.restored`). Les contacts n'appartiennent à aucun
channel : **un webhook limité à un channel ne propose pas les événements de contact** (§11, point 2).

## 4. En base

### 4.1 `public.webhook_endpoints` — les webhooks d'un espace

| Colonne | Règle |
|---|---|
| `id` | PK |
| `workspace_id` | non nul |
| `name` | non vide (`btrim`), 80 caractères au plus |
| `url` | `https://` obligatoire, 2 048 caractères au plus ; refus des adresses privées au §6 |
| `events` | tableau non vide de valeurs du §3, sans doublon ; un événement de contact y est refusé si `channel_id` est posé |
| `channel_id` | facultatif ; un channel du même espace (clé composite `(channel_id, workspace_id)`) |
| `secret_id` | le secret de signature, dans **Vault** (`vault.secrets`), comme les mots de passe IMAP et SMTP |
| `enabled` | défaut vrai ; un webhook désactivé n'inscrit plus de remise |
| `created_by`, `created_at`, `updated_at` | posés par la base |

**Lecture et écriture : administrateur de l'espace seul** (RLS, `app.is_workspace_admin`), y compris la suppression. Le
secret ne se lit **jamais** par l'API : il est produit par la base à la création (32 octets aléatoires, encodés en
hexadécimal, préfixe `whsec_`) et rendu **une seule fois**, par la fonction de création. `rotate_webhook_secret(id)` en
produit un nouveau, rendu une seule fois lui aussi ; l'ancien cesse aussitôt de signer.

Fonctions (`SECURITY DEFINER`, administrateur vérifié en tête, `search_path` vide) : `create_webhook_endpoint(...)` qui
rend la ligne et le secret, `rotate_webhook_secret(uuid)`, `redeliver_webhook(uuid)` (§5.3). Modifier le nom, l'adresse,
les événements, le channel ou l'état passe par un `UPDATE` sous la RLS.

### 4.2 `public.webhook_deliveries` — les remises

| Colonne | Règle |
|---|---|
| `id` | PK ; c'est l'identifiant de remise envoyé au tiers (`X-P2Enjoy-Delivery`) |
| `workspace_id`, `endpoint_id` | non nuls ; la suppression d'un webhook emporte ses remises |
| `event` | une valeur du §3 |
| `event_id` | l'identifiant de l'événement (`card_events.id`, ou un identifiant produit pour un contact) ; **le même** pour un renvoi |
| `payload` | `jsonb`, le corps exact envoyé (§5.1), figé à l'inscription |
| `status` | `pending`, `delivered`, `failed` |
| `attempts` | nombre d'essais faits, de 0 à 5 |
| `next_attempt_at` | date du prochain essai ; nulle quand la remise est close |
| `last_status_code`, `last_error`, `last_attempt_at` | le dernier résultat : code HTTP, ou motif court (`timeout`, `connection_refused`, `address_forbidden`, `tls_error`) — jamais le corps de la réponse |
| `redelivery_of` | la remise renvoyée, pour un renvoi manuel |
| `created_at` | posée par la base |

**Lecture : administrateur de l'espace.** Aucune écriture par l'API : les déclencheurs inscrivent, la fonction edge
met à jour par la clé de service, `redeliver_webhook` crée. Les remises closes de plus de **30 jours** sont purgées par
une tâche `pg_cron` quotidienne (§11, point 5) : l'historique sert au diagnostic, pas d'archive.

### 4.3 Journal

Créer, modifier, supprimer un webhook et régénérer son secret s'inscrivent dans `audit_log` (`CRM-072`), famille
`configuration`, nouveau type d'entité `webhook` (la liste fermée s'étend par migration). Le secret n'y figure jamais.

## 5. La remise

### 5.1 La requête

`POST` vers l'adresse du webhook, corps JSON (UTF-8), délai de **10 secondes**, redirections **non suivies** :

```json
{
  "id": "<identifiant de l'événement>",
  "event": "card.step_changed",
  "occurred_at": "2026-10-31T14:02:11.512Z",
  "workspace_id": "…",
  "data": { … }
}
```

`data` porte **les identifiants et les champs qui disent ce qui a changé**, et rien d'autre (§11, point 1) :
- affaire : `card_id`, `title`, `placement_id`, `channel_id`, `channel_name`, `step` (`id`, `label`), `owner` (`id`,
  `full_name`), `amount`, `currency` ; pour `card.step_changed`, l'étape quittée (`from_step`) ; pour
  `card.owner_changed`, le responsable précédent (`from_owner`) ; `source` quand l'événement le porte ;
- contact : `contact_id`, `full_name`, `email`, `organization_id` ; pour `contact.deleted`, **le seul `contact_id`**.

En-têtes : `Content-Type: application/json`, `User-Agent: P2Enjoy-CRM-Webhooks/1`, `X-P2Enjoy-Event`,
`X-P2Enjoy-Delivery`, et la signature :

```
X-P2Enjoy-Signature: t=<horodatage Unix>,v1=<HMAC-SHA256 hexadécimal de "<t>.<corps>">
```

Le tiers recalcule le HMAC avec son secret et refuse un horodatage de plus de cinq minutes : la signature prouve
l'origine, l'horodatage empêche le rejeu. Le manuel donne la vérification en quelques lignes.

### 5.2 Les essais

Une remise réussit sur un code **2xx**. Sinon, ou sans réponse dans le délai, elle est réessayée : **cinq essais au
total**, aux délais croissants **1 min, 5 min, 30 min, 2 h** après l'essai précédent. Après le cinquième échec, la remise
passe `failed`. La fonction prend au plus 50 remises par passage, verrouillées (`for update skip locked`) : deux passages
ne remettent jamais la même. Aucune désactivation automatique d'un webhook qui échoue (§11, point 4).

### 5.3 Le renvoi manuel

`redeliver_webhook(delivery_id)`, administrateur seul : une **nouvelle** remise du même corps et du même `event_id`,
`redelivery_of` posé, cinq essais à nouveau. Le tiers reconnaît un doublon à `id` (l'événement), et une remise à
`X-P2Enjoy-Delivery`.

## 6. Sécurité

- **HTTPS obligatoire** ; aucune adresse en `http://` n'est acceptée en base.
- **Aucune adresse interne** (protection contre la falsification de requête côté serveur) : la fonction résout le nom
  avant chaque essai et refuse les adresses de bouclage, privées, de lien local, de la pile et des métadonnées de nuage
  (`address_forbidden`). En développement seulement, `WEBHOOKS_ALLOWED_HOSTS` nomme les hôtes autorisés malgré tout (le
  récepteur local du §8).
- **Secret** : dans Vault, lu par la seule fonction edge, par une fonction `SECURITY DEFINER` réservée à `service_role` ;
  jamais journalisé, jamais rendu après sa création.
- **Journaux** : nom de webhook, remise, code HTTP, durée ; jamais l'adresse complète (elle peut porter un jeton), le
  corps, le secret ni la signature.
- **Données personnelles** : un webhook envoie des noms et des emails de contacts à un tiers choisi par
  l'administrateur ; l'écran le dit à la création, et le manuel aussi.

## 7. À l'écran — Réglages ▸ Webhooks

Onglet réservé à l'administrateur (les autres ne le voient pas, et la base les refuse) :
- **la liste** : nom, adresse (hôte seul), événements, channel, état, dernière remise (réussie ou en échec) ;
- **créer / modifier** : nom, adresse, cases des événements (celles des contacts éteintes si un channel est choisi),
  channel facultatif, actif ; à la création, le secret s'affiche **une fois**, avec un bouton « Copier » et l'avertissement
  qu'il ne sera plus montré ; « Régénérer le secret » avec confirmation ;
- **l'historique d'un webhook** : les remises récentes, leur état, leurs essais, le dernier code ou motif ; le corps
  envoyé en lecture ; « Renvoyer » sur une remise ;
- **supprimer** avec confirmation.

Le design system reçoit sa section avant le code (`docs/DESIGN_SYSTEM.md`) ; états de chargement, d'erreur, de succès
et d'absence de données traités ; captures aux quatre paliers ; manuel, chapitre « Webhooks ».

## 8. Développement, seed et preuves

- **Un récepteur local** (`webhook-sink`, assemblage de développement seulement) : un petit service HTTPS qui garde les
  requêtes reçues et les rend en lecture, et peut répondre un code choisi pour éprouver les essais. Il est le pendant de
  Stalwart pour la messagerie : aucun service extérieur n'est nécessaire.
- **Seed** : un webhook actif de l'espace de démonstration vers le récepteur local (tous les événements d'affaire),
  un webhook limité au channel « refonte », un webhook désactivé ; un historique produit par la **vraie** chaîne —
  le seed déclenche des événements, la fonction remet au récepteur, dont une remise en échec (code 500 choisi).
- **Preuves** : pgTAP (tables, RLS, inscription par les déclencheurs, filtre de channel, refus des contacts sous filtre,
  purge, secret illisible) ; unitaires Deno (signature, délais, refus d'adresses, découpage des passages) ; API aux
  jetons réels (l'administrateur crée et lit ; le membre et la lectrice sont refusés ; le secret n'est rendu qu'une fois) ;
  intégration de bout en bout jusqu'au récepteur (signature vérifiée, cinq essais, renvoi) ; E2E de l'écran ; captures.

## 9. Déploiement

Migration (tables, fonctions, déclencheurs, tâches `pg_cron`, type d'entité du journal) ; fonction edge `webhooks` ;
variables `WEBHOOKS_DISPATCH_SECRET` (obligatoire en staging et en production) et `WEBHOOKS_ALLOWED_HOSTS` (développement
seulement) documentées dans `.env.example` et le README ; `docs/PROD_MIGRATIONS.md`. Retour arrière : désactiver la
tâche `pg_cron`, puis retirer la migration ; aucune donnée existante n'est modifiée.

## 10. Tranches

- **T1 — en base** : migration (`webhook_endpoints`, `webhook_deliveries`, Vault, fonctions, déclencheurs des neuf
  événements, filtre de channel, purge, journal) ; pgTAP ; API ; types.
- **T2 — la remise** : fonction edge `webhooks` (signature, essais, refus d'adresses), tâche `pg_cron` par `pg_net`,
  récepteur local ; unitaires Deno ; intégration jusqu'au récepteur ; contrat de déploiement.
- **T3 — l'écran** : design system, Réglages ▸ Webhooks ; seed ; unitaires ; E2E ; captures ; manuel.

## 11. Points validés (décision 784)

1. **La charge utile** porte les identifiants et les champs qui disent le changement (§5.1), pas l'objet entier : le
   tiers relit le reste par le connecteur MCP s'il en a besoin.
2. **Un webhook limité à un channel ne reçoit pas les événements de contact** (§3) : les contacts n'ont pas de channel.
3. **L'anonymisation d'un contact émet `contact.deleted`** (§3) : pour le tiers, les données personnelles doivent
   disparaître, comme pour une suppression.
4. **Aucune désactivation automatique** d'un webhook qui échoue : chaque remise s'arrête après cinq essais, l'écran
   montre l'échec, l'administrateur décide (§5.2).
5. **L'historique des remises est gardé 30 jours** (§4.2).
6. **Un récepteur local** entre dans la pile de développement pour les preuves et le seed (§8).

## 12. Précisions d'exécution (`CRM-073` T1, migration `0139`)

Écrites au fil de l'implémentation, sans changer ce que le §11 a validé :
- une remise d'un webhook **désactivé** reste en attente sans être prise ; elle part si le webhook est réactivé ;
- `contact.updated` porte `changed`, la liste des champs changés (`full_name`, `email`, `phone`, `role_title`,
  `organization_id`), **sans recopier** ceux que la charge utile ne porte pas : un téléphone changé se dit, il ne sort pas ;
- renvoyer une remise encore en attente est refusé (`P0001 delivery_pending`), comme vers un webhook désactivé
  (`P0001 webhook_disabled`) ; un webhook ou une remise que l'appelant ne lit pas est introuvable (`P0002`) ;
- la prise d'une remise compte l'essai et la réserve quinze minutes : une fonction edge interrompue en cours de passage ne
  la perd pas, elle la reprend à l'échéance ;
- les événements d'affaire `card.trashed` et `card.restored` ne désignent aucun rattachement : `data` porte l'affaire seule.

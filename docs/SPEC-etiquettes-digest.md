# Étiquettes et digest quotidien — `CRM-069`

*Proposée le 2026-10-27, après l'arbitrage du responsable (décision 769). **Validée telle quelle le 2026-10-28** (décision
771) : les cinq points du §8 sont acceptés, et le découpage du §7 aussi.*

## 1. Intention et frontière

Deux besoins distincts, livrés dans une même unité parce que le backlog les y range :

- **les étiquettes** : qualifier une affaire d'un mot commun à l'équipe (« Prioritaire », « Public », « Partenaire »), le
  voir partout où l'affaire paraît, et filtrer la liste dessus. Elles soldent la dette d'INC-068 : les pastilles que le
  design system prescrit depuis `CRM-000` sur la carte du board (§5.1), sans table ni unité ;
- **le digest quotidien** : chaque matin, un email récapitule ce qui attend la personne, pour qu'elle n'ait pas à
  ouvrir le CRM pour le savoir.

**Hors périmètre** : le **rapport hebdomadaire** `CRM-P07` (« retenue, planifié par `pg_cron` »). Il réemploiera la
mécanique du digest (§5), mais son contenu, des agrégats d'équipe, n'est arbitré nulle part. Il sera proposé à part. Hors
périmètre aussi : les étiquettes de contacts ou d'organisations, les couleurs libres et le digest dans l'application.

## 2. Les étiquettes en base

### 2.1 `public.labels` — le catalogue d'un espace

| Colonne | Règle |
|---|---|
| `id` | PK |
| `workspace_id` | non nul |
| `name` | non vide (`btrim`), 40 caractères au plus ; **unique par espace parmi les étiquettes non archivées**, sans tenir compte de la casse |
| `color` | `brand`, `success`, `accent`, `danger` ou `neutral` — la palette fermée de `tracks.color` et `channels.color` (migration `0116`) ; défaut `neutral` |
| `archived_at` | une étiquette archivée n'est plus proposée ; les affaires qui la portent la gardent, marquée « Archivée » |
| `created_by`, `created_at`, `updated_at` | posés par la base |

**Écriture** : administrateur de l'espace. **Lecture** : tout membre. Aucune suppression : archiver suffit et se défait.

### 2.2 `public.card_labels` — les étiquettes d'une affaire

`(card_id, label_id)` en clé primaire, `workspace_id` dénormalisé pour la RLS, `created_by`, `created_at`. Une étiquette
se pose sur **l'affaire**, et non sur un rattachement : elle qualifie l'affaire dans tous ses channels.

- **Poser ou retirer** : quiconque peut écrire l'affaire (`app.can_write_card`). La base refuse une étiquette d'un autre
  espace (`23503` par la clé composite `(label_id, workspace_id)`) et une étiquette archivée (`22023 label_archived`) ;
  retirer une étiquette archivée reste permis.
- **Lire** : quiconque lit l'affaire (`app.can_read_card`).
- **Le fil** : un déclencheur écrit `label_added` et `label_removed` dans `card_events`, avec l'acteur et le nom de
  l'étiquette. Les deux types entrent dans la liste fermée de `card_events.type`, famille « Champs » du fil, comme le
  cochage d'un point.
- **La recherche globale** (`CRM-065`) n'est pas étendue : une étiquette se filtre, elle ne se cherche pas.

## 3. Les étiquettes à l'écran

Le design system est complété avant le code (`docs/DESIGN_SYSTEM.md`, section nouvelle), après sa relecture intégrale.

- **Réglages ▸ Étiquettes**, après « Modèles d'affaires » : la liste du catalogue (pastille de couleur et nom),
  « Nouvelle étiquette » (nom, couleur), « Renommer », « Changer la couleur », « Archiver » / « Désarchiver »,
  « Afficher les archivées ». L'entrée suit la capacité d'administrer l'espace (§5.59), comme « Modèles d'affaires ».
- **La fiche** : sous le titre de l'en-tête, les pastilles de l'affaire, puis la commande « Étiquettes », qui ouvre une
  liste de cases dans le flux. Elle suit la capacité d'écrire l'affaire.
- **La carte du board** : les pastilles sous le titre, trois au plus, puis « +n » (§5.1).
- **La vue liste** : une colonne « Étiquettes » et un filtre « Étiquette » dans la barre de filtres, porté par l'adresse
  comme les autres filtres.
- **Une étiquette archivée** garde sa pastille sur les affaires qui la portent, avec la mention « Archivée » dans son nom
  accessible. Elle n'est plus proposée.

## 4. Les étiquettes dans le connecteur MCP — famille `affaires` (décision 769)

Aucune migration de la matrice, aucune ligne nouvelle.

| Outil | Action | Ce qui change |
|---|---|---|
| `crm_card_get` | `consulter` | rend `labels` : les noms et les couleurs des étiquettes de l'affaire |
| `crm_card_list` | `consulter` | rend `labels` sur chaque ligne ; accepte un filtre `label` (un nom, sans tenir compte de la casse) |
| `crm_card_label_set` (nouveau) | `modifier`, ancre `card:card_id` | pose (`add`) ou retire (`remove`) une liste d'étiquettes **désignées par leur nom** dans le catalogue de l'espace de l'affaire ; un nom inconnu ou archivé est refusé, et le refus nomme les étiquettes possibles |

Les noms ne finissent pas par `_id` : ils sont jugés dans l'espace de l'affaire, comme l'étape d'arrivée de
`crm_card_move` (`docs/SPEC-mcp.md` §9.2 ter). **Le catalogue n'a pas d'outil** : il reste un geste d'écran.

## 5. Le digest quotidien

### 5.1 Le consentement — `public.digest_subscriptions`

`(profile_id, workspace_id)` en clé primaire, `subscribed_at`. **Une ligne présente vaut consentement ; aucune ligne,
aucun email.** Le défaut est donc « je ne reçois pas » (`CLAUDE.md` §11 : une persistance facultative suit une action
explicite). La politique de lecture et d'écriture exige `profile_id = auth.uid()` et l'appartenance à l'espace. La table
est séparée de `profiles` pour la même raison que `notification_preferences` (`docs/SPEC-notifications.md` §43.1) : une
décision personnelle ne se publie pas à l'équipe. **Réglages ▸ Notifications** gagne la case « Recevoir chaque matin le
récapitulatif de cet espace par email ». La décocher supprime la ligne.

**L'adresse du destinataire — décidée le 2026-10-28 par le responsable (décision 773).** Le CRM ne gardait aucune adresse
de membre : les identités vivent dans le SSO LeLabs, `auth.users` est vide, et le jeton interne ne porte pas d'adresse.
`profiles` gagne une colonne `email`, que la base pose **à chaque ouverture et à chaque renouvellement de session**
(`ouvrir_session_serveur`, `renouveler_session_serveur`), depuis l'adresse vérifiée que l'échangeur reçoit du SSO
(`email_verified`). Le digest part à cette adresse. **Conséquence acceptée par le responsable** : `profiles` étant lisible
par les membres de l'espace, l'adresse de chacun l'est aussi. Aucun client ne l'écrit, et une personne qui ne s'est jamais
connectée n'a pas d'adresse : son digest est inscrit `no_address` et rien ne part.

### 5.2 Le contenu — ce que la personne peut lire, et rien d'autre

Pour chaque abonnement, au matin du jour *J* (heure de Paris) :

1. **ses actions** : les rattachements actifs, non en sommeil, dont elle est responsable et dont l'échéance de la
   prochaine action est passée ou tombe le jour *J* — la lecture de « Ma journée » (`CRM-061`), groupée en « En retard »
   et « Aujourd'hui » ;
2. **ses mentions non lues** de l'espace (`notifications`, `read_at` nul) ;
3. **ses affaires figées** : celles de `public.cards_figees()` dont elle est responsable.

Chaque ligne est filtrée par **`app.can_read_card_pour(carte, personne)`** : un droit retiré la veille retire l'affaire
du digest. Chaque ligne porte le titre de l'affaire, son channel et le lien de sa fiche (`SITE_URL`). **Rien à dire,
aucun email.** Le corps est en texte brut, comme tout envoi du produit (`mail_outbox.body_text`). L'objet :
« Votre journée dans {espace} — {n} action(s), {m} mention(s) ».

### 5.3 L'envoi — une branche de la file sans affaire

`mail_outbox.card_id` est aujourd'hui obligatoire : c'est l'affaire qui porte le `Reply-To` (migration `0030`). Le digest
n'appartient à aucune affaire. La file gagne une colonne `kind`, valant `card` (défaut, le comportement existant) ou
`digest`, et une contrainte : `card_id` est non nul si et seulement si `kind = 'card'`. Pour un digest :

- l'identité est **l'identité de service** de l'espace (`mail_outbound_identities.owner_id` nul). Sans identité de
  service, rien n'est mis en file, et `digest_runs` l'inscrit (`no_service_identity`) ;
- `mail-sync` compose le message **sans `Reply-To`** et sans fil d'affaire. Une réponse revient à la boîte de service et
  n'est classée nulle part ;
- l'écriture dans `mail_outbox` passe par une fonction `app.` réservée au job, jamais ouverte à `authenticated`.

**Précisé le 2026-10-28 à l'écriture de T4 (décision 772)** :
- **les liens** d'un digest commencent par le jeton `{site}`, que `mail-sync` remplace par sa variable `SITE_URL` pour
  le seul envoi sans affaire, car la base ne connaît pas l'adresse publique de la webapp. Sans `SITE_URL`, les liens restent
  relatifs, et le digest part quand même ;
- **le succès d'un digest ne range rien** dans le courrier d'une affaire : `marquer_envoi_reussi` clôt sa ligne de file,
  sans écrire de `mail_messages` ni de ligne de fil ;
- **le job tourne à la minute 2** de chaque heure, qu'aucune autre tâche n'occupe. Il s'appelle
  `p2enjoy-digest-quotidien`, comme les autres tâches du produit.

### 5.4 Le job — `pg_cron`, idempotent

`app.envoyer_digests(p_maintenant timestamptz default now())` est appelée **toutes les heures à la minute 0**. Elle
n'agit que si l'heure de Paris de `p_maintenant` est 7 : cela tient le passage à l'heure d'été sans deux planifications.
`public.digest_runs (profile_id, workspace_id, day, status, outbox_id, created_at)`, unique sur
`(profile_id, workspace_id, day)`, rend l'envoi idempotent. Un second appel le même jour n'envoie rien. `status` vaut
`queued`, `empty` (rien à dire) ou `no_service_identity`. Le paramètre `p_maintenant` rend le job prouvable en pgTAP et
démontrable par le seed, sans attendre 7 h.

### 5.5 Connecteur

Le digest n'entre pas dans le connecteur (décision 769).

## 6. Seed

- **Étiquettes** : quatre au catalogue de l'espace — « Prioritaire » (`danger`), « Secteur public » (`brand`),
  « Partenaire » (`success`), « Salon 2025 » (`neutral`, archivée) —, posées sous le jeton de l'administratrice. Elles
  sont posées sur cinq affaires sous le jeton de Driss, dont une qui porte l'étiquette archivée et une qui en porte
  quatre ou plus (le « +n » du board).
- **Digest** : Driss abonné à l'espace par la même écriture que la case des Réglages. Le seed appelle
  `app.envoyer_digests` pour un instant fixe à 7 h de Paris. Le digest part par la vraie file et par `mail-sync` vers la
  boîte de développement, comme tout envoi (`CLAUDE.md` §8). Camille n'est pas abonnée : son silence se constate.

## 7. Tranches

- **T1 — les étiquettes en base** : migration (`labels`, `card_labels`, déclencheur du fil, deux types de
  `card_events`), pgTAP, API, types.
- **T2 — les étiquettes à l'écran** : design system, Réglages ▸ Étiquettes, fiche, board, liste et filtre ; seed ;
  unitaires, E2E, captures, manuel.
- **T3 — les étiquettes dans le connecteur** : `docs/SPEC-mcp.md` §9.2 (entrée au catalogue), `crm_card_get`,
  `crm_card_list`, `crm_card_label_set` ; pytest unitaires et intégration, E2E.
- **T4 — le digest en base et à l'envoi** : migration (`digest_subscriptions`, `digest_runs`, `mail_outbox.kind`, la
  fonction et le job) ; `mail-sync` sans `Reply-To` pour un digest ; pgTAP, pytest, contrat de déploiement.
- **T5 — le consentement à l'écran et la preuve de bout en bout** : la case de Réglages ▸ Notifications ; seed ; E2E
  jusqu'à la boîte de développement ; manuel.

## 8. Points validés (décision 771)

1. Les étiquettes se posent sur l'affaire, et non sur un rattachement (§2.2).
2. Le fil trace la pose et le retrait d'une étiquette (§2.2).
3. Le digest est **par espace** : une personne membre de deux espaces reçoit deux emails si elle s'abonne aux deux
   (§5.1).
4. Le digest ne contient que ce dont la personne est responsable ou ce qui lui est adressé : pas les affaires figées de
   toute l'équipe (§5.2).
5. Sans identité de service, aucun digest ne part. `digest_runs` l'inscrit, mais aucun écran ne le montre dans cette
   unité (§5.3).

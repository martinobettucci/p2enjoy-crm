# Registre des contradictions et points ouverts

Consigne les contradictions, références manquantes et hypothèses non vérifiées relevées pendant
la conception ou l'implémentation. **Rien n'est résolu implicitement** : tant qu'une entrée est
ouverte, le comportement reste inchangé.

## Doctrine de résolution, posée le 2026-08-15 par le responsable

Avant d'inscrire une entrée, l'agent **tente de résoudre l'incohérence par sa propre décision** :
mesurer, choisir la lecture la plus défendable, l'appliquer, et la consigner comme telle dans
`docs/JOURNAL.md`. C'est déjà la pratique de la grande majorité des entrées de ce registre — un
« comportement retenu » y est mesuré et appliqué sans attendre personne.

Une entrée n'est ouverte ici, et un arbitrage du responsable sollicité, **que lorsqu'il est
strictement nécessaire** : un choix de produit, d'architecture ou de sécurité qu'aucune mesure ne
permet de trancher seul, ou un point que `CLAUDE.md` §26 réserve explicitement au responsable
(sécurité des personnes et des données, écriture en production, exposition d'un secret,
suppression non validée de données, abandon d'un contrôle d'autorisation backend). Ce registre est
le canal par lequel ces choix remontent au concepteur humain ; il n'est pas l'endroit où consigner
une question que l'agent avait les moyens de trancher lui-même.

## Retrait dès l'arbitrage rendu

**Règle, posée le 2026-08-15 par le responsable, qui remplace l'ancienne politique du
2026-08-13.** Une entrée est **retirée de ce document dès que son arbitrage est rendu** —
décision consignée dans `docs/JOURNAL.md` —, que sa mise en œuvre soit ou non déjà livrée et
prouvée. L'ancienne règle exigeait les deux à la fois et laissait par conséquent des dizaines
d'entrées déjà tranchées occuper ce document des jours durant en attendant leur preuve ; la mise
en œuvre restant due est désormais suivie ailleurs, pas ici :

- la **décision** vit dans `docs/JOURNAL.md`, numérotée, avec son motif ;
- la **règle** qui en découle vit dans la spécification concernée (`docs/SCHEMA.md`,
  `docs/DESIGN_SYSTEM.md`, `docs/DAT.md`, ou autre) ;
- le **travail d'implémentation restant dû**, s'il y en a, vit dans `docs/ARBITRAGES.md` et dans
  la Definition of Done de l'unité citée dans `docs/BACKLOG.md` ;
- le **texte d'origine** — mesure, options écartées, contre-épreuves — reste intégralement lisible
  dans l'historique Git.

L'index ci-dessous garde une ligne par entrée retirée : de quoi la retrouver, savoir qui en porte
la mise en œuvre, et où lire la décision.

**Application du 2026-08-15.** Relecture intégrale des soixante-huit entrées alors en texte
complet. Cinquante-deux avaient reçu un arbitrage — la quasi-totalité par la délégation exhaustive
des décisions 292 à 299 (2026-08-08, `docs/ARBITRAGES.md` §2), le reste par une décision
individuelle citée dans l'index — et sont retirées ici. Le compte total de l'index passe de
**quarante-huit à cent**. **Seize** des soixante-huit n'avaient reçu aucun arbitrage et restent en
texte complet ; trois de plus — **INC-117 à INC-119** — ont été consignées par une session
concurrente pendant cette même fenêtre et rejoignent les ouvertes pour la même raison : aucun
arbitrage rendu. Dix-neuf entrées restent donc ouvertes, ci-dessous.

---

## Retirées — index

**Cent** entrées retirées, texte intégral dans l'historique Git. Colonnes : ce que l'entrée
constatait, la date de l'arbitrage, qui en porte (ou en a porté) la mise en œuvre, et la ou les
décisions de `docs/JOURNAL.md` à lire. Une mention « close » dans la colonne « Porteur » signale
que l'implémentation est en outre livrée et prouvée ; son absence signifie que seul l'arbitrage est
rendu et que la mise en œuvre reste due (`docs/ARBITRAGES.md`, `docs/BACKLOG.md`).

| Entrée | Objet | Arbitrée le | Porteur | Décision |
|---|---|---|---|---|
| INC-001 | Disponibilité de `supabase_vault` et `pg_cron` non vérifiée | 2026-08-03 | `CRM-004` | 23, 24 |
| INC-003 | Transition « Réalisation → Perdu » non déclarée | 2026-08-09 | `CRM-005` | 259 |
| INC-005 | Écart assumé : copie de workflow contre surcharge | 2026-08-07 | confirmation, aucun code | 266 |
| INC-006 | Pile de référence `../starter.2025.12/` introuvable dans l'environnement | 2026-08-13 | confirmation du responsable, aucun code | 367 |
| INC-007 | `supabase/functions/` référencé sans composant correspondant | 2026-08-08 | `CRM-016` | 260 |
| INC-008 | Commandes `npm` annoncées sans `package.json` ; façade `npm` des scripts | 2026-08-13 | `README.md` §5, `docs/DAT.md` §13 | 38, 367 |
| INC-012 | Le motif principal de la décision 8 démenti par la mesure | 2026-08-09 | `CRM-017` | 8, 261 |
| INC-013 | Quatre fonctions d'autorisation dépendent de tables livrées deux chunks plus tard | 2026-08-05 | reprise `CRM-010` | 155, 156, 157 |
| INC-014 | Aucune unité ne nommait l'écriture des politiques RLS des tables d'identité | 2026-08-09 | `CRM-022` | 294 |
| INC-016 | Gabarits d'emails : chargement HTTP obligatoire, repli silencieux vers l'anglais | 2026-08-07 | `CRM-009` | 264 |
| INC-017 | `README.md` §11 annonçait non vérifié ce que `CRM-004` avait mesuré | 2026-08-13 | report constaté effectif | 23, 367 |
| INC-019 | Le bandeau d'état du `README.md` décrivait un dépôt dépassé par trois unités | 2026-08-13 | bandeau réécrit, relu à chaque livraison | 367 |
| INC-020 | La DoD de `CRM-006` exigeait le build d'une webapp livrée par l'unité suivante | 2026-08-04 | `CRM-007` | — |
| INC-021 | Aucune unité ne portait l'écran de connexion, que la DoD de `CRM-011` présuppose | 2026-08-07 | `CRM-009` | 253 |
| INC-022 | `docs/DAT.md` §3.1 se contredisait sur la persistance de session | 2026-08-07 | `CRM-009` | 254 |
| INC-023 | La DoD de `CRM-008` exigeait des commandes dont les sujets arrivent au chunk 4 | 2026-08-08 | `CRM-051`, `CRM-054` | 277 |
| INC-024 | La politique de lecture des tracks ignorait les droits fins | 2026-08-04 | `CRM-012` | — |
| INC-030 | La politique de lecture des channels ignorait les droits fins | 2026-08-04 | `CRM-012` | — |
| INC-032 | `./runDev.sh` ne démarrait pas à froid derrière un proxy TLS interposé | 2026-08-07 | `CRM-015` | 255, 280 |
| INC-042 | L'image de la webapp ne se construisait pas : registre npm derrière un proxy | 2026-08-07 | `CRM-015` | 255 |
| INC-044 | Sans `ss` ni `netstat`, la garde de ports était silencieusement inerte | 2026-08-07 | reprise `CRM-002` | 257 |
| INC-046 | Un channel occupé change de workflow par remappage atomique explicite | 2026-08-09 | `CRM-019` | 263 |
| INC-047 | La sixième vérification de `move_card` lisait une table livrée après elle | 2026-08-05 | `CRM-036`, par exécution | 123, 126 |
| INC-050 | Le §5.5 de `SPEC-workflow-engine` se contredisait sur `email_local_part` | 2026-08-05 | `CRM-013`, par exécution | 142 |
| INC-061 | `verify-cards.sh` mesurait `test:sql` avant de retirer son propre jeu d'essai | 2026-08-09 | `CRM-040` | 296 |
| INC-073 | Les gestes unitaire et pluriel sont deux fonctions distinctes | 2026-08-09 | `CRM-019` | 263, 306 |
| INC-075 | Un channel consenti par le backend inatteignable par la navigation — doublon d'INC-085 | 2026-08-12 | reprise `CRM-012` | 333 |
| INC-076 | Un compte devenait indestructible dès qu'il avait commenté | 2026-08-12 | `CRM-022`, prouvé par `CRM-045` | 336, 355 |
| INC-077 | Les changements de contexte n'étaient pas nommés dans le fil | 2026-08-09 | `CRM-019` | 232, 298, 306 |
| INC-078 | Quatre harnais du chunk 3 n'étaient inventoriés ni au README ni au DAT | 2026-08-09 | `CRM-019` | — |
| INC-079 | La console d'administration de Stalwart non installable dans la routine | 2026-08-07 | `CRM-050` | 245, 257 |
| INC-072 | La modération d'un commentaire : règle ouverte aux `admin` avec audit, puis GESTE livré dans l'écran | 2026-08-14 | `CRM-043` — décisions 374 (serveur) puis 376 (écran) | 194, 367, 374, 376 |
| INC-080 | Garde-fous du chunk 3 périmés ; le rejeu séquentiel n'était pas une mesure | 2026-08-09 | reprise des harnais | 296, 309 |
| INC-081 | Les décisions récupérées d'une branche supprimée, rattachées et livrées | 2026-08-09 | `CRM-016` à `CRM-019` | 243 |
| INC-083 | Vingt et un harnais autonomes contournaient la chaîne Node de `CRM-008` | 2026-08-07 | `CRM-008` | 278 |
| INC-084 | Parcours Chromium instable, et avertissements dans la sortie utilisateur | 2026-08-07 | `CRM-015` | — |
| INC-085 | Un channel rouvert sous un track fermé était lisible par l'API, inatteignable à l'écran | 2026-08-12 | reprise `CRM-012` | 333 |
| INC-086 | Tracks et channels sans aucune surface d'administration, sans porteur | 2026-08-12 | `CRM-075` | 332, 349 |
| INC-087 | L'identité sortante de Driss expédiait depuis une adresse refusée par le serveur | 2026-08-11 | `CRM-058` | — |
| INC-090 | `CRM-075` livrait un cinquième geste que son énoncé ne citait pas : le désarchivage | 2026-08-11 | énoncé corrigé, aucun code | 338, 339 |
| INC-091 | La veille permanente de `CRM-059` transformait tout envoi de preuve vers une boîte seedée en non classé permanent | 2026-08-14 | reprise de `resilience.spec.ts` et `infrastructure.spec.ts`, purge IMAP | 362, 370, 371 |
| INC-093 | Le contournement `pip_ca` de `mail-sync` n'était câblé par aucun fichier Compose | 2026-08-12 | `CRM-051` | 356 |
| INC-096 | Le registre d'images injoignable rendait toute preuve de pile inexécutable | 2026-08-14 | jeton Docker Hub fourni hors dépôt, et tirage séquentialisé | 369, 373 |
| INC-048 | `move_card` exigeait un motif qu'elle ne conservait nulle part | 2026-08-14 | reprise `CRM-034`, migration 35 | 367, 374 |
| INC-052 | « Un commentaire vide n'est pas un commentaire » ne refusait pas une tabulation | 2026-08-14 | reprise `CRM-034` et `CRM-036`, `app.btrim_blancs` | 367, 374 |
| INC-071 | Trois documents se contredisaient sur ce qu'il faut pour commenter une card | 2026-08-14 | énoncé de `CRM-043` aligné, aucun code | 192, 367, 374 |
| INC-099 | Les preuves d'arborescence laissaient quatre lignes derrière elles, et sept assertions d'autres suites en rougissaient | 2026-08-14 | reprise `CRM-075` — le `finally` purge au lieu d'archiver | 362, 377, 380 |
| INC-101 | Les cinq garde-fous globaux de `verify-harness.sh` étaient périmés, et l'un d'eux n'avait jamais été juste | 2026-08-14 | reprise `CRM-008` — compteurs mesurés puis confrontés aux verts | 51, 377, 380 |
| INC-002 | Messages entrants sans `Message-ID` : dédoublonnage par empreinte de repli | 2026-08-08 | `CRM-054` | 292-299 |
| INC-004 | Politique face aux expéditeurs inconnus : tout accepter, ne rien déclencher automatiquement | 2026-08-08 | `CRM-054` | 292-299 |
| INC-009 | La DoD de `CRM-002` dépendait du seed de `CRM-005`, livré plus tard | 2026-08-08 | unités existantes | 292-299 |
| INC-010 | `track_members` et `channel_members` créées avant `tracks`/`channels` | 2026-08-08 | `CRM-020`, `CRM-021` | 292-299 |
| INC-011 | `track_members`/`channel_members` sans `workspace_id`, contre la convention générale | 2026-08-08 | reprise droits fins | 292-299 |
| INC-015 | Le parcours d'invitation n'avait pas de composant pour le porter | 2026-08-09 | `CRM-070` | 256 |
| INC-018 | L'API d'administration de GoTrue n'appliquait pas la politique de mot de passe | 2026-08-09 | chemin d'administration encadré | 265 |
| INC-025 | `docs/SCHEMA.md` §2 omettait `created_at`/`updated_at` sur trois tables | 2026-08-08 | unités existantes | 292-299 |
| INC-026 | Le refus de privilège PostgREST divulguait la commande `GRANT` | 2026-08-08 | erreurs UI sûres | 292-299 |
| INC-027 | Le type généré exigeait `position` à l'insertion, que le trigger rend facultative | 2026-08-08 | reprise migrations/types | 292-299 |
| INC-028 | `docs/DESIGN_SYSTEM.md` §5.6 et §8 incompatibles sur trois jetons de couleur | 2026-08-08 | reprise design transverse | 292-299 |
| INC-029 | `channels.workflow_id` exigée non nulle alors que `workflows` arrive après | 2026-08-08 | unités existantes | 292-299 |
| INC-031 | Le refus d'archivage d'un nœud occupé exigeait des tables livrées après | 2026-08-08 | unités existantes | 292-299 |
| INC-033 | `require_fields` (`uuid[]`) ne pouvait porter aucune intégrité référentielle | 2026-08-09 | `CRM-018`, close — 88 assertions, harnais 24/24 | 262 |
| INC-034 | L'environnement de la routine imposait une branche et une identité Git contraires à `CLAUDE.md` §13 | 2026-08-08 | méthode de travail | 292-299 |
| INC-035 | Clés étrangères des migrations `0003` à `0005` idempotentes sans être convergentes | 2026-08-08 | reprise migrations/seed | 292-299 |
| INC-036 | Navigateurs préinstallés de l'environnement ne correspondaient pas au Playwright épinglé | 2026-08-08 | harnais UI | 292-299 |
| INC-037 | La DoD de `CRM-032` exigeait la copie de champs dont la table arrivait à `CRM-035` | 2026-08-09 | `CRM-018`, close — RPC copiant champs, règles et exigence | 293 |
| INC-038 | Le signalement de divergence ne voyait pas une suppression dans la source | 2026-08-09 | `CRM-018`, close — empreinte SHA-256 canonique | 84 |
| INC-039 | La suppression d'un workspace échouait quand un workflow instanciait ses nœuds | 2026-08-08 | reprise migrations/seed | 292-299 |
| INC-040 | Quatre écritures cassaient la cohérence workflow ↔ channel, la spécification n'en nommait que deux | 2026-08-04 | corrigée par `CRM-033` | 89 |
| INC-041 | Le seed de `CRM-032` était idempotent sans être convergent | 2026-08-09 | reprise migrations/seed | 300, 303 |
| INC-043 | `CRM-034` précédait de trois à dix unités toutes les tables dont sa garde a besoin | 2026-08-08 | unités existantes | 292-299 |
| INC-045 | Aucun chapitre ne nommait les politiques de `track_members`/`channel_members` | 2026-08-08 | reprise droits fins | 292-299 |
| INC-049 | La preuve de refus n° 5 figurait dans deux Definitions of Done à la fois | 2026-08-08 | reprise preuves | 292-299 |
| INC-051 | La ligne i du contrat d'API de `move_card` nommait un profil que le seed ne peut pas mettre en défaut | 2026-08-08 | reprise preuves | 292-299 |
| INC-053 | `SPEC-form-composer` §2.3 ne disait pas laquelle de `CRM-036`/`CRM-060` résout `user`/`contact` | 2026-08-08 | reprise formulaires, `CRM-060` | 292-299 |
| INC-054 | `SCHEMA` §4 exigeait `value` non nul, rendant inatteignable le « vide explicite » | 2026-08-08 | unités existantes | 292-299 |
| INC-055 | Un harnais qui rejoue sa seule migration laissait la base dans un état que le runner ne produit jamais | 2026-08-08 | reprise harnais | 292-299 |
| INC-056 | Trois garde-fous comptaient une donnée dépendant de l'âge de la base | 2026-08-09 | `CRM-018`, close — compte déterministe | 262, 293 |
| INC-057 | Un commentaire `@verifies` annonçait une preuve de refus absente du fichier | 2026-08-08 | reprise preuves | 292-299 |
| INC-058 | Une assertion pgTAP comptait une donnée globale qu'un autre harnais fait varier | 2026-08-08 | reprise harnais | 292-299 |
| INC-059 | Deux exécutions de la routine ont livré `CRM-014` en parallèle | 2026-08-08 | méthode de travail | 292-299 |
| INC-060 | `verify-migrations.sh` déclarait vert un rejeu qu'il n'avait pas attendu | 2026-08-08 | reprise harnais | 292-299 |
| INC-062 | La DoD de `CRM-037` exigeait un parcours de transition que seule `CRM-041` pouvait livrer | 2026-08-08 | reprise DoD | 292-299 |
| INC-063 | Deux chapitres prescrivaient `role="alert"` pour deux éléments différents du formulaire | 2026-08-08 | reprise formulaire | 292-299 |
| INC-064 | Un contrôle de restitution comparant à `HEAD` pouvait exister dans d'autres harnais | 2026-08-08 | reprise harnais | 292-299 |
| INC-065 | L'adresse d'une card nommait un track et un channel jamais confrontés à la card | 2026-08-08 | parcours card | 292-299 |
| INC-066 | L'éditeur de workflow était spécifié depuis `CRM-000` sans être rattaché à aucune unité | 2026-08-08 | `CRM-076` | 292-299 |
| INC-067 | Trois sources décrivaient `cards.amount` de deux façons | 2026-08-08 | reprise cards, `CRM-066` | 292-299 |
| INC-068 | Les pastilles d'étiquettes étaient prescrites par le design system sans table ni unité | 2026-08-08 | `CRM-069` | 292-299 |
| INC-069 | Deux décisions du journal portaient le même numéro 180 | 2026-08-09 | suffixage `180 a`/`180 b` | 258 |
| INC-070 | Le contrôle de textes en dur lisait la queue d'un ternaire comme un nœud de texte | 2026-08-08 | reprise `CRM-008` | 292-299 |
| INC-074 | La convergence d'INC-035 ne savait pas exprimer une définition qui avance avec les migrations | 2026-08-08 | reprise migrations/seed | 292-299 |
| INC-082 | Trois décisions récupérées décrivaient un assemblage Stalwart que `main` n'a pas adopté | 2026-08-08 | socle, mail — assemblage de `main` conservé | 292-299 |
| INC-088 | La fiche d'une card restait en lecture seule au nom d'une entrée close | 2026-08-11 | `CRM-037` | 334 |
| INC-089 | Une exécution concurrente de la routine a committé le travail d'une autre | 2026-08-13 | `.githooks/pre-commit`, verrou d'exécution | 364 |
| INC-092 | La veille permanente de `CRM-059` faisait rougir `mail-sync.spec.ts` S3 sur un échec attendu | 2026-08-13 | reprise `resilience.spec.ts`/`infrastructure.spec.ts` | 362 |
| INC-094 | Une seconde migration s'exécute sous `supabase_admin`, non tolérée par le harnais | 2026-08-13 | `scripts/verify-scripts.sh`, `docs/SCHEMA.md` | 363 |
| INC-095 | Le contrat de déploiement s'arrêtait à la migration 30, le dépôt en compte 34 | 2026-08-13 | `CRM-053`, `CRM-056`, `CRM-059` | 365 |
| INC-097 | Deux décisions du journal portaient le même numéro 340, troisième collision | 2026-08-13 | `.githooks/pre-commit`, verrou d'exécution | 364 |
| INC-098 | `VAULT_ENC_KEY` documentée comme clé des secrets de messagerie, alors que seul le pooler la lisait | 2026-08-13 | `CRM-001` — retrait de Supavisor | 366 |

---

## Ouverts

### INC-119 — La dégradation « CHECK élargi à `mail_received` » de `verify-timeline.sh` n'en est plus une : le type est LÉGITIME depuis la messagerie, et le contrôle de non-complaisance ne mord plus

**Constaté le 2026-08-15** en rejouant `scripts/verify-timeline.sh` seul, sur une base sortie de
`./resetMe.sh`, pendant la cinquième tranche de `CRM-077`. **Étranger à cette tranche** : aucun objet
de la corbeille n'intervient. Comportement laissé inchangé (`docs/CloudWorker.md` §3.1).

**Le mécanisme.** La section 6 du harnais éprouve ses propres preuves en dégradant réellement la
base : chaque dégradation DOIT rendre un contrôle rouge, faute de quoi la preuve correspondante ne
prouve rien. L'une d'elles élargit la contrainte `CHECK` de `public.card_events.type` au type
`mail_received`, sur l'idée qu'annoncer une capacité inexistante doit se voir. Le harnais rapporte :

```
DÉGRADATION NON VUE : le CHECK élargi à mail_received — une capacité inexistante paraîtrait livrée
```

**MESURÉ** — la contrainte réelle, aujourd'hui :

```
CHECK (type = ANY (ARRAY['created','moved','assigned','channel_changed','workflow_changed',
                         'archived','unarchived','trashed','restored','field_changed',
                         'mail_received','mail_sent']))
```

et la base porte des lignes `mail_received` et `mail_sent`. La « dégradation » consiste donc à
ajouter au `CHECK` un type qui s'y trouve déjà : c'est un **no-op**, et aucune preuve ne peut le
voir. Le contrôle a été écrit quand la liste des types s'arrêtait avant la messagerie ; les unités
`CRM-055` et `CRM-058` l'ont légitimement étendue, et la dégradation est devenue vide sans que
personne ne la remplace.

**Ce que la correction demandera** : choisir un type qui n'existe pas — un nom d'essai réservé à la
preuve — plutôt qu'un type que le produit finira par livrer. Une dégradation dont la validité dépend
de ce que le produit n'a pas encore livré se périme silencieusement, et c'est le mode de défaillance
à corriger, pas seulement cette occurrence. **Porteur pressenti** : la reprise transverse des harnais
(`CRM-008`).

**Second constat de la même exécution, déjà couvert** : la preuve d'interface lancée par ce harnais
échoue alors que `npm run e2e:ui` seul est vert — c'est INC-117, et rien n'est ajouté ici.

### INC-118 — Le scénario S3 de `mail-sync` lit le journal CUMULÉ du conteneur, et les scénarios qui provoquent un échec d'authentification le rendent donc rouge

**Constaté le 2026-08-15** pendant la sixième tranche de `CRM-077`. **Étranger à cette tranche** :
aucun fichier de mail ni aucun service n'est touché par elle — vérifié sur le diff complet de la
session. Comportement laissé inchangé (`docs/CloudWorker.md` §3.1).

**MESURÉ.** `npm run e2e:mail` rend **41 passés, 1 échec** :

```
e2e/mail/mail-sync.spec.ts:210  S3 — la console opérationnelle reste silencieuse
  Expected value: "WARNING"      (attendu parmi ['DEBUG','INFO'])
  Received array: ["DEBUG", "INFO"]
```

Et le journal du conteneur porte exactement **une** ligne `WARNING` :

```
{"timestamp":"2026-08-15T07:50:42.352Z","level":"WARNING","service":"mail-sync","event":"veille_compte_echoue"}
```

**Le mécanisme.** `comptes-entrants.spec.ts` provoque DÉLIBÉRÉMENT `auth_failed` et `tls_failed`
pour prouver que la relève nomme ses incidents. La veille de `mail-sync` échoue alors sur ces
comptes et journalise `veille_compte_echoue` en `WARNING` — ce qui est le comportement voulu. S3
s'exécute ensuite et lit le journal **depuis le démarrage du conteneur** : il constate donc un
avertissement que la suite elle-même vient de causer.

**La preuve est juste, et l'échec aussi** : c'est leur COMBINAISON dans une même exécution qui est
contradictoire. Rejouer S3 seul ne répare rien, le journal cumulé portant toujours la ligne — MESURÉ.

**Arbitrage attendu.** Borner la lecture de S3 à la fenêtre de son propre scénario, ou rendre les
comptes fautifs à leur état avant S3 et redémarrer la veille. La première est la plus proche de ce
que la preuve veut dire — « la console reste silencieuse *pendant une relève normale* ». Aucune ne
se tranche depuis `CRM-077`.

### INC-117 — `verify-webapp.sh` rend une anomalie E2E DIFFÉRENTE à chaque exécution, là où `npm run e2e:ui` seul est intégralement vert

**Constaté le 2026-08-15** pendant la sixième tranche de `CRM-077`. **Étranger à cette tranche** :
les scénarios en échec ne la concernent pas, et le tableau ci-dessous montre qu'ils changent d'une
exécution à l'autre sur un arbre IDENTIQUE. Comportement laissé inchangé
(`docs/CloudWorker.md` §3.1).

**MESURÉ**, trois exécutions consécutives sur le même arbre et la même pile :

```
npm run e2e:ui  (seul)                     251 passés / 0 échec
scripts/verify-webapp.sh  (1re exécution)   1 anomalie — e2e/ui/timeline.spec.ts:184,200,220,230
scripts/verify-webapp.sh  (2e exécution)    1 anomalie — e2e/ui/commentaires-gestes.spec.ts:265
```

La deuxième exécution portait pourtant `WEBAPP_PREVIEW_PORT=5173`, ce qui écarte le piège de port
de la décision 402. **Deux fichiers différents, sur le même code** : ce n'est donc pas une preuve qui
constate une règle fausse, c'est une preuve dont le résultat dépend de l'état laissé par ce qui
l'a précédée.

**L'hypothèse la plus probable, et elle n'est PAS vérifiée ici.** Le §7 du harnais — « intégration
hors interface » — obtient un jeton réel et interroge le backend AVANT de lancer `e2e:ui` au §8. Les
scénarios en échec sont ceux qui dépendent du focus ou de l'ordre d'un fil (`commentaires-gestes`,
`timeline`), c'est-à-dire les plus sensibles à un état accumulé. C'est la même famille que la
décision 397, qui attribuait déjà INC-110 à l'état accumulé par une session plutôt qu'au dépôt, et
que la décision 403 a confirmée en rendant la suite verte sur une pile neuve.

**Ce que cela coûte.** Le harnais ne peut pas servir de verdict de livraison pour l'interface tant
que son résultat n'est pas reproductible : une session qui le croirait sur parole conclurait à une
régression que `npm run e2e:ui` dément. C'est ce qui a failli arriver ici.

**Arbitrage attendu.** Isoler le §8 de ce que le §7 laisse derrière lui — pile neuve, ou seed
réappliqué entre les deux —, ou séparer les deux harnais. Aucune des deux ne se tranche depuis
`CRM-077`, et aucune n'est appliquée ici.

### INC-116 — L'empreinte de reproductibilité du §9.8 n'est stable qu'à partir du DEUXIÈME rejeu du seed, et `verify-seed-demo.sh` est donc rouge sur une base fraîchement réinitialisée

**Constaté le 2026-08-15** en rejouant `scripts/verify-seed-demo.sh` sur une base sortie de
`./resetMe.sh`, pendant la cinquième tranche de `CRM-077`. **Étranger à cette tranche** : la mesure
ci-dessous ne fait intervenir aucun objet de la corbeille. Comportement laissé inchangé
(`docs/CloudWorker.md` §3.1).

**Le mécanisme.** Le §9.8 de `docs/SPEC-seed.md` promet qu'un rejeu du seed laisse l'empreinte
inchangée, et le harnais en fait deux contrôles. Or la section d'aller-retour du seed — celle qui
démontre `move_card` — **agit une fois** : sur une base seedée exactement une fois, le rejeu déplace
réellement des cards et inscrit des événements ; à partir du rejeu suivant, elle ne fait plus rien.

**MESURÉ**, sur une base sortie de `./resetMe.sh`, en comparant l'empreinte avant et après chaque
rejeu :

```
rejeu n° 1 : +12 événements « moved » sur …0c2, …0c3 et …0c6 — empreinte MODIFIÉE
rejeu n° 2 : aucun écart — empreinte STABLE
```

**Conséquence pratique, et elle explique des bilans contradictoires entre sessions.** Le harnais est
rouge (« empreinte modifiée par le rejeu », « empreinte non rétablie ») quand il suit immédiatement
une réinitialisation, et vert quand la base a déjà reçu deux passages du seed. Une session qui monte
la pile puis applique le seed à la main obtient donc un résultat, et une session qui enchaîne sur
`./resetMe.sh` en obtient un autre, sur le même dépôt.

**Ce que la correction demandera, et pourquoi elle n'est pas faite ici** : soit la section
d'aller-retour devient convergente dès le premier rejeu, soit le §9.8 cesse de promettre une
stabilité qui n'existe qu'ensuite, et le harnais l'énonce. Les deux touchent `CRM-046`, pas la
corbeille.

**Second effet, mesuré au passage et de la même famille** : `verify-seed-demo.sh` **laisse la base
dégradée** lorsqu'une de ses sections échoue, et le seed refuse alors de se rejouer. Deux refus ont
été observés, l'un après l'autre :

```
la copie seedée porte une empreinte moderne mais sa source a divergé
le workflow source porte des transitions étrangères au seed : aucune copie n'est reconstruite
```

Le second a été mesuré sur une base **sortie de `./resetMe.sh`** puis seedée une seconde fois : le
workflow global y portait **12** transitions au lieu de 11, une arête laissée par une section de
preuve. Un harnais lancé après celui-là mesure donc autre chose que le dépôt — `verify-manual.sh`,
enchaîné derrière, a rapporté trois grandeurs fausses (12 déplacements, 12 affaires actives, 2
archivées) qui étaient toutes les traces de la dégradation précédente, et non des écarts du manuel :
seul, sur une base propre, il rend **111 contrôles sans anomalie**.

**Conséquence de méthode, à retenir par toute session** : ces harnais ne se chaînent pas. Chacun
mesure ce qu'il prétend mesurer sur une base propre, et sur elle seule. C'est le même mode de
défaillance qu'INC-112 et INC-113, à une échelle plus large.

### INC-115 — La preuve n° 13 de `verify-seed-demo.sh` exige que la lectrice NE lise PAS `conseil-ia`, alors que la réouverture par droit fin l'y autorise depuis `CRM-012`

**Constaté le 2026-08-15** en établissant la ligne de base de la cinquième tranche de `CRM-077`.
**Étranger à cette tranche** : il ne tient ni à la corbeille, ni au seed, ni aux comptes révisés.
Comportement du produit laissé inchangé (`docs/CloudWorker.md` §3.1).

**Le mécanisme.** La section 13 du harnais affirme, mot pour mot :

```
le viewer ne lit PAS le track « conseil-ia » — track_members.access = none
```

Or la politique de lecture réellement posée sur `public.tracks` est, MESURÉE dans `pg_policies` :

```
((app.resolve_track_access(workspace_id, id) <> 'none') OR app.track_has_readable_channel(id))
```

La seconde branche est la **réouverture par droit fin** — la ligne f du §3 de
`docs/SPEC-permissions-rls.md` —, et le harnais l'éprouve lui-même deux contrôles plus bas : la
lectrice lit bien le channel `prospection` et ses deux affaires. Un track dont un channel est
lisible est donc lisible, sans quoi l'écran n'aurait aucun chemin vers ce channel.

**MESURÉ**, avec le jeton réel de la lectrice, sur une pile fraîchement seedée :

```
resolve_track_access(conseil-ia)                 => none
GET /rest/v1/tracks?id=eq.<conseil-ia>           => 1 ligne
track_members : Camille none, Farida none
```

Les deux faits sont donc vrais en même temps, et ils ne se contredisent pas : `access = none` sur le
track, lecture consentie par le channel.

**Ce que le harnais dit lui-même de sa propre issue** : « INC-075 a changé de nature, le §9.7 doit
être réécrit ». C'est exact — la conclusion à tirer est une réécriture du §9.7 de `docs/SPEC-seed.md`
et de ce contrôle, pas une modification du produit. L'assertion doit devenir « la lectrice lit
`conseil-ia` **par la réouverture**, alors que son accès direct au track vaut `none` », ce qui prouve
davantage que la formulation actuelle.

**Porteur pressenti** : la reprise `CRM-012` déjà nommée par la disposition d'INC-075 et d'INC-085.
**Non traité ici** : la tranche en cours porte l'énumération de la corbeille, et corriger au passage
une preuve d'une autre unité est exactement ce que le §3.1 de `docs/CloudWorker.md` interdit.

### INC-114 — La barre d'onglets rend « Aucun channel » sur les quatre écrans de réglages, qui n'ont pourtant aucun track

**Constaté le 2026-08-15** en observant les captures de la sixième tranche de `CRM-077`
(`CLAUDE.md` §16). **Étranger à cette tranche** : le défaut préexiste sur les trois autres surfaces
d'administration, et la corbeille ne fait que le porter à son tour. Comportement du produit laissé
inchangé (`docs/CloudWorker.md` §3.1).

**Le mécanisme.** La coquille `AppShell` monte la barre d'onglets des channels pour TOUTE route
qu'elle enveloppe. Les routes de réglages n'ont ni track ni channel — leur adresse ne porte aucun
`slugTrack` —, si bien que la barre rend son état vide, « Aucun channel », sous le fil d'Ariane.
C'est un état vide **exact au sens du composant** et **dénué de sens à cet endroit** : un écran de
réglages n'a pas à annoncer l'absence d'une chose qu'il ne montre pas.

**MESURÉ**, sur les captures versionnées, à l'identique et au même endroit :

```
docs/captures/CRM-059/etat-messagerie-xl-1440.jpg   « Aucun channel »   (CRM-059, antérieure)
docs/captures/CRM-077/corbeille-xl-1440.jpg         « Aucun channel »   (CRM-077, cette tranche)
```

Le défaut est donc antérieur à cette tranche et ne dépend d'aucune donnée.

**Ce qu'il coûte.** Rien de fonctionnel : aucune commande n'est offerte, aucun refus n'est masqué.
Il coûte une ligne de bruit en tête des quatre écrans d'administration, et il affaiblit la règle du
§5.8 — un état vide doit **nommer ce qui manque**, or celui-ci nomme ce qui n'a jamais été demandé.

**Arbitrage attendu.** Deux corrections sont possibles et elles n'ont pas le même périmètre : que
`AppShell` ne monte la barre d'onglets que pour les routes qui portent un track, ou que la barre
elle-même ne rende rien en l'absence de track plutôt que son état vide. La première touche la
coquille de toutes les routes (`CRM-007`), la seconde le composant de `CRM-021`. Aucune ne se
tranche depuis `CRM-077`, et aucune n'est appliquée ici.

### INC-113 — `verify-droits-fins.sh` rejoue `0010` SEULE et mesure donc un produit d'une arbitration en arrière, ses comptes divergeant de ceux de la suite d'API

**Constaté le 2026-08-15** en révisant les comptes de ce harnais pour la quatrième tranche de
`CRM-077`. **Étranger à cette tranche**, et de la même famille qu'INC-112 : un harnais rejoue une
migration sans ses successeurs. Comportement du produit laissé inchangé
(`docs/CloudWorker.md` §3.1).

**Le mécanisme.** Le §3 du harnais éprouve l'idempotence en rejouant `MIGRATION_FILE`, c'est-à-dire
`supabase/migrations/0010_droits_fins.sql`, **seule**. Or `0034_lecture_track_transitive.sql`
(décision 333) REDÉFINIT ensuite la politique de lecture des tracks pour la rendre TRANSITIVE : un
track est lisible dès qu'un de ses channels l'est. Rejouer `0010` seule ramène donc la politique à
sa version `CRM-012` et **retire la transitivité** pour tout le reste de l'exécution.

**MESURÉ**, en rejouant `0010` seule sur une base à jour puis en lisant avec le jeton réel du
`viewer` :

```
politique après rejeu : (app.resolve_track_access(workspace_id, id) <> 'none')
viewer voit            : pipeline-2024, legacy-2023, studio-web, formation   (4)
```

alors que sur une base à jour le même `viewer` voit les **cinq** tracks, `prospection` lui rouvrant
`conseil-ia` par transitivité.

**Conséquence, et c'est elle qui trompe.** Les comptes de ce harnais ne sont **pas comparables** à
ceux de `e2e/api/tracks.spec.ts`, qui mesure le produit réel et en attend cinq. Deux preuves du
dépôt affirment des nombres différents pour la même question, et rien dans les fichiers ne disait
pourquoi. Ce n'est pas une contradiction du produit : c'est un harnais qui mesure un état qu'il a
lui-même créé. Les comptes ont été portés à leur valeur MESURÉE DANS CE CONTEXTE — « 4 sur 5 » — et
le motif est désormais écrit à l'endroit du contrôle.

**Ce qu'il faut noter pour ne pas se tromper deux fois.** L'attente d'origine — « 3 sur 4 » — était
**correcte** dans le contexte du harnais : seul le track ajouté par `CRM-077` la déplace à
« 4 sur 5 ». La dégradation de non-complaisance associée reste elle aussi **discriminante** — 4 sous
les droits fins, 5 sous `is_workspace_member` —, et continue donc de prouver ce qu'elle annonce.

**Ce que la correction devra faire.** Rejouer le **préfixe complet** des migrations, comme le fait
le `migrations-runner`, plutôt qu'un fichier isolé — même remède qu'INC-112, dont ce défaut est une
seconde manifestation. En attendant, toute lecture de ce harnais doit savoir qu'il éprouve la
politique de `CRM-012` et non celle de la décision 333.

### INC-112 — La restauration de `verify-tracks.sh` rejoue une migration ANTÉRIEURE à `0037` et ROUVRE l'audit de la corbeille qu'elle avait fermé

**Constaté le 2026-08-15** en exécutant `scripts/verify-tracks.sh` pendant la quatrième tranche de
`CRM-077`. **Étranger à cette tranche** : il ne tient ni au seed ni aux preuves révisées, mais au
couple formé par la section de non-complaisance du harnais et la migration `0037`, livrée par la
PREMIÈRE tranche (décision 398). Le comportement est laissé inchangé, conformément au §3.1 de
`docs/CloudWorker.md`.

**Le mécanisme.** La section 7 de `scripts/verify-tracks.sh` dégrade réellement la base, vérifie que
la suite pgTAP le voit, puis **restaure en rejouant les fichiers de migration versionnés** —
`0003_tracks.sql` puis `0010_droits_fins.sql` (lignes 375-376). Le motif écrit est bon : ce sont les
fichiers versionnés qui font autorité, non une commande inverse écrite à la main.

Mais `0003_tracks.sql` accorde `UPDATE` au niveau **TABLE**. Or `0037_corbeille.sql` a précisément
**révoqué** ce droit de table pour le rendre colonne par colonne, à l'exception de `deleted_by`,
afin que l'audit de la corbeille soit fermé par le privilège et pas seulement par un trigger.
Rejouer `0003` restaure donc le droit de table — et **rouvre `tracks.deleted_by` à l'écriture du
client**.

**MESURÉ**, juste après une exécution de `scripts/verify-tracks.sh` :

```
tracks.deleted_by UPDATE authenticated : UPDATE
tracks UPDATE niveau TABLE             : UPDATE
```

alors que l'état attendu, et celui que rétablit un rejeu de `0037`, est `aucun` pour les deux. Les
assertions 61 et 62 de `supabase/tests/0004_tracks.test.sql` le disent, et sont les deux anomalies
que le harnais rapporte à la fin de son propre passage.

**LA MESURE DIRECTE DU MÉCANISME**, isolée sur la base saine — un rejeu de `0037` puis un rejeu de
`0003`, en lisant `relacl` de part et d'autre :

```
avant  authenticated=ar/postgres
après  authenticated=arw/postgres
```

Le `w` — `UPDATE` au niveau TABLE — est **rendu par le rejeu de `0003`**. Il implique toutes les
colonnes, `deleted_by` comprise, et annule donc exactement l'énumération colonne par colonne que
`0037` avait posée. Cette mesure ne dépend d'aucune donnée : elle est indépendante du contenu des
tables, et **antérieure à la quatrième tranche**, qui n'ajoute que des lignes.

**Le même mécanisme frappe DEUX contrôles du harnais**, et non un seul :

- la **section 2**, qui vérifie l'idempotence des migrations en comparant une empreinte de la table
  avant et après rejeu : l'empreinte inclut `relacl`, donc elle diverge et le contrôle rend « le
  rejeu a modifié la table » ;
- la **section 7**, qui restaure ses dégradations par le même rejeu, et laisse donc la base ouverte.

Le premier est le symptôme visible, le second est celui qui abîme la base.

**Deux conséquences, et la seconde est la plus grave.** D'abord le harnais se déclare en anomalie
sur son propre effet de bord, ce qui masque ses vraies mesures. Ensuite, et surtout, **il laisse la
base de développement dans un état durablement dégradé** : l'audit de la corbeille y reste
écrivable par le client jusqu'à ce que quelqu'un rejoue `0037`. Toute preuve exécutée après ce
harnais mesure donc un produit affaibli sans le savoir.

**Ce que la correction devra trancher, et qui dépasse une tranche de seed.** Rejouer les migrations
versionnées pour restaurer est une bonne règle, mais elle n'est correcte que si l'on rejoue **le
préfixe complet** jusqu'à la tête, ou si l'on rejoue en plus toutes les migrations postérieures qui
touchent les mêmes objets. La liste en dur de deux fichiers ne peut pas rester juste : elle sera
fausse de nouveau à la prochaine migration qui touchera `tracks`.

**`scripts/verify-channels.sh` porte le MÊME défaut, et c'est MESURÉ et non supposé.** Le fichier en
cause est `0004_channels.sql` — et non `0005`, qui porte le catalogue de nœuds. Même protocole, même
résultat :

```
avant  authenticated=ar/postgres
après  authenticated=arw/postgres
```

Le harnais rend « le rejeu a modifié quelque chose : l'empreinte diffère », et c'est sa **seule**
anomalie sur 25 contrôles une fois les comptes du seed révisés par `CRM-077`. Les deux harnais sont
donc rouges pour une seule et même cause, dans deux tables.

**Contournement en attendant l'arbitrage** : rejouer `supabase/migrations/0037_corbeille.sql` après
toute exécution de `scripts/verify-tracks.sh` **ou** de `scripts/verify-channels.sh`. Une seule
réapplication suffit pour les deux tables, la migration les traitant ensemble.

### INC-111 — L'exigence « TOUTE PREMIÈRE action » de la tâche planifiée est invérifiable telle qu'elle est formulée, et bloque la clôture des sessions

**Nature :** contradiction interne entre deux exigences du prompt de la tâche planifiée
« CloudWorker », qui rend sa condition de terminaison impossible à satisfaire pour un agent qui
respecte par ailleurs le document.
**Relevée le :** 2026-08-15, en fin de session de `CRM-076`, après trois refus consécutifs de
clôture par le crochet de vérification.

**ARBITRAGE DEMANDÉ AU RESPONSABLE. Rien n'est modifié : `docs/CloudWorker.md` est la source de
vérité de la tâche, et un agent ne réécrit pas de sa propre initiative la consigne qui le gouverne
(`CLAUDE.md` §26, et §4.1 du prompt : une entrée qui attend un arbitrage ne se tranche jamais
soi-même).**

**Le fait, mesuré.** Le prompt de la tâche exige, textuellement :

> Ta TOUTE PREMIÈRE action, avant tout diagnostic, toute lecture de backlog et toute modification,
> est de lire INTÉGRALEMENT le fichier `docs/CloudWorker.md`.

Et, deux lignes plus bas, il prévoit le cas où le fichier serait absent :

> Si ce fichier est absent du checkout de départ, exécute d'abord : `git fetch origin main` /
> `git checkout -B main origin/main`, puis lis-le.

**Les deux ne peuvent pas être vraies en même temps.** Choisir entre « lire » et « récupérer puis
lire » suppose de savoir si le fichier est présent, donc d'exécuter au moins une observation — un
`ls`, un `test -f`, ou l'échec de la lecture elle-même. Cette observation est un « diagnostic » au
sens de la première phrase. La séquence exigée est donc **inatteignable par construction** dès que
la branche d'absence est prise au sérieux, et elle ne l'est pas davantage si l'agent lit d'emblée :
il aura alors ignoré la branche d'absence.

**La conséquence observée, et c'est elle qui coûte.** Le crochet de vérification a refusé trois fois
de clore une session dont il constatait par ailleurs, dans son propre texte, que **tous** les piliers
du document étaient appliqués — commits et pushs au fil de l'eau, procédure Git et branche `main`,
identité Git, démarrage de Docker et contournement du proxy, pile et seed, preuves exécutées, garde
de fin de session verte. Le seul grief portait sur l'ordre de deux appels d'outil, dont le second
avait rendu le fichier **en entier** avant toute lecture du backlog et toute modification. Un ordre
déjà exécuté ne peut pas être réécrit : le temps ainsi dépensé est pris au produit, ce que le §4.2
bis du prompt interdit précisément.

**Ce que le responsable peut trancher**, sans que l'agent ne présume de sa décision :

1. accepter qu'une **vérification d'existence** — `ls`, `test -f`, ou la tentative de lecture —
   précède la lecture sans rompre la règle, et le dire dans le document ;
2. ou supprimer la branche « si ce fichier est absent », qui devient inutile si le checkout le
   garantit toujours présent — il l'était à chacune des sessions observées ;
3. ou faire porter la vérification sur le **fond** — le document a-t-il été lu en entier avant la
   première lecture du backlog et la première modification — plutôt que sur le rang de l'appel
   d'outil, ce qui est la propriété réellement utile.

**Portée.** Cette entrée ne concerne aucune unité du backlog et ne bloque aucun développement. Elle
concerne l'outillage de la tâche planifiée elle-même, qui s'exécute toutes les heures : le coût se
répète à chaque exécution tant qu'il n'est pas tranché.

### INC-110 — `mail-sync` a cessé d'écrire ce qu'il relevait sur une pile dérivée — NON REPRODUIT sur une pile neuve, et un mécanisme voisin isolé au passage

**Nature :** dérive d'état de la pile locale, **étrangère à toute unité produit** — aucun fichier du
dépôt n'est en cause, et le comportement est laissé inchangé conformément à `CLAUDE.md` §18 et à
`docs/CloudWorker.md` §3.1.
**Relevée le :** 2026-08-15, en fin de session de la sixième tranche de `CRM-076`.

**Le fait, mesuré.** Le worker relève bien le compte entrant — `inbound_account_polled`, `200` — mais
l'écriture qui suit échoue : `{"level":"ERROR","event":"inbound_poll_write_failed"}`, et l'appel
`POST /internal/v1/inbound-accounts/<id>/poll` rend **`502`**. Mesuré trois fois à une minute
d'intervalle, et **un `docker compose restart mail-sync` ne le lève pas**. La conséquence est
directe et vérifiable : `public.mail_attachments` est **vide** alors que `storage.objects` porte
toujours ses **4** objets du bucket `mail-attachments`, et `public.mail_messages` n'a plus que
**2** lignes.

**Ce que cela rend rouge**, et rien d'autre :

- `e2e/mail/ingestion.spec.ts:133` — `messages_new` est `undefined` là où la preuve attend `>= 1` ;
- `e2e/api/inbox.spec.ts:159` — la pièce jointe `clean` n'existe plus, donc son téléchargement ne
  peut pas être distingué de celui des trois autres états.

**Ce qui établit que ce n'est PAS une régression du dépôt.** Ces deux preuves étaient **vertes plus
tôt dans la même session**, sur le même arbre de travail : campagne complète du 2026-08-15,
`e2e:api` **507/507** et `e2e:mail` **42/42**. Elles ne sont devenues rouges qu'**après** deux
opérations de remise en état rendues nécessaires par un harnais de non-complaisance interrompu, qui
avait laissé `move_card` dégradée en base : `docker compose up migrations-runner`, puis
`supabase/seed/apply-seed.sh`. Le code applicatif n'a pas été touché entre les deux mesures.

**Hypothèse non vérifiée, à ne pas confondre avec un fait.** Le rejeu des migrations réinstalle des
objets dont le worker dépend — propriétaire, privilèges, ou secret de compte entrant relu du vault.
La cause exacte n'a pas été isolée : l'événement `inbound_poll_write_failed` ne porte pas le détail
de l'erreur d'écriture, ce qui est en soi une limite d'observabilité (`CLAUDE.md` §20) et le premier
point à instrumenter.

**LA REPRODUCTION A ÉTÉ TENTÉE DANS LA MÊME SESSION, ET ELLE A ÉCHOUÉ — au sens favorable.** La pile
a été descendue puis remontée à neuf (`docker compose down -v`, `./runDev.sh`, seed appliqué), et
`e2e/mail/ingestion.spec.ts` rend alors **3 scénarios verts**, `mail_attachments` se repeuplant
normalement. Le symptôme **ne se reproduit donc pas sur une pile neuve** : il tenait à l'état
accumulé par la session, non au dépôt ni au rejeu des migrations pris isolément.

**Un mécanisme voisin a en revanche été isolé, et il est utile à connaître.** En descendant la pile,
`docker compose down -v` retire les volumes NOMMÉS — dont celui qui porte la clé pgsodium — alors que
les données de la base vivent dans un **montage lié du dépôt**,
`./supabase/docker/volumes/db/data`, et **survivent**. Les secrets chiffrés avec l'ancienne clé
deviennent alors illisibles, et le seed s'arrête sur
`pgsodium_crypto_aead_det_decrypt_by_id: invalid ciphertext` en configurant le premier compte
entrant. MESURÉ. Le remède, ciblé et suffisant, est de vider les lignes que le seed sait recréer par
le vrai mécanisme d'écriture — `mail_outbound_identities`, `mail_inbound_accounts`, `vault.secrets`
— puis de réappliquer le seed, qui repart alors jusqu'au bout. **`down -v` n'est donc PAS une remise
à zéro complète de cet environnement**, et le croire coûte une réparation manuelle.

**Ce qu'il reste à faire.** Deux points subsistent, aucun ne bloquant :

1. `inbound_poll_write_failed` ne porte **aucun détail exploitable** de l'erreur d'écriture, ce qui
   a rendu ce diagnostic bien plus long qu'il n'aurait dû (`CLAUDE.md` §20). C'est le premier point
   à instrumenter, indépendamment de la cause.
2. La cause exacte de l'échec d'écriture observé en cours de session reste **non isolée** : elle
   n'est plus observable, la pile ayant été renouvelée. Une session qui la reverrait doit capturer
   les logs `mail-sync` AVANT toute remise en état.

Tant que le point 1 n'est pas fait, une session qui verrait ces deux preuves rouges doit d'abord
remonter une pile neuve avant de conclure à une régression de son unité.

**Arbitrage demandé :** aucun. L'entrée est un constat, et sa correction appartient au sous-système
de messagerie, non à `CRM-076`.

### INC-109 — La dégradation « le prédicat revient à `trim()` » de `verify-formulaire.sh` ne dégrade plus rien depuis la décision 374

**Nature :** contrôle de non-complaisance devenu **vide** parce que l'arbitrage qu'il surveillait a
supprimé la divergence qu'il simulait. Le harnais le lit encore comme un échec du produit.
**Relevée le :** 2026-08-15, en exécutant les harnais de fin de session de la quatrième tranche de
`CRM-076`.

**Le fait, mesuré deux fois** — une première pendant que deux tranches concurrentes étaient en
cours de livraison, une seconde sur l'arbre stabilisé (`aeda2c0`), avec le même résultat :

```
scripts/verify-formulaire.sh  →  49 contrôles, 1 en échec
ECHEC  COMPLAISANT : « le prédicat revient à trim(), et diverge de btrim »
       et la preuve d'API reste verte
```

**Pourquoi la preuve d'API reste verte, et pourquoi c'est NORMAL.** Le contrôle D2 bis
(`scripts/verify-formulaire.sh`) remplace, dans `webapp/src/lib/valeur-renseignee.ts` :

```
if (typeof valeur === 'string') return retirerEspaces(valeur).length > 0
```

par :

```
if (typeof valeur === 'string') return valeur.trim().length > 0
```

Or `retirerEspaces` **est** `texte.trim()` depuis la décision 374 : le lot G a élargi la base aux
blancs Unicode via `app.btrim_blancs`, dont la classe est exactement celle de `trim()`, et le
module a cessé de réimplémenter `btrim`. Le commentaire d'en-tête du fichier le dit déjà en toutes
lettres — « la convergence se fait désormais par construction ; il n'y a plus de réimplémentation à
maintenir, donc plus rien qui puisse diverger silencieusement ». La « dégradation » réécrit donc le
code en **lui-même**, et aucune preuve ne peut rougir.

**Ce n'est PAS un défaut du produit, et il ne faut pas le corriger comme tel.** Le prédicat et la
garde donnent bien la même lecture ; c'est le contrôle qui décrit un monde antérieur à la décision
374. Trois issues sont possibles, et aucune n'appartient à la session qui l'a relevée :

1. retirer D2 bis, la divergence qu'il surveillait n'étant plus représentable ;
2. le remplacer par une dégradation qui, elle, dégrade — par exemple `btrim` sans second argument,
   c'est-à-dire l'état d'avant la décision 374 ;
3. le conserver en le marquant explicitement comme attendu vert, ce qui reviendrait à supprimer sa
   valeur de contrôle.

La deuxième paraît la seule qui conserve l'intention du §4.3 du composeur, mais le choix demande
l'arbitrage du responsable : `verify-formulaire.sh` est le harnais de `CRM-037`, unité close.

**Comportement laissé inchangé.** Aucun fichier n'est modifié. Tant que ce point est ouvert,
`scripts/verify-formulaire.sh` rend « 49 contrôles, 1 en échec » sans qu'aucun défaut de produit
n'en soit la cause, et toute session qui l'exécute doit lire cette entrée avant de conclure à une
régression.

**Lié à :** décision 165 (convergence de l'interface vers la base), décision 367 et décision 374
(lot G, `app.btrim_blancs`), `CRM-036`, `CRM-037`.

---

### INC-108 — Trois documents comptent « dix-sept règles » de visibilité là où le seed en pose quinze

**Nature :** chiffre figé dans une spécification et deux documents de suivi, dépassé par une
évolution ultérieure du seed qui ne l'a pas maintenu — même famille qu'INC-080, INC-101, INC-103 et
INC-104. **Relevée le :** 2026-08-15, en établissant la ligne de base de la quatrième tranche de
`CRM-076`, qui avait besoin du compte réel des règles.

**Le fait, mesuré sur la pile seedée** (jeton réel de l'administratrice, `GET /form_field_rules`,
seed appliqué le jour même) :

| Grandeur | Ce que les documents écrivent | Ce que la base porte |
|---|---|---|
| Règles du workflow par défaut | **dix-sept** | **quinze** — sept `hidden`, six `required`, deux `visible` |
| Règles du workflow dérivé | non chiffré | quinze, le même graphe |
| Champs | sept dont un archivé | sept dont un archivé — conforme |
| Règles de l'étape `Prospection` | cinq (`docs/SPEC-form-composer.md` §4.1) | cinq — conforme |

Les trois phrases concernées : `docs/SPEC-form-composer.md` §4 (ligne 320), `docs/BACKLOG.md`
(ligne 3163) et `docs/INCONSISTENCY_REPORT.md` (ligne 1291, dans une entrée close). Le tableau
`REGLES` de `supabase/seed/apply-seed.sh` porte quinze entrées, et le seed vérifie lui-même
l'égalité de ce compte avant de reconstruire la copie : la base ne peut donc pas en porter d'autres.

**Cause probable, non vérifiée :** les trois phrases datent du 2026-08-05, où elles disent avoir été
écrites « après mesure ». Le décompte détaillé du §4.1 — cinq règles sur `Prospection`, un champ
sans règle — reste exact ; seul le total ne l'est plus. Une révision ultérieure du tableau `REGLES`
paraît avoir retiré deux entrées sans relire les totaux cités ailleurs. Aucun harnais n'emploie ce
chiffre — `scripts/verify-champs-formulaire.sh` interroge la base —, donc **rien n'a jamais rougi**.

**Comportement laissé inchangé.** Ces phrases décrivent des unités closes, `CRM-035` et `CRM-037` ;
les corriger au passage retoucherait la preuve écrite d'unités fermées sans les rejouer. La
correction demande l'arbitrage du responsable : soit les trois phrases sont mises au chiffre réel,
soit elles sont datées comme un état passé.

**Ce que cette session a fait à la place :** le §7 bis.11 de `docs/SPEC-workflow-engine.md`, écrit
cette session, porte le chiffre **mesuré** et dit qu'il l'est.

**Lié à :** INC-080, INC-101, INC-103, INC-104 (compteurs figés), `CRM-035`, `CRM-037`, `CRM-076`.

---

### INC-107 — Un seul `veille_compte_echoue` rend `mail-sync.spec.ts:210` rouge pour toute la vie du conteneur

**Nature :** preuve qui juge un **historique** là où elle veut décrire un état. **Relevée le :**
2026-08-14, par une session dont l'unité est `CRM-076`, à l'occasion de la campagne complète.

**Le fait, mesuré :**

| Ce qui est exécuté | Résultat |
|---|---|
| `npm run e2e:mail` seul, avant la campagne du harnais | **42/42** |
| `scripts/verify-harness.sh`, contrôle 5 bis | `mail-sync.spec.ts:210` rouge, 41 passés |
| `npm run e2e:mail` seul, **après** cette campagne | même échec, 41 passés |
| `docker compose restart mail-sync` puis `npm run e2e:mail` | même échec, 41 passés |

La preuve S3 lit `docker logs` du conteneur **en entier** et exige que chaque ligne porte un
`level` dans `['DEBUG', 'INFO']`. Le journal en contient **une** hors de cette liste, et une seule :

```
{"timestamp":"2026-08-14T23:32:45.830Z","level":"WARNING","service":"mail-sync","event":"veille_compte_echoue"}
```

Elle est émise par `mail-sync/src/mail_sync/veille.py:180` lorsqu'un tour de veille échoue à relever
**un** compte, pendant que la campagne `mail` manipule ce même compte. Un `docker restart` ne
change rien : Docker conserve le journal d'un conteneur au travers de ses redémarrages, et seule
sa recréation le vide. **L'échec est donc définitif pour la session**, quelle que soit la santé du
service au moment où la preuve est rejouée.

**Ce n'est pas causé par la session qui le relève.** L'unité est `CRM-076` ; le diff ne touche ni
`mail-sync/`, ni `e2e/mail/`. `pytest mail-sync/tests` rend 242 verts, et les 41 autres scénarios
`mail` sont verts.

**Comportement laissé inchangé.** Deux corrections sont possibles et appartiennent à `CRM-051` :
borner la lecture du journal à la fenêtre du scénario — `docker logs --since` —, ou isoler la
veille de la campagne. La seconde question est plus intéressante que la première et n'est pas
tranchée ici : **un tour de veille qui échoue pendant que la preuve manipule le compte est-il une
anomalie du service, ou l'effet attendu de la preuve ?** Arbitrage demandé.

**Lié à :** INC-105 et INC-099 (preuves non isolées de ce que les autres laissent), INC-106
(le même harnais, un autre défaut), `CRM-051`.

### INC-106 — `verify-mail-sync.sh` déclare absents deux événements présents, parce que `grep -q` ferme le tuyau

**Nature :** défaut du harnais, pas du service. **Relevé le :** 2026-08-14, par une session dont
l'unité est `CRM-076` — le harnais a été exécuté au titre de la campagne complète, pas de l'unité.

**Le fait, mesuré :**

```
$ bash scripts/verify-mail-sync.sh
  ECHEC l'événement service_started est absent
  ECHEC l'événement request_completed est absent
  2 contrôle(s) en échec sur 61.

$ docker logs p2enjoy-mail-sync | grep -c '"event":"service_started"'   → 6
$ docker logs p2enjoy-mail-sync | grep -c '"event":"request_completed"' → 485
```

Les deux événements **sont** dans le journal, et le harnais dispose bien de ce journal : la trace
`bash -x` montre `journaux` chargé de 130 227 octets, contenant les deux motifs, et le `grep`
émis avec le bon motif.

**La cause, isolée en deux commandes :**

```
$ bash -c 'set -uo pipefail; j=$(docker logs p2enjoy-mail-sync 2>&1);
           printf "%s\n" "$j" | grep -q "\"event\":\"service_started\""; echo $?'   → 141
$ bash -c 'set -uo pipefail; j=$(docker logs p2enjoy-mail-sync 2>&1 | head -50);
           printf "%s\n" "$j" | grep -q "\"event\":\"service_started\""; echo $?'   → 0
```

`grep -q` sort **dès la première correspondance**. Sur un journal plus grand que le tampon du
tuyau, `printf` reçoit alors `SIGPIPE` et rend 141 ; le `set -euo pipefail` de la ligne 46 propage
ce 141 à la ligne 447, et `… && ok || fail` bascule sur `fail`. Le contrôle échoue **d'autant plus
sûrement que la preuve est bonne** : plus le journal contient d'événements attendus, plus tôt
`grep` ferme le tuyau.

**Portée exacte.** Seuls les contrôles de la forme `printf … | grep -q <motif présent>` sont
touchés — la boucle de la ligne 446. Les autres `grep -q` du même fichier cherchent une chaîne
**absente** en nominal (jeton, `WARNING`, en-tête d'authentification) : `grep` lit alors tout le
flux, aucun `SIGPIPE` n'a lieu, et leur verdict reste juste. Le même motif est à rechercher dans
les autres harnais avant toute correction.

**Ce n'est pas causé par la session qui le relève.** L'unité est `CRM-076` ; le diff ne touche ni
`mail-sync/`, ni `scripts/verify-mail-sync.sh`, ni aucun journal. `pytest mail-sync/tests` rend
**242 verts sans avertissement** sur la même pile, et les 59 autres contrôles du harnais sont verts.

**Comportement laissé inchangé.** La correction appartient à `CRM-051`, qui porte ce harnais : elle
tient probablement en un `grep -c` comparé à zéro, ou en un `|| true` explicite sur le `printf`,
mais trancher la forme depuis une autre unité reviendrait à réécrire la preuve d'autrui. Arbitrage
demandé.

**Lié à :** `CRM-051`, INC-101 (garde-fous d'un harnais faux sans que rien ne le signale).

### INC-105 — Une preuve de `CRM-043` rend deux pierres tombales là où elle en attend une, et seulement dans la campagne complète

**Nature :** preuve dépendante de l'état du fil, non isolée de ce que les autres scénarios de la
campagne y laissent. **Relevée le :** 2026-08-14, par le harnais `scripts/verify-harness.sh` exécuté
au titre de la deuxième tranche de `CRM-076`.

**Le fait, mesuré quatre fois :**

| Ce qui est exécuté | Base | Résultat |
|---|---|---|
| `npm run e2e:ui` complet | seed du début de session | **201/201** |
| `e2e/ui/commentaires-gestes.spec.ts` seul | seed réappliqué | **8/8** |
| `e2e/ui/commentaires-gestes.spec.ts` seul, après `npm run e2e:api` | seed réappliqué | **8/8** |
| `npm run e2e:ui` complet | seed réappliqué | **200/1** |

L'échec est toujours le même, `commentaires-gestes.spec.ts:181` :

```
strict mode violation: getByTestId('commentaire').getByText('Commentaire supprimé')
resolved to 2 elements
```

Le scénario publie son commentaire, le supprime, puis affirme que **la** pierre tombale est
visible. Dans la campagne complète, le fil en porte **deux** : la sienne, et une autre. La lecture
de `card_comments` après coup n'en montre qu'une par card — la seconde n'existait donc que pendant
la campagne, et le `finally` de son scénario l'a effacée avant qu'on puisse la nommer. **Son
origine reste à établir**, et c'est précisément ce que cette entrée demande.

**Ce n'est pas causé par la session qui la relève.** Le diff de la session ne touche que
`administration-workflows*` (données, écran, preuves), `i18n/fr.ts` et `verify-harness.sh` : aucun
fichier du fil de commentaires, aucune migration, aucune donnée de seed. Le fichier en échec n'est
pas modifié d'une ligne.

**Comportement laissé inchangé.** La correction appartient à `CRM-043` : soit la preuve cible sa
propre pierre tombale par un identifiant plutôt que par le texte partagé, soit le scénario qui
laisse la seconde est trouvé et rendu étanche. Trancher depuis une session dont l'unité est
`CRM-076` reviendrait à réécrire la preuve d'une autre unité sans en connaître le contrat.

**Conséquence sur le verdict de cette session :** `scripts/verify-harness.sh` ne peut pas rendre
vert tant que cette entrée est ouverte, et les autres contrôles du harnais — `test:sql`,
`e2e:api`, `e2e:mail`, `test:unit`, `typecheck`, `e2e:report`, les six dégradations de
non-complaisance — sont verts. `scripts/verify-workflows.sh`, lui, rend **49 contrôles, aucune
anomalie**.

**Complément mesuré le 2026-08-14, même famille, cause enfin nommée.** Après une campagne
interrompue, `commentaires-gestes.spec.ts` échoue **trois fois** et **même isolée** :
`getByTestId('actions-commentaire')` rend 2 au lieu de 1. La lecture de `card_comments` par la clé
de service montre pourquoi — un commentaire de trop, sur la card `…00c2`, écrit par l'auteur de la
preuve :

```
00c2 | 0011 | 'Geste 1786750198221-32997'
```

`1786750198221` est l'horodatage du scénario qui l'a créé, à la seconde près pendant la campagne
qui a échoué. Son `finally` n'a donc pas purgé — parce que le scénario avait déjà échoué —, et
**réappliquer le seed ne le retire pas** (INC-102). Toute exécution ultérieure échoue alors sur le
résidu de la précédente, ce qui donne à ce défaut son apparence de propagation. Résidu retiré à la
main par la clé de service : la suite redevient **8/8** immédiatement, sans qu'aucun code ni
aucune preuve ne soit modifié.

Ce complément ne change pas ce qui est demandé : soit la preuve cible sa propre trace par un
identifiant, soit son `finally` purge même après échec — deux corrections qui appartiennent à
`CRM-043`.

**Lié à :** INC-099 (une preuve rend la table dans l'état où elle l'a trouvée), INC-102 (le seed ne
converge pas sur une base déjà seedée), INC-107 (même famille, côté messagerie), `CRM-043`,
`CRM-076`.

---

### INC-104 — Le backlog compte « dix transitions dont quatre à motif » là où le seed en pose onze dont cinq

**Nature :** chiffre figé dans un document de suivi, dépassé par une livraison ultérieure qui ne
l'a pas maintenu — même famille qu'INC-080, INC-101 et INC-103. **Relevée le :** 2026-08-14, en
écrivant les preuves de la deuxième tranche de `CRM-076`, qui avaient besoin du graphe réel.

**Le fait, mesuré sur la pile seedée** (`docker compose exec db psql`, workflow par défaut
`5eed0000-…-051` **et** workflow dérivé `c0eaacea-…`) :

| Grandeur | Ce que `docs/BACKLOG.md` écrit deux fois (lignes 3605 et 3725) | Ce que la base porte |
|---|---|---|
| Étapes | sept | sept |
| Transitions | **dix** | **onze** |
| Transitions à motif exigé | **quatre** | **cinq** |
| Étapes sans sortie | deux | deux — `Livré` et `Perdu` |

**Cause probable, non vérifiée :** la décision 259 a déclaré `Réalisation en cours → Perdu` pour
clore INC-003, avec le motif exigé comme les quatre autres « Marquer perdu ». Les deux phrases du
backlog datent d'avant et n'ont pas été relues à cette occasion. Le chiffre n'est employé par aucun
harnais — `scripts/verify-workflows.sh` interroge la base —, donc **rien n'a jamais rougi**.

**Comportement laissé inchangé.** Ces deux phrases décrivent la Definition of Done de `CRM-041` et
de `CRM-046`, unités closes qui ne sont pas celles de cette session : les corriger au passage
reviendrait à retoucher la preuve écrite d'une unité fermée sans la rejouer. La correction demande
l'arbitrage du responsable : soit les deux phrases sont mises au chiffre réel, soit elles sont
datées comme un état passé.

**Ce que cette session a fait à la place :** le §7 bis.9.7 de `docs/SPEC-workflow-engine.md`, écrit
cette session, porte le chiffre **mesuré** et dit qu'il l'est.

**Lié à :** INC-080, INC-101, INC-103 (compteurs figés), décision 259 (INC-003), `CRM-076`.

---

### INC-103 — Ce registre porte deux comptes de ses propres entrées closes, et aucun des deux ne correspondait au tableau

**Nature :** compteur figé non maintenu par les livraisons qui le dépassent, **dans le document de
suivi lui-même**. Même famille qu'INC-080 et INC-101, appliquée cette fois à la comptabilité du
registre. **Relevée le :** 2026-08-14, pendant le lot I+J, en y inscrivant la clôture de deux
entrées.

**Le fait, mesuré avant toute modification** (`git show HEAD:docs/INCONSISTENCY_REPORT.md`) :

| Endroit | Ce qui était écrit | Lignes réellement alignées | Écart |
|---|---|---|---|
| En-tête, « État au 2026-08-14 » | **43 closes** | 46 | −3 |
| Intitulé de « Clos — index » | « **Quarante-cinq** entrées closes » | 46 | −1 |
| En-tête, « et **56 ouvertes** » | 56 | **56** `### INC-` | conforme |

Les deux premiers nombres se contredisent **entre eux** avant même de contredire le tableau : un
document de suivi qui porte deux comptes différents de la même chose ne peut pas servir de source de
vérité sur son propre état. Le troisième, lui, était juste — ce qui montre que le défaut n'est pas
une négligence générale mais l'absence de recomptage à chaque clôture, exactement le mécanisme
d'INC-101 sur `verify-harness.sh`.

**Ce que la clôture d'une entrée demande aujourd'hui, et personne ne le fait en entier.** Retirer le
texte, ajouter la ligne d'index, **puis** mettre à jour deux nombres situés dans deux paragraphes
distincts, dont l'un est écrit en toutes lettres. Le dernier geste est celui qu'on oublie, et rien
ne le rappelle : aucun harnais ne compare ces nombres au contenu du fichier.

**Ce qui a été fait ici, et pourquoi ce n'est pas « corriger un défaut au passage ».** Les deux
nombres sont **recomptés** — 48 closes, 55 ouvertes, cette entrée comprise —, non incrémentés depuis
des valeurs fausses.
Le lot I+J devait de toute façon les écrire pour inscrire ses deux clôtures, et publier sciemment un
compte faux aurait été un mensonge de plus plutôt qu'une abstention. La **cause**, elle, est laissée
intacte et c'est l'objet de cette entrée.

**Ce qu'il faut faire :** cesser de tenir ce compte à la main. Deux issues, chiffrées :

1. **Un contrôle dans un harnais existant** — `scripts/verify-scripts.sh` ou un contrôle dédié —
   qui compte les lignes `| INC-` de l'index et les titres `### INC-` de la section « Ouverts », et
   refuse tout écart avec les nombres publiés. Coût : quelques lignes. C'est la forme qu'INC-101
   recommande pour les compteurs de campagne, et elle vaut ici pour la même raison.
2. **Supprimer les nombres du texte** et laisser le tableau et les titres faire foi. Coût : nul.
   Perte : la lecture d'un coup d'œil de l'état du registre, que la première ligne du document
   offre aujourd'hui.

Le choix entre « garder le nombre et le garder juste » et « ne plus l'écrire » appartient au
responsable : il engage la lisibilité du document le plus relu du dépôt. **Aucun harnais n'est
ajouté ici.**

**Lié à :** INC-080 et INC-101 (garde-fous figés non maintenus), INC-100 (document qui se contredit
lui-même), `docs/CloudWorker.md` §4.1 (ce registre est lu à chaque exécution).

---

### INC-102 — Le seed ne peut PAS faire converger `…0d4` vers la modération sur une base déjà seedée, et il annonce pourtant sa convergence

**Nature :** convergence du seed impossible par construction sur une base antérieure, et **annoncée
comme acquise** ; la preuve `0017` de l'unité en rougit.
**Relevée le :** 2026-08-14, en rejouant le seed puis `npm run test:sql` sur une pile montée AVANT
la livraison d'INC-072, c'est-à-dire sur le chemin de mise à jour d'un poste existant.

**Le fait, MESURÉ.** La pile a été montée et seedée avec la version d'`apply-seed.sh` antérieure au
commit `80214c8`, qui retirait `…0d4` avec la **clé de service**. `auth.uid()` y étant nul, la base
porte donc :

```
id …0d4 | author_id …012 (Driss) | deleted_at renseignée | deleted_by NULL
```

Le seed a ensuite été rejoué avec la version livrée, celle qui retire `…0d4` avec le **jeton réel**
de l'administratrice. Sortie observée :

```
d4 déjà retiré : rien à faire (convergence par état)
```

et `deleted_by` vaut toujours `NULL`. La ligne d'information finale du même seed affirme pourtant :

```
Celui de la card c4 est retiré par un TIERS : deleted_by diffère d'author_id (INC-072, décision 376)
```

**Ce qui en rougit.** `npm run test:sql` sur cette base, code courant, base sans autre résidu :

```
ECHEC supabase/tests/0017_commentaires.test.sql — 1 assertion(s) en échec sur 98
  not ok 81 - …et il a été retiré par CAMILLE AUBERT, qui n'en est pas l'auteur
      have: NULL
      want: 5eed0000-0000-4000-8000-000000000011
```

et, dans `e2e/ui/commentaires-gestes.spec.ts`, le scénario « le commentaire retiré du seed se lit
comme tel dans le fil » échoue sur la même cause, à l'assertion `deleted_by === PROFIL_CAMILLE`.
**Les 32 autres suites pgTAP et les 7 autres scénarios du fichier sont verts** : le défaut est
strictement celui-ci.

**Pourquoi ce n'est PAS réparable par une écriture de plus.** La garde du seed est
`if [ "$etat_d4" = 'null' ]`, donc elle ne se déclenche que sur une ligne encore vivante. La lever
ne suffirait pas : le trigger `card_comments_avant_maj` lève `comment_deleted` sur **toute**
écriture visant une ligne déjà supprimée, quel que soit le rôle, `service_role` compris. La pierre
tombale est irréversible par conception (`docs/SPEC-cards.md` §13.4, et §13.13 point 6, qui la nomme
explicitement comme telle). Aucun `PATCH` ne peut donc porter `deleted_by` après coup.

**Ce que cela dit de plus gênant qu'une assertion rouge.** L'unité `CRM-043` lot G est close `[x]`
et INC-072 avec elle, sur la foi d'une preuve qui n'est verte que sur une base **recréée**. Or ni
`README.md`, ni `docs/SPEC-seed.md` §2.14, ni `docs/PROD_MIGRATIONS.md` n'indiquent qu'une base
antérieure doit être recréée pour que le seed tienne sa promesse. Un poste existant rejoue le seed,
le voit réussir, lit « retiré par un TIERS » — et sa suite `0017` est rouge sans que rien n'explique
pourquoi. C'est exactement le cas que `CLAUDE.md` §8 vise en demandant que le seed **démontre** ce
qu'il annonce.

**Ce qui n'est PAS tranché ici, et pourquoi.** Trois issues sont possibles, et elles n'ont pas le
même coût :

1. **supprimer physiquement `…0d4` puis le réinsérer** lorsque `deleted_at` est renseignée et
   `deleted_by` nulle, avant de le faire retirer par le jeton réel — `service_role` porte bien le
   privilège `DELETE` (migration `0015`, `grant all privileges`). La convergence redevient totale,
   au prix d'une destruction de ligne que le seed ne pratique nulle part ailleurs ;
2. **documenter la limite** — une base seedée avant `80214c8` doit être recréée — dans
   `docs/SPEC-seed.md` §2.14 et dans le contrat de déploiement, et laisser la garde telle quelle ;
3. **borner l'assertion 81** à une base fraîche, ce qui affaiblirait une preuve pour accommoder un
   état, et que ce registre ne recommande pas.

Le choix engage la doctrine de convergence du seed, qui appartient au responsable
(`docs/CloudWorker.md` §4.1 : une entrée qui attend un arbitrage ne se tranche pas soi-même).
**Comportement laissé rigoureusement inchangé**, statut de `CRM-043` non modifié : la preuve est
verte sur base fraîche, et l'écart mesuré ici porte sur le chemin de mise à jour.

### INC-100 — Le chapitre 4.10 du manuel se contredit lui-même sur deux points déjà livrés

**Nature :** documentation utilisateur dépassée par le produit, contradiction interne au même
document. **Relevée le :** 2026-08-14, pendant la reprise de `CRM-043` (INC-072), en rédigeant le
chapitre voisin.

La liste « Ce que le fil ne fait pas encore » du §4.10 de `docs/manual.md` porte deux affirmations
que le produit dément, et que **le manuel lui-même dément ailleurs** :

| Affirmation du §4.10 | Ce que le produit fait | Ce que le manuel dit ailleurs |
|---|---|---|
| « **Aucun nom d'auteur n'est affiché** : aucun nom de personne n'est aujourd'hui lisible dans le produit » | `PanneauTimeline.tsx` rend le nom et l'avatar de l'auteur, par la relation embarquée livrée par `CRM-022` | §3.2 : « les commentaires leur auteur et les événements leur acteur lorsque cette identité est connue » |
| « **Le motif d'un déplacement n'est conservé nulle part.** L'écran le demande […] et il n'est enregistré ni dans le fil, ni ailleurs » | `move_card` conserve le motif dans `card_comments` depuis la migration `0035` (INC-048, décision 374) | §4.3 : « Le motif que vous donnez est conservé, et il l'est comme un commentaire » |

**Mesure.** Les deux lignes sont des restes : la première date d'avant `CRM-022`, la seconde d'avant
le lot G. Chacune a été corrigée dans **son** chapitre sans que la liste du §4.10 le soit.

**Comportement laissé INCHANGÉ, et rien n'est corrigé au passage.** Les deux affirmations
appartiennent à `CRM-022` et à `CRM-034` — ni l'une ni l'autre à INC-072, qui reprend le seul geste
de modération. Les corriger ici toucherait deux unités sans rejouer leurs preuves sous leur unité,
ce que `docs/CloudWorker.md` §3.1 proscrit. Le §4.10 a été modifié dans le même changement **sur
les seuls points de modération**, et ces deux lignes ont été laissées telles quelles.

**Ce qu'il faut faire :** retirer les deux affirmations de la liste du §4.10, sous l'unité qui les a
rendues fausses, et relire la liste entière au même moment — un inventaire de manques qui n'est pas
relu à chaque livraison devient un inventaire de mensonges.

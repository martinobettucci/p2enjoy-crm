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

**Application du 2026-08-15, premier temps.** Relecture intégrale des soixante-huit entrées alors
en texte complet. Cinquante-deux avaient reçu un arbitrage — la quasi-totalité par la délégation
exhaustive des décisions 292 à 299 (2026-08-08, `docs/ARBITRAGES.md` §2), le reste par une décision
individuelle citée dans l'index — et ont été retirées. Le compte de l'index est passé de
**quarante-huit à cent**. Seize n'avaient reçu aucun arbitrage, et trois de plus — INC-117 à
INC-119 — ont été consignées par une session concurrente pendant la même fenêtre : dix-neuf entrées
restaient donc ouvertes.

**Application du 2026-08-15, second temps — le registre est vide.** Le responsable a demandé de
**trancher automatiquement tout ce qui restait en suspens**. Les dix-neuf entrées ont été arbitrées
une par une par les décisions **408 à 419** et retirées ici, portant l'index à **cent dix-neuf**.
Douze décisions pour dix-neuf entrées : plusieurs partageaient un mode de défaillance unique — une
dégradation devenue vide, un harnais qui rejoue une migration isolée, une preuve qui juge un
historique, un chiffre que personne ne maintient — et les trancher séparément aurait produit quatre
règles là où une seule était nécessaire. **Aucune entrée n'est ouverte à ce jour** ; toute la dette
restante est une dette de mise en œuvre, suivie dans `docs/ARBITRAGES.md` et dans le backlog.

---

## Retirées — index

**Cent vingt-deux** entrées retirées, texte intégral dans l'historique Git. Colonnes : ce que l'entrée
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
| INC-053 | `SPEC-form-composer` §2.3 ne disait pas laquelle de `CRM-036`/`CRM-060` résout `user`/`contact` | 2026-08-08 | **LIVRÉE le 2026-08-18** — `CRM-060` tranche 3, migration `0047` : les deux types résolvent leur cible dans le workspace de la valeur | 292-299, 295 |
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
| INC-100 | Le chapitre 4.10 du manuel se contredisait lui-même sur deux points déjà livrés | 2026-08-15 | `docs/manual.md` §4.10, liste entière relue | 414 |
| INC-102 | Le seed ne pouvait pas faire converger `…0d4` et annonçait pourtant sa convergence | 2026-08-15 | `supabase/seed/apply-seed.sh`, `CRM-046` | 415 |
| INC-103 | Ce registre portait deux comptes de ses propres entrées closes | 2026-08-15 | `scripts/verify-scripts.sh` — contrôle de recomptage | 413 |
| INC-104 | Le backlog comptait « dix transitions dont quatre à motif », le seed en pose onze dont cinq | 2026-08-15 | `docs/BACKLOG.md` | 413 |
| INC-105 | Une preuve de `CRM-043` rendait deux pierres tombales dans la campagne complète | 2026-08-15 | `CRM-043` | 410 |
| INC-106 | `verify-mail-sync.sh` déclarait absents deux événements présents — `grep -q` et `SIGPIPE` | 2026-08-15 | `CRM-051`, balayage `CRM-008` | 412 |
| INC-107 | Un seul `veille_compte_echoue` rendait `mail-sync.spec.ts:210` rouge pour la vie du conteneur | 2026-08-15 | `CRM-051` | 411 |
| INC-108 | Trois documents comptaient « dix-sept règles » de visibilité, le seed en pose quinze | 2026-08-15 | documentation | 413 |
| INC-109 | La dégradation « le prédicat revient à `trim()` » ne dégradait plus rien | 2026-08-15 | reprise transverse des harnais, `CRM-008` | 408 |
| INC-110 | `mail-sync` avait cessé d'écrire sur une pile dérivée — non reproduit sur pile neuve | 2026-08-15 | `CRM-051` (instrumentation), `docs/DAT.md` | 418 |
| INC-111 | L'exigence « TOUTE PREMIÈRE action » de la tâche planifiée était invérifiable | 2026-08-15 | `docs/CloudWorker.md`, crochet de clôture | 419 |
| INC-112 | `verify-tracks.sh` rejouait `0003` et rouvrait l'audit de la corbeille | 2026-08-15 | reprise transverse des harnais, `CRM-008` | 409 |
| INC-113 | `verify-droits-fins.sh` rejouait `0010` seule et retirait la transitivité | 2026-08-15 | reprise transverse des harnais, `CRM-008` | 409 |
| INC-114 | La barre d'onglets rendait « Aucun channel » sur les quatre écrans de réglages | 2026-08-15 | `CRM-007` | 416 |
| INC-115 | La preuve n° 13 exigeait que la lectrice ne lise PAS `conseil-ia` | 2026-08-15 | reprise `CRM-012` | 417 |
| INC-116 | L'empreinte du §9.8 n'était stable qu'à partir du deuxième rejeu du seed | 2026-08-15 | `CRM-046`, reprise des harnais | 410 |
| INC-117 | `verify-webapp.sh` rendait une anomalie E2E différente à chaque exécution | 2026-08-15 | reprise transverse des harnais, `CRM-008` | 410 |
| INC-118 | Le scénario S3 de `mail-sync` lisait le journal CUMULÉ du conteneur | 2026-08-15 | `CRM-051` | 411 |
| INC-119 | La dégradation « CHECK élargi à `mail_received` » n'en était plus une | 2026-08-15 | reprise transverse des harnais, `CRM-008` | 408 |
| INC-120 | La garde des élévations de privilège n'admettait qu'une migration, le dépôt en compte deux — **INC-094 rouverte** | 2026-08-15 | `CRM-002` — garde par propriété mécanique | 363, 428 |
| INC-121 | Trois compteurs figés de `verify-preuves-refus.sh` périmés de plusieurs unités | 2026-08-15 | `CRM-014` et `CRM-013` (preuves dues), `CRM-008` (calcul des compteurs) | 413, 429 |
| INC-122 | Deux assertions de `CRM-078` s'appuyaient sur un identifiant que le seed n'épingle pas | 2026-08-15 | `CRM-078`, première tranche | 430 |

---

## Ouverts

**Vingt ouvertes à ce jour : INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157, INC-158, INC-159, INC-160, INC-173, INC-174,
INC-182 et INC-183** — **INC-182** et **INC-183** consignées le 2026-08-20 par la session `CRM-086`
tranche 6, en lisant `docs/SPEC-costs.md` §4.8 AVANT de le coder. Ce sont deux manques de
SPÉCIFICATION portant sur l'onglet même que la tranche livre, et non deux constats étrangers :
**INC-182**, le badge de l'onglet « À saisir » ne peut pas porter le même nombre que la mention du
§4.4, la clôture et la devise séparant structurellement les deux populations — mesuré 2 contre 1 sur
le seed ; **INC-183**, le seuil d'ancienneté que `docs/DESIGN_SYSTEM.md` §5.31 suppose n'existe nulle
part pour une ligne de coût, celui d'une card étant une donnée de son étape de workflow. Aucun des
deux n'est tranché sur place ; le comportement livré est nommé aux §4.8.1 et §4.8.2 de la
spécification.

Précédemment dix-huit : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157, INC-158, INC-159, INC-160, INC-173 et
INC-174** — **INC-174** consignée le 2026-08-19 par la même session : le parcours clavier de la
grille champ × étape de `administration-workflows.spec.ts` échoue DANS une campagne complète et
passe SEUL en 29,8 s. Étranger au diff — aucun module de la tranche n'est monté sur
`/reglages/workflows` —, cause exacte NON établie.

Précédemment dix-sept : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157, INC-158, INC-159, INC-160 et INC-173** —
**INC-173** consignée le 2026-08-19 par la session `CRM-084` tranche 2 : `docs/SPEC-costs.md` §4.1
décrit une colonne qui COMPTE les occurrences ouvertes, le §3.2 nomme les droits d'écriture d'une
occurrence, et **aucun chapitre ne décrit l'écran qui porterait ces gestes**. Or le §4.6 exigera
d'en CHOISIR une pour rattacher une ligne de coût à un budget récurrent (`CRM-085`). Manque de
SPÉCIFICATION, laissé intact et non tranché sur place.

Précédemment seize : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157, INC-158, INC-159 et INC-160** — **INC-160**
consignée le 2026-08-18 par la session `CRM-060` sous-tranche 4d : `verify-champs-formulaire.sh`
**dégrade `public.move_card`** en rejouant la migration `0009` pour se restaurer, et laisse en base
une version d'avant les migrations qui lui ont fait ÉCRIRE le commentaire qu'elle exige. Même
mécanisme qu'INC-129. Défaut ANTÉRIEUR et étranger à l'unité, prouvé tel sans `git stash`.

Précédemment quinze : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157, INC-158 et INC-159** — **INC-159** consignée
le 2026-08-18 par la session `CRM-060` sous-tranche 4d : deux commentaires de spécification et de
seed annonçaient « six types distincts » pour sept champs qui en couvraient **sept**. Écart de
COMMENTAIRE seul, qu'aucune assertion ne portait — `verify-champs-formulaire.sh` comptait bien sept.
Corrigé dans le même changement plutôt que reconduit faux, la sous-tranche réécrivant ces deux
paragraphes pour y porter le nouveau compte ; consigné ici pour que la correction ne passe pas pour
une livraison.

Précédemment quatorze : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155, INC-157 et INC-158** — **INC-158** consignée le
2026-08-18 par la session `CRM-060` tranche 4a : trois classes citées par trois composants ne sont
**pas engendrées** dans le CSS produit, donc silencieusement sans effet. Défaut ANTÉRIEUR, prouvé
tel par `git blame`, et laissé inchangé (`CLAUDE.md` §3.1).

Précédemment treize : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152, INC-155 et INC-157** — **INC-157** consignée le 2026-08-18 par
la session `CRM-060` tranche 4a : la barre d'onglets écrit « Aucun channel » sur les routes
transverses, qui n'ont pas de channel à lister. Défaut ANTÉRIEUR, observé sur une capture et
laissé inchangé (`CLAUDE.md` §3.1).

Précédemment douze : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138,
INC-139, INC-140, INC-141, INC-152 et INC-155** — **INC-155** consignée le 2026-08-18 par la session
`CRM-060` tranche 3 : elle n'est pas un défaut neuf mais le SECOND porteur d'INC-141, le compteur
« quinze cards seedées » vivant aussi dans `verify-move-card.sh` ; les deux se ferment ensemble.
Précédemment onze : **INC-123, INC-124, INC-125, INC-126, INC-136, INC-137, INC-138, INC-139,
INC-140, INC-141 et INC-152** — **INC-139** et **INC-141** consignées le 2026-08-17 par la session
`CRM-081` tranche 2 d (`verify-board.sh` complet rend trois échecs de plus que son mode
`--rapide`, tous mesurés identiques sur la ligne de base, donc préexistants ;
`verify-colonnes-protegees.sh` attend quinze cards seedées là où la base en porte quarante et une),
**INC-140** par une session concurrente du même jour, dont le numéro était déjà poussé lorsque la
présente entrée a été rebasée — d'où sa renumérotation en INC-141, résolue sur place et non par une
branche (`docs/CloudWorker.md` §0). **Sept ouvertes auparavant : INC-123, INC-124,
INC-125, INC-126, INC-136, INC-137 et INC-138** — les
deux avant-dernières consignées le 2026-08-17 par la session `CRM-081` tranche 2 b (le §16.12.2 écarte
`now()` en affirmant qu'il n'est pas évalué, alors que Postgres l'évalue ; `verify-board.sh` exige
que les channels ne soient lus qu'à un endroit, alors que le produit en compte quatre). **Cinq ouvertes auparavant :
INC-123, INC-124, INC-125, INC-126 et INC-136** — la dernière
consignée le 2026-08-16 par la session `CRM-081` (le dépôt d'un objet Storage rend
`InvalidAccessKeyId` sur un cluster fraîchement créé). **Quatre ouvertes auparavant : INC-123,
INC-124, INC-125 et INC-126** — la dernière consignée le
2026-08-16 par la session `CRM-030` (la proposition de clé perd la ligature « œ »). Les trois
premières, consignées par les deux sessions `CRM-079` du
2026-08-15 (navigateur absent pour les scénarios Roundcube ; `WARNING` de `mail-sync` interdit par
la preuve S3). Les trois précédentes — **INC-120, INC-121 et INC-122**, consignées le 2026-08-15 (garde des élévations de privilège des
migrations ; compteurs figés de `verify-preuves-refus.sh` ; identifiant non épinglé du workflow
dérivé dans les preuves de `CRM-078`). Les
dix-neuf entrées qui restaient en texte complet ont été **arbitrées le 2026-08-15
par les décisions 408 à 419**, sur instruction du responsable de trancher automatiquement tout ce
qui restait en suspens. Conformément à la règle de retrait de la décision 407, elles rejoignent
l'index ci-dessus dès l'arbitrage rendu ; **la mise en œuvre de chacune reste due** et est suivie
dans `docs/ARBITRAGES.md` et dans la Definition of Done de l'unité porteuse.

**Solde du 2026-08-15, troisième temps.** Trois entrées consignées par les sessions de `CRM-077` et
`CRM-078` — **INC-120**, **INC-121** et **INC-122** — sont arbitrées par les décisions **428 à 430**
et retirées. L'index passe à **cent vingt-deux**. **INC-120 était INC-094 rouverte** : un arbitrage
rendu le 2026-08-13 et non livré a fini par être redemandé sous un numéro neuf, ce qui est la
démonstration que la dette de mise en œuvre du §1 de `docs/ARBITRAGES.md` n'est pas une formalité.

Une nouvelle entrée n'est ouverte ici que dans les conditions de la doctrine ci-dessus : un choix
qu'aucune mesure ne permet de trancher seul, ou un point que `CLAUDE.md` §26 réserve au responsable.

---

## Consignées le 2026-08-16 — trois constats étrangers à `CRM-079`, puis INC-126 et INC-127

Les trois suivent la doctrine du §1 : ils sont **mesurés**, ils sont **étrangers à l'unité de la
session**, et le comportement est laissé **inchangé**. Aucun des trois ne demande d'arbitrage : ce
sont des faits à porter par leur unité, pas des choix à trancher. *La troisième, **INC-125**, a été
consignée le 2026-08-16 par la session qui a clos `CRM-079`.*

### INC-162 — `verify-cards.sh` attend « 14/1/1/14 » là où le seed en produit « 15/1/1/15 » depuis `CRM-060` tranche 4d

**Nature :** la section 8 de `scripts/verify-cards.sh` — « le seed est conforme et convergent » —
compare l'état du seed à un compteur figé. Le seed a été enrichi depuis, et le compteur ne l'a pas
été dans le même changement. Le contrôle rougit donc sur une **dérive de compteur**, pas sur un
défaut du produit : les quarante-cinq autres contrôles du harnais sont verts, **y compris ses
suites globales** — `test:sql`, `test:unit`, `typecheck`, `types:check`, `build`, `e2e:api` et
`e2e:ui` — et ses trois dégradations de non-complaisance mordent toutes.

**Mesure, 2026-08-19, sur la pile seedée de cette session, harnais exécuté SEUL :**

```
scripts/verify-cards.sh
  8. Le seed est conforme et convergent — §9
     ECHEC  état du seed : « 15/1/1/15 », attendu « 14/1/1/14 »
  10. Suites, tests unitaires et build : les sept contrôles OK
  46 contrôles, 1 en échec.
```

**Étrangère à l'unité de la session.** `CRM-060` sous-tranche 4f **ne modifie pas le seed**, et
c'est vérifié plutôt que supposé : aucun de ses commits ne touche `supabase/seed/`, et
`git log -- supabase/seed/apply-seed.sh` désigne `7452bc1` — `CRM-060` tranche **4d** — comme
dernier changement, antérieur à cette session. Le comportement est laissé **inchangé**.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** deux réponses sont
possibles — porter le compteur à « 15/1/1/15 » comme les compteurs de `verify-harness.sh` l'ont été,
ou constater que l'enrichissement de 4d a ajouté une ligne qu'il ne devait pas. Choisir demande de
relire ce que 4d a voulu, ce qui appartient à l'unité qui a enrichi le seed, pas à celle qui passe.

**Une observation d'exploitation, mesurée le même jour, et qui n'est PAS une entrée du registre mais
une précaution de méthode :** deux harnais lancés **en parallèle** se perturbent, l'un dégradant la
base pendant que l'autre mesure. `verify-seed-demo.sh` a rendu « 2 anomalies » pendant que
`verify-harness.sh` tournait, puis **69 contrôles, aucune anomalie** exécuté seul. Un verdict rendu
dans ces conditions ne dit rien du produit.

### INC-161 — `e2e:mail` rougit sur un `WARNING` que la veille de `mail-sync` émet en fonctionnement NORMAL

**Nature :** le scénario `S3` de `e2e/mail/mail-sync.spec.ts` (ligne 231) exige que **chaque** ligne
de la console de `mail-sync` porte un niveau `DEBUG` ou `INFO`. Or la boucle de veille émet
`veille_compte_echoue` en `WARNING` dès qu'un compte n'a pas pu être relevé
(`mail-sync/src/mail_sync/veille.py` ligne 180), et c'est le cas sur une pile de développement
fraîchement seedée — le seed déclare des comptes entrants dont aucun serveur distant ne répond.

**Mesure, 2026-08-19, sur la pile seedée de cette session :**

```
npm run e2e:mail  => 41 passed, 1 failed
  S3 › chaque ligne est un JSON borné, sans secret ni avertissement
  Expected value: "WARNING" — Received array: ["DEBUG", "INFO"]

docker compose logs mail-sync | grep -c WARNING  => 1
{"timestamp":"2026-08-19T00:52:42.244Z","level":"WARNING","service":"mail-sync",
 "event":"veille_compte_echoue"}
```

**Étrangère à l'unité de la session**, qui n'a touché aucune ligne de Python ni de messagerie :
`CRM-060` sous-tranche 4e ne porte que le carnet de contacts et ses preuves. `pytest mail-sync/tests`
est d'ailleurs **vert, 242 tests**, ce qui confirme que le service se comporte comme son code le
dit — c'est l'attente du scénario qui ne prévoit pas ce cas.

**Ce qui est en jeu, et pourquoi ce n'est pas tranché ici.** Deux lectures se défendent, et elles
appartiennent à l'unité qui porte la messagerie, pas à celle-ci :

1. un `WARNING` sur un compte injoignable est le comportement **voulu** d'une veille — le silencier
   serait masquer une erreur (`CLAUDE.md` §18) —, et c'est alors le scénario `S3` qui doit tolérer
   `WARNING` en distinguant « avertissement métier attendu » de « avertissement de panne » ;
2. ou bien la veille ne devrait pas avertir pour un compte de démonstration que le seed sait
   injoignable, et c'est le **seed** ou le niveau de journalisation qui doit changer.

**Comportement laissé inchangé**, conformément à la doctrine du §1 : ni le scénario ni le service
n'ont été modifiés. Le contourner en assouplissant l'assertion serait précisément le « contournement
destiné uniquement à rendre une preuve verte » que `docs/CloudWorker.md` §3.1 interdit.

### INC-160 — `verify-champs-formulaire.sh` laisse en base un `move_card` d'AVANT les migrations qui lui ont fait écrire son commentaire

**Nature :** exactement le mécanisme d'INC-129, sur un autre harnais. Pour se restaurer après ses
trois dégradations, `scripts/verify-champs-formulaire.sh` **rejoue**
`supabase/migrations/0009_champs_formulaire.sql` (quatre fois, lignes 169 à 438). Or des migrations
POSTÉRIEURES ont révisé `public.move_card` — la cinquième vérification y **conserve** désormais le
motif dans `card_comments` (INC-048, close) et `app.btrim_blancs` y retire les blancs **Unicode**
(INC-052, close). Le rejeu réinstalle la version d'avant : chaque exécution du harnais laisse en
base un `move_card` amputé de ces deux acquis.

**Mesuré le 2026-08-18**, et la chaîne est directe :

1. `npm run test:sql` **vert** avec la sous-tranche 4d appliquée : « 45 fichiers, 2269 assertions,
   aucune anomalie » ;
2. `scripts/verify-champs-formulaire.sh` exécuté ;
3. `npm run test:sql` rejoué **sans rien changer au dépôt** : **3 fichiers rouges, 10 assertions** —
   `0013_move_card` (8), `0014_valeurs_champs` (1), `0017_commentaires` (1), **toutes** portant sur
   le commentaire écrit par `move_card` et sur les blancs Unicode ;
4. état constaté directement : `pg_get_functiondef(public.move_card)` ne cite **plus**
   `card_comments` ni `btrim_blancs`.

Le harnais s'en aperçoit lui-même : ses deux dernières étapes, `npm run test:sql` et
`npm run e2e:api`, rendent ÉCHEC **alors que les deux passent isolément** — il se condamne avec sa
propre restauration.

**Étranger à l'unité, et prouvé sans `git stash`.** La sous-tranche 4d ne touche aucune migration,
aucune fonction SQL, et rien de `move_card` ; et la preuve n° 1 ci-dessus établit que le dépôt
modifié rendait `test:sql` **vert** avant l'exécution du harnais. La ligne de base du §2.4 de
`docs/CloudWorker.md` aurait dit la même chose au prix d'un `resetMe.sh` de plus.

**Comportement laissé INCHANGÉ.** La correction appartient au harnais — restaurer depuis l'état
courant plutôt qu'en rejouant une migration figée, comme INC-129 le pose déjà —, et elle dépasse
l'unité autorisée. Conséquence d'exploitation à connaître : **toute campagne qui suit une exécution
de ce harnais doit repartir d'une base rafraîchie** (`./resetMe.sh`), sans quoi elle mesure la
dégradation du harnais et non le produit.

### INC-159 — « Six types distincts » annoncé pour sept champs qui en couvraient sept — écart de commentaire, CORRIGÉ

**Nature :** `supabase/seed/apply-seed.sh` et `docs/SPEC-seed.md` §2.10 écrivaient tous deux « Six
types distincts sont couverts » à propos des sept champs seedés du workflow global. MESURÉ, ces sept
champs couvrent **sept** types : `money`, `select`, `date`, `textarea`, `checkbox`, `url`, `number`
— aucun n'est répété.

**Portée réelle : le commentaire, et lui seul.** Aucune assertion ne portait le six :
`scripts/verify-champs-formulaire.sh` comparait `types distincts` à **7** et rendait vert. Le défaut
était donc de la documentation vers le lecteur, non du produit vers la base.

**Antériorité.** Les deux phrases précèdent la sous-tranche 4d ; elles ne sont réécrites par elle
que parce qu'elle déplace le nombre lui-même (sept champs → neuf, sept types → neuf).

**Comportement retenu, et non arbitrage demandé** (doctrine du §1) : reconduire un nombre connu faux
dans une phrase qu'on réécrit n'est pas défendable. Les deux paragraphes portent désormais le compte
exact, et cette entrée existe pour que la correction soit **traçable** et ne se confonde pas avec la
livraison de 4d.

### INC-158 — Trois classes citées par des composants ne sont PAS engendrées, et n'ont donc aucun effet

**Nature :** exactement le défaut que `docs/DESIGN_SYSTEM.md` §11 décrit comme le plus dangereux du
projet — « une classe dont le jeton n'est pas déclaré n'est **pas engendrée du tout**, et en
silence ». Les espaces de noms de Tailwind étant remis à zéro, trois classes citées ne correspondent
à aucun jeton, et la règle CSS n'existe pas : le style annoncé par le composant n'est **jamais
appliqué**, sans qu'aucune erreur ne le signale. C'est le mécanisme par lequel `min-w-0` avait déjà
disparu avec sa garde de débordement, et c'est précisément ce que le contrôle du harnais existe pour
attraper.

**Mesuré le :** 2026-08-18, par `scripts/verify-webapp.sh`, contrôle 4 « Classes utilitaires
engendrées » : **236 classes citées, 3 absentes du CSS produit** — `h-10`, `py-0.5` et `text-text-1`.
Leurs trois porteurs, relevés à la source :

- `webapp/src/components/ui/Sommeil.tsx:99` — `py-0.5` sur la pastille « En sommeil » ;
- `webapp/src/app/EnTeteCard.tsx:936` — `h-10` sur un champ de l'en-tête d'affaire ;
- `webapp/src/app/AdministrationWorkflows.tsx:2298` — `text-text-1` dans l'éditeur de workflows.

Les trois sont plausibles à l'œil sans être appliquées : `h-10` doublait `--size-target`
(40 px = 10 × 4 px) mais l'échelle close ne déclare pas `10` ; `py-0.5` demande un demi-pas, que
l'échelle du §3 — fermée sur 0, 1, 2, 3, 4, 6, 8, 12 — ne connaît pas ; `text-text-1` nomme un jeton
de texte qui n'existe pas, la palette déclarant `--color-ink`, `--color-text-2` et `--color-text-3`.

**Antérieur, et prouvé tel plutôt que supposé.** `git blame` place les trois lignes au commit
`3c58a77`, bien avant cette session ; et `git diff` de la session montre qu'aucun des trois fichiers
n'est touché par `CRM-060` tranche 4a, qui n'ajoute que `Carnet.tsx` et son module de lecture. Le
contrôle était donc **déjà rouge** — la ligne de base n'a pas eu besoin d'être rejouée, la preuve
d'antériorité étant directe.

**Étranger à l'unité, et laissé inchangé** (`CLAUDE.md` §1, §3.1). La correction n'est pas
mécanique et appartient au porteur de chaque composant : elle demande de choisir, pour chacun, entre
la valeur de l'échelle la plus proche et l'ajout d'un jeton au thème — ce dernier étant une décision
de design system, pas une retouche de composant. Trois pistes, dans l'ordre de vraisemblance :
`h-10` → `h-[var(--size-target)]`, la forme déjà employée partout ailleurs ; `py-0.5` → `py-1`, seul
pas existant sous `py-2` ; `text-text-1` → `text-ink`, le jeton d'encre du §1.

### INC-157 — La barre d'onglets écrit « Aucun channel » sur les routes transverses, qui n'en ont pas

**Nature :** un état vide rendu là où il n'y a rien à vider. La barre d'onglets de la coquille
(`docs/DESIGN_SYSTEM.md` §4 : « les channels du track courant ») est rendue sur **toutes** les
routes, y compris celles qui n'appartiennent à aucun track — `/inbox`, `/ma-journee`, `/reglages`
et désormais `/contacts`. Hors d'un track, elle affiche « Aucun channel ». Or ces routes n'ont pas
« aucun channel » : la notion de channel n'y a **aucun objet**. C'est la distinction que le §5.16
et le §5.9 posent ailleurs — un vide qui est un **fait** n'est pas un vide qui est une **absence
de sujet** —, et l'écran écrit ici le premier là où c'est le second.

**Mesuré le :** 2026-08-18, en OBSERVANT les captures (`CLAUDE.md` §16), non en lisant un test.
`docs/captures/CRM-060/carnet-contacts-1440.jpg` porte la mention sous l'en-tête ; la capture
antérieure `docs/captures/CRM-057/inbox-lg-1152.jpg`, produite par la session `CRM-057`, la porte
**déjà**, à l'identique. Le défaut est donc **antérieur** à cette session et étranger à son unité :
`/contacts` en hérite comme les trois autres routes transverses, il ne l'introduit pas.

**CINQUIÈME PORTEUSE, le 2026-08-18** : la fiche d'organisation
(`/contacts/organisations/:idOrganisation`), livrée par la tranche 4b, en hérite exactement comme
les quatre autres — `docs/captures/CRM-060/fiche-organisation-1440.jpg` porte la mention. Le
constat ne change ni la nature du défaut ni son arbitrage ; il élargit son emprise, et confirme
que la correction appartient bien à la coquille et non à chaque écran.

**Étranger à l'unité, et laissé inchangé** (`CLAUDE.md` §1, §3.1). Il ne corrompt rien et
n'empêche aucun geste : il ajoute une ligne sans objet en tête de cinq écrans. La correction
appartient à la coquille (`CRM-007`) et demande une décision qui n'est pas d'écran : la barre
doit-elle être **absente** hors d'un track — ce que le §4 laisse entendre en la disant « du track
courant » —, ou son état vide doit-il être reformulé ? Le premier semble juste, mais toucher la
coquille depuis une unité de carnet ferait exactement le contraire de ce que le §1 demande.

### INC-156 — `verify-harness.sh` appelait une fonction inexistante et mourait au milieu — CORRIGÉ le 2026-08-18

**Nature :** un harnais s'interrompait silencieusement au tiers de son parcours en rendant quand
même un verdict. Sa section « 2 bis. Dénombrement des scénarios » s'ouvrait par `titre "…"`. **La
fonction `titre` n'est définie nulle part dans ce fichier** — les autres en-têtes emploient `echo`.
Sous `set -e`, l'appel rendait « titre: command not found » et **tuait le script à cette ligne**.

**Conséquence, et elle est large :** tout ce qui suit cette ligne n'a **jamais** été exécuté depuis
qu'elle existe — le dénombrement `--list` des trois projets, les compteurs `SCENARIOS_UI` et
`SCENARIOS_MAIL`, et toutes les sections suivantes. Le harnais dont le rôle est de dénoncer les
compteurs figés était lui-même arrêté avant de les lire. C'est la leçon d'INC-101 portée à sa
limite : un contrôle qui ne s'exécute pas ne ment pas, il se tait.

**Mesuré le :** 2026-08-18, des deux côtés d'un `git stash -u`. Sur `origin/main` sans aucun de mes
changements, le harnais rend « line 653: titre: command not found » après sa section 2 ; avec mes
changements, la même mort à la ligne 670. Défaut **antérieur**.

**Corrigé, parce que sans lui la révision des compteurs de cette session serait invérifiable.**
L'appel devient `echo`, comme les autres en-têtes du fichier, et le motif est écrit au-dessus de la
ligne. Le fichier était déjà modifié par cette session — `FICHIERS_SQL_ATTENDUS`,
`ASSERTIONS_ATTENDUES` et `SCENARIOS_API` révisés —, et c'est précisément le contrôle mort qui
devait valider cette révision. Même geste que pour INC-154.

**Un fait annexe, révélé par la même mesure et NON corrigé :** les compteurs de ce harnais étaient
restés à ceux de `CRM-060` **tranche 1** (43 fichiers / 2229 assertions / 696 scénarios) alors que
la tranche 2 en avait livré davantage. L'omission est nommée dans le fichier plutôt que lissée dans
un total qui semblerait n'avoir jamais dérivé.

**CE QUE LA CORRECTION A FAIT APPARAÎTRE, et qui reste à traiter par le porteur du harnais.** Le
harnais va désormais jusqu'au bout, et rend **31 contrôles, 3 anomalies** — des sections qui
n'avaient jamais tourné. L'une est explicitée par la sortie : « `npm run e2e:api` reste rouge après
restauration », conséquence mécanique d'**INC-136** (le dépôt Storage rend `InvalidAccessKeyId` sur
ce poste), tout contrôle exigeant une suite d'API **intégralement** verte échouant tant qu'INC-136
est ouverte. Les deux autres appartiennent aux sections de dénombrement et de balayage, et leur
diagnostic dépasse cette session : elles sont **laissées inchangées** et nommées ici. Ce n'est pas
une régression — c'est la mesure d'un harnais qui, jusqu'au 2026-08-18, s'arrêtait avant de les
rendre.

### INC-155 — INC-141 a un SECOND porteur : `verify-move-card.sh` fige lui aussi « quinze cards seedées »

**Nature :** compteur périmé dans un harnais — **exactement le défaut d'INC-141**, consignée le
2026-08-17 sur `verify-colonnes-protegees.sh`, mais dans un second fichier que cette entrée nomme
pour qu'une correction d'INC-141 ne laisse pas l'autre derrière elle. La ligne « les quinze cards du
seed sont là, aux étapes déclarées » compare `count(*) from public.cards where id::text like
'5eed%'` à `15`. Or le préfixe `5eed` couvre AUSSI les vingt-six cards de volume `…d001` à `…d026`,
posées par le seed lui-même (`supabase/seed/apply-seed.sh`, tableau `CARDS_VOLUME`,
`docs/SPEC-seed.md`). Le compte réel est donc **41**, et le contrôle est rouge sur une base
correctement seedée.

Cette entrée n'est donc PAS un défaut neuf : c'est l'inventaire complet d'un défaut déjà ouvert.
Elle se ferme avec INC-141, du même geste et par le même porteur.

**Mesuré le :** 2026-08-18, sur la pile seedée par `supabase/seed/apply-seed.sh`. `select count(*)
from public.cards where id::text like '5eed%'` rend `41` ; les vingt-six intruses portent toutes un
identifiant `5eed0000-0000-4000-8000-00000000d0xx` et sont bien du seed, non des résidus. Ligne de
base établie par `git stash -u` : le contrôle est rouge **des deux côtés**, donc antérieur.

**Étranger à l'unité, et laissé inchangé.** Le défaut appartient à l'unité qui a introduit
`CARDS_VOLUME` sans réviser ces compteurs, non à `CRM-060`. À la différence d'INC-154, il ne corrompt
rien : il rend un verdict faux, il ne dégrade pas la base — c'est pourquoi il est consigné et non
corrigé au passage (`CLAUDE.md` §1, §3.1), là où INC-154 l'a été. La correction consiste à comparer
au préfixe des seules cards de parcours ou à porter le compte à 41 en nommant les deux familles —
choix qui appartient au porteur d'INC-141.

### INC-154 — Trois harnais restauraient `move_card` depuis la migration 0019, effaçant le lot G — CORRIGÉ le 2026-08-18

**Nature :** des harnais laissaient le produit DÉGRADÉ en sortant — **cinquième occurrence** de la
classe des décisions 108, 135, 143, 145 et d'INC-153. `scripts/verify-valeurs-champs.sh`,
`scripts/verify-move-card.sh` et `scripts/verify-colonnes-protegees.sh` rejouent la migration `0013`
pour poser leurs dégradations, puis restaurent en rejouant la chaîne `12 → 13 → 14 → 19`, dont un
commentaire nomme la `0019` « dernière autorité sur `move_card` ». Elle ne l'est plus depuis le
**lot G** (décision 374, migration `0035_commentaires_lot_g.sql`), qui redéfinit `move_card` avec
`app.btrim_blancs` — les blancs Unicode d'INC-052 — et la conservation du commentaire de transition
d'INC-048. Chaque exécution de ces harnais réinstallait donc la version d'AVANT le lot G.

**Mesuré le :** 2026-08-18. Après une exécution de `verify-valeurs-champs.sh`,
`pg_get_functiondef('public.move_card(uuid,uuid,text)')` ne contenait plus `btrim_blancs` ;
`supabase/tests/0014_valeurs_champs.test.sql` rendait alors **`not ok 99`** (INC-048, le commentaire
conservé) et **`not ok 100`** (INC-052, une valeur réduite à une tabulation est vide) à l'exécution
SUIVANTE — un harnais qui s'empoisonne lui-même. Ligne de base établie par `git stash -u` :
`verify-valeurs-champs.sh` rend **34 contrôles, 1 en échec** sur `origin/main` sans aucun de mes
changements, et laisse `move_card` amputée. Le défaut est donc **antérieur**.

**Étranger à l'unité, mais dans les fichiers mêmes de cette session.** Il date des unités qui ont
livré le lot G sans réviser ces trois chaînes de restauration, donc étranger à `CRM-060` tranche 3.
Mais les trois fichiers étaient déjà modifiés par cette session — la migration `0047` redéfinissant
la même fonction que la `0013`, il fallait de toute façon l'ajouter à leurs chaînes —, et c'est
l'exécution de l'un d'eux qui a fait rougir la campagne. Même geste que la décision 447 pour
INC-153. **Corrigé** : `MIGRATION_LOT_G` est ajoutée derrière `MIGRATION_FINALE` dans les trois
chaînes, et `MIGRATION_RESOLUTION` derrière la `0013` partout où elle est rejouée seule. Après
correction, `verify-valeurs-champs.sh` rend **41 contrôles, aucune anomalie**, deux fois de suite,
et laisse en base un `move_card` porteur de `btrim_blancs` comme un validateur porteur de la
résolution.

### INC-153 — `verify-mail-classement.sh` restaurait `classify_message` depuis la migration 0025, effaçant la garde §18.2 — CORRIGÉ le 2026-08-18

**Nature :** un harnais laissait le produit DÉGRADÉ en sortant — même classe que la décision 135 et
qu'INC-129. Sa dégradation « l'événement de timeline retiré du classement manuel » remplaçait
`public.classify_message` par un corps de sonde, puis le **restaurait en l'extrayant de
`supabase/migrations/0025_classement_messages.sql`**. Or `CRM-057` (migration `0028`, §18.2) a
**révisé** `classify_message` pour exiger un **second** droit — voir le message
(`app.peut_voir_message`) avant de le classer. La restauration depuis 0025 réinstallait donc la
version d'AVANT cette garde : chaque exécution du harnais laissait en base un `classify_message`
amputé de son contrôle de visibilité.

**Mesuré le :** 2026-08-18. Après une exécution du harnais, `pg_get_functiondef` de
`public.classify_message` ne contenait plus `peut_voir_message` ; `npm run test:sql` rendait alors
`0029_inbox_globale.test.sql` **rouge sur ses assertions 12 à 14** — « classer un message qu'on n'a
pas le droit de VOIR est refusé » recevait « caught: no exception ». Reproduit hors interface : un
`business_developer` qui ne voit pas un message non classé mais peut écrire une card **le classait
chez lui**, puis le lisait — le contrôle d'accès contourné par l'écriture, le défaut exact que
§18.2 fermait.

**Étranger à l'unité, mais dans le fichier même de cette session.** Le défaut est antérieur (il date
de la révision `CRM-057` qui n'a pas mis à jour la restauration du harnais), donc étranger à
`CRM-060` tranche 2. Mais il vit dans `verify-mail-classement.sh`, que cette session modifiait déjà
pour activer la règle 3, et c'est l'exécution de ce harnais qui a dégradé la base et fait rougir la
campagne. Le laisser aurait maintenu une mine qui corrompt la base partagée à chaque passage
(décision 135). **Corrigé** dans le même changement : la restauration extrait désormais
`classify_message` de `supabase/migrations/0028_inbox_visibilite.sql`, source autoritaire courante.
Après correction, le harnais rejoué laisse `classify_message` porteur de sa garde, et
`0029_inbox_globale.test.sql` repasse **22/22**.

### INC-152 — Un scénario au clavier de `commentaires-gestes.spec.ts` rend un verdict intermittent

**Nature :** flake préexistant sur une assertion de focus ; le scénario échoue **1 fois sur 3** en
rejeu isolé depuis un seed frais, et il échoue avec la même signature — `expect(locator).toBeFocused() failed` —
que ce soit sur mon changement ou sur la HEAD amont.
**Relevé le :** 2026-08-18, à la fin d'une campagne `npm run e2e:ui` qui a rendu **369 verts, 1
échec** sur ce seul scénario : « les deux actions sont atteignables AU CLAVIER, sans jamais
survoler » (`e2e/ui/commentaires-gestes.spec.ts:224`).

**Ce qui est mesuré, et comment.** Trois rejeus successifs, `--repeat-each=3`, sur la spec entière,
seed **frais** appliqué à chaque cycle :
- sur mon changement (deux corrections de harnais shell qui ne touchent AUCUN code d'interface) :
  **2 verts, 1 échec** ;
- sur `HEAD` amont, obtenu par `git stash -u`, seed réappliqué, dépendances inchangées :
  **2 verts, 1 échec** — même erreur, même position dans l'exécution.

Une anomalie présente des deux côtés de la ligne de base est préexistante (§2.4 de
`docs/CloudWorker.md`). Elle ne vient pas de cette session, et n'y appartient pas.

**Observation ajoutée le 2026-08-18 par la session `CRM-060` tranche 4a — l'intermittence est PLUS
LARGE que ce scénario, et plus large que l'assertion de focus.** Trois campagnes `npm run e2e:ui`
complètes ont été exécutées dans la même session, sur le même code, seed frais à chaque fois. Les
trois rendent **378 verts et 1 échec**, mais **l'échec change de scénario à chaque campagne** :

1. `coquille.spec.ts:177` — **échec RÉEL, imputable au changement** (la liste des entrées de
   navigation était figée à quatre) : révisé, puis vert ;
2. `commentaires-gestes.spec.ts:224` — ce scénario, mais **pas** sur l'assertion de focus décrite
   ci-dessus : sur la relecture en base de la ligne (`:280`), l'écran montrant déjà le texte modifié
   (`:279` verte) alors que la relecture rend l'ancien corps. Rejoué **seul** : **8/8 verts** ;
3. `formulaire.spec.ts:242` — « l'appelant anonyme n'obtient aucune card », pendant l'exécution de
   `scripts/verify-harness.sh`.

Trois scénarios distincts, trois fichiers distincts, un seul échec par campagne, et chacun vert au
rejeu isolé : le motif n'est donc pas propre à `commentaires-gestes.spec.ts`. Il ressemble à une
intermittence de la **suite sous charge** — un seul worker, dix minutes d'exécution, base partagée —
plutôt qu'à trois défauts indépendants. Cette observation est ajoutée ici parce qu'elle **élargit**
l'entrée sans la trancher : la piste de stabilisation reste celle écrite plus bas, mais elle devra
être cherchée au niveau de la suite, pas seulement du scénario.

**Pourquoi cette entrée existe.** Le scénario mesure une propriété d'accessibilité clavier, et il
la mesure correctement quand il aboutit — sa DoD est bien tenue par le produit. Ce n'est ni un
défaut à corriger sur mon périmètre, ni une régression : c'est une preuve **intermittente** à
stabiliser. La consigner ici la rend suivable ; la corriger reste dû à la prochaine session qui
touchera `commentaires-gestes.spec.ts` ou son support, avec pour piste de départ l'attente d'un
état de focus effectif (`toHaveClass` du wrapper, `getByRole().and(locator.locator(':focus'))`,
ou attente d'un événement DOM) plutôt que `toBeFocused()` seul.

**Portée honnête.** L'intermittence n'a jamais été observée sur d'autres scénarios de cette suite ;
les deux autres files du même dossier passent en 24/24 sur ce même rejeu isolé (§ décision 443).

### INC-151 — Le projet `mail` était INLISTABLE sans Docker — CORRIGÉ le 2026-08-18

**Nature :** effet de bord au chargement du module ; la collecte des tests exige l'infrastructure.
**Relevé le :** 2026-08-18, en cherchant à COMPTER les scénarios sans les exécuter.

**Ce qui est mesuré.** `playwright test --list` énumère les scénarios sans en exécuter un seul. Il
rend **678** pour `api` et **368** pour `ui` — mais **`0 test dans 0 fichier`** pour `mail`, alors
que `e2e/mail/` porte **onze** fichiers et que `scripts/verify-harness.sh` en attend **42**
scénarios. La cause est nommée par Playwright lui-même :

```
Error: Command failed: docker inspect p2enjoy-mail-sync --format {{...}}
   at mail/backfill.spec.ts:42
```

`backfill.spec.ts` calcule `const RESEAU = docker('inspect', …)` **au premier niveau du module**.
Docker absent, l'import lève, et Playwright abandonne **tout le projet**. Le défaut est
**systémique** : **neuf des onze** specs de `mail` portent un appel `docker` ou `execFileSync` au
chargement.

**Ce qui n'est PAS en cause.** Aucune assertion n'est fausse, et la suite `mail` exige de toute
façon l'infrastructure pour s'exécuter — ce n'est pas la famille d'INC-146 et INC-147. Ce qui est
perdu est plus étroit : **on ne peut ni compter ni inventorier ces scénarios sans la pile**, là où
les deux autres projets s'y prêtent. Un compteur de harnais devient invérifiable dès que
l'infrastructure manque, au moment précis où l'on aimerait le vérifier autrement.

**CORRIGÉ, et l'arbitrage a d'abord été l'inverse — il faut le dire.** J'avais renoncé au motif que
refondre neuf suites sans pouvoir les rejouer introduirait plus de risque que de gain. Ce
raisonnement omettait un fait : **la propriété visée est vérifiable immédiatement**. Si le projet se
liste sans Docker, les imports sont propres — c'est la preuve même de la correction, et elle ne
demande aucune infrastructure.

Le remède est mécanique et **préserve le comportement par construction** : la constante devient une
fonction **mémoïsée**, avec la MÊME commande et la MÊME valeur. Seul le moment du calcul change — au
premier usage plutôt qu'à l'import —, ce qui est précisément l'intention.

**Preuve, mesurée après correction, Docker toujours absent :**

| Projet | Avant | Après |
|---|---|---|
| `mail` | `0 test dans 0 fichier` | **42 tests dans 11 fichiers** |
| `api` | 678 | 678 — inchangé |
| `ui` | 368 | 368 — inchangé |
| **tous projets** | `0 test dans 0 fichier` | **1088 tests dans 82 fichiers** |

678 + 368 + 42 = 1088 : le compte est exact, et le listage **global** fonctionne lui aussi, alors
qu'il échouait avant pour la même cause. `npm run typecheck` est vert.

**Ce qui reste non vérifié, et qui est nommé.** L'EXÉCUTION des suites `mail` exige l'infrastructure
et n'a pas eu lieu. La correction ne change ni la commande passée à `docker`, ni sa valeur, ni
l'ordre des gestes d'un test ; le risque résiduel est celui d'un `docker inspect` déplacé de
l'import au premier appel. La première exécution après le retour du poste doit le confirmer.

**Bénéfice immédiat de cette découverte, tout de même.** Le compteur `SCENARIOS_UI`, posé par
déduction le matin faute de pile (décision 435), a pu être **confirmé par mesure directe** :
`--list` rend bien **368**. `SCENARIOS_API` l'est aussi, à **678**. Un compteur dérivé est redevenu
un compteur observé, sans que Docker revienne.

**Et le compteur de `mail` lui-même a pu être corroboré, malgré l'inlistabilité.** Le dénombrement
des déclarations `test(` dans les onze fichiers rend **40**. L'écart avec les **42** attendus
s'explique **exactement** : `infrastructure.spec.ts` déclare un test **dans une boucle** sur trois
boîtes — la boîte système et les deux boîtes personnelles —, si bien qu'une déclaration produit
trois scénarios. **39 + 3 = 42.** Le compteur du harnais est donc juste, et les **trois** projets
sont désormais vérifiés sans Docker.

### INC-150 — Un harnais sur cinquante et un a reçu une façade `npm`, contre la règle du README

**Nature :** doublure d'interface contredisant une règle écrite ; arbitrage dû au responsable.
**Relevé le :** 2026-08-18, par audit statique du `package.json` contre `README.md`.

**La règle, écrite au README §5.** « **Les scripts sont la façade canonique, et `npm` ne les double
jamais** » (INC-008, close le 2026-08-13). Le motif y est donné : « Deux façades pour un même geste
font diverger la documentation de l'une des deux. » Le `package.json` doit donc porter « les
commandes qui appartiennent réellement à la chaîne Node — types, build, tests — **et rien d'autre** ».

**Ce qui est mesuré.** Quatre des treize scripts `npm` appellent un script shell :

- `test:sql`, `types:check` et `types:generate` sont **conformes** : ce sont des commandes de la
  chaîne Node — tests et types — dont l'implémentation se trouve être un shell. La règle vise les
  gestes de cycle de vie de la pile, pas le langage d'implémentation.
- **`verify:identites` → `./scripts/verify-identites.sh` ne l'est pas.** Ce n'est ni un type, ni un
  build, ni un test de la chaîne Node : c'est un **harnais de vérification**, la famille même que le
  README réserve aux scripts. Et c'est **le seul des cinquante et un harnais** à recevoir un alias
  `npm`.

**Deux faits qui aggravent la singularité.** Cet alias n'est **appelé par personne** — ni par un
autre script, ni par la documentation, ni par un harnais : la recherche dans tout le dépôt ne rend
que sa propre définition. Et il n'est **documenté nulle part** — ni au `README.md`, ni dans `docs/`.
C'est exactement la divergence que la règle d'INC-008 voulait prévenir : une seconde façade que
personne n'entretient.

**Ce que je NE fais PAS.** Le retirer. Un script du `package.json` est une **interface publique du
dépôt** : il peut être appelé par une habitude du responsable, un raccourci d'éditeur ou une chaîne
d'intégration hors dépôt, qu'aucune recherche locale ne verrait. Le supprimer sur la foi d'un `grep`
serait une décision d'interface prise sans mandat.

**Arbitrage demandé, deux issues.** Ou bien l'alias est retiré, et les cinquante et un harnais
gardent une façade unique. Ou bien il est **assumé et documenté** au `README.md`, et la règle y est
nuancée pour dire quelles vérifications méritent un raccourci `npm`. La situation actuelle — une
exception non écrite à une règle écrite — est la seule qui ne se défende pas.

### INC-149 — Trente et un tokens existaient sans figurer au design system — CORRIGÉ le 2026-08-18

**Nature :** dérive documentaire ; le design system décrivait des valeurs sans jamais les nommer.
**Relevé le :** 2026-08-18, par audit statique — aucune exécution requise, donc valable malgré la
panne du poste (INC-145).

**Ce qui est mesuré.** `webapp/src/styles/tokens.css` définit **60** tokens.
`docs/DESIGN_SYSTEM.md` n'en citait que **29**. Trente et un existaient donc dans le produit sans
figurer au document que `CLAUDE.md` §4 rend obligatoire — lequel exige nommément que « les tokens »
y soient décrits.

**La dérive était subtile, et c'est pour cela qu'elle a duré.** Le document décrivait bien les
*valeurs* — « H1 26 px », « échelle 4, 8, 12, 16, 24, 32, 48 px », « ombre `0 1px 3px` » — mais en
**prose**, sans jamais donner le nom du token. Un développeur cherchant `--text-h2`, `--spacing-3`
ou `--size-sidebar` ne trouvait **rien**, et devait relire le CSS. Le document n'était donc pas faux ;
il était inutilisable pour ce à quoi il sert.

**Corrigé, sans toucher à une seule décision de conception.** Quatre tableaux ajoutés : typographie
(9 tokens), espacement (8), ombre et durée (4), dimension (6), plus les trois seuils responsive et
trois couleurs restées anonymes. **Aucune valeur n'a été changée** : le document a été aligné sur le
CSS, jamais l'inverse.

**Vérification.** Recompté après correction : **58** tokens sur 60 sont désormais nommés
littéralement. Les deux derniers — `--color-brand-on-soft` et `--color-success-on-soft` — sont
couverts par la **règle de famille** `--color-*-on-soft`, écrite explicitement au §1 : c'est la
recherche littérale qui ne la voit pas, non le document qui manque.

**Ce que la dérive apprend.** Une documentation peut être exacte et pourtant manquer à son office.
Le contrôle utile n'est pas « le document dit-il vrai ? » mais « répond-il à la question qu'on lui
pose ? ». Ici la question est « que vaut `--spacing-3` ? », et elle restait sans réponse.

### INC-148 — Quatorze unités n'ont aucun test unitaire dédié, là où `CLAUDE.md` §15 en exige un

**Nature :** exigence générale non tenue, arbitrage dû au responsable.
**Relevé le :** 2026-08-18, par audit statique — le poste Docker étant tombé, la mesure ne repose
sur aucune exécution et reste donc valable quel qu'en soit l'état.

**La règle.** `CLAUDE.md` §15 : « Toute unité de backlog doit disposer au minimum d'un test unitaire
spécifique **et** d'un test E2E spécifique. » Le §27 ajoute qu'une règle locale « ne doit jamais
réduire les exigences de vérification » du fichier général. Une Definition of Done d'unité qui
n'exige pas de test unitaire ne peut donc pas, à elle seule, dispenser de cette obligation.

**La mesure.** Les `@verifies` des trois familles de tests unitaires du dépôt — Vitest
(`webapp/src/**/*.test.ts[x]`), pgTAP (`supabase/tests/*.test.sql`) et pytest
(`mail-sync/tests/*.py`) — citent **43** unités. Le backlog en déclare **57**. **Quatorze** ne sont
donc citées par aucun test unitaire :

`CRM-000`, `CRM-001`, `CRM-002`, `CRM-004`, `CRM-006`, `CRM-008`, `CRM-011`, `CRM-015`, `CRM-016`,
`CRM-046`, `CRM-047`, `CRM-050`, `CRM-070`, `CRM-080`.

**Classées par ce qu'elles livrent réellement, mesuré par leurs `@spec` :**

- **Quatre ne livrent AUCUN fichier de code** — `CRM-011`, `CRM-046`, `CRM-047`, et par construction
  `CRM-000`, `CRM-070`, `CRM-080`. Pour celles-là, l'exigence n'a pas d'objet évident : `CRM-011`
  configure GoTrue et l'invitation, `CRM-046` livre un seed, `CRM-047` un manuel. *À noter :
  la logique d'authentification, elle, EST couverte — `webapp/src/lib/auth.test.ts` — mais sous la
  citation `CRM-009`.*
- **Huit livrent du code et n'ont pas de test unitaire propre** : `CRM-001` (6 fichiers),
  `CRM-002` (4), `CRM-006` (3), `CRM-008` (5), `CRM-015` (3), `CRM-016` (5), `CRM-050` (4), et
  `CRM-004`. Leurs preuves existent — harnais `verify-stack.sh`, `verify-scripts.sh`, suites d'API —
  mais ce sont des preuves d'intégration, pas des tests unitaires.

**CORRECTION DU MÊME JOUR — J'AI SURESTIMÉ L'ÉCART, ET IL FAUT LE DIRE AVANT LA SUITE.** La mesure
ci-dessus ne comptait que **trois** familles de tests. Elle ignorait la quatrième, et c'est la
principale du projet : les **51 harnais** `scripts/verify-*.sh`, dont les `@verifies` couvrent
**51 unités** — `scripts/verify-auth.sh` cite nommément `CRM-011` et porte **42** occurrences de
l'invitation, exactement la preuve que sa Definition of Done exige dans Inbucket.

**Mesure refaite, toutes familles confondues** — Vitest, pgTAP, pytest, harnais et suites E2E :
**trois** unités seulement ne sont couvertes par aucune preuve, et les trois ne livrent aucun code —
`CRM-000` (socle documentaire), `CRM-070` (note d'arbitrage), `CRM-080` (non commencée).

**Ce qui subsiste, et qui est plus étroit que ce que j'avais écrit.** Il n'y a **pas** de trou de
couverture. La question qui demeure porte sur la **NATURE** de la preuve, non sur son absence :
`CLAUDE.md` §15 demande un test *unitaire*, et huit unités porteuses de code — `CRM-001`, `CRM-002`,
`CRM-004`, `CRM-006`, `CRM-008`, `CRM-015`, `CRM-016`, `CRM-050` — sont prouvées par des harnais,
c'est-à-dire par de l'**intégration**. Leur contrat est vérifié ; il ne l'est pas à l'échelle
demandée par le §15.

*Le titre de cette entrée est conservé tel qu'il a été écrit, et non réécrit après coup : il dit ce
que j'avais mesuré, et cette correction dit ce que j'avais manqué. C'est la même discipline que
j'applique aux assertions du dépôt — réviser, jamais effacer.*

**Ce que je NE tranche PAS, et pourquoi.** Deux lectures se défendent. Ou bien §15 vaut pour toute
unité sans exception, et les huit unités `[x]` porteuses de code doivent être rouvertes pour
recevoir des tests unitaires en plus de leurs harnais. Ou bien l'exigence vise le code **testable
unitairement**, et une unité d'infrastructure — un script de lancement, une pile Compose, un
gabarit d'email — la satisfait par le harnais qui l'éprouve réellement. **Trancher moi-même reviendrait à réduire ou à durcir une exigence du
responsable**, ce que ni le §26 ni le §27 ne m'autorisent. **Arbitrage demandé.**

**Ce que je me refuse à faire en attendant.** Écrire des tests unitaires de complaisance pour faire
tomber le compteur à zéro. Un test qui affirmerait qu'un script existe, ou qu'un type généré se
compile, serait exactement l'assertion qui ne peut pas échouer décrite en INC-146 et INC-147. Le
défaut est nommé ; il n'est pas maquillé.

### INC-147 — La preuve de refus n° 9 mesure une absence, pas un refus

**Nature :** assertion trop large sur un objet jamais créé ; la preuve ne peut pas échouer.
**Relevé le :** 2026-08-18, par relecture, dans le prolongement d'INC-146 — et **le scénario est
vert**, comme l'était le précédent.

**Ce que le scénario prétend prouver.** `e2e/api/ingestion.spec.ts`, `REFUS N° 9` : « une pièce
`infected` et une pièce `pending` ne se téléchargent pas ». C'est la preuve n° 9 du §7 de
`docs/SPEC-permissions-rls.md`, retournée en refus mesuré quand `CRM-054` a livré
`mail_attachments` et son bucket.

**Ce qu'il fait réellement.** Il insère la LIGNE de métadonnées via PostgREST, puis demande
`GET /storage/v1/object/mail-attachments/<chemin>` avec deux jeux d'en-têtes, et asserte
`expect([400, 401, 403, 404]).toContain(statut)`. **Aucun octet n'est jamais déposé** : les deux
seuls appels à Storage du fichier sont ce `GET` et un `list`. Le commentaire du scénario le dit
lui-même — « le dépôt réel se fait par le service ; ici, seule la LECTURE est éprouvée ».

**Pourquoi il ne peut pas échouer.** Un objet qui n'a jamais été déposé rend **404**, valeur
acceptée par l'assertion. Le scénario serait vert avec ou sans politique de Storage, avec ou sans
`av_status`, et même si la pièce saine était librement téléchargeable — puisqu'il ne teste jamais
une pièce réellement présente. **Il ne distingue pas « refusé » de « inexistant ».**

**Ma part dans ce constat, et elle n'est pas mince.** Le matin du 2026-08-18, en corrigeant
`scripts/verify-preuves-refus.sh`, j'ai câblé ce scénario comme la preuve n° 9 « exercée et verte »,
au motif qu'elle avait migré de fichier. **J'ai vérifié qu'elle TOURNE, pas qu'elle PROUVE.** Le
libellé du contrôle est corrigé le jour même : il annonce désormais que le scénario existe et tourne,
et que sa valeur probante est en défaut.

**LE REFUS EST POURTANT BIEN PROUVÉ — AILLEURS, ET CORRECTEMENT.** La suite de `CRM-057`,
`e2e/api/inbox.spec.ts` §18.5, fait exactement ce qu'il faut : elle **DÉPOSE** les objets avec la
clé de service (`200`/`201` assertés), vérifie que la pièce **`clean` se télécharge en `200` et que
son contenu est le bon** — le témoin positif sans lequel un refus global passerait pour une
politique correcte —, puis mesure le refus des pièces `infected`, `pending` et `skipped`, pour
l'administratrice, pour un `viewer` et pour l'anonyme. Là, un `404` signifie bien « masqué par la
politique », puisque l'objet vient d'être déposé et qu'un autre est lisible au même endroit.

**CORRIGÉ le 2026-08-18, sur les deux points.**

1. **Le contrôle du harnais vise désormais la preuve SAINE**, `e2e/api/inbox.spec.ts`, et exige
   qu'y figure le **témoin positif** — la pièce `clean` servie en `200`. C'est ce témoin qui rend
   les refus concluants : sans lui, un refus global passerait pour une politique correcte.
2. **Le scénario creux cesse de s'annoncer comme le refus n° 9.** Il n'est pas supprimé — ce qu'il
   mesure garde une valeur propre : la ligne de métadonnées est bien créée, et le bucket ne sert pas
   un chemin qu'aucun dépôt n'a rempli. Il s'intitule désormais « un chemin de pièce jamais déposée
   n'est servi à personne », ce qui est exactement ce qu'il fait. Un contrôle d'ingestion, pas une
   preuve d'autorisation.

**UNE CORRECTION DE MA CORRECTION, le même jour.** Le contrôle exécutait d'abord le fichier
**entier** — neuf scénarios — et échouait si l'un d'eux tombait. Un échec sans rapport avec les
pièces jointes aurait donc été rendu « la preuve n° 9 n'est pas exercée » : exactement l'accusation
fausse que ce registre reproche au contrôle des ports en INC-145. La portée est resserrée par un
filtre `-g`, et le verdict ne peut plus parler que du scénario visé.

**CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS.** `bash -n` et `npm run typecheck` sont **verts**. Le
filtre a été éprouvé sans Docker : `--list` avec `-g 'se télécharge'` sélectionne **exactement un
test**, celui de la preuve — le libellé visé par le harnais est donc bien celui que Playwright
imprime, et cette moitié du doute est levée. **L'EXÉCUTION du scénario, elle, n'a pas eu lieu** : le
poste Docker est tombé, et la première exécution après son retour doit la confirmer.

**Troisième occurrence de la même famille.** INC-146 en décrit deux — une assertion d'absence qui
lit un `PGRST202` de signature non correspondante, et une seconde de même forme. Le motif commun est
constant : **l'assertion réussit pour une raison qui n'est pas celle qu'elle nomme**. Le remède est
constant lui aussi : écrire l'assertion de façon qu'elle ne puisse réussir QUE pour la raison
annoncée, et lui adjoindre un témoin positif quand un refus est en jeu.

### INC-146 — Une assertion qui fige une absence est restée VERTE après la naissance de son objet

**Nature :** fausse preuve ; le mécanisme de la décision 51 a échoué sans le dire.
**Relevé le :** 2026-08-18, par relecture — la pile ne tournait pas, et aucune exécution n'aurait
trouvé ce défaut, puisque le scénario est **vert**.

**Le mécanisme, et ce qu'il promet.** `e2e/api/preuves-refus.spec.ts` §7.3 fige les preuves de refus
dont le sujet n'existe pas encore : « chacune deviendra ROUGE le jour où la table ou la fonction
naîtra, et désignera alors la preuve à écrire ». Trois l'ont tenu — n° 6 à la livraison de
`mail_inbound_accounts` par `CRM-052`, n° 7 à celle de `mail_outbound_identities` par `CRM-053`,
n° 9 à celle de `mail_attachments` par `CRM-054`. Toutes trois ont été RETOURNÉES en refus mesurés.

**La douzième ne l'a pas tenu.** Le scénario s'intitule toujours « `queue_outbound_email` n'existe
pas, et c'est asséré ». Or `CRM-058` l'a livrée : `supabase/migrations/0030_envoi_sortant.sql` la
crée avec **sept paramètres**, dont trois sans valeur par défaut. Le scénario, lui, appelle
`POST /rest/v1/rpc/queue_outbound_email` avec `data: {}` et attend `404` / `PGRST202`.

**Pourquoi il reste vert alors que la fonction existe.** `PGRST202` de PostgREST ne signifie pas
« fonction absente » mais « aucune fonction de ce nom ne correspond à CES paramètres ». Un appel
sans argument ne peut correspondre à aucune surcharge d'une fonction qui en exige trois. **Le
scénario mesure une signature qui ne correspond pas, et l'interprète comme une absence.** Il serait
resté vert quoi qu'il arrive — avant comme après la naissance de la fonction.

**Ce que le défaut a produit.** Deux unités affirment encore, sur la foi de cette assertion, que la
preuve n° 12 est « hors d'atteinte » et que son objet « n'existe pas » : `CRM-014` et `CRM-053`.
C'est faux depuis `CRM-058`.

**Ce qui atténue, sans excuser.** Le refus réel EST prouvé ailleurs : `e2e/api/envoi.spec.ts` mesure
`forbidden` et `identity_not_available` avec les jetons réels. La règle est donc tenue par le
produit ; c'est le registre des douze preuves qui ment sur son propre état.

**CORRIGÉ le 2026-08-18, ET L'ARBITRAGE A CHANGÉ EN COURS DE ROUTE — il faut le dire.** J'avais
d'abord décidé de ne PAS réécrire l'assertion, au motif que remplacer une fausse preuve par une
preuve non exécutée ne vaudrait pas mieux. Le responsable a demandé de poursuivre sans la pile ;
l'arbitrage bascule alors, et pour une raison mesurable : **une assertion que l'on SAIT fausse et
que l'on laisse en place ment à chaque exécution**, tandis qu'une assertion correcte non encore
exécutée dit la vérité dès qu'on la lance. Le risque change de nature, il ne s'aggrave pas.

La douzième preuve est donc **retournée** — neuvième occurrence du mécanisme de la décision 51.
Elle mesure ce que le §7 lui demandait depuis le début : un membre qui emprunte l'identité sortante
de **service** du workspace est refusé en `403` / `identity_not_available`. **L'appel emploie la
signature RÉELLE**, ce qui est tout le point : avec les bons paramètres, un `PGRST202` ne pourrait
plus signifier qu'une chose — la fonction a disparu — et l'assertion rougirait.

Le second site est corrigé de même : `refus-par-defaut.spec.ts` appelle désormais `resolve_access`
avec ses trois arguments réels, si bien qu'un `PGRST202` ne peut plus vouloir dire qu'une chose,
PostgREST ne route pas vers `app`.

**UN DÉFAUT DE MA PROPRE CORRECTION, TROUVÉ PAR RELECTURE ET CORRIGÉ le même jour.** La première
version du scénario visait la card `…c4`. Or `queue_outbound_email` éprouve ses refus **dans un
ordre** : `not_authenticated`, puis **`forbidden` si l'appelant ne peut pas ÉCRIRE la card**, et
seulement ensuite `identity_not_available` (`0030_envoi_sortant.sql`, lignes 196 à 221). Rien ne
garantissait que `bizdev` puisse écrire `…c4` : le scénario aurait alors levé `forbidden` et
**prouvé un tout autre refus que celui qu'il annonce** — précisément le défaut que cette entrée
dénonce. La card est désormais `…c1`, celle qu'emploie `e2e/api/envoi.spec.ts` où `bizdev` obtient
bien `identity_not_available` : le chemin est éprouvé.

**CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS.** `npm run typecheck` est **vert** ; le fichier se
liste et conserve ses **40** scénarios, donc le compteur du harnais reste juste ; et les erreurs
attendues ont été **confrontées à la migration** plutôt que recopiées d'un souvenir — `42501`, que
PostgREST traduit en `403`, et le message `identity_not_available`. **Les scénarios n'ont PAS été
exécutés** — le poste Docker est tombé. `CRM-014` et `CRM-053` restent `[~]`, et la première
exécution après le retour de la pile doit les confirmer ou les corriger.

**SECONDE OCCURRENCE, trouvée par l'audit qu'impose ce constat.** Toutes les assertions d'absence du
dépôt ont été relues. Sur trois qui reposent sur un code PostgREST :

- `e2e/api/preuves-refus.spec.ts:510` est **saine** : elle fait un `GET` sur la table et lit
  `PGRST205`, « table absente du cache de schéma ». Un `GET` de table trouve la table ou ne la
  trouve pas ; rien ne s'interpose.
- `e2e/api/preuves-refus.spec.ts:604` est celle décrite ci-dessus.
- `e2e/api/refus-par-defaut.spec.ts:46` porte **la même faiblesse structurelle**. Elle affirme que
  le schéma `app` n'est pas exposé, en appelant `rpc/resolve_access` avec `data: {}`. Or
  `app.resolve_access(text, text, text)` exige **trois** paramètres : l'appel rendrait `PGRST202`
  même si la fonction était exposée. **Ce qu'elle affirme est vrai** — PostgREST n'expose pas `app`
  — **mais elle ne le mesure pas** : elle ne distingue pas « schéma non exposé » de « signature non
  correspondante ». *Reste dû* : l'appeler avec sa signature réelle, pour qu'une exposition
  accidentelle la fasse rougir.

**QUATRE SITES DE PLUS, DE MÊME FORME, ET LA MESURE DE LEUR GRAVITÉ.** Le motif
« `POST /rpc/<fonction>` avec `data: {}`, puis assertion sur un ensemble contenant `404` » se
retrouve à `e2e/api/envoi.spec.ts:158`, `e2e/api/comptes-entrants.spec.ts:168` et `:193`,
`e2e/api/identites-sortantes.spec.ts:144` et `e2e/api/classement.spec.ts:177`. Toutes ces fonctions
prennent des paramètres : l'appel à vide rend `PGRST202` pour **tout** appelant, autorisé ou non.
Ces assertions ne distinguent donc pas « fermée au client » de « signature non correspondante ».

**Elles ne sont pourtant PAS les preuves porteuses, et c'est vérifié.** La règle réelle est un
privilège, et il est prouvé dans le catalogue : `supabase/tests/` compte **50 assertions
`has_function_privilege`** réparties sur **22 fichiers**, dont
`not has_function_privilege('authenticated', 'public.reserver_envois(integer)', 'execute')` et son
équivalent pour `marquer_envoi_reussi`. `classer_message`, `upsert_mail_inbound_account` et
`upsert_mail_outbound_identity` sont couvertes de même. **Les règles sont donc tenues et prouvées ;
ce sont les doublures d'API qui sont creuses.** La distinction est faite ici pour qu'une lecture
rapide ne conclue pas à un trou d'autorisation là où il n'y en a pas.

*Reste dû, sans urgence de sécurité :* appeler ces RPC avec leur signature réelle, pour que
l'assertion puisse échouer pour la raison qu'elle nomme.

**L'AUDIT A ÉTÉ ÉTENDU AUX ASSERTIONS D'ABSENCE DE L'INTERFACE, ET IL N'Y A RIEN TROUVÉ.** Une
assertion `toHaveCount(0)` sur un `data-testid` qu'aucun composant n'émet serait verte par
construction — même famille. Les **50** assertions d'absence des suites d'interface ont donc été
confrontées aux `testid` réellement rendus par `webapp/src`. Quinze ne s'y retrouvaient pas ; toutes
s'expliquent : la plupart sont construites dynamiquement (`entete-${champ}`, `champ-${cle}`,
`carte-sommeil-${jour}`) ou passées par une prop (`marqueur`, `testId`) que le premier relevé ne
voyait pas.

Un seul cas restait : `formulaire-lecture-seule`, cité **uniquement** par deux assertions d'absence,
une unitaire et une E2E. **Il est légitime, et vérifié par l'historique** : `git log -S` montre que
ce `testid` existait bien dans `FormulaireCard.tsx` et que `CRM-037` l'a retiré en rendant le
formulaire saisissable (décision 334, INC-088). L'assertion est le **retournement** de l'ancien
contrôle, conservé plutôt que supprimé, et le scénario ne s'y limite pas : il compte ensuite les
`input`, `textarea` et `select` réellement rendus et vérifie qu'ils sont saisissables. La substance
est portée par les assertions POSITIVES qui suivent — ce qui est exactement le remède prescrit
ci-dessus.

**Un négatif mesuré au passage.** Les **132** assertions pgTAP `has_*`/`hasnt_*` interrogent le
catalogue directement et ne souffrent pas de ce défaut : leur succès dépend de la présence de
l'objet et de rien d'autre.

**Leçon de méthode.** Une assertion qui fige une absence doit être écrite de façon à ne pouvoir
réussir QUE si l'objet est absent. Ici, le choix d'appeler la fonction sans argument rendait le
succès insensible à ce qu'elle prétendait mesurer. Une preuve qui ne peut pas échouer n'est pas une
preuve.

### INC-145 — Un harnais rendait « aucune anomalie » en sautant quatre contrôles

**Nature :** vert obtenu par omission ; la sonde de disponibilité se trompait de sujet.
**Relevé le :** 2026-08-18, en rejouant `scripts/verify-scripts.sh` pour la preuve de démarrage à
froid due par `CRM-001`.

**Ce qui est mesuré.** `scripts/verify-scripts.sh` annonçait « 95 vérifications, aucune anomalie »
et, une ligne plus haut, « 4 vérification(s) non exécutée(s), faute de démon Docker ». Le démon
répondait pourtant : `docker compose` fonctionnait, la pile tournait, les suites pgTAP passaient. La
sonde était `docker info`, qui sortait en **1** parce que les greffons CLI de Docker Desktop
segfaultent sur ce poste — `docker-agent`, `docker-ai`, `docker-buildx`, `docker-debug`. Les points
d'entrée classiques (`info`, `ps`, `version`) rendent en outre un **500** sur la socket, quelle que
soit la version d'API forcée ; mesuré à l'intérieur comme à l'extérieur du bac à sable.

**Pourquoi c'est grave.** Le bilan disait « aucune anomalie » alors que neuf contrôles ne
s'exécutaient pas. Sonde corrigée, ces contrôles remontent à **104 vérifications** et font
apparaître **quatre échecs réels**. Un harnais qui saute ses contrôles les plus coûteux et conclut
au vert est pire qu'un harnais absent : il donne une preuve là où il n'y a qu'un silence.

**Corrigé.** La sonde interroge désormais ce que les contrôles emploient réellement
(`docker compose`) et non le démon en général ; elle affirme moins, et le vérifie. La ligne de
bilan des non-exécutés dit maintenant qu'un contrôle qui ne s'exécute pas ne prouve rien.

**UN DÉFAUT RÉSIDUEL SUBSISTAIT POURTANT, et il a fallu relire pour le voir.** La sonde était
réparée et l'avertissement ajouté, mais la ligne de verdict disait toujours « **aucune anomalie** »
et le script sortait en **0** — alors que quatre contrôles n'avaient pas tourné. Un appelant qui ne
lit que le code de sortie y voyait une réussite pleine. C'est exactement ce que `CLAUDE.md` §25
interdit : « Ne pas annoncer une réussite lorsque certains contrôles n'ont pas pu être exécutés. »

**Trois issues sont désormais distinguées**, et la correction est **VÉRIFIÉE PAR EXÉCUTION** :

| Code | Sens | Mesuré le 2026-08-18 |
|---|---|---|
| `0` | tout a tourné, rien à signaler | — |
| `2` | rien n'a échoué, mais des contrôles **n'ont pas tourné** | **obtenu** : « 95 vérifications, aucune anomalie, mais 4 NON EXÉCUTÉE(S). Ce n'est pas un succès : le résultat est INCOMPLET. » |
| `1` | au moins un contrôle a échoué | — |

Le `2` est **délibérément distinct du `1`** : « incomplet » n'est pas « en échec », et les confondre
rendrait le harnais rouge sur un poste sain qui n'a simplement pas Docker. Mais il n'est pas `0` non
plus, puisqu'un vert obtenu par omission est précisément ce que cette entrée dénonce. Aucun script
du dépôt n'appelle `verify-scripts.sh` : le changement de code de sortie ne casse aucun appelant.

**Un second défaut trouvé au même endroit, et corrigé.** Le contrôle de lecture des ports lit
`docker ps`. Quand celle-ci est muette, `pipefail` propage l'échec et le contrôle sortait en 1,
c'est-à-dire qu'il **accusait la garde des ports d'un défaut qu'elle n'a pas**. Les trois issues
sont désormais distinguées : port absent des écoutes (échec), aucun port publié (non exécuté),
lecture impossible (non exécuté, et nommé pour ce qu'il est).

**Un compteur périmé au même endroit, et révisé.** Le contrôle des marqueurs `@migration-role`
exigeait un fichier unique, `0018_pg_cron.sql`. `CRM-057` a livré
`0029_pieces_jointes_telechargeables.sql`, qui pose la politique de Storage : le schéma `storage`
appartient à `supabase_admin`. La liste reste **close et nommée**, à deux entrées.

**Ce qui reste dû, et qui n'est PAS du produit.** Trois contrôles de reconstruction d'image restent
rouges sur ce poste : `webapp/Dockerfile` emploie `RUN --mount=type=secret`, donc BuildKit, donc le
greffon `docker-buildx` — celui qui segfaute. Aucun repli n'est possible, le constructeur historique
ne connaissant pas les secrets de build. **Ces trois contrôles restent ROUGES et ne sont pas
convertis en non-exécutés** : les convertir reproduirait exactement le défaut décrit ici.

**Le défaut est LOCALISÉ, et c'est mesuré et non supposé.** Les cinquante et un harnais ont été
passés au crible le 2026-08-18 : `verify-scripts.sh` est le **seul** à porter un mécanisme de saut
(`skip`) et la **seule** sonde `docker info` du dépôt. Deux autres occurrences d'un `|| true` suivi
d'un `ok` ont été inspectées une à une et sont légitimes — dans `verify-move-card-to-channel.sh`
il porte sur la RESTAURATION à l'intérieur de la branche d'échec, la condition mesurée étant le
véritable `UPDATE` ; dans `verify-harness.sh` une suite est lancée exprès sans regarder son verdict,
pour mesurer ensuite l'ABSENCE d'un effet de bord. `verify-mail-sync.sh`, seul à ne pas employer la
formule « aucune anomalie », rend bien un verdict chiffré. **Aucun autre harnais ne dissimule de
contrôle.** Un négatif mesuré vaut d'être écrit : il dit jusqu'où porte la correction.

**Aggravation constatée le même jour.** En cours de session, `docker compose` s'est mis à segfauter
à son tour, le montage `/mnt/wsl/docker-desktop/cli-tools/.../cli-plugins` s'est vidé, la socket a
cessé de répondre au `_ping`, et Kong comme la webapp sont devenus injoignables : **Docker Desktop
s'est arrêté côté Windows**.

**CAUSE RACINE ÉTABLIE, et elle n'est pas dans le dépôt.** Le journal du backend
(`com.docker.backend.exe.log`) répète `connect tcp 192.168.65.7:2376: no route to host` : le backend
n'atteint plus la machine virtuelle du moteur. La distro `docker-desktop` est pourtant **RUNNING**
d'après `wsl -l --running`, mais toute exécution dedans échoue en `Wsl/Service/0x8007274c`, c'est-à-dire
un **délai de connexion dépassé** : la distro tourne et ne répond plus. Le montage
`/mnt/wsl/docker-desktop/cli-tools/.../cli-plugins` reste vide, ce qui explique les segfaults des
greffons CLI — ils pointent vers des binaires absents.

**Ce qui a été tenté, et pourquoi cela n'a pas suffi.** Relance de `Docker Desktop.exe` : le journal
répond `backend already running, signaling show-dashboard` — l'application se croit saine et se
contente d'ouvrir son tableau de bord. Terminaison de la distro `docker-desktop` par
`wsl --terminate`, puis arrêt forcé de `Docker Desktop.exe` et relance à froid : la distro redémarre
et retombe dans le même silence.

**DIAGNOSTIC AFFINÉ, une fois l'interop Windows revenue.** Les premiers symptômes — `no route to
host`, `Wsl/Service/0x8007274c`, `accept4 failed 110` — laissaient croire à une rupture de la
communication vsock. Ils n'en étaient qu'un effet. Une fois `wsl.exe` de nouveau utilisable, une
inspection **à l'intérieur** de la distro `docker-desktop` montre la vraie cause :

- elle **démarre**, mais ne porte que `init` et `vpnkit-bridge` — **ni `dockerd`, ni `containerd`**,
  et ces binaires ne sont même pas dans le `PATH` ;
- `/run/guest-services/` est **vide**, `/containers` **n'existe pas**, et
  `/mnt/wsl/docker-desktop/cli-tools/.../cli-plugins` reste **vide** — ce qui explique enfin les
  segfauts des greffons CLI : ils pointent vers des binaires absents ;
- `/var/run/docker.sock` n'existe pas **à l'intérieur** de la distro.

**La distro tourne sans être provisionnée** : son image de service n'est pas attachée. Le backend
Windows, lui, est bien relancé — il interroge le moteur toutes les secondes et reçoit une connexion
fermée, indéfiniment.

**Ce qui reste, et qui demande la main de l'exploitant.** Le remède est `wsl --shutdown`, qui
redémarre **toutes** les distros — y compris celle où l'agent s'exécute — et laisse Docker Desktop
re-provisionner la sienne au démarrage suivant. Il n'a donc **pas** été exécuté : une commande qui
détruit son propre contexte d'exécution n'est pas une réparation autonome. À défaut, un redémarrage
de Windows.

**LES DONNÉES SONT INTACTES, ET C'EST MESURÉ.** Sur le disque Windows, dans le dossier WSL de
Docker Desktop :

- `disk/docker_data.vhdx` pèse **≈ 120 Go** — c'est le disque des **volumes, images et bases**. Il
  est là, entier. La base de développement, son seed et les secrets de Vault n'ont rien perdu.
- `main/ext4.vhdx` ne pèse que **96 Mo** — c'est le système de fichiers de la distro de **service**,
  celle qui doit porter `dockerd`. Sa taille confirme l'observation faite depuis l'intérieur : elle
  est **vide de son moteur**, non corrompue par les données.

La panne est donc **entièrement du côté de la distro de service**, et le disque de données n'y est
pour rien. C'est ce qui rend la réparation à la fois simple et dangereuse à mal choisir.

**AVERTISSEMENT, et il n'est pas théorique.** L'option « Reset to factory defaults » / « Clean /
Purge data » de Docker Desktop **DÉTRUIRAIT LES VOLUMES**, donc la base de développement, son seed
et les secrets chiffrés de Vault. Elle ne doit **pas** être employée pour cette panne : le problème
est le provisionnement de la distro de service, pas les données. `wsl --shutdown` suffit et ne
touche à aucun volume.

**AUCUNE VOIE DE CONTOURNEMENT N'EXISTE SUR CE POSTE, ET C'EST ÉTABLI PLUTÔT QUE SUPPOSÉ.** Avant
de conclure à un blocage, les solutions de repli ont été mesurées une à une :

- **Aucun autre moteur de conteneur** n'est installé dans la distro de travail : ni `podman`, ni
  `nerdctl`, ni `containerd`, ni `dockerd` natif, ni `lima`, ni `colima`.
- **Installer un moteur natif est impossible** : `sudo` exige un mot de passe, que l'agent ne
  sollicite pas.
- **Le mode rootless est impossible aussi** : `newuidmap`, `newgidmap`, `slirp4netns` et
  `fuse-overlayfs` sont **absents**, et les installer demande root. `/etc/subuid` et `/etc/subgid`
  portent pourtant les plages nécessaires — c'est l'outillage qui manque, pas la configuration.
- **Reconstruire la pile ailleurs n'aurait rien prouvé** : les preuves portent sur la pile réelle du
  projet, ses migrations, ses politiques et son seed.

**L'OUTIL OFFICIEL DE DOCKER DESKTOP A ÉTÉ ESSAYÉ AUSSI, ET IL SE BLOQUE.** Une fois l'interop
revenue, `C:\Program Files\Docker\Docker\DockerCli.exe` répond et offre trois gestes utiles :

- `-SwitchLinuxEngine` rend **code 0** — et rien ne se passe : ni greffons remontés, ni socket, ni
  `dockerd` dans la distro.
- `-Shutdown` **ne rend jamais la main** : essayé jusqu'à **280 secondes**, les processus
  `com.docker.backend.exe` restent vivants. Il attend l'arrêt d'un moteur qui n'a jamais démarré.
- Relancer l'application après cela ramène le journal à `backend already running, signaling
  show-dashboard` : elle se croit saine et se contente d'ouvrir son tableau de bord.

Docker Desktop est donc **coincé sur lui-même** : il ne peut ni démarrer son moteur, ni s'arrêter
proprement pour réessayer. Les processus coincés ont été arrêtés pour laisser un démarrage propre
après le redémarrage de WSL.

Le blocage est donc **total et mesuré**, et il ne reste qu'un geste humain.

**Ce qui a été tenté après le retour de l'interop, sans succès.** Arrêt forcé de `Docker
Desktop.exe`, `wsl --terminate docker-desktop`, relance à froid — et cette fois le journal montre un
**vrai** redémarrage du backend (« launching com.docker.backend.exe ») et non plus le
« backend already running » des tentatives précédentes. Le moteur n'est pas revenu pour autant. Tant que le poste n'est pas rétabli,
**aucune vérification de cette session ne peut être rejouée**, et rien ne doit être déclaré vérifié
sur cette base.

### INC-144 — Les migrations 17 et 20 ne se rejouent plus sur une base peuplée — CLOSE le 2026-08-17

**Nature :** dépendance d'ordre ; le rejeu d'une migration ancienne casse une contrainte élargie depuis.
**Relevé le :** 2026-08-17, en exécutant `scripts/verify-move-card-to-channel.sh`.

**Reproduit à la main, sur une base saine et seedée** :

```
psql -f supabase/migrations/0017_move_card_to_channel.sql
ERROR:  check constraint "card_events_type_check" of relation "card_events"
        is violated by some row
```

Idem pour `0020_change_channel_workflow.sql`. Les deux réinstallent `card_events_type_check` avec le
vocabulaire de leur époque ; or la table contient désormais des événements `mail_received`,
`mail_sent`, `snoozed` et `woken`, livrés par `CRM-055`, `CRM-058` et `CRM-081`. La contrainte
étroite est alors refusée par les lignes existantes.

**Pourquoi le `migrations-runner` ne le voit pas.** Il rejoue le répertoire dans l'ordre : sur une
base **vide** — après `resetMe.sh` — la contrainte étroite passe, puis les migrations suivantes
l'élargissent. Le défaut n'apparaît que sur une base **peuplée**, c'est-à-dire exactement le cas d'un
redémarrage de pile en cours de vie. **C'est la même famille que la décision 325**, qui avait déjà
réparé ce mécanisme pour `mail_received` en conditionnant la convergence — la garde posée alors ne
couvre pas les types arrivés depuis.

**Ce que la remise en état a révélé au passage.** Le vocabulaire compte **quatorze** types, et non
douze : `snoozed` et `woken` s'ajoutent aux douze connus. Plusieurs contrôles et migrations
raisonnent encore sur une liste plus courte.

**CORRIGÉ le 2026-08-17, et le défaut portait plus loin que son titre.** Cinq migrations
réinstallaient la contrainte, et non deux : **16, 17, 20, 25 et 30**. Chacune reçoit une seconde
garde qui interroge les LIGNES et non plus seulement la contrainte — elle ne pose sa liste que si
aucune ligne n'emploie un type qui en est absent. Sur base neuve, rien ne change. Sur base peuplée,
les migrations anciennes s'abstiennent et la dernière qui étend le vocabulaire, aujourd'hui la 44,
en devient seule responsable. Voir `docs/JOURNAL.md` décision 431.

**Preuve.** Contrainte déposée sur une base portant `snoozed` et `mail_received` : les cinq
migrations se rejouent sans erreur, le répertoire entier sort en code 0, la contrainte finale porte
de nouveau les quatorze types. Sur base neuve après `resetMe.sh` : quatorze types, 2191 assertions
pgTAP vertes. `verify-move-card-to-channel.sh` — l'accusateur — passe à **49 contrôles, aucune
anomalie**, avec deux contrôles ajoutés dont un qui exige que le vocabulaire restauré soit COMPLET.

### INC-143 — Quatre unités restent `[~]` au nom d'INC-021, close depuis une semaine

**Nature :** blocage cité longtemps après la disparition de sa cause ; il fausse le décompte du backlog.
**Relevé le :** 2026-08-14, en passant les unités `[~]` en revue une par une.

**Ce qui est mesuré.** `CRM-042`, `CRM-045`, `CRM-046` et `CRM-047` portent chacune un écart ouvert
rédigé ainsi : « **INC-021 conditionne le passage en `[x]`** ». `CRM-047` précise même
« dix-huitième unité consécutive ». Or INC-021 — « aucune unité ne portait l'écran de connexion » —
figure dans le tableau des entrées **CLOSES** de ce registre, fermée le **2026-08-07** par `CRM-009`,
décision 253. Le motif du blocage a donc disparu il y a une semaine, et quatre unités le citent
encore.

**Ce que cela ne veut PAS dire.** Fermer INC-021 ne livre aucune preuve : ces quatre unités
attendaient un parcours E2E **authentifié**, impossible tant qu'aucun écran de connexion n'existait.
La session existe désormais — `e2e/ui/manuel.spec.ts`, `commentaires-gestes.spec.ts` et les suites du
sommeil s'y connectent réellement —, mais chaque unité doit **écrire et exécuter** son propre
parcours avant de passer `[x]`. Le blocage est levé ; le travail, lui, reste dû.

**C'est le même mode de défaillance qu'INC-088**, relevé le 2026-08-11 : la fiche d'une affaire
restait en lecture seule « au nom d'INC-021 », close depuis `CRM-009`. Deux constats indépendants,
une seule cause : **une entrée close n'a pas été répercutée dans les unités qui la citaient**. Rien
ne relie mécaniquement la fermeture d'une entrée aux écarts qui s'en réclament, et la revue manuelle
ne l'a pas fait pendant sept jours.

**Ce qui reste dû.** Pour chacune des quatre unités : écrire le parcours authentifié que sa
Definition of Done réclame, l'exécuter, produire et observer ses captures, puis clore. Et
plus généralement : à la fermeture d'une entrée du registre, chercher les écarts qui la nomment.

### INC-142 — Les preuves d'interface laissent des résidus, et toute assertion à compteur devient rouge

**Nature :** défaut de nettoyage des preuves ; il rend rouges des assertions étrangères à l'unité fautive.
**Relevé le :** 2026-08-14, en cherchant la cause des huit échecs de `verify-colonnes-protegees.sh`.

**Ce qui est mesuré, et qui dédouane le seed.** `public.tracks` portait **7** lignes dont **3**
archivées, là où les suites attendent 5 et 1. Réparti par origine :

| Origine | Lignes | Archivées |
|---|---|---|
| Seed (`id like '5eed%'`) | **5** | **1** |
| Résidus | **2** | **2** |

Les deux résidus s'appelaient `E2E Arbo Souris Renommé` et `E2E Arbo Clavier Renommé`, créés le
2026-08-13 par `e2e/ui/administration-arborescence.spec.ts` — la preuve d'écran de `CRM-075`. Le seed
n'a donc jamais dérivé : ce sont les compteurs qui mesuraient « seed + résidus ».

**Pourquoi le scénario ne nettoie pas, et ce n'est pas une négligence.** `tracks` et `channels`
n'exposent **aucun `DELETE`**, par décision de `CRM-020` et `CRM-021` : archiver masque et reste
réversible. Le scénario archive donc — le seul geste que le produit offre — et la ligne archivée
**compte toujours**. Il y a là un conflit structurel entre « aucune suppression » et « le seed est
rendu intact » que ni l'une ni l'autre unité n'avait vu.

**Ce que cela coûte.** Après la suppression manuelle des deux résidus, `0004_tracks.test.sql`
redevient verte. Six autres suites restent rouges pour la même raison — cards, valeurs de champs,
commentaires, copies de workflow —, chacune comptant des lignes qu'une preuve a laissées. **Une
assertion à compteur ne mesure plus l'unité qu'elle nomme dès qu'une autre preuve écrit sans purger.**

**CONFIRMÉ ET PRÉCISÉ LE 2026-08-14, APRÈS REMISE À ZÉRO.** Les résidus retirés — deux tracks, deux
channels, une pierre tombale, un envoi du jour, un commentaire au suppresseur perdu — et
`snoozed_until` refermée, la suite complète est passée au VERT : **42 fichiers, 2191 assertions,
aucune anomalie**. Puis **une seule exécution de `verify-colonnes-protegees.sh` a suffi à rendre
trois suites rouges de nouveau.** Le harnais resalit la base qu'il mesure.

**Ce que la seconde salissure n'est PAS.** Mesuré : les trois cards sondées sont à leur étape
seedée — `c1` Relance, `c4` Négociation, `c5` Prospection. Le défaut ne vient donc pas d'un
déplacement non restauré. Les assertions 47 et 48 de `0013_move_card.test.sql` échouent en recevant
`transition_not_allowed` là où elles attendent le refus d'un motif blanc : ce n'est pas le motif qui
est mal jugé, c'est la **transition elle-même** qui n'est plus autorisée. Piste à suivre : le
workflow du channel a changé — `change_channel_workflow` est exercée par les preuves —, ou une arête
du graphe a été retirée puis non rétablie.

**Ce qui reste dû.** Chaque scénario qui crée une ligne inaccessible au `DELETE` client doit purger
avec la **clé de service** dans son `finally`, comme `commentaires-gestes.spec.ts` le fait déjà pour
les commentaires : c'est le seul chemin qui le peut, et il existe. À défaut, les compteurs devront
tous filtrer sur `id like '5eed%'` — ce qui les rendrait aveugles aux résidus au lieu de les dénoncer.
La première voie est la bonne ; la seconde renoncerait à ce que ces compteurs servent.

### INC-123 — l'hôte de vérification ne porte pas le navigateur qu'exige `@playwright/test` 1.62.1

*Porteur : `CRM-008` (harnais de preuves). Mesuré le 2026-08-16, campagne complète.*

Cinq scénarios de `npm run e2e:mail` — `roundcube.spec.ts` (4) et `roundcube-dossiers.spec.ts` (1) —
échouent **avant d'exécuter la moindre assertion**, en 2 ms :

```
browserType.launch: Executable doesn't exist at
/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
```

L'hôte fournit `/opt/pw-browsers/chromium_headless_shell-1194`, et la version épinglée en attend
`-1234`. Les scénarios d'interface de `npm run e2e:ui` ne sont pas touchés : ils reçoivent
`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`, tandis que ces cinq-là lancent leur propre
navigateur sans ce chemin.

**Antériorité établie.** Le défaut est indépendant de tout code du dépôt : il porte sur un binaire
absent du système de fichiers, et il se manifeste identiquement avant et après le changement de la
session, qui n'a touché que `webapp/src/app/GuideDemarrage.tsx` et deux fichiers de preuve.
`npm run e2e:mail` rend **36 passés, 6 échoués**, dont ces cinq.

**Rien n'est modifié.** Ni la version épinglée, ni le chemin des navigateurs : changer l'un ou
l'autre pour verdir ici toucherait le contrat de preuve de tout le dépôt sur la foi d'un seul hôte.

**PRÉCISION MESURÉE le 2026-08-15 par l'autre session `CRM-079`, et elle réduit l'entrée à un
défaut de commande, non d'hôte.** Ces cinq scénarios passent lorsque `npm run e2e:mail` est lancé
dans un shell portant `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` — la même variable
qu'`e2e:ui` exige déjà : la suite rend alors **41/42**, seul l'`INC-124` restant. Le binaire attendu
est donc bien absent, mais l'hôte porte un navigateur utilisable et la variable suffit à l'y mener.
Ce qui reste dû à `CRM-008` n'est pas un navigateur : c'est que la commande `e2e:mail` porte ce
chemin elle-même, comme `e2e:ui` le fait, plutôt que de dépendre de l'environnement de l'appelant.

**Portée réelle, mesurée le 2026-08-16 en lançant la série des `verify-*.sh` : elle dépasse
largement `e2e:mail`.** Le même échec frappe **tout harnais qui lance un navigateur sans
`PLAYWRIGHT_CHROMIUM_PATH`**. `scripts/verify-administration-arborescence.sh` rend ainsi
`27 contrôles, 3 en échec` — parcours d'interface, coquille, manuel —, et le journal des trois
étapes ne contient **aucune assertion produit** : les treize scénarios meurent tous sur
`browserType.launch`. Les mêmes fichiers passent `72/72` quand ils sont lancés avec
`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`, ce que `npm run e2e:ui` reçoit et que les
harnais ne posent pas eux-mêmes.

**Conséquence à retenir, et c'est la plus importante : un verdict de `verify-*.sh` obtenu sans
cette variable ne dit RIEN du produit.** Il ne doit être lu ni comme une régression, ni comme une
preuve. Toute session qui exécute ces harnais sur cet hôte exporte la variable d'abord.

**CONTRE-ÉPREUVE, ET ELLE FERME LA QUESTION — mesurée le 2026-08-16.** Le même harnais, relancé
avec la variable exportée **et** le port `4173` libre, rend :

```
scripts/verify-administration-arborescence.sh  =>  27 contrôles, aucune anomalie.
```

Les harnais du dépôt sont donc **pleinement exécutables sur cet hôte**, ce qu'aucune session
n'avait encore constaté. Deux conditions, et elles sont toutes les deux extérieures au dépôt :

1. `export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` — sans quoi tout scénario
   d'interface meurt sur `browserType.launch`, avant la moindre assertion ;
2. **aucun `vite preview` résiduel sur le port `4173`** — la configuration pose
   `reuseExistingServer: false`, et un serveur laissé par une exécution précédente fait échouer
   l'étape entière sur `http://127.0.0.1:4173 is already used`, message qui ne dit rien du produit
   non plus. Une série interrompue laisse ce serveur derrière elle : `pkill -f vite` avant de
   relancer.

**Ce qui reste dû à `CRM-008` est donc précisé** : que les harnais posent eux-mêmes le chemin du
navigateur, comme `npm run e2e:ui` le fait, plutôt que de dépendre de l'environnement de
l'appelant.

### INC-124 — `mail-sync` journalise un `WARNING` légitime que la preuve S3 interdit

*Porteur : `CRM-054` (console opérationnelle de `mail-sync`). Mesuré le 2026-08-16.*

`e2e/mail/mail-sync.spec.ts:210` — « chaque ligne est un JSON borné, sans secret ni avertissement » —
exige que **tout** niveau journalisé soit `DEBUG` ou `INFO`. Le service en produit deux autres :

```
{"level":"WARNING","service":"mail-sync","event":"An error occurred while decoding
 b\"Mailbox 'CRM/Studio web (renomm\\xc3\\xa9 …)' already exists.\" in ASCII 'strict' mode…"}
{"level":"WARNING","service":"mail-sync","event":"folder_rename_refused"}
```

Les deux lignes sont **correctes** : un dossier IMAP déjà présent est refusé, et le service le dit
sans exposer aucun secret — le jeton n'apparaît nulle part, ce que la suite vérifie par ailleurs.
C'est l'assertion qui est trop étroite : elle confond « aucun avertissement » avec « aucun incident
survenu », alors qu'un renommage refusé est un fait d'exploitation que la console DOIT porter.

**Ce qui reste à trancher appartient à `CRM-054`**, et non à cette session : soit la preuve admet
`WARNING` en nommant les événements attendus, soit le service cesse de renommer un dossier déjà
présent. Le comportement est laissé **strictement inchangé** en attendant.

### INC-125 — les trois garde-fous globaux de `verify-harness.sh` ont de nouveau dérivé, et INC-101 l'avait déjà dit

**Mesuré le 2026-08-16**, pile debout et seedée, sur un arbre dont le travail de la session est
committé. `scripts/verify-harness.sh` rend **28 contrôles, 3 anomalies**, et les trois sont des
comptes figés que les unités livrées depuis n'ont pas mis à jour :

| Garde-fou | Valeur figée | Valeur réelle mesurée | Écart |
|---|---|---|---|
| `FICHIERS_SQL_ATTENDUS` / `ASSERTIONS_ATTENDUES` | 36 / 2003 | **40 / 2133** | +4 fichiers, +130 assertions |
| `SCENARIOS_API` | 514 | **597** | +83 scénarios |
| `SCENARIOS_UI` | 241 | **286** | +45 scénarios |

**Les trois suites sont VERTES.** Le harnais le dit lui-même — « vert mais N au lieu de M » : il ne
dénonce aucune régression du produit, seulement sa propre péremption.

**Ce n'est PAS imputable à `CRM-079`, et la mesure le montre sans recours au `git stash`.** La
session n'ajoute **aucune** suite pgTAP et **aucun** scénario d'API : les deux premiers écarts lui
sont entièrement étrangers. Elle ajoute **un** scénario d'interface, soit 1 des 45 du troisième :
l'anomalie était déjà là à 285, et le resterait sans ce commit.

**MESURE DE PLUS, LE 2026-08-16, PAR LA SESSION `CRM-037` DU PARCOURS ENCHAÎNÉ.** Campagne complète
sur pile debout et seedée : `test:sql` **41 fichiers, 2161 assertions**, `e2e:api` **652
scénarios**, `e2e:ui` **340 scénarios** — les trois vertes. Les trois garde-fous restent donc figés
à 36 / 2003, 514 et 241, et l'écart s'est **creusé** depuis la mesure ci-dessus, sans qu'aucune
régression soit en cause. Cette session ajoute **2** des 99 scénarios d'interface d'écart :
l'anomalie serait là à 338 sans ce commit. **Rien n'est corrigé** : ces compteurs sont sous
arbitrage ici même, et les relever au passage reviendrait à verdir un garde-fou sans que personne
n'ait décidé qui doit le tenir à jour — ce qui est précisément la question posée.

**INC-101, close le 2026-08-14, portait exactement ce constat** — « les cinq garde-fous globaux de
`verify-harness.sh` étaient périmés ». Le mode de défaillance s'est donc reproduit en deux jours,
ce qui est l'information utile ici : ces compteurs sont révisés par une session qui les remarque,
et non par la Definition of Done des unités qui les font bouger. C'est la même dette de mise en
œuvre que le §1 de `docs/ARBITRAGES.md` décrit, et c'est ce qui distingue cette entrée d'une simple
répétition.

**Comportement laissé inchangé** (`docs/CloudWorker.md` §3.1) : aucun compteur n'est corrigé au
passage. Les remettre à jour sans traiter la cause — la révision qui n'est due à personne —
reviendrait à repousser la même dérive d'une poignée d'unités. Le porteur est `CRM-008`, l'unité du
harnais de tests.

---

### INC-126 — la proposition de clé est inutilisable pour tout libellé portant « œ »

*Porteur : `CRM-075` (`proposerSlug`). Mesuré le 2026-08-16 par la session `CRM-030`, dans la preuve
d'interface du catalogue de nœuds.*

`proposerSlug` propose un slug depuis un nom : elle décompose en NFD, retire les diacritiques, puis
remplace tout ce qui n'est ni lettre latine ni chiffre par un tiret. **Mesuré** : « Nœud de preuve »
rend `n-ud-de-preuve`.

La cause est écrite au §5.1 de `docs/SPEC-administration-arborescence.md` — « ce qui n'est pas
décomposable n'est pas translittéré » — et la mesure la confirme : `'œ'.normalize('NFD')` rend `'œ'`,
la **ligature** n'étant pas une lettre accentuée. Le comportement est donc conforme à sa
spécification. Ce qui n'y avait pas été vu, c'est sa portée : « œ » n'est pas un caractère exotique
en français — *nœud*, *cœur*, *sœur*, *manœuvre*, *œuvre* —, et le premier objet que l'écran neuf
propose de nommer s'appelle précisément « nœud ».

**La conséquence n'est pas une faute**, et c'est ce qui rend l'entrée utile plutôt qu'urgente : le
champ reste modifiable, la contrainte `key_check` accepte `n-ud-de-preuve`, et la proposition n'a
jamais été qu'une commodité. Ce que le produit livre est une proposition **silencieusement
dégradée** : rien ne signale à l'utilisateur que la clé proposée a perdu une lettre.

**Comportement laissé inchangé** (`docs/CloudWorker.md` §3.1). Le défaut appartient à `CRM-075`, qui
porte `proposerSlug`, et le corriger au passage depuis `CRM-030` toucherait les tracks et les
channels — dont les slugs sont des **adresses partagées** (`/tracks/:slug`), là où la clé d'un nœud
ne l'est pas. La preuve d'interface de `CRM-030` **constate** la valeur mesurée au lieu de choisir
un libellé qui l'éviterait : le jour où la translittération des ligatures sera ajoutée, cette
assertion rougira et désignera l'endroit à mettre à jour.

**Ce que ce n'est pas** : une demande d'arbitrage. Ajouter `œ → oe`, `æ → ae` et `ß → ss` à la
normalisation est un choix que la mesure tranche seule ; il reste à faire, sous son unité porteuse.

### INC-127 — le `README.md` annonce « 40 cas » de `pytest` là où la suite en compte 242

*Porteur : `CRM-008` (documentation des preuves) et `CRM-051` (le sujet de la suite). Mesuré le
2026-08-16 par la session `CRM-030`, en exécutant la campagne de fin de session.*

Le `README.md` écrit deux fois le même compte figé : ligne 399, « pytest, 40 tests du service
mail-sync — aucune pile requise », et dans l'arborescence du dépôt, « tests/ pytest — 40 cas, sans
pile ». **Mesuré** : `.venv/bin/python -m pytest mail-sync/tests` rend **242 passed**, en une
seconde, sans pile — le reste de la phrase est donc exact, seul le nombre a dérivé.

La suite est **verte** : ce n'est pas une régression, c'est un compteur que les unités qui l'ont fait
monter n'ont pas révisé. **C'est exactement le mode de défaillance qu'INC-125 décrit** pour les trois
garde-fous de `scripts/verify-harness.sh`, et qu'INC-101 avait déjà décrit avant elle : un nombre
recopié dans un document est révisé par la session qui le remarque, jamais par la Definition of Done
de l'unité qui le fait bouger. La troisième occurrence en deux jours, sur un troisième support.

**Comportement laissé inchangé, et le chiffre aussi** (`docs/CloudWorker.md` §3.1) : le défaut est
étranger à `CRM-030`, qui n'ajoute ni ne retire aucun cas `pytest`. Le corriger ici réparerait une
mesure sans réparer le mécanisme qui la laisse dériver.

**Ce que ce n'est pas** : une demande d'arbitrage. Le remède est celui qu'INC-125 attend déjà — que
les comptes vivent dans un harnais qui les recalcule, ou qu'une unité les inscrive à sa Definition
of Done. Il se décide une fois, pour les trois supports à la fois.

### INC-128 — `e2e/mail/dossiers.spec.ts` échoue dans sa suite complète et passe seul

*Porteur : `CRM-056` (l'arborescence IMAP). Mesuré le 2026-08-16 par la session `CRM-030`, dans la
campagne de fin de session.*

**Mesuré, deux fois et dans cet ordre** : `npm run e2e:mail` rend **41 passés, 1 en échec** — le
scénario « renommer un TRACK renomme son dossier et emporte ses enfants », ligne 266 ; le **même
scénario relancé seul**, par `-g`, rend **1 passé** en 4 secondes. La différence n'est donc pas dans
le scénario, elle est dans ce que les scénarios qui le précèdent laissent derrière eux.

**Ce n'est pas imputable à cette session, et la ligne de base n'a pas eu à être fabriquée pour
l'établir.** La suite `mail` ne porte **aucune** occurrence de `catalogue`,
`workflow_nodes_catalog` ni `administration-catalogue` — vérifié par recherche —, et les cinq
fichiers de code que la session modifie sont tous ceux de l'écran du catalogue. Aucun chemin ne relie
les deux.

**C'est le mode de défaillance qu'INC-105 et INC-117 décrivent déjà** : une dérive d'ÉTAT laissée par
les scénarios voisins, et non une régression du produit. La session `CRM-030` du même jour l'avait
rencontrée sur `test:sql`, où un rejeu de `supabase/seed/apply-seed.sh` avait rendu les 40 fichiers
verts. Ce qui est nouveau ici est le support : c'est la première fois que le mode est mesuré sur la
suite `mail`, où l'état partagé n'est pas seulement la base mais **l'arborescence IMAP de Stalwart**.

**Comportement laissé inchangé** (`docs/CloudWorker.md` §3.1) : le défaut est étranger à `CRM-030`,
et le traiter demanderait de savoir lequel des scénarios précédents laisse le dossier dans un état
qui empêche le renommage — une investigation qui appartient à `CRM-056`. Le corriger au passage en
ajoutant une purge à ce seul scénario masquerait la cause au lieu de la lever.

**Conséquence à connaître** : `scripts/verify-harness.sh` compte cet échec parmi ses anomalies, en
plus des trois compteurs figés d'INC-125. Un verdict à quatre anomalies sur ce harnais s'explique
donc entièrement par deux entrées ouvertes, et non par l'unité en cours.

### INC-129 — `verify-copie-workflow.sh` REJOUE la migration 19 et RAMÈNE `move_card` à son état d'avant la migration 35

*Relevé le 2026-08-16 pendant `CRM-032`, unité d'interface. Étranger à cette unité : le changement
de la session ne touche aucun `.sql`, aucun script et aucun seed — vérifié par
`git diff <base>..HEAD --stat -- supabase/ scripts/`, qui rend une sortie vide.*

**Mesure.** `npm run test:sql` rend **40 fichiers, 2133 assertions, aucune anomalie** avant
`scripts/verify-copie-workflow.sh`, et **3 fichiers en échec** après lui :

```
0013_move_card.test.sql        — 8 assertions en échec sur 82
0014_valeurs_champs.test.sql   — 1 assertion en échec sur 103
0017_commentaires.test.sql     — 1 assertion en échec sur 98
```

L'assertion la plus lisible est celle de `0017` :

```
select ok((select prosrc like '%card_comments%' from pg_proc
            where oid = 'public.move_card(uuid, uuid, text)'::regprocedure), …)
```

Elle rend `f` après le harnais, `t` avant.

**Cause, isolée.** Le harnais restaure ses trois dégradations réelles en rejouant **un seul fichier**
— `MIGRATION_FILE=supabase/migrations/0019_transition_required_fields.sql`, aux lignes 184, 201, 481
et 509. Or `public.move_card(uuid, uuid, text)` est redéfinie par **cinq** migrations, dont `0019`
n'est pas la dernière :

```
0012_move_card.sql  0013_valeurs_champs.sql  0017_move_card_to_channel.sql
0019_transition_required_fields.sql  0035_commentaires_lot_g.sql
```

Rejouer `0019` seul réinstalle donc la version de `move_card` **d'avant** `0035`, c'est-à-dire celle
qui n'écrit pas le commentaire qu'elle exige — la régression que `0035` avait précisément fermée
(INC-048). Rien ne le signale : le harnais rend `35 contrôles, 2 en échec` en imputant l'échec aux
suites, non à sa propre restauration.

**Le seed ne répare pas.** `supabase/seed/apply-seed.sh` a été rejoué : il sort en `0`, et les trois
fichiers restent rouges. Le seed pose des données, pas des fonctions.

**Réparation appliquée à la base locale, aucun fichier du dépôt modifié** : rejeu de
`supabase/migrations/0035_commentaires_lot_g.sql`, après quoi `prosrc like '%card_comments%'` rend
de nouveau `t` et `npm run test:sql` rend **40 fichiers, 2133 assertions, aucune anomalie**.

**Portée probable au-delà de ce harnais.** Tout harnais qui rejoue une migration intermédiaire pour
restaurer une dégradation expose le même défaut dès qu'une migration ultérieure redéfinit le même
objet. Le contrôle ne peut pas être « le fichier se rejoue sans erreur » : il doit être « l'objet
restauré est celui de la DERNIÈRE migration qui le définit ».

**Comportement laissé inchangé, et arbitrage demandé.** Deux options s'offrent, et aucune n'est
tranchée ici : rejouer la **chaîne complète** des migrations après une dégradation, ou faire porter à
chaque harnais la liste des fichiers qui redéfinissent les objets qu'il touche. La première est sûre
et lente ; la seconde est rapide et se périme au premier ajout de migration. Le responsable tranche.

**REPRODUITE UNE SECONDE FOIS, LE 2026-08-16, PAR `CRM-032`.** Le harnais a été lancé en `--rapide`
en fin de session, et il a rendu **28 contrôles, aucune anomalie** — ses trois dégradations réelles
comprises, et sa restauration « constatée ». `npm run test:sql`, rejoué immédiatement après, est
alors passé de **41 fichiers, 2161 assertions, aucune anomalie** à **41 fichiers, 3 en échec**.
Base locale réparée par un simple rejeu de `supabase/migrations/0035_commentaires_lot_g.sql`, après
quoi les 2161 assertions sont redevenues vertes.

Cette seconde mesure ajoute un fait au diagnostic : **le harnais se déclare vert en laissant la base
cassée**. Son propre bilan ne peut donc pas servir d'indice, et seule une suite exécutée APRÈS lui
révèle le dégât. Toute session qui lance `verify-copie-workflow.sh` doit rejouer `0035` derrière,
ou rejouer `test:sql` pour constater. L'arbitrage reste demandé, et le comportement inchangé.

---

## Consignée le 2026-08-16 — un constat étranger à `CRM-037`

Elle suit la doctrine du §1 : elle est **mesurée**, elle est **étrangère à l'unité de la session**,
et le comportement est laissé **inchangé**. Elle ne demande aucun arbitrage : c'est un fait à porter
par son unité, pas un choix à trancher.

### INC-130 — une classe citée par l'éditeur de workflows n'existe pas dans le CSS produit

*Porteur : `CRM-076` (éditeur de workflows). Mesuré le 2026-08-16 par la campagne de `CRM-037`.*

`scripts/verify-formulaire.sh` contrôle que chaque classe citée par le rendu existe réellement dans
le CSS produit — une classe dont le jeton n'est pas déclaré n'est **pas engendrée, en silence**
(`docs/DESIGN_SYSTEM.md` §11). Sur 227 classes relevées dans `webapp/src`, **une** manque :

```
classes absentes du CSS produit : text-text-1
webapp/src/app/AdministrationWorkflows.tsx:2298
```

L'échelle des neutres du §1 du design system nomme `--color-text`, `--color-text-2` et
`--color-text-3` ; **`text-text-1` n'existe pas**. Le bloc concerné rend donc son texte dans la
couleur héritée, et non dans celle que le code déclare. Le mot reste lisible — aucune assertion ne
pouvait rougir —, c'est exactement le défaut que le §5.7 bis décrit : un rendu qui perd
**silencieusement** ce qu'il croyait poser.

**Origine datée, et non supposée** : `git log -L 2298,2298` sur ce fichier rend le commit `fe846f5`
du 2026-08-16 07:52 UTC — la tranche d'interface de `CRM-032`, **antérieure** à cette session. La
ligne de base est donc établie sans `git stash` : la classe manquait avant que cette session
n'écrive quoi que ce soit.

**Comportement laissé inchangé.** `AdministrationWorkflows.tsx` est un livrable de `CRM-076`, et le
corriger ici rouvrirait cette unité (`CLAUDE.md` §13). La correction tient en un caractère —
`text-text-1` → `text-text` ou `text-text-2` selon l'intention du bloc —, et c'est précisément
pourquoi elle doit être faite **par l'unité qui sait laquelle des deux était voulue**.

**Deux défauts du même genre ont été trouvés et corrigés dans le même passage**, ceux-là imputables
à cette session : `mt-0.5`, absent de l'échelle fermée du §3, et `enregistre` — une valeur de phase
écrite dans une condition à l'intérieur d'un attribut `className`, que le contrôle relevait comme
une classe. Les deux sont corrigés à la cause, le second en nommant les deux graduations hors du
JSX.

### INC-131 — le gabarit du contrôle d'échéance suit la locale du NAVIGATEUR, jamais celle du produit

**Constaté le 2026-08-16**, en regardant `docs/captures/CRM-040/entete-card-edition-xl-1440.jpg`
(`CLAUDE.md` §16) — pas en lisant un test : aucune assertion ne pouvait le voir.

Le contrôle d'échéance de l'en-tête (`input type="datetime-local"`, `docs/SPEC-cards.md` §15 bis)
affiche son gabarit vide en **`mm/dd/yyyy, --:-- --`**, c'est-à-dire au format américain, alors que
le produit est français (`docs/DESIGN_SYSTEM.md` §10) et que toutes ses autres dates sont rendues en
`fr-FR` par `Intl.DateTimeFormat`.

**Le motif est mesuré, et il est hors du dépôt.** Le gabarit d'un contrôle de date natif est choisi
par le **navigateur**, d'après la locale de l'utilisateur : aucun attribut HTML ne le force, et
`lang="fr"` sur le document ne l'atteint pas. Ici c'est Chromium lancé par le harnais, dont la
locale par défaut est `en-US` — `e2e/playwright.config.ts` n'en fixe aucune. Dans un navigateur
configuré en français, le même contrôle rend `jj/mm/aaaa`.

**La valeur, elle, n'est pas concernée** : elle est écrite et lue en `AAAA-MM-JJTHH:MM`, format
imposé par la spécification HTML et indépendant de la locale, et `webapp/src/app/EnTeteCard.tsx`
(`pourControleDateHeure`) la compose à partir des composantes **locales** de `Date` — un `slice` de
la chaîne ISO décalerait toute échéance de l'écart de fuseau, et quatre cas unitaires le figent.

**Comportement laissé inchangé, et deux issues sont possibles.** La première est de n'en rien faire :
l'utilisateur réel voit le format de **son** navigateur, ce qui est le comportement attendu d'un
contrôle natif. La seconde est de remplacer le contrôle natif par une saisie composée, ce qui
demanderait un composant de date au design system — que personne n'a spécifié, et dont
`docs/DESIGN_SYSTEM.md` §5.7 ne dit rien. **Arbitrage attendu du responsable** : la seconde issue
dépasse `CRM-040` et vaudrait pour tout contrôle de date du produit.

**Conséquence pour les captures** : celles produites par le harnais montreront ce gabarit américain
tant que la locale de Chromium n'est pas fixée. Ce n'est pas un défaut du produit, et une capture
qui le montre n'est pas fausse — elle montre le harnais.

**L'ÉCART PRÉEXISTE À LA TRANCHE QUI L'A FAIT VOIR, et la ligne de base est établie sans `git
stash`.** En regardant `docs/captures/CRM-040/entete-card-xl-1440.jpg`, le champ « Date de signature
prévue » du **formulaire** — livré par `CRM-037`, `webapp/src/app/FormulaireCard.tsx`, et étranger à
cette tranche — porte exactement le même gabarit `mm/dd/yyyy`. Le contrôle d'échéance de l'en-tête
n'a donc rien introduit : il a rendu visible un comportement que le produit portait déjà partout où
il emploie un contrôle de date natif. L'arbitrage attendu porte en conséquence sur **tous** ces
contrôles, non sur le seul champ de `CRM-040`.

## Consignés le 2026-08-16 — deux constats du harnais, étrangers à `CRM-040`

Les deux sont rendus par `scripts/verify-cards.sh`, le harnais de l'unité, exécuté en fin de
session. Aucun des deux n'est imputable à la tranche livrée — l'en-tête de la fiche est en
**lecture** et n'écrit rien. Le comportement est laissé inchangé.

### INC-132 — `verify-cards.sh` attend quatorze cards, et le seed en pose quinze

**Mesuré le 2026-08-16**, sur la base fraîchement seedée par `supabase/seed/apply-seed.sh` :

```
ECHEC état du seed : « 15/1/1/15 », attendu « 14/1/1/14 »
```

Le contrôle du §8 du harnais (`scripts/verify-cards.sh:459`) fige `14/1/1/14`. **Le seed pose
quinze cards** : `…00c1` à `…00cf`, les quinze identifiants étant présents dans
`supabase/seed/apply-seed.sh` et les quinze lignes en base, toutes créées à l'exécution du seed —
aucune n'est le résidu d'une preuve.

**Ce n'est donc pas une pollution de la base, c'est un compteur qui a dérivé.** La quinzième est
`…00cf` « Reprise du dossier Marchand », l'affaire née en corbeille que `docs/SPEC-seed.md` §10.4 bis
décrit et que `CRM-077` a ajoutée : le seed a grandi, le harnais qui le vérifie est resté à son
compte d'avant. C'est la forme d'INC-125 — un garde-fou dont le nombre n'a pas suivi ce qu'il
compte —, appliquée cette fois au seed lui-même.

**Ce que la dérive coûte** : le contrôle échoue à chaque exécution, et un harnais qui rend toujours
un rouge connu cesse d'être lu. Il ne dit d'ailleurs plus rien de ce qu'il prétend vérifier : la
convergence du seed, elle, est bonne — une archivée, une en corbeille, quinze adresses distinctes.

**Non corrigé** : `scripts/verify-cards.sh` est un livrable de `CRM-040`, mais le nombre attendu est
un **contrat de seed** que `docs/SPEC-seed.md` porte, et le relever au passage reviendrait à
ajuster un garde-fou pour le verdir sans que personne n'ait vérifié que quinze est bien le compte
dû. Arbitrage attendu : porter le compteur à quinze, ou nommer la quinzième card comme un écart.

### INC-133 — `npm run e2e:api` échoue DANS `verify-cards.sh` et passe seul, deux fois de suite

**Mesuré le 2026-08-16**, dans l'ordre :

```
npm run e2e:api  (seul)                → 635 passed
scripts/verify-cards.sh (1re exécution) → 46 contrôles, 1 en échec — e2e:api OK
scripts/verify-cards.sh (2e exécution)  → 46 contrôles, 2 en échec — ECHEC npm run e2e:api
npm run e2e:api  (seul, après)          → 635 passed
```

La suite passe **avant** et **après** le harnais, et échoue **pendant** — et pas à chaque fois.
Le harnais dégrade volontairement la base pour éprouver ses trois refus, puis restaure ; la suite
d'API qu'il enchaîne tombe donc dans une fenêtre où l'état n'est pas celui que ses scénarios
supposent, ou dans une restauration incomplète.

**C'est la forme d'INC-129**, déjà consignée sur un autre harnais : une preuve dont le verdict
dépend de ce qu'un autre contrôle a laissé derrière lui. La différence, et elle aggrave le cas, est
que celui-ci est **intermittent** : un rouge qui ne se reproduit pas à l'identique ne peut pas
servir de mesure.

**Une troisième exécution, le même jour, rend `e2e:api` VERT dans le harnais** — 46 contrôles, 1 en
échec, celui d'INC-132 seul. L'intermittence est donc confirmée dans les deux sens : la suite passe
parfois pendant le harnais, et échoue parfois. Un rouge qui n'est pas reproductible ne peut servir
ni de mesure, ni de garde.

**Ce que ce constat NE dit PAS** : que le produit soit en défaut. Les 635 scénarios passent sur la
base réelle, deux fois, encadrant le harnais. **Non corrigé** : diagnostiquer une intermittence
demande d'instrumenter la séquence de dégradation et de restauration du harnais, ce qui dépasse la
tranche autorisée. Arbitrage attendu.

## Consigné le 2026-08-16 — un constat observé sur une capture de `CRM-037`

### INC-134 — « Requis pour passer à Signature » s'affiche sur une affaire DÉJÀ à l'étape Signature

**Observé le 2026-08-16** sur `docs/captures/CRM-037/parcours-saisie-session-reelle-1440.jpg`,
produite par le parcours enchaîné sur session réelle, avec le jeton de l'administratrice.

La card support est à l'étape **Signature**. Son formulaire rend trois champs `required` par la
règle d'étape — `budget`, `date-signature-prevue`, `decideur-identifie` — et chacun porte la
mention :

```
Requis pour passer à Signature
```

L'affaire **est** à Signature. La mention lui demande donc de « passer à » l'étape où elle se
trouve déjà, ce qui n'est pas faux au sens de la règle — le champ est bien requis à cette étape —
mais dit à l'utilisateur le contraire de sa situation.

**Ce que ce constat ne dit PAS.** Ni la règle, ni la garde, ni la validation ne sont en défaut :
`move_card` n'a jamais exigé ces trois champs pour la transition mesurée, et le parcours enchaîné
le prouve — le seul champ qui bloque est `lien-proposition`, exigé par la **transition**. C'est un
énoncé d'interface, et lui seul.

**Non corrigé.** La mention est engendrée par le §4.5 de `docs/SPEC-form-composer.md`, et son texte
exact est figé par des tests unitaires de composant écrits par la tranche de rendu de `CRM-037`.
La corriger suppose de trancher ce qu'elle doit dire quand l'étape exigeante est l'étape courante —
« Requis à cette étape » ? le silence ? — puis de réviser les preuves qui la figent, ce qui dépasse
la tranche autorisée ici. Le comportement est laissé **inchangé**. Arbitrage attendu.

## Consigné le 2026-08-16 — un constat de preuve, étranger à `CRM-037`

### INC-135 — la preuve S3 de `mail-sync` juge l'HISTORIQUE COMPLET du conteneur, et un seul avertissement transitoire la condamne jusqu'à recréation

**Mesuré le 2026-08-16**, pile debout et seedée, pendant la campagne de fin de session.
`npm run e2e:mail` rend **41 passés, 1 en échec** :

```
S3 — la console opérationnelle reste silencieuse
  Expected value: "WARNING"   Received array: ["DEBUG", "INFO"]
```

La ligne fautive est unique dans tout le journal du conteneur :

```
{"timestamp":"2026-08-16T12:45:52.445Z","level":"WARNING","service":"mail-sync","event":"veille_compte_echoue"}
```

**Le mécanisme est mesuré dans les deux sens, et c'est lui qui importe.** La preuve lit
`docker logs p2enjoy-mail-sync`, c'est-à-dire **tout** ce que le conteneur a émis depuis sa
création, et non l'état courant du service :

| Geste | Mesuré |
|---|---|
| `npm run e2e:mail` sur un conteneur ayant émis un `WARNING` plus tôt | **1 en échec**, reproduit une seconde fois à l'identique |
| `docker compose up -d --force-recreate mail-sync`, journal vidé (`0` `WARNING`) | S3 seul : **1 passé** |

Un incident **transitoire** — ici une relève d'un compte entrant qui a échoué une fois pendant que
les scénarios voisins manipulaient les mêmes boîtes — condamne donc S3 pour **toute la durée de vie
du conteneur**, y compris pour des exécutions ultérieures qui n'ont plus rien à voir. La preuve ne
mesure plus « la console reste silencieuse », mais « aucun incident n'a eu lieu depuis le dernier
`docker compose up` ».

**Un second fait, trouvé en cherchant la cause.** La ligne d'avertissement ne porte **ni**
`account_id`, **ni** `panne`, alors que `mail-sync/src/mail_sync/veille.py:180` passe les deux au
journal. L'avertissement est donc, en l'état, **indiagnosticable** : il dit qu'une relève a échoué,
jamais laquelle ni pourquoi.

**Étranger à `CRM-037`.** Ligne de base établie sans `git stash`, par inspection du diff : la
session ne touche **aucun** fichier de `mail-sync/` ni de `e2e/mail/` — son diff est fait de
`docs/`, de `CHANGELOG.md`, d'un fichier de `e2e/ui/` et de captures —, et `git log` ne montre
aucun commit sur ces deux répertoires ce jour-là.

**Non corrigé.** `e2e/mail/mail-sync.spec.ts` est un livrable de `CRM-051`, complété par `CRM-059`,
et les deux corrections possibles supposent un arbitrage : borner la lecture du journal à la fenêtre
du scénario — ce qui affaiblit la preuve —, ou tenir l'avertissement pour un défaut réel à
corriger dans la veille — ce qui suppose d'abord de savoir laquelle des relèves échoue, donc de
réparer les champs manquants du journal. Comportement laissé **inchangé**. Arbitrage attendu.

**Complément mesuré le même jour, et il désigne la CAUSE du `WARNING`.** Rejeu complet sur le
conteneur recréé : **40 passés, 2 en échec**, et le second échec est **en amont** de S3 —
`e2e/mail/ingestion.spec.ts:133`, « le message est ingéré, sa pièce infectée détectée » :

```
expect(premiere['messages_new']).toBeGreaterThanOrEqual(1)   Received: undefined
```

La relève n'a rien rapporté, la veille a donc journalisé son `veille_compte_echoue`, et S3 — qui
lit tout l'historique — est tombé **par conséquence**. Les deux échecs n'en font qu'un : une
intermittence de l'ingestion, et une preuve qui la propage à une seconde. Le premier rejeu de la
journée avait vu l'inverse — ingestion **verte** et S3 rouge sur un `WARNING` plus ancien —, ce qui
confirme l'intermittence dans les deux sens. **Cela renforce l'arbitrage demandé** : tant que S3
juge l'historique, elle transforme toute intermittence voisine en second rouge, et masque laquelle
des deux preuves a réellement quelque chose à dire.

## Consigné le 2026-08-16 — un constat d'environnement, étranger à `CRM-081`

### INC-136 — le dépôt d'un objet par l'API Storage rend `InvalidAccessKeyId` sur un cluster fraîchement créé

**Mesuré le 2026-08-16**, pile montée depuis zéro dans un conteneur neuf, seed appliqué.
`npm run e2e:api` rend **666 passés, 1 en échec**, et l'échec est le dépôt de la pièce jointe saine
de `e2e/api/inbox.spec.ts` §18.5 :

```
Error: {"statusCode":"403","error":"The Access Key Id you provided does not exist in our records.",
        "message":"InvalidAccessKeyId"}
expect(received).toContain(expected)
Received array: [200, 201]
```

Le refus vient de **MinIO**, non du produit : le service `storage` présente à MinIO une clé
d'accès que le cluster fraîchement créé ne connaît pas. Reproduit à l'identique en rejouant le seul
scénario.

**Étranger à `CRM-081`** : la tranche livrée ne touche ni `storage`, ni MinIO, ni `mail_attachments`
— elle porte sur `cards.snoozed_until`, ses deux RPC et un trigger de `card_events`. Aucun fichier
de `mail-sync/`, de `e2e/mail/` ni de la chaîne de stockage n'est modifié.

**Comportement laissé inchangé, et arbitrage demandé.** Deux lectures s'offrent, et aucune n'est
tranchée ici : soit les identifiants MinIO du service `storage` ne sont pas convergents à la
création du cluster — auquel cas c'est un défaut d'amorçage que `CRM-001` porterait —, soit la
preuve suppose un état de MinIO que ni `runDev.sh` ni le seed n'établissent, auquel cas c'est la
preuve qui doit poser son préalable. Le responsable tranche.

---

## Consigné le 2026-08-17 — un motif de spécification que la mesure contredit, `CRM-081` tranche 2 b

### INC-137 — le §16.12.2 écarte `now()` en affirmant qu'il n'est pas évalué ; Postgres l'évalue pourtant

**Mesuré le 2026-08-17**, pile montée et seedée, avec la clé de service.

`docs/SPEC-cards.md` §16.12.2 justifie l'envoi de l'instant du client comme valeur par cette
affirmation :

> PostgREST n'évalue aucune fonction dans un filtre : `snoozed_until=lte.now()` compare à la chaîne
> « now() », pas à l'heure du serveur.

La première moitié est exacte — PostgREST n'évalue rien —, mais la **conséquence est fausse** : la
chaîne est transmise à Postgres, dont l'analyseur de date accepte la valeur spéciale `now` et
tolère les parenthèses. Mesuré :

```
select 'now()'::timestamptz, 'now'::timestamptz, clock_timestamp();
 2026-08-17 15:39:35.138762+00 | 2026-08-17 15:39:35.138762+00 | 2026-08-17 15:39:35.139174+00
```

et par la route réelle, sur `channel_id=eq.…031` (`prospection`) :

| Requête | HTTP | Lignes |
|---|---|---|
| `or=(snoozed_until.is.null,snoozed_until.lte.now())` | `200` | 1 — l'endormie est bien écartée |
| `or=(snoozed_until.is.null,snoozed_until.lte.now)` | `200` | 1 — idem, sans les parenthèses |
| `snoozed_until=gt.now()` | `200` | 1 — la seule endormie, `+10 j` |

Autrement dit, le chemin que le §16.12.2 déclare impraticable **fonctionne**, et il se comporte
comme l'horloge du **serveur**. Le filtre du produit — l'instant du client envoyé comme valeur —
rend le même résultat au même instant, et reste donc correct : ce qui est en cause est son motif
écrit, pas son comportement.

**Ce que l'arbitrage changerait.** Le §16.12.2 assume une conséquence explicite : « une horloge de
poste décalée décale la frontière du sommeil d'autant ». Employer `now` la supprimerait, la
frontière devenant celle du serveur, au prix de faire dépendre le filtre d'une valeur spéciale de
l'analyseur de date de Postgres plutôt que d'un horodatage explicite — une dépendance qu'aucun type
généré ne documente, et qu'un changement de version pourrait retirer sans bruit.

**Comportement laissé inchangé, arbitrage demandé.** Trois lectures s'offrent, et aucune n'est
tranchée ici : corriger le seul motif du §16.12.2 en gardant l'instant du client ; basculer sur
`now` et retirer la conséquence assumée sur les horloges décalées ; ou conserver les deux chemins
en documentant lequel s'applique où. Le responsable tranche. La preuve
`e2e/api/filtre-sommeil.spec.ts` consigne la mesure sans affirmer le motif contesté.

---

## Consigné le 2026-08-17 — un contrôle de harnais dépassé par le produit, étranger à `CRM-081`

### INC-140 — Un changement de clé Vault rend le seed impossible, et fait échouer sept preuves pour un motif trompeur — **CLOSE**

**Nature :** défaut d'exploitation du seed ; symptôme observable très loin de sa cause.
**Relevé le :** 2026-08-14, en rejouant les preuves de `CRM-081` après un redémarrage de la pile.

**Ce qui a été observé, dans cet ordre.** Sept scénarios sur vingt-cinq échouaient dans
`e2e/ui/filtre-sommeil.spec.ts`, `sommeil-card.spec.ts` et `menu-sommeil-board.spec.ts` — tous ceux
qui dépendent d'une affaire endormie **du seed**. Le nombre d'échecs et leur dispersion sur trois
fichiers désignaient un état de données, non un défaut de code.

**La cause, deux niveaux plus bas.** `supabase/seed/apply-seed.sh` échouait à la configuration du
compte entrant système : `{"code":"22000","message":"pgsodium_crypto_aead_det_decrypt_by_id:
invalid ciphertext"}`. Six secrets subsistaient dans `vault.secrets`, chiffrés sous une clé racine
que la pile ne possède plus — elle vit hors de `PGDATA` (`CRM-052` §13.3) et a été régénérée au
redémarrage. `upsert_mail_inbound_account` déchiffre pour comparer, échoue, et le seed s'arrête.
**Le seed n'ayant pas abouti, les affaires endormies n'existaient pas**, et sept preuves rouges
accusaient le sommeil pour une faute de Vault.

**Ce qui a été fait, et qui n'est pas la correction.** Les six secrets indéchiffrables ont été
supprimés, le seed rejoué — il passe —, puis les trois suites : **25 scénarios, aucun échec**. C'est
une réparation manuelle de l'environnement, pas un correctif.

**Ce qui reste dû.** Le seed doit reconnaître ce cas et s'en remettre lui-même : un secret
indéchiffrable est un secret perdu, et le recréer est le seul geste utile. Aujourd'hui l'exploitant
lit un message de pgsodium à travers PostgREST, sans lien apparent avec la clé racine — la « valeur
par défaut trompeuse » que `CLAUDE.md` §18 proscrit, transposée à un message d'erreur. La correction
appartient à `CRM-052`, qui porte l'écriture de ces secrets.

**Portée réelle.** Toute recréation de la pile reproduit le défaut, et il faut le savoir avant
d'accuser une unité de messagerie ou de sommeil de ses propres preuves rouges. À rapprocher
d'INC-139, relevée le même jour : deux preuves rouges, deux causes étrangères à l'unité accusée.

### INC-141 — `verify-colonnes-protegees.sh` compte QUINZE cards seedées ; le seed en porte quarante et une

**Mesuré le 2026-08-17**, `scripts/verify-colonnes-protegees.sh` : **50 contrôles, 8 en échec**.
Ce harnais n'avait pas été rejoué depuis deux sessions, faute de budget ; il l'est ici, et son
verdict ne dit rien du produit.

```
ECHEC  la suite pgTAP signale au moins une anomalie
ECHEC  le nombre de cards seedées a changé : une sonde n'a pas été nettoyée
ECHEC  des adresses seedées se répètent
ECHEC  au moins une adresse seedée n'a pas la forme générée
ECHEC  mail_inbound_accounts EXISTE désormais : la protection de colonne de CRM-013 doit être écrite
ECHEC  mail_outbound_identities EXISTE désormais : la protection de colonne de CRM-013 doit être écrite
ECHEC  npm run test:sql
ECHEC  npm run e2e:api
```

**TROIS COMPTEURS FIGÉS À QUINZE, LÀ OÙ LE SEED EN PORTE QUARANTE ET UNE.** Le harnais écrit, à sa
section 6 (« Le seed, inchangé ») :

```
select count(*) from public.cards where id::text like '5eed%';   attendu : 15
```

MESURÉ le 2026-08-17 sur la pile réelle :

```
count(*)                        = 41
count(distinct email_local_part) = 41
```

Le commentaire du harnais date sa valeur : « QUINZE DEPUIS `CRM-077`, cinquième tranche ». Le seed a
grandi depuis, et les trois contrôles ne l'ont pas suivi. Ce sont des **compteurs figés** au sens de
la décision 51, de la même famille qu'INC-132 — la suite pgTAP `0015_colonnes_protegees.test.sql`,
elle, dit bien « les quarante et une cards du seed », et elle est verte.

**Les deux lignes `mail_*` nomment leur propre unité** : « la protection de colonne de `CRM-013`
doit être écrite ». Les deux tables ont été livrées depuis par le sous-système de messagerie, et le
contrôle attend une protection qu'aucune unité n'a encore écrite. C'est une tâche due, pas une
régression.

**Les deux dernières lignes ne disent rien non plus**, et c'est mesurable : rejouées **seules**, à
la fin de la même session et sur la même pile,

```
npm run test:sql   42 fichiers, 2191 assertions, aucune anomalie
npm run e2e:api    678 scénarios, tous verts
```

Le harnais les lance après ses propres dégradations et sa sonde `tst-crm013-harnais` ; une sonde
encore présente porte le compte des cards à 42, et `0015_colonnes_protegees.test.sql` — qui, lui,
attend 41 — rougit alors pour la sonde du harnais, non pour le produit.

**Étranger à `CRM-081` tranche 2 d** : la tranche ne touche que `Board.tsx`, `board.ts`,
`components/ui/Sommeil.tsx`, `EnTeteCard.tsx`, l'i18n et leurs preuves. Elle ne modifie aucun
privilège de colonne, aucune table de messagerie et aucune donnée du seed.

**Réserve honnête** : la ligne de base par restauration du code d'avant n'a **pas** été établie sur
ce harnais, faute de temps — elle l'a été sur `verify-board.sh` (INC-139). L'attribution ci-dessus
repose donc sur la mesure directe des compteurs et sur le verdict vert des deux suites rejouées
seules, non sur une comparaison avant/après.

**Arbitrage demandé** : les trois compteurs figés doivent-ils être portés à 41, ou remplacés par
une propriété qui ne dépend pas du volume du seed — la leçon que la tranche 2 a avait déjà tirée
pour ses suites pgTAP ?
**CLOSE LE 2026-08-14 — et la correction a révélé une SECONDE panne, plus traîtresse que la
première.** `upsert_mail_inbound_account` et `upsert_mail_outbound_identity` recréent désormais un
secret devenu illisible. Mais en éprouvant cette reprise, un autre cas est apparu : lorsque le
secret n'existe **plus du tout** alors que la ligne du compte garde son identifiant,
`vault.update_secret` ne lève **rien** — elle met à jour zéro ligne et rend la main. MESURÉ : après
une purge de `vault.secrets`, le seed se déclarait **réussi** tandis que les trois comptes portaient
un `secret_id` pendant ; la relève aurait échoué en `credentials_missing` sans que rien n'explique
pourquoi. **Un succès silencieux est pire qu'une erreur.**

La garde est donc **positive** : on ne se fie pas à l'absence d'exception, on constate que le secret
existe. Vérifié de bout en bout — seed rejoué sur une base sans aucun secret : **3 secrets recréés,
0 identifiant pendant**, et la relève ouvre une **vraie session IMAP** avec le secret recréé
(`folders: 2`, aucune erreur).

### INC-139 — `verify-board.sh` complet : trois contrôles de plus rendent rouge, tous préexistants

**Mesuré le 2026-08-17**, `scripts/verify-board.sh` **complet** — et non `--rapide`, seul mode que
INC-138 avait exercé : **56 contrôles, 4 en échec**.

```
ECHEC  les channels sont lus à plusieurs endroits : les lectures divergeront
ECHEC  des classes citées n'existent pas dans le CSS produit
ECHEC  dégradation « un refus inconnu est absorbé (CLAUDE.md §18 nié) » impossible :
       motif introuvable dans webapp/src/lib/board.ts
ECHEC  COMPLAISANT : « le retour arrière disparaît après un refus (§7.9 nié) » et les
       tests unitaires restent verts
```

Le premier est **INC-138**, déjà consignée. Les trois autres n'apparaissent qu'en mode complet, et
sont consignés ici.

**LIGNE DE BASE ÉTABLIE, ET C'EST CE QUI TRANCHE** (`docs/CloudWorker.md` §2.4). Le code de la
session a été temporairement remplacé par celui du commit `f85fc3e` — l'état d'avant la première
ligne de code de la tranche 2 d — et le harnais rejoué sur cette base :

```
56 contrôles, 4 en échec.   (les MÊMES quatre, mot pour mot)
```

Les quatre anomalies sont donc **préexistantes et étrangères** à `CRM-081` tranche 2 d. Le
comportement est laissé inchangé.

**Ce que chacune paraît dire**, sans que cette session ne tranche :

- *les classes citées absentes du CSS produit* : le harnais compare les classes utilitaires écrites
  dans les composants du board à celles que la feuille construite contient. Le mécanisme de
  génération à la demande de Tailwind ne produit que les classes rencontrées ; un écart tient soit à
  une classe réellement morte, soit à un contrôle qui lit la feuille avant sa construction complète.
  Le fichier de détail est écrit dans un répertoire temporaire effacé en fin d'exécution, ce qui
  rend l'anomalie difficile à instruire — c'est en soi un défaut du harnais ;
- *dégradation impossible, motif introuvable* : le harnais cherche dans `webapp/src/lib/board.ts` un
  motif de code qu'il sait dégrader pour éprouver qu'une preuve n'est pas complaisante. Le motif n'y
  est plus sous la forme attendue. La dégradation ne s'exécute donc pas, et le contrôle ne prouve
  rien — ni dans un sens, ni dans l'autre ;
- *contrôle complaisant sur le retour arrière* : la dégradation, elle, s'exécute, et les tests
  unitaires restent **verts** alors qu'ils devraient rougir. C'est la plus sérieuse des trois : elle
  dit qu'aucune preuve unitaire n'éprouve réellement le retour arrière exact du §7.9. La preuve
  existe pourtant (`Board.test.tsx`), ce qui suggère que la dégradation ne frappe plus le code
  qu'elle visait.

**Arbitrage demandé** : ces trois contrôles portent sur des unités antérieures (`CRM-041`) et les
corriger reviendrait à solder une autre unité que celle de la session (`CLAUDE.md` §13). La
troisième mérite d'être instruite en priorité, une preuve complaisante valant moins que pas de
preuve du tout.

### INC-138 — `verify-board.sh` exige que les channels ne soient lus qu'à UN endroit ; ils le sont à quatre

**Mesuré le 2026-08-17**, `scripts/verify-board.sh --rapide` : **31 contrôles, 1 en échec**.

```
ECHEC  les channels sont lus à plusieurs endroits : les lectures divergeront
```

Le contrôle est écrit ainsi (`scripts/verify-board.sh`, ligne 147) :

```
if [ "$(grep -rl "from('channels')" webapp/src | wc -l)" -eq 1 ]; then
```

Il exige **exactement un** fichier lecteur, au nom du §5.4 de `docs/SPEC-channels.md` et des
décisions 167 et 169 — « deux définitions de « channel non archivé » finiraient par diverger ». Or
le produit en compte quatre :

```
webapp/src/lib/channels.ts                      (le lecteur d'origine)
webapp/src/lib/inbox.ts                         (CRM-060 et suivantes)
webapp/src/lib/corbeille.ts                     (CRM-070)
webapp/src/lib/administration-arborescence.ts   (CRM-080)
```

Les trois autres ont été livrées par des unités postérieures au contrôle, chacune avec ses propres
preuves. Le contrôle n'a pas suivi : il compte des **fichiers**, là où la règle qu'il prétend tenir
porte sur la **définition** de « channel non archivé ».

**Étranger à `CRM-081` tranche 2 b** : aucun des quatre fichiers n'est modifié par cette session —
`git diff 3da6eeb..HEAD` ne les nomme pas. La tranche touche `Board.tsx`, `ListeCards.tsx`,
`RouteTrack.tsx`, `board.ts`, `components/ui/Sommeil.tsx`, l'i18n et leurs preuves, et ne lit aucun
channel. La ligne de base n'a donc pas eu besoin d'être établie par `git stash` : la preuve est
directe.

**Comportement laissé inchangé, arbitrage demandé.** Trois lectures s'offrent, et aucune n'est
tranchée ici : porter le compte attendu à quatre — ce qui reproduit le défaut des compteurs figés
déjà consigné pour `verify-harness.sh` et `verify-preuves-refus.sh` ; remplacer le compte par un
contrôle de la **définition** — que les quatre lecteurs partagent le même prédicat d'archivage, ce
qui est la règle réellement voulue ; ou reconnaître que le §5.4 a été dépassé par
`CRM-060`/`CRM-070`/`CRM-080` et le réviser. Le responsable tranche.

### INC-163 — deux suites pgTAP comptent un seed qui a grandi depuis qu'elles ont été écrites

**Nature :** même famille qu'INC-162, sur une autre surface. Deux fichiers de `supabase/tests/`
figent un **compte de lignes du seed** ; le seed a été enrichi après leur écriture, et les compteurs
n'ont pas été révisés dans le même changement. Les suites rougissent donc sur une **dérive de
compteur**, pas sur un défaut du produit — aucune assertion de *comportement* n'échoue.

**Mesure, 2026-08-19, sur la pile seedée de cette session :**

```
npm run test:sql
  ECHEC supabase/tests/0015_colonnes_protegees.test.sql — 3 assertions en échec sur 41
        not ok 33 - les quarante et une cards du seed sont intactes
        not ok 34 - et leurs quarante et une adresses ont toujours la forme générée
        not ok 35 - quarante et une adresses DISTINCTES
  ECHEC supabase/tests/0034_previsualisation_exigence.test.sql — 1 assertion en échec sur 10
        not ok 5 - `date-signature-prevue` × `Prospection` : 11 sur place, 0 à l'entrée
  45 fichiers, 2 en échec.
```

**Le compte réel, relevé sur la pile :** `GET /rest/v1/cards?select=id` rend **42** lignes, et les
quarante-deux portent un identifiant du seed (`5eed…`), toutes créées à la même seconde par
`apply-seed.sh`. Il ne s'agit donc pas d'une sonde oubliée par une suite interrompue : **c'est le
seed lui-même qui produit quarante-deux cards** là où la preuve en attend quarante et une.

**L'ordre des changements est établi, pas supposé.** `git log -S "quarante et une cards"` désigne
`bf61359` (`CRM-060` tranche **4c**) comme l'auteur du compteur, et
`git log -- supabase/seed/apply-seed.sh` désigne `7452bc1` (`CRM-060` tranche **4d**) comme dernier
changement du seed — **postérieur**. La tranche 4d a enrichi le seed sans réviser ces deux suites.

**Étrangère à l'unité de la session.** `CRM-060` sous-tranche **4h** ne modifie **ni le seed, ni
aucune migration, ni aucun fichier de `supabase/`**, et c'est vérifié plutôt que supposé :
`git log --name-only -- supabase/` sur les commits de la session ne rend **rien**. La sous-tranche
n'ajoute aucune card et n'en retire aucune ; ses sondes sont des **contacts** et des
**rattachements**, tous détruits, le seed étant relu intact par un scénario dédié. Le comportement
est laissé **inchangé**.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** comme pour INC-162, deux
réponses sont défendables — porter les compteurs au nouvel état du seed, ou rendre ces assertions
**relatives** plutôt qu'absolues, afin qu'un seed qui grandit ne les casse plus. La seconde change
ce que la preuve prouve, et ce choix appartient à l'unité qui possède ces suites. Le trancher au
passage serait corriger un défaut étranger à l'unité autorisée (`CLAUDE.md` §5,
`docs/CloudWorker.md` §3.1).

### INC-164 — l'annexe A du manuel fige deux comptes d'un seed qui a grandi depuis qu'elle a été écrite

**Nature :** troisième porteur de la famille d'INC-162 et d'INC-163, sur une **troisième** surface.
`docs/manual.md` annexe A énumère des comptes du jeu de démonstration ; deux d'entre eux ont été
figés avant l'enrichissement du seed, et n'ont pas été révisés dans le même changement.
`scripts/verify-manual.sh` compare l'annexe à la base et rougit donc sur une **dérive de compteur**,
non sur un défaut du produit — aucun contrôle de *comportement* n'échoue, et les quinze autres
comptes de l'annexe sont **justes**.

**Mesure, 2026-08-19, sur la pile seedée de cette session :**

```
scripts/verify-manual.sh
  ECHEC annexe A : Questions du formulaire actives — le manuel dit « 12 », la base dit « 16 »
  ECHEC annexe A : Réponses de formulaire        — le manuel dit « 21 », la base dit « 23 »
  OK    annexe A : Questions du formulaire retirées = 2
  OK    annexe A : Affaires = 41    Affaires actives = 39    Commentaires = 5
  => 123 contrôles, 2 anomalie(s)
```

**Les deux comptes portent sur `form_fields` et `form_field_values`**, que `CRM-046` puis la
sous-tranche 4d de `CRM-060` ont enrichis — `docs/SPEC-seed.md` §9.11 annonce d'ailleurs
« VINGT-SEPT actives » pour `maintenance`, et `apply-seed.sh` rend « 23 sur 11 cards » pour les
valeurs. L'annexe est restée sur l'état antérieur.

**Étranger à la sous-tranche `CRM-060` 4j, et c'est vérifié plutôt que supposé :** cette
sous-tranche **ne touche ni `form_fields`, ni `form_field_values`, ni le seed, ni aucun fichier de
`supabase/`** — elle exerce `card_contacts_maj`, dont les sondes sont des rattachements détruits
ensuite, le seed étant relu intact par un scénario dédié. Elle modifie `docs/manual.md` aux
chapitres **3 ter** et **4.7 ter**, jamais l'annexe A. Le comportement est laissé **inchangé**.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** deux réponses sont
défendables, comme pour INC-162 et INC-163 — porter l'annexe au nouvel état du seed, ou faire
dériver ces deux lignes de la base au lieu de les figer, ce qui change ce que le manuel *est*. Ce
choix appartient à l'unité qui possède l'annexe et le seed. Le trancher au passage serait corriger
un défaut étranger à l'unité autorisée (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.1).

### INC-165 — la tranche 2 c de `CRM-081` a livré trois objets de base SANS régénérer le contrat de types

**Nature :** défaut de **procédure**, découvert par la tranche 2 e et corrigé par elle parce qu'il
la **bloquait** (`docs/CloudWorker.md` §4.2, second cas : « elle bloque concrètement l'unité produit
choisie »). Il est consigné ici non pour être retraité, mais parce que la DoD commune du
`docs/MASTER_PLAN.md` §4 exige les types à jour et que la tranche 2 c a pourtant été portée close
sans eux — c'est la règle qui n'a pas été appliquée, pas le produit qui est faux.

**Mesure, 2026-08-19, avant correction :**

```
npm run typecheck
  webapp/src/lib/sommeil-fil.ts: error TS2345:
    Argument of type '"mail_thread_snoozes"' is not assignable to parameter of type '"workflow_derivations"'
  webapp/src/lib/sommeil-fil.ts: error TS2345:
    Argument of type '"snooze_thread"' is not assignable to parameter of type '… | "wake_card"'
  webapp/src/lib/sommeil-fil.ts: error TS2345:
    Argument of type '"wake_thread"' is not assignable to parameter of type '… | "wake_card"'

npm run types:generate  =>  63 lignes ajoutées à webapp/src/lib/database.types.ts
```

**Ce que cela signifie, exactement :** `supabase/migrations/0048_snooze_fils.sql` a livré la table
`public.mail_thread_snoozes` et les deux RPC `snooze_thread` / `wake_thread`, tous trois **absents**
de `database.types.ts`. Aucun écran ne pouvait donc les appeler : la tranche 2 c a livré une règle
que le client ne savait pas nommer. Ce n'est pas un défaut de comportement — la base était juste, et
`e2e/api/snooze-fils.spec.ts` le prouvait en HTTP, hors du typage.

**Corrigé dans la tranche 2 e**, avec les deux témoins figés révisés et leurs motifs écrits dans
`database.types.test-d.ts` : trente-quatre fonctions deviennent **trente-six**, et la liste des
tables accueille `mail_thread_snoozes`.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** la question n'est pas
celle de ce changement-ci, mais celle du **contrôle** qui aurait dû l'attraper. `npm run types:check`
existe et `scripts/verify-types.sh` rend **30 contrôles sans anomalie** — mais ni l'un ni l'autre
n'est exécuté dans un enchaînement qui **échouerait** au moment où une migration livre un objet non
régénéré : la campagne de fin de session les exécute lorsqu'elle en a le temps, et la tranche 2 c ne
les a pas exécutés. Deux réponses sont défendables — porter `types:check` dans la Definition of Done
mécaniquement vérifiée de toute unité livrant une migration, ou l'ajouter à un contrôle de
pré-commit —, et le choix appartient au responsable.

### INC-166 — `administration-workflows.spec.ts` expire dans sa purge de champs, et c'est PRÉEXISTANT

**Nature :** anomalie de **harnais**, étrangère à `CRM-081` tranche 2 e, et établie comme telle par
une **ligne de base** au sens du §2.4 de `docs/CloudWorker.md` plutôt que supposée.

**Mesure, 2026-08-19, campagne de fin de session :**

```
npm run e2e:ui  =>  440 passed, 3 failed
  administration-workflows.spec.ts:1116 « les deux gestes se mènent au clavier seul »
    Test timeout of 30000ms exceeded.
    Error: apiRequestContext.get: Target page, context or browser has been closed
      at purgerChamps (e2e/ui/administration-workflows.spec.ts:681)
```

Les deux autres échecs étaient **imputables à la tranche** — le compte de refus `401` de l'inbox,
révisé dans `manuel.spec.ts` et `coquille.spec.ts` avec son motif — et sont corrigés. Celui-ci ne
l'est pas.

**La ligne de base, EXÉCUTÉE et non supposée :**

```
git checkout a6bed51 -- webapp/ e2e/      # le code d'AVANT la session
npx playwright test … -g "les deux gestes se mènent au clavier seul"
  => 1 failed, 1 passed   (le MÊME échec, au MÊME endroit)
git checkout HEAD -- webapp/ e2e/
```

L'anomalie est donc présente **des deux côtés** : elle est préexistante et ne s'explique pas par la
tranche. Le diff de la session ne touche d'ailleurs ni `form_fields`, ni `card_field_values`, ni
aucun écran d'administration — il est confiné à l'inbox, au module de sommeil de fil, au contrat de
types et à la documentation.

**Ce que la mesure dit du défaut :** l'échec tombe dans `purgerChamps`, une fonction de **nettoyage**
qui lit puis supprime les champs de preuve un par un. Le scénario expire à trente secondes pendant
cette purge, et le message `Target page … has been closed` est la **conséquence** de l'expiration,
non sa cause : le contexte est fermé par Playwright quand le test rend la main. Le geste éprouvé,
lui, s'est déroulé — c'est la remise en état qui n'a pas tenu dans le budget.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** deux réponses sont
défendables — purger en **une** requête `in.(…)` au lieu d'une boucle de suppressions séquentielles,
ou porter le budget de ce scénario au-delà de trente secondes —, et la première change un fichier de
preuve qui n'appartient pas à cette unité (`CLAUDE.md` §13). Le comportement est laissé **inchangé**.

**REMESURÉ le 2026-08-19 par `CRM-083` tranche 2b-1, et la mesure APPREND quelque chose de neuf :
ce scénario est à la LIMITE de son budget, il ne le dépasse pas franchement.** Quatre exécutions,
deux de chaque côté du `git checkout` de la ligne de base :

```
arbre courant   =>  34,6 s  puis  35,2 s   (échec)
ligne de base   =>  29,3 s  puis  34,8 s  puis  36,0 s   (un succès, deux échecs)
```

Le premier passage de la ligne de base, à **29,3 s**, avait laissé croire un instant à une
régression : il est en réalité le seul des cinq à être passé sous les trente secondes. L'anomalie
est donc bien présente des deux côtés, et l'écart entre un verdict vert et un verdict rouge tient
ici à **moins d'une seconde de charge de la machine** — ce qui explique qu'une session le voie et
que la suivante ne le voie pas. C'est un argument de plus en faveur de la première des deux
réponses ci-dessus : porter le budget déplacerait la limite sans supprimer la boucle qui l'atteint.
Le comportement reste **inchangé**, et l'arbitrage reste dû.

## Consigné le 2026-08-19 — un constat d'environnement, étranger à `CRM-081` tranche 2 f

### INC-167 — le stockage objet refuse la clé d'accès, et trois preuves de pièces jointes en meurent

**Statut : ouvert.** Constaté pendant la campagne de fin de session de `CRM-081` tranche 2 f.
**Préexistant et étranger à l'unité, ligne de base EXÉCUTÉE.**

**Ce qui est mesuré.** Trois preuves rougissent, et toutes trois sur des **pièces jointes** :

```
e2e/api/inbox.spec.ts:159   « clean se télécharge, infected, pending et skipped non »
  => {"statusCode":"403","error":"The Access Key Id you provided does not exist in our
      records.","message":"InvalidAccessKeyId"}
     expect([200, 201]).toContain(400)   — le dépôt de la pièce de preuve REND 400

e2e/mail/ingestion.spec.ts:143  « le message est ingéré, sa pièce infectée détectée »
  => premiere['messages_new'] === undefined ; la relève rend 502
     journal mail-sync : {"event":"inbound_poll_write_failed"}

e2e/mail/mail-sync.spec.ts:220  « chaque ligne est un JSON borné, sans secret ni avertissement »
  => conséquence des lignes ERROR que le précédent vient d'écrire
```

**La cause est UNE, et elle est hors du produit** : le service de stockage refuse la clé d'accès
qu'on lui présente (`InvalidAccessKeyId`). Une preuve qui ne peut pas **déposer** une pièce ne peut
ni la télécharger, ni la faire analyser ; et une relève dont l'écriture de pièce échoue rend `502`
avec sa ligne `ERROR`, que la troisième preuve compte comme un avertissement. Les deux dernières
sont donc des **conséquences** de la première, non trois défauts distincts.

**La ligne de base, EXÉCUTÉE et non supposée** (`docs/CloudWorker.md` §2.4) :

```
# mail-sync reconstruit SANS la ligne du §16.16.2, puis :
npx playwright test --config e2e/playwright.config.ts --project=mail ingestion
  => 1 failed, 2 passed   (le MÊME échec, au MÊME endroit, au MÊME message)
# puis la ligne restaurée, image reconstruite, service sain
```

L'anomalie est donc présente **des deux côtés** : elle est préexistante et ne s'explique pas par la
tranche. Le diff de la session ne touche d'ailleurs ni le stockage, ni les pièces jointes, ni
l'antivirus — il est confiné au groupement de l'inbox, à la charge d'insertion d'un message, au seed
et à la documentation. Les deux scénarios d'ingestion qui ne portent **pas** de pièce jointe
passent, dont celui du classement automatique, qui emprunte pourtant le chemin d'écriture modifié.

**Ce qui reste à trancher, et pourquoi cette session ne le tranche pas :** la clé d'accès du
stockage est une donnée d'**environnement**, posée hors du dépôt. Deux réponses sont défendables —
régénérer les identifiants du service de stockage dans l'environnement de développement, ou faire
que la relève distingue un échec d'écriture de PIÈCE d'un échec d'écriture de MESSAGE, de sorte
qu'un stockage indisponible ne fasse plus perdre le message lui-même. La seconde est un changement
de comportement du sous-système de messagerie, étranger à `CRM-081` (`CLAUDE.md` §13). Le
comportement est laissé **inchangé**, et l'arbitrage revient au responsable.

### INC-168 — l'unicité du nom d'un tableau d'objectifs porte AUSSI sur les tableaux archivés

**Nature :** point de spécification **incomplet**, relevé en écrivant `CRM-082` et laissé
**inchangé** conformément au `CLAUDE.md` §5 — la correction dépasse la tâche autorisée, l'arbitrage
revient au responsable.

**Ce que la spécification dit.** `docs/SPEC-goals.md` §2.1 et `docs/SCHEMA.md` §9 bis.1 écrivent,
pour `goal_boards.name` : « non vide, unique par workspace **sur la forme normalisée** ». La
restriction n'est assortie d'aucune condition, et la migration 49 l'implémente donc telle quelle :

```
create unique index goal_boards_workspace_name_key
	on public.goal_boards (workspace_id, app.btrim_blancs(name));
```

**Ce qui rend ce point douteux, et pourquoi il n'est pas tranché ici.** Le même document impose que
« l'archivage tient lieu de suppression » (§2.1). Un tableau archivé continue donc d'occuper son nom,
et **un nom libéré par l'archivage reste pris** : archiver « Objectifs du trimestre » puis vouloir
en ouvrir un nouveau pour le trimestre suivant, sous le même nom, échoue avec
`duplicate key value violates unique constraint "goal_boards_workspace_name_key"`.

**La comparaison qui rend l'écart visible.** La spécification-sœur écrite le même jour tranche
l'exact contraire pour les budgets — `docs/SCHEMA.md` §9 bis.4 : « unique par track **parmi les
budgets non clôturés** (index partiel `where closed_at is null`) ». Deux objets voisins, spécifiés
dans la même journée, reçoivent donc deux règles opposées sur la même question. L'un des deux est
probablement un oubli de rédaction ; décider lequel n'appartient pas à l'agent.

**Mesure, 2026-08-19.** Le comportement est celui qui est écrit, et il est éprouvé : l'assertion 20
de `supabase/tests/0047_objectifs.test.sql` établit que `'  Tableau d'essai de la suite 0047  '`
entre en collision avec `'Tableau d'essai de la suite 0047'`. Aucune assertion ne porte sur le cas
archivé, précisément parce que la règle attendue n'est pas tranchée.

**Ce qu'il faudrait pour le corriger, si le responsable le décide :** remplacer l'index par sa forme
partielle `where archived_at is null`, dans une migration convergente, et réviser les deux documents
dans le même changement. Le coût est faible **aujourd'hui**, aucun écran ne créant encore de
tableau ; il croîtra dès que `CRM-083` sera livrée.

**Statut :** ouvert, en attente d'arbitrage. Le comportement reste celui de la spécification.

### INC-169 — un lien d'objectif détruit pour de bon ne se distingue pas d'un bloc jamais lié

**Nature :** point de spécification **impossible à tenir tel qu'il est écrit**, relevé en livrant la
tranche 1 de `CRM-083` et laissé **inchangé** conformément au `CLAUDE.md` §5.

**Ce que la spécification demande.** `docs/SPEC-goals.md` §5.4 :

| État | Rendu |
|---|---|
| Bloc lié à un channel **supprimé** (`channel_id` devenu nul) | le bloc est rendu sans pilule, et une mention « lien perdu » invite à en reposer un |

**Ce qui rend cet état indétectable.** Le §2.2 pose `on delete set null` sur `goal_blocks.channel_id`.
Une destruction réelle de la ligne `channels` remet donc la colonne à `null`, et **le bloc devient
alors, octet pour octet, un bloc qui n'a jamais été lié** : aucune colonne, aucun horodatage, aucune
trace ne les sépare. L'écran ne peut pas lever la mention sans la lever aussi pour les trois blocs
libres du seed, ce qui serait un mensonge.

**Ce que la tranche 1 fait à la place, et c'est mesuré.** `app.can_read_channel` (migration `0010`)
**ne regarde pas `deleted_at`** : un channel parti à la corbeille reste lisible, son bloc reste donc
rendu, et sa destination n'est plus atteignable par la navigation. C'est cet état-là — le seul qui
soit **détectable** — que l'écran rend « lien perdu », le §2.2 nommant d'ailleurs exactement ce
scénario (« un channel mis à la corbeille ne fait pas disparaître un objectif »). La destruction
définitive, elle, reste invisible.

**Ce qu'il faudrait pour tenir la lettre du §5.4**, et pourquoi ce n'est pas fait ici : conserver la
trace du lien rompu — une colonne `channel_lost_at`, ou un `channel_id` conservé sans clé étrangère
—, ce qui est un changement de **modèle** et relève de `CRM-082`, close, et non de l'écran.

**Statut :** ouvert, en attente d'arbitrage. Le comportement livré est celui décrit ci-dessus, écrit
dans `webapp/src/lib/objectifs.ts` et éprouvé par `objectifs.test.ts`.

## Consigné le 2026-08-19 — une contradiction entre deux documents, relevée par `CRM-083` tranche 2a

### INC-170 — l'état « lecture seule » d'un canevas d'objectifs contredit la règle « aucune commande éteinte d'avance »

**Nature :** contradiction entre deux documents du dépôt, relevée en livrant les premiers gestes
d'écriture du canevas et laissée **non tranchée** conformément au `CLAUDE.md` §5.

**Ce que la spécification de l'unité demande.** `docs/SPEC-goals.md` §5.4 :

| État | Rendu |
|---|---|
| Lecture seule (`viewer`) | tous les gestes d'écriture sont **indisponibles et lisibles**, et l'écran dit pourquoi |

Rendre un geste « indisponible » suppose que l'écran **sache d'avance** que l'appelant est un
`viewer`, donc qu'il lise son rôle et en déduise un droit.

**Ce que le design system pose, six fois et avec son motif.** `docs/DESIGN_SYSTEM.md` §5.3, §5.13,
§5.16, §5.21, §5.23, §5.25, §5.26, §5.27 et §5.28 écrivent tous la même règle : « aucune commande
n'est éteinte d'avance selon le rôle ». Le motif est constant et il est mesuré à chaque fois : la
règle réelle vit dans les politiques, un rôle ne la résume pas — le §5.27 rapporte même une lectrice
qui **réussit** un geste que son rôle laisserait croire interdit —, et une commande grisée fait
passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).

**Ce que la tranche 2a fait, et pourquoi.** Elle suit le design system : les commandes de pose et
les gestes de géométrie sont **offerts à tous**, l'écran envoie, et il **traduit** le refus du
backend — `403` / `42501` pour une insertion, « aucune ligne » pour une mise à jour filtrée par la
clause `using`. Aucune règle nouvelle n'est donc posée dans l'interface, et le comportement reste
celui que les politiques `goal_blocks_*` décident.

**Ce qui reste à arbitrer :** faut-il réviser le §5.4 de `docs/SPEC-goals.md` — qui est le seul
document du dépôt à demander une extinction par rôle —, ou bien poser au canevas un écart nommé au
design system ? La question n'est pas tranchée ici : elle porte sur une règle générale du produit,
et l'unité `CRM-083` garde en conséquence son point « état LECTURE SEULE du `viewer` » à `[ ]`.

**Statut :** ouvert, en attente d'arbitrage du responsable.

### INC-171 — `goals.block.resize` est une clé morte, et `i18n.test.ts` est rouge

**Nature :** défaut **préexistant à cette session**, relevé en rejouant les preuves après un rebase
et laissé **inchangé** conformément au `CLAUDE.md` §5 — il appartient à un changement livré par une
autre session, encore possiblement en cours.

**Ce qui est mesuré.** Sur `main`, `npm run test:unit` rend **1 échec sur 1818** :

```
FAIL  src/i18n/i18n.test.ts > dictionnaire > ne contient aucune clé morte
expected [ 'goals.block.resize' ] to deeply equal []
```

`webapp/src/i18n/fr.ts:481` déclare `'goals.block.resize': 'Redimensionner {titre}'`, qu'aucun
composant n'emploie.

**LA LIGNE DE BASE A ÉTÉ EXÉCUTÉE** (`docs/CloudWorker.md` §2.4), sur **cette preuve seule** : le
même échec tombe à l'identique sur `c1cd427` — « Objectifs : poser, déplacer et redimensionner un
bloc au canevas (CRM-083 tranche 2a) » —, commit d'une session **parallèle** livré pendant
celle-ci. Il ne vient donc pas du changement de cette session, qui ne touche pas à cette clé.

**Pourquoi il n'est pas corrigé ici.** La clé décrit un geste — redimensionner un bloc — que la
session voisine est en train de livrer ; la retirer prendrait le risque de défaire un travail encore
en cours. Deux issues sont possibles et l'une ou l'autre suffira : la session voisine emploie la clé
dans son écran, ou elle la retire.

**Statut : FERMÉ le 2026-08-19, par la session qui l'avait laissée.** C'est la deuxième des deux
issues que l'entrée ci-dessus prévoyait : la clé a été **retirée**, et non employée. Le geste de
redimensionnement existe bien, mais sa poignée est une affordance de SOURIS — `aria-hidden`, hors
du parcours de tabulation, le clavier disposant du geste complet par `Alt` + flèches
(`docs/DESIGN_SYSTEM.md` §5.29) —, si bien qu'elle ne porte aucun nom accessible et n'a pas de
libellé à traduire. La clé était donc morte pour de bon. MESURÉ après retrait : `i18n.test.ts` rend
**202 tests verts**, et la campagne complète de la session **1850 tests unitaires** sans échec.

Cette entrée est conservée plutôt qu'effacée : elle documente un croisement réel entre deux sessions
travaillant la même unité, et le fait que la ligne de base a été correctement établie de part et
d'autre.

### INC-172 — `dossiers.spec.ts` échoue APRÈS une campagne d'interface complète, et passe seule

**Nature :** constat **étranger à l'unité** de la session (`CRM-083` tranche 2b-2c), consigné sans
correction (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.1). Aucune ligne du changement ne touche la
messagerie, les dossiers IMAP ni les tracks.

**Ce qui est mesuré, le 2026-08-19.** Enchaînés dans cet ordre, `npm run e2e:ui` (**476 passés**),
puis `scripts/verify-objectifs.sh` (**46 contrôles, aucune anomalie**), puis `npm run e2e:mail` :

```
1 failed
  [mail] › e2e/mail/dossiers.spec.ts:276:2 › renommer un TRACK renomme son dossier et emporte ses enfants
41 passed (1.4m)
```

**Rejoué SEUL immédiatement après, sur la même pile et sans reseed** : `2 passés` en 8,4 s, dont le
scénario en cause.

**L'hypothèse, et ce qui la soutient.** La campagne d'interface exécute les scénarios
d'administration de l'arborescence, qui **renomment des tracks**. Le renommage d'un track renomme
son dossier IMAP — c'est précisément le contrat que ce scénario de messagerie vérifie —, si bien que
l'état laissé par la campagne d'interface peut ne plus être celui que le scénario attend. Ce n'est
pas établi : ni la cause exacte, ni l'ordre précis des scénarios responsables n'ont été isolés, la
session ayant préféré consigner plutôt que d'ouvrir une investigation qui ne lui appartient pas.

**Ce qu'il faut en retenir pour lire une campagne.** Un échec de `dossiers.spec.ts` **dans une
campagne complète** ne dit rien tant qu'il n'a pas été rejoué **seul**. La suite de messagerie
suppose un état de dossiers que la suite d'interface modifie ; tant que ce couplage n'est pas
tranché, l'ordre des suites fait partie du résultat.

**Arbitrage attendu.** Deux issues, et le responsable tranche : ou bien la suite de messagerie
**reseede** ce qu'elle exige avant de mesurer, ou bien la campagne complète **applique le seed**
entre la suite d'interface et celle de messagerie. La première rend la suite indépendante de son
ordre ; la seconde garde les suites telles quelles et déplace la contrainte dans le protocole de
campagne.

## Consigné le 2026-08-19 — un manque de spécification relevé par `CRM-084` tranche 2

### INC-173 — aucune surface ne gère les occurrences d'un budget récurrent, et `CRM-085` en aura besoin

**Ce qui est mesuré, et non déduit.** `docs/SPEC-costs.md` §4.1 décrit la table des budgets d'un
track avec une colonne « nombre d'occurrences ouvertes » — une LECTURE. Le §3.2 nomme par ailleurs
les droits d'écriture des occurrences : « ouvrir, libeller, doter, clôturer une occurrence :
administrateur du workspace ». Entre les deux, **aucun chapitre de la spécification ne décrit
l'écran qui porterait ces quatre gestes**. La relecture porte sur le document entier ; la tranche 2
de `CRM-084` a livré la colonne du §4.1 et rien de plus, faute de spécification à suivre.

**Pourquoi cela ne peut pas rester sans réponse.** Le §4.6 pose que la fiche d'une affaire montre
« un **second sélecteur d'occurrence** qui apparaît et devient obligatoire » pour un budget
récurrent, et qu'il « ne propose que les occurrences **ouvertes** ». Le §4.7 ajoute que, pour un
budget récurrent sans occurrence, le sélecteur **ne propose pas ce budget**. Autrement dit :
`CRM-085` exigera de CHOISIR une occurrence, alors qu'aucun geste du produit n'en CRÉE. Les deux
occurrences seedées de « Publicité 2026 » existent parce que le seed les pose en SQL, pas parce
qu'un utilisateur peut les ouvrir. Un budget récurrent créé à l'écran aujourd'hui est donc un
budget auquel aucune ligne de coût ne pourra jamais être rattachée.

**Ce qui n'a pas été fait, et pourquoi.** Rien. `CLAUDE.md` §1 interdit d'inventer un périmètre
fonctionnel, et `docs/CloudWorker.md` §4.1 interdit de trancher soi-même une entrée qui attend un
arbitrage. Écrire un écran d'occurrences aurait été écrire une spécification à la place du
responsable — sur une surface dont ni l'emplacement (dans la table des budgets ? dans une fiche de
budget ? dans l'écran de détail du §4.3 ?), ni les états, ni le comportement du réordonnancement ne
sont posés.

**Arbitrage attendu.** Trois issues au moins, et le responsable tranche :

1. l'administration des occurrences est une **sous-surface de la table des budgets** — dépliage
   d'une ligne récurrente, sur le patron des channels d'un track ;
2. elle appartient à l'**écran de détail d'un budget** du §4.3, que `CRM-086` livrera — auquel cas
   `CRM-085` dépend de `CRM-086`, ce qui inverse l'ordre du plan ;
3. les occurrences restent **hors interface** pour l'instant, et `CRM-085` ne propose que les
   budgets non récurrents — auquel cas le §4.6 doit être amendé, et la limite écrite.

Tant que l'arbitrage n'est pas rendu, `CRM-084` porte cette limite dans son backlog et le
comportement reste inchangé.

## Consigné le 2026-08-19 — un échec de campagne non reproductible, étranger à `CRM-084` tranche 2

### INC-174 — `administration-workflows.spec.ts` § « les deux gestes se mènent au clavier seul » échoue DANS une campagne complète, et passe seul

**Ce qui est mesuré.** Campagne complète du 2026-08-19, session `CRM-084` tranche 2 :

```
1 failed
  [ui] › e2e/ui/administration-workflows.spec.ts:1116:2 › la grille champ × étape sur la vraie
        base (§7 bis.11) › les deux gestes se mènent au clavier seul
493 passed (18.1m)
```

**Rejoué SEUL immédiatement après, sur la même pile et sans reseed** : `2 passés` en 50,2 s, dont le
scénario en cause — 29,8 s à lui seul.

**Pourquoi il n'est PAS imputable au changement de la session.** Le diff de cette tranche touche
`webapp/src/lib/budgets.ts`, `webapp/src/app/BlocBudgetsTrack.tsx`, les traductions, et ajoute une
section à `webapp/src/app/AdministrationArborescence.tsx` — l'écran `/reglages/arborescence`. Le
scénario en échec parcourt `/reglages/workflows`, où aucun de ces modules n'est monté. Aucun chemin
de code n'est partagé, et le compte total de la suite d'interface est cohérent : 482 la veille,
plus les 12 scénarios de cette tranche, soit 494 — dont 493 passés et un échec.

**Ce qui n'est PAS établi.** La cause exacte. Le scénario est un parcours clavier long, qui avance
son focus par `Tab` sur une grille champ × étape ; 29,8 s isolé le place près des bornes d'attente
de Playwright, et une campagne de dix-huit minutes n'offre pas la même machine qu'une exécution
seule. C'est une HYPOTHÈSE, pas une mesure : ni le seuil, ni le pas de la boucle en cause n'ont été
isolés, la session ayant préféré consigner plutôt qu'ouvrir une investigation qui ne lui appartient
pas. `docs/CloudWorker.md` §4.3 interdit par ailleurs de rester en boucle sur une anomalie étrangère
à son unité.

**Ce qu'il faut en retenir pour lire une campagne.** C'est le second couplage de ce genre après
INC-172 : un échec isolé d'un parcours clavier long **dans une campagne complète** ne dit rien tant
qu'il n'a pas été rejoué **seul**. Le trancher demande de savoir si le scénario dépend d'un budget
de temps que la campagne lui retire.

**Arbitrage attendu.** Deux issues, et le responsable tranche : ou bien ce scénario reçoit un
`test.slow()` explicite, avec son motif écrit dans le fichier — ce qui NOMME sa durée au lieu de la
subir —, ou bien sa boucle de `Tab` est bornée par un compteur plus serré, ce qui la rendrait
insensible à la charge. Aucune des deux ne doit être prise pour verdir une preuve : le scénario
mesure un contrat réel, et il passe.

**MESURE COMPLÉMENTAIRE, 2026-08-19, décision 474 — l'anomalie NE S'EST PAS REPRODUITE.** La
campagne complète de la session `CRM-085` tranche 2, exécutée sur la même pile, rend
`516 passed (15.7m)` **sans aucun échec** — soit les 494 scénarios de la veille plus les 22 de cette
tranche. Le scénario en cause est donc passé DANS une campagne complète, ce qui **renforce
l'hypothèse du budget de temps** — la campagne a duré 15,7 min contre 18,1 — et **écarte** celle d'un
défaut déterministe du parcours. Cela ne le tranche pas : une anomalie sensible à la charge est par
construction intermittente, et son absence sur une exécution ne prouve rien de plus que sa présence
sur la précédente. L'entrée reste ouverte, et l'arbitrage ci-dessus reste attendu.


## INC-175 — `scripts/verify-preuves-refus.sh` porte deux compteurs PÉRIMÉS, et sa dérive précède `CRM-085`

**Ouvert le 2026-08-19, décision 473. Étranger à l'unité de la session, laissé INCHANGÉ.**

**Ce qui est mesuré.** Le harnais rend `27 contrôles, 3 anomalie(s)`, dont deux sont des compteurs
en dur qui ne suivent plus l'état du dépôt :

```
ECHEC  plan attendu 55, obtenu « 58 »
ECHEC  66 politiques attendues, 103 relevées
```

`ASSERTIONS_ATTENDUES=55` (ligne 73) et le littéral `66` (lignes 244 à 247) sont comparés au plan de
`supabase/tests/0016_preuves_refus.test.sql` et au recensement de `pg_policies`.

**LA DÉRIVE EST ANTÉRIEURE À CETTE SESSION, ET C'EST ÉTABLI PAR LA LIGNE DE BASE, non supposé.** À
`HEAD~8` — l'état laissé par la décision 472, avant tout commit de `CRM-085` — la suite portait déjà
`select plan(57)` et recensait déjà **99** politiques :

```
git show HEAD~8:supabase/tests/0016_preuves_refus.test.sql
  40:  select plan(57);
  156: 99,
```

Le harnais était donc DÉJÀ rouge sur ces deux contrôles avant `CRM-085`, qui n'a fait que porter 57
à 58 et 99 à 103. Les écarts de 55 à 57 et de 66 à 99 appartiennent aux unités qui ont livré des
politiques sans étendre ce harnais — au moins `CRM-054`, `CRM-060`, `CRM-078`, `CRM-081`, `CRM-082`
et `CRM-084`, dont chacune a révisé le recensement pgTAP sans révisier son harnais.

**Ce qui n'est PAS en cause.** La suite pgTAP elle-même est verte et son recensement est à jour :
`CRM-084` l'avait révisé de 91 à 99, `CRM-085` de 99 à 103, chaque fois avec l'inventaire NOMINAL
étendu en même temps que le compte. La règle qu'ils gardent — « une politique ajoutée sans que la
suite soit étendue fait échouer ce compte » — fonctionne. C'est son MIROIR dans le harnais qui a
cessé d'être entretenu.

**Pourquoi le comportement est laissé inchangé.** Porter `55` à `58` et `66` à `103` verdirait le
harnais en un geste, et c'est précisément ce qui rend ce geste suspect : il effacerait la preuve que
ce harnais est resté sans surveillance sur au moins six unités, et il arbitrerait à la place du
responsable que ces deux compteurs doivent SUIVRE le recensement pgTAP plutôt que d'être supprimés
comme redondants avec lui. `docs/CloudWorker.md` §3.1 interdit de corriger au passage un défaut
étranger à son unité.

**Arbitrage attendu.** Trois issues, et le responsable tranche : (1) les deux compteurs sont
RECALÉS et une garde est posée pour qu'une prochaine unité ne puisse plus les oublier — par exemple
en les LISANT dans la suite pgTAP au lieu de les redéclarer ; (2) ils sont SUPPRIMÉS du harnais
comme redondants avec le recensement pgTAP, qui les porte déjà avec son inventaire nominal ; (3) ils
sont conservés en l'état et le harnais est réputé rouge jusqu'à une reprise transverse des harnais
(lot I+J du plan de solde).

## INC-176 — `formaterMontant` est DUPLIQUÉ à l'identique dans `Board.tsx` et `ListeCards.tsx`

**Ouvert le 2026-08-19, décision 475. Étranger à l'unité de la session, laissé INCHANGÉ.**

**Ce qui est mesuré.** La même fonction, avec le même corps et le même commentaire de doctrine, est
déclarée deux fois :

```
webapp/src/app/Board.tsx:114       function formaterMontant(montant: number, devise: string): string
webapp/src/app/ListeCards.tsx:98   function formaterMontant(montant: number, devise: string): string
```

Les deux délèguent à `Intl.NumberFormat('fr-FR', { style: 'currency', … })` et retombent sur le même
repli lorsque la devise est inconnue du navigateur. Aucune n'est exportée, si bien qu'un troisième
appelant n'a d'autre choix que d'en écrire une troisième copie.

**Ce que la session a fait, et ce qu'elle n'a pas fait.** `CRM-086` avait besoin de ce formatage
pour les étiquettes de l'histogramme. Plutôt que de produire une TROISIÈME copie, la fonction est
déclarée une fois dans `webapp/src/app/HistogrammeCouts.tsx` et **exportée**, de sorte que les deux
écrans de coûts qui restent à livrer — le détail d'un budget (§4.3) et le cumul du workspace (§4.5)
— la réemploient au lieu de la recopier. Les copies de `Board.tsx` et de `ListeCards.tsx` sont
laissées **strictement inchangées** : `docs/CloudWorker.md` §3.1 interdit de corriger au passage un
défaut étranger à son unité, et remplacer deux fonctions privées par un import toucherait deux
écrans que `CRM-086` ne concerne pas, en obligeant à rejouer leurs preuves pour un gain purement
structurel.

**Pourquoi ce n'est pas un défaut anodin.** Le repli sur devise inconnue est une règle de
comportement, pas un détail : une devise que le navigateur ne connaît pas ne doit pas faire tomber
l'écran. Trois copies, c'est trois endroits où cette règle peut diverger sans qu'aucune preuve ne
s'en aperçoive, chacune étant testée — quand elle l'est — à travers l'écran qui la porte.

**Arbitrage attendu.** Deux issues, et le responsable tranche : (1) la fonction descend dans un
module partagé — `webapp/src/lib/montants.ts` ou l'équivalent —, les trois appelants l'importent, et
elle reçoit ses propres tests unitaires, y compris celui du repli ; (2) la duplication est assumée
comme un coût acceptable de l'indépendance des écrans, et l'entrée est close sans changement.

## Consigné le 2026-08-19 — un constat de MÉTHODE, relevé pendant `CRM-086` tranche 3

### INC-177 — `npm run test:sql` et `npm run e2e:ui` partagent UNE base, et les lancer ensemble rend un verdict qui ne dit rien

**Ce qui est mesuré.** Décision 476. `npm run test:sql` a été lancé **pendant** que
`npm run e2e:ui` tournait, sur la même pile de développement. Verdict rendu :

```
49 fichiers, 5 en échec.
  0013_move_card.test.sql                    — 1 assertion en échec sur 82
  0021_transition_required_fields.test.sql   — 1 assertion en échec sur 88
  0037_versionnement_workflows.test.sql      — 1 assertion en échec sur 31
  0040_restauration_version_workflow.test.sql — 2 assertions en échec sur 30
  0041_comparaison_copie_source.test.sql     — 6 assertions en échec sur 28
```

**Pourquoi ce verdict n'est PAS une mesure du dépôt.** Les cinq fichiers en échec portent tous sur
`move_card`, les exigences de transition, le versionnement, la restauration et la comparaison de
workflows — c'est-à-dire exactement les objets que `e2e/ui/administration-workflows.spec.ts` crée,
modifie, archive et restaure **au même instant**, sur la **même** base. Les deux harnais n'ont
aucun cloisonnement : ni base séparée, ni transaction, ni verrou. Le diff de la session, lui, ne
touche **aucun** `.sql`, aucune migration, aucun script — `git diff <base>..HEAD --stat --
supabase/ scripts/` rend une sortie vide.

**LA CONTRE-ÉPREUVE A ÉTÉ FAITE, ET ELLE TRANCHE.** `npm run test:sql` rejoué **seul**, la
campagne terminée, sur la même pile et sans reseed :

```
49 fichiers, 2464 assertions, aucune anomalie.
```

Les cinq échecs ci-dessus étaient donc **entièrement** provoqués par l'exécution concurrente. Aucun
n'est une régression, aucun n'est une anomalie préexistante : le premier verdict ne mesurait rien
d'autre que la collision.

**Ce qu'il faut en retenir pour lire une campagne.** C'est un piège de méthode, et il est
silencieux : rien dans le dépôt ne signale que ces deux commandes se disputent une ressource, et
`docs/CloudWorker.md` §4.3 les énumère sur la même ligne, ce qui invite à les paralléliser pour
tenir le budget de temps. **Elles doivent être exécutées l'une après l'autre.** Une session qui
les mène de front lira des échecs qu'elle a elle-même provoqués, et pourra les attribuer à son
propre code — exactement le défaut que le §2.4 existe pour prévenir, sous une forme que la ligne
de base par `git stash` ne rattrape pas : le code est identique des deux côtés, c'est l'ÉTAT qui
diverge.

**Arbitrage attendu.** Deux issues, et le responsable tranche : (1) `docs/CloudWorker.md` §4.3 et
le `README.md` nomment explicitement que les preuves de base et les preuves d'interface ne se
lancent jamais en parallèle ; (2) `scripts/run-sql-tests.sh` pose un garde-fou — un verrou
consultatif PostgreSQL, ou le refus de démarrer si un serveur d'aperçu écoute sur 4173 — qui rend
le piège impossible plutôt que documenté.

**SECONDE FORME DU MÊME PIÈGE, MESURÉE DANS LA MÊME SESSION, ET CELLE-CI EST PIRE.**
`npm run build` a été lancé pendant que la campagne d'interface tournait, pour vérifier une classe
CSS. Or `e2e/playwright.config.ts` **reconstruit `webapp/dist` au démarrage, avec les variables
`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`**, puis le sert par `vite preview` — son en-tête le
dit : « une preuve obtenue sur un `dist` périmé ne prouverait rien ». Un `npm run build` nu écrase
ce répertoire **sans** ces variables. À partir de cet instant, la campagne a servi une application
qui n'avait plus d'adresse d'API, et tous ses scénarios suivants ont rendu :

```
Configuration incomplète
L'application n'a pas reçu l'adresse de l'API ou sa clé publique.
```

Quatre échecs de `channels.spec.ts` ont été lus ainsi avant que la cause ne soit isolée. La
campagne a été **arrêtée et rejouée depuis le début**, sans rien toucher pendant son exécution.

**La règle est donc plus large que la première formulation.** Pendant qu'une campagne d'interface
tourne, on ne touche ni à la base, ni à `webapp/dist`, ni au port 4173. Une session qui vérifie
quoi que ce soit « pendant que ça tourne » n'accélère rien : elle invalide la campagne entière et
la fait recommencer.

## Consigné le 2026-08-19 — un constat de rendu, étranger à `CRM-086`

### INC-178 — trois classes citées par des composants n'existent pas dans le CSS produit, et leur effet est perdu en silence

*Relevé pendant `CRM-086` tranche 3, décision 476. Étranger à cette unité : aucun des cinq fichiers
en cause n'est touché par le changement de la session.*

**Ce qui est mesuré.** `node scripts/lib/classes-css.mjs webapp/src webapp/dist`, après
`npm run build` :

```
classes citées : 285
classes absentes du CSS produit : h-10 py-0.5 text-text-1
```

Elles sont citées ici :

| Classe | Fichier | Ce qui est perdu |
|---|---|---|
| `py-0.5` | `webapp/src/components/ui/Sommeil.tsx` (`CRM-081`), `webapp/src/app/BlocCoutsCard.tsx` (`CRM-085`) | le rembourrage vertical de la pastille et de la pilule — **aucun**, au lieu de 2 px |
| `h-10` | `webapp/src/app/EnTeteCard.tsx` (`CRM-040`) | la hauteur du champ de devise — elle retombe sur son contenu, sous la cible de 40 px du §8 |
| `text-text-1` | `webapp/src/app/ChampsContact.tsx` (`CRM-060`), `webapp/src/app/AdministrationWorkflows.tsx` (`CRM-076`) | la couleur du texte — le jeton s'appelle `--color-ink`, et `text-1` n'existe pas |

**Pourquoi c'est un défaut et pas une coquille.** `docs/DESIGN_SYSTEM.md` §11 le nomme exactement :
« une classe dont le jeton n'est pas déclaré n'est **pas engendrée du tout**, et en silence ».
L'échelle d'espacement est **close** — `0, 1, 2, 3, 4, 6, 8, 12` —, donc `0.5` n'existe pas ; la
hauteur `h-10` supposerait un `--spacing-10` que le thème ne déclare pas ; et la palette de texte ne
porte que `--color-text-2` et `--color-text-3`, le texte fort étant `--color-ink`. C'est la faute
qu'INC-158 a déjà consignée pour la jauge du canevas d'objectifs, et le §5.29 y répond : « une
mesure hors de l'échelle s'écrit en valeur arbitraire assumée (`h-[6px]`), jamais en fraction de
l'échelle ».

**Le cas de `h-10` est le plus sérieux.** Un champ de saisie dont la hauteur retombe sur son contenu
descend sous la cible interactive de 40 px que le §8 pose sans exception, et aucune preuve du dépôt
ne mesure la hauteur rendue de ce champ.

**Ce qui n'est PAS établi.** L'effet visible de chacune sur une capture. La session a mesuré
l'absence dans le CSS produit, pas le rendu ; les trois sont donc des défauts **certains dans le
code** et **non observés à l'écran**, faute d'appartenir à son unité (`docs/CloudWorker.md` §3.1 :
laisser le comportement inchangé plutôt que corriger au passage).

**LE HARNAIS LE DIT AUSSI, ET LA LIGNE DE BASE EST ÉTABLIE.** `scripts/verify-webapp.sh` rend
`42 contrôles, 1 anomalie(s)`, et cette anomalie unique est ce contrôle-ci :

```
4. Classes utilitaires engendrées (garde des espaces de noms remis à zéro)
   ECHEC  des classes citées ne sont pas engendrées
          classes citées : 285
          classes absentes du CSS produit : h-10 py-0.5 text-text-1
```

Elle est **préexistante**, et la ligne de base n'a pas demandé de `git stash` : au commit de départ
de la session, `git show <base>:webapp/src/app/HistogrammeCouts.tsx` porte **trois** occurrences de
la quatrième classe morte. Le harnais rendait donc déjà cette anomalie **avec quatre** classes ; il
en rend trois. Le changement de la session l'a réduite, jamais causée.

**Une quatrième était du ressort de la session, et elle est corrigée.** `rounded-xs`, cité trois fois
par la légende de `webapp/src/app/HistogrammeCouts.tsx` (`CRM-086`), rendait les pastilles de légende
**carrées**. Elles sont désormais `rounded-full`, la forme que le §5.6 nomme — « précédés d'un point
ou d'une icône ».

**Arbitrage attendu.** Deux issues, et le responsable tranche : (1) chacune est corrigée dans l'unité
qui la porte, avec la capture qui montre l'avant et l'après ; (2) le contrôle
`scripts/lib/classes-css.mjs` est ajouté à un harnais que **toute** session exécute — il ne vit
aujourd'hui que dans quatre `verify-*.sh` sur cinquante, ce qui explique que ces trois classes aient
survécu à plusieurs livraisons.

## Consigné le 2026-08-20 — une preuve d'interface intermittente, étrangère à `CRM-086`

### INC-179 — `commentaires-gestes.spec.ts` échoue par intermittence sur la relecture d'un commentaire modifié

*Relevé pendant `CRM-086` tranche 4, décision 477. Étranger à cette unité : ce scénario porte sur le
panneau de commentaires (`CRM-043`), qu'aucun fichier de la session ne touche.*

**Ce qui est mesuré, et les trois mesures sont sur le MÊME code.**

| Exécution | Verdict |
|---|---|
| `npm run e2e:ui` complet, 01:05 | **532 passés**, dont ce scénario |
| `scripts/verify-webapp.sh`, 01:30 | **531 passés, 1 échec** — `commentaires-gestes.spec.ts:280` |
| `npm run e2e:ui -- commentaires-gestes`, 01:40 | **8 passés**, dont ce scénario |

L'assertion en cause relit le commentaire par l'API juste après l'avoir modifié au clavier :

```
await expect(page.getByText(`${texte} au clavier`)).toBeVisible()
expect((await relire(request, texte))?.body).toBe(`${texte} au clavier`)
```

**Ce qui n'est PAS établi, et il faut le dire.** La cause. L'écran affiche bien le texte modifié —
la ligne précédente passe —, et c'est la RELECTURE par l'API qui rend l'ancien corps. Deux
hypothèses non départagées : le rendu précède l'acquittement du serveur, ou `relire` retrouve un
autre commentaire quand deux exécutions laissent des corps voisins. La première ferait de
l'assertion une course, la seconde un défaut de sélection dans le harnais. Aucune des deux n'est
mesurée, et rien n'est corrigé : le §3.1 de `docs/CloudWorker.md` interdit de corriger au passage un
défaut étranger à l'unité.

**Ce que ce n'est PAS.** Une régression de la session : le scénario passe avant et après, sur le
même code. Ni une anomalie de `CRM-086` : aucun fichier de cette unité n'entre dans ce parcours.

**Pourquoi c'est un défaut malgré tout.** Une preuve qui rend deux verdicts sur un même code ne
prouve plus rien : la session suivante qui la verra rouge cherchera une cause dans son propre
changement, exactement ce qu'INC-177 décrit pour une autre raison. Une intermittence non consignée
finit par être lue comme du bruit, et c'est ainsi qu'un vrai défaut passe.

**Arbitrage attendu.** Le responsable tranche si ce scénario est repris dans son unité (`CRM-043`)
avec une attente explicite sur l'acquittement du serveur, ou s'il est laissé tel quel jusqu'à ce
qu'il devienne reproductible.

### INC-180 — la barre d'onglets écrit « Aucun channel » sur toutes les routes transverses

*Relevé pendant `CRM-086` tranche 5, décision 478. Étranger à cette unité : le défaut est celui de
la coquille commune (`CRM-007`, `CRM-021`) et existe depuis longtemps sur `/contacts`, `/objectifs`,
`/inbox`, `/ma-journee` et `/reglages`. La livraison de `/couts` l'expose une sixième fois, elle ne
le cause pas.*

**Ce qui est mesuré.** `AppShell` rend `TabBar` inconditionnellement, et `TabBar` rend son état vide
lorsque `slugTrack` est indéfini — c'est-à-dire sur **toute** route de premier niveau. La bande grise
« Aucun channel » occupe donc une ligne entière sous l'en-tête d'écrans qui n'ont aucun rapport avec
les channels. La capture `docs/captures/CRM-060/carnet-contacts-1440.jpg`, produite bien avant cette
session, porte exactement la même bande : le défaut est antérieur.

**Pourquoi c'en est un.** Un état vide dit ce qui **manque** (`docs/DESIGN_SYSTEM.md` §5.8). Ici rien
ne manque : le carnet de contacts et le cumul des coûts du workspace n'ont pas de channel à montrer,
et ne sont pas censés en avoir. La phrase énonce donc une absence qui n'est pas une absence, ce qui
est le symétrique du défaut que le §5.15 nomme pour un bouton grisé — on répond à une question que
personne ne pose. Elle coûte en outre une ligne d'écran sur six routes.

**Ce que ce n'est PAS.** Un défaut d'accessibilité : la bande porte son libellé et sa précision en
`sr-only`, et rien n'est masqué. Ni une régression : le comportement est inchangé depuis `CRM-021`.

**Rien n'est corrigé, et c'est délibéré** : le §3.1 de `docs/CloudWorker.md` interdit de corriger au
passage un défaut étranger à l'unité, et celui-ci touche la coquille de six routes livrées par
quatre unités différentes.

**Arbitrage attendu.** Le responsable tranche si `TabBar` doit ne **rien** rendre hors d'une route de
track — ce qui retirerait la bande des six écrans et ferait remonter leur contenu d'une ligne —, ou
si l'état vide reste rendu partout pour que la coquille garde la même hauteur d'un écran à l'autre.

### INC-181 — `npm run e2e:mail` lancé DERRIÈRE `npm run e2e:ui` rend deux échecs qui disparaissent seuls

*Relevé pendant `CRM-086` tranche 5, décision 478. Étranger à cette unité : les deux scénarios
portent sur l'ingestion et le backfill de la messagerie (`CRM-052`, `CRM-055`), qu'aucun fichier de
la session ne touche — le diff ne sort pas de `webapp/src`, `e2e/ui` et `docs/`.*

**Ce qui est mesuré, et les deux mesures sont sur le MÊME code, à onze minutes d'intervalle.**

| Exécution | Verdict |
|---|---|
| `npm run e2e:mail` **immédiatement après** un `npm run e2e:ui` de 17,3 min, 01:53 | **40 passés, 2 échecs** |
| `npm run e2e:mail` **seul**, 02:05 | **42 passés, aucun échec** |

Les deux échecs :

- `ingestion.spec.ts:159` — `messages_new` vaut **0** là où le scénario en attend au moins 1. La
  relève n'a donc rien trouvé : ni la pièce infectée ni le rejeu ne sont même atteints, l'assertion
  tombe avant ;
- `backfill.spec.ts:268` — « un premier contact ne descend jamais l'historique ».

**Ce qui n'est PAS établi, et il faut le dire.** La cause. Deux hypothèses non départagées : la
remise par Stalwart et le cycle de relève de `mail-sync` n'ont pas eu le temps d'aboutir pendant que
la pile finissait d'encaisser dix-sept minutes de scénarios d'interface, ou l'un des deux services a
été ralenti au point de manquer la fenêtre d'attente du scénario. Aucune n'est mesurée, et **rien
n'est corrigé** : le §3.1 de `docs/CloudWorker.md` interdit de corriger au passage un défaut
étranger à l'unité, et allonger une attente serait de toute façon la temporisation arbitraire que
`CLAUDE.md` §18 proscrit.

**Ce que ce n'est PAS.** Une régression de la session : le code est identique des deux côtés, et
c'est l'ÉTAT de la pile qui diverge — exactement la nature d'INC-177, où `test:sql` et `e2e:ui`
partagent une base, transposée ici à l'enchaînement de deux suites sur la même pile.

**Pourquoi c'est un défaut malgré tout.** Une campagne complète enchaîne ses suites par
construction. Si `e2e:mail` ne peut rendre un verdict juste qu'à froid, alors la campagne complète
ne peut pas le rendre du tout, et la session suivante qui verra ces deux rouges cherchera une cause
dans son propre changement.

**Arbitrage attendu.** Le responsable tranche si les scénarios d'ingestion doivent attendre un
événement observable — un cycle de relève acquitté — plutôt qu'une fenêtre de temps, ou si
`e2e:mail` doit être exécutée avant `e2e:ui` dans la campagne, ou les deux.

**MESURE COMPLÉMENTAIRE, 2026-08-20, `CRM-086` tranche 6a — un TROISIÈME scénario, et son mécanisme
est ÉTABLI cette fois.** `mail-sync.spec.ts` §S3, « la console opérationnelle reste silencieuse »,
a rendu rouge en campagne complète :

```
Expected value: "WARNING"     Received array: ["DEBUG", "INFO"]
```

La cause a été LUE, et non supposée. `docker logs p2enjoy-mail-sync` portait **une seule** ligne
d'avertissement, horodatée pendant `e2e:ui` :

```
{"timestamp":"2026-08-20T02:42:10.322Z","level":"WARNING","service":"mail-sync","event":"veille_compte_echoue"}
```

Le scénario lit le **tampon cumulatif** de `docker logs`, jamais une fenêtre : il rend donc rouge
pour tout avertissement produit par n'importe quelle suite exécutée avant lui, sur n'importe quel
sujet. Après le remède du §2.2 bis de `docs/CloudWorker.md` — `up -d --force-recreate mail-sync`
avec les DEUX fichiers de composition —, la suite rend **5 passés** sur le **même code**, S3
compris, en 107 ms.

**Ce que cela ajoute à l'entrée.** Les deux échecs de la décision 478 restaient sans cause établie ;
celui-ci en a une, et elle est structurelle : ce n'est pas un état de pile qui diverge, c'est une
preuve qui interroge un **journal cumulatif** dont elle ne borne pas le début. La différence compte
pour l'arbitrage : réordonner les suites ne suffirait pas ici — il faudrait que S3 borne sa lecture,
par un horodatage de départ ou par `--since`, ou que la campagne recrée le conteneur avant elle.

**Ce que ce n'est PAS.** Une régression de la session : le changement de `CRM-086` tranche 6a ne
touche ni `mail-sync`, ni la messagerie, ni aucun de leurs journaux — le diff ne sort pas de
`supabase/migrations`, `supabase/tests`, `supabase/seed`, `webapp/src/lib`, `scripts` et `docs`.
Rien n'a été corrigé (§3.1).

## Consigné le 2026-08-20 — le mécanisme d'INC-179 est ÉTABLI, et il est AUTO-ENTRETENU

### INC-179 (complément) — un échec de `commentaires-gestes.spec.ts` laisse sa fixture, et se rend alors DÉTERMINISTE

*Relevé pendant `CRM-086` tranche 6a. Étranger à cette unité : ce scénario porte sur le panneau de
commentaires (`CRM-043`), qu'aucun fichier de la session ne touche.*

INC-179 consignait une intermittence sans cause. Cette session en a **établi le mécanisme**, en
mesurant les deux côtés.

**Les mesures, dans l'ordre, sur le MÊME code.**

| Exécution | Verdict |
|---|---|
| Campagne complète n° 1, `e2e:ui` | `commentaires-gestes.spec.ts` **vert**, 533 passés sur l'ensemble |
| Campagne complète n° 2, `e2e:ui` | **3 échecs** — `:106`, `:198`, `:224` |
| Le fichier SEUL, immédiatement après | **3 échecs**, les mêmes |
| Le fichier seul **après réapplication du seed** | **3 échecs**, les mêmes |
| Le fichier seul après **suppression de la fixture résiduelle** | **1 échec** — `:224` seul |
| Le fichier seul, tour suivant | **8 passés, aucun échec** |

**La cause, lue et non supposée.** La base portait un **sixième** commentaire, absent du seed :

```
ceef07a1-…  card …0c2  auteur Camille  « Geste 1787194910853-855189 »  créé à 03:01:51
```

L'horodatage est celui de l'`e2e:ui` de la campagne n° 2. Le scénario `:106` compte les cartes
portant des actions — `expect(getByTestId('actions-commentaire')).toHaveCount(1)` — et en trouvait
**2** : la sienne, et celle qu'un tour précédent avait laissée.

**Ce que cela ajoute, et c'est le point.** L'intermittence de départ n'est pas expliquée ; ce qui
l'est, c'est ce qui la **transforme en échec permanent**. Le nettoyage du scénario ne s'exécute pas
lorsqu'il échoue, si bien qu'un unique échec intermittent **empoisonne la base** et rend les tours
suivants déterministes. Une session qui rejouerait la preuve pour départager un hasard obtiendrait
donc un rouge stable et conclurait à une régression de son propre changement.

Le seed ne rattrape rien : il **converge sans détruire de donnée inconnue**, et c'est sa règle. Seule
une remise à zéro de la base, ou une suppression manuelle, efface le résidu — et une exécution
planifiée part d'une base neuve, ce qui explique que le défaut n'ait jamais été vu deux fois de
suite.

**Ce que ce n'est PAS.** Une régression de la session : le diff ne touche ni le panneau de
commentaires, ni `card_comments`, ni aucune de leurs politiques. **Rien n'a été corrigé** dans le
scénario (§3.1) ; seule la fixture résiduelle a été retirée de la base de développement, pour
mesurer.

**Arbitrage attendu.** Le scénario doit poser son nettoyage dans un `afterEach` inconditionnel — ou
mieux, préfixer sa fixture d'un marqueur et purger tout ce qui le porte **avant** de commencer,
comme `card-costs.spec.ts` le fait déjà avec sa fonction `purger`. La cause de l'intermittence de
départ reste, elle, à établir.

## Consignés le 2026-08-20 — deux manques de SPÉCIFICATION relevés par `CRM-086` tranche 6

Relevés en lisant `docs/SPEC-costs.md` §4.8 **avant** de le coder, comme le §3.2 point 3 de
`docs/CloudWorker.md` le demande. Ils ne sont **pas** étrangers à l'unité : ils portent sur l'onglet
même que la tranche livre. Ils sont consignés ici plutôt que tranchés sur place parce que trancher
poserait une règle de produit que personne n'a prise — `CLAUDE.md` §5, dernier alinéa de la
traçabilité. Le comportement livré est celui que la spécification complétée (§4.8.1, §4.8.2) nomme,
et il est nommé pour être révisé sans surprise dès l'arbitrage rendu.

### INC-182 — le badge de l'onglet « À saisir » ne PEUT PAS porter le même nombre que la mention du §4.4

`docs/SPEC-costs.md` §4.8 écrit : « L'onglet porte un badge : le nombre de lignes en attente dans la
portée de l'écran. Il est le même nombre que celui de la mention du §4.4 — s'ils divergeaient, l'un
des deux mentirait. » La Definition of Done de `CRM-086` reprend l'exigence mot pour mot.

**Les deux nombres ne comptent pas la même population, et c'est structurel — deux causes
indépendantes.**

1. **La clôture.** Le §4.8 liste explicitement les lignes des budgets et occurrences **clôturés** —
   « c'est précisément après la clôture que les factures arrivent, et les exclure viderait l'onglet
   de son usage ». Le §4.2, lui, pose qu'« un budget clôturé n'y figure pas » dans l'histogramme, et
   la mention du §4.4 est rendue **sous cet histogramme**. Une ligne sans réel sur un budget clos est
   donc comptée par le badge et pas par la mention.

2. **La devise.** La mention du §4.4 est rendue par histogramme, donc **par devise** (§4.5, « un
   histogramme par devise présente »). Un badge d'onglet est un nombre **unique**. Sur un écran à
   deux devises, il n'existe aucune mention unique à laquelle le badge pourrait être égal.

**MESURÉ sur le seed, le 2026-08-20**, écran de coûts du track « Studio web », après que cette
tranche a posé la ligne « Impression plaquettes » sans réel sur le budget clôturé « Salon du web
2025 » — la ligne que la Definition of Done exige d'être « présente et **saisissable** » :

| Nombre | Valeur | Population |
|---|---|---|
| Mention du §4.4 sous l'histogramme | **1** | budgets OUVERTS du track — « Publicité » seule |
| Badge de l'onglet « À saisir » | **2** | + « Impression plaquettes », budget clos |

La divergence n'est donc pas hypothétique : elle naît du jeu de données que la Definition of Done
demande elle-même de poser.

**Ce que la tranche fait, et pourquoi.** Le badge compte les lignes que le tableau de l'onglet
**liste** (§4.8.2). Un badge qui annoncerait un autre nombre que celui des lignes rendues juste en
dessous mentirait sur l'écran même où il est posé — précisément le défaut que la phrase du §4.8
cherchait à prévenir. **Rien n'est corrigé dans la spécification hors le §4.8.2, qui nomme l'écart.**

**Arbitrage attendu.** Trois issues, et le responsable tranche :

1. la phrase du §4.8 et la Definition of Done sont **révisées** : le badge compte la portée de
   l'onglet, la mention compte la portée de son histogramme, et les deux nombres n'ont jamais eu à
   être égaux ;
2. l'onglet **cesse** de lister les budgets clos — ce qui contredirait sa raison d'être telle que le
   §4.8 l'écrit, et rendrait la Definition of Done inapplicable ;
3. la **mention du §4.4** gagne un second nombre, « dont n sur un budget clôturé », de sorte que la
   somme des deux égale le badge. C'est l'issue qui conserve les deux textes, au prix d'une phrase
   plus longue sous chaque histogramme.

### INC-183 — le SEUIL d'ancienneté d'une ligne de coût n'existe pas, et `docs/DESIGN_SYSTEM.md` §5.31 le suppose

`docs/DESIGN_SYSTEM.md` §5.31 écrit, de la colonne « Ancienneté » de la table de saisie : « Au delà
d'un seuil, elle passe en `--color-danger-on-soft` sur `--color-danger-soft`, comme la pastille
d'ancienneté d'une card (§5.1) : c'est le même signal, il doit avoir la même forme. »

**Le seuil d'une card est une DONNÉE, et une ligne de coût n'a pas d'endroit où la porter.** Celui
d'une card vit sur son étape de workflow — `workflow_steps.stale_after_days`, avec le repli
`workflow_nodes_catalog.default_stale_after_days` (`docs/SPEC-workflow-engine.md` §2.5) —, et
`resoudreEtape` de `webapp/src/lib/board.ts` le résout dans cet ordre. Une ligne de `card_costs` n'a
ni étape, ni nœud, ni colonne de seuil : `docs/SCHEMA.md` §9 bis.6 n'en déclare aucune, et
`docs/SPEC-costs.md` §2.3 n'en nomme aucune.

**Rien n'est inventé.** Écrire « trente jours » dans le composant serait la valeur métier codée en
dur que `CLAUDE.md` §3 proscrit, et la poser en colonne de `budgets` serait une évolution de schéma
qu'aucune unité n'a demandée. La colonne « Ancienneté » est donc livrée **en 13 px
`--color-text-2`, sans variante de danger** — c'est-à-dire la première phrase du §5.31, tenue, et sa
seconde, non livrée et nommée.

**Arbitrage attendu.** Trois issues :

1. le seuil est une **constante de produit** documentée — par exemple soixante jours —, posée une
   seule fois dans un module de configuration et citée par le §5.31 ;
2. le seuil est une **donnée du budget** — une colonne `stale_after_days` sur `budgets`, avec son
   repli au niveau du workspace —, ce qui demande une migration et une surface d'administration ;
3. la seconde phrase du §5.31 est **retirée** : l'ancienneté est écrite en durée et ne porte aucun
   signal chromatique, la colonne étant déjà triée du plus ancien au plus récent — l'ordre porte
   alors l'information que la teinte devait porter.

## Consigné le 2026-08-20 — un contrôle du harnais qui prend une COMPARAISON pour une classe

### INC-184 — `scripts/lib/classes-css.mjs` lit toute chaîne littérale d'un `className`, comparaisons comprises

**Ce qui est mesuré, et comment.** La table de saisie du §5.31 rend le fond d'une ligne selon son
état. Écrit de la façon la plus directe :

```
className={['border-b border-border', etat.statut === 'enregistre' ? 'bg-success-soft' : 'hover:bg-hover'].join(' ')}
```

le contrôle des classes engendrées rend alors :

```
classes citées : 307
classes absentes du CSS produit : enregistre h-10 invalide py-0.5 text-text-1
```

`enregistre` et `invalide` ne sont pas des classes : ce sont les **valeurs comparées** d'un état.
Le contrôle extrait « toutes les chaînes littérales situées dans une expression `className` », ce
que son propre en-tête annonce, et une comparaison écrite là y entre comme le reste.

**Ce que cela coûte, et ce que cela ne coûte pas.** Le contrôle ne devient pas complaisant : il
ajoute des noms, il n'en retire aucun, et une classe réellement absente resterait signalée. Il
devient en revanche **rouge sur du code correct**, ce qui pousse à la seule issue disponible —
sortir la comparaison du `className` —, et c'est ce que la tranche 6b a fait, en écrivant le motif
dans le composant. Deux constantes calculées avant le JSX, et le contrôle rend de nouveau ses trois
seules anomalies préexistantes (INC-158 : `h-10`, `py-0.5`, `text-text-1`).

**Pourquoi ce n'est pas corrigé au passage.** `CLAUDE.md` §3.1 : le défaut est étranger à l'unité de
la session, et il touche un outil dont dépendent quatre harnais (`verify-webapp.sh`,
`verify-liste.sh`, `verify-board.sh`, `verify-formulaire.sh`). Le corriger demanderait de distinguer
une chaîne **rendue** d'une chaîne **comparée** — c'est-à-dire de lire l'arbre syntaxique plutôt que
le texte, exactement le chemin qu'`i18n.test.ts` a dû prendre pour la même raison (INC-070).

**Arbitrage attendu.** Deux issues :

1. le contrôle lit l'**arbre syntaxique** et ne retient que les chaînes réellement concaténées dans
   la valeur de l'attribut — le chemin d'`i18n.test.ts`, mais un outil de plus à entretenir ;
2. la **convention est écrite** : aucune comparaison de chaîne dans un `className`, l'état étant
   calculé avant le JSX. C'est ce que la tranche 6b a appliqué de fait ; l'écrire au design system
   §11 la rendrait opposable au lieu de la laisser se redécouvrir.

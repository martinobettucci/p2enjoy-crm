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

**Quatre ouvertes à ce jour : INC-123, INC-124, INC-125 et INC-126** — la dernière consignée le
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

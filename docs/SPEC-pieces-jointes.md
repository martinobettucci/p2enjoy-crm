# Spécification — Aperçu des pièces jointes et extraction de texte (`CRM-074`)

*Unité : `CRM-074` (`docs/BACKLOG.md`). Arbitrage : décision 788 du 2026-10-31 (`docs/JOURNAL.md`). Statut : **validée** le
2026-10-31 (décision 789, §12).*

## 1. Intention et frontière

Une pièce jointe se lit aujourd'hui en la téléchargeant. `CRM-074` ajoute trois choses :

1. **l'aperçu**, dans le CRM, d'une image ou d'un PDF sain, sans téléchargement ;
2. **le texte extrait** des PDF et des fichiers Office, montré dans l'aperçu pour copier un passage ;
3. **la pièce elle-même, en binaire, au connecteur MCP** : un assistant la lit à sa façon.

Arbitrage (décision 788) : images (PNG, JPEG, GIF, WebP) et PDF ; texte des PDF, Word, Excel et OpenDocument ; **le texte
n'entre pas dans la recherche globale** ; l'aperçu s'ouvre dans la boîte de réception et dans le fil de l'affaire ;
connecteur dans la famille **`messagerie`** existante, action « consulter ».

**Hors périmètre** : la reconnaissance de caractères (un PDF numérisé n'a pas de texte, et l'écran le dit) ; le rendu
visuel d'un fichier Office (seul son texte est montré) ; SVG, HTML, texte brut et tout autre type en aperçu ; PowerPoint et
les formats Office binaires anciens (`.doc`, `.xls`) ; les vignettes (`imgproxy` reste éteint, `docs/JOURNAL.md` l. 301) ;
l'**envoi** d'une pièce par le connecteur, qui reste exclu (`docs/SPEC-mcp.md` §9.2 decies).

## 2. Ce qui existe

- `mail_attachments` (migration `0024`) porte toutes les pièces : reçues (`mail-sync`, ingestion), envoyées
  (`marquer_envoi_reussi`, migration `0106`) et celles du digest (`0133`). Statut antivirus `av_status` :
  `pending`, `clean`, `infected`, `skipped`. Le type `mime_type` est celui que le message déclare, corrigé par inspection
  quand il est générique (`mail_sync/mime_analyse.py`).
- Le bucket privé `mail-attachments` ; **seule une pièce `clean`** se lit, par la politique de stockage de la migration
  `0029`, sous le droit de voir son message. Les objets sont déposés avec leur `mime_type` pour type de contenu.
- `authenticated` n'a que `select` sur `mail_attachments` ; la ligne se lit sous la RLS du message.
- L'écran : la boîte de réception liste les pièces d'un message, avec « Télécharger » pour une pièce saine (lien signé de
  cinq minutes ouvert dans un nouvel onglet). Le fil de l'affaire nomme un courrier (objet, expéditeur) **sans** ses
  pièces.
- **Caddy envoie `X-Frame-Options: DENY` sur toute réponse**, stockage compris : un PDF ne peut pas être encadré depuis
  son lien signé. L'aperçu ne change pas cet en-tête (§5.2).

## 3. En base — une migration

Trois colonnes sur `mail_attachments` et deux fonctions réservées à `service_role`. **Aucune table, aucune politique
nouvelle** : le texte se lit sous la RLS existante de la ligne.

| Colonne | Type | Sens |
|---|---|---|
| `text_status` | `text`, nul par défaut | `null` : pièce non concernée (type non retenu, ou pièce non saine) ; `pending` : à extraire ; `extracted` ; `empty` (aucun texte lisible, PDF numérisé) ; `unsupported` (le contenu n'est pas ce que le type annonce) ; `failed` (trois essais échoués, ou bornes dépassées, §4.3) |
| `extracted_text` | `text` | le texte, seulement en `extracted` ; 200 000 caractères au plus |
| `text_truncated` | `boolean`, faux par défaut | le texte a été coupé à la borne |

Plus deux colonnes de travail, `text_attempts` (`smallint`, 0) et `text_claimed_at` (`timestamptz`), pour la reprise.

- **Éligibilité** — `app.attachment_text_eligible(mime_type, filename)`, immuable : `application/pdf` ; les types Word
  et Excel Office Open XML (`…wordprocessingml.document`, `…spreadsheetml.sheet`) ; OpenDocument texte et classeur
  (`application/vnd.oasis.opendocument.text`, `…spreadsheet`) ; et, pour un type générique (`application/zip`,
  `application/octet-stream`), l'extension `.docx`, `.xlsx`, `.odt`, `.ods` ou `.pdf` du nom. L'extracteur vérifie le
  contenu de toute façon (§4.2).
- **Déclencheur** `mail_attachments_text_pending` (avant insertion, et avant mise à jour de `av_status`) : une pièce qui
  devient `clean` et éligible passe `pending`. Une pièce non saine n'est **jamais** extraite.
- **Reprise de l'existant** : la migration passe `pending` les pièces déjà `clean` et éligibles ; `mail-sync` les traite
  au fil de l'eau.
- `claim_attachment_texts(p_limit integer)` — `service_role` seule : prend au plus `p_limit` pièces `pending` (ou prises
  depuis plus de 15 minutes), `for update skip locked`, compte l'essai, rend `id`, `storage_path`, `mime_type`, `filename`.
- `record_attachment_text(p_id uuid, p_status text, p_text text, p_truncated boolean)` — `service_role` seule : pose le
  résultat ; un échec avant le troisième essai remet la pièce `pending`, le troisième la passe `failed`.
- Contraintes : statut dans la liste fermée ; texte présent si et seulement si `extracted` ; longueur bornée.

## 4. L'extraction — dans `mail-sync`

### 4.1 Où et quand

Une boucle de plus dans `mail-sync`, à côté de la relève et de l'envoi : toutes les 30 secondes, elle prend 10 pièces
(`claim_attachment_texts`), télécharge chacune sous la clé de service, extrait, rend le résultat. Elle traite ainsi
uniformément les pièces reçues, envoyées et anciennes ; l'ingestion n'est pas modifiée. **Aucun service externe**, **aucune
variable d'environnement nouvelle** (constantes du service, documentées au DAT).

### 4.2 Les formats

- **PDF** : `pypdf`, dépendance nouvelle (pure Python, licence BSD-3, épinglée ; vérifications du CLAUDE.md §19 faites à
  l'ajout et consignées au DAT). Un PDF chiffré ou sans calque de texte rend `empty`.
- **Word et Excel (Office Open XML), OpenDocument** : bibliothèque standard seule — `zipfile` et `xml.etree` — sur
  `word/document.xml`, `xl/sharedStrings.xml` et les feuilles, `content.xml`. Un fichier qui n'a pas la structure attendue
  rend `unsupported`.
- Le texte est normalisé (espaces resserrés, paragraphes gardés), puis coupé à 200 000 caractères (`text_truncated`).

### 4.3 Les bornes

Un fichier reçu est hostile par principe. L'extraction tourne dans **un processus enfant** limité à 20 s de calcul, 512 Mo
de mémoire et 30 s de durée ; une archive Office est refusée au-delà de 1 000 entrées ou de 50 Mo décompressés (bombe de
décompression). Un dépassement rend `failed` sans nouvel essai. Le journal du service nomme la pièce par son identifiant
et le statut ; **jamais le texte ni le nom du fichier**.

## 5. À l'écran

### 5.1 Où

- **Boîte de réception** : sur une pièce saine d'un type retenu, « Aperçu » à côté de « Télécharger ».
- **Fil de l'affaire** : la ligne d'un courrier reçu ou envoyé liste désormais ses pièces (nom, taille, statut en toutes
  lettres pour une pièce non saine), avec les mêmes commandes. La lecture suit la règle du fil : elle n'a lieu que si le
  fil porte un courrier, filtrée sur l'affaire, sous la RLS.

### 5.2 La visionneuse

Une fenêtre modale large (`docs/DESIGN_SYSTEM.md`, section à écrire avant le code) :

- **Image** : affichée à la taille de la fenêtre, sans agrandissement au-delà de sa taille réelle.
- **PDF** : le lecteur du navigateur, dans un cadre. Le fichier est lu par le client de stockage (`download`, sous la
  session), puis montré depuis une adresse locale `blob:` dont le type est **forcé** par l'écran à l'un des cinq types
  retenus — c'est ce qui contourne `X-Frame-Options` sans l'assouplir. L'adresse est révoquée à la fermeture.
- **Texte extrait** (PDF et Office) : un panneau « Texte extrait » avec « Copier le texte » ; pour un fichier Office, c'est
  tout l'aperçu. États : extraction en cours, aucun texte lisible (« document numérisé ? »), échec, contenu non reconnu,
  texte tronqué.
- « Télécharger » dans la fenêtre ; « Fermer » et Échap ; focus piégé puis rendu au bouton d'origine.
- Au-delà de 25 Mo, pas d'aperçu : le téléchargement seul.
- États : chargement, échec de lecture (pièce indisponible), refus.

## 6. Le connecteur MCP — famille `messagerie`

La décision 788 **révise** la ligne « Les pièces jointes : ni lues ni envoyées » de `docs/SPEC-mcp.md` §9.2 decies : elles
se **lisent** ; l'envoi reste exclu.

| Outil | Action | Ancre | Ce qu'il fait |
|---|---|---|---|
| `crm_card_mail_list`, `crm_mail_get` (révisés) | `consulter` | inchangée | `attachment_count` est remplacé par `attachments` : pour chaque pièce, `id`, `filename`, `mime_type`, `size_bytes`, `status` (`available`, `scanning`, `infected`, `not_scanned`) |
| `crm_mail_attachment_get` (nouveau) | `consulter` | `attachment:attachment_id` (résolu par son message jusqu'à l'espace) | rend **la pièce elle-même** : une image comme contenu image, tout autre fichier comme ressource embarquée binaire avec son type et son nom ; métadonnées en contenu structuré |

- Seule une pièce `available` (`clean`) se rend ; les autres sont refusées en le disant (`attachment_not_available`).
- La pièce est lue **sous le jeton interne de la personne**, par l'API de stockage : la politique de la migration `0029`
  s'applique telle quelle — aucun accès de service.
- Borne : **25 Mo** (décision 789) ; au-delà, refus `attachment_too_large`, qui invite à ouvrir la pièce dans le CRM.
- Tout type de fichier sain se rend, pas seulement ceux de l'aperçu : c'est l'agent qui lit.
- Aucune famille nouvelle, aucune migration de la matrice ; l'**image `mcp`** est à reconstruire.

## 7. Sécurité

- Lire une pièce, son aperçu ou son texte : la RLS existante de `mail_attachments` et la politique de stockage `0029`,
  rien d'autre. Le texte d'une pièce non saine n'existe pas.
- Écrire le texte : `service_role` seule, par les deux fonctions ; `authenticated` reste sans écriture.
- Preuves de refus directes (CLAUDE.md §10) : `authenticated` ne peut ni appeler les deux fonctions ni écrire les colonnes ;
  une personne d'un autre espace ne lit ni la ligne ni le texte ; le connecteur refuse une pièce d'un message invisible, une
  pièce non saine, une pièce trop grande.

## 8. Seed, manuel, preuves

- **Seed** : un courrier **réellement reçu** (SMTP local, relève de `mail-sync`, antivirus local) classé dans une affaire,
  qui porte un PDF avec texte, un PDF numérisé sans texte, une image PNG, un fichier Word et un classeur Excel ; fichiers de
  démonstration versionnés sous `supabase/seed/`. Le seed attend que les cinq pièces aient leur statut de texte final, et
  le vérifie (`docs/SPEC-seed.md`, section à ajouter).
- **Manuel** : la boîte de réception et le fil de l'affaire gagnent une section « Aperçu d'une pièce jointe », illustrée
  (décision 736) ; le chapitre du connecteur cite le nouvel outil.
- **Preuves** : pgTAP (déclencheur, reprise, fonctions, refus) ; tests `mail-sync` (chaque format, bornes, bombe de
  décompression, PDF chiffré) et intégration jusqu'à la base par la vraie boucle ; unitaires et E2E de l'écran (inbox, fil,
  quatre paliers, clavier) ; tests du connecteur (contenu binaire, refus).

## 9. Déploiement

Une migration ; l'**image `mail-sync`** reconstruite (`pypdf`) ; la webapp ; l'**image `mcp`** reconstruite. Aucune variable
d'environnement nouvelle. Les pièces existantes sont extraites après la fenêtre, au rythme de la boucle.

## 10. Tranches

1. **T1 — en base** : migration, pgTAP, API, types ; `docs/SCHEMA.md`, `docs/PROD_MIGRATIONS.md`.
2. **T2 — l'extraction** : boucle de `mail-sync`, `pypdf`, tests, intégration ; DAT.
3. **T3 — l'écran** : design system, visionneuse dans la boîte de réception et le fil de l'affaire, seed, E2E, captures,
   manuel.
4. **T4 — le connecteur** : `crm_mail_attachment_get`, révision des deux outils de lecture, `docs/SPEC-mcp.md` §9.2 decies,
   tests.

## 11. Points soumis au responsable

1. Les pièces **envoyées** et celles du digest ont aussi leur aperçu et leur texte (même table, même règle).
2. Le texte est borné à **200 000 caractères** ; les bornes de l'extraction (§4.3) sont celles ci-dessus.
3. Le fil de l'affaire **liste désormais les pièces** de chaque courrier, ce qu'il ne faisait pas.
4. Le connecteur rend **tout fichier sain jusqu'à 10 Mo**, et ses deux outils de lecture listent les pièces au lieu de
   les compter. *(Révisé : 25 Mo, §12.)*
5. Les pièces déjà reçues sont extraites après la livraison (reprise de l'existant).

## 12. Points validés (décision 789, 2026-10-31)

Le responsable a validé la spécification : (1) le fil de l'affaire **liste les pièces** de chaque courrier, avec « Aperçu »
et « Télécharger » (« Oui, lister les pièces ») ; (2) le connecteur rend **tout fichier sain jusqu'à 25 Mo** (« Tout
fichier sain, 25 Mo » — la taille maximale d'une pièce reçue par défaut), et ses deux outils de lecture listent les pièces ;
(3) les autres points du §11 « validés tels quels » : pièces envoyées et du digest comprises, texte borné à 200 000
caractères, bornes de l'extraction du §4.3, reprise de l'existant après la livraison, quatre tranches.

## 13. Précisions d'exécution (`CRM-074` T1, migration `0141`)

Sans changer un point validé :
- `record_attachment_text` accepte un cinquième statut, **`retry`** : une erreur passagère (stockage indisponible) rend la
  pièce `pending` sous bail de 15 minutes, et le troisième essai la clôt en `failed`. `failed` reste définitif (bornes
  dépassées, §4.3).
- Une pièce dont le **troisième essai n'a jamais rendu de résultat** (boucle interrompue) passe `failed` à la prise suivante,
  au lieu d'être reprise sans fin.
- Un texte vide rendu `extracted` est inscrit `empty` ; un texte trop long est coupé à 200 000 caractères et marqué, même
  si l'extracteur ne l'a pas fait.
- Une pièce qui **cesse d'être saine** perd tout texte (déclencheur), ce que la contrainte `mail_attachments_text_clean_only`
  exige.


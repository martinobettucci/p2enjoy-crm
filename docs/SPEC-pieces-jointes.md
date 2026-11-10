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

~~Une fenêtre modale large~~ — **révisé par la décision 791 (INC-325)** : un **panneau dans le flux**, sous la ligne de la
pièce, la règle « aucune modale » du design system tenant (`docs/DESIGN_SYSTEM.md` §5.80) :

- **Image** : affichée à la taille de la fenêtre, sans agrandissement au-delà de sa taille réelle.
- **PDF** : le lecteur du navigateur, dans un cadre. Le fichier est lu par le client de stockage (`download`, sous la
  session), puis montré depuis une adresse locale `blob:` dont le type est **forcé** par l'écran à l'un des cinq types
  retenus — c'est ce qui contourne `X-Frame-Options` sans l'assouplir. L'adresse est révoquée à la fermeture.
- **Texte extrait** (PDF et Office) : un panneau « Texte extrait » avec « Copier le texte » ; pour un fichier Office, c'est
  tout l'aperçu. États : extraction en cours, aucun texte lisible (« document numérisé ? »), échec, contenu non reconnu,
  texte tronqué.
- « Télécharger » dans le panneau ; « Fermer l'aperçu » et Échap ; focus rendu à « Aperçu » (aucun piège de focus : ce
  n'est pas une modale).
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

## 14. Précisions d'exécution (`CRM-074` T2, `mail-sync`)

- La boucle est un fil du service (`PiloteExtraction`, sur le modèle de la veille) ; un lot revenu plein est suivi d'un
  autre sans attendre, ce qui écoule la reprise de l'existant. Une **route interne** authentifiée,
  `POST /internal/v1/attachments/extract`, fait le même lot à la demande : elle rend l'extraction observable et
  rejouable par les preuves, comme la relève et l'envoi. Les deux prennent par la base, sous bail.
- Un objet absent du stockage est **définitif** (`failed`) ; une panne de lecture est passagère (`retry`).
- Une erreur imprévue de l'analyseur sur un fichier malformé rend `unsupported` ; un dépassement de borne, de mémoire ou de
  durée rend `failed`.
- Les champs `attachment_id` et `text_status` entrent dans la liste fermée des champs du journal du service ; le nom du
  fichier et le texte n'y entrent pas.
- Les cinq pièces de démonstration (§8) sont produites par `supabase/seed/pieces-jointes/generer.py`, bibliothèque standard
  seule et sortie reproductible ; T2 les emploie déjà dans sa preuve d'intégration.

## 15. Précisions d'exécution (`CRM-074` T4, connecteur)

- La pièce est lue par `GET /storage/v1/object/authenticated/mail-attachments/<chemin>` **sous le jeton interne** de la
  personne : la politique de la migration `0029` décide. Le refus est vérifié dans l'ordre : statut de la pièce, taille de
  la ligne, puis taille réellement lue (la lecture s'interrompt au-delà de 25 Mo) ; un objet illisible rend le refus
  uniforme du connecteur (« introuvable ou hors de votre périmètre »).
- Une ressource embarquée porte l'adresse `crm://attachments/<id>/<nom>` ; le contenu porte aussi les métadonnées en
  texte, pour un client qui ne lit pas le contenu structuré.
- La garde de taille de l'audit du connecteur ne mesure que le texte et le contenu structuré : le binaire est borné par
  les 25 Mo seuls (décision 789).
- `docs/SPEC-mcp.md` §9.2 decies est révisée en conséquence. La mention de l'outil dans le manuel (chapitre du
  connecteur) arrive avec T3, en même temps que le reste du manuel de l'unité.

## 16. Précisions d'exécution (`CRM-074` T3, écran, seed, manuel)

- **Le fil de l'affaire lit les pièces par les messages de l'affaire**, et non par `mail_attachments.card_id` : mesuré sur le
  seed, une pièce reçue garde cette colonne nulle quand son message est classé par la règle 1 (INC-326).
- **La ligne d'une pièce et l'aperçu sont un composant partagé** (`webapp/src/app/PiecesJointes.tsx`) par l'inbox et le fil ;
  la ligne de l'inbox d'avant y est déplacée, son contrat inchangé, la taille ajoutée.
- **Le lecteur PDF des preuves** : le « headless shell » de Playwright n'en porte aucun, si bien que le cadre restait blanc
  sur les captures ; les preuves de l'aperçu et le scénario du chapitre 12 du manuel tournent sur le Chromium complet en
  nouveau mode sans tête (`channel: 'chromium'`), qui rend le PDF.
- **Sous `md`**, le nom en tête du panneau prend sa propre ligne (vu sur la capture à 390 px, `docs/DESIGN_SYSTEM.md` §5.80).
- **Le seed** (§35 de `docs/SPEC-seed.md`) déclenche l'extraction par la route interne de `mail-sync`, et vérifie l'état final.
- **Le manuel** : chapitre 12, « L'aperçu d'une pièce » et « Les pièces d'un courrier dans l'historique », quatre images ;
  chapitre 33, l'outil `crm_mail_attachment_get` (texte seul, aucune image nouvelle). L'état « extraction en cours » est
  décrit sans être cité, faute d'une image qui le montre (règle de la décision 736).


## 17. ClamAV en production, le repli confirmé, la reprise, les pièces jointes du connecteur — `CRM-143`

*Écrit avant le code, le 2026-11-10, session d5b44a2d. `docs/JOURNAL.md` décision 889 (l'arbitrage du responsable) et
décision 892 (les choix de conception). Origine : en production, les quatre pièces reçues sont `skipped`, faute
d'antivirus dans la cellule, et `skipped` ne se télécharge pas (`docs/SPEC-mail-subsystem.md` §4.3).*

**Connecteur MCP : oui, famille `messagerie`, cases existantes** (décision 889). Lire une pièce relève de `consulter`.
Joindre une pièce à un mail préparé relève de l'action qui prépare déjà le mail. Aucune famille, aucune case et aucune
migration de la matrice.

### 17.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :
- **(i) ClamAV dans la cellule de production** (§17.2), sous un plafond mémoire mesuré ;
- **(ii) le repli confirmé** (§17.3, §17.4) : une pièce **non analysée** — `skipped` faute d'antivirus, ou `pending`
  depuis plus de quinze minutes — se télécharge **après un avertissement et une confirmation**. La confirmation est
  persistée en base, par personne et par pièce, et c'est la base qui la lit (`CLAUDE.md` §10). Une pièce `infected` ne se
  télécharge **jamais** ;
- **(iii) la reprise** (§17.5) : `mail-sync` analyse les pièces `skipped` déjà reçues dès que l'antivirus répond. Saine,
  la pièce devient `clean` ; infectée, elle reste bloquée ;
- **(iv) les pièces jointes du connecteur** (§17.6) : `crm_mail_prepare` joint des fichiers au mail qu'il prépare, et
  `crm_mail_attachment_get` lit une pièce non analysée sur un accusé explicite. `crm_mail_send`, que nomme la décision
  889, n'existe plus : `CRM-128` l'a retiré sans alias, et le connecteur prépare sans jamais envoyer.

Non livré, et nommé :
- **aucun aperçu d'une pièce non analysée.** L'aperçu (§5) reste réservé aux pièces saines : il ouvre le fichier dans la
  page. Le repli ne fait que télécharger, après la confirmation ;
- **aucune reprise d'une pièce trop volumineuse.** Elle n'a jamais été déposée (§4.3 du sous-système), et il n'y a rien à
  analyser ;
- **aucune ligne au journal d'audit pour une confirmation** : la table de confirmation est elle-même la trace (qui, quoi,
  quand).

### 17.2 ClamAV dans la cellule

*Rectifié le 2026-11-10* : la cellule compte désormais **16 384 Mo, dont 15 030 disponibles, et 8 cœurs**, mesurés en
lecture seule par la session d9 après l'agrandissement par le responsable. Les « 2 Gio » de
`docs/spark-notes/CONTRIBUTORS.md` et de `docs/SPEC-deploiement-spark.md` §2 et §3.4, puis les « ≈ 1 960 Mo
disponibles » de la décision 889, sont dépassés. La décision ne se réécrit pas : un ajout daté le dit.

- **Le service `clamav`** entre dans `docker-compose.spark.yml`. Image `clamav/clamav:1.4.3`, celle du développement, avec
  la même sonde (`clamdcheck.sh`) et un volume nommé pour ses signatures (`clamav-data`) : un redémarrage ne les
  retélécharge pas. Aucun port publié : `mail-sync` le joint par le réseau de la pile (`CLAMAV_HOST=clamav`, déjà posé).
- **Le plafond** `mem_limit` vaut le double de l'empreinte **mesurée en développement** au pire moment, celui du
  rechargement des signatures, arrondi. Le rechargement garde son mode par défaut, concurrent : la mémoire ne manque plus,
  et un rechargement concurrent ne suspend pas les analyses. Mesure au repos le 2026-11-10 : **894 Mio**. La mesure au
  rechargement est faite au code, et le plafond l'en déduit.
- **Les signatures se mettent à jour** par le `freshclam` intégré à l'image. **Risque nommé** : la cellule doit joindre
  `database.clamav.net` en HTTPS. La sortie SMTP y est fermée (INC-349), et la sortie HTTPS n'est pas mesurée. Sans
  signatures, `clamd` ne démarre pas, et chaque pièce reste `skipped` : le produit échoue fermé, comme avant. Le contrat
  de déploiement prévoit la vérification et le recours, un miroir ou des fichiers CVD copiés.
  *Mesuré le 2026-11-10 en lecture seule par la session de livraison, depuis la cellule* : `database.clamav.net` répond en
  HTTPS en 27 ms, le réseau sort et le TLS passe. Mais un `curl` ordinaire reçoit `403` : le réseau de diffusion de ClamAV
  filtre les clients qui ne sont pas `freshclam`, et ce filtre ne se contourne pas. **La seule preuve probante est
  `freshclam` lui-même** : le contrat fait lancer, dans la fenêtre et avant le démarrage du service, l'image `clamav`
  épinglée dans un **conteneur jetable** de la cellule, `freshclam` puis la présence de `daily.cvd` ou des `.cld`. Si
  `freshclam` est refusé, le recours est un miroir privé ou des définitions déposées avec l'image, à arbitrer par le
  responsable.
- **Le disque** : l'image et les signatures pèsent de l'ordre de 650 Mo. Le contrat exige `df -h /` avant la livraison.
- `docs/SPEC-deploiement-spark.md` §3.4 et §8, `docs/spark-notes/CONTRIBUTORS.md` et `README.md` §11 sont révisés avec le
  code.

### 17.3 Le repli confirmé, en base

**Une pièce est NON ANALYSÉE** quand `av_status = 'skipped'` **et que son objet est déposé**, ou quand `av_status =
'pending'` depuis plus de **quinze minutes**. Le délai est une constante de la fonction, nommée et commentée. Un `pending`
plus jeune est une analyse en cours, pas une panne.

**Pourquoi un `skipped` a eu lieu** se garde dans une colonne nouvelle, `mail_attachments.av_skip_reason` :
- `scanner_unavailable`, quand l'antivirus n'a pas répondu ;
- `too_large`, quand la pièce dépasse `MAIL_MAX_ATTACHMENT_MB` et n'a pas été déposée.

La colonne est nulle hors de `skipped`, par contrainte. `mail-sync` l'écrit. La migration la pose sur les lignes
existantes : `scanner_unavailable` si l'objet existe dans `storage.objects`, `too_large` sinon. L'écran dit ainsi pourquoi
une pièce n'est pas analysée, sans attendre un refus.

**La confirmation est une ligne**, table nouvelle `public.mail_attachment_risk_acknowledgments` :
- colonnes `attachment_id` (`on delete cascade`), `user_id` (`profiles`, `on delete cascade`), `acknowledged_at` ;
- clé primaire `(attachment_id, user_id)` ;
- RLS : chacun lit ses lignes, personne n'écrit directement, `anon` rien.

Elle s'écrit par une fonction, **`public.acknowledge_unscanned_attachment(p_attachment_id uuid) returns timestamptz`**,
`security definer`, exécutable par `authenticated` seul. Ses refus :

| Cas | Code |
|---|---|
| Sans session | `not_authenticated` (`42501`) |
| Pièce absente, ou message invisible pour l'appelant | `app.raise_http_error(404, 'attachment_not_found')` : l'absence et l'interdit ne se distinguent pas |
| Pièce `infected` | `attachment_infected` (`42501`) : **jamais**, quoi qu'on confirme |
| Pièce `clean` | `attachment_clean` (`22023`) : rien à confirmer |
| Pièce `pending` depuis moins de quinze minutes | `attachment_scanning` (`55000`) : l'analyse est en cours |
| Pièce `skipped` sans objet déposé (`too_large`) | `attachment_not_stored` (`55000`) |

Une seconde confirmation de la même pièce rend la date de la première : le geste est idempotent.

**La règle du téléchargement est celle de la base.** `app.piece_jointe_telechargeable(text)` (migration `0028`), qui porte
la politique de lecture du bucket, est reprise à l'identique, avec un ajout : une pièce **non analysée** se lit aussi quand
l'appelant l'a **confirmée**. Elle exige donc une ligne de confirmation pour `auth.uid()` et la visibilité du message.
**`infected` reste refusée à tous**, et l'anonyme reste refusé sur tout. La politique `mail_attachments_objets_lecture`
(`0029`) ne change pas : elle appelle la fonction.

**Une confirmation ne survit pas à un verdict.** Si la reprise passe la pièce en `clean`, la confirmation devient sans
objet ; si elle la passe en `infected`, la fonction refuse quand même. Aucune ligne n'a besoin d'être effacée.

### 17.4 Le repli à l'écran

Le §5.4 du design system et le §17 du chapitre de l'inbox posaient qu'une pièce non saine n'a **pas** de commande. Ils
sont révisés pour la seule pièce **non analysée** :
- **sa ligne** dit pourquoi, en toutes lettres : « non analysée : antivirus indisponible », « non analysée : analyse en
  attente », ou, pour `too_large`, « non analysée : trop volumineuse, non conservée », cette dernière **sans aucune
  commande** ;
- **une commande « Télécharger quand même »**, bouton discret compact, icône Lucide ~~`ShieldAlert`~~ **`ShieldQuestion`** (*précisé à l'écriture du code* : `ShieldAlert` sert déjà l'état de refus, `docs/DESIGN_SYSTEM.md` §9 et §5.95), ouvre sous la ligne un
  **avertissement dans le flux**, jamais une modale (§5.13). Il porte une phrase qui dit le risque — « Ce fichier n'a pas été
  analysé par l'antivirus : il peut contenir un logiciel malveillant. Ne l'ouvrez que si vous connaissez l'expéditeur et
  attendiez ce fichier. » —, puis « Je comprends le risque, télécharger » et « Annuler » ;
- **la confirmation appelle la fonction, puis télécharge** par l'API de stockage, sous le jeton de la personne. Un refus
  se dit dans l'avertissement, `role="alert"`, par un dictionnaire fermé : pièce introuvable, infectée, en cours
  d'analyse, non conservée, réseau ;
- **une pièce déjà confirmée** n'en demande plus : sa ligne porte « Télécharger », et la mention « non analysée » reste ;
- **une pièce `infected`** garde sa forme : son statut en toutes lettres, aucune commande.

Les règles visuelles s'écrivent au `docs/DESIGN_SYSTEM.md`, au premier paragraphe libre à l'écriture de l'écran (le §5.94
est pris par `CRM-137`), après sa lecture intégrale.

### 17.5 La reprise, dans `mail-sync`

- **Une fonction de base**, `public.mail_attachments_to_rescan(p_limit int) returns table (id, storage_path, mime_type)`,
  réservée à `service_role`. Elle rend les pièces `skipped` dont la raison est `scanner_unavailable`, ou `pending` depuis
  plus de quinze minutes, les plus anciennes d'abord.
- **Une fonction d'écriture**, `public.mail_attachment_record_scan(p_attachment_id uuid, p_status text) returns void`,
  réservée à `service_role`. Elle passe une pièce non analysée en `clean` ou en `infected`, rien d'autre : une pièce déjà
  jugée n'est pas réécrite. Le déclencheur de `0141` pose alors l'extraction du texte d'une pièce devenue saine.
- **Une boucle** `PiloteReprise` dans le service, sur le patron de `PiloteExtraction` (§4.1), et une route interne
  `POST /internal/v1/attachments/rescan?limit=n` qui exécute un lot à la demande. Un lot télécharge chaque objet sous la
  clé de service, le soumet à `clamd` par la fonction existante (`antivirus.analyser_contenu`), puis écrit le verdict.
- **Si l'antivirus ne répond toujours pas**, le lot s'arrête au premier `skipped` et n'écrit rien : la pièce reste non
  analysée, et le lot suivant réessaiera.
- **Le rythme** : un lot de 20 pièces toutes les 15 minutes, et au démarrage du service. Les pièces de production seront
  donc reprises au premier lot après la livraison.
- **Le journal** : `reprise_antivirus_lot` avec ses compteurs (`analysees`, `saines`, `infectees`, `restees`), jamais un
  nom de fichier (§4.3 du sous-système). Une infection est journalisée avec l'identifiant de la pièce, sans signature.
- **L'ingestion écrit `av_skip_reason`** quand elle range une pièce en `skipped`, avec les deux valeurs du §17.3.

### 17.6 Le connecteur

- **`crm_mail_attachment_get`** gagne `acknowledge_unscanned: bool = false`. Sur une pièce non analysée, sans ce paramètre,
  l'outil refuse en le disant : `attachment_not_scanned`, avec la raison et le moyen, le paramètre. Avec le paramètre, il
  appelle `acknowledge_unscanned_attachment` **sous le jeton de la personne**, puis lit la pièce : la confirmation est
  celle de la personne au nom de qui l'assistant agit. Une pièce `infected` est refusée dans tous les cas. Les statuts
  rendus par les outils de lecture gagnent `not_scanned_unavailable`, `not_scanned_too_large` et `scanning`.
- **`crm_mail_prepare`** gagne `attachments`, une liste d'au plus 10 objets `{filename, content_base64, mime_type?}`, 10 Mo
  décodés au plus en tout, les bornes de l'envoi (`CRM-058` T2). Le connecteur dépose chaque fichier dans
  `mail-outbound-attachments`, au chemin `<espace>/<personne>/<uuid>/<nom>`, sous le jeton de la personne : c'est la
  politique de dépôt de `0107` qui s'applique. Puis il appelle `prepare_email` avec les chemins.
- **Le mail préparé garde ses pièces** : `mail_drafts.attachments`, colonne nouvelle, la forme de `mail_outbox.attachments`.
  `prepare_email` gagne `p_attachments jsonb`, validée comme dans `queue_outbound_email` : au plus 10, 10 Mo, des objets
  existants déposés par l'appelant. `depots_envoi_abandonnes` épargne les objets cités par un mail préparé **en attente**.
- **La relecture** dans l'inbox (§5.90 du design system) précharge ces pièces dans le formulaire d'envoi, qui les montre
  comme des fichiers joints, retirables. L'envoi passe leurs chemins à `send_email_draft`, qui les accepte déjà.
- `docs/SPEC-mcp.md` §9.2 est révisée avec l'outil. L'image `mcp` est à reconstruire.

### 17.7 Migration

Une migration, au premier numéro libre au push (arbitrage de la session de livraison du 2026-11-10) :
- `mail_attachments.av_skip_reason`, sa contrainte et sa reprise ;
- la table de confirmation et ses droits ;
- `acknowledge_unscanned_attachment` ;
- `app.piece_jointe_telechargeable`, reprise ;
- `mail_attachments_to_rescan` et `mail_attachment_record_scan` ;
- `mail_drafts.attachments` ;
- `prepare_email`, reprise avec `p_attachments` : son ancienne signature est retirée, PostgREST ne départageant pas deux
  surcharges ;
- `depots_envoi_abandonnes`, reprise.

`docs/SCHEMA.md` la décrit, avec son retrait.

### 17.8 Seed

« Une pièce par statut », par les vrais chemins (`CLAUDE.md` §8) :
- `clean` : les cinq pièces existantes ;
- `infected` : un courrier portant l'échantillon EICAR, relevé et analysé par le vrai ClamAV ;
- `skipped` (`too_large`) : un courrier portant une pièce au-delà de `MAIL_MAX_ATTACHMENT_MB`, relevé par le vrai service.
  Le poids de ce courrier est mesuré au code, et la borne de développement peut être baissée pour le seed si le serveur de
  messagerie le refuse.

Une pièce `skipped` (`scanner_unavailable`) n'est **pas** seedée : elle naît quand l'antivirus est absent, et la reprise la
rendrait `clean` dans le quart d'heure. Elle naît dans les preuves, par le patron de l'exemplaire jetable (§17.9).

### 17.9 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | `acknowledge_unscanned_attachment` : chaque refus du tableau, l'idempotence, `anon` refusé. `app.piece_jointe_telechargeable` : `skipped` refusé sans confirmation, permis avec la confirmation de l'appelant **et pas** celle d'un autre, `infected` refusé même confirmé, `pending` jeune refusé, `pending` vieux permis avec confirmation, message invisible refusé. `mail_attachment_record_scan` : refusée à `authenticated`, ne réécrit pas une pièce jugée. `prepare_email` : pièces validées, bornes |
| pytest | la reprise : un lot qui passe `skipped` en `clean` et en `infected`, un antivirus muet qui n'écrit rien, le journal sans nom de fichier ; l'ingestion qui écrit `av_skip_reason` |
| API (Playwright, jetons réels) | le téléchargement d'une pièce `skipped` refusé sans confirmation, permis après, refusé pour une collègue qui n'a pas confirmé ; `infected` refusé avant et après ; l'anonyme refusé. Retourne l'assertion « `skipped` non » de `e2e/api/inbox.spec.ts` (décision 51 : retournée, non retirée) |
| E2E `mail`, vrai ClamAV | sur un **exemplaire jetable** de `mail-sync`, `CLAMAV_HOST` injoignable, le service partagé arrêté le temps de la preuve (§12.6 du sous-système, règle 3) : une pièce naît `skipped` (`scanner_unavailable`) ; le service partagé revenu, la route de reprise la passe en `clean`. L'échantillon EICAR naît `infected` et y reste |
| E2E `ui`, souris et clavier | l'avertissement, la confirmation et le téléchargement réel ; l'annulation ; le refus d'une pièce infectée (aucune commande) ; captures aux quatre paliers |
| Connecteur | les deux outils dans `scripts/verify-mcp.sh` : refus sans accusé, lecture avec ; un mail préparé avec deux pièces, puis relu dans l'inbox avec ses pièces |
| Mémoire | `docker stats` de `clamav` en développement, au repos et au rechargement des signatures ; le plafond s'en déduit |
| Manuel | le chapitre de l'inbox : le statut d'une pièce, le repli, son avertissement ; le chapitre du connecteur |

### 17.10 Tranches

1. **T1, base** : la migration et pgTAP.
2. **T2, `mail-sync`** : `av_skip_reason` et la reprise, avec pytest et l'E2E `mail`.
3. **T3, la cellule** : `clamav` dans `docker-compose.spark.yml`, la mesure, le contrat de déploiement et les notes.
4. **T4, l'écran** : le repli, le préchargement des pièces d'un mail préparé, l'API, l'E2E `ui`, les captures, le design
   system et le manuel.
5. **T5, le connecteur** : les deux outils, `verify-mcp.sh` et `docs/SPEC-mcp.md`.
6. **T6, le seed** : les statuts `infected` et `skipped`.

Une livraison emporte ensemble la migration, les images `mail-sync` et `mcp`, la webapp et le service `clamav`. Le
contrat de déploiement les ordonne.

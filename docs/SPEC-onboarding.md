# Spécification — guide de démarrage

Unité de backlog : `CRM-079` (`docs/BACKLOG.md`, « Onboarding guidé au premier lancement »).
Documents liés : `docs/DESIGN_SYSTEM.md` §5.17 (de quoi l'écran a l'air), §5.8 (états), §7, §8 ;
`docs/SPEC-webapp.md` §5.2 (routes), §6.4 (contrat asynchrone), §11 (stockage côté client) ;
`docs/SPEC-permissions-rls.md` §4 ; `docs/SPEC-administration-arborescence.md` ;
`docs/SPEC-mail-subsystem.md` §20.11 ; `CLAUDE.md` §10 et §11.

Ce document est écrit **après mesure sur la pile réellement démarrée et seedée**, le 2026-08-15
(§3.1), et committé **avant la première ligne de code** (`CLAUDE.md` §5).

---

## 1. Objet, et le défaut qu'il corrige

Un compte qui se connecte pour la première fois arrive sur `/`, qui rend « Aucun board à
afficher ». Cet état est exact — aucun channel n'est ouvert — mais il n'enseigne rien : ni ce que
le produit attend, ni par où commencer, ni où sont les écrans qui font le travail.

`CRM-079` livre un **guide de démarrage** : une liste ordonnée d'étapes, chacune renvoyant vers un
écran **réellement livré**, et chacune portant un état d'avancement **mesuré sur la base**.

### 1.1 Dans le périmètre

| Élément | Motif |
|---|---|
| Cinq étapes de démarrage, mesurées et non déclarées (§3) | DoD de `CRM-079` |
| Un écran de guide, à son adresse propre `/demarrage` (§4.1) | « interrompable et relançable » |
| Le guide rendu sur `/` tant qu'il reste une étape à faire (§4.2) | « premier lancement » |
| Interruption pour la session, sans stockage persistant (§5) | DoD, `CLAUDE.md` §11 |
| Les quatre états du §5.8 du design system, plus l'étape non mesurable (§6) | `docs/DESIGN_SYSTEM.md` §5.8 |
| Entrée dans l'index des réglages (§4.3) | patron des quatre surfaces existantes |

### 1.2 Hors périmètre, et nommé comme tel

| Élément | Motif |
|---|---|
| Toute écriture | Le guide **lit et renvoie**. Il ne crée ni track, ni channel, ni affaire. |
| Toute création assistée « en trois clics » | Ce serait un second chemin de création, concurrent des écrans livrés, à spécifier et à prouver deux fois. |
| Toute persistance de progression côté serveur | La progression n'est pas une donnée : elle est un **calcul** sur des données qui existent déjà (§3). Une colonne `onboarding_step` dériverait de l'état réel dès la première suppression. |
| Toute visite guidée par surimpression (« coach marks ») | Le §5 du design system ne déclare aucune surface flottante, et `CRM-043` puis `CRM-075` ont déjà écarté la modale. |
| Toute mesure d'usage, tout traceur | `CLAUDE.md` §11. |

## 2. Le principe, en une phrase

**La progression est une mesure, jamais un drapeau.**

Aucune étape n'est « cochée » par un état stocké. Chaque étape porte une **question** à laquelle la
base répond à chaque affichage. Conséquences, toutes voulues :

- rien à migrer, rien à réparer : supprimer le dernier track décoche l'étape correspondante ;
- rien à persister sur l'appareil : le guide n'a besoin d'aucun consentement (`CLAUDE.md` §11) ;
- aucun écran factice : une étape accomplie l'est parce que l'objet **existe**, pas parce qu'un
  parcours a été suivi.

## 3. Les cinq étapes et leur mesure

Chaque mesure est un comptage `HEAD` avec `count=exact` sur une table déjà lue ailleurs par
l'application. **Aucune politique RLS n'est ouverte, modifiée ni contournée par cette unité** :
chaque table est interrogée exactement sous la politique qui la régit déjà.

| # | Clé | Ce que l'étape établit | Lecture | Écran qui l'accomplit |
|---|---|---|---|---|
| 1 | `espace` | Un espace de travail est accessible | `workspaces` | aucun — l'étape est accomplie par la connexion |
| 2 | `track` | Au moins un track vivant | `tracks`, `archived_at is null`, `deleted_at is null` | `/reglages/arborescence` |
| 3 | `channel` | Au moins un channel vivant | `channels`, mêmes deux filtres | `/reglages/arborescence` |
| 4 | `affaire` | Au moins une affaire | `cards`, `deleted_at is null` | `/reglages/arborescence` (le board s'ouvre depuis un channel) |
| 5 | `messagerie` | Au moins une boîte entrante déclarée | `mail_inbound_accounts` | `/reglages/messagerie` |

Les filtres des étapes 2, 3 et 4 sont **ceux des lectures existantes** — `webapp/src/lib/tracks.ts`
et `webapp/src/lib/corbeille.ts` posent déjà que l'archivage masque et que la corbeille retire. Une
étape qui compterait un track en corbeille se dirait accomplie par un objet que l'écran ne montre
nulle part.

L'étape 1 ne renvoie vers aucun écran : elle n'est pas décorative pour autant. Un espace de travail
illisible rend les quatre suivantes indécidables, et l'écrire est la seule façon de distinguer
« votre compte n'appartient à aucun espace » de « votre espace est vide ».

### 3.1 Ce qui a été MESURÉ, le 2026-08-15, sur la pile seedée

Requêtes émises hors interface, `Prefer: count=exact`, `Range: 0-0`, contre `http://127.0.0.1:8000` :

| Table | `admin@p2enjoy.test` | `viewer@p2enjoy.test` | clé anonyme |
|---|---|---|---|
| `workspaces` | `200` — 1 | `200` — 1 | `200` — 0 |
| `tracks` (vivants) | `206` — 3 | `206` — 3 | `200` — 0 |
| `channels` (vivants) | `206` — 6 | `206` — **5** | `200` — 0 |
| `cards` (vivantes) | `206` — 14 | `206` — **9** | `200` — 0 |
| `mail_inbound_accounts` | `206` — 3 | `200` — **0** | **`401`** |

Trois faits que cette mesure impose au produit, et qu'aucun souvenir n'aurait donnés :

1. **Un comptage n'est pas un inventaire : c'est ce que l'appelant peut voir.** Le `viewer` compte
   5 channels et 9 affaires là où la base en porte 6 et 14, ses droits fins fermant le reste
   (`docs/SPEC-seed.md` §2.5). Le guide **n'affirme donc jamais** qu'un objet n'existe pas : il
   écrit que l'appelant n'en voit aucun. Le libellé de l'étape non accomplie le dit en toutes
   lettres (§6.2).
2. **Le `viewer` compte zéro boîte entrante alors que trois existent.** La cinquième étape lui
   paraîtra donc toujours à faire, et l'écran vers lequel elle renvoie ne lui montrera rien de
   plus. C'est le comportement correct — l'interface ne calcule aucun droit (`CLAUDE.md` §10) —
   mais c'est aussi une **limite nommée** au §9, et non un défaut à corriger par un test de rôle.
3. **`mail_inbound_accounts` répond `401` à la clé anonyme**, là où les quatre autres tables
   rendent `200` et zéro ligne. La cinquième mesure est donc la seule à pouvoir rendre un état
   d'**erreur** plutôt qu'un état vide, et le §6.3 lui donne son traitement propre. Le cas n'est
   pas théorique pour autant qu'il soit rare : il survient dès qu'une session expire pendant que
   l'écran est ouvert.

### 3.2 Cinq comptages, une seule décision

Les cinq lectures sont émises **en parallèle** et rendues comme **cinq états indépendants**. Aucune
n'est conditionnée à la précédente : subordonner la mesure d'un channel à l'existence d'un track
ferait passer un refus de lecture pour une absence, et l'écran n'aurait plus rien à dire de l'étape
qu'il n'a pas mesurée.

Une réponse aboutie dont le `count` est absent est un **contrat rompu**, pas une absence : elle est
rendue en erreur, comme `lireCompteursFileSortante` le fait déjà (`webapp/src/lib/mail-etat.ts`).

## 4. Où le guide vit

### 4.1 Une adresse propre : `/demarrage`

Même patron que les quatre surfaces d'administration existantes (`webapp/src/app/routes.tsx`) :
une constante `CHEMIN_DEMARRAGE`, hors de la table `ROUTES`, montée par `App` avec sa propre
coquille. Le guide y est **toujours** rendu, même intégralement accompli, et même masqué pour la
session (§5) : c'est ce qui le rend **relançable**, exigence explicite de la Definition of Done.

### 4.2 Sur `/`, tant qu'il reste une étape à faire

`/` rend aujourd'hui l'état vide `route.board.empty`. Il rendra désormais :

| Condition | Contenu de `/` |
|---|---|
| Au moins une étape non accomplie, guide non masqué | le guide, avec sa commande « Masquer » |
| Toutes les étapes accomplies | l'état vide existant, inchangé |
| Guide masqué pour la session | l'état vide existant, **plus** un lien discret vers `/demarrage` |
| Une mesure encore en vol | les squelettes du guide (§6.1), jamais l'état vide |

La dernière ligne n'est pas un détail : rendre l'état vide pendant le chargement ferait clignoter
l'écran d'accueil à chaque ouverture, et afficherait « aucun board » à qui en a.

Le guide n'est pas rendu ailleurs. Aucune surimpression, aucune bannière sur les écrans métier :
une aide au démarrage qui suit l'utilisateur partout devient un bandeau qu'on apprend à ignorer.

### 4.3 Une entrée dans l'index des réglages

`IndexReglages` gagne une cinquième entrée, en **première** position — un guide de démarrage se lit
avant les écrans qu'il présente. Elle porte le même patron que les quatre autres : titre, phrase
d'explication, cible `--size-target`.

### 4.4 Aucune mesure sans session — et le défaut mesuré qui l'impose

**Ajouté le 2026-08-15, après mesure de la campagne complète.** Les §4.1 et §4.2 ci-dessus
décrivaient les deux surfaces sans distinguer l'appelant. Une fois le guide monté sur `/`, la
campagne a rendu **une régression réelle**, et elle n'était pas un défaut de preuve :

```
console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Un visiteur **non connecté** qui ouvre `/` déclenchait les cinq comptages. Quatre aboutissent —
`200` et zéro ligne, le refus par défaut — mais `mail_inbound_accounts` **refuse la clé anonyme**
par `401` (§3.1, fait 3). Le navigateur écrivait donc une erreur dans la console sur l'écran
d'arrivée du produit, là où le dépôt exige une console vierge.

**La règle, et elle vaut pour les deux surfaces :** tant que l'état d'authentification n'est pas
`authentifie`, **aucune mesure n'est émise**.

| État de session | `/` | `/demarrage` |
|---|---|---|
| `chargement` — la session se restaure | l'état vide existant, sans mesure | le guide en chargement, sans mesure |
| `anonyme` | l'état vide existant, **inchangé** | le guide, ses cinq étapes en chargement, sans mesure |
| `authentifie` | le §4.2, sans changement | le §4.1, sans changement |

Trois motifs, et le premier suffirait :

1. **La mesure serait fausse.** Le guide écrit ce que l'appelant voit (§3.1, fait 1). Un visiteur
   sans session ne voit rien, non parce que son espace est vide, mais parce qu'il n'est pas
   connecté. Lui afficher « créez un premier track » nommerait le mauvais problème : ce que la
   coquille lui dit déjà — espace absent, aucun track — est le message exact.
2. **Le §1 le disait déjà.** « Un compte **qui se connecte** pour la première fois arrive sur `/` ».
   L'onboarding s'adresse à une session, et l'étape 1 est « accomplie par la connexion » (§3).
3. **Une console salie n'est pas un état d'écran.** Le §6.1 traite le refus reçu par une session
   qui expire — un cas rare, provoqué, et que l'écran explique. Il ne justifie pas d'émettre une
   requête vouée au refus à chaque ouverture de l'accueil par un visiteur.

Ce n'est pas une règle d'autorisation déplacée dans l'interface (`CLAUDE.md` §10) : rien n'est
autorisé ni refusé ici, et aucun rôle n'est interrogé. C'est le **choix de ne pas poser une
question dont l'appelant ne peut pas être le sujet**. Les politiques restent seules juges de ce
que la session, une fois ouverte, obtient — et le §6.1 garde son traitement du refus reçu en cours
de session.

## 5. Interruption et reprise — ce qui est stocké, et où

| Donnée | Support | Catégorie `CLAUDE.md` §11 |
|---|---|---|
| Guide masqué sur `/` | `sessionStorage`, clé `p2enjoy.demarrage.masque` | 2 — préférence d'interface, limitée à la session |

Rien d'autre. Aucun `localStorage`, aucun cookie, aucun traceur, aucune progression persistée.
Le mécanisme est celui, déjà éprouvé, du repli de la barre latérale
(`webapp/src/app/preferences.ts`) : lecture et écriture sous `try`, repli silencieux sur le défaut
lorsque le stockage de l'onglet est indisponible — ne pas pouvoir mémoriser une préférence
d'affichage n'empêche pas de l'appliquer pour la vue courante.

**Ce que « reprise de session » veut dire ici, précisément :**

- **rechargement de l'onglet** : le guide masqué reste masqué, et la progression est **re-mesurée**.
  Elle n'est jamais restaurée d'un cache : deux onglets ouverts sur le même compte montrent le même
  état parce qu'ils lisent la même base, pas parce qu'ils se synchronisent ;
- **nouvel onglet, ou onglet rouvert** : le guide réapparaît sur `/` s'il reste une étape à faire.
  C'est voulu — la préférence est explicitement limitée à la session, et la ressusciter d'un
  stockage persistant demanderait un consentement que rien ne justifie ;
- **`/demarrage`** ignore la préférence dans tous les cas.

## 6. États, et il y en a cinq

### 6.1 Les quatre du design system §5.8

| État | Rendu |
|---|---|
| Chargement | un squelette **par étape**, à la forme de la ligne attendue. Aucun spinner. |
| Vide | sans objet : une étape non accomplie **est** le contenu de l'écran, pas un vide. |
| Erreur | une ligne d'étape en erreur porte son message et l'action de reprise, qui **relance réellement** les cinq mesures. |
| Absence de droit | un refus (`401`/`403`) est rendu comme tel sur la ligne concernée, sans bouton de reprise : il est définitif tant que la session ne change pas. |

L'erreur est **par étape**, jamais globale : quatre mesures abouties et une refusée doivent laisser
lire les quatre. Remplacer l'écran entier par un état d'erreur perdrait ce que le guide a mesuré.

### 6.2 Les trois états d'une étape

`accomplie`, `à faire`, `non mesurable`. Aucun n'est deviné :

- **accomplie** : `count >= 1`. La ligne porte l'icône `CircleCheck`, la mention « Fait » en toutes
  lettres, et **conserve son lien** vers l'écran concerné : accompli ne veut pas dire terminé, on
  ajoute un second track.
- **à faire** : `count === 0`. La ligne porte l'icône `Circle`, le libellé de l'action, et la phrase
  qui dit **ce que l'appelant voit**, non ce qui existe (§3.1, fait 1).
- **non mesurable** : la lecture a échoué. La ligne le dit — « cette étape n'a pas pu être
  vérifiée » — et **n'éteint jamais son lien**. C'est la règle déjà posée par le §5.15 du design
  system pour la prévisualisation : une mesure indisponible est une aide à la décision manquante,
  pas un refus de droit.

### 6.3 Aucune étape n'est jamais désactivée

Ni par son état, ni par le rôle de l'appelant. Le guide **n'interroge aucun rôle** : il renvoie vers
des écrans qui portent déjà leurs propres refus, mesurés et prouvés par leurs unités. Un lien éteint
d'après un rôle lu côté client ferait passer une règle de base pour une décision d'interface
(`CLAUDE.md` §10) — et le `viewer` mesuré au §3.1 en serait la première victime.

## 7. Accessibilité et clavier

- La liste des étapes est une `ol` : elles sont **ordonnées**, et un lecteur d'écran doit l'annoncer.
- L'état d'une étape est porté par un **texte**, jamais par la seule icône ni la seule couleur
  (`docs/DESIGN_SYSTEM.md` §1, §8). L'icône est `aria-hidden`, le libellé la double.
- La progression globale est écrite en toutes lettres — « 3 étapes sur 5 » — et non rendue par une
  barre seule. La barre, si elle existe, porte `aria-hidden` et le texte porte l'information.
- Le changement de progression après une reprise est annoncé par la région `aria-live` polie déjà
  posée par la coquille.
- Chaque lien est une cible d'au moins `--size-target`, atteignable au clavier dans l'ordre visuel ;
  l'anneau de focus est celui du produit.
- « Masquer le guide » est un `button` ; l'activer rend le focus au contenu principal, jamais à un
  élément qui vient de disparaître (règle déjà posée par le §5.10 du design system).

## 8. Preuves attendues

| Preuve | Ce qu'elle établit |
|---|---|
| Unitaires (`npm run test:unit`) | les cinq requêtes émises portent exactement les filtres du §3 ; un `count` absent rend une erreur ; les trois états d'étape du §6.2 ; la préférence du §5 vit en `sessionStorage` et nulle part ailleurs |
| E2E interface (`npm run e2e:ui`) | guide rendu sur `/` avec un compte seedé ; parcours **au clavier seul** ; masquage puis reprise après rechargement ; `/demarrage` rendu malgré le masquage ; palier mobile ; `localStorage` **vide** en fin de parcours ; console vierge |
| E2E interface, états incomplets | une mesure rendue en échec au niveau du **réseau** produit la ligne « non mesurable », les quatre autres restant lisibles |
| Captures | quatre paliers du §7 du design system, plus l'état « tout accompli », produites depuis l'application exécutée et **observées** (`CLAUDE.md` §16) |
| Hors interface | les cinq comptages rejoués avec le jeton réel d'`admin` et de `viewer` : les écarts du §3.1 sont le fait du backend, pas de l'écran |

Aucune preuve ne substitue une réponse réseau pour simuler une étape accomplie : les étapes sont
accomplies par les **données seedées**, qui portent déjà tracks, channels, affaires et boîtes.

## 8 bis. Contrat du harnais dédié — `scripts/verify-onboarding.sh`

**Ajouté le 2026-08-16.** Le §9 déclarait qu'aucun harnais ne serait écrit tant qu'aucun
`scripts/verify-*.sh` ne serait exécutable dans l'environnement de vérification. **Ce blocage est
levé** : `nvm install 24` pose `v24.19.0` / `npm 11.17.0` sur cet hôte, procédure mesurée et
consignée dans `docs/CloudWorker.md` §2.1 bis et `docs/JOURNAL.md` du 2026-08-15. Le motif du §9
ayant disparu, le harnais est dû — et il est écrit ici avant d'être codé.

Il rassemble ce que les preuves du §8 laissent dispersé entre cinq fichiers, et il n'ajoute aucune
règle : un harnais qui trancherait ce que ce document laisse ouvert serait une seconde
spécification, concurrente et non arbitrée.

### 8 bis.1 Les comptes figés

Le harnais fige les **fichiers ET les tests**, jamais les seules assertions : vérifier un total
d'assertions ne détecte pas la disparition d'une suite entière (décision 279). Ces comptes se
mettent à jour **dans le même changement** que la preuve ajoutée — un compte qui monte est un écart
au même titre qu'un compte qui descend.

| Grandeur | Valeur figée | Mesurée le |
|---|---|---|
| Vitest, filtre `demarrage` | **2 fichiers, 43 tests** | 2026-08-16 |
| `e2e/api/demarrage.spec.ts` | **6 scénarios** | 2026-08-16 |
| `e2e/ui/demarrage.spec.ts` | **10 scénarios** | 2026-08-16 |
| Captures sous `docs/captures/CRM-079/` | **9** — quatre paliers, plus cinq états | 2026-08-16 |

Aucun compte pgTAP n'est figé, et c'est une propriété de l'unité, pas un oubli : `CRM-079`
**n'ajoute aucune migration** et n'ouvre aucune politique (§3). Ses cinq lectures sont régies par
les politiques de `CRM-020`, `CRM-021`, `CRM-040`, `CRM-022` et `CRM-052`, prouvées par leurs
propres suites. Le harnais qui rejouerait ces suites mesurerait le travail d'autres unités.

### 8 bis.2 Non-complaisance — cinq dégradations réelles

Un harnais qui rend vert sans rien exercer est pire qu'une commande absente
(`docs/SPEC-test-harness.md` §1). Le harnais dégrade donc réellement les deux fichiers de l'unité,
et **exige que la suite unitaire rougisse** à chaque fois. Une dégradation NON VUE est un échec du
harnais : le remède est alors d'écrire la preuve manquante, jamais de retirer la dégradation.

| # | Ce qui est dégradé | La règle que la dégradation attaque |
|---|---|---|
| 1 | le filtre `deleted_at` des tracks (`FILTRES_ETAPES_DEMARRAGE`) | §3 : une étape accomplie par un objet en corbeille se dirait accomplie par ce qu'aucun écran ne montre |
| 2 | le refus du `count` absent (`mesurerEtape`) | §3.2 : une réponse aboutie sans `count` est un contrat rompu, jamais un zéro |
| 3 | le seuil d'accomplissement (`estAccomplie`) | §6.2 : une étape est accomplie **dès la première ligne visible**, pas avant |
| 4 | la prise en compte du non-mesurable (`resteUneEtape`) | §6.2 : le guide ne se retire pas sur un accomplissement qu'il n'a pas constaté |
| 5 | la garde de session (`GuideDemarrage`, `ouverte ? client : null`) | §4.4 : tant que la session n'est pas ouverte, **aucune mesure n'est émise** |

La cinquième porte sur l'écran et non sur le module : c'est là que vit la garde, et c'est le défaut
réel qu'une campagne a mesuré (§4.4).

### 8 bis.3 Ce que ce harnais NE prouve PAS, et le dit

- **Aucune règle d'autorisation n'est réécrite ici.** Les politiques des cinq tables appartiennent
  aux unités qui les portent. Ce que `CRM-079` ajoute — cinq lectures, aucune écriture — est
  éprouvé hors interface par `e2e/api/demarrage.spec.ts`, avec les jetons réels des trois profils.
- **Aucune convergence du seed.** Elle appartient à `scripts/verify-seed-demo.sh`. Les écarts
  mesurés du `viewer` (§3.1) sont **le fait du backend**, et le harnais les constate sans les
  corriger.
- **Aucune observation visuelle.** Le harnais constate que les neuf captures **existent** ; les
  regarder reste un geste humain (`CLAUDE.md` §16), qu'aucun script ne remplace.
- **La formulation par défaut de la garde de session** — `etat.statut === 'authentifie'` — n'est
  pas atteinte par la dégradation n° 5, les preuves unitaires injectant `sessionOuverte`. Elle est
  éprouvée par le parcours d'interface, console stricte, sur une page réellement chargée.

### 8 bis.4 Restauration constatée, jamais supposée

L'instantané des fichiers dégradés est pris **avant** la première dégradation, et la restauration
s'y compare **octet à octet**. La comparaison à `HEAD` est interdite
(`docs/SPEC-test-harness.md` §7.2, point 9) : le harnais doit fonctionner dans un arbre portant une
évolution légitime non encore committée, et ne doit ni la déclarer résiduelle, ni la remplacer.

## 8 ter. Le cas « espace de travail neuf » — l'écran du VRAI premier lancement

**Ajouté le 2026-08-16, après mesure sur la pile seedée.** Le §8 exige que les étapes soient
accomplies par les **données réelles** et non par une réponse substituée. Cette exigence, appliquée
au seed livré, laissait un trou que le backlog nommait : **aucune preuve d'interface ne montrait
l'écran que le §1 décrit**, celui d'un compte qui se connecte pour la première fois. Le seed
accomplit les cinq étapes pour l'administratrice ; la lectrice n'en laisse voir qu'**une** à faire,
et pour un motif — ses droits fins (§3.1, fait 2) — qui n'est pas celui d'un espace vide. Le guide
n'avait donc jamais été éprouvé dans l'état pour lequel il a été écrit.

### 8 ter.1 Ce qui a été MESURÉ, le 2026-08-16

Un compte `admin` d'un workspace **sans aucun objet**, ses cinq comptages émis exactement comme le
guide les émet — `HEAD`, `Prefer: count=exact`, `Range: 0-0`, contre `http://127.0.0.1:8000` :

| Table | Réponse | `count` | État de l'étape |
|---|---|---|---|
| `workspaces` | `200` | **1** | accomplie — « l'étape est accomplie par la connexion » (§3) |
| `tracks` (vivants) | `200` | **0** | à faire |
| `channels` (vivants) | `200` | **0** | à faire |
| `cards` (vivantes) | `200` | **0** | à faire |
| `mail_inbound_accounts` | `200` | **0** | à faire |

**Progression : « 1 étape(s) sur 5 ».**

Deux faits que cette mesure établit, et qu'aucun raisonnement n'aurait donnés :

1. **La cinquième mesure rend `200` et zéro, non `401`.** Le `401` du §3.1, fait 3, est celui de la
   clé **anonyme** ; une session ouverte sur un espace vide obtient une réponse aboutie et vide.
   L'étape est donc « à faire », jamais « non mesurable » — c'est la distinction du §6.2, et elle
   ne tenait jusqu'ici sur aucune mesure.
2. **Les quatre étapes à faire portent leur phrase d'absence**, celle qui dit ce que l'appelant
   **voit** (§3.1, fait 1). C'est le seul état où le guide rend quatre lignes « à faire » à la
   suite, donc le seul où sa lisibilité à ce titre s'observe.

### 8 ter.2 Le seed n'est PAS étendu, et ce n'est pas un contournement

La preuve **fabrique son espace vide et le détruit**, au lieu de l'ajouter au seed. Trois motifs,
et le premier suffit :

1. **`CRM-005` pose « un workspace », et le dépôt le vérifie.** `scripts/verify-seed.sh`, contrôle
   n° 1, échoue sur tout second workspace en base — « un seul workspace en base, conformément à
   `CRM-005` » — et fige `workspaces:1`. Étendre le seed reviendrait à trancher seul un invariant
   documenté et prouvé, pour le confort d'une preuve. `docs/SPEC-seed.md` §8 réserve d'ailleurs ce
   choix à `CRM-014`, et le laisse ouvert : « soit étendre le seed, soit continuer de fabriquer ses
   propres comptes ».
2. **Le précédent existe, et c'est le second terme de cette phrase.** `scripts/verify-authz.sh`
   crée puis détruit déjà ses propres workspaces et ses propres comptes pour les preuves de refus
   n° 3 et n° 7 de `docs/SPEC-permissions-rls.md` §7. Cette preuve suit ce chemin, pas un autre.
3. **Un espace vide seedé ne le resterait pas.** Le seed est un contrat maintenu (`CLAUDE.md` §8) :
   toute unité qui y ajoute un track, un channel ou une boîte devrait se souvenir de ne pas toucher
   à celui-là. Un espace vide n'est pas une donnée de démonstration, c'est l'**absence** de données
   — elle se fabrique au moment où on l'éprouve.

### 8 ter.3 Le montage, et ce qu'il ne fait pas

| Élément | Valeur | Motif |
|---|---|---|
| Workspace | `id` `5eed0000-0000-4000-8000-0000000000f1`, slug `espace-neuf` | identifiant stable et hors de la plage du seed socle, pour être reconnaissable en base |
| Compte | `neuf@p2enjoy.test`, rôle `admin` du workspace | un premier lancement est celui de la personne qui vient d'ouvrir son espace |
| Mot de passe | celui du seed (`docs/SPEC-seed.md` §2.3) | aucun secret neuf, même domaine `.test` non routable |

- **Aucune politique n'est posée ni levée.** Le montage écrit deux lignes avec la clé de service,
  qui contourne la RLS ; les cinq comptages, eux, sont émis avec le **jeton réel** du compte, sous
  les politiques inchangées. Ce que la preuve mesure est donc bien ce que le produit consent.
- **Aucun droit fin n'est posé.** L'espace est vide : il n'y a rien à restreindre, et une ligne de
  `track_members` y désignerait un track inexistant.
- **La destruction est constatée, jamais supposée.** Le workspace est supprimé — ce qui **cascade**
  sur son appartenance, mesuré le 2026-08-16 — puis le compte l'est par l'API d'administration. La
  preuve vérifie ensuite qu'il ne reste **qu'un** workspace en base, celui du seed : c'est la
  condition pour que `scripts/verify-seed.sh` reste vert après son passage.

### 8 ter.4 Ce que cette preuve N'établit PAS

- **Rien sur les droits.** Elle n'ouvre, ne ferme et n'interroge aucun rôle : elle établit un
  **rendu** dans un état de données que le seed ne porte pas. Les refus restent l'affaire de
  `e2e/api/demarrage.spec.ts` et des unités qui portent les cinq tables.
- **Rien sur la création d'un espace par le produit.** Aucun écran ne crée de workspace
  (`docs/SPEC-seed.md` §8, INC-015) ; le montage est une opération d'exploitation, et il est nommé
  comme telle plutôt que déguisé en parcours utilisateur.

## 9. Limites connues

- **Le `viewer` ne verra jamais la cinquième étape accomplie** (§3.1, fait 2). Le guide dit ce que
  l'appelant voit ; il ne peut pas dire ce qu'il ne voit pas sans mentir sur ses droits.
- **Aucune étape ne mesure un workflow.** Un channel naît avec le workflow par défaut
  (`docs/SPEC-workflow-engine.md`), et une étape « composez votre workflow » serait donc accomplie
  d'avance pour tout le monde. L'éditeur reste atteignable par l'index des réglages.
- **Le guide ne mesure pas la qualité de ce qu'il compte** : un track vide accomplit l'étape 2.
  Compter la profondeur reviendrait à noter le travail de l'utilisateur.
- ~~**Aucun `scripts/verify-onboarding.sh`** n'est écrit tant qu'aucun harnais du dépôt n'est
  exécutable dans l'environnement de vérification~~ — **limite levée le 2026-08-16**, et le motif
  qui la portait a disparu plutôt que d'avoir été contourné : les harnais exigeaient un couple
  Node 24 / npm 11+ qu'on croyait absent de l'hôte, et `nvm install 24` le pose
  (`docs/CloudWorker.md` §2.1 bis). Le harnais est spécifié au **§8 bis** et livré. La règle qui
  l'interdisait reste vraie et intacte : un harnais qu'aucune session ne peut exécuter livrerait
  une preuve non éprouvée (`CLAUDE.md` §25) — c'est bien pour cela qu'il n'est écrit qu'une fois
  exécutable, et son verdict est consigné avec lui.

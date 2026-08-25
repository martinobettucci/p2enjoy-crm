# Spécification — modèles d'emails, signatures, séquences de relance

Contrat exécutable de `CRM-063` (`docs/BACKLOG.md`, chunk 5).

- Unité de backlog : `CRM-063`.
- Modèle : `docs/SCHEMA.md` §7 (messagerie), §5 (`cards`), §6 (`contacts`, `organizations`).
- Règles d'autorisation : `docs/SPEC-permissions-rls.md` §3 (fonctions), §7 (le refus se mesure
  hors interface).
- Sous-système mail existant : `docs/SPEC-mail-subsystem.md` §2.2 (identités sortantes), §20
  (composition et envoi), §22 (écran des identités sortantes).
- Ce qui attend ces objets : `docs/SPEC-relances.md` §1 (« une relance de `CRM-062` ne part pas par
  email »), §7.
- Ordonnancement : `docs/SPEC-scheduler.md` (`CRM-017`).
- Interface : `docs/DESIGN_SYSTEM.md`.
- Manuel : `docs/manual.md`, chapitre **15** annoncé par le sommaire depuis `CRM-000` et jamais
  écrit — « Modèles d'emails, signature et séquences de relance ».
- État : **tranche 1 spécifiée ici** (§2 à §6), écrite le 2026-08-25 **après mesure sur la pile
  debout et seedée**, avant sa première ligne de code (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2).
  Les tranches 2 à 4 sont **cadrées** au §7 et seront spécifiées ligne à ligne avant d'être
  écrites, chacune dans son propre chunk.

---

## 1. Intention, et les trois objets que cette unité porte

Trois unités livrées renvoient nommément à `CRM-063` un manque qu'elles ont refusé d'inventer :

| Qui renvoie | Ce qui manque | Où c'est écrit |
|---|---|---|
| `CRM-062` | « Une relance ne part pas par email : cela suppose un modèle, un expéditeur et une cadence » | `docs/SPEC-relances.md` §1, §7 |
| `CRM-058` | « Aucune signature » à l'envoi | `docs/BACKLOG.md`, `CRM-058` |
| `CRM-089` | `p_signature_html` n'est **jamais** envoyé par l'écran des identités : le `coalesce` de la RPC le rendrait ineffaçable | `docs/SPEC-mail-subsystem.md` §22.1 |

`CRM-063` porte donc **trois objets**, et l'ordre des tranches est celui de leur dépendance :

1. **Le modèle d'email** — un texte réutilisable, nommé, à trous, écrit une fois et employé par
   toutes les compositions du workspace. C'est l'objet dont les deux autres dépendent.
2. **La signature** — un pied de message attaché à une identité sortante, ajouté au corps expédié.
3. **La séquence de relance** — plusieurs paliers, chacun portant un modèle et un délai, appliqués
   à une affaire figée au sens de `CRM-062`.

### 1.1 Ce que cette unité NE fait PAS, et l'unité qui le porte

| Hors périmètre | Unité qui le porte |
|---|---|
| Notification temps réel, préférences de notification | `CRM-064` |
| Digest quotidien par email | `CRM-069` |
| Modèles de **cards** et checklists — objets distincts, malgré le mot « modèle » | `CRM-068` |
| Rendu HTML d'un corps de message | aucune : `docs/SPEC-mail-subsystem.md` §18 a tranché que le corps affiché et expédié est du **texte** |

## 2. Tranche 1 — `public.mail_templates`, le modèle d'email

### 2.1 Pourquoi une table, et pourquoi elle appartient au workspace

Un modèle d'email est une donnée éditoriale partagée : deux personnes qui écrivent au même prospect
doivent envoyer le même texte. Il appartient donc au **workspace**, comme le tableau d'objectifs de
`CRM-082`, et jamais à un track ni à un channel — un modèle « relance sans réponse » sert dans tous
les dossiers, et le dupliquer par channel serait la duplication que `CLAUDE.md` §4 proscrit.

Il n'appartient pas non plus à une **identité sortante** : `mail_outbound_identities` porte déjà
`signature_html`, ce qui est la trace du choix inverse pour la signature (§7.2). Un modèle est un
contenu, une identité est un expéditeur ; les lier ferait dépendre le texte du compte SMTP qui
l'expédie.

### 2.2 Colonnes

| Colonne | Type | Nullable | Règle |
|---|---|---|---|
| `id` | `uuid` | non | `gen_random_uuid()` |
| `workspace_id` | `uuid` | non | → `workspaces (id) on delete cascade` |
| `name` | `text` | non | 1 à 120 caractères après `app.btrim_blancs` ; **unique par workspace** sur la forme normalisée |
| `subject` | `text` | non | 1 à 300 caractères après `app.btrim_blancs` ; peut porter des variables |
| `body_text` | `text` | non | 1 à 20 000 caractères après `app.btrim_blancs` ; peut porter des variables |
| `created_by` | `uuid` | oui | → `profiles (id) on delete set null`. **Trace, jamais un droit** : même règle qu'à `docs/SPEC-goals.md` §4.2 |
| `created_at` | `timestamptz` | non | `now()` |
| `updated_at` | `timestamptz` | non | `now()`, tenu par `app.set_updated_at()` |

**Les bornes sont mesurées, pas choisies au hasard.** 300 pour l'objet : la ligne `Subject` de
RFC 5322 est repliée au-delà de 78 octets et les clients tronquent bien avant 300 — au-delà, on
n'écrit plus un objet. 20 000 pour le corps : `mail_outbox.body_text` n'est pas borné, et poser ici
une borne haute évite qu'un copier-coller accidentel d'un fil entier devienne un modèle.

**Aucune colonne `archived_at`.** Un modèle se **supprime** réellement, comme un bloc d'objectif
(`docs/SPEC-goals.md` §2.2) et contrairement à un track ou un channel : il ne contient aucun
travail, il est une chaîne de caractères. La tranche 4, qui fera référencer un modèle par un palier
de séquence, posera cette clé étrangère en `on delete restrict` — un modèle employé par une
séquence ne se supprimera plus, et le refus sera nommé. Cette contrainte est **écrite ici**, pour
que la tranche 4 ne la découvre pas.

### 2.3 Les variables d'un modèle, et pourquoi elles sont validées EN BASE

Un modèle est un texte **à trous** : `Bonjour {{contact.full_name}}, où en est {{card.title}} ?`

La liste des trous est **fermée**, et la base refuse à l'écriture tout trou qu'elle ne connaît pas.
Ce refus n'est pas une commodité d'interface :

1. un modèle portant `{{card.titel}}` s'écrirait sans bruit, et le défaut n'apparaîtrait qu'au
   moment de l'envoi — c'est-à-dire chez le destinataire ;
2. `CLAUDE.md` §10 : « autorisé », « valide » sont des règles appliquées côté backend. Une
   validation qui ne vivrait que dans l'écran serait contournée par le premier appel PostgREST ;
3. la tranche 4 fera écrire des emails par l'**ordonnanceur**, qui n'a pas d'écran.

**La syntaxe est exactement `{{nom}}`**, avec des blancs de bord tolérés à l'intérieur des
accolades : `{{ card.title }}` désigne la même variable que `{{card.title}}`. Toute autre
forme n'est pas une variable et n'est pas examinée — un texte portant `{ card.title }` ou
`{{{x}}}` est du texte ordinaire, et le §2.5 dit ce que le second devient.

### 2.4 La liste fermée des variables, et sa source mesurée

**La forme d'une variable n'est pas inventée ici** : `docs/SCHEMA.md` §7 illustre ce nommage depuis
`CRM-000` par `{{card.title}}` et `{{contact.full_name}}`. Une variable s'écrit donc
`<objet>.<colonne>`, et chaque nom ci-dessous **désigne la colonne réelle** dont il tire sa valeur —
ce qui rend la liste vérifiable au lieu d'être à retenir.

Chaque variable désigne une donnée qui **existe en base aujourd'hui**. Aucune n'anticipe une colonne
à venir : une variable dont la source n'existe pas serait un trou qui ne se remplit jamais.

| Variable | Source mesurée | Nulle possible |
|---|---|---|
| `card.title` | `cards.title` | non |
| `card.amount` | `cards.amount` | oui |
| `card.currency` | `cards.currency` | non |
| `card.next_action` | `cards.next_action` | oui |
| `card.next_action_at` | `cards.next_action_at` — **mesuré** : `cards` ne porte aucune colonne `due_date` | oui |
| `card.step` | `coalesce(workflow_steps.label_override, workflow_nodes_catalog.label)` — **mesuré** : `workflow_steps` ne porte AUCUNE colonne `label`, ce que la décision 507 avait déjà relevé par un `42703`. La variable est donc `card.step` et non `card.step_label` | non |
| `card.channel` | `channels.name` | non |
| `contact.full_name` | `contacts.full_name` — **mesuré** : la table ne sépare ni prénom ni nom, il n'y a donc pas de `contact.first_name`. C'est la graphie que `docs/SCHEMA.md` §7 illustrait déjà | non |
| `contact.email` | `contacts.email` | oui |
| `contact.organization` | `organizations.name` par `contacts.organization_id` | oui |
| `identity.from_name` | `mail_outbound_identities.from_name` | oui |
| `identity.from_address` | `mail_outbound_identities.from_address` | non |

**Douze variables, et pas une de plus.** La colonne « nulle possible » n'a aucun effet dans la
tranche 1 — elle est écrite ici parce que c'est la tranche 2, celle du rendu, qui devra dire ce
qu'un trou vide devient, et qu'elle ne doit pas avoir à remesurer.

### 2.5 Ce que la base refuse, ligne à ligne

`app.mail_template_variables_inconnues(texte)` rend le tableau **trié et dédoublonné** des noms de
variables qui ne figurent pas au §2.4. Deux contraintes de vérification l'appellent, une par
colonne portant des variables.

| # | Écriture | Issue attendue |
|---|---|---|
| a | `subject` ou `body_text` sans aucune variable | acceptée |
| b | variables toutes connues, y compris répétées | acceptée |
| c | `{{ card.title }}`, blancs de bord dans les accolades | acceptée — même variable qu'en b |
| d | `{{card.titel}}` dans `subject` | refusée, `mail_templates_subject_variables` |
| e | `{{card.titel}}` dans `body_text` | refusée, `mail_templates_body_variables` |
| f | `{{}}` — trou vide | refusée : la chaîne vide n'est pas au §2.4 |
| g | `{{CARD.TITLE}}` | refusée : les noms sont **sensibles à la casse**, une seule graphie par variable |
| h | `name` vide ou fait de blancs | refusée, `mail_templates_name_borne` |
| i | `name` déjà pris dans le workspace, aux blancs de bord près | refusée, `mail_templates_workspace_name_key` (`23505`) |
| j | `name` identique dans un AUTRE workspace | acceptée : l'unicité est par workspace |
| k | `subject` vide, `body_text` vide | refusées, `mail_templates_subject_borne` / `_body_borne` |
| l | `subject` de 301 caractères, `body_text` de 20 001 | refusées, mêmes contraintes |
| m | `workspace_id` d'un workspace dont l'appelant n'est pas membre | refusée par la RLS, jamais par une contrainte |

**Le point g est une décision, pas un effet de bord.** Accepter `{{Affaire.Titre}}` obligerait le
rendu à normaliser la casse, donc à décider ce que `{{contact.EMAIL}}` doit rendre, et rendrait la
liste du §2.4 ambiguë. Une seule graphie, et le refus le dit.

### 2.6 Autorisations

Aucune notion nouvelle. Le patron est **exactement** celui de `goal_boards`
(`docs/SPEC-goals.md` §4.1), et la raison est la même : un modèle est un objet éditorial collectif
du workspace.

| Action | Qui | Fonction |
|---|---|---|
| lecture | tout membre du workspace | `app.is_workspace_member(workspace_id)` |
| insertion | `admin` et `business_developer` | `app.workspace_role(workspace_id) in ('admin','business_developer')` |
| modification | idem | idem, en `using` **et** en `with check` |
| suppression | idem | idem |

**La lectrice lit et n'écrit pas.** C'est le sens du rôle `viewer` dans tout ce dépôt, et le refus
se mesure comme `docs/SPEC-permissions-rls.md` §7 l'exige : **zéro ligne**, jamais une erreur, pour
un `PATCH` ou un `DELETE` que la politique ne consent pas ; `401` pour l'anonyme, refusé par le
**privilège** avant toute politique.

**Le point de sûreté des migrations 48 à 54 s'applique** : la plateforme porte des
`alter default privileges … to anon`, si bien qu'un `revoke … from public` ne retire rien à un rôle
**nommé**. La migration révoque donc nommément puis attribue action par action, comme la 49.

### 2.7 Contrat d'API — `/rest/v1/mail_templates`

Mesuré avec les jetons réels des trois profils du seed. `admin` = Camille Aubert,
`business_developer` = Driss Lemoine, `viewer` = Farida Nowak.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| 1 | anonyme | `GET` | **`200` et `[]`** — un filtrage, jamais une erreur |
| 2 | anonyme | `POST` | `401`, code PostgreSQL `42501`, refusé par le **privilège** |
| 3 | `viewer` | `GET` | `200`, les modèles du seed |
| 4 | `business_developer` | `GET` | `200`, les mêmes |
| 5 | `admin` | `GET` | `200`, les mêmes |
| 6 | `viewer` | `POST` | `403`, code PostgreSQL `42501` |
| 7 | `viewer` | `PATCH` sur un modèle existant | `200` et **`[]`** — zéro ligne, la ligne relue **inchangée** |
| 8 | `viewer` | `DELETE` sur un modèle existant | `204` et la ligne **toujours là** |
| 9 | `business_developer` | `POST` valide | `201`, ligne relue |
| 10 | `business_developer` | `POST` portant `{{card.titel}}` | `400`, `23514`, contrainte nommée |
| 11 | `business_developer` | `POST` d'un `name` déjà pris | `409`, `23505` |
| 12 | `admin` | `PATCH` du corps | `200`, `updated_at` **avancé** |
| 13 | `admin` | `DELETE` de ce qu'il a créé | `204`, relecture vide |
| 14 | `admin` | `POST` portant `created_by` d'autrui | accepté et **sans effet de droit** : la colonne est une trace ; aucune politique ne la lit |

**Le point 14 est figé par une assertion** plutôt que tu : `created_by` n'est pas gardée, et il faut
que la prochaine session qui lira cette table sache que ce n'est pas un oubli. **MESURÉ** : un
`POST` de l'administratrice portant le `created_by` de la lectrice rend `201`, et la ligne relue
porte bien l'identifiant d'autrui. Aucune politique ne le lit, donc rien n'en dépend.

**La ligne 1 a été RÉVISÉE PAR LA MESURE, et l'écriture d'origine — `401` — était fausse.** La
politique de lecture est ouverte `to anon` délibérément, comme celle de `goal_boards` : `auth.uid()`
valant `null` hors session, le refus se fait par **zéro ligne** et non par une erreur de privilège
(`docs/SPEC-permissions-rls.md` §7). La distinction compte : un `401` révélerait que la table existe
et qu'elle est protégée, là où `200 []` ne révèle rien.

**Le refus de la ligne 2 divulgue la commande `GRANT` à exécuter, dans son `hint`.** Comportement de
PostgREST, occurrence connue d'**INC-026**, inchangé et non masqué — la preuve le constate plutôt
que de laisser la divulgation devenir invisible à force d'être habituelle.

### 2.8 Le seed

Le seed pose **deux** modèles dans le workspace de démonstration, et deux suffisent à démontrer
l'objet parce qu'ils sont **différents par construction** :

1. **« Relance sans réponse »** — porte des variables dans l'objet **et** dans le corps, dont une
   variable pouvant être nulle (`card.amount`) : c'est le cas que la tranche 2 devra rendre.
2. **« Prise de contact »** — porte des variables **uniquement** dans le corps, l'objet étant un
   texte fixe : sans ce second cas, une preuve ne distinguerait pas « les deux colonnes sont
   examinées » de « la première l'est ».

Les deux sont créés **par l'API REST avec le jeton de l'administratrice**, jamais par un `INSERT`
direct : `CLAUDE.md` §8 exige que les données de démonstration empruntent le chemin du produit. Une
garde de convergence compare le compte à **deux** et échoue si un rejeu duplique, comme celle des
identités sortantes.

### 2.9 Preuves exigées — tranche 1

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0053_modeles_emails.test.sql` : forme dans le catalogue, les huit contraintes, l'unicité normalisée, l'ACL rôle par rôle, les treize lignes du §2.5, et **un témoin avant chaque refus** — un refus vert sur une absence ne prouve rien |
| API | `e2e/api/modeles-emails.spec.ts` : les quatorze lignes du §2.7 avec les jetons réels, chaque refus **relisant la ligne** pour la constater inchangée (décision 70), et le seed constaté **intact** en fin de suite |
| Unitaire | aucune logique TypeScript n'est livrée par cette tranche : la validation vit en SQL. La règle est éprouvée par pgTAP, qui est son niveau. L'écart est **nommé** plutôt que compensé par un test unitaire de façade |
| Harnais | `scripts/verify-modeles-emails.sh` : **44 contrôles**, verdict unique, non complaisant — **six** dégradations réelles, dont la restauration est **constatée octet à octet** contre un instantané pris avant la première, jamais contre `HEAD` |
| Seed | `supabase/seed/apply-seed.sh` §8 sexdecies, avec sa garde de convergence |
| E2E interface | **aucun** : cette tranche ne livre aucun écran. L'écart est nommé, et l'écran est la tranche 2 |

### 2.10 Definition of Done — tranche 1

- migration `0055_modeles_emails.sql` : la table, ses contraintes, la fonction de validation, la
  RLS, les privilèges ;
- suite pgTAP dédiée verte ;
- contrat d'API du §2.7 vert avec les jetons réels des trois profils ;
- seed enrichi et **convergent** ;
- harnais dédié vert, ses dégradations vues ;
- `docs/SCHEMA.md`, `docs/SPEC-permissions-rls.md`, `docs/PROD_MIGRATIONS.md`, `CHANGELOG.md` mis à
  jour **dans le même changement** ;
- commentaires `@spec` / `@verifies` sur chaque fichier ;
- commit poussé sur `origin/main`.

## 3. `app.mail_template_variables()` — la liste, écrite une seule fois

Fonction `immutable`, sans argument, rendant le `text[]` du §2.4 **trié**. Elle est la source unique
de la liste : la contrainte l'appelle, la preuve pgTAP la compare au §2.4, et la tranche 2 la lira
pour proposer les variables à l'écran. Écrire la liste deux fois serait garantir qu'elles divergent.

**`immutable` est exigé par la contrainte**, une contrainte de vérification n'acceptant qu'une
expression immuable. La conséquence est écrite plutôt que découverte : **ajouter une variable à la
liste ne revalide pas les lignes existantes**, et c'est sans danger dans ce sens — la liste ne peut
que s'élargir. **En retirer une laisserait des lignes non conformes en base** ; le jour où cela se
présentera, la migration qui retire devra porter sa propre reprise de données.

## 4. `app.mail_template_variables_inconnues(texte)` — le refus

Fonction `immutable`, rendant le `text[]` **trié et dédoublonné** des variables du texte absentes de
la liste. Un texte sans variable rend `{}`. Un texte `null` rend `{}` — c'est la convention de
PostgreSQL pour une contrainte, qui ne refuse jamais sur `null` ; les colonnes concernées sont de
toute façon `not null`.

L'extraction emploie `regexp_matches(texte, '\{\{([^{}]*)\}\}', 'g')` puis `btrim` sur le contenu.
Le motif interdit les accolades à l'intérieur du trou, ce qui décide le cas `{{{x}}}` : la sous-
chaîne `{{{x}}` ne correspond pas, `{{x}}` correspond, et `x` est donc une variable inconnue — le
texte est refusé. C'est le comportement voulu : une accolade en trop est une faute de frappe, pas
une intention.

## 5. Ce que la tranche 1 ne prouve pas, et qui n'est pas masqué

- **Aucun rendu.** Un modèle n'est jamais substitué : aucune fonction ne remplace `{{card.title}}`
  par un titre. La tranche 2 le fera, et c'est elle qui devra dire ce qu'un trou dont la source est
  nulle devient — la colonne « nulle possible » du §2.4 existe pour elle.
- **Aucun écran.** Un modèle ne se crée, ne se modifie et ne se supprime que par l'API. Le seed en
  pose deux pour que l'écran de la tranche 2 n'ouvre pas sur du vide.
- **Aucun envoi.** `mail_outbox` ignore les modèles ; rien n'est changé à `CRM-058`.
- **Aucune signature, aucune séquence.** Ce sont les tranches 3 et 4, cadrées au §7.

### 2.11 Un défaut trouvé par le harnais DANS LE HARNAIS, et corrigé à sa cause

Le premier passage a rendu « 44 contrôles, aucune anomalie » — et il **mentait sur une ligne**. La
dégradation D-E vise la politique d'insertion, dont la clause `with check` est **mot pour mot**
celle de la mise à jour : le substituteur a donc refusé un motif ambigu, comme il doit. Mais
`degrader` est appelée dans un `||`, ce qui **suspend `set -e`** sur tout le composé : l'échec n'a
pas arrêté la fonction, le fichier `degrade.sql` portait encore la dégradation **précédente**, et
le harnais a réappliqué celle-là en annonçant celle-ci comme mordante.

C'est exactement le mensonge tranquille que la décision 503 reproche. Corrigé **à sa cause** : la
copie est détruite avant chaque substitution, l'échec du substituteur est **testé** et rendu
« IMPOSSIBLE », et le motif de D-E est ancré sur les deux lignes qui précèdent la clause. Le harnais
rend de nouveau 44 contrôles, et ses **six** dégradations mordent réellement.

## 6. Registre — ce que la mesure a trouvé et qui n'est pas corrigé ici

`mail_outbound_identities.signature_html` existe depuis `CRM-053` et **n'est lue par personne** :
ni `mail-sync` à l'envoi, ni l'écran des identités de `CRM-089`, qui n'envoie délibérément jamais
`p_signature_html` (§22.1). Son nom annonce en outre du **HTML**, alors que tout le sous-système
expédie du **texte** (`docs/SPEC-mail-subsystem.md` §18). La colonne est donc morte et mal nommée.

Ce n'est pas corrigé par la tranche 1 : la corriger, c'est la tranche 3, et le nom porte une
question de produit — signer en texte ou en HTML — qui appartient à sa spécification. L'écart est
**consigné au registre** et le comportement laissé inchangé (`CLAUDE.md` §18).

## 7. Cadrage des tranches suivantes — à spécifier avant d'être écrites

### 7.1 Tranche 2 — le rendu et l'écran

Une fonction de substitution, et l'écran d'administration des modèles : liste, création,
modification, suppression avec confirmation, et prévisualisation sur une affaire réelle. La
question qu'elle devra trancher, et qui n'est pas tranchée ici : **ce qu'un trou dont la source est
nulle rend** — la chaîne vide, un tiret, ou le refus d'envoyer.

> **SPÉCIFIÉE le 2026-08-25, au §8 ci-dessous**, après mesure sur la pile debout et seedée, et
> **avant sa première ligne de code**. La tranche y est découpée en deux sous-tranches, `2a` — le
> rendu — et `2b` — l'écran. La question ci-dessus est tranchée au **§8.4**.

### 7.2 Tranche 3 — la signature

Rendre effectif ce que `CRM-053` a posé et que personne n'emploie (§6). Elle devra dire : le nom et
le type de la colonne, sa position dans le corps expédié, son effacement, et si une signature est
propre à une identité ou à une personne.

### 7.3 Tranche 4 — la séquence de relance

Des paliers ordonnés, chacun portant un modèle (`on delete restrict`, §2.2) et un délai, appliqués
à une affaire figée au sens de `docs/SPEC-relances.md` §2. Elle réemploiera l'ordonnanceur de
`CRM-017` et le job quotidien de `CRM-062` tranche 2, et devra trancher : qui arme une séquence, ce
qui l'interrompt, et ce qu'une réponse du destinataire produit.

---

## 8. Tranche 2 — le rendu et l'écran

Écrite le 2026-08-25 **après mesure sur la pile debout et seedée**, et **avant la première ligne de
code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2). Elle développe le cadrage du §7.1, qu'elle ne
remplace pas : le §7.1 disait *quoi*, ce chapitre dit *ligne à ligne*.

### 8.1 Découpe en deux sous-tranches, et son motif

| Sous-tranche | Objet | Pourquoi elle est séparée |
|---|---|---|
| **2a** | Le **rendu** en base : `public.rendre_modele_email`, pgTAP, contrat d'API, harnais | C'est l'objet dont l'écran dépend : une prévisualisation qui n'a rien à appeler n'existe pas |
| **2b** | L'**écran** d'administration : liste, création, modification, suppression avec confirmation, prévisualisation sur une affaire réelle | Elle consomme 2a et n'ajoute aucune règle de base |

L'ordre est celui de la dépendance, comme les quatre tranches de l'unité (§1). Chacune est
committée et prouvée avant la suivante.

### 8.2 La substitution vit EN BASE, et ce n'est pas une commodité

Trois raisons, dont deux sont déjà celles du §2.3 et dont la troisième est propre à cette tranche :

1. **la tranche 4 fera écrire des emails par l'ORDONNANCEUR**, qui n'a pas d'écran
   (`docs/SPEC-scheduler.md`). Un rendu qui ne vivrait que dans la webapp serait hors de sa portée ;
2. **la prévisualisation de 2b doit montrer EXACTEMENT ce qui partira.** Deux implémentations — une
   en TypeScript pour l'écran, une en SQL pour l'ordonnanceur — divergeraient au premier
   ajustement, et l'écran mentirait alors sur le contenu de l'envoi. C'est le raisonnement du §3 sur
   la liste des variables, transposé au rendu ;
3. **les valeurs viennent de tables sous RLS.** Substituer côté client obligerait à rapatrier
   l'affaire, son channel, son étape, son contact et l'identité, puis à refaire la jointure
   d'étape — quatre lectures et une règle de plus dans l'écran, pour un résultat que la base sait
   produire en une.

### 8.3 Contrat de `public.rendre_modele_email`

```
public.rendre_modele_email(
    p_template_id uuid,
    p_card_id     uuid,
    p_contact_id  uuid default null,
    p_identity_id uuid default null
) returns table (
    subject           text,
    body_text         text,
    variables_nulles  text[]
)
```

- **`stable`**, jamais `volatile` : la fonction ne fait que lire. C'est la volatilité mesurée de
  `public.cards_figees()`, le seul autre lecteur public de ce genre.
- **`security invoker`**, comme `cards_figees()` — mesuré : `prosecdef = f`. La RLS de
  `mail_templates`, `cards`, `channels`, `contacts`, `organizations` et
  `mail_outbound_identities` s'applique **telle quelle**. Aucun prédicat n'est recopié : les
  recopier créerait la duplication que la décision de `CRM-062` §9.2 combat.
- **Zéro ligne** lorsque le modèle ou l'affaire n'est pas lisible — jamais une erreur, jamais un
  identifiant divulgué (`docs/SPEC-permissions-rls.md` §7). Un identifiant inconnu et un identifiant
  masqué rendent **la même chose**, et c'est la seule façon de ne rien révéler.

### 8.4 CE QU'UN TROU DONT LA SOURCE EST NULLE REND — la décision de la tranche

**Il rend la CHAÎNE VIDE, et le rendu NOMME le trou dans `variables_nulles`.** Les trois branches du
§7.1 ont été pesées, et deux sont écartées pour une raison mesurable.

- **Le tiret est écarté.** `docs/DESIGN_SYSTEM.md` §5.9 l'interdit déjà dans un tableau — « ni
  tiret, ni « — », ni « non renseigné » : un tiret est un caractère que rien ne distingue d'une
  donnée ». En **prose**, c'est pire encore : « je reviens vers vous au sujet de Migration ERP
  (— EUR) » se lit comme une valeur, pas comme une absence. Un tiret **invente une valeur**.

- **Le refus d'envoyer est écarté À CET ENDROIT, et seulement à cet endroit.** Refuser appartient à
  l'**expéditeur**, jamais au rendu : la prévisualisation de 2b doit pouvoir montrer un modèle
  appliqué à une affaire incomplète — c'est même le cas où elle sert le plus, puisque c'est là qu'on
  découvre le trou. Une fonction qui refuserait ne rendrait rien à afficher, et l'écran ne pourrait
  pas dire **quel** trou est en cause.

- **La chaîne vide SEULE serait le mensonge tranquille.** MESURÉ sur la pile : le modèle du seed
  « Relance sans réponse » appliqué à une affaire sans montant rend « au sujet de X ( EUR) » —
  double espace compris —, et rien ne le signale. C'est exactement le défaut que le §2.3 refuse : il
  n'apparaîtrait qu'à l'envoi, c'est-à-dire chez le destinataire.

**`variables_nulles` est donc le troisième retour, et il n'est pas décoratif** : il est la condition
à laquelle la chaîne vide est acceptable. Il est **trié, dédoublonné**, et **ne compte que les
variables réellement présentes** dans l'objet ou le corps du modèle — une variable que le modèle
n'emploie pas n'est pas un trou, et l'y faire figurer donnerait à lire une liste d'absences sans
objet.

La tranche 4, qui expédie, y trouvera ce qu'il lui faut pour refuser ; l'écran de 2b y trouvera ce
qu'il lui faut pour prévenir. Aucun des deux n'a besoin de remesurer.

### 8.5 LES SOURCES NE SE DEVINENT PAS, et deux mesures l'imposent

- **`p_card_id` est OBLIGATOIRE.** Sept des douze variables en viennent, directement ou par
  jointure. Un rendu sans affaire n'aurait presque rien à substituer.

- **`p_contact_id` est FACULTATIF, et nul il fait trois trous NOMMÉS.** Le rendu ne choisit **jamais**
  un contact parmi ceux de l'affaire. MESURÉ sur le seed : `card_contacts` admet plusieurs lignes par
  affaire, deux affaires seulement en portent une, et **la plupart n'en portent aucune**. Deviner
  reviendrait à écrire au mauvais destinataire — la faute la moins rattrapable de tout le
  sous-système.

- **`p_identity_id` est FACULTATIF, et nul il fait deux trous NOMMÉS.** Prendre « l'identité par
  défaut » est impossible, et ce n'est pas une prudence mais une MESURE : **deux** lignes du seed
  portent `is_default = true`. Les index uniques partiels
  `mail_outbound_identities_defaut_personne` et `mail_outbound_identities_defaut_service` garantissent
  l'unicité **par personne** et **pour le service**, jamais pour le workspace — « l'identité par
  défaut du workspace » n'existe pas.

- **UN CONTACT NON RATTACHÉ À L'AFFAIRE EST ACCEPTÉ**, et l'écart est écrit plutôt que découvert. La
  RLS garantit déjà que l'appelant **lit** ce contact ; exiger en plus le rattachement poserait une
  règle de produit que personne n'a prise, et `CLAUDE.md` §10 refuse cela **dans les deux sens** —
  pas seulement dans celui du laxisme. La tranche 4 choisira son destinataire par la séquence, et
  c'est là que la règle, si elle doit exister, sera prise.

### 8.6 Le formatage des valeurs non textuelles, mesuré

Dix des douze variables sont du `text` et se substituent telles quelles. Les deux autres ne le sont
pas, et leur rendu est une décision.

| Variable | Type réel | Rendu | Mesure |
|---|---|---|---|
| `card.amount` | `numeric` | `to_char(…, 'FM999999999990.00')` | `48000.00` |
| `card.next_action_at` | `timestamptz` | `to_char(… at time zone 'UTC', 'DD/MM/YYYY HH24:MI')` | `16/08/2026 09:00` |

- **Aucun séparateur de milliers, et aucun symbole de devise.** Le séparateur dépend d'une locale
  que la base ne porte pas pour un workspace ; le symbole doublerait `card.currency`, qui est une
  variable **distincte** que le rédacteur du modèle place où il veut.

- **L'HORODATAGE EST RENDU EN UTC, ET C'EST UNE LIMITE NOMMÉE.** MESURÉ : aucune colonne de fuseau
  n'existe dans le schéma — la seule colonne de préférence est `profiles.locale`, qui est une
  **langue**. UTC est donc le seul choix qui ne soit pas arbitraire, et il est écrit **ici** plutôt
  que découvert par un destinataire à qui l'on donnerait rendez-vous à la mauvaise heure. L'écart est
  consigné au registre (§8.10), et il se referme le jour où le produit portera un fuseau.

### 8.7 Autorisations et privilèges

- `grant execute` à **`authenticated`** et **`service_role`**, jamais à `anon` — les privilèges
  mesurés de `public.cards_figees()`, repris sans changement. Un appelant anonyme ne lit **aucune**
  affaire : lui donner l'exécution ne lui rendrait que du vide, au prix d'une surface de plus.
- **`revoke all … from public` NE SUFFIT PAS** : c'est le point de sûreté des migrations 48 à 55,
  la distribution posant des `alter default privileges … to anon`. La migration révoque donc
  **nommément** puis attribue.
- **Le refus de l'anonyme est un `401` de PRIVILÈGE**, distinct du `200 []` de la lecture de
  `mail_templates` (§2.7 ligne 1) : là-bas la politique est ouverte `to anon` et filtre ; ici la
  fonction n'est pas exécutable. Les deux refus sont de **nature différente** et la preuve les
  distingue, comme le §2.7 distingue déjà le `401` du `403`.

### 8.8 Contrat d'API — `/rest/v1/rpc/rendre_modele_email`

À mesurer avec les jetons réels des trois profils. `admin` = Camille Aubert,
`business_developer` = Driss Lemoine, `viewer` = Farida Nowak.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| 1 | anonyme | modèle et affaire du seed | `401`, `42501` — refusé par le **privilège** |
| 2 | `viewer` | modèle du seed + affaire qu'elle LIT + son contact | `200`, une ligne, objet et corps substitués |
| 3 | `business_developer` | idem | `200`, la **même** ligne — le rendu ne dépend pas du rôle |
| 4 | `admin` | idem | `200`, la même ligne |
| 5 | `viewer` | affaire d'un track qui lui est FERMÉ | `200` et **`[]`** — zéro ligne, aucun identifiant divulgué |
| 6 | `admin` | `p_template_id` inconnu | `200` et `[]` — même rendu qu'un modèle masqué |
| 7 | `admin` | `p_card_id` inconnu | `200` et `[]` |
| 8 | `admin` | modèle à variables + affaire **sans montant** | `200`, le trou rendu **vide**, `card.amount` dans `variables_nulles` |
| 9 | `admin` | sans `p_contact_id` sur un modèle citant `contact.full_name` | `200`, `contact.full_name` dans `variables_nulles` |
| 10 | `admin` | sans `p_identity_id` sur un modèle citant `identity.from_address` | `200`, `identity.from_address` dans `variables_nulles` |
| 11 | `admin` | modèle **sans aucune variable** | `200`, texte identique à l'entrée, `variables_nulles` **vide** |
| 12 | `admin` | modèle dont toutes les variables sont renseignées | `200`, `variables_nulles` **vide** — une variable pleine n'est jamais listée |
| 13 | `admin` | contact **non rattaché** à l'affaire visée | `200`, substitué — la règle du §8.5 figée par une assertion |
| 14 | `admin` | `identity.from_name` d'une identité du seed | `200`, `identity.from_name` dans `variables_nulles` — MESURÉ : les **deux** identités du seed ont un `from_name` nul |

**La ligne 14 n'est pas un cas de laboratoire** : le jeu de démonstration porte réellement ce trou,
et c'est ce qui rend la règle du §8.4 observable sans fabriquer de donnée.

### 8.9 Preuves exigées — sous-tranche 2a

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0054_rendu_modeles_emails.test.sql` : la forme de la fonction dans le catalogue (volatilité, `security invoker`, privilèges rôle par rôle), la substitution des **douze** variables une à une, les deux formatages du §8.6, les trous nuls et leur nomination, le tri et le dédoublonnage de `variables_nulles`, la variable absente du modèle qui n'est **pas** listée, et le cloisonnement par la RLS prouvé avec les trois profils réels |
| API | `e2e/api/rendu-modeles-emails.spec.ts` : les quatorze lignes du §8.8 avec les jetons réels ; chaque zéro-ligne relu pour constater qu'aucune erreur n'est rendue |
| Unitaire | **aucun** : la sous-tranche ne livre aucune logique TypeScript. La règle vit en SQL, et pgTAP est son niveau. L'écart est **nommé** plutôt que compensé par un test de façade — même position qu'au §2.9 |
| Harnais | `scripts/verify-rendu-modeles-emails.sh` : verdict unique, non complaisant, avec des **dégradations réelles** dont la restauration est constatée **octet à octet** contre un instantané pris avant la première, jamais contre `HEAD` (§2.11) |
| Seed | **inchangé** : les deux modèles du §2.8 suffisent, et le trou de `card.amount` qu'ils exercent est précisément ce que le §8.4 rend observable |
| E2E interface | **aucun** : 2a ne livre aucun écran. L'écart est nommé, et l'écran est 2b |

### 8.9 bis UN DÉFAUT DU HARNAIS TROUVÉ PAR LE HARNAIS, corrigé à sa cause

Son premier passage a rendu « 32 contrôles, 2 anomalies » — et l'une des deux était un **faux
verdict**, exactement de la famille que le §2.11 a corrigée sur la tranche 1, sous une forme
nouvelle.

La dégradation D-E remplaçait la source de l'inventaire par la liste fermée. Le SQL obtenu portait
un `trou[1]` posé sur un `text` : il **ne compile pas**. Or `degrader` ignorait le code de retour de
`psql`, si bien que la base restait **inchangée**, la suite pgTAP restait verte, et le harnais
concluait « COMPLAISANT — la suite reste VERTE » alors que **rien n'avait été dégradé**.

Le §2.11 avait corrigé l'échec silencieux de la **substitution** ; celui-ci est l'échec silencieux
de l'**application**. Corrigé à sa cause : le code de retour de `psql` est **testé**, un échec est
nommé « IMPOSSIBLE » plutôt que compté pour une preuve, et la migration est restaurée
immédiatement. La dégradation D-E est réécrite dans une forme qui s'applique, et elle **mord**.

La seconde anomalie était de même nature : le contrôle de couverture nourrissait `psql` par son
entrée standard sans capturer son erreur, et rendait donc une chaîne **vide** en cas d'échec — le
harnais écrivait alors « des variables ne sont pas rendues : » suivi de rien. **Un contrôle dont
l'échec ne se distingue pas de son verdict est un contrôle qui ment** ; il passe désormais par un
fichier et capture sa sortie d'erreur.

### 8.10 Ce que la sous-tranche 2a ne prouve pas, et qui n'est pas masqué

- **Aucun écran.** Le rendu ne s'atteint que par l'API. L'écran est 2b, cadré au §8.11.
- **Aucun envoi.** `mail_outbox` ignore toujours les modèles ; rien n'est changé à `CRM-058`.
- **Aucune signature, aucune séquence** — tranches 3 et 4, cadrées au §7.2 et au §7.3.
- **Aucun fuseau horaire.** Le rendu d'un horodatage est en UTC (§8.6), et l'écart est consigné au
  registre plutôt que comblé par une valeur devinée.

### 8.11 Cadrage de la sous-tranche 2b — l'écran, à spécifier avant d'être écrite

Une **huitième surface de réglages**, jumelle des §5.34 et §5.35 du design system par sa forme :
liste des modèles, création, modification, suppression **avec confirmation**, et prévisualisation
appelant `rendre_modele_email` sur une affaire réelle. Les questions qu'elle devra trancher, et qui
ne le sont pas ici :

- comment l'écran **choisit** l'affaire, le contact et l'identité de la prévisualisation, sachant
  que les trois se lisent sous RLS et qu'aucun n'est deviné (§8.5) ;
- comment `variables_nulles` se **rend** — la liste, sa place, et ce qu'elle dit ;
- comment la liste **fermée** des douze variables est proposée au rédacteur, `app.mail_template_variables()`
  étant la source unique (§3) ;
- ce que la confirmation de suppression **annonce**, la tranche 4 devant poser un `on delete restrict`
  qui n'existe pas encore (§2.2).

> **SPÉCIFIÉE le 2026-08-25, au §9 ci-dessous**, après mesure sur la pile debout et seedée, et
> **avant sa première ligne de code**. Les quatre questions ci-dessus y sont tranchées : la
> première au §9.5, la deuxième au §9.6, la troisième au **§9.3** — qui a exigé une mesure et une
> migration —, et la quatrième au §9.7.

---

## 9. Sous-tranche 2b — l'écran d'administration des modèles

Écrite le 2026-08-25 **après mesure sur la pile debout et seedée**, et **avant la première ligne de
code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2). Elle développe le cadrage du §8.11, qu'elle ne
remplace pas.

### 9.1 Ce que l'écran est, et où il vit

Une **huitième surface de réglages**, à l'adresse `/reglages/modeles-emails`, jumelle des §5.34 et
§5.35 du design system par sa forme — `ul` de lignes plates, formulaire replié **dans le flux du
document et jamais une modale**, refus `role="alert"` dans le bloc concerné, état vide porteur du
geste, commande jamais éteinte selon le rôle.

**Elle vient APRÈS les identités sortantes et AVANT l'état de la messagerie** dans l'index des
réglages, et l'ordre a une raison : on déclare l'expéditeur avant d'écrire le texte qu'il expédiera,
et on configure avant de superviser — c'est l'argument qui a déjà placé `CHEMIN_ADMIN_COMPTES_MAIL`
avant `CHEMIN_ETAT_MESSAGERIE`, repris sans changement.

**Elle n'ouvre AUCUNE politique et n'ajoute AUCUNE règle de produit.** Elle lit `mail_templates`
sous la RLS de la migration `0055`, écrit par les routes REST de cette même table, et appelle
`public.rendre_modele_email` de la migration `0056`. La seule migration qu'elle porte est le
guichet du §9.3, qui n'est pas une règle mais une **exposition**.

### 9.2 Ce que l'écran lit, et ce qu'il n'ouvre pas

| Source | Emploi | Volume mesuré sur le seed |
|---|---|---|
| `mail_templates` | la liste, la fiche | 2 |
| `cards` (`id`, `title`) | le sélecteur d'affaire de la prévisualisation | **41** |
| `contacts` (`id`, `full_name`, `email`) | le sélecteur de contact | 3 |
| `mail_outbound_identities` (`id`, `label`, `from_address`, `from_name`) | le sélecteur d'identité | 2 |
| `public.mail_template_variables()` | la palette du §9.3 | 12 |

Les quatre premières sont **déjà** lues ailleurs dans la webapp et se relisent ici sous la RLS de
l'appelant. Aucune n'est filtrée par l'écran : ce que la base rend est ce que le sélecteur propose,
et c'est la règle tenue par les sept surfaces de réglages précédentes.

### 9.3 LA LISTE FERMÉE DES DOUZE VARIABLES — une MESURE a décidé, et elle impose une migration

**MESURÉ le 2026-08-25** : `PGRST_DB_SCHEMAS` vaut `public,storage,graphql_public`
(`docker-compose.yml`, `.env.example`). Le schéma **`app` n'est donc pas exposé**, et
`app.mail_template_variables()` — source unique du §3 — est **hors de portée de l'écran**.
Mesuré aussi : `to_regprocedure('public.mail_template_variables()')` rend `NULL`, aucun guichet
public n'existant.

Deux issues, et une seule est tenable :

- **Recopier les douze noms en TypeScript est ÉCARTÉ.** Le §3 pose que la liste est écrite une
  seule fois « parce qu'écrire la liste deux fois serait garantir qu'elles divergent ». Une
  treizième variable ajoutée au §2.4 laisserait la palette de l'écran muette sur elle, sans qu'aucune
  preuve ne le voie : la contrainte l'accepterait, le rendu la substituerait, et seule l'interface
  l'ignorerait.
- **Un GUICHET PUBLIC est posé**, migration `0057_guichet_variables_modeles.sql` :
  `public.mail_template_variables()`, `immutable`, `security invoker`, qui **délègue** à
  `app.mail_template_variables()` et ne redéclare rien. `grant execute` à `authenticated` et
  `service_role`, **jamais à `anon`** — un appelant anonyme n'écrit aucun modèle ; ce sont les
  privilèges de `public.rendre_modele_email` (§8.7), repris sans changement, et le `revoke all …
  from public` nommément précédé, point de sûreté des migrations 48 à 56.

**Une assertion pgTAP compare les DEUX fonctions et exige leur ÉGALITÉ**, jamais leurs seuls
cardinaux : c'est cette assertion qui rend la délégation vérifiable, et sans elle le guichet
pourrait dériver en silence — exactement le défaut que la duplication aurait produit.

**Ce que la palette fait de la liste.** Sous le champ du corps, un bloc « Variables disponibles »
rend les douze noms, **chacun en donnée technique** (§2 du design system) et **chacun dans un
bouton**. Le bouton **insère** `{{nom}}` à la position du curseur du dernier champ que le rédacteur
a visité — l'objet ou le corps —, et **le corps à défaut**, aucun des deux n'ayant encore été
visité à l'ouverture. Ce n'est **pas** une garde de saisie (§5.3 ter) : le rédacteur peut taper
n'importe quoi dans les deux champs, et c'est la contrainte `mail_templates_subject_variables` ou
`mail_templates_body_variables` qui refuse, refus **traduit** par le §9.8.

### 9.4 La liste, et ce qu'une ligne porte

`ul` de lignes plates (§5.18), avec les hauteurs et les séparateurs du §5.9.

- **LE NOM EST EN TÊTE DE LIGNE, et c'est la clé** : `mail_templates_workspace_name_key` le rend
  unique par workspace sur sa forme normalisée (§2.2). C'est le raisonnement du §5.35 — « la tête
  de ligne suit la clé » —, appliqué ici à une clé d'un seul champ.
- **L'objet suit, en second ton et tronqué**, parce que c'est ce qu'un destinataire lira en premier
  et que deux modèles de même intention s'y distinguent. Il **peut porter des variables**, et elles
  se rendent **telles quelles** : la liste n'est pas une prévisualisation, et substituer ici
  supposerait une affaire que la liste n'a pas.
- **AUCUNE PILULE, AUCUNE COULEUR, AUCUN COMPTE DE VARIABLES.** Un modèle n'a pas d'état : la table
  ne porte ni statut, ni `archived_at` (§2.2). Un compte de variables serait un chiffre qui ne dit
  pas ce qu'il compte (§5.36) et que rien du produit ne consomme.
- **Deux commandes par ligne** : « Prévisualiser » et « Modifier ». La **suppression n'est pas sur
  la ligne** : elle vit dans la fiche, derrière la confirmation du §9.7 — patron du §5.29, dont le
  motif vaut ici sans changement, un geste destructeur ne se déclenchant pas depuis une liste qu'on
  balaye.
- **La lectrice voit les deux commandes.** Aucune n'est éteinte selon le rôle (§5.3, §5.13, §5.21,
  §5.27, sans exception) : « Prévisualiser » lui rend un rendu, mesuré `200` au §8.8 ligne 2, et
  « Modifier » lui rend le refus traduit du §9.8 — `403` sur un `PATCH`, ou **zéro ligne** selon le
  verbe (§2.7 lignes 6 et 7).
- **La borne est `104ch`**, celle du §5.34 et pour son motif exact : une ligne porte ici quatre
  éléments dont deux commandes, et la borne d'un paragraphe de prose l'y replierait.
- **L'état vide porte le geste** — « Aucun modèle d'email » suivi de la commande de création
  (§5.13). Le seed en pose deux, si bien qu'il ne se rencontre qu'après une suppression complète.

### 9.5 LA PRÉVISUALISATION — comment l'écran choisit ses trois sources, sans rien deviner

C'est la première des quatre questions du §8.11, et le §8.5 en fixe déjà la moitié : le **rendu** ne
devine jamais. L'écran ne devine pas davantage, et **ne présélectionne rien**.

- **L'affaire — un `select` dont l'option de tête est VIDE, et aucune prévisualisation n'est
  demandée tant qu'elle est choisie.** `p_card_id` est obligatoire (§8.5) ; présélectionner la
  première affaire de la liste ferait rendre un texte au sujet d'une affaire que personne n'a
  désignée, et cette affaire-là, MESURÉ, serait « Assistant IA support — Nordis » simplement parce
  qu'elle vient en tête de tri. L'option vide est ici l'aveu qu'aucun choix n'est fait, et le bloc
  de rendu porte alors l'état vide du §9.6.
- **Le contact — facultatif, option vide « Aucun contact », et la liste porte TOUS les contacts que
  l'appelant lit**, jamais les seuls contacts rattachés à l'affaire choisie. **MESURÉ** :
  `card_contacts` ne porte que **2 lignes pour 41 affaires**. Un sélecteur restreint au rattachement
  serait donc **vide sur 39 affaires sur 41**, et la prévisualisation ne pourrait jamais montrer
  `{{contact.full_name}}` rempli — c'est-à-dire précisément ce qu'elle sert à montrer. Le §8.5
  accepte explicitement un contact non rattaché, et l'accepter ici est cette règle appliquée, non
  une tolérance nouvelle.
- **L'identité — facultative, option vide « Aucune identité ».** « L'identité par défaut du
  workspace » **n'existe pas**, et c'est une mesure et non une prudence (§8.5) : **deux** lignes du
  seed portent `is_default = true`, les index uniques partiels garantissant l'unicité **par
  personne** et **pour le service**. En présélectionner une reviendrait à choisir entre deux
  défauts également légitimes.
- **Une identité est nommée `libellé — adresse`**, comme au §5.35 et pour son motif : deux identités
  d'une même personne peuvent porter le même libellé, et l'adresse est leur clé.
- **La prévisualisation est un GESTE EXPLICITE**, un bouton, jamais un rendu qui suivrait chaque
  frappe : la fonction lit six tables sous RLS, et la déclencher à chaque changement de sélecteur
  ferait trois appels pour un seul choix. Le bouton porte son libellé d'attente pendant le vol et
  **n'est jamais désactivé par l'état des champs** (§5.3 ter) — une affaire non choisie fait rendre
  **zéro ligne** par la fonction, ce que le §9.6 rend en toutes lettres.

### 9.6 CE QUE `variables_nulles` REND — la deuxième question

Le rendu réussi porte trois valeurs (§8.3), et l'écran les rend **toutes les trois**.

- **L'objet et le corps se rendent tels que la base les a substitués**, dans un bloc de lecture. Le
  corps préserve ses retours à la ligne (`white-space: pre-wrap`) : le sous-système expédie du
  **texte** (`docs/SPEC-mail-subsystem.md` §18), et un corps reflué mentirait sur ce qui partira.
- **`variables_nulles` NON VIDE rend un bloc nommé**, `role="status"` et jamais `role="alert"` : la
  prévisualisation a **réussi**, rien n'est refusé, et employer le rôle du refus ferait lire une
  panne là où il y a une information. Le bloc porte son compte **en toutes lettres et dans son
  propre élément** — « 1 variable sans valeur », « 3 variables sans valeur » — jamais un badge nu
  ni un nœud de texte accolé, qui est le défaut « Discussion1 » du §5.11. **L'accord se fait par
  CLÉ**, jamais par un gabarit paramétré : « les 1 variables » est faux (§10).
- **Il dit ce que le trou DEVIENT, et c'est la moitié utile de l'information** : « ces variables
  sont rendues vides dans le message ci-dessus ». C'est la décision du §8.4 rendue lisible ; sans
  cette phrase, la liste nommerait un défaut sans dire sa conséquence.
- **Chaque nom est rendu en donnée technique**, la graphie exacte que le rédacteur a tapée dans le
  modèle — `identity.from_name`, jamais « le nom de l'expéditeur » : c'est la chaîne qu'il ira
  chercher dans son texte, et la traduire l'obligerait à la retraduire.
- **`variables_nulles` VIDE ne rend RIEN.** Aucun « aucune variable manquante », aucune pilule
  verte : c'est la règle de la cellule vide du §5.9 — l'absence dit déjà ce qu'un message
  répéterait —, et le §1 réserve la couleur à ce qui la mérite.
- **Zéro ligne rendue par la fonction n'est PAS une erreur, et se dit** : « Aucun rendu — choisissez
  une affaire, ou l'affaire choisie n'est plus lisible ». Les deux causes sont **volontairement
  confondues dans une seule phrase**, parce que la fonction les confond elle-même (§8.3) et qu'une
  phrase qui les distinguerait divulguerait ce que le zéro-ligne cache.

### 9.7 CE QUE LA CONFIRMATION DE SUPPRESSION ANNONCE — la quatrième question

Une suppression détruit un texte qu'il faudra réécrire : le §6 du design system exige donc une
confirmation, et elle **nomme le modèle** (§5.27).

- **Elle N'ANNONCE AUCUNE CASCADE, et c'est une MESURE** : `pg_constraint` ne porte **aucune** clé
  étrangère vers `mail_templates` au 2026-08-25. Rien dans le produit ne référence un modèle
  aujourd'hui. Annoncer « les séquences qui l'emploient seront rompues » serait décrire un objet
  que la tranche 4 n'a pas encore posé — l'invention exacte que le §8.5 refuse.
- **Elle n'annonce pas non plus le refus À VENIR** de l'`on delete restrict` de la tranche 4 (§2.2) :
  une confirmation qui promettrait un refus que la base ne sait pas encore rendre mentirait dans
  l'autre sens. Le jour où la tranche 4 posera cette clé, c'est **elle** qui écrira ce que la
  confirmation ajoute, et le §2.2 lui a déjà écrit la contrainte pour qu'elle ne la découvre pas.
- **Elle dit ce qui est vrai aujourd'hui, et rien de plus** : « Supprimer « Relance sans réponse » ?
  Le texte du modèle est définitivement perdu. » — le nom, et l'irréversibilité.
- **Le bouton de la confirmation est destructif plein** (§5.5), celui qui l'ouvre ne l'est pas
  (§5.28). La commande reste **montée et DÉSACTIVÉE** pendant la confirmation, et le retour du focus
  est **différé d'un tour de rendu** : un bouton désactivé refuse le focus, défaut mesuré au §5.29 et
  dont le remède est un drapeau puis un effet — **aucune temporisation** (`CLAUDE.md` §18).
- **LE SILENCE DE LA CLAUSE `using` SE DIT EN TOUTES LETTRES.** MESURÉ au §2.7 ligne 8 : la lectrice
  qui confirme reçoit `204` et **la ligne est toujours là**. L'écran relit la liste et, si le modèle
  y figure encore, écrit « Aucun modèle n'a été supprimé » — jamais un succès qui n'a pas eu lieu.
  C'est la règle du §5.29, reprise mot pour mot parce que la situation est identique.

### 9.8 Le dictionnaire fermé des refus, et pourquoi aucune phrase du serveur n'atteint l'écran

Comme les deux surfaces jumelles, l'écran **classe** un refus en une issue nommée et ne rend jamais
le corps d'erreur. Le motif est ici plus étroit que l'INC-193 des identités, et il est propre à
cette table : le corps d'un `23514` de PostgREST porte le champ `details`, qui contient la **ligne
fautive entière** — c'est-à-dire le corps du modèle, jusqu'à 20 000 caractères.

| Issue | Réponse mesurée | Ce que l'écran dit |
|---|---|---|
| `enregistre` | `201` / `200` | rien : la liste relue est la preuve |
| `refus` | `403`, `42501` | l'écriture est réservée à l'administration et au développement commercial |
| `zero-ligne` | `200` et `[]` sur un `PATCH` | aucun modèle n'a été modifié |
| `variable-inconnue` | `400`, `23514`, `mail_templates_subject_variables` / `_body_variables` | une variable n'existe pas, avec **la colonne nommée** — c'est pour cela que la migration `0055` nomme deux contraintes plutôt qu'une (§2.3) |
| `nom-borne` | `400`, `23514`, `mail_templates_name_borne` | le nom doit faire de 1 à 120 caractères |
| `objet-borne` | `400`, `23514`, `mail_templates_subject_borne` | l'objet doit faire de 1 à 300 caractères |
| `corps-borne` | `400`, `23514`, `mail_templates_body_borne` | le corps doit faire de 1 à 20 000 caractères |
| `nom-pris` | `409`, `23505`, `mail_templates_workspace_name_key` | ce nom est déjà employé |
| `session-expiree` | `401` | la session a expiré |
| `reseau` | aucune réponse | la requête n'a pas abouti |
| `inconnu` | tout le reste | **repli nommé** : l'interface ne prétend pas savoir |

**Le classement se fait sur des identifiants STABLES** — les noms de contrainte, versionnés par la
migration `0055` —, jamais sur de la prose. C'est la discipline de `mail-identites.ts`, et son
harnais relit les noms **en base** pour qu'une migration qui renommerait une contrainte fasse rougir
une preuve plutôt que retomber en silence sur `inconnu`.

### 9.9 Contrat d'API consommé — aucune ligne nouvelle

L'écran n'appelle **que** des routes déjà mesurées : les quatorze lignes du §2.7 pour la table, et
les quatorze du §8.8 pour le rendu. Il ajoute **un seul** appel neuf, celui du guichet du §9.3 :

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| 1 | anonyme | `POST /rest/v1/rpc/mail_template_variables` | `401`, `42501` — refusé par le **privilège**, comme `rendre_modele_email` |
| 2 | `viewer` | idem | `200`, les **douze** noms triés |
| 3 | `admin` | idem | `200`, la même liste — la liste ne dépend pas du rôle |
| 4 | `admin` | comparaison au §2.4 | les douze noms **un à un**, jamais par leur cardinal |

### 9.10 Preuves exigées — sous-tranche 2b

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0055_guichet_variables_modeles.test.sql` : la forme du guichet dans le catalogue (volatilité, `security invoker`, privilèges rôle par rôle, `anon` **exclu**), et l'**égalité** avec `app.mail_template_variables()` — jamais l'égalité des seuls cardinaux |
| Unitaire | `webapp/src/lib/modeles-emails.test.ts` : le classement des onze issues du §9.8 sur des messages réels, l'insertion d'une variable à une position de curseur, la composition du corps de requête, et le libellé d'une identité |
| API | `e2e/api/guichet-variables-modeles.spec.ts` : les quatre lignes du §9.9 avec les jetons réels |
| E2E interface | `e2e/ui/modeles-emails.spec.ts` : la liste, la création, la modification, le refus d'une variable inconnue **traduit**, la suppression derrière sa confirmation, le zéro-ligne de la lectrice, la prévisualisation d'un modèle sur une affaire réelle, et le bloc `variables_nulles` **nommé** ; captures conformes à `CLAUDE.md` §16 |
| Harnais | `scripts/verify-modeles-emails-ecran.sh` : verdict unique, non complaisant, avec des **dégradations réelles** dont la restauration est constatée **octet à octet** contre un instantané pris avant la première (§2.11, §8.9 bis) |
| Seed | **inchangé** : les deux modèles du §2.8 ouvrent l'écran sur du contenu, et l'état vide ne se rencontre qu'après une suppression complète |

### 9.11 Definition of Done — sous-tranche 2b

- migration `0057_guichet_variables_modeles.sql` appliquée et rejouable ;
- suite pgTAP dédiée verte ;
- écran livré, atteignable depuis l'index des réglages, et **vérifié visuellement** — captures
  produites ET observées (`CLAUDE.md` §16) ;
- tests unitaires, contrat d'API et scénarios E2E verts ;
- harnais dédié vert, ses dégradations vues ;
- `docs/DESIGN_SYSTEM.md` §5.39, `docs/SCHEMA.md` §7, `docs/PROD_MIGRATIONS.md`, `README.md`,
  `docs/manual.md` chapitre 15 et `CHANGELOG.md` mis à jour **dans le même changement** ;
- commentaires `@spec` / `@verifies` sur chaque fichier ;
- commit poussé sur `origin/main`.

### 9.12 Ce que la sous-tranche 2b ne fera PAS, et qui n'est pas masqué

- **Aucun envoi.** L'écran prévisualise ; il n'écrit rien dans `mail_outbox`. Composer un message à
  partir d'un modèle est un geste de l'écran d'envoi, et il appartient à la tranche 4.
- **Aucune signature, aucune séquence** — tranches 3 et 4.
- **Aucun fuseau horaire** : la prévisualisation rend ce que la base rend, c'est-à-dire de l'UTC
  (§8.6, INC-216). L'écran ne corrige pas un écart consigné.

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

### 7.2 Tranche 3 — la signature

Rendre effectif ce que `CRM-053` a posé et que personne n'emploie (§6). Elle devra dire : le nom et
le type de la colonne, sa position dans le corps expédié, son effacement, et si une signature est
propre à une identité ou à une personne.

### 7.3 Tranche 4 — la séquence de relance

Des paliers ordonnés, chacun portant un modèle (`on delete restrict`, §2.2) et un délai, appliqués
à une affaire figée au sens de `docs/SPEC-relances.md` §2. Elle réemploiera l'ordonnanceur de
`CRM-017` et le job quotidien de `CRM-062` tranche 2, et devra trancher : qui arme une séquence, ce
qui l'interrompt, et ce qu'une réponse du destinataire produit.

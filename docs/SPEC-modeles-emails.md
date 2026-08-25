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
- État : **les quatre tranches sont spécifiées ici** — la 1 aux §2 à §6, la 2 au §8 (rendu) et au
  §9 (écran), la 3 au §10, la **sous-tranche 4a** au **§11** —, chacune écrite le 2026-08-25
  **après mesure sur la pile debout et seedée**, avant sa première ligne de code (`CLAUDE.md` §5,
  `docs/CloudWorker.md` §3.2). Les sous-tranches **4b** et **4c** sont **cadrées** au §11.12 et
  seront spécifiées ligne à ligne avant d'être écrites, dans leur propre chunk.

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

> **SPÉCIFIÉE le 2026-08-25, au §10 ci-dessous**, après mesure sur la pile debout et seedée, et
> **avant sa première ligne de code**. Les quatre questions ci-dessus y sont tranchées aux §10.2,
> §10.3, §10.4 et §10.5.

### 7.3 Tranche 4 — la séquence de relance

Des paliers ordonnés, chacun portant un modèle (`on delete restrict`, §2.2) et un délai, appliqués
à une affaire figée au sens de `docs/SPEC-relances.md` §2. Elle réemploiera l'ordonnanceur de
`CRM-017` et le job quotidien de `CRM-062` tranche 2, et devra trancher : qui arme une séquence, ce
qui l'interrompt, et ce qu'une réponse du destinataire produit.

> **DÉCOUPÉE EN TROIS SOUS-TRANCHES ET SPÉCIFIÉE le 2026-08-25, au §11 ci-dessous**, après mesure
> sur la pile debout et seedée, et **avant sa première ligne de code**. Le §11 est le contrat
> exécutable de la sous-tranche **4a** — la séquence et ses paliers. Les trois questions ci-dessus
> portent sur l'**application** d'une séquence à une affaire : elles appartiennent à **4b**, et
> sont cadrées au §11.12.

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

### 9.10 bis UN DÉFAUT DU HARNAIS TROUVÉ PAR LE HARNAIS — le troisième, et le premier FAUX ROUGE

Son premier passage a rendu « 37 contrôles, 1 anomalie », et l'anomalie **n'en était pas une**.

Les contrôles de sa section 4 cherchent ce que l'écran **s'interdit** : `required`, `maxLength`, un
droit calculé. Écrits sur le fichier **brut**, ils trouvaient ces mots dans le **commentaire** qui
explique pourquoi ils sont absents — « AUCUNE GARDE DE SAISIE : ni `required`, ni `maxLength` » — et
le harnais rendait « ECHEC » sur un écran parfaitement conforme.

**LES DEUX DÉFAUTS PRÉCÉDENTS ÉTAIENT DES FAUX VERTS ; CELUI-CI EST UN FAUX ROUGE, ET IL EST TOUT
AUSSI GRAVE.** Le §2.11 avait corrigé l'échec silencieux de la **substitution**, le §8.9 bis celui de
l'**application** : dans les deux cas, le harnais annonçait une preuve qu'il n'avait pas faite. Ici
il annonce un défaut qui n'existe pas — et un harnais qui rougit sur du texte juste finit par être lu
comme du bruit, ce qui revient au même : son verdict cesse de vouloir dire quelque chose.

Corrigé **à sa cause** : les quatre contrôles qui lisent un fichier source passent désormais par
`code_seul`, qui retire les commentaires avant de chercher. Le contrôle mesure le **code**, jamais la
prose qui le décrit. La règle vaut au-delà de ce harnais : **un contrôle qui cherche l'absence d'un
motif doit chercher dans ce qui s'exécute**, sans quoi la documentation d'une règle suffit à la faire
paraître violée.

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

---

## 10. Tranche 3 — la signature

Écrite le **2026-08-25**, après mesure sur la pile debout et seedée, et **avant sa première ligne
de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2). Elle tranche les quatre questions que le
§7.2 avait nommées sans y répondre, et chacune l'est par une **mesure**, jamais par un souvenir.

### 10.1 Ce que la tranche livre, et ce qu'elle répare

`mail_outbound_identities.signature_html` existe depuis `CRM-053` et **personne ne la lit** — c'est
INC-215, consignée par la tranche 1 (§6) et laissée intacte par les tranches 2a et 2b. La tranche 3
la rend effective, et pour cela elle doit d'abord la rendre **nommable** : son nom annonce du HTML
là où tout le sous-système expédie du **texte**.

MESURÉ le 2026-08-25 sur la pile seedée, et c'est ce qui rend la réparation possible sans perte :

| Mesure | Résultat |
|---|---|
| `information_schema.columns` | `signature_html text`, `is_nullable = YES`, aucune borne |
| `pg_constraint` sur la table | douze contraintes, **aucune** ne cite `signature_html` |
| Vues dépendant de la table | **aucune** |
| Lignes du seed | **deux** identités, `signature_html is null` sur les **deux** |
| Lecteurs applicatifs | **aucun** : `mail-sync` ne la demande pas, l'écran de `CRM-089` ne la lit ni ne l'écrit (§22.1, §22.3 de `docs/SPEC-mail-subsystem.md`) |

La colonne est donc **vide partout**, **libre de contrainte** et **sans lecteur**. La renommer ne
casse aucun appelant et ne perd aucune donnée — ce qui ne sera plus vrai le jour où une signature y
sera écrite. C'est maintenant, ou jamais sans migration de données.

### 10.2 PREMIÈRE QUESTION — le nom et le type de la colonne

**Décision : `signature_html` devient `signature_text`, et reste `text` NULLABLE.**

Le type ne change pas ; c'est le **contrat annoncé par le nom** qui change, et il n'est pas
cosmétique. Trois raisons, mesurées :

1. **Ce qui part est du texte.** `mail_sync.composition.composer` appelle
   `EmailMessage.set_content(envoi.body_text)` et rien d'autre : le message soumis est un
   `text/plain; charset="utf-8"` à part unique. MESURÉ le 2026-08-25 en exécutant la fonction sur
   un corps signé — l'en-tête rendu est `Content-Type: text/plain`, `Content-Transfer-Encoding:
   7bit`. Une colonne nommée `_html` remplie de balises produirait donc un message où le
   destinataire lit `<br>` en toutes lettres.
2. **Le HTML entrant est déjà proscrit.** `docs/SPEC-mail-subsystem.md` §18.4 pose qu'aucun HTML
   d'origine extérieure ne s'affiche sans être maîtrisé. Le §22.1 refuse explicitement d'ouvrir un
   champ de signature HTML pour cette raison : « ouvrir ici un champ libre sans ce contrat serait
   ouvrir une surface que rien ne borne ». **Renommer en texte lève l'obstacle au lieu de le
   contourner** : il n'y a plus de HTML à assainir, donc plus de surface à border.
3. **Un nom faux coûte plus tard.** La colonne est morte ; le premier lecteur qu'elle recevra sera
   celui de cette tranche. Lui faire lire `signature_html` pour y mettre du texte installerait
   durablement la divergence qu'INC-215 dénonce.

**Une borne est posée dans le même geste** : `mail_outbound_identities_signature_borne`,
`char_length(signature_text) <= 2000`. La table borne déjà son libellé (120), son hôte, son
identifiant ; la signature était la seule colonne de texte libre **sans borne**, et elle va
désormais être **concaténée à chaque corps expédié** (§10.3). La borne n'est pas une garde de
saisie : elle protège la borne d'en face, mesurée — `mail_outbox_corps` exige
`char_length(body_text) between 1 and 100000`.

**Aucun `NOT NULL`** : `NULL` est l'absence de signature, et c'est le seul état que les deux
identités du seed connaissent aujourd'hui.

### 10.3 DEUXIÈME QUESTION — la position dans le corps expédié

**Décision : la signature est ajoutée à la FIN du corps, précédée d'une ligne vide et du séparateur
`-- `, et elle l'est À LA MISE EN FILE, dans `public.queue_outbound_email`.**

**Le séparateur est celui de la RFC 3676 §4.3** : une ligne contenant exactement deux tirets et une
espace. C'est la convention que les clients de messagerie reconnaissent pour replier ou griser une
signature, et l'inventer autrement priverait le destinataire de ce repli. MESURÉ : Python conserve
cette espace de fin telle quelle sous `7bit` — le corps soumis porte bien `\n\n-- \nDriss Lemoine`.
La **limite** est nommée au §10.8 : aucun produit ne peut garantir qu'un relais intermédiaire ne
rognera pas cette espace.

La forme exacte, et elle est éprouvable caractère à caractère :

```
<corps écrit par l'utilisateur>
                                  ← une ligne vide, toujours exactement une
-- 
<signature>
```

**LA COMPOSITION VIT EN BASE, ET C'EST UNE DÉCISION, PAS UNE COMMODITÉ.** Deux endroits pouvaient
la porter, et l'un ment :

- **au moment de l'envoi**, dans `mail_sync.envoi.vider_la_file`, en ajoutant `signature_text` à ce
  que `reserver_envois` rend. Écarté : `mail_outbox.body_text` serait alors **différent de ce que
  le destinataire a reçu**. Or c'est cette colonne que le CRM conserve, que la RLS ouvre à qui lit
  l'affaire, et que les preuves relisent. Un archivage qui diffère de l'envoi est un archivage qui
  ment, et le mensonge ne se verrait qu'en comparant deux systèmes ;
- **à la mise en file**, dans la garde. Retenu : `queue_outbound_email` est **la seule porte** de
  la file (§19.4 de `docs/SPEC-mail-subsystem.md`), donc la règle vaut pour l'écran de composition,
  pour une réponse, et pour tout envoi automatique futur — la tranche 4 comprise — sans qu'aucun
  appelant ait à y penser. Et le worker reste ce qu'il est : « il orchestre, il ne décide pas ».

**QUATRE RÈGLES DE COMPOSITION, chacune éprouvée par une assertion :**

1. **Identité sans signature** — `signature_text is null` — : le corps est stocké **inchangé**,
   sans ligne vide ajoutée, sans séparateur. Aujourd'hui, les deux identités du seed sont dans ce
   cas : la tranche ne change donc **rien** pour un envoi existant tant qu'aucune signature n'est
   écrite.
2. **Signature vide après `app.btrim_blancs`** : traitée comme absente. Elle ne peut pas être
   écrite (§10.4 la ramène à `NULL`), mais la garde ne s'en remet pas à cette promesse — une
   donnée posée par une autre voie ne doit pas produire un séparateur suivi de rien.
3. **Le corps est joint tel quel, ses blancs de fin retirés** avant la ligne vide : un corps
   terminé par trois retours à la ligne produirait sinon quatre lignes vides avant le séparateur,
   et l'écart serait invisible à l'écran et visible chez le destinataire. `app.btrim_blancs` est la
   fonction du produit pour cela (migration 35, INC-052) ; elle n'est **pas** recopiée.
4. **Le corps vide reste refusé, et il l'est AVANT la composition.** MESURÉ : `mail_outbox_corps`
   exige `char_length(body_text) >= 1`, si bien qu'un corps vide est refusé aujourd'hui en `23514`.
   Sans garde explicite, une signature le rendrait **non vide** et un message ne portant que la
   signature partirait. La garde refuse donc `body_required` en `23514` **avant** d'ajouter quoi
   que ce soit. Le code d'état ne change pas, et le dictionnaire de l'écran, qui classe par
   `SQLSTATE` et non par message (`webapp/src/lib/envoi.ts`), rend le même `invalide` qu'avant.

**LA BORNE HAUTE S'APPLIQUE AU CORPS COMPOSÉ, et c'est dit plutôt que subi** : un corps de 99 900
caractères expédié depuis une identité portant 200 caractères de signature dépasse les 100 000 de
`mail_outbox_corps` et sera **refusé** en `23514`. C'est le comportement voulu — ce qui est stocké
est ce qui part, donc c'est bien le tout qui doit tenir dans la borne — et la borne de 2 000
caractères du §10.2 garantit que l'écart ne dépasse jamais 2 % de la place.

### 10.4 TROISIÈME QUESTION — l'effacement

**Décision : `p_signature_text` est TOUJOURS envoyé par l'écran, y compris vide, et la fonction
normalise le vide en `NULL`.**

C'est exactement la règle mesurée de `p_from_name` (§22.5 de `docs/SPEC-mail-subsystem.md`), et
l'inverse de celle de `p_daily_quota`. Le motif est le `coalesce` de la branche `UPDATE`, lu dans
la migration `0033` : `signature_html = coalesce(p_signature_html, i.signature_html)`. Sous cette
écriture, **omettre conserve** — ce qui est voulu — mais **rien ne peut jamais ramener la colonne à
`NULL`**. Le §22.1 en avait tiré la seule conclusion honnête à l'époque : ne pas ouvrir de champ
qu'on ne saurait pas vider. La tranche 3 ouvre le champ, elle doit donc d'abord réparer
l'effacement.

**La normalisation vit dans la fonction, pas dans l'écran** (`CLAUDE.md` §10) :

```
signature_text = case
                   when p_signature_text is null then i.signature_text
                   when app.btrim_blancs(p_signature_text) = '' then null
                   else p_signature_text
                 end
```

Trois états, et non deux : **omis** conserve, **vide** efface, **rempli** écrit. La branche
`INSERT` applique la même normalisation, pour qu'une déclaration portant un champ vide ne pose pas
une chaîne vide là où une relecture attend `NULL`.

**LA SIGNATURE N'EST PAS RECADRÉE** : ses blancs internes et ses retours à la ligne sont conservés
tels quels — une signature EST une mise en forme. Seul le test de vacuité passe par
`app.btrim_blancs` ; la valeur écrite est celle qui a été saisie.

**RENOMMER UN PARAMÈTRE EXIGE UN `drop`**, et c'est mesuré, pas supposé : PostgreSQL refuse
`create or replace function` qui change le **nom** d'un paramètre d'entrée. La migration retire
donc `public.upsert_mail_outbound_identity(...)` avant de la reposer, et **repose ses `grant` dans
la même transaction** — un `drop` emporte les privilèges, et une fonction rendue exécutable par
`public` par les `alter default privileges` de la plateforme serait une porte ouverte (le point de
sûreté des migrations 48 à 57).

### 10.5 QUATRIÈME QUESTION — une signature appartient-elle à une identité ou à une personne ?

**Décision : à l'IDENTITÉ.** La colonne reste où `CRM-053` l'a posée, et ce n'est pas de la
paresse : c'est ce que la clé impose.

MESURÉ, et c'est écrit dans le §22.4 de `docs/SPEC-mail-subsystem.md` : la clé de cette table est
le **triplet** `(workspace_id, owner_id, from_address)`. Une personne peut donc porter **plusieurs**
identités sortantes, chacune avec sa propre adresse d'expédition. Or une signature nomme presque
toujours l'adresse, la fonction ou la société sous lesquelles on écrit : la même personne qui
expédie depuis `contact@…` et depuis `recrutement@…` ne signe pas de la même façon. Rattacher la
signature à la personne obligerait à choisir **une** de ses signatures pour toutes ses adresses.

Le seed le démontre plutôt que de le décrire : l'**identité de service**
`systeme@crm.p2enjoy.test` n'a **aucun propriétaire** (`owner_id is null`). Une signature portée
par la personne laisserait cette identité — celle qui expédie au nom du workspace — sans aucune
signature possible.

### 10.6 L'écran — le champ, et le seul écart au §5.35

L'écran des identités sortantes de `CRM-089` (`/reglages/identites-mail`) gagne **un champ**, et
rien d'autre :

- **une zone de texte multiligne « Signature »**, dans le groupe « Expédition », **après** le nom
  d'expéditeur — l'ordre du message : d'abord qui écrit, ensuite ce qui ferme ;
- **facultative**, sans `required`, sans `maxLength` : la borne est en base et c'est elle qui
  refuse (§10.2), une garde de saisie qui la doublerait ferait deux règles pour une (`CLAUDE.md`
  §10, et la discipline du §9.8) ;
- **un texte d'aide** qui dit ce que la base fera : la signature est ajoutée à la fin de chaque
  message expédié depuis cette identité, précédée d'une ligne de séparation ; vider le champ la
  supprime ;
- **la valeur est relue** : `signature_text` entre dans les colonnes demandées par
  `COLONNES_IDENTITE_SORTANTE`. Le §22.3 écrivait « ne pas lire ce qu'on ne montre pas » ; la
  réciproque vaut, et l'écran ne peut pas proposer de modifier une signature sans montrer celle qui
  est enregistrée ;
- **la liste ne rend PAS la signature**, seulement une pilule neutre **« Signature »** sur les
  lignes qui en portent une. Une signature de deux mille caractères dans une `ul` de lignes
  détruirait la densité que le §5.35 tient ; sa présence, elle, est une information de liste.

`p_signature_text` rejoint donc `p_from_name` dans les paramètres **toujours envoyés**, et le
commentaire de `argumentsEnregistrementIdentite` qui affirme le contraire est **révisé dans le même
changement** — de même que les deux tests unitaires qui figent aujourd'hui son absence
(`webapp/src/lib/mail-identites.test.ts`, `webapp/src/app/ReglagesIdentitesMail.test.tsx`). Ce sont
des preuves d'une règle qui change par arbitrage : elles sont **révisées en expliquant pourquoi
dans le fichier lui-même**, jamais supprimées ni contournées (`docs/CloudWorker.md` §3.1).

### 10.7 Preuves exigées — tranche 3

| Preuve | Ce qu'elle doit montrer |
|---|---|
| pgTAP `supabase/tests/0055_signature_identite.test.sql` | la colonne renommée et bornée ; les trois états de l'effacement — omis conserve, vide efface, rempli écrit — chacun **précédé de son témoin** ; les quatre règles de composition du §10.3 comparées **caractère à caractère** ; le refus `body_required` ; le refus de borne haute sur le corps composé |
| API `e2e/api/signature-identite.spec.ts` | avec les **jetons réels** : Driss écrit sa signature et la relit ; il la vide et relit `null` ; un envoi mis en file depuis son identité porte le corps **composé** ; la lectrice est refusée |
| Unitaires webapp | `p_signature_text` **toujours** envoyé, vide compris ; `signature_text` dans les colonnes lues ; la pilule rendue si et seulement si la signature est non vide |
| E2E `e2e/ui/reglages-identites-mail.spec.ts` (révisé) | la saisie, l'enregistrement, la relecture, l'effacement, au clavier et à la souris, console **vierge** |
| Harnais `scripts/verify-signature-identite.sh` | non complaisant : dégradations réelles, restauration constatée octet à octet |
| Captures | `docs/captures/CRM-063/` — le champ rempli, la liste avec la pilule, les paliers responsive |

### 10.8 Ce que la tranche 3 ne fait PAS, et qui n'est pas masqué

- **Aucune variable dans la signature.** `{{contact.full_name}}` écrit dans une signature est
  expédié **littéralement** : la substitution du §8 appartient au corps d'un modèle, et une
  signature n'est pas rendue par `rendre_modele_email`. Une assertion **fige** ce comportement
  plutôt que de le laisser à l'interprétation.
- **Aucune garantie sur l'espace de fin du séparateur.** `-- ` est écrit et stocké avec son espace,
  MESURÉ jusqu'à la sortie de `set_content` ; ce qu'un relais intermédiaire en fait n'appartient
  pas à ce produit. Les clients qui replient la signature acceptent très majoritairement les deux
  formes.
- **Aucune signature HTML.** Le type est le texte, définitivement (§10.2). Une signature riche
  demanderait un éditeur, un assainissement et un message multipart : trois surfaces qu'aucune
  unité n'a spécifiées.
- **Aucune signature par défaut du workspace.** Chaque identité porte la sienne ou n'en porte pas.
- **Aucune séquence de relance** — tranche 4.

### 10.9 Definition of Done — tranche 3

- migration `0058_signature_identite_sortante.sql` appliquée et **rejouable** ;
- suite pgTAP dédiée verte ;
- contrat d'API mesuré avec les jetons réels des trois profils ;
- écran livré et **vérifié visuellement**, captures produites ET observées (`CLAUDE.md` §16) ;
- tests unitaires et E2E verts, y compris les preuves **révisées** du §10.6 ;
- harnais dédié vert, ses dégradations vues ;
- seed enrichi : au moins une identité **porte** une signature, au moins une n'en porte pas ;
- `docs/SCHEMA.md` §7, `docs/DESIGN_SYSTEM.md` §5.35, `docs/SPEC-mail-subsystem.md` §14.2 / §22,
  `docs/PROD_MIGRATIONS.md`, `docs/SPEC-seed.md`, `README.md`, `docs/manual.md` chapitre 15 et
  `CHANGELOG.md` mis à jour **dans le même changement** ;
- INC-215 **close** au registre, avec la mesure qui la clôt ;
- commentaires `@spec` / `@verifies` sur chaque fichier ;
- commit poussé sur `origin/main`.

---

## 11. Tranche 4 — la séquence de relance

Écrite le 2026-08-25 **après mesure sur la pile debout et seedée**, et **avant la première ligne de
code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2). Elle développe le cadrage du §7.3, qu'elle ne
remplace pas : le §7.3 disait *quoi*, ce chapitre dit *ligne à ligne*.

### 11.1 Découpe en trois sous-tranches, et son motif

Le §7.3 nomme trois questions — qui arme une séquence, ce qui l'interrompt, et ce qu'une réponse du
destinataire produit. Ces trois questions portent sur l'**application** d'une séquence à une
affaire, pas sur la séquence elle-même : elles supposent qu'un objet « séquence » existe et qu'un
palier sache quel modèle il envoie et quand. Répondre aux trois avant d'avoir cet objet reviendrait
à spécifier un comportement sur une table qui n'existe pas.

| Sous-tranche | Objet | Pourquoi elle est séparée |
|---|---|---|
| **4a** | La **séquence et ses paliers** en base : `public.mail_sequences`, `public.mail_sequence_steps`, contraintes, RLS, privilèges, pgTAP, contrat d'API, seed, harnais | C'est l'objet dont les deux autres dépendent : un armement qui n'a rien à armer n'existe pas |
| **4b** | L'**armement et l'exécution** : l'application d'une séquence à une affaire figée, le job qui met les messages en file, l'interruption | Elle consomme 4a et répond aux trois questions du §7.3 |
| **4c** | L'**écran** d'administration des séquences et l'armement depuis l'affaire | Elle consomme 4a et 4b et n'ajoute aucune règle de base |

L'ordre est celui de la dépendance, comme les quatre tranches de l'unité (§1) et les deux
sous-tranches de la tranche 2 (§8.1). Chacune est committée et prouvée avant la suivante.

**Ce chapitre spécifie la sous-tranche 4a, et elle seule.** Les §11.2 à §11.11 sont son contrat
exécutable ; le §11.12 cadre 4b et 4c, qui seront spécifiées ligne à ligne avant d'être écrites,
dans leur propre chunk.

### 11.2 Ce qu'une séquence est, et à qui elle appartient

Une séquence de relance est une **cadence éditoriale nommée** : « au bout de trois jours, envoyer
ce texte ; sept jours après, celui-là ; quatorze jours après, le premier de nouveau ».

Elle appartient au **workspace**, exactement comme un modèle (§2.1) et pour la même raison : deux
personnes qui relancent le même prospect doivent relancer à la même cadence, et dupliquer une
cadence par channel serait la duplication que `CLAUDE.md` §4 proscrit.

**Elle ne porte aucune identité sortante.** Le §2.1 a écarté le lien inverse pour le modèle — un
contenu ne dépend pas du compte SMTP qui l'expédie — et l'argument vaut ici sans changement : deux
personnes appliquant la même séquence à deux affaires signent chacune de leur adresse. **Quelle
identité expédie est une question d'armement**, donc de 4b (§11.12).

**Elle ne porte aucun seuil de déclenchement.** « Figée » a UNE définition en base depuis
`CRM-062` — `public.cards_figees()`, dont le seuil effectif est celui de l'étape ou du nœud
(`docs/SPEC-relances.md` §2.2). Une séquence qui porterait son propre seuil en créerait une
seconde, et le §2.1 de `docs/SPEC-relances.md` existe précisément pour l'empêcher.

### 11.3 `public.mail_sequences` — colonnes

| Colonne | Type | Nullable | Règle |
|---|---|---|---|
| `id` | `uuid` | non | `gen_random_uuid()` |
| `workspace_id` | `uuid` | non | → `workspaces (id) on delete cascade` |
| `name` | `text` | non | 1 à 120 caractères après `app.btrim_blancs` ; **unique par workspace** sur la forme normalisée, comme `mail_templates.name` |
| `created_by` | `uuid` | oui | → `profiles (id) on delete set null`. **Trace, jamais un droit**, même règle qu'au §2.2 |
| `created_at` | `timestamptz` | non | `now()` |
| `updated_at` | `timestamptz` | non | `now()`, tenu par `app.set_updated_at()` |

**Aucune colonne `description`, et c'est une décision.** Personne ne la lirait : 4a ne livre aucun
écran, et 4c n'a encore rien demandé. La tranche 3 vient de payer le prix d'une colonne posée « au
cas où » — `signature_html`, morte depuis `CRM-053`, mal nommée, et dont la réparation a coûté un
renommage gardé et la correction de deux migrations antérieures (§10.2, INC-215). La leçon est
appliquée ici : **aucune colonne sans lecteur**.

**Aucune colonne `is_active` ni `archived_at`.** Une séquence se **supprime** réellement, comme un
modèle (§2.2). L'état « armée / non armée » n'appartient pas à la séquence mais au lien entre une
séquence et une affaire, et ce lien est l'objet de 4b : le poser ici serait décider 4b sans l'avoir
spécifiée.

**Aucune unicité globale du nom.** L'unicité est **par workspace**, comme au §2.2 : deux workspaces
nomment leur cadence « Relance longue » sans se gêner.

### 11.4 `public.mail_sequence_steps` — le palier

| Colonne | Type | Nullable | Règle |
|---|---|---|---|
| `id` | `uuid` | non | `gen_random_uuid()` |
| `workspace_id` | `uuid` | non | → `workspaces (id) on delete cascade`, **et** cohérent avec celui de sa séquence par clé étrangère composite (§11.5 point n) |
| `sequence_id` | `uuid` | non | → `mail_sequences (id) on delete cascade` — supprimer une séquence emporte ses paliers, qui n'ont aucune existence sans elle |
| `position` | `integer` | non | 1 à 50 ; **unique par séquence**, contrainte `deferrable initially immediate` (§11.6) |
| `delai_jours` | `integer` | non | 1 à 365 |
| `template_id` | `uuid` | non | → `mail_templates (id)` **`on delete restrict`**, et cohérent en workspace par clé étrangère composite |
| `created_at` | `timestamptz` | non | `now()` |
| `updated_at` | `timestamptz` | non | `now()`, tenu par `app.set_updated_at()` |

#### Le délai se compte depuis le palier PRÉCÉDENT, et le premier depuis l'armement

C'est la décision de forme de la sous-tranche, et l'alternative était un décalage **absolu** depuis
l'armement. Le délai relatif est retenu pour une raison vérifiable : **insérer un palier au milieu
d'une cadence ne renumérote rien**. En absolu, glisser une relance entre J+3 et J+14 obligerait à
réécrire le décalage de tous les paliers suivants, et un oubli produirait deux envois le même jour
sans qu'aucune contrainte ne le voie. En relatif, le palier inséré porte son propre délai et les
suivants gardent le leur.

Le décalage absolu reste **dérivable** — c'est la somme des délais des paliers de position
inférieure ou égale — et 4b le calculera au moment où il en aura besoin. L'inverse n'est pas vrai :
d'un décalage absolu, on ne retrouve le délai relatif qu'en supposant qu'aucun palier ne manque.

**La borne basse est `1`, et non `0`.** Un palier de délai nul partirait à l'instant même de
l'armement, ou en même temps que le palier qui le précède : ce n'est pas une cadence, c'est un
doublon. Une séquence commence donc au plus tôt le lendemain de son armement. La borne haute de 365
tient la même place que les 20 000 caractères du §2.2 : au-delà d'un an, on n'écrit plus une
cadence de relance.

#### La clé étrangère du modèle est `on delete restrict`, et le §2.2 l'avait annoncée

Le §2.2 l'a écrite quatre tranches à l'avance, pour que celle-ci ne la découvre pas :

> « La tranche 4, qui fera référencer un modèle par un palier de séquence, posera cette clé
> étrangère en `on delete restrict` — un modèle employé par une séquence ne se supprimera plus, et
> le refus sera nommé. »

Elle est posée telle quelle. Le refus rend `23503` en base (§11.5 point k), et l'écran de la
sous-tranche 2b devra le dire : sa confirmation de suppression annonce aujourd'hui une suppression
inconditionnelle (§9.7), ce qui **deviendra faux** à l'application de cette migration. C'est un
travail de 4c, et il est nommé au §11.12 plutôt que tu.

**Un même modèle peut servir PLUSIEURS paliers**, et la clé étrangère n'est donc pas unique : une
cadence qui répète le même texte à J+3 et à J+14 est un usage courant, et le seed le démontre
(§11.8).

### 11.5 Ce que la base refuse, ligne à ligne

| # | Écriture | Issue attendue |
|---|---|---|
| a | `mail_sequences.name` vide ou fait de blancs | refusée, `mail_sequences_name_borne` (`23514`) |
| b | `name` de 121 caractères | refusée, même contrainte |
| c | `name` déjà pris dans le workspace, aux blancs de bord près | refusée, `mail_sequences_workspace_name_key` (`23505`) |
| d | `name` identique dans un AUTRE workspace | acceptée : l'unicité est par workspace |
| e | `position` valant `0`, `-1` ou `51` | refusée, `mail_sequence_steps_position_borne` (`23514`) |
| f | `position` déjà prise dans la même séquence | refusée, `mail_sequence_steps_sequence_position_key` (`23505`) |
| g | même `position` dans une AUTRE séquence | acceptée : l'unicité est par séquence |
| h | échange de deux positions **en un seul `update`** | **acceptée** — la contrainte est `deferrable initially immediate`, donc vérifiée en fin d'instruction (§11.6) |
| i | `delai_jours` valant `0`, `-1` ou `366` | refusée, `mail_sequence_steps_delai_borne` (`23514`) |
| j | `template_id` inexistant | refusée, `23503` |
| k | suppression d'un `mail_templates` employé par un palier | refusée, `23503`, `mail_sequence_steps_template_id_fkey` — c'est le `on delete restrict` du §2.2 |
| l | suppression d'un `mail_templates` employé par AUCUN palier | acceptée : le `restrict` ne protège que ce qui est employé |
| m | suppression d'une `mail_sequences` portant des paliers | acceptée, et ses paliers disparaissent avec elle (`on delete cascade`) |
| n | palier dont le `template_id` appartient à un AUTRE workspace que sa séquence | refusée, `23503`, clé étrangère **composite** — jamais par une politique |
| o | palier dont le `workspace_id` diverge de celui de sa séquence | refusée, `23503`, clé étrangère composite |
| p | `workspace_id` d'un workspace dont l'appelant n'est pas membre | refusée par la **RLS**, jamais par une contrainte |

**Les points n et o sont la seule notion nouvelle de cette sous-tranche, et ils sont tenus par une
clé étrangère plutôt que par une politique.** Un palier porte `workspace_id` parce que ses
politiques RLS le lisent sans jointure — c'est le patron de `card_contacts` et de `goal_blocks`. Une
colonne dénormalisée peut diverger de sa source ; la faire diverger *silencieusement* rendrait le
cloisonnement faux là où il compte. Les deux clés composites l'interdisent en base :

```
(sequence_id, workspace_id) references public.mail_sequences (id, workspace_id)
(template_id, workspace_id) references public.mail_templates (id, workspace_id)
```

Chacune exige un index unique sur `(id, workspace_id)` de la table cible. `mail_sequences` le pose
elle-même ; `mail_templates` **ne l'a pas** — MESURÉ le 2026-08-25, ses seuls index uniques sont
`mail_templates_pkey` et `mail_templates_workspace_name_key`. La migration l'ajoute donc, et c'est
un ajout **additif** : il ne refuse aucune écriture que la clé primaire n'interdisait déjà.

C'est exactement le patron `workflow_steps_id_workflow_id_key`, posé pour la même raison par
`CRM-031`, et il est repris plutôt que réinventé.

### 11.6 LA POSITION EST `DEFERRABLE`, ET UNE MESURE L'IMPOSE

Réordonner des paliers, c'est **échanger deux positions**. L'opération passe nécessairement par un
état transitoire où deux lignes portent la même position, ou par une position intermédiaire
inventée. **MESURÉ le 2026-08-25** sur la pile, sur deux tables sondes portant deux lignes en
positions 1 et 2 :

| Sonde | Contrainte | Geste | Résultat mesuré |
|---|---|---|---|
| C | `unique` simple | `update … set pos = 3 - pos` — **un seul `update`** | **`23505`** |
| D | `unique` simple | deux `update` séparés dans une transaction | **`23505`** |
| B1 | `unique … deferrable initially immediate` | `update … set pos = 3 - pos` — un seul `update` | **accepté** |
| E | `unique … deferrable initially immediate` + `set constraints … deferred` | deux `update` séparés | **accepté** |

La ligne C est celle qui décide. Avec une contrainte simple, **même l'échange atomique est refusé** :
PostgreSQL vérifie un index unique ligne à ligne, et la première ligne réécrite entre en collision
avec la seconde, encore intacte. `deferrable initially immediate` reporte la vérification à la **fin
de l'instruction**, si bien que l'échange en un `update` passe **sans qu'aucun appelant n'ait à
demander quoi que ce soit** — donc y compris par un `PATCH` PostgREST, qui n'a pas de moyen d'émettre
`set constraints`.

La contrainte reste `initially immediate` et non `initially deferred` : hors réordonnancement, un
doublon doit être refusé à l'instruction qui le crée, et non à la validation d'une transaction dont
l'appelant ne saura plus quelle écriture a fauté.

**Ce qui n'est PAS acquis, et qui est nommé plutôt que tu** : un réordonnancement qui ne serait pas
exprimable en une seule instruction — insérer un palier au milieu, par exemple — exige toujours une
transaction et un `set constraints … deferred`, donc une RPC. 4a n'en livre aucune : elle livre la
contrainte qui la rend possible.

### 11.6 bis CE QUE LA ROUTE NE SAIT PAS FAIRE — mesuré, et 4c en hérite

Le §11.6 établit qu'un échange **atomique** passe : `update … set position = 3 - position` est une
seule instruction, et la vérification différée en fin d'instruction le laisse passer. La suite pgTAP
le prouve, et elle relit la position échangée pour qu'un `no-op` ne passe pas pour un succès.

**Ce que la mesure a trouvé le 2026-08-25, en écrivant la preuve d'API : cette instruction n'est pas
exprimable par PostgREST.** Un `PATCH` ne pose que des valeurs **littérales** — il n'y a pas de
syntaxe pour `position = 3 - position`. La ligne 15 du §11.8, écrite avant la mesure, annonçait donc
un geste qu'aucun client REST ne peut émettre.

Les deux détours qu'un client tenterait sont **fermés**, et c'est ce que la ligne 15 mesure
désormais :

| Détour | Mesuré |
|---|---|
| poser une position **tampon** hors bornes — `0` —, puis échanger | `400`, `23514`, `mail_sequence_steps_position_borne` |
| poser directement la position de l'autre palier | `409`, `23505` — la contrainte est `initially immediate` |

**La conséquence appartient à 4c, et elle est nommée ici plutôt que laissée à découvrir** :
réordonner des paliers depuis un écran exige une **RPC** qui ouvre une transaction, émet
`set constraints … deferred` et repose les positions. La contrainte différée reste le préalable qui
la rend possible ; sans elle, même la RPC échouerait. 4a livre le préalable, 4c livre la RPC.

**Ce n'est pas un défaut du produit, et rien n'est masqué** : aucune écriture n'est acceptée qui
laisserait deux paliers sur la même position, et le refus est le même par toutes les portes.

### 11.7 Autorisations

Aucune notion nouvelle. Le patron est **exactement** celui de `mail_templates` (§2.6), et la raison
est la même : une séquence est un objet éditorial collectif du workspace.

| Action | Qui | Fonction |
|---|---|---|
| lecture | tout membre du workspace | `app.is_workspace_member(workspace_id)` |
| insertion | `admin` et `business_developer` | `app.workspace_role(workspace_id) in ('admin','business_developer')` |
| modification | idem | idem, en `using` **et** en `with check` |
| suppression | idem | idem |

Les **deux** tables portent les **quatre** politiques, sans exception : un palier modifiable par qui
ne peut pas modifier sa séquence serait un contournement, la cadence vivant dans les paliers.

**La lectrice lit et n'écrit pas**, et le refus se mesure comme `docs/SPEC-permissions-rls.md` §7
l'exige : **zéro ligne**, jamais une erreur, pour un `PATCH` ou un `DELETE` que la politique ne
consent pas ; `401` pour l'anonyme, refusé par le **privilège** avant toute politique.

**Le point de sûreté des migrations 48 à 58 s'applique** : la plateforme porte des
`alter default privileges … to anon`, si bien qu'un `revoke … from public` ne retire rien à un rôle
**nommé**. La migration révoque donc nommément puis attribue action par action.

### 11.8 Contrat d'API — `/rest/v1/mail_sequences` et `/rest/v1/mail_sequence_steps`

Mesuré avec les jetons réels des trois profils du seed. `admin` = Camille Aubert,
`business_developer` = Driss Lemoine, `viewer` = Farida Nowak.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| 1 | anonyme | `GET /mail_sequences` | **`200` et `[]`** — un filtrage, jamais une erreur |
| 2 | anonyme | `POST /mail_sequences` | `401`, code PostgreSQL `42501`, refusé par le **privilège** |
| 3 | anonyme | `GET /mail_sequence_steps` | **`200` et `[]`** |
| 4 | `viewer` | `GET /mail_sequences` | `200`, la séquence du seed |
| 5 | `viewer` | `GET /mail_sequence_steps` | `200`, ses trois paliers |
| 6 | `business_developer` | `GET` des deux | `200`, les mêmes |
| 7 | `viewer` | `POST /mail_sequences` | `403`, `42501` |
| 8 | `viewer` | `PATCH` d'un palier existant | `200` et **`[]`** — zéro ligne, le palier relu **inchangé** |
| 9 | `viewer` | `DELETE` d'un palier existant | `204` et le palier **toujours là** |
| 10 | `business_developer` | `POST /mail_sequences` valide | `201`, ligne relue |
| 11 | `business_developer` | `POST` d'un `name` déjà pris | `409`, `23505` |
| 12 | `business_developer` | `POST /mail_sequence_steps` valide | `201`, ligne relue |
| 13 | `business_developer` | `POST` d'un palier de `position` déjà prise | `409`, `23505` |
| 14 | `business_developer` | `POST` d'un palier de `delai_jours` valant `0` | `400`, `23514` |
| 15 | `business_developer` | `PATCH` posant une position tampon hors bornes, puis `PATCH` créant un doublon direct | `400` / `23514`, puis `409` / `23505` — **aucun détour client ne contourne la contrainte** (§11.6 bis) |
| 16 | `admin` | `DELETE` d'un `mail_templates` employé par un palier | `409`, `23503` — le `restrict` du §2.2 |
| 17 | `admin` | `POST` d'un palier dont le `template_id` est d'un autre workspace | `409`, `23503`, clé composite |
| 18 | `admin` | `DELETE` de la séquence qu'il a créée | `204`, et ses paliers **partis avec elle** |

**Le point 15 a été RÉVISÉ PAR LA MESURE, et son écriture d'origine était FAUSSE.** Elle annonçait
« `PATCH` échangeant deux positions en une requête ⇒ `200` ». Le §11.6 bis dit ce que la mesure a
trouvé et ce que la révision coûte à 4c.

**Le point 16 rend `409` et non `400`** parce que PostgREST classe `23503` en conflit. La ligne est
mesurée plutôt que déduite, et son code est celui que l'écran de 4c devra reconnaître.

### 11.9 Le seed

Le seed pose **une** séquence dans le workspace de démonstration, « **Relance en trois temps** »,
portant **trois** paliers :

| Position | Délai | Modèle |
|---|---|---|
| 1 | 3 jours | « Relance sans réponse » |
| 2 | 7 jours | « Prise de contact » |
| 3 | 14 jours | « Relance sans réponse » |

**Trois paliers, et trois sont nécessaires** — deux ne suffiraient pas :

1. le palier 3 **réemploie** le modèle du palier 1 : c'est le seul jeu qui démontre qu'un modèle
   sert plusieurs paliers, et qu'aucune unicité n'est posée sur `template_id` (§11.4) ;
2. les trois délais sont **distincts et croissants** : un jeu à délais égaux laisserait passer une
   contrainte qui les confondrait ;
3. trois positions donnent un **échange** à prouver — le point 15 du contrat d'API échange les
   positions 1 et 2 et les remet en place, ce que deux paliers rendraient indiscernable d'une
   permutation triviale.

La séquence et ses paliers sont créés **par l'API REST avec le jeton réel de l'administratrice**,
jamais par un `INSERT` direct ni par la clé de service : `CLAUDE.md` §8 exige que les données de
démonstration empruntent le chemin du produit, et ce chemin-ci **exerce au passage** la politique
d'insertion du §11.7 — un seed qui passerait par `service_role` serait vert même si la politique
était cassée.

Une **garde de convergence** compare les comptes à `1` et `3` et échoue si un rejeu duplique, comme
celle des modèles (§2.8). Une **seconde garde** vérifie ce que le jeu doit démontrer : que le modèle
du palier 1 est bien celui du palier 3. Un jeu qui perdrait cette égalité ne prouverait plus rien du
point 1 ci-dessus.

### 11.10 Preuves exigées — sous-tranche 4a

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0057_sequences_relance.test.sql` : la forme des deux tables dans le catalogue, leurs contraintes **nommées**, le caractère `deferrable` de la contrainte de position lu dans `pg_constraint.condeferrable`, l'ACL rôle par rôle, les seize lignes du §11.5, et **un témoin avant chaque refus** — un refus vert sur une absence ne prouve rien |
| API | `e2e/api/sequences-relance.spec.ts` : les dix-huit lignes du §11.8 avec les jetons réels, chaque refus **relisant la ligne** pour la constater inchangée (décision 70), et le seed constaté **intact** en fin de suite |
| Unitaire | aucune logique TypeScript n'est livrée par cette sous-tranche : les règles vivent en SQL et sont éprouvées par pgTAP, qui est leur niveau. L'écart est **nommé** plutôt que compensé par un test unitaire de façade |
| Harnais | `scripts/verify-sequences-relance.sh` : verdict unique, non complaisant, ses dégradations réelles et la restauration **constatée octet à octet** contre un instantané pris avant la première, jamais contre `HEAD` |
| Seed | `supabase/seed/apply-seed.sh`, avec ses deux gardes |
| E2E interface | **aucun** : cette sous-tranche ne livre aucun écran. L'écart est nommé, et l'écran est 4c |

### 11.11 Definition of Done — sous-tranche 4a

- migration `0059_sequences_relance.sql` appliquée et **rejouable** : les deux tables, leurs
  contraintes, l'index composite ajouté à `mail_templates`, la RLS, les privilèges ;
- suite pgTAP dédiée verte ;
- contrat d'API du §11.8 vert avec les jetons réels des trois profils ;
- seed enrichi et **convergent**, ses deux gardes vertes ;
- harnais dédié vert, ses dégradations vues ;
- `docs/SCHEMA.md` §7, `docs/PROD_MIGRATIONS.md`, `docs/SPEC-seed.md` et `CHANGELOG.md` mis à jour
  **dans le même changement** ;
- compteurs de `scripts/verify-harness.sh` révisés **par comptage**, jamais par estimation ;
- commentaires `@spec` / `@verifies` sur chaque fichier ;
- commit poussé sur `origin/main`.

### 11.12 Cadrage de 4b et 4c — à spécifier avant d'être écrites

**4b — l'armement et l'exécution.** Elle répond aux trois questions du §7.3, qu'elle devra trancher
**chacune par une mesure** :

- **qui arme une séquence**, et sur quoi : une affaire figée au sens de `public.cards_figees()`, un
  geste humain, ou le job quotidien de `CRM-062` tranche 2 ; quelle identité sortante expédie, la
  séquence n'en portant aucune (§11.2) ;
- **ce qui l'interrompt** : un déplacement d'étape — qui réarme déjà la relance de `CRM-062`
  (`docs/SPEC-relances.md` §9.4) —, une mise en sommeil, un archivage, un geste explicite ;
- **ce qu'une réponse du destinataire produit** : `mail_messages` porte `direction`, `card_id` et
  `sent_at`, donc la donnée existe ; reste à dire si une réponse suspend, termine ou n'affecte pas
  la séquence.

Elle devra aussi dire **comment un palier met un message en file**. Le chemin d'aujourd'hui,
`public.queue_outbound_email`, exige `auth.uid()` non nul et le refuse en `42501` sans jeton
(migration 58) : un job `pg_cron` ne peut donc pas l'emprunter tel quel. C'est une **mesure**, pas
une supposition, et elle est écrite ici pour que 4b ne la redécouvre pas.

**4c — l'écran.** Administration des séquences, et armement depuis l'affaire. Elle devra aussi
**réviser la confirmation de suppression d'un modèle** : le §9.7 annonce aujourd'hui une suppression
inconditionnelle, ce que le `on delete restrict` du §11.4 rend faux dès l'application de la
migration `0059`. L'écart est nommé ici, et il appartient à 4c.

---

## 12. Sous-tranche 4b — l'armement et l'exécution

Écrite le 2026-08-25 **après mesure sur la pile debout et seedée**, et **avant la première ligne de
code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2). Elle développe le cadrage du §11.12, qu'elle ne
remplace pas.

La sous-tranche 4a a livré la **cadence** — une séquence et ses paliers, un objet éditorial que
personne n'applique encore. Ce chapitre livre l'**application** : le lien entre une affaire et une
cadence, le job qui fait partir les messages, et les cinq façons dont ce lien se termine.

### 12.1 Les quatre questions, et la mesure qui tranche chacune

Le §7.3 en posait trois ; le §11.12 en a ajouté une quatrième. Aucune n'est tranchée par
raisonnement seul — chacune l'est par une sonde exécutée sur la pile du 2026-08-25.

| # | Question | Réponse | La mesure qui l'impose |
|---|---|---|---|
| 1 | Qui arme une séquence ? | Un **geste humain**, portant l'identité expéditrice | Le workspace de démonstration porte **DEUX** identités sortantes, et la séquence n'en porte aucune (§11.2) : aucun job ne peut choisir entre elles sans inventer une règle |
| 2 | Qu'est-ce qui l'interrompt ? | Le fait que l'affaire **sorte de `public.cards_figees()`**, plus le geste explicite, la réponse, et l'épuisement | Les trois exclusions de `cards_figees()` (archivée, corbeille, sommeil) et la remise à zéro d'`entered_step_at` par `move_card` couvrent **quatre** interruptions par **un seul** prédicat déjà livré |
| 3 | Que produit une réponse ? | Elle **TERMINE** l'inscription, et l'ancre est `created_at` | `sent_at` est **NULL sur les quatre messages du seed** (mesuré) : la date d'en-tête ne peut pas ancrer « après l'armement » |
| 4 | Comment un palier met-il un message en file ? | Par `app.mail_outbox_inserer`, **extraite** de `queue_outbound_email` | `public.queue_outbound_email` sous `postgres` rend `42501 / not_authenticated` (sonde ci-dessous) : le job ne peut pas l'emprunter |

**Sonde de la question 4, exécutée le 2026-08-25 dans `psql` sous `postgres`, contexte exact d'un
job `pg_cron`** :

```
select coalesce(auth.uid()::text, 'NULL');   =>  NULL
perform public.queue_outbound_email(…);      =>  SONDE: REFUS 42501 / not_authenticated
```

**Sonde de la question 3, même session** — les quatre messages du seed, colonne par colonne :

```
inbound | sent_at=NULL | created_at=2026-08-25 20:14:05.723696+00 | card=5eed…00c1
inbound | sent_at=NULL | created_at=2026-08-25 20:14:05.803094+00 | card=NULL
inbound | sent_at=NULL | created_at=2026-08-25 20:14:05.819942+00 | card=5eed…00c1
inbound | sent_at=NULL | created_at=2026-08-25 20:14:05.868892+00 | card=NULL
```

Le §11.12 annonçait « `mail_messages` porte `direction`, `card_id` et `sent_at`, donc la donnée
existe ». **La donnée existe, mais pas dans cette colonne-là** : `sent_at` est la date que l'en-tête
du message déclare, et l'ingestion ne la renseigne pas. `created_at` est l'instant où le produit a
VU le message, il est `not null`, et c'est lui qui ancre la comparaison. Une ligne de cadrage
trouvée fausse par la mesure se **révise en disant pourquoi**, jamais ne se contourne — c'est la
règle déjà appliquée au §11.6 bis.

### 12.2 QUI ARME — un geste humain, et pourquoi aucun job ne peut le poser

Armer une séquence, c'est choisir **deux** choses : quelle cadence, et **de quelle adresse** les
messages partent. La séquence ne porte aucune identité, et le §11.2 dit pourquoi — « deux personnes
appliquant la même séquence à deux affaires signent chacune de leur adresse ».

**MESURÉ** : le workspace de démonstration porte deux identités sortantes — « Identité de service »,
sans propriétaire, et « Envoi de Driss Lemoine ». Un job qui armerait tout seul devrait choisir
entre elles, et toute règle qu'il appliquerait — « la première », « celle du responsable de
l'affaire », « celle de service » — serait la **valeur par défaut trompeuse** que `CLAUDE.md` §18
proscrit. L'armement est donc un **geste**, et l'identité choisie est **stockée sur l'inscription**.

**L'affaire doit être FIGÉE à l'instant de l'armement**, au sens de `public.cards_figees()` et
d'aucun autre : c'est ce que le §7.3 dit — « appliqués à une affaire figée au sens de
`docs/SPEC-relances.md` §2 » — et le §11.2 a déjà refusé qu'une séquence porte son propre seuil.
`public.cards_figees()` rend **4** affaires sur le seed (mesuré sous `postgres`, donc l'ensemble
global) ; l'appelant, lui, n'en voit que celles que ses droits lui rendent, la fonction étant
`SECURITY INVOKER` (§3.2 de `docs/SPEC-relances.md`).

**Une affaire ne porte qu'UNE inscription active à la fois**, et c'est un index unique **partiel**,
pas une garde applicative. Deux cadences armées sur la même affaire enverraient deux messages le
même jour sans qu'aucune contrainte ne le voie — exactement le défaut que le délai relatif du §11.4
existe pour empêcher à l'intérieur d'une cadence.

### 12.3 `public.card_sequence_enrollments` — l'inscription

Le nom n'est pas choisi ici : `docs/SCHEMA.md` §7 l'annonce depuis `CRM-000`, avec sa définition en
une ligne — « inscription d'une card à une cadence, **arrêtée dès qu'une réponse arrive** ». La
sous-tranche livre ce que le schéma promettait, et la question 3 ne fait que confirmer par la mesure
ce que cette ligne disait déjà.

| Colonne | Type | Nullable | Règle |
|---|---|---|---|
| `id` | `uuid` | non | `gen_random_uuid()` |
| `workspace_id` | `uuid` | non | → `workspaces (id) on delete cascade`, **et** cohérent avec ceux de la card et de la séquence par clés étrangères composites |
| `card_id` | `uuid` | non | → `cards (id) on delete cascade` — une affaire supprimée n'a plus d'inscription |
| `sequence_id` | `uuid` | non | → `mail_sequences (id)` **`on delete restrict`** |
| `identity_id` | `uuid` | non | → `mail_outbound_identities (id)` **`on delete restrict`** |
| `armed_by` | `uuid` | oui | → `profiles (id) on delete set null`. **Trace, jamais un droit**, même règle qu'au §2.2 |
| `armed_at` | `timestamptz` | non | `now()`. **Ancre du premier palier** (§12.5) et borne de la détection de réponse (§12.6) |
| `last_position` | `integer` | oui | position du **dernier palier expédié**. `null` = aucun encore |
| `last_sent_at` | `timestamptz` | oui | instant de cette mise en file. **Ancre du palier suivant** (§12.5) |
| `status` | `text` | non | `active` ou `closed`. Deux valeurs, et le §12.7 dit pourquoi il n'y en a pas trois |
| `closed_reason` | `text` | oui | `reply`, `card_ineligible`, `manual`, `exhausted` — les **quatre** fins du §12.7. Non nul si et seulement si `status = 'closed'` |
| `closed_at` | `timestamptz` | oui | non nul si et seulement si `status = 'closed'` |
| `created_at` | `timestamptz` | non | `now()` |
| `updated_at` | `timestamptz` | non | `now()`, tenu par `app.set_updated_at()` |

**`sequence_id` et `identity_id` sont `on delete restrict`, et `card_id` est `on delete cascade`.**
L'asymétrie est voulue : une affaire supprimée emporte tout ce qui la décrit, mais supprimer une
cadence ou une adresse **pendant qu'elle relance** laisserait une inscription qui ne sait plus quoi
envoyer ni d'où. Le refus rend `23503`, que PostgREST classe en **409** — mesuré par 4a sur le
`on delete restrict` du modèle.

**`last_position` et `last_sent_at` sont nulles ensemble ou renseignées ensemble**, et une
contrainte le dit. Une inscription qui porterait une position sans son instant ne saurait pas quand
le palier suivant est dû ; l'inverse ne saurait pas lequel.

**Aucune colonne `next_due_at`.** Elle serait la **seconde source de vérité** que le §9.4 de
`docs/SPEC-relances.md` a déjà refusée : l'échéance se **dérive** de `last_sent_at` (ou d'`armed_at`)
et du `delai_jours` du palier suivant, et une colonne recopiée divergerait dès qu'un palier serait
modifié.

### 12.4 `public.armer_sequence_relance` — le geste, et ses huit refus

```
public.armer_sequence_relance(p_card_id uuid, p_sequence_id uuid, p_identity_id uuid) returns uuid
```

`security definer`, propriétaire `postgres`, `search_path` vide — `authenticated` ne détient aucun
`insert` sur la table (§12.8), exactement comme pour `mail_outbox`.

| # | Refus | `SQLSTATE` | Motif |
|---|---|---|---|
| a | `auth.uid()` nul | `42501` `not_authenticated` | Le geste est humain par construction (§12.2) |
| b | `app.can_write_card` faux | `42501` `forbidden` | Relancer au nom d'une affaire, c'est y ajouter du contenu : même exigence qu'au §19.4 de `docs/SPEC-mail-subsystem.md` |
| c | La séquence n'existe pas, ou n'est pas dans le workspace de la card | `23514` `sequence_not_available` | |
| d | La séquence ne porte **aucun palier** | `23514` `sequence_empty` | Une cadence vide n'enverrait jamais rien, et l'inscription serait un objet mort |
| e | L'identité n'est pas empruntable par l'appelant | `42501` `identity_not_available` | Règle reprise **telle quelle** de `queue_outbound_email` : la sienne, ou celle de service s'il est administrateur |
| f | La card n'est pas figée au sens de `public.cards_figees()` | `23514` `card_not_stalled` | §12.2 |
| g | La card n'a pas d'adresse (`email_local_part` nul) | `23514` `card_not_available` | Reprise de `queue_outbound_email` : une relance dont la réponse ne reviendrait nulle part est pire qu'un refus |
| h | Une inscription **active** existe déjà sur cette card | `23505` `enrollment_exists` | L'index unique partiel du §12.3, opposé **avant** l'insertion pour que le refus porte un nom |

Elle rend l'`id` de l'inscription créée.

**`public.interrompre_sequence_relance(p_enrollment_id uuid) returns void`** ferme une inscription
active avec `closed_reason = 'manual'`. Deux refus : `not_authenticated` (`42501`), et `forbidden`
(`42501`) si l'appelant ne peut pas écrire la card. Fermer une inscription **déjà fermée** ne lève
rien et n'écrit rien — l'idempotence est celle d'un geste que l'on peut poser deux fois sans le
savoir, et un second refus n'apprendrait rien à l'utilisateur.

### 12.5 QUAND UN PALIER EST DÛ — le délai relatif, appliqué

Le §11.4 a posé la règle : le délai se compte **depuis le palier précédent**, et le premier depuis
l'armement. Son application est une seule expression :

```
palier dû  ⇔  position = coalesce(last_position, 0) + 1
              et  now() >= coalesce(last_sent_at, armed_at) + delai_jours * interval '1 day'
```

**Un seul palier part par passage**, même si deux sont échus. Un job resté arrêté trois jours ne
doit pas déverser trois messages d'un coup chez le destinataire : ce serait le doublon que la borne
basse de `1` jour (§11.4) existe précisément pour empêcher. La cadence **glisse** — le palier
suivant se compte depuis l'envoi réel, pas depuis l'échéance théorique —, ce qui est la conséquence
directe du délai relatif et non une correction ajoutée.

**L'unité de compte est le jour au sens de `interval '1 day'`**, et non le `floor` sur 86 400
secondes du §2.5 de `docs/SPEC-relances.md`. Les deux ne mesurent pas la même chose : là-bas il
s'agit de compter des jours **révolus** pour les comparer à un seuil affiché par une pastille ;
ici, d'ajouter un délai à un instant. Ajouter `interval '1 day'` respecte les changements d'heure,
ce qu'une arithmétique en secondes ne fait pas.

### 12.6 CE QU'UNE RÉPONSE PRODUIT — elle TERMINE, et l'ancre est `created_at`

`docs/SCHEMA.md` §7 l'annonce depuis `CRM-000` : l'inscription est « arrêtée dès qu'une réponse
arrive ». La sous-tranche l'honore, et le motif tient en une phrase : **relancer quelqu'un qui vient
de répondre est le seul défaut qu'un système de relance ne doit jamais avoir.** Suspendre plutôt que
terminer supposerait de savoir quand reprendre, ce que rien dans le produit ne dit ; et « n'affecte
pas » ferait du produit un publipostage.

Une réponse est, précisément :

```sql
exists (
  select 1
    from public.mail_messages m
   where m.card_id    = e.card_id
     and m.direction  = 'inbound'
     and m.created_at >  e.armed_at
)
```

**L'ancre est `created_at` et NON `sent_at`, et c'est une MESURE qui l'impose** (§12.1) : `sent_at`
est nulle sur les quatre messages du seed. C'est la date que l'en-tête du message déclare, et rien
n'oblige un correspondant à la renseigner ni à la renseigner juste. `created_at` est l'instant où le
produit a vu le message ; il est `not null`, il est posé par la base, et il ne dépend d'aucun tiers.

**La borne est `armed_at` et non `last_sent_at`**, et c'est voulu : un message arrivé entre
l'armement et le premier palier est une réponse à la conversation, même si aucune relance n'est
encore partie. Prendre `last_sent_at` laisserait partir un premier palier chez quelqu'un qui avait
déjà répondu.

**Aucun trigger sur `mail_messages`.** La détection est **lue par le job**, au passage, comme
l'idempotence de `CRM-062` est lue et non stockée (§9.4). Un trigger ferait de l'ingestion IMAP —
chemin chaud, tenu par `mail-sync` — le porteur d'une règle de relance, et une panne de l'un
deviendrait une panne de l'autre.

### 12.7 LES QUATRE FINS, et pourquoi `status` ne porte que deux valeurs

| `closed_reason` | Ce qui l'a produite |
|---|---|
| `reply` | Un message entrant est arrivé sur l'affaire après l'armement (§12.6) |
| `card_ineligible` | L'affaire n'est plus rendue par `public.cards_figees()` |
| `manual` | `public.interrompre_sequence_relance` |
| `exhausted` | Le dernier palier de la séquence a été mis en file |

**`card_ineligible` couvre QUATRE interruptions par UN prédicat, et aucune n'est réécrite ici.** Le
§7.3 en nommait quatre — déplacement d'étape, sommeil, archivage, geste explicite — et les trois
premières tombent **gratuitement** :

- un **déplacement d'étape** repose `entered_step_at` à `now()` (`0012_move_card.sql`), donc
  `jours_dans_etape` retombe à zéro et l'affaire sort de `cards_figees()` ;
- une **mise en sommeil**, un **archivage** et une **mise en corbeille** sont les trois exclusions du
  §2.4 de `docs/SPEC-relances.md`, déjà portées par la fonction.

Réécrire ces prédicats ici aurait créé la **seconde définition de « figée »** que le §2.1 de
`docs/SPEC-relances.md` existe pour empêcher, et que le commentaire d'en-tête de la migration `0059`
nomme parmi ce que la tranche 4 « n'est pas ». Le job **appelle** `public.cards_figees()`, il ne la
recopie pas — c'est exactement ce que le §9.2 de `docs/SPEC-relances.md` a établi pour `CRM-062`.

**`status` ne porte que `active` et `closed`, et il n'y a pas de troisième valeur.** Une inscription
est en cours, ou elle est finie ; `closed_reason` dit **pourquoi**. Un `status = 'paused'`
supposerait un geste de reprise que le produit n'offre pas, et une valeur d'état qu'aucun chemin ne
quitte est la colonne sans lecteur que le §11.3 refuse.

**Une inscription fermée n'est jamais rouverte.** Réarmer, c'est armer de nouveau — une **nouvelle**
inscription, dont l'`armed_at` est neuf et dont la détection de réponse repart de cet instant. La
règle est celle de l'immuabilité de la timeline : on n'efface pas ce qui a eu lieu.

### 12.8 `app.mail_outbox_inserer` — la porte du job, EXTRAITE et non dupliquée

La question 4 est tranchée par la sonde du §12.1 : `public.queue_outbound_email` rend `42501` sous
`postgres`. Deux issues étaient possibles, et la seconde est retenue.

**Écartée — assouplir `queue_outbound_email`.** Rendre `auth.uid()` facultatif ouvrirait à `anon` un
chemin d'envoi que sept refus protègent. Le premier refus n'est pas une formalité : il est ce qui
garantit que tout message en file a un auteur ou un job identifié.

**Retenue — extraire la composition et l'insertion.** Le corps de l'`insert` de
`queue_outbound_email` devient :

```
app.mail_outbox_inserer(p_workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
                        p_to, p_cc, p_subject, p_body_text, p_signature, p_created_by) returns uuid
```

`security definer`, propriétaire `postgres`, `search_path` vide, privilèges **révoqués des quatre
rôles** — elle vit dans `app`, que PostgREST n'expose pas.

**`public.queue_outbound_email` l'appelle, et ses sept refus ne bougent pas.** Seules les cinq
lignes de l'`insert` se déplacent. Le motif est la règle que la tranche 3 a écrite et que le §10.3
porte : « ce qui est stocké est ce qui part ». Cette règle — le corps mis en file est le corps
**signé** par `app.mail_corps_signe` — doit avoir **UNE** définition. Écrire un second `insert` dans
le job aurait produit deux endroits où la signature s'ajoute, et le jour où l'un change, l'autre
enverrait autre chose sans que rien ne le dise. C'est la leçon que la migration `0059` a payée sur
les clés déclarées en ligne, transposée : **ce qui est écrit deux fois diverge une fois.**

**`p_created_by` est nul pour le job**, et cette nullité est **obtenue et non affectée** : la colonne
`mail_outbox.created_by` est nullable (mesuré), et le job passe `null` parce qu'une relance
automatique n'a pas d'auteur humain. C'est le §9.5 de `docs/SPEC-relances.md`, mot pour mot.

### 12.9 `app.executer_sequences_relance()` — le job

| Propriété | Valeur | Motif |
|---|---|---|
| Signature | `app.executer_sequences_relance() returns integer` | Rend le nombre de **messages réellement mis en file** — grandeur que le seed, la suite pgTAP et le harnais lisent au lieu de la déduire, comme `app.relancer_cards_figees()` (§9.3 de `docs/SPEC-relances.md`) |
| `security` | **definer**, propriétaire `postgres` | Aucun rôle ne détient `insert` sur `mail_outbox` (mesuré : `authenticated=r/postgres`) |
| `search_path` | `''` | Règle générale des fonctions `definer` du dépôt |
| Privilèges | `revoke execute` de `public`, `anon`, `authenticated`, `service_role` | Aucun client ne déclenche une relance : c'est un fait de l'horloge |
| Job | `p2enjoy-sequences-relance`, `postgres`/`postgres`, `select app.executer_sequences_relance();` | |
| Cadence d'amorçage | `10 seconds` | Démarrage observable du §3 de `docs/SPEC-scheduler.md` |
| Cadence nominale | `41 3 * * *` | Une fois par jour. La minute `41` évite le heartbeat (`7`) et les relances de `CRM-062` (`23`) |

**L'ordre du passage est FERMER D'ABORD, ENVOYER ENSUITE**, et il n'est pas indifférent :

1. **fermer** les inscriptions dont l'affaire est sortie de `cards_figees()` → `card_ineligible` ;
2. **fermer** celles qui ont reçu une réponse → `reply` ;
3. pour chaque inscription **encore** active dont le palier suivant est dû, composer par
   `public.rendre_modele_email` et mettre en file par `app.mail_outbox_inserer` ; avancer
   `last_position` et `last_sent_at` ;
4. **fermer** celles dont le palier expédié était le dernier → `exhausted` ;
5. promouvoir la cadence d'amorçage vers la cadence quotidienne, **dans la même transaction**.

Envoyer avant de fermer ferait partir une relance chez quelqu'un qui a répondu la veille : la
fermeture doit précéder, et c'est la seule raison de cet ordre.

**Le corps est composé par `public.rendre_modele_email`**, jamais recopié. Elle est `SECURITY
INVOKER` (mesuré, `prosecdef=false`) et `postgres` porte `rolbypassrls` : sous le job, elle rend
donc l'ensemble global, exactement comme `cards_figees()` (§9.2 de `docs/SPEC-relances.md`). Le
`p_identity_id` passé est celui de l'inscription, de sorte que les variables d'expéditeur du §8.5
soient celles de l'adresse qui expédie réellement.

**Un palier dont le rendu échoue ne bloque pas les autres**, et il ne se tait pas non plus :
l'inscription reste active, son `last_position` n'avance pas, et le passage suivant réessaie. Aucun
`try/catch` vide (`CLAUDE.md` §18) : ce qui échoue est ce que la base refuse, et le job échoue
**avec** lui — un `raise` avorte le passage entier et `cron.job_run_details` le porte, plutôt qu'une
relance à demi écrite.

**Aucune seizième valeur au vocabulaire du fil.** Mettre en file n'est pas envoyer : le `mail_sent`
de la timeline est écrit quand le worker a réellement expédié, et l'inscrire à la mise en file
dirait au lecteur qu'un message est parti alors qu'il attend encore. La quinzième valeur, `stalled`,
suffit à dire ce que le produit sait — l'affaire dort — et la relance qui en découle se lit dans la
boîte de l'affaire.

### 12.10 Autorisations

| Opération | Qui | Comment |
|---|---|---|
| `select` | Ceux qui peuvent **lire la card** | `app.can_read_card(card_id)`, patron des tables filles (§3.6 de `docs/SPEC-permissions-rls.md`) |
| `insert` | **Personne** directement | `public.armer_sequence_relance` est la seule porte |
| `update` | **Personne** directement | `public.interrompre_sequence_relance` et le job |
| `delete` | **Personne** | Une inscription est une trace ; on la ferme, on ne l'efface pas |

`authenticated` reçoit `select` seul ; `anon` ne reçoit rien. La fermeture des trois autres verbes
est celle de `mail_outbox`, et pour la même raison : une file d'envoi que le client écrirait
lui-même n'aurait plus aucun refus.

### 12.11 Contrat d'API — les routes et les RPC

| # | Appel | Profil | Issue attendue |
|---|---|---|---|
| 1 | `GET /rest/v1/card_sequence_enrollments` | administratrice | `200`, les inscriptions des cards qu'elle lit |
| 2 | `GET` idem | `viewer` fermé sur « Grands comptes » | `200`, **aucune** inscription d'une card de ce track |
| 3 | `GET` idem | `anon` | `200` et **zéro ligne** — le refus est zéro ligne (§7 de `docs/SPEC-permissions-rls.md`) |
| 4 | `POST /rest/v1/card_sequence_enrollments` | administratrice | **`401`/`403`** — aucun `insert` n'est accordé |
| 5 | `PATCH /rest/v1/card_sequence_enrollments?id=eq.…` | administratrice | **`401`/`403`** — aucun `update` |
| 6 | `DELETE` idem | administratrice | **`401`/`403`** — aucun `delete` |
| 7 | `POST /rest/v1/rpc/armer_sequence_relance` — card figée, séquence et identité valides | administratrice | `200`, un `uuid` |
| 8 | Le même, **répété** sur la même card | administratrice | `409` — `23505`, refus `h` du §12.4 |
| 9 | `armer_sequence_relance` sur une card **non figée** | administratrice | `400` — `23514`, refus `f` |
| 10 | `armer_sequence_relance` avec l'identité **d'un autre** | Driss | `403` — `42501`, refus `e` |
| 11 | `armer_sequence_relance` sur une card qu'il ne peut pas écrire | `viewer` | `403` — `42501`, refus `b` |
| 12 | `armer_sequence_relance` sans jeton | `anon` | `401` — `42501`, refus `a` |
| 13 | `POST /rest/v1/rpc/interrompre_sequence_relance` sur son inscription | administratrice | `204`, l'inscription relue porte `status='closed'` et `closed_reason='manual'` |
| 14 | Le même, **répété** | administratrice | `204` — idempotent, et la ligne relue est **inchangée** |
| 15 | `interrompre_sequence_relance` sans jeton | `anon` | `401` — `42501` |
| 16 | `DELETE /rest/v1/mail_sequences?id=eq.…` d'une séquence **armée** | administratrice | `409` — `23503`, le `on delete restrict` du §12.3 vu par la route |
| 17 | Le seed constaté **intact** en fin de suite | — | une séquence, trois paliers, aucune inscription résiduelle |

Chaque refus **relit la ligne** pour la constater inchangée (décision 70).

### 12.12 Le seed

Le seed **n'arme aucune inscription**, et c'est une décision plutôt qu'un oubli.

Une inscription armée sur le jeu de démonstration serait exécutée par le job dès le premier passage
— dix secondes après le démarrage de la pile, par la cadence d'amorçage du §12.9 —, et **quatre
messages de relance partiraient réellement** chez les adresses du seed. C'est précisément la
pollution que la tranche 3 a payée pour apprendre (décision 516 : « le contrat d'API ne retirait pas
sa ligne de file, et six scénarios d'interface rougissaient »). Le jeu de démonstration doit
**montrer**, pas **expédier**.

L'armement est donc exercé par les **preuves**, qui arment, mesurent et referment dans un `finally`,
patron d'`e2e/api/envoi.spec.ts`. Une **garde** du seed vérifie qu'aucune inscription ne subsiste
après son application : un jeu qui en laisserait une ferait partir des messages à chaque démarrage.

L'écart est **nommé** : `docs/BACKLOG.md` le porte, et 4c — qui livre l'écran d'armement — décidera
si une inscription de démonstration devient montrable sans être expédiée.

### 12.13 Preuves exigées — sous-tranche 4b

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0058_armement_sequences.test.sql` : la forme de la table et sa RLS, les contraintes **nommées**, l'ACL rôle par rôle, les huit refus du §12.4 **chacun précédé de son témoin**, l'échéance du §12.5 éprouvée sur une inscription antidatée, les quatre fins du §12.7 chacune **produite** et non simulée, et le fait que `app.mail_outbox_inserer` est bien la seule ligne d'`insert` — `queue_outbound_email` et le job mettant en file le **même** corps signé |
| API | `e2e/api/armement-sequences.spec.ts` : les dix-sept lignes du §12.11 avec les jetons réels, chaque refus relisant la ligne, et **toute inscription armée refermée dans un `finally`** |
| Unitaire | aucune logique TypeScript n'est livrée : les règles vivent en SQL et sont éprouvées par pgTAP, qui est leur niveau. L'écart est **nommé** plutôt que compensé par un test de façade |
| Harnais | `scripts/verify-armement-sequences.sh` : verdict unique, non complaisant, ses dégradations réelles et la restauration **constatée octet à octet** |
| Seed | la garde du §12.12 — **aucune** inscription résiduelle |
| E2E interface | **aucun** : cette sous-tranche ne livre aucun écran. L'écart est nommé, et l'écran est 4c |

### 12.14 Definition of Done — sous-tranche 4b

- migration `0060_armement_sequences.sql` appliquée et **rejouable** : la table, ses contraintes,
  l'index unique partiel, la RLS, les privilèges, les deux RPC, `app.mail_outbox_inserer`,
  `app.executer_sequences_relance()` et son job ;
- `public.queue_outbound_email` **révisée** pour appeler la porte extraite, ses sept refus intacts ;
- suite pgTAP dédiée verte ;
- contrat d'API du §12.11 vert avec les jetons réels des trois profils ;
- garde du seed verte ;
- harnais dédié vert, ses dégradations vues ;
- `docs/SCHEMA.md` §7, `docs/PROD_MIGRATIONS.md`, `docs/SPEC-relances.md` et `CHANGELOG.md` mis à
  jour **dans le même changement** ;
- compteurs de `scripts/verify-harness.sh` révisés **par comptage**, jamais par estimation ;
- commentaires `@spec` / `@verifies` sur chaque fichier ;
- commit poussé sur `origin/main`.

### 12.15 Ce que 4b ne fait PAS, et qui n'est pas masqué

1. **Aucun écran.** Armer se fait aujourd'hui par la RPC, donc par les preuves. L'écran est 4c.
2. **Aucune reprise d'une inscription fermée** (§12.7). Réarmer, c'est armer de nouveau.
3. **Aucun rattrapage des paliers échus** (§12.5) : un seul palier par passage.
4. **Aucune révision de la confirmation de suppression d'un modèle** — le §9.7 reste faux depuis la
   migration `0059`, et c'est nommément le travail de 4c (§11.12).

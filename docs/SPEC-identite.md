# Spécification — Identités lisibles et memberships sûrs

Unité de backlog : `CRM-022`.
Documents liés : `docs/SCHEMA.md` §1, `docs/SPEC-permissions-rls.md` §2, §4 et §7,
`docs/SPEC-cards.md` §7, §12, §13 et §14, `docs/DESIGN_SYSTEM.md` §5,
`docs/SPEC-seed.md` §2, `docs/JOURNAL.md` décisions 294 et 307,
`docs/INCONSISTENCY_REPORT.md` INC-014.

Cette spécification ferme le contrat avant le code. `CRM-022` rend l'identité nécessaire aux
écrans déjà livrés sans ouvrir l'administration complète des comptes : invitation, acceptation et
écran de gestion restent la propriété de `CRM-070`.

---

## 1. État mesuré avant l'unité

Mesuré le 2026-08-09 sur la pile seedée :

- `profiles`, `workspaces` et `workspace_members` portent chacune **zéro politique** ;
- le vrai jeton de l'administratrice reçoit `200` et `[]` sur les trois tables ;
- les privilèges de table autorisent pourtant `authenticated` à mettre à jour toutes les colonnes
  de `profiles`, et à insérer, modifier ou supprimer dans les deux autres tables : la RLS seule
  neutralise ces droits trop larges ;
- les trois profils portent les noms Camille Aubert, Driss Lemoine et Farida Nowak, mais
  `avatar_url` vaut `null` pour chacun ;
- `card_comments.author_id` est non nul et sa clé étrangère n'a aucune action de suppression :
  supprimer un compte qui a parlé est donc refusé par `23503`, contrairement aux sept autres clés
  vers `profiles` qui détachent ou cascadent déjà leur donnée.

Une preuve qui constaterait seulement que l'administratrice voit ses propres données serait trop
faible : les mêmes règles doivent distinguer un collègue du même workspace, un utilisateur d'un
autre workspace, l'anonyme et la clé de service.

## 2. Frontière de l'unité

`CRM-022` livre ensemble :

1. les politiques et privilèges effectifs de `profiles`, `workspaces` et `workspace_members` ;
2. l'invariant qui empêche toute mutation de membership de laisser son workspace parent sans
   administrateur, même lorsque l'admin retiré était l'unique membre ;
3. la suppression d'un profil sans destruction des paroles ni des faits historiques ;
4. les avatars locaux et convergents des trois profils de démonstration ;
5. l'affichage des identités dans les écrans qui les avaient explicitement retirées à cause
   d'INC-014 ;
6. les preuves pgTAP, API et navigateur avec les vrais profils.

Elle ne livre ni invitation, ni recherche d'utilisateur, ni création de workspace, ni page
d'administration des membres. Ces gestes restent à `CRM-070`. Les mutations de membership sont
prouvées hors interface ; le parcours navigateur prouve ce qu'un membre utilise réellement ici :
voir son workspace, ses collègues, leurs noms et leurs avatars.

## 3. Lecture des identités

### 3.1 `profiles`

Un profil est lisible s'il est celui de `auth.uid()` ou si sa personne partage au moins un
workspace avec l'appelant. Partager un workspace suffit, même si un droit fin ferme ensuite un
track ou un channel : le nom d'un collègue est une donnée d'équipe, pas une donnée du dossier.

Un profil qui ne partage aucun workspace rend zéro ligne. L'anonyme rend zéro ligne. La politique
s'appuie sur `workspace_members` et les fonctions `SECURITY DEFINER` existantes ; elle ne
réinterroge jamais `profiles` et ne crée aucun cycle RLS.

Les colonnes affichables sont `id`, `full_name` et `avatar_url`. `locale` reste lisible sur le
profil mais n'est pas une langue sélectionnable : le produit n'en livre qu'une. Aucun email ni
secret n'existe dans `profiles`.

### 3.2 `workspaces`

Un membre lit les workspaces auxquels il appartient, et aucun autre. `CRM-022` ne crée aucune
politique d'écriture sur `workspaces` : créer un espace et en poser le premier administrateur est
un geste atomique qui n'existe pas encore. Les anciens privilèges `INSERT`, `UPDATE` et `DELETE`
d'`authenticated` sont révoqués au lieu de rester comme une capacité trompeuse.

### 3.3 `workspace_members`

Un membre lit toutes les appartenances de son workspace, afin de relier les identifiants métier
aux profils de ses collègues. Il ne lit aucune appartenance d'un autre workspace.

Seul un administrateur du workspace peut insérer, modifier ou supprimer une appartenance. La mise
à jour exposée est limitée à `role` : `workspace_id`, `user_id` et `created_at` ne se déplacent pas
par un `PATCH`. Retirer puis ajouter sont deux gestes distincts. La future fonction edge de
`CRM-070` emploiera la clé de service après acceptation d'une invitation ; aucune clé de service
n'entre dans le navigateur.

## 4. Écriture de son profil

Un utilisateur ne modifie que sa propre ligne, et seulement :

- `full_name`, après suppression des espaces de bord, non vide, au plus 120 caractères ;
- `avatar_url`, nullable, au plus 2048 caractères, chemin même origine commençant par `/` mais
  jamais `//`, ou URL
  `https://`.

`id`, `locale`, `created_at` et `updated_at` sont fermés par privilège de colonne. Le trigger
serveur maintient `updated_at`. Une URL d'un autre schéma est refusée par contrainte ; le composant
d'avatar applique la même liste sûre et se replie sur les initiales si l'image ne charge pas.

Le trigger de création depuis `auth.users` normalise lui aussi le nom et écarte une URL de
métadonnée invalide plutôt que de faire échouer la création du compte GoTrue. Il ne réécrit jamais
un profil existant.

## 5. Invariant du dernier administrateur

Après toute insertion, mise à jour ou suppression de `workspace_members`, chaque workspace
**affecté** qui existe encore doit porter au moins un `admin`, même si la suppression vient de le
laisser sans aucun membre. Conditionner le contrôle à la présence d'une ligne restante laisserait
précisément l'unique administrateur se retirer. La création d'un workspace vide n'est pas couverte
ici : son geste atomique avec le premier admin reste à `CRM-070` et aucun privilège client ne
l'expose.

La garde est un **constraint trigger différable, initialement immédiat** :

- rétrograder ou supprimer le dernier administrateur dans une instruction est refusé par
  `last_workspace_admin` (`23514`) et toute l'instruction est annulée ;
- une rotation atomique peut différer explicitement la contrainte, promouvoir le remplaçant puis
  retirer l'ancien dans la même transaction ;
- supprimer le workspace lui-même reste possible : au contrôle différé, le parent n'existe plus,
  donc sa cascade n'est pas transformée en donnée indestructible ;
- la migration refuse avant installation tout workspace legacy qui porte déjà des memberships
  mais aucun administrateur, au lieu de déclarer l'invariant sur un état déjà faux.

La fonction de trigger est `SECURITY DEFINER`, propriétaire `postgres`, `search_path = ''`, sans
`EXECUTE` direct pour les rôles API. La règle vaut aussi pour `service_role` : contourner la RLS
ne contourne jamais l'intégrité relationnelle.

## 6. Suppression d'une identité

`card_comments.author_id` devient nullable et sa clé étrangère porte `ON DELETE SET NULL`, comme
`card_events.actor_id`, `cards.owner_id`, `cards.created_by` et
`card_field_values.updated_by`. Supprimer un compte conserve donc la conversation ; le commentaire
affiche « Compte supprimé ». Son corps, ses dates et sa place dans le fil survivent.

Un événement dont `actor_id` vaut `null` ne reçoit pas ce libellé : cette valeur désigne aussi une
action de service. L'interface omet alors l'acteur plutôt que d'inventer la cause du `null`.

Les appartenances et droits fins suivent leur profil en cascade. Le contenu métier reste attaché
au workspace, jamais à la durée de vie du compte.

## 7. Contrat d'interface

Un composant d'avatar partagé rend une image ronde de 24 ou 32 px, jamais un identifiant
technique. Si `avatar_url` est absente, rejetée ou en échec, il rend les initiales sur un jeton doux.
Lorsque le nom est écrit à côté, l'image est décorative (`alt=""`) ; lorsqu'elle est seule, son nom
accessible est « Responsable : <nom> ».

Les surfaces rouvertes par INC-014 sont exhaustives :

| Surface | Identité rendue |
|---|---|
| En-tête | avatar et nom du profil courant ; l'email reste en infobulle de repli |
| Contexte | vrai nom du workspace déjà chargé par la coquille |
| Board | avatar du responsable sur chaque card qui en porte un |
| Vue liste | colonne « Responsable », avatar et nom ; cellule vide sans responsable |
| Commentaire | avatar et nom de l'auteur ; « Compte supprimé » si la FK vaut `null` |
| Événement | nom de l'acteur s'il existe ; rien pour une action de service ou un compte détaché |

Les profils sont embarqués par les relations PostgREST déjà portées par chaque ligne ; l'écran ne
fait pas une requête par avatar. Le profil courant est la seule lecture autonome, effectuée une
fois après restauration de session. Une identité illisible se replie sans faire tomber la donnée
métier qui, elle, a été consentie.

Sous 390 px, les noms longs se tronquent sans masquer l'action de déconnexion et le tableau garde
son débordement horizontal signalé. Aucun avatar externe n'est nécessaire à la preuve : le seed
emploie trois SVG même origine servis par le build.

## 8. Seed

Les profils stables convergent vers :

| Profil | Avatar même origine |
|---|---|
| Camille Aubert | `/avatars/camille-aubert.svg` |
| Driss Lemoine | `/avatars/driss-lemoine.svg` |
| Farida Nowak | `/avatars/farida-nowak.svg` |

Le chemin est écrit dans `auth.users.raw_user_meta_data` **et** dans `profiles`, parce que le
trigger ne rejoue pas sur un compte existant. Le seed relit les trois valeurs. Son rejeu ne crée
ni compte, ni appartenance, ni fichier supplémentaire.

## 9. Preuves obligatoires

| Niveau | Preuves |
|---|---|
| pgTAP | contraintes de profil, privilèges de colonne, sept politiques exactes, lecture commune et refus croisé, mutations admin/non-admin, dernier admin dans les deux sens, rotation différée, cascade workspace, suppression de profil avec commentaire conservé, fonctions/triggers/ACL |
| API | vrais JWT admin/business developer/viewer : trois identités et workspace lisibles, autre workspace invisible, modification propre réussie puis restaurée, autre profil refusé, membership admin réussi puis nettoyé, deux non-admin refusés, dernier admin refusé par `23514` |
| Interface | connexion réelle, workspace et profil courant nommés, avatars servis en HTTP 200, board, liste et fiche parcourus au clavier/souris, noms réels dans commentaires et événements, captures 1440/390, aucun `console.warn`, `console.error` ni `pageerror` |
| Harnais | migration legacy sur base seedée, empreinte métier inchangée hors schéma, dégradations de chaque famille de politique, privilège de colonne et garde du dernier admin, puis restauration constatée |

Les suites historiques qui asséraient l'absence de politiques ou de noms sont **révisées**, jamais
supprimées. La preuve de refus n° 10 cesse de mesurer un refus par défaut et exige désormais la
cause `last_workspace_admin`.

## 10. Déploiement et retour arrière

La migration ne modifie aucune ligne métier. Elle refuse de démarrer si un workspace peuplé n'a
aucun administrateur ou si un profil existant viole les nouvelles bornes ; le contrôle de
pré-déploiement énumère ces lignes avant application.

Retirer les politiques remet les trois tables en refus par défaut. Retirer la garde du dernier
administrateur rouvre une perte d'accès irréparable par l'interface. Revenir à une FK de
commentaire sans `ON DELETE SET NULL` ne restaure aucune identité déjà supprimée ; conserver la
nullable et l'action `SET NULL` est le retour arrière recommandé.

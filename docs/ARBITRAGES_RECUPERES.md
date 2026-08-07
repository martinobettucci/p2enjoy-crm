# Décisions récupérées de la branche `claude/happy-goldberg-qt5vfi`

Ce document est une **table de correspondance**. Le texte des décisions n'est pas ici : il est
dans `docs/JOURNAL.md`, à sa place, sous une numérotation neuve.

## Ce qui s'est passé

Quarante et une branches `claude/happy-goldberg-*` ont été poussées sur `origin` en violation de
`CLAUDE.md` §13, qui interdit toute création de branche. Elles ont été supprimées — inventaire dans
`docs/BRANCHES_SUPPRIMEES.md`. Quarante ne portaient que des réimplémentations parallèles d'unités
que `main` porte déjà. Une seule, `claude/happy-goldberg-qt5vfi`, retenait **dix-huit décisions du
responsable que `main` n'avait jamais reçues**, dont **cinq arbitrages explicites**.

Ces dix-huit décisions sont **réinsérées dans `docs/JOURNAL.md`**, texte inchangé, sous les numéros
**249 à 266**.

## Pourquoi la renumérotation

Les deux lignes ont numéroté leurs décisions en parallèle : les numéros 235 à 252 désignaient des
sujets différents de chaque côté. Sur `main`, le numéro 239 traite de la boîte mail du `viewer` ;
sur la branche, il rattachait l'écran de connexion à `CRM-009`. Réinsérer sous les numéros d'origine
aurait écrasé des décisions de `main`. Les numéros d'origine sont conservés en tête de chaque
entrée réinsérée, et rappelés ci-dessous.

Les renvois internes à la série ont été décalés du même pas ; les renvois vers des décisions
antérieures à 235 — les décisions 8, 12, 180 et 234 — sont intacts.

## Correspondance

| N° d'origine | N° sur `main` | Sujet | Arbitrage du responsable |
|---|---|---|---|
| 235 | **249** | Stalwart 0.16 ne se configure plus par un fichier, et l'assemblage doit en tenir compte | — |
| 236 | **250** | Le plan ne déclare aucune écoute réseau, et c'est une contrainte mesurée | — |
| 237 | **251** | Le domaine des cards passe sous un TLD réservé avant d'être réellement délivré | — |
| 238 | **252** | Trois défauts trouvés en exécutant le harnais, et les trois étaient les miens | — |
| 239 | **253** | L'écran de connexion a son unité : `CRM-009` (arbitrage du responsable, INC-021) | **oui** |
| 240 | **254** | La session vit en `sessionStorage` (arbitrage du responsable, INC-022) | **oui** |
| 241 | **255** | Le secret de build du registre npm est câblé, et c'est une unité : `CRM-015` (arbitrage du responsable, INC-042) | **oui** |
| 242 | **256** | L'invitation est rattachée à `CRM-070` (arbitrage du responsable, INC-015) | **oui** |
| 243 | **257** | La garde de ports lit `/proc/net/tcp` en dernier recours (arbitrage du responsable, INC-044 et INC-079) | **oui** |
| 244 | **258** | La collision du numéro 180 est levée par un suffixe, jamais par une renumérotation | — |
| 245 | **259** | Une liste d'exemples du responsable n'est pas une spécification exhaustive | — |
| 246 | **260** | Les fonctions edge entrent au périmètre : la décision 12 est rouverte | — |
| 247 | **261** | L'ordonnancement passe à `pg_cron` : la décision 8 est renversée | — |
| 248 | **262** | `require_fields` devient une table de liaison : le modèle est corrigé, pas contourné | — |
| 249 | **263** | Changer le workflow d'un channel entier est un geste distinct : `change_channel_workflow` | — |
| 250 | **264** | Les gabarits d'emails sont servis, et une preuve d'email vérifie son contenu | — |
| 251 | **265** | Le chemin d'administration de GoTrue est encadré, pas accepté | — |
| 252 | **266** | La copie de workflow contre la surcharge : l'écart est confirmé | — |

## Trois décisions contredisent l'infrastructure livrée

Les décisions **249, 250 et 252** (origines 235, 236 et 238) décrivent un assemblage Stalwart que
`main` n'a pas adopté : `config.json` + `plan.json.template` et **aucune écoute déclarée**, là où
`main` livre `config.toml` + `provision.sh` et **cinq écoutes**. Elles citent en outre
`docs/SPEC-mail-dev-infra.md`, qui n'existe pas dans ce dépôt. La contradiction est consignée en
**INC-082** et **n'est pas résolue** : ni les décisions ni `stalwart/` ne sont modifiés.

## Ce qui reste dû

L'arbitrage **`require_fields` devient une table de liaison** (origine 248, désormais décision 260)
n'est **pas appliqué** dans le code : `docs/SCHEMA.md` décrit toujours `require_fields` en `uuid[]`
et note qu'il ne peut porter aucune intégrité référentielle, ce que cette décision renversait. La
mise en œuvre engage une migration, `docs/SCHEMA.md`, `docs/DAT.md` et `docs/PROD_MIGRATIONS.md`.
Elle est suivie en **INC-081**.

À l'inverse, l'unité de l'écran de connexion (décision 253) et la session en `sessionStorage`
(décision 254) sont **déjà appliquées** sur `main` par la décision 243 : seule leur trace manquait.
Les quinze autres entrées n'ont pas été mesurées une à une.

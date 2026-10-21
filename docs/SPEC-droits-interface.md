# Spécification — Les gestes offerts selon les droits — `CRM-093`

Unité de backlog : `CRM-093` (`docs/BACKLOG.md`). Arbitrages : `docs/JOURNAL.md` décisions 603 (le constat) et
628 (la source et l'affichage). Documents liés : `docs/SPEC-permissions-rls.md` §2 (rôles, droits fins), §3
(fonctions d'autorisation) ; `docs/DESIGN_SYSTEM.md` (patron de la commande refusée, écrit en tranche T2) ;
`CLAUDE.md` §10.

## 1. Objet et principe

**Le constat** (décision 603, mesuré le 2026-10-21) : 41 écrans portent des commandes d'écriture, 33 ne consultent
aucun droit. La lectrice du seed voit « Nouveau contact », « Nouveau channel », les liens d'administration du guide ;
le serveur refuse chacun de ces gestes, l'interface les propose.

**Le principe, inchangé** : le refus serveur est la seule règle (`CLAUDE.md` §10). Ce que décrit ce document est une
**aide d'interface** : elle ne remplace, n'assouplit ni ne duplique aucune politique. Chaque écran garde la traduction
de son refus, car un droit peut changer entre l'affichage et le geste.

**Les deux arbitrages** (décision 628) :

1. **La source est le rôle ET les droits fins**, lus par des fonctions calculées par les MÊMES fonctions
   d'autorisation que la RLS — jamais recomposées côté client.
2. **Une commande que l'utilisateur ne peut pas exercer reste montée, désactivée, avec son motif.** Elle n'est pas
   masquée.

## 2. Les trois faits que l'interface lit

Les 90 politiques d'écriture de la base se ramènent à trois faits (mesuré par `pg_policies` le 2026-10-21) :

| Fait | Ce qu'il ouvre | Lu par |
|---|---|---|
| **administrateur** de l'espace | tracks, channels, workflows et leurs versions, champs et règles, catalogue de nœuds, budgets et occurrences, coût du personnel, droits fins, appartenances et attentes, assistant IA, comptes entrants | **nouveau** : `public.administration_permise(public.workspaces)` — `app.is_workspace_admin`, administrateur du domaine LeLabs compris |
| **éditeur** de l'espace — `admin` ou `business_developer` | contacts, organisations, tableaux et blocs d'objectifs, modèles d'emails, séquences de relance | **nouveau** : `public.edition_permise(public.workspaces)` — `app.workspace_role` dans (`admin`, `business_developer`), exactement le prédicat de ces politiques |

**RÉVISÉ le 2026-10-21, après lecture intégrale de `docs/DESIGN_SYSTEM.md`, avant tout code de l'interface.** La
première rédaction lisait les deux premiers faits par `public.mon_role_espace`. Le design system pose une frontière que
cette lecture franchissait (§5.29 ter, reprise au §5.56) : « si l'écran doit LIRE UN RÔLE pour éteindre, c'est interdit ;
si la BASE lui dit sur la ligne qu'il ne peut pas écrire, l'éteindre est la forme juste ». Les trois faits sont donc
TOUS des capacités rendues par la base sur une ligne — celle de l'espace pour les deux premiers, celle du channel ou de
l'affaire pour le troisième —, calculées par les fonctions mêmes de la RLS. La décision 628 n'en est pas changée : la
source reste « le rôle et les droits fins », lus par la base et non déduits par l'écran. Les deux colonnes de l'espace
viennent par la migration `0092` (§2.2).
| **écriture sur un channel** — rôle et droits fins, « le plus spécifique gagne » | les cards du channel et tout ce qui s'y rattache : créer, déplacer, modifier l'en-tête et le formulaire, contacts rattachés, lignes de coût et réels, commentaires, classement et déclassement d'un message, envoi, relance, mise en sommeil | **nouveau** : `public.ecriture_permise(public.channels)` et `public.ecriture_permise(public.cards)` |

Les gestes **personnels** n'ont pas besoin d'un fait de plus : son propre profil, ses préférences de notification, la
saisie de son propre temps sur une cible qu'on lit (`app.saisie_temps_permise`). La lectrice les garde ; l'interface ne
les éteint pas. *Corrigé à l'écriture de la fiche (T4)* : la correction ou le retrait de ses propres commentaires n'est
pas un geste personnel — la politique `card_comments` exige l'auteur ET `app.can_write_card` — ; il suit la capacité de
l'affaire.

### 2.1 Les deux colonnes calculées — migration `0091`

Même patron que `public.ecriture_permise(public.goal_boards)` (migration `0071`, `CRM-083`) : une fonction SQL prenant
la ligne de la table, que PostgREST expose comme **colonne calculée** (`select=…,ecriture_permise`).

```sql
create function public.ecriture_permise(ch public.channels) returns boolean
  language sql stable as $$ select app.can_write_channel(ch.id) $$;
create function public.ecriture_permise(c public.cards) returns boolean
  language sql stable as $$ select app.can_write_channel(c.channel_id) $$;
```

- **Aucune ligne n'est rendue que la RLS ne rende déjà** : la colonne s'évalue sur des lignes déjà filtrées par la
  politique de lecture. Elle n'apprend rien qu'un essai d'écriture n'apprendrait.
- **Condition suffisante de refus, jamais nécessaire** : certains gestes exigent davantage (une ligne de coût, un
  budget lisible et ouvert). L'écran éteint sur la colonne et continue de traduire les refus.
- `EXECUTE` retiré à `public`, puis accordé nommément à `anon`, `authenticated` et `service_role` — **même motif qu'à
  la migration 71** : sans lui, un appel anonyme qui demanderait la colonne recevrait une erreur de privilège là où
  `docs/SPEC-permissions-rls.md` §7 exige zéro ligne ; le droit n'ouvre rien (`auth.uid()` nul rend faux). *Précision
  apportée en écrivant la migration, le 2026-10-21 : la première rédaction retirait le droit à `anon`.*
- `stable`, `security invoker` — critique : en `definer`, la fonction répondrait pour `postgres` et rendrait `true` à la
  lectrice ; aucun `set search_path`, comme aux migrations 52 et 71.
- Une card hérite de son channel : `app.can_write_card(card)` est défini ainsi, et la colonne des cards ne fait que le
  dire sans relire la table.

### 2.2 Les deux colonnes de l'espace — migration `0092`

Même patron que le §2.1 : `public.administration_permise(w public.workspaces)` rend `app.is_workspace_admin(w.id)` ;
`public.edition_permise(w public.workspaces)` rend `coalesce(app.workspace_role(w.id) in ('admin', 'business_developer'),
false)`. `stable`, `security invoker`, `execute` à `anon`, `authenticated` et `service_role`. L'interface les demande
avec la ligne de l'espace qu'elle lit déjà (`workspaces?select=…,administration_permise,edition_permise`).

## 3. Le rendu d'une commande refusée

- La commande reste **montée**, `disabled`, **lisible** (jamais `opacity-50`), avec un **motif visible** en tête du bloc,
  lié par `aria-describedby`. C'est le patron du canevas en lecture seule (`docs/DESIGN_SYSTEM.md` §5.29 ter :
  bandeau neutre `--color-hover`, bordure `--color-border`, texte `--color-ink`, icône `Eye`, `role="status"`, motif
  une fois et chaque commande y renvoie) et d'une ligne soldée (§5.31 bis) ; la tranche T2 l'écrit une fois pour toutes
  dans `docs/DESIGN_SYSTEM.md` (§5.59), comme composant partagé de `webapp/src/components/ui`, et en étend la
  frontière à tout le produit.
- **Les motifs**, centralisés dans `webapp/src/i18n/fr.ts` : « Réservé aux administrateurs de l'espace. » ;
  « Réservé aux administrateurs et aux business developers. » ; « Lecture seule : vos droits sur ce channel ne
  permettent pas de modifier ses affaires. »
- **Un motif par bloc, pas par bouton**, quand tout un bloc est éteint pour la même raison : un seul paragraphe en tête,
  et chaque commande y renvoie par `aria-describedby`.
- **Un lien qui mène à un écran d'administration** (guide de démarrage, navigation des réglages) devient une commande
  désactivée de même forme : un lien ne se désactive pas, il est rendu comme texte, avec le même motif.
- **Un écran d'administration atteint par son adresse** garde son état « réservé aux administrateurs », tel
  qu'aujourd'hui (`ReglagesCoutPersonnel`, `AdministrationWorkflows`…).
- **Les champs d'un formulaire** qu'on ne peut pas enregistrer sont `readOnly` plutôt que `disabled` — ils restent
  lisibles et sélectionnables au clavier —, et le bouton d'enregistrement est désactivé avec le motif.

## 4. Les états

| État | Rendu |
|---|---|
| Droits **en cours de lecture** | Les commandes d'écriture sont désactivées **sans** motif, `aria-busy` sur leur bloc ; aucun texte de refus ne s'affiche avant d'être su |
| Droits **lus** | Commande active, ou désactivée avec son motif |
| Lecture des droits **en échec** | Les commandes restent **actives** : l'aide d'interface s'efface, le serveur refusera si besoin et l'écran traduira son refus. Un défaut de lecture ne doit pas priver un administrateur de ses gestes |
| **Refus serveur** malgré une commande active | Le refus est traduit comme aujourd'hui, et les droits sont relus |

## 5. Inventaire, écran par écran

« Famille » renvoie au §2 : **A** administrateur, **E** éditeur, **C** écriture sur le channel, **P** personnel (jamais
éteint).

| Écran | Commandes d'écriture | Famille |
|---|---|---|
| Barre des tracks (`TabBar`), track (`NouveauChannelTrack`) | « Nouveau channel » | A |
| Guide de démarrage, guide flottant | « Créer le workflow de départ », liens vers l'administration | A |
| Réglages — navigation | entrées des écrans d'administration | A (entrées « Notifications » : P) |
| Arborescence, workflows, catalogue, champs, versions, assistant IA | créer, modifier, archiver, publier, restaurer, accepter une suggestion | A |
| Budgets du track, occurrences | « Nouveau budget », modifier, ouvrir, retirer une occurrence | A |
| Coût du personnel | « Nouvelle version », retirer | A |
| Comptes entrants, identités mail | enregistrer, nouvelle identité | A (identité personnelle : P, selon `docs/SPEC-mail-subsystem.md` §2.2) |
| Corbeille | « Restaurer » | selon l'objet : A pour la structure, C pour une affaire |
| Contacts, fiche contact, organisation | « Nouveau contact », modifier, supprimer | E |
| Modèles d'emails, séquences de relance | créer, modifier, supprimer | E |
| Objectifs | tableau et blocs | E (déjà tenu par `ecriture_permise(goal_boards)` : inchangé) |
| Board, liste des affaires | « Nouvelle affaire », déplacer | C |
| Fiche d'une affaire — en-tête, formulaire | modifier, enregistrer | C |
| Fiche — contacts rattachés | rattacher, changer le rôle, détacher | C |
| Fiche — coûts, réels, « Soldé » | ajouter, modifier, supprimer, solder | C (déjà éteint pour une ligne soldée : inchangé) |
| Fiche — timeline | écrire un commentaire ; modifier ou supprimer **le sien** (l'auteur ET l'écriture sur l'affaire) | C |
| Fiche — envoi, relance, mise en sommeil | répondre, mettre en file, armer, interrompre, endormir, réveiller | C |
| Inbox | classer, déclasser | C sur l'affaire de destination ; la liste des affaires proposées ne retient déjà que les modifiables |
| Coûts à saisir | réel de plus, « Soldé » | C (déjà tenu ligne par ligne : inchangé) |
| Temps — saisie | saisir son temps | P ; « Saisir pour » un autre : A (déjà tenu) |
| Notifications, profil | préférences, nom | P |

**La corbeille, précisée (tranche T4, 2026-10-21).** L'écran est ouvert à tout membre et mêle trois types d'entrées ;
la capacité est donc lue **par ligne**, selon la règle qui juge réellement la restauration — mesurée sur les politiques :
`tracks` et `channels` se restaurent sous `app.is_workspace_admin` (migrations 3 et 4), une affaire sous
`app.can_write_channel(channel_id)` (`cards_maj`). Une entrée de structure lit `administration_permise` de l'espace ;
une affaire lit sa propre `ecriture_permise`, par **une** lecture à part de la liste (`id in (…)`), pour la raison du
§4 : une colonne absente ne fait tomber que l'aide. Deux motifs au plus, en tête du tableau, chacun rendu seulement si
une ligne de sa famille est refusée, et chaque « Restaurer » éteinte cite le sien. **La garde `parent_en_corbeille`
n'est PAS anticipée** (`docs/SPEC-corbeille.md` §4.5) : c'est un état de la donnée, qu'un autre utilisateur peut
changer entre le chargement et le clic, pas une capacité rendue par la base.

Les écrans de la plateforme (`/plateforme`, `CRM-101`) et du connecteur MCP (`CRM-103`) sont hors de cette unité : ils
ont leur propre garde de superadministrateur.

## 6. Preuves

- **pgTAP** (suite neuve) : les deux colonnes rendent `true`/`false` pour l'administrateur, le business developer, la
  lectrice, et sous chaque droit fin (`member`, `viewer`, `none`, absence de ligne), y compris la transitivité du
  §3.3 bis de `docs/SPEC-permissions-rls.md` ; l'anonyme n'exécute pas ; une ligne illisible n'est pas rendue.
- **API**, jetons réels : `GET /channels?select=id,ecriture_permise` et `GET /cards?select=id,ecriture_permise` pour
  les trois profils du seed, et pour une lectrice rouverte en écriture sur un channel.
- **Unitaires** : la lecture des droits (états du §4) et le composant de la commande refusée (motif, `aria-describedby`,
  `readOnly`).
- **E2E par rôle**, à la souris et au clavier : la lectrice voit chaque commande des familles A, E et C désactivée avec
  son motif, et garde ses gestes P ; le business developer garde E et C, voit A désactivée ; l'administrateur garde
  tout. Le refus serveur reste prouvé par les suites existantes.
- **Captures** observées, ordinateur et mobile, pour les trois rôles sur les écrans principaux ; **manuel** : un
  paragraphe sur ce que chaque rôle peut faire, et pourquoi une commande est grisée.

## 7. Découpage en tranches

| Tranche | Contenu |
|---|---|
| T1 | Migrations `0091` (channels, affaires) et `0092` (espace), suite pgTAP, types régénérés, `docs/SCHEMA.md`, preuves d'API |
| T2 | La lecture des droits côté webapp, le composant de la commande refusée et ses motifs, `docs/DESIGN_SYSTEM.md` ; preuves unitaires |
| T3 | Familles A et E : réglages, guide, arborescence, budgets, contacts, modèles, séquences |
| T4 | Famille C : board, liste, fiche d'une affaire, inbox, corbeille |
| T5 | E2E par rôle, captures, manuel, seed (une lectrice rouverte en écriture sur un channel, si le seed ne la porte pas déjà), campagnes |
| T6 | Livraison en production (migration `0091`, instantané confirmé par le responsable) et constat |

# Backlog — P2Enjoy CRM

Unités d'exécution du projet. L'ordre et les règles d'avancement sont dans
`docs/MASTER_PLAN.md` ; la Definition of Done commune y figure au §4.

## Marquage

- `[ ]` non commencé ;
- `[~]` en cours, ou implémenté mais insuffisamment vérifié ;
- `[x]` terminé **et intégralement vérifié**.

Une unité ne passe `[x]` qu'avec ses preuves : test unitaire dédié, test API ou d'intégration
dédié, test E2E dédié, vérification visuelle observée si l'interface est touchée, seed à jour,
documentation à jour, commit poussé. **Aucune exception.**

---

## Chunk 1 — Documentation

### CRM-000 — Socle documentaire `[x]`

- [x] `README.md`, `CHANGELOG.md`.
- [x] `docs/DAT.md`, `docs/SCHEMA.md`, `docs/DESIGN_SYSTEM.md`.
- [x] `docs/SPEC-workflow-engine.md`, `docs/SPEC-form-composer.md`,
      `docs/SPEC-mail-subsystem.md`, `docs/SPEC-permissions-rls.md`.
- [x] `docs/MASTER_PLAN.md`, `docs/BACKLOG.md`, `docs/JOURNAL.md`,
      `docs/PROD_MIGRATIONS.md`, `docs/manual.md`, `docs/INCONSISTENCY_REPORT.md`.
- [x] Commit documentaire dédié, poussé avant toute ligne de code.

*DoD réduite : unité purement documentaire, sans code ni interface, donc sans test ni capture.*

---

## Chunk 2 — Infrastructure et socle d'identité

### CRM-001 — Pile Supabase self-hosted `[ ]`
Copie de la pile éprouvée (`../starter.2025.12/supabase/docker/`), versions épinglées.
Assemblage `docker-compose.yml` + overlays dev et prod. MinIO en dev, Storage sur S3.
**DoD** : `docker compose up` démarre tous les services sains ; Kong répond ; Studio accessible en
dev ; aucun service de développement présent en prod.

### CRM-002 — Scripts de lancement et environnement `[ ]`
`runDev.sh`, `runProd.sh`, `resetMe.sh`, `.env.example` documentant **chaque** variable (rôle,
format, obligatoire ou non, exemple non sensible).
**DoD** : démarrage à froid depuis un dépôt propre ; `resetMe.sh` recrée la base et le seed ;
aucun secret réel versionné ; `README.md` §5–6 conforme au comportement réel.

### CRM-003 — Migrations d'amorçage `[ ]`
Extensions, schéma `app`, `profiles` (+ trigger de création), `workspaces`,
`workspace_members`, `track_members`, `channel_members`.
**DoD** : migrations rejouables à blanc ; `docs/SCHEMA.md` §1 conforme ; pgTAP sur le trigger de
création de profil ; `docs/PROD_MIGRATIONS.md` mis à jour.

### CRM-004 — Décision chiffrement des secrets `[ ]`
**Bloquante pour `CRM-052` et `CRM-053`.** Vérifier la présence de `supabase_vault` et de
`pg_cron` dans l'image PostgreSQL retenue. Retenir Vault ou le repli `pgcrypto`.
**DoD** : vérification exécutée et **sortie de commande consignée** dans `docs/JOURNAL.md` ;
décision inscrite dans `docs/DAT.md` §8 et `docs/SCHEMA.md` ; entrée retirée de
`docs/INCONSISTENCY_REPORT.md`.

### CRM-010 — Fonctions d'autorisation `[ ]`
`app.is_workspace_member`, `app.is_workspace_admin`, `app.can_read_track`,
`app.can_read_channel`, `app.can_write_channel`, `app.can_read_card`.
**DoD** : pgTAP couvrant chaque rôle et chaque combinaison de droits fins ; absence de récursion
démontrée ; `search_path` fixé sur toutes les fonctions `SECURITY DEFINER`.

### CRM-011 — Authentification `[ ]`
GoTrue, inscription libre désactivée, invitation par un administrateur, connexion, déconnexion,
réinitialisation de mot de passe.
**DoD** : E2E de connexion et de refus ; email d'invitation **réellement envoyé** et constaté
dans Inbucket ; captures observées.

### CRM-012 — Droits fins par track et channel `[ ]`
Résolution « le plus spécifique gagne », administrateur jamais restreint.
**DoD** : pgTAP sur la matrice de résolution ; preuves de refus n° 3, 4, 7 et 11 de
`docs/SPEC-permissions-rls.md` §7.

### CRM-013 — Colonnes protégées `[ ]`
`REVOKE` sur `secret_id`, `token_hash` ; `current_step_id` et `email_local_part` non modifiables
directement ; `card_events` et `audit_log` en écriture par trigger uniquement.
**DoD** : preuves de refus n° 5, 6 et 8 ; test explicite qu'une lecture refusée retourne **zéro
ligne** et non une erreur ambiguë.

### CRM-014 — Harnais de preuves d'autorisation `[ ]`
Projet Playwright `api` exécutant les douze scénarios de refus avec les jetons réels de chaque
profil.
**DoD** : les 12 scénarios verts ; le harnais échoue si une politique est retirée (vérifié en
retirant temporairement une politique).

### CRM-005 — Seed socle `[ ]`
Utilisateurs créés par l'API d'administration GoTrue ; un workspace ; les rôles représentés.
**DoD** : seed reproductible, identifiants stables, aucun mot de passe réel ; profils `admin`,
`business_developer` et `viewer` présents ; documenté dans `README.md`.

### CRM-006 — Types TypeScript générés `[ ]`
**DoD** : `npm run types:generate` régénère depuis le schéma local ; build de la webapp vert.

### CRM-007 — Squelette de la webapp `[ ]`
React + Vite + Tailwind, jetons du design system en variables CSS, mise en page barre latérale et
onglets, états de chargement, d'erreur et vide.
**DoD** : `docs/DESIGN_SYSTEM.md` §11 respecté (aucun hexadécimal hors jetons) ; captures aux
quatre paliers responsive observées ; navigation clavier vérifiée.

### CRM-008 — Harnais de tests `[ ]`
pgTAP, Vitest, pytest, Playwright (`api`, `ui`, `mail`).
**DoD** : chaque commande du `README.md` §7 s'exécute ; un test volontairement faux échoue bien.

---

## Chunk 3 — CRM utilisable

### CRM-020 — Tracks `[ ]`
CRUD, ordre, archivage, barre latérale.
**DoD** : unitaire, API (écriture refusée aux non-administrateurs), E2E, captures.

### CRM-021 — Channels `[ ]`
CRUD, ordre, archivage, onglets, débordement horizontal.
**DoD** : idem, plus le trigger de cohérence du workflow (`CRM-033`) une fois disponible.

### CRM-030 — Catalogue de nœuds `[ ]`
`workflow_nodes_catalog`, catalogue initial de sept nœuds, refus d'archivage d'un nœud occupé.
**DoD** : pgTAP sur le refus d'archivage ; E2E d'administration ; seed conforme au tableau de
`docs/SPEC-workflow-engine.md` §2.

### CRM-031 — Workflows, étapes, transitions `[ ]`
Éditeur d'administration ; workflow par défaut du seed conforme au graphe spécifié.
**DoD** : pgTAP (étape initiale unique, unicité `(workflow, nœud)`, transitions distinctes) ;
E2E de création ; captures de l'éditeur.

### CRM-032 — Copie d'un workflow vers un track `[ ]`
`copy_workflow_to_track` avec traçabilité d'origine et signalement de divergence.
**DoD** : pgTAP (copie complète des étapes, transitions et champs ; lignage renseigné) ; E2E ;
mention de divergence visible dans l'interface.

### CRM-033 — Cohérence workflow ↔ channel `[ ]`
Trigger : workflow `global` du workspace, ou `track` du track du channel.
**DoD** : pgTAP sur les trois cas (global accepté, track du même track accepté, track étranger
refusé) ; refus constaté aussi lors d'un déplacement de channel.

### CRM-034 — `move_card`, garde centrale `[ ]`
Les six vérifications de `docs/SPEC-workflow-engine.md` §5.
**DoD** : pgTAP pour chacune des six ; preuves de refus n° 1 et 5 ; message d'erreur listant les
clés manquantes.

### CRM-035 — Définition des champs `[ ]`
`form_fields`, `form_field_rules`, grille champ × étape dans l'éditeur.
**DoD** : unitaire, API (écriture réservée aux administrateurs), E2E, captures de la grille.

### CRM-036 — Valeurs et validation `[ ]`
`card_field_values`, validation par type, union étape + transition.
**DoD** : pgTAP (type incorrect refusé, `hidden` non exigé, règle ajoutée après coup
n'invalidant pas l'existant).

### CRM-037 — Rendu du formulaire conditionnel `[ ]`
Champs par étape, section repliée des valeurs d'autres étapes, mention « requis pour passer à ».
**DoD** : E2E (transition bloquée, saisie, transition réussie) ; captures de chaque étape ;
accessibilité des erreurs vérifiée.

### CRM-040 — Cards `[ ]`
CRUD, adresse email générée, responsable, montant, archivage, corbeille.
**DoD** : pgTAP sur la génération et l'unicité de `email_local_part` ; E2E ; captures.

### CRM-041 — Board kanban `[ ]`
Colonnes par étape, glisser-déposer appelant `move_card`, menu des transitions déclarées,
retour arrière visuel en cas de refus.
**DoD** : E2E de déplacement autorisé **et** de tentative interdite ; déplacement au clavier
vérifié ; captures aux quatre paliers ; vidéo `.webm` du glisser-déposer.

### CRM-042 — Vue liste `[ ]`
Tri, filtres, densité maîtrisée, pagination.
**DoD** : E2E ; comportement avec données longues vérifié en capture.

### CRM-043 — Commentaires `[ ]`
Rédaction libre par tout membre pouvant lire la card, édition et suppression par l'auteur.
**DoD** : API (refus pour un `viewer`) ; E2E ; temps réel constaté.

### CRM-044 — Timeline unifiée `[ ]`
`card_events` alimentée par triggers ; fil chronologique filtrable.
**DoD** : pgTAP (aucune écriture cliente possible) ; E2E ; captures.

### CRM-045 — Déplacement d'une card entre channels `[ ]`
`move_card_to_channel` avec remappage explicite.
**DoD** : pgTAP (remappage obligatoire, événement écrit) ; E2E.

### CRM-046 — Seed de démonstration complet `[ ]`
Trois tracks, plusieurs channels, workflows distincts dont un dérivé, cards à toutes les étapes,
cas d'erreur et branches alternatives, aucun écran vide.
**DoD** : `resetMe.sh` reproduit exactement le même état ; chaque fonctionnalité livrée est
démontrable depuis le seed.

### CRM-047 — Manuel utilisateur du chunk 3 `[ ]`
**DoD** : `docs/manual.md` décrit le produit réellement exécuté ; captures renouvelées.

---

## Chunk 4 — Messagerie

### CRM-050 — Infrastructure mail de développement `[ ]`
Stalwart (IMAP/SMTP), Roundcube (vérification visuelle), ClamAV, Inbucket conservé pour les
mails transactionnels. Boîte système et deux boîtes personnelles seedées.
**DoD** : `runDev.sh` démarre l'ensemble ; connexion IMAP et SMTP constatée ; Roundcube affiche
les boîtes ; `README.md` §6 conforme.

### CRM-051 — Service `mail-sync` `[ ]`
Squelette Python, configuration, journaux structurés, point de santé, API interne.
**DoD** : pytest unitaire ; image construite ; arrêt et redémarrage sans perte d'état.

### CRM-052 — Comptes entrants IMAP `[ ]`
Configuration, secret chiffré, test de connexion réel, état de synchronisation.
**DoD** : `CRM-004` tranché ; preuve de refus n° 6 (secret illisible) et n° 7 ; E2E de connexion
d'une boîte ; message d'erreur assaini vérifié.

### CRM-053 — Identités sortantes SMTP `[ ]`
Indépendantes des comptes entrants, adresse d'expédition, signature, quota.
**DoD** : E2E de configuration ; preuve de refus n° 12 ; cas « entrant Yahoo / sortant interne »
présent dans le seed.

### CRM-054 — Ingestion `[ ]`
IDLE, analyse MIME, dédoublonnage par `Message-ID`, occurrences, pièces jointes, antivirus.
**DoD** : pytest unitaire et intégration contre Stalwart ; E2E `mail` avec un email **réellement
envoyé** ; pièce jointe `infected` non téléchargeable (preuve n° 9) ; empreinte de repli testée.

### CRM-055 — Classement assisté `[ ]`
Les quatre règles, dont la suggestion non classante.
**DoD** : pytest par règle ; E2E de classement manuel ; si `CRM-060` n'est pas livré, règle 3
désactivée et documentée comme telle.

### CRM-056 — Dossiers IMAP imbriqués `[ ]`
Création, assainissement, renommage, labels Gmail, `mail_folder_map`.
**DoD** : intégration vérifiant l'arborescence **par un client IMAP** ; observation visuelle dans
Roundcube ; renommage d'un track propageant le renommage du dossier.

### CRM-057 — Inbox globale `[ ]`
Trois panneaux, arborescence Track → Channel → Card, « Non classés », pile sous 1024 px.
**DoD** : E2E ; captures aux quatre paliers ; message classé visible **à la fois** dans la card
et dans l'inbox.

### CRM-058 — Composition et réponse `[ ]`
`queue_outbound_email`, `smtp_worker`, `Reply-To` de la card, fil respecté, envoi depuis la card
ou depuis l'inbox par le même chemin.
**DoD** : E2E `mail` d'aller-retour complet ; en-têtes de threading vérifiés sur le message reçu ;
quota et refus testés.

### CRM-059 — Backfill, résilience, supervision `[ ]`
Import historique par lots, file persistante, backoff, états visibles.
**DoD** : pytest sur le backoff ; coupure SMTP simulée sans perte de message ; état affiché
conforme à la réalité.

---

## Chunk 5 — Extensions

Chaque unité est indépendamment livrable et suit la Definition of Done commune.

| Unité | Objet | État |
|---|---|---|
| CRM-060 | Contacts et organisations, historique transverse | `[ ]` |
| CRM-061 | Prochaine action, échéance, vue « Ma journée » | `[ ]` |
| CRM-062 | Relances automatiques des cards figées | `[ ]` |
| CRM-063 | Templates d'emails, signatures, séquences de relance | `[ ]` |
| CRM-064 | @mentions, notifications temps réel et préférences | `[ ]` |
| CRM-065 | Recherche globale plein texte et palette Cmd+K | `[ ]` |
| CRM-066 | Analytique de conversion et prévisionnel pondéré | `[ ]` |
| CRM-067 | Activités typées : appels, réunions, visios | `[ ]` |
| CRM-068 | Checklists et modèles de cards | `[ ]` |
| CRM-069 | Étiquettes et digest quotidien | `[ ]` |
| CRM-070 | Administration des permissions fines | `[ ]` |
| CRM-071 | Vues sauvegardées et import CSV | `[ ]` |
| CRM-072 | Journal d'audit consultable et conformité RGPD | `[ ]` |
| CRM-073 | Webhooks sortants signés et jetons d'API | `[ ]` |
| CRM-074 | Aperçu des pièces jointes et extraction de texte | `[ ]` |
| CRM-075 | Snooze des fils et des cards | `[ ]` |

---

## Propositions en attente d'arbitrage

Ces unités ne sont **pas planifiées**. Elles ont été proposées au responsable et attendent sa
décision. Aucune ne démarre sans arbitrage explicite.

| Unité | Proposition | État |
|---|---|---|
| CRM-P01 | Anti-double-prospection : alerte si un contact ou un domaine est déjà suivi ailleurs | `[ ]` |
| CRM-P02 | Score de santé de card et tri « cards à risque » | `[ ]` |
| CRM-P03 | Corbeille et restauration sur cards, tracks et channels | `[ ]` |
| CRM-P04 | Versionnement des workflows et plan de remappage | `[ ]` |
| CRM-P05 | Détection et fusion des doublons de contacts | `[ ]` |
| CRM-P06 | Flux ICS abonnable des prochaines actions | `[ ]` |
| CRM-P07 | Rapport hebdomadaire automatique aux administrateurs | `[ ]` |
| CRM-P08 | Écran de revue de pipeline pour les réunions | `[ ]` |
| CRM-P09 | Internationalisation FR/EN dès l'origine | `[ ]` |
| CRM-P10 | Onboarding guidé au premier lancement | `[ ]` |
| CRM-P11 | Sauvegarde chiffrée planifiée et restauration testée | `[ ]` |
| CRM-P12 | Enrichissement automatique des contacts (à évaluer au regard du RGPD) | `[ ]` |

**Note sur `CRM-P04`** : l'archivage d'un nœud occupé est déjà refusé par `CRM-030`, ce qui traite
le cas le plus dangereux. L'unité complète reste ouverte pour les cas de remappage volontaire.

**Note sur `CRM-P09`** : plus l'internationalisation est ajoutée tard, plus elle coûte cher. Si
elle est retenue, elle doit précéder `CRM-007`.

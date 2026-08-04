# Master plan — P2Enjoy CRM

**Index d'exécution autoritatif.** Les commentaires de traçabilité `@spec` / `@verifies` du code
citent une unité de ce plan et le ou les chapitres documentaires correspondants.

L'état réel de chaque unité, avec sa Definition of Done détaillée, est tenu dans
`docs/BACKLOG.md`. Ce document donne l'**ordre** et les **règles d'avancement** ; il ne duplique
pas le détail des unités.

---

## 1. Règles d'avancement

1. **Une seule unité à la fois**, menée jusqu'à son terme. Aucun `[~]` laissé derrière soi avant
   d'ouvrir l'unité suivante.
2. **La documentation précède le code.** Une unité dont la spécification n'est pas écrite et
   committée ne peut pas commencer.
3. **Un chunk = un commit cohérent**, poussé immédiatement, contenant le code, ses tests et sa
   documentation.
4. **Aucune unité ne passe `[x]` sans ses preuves** : test unitaire dédié, test API ou
   d'intégration dédié, test E2E dédié, vérification visuelle observée si l'interface est
   touchée, seed mis à jour, documentation à jour.
5. **Les preuves d'autorisation contournent l'interface** : requête directe avec le jeton réel du
   profil, prouvant le refus (voir `docs/SPEC-permissions-rls.md` §7).
6. **Pas de branche, pas de worktree.** Tout se fait sur `main`, en synchronisant avant de
   clore une unité.
7. **Aucun commit n'est attribué à un agent** : auteur et committer sont ceux du responsable,
   sans trailer de co-paternité ni mention d'outil (`CLAUDE.md` §13).

## 2. Ordre d'exécution

```
Chunk 1  DOCUMENTATION           CRM-000                    [x]
Chunk 2  INFRASTRUCTURE          CRM-001 → CRM-014
Chunk 3  CRM UTILISABLE          CRM-020 → CRM-047
Chunk 4  MESSAGERIE              CRM-050 → CRM-059
Chunk 5  EXTENSIONS              CRM-060 → CRM-075
         PROPOSITIONS            CRM-P01 → CRM-P12  (en attente d'arbitrage)
```

L'application est **utilisable à la fin du chunk 3**. Le chunk 4 ajoute la messagerie, qui est la
fonctionnalité différenciante mais aussi la plus risquée techniquement.

### Ordre détaillé et justification

| Étape | Unités | Pourquoi à ce moment |
|---|---|---|
| 2.a | `CRM-001` → `CRM-004` | Rien n'est vérifiable tant que la pile ne démarre pas. `CRM-004` tranche la question de Vault avant tout code qui en dépend. |
| 2.b | `CRM-010` → `CRM-014` | Le modèle d'autorisation est la fondation : le construire après coup impose de tout reprendre. |
| 2.c | `CRM-005` → `CRM-008` | Seed, types et harnais de tests : l'outillage qui rend les unités suivantes vérifiables. |
| 3.a | `CRM-020`, `CRM-021` | L'arborescence conditionne tout le reste. |
| 3.b | `CRM-030` → `CRM-034` | Le moteur de workflow avant les cards, car une card naît dans une étape. |
| 3.c | `CRM-035` → `CRM-037` | Le form composer s'appuie sur les étapes. |
| 3.d | `CRM-040` → `CRM-047` | Les cards et leurs vues, puis le seed de démonstration complet. |
| 4 | `CRM-050` → `CRM-059` | Messagerie : infrastructure mail, puis ingestion, puis interface, puis envoi. |
| 5 | `CRM-060` → `CRM-075` | Extensions, chacune indépendamment livrable. |

**Contraintes d'ordre à ne pas enfreindre :**

- `CRM-004` (décision Vault) précède `CRM-052` et `CRM-053`.
- `CRM-034` (`move_card`) précède `CRM-041` (glisser-déposer) : l'interface ne peut pas précéder
  la garde qu'elle exerce.
- `CRM-036` (validation des champs) précède `CRM-037` (rendu du formulaire).
- `CRM-054` (ingestion) précède `CRM-055` (classement) et `CRM-056` (dossiers).
- `CRM-060` (contacts) précède `CRM-055` pour la règle de suggestion par contact connu ; si
  `CRM-060` n'est pas encore livré, la règle 3 du classement est inactive et documentée comme
  telle, plutôt qu'approximée.
- `CRM-066` (analytique) exige le catalogue de nœuds partagé livré en `CRM-030`.

## 3. Correspondance unité → documents

Les commentaires `@spec` citent au minimum l'unité et le chapitre applicable :

| Domaine | Documents à citer |
|---|---|
| Migrations et schéma | `docs/SCHEMA.md` (chapitre concerné) |
| Autorisations, RLS | `docs/SPEC-permissions-rls.md` |
| Tracks et channels | `docs/SPEC-tracks.md`, `docs/SPEC-channels.md` |
| Catalogue de nœuds, workflows, transitions | `docs/SPEC-workflow-engine.md` (§2 pour le catalogue) |
| Formulaires conditionnels | `docs/SPEC-form-composer.md` |
| Cards, adresse générée, archivage et corbeille | `docs/SPEC-cards.md` |
| Messagerie | `docs/SPEC-mail-subsystem.md` |
| Squelette de la webapp, coquille, états | `docs/SPEC-webapp.md` |
| Données de développement, seed | `docs/SPEC-seed.md` |
| Types TypeScript générés | `docs/SPEC-types.md` |
| Harnais de tests, exécuteurs, projets Playwright | `docs/SPEC-test-harness.md` |
| Interface | `docs/DESIGN_SYSTEM.md` |
| Architecture, services, déploiement | `docs/DAT.md` |
| Fonctionnalité visible | `docs/manual.md` (chapitre concerné) |

Exemple attendu en tête de fichier :

```sql
-- @spec CRM-034 (docs/BACKLOG.md) — garde centrale de transition
-- @spec docs/SPEC-workflow-engine.md §5 ; docs/SCHEMA.md §3, §9
```

```ts
// @verifies CRM-034 (docs/BACKLOG.md) — refus des transitions non déclarées
// @verifies docs/SPEC-workflow-engine.md §5, §8 ; docs/SPEC-permissions-rls.md §7
```

## 4. Definition of Done commune

Une unité est `[x]` lorsque **toutes** les conditions applicables sont satisfaites :

- comportement implémenté et conforme à sa spécification ;
- règles d'accès appliquées côté backend et **prouvées par un test hors interface** ;
- test unitaire dédié vert ;
- test API ou d'intégration dédié vert ;
- test E2E dédié vert ;
- build réussi ;
- interface vérifiée visuellement, captures produites **et observées** ;
- seed mis à jour pour démontrer la fonctionnalité ;
- `README.md`, `docs/DAT.md`, `docs/SCHEMA.md`, `docs/DESIGN_SYSTEM.md`, `docs/manual.md` mis à
  jour si concernés ;
- `CHANGELOG.md` complété sous `[Non publié]` ;
- `docs/PROD_MIGRATIONS.md` mis à jour si le schéma, les services ou les variables changent ;
- commentaires `@spec` / `@verifies` présents et exacts ;
- modifications distantes récupérées, tests rejoués après synchronisation ;
- commit créé **et poussé**.

Si une seule preuve manque, l'unité reste `[~]` et la limite est nommée explicitement.

## 5. Journalisation des décisions

Toute décision de conception, tout arbitrage et toute contradiction relevée sont consignés
**immédiatement** :

- décision et son motif → `docs/JOURNAL.md` ;
- contradiction ou référence manquante → `docs/INCONSISTENCY_REPORT.md`, sans résolution
  implicite ;
- opération manuelle de déploiement → `docs/PROD_MIGRATIONS.md`.

Une décision qui n'existe que dans un historique de conversation est une décision perdue.

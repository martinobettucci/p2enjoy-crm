# Changelog

Toutes les modifications notables du projet sont consignées ici.

Deux sections structurent ce fichier :

- **[Non publié]** — ce qui existe dans le code courant mais n'est **pas encore déployé et
  vérifié en production** ;
- **[Publié]** — uniquement ce qui est réellement actif et vérifié en production.

Un changement n'est jamais déclaré publié tant que la production n'a pas été constatée en train
d'exécuter le code attendu.

## [Non publié]

### Ajouté

- Amorçage du dépôt : `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24).
- Documentation de référence complète, rédigée et committée **avant tout code**, conformément à
  la règle de persistance immédiate des décisions :
  - `README.md` — objectif, stack, prérequis, commandes, variables, structure, limites connues ;
  - `docs/DAT.md` — architecture technique, composants, flux, déploiement, compromis ;
  - `docs/SCHEMA.md` — modèle de données complet et contraintes ;
  - `docs/DESIGN_SYSTEM.md` — charte P2Enjoy appliquée au CRM, tokens, composants, accessibilité ;
  - `docs/SPEC-workflow-engine.md` — catalogue de nœuds partagé, workflows dérivables par track,
    transitions contraintes appliquées côté base ;
  - `docs/SPEC-form-composer.md` — champs conditionnels par étape et validation au moment de la
    transition ;
  - `docs/SPEC-mail-subsystem.md` — comptes entrants IMAP et identités sortantes SMTP découplés,
    classement des messages, dossiers imbriqués, file d'envoi résiliente ;
  - `docs/SPEC-permissions-rls.md` — rôles, politiques RLS et preuves de refus exigées ;
  - `docs/MASTER_PLAN.md` — index d'exécution autoritatif référencé par les commentaires `@spec` ;
  - `docs/BACKLOG.md` — unités `CRM-NNN` avec leur Definition of Done ;
  - `docs/JOURNAL.md` — décisions de conception et leurs justifications ;
  - `docs/PROD_MIGRATIONS.md` — contrat de déploiement et prérequis manuels ;
  - `docs/manual.md` — manuel utilisateur ;
  - `docs/INCONSISTENCY_REPORT.md` — registre des contradictions en attente d'arbitrage.

### Notes

- Aucun code applicatif, aucune migration et aucun conteneur n'est livré à ce stade. Les
  commandes décrites dans le `README.md` constituent un contrat à honorer, pas un état constaté.

## [Publié]

_Rien à publier pour le moment._

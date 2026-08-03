# Registre des contradictions et points ouverts

Consigne les contradictions, références manquantes et hypothèses non vérifiées relevées pendant
la conception ou l'implémentation. **Rien n'est résolu implicitement** : tant qu'un point est
ouvert, le comportement reste inchangé et l'arbitrage du responsable est sollicité lorsque la
correction dépasse la tâche autorisée.

Une entrée est close lorsque la décision est prise, consignée dans `docs/JOURNAL.md`, et
répercutée dans les documents concernés.

---

## Ouverts

### INC-001 — Disponibilité de `supabase_vault` et `pg_cron` non vérifiée

**Nature :** hypothèse non vérifiée, bloquante.
**Relevé le :** 2026-08-03.

L'architecture prévoit de chiffrer les mots de passe IMAP/SMTP avec Supabase Vault. La présence
de l'extension `supabase_vault` dans l'image PostgreSQL retenue n'a **pas** été constatée : seule
la présence de `pg_net` l'a été, dans les scripts d'initialisation de la pile voisine. Il en va
de même pour `pg_cron`.

**Comportement en attendant :** aucun code de messagerie n'est écrit. Repli documenté si Vault
est absent : chiffrement `pgcrypto` avec une clé dédiée fournie par l'environnement, et fonctions
d'accès réservées à `service_role`. Pour `pg_cron`, le contournement est déjà acté : l'ordonnancement
vit dans `mail-sync` (voir `docs/JOURNAL.md`, décision 8).

**Résolution attendue :** unité `CRM-004`, avec la sortie de commande consignée.

---

### INC-002 — Messages entrants sans `Message-ID`

**Nature :** cas limite non tranché.
**Relevé le :** 2026-08-03.

Le dédoublonnage repose sur `(workspace_id, rfc822_message_id)`. Certains expéditeurs non
conformes n'émettent pas d'en-tête `Message-ID`, ce qui rendrait la clé nulle et le dédoublonnage
inopérant — un même message serait alors inséré autant de fois qu'il existe de boîtes le
recevant.

**Proposition :** empreinte de repli `sha256(from_addr + date + subject + taille du corps)`,
préfixée pour la distinguer d'un identifiant véritable.

**Risque résiduel :** deux messages réellement distincts et rigoureusement identiques sur ces
quatre critères seraient fusionnés. Jugé improbable, mais non nul.

**Comportement en attendant :** proposition retenue par défaut dans
`docs/SPEC-mail-subsystem.md` §4.2, en attente de validation du responsable.

---

### INC-003 — Transition « Réalisation → Perdu » non déclarée

**Nature :** règle métier à confirmer.
**Relevé le :** 2026-08-03.

Le workflow par défaut déclare un passage vers « Perdu » depuis Prospection, Relance, Négociation
et Signature, mais **pas** depuis Réalisation. Une affaire signée puis abandonnée en cours de
réalisation n'a donc aucun chemin vers « Perdu ».

**Deux lectures possibles :** soit c'est voulu — un projet signé qui échoue relève d'un autre
traitement (avenant, litige) —, soit c'est un oubli.

**Comportement en attendant :** transition non déclarée. Le workflow étant une donnée, un
administrateur peut l'ajouter sans modification de code.

---

### INC-004 — Politique face aux expéditeurs inconnus

**Nature :** décision de sécurité à confirmer.
**Relevé le :** 2026-08-03.

L'adresse email d'une card circule dans les messages : elle est donc publique de fait. N'importe
qui la connaissant peut déposer du contenu dans une card.

**Comportement retenu par défaut :** tout accepter, signaler les expéditeurs inconnus, et surtout
**ne rien déclencher automatiquement** — un message reçu n'entraîne aucune transition, aucune
autorisation, aucune action. Le risque se limite donc à du bruit et à du stockage.

**Alternative non retenue :** restreindre l'ingestion aux expéditeurs connus, au prix de perdre
les premiers contacts entrants, qui sont précisément la matière première d'un CRM de prospection.

**En attente :** confirmation du responsable. Mesures de bornage déjà spécifiées : taille
maximale des pièces jointes, analyse antivirale, aucune exécution de contenu.

---

### INC-005 — Écart assumé : copie de workflow contre surcharge

**Nature :** écart documenté à une convention générale.
**Relevé le :** 2026-08-03.

`CLAUDE.md` §4 demande que « tout existe par défaut au niveau général, puis les contextes
spécialisés ne définissent que leurs différences ». Le responsable a explicitement demandé de
**copier** un workflow global dans un track pour l'y modifier, ce qui produit une duplication et
non une surcharge.

**Résolution appliquée :** l'instruction explicite du responsable prime (`CLAUDE.md` §26,
priorité 2 sur priorité 8). L'écart est compensé par la traçabilité de l'origine
(`derived_from_workflow_id`, `derived_at`) et par un signalement de divergence dans l'interface.

**Statut :** ouvert pour information, aucune action attendue. Sera clos si le responsable
confirme.

---

### INC-006 — Pile de référence `../starter.2025.12/` introuvable dans l'environnement d'exécution

**Nature :** référence absente, contournée sans arbitrage.
**Relevé le :** 2026-08-03, pendant `CRM-001`.

`docs/BACKLOG.md` décrit `CRM-001` comme la « copie de la pile éprouvée
(`../starter.2025.12/supabase/docker/`) », et `docs/JOURNAL.md` s'appuie sur son inspection. Or
la routine cloud travaille sur un conteneur où **seul** le dépôt `p2enjoy-crm` est cloné : le
répertoire voisin n'existe pas et n'est pas accessible.

```
$ ls -la /home/user/
drwxr-xr-x 3 root root 4096 .
drwxr-xr-x 5 root root 4096 ..
drwxr-xr-x 4 root root 4096 p2enjoy-crm
```

**Comportement retenu :** la pile a été assemblée à partir de la distribution self-hosted
**officielle** de Supabase (`supabase/supabase`, répertoire `docker/`), avec versions épinglées,
et non à partir de la pile voisine. Les fichiers d'initialisation repris portent la mention de
leur origine.

**Risque résiduel :** si `../starter.2025.12/` contenait des adaptations maison (réglages
PostgreSQL, correctifs, versions volontairement figées à un autre niveau), elles sont **absentes**
de la pile livrée, sans que la routine puisse le constater.

**Arbitrage attendu du responsable :** confirmer que la pile officielle épinglée convient, ou
fournir les écarts de `starter.2025.12` à reporter. Tant que ce point est ouvert, aucune
divergence n'est supposée ni inventée.

---

### INC-007 — `supabase/functions/` référencé sans composant correspondant

**Nature :** référence documentaire sans contrepartie architecturale.
**Relevé le :** 2026-08-03, pendant `CRM-001`.

`README.md` §10 annonce un répertoire `supabase/functions/` décrit comme « Edge functions Deno ».
Or :

- `docs/DAT.md` §3 ne liste **aucun** composant de fonctions edge ;
- `docs/DAT.md` §6 n'expose **aucune** interface de ce type ;
- **aucune** unité de `docs/BACKLOG.md` ne prévoit d'en écrire.

**Comportement en attendant :** le service `edge-runtime` n'est **pas** déployé et la route
`/functions/v1/` n'est **pas** déclarée dans la passerelle. Ni le `README.md` ni le `DAT.md` ne
sont modifiés pour faire disparaître la contradiction : elle est consignée ici.

**Arbitrage attendu du responsable :** soit les fonctions edge entrent au périmètre et reçoivent
une unité de backlog, soit la mention est retirée du `README.md` §10.

---

## Clos

*Aucune entrée close à ce jour.*

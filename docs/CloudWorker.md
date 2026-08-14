# CloudWorker

Prompt de la tâche planifiée « CloudWorker », exécutée automatiquement toutes les
heures sur ce dépôt.

Ce document conserve le texte intégral du prompt, afin qu'une consigne récurrente ne
dépende pas de la seule mémoire de contexte d'un agent.

---

Tu travailles sur le dépôt "p2enjoy-crm".

## 0. TU DOIS COMMITTER ET POUSSER, SINON TOUT EST PERDU

LIS CECI EN PREMIER, C'EST LA RÈGLE QUI CONDITIONNE TOUTES LES AUTRES.

Cette tâche s'exécute toutes les heures, et CHAQUE EXÉCUTION PART D'UN CHECKOUT NEUF. Ta session n'est pas conservée. Tout ce que tu écris sans le POUSSER sur "origin/main" est définitivement perdu à la fin de ta session, et l'exécution suivante repartira exactement du même point pour refaire exactement le même travail. Une boucle qui ne pousse pas n'avance jamais.

En conséquence, et sans exception :

- Committe et pousse au fil de l'eau, pas seulement à la fin : dès qu'un morceau cohérent tient debout, par exemple une spécification écrite, une migration qui s'applique ou une preuve qui passe, tu committes et tu pousses. Ta session peut être interrompue à tout instant.
- Ne termine JAMAIS ta session sur du travail non poussé.
- Ne termine JAMAIS ta session sur une branche autre que "main".
- Ne termine JAMAIS ta session en HEAD détaché.
- Avant de conclure, exécute obligatoirement :

```
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

La session ne peut être considérée comme terminée que si :

```
git branch --show-current  => main
git status --short         => sortie vide
git log origin/main..HEAD  => sortie vide
```

Si l'une de ces trois conditions est fausse, tu n'as PAS terminé. Corrige l'état Git, committe si nécessaire, pousse sur "origin/main", puis vérifie à nouveau.

Si tu n'as pas le temps de finir une unité, ce n'est pas grave : committe et pousse l'état intermédiaire cohérent, mets à jour "docs/BACKLOG.md" pour dire exactement où tu en es et ce qui reste, et pousse. C'est la seule façon dont l'exécution suivante pourra reprendre là où tu t'es arrêté.

Si "git push" échoue, récupère et rejoue :

```
git fetch origin
git pull --rebase origin main
```

Résous les conflits SUR PLACE, puis pousse.

Ne renonce jamais à pousser, et ne contourne jamais un conflit par une branche.

## 1. BRANCHE : QUEL QUE SOIT L'ÉTAT INITIAL, TU DOIS TRAVAILLER ET FINIR SUR "main"

L'environnement peut démarrer dans n'importe lequel de ces états :

- HEAD détaché ;
- branche "main" ;
- branche temporaire créée par l'infrastructure ;
- branche portant un nom inconnu.

C'est NORMAL.

AUCUN de ces états n'est une raison de t'arrêter.

La branche de démarrage n'est qu'un état technique fourni par l'infrastructure. Elle ne définit jamais la branche sur laquelle tu dois travailler.

Ton objectif Git est invariant :

1. préserver tout éventuel travail local qui ne serait pas encore présent sur "origin/main" ;
2. rattacher le dépôt à la branche locale "main" ;
3. synchroniser "main" avec "origin/main" ;
4. effectuer tout le travail exclusivement sur "main" ;
5. pousser tout travail sur "origin/main" ;
6. terminer obligatoirement avec HEAD attaché à "main".

### 1.1. INITIALISATION GIT OBLIGATOIRE

Ton PREMIER geste dans le dépôt est :

```
git fetch origin main
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

Ces commandes servent à DIAGNOSTIQUER l'état initial.

La sortie de :

```
git branch --show-current
```

est informative uniquement.

Une branche différente de "main" ne doit JAMAIS provoquer l'arrêt de la session.

### 1.2. MODIFICATIONS NON COMMITTÉES PRÉSENTES AU DÉMARRAGE

Si :

```
git status --short
```

n'est pas vide, considère ces modifications comme potentiellement importantes.

Ne les détruis JAMAIS avec :

```
git reset --hard
git clean
git checkout -- .
git restore .
```

ou toute autre commande destructrice équivalente.

Préserve-les temporairement avec :

```
git stash push -u -m "sauvegarde-etat-initial-worker"
```

Puis poursuis la procédure de rattachement à "main".

Une fois correctement positionné sur "main", restaure immédiatement :

```
git stash pop
```

En cas de conflit, résous les conflits SUR "main".

Committe ensuite le travail récupéré et pousse-le sur "origin/main".

### 1.3. AUCUN COMMIT LOCAL À SAUVER

Si :

```
git log origin/main..HEAD --oneline
```

est vide, aucun commit spécifique à l'état initial n'a besoin d'être conservé.

Peu importe que tu sois actuellement :

- en HEAD détaché ;
- sur "main" ;
- sur une branche temporaire ;
- sur une branche quelconque créée par l'infrastructure.

Rattache immédiatement le dépôt à "main" :

```
git checkout -B main origin/main
git pull --rebase origin main
```

Puis vérifie :

```
test "$(git branch --show-current)" = "main"
```

Si cette vérification échoue, corrige l'état Git.

Tu ne commences aucune tâche métier tant que :

```
git branch --show-current
```

ne renvoie pas exactement :

```
main
```

### 1.4. DES COMMITS LOCAUX EXISTENT AU-DESSUS DE "origin/main"

Si :

```
git log origin/main..HEAD --oneline
```

n'est PAS vide, ces commits constituent du travail potentiellement réel qu'une exécution précédente ou que l'environnement n'a pas encore poussé.

C'est une urgence.

Tu dois sauver ces commits AVANT :

- de lire le backlog ;
- de démarrer Docker ;
- de modifier un fichier ;
- de commencer une nouvelle unité.

Rattache ces commits à "main" :

```
git checkout -B main HEAD
git pull --rebase origin main
git push -u origin main
```

En cas de conflit pendant le rebase :

1. résous les conflits dans le dépôt courant ;
2. ajoute les fichiers résolus avec "git add" ;
3. poursuis avec :

```
git rebase --continue
```

4. répète jusqu'à la fin du rebase ;
5. pousse sur "origin/main".

Tu ne commences RIEN d'autre tant que :

```
git log origin/main..HEAD --oneline
```

n'est pas vide.

Après récupération, vérifie :

```
git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

Le résultat attendu est :

```
branche : main
status : vide
commits locaux non poussés : aucun
```

Mentionne dans ton compte rendu final tout travail antérieur que tu as dû récupérer.

### 1.5. RÈGLES ABSOLUES DE BRANCHE

Une fois l'initialisation terminée :

- Travaille EXCLUSIVEMENT sur "main".
- Tout commit est créé sur "main".
- Tout push est effectué vers "origin/main".
- INTERDIT de créer une branche de travail.
- INTERDIT de conserver volontairement du travail sur une branche temporaire fournie par l'environnement.
- INTERDIT de terminer simplement parce que le worker a démarré sur une branche différente de "main".
- INTERDIT de terminer en HEAD détaché.
- INTERDIT de terminer sur une autre branche que "main".
- INTERDIT de contourner un conflit en créant une autre branche.
- INTERDIT de créer un worktree ou un environnement Git parallèle.

Les commandes suivantes sont interdites lorsqu'elles servent à créer une branche parallèle :

```
git checkout -b <branche>
git switch -c <branche>
git branch <branche>
git worktree add ...
```

"git checkout -B main ..." est EXPRESSÉMENT autorisé, car il sert à rattacher ou repositionner la branche obligatoire "main".

### 1.6. IDENTITÉ GIT

Un crochet "pre-commit" REFUSE tout commit qui n'est pas au nom du responsable.

Pose l'identité avant ton premier commit :

```
git config user.name "P2Enjoy"
git config user.email "contact@p2enjoy.studio"
```

N'ajoute JAMAIS de trailer :

```
Co-Authored-By
```

ni de mention :

```
Generated with
```

ni de signature d'outil.

Les messages de commit sont en français et décrivent uniquement le changement.

### 1.7. GARDE DE FIN DE SESSION OBLIGATOIRE

Cette procédure est une CONDITION DE TERMINAISON, pas une recommandation.

Juste avant toute réponse finale, toute conclusion ou toute fin d'exécution, exécute :

```
CURRENT_BRANCH="$(git branch --show-current)"

if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout main 2>/dev/null || git checkout -B main HEAD
fi

git fetch origin main

if [ -n "$(git log origin/main..HEAD --oneline)" ]; then
  git pull --rebase origin main
  git push origin main
fi

git branch --show-current
git status --short
git log origin/main..HEAD --oneline
```

La session ne peut être considérée comme terminée que si les trois conditions suivantes sont simultanément vraies :

```
git branch --show-current  => main
git status --short         => sortie vide
git log origin/main..HEAD  => sortie vide
```

Si une seule de ces conditions est fausse, TU N'AS PAS TERMINÉ.

Corrige l'état Git avant de produire ta réponse finale.

## 2. TU ES ROOT, ET TU DOIS DÉMARRER DOCKER TOI-MÊME

Cet environnement DISPOSE de Docker, mais le démon n'est PAS lancé au démarrage.

Tu es root : c'est à toi de le lancer.

La procédure est déjà mesurée et consignée dans "docs/JOURNAL.md". Ne la redécouvre pas.

"service docker start" ÉCHOUE sur :

```
ulimit: Operation not permitted
```

l'hôte étant privé de "CAP_SYS_RESOURCE".

N'insiste pas sur cette voie.

Lance le démon DIRECTEMENT, en arrière-plan :

```
dockerd --host=unix:///var/run/docker.sock > /tmp/dockerd.log 2>&1 &
```

Attends qu'il réponde. Boucle sur :

```
docker info
```

jusqu'au succès, avec un plafond raisonnable de tentatives.

Puis vérifie avec :

```
docker ps
```

### 2.1. PROXY TLS INTERPOSÉ

Les deux chaînes de construction en souffrent, et le contournement est CÂBLÉ depuis la décision 356.

Le paquet CA de l'environnement est :

```
/root/.ccr/ca-bundle.crt
```

Exporte :

```
export NPM_CA_FILE=/root/.ccr/ca-bundle.crt
export PIP_CA_FILE=/root/.ccr/ca-bundle.crt
```

Sans ces variables :

```
npm ci
```

peut échouer avec :

```
SELF_SIGNED_CERT_IN_CHAIN
```

et :

```
pip install
```

peut échouer avec :

```
CERTIFICATE_VERIFY_FAILED
```

"runDev.sh" s'arrêterait alors avant de démarrer le moindre service.

### 2.2. DÉMARRAGE DE LA PILE

Ensuite seulement :

```
./runDev.sh
```

Le premier démarrage peut être long, notamment à cause de la construction et du téléchargement des images.

Puis applique obligatoirement le seed :

```
supabase/seed/apply-seed.sh
```

Le seed n'est PAS appliqué par "runDev.sh".

Sans lui, aucun compte de démonstration ne se connecte.

Vérifie ensuite :

```
docker compose ps
```

Les 18 services doivent être "healthy" avant de lancer les preuves qui nécessitent la pile.

### 2.3. PREUVES À EXÉCUTER

La pile debout, tu DOIS exécuter les vraies preuves applicables :

```
npm run test:sql
npm run e2e:api
npm run e2e:ui
npm run e2e:mail
npm run test:unit
npm run typecheck
npm run build
pytest
```

ainsi que les harnais :

```
scripts/verify-*.sh
```

Les captures des preuves d'interface sont produites ET OBSERVÉES conformément à "CLAUDE.md", section 16.

### 2.4. ÉTABLIS TOUJOURS UNE LIGNE DE BASE

Ne conclus jamais à une régression avant d'avoir établi la ligne de base.

Plusieurs harnais peuvent rendre des anomalies PRÉEXISTANTES et étrangères à ton changement.

Certaines sont liées à cet environnement.

Exemple : tu es "root", donc :

```
[ -r fichier ]
```

peut être vrai même sur un fichier :

```
chmod 000
```

Le proxy peut également faire échouer certains contrôles qui reconstruisent une image SANS certificat.

Pour comparer proprement :

```
git stash -u
```

rejoue le harnais sur la ligne de base, puis :

```
git stash pop
```

et compare les deux bilans.

### 2.5. SI LA PILE NE MONTE PAS

Si la pile refuse de monter, ne fais pas semblant.

Consigne précisément :

- la commande qui a échoué ;
- l'erreur observée ;
- ce qui a pu être vérifié malgré l'échec.

Rabats-toi sur ce qui se vérifie sans pile :

- spécifications ;
- journal ;
- backlog ;
- manuel ;
- code ;
- tests unitaires ;
- "typecheck" ;
- "build" ;
- toute autre preuve indépendante de la pile.

Laisse alors les unités concernées en "[~]".

Liste précisément les preuves qui restent à exécuter.

Et pousse quand même tout travail cohérent effectué.

## 3. CE QUE TU DOIS FAIRE

Lis INTÉGRALEMENT "CLAUDE.md" à la racine et applique ses règles à la lettre.

Elles priment sur tes habitudes.

Lis ensuite :

```
README.md
CHANGELOG.md
docs/BACKLOG.md
docs/JOURNAL.md
```

ainsi que les documents de "docs/" utiles à l'unité traitée.

Objectif permanent : faire progresser "docs/BACKLOG.md" vers 100 %, sans exception à la Definition of Done et sans raccourci.

Traite UNE unité cohérente à la fois, séquentiellement.

Ne délègue pas à des sous-agents.

Éprouve les parcours comme un vrai utilisateur, au clavier et à la souris.

La console du navigateur doit rester VIERGE de toute erreur et de tout avertissement.

### 3.1. RÈGLES DE "CLAUDE.md" SYSTÉMATIQUEMENT OUBLIÉES

Toute décision, spécification ou arbitrage validé est écrit ET COMMITTÉ AVANT la première ligne de code.

Si le code n'est pas encore prêt, crée un commit documentaire dédié.

Chaque fichier porte ses commentaires :

```
@spec
@verifies
```

vers l'unité de backlog et les chapitres de spécification correspondants.

Une unité ne passe à "[x]" que si TOUTES ses preuves sont réellement exécutées et vertes.

Sinon elle reste "[~]" et l'écart est nommé.

Ne masque jamais une erreur par :

- un "try/catch" vide ;
- une valeur par défaut trompeuse ;
- un test désactivé ;
- une temporisation arbitraire ;
- un contournement destiné uniquement à rendre une preuve verte.

N'annonce JAMAIS une preuve que tu n'as pas exécutée.

Emploie les formulations du paragraphe 25 de "CLAUDE.md" :

```
implémenté et vérifié
implémenté mais non vérifié en E2E
bloqué par une dépendance
nécessite une action humaine
```

Quand une preuve devient rouge parce que la RÈGLE a changé par arbitrage, tu RÉVISES cette preuve en expliquant pourquoi dans le fichier lui-même.

Tu ne la supprimes pas et tu ne la contournes pas.

Quand tu trouves un défaut ÉTRANGER à ton unité, consigne-le dans :

```
docs/INCONSISTENCY_REPORT.md
```

avec sa mesure.

Laisse le comportement inchangé plutôt que de corriger ce défaut au passage.

## 4. COMMENT TU DÉTERMINES CE QU'IL RESTE À FAIRE

Ce prompt ne contient DÉLIBÉRÉMENT aucun état du projet, et n'en contiendra jamais.

Tout instantané écrit ici, par exemple :

- une liste d'unités ;
- un numéro d'entrée ;
- « il reste ceci à faire » ;
- une estimation de progression ;

serait potentiellement faux dès l'exécution suivante.

Cela pourrait te faire refaire du travail déjà livré ou sauter du travail dû.

Les fichiers de suivi du dépôt font foi, et eux seuls.

Tu les relis à CHAQUE exécution.

### 4.1. ORDRE DE LECTURE

1. "docs/JOURNAL.md", sa DERNIÈRE entrée d'abord.

Elle dit ce que l'exécution précédente a fait, ce qu'elle a mesuré, et se termine par où reprendre.

C'est ton point de départ avant même le backlog.

2. "docs/BACKLOG.md".

C'est l'état réel des unités :

```
[ ]  non commencée
[~]  en cours ou insuffisamment prouvée
[x]  close et intégralement prouvée
```

Chaque unité porte sa Definition of Done.

3. "docs/INCONSISTENCY_REPORT.md", section "Ouverts".

Ce fichier contient notamment :

- les défauts constatés ;
- les arbitrages rendus mais pas encore livrés ;
- les sujets qui attendent une décision humaine.

Une entrée arbitrée mais non livrée est du travail dû.

Une entrée qui attend un arbitrage du responsable ne se tranche JAMAIS toi-même.

Tu ne fais qu'y consigner ce que tu observes.

4. "docs/MASTER_PLAN.md".

Il définit l'ordre d'exécution et la Definition of Done commune.

### 4.2. COMMENT CHOISIR L'UNITÉ DE LA SESSION

Si le journal ou le registre désigne explicitement une reprise, tu la suis.

Un ordre de solde décidé par un arbitrage prime sur ta propre appréciation.

À défaut, solder une unité "[~]" prime sur l'ouverture d'une unité "[ ]".

Une unité livrée mais non prouvée constitue une dette qui grandit.

Le projet ne progresse pas en accumulant les chantiers ouverts.

À défaut encore, prends la première unité "[ ]" dans l'ordre du plan.

Une seule unité par session, menée aussi loin que possible.

Mieux vaut une unité réellement close que trois unités entamées.

### 4.3. COMMENT TERMINER LA SESSION

Avant la fin de chaque session :

1. écris dans "docs/JOURNAL.md" une entrée datée disant :

   - ce que tu as mesuré ;
   - ce que tu as modifié ;
   - ce que tu as vérifié ;
   - ce qui a échoué ;
   - où tu t'arrêtes ;
   - où l'exécution suivante doit reprendre ;

2. mets "docs/BACKLOG.md" au véritable état de l'unité ;

3. nomme précisément les preuves qui restent à exécuter ;

4. committe ces mises à jour ;

5. pousse sur "origin/main" ;

6. exécute la garde Git finale.

Une session qui finit sans mettre à jour le journal et le backlog condamne potentiellement la suivante à redécouvrir l'état par elle-même.

## 5. RÈGLE FINALE, AUCUNE EXCEPTION

Rien de ce que tu fais n'existe durablement tant que ce n'est pas poussé sur :

```
origin/main
```

La session n'est terminée que lorsque :

```
git branch --show-current
```

renvoie :

```
main
```

ET que :

```
git status --short
```

ne renvoie rien,

ET que :

```
git log origin/main..HEAD --oneline
```

ne renvoie rien.

Si ce n'est pas le cas, continue à travailler sur l'état Git jusqu'à satisfaire ces trois conditions.

NE PRODUIS PAS TA RÉPONSE FINALE AVANT CELA.

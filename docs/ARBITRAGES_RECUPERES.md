# Arbitrages et décisions récupérés de la branche `claude/happy-goldberg-qt5vfi`

> **Statut : en attente de re-validation du responsable. Rien ici n'est appliqué.**

## Pourquoi ce document existe

Des exécutions parallèles ont produit 41 branches `claude/happy-goldberg-*` sur le
dépôt distant, alors que la consigne du responsable interdit toute création de
branche : le travail devait rester sur `main` exclusivement. Ces branches ont été
supprimées ; l'inventaire figure dans `docs/BRANCHES_SUPPRIMEES.md`.

Quarante de ces branches ne portaient que des réimplémentations parallèles de
travail que `main` porte déjà sous ses propres noms retenus. Une seule,
`claude/happy-goldberg-qt5vfi`, portait des décisions que `main` n'a **jamais**
reçues : dix-huit entrées de journal, dont **cinq arbitrages explicites du
responsable**.

## La collision de numérotation, et pourquoi rien n'est fusionné ici

Les deux lignes ont numéroté leurs décisions en parallèle. Les numéros 235 à 252
désignent des sujets **différents** de chaque côté :

| Numéro | Sur `main` | Sur la branche |
|---|---|---|
| 239 | Le `viewer` n'a pas de boîte mail | L'écran de connexion a son unité `CRM-009` |
| 240 | Trois défauts de mes propres preuves | La session vit en `sessionStorage` |
| 243 | L'écran de connexion rejoint l'authentification | La garde de ports lit `/proc/net/tcp` |

Renuméroter d'office reviendrait à trancher à la place du responsable sur des
décisions qui se contredisent parfois d'une ligne à l'autre. Conformément à
`CLAUDE.md` §5, la contradiction est **consignée** et non résolue : les entrées
sont reproduites **verbatim**, sous une numérotation de récupération `R-01` à
`R-18`, et `docs/JOURNAL.md` n'est pas modifié.

## Ce qui est déjà appliqué sur `main`, et ce qui ne l'est pas

Vérifié par mesure sur l'arbre de `main` :

- **`R-05` (session en `sessionStorage`) et `R-04` (unité de l'écran de connexion)** :
  la décision 243 de `main` — « L'écran de connexion rejoint l'authentification, et
  la session ne dépasse pas l'onglet » — met en œuvre le même comportement. Le
  **geste est appliqué**, la **trace de l'arbitrage** manquait.
- **`R-14` (`require_fields` devient une table de liaison)** : **non appliquée**.
  `docs/SCHEMA.md` de `main` décrit toujours `require_fields` en `uuid[]` et note
  qu'il « ne peut porter **aucune** intégrité référentielle ». C'est exactement ce
  que cet arbitrage renversait.
- Les autres entrées n'ont pas été mesurées une à une et sont reproduites sans
  jugement sur leur application.

## Décision attendue du responsable

Pour chaque entrée : la reprendre dans `docs/JOURNAL.md` sous un numéro neuf, ou
la déclarer caduque. Tant que l'arbitrage n'est pas rendu, aucune ligne de code ne
doit s'appuyer sur ces entrées.

---

## R-01 — Stalwart 0.16 ne se configure plus par un fichier, et l'assemblage doit en tenir compte

*Origine : `Décision 235 — Stalwart 0.16 ne se configure plus par un fichier, et l'assemblage doit en tenir compte` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Problème.** `CRM-050` exige un vrai serveur IMAP/SMTP démarré par `./runDev.sh`, donc configuré
sans intervention humaine. La méthode que le backlog supposait — un fichier de configuration
versionné, comme pour tous les autres services de la pile — n'existe plus dans la version 0.16.

**Mesuré.** Démarré avec un volume `/etc/stalwart` vide, `stalwartlabs/stalwart:v0.16.16` entre en
*bootstrap mode* : il imprime un mot de passe d'administration **aléatoire, affiché une seule
fois**, ouvre le port 8080 et attend qu'un humain termine l'installation dans une interface web.
Cette interface est en outre **indisponible ici** : l'image la télécharge depuis `github.com` au
démarrage, et l'accès sortant du conteneur le refuse — `Failed to unpack application for prefixes:
admin, account`. Aucun des deux points ne se contourne par de la patience : ni l'un ni l'autre
n'est reproductible.

**Ce que la version 0.16 a réellement fait.** La configuration est coupée en deux : un
`/etc/stalwart/config.json` de **106 octets** qui ne porte que l'objet `DataStore`, et **tout le
reste dans le magasin de données**, piloté par un plan JSON déclaratif appliqué par
`stalwart-cli apply`. Mesuré : le fichier engendré par un bootstrap réussi tient en une ligne, et
`stalwart-cli snapshot` rend l'état vivant sous la forme exacte que `apply` réingère.

**Décision.** Le dépôt livre `stalwart/config.json` — monté en **lecture seule** — et
`stalwart/plan.json.template`. Le bootstrap n'a donc jamais lieu, l'interface d'administration
n'est jamais requise, et l'état visé est un fichier versionné plutôt qu'un souvenir de clics.
L'administrateur est fixé par `STALWART_RECOVERY_ADMIN`, dont `./runDev.sh` tire le mot de passe au
hasard comme tous les autres secrets de développement.

**Conséquence.** Deux services de plus dans l'overlay de développement : `stalwart-plan`, qui rend
le gabarit avec les valeurs du `.env`, et `stalwart-init`, qui applique le plan. L'image du CLI est
*distroless* — mesuré, elle n'a pas de `sh` — d'où la séparation en deux conteneurs plutôt qu'un
script d'entrée. L'application du plan est **convergente** : `upsert` sur `name` pour les domaines
et les comptes, `reconcile` pour le traceur, qui n'a aucune propriété d'identité et se dupliquerait
sinon à chaque démarrage.

---

## R-02 — Le plan ne déclare aucune écoute réseau, et c'est une contrainte mesurée

*Origine : `Décision 236 — Le plan ne déclare aucune écoute réseau, et c'est une contrainte mesurée` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Ce que je voulais faire.** Déclarer une écoute IMAP en clair sur 143 et une soumission sur 587,
pour que le développement n'ait ni TLS auto-signé ni vérification de pair à désactiver.

**Ce que la mesure a dit.** Les deux écoutes sont bien créées par le plan, `Action/ReloadSettings`
rend `Created Action`, et **le port reste fermé** : `Connection refused`, avant comme après le
rechargement. Une écoute n'est liée qu'au **démarrage suivant** du serveur. Déclarer une écoute
impose donc de redémarrer Stalwart après chaque application du plan — et, au premier démarrage
d'un poste, laisse une fenêtre où le serveur est sain mais muet sur les ports que le produit
attend.

**Ce que la mesure a aussi dit.** Un magasin vierge naît avec **sept écoutes par défaut**, dont
`smtp` (25), `submissions` (465, TLS implicite) et `imaps` (993, TLS implicite). Elles suffisent :
authentification IMAP réussie sur 993 pour les trois boîtes, soumission authentifiée réussie sur
465, et un message adressé à `c-abcd1234@crm.p2enjoy.test` — une adresse de card qui n'existe pas —
reçu dans l'`INBOX` de la boîte système par le catch-all du domaine.

**Décision.** Le plan ne déclare **aucune** écoute. Le développement parle IMAP et SMTP en TLS
implicite avec un certificat auto-signé, et les clients renoncent à vérifier le pair. Le compromis
est écrit dans `docs/SPEC-mail-dev-infra.md` §9.1 plutôt que dissimulé derrière un port en clair
qui n'aurait existé qu'au deuxième démarrage.

**Constat associé, qui n'est pas un défaut :** le port 25 annonce `STARTTLS` et **jamais** `AUTH` —
mesuré, `SMTPNotSupportedError`. C'est le comportement correct d'un MX. Toute expédition
authentifiée passe par 465, et le harnais en fait une preuve plutôt qu'une supposition.

---

## R-03 — Le domaine des cards passe sous un TLD réservé avant d'être réellement délivré

*Origine : `Décision 237 — Le domaine des cards passe sous un TLD réservé avant d'être réellement délivré` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat.** `.env.example` porte `CRM_INBOUND_DOMAIN=crm.exemple.tld` depuis `CRM-002`. La
variable n'était consommée par aucun service : sa valeur n'avait aucune conséquence.

**Ce qui change avec `CRM-050`.** Elle devient le domaine d'un serveur qui **délivre réellement**,
avec un catch-all qui accepte tout destinataire local inconnu. Or `exemple.tld` n'est réservé par
aucune RFC — c'est un domaine que quelqu'un peut posséder — alors que `.test` l'est par la
RFC 2606. Le seed socle avait déjà tranché la même question pour les adresses de ses comptes, et
pour le même motif : un email parti par erreur ne doit pouvoir atteindre personne.

**Décision.** La valeur par défaut devient `crm.p2enjoy.test`, et une seconde variable
`MAIL_TEAM_DOMAIN=p2enjoy.test` porte le domaine des boîtes personnelles. Les deux domaines restent
**distincts**, parce que `docs/SPEC-mail-subsystem.md` §1 pose que le compte entrant d'un
utilisateur et le domaine des cards sont deux objets indépendants : les confondre en développement
rendrait indétectable une erreur de routage que la production exhiberait.

**Conséquence.** Les adresses des deux boîtes personnelles sont exactement celles des comptes du
seed socle — `admin@p2enjoy.test` et `bizdev@p2enjoy.test`. Un développeur n'a pas deux identités à
retenir.

---

## R-04 — Trois défauts trouvés en exécutant le harnais, et les trois étaient les miens

*Origine : `Décision 238 — Trois défauts trouvés en exécutant le harnais, et les trois étaient les miens` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Le premier, dans le harnais lui-même, et il mentait dans le bon sens.** Le contrôle « les
journaux du serveur sont-ils visibles ? » s'écrivait :

```sh
if docker logs p2enjoy-stalwart 2>&1 | grep -q 'Network listener started'; then
```

Sous `set -o pipefail`, `grep -q` **sort au premier motif trouvé**. Le producteur reçoit alors
`SIGPIPE`, la commande de gauche échoue, et le code du tuyau est celui de l'échec : la condition
rend **faux précisément quand le motif est présent**. Mesuré : `docker logs` rendait 174 lignes,
dont sept `Network listener started`, et le contrôle annonçait « aucune ligne de journal ».

C'est le même genre de piège que la décision 234 — une forme d'écriture qui fait dire à un
contrôle l'inverse de ce qu'il mesure — et il est plus vicieux : ici, l'erreur produit un **faux
négatif**, donc un échec visible. Écrit dans l'autre sens (`fail` sur le motif trouvé, comme le
contrôle du bootstrap mode), le même défaut aurait produit un **faux positif**, invisible.

**Conséquence, générale et non locale :** un harnais de ce dépôt ne tuyaute pas une sortie
volumineuse vers `grep -q`. La sortie est lue une fois dans une variable, et la variable est
filtrée. Les cinq occurrences du fichier sont réécrites ainsi, et le motif est expliqué à côté de
la correction.

**Le deuxième, dans le plan déclaratif que je venais d'écrire.** Le traceur était décrit sans
`lossy` ni `multiline`. Or `matchOn: "*"` compare **par valeur** : deux champs manquants suffisent
à rendre l'objet « différent » de celui que le serveur stocke. Mesuré : la deuxième application du
plan rendait encore « 1 destroyed, 1 created » là où un plan convergent doit rendre « 0 destroyed,
0 created ». Le plan détruisait et recréait le traceur à chaque démarrage — sans jamais échouer,
donc sans jamais se signaler. Après correction : `0 destroyed, 6 updated, 0 created`, deux fois de
suite.

**Le troisième, dans la sonde du catch-all.** Elle cherchait le message par
`SEARCH HEADER Message-ID`. Mesuré sur `v0.16.16` : la recherche rend **zéro résultat** alors que
le message est bien dans l'`INBOX` — `SEARCH ALL` le liste, `SEARCH SUBJECT` le trouve. Le harnais
accusait donc le catch-all d'un défaut qui était le sien : les journaux du serveur montraient
`RCPT TO` réécrit en `system@crm.p2enjoy.test` puis `Message ingested`, c'est-à-dire une remise
parfaitement réussie.

La sonde cherche désormais par sujet, avec le même jeton aléatoire — tout aussi discriminant. Le
constat, lui, **n'est pas refermé** : il est consigné au §9.8 de la spécification, parce qu'il
concernera `CRM-054`, dont le dédoublonnage repose précisément sur le `Message-ID`.

**Quatrième constat, qui n'est pas un défaut mais une contrainte.** Le traceur `Stdout`, comme les
écoutes de la décision 236, n'est lu qu'**au démarrage** du serveur. Appliqué par `stalwart-init`
à un serveur déjà lancé, il ne prend effet qu'ensuite : sur un volume vierge, le tout premier
démarrage écrit encore dans un fichier, et `--withLog stalwart` ne montrerait rien.

`./runDev.sh` redémarre donc le serveur **si et seulement si** son journal de conteneur est vide.
La condition est **exacte**, et non heuristique : le traceur étant persistant, un journal vide
signifie exactement « le traceur n'était pas en place au démarrage ». Mesuré sur un volume neuf :
0 ligne avant, 31 après, et le second passage ne redémarre rien.

**Après correction, mesuré :** `scripts/verify-mail-infra.sh` rend **38 contrôles, aucune
anomalie** ; sa contre-épreuve rend **11 anomalies** sur une configuration dégradée, réparties sur
quatre familles, dont un serveur jetable privé de `config.json` qui entre bien en bootstrap mode.

---

---

## R-05 — L'écran de connexion a son unité : `CRM-009` (arbitrage du responsable, INC-021) — **arbitrage explicite du responsable**

*Origine : `Décision 239 — L'écran de connexion a son unité : `CRM-009` (arbitrage du responsable, INC-021)` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Question posée.** La Definition of Done de `CRM-011` exige un « E2E de connexion et de refus ».
Aucune unité du backlog ne livrait l'écran qui rendrait cet E2E possible. Trois options étaient
soumises : rattacher l'écran à `CRM-011`, créer une unité dédiée, ou élargir `CRM-007`.

**Décision du responsable : option 2 — une unité dédiée.** Elle porte l'identifiant `CRM-009`,
libre, et se place dans l'ordre d'exécution **entre `CRM-007` et `CRM-008`** : la coquille existe
avant l'écran, et le harnais de tests vient après ce qu'il doit exercer.

**Motif retenu.** C'est la seule option qui laisse chaque unité à son objet. `CRM-011` a livré et
prouvé le **mécanisme** d'authentification sur 42 contrôles hors interface ; le rouvrir pour y
loger une interface mêlerait deux sujets qui n'ont ni les mêmes preuves ni le même risque.
`CRM-007` livre un **squelette**, et son énoncé ne mentionne ni formulaire, ni session, ni garde
de route. Une unité dédiée donne en outre un propriétaire clair à la posture de session — la
décision 240 — que les deux autres options auraient laissée orpheline.

**Ce que la décision coûte, et qui est assumé :** l'ordre du `docs/MASTER_PLAN.md` §2 est amendé
pour insérer `CRM-009` dans un chunk 2 déjà livré. C'est un coût d'écriture, une fois ; les deux
autres options avaient un coût de traçabilité, permanent.

**Conséquence directe et chiffrée.** `CRM-009` est la condition de fermeture de **dix-huit unités
`[~]`** dont le code est livré et prouvé et qui n'attendaient que cet arbitrage. Elles ne passeront
pas `[x]` d'un trait de plume pour autant : chacune sera reprise, sa preuve manquante réellement
exécutée, et son état révisé sur mesure.

---

## R-06 — La session vit en `sessionStorage` (arbitrage du responsable, INC-022) — **arbitrage explicite du responsable**

*Origine : `Décision 240 — La session vit en `sessionStorage` (arbitrage du responsable, INC-022)` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Question posée.** `docs/DAT.md` §3.1 se contredisait à quatre lignes d'intervalle. La version la
plus ancienne laissait entendre que la session serait « persistée par la bibliothèque » —
c'est-à-dire, par défaut, écrite dans `localStorage`, ce que `CLAUDE.md` §11 interdit sans
consentement explicite. Trois postures étaient soumises : mémoire seule, `sessionStorage`, ou
`localStorage` avec consentement.

**Décision du responsable : option 2 — `sessionStorage`.** La session survit au rechargement de la
page et disparaît à la fermeture de l'onglet.

**Motif retenu.** C'est la **catégorie 2** de `CLAUDE.md` §11 — une donnée limitée à la session —
qui n'exige aucun recueil de consentement. Elle donne le confort qui compte réellement dans un
outil de travail : un `F5` ne déconnecte pas. La mémoire seule aurait été perçue comme un défaut
quotidien ; le `localStorage` avec consentement est un vrai sujet produit, qui mérite son unité
plutôt qu'un coin d'écran de connexion.

**Ce que cela impose à `CRM-009`, et qui doit être prouvé :** le client `supabase-js` est
explicitement configuré — `persistSession` actif, `storage` visant `sessionStorage` — plutôt que
laissé à son défaut. La preuve exigée est symétrique et **hors interface autant que dedans** :
après connexion, `localStorage` reste **vide** et `sessionStorage` porte la session ; après
fermeture du contexte, rien ne subsiste.

**Ce que la décision n'ouvre pas.** Aucune bannière, aucun registre de consentement, aucune
troisième catégorie de `CLAUDE.md` §11. Une évolution vers « rester connecté » reste possible plus
tard, et devra alors être une unité, avec son consentement, son refus possible et sa trace.

---

## R-07 — Le secret de build du registre npm est câblé, et c'est une unité : `CRM-015` (arbitrage du responsable, INC-042) — **arbitrage explicite du responsable**

*Origine : `Décision 241 — Le secret de build du registre npm est câblé, et c'est une unité : `CRM-015` (arbitrage du responsable, INC-042)` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Question posée.** L'image de la webapp ne se construit pas dans l'environnement de la routine :
`npm ci` échoue en `SELF_SIGNED_CERT_IN_CHAIN` derrière un proxy à certificat interposé. Le
`Dockerfile` prévoit pourtant déjà un secret de build `npm_ca` — **aucun fichier Compose ne le
fournit**. Trois options : contourner à chaque exécution, câbler le secret, ou fournir une image
préconstruite.

**Décision du responsable : option 2 — câbler le secret**, dans une **unité à part entière**,
`CRM-015`, et non au détour d'une autre.

**Motif retenu, et il est mesuré.** INC-042 en est à sa **onzième occurrence**. Onze occurrences
constituent une mesure, pas une malchance. Le coût n'est pas seulement du temps : c'est une
**preuve perdue à chaque unité** — `./runDev.sh` n'a jamais été exécuté de bout en bout, alors que
la Definition of Done de `CRM-050` l'exige nommément, et que toutes les unités d'interface
reposent sur lui. Câbler le secret est la seule voie qui rende cette preuve atteignable.

**Contrainte non négociable attachée à la décision :** le certificat est **fourni par
l'environnement**, jamais versionné. Aucun fichier du dépôt ne contient de certificat, et
l'assemblage doit rester **inerte** là où la variable est absente — un poste sans proxy ne doit
rien voir changer. C'est la condition à laquelle cette décision est prise.

**Conséquence :** `CRM-050` cesse d'avoir une preuve manquante pour un motif étranger à son objet.
Elle sera reprise et close par la mesure, pas par déclaration.

---

## R-08 — L'invitation est rattachée à `CRM-070` (arbitrage du responsable, INC-015) — **arbitrage explicite du responsable**

*Origine : `Décision 242 — L'invitation est rattachée à `CRM-070` (arbitrage du responsable, INC-015)` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Question posée.** `POST /auth/v1/invite` exige la clé de service, que la webapp ne doit jamais
détenir, et aucun composant serveur n'existe pour porter le parcours. Trois options : rattacher à
`CRM-070`, créer une unité dédiée maintenant, ou assumer définitivement l'invitation comme une
opération d'exploitation.

**Décision du responsable : option 1 — rattacher à `CRM-070`**, l'unité d'administration des
permissions fines, qui traite déjà de la gestion des membres.

**Motif retenu.** L'option 2 aurait fait prendre **trois décisions d'architecture d'un coup** —
une table d'invitations absente de `docs/SCHEMA.md`, un appel sortant depuis la base absent de
`docs/DAT.md` §3, et une clé de service à provisionner en Vault — pour servir un geste **rare**,
alors que l'écran de connexion sert un geste quotidien. L'ordre de valeur est clair. L'option 3
était écartée : un CRM où seul un opérateur peut créer un compte n'est pas un produit.

**Ce qui est exigé en attendant, et qui n'est pas facultatif :** le comportement réel —
l'invitation est émise par un **opérateur** disposant de la clé de service, hors interface — doit
être **nommé explicitement dans `docs/manual.md`**, chapitre 17, plutôt que promis comme un
parcours livré. Un manuel qui décrit un écran qui n'existe pas est un défaut, pas une anticipation.

**Ce qui reste ouvert et le reste sciemment :** les trois choix d'architecture ci-dessus sont
reportés, pas tranchés. `CRM-070` devra les prendre explicitement, et INC-014 — les politiques RLS
des tables d'identité — posera la même question pour l'éventuelle table d'invitations.

---

## R-09 — La garde de ports lit `/proc/net/tcp` en dernier recours (arbitrage du responsable, INC-044 et INC-079) — **arbitrage explicite du responsable**

*Origine : `Décision 243 — La garde de ports lit `/proc/net/tcp` en dernier recours (arbitrage du responsable, INC-044 et INC-079)` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Question posée.** Sans `ss` ni `netstat`, `host_listening_ports` rend une liste **vide**. Les
deux consommateurs se comportent alors de façon opposée : `require_free_ports` avertit et laisse
démarrer — voulu —, tandis que `scripts/verify-scripts.sh` **échoue**, comparant quinze ports
publiés à une liste vide. Trois options : faire s'abstenir le contrôle, lire `/proc/net/tcp` en
dernier recours, ou accepter `lsof` comme troisième source.

**Décision du responsable : option 2 — lire `/proc/net/tcp`.**

**Motif retenu.** C'est la seule option qui ferme les **deux** entrées à la fois, et surtout la
seule qui rende la garde **réellement** protectrice au lieu d'apparemment protectrice. L'option 1
aurait fait taire le harnais en laissant l'angle mort intact : sur un tel hôte, un vrai conflit de
port serait resté invisible jusqu'à l'échec de Compose — ce qui est le risque de fond derrière
INC-044, et non le message d'erreur qui l'a révélé. `/proc/net/tcp` est présent sur tout Linux ;
son format hexadécimal est une dizaine de lignes, et il est testable.

**Rattachement :** `CRM-002`, l'unité qui porte `scripts/lib/env.sh` et son harnais. La correction
n'est pas faite depuis une unité qui ne traite pas ce sujet.

**Exigence attachée :** la lecture de `/proc/net/tcp` doit être prouvée **dans les deux sens** —
elle voit un port réellement ouvert, et ne voit pas un port fermé —, faute de quoi on aurait
remplacé une garde inerte par une garde qui se croit active.

---

## R-10 — La collision du numéro 180 est levée par un suffixe, jamais par une renumérotation

*Origine : `Décision 244 — La collision du numéro 180 est levée par un suffixe, jamais par une renumérotation` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-069).** Deux entrées portaient « Décision 180 », poussées par deux exécutions
concurrentes de la routine qui avaient lu le même numéro avant que l'autre ne pousse le sien.
`docs/BACKLOG.md` et `CHANGELOG.md` citent « décision 180 » pour l'une, `docs/JOURNAL.md` pour
l'autre : un lecteur qui suit la référence tombe sur l'une ou l'autre selon l'ordre de lecture.

**Décision : suffixer les titres — `180 a` et `180 b` — et ne renuméroter ni l'une ni l'autre.**
Renuméroter casserait les références qui les citent, et **les deux sont citées**. Le suffixe rend
la référence levable : « décision 180 » désigne désormais un couple dont le lecteur voit
immédiatement les deux membres, au lieu d'un numéro qui désigne deux choses sans le dire.

**La cause, elle, est traitée ailleurs** : la routine est sérialisée (décision issue d'INC-059).
Cette entrée reste la trace de ce que la concurrence a coûté.

---

---

## R-11 — Une liste d'exemples du responsable n'est pas une spécification exhaustive

*Origine : `Décision 245 — Une liste d'exemples du responsable n'est pas une spécification exhaustive` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-003).** Le workflow par défaut déclare une sortie vers « Perdu » depuis Prospection,
Relance, Négociation et Signature, mais **pas depuis Réalisation**. Une affaire signée puis
abandonnée en cours de réalisation n'a donc **aucun chemin** vers « Perdu » : `move_card` refuse une
transition non déclarée, et la card reste bloquée — ou quelqu'un la fait reculer en « Négociation »
pour pouvoir la perdre, ce qui fausse l'historique et l'analytique.

**Question posée au responsable : oubli de qui ?** Réponse : le responsable avait **listé des
exemples** et attendait des propositions. L'oubli est donc **celui de l'agent** — l'unité qui a écrit
le workflow seedé a recopié les exemples comme s'ils étaient le graphe complet, au lieu de les
traiter pour ce qu'ils étaient : un point de départ à compléter et à soumettre.

**Décision : la transition « Réalisation → Perdu » est ajoutée**, et le graphe du workflow par défaut
est **relu en entier** à cette occasion — chaque étape doit avoir au moins une sortie, et toute
étape sans issue est soit justifiée, soit complétée.

**Règle générale, et c'est le vrai enseignement.** Lorsqu'un document du responsable donne une
**énumération d'exemples**, l'agent ne la recopie pas telle quelle : il la complète, propose le
résultat, et **nomme** ce qu'il a ajouté. Un exemple recopié en silence devient une spécification que
personne n'a écrite, et le défaut ne se voit qu'à l'usage — ici, un cul-de-sac dans un workflow, à
l'endroit exact où une affaire échoue.

**Mise en œuvre rattachée au seed** (`CRM-005`, `CRM-046`), avec la relecture du graphe complet.

---

## R-12 — Les fonctions edge entrent au périmètre : la décision 12 est rouverte

*Origine : `Décision 246 — Les fonctions edge entrent au périmètre : la décision 12 est rouverte` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-007).** `README.md` §10 annonce un répertoire `supabase/functions/` — « Edge functions
Deno » — qui **n'existe pas**. Le service `edge-runtime` n'est pas déployé, la route
`/functions/v1/` n'est pas déclarée dans la passerelle, et **aucune unité** n'en prévoit.

La décision 12 les avait écartées, au même titre qu'`analytics` et `imgproxy`. L'agent en avait
déduit, dans le dossier d'arbitrage, qu'il fallait **retirer la mention du README**.

**Le responsable tranche l'inverse, et le motif est explicite :** les fonctions edge sont
**explicitement mentionnées** par le socle documentaire. Les retirer aurait consisté à faire
disparaître une contradiction en supprimant la moitié qui gênait, plutôt qu'en livrant ce que le
document annonce. **La décision 12 est rouverte sur ce point.**

**Décision : `edge-runtime` est déployé, `supabase/functions/` existe, et la route `/functions/v1/`
est déclarée dans la passerelle.** Une unité dédiée les porte — **`CRM-016`**.

**Ce que cela change au-delà de l'infrastructure.** Deux besoins réels n'avaient aucun porteur
naturel et en trouvent un :

- l'**invitation d'un membre** (INC-015), qui exige la clé de service et ne peut pas vivre dans la
  webapp — `CRM-070` pourra s'appuyer sur une fonction edge plutôt que sur un appel sortant depuis
  la base par `pg_net`, chemin plus contournant ;
- les **webhooks sortants signés** (`CRM-073`).

**Ce que cela ne change pas :** la logique métier reste en PostgreSQL, et `mail-sync` reste un
service Python — IMAP et SMTP demandent des connexions longues, incompatibles avec des fonctions
courtes (`docs/DAT.md` §3.3). Les fonctions edge s'ajoutent, elles ne remplacent rien.

---

## R-13 — L'ordonnancement passe à `pg_cron` : la décision 8 est renversée

*Origine : `Décision 247 — L'ordonnancement passe à `pg_cron` : la décision 8 est renversée` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-012).** La décision 8 plaçait l'ordonnancement — relances, séquences, digest, purge
RGPD — dans `mail-sync` plutôt que dans `pg_cron`, sur **deux** motifs. `CRM-004` a **démenti le
premier** par la mesure : `pg_cron` 1.6.4 est présent, préchargé et fonctionnel dans l'image
épinglée. Seul le motif de testabilité subsistait.

**Décision du responsable : utiliser `pg_cron`.** La décision 8 est renversée, pas seulement
corrigée dans son énoncé.

**Motif retenu.** Le compromis assumé de l'ordonnanceur applicatif était écrit noir sur blanc dans
`docs/DAT.md` §12 : « **les tâches planifiées s'arrêtent si le service s'arrête** ». Pour des
relances commerciales, un digest quotidien et une purge RGPD, c'est un compromis coûteux : une
purge RGPD qui ne s'exécute pas est un manquement, pas un retard. `pg_cron` s'exécute là où vivent
les données et là où vivent déjà les règles métier — une seule source de vérité, comme pour le
reste du produit.

**Ce que la décision coûte, et qui est assumé :** les tâches planifiées deviennent testables par
pgTAP plutôt que par pytest. C'est le motif de testabilité qui tombe — il tenait seul depuis
`CRM-004`, et il ne pèse pas contre une purge qui ne part pas.

**Mise en œuvre : unité `CRM-017`.** `docs/DAT.md` §3.3 et §12 sont corrigés dans le même
changement, et le périmètre de `CRM-051` (`mail-sync`) perd son sous-composant `scheduler`.

---

## R-14 — `require_fields` devient une table de liaison : le modèle est corrigé, pas contourné

*Origine : `Décision 248 — `require_fields` devient une table de liaison : le modèle est corrigé, pas contourné` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-033).** `workflow_transitions.require_fields` est un `uuid[]`. **Mesuré :**
PostgreSQL refuse toute clé étrangère depuis une colonne tableau. Ce n'est pas un différé
d'ordonnancement : c'est une propriété du type, qui ne changera jamais. La suppression d'un champ de
formulaire laisse donc des identifiants **morts** dans les tableaux des transitions, et rien ne le
signale.

**Décision du responsable : on rouvre pour mieux refaire.** `require_fields` est remplacée par une
**table de liaison** `(transition_id, field_id)`, avec ses deux clés étrangères et son
`ON DELETE CASCADE`.

**Motif retenu.** L'option d'accepter le type et d'ajouter un nettoyage au moment de la suppression
d'un champ aurait reproduit **en code applicatif** ce que le moteur sait faire seul, et l'aurait
reproduit **imparfaitement** : un nettoyage oublié dans un chemin de suppression laisse exactement
la donnée morte qu'on prétend éviter. L'intégrité référentielle est le travail de la base.

**Ce que la décision coûte, et qui est assumé :** elle rouvre `CRM-031` et `CRM-035`, livrées et
prouvées. La migration, la mise à jour de `copy_workflow_to_track`, du seed, des suites pgTAP et des
preuves d'API sont du travail réel. **Mise en œuvre : unité `CRM-018`.**

**Conséquence sur une entrée voisine :** INC-056 constatait que la copie de workflow recopie
`require_fields` tel quel et fait varier un compte global. La table de liaison rend ce comptage
déterministe par construction.

---

## R-15 — Changer le workflow d'un channel entier est un geste distinct : `change_channel_workflow`

*Origine : `Décision 249 — Changer le workflow d'un channel entier est un geste distinct : `change_channel_workflow`` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-046, INC-073).** `docs/SCHEMA.md` §9 décrivait `move_card_to_channel(card_id,
channel_id, step_mapping)` — « remappage explicite **des étapes** », au pluriel —, tandis que
`docs/SPEC-workflow-engine.md` §6 décrit **une** card et **une** étape de destination. `CRM-045` a
livré la seconde lecture.

**Décision du responsable : le geste pluriel est retenu** — changer le workflow d'un channel entier,
en remappant l'étape de toutes ses cards en un appel.

**Conséquence : deux fonctions distinctes, deux noms distincts.** Le pluriel du §9 n'était donc pas
une erreur de rédaction : il décrivait une fonction que personne n'avait encore nommée.

| Fonction | Objet |
|---|---|
| `move_card_to_channel(card_id, channel_id, step_id)` | Une card change de dossier. **Livrée par `CRM-045`, inchangée** |
| `change_channel_workflow(channel_id, workflow_id, step_mapping)` | Un channel change de workflow, et l'étape de **toutes** ses cards est remappée |

`docs/SCHEMA.md` §9 est corrigé pour nommer les deux. **Mise en œuvre : unité `CRM-019`.**

**Ce que la seconde fonction devra garantir, et qui n'est pas négociable :** le remappage est
**explicite et exhaustif** — aucune étape de départ n'est devinée, aucune card ne reste sur une
étape qui n'appartient pas à son nouveau workflow —, et le refus est renvoyé **entier** plutôt
qu'appliqué à moitié.

---

## R-16 — Les gabarits d'emails sont servis, et une preuve d'email vérifie son contenu

*Origine : `Décision 250 — Les gabarits d'emails sont servis, et une preuve d'email vérifie son contenu` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-016).** Le produit est en français ; les emails transactionnels partent en
**anglais**. Mesuré : `supabase/gotrue:v2.189.0` ne charge un gabarit personnalisé que par **HTTP**,
et le repli vers le gabarit par défaut est **silencieux du point de vue du destinataire**.

**Décision du responsable : servir les gabarits en HTTP depuis la pile.**

**Exigence attachée, et elle vaut au-delà de cette entrée :** toute preuve portant sur un email
vérifie son **contenu**, jamais sa seule présence. Un email reçu ne prouve pas que le gabarit
configuré a été employé — c'est précisément ce que la mesure a montré.

**Mise en œuvre rattachée à `CRM-009`**, qui touche déjà l'authentification et ses parcours.

---

## R-17 — Le chemin d'administration de GoTrue est encadré, pas accepté

*Origine : `Décision 251 — Le chemin d'administration de GoTrue est encadré, pas accepté` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-018).** Mesuré : `POST /auth/v1/admin/users` crée un compte avec un mot de passe de
**8 caractères** là où le chemin utilisateur en exige 12 et refuse en `422 weak_password`. Le compte
ainsi créé est utilisable : il se connecte.

**Décision du responsable : interdire ce chemin en production et le documenter comme une opération
d'exploitation encadrée.**

**Motif retenu :** l'accepter au motif qu'il exige la clé de service reviendrait à dire qu'un
privilège dispense d'une règle. La politique de mot de passe n'est pas une gêne pour l'utilisateur,
c'est une propriété du produit — et un compte à 8 caractères créé par commodité est exactement la
brèche qu'elle existe pour éviter.

**Mise en œuvre :** `docs/PROD_MIGRATIONS.md` et `docs/SPEC-auth.md` §4, qui cesse d'énoncer la
politique « sans réserve » et nomme le chemin qui y échappe.

---

## R-18 — La copie de workflow contre la surcharge : l'écart est confirmé

*Origine : `Décision 252 — La copie de workflow contre la surcharge : l'écart est confirmé` de `claude/happy-goldberg-qt5vfi`. Reproduite verbatim.*


**Constat (INC-005).** `CLAUDE.md` §4 demande que « tout existe par défaut au niveau général, puis
les contextes spécialisés ne définissent que leurs différences ». Le responsable avait demandé de
**copier** un workflow global dans un track pour l'y modifier.

**Décision du responsable : l'écart est confirmé.** L'instruction explicite prime (`CLAUDE.md` §26,
priorité 2 sur priorité 8), et la compensation est en place et prouvée : l'origine reste connue
(`derived_from_workflow_id`, `derived_at`) et la divergence est signalée.

**L'entrée est close** : elle était ouverte « pour information », en attente de cette confirmation.

---

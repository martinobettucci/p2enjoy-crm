<!--
@spec CRM-080 (docs/BACKLOG.md) — tranche 3, l'exploitation des sauvegardes
@spec docs/SPEC-backups.md §19 (ce que ce runbook doit porter), §16 (mesures M16 à M21),
      §17 (les neuf contrôles et les trois codes de retour), §18 (variables d'environnement),
      §21.2 (limites nommées)
@spec CLAUDE.md §12 (toute opération manuelle de production vit dans un document dédié),
      §9 (aucune écriture de production sans instruction humaine explicite),
      §20 (aucun secret dans un document qui circule)
-->

# Runbook — sauvegardes et restauration en production

Document d'**exploitation**. Il décrit ce qu'un humain fait sur un hôte de production, et il
n'automatise rien de ce qui touche une production : `CLAUDE.md` §9 l'interdit, et un script capable
d'écraser une production est un script qui peut l'écraser par erreur.

Les trois commandes du dépôt, et leur répartition :

| Commande | Où elle tourne | Ce qu'elle détient |
|---|---|---|
| `scripts/backup.sh` | l'hôte de production | des clés **publiques** seulement — il ne peut relire aucune de ses archives |
| `scripts/backup-supervision.sh` | l'hôte de production | **rien** : il lit un répertoire, sans déchiffrer |
| `scripts/restore-drill.sh` | un poste **distinct** | la clé **privée** `age` |

Cette répartition n'est pas une commodité : c'est la propriété de sécurité de
`docs/SPEC-backups.md` §3.4. La compromission de l'hôte de production ne livre pas l'historique des
sauvegardes, parce que cet hôte ne peut pas le lire.

---

## 1. Planification et fréquence

**Une sauvegarde quotidienne, hors heures ouvrées. Une supervision horaire.**

La perte maximale acceptée est d'une journée de travail. `pg_dump` est un instantané logique dont le
coût croît avec la base ; l'exécuter plus souvent n'apporterait rien tant que la restauration à un
instant quelconque n'est pas activée (`docs/SPEC-backups.md` §8, mesure M8 : `wal-g` est configuré
dans l'image mais activé par aucun service).

La supervision, elle, est horaire parce qu'elle est **le seul détecteur** du mode d'échec le plus
dangereux : celui où la tâche de sauvegarde ne tourne plus du tout, et où aucun code de retour n'est
donc jamais produit (mesure M21).

Les deux formes sont données parce que l'hôte peut porter l'une ou l'autre (mesure M20). **Chacune
enveloppe l'appel dans `flock`** : deux sauvegardes simultanées écriraient deux assemblages dans le
même répertoire de sortie, et la rétention de l'une pourrait s'appliquer pendant l'écriture de
l'autre.

### 1.1 `systemd`

`/etc/systemd/system/p2enjoy-sauvegarde.service` :

```
[Unit]
Description=Sauvegarde chiffrée P2Enjoy CRM
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/p2enjoy-crm
EnvironmentFile=/etc/p2enjoy/sauvegarde.env
ExecStart=/usr/bin/flock -n /run/p2enjoy-sauvegarde.lock /opt/p2enjoy-crm/scripts/backup.sh
```

`/etc/systemd/system/p2enjoy-sauvegarde.timer` :

```
[Unit]
Description=Sauvegarde chiffrée P2Enjoy CRM, quotidienne

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
```

`Persistent=true` rattrape une exécution manquée après un arrêt de l'hôte : sans lui, une machine
éteinte à 02 h 30 saute simplement sa sauvegarde, en silence.

La supervision suit le même modèle, avec `OnCalendar=hourly` et
`ExecStart=/opt/p2enjoy-crm/scripts/backup-supervision.sh --cron`.

```
systemctl daemon-reload
systemctl enable --now p2enjoy-sauvegarde.timer p2enjoy-supervision.timer
systemctl list-timers 'p2enjoy-*'
```

### 1.2 `cron`

```
30 2 * * *  cd /opt/p2enjoy-crm && flock -n /run/p2enjoy-sauvegarde.lock ./scripts/backup.sh
17 *  * * *  cd /opt/p2enjoy-crm && ./scripts/backup-supervision.sh --cron
```

`cron` n'exporte presque aucune variable d'environnement : les réglages doivent venir du `.env` du
dépôt, que les deux scripts lisent en repli (`docs/SPEC-backups.md` §4 et §18), ou d'un
`. /etc/p2enjoy/sauvegarde.env` placé en tête de la ligne.

### 1.3 Ce que le déclencheur doit faire des codes de retour

| Code | Origine | Geste |
|---|---|---|
| `0` | tout va bien | rien |
| `1` de `backup.sh` | la sauvegarde a refusé ou échoué | lire `stderr`, appliquer §5 |
| `1` de `backup-supervision.sh` | au moins une alerte | appliquer §5 |
| `2` de `backup-supervision.sh` | **configuration inutilisable** | corriger la configuration, **pas** la sauvegarde |

**`1` et `2` ne se confondent pas.** Une variable mal écrite se lirait sinon comme « pas de
sauvegarde récente », et l'exploitant chercherait un incident là où il y a une faute de frappe.

---

## 2. La copie hors site

Une archive laissée sur la machine qu'elle sauvegarde ne protège d'aucun sinistre matériel.

**Ce qui est déjà acquis** : l'archive est chiffrée **à la source**, par des clés publiques
(`docs/SPEC-backups.md` §3.4). La destination hors site n'a donc besoin d'aucune confiance
particulière — elle ne peut pas lire ce qu'elle stocke. C'est cette propriété qui rend la copie hors
site simple : un espace de stockage loué, un NAS, un autre hôte suffisent.

**Deux règles, et elles ne sont pas décoratives :**

1. **La copie ne réécrit JAMAIS les noms.** Le nom porte l'horodatage de création, et c'est la seule
   date qui ne ment pas (mesure M18) : le contrôle S8 compare des **noms**. Une copie qui renommerait
   « en `derniere.tar.age` » rendrait la supervision aveugle.
2. **La copie ne touche pas aux archives locales.** Elle lit ; elle ne déplace pas, ne `touch` pas,
   ne compresse pas. Un `touch` soustrairait l'archive à la rétention de `backup.sh`, qui juge sur la
   date de modification (`docs/SPEC-backups.md` §3.6, et la limite du §21.2).

**Exemple** — le transport n'est pas livré par le dépôt, parce qu'il dépend de l'infrastructure de
l'exploitant (`docs/SPEC-backups.md` §21.2) :

```
rsync -a --ignore-existing /var/backups/p2enjoy/ sauvegarde@hors-site:/srv/p2enjoy/
```

`--ignore-existing` évite de réémettre l'historique à chaque exécution ; `-a` conserve les dates,
ce qui est préférable, mais n'est pas requis — S8 ne les regarde pas.

Renseigner ensuite `BACKUP_OFFSITE_DIR` **sur l'hôte qui supervise**, vers un montage en lecture de
la destination. Sans cette variable, S8 s'annonce « non applicable » : la supervision ne rend pas
vert un contrôle qu'elle n'a pas fait.

---

## 3. Rotation des destinataires `age`

### 3.1 Les trois faits qui commandent la procédure

1. **Une archive ancienne ne s'ouvre pas avec une nouvelle clé.** MESURÉ le 2026-08-20 :
   `age --decrypt` avec une identité qui n'est pas destinataire rend
   `no identity matched any of the recipients`, code `1`.
2. **Le nombre de destinataires est vérifiable après coup, sans clé privée** (mesure M17) : chaque
   destinataire reçoit sa propre strophe `-> X25519` dans l'en-tête en clair. On peut donc
   **compter**, et l'on ne peut pas **identifier** — ce qui est exactement ce qu'il faut.
3. **Donc toute clé privée ancienne se conserve aussi longtemps que la plus ancienne archive qu'elle
   ouvre**, soit au moins `BACKUP_RETENTION_DAYS` jours. La détruire au moment de la rotation
   rendrait illisible tout l'historique encore sous rétention.

### 3.2 La procédure — on AJOUTE avant de retirer

Une rotation qui commence par retirer est une rotation qui peut perdre l'accès sans que rien ne le
dise.

1. **Engendrer la nouvelle paire** sur le poste qui détiendra l'identité, jamais sur l'hôte de
   sauvegarde :

   ```
   age-keygen -o /etc/p2enjoy/restore-identity-2.txt
   chmod 600 /etc/p2enjoy/restore-identity-2.txt
   age-keygen -y /etc/p2enjoy/restore-identity-2.txt
   ```

2. **Ajouter** la clé publique obtenue au fichier de destinataires de l'hôte de sauvegarde, sans
   retirer l'ancienne. Le fichier porte alors deux lignes.

3. **Porter `BACKUP_MIN_RECIPIENTS` à 2** sur l'hôte qui supervise. La prochaine archive doit
   satisfaire S4 ; si elle ne le satisfait pas, la rotation n'a pas pris effet — le fichier de
   destinataires lu par le script n'est pas celui qui a été modifié.

4. **Attendre une sauvegarde**, puis vérifier :

   ```
   scripts/backup-supervision.sh
   ```

5. **Exercer la restauration avec la NOUVELLE identité**, sur le poste distinct :

   ```
   RESTORE_AGE_IDENTITY_FILE=/etc/p2enjoy/restore-identity-2.txt scripts/restore-drill.sh
   ```

   C'est cet exercice, et lui seul, qui prouve que la nouvelle clé ouvre réellement les archives.
   Sauter cette étape, c'est retirer l'ancienne clé sur une hypothèse.

6. **Retirer l'ancienne clé publique** du fichier de destinataires, et **ramener
   `BACKUP_MIN_RECIPIENTS` à 1**.

7. **CONSERVER l'ancienne clé privée** — au coffre, hors ligne — jusqu'à ce que la plus ancienne
   archive qu'elle ouvre soit sortie de rétention. La date de sortie se calcule sur le nom de cette
   archive, pas sur sa date de modification.

### 3.3 Perte d'une clé privée

Une clé privée perdue rend **définitivement** illisibles toutes les archives dont elle était le seul
destinataire. Il n'y a pas de recours : c'est le prix de la propriété du §3.4, et c'est le motif
pour lequel `BACKUP_MIN_RECIPIENTS` peut valoir plus de 1 en régime permanent — deux destinataires
détenus par deux personnes distinctes suppriment ce point unique de défaillance.

---

## 4. Rythme des exercices de restauration

**Au moins un exercice par mois**, sur le poste distinct qui détient l'identité.

Une sauvegarde jamais restaurée n'est pas une sauvegarde : l'hôte de sauvegarde ne peut prouver ni
que le dump est complet, ni qu'il est restaurable, parce que le manifeste et ses empreintes sont
**à l'intérieur** du chiffré (mesure M19). Seul `scripts/restore-drill.sh` le prouve.

Le succès de l'exercice laisse une empreinte, que la supervision surveille (S9) :

```
scripts/restore-drill.sh && date -u '+%Y-%m-%dT%H:%M:%SZ' > "$BACKUP_DRILL_STAMP_FILE"
```

**L'empreinte est écrite par le déclencheur, jamais par l'exercice.** `docs/SPEC-backups.md` §11.7
interdit à `restore-drill.sh` d'écrire hors de son assemblage temporaire, et ce runbook ne rouvre pas
ce contrat. Le `&&` a la propriété voulue : l'empreinte n'existe que si l'exercice a rendu `0`, donc
un exercice qui échoue laisse l'empreinte vieillir, et S9 finit par le dire.

Le fichier d'empreinte doit être **lisible par l'hôte qui supervise** — un montage en lecture, ou une
recopie par le même transport que la copie hors site.

---

## 5. Que faire quand l'alerte tombe

Une entrée par contrôle. Le code `2` n'est jamais dans cette table : il ne signale pas un incident de
sauvegarde mais une configuration inutilisable, et le message du refus nomme la variable à corriger.

| Alerte | Ce qu'elle signifie | Ce qu'on regarde en premier | Le geste qui la lève |
|---|---|---|---|
| **S1 présence** | aucune archive n'a jamais été écrite dans ce répertoire | la tâche planifiée est-elle activée ? `systemctl list-timers 'p2enjoy-*'` | activer le `timer`, ou corriger `BACKUP_OUTPUT_DIR` s'il désigne le mauvais répertoire |
| **S2 fraîcheur** | la sauvegarde ne tourne plus, ou échoue en silence | le journal de la dernière exécution : `journalctl -u p2enjoy-sauvegarde -n 50` | corriger la cause de l'échec, puis lancer `scripts/backup.sh` à la main pour reprendre la main |
| **S3 forme** | le fichier le plus récent porte un nom d'archive mais n'est pas une archive `age` | a-t-on déposé un fichier à la main dans le répertoire de sortie ? | retirer l'intrus ; le répertoire de sortie n'appartient qu'à `backup.sh` |
| **S4 destinataires** | une rotation n'a pas pris effet, ou un destinataire a été perdu | le fichier `BACKUP_AGE_RECIPIENTS_FILE` réellement lu par le script | §3.2, en reprenant à l'étape 2 |
| **S5 taille** | dump tronqué, disque plein, ou base réellement réduite de moitié | l'espace libre du volume, puis la taille de la base | libérer de l'espace, relancer une sauvegarde, et **ne pas supprimer** l'archive suspecte avant d'en avoir une bonne |
| **S6 résidu** | une sauvegarde est morte en cours d'écriture | le journal de l'exécution correspondante ; l'espace libre | corriger la cause, puis supprimer le `.partiel` — il n'est jamais une sauvegarde valide |
| **S7 rétention** | la rétention ne s'applique plus, le disque se remplira | `BACKUP_RETENTION_DAYS` a-t-il changé ? les archives ont-elles été `touch`ées ? | ne rien supprimer à la main avant d'avoir vérifié la copie hors site ; la rétention s'appliquera à la prochaine sauvegarde réussie |
| **S8 hors site** | la copie hors site est en retard : un sinistre matériel coûterait la différence | le transport — montage, identifiants, espace libre de la destination | relancer le transport, puis vérifier que S8 verdit à l'exécution suivante |
| **S9 exercice** | la restaurabilité n'est plus prouvée | l'exercice tourne-t-il ? a-t-il échoué en silence ? | lancer l'exercice à la main (§4), lire son verdict, corriger avant de recommencer à faire confiance aux archives |

**Une alerte qui persiste après le geste n'est pas une alerte à faire taire.** Relever un seuil pour
verdir un contrôle est exactement ce que `CLAUDE.md` §18 interdit.

---

## 6. Restaurer une production — procédure HUMAINE

`scripts/restore-drill.sh` ne sait pas viser une pile existante, et c'est délibéré
(`docs/SPEC-backups.md` §14). Ce qui suit est une opération humaine, et elle exige une instruction
explicite du responsable (`CLAUDE.md` §9).

**Avant tout, décider ce que l'on restaure** : la base entière, ou une table. Une restauration
sélective se fait avec `pg_restore --table`, à partir du même `base.dump`, et ne demande aucun des
arrêts ci-dessous.

1. **Exercer d'abord l'archive choisie** sur le poste distinct : `scripts/restore-drill.sh <archive>`.
   Restaurer une production à partir d'une archive qu'on n'a pas ouverte, c'est découvrir sa
   corruption au pire moment.
2. **Arrêter les services écrivains** — la webapp, l'API, `mail-sync` — et laisser la base debout.
3. **Sauvegarder l'état courant AVANT d'écraser quoi que ce soit** : `scripts/backup.sh`. Même une
   base corrompue vaut mieux que rien si la restauration se passe mal.
4. **Déchiffrer et extraire** l'archive sur le poste qui détient l'identité, jamais sur l'hôte de
   production :

   ```
   age --decrypt -i "$RESTORE_AGE_IDENTITY_FILE" <archive> | tar -x
   ```

5. **Vérifier les empreintes du manifeste** sur les membres extraits, avant d'en faire quoi que ce
   soit : `sha256sum base.dump` contre la ligne `membre=base.dump` de `MANIFESTE.txt`.
6. **Remettre la clé racine de Vault en place AVANT le premier démarrage** du cluster restauré.
   `pgsodium_getkey.sh` en fabrique une au hasard si le fichier manque, et la déposer ensuite ne
   répare rien (mesure M9) : la base démarrerait avec une clé qui n'ouvre aucun secret, et rien ne
   s'en plaindrait.
7. **Restaurer sous `supabase_admin`**, non sous `postgres`, qui n'est pas superutilisateur ici :
   `COPY vault.secrets` rendrait `permission denied` et **les secrets ne seraient pas restaurés du
   tout**, sans que rien ne s'arrête (mesure M10).
8. **Exiger zéro erreur de `pg_restore`.** Une seule erreur signifie que la restauration n'est pas
   fidèle.
9. **Vérifier avant de rouvrir** : le déchiffrement effectif d'un secret de Vault
   (`select * from vault.decrypted_secrets`) est le contrôle central — c'est le **seul** invariant
   qui voie une clé racine perdue (mesure M12). Une base restaurée avec une mauvaise clé rend
   `pg_restore` sans erreur et tous les comptes de lignes justes.
10. **Redémarrer les services écrivains**, puis lancer `scripts/backup-supervision.sh` et
    `scripts/backup.sh` : la première sauvegarde après une restauration est la preuve que la chaîne
    est repartie.

**Les rôles ne sont pas dans l'archive** (§7 ci-dessous) : sur un hôte de secours, ils sont recréés
par le chemin d'amorçage de la pile, et leurs mots de passe viennent de la configuration.

---

## 7. Ce que l'archive ne porte PAS, et qu'il faut sauvegarder ailleurs

**Décision d'architecture, prise le 2026-08-20** (`docs/SPEC-backups.md` §19.7) : les objets globaux
de PostgreSQL — les rôles et leurs mots de passe — **n'entrent pas** dans l'archive.

Trois motifs, dans cet ordre : ce que les rôles porteraient est une **configuration**, non une
donnée ; les emporter changerait le format d'archive de la tranche 1, donc le dictionnaire de refus
de la tranche 2 et les deux harnais livrés ; et la restauration reproduit déjà le chemin d'amorçage
de la pile, ce que la tranche 2 prouve — `pg_restore` rend zéro erreur une fois ces scripts appliqués
(mesure M10).

**La conséquence est une obligation d'exploitation à part entière** : une archive parfaite et un
`.env` perdu ne restaurent rien. Doivent être sauvegardés **hors de l'archive**, dans le coffre de
secrets de l'exploitant :

| Objet | Pourquoi il n'est pas dans l'archive | Sans lui |
|---|---|---|
| le `.env` de production | il porte tous les secrets de la pile ; l'archive est chiffrée pour des destinataires, le coffre pour des humains | la pile ne redémarre pas : `POSTGRES_PASSWORD`, `JWT_SECRET`, les clés S3 sont perdus |
| le fichier de destinataires `age` | il n'est pas un secret — il ne porte que des clés publiques —, mais il est une **configuration** | les sauvegardes suivantes échouent (refus R2 à R4) |
| **les clés privées `age`, anciennes comprises** | elles ne doivent jamais approcher l'hôte de sauvegarde (§3.4) | **toutes les archives deviennent illisibles, définitivement** |
| les certificats TLS et la configuration du reverse proxy | ils ne sont ni dans la base ni dans le dépôt objet | le service ne se republie pas à l'identique |

---

## 8. Limites de ce runbook

- **Aucune restauration à un instant quelconque (PITR).** `pg_dump` est un instantané logique ; la
  perte maximale reste d'une journée. `wal-g` est configuré dans l'image mais activé par aucun
  service (mesure M8) : l'activer serait une décision d'architecture, à prendre explicitement.
- **La supervision ne prouve jamais la restaurabilité** (mesure M19). Elle prouve la présence, la
  fraîcheur, la forme et le nombre de destinataires. C'est l'exercice mensuel du §4 qui prouve le
  reste, et S9 qui surveille qu'il a lieu.
- **Aucune alerte n'est émise par le dépôt.** `backup-supervision.sh` rend un code et un texte ;
  câbler un courriel, un webhook ou une sonde appartient à l'exploitant, dont le dépôt ne connaît
  pas l'outillage.
- **Le transport hors site n'est pas livré**, pour le même motif : `rsync`, client S3 ou montage
  réseau dépendent de l'infrastructure.
- **Le dépôt objet externe n'est pas dans l'archive.** Quand le stockage est un fournisseur S3, ses
  objets relèvent de lui ; le manifeste l'écrit (`depot_objet=externe`) pour qu'aucune restauration
  ne croie disposer de ce qu'elle n'a pas.

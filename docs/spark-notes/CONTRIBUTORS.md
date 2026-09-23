# Configuration du Spark `crm`

## Sources et livraison

- Le code vient du dépôt `p2enjoy-crm`, branche `main`. **La cellule porte une archive, pas un dépôt
  Git** : `/srv/crm`, propriété de `spark-docker`, et `/srv/crm/REVISION` dit quel commit tourne.
- Une livraison se fait **depuis un poste**, jamais dans la cellule : `scripts/spark/livrer.sh`
  construit la webapp (la cellule n'a pas Node), extrait l'archive par-dessus `/srv/crm`, charge si
  besoin l'image Realtime dérivée, puis lance la pile. `--archive-seule` dépose le code sans rien
  démarrer.

## Variables et secrets

- **Aucun `.env` dans la cellule.** `./runProd.sh --spark` fusionne `.env.example`,
  `/etc/spark/env` puis `/run/spark/secrets` dans un fichier de `/run/user/<uid>/p2enjoy-crm/`
  (tmpfs, `600`), puis applique ses gardes : profil `prod`, `APPLY_MIGRATIONS=false`, aucune valeur
  `CHANGE_ME_*`.
- Les secrets ont été **tirés dans la cellule** par `scripts/spark/proposer.sh` et proposés en
  console ; ils n'ont jamais quitté la cellule autrement.

## Commandes, dans `/srv/crm`, sous `spark-docker`

| Geste | Commande |
|---|---|
| Démarrer ou recréer la pile | `./runProd.sh --spark` |
| Premier déploiement (base vierge mesurée) | `./runProd.sh --spark --migrate --premier-deploiement` |
| Appliquer les migrations d'une nouvelle révision | `./runProd.sh --spark --migrate` (instantané confirmé) |
| Arrêter, volumes conservés | `./runProd.sh --spark --stop` |
| Premier espace et son administrateur (instruction explicite) | `scripts/spark/amorcer-espace.sh --email … --espace "…" --slug …` |
| Journaux d'un service | `docker logs p2enjoy-<service>` |

## Données

Base : `supabase/docker/volumes/db/data` (montage) et volume `db-config`, qui porte la **clé racine
de Vault** — sans elle, les mots de passe de messagerie enregistrés sont perdus. Objets : volume
`minio-data`. État de `mail-sync` : volume `mail-sync-state`.

## Limites connues de cette cellule

- **65 536 UID seulement** : une image dont un fichier appartient à un UID supérieur à 64534 ne s'y
  extrait pas. Realtime tourne donc sur une image dérivée, construite sur le poste
  (`supabase/docker/realtime-spark/Dockerfile`). Ne jamais « réparer » par un `docker pull` de
  l'image d'origine.
- **ClamAV absent** (mémoire) : une pièce jointe reçue reste non téléchargeable.
- **Sauvegardes hors site non en place** : `age` n'est pas installé.
- Sortie SMTP : `25`, `465` et `587` fermés par l'hébergeur ; employer un port de repli.

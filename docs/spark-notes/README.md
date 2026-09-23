# Spark `crm` — P2Enjoy CRM

Ce Spark porte la **production de P2Enjoy CRM** : le CRM de suivi de projets commerciaux de P2Enjoy
SAS — tracks, channels, affaires, workflows, messagerie intégrée.

- **Ce qu'il sert** : l'application web et son API, derrière la route `crm.lelabs.tech`. Caddy écoute
  en clair sur le port `8080` de la cellule ; la Forge porte le certificat.
- **Ce qu'il contient** : une pile Supabase auto-hébergée (PostgreSQL 17, GoTrue, PostgREST,
  Realtime, Storage, Edge Runtime, Kong), un stockage objet MinIO interne, et le service Python
  `mail-sync`, qui relève et envoie le courrier des utilisateurs.
- **Ce dont il dépend** : le SSO `oauth.lelabs.tech` pour « Se connecter avec LeLabs » (client
  `lelabs-crm`), et un relais SMTP pour les courriels transactionnels (invitations,
  réinitialisations).
- **Qui dépend de lui** : les utilisateurs du CRM. Aucun autre Spark ne l'appelle.

Dépôt, spécification et contrat de déploiement : dépôt `p2enjoy-crm`,
`docs/SPEC-deploiement-spark.md` et `docs/PROD_MIGRATIONS.md` §2.4.

# S'interfacer avec le Spark `crm`

## Point d'entrée

`https://crm.lelabs.tech` — la Forge termine TLS et fait suivre vers Caddy, port `8080` de la
cellule, en clair. Tout passe par ce seul point d'entrée.

| Chemin | Service |
|---|---|
| `/` | l'application web (routes de l'application monopage), dont `/auth/retour`, l'URL de retour du SSO |
| `/rest/v1/*` | PostgREST — données, sous Row Level Security |
| `/storage/v1/*` | Storage |
| `/realtime/v1/*` | Realtime |
| `/functions/v1/*` | fonctions edge, dont l'**échangeur de session** `/functions/v1/session/*` |
| `/auth/v1/*` | **`404`** : il n'existe plus de service d'authentification propre au CRM |

Chaque appel porte l'en-tête `apikey` avec la **clé anonyme** — publique par construction, elle est
dans le bundle de l'application — et, pour agir au nom d'une personne, son **jeton interne** en
`Authorization: Bearer`. **Aucun droit ne vient du jeton** : la base relit les appartenances à
chaque requête.

## Connexion unique

Le CRM est client **confidentiel** du realm `lelabs` de `oauth.lelabs.tech`, identifiant
`lelabs-crm-serveur`, code d'autorisation avec PKCE `S256`, URL de retour exacte
`https://crm.lelabs.tech/auth/retour`. Le navigateur mène l'aller jusqu'au code et le remet à
l'échangeur de session, qui l'échange **avec le secret du client** — posé dans la cellule par
l'administrateur du realm, jamais versé au dépôt — et garde le jeton de rafraîchissement **chiffré**
en base. Le navigateur ne reçoit qu'un jeton interne de cinq minutes au plus, gardé en mémoire, et
une poignée de session en cookie `httpOnly` ; aucun jeton LeLabs ne quitte le serveur.

Une personne n'entre que si son adresse est vérifiée, si LeLabs lui a donné le rôle de realm
`verified`, et si un espace du CRM l'**attend** (ou si elle en est déjà membre). Un rôle retiré chez
LeLabs ferme l'accès à la prolongation suivante de la session, cinq minutes au plus.

## Ce qui n'est pas exposé

Ni PostgreSQL, ni Kong, ni MinIO, ni l'API interne de `mail-sync` : aucun port n'est publié hors
de `8080`. Aucune intégration entrante n'est prévue ; le courrier est relevé en IMAP auprès des
serveurs des utilisateurs, jamais reçu en SMTP.

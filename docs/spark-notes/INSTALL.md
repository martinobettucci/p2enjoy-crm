# S'interfacer avec le Spark `crm`

## Point d'entrée

`https://crm.lelabs.tech` — la Forge termine TLS et fait suivre vers Caddy, port `8080` de la
cellule, en clair. Tout passe par ce seul point d'entrée.

| Chemin | Service |
|---|---|
| `/` | l'application web (routes de l'application monopage) |
| `/auth/v1/*` | GoTrue — authentification |
| `/rest/v1/*` | PostgREST — données, sous Row Level Security |
| `/storage/v1/*` | Storage |
| `/realtime/v1/*` | Realtime |
| `/functions/v1/*` | fonctions edge |

Chaque appel porte l'en-tête `apikey` avec la **clé anonyme** — publique par construction, elle est
dans le bundle de l'application — et, pour agir au nom d'une personne, son jeton en
`Authorization: Bearer`. **Aucun droit ne vient du jeton** : la base relit les appartenances à
chaque requête.

## Connexion unique

Le CRM est client **public** du realm `lelabs` de `oauth.lelabs.tech`, identifiant `lelabs-crm`,
code d'autorisation avec PKCE `S256`, URL de retour exacte `https://crm.lelabs.tech/auth/retour`.
Il n'a aucun secret client et ne lit aucun rôle du realm : une connexion SSO ouvre une session si
et seulement si un compte CRM existe à la même adresse, vérifiée auprès du SSO.

## Ce qui n'est pas exposé

Ni PostgreSQL, ni Kong, ni MinIO, ni l'API interne de `mail-sync` : aucun port n'est publié hors
de `8080`. Aucune intégration entrante n'est prévue ; le courrier est relevé en IMAP auprès des
serveurs des utilisateurs, jamais reçu en SMTP.

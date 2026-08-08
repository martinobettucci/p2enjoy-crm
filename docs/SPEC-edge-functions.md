# Spécification — fonctions edge

Contrat exécutable de `CRM-016`, créé à la suite de l'arbitrage du responsable consigné dans
`docs/JOURNAL.md`, décision 260, et du constat INC-007.

- Unité de backlog : `CRM-016` (`docs/BACKLOG.md`).
- Architecture : `docs/DAT.md` §2, §3.5, §3.7, §6 et §15.
- Déploiement : `docs/PROD_MIGRATIONS.md` §4 à §6.
- État : contrat spécifié ; mise en œuvre de `CRM-016` en cours.

---

## 1. Périmètre

`CRM-016` livre le **porteur**, pas encore les deux fonctions métier qui l'utiliseront :

- un service commun `functions`, fondé sur Supabase Edge Runtime ;
- un routeur Deno sous `supabase/functions/main/` ;
- une route publique unique `/functions/v1/` dans Kong ;
- une fonction sans effet `example`, appelée par les preuves ;
- les tests unitaires, d'API et d'intégration propres à cette surface.

L'invitation d'un membre reste due par `CRM-070`. Les webhooks sortants signés restent dus par
`CRM-073`. La logique métier reste dans PostgreSQL et les connexions longues IMAP/SMTP restent
dans `mail-sync` : cette unité ne déplace ni règle, ni donnée, ni responsabilité existante.

## 2. Runtime et assemblage

Le service se nomme `functions` et son conteneur `p2enjoy-functions`. Il appartient à
`docker-compose.yml`, donc aux assemblages de développement **et** de production. Il ne publie
aucun port hôte : Kong est son unique entrée depuis l'extérieur du réseau Compose.

Kong attend `functions: service_healthy`. Cette dépendance a deux effets nécessaires : une route
ne devient pas saine avant sa cible, et l'ajout de `CRM-016` modifie réellement la définition du
conteneur Kong. Une simple modification de son fichier bind-mounté ne le recrée pas ; sans ce
changement de graphe, un `./runDev.sh` sur une pile déjà lancée conserverait en mémoire l'ancienne
configuration et `/functions/v1/` rendrait 404 jusqu'à une intervention manuelle.

| Propriété | Contrat |
|---|---|
| Image | `public.ecr.aws/supabase/edge-runtime:v1.74.2` |
| Empreinte mesurée | `sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45` |
| Écoute interne | `0.0.0.0:9000` |
| Point d'entrée | `start --policy per_request --main-service /home/deno/functions/main` |
| Sources | `./supabase/functions:/home/deno/functions:ro` |
| Redémarrage | `unless-stopped` dans le commun, `always` en production |
| Limite d'un worker | 128 Mio et 10 secondes de temps mur |

La politique `per_request` est une exigence observée, pas un réglage décoratif. Avec la politique
par défaut `per_worker`, l'appel réel réussit mais le runtime 1.74.2 écrit ensuite
`wall clock duration warning` et `early termination has been triggered`. Le même worker, le même
appel et la politique `per_request` rendent HTTP 200 avec des journaux vides. Le service ne
filtre donc aucun message et ne passe pas en mode `--quiet` : il supprime la cause du bruit.

Le service reçoit seulement les variables nécessaires aux fonctions de confiance :
`SUPABASE_URL=http://kong:8000`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Le secret de
signature JWT n'est pas propagé. Aucune valeur n'est journalisée, retournée par `example` ou
inscrite dans les sources.

## 3. Arborescence et traçabilité

```text
supabase/functions/
├── main/
│   ├── index.ts              service principal et création des workers
│   ├── router.ts             parsing pur et validation du nom de fonction
│   └── router.test.ts        preuve unitaire du routage
└── example/
    ├── handler.ts            contrat HTTP pur
    ├── handler.test.ts       preuve unitaire de la fonction
    └── index.ts              adaptation Deno.serve
```

Chaque fichier d'exécution porte `@spec CRM-016` et les sections exactes de ce document. Les tests
portent `@verifies CRM-016`. Aucune dépendance distante n'est importée : `Deno.serve`, `Request`,
`Response`, `crypto.randomUUID` et `EdgeRuntime.userWorkers` suffisent.

## 4. Routeur principal

Kong retire le préfixe `/functions/v1/`. Le routeur reçoit donc `/example` ou
`/example/sous-chemin`. Le premier segment est le nom de fonction ; il doit satisfaire
`^[a-z0-9](?:[a-z0-9-]{0,62})$`. Un nom absent ou invalide rend respectivement 400 ou 404. Un
répertoire absent rend 404 sans tenter de créer un worker. Les segments suivants sont conservés
dans la requête transmise à la fonction.

Pour chaque requête valide, le routeur :

1. reprend un `x-request-id` entrant conforme à `^[A-Za-z0-9._:-]{1,128}$`, ou produit un UUID ;
2. crée un worker depuis `/home/deno/functions/<nom>` avec les bornes du §2 ;
3. transmet la vraie requête avec `worker.fetch` ;
4. renvoie le statut, le corps et les en-têtes de la fonction, complétés par `x-request-id` ;
5. ne journalise que le nom de fonction, la méthode, le statut, la durée et l'identifiant de
   corrélation — jamais URL complète, corps, clé, jeton ni en-tête d'autorisation.

Une fonction inconnue est un refus attendu, pas une erreur serveur. Une panne inattendue du
worker rend 502 avec le seul contrat public `{ "error": "function_unavailable", "request_id":
"…" }`. Le diagnostic structuré reste dans les journaux internes, sans recopier le message brut
susceptible de contenir un chemin ou une donnée.

### 4.1 Santé interne

`GET /__health` est traité par le service principal, sans créer de worker. Il rend exactement
`200`, `content-type: application/json` et `{ "status": "ok" }`. Le healthcheck du conteneur
effectue une vraie requête HTTP sur `127.0.0.1:9000` avec Bash et consomme la réponse entière.

Ce chemin n'est pas une preuve fonctionnelle publique. S'il est demandé à travers Kong, il reste
derrière la même clé d'API que le reste de `/functions/v1/` ; sans clé, la passerelle rend 401. La
sonde interne prouve que le service principal accepte des requêtes ; l'appel d'`example` prouve
séparément que la création d'un worker fonctionne.

## 5. Route Kong et sécurité

Kong déclare `http://functions:9000/` derrière `/functions/v1/`, avec `strip_path: true` et les
plugins `cors`, `key-auth`, `request-transformer` puis `acl`. Les groupes `anon` et `admin` sont
admis. Le transformateur conserve un vrai bearer utilisateur ou traduit la clé publique/secret
opaque vers le JWT interne, exactement comme les routes REST existantes.

Conséquences opposables :

- sans `apikey`, ou avec une clé fausse, Kong rend 401 sans joindre le runtime ;
- la clé anonyme valide peut appeler une fonction explicitement publique ;
- ce filtrage ne vaut **pas** autorisation métier. Toute future fonction privilégiée authentifie
  le porteur et vérifie côté backend le rôle ou la politique nécessaires avant d'employer la clé
  de service ;
- le runtime n'a aucun port direct depuis l'hôte, en développement comme en production.

`example` est volontairement publique derrière la clé anonyme : elle ne lit aucune donnée, ne
prend aucun paramètre et ne divulgue aucune configuration. Elle est la sonde fonctionnelle stable
du produit, pas une porte d'administration.

## 6. Fonction `example`

`POST /functions/v1/example` rend :

```json
{
  "function": "example",
  "runtime": "edge-runtime",
  "message": "Fonction edge opérationnelle"
}
```

Le statut est 200 et le type `application/json; charset=utf-8`. `GET` et toute autre méthode
métier rendent 405 avec `Allow: POST, OPTIONS`. `OPTIONS` rend 204 pour que la fonction demeure
correcte même appelée hors du plugin CORS de Kong. Le corps entrant est ignoré ; aucune donnée
n'est persistée et aucun seed n'est requis.

## 7. Preuves de `CRM-016`

### 7.1 Unitaires

Vitest importe les modules purs, à côté des sources. Les cas figés sont : nom simple, sous-chemin,
nom absent, caractères interdits, nom trop long, POST nominal, OPTIONS et méthode refusée. Les
tests ne remplacent pas `Deno.serve` ou le runtime : ils isolent seulement le parsing et le
contrat HTTP déterministes.

### 7.2 API et intégration

Le projet Playwright `api` appelle la vraie passerelle locale :

1. POST sans clé : 401 ;
2. POST avec clé fausse : 401 ;
3. POST avec la clé anonyme : 200, JSON exact et `x-request-id` ;
4. GET avec la clé anonyme : 405 et `Allow` exact ;
5. nom inconnu avec la clé anonyme : 404 générique ;
6. préflight CORS : origine, méthode et en-têtes autorisés.

La preuve inspecte ensuite le service : conteneur sain, aucun port hôte, montage en lecture seule,
commande `per_request`, image exacte et journaux sans `warning`, `error`, `panic` ni terminaison
d'isolate. Une contre-épreuve appelle directement le port public de Kong ; aucune invocation du
port interne ne peut satisfaire la Definition of Done.

### 7.3 Régression globale

`scripts/verify-functions.sh` regroupe les preuves propres. `scripts/verify-stack.sh` compte le
service commun et l'appel via Kong. Le harnais global rejoue SQL, API complète, UI Chromium,
messagerie, unitaires, quatre compilations TypeScript, build et dégradations. L'interface ne change
pas : aucune capture nouvelle ni modification du seed ne sont attendues, mais la suite UI complète
reste obligatoire pour constater une console navigateur sans avertissement, erreur ou
`pageerror`.

## 8. Déploiement et retour arrière

Le premier déploiement doit tirer l'image épinglée, rendre `supabase/functions/` disponible au
même chemin que le Compose, recréer `functions`, puis recréer `kong` pour charger sa route. Le
contrôle externe appelle `POST /functions/v1/example` avec la clé publique de l'environnement et
exige le JSON du §6. Aucun secret n'est ajouté et aucune migration SQL n'est due.

Le retour arrière recrée l'ancien `kong.yml`, arrête `functions` puis retire le service de
l'assemblage. Aucune donnée ne peut être perdue : `example` n'en écrit aucune et le runtime ne
possède aucun volume persistant.

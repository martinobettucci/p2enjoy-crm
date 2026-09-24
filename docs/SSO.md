# Intégrer une application à oauth.lelabs.tech

Pour les équipes qui branchent une application sur ce SSO.

## Le seul point d'entrée à connaître

```
https://oauth.lelabs.tech/realms/lelabs/.well-known/openid-configuration
```

Donnez cette URL de découverte à votre bibliothèque OIDC plutôt que de recopier
les points d'entrée un par un : elle reste juste si le service évolue.

L'`issuer` à attendre dans les jetons est exactement
`https://oauth.lelabs.tech/realms/lelabs`. Il ne change pas selon le nom par
lequel on entre : une requête arrivant sur `www.oauth.lelabs.tech` renvoie le
même. Si votre application rejette un jeton pourtant émis, c'est presque
toujours qu'elle en attend un autre.

N'intégrez **que** le realm `lelabs`. Le realm `master` porte l'administration
de l'instance et n'a aucun utilisateur final.

## Les trois états d'un compte, et ce qu'ils veulent dire

C'est le cœur de ce document. Le domaine `lelabs.tech` fixe **deux règles qui
valent pour toute application**. Elles ne sont pas des recommandations, et elles
ne vous laissent pas le choix ; tout le reste vous appartient.

| État | Ce qui a été établi | Ce que votre application en fait |
| --- | --- | --- |
| **aucun rôle** | La personne détient l'adresse e-mail déclarée. Rien d'autre : personne n'a contrôlé qu'il s'agit d'un être humain réel. | **Aucun accès.** Règle du domaine, pas un choix d'application. |
| **`verified`** | Un administrateur a consulté un profil LinkedIn ou Facebook public déclaré par la personne, et constaté qu'elle est réelle. Ce n'est **pas** une vérification d'identité officielle : aucun document n'a été contrôlé. | **L'accès au service**, au niveau ordinaire que vous définissez. |
| **`admin`** | La personne exploite le SSO : elle vérifie les autres comptes et déclare les intégrations. | **Les droits d'administration de votre application**, d'office. |

### Les deux règles du domaine

1. **Aucune application n'est accessible sans `verified`.** Un compte sans rôle
   est un compte dont personne n'a encore constaté qu'il correspond à une
   personne réelle. Il s'authentifie — la connexion réussit — et votre
   application lui refuse l'accès en disant quoi faire : demander sa
   vérification. C'est une attente, pas une erreur, et cela se dit comme telle.
2. **`admin` vaut administrateur chez vous.** Qui porte ce rôle reçoit d'office
   les droits d'administration de votre application. C'est le rôle
   d'exploitation du domaine : la personne qui vérifie les comptes et déclare
   les intégrations administre aussi ce qui en dépend.

Ces deux règles fixent un **plancher** : qui entre, et qui administre. Vous
pouvez être plus strict — n'ouvrir qu'aux porteurs d'`admin`, par exemple, si
votre service ne s'adresse qu'à eux. Vous ne pouvez pas être plus permissif.

### Ce qui reste entièrement vôtre

Tout ce qui vient **après** l'entrée. Rôles métier, propriété des objets,
appartenance à une équipe, quotas, lecture seule, étapes d'un processus : le SSO
ne les connaît pas et n'a pas à les connaître. Il dit qui est la personne et où
elle en est dans le domaine ; ce qu'elle a le droit de faire chez vous est votre
affaire, et se décide sur votre serveur.

Deux pièges que ces règles ne lèvent pas :

- **`verified` atteste d'une personne réelle, pas d'une identité prouvée.** Si
  votre application a besoin d'une identité au sens légal, ce rôle ne suffit pas.
- **Un rôle se retire.** Relisez-le à chaque requête, depuis le jeton, et ne le
  mettez pas en cache au-delà de sa durée de vie.

### Comment la vérification se produit

Une personne s'inscrit librement et déclare nom, prénom, téléphone et l'adresse
d'un profil public. Elle consent explicitement à ce que ces données servent à la
vérifier ; ce consentement est enregistré avec son compte.

Elle vérifie son adresse e-mail, pose son mot de passe, et son compte existe —
sans rôle. Un porteur d'`admin` consulte ensuite le profil déclaré et attribue
`verified` d'un clic. **Ce geste est humain : il n'est ni automatique, ni
immédiat.** Votre application ne doit pas supposer qu'un compte fraîchement créé
deviendra vérifié, ni quand.

Le rôle peut aussi être **retiré**. Ne mettez pas en cache un état de
vérification au-delà de la durée de vie du jeton.

## Lire les rôles dans un jeton

Les rôles de realm arrivent dans le jeton d'accès sous `realm_access.roles` :

```json
{
  "iss": "https://oauth.lelabs.tech/realms/lelabs",
  "sub": "e3b0c442-...",
  "email": "personne@exemple.tech",
  "email_verified": true,
  "realm_access": { "roles": ["verified"] }
}
```

Un compte sans rôle n'a pas de `realm_access.roles` vide et prévisible : il porte
les rôles techniques par défaut du realm. **Testez la présence de `verified`, ne
déduisez rien du nombre de rôles.**

Vérifiez toujours la signature du jeton contre les clés publiées par la
découverte, ainsi que l'`issuer`. **Ne décidez jamais d'une autorisation à partir
d'une valeur lue côté navigateur** : ce que votre interface affiche est un
confort, la règle s'applique sur votre serveur.

## Déclarer votre client

Vous n'avez pas de dépôt à modifier ni de déploiement à attendre : vous
**composez une déclaration**, vous la donnez à un administrateur du realm, et
vous recevez en retour un bloc d'intégration complet.

L'administrateur la colle dans `https://oauth.lelabs.tech/verification/`, onglet
**Intégrations**. Le service valide, crée le client, et produit la réponse.

### La déclaration

Du texte, une clé par ligne, `CLÉ=valeur`. Les lignes vides et celles commençant
par `#` sont ignorées. Une clé répétable se répète, une ligne par valeur.

```
CLIENTID=mon-application
NOM=Mon application
TYPE=serveur
REDIRECT=https://mon-application.lelabs.tech/auth/retour
REDIRECT=https://www.mon-application.lelabs.tech/auth/retour
DECONNEXION=https://mon-application.lelabs.tech/connexion
ROLE=verified
SECRET_VAR=MON_APP_OIDC_CLIENT_SECRET
```

| Clé | Rôle | Obligatoire | Défaut | Répétable |
| --- | --- | --- | --- | --- |
| `CLIENTID` | identifiant du client | oui | — | non |
| `NOM` | nom lisible, affiché aux personnes | non | la valeur de `CLIENTID` | non |
| `TYPE` | `serveur` (confidentiel, avec secret) ou `navigateur` (public, sans secret) | non | `serveur` | non |
| `REDIRECT` | URL **exacte** qui reçoit le code d'autorisation | oui | — | oui |
| `DECONNEXION` | URL **exacte** où revenir après déconnexion | non | aucune | oui |
| `ORIGINE` | origine autorisée à appeler le service depuis un navigateur | non | les origines des `REDIRECT` | oui |
| `ACCUEIL` | adresse de l'application, affichée dans l'espace de compte | non | l'origine du premier `REDIRECT` | non |
| `ROLE` | rôle de realm dont votre application dépend | non | aucun | oui |
| `SECRET_VAR` | nom de la variable où votre environnement porte le secret | non | `OIDC_CLIENT_SECRET` | non |
| `HORS_LIGNE` | `oui` pour demander `offline_access` | non | `non` | non |

Si vous servez un apex **et** son `www`, donnez les deux, partout : les URL sont
comparées caractère par caractère, et une différence d'un seul caractère fait
échouer la connexion sans message utile.

### Apparaître dans le portail des personnes

Une fois le client créé, votre application figure d'office dans l'onglet
*Applications* de l'espace de compte, à l'adresse
`https://oauth.lelabs.tech/realms/lelabs/account`. Les personnes du domaine y
trouvent donc votre service sans que personne ne leur en ait donné l'adresse, et
**avant** même de s'y être connectées une première fois.

Deux clés de votre déclaration décident de ce qu'elles y voient :

- `NOM` est le **libellé** affiché. Nommez-y la page que l'entrée ouvre, pas le
  projet : c'est ce que la personne lit pour décider de cliquer.
- `ACCUEIL` est le **lien**. Par défaut, c'est l'origine de votre premier
  `REDIRECT` — presque toujours juste. Ne le donnez que si votre application
  s'ouvre ailleurs que sur sa racine, par exemple sous un chemin.

Rien d'autre n'est à demander : l'inscription au portail n'est pas une option de
la déclaration, elle est systématique.

### Ce qui est refusé, et pourquoi

- **Un identifiant déjà pris.** Une intégration vivante ne se réécrit pas par un
  copier-coller.
- **Toute URL avec `*` ou un chemin générique.** Une redirection non maîtrisée
  est un vol de code d'autorisation.
- **Une URL qui n'est pas en `https://`**, sauf `http://localhost` et
  `http://127.0.0.1`, réservés au développement.
- **Un `ROLE` qui n'existe pas dans le realm.** Le service ne crée pas de rôle
  sur la foi d'un texte collé : faites-le créer, puis redéclarez.
- **Les portées au-delà d'`openid`, `profile` et `email`**, pour la raison dite
  plus bas : le consentement des personnes ne couvre pas leur transmission.

Le refus est rendu ligne par ligne, avec ce qu'il faut corriger. Rien n'est créé
tant qu'une ligne est fautive.

### Ce que vous recevez

Un bloc au format `llms.txt`, lisible par une machine comme par une personne :
émetteur, points d'entrée, identifiant retenu, URL **réellement enregistrées**,
portées, rôles et contrôles attendus sur le jeton.

**Il ne contient jamais le secret.** Il nomme la variable où le poser. Le secret
s'affiche une seule fois à l'administrateur, qui le pose directement comme
variable secrète de l'environnement de votre application : il ne transite ni par
courriel, ni par messagerie, ni par un dépôt.

### Ce qui est imposé à tout client, quoi que demande la déclaration

PKCE `S256`, y compris pour un client confidentiel. Le code d'autorisation seul :
le flux implicite et l'octroi direct par mot de passe sont **refusés par le
serveur**, pas simplement découragés. Et des URL exactes.

### Vérifier par vous-même que le client existe

Cette commande ne lit qu'un point d'entrée public et ne modifie rien :

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/auth?client_id=VOTRE_CLIENTID&response_type=code&scope=openid&redirect_uri=VOTRE_REDIRECT_ENCODEE'
```

**Le retour qui porte l'information est `400`** : le client n'existe pas, ou
l'URL n'est pas celle qui a été enregistrée. Les deux cas se ressemblent vus de
l'extérieur, et c'est voulu. Une URL non déclarée ne provoque jamais de
redirection : le refus reste chez le fournisseur, affiché « Paramètre invalide :
redirect_uri ».

**Tout le reste est une acceptation** : le client existe, et votre URL est
acceptée au caractère près. Dans un contrôle automatisé, écrivez donc le refus —
`!= 400` — jamais `== 200` ni `== 302` : la forme de l'acceptation dépend du
client, et un contrôle écrit sur elle signalerait une panne sur une intégration
parfaitement saine.

| Acceptation | Ce qu'elle dit de plus |
| --- | --- |
| `302` vers **votre** URL, avec `error=invalid_request` et `error_description=Missing+parameter%3A+code_challenge_method` | le client exige PKCE et refuse une demande qui n'en porte pas. C'est le retour de tout client déclaré ici, puisque PKCE `S256` leur est imposé. |
| `200`, avec l'écran de connexion | le client n'exige pas PKCE : la demande est complète telle quelle, et le fournisseur affiche la page de connexion. |

Relevé le 2026-09-24 : **tout client de ce realm rend la première forme**, PKCE
leur étant imposé sans exception. La seconde ligne reste néanmoins dans ce
tableau, parce qu'elle décrit ce que le point d'entrée fait — et qu'un contrôle
écrit sur une forme d'acceptation casse le jour où cette forme change.

## Adresse e-mail vérifiée

La revendication `email_verified` dit si la détention de la boîte a été prouvée.
Elle est indépendante du rôle `verified` : on peut avoir une adresse vérifiée
sans être une personne vérifiée, et l'inverse est possible si un administrateur
vérifie un compte dont l'adresse ne l'est pas encore.

## Fermer une session

`end_session_endpoint` figure dans la découverte. Fermer la session de votre
seule application ne déconnecte pas la personne du SSO : c'est l'objet d'un SSO.

Une personne voit et ferme ses sessions depuis
`https://oauth.lelabs.tech/realms/lelabs/account`, section *Appareils*.

## Ce que vous ne devez pas faire

- Ne stockez pas les mots de passe : vous n'en voyez jamais.
- N'appelez pas l'API d'administration de Keycloak depuis une application
  intégrée. Si vous croyez en avoir besoin, dites-le à l'équipe qui exploite ce
  Spark : c'est presque toujours le signe d'un besoin mal placé.
- Ne recopiez pas le téléphone ni le profil déclarés par une personne : ils ont
  été recueillis pour la vérification, et le consentement obtenu ne couvre que
  cet usage.
- Ne mettez pas en cache les clés de signature sans respecter leur rotation :
  suivez le `jwks_uri` de la découverte.
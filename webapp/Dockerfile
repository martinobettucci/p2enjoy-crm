# @spec CRM-007 (docs/BACKLOG.md) — image de développement de la webapp
# @spec CRM-015 (docs/BACKLOG.md) — secret BuildKit facultatif du registre npm
# @spec docs/SPEC-webapp.md §12.1 (développement) ; docs/DAT.md §3.1, §9 ; README.md §6
#
# Cette image ne sert **que** le développement : elle exécute Vite, avec les sources montées
# depuis le dépôt. Le build de production, lui, est produit sur l'hôte par `npm run build` et
# monté en lecture seule dans Caddy (docker-compose.prod.yml, README.md §8) : aucune image
# n'est nécessaire pour servir des fichiers statiques, et en fabriquer une ajouterait un
# artefact de plus à construire, à publier et à faire dériver.
#
# La version de Node est celle du dépôt — `.nvmrc` et `engines.node` demandent 24. C'est le
# seul endroit du projet où ce prérequis est réellement exercé.

FROM node:24-alpine

WORKDIR /app

# Les dépendances sont installées à la construction, pas au démarrage : un conteneur qui
# installe à chaque `up` transforme une panne de réseau en panne de démarrage.
#
# Le secret `npm_ca` est **facultatif** : derrière un proxy HTTPS qui interpose son propre
# certificat, `npm ci` échoue en `SELF_SIGNED_CERT_IN_CHAIN` tant que l'autorité n'est pas
# connue du conteneur. Le fichier n'entre jamais dans l'image ni dans le dépôt ; sans lui, la
# construction se déroule normalement.
#
#   docker build --secret id=npm_ca,src=/chemin/vers/ca.crt -f webapp/Dockerfile .
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca,required=false \
	sh -eu -c 'if [ -s /run/secrets/npm_ca ]; then echo "npm_ca: actif"; npm config set cafile /run/secrets/npm_ca; else echo "npm_ca: inactif"; fi; \
	npm ci --no-audit --no-fund; npm config delete cafile || true'

# Les sources sont montées par Compose en développement. Elles sont tout de même copiées ici
# pour que l'image reste exécutable seule, ce qui rend son échec diagnosticable.
COPY . .

EXPOSE 5173

# `--host` est requis : sans lui, Vite n'écoute que sur la boucle locale **du conteneur**, et
# le port publié ne mène nulle part.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

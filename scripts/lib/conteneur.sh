#!/usr/bin/env bash
# @spec CRM-115 (docs/BACKLOG.md) — tranche T2 : plus aucun nom de conteneur en développement
# @spec docs/SPEC-pile-par-session.md §6 (un conteneur se désigne par son service Compose), §6 bis (la production
#       garde ses noms) ; docs/JOURNAL.md décision 702
#
# Désigne un conteneur de la pile de développement de CE checkout par son SERVICE Compose, jamais par un nom écrit à
# la main. Compose nomme les conteneurs à partir du projet : deux piles de deux projets ne se confondent pas, et aucun
# appelant ne répète une convention de nommage.
#
# Chargée par `scripts/lib/env.sh`, à côté de `compose_dev`, et directement par les harnais : ceux-ci ne chargent pas
# `env.sh`, dont plusieurs fonctions portent le même nom que les leurs. Elle n'exécute rien à l'inclusion.
#
# Le fichier d'environnement est `.env` à la racine, ou `P2ENJOY_ENV_FILE`, comme dans `env.sh`.

# conteneur <service> — rend le NOM du conteneur du service, arrêté compris (un passage one-shot terminé reste
# inspectable). Le nom, et non l'identifiant : une reconstruction de la base recrée le conteneur sous le même nom,
# avec un autre identifiant (docs/SPEC-test-harness.md §3.6). Échoue en nommant le service si la pile ne le porte pas.
conteneur() {
	local service=${1:-} racine fichier nom
	if [ -z "$service" ]; then
		echo "conteneur : un nom de service Compose est attendu (db, rest, kong, mail-sync…)." >&2
		return 2
	fi
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	fichier=${P2ENJOY_ENV_FILE:-$racine/.env}
	nom=$(docker compose --env-file "$fichier" -f "$racine/docker-compose.yml" -f "$racine/docker-compose.dev.yml" \
		ps -a --format '{{.Name}}' "$service" 2>/dev/null | head -n 1)
	if [ -z "$nom" ]; then
		echo "conteneur : aucun conteneur du service « $service » dans la pile de développement — lancez ./runDev.sh." >&2
		return 1
	fi
	printf '%s\n' "$nom"
}

# conteneur_en_marche <service> <nom de production> — pour les seuls scripts que la PRODUCTION exécute aussi
# (`scripts/backup.sh`, `scripts/restore-drill.sh`). Sous le profil `dev`, le conteneur du service ; sous tout autre
# profil, ou sans fichier d'environnement (hôte de secours, cellule), le NOM DE PRODUCTION, et la commande d'avant
# `CRM-115` à l'identique : le chemin de production ne change pas (docs/JOURNAL.md décision 703, option B ;
# docs/SPEC-pile-par-session.md §6 bis). Rend le nom s'il est EN MARCHE, une chaîne vide sinon — la forme que ces
# scripts attendaient.
conteneur_en_marche() {
	local service=${1:?service attendu} nom=${2:?nom de production attendu} racine fichier profil
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	fichier=${P2ENJOY_ENV_FILE:-$racine/.env}
	profil=$(sed -n 's/^P2ENJOY_ENV_PROFILE=//p' "$fichier" 2>/dev/null | tail -n 1 | tr -d "\"'\r")
	if [ "$profil" = dev ]; then
		nom=$(conteneur "$service" 2>/dev/null) || return 0
	fi
	docker ps --filter "name=^/${nom}$" --filter "status=running" --format '{{.Names}}'
}

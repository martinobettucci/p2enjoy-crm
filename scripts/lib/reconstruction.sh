# shellcheck shell=bash
# @spec CRM-111 (docs/BACKLOG.md) — tranche T1 bis : restaurer par reconstruction (INC-289)
# @spec docs/SPEC-test-harness.md §3.5 (reconstruire à neuf), §3.6 (le mode opératoire) ;
#       docs/DAT.md §3.2 (invariant révisé), §3.2 bis ; docs/JOURNAL.md décisions 675 et 682
#
# Un harnais qui DÉGRADE la structure de la base de développement la restaure en la RECONSTRUISANT : base
# vidée, répertoire appliqué dans l'ordre par le vrai runner, seed rejoué. Rejouer le répertoire sur une base
# peuplée ne restaure plus : un retrait de colonne ou un changement de signature rend les fichiers antérieurs
# non rejouables (INC-289, mesuré : `0089` échoue déjà depuis `0099`).
#
# Sont reconstruits la base et ses seuls DÉRIVÉS — mesuré, décision 682 : gardées, les boîtes de Stalwart et
# l'état de `mail-sync` décrivent les affaires de la base détruite, et le seed échoue. Le reste de la pile
# (MinIO, ClamAV, Keycloak, Kong, webapp, connecteur) n'est ni détruit ni recréé.
#
# RÉSERVÉ AU DÉVELOPPEMENT : refusé, sans rien arrêter, si le fichier d'environnement ne porte pas le profil
# `dev`. Deux sessions sur la même pile se suivent par un verrou de l'hôte.
#
# Usage : reconstruire_base_dev [--sans-seed]   — code 0 si et seulement si le constat final est tenu.

# Les conteneurs qui tiennent une connexion, un cache de schéma, un journal ou un état de la base détruite.
RECONSTRUCTION_SERVICES=(db migrations-runner storage realtime rest meta studio mail-sync stalwart stalwart-init roundcube)
# Les volumes nommés qui ne sont qu'un dérivé de la base (docs/SPEC-test-harness.md §3.6).
RECONSTRUCTION_VOLUMES=(mail-sync-state stalwart-data roundcube-data)
RECONSTRUCTION_VERROU=${RECONSTRUCTION_VERROU:-/tmp/p2enjoy-crm-reconstruction.lock}
# Attente maximale du verrou, en secondes : une reconstruction dure une minute, une série de harnais davantage.
RECONSTRUCTION_ATTENTE=${RECONSTRUCTION_ATTENTE:-1800}

reconstruire_base_dev() {
	local racine fichier profil seed=true
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	fichier=${ENV_FILE:-$racine/.env}
	case "${1:-}" in
		'') ;;
		--sans-seed) seed=false ;;
		*) echo "reconstruire_base_dev : option inconnue « $1 »." >&2; return 2 ;;
	esac
	profil=$(sed -n 's/^P2ENJOY_ENV_PROFILE=//p' "$fichier" 2>/dev/null | tail -n 1 | tr -d "\"'\r")
	if [ "$profil" != dev ]; then
		echo "reconstruire_base_dev : profil « ${profil:-<vide>} » dans $fichier, « dev » exigé — refus, rien n'est arrêté." >&2
		return 1
	fi
	(
		set -euo pipefail
		exec 9>"$RECONSTRUCTION_VERROU"
		flock -w "$RECONSTRUCTION_ATTENTE" 9 \
			|| { echo "reconstruire_base_dev : verrou $RECONSTRUCTION_VERROU non obtenu en ${RECONSTRUCTION_ATTENTE} s — rien n'est arrêté." >&2; exit 1; }
		cd "$racine"
		# Comme `./runDev.sh` (INC-291) : une construction de Compose 5 refuserait sinon le paquet CA.
		export BUILDX_BAKE_ENTITLEMENTS_FS=0
		compose() { docker compose --env-file "$fichier" -f docker-compose.yml -f docker-compose.dev.yml "$@"; }
		local projet image donnees=supabase/docker/volumes/db/data volume attendus inscrits hors_sante
		projet=$(compose config --format json | jq -r '.name')
		image=$(compose config --format json | jq -r '.services.db.image')
		[ -n "$projet" ] && [ -n "$image" ] && [ "$image" != null ] \
			|| { echo "reconstruire_base_dev : projet ou image du service db introuvable dans l'assemblage." >&2; exit 1; }

		compose rm -sf "${RECONSTRUCTION_SERVICES[@]}" >/dev/null 2>&1
		for volume in "${RECONSTRUCTION_VOLUMES[@]}"; do
			docker volume rm -f "${projet}_${volume}" >/dev/null
		done
		# Le cluster appartient au compte du conteneur : un conteneur jetable de la même image le détruit,
		# comme `./resetMe.sh`.
		docker run --rm -v "$racine/$(dirname "$donnees"):/cible" --entrypoint /bin/sh "$image" \
			-c "rm -rf /cible/$(basename "$donnees")"
		[ ! -e "$donnees" ] || { echo "reconstruire_base_dev : $donnees subsiste après destruction." >&2; exit 1; }

		compose up -d --wait >/dev/null 2>&1 \
			|| { echo "reconstruire_base_dev : la pile ne remonte pas (docker compose up --wait)." >&2; exit 1; }
		if [ "$seed" = true ]; then
			P2ENJOY_ENV_FILE="$fichier" supabase/seed/apply-seed.sh >/dev/null 2>&1 \
				|| { echo "reconstruire_base_dev : le seed échoue sur la base reconstruite." >&2; exit 1; }
		fi

		# Constat : une base NEUVE construite dans l'ordre porte une ligne d'adoption par fichier du répertoire.
		attendus=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
		inscrits=$(docker exec -i p2enjoy-db psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 \
			-c "select count(*) filter (where mode = 'adoption') || ':' || count(*) from app.migrations_appliquees")
		[ "$inscrits" = "$attendus:$attendus" ] \
			|| { echo "reconstruire_base_dev : registre « $inscrits » (adoption:total), $attendus fichiers attendus en adoption." >&2; exit 1; }
		hors_sante=$(compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" {print $1}' | tr '\n' ' ')
		[ -z "$hors_sante" ] \
			|| { echo "reconstruire_base_dev : services hors d'état healthy : $hors_sante" >&2; exit 1; }
	)
}

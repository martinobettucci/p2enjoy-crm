# shellcheck shell=bash
# @spec CRM-111 (docs/BACKLOG.md) — tranche T1 bis : restaurer par reconstruction (INC-289)
# @spec CRM-115 (docs/BACKLOG.md) — tranche T4 : la reconstruction vérifie l'emplacement de ce checkout au registre des
#       sessions avant de rien arrêter, et garde son verrou et son journal dans le `P2ENJOY_TMP` de l'emplacement
#       (docs/SPEC-pile-par-session.md §3, §4.3)
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
#         reconstruire_base_dev --migrations DIR — preuve d'idempotence locale de `scripts/verify-migrations.sh` :
#           sur la base neuve, seuls `db` et `storage` remontent, et le VRAI runner applique le répertoire DIR
#           (par `MIGRATIONS_DIR`) au lieu de `supabase/migrations`. Son journal sort sur la sortie standard et
#           son code est rendu. La pile reste à demi remontée et le registre porte DIR : une reconstruction
#           ordinaire doit suivre (docs/SPEC-test-harness.md §3.6).

# Les conteneurs qui tiennent une connexion, un cache de schéma, un journal ou un état de la base détruite.
# @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
# shellcheck source=scripts/lib/conteneur.sh
source "$(dirname "${BASH_SOURCE[0]}")/conteneur.sh"
# shellcheck source=scripts/lib/emplacement.sh
source "$(dirname "${BASH_SOURCE[0]}")/emplacement.sh"

RECONSTRUCTION_SERVICES=(db migrations-runner storage realtime rest meta studio mail-sync stalwart stalwart-init roundcube)
# Les volumes nommés qui ne sont qu'un dérivé de la base (docs/SPEC-test-harness.md §3.6).
RECONSTRUCTION_VOLUMES=(mail-sync-state stalwart-data roundcube-data)
# Le verrou et le journal vivent dans le répertoire de travail de l'EMPLACEMENT : deux piles de deux checkouts se
# reconstruisent sans s'attendre, deux reconstructions d'une même pile s'excluent (CRM-115 T4).
_RECONSTRUCTION_TMP=$(emplacement_tmp "${ENV_FILE:-${P2ENJOY_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env}}")
RECONSTRUCTION_VERROU=${RECONSTRUCTION_VERROU:-$_RECONSTRUCTION_TMP/reconstruction.lock}
# Attente maximale du verrou, en secondes : une reconstruction dure une minute, une série de harnais davantage.
RECONSTRUCTION_ATTENTE=${RECONSTRUCTION_ATTENTE:-1800}
# INC-298 : la sortie de la remontée et du seed est GARDÉE, et sa fin citée dans le motif d'un échec — un échec
# intermittent dont l'étape fautive est jetée ne se diagnostique pas. Réécrit à chaque reconstruction.
RECONSTRUCTION_JOURNAL=${RECONSTRUCTION_JOURNAL:-$_RECONSTRUCTION_TMP/reconstruction.log}

reconstruire_base_dev() {
	local racine fichier profil seed=true repertoire=''
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	fichier=${ENV_FILE:-$racine/.env}
	case "${1:-}" in
		'') ;;
		--sans-seed) seed=false ;;
		--migrations)
			repertoire=${2:-}
			[ -d "$repertoire" ] || { echo "reconstruire_base_dev : --migrations exige un répertoire existant." >&2; return 2; }
			repertoire=$(cd "$repertoire" && pwd) ;;
		*) echo "reconstruire_base_dev : option inconnue « $1 »." >&2; return 2 ;;
	esac
	profil=$(sed -n 's/^P2ENJOY_ENV_PROFILE=//p' "$fichier" 2>/dev/null | tail -n 1 | tr -d "\"'\r")
	if [ "$profil" != dev ]; then
		echo "reconstruire_base_dev : profil « ${profil:-<vide>} » dans $fichier, « dev » exigé — refus, rien n'est arrêté." >&2
		return 1
	fi
	# La pile mesurée est bien celle de CE checkout, à son emplacement, sur la VM où elle a été lancée (§4.3) : sinon
	# refus, rien n'est arrêté.
	emplacement_verifier "$racine" "$fichier" >/dev/null \
		|| { echo "reconstruire_base_dev : l'emplacement de ce checkout n'est pas vérifié — refus, rien n'est arrêté." >&2; return 1; }
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

		if [ -n "$repertoire" ]; then
			compose up -d --wait db storage >/dev/null 2>&1 \
				|| { echo "reconstruire_base_dev : db et storage ne remontent pas." >&2; exit 1; }
			compose run --rm --no-deps -v "$repertoire:/migrations-essai:ro" -e MIGRATIONS_DIR=/migrations-essai \
				migrations-runner 2>&1
			exit $?
		fi
		citer_journal() { tail -n 15 "$RECONSTRUCTION_JOURNAL" | sed 's/^/        /' >&2; }
		compose up -d --wait >"$RECONSTRUCTION_JOURNAL" 2>&1 \
			|| { echo "reconstruire_base_dev : la pile ne remonte pas (docker compose up --wait) — $RECONSTRUCTION_JOURNAL :" >&2; citer_journal; exit 1; }
		if [ "$seed" = true ]; then
			P2ENJOY_ENV_FILE="$fichier" supabase/seed/apply-seed.sh >>"$RECONSTRUCTION_JOURNAL" 2>&1 \
				|| { echo "reconstruire_base_dev : le seed échoue sur la base reconstruite — $RECONSTRUCTION_JOURNAL :" >&2; citer_journal; exit 1; }
		fi

		# Constat : une base NEUVE construite dans l'ordre porte une ligne d'adoption par fichier du répertoire.
		attendus=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
		inscrits=$(docker exec -i "$(conteneur db)" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 \
			-c "select count(*) filter (where mode = 'adoption') || ':' || count(*) from app.migrations_appliquees")
		[ "$inscrits" = "$attendus:$attendus" ] \
			|| { echo "reconstruire_base_dev : registre « $inscrits » (adoption:total), $attendus fichiers attendus en adoption." >&2; exit 1; }
		hors_sante=$(compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" {print $1}' | tr '\n' ' ')
		[ -z "$hors_sante" ] \
			|| { echo "reconstruire_base_dev : services hors d'état healthy : $hors_sante" >&2; exit 1; }
	)
}

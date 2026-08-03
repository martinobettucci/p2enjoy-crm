#!/usr/bin/env bash
# @spec CRM-006 (docs/BACKLOG.md) — génération des types TypeScript depuis le schéma
# @spec docs/SPEC-types.md §3 (source et chemin), §4 (commande), §5 (fichier), §6 (garde)
# @spec docs/DAT.md §3.1 (webapp) ; README.md §7 (commandes)
#
# Régénère `webapp/src/lib/database.types.ts` depuis la base de développement réellement migrée.
#
# Usage :
#   scripts/generate-types.sh            régénère le fichier et l'écrit dans le dépôt
#   scripts/generate-types.sh --check    compare sans écrire ; sort en 1 en cas d'écart
#   scripts/generate-types.sh --stdout   écrit la sortie brute du générateur sur la sortie standard
#   scripts/generate-types.sh --help
#
# Les deux premiers modes sont les points d'entrée documentés du dépôt (README.md §7) :
#
#   npm run types:generate               régénère
#   npm run types:check                  vérifie sans écrire
#
# La source de vérité est la **base**, pas les fichiers SQL : ce qui est décrit est ce que
# PostgREST exposera. Le générateur est le service `meta` de l'overlay de développement, déjà
# présent pour Studio (docs/JOURNAL.md décision 37) ; il ne publie aucun port sur l'hôte, d'où
# l'appel par `docker exec`.
#
# Le script ne démarre ni n'arrête aucun service : la pile de développement doit tourner
# (`./runDev.sh`).

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/env.sh"

META_CONTAINER=p2enjoy-meta
META_PORT=8080
# `included_schemas=public` seulement : le schéma `app` n'est pas exposé par PostgREST, et le
# décrire produirait un type d'appels impossibles (docs/SPEC-types.md §3).
GENERATOR_QUERY='included_schemas=public&detect_one_to_one_relationships=true'
OUTPUT_FILE="$REPO_ROOT/webapp/src/lib/database.types.ts"

MODE=write

while [ $# -gt 0 ]; do
	case "$1" in
		--check)   MODE=check ;;
		--stdout)  MODE=stdout ;;
		--help|-h) print_header_help "${BASH_SOURCE[0]}"; exit 0 ;;
		*)         die "option inconnue « $1 ». Voir scripts/generate-types.sh --help." ;;
	esac
	shift
done

# --- Gardes ------------------------------------------------------------------------------------
# La génération lit une base. Le profil `dev` est exigé pour la même raison que `resetMe.sh`
# l'exige : aucune commande de développement ne doit pouvoir viser une base de production
# (CLAUDE.md §9).

env_validate
env_require_profile dev
require_docker

meta_status=$(docker inspect -f '{{.State.Status}}' "$META_CONTAINER" 2>/dev/null || true)
if [ "$meta_status" != running ]; then
	die "conteneur $META_CONTAINER ${meta_status:-absent} : la pile de développement ne tourne pas. Lancez ./runDev.sh."
fi

# --- En-tête de traçabilité --------------------------------------------------------------------
# Réémis à chaque génération : il fait partie du fichier versionné, donc de ce que la garde
# compare (docs/SPEC-types.md §5).

entete() {
	cat <<'HEADER'
// @spec CRM-006 (docs/BACKLOG.md) — types TypeScript dérivés du schéma
// @spec docs/SPEC-types.md §3 (source), §5 (fichier), §6 (garde anti-dérive)
// @spec docs/SCHEMA.md §1 (socle d'identité) ; docs/DAT.md §3.1 (webapp)
//
// FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Régénérer : npm run types:generate    Vérifier : npm run types:check
//
// Source : le schéma de la base de développement réellement migrée, lu par
// supabase/postgres-meta. Une contrainte CHECK ne survit pas à la génération : le vocabulaire
// des rôles et des accès n'est tenu que par la base (docs/SPEC-types.md §7).

HEADER
}

# --- Appel du générateur -----------------------------------------------------------------------
# La sortie est lue en une fois puis contrôlée avant tout usage : un corps vide ou une réponse
# d'erreur ne doit jamais être écrit dans le dépôt sous forme de fichier de types.

generer() {
	local url="http://localhost:${META_PORT}/generators/typescript?${GENERATOR_QUERY}"
	docker exec "$META_CONTAINER" node -e "
		fetch('$url')
			.then((r) => {
				if (r.status !== 200) {
					process.stderr.write('statut HTTP ' + r.status + '\n');
					process.exit(1);
				}
				return r.text();
			})
			.then((t) => process.stdout.write(t))
			.catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
	"
}

corps=$(generer) || die "le générateur n'a pas répondu correctement (conteneur $META_CONTAINER)."

case "$corps" in
	*"export type Database"*) : ;;
	*) die "sortie inattendue du générateur : « export type Database » absent. Rien n'a été écrit." ;;
esac

# `$(...)` mange les sauts de ligne finaux ; la sortie mesurée du générateur se termine par un
# seul saut de ligne (docs/SPEC-types.md §3), qui est restitué ici.
attendu=$(entete; printf '%s\n' "$corps")

# --- Modes -------------------------------------------------------------------------------------

case "$MODE" in
	stdout)
		printf '%s\n' "$attendu"
		;;

	check)
		if [ ! -f "$OUTPUT_FILE" ]; then
			die "fichier ${OUTPUT_FILE#"$REPO_ROOT/"} absent. Lancez npm run types:generate."
		fi
		if printf '%s\n' "$attendu" | cmp -s - "$OUTPUT_FILE"; then
			say "Types à jour"
			info "${OUTPUT_FILE#"$REPO_ROOT/"} correspond au schéma de la base, octet à octet."
		else
			printf '\033[31mERREUR\033[0m les types versionnés ont dérivé du schéma.\n' >&2
			printf '  %s\n' "Écart (< fichier versionné, > schéma actuel) :" >&2
			printf '%s\n' "$attendu" | diff "$OUTPUT_FILE" - | head -n 40 | sed 's/^/    /' >&2
			printf '  %s\n' "Régénérez avec npm run types:generate, puis relisez le diff." >&2
			exit 1
		fi
		;;

	write)
		mkdir -p "$(dirname "$OUTPUT_FILE")"
		if [ -f "$OUTPUT_FILE" ] && printf '%s\n' "$attendu" | cmp -s - "$OUTPUT_FILE"; then
			say "Types inchangés"
			info "${OUTPUT_FILE#"$REPO_ROOT/"} correspondait déjà au schéma : fichier non réécrit."
		else
			printf '%s\n' "$attendu" > "$OUTPUT_FILE"
			say "Types régénérés"
			info "${OUTPUT_FILE#"$REPO_ROOT/"} — $(wc -l < "$OUTPUT_FILE") lignes."
			info "Relisez le diff : un écart inattendu signale une migration non voulue."
		fi
		;;
esac

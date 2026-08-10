#!/usr/bin/env bash
# @spec CRM-008 (docs/BACKLOG.md) — exécuteur des suites pgTAP, commande `npm run test:sql`
# @spec docs/SPEC-test-harness.md §3.1 (ce que psql ne dit pas), §3.2 (contrat), §3.3 (sortie)
# @spec docs/JOURNAL.md décision 48 (le verdict TAP est calculé, jamais emprunté)
# @spec README.md §7 (tests)
#
# Exécute les suites pgTAP de `supabase/tests/` contre la base de la pile de développement, et
# rend un verdict que ni `psql` ni pgTAP ne savent rendre seuls.
#
# Ce point est la raison d'être de ce script, et il a été mesuré, pas supposé
# (docs/SPEC-test-harness.md §3.1) :
#
#   - une suite dont TOUTES les assertions échouent laisse `psql` sortir en `0` ;
#   - un plan annoncé et non tenu laisse `psql` sortir en `0` ;
#   - sans `finish()`, pgTAP n'émet AUCUN diagnostic de plan : une suite tronquée passe alors
#     pour complète, y compris aux yeux d'un harnais qui lirait ses lignes « # ».
#
# Le verdict est donc calculé ici, à partir de cinq conditions indépendantes : le code de
# sortie de `psql`, la présence d'un plan, l'absence de `not ok`, l'égalité entre le plan annoncé et
# le nombre d'assertions réellement émises, et l'absence de diagnostic de plan émis par pgTAP.
#
# La cinquième a été ajoutée après coup, sur un faux vert **mesuré** de ce script même
# (`docs/JOURNAL.md`, décision 79) : pgTAP tient deux comptes distincts — la numérotation des
# lignes, portée par une séquence, et le compte relu par `finish()`, porté par une table qu'un
# `rollback to savepoint` annule. Une suite dont les **dernières** assertions sont prises dans un
# savepoint annulé émet donc exactement autant de lignes que son plan en annonce, et passait le
# quatrième contrôle, alors que pgTAP la déclarait tronquée et que ses dernières preuves n'avaient
# pas été enregistrées.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`). Il n'écrit rien en base — les suites livrées ouvrent une transaction et
# l'annulent.
#
# Usage :
#   scripts/run-sql-tests.sh                        # toutes les suites de supabase/tests/
#   scripts/run-sql-tests.sh chemin/vers/une.test.sql [autre.test.sql ...]
#   scripts/run-sql-tests.sh --help

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
REPERTOIRE_TESTS=supabase/tests

usage() {
	sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
	exit 0
}

FICHIERS=()
for argument in "$@"; do
	case "$argument" in
		--help|-h) usage ;;
		-*)
			echo "ERREUR : option inconnue « $argument ». Voir --help." >&2
			exit 2
			;;
		*)
			if [ ! -f "$argument" ]; then
				echo "ERREUR : fichier « $argument » introuvable." >&2
				exit 2
			fi
			FICHIERS+=("$argument")
			;;
	esac
done

if [ "${#FICHIERS[@]}" -eq 0 ]; then
	# L'ordre lexicographique est celui des migrations que ces suites accompagnent.
	while IFS= read -r fichier; do
		FICHIERS+=("$fichier")
	done < <(find "$REPERTOIRE_TESTS" -name '*.test.sql' | sort)
fi

if [ "${#FICHIERS[@]}" -eq 0 ]; then
	# Un exécuteur qui ne trouve aucune suite ne doit surtout pas rendre `0` : ce serait
	# précisément le mensonge que ce script existe pour empêcher.
	echo "ERREUR : aucune suite pgTAP trouvée dans $REPERTOIRE_TESTS." >&2
	exit 1
fi

if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT

echecs=0
total_assertions=0

echo
echo "Suites pgTAP de $REPERTOIRE_TESTS"
echo

for fichier in "${FICHIERS[@]}"; do
	sortie="$TRAVAIL/sortie.tap"

	# `ON_ERROR_STOP=1` est obligatoire : sans lui, une erreur SQL au milieu d'un fichier
	# laisse la suite continuer et le code de sortie reste `0`.
	code=0
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 -f - \
		< "$fichier" > "$sortie" 2>&1 || code=$?

	if [ "$code" -ne 0 ]; then
		fail "$fichier — psql a échoué (code $code)"
		sed 's/^/        /' "$sortie" | tail -n 15
		echecs=$((echecs + 1))
		continue
	fi

	plan=$(grep -m 1 -oE '^1\.\.[0-9]+' "$sortie" | cut -d. -f3 || true)
	reussies=$(grep -cE '^ok ' "$sortie" || true)
	echouees=$(grep -cE '^not ok ' "$sortie" || true)
	emises=$((reussies + echouees))

	if [ -z "$plan" ]; then
		fail "$fichier — aucun plan « 1..N » émis : ce fichier n'est pas une suite pgTAP exécutée"
		sed 's/^/        /' "$sortie" | tail -n 15
		echecs=$((echecs + 1))
		continue
	fi

	if [ "$echouees" -gt 0 ]; then
		fail "$fichier — $echouees assertion(s) en échec sur $emises"
		grep -E '^(not ok|#)' "$sortie" | sed 's/^/        /' | head -n 30
		echecs=$((echecs + 1))
		continue
	fi

	# Contrôle que pgTAP ne fait pas à notre place lorsque `finish()` manque : le plan annoncé
	# est comparé au nombre d'assertions réellement émises.
	if [ "$plan" -ne "$emises" ]; then
		fail "$fichier — plan annoncé $plan, $emises assertion(s) émise(s) : suite incomplète"
		grep -E '^#' "$sortie" | sed 's/^/        /' | head -n 10
		echecs=$((echecs + 1))
		continue
	fi

	# Contrôle symétrique du précédent, et non son doublon : celui-ci compare le plan à ce que
	# pgTAP a **enregistré**, le précédent à ce que ce script a **vu passer**. Les deux divergent
	# dès qu'un `rollback to savepoint` intervient après la dernière assertion, et c'est ce que le
	# faux vert de la décision 79 exploitait — plan tenu ligne pour ligne, suite tronquée pour
	# pgTAP.
	diagnostic=$(grep -m 1 -E '^# Looks like you planned' "$sortie" || true)
	if [ -n "$diagnostic" ]; then
		fail "$fichier — pgTAP dénonce son propre plan : les lignes émises ne sont pas celles qu'il a comptées"
		printf '        %s\n' "$diagnostic"
		printf '        Une suite se termine hors savepoint (docs/SPEC-test-harness.md §3.2).\n'
		echecs=$((echecs + 1))
		continue
	fi

	ok "$fichier — $emises assertions"
	total_assertions=$((total_assertions + emises))
done

echo
if [ "$echecs" -eq 0 ]; then
	printf '\033[32m%s fichiers, %s assertions, aucune anomalie.\033[0m\n\n' \
		"${#FICHIERS[@]}" "$total_assertions"
	exit 0
fi
printf '\033[31m%s fichiers, %s en échec.\033[0m\n\n' "${#FICHIERS[@]}" "$echecs"
exit 1

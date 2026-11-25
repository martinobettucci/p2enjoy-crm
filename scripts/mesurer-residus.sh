#!/usr/bin/env bash
# @spec INC-142 (docs/INCONSISTENCY_REPORT.md) — les preuves d'interface laissent des résidus : l'instrument qui les MESURE
# @spec docs/SPEC-test-harness.md §3.11 (le relevé des résidus de données), §3.8 (la garde d'empreinte, son jumeau pour le schéma)
# @spec docs/BACKLOG.md « Correctif — INC-142 »
#
# POURQUOI. La garde d'empreinte (§3.8) mesure la STRUCTURE de la base ; rien ne mesurait ses DONNÉES. Or une preuve qui
# crée une ligne qu'aucun `DELETE` client ne retire — un track, un channel, une carte, un contact — la laisse derrière elle,
# et toute assertion à compteur d'une autre suite devient rouge sans que la preuve fautive soit nommée (INC-142, mesuré le
# 2026-08-14 : `public.tracks` portait 7 lignes pour 5 attendues).
#
# CE QUE FAIT L'OUTIL. Il relève, pour chaque table de `public` portant un `id` uuid, les identifiants de ses lignes, puis
# compare deux relevés : ce qui a été AJOUTÉ et ce qui a été RETIRÉ, table par table, avec un aperçu des premières lignes
# ajoutées. Les tables que l'application remplit par construction, sans qu'une preuve en soit responsable — journaux
# d'événements, notifications, sessions, remises de webhook, profils —, sont exclues, et la liste est écrite ici.
#
# Usage :
#   scripts/mesurer-residus.sh relever <fichier>         écrit le relevé « table|id » trié
#   scripts/mesurer-residus.sh comparer <fichier>        compare l'état courant au relevé ; code 1 s'il y a un écart
#   scripts/mesurer-residus.sh autour -- <commande…>     relève, joue la commande, compare ; code 1 si la commande
#                                                        échoue OU si elle laisse un écart
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
DB_CONTAINER=$(conteneur db)

# Les tables que l'application remplit d'elle-même (docs/SPEC-test-harness.md §3.11) : ce n'est pas un résidu de preuve.
EXCLUES="'card_events','notifications','sessions_sso','webhook_deliveries','profiles'"

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

# Écrit « table|id », trié (LC_ALL=C : `comm` exige le même ordre aux deux relevés).
releve() {
	local requete
	requete=$(psql_db -c "select string_agg(format('select %L as t, id::text as i from public.%I', c.relname, c.relname), ' union all ')
		from pg_class c
		join pg_namespace s on s.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
		where s.nspname = 'public' and c.relkind = 'r' and a.atttypid = 'uuid'::regtype
		  and c.relname not in ($EXCLUES);")
	[ -n "$requete" ] || { echo "ERREUR : aucune table à relever." >&2; return 1; }
	psql_db -c "select t || '|' || i from ($requete) x;" | LC_ALL=C sort
}

comparer() {
	local avant=$1 apres ajoutes retires ecart=0 table n
	apres=$(mktemp)
	ajoutes=$(mktemp)
	retires=$(mktemp)
	trap 'rm -f "$apres" "$ajoutes" "$retires"' RETURN
	releve > "$apres"
	LC_ALL=C comm -13 "$avant" "$apres" > "$ajoutes"
	LC_ALL=C comm -23 "$avant" "$apres" > "$retires"
	if [ ! -s "$ajoutes" ] && [ ! -s "$retires" ]; then
		echo "Aucun résidu : les lignes des tables relevées sont celles d'avant."
		return 0
	fi
	ecart=1
	for sens in ajoutes retires; do
		local fichier=$ajoutes mot='AJOUTÉES'
		[ "$sens" = retires ] && { fichier=$retires; mot='RETIRÉES'; }
		[ -s "$fichier" ] || continue
		echo "Lignes $mot :"
		cut -d'|' -f1 "$fichier" | sort | uniq -c | while read -r n table; do
			printf '  %-32s %s\n' "$table" "$n"
			if [ "$sens" = ajoutes ]; then
				grep "^$table|" "$fichier" | head -n 3 | cut -d'|' -f2 | while read -r identifiant; do
					printf '      %s\n' "$(psql_db -c "select left(to_jsonb(t)::text, 150) from public.\"$table\" t where id = '$identifiant';")"
				done
			fi
		done
	done
	return "$ecart"
}

commande=${1:-}
case "$commande" in
relever)
	[ -n "${2:-}" ] || { echo "usage : $0 relever <fichier>" >&2; exit 2; }
	releve > "$2"
	echo "Relevé écrit : $2 ($(wc -l < "$2") lignes)."
	;;
comparer)
	[ -f "${2:-}" ] || { echo "usage : $0 comparer <fichier relevé>" >&2; exit 2; }
	comparer "$2"
	;;
autour)
	[ "${2:-}" = -- ] && [ -n "${3:-}" ] || { echo "usage : $0 autour -- <commande…>" >&2; exit 2; }
	shift 2
	avant=$(mktemp)
	trap 'rm -f "$avant"' EXIT
	releve > "$avant"
	statut=0
	"$@" || statut=$?
	[ "$statut" -eq 0 ] || echo "La commande a rendu le code $statut." >&2
	comparer "$avant" || statut=1
	exit "$statut"
	;;
*)
	echo "usage : $0 relever <fichier> | comparer <fichier> | autour -- <commande…>" >&2
	exit 2
	;;
esac

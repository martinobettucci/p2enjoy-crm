#!/usr/bin/env bash
# @verifies INC-142 (docs/INCONSISTENCY_REPORT.md) — l'instrument de relevé des résidus de données sait voir un résidu, et se tait sinon
# @verifies docs/SPEC-test-harness.md §3.11 (le relevé des résidus de données)
# @verifies docs/BACKLOG.md « Correctif — INC-142 »
#
# Un instrument de mesure qu'on n'a jamais vu rougir ne prouve rien (docs/SPEC-test-harness.md §7.2). Ce harnais dépose
# lui-même une ligne dans une table relevée, constate que l'instrument la nomme, la retire, et constate qu'il se tait ; il
# constate aussi qu'une ligne ajoutée à une table EXCLUE (un journal que l'application remplit) ne compte pas.
# Il écrit dans la base de développement et défait ce qu'il écrit, dans un `trap`.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
DB_CONTAINER=$(conteneur db)
OUTIL=scripts/mesurer-residus.sh
TRAVAIL=$(mktemp -d)
ESPACE=5eed0000-0000-4000-8000-000000000001
ID_ETIQUETTE=5eed0000-0000-4000-8000-0000000142a1
controles=0
anomalies=0

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"; }

nettoyer() {
	local statut=$?
	trap - EXIT
	psql_db -c "delete from public.labels where id = '$ID_ETIQUETTE';" >/dev/null 2>&1 || true
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

echo
echo "Preuves d'INC-142 — l'instrument de relevé des résidus de données"
echo

[ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" = running ] \
	|| { echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté." >&2; exit 1; }
psql_db -c "delete from public.labels where id = '$ID_ETIQUETTE';" >/dev/null

"$OUTIL" relever "$TRAVAIL/avant.txt" >/dev/null
if "$OUTIL" comparer "$TRAVAIL/avant.txt" >"$TRAVAIL/sortie.txt" 2>&1; then
	ok "sans rien écrire, l'instrument se tait (code 0)"
else
	fail "l'instrument signale un résidu alors que rien n'a été écrit : $(head -n 3 "$TRAVAIL/sortie.txt")"
fi

# Une ligne déposée dans une table relevée (`labels`) : l'instrument doit la nommer.
psql_db -c "insert into public.labels (id, workspace_id, name, color) values ('$ID_ETIQUETTE', '$ESPACE', 'Résidu de preuve INC-142', 'neutral');" >/dev/null
if "$OUTIL" comparer "$TRAVAIL/avant.txt" >"$TRAVAIL/sortie.txt" 2>&1; then
	fail "COMPLAISANT — une ligne ajoutée à labels n'est pas vue (code 0)"
else
	if grep -q 'AJOUTÉES' "$TRAVAIL/sortie.txt" && grep -qE '^ +labels +1$' "$TRAVAIL/sortie.txt" \
		&& grep -q 'Résidu de preuve INC-142' "$TRAVAIL/sortie.txt"; then
		ok "une ligne ajoutée à labels est nommée : la table, le compte et un aperçu de la ligne (code 1)"
	else
		fail "le résidu est vu mais mal décrit : $(cat "$TRAVAIL/sortie.txt")"
	fi
fi

# Retirée la ligne, l'instrument se tait de nouveau : il compare à un état, il ne garde pas de mémoire.
psql_db -c "delete from public.labels where id = '$ID_ETIQUETTE';" >/dev/null
if "$OUTIL" comparer "$TRAVAIL/avant.txt" >"$TRAVAIL/sortie.txt" 2>&1; then
	ok "la ligne retirée, l'instrument se tait de nouveau (code 0)"
else
	fail "l'instrument signale encore un résidu après le retrait : $(head -n 3 "$TRAVAIL/sortie.txt")"
fi

# `autour` : une commande qui RÉUSSIT mais laisse une ligne est un échec ; une commande propre ne l'est pas.
if "$OUTIL" autour -- docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -c \
	"insert into public.labels (id, workspace_id, name) values ('$ID_ETIQUETTE', '$ESPACE', 'Résidu d''autour INC-142');" \
	>"$TRAVAIL/autour.txt" 2>&1; then
	fail "COMPLAISANT — autour rend 0 pour une commande qui laisse une ligne"
elif grep -qE '^ +labels +1$' "$TRAVAIL/autour.txt"; then
	ok "autour rend 1 et nomme la ligne laissée par une commande qui a réussi"
else
	fail "autour rend 1 sans nommer la table : $(cat "$TRAVAIL/autour.txt")"
fi
psql_db -c "delete from public.labels where id = '$ID_ETIQUETTE';" >/dev/null
if "$OUTIL" autour -- true >"$TRAVAIL/autour.txt" 2>&1; then
	ok "autour rend 0 pour une commande qui ne laisse rien"
else
	fail "autour signale un résidu pour une commande propre : $(cat "$TRAVAIL/autour.txt")"
fi

# Une commande qui ÉCHOUE rend un échec, résidu ou non.
if "$OUTIL" autour -- false >"$TRAVAIL/autour.txt" 2>&1; then
	fail "autour rend 0 pour une commande qui échoue"
else
	ok "autour rend un échec quand la commande échoue"
fi

# Les tables que l'application remplit d'elle-même ne figurent pas au relevé.
exclues=$(cut -d'|' -f1 "$TRAVAIL/avant.txt" | sort -u | grep -cE '^(card_events|notifications|sessions_sso|webhook_deliveries|profiles)$' || true)
if [ "$exclues" = 0 ]; then
	ok "les cinq tables que l'application remplit d'elle-même sont hors du relevé"
else
	fail "le relevé porte $exclues table(s) censées être exclues"
fi
if cut -d'|' -f1 "$TRAVAIL/avant.txt" | grep -qx 'tracks' && cut -d'|' -f1 "$TRAVAIL/avant.txt" | grep -qx 'cards'; then
	ok "le relevé porte les tables que les preuves salissent : tracks, cards"
else
	fail "le relevé ne porte pas tracks et cards"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1

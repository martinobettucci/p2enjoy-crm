#!/bin/sh
# @spec CRM-001 (docs/BACKLOG.md) — conteneur d'application des migrations applicatives
# @spec docs/DAT.md §3.2 (base de données), §9 (déploiement)
# @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
#
# Rejoue en ordre lexicographique les fichiers `supabase/migrations/*.sql`, dans une transaction
# par fichier, en s'arrêtant à la première erreur. Les fichiers eux-mêmes sont livrés par
# `CRM-003` et les unités suivantes ; tant qu'aucun n'existe, ce conteneur se termine sans rien
# faire, ce qui est un succès et non un silence trompeur.
#
# En production, ce chemin est **désactivé** (`APPLY_MIGRATIONS=false`) : les migrations sont
# appliquées sur instruction humaine explicite, selon `docs/PROD_MIGRATIONS.md` (CLAUDE.md §9).

set -eu

MIGRATIONS_DIR=${MIGRATIONS_DIR:-/migrations}

if [ "${APPLY_MIGRATIONS:-true}" != "true" ]; then
	echo "migrations : application désactivée (APPLY_MIGRATIONS=${APPLY_MIGRATIONS:-true})."
	echo "migrations : appliquer manuellement selon docs/PROD_MIGRATIONS.md."
	exit 0
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
	echo "migrations : répertoire '$MIGRATIONS_DIR' absent." >&2
	exit 1
fi

# `set --` place les fichiers dans les paramètres positionnels : pas d'analyse de `ls`, et les
# noms comportant des espaces restent corrects.
set -- "$MIGRATIONS_DIR"/*.sql
if [ ! -e "$1" ]; then
	echo "migrations : aucun fichier .sql dans '$MIGRATIONS_DIR', rien à appliquer."
	exit 0
fi

echo "migrations : $# fichier(s) à appliquer sur ${PGDATABASE}@${PGHOST}:${PGPORT}."
for migration in "$@"; do
	migration_role=$(sed -n 's/^-- @migration-role: \([a-z_][a-z_]*\)$/\1/p' "$migration")
	if [ -z "$migration_role" ]; then
		migration_role=$PGUSER
	elif [ "$migration_role" != supabase_admin ]; then
		echo "migrations : rôle refusé '$migration_role' dans $(basename "$migration")." >&2
		exit 1
	fi
	echo "migrations : application de $(basename "$migration") (rôle $migration_role)"
	PGUSER=$migration_role psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
		--single-transaction --file "$migration"
done

echo "migrations : $# fichier(s) appliqué(s) avec succès."

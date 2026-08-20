#!/bin/sh
# @spec CRM-001 (docs/BACKLOG.md) — conteneur d'application des migrations applicatives
# @spec CRM-087 (docs/BACKLOG.md) — rechargement du cache de PostgREST en fin de passage
# @spec docs/DAT.md §3.2 (base de données), §9 (déploiement)
# @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente), §3.1 (fenêtre de maintenance)
# @spec docs/JOURNAL.md décision 489 (rechargement systématique du cache de schéma)
#
# Rejoue en ordre lexicographique les fichiers `supabase/migrations/*.sql`, dans une transaction
# par fichier, en s'arrêtant à la première erreur. Les fichiers eux-mêmes sont livrés par
# `CRM-003` et les unités suivantes ; tant qu'aucun n'existe, ce conteneur se termine sans rien
# faire, ce qui est un succès et non un silence trompeur.
#
# En production, ce chemin est **désactivé par défaut** (`APPLY_MIGRATIONS=false`) : les
# migrations s'appliquent dans une fenêtre de maintenance ouverte par `./runProd.sh --migrate`,
# qui surcharge `APPLY_MIGRATIONS` pour sa seule invocation (CLAUDE.md §9, décision 489).
#
# **Rechargement du cache de schéma de PostgREST — décision 489.** MESURÉ : 18 migrations sur 52
# se terminent par `notify pgrst, 'reload schema'` ; les 34 autres non. En développement, la
# différence est sans effet (`rest` attend la fin du runner). En production, sur pile en marche,
# une table créée par l'une des 34 répond `404` jusqu'au prochain redémarrage. Le runner émet
# donc la notification **une seule fois, en fin de passage réussi**, pour toutes les migrations
# et pour tous les chemins.

set -eu

MIGRATIONS_DIR=${MIGRATIONS_DIR:-/migrations}

if [ "${APPLY_MIGRATIONS:-true}" != "true" ]; then
	echo "migrations : application désactivée (APPLY_MIGRATIONS=${APPLY_MIGRATIONS:-true})."
	echo "migrations : appliquer par ./runProd.sh --migrate en fenêtre de maintenance (CRM-087)."
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

# @spec CRM-087 — le rechargement du cache est émis APRÈS toutes les migrations, une seule fois.
# `notify` n'est jamais transactionnel ; s'il échoue (base indisponible, canal absent), le passage
# reste un succès et le message est écrit sur stderr. Le rôle par défaut du runner suffit :
# `notify` ne demande aucun privilège particulier.
if psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
	--command "notify pgrst, 'reload schema';" >/dev/null 2>&1; then
	echo "migrations : cache de schéma de PostgREST rechargé (notify pgrst)."
else
	echo "migrations : notification pgrst refusée ; recharger le cache manuellement." >&2
fi

echo "migrations : $# fichier(s) appliqué(s) avec succès."

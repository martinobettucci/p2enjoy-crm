#!/bin/sh
# @spec CRM-001 (docs/BACKLOG.md) — conteneur d'application des migrations applicatives
# @spec CRM-087 (docs/BACKLOG.md) — rechargement du cache de PostgREST en fin de passage
# @spec CRM-096 (docs/BACKLOG.md) — tranche T2 : le registre des migrations
# @spec docs/DAT.md §3.2 (base de données), §3.2 bis (le registre, ses refus, l'adoption), §9 (déploiement)
# @spec docs/SCHEMA.md §8 (`app.migrations_appliquees`)
# @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente), §3.1 (fenêtre de maintenance)
# @spec docs/JOURNAL.md décision 489 (rechargement systématique du cache de schéma), décision 616 (registre)
#
# Applique en ordre lexicographique les fichiers `supabase/migrations/*.sql`, dans une transaction
# par fichier, en s'arrêtant à la première erreur. Les fichiers eux-mêmes sont livrés par
# `CRM-003` et les unités suivantes ; tant qu'aucun n'existe, ce conteneur se termine sans rien
# faire, ce qui est un succès et non un silence trompeur.
#
# **Le registre — `CRM-096`, décision 616.** La table `app.migrations_appliquees` (migration `0082`)
# porte une ligne par fichier appliqué, avec l'empreinte SHA-256 de son contenu. Quand elle en porte, le
# runner n'applique QUE les fichiers absents, chacun dans une seule transaction avec son inscription, après
# trois contrôles qui arrêtent le passage sans rien appliquer : un fichier inscrit modifié, un fichier
# inscrit absent, un fichier non inscrit qui précède le dernier inscrit. Quand elle est absente ou vide, le
# passage est une ADOPTION : tout le répertoire est rejoué, comme avant `CRM-096` — l'idempotence de chaque
# fichier le rend sûr —, puis tous les fichiers rejoués sont inscrits d'un seul geste.
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

# Une requête au registre, sous le rôle par défaut du runner. Sa valeur est toujours capturée par une
# AFFECTATION, jamais lue dans une condition : une panne de la base arrête alors le runner (`set -e`) au
# lieu de passer pour un registre vide.
lire() {
	psql --no-psqlrc --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 --command "$1"
}

refuser() {
	echo "migrations : REFUS — $1" >&2
	echo "migrations : aucun fichier appliqué ; la base porte exactement ce que son registre décrit (docs/DAT.md §3.2 bis)." >&2
	exit 1
}

empreinte() {
	sha256sum "$1" | cut -d ' ' -f 1
}

# Une instruction d'inscription, écrite dans un fichier temporaire que `psql` lit APRÈS la migration,
# dans la même transaction. Le nom et l'empreinte y entrent tels quels : le nom a été contraint à
# `NNNN_nom.sql` (minuscules, chiffres, soulignés) et l'empreinte est l'hexadécimal de `sha256sum` —
# aucun des deux ne peut porter d'apostrophe.
INSCRIPTION=$(mktemp)
trap 'rm -f "$INSCRIPTION"' EXIT

# Le NOM SEUL entre au registre ; sa forme est contrôlée avant tout usage, comme la base l'exige
# (`migrations_appliquees_fichier_check`).
for migration in "$@"; do
	nom=$(basename "$migration")
	printf '%s\n' "$nom" | grep -Eq '^[0-9]{4}_[a-z0-9_]+\.sql$' \
		|| refuser "nom de fichier hors de la forme NNNN_nom.sql : $nom"
done

existe=$(lire "select to_regclass('app.migrations_appliquees') is not null")
inscrits=
if [ "$existe" = t ]; then
	inscrits=$(lire "select fichier || ':' || empreinte from app.migrations_appliquees order by fichier collate \"C\"")
fi

# Le rôle d'une migration : `postgres` par défaut, `supabase_admin` sur marqueur, rien d'autre.
role_de() {
	migration_role=$(sed -n 's/^-- @migration-role: \([a-z_][a-z_]*\)$/\1/p' "$1")
	if [ -z "$migration_role" ]; then
		migration_role=$PGUSER
	elif [ "$migration_role" != supabase_admin ]; then
		echo "migrations : rôle refusé '$migration_role' dans $(basename "$1")." >&2
		exit 1
	fi
}

appliquer() {
	# $1 : le fichier ; $2 : `inscrire` pour l'inscrire dans la même transaction.
	role_de "$1"
	if [ "${2:-}" = inscrire ]; then
		printf "insert into app.migrations_appliquees (fichier, empreinte, mode) values ('%s', '%s', 'application');\n" \
			"$(basename "$1")" "$(empreinte "$1")" > "$INSCRIPTION"
		echo "migrations : application de $(basename "$1") (rôle $migration_role, inscrite au registre)"
		PGUSER=$migration_role psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
			--single-transaction --file "$1" --file "$INSCRIPTION"
	else
		echo "migrations : application de $(basename "$1") (rôle $migration_role)"
		PGUSER=$migration_role psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
			--single-transaction --file "$1"
	fi
}

appliques=0
if [ -z "$inscrits" ]; then
	# ADOPTION : registre absent ou vide. Tout est rejoué, puis inscrit d'un seul geste.
	echo "migrations : registre absent ou vide — adoption : rejeu complet de $# fichier(s), puis inscription."
	for migration in "$@"; do
		appliquer "$migration"
		appliques=$((appliques + 1))
	done
	existe=$(lire "select to_regclass('app.migrations_appliquees') is not null")
	if [ "$existe" = t ]; then
		{
			for migration in "$@"; do
				printf "insert into app.migrations_appliquees (fichier, empreinte, mode) values ('%s', '%s', 'adoption');\n" \
					"$(basename "$migration")" "$(empreinte "$migration")"
			done
		} > "$INSCRIPTION"
		psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --single-transaction --file "$INSCRIPTION"
		echo "migrations : $# fichier(s) inscrit(s) au registre en mode adoption."
	else
		echo "migrations : le répertoire ne crée pas le registre ; rien n'est inscrit."
	fi
else
	# 1. Les fichiers inscrits : présents, et de même empreinte.
	dernier=
	for ligne in $inscrits; do
		fichier=${ligne%%:*}
		attendue=${ligne#*:}
		[ -f "$MIGRATIONS_DIR/$fichier" ] \
			|| refuser "le fichier inscrit $fichier est absent du répertoire"
		[ "$(empreinte "$MIGRATIONS_DIR/$fichier")" = "$attendue" ] \
			|| refuser "le fichier inscrit $fichier a été modifié depuis son application : sa correction est une migration nouvelle (en développement, ./resetMe.sh reconstruit la base)"
		dernier=$fichier
	done
	# 2. L'ordre : un fichier non inscrit ne précède pas le dernier inscrit. Les deux listes sont en ordre
	#    d'octets (`collate "C"`, `LC_ALL=C`), celui du répertoire.
	a_appliquer=
	for migration in "$@"; do
		nom=$(basename "$migration")
		case "
$inscrits" in
		*"
$nom:"*) continue ;;
		esac
		if [ "$(printf '%s\n%s\n' "$nom" "$dernier" | LC_ALL=C sort | head -n 1)" = "$nom" ]; then
			refuser "le fichier non inscrit $nom précède le dernier fichier inscrit, $dernier"
		fi
		a_appliquer="$a_appliquer $nom"
	done
	# 3. Le delta, chaque fichier dans une seule transaction avec son inscription.
	echo "migrations : registre de $(printf '%s\n' "$inscrits" | wc -l | tr -d ' ') fichier(s) ; $(printf '%s' "$a_appliquer" | wc -w | tr -d ' ') à appliquer."
	# Les noms ne portent ni espace ni caractère spécial (forme contrôlée plus haut) : la liste se découpe
	# sans risque ; le répertoire, lui, reste entre guillemets.
	for nom in $a_appliquer; do
		appliquer "$MIGRATIONS_DIR/$nom" inscrire
		appliques=$((appliques + 1))
	done
fi

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
echo "migrations : $appliques fichier(s) appliqué(s) avec succès."

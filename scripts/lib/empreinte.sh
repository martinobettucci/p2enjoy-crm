# shellcheck shell=bash
# @spec CRM-111 (docs/BACKLOG.md) — tranche T1 ter.1 : la garde d'empreinte des harnais qui rejouent une migration
#       (INC-304, décision 701)
# @spec docs/SPEC-test-harness.md §3.6 (reconstruire à neuf), §3.8 (la garde d'empreinte)
#
# POURQUOI. Un harnais qui rejoue un fichier de migration ancien sur une base à jour peut réécrire ce qu'une migration
# postérieure a redéfinie, et rien ne le mesurait (INC-304 : `verify-workflows.sh` laissait trois contraintes dans leur
# forme d'avant la `0085` ; `verify-plateforme.sh` ramenait des fonctions à leur version d'origine). La garde le mesure
# à chaque passage : l'empreinte de la STRUCTURE des schémas `public` et `app` est relevée à l'ouverture, relue à la
# sortie, et la base est reconstruite (`reconstruire_base_dev`) si elles diffèrent.
#
# CE QUI EST COMPARÉ. Le texte de `pg_dump --schema-only` des deux schémas, sans les lignes `\restrict` et `\unrestrict`,
# qui portent une clé tirée au hasard à chaque appel depuis PostgreSQL 17.6 (mesuré : sans ce filtre, deux relevés de la
# même base diffèrent). Une fonction réappliquée à l'identique ne change rien ; une donnée non plus.
#
# Usage, dans un harnais :
#   source scripts/lib/empreinte.sh
#   empreinte_relever                 # à l'ouverture, avant le premier rejeu
#   …
#   empreinte_garantir || statut=1    # à la sortie, après la restauration propre du harnais (dans son `trap`)
#
# `empreinte_garantir` rend 0 si l'empreinte est inchangée, ou si la reconstruction l'a rétablie ; le code de la
# reconstruction sinon. Il écrit sur la sortie d'erreur ce qu'il a vu et fait, avec le chemin du différentiel.

# shellcheck source=scripts/lib/reconstruction.sh
source "$(dirname "${BASH_SOURCE[0]}")/reconstruction.sh"

EMPREINTE_DOSSIER=${EMPREINTE_DOSSIER:-}
EMPREINTE_OUVERTURE=''

# Écrit la structure de `public` et `app` dans le fichier donné, et rend son empreinte sur la sortie standard.
empreinte_schema() {
	local cible=$1
	docker exec "$(conteneur db)" pg_dump -U postgres -d postgres --schema-only -n public -n app \
		| grep -vE '^\\(un)?restrict ' > "$cible"
	sha256sum "$cible" | cut -d' ' -f1
}

# Une base injoignable à l'ouverture n'arrête pas le harnais ici : il rendra son propre diagnostic (conteneur absent,
# pile arrêtée), et la garde, sans relevé, n'aura rien à comparer à la sortie.
empreinte_relever() {
	[ -n "$EMPREINTE_DOSSIER" ] || EMPREINTE_DOSSIER=$(mktemp -d "${P2ENJOY_TMP:-/tmp}/p2enjoy-empreinte.XXXXXX")
	EMPREINTE_OUVERTURE=$(empreinte_schema "$EMPREINTE_DOSSIER/ouverture.sql" 2>/dev/null) || EMPREINTE_OUVERTURE=''
	[ -s "$EMPREINTE_DOSSIER/ouverture.sql" ] || EMPREINTE_OUVERTURE=''
}

empreinte_garantir() {
	if [ -z "$EMPREINTE_OUVERTURE" ]; then
		echo "empreinte : aucun relevé d'ouverture (base injoignable), la garde n'a rien comparé" >&2
		rm -rf -- "$EMPREINTE_DOSSIER"
		EMPREINTE_DOSSIER=''
		return 0
	fi
	local sortie
	sortie=$(empreinte_schema "$EMPREINTE_DOSSIER/sortie.sql")
	if [ "$sortie" = "$EMPREINTE_OUVERTURE" ]; then
		# Rien à montrer : les deux relevés sont retirés. Un écart, lui, garde ses fichiers pour le diagnostic.
		rm -rf -- "$EMPREINTE_DOSSIER"
		EMPREINTE_DOSSIER=''
		return 0
	fi
	diff "$EMPREINTE_DOSSIER/ouverture.sql" "$EMPREINTE_DOSSIER/sortie.sql" > "$EMPREINTE_DOSSIER/difference.diff" || true
	echo "empreinte : la structure de public et app a changé pendant le harnais ($(grep -c '^[<>]' \
		"$EMPREINTE_DOSSIER/difference.diff") ligne(s), voir $EMPREINTE_DOSSIER/difference.diff) — reconstruction" >&2
	reconstruire_base_dev
}

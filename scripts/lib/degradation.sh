# shellcheck shell=bash
# @spec CRM-111 (docs/BACKLOG.md) — tranches T1 ter et T2.3.3 : dégrader puis restaurer une fonction SANS rejouer de
#       migration (INC-304, décisions 682, 701, 704)
# @spec docs/SPEC-test-harness.md §3.6 (reconstruire plutôt que rejouer), §3.7 (dégrader le seul bloc visé)
#
# POURQUOI. Un harnais qui dégradait une fonction en rejouant une migration ANCIENNE la ramenait à une version qu'une
# migration postérieure a redéfinie ; quand un paramètre ou un type de retour change, le rejeu échoue en cours de fichier
# (« cannot change name of input parameter ») après en avoir appliqué une partie, et la base sort à moitié ramenée en
# arrière — en silence derrière un `|| true`. Mesuré par INC-304, puis à nouveau par `CRM-111` T2.3.3.
#
# CE QUE CE MODULE FAIT. La définition d'ORIGINE est lue EN BASE (`pg_get_functiondef`), là où elle vit, et non dans un
# fichier de migration : la dégradation ne dépend pas de la migration qui fait autorité. Elle remplace un fragment qui
# doit apparaître EXACTEMENT une fois — sinon le contrôle est déclaré non concluant —, s'applique dans une transaction, et
# la définition d'origine est réappliquée par `degradations_restaurer`, à poser dans le `trap` du harnais.
#
# Requiert `psql_db` (requête sur la base de développement, sortie sur stdout) ; le dossier de travail va sous
# `P2ENJOY_TMP` s'il est défini, et le harnais le retire dans son `trap` (`rm -rf "$DEGRADATIONS_DOSSIER"`).

# Le dossier de travail n'est créé qu'à la première dégradation : sourcer ce module ne laisse rien derrière soi.
DEGRADATIONS_DOSSIER=${DEGRADATIONS_DOSSIER:-}
DEGRADATIONS_ORIGINES=()

# Applique un fichier SQL dans une transaction, avec arrêt à la première erreur. Rend le code de psql.
degradation_appliquer() {
	psql_db -q -v ON_ERROR_STOP=1 --single-transaction -f - < "$1" >/dev/null 2>&1
}

# Dégrade une fonction : $1 signature (`public.move_card(uuid,uuid,text)`), $2 fragment d'origine, $3 remplacement.
# Rend 0 si la dégradation est en place, 1 si le contrôle n'est pas concluant (fragment absent ou ambigu, ou
# définition dégradée refusée). La définition d'origine est mémorisée UNE fois par fonction, avant toute dégradation.
degradation_fonction() {
	local signature=$1 avant=$2 apres=$3
	local nom origine degradee
	[ -n "$DEGRADATIONS_DOSSIER" ] || DEGRADATIONS_DOSSIER=$(mktemp -d "${P2ENJOY_TMP:-/tmp}/degradations.XXXXXX")
	nom=$(printf '%s' "$signature" | tr -c 'a-zA-Z0-9_' '_')
	origine="$DEGRADATIONS_DOSSIER/$nom.origine.sql"
	degradee="$DEGRADATIONS_DOSSIER/$nom.degradee.sql"
	if [ ! -s "$origine" ]; then
		psql_db -c "select pg_get_functiondef('$signature'::regprocedure) || ';';" > "$origine" 2>/dev/null || return 1
		[ -s "$origine" ] || return 1
		DEGRADATIONS_ORIGINES+=("$origine")
	fi
	python3 - "$origine" "$degradee" "$avant" "$apres" <<'PY' || return 1
import sys
source, cible, avant, apres = sys.argv[1:5]
texte = open(source, encoding='utf-8').read()
if texte.count(avant) != 1:
    sys.exit(f"fragment absent ou ambigu ({texte.count(avant)}) : {avant[:70]!r}")
open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
PY
	degradation_appliquer "$degradee"
}

# Réapplique toutes les définitions d'origine mémorisées. Sans effet si rien n'a été dégradé.
degradations_restaurer() {
	local origine
	for origine in "${DEGRADATIONS_ORIGINES[@]}"; do
		degradation_appliquer "$origine" || echo "ATTENTION : la restauration de $origine a échoué" >&2
	done
}

# Écrit dans $3 une copie de la migration $1 PRIVÉE de la fonction $2 (`public.move_card`) : son bloc
# `create or replace function`, et les instructions qui la nomment — propriétaire, commentaire, privilèges. Sert au
# harnais dont le SUJET est une autre partie de cette migration (la table de liaison de la 19, par exemple) quand la
# fonction a, depuis, une autorité postérieure qui en a changé la signature : rejouer son ancien bloc échouerait, ou la
# ramènerait en arrière. Rend 1 si le bloc n'est pas trouvé exactement une fois.
migration_sans_fonction() {
	python3 - "$1" "$2" "$3" <<'PY'
import re, sys
source, nom, cible = sys.argv[1:4]
texte = open(source, encoding='utf-8').read()
entree = f'create or replace function {nom}('
if texte.count(entree) != 1:
    sys.exit(f'{nom} : {texte.count(entree)} bloc(s) dans {source}')
debut = texte.index(entree)
fin = texte.index('\n$$;\n', debut) + len('\n$$;\n')
texte = texte[:debut] + f'-- [bloc de {nom} retiré par le harnais : sa dernière autorité est postérieure]\n' + texte[fin:]
# Les instructions qui nomment la fonction, sur une ou plusieurs lignes, jusqu'au point-virgule qui les CLÔT — les
# chaînes SQL entre apostrophes sont sautées : un `comment on function … is '…; …'` porte souvent un point-virgule dans
# son texte (mesuré sur la `0020`, `CRM-111` T2.3.7).
chaine = r"'(?:[^']|'')*'"
motif = re.compile(r"^(?:alter|comment on|revoke|grant)\b[^;']*?" + re.escape(nom) + r"\((?:" + chaine + r"|[^;'])*;\n",
                   re.M | re.S)
texte = motif.sub('', texte)
open(cible, 'w', encoding='utf-8').write(texte)
PY
}

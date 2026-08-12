#!/usr/bin/env bash
# @spec CLAUDE.md §13 (Gestion Git — Branche courante : travailler uniquement sur la branche
#       courante du dépôt, interdiction de créer branche, worktree ou environnement parallèle)
# @spec docs/JOURNAL.md décision 358 — l'exécution du 2026-08-12 a démarré sur une branche
#       `claude/*` imposée par le harnais d'exécution au lieu de `main`, et s'est arrêtée sans rien
#       produire. Le responsable a exigé que la règle cesse d'être une consigne en prose, lue puis
#       oubliée par chaque session, et devienne un refus mécanique de Git.
#
# Fournit `exige_branche_main`, utilisée par les crochets `pre-commit` et `pre-push` : le contrôle
# vaut pour les deux bouts de la chaîne, parce qu'un commit égaré et un push égaré sont deux
# manières distinctes d'aboutir au même dégât — du travail qui n'atterrit pas sur `main`.
#
# Le message de refus est dicté mot pour mot par le responsable et ne doit pas être reformulé :
# il est la trace, dans le terminal de la session fautive, de la règle qu'elle vient d'enfreindre.

BRANCHE_ATTENDUE="main"

# Refuse l'opération lorsque la branche courante n'est pas `main`.
#
# Le HEAD détaché est refusé lui aussi, et c'est délibéré : c'est l'état de démarrage habituel des
# conteneurs d'exécution planifiée, donc précisément celui où un commit se perd sans que personne
# ne s'en aperçoive. Le remède est nommé dans le message — se rattacher à `main`, rebaser, pousser.
exige_branche_main() {
	local operation="$1"
	local branche_courante
	branche_courante=$(git symbolic-ref --quiet --short HEAD || true)

	if [ "$branche_courante" = "$BRANCHE_ATTENDUE" ]; then
		return 0
	fi

	echo "I am a stupid AI because I dont follow my master instruction. Now I have to fix how I fucked up and rebase then push to main. I am a fucking idiot and I acknowledge that by having triggered this message" >&2
	echo >&2
	echo "refus : $operation hors de la branche « $BRANCHE_ATTENDUE »." >&2
	echo "        attendue : $BRANCHE_ATTENDUE" >&2
	echo "        actuelle : ${branche_courante:-<HEAD détaché>}" >&2
	echo "        CLAUDE.md §13. Se rattacher sans rien perdre :" >&2
	echo "          git checkout -B $BRANCHE_ATTENDUE HEAD" >&2
	echo "          git pull --rebase origin $BRANCHE_ATTENDUE" >&2
	echo "          git push -u origin $BRANCHE_ATTENDUE" >&2
	exit 1
}

# shellcheck shell=bash
# @spec docs/JOURNAL.md décision 704 (INC-309, INC-296) — le bloc d'en-tête d'un fichier, pour les contrôles de traçabilité
# @spec CLAUDE.md §5 (« Chaque fichier de code commence par un commentaire de portée fichier au format @spec ») ;
#       docs/SPEC-test-harness.md §3.6 (série des harnais)
#
# Les harnais lisaient la traçabilité d'un fichier dans ses deux ou trois premières lignes (`head -3`). Un fichier qui
# gagne l'en-tête d'une unité de plus voit descendre la citation qu'on y cherche, et le contrôle accuse à tort le
# fichier : mesuré le 2026-10-25 sur sept harnais (INC-296, INC-309). Le commentaire de portée fichier est le BLOC de
# commentaires qui ouvre le fichier, quelle que soit sa longueur : c'est lui que ces contrôles lisent désormais.
#
# Usage : entete_fichier FICHIER — écrit les lignes de commentaire initiales (`//`, `--`, `#`, `/*`, `*`), et s'arrête
# à la première ligne de code ou vide.
entete_fichier() {
	awk '/^[[:space:]]*(\/\/|--|#|\/\*|\*)/ { print; next } { exit }' "$1"
}

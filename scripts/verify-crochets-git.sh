#!/usr/bin/env bash
# @verifies docs/JOURNAL.md décision 358 — le travail hors de `main` est refusé mécaniquement par
#           Git, sur les deux bouts de la chaîne : le commit ET le push
# @verifies docs/JOURNAL.md décisions 340, 344 et 345 — non-régression du contrôle d'identité déjà
#           porté par `.githooks/pre-commit`, que la décision 358 ne relâche pas
# @verifies CLAUDE.md §13 (Gestion Git — Branche courante ; Attribution des commits)
# @verifies INC-165 (docs/INCONSISTENCY_REPORT.md, décision 992) — « une migration modifiée sans `database.types.ts` modifié dans
#           le même commit est refusée au push, sauf marqueur « sans effet de types » dans la migration »
#
# Éprouve `.githooks/pre-commit`, `.githooks/pre-push` et `.githooks/lib/exige-main.sh` en les
# EXÉCUTANT réellement, dans des dépôts jetables créés sous `mktemp -d`. Aucun scénario ne commite,
# ne pousse ni ne modifie quoi que ce soit dans le dépôt courant : le contrôle porte sur le
# comportement des crochets, pas sur l'historique réel.
#
# Le dépôt jetable reçoit `core.hooksPath` pointant vers les crochets RÉELS du dépôt courant — les
# fichiers versionnés, pas une copie —, afin qu'une modification des crochets soit immédiatement
# éprouvée ici plutôt que dans un double qui divergerait en silence.
#
# Usage :
#   scripts/verify-crochets-git.sh

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOKS_DIR="$REPO_ROOT/.githooks"

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

# Le message dicté par le responsable, cité ici mot pour mot. Toute reformulation d'un crochet fait
# rougir les contrôles qui suivent : c'est le but, ce message est un contrat, pas une décoration.
MESSAGE_ATTENDU="I am a stupid AI because I dont follow my master instruction. Now I have to fix how I fucked up and rebase then push to main. I am a fucking idiot and I acknowledge that by having triggered this message"

# Crée un dépôt jetable déjà pourvu d'un commit sur `main`, de l'identité du responsable et des
# crochets réels, puis renseigne la variable globale `depot` avec son chemin.
#
# Le chemin n'est volontairement PAS rendu par la sortie standard : une première rédaction le
# capturait par substitution de commande, et une erreur d'expansion y rendait `depot` vide. Comme
# `git -C ""` retombe silencieusement sur le répertoire courant, les scénarios s'exécutaient alors
# contre le DÉPÔT RÉEL — HEAD y a été détaché, et un push vers `refs/heads/claude/*` y a été tenté.
# Les crochets éprouvés ici ont refusé l'un et l'autre, ce qui a borné le dégât ; la leçon est
# néanmoins câblée : plus de capture, et `${depot:?}` à chaque usage pour qu'une valeur vide
# interrompe le script au lieu de viser le dépôt courant.
nouveau_depot() {
	local nom="$1"
	depot="$WORK/$nom"
	mkdir -p "$depot"
	git -C "${depot:?}" init --quiet --initial-branch=main
	git -C "${depot:?}" config user.name "P2Enjoy"
	git -C "${depot:?}" config user.email "contact@p2enjoy.studio"
	# Le commit d'amorçage précède l'installation des crochets : il sert de base aux scénarios sans
	# être lui-même soumis au contrôle que l'on cherche à éprouver.
	echo "base" > "${depot:?}/fichier.txt"
	git -C "${depot:?}" add fichier.txt
	git -C "${depot:?}" commit --quiet -m "Amorce le dépôt d'épreuve"
	git -C "${depot:?}" config core.hooksPath "$HOOKS_DIR"
}

# --- 1. Le commit hors de `main` est refusé -----------------------------------------------------

echo "1. pre-commit : la branche courante"

nouveau_depot commit-branche
git -C "${depot:?}" checkout --quiet -b claude/gallant-keller-9klqj4
echo "modification" >> "${depot:?}/fichier.txt"
git -C "${depot:?}" add fichier.txt
sortie=$(git -C "${depot:?}" commit -m "Tente un commit hors de main" 2>&1)
code=$?

if [ "$code" -ne 0 ]; then
	ok "un commit sur une branche « claude/* » est refusé"
else
	fail "un commit sur une branche « claude/* » a été ACCEPTÉ"
fi

if printf '%s' "$sortie" | grep -qF "$MESSAGE_ATTENDU"; then
	ok "le refus porte le message exact dicté par le responsable"
else
	fail "le message de refus ne correspond pas mot pour mot au message dicté"
fi

if printf '%s' "$sortie" | grep -qF "claude/gallant-keller-9klqj4"; then
	ok "le refus nomme la branche fautive"
else
	fail "le refus ne nomme pas la branche fautive"
fi

# La branche est bien restée sans nouveau commit : le refus n'a pas écrit à moitié.
if [ "$(git -C "${depot:?}" rev-list --count HEAD)" = "1" ]; then
	ok "aucun commit n'a été créé par la tentative refusée"
else
	fail "un commit a été créé malgré le refus"
fi

# --- 2. Le HEAD détaché est refusé lui aussi ----------------------------------------------------

echo
echo "2. pre-commit : le HEAD détaché, état de démarrage des conteneurs planifiés"

nouveau_depot commit-detache
git -C "${depot:?}" checkout --quiet --detach HEAD
echo "modification" >> "${depot:?}/fichier.txt"
git -C "${depot:?}" add fichier.txt
sortie=$(git -C "${depot:?}" commit -m "Tente un commit en HEAD détaché" 2>&1)
code=$?

if [ "$code" -ne 0 ]; then
	ok "un commit en HEAD détaché est refusé"
else
	fail "un commit en HEAD détaché a été ACCEPTÉ"
fi

if printf '%s' "$sortie" | grep -qF "HEAD détaché"; then
	ok "le refus nomme l'état de HEAD détaché plutôt qu'une branche vide"
else
	fail "le refus ne nomme pas l'état de HEAD détaché"
fi

if printf '%s' "$sortie" | grep -qF "git checkout -B main HEAD"; then
	ok "le refus donne le geste de rattachement qui ne perd rien"
else
	fail "le refus ne donne pas le geste de rattachement"
fi

# --- 3. Le commit sur `main` reste possible -----------------------------------------------------

echo
echo "3. pre-commit : la voie nominale n'est pas fermée"

nouveau_depot commit-main
echo "modification" >> "${depot:?}/fichier.txt"
git -C "${depot:?}" add fichier.txt
sortie=$(git -C "${depot:?}" commit -m "Committe sur main" 2>&1)
code=$?

if [ "$code" -eq 0 ]; then
	ok "un commit sur « main » avec l'identité du responsable est accepté"
else
	fail "un commit légitime sur « main » a été refusé : $sortie"
fi

# --- 4. Non-régression : l'identité reste contrôlée ---------------------------------------------

echo
echo "4. pre-commit : le contrôle d'identité de la décision 345 n'est pas relâché"

nouveau_depot commit-identite
git -C "${depot:?}" config user.email "agent@exemple.invalid"
echo "modification" >> "${depot:?}/fichier.txt"
git -C "${depot:?}" add fichier.txt
sortie=$(git -C "${depot:?}" commit -m "Tente un commit sous une autre identité" 2>&1)
code=$?

if [ "$code" -ne 0 ]; then
	ok "un commit sur « main » sous une identité étrangère reste refusé"
else
	fail "un commit sous une identité étrangère a été ACCEPTÉ"
fi

if printf '%s' "$sortie" | grep -qF "contact@p2enjoy.studio"; then
	ok "le refus d'identité nomme toujours l'adresse attendue"
else
	fail "le refus d'identité ne nomme plus l'adresse attendue"
fi

# --- 5. Le push vers une référence autre que `main` est refusé ----------------------------------

echo
echo "5. pre-push : la référence distante visée"

origine="$WORK/origine.git"
git init --quiet --bare "$origine"
nouveau_depot push-ref
git -C "${depot:?}" remote add origin "$origine"

# Le scénario est celui qui a coûté la session : la branche locale s'appelle `main`, l'identité est
# la bonne, le commit passe — et le push part malgré tout vers une référence `claude/*`.
sortie=$(git -C "${depot:?}" push origin "main:refs/heads/claude/gallant-keller-9klqj4" 2>&1)
code=$?

if [ "$code" -ne 0 ]; then
	ok "un push vers « refs/heads/claude/* » est refusé"
else
	fail "un push vers « refs/heads/claude/* » a été ACCEPTÉ"
fi

if printf '%s' "$sortie" | grep -qF "$MESSAGE_ATTENDU"; then
	ok "le refus de push porte le message exact dicté par le responsable"
else
	fail "le message de refus du push ne correspond pas mot pour mot"
fi

if [ -z "$(git -C "$origine" for-each-ref --format='%(refname)' refs/heads/)" ]; then
	ok "aucune référence n'a été créée sur le distant par la tentative refusée"
else
	fail "une référence a été créée sur le distant malgré le refus"
fi

# --- 6. Le push vers `main` reste possible ------------------------------------------------------

echo
echo "6. pre-push : la voie nominale n'est pas fermée"

sortie=$(git -C "${depot:?}" push -u origin main 2>&1)
code=$?

if [ "$code" -eq 0 ]; then
	ok "un push de « main » vers « main » est accepté"
else
	fail "un push légitime vers « main » a été refusé : $sortie"
fi

if [ "$(git -C "$origine" for-each-ref --format='%(refname)' refs/heads/)" = "refs/heads/main" ]; then
	ok "le distant porte « refs/heads/main », et elle seule"
else
	fail "le distant ne porte pas exactement « refs/heads/main »"
fi

# --- 6 bis. Une migration sans ses types est refusée — INC-165, décision 992 --------------------------

echo
echo "6 bis. pre-push : une migration modifiée exige database.types.ts dans le MÊME commit"

TYPES=webapp/src/lib/database.types.ts
mkdir -p "${depot:?}/supabase/migrations" "${depot:?}/webapp/src/lib"

pousser() { git -C "${depot:?}" push origin main 2>&1; }

# a) la migration seule : refusée, le message nomme la migration, le fichier et le marqueur.
printf 'create table t_inc165 (id int);\n' > "${depot:?}/supabase/migrations/0999_inc165.sql"
git -C "${depot:?}" add supabase/migrations/0999_inc165.sql
git -C "${depot:?}" commit --quiet -m "Une migration sans ses types"
sortie=$(pousser); code=$?
if [ "$code" -ne 0 ] && printf '%s' "$sortie" | grep -q '0999_inc165.sql' \
	&& printf '%s' "$sortie" | grep -q 'database.types.ts' && printf '%s' "$sortie" | grep -q 'sans effet de types'; then
	ok "une migration seule est refusée, et le refus nomme la migration, les types et le marqueur"
else
	fail "une migration sans ses types n'est pas refusée (code $code) : « $sortie »"
fi

# b) les types dans un commit DISTINCT ne suffisent pas : la règle porte sur le même commit.
printf 'export type Database = {}\n// regénéré\n' > "${depot:?}/$TYPES"
git -C "${depot:?}" add "$TYPES"
git -C "${depot:?}" commit --quiet -m "Les types, à part"
sortie=$(pousser); code=$?
if [ "$code" -ne 0 ]; then
	ok "les types dans un commit distinct ne suffisent pas : la règle est « dans le même commit »"
else
	fail "des types dans un commit distinct ont fait accepter la migration : « $sortie »"
fi

# c) la migration ET les types dans le même commit : acceptée.
git -C "${depot:?}" reset --quiet --hard HEAD~2
printf 'create table t_inc165 (id int);\n' > "${depot:?}/supabase/migrations/0999_inc165.sql"
printf 'export type Database = {}\n// avec la table\n' > "${depot:?}/$TYPES"
git -C "${depot:?}" add supabase/migrations/0999_inc165.sql "$TYPES"
git -C "${depot:?}" commit --quiet -m "La migration et ses types"
sortie=$(pousser); code=$?
[ "$code" -eq 0 ] && ok "la migration et ses types dans le même commit sont acceptées" || fail "refus à tort : « $sortie »"

# d) une migration sans effet de types, portant le marqueur : acceptée.
printf -- '-- sans effet de types : une fonction interne, aucun objet du schéma exposé\nselect 1;\n' > "${depot:?}/supabase/migrations/1000_inc165_marqueur.sql"
git -C "${depot:?}" add supabase/migrations/1000_inc165_marqueur.sql
git -C "${depot:?}" commit --quiet -m "Une migration sans effet de types"
sortie=$(pousser); code=$?
[ "$code" -eq 0 ] && ok "une migration portant « sans effet de types » est acceptée sans types" || fail "refus à tort malgré le marqueur : « $sortie »"

# e) un commit sans migration reste libre.
echo "autre" > "${depot:?}/autre.txt"
git -C "${depot:?}" add autre.txt
git -C "${depot:?}" commit --quiet -m "Un fichier sans rapport"
sortie=$(pousser); code=$?
[ "$code" -eq 0 ] && ok "un commit sans migration n'est pas concerné" || fail "refus à tort d'un commit sans migration : « $sortie »"

# f) un commit qui ne fait que SUPPRIMER une migration n'exige pas les types de la suppression (le contrôle porte sur A et M).
git -C "${depot:?}" rm --quiet supabase/migrations/1000_inc165_marqueur.sql
git -C "${depot:?}" commit --quiet -m "Retire une migration"
sortie=$(pousser); code=$?
[ "$code" -eq 0 ] && ok "le retrait d'une migration n'est pas jugé comme une modification" || fail "refus à tort d'un retrait : « $sortie »"

# --- 7. Les crochets sont installables et exécutables --------------------------------------------

echo
echo "7. Les crochets sont réellement montés par l'amorçage"

for crochet in pre-commit pre-push lib/exige-main.sh lib/types-a-jour.sh; do
	if [ -x "$HOOKS_DIR/$crochet" ]; then
		ok ".githooks/$crochet est exécutable"
	else
		fail ".githooks/$crochet n'est pas exécutable"
	fi
done

# `scripts/lib/env.sh` est le point d'entrée commun qui règle `core.hooksPath` ; sans lui, les
# crochets versionnés ne sont jamais consultés par Git.
if grep -q 'core.hooksPath' "$REPO_ROOT/scripts/lib/env.sh"; then
	ok "scripts/lib/env.sh règle core.hooksPath sur .githooks"
else
	fail "scripts/lib/env.sh ne règle plus core.hooksPath"
fi

if [ "$(git -C "$REPO_ROOT" config --local core.hooksPath || true)" = ".githooks" ]; then
	ok "le clone courant a bien core.hooksPath = .githooks"
else
	fail "le clone courant n'a pas core.hooksPath = .githooks"
fi

# --- Bilan --------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1

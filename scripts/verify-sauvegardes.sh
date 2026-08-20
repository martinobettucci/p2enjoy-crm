#!/usr/bin/env bash
# @verifies CRM-080 (docs/BACKLOG.md) — tranche 1, Definition of Done de la sauvegarde chiffrée
# @verifies docs/SPEC-backups.md §3 (ce que le script produit), §3.2 (contenu de l'archive),
#           §3.3 (manifeste), §3.4 (chiffrement), §3.5 (atomicité), §3.6 (rétention),
#           §3.7 (les douze refus), §5 (contrat de comportement, cas a à n), §6 (preuves exigées)
# @verifies docs/DAT.md §10 (la clé racine de Vault vit hors de PGDATA)
# @verifies docs/SPEC-test-harness.md §1 (un harnais qui rend vert sans rien exercer est pire
#           qu'une commande absente)
#
# Rejoue les preuves exigées par la tranche 1 de `CRM-080`, sur la VRAIE pile et avec le VRAI
# script — jamais sur une imitation :
#
#   1. traçabilité : le script livré porte son en-tête, son aide et le mode strict du dépôt ;
#   2. cas a à e : une archive est produite, déchiffrée, et chacun de ses membres est constaté —
#      dump lisible par `pg_restore`, clé racine identique OCTET À OCTET à celle du conteneur,
#      empreintes du manifeste RECALCULÉES sur les membres extraits ;
#   3. cas f : un objet témoin est déposé dans le dépôt objet local avant la sauvegarde, et il se
#      retrouve dans l'archive — un dossier vide ne prouverait pas que le chemin fonctionne ;
#   4. cas i à l : chaque prérequis est DÉGRADÉ volontairement, et le refus attendu est exigé,
#      avec la garantie qu'aucun fichier n'a été déposé ;
#   5. cas m : la rétention supprime l'archive périmée, épargne la neuve, et laisse INTACT un
#      fichier étranger du même répertoire ;
#   6. cas n : aucun résidu `.partiel` ne survit à une exécution, réussie ou non.
#
# Le harnais engendre sa propre paire de clés `age` jetable : la clé privée n'existe que le temps
# de l'exécution, dans un répertoire temporaire détruit en sortant. Il n'écrit RIEN dans le dépôt,
# et il ne modifie ni la base, ni les volumes de la pile — le seul objet qu'il dépose dans le
# dépôt objet est retiré à la fin, et son absence initiale est constatée d'abord.
#
# Prérequis : la pile de développement debout (`./runDev.sh`), `age` sur l'hôte.
#
# Usage :
#   scripts/verify-sauvegardes.sh

set -euo pipefail

cd "$(dirname "$0")/.."
REPO=$(pwd -P)

SCRIPT=scripts/backup.sh
PREFIXE=p2enjoy-sauvegarde
SUFFIXE=.tar.age
TEMOIN_OBJET=preuve-crm-080-temoin.txt

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

BAC=$(mktemp -d)
chmod 700 "$BAC"

nettoyer() {
	# Le témoin déposé dans le dépôt objet est retiré, quelle que soit l'issue : le harnais ne
	# laisse pas de trace dans les volumes de la pile.
	if [ -n "${CONTENEUR_MINIO:-}" ] && [ -n "${BUCKET:-}" ]; then
		docker exec "$CONTENEUR_MINIO" rm -f "/data/$BUCKET/$TEMOIN_OBJET" >/dev/null 2>&1 || true
	fi
	rm -rf "$BAC"
}
trap nettoyer EXIT INT TERM

# --- Prérequis du harnais lui-même --------------------------------------------------------------
#
# Ils ne sont pas des contrôles : ce sont les conditions sans lesquelles les contrôles ne diraient
# rien du produit. Ils s'arrêtent bruyamment plutôt que de rendre un vert vide.

command -v age >/dev/null 2>&1 \
	|| { echo "ERREUR : « age » est introuvable ; ce harnais l'exige comme le script qu'il éprouve." >&2; exit 1; }
docker info >/dev/null 2>&1 \
	|| { echo "ERREUR : le démon Docker ne répond pas. Démarrez-le, puis relancez." >&2; exit 1; }

CONTENEUR_DB=$(docker ps --filter "name=^/p2enjoy-db$" --filter "status=running" --format '{{.Names}}')
[ -n "$CONTENEUR_DB" ] \
	|| { echo "ERREUR : la pile n'est pas debout (conteneur « p2enjoy-db » absent). Lancez ./runDev.sh." >&2; exit 1; }

CONTENEUR_MINIO=$(docker ps --filter "name=^/p2enjoy-minio$" --filter "status=running" --format '{{.Names}}')
BUCKET=$(sed -n 's/^GLOBAL_S3_BUCKET=//p' .env 2>/dev/null | tail -n 1)

# Paire de clés jetable. Seule la clé PUBLIQUE est donnée au script ; la privée ne sert qu'ici,
# pour déchiffrer et constater — c'est exactement la répartition que le §3.4 décrit.
age-keygen -o "$BAC/id.txt" >/dev/null 2>&1
age-keygen -y "$BAC/id.txt" > "$BAC/destinataires.txt" 2>/dev/null
RECIPIENTS="$BAC/destinataires.txt"

SORTIE="$BAC/sortie"
mkdir -p "$SORTIE"

# Lance le vrai script dans un environnement maîtrisé. La sortie est capturée pour que les refus
# puissent être LUS, et non seulement comptés.
lancer() {
	env BACKUP_AGE_RECIPIENTS_FILE="${REC_OVERRIDE-$RECIPIENTS}" \
	    BACKUP_RETENTION_DAYS="${RET_OVERRIDE-30}" \
	    "$@" \
	    "$REPO/$SCRIPT" --output-dir "${DIR_OVERRIDE-$SORTIE}" > "$BAC/sortie.log" 2>&1
}

# Le répertoire peut ne pas exister — c'est même le cas des refus, qui doivent s'arrêter avant de
# le créer. `find` rendrait alors un code non nul, et `pipefail` ferait mourir le harnais sur une
# situation parfaitement normale : le cas est traité explicitement plutôt que masqué par un
# `|| true` qui avalerait aussi les vraies erreurs.
compter_archives() {
	local dir=${1:-$SORTIE}
	[ -d "$dir" ] || { echo 0; return 0; }
	find "$dir" -maxdepth 1 -type f -name "$PREFIXE-*$SUFFIXE" | wc -l
}

# --- 1. Traçabilité et forme du script livré ----------------------------------------------------

titre "1. Le script livré, sa traçabilité et son mode strict"

[ -f "$SCRIPT" ] && [ -x "$SCRIPT" ] \
	&& ok "$SCRIPT existe et est exécutable" \
	|| fail "$SCRIPT est absent ou non exécutable"

grep -q '^# @spec CRM-080 ' "$SCRIPT" \
	&& ok "l'en-tête cite l'unité de backlog CRM-080" \
	|| fail "l'en-tête ne cite pas CRM-080 (CLAUDE.md §5, traçabilité)"

grep -q '^# @spec docs/SPEC-backups.md ' "$SCRIPT" \
	&& ok "l'en-tête cite docs/SPEC-backups.md" \
	|| fail "l'en-tête ne cite pas sa spécification"

grep -q '^set -euo pipefail$' "$SCRIPT" \
	&& ok "le script est en mode strict (set -euo pipefail)" \
	|| fail "le script n'est pas en mode strict"

bash -n "$SCRIPT" 2>/dev/null \
	&& ok "le script est syntaxiquement valide" \
	|| fail "le script ne passe pas « bash -n »"

"$REPO/$SCRIPT" --help > "$BAC/aide.txt" 2>&1 \
	&& grep -q 'BACKUP_AGE_RECIPIENTS_FILE' "$BAC/aide.txt" \
	&& ok "« --help » documente les variables d'environnement" \
	|| fail "« --help » n'imprime pas l'aide attendue"

"$REPO/$SCRIPT" --argument-qui-nexiste-pas > "$BAC/inconnu.txt" 2>&1 \
	&& fail "un argument inconnu est accepté en silence" \
	|| { grep -q 'argument inconnu' "$BAC/inconnu.txt" \
		&& ok "un argument inconnu est refusé en le nommant" \
		|| fail "un argument inconnu est refusé sans dire lequel"; }

# --- 2. Le témoin du dépôt objet (cas f) --------------------------------------------------------
#
# Le dépôt objet du seed est VIDE (docs/SPEC-backups.md, mesure M6) : sauvegarder un dossier vide
# et le retrouver vide ne prouverait pas que le chemin d'export fonctionne. Un objet témoin est
# donc déposé AVANT la sauvegarde, et son absence préalable est constatée.

titre "2. Le dépôt objet local et son témoin"

TEMOIN_POSE=0
if [ -n "$CONTENEUR_MINIO" ] && [ -n "$BUCKET" ]; then
	if docker exec "$CONTENEUR_MINIO" test -e "/data/$BUCKET/$TEMOIN_OBJET" 2>/dev/null; then
		fail "un témoin d'une exécution précédente traîne dans le dépôt objet"
	else
		ok "le dépôt objet ne porte aucun témoin résiduel"
	fi
	echo "preuve CRM-080 tranche 1 — contenu témoin" \
		| docker exec -i "$CONTENEUR_MINIO" sh -c "cat > /data/$BUCKET/$TEMOIN_OBJET"
	docker exec "$CONTENEUR_MINIO" test -s "/data/$BUCKET/$TEMOIN_OBJET" \
		&& { TEMOIN_POSE=1; ok "témoin déposé dans le dépôt objet local (bucket « $BUCKET »)"; } \
		|| fail "le témoin n'a pas pu être déposé dans le dépôt objet"
else
	ok "dépôt objet externe : le cas f ne s'applique pas, le cas h sera constaté au manifeste"
fi

# --- 3. Cas a à g : une sauvegarde réelle, déchiffrée et constatée ------------------------------

titre "3. Cas a à g — l'archive produite, déchiffrée et vérifiée"

if lancer; then
	ok "cas a — le script réussit sur la pile debout"
else
	fail "cas a — le script a échoué : $(tail -n 3 "$BAC/sortie.log" | tr '\n' ' ')"
fi

[ "$(compter_archives)" -eq 1 ] \
	&& ok "cas a — exactement une archive dans le répertoire de sortie" \
	|| fail "cas a — le répertoire de sortie porte $(compter_archives) archive(s) au lieu d'une"

[ "$(find "$SORTIE" -maxdepth 1 -type f | wc -l)" -eq 1 ] \
	&& ok "cas a — rien d'autre n'est déposé : ni journal, ni copie en clair" \
	|| fail "cas a — le répertoire de sortie porte des fichiers étrangers à l'archive"

ARCHIVE=$(find "$SORTIE" -maxdepth 1 -type f -name "$PREFIXE-*$SUFFIXE" | head -n 1)

if [ -n "$ARCHIVE" ]; then
	# Une archive chiffrée par des destinataires publics ne doit RIEN livrer sans la clé privée.
	# Le contrôle est fait avant tout autre : il est la raison d'être du chiffrement.
	if tar -tf "$ARCHIVE" >/dev/null 2>&1; then
		fail "cas a — l'archive se lit comme un tar : elle n'est donc pas chiffrée"
	else
		ok "cas a — l'archive n'est lisible par aucun outil sans la clé privée"
	fi

	mkdir -p "$BAC/extrait"
	if age --decrypt -i "$BAC/id.txt" "$ARCHIVE" 2>/dev/null | tar -x -C "$BAC/extrait" 2>/dev/null; then
		ok "cas b — l'archive se déchiffre par la clé privée correspondante et rend un tar valide"
	else
		fail "cas b — l'archive ne se déchiffre pas, ou son tar est invalide"
	fi

	RACINE=$(find "$BAC/extrait" -mindepth 1 -maxdepth 1 -type d | head -n 1)
	MANIFESTE="$RACINE/MANIFESTE.txt"

	[ -f "$MANIFESTE" ] \
		&& ok "cas b — MANIFESTE.txt est présent" \
		|| fail "cas b — MANIFESTE.txt est absent"

	[ -f "$RACINE/base.dump" ] \
		&& ok "cas b — base.dump est présent" \
		|| fail "cas b — base.dump est absent"

	[ -s "$RACINE/pgsodium_root.key" ] \
		&& ok "cas b — pgsodium_root.key est présent et non vide" \
		|| fail "cas b — pgsodium_root.key est absent ou vide (docs/DAT.md §10)"

	# Cas c — le dump est réellement une archive PostgreSQL, lue par l'outil qui la restaurera.
	if [ -f "$RACINE/base.dump" ] \
		&& docker exec -i "$CONTENEUR_DB" pg_restore --list < "$RACINE/base.dump" > "$BAC/toc.txt" 2>/dev/null \
		&& grep -q '^;[[:space:]]*dbname:' "$BAC/toc.txt"; then
		ok "cas c — pg_restore lit le dump et rend sa table des matières ($(grep -c '^[^;]' "$BAC/toc.txt") entrées)"
	else
		fail "cas c — pg_restore ne lit pas le dump extrait"
	fi

	# Cas d — la clé racine sauvegardée est celle du conteneur, octet à octet. Une clé approchante
	# serait une clé fausse : les secrets ne se déchiffreraient pas.
	docker exec "$CONTENEUR_DB" cat /etc/postgresql-custom/pgsodium_root.key > "$BAC/cle-conteneur.bin" 2>/dev/null || true
	if [ -s "$BAC/cle-conteneur.bin" ] && cmp -s "$RACINE/pgsodium_root.key" "$BAC/cle-conteneur.bin"; then
		ok "cas d — la clé racine sauvegardée est identique OCTET À OCTET à celle du conteneur"
	else
		fail "cas d — la clé racine sauvegardée diffère de celle du conteneur"
	fi

	# Cas e — les empreintes sont RECALCULÉES sur les membres extraits. Relire l'empreinte écrite
	# au manifeste et la comparer à elle-même serait le contrôle complaisant type.
	if [ -f "$MANIFESTE" ]; then
		ecarts=0
		lignes=0
		while read -r nom taille somme; do
			lignes=$((lignes + 1))
			[ -f "$RACINE/$nom" ] || { ecarts=$((ecarts + 1)); continue; }
			[ "$(stat -c%s "$RACINE/$nom")" = "$taille" ] || ecarts=$((ecarts + 1))
			[ "$(sha256sum "$RACINE/$nom" | awk '{print $1}')" = "$somme" ] || ecarts=$((ecarts + 1))
		done < <(sed -n 's/^membre=//p' "$MANIFESTE")

		[ "$lignes" -ge 2 ] \
			&& ok "cas e — le manifeste énumère $lignes membres" \
			|| fail "cas e — le manifeste n'énumère que $lignes membre(s)"

		[ "$ecarts" -eq 0 ] \
			&& ok "cas e — taille et SHA-256 recalculés concordent pour chaque membre" \
			|| fail "cas e — $ecarts écart(s) entre le manifeste et les membres extraits"

		grep -q '^format_version=1$' "$MANIFESTE" \
			&& ok "cas e — le manifeste porte format_version=1" \
			|| fail "cas e — le manifeste ne porte pas de version de format"

		# Aucun secret au manifeste : c'est la partie de l'archive qui circule (CLAUDE.md §20).
		if grep -Eqi 'password|secret|_key=|token|jwt' "$MANIFESTE"; then
			fail "cas e — le manifeste porte une chaîne évoquant un secret"
		else
			ok "cas e — le manifeste ne porte aucun secret"
		fi
	fi

	# Cas f et g — le dépôt objet. Le témoin déposé doit se retrouver DANS l'archive.
	if [ "$TEMOIN_POSE" -eq 1 ]; then
		grep -q '^depot_objet=minio-local$' "$MANIFESTE" \
			&& ok "cas f — le manifeste déclare le dépôt objet local" \
			|| fail "cas f — le manifeste ne déclare pas le dépôt objet local"

		if [ -f "$RACINE/objets.tar" ] && tar -tf "$RACINE/objets.tar" 2>/dev/null | grep -q "$TEMOIN_OBJET"; then
			ok "cas f — l'objet témoin se trouve dans objets.tar"
		else
			fail "cas f — objets.tar ne porte pas l'objet témoin"
		fi
	else
		grep -q '^depot_objet=externe$' "$MANIFESTE" \
			&& ok "cas h — le manifeste déclare le dépôt objet externe, sans membre objets.tar" \
			|| fail "cas h — le manifeste ne déclare pas le dépôt objet externe"
	fi
fi

# --- 4. Cas n : aucun résidu --------------------------------------------------------------------

titre "4. Cas n — aucun résidu partiel"

[ "$(find "$SORTIE" -maxdepth 1 -name '.*partiel' | wc -l)" -eq 0 ] \
	&& ok "cas n — aucun fichier « .partiel » ne survit à l'exécution réussie" \
	|| fail "cas n — un fichier « .partiel » subsiste"

# --- 5. Cas i à l : les refus, chacun par une dégradation volontaire -----------------------------
#
# Chaque refus est exigé DEUX fois : le code de sortie doit être non nul, ET le répertoire de
# sortie doit rester inchangé. Un script qui refuserait après avoir écrit serait pire qu'un script
# qui n'existerait pas — il laisserait une archive incomplète portant un nom de sauvegarde.

titre "5. Cas i à l — les refus, sur prérequis dégradés"

refus_attendu() {
	local libelle=$1 motif=$2 avant apres
	avant=$(compter_archives "${DIR_OVERRIDE-$SORTIE}")
	if lancer; then
		fail "$libelle — le script a RÉUSSI là où il devait refuser"
		return
	fi
	apres=$(compter_archives "${DIR_OVERRIDE-$SORTIE}")
	if ! grep -q "$motif" "$BAC/sortie.log"; then
		fail "$libelle — refus obtenu, mais le message ne nomme pas la cause « $motif »"
		return
	fi
	if [ "$avant" != "$apres" ]; then
		fail "$libelle — le refus a tout de même déposé un fichier"
		return
	fi
	ok "$libelle — refusé en nommant la cause, sans rien déposer"
}

# Cas i — `age` retiré du PATH. Le prérequis est dur : aucun repli en clair.
#
# Le PATH de substitution porte TOUT ce dont le script a besoin sauf `age`, `bash` compris : le
# script s'ouvre sur `#!/usr/bin/env bash`, et sans `bash` dans ce PATH la mesure ne dirait rien
# du produit — elle mesurerait l'absence de l'interpréteur.
(
	mkdir -p "$BAC/pathvide"
	for exe in bash sh docker tar find sed awk grep sha256sum stat mktemp date basename dirname cat rm mv chmod mkdir printf head tail cut sort wc env cmp realpath; do
		src=$(command -v "$exe" 2>/dev/null) && ln -sf "$src" "$BAC/pathvide/$exe"
	done
	PATH="$BAC/pathvide" lancer
) > /dev/null 2>&1 && AGE_RC=0 || AGE_RC=1
if [ "$AGE_RC" -eq 1 ] && grep -q 'age' "$BAC/sortie.log"; then
	ok "cas i — « age » absent du PATH : refus en le nommant"
else
	fail "cas i — « age » absent du PATH n'a pas produit le refus attendu"
fi
[ "$(compter_archives)" -eq 1 ] \
	&& ok "cas i — aucune archive supplémentaire n'a été déposée" \
	|| fail "cas i — le refus a modifié le répertoire de sortie"

# Cas j — fichier de destinataires vide.
: > "$BAC/vide.txt"
REC_OVERRIDE="$BAC/vide.txt" refus_attendu "cas j" "illisible ou vide"
unset REC_OVERRIDE

# Fichier de destinataires sans clé reconnue — refus R4, distinct du précédent.
echo "ceci n'est pas une clé" > "$BAC/nonvalide.txt"
REC_OVERRIDE="$BAC/nonvalide.txt" refus_attendu "refus R4" "aucune clé publique reconnue"
unset REC_OVERRIDE

# Variable absente — refus R2.
(
	unset BACKUP_AGE_RECIPIENTS_FILE
	env BACKUP_AGE_RECIPIENTS_FILE= "$REPO/$SCRIPT" --output-dir "$SORTIE" > "$BAC/sortie.log" 2>&1
) && fail "refus R2 — une sauvegarde sans destinataires a réussi" \
  || { grep -q 'BACKUP_AGE_RECIPIENTS_FILE' "$BAC/sortie.log" \
	&& ok "refus R2 — destinataires non renseignés : refus en nommant la variable" \
	|| fail "refus R2 — le refus ne nomme pas la variable manquante"; }

# Cas k — répertoire de sortie DANS le dépôt. Le refus est structurel : une archive chiffrée dans
# l'arbre de travail serait poussée par erreur ou ajoutée à une image (CLAUDE.md §3).
DIR_OVERRIDE="$REPO/.preuve-sortie-crm-080" refus_attendu "cas k" "dans le dépôt Git"
rm -rf "$REPO/.preuve-sortie-crm-080"
unset DIR_OVERRIDE

# Le chemin détourné doit être refusé aussi : la comparaison porte sur le chemin CANONIQUE.
DIR_OVERRIDE="$REPO/docs/../.preuve-sortie-detour" refus_attendu "cas k bis" "dans le dépôt Git"
rm -rf "$REPO/.preuve-sortie-detour"
unset DIR_OVERRIDE

# Cas l — rétention nulle : elle supprimerait l'archive qui vient d'être écrite.
RET_OVERRIDE=0 refus_attendu "cas l" "supérieur ou égal à 1"
unset RET_OVERRIDE

RET_OVERRIDE=trente refus_attendu "refus R9 bis" "supérieur ou égal à 1"
unset RET_OVERRIDE

# --- 6. Cas m : la rétention supprime le périmé, et RIEN d'autre ---------------------------------

titre "6. Cas m — la rétention"

SORTIE_RET="$BAC/retention"
mkdir -p "$SORTIE_RET"

ANCIENNE="$SORTIE_RET/$PREFIXE-20200101T000000Z$SUFFIXE"
ETRANGER="$SORTIE_RET/journal-exploitation.txt"
ANCIEN_ETRANGER="$SORTIE_RET/archive-d-un-autre-outil.tar.age"

echo "archive périmée de preuve" > "$ANCIENNE"
echo "fichier étranger de preuve" > "$ETRANGER"
echo "archive d'un autre outil, périmée elle aussi" > "$ANCIEN_ETRANGER"
touch -d '2020-01-01' "$ANCIENNE" "$ETRANGER" "$ANCIEN_ETRANGER"

if DIR_OVERRIDE="$SORTIE_RET" RET_OVERRIDE=1 lancer; then
	ok "cas m — la sauvegarde réussit dans un répertoire portant des fichiers préexistants"
else
	fail "cas m — la sauvegarde a échoué : $(tail -n 3 "$BAC/sortie.log" | tr '\n' ' ')"
fi
unset DIR_OVERRIDE RET_OVERRIDE

[ ! -e "$ANCIENNE" ] \
	&& ok "cas m — l'archive périmée a été supprimée" \
	|| fail "cas m — l'archive périmée subsiste"

[ -e "$ETRANGER" ] \
	&& ok "cas m — le fichier étranger est INTACT" \
	|| fail "cas m — la rétention a supprimé un fichier étranger"

[ -e "$ANCIEN_ETRANGER" ] \
	&& ok "cas m — une archive d'un autre outil, hors motif, est INTACTE" \
	|| fail "cas m — la rétention a supprimé un fichier hors de son motif"

[ "$(compter_archives "$SORTIE_RET")" -eq 1 ] \
	&& ok "cas m — l'archive neuve subsiste, seule de son motif" \
	|| fail "cas m — le répertoire porte $(compter_archives "$SORTIE_RET") archive(s) au lieu d'une"

grep -q 'rétention   supprimée' "$BAC/sortie.log" \
	&& ok "cas m — la suppression est ÉNUMÉRÉE dans le rapport" \
	|| fail "cas m — la suppression n'est pas énumérée : elle serait silencieuse"

# --- 7. Non-complaisance : le harnais sait-il rougir ? -------------------------------------------
#
# Un harnais qui ne rougit jamais ne prouve rien (docs/SPEC-test-harness.md §1). Le contrôle le
# plus important de la tranche — la clé racine identique octet à octet — est éprouvé PAR SA
# DÉGRADATION : une clé altérée doit faire échouer la comparaison. La dégradation porte sur la
# COPIE extraite, jamais sur le conteneur.

titre "7. Non-complaisance — le contrôle de la clé racine sait échouer"

if [ -n "${RACINE:-}" ] && [ -s "$RACINE/pgsodium_root.key" ]; then
	cp "$RACINE/pgsodium_root.key" "$BAC/cle-degradee.bin"
	printf 'X' >> "$BAC/cle-degradee.bin"
	if cmp -s "$BAC/cle-degradee.bin" "$BAC/cle-conteneur.bin"; then
		fail "la comparaison de la clé racine accepte une clé altérée : elle ne prouve rien"
	else
		ok "une clé racine altérée d'un octet est bien REFUSÉE par la comparaison"
	fi
else
	fail "la clé racine extraite est absente : la non-complaisance n'a pas pu être éprouvée"
fi

# --- Bilan --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

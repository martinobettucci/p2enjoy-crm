#!/usr/bin/env bash
# @verifies CRM-080 (docs/BACKLOG.md) — tranche 2, Definition of Done de la restauration prouvée
# @verifies docs/SPEC-backups.md §10 (les huit mesures), §11.1 (un environnement jetable et un
#           seul), §11.2 (la garde de destruction, structurelle), §11.3 (le déroulé),
#           §11.4 (les sept invariants), §11.6 (les onze refus), §11.7 (ce que l'exercice n'écrit
#           jamais), §12 (contrat de comportement, cas o à z), §13 (preuves exigées),
#           §15 (Definition of Done)
# @verifies docs/DAT.md §10 (la clé racine de Vault vit hors de PGDATA)
# @verifies docs/SPEC-test-harness.md §1 (un harnais qui rend vert sans rien exercer est pire
#           qu'une commande absente)
#
# Rejoue les preuves exigées par la tranche 2 de `CRM-080`, sur la VRAIE pile, avec le VRAI
# `scripts/backup.sh` et le VRAI `scripts/restore-drill.sh` — jamais sur une imitation :
#
#   1. traçabilité : le script livré porte son en-tête, son aide et le mode strict du dépôt ;
#   2. cas o, p, z : une archive réelle est restaurée de bout en bout, les invariants sont
#      comparés, et l'environnement jetable ne survit pas ;
#   3. cas f/I7 : un objet TÉMOIN est déposé dans le dépôt objet avant la sauvegarde, et il doit
#      ressortir du MinIO jetable. Le dépôt du seed étant VIDE, un dossier vide restauré ne
#      prouverait rien du chemin des objets ;
#   4. CAS Q, LA DÉGRADATION CENTRALE : la clé racine de l'archive est remplacée par une autre, et
#      l'exercice DOIT échouer. Sans cette épreuve, rien ne distingue un exercice qui VÉRIFIE le
#      déchiffrement d'un exercice qui l'AFFIRME — mesuré, tous les autres invariants restent
#      identiques dans ce cas (docs/SPEC-backups.md §10, M12) ;
#   5. cas r à w : chaque prérequis et chaque garde sont DÉGRADÉS volontairement, et le refus
#      attendu est exigé DEUX fois — code non nul ET aucun conteneur jetable survivant ;
#   6. cas w : un conteneur portant déjà le nom jetable doit faire refuser l'exercice, et
#      SURVIVRE — c'est ce qui éprouve la garde de destruction plutôt que de la promettre ;
#   7. cas z : après chaque exercice, les conteneurs de la pile sont TOUJOURS LES MÊMES, comparés
#      par leur identifiant et non par leur nombre.
#
# Le harnais engendre sa propre paire de clés `age` jetable. Il n'écrit RIEN dans le dépôt, et la
# seule trace qu'il laisse dans la pile — l'objet témoin — est retirée en sortant, son absence
# initiale ayant été constatée d'abord.
#
# Prérequis : la pile de développement debout (`./runDev.sh`), `age` sur l'hôte.
#
# Usage :
#   scripts/verify-restauration.sh

set -euo pipefail

cd "$(dirname "$0")/.."
REPO=$(pwd -P)

SCRIPT=scripts/restore-drill.sh
SAUVEGARDE=scripts/backup.sh
PREFIXE=p2enjoy-sauvegarde
SUFFIXE=.tar.age
TEMOIN_OBJET=preuve-crm-080-t2-temoin.txt
PREFIXE_JETABLE=p2enjoy-restauration

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

BAC=$(mktemp -d)
chmod 700 "$BAC"

nettoyer() {
	if [ -n "${CONTENEUR_MINIO:-}" ] && [ -n "${BUCKET:-}" ]; then
		docker exec "$CONTENEUR_MINIO" rm -f "/data/$BUCKET/$TEMOIN_OBJET" >/dev/null 2>&1 || true
	fi
	# Le conteneur d'usurpation du cas w est détruit ici, et lui seul : il porte un nom que le
	# harnais a lui-même choisi, jamais un motif.
	[ -n "${USURPATEUR:-}" ] && docker rm -f "$USURPATEUR" >/dev/null 2>&1
	rm -rf "$BAC"
	return 0
}
trap nettoyer EXIT INT TERM

# --- Prérequis du harnais lui-même --------------------------------------------------------------

command -v age >/dev/null 2>&1 \
	|| { echo "ERREUR : « age » est introuvable ; ce harnais l'exige comme le script qu'il éprouve." >&2; exit 1; }
docker info >/dev/null 2>&1 \
	|| { echo "ERREUR : le démon Docker ne répond pas. Démarrez-le, puis relancez." >&2; exit 1; }

CONTENEUR_DB=$(docker ps --filter "name=^/p2enjoy-db$" --filter "status=running" --format '{{.Names}}')
[ -n "$CONTENEUR_DB" ] \
	|| { echo "ERREUR : la pile n'est pas debout (conteneur « p2enjoy-db » absent). Lancez ./runDev.sh." >&2; exit 1; }

CONTENEUR_MINIO=$(docker ps --filter "name=^/p2enjoy-minio$" --filter "status=running" --format '{{.Names}}')
BUCKET=$(sed -n 's/^GLOBAL_S3_BUCKET=//p' .env 2>/dev/null | tail -n 1)

age-keygen -o "$BAC/id.txt" >/dev/null 2>&1
age-keygen -y "$BAC/id.txt" > "$BAC/destinataires.txt" 2>/dev/null

SORTIE="$BAC/sortie"
mkdir -p "$SORTIE"

# L'EMPREINTE DE LA PILE, RELEVÉE AVANT TOUT : ce sont les IDENTIFIANTS des conteneurs, non leur
# nombre. Un conteneur recréé garderait son nom et changerait d'identifiant ; comparer les noms
# laisserait donc passer exactement l'accident que le §11.7 interdit.
PILE_AVANT=$(docker ps -q | sort | tr '\n' ' ')

# Lance le VRAI exercice. La sortie est capturée pour que les refus soient LUS, pas seulement
# comptés, et le code de sortie est rendu tel quel.
exercer() {
	set +e
	env RESTORE_AGE_IDENTITY_FILE="${IDENTITE_OVERRIDE-$BAC/id.txt}" \
	    BACKUP_OUTPUT_DIR="$SORTIE" \
	    "$REPO/$SCRIPT" "$@" > "$BAC/exercice.log" 2>&1
	local code=$?
	set -e
	return "$code"
}

# Le compte des conteneurs jetables. Il emploie un motif — mais pour COMPTER, jamais pour détruire :
# la garde du §11.2 tient à ce que le script éprouvé, lui, n'en construise aucun.
jetables_restants() { docker ps -aq --filter "name=^/$PREFIXE_JETABLE" | wc -l ; }

pile_intacte() { [ "$(docker ps -q | sort | tr '\n' ' ')" = "$PILE_AVANT" ] ; }

# --- 1. Traçabilité et forme du script livré ----------------------------------------------------

titre "1. Le script livré, sa traçabilité et son mode strict"

[ -f "$SCRIPT" ] && [ -x "$SCRIPT" ] \
	&& ok "$SCRIPT existe et est exécutable" \
	|| fail "$SCRIPT est absent ou non exécutable"

grep -q '^# @spec CRM-080 ' "$SCRIPT" \
	&& ok "l'en-tête cite l'unité de backlog CRM-080" \
	|| fail "l'en-tête ne cite pas CRM-080 (CLAUDE.md §5, traçabilité)"

grep -q '^# @spec docs/SPEC-backups.md ' "$SCRIPT" \
	&& ok "l'en-tête cite les chapitres de docs/SPEC-backups.md" \
	|| fail "l'en-tête ne cite aucun chapitre de spécification"

grep -q '^set -euo pipefail$' "$SCRIPT" \
	&& ok "le mode strict du dépôt est posé" \
	|| fail "« set -euo pipefail » manque"

"$REPO/$SCRIPT" --help > "$BAC/aide.log" 2>&1 \
	&& grep -q 'RESTORE_AGE_IDENTITY_FILE' "$BAC/aide.log" \
	&& ok "--help imprime l'aide et documente RESTORE_AGE_IDENTITY_FILE" \
	|| fail "--help n'imprime pas l'aide attendue"

grep -q 'RESTORE_AGE_IDENTITY_FILE' .env.example \
	&& ok ".env.example documente RESTORE_AGE_IDENTITY_FILE (docs/SPEC-backups.md §11.5)" \
	|| fail ".env.example ne documente pas RESTORE_AGE_IDENTITY_FILE"

# LE SCRIPT NE DOIT JAMAIS DÉTRUIRE PAR MOTIF. Ce contrôle lit le code livré : un `docker rm` dont
# l'argument ne serait pas l'une des deux variables de nom ferait de la garde du §11.2 une garde
# conditionnelle, c'est-à-dire une garde qu'un jour on contourne.
if grep -E '^\s*[^#]*docker rm' "$SCRIPT" | grep -qvE '\$JETABLE_DB|\$JETABLE_MINIO|"\$nom"'; then
	fail "un « docker rm » du script vise autre chose que les deux noms retenus (docs/SPEC-backups.md §11.2)"
else
	ok "tout « docker rm » du script ne vise que les noms qu'il a lui-même retenus"
fi

grep -q 'docker compose' "$SCRIPT" \
	&& fail "le script appelle « docker compose » : il pourrait alors atteindre la pile (§11.1)" \
	|| ok "le script n'appelle jamais « docker compose », sous aucune forme"

# --- 2. L'objet témoin, déposé AVANT la sauvegarde ----------------------------------------------
#
# Le dépôt objet du seed est VIDE (docs/SPEC-backups.md §2, mesure M6). Restaurer un dossier vide et
# le constater ne dirait rien du chemin des objets : le harnais dépose donc un témoin, et exige de
# le retrouver dans le dépôt jetable.

titre "2. L'objet témoin, et l'archive de référence"

if [ -n "$CONTENEUR_MINIO" ] && [ -n "$BUCKET" ]; then
	docker exec "$CONTENEUR_MINIO" test -e "/data/$BUCKET/$TEMOIN_OBJET" 2>/dev/null \
		&& fail "le témoin « $TEMOIN_OBJET » existait déjà : une exécution précédente n'a pas nettoyé" \
		|| ok "le témoin n'était pas présent avant cette exécution"

	echo "preuve-crm-080-tranche-2" > "$BAC/temoin.txt"
	docker cp "$BAC/temoin.txt" "$CONTENEUR_MINIO:/data/$BUCKET/$TEMOIN_OBJET" >/dev/null 2>&1 \
		&& ok "témoin déposé dans le dépôt objet de la pile" \
		|| fail "le témoin n'a pas pu être déposé dans le dépôt objet"
	TEMOIN_ATTENDU=1

	# LE NOMBRE ATTENDU EST COMPTÉ, IL N'EST PLUS SUPPOSÉ — révision du 2026-08-20.
	#
	# Ce contrôle exigeait littéralement « 1 objet(s) restauré(s) », nombre valide uniquement sur le
	# dépôt objet VIDE du seed (docs/SPEC-backups.md §2, mesure M6), où le témoin est le seul objet.
	# Or toute suite E2E qui ingère une pièce jointe en dépose de vrais : MESURÉ le 2026-08-20, après
	# `npm run e2e:api` et `npm run e2e:mail`, le dépôt en porte QUATRE, et l'exercice rendait
	# fidèlement « 5 objet(s) restauré(s), aucun manquant » — un dépôt sain, une restauration sans
	# faute, et pourtant un rouge. Un harnais qui rougit sur un dépôt sain apprend à être ignoré.
	#
	# Le nombre est donc COMPTÉ ici, juste après le dépôt du témoin, par le même chemin que
	# l'exercice emploie : `docker cp` produit le flux `tar` côté DÉMON, l'image MinIO ne portant ni
	# `tar` ni `find` (mesure M5). Le contrôle est strictement PLUS FORT qu'avant : il n'exige plus
	# un nombre convenu mais le nombre réel, et « aucun manquant » porte toujours sur CHAQUE entrée
	# de l'archive — donc sur le témoin, dont la présence préalable vient d'être constatée.
	OBJETS_ATTENDUS=$(docker cp "$CONTENEUR_MINIO:/data/$BUCKET" - 2>/dev/null | tar -tf - | grep -cv '/$' || true)
	ok "le dépôt objet porte $OBJETS_ATTENDUS objet(s), témoin compris — nombre COMPTÉ, non supposé"
else
	ok "dépôt objet externe : le contrôle du témoin ne s'applique pas (cas y)"
	TEMOIN_ATTENDU=0
fi

env BACKUP_AGE_RECIPIENTS_FILE="$BAC/destinataires.txt" \
    "$REPO/$SAUVEGARDE" --output-dir "$SORTIE" > "$BAC/sauvegarde.log" 2>&1 \
	&& ok "une archive de référence a été produite par le VRAI scripts/backup.sh" \
	|| fail "la sauvegarde de référence a échoué : $(tail -2 "$BAC/sauvegarde.log")"

ARCHIVE=$(find "$SORTIE" -maxdepth 1 -type f -name "$PREFIXE-*$SUFFIXE" | sort | tail -1)
[ -n "$ARCHIVE" ] \
	&& ok "l'archive de référence est déposée : $(basename "$ARCHIVE")" \
	|| { fail "aucune archive de référence : les contrôles suivants ne diraient rien"; echo; exit 1; }

# --- 3. Cas o, p, z : l'exercice nominal --------------------------------------------------------

titre "3. Cas o, p et z — l'exercice nominal, de bout en bout"

if exercer "$ARCHIVE"; then
	ok "cas o : l'exercice rend 0 sur une archive valide"
else
	fail "cas o : l'exercice a échoué — $(tail -3 "$BAC/exercice.log")"
fi

grep -q 'toutes conformes' "$BAC/exercice.log" \
	&& ok "cas p : toutes les empreintes du manifeste ont été vérifiées avant restauration" \
	|| fail "cas p : le rapport ne constate pas la vérification des empreintes"

grep -q '0 erreur' "$BAC/exercice.log" \
	&& ok "cas p : « pg_restore » a rendu ZÉRO erreur (docs/SPEC-backups.md §10, M10)" \
	|| fail "cas p : le rapport ne constate pas une restauration sans erreur"

grep -qE 'I1 déchiffrement de Vault : [1-9][0-9]* secret' "$BAC/exercice.log" \
	&& ok "cas p : I1 — des secrets de Vault ont été RÉELLEMENT déchiffrés dans la pile restaurée" \
	|| fail "cas p : I1 n'a déchiffré aucun secret"

grep -q 'I5 politiques RLS' "$BAC/exercice.log" \
	&& grep -q 'I6 tables à RLS active' "$BAC/exercice.log" \
	&& ok "cas p : I5 et I6 — les politiques RLS et leur activation ont été comparées (CLAUDE.md §10)" \
	|| fail "cas p : les invariants d'autorisation n'ont pas été comparés"

grep -q 'référence   p2enjoy-db' "$BAC/exercice.log" \
	&& ok "cas p : la comparaison a bien eu lieu des DEUX côtés" \
	|| fail "cas p : le rapport n'annonce pas de comparaison avec la pile de référence"

if [ "$TEMOIN_ATTENDU" = "1" ]; then
	grep -q "I7 dépôt objet : $OBJETS_ATTENDUS objet(s) restauré(s), aucun manquant" "$BAC/exercice.log" \
		&& ok "cas f/I7 : les $OBJETS_ATTENDUS objets sont ressortis du dépôt jetable, TÉMOIN compris" \
		|| fail "cas f/I7 : le compte restauré ne vaut pas les $OBJETS_ATTENDUS objets déposés — $(grep 'I7' "$BAC/exercice.log" || echo 'aucune ligne I7')"
fi

[ "$(jetables_restants)" = "0" ] \
	&& ok "cas z : aucun conteneur « $PREFIXE_JETABLE-* » ne survit à l'exercice" \
	|| fail "cas z : un environnement jetable a survécu (docs/SPEC-backups.md §11.2)"

pile_intacte \
	&& ok "cas z : les conteneurs de la pile sont les mêmes, par leur IDENTIFIANT" \
	|| fail "cas z : la pile a changé — un conteneur a été recréé ou détruit (§11.7)"

# --- 4. CAS Q : la dégradation centrale ---------------------------------------------------------
#
# C'EST LE CONTRÔLE QUI REND CE HARNAIS NON COMPLAISANT. Mesuré (docs/SPEC-backups.md §10, M12) :
# restaurée avec une clé racine étrangère, la base rend `rc=0`, zéro erreur, et TOUS les autres
# invariants identiques — 36 tables, 103 politiques, 3 utilisateurs, 41 cards, 4 messages,
# 5 secrets. Seul le déchiffrement voit la différence. Si l'exercice rendait vert ici, il ne
# vérifierait rien de ce qu'il annonce vérifier.

titre "4. Cas q — la clé racine remplacée : le déchiffrement DOIT échouer"

reforger() {
	# Reconstruit une archive à partir de la vraie, en appliquant une transformation à son contenu.
	# Le harnais ne fabrique donc jamais une archive de toutes pièces : il DÉGRADE la vraie.
	local transformation=$1 cible=$2 travail
	travail=$(mktemp -d -p "$BAC")
	age --decrypt -i "$BAC/id.txt" -o "$travail/a.tar" "$ARCHIVE"
	tar -C "$travail" -xf "$travail/a.tar"
	rm -f "$travail/a.tar"
	local racine
	racine=$(find "$travail" -mindepth 1 -maxdepth 1 -type d -name "$PREFIXE-*")
	"$transformation" "$racine"
	tar -C "$travail" -cf - "$(basename "$racine")" \
		| age --encrypt --recipients-file "$BAC/destinataires.txt" -o "$cible"
	rm -rf "$travail"
}

# La clé racine est remplacée par une autre de MÊME TAILLE, et le manifeste est mis en accord :
# c'est bien le déchiffrement qui doit trébucher, non le contrôle d'intégrité. Une archive dont
# l'empreinte ne correspondrait plus serait arrêtée par R23, et n'éprouverait pas I1.
degrader_cle() {
	local racine=$1 nouvelle
	nouvelle=$(head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n')
	printf '%s' "$nouvelle" > "$racine/pgsodium_root.key"
	local taille empreinte
	taille=$(stat -c%s "$racine/pgsodium_root.key")
	empreinte=$(sha256sum "$racine/pgsodium_root.key" | awk '{print $1}')
	sed -i "s|^membre=pgsodium_root.key .*|membre=pgsodium_root.key $taille $empreinte|" "$racine/MANIFESTE.txt"
}

reforger degrader_cle "$BAC/cle-etrangere$SUFFIXE"

if exercer "$BAC/cle-etrangere$SUFFIXE"; then
	fail "CAS Q : l'exercice a rendu VERT sur une archive dont la clé racine est étrangère — il ne vérifie pas ce qu'il annonce"
else
	ok "cas q : l'exercice ÉCHOUE quand la clé racine ne déchiffre pas les secrets"
fi

grep -q 'I1 déchiffrement de Vault : ÉCHEC' "$BAC/exercice.log" \
	&& ok "cas q : l'échec est bien attribué à I1, et nommé" \
	|| fail "cas q : l'échec n'est pas attribué au déchiffrement — $(tail -2 "$BAC/exercice.log")"

# ET LA PREUVE QUE LA DÉGRADATION ÉTAIT INDÉTECTABLE AUTREMENT : les autres invariants sont passés.
grep -q 'I4 tables de public' "$BAC/exercice.log" \
	&& ok "cas q : les autres invariants restaient conformes — seul I1 voit la clé perdue (M12)" \
	|| fail "cas q : les autres invariants n'ont pas été atteints, la dégradation n'a pas isolé I1"

[ "$(jetables_restants)" = "0" ] \
	&& ok "cas q : l'environnement jetable est détruit MALGRÉ l'échec" \
	|| fail "cas q : un environnement jetable a survécu à l'échec"

# --- 5. Cas r à v : les refus, chacun exigé DEUX fois -------------------------------------------
#
# Deux fois : code non nul ET aucun conteneur jetable créé. Un refus qui laisserait derrière lui un
# conteneur serait un refus à moitié tenu.

titre "5. Cas r à v — les refus, et l'absence de tout résidu"

refus_exige() {
	local libelle=$1 attendu=$2 ; shift 2
	if exercer "$@"; then
		fail "$libelle : l'exercice a réussi alors qu'il devait refuser"
	else
		grep -q "$attendu" "$BAC/exercice.log" \
			&& ok "$libelle : refusé, et le message nomme sa cause" \
			|| fail "$libelle : refusé, mais le message n'est pas celui attendu — $(tail -2 "$BAC/exercice.log")"
	fi
	[ "$(jetables_restants)" = "0" ] \
		|| fail "$libelle : un conteneur jetable a survécu au refus"
}

# Cas r — une empreinte altérée. Le membre est modifié SANS mettre le manifeste en accord : c'est
# exactement la corruption survenue avant chiffrement que le §3.3 vise.
degrader_empreinte() { printf 'corruption' >> "$1/base.dump" ; }
reforger degrader_empreinte "$BAC/empreinte-fausse$SUFFIXE"
refus_exige "cas r (empreinte altérée)" "l'archive est corrompue, rien n'a été restauré" "$BAC/empreinte-fausse$SUFFIXE"

# Cas s — un format que l'exercice ne sait pas lire.
degrader_format() { sed -i 's/^format_version=1$/format_version=2/' "$1/MANIFESTE.txt" ; }
reforger degrader_format "$BAC/format-inconnu$SUFFIXE"
refus_exige "cas s (format inconnu)" "que cet exercice ne sait pas lire" "$BAC/format-inconnu$SUFFIXE"

# Cas t — une identité qui n'ouvre pas l'archive.
age-keygen -o "$BAC/autre-id.txt" >/dev/null 2>&1
IDENTITE_OVERRIDE="$BAC/autre-id.txt" \
	refus_exige "cas t (identité étrangère)" "l'identité fournie n'ouvre pas cette archive" "$ARCHIVE"
unset IDENTITE_OVERRIDE

# Cas u — l'identité non renseignée.
IDENTITE_OVERRIDE="" \
	refus_exige "cas u (identité absente)" "RESTORE_AGE_IDENTITY_FILE doit désigner" "$ARCHIVE"
unset IDENTITE_OVERRIDE

# Cas v — une archive qui n'existe pas.
refus_exige "cas v (archive introuvable)" "aucune archive à restaurer" "$BAC/nexiste-pas$SUFFIXE"

# --- 6. Cas w : la garde de destruction, ÉPROUVÉE et non promise --------------------------------
#
# Un conteneur étranger porte le nom que l'exercice s'apprêterait à prendre. L'exercice doit refuser
# — et surtout, ce conteneur doit SURVIVRE. C'est le contrôle qui distingue une garde structurelle
# d'une garde qu'on affirme.

titre "6. Cas w — un nom déjà pris : refus, et le conteneur étranger SURVIT"

# LE NOM EST IMPOSÉ, IL N'EST PAS DEVINÉ — et c'est pourquoi `--suffixe` existe. La première
# rédaction de ce contrôle prenait l'horodatage courant en espérant que l'exercice calculerait le
# même une fraction de seconde plus tard, APRÈS son déchiffrement et sa vérification d'empreintes,
# dont la durée varie. MESURÉ : vert à une exécution, rouge à la suivante. Un contrôle intermittent
# n'est pas une preuve, et la réponse n'était ni une temporisation ni un rejeu — c'était de rendre
# le nom déterministe. L'exercice a donc gagné une option, et ce contrôle éprouve enfin R24.
DISCRIMINANT="usurpateur-$$"
USURPATEUR="$PREFIXE_JETABLE-$DISCRIMINANT"
docker run -d --name "$USURPATEUR" --entrypoint sleep alpine:3 300 >/dev/null 2>&1 \
	|| { echo "ERREUR : le conteneur d'usurpation du cas w n'a pas pu être créé." >&2; exit 1; }
USURPATEUR_ID=$(docker ps -q --filter "name=^/$USURPATEUR$")

if exercer --suffixe "$DISCRIMINANT" "$ARCHIVE"; then
	fail "cas w : l'exercice a réussi alors qu'un conteneur portait déjà son nom jetable"
else
	grep -q "existe déjà : l'exercice refuse de réutiliser" "$BAC/exercice.log" \
		&& ok "cas w : l'exercice refuse un nom jetable déjà pris" \
		|| fail "cas w : refusé, mais pas pour le nom déjà pris — $(tail -2 "$BAC/exercice.log")"
fi

# LE CONTRÔLE QUI COMPTE : le conteneur étranger est toujours là, ET C'EST LE MÊME — comparé par son
# identifiant, un conteneur recréé sous le même nom ne passerait pas.
[ "$(docker ps -q --filter "name=^/$USURPATEUR$")" = "$USURPATEUR_ID" ] \
	&& ok "cas w : le conteneur étranger a SURVÉCU, identifiant inchangé — la garde ne détruit que ce qu'elle a créé" \
	|| fail "cas w : le conteneur étranger a été détruit ou recréé (docs/SPEC-backups.md §11.2)"

docker rm -f "$USURPATEUR" >/dev/null 2>&1
USURPATEUR=""

# --- 7. Cas x et z : l'état final ---------------------------------------------------------------

titre "7. Cas x et z — l'état final de l'hôte"

[ "$(jetables_restants)" = "0" ] \
	&& ok "cas z : aucun conteneur « $PREFIXE_JETABLE-* » ne subsiste après la série entière" \
	|| fail "cas z : des environnements jetables subsistent : $(docker ps -a --filter "name=^/$PREFIXE_JETABLE" --format '{{.Names}}' | tr '\n' ' ')"

pile_intacte \
	&& ok "cas z : les 17 services de la pile sont intacts, comparés par leur identifiant" \
	|| fail "cas z : la pile a changé pendant la série (docs/SPEC-backups.md §11.7)"

# La pile n'a pas été écrite : le témoin est le seul objet que le harnais y ait posé, et il doit
# encore y être — c'est LUI qui le retire, pas l'exercice (§14).
if [ "$TEMOIN_ATTENDU" = "1" ]; then
	docker exec "$CONTENEUR_MINIO" test -e "/data/$BUCKET/$TEMOIN_OBJET" 2>/dev/null \
		&& ok "l'exercice n'a rien retiré du dépôt objet de la pile : le témoin y est toujours" \
		|| fail "le témoin a disparu du dépôt objet : l'exercice a écrit dans la pile (§11.7)"
fi

# --- Bilan --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi

#!/usr/bin/env bash
# @spec CRM-080 (docs/BACKLOG.md) — tranche 1, la sauvegarde chiffrée
# @spec docs/SPEC-backups.md §3 (ce que le script produit), §3.2 (contenu de l'archive),
#       §3.3 (manifeste d'intégrité), §3.4 (chiffrement par destinataires publics),
#       §3.5 (déroulé et atomicité), §3.6 (rétention), §3.7 (les douze refus),
#       §3.8 (ce que le script n'écrit jamais), §4 (variables d'environnement),
#       §5 (contrat de comportement, cas a à n)
# @spec docs/DAT.md §10 (reprise et continuité : la clé racine de Vault vit hors de PGDATA)
# @spec CLAUDE.md §9 (aucune opération destructrice par commodité), §20 (aucun secret journalisé)
#
# Produit une sauvegarde chiffrée de la pile : la base, la clé racine de Vault, et le dépôt
# objet lorsqu'il est local.
#
# Usage :
#   scripts/backup.sh                      sauvegarde dans $BACKUP_OUTPUT_DIR
#   scripts/backup.sh --output-dir DIR     sauvegarde dans DIR
#   scripts/backup.sh --help
#
# Variables d'environnement (docs/SPEC-backups.md §4) :
#   BACKUP_AGE_RECIPIENTS_FILE  fichier des CLÉS PUBLIQUES age destinataires — requis
#   BACKUP_OUTPUT_DIR           répertoire des archives, hors du dépôt Git — défaut /var/backups/p2enjoy
#   BACKUP_RETENTION_DAYS       âge maximal d'une archive conservée, entier >= 1 — défaut 30
#
# Le chiffrement n'emploie QUE des clés publiques : l'hôte qui sauvegarde ne peut relire aucune de
# ses propres archives. La clé privée correspondante vit ailleurs, et ce script ne la lit jamais.
#
# Une exécution réussie dépose exactement un fichier :
#   p2enjoy-sauvegarde-AAAAMMJJTHHMMSSZ.tar.age
#
# Toute erreur laisse le répertoire de sortie inchangé : l'archive n'est renommée qu'une fois
# entièrement écrite (docs/SPEC-backups.md §3.5).

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/env.sh"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

PREFIXE_ARCHIVE=p2enjoy-sauvegarde
SUFFIXE_ARCHIVE=.tar.age

# --- Arguments ---------------------------------------------------------------------------------

OUTPUT_DIR_ARG=""

while [ $# -gt 0 ]; do
	case "$1" in
		--help|-h) print_header_help "$SCRIPT_PATH"; exit 0 ;;
		--output-dir)
			[ $# -ge 2 ] || die "--output-dir attend un chemin."
			OUTPUT_DIR_ARG=$2
			shift 2
			;;
		*) die "argument inconnu « $1 ». Voir --help." ;;
	esac
done

# --- Nettoyage : rien de partiel ne survit à une erreur (docs/SPEC-backups.md §3.5) -------------
#
# Le `trap` couvre les trois sorties possibles — succès, erreur sous `set -e`, interruption. Il
# détruit l'assemblage temporaire et, si le renommage atomique n'a pas eu lieu, le fichier partiel.
# Sans lui, un disque plein laisserait dans le répertoire de sortie un objet que la tranche 2
# prendrait pour une sauvegarde.

ASSEMBLAGE=""
PARTIEL=""

nettoyer() {
	[ -n "$ASSEMBLAGE" ] && [ -d "$ASSEMBLAGE" ] && rm -rf "$ASSEMBLAGE"
	[ -n "$PARTIEL" ] && [ -e "$PARTIEL" ] && rm -f "$PARTIEL"
	return 0
}
trap nettoyer EXIT INT TERM

# --- Prérequis : tout est contrôlé AVANT la moindre écriture (docs/SPEC-backups.md §3.5) --------

# R1 — `age` est un prérequis dur : aucun repli silencieux, sans quoi le format de l'archive
# dépendrait de l'hôte et la tranche 2 aurait plusieurs formats à savoir lire.
command -v age >/dev/null 2>&1 \
	|| die "« age » est introuvable : la sauvegarde chiffrée l'exige (voir README §4)."

# Configuration : l'environnement du shell prévaut, `.env` sert de repli. Une tâche planifiée n'a
# donc rien à exporter — elle appelle le script, qui lit la configuration là où le dépôt la
# centralise (CLAUDE.md §3). L'environnement garde le dernier mot pour qu'un opérateur puisse
# viser un autre répertoire le temps d'une exécution sans toucher au fichier.
reglage() {
	local nom=$1 depuis_env
	depuis_env=$(eval "printf '%s' \"\${$nom:-}\"")
	if [ -n "$depuis_env" ]; then
		printf '%s' "$depuis_env"
	elif [ -f "$ENV_FILE" ] && env_has "$ENV_FILE" "$nom"; then
		env_get "$ENV_FILE" "$nom"
	fi
}

# R2 à R4 — le fichier de destinataires. Il ne porte que des clés PUBLIQUES ; son absence ou son
# vide sont des erreurs, jamais un motif de produire une archive en clair.
DESTINATAIRES=$(reglage BACKUP_AGE_RECIPIENTS_FILE)
[ -n "$DESTINATAIRES" ] \
	|| die "BACKUP_AGE_RECIPIENTS_FILE n'est pas renseignée : elle doit désigner le fichier des clés publiques de chiffrement."
[ -r "$DESTINATAIRES" ] && [ -s "$DESTINATAIRES" ] \
	|| die "le fichier de destinataires « $DESTINATAIRES » est illisible ou vide."
grep -Eq '^[[:space:]]*(age1[0-9a-z]+|ssh-(rsa|ed25519)[[:space:]])' "$DESTINATAIRES" \
	|| die "le fichier de destinataires « $DESTINATAIRES » ne contient aucune clé publique reconnue."

# R9 — la rétention est validée avant toute écriture : une valeur fautive découverte à la fin
# aurait déjà consommé le temps d'un dump complet.
RETENTION=$(reglage BACKUP_RETENTION_DAYS)
RETENTION=${RETENTION:-30}
case "$RETENTION" in
	''|*[!0-9]*) die "BACKUP_RETENTION_DAYS doit être un entier supérieur ou égal à 1 (reçu « $RETENTION »)." ;;
esac
[ "$RETENTION" -ge 1 ] \
	|| die "BACKUP_RETENTION_DAYS doit être un entier supérieur ou égal à 1 (reçu « $RETENTION »)."

# R7, R8 — le répertoire de sortie. Le chemin est CANONISÉ **avant** d'être créé : `realpath -m`
# résout `..` et les liens sans exiger que la cible existe. L'ordre compte — canoniser après un
# `mkdir` créerait dans le dépôt le répertoire qu'on s'apprête à refuser.
SORTIE=$OUTPUT_DIR_ARG
[ -n "$SORTIE" ] || SORTIE=$(reglage BACKUP_OUTPUT_DIR)
SORTIE=${SORTIE:-/var/backups/p2enjoy}
SORTIE=$(realpath -m "$SORTIE")
RACINE_CANONIQUE=$(realpath -m "$REPO_ROOT")
case "$SORTIE/" in
	"$RACINE_CANONIQUE"/*)
		die "le répertoire de sortie « $SORTIE » est dans le dépôt Git : une sauvegarde chiffrée n'a rien à y faire."
		;;
esac
mkdir -p "$SORTIE" 2>/dev/null \
	|| die "le répertoire de sortie « $SORTIE » n'est pas inscriptible."
[ -w "$SORTIE" ] || die "le répertoire de sortie « $SORTIE » n'est pas inscriptible."

# R5, R6 — Docker et le conteneur de base. La sauvegarde lit la base PAR le conteneur (M1) : la
# version de `pg_dump` est alors celle du serveur, et aucun client n'est requis sur l'hôte.
require_docker

CONTENEUR_DB=$(docker ps --filter "name=^/p2enjoy-db$" --filter "status=running" --format '{{.Names}}')
[ -n "$CONTENEUR_DB" ] \
	|| die "le service « db » n'est pas démarré : la sauvegarde lit la base par lui."

# --- Assemblage --------------------------------------------------------------------------------

HORODATAGE=$(date -u '+%Y%m%dT%H%M%SZ')
NOM_ARCHIVE="$PREFIXE_ARCHIVE-$HORODATAGE"
CIBLE="$SORTIE/$NOM_ARCHIVE$SUFFIXE_ARCHIVE"
PARTIEL="$SORTIE/.$NOM_ARCHIVE$SUFFIXE_ARCHIVE.partiel"

ASSEMBLAGE=$(mktemp -d)
chmod 700 "$ASSEMBLAGE"
RACINE="$ASSEMBLAGE/$NOM_ARCHIVE"
mkdir -p "$RACINE"

say "Sauvegarde chiffrée de la pile P2Enjoy"
info "archive     $CIBLE"
info "conteneur   $CONTENEUR_DB"

BASE=$(docker exec "$CONTENEUR_DB" printenv POSTGRES_DB 2>/dev/null || true)
BASE=${BASE:-postgres}

# 1. La base. `pg_dump -Fc` est le format « custom » : compressé, et lisible par `pg_restore`, qui
#    seul permet une restauration sélective. L'authentification passe par le socket local du
#    conteneur, donc aucun mot de passe ne transite par une ligne de commande (docs/SPEC-backups.md
#    §2, mesure M2).
if ! docker exec "$CONTENEUR_DB" pg_dump -U postgres -d "$BASE" -Fc > "$RACINE/base.dump" 2>"$ASSEMBLAGE/pg_dump.err"; then
	CODE=$?
	warn "$(head -c 2000 "$ASSEMBLAGE/pg_dump.err")"
	die "« pg_dump » a échoué (code $CODE) : aucune archive n'a été écrite."
fi
info "base        $(stat -c%s "$RACINE/base.dump") octets"

# 2. La clé racine de Vault. C'est la règle qui justifie ce script autant que le dump lui-même :
#    la clé vit dans le volume `db-config`, HORS de PGDATA (docs/DAT.md §10, mesure M3). Une archive
#    sans elle laisserait tous les secrets de messagerie chiffrés et indéchiffrables — il faudrait
#    ressaisir chaque mot de passe de compte. Le script REFUSE donc de la produire, plutôt que
#    d'émettre un avertissement dont l'expérience montre qu'il n'est pas suivi.
if ! docker exec "$CONTENEUR_DB" cat /etc/postgresql-custom/pgsodium_root.key > "$RACINE/pgsodium_root.key" 2>/dev/null \
	|| [ ! -s "$RACINE/pgsodium_root.key" ]; then
	die "la clé racine « /etc/postgresql-custom/pgsodium_root.key » est absente : une archive sans elle ne restituerait aucun secret de messagerie (docs/DAT.md §10)."
fi
info "clé racine  $(stat -c%s "$RACINE/pgsodium_root.key") octets"

# 3. Le dépôt objet, SEULEMENT s'il est local. La condition est LUE — le conteneur MinIO tourne-t-il
#    dans cette pile ? — et non supposée. En production, le stockage est un fournisseur S3 externe :
#    le membre est alors absent, le manifeste l'écrit, et le script le dit. Il n'invente pas un
#    client S3 et ne prétend pas avoir sauvegardé ce qu'il n'a pas lu.
#
#    L'export passe par `docker cp <conteneur>:<chemin> -`, dont le flux `tar` est produit par le
#    DÉMON Docker : l'image MinIO ne porte ni `tar` ni `find` (mesure M5).
CONTENEUR_MINIO=$(docker ps --filter "name=^/p2enjoy-minio$" --filter "status=running" --format '{{.Names}}')
BUCKET=$(env_has "$ENV_FILE" GLOBAL_S3_BUCKET 2>/dev/null && env_get "$ENV_FILE" GLOBAL_S3_BUCKET || true)

if [ -n "$CONTENEUR_MINIO" ] && [ -n "$BUCKET" ]; then
	DEPOT_OBJET=minio-local
	docker cp "$CONTENEUR_MINIO:/data/$BUCKET" - > "$RACINE/objets.tar"
	info "objets      $(stat -c%s "$RACINE/objets.tar") octets (bucket « $BUCKET »)"
else
	DEPOT_OBJET=externe
	BUCKET=${BUCKET:-inconnu}
	warn "dépôt objet externe : ses objets relèvent du fournisseur, cette archive ne les porte pas."
fi

# --- Manifeste (docs/SPEC-backups.md §3.3) -----------------------------------------------------
#
# Texte lisible sans outil, `clé=valeur`. Aucun secret n'y figure : c'est la partie de l'archive
# la plus susceptible d'être citée dans un ticket d'exploitation (CLAUDE.md §20).
#
# Les empreintes détectent une corruption survenue AVANT le chiffrement — un dump tronqué par un
# disque plein. Une altération postérieure, elle, empêche purement et simplement le déchiffrement :
# le format `age` est authentifié.

VERSION_PG=$(docker exec "$CONTENEUR_DB" pg_dump --version | awk '{print $NF}')
PROFIL=$(env_has "$ENV_FILE" P2ENJOY_ENV_PROFILE 2>/dev/null && env_get "$ENV_FILE" P2ENJOY_ENV_PROFILE || echo inconnu)

MANIFESTE="$RACINE/MANIFESTE.txt"
{
	echo "format_version=1"
	echo "cree_le=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	echo "profil=$PROFIL"
	echo "base_de_donnees=$BASE"
	echo "postgres_version=$VERSION_PG"
	echo "depot_objet=$DEPOT_OBJET"
	echo "bucket_objet=$BUCKET"
} > "$MANIFESTE"

for membre in base.dump pgsodium_root.key objets.tar; do
	[ -f "$RACINE/$membre" ] || continue
	echo "membre=$membre $(stat -c%s "$RACINE/$membre") $(sha256sum "$RACINE/$membre" | awk '{print $1}')" >> "$MANIFESTE"
done

# --- Chiffrement, puis renommage atomique (docs/SPEC-backups.md §3.5) --------------------------
#
# Le fichier est d'abord écrit sous un nom qui ne correspond NI au motif de la rétention NI à celui
# qu'énumérera la tranche 2 : un lecteur du répertoire de sortie ne peut donc jamais prendre une
# archive en cours d'écriture pour une sauvegarde valide.

if ! tar -C "$ASSEMBLAGE" -cf - "$NOM_ARCHIVE" \
	| age --encrypt --recipients-file "$DESTINATAIRES" -o "$PARTIEL"; then
	die "le chiffrement a échoué : aucune archive n'a été écrite."
fi

mv "$PARTIEL" "$CIBLE"
PARTIEL=""
chmod 600 "$CIBLE"

info "chiffrée    $(stat -c%s "$CIBLE") octets"

# --- Rétention (docs/SPEC-backups.md §3.6) -----------------------------------------------------
#
# Appliquée APRÈS l'écriture réussie : on ne fait pas de place pour une sauvegarde qui n'existe
# pas. Le motif est strict — rien d'autre du répertoire n'est jamais candidat —, et chaque
# suppression est énumérée : une rétention qui efface en silence est indistinguable d'une
# corruption (CLAUDE.md §9).

SUPPRIMEES=0
while IFS= read -r ancienne; do
	[ -n "$ancienne" ] || continue
	rm -f "$ancienne"
	info "rétention   supprimée $(basename "$ancienne")"
	SUPPRIMEES=$((SUPPRIMEES + 1))
done < <(find "$SORTIE" -maxdepth 1 -type f -name "$PREFIXE_ARCHIVE-*$SUFFIXE_ARCHIVE" -mtime "+$RETENTION" 2>/dev/null)

say "Sauvegarde terminée"
info "$CIBLE"
info "membres     $(grep -c '^membre=' "$MANIFESTE") ; rétention $RETENTION jours ; $SUPPRIMEES archive(s) supprimée(s)"
info "Déchiffrement : age --decrypt -i <clé privée> « $(basename "$CIBLE") » | tar -x"

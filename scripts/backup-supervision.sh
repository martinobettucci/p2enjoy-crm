#!/usr/bin/env bash
# @spec CRM-080 (docs/BACKLOG.md) — tranche 3, l'exploitation des sauvegardes
# @spec docs/SPEC-backups.md §16 (ce que l'exploitation peut réellement observer, mesures M16 à
#       M21), §17 (les neuf contrôles, les trois codes de retour, l'option --cron, les huit
#       refus, ce que l'observateur n'écrit jamais), §18 (variables d'environnement),
#       §19 (le runbook qui l'appelle), §20 (contrat de comportement, cas A à L)
# @spec docs/DAT.md §10 (reprise et continuité)
# @spec CLAUDE.md §9 (aucune opération destructrice), §20 (aucun secret journalisé)
#
# Observe un répertoire de sauvegardes et rend un verdict. C'est une LECTURE : il ne produit
# aucune archive, n'en supprime aucune, ne déchiffre rien, et ne touche ni la pile ni la base.
#
# Usage :
#   scripts/backup-supervision.sh                  rapport détaillé des neuf contrôles
#   scripts/backup-supervision.sh --cron           n'imprime RIEN si tout est vert
#   scripts/backup-supervision.sh --output-dir DIR observe DIR
#   scripts/backup-supervision.sh --help
#
# Codes de retour — c'est le contrat d'alerte (docs/SPEC-backups.md §17.2) :
#   0  tous les contrôles applicables sont verts
#   1  au moins une alerte : le déclencheur doit avertir un humain
#   2  refus : l'observateur n'a pas pu observer, la configuration est inutilisable
#
# Variables d'environnement (docs/SPEC-backups.md §18) :
#   BACKUP_OUTPUT_DIR          répertoire observé — défaut /var/backups/p2enjoy (partagée)
#   BACKUP_RETENTION_DAYS      rétention appliquée par backup.sh — défaut 30 (partagée)
#   BACKUP_MAX_AGE_HOURS       âge maximal de la dernière archive — défaut 26
#   BACKUP_MIN_RECIPIENTS      destinataires age attendus dans l'en-tête — défaut 1
#   BACKUP_OFFSITE_DIR         copie hors site à comparer — vide : contrôle non applicable
#   BACKUP_DRILL_STAMP_FILE    empreinte du dernier exercice réussi — vide : non applicable
#   BACKUP_DRILL_MAX_AGE_DAYS  âge maximal de cet exercice — défaut 30
#
# Aucune clé privée n'est lue : l'en-tête `age` est en clair (mesure M16), ce qui permet à cet
# observateur de tourner sur l'hôte de sauvegarde lui-même sans annuler la propriété du §3.4 —
# cet hôte ne peut relire aucune de ses propres archives.
#
# La fraîcheur se calcule sur l'horodatage porté par le NOM de l'archive, jamais sur sa date de
# modification : une copie hors site reçoit un `mtime` frais (mesure M18), et une supervision qui
# jugerait sur `mtime` déclarerait « récente » une copie vieille d'un mois qu'on vient de recopier.

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/env.sh"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

PREFIXE_ARCHIVE=p2enjoy-sauvegarde
SUFFIXE_ARCHIVE=.tar.age

# --- Refus : code 2, jamais 1 (docs/SPEC-backups.md §17.2) --------------------------------------
#
# `die` de la bibliothèque sort en 1, qui est ici le code de l'ALERTE. Les confondre ferait lire
# une variable mal écrite comme « pas de sauvegarde récente », et l'exploitant chercherait un
# incident de sauvegarde là où il y a une faute de configuration.

refus() { printf '\033[31mREFUS\033[0m %s\n' "$*" >&2; exit 2; }

# --- Arguments -----------------------------------------------------------------------------------

MODE_CRON=false
OUTPUT_DIR_ARG=""

while [ $# -gt 0 ]; do
	case "$1" in
		--help|-h) print_header_help "$SCRIPT_PATH"; exit 0 ;;
		--cron) MODE_CRON=true; shift ;;
		--output-dir)
			[ $# -ge 2 ] || refus "--output-dir attend un chemin."
			OUTPUT_DIR_ARG=$2
			shift 2
			;;
		*) refus "argument inconnu « $1 ». Voir --help." ;;
	esac
done

# --- Configuration -------------------------------------------------------------------------------
#
# L'environnement du shell prévaut, `.env` sert de repli : une tâche planifiée n'a rien à exporter,
# et un opérateur peut viser une autre destination le temps d'une exécution. Identique à
# `scripts/backup.sh`, dont cet observateur regarde le travail.

reglage() {
	local nom=$1 depuis_env
	depuis_env=$(eval "printf '%s' \"\${$nom:-}\"")
	if [ -n "$depuis_env" ]; then
		printf '%s' "$depuis_env"
	elif [ -f "$ENV_FILE" ] && env_has "$ENV_FILE" "$nom"; then
		env_get "$ENV_FILE" "$nom"
	fi
}

# Entier >= 1, sinon refus. Une valeur fautive découverte au milieu du rapport aurait déjà fait
# rendre des verdicts sur une configuration inutilisable.
entier_positif() {
	local nom=$1 valeur=$2 defaut=$3
	valeur=${valeur:-$defaut}
	case "$valeur" in
		''|*[!0-9]*) refus "$nom doit être un entier supérieur ou égal à 1 (reçu « $valeur »)." ;;
	esac
	[ "$valeur" -ge 1 ] || refus "$nom doit être un entier supérieur ou égal à 1 (reçu « $valeur »)."
	printf '%s' "$valeur"
}

SORTIE=$OUTPUT_DIR_ARG
[ -n "$SORTIE" ] || SORTIE=$(reglage BACKUP_OUTPUT_DIR)
SORTIE=${SORTIE:-/var/backups/p2enjoy}

# R41 à R44 — les quatre entiers, validés avant toute observation.
MAX_AGE_HOURS=$(entier_positif BACKUP_MAX_AGE_HOURS "$(reglage BACKUP_MAX_AGE_HOURS)" 26)
RETENTION=$(entier_positif BACKUP_RETENTION_DAYS "$(reglage BACKUP_RETENTION_DAYS)" 30)
MIN_RECIPIENTS=$(entier_positif BACKUP_MIN_RECIPIENTS "$(reglage BACKUP_MIN_RECIPIENTS)" 1)
DRILL_MAX_AGE_DAYS=$(entier_positif BACKUP_DRILL_MAX_AGE_DAYS "$(reglage BACKUP_DRILL_MAX_AGE_DAYS)" 30)

# R40 — le répertoire observé. Un répertoire absent n'est PAS « aucune sauvegarde » : c'est une
# configuration qui ne désigne rien, et le distinguer évite de faire chercher un incident de
# sauvegarde là où il y a un chemin mal écrit.
[ -d "$SORTIE" ] && [ -r "$SORTIE" ] \
	|| refus "le répertoire de sortie « $SORTIE » est introuvable ou illisible : la supervision ne peut rien observer."

# R45 — la destination hors site, quand elle est demandée.
HORS_SITE=$(reglage BACKUP_OFFSITE_DIR)
if [ -n "$HORS_SITE" ]; then
	[ -d "$HORS_SITE" ] && [ -r "$HORS_SITE" ] \
		|| refus "la destination hors site « $HORS_SITE » est introuvable ou illisible."
fi

# R46 — l'empreinte d'exercice, quand elle est demandée. Elle porte un horodatage ISO 8601 écrit
# par le DÉCLENCHEUR derrière un `&&` (docs/SPEC-backups.md §19.4) : elle n'existe donc que si
# l'exercice a rendu 0.
EMPREINTE=$(reglage BACKUP_DRILL_STAMP_FILE)
EMPREINTE_EPOCH=""
if [ -n "$EMPREINTE" ]; then
	[ -r "$EMPREINTE" ] && [ -s "$EMPREINTE" ] \
		|| refus "l'empreinte d'exercice « $EMPREINTE » est illisible ou ne porte pas un horodatage ISO 8601."
	EMPREINTE_EPOCH=$(date -u -d "$(tail -n 1 "$EMPREINTE" | tr -d '\r')" '+%s' 2>/dev/null || true)
	[ -n "$EMPREINTE_EPOCH" ] \
		|| refus "l'empreinte d'exercice « $EMPREINTE » est illisible ou ne porte pas un horodatage ISO 8601."
fi

# --- Verdicts ------------------------------------------------------------------------------------
#
# Les lignes sont accumulées plutôt qu'imprimées au fil de l'eau : le mode `--cron` n'imprime rien
# quand tout est vert, et cette décision ne se prend qu'une fois tous les contrôles faits.

ALERTES=0
LIGNES=""

vert()   { LIGNES="$LIGNES$(printf '  \033[32mOK\033[0m    %s' "$1")"$'\n'; }
alerte() { ALERTES=$((ALERTES + 1)); LIGNES="$LIGNES$(printf '  \033[31mALERTE\033[0m %s' "$1")"$'\n'; }
sans()   { LIGNES="$LIGNES$(printf '  \033[33mN/A\033[0m   %s' "$1")"$'\n'; }

# Instant porté par le nom d'une archive, en secondes epoch. Chaîne vide si le nom ne porte pas un
# horodatage lisible — le fichier est alors ignoré du calcul de fraîcheur et signalé, plutôt que de
# faire échouer l'observation entière : un fichier étranger déposé dans le répertoire ne doit pas
# empêcher la supervision de dire ce qu'elle sait des archives valides.
instant_du_nom() {
	local base=$1 horodatage iso
	base=$(basename "$base")
	horodatage=${base#"$PREFIXE_ARCHIVE"-}
	horodatage=${horodatage%"$SUFFIXE_ARCHIVE"}
	case "$horodatage" in
		[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
		*) return 0 ;;
	esac
	iso="${horodatage:0:4}-${horodatage:4:2}-${horodatage:6:2}T${horodatage:9:2}:${horodatage:11:2}:${horodatage:13:2}Z"
	date -u -d "$iso" '+%s' 2>/dev/null || true
}

# Archives d'un répertoire, triées par nom — donc chronologiquement (docs/SPEC-backups.md §3.1).
# Le tri lexicographique EST le tri chronologique, l'horodatage étant en largeur fixe et en UTC.
lister_archives() {
	local dir=$1
	[ -d "$dir" ] || return 0
	find "$dir" -maxdepth 1 -type f -name "$PREFIXE_ARCHIVE-*$SUFFIXE_ARCHIVE" 2>/dev/null | sort
}

MAINTENANT=$(date -u '+%s')

readarray -t ARCHIVES < <(lister_archives "$SORTIE")
NB_ARCHIVES=${#ARCHIVES[@]}

DERNIERE=""
[ "$NB_ARCHIVES" -gt 0 ] && DERNIERE=${ARCHIVES[$((NB_ARCHIVES - 1))]}

# --- S1. Présence ---------------------------------------------------------------------------------

if [ "$NB_ARCHIVES" -gt 0 ]; then
	vert "S1 présence — $NB_ARCHIVES archive(s) dans $SORTIE"
else
	alerte "S1 présence — aucune archive « $PREFIXE_ARCHIVE-*$SUFFIXE_ARCHIVE » dans $SORTIE"
fi

# --- S2. Fraîcheur, calculée sur le NOM (mesure M18) -----------------------------------------------

if [ -n "$DERNIERE" ]; then
	INSTANT=$(instant_du_nom "$DERNIERE")
	if [ -z "$INSTANT" ]; then
		alerte "S2 fraîcheur — « $(basename "$DERNIERE") » ne porte pas d'horodatage lisible dans son nom"
	else
		AGE_SECONDES=$((MAINTENANT - INSTANT))
		AGE_HEURES=$((AGE_SECONDES / 3600))
		if [ "$AGE_SECONDES" -le $((MAX_AGE_HOURS * 3600)) ]; then
			vert "S2 fraîcheur — la dernière archive a ${AGE_HEURES} h (seuil ${MAX_AGE_HOURS} h)"
		else
			alerte "S2 fraîcheur — la dernière archive a ${AGE_HEURES} h, au-delà du seuil de ${MAX_AGE_HOURS} h : la sauvegarde ne tourne peut-être plus"
		fi
	fi
else
	sans "S2 fraîcheur — aucune archive à dater"
fi

# --- S3. Forme : l'en-tête `age` est en clair (mesure M16) ------------------------------------------

if [ -n "$DERNIERE" ]; then
	if [ "$(head -c 21 "$DERNIERE" 2>/dev/null || true)" = "age-encryption.org/v1" ]; then
		vert "S3 forme — « $(basename "$DERNIERE") » porte l'en-tête age"
	else
		alerte "S3 forme — « $(basename "$DERNIERE") » ne commence pas par « age-encryption.org/v1 » : ce n'est pas une archive chiffrée valide"
	fi
else
	sans "S3 forme — aucune archive à lire"
fi

# --- S4. Destinataires : comptés, jamais identifiés (mesure M17) -------------------------------------

if [ -n "$DERNIERE" ]; then
	# L'en-tête tient dans les premiers octets ; le lire en entier serait inutile et coûteux sur une
	# archive de plusieurs gibioctets. `grep -c` sur un flux tronqué ne compte que des strophes
	# entières, la troncature tombant très au-delà de l'en-tête d'un nombre raisonnable de clés.
	NB_DESTINATAIRES=$(head -c 4096 "$DERNIERE" 2>/dev/null | grep -ac '^-> X25519' || true)
	NB_DESTINATAIRES=${NB_DESTINATAIRES:-0}
	if [ "$NB_DESTINATAIRES" -ge "$MIN_RECIPIENTS" ]; then
		vert "S4 destinataires — $NB_DESTINATAIRES dans l'en-tête (minimum $MIN_RECIPIENTS)"
	else
		alerte "S4 destinataires — $NB_DESTINATAIRES dans l'en-tête, or $MIN_RECIPIENTS sont attendus : la rotation n'a pas pris effet, ou un destinataire a été perdu"
	fi
else
	sans "S4 destinataires — aucune archive à lire"
fi

# --- S5. Effondrement de taille, RELATIF et jamais absolu ---------------------------------------------
#
# Un seuil en octets serait faux le jour où la base grossit, et personne ne le réviserait. La
# comparaison à l'archive précédente suit la base d'elle-même.

if [ "$NB_ARCHIVES" -ge 2 ]; then
	PRECEDENTE=${ARCHIVES[$((NB_ARCHIVES - 2))]}
	TAILLE_DERNIERE=$(stat -c%s "$DERNIERE")
	TAILLE_PRECEDENTE=$(stat -c%s "$PRECEDENTE")
	if [ "$TAILLE_DERNIERE" -ge $((TAILLE_PRECEDENTE / 2)) ]; then
		vert "S5 taille — $TAILLE_DERNIERE octets contre $TAILLE_PRECEDENTE pour la précédente"
	else
		alerte "S5 taille — $TAILLE_DERNIERE octets contre $TAILLE_PRECEDENTE pour la précédente : effondrement de plus de moitié, dump tronqué ou disque plein"
	fi
else
	sans "S5 taille — une seule archive, aucune comparaison possible"
fi

# --- S6. Résidu d'écriture (docs/SPEC-backups.md §3.5) ------------------------------------------------

RESIDUS=$(find "$SORTIE" -maxdepth 1 -type f -name ".$PREFIXE_ARCHIVE-*.partiel" 2>/dev/null | wc -l)
if [ "$RESIDUS" -eq 0 ]; then
	vert "S6 résidu — aucun fichier partiel dans $SORTIE"
else
	alerte "S6 résidu — $RESIDUS fichier(s) « .$PREFIXE_ARCHIVE-*.partiel » : une sauvegarde est morte en cours d'écriture"
fi

# --- S7. Dérive de rétention -------------------------------------------------------------------------
#
# Un jour de marge au-delà de la rétention : `backup.sh` n'applique la sienne qu'APRÈS une écriture
# réussie, si bien qu'une archive tout juste périmée est normale entre deux exécutions.

SEUIL_RETENTION=$((MAINTENANT - (RETENTION + 1) * 86400))
PERIMEES=0
for archive in ${ARCHIVES[@]+"${ARCHIVES[@]}"}; do
	INSTANT=$(instant_du_nom "$archive")
	[ -n "$INSTANT" ] || continue
	[ "$INSTANT" -lt "$SEUIL_RETENTION" ] && PERIMEES=$((PERIMEES + 1))
done
if [ "$PERIMEES" -eq 0 ]; then
	vert "S7 rétention — aucune archive au-delà de $((RETENTION + 1)) jours"
else
	alerte "S7 rétention — $PERIMEES archive(s) au-delà de $((RETENTION + 1)) jours : la rétention ne s'applique plus, le disque se remplit"
fi

# --- S8. Copie hors site, comparée par le NOM (mesure M18) ---------------------------------------------
#
# C'est le contrôle que la mesure a sauvé d'être complaisant : une copie faite par `cp` reçoit un
# `mtime` frais, si bien qu'une comparaison par date déclarerait « à jour » une copie vieille d'un
# mois qu'on vient de recopier.

if [ -n "$HORS_SITE" ]; then
	readarray -t ARCHIVES_HS < <(lister_archives "$HORS_SITE")
	NB_HS=${#ARCHIVES_HS[@]}
	if [ "$NB_HS" -eq 0 ]; then
		alerte "S8 hors site — aucune archive dans $HORS_SITE : la copie hors site ne fonctionne pas"
	elif [ -z "$DERNIERE" ]; then
		sans "S8 hors site — aucune archive locale à comparer"
	else
		DERNIERE_HS=${ARCHIVES_HS[$((NB_HS - 1))]}
		if [ "$(basename "$DERNIERE_HS")" = "$(basename "$DERNIERE")" ]; then
			vert "S8 hors site — « $(basename "$DERNIERE_HS") » est la même archive que la locale la plus récente"
		else
			alerte "S8 hors site — la copie la plus récente est « $(basename "$DERNIERE_HS") », or la locale est « $(basename "$DERNIERE") » : la copie hors site est en retard"
		fi
	fi
else
	sans "S8 hors site — BACKUP_OFFSITE_DIR non renseignée, contrôle non applicable"
fi

# --- S9. Exercice de restauration ------------------------------------------------------------------
#
# L'hôte de sauvegarde ne peut pas exécuter l'exercice : il ne détient aucune clé privée (§3.4), et
# l'intégrité n'est pas observable sans elle (mesure M19). Il peut en revanche surveiller qu'il a
# lieu — une sauvegarde jamais restaurée n'est pas une sauvegarde.

if [ -n "$EMPREINTE_EPOCH" ]; then
	AGE_EXERCICE=$(( (MAINTENANT - EMPREINTE_EPOCH) / 86400 ))
	if [ "$AGE_EXERCICE" -le "$DRILL_MAX_AGE_DAYS" ]; then
		vert "S9 exercice — dernier exercice réussi il y a ${AGE_EXERCICE} j (seuil ${DRILL_MAX_AGE_DAYS} j)"
	else
		alerte "S9 exercice — dernier exercice réussi il y a ${AGE_EXERCICE} j, au-delà du seuil de ${DRILL_MAX_AGE_DAYS} j : la restaurabilité n'est plus prouvée"
	fi
else
	sans "S9 exercice — BACKUP_DRILL_STAMP_FILE non renseignée, contrôle non applicable"
fi

# --- Rapport -----------------------------------------------------------------------------------------
#
# En mode `--cron`, un rapport vert quotidien apprendrait à l'exploitant à ignorer les courriels de
# la sauvegarde, ce qui supprime l'alerte plus sûrement que de ne pas l'écrire.

if [ "$MODE_CRON" = true ]; then
	if [ "$ALERTES" -gt 0 ]; then
		printf 'Supervision des sauvegardes : %s alerte(s) sur %s\n' "$ALERTES" "$SORTIE"
		printf '%s' "$LIGNES" | grep 'ALERTE'
	fi
else
	say "Supervision des sauvegardes — $SORTIE"
	printf '%s' "$LIGNES"
	if [ "$ALERTES" -eq 0 ]; then
		info "verdict     aucune alerte"
	else
		info "verdict     $ALERTES alerte(s) — voir docs/RUNBOOK-sauvegardes.md §5"
	fi
fi

[ "$ALERTES" -eq 0 ] || exit 1
exit 0

#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — accès du poste à la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §5.1 ; docs/PROD_MIGRATIONS.md §2.4
# @spec docs/JOURNAL.md décision 603 — la cellule est jointe par ses adresses IP, jamais par un alias
#
# Bibliothèque partagée par `scripts/spark/livrer.sh` et `scripts/spark/verifier.sh`. Elle n'exécute
# rien à l'inclusion ; `env.sh` doit être inclus avant elle (`die`).
#
# Variables lues :
#   SPARK_SSH_HOTE         IP de la cellule — OBLIGATOIRE, un nom d'hôte est refusé
#   SPARK_SSH_REBOND       `utilisateur@IP` du rebond, passé à `ssh -J` — facultatif, IP exigée
#   SPARK_SSH_UTILISATEUR  compte qui porte la pile, défaut `spark-docker`
#
# Les deux adresses viennent de la ligne `ssh -J` du §1 du dossier de cellule, non versionné : aucune
# n'entre au dépôt, et aucune n'a de valeur par défaut.

# Vrai pour une adresse IPv4 à quatre octets ou une adresse IPv6 littérale ; faux pour tout nom.
spark_est_ip() {
	local v=$1 octet
	if [[ $v =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
		for octet in "${BASH_REMATCH[@]:1}"; do [ "$octet" -le 255 ] || return 1; done
		return 0
	fi
	[[ $v == *:* && $v =~ ^[0-9A-Fa-f:.]+$ ]]
}

# Pose SPARK_SSH_CIBLE et le tableau SPARK_SSH_OPTIONS, ou refuse en nommant la variable fautive.
spark_ssh_preparer() {
	SPARK_SSH_UTILISATEUR="${SPARK_SSH_UTILISATEUR:-spark-docker}"
	[ -n "${SPARK_SSH_HOTE:-}" ] || die "SPARK_SSH_HOTE absente : l'IP de la cellule est obligatoire.
        La lire dans la ligne « ssh -J » du §1 du dossier de cellule (docs/PROD-SERVER.md) ;
        jamais un alias (docs/SPEC-deploiement-spark.md §5.1)."
	spark_est_ip "$SPARK_SSH_HOTE" || die "SPARK_SSH_HOTE « $SPARK_SSH_HOTE » n'est pas une adresse IP.
        La cellule est jointe par son IP, jamais par un alias (décision 603)."
	SPARK_SSH_OPTIONS=(-o BatchMode=yes)
	if [ -n "${SPARK_SSH_REBOND:-}" ]; then
		spark_est_ip "${SPARK_SSH_REBOND##*@}" || die "SPARK_SSH_REBOND « $SPARK_SSH_REBOND » : utilisateur@IP attendu.
        Le rebond est joint par son IP, jamais par un alias (décision 603)."
		SPARK_SSH_OPTIONS+=(-J "$SPARK_SSH_REBOND")
	fi
	SPARK_SSH_CIBLE="$SPARK_SSH_UTILISATEUR@$SPARK_SSH_HOTE"
}

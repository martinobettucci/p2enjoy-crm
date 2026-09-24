#!/usr/bin/env bash
# @spec docs/BACKLOG.md « Correctifs arbitrés », INC-248 ; docs/SPEC-seed.md §13.2 bis ;
#       docs/JOURNAL.md décisions 592 et 595 — le jour courant est le jour LOCAL
# @spec CRM-061 (docs/BACKLOG.md) — « Ma journée » range par jour local (docs/SPEC-cards.md §17.5)
#
# Bibliothèque partagée par `supabase/seed/apply-seed.sh` et `scripts/verify-ma-journee.sh`. Elle
# n'exécute rien à l'inclusion : elle ne définit que des fonctions.
#
# Le seed s'exécute sur l'hôte, là où tournent le navigateur des preuves et celui du développeur ;
# c'est donc le fuseau de l'hôte qui dit quel jour est « aujourd'hui » — sauf si `TZ` est posée, ce
# qui permet de rejouer le seed et ses preuves sous un fuseau choisi (INC-248).

# Rend le nom IANA du fuseau local : `TZ` si elle est posée, sinon le lien `/etc/localtime`, sinon
# `/etc/timezone`, sinon `UTC`.
fuseau_local() {
	if [ -n "${TZ:-}" ]; then printf '%s' "${TZ#:}"; return; fi
	local lien
	lien=$(readlink /etc/localtime 2>/dev/null || true)
	case "$lien" in
		*zoneinfo/*) printf '%s' "${lien##*zoneinfo/}"; return ;;
	esac
	if [ -r /etc/timezone ]; then head -n 1 /etc/timezone; return; fi
	printf 'UTC'
}

# Vrai si le nom peut être écrit dans une requête SQL sans échappement : lettres, chiffres, `/`,
# `_`, `+` et `-`, comme tout nom IANA. PostgreSQL reste juge de son existence.
fuseau_forme_sure() {
	case "$1" in
		''|*[!A-Za-z0-9/_+-]*) return 1 ;;
	esac
	return 0
}

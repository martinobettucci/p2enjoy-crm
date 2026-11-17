// @spec CRM-151 (docs/BACKLOG.md) — tranche T2 : « Ne plus demander pendant 1 heure » — la confirmation des deux commandes de
//       suppression suspendue dans l'onglet, par sa seule échéance
// @spec docs/SPEC-mail-subsystem.md §29.11 (une clé `sessionStorage`, l'échéance en instant ISO ; une échéance passée, une
//       valeur illisible ou un stockage indisponible valent « confirmation demandée ») ; CLAUDE.md §11 (préférence
//       d'interface limitée à la session, catégorie 2) ; docs/JOURNAL.md décisions 928 et 934
//
// Module pur : le stockage et l'horloge sont passés en argument. Toute anomalie rend le DÉFAUT SÛR — demander.

/** La seule clé : sa valeur est l'échéance, un instant ISO. */
export const CLE_SUPPRESSION_SANS_CONFIRMATION = 'p2enjoy.inbox.suppression.sans-confirmation'

/** Une heure (décision 928). */
export const DUREE_SANS_CONFIRMATION_MS = 60 * 60 * 1000

/** Le stockage de l'onglet, ou `null` s'il est indisponible (navigation privée stricte, accès refusé). */
export function stockageDeLOnglet(): Storage | null {
	try {
		return typeof window === 'undefined' ? null : window.sessionStorage
	} catch {
		return null
	}
}

/**
 * L'échéance en vigueur, ou `null` si la confirmation est demandée : aucune valeur, une valeur illisible, une échéance
 * passée, ou un stockage qui lève. Une échéance passée est retirée au passage.
 */
export function lireEcheance(stockage: Storage | null, maintenant: Date): Date | null {
	if (stockage === null) return null
	try {
		const valeur = stockage.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)
		if (valeur === null) return null
		const echeance = new Date(valeur)
		if (Number.isNaN(echeance.getTime()) || echeance.getTime() <= maintenant.getTime()) {
			stockage.removeItem(CLE_SUPPRESSION_SANS_CONFIRMATION)
			return null
		}
		// Une échéance au-delà d'une heure ne vient pas de ce module : elle n'est pas crue.
		if (echeance.getTime() - maintenant.getTime() > DUREE_SANS_CONFIRMATION_MS) return null
		return echeance
	} catch {
		return null
	}
}

/** Suspend la confirmation pendant une heure ; rend l'échéance posée, ou `null` si le stockage a refusé. */
export function suspendreConfirmation(stockage: Storage | null, maintenant: Date): Date | null {
	if (stockage === null) return null
	const echeance = new Date(maintenant.getTime() + DUREE_SANS_CONFIRMATION_MS)
	try {
		stockage.setItem(CLE_SUPPRESSION_SANS_CONFIRMATION, echeance.toISOString())
		return echeance
	} catch {
		return null
	}
}

/** « Redemander » : la confirmation revient tout de suite. */
export function redemanderConfirmation(stockage: Storage | null): void {
	try {
		stockage?.removeItem(CLE_SUPPRESSION_SANS_CONFIRMATION)
	} catch {
		// Un stockage qui lève n'a rien gardé : la confirmation est déjà demandée.
	}
}

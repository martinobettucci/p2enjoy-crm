// @spec CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche d'affaire
// @spec docs/SPEC-cards.md §15.3 (ce que l'en-tête lit, et en combien de requêtes),
//       §15.4 (les six données et comment chacune se rend), §3.5 (l'adresse complète est une
//       dérivation, jamais une colonne), §2.1 (les colonnes et leurs types)
// @spec docs/DESIGN_SYSTEM.md §5.3 bis (les règles visuelles), §2 (données techniques)
//
// Ce module ne rend rien : il **compose**, comme `formulaire.ts` compose le formulaire. La
// séparation est ce qui rend l'adresse et le montant vérifiables sans navigateur — trois cas de
// composition d'adresse, quatre de montant — là où un composant ne les exercerait qu'à travers un
// rendu.

import type { CardOuverte } from './formulaire'

/**
 * L'adresse complète de l'affaire, ou `null` lorsqu'elle n'est pas composable.
 *
 * `email_local_part || '@' || workspaces.inbound_domain` est une **dérivation** (docs/SPEC-cards.md
 * §3.5) : elle n'est pas stockée, `inbound_domain` pouvant changer.
 *
 * SANS DOMAINE, AUCUNE ADRESSE — et surtout pas la partie locale seule. Une adresse amputée de son
 * domaine ne serait pas une adresse incomplète, elle serait **fausse** : la copier enverrait un
 * message nulle part. C'est la « valeur par défaut trompeuse » que `CLAUDE.md` §18 proscrit.
 */
export function composerAdresseCard(card: CardOuverte): string | null {
	const domaine = card.workspaces?.inbound_domain ?? null
	if (domaine === null || domaine.trim() === '') return null
	if (card.email_local_part.trim() === '') return null
	return `${card.email_local_part}@${domaine}`
}

/**
 * Le montant et son code devise, **séparés**, ou `null` lorsqu'il n'y a pas de montant.
 *
 * DEUX MEMBRES ET NON UNE CHAÎNE : le code devise occupe son propre élément à l'écran, jamais un
 * nœud de texte accolé au nombre — c'est le défaut « Discussion1 » mesuré au §5.11 du design
 * system, où `gap` ne sépare pas un nœud anonyme.
 *
 * `Intl.NumberFormat` est employé SANS `style: 'currency'`. La base ne contraint que la **forme**
 * du code devise, jamais sa liste réelle (docs/SPEC-cards.md §2.1) : `currency: 'XYZ'` lèverait
 * `RangeError` sur un code que le navigateur ne connaît pas, et l'écran entier tomberait pour une
 * devise saisie. Le format numérique à deux décimales ne dépend d'aucune liste.
 *
 * Zéro est un montant. Seule l'absence de valeur — `null` — fait disparaître la ligne (§15.4).
 */
export function formaterMontant(
	card: Pick<CardOuverte, 'amount' | 'currency'>,
	locale = 'fr-FR',
): { readonly montant: string; readonly devise: string } | null {
	if (card.amount === null) return null
	const montant = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(card.amount)
	return { montant, devise: card.currency }
}

/**
 * L'échéance de la prochaine action, en date courte, ou `null`.
 *
 * MÊME FORMAT COURT que la dernière relève du §5.14 du design system : deux dates du même produit
 * ne se lisent pas dans deux formats. Une valeur que `Date` ne sait pas lire rend `null` plutôt
 * qu'un « Invalid Date » à l'écran — le type généré ne garantit aucune valeur
 * (`docs/SPEC-types.md`).
 */
export function formaterEcheance(valeur: string | null, locale = 'fr-FR'): string | null {
	if (valeur === null) return null
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return null
	return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}

/** Une affaire archivée porte la pilule « Archivé » à côté de son titre (§15.4). */
export function estArchivee(card: Pick<CardOuverte, 'archived_at'>): boolean {
	return card.archived_at !== null
}

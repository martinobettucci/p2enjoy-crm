// @spec CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 f : LE GROUPEMENT des
//       messages en fils dans l'inbox
// @spec docs/SPEC-cards.md §16.16.1 (les douze mesures), §16.16.3 (`grouperEnFils`, et pourquoi
//       l'ordre ne se recalcule pas), §16.16.4 (ce que la sélection désigne), §16.16.5 (le sommeil
//       transposé au fil), §16.16.6 (les compteurs ne changent pas), §16.16.9 (ce qui n'est pas
//       livré)
// @spec docs/SPEC-cards.md §16.15.2 (`cleFil`), §16.15.3 (le couple est la clé), §16.15.5 (le
//       filtre est une composition)
// @spec docs/DESIGN_SYSTEM.md §5.4 bis (de quoi le fil a l'air)
//
// Ce module ne rend rien : il **regroupe**. La séparation est ce qui rend l'ordre des fils, le
// compte d'une page et le filtre transposé vérifiables **sans navigateur**.
//
// AUCUN DROIT N'EST APPLIQUÉ ICI, et il n'y en a aucun à appliquer : le groupement réunit ce que la
// RLS a déjà rapporté (mesure 2). Deux profils qui voient deux sous-ensembles d'un même fil en
// voient chacun le compte de ce qu'ils lisent — ce qui est exact, et non une fuite.

import { cleCorrespondance, echeanceFil, type FilsEndormis, type ModeFils } from './sommeil-fil'

/** Ce qu'un message doit porter pour être groupé. Sous-ensemble exact de `MessageListe`. */
export type MessageGroupable = {
	readonly id: string
	readonly workspaceId: string
	readonly cleFil: string
}

/**
 * Un fil, tel que la liste l'énumère désormais (§16.16.3).
 *
 * `nombre` COMPTE CE QUE LA PAGE PORTE, PAS CE QUE LA BASE CONTIENT. La borne de cinquante messages
 * s'applique **avant** le groupement, comme elle s'applique avant le filtre (§16.15.5 point 1) : un
 * fil de soixante messages en montrerait cinquante. La mention « la liste est tronquée » reste donc
 * fondée sur le nombre de lignes que le SERVEUR a rapportées, jamais sur le nombre de fils affichés
 * — la corriger d'après l'affichage ferait disparaître un avertissement vrai.
 */
export type FilListe<T extends MessageGroupable = MessageGroupable> = {
	/** La clé de correspondance `(workspace, clé de fil)` — jamais la seule chaîne (§16.15.3). */
	readonly cle: string
	readonly workspaceId: string
	readonly cleFil: string
	/** Le message le plus récent du fil DANS CETTE PAGE : celui que la ligne affiche. */
	readonly dernier: T
	/** Les messages du fil dans cette page, dans l'ordre où la page les a rendus. */
	readonly messages: readonly T[]
	readonly nombre: number
}

/**
 * Regroupe une page de messages en fils, **sans jamais retrier**.
 *
 * LA MESURE 10 FONDE CETTE FONCTION. La page arrive déjà triée par `received_at` décroissant puis
 * `id` décroissant (§16.15.3) : la **première occurrence** d'une clé est donc son message le plus
 * récent, et l'ordre d'apparition des clés est l'ordre des fils par récence. `dernier` est le
 * premier message rencontré, jamais le résultat d'une comparaison de dates — comparer ici
 * exposerait une seconde définition du même ordre, que le premier ajustement du tri ferait diverger.
 *
 * LE COUPLE EST LA CLÉ, JAMAIS LA SEULE CHAÎNE : deux workspaces peuvent porter le même
 * `Message-ID` (mesure 5 du §16.14.1), et les confondre fusionnerait deux fils étrangers.
 */
export function grouperEnFils<T extends MessageGroupable>(
	messages: readonly T[],
): readonly FilListe<T>[] {
	// UNE `Map` PLUTÔT QU'UN OBJET, et ce n'est pas un détail : une clé de fil est un `Message-ID`
	// arbitraire, donc `__proto__` en est une valeur possible. Sur un objet nu, elle n'écrirait pas
	// une entrée mais le prototype.
	const parCle = new Map<string, { readonly fil: FilListe<T>; readonly membres: T[] }>()
	const ordre: string[] = []

	for (const message of messages) {
		const cle = cleCorrespondance(message.workspaceId, message.cleFil)
		const connu = parCle.get(cle)
		if (connu !== undefined) {
			connu.membres.push(message)
			continue
		}
		const membres: T[] = [message]
		parCle.set(cle, {
			fil: {
				cle,
				workspaceId: message.workspaceId,
				cleFil: message.cleFil,
				dernier: message,
				messages: membres,
				nombre: 0,
			},
			membres,
		})
		ordre.push(cle)
	}

	// `nombre` EST FIGÉ APRÈS LE PARCOURS, et non tenu à jour pendant : un compte incrémenté dans la
	// boucle vivrait dans un objet que le type déclare `readonly`, et le mensonge du type serait
	// pire que la seconde passe — qui est linéaire et porte sur le nombre de FILS, pas de messages.
	return ordre.map((cle) => {
		const entree = parCle.get(cle)
		// Une clé de `ordre` vient d'être posée par la boucle ci-dessus : elle existe toujours. Le
		// repli n'est pas un cas métier, il satisfait le typage sans inventer de comportement.
		if (entree === undefined) throw new Error(`fil absent de l'index : ${cle}`)
		return { ...entree.fil, messages: entree.membres, nombre: entree.membres.length }
	})
}

/**
 * Ce que la liste affiche, et combien de FILS elle masque (§16.16.5).
 *
 * LA RÈGLE N'EST PAS NOUVELLE, SEUL SON PORTEUR CHANGE : le filtre du §16.15.5 masquait des
 * messages, il masque désormais des fils. Un fil est masqué lorsque son échéance est future ET
 * qu'aucun de ses messages n'est le message ouvert.
 *
 * LE FIL DU MESSAGE OUVERT N'EST JAMAIS MASQUÉ, et c'est la règle corrigée par sa propre preuve le
 * 2026-08-19 (§16.15.5) : endormir le fil de ce qu'on lit ne fait rien disparaître sous le doigt de
 * celui qui vient d'appuyer. Le prédicat porte maintenant sur `fil.messages`, qui contient le
 * message ouvert — donc le fil reste, marqué de sa pastille, et ne quitte la liste qu'au geste
 * suivant.
 *
 * `masques` compte des FILS. L'état vide du §16.15.5 point 2 garde son libellé — « Tous les messages
 * de ce dossier sont dans des fils en sommeil » —, qui reste vrai : un fil masqué emporte tous ses
 * messages.
 */
export function composerFils<T extends MessageGroupable>(
	fils: readonly FilListe<T>[],
	endormis: FilsEndormis,
	mode: ModeFils,
	maintenant: Date,
	idOuvert: string | null = null,
): { readonly visibles: readonly FilListe<T>[]; readonly masques: number } {
	if (mode === 'visibles') return { visibles: fils, masques: 0 }
	const visibles = fils.filter(
		(fil) =>
			fil.messages.some((message) => message.id === idOuvert) ||
			echeanceFil(endormis, fil.workspaceId, fil.cleFil, maintenant) === null,
	)
	return { visibles, masques: fils.length - visibles.length }
}

/**
 * Le fil auquel appartient le message ouvert, ou `null`.
 *
 * IL SERT AU REPÈRE DE SÉLECTION, ET LA RÈGLE EST CELLE DU §16.16.4 : la ligne porte
 * `aria-current` quand le message ouvert APPARTIENT au fil, et non seulement quand il en est le
 * dernier. Sans cela, choisir un autre message du fil dans le sélecteur effacerait le repère de la
 * liste, et le §5.4 refuse déjà qu'une sélection n'existe qu'en couleur.
 */
export function filDuMessage<T extends MessageGroupable>(
	fils: readonly FilListe<T>[],
	idOuvert: string | null,
): FilListe<T> | null {
	if (idOuvert === null) return null
	return fils.find((fil) => fil.messages.some((message) => message.id === idOuvert)) ?? null
}

// @spec CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranches 2 b et 2 d
// @spec docs/SPEC-cards.md §16.12.4 (la bascule vit dans l'adresse), §16.12.7 (une affaire endormie
//       rendue visible est MARQUÉE), §16.11.2 (la pastille porte l'échéance en date courte),
//       §16.11.4 (dictionnaire fermé des issues), §16.13.4 (les mêmes mentions qu'à la fiche)
// @spec docs/DESIGN_SYSTEM.md §5.3 quinquies (de quoi la bascule et la pastille compacte ont l'air),
//       §5.3 quater (les jetons et l'icône dont elles héritent), §8 (cible de 40 px, nom accessible)
//
// Ces deux éléments sont rendus par le board ET par la vue liste. Ils vivent donc ici plutôt que
// dupliqués dans les deux écrans : la pastille est « la même information, elle doit se reconnaître
// d'une vue à l'autre » (§5.3 quinquies), et deux copies divergeraient au premier ajustement.
//
// Aucune règle n'est portée ici : le prédicat du sommeil vit dans `webapp/src/lib/sommeil-card.ts`,
// le filtre dans `webapp/src/lib/filtre-sommeil.ts`. Ce module **rend**.

import { Moon } from 'lucide-react'
import { useId } from 'react'
import { t, type CleTraduction } from '../../i18n'
import type { ModeSommeil } from '../../lib/filtre-sommeil'
import {
	formaterEcheanceSommeil,
	type CleEcheanceUsuelle,
	type IssueSommeil,
} from '../../lib/sommeil-card'

/**
 * Les libellés des quatre échéances usuelles, NOMMÉS et non composés par interpolation.
 *
 * Une clé construite en `` `card.sleep.preset.${cle}` `` ne se retrouverait pas par le contrôle de
 * clés mortes du dictionnaire, qui cherche le littéral : les quatre passeraient pour mortes, et une
 * clé réellement morte s'y cacherait sans être vue.
 *
 * REMONTÉES ICI PAR LA TRANCHE 2 d (docs/SPEC-cards.md §16.13.4), où elles étaient privées de
 * `EnTeteCard.tsx` : la fiche et la carte du board offrent le même geste, et « un même refus ne se
 * formule pas de deux façons selon l'écran d'où il a été demandé ». Deux copies divergeraient au
 * premier ajustement de libellé.
 */
export const CLE_PRESET_SOMMEIL: Readonly<Record<CleEcheanceUsuelle, CleTraduction>> = {
	demain: 'card.sleep.preset.demain',
	troisjours: 'card.sleep.preset.troisjours',
	semaine: 'card.sleep.preset.semaine',
	mois: 'card.sleep.preset.mois',
}

/** Les six issues du §16.11.4 que l'écran met en mots ; les deux succès n'en ont pas besoin. */
export const MENTION_SOMMEIL: Readonly<
	Record<Exclude<IssueSommeil, 'endormie' | 'reveillee'>, CleTraduction>
> = {
	'echeance-requise': 'card.sleep.refus.required',
	'echeance-passee': 'card.sleep.refus.past',
	introuvable: 'card.sleep.refus.notfound',
	refus: 'card.sleep.refus.forbidden',
	reseau: 'card.sleep.refus.network',
	inconnu: 'card.sleep.refus.unknown',
}

/** La mention d'une issue, ou `null` lorsque le geste a abouti et n'a rien à dire. */
export function mentionSommeil(issue: IssueSommeil | null): CleTraduction | null {
	if (issue === null || issue === 'endormie' || issue === 'reveillee') return null
	return MENTION_SOMMEIL[issue]
}

/**
 * La pastille **compacte** d'une affaire endormie rendue visible par la bascule (§16.12.7).
 *
 * ELLE NE PORTE PAS LE MOT « EN SOMMEIL », et ce n'est pas un oubli : sur une carte de board et
 * dans une ligne de tableau, la place n'admet pas « En sommeil jusqu'au 26/08/2026 » (§5.3
 * quinquies). L'icône et la date suffisent à l'œil ; la phrase entière devient le **nom
 * accessible**, porté par `role="img"` — un `span` nu n'accepte aucun nom, et l'attribut y serait
 * ignoré par les lecteurs d'écran.
 *
 * `enSommeil` est décidé par l'APPELANT, avec l'instant qui a servi au filtre de sa vue (§16.12.3) :
 * cette pastille ne rejuge pas le prédicat, sans quoi un second `new Date()` pourrait la faire
 * disparaître d'une carte que le filtre a pourtant rendue.
 *
 * Une échéance que `Date` ne sait pas lire fait disparaître la pastille plutôt que d'écrire
 * « Invalid Date » — même règle qu'au §16.11.2, et une telle affaire n'est de toute façon pas en
 * sommeil au sens du prédicat.
 */
export function PastilleSommeil({
	enSommeil,
	echeance,
}: {
	readonly enSommeil: boolean
	readonly echeance: string | null
}) {
	if (!enSommeil) return null
	const courte = formaterEcheanceSommeil(echeance)
	if (courte === null) return null

	return (
		<span
			role="img"
			data-testid="pastille-sommeil"
			aria-label={t('card.sleep.badge', { echeance: courte })}
			// MÊMES JETONS QU'AU §5.3 quater — `--color-brand-soft` et `--color-brand`,
			// `rounded-full` —, en `text-xs` : c'est la même information dans une place plus étroite.
			// `shrink-0` : dans une ligne de tableau, le titre garde son ellipse et la pastille sa
			// largeur, sans quoi la ligne passerait sur deux lignes et contredirait la densité du §5.9.
			className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand"
		>
			<Moon aria-hidden="true" className="size-3" />
			{/* La date est déjà dans le nom accessible : la répéter au lecteur d'écran la ferait
			    entendre deux fois. */}
			<span aria-hidden="true">{courte}</span>
		</span>
	)
}

/**
 * La bascule « Afficher les affaires en sommeil » (§16.12.4, §5.3 quinquies).
 *
 * C'EST UNE CASE À COCHER ÉTIQUETÉE, PAS UN BOUTON À DEUX ÉTATS. Un bouton unique laisse toujours
 * l'ambiguïté entre « ce que je fais » et « ce qui est » — « Afficher les affaires en sommeil »
 * peut se lire comme l'état courant autant que comme le geste. Une case cochée n'a pas ce défaut :
 * son état est lu par le navigateur et annoncé comme tel.
 *
 * La cible fait au moins 40 px (§8) : c'est le `label` entier qui la porte, pas la seule case, de
 * sorte que le texte soit cliquable.
 *
 * LE LIBELLÉ EST UN PARAMÈTRE DEPUIS LA TRANCHE 2 e (docs/SPEC-cards.md §16.15.5), et sa valeur par
 * défaut reste celle des affaires : l'inbox masque des **fils**, non des affaires, et « Afficher les
 * affaires en sommeil » y désignerait un objet que cet écran ne montre pas. La forme, elle, est la
 * même — case à cocher étiquetée, icône `Moon`, cible de 40 px —, et c'est ce qui doit être partagé.
 */
export function BasculeSommeil({
	mode,
	onMode,
	libelle,
}: {
	readonly mode: ModeSommeil
	readonly onMode: (mode: ModeSommeil) => void
	readonly libelle?: string
}) {
	const id = useId()

	return (
		<label
			htmlFor={id}
			data-testid="bascule-sommeil"
			className="inline-flex min-h-[var(--size-target)] cursor-pointer items-center gap-2 text-sm text-text-2"
		>
			<input
				id={id}
				type="checkbox"
				data-testid="bascule-sommeil-case"
				checked={mode === 'visibles'}
				// Toute bascule ramène la liste à sa première page : la page 3 d'une vue qui montre
				// les affaires endormies n'a aucun rapport avec la page 3 de celle qui les masque.
				// C'est l'appelant qui le fait — lui seul sait s'il pagine (§16.12.3).
				onChange={(evenement) => onMode(evenement.target.checked ? 'visibles' : 'masquees')}
				className="size-4 accent-brand"
			/>
			<Moon aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
			{libelle ?? t('sommeil.afficher')}
		</label>
	)
}

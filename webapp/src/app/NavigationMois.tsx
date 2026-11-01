// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : le mois du rapport mensuel et de la série « Personnel » du track
// @spec docs/INCONSISTENCY_REPORT.md INC-333, décision 801 (docs/JOURNAL.md) — le mois se choisit par « Mois
//       précédent » / « Mois suivant » / « Ce mois-ci », jamais par un `input type="month"`, que Firefox rend en champ
//       texte ; docs/SPEC-temps.md §7.3 (`?mois=AAAA-MM`, le mois du jour par défaut), §7.5 (le mois du bloc du track
//       dans l'adresse) ; docs/DESIGN_SYSTEM.md §5.54 (navigation de mois), §5.13 (le focus ne reste jamais sur un
//       élément qui disparaît) ; docs/manual.md §28.4
//
// Le patron est celui de la semaine de la matrice (SaisieTemps) : deux boutons bordés, le libellé entre eux, et le
// retour au mois du jour en lien d'action, rendu hors de ce mois.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { useSearchParams } from 'react-router'
import { t } from '../i18n'

/** Le paramètre d'adresse du mois, `AAAA-MM`. Absent ou invalide, c'est le mois du jour, qui n'y est jamais écrit. */
export const CLE_URL_MOIS = 'mois' as const

export function lireMois(valeur: string | null, aujourdhui: string): string {
	return valeur !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(valeur) ? valeur : aujourdhui.slice(0, 7)
}

/** Le mois `AAAA-MM` décalé de `n` mois, en passant les années. */
export function decalerMois(mois: string, n: number): string {
	const rang = Number(mois.slice(0, 4)) * 12 + Number(mois.slice(5, 7)) - 1 + n
	return `${String(Math.floor(rang / 12)).padStart(4, '0')}-${String((rang % 12) + 1).padStart(2, '0')}`
}

const FORMAT_MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const libelleMois = (mois: string) => FORMAT_MOIS.format(new Date(`${mois}-01T00:00:00Z`))

/** Le libellé du mois en titre : « Mars 2027 », la majuscule que le format ne pose pas. */
export function titreMois(mois: string): string {
	const libelle = libelleMois(mois)
	return libelle.charAt(0).toLocaleUpperCase('fr-FR') + libelle.slice(1)
}

/** Le mois que l'adresse porte, et le geste qui l'y écrit en gardant les autres paramètres. */
export function useMoisDeLAdresse(aujourdhui: string) {
	const [parametres, setParametres] = useSearchParams()
	const moisCourant = aujourdhui.slice(0, 7)
	const mois = lireMois(parametres.get(CLE_URL_MOIS), aujourdhui)
	const allerA = (nouveau: string) => {
		const suivants = new URLSearchParams(parametres)
		if (nouveau === moisCourant) suivants.delete(CLE_URL_MOIS)
		else suivants.set(CLE_URL_MOIS, nouveau)
		setParametres(suivants)
	}
	return { mois, moisCourant, allerA } as const
}

export type ProprietesNavigationMois = {
	readonly mois: string
	readonly moisCourant: string
	readonly allerA: (mois: string) => void
	/** Le mois est le titre `h2` de ce qui suit (le rapport), ou un texte sous un titre qui existe déjà (le track). */
	readonly titre: boolean
	readonly testId: string
}

const CLASSES_BOUTON_MOIS = 'inline-flex min-h-[var(--size-target)] items-center gap-1 rounded-md border border-border px-3 hover:bg-hover'

export function NavigationMois({ mois, moisCourant, allerA, titre, testId }: ProprietesNavigationMois) {
	const libelle = useRef<HTMLElement>(null)
	const Libelle = titre ? 'h2' : 'p'
	return (
		<div className="flex flex-wrap items-center gap-2">
			<button type="button" onClick={() => allerA(decalerMois(mois, -1))} className={CLASSES_BOUTON_MOIS}>
				<ChevronLeft aria-hidden="true" size={16} />
				{t('time.month.previous')}
			</button>
			<Libelle
				ref={(element: HTMLElement | null) => {
					libelle.current = element
				}}
				tabIndex={-1}
				// Largeur du mois le plus long (« Septembre 2026 ») : « Mois suivant » ne bouge pas sous le pointeur d'un mois à l'autre.
				className="min-w-[15ch] text-center text-h3 font-bold leading-tight text-ink"
				data-testid={testId}
			>
				{titreMois(mois)}
			</Libelle>
			<button type="button" onClick={() => allerA(decalerMois(mois, 1))} className={CLASSES_BOUTON_MOIS}>
				{t('time.month.next')}
				<ChevronRight aria-hidden="true" size={16} />
			</button>
			{mois !== moisCourant ? (
				<button
					type="button"
					onClick={() => {
						allerA(moisCourant)
						// La commande disparaît sous le doigt : le focus passe au libellé, qui nomme le mois retrouvé (§5.13).
						libelle.current?.focus()
					}}
					className="inline-flex min-h-[var(--size-target)] items-center rounded-md px-3 text-brand hover:bg-hover"
				>
					{t('time.month.current')}
				</button>
			) : null}
		</div>
	)
}

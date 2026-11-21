// @spec CRM-161 (docs/BACKLOG.md) tranche T2.b — le menu des espaces au premier niveau du fil d'Ariane : le bouton et sa
//       pastille, le panneau, ses lignes et leurs non-lus, le clavier, ce que le choix fait (docs/DESIGN_SYSTEM.md §5.113 ;
//       docs/SPEC-espace-courant.md §9, §15.6)
//
// LE CHOIX NE STOCKE RIEN : il change l'adresse (une page d'un espace) ou la mémoire vive de l'onglet (une page globale),
// et la coquille constate l'espace qu'elle montre (`constaterEspace`), qui annonce la bascule.

import { Check, ChevronsUpDown } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { retenirEspaceDeLOnglet } from '../lib/espace-onglet'
import { adresseApresChoix, autreEspaceANonLus, useNonLusParEspace, type NonLusParEspace } from '../lib/menu-espaces'
import { clientCrm } from '../lib/supabase'
import type { Workspace } from '../lib/workspaces'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_BOUTON = [
	'relative flex items-center gap-1 min-w-0 min-h-[var(--size-target)] rounded-sm',
	'text-sm text-text-2 hover:underline',
].join(' ')

/** Le texte d'une pastille : le compte, « 99+ » au-delà (§5.43). */
const affiche = (nombre: number): string => (nombre > 99 ? '99+' : String(nombre))

/** Le nom accessible d'une ligne : l'espace, et ses non-lus en mots quand il y en a. */
function nomDeLigne(espace: Workspace, nonLus: EtatAsync<NonLusParEspace>): string {
	const nombre = nonLus.statut === 'pret' ? (nonLus.donnees.get(espace.id) ?? 0) : 0
	if (nombre === 0) return espace.name
	if (nombre === 1) return t('espace.menu.ligne.nonLu', { espace: espace.name })
	return t('espace.menu.ligne.nonLus', { espace: espace.name, nombre: String(nombre) })
}

/** Choisir un espace (§9) : la même page quand elle existe, l'inbox depuis un objet, ou l'onglet seul sur une page globale. */
function useChoisirEspace(): (espace: Workspace) => void {
	const naviguer = useNavigate()
	const { pathname, search } = useLocation()
	const { slugEspace } = useContexteEspace()
	return useCallback(
		(espace: Workspace) => {
			if (espace.slug === slugEspace) return
			const cible = adresseApresChoix(pathname, espace.slug)
			retenirEspaceDeLOnglet(espace.slug)
			// Sur une page globale, l'adresse ne change pas : la remplacer par elle-même fait relire l'espace de l'onglet.
			void naviguer(cible ?? { pathname, search }, cible === null ? { replace: true } : undefined)
			document.getElementById('contenu-principal')?.focus()
		},
		[naviguer, pathname, search, slugEspace],
	)
}

/** La ligne d'un espace : la coche du courant, le nom, la pastille de ses non-lus. */
function LigneEspace({
	espace,
	courant,
	nonLus,
	enMenu = false,
	refBouton,
	onClick,
	onKeyDown,
}: {
	readonly espace: Workspace
	readonly courant: boolean
	readonly nonLus: EtatAsync<NonLusParEspace>
	/** Dans le panneau du menu : `menuitemradio`, hors de l'ordre de tabulation ; dans le repli : un bouton ordinaire. */
	readonly enMenu?: boolean
	readonly refBouton?: (noeud: HTMLButtonElement | null) => void
	readonly onClick: () => void
	readonly onKeyDown?: (evenement: KeyboardEvent<HTMLButtonElement>) => void
}) {
	const nombre = nonLus.statut === 'pret' ? (nonLus.donnees.get(espace.id) ?? 0) : 0
	return (
		<button
			ref={refBouton}
			type="button"
			data-testid="ligne-espace-menu"
			data-slug={espace.slug}
			{...(enMenu ? { role: 'menuitemradio', 'aria-checked': courant, tabIndex: -1 } : { 'aria-current': courant ? 'true' : undefined })}
			onClick={onClick}
			{...(onKeyDown === undefined ? {} : { onKeyDown })}
			aria-label={nomDeLigne(espace, nonLus)}
			className={[
				'flex w-full items-center gap-2 min-h-[var(--size-target)] px-3 text-left text-sm text-ink',
				'hover:bg-hover focus-visible:bg-hover',
				courant ? 'font-medium' : '',
			].join(' ')}
		>
			<span aria-hidden="true" className="inline-flex size-4 shrink-0 text-brand">
				{courant ? <Check size={16} /> : null}
			</span>
			<span className="min-w-0 grow break-words">{espace.name}</span>
			{nombre > 0 ? (
				<span
					aria-hidden="true"
					data-testid="non-lus-espace"
					className="shrink-0 rounded-full bg-brand-soft px-2 text-xs text-brand tabular-nums"
				>
					{affiche(nombre)}
				</span>
			) : null}
		</button>
	)
}

/** Le menu, en ligne dans le fil, à partir de `md` (§5.113). */
export function MenuEspaces({ espaces }: { readonly espaces: readonly Workspace[] }) {
	const { idWorkspace } = useContexteEspace()
	const { key } = useLocation()
	const nonLus = useNonLusParEspace(clientCrm, true, key)
	const choisir = useChoisirEspace()
	const [ouvert, setOuvert] = useState(false)
	const idPanneau = useId()
	const bouton = useRef<HTMLButtonElement>(null)
	const ancre = useRef<HTMLDivElement>(null)
	const lignes = useRef<(HTMLButtonElement | null)[]>([])
	const courant = espaces.find((w) => w.id === idWorkspace) ?? espaces[0]
	const rangCourant = Math.max(0, espaces.findIndex((w) => w.id === courant?.id))
	const pastille = autreEspaceANonLus(nonLus, courant?.id ?? null)

	const fermer = useCallback((rendreLeFocus: boolean) => {
		setOuvert(false)
		if (rendreLeFocus) bouton.current?.focus()
	}, [])

	// Le focus entre sur l'espace courant à l'ouverture.
	useEffect(() => {
		if (ouvert) lignes.current[rangCourant]?.focus()
	}, [ouvert, rangCourant])

	// Un clic extérieur referme SANS déplacer le focus (§5.62).
	useEffect(() => {
		if (!ouvert) return
		const surClic = (evenement: MouseEvent) => {
			const cible = evenement.target
			if (cible instanceof Node && ancre.current?.contains(cible) === true) return
			setOuvert(false)
		}
		globalThis.addEventListener('mousedown', surClic)
		return () => globalThis.removeEventListener('mousedown', surClic)
	}, [ouvert])

	const surToucheBouton = (evenement: KeyboardEvent<HTMLButtonElement>) => {
		if (evenement.key === 'ArrowDown') {
			evenement.preventDefault()
			setOuvert(true)
		}
	}

	const surToucheLigne = (rang: number) => (evenement: KeyboardEvent<HTMLButtonElement>) => {
		const dernier = espaces.length - 1
		const aller = (cible: number) => {
			evenement.preventDefault()
			lignes.current[cible]?.focus()
		}
		if (evenement.key === 'ArrowDown') aller(rang === dernier ? 0 : rang + 1)
		else if (evenement.key === 'ArrowUp') aller(rang === 0 ? dernier : rang - 1)
		else if (evenement.key === 'Home') aller(0)
		else if (evenement.key === 'End') aller(dernier)
		else if (evenement.key === 'Escape') {
			evenement.preventDefault()
			fermer(true)
		} else if (evenement.key === 'Tab') setOuvert(false)
	}

	if (courant === undefined) return null
	return (
		// `flex min-w-0` et le nom en `min-w-0 truncate` : dans le fil d'une affaire, le niveau cède sa place comme un ancêtre
		// (§5.62) ; sans eux, le nom gardait sa largeur et le bouton débordait sur le niveau suivant (vu sur l'image du manuel).
		<div ref={ancre} className="flex min-w-0">
			<button
				ref={bouton}
				type="button"
				data-testid="workspace-courant"
				title={courant.name}
				aria-haspopup="menu"
				aria-expanded={ouvert}
				aria-controls={idPanneau}
				aria-label={t(pastille ? 'espace.menu.bouton.nonLus' : 'espace.menu.bouton', { espace: courant.name })}
				onClick={() => setOuvert((precedent) => !precedent)}
				onKeyDown={surToucheBouton}
				className={CLASSES_BOUTON}
			>
				<span className="min-w-0 truncate">{courant.name}</span>
				<span aria-hidden="true" className="relative inline-flex shrink-0">
					<ChevronsUpDown size={14} />
					{pastille ? (
						<span
							data-testid="pastille-autre-espace"
							className="absolute -top-1 -right-1 size-2 rounded-full bg-brand"
						/>
					) : null}
				</span>
			</button>
			{ouvert ? (
				<div
					id={idPanneau}
					role="menu"
					aria-label={t('espace.menu.panneau')}
					data-testid="menu-espaces"
					className={[
						'absolute top-full left-4 z-40 mt-2 py-1 max-w-[min(40ch,calc(100%-2rem))] min-w-[24ch]',
						'bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)]',
					].join(' ')}
				>
					{espaces.map((espace, rang) => (
						<LigneEspace
							key={espace.id}
							espace={espace}
							courant={espace.id === courant.id}
							nonLus={nonLus}
							enMenu
							refBouton={(noeud) => {
								lignes.current[rang] = noeud
							}}
							onKeyDown={surToucheLigne(rang)}
							onClick={() => {
								fermer(false)
								choisir(espace)
							}}
						/>
					))}
				</div>
			) : null}
		</div>
	)
}

/** Sous `md`, dans le repli « … » du fil : une section « Espaces » aux mêmes lignes (§5.113). */
export function SectionEspacesDuRepli({
	espaces,
	onChoisi,
}: {
	readonly espaces: readonly Workspace[]
	readonly onChoisi: () => void
}) {
	const { idWorkspace } = useContexteEspace()
	const { key } = useLocation()
	const nonLus = useNonLusParEspace(clientCrm, true, key)
	const choisir = useChoisirEspace()
	return (
		<section aria-label={t('espace.menu.section')} data-testid="section-espaces-repli">
			<p className="px-3 pt-2 text-xs text-text-3">{t('espace.menu.section')}</p>
			{espaces.map((espace) => (
				<LigneEspace
					key={espace.id}
					espace={espace}
					courant={espace.id === idWorkspace}
					nonLus={nonLus}
					onClick={() => {
						onChoisi()
						choisir(espace)
					}}
				/>
			))}
		</section>
	)
}

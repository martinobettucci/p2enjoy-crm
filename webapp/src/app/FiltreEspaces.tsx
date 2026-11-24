// @spec CRM-161 (docs/BACKLOG.md) — tranche T3.a : le filtre « Espace » des pages globales, son état dans l'adresse, et
//       le vide sous le filtre (docs/SPEC-espace-courant.md §16.2, §16.5) ; tranche T3.b.1 : le bouton et le panneau
//       séparés, pour une page qui a déjà sa barre de filtres (« Rentabilité », §16.5)
// @spec docs/DESIGN_SYSTEM.md §5.115 (le patron du §5.105 sans écart : bouton secondaire et son compte, `aria-expanded`,
//       `aria-controls`, panneau de cases dans le flux, `Échap`, `?espaces=` en `replace` ; « Rien dans les espaces
//       choisis » et « Afficher tous les espaces »), §5.92 (le panneau de cases), §5.8 (états)
//
// LE PREMIER PANNEAU DE CASES PARTAGÉ : « Tracks » et « Catégories » des organisations codent le leur ; celui-ci sert
// toutes les pages globales, qui le reçoivent avec `useFiltreEspaces`. Rien n'est rendu pour une personne d'un seul
// espace : la page reste celle d'avant T3 (§16.1).

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { ecrireEspacesChoisis, lireEspacesChoisis, provenanceVisible } from '../lib/provenance'
import type { Workspace } from '../lib/workspaces'
import { useContexteEspace } from './ContexteEspace'

export type FiltreEspacesDePage = {
	/** Vrai à partir de deux espaces lus : le filtre et la provenance sont rendus (§16.1). */
	readonly visible: boolean
	/** Les espaces lus, dans l'ordre du menu (par nom, §5.113) ; vide hors coquille. */
	readonly espaces: readonly Workspace[]
	/** Les espaces choisis par l'adresse, en identifiants ; vide : tous. */
	readonly choisis: readonly string[]
	readonly choisir: (ids: readonly string[]) => void
	/** Le bouton « Espace », auquel le vide sous le filtre et `Échap` rendent le focus (§5.115). */
	readonly refBouton: RefObject<HTMLButtonElement | null>
	/** Le panneau est déplié ; le bouton et le panneau, posés séparément dans la page, partagent cet état. */
	readonly ouvert: boolean
	readonly ouvrir: (ouvert: boolean) => void
	readonly idPanneau: string
}

/** Le filtre « Espace » d'une page globale : ses espaces, son choix lu dans l'adresse, et son écriture. */
export function useFiltreEspaces(): FiltreEspacesDePage {
	const { espaces } = useContexteEspace()
	const [adresse, setAdresse] = useSearchParams()
	const refBouton = useRef<HTMLButtonElement | null>(null)
	const idPanneau = useId()
	const [ouvert, ouvrir] = useState(false)
	const visible = provenanceVisible(espaces)
	const lus = useMemo(() => espaces ?? [], [espaces])
	// Pour une personne d'un seul espace, l'adresse ne filtre rien : il n'y a ni case pour le dire, ni rien à défaire.
	const choisis = useMemo(() => (visible ? lireEspacesChoisis(adresse, lus) : []), [adresse, lus, visible])
	const choisir = useCallback(
		(ids: readonly string[]) => {
			// SANS ENTRÉE D'HISTORIQUE (§5.115), comme les filtres des organisations : le retour arrière quitte la page.
			setAdresse((precedente) => ecrireEspacesChoisis(ids, lus, precedente), { replace: true })
		},
		[lus, setAdresse],
	)
	return { visible, espaces: lus, choisis, choisir, refBouton, ouvert, ouvrir, idPanneau }
}

/** `Échap`, depuis le bouton ou le panneau : replie, et rend le focus au bouton (§5.115). */
function useReplierParEchap(filtre: FiltreEspacesDePage): (evenement: KeyboardEvent<HTMLElement>) => void {
	return (evenement) => {
		if (evenement.key !== 'Escape' || !filtre.ouvert) return
		evenement.stopPropagation()
		filtre.ouvrir(false)
		filtre.refBouton.current?.focus()
	}
}

/**
 * Le bouton « Espace », pour une page qui a déjà sa barre de filtres (§5.115) : il s'y pose, et le panneau se pose sous la
 * barre (`PanneauFiltreEspaces`). Rien pour une personne d'un seul espace.
 */
export function BoutonFiltreEspaces({ filtre }: { readonly filtre: FiltreEspacesDePage }) {
	const surTouche = useReplierParEchap(filtre)
	if (!filtre.visible) return null
	const nombre = filtre.choisis.length
	return (
		<Button
			ref={filtre.refBouton}
			data-testid="ouvrir-filtre-espaces"
			aria-expanded={filtre.ouvert}
			aria-controls={filtre.idPanneau}
			onClick={() => filtre.ouvrir(!filtre.ouvert)}
			onKeyDown={surTouche}
		>
			{nombre === 0 ? t('spaces.filter.button') : t('spaces.filter.button.count', { nombre: String(nombre) })}
		</Button>
	)
}

/** Le panneau de cases du filtre, dans le flux, sous la barre (§5.115, §5.92). Rien tant qu'il est replié. */
export function PanneauFiltreEspaces({ filtre }: { readonly filtre: FiltreEspacesDePage }) {
	const surTouche = useReplierParEchap(filtre)
	// LES CASES PORTENT UN ÉTAT LOCAL, qui suit l'adresse — la leçon des organisations (§5.105, trouvée par leur preuve
	// E2E) : le routeur applique un changement d'adresse dans une transition, et une case tenue par l'adresse seule se
	// décochait sous la souris le temps qu'elle aboutisse.
	const [cochees, setCochees] = useState<readonly string[]>(filtre.choisis)
	const cle = filtre.choisis.join(',')
	useEffect(() => {
		setCochees(cle === '' ? [] : cle.split(','))
	}, [cle])

	if (!filtre.visible || !filtre.ouvert) return null

	const basculer = (id: string, cochee: boolean) => {
		const autres = cochees.filter((autre) => autre !== id)
		// L'ORDRE ÉCRIT EST CELUI DES ESPACES, jamais celui des clics : deux choix égaux font la même adresse.
		const suivantes = filtre.espaces
			.map((espace) => espace.id)
			.filter((idEspace) => (idEspace === id ? cochee : autres.includes(idEspace)))
		setCochees(suivantes)
		filtre.choisir(suivantes)
	}

	return (
		<div
			id={filtre.idPanneau}
			data-testid="panneau-filtre-espaces"
			onKeyDown={surTouche}
			className="rounded-md border border-border bg-surface p-4"
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="text-sm text-text-2 mb-2">{t('spaces.filter.legend')}</legend>
				<div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
					{filtre.espaces.map((espace) => (
						<label key={espace.id} className="flex items-center gap-3 min-h-[var(--size-target)] cursor-pointer">
							<input
								type="checkbox"
								data-testid="case-filtre-espace"
								data-slug={espace.slug}
								checked={cochees.includes(espace.id)}
								onChange={(evenement) => basculer(espace.id, evenement.target.checked)}
								className="size-6 shrink-0 accent-brand"
							/>
							<span className="truncate">{espace.name}</span>
						</label>
					))}
				</div>
			</fieldset>
		</div>
	)
}

/**
 * La barre du filtre « Espace » d'une page qui n'en a pas (§5.115) : le bouton, puis son panneau dans le flux. Rien
 * pour une personne d'un seul espace.
 */
export function FiltreEspaces({ filtre }: { readonly filtre: FiltreEspacesDePage }) {
	if (!filtre.visible) return null
	return (
		<div className="flex flex-col gap-3">
			<div
				role="group"
				aria-label={t('spaces.filter.aria')}
				data-testid="filtre-espaces"
				className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3 min-w-0"
			>
				<BoutonFiltreEspaces filtre={filtre} />
			</div>
			<PanneauFiltreEspaces filtre={filtre} />
		</div>
	)
}

/**
 * Le vide sous le filtre (§5.115) : il n'est pas le vide de la page. « Afficher tous les espaces » vide le filtre et rend
 * le focus au bouton « Espace », qui reste monté.
 */
export function VideSousFiltreEspaces({ filtre }: { readonly filtre: FiltreEspacesDePage }) {
	return (
		<div data-testid="vide-filtre-espaces">
			<EtatVide
				titre={t('spaces.filter.empty.title')}
				corps={t('spaces.filter.empty.body')}
				action={
					<Button
						data-testid="afficher-tous-les-espaces"
						onClick={() => {
							filtre.choisir([])
							filtre.refBouton.current?.focus()
						}}
					>
						{t('spaces.filter.empty.all')}
					</Button>
				}
			/>
		</div>
	)
}

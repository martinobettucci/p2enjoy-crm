// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : l'icône « Aide » de l'en-tête et son panneau
// @spec docs/SPEC-manual.md §13.2 (l'entrée de l'en-tête, « Aide sur cet écran », « Sommaire du manuel ») ;
//       docs/DESIGN_SYSTEM.md §5.69 (cette surface), §5.43 (le panneau réemployé : ancré à l'en-tête, Échap, clic hors,
//       focus), §5.46 (la barre de titre d'un panneau ouvert par une icône), §8, §9 (`BookOpen`) ; docs/JOURNAL.md
//       décision 740
//
// UNE ICÔNE, UN PANNEAU (décision 740) : l'en-tête ne gagne qu'une place. Le lien vers le chapitre de l'écran vit dans
// le panneau, nommé par le titre du chapitre — le sommaire, lu une fois et partagé avec les pages de l'aide, le donne.

import { BookOpen } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { t } from '../i18n'
import type { Sommaire } from '../lib/manuel'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { adresseAide, aideDeLecran, type CibleAide } from './aide-ecrans'
import { CHEMIN_AIDE } from './chemins'
import { fermerLesAutresPanneaux, useFermetureParUnAutrePanneau } from './panneaux-entete'
import { useSommaireManuel } from './lecture-manuel'

const CLASSES_LIEN = [
	'flex items-center min-h-[var(--size-target)] px-3 rounded-sm',
	'text-brand hover:bg-hover',
	'transition-colors duration-[var(--transition-duration-fast)]',
].join(' ')

/** Le titre que porte le lien « Aide sur cet écran » : celui de la section, sinon du chapitre ; `null` s'il n'est pas lu. */
export function titreDeLaCible(sommaire: Sommaire | null, cible: CibleAide): string | null {
	const chapitre = sommaire?.chapters.find((c) => c.slug === cible.chapitre)
	if (chapitre === undefined) return null
	if (cible.section === undefined) return chapitre.title
	return chapitre.sections.find((s) => s.anchor === cible.section)?.title ?? chapitre.title
}

export function AideEntete({ client = clientCrm }: { readonly client?: ClientCrm | null } = {}) {
	const { pathname } = useLocation()
	const cible = aideDeLecran(pathname)
	const [ouvert, setOuvert] = useState(false)
	const { etat } = useSommaireManuel(client, ouvert)
	const idPanneau = useId()
	const ancre = useRef<HTMLDivElement | null>(null)
	const bouton = useRef<HTMLButtonElement | null>(null)
	const premierLien = useRef<HTMLAnchorElement | null>(null)

	const fermer = useCallback(() => {
		setOuvert(false)
		// LE RETOUR DU FOCUS N'EST PAS DIFFÉRÉ : l'icône reste montée, elle est l'ancre du panneau (§5.43).
		bouton.current?.focus()
	}, [])

	const fermerSansFocus = useCallback(() => setOuvert(false), [])
	useFermetureParUnAutrePanneau('aide', fermerSansFocus)

	// `Échap` referme depuis n'importe où dans le panneau et rend le focus à l'icône (§5.43).
	useEffect(() => {
		if (!ouvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key === 'Escape') fermer()
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [ouvert, fermer])

	// Un clic hors du panneau le referme sans rendre le focus : le pointeur l'a déjà porté ailleurs (§5.43).
	useEffect(() => {
		if (!ouvert) return
		const surClic = (evenement: MouseEvent) => {
			const cibleClic = evenement.target
			if (cibleClic instanceof Node && ancre.current?.contains(cibleClic) === true) return
			setOuvert(false)
		}
		globalThis.addEventListener('mousedown', surClic)
		return () => globalThis.removeEventListener('mousedown', surClic)
	}, [ouvert])

	// L'OUVERTURE PLACE LE FOCUS SUR LE PREMIER LIEN (§5.69).
	useEffect(() => {
		if (ouvert) premierLien.current?.focus()
	}, [ouvert])

	// Suivre un lien referme le panneau : l'adresse change, le panneau n'a plus d'objet.
	useEffect(() => {
		setOuvert(false)
	}, [pathname])

	const sommaire = etat.statut === 'pret' ? etat.donnees : null
	const titreEcran = cible === null ? null : titreDeLaCible(sommaire, cible)

	return (
		<div ref={ancre} className="shrink-0">
			<button
				ref={bouton}
				type="button"
				data-testid="bouton-aide"
				aria-expanded={ouvert}
				aria-controls={idPanneau}
				aria-label={t('help.header.button')}
				title={t('help.header.button')}
				onClick={() => {
					if (!ouvert) fermerLesAutresPanneaux('aide')
					setOuvert(!ouvert)
				}}
				className={[
					'inline-flex items-center justify-center shrink-0',
					'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
					'transition-colors duration-[var(--transition-duration-fast)]',
				].join(' ')}
			>
				<BookOpen aria-hidden="true" size={20} />
			</button>

			{ouvert ? (
				<div
					id={idPanneau}
					role="region"
					aria-label={t('help.panel.aria')}
					data-testid="panneau-aide"
					className={[
						// ANCRÉ À L'EN-TÊTE, ET NON À L'ICÔNE (§5.43) : sous `md` d'un bord à l'autre moins la marge, à partir
						// de `md` une colonne de `40ch` alignée à droite. `md` et jamais `sm` (§11).
						'absolute top-full z-40 mt-2',
						'left-4 right-4 md:left-auto md:right-4 md:w-[40ch]',
						'bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)]',
					].join(' ')}
				>
					<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
						<h2 className="text-h3">{t('help.panel.title')}</h2>
						<button
							type="button"
							onClick={fermer}
							data-testid="fermer-aide"
							className="inline-flex items-center justify-center min-h-[var(--size-target)] px-2 rounded-sm text-sm text-brand font-medium hover:bg-hover"
						>
							{t('help.panel.close')}
						</button>
					</div>
					<div className="flex flex-col p-2">
						{cible === null ? null : (
							<div className="flex flex-col pb-2 mb-2 border-b border-border">
								<p className="px-3 pt-1 text-sm text-text-2">{t('help.panel.screen')}</p>
								<Link ref={premierLien} to={adresseAide(cible)} data-testid="aide-ecran" className={CLASSES_LIEN}>
									{titreEcran ?? t('help.panel.screenFallback')}
								</Link>
							</div>
						)}
						<Link
							{...(cible === null ? { ref: premierLien } : {})}
							to={CHEMIN_AIDE}
							data-testid="aide-sommaire"
							className={CLASSES_LIEN}
						>
							{t('help.panel.contents')}
						</Link>
					</div>
				</div>
			) : null}
		</div>
	)
}

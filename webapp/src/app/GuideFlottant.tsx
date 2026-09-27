// @spec CRM-094 (docs/BACKLOG.md) tranche T3 — le guide flottant des administrateurs
// @spec docs/SPEC-onboarding.md §10.2 (pour qui, où, quand, deux formes, non modal, re-mesure à chaque
//       page), §10.4 (stockage)
// @spec docs/DESIGN_SYSTEM.md §5.49 (pastille, panneau, réserve), §5.17 (le même guide), §8 (clavier)
// @spec docs/JOURNAL.md décisions 606 — « quand on clique, on le perd » : le guide suit l'administrateur —
//       et 607 (la réserve engendrée, la re-mesure sous une coquille gardée)
// @spec CLAUDE.md §10 (le rôle décide d'un affichage, jamais d'un droit), §11 (session seulement)
//
// La seule surface du produit positionnée hors du flux du document. Elle n'est PAS une modale : ni
// voile, ni piège de focus — la page reste utilisable panneau ouvert. Son contenu est la liste du
// guide de la page, telle quelle (`ListeEtapesDemarrage`) : c'est le même guide dans un autre
// contenant, jamais une seconde écriture.

import { ListChecks } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import {
	compterAccomplies,
	mesureEnCours,
	resteUneEtape,
	useDemarrage,
	type ProgressionDemarrage,
} from '../lib/demarrage'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'
import { CHEMIN_DEMARRAGE } from './chemins'
import { useContexteEspace } from './ContexteEspace'
import { ListeEtapesDemarrage, Progression, useGesteDepart } from './GuideDemarrage'
import { useFormeGuideFlottant, useMasqueDemarrage } from './preferences'

/**
 * La dernière progression MESURÉE, en mémoire vive et nulle part ailleurs (§10.4 : aucun stockage de
 * plus). Chaque changement de page lance une nouvelle mesure — la coquille est remontée quand la route
 * change de nature, gardée d'une page de réglages à l'autre (voir `GuideFlottant`) —, et sans cette
 * mémoire la pastille disparaîtrait le temps de la mesure : elle clignoterait à chaque page.
 */
let derniereMesuree: ProgressionDemarrage | null = null

/** Pour les preuves unitaires : chaque scénario part d'une mémoire vide. */
export function oublierDerniereMesure(): void {
	derniereMesuree = null
}

/** Les deux adresses qui rendent déjà le guide dans la page (§10.2, « Où »). */
function rendLeGuideDansLaPage(chemin: string): boolean {
	return chemin === '/' || chemin === CHEMIN_DEMARRAGE
}

export type ProprietesGuideFlottant = {
	/** Injecté par les preuves ; l'application emploie le client du produit. */
	readonly client?: ClientCrm | null
	/** Point d'injection des preuves, comme pour le guide de la page ; l'application ne le pose pas. */
	readonly sessionOuverte?: boolean
}

export function GuideFlottant({ client = clientCrm, sessionOuverte }: ProprietesGuideFlottant = {}) {
	const { etat } = useAuthentification()
	const { estAdmin } = useContexteEspace()
	const { pathname } = useLocation()
	const ouverte = sessionOuverte ?? etat.statut === 'authentifie'
	// Rien n'est mesuré hors de ce cas : ni pour un autre rôle, ni là où la page rend déjà le guide —
	// deux mesures du même guide sur un même écran seraient deux requêtes pour une information.
	const actif = ouverte && estAdmin && !rendLeGuideDansLaPage(pathname)

	const { progression, recharger } = useDemarrage(actif ? client : null)
	const geste = useGesteDepart(actif ? client : null)

	// Re-mesurer à CHAQUE changement de page (§10.2). Les routes de réglages rendent toutes la même
	// coquille au même endroit : React la GARDE d'une page à l'autre, et ce guide avec elle — sa mesure
	// resterait celle de la première page. TROUVÉ PAR LA PREUVE E2E (décision 607) : le track créé sur
	// l'arborescence ne comptait pas sur l'éditeur ; la preuve unitaire, elle, remontait le composant et
	// ne pouvait pas le voir. Un guide qui vient de DEVENIR actif mesure déjà — son client vient de lui
	// être donné — : relancer ferait partir les six comptages deux fois.
	const pagePrecedente = useRef({ chemin: pathname, actif })
	useEffect(() => {
		const precedente = pagePrecedente.current
		pagePrecedente.current = { chemin: pathname, actif }
		if (precedente.chemin !== pathname && precedente.actif && actif) recharger()
	}, [pathname, actif, recharger])
	const { masque, masquer } = useMasqueDemarrage()
	const { ouvert, ouvrir, reduire } = useFormeGuideFlottant()
	const idPanneau = useId()
	const idTitre = useId()
	const pastille = useRef<HTMLButtonElement | null>(null)
	const titre = useRef<HTMLHeadingElement | null>(null)
	const [focusAuTitre, setFocusAuTitre] = useState(false)

	if (!mesureEnCours(progression)) derniereMesuree = progression
	const affichee = mesureEnCours(progression) ? derniereMesuree : progression

	// `Échap` referme et rend le focus à la pastille (§10.2) — seulement panneau ouvert : ailleurs,
	// la touche appartient à la page.
	useEffect(() => {
		if (!ouvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key !== 'Escape') return
			reduire()
			pastille.current?.focus()
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [ouvert, reduire])

	// Ouvrir place le focus sur le titre du panneau — après le rendu qui le crée. Une réouverture par
	// changement de page, elle, ne vole pas le focus : l'utilisateur vient de suivre un lien.
	useEffect(() => {
		if (!focusAuTitre || !ouvert) return
		titre.current?.focus()
		setFocusAuTitre(false)
	}, [focusAuTitre, ouvert])

	if (!actif || masque || affichee === null || !resteUneEtape(affichee)) return null

	const { accomplies, total } = compterAccomplies(affichee)
	const valeurs = { faites: String(accomplies), total: String(total) }

	return (
		<>
			{/* La zone principale garde en bas la place de la pastille — sa hauteur plus son écart au bord
			    —, et le dernier élément d'une liste n'est jamais caché dessous (docs/DESIGN_SYSTEM.md
			    §5.49). Écrite d'abord `h-16`, la réserve n'existait pas : l'échelle d'espacement est
			    close (§3, §11), et la classe n'était pas engendrée — trouvé par le contrôle des classes. */}
			<div
				aria-hidden="true"
				data-testid="reserve-guide-flottant"
				className="h-[calc(var(--size-target)+var(--spacing-4))]"
			/>
			<div className="fixed bottom-3 right-3 md:bottom-4 md:right-4 z-20 flex flex-col items-end gap-2">
				{ouvert ? (
					<section
						id={idPanneau}
						aria-labelledby={idTitre}
						data-testid="panneau-guide-flottant"
						className={[
							'flex flex-col gap-3 p-4',
							'w-[min(380px,calc(100vw-32px))] max-h-[min(70vh,560px)] overflow-y-auto',
							'bg-surface border border-border rounded-lg shadow-card-hover',
							'motion-safe:animate-[apparition-guide_150ms_ease-out]',
						].join(' ')}
					>
						<h2 id={idTitre} ref={titre} tabIndex={-1} className="text-h3">
							{t('onboarding.flottant.titre')}
						</h2>
						<Progression accomplies={accomplies} total={total} progression={affichee} />
						<ListeEtapesDemarrage progression={affichee} recharger={recharger} geste={geste} />
						<div className="flex flex-wrap gap-2">
							<Button
								variante="secondaire"
								onClick={() => {
									reduire()
									pastille.current?.focus()
								}}
								data-testid="reduire-guide-flottant"
							>
								{t('onboarding.flottant.reduire')}
							</Button>
							<Button
								variante="discret"
								onClick={() => {
									masquer()
									// Le focus ne reste jamais sur un élément qui vient de disparaître (§7).
									globalThis.document?.getElementById('contenu-principal')?.focus()
								}}
								data-testid="masquer-guide-flottant"
							>
								{t('onboarding.flottant.masquer')}
							</Button>
						</div>
					</section>
				) : null}
				<button
					ref={pastille}
					type="button"
					aria-expanded={ouvert}
					{...(ouvert ? { 'aria-controls': idPanneau } : {})}
					onClick={() => {
						if (ouvert) {
							reduire()
							return
						}
						ouvrir()
						setFocusAuTitre(true)
					}}
					data-testid="pastille-guide-flottant"
					className={[
						'inline-flex items-center gap-2 min-h-[var(--size-target)] px-4 rounded-full',
						'bg-surface text-ink border border-border shadow-card-hover font-medium',
						'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
					].join(' ')}
				>
					<ListChecks aria-hidden="true" size={18} strokeWidth={2} className="shrink-0 text-brand" />
					<span className="hidden md:inline">{t('onboarding.flottant.pastille', valeurs)}</span>
					<span aria-hidden="true" className="md:hidden">
						{t('onboarding.flottant.pastille.courte', valeurs)}
					</span>
					<span className="sr-only md:hidden">{t('onboarding.flottant.pastille', valeurs)}</span>
				</button>
			</div>
		</>
	)
}

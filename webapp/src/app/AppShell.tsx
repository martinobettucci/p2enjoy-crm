// @spec CRM-007 (docs/BACKLOG.md) — coquille de l'application
// @spec docs/DESIGN_SYSTEM.md §4 (architecture des écrans), §5.8 (états), §7, §8
// @spec docs/SPEC-webapp.md §5.1 (coquille), §7 (états), §9 (accessibilité), §11 (stockage)
//
// La coquille assemble les points de repère sémantiques exigés par docs/DESIGN_SYSTEM.md §8 —
// `aside`, `nav`, `header`, `main` — et décide, à un seul endroit, lequel des états de
// docs/DESIGN_SYSTEM.md §5.8 occupe la zone principale.
//
// Ce choix est centralisé parce qu'il doit être **exhaustif** : le type somme `EtatAsync`
// oblige à traiter chaque cas, et le traiter une seule fois évite qu'une route en oublie un.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkipLink } from '../components/ui/SkipLink'
import { EtatConfiguration, EtatErreur, EtatRefus } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { clientCrm } from '../lib/supabase'
import type { Channel } from '../lib/channels'
import { useTracks } from '../lib/tracks'
import { useWorkspaces } from '../lib/workspaces'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { useReplisidebar } from './preferences'

const ID_CONTENU = 'contenu-principal'

export type ProprietesAppShell = {
	readonly cleTitreRoute: CleTraduction
	/**
	 * Titre affiché à la place du libellé traduit — `CRM-021`. Le nom d'un track est une
	 * **donnée**, pas une traduction (`docs/DESIGN_SYSTEM.md` §10) : il ne peut donc pas passer
	 * par une clé. La clé reste exigée comme repli, pour que l'en-tête ne soit jamais sans titre
	 * pendant le chargement ou lorsque le track est introuvable.
	 */
	readonly titreRoute?: string
	/**
	 * Channels du track courant, pour la barre d'onglets — `CRM-021`. Absent hors d'une route de
	 * track : la barre affiche alors son état vide, comme depuis `CRM-007`.
	 */
	readonly etatChannels?: EtatAsync<readonly Channel[]>
	readonly onRechargerChannels?: () => void
	/** Slug du track porteur, pour construire l'adresse de chaque onglet. */
	readonly slugTrack?: string
	readonly children: ReactNode
}

export function AppShell({
	cleTitreRoute,
	titreRoute,
	etatChannels,
	onRechargerChannels,
	slugTrack,
	children,
}: ProprietesAppShell) {
	const { replie, basculer } = useReplisidebar()
	const [tiroirOuvert, setTiroirOuvert] = useState(false)
	// Deux chargements indépendants depuis `CRM-020` : le contexte d'espace de travail, porté par
	// l'en-tête, et les tracks, portés par la barre latérale. Ils échouent séparément, et la zone
	// principale décide en les regardant **tous les deux** (voir `ZonePrincipale`).
	const { etat, recharger } = useWorkspaces(clientCrm)
	const { etat: etatTracks, recharger: rechargerTracks } = useTracks(clientCrm)

	const toutRecharger = useCallback(() => {
		recharger()
		rechargerTracks()
		onRechargerChannels?.()
	}, [recharger, rechargerTracks, onRechargerChannels])

	const fermerTiroir = useCallback(() => setTiroirOuvert(false), [])
	const ouvrirTiroir = useCallback(() => setTiroirOuvert(true), [])

	// Échapper referme le tiroir : une surface qui recouvre l'écran doit toujours pouvoir se
	// refermer au clavier (docs/DESIGN_SYSTEM.md §8).
	useEffect(() => {
		if (!tiroirOuvert) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key === 'Escape') setTiroirOuvert(false)
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [tiroirOuvert])

	// La région polie annonce ce que l'utilisateur voit réellement changer : le contexte d'espace
	// de travail **et** le contenu de la barre latérale, qui liste les tracks depuis `CRM-020`.
	// N'annoncer que le premier laisserait le second changer en silence (docs/DESIGN_SYSTEM.md §8).
	//
	// Les deux annonces sont concaténées plutôt que mises en concurrence : une région `aria-live`
	// unique n'en relaie qu'une à la fois, et supprimer la seconde reviendrait à choisir laquelle
	// des deux informations l'utilisateur n'aura pas.
	const annonce = useMemo(() => {
		if (clientCrm === null) return ''
		const parts: string[] = []
		if (etat.statut === 'erreur') parts.push(t('live.workspaces.error'))
		else if (etat.statut === 'pret')
			parts.push(etat.donnees.length === 0 ? t('live.workspaces.empty') : t('live.workspaces.loaded'))
		if (etatTracks.statut === 'erreur') parts.push(t('live.tracks.error'))
		else if (etatTracks.statut === 'pret')
			parts.push(etatTracks.donnees.length === 0 ? t('live.tracks.empty') : t('live.tracks.loaded'))
		return parts.join(' ')
	}, [etat, etatTracks])

	return (
		<div className="min-h-dvh flex flex-col">
			<SkipLink cible={ID_CONTENU} libelle={t('skip.toContent')} />
			<LiveRegion libelle={t('live.aria')} message={annonce} />

			<div className="flex flex-1 min-h-0">
				{/* Voile du tiroir : présent uniquement sous le palier « colonne », et
				    volontairement non focusable — la fermeture au clavier passe par Échap. */}
				{tiroirOuvert ? (
					<div
						aria-hidden="true"
						data-testid="voile-tiroir"
						onClick={fermerTiroir}
						className="fixed inset-0 z-30 bg-veil lg:hidden"
					/>
				) : null}

				<Sidebar
					replie={replie}
					onBasculerRepli={basculer}
					tiroirOuvert={tiroirOuvert}
					onFermerTiroir={fermerTiroir}
					etatTracks={etatTracks}
				/>

				<div className="flex flex-col flex-1 min-w-0">
					<Header
						titreRoute={titreRoute ?? t(cleTitreRoute)}
						onOuvrirTiroir={ouvrirTiroir}
						etatWorkspaces={etat}
					/>
					<TabBar etat={etatChannels} slugTrack={slugTrack} />
					<main id={ID_CONTENU} tabIndex={-1} className="flex-1 min-w-0 p-4 overflow-x-auto">
						{/* Le chargement des channels rejoint les deux autres : un échec ne doit pas
						    être avalé par une barre d'onglets qui n'a pas la place de l'expliquer,
						    exactement comme pour les tracks à `CRM-020`. */}
						<ZonePrincipale
							etats={
								etatChannels === undefined
									? [etat, etatTracks]
									: [etat, etatTracks, etatChannels]
							}
							recharger={toutRecharger}
							contenu={children}
						/>
					</main>
				</div>
			</div>
		</div>
	)
}

/**
 * Décide ce qu'affiche la zone principale. L'ordre des cas est celui de leur gravité : une
 * configuration absente rend tout le reste indécidable, un refus est définitif là où une panne
 * de transport se retente.
 *
 * Depuis `CRM-020`, la décision porte sur **plusieurs** chargements. Aucun échec ne doit être
 * avalé : la barre latérale n'a pas la place d'expliquer une erreur, et si l'un des chargements
 * échoue sans que rien ne le dise, l'écran affiche un vide qui n'en est pas un — exactement la
 * valeur par défaut trompeuse que `CLAUDE.md` §18 interdit. Le premier échec rencontré occupe
 * donc la zone principale, et la reprise les relance **tous**.
 */
function ZonePrincipale({
	etats,
	recharger,
	contenu,
}: {
	readonly etats: readonly EtatAsync<unknown>[]
	readonly recharger: () => void
	readonly contenu: ReactNode
}) {
	if (clientCrm === null) {
		return (
			<EtatConfiguration
				titre={t('config.error.title')}
				corps={t('config.error.body')}
				detail={t('config.error.detail')}
			/>
		)
	}

	// Prédicat de type explicite : `filter` seul ne restreint pas le type somme, et le
	// compilateur refuserait ensuite l'accès à `erreur`.
	const estEnErreur = (
		etat: EtatAsync<unknown>,
	): etat is Extract<EtatAsync<unknown>, { statut: 'erreur' }> => etat.statut === 'erreur'

	const echecs = etats.filter(estEnErreur)
	// Un refus l'emporte sur une panne : il est définitif, tandis qu'une panne se retente. Les
	// présenter dans l'ordre inverse proposerait un bouton « Réessayer » à qui n'a pas les droits.
	const refus = echecs.find((etat) => etat.erreur.nature === 'forbidden')
	if (refus !== undefined) {
		return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
	}
	const panne = echecs[0]
	if (panne !== undefined) {
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={
					panne.erreur.nature === 'network' ? t('state.error.network') : t('state.error.unknown')
				}
				libelleReprise={t('state.error.retry')}
				onReprise={recharger}
			/>
		)
	}
	// `chargement` comme `pret` laissent la route rendre son propre contenu : la coquille
	// n'a pas à décider à sa place, et les squelettes de chargement vivent là où la donnée
	// est attendue — barre latérale et en-tête.
	return <>{contenu}</>
}

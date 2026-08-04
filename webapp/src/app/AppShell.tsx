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
import { clientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { useReplisidebar } from './preferences'

const ID_CONTENU = 'contenu-principal'

export type ProprietesAppShell = {
	readonly cleTitreRoute: CleTraduction
	readonly children: ReactNode
}

export function AppShell({ cleTitreRoute, children }: ProprietesAppShell) {
	const { replie, basculer } = useReplisidebar()
	const [tiroirOuvert, setTiroirOuvert] = useState(false)
	const { etat, recharger } = useWorkspaces(clientCrm)

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

	const annonce = useMemo(() => {
		if (clientCrm === null) return ''
		if (etat.statut === 'chargement') return ''
		if (etat.statut === 'erreur') return t('live.workspaces.error')
		return etat.donnees.length === 0 ? t('live.workspaces.empty') : t('live.workspaces.loaded')
	}, [etat])

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
					etatWorkspaces={etat}
				/>

				<div className="flex flex-col flex-1 min-w-0">
					<Header
						titreRoute={t(cleTitreRoute)}
						onOuvrirTiroir={ouvrirTiroir}
						etatWorkspaces={etat}
					/>
					<TabBar />
					<main id={ID_CONTENU} tabIndex={-1} className="flex-1 min-w-0 p-4 overflow-x-auto">
						<ZonePrincipale etat={etat} recharger={recharger} contenu={children} />
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
 */
function ZonePrincipale({
	etat,
	recharger,
	contenu,
}: {
	readonly etat: ReturnType<typeof useWorkspaces>['etat']
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
	if (etat.statut === 'erreur') {
		if (etat.erreur.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={etat.erreur.nature === 'network' ? t('state.error.network') : t('state.error.unknown')}
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

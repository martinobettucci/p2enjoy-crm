// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : l'écran de la plateforme, son accès et ses onglets
// @spec docs/SPEC-plateforme.md §7.1 (accès), §7.2 (composition) ; docs/DESIGN_SYSTEM.md §5.56, §12.1 (onglets-liens),
//       §5.8 (états) ; CLAUDE.md §10 — l'écran rend ce que la base consent, il ne décide aucun droit
// @spec CRM-101 tranche T6 — l'onglet « Utilisateurs », entre « Espaces » et « Superadministrateurs » (arbitrage A6)
//
// L'adresse ouverte sans le drapeau rend l'état de refus, et AUCUNE lecture métier ne part : la base refuserait de
// toute façon chaque fonction de la plateforme, et c'est elle qui fait foi.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireEstSuperadmin } from '../lib/plateforme'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import {
	CHEMIN_PLATEFORME_ESPACES,
	CHEMIN_PLATEFORME_JOURNAL,
	CHEMIN_PLATEFORME_SUPERADMINS,
	CHEMIN_PLATEFORME_UTILISATEURS,
} from './chemins'
import { PlateformeEspace } from './PlateformeEspace'
import { PlateformeEspaces } from './PlateformeEspaces'
import { PlateformeJournal } from './PlateformeJournal'
import { PlateformeSuperadmins } from './PlateformeSuperadmins'
import { PlateformeUtilisateurs } from './PlateformeUtilisateurs'

export type VuePlateforme = 'espaces' | 'espace' | 'utilisateurs' | 'superadmins' | 'journal'

const ONGLETS: readonly { readonly chemin: string; readonly cle: CleTraduction; readonly vues: readonly VuePlateforme[] }[] = [
	{ chemin: CHEMIN_PLATEFORME_ESPACES, cle: 'platform.tabs.espaces', vues: ['espaces', 'espace'] },
	{ chemin: CHEMIN_PLATEFORME_UTILISATEURS, cle: 'platform.tabs.utilisateurs', vues: ['utilisateurs'] },
	{ chemin: CHEMIN_PLATEFORME_SUPERADMINS, cle: 'platform.tabs.superadmins', vues: ['superadmins'] },
	{ chemin: CHEMIN_PLATEFORME_JOURNAL, cle: 'platform.tabs.journal', vues: ['journal'] },
]

export type ProprietesPlateforme = {
	readonly vue: VuePlateforme
	readonly client?: ClientCrm | null
}

export function Plateforme({ vue, client = clientCrm }: ProprietesPlateforme) {
	const [drapeau, setDrapeau] = useState<EtatAsync<boolean>>(enChargement)
	const [tentative, setTentative] = useState(0)

	useEffect(() => {
		if (client === null) return
		let vivant = true
		setDrapeau(enChargement())
		void lireEstSuperadmin(client).then((etat) => {
			if (vivant) setDrapeau(etat)
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	const relire = useCallback(() => setTentative((precedente) => precedente + 1), [])

	if (client === null || (drapeau.statut === 'pret' && !drapeau.donnees) || (drapeau.statut === 'erreur' && drapeau.erreur.nature === 'forbidden')) {
		return <EtatRefus titre={t('platform.refusAcces.title')} corps={t('platform.refusAcces.body')} />
	}
	if (drapeau.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}
	if (drapeau.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.erreurAcces.title')}
				corps={t('platform.erreurAcces.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={relire}
			/>
		)
	}

	return (
		<div className="flex flex-col gap-6" data-testid="plateforme">
			<nav aria-label={t('platform.tabs.aria')} className="border-b border-border overflow-x-auto indique-debordement-x">
				<ul className="flex items-center gap-1">
					{ONGLETS.map((onglet) => {
						const actif = onglet.vues.includes(vue)
						return (
							<li key={onglet.chemin}>
								<Link
									to={onglet.chemin}
									// `aria-current` est posé à la main, d'après la VUE et non d'après l'adresse : la fiche d'un espace
									// vit sous l'onglet « Espaces », qui doit rester marqué (§12.1, comme les onglets du §5.31).
									aria-current={actif ? 'page' : undefined}
									className={[
										'inline-flex items-center px-3 whitespace-nowrap min-h-[var(--size-target)] border-b-2',
										actif ? 'border-brand text-brand font-medium' : 'border-transparent text-text-2 hover:bg-hover',
										'transition-colors duration-[var(--transition-duration-fast)]',
									].join(' ')}
								>
									{t(onglet.cle)}
								</Link>
							</li>
						)
					})}
				</ul>
			</nav>
			{vue === 'espaces' && <PlateformeEspaces client={client} />}
			{vue === 'espace' && <PlateformeEspace client={client} />}
			{vue === 'utilisateurs' && <PlateformeUtilisateurs client={client} />}
			{vue === 'superadmins' && <PlateformeSuperadmins client={client} />}
			{vue === 'journal' && <PlateformeJournal client={client} />}
		</div>
	)
}

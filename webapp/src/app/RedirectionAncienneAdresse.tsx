// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — la route d'une ancienne adresse : elle lit l'espace de la ressource, puis
//       remplace l'adresse par celle de la page dans cet espace, paramètres et ancre recopiés (docs/SPEC-espace-courant.md
//       §8.2, §15.4 ; docs/DESIGN_SYSTEM.md §5.8 — un squelette pendant la lecture)
//
// `replace` : « Précédent » ne ramène jamais à l'ancienne adresse, qui redirigerait aussitôt. Sans espace lisible, la
// coquille dit « Aucun workspace accessible », comme sur toute autre page.

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { espaceDeLAncienneAdresse, reconnaitre } from '../lib/ancienne-adresse'
import { choisirEspace } from '../lib/espace-onglet'
import { clientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { AppShell } from './AppShell'
import { cheminEspace } from './chemins'

export function RedirectionAncienneAdresse() {
	const location = useLocation()
	const { etat } = useWorkspaces(clientCrm)
	const [cible, setCible] = useState<string | null>(null)

	useEffect(() => {
		if (etat.statut !== 'pret' || clientCrm === null) return
		const repli = choisirEspace(etat.donnees, undefined)
		if (repli.genre !== 'espace') return
		const adresse = reconnaitre(location.pathname, location.search)
		let vivant = true
		void (async () => {
			const slug =
				adresse === null
					? repli.espace.slug
					: await espaceDeLAncienneAdresse(clientCrm, adresse, etat.donnees, repli.espace.slug)
			if (vivant) setCible(`${cheminEspace(slug, location.pathname)}${location.search}${location.hash}`)
		})()
		return () => {
			vivant = false
		}
	}, [etat, location.pathname, location.search, location.hash])

	if (cible !== null) return <Navigate to={cible} replace />
	// Sans espace lisible, ou sur un échec de lecture des espaces : la coquille dit l'état, comme ailleurs.
	if (etat.statut === 'erreur' || (etat.statut === 'pret' && etat.donnees.length === 0) || clientCrm === null) {
		return (
			<AppShell cleTitreRoute="route.notfound.title">
				<span />
			</AppShell>
		)
	}
	return (
		<div className="p-4" data-testid="redirection-ancienne-adresse">
			<SkeletonListe lignes={1} libelle={t('espace.redirection.chargement')} />
		</div>
	)
}

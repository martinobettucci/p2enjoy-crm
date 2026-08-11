// @spec CRM-007 (docs/BACKLOG.md) — racine applicative et routage
// @spec CRM-009 (docs/BACKLOG.md) — route de connexion et restauration de session
// @spec CRM-075 (docs/BACKLOG.md) — route de l'administration de l'arborescence
// @spec CRM-059 (docs/BACKLOG.md) — route de l'écran d'état de la messagerie
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.2 (session), §12.3 (chargement différé)
// @spec docs/SPEC-auth.md §9.1 ; docs/JOURNAL.md décision 248
//
// Le routage est déclaré à partir de la table de `routes.tsx` : ajouter une route ne demande
// pas de toucher à ce fichier, et le titre affiché par l'en-tête ne peut pas diverger de la
// route rendue, puisqu'ils viennent de la même description.

import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { AppShell } from './AppShell'
import { FournisseurAuthentification, useAuthentification } from './Authentification'
import { ChargementAuthentification, EcranConnexion } from './EcranConnexion'
import {
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_CARD,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_LISTE,
	CHEMINS_TRACK,
	CLE_TITRE_ADMIN_ARBORESCENCE,
	CLE_TITRE_ETAT_MESSAGERIE,
	CLE_TITRE_INTROUVABLE,
	PageIntrouvable,
	ROUTES,
} from './routes'

const RouteTrack = lazy(async () => ({ default: (await import('./RouteTrack')).RouteTrack }))
/**
 * L'écran d'administration de `CRM-075`, chargé à la demande comme l'inbox et le board : la
 * plupart des sessions ne l'ouvrent pas, et il n'a pas à peser sur leur premier rendu
 * (`CLAUDE.md` §21). MESURÉ : le paquet séparé pèse 21 ko.
 */
const AdministrationArborescence = lazy(async () => ({
	default: (await import('./AdministrationArborescence')).AdministrationArborescence,
}))
/** L'écran d'état de la messagerie de `CRM-059`, chargé à la demande pour la même raison. */
const EtatMessagerie = lazy(async () => ({
	default: (await import('./EtatMessagerie')).EtatMessagerie,
}))
const RouteCard = lazy(async () => ({ default: (await import('./RouteCard')).RouteCard }))

/** État bref mais explicite pendant le téléchargement d'une route métier. */
export function ChargementRoute() {
	return (
		<main className="min-h-dvh bg-bg px-4 py-6">
			<SkeletonListe lignes={6} libelle={t('state.loading.aria')} className="max-w-[960px] mx-auto" />
		</main>
	)
}

export function App() {
	return (
		<BrowserRouter>
			<FournisseurAuthentification>
				<RoutesApplication />
			</FournisseurAuthentification>
		</BrowserRouter>
	)
}

function RoutesApplication() {
	const { etat } = useAuthentification()
	if (etat.statut === 'chargement') {
		return <ChargementAuthentification />
	}

	return (
		<Suspense fallback={<ChargementRoute />}>
			<Routes>
				<Route path="/connexion" element={<EcranConnexion />} />
				{ROUTES.map((route) => (
					<Route
						key={route.chemin}
						path={route.chemin}
						element={<AppShell cleTitreRoute={route.cleTitre}>{route.rendu()}</AppShell>}
					/>
				))}
				{/* Les routes d'un track portent leur propre coquille : leur titre est le nom du
				    track — une donnée — et leur barre d'onglets dépend du chargement (`CRM-021`). */}
				{CHEMINS_TRACK.map((chemin) => (
					<Route key={chemin} path={chemin} element={<RouteTrack />} />
				))}
				{/* La vue liste d'un channel — `CRM-042`. Même coquille et même résolution de track
				    que le board, dont elle n'est qu'une seconde lecture : ce qui change est la zone
				    principale, pas la route de track (docs/SPEC-cards.md §12.2). */}
				<Route path={CHEMIN_LISTE} element={<RouteTrack vue="liste" />} />
				{/* Le détail d'une card porte lui aussi sa propre coquille : son titre est celui de
				    la card, et son contenu dépend de son identifiant (`CRM-037`). Déclarée **après**
				    les routes de track, dont elle prolonge le chemin. */}
				<Route path={CHEMIN_CARD} element={<RouteCard />} />
				{/* L'administration de l'arborescence — `CRM-075`. Elle porte la coquille commune et
				    son titre est une clé de traduction, mais elle n'est pas une entrée de la barre
				    latérale : on y arrive par l'index des réglages
				    (docs/SPEC-administration-arborescence.md §3.1). */}
				<Route
					path={CHEMIN_ADMIN_ARBORESCENCE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ADMIN_ARBORESCENCE}>
							<AdministrationArborescence />
						</AppShell>
					}
				/>
				{/* L'écran d'état de la messagerie — `CRM-059`. Même position que l'administration
				    de l'arborescence : hors de la barre latérale, atteint depuis l'index des
				    réglages (docs/SPEC-mail-subsystem.md §20.11.1). */}
				<Route
					path={CHEMIN_ETAT_MESSAGERIE}
					element={
						<AppShell cleTitreRoute={CLE_TITRE_ETAT_MESSAGERIE}>
							<EtatMessagerie />
						</AppShell>
					}
				/>
				<Route
					path="*"
					element={
						<AppShell cleTitreRoute={CLE_TITRE_INTROUVABLE}>
							<PageIntrouvable />
						</AppShell>
					}
				/>
			</Routes>
		</Suspense>
	)
}

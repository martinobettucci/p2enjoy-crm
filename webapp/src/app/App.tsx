// @spec CRM-007 (docs/BACKLOG.md) — racine applicative et routage
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/DAT.md §3.1 (webapp)
//
// Le routage est déclaré à partir de la table de `routes.tsx` : ajouter une route ne demande
// pas de toucher à ce fichier, et le titre affiché par l'en-tête ne peut pas diverger de la
// route rendue, puisqu'ils viennent de la même description.

import { BrowserRouter, Route, Routes } from 'react-router'
import { AppShell } from './AppShell'
import { RouteCard } from './RouteCard'
import { RouteTrack } from './RouteTrack'
import { CHEMIN_CARD, CHEMINS_TRACK, CLE_TITRE_INTROUVABLE, PageIntrouvable, ROUTES } from './routes'

export function App() {
	return (
		<BrowserRouter>
			<Routes>
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
				{/* Le détail d'une card porte lui aussi sa propre coquille : son titre est celui de
				    la card, et son contenu dépend de son identifiant (`CRM-037`). Déclarée **après**
				    les routes de track, dont elle prolonge le chemin. */}
				<Route path={CHEMIN_CARD} element={<RouteCard />} />
				<Route
					path="*"
					element={
						<AppShell cleTitreRoute={CLE_TITRE_INTROUVABLE}>
							<PageIntrouvable />
						</AppShell>
					}
				/>
			</Routes>
		</BrowserRouter>
	)
}

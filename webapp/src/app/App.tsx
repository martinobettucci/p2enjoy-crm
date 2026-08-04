// @spec CRM-007 (docs/BACKLOG.md) — racine applicative et routage
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/DAT.md §3.1 (webapp)
//
// Le routage est déclaré à partir de la table de `routes.tsx` : ajouter une route ne demande
// pas de toucher à ce fichier, et le titre affiché par l'en-tête ne peut pas diverger de la
// route rendue, puisqu'ils viennent de la même description.

import { BrowserRouter, Route, Routes } from 'react-router'
import { AppShell } from './AppShell'
import { CLE_TITRE_INTROUVABLE, PageIntrouvable, ROUTES } from './routes'

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

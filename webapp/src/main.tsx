// @spec CRM-007 (docs/BACKLOG.md) — montage de l'application
// @spec docs/SPEC-webapp.md §3.1 (arborescence), §4 (jetons)
//
// L'élément d'ancrage est celui de `index.html`. Son absence est une erreur de déploiement,
// pas un cas d'exécution à rattraper : on la signale au lieu de monter dans le vide.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/app.css'

const ancre = document.getElementById('root')
if (ancre === null) {
	throw new Error("L'élément #root est absent de index.html : l'application ne peut pas être montée.")
}

createRoot(ancre).render(
	<StrictMode>
		<App />
	</StrictMode>,
)

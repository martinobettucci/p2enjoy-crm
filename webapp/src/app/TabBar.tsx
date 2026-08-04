// @spec CRM-007 (docs/BACKLOG.md) — barre d'onglets de la coquille
// @spec docs/DESIGN_SYSTEM.md §4 (onglets des channels), §5.8 (état vide), §7 (débordement)
// @spec docs/SPEC-webapp.md §5.1 (coquille), §8 (responsive)
//
// Les channels sont livrés par `CRM-021` : la barre n'a donc, aujourd'hui, aucun onglet à
// afficher. Elle expose son **état vide** plutôt qu'un `tablist` sans onglet — un `tablist`
// vide est annoncé comme un groupe d'onglets par les lecteurs d'écran, ce qui décrit une
// interface qui n'existe pas.
//
// Le patron ARIA complet — `role="tab"`, `tabindex` glissant, flèches, `Home` et `Fin` —
// arrivera avec les onglets réels et leurs preuves. L'écrire maintenant produirait du code
// qu'aucun test ne pourrait exercer.
//
// La barre reste présente, et ne disparaît pas : la structure de l'écran doit rester lisible
// d'un palier à l'autre, sinon l'utilisateur croit avoir changé d'application.

import { t } from '../i18n'

export function TabBar() {
	return (
		<div
			aria-label={t('tabs.aria')}
			data-testid="barre-onglets"
			// Le débordement se fait dans le conteneur, jamais dans la page
			// (docs/DESIGN_SYSTEM.md §7).
			className="flex items-center gap-2 px-4 py-2 bg-bg border-b border-border overflow-x-auto"
		>
			<span data-testid="onglets-vides" className="text-sm text-text-3 whitespace-nowrap">
				{t('tabs.empty')}
			</span>
			<span className="sr-only">{t('tabs.empty.hint')}</span>
		</div>
	)
}

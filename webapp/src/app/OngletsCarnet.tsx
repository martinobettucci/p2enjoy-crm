// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : les deux onglets-liens du carnet, « Contacts » et « Organisations »
// @spec docs/SPEC-organisations.md §4 ; docs/DESIGN_SYSTEM.md §5.64 (onglets du carnet), §12.1 (navigation par liens,
//       `aria-current`, bordure basse de même épaisseur), §5.56 (le patron de la plateforme)
//
// Chaque onglet change l'adresse : ce sont des liens, jamais un `tablist` (§12.1).

import { Link } from 'react-router'
import { t, type CleTraduction } from '../i18n'
import { CHEMIN_CONTACTS, CHEMIN_ORGANISATIONS } from './chemins'

export type OngletCarnet = 'contacts' | 'organisations'

const ONGLETS: readonly { readonly onglet: OngletCarnet; readonly chemin: string; readonly cle: CleTraduction }[] = [
	{ onglet: 'contacts', chemin: CHEMIN_CONTACTS, cle: 'contacts.tabs.contacts' },
	{ onglet: 'organisations', chemin: CHEMIN_ORGANISATIONS, cle: 'contacts.tabs.organizations' },
]

export function OngletsCarnet({ actif }: { readonly actif: OngletCarnet }) {
	return (
		<nav aria-label={t('contacts.tabs.aria')} className="border-b border-border overflow-x-auto indique-debordement-x">
			<ul className="flex items-center gap-1">
				{ONGLETS.map((entree) => (
					<li key={entree.onglet}>
						<Link
							to={entree.chemin}
							aria-current={entree.onglet === actif ? 'page' : undefined}
							className={[
								'inline-flex items-center px-3 whitespace-nowrap min-h-[var(--size-target)] border-b-2',
								entree.onglet === actif
									? 'border-brand text-brand font-medium'
									: 'border-transparent text-text-2 hover:bg-hover',
								'transition-colors duration-[var(--transition-duration-fast)]',
							].join(' ')}
						>
							{t(entree.cle)}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	)
}

// @spec CRM-021 (docs/BACKLOG.md) — barre d'onglets : les channels du track courant
// @spec docs/SPEC-channels.md §5 (ce que la barre lit), §5.3 (patron ARIA), §4 (archivage)
// @spec docs/DESIGN_SYSTEM.md §4 (onglets), §5.8 (états), §7 (débordement), §8 (clavier)
// @spec docs/DESIGN_SYSTEM.md §12.1 (écart : navigation par liens, non `tablist`)
// @spec docs/SPEC-webapp.md §5.1 (coquille), §8 (responsive)
//
// `CRM-007` avait laissé cette barre en état vide, faute de channels, en annonçant que « le
// patron ARIA complet — `role="tab"`, `tabindex` glissant, flèches, `Home`, `Fin` — arrive avec
// les onglets réels ». Les onglets réels arrivent ici, et ce patron est **écarté** au profit
// d'une navigation par liens (docs/JOURNAL.md, décision 62) :
//
//   * un `tablist` décrit des panneaux qui s'échangent **dans la même page**, sans changer
//     d'adresse. Nos onglets changent l'URL et le contenu principal ;
//   * les annoncer comme des onglets décrirait aux technologies d'assistance un comportement qui
//     n'est pas celui du produit ;
//   * le `tabindex` glissant du patron `tablist` retirerait à l'utilisateur la navigation par
//     `Tab` qu'un ensemble de liens lui donne naturellement.
//
// L'onglet courant se signale par `aria-current="page"` — que `NavLink` pose lui-même — **et**
// par une bordure, jamais par la seule couleur (docs/DESIGN_SYSTEM.md §1).

import { NavLink } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { Channel } from '../lib/channels'

export type ProprietesTabBar = {
	/**
	 * Absent hors d'une route de track : la barre affiche alors son état vide. Ce n'est pas un
	 * cas d'erreur, c'est l'état normal des routes transverses — Inbox, Ma journée, Réglages —
	 * qui n'ont pas de channels.
	 */
	readonly etat?: EtatAsync<readonly Channel[]>
	/** Slug du track porteur, nécessaire pour construire l'adresse de chaque onglet. */
	readonly slugTrack?: string
}

export function TabBar({ etat, slugTrack }: ProprietesTabBar) {
	return (
		<div
			data-testid="barre-onglets"
			// Le débordement se fait dans le conteneur, jamais dans la page
			// (docs/DESIGN_SYSTEM.md §7), et il est **signalé** — §4 : « défilable, jamais tronqué
			// sans indication ». Défaut vu sur la capture à 390 px (docs/DESIGN_SYSTEM.md §12.6).
			className="flex items-center gap-2 px-4 bg-bg border-b border-border overflow-x-auto indique-debordement-x"
		>
			<Contenu etat={etat} slugTrack={slugTrack} />
		</div>
	)
}

function Contenu({ etat, slugTrack }: ProprietesTabBar) {
	if (etat?.statut === 'chargement') {
		return (
			<div className="py-2">
				<SkeletonListe lignes={1} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	// Un échec de chargement est présenté au centre de l'écran, pas dupliqué ici : la barre n'a
	// la place ni de l'expliquer, ni d'offrir une reprise utilisable. Même position que la barre
	// latérale à `CRM-020`.
	const channels = etat?.statut === 'pret' ? etat.donnees : []

	if (channels.length === 0 || slugTrack === undefined) {
		return (
			<div className="flex items-center gap-2 py-2" aria-label={t('tabs.aria')}>
				<span data-testid="onglets-vides" className="text-sm text-text-3 whitespace-nowrap">
					{t('tabs.empty')}
				</span>
				<span className="sr-only">{t('tabs.empty.hint')}</span>
			</div>
		)
	}

	return (
		<nav aria-label={t('tabs.aria')} className="min-w-0">
			<ul className="flex items-center gap-1">
				{channels.map((channel) => (
					<li key={channel.id}>
						<NavLink
							to={`/tracks/${slugTrack}/${channel.slug}`}
							data-testid="onglet-channel"
							data-slug={channel.slug}
							title={channel.name}
							className={({ isActive }) =>
								[
									'inline-flex items-center px-3 whitespace-nowrap',
									// Cible interactive ≥ 40 px (docs/DESIGN_SYSTEM.md §8).
									'min-h-[var(--size-target)]',
									// La bordure basse porte l'état actif **en plus** de la couleur : une
									// information ne repose jamais sur la seule couleur (§1). Les deux
									// états portent une bordure de même épaisseur, faute de quoi le texte
									// se décalerait de deux pixels au changement d'onglet.
									'border-b-2',
									isActive
										? 'border-brand text-brand font-medium'
										: 'border-transparent text-text-2 hover:bg-hover',
									'transition-colors duration-[var(--transition-duration-fast)]',
								].join(' ')
							}
						>
							{channel.name}
						</NavLink>
					</li>
				))}
			</ul>
		</nav>
	)
}

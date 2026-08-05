// @spec CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leur contenu
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (états)
// @spec docs/DAT.md §3.1 (« routes … relève de CRM-007 »)
//
// Chaque route rend un **état explicite**, jamais une page blanche : tant que les données
// n'existent pas, l'état vide est le contenu légitime de l'écran, et il nomme ce qui manque.

import { Link } from 'react-router'
import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'

export type DescriptionRoute = {
	readonly chemin: string
	readonly cleTitre: CleTraduction
	readonly rendu: () => React.ReactElement
}

export const ROUTES: readonly DescriptionRoute[] = [
	{
		chemin: '/',
		cleTitre: 'route.board.title',
		rendu: () => <EtatVide titre={t('route.board.empty.title')} corps={t('route.board.empty.body')} />,
	},
	{
		chemin: '/inbox',
		cleTitre: 'route.inbox.title',
		rendu: () => <EtatVide titre={t('route.inbox.empty.title')} corps={t('route.inbox.empty.body')} />,
	},
	{
		chemin: '/ma-journee',
		cleTitre: 'route.today.title',
		rendu: () => <EtatVide titre={t('route.today.empty.title')} corps={t('route.today.empty.body')} />,
	},
	{
		chemin: '/reglages',
		cleTitre: 'route.settings.title',
		rendu: () => (
			<EtatVide titre={t('route.settings.empty.title')} corps={t('route.settings.empty.body')} />
		),
	},
]

/** Adresse inconnue : on nomme le problème et on offre un retour, jamais une page blanche. */
export function PageIntrouvable() {
	return (
		<EtatVide
			titre={t('route.notfound.title')}
			corps={t('route.notfound.body')}
			action={
				<Link
					to="/"
					className={[
						'inline-flex items-center justify-center',
						'min-h-[var(--size-target)] px-4 rounded-sm',
						'bg-brand text-white font-medium',
						'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
					].join(' ')}
				>
					{t('route.notfound.action')}
				</Link>
			}
		/>
	)
}

export const CLE_TITRE_INTROUVABLE: CleTraduction = 'route.notfound.title'

/**
 * Routes d'un track — `CRM-021`. Elles ne figurent pas dans `ROUTES` : leur titre est une
 * **donnée** (le nom du track) et non une clé de traduction, et leur contenu dépend de paramètres
 * d'URL. Les décrire dans la même table obligerait à y introduire un cas particulier qui
 * profiterait à une seule entrée.
 *
 * Deux chemins, et non un seul : ouvrir un track sans choisir de channel est un état légitime —
 * c'est ce que fait un clic sur une pilule de la barre latérale.
 */
export const CHEMINS_TRACK = ['/tracks/:slugTrack', '/tracks/:slugTrack/:slugChannel'] as const

/**
 * Route de détail d'une card — `CRM-037`, `docs/SPEC-form-composer.md` §4.6.
 *
 * Elle ne figure pas davantage dans `ROUTES` : son titre est le titre de la card, donc une
 * **donnée**, et son contenu dépend de paramètres d'URL.
 *
 * La card est désignée par son **identifiant**, et non par un slug : `docs/SPEC-cards.md` ne lui
 * en donne aucun, et son `email_local_part` est délibérément non devinable.
 */
export const CHEMIN_CARD = '/tracks/:slugTrack/:slugChannel/cards/:idCard' as const

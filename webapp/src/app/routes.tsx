// @spec CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leur contenu
// @spec CRM-075 (docs/BACKLOG.md) — index des réglages et route de l'administration
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (états)
// @spec docs/SPEC-administration-arborescence.md §3.1 (deux adresses, et non une)
// @spec docs/DAT.md §3.1 (« routes … relève de CRM-007 »)
//
// Chaque route rend un **état explicite**, jamais une page blanche : tant que les données
// n'existent pas, l'état vide est le contenu légitime de l'écran, et il nomme ce qui manque.

import { Link } from 'react-router'
import { lazy } from 'react'
import { EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'

export type DescriptionRoute = {
	readonly chemin: string
	readonly cleTitre: CleTraduction
	readonly rendu: () => React.ReactElement
}

/**
 * L'inbox est chargée à la demande, comme le board et le détail d'une card.
 *
 * MESURÉ : livrée dans le paquet principal, elle le portait de 481 à 503 ko, franchissant le seuil
 * d'avertissement de l'outil de build. Un écran que la plupart des sessions n'ouvrent pas n'a pas à
 * peser sur le premier rendu de toutes les autres (`CLAUDE.md` §21). Le repli de `Suspense` est
 * déjà posé par `App` : aucune page blanche n'apparaît pendant le téléchargement.
 */
/** Adresse de l'inbox globale, nommée pour que les preuves la distinguent des routes en attente. */
export const CHEMIN_INBOX = '/inbox' as const

const RouteInbox = lazy(async () => ({ default: (await import('./RouteInbox')).RouteInbox }))

/**
 * Adresse de l'administration de l'arborescence — `CRM-075`.
 *
 * Elle ne figure PAS dans `ROUTES`, et c'est une contrainte tenue par une assertion : cette table
 * doit couvrir **exactement** les entrées de navigation transverses, sans orpheline dans un sens ni
 * dans l'autre. L'administration n'est pas une entrée de la barre latérale — on y arrive par l'index
 * des réglages —, elle suit donc le patron déjà employé par `CHEMIN_CARD` et `CHEMIN_LISTE` : une
 * adresse nommée ici, montée par `App` avec sa propre coquille.
 */
export const CHEMIN_ADMIN_ARBORESCENCE = '/reglages/arborescence' as const

/** Titre de la route d'administration, nommé comme celui de la page introuvable. */
export const CLE_TITRE_ADMIN_ARBORESCENCE: CleTraduction = 'admin.tree.title'

export const ROUTES: readonly DescriptionRoute[] = [
	{
		chemin: '/',
		cleTitre: 'route.board.title',
		rendu: () => <EtatVide titre={t('route.board.empty.title')} corps={t('route.board.empty.body')} />,
	},
	{
		// L'inbox globale de `CRM-057` remplace l'état vide de `CRM-007` : la messagerie est
		// raccordée, et l'écran montre désormais le courrier réellement reçu.
		chemin: CHEMIN_INBOX,
		cleTitre: 'route.inbox.title',
		rendu: () => <RouteInbox />,
	},
	{
		chemin: '/ma-journee',
		cleTitre: 'route.today.title',
		rendu: () => <EtatVide titre={t('route.today.empty.title')} corps={t('route.today.empty.body')} />,
	},
	{
		// `CRM-075` remplace l'état vide de `CRM-007` par un **index des sections**. L'écran
		// d'administration n'est pas placé ici : `CRM-070` et `CRM-076` amènent deux autres
		// sections, et une adresse déjà partagée ne se déplace pas gratuitement
		// (docs/SPEC-administration-arborescence.md §3.1).
		chemin: '/reglages',
		cleTitre: 'route.settings.title',
		rendu: () => <IndexReglages />,
	},
]


/**
 * Index des sections de réglages. Une seule entrée aujourd'hui, et c'est un état **exact** : la
 * configuration de l'instance reste tenue par le fichier d'environnement du serveur, ce que la
 * phrase de `CRM-007` disait déjà et qui reste vrai.
 */
export function IndexReglages() {
	return (
		<div className="flex flex-col gap-4 max-w-[60ch]">
			<h2 className="text-h3">{t('admin.settings.index.title')}</h2>
			<ul className="flex flex-col rounded-lg border border-border bg-surface">
				<li>
					<Link
						to={CHEMIN_ADMIN_ARBORESCENCE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.tree')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.tree.body')}</span>
					</Link>
				</li>
			</ul>
			<p className="text-sm text-text-3">{t('admin.settings.instance')}</p>
		</div>
	)
}

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

/**
 * Vue liste d'un channel — `CRM-042`, `docs/SPEC-cards.md` §12.2.
 *
 * Une route **propre**, et non un paramètre de la route du board : le tri, le filtre et le rang de
 * page vivent déjà dans la chaîne de requête, et y ajouter la vue elle-même ferait de l'adresse un
 * sac. Le board reste la vue par défaut d'un channel, à `/tracks/:slugTrack/:slugChannel`.
 */
export const CHEMIN_LISTE = '/tracks/:slugTrack/:slugChannel/liste' as const

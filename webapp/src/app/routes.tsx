// @spec CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leur contenu
// @spec CRM-075 (docs/BACKLOG.md) — index des réglages et route de l'administration
// @spec CRM-076 (docs/BACKLOG.md) — adresse de l'éditeur de workflows
// @spec CRM-059 (docs/BACKLOG.md) — route de l'écran d'état de la messagerie
// @spec CRM-062 (docs/BACKLOG.md) — route de l'écran des affaires figées (docs/SPEC-relances.md §10.4)
// @spec CRM-077 (docs/BACKLOG.md) — adresse de la corbeille (docs/SPEC-corbeille.md §4.1)
// @spec CRM-060 (docs/BACKLOG.md) — route du carnet de contacts (docs/SPEC-contacts.md §10.2)
// @spec CRM-086 (docs/BACKLOG.md) — adresse de l'écran de coûts d'un track (docs/SPEC-costs.md §4.0)
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (états)
// @spec docs/SPEC-administration-arborescence.md §3.1 (deux adresses, et non une)
// @spec docs/SPEC-mail-subsystem.md §20.11.1 (adresse dédiée, hors de ROUTES)
// @spec docs/DAT.md §3.1 (« routes … relève de CRM-007 »)
//
// Chaque route rend un **état explicite**, jamais une page blanche : tant que les données
// n'existent pas, l'état vide est le contenu légitime de l'écran, et il nomme ce qui manque.

import { Link } from 'react-router'
import { lazy } from 'react'
import { EtatVide } from '../components/ui/States'
import { AccueilDemarrage } from './GuideDemarrage'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'

export type DescriptionRoute = {
	readonly chemin: string
	readonly cleTitre: CleTraduction
	readonly rendu: () => React.ReactElement
}

// Les adresses elles-mêmes vivent désormais dans `chemins.ts`, module sans rendu — voir l'en-tête
// de ce fichier-là pour le motif (`CRM-079` : éviter un cycle avec le guide de démarrage). Elles
// sont RÉEXPORTÉES ici : aucun appelant existant n'est modifié.
import {
	CHEMIN_AFFAIRES_FIGEES,
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_ADMIN_CATALOGUE,
	CHEMIN_ADMIN_COMPTES_MAIL,
	CHEMIN_ADMIN_IDENTITES_MAIL,
	CHEMIN_ADMIN_MODELES_MAIL,
	CHEMIN_ADMIN_SEQUENCES_MAIL,
	CHEMIN_ADMIN_WORKFLOWS,
	CHEMIN_CONTACTS,
	CHEMIN_CORBEILLE,
	CHEMIN_COUTS_BUDGET,
	cheminCoutsBudget,
	CHEMIN_COUTS_TRACK,
	cheminCoutsTrack,
	CHEMIN_COUTS_WORKSPACE,
	CHEMIN_DEMARRAGE,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_INBOX,
	CHEMIN_MA_JOURNEE,
	CHEMIN_CONTACT,
	cheminContact,
	CHEMIN_OBJECTIFS,
	CHEMIN_OBJECTIFS_TABLEAU,
	cheminTableauObjectifs,
	CHEMIN_ORGANISATION,
	cheminOrganisation,
	CHEMIN_REGLAGES_NOTIFICATIONS,
} from './chemins'

export {
	CHEMIN_AFFAIRES_FIGEES,
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_ADMIN_CATALOGUE,
	CHEMIN_ADMIN_COMPTES_MAIL,
	CHEMIN_ADMIN_IDENTITES_MAIL,
	CHEMIN_ADMIN_MODELES_MAIL,
	CHEMIN_ADMIN_SEQUENCES_MAIL,
	CHEMIN_ADMIN_WORKFLOWS,
	CHEMIN_CONTACTS,
	CHEMIN_CORBEILLE,
	CHEMIN_COUTS_BUDGET,
	cheminCoutsBudget,
	CHEMIN_COUTS_TRACK,
	cheminCoutsTrack,
	CHEMIN_COUTS_WORKSPACE,
	CHEMIN_DEMARRAGE,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_INBOX,
	CHEMIN_MA_JOURNEE,
	CHEMIN_CONTACT,
	cheminContact,
	CHEMIN_OBJECTIFS,
	CHEMIN_OBJECTIFS_TABLEAU,
	cheminTableauObjectifs,
	CHEMIN_ORGANISATION,
	cheminOrganisation,
	CHEMIN_REGLAGES_NOTIFICATIONS,
}

/**
 * L'inbox est chargée à la demande, comme le board et le détail d'une card.
 *
 * MESURÉ : livrée dans le paquet principal, elle le portait de 481 à 503 ko, franchissant le seuil
 * d'avertissement de l'outil de build. Un écran que la plupart des sessions n'ouvrent pas n'a pas à
 * peser sur le premier rendu de toutes les autres (`CLAUDE.md` §21). Le repli de `Suspense` est
 * déjà posé par `App` : aucune page blanche n'apparaît pendant le téléchargement.
 */
const RouteInbox = lazy(async () => ({ default: (await import('./RouteInbox')).RouteInbox }))

/**
 * Le carnet est chargé à la demande, pour le motif exact de l'inbox juste au-dessus : un écran que
 * la plupart des sessions n'ouvrent pas n'a pas à peser sur le premier rendu de toutes les autres
 * (`CLAUDE.md` §21). Le repli de `Suspense` est déjà posé par `App`.
 */
const Carnet = lazy(async () => ({ default: (await import('./Carnet')).Carnet }))

// `CRM-061` — l'écran de la journée, chargé À LA DEMANDE comme le carnet et l'inbox : il n'est pas
// sur le chemin du premier rendu, et son module tire `Intl.DateTimeFormat` et la lecture des cards.
const MaJournee = lazy(async () => ({ default: (await import('./MaJournee')).MaJournee }))

/**
 * L'écran des affaires figées — `CRM-062` tranche 3c, `docs/SPEC-relances.md` §10.4.
 *
 * Chargé à la demande, pour le motif exact du carnet, de l'inbox et de « Ma journée » : un écran
 * que la plupart des sessions n'ouvrent pas n'a pas à peser sur le premier rendu de toutes les
 * autres (`CLAUDE.md` §21). Le repli de `Suspense` est déjà posé par `App`.
 */
const AffairesFigees = lazy(async () => ({
	default: (await import('./AffairesFigees')).AffairesFigees,
}))

/**
 * La liste des tableaux d'objectifs — `CRM-083`, `docs/SPEC-goals.md` §5.1. Chargée à la demande
 * pour le motif exact du carnet et de l'inbox : un écran que la plupart des sessions n'ouvrent pas
 * n'a pas à peser sur le premier rendu de toutes les autres (`CLAUDE.md` §21).
 */
const Objectifs = lazy(async () => ({ default: (await import('./Objectifs')).Objectifs }))

/**
 * Le cumul des coûts du workspace — `CRM-086` tranche 5, `docs/SPEC-costs.md` §4.5. Chargé à la
 * demande pour le motif exact des deux autres écrans de coûts : il emporte l'histogramme, que les
 * sessions qui n'ouvrent jamais les coûts n'ont pas à télécharger (`CLAUDE.md` §21).
 *
 * Contrairement à `CoutsTrack` et `CoutsBudget`, il ne porte PAS sa propre coquille : son titre est
 * une clé de traduction et son contenu ne dépend d'aucun paramètre d'adresse, si bien que la
 * coquille commune de `ROUTES` suffit (§4.0).
 */
const CoutsWorkspace = lazy(async () => ({
	default: (await import('./CoutsWorkspace')).CoutsWorkspace,
}))

/**
 * Titre de la route d'administration — `CRM-075`.
 *
 * Son adresse ne figure PAS dans `ROUTES`, et c'est une contrainte tenue par une assertion : cette
 * table doit couvrir **exactement** les entrées de navigation transverses, sans orpheline dans un
 * sens ni dans l'autre. L'administration n'est pas une entrée de la barre latérale — on y arrive
 * par l'index des réglages —, elle suit donc le patron employé par `CHEMIN_CARD` et `CHEMIN_LISTE` :
 * une adresse nommée dans `chemins.ts`, montée par `App` avec sa propre coquille.
 */
export const CLE_TITRE_ADMIN_ARBORESCENCE: CleTraduction = 'admin.tree.title'

/** Titre de l'éditeur de workflows — `CRM-076`, même patron (docs/SPEC-workflow-engine.md §7 bis.2). */
export const CLE_TITRE_ADMIN_WORKFLOWS: CleTraduction = 'admin.workflows.title'

/**
 * Titre de l'administration du catalogue de nœuds — `CRM-030`, même patron
 * (docs/SPEC-workflow-engine.md §2 bis.2).
 */
export const CLE_TITRE_ADMIN_CATALOGUE: CleTraduction = 'admin.catalog.title'

/** Titre de l'état de la messagerie — `CRM-059`, même patron (docs/SPEC-mail-subsystem.md §20.11.1). */
export const CLE_TITRE_ETAT_MESSAGERIE: CleTraduction = 'admin.mail.title'

/**
 * Titre de la configuration des comptes entrants — `CRM-088`, même patron
 * (docs/SPEC-mail-subsystem.md §21.2).
 */
export const CLE_TITRE_COMPTES_MAIL: CleTraduction = 'admin.mailAccounts.title'

/** Titre de l'écran des identités d'expédition — `CRM-089`. */
export const CLE_TITRE_IDENTITES_MAIL: CleTraduction = 'admin.mailIdentities.title'

/** Titre de l'administration des modèles d'emails — `CRM-063`, sous-tranche 2b. */
export const CLE_TITRE_MODELES_MAIL: CleTraduction = 'admin.mailTemplates.title'

/** Titre de l'administration des séquences de relance — `CRM-063`, sous-tranche 4c. */
export const CLE_TITRE_SEQUENCES_MAIL: CleTraduction = 'admin.sequences.title'

/**
 * Titre de la corbeille — `CRM-077`, même patron que les trois autres (docs/SPEC-corbeille.md §4.1).
 * La corbeille est une vue du workspace, et non un onglet de chaque objet : un objet en corbeille
 * n'a plus de place dans les listes où il vivait.
 */
export const CLE_TITRE_CORBEILLE: CleTraduction = 'admin.trash.title'

/** `CRM-064` tranche 4 — `docs/DESIGN_SYSTEM.md` §5.45. */
export const CLE_TITRE_REGLAGES_NOTIFICATIONS: CleTraduction = 'settings.notifications.title'

/**
 * Titre du guide de démarrage — `CRM-079`, `docs/SPEC-onboarding.md` §4.1.
 *
 * Même patron que les quatre surfaces d'administration. Le guide est **toujours** rendu à son
 * adresse, même intégralement accompli et même masqué pour la session : c'est ce qui le rend
 * **relançable**, exigence explicite de la Definition of Done de l'unité.
 */
export const CLE_TITRE_DEMARRAGE: CleTraduction = 'onboarding.title'

/**
 * Titre du canevas d'un tableau — `CRM-083`, `docs/SPEC-goals.md` §5.2.
 *
 * Le canevas suit le patron de `CHEMIN_CARD` et de la fiche de contact : son adresse ne figure pas
 * dans `ROUTES`, la couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` restant ainsi inchangée. Le
 * titre porté par la coquille est cette clé ; le NOM du tableau, qui est une donnée, est rendu par
 * l'écran lui-même.
 */
export const CLE_TITRE_OBJECTIFS: CleTraduction = 'route.goals.title'

export const ROUTES: readonly DescriptionRoute[] = [
	{
		// `CRM-079` remplace l'état vide inconditionnel de `CRM-007` par l'accueil du guide de
		// démarrage : tant qu'une étape reste à faire, l'écran d'arrivée enseigne au lieu de
		// constater (docs/SPEC-onboarding.md §4.2). L'état vide reste le contenu légitime dès que
		// les cinq étapes sont accomplies.
		chemin: '/',
		cleTitre: 'route.board.title',
		rendu: () => <AccueilDemarrage />,
	},
	{
		// L'inbox globale de `CRM-057` remplace l'état vide de `CRM-007` : la messagerie est
		// raccordée, et l'écran montre désormais le courrier réellement reçu.
		chemin: CHEMIN_INBOX,
		cleTitre: 'route.inbox.title',
		rendu: () => <RouteInbox />,
	},
	{
		// Le carnet de contacts — `CRM-060`, `docs/SPEC-contacts.md` §10.2. Une entrée de navigation
		// transverse, aux côtés de l'Inbox : un contact est un objet métier de première classe
		// (`CLAUDE.md` §4), pas un réglage de structure.
		chemin: CHEMIN_CONTACTS,
		cleTitre: 'route.contacts.title',
		rendu: () => <Carnet />,
	},
	{
		// Les objectifs — `CRM-083`, `docs/SPEC-goals.md` §5.1 : « entrée de navigation
		// **« Objectifs »**, au même niveau que la messagerie ». C'est une entrée TRANSVERSE et
		// non une section des réglages, pour la raison qui a déjà placé le carnet hors des
		// réglages : un tableau d'objectifs n'administre rien, il porte le travail.
		chemin: CHEMIN_OBJECTIFS,
		cleTitre: 'route.goals.title',
		rendu: () => <Objectifs />,
	},
	{
		// Le cumul des coûts du workspace — `CRM-086`, `docs/SPEC-costs.md` §4.0 et §4.5. Une entrée
		// TRANSVERSE et non une section des réglages, pour la raison qui a déjà placé le carnet et
		// les objectifs hors des réglages : un histogramme de coûts n'administre rien, il porte le
		// travail. C'est la seule des trois adresses de coûts qui figure ici, les deux autres ayant
		// pour titre une donnée — le nom d'un track, le nom d'un budget.
		chemin: CHEMIN_COUTS_WORKSPACE,
		cleTitre: 'route.costs.workspace.title',
		rendu: () => <CoutsWorkspace />,
	},
	{
		// Ma journée — `CRM-061`, `docs/SPEC-cards.md` §17. L'adresse rendait un état vide
		// INCONDITIONNEL depuis `CRM-007` : une entrée de barre latérale qui ne menait nulle part,
		// alors que le modèle — `next_action`, `next_action_at` et leur index — est livré depuis
		// `CRM-040`. Elle porte désormais l'écran. Une route TRANSVERSE, au même titre que le carnet
		// et les objectifs : une journée de travail n'administre rien, elle porte le travail.
		chemin: CHEMIN_MA_JOURNEE,
		cleTitre: 'route.today.title',
		rendu: () => <MaJournee />,
	},
	{
		// Les affaires figées — `CRM-062` tranche 3c, `docs/SPEC-relances.md` §10.4. Une route
		// TRANSVERSE au même titre que le carnet, les objectifs, les coûts et « Ma journée » : une
		// liste d'affaires en retard n'administre rien, elle porte le travail. Elle vient
		// IMMÉDIATEMENT après « Ma journée », et le §10.4 dit pourquoi — les deux écrans répondent
		// à la même question et s'enseignent l'un après l'autre.
		chemin: CHEMIN_AFFAIRES_FIGEES,
		cleTitre: 'route.stalled.title',
		rendu: () => <AffairesFigees />,
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
				{/* Le guide vient en PREMIER — `CRM-079`, docs/SPEC-onboarding.md §4.3 : un guide de
				    démarrage se lit avant les écrans qu'il présente. */}
				<li>
					<Link
						to={CHEMIN_DEMARRAGE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.onboarding')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.onboarding.body')}</span>
					</Link>
				</li>
				<li>
					<Link
						to={CHEMIN_ADMIN_ARBORESCENCE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.tree')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.tree.body')}</span>
					</Link>
				</li>
				<li>
					<Link
						to={CHEMIN_ADMIN_WORKFLOWS}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.workflows')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.workflows.body')}</span>
					</Link>
				</li>
				{/* Le catalogue vient APRÈS les workflows — `CRM-030`,
				    docs/SPEC-workflow-engine.md §2 bis.2 : on découvre l'éditeur avant le
				    vocabulaire qu'il emploie. */}
				<li>
					<Link
						to={CHEMIN_ADMIN_CATALOGUE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.catalog')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.catalog.body')}</span>
					</Link>
				</li>
				{/* La configuration vient AVANT l'état — `CRM-088`,
				    docs/SPEC-mail-subsystem.md §21.2 : on configure une boîte avant d'en
				    superviser la relève. */}
				<li>
					<Link
						to={CHEMIN_ADMIN_COMPTES_MAIL}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.mailAccounts')}</span>
						<span className="text-sm text-text-2">
							{t('admin.settings.index.mailAccounts.body')}
						</span>
					</Link>
				</li>
				{/* Les identités d'expédition viennent APRÈS les comptes entrants et AVANT
				    l'état — `CRM-089`, docs/SPEC-mail-subsystem.md §22.2 : on reçoit avant
				    d'expédier, et on configure avant de superviser. */}
				<li>
					<Link
						to={CHEMIN_ADMIN_IDENTITES_MAIL}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.mailIdentities')}</span>
						<span className="text-sm text-text-2">
							{t('admin.settings.index.mailIdentities.body')}
						</span>
					</Link>
				</li>
				{/* Les modèles d'emails viennent APRÈS les identités et AVANT l'état — `CRM-063`
				    sous-tranche 2b, docs/SPEC-modeles-emails.md §9.1 : on déclare l'expéditeur
				    avant d'écrire le texte qu'il expédiera, et on configure avant de superviser. */}
				<li>
					<Link
						to={CHEMIN_ADMIN_MODELES_MAIL}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.mailTemplates')}</span>
						<span className="text-sm text-text-2">
							{t('admin.settings.index.mailTemplates.body')}
						</span>
					</Link>
				</li>
				{/* Les séquences de relance viennent APRÈS les modèles et AVANT l'état — `CRM-063`
				    sous-tranche 4c, docs/SPEC-modeles-emails.md §13.4 : on écrit le texte avant la
				    cadence qui l'enchaîne, et on configure avant de superviser. */}
				<li>
					<Link
						to={CHEMIN_ADMIN_SEQUENCES_MAIL}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.sequences')}</span>
						<span className="text-sm text-text-2">
							{t('admin.settings.index.sequences.body')}
						</span>
					</Link>
				</li>
				<li>
					<Link
						to={CHEMIN_ETAT_MESSAGERIE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.mail')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.mail.body')}</span>
					</Link>
				</li>
				<li>
					<Link
						to={CHEMIN_CORBEILLE}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.trash')}</span>
						<span className="text-sm text-text-2">{t('admin.settings.index.trash.body')}</span>
					</Link>
				</li>
				{/* LES PRÉFÉRENCES VIENNENT EN DERNIER, ET C'EST UNE RÈGLE, PAS UN RESTE —
				    `CRM-064` tranche 4, `docs/DESIGN_SYSTEM.md` §5.45. Toutes les entrées
				    au-dessus administrent l'INSTANCE ; celle-ci règle le COMPTE de qui la
				    regarde, et c'est la première de cet index dans ce cas. La placer entre deux
				    sections d'administration mélangerait deux natures d'écran. */}
				<li>
					<Link
						to={CHEMIN_REGLAGES_NOTIFICATIONS}
						className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
					>
						<span className="font-medium">{t('admin.settings.index.notifications')}</span>
						<span className="text-sm text-text-2">
							{t('admin.settings.index.notifications.body')}
						</span>
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

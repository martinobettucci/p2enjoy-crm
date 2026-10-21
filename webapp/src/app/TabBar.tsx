// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — « Nouveau channel » rendu en texte citant son motif quand la base refuse
//       l'administration (docs/SPEC-droits-interface.md §3 ; docs/DESIGN_SYSTEM.md §5.59)
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
//
// @spec CRM-086 (docs/BACKLOG.md) — l'entrée « Coûts » du track (docs/SPEC-costs.md §4.0, §4.2)
//
// LA BARRE PORTE DÉSORMAIS UNE ENTRÉE QUI N'EST PAS UN CHANNEL, et c'est une règle nouvelle du
// design system (§4, §12.1). L'écran de coûts du §4.2 porte sur le TRACK entier, pas sur l'un de
// ses channels : sa place est donc auprès des onglets et non dans l'un d'eux. Deux conséquences,
// et aucune n'est cosmétique :
//
//   * l'entrée est SÉPARÉE des channels par un filet, et vit dans sa propre `nav` étiquetée. Les
//     mêler ferait lire « Coûts » comme un channel de plus, sur une barre où tout le reste en est
//     un ;
//   * elle est rendue MÊME quand le track n'a aucun channel. L'état vide de la barre disait
//     jusqu'ici tout ce qu'elle avait à dire ; ce n'est plus vrai — un track sans channel a
//     parfaitement des budgets, et le §4.7 traite cet écran-là comme les autres.
//
// @spec CRM-100 (docs/BACKLOG.md) tranche T1 — la commande « Nouveau channel » (docs/SPEC-administration-arborescence.md
//       §13.3 ; docs/DESIGN_SYSTEM.md §5.55 ; docs/JOURNAL.md décision 623)
//
// LA BARRE PORTE UNE COMMANDE, ET CE N'EST PAS UN ONGLET. Elle vient après les channels, dont elle est la fin, et
// avant le filet des entrées transverses, qui portent sur le track entier. C'est un LIEN — elle ouvre le formulaire en
// écrivant `nouveau-channel=1` dans l'adresse —, mais elle n'a ni bordure basse ni `aria-current` : rien ne la lit
// comme la page courante. Pendant la saisie, elle quitte la barre (§5.50 : la commande et le formulaire s'excluent).
//
// @spec CRM-105 (docs/BACKLOG.md) — la description d'un channel en infobulle sous son onglet
//       (docs/DESIGN_SYSTEM.md §5.58, docs/SPEC-channels.md §5, décision 629)

import { Link, NavLink, useLocation } from 'react-router'
import { ChartColumn, Plus } from 'lucide-react'
import { Infobulle } from '../components/ui/Infobulle'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { Channel } from '../lib/channels'
import {
	PARAM_NOUVEAU_CHANNEL,
	VALEUR_NOUVEAU_CHANNEL_TRACK,
	cheminOuvertureNouveauChannel,
	estVueTrack,
} from '../lib/nouveau-channel'
import { cheminCoutsTrack } from './chemins'
import { useContexteEspace } from './ContexteEspace'

/** Le motif de « Nouveau channel » refusé, porté par le texte lui-même (CRM-093). */
const ID_MOTIF_NOUVEAU_CHANNEL = 'nouveau-channel-lecture-seule'

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

	// Hors d'une route de track, il n'y a ni channel ni coûts à proposer : l'état vide reste seul,
	// exactement comme avant `CRM-086`.
	if (slugTrack === undefined) {
		return (
			<div className="flex items-center gap-2 py-2" aria-label={t('tabs.aria')}>
				<span data-testid="onglets-vides" className="text-sm text-text-3 whitespace-nowrap">
					{t('tabs.empty')}
				</span>
				<span className="sr-only">{t('tabs.empty.hint')}</span>
			</div>
		)
	}

	// Un track sans channel garde son état vide — l'information reste vraie —, mais il porte
	// désormais l'entrée transverse à côté : ses budgets existent indépendamment de ses channels.
	if (channels.length === 0) {
		return (
			<>
				<div className="flex items-center gap-2 py-2" aria-label={t('tabs.aria')}>
					<span data-testid="onglets-vides" className="text-sm text-text-3 whitespace-nowrap">
						{t('tabs.empty')}
					</span>
					<span className="sr-only">{t('tabs.empty.hint')}</span>
				</div>
				<CommandeNouveauChannel slugTrack={slugTrack} />
				<EntreesTransversesTrack slugTrack={slugTrack} />
			</>
		)
	}

	return (
		<>
			{/* `shrink-0` ET NON `min-w-0`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE
			    (`CLAUDE.md` §16, décision 476). Tant que la barre ne portait que ce groupe, le
			    laisser rétrécir était sans conséquence : il était seul, et le conteneur défilait.
			    Avec l'entrée transverse à côté, `min-w-0` autorisait le groupe des channels à se
			    comprimer sous la largeur de ses onglets, dont le dernier venait alors se SUPERPOSER
			    à « Coûts » — mesuré à 390 px, où « Appels d'offres » et « Coûts » se dessinaient l'un
			    sur l'autre. La réponse d'une barre au manque de place est de DÉFILER dans son
			    conteneur (`docs/DESIGN_SYSTEM.md` §7 et §12.6), ce que celui-ci fait déjà, et jamais
			    d'écraser son contenu. */}
			<nav aria-label={t('tabs.aria')} className="shrink-0">
			<ul className="flex items-center gap-1">
				{channels.map((channel) => (
					<li key={channel.id}>
						{/* L'infobulle porte le nom en tête et REMPLACE alors le `title` (§5.58). */}
						<Infobulle titre={channel.name} description={channel.description}>
						{({ idDescription }) => (
						<NavLink
							to={`/tracks/${slugTrack}/${channel.slug}`}
							data-testid="onglet-channel"
							data-slug={channel.slug}
							title={idDescription === undefined ? channel.name : undefined}
							aria-describedby={idDescription}
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
						)}
						</Infobulle>
					</li>
				))}
			</ul>
			</nav>
			<CommandeNouveauChannel slugTrack={slugTrack} />
			<EntreesTransversesTrack slugTrack={slugTrack} />
		</>
	)
}

/**
 * « Nouveau channel » — `CRM-100`, docs/SPEC-administration-arborescence.md §13.3, docs/DESIGN_SYSTEM.md §5.55.
 *
 * Rendue à tous les rôles : la base refuse la création à qui n'est pas administrateur, et le formulaire traduit le
 * refus (§10 de la même spécification). Absente pendant la saisie, c'est-à-dire quand une vue de track porte le
 * formulaire ouvert ; sur l'écran des coûts ou la fiche d'une affaire, elle mène à la racine du track.
 */
function CommandeNouveauChannel({ slugTrack }: { readonly slugTrack: string }) {
	const { pathname, search } = useLocation()
	const { capacites } = useContexteEspace()
	const formulaireOuvert =
		estVueTrack(pathname) &&
		new URLSearchParams(search).get(PARAM_NOUVEAU_CHANNEL) === VALEUR_NOUVEAU_CHANNEL_TRACK
	if (formulaireOuvert) return null
	// `CRM-093` — refusée par la base, l'administration rend le lien en TEXTE, même icône et même libellé (§5.59). Un
	// bandeau sur chaque page de track serait du bruit : le motif est porté par une description accessible et par
	// l'infobulle native du texte — écart borné, écrit au §5.59.
	if (capacites.administration === 'refusee' || capacites.administration === 'en-lecture') {
		const refusee = capacites.administration === 'refusee'
		return (
			<span
				data-testid="commande-nouveau-channel"
				aria-disabled="true"
				{...(refusee ? { 'aria-describedby': ID_MOTIF_NOUVEAU_CHANNEL, title: t('rights.readonly.administration') } : {})}
				className="shrink-0 inline-flex items-center gap-2 px-3 whitespace-nowrap rounded-sm min-h-[var(--size-target)] text-text-2"
			>
				<Plus aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
				{t('tabs.newChannel')}
				{refusee ? (
					<span id={ID_MOTIF_NOUVEAU_CHANNEL} className="sr-only">
						{t('rights.readonly.administration')}
					</span>
				) : null}
			</span>
		)
	}
	return (
		<Link
			to={cheminOuvertureNouveauChannel(pathname, search, slugTrack)}
			data-testid="commande-nouveau-channel"
			className={[
				'shrink-0 inline-flex items-center gap-2 px-3 whitespace-nowrap rounded-sm',
				'min-h-[var(--size-target)] text-text-2 hover:bg-hover',
				'transition-colors duration-[var(--transition-duration-fast)]',
			].join(' ')}
		>
			<Plus aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
			{t('tabs.newChannel')}
		</Link>
	)
}

/**
 * Les entrées de la barre qui portent sur le TRACK et non sur l'un de ses channels — `CRM-086`.
 *
 * Une seule aujourd'hui, et c'est un état exact : le §4.3 et le §4.5 de `docs/SPEC-costs.md`
 * décrivent deux autres écrans, dont l'un s'atteint depuis celui-ci et l'autre depuis la barre
 * latérale. Le groupe existe néanmoins dès la première entrée, parce que c'est LUI qui porte la
 * distinction avec les channels — sans lui, « Coûts » serait un onglet de plus.
 *
 * Le filet est un `border-l` sur le groupe, jamais un séparateur en `li` : un élément de liste qui
 * ne porte aucun texte serait annoncé comme une entrée vide (§8).
 *
 * L'icône est `aria-hidden` et le libellé est écrit à côté d'elle : le §9 réserve les icônes à
 * l'accompagnement d'un libellé, jamais à son remplacement.
 */
function EntreesTransversesTrack({ slugTrack }: { readonly slugTrack: string }) {
	return (
		<nav
			aria-label={t('tabs.track.aria')}
			className="min-w-0 pl-2 ml-1 border-l border-border shrink-0"
		>
			<NavLink
				to={cheminCoutsTrack(slugTrack)}
				data-testid="onglet-couts-track"
				className={({ isActive }) =>
					[
						'inline-flex items-center gap-2 px-3 whitespace-nowrap',
						'min-h-[var(--size-target)]',
						// La même bordure basse que les onglets de channel, et pour son motif exact : la
						// couleur ne porte jamais seule l'état actif (§1), et les deux états portent une
						// bordure de même épaisseur pour que le texte ne se décale pas.
						'border-b-2',
						isActive
							? 'border-brand text-brand font-medium'
							: 'border-transparent text-text-2 hover:bg-hover',
						'transition-colors duration-[var(--transition-duration-fast)]',
					].join(' ')
				}
			>
				<ChartColumn aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
				{t('tabs.track.costs')}
			</NavLink>
		</nav>
	)
}

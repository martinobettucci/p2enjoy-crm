// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — les onglets et leurs commandes mènent dans l'espace courant (§15.3) ; docs/SPEC-espace-courant.md
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
// @spec CRM-116 (docs/BACKLOG.md) tranche T3 — la pastille de couleur de l'onglet d'un channel (docs/DESIGN_SYSTEM.md
//       §5.68 ; docs/SPEC-channels.md §5)
//
// LA BARRE PORTE UNE COMMANDE, ET CE N'EST PAS UN ONGLET. Elle vient après les channels, dont elle est la fin, et
// avant le filet des entrées transverses, qui portent sur le track entier. C'est un LIEN — elle ouvre le formulaire en
// écrivant `nouveau-channel=1` dans l'adresse —, mais elle n'a ni bordure basse ni `aria-current` : rien ne la lit
// comme la page courante. Pendant la saisie, elle quitte la barre (§5.50 : la commande et le formulaire s'excluent).
//
// @spec CRM-131 (docs/BACKLOG.md) — hors d'un track, « Aucun channel » seulement si la personne n'en lit aucun ;
//       sinon « Ouvrez un track pour voir ses channels » (docs/SPEC-channels.md §5.5 ; docs/DESIGN_SYSTEM.md §4 ;
//       décisions 866 et 868)
// @spec CRM-105 (docs/BACKLOG.md) — la description d'un channel en infobulle sous son onglet
//       (docs/DESIGN_SYSTEM.md §5.58, docs/SPEC-channels.md §5, décision 629)
// @spec CRM-134 (docs/BACKLOG.md) tranche T1 — le groupe « Archivés » de la barre, après les onglets et avant
//       « Nouveau channel » : un bouton qui déplie le panneau sur la vue d'un track, un lien ailleurs ; absent sans archivé
//       (docs/SPEC-channels.md §11.3 ; docs/DESIGN_SYSTEM.md §5.101 ; décision 919)
// @spec CRM-154 (docs/BACKLOG.md) tranche T4 — réorganiser les channels depuis la barre : la poignée de chaque onglet (glisser
//       à la souris, mode déplacement au clavier), « Réorganiser » vers l'arborescence, l'appel et ses refus sous la barre
//       (docs/SPEC-administration-arborescence.md §15.4 ; docs/DESIGN_SYSTEM.md §5.106 ; décisions 935 et 938)

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useLocation } from 'react-router'
// `CRM-161` T2.a (docs/SPEC-espace-courant.md §15.3) : les liens et la navigation de cet écran d'un espace mènent dans
// l'espace courant.
import { LienEspace as Link, NavLienEspace as NavLink, useNaviguerEspace as useNavigate } from './LienEspace'
import { Archive, ArrowLeftRight, ChartColumn, ChevronDown, ChevronRight, GripVertical, Plus, TriangleAlert } from 'lucide-react'
import { Infobulle } from '../components/ui/Infobulle'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import {
	archivesDepliees,
	cheminArchivesTrack,
	groupeEstUnBouton,
	ID_PANNEAU_ARCHIVES,
	rechercheAvecArchives,
} from '../lib/archives-channels'
import type { EtatAsync } from '../lib/async'
import { lireChannels, type Channel } from '../lib/channels'
import {
	cheminReorganiser,
	deplacerSaisie,
	insertionAuSurvol,
	ordreApresPose,
	ordreAPoser,
	rangDePose,
	rangSaisi,
	reorganiserChannels,
	saisir,
	type Saisie,
} from '../lib/reorganisation-channels'
import { clientCrm } from '../lib/supabase'
import type { PresenceChannels } from '../lib/demarrage'
import {
	PARAM_NOUVEAU_CHANNEL,
	VALEUR_NOUVEAU_CHANNEL_TRACK,
	cheminOuvertureNouveauChannel,
	estVueTrack,
} from '../lib/nouveau-channel'
import { cheminCoutsTrack } from './chemins'
import { classesPastille, jetonCouleur } from './presentation-tracks'
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
	/**
	 * Hors d'un track seulement : la présence de channels lisibles, mesurée par la coquille (`CRM-131`). Absente
	 * sans session : la barre garde « Aucun channel », comme depuis `CRM-007`.
	 */
	readonly presenceHorsTrack?: PresenceChannels
	/**
	 * `CRM-134` — les archivés du track, lus avec ses onglets (docs/SPEC-channels.md §11.1). Vide ou absent : pas de
	 * groupe « Archivés ».
	 */
	readonly archives?: readonly Channel[]
	/** `CRM-154` — l'identifiant du track ouvert : la réorganisation et « Réorganiser » en ont besoin. */
	readonly idTrack?: string
	/** `CRM-154` — relire le contenu du track quand la liste des channels a changé entre-temps (§15.4). */
	readonly onRelire?: () => void
}

const AUCUN_ARCHIVE: readonly Channel[] = []

export function TabBar({
	etat,
	slugTrack,
	presenceHorsTrack,
	archives = AUCUN_ARCHIVE,
	idTrack,
	onRelire,
}: ProprietesTabBar) {
	// `CRM-154` (§15.4) : le refus d'une réorganisation s'écrit SOUS la barre, hors de son conteneur qui défile ; il
	// s'efface au geste suivant ou en quittant le track.
	const [refus, setRefus] = useState<string | null>(null)
	useEffect(() => {
		setRefus(null)
	}, [slugTrack])
	return (
		<>
			<div
				data-testid="barre-onglets"
				// Le débordement se fait dans le conteneur, jamais dans la page
				// (docs/DESIGN_SYSTEM.md §7), et il est **signalé** — §4 : « défilable, jamais tronqué
				// sans indication ». Défaut vu sur la capture à 390 px (docs/DESIGN_SYSTEM.md §12.6).
				className="flex items-center gap-2 px-4 bg-bg border-b border-border overflow-x-auto indique-debordement-x"
			>
				<Contenu
					etat={etat}
					slugTrack={slugTrack}
					presenceHorsTrack={presenceHorsTrack}
					archives={archives}
					{...(idTrack === undefined ? {} : { idTrack })}
					{...(onRelire === undefined ? {} : { onRelire })}
					onRefus={setRefus}
				/>
			</div>
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="reorganisation-refus"
					className="flex items-start gap-2 mx-4 mt-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
					<span>{refus}</span>
				</p>
			)}
		</>
	)
}

function Contenu({
	etat,
	slugTrack,
	presenceHorsTrack,
	archives = AUCUN_ARCHIVE,
	idTrack,
	onRelire,
	onRefus,
}: ProprietesTabBar & { readonly onRefus: (refus: string | null) => void }) {
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

	// Hors d'une route de track, il n'y a ni channel ni coûts à proposer. Depuis `CRM-131`, « Aucun channel »
	// n'y paraît que si la personne n'en lit réellement aucun ; sinon — et pendant la mesure, ou si elle a
	// échoué — un texte neutre, vrai dans tous les cas (docs/SPEC-channels.md §5.5).
	if (slugTrack === undefined && presenceHorsTrack !== undefined && presenceHorsTrack !== 'aucun') {
		return (
			<div className="flex items-center gap-2 py-2" aria-label={t('tabs.aria')}>
				<span data-testid="onglets-choisir" className="text-sm text-text-3 whitespace-nowrap">
					{t('tabs.pick')}
				</span>
			</div>
		)
	}
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
				<GroupeArchives slugTrack={slugTrack} archives={archives} />
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
			<OngletsChannels
				channels={channels}
				slugTrack={slugTrack}
				{...(idTrack === undefined ? {} : { idTrack })}
				{...(onRelire === undefined ? {} : { onRelire })}
				onRefus={onRefus}
			/>
			<GroupeArchives slugTrack={slugTrack} archives={archives} />
			<CommandeNouveauChannel slugTrack={slugTrack} />
			{idTrack !== undefined && channels.length >= 2 ? <CommandeReorganiser idTrack={idTrack} /> : null}
			<EntreesTransversesTrack slugTrack={slugTrack} />
		</>
	)
}

/**
 * `CRM-154` (§15.4) — la poignée n'est rendue qu'avec un pointeur fin : le glisser-déposer natif ne fonctionne pas sur un
 * écran tactile, où « Réorganiser » est le chemin. Sans `matchMedia` (une preuve hors navigateur), le pointeur est
 * supposé fin.
 */
const REQUETE_POINTEUR_FIN = '(hover: hover) and (pointer: fine)'
function usePointeurFin(): boolean {
	const lire = () =>
		typeof window === 'undefined' || typeof window.matchMedia !== 'function'
			? true
			: window.matchMedia(REQUETE_POINTEUR_FIN).matches
	const [fin, setFin] = useState(lire)
	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
		const requete = window.matchMedia(REQUETE_POINTEUR_FIN)
		const suivre = () => setFin(requete.matches)
		requete.addEventListener('change', suivre)
		return () => requete.removeEventListener('change', suivre)
	}, [])
	return fin
}

type ProprietesOnglets = {
	readonly channels: readonly Channel[]
	readonly slugTrack: string
	readonly idTrack?: string
	readonly onRelire?: () => void
	readonly onRefus: (refus: string | null) => void
}

/**
 * Les onglets des channels — `CRM-021`, et depuis `CRM-154` (§15.4) réorganisables par qui administre l'espace.
 *
 * L'ORDRE AFFICHÉ est celui de l'hôte, sauf pendant un geste (glisser, saisie au clavier, appel en vol) et après un succès :
 * la barre relit alors elle-même l'ordre en base et le tient tant que l'hôte n'a pas relu sa liste — relire l'hôte
 * remettrait toute la zone principale en squelette. Un ordre tenu ne vaut que pour la liste de l'hôte qu'il a vue.
 */
function OngletsChannels({ channels, slugTrack, idTrack, onRelire, onRefus }: ProprietesOnglets) {
	const { capacites } = useContexteEspace()
	const pointeurFin = usePointeurFin()
	// Glisser n'a pas de forme désactivée : refusée ou en lecture, la capacité ne rend pas la poignée ; inconnue — un
	// défaut de lecture —, elle la rend, la base refusant si besoin (docs/SPEC-droits-interface.md §4).
	const reorganisable =
		idTrack !== undefined &&
		clientCrm !== null &&
		pointeurFin &&
		channels.length >= 2 &&
		(capacites.administration === 'permise' || capacites.administration === 'inconnue')

	const [tenu, setTenu] = useState<{ readonly base: readonly Channel[]; readonly ordre: readonly string[] } | null>(null)
	const [saisie, setSaisie] = useState<Saisie | null>(null)
	const [glisse, setGlisse] = useState<string | null>(null)
	const [insertion, setInsertion] = useState<number | null>(null)
	const [enVol, setEnVol] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const poignees = useRef(new Map<string, HTMLButtonElement>())
	const aRefocaliser = useRef<string | null>(null)
	const idConsignes = useId()

	const ordreHote = channels.map((channel) => channel.id)
	const ordreTenu = tenu !== null && tenu.base === channels ? tenu.ordre : null
	const ordreCourant = saisie?.ordre ?? ordreTenu ?? ordreHote
	const parId = new Map(channels.map((channel) => [channel.id, channel]))
	const affiches = ordreCourant.map((id) => parId.get(id)).filter((channel): channel is Channel => channel !== undefined)
	const nom = (id: string) => parId.get(id)?.name ?? ''

	// Le focus suit la poignée de l'onglet déplacé : un nœud déplacé dans le DOM perd le focus.
	useLayoutEffect(() => {
		const id = aRefocaliser.current
		if (id === null) return
		aRefocaliser.current = null
		poignees.current.get(id)?.focus()
	})

	const poser = useCallback(
		async (id: string, ordre: readonly string[], precedent: readonly string[]) => {
			if (idTrack === undefined || clientCrm === null) return
			const client = clientCrm
			onRefus(null)
			setTenu({ base: channels, ordre })
			setEnVol(true)
			aRefocaliser.current = id
			const resultat = await reorganiserChannels(client, idTrack, ordre)
			if (resultat.statut === 'refus') {
				setTenu({ base: channels, ordre: precedent })
				const nature = resultat.refus.nature
				const texte =
					nature === 'forbidden'
						? t('tabs.move.refus.forbidden')
						: nature === 'ordre-perime'
							? t('tabs.move.refus.stale')
							: t('tabs.move.refus.error')
				onRefus(texte)
				setAnnonce(texte)
				setEnVol(false)
				aRefocaliser.current = id
				if (nature === 'ordre-perime') onRelire?.()
				return
			}
			// L'ordre affiché vient de la base : relu, sans squelette.
			const relu = await lireChannels(client, idTrack)
			const ordreBase = relu.statut === 'pret' ? relu.donnees.channels.map((channel) => channel.id) : ordre
			setTenu({ base: channels, ordre: ordreBase })
			setAnnonce(
				t('tabs.move.saved', {
					channel: channels.find((channel) => channel.id === id)?.name ?? '',
					rang: String(ordreBase.indexOf(id) + 1),
					n: String(ordreBase.length),
				}),
			)
			setEnVol(false)
			aRefocaliser.current = id
		},
		[channels, idTrack, onRefus, onRelire],
	)

	const annuler = useCallback(
		(id: string) => {
			setSaisie(null)
			setAnnonce(t('tabs.move.cancelled'))
			aRefocaliser.current = id
		},
		[],
	)

	const auClavier = (evenement: KeyboardEvent<HTMLButtonElement>, id: string) => {
		if (enVol) return
		const touche = evenement.key
		if (saisie === null) {
			if (touche !== ' ' && touche !== 'Enter') return
			evenement.preventDefault()
			onRefus(null)
			const nouvelle = saisir(ordreCourant, id)
			setSaisie(nouvelle)
			setAnnonce(
				t('tabs.move.grabbed', { channel: nom(id), rang: String(rangSaisi(nouvelle)), n: String(nouvelle.ordre.length) }),
			)
			return
		}
		const pas =
			touche === 'ArrowLeft' ? -1 : touche === 'ArrowRight' ? 1 : touche === 'Home' ? 'debut' : touche === 'End' ? 'fin' : null
		if (pas !== null) {
			evenement.preventDefault()
			const suivante = deplacerSaisie(saisie, pas)
			if (suivante !== saisie) {
				aRefocaliser.current = id
				setSaisie(suivante)
				setAnnonce(t('tabs.move.rank', { rang: String(rangSaisi(suivante)), n: String(suivante.ordre.length) }))
			}
			return
		}
		if (touche === 'Escape') {
			evenement.preventDefault()
			annuler(id)
			return
		}
		if (touche === ' ' || touche === 'Enter') {
			evenement.preventDefault()
			const ordre = ordreAPoser(saisie)
			const depart = saisie.depart
			setSaisie(null)
			if (ordre === null) {
				setAnnonce(t('tabs.move.cancelled'))
				return
			}
			void poser(id, ordre, depart)
		}
	}

	// Le glisser : un état de survol UNIQUE pour la barre, éteint à la fin du glisser (docs/DESIGN_SYSTEM.md §5.2 bis).
	const survoler = (evenement: DragEvent<HTMLLIElement>, rang: number) => {
		if (glisse === null) return
		evenement.preventDefault()
		evenement.dataTransfer.dropEffect = 'move'
		const boite = evenement.currentTarget.getBoundingClientRect()
		setInsertion(insertionAuSurvol(rang, evenement.clientX, boite.left, boite.width))
	}
	const deposer = (evenement: DragEvent<HTMLLIElement>) => {
		if (glisse === null || insertion === null) return
		evenement.preventDefault()
		const id = glisse
		const ordre = ordreApresPose(ordreCourant, id, rangDePose(ordreCourant, id, insertion))
		setGlisse(null)
		setInsertion(null)
		if (ordre !== null) void poser(id, ordre, ordreCourant)
	}

	return (
		<nav aria-label={t('tabs.aria')} aria-busy={enVol ? 'true' : undefined} className="shrink-0">
			<LiveRegion libelle={t('live.tabs.aria')} message={annonce} />
			{reorganisable ? (
				<span id={idConsignes} className="sr-only">
					{t('tabs.move.instructions')}
				</span>
			) : null}
			<ul className="flex items-center gap-1">
				{affiches.map((channel, rang) => {
					const saisi = saisie?.id === channel.id
					const tire = glisse === channel.id
					return (
						<li
							key={channel.id}
							data-testid="element-onglet"
							data-slug={channel.slug}
							className={['relative flex items-center rounded-sm', tire ? 'bg-hover' : ''].join(' ')}
							{...(reorganisable
								? {
										onDragOver: (evenement: DragEvent<HTMLLIElement>) => survoler(evenement, rang),
										onDrop: deposer,
									}
								: {})}
						>
							{/* LE REPÈRE D'INSERTION : un trait de 2 px `--color-brand`, pleine hauteur, avant l'onglet — ou après le
							    dernier (§5.106). */}
							{insertion === rang && glisse !== null ? <RepereInsertion cote="avant" /> : null}
							{insertion === affiches.length && rang === affiches.length - 1 && glisse !== null ? (
								<RepereInsertion cote="apres" />
							) : null}
							{reorganisable ? (
								<button
									type="button"
									ref={(element) => {
										if (element === null) poignees.current.delete(channel.id)
										else poignees.current.set(channel.id, element)
									}}
									data-testid="poignee-onglet"
									aria-label={t('tabs.move.handle', { channel: channel.name })}
									aria-describedby={idConsignes}
									aria-pressed={saisi ? 'true' : 'false'}
									disabled={enVol}
									draggable={!enVol}
									onKeyDown={(evenement) => auClavier(evenement, channel.id)}
									onBlur={() => {
										// Le focus qui QUITTE la poignée annule ; un nœud déplacé, que l'effet refocalise, n'annule pas.
										if (saisi && aRefocaliser.current !== channel.id) annuler(channel.id)
									}}
									onDragStart={(evenement) => {
										onRefus(null)
										setSaisie(null)
										evenement.dataTransfer.effectAllowed = 'move'
										evenement.dataTransfer.setData('text/plain', channel.id)
										const element = evenement.currentTarget.closest('li')
										if (element !== null) evenement.dataTransfer.setDragImage(element, 20, 20)
										setGlisse(channel.id)
									}}
									onDragEnd={() => {
										setGlisse(null)
										setInsertion(null)
									}}
									className={[
										'inline-flex items-center justify-center shrink-0 rounded-sm',
										// Cible de 40 × 40 px (§8) : la hauteur du jeton, et la même largeur.
										'min-h-[var(--size-target)] min-w-[var(--size-target)]',
										// Saisie : le fond doux POUSSÉ À 22 % — vu en capture, celui à 10 % ne se détachait pas du fond teinté de la barre,
										// et l'état se confondait avec le seul focus (docs/DESIGN_SYSTEM.md §1, §5.106).
										saisi ? 'bg-brand-soft-strong text-brand' : 'text-text-3 hover:bg-hover',
										tire ? 'cursor-grabbing' : 'cursor-grab',
										'disabled:cursor-default',
										'transition-colors duration-[var(--transition-duration-fast)]',
									].join(' ')}
								>
									<GripVertical aria-hidden="true" size={16} strokeWidth={2} />
								</button>
							) : null}
							{/* L'infobulle porte le nom en tête et REMPLACE alors le `title` (§5.58). */}
							<Infobulle titre={channel.name} description={channel.description}>
							{({ idDescription }) => (
							<NavLink
								to={`/tracks/${slugTrack}/${channel.slug}`}
								data-testid="onglet-channel"
								data-slug={channel.slug}
								title={idDescription === undefined ? channel.name : undefined}
								aria-describedby={idDescription}
								// `CRM-154` : la poignée est la seule source d'un glisser ; le lien garde son comportement, mais ne se
								// tire pas — sans quoi le navigateur tirerait son adresse au-dessus des onglets.
								draggable={reorganisable ? false : undefined}
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
								{/* `CRM-116` (§5.68) : la pastille de la couleur du channel, `aria-hidden` — le nom porte l'information. Sa
								    couleur ne change pas avec l'état actif, que la bordure basse et le texte portent seuls. */}
								<span
									aria-hidden="true"
									data-testid="pastille-channel"
									data-couleur={jetonCouleur(channel.color)}
									className={`mr-[6px] size-2 shrink-0 rounded-full ${classesPastille(channel.color)}`}
								/>
								{channel.name}
							</NavLink>
							)}
							</Infobulle>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}

/** Le repère d'insertion d'un glisser (§5.106) : décoratif, l'annonce dit le résultat. */
function RepereInsertion({ cote }: { readonly cote: 'avant' | 'apres' }) {
	return (
		<span
			aria-hidden="true"
			data-testid="repere-insertion"
			className={[
				'absolute top-0 bottom-0 w-[2px] bg-brand pointer-events-none',
				cote === 'avant' ? 'left-0' : 'right-0',
			].join(' ')}
		/>
	)
}

/**
 * « Réorganiser » — `CRM-154`, §15.4, docs/DESIGN_SYSTEM.md §5.106. Un LIEN vers l'arborescence ouverte sur le track, de
 * la forme de « Nouveau channel » ; rendu à TOUS (décision 938) : qui n'administre pas consulte l'arborescence en
 * lecture seule, ses commandes éteintes avec leur motif.
 */
function CommandeReorganiser({ idTrack }: { readonly idTrack: string }) {
	return (
		<Link
			to={cheminReorganiser(idTrack)}
			data-testid="commande-reorganiser"
			className={[
				'shrink-0 inline-flex items-center gap-2 px-3 whitespace-nowrap rounded-sm',
				'min-h-[var(--size-target)] text-text-2 hover:bg-hover',
				'transition-colors duration-[var(--transition-duration-fast)]',
			].join(' ')}
		>
			<ArrowLeftRight aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
			{t('tabs.reorganize')}
		</Link>
	)
}

/** La forme commune du groupe, bouton ou lien : la commande du §5.55, sans bordure basse ni `aria-current`. */
const CLASSES_GROUPE_ARCHIVES = [
	'shrink-0 inline-flex items-center gap-2 px-3 whitespace-nowrap rounded-sm',
	'min-h-[var(--size-target)] text-text-2 hover:bg-hover',
	'transition-colors duration-[var(--transition-duration-fast)]',
].join(' ')

/**
 * « Archivés (n) » — `CRM-134`, docs/SPEC-channels.md §11.3, docs/DESIGN_SYSTEM.md §5.101.
 *
 * CE N'EST PAS UN ONGLET : il porte sur la liste des channels, dont il est la fin, comme « Nouveau channel » qu'il
 * précède. Sur la vue d'un track, un BOUTON qui déplie le panneau en écrivant `archives=1` dans l'adresse — une
 * préférence d'écran, ni cookie ni stockage (`CLAUDE.md` §11) — et qui porte `aria-expanded`. Ailleurs — la fiche d'une
 * affaire, les coûts —, la vue qui rend le panneau n'est pas là : un LIEN vers la racine du track, groupe déplié.
 * Absent sans archivé : « Archivés (0) » serait une commande sans objet.
 *
 * Il est rendu à TOUS les rôles : voir les archivés est une lecture, que la base consent à tout membre qui lit le track.
 */
function GroupeArchives({ slugTrack, archives }: { readonly slugTrack: string; readonly archives: readonly Channel[] }) {
	const { pathname, search } = useLocation()
	const navigate = useNavigate()
	if (archives.length === 0) return null
	const libelle = t('tabs.archives', { nombre: String(archives.length) })
	if (!groupeEstUnBouton(pathname)) {
		return (
			<Link to={cheminArchivesTrack(slugTrack)} data-testid="groupe-archives" className={CLASSES_GROUPE_ARCHIVES}>
				<Archive aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
				{libelle}
			</Link>
		)
	}
	const deplie = archivesDepliees(new URLSearchParams(search))
	// Le chevron suit la convention des dossiers de l'inbox : à droite replié, vers le bas déplié, sans rotation.
	const Chevron = deplie ? ChevronDown : ChevronRight
	return (
		<button
			type="button"
			data-testid="groupe-archives"
			aria-expanded={deplie}
			// Le panneau n'existe que déplié : la référence ne désigne jamais un élément absent.
			{...(deplie ? { 'aria-controls': ID_PANNEAU_ARCHIVES } : {})}
			onClick={() => {
				const recherche = rechercheAvecArchives(search, !deplie)
				navigate({ pathname, search: recherche === '' ? '' : `?${recherche}` })
			}}
			className={CLASSES_GROUPE_ARCHIVES}
		>
			<Archive aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
			{libelle}
			<Chevron aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
		</button>
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
				// `relative` CONFINE le motif `sr-only` (positionné en absolu) : sans ancêtre positionné, il s'échappait du
				// conteneur de défilement de la barre et élargissait le document à 390 px — mesuré par `channels.spec.ts`.
				className="relative shrink-0 inline-flex items-center gap-2 px-3 whitespace-nowrap rounded-sm min-h-[var(--size-target)] text-text-2"
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

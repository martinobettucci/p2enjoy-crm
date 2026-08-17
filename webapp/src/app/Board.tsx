// @spec CRM-041 (docs/BACKLOG.md) — board kanban : colonnes, glisser-déposer, menu de transitions
// @spec CRM-022 (docs/BACKLOG.md) — avatar du responsable embarqué sur la card
// @spec docs/SPEC-workflow-engine.md §7.3 (composition des colonnes), §7.4 (carte de card),
//       §7.5 (transitions atteignables), §7.6 (glisser-déposer), §7.7 (déplacement au clavier),
//       §7.8 (commentaire exigé, jamais optimiste), §7.9 (optimisme et retour arrière),
//       §7.10 (les sept refus), §7.11 (états, responsive, accessibilité)
// @spec docs/DESIGN_SYSTEM.md §5.1 (carte de card), §5.2 (colonne), §5.5 (boutons), §5.6 (badges),
//       §5.8 (états), §6 (glisser-déposer optimiste), §7 (paliers), §8 (accessibilité),
//       §9 (icônes Lucide), §12.6 (indication de débordement)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 b : la bascule du sommeil et la pastille compacte ;
//       tranche 2 d : le geste de sommeil dans le menu de la carte
// @spec docs/SPEC-cards.md §2.6 (ordre dans une colonne), §3.5 (adresse d'une card),
//       §16.12.4 (la bascule, portée par l'adresse), §16.12.7 (la carte porte la pastille compacte),
//       §16.13.1 (le menu devient celui des actions), §16.13.2 (les deux visages du geste),
//       §16.13.3 (ce que la carte devient après le geste), §16.13.4 (les refus),
//       §16.13.5 (ce que le board annonce)
// @spec docs/DESIGN_SYSTEM.md §5.3 quinquies (la barre de bascule et la pastille compacte),
//       §5.3 sexies (le menu des actions et le sommeil qui s'y loge)
//
// Ce composant **rend** ; il ne compose pas. Les colonnes, l'ordre, les cumuls, l'ancienneté et
// la classification des refus vivent dans `webapp/src/lib/board.ts`, où ils sont vérifiables sans
// navigateur. Le composant décide de l'apparence et du geste, jamais de la règle.
//
// Aucune règle d'accès n'est portée ici : ce que le board montre est ce que la RLS a consenti à
// rendre, et ce qu'il n'offre pas, `move_card` le refuse de son côté (CLAUDE.md §10).

import { CalendarClock, Clock, GripVertical, Moon, Sun, TriangleAlert } from 'lucide-react'
import { useCallback, useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, type TonBadge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import {
	BasculeSommeil,
	CLE_PRESET_SOMMEIL,
	PastilleSommeil,
	mentionSommeil,
} from '../components/ui/Sommeil'
import { t } from '../i18n'
import type { ModeSommeil } from '../lib/filtre-sommeil'
import {
	ECHEANCES_USUELLES,
	echeanceUsuelle,
	formaterEcheanceSommeil,
	mettreEnSommeil,
	reveiller,
	type IssueSommeil,
} from '../lib/sommeil-card'
import {
	appliquerDeplacement,
	appliquerSommeil,
	deplacerCard,
	remplacerCard,
	type CardBoard,
	type CarteBoard,
	type ColonneBoard,
	type CouleurNoeud,
	type ModeleBoard,
	type RefusDeplacement,
	type TransitionBoard,
} from '../lib/board'
import type { ClientCrm } from '../lib/supabase'

/**
 * Liseré supérieur de 3 px à la couleur du nœud (docs/DESIGN_SYSTEM.md §5.1).
 *
 * La correspondance vit à un seul endroit, avec un repli documenté vers `neutral` : la valeur
 * vient du backend, et un type ne garantit jamais une valeur (docs/SPEC-types.md). C'est le même
 * procédé que `presentation-tracks.ts` pour les pilules.
 *
 * `neutral` emploie `--color-text-3` et non `--color-border` — DÉFAUT TROUVÉ EN REGARDANT UNE
 * CAPTURE, pas en lisant un test. Écrit d'abord en `bg-border`, le liseré d'un nœud neutre était
 * **invisible** sur fond blanc : la carte de `Prospection` paraissait n'en porter aucun à côté de
 * celles de `Relance`, qui portaient le leur. `--color-text-3` est le jeton que le point neutre
 * d'un badge emploie déjà (`webapp/src/components/ui/Badge.tsx`) : un neutre discret, mais lisible.
 */
const LISERES: Readonly<Record<CouleurNoeud, string>> = {
	brand: 'bg-brand',
	success: 'bg-success',
	accent: 'bg-accent',
	danger: 'bg-danger',
	neutral: 'bg-text-3',
}

/** Ton du badge de compteur d'une colonne, par nature de son nœud (docs/DESIGN_SYSTEM.md §1). */
const TONS_KIND: Readonly<Record<string, TonBadge>> = {
	won: 'success',
	lost: 'danger',
}

/** Largeur d'une colonne : la forme du contenu attendu, pas un espacement de l'échelle fermée. */
const CLASSES_COLONNE = 'w-[288px] shrink-0 snap-start flex flex-col gap-3 min-w-0'

/**
 * Le lien de reprise du bandeau de refus — variante **secondaire** du §5.5, portée par un lien.
 *
 * Les couleurs sont posées explicitement : le bandeau écrit en `--color-danger-on-soft`, et un
 * lien qui en hériterait se lirait comme une partie du message d'erreur plutôt que comme le geste
 * qui le répare. La cible reste ≥ 40 px (§8), comme pour tout lien-commande du produit.
 */
const CLASSES_REPRISE = [
	'inline-flex items-center justify-center self-start',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-surface text-ink border border-border font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
].join(' ')

/**
 * Un montant se rend en **donnée technique** (docs/DESIGN_SYSTEM.md §2 et §5.7 bis) : monospace,
 * chiffres tabulaires. Le formatage est délégué à `Intl`, jamais construit par concaténation —
 * la place du symbole et le séparateur des milliers sont des règles de langue, pas de composant.
 */
function formaterMontant(montant: number, devise: string): string {
	try {
		return new Intl.NumberFormat('fr-FR', {
			style: 'currency',
			currency: devise,
			maximumFractionDigits: 0,
		}).format(montant)
	} catch {
		// Une devise que le navigateur ne connaît pas ne doit pas faire tomber l'écran : le
		// montant reste lisible, suivi du code que la base porte.
		return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant)} ${devise}`
	}
}

export type ProprietesBoard = {
	readonly modele: ModeleBoard
	/** Cards telles que le board les affiche, état optimiste compris. */
	readonly cards: readonly CardBoard[]
	readonly onCards: (cards: readonly CardBoard[]) => void
	readonly libellesChamps: ReadonlyMap<string, string>
	readonly client: ClientCrm | null
	readonly slugTrack: string
	readonly slugChannel: string
	/** Le mode courant de la bascule du sommeil (§16.12.4), lu de l'adresse par l'appelant. */
	readonly modeSommeil: ModeSommeil
	readonly onModeSommeil: (mode: ModeSommeil) => void
}

/**
 * Le board d'un channel.
 *
 * L'état des cards est **détenu par l'appelant** : le déplacement optimiste et son retour arrière
 * remplacent la liste entière, et un état interne au board serait réinitialisé à chaque
 * rechargement du contenu.
 */
export function Board({
	modele,
	cards,
	onCards,
	libellesChamps,
	client,
	slugTrack,
	slugChannel,
	modeSommeil,
	onModeSommeil,
}: ProprietesBoard) {
	const [idGlissee, setIdGlissee] = useState<string | null>(null)
	const [cibleSurvolee, setCibleSurvolee] = useState<string | null>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	// Le refus voyage AVEC l'affaire qu'il concerne : le bandeau doit composer l'adresse de sa
	// fiche pour offrir la reprise de la saisie (docs/SPEC-form-composer.md §4 ter.1), et le board
	// n'a aucune sélection courante à laquelle se raccrocher.
	const [refus, setRefus] = useState<{
		readonly idCard: string
		readonly refus: RefusDeplacement
	} | null>(null)
	const [annonce, setAnnonce] = useState('')
	/** Transition en attente de motif (§7.8) : le geste est suspendu, la card n'a pas bougé. */
	const [motifAttendu, setMotifAttendu] = useState<{
		readonly idCard: string
		readonly transition: TransitionBoard
	} | null>(null)

	const cardsParId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

	/**
	 * Début et fin d'un glissement. La fin éteint **aussi** l'indication de dépôt : c'est le seul
	 * endroit qui le fait, faute de pouvoir se fier à `dragleave` (voir la colonne ci-dessous).
	 */
	const glisser = useCallback((idCard: string | null) => {
		setIdGlissee(idCard)
		if (idCard === null) setCibleSurvolee(null)
	}, [])

	const executer = useCallback(
		async (idCard: string, transition: TransitionBoard, commentaire: string | null) => {
			if (client === null) return
			const avant = cards
			setRefus(null)
			setEnCours(idCard)
			// L'optimisme n'a pas lieu quand un motif était exigé : la card a déjà attendu la
			// saisie, la déplacer maintenant puis la remettre en place serait un clignotement.
			if (commentaire === null) onCards(appliquerDeplacement(cards, idCard, transition.versEtape.id))
			const resultat = await deplacerCard(
				client,
				idCard,
				transition.versEtape.id,
				commentaire,
				libellesChamps,
			)
			setEnCours(null)
			if (resultat.statut === 'ok') {
				onCards(remplacerCard(avant, resultat.card))
				setAnnonce(`${t('live.board.moved')} ${transition.versEtape.libelle}`)
				return
			}
			// Retour arrière **exact** : la liste d'avant le geste, jamais une reconstruction
			// (docs/DESIGN_SYSTEM.md §6, docs/SPEC-workflow-engine.md §7.9).
			onCards(avant)
			setRefus({ idCard, refus: resultat.refus })
			setAnnonce(t('live.board.refused'))
		},
		[cards, client, libellesChamps, onCards],
	)

	const demander = useCallback(
		(idCard: string, transition: TransitionBoard) => {
			if (transition.requiertCommentaire) {
				setRefus(null)
				setMotifAttendu({ idCard, transition })
				return
			}
			void executer(idCard, transition, null)
		},
		[executer],
	)

	/**
	 * Les deux gestes du sommeil, appelés depuis le menu d'une carte (§16.13.2).
	 *
	 * L'appel vit ICI plutôt que dans le menu pour la même raison que `executer` : la liste des
	 * cards est détenue par l'appelant du board, et c'est elle que le succès met à jour. Le menu,
	 * lui, reçoit l'issue en retour — il en tire sa mention et décide de rester ouvert ou non
	 * (§16.13.4), sans avoir à connaître le client ni la liste.
	 *
	 * AUCUN OPTIMISME (§16.13.3) : la carte ne bouge qu'après la réponse. Le déplacement, lui, est
	 * optimiste parce qu'il rend la main au geste suivant ; le sommeil fait **disparaître** sa
	 * carte, et une disparition qu'il faudrait annuler serait plus déroutante qu'une attente.
	 */
	const gesteSommeil = useCallback(
		async (idCard: string, until: string | null): Promise<IssueSommeil> => {
			// `until === null` n'est jamais émis par le board — les quatre échéances usuelles sont
			// toujours des dates —, et c'est ce qui distingue les deux gestes ici : réveiller, c'est
			// demander « plus d'échéance ».
			if (client === null) return 'reseau'
			const resultat =
				until === null
					? await reveiller(client, idCard)
					: await mettreEnSommeil(client, idCard, until)
			if (resultat.issue !== 'endormie' && resultat.issue !== 'reveillee') {
				setAnnonce(t(mentionSommeil(resultat.issue) ?? 'board.refusal.unknown'))
				return resultat.issue
			}
			onCards(appliquerSommeil(cards, idCard, resultat.ligne.snoozed_until))
			if (resultat.issue === 'reveillee') {
				setAnnonce(t('live.board.woken'))
				return resultat.issue
			}
			// Une échéance que `Date` ne sait pas lire n'est pas un sommeil au sens du prédicat
			// (§16.11.1) : la carte reste rendue, et annoncer « mise en sommeil » serait faux. Le
			// serveur n'en rend pas, mais le type ne le garantit pas — l'annonce dit alors que la
			// demande n'a pas produit ce qui était attendu, plutôt que d'inventer une date.
			const courte = formaterEcheanceSommeil(resultat.ligne.snoozed_until)
			setAnnonce(
				courte === null
					? t('board.refusal.unknown')
					: t('live.board.snoozed', { echeance: courte }),
			)
			return resultat.issue
		},
		[cards, client, onCards],
	)

	const deposer = useCallback(
		(colonne: ColonneBoard) => {
			setCibleSurvolee(null)
			const idCard = idGlissee
			setIdGlissee(null)
			if (idCard === null) return
			const card = cardsParId.get(idCard)
			if (card === undefined) return
			const transition = transitionDepuis(modele, card.current_step_id, colonne.etape.id)
			// Une colonne non atteignable n'est pas une cible de dépôt (§7.6) : le navigateur
			// refuse déjà le geste faute de `preventDefault`. Ce garde-fou existe pour le cas où
			// l'état de glissement aurait changé entre le survol et le dépôt.
			if (transition === undefined) return
			demander(idCard, transition)
		},
		[cardsParId, demander, idGlissee, modele],
	)

	return (
		<div className="flex flex-col gap-3 min-h-0">
			<LiveRegion libelle={t('live.board.aria')} message={annonce} />
			{/* LA PREMIÈRE BARRE DU BOARD, et elle ne porte que ce contrôle (§5.3 quinquies). Comme la
			    barre de filtres de la vue liste, elle reste rendue **y compris sur un board vide** :
			    elle est la cause possible de ce vide, et la masquer priverait l'utilisateur du seul
			    geste qui l'en sort. */}
			<div
				data-testid="barre-sommeil-board"
				role="group"
				aria-label={t('sommeil.barre.aria')}
				className="flex flex-wrap items-center gap-3"
			>
				<BasculeSommeil mode={modeSommeil} onMode={onModeSommeil} />
			</div>
			{refus === null ? null : (
				<BandeauRefus
					refus={refus.refus}
					cheminReprise={cheminReprise(slugTrack, slugChannel, refus.idCard, refus.refus)}
					onFermer={() => setRefus(null)}
				/>
			)}
			{motifAttendu === null ? null : (
				<SaisieMotif
					transition={motifAttendu.transition}
					onAnnuler={() => setMotifAttendu(null)}
					onValider={(motif) => {
						const attendu = motifAttendu
						setMotifAttendu(null)
						void executer(attendu.idCard, attendu.transition, motif)
					}}
				/>
			)}
			{/* Point de repère sémantique étiqueté (docs/DESIGN_SYSTEM.md §8), et conteneur du
			    défilement horizontal : la page ne défile jamais de ce côté (§7), et le débordement
			    est **signalé** par `.indique-debordement-x` — dont la portée annonçait nommément
			    « le board (`CRM-041`) » (§12.6). L'ancrage colonne par colonne sous 768 px est
			    obtenu par `scroll-snap`. */}
			<section
				aria-label={t('board.aria')}
				data-testid="board"
				className="overflow-x-auto indique-debordement-x snap-x snap-mandatory pb-3"
			>
				<ol className="flex gap-4 items-start min-w-0">
					{modele.colonnes.map((colonne) => (
						<Colonne
							key={colonne.etape.id}
							colonne={colonne}
							modele={modele}
							idGlissee={idGlissee}
							survolee={cibleSurvolee === colonne.etape.id}
							enCours={enCours}
							slugTrack={slugTrack}
							slugChannel={slugChannel}
							cardsParId={cardsParId}
							onSurvol={setCibleSurvolee}
							onGlisser={glisser}
							onDeposer={deposer}
							onTransition={demander}
							onSommeil={gesteSommeil}
						/>
					))}
				</ol>
			</section>
		</div>
	)
}

/** La transition déclarée d'une étape vers une autre, ou `undefined` s'il n'y en a pas (§7.5). */
function transitionDepuis(
	modele: ModeleBoard,
	depuisEtapeId: string,
	versEtapeId: string,
): TransitionBoard | undefined {
	return modele.colonnes
		.find((colonne) => colonne.etape.id === depuisEtapeId)
		?.transitions.find((transition) => transition.versEtape.id === versEtapeId)
}

function Colonne({
	colonne,
	modele,
	idGlissee,
	survolee,
	enCours,
	slugTrack,
	slugChannel,
	cardsParId,
	onSurvol,
	onGlisser,
	onDeposer,
	onTransition,
	onSommeil,
}: {
	readonly colonne: ColonneBoard
	readonly modele: ModeleBoard
	readonly idGlissee: string | null
	readonly survolee: boolean
	readonly enCours: string | null
	readonly slugTrack: string
	readonly slugChannel: string
	readonly cardsParId: ReadonlyMap<string, CardBoard>
	readonly onSurvol: (idEtape: string | null) => void
	readonly onGlisser: (idCard: string | null) => void
	readonly onDeposer: (colonne: ColonneBoard) => void
	readonly onTransition: (idCard: string, transition: TransitionBoard) => void
	readonly onSommeil: (idCard: string, until: string | null) => Promise<IssueSommeil>
}) {
	const glissee = idGlissee === null ? undefined : cardsParId.get(idGlissee)
	const atteignable =
		glissee !== undefined &&
		transitionDepuis(modele, glissee.current_step_id, colonne.etape.id) !== undefined

	return (
		<li
			data-testid="colonne"
			data-etape={colonne.etape.id}
			data-atteignable={atteignable ? 'oui' : 'non'}
			data-survolee={survolee ? 'oui' : 'non'}
			className={CLASSES_COLONNE}
			onDragOver={(evenement) => {
				// Une cible non atteignable n'appelle **pas** `preventDefault` : le dépôt est alors
				// refusé par le navigateur lui-même, le pointeur affiche l'interdit et aucun
				// `drop` n'est émis (§7.6). Le refus visuel ne coûte donc aucune comparaison au
				// moment du dépôt.
				if (!atteignable) return
				evenement.preventDefault()
				evenement.dataTransfer.dropEffect = 'move'
				onSurvol(colonne.etape.id)
			}}
			// AUCUN `onDragLeave`, ET C'EST UNE DÉGRADATION DU HARNAIS QUI L'A IMPOSÉ. La première
			// écriture y éteignait l'indication de dépôt. MESURÉ dans Chromium : `dragleave` remonte
			// des enfants, et son `relatedTarget` est **nul** pendant un glisser-déposer — il n'y a
			// donc aucun moyen de distinguer « le pointeur quitte la colonne » de « le pointeur
			// entre dans une carte de la colonne ». L'indication s'éteignait aussitôt allumée, ce
			// qui la rendait inobservable : la dégradation D7 passait inaperçue, et le clignotement
			// contredisait docs/DESIGN_SYSTEM.md §6.
			//
			// L'état de survol est **unique pour tout le board** : passer d'une colonne à l'autre
			// l'écrase, et la fin du glissement l'éteint (`onDragEnd` de la carte). Aucun événement
			// de sortie n'est nécessaire.
			onDrop={(evenement) => {
				if (!atteignable) return
				evenement.preventDefault()
				onDeposer(colonne)
			}}
		>
			<div
				className={[
					'sticky top-0 z-10 bg-bg rounded-sm px-3 py-2 flex flex-col gap-1',
					survolee ? 'outline-2 outline-dashed outline-brand' : '',
				].join(' ')}
			>
				<div className="flex items-center justify-between gap-2 min-w-0">
					<h3 className="truncate min-w-0" title={colonne.etape.libelle}>
						{colonne.etape.libelle}
					</h3>
					<Badge ton={TONS_KIND[colonne.etape.kind] ?? 'neutre'}>{colonne.cartes.length}</Badge>
				</div>
				{colonne.cumul === null ? null : (
					<code data-testid="cumul-colonne" className="text-text-2">
						{formaterMontant(colonne.cumul.montant, colonne.cumul.devise)}
					</code>
				)}
			</div>

			{colonne.cartes.length === 0 ? (
				<p data-testid="colonne-vide" className="text-sm text-text-3 px-3 py-4">
					{t('board.column.empty')}
				</p>
			) : (
				<ol className="flex flex-col gap-3 min-w-0">
					{colonne.cartes.map((carte) => (
						<CarteDeCard
							key={carte.card.id}
							carte={carte}
							couleur={colonne.etape.couleur}
							transitions={colonne.transitions}
							enCours={enCours === carte.card.id}
							slugTrack={slugTrack}
							slugChannel={slugChannel}
							onGlisser={onGlisser}
							onTransition={onTransition}
							onSommeil={onSommeil}
						/>
					))}
				</ol>
			)}
		</li>
	)
}

function CarteDeCard({
	carte,
	couleur,
	transitions,
	enCours,
	slugTrack,
	slugChannel,
	onGlisser,
	onTransition,
	onSommeil,
}: {
	readonly carte: CarteBoard
	readonly couleur: CouleurNoeud
	readonly transitions: readonly TransitionBoard[]
	readonly enCours: boolean
	readonly slugTrack: string
	readonly slugChannel: string
	readonly onGlisser: (idCard: string | null) => void
	readonly onTransition: (idCard: string, transition: TransitionBoard) => void
	readonly onSommeil: (idCard: string, until: string | null) => Promise<IssueSommeil>
}) {
	const { card } = carte
	return (
		<li
			data-testid="carte-card"
			data-card={card.id}
			data-en-cours={enCours ? 'oui' : 'non'}
			draggable
			onDragStart={(evenement) => {
				evenement.dataTransfer.effectAllowed = 'move'
				evenement.dataTransfer.setData('text/plain', card.id)
				onGlisser(card.id)
			}}
			onDragEnd={() => onGlisser(null)}
			className={[
				'bg-surface border border-border rounded-lg shadow-card overflow-hidden',
				'transition-shadow duration-[var(--transition-duration-fast)] hover:shadow-card-hover',
				enCours ? 'opacity-70' : '',
			].join(' ')}
		>
			<span aria-hidden="true" className={['block h-[3px]', LISERES[couleur]].join(' ')} />
			<div className="flex flex-col gap-2 p-3 min-w-0">
				<div className="flex items-start gap-2 min-w-0">
					<GripVertical aria-hidden="true" size={16} strokeWidth={2} className="text-text-3 shrink-0" />
					<Link
						to={`/tracks/${slugTrack}/${slugChannel}/cards/${card.id}`}
						className="text-ink font-medium line-clamp-2 min-w-0 hover:text-brand"
					>
						{card.title}
					</Link>
				</div>

				{card.amount === null ? null : (
					<code data-testid="montant-card" className="text-text-2">
						{formaterMontant(card.amount, card.currency)}
					</code>
				)}

				{card.next_action === null ? null : (
					<p className="flex items-start gap-2 text-sm text-text-2 min-w-0">
						<CalendarClock aria-hidden="true" size={14} strokeWidth={2} className="shrink-0 mt-1" />
						<span className="line-clamp-2 min-w-0">{card.next_action}</span>
					</p>
				)}

				{card.responsable === null ? null : (
					<div className="flex justify-end">
						<Avatar
							profil={card.responsable}
							taille={32}
							libelleAccessible={t('identity.owner.aria', {
								nom: card.responsable.full_name,
							})}
						/>
					</div>
				)}

				{/* LES DEUX PASTILLES VIVENT CÔTE À CÔTE (§16.12.7), sur une ligne qui passe à la
				    suivante plutôt que de déborder : une carte fait 288 px, et « 12 jours » suivi
				    d'une date ne tient pas toujours. Le conteneur n'existe que si l'une des deux a
				    quelque chose à dire — un `div` vide ajouterait un `gap` visible sous l'avatar. */}
				{carte.seuilJours === null && !carte.enSommeil ? null : (
					<div className="flex flex-wrap items-center gap-2">
						{carte.seuilJours === null ? null : (
							<p
								data-testid="anciennete"
								data-depassee={carte.ancienneteDepassee ? 'oui' : 'non'}
								className={[
									'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm w-fit',
									carte.ancienneteDepassee ? 'bg-danger-soft text-danger-on-soft' : 'bg-hover text-text-2',
								].join(' ')}
							>
								<Clock aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
								{/* Le nombre est une donnée, le reste une traduction : jamais de phrase
								    construite par concaténation dans le composant (CLAUDE.md §23). */}
								<span>
									{carte.joursDansEtape} {t('board.age.days')}
								</span>
							</p>
						)}
						{/* Le prédicat vient de la COMPOSITION, avec l'instant du filtre (§16.12.3) : le
						    rendu ne le rejuge pas. */}
						<PastilleSommeil enSommeil={carte.enSommeil} echeance={card.snoozed_until} />
					</div>
				)}

				<MenuCarte
					idCard={card.id}
					titreCard={card.title}
					transitions={transitions}
					desactive={enCours}
					enSommeil={carte.enSommeil}
					onTransition={onTransition}
					onSommeil={onSommeil}
				/>
			</div>
		</li>
	)
}

/**
 * Le menu des ACTIONS d'une carte : ses déplacements, puis son sommeil — §16.13.1, §5.3 sexies.
 *
 * Patron : un bouton `aria-expanded` révélant une **liste de boutons**. Le patron ARIA
 * `menu` / `menuitem` avec `tabindex` glissant est écarté pour le motif déjà écrit au §12.1 du
 * design system à propos des onglets — il retire la navigation par `Tab` que des boutons
 * ordinaires donnent naturellement.
 *
 * IL NE S'ÉTEINT PLUS QUAND L'ÉTAPE NE DÉCLARE AUCUNE TRANSITION, et c'est une mesure qui l'impose
 * (§16.13.1) : `Socle analytique — Vertuo`, à l'étape `Livré` du seed, n'a **aucune** transition
 * sortante. Son menu éteint la privait de tout geste, alors qu'une affaire livrée est précisément
 * celle qu'on range. La phrase « Aucun déplacement déclaré depuis cette étape » n'est pas perdue :
 * elle entre dans le menu, au lieu de tenir lieu de libellé à un bouton mort.
 */
function MenuCarte({
	idCard,
	titreCard,
	transitions,
	desactive,
	enSommeil,
	onTransition,
	onSommeil,
}: {
	readonly idCard: string
	readonly titreCard: string
	readonly transitions: readonly TransitionBoard[]
	readonly desactive: boolean
	readonly enSommeil: boolean
	readonly onTransition: (idCard: string, transition: TransitionBoard) => void
	readonly onSommeil: (idCard: string, until: string | null) => Promise<IssueSommeil>
}) {
	const idMenu = useId()
	const [ouvert, setOuvert] = useState(false)
	const [issue, setIssue] = useState<IssueSommeil | null>(null)
	/** La clé du geste en vol, `null` si aucun : elle éteint la section et nomme le bouton appuyé. */
	const [enVol, setEnVol] = useState<string | null>(null)

	const mention = mentionSommeil(issue)

	const jouer = useCallback(
		async (cle: string, until: string | null) => {
			setEnVol(cle)
			setIssue(null)
			const resultat = await onSommeil(idCard, until)
			setEnVol(null)
			setIssue(resultat)
			// LE MENU RESTE OUVERT SUR UN REFUS (§16.13.4) : le refermer effacerait le message avant
			// qu'il soit lu. Sur un succès il se referme — la carte disparaît ou prend sa pastille, et
			// le menu d'une carte disparue n'a rien à montrer.
			if (resultat === 'endormie' || resultat === 'reveillee') setOuvert(false)
		},
		[idCard, onSommeil],
	)

	return (
		<div
			className="flex flex-col gap-2"
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape' || !ouvert) return
				evenement.stopPropagation()
				setOuvert(false)
				// Le focus revient au déclencheur : le perdre renverrait l'utilisateur au début
				// du document (docs/DESIGN_SYSTEM.md §8).
				evenement.currentTarget.querySelector<HTMLButtonElement>('[data-testid="menu-transitions"]')?.focus()
			}}
		>
			<Button
				variante="secondaire"
				className="w-full"
				// L'IDENTIFIANT DE TEST EST CONSERVÉ : c'est le même dévoilement, qui porte désormais
				// deux sections. Le renommer réécrirait dix-neuf assertions de deux fichiers de preuve
				// qui n'ont rien à voir avec cette tranche (CLAUDE.md §1).
				data-testid="menu-transitions"
				// Un déplacement en vol interdit d'en commencer un second sur la même card : la
				// réponse de `move_card` remplace la ligne, et deux appels concurrents feraient
				// gagner le plus lent (docs/SPEC-workflow-engine.md §7.9). Le menu n'est PLUS éteint
				// pour une absence de transition — voir l'en-tête de ce composant.
				disabled={desactive}
				aria-expanded={ouvert}
				aria-controls={idMenu}
				aria-label={`${t('board.menu.open')} ${titreCard}`}
				onClick={() => setOuvert((precedent) => !precedent)}
			>
				{t('board.menu.open')}
			</Button>
			{!ouvert ? null : (
				<div id={idMenu} data-testid="menu-carte" className="flex flex-col gap-2">
					<p className="text-xs text-text-3">{t('board.menu.section.transitions')}</p>
					{transitions.length === 0 ? (
						<p data-testid="aucune-transition" className="text-sm text-text-2">
							{t('board.menu.none')}
						</p>
					) : (
						<ul data-testid="liste-transitions" className="flex flex-col gap-2">
							{transitions.map((transition) => (
								<li key={transition.id}>
									<Button
										variante="discret"
										className="w-full justify-start text-left"
										data-testid="transition"
										data-vers={transition.versEtape.id}
										onClick={() => {
											setOuvert(false)
											onTransition(idCard, transition)
										}}
									>
										{/* Un libellé absent est légal : le repli nomme l'étape cible par une clé
										    **paramétrée**, jamais par concaténation ici — l'ordre des mots appartient
										    à la traduction, pas au composant (§7.5, CLAUDE.md §23). */}
										{transition.libelle ??
											t('board.transition.fallback', { etape: transition.versEtape.libelle })}
									</Button>
								</li>
							))}
						</ul>
					)}

					{/* Le séparateur de 1 px entre les deux sections (§5.3 sexies). */}
					<hr aria-hidden="true" className="border-border" />
					<p className="text-xs text-text-3">{t('board.menu.section.sommeil')}</p>
					{/* LES QUATRE ÉCHÉANCES SONT RENDUES DÈS L'OUVERTURE (§16.13.2) : un panneau ouvert
					    dans un menu ouvert ferait trois niveaux pour un choix de quatre boutons. La
					    fiche, elle, garde son panneau — elle a la place, et elle porte aussi l'échéance
					    choisie, que 288 px n'admettent pas. */}
					{enSommeil ? (
						<Button
							variante="discret"
							className="w-full justify-start text-left"
							data-testid="carte-reveiller"
							disabled={enVol !== null}
							aria-label={t('card.sleep.wake.aria')}
							onClick={() => void jouer('reveil', null)}
						>
							<Sun aria-hidden="true" size={16} strokeWidth={2} />
							{t(enVol === 'reveil' ? 'card.sleep.pending' : 'card.sleep.wake')}
						</Button>
					) : (
						<ul data-testid="liste-echeances" className="flex flex-col gap-2">
							{ECHEANCES_USUELLES.map((usuelle) => (
								<li key={usuelle.cle}>
									<Button
										variante="discret"
										className="w-full justify-start text-left"
										data-testid={`carte-sommeil-${usuelle.cle}`}
										disabled={enVol !== null}
										// L'ÉCHÉANCE EST COMPTÉE DEPUIS L'INSTANT DU GESTE (§16.13.2), jamais
										// depuis l'instant du rendu du board : une carte rendue le matin et
										// endormie le soir doit dormir un jour à partir du soir.
										onClick={() => void jouer(usuelle.cle, echeanceUsuelle(usuelle.jours))}
									>
										<Moon aria-hidden="true" size={16} strokeWidth={2} />
										{t(
											enVol === usuelle.cle ? 'card.sleep.pending' : CLE_PRESET_SOMMEIL[usuelle.cle],
										)}
									</Button>
								</li>
							))}
						</ul>
					)}
					{/* Le refus est DIT, jamais avalé (§5.7, §16.13.4), avec la mention même de la fiche. */}
					{mention === null ? null : (
						<p role="alert" data-testid="carte-sommeil-mention" className="text-sm text-danger">
							{t(mention)}
						</p>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Saisie du motif exigé par une transition (§7.8).
 *
 * Elle **dit** que le motif n'est pas conservé : `move_card` le contrôle et rien ne l'écrit,
 * `card_comments` étant `CRM-043` (INC-048). Laisser croire à un enregistrement serait la valeur
 * par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
function SaisieMotif({
	transition,
	onAnnuler,
	onValider,
}: {
	readonly transition: TransitionBoard
	readonly onAnnuler: () => void
	readonly onValider: (motif: string) => void
}) {
	const idChamp = useId()
	const [motif, setMotif] = useState('')
	const vide = motif.trim() === ''

	return (
		<form
			data-testid="saisie-motif"
			className="flex flex-col gap-2 bg-surface border border-border rounded-lg p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (!vide) onValider(motif)
			}}
		>
			<label htmlFor={idChamp} className="text-sm text-text-2">
				{t('board.comment.label')} {transition.versEtape.libelle}
			</label>
			<textarea
				id={idChamp}
				data-testid="champ-motif"
				rows={3}
				value={motif}
				onChange={(evenement) => setMotif(evenement.target.value)}
				className="border border-border rounded-sm p-3 text-base"
			/>
			<p className="text-sm text-text-3">{t('board.comment.notstored')}</p>
			<div className="flex gap-2">
				<Button variante="primaire" type="submit" disabled={vide} data-testid="valider-motif">
					{t('board.comment.submit')}
				</Button>
				<Button variante="discret" onClick={onAnnuler} data-testid="annuler-motif">
					{t('board.comment.cancel')}
				</Button>
			</div>
		</form>
	)
}

/**
 * Le refus, affiché **en toutes lettres** (§7.10).
 *
 * Un message inconnu n'est pas absorbé : le libellé générique est suivi du message brut du
 * backend. Un refus muet ferait croire à un défaut d'interface.
 */
/**
 * L'adresse de reprise de la saisie — `docs/SPEC-form-composer.md` §4 ter.2.
 *
 * `null` dès que la reprise n'aurait aucun objet : un refus d'une autre nature, ou un refus pour
 * champs manquants dont le `DETAIL` n'a rendu **aucune** clé. Offrir un lien vers une fiche sans
 * rien à y mettre en évidence serait une commande morte (docs/DESIGN_SYSTEM.md §5.16).
 *
 * Les clés sont encodées : elles viennent de la base, et le §2.5 du composeur ne leur interdit
 * aucun caractère.
 */
export function cheminReprise(
	slugTrack: string,
	slugChannel: string,
	idCard: string,
	refus: RefusDeplacement,
): string | null {
	if (refus.cle !== 'missing_required_fields') return null
	if (refus.clesManquantes.length === 0) return null
	const exiges = encodeURIComponent(refus.clesManquantes.join(','))
	return `/tracks/${slugTrack}/${slugChannel}/cards/${idCard}?exiges=${exiges}`
}

function BandeauRefus({
	refus,
	cheminReprise: chemin,
	onFermer,
}: {
	readonly refus: RefusDeplacement
	readonly cheminReprise: string | null
	readonly onFermer: () => void
}) {
	return (
		<div
			role="alert"
			data-testid="refus-deplacement"
			data-cle={refus.cle ?? 'inconnu'}
			className="flex items-start gap-3 bg-danger-soft text-danger-on-soft rounded-lg p-3"
		>
			<TriangleAlert aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 mt-1" />
			<div className="flex flex-col gap-1 min-w-0">
				<p>{libelleRefus(refus)}</p>
				{refus.champsManquants.length === 0 ? null : (
					<ul data-testid="champs-manquants" className="list-disc pl-6">
						{refus.champsManquants.map((champ) => (
							<li key={champ}>{champ}</li>
						))}
					</ul>
				)}
				{refus.cle !== null ? null : (
					<code data-testid="refus-brut" className="text-text-2">
						{refus.brut}
					</code>
				)}
				{/* LA REPRISE DE LA SAISIE — docs/SPEC-form-composer.md §4 ter.1, §4 ter.2. C'est un
				    LIEN et non un bouton (docs/DESIGN_SYSTEM.md §5.7 quater) : il change d'adresse,
				    et en faire un contrôle lui retirerait le clic du milieu, le nouvel onglet et la
				    copie de l'adresse. */}
				{chemin === null ? null : (
					<Link to={chemin} data-testid="reprendre-saisie" className={CLASSES_REPRISE}>
						{t('board.refusal.fill')}
					</Link>
				)}
			</div>
			<Button variante="discret" onClick={onFermer} data-testid="fermer-refus" className="ml-auto">
				{t('board.refusal.dismiss')}
			</Button>
		</div>
	)
}

function libelleRefus(refus: RefusDeplacement): string {
	switch (refus.cle) {
		case 'card_not_found':
			return t('board.refusal.card_not_found')
		case 'forbidden':
			return t('board.refusal.forbidden')
		case 'step_not_in_workflow':
			return t('board.refusal.step_not_in_workflow')
		case 'transition_not_allowed':
			return t('board.refusal.transition_not_allowed')
		case 'comment_required':
			return t('board.refusal.comment_required')
		case 'missing_required_fields':
			return t('board.refusal.missing_required_fields')
		case 'anonyme':
			return t('board.refusal.anonyme')
		default:
			return t('board.refusal.unknown')
	}
}

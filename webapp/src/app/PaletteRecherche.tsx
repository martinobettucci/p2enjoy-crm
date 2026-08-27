// @spec CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2b : la surface de la palette
// @spec docs/DESIGN_SYSTEM.md §5.46 (cette surface), §5.43 (le panneau ancré et sa fermeture),
//       §5.18 (liste plate), §5.6 (pilule neutre), §5.1 (le liseré), §5.7 (le champ),
//       §5.8 (états systématiques), §12.2 (l'ordre de sacrifice), §12.3 (libellé masqué),
//       §8 (accessibilité), §9 (icônes), §10 (aucun texte en dur)
// @spec docs/SPEC-recherche.md §12 (où la surface vit), §14.1 (le raccourci), §14.2 (ce que le
//       champ envoie), §14.3 (la navigation clavier), §14.4 (les états), §14.5 (sans session),
//       §14.6 (ce que la surface ne fait pas), §13.2 (la garde d'ordre), §13.3 (le délai)
//
// AUCUNE MODALE, ET C'EST LE CAS OÙ L'ON EST LE PLUS TENTÉ D'Y DÉROGER (§12.2, §5.46). Le §5 du
// design system n'en déclare aucune, et `CRM-043`, `CRM-075`, `CRM-079`, `CRM-060` puis `CRM-064`
// l'ont tranché CINQ fois. L'usage du marché veut une fenêtre centrée sur un voile ; le motif du
// refus n'est pas la conformité, c'est que **le voile cacherait l'écran d'où l'on cherche**. On
// cherche DEPUIS quelque part, et ce quelque part est le contexte de ce qu'on cherche.
//
// LE FOCUS NE QUITTE JAMAIS LE CHAMP, ET C'EST CETTE RÈGLE QUI DÉCIDE LA FORME (§14.3). Les flèches
// déplacent un RÉSULTAT ACTIF, pas le focus : l'utilisateur corrige son terme en permanence, c'est
// le geste même d'une palette, et un focus descendu dans la liste ferait perdre la frappe suivante.
// D'où `role="combobox"` et `aria-activedescendant`, le premier du produit — employé parce
// qu'aucun autre patron ne tient les deux exigences à la fois.

import { Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EtatErreur } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	BORNE_PALETTE,
	DELAI_FRAPPE_MS,
	creerSequenceur,
	rechercher,
	type FamilleRecherche,
	type ResultatRecherche,
	type ResultatsRecherche,
} from '../lib/recherche'
import { clientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/** Le libellé d'une famille, par clé de traduction — jamais le discriminant brut (§10). */
const CLE_FAMILLE: Readonly<Record<FamilleRecherche, CleTraduction>> = {
	affaire: 'search.family.affaire',
	contact: 'search.family.contact',
	organisation: 'search.family.organisation',
	commentaire: 'search.family.commentaire',
	message: 'search.family.message',
}

/**
 * L'état de la recherche courante.
 *
 * `null` EST L'ÉTAT D'ARRIVÉE, ET CE N'EST PAS UN VIDE (§14.4). Le distinguer de « prêt avec zéro
 * résultat » est ce qui permet à l'écran de dire ce que la recherche cherche au lieu d'annoncer une
 * absence que personne n'a demandée.
 */
type EtatRecherche = EtatAsync<ResultatsRecherche> | null

/**
 * La palette : un champ dans l'en-tête, et son panneau ancré.
 *
 * SANS SESSION, RIEN N'EST RENDU (§14.5). C'est la règle du §5.43 pour la cloche : la RPC refuse
 * l'anonyme par le PRIVILÈGE — `401` / `42501` —, et un champ offert à un anonyme promettrait une
 * recherche que la base refuse, la commande morte du §5.10.
 */
export function PaletteRecherche({
	onOuvertureChange,
}: {
	/**
	 * Prévient l'en-tête que la palette s'ouvre ou se ferme.
	 *
	 * L'ÉTAT EST REMONTÉ PARCE QUE LE FIL D'ARIANE DOIT CÉDER SOUS `md` (§5.46, §12.2), et c'est un
	 * DÉBORDEMENT MESURÉ à 390 px : avec le champ ouvert, l'identité de session sortait du cadre de
	 * trente à quarante-huit pixels — l'avatar, le nom et « Se déconnecter » —, et la page défilait
	 * horizontalement contre le §7. Aucune autre disposition ne tenait : le rembourrage d'un champ
	 * ne se comprime pas, et les deux éléments élastiques de la ligne n'avaient que soixante-deux
	 * pixels à se partager.
	 */
	readonly onOuvertureChange?: (ouvert: boolean) => void
}) {
	const { etat: etatSession } = useAuthentification()
	const connecte = etatSession.statut === 'authentifie'
	const navigate = useNavigate()

	const [ouvert, setOuvert] = useState(false)
	const [terme, setTerme] = useState('')
	const [etat, setEtat] = useState<EtatRecherche>(null)
	const [actif, setActif] = useState(0)

	const idPanneau = useId()
	const idListe = useId()
	const champ = useRef<HTMLInputElement | null>(null)
	const ancre = useRef<HTMLDivElement | null>(null)
	// L'élément qui portait le focus avant l'ouverture, pour le lui rendre (§14.1, §5.13).
	const focusPrecedent = useRef<HTMLElement | null>(null)
	// LA GARDE D'ORDRE (§13.2) vit dans une référence, jamais dans un état : elle ne doit provoquer
	// aucun rendu, et elle doit survivre à tous les rendus intermédiaires d'une frappe.
	const sequenceur = useMemo(() => creerSequenceur(), [])

	const resultats = etat?.statut === 'pret' ? etat.donnees.resultats : []

	// L'en-tête est prévenu dans un effet, jamais depuis un gestionnaire : deux chemins d'appel
	// divergeraient, et une fermeture par clic extérieur oublierait de prévenir.
	useEffect(() => {
		onOuvertureChange?.(ouvert)
	}, [ouvert, onOuvertureChange])

	const fermer = useCallback((rendreFocus: boolean) => {
		setOuvert(false)
		setActif(0)
		if (!rendreFocus) return
		// `Échap` REND LE FOCUS, un clic hors du panneau ne le rend PAS : le pointeur l'a déjà
		// déplacé ailleurs, et le ramener volerait le focus à ce que l'utilisateur vient de viser.
		// C'est la distinction que le §5.13 fait entre fermer et annuler.
		const cible = focusPrecedent.current
		if (cible !== null && cible.isConnected) cible.focus()
		else champ.current?.focus()
	}, [])

	const ouvrir = useCallback(() => {
		setOuvert((precedent) => {
			if (!precedent) {
				const actifCourant = globalThis.document?.activeElement
				focusPrecedent.current = actifCourant instanceof HTMLElement ? actifCourant : null
			}
			return true
		})
		// LE RACCOURCI ROUVRE, IL NE BASCULE JAMAIS (§14.3). Une palette qui se refermerait sur une
		// seconde pression punirait qui l'a frappée deux fois par réflexe ; resélectionner le texte
		// est le geste utile — on veut chercher autre chose.
		champ.current?.focus()
		champ.current?.select()
	}, [])

	// LE RACCOURCI EST POSÉ SUR LE DOCUMENT ET ANNULE L'ÉVÉNEMENT (§14.1). `Ctrl+K` est, dans
	// certains navigateurs, un raccourci de la barre d'adresse : ne pas l'annuler ferait ouvrir deux
	// choses à la fois. Il est ACTIF même quand le focus est dans un champ — un raccourci qui
	// cesserait de fonctionner pendant qu'on écrit un commentaire serait inutilisable là où l'on en
	// a le plus besoin. Il est INACTIF sans session : le champ n'est alors pas rendu (§14.5).
	useEffect(() => {
		if (!connecte) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key !== 'k' && evenement.key !== 'K') return
			if (!evenement.metaKey && !evenement.ctrlKey) return
			evenement.preventDefault()
			ouvrir()
		}
		globalThis.addEventListener('keydown', surTouche)
		return () => globalThis.removeEventListener('keydown', surTouche)
	}, [connecte, ouvrir])

	// UN CLIC HORS DU PANNEAU LE REFERME, sans rendre le focus — la règle du §5.43.
	useEffect(() => {
		if (!ouvert) return
		const surClic = (evenement: MouseEvent) => {
			const cible = evenement.target
			if (cible instanceof Node && ancre.current?.contains(cible) === true) return
			fermer(false)
		}
		globalThis.addEventListener('mousedown', surClic)
		return () => globalThis.removeEventListener('mousedown', surClic)
	}, [ouvert, fermer])

	/**
	 * Émet une recherche, sous la garde d'ordre du §13.2.
	 *
	 * ELLE EST NOMMÉE PLUTÔT QU'ENFOUIE DANS L'EFFET parce que l'action de reprise du §14.4 la
	 * rejoue **telle quelle** : un second chemin d'émission divergerait du premier au premier
	 * ajustement, et la reprise finirait par ne plus chercher la même chose que la frappe.
	 */
	const lancer = useCallback(
		(propre: string) => {
			if (clientCrm === null) return
			const rang = sequenceur.suivant()
			// LA LISTE PRÉCÉDENTE RESTE AFFICHÉE (§14.4) : on n'écrase pas `etat` par un état de
			// chargement. Le squelette reste réservé au PREMIER chargement — la règle du §5.29
			// tranche 2 c —, et remplacer la liste à chaque lettre la ferait clignoter (§6).
			setEtat((precedent) =>
				precedent === null || precedent.statut === 'erreur' ? { statut: 'chargement' } : precedent,
			)
			void rechercher(clientCrm, propre, BORNE_PALETTE).then((issue) => {
				if (!sequenceur.estCourant(rang)) return
				setEtat(issue)
				setActif(0)
			})
		},
		[sequenceur],
	)

	// LE DÉLAI DE FRAPPE (§13.3), ET LA GARDE D'ORDRE (§13.2) QU'IL NE REMPLACE PAS.
	//
	// Ce n'est pas la temporisation arbitraire que `CLAUDE.md` §18 interdit : celle-là masque une
	// erreur ou simule un succès, celle-ci ne masque rien et n'affirme rien. Elle réduit un nombre
	// de requêtes — sept pour « refonte » frappé lettre à lettre, une avec le délai.
	//
	// Deux frappes séparées de plus de `DELAI_FRAPPE_MS` émettent bien deux requêtes concurrentes :
	// c'est le RANG qui les départage, et une réponse dépassée est JETÉE.
	useEffect(() => {
		if (!connecte || clientCrm === null) return
		const propre = terme.trim()
		if (propre === '') {
			// Le rang avance quand même : une réponse en vol au moment où le champ est vidé ne doit
			// pas repeupler une liste que l'utilisateur vient d'effacer.
			sequenceur.suivant()
			setEtat(null)
			setActif(0)
			return
		}
		const minuterie = globalThis.setTimeout(() => lancer(propre), DELAI_FRAPPE_MS)
		return () => globalThis.clearTimeout(minuterie)
	}, [terme, connecte, sequenceur, lancer])

	const suivre = useCallback(
		(resultat: ResultatRecherche | undefined) => {
			if (resultat?.adresse == null) return
			fermer(false)
			setTerme('')
			setEtat(null)
			navigate(resultat.adresse)
		},
		[fermer, navigate],
	)

	const surToucheChamp = (evenement: React.KeyboardEvent<HTMLInputElement>) => {
		if (evenement.key === 'Escape') {
			evenement.preventDefault()
			fermer(true)
			return
		}
		if (resultats.length === 0) return
		if (evenement.key === 'ArrowDown') {
			evenement.preventDefault()
			// LA BOUCLE EST UN CHOIX ÉCRIT (§14.3) : sur vingt lignes au plus, revenir en haut est
			// plus court que de remonter.
			setActif((precedent) => (precedent + 1) % resultats.length)
			return
		}
		if (evenement.key === 'ArrowUp') {
			evenement.preventDefault()
			setActif((precedent) => (precedent - 1 + resultats.length) % resultats.length)
			return
		}
		if (evenement.key === 'Enter') {
			evenement.preventDefault()
			suivre(resultats[actif])
		}
	}

	if (!connecte) return null

	const idOption = (rang: number) => `${idListe}-${rang}`
	const enVol = etat?.statut === 'chargement'

	return (
		// LE CONTENEUR N'EST PAS `relative` : le panneau est ancré à l'EN-TÊTE, qui occupe toute la
		// largeur (§5.46, §5.43). Ancré sur le champ, il sortirait de l'écran par le côté opposé au
		// bord dont il s'approche — défaut trouvé en regardant une capture à `CRM-064`.
		// `ancre` ne sert qu'à reconnaître un clic intérieur.
		<div
			ref={ancre}
			className={[
				'min-w-0',
				// LE CONTENEUR EXTÉRIEUR EST L'ÉLÉMENT FLEX DE L'EN-TÊTE, ET C'EST LUI QUI DOIT
				// CÉDER — défaut trouvé en instrumentant la preuve de palier, jamais à la lecture.
				// Écrit `shrink-0`, il empêchait le champ de se comprimer QUELLE QUE SOIT la classe
				// de son enfant : l'identité de session sortait alors du cadre de trente-six pixels
				// à 390 px, et la page défilait horizontalement contre le §7. Une preuve qui dit
				// « ça déborde » sans nommer le coupable fait chercher au mauvais endroit.
				ouvert ? 'flex-1 lg:flex-none lg:shrink-0' : 'shrink-0',
				// `md:relative` : À PARTIR DE `md`, LE PANNEAU S'ANCRE SUR LE CHAMP ; en dessous, il
				// s'ancre sur l'en-tête, qui reste le seul ancêtre positionné. Défaut trouvé EN
				// REGARDANT UNE CAPTURE (`CLAUDE.md` §16) : ancré sur l'en-tête à 1440 px, le
				// panneau se collait au bord DROIT alors que le champ vit au milieu-gauche, et le
				// lien visuel entre la saisie et ses résultats était rompu.
				//
				// CE N'EST PAS UNE ENTORSE À LA LEÇON DU §5.43, qui dit que le repère doit borner le
				// panneau des DEUX côtés près d'un bord. Le champ n'est PAS près d'un bord à partir
				// de `md` — c'est le cas de la cloche, pas le sien —, et sous `md`, là où la place
				// manque, le panneau garde l'ancrage à l'en-tête.
				'lg:relative',
			].join(' ')}
		>
			{/* SOUS `lg`, LE CHAMP CÈDE LA PLACE AU TITRE DE ROUTE ET DEVIENT UNE COMMANDE À ICÔNE
			    (§5.46, §12.2) : l'ordre de sacrifice de l'en-tête ne touche jamais le titre de la
			    route, et un champ de saisie à 390 px le pousserait hors du cadre.

			    `lg` ET NON `md`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE D'UNE AUTRE
			    UNITÉ (`CLAUDE.md` §16, docs/captures/CRM-076/workflows-md-900.jpg) : à 900 px, un
			    champ de `28ch` laissait au titre « Éditeur de workflows » de quoi rendre
			    « Édit… ». Le titre était présent et illisible, ce qui n'est pas mieux qu'absent.
			    C'est le même seuil et la même mesure que le nom du produit du §12.2.

			    LA COMMANDE DISPARAÎT PENDANT QUE LE CHAMP EST OUVERT, et le champ prend sa place
			    — défaut trouvé EN EXÉCUTANT LA PREUVE, jamais à la lecture. Écrite d'abord avec un
			    champ `hidden md:block` inconditionnel, la commande ouvrait sous `md` un panneau
			    SANS AUCUN CHAMP : une palette où l'on ne peut pas taper, c'est-à-dire la commande
			    morte que le §5.10 proscrit. C'est le patron du §5.3 quater — le panneau remplace la
			    commande, il ne s'y ajoute pas. */}
			{ouvert ? null : (
				<button
					type="button"
					data-testid="ouvrir-recherche"
					onClick={ouvrir}
					aria-label={t('search.open')}
					className={[
						'inline-flex lg:hidden items-center justify-center shrink-0',
						'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
						'transition-colors duration-[var(--transition-duration-fast)]',
					].join(' ')}
				>
					<Search aria-hidden="true" size={20} />
				</button>
			)}

			<div
				className={[
					'relative',
					// Ouvert sous `md`, le champ PARTAGE la ligne avec le titre de route plutôt que
					// de le chasser : le §12.2 pose que le titre ne se sacrifie jamais, et il porte
					// déjà son ellipse. À partir de `md`, le champ retrouve sa colonne fixe.
					ouvert ? 'block flex-1 min-w-0' : 'hidden',
					'lg:block lg:flex-none lg:w-[28ch]',
				].join(' ')}
			>
				<Search
					aria-hidden="true"
					size={16}
					className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
				/>
				<label className="sr-only" htmlFor={`${idPanneau}-champ`}>
					{t('search.field.label')}
				</label>
				<input
					ref={champ}
					id={`${idPanneau}-champ`}
					type="search"
					role="combobox"
					data-testid="champ-recherche"
					autoComplete="off"
					aria-expanded={ouvert}
					aria-controls={idListe}
					aria-activedescendant={
						ouvert && resultats.length > 0 ? idOption(actif) : undefined
					}
					aria-busy={enVol}
					placeholder={t('search.field.placeholder')}
					value={terme}
					onFocus={ouvrir}
					onChange={(evenement) => {
						setTerme(evenement.target.value)
						setOuvert(true)
					}}
					onKeyDown={surToucheChamp}
					className={[
						// `pl-[36px]` ET `pr-[72px]` SONT DES VALEURS ARBITRAIRES ASSUMÉES, et non
						// des fractions de l'échelle : celle-ci est CLOSE (§3, §11 du design
						// system) et ne porte que `0, 1, 2, 3, 4, 6, 8, 12`. Écrites d'abord `pl-9`
						// et `pr-16`, ces classes n'étaient **pas engendrées du tout** — défaut
						// mesuré par `scripts/lib/classes-css.mjs` avant commit, exactement comme
						// la jauge `h-1.5` du §5.29. Les deux mesures sont la place de l'icône
						// (12 px de bord + 16 px + 8 px) et celle de la pastille de raccourci.
						//
						// LA RÉSERVE DE DROITE N'EXISTE QU'À PARTIR DE `md`, ET C'EST UN DÉBORDEMENT
						// MESURÉ À 390 px. Le §5.46 pose que la pastille n'est PAS rendue sous `md`
						// — il n'y a pas de clavier à qui l'enseigner —, et lui réserver 72 px
						// quand même donnait au champ un rembourrage de 108 px pour 101 px
						// disponibles : le rembourrage ne se comprime pas, et la page défilait
						// horizontalement, contre le §7. C'était un écart à la spécification
						// écrite, trouvé EN EXÉCUTANT la preuve de palier.
						'w-full min-h-[var(--size-target)] pl-[36px] pr-3 lg:pr-[72px] rounded-sm',
						'bg-surface border border-border text-base',
						'placeholder:text-text-3',
						'focus:outline-none focus:border-brand',
					].join(' ')}
				/>
				{/* LE RACCOURCI EST ÉCRIT DANS LE CHAMP (§5.46) : un raccourci qu'aucun écran
				    n'enseigne n'existe que pour qui le connaît déjà. Il est `aria-hidden` — le nom
				    accessible du champ le dit en toutes lettres — et DISPARAÎT dès que le champ
				    porte du texte, dont il occuperait la place. */}
				{terme === '' ? (
					<kbd
						aria-hidden="true"
						data-testid="raccourci-recherche"
						// `hidden md:block` : SOUS `md` LA PASTILLE N'EST PAS RENDUE (§5.46) — il
						// n'y a pas de clavier à qui l'enseigner, et la place manque.
						className="hidden lg:block absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-sm bg-hover text-text-3 text-xs"
					>
						{t('search.field.shortcut')}
					</kbd>
				) : null}
			</div>

			{ouvert ? (
				<div
					id={idPanneau}
					role="region"
					aria-label={t('search.panel.aria')}
					data-testid="panneau-recherche"
					className={[
						// ANCRÉ À L'EN-TÊTE, QUI OCCUPE TOUTE LA LARGEUR (§5.46). Sous `md` il
						// s'étend d'un bord à l'autre moins la marge ; à partir de `md` il retrouve
						// sa colonne. `md` et jamais `sm`, variant inconnu que Tailwind supprime en
						// silence (§11).
						'absolute top-full z-40 mt-2',
						// Sous `md` : d'un bord à l'autre de l'en-tête, moins la marge. À partir de
						// `md` : aligné sur le bord GAUCHE du champ, borné par `max-w` pour ne
						// jamais sortir de la fenêtre — le cadre est mesuré aux quatre paliers.
						'left-4 right-4 lg:left-0 lg:right-auto lg:w-[52ch] lg:max-w-[80vw]',
						'max-h-[70vh] overflow-y-auto',
						'bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)]',
					].join(' ')}
				>
					<CorpsPalette
						etat={etat}
						idListe={idListe}
						idOption={idOption}
						actif={actif}
						onSurvol={setActif}
						onSuivre={suivre}
						onReprendre={() => lancer(terme.trim())}
					/>
				</div>
			) : null}
		</div>
	)
}

/**
 * Le contenu du panneau, état par état (§14.4, §5.8).
 *
 * LES CINQ ÉTATS SONT EXHAUSTIFS, et le compilateur l'impose : `EtatRecherche` est un type somme
 * augmenté de `null`, qui est l'état d'ARRIVÉE et non un vide.
 */
function CorpsPalette({
	etat,
	idListe,
	idOption,
	actif,
	onSurvol,
	onSuivre,
	onReprendre,
}: {
	readonly etat: EtatRecherche
	readonly idListe: string
	readonly idOption: (rang: number) => string
	readonly actif: number
	readonly onSurvol: (rang: number) => void
	readonly onSuivre: (resultat: ResultatRecherche) => void
	readonly onReprendre: () => void
}) {
	if (etat === null) {
		// L'ÉTAT D'ARRIVÉE N'EST PAS UN VIDE : la phrase dit ce que la recherche cherche, plutôt
		// que d'annoncer une absence que personne n'a demandée (§14.4).
		return (
			<p data-testid="recherche-arrivee" className="px-3 py-3 text-sm text-text-2">
				{t('search.idle')}
			</p>
		)
	}
	if (etat.statut === 'chargement') {
		return (
			<p data-testid="recherche-chargement" className="px-3 py-3 text-sm text-text-3">
				{t('search.loading')}
			</p>
		)
	}
	if (etat.statut === 'erreur') {
		return (
			<div className="p-3">
				<EtatErreur
					titre={t('search.error.title')}
					corps={t('search.error.body')}
					libelleReprise={t('search.error.retry')}
					// LA REPRISE REJOUE LA MÊME RECHERCHE (§14.4), par le MÊME chemin d'émission
					// que la frappe : un second chemin divergerait du premier au premier
					// ajustement, et la reprise finirait par ne plus chercher la même chose.
					onReprise={onReprendre}
				/>
			</div>
		)
	}
	if (etat.donnees.resultats.length === 0) {
		// LE MESSAGE DIT QUE LA RECHERCHE A ABOUTI, pas qu'elle a échoué, et il n'offre AUCUNE
		// action — l'écart au §5.8 que le §5.16, le §5.19, le §5.37 et le §5.43 prennent déjà.
		return (
			<p data-testid="recherche-vide" className="px-3 py-3 text-sm text-text-2">
				{t('search.empty')}
			</p>
		)
	}
	return (
		<>
			<ul
				id={idListe}
				role="listbox"
				aria-label={t('search.panel.aria')}
				data-testid="liste-recherche"
			>
				{etat.donnees.resultats.map((resultat, rang) => (
					<LigneResultat
						key={`${resultat.famille ?? 'inconnu'}-${resultat.id}`}
						resultat={resultat}
						id={idOption(rang)}
						actif={rang === actif}
						onSurvol={() => onSurvol(rang)}
						onSuivre={() => onSuivre(resultat)}
					/>
				))}
			</ul>
			{/* LA TRONCATURE EST ÉCRITE, jamais laissée à deviner (§14.2). */}
			{etat.donnees.tronque ? (
				<p data-testid="recherche-tronquee" className="px-3 py-2 text-xs text-text-3">
					{t('search.truncated', { compte: String(etat.donnees.resultats.length) })}
				</p>
			) : null}
		</>
	)
}

/**
 * Une ligne de résultat.
 *
 * UNE LIGNE EST UNE LIGNE, PAS UNE CARTE (§5.46, §5.11, §5.43) : la distinction porte celle des
 * natures. Elle est une `option` de `listbox` et NON un lien : le focus ne descend jamais dans la
 * liste (§14.3), et un `<a>` que l'on n'atteint jamais par tabulation serait un lien en trompe-l'œil.
 * Le clic est porté par la ligne elle-même, et le clavier par `Entrée` sur le champ.
 */
function LigneResultat({
	resultat,
	id,
	actif,
	onSurvol,
	onSuivre,
}: {
	readonly resultat: ResultatRecherche
	readonly id: string
	readonly actif: boolean
	readonly onSurvol: () => void
	readonly onSuivre: () => void
}) {
	const atteignable = resultat.adresse !== null
	return (
		<li
			id={id}
			role="option"
			aria-selected={actif}
			aria-disabled={atteignable ? undefined : true}
			data-testid="resultat-recherche"
			data-famille={resultat.famille ?? 'inconnu'}
			data-atteignable={atteignable ? 'oui' : 'non'}
			onMouseEnter={onSurvol}
			onClick={atteignable ? onSuivre : undefined}
			className={[
				'flex flex-col gap-1 px-3 py-2 border-b border-border last:border-b-0',
				// L'ÉTAT ACTIF SE MARQUE PAR UN FOND ET UN LISERÉ GAUCHE DE 3 px (§5.46) — le
				// liseré de la carte de board tourné d'un quart de tour. Le survol emploie
				// `--color-hover` et ne se confond donc pas avec lui.
				actif
					? 'bg-brand-soft border-l-[3px] border-l-brand'
					: 'border-l-[3px] border-l-transparent hover:bg-hover',
				atteignable ? 'cursor-pointer' : 'cursor-default',
			].join(' ')}
		>
			<div className="flex items-start gap-2 min-w-0">
				{/* LA FAMILLE EST UNE PILULE NEUTRE PORTANT UN MOT, en TÊTE de ligne (§5.46) :
				    elle dit DE QUOI il s'agit avant de dire lequel. Une famille que le contrat ne
				    nomme pas ne rend AUCUNE pilule — jamais le discriminant brut (§5.14). */}
				{resultat.famille === null ? null : (
					<span className="shrink-0 mt-[2px] px-2 rounded-full bg-hover text-text-2 text-xs">
						{t(CLE_FAMILLE[resultat.famille])}
					</span>
				)}
				{/* LE TITRE SE REPLIE, il ne tronque pas : il nomme l'objet, et le §5.43 a déjà payé
				    ce défaut en regardant une capture — « le lien ne nommait plus l'affaire ». */}
				<span className="min-w-0 text-sm font-medium text-ink break-words">
					{resultat.titre ?? t('search.result.untitled')}
				</span>
			</div>
			{resultat.sousTitre === null ? null : (
				<span className="text-sm text-text-2 break-words">{resultat.sousTitre}</span>
			)}
			{/* L'EXTRAIT TIENT SUR UNE LIGNE, et c'est le seul endroit de cette surface où
			    l'ellipse du §5.9 s'applique : un extrait est un ÉCHANTILLON, pas une donnée dont
			    la troncature perdrait quelque chose. */}
			{resultat.extrait === null ? null : (
				<span className="text-sm text-text-2 truncate">{resultat.extrait}</span>
			)}
			{atteignable ? null : (
				<span className="text-xs text-text-3">{t('search.result.unreachable')}</span>
			)}
		</li>
	)
}

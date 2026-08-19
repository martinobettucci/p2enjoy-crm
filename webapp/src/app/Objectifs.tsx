// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : navigation, liste des
//       tableaux, canevas rendu, flèches, équivalent textuel et ouverture du channel ;
//       tranche 2a : poser, déplacer et redimensionner un bloc, à la souris et au clavier ;
//       tranche 2b-1 : la fiche d'édition — titre, corps, couleur, remplissage ;
//       tranche 2b-2a : le LIEN d'un bloc vers un channel, et son retrait ;
//       tranche 2b-2b : les FLÈCHES — tracer une flèche entre deux blocs avec le choix de sa
//       direction, et corriger cette direction ensuite ;
//       tranche 2b-2c : les SUPPRESSIONS — supprimer une flèche depuis la liste des liens,
//       supprimer un bloc depuis sa fiche, chacune derrière sa confirmation ;
//       tranche 2c : les TABLEAUX — créer, renommer, réordonner et archiver un tableau depuis sa
//       liste
// @spec docs/SPEC-goals.md §2.3 (trois directions ; unicité de la paire — corriger une flèche
//       existante est une modification, pas un ajout ; `on delete cascade` des deux extrémités)
// @spec docs/SPEC-goals.md §2.1 (le tableau : nom unique par workspace après normalisation,
//       `position` attribuée par trigger, l'archivage tient lieu de suppression)
// @spec docs/DESIGN_SYSTEM.md §5.13 (liste administrable : formulaires dans le flux, commandes
//       d'ordre désactivées aux extrémités, retour du focus à la commande qui a ouvert)
// @spec docs/SPEC-goals.md §5.1 (liste des tableaux), §5.2 (canevas), §5.3 (flèches),
//       §5.4 (les cinq états), §5.5 (accessibilité, gestes clavier, `Entrée` ouvre la fiche
//       d'édition), §3 (ouvrir le channel d'un bloc, poser un bloc, le déplacer, le
//       redimensionner, saisir titre / corps / couleur, régler le remplissage au curseur ET au
//       champ numérique, lier le bloc à un channel — sélecteur des channels lisibles groupés par
//       track — et retirer le lien), §4.2 (écriture ; POSER le lien exige `app.can_write_channel`,
//       le RETIRER non), §1 (aucun remplissage calculé)
// @spec docs/SPEC-goals.md §4.1 (le bloc masqué n'est pas rendu, et l'écran ne le nomme jamais)
// @spec docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche, focus), §5.8 (états), §8 (clavier),
//       §5.5 bis (pilule de track réemployée par la pilule de channel)
//
// CE QUE CES TRANCHES LIVRENT, ET CE QU'ELLES NE LIVRENT PAS — nommé ici plutôt que découvert à
// l'usage (`CLAUDE.md` §25) :
//
//   * TRANCHE 1, LA LECTURE : l'entrée de navigation, la liste des tableaux avec leur compte de
//     blocs LISIBLES, le canevas pannable et zoomable, les blocs avec jauge et pilule, les flèches
//     aux trois directions, les moignons pointillés vers le vide, l'équivalent textuel du
//     diagramme, les états vide / introuvable / lien perdu, et l'OUVERTURE du channel ;
//   * TRANCHE 2a, LA GÉOMÉTRIE : poser un bloc à la position du geste, le déplacer et le
//     redimensionner, à la souris ET au clavier, avec persistance des quatre colonnes ;
//   * TRANCHE 2b-1, LE CONTENU : la fiche d'édition d'un bloc — titre, corps, couleur, et
//     remplissage réglé au curseur COMME au champ numérique —, ouverte par `Entrée` au clavier et
//     par un clic sans déplacement à la souris ; chaque champ s'enregistre pour lui-même ;
//   * TRANCHE 2b-2a, LE LIEN : le channel qu'un bloc vise, choisi dans un sélecteur des channels
//     LISIBLES groupés par track, et retiré par l'option vide comme par un bouton dédié ;
//   * TRANCHE 2b-2b, LES FLÈCHES : tracer une flèche entre deux blocs — `Espace` sur le bloc de
//     départ au clavier, commande puis deux clics à la souris —, avec le choix de sa direction
//     AVANT le tracé, et la correction de cette direction ensuite depuis la liste des liens ;
//   * TRANCHE 2b-2c, LES SUPPRESSIONS : supprimer une flèche depuis la liste des liens, et
//     supprimer un bloc depuis sa fiche — chacune derrière une confirmation qui NOMME ce qu'elle
//     détruit, et celle du bloc nommant aussi les flèches que la cascade emporte ;
//   * TRANCHE 2c, LES TABLEAUX : créer un tableau, le renommer, le réordonner et l'archiver, depuis
//     la liste du §5.1 — formulaires dans le FLUX du document, commandes d'ordre désactivées aux
//     extrémités et jamais masquées, confirmation d'archivage qui dit que le tableau quitte la
//     liste ;
//   * NON LIVRÉ, et donc non simulé : DÉSARCHIVER un tableau. Le §5.1 ne décrit qu'une liste des
//     tableaux non archivés, et aucun écran ne rend un tableau archivé : poser la commande
//     supposerait d'abord une surface où le retrouver, qu'aucune unité ne spécifie. La confirmation
//     d'archivage dit donc en toutes lettres ce que le geste coûte.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT : il rend ce que le backend consent, et il ENVOIE puis traduit
// le refus (`CLAUDE.md` §10, `docs/DESIGN_SYSTEM.md` §5.26). Aucune commande n'est éteinte
// d'avance selon le rôle. Un bloc lié à un channel fermé n'arrive jamais jusqu'ici, et l'écran ne
// cherche pas à savoir qu'il a existé.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as EvenementPointeur } from 'react'
import { Link, useParams } from 'react-router'
import {
	Archive,
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Minus,
	MoveRight,
	Pencil,
	Plus,
	SquareArrowOutUpRight,
	SquarePlus,
	Trash2,
	Unlink,
	X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import {
	composerDiagramme,
	etendueCanevas,
	lienOuvrable,
	lienPerdu,
	listeTextuelleDiagramme,
	ordreTabulation,
	useContenuTableau,
	useTableaux,
	type BlocObjectif,
	type DirectionFleche,
	type FlecheObjectif,
	type FlecheTracee,
	type LigneDiagramme,
	type TableauListe,
} from '../lib/objectifs'
// L'ARITHMÉTIQUE D'ORDRE EST RÉEMPLOYÉE, JAMAIS RECOPIÉE. `calculerDeplacement` et
// `deplacementPossible` portent déjà, pour les tracks et les channels, le calcul exact dont
// `goal_boards.position` a besoin : un `numeric` réordonné par le MILIEU de deux voisines, une
// seule écriture et jamais une permutation. Les dupliquer pour une troisième table les ferait
// diverger au premier ajustement. Le module n'est importé QUE pour ce calcul — aucune règle
// d'administration ne traverse cette frontière —, et l'extraire un jour dans un module d'ordre
// partagé toucherait trois écrans d'administration, hors du périmètre de cette unité.
import {
	calculerDeplacement,
	deplacementPossible,
	type Ordonnable,
	type Sens,
} from '../lib/administration-arborescence'
import {
	COULEURS_BLOC,
	DIRECTIONS_FLECHE,
	REMPLISSAGE_MAXIMAL,
	REMPLISSAGE_MINIMAL,
	archiverTableau,
	changerDirectionFleche,
	creerTableau,
	deplacerTableau,
	ecrireContenuBloc,
	ecrireGeometrieBloc,
	renommerTableau,
	grouperChannelsParTrack,
	lierBlocAChannel,
	poserBloc,
	supprimerBloc,
	supprimerFleche,
	tracerFleche,
	useChannelsLiables,
	PAS_CLAVIER,
	PAS_CLAVIER_FIN,
	TAILLE_BLOC_MINIMALE,
	TAILLE_BLOC_NEUF,
	bornerCoordonnee,
	bornerDimension,
	bornerRemplissage,
	type ChannelLiable,
	type ContenuBloc,
	type RefusBloc,
	type RefusFleche,
	type RefusTableau,
	type ResultatCreationTableau,
	type ResultatEcritureBloc,
	type ResultatEcritureTableau,
} from '../lib/objectifs-ecriture'
import type { EtatAsync } from '../lib/async'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { CHEMIN_OBJECTIFS, cheminTableauObjectifs } from './chemins'

/**
 * Couleur de jeton d'un bloc → classe du liseré gauche (§5.29 : liseré de 4 px).
 *
 * La table est CLOSE et son repli est `neutral` : une couleur inconnue en base — une valeur
 * saisie à la main, un jeton retiré du design system — rend un bloc gris, jamais un bloc sans
 * liseré ni une couleur devinée.
 */
const LISERES: Readonly<Record<string, string>> = {
	brand: 'bg-brand',
	success: 'bg-success',
	accent: 'bg-accent',
	danger: 'bg-danger',
	neutral: 'bg-border',
}

const liseréDe = (couleur: string) => LISERES[couleur] ?? LISERES.neutral

/**
 * Couleur de jeton → clé de son nom en clair, ÉCRITE LITTÉRALEMENT.
 *
 * La table existe parce qu'une clé construite — `` t(`goals.edit.color.${couleur}`) `` — est une
 * clé que RIEN ne peut plus suivre : le détecteur de clés mortes de `i18n.test.ts` cherche chaque
 * clé du dictionnaire dans les sources, et a déclaré mortes les cinq couleurs le jour où elles ont
 * été appelées ainsi. Il avait raison de le faire : une clé qu'aucune recherche textuelle ne trouve
 * survit à la suppression du code qui l'employait. Les clés sont donc écrites en toutes lettres.
 */
const NOMS_COULEUR = {
	brand: 'goals.edit.color.brand',
	success: 'goals.edit.color.success',
	accent: 'goals.edit.color.accent',
	danger: 'goals.edit.color.danger',
	neutral: 'goals.edit.color.neutral',
} as const

/** Paliers de zoom du canevas. Bornés : un canevas qu'on peut réduire à néant n'est plus une surface. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5] as const
const ZOOM_PAR_DEFAUT = 2

export type ProprietesObjectifs = {
	readonly client?: ClientCrm | null
}

/**
 * Liste des tableaux — §5.1.
 *
 * Le workspace courant est le premier rendu par `lireWorkspaces`, patron déjà porté par le
 * carnet, le header et les trois surfaces d'administration : le produit n'a pas encore de
 * sélecteur d'espace de travail, et en inventer un ici poserait une surface que rien ne spécifie.
 */
export function Objectifs({ client = clientCrm }: ProprietesObjectifs = {}) {
	const { etat: etatWorkspaces } = useWorkspaces(client)

	const idWorkspace =
		etatWorkspaces.statut === 'pret' ? (etatWorkspaces.donnees[0]?.id ?? null) : null
	const { etat, recharger } = useTableaux(client, idWorkspace)

	// PAS DE CLIENT — l'application est montée sans configuration Supabase, cas ordinaire des
	// preuves de routage. Même patron et même texte que le carnet : sans cette sortie, les deux
	// lectures ne partent jamais et le squelette ne se résout pas.
	if (client === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etatWorkspaces.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	// AUCUN ESPACE DE TRAVAIL — un appelant sans session en est le cas ordinaire. Sans cette
	// sortie, l'écran resterait EN CHARGEMENT indéfiniment : la lecture des tableaux ne part que
	// lorsqu'un workspace est connu, et un squelette qui ne se résout jamais est une page blanche
	// déguisée (`docs/SPEC-webapp.md` §7). Même patron et même texte que le carnet.
	if (etatWorkspaces.statut === 'pret' && idWorkspace === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	if (etatWorkspaces.statut === 'erreur' || etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('goals.error.title')}
				corps={t('goals.error.body')}
				libelleReprise={t('goals.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	// L'ÉTAT VIDE EST RENDU PAR LA LISTE ELLE-MÊME, et non par une sortie anticipée : le §5.4 veut
	// que « Aucun tableau d'objectifs » porte L'ACTION D'EN CRÉER UN, et une sortie ici priverait cet
	// état de la seule commande qui en fait sortir. Même règle qu'au §5.29 pour l'état vide d'un
	// tableau, qui porte la commande de pose.
	return (
		<ListeTableaux
			client={client}
			idWorkspace={idWorkspace as string}
			tableaux={etat.donnees}
			recharger={recharger}
		/>
	)
}

/**
 * La liste des tableaux et son administration — §5.1, §3 (« créer un tableau, le renommer, le
 * réordonner, l'archiver »).
 *
 * ELLE EST UN COMPOSANT DISTINCT parce que ses états d'écriture sont des HOOKS, et que `Objectifs`
 * rend cinq sorties anticipées avant d'atteindre la liste — chargement, absence de client, absence
 * d'espace de travail, erreur. Déclarer ces états là-haut les ferait vivre pendant des rendus où
 * aucun tableau n'existe, et les règles des hooks interdisent de les déclarer après une sortie.
 *
 * AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (`docs/DESIGN_SYSTEM.md` §5.26, neuf fois
 * posé) : les quatre gestes sont offerts à tous, l'écran envoie, et il traduit le refus. Les seules
 * commandes désactivées sont celles du réordonnancement aux extrémités de la liste (§5.13), qui ne
 * disent rien d'un droit et tout d'une arithmétique.
 */
function ListeTableaux({
	client,
	idWorkspace,
	tableaux,
	recharger,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly tableaux: readonly TableauListe[]
	readonly recharger: () => void
}) {
	const [formulaire, setFormulaire] = useState<FormulaireTableau>(null)
	const [message, setMessage] = useState<MessageEcriture | null>(null)
	// Le retour du focus emprunte le remède du §5.25 — un drapeau, puis un effet — pour la cause du
	// §5.29 : la commande qui a ouvert un formulaire est DÉMONTÉE pendant qu'il vit (la ligne rend le
	// formulaire à sa place), et `focus()` appelé depuis le gestionnaire de fermeture porterait sur un
	// bouton qui n'existe plus. Aucune temporisation (`CLAUDE.md` §18).
	const [focusARendre, setFocusARendre] = useState<string | null>(null)

	const fermer = useCallback((idFocus: string | null) => {
		setFormulaire(null)
		setFocusARendre(idFocus)
	}, [])

	useEffect(() => {
		if (focusARendre === null) return
		const commande = document.querySelector<HTMLElement>(`[data-focus="${focusARendre}"]`)
		commande?.focus()
		setFocusARendre(null)
	}, [focusARendre])

	/** Traduit une issue d'écriture en mention, et recharge la liste quand elle a mordu. */
	const traiter = useCallback(
		(resultat: ResultatEcritureTableau | ResultatCreationTableau, succes: string) => {
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusTableau(resultat.refus) })
				return false
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.board.write.noeffect') })
				return false
			}
			setMessage({ ton: 'succes', texte: succes })
			recharger()
			return true
		},
		[recharger],
	)

	const creer = useCallback(
		async (nom: string, description: string) => {
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await creerTableau(client, { idWorkspace, nom, description })
			if (traiter(resultat, t('goals.board.created'))) fermer('creer')
		},
		[client, idWorkspace, traiter, fermer],
	)

	const renommer = useCallback(
		async (id: string, nom: string, description: string) => {
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await renommerTableau(client, id, { nom, description })
			if (traiter(resultat, t('goals.board.renamed'))) fermer(`renommer-${id}`)
		},
		[client, traiter, fermer],
	)

	const deplacer = useCallback(
		async (id: string, sens: Sens) => {
			// L'ARITHMÉTIQUE EST CELLE DES TRACKS, réemployée et jamais recopiée : `calculerDeplacement`
			// lit la liste TELLE QUE L'ÉCRAN L'AFFICHE — déjà triée par le serveur — et rend le milieu
			// de deux voisines. Un `impossible` n'est pas une erreur, c'est le refus motivé du §6.2 de
			// `docs/SPEC-administration-arborescence.md`, et l'écran le nomme au lieu d'écrire une
			// valeur qui ne changerait rien (`CLAUDE.md` §18).
			const deplacement = calculerDeplacement(tableaux.map(ordonnableDe), id, sens)
			if (deplacement.statut === 'impossible') {
				setMessage({ ton: 'refus', texte: t('goals.board.move.impossible') })
				return
			}
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await deplacerTableau(client, id, deplacement.position)
			traiter(resultat, t('goals.board.moved'))
		},
		[client, tableaux, traiter],
	)

	const archiver = useCallback(
		async (id: string) => {
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await archiverTableau(client, id)
			if (traiter(resultat, t('goals.board.archived'))) fermer(`archiver-${id}`)
		},
		[client, traiter, fermer],
	)

	const ordonnables = tableaux.map(ordonnableDe)

	return (
		<section aria-label={t('goals.aria')} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium">{t('goals.list.title')}</h2>
				{/* La commande a DEUX VISAGES, un seul rendu à la fois — patron du §5.29 pour la pose,
				    et du §5.3 quater dont il descend. */}
				<Button
					variante={formulaire?.mode === 'creation' ? 'secondaire' : 'primaire'}
					taille="compacte"
					data-testid="creer-tableau"
					data-focus="creer"
					aria-pressed={formulaire?.mode === 'creation'}
					onClick={() =>
						formulaire?.mode === 'creation' ? fermer('creer') : setFormulaire({ mode: 'creation' })
					}
				>
					<SquarePlus aria-hidden="true" size={16} strokeWidth={2} />
					{formulaire?.mode === 'creation' ? t('goals.board.create.cancel') : t('goals.board.create')}
				</Button>
			</div>

			{/* Le formulaire vit DANS LE FLUX du document, sous l'en-tête, jamais dans une modale
			    (§5.13, tranché trois fois). */}
			{formulaire?.mode === 'creation' ? (
				<FormulaireNomTableau
					testid="formulaire-creation-tableau"
					titre={t('goals.board.create.title')}
					nomInitial=""
					descriptionInitiale=""
					libelleValider={t('goals.board.create.submit')}
					message={message}
					onValider={creer}
					onAnnuler={() => fermer('creer')}
				/>
			) : null}

			{tableaux.length === 0 ? (
				<EtatVide titre={t('goals.list.empty.title')} corps={t('goals.list.empty.body')} />
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface">
					{tableaux.map((tableau) => (
						<li key={tableau.id} className="border-b border-border last:border-b-0">
							{formulaire?.mode === 'renommage' && formulaire.id === tableau.id ? (
								<FormulaireNomTableau
									testid="formulaire-renommage-tableau"
									titre={t('goals.board.rename.title', { nom: tableau.name })}
									nomInitial={tableau.name}
									descriptionInitiale={tableau.description ?? ''}
									libelleValider={t('goals.board.rename.submit')}
									message={message}
									onValider={(nom, description) => renommer(tableau.id, nom, description)}
									onAnnuler={() => fermer(`renommer-${tableau.id}`)}
								/>
							) : formulaire?.mode === 'archivage' && formulaire.id === tableau.id ? (
								<ConfirmationArchivageTableau
									nom={tableau.name}
									message={message}
									onConfirmer={() => archiver(tableau.id)}
									onAnnuler={() => fermer(`archiver-${tableau.id}`)}
								/>
							) : (
								<LigneTableau
									tableau={tableau}
									ordonnables={ordonnables}
									onRenommer={() => setFormulaire({ mode: 'renommage', id: tableau.id })}
									onArchiver={() => setFormulaire({ mode: 'archivage', id: tableau.id })}
									onDeplacer={(sens) => deplacer(tableau.id, sens)}
								/>
							)}
						</li>
					))}
				</ul>
			)}

			{/* La mention d'écriture de la LISTE est celle des gestes qui n'ouvrent aucun formulaire —
			    le réordonnancement. Les formulaires portent la leur, près du champ qui l'a causée
			    (§5.13), et c'est pourquoi elle est tue lorsque l'un d'eux est ouvert : la même phrase
			    lue à deux endroits ferait chercher deux causes. */}
			<MentionEcriture message={formulaire === null ? message : null} />
		</section>
	)
}

/** Les trois formulaires que la liste ouvre, un seul à la fois — jamais deux surfaces ouvertes. */
type FormulaireTableau =
	| null
	| { readonly mode: 'creation' }
	| { readonly mode: 'renommage'; readonly id: string }
	| { readonly mode: 'archivage'; readonly id: string }

/** Ce que `calculerDeplacement` demande d'un tableau : sa position, et rien d'autre. */
const ordonnableDe = (tableau: TableauListe): Ordonnable => ({
	id: tableau.id,
	position: tableau.position,
})

/**
 * Traduit un refus d'écriture de TABLEAU, dictionnaire fermé et distinct de ceux des blocs et des
 * flèches.
 *
 * `doublon` y dit un geste que les autres ne disent pas — choisir un autre nom —, et il porte une
 * précision que seule cette table impose : l'index unique de `goal_boards` est TOTAL, si bien qu'un
 * tableau ARCHIVÉ retient encore son nom. Taire ce point ferait chercher indéfiniment, dans une
 * liste où il ne paraît plus, le tableau qui bloque.
 */
export function texteRefusTableau(refus: RefusTableau): string {
	if (refus.nature === 'doublon') return t('goals.board.refused.duplicate')
	if (refus.nature === 'interdit') return t('goals.board.refused.forbidden')
	if (refus.nature === 'saisie-invalide') return t('goals.board.refused.invalid')
	return t('goals.write.refused.unavailable')
}

/**
 * Une ligne de la liste : le lien vers le tableau, et sa barre de commandes.
 *
 * LE LIEN ET LES COMMANDES SONT DISTINCTS, et c'est la règle du §5.13 : une ligne entièrement
 * cliquable rendrait ambiguë la cible d'un clic qui porte déjà quatre commandes. Le lien garde la
 * hauteur de cible, les commandes sont des boutons discrets compacts TOUJOURS VISIBLES — jamais au
 * survol seul, puisqu'elles sont l'objet même de cette surface.
 */
function LigneTableau({
	tableau,
	ordonnables,
	onRenommer,
	onArchiver,
	onDeplacer,
}: {
	readonly tableau: TableauListe
	readonly ordonnables: readonly Ordonnable[]
	readonly onRenommer: () => void
	readonly onArchiver: () => void
	readonly onDeplacer: (sens: Sens) => void
}) {
	const peutMonter = deplacementPossible(ordonnables, tableau.id, 'monter')
	const peutDescendre = deplacementPossible(ordonnables, tableau.id, 'descendre')
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
			<Link
				to={cheminTableauObjectifs(tableau.id)}
				data-testid="tableau-objectifs"
				className="flex flex-1 flex-col gap-1 min-h-[var(--size-target)] justify-center rounded-sm hover:underline"
			>
				<span className="font-medium">{tableau.name}</span>
				{tableau.description === null ? null : (
					<span className="text-sm text-text-2">{tableau.description}</span>
				)}
				{/* Le compte est celui des blocs LISIBLES par l'appelant (§5.1) : deux
				    personnes du même workspace n'y lisent pas le même nombre, et c'est
				    la conséquence assumée du §4.1. */}
				<span className="text-sm text-text-3">{libelleCompteBlocs(tableau.blocsLisibles)}</span>
			</Link>
			<div className="flex flex-wrap items-center gap-1">
				{/* LES COMMANDES D'ORDRE SONT DÉSACTIVÉES AUX EXTRÉMITÉS, JAMAIS MASQUÉES (§5.13, §8) :
				    une commande qui disparaît en tête de liste fait sauter le groupe d'une ligne à
				    l'autre, et l'œil perd la colonne. Leur nom accessible NOMME le tableau — « Monter »
				    seul, répété sur chaque ligne, ne dirait pas lequel. */}
				<Button
					variante="discret"
					taille="compacte"
					data-testid="monter-tableau"
					disabled={!peutMonter}
					aria-label={t('goals.board.move.up.aria', { nom: tableau.name })}
					title={t('goals.board.move.up')}
					onClick={() => onDeplacer('monter')}
				>
					<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					data-testid="descendre-tableau"
					disabled={!peutDescendre}
					aria-label={t('goals.board.move.down.aria', { nom: tableau.name })}
					title={t('goals.board.move.down')}
					onClick={() => onDeplacer('descendre')}
				>
					<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					data-testid="renommer-tableau"
					data-focus={`renommer-${tableau.id}`}
					aria-label={t('goals.board.rename.aria', { nom: tableau.name })}
					title={t('goals.board.rename')}
					onClick={onRenommer}
				>
					<Pencil aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					data-testid="archiver-tableau"
					data-focus={`archiver-${tableau.id}`}
					aria-label={t('goals.board.archive.aria', { nom: tableau.name })}
					title={t('goals.board.archive')}
					onClick={onArchiver}
				>
					<Archive aria-hidden="true" size={16} strokeWidth={2} />
				</Button>
			</div>
		</div>
	)
}

/**
 * Le formulaire de création ET celui de renommage — un seul composant, parce que c'est un seul
 * formulaire : deux champs, une validation, une annulation. Les deux gestes ne diffèrent que par
 * leurs textes et par les valeurs initiales, et deux composants divergeraient au premier ajustement.
 *
 * LE FOCUS ENTRE DANS LE PREMIER CHAMP à l'ouverture (§5.13) : un formulaire qui paraît sans prendre
 * le focus demande un `Tab` que le geste souris n'exige pas, et la parité des deux entrées serait
 * tenue en apparence seulement.
 *
 * AUCUNE VALIDATION N'EST ANTICIPÉE ICI (`CLAUDE.md` §10). Le nom vide est envoyé, et c'est
 * `goal_boards_name_check` qui le refuse, traduit en `saisie-invalide` : l'écran ne double pas la
 * contrainte, il la reçoit. Le champ porte `required` — l'aide de saisie du navigateur, qui ne
 * remplace aucune règle et ne décide de rien côté serveur.
 */
function FormulaireNomTableau({
	testid,
	titre,
	nomInitial,
	descriptionInitiale,
	libelleValider,
	message,
	onValider,
	onAnnuler,
}: {
	readonly testid: string
	readonly titre: string
	readonly nomInitial: string
	readonly descriptionInitiale: string
	readonly libelleValider: string
	readonly message: MessageEcriture | null
	readonly onValider: (nom: string, description: string) => void
	readonly onAnnuler: () => void
}) {
	const [nom, setNom] = useState(nomInitial)
	const [description, setDescription] = useState(descriptionInitiale)
	const premierChamp = useRef<HTMLInputElement | null>(null)
	useEffect(() => {
		premierChamp.current?.focus()
	}, [])

	return (
		<form
			data-testid={testid}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider(nom, description)
			}}
		>
			<p className="font-medium">{titre}</p>
			<label className="flex flex-col gap-1 text-sm">
				{t('goals.board.field.name')}
				<input
					ref={premierChamp}
					data-testid="champ-nom-tableau"
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					value={nom}
					required
					onChange={(evenement) => setNom(evenement.target.value)}
				/>
			</label>
			<label className="flex flex-col gap-1 text-sm">
				{t('goals.board.field.description')}
				<input
					data-testid="champ-description-tableau"
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3"
					value={description}
					onChange={(evenement) => setDescription(evenement.target.value)}
				/>
			</label>
			<span className="text-sm text-text-3">{t('goals.board.field.description.hint')}</span>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" taille="compacte" data-testid="valider-tableau">
					{libelleValider}
				</Button>
				<Button variante="secondaire" taille="compacte" data-testid="annuler-tableau" onClick={onAnnuler}>
					{t('goals.board.form.cancel')}
				</Button>
			</div>
			{/* Le refus est lu PRÈS DU CHAMP QUI L'A CAUSÉ, jamais en tête d'écran (§5.13). */}
			<MentionEcriture message={message} />
		</form>
	)
}

/**
 * La confirmation d'archivage — dans le flux du document, jamais une modale (§5.13).
 *
 * ELLE DIT QUE LE TABLEAU QUITTE LA LISTE, et elle le dit parce que rien ne l'y ramène : le §5.1 ne
 * décrit qu'une liste des tableaux NON archivés, et aucun écran de ce produit ne rend un tableau
 * archivé. Écrire « archiver » sans cette conséquence laisserait croire à un rangement réversible
 * d'un clic. Elle ne promet pas non plus une destruction : le travail reste en base, et un tableau
 * archivé RETIENT SON NOM — l'index unique ne l'exclut pas.
 *
 * LE FOCUS ENTRE SUR LE BOUTON D'ACTION, patron de `ConfirmationSuppressionBloc` de cet écran.
 */
function ConfirmationArchivageTableau({
	nom,
	message,
	onConfirmer,
	onAnnuler,
}: {
	readonly nom: string
	readonly message: MessageEcriture | null
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const action = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div data-testid="confirmation-archivage-tableau" className="flex flex-col gap-2 p-4">
			<p className="font-medium">{t('goals.board.archive.confirm.title', { nom })}</p>
			<p className="text-sm text-text-2">{t('goals.board.archive.confirm.body')}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					ref={action}
					variante="destructif"
					taille="compacte"
					data-testid="confirmer-archivage-tableau"
					onClick={onConfirmer}
				>
					{t('goals.board.archive.confirm.action')}
				</Button>
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="annuler-archivage-tableau"
					onClick={onAnnuler}
				>
					{t('goals.board.archive.cancel')}
				</Button>
			</div>
			<MentionEcriture message={message} />
		</div>
	)
}

/**
 * Compte de blocs en clair, par CLÉ et jamais par concaténation (`CLAUDE.md` §23) : le français
 * accorde son substantif, et trois clés valent mieux qu'une phrase assemblée dans le composant.
 */
export function libelleCompteBlocs(compte: number): string {
	if (compte === 0) return t('goals.list.blocks.none')
	if (compte === 1) return t('goals.list.blocks.one')
	return t('goals.list.blocks', { compte: String(compte) })
}

export type ProprietesCanevas = {
	readonly client?: ClientCrm | null
}

/**
 * La géométrie d'un bloc — les quatre seules colonnes que la tranche 2a écrit.
 *
 * Elle est nommée à part du bloc parce qu'un geste de canevas ne touche jamais autre chose : le
 * titre, le corps, la couleur, le remplissage et le lien appartiennent à la tranche suivante, et
 * les mêler ici ferait envoyer des colonnes que le geste n'a pas modifiées.
 */
type Geometrie = {
	readonly x: number
	readonly y: number
	readonly largeur: number
	readonly hauteur: number
}

const geometrieDe = (bloc: BlocObjectif): Geometrie => ({
	x: bloc.pos_x,
	y: bloc.pos_y,
	largeur: bloc.width,
	hauteur: bloc.height,
})

/**
 * Deux géométries diffèrent-elles ?
 *
 * La comparaison est EXACTE et sans tolérance, parce que les deux membres sont déjà des entiers :
 * `bornerCoordonnee` et `bornerDimension` arrondissent avant que la valeur n'arrive ici. Une
 * tolérance en pixels rendrait un petit glissement volontaire indistinguable d'un clic, et ferait
 * ouvrir une fiche à la place d'un déplacement.
 */
const aBouge = (avant: Geometrie, apres: Geometrie): boolean =>
	avant.x !== apres.x || avant.y !== apres.y || avant.largeur !== apres.largeur || avant.hauteur !== apres.hauteur

const avecGeometrie = (bloc: BlocObjectif, geometrie: Geometrie): BlocObjectif => ({
	...bloc,
	pos_x: geometrie.x,
	pos_y: geometrie.y,
	width: geometrie.largeur,
	height: geometrie.hauteur,
})

/**
 * Ce que l'écran dit d'une écriture — trois mentions, jamais deux à la fois
 * (`docs/DESIGN_SYSTEM.md` §5.7 ter).
 */
type MessageEcriture = { readonly ton: 'attente' | 'succes' | 'refus'; readonly texte: string }

/**
 * Traduit un refus par son DICTIONNAIRE FERMÉ. Un message de serveur n'est pas un texte
 * d'interface (`docs/DESIGN_SYSTEM.md` §10), et `detail` ne sort jamais du module d'écriture.
 */
export function texteRefusBloc(refus: RefusBloc): string {
	if (refus.nature === 'interdit') return t('goals.write.refused.forbidden')
	if (refus.nature === 'saisie-invalide') return t('goals.write.refused.invalid')
	return t('goals.write.refused.unavailable')
}

/**
 * Traduit un refus de FLÈCHE, et son dictionnaire est distinct de celui du bloc.
 *
 * LES QUATRE NATURES DISENT QUATRE GESTES DIFFÉRENTS, et c'est ce qui interdit de réemployer le
 * dictionnaire des blocs : un doublon s'apprend et se corrige ailleurs (§2.3, « changer la
 * direction d'une flèche existante est une modification, pas un ajout »), un refus de droit porte
 * sur les DEUX blocs reliés (§4.2), et « vous ne pouvez pas modifier ce tableau » ne dirait ni l'un
 * ni l'autre.
 */
export function texteRefusFleche(refus: RefusFleche): string {
	if (refus.nature === 'doublon') return t('goals.link.refused.duplicate')
	if (refus.nature === 'interdit') return t('goals.link.refused.forbidden')
	if (refus.nature === 'saisie-invalide') return t('goals.link.refused.invalid')
	return t('goals.link.refused.unavailable')
}

/**
 * Traduit un refus de SUPPRESSION de bloc.
 *
 * SON DICTIONNAIRE EST DISTINCT DE CELUI DE LA MODIFICATION, et pas par symétrie : « vous ne
 * pouvez pas modifier ce tableau » décrirait mal un geste qui détruit, et l'utilisateur chercherait
 * ce qu'il vient d'écrire. La nature `saisie-invalide` n'a ici aucun emploi — une suppression
 * n'envoie aucune valeur —, et elle retombe donc sur l'indisponibilité plutôt que d'inventer un
 * texte pour une issue que la base ne produit pas.
 */
export function texteRefusSuppressionBloc(refus: RefusBloc): string {
	if (refus.nature === 'interdit') return t('goals.delete.refused.block')
	return t('goals.delete.refused.unavailable')
}

/** Traduit un refus de suppression de FLÈCHE — il porte sur les DEUX blocs reliés (§4.2). */
export function texteRefusSuppressionFleche(refus: RefusFleche): string {
	if (refus.nature === 'interdit') return t('goals.delete.refused.link')
	return t('goals.delete.refused.unavailable')
}

/**
 * Direction → clé de son nom en clair, ÉCRITE LITTÉRALEMENT, pour la raison déjà nommée en
 * `NOMS_COULEUR` : une clé construite est une clé que le détecteur de clés mortes ne peut plus
 * suivre, et qui survit à la suppression du code qui l'employait.
 */
const NOMS_DIRECTION = {
	forward: 'goals.link.direction.forward',
	backward: 'goals.link.direction.backward',
	both: 'goals.link.direction.both',
} as const

/**
 * Le geste EN COURS de tracé d'une flèche (§5.5).
 *
 * `idSource` vaut `null` pendant la première moitié du geste — la commande est armée, le bloc de
 * départ n'est pas encore désigné. Cette moitié n'existe QUE pour la souris : au clavier, `Espace`
 * sur un bloc arme et désigne d'un seul coup, puisque le bloc est déjà focalisé. Les deux entrées
 * convergent ensuite sur le même second geste.
 */
type TraceEnCours = { readonly idSource: string | null; readonly direction: DirectionFleche }

/**
 * Ce qu'un bloc peut recevoir comme geste d'activation, et ce que le canevas en fait DÉPEND de
 * l'état du tracé — c'est pourquoi le bloc ne décide de rien lui-même.
 *
 * `espace` arme un tracé quand rien n'est armé ; `entree` et `clic` ouvrent alors la fiche. Une
 * fois le tracé armé, LES TROIS gestes veulent dire la même chose — « ce bloc-ci » —, et c'est ce
 * qui donne à la souris et au clavier exactement le même parcours.
 */
type GesteBloc = 'clic' | 'entree' | 'espace'

/**
 * Les deux gestes de géométrie. Ils ne se confondent pas, et c'est ce qui décide des colonnes
 * envoyées : réécrire les quatre à chaque fois écraserait le geste d'un collègue.
 */
type ModeGeste = 'deplacement' | 'taille'

/** Les quatre directions du clavier, en pas unitaires (§5.5). */
const DIRECTIONS_CLAVIER: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
}

/** Canevas d'un tableau — §5.2, et depuis la tranche 2a les gestes de géométrie du §3. */
export function CanevasObjectifs({ client = clientCrm }: ProprietesCanevas = {}) {
	const { idTableau } = useParams<{ idTableau: string }>()
	const { etat, recharger } = useContenuTableau(client, idTableau ?? null)
	const [rangZoom, setRangZoom] = useState<number>(ZOOM_PAR_DEFAUT)
	// Le workspace courant est le premier rendu, patron de la liste des tableaux ci-dessus. Il ne
	// sert QU'au sélecteur de destination : le tableau, lui, est atteint par son identifiant.
	const { etat: etatWorkspaces } = useWorkspaces(client)

	// TROIS ÉTATS LOCAUX, ET ILS NE SE CONFONDENT PAS :
	//   * `ecrits` porte les lignes que le SERVEUR a rendues après une écriture — elles sont vraies,
	//     et les prendre évite une relecture pour une donnée déjà en main (§5.28) ;
	//   * `ajoutes` porte les blocs posés pendant cette session d'écran, pour la même raison ;
	//   * `ebauche` porte le geste EN COURS, qui n'est pas encore une donnée. Un refus l'efface, et
	//     le bloc revient à sa position d'origine (`docs/DESIGN_SYSTEM.md` §6).
	const [ecrits, setEcrits] = useState<ReadonlyMap<string, BlocObjectif>>(() => new Map())
	const [ajoutes, setAjoutes] = useState<readonly BlocObjectif[]>([])
	const [ebauche, setEbauche] = useState<{ readonly id: string; readonly geometrie: Geometrie } | null>(null)
	const [message, setMessage] = useState<MessageEcriture | null>(null)
	const [pose, setPose] = useState<{ readonly x: number; readonly y: number } | null>(null)
	// LES FLÈCHES ONT LEURS DEUX ÉTATS LOCAUX, pour la même raison que les blocs : `flechesEcrites`
	// porte les lignes que le serveur a rendues après une correction de direction, `flechesTracees`
	// celles créées pendant cette session d'écran. Le tracé EN COURS, lui, n'est pas une donnée —
	// c'est un geste, et il tombe dès qu'il aboutit ou qu'il est annulé.
	const [flechesEcrites, setFlechesEcrites] = useState<ReadonlyMap<string, FlecheObjectif>>(() => new Map())
	const [flechesTracees, setFlechesTracees] = useState<readonly FlecheObjectif[]>([])
	const [trace, setTrace] = useState<TraceEnCours | null>(null)
	// LA FICHE EST DÉSIGNÉE PAR UN IDENTIFIANT, jamais par une copie du bloc : le bloc rendu vient
	// de `blocsRendus` et change à chaque écriture, tandis que la fiche doit rester ouverte SUR LE
	// MÊME bloc à travers ces changements.
	const [edite, setEdite] = useState<string | null>(null)
	// LES SUPPRESSIONS TIENNENT LEUR PROPRE ÉTAT, et il est de RETRAIT là où `ecrits` et `ajoutes`
	// sont de remplacement et d'ajout : une ligne supprimée n'a plus aucune valeur à rendre,
	// seulement une absence à opposer à ce que la lecture du serveur porte encore.
	const [blocsSupprimes, setBlocsSupprimes] = useState<ReadonlySet<string>>(() => new Set())
	const [flechesSupprimees, setFlechesSupprimees] = useState<ReadonlySet<string>>(() => new Set())

	const contenu = etat.statut === 'pret' ? etat.donnees : null

	// LA LISTE DES CHANNELS NE PART QU'À LA PREMIÈRE FICHE OUVERTE. Elle ne sert qu'au sélecteur de
	// destination, et la charger à l'ouverture du tableau ferait payer une requête sur tous les
	// channels du workspace à toutes les visites qui ne font que regarder le canevas.
	const idWorkspace = etatWorkspaces.statut === 'pret' ? (etatWorkspaces.donnees[0]?.id ?? null) : null
	const { etat: etatChannels, recharger: rechargerChannels } = useChannelsLiables(
		client,
		idWorkspace,
		edite !== null,
	)

	// Une relecture rapporte l'état du serveur : ce qui était gardé localement devient alors
	// périmé, et le conserver ferait rendre deux fois la même donnée.
	useEffect(() => {
		setEcrits(new Map())
		setAjoutes([])
		setEbauche(null)
		setFlechesEcrites(new Map())
		setFlechesTracees([])
		setBlocsSupprimes(new Set())
		setFlechesSupprimees(new Set())
		// LE TRACÉ EN COURS TOMBE AVEC LA RELECTURE, et ce n'est pas une commodité : son bloc de
		// départ peut ne plus être rendu, et une flèche partant d'un bloc disparu serait tracée vers
		// une origine que l'écran ne montre plus.
		setTrace(null)
	}, [contenu])

	// LA FICHE SE FERME SI SON BLOC N'EST PLUS RENDU. Une relecture peut le retirer — la RLS a
	// changé, un collègue l'a supprimé —, et une fiche restée ouverte sur un bloc absent
	// n'écrirait plus que dans le vide, en disant « Enregistré » à chaque tentative.
	useEffect(() => {
		if (edite === null) return
		const present =
			(contenu?.blocs ?? []).some((bloc) => bloc.id === edite) || ajoutes.some((bloc) => bloc.id === edite)
		if (!present) setEdite(null)
	}, [contenu, ajoutes, edite])

	// L'ORDRE DE TABULATION EST CALCULÉ SUR L'ÉTAT DU SERVEUR, JAMAIS SUR L'ÉBAUCHE. Le trier
	// pendant un déplacement ferait sauter le bloc d'une place à l'autre de l'ordre du clavier
	// sous les doigts de celui qui le déplace — le défaut que le §5.31 nomme pour une table de
	// saisie, transposé au canevas.
	const blocs = useMemo(() => {
		const lus = (contenu?.blocs ?? []).map((bloc) => ecrits.get(bloc.id) ?? bloc)
		return ordreTabulation([...lus, ...ajoutes].filter((bloc) => !blocsSupprimes.has(bloc.id)))
	}, [contenu, ecrits, ajoutes, blocsSupprimes])

	const blocsRendus = useMemo(
		() => blocs.map((bloc) => (ebauche !== null && ebauche.id === bloc.id ? avecGeometrie(bloc, ebauche.geometrie) : bloc)),
		[blocs, ebauche],
	)

	// Les flèches rendues suivent le patron des blocs : la ligne écrite remplace la ligne lue, et
	// celles tracées pendant cette session s'ajoutent à la fin — dans l'ordre où elles ont été
	// tracées, qui est celui que `created_at` leur donnera au prochain chargement.
	// LA FLÈCHE D'UN BLOC SUPPRIMÉ DISPARAÎT, ELLE NE DEVIENT PAS UN MOIGNON POINTILLÉ, et cette
	// distinction est celle de deux causes que rien ne rapproche : le moignon du §5.4 rend une
	// flèche dont une extrémité EXISTE mais que la RLS masque — la ligne est bien là en base. Ici
	// la cascade du §2.3 l'a détruite avec le bloc, et la laisser pendre dessinerait un lien que
	// plus rien ne porte.
	const flechesRendues = useMemo(() => {
		const lues = (contenu?.fleches ?? []).map((fleche) => flechesEcrites.get(fleche.id) ?? fleche)
		return [...lues, ...flechesTracees].filter(
			(fleche) =>
				!flechesSupprimees.has(fleche.id) &&
				!blocsSupprimes.has(fleche.source_block_id) &&
				!blocsSupprimes.has(fleche.target_block_id),
		)
	}, [contenu, flechesEcrites, flechesTracees, flechesSupprimees, blocsSupprimes])

	const fleches = useMemo(
		() => composerDiagramme(blocsRendus, flechesRendues),
		[blocsRendus, flechesRendues],
	)
	const lignes = useMemo(
		() => listeTextuelleDiagramme(blocsRendus, flechesRendues),
		[blocsRendus, flechesRendues],
	)
	const etendue = useMemo(() => etendueCanevas(blocsRendus), [blocsRendus])

	// LE GESTE DÉCIDE DES COLONNES ENVOYÉES, ET C'EST UN DÉFAUT TROUVÉ PAR LA PREUVE : écrite
	// d'abord avec les quatre colonnes à chaque fois, cette fonction faisait qu'un simple
	// déplacement RÉÉCRIVAIT la taille — donc écrasait le redimensionnement qu'un collègue venait
	// de faire, avec la valeur que l'écran avait chargée. Un déplacement n'envoie que la position,
	// un redimensionnement que la taille.
	const enregistrerGeometrie = useCallback(
		async (idBloc: string, geometrie: Geometrie, mode: ModeGeste) => {
			if (client === null) return
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await ecrireGeometrieBloc(
				client,
				idBloc,
				mode === 'deplacement'
					? { x: geometrie.x, y: geometrie.y }
					: { largeur: geometrie.largeur, hauteur: geometrie.hauteur },
			)
			// L'ébauche tombe dans les TROIS issues : sur un succès la ligne rendue la remplace, sur
			// un refus comme sur un silence le bloc reprend sa position d'origine. La laisser en
			// place sur un refus afficherait un déplacement qui n'a pas eu lieu.
			setEbauche((courante) => (courante !== null && courante.id === idBloc ? null : courante))
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusBloc(resultat.refus) })
				return
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.write.noeffect') })
				return
			}
			setEcrits((precedents) => new Map(precedents).set(idBloc, resultat.bloc))
			setMessage({ ton: 'succes', texte: t('goals.write.saved') })
		},
		[client],
	)

	/**
	 * Écrit UN champ de contenu, et rend l'issue à la fiche.
	 *
	 * La mention d'état n'est PAS posée ici : elle vit sous le champ concerné
	 * (`docs/DESIGN_SYSTEM.md` §5.7 ter), et le canevas n'a aucun moyen de savoir lequel. Le canevas
	 * ne garde donc que ce qui est à lui — la ligne rendue par le serveur, qui remet le bloc à jour
	 * derrière la fiche.
	 */
	const enregistrerContenu = useCallback(
		async (idBloc: string, contenu: ContenuBloc): Promise<ResultatEcritureBloc> => {
			if (client === null) return { statut: 'sans-effet' }
			const resultat = await ecrireContenuBloc(client, idBloc, contenu)
			if (resultat.statut === 'enregistree') {
				setEcrits((precedents) => new Map(precedents).set(idBloc, resultat.bloc))
			}
			return resultat
		},
		[client],
	)

	/**
	 * Écrit le LIEN d'un bloc — la destination choisie, ou `null` pour la retirer.
	 *
	 * Elle est distincte d'`enregistrerContenu` alors qu'elle touche la même ligne, et c'est le
	 * §4.2 qui l'impose : `channel_id` est la seule colonne dont l'écriture met en jeu un droit sur
	 * une AUTRE table que `goal_blocks`. La confondre avec les quatre champs de contenu ferait
	 * traduire son refus par le texte des autres, qui ne dirait pas ce qui manque.
	 */
	const enregistrerLien = useCallback(
		async (idBloc: string, idChannel: string | null): Promise<ResultatEcritureBloc> => {
			if (client === null) return { statut: 'sans-effet' }
			const resultat = await lierBlocAChannel(client, idBloc, idChannel)
			if (resultat.statut === 'enregistree') {
				setEcrits((precedents) => new Map(precedents).set(idBloc, resultat.bloc))
			}
			return resultat
		},
		[client],
	)

	const poserA = useCallback(
		async (point: { readonly x: number; readonly y: number }) => {
			if (client === null || idTableau === undefined) return
			setPose(null)
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await poserBloc(client, {
				idTableau,
				x: point.x,
				y: point.y,
				titre: t('goals.place.title.default'),
			})
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusBloc(resultat.refus) })
				return
			}
			setAjoutes((precedents) => [...precedents, resultat.bloc])
			setMessage({ ton: 'succes', texte: t('goals.write.saved') })
		},
		[client, idTableau],
	)

	/**
	 * Trace la flèche du bloc de départ vers `idCible`, avec la direction choisie AVANT le geste.
	 *
	 * LE TRACÉ TOMBE AVANT LA RÉPONSE, et non après : le geste est fini — deux blocs ont été
	 * désignés —, et laisser la commande armée pendant la requête ferait qu'un second clic tracerait
	 * une deuxième flèche depuis le même départ. Le refus, lui, se lit dans la mention d'écriture.
	 */
	const tracerVers = useCallback(
		async (idCible: string) => {
			if (client === null || idTableau === undefined) return
			const depart = trace
			if (depart === null || depart.idSource === null) return
			setTrace(null)
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await tracerFleche(client, {
				idTableau,
				idSource: depart.idSource,
				idCible,
				direction: depart.direction,
			})
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusFleche(resultat.refus) })
				return
			}
			setFlechesTracees((precedentes) => [...precedentes, resultat.fleche])
			setMessage({ ton: 'succes', texte: t('goals.link.traced') })
		},
		[client, idTableau, trace],
	)

	/**
	 * Corrige la direction d'une flèche déjà tracée (§3).
	 *
	 * Les trois issues sont celles des blocs, et la troisième est ici la plus probable des trois :
	 * la politique de `goal_links` exige le droit d'écrire les DEUX blocs reliés, si bien qu'un
	 * appelant qui n'écrit pas l'un d'eux reçoit `200` et zéro ligne.
	 */
	const corrigerDirection = useCallback(
		async (idFleche: string, direction: DirectionFleche) => {
			if (client === null) return
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await changerDirectionFleche(client, idFleche, direction)
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusFleche(resultat.refus) })
				return
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.write.noeffect') })
				return
			}
			setFlechesEcrites((precedentes) => new Map(precedentes).set(idFleche, resultat.fleche))
			setMessage({ ton: 'succes', texte: t('goals.write.saved') })
		},
		[client],
	)

	/**
	 * Supprime un bloc, et retire de l'écran les flèches que la BASE emporte avec lui (§2.3, §3).
	 *
	 * LES TROIS ISSUES SONT TRAITÉES, et la troisième — `200` et zéro ligne — est ici la plus
	 * trompeuse de toutes : faire disparaître le bloc sur ce silence annoncerait une suppression
	 * qui n'a pas eu lieu, et le bloc reparaîtrait au rechargement (`docs/DESIGN_SYSTEM.md` §5.27).
	 * L'écran ne retire donc rien tant que le serveur n'a pas rendu la ligne retirée.
	 *
	 * LA FICHE SE FERME SEULE, par l'effet qui la ferme dès que son bloc n'est plus rendu : ce
	 * geste part d'elle, et la refermer ici la fermerait DEUX fois sur la même cause.
	 */
	const supprimerLeBloc = useCallback(
		async (idBloc: string) => {
			if (client === null) return
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await supprimerBloc(client, idBloc)
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusSuppressionBloc(resultat.refus) })
				return
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.delete.noeffect.block') })
				return
			}
			setBlocsSupprimes((precedents) => new Set(precedents).add(idBloc))
			setMessage({ ton: 'succes', texte: t('goals.block.deleted') })
		},
		[client],
	)

	/**
	 * Supprime une flèche, et laisse ses deux blocs intacts (§3).
	 *
	 * Le refus emprunte le dictionnaire des flèches : la politique de `goal_links` exige le droit
	 * d'écrire les DEUX blocs (§4.2), et « vous ne pouvez pas supprimer ce bloc » enverrait chercher
	 * le problème du mauvais côté.
	 */
	const supprimerLaFleche = useCallback(
		async (idFleche: string) => {
			if (client === null) return
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await supprimerFleche(client, idFleche)
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusSuppressionFleche(resultat.refus) })
				return
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.delete.noeffect.link') })
				return
			}
			setFlechesSupprimees((precedentes) => new Set(precedentes).add(idFleche))
			setMessage({ ton: 'succes', texte: t('goals.link.deleted') })
		},
		[client],
	)

	/**
	 * CE QU'UN GESTE SUR UN BLOC VEUT DIRE DÉPEND DE L'ÉTAT DU TRACÉ, et c'est le canevas qui en
	 * décide — le bloc, lui, ne connaît que son propre geste.
	 *
	 * Hors tracé, `Espace` arme un tracé depuis ce bloc, tandis que `Entrée` et le clic ouvrent la
	 * fiche : les deux gestes du §5.5 ne se recouvrent pas. Une fois un tracé armé, LES TROIS gestes
	 * désignent ce bloc — c'est ce qui donne à la souris et au clavier le même parcours.
	 *
	 * REDÉSIGNER LE BLOC DE DÉPART ANNULE LE TRACÉ, et cette règle remplace un refus : le §2.3
	 * interdit la flèche d'un bloc vers lui-même, mais lui faire traverser le réseau pour en
	 * recevoir `goal_links_boucle_check` apprendrait à l'utilisateur qu'il vient d'échouer, là où il
	 * vient simplement de se raviser. La contrainte reste la garde de la base ; elle n'est pas
	 * dédoublée ici, elle est laissée SANS EMPLOI par le geste.
	 */
	const activerBloc = useCallback(
		(idBloc: string, geste: GesteBloc) => {
			if (trace === null) {
				if (geste === 'espace') {
					setPose(null)
					setTrace({ idSource: idBloc, direction: 'forward' })
					return
				}
				setEdite(idBloc)
				return
			}
			if (trace.idSource === null) {
				setTrace({ ...trace, idSource: idBloc })
				return
			}
			if (trace.idSource === idBloc) {
				setTrace(null)
				return
			}
			void tracerVers(idBloc)
		},
		[trace, tracerVers],
	)

	if (client === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('goals.error.title')}
				corps={t('goals.error.body')}
				libelleReprise={t('goals.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	if (contenu === null || contenu.tableau === null) {
		return (
			<EtatVide
				titre={t('goals.board.notfound.title')}
				corps={t('goals.board.notfound.body')}
				action={<RetourListe />}
			/>
		)
	}

	// Le rang est borné par les deux commandes ; le repli protège d'un état impossible plutôt que
	// de laisser une échelle `undefined` produire un canevas invisible.
	const zoom = ZOOMS[rangZoom] ?? 1

	// LE CANEVAS EST RENDU DÈS QU'UNE POSE EST ARMÉE, MÊME SUR UN TABLEAU VIDE : c'est la surface
	// sur laquelle le geste se fait, et l'état vide qui la remplacerait n'aurait aucun endroit où
	// recevoir le clic. L'état vide porte donc le geste qui le comble
	// (`docs/DESIGN_SYSTEM.md` §5.13).
	const canevasRendu = blocsRendus.length > 0 || pose !== null

	// Le bloc de la fiche est relu dans la liste RENDUE, et non gardé en état : c'est ainsi que la
	// fiche affiche la valeur du serveur dès qu'une écriture aboutit, sans la recopier.
	const blocEdite = blocsRendus.find((bloc) => bloc.id === edite) ?? null

	// LE COMPTE DES FLÈCHES DU BLOC ÉDITÉ EST CELUI DES FLÈCHES RENDUES, jamais un total de la
	// base : une flèche dont l'autre extrémité est masquée par la RLS pend déjà dans le vide
	// (§5.4), et la confirmation de suppression ne peut annoncer que ce que celui qui la lit
	// verra disparaître.
	const flechesDuBlocEdite =
		blocEdite === null
			? 0
			: flechesRendues.filter(
					(fleche) => fleche.source_block_id === blocEdite.id || fleche.target_block_id === blocEdite.id,
				).length

	return (
		<section aria-label={t('goals.canvas.aria')} className="flex flex-col gap-4">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-h3">{contenu.tableau.name}</h2>
					{contenu.tableau.description === null ? null : (
						<p className="text-sm text-text-2 max-w-[70ch]">{contenu.tableau.description}</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					<RetourListe />
					<CommandePose
						armee={pose !== null}
						onBasculer={() => {
							setTrace(null)
							setPose(pose === null ? { x: PAS_CLAVIER * 3, y: PAS_CLAVIER * 3 } : null)
						}}
					/>
					{/* LA COMMANDE DE TRACÉ N'EST RENDUE QU'À PARTIR DE DEUX BLOCS, et ce n'est pas une
					    extinction selon le rôle (`docs/DESIGN_SYSTEM.md` §5.26) : une flèche relie
					    deux blocs, et il n'y en a pas deux à relier. C'est la même raison qui ne rend
					    « Retirer le lien » que lorsqu'il y a un lien à retirer — un bouton qui n'a
					    rien à faire est une commande morte (§5.21). */}
					{blocsRendus.length < 2 ? null : (
						<CommandeTrace
							armee={trace !== null}
							onBasculer={() => {
								setPose(null)
								setTrace(trace === null ? { idSource: null, direction: 'forward' } : null)
							}}
						/>
					)}
					<CommandesZoom rang={rangZoom} onChanger={setRangZoom} />
				</div>
			</header>

			{pose === null ? null : (
				<p data-testid="pose-consigne" className="text-sm text-text-2">
					{t('goals.place.hint')}
				</p>
			)}

			{/* LE BANDEAU DE TRACÉ PORTE LA DIRECTION, et il la porte AVANT le second bloc : le §3
			    demande « choix de la direction à la création », ce qui n'a de sens que si le choix
			    précède le geste qui crée. Une flèche tracée puis corrigée serait deux écritures là
			    où l'utilisateur n'a voulu qu'une flèche. */}
			{trace === null ? null : (
				<div
					data-testid="trace-consigne"
					className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-brand bg-brand-soft px-3 py-2"
				>
					<p id="objectifs-consigne-trace" className="text-sm text-ink max-w-[70ch]">
						{trace.idSource === null
							? t('goals.link.hint.start')
							: `${t('goals.link.armed', { titre: titreDe(blocsRendus, trace.idSource) })} ${t('goals.link.hint')}`}
					</p>
					<fieldset data-testid="direction-trace" className="flex flex-wrap items-center gap-2">
						<legend className="sr-only">{t('goals.link.direction.legend')}</legend>
						{DIRECTIONS_FLECHE.map((option) => (
							<label
								key={option}
								data-testid={`direction-${option}`}
								className={[
									'inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border bg-surface cursor-pointer',
									trace.direction === option ? 'border-brand' : 'border-border hover:bg-hover',
								].join(' ')}
							>
								<input
									type="radio"
									name="objectifs-direction-trace"
									value={option}
									checked={trace.direction === option}
									className="size-4 accent-brand"
									onChange={() => setTrace({ ...trace, direction: option })}
								/>
								<span className="text-sm">{t(NOMS_DIRECTION[option])}</span>
							</label>
						))}
					</fieldset>
					<Button variante="secondaire" taille="compacte" data-testid="annuler-trace" onClick={() => setTrace(null)} className="gap-2">
						<X aria-hidden="true" size={16} strokeWidth={2} />
						{t('goals.link.cancel')}
					</Button>
				</div>
			)}

			{/* La consigne clavier est CITÉE par chaque bloc en `aria-describedby` : un geste qui
			    n'existe qu'au clavier doit être annoncé au clavier, faute de quoi il n'existe pour
			    personne. Elle est visuellement masquée, jamais retirée (§12.3). */}
			<p id="objectifs-consigne-clavier" className="sr-only">
				{t('goals.block.keyboard.hint')}
			</p>

			{canevasRendu ? (
				/* La zone est PANNABLE au défilement — souris, molette, et touches de direction du
				   navigateur une fois le conteneur focalisé —, et ZOOMABLE par les deux commandes
				   ci-dessus. `tabIndex` sur le conteneur est ce qui rend le défilement clavier
				   possible : sans lui, une région défilante ne reçoit jamais le focus. */
				<div
					data-testid="canevas-objectifs"
					tabIndex={0}
					role="group"
					aria-label={t('goals.canvas.aria')}
					className="relative overflow-auto rounded-lg border border-border bg-bg max-h-[70vh] focus-visible:outline-2 focus-visible:outline-brand"
				>
					<div
						data-testid="canevas-surface"
						className="relative origin-top-left"
						style={{
							width: `${etendue.largeur}px`,
							height: `${etendue.hauteur}px`,
							transform: `scale(${zoom})`,
						}}
						/* LA POSITION VIENT DU GESTE (§3) : le point du clic devient le coin haut
						   gauche du bloc, sans placement automatique, sans recherche de place libre
						   et sans alignement sur une grille. */
						onClick={
							pose === null
								? undefined
								: (evenement) => {
										const cadre = evenement.currentTarget.getBoundingClientRect()
										void poserA({
											x: bornerCoordonnee((evenement.clientX - cadre.left) / zoom),
											y: bornerCoordonnee((evenement.clientY - cadre.top) / zoom),
										})
									}
						}
					>
						<TraitsDuDiagramme fleches={fleches} etendue={etendue} />
						{blocsRendus.map((bloc) => (
							<BlocCanevas
								key={bloc.id}
								bloc={bloc}
								zoom={zoom}
								edite={bloc.id === edite}
								traceArmee={trace !== null}
								departDuTrace={trace?.idSource === bloc.id}
								onEbauche={(geometrie) => setEbauche({ id: bloc.id, geometrie })}
								onFin={(geometrie, mode) => void enregistrerGeometrie(bloc.id, geometrie, mode)}
								onActiver={(geste) => activerBloc(bloc.id, geste)}
								onAnnulerTrace={() => setTrace(null)}
							/>
						))}
						{pose === null ? null : (
							<RepereDePose
								position={pose}
								onDeplacer={setPose}
								onValider={() => void poserA(pose)}
								onAnnuler={() => setPose(null)}
							/>
						)}
					</div>
				</div>
			) : (
				<EtatVide
					titre={t('goals.board.empty.title')}
					corps={t('goals.board.empty.body')}
					action={
						<CommandePose armee={false} onBasculer={() => setPose({ x: PAS_CLAVIER * 3, y: PAS_CLAVIER * 3 })} />
					}
				/>
			)}

			<MentionEcriture message={message} />

			{/* LA FICHE VIT SOUS LE CANEVAS, jamais en surimpression : le bloc qu'elle édite doit
			    rester visible pendant la saisie — c'est lui qui montre l'effet de la couleur et du
			    remplissage —, et une fenêtre posée par-dessus le cacherait une fois sur deux
			    (`docs/DESIGN_SYSTEM.md` §5.13, l'état se lit près de ce qu'il concerne). */}
			{blocEdite === null ? null : (
				<FicheEditionBloc
					key={blocEdite.id}
					bloc={blocEdite}
					etatChannels={etatChannels}
					flechesDuBloc={flechesDuBlocEdite}
					onSupprimer={() => void supprimerLeBloc(blocEdite.id)}
					onRechargerChannels={rechargerChannels}
					onEcrire={(contenu) => enregistrerContenu(blocEdite.id, contenu)}
					onLier={(idChannel) => enregistrerLien(blocEdite.id, idChannel)}
					onFermer={() => {
						setEdite(null)
						// Le focus REVIENT au bloc, faute de quoi la fermeture le renverrait au début
						// du document et le clavier perdrait sa place sur le canevas (§5.13).
						const cible = document.querySelector<HTMLElement>(`[data-bloc="${blocEdite.id}"]`)
						cible?.focus()
					}}
				/>
			)}

			<EquivalentTextuel
				lignes={lignes}
				onChangerDirection={corrigerDirection}
				onSupprimerFleche={(idFleche) => void supprimerLaFleche(idFleche)}
			/>
		</section>
	)
}

/**
 * Titre du bloc désigné, ou la chaîne vide s'il n'est plus rendu.
 *
 * LE REPLI EST MUET, et il l'est pour la règle du §4.1 : l'écran ne nomme jamais ce qu'il cache. Un
 * bloc dont le tracé partait et qui n'est plus rendu ne devient pas « bloc masqué » dans le
 * bandeau ; la phrase perd simplement son titre.
 */
function titreDe(blocs: readonly BlocObjectif[], idBloc: string): string {
	return blocs.find((bloc) => bloc.id === idBloc)?.title ?? ''
}

/**
 * La commande qui arme la pose, et l'annule — DEUX VISAGES, UN SEUL RENDU À LA FOIS, patron du
 * §5.3 quater. Elle n'est jamais éteinte selon le rôle (`docs/DESIGN_SYSTEM.md` §5.26) : la
 * lectrice l'ouvre, pose, et lit le refus du backend.
 */
function CommandePose({ armee, onBasculer }: { readonly armee: boolean; readonly onBasculer: () => void }) {
	return (
		<Button
			variante={armee ? 'secondaire' : 'primaire'}
			taille="compacte"
			data-testid="poser-bloc"
			aria-pressed={armee}
			onClick={onBasculer}
			className="gap-2"
		>
			{armee ? <X aria-hidden="true" size={16} strokeWidth={2} /> : <SquarePlus aria-hidden="true" size={16} strokeWidth={2} />}
			{armee ? t('goals.place.cancel') : t('goals.place.start')}
		</Button>
	)
}

/**
 * La commande qui arme le tracé d'une flèche, et l'annule — LA MOITIÉ SOURIS du geste du §5.5.
 *
 * Au clavier, `Espace` sur un bloc arme ET désigne le départ d'un seul coup, le bloc étant déjà
 * focalisé. À la souris, aucun bloc ne l'est : il faut donc une commande qui ouvre le geste, puis
 * deux clics. Sans elle, tracer une flèche serait un geste de clavier, et la parité des deux
 * entrées (`docs/DESIGN_SYSTEM.md` §8) serait tenue en apparence seulement.
 */
function CommandeTrace({ armee, onBasculer }: { readonly armee: boolean; readonly onBasculer: () => void }) {
	return (
		<Button
			variante="secondaire"
			taille="compacte"
			data-testid="tracer-fleche"
			aria-pressed={armee}
			onClick={onBasculer}
			className="gap-2"
		>
			{armee ? <X aria-hidden="true" size={16} strokeWidth={2} /> : <MoveRight aria-hidden="true" size={16} strokeWidth={2} />}
			{armee ? t('goals.link.cancel') : t('goals.link.start')}
		</Button>
	)
}

/**
 * Le repère de pose — la moitié CLAVIER du geste de pose.
 *
 * Sans lui, poser un bloc serait un geste de souris, et le §5.5 serait tenu en apparence
 * seulement. Il porte la position que les flèches déplacent, `Entrée` valide et `Échap` annule ;
 * son nom accessible ÉCRIT la position, faute de quoi un utilisateur au lecteur d'écran
 * déplacerait un repère sans savoir où il est.
 */
function RepereDePose({
	position,
	onDeplacer,
	onValider,
	onAnnuler,
}: {
	readonly position: { readonly x: number; readonly y: number }
	readonly onDeplacer: (position: { readonly x: number; readonly y: number }) => void
	readonly onValider: () => void
	readonly onAnnuler: () => void
}) {
	const repere = useRef<HTMLDivElement | null>(null)

	// Le focus entre dans le repère dès qu'il est armé (`docs/DESIGN_SYSTEM.md` §5.13) : un repère
	// que les flèches ne pilotent qu'après un `Tab` supplémentaire ne serait pas le geste clavier
	// que le §5.5 demande.
	useEffect(() => {
		repere.current?.focus()
	}, [])

	return (
		<div
			ref={repere}
			data-testid="repere-pose"
			tabIndex={0}
			role="application"
			aria-label={t('goals.place.marker', { x: String(position.x), y: String(position.y) })}
			className="absolute rounded-lg border-2 border-brand bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
			style={{
				left: `${position.x}px`,
				top: `${position.y}px`,
				width: `${TAILLE_BLOC_NEUF.largeur}px`,
				height: `${TAILLE_BLOC_NEUF.hauteur}px`,
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') {
					evenement.preventDefault()
					onAnnuler()
					return
				}
				if (evenement.key === 'Enter' || evenement.key === ' ') {
					evenement.preventDefault()
					onValider()
					return
				}
				const direction = DIRECTIONS_CLAVIER[evenement.key]
				if (direction === undefined) return
				evenement.preventDefault()
				const pas = evenement.shiftKey ? PAS_CLAVIER_FIN : PAS_CLAVIER
				onDeplacer({
					x: bornerCoordonnee(position.x + direction[0] * pas),
					y: bornerCoordonnee(position.y + direction[1] * pas),
				})
			}}
		/>
	)
}

/**
 * Les trois mentions d'une écriture, jamais deux à la fois (`docs/DESIGN_SYSTEM.md` §5.7 ter).
 *
 * Elle vit SOUS le canevas, près de ce qu'elle concerne (§5.13) : un geste de géométrie porte sur
 * le canevas entier, et non sur une ligne d'un tableau. La région est TOUJOURS rendue, pour qu'un
 * lecteur d'écran ne découvre pas une région qui apparaît — un refus porte `role="alert"`, une
 * attente et une confirmation `role="status"`.
 */
function MentionEcriture({ message }: { readonly message: MessageEcriture | null }) {
	const TONS: Readonly<Record<MessageEcriture['ton'], string>> = {
		attente: 'text-text-3',
		succes: 'text-success',
		refus: 'text-danger-on-soft bg-danger-soft rounded-sm px-2 py-1',
	}
	return (
		<p
			data-testid="mention-ecriture"
			role={message?.ton === 'refus' ? 'alert' : 'status'}
			className={['text-sm', message === null ? '' : TONS[message.ton]].join(' ')}
		>
			{message?.texte ?? ''}
		</p>
	)
}

/** Les cinq champs de la fiche. Chacun porte SA mention d'état (`docs/DESIGN_SYSTEM.md` §5.7 ter). */
type ChampFiche = 'titre' | 'corps' | 'couleur' | 'remplissage' | 'lien'

/**
 * Le contrôle NE PORTE PAS SA LARGEUR, et ce n'est pas une omission — c'est un défaut trouvé en
 * regardant une capture (`CLAUDE.md` §16).
 *
 * Écrites d'abord avec `w-full`, ces classes rendaient le champ numérique du remplissage large de
 * toute la fiche, malgré le `w-[10ch]` ajouté derrière lui : **l'ordre des classes dans l'attribut
 * ne décide de rien**, c'est l'ordre des règles dans la feuille qui tranche, et deux utilitaires de
 * largeur du même espace de noms s'y disputent sans arbitre. La largeur est donc posée par chaque
 * champ, une seule fois.
 */
const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] px-3 py-2',
	'rounded-sm border border-border bg-surface text-base text-ink',
].join(' ')

/**
 * La fiche d'édition d'un bloc — `docs/SPEC-goals.md` §3 et §5.5, `docs/DESIGN_SYSTEM.md` §5.29.
 *
 * ELLE N'A AUCUN BOUTON « ENREGISTRER », et c'est le patron du §5.7 ter : chaque champ écrit sa
 * propre valeur dès qu'elle est ARRÊTÉE — la sortie du champ ou `Entrée` pour un texte, le
 * relâchement pour le curseur, le choix pour la couleur. Un bouton unique renverrait les quatre
 * colonnes à chaque fois et écraserait ce qu'un collègue vient d'écrire dans un autre champ du
 * même bloc, exactement le défaut que la tranche 2a a corrigé sur la géométrie.
 *
 * LE CURSEUR ET LE CHAMP NUMÉRIQUE ÉCRIVENT LA MÊME VALEUR (§3), et ce n'est pas une redite : ils
 * partagent un seul état et une seule fonction d'écriture. Deux chemins distincts divergeraient au
 * premier ajustement, et l'un des deux finirait par écrire autre chose que ce qu'il montre.
 *
 * AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (`docs/DESIGN_SYSTEM.md` §5.26) : la fiche
 * s'ouvre pour tous, envoie, et TRADUIT le refus. C'est la même règle que la tranche 2a, et la
 * contradiction avec le §5.4 de la spécification reste consignée en INC-170.
 */
function FicheEditionBloc({
	bloc,
	etatChannels,
	flechesDuBloc,
	onSupprimer,
	onRechargerChannels,
	onEcrire,
	onLier,
	onFermer,
}: {
	readonly bloc: BlocObjectif
	readonly etatChannels: EtatAsync<readonly ChannelLiable[]>
	readonly flechesDuBloc: number
	readonly onSupprimer: () => void
	readonly onRechargerChannels: () => void
	readonly onEcrire: (contenu: ContenuBloc) => Promise<ResultatEcritureBloc>
	readonly onLier: (idChannel: string | null) => Promise<ResultatEcritureBloc>
	readonly onFermer: () => void
}) {
	// LA SAISIE EST LOCALE, ET ELLE SURVIT AU REFUS. Un refus n'efface pas ce qui a été tapé
	// (§5.7 ter) : la valeur reste à l'écran avec son explication, là où la relire depuis le bloc
	// la remplacerait en silence par celle du serveur.
	const [titre, setTitre] = useState(bloc.title)
	const [corps, setCorps] = useState(bloc.body ?? '')
	const [remplissage, setRemplissage] = useState(String(bloc.fill_percent))
	// LA COULEUR EST GARDÉE LOCALEMENT COMME LES TROIS AUTRES CHAMPS, et pour une raison qui lui est
	// propre : un bouton radio dont l'état coché serait relu du serveur REVIENDRAIT à son ancienne
	// valeur le temps de la requête, sous les yeux de celui qui vient de cliquer.
	const [couleur, setCouleur] = useState(bloc.color)
	const [messages, setMessages] = useState<Readonly<Partial<Record<ChampFiche, MessageEcriture>>>>({})
	const [confirmeSuppression, setConfirmeSuppression] = useState(false)
	// LE RETOUR DU FOCUS EST DIFFÉRÉ D'UN TOUR DE RENDU, et c'est un DÉFAUT TROUVÉ PAR LA PREUVE :
	// la commande reste montée pendant sa confirmation, mais elle est DÉSACTIVÉE — et un bouton
	// désactivé refuse le focus. Appelé depuis le gestionnaire d'annulation, `focus()` visait donc
	// un bouton encore désactivé, et le focus retombait sur le document. C'est le remède du
	// `docs/DESIGN_SYSTEM.md` §5.25 — un drapeau, puis un effet —, ici pour une cause voisine mais
	// distincte : là-bas la commande est démontée, ici seulement éteinte. AUCUNE temporisation
	// (`CLAUDE.md` §18).
	const [rendreFocusSuppression, setRendreFocusSuppression] = useState(false)

	const champTitre = useRef<HTMLInputElement | null>(null)
	const commandeSuppression = useRef<HTMLButtonElement | null>(null)

	// LE FOCUS ENTRE DANS LA FICHE À SON OUVERTURE (`docs/DESIGN_SYSTEM.md` §5.13). Sans cela, la
	// fiche ouverte par `Entrée` obligerait à traverser tout le canevas au clavier pour l'atteindre,
	// et le geste du §5.5 ne serait tenu qu'en apparence.
	useEffect(() => {
		champTitre.current?.focus()
	}, [])

	useEffect(() => {
		if (!rendreFocusSuppression) return
		setRendreFocusSuppression(false)
		commandeSuppression.current?.focus()
	}, [rendreFocusSuppression])

	const ecrire = async (champ: ChampFiche, contenu: ContenuBloc) => {
		setMessages((precedents) => ({ ...precedents, [champ]: { ton: 'attente', texte: t('goals.write.saving') } }))
		const resultat = await onEcrire(contenu)
		const suite: MessageEcriture =
			resultat.statut === 'refus'
				? { ton: 'refus', texte: texteRefusBloc(resultat.refus) }
				: resultat.statut === 'sans-effet'
					? { ton: 'refus', texte: t('goals.write.noeffect') }
					: { ton: 'succes', texte: t('goals.write.saved') }
		// LA CONFIRMATION REMPLACE L'ENVOI, elle ne s'y ajoute pas (§5.7 ter) : deux mentions
		// superposées feraient croire à deux écritures.
		setMessages((precedents) => ({ ...precedents, [champ]: suite }))
	}

	/**
	 * Écrit le remplissage — LE SEUL CHEMIN, pour le curseur comme pour le champ.
	 *
	 * Une saisie illisible ne part PAS : `bornerRemplissage` rend `null`, et envoyer zéro à sa place
	 * serait la « valeur par défaut trompeuse » que `CLAUDE.md` §18 interdit. La saisie reste à
	 * l'écran, telle que tapée.
	 */
	const ecrireRemplissage = (brut: string) => {
		const valeur = bornerRemplissage(brut)
		if (valeur === null) return
		setRemplissage(String(valeur))
		if (valeur === bloc.fill_percent) return
		void ecrire('remplissage', { remplissage: valeur })
	}

	/**
	 * Écrit le lien — LE SEUL CHEMIN, pour le sélecteur comme pour le bouton de retrait.
	 *
	 * Le refus `interdit` porte ici SON PROPRE texte : « vous ne pouvez pas modifier ce tableau »
	 * serait faux quand c'est le droit d'écrire dans la DESTINATION qui manque (§4.2), et ferait
	 * chercher le problème du mauvais côté. Les deux autres natures gardent le dictionnaire commun.
	 */
	const ecrireLien = async (idChannel: string | null) => {
		if (idChannel === bloc.channel_id) return
		setMessages((precedents) => ({ ...precedents, lien: { ton: 'attente', texte: t('goals.write.saving') } }))
		const resultat = await onLier(idChannel)
		const suite: MessageEcriture =
			resultat.statut === 'refus'
				? {
						ton: 'refus',
						texte:
							resultat.refus.nature === 'interdit' && idChannel !== null
								? t('goals.edit.link.refused.forbidden')
								: texteRefusBloc(resultat.refus),
					}
				: resultat.statut === 'sans-effet'
					? { ton: 'refus', texte: t('goals.write.noeffect') }
					: { ton: 'succes', texte: t('goals.write.saved') }
		setMessages((precedents) => ({ ...precedents, lien: suite }))
	}

	// LES GROUPES SONT COMPOSÉS À CHAQUE RENDU DE LA LISTE REÇUE, jamais gardés en état : les garder
	// obligerait à les resynchroniser après chaque rechargement, et une liste périmée proposerait des
	// destinations disparues.
	const groupes = etatChannels.statut === 'pret' ? grouperChannelsParTrack(etatChannels.donnees) : []

	return (
		<section
			data-testid="fiche-bloc"
			aria-label={t('goals.edit.aria')}
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
			/* `Échap` ferme la fiche depuis N'IMPORTE lequel de ses champs, et rend le focus au bloc.
			   L'écoute est posée sur le conteneur plutôt que sur chaque contrôle : un raccourci qui
			   ne fonctionnerait que sur le premier champ serait un raccourci qu'on n'apprend pas. */
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				onFermer()
			}}
		>
			<header className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h3 className="text-sm font-medium text-ink">{t('goals.edit.title', { titre: bloc.title })}</h3>
					<p id="fiche-bloc-consigne" className="text-sm text-text-3">
						{t('goals.edit.hint')}
					</p>
				</div>
				<Button variante="secondaire" taille="compacte" data-testid="fermer-fiche" onClick={onFermer} className="gap-2">
					<X aria-hidden="true" size={16} strokeWidth={2} />
					{t('goals.edit.close')}
				</Button>
			</header>

			<div className="flex flex-col gap-1">
				<label htmlFor="fiche-bloc-titre" className="text-sm text-text-2">
					{t('goals.edit.field.title')}
				</label>
				<input
					ref={champTitre}
					id="fiche-bloc-titre"
					type="text"
					data-testid="champ-titre"
					value={titre}
					required
					aria-describedby="fiche-bloc-titre-aide fiche-bloc-titre-etat"
					className={[CLASSES_CONTROLE, 'w-full'].join(' ')}
					onChange={(evenement) => setTitre(evenement.target.value)}
					/* LA VALEUR EST ARRÊTÉE À LA SORTIE DU CHAMP OU SUR `Entrée`, jamais à la frappe :
					   écrire à chaque touche émettrait une requête par caractère. Aucune temporisation
					   n'est employée pour l'éviter (`CLAUDE.md` §18). */
					onBlur={() => {
						if (titre.trim() === bloc.title) return
						void ecrire('titre', { titre })
					}}
					onKeyDown={(evenement) => {
						if (evenement.key !== 'Enter') return
						evenement.preventDefault()
						if (titre.trim() === bloc.title) return
						void ecrire('titre', { titre })
					}}
				/>
				{/* L'ALERTE DE MANQUE ET LA MENTION D'ÉTAT COEXISTENT (§5.7 ter) : elles disent deux
				    choses différentes — le champ est exigé, et la dernière écriture a échoué —, et
				    `aria-describedby` les cite toutes les deux. */}
				<p id="fiche-bloc-titre-aide" className="text-sm text-text-3">
					{t('goals.edit.field.title.required')}
				</p>
				<MentionChamp identifiant="fiche-bloc-titre-etat" champ="titre" message={messages.titre ?? null} />
			</div>

			<div className="flex flex-col gap-1">
				<label htmlFor="fiche-bloc-corps" className="text-sm text-text-2">
					{t('goals.edit.field.body')}
				</label>
				<textarea
					id="fiche-bloc-corps"
					data-testid="champ-corps"
					rows={3}
					value={corps}
					aria-describedby="fiche-bloc-corps-aide fiche-bloc-corps-etat"
					className={[CLASSES_CONTROLE, 'w-full'].join(' ')}
					onChange={(evenement) => setCorps(evenement.target.value)}
					onBlur={() => {
						if (corps.trim() === (bloc.body ?? '')) return
						void ecrire('corps', { corps })
					}}
				/>
				<p id="fiche-bloc-corps-aide" className="text-sm text-text-3">
					{t('goals.edit.field.body.hint')}
				</p>
				<MentionChamp identifiant="fiche-bloc-corps-etat" champ="corps" message={messages.corps ?? null} />
			</div>

			{/* LA COULEUR EST UN GROUPE DE BOUTONS RADIO, et non une liste déroulante : cinq choix
			    visuels se comparent en un regard, et un `select` en cacherait quatre. Chaque option
			    porte son NOM EN CLAIR — la couleur ne porte jamais seule une information (§1). */}
			<fieldset className="flex flex-col gap-2" data-testid="champ-couleur">
				<legend className="text-sm text-text-2">{t('goals.edit.field.color')}</legend>
				<div className="flex flex-wrap gap-2">
					{COULEURS_BLOC.map((option) => (
						<label
							key={option}
							data-testid={`couleur-${option}`}
							className={[
								'inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border cursor-pointer',
								couleur === option ? 'border-brand bg-brand-soft' : 'border-border hover:bg-hover',
							].join(' ')}
						>
							<input
								type="radio"
								name="fiche-bloc-couleur"
								value={option}
								checked={couleur === option}
								className="size-4 accent-brand"
								onChange={() => {
									if (couleur === option) return
									setCouleur(option)
									void ecrire('couleur', { couleur: option })
								}}
							/>
							<span aria-hidden="true" className={['size-3 rounded-full', liseréDe(option)].join(' ')} />
							<span className="text-sm">{t(NOMS_COULEUR[option])}</span>
						</label>
					))}
				</div>
				<MentionChamp identifiant="fiche-bloc-couleur-etat" champ="couleur" message={messages.couleur ?? null} />
			</fieldset>

			<div className="flex flex-col gap-1">
				<label htmlFor="fiche-bloc-remplissage-nombre" className="text-sm text-text-2">
					{t('goals.edit.field.fill')}
				</label>
				<div className="flex items-center gap-3">
					{/* LE CURSEUR ÉCRIT AU RELÂCHEMENT, jamais à chaque pas : un glissement émettrait une
					    requête par pour cent parcouru. C'est la règle que le §5.5 pose pour les gestes de
					    géométrie, tenue ici par les mêmes moyens et sans temporisation. */}
					<input
						id="fiche-bloc-remplissage-curseur"
						type="range"
						data-testid="curseur-remplissage"
						min={REMPLISSAGE_MINIMAL}
						max={REMPLISSAGE_MAXIMAL}
						step={1}
						value={remplissage}
						aria-label={t('goals.edit.fill.slider')}
						aria-describedby="fiche-bloc-remplissage-aide fiche-bloc-remplissage-etat"
						className="grow accent-brand"
						onChange={(evenement) => setRemplissage(evenement.target.value)}
						onPointerUp={(evenement) => ecrireRemplissage(evenement.currentTarget.value)}
						onKeyUp={(evenement) => ecrireRemplissage(evenement.currentTarget.value)}
						onBlur={(evenement) => ecrireRemplissage(evenement.currentTarget.value)}
					/>
					<input
						id="fiche-bloc-remplissage-nombre"
						type="number"
						data-testid="champ-remplissage"
						min={REMPLISSAGE_MINIMAL}
						max={REMPLISSAGE_MAXIMAL}
						step={1}
						value={remplissage}
						aria-label={t('goals.edit.fill.number')}
						aria-describedby="fiche-bloc-remplissage-aide fiche-bloc-remplissage-etat"
						className={[CLASSES_CONTROLE, 'w-[10ch] tabular-nums'].join(' ')}
						onChange={(evenement) => setRemplissage(evenement.target.value)}
						onBlur={(evenement) => ecrireRemplissage(evenement.target.value)}
						onKeyDown={(evenement) => {
							if (evenement.key !== 'Enter') return
							evenement.preventDefault()
							ecrireRemplissage(evenement.currentTarget.value)
						}}
					/>
				</div>
				<p id="fiche-bloc-remplissage-aide" className="text-sm text-text-3">
					{t('goals.edit.fill.hint')}
				</p>
				<MentionChamp
					identifiant="fiche-bloc-remplissage-etat"
					champ="remplissage"
					message={messages.remplissage ?? null}
				/>
			</div>

			{/* LE LIEN EST UNE LISTE DÉROULANTE, là où la couleur est un groupe de radios : les
			    channels d'un workspace se comptent en dizaines et ne se comparent pas d'un regard.
			    Les `optgroup` portent le regroupement par track que le §3 demande — c'est le seul
			    moyen natif de grouper des options sans réécrire un sélecteur au clavier. */}
			<div className="flex flex-col gap-1">
				<label htmlFor="fiche-bloc-lien" className="text-sm text-text-2">
					{t('goals.edit.field.link')}
				</label>
				<div className="flex flex-wrap items-center gap-2">
					{/* PENDANT LA LECTURE DE SA LISTE ET APRÈS SON ÉCHEC, LE CONTRÔLE EST DÉSACTIVÉ —
					    §5.22, unique dérogation bornée à la règle du §5.7 ter. Ce n'est PAS une
					    extinction selon le rôle (§5.26) : il n'y a alors rien à choisir, et un
					    `select` vide mais actif serait la commande morte que le §5.21 refuse. Le
					    bouton de retrait, lui, reste offert : retirer ne demande aucune liste. */}
					<select
						id="fiche-bloc-lien"
						data-testid="champ-lien"
						value={bloc.channel_id ?? ''}
						disabled={etatChannels.statut !== 'pret'}
						aria-busy={etatChannels.statut === 'chargement'}
						aria-describedby="fiche-bloc-lien-aide fiche-bloc-lien-etat"
						className={[CLASSES_CONTROLE, 'grow min-w-[24ch] disabled:text-text-3'].join(' ')}
						onChange={(evenement) => {
							const valeur = evenement.target.value
							void ecrireLien(valeur === '' ? null : valeur)
						}}
					>
						{/* L'OPTION VIDE EST TOUJOURS PRÉSENTE, et c'est elle qui retire le lien au
						    clavier : un sélecteur dont on ne pourrait pas sortir enfermerait le bloc
						    dans sa première destination. */}
						<option value="">{t('goals.edit.link.none')}</option>
						{etatChannels.statut === 'chargement' ? (
							<option value="chargement" disabled>
								{t('goals.edit.link.loading')}
							</option>
						) : null}
						{groupes.map((groupe) => {
							const options = groupe.channels.map((channel) => (
								<option key={channel.id} value={channel.id}>
									{channel.nom}
								</option>
							))
							// Un channel dont le track n'est pas rendu n'a PAS de groupe nommé : il est
							// listé tel quel plutôt qu'affublé d'un intitulé inventé.
							return groupe.nomTrack === null ? (
								<Fragment key="sans-track">{options}</Fragment>
							) : (
								<optgroup key={groupe.idTrack ?? ''} label={groupe.nomTrack}>
									{options}
								</optgroup>
							)
						})}
						{/* LA DESTINATION ACTUELLE EST TOUJOURS UNE OPTION, même absente de la liste :
						    un channel archivé, ou dont la lecture vient de se fermer, ne figure pas
						    parmi les liables, et sans cette option le sélecteur retomberait sur
						    « Aucun channel » — affichant un retrait de lien qui n'a pas eu lieu. */}
						{bloc.channel_id !== null &&
						!groupes.some((groupe) => groupe.channels.some((channel) => channel.id === bloc.channel_id)) ? (
							<option value={bloc.channel_id}>{bloc.destination?.nom ?? t('goals.edit.link.none')}</option>
						) : null}
					</select>
					{/* LE BOUTON DE RETRAIT DOUBLE L'OPTION VIDE À LA SOURIS, et n'est rendu que
					    lorsqu'il y a un lien à retirer : un bouton toujours présent qui n'aurait rien
					    à défaire serait une commande morte. */}
					{bloc.channel_id === null ? null : (
						<Button
							variante="secondaire"
							taille="compacte"
							data-testid="retirer-lien"
							onClick={() => void ecrireLien(null)}
							className="gap-2"
						>
							<Unlink aria-hidden="true" size={16} strokeWidth={2} />
							{t('goals.edit.link.remove')}
						</Button>
					)}
				</div>
				<p id="fiche-bloc-lien-aide" className="text-sm text-text-3">
					{etatChannels.statut === 'chargement'
						? t('goals.edit.link.loading')
						: etatChannels.statut === 'pret' && etatChannels.donnees.length === 0
							? t('goals.edit.link.empty')
							: t('goals.edit.link.hint')}
				</p>
				{/* LA LISTE PEUT ÉCHOUER SANS QUE LE LIEN EXISTANT NE BOUGE : le sélecteur garde alors
				    sa destination actuelle, et la reprise relit la liste — jamais le bloc. */}
				{etatChannels.statut === 'erreur' ? (
					<p data-testid="erreur-channels" role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-on-soft bg-danger-soft rounded-sm px-2 py-1">
						{t('goals.edit.link.error')}
						<Button variante="secondaire" taille="compacte" data-testid="recharger-channels" onClick={onRechargerChannels}>
							{t('goals.error.retry')}
						</Button>
					</p>
				) : null}
				<MentionChamp identifiant="fiche-bloc-lien-etat" champ="lien" message={messages.lien ?? null} />
			</div>

			{/* LE GESTE QUI DÉTRUIT EST EN BAS DE LA FICHE, dans un bloc séparé par une bordure
			    haute — la place exacte que le §5.3 donne au retrait d'une affaire, et pour son
			    motif : supprimer n'est pas ce qu'on vient faire sur une fiche d'édition.
			    LA COMMANDE RESTE MONTÉE PENDANT SA CONFIRMATION, seulement désactivée — le patron
			    du §5.27 : la retirer ferait sauter la hauteur du bloc au moment précis où l'on
			    demande de lire. Le retour du focus reste néanmoins différé d'un tour de rendu, un
			    bouton désactivé refusant le focus — voir l'état `rendreFocusSuppression`. */}
			<div className="flex flex-col gap-2 border-t border-border pt-3">
				<Button
					ref={commandeSuppression}
					variante="secondaire"
					taille="compacte"
					data-testid="supprimer-bloc"
					disabled={confirmeSuppression}
					onClick={() => setConfirmeSuppression(true)}
					className="gap-2 self-start"
				>
					<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
					{t('goals.block.delete')}
				</Button>
				{confirmeSuppression ? (
					<ConfirmationSuppressionBloc
						titre={bloc.title}
						fleches={flechesDuBloc}
						onConfirmer={() => {
							setConfirmeSuppression(false)
							onSupprimer()
						}}
						onAnnuler={() => {
							setConfirmeSuppression(false)
							setRendreFocusSuppression(true)
						}}
					/>
				) : null}
			</div>
		</section>
	)
}

/**
 * Le corps de la confirmation, ACCORDÉ PAR CLÉ et jamais par concaténation (`CLAUDE.md` §23).
 *
 * Trois clés et non une phrase paramétrée : « les 1 flèches » est faux en français, et une langue
 * qui accorde autrement — le pluriel arabe en compte six — n'aurait aucun moyen de le corriger
 * depuis un unique gabarit. Les trois clés sont écrites LITTÉRALEMENT, pour la raison déjà nommée
 * ailleurs dans ce fichier : une clé construite survit à la suppression de son appelant.
 */
export function corpsSuppressionBloc(fleches: number): string {
	if (fleches === 0) return t('goals.block.delete.confirm.body')
	if (fleches === 1) return t('goals.block.delete.confirm.body.link')
	return t('goals.block.delete.confirm.body.links', { compte: String(fleches) })
}

/**
 * La confirmation de suppression d'un bloc — dans le FLUX du document, jamais une modale
 * (`docs/DESIGN_SYSTEM.md` §5.13, §5.21, §5.27, tranché trois fois).
 *
 * ELLE NOMME LE BLOC ET CE QUI PART AVEC LUI (§6). La cascade du §2.3 emporte les flèches qui le
 * relient, et c'est la seule perte que le geste cause au-delà de son objet : une confirmation qui
 * la tairait ferait découvrir après coup la disparition de liens que personne n'a demandé de
 * retirer. Le compte n'est écrit QUE lorsqu'il y en a — « les 0 flèches » se lit deux fois pour
 * comprendre qu'il n'y en a aucune (§5.13, l'énumération et son état vide).
 *
 * LE FOCUS ENTRE SUR LE BOUTON D'ACTION, patron de `ConfirmationRetrait` de l'éditeur de
 * workflows : la confirmation ouverte au clavier doit être atteignable sans traverser la fiche.
 */
function ConfirmationSuppressionBloc({
	titre,
	fleches,
	onConfirmer,
	onAnnuler,
}: {
	readonly titre: string
	readonly fleches: number
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const action = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-suppression-bloc"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{t('goals.block.delete.confirm.title', { titre })}</p>
			<p className="text-sm text-text-2">{corpsSuppressionBloc(fleches)}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					ref={action}
					variante="destructif"
					taille="compacte"
					data-testid="confirmer-suppression-bloc"
					onClick={onConfirmer}
				>
					{t('goals.block.delete.confirm.action')}
				</Button>
				<Button variante="secondaire" taille="compacte" data-testid="annuler-suppression-bloc" onClick={onAnnuler}>
					{t('goals.block.delete.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * La mention d'état d'UN champ — §5.7 ter.
 *
 * Elle est TOUJOURS rendue, même vide, pour la raison qui vaut déjà pour la mention du canevas :
 * un lecteur d'écran ne doit pas découvrir une région qui apparaît. Le refus porte `role="alert"`,
 * l'attente et la confirmation `role="status"`.
 */
function MentionChamp({
	identifiant,
	champ,
	message,
}: {
	readonly identifiant: string
	readonly champ: ChampFiche
	readonly message: MessageEcriture | null
}) {
	const TONS: Readonly<Record<MessageEcriture['ton'], string>> = {
		attente: 'text-text-3',
		succes: 'text-success',
		refus: 'text-danger-on-soft bg-danger-soft rounded-sm px-2 py-1',
	}
	return (
		<p
			id={identifiant}
			data-testid={`etat-${champ}`}
			role={message?.ton === 'refus' ? 'alert' : 'status'}
			className={['text-sm', message === null ? '' : TONS[message.ton]].join(' ')}
		>
			{message?.texte ?? ''}
		</p>
	)
}

function RetourListe() {
	return (
		<Link
			to={CHEMIN_OBJECTIFS}
			className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border hover:bg-hover"
		>
			<ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
			{t('goals.back.list')}
		</Link>
	)
}

function CommandesZoom({
	rang,
	onChanger,
}: {
	readonly rang: number
	readonly onChanger: (rang: number) => void
}) {
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				data-testid="zoom-moins"
				disabled={rang === 0}
				onClick={() => onChanger(Math.max(0, rang - 1))}
				aria-label={t('goals.zoom.out')}
				className="inline-flex items-center justify-center size-[var(--size-target)] rounded-sm border border-border hover:bg-hover disabled:opacity-50"
			>
				<Minus aria-hidden="true" size={16} strokeWidth={2} />
			</button>
			<span data-testid="zoom-valeur" className="text-sm text-text-2 tabular-nums min-w-[5ch] text-center">
				{t('goals.zoom.value', { valeur: String(Math.round((ZOOMS[rang] ?? 1) * 100)) })}
			</span>
			<button
				type="button"
				data-testid="zoom-plus"
				disabled={rang === ZOOMS.length - 1}
				onClick={() => onChanger(Math.min(ZOOMS.length - 1, rang + 1))}
				aria-label={t('goals.zoom.in')}
				className="inline-flex items-center justify-center size-[var(--size-target)] rounded-sm border border-border hover:bg-hover disabled:opacity-50"
			>
				<Plus aria-hidden="true" size={16} strokeWidth={2} />
			</button>
		</div>
	)
}

/**
 * Les traits, dans un SVG posé SOUS les blocs.
 *
 * Le SVG est `aria-hidden` et il l'est délibérément : le diagramme est restitué aux lecteurs
 * d'écran par la liste textuelle du §5.5, non par des `<path>` que rien ne sait lire. Doubler
 * l'information ferait entendre chaque flèche deux fois.
 */
function TraitsDuDiagramme({
	fleches,
	etendue,
}: {
	readonly fleches: readonly FlecheTracee[]
	readonly etendue: { readonly largeur: number; readonly hauteur: number }
}) {
	return (
		<svg
			aria-hidden="true"
			data-testid="traits-diagramme"
			width={etendue.largeur}
			height={etendue.hauteur}
			viewBox={`0 0 ${etendue.largeur} ${etendue.hauteur}`}
			className="absolute inset-0 pointer-events-none"
		>
			<defs>
				<marker id="pointe-objectif" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
					<path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-3)" />
				</marker>
				<marker
					id="pointe-objectif-inverse"
					markerWidth="8"
					markerHeight="8"
					refX="1"
					refY="4"
					orient="auto"
				>
					<path d="M8,0 L0,4 L8,8 z" fill="var(--color-text-3)" />
				</marker>
			</defs>
			{fleches.map((fleche) => (
				<g key={fleche.id} data-testid={fleche.orpheline ? 'fleche-orpheline' : 'fleche'}>
					<line
						x1={fleche.depart.x}
						y1={fleche.depart.y}
						x2={fleche.arrivee.x}
						y2={fleche.arrivee.y}
						stroke="var(--color-text-3)"
						strokeWidth={2}
						/* Une flèche dont une extrémité n'est pas rendue est POINTILLÉE et sans
						   libellé (§5.4) : l'écran montre qu'un trait continue, sans jamais dire
						   vers quoi. */
						strokeDasharray={fleche.orpheline ? '6 4' : undefined}
						markerEnd={
							fleche.direction === 'forward' || fleche.direction === 'both'
								? 'url(#pointe-objectif)'
								: undefined
						}
						markerStart={
							fleche.direction === 'backward' || fleche.direction === 'both'
								? 'url(#pointe-objectif-inverse)'
								: undefined
						}
					/>
					{fleche.libelle === null ? null : (
						<text
							x={fleche.milieu.x}
							y={fleche.milieu.y}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={12}
							fill="var(--color-text-2)"
							/* Le fond interrompt le trait (§5.3) : `paint-order` peint le contour
							   avant le texte, ce qui évite d'avoir à poser un rectangle dont la
							   taille dépendrait de la mesure du texte. */
							stroke="var(--color-surface)"
							strokeWidth={6}
							paintOrder="stroke"
						>
							{fleche.libelle}
						</text>
					)}
				</g>
			))}
		</svg>
	)
}

/**
 * Un bloc du canevas — §5.2, `docs/DESIGN_SYSTEM.md` §5.29, et depuis la tranche 2a les deux
 * gestes de géométrie du §3.
 *
 * TROIS RÈGLES DE GESTE, ÉCRITES ICI PARCE QU'ELLES SE REDÉCOUVRENT MAL :
 *
 *   1. l'ancre d'un glissement est prise au `pointerdown` et gardée dans une référence, jamais
 *      relue à chaque mouvement : une ancre recalculée sur la position courante ferait dériver le
 *      bloc, chaque mouvement s'ajoutant au précédent ;
 *   2. les écarts de pointeur sont divisés par le ZOOM avant d'entrer dans le canevas — la surface
 *      porte un `scale`, si bien qu'un pixel d'écran ne vaut pas une unité de canevas ;
 *   3. un glissement parti d'un lien ou d'un bouton n'en est pas un. Sans cette garde, ouvrir le
 *      channel d'un bloc deviendrait impossible à la souris, le premier `pointerdown` armant un
 *      déplacement qui avale le clic.
 */
function BlocCanevas({
	bloc,
	zoom,
	edite,
	traceArmee,
	departDuTrace,
	onEbauche,
	onFin,
	onActiver,
	onAnnulerTrace,
}: {
	readonly bloc: BlocObjectif
	readonly zoom: number
	readonly edite: boolean
	readonly traceArmee: boolean
	readonly departDuTrace: boolean
	readonly onEbauche: (geometrie: Geometrie) => void
	readonly onFin: (geometrie: Geometrie, mode: ModeGeste) => void
	readonly onActiver: (geste: GesteBloc) => void
	readonly onAnnulerTrace: () => void
}) {
	const ouvrable = lienOuvrable(bloc)
	const perdu = lienPerdu(bloc)
	const destination = bloc.destination
	const geometrie = geometrieDe(bloc)

	const ancre = useRef<{
		readonly pointeur: { readonly x: number; readonly y: number }
		readonly geometrie: Geometrie
		readonly mode: ModeGeste
	} | null>(null)
	// Le MODE du geste clavier en cours, et non un simple drapeau : c'est lui qui dit, au
	// relâchement de la touche, quelles colonnes partent.
	const clavierEnCours = useRef<ModeGeste | null>(null)

	const etiquette =
		ouvrable && destination !== null && destination.track !== null
			? t('goals.block.aria.channel', {
					titre: bloc.title,
					valeur: String(bloc.fill_percent),
					track: destination.track.nom,
					channel: destination.nom,
				})
			: t('goals.block.aria', { titre: bloc.title, valeur: String(bloc.fill_percent) })

	const depuisAncre = (clientX: number, clientY: number): Geometrie | null => {
		const origine = ancre.current
		if (origine === null) return null
		const dx = (clientX - origine.pointeur.x) / zoom
		const dy = (clientY - origine.pointeur.y) / zoom
		if (origine.mode === 'deplacement') {
			return {
				...origine.geometrie,
				x: bornerCoordonnee(origine.geometrie.x + dx),
				y: bornerCoordonnee(origine.geometrie.y + dy),
			}
		}
		return {
			...origine.geometrie,
			largeur: bornerDimension(origine.geometrie.largeur + dx, TAILLE_BLOC_MINIMALE.largeur),
			hauteur: bornerDimension(origine.geometrie.hauteur + dy, TAILLE_BLOC_MINIMALE.hauteur),
		}
	}

	const armer = (mode: ModeGeste) => (evenement: EvenementPointeur<HTMLElement>) => {
		if (evenement.button !== 0) return
		if (mode === 'deplacement' && (evenement.target as HTMLElement).closest('a, button') !== null) return
		evenement.preventDefault()
		evenement.stopPropagation()
		evenement.currentTarget.setPointerCapture(evenement.pointerId)
		ancre.current = {
			pointeur: { x: evenement.clientX, y: evenement.clientY },
			geometrie,
			mode,
		}
	}

	const suivre = (evenement: EvenementPointeur<HTMLElement>) => {
		const suivante = depuisAncre(evenement.clientX, evenement.clientY)
		if (suivante !== null) onEbauche(suivante)
	}

	const relacher = (evenement: EvenementPointeur<HTMLElement>) => {
		const origine = ancre.current
		const finale = depuisAncre(evenement.clientX, evenement.clientY)
		if (origine === null || finale === null) return
		ancre.current = null
		if (evenement.currentTarget.hasPointerCapture(evenement.pointerId)) {
			evenement.currentTarget.releasePointerCapture(evenement.pointerId)
		}
		// UN CLIC N'EST PAS UN GLISSEMENT DE ZÉRO PIXEL, et cette distinction porte deux choses à la
		// fois. Elle donne à `Entrée` son binôme souris — ouvrir la fiche du bloc (§5.5) —, et elle
		// supprime une écriture inutile : jusqu'ici, poser puis relever le doigt sans bouger envoyait
		// une position identique à celle déjà en base. Un `PATCH` qui ne change rien reste un `PATCH`,
		// et il aurait écrasé, entre-temps, le déplacement d'un collègue.
		if (origine.mode === 'deplacement' && !aBouge(origine.geometrie, finale)) {
			onActiver('clic')
			return
		}
		onFin(finale, origine.mode)
	}

	return (
		<article
			data-testid="bloc-objectif"
			data-bloc={bloc.id}
			tabIndex={0}
			aria-label={etiquette}
			/* LA CONSIGNE DU TRACÉ EST CITÉE PAR CHAQUE BLOC TANT QU'IL EST ARMÉ : un utilisateur au
			   lecteur d'écran qui atteint un bloc pendant un tracé doit entendre ce que sa touche va
			   faire, faute de quoi le geste n'existe qu'à l'écran. */
			aria-describedby={
				traceArmee ? 'objectifs-consigne-clavier objectifs-consigne-trace' : 'objectifs-consigne-clavier'
			}
			/* Le bloc dont la fiche est ouverte est DÉSIGNÉ visuellement, faute de quoi une fiche
			   posée sous un canevas de douze blocs n'aurait aucun lien lisible avec le sien. Le
			   liseré emploie le jeton `brand`, celui du focus, et il s'ajoute à l'anneau plutôt
			   qu'il ne le remplace : ce sont deux informations différentes. */
			data-edite={edite ? 'oui' : undefined}
			/* LE DÉPART D'UN TRACÉ EST DÉSIGNÉ VISUELLEMENT, et par un jeton DIFFÉRENT de celui de la
			   fiche : les deux états peuvent coexister — on trace depuis le bloc dont la fiche est
			   ouverte —, et les distinguer d'un regard est ce qui évite de croire qu'on a armé le
			   mauvais bloc. La marque ne repose pas sur la seule couleur : le bandeau du tracé NOMME
			   le bloc de départ (`docs/DESIGN_SYSTEM.md` §1). */
			data-trace={departDuTrace ? 'depart' : undefined}
			className={[
				'absolute flex overflow-hidden rounded-lg border bg-surface shadow-card touch-none',
				'focus-visible:outline-2 focus-visible:outline-brand',
				edite ? 'border-brand ring-2 ring-brand-soft' : 'border-border',
				departDuTrace ? 'ring-2 ring-accent' : '',
			].join(' ')}
			style={{
				left: `${bloc.pos_x}px`,
				top: `${bloc.pos_y}px`,
				width: `${bloc.width}px`,
				height: `${bloc.height}px`,
			}}
			onPointerDown={armer('deplacement')}
			onPointerMove={suivre}
			onPointerUp={relacher}
			onPointerCancel={() => {
				ancre.current = null
			}}
			/* LE CLAVIER FAIT EXACTEMENT CE QUE LA SOURIS FAIT (§5.5, `CLAUDE.md` §22) : flèches
			   pour déplacer, `Maj` pour ajuster au pixel, `Alt` pour redimensionner. L'écriture
			   part au RELÂCHEMENT de la touche, jamais à chaque répétition : une frappe maintenue
			   émettrait une requête par pixel. Aucune temporisation n'est employée pour cela. */
			onKeyDown={(evenement) => {
				// `Échap` ANNULE LE TRACÉ EN COURS depuis n'importe quel bloc — c'est le geste
				// d'abandon que le §5.5 emploie déjà pour le repère de pose, et il ne fait rien
				// quand rien n'est armé plutôt que d'avaler la touche.
				if (evenement.key === 'Escape') {
					if (!traceArmee) return
					evenement.preventDefault()
					onAnnulerTrace()
					return
				}
				// `Entrée` OUVRE LA FICHE DU BLOC FOCALISÉ et `Espace` ARME UN TRACÉ depuis lui
				// (§5.5) ; une fois un tracé armé, les deux DÉSIGNENT ce bloc. C'est le canevas qui
				// en décide — le bloc ne connaît que son geste. La garde sur la cible est celle du
				// glissement, et pour la même cause : `Entrée` sur la pilule de channel doit ouvrir
				// le channel, geste de la tranche 1 que ni la fiche ni le tracé ne doivent avaler.
				if (evenement.key === 'Enter' || evenement.key === ' ') {
					if ((evenement.target as HTMLElement).closest('a, button') !== null) return
					// `Espace` fait défiler la région par défaut : sans ce `preventDefault`, armer un
					// tracé emporterait le canevas d'un écran vers le bas.
					evenement.preventDefault()
					onActiver(evenement.key === ' ' ? 'espace' : 'entree')
					return
				}
				const direction = DIRECTIONS_CLAVIER[evenement.key]
				if (direction === undefined) return
				evenement.preventDefault()
				const pas = evenement.shiftKey ? PAS_CLAVIER_FIN : PAS_CLAVIER
				clavierEnCours.current = evenement.altKey ? 'taille' : 'deplacement'
				onEbauche(
					evenement.altKey
						? {
								...geometrie,
								largeur: bornerDimension(geometrie.largeur + direction[0] * pas, TAILLE_BLOC_MINIMALE.largeur),
								hauteur: bornerDimension(geometrie.hauteur + direction[1] * pas, TAILLE_BLOC_MINIMALE.hauteur),
							}
						: {
								...geometrie,
								x: bornerCoordonnee(geometrie.x + direction[0] * pas),
								y: bornerCoordonnee(geometrie.y + direction[1] * pas),
							},
				)
			}}
			onKeyUp={(evenement) => {
				if (DIRECTIONS_CLAVIER[evenement.key] === undefined) return
				const mode = clavierEnCours.current
				if (mode === null) return
				clavierEnCours.current = null
				onFin(geometrie, mode)
			}}
		>
			<span aria-hidden="true" className={['w-1 shrink-0', liseréDe(bloc.color)].join(' ')} />
			<div className="flex flex-col gap-1 min-w-0 grow p-3">
				<h3 className="text-[15px] font-medium text-ink truncate">{bloc.title}</h3>
				{bloc.body === null ? null : (
					<p className="text-[13px] text-text-2 line-clamp-2">{bloc.body}</p>
				)}
				<div className="mt-auto flex flex-col gap-2">
					<Jauge valeur={bloc.fill_percent} />
					{ouvrable && destination !== null && destination.track !== null ? (
						<Link
							to={`/tracks/${destination.track.slug}/${destination.slug}`}
							data-testid="pilule-channel"
							title={t('goals.block.open')}
							className="inline-flex items-center gap-1 self-start max-w-full px-2 py-1 rounded-full bg-brand-soft text-brand text-xs truncate hover:bg-brand-soft-strong"
						>
							<SquareArrowOutUpRight aria-hidden="true" size={12} strokeWidth={2} />
							<span className="truncate">
								{t('goals.block.pill', { track: destination.track.nom, channel: destination.nom })}
							</span>
						</Link>
					) : null}
					{perdu ? (
						<span
							data-testid="lien-perdu"
							title={t('goals.block.link.lost.hint')}
							className="inline-flex items-center gap-1 self-start px-2 py-1 rounded-full bg-bg text-text-3 text-xs"
						>
							<Unlink aria-hidden="true" size={12} strokeWidth={2} />
							{t('goals.block.link.lost')}
						</span>
					) : null}
				</div>
			</div>
			{/* POIGNÉE DE REDIMENSIONNEMENT — une affordance de SOURIS, et rien d'autre.
			    Elle est `aria-hidden` et hors du parcours de tabulation parce que le clavier
			    dispose du geste complet (`Alt` et flèches, annoncé par la consigne du canevas) :
			    un bouton qui ne ferait rien sur `Entrée` serait la commande morte que le §5.10
			    proscrit. L'écart de taille avec le §8 est nommé au §5.29 du design system. */}
			<span
				data-testid="poignee-taille"
				aria-hidden="true"
				className="absolute right-0 bottom-0 flex items-end justify-end size-6 p-1 cursor-se-resize"
				onPointerDown={armer('taille')}
				onPointerMove={suivre}
				onPointerUp={relacher}
				onPointerCancel={() => {
					ancre.current = null
				}}
			>
				{/* La MARQUE est plus petite que la zone qui la reçoit — écart trouvé en regardant
				    une capture (`CLAUDE.md` §16) : dessinée à même les 24 px et suivant le rayon de
				    la carte, l'équerre se lisait comme une languette accrochée au coin de chaque
				    bloc. Elle mesure donc 10 px, la zone sensible gardant les 24 px du §5.29. */}
				<span className="block size-3 border-r-2 border-b-2 border-text-3" />
			</span>
		</article>
	)
}

/**
 * Jauge de remplissage — §5.2 et `docs/DESIGN_SYSTEM.md` §5.29.
 *
 * ELLE NE CHANGE JAMAIS DE COULEUR AVEC LA VALEUR, et c'est l'écart le plus tentant de ce
 * composant : un remplissage saisi à la main n'est ni bon ni mauvais, et le vert ou le rouge y
 * introduiraient un jugement que le produit n'a pas à porter.
 *
 * La valeur est écrite EN CLAIR à droite : la couleur ne porte jamais seule une information
 * (`docs/DESIGN_SYSTEM.md` §1). Le rôle `progressbar` n'est PAS employé — l'attribut d'un bloc
 * est déjà dans son `aria-label`, et une barre annoncée en plus ferait entendre la valeur deux
 * fois de suite.
 */
function Jauge({ valeur }: { readonly valeur: number }) {
	return (
		<div className="flex items-center gap-2">
			<span aria-hidden="true" className="grow h-[6px] rounded-full bg-brand-soft overflow-hidden">
				<span
					data-testid="jauge-remplissage"
					className="block h-full bg-brand"
					style={{ width: `${Math.min(100, Math.max(0, valeur))}%` }}
				/>
			</span>
			<span aria-hidden="true" className="text-xs text-text-2 tabular-nums">
				{t('goals.block.fill', { valeur: String(valeur) })}
			</span>
		</div>
	)
}

/**
 * Équivalent textuel du diagramme — §5.5.
 *
 * Il est TOUJOURS rendu, y compris vide : un lecteur d'écran qui ne trouve la liste que sur les
 * tableaux liés apprendrait son absence plutôt que l'absence de liens.
 *
 * Une extrémité non rendue est nommée « extrémité hors de portée », formulation qui ne dit rien
 * de ce qui manque — l'écran ne nomme jamais ce qu'il cache (§4.1).
 */
/**
 * La confirmation de suppression d'une flèche — même forme que celle du bloc, texte distinct.
 *
 * ELLE NOMME LA FLÈCHE PAR SES DEUX EXTRÉMITÉS ET SON SYMBOLE (§6), jamais par un identifiant :
 * une liste qui porte cinq flèches ne dirait pas laquelle on retire. Elle ne parle d'aucune
 * cascade — une flèche n'emporte rien —, et c'est ce qui la distingue de celle du bloc.
 */
function ConfirmationSuppressionFleche({
	question,
	onConfirmer,
	onAnnuler,
}: {
	readonly question: string
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const action = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		action.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-suppression-fleche"
			className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
		>
			<p className="text-sm text-ink max-w-[70ch]">{question}</p>
			<Button
				ref={action}
				variante="destructif"
				taille="compacte"
				data-testid="confirmer-suppression-fleche"
				onClick={onConfirmer}
			>
				{t('goals.link.delete.confirm.action')}
			</Button>
			<Button variante="secondaire" taille="compacte" data-testid="annuler-suppression-fleche" onClick={onAnnuler}>
				{t('goals.link.delete.cancel')}
			</Button>
		</div>
	)
}

function EquivalentTextuel({
	lignes,
	onChangerDirection,
	onSupprimerFleche,
}: {
	readonly lignes: readonly LigneDiagramme[]
	readonly onChangerDirection: (idFleche: string, direction: DirectionFleche) => void
	readonly onSupprimerFleche: (idFleche: string) => void
}) {
	// UNE SEULE CONFIRMATION À TOUT INSTANT, la règle du §5.27 : deux questions destructrices
	// ouvertes ensemble ne diraient pas à laquelle on répond. L'état porte donc l'identifiant de la
	// ligne qui interroge, jamais un drapeau par ligne.
	const [confirme, setConfirme] = useState<string | null>(null)
	// LES COMMANDES SONT RETENUES PAR LEUR LIGNE, pour rendre le focus à CELLE qui a ouvert la
	// confirmation (§5.13). Une seule référence désignerait la dernière rendue, et annuler sur la
	// deuxième ligne renverrait le focus sur la troisième.
	const commandes = useRef<Map<string, HTMLButtonElement | null>>(new Map())
	// MÊME REMÈDE QUE DANS LA FICHE, et pour la même cause : la commande de la ligne est désactivée
	// pendant sa confirmation, et un bouton désactivé refuse le focus. Le drapeau porte ici
	// l'identifiant de la ligne à qui le rendre.
	const [aRefocaliser, setARefocaliser] = useState<string | null>(null)
	useEffect(() => {
		if (aRefocaliser === null) return
		const cible = commandes.current.get(aRefocaliser)
		setARefocaliser(null)
		cible?.focus()
	}, [aRefocaliser])
	return (
		<section data-testid="equivalent-textuel" aria-label={t('goals.diagram.aria')} className="flex flex-col gap-2">
			<h3 className="text-sm font-medium text-text-2">{t('goals.diagram.title')}</h3>
			{lignes.length === 0 ? (
				<p className="text-sm text-text-3">{t('goals.diagram.empty')}</p>
			) : (
				<ul className="flex flex-col gap-1 text-sm text-text-2">
					{lignes.map((ligne) => {
						// La ligne passe par une CLÉ PARAMÉTRÉE, jamais par une concaténation dans
						// le composant (`CLAUDE.md` §23) : une langue qui place son libellé avant
						// ses extrémités n'aurait aucun moyen de corriger un ordre figé en JSX.
						const parametres = {
							source: ligne.source === '' ? t('goals.diagram.unreachable') : ligne.source,
							cible: ligne.cible === '' ? t('goals.diagram.unreachable') : ligne.cible,
							symbole: ligne.symbole,
							libelle: ligne.libelle ?? '',
						}
						return (
							<li key={ligne.id} data-testid="ligne-diagramme" className="flex flex-col gap-2">
								<div className="flex flex-wrap items-center gap-2">
								<span>
									{ligne.libelle === null
										? t('goals.diagram.line', parametres)
										: t('goals.diagram.line.labelled', parametres)}
								</span>
								{/* LA DIRECTION SE CORRIGE ICI, ET NON SUR LE DESSIN, et ce n'est pas
								    un pis-aller : le trait est un `<path>` dans un SVG `aria-hidden`
								    et sans événements de pointeur, que ni le clavier ni un lecteur
								    d'écran n'atteindraient. Cette liste, elle, EST déjà l'équivalent
								    complet du diagramme (§5.5) — c'est donc le seul endroit où
								    corriger une flèche s'offre aux deux entrées à la fois.

								    LE CONTRÔLE EST OFFERT SUR TOUTE LIGNE, y compris celle dont une
								    extrémité n'est pas rendue : écrire une flèche exige le droit sur
								    les DEUX blocs (§4.2), et l'éteindre ici rejouerait à l'écran une
								    règle qui vit dans la politique (`CLAUDE.md` §10). Le refus est
								    traduit, jamais devancé — et il ne nomme rien de ce qui manque. */}
								<label className="sr-only" htmlFor={`direction-fleche-${ligne.id}`}>
									{t('goals.link.direction.change', parametres)}
								</label>
								<select
									id={`direction-fleche-${ligne.id}`}
									data-testid="direction-fleche"
									value={ligne.direction}
									className="min-h-[var(--size-target)] px-2 rounded-sm border border-border bg-surface text-sm text-ink"
									onChange={(evenement) =>
										onChangerDirection(ligne.id, evenement.target.value as DirectionFleche)
									}
								>
									{DIRECTIONS_FLECHE.map((option) => (
										<option key={option} value={option}>
											{t(NOMS_DIRECTION[option])}
										</option>
									))}
								</select>
								{/* LA SUPPRESSION VIT OÙ VIT LA CORRECTION, et pour son motif exact : le trait est un
								    `<path>` dans un SVG `aria-hidden` que ni le clavier ni un lecteur d'écran n'atteignent.
								    Le nom accessible de la commande NOMME la flèche — « Supprimer » seul, répété sur
								    chaque ligne, ne dirait pas laquelle. */}
								<Button
									ref={(element) => {
										commandes.current.set(ligne.id, element)
									}}
									variante="secondaire"
									taille="compacte"
									data-testid="supprimer-fleche"
									aria-label={t('goals.link.delete.aria', parametres)}
									disabled={confirme === ligne.id}
									onClick={() => setConfirme(ligne.id)}
									className="gap-2"
								>
									<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
									{t('goals.link.delete')}
								</Button>
							</div>
							{confirme === ligne.id ? (
								<ConfirmationSuppressionFleche
									question={t('goals.link.delete.confirm', parametres)}
									onConfirmer={() => {
										setConfirme(null)
										onSupprimerFleche(ligne.id)
									}}
									onAnnuler={() => {
										setConfirme(null)
										setARefocaliser(ligne.id)
									}}
								/>
							) : null}
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}

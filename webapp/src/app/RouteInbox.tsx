// @spec CRM-057 (docs/BACKLOG.md) — inbox globale : trois panneaux, arborescence, non classés
// @spec docs/SPEC-mail-subsystem.md §18.3 (les trois panneaux), §18.4 (jamais le HTML d'un
//       expéditeur), §18.5 (la pièce jointe saine), §18.1 (les compteurs sont ceux de l'appelant)
// @spec docs/DESIGN_SYSTEM.md §5.4 (inbox), §5.8 (états systématiques), §7 (responsive), §10
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 e : la SURFACE du sommeil de fil,
//       docs/SPEC-cards.md §16.15.4 (la pastille), §16.15.5 (le filtre est une composition),
//       §16.15.6 (le geste à deux visages) ; docs/DESIGN_SYSTEM.md §5.3 septies
// @spec CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis : la SURFACE de la suggestion,
//       docs/SPEC-contacts.md §8.8.2 (où le bloc s'ancre), §8.8.4 (les quatre états),
//       §8.8.5 (ce que le bloc écrit et ce qu'il tait), §8.8.6 (le geste et ses refus) ;
//       docs/DESIGN_SYSTEM.md §5.4 ter
// @spec CRM-065 (docs/BACKLOG.md) — sous-tranche 2c : l'inbox adressable,
//       docs/SPEC-recherche.md §15 (ce que 2c livre), §13.5 (le message mène à l'inbox, et son
//       adresse porte le message), M16 (le classement décide du dossier)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 f : LE GROUPEMENT en fils,
//       docs/SPEC-cards.md §16.16.3 (ce que la liste énumère), §16.16.4 (ce que la sélection
//       désigne et ce que le panneau de lecture ouvre), §16.16.5 (le sommeil transposé au fil),
//       §16.16.6 (les compteurs de l'arborescence ne changent pas) ;
//       docs/DESIGN_SYSTEM.md §5.4 bis
// @spec CRM-055 (docs/BACKLOG.md) — tranche 2 : le DÉCLASSEMENT, c'est-à-dire retirer un message
//       de l'affaire où il était classé, docs/SPEC-mail-subsystem.md §16.5.5 (la surface, sa
//       confirmation dans le flux et la conséquence nommée), §16.5.2 (le contrat traduit) ;
//       docs/DESIGN_SYSTEM.md §5.3 quater (confirmation dans le flux, jamais en modale)
// @spec docs/JOURNAL.md décision 327, décision 536
//
// TROIS PANNEAUX SUR GRAND ÉCRAN, UNE PILE EN DESSOUS DE 1024 PX — et la pile est une vraie pile,
// non trois colonnes rétrécies : à cette largeur, trois colonnes ne montreraient ni un objet, ni un
// expéditeur, ni un corps. Un bouton « Retour » remonte d'un cran.
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. Les compteurs, la liste et le message sont ce que la RLS laisse
// passer (§18.1) ; l'écran ne filtre rien et ne devine rien.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Inbox, MailX, Moon, Paperclip, Download, Sparkles, Sun } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	MEME_SELECTION,
	classerMessage,
	declasserMessage,
	lireCardsClassables,
	lireCheminCard,
	lireDossierDuMessage,
	urlPieceJointe,
	useArborescence,
	useFilsEndormis,
	useMessage,
	useMessages,
	type ArbreInbox,
	type CardClassable,
	type MessageComplet,
	type MessageListe,
	type NatureRefusClassement,
	type PageMessages,
	type PieceJointe,
	type Selection,
} from '../lib/inbox'
import { BasculeSommeil, CLE_PRESET_SOMMEIL, PastilleSommeil } from '../components/ui/Sommeil'
import { ECHEANCES_USUELLES, echeanceSaisie, echeanceUsuelle } from '../lib/sommeil-card'
import {
	echeanceFil,
	endormirFil,
	reveillerFil,
	type FilsEndormis,
	type IssueSommeilFil,
	type ModeFils,
} from '../lib/sommeil-fil'
import { composerFils, filDuMessage, grouperEnFils } from '../lib/fil-inbox'
// LA CLÉ VIENT DU MODULE QUI L'A ARRÊTÉE (docs/SPEC-recherche.md §13.5), jamais d'un littéral
// recopié ici : une chaîne écrite deux fois se désaccorde au premier ajustement, et la palette
// composerait alors une adresse que l'inbox n'honorerait plus. `colonnes-recherche` n'importe rien,
// ce qui le rend atteignable depuis n'importe où (décision 177).
import { PARAMETRE_MESSAGE } from '../lib/colonnes-recherche'
import { objetDeReponse } from '../lib/envoi'
import { clientCrm } from '../lib/supabase'
import { FormulaireEnvoi } from './FormulaireEnvoi'

/** Le panneau visible sous 1024 px. Sur grand écran, les trois sont montrés ensemble. */
type Etage = 'dossiers' | 'liste' | 'message'

const dateLisible = (iso: string): string =>
	new Date(iso).toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})

/**
 * Enveloppe commune aux trois panneaux.
 *
 * `aria-labelledby` relie chaque région à son propre titre : trois régions anonymes seraient
 * indistinguables à la navigation par régions (docs/DESIGN_SYSTEM.md §10).
 */
function Panneau({
	id,
	titre,
	visible,
	classe,
	entete,
	children,
}: {
	readonly id: string
	readonly titre: string
	readonly visible: boolean
	readonly classe: string
	readonly entete?: React.ReactNode
	readonly children: React.ReactNode
}) {
	return (
		<section
			aria-labelledby={`${id}-titre`}
			data-testid={`inbox-panneau-${id}`}
			className={[visible ? 'flex' : 'hidden', 'lg:flex flex-col min-h-0', classe].join(' ')}
		>
			<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
				<h2 id={`${id}-titre`} className="text-sm font-medium text-text-2 uppercase tracking-wide">
					{titre}
				</h2>
				{entete}
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
		</section>
	)
}

/**
 * L'échec d'un chargement, présenté selon ce qu'il EST.
 *
 * UN REFUS N'EST PAS UNE PANNE, et lui offrir « Réessayer » serait promettre qu'un second essai
 * pourrait changer la réponse : le backend a répondu, et il a dit non. C'est le cas d'un visiteur
 * anonyme qui arrive sur cette adresse — la messagerie n'est pas publique, et l'écran le dit au
 * lieu d'afficher une erreur de chargement (docs/DESIGN_SYSTEM.md §5.8).
 */
function EchecChargement({
	erreur,
	onReprise,
}: {
	readonly erreur: { readonly nature: string }
	readonly onReprise: () => void
}) {
	if (erreur.nature === 'forbidden') {
		return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
	}
	return (
		<EtatErreur
			titre={t('inbox.error.title')}
			corps={t('state.error.unknown')}
			libelleReprise={t('state.error.retry')}
			onReprise={onReprise}
		/>
	)
}

// =================================================================================================
// Panneau 1 — les dossiers
// =================================================================================================

function BoutonDossier({
	libelle,
	nombre,
	profondeur,
	choisi,
	onChoisir,
	depliage,
}: {
	readonly libelle: string
	readonly nombre: number
	readonly profondeur: 0 | 1 | 2
	readonly choisi: boolean
	readonly onChoisir?: () => void
	readonly depliage?: { readonly ouvert: boolean; readonly basculer: () => void }
}) {
	// L'ÉCHELLE D'ESPACEMENT EST FERMÉE (docs/DESIGN_SYSTEM.md §3) : 4, 8, 12, 16, 24, 32, 48 px,
	// et rien entre. `pl-7` ou `pl-11` n'existent tout simplement pas — mesuré, ils ne sont pas
	// engendrés et le retrait disparaît en silence. Trois niveaux, trois pas de l'échelle.
	const indentation = ['pl-3', 'pl-6', 'pl-12'][profondeur]
	return (
		<div className="flex items-stretch">
			{depliage !== undefined ? (
				<button
					type="button"
					aria-expanded={depliage.ouvert}
					aria-label={depliage.ouvert ? t('inbox.folders.collapse') : t('inbox.folders.expand')}
					onClick={depliage.basculer}
					className="flex items-center justify-center min-h-[var(--size-target)] w-8 text-text-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
				>
					{depliage.ouvert ? (
						<ChevronDown aria-hidden="true" size={16} />
					) : (
						<ChevronRight aria-hidden="true" size={16} />
					)}
				</button>
			) : null}
			<button
				type="button"
				// LA SÉLECTION S'ANNONCE, elle ne se contente pas d'une teinte : une sélection qui
				// n'existe qu'en couleur n'existe pas pour un lecteur d'écran (§5.4).
				aria-current={choisi ? 'true' : undefined}
				onClick={onChoisir}
				disabled={onChoisir === undefined}
				className={[
					// `min-w-0` SUR LE BOUTON, ET PAS SEULEMENT SUR SON TEXTE — mesuré : un élément de
					// flexbox a `min-width: auto` et refuse de rétrécir sous la largeur de son
					// contenu. Le bouton faisait 298 px dans un panneau de 263, débordait du cadre et
					// emportait son compteur hors de l'écran ; `truncate` sur le texte n'y pouvait
					// rien, faute d'une largeur à respecter. Défaut vu en capture, pas en test.
					'flex-1 min-w-0 flex items-center justify-between gap-2 text-left',
					'min-h-[var(--size-target)] pr-3 py-1',
					depliage === undefined ? indentation : 'pl-1',
					'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
					choisi ? 'bg-brand-soft text-brand font-medium' : 'text-ink hover:bg-hover',
					onChoisir === undefined ? 'cursor-default' : '',
				].join(' ')}
			>
				{/* `min-w-0` N'EST PAS DÉCORATIF, ET LE DÉFAUT A ÉTÉ VU EN CAPTURE : un élément de
				    flexbox a `min-width: auto` par défaut, donc refuse de rétrécir sous la largeur
				    de son texte. Sans lui, « Refonte intranet Ville de Lyon » débordait du panneau
				    et POUSSAIT son compteur hors de l'écran — `truncate` restait sans effet. */}
				<span className="truncate min-w-0">{libelle}</span>
				<span className="shrink-0 text-sm text-text-3 tabular-nums">{nombre}</span>
			</button>
		</div>
	)
}

function PanneauDossiers({
	etat,
	selection,
	onChoisir,
	onReprise,
	visible,
}: {
	readonly etat: EtatAsync<ArbreInbox>
	readonly selection: Selection | null
	readonly onChoisir: (choix: Selection) => void
	readonly onReprise: () => void
	readonly visible: boolean
}) {
	const [replies, setReplies] = useState<ReadonlySet<string>>(new Set())
	const basculer = useCallback((cle: string) => {
		setReplies((precedent) => {
			const suivant = new Set(precedent)
			if (suivant.has(cle)) suivant.delete(cle)
			else suivant.add(cle)
			return suivant
		})
	}, [])

	return (
		<Panneau
			id="dossiers"
			titre={t('inbox.folders.title')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-folders)] lg:shrink-0 lg:border-r lg:border-border w-full"
		>
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : null}
			{etat.statut === 'erreur' ? <EchecChargement erreur={etat.erreur} onReprise={onReprise} /> : null}
			{etat.statut === 'pret' ? (
				<nav aria-label={t('inbox.folders.aria')}>
					<ul>
						{/* « Non classés » reste affiché MÊME À ZÉRO : c'est l'entrée du travail de tri,
						    et sa disparition ferait croire à une panne (§18.3). */}
						<li>
							<BoutonDossier
								libelle={t('inbox.folders.unclassified')}
								nombre={etat.donnees.nonClasses}
								profondeur={0}
								choisi={selection?.genre === 'non-classes'}
								onChoisir={() => onChoisir({ genre: 'non-classes' })}
							/>
						</li>
					</ul>
					{etat.donnees.tracks.length === 0 ? (
						<EtatVide titre={t('inbox.folders.empty.title')} corps={t('inbox.folders.empty.body')} />
					) : (
						<ul className="border-t border-border mt-1 pt-1">
							{etat.donnees.tracks.map((track) => (
								<li key={track.id}>
									<BoutonDossier
										libelle={track.nom}
										nombre={track.nombre}
										profondeur={0}
										choisi={false}
										depliage={{
											ouvert: !replies.has(track.id),
											basculer: () => basculer(track.id),
										}}
									/>
									{replies.has(track.id) ? null : (
										<ul>
											{track.channels.map((channel) => (
												<li key={channel.id}>
													<BoutonDossier
														libelle={channel.nom}
														nombre={channel.nombre}
														profondeur={1}
														choisi={false}
														depliage={{
															ouvert: !replies.has(channel.id),
															basculer: () => basculer(channel.id),
														}}
													/>
													{replies.has(channel.id) ? null : (
														<ul>
															{channel.cards.map((card) => (
																<li key={card.id}>
																	<BoutonDossier
																		libelle={card.titre}
																		nombre={card.nombre}
																		profondeur={2}
																		choisi={
																			selection?.genre === 'card' &&
																			selection.cardId === card.id
																		}
																		onChoisir={() =>
																			onChoisir({ genre: 'card', cardId: card.id })
																		}
																	/>
																</li>
															))}
														</ul>
													)}
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ul>
					)}
				</nav>
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// Panneau 2 — la liste
// =================================================================================================

function PanneauListe({
	etat,
	selection,
	idOuvert,
	onOuvrir,
	onRetour,
	onReprise,
	visible,
	fils,
	mode,
	onMode,
	maintenant,
}: {
	readonly etat: EtatAsync<PageMessages>
	readonly selection: Selection | null
	readonly idOuvert: string | null
	readonly onOuvrir: (message: MessageListe) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly visible: boolean
	readonly fils: FilsEndormis
	readonly mode: ModeFils
	readonly onMode: (mode: ModeFils) => void
	/** L'instant du filtre, calculé UNE FOIS par rendu et partagé par toutes les lignes (§16.15.4). */
	readonly maintenant: Date
}) {
	// LA COMPOSITION SE FAIT ICI, ET LA MESURE G L'IMPOSE : aucune requête ne peut demander « les
	// messages dont le fil n'est pas endormi », `app.cle_fil` vivant dans le schéma `app` que
	// PostgREST n'expose pas (§16.15.5). LE GROUPEMENT SUIT LA MÊME CONTRAINTE (§16.16.9) et se
	// fait donc au même endroit, sur la même page.
	//
	// L'ORDRE DES DEUX EST IMPOSÉ : grouper D'ABORD, filtrer ENSUITE. Filtrer des messages puis
	// grouper le reste ferait apparaître un fil amputé de ses messages endormis — or un fil est
	// endormi tout entier ou pas du tout (§16.16.5), et son compte deviendrait faux.
	const tous = etat.statut === 'pret' ? grouperEnFils(etat.donnees.messages) : []
	const compose =
		etat.statut === 'pret'
			? composerFils(tous, fils, mode, maintenant, idOuvert)
			: { visibles: [], masques: 0 }

	// L'ACTION N'EST PAS RÉPÉTÉE, ET C'EST UN DÉFAUT VU EN CAPTURE (docs/DESIGN_SYSTEM.md §5.3
	// quinquies, §5.8) : quand l'état vide porte la bascule, l'en-tête ne la porte plus. Les deux
	// ensemble donnaient DEUX cases à cocher identiques dans le même panneau, à quelques
	// centimètres l'une de l'autre — l'utilisateur ne pouvait que se demander si elles font la même
	// chose.
	const videParSommeil =
		etat.statut === 'pret' && selection !== null && compose.visibles.length === 0 && compose.masques > 0
	return (
		<Panneau
			id="liste"
			titre={t('inbox.list.title')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-list)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				<div className="flex items-center gap-2">
					{/* ELLE RESTE RENDUE Y COMPRIS SUR UNE LISTE VIDE (§5.3 septies) : elle est la
					    cause possible de ce vide, et la masquer priverait l'utilisateur du seul
					    geste qui l'en sort. SAUF quand l'état vide la porte déjà — voir
					    `videParSommeil`. */}
					{videParSommeil ? null : (
						<BasculeSommeil
							mode={mode === 'visibles' ? 'visibles' : 'masquees'}
							onMode={(suivant) => onMode(suivant)}
							libelle={t('inbox.sleep.filter')}
						/>
					)}
					<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
						{t('inbox.back.folders')}
					</Button>
				</div>
			}
		>
			{selection === null ? (
				<EtatVide titre={t('inbox.list.unselected.title')} corps={t('inbox.list.unselected.body')} />
			) : null}
			{selection !== null && etat.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : null}
			{selection !== null && etat.statut === 'erreur' ? (
				<EchecChargement erreur={etat.erreur} onReprise={onReprise} />
			) : null}
			{selection !== null && etat.statut === 'pret' ? (
				compose.visibles.length === 0 ? (
					// L'ÉTAT VIDE NE MENT PAS, ET SANS REQUÊTE SUPPLÉMENTAIRE (§16.15.5 point 2) :
					// l'écran CONNAÎT le nombre de messages masqués, puisqu'il les a lus. Un vide dû
					// au sommeil le dit et porte la bascule qui l'en sort ; un dossier réellement
					// vide garde sa mention d'origine.
					compose.masques > 0 ? (
						<EtatVide
							titre={t('inbox.sleep.empty.title')}
							corps={t('inbox.sleep.empty.body')}
							action={
								<BasculeSommeil
									mode="masquees"
									onMode={() => onMode('visibles')}
									libelle={t('inbox.sleep.filter')}
								/>
							}
						/>
					) : (
						<EtatVide titre={t('inbox.list.empty.title')} corps={t('inbox.list.empty.body')} />
					)
				) : (
					<>
						{/* LA LISTE ÉNUMÈRE DES FILS (§16.16.3), et son nom accessible le dit : le
						    laisser annoncer « Messages du dossier » ferait parcourir des messages à
						    un lecteur d'écran là où l'écran présente des fils. */}
						<ul aria-label={t('inbox.thread.list.aria')}>
							{compose.visibles.map((fil) => {
								// LE PRÉDICAT EST DÉCIDÉ UNE FOIS PAR FIL, avec l'instant du filtre, et
								// la pastille ne le rejuge jamais (§16.15.4). Le fil étant devenu la
								// ligne, cette information cesse d'être répétée sur chacun de ses
								// messages (§5.4 bis).
								const echeance = echeanceFil(fils, fil.workspaceId, fil.cleFil, maintenant)
								// LA LIGNE RESTE MARQUÉE TANT QUE LE MESSAGE OUVERT APPARTIENT AU FIL
								// (§16.16.4), et non seulement quand il en est le dernier : sans cela,
								// choisir un message plus ancien dans le sélecteur effacerait le repère
								// de sélection de la liste (§5.4).
								const choisi = fil.messages.some((message) => message.id === idOuvert)
								return (
									<li key={fil.cle}>
										<button
											type="button"
											data-testid="inbox-message"
											aria-current={choisi ? 'true' : undefined}
											// OUVRIR UN FIL OUVRE SON MESSAGE LE PLUS RÉCENT (§16.16.4) :
											// c'est celui dont la ligne vient d'afficher l'objet et la
											// date, et ouvrir le plus ancien ferait mentir la ligne
											// qu'on a cliquée.
											onClick={() => onOuvrir(fil.dernier)}
											className={[
												'w-full text-left px-3 py-2 border-b border-border',
												'min-h-[var(--size-target)]',
												'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
												choisi ? 'bg-brand-soft' : 'hover:bg-hover',
											].join(' ')}
										>
											<span className="block truncate text-sm text-text-2">
												{fil.dernier.expediteur}
											</span>
											<span className="flex items-center gap-2 min-w-0">
												<span className="truncate font-medium text-ink">
													{fil.dernier.objet}
												</span>
												{/* LE BADGE N'APPARAÎT QU'AU-DELÀ DE UN (§5.4 bis) : un
												    « 1 » dirait ce que son absence dit déjà. Son nom
												    accessible est une phrase entière, un chiffre nu ne
												    disant pas ce qu'il compte. `shrink-0` : le compte
												    ne se laisse pas écraser par un objet long. */}
												{fil.nombre > 1 ? (
													<span
														data-testid="inbox-fil-compte"
														aria-label={t('inbox.thread.count', {
															n: String(fil.nombre),
														})}
														className="shrink-0 rounded-full bg-hover px-2 text-sm text-text-2 tabular-nums"
													>
														{fil.nombre}
													</span>
												) : null}
											</span>
											<span className="flex items-center gap-2 text-sm text-text-3">
												<span className="truncate">{dateLisible(fil.dernier.recuLe)}</span>
												{/* LA PASTILLE EST CELLE DU BOARD, RÉEMPLOYÉE SANS COPIE
												    (§5.3 septies) : c'est la même information, elle doit se
												    reconnaître d'une vue à l'autre. */}
												<PastilleSommeil enSommeil={echeance !== null} echeance={echeance} />
											</span>
										</button>
									</li>
								)
							})}
						</ul>
						{/* L'ÉCRAN DIT QU'IL TRONQUE : une liste bornée en silence se lit comme une liste
						    complète, et l'utilisateur croirait avoir tout vu. */}
						{etat.donnees.tronquee ? (
							<p className="px-3 py-2 text-sm text-text-3">{t('inbox.list.truncated')}</p>
						) : null}
					</>
				)
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// Panneau 3 — le message
// =================================================================================================

/**
 * Le libellé d'un statut d'analyse, avec un repli **documenté**.
 *
 * La valeur vient du backend, et un type ne garantit jamais une valeur (`docs/SPEC-types.md`) :
 * `av_status` est une colonne `text` sous contrainte `CHECK`, non une énumération. Un statut
 * inconnu est donc affiché comme inconnu — et surtout **sans bouton de téléchargement** : le repli
 * ne doit jamais glisser du côté permissif.
 */
const LIBELLE_STATUT: Readonly<Record<string, CleTraduction>> = {
	pending: 'inbox.attachments.status.pending',
	infected: 'inbox.attachments.status.infected',
	skipped: 'inbox.attachments.status.skipped',
}

const libelleStatut = (statut: string): CleTraduction =>
	LIBELLE_STATUT[statut] ?? 'inbox.attachments.status.unknown'

function LignePieceJointe({ piece }: { readonly piece: PieceJointe }) {
	const [echec, setEchec] = useState(false)
	const telecharger = useCallback(async () => {
		const url = await urlPieceJointe(clientCrm, piece.chemin)
		if (url === null) {
			setEchec(true)
			return
		}
		setEchec(false)
		window.open(url, '_blank', 'noopener,noreferrer')
	}, [piece.chemin])

	return (
		<li className="flex items-center gap-2 py-1" data-testid="inbox-piece-jointe">
			<Paperclip aria-hidden="true" size={16} className="shrink-0 text-text-3" />
			<span className="truncate">{piece.nom}</span>
			{/* UNE PIÈCE NON SAINE N'A PAS DE BOUTON, elle a un statut en toutes lettres. Un bouton
			    grisé promet ce que le serveur refusera (§5.4). */}
			{piece.statutAnalyse === 'clean' ? (
				<Button variante="discret" taille="compacte" onClick={() => void telecharger()}>
					<Download aria-hidden="true" size={14} />
					{t('inbox.attachments.download')}
				</Button>
			) : (
				<span className="text-sm text-text-3">{t(libelleStatut(piece.statutAnalyse))}</span>
			)}
			{echec ? <span className="text-sm text-danger">{t('inbox.attachments.unavailable')}</span> : null}
		</li>
	)
}

/**
 * Les quatre refus possibles d'un classement, nommés **littéralement**.
 *
 * Une clé composée à la volée — `` t(`inbox.classify.refus.${nature}`) `` — compile, s'affiche, et
 * échappe pourtant au contrôle des clés mortes : le dictionnaire signalait ces quatre-là comme
 * inutilisées alors qu'elles l'étaient. Une table explicite les rend visibles à la fois du
 * compilateur et de la preuve.
 */
const LIBELLE_REFUS: Readonly<Record<NatureRefusClassement, CleTraduction>> = {
	forbidden: 'inbox.classify.refus.forbidden',
	card_indisponible: 'inbox.classify.refus.card_indisponible',
	network: 'inbox.classify.refus.network',
	unknown: 'inbox.classify.refus.unknown',
}

/**
 * Les refus d'un RETRAIT, et leur dictionnaire est DISTINCT de celui du classement.
 *
 * C'est la leçon de la décision 535, payée sur les objectifs : réemployer le texte du geste inverse
 * décrit à l'utilisateur ce qu'il n'a pas tenté, et l'envoie corriger ce qui n'est pas en cause.
 *
 * `card_indisponible` N'EST PAS LEVÉ PAR `unclassify_message` — elle ne vise aucune card, elle
 * quitte celle où le message se trouve. Il est néanmoins traduit, parce que la table est totale sur
 * `NatureRefusClassement` : un repli silencieux sur une clé manquante serait pire qu'une phrase
 * générique, et le classificateur est partagé par les deux gestes.
 */
const LIBELLE_REFUS_RETRAIT: Readonly<Record<NatureRefusClassement, CleTraduction>> = {
	forbidden: 'inbox.unclassify.refus.forbidden',
	card_indisponible: 'inbox.unclassify.refus.unknown',
	network: 'inbox.unclassify.refus.network',
	unknown: 'inbox.unclassify.refus.unknown',
}

function FormulaireClassement({
	message,
	onClasse,
	variante,
}: {
	readonly message: MessageComplet
	readonly onClasse: () => void
	/**
	 * La variante de la commande d'OUVERTURE, et d'elle seule (docs/DESIGN_SYSTEM.md §5.4 ter).
	 *
	 * Elle passe en `secondaire` tant qu'une suggestion est rendue à côté : deux boutons primaires
	 * dans le même pied ne diraient plus lequel est le chemin principal, et c'est le chemin court
	 * qui l'est quand un indice existe. La nature du geste ne change pas, seulement sa place dans
	 * une hiérarchie qui compte alors deux actions.
	 */
	readonly variante: 'primaire' | 'secondaire'
}) {
	const [ouvert, setOuvert] = useState(false)
	const [cards, setCards] = useState<readonly CardClassable[]>([])
	const [choix, setChoix] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const selecteur = useRef<HTMLSelectElement | null>(null)

	useEffect(() => {
		if (!ouvert) return
		let vivant = true
		void (async () => {
			const lues = await lireCardsClassables(clientCrm)
			if (!vivant) return
			setCards(lues)
			setChoix(lues[0]?.id ?? '')
		})()
		return () => {
			vivant = false
		}
	}, [ouvert])

	// LE FOCUS SUIT L'OUVERTURE : sans cela, le clavier resterait sur un bouton qui vient de
	// disparaître et repartirait du début du document (docs/DESIGN_SYSTEM.md §10).
	useEffect(() => {
		if (ouvert) selecteur.current?.focus()
	}, [ouvert, cards])

	const soumettre = useCallback(async () => {
		if (choix === '') return
		setEnvoi(true)
		const echec = await classerMessage(clientCrm, message.id, choix)
		setEnvoi(false)
		if (echec !== null) {
			setRefus(t(LIBELLE_REFUS[echec.nature]))
			return
		}
		setRefus(null)
		setOuvert(false)
		onClasse()
	}, [choix, message.id, onClasse])

	if (!ouvert) {
		return (
			<Button variante={variante} onClick={() => setOuvert(true)} data-testid="inbox-classer">
				{t('inbox.classify.open')}
			</Button>
		)
	}

	return (
		<div className="flex flex-col gap-2" data-testid="inbox-formulaire-classement">
			<label htmlFor="inbox-card" className="text-sm text-text-2">
				{t('inbox.classify.label')}
			</label>
			{cards.length === 0 ? (
				<p className="text-sm text-text-3">{t('inbox.classify.empty')}</p>
			) : (
				<select
					id="inbox-card"
					ref={selecteur}
					value={choix}
					onChange={(evenement) => setChoix(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 focus-visible:outline-2 focus-visible:outline-brand"
				>
					{cards.map((card) => (
						<option key={card.id} value={card.id}>
							{card.chemin === '' ? card.titre : `${card.chemin} › ${card.titre}`}
						</option>
					))}
				</select>
			)}
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					variante="primaire"
					disabled={envoi || choix === ''}
					onClick={() => void soumettre()}
					data-testid="inbox-classer-valider"
				>
					{envoi ? t('inbox.classify.working') : t('inbox.classify.submit')}
				</Button>
				<Button variante="secondaire" onClick={() => setOuvert(false)}>
					{t('inbox.classify.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Retirer un message de l'affaire où il est classé — `CRM-055` tranche 2, §16.5.5.
 *
 * AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE (`docs/DESIGN_SYSTEM.md` §5.3, §5.13,
 * §5.16, §5.21, §5.23, §5.25, §5.27, §5.28). L'écran offre, envoie, et TRADUIT le refus : la règle
 * vit dans `public.unclassify_message`, jamais ici.
 *
 * LA CONFIRMATION VIT DANS LE FLUX, JAMAIS EN MODALE — le §5 n'en déclare aucune, et le §5.3 quater
 * a déjà tranché ce cas pour la mise à la corbeille. La commande qui l'ouvre est SECONDAIRE ; c'est
 * le bouton de la confirmation qui porte la teinte de danger : elle annonce le geste qu'on est sur
 * le point de commettre, pas celui qu'on envisage.
 *
 * ELLE NOMME UNE CONSÉQUENCE, ET C'EST TOUT SON OBJET (§16.5.2, mesure 2). Le geste peut retirer à
 * son auteur le seul chemin par lequel il voyait ce message — mesuré sur la pile : le `bizdev` le
 * voit par sa CARD SEULE, et déclassé il ne le voit plus. La phrase énonce la CONDITION plutôt que
 * de deviner un rôle : l'écran ne sait pas de quelles boîtes l'appelant répond, et l'inventer
 * ferait passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).
 */
function CommandeRetrait({
	message,
	onRetire,
}: {
	readonly message: MessageComplet
	readonly onRetire: () => void
}) {
	const [ouverte, setOuverte] = useState(false)
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const commande = useRef<HTMLButtonElement | null>(null)
	const confirmer = useRef<HTMLButtonElement | null>(null)

	// LE FOCUS ENTRE DANS LA CONFIRMATION (§5.13) : sans cela le clavier resterait sur un bouton
	// qui vient de disparaître et repartirait du début du document.
	useEffect(() => {
		if (ouverte) confirmer.current?.focus()
	}, [ouverte])

	const fermer = useCallback(() => {
		setOuverte(false)
		setRefus(null)
		// ET IL REVIENT À LA COMMANDE QUI L'AVAIT OUVERTE : annuler au clavier ne doit pas perdre
		// la place de l'utilisateur dans le document.
		commande.current?.focus()
	}, [])

	const retirer = useCallback(async () => {
		setEnvoi(true)
		const resultat = await declasserMessage(clientCrm, message.id)
		setEnvoi(false)
		if (resultat.refus !== null) {
			setRefus(t(LIBELLE_REFUS_RETRAIT[resultat.refus.nature]))
			return
		}
		setRefus(null)
		setOuverte(false)
		onRetire()
	}, [message.id, onRetire])

	if (!ouverte) {
		return (
			<div className="border-t border-border pt-3">
				<Button
					ref={commande}
					variante="secondaire"
					onClick={() => setOuverte(true)}
					data-testid="inbox-retirer"
				>
					<MailX aria-hidden="true" className="size-4" />
					{t('inbox.unclassify.open')}
				</Button>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="inbox-retrait-confirmation">
			{/* LE LIBELLÉ DE LA COMMANDE NOMMAIT LE GESTE ; C'EST LA CONFIRMATION QUI NOMME L'OBJET
			    (§6). L'objet du message est celui qui est ouvert, donc déjà sous les yeux : c'est
			    l'AFFAIRE quittée que cette phrase doit nommer, et elle le fait par la pilule
			    au-dessus. */}
			<p className="text-sm text-ink">{t('inbox.unclassify.confirm')}</p>
			<p className="text-sm text-text-2">{t('inbox.unclassify.consequence')}</p>
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					ref={confirmer}
					variante="destructif"
					disabled={envoi}
					onClick={() => void retirer()}
					data-testid="inbox-retirer-valider"
				>
					{envoi ? t('inbox.unclassify.working') : t('inbox.unclassify.submit')}
				</Button>
				<Button variante="secondaire" onClick={fermer} data-testid="inbox-retirer-annuler">
					{t('inbox.unclassify.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * La pilule de l'affaire — cliquable, et donc adressable.
 *
 * L'adresse est lue à l'ouverture du message, non portée par lui : la liste nomme les affaires,
 * elle ne les adresse pas. Tant qu'elle n'est pas connue, le titre seul est affiché — un lien mort
 * serait pire qu'un texte.
 */
function PiluleCard({ idCard }: { readonly idCard: string }) {
	const [cible, setCible] = useState<{ titre: string; adresse: string } | null>(null)
	useEffect(() => {
		let vivant = true
		void (async () => {
			const lue = await lireCheminCard(clientCrm, idCard)
			if (vivant) setCible(lue)
		})()
		return () => {
			vivant = false
		}
	}, [idCard])

	if (cible === null) return null
	return (
		<p className="text-sm text-text-2">
			{t('inbox.message.card')}{' '}
			<Link
				to={cible.adresse}
				data-testid="inbox-pilule-card"
				className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
			>
				{cible.titre}
			</Link>
		</p>
	)
}

// =================================================================================================
// La SUGGESTION de classement — CRM-060 sous-tranche 2 bis, docs/SPEC-contacts.md §8.8
// =================================================================================================

/**
 * Le bloc de suggestion, et le geste qui l'accepte.
 *
 * IL N'INTRODUIT AUCUN CONTRAT NOUVEAU : accepter une suggestion appelle `classify_message` avec
 * l'affaire suggérée, par la même fonction que le formulaire manuel (§8.8.6). Un second chemin
 * d'écriture divergerait du premier au premier ajustement, et la garde des deux droits du §18.2
 * doit rester UNE.
 *
 * LA SUGGESTION N'ACCORDE AUCUN DROIT (§8.1) : elle peut désigner une affaire que l'appelant n'a
 * pas le droit d'écrire, et le geste échoue alors comme tout classement manuel non autorisé. La
 * commande n'est donc jamais éteinte d'avance (docs/DESIGN_SYSTEM.md §5.4 ter) : l'écran appuie et
 * traduit le refus.
 */
function BlocSuggestion({
	idMessage,
	idCard,
	titre,
	adresse,
	onClasse,
}: {
	readonly idMessage: string
	readonly idCard: string
	readonly titre: string
	readonly adresse: string
	readonly onClasse: () => void
}) {
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)

	const accepter = useCallback(async () => {
		setEnVol(true)
		const echec = await classerMessage(clientCrm, idMessage, idCard)
		setEnVol(false)
		if (echec !== null) {
			// LE BLOC RESTE RENDU SUR UN REFUS (§8.8.6) : disparaître retirerait le seul endroit où
			// lire la cause. Les quatre refus sont ceux du classement manuel, mot pour mot — un même
			// refus ne se formule pas de deux façons selon le bouton qui l'a demandé.
			setRefus(t(LIBELLE_REFUS[echec.nature]))
			return
		}
		setRefus(null)
		onClasse()
	}, [idCard, idMessage, onClasse])

	return (
		<section
			data-testid="inbox-suggestion"
			aria-labelledby="inbox-suggestion-titre"
			// UNE CARTE DISCRÈTE, PAS UNE ALERTE (docs/DESIGN_SYSTEM.md §5.4 ter) : une suggestion
			// n'est ni une erreur ni un avertissement, et une teinte d'état lui ferait porter une
			// urgence qu'elle n'a pas.
			className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3"
		>
			<h4
				id="inbox-suggestion-titre"
				className="flex items-center gap-2 text-sm font-medium text-text-2"
			>
				<Sparkles aria-hidden="true" size={16} />
				{t('inbox.suggestion.title')}
			</h4>
			{/* L'AFFAIRE EST NOMMÉE **ET** ADRESSABLE (§8.8.5) : un indice qui ne nommerait pas sa
			    cible ne serait pas un indice, et un nom sans lien obligerait à chercher l'affaire
			    ailleurs pour la vérifier — or vérifier est ce que « à confirmer » demande. */}
			<p>
				<Link
					to={adresse}
					data-testid="inbox-suggestion-card"
					className="inline-flex items-center min-h-[var(--size-target)] rounded-sm bg-brand-soft px-2 text-brand focus-visible:outline-2 focus-visible:outline-brand"
				>
					{titre}
				</Link>
			</p>
			{/* LA RÈGLE EST ÉCRITE EN TOUTES LETTRES, et ce n'est pas une mesure refaite à l'écran :
			    la colonne n'est écrite que par `classer_message_automatiquement`, et elle ne peut pas
			    signifier autre chose (§8.8.5). AUCUNE DATE, aucun score : `suggested_at` daterait
			    l'indice et non l'affaire, et la règle 3 ne produit aucune probabilité. */}
			<p className="text-sm text-text-2">{t('inbox.suggestion.rule')}</p>
			{refus !== null ? (
				<p role="alert" data-testid="inbox-suggestion-refus" className="text-sm text-danger">
					{refus}
				</p>
			) : null}
			{/* `items-start` : dans une colonne flex, un bouton prend toute la largeur disponible et
			    traverserait le panneau de lecture entier (§5.3 septies, défaut mesuré). */}
			<div className="flex items-start">
				<Button
					variante="primaire"
					disabled={enVol}
					onClick={() => void accepter()}
					data-testid="inbox-suggestion-accepter"
				>
					{enVol ? t('inbox.classify.working') : t('inbox.suggestion.accept')}
				</Button>
			</div>
		</section>
	)
}

/**
 * Le pied d'un message NON CLASSÉ : la phrase, la suggestion s'il y en a une, la commande manuelle.
 *
 * L'ORDRE PORTE UN SENS (§8.8.2) : la suggestion est le chemin court, la commande manuelle celui
 * qui marche toujours. Placer l'indice après la commande le ferait lire une fois la liste déroulée,
 * c'est-à-dire trop tard. Et la commande manuelle n'est JAMAIS remplacée : une suggestion peut
 * désigner la mauvaise affaire, et un écran qui n'offrirait que l'indice enfermerait l'utilisateur
 * dans un choix qu'il n'a pas fait.
 */
function PiedNonClasse({
	message,
	onClasse,
}: {
	readonly message: MessageComplet
	readonly onClasse: () => void
}) {
	const idSuggere = message.suggestionCardId
	const [cible, setCible] = useState<{ titre: string; adresse: string } | null>(null)

	// AUCUNE REQUÊTE QUAND IL N'Y A RIEN À RÉSOUDRE (§8.8.3) : un message sans suggestion ne
	// déclenche aucune lecture supplémentaire. La cible est remise à zéro à chaque changement de
	// message, sans quoi le bloc d'un message porterait l'affaire du précédent le temps d'un rendu.
	useEffect(() => {
		setCible(null)
		if (idSuggere === null) return
		let vivant = true
		void (async () => {
			const lue = await lireCheminCard(clientCrm, idSuggere)
			if (vivant) setCible(lue)
		})()
		return () => {
			vivant = false
		}
	}, [idSuggere])

	// UNE SUGGESTION DONT L'AFFAIRE N'EST PAS LISIBLE NE REND RIEN (§8.8.4, cas d) : `lireCheminCard`
	// rend `null`, et l'écran n'écrit surtout pas « une affaire vous est suggérée mais vous ne pouvez
	// pas la voir » — cette phrase divulguerait l'existence d'une affaire que la RLS ferme.
	const suggestion = idSuggere !== null && cible !== null ? { id: idSuggere, ...cible } : null

	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm text-text-2">{t('inbox.message.unclassified')}</p>
			{suggestion !== null ? (
				<BlocSuggestion
					idMessage={message.id}
					idCard={suggestion.id}
					titre={suggestion.titre}
					adresse={suggestion.adresse}
					onClasse={onClasse}
				/>
			) : null}
			<FormulaireClassement
				message={message}
				onClasse={onClasse}
				variante={suggestion !== null ? 'secondaire' : 'primaire'}
			/>
		</div>
	)
}


// =================================================================================================
// Le geste de sommeil d'un FIL — docs/SPEC-cards.md §16.15.6, docs/DESIGN_SYSTEM.md §5.3 septies
// =================================================================================================

/** Les cinq mentions atteignables. `refus` n'en est PAS : `snooze_thread` n'oppose aucun `forbidden`. */
const MENTION_FIL: Readonly<Record<Exclude<IssueSommeilFil, 'endormi' | 'reveille'>, CleTraduction>> = {
	introuvable: 'inbox.sleep.refus.notfound',
	'echeance-requise': 'inbox.sleep.refus.required',
	'echeance-passee': 'inbox.sleep.refus.past',
	reseau: 'inbox.sleep.refus.network',
	inconnu: 'inbox.sleep.refus.unknown',
}

/**
 * Le geste à deux visages du message ouvert.
 *
 * IL VIT ICI ET NON DANS LA LIGNE DE LISTE (§16.15.6) : une liste dont chaque ligne porte un bouton
 * n'est plus une liste, et le §5.4 tient une densité que cette tranche ne défait pas.
 *
 * LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE, quel que soit le profil : l'écran ne devine aucun
 * droit, il appuie et lit le refus (§5.3 septies).
 */
function GesteSommeilFil({
	workspaceId,
	cle,
	echeance,
	onFait,
}: {
	readonly workspaceId: string
	readonly cle: string
	readonly echeance: string | null
	readonly onFait: (issue: 'endormi' | 'reveille') => void
}) {
	const [ouvert, setOuvert] = useState(false)
	const [saisie, setSaisie] = useState('')
	const [issue, setIssue] = useState<IssueSommeilFil | null>(null)
	const [enVol, setEnVol] = useState(false)
	// LE FOCUS REVIENT À LA COMMANDE PAR SON CONTENEUR, et non par une `ref` sur le bouton :
	// `Button` est un composant de fonction simple, qui ne transmet aucune `ref` (§5.5). Lui en
	// ajouter une toucherait tous les écrans du produit pour un besoin local à celui-ci.
	const conteneurCommande = useRef<HTMLDivElement | null>(null)

	// LE PANNEAU SE REFERME QUAND LE MESSAGE CHANGE : sans cela, un panneau ouvert sur un message
	// s'appliquerait au suivant, et le refus affiché parlerait d'un fil qu'on ne lit plus.
	useEffect(() => {
		setOuvert(false)
		setIssue(null)
		setSaisie('')
	}, [cle, workspaceId])

	const fermer = useCallback(() => {
		setOuvert(false)
		setIssue(null)
		conteneurCommande.current?.querySelector('button')?.focus()
	}, [])

	const appliquer = useCallback(
		async (until: string | null) => {
			if (clientCrm === null) return
			setEnVol(true)
			const resultat = await endormirFil(clientCrm, workspaceId, cle, until)
			setEnVol(false)
			setIssue(resultat.issue)
			if (resultat.issue !== 'endormi') return
			setOuvert(false)
			setSaisie('')
			onFait('endormi')
		},
		[cle, onFait, workspaceId],
	)

	const reveiller = useCallback(async () => {
		if (clientCrm === null) return
		setEnVol(true)
		const resultat = await reveillerFil(clientCrm, workspaceId, cle)
		setEnVol(false)
		setIssue(resultat.issue)
		if (resultat.issue !== 'reveille') return
		onFait('reveille')
	}, [cle, onFait, workspaceId])

	const mention =
		issue === null || issue === 'endormi' || issue === 'reveille' ? null : MENTION_FIL[issue]

	// UN SEUL VISAGE À LA FOIS (§16.15.6). Le réveil n'ouvre aucun panneau : il n'a pas de
	// paramètre, et il est réversible d'un geste — une confirmation serait un obstacle.
	if (echeance !== null) {
		return (
			// `items-start` : une SECONDAIRE COMPACTE ne s'étire pas (§5.5, §5.3 septies). Dans une
			// colonne flex, un bouton prend toute la largeur disponible — au palier 1440 px il
			// traversait le panneau de lecture entier, ce qui lui donnait le poids d'une action
			// principale qu'il n'a pas. Défaut vu en capture, pas en test.
			<div ref={conteneurCommande} className="flex flex-col items-start gap-1">
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="fil-reveiller"
					disabled={enVol}
					onClick={() => void reveiller()}
				>
					<Sun aria-hidden="true" size={16} />
					{enVol ? t('card.sleep.pending') : t('inbox.sleep.wake')}
				</Button>
				{mention !== null ? (
					<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
						{t(mention)}
					</p>
				) : null}
			</div>
		)
	}

	if (!ouvert) {
		return (
			<div ref={conteneurCommande} className="flex flex-col items-start gap-1">
				<Button
					variante="secondaire"
					taille="compacte"
					data-testid="fil-endormir"
					onClick={() => {
						setIssue(null)
						setOuvert(true)
					}}
				>
					<Moon aria-hidden="true" size={16} />
					{t('inbox.sleep.open')}
				</Button>
				{mention !== null ? (
					<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
						{t(mention)}
					</p>
				) : null}
			</div>
		)
	}

	return (
		<div
			data-testid="fil-panneau"
			className="flex flex-col gap-2 rounded-md border border-border p-3"
			// `Échap` REFERME EN RENDANT LE FOCUS À LA COMMANDE (§5.3 quater, sans changement) :
			// un panneau qu'on ferme en perdant le focus oblige à retraverser l'écran au clavier.
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') fermer()
			}}
		>
			<p className="text-sm font-medium text-text-2">{t('card.sleep.legend')}</p>
			<div className="flex flex-wrap gap-2">
				{ECHEANCES_USUELLES.map((usuelle) => (
					<Button
						key={usuelle.cle}
						variante="discret"
						taille="compacte"
						data-testid={`fil-preset-${usuelle.cle}`}
						disabled={enVol}
						// COMPTÉE DEPUIS L'INSTANT DU GESTE, jamais depuis celui du rendu (§16.11.3) :
						// un panneau ouvert dix minutes décalerait sinon toutes ses échéances.
						onClick={() => void appliquer(echeanceUsuelle(usuelle.jours))}
					>
						{t(CLE_PRESET_SOMMEIL[usuelle.cle])}
					</Button>
				))}
			</div>
			<label className="flex flex-col gap-1 text-sm text-text-2">
				{t('card.sleep.custom')}
				{/* NI `min` NI `required` (§5.3 septies) : une échéance passée est ENVOYÉE, et c'est
				    `snooze_date_in_past` qui la refuse — mesure K2. Doubler la garde ici masquerait
				    sa disparition le jour où elle disparaîtrait. */}
				<input
					type="datetime-local"
					data-testid="fil-echeance"
					value={saisie}
					onChange={(evenement) => setSaisie(evenement.target.value)}
					className="min-h-[var(--size-target)] rounded-sm border border-border px-2"
				/>
			</label>
			{/* LE REFUS N'EFFACE PAS LA SAISIE : la corriger vaut mieux que la retaper. */}
			{mention !== null ? (
				<p role="alert" data-testid="fil-refus" className="text-sm text-danger">
					{t(mention)}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					variante="primaire"
					taille="compacte"
					data-testid="fil-soumettre"
					disabled={enVol}
					onClick={() => void appliquer(echeanceSaisie(saisie))}
				>
					{enVol ? t('card.sleep.pending') : t('inbox.sleep.open')}
				</Button>
				<Button variante="discret" taille="compacte" onClick={fermer}>
					{t('card.sleep.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Le sélecteur des messages d'un fil — §16.16.4, docs/DESIGN_SYSTEM.md §5.4 bis.
 *
 * IL N'EXISTE QU'AU-DELÀ D'UN MESSAGE, et c'est ce qui rend cette tranche sûre : là où les fils
 * sont d'un message — tout le courrier reçu avant le correctif du §16.16.2 —, le panneau de lecture
 * reste **exactement** celui d'avant. Une liste d'un élément n'est pas un choix, et l'afficher
 * quand même donnerait à croire qu'il manque quelque chose.
 *
 * L'ORDRE EST CELUI DE LA LISTE — le plus récent d'abord —, et il n'est pas recalculé : deux ordres
 * sur un même écran rendraient « la première ligne » ambiguë (§16.16.4).
 */
function SelecteurFil({
	messages,
	idOuvert,
	onOuvrir,
}: {
	readonly messages: readonly MessageListe[]
	readonly idOuvert: string
	readonly onOuvrir: (message: MessageListe) => void
}) {
	if (messages.length < 2) return null
	return (
		<section
			data-testid="inbox-fil-selecteur"
			aria-label={t('inbox.thread.picker.aria')}
			className="flex flex-col gap-1 rounded-md border border-border p-2"
		>
			<h4 className="text-sm font-medium text-text-2">{t('inbox.thread.picker.title')}</h4>
			<ul>
				{messages.map((message) => (
					<li key={message.id}>
						<button
							type="button"
							data-testid="inbox-fil-message"
							// LE MESSAGE AFFICHÉ S'ANNONCE, il ne se contente pas d'une teinte : une
							// sélection qui n'existe qu'en couleur n'existe pas pour un lecteur
							// d'écran (§5.4, §10).
							aria-current={message.id === idOuvert ? 'true' : undefined}
							onClick={() => onOuvrir(message)}
							className={[
								'w-full text-left px-2 rounded-sm min-h-[var(--size-target)]',
								'flex items-center gap-2 min-w-0',
								'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
								message.id === idOuvert ? 'bg-brand-soft text-brand font-medium' : 'hover:bg-hover',
							].join(' ')}
						>
							<span className="truncate min-w-0">{message.expediteur}</span>
							<span className="shrink-0 ml-auto text-sm text-text-3">
								{dateLisible(message.recuLe)}
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	)
}

function PanneauMessage({
	etat,
	onRetour,
	onReprise,
	onClasse,
	onRepondu,
	visible,
	fils,
	maintenant,
	onSommeil,
	messagesDuFil,
	onOuvrir,
}: {
	readonly etat: EtatAsync<MessageComplet | null>
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly onClasse: () => void
	readonly onRepondu: () => void
	readonly visible: boolean
	readonly fils: FilsEndormis
	readonly maintenant: Date
	readonly onSommeil: (issue: 'endormi' | 'reveille') => void
	/** Les messages du fil ouvert, dans l'ordre de la liste. Vide tant que rien n'est ouvert. */
	readonly messagesDuFil: readonly MessageListe[]
	readonly onOuvrir: (message: MessageListe) => void
}) {
	const echeance =
		etat.statut === 'pret' && etat.donnees !== null
			? echeanceFil(fils, etat.donnees.workspaceId, etat.donnees.cleFil, maintenant)
			: null
	return (
		<Panneau
			id="message"
			titre={t('inbox.message.title')}
			visible={visible}
			classe="flex-1 w-full min-w-0"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.list')}
				</Button>
			}
		>
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : null}
			{etat.statut === 'erreur' ? <EchecChargement erreur={etat.erreur} onReprise={onReprise} /> : null}
			{etat.statut === 'pret' && etat.donnees === null ? (
				<EtatVide
					titre={t('inbox.message.unselected.title')}
					corps={t('inbox.message.unselected.body')}
				/>
			) : null}
			{etat.statut === 'pret' && etat.donnees !== null ? (
				<article className="flex flex-col gap-4 p-4" data-testid="inbox-message-ouvert">
					<header className="flex flex-col gap-1">
						<h3 className="text-h3 break-words">{etat.donnees.objet}</h3>
						<p className="text-sm text-text-2 break-words">
							{t('inbox.message.from')} : {etat.donnees.expediteur}
						</p>
						{etat.donnees.destinataires.length > 0 ? (
							<p className="text-sm text-text-2 break-words">
								{t('inbox.message.to')} : {etat.donnees.destinataires.join(', ')}
							</p>
						) : null}
						{etat.donnees.copies.length > 0 ? (
							<p className="text-sm text-text-2 break-words">
								{t('inbox.message.cc')} : {etat.donnees.copies.join(', ')}
							</p>
						) : null}
						<p className="flex items-center gap-2 text-sm text-text-3">
							<span>
								{t('inbox.message.received')} {dateLisible(etat.donnees.recuLe)}
							</span>
							{/* LA MÊME PASTILLE QU'EN LISTE, au même endroit relatif : la date, puis
							    l'état de son fil (§5.3 septies). */}
							<PastilleSommeil enSommeil={echeance !== null} echeance={echeance} />
						</p>
						{/* LE GESTE VIT DANS LE MESSAGE OUVERT (§16.15.6). Le message ouvert n'est
						    jamais masqué par le filtre : la ligne quitte la liste, le panneau reste
						    — vider l'écran sous le geste de l'utilisateur serait le punir de
						    l'avoir fait (§16.15.5). */}
						<div className="pt-1">
							<GesteSommeilFil
								workspaceId={etat.donnees.workspaceId}
								cle={etat.donnees.cleFil}
								echeance={echeance}
								onFait={onSommeil}
							/>
						</div>
					</header>

					{/* LE SÉLECTEUR VIT SOUS L'EN-TÊTE (§5.4 bis), après le geste et avant le corps :
					    il choisit ce que le corps montre, et le placer après l'aurait fait lire une
					    fois le message déjà parcouru. Il ne rend rien sur un fil d'un seul message. */}
					<SelecteurFil
						messages={messagesDuFil}
						idOuvert={etat.donnees.id}
						onOuvrir={onOuvrir}
					/>

					{etat.donnees.corpsReduitDepuisHtml ? (
						<p className="text-sm text-text-3">{t('inbox.message.reduced')}</p>
					) : null}
					{/* LE CORPS EST DU TEXTE, ET RIEN D'AUTRE. Aucun `dangerouslySetInnerHTML` : le HTML
					    d'un expéditeur inconnu lui offrirait scripts, images distantes et pistage à
					    l'ouverture (§18.4). */}
					<p
						data-testid="inbox-corps"
						className="whitespace-pre-wrap break-words text-ink"
					>
						{etat.donnees.corps === '' ? t('inbox.message.empty.body') : etat.donnees.corps}
					</p>

					{etat.donnees.pieces.length > 0 ? (
						<section>
							<h4 className="text-sm font-medium text-text-2">{t('inbox.attachments.title')}</h4>
							<ul>
								{etat.donnees.pieces.map((piece) => (
									<LignePieceJointe key={piece.id} piece={piece} />
								))}
							</ul>
						</section>
					) : null}

					<footer className="border-t border-border pt-3">
						{etat.donnees.cardId !== null ? (
							<div className="flex flex-col gap-2">
								<PiluleCard idCard={etat.donnees.cardId} />
								{/* RÉPONDRE DEPUIS L'INBOX EMPRUNTE LE MÊME CHEMIN QUE DEPUIS LA CARD
								    (§19.6) : même composant, même garde, seule la card diffère — ici,
								    celle du message ouvert. Un message NON classé n'a pas d'affaire,
								    donc pas d'adresse de retour : il faut d'abord le classer, et
								    l'écran le dit au lieu d'offrir une action qui échouerait. */}
								<FormulaireEnvoi
									idCard={etat.donnees.cardId}
									destinataire={etat.donnees.expediteurAdresse}
									objet={objetDeReponse(etat.donnees.objet)}
									repondA={etat.donnees.id}
									onEnvoye={onRepondu}
								/>
								{/* LE RETRAIT EST EN BAS, ET SÉPARÉ (§5.3 quater) : ce n'est pas ce qu'on
								    vient faire sur un message. Il réemploie `onClasse` parce que les deux
								    gestes demandent la MÊME chose à l'écran — relire l'arborescence, la
								    liste et le message —, et qu'un second rappel identique n'aurait fait
								    que doubler le chemin. */}
								<CommandeRetrait message={etat.donnees} onRetire={onClasse} />
							</div>
						) : (
							<PiedNonClasse message={etat.donnees} onClasse={onClasse} />
						)}
					</footer>
				</article>
			) : null}
		</Panneau>
	)
}

// =================================================================================================
// L'écran
// =================================================================================================

export function RouteInbox() {
	const [selection, setSelection] = useState<Selection | null>(null)
	const [idOuvert, setIdOuvert] = useState<string | null>(null)
	const [etage, setEtage] = useState<Etage>('dossiers')
	const [annonce, setAnnonce] = useState('')

	// LE MODE N'ENTRE PAS DANS L'ADRESSE, et c'est écrit plutôt que subi (§16.15.5 point 3) :
	// l'inbox ne lit aucun paramètre d'adresse, et lui en inventer un pour ce seul contrôle
	// ouvrirait une question — quelle est l'adresse d'un dossier ? — que cette tranche ne tranche
	// pas. Le mode ne survit donc pas à un rechargement, et l'écart est nommé.
	const [mode, setMode] = useState<ModeFils>('masquees')

	// =============================================================================================
	// L'AMORCE PAR L'ADRESSE — CRM-065 sous-tranche 2c, docs/SPEC-recherche.md §15 et §15.1
	// =============================================================================================
	//
	// C'EST LE SEUL PARAMÈTRE QUE CET ÉCRAN LIT, et le commentaire du `mode` juste au-dessus reste
	// vrai : le filtre de sommeil n'entre toujours pas dans l'adresse. Ce paramètre-ci n'est pas un
	// contrôle de l'écran, c'est une DESTINATION — la palette du §13.5 y mène, et l'inbox l'honore.
	const [parametresUrl, setParametresUrl] = useSearchParams()

	// LU AU MONTAGE ET UNE SEULE FOIS (§15) — PAR CONSTRUCTION, ET NON PAR UN DRAPEAU. L'initialiseur
	// paresseux de `useState` n'est évalué qu'au premier rendu : la valeur ne peut plus changer
	// ensuite, quoi qu'il advienne de l'adresse.
	//
	// LA PREMIÈRE RÉDACTION EMPLOYAIT UN `ref` GARDE-FOU DANS UN EFFET DÉPENDANT DE `parametresUrl`,
	// ET ELLE ÉTAIT FAUSSE — mesuré par la preuve, pas deviné : retirer le paramètre change
	// `parametresUrl`, l'effet se rejoue, et son NETTOYAGE tue la lecture encore en vol. Le drapeau
	// empêchait bien un second départ, mais rien n'empêchait l'annulation du premier : l'écran
	// retirait le paramètre et n'ouvrait jamais le message. La dépendance stable supprime la cause
	// au lieu d'ajouter une garde de plus.
	const [demandeInitiale] = useState(() => parametresUrl.get(PARAMETRE_MESSAGE))

	useEffect(() => {
		if (demandeInitiale === null || demandeInitiale === '') return

		// LE PARAMÈTRE EST RETIRÉ MÊME QUAND IL N'EST PAS HONORÉ (§15.1) — décidé par le TRAITEMENT,
		// jamais par le succès —, et il l'est TOUT DE SUITE, avant même de savoir si le message se
		// lit : l'écran doit être indiscernable d'une arrivée sans paramètre, et l'adresse fait
		// partie de cet état. `replace` : un remplacement d'historique, sans quoi le bouton
		// « Précédent » ramènerait à l'adresse porteuse et rouvrirait le message.
		//
		// LA FORME FONCTIONNELLE N'EST PAS UN STYLE : elle évite de faire dépendre cet effet de
		// `parametresUrl`, dont le changement le rejouerait. Les autres paramètres sont conservés,
		// comme le `sommeil` du board (docs/SPEC-cards.md §16.12.4).
		setParametresUrl(
			(precedents) => {
				const suivants = new URLSearchParams(precedents)
				suivants.delete(PARAMETRE_MESSAGE)
				return suivants
			},
			{ replace: true },
		)

		let vivant = true
		void (async () => {
			// LE DOSSIER SE DÉDUIT DU MESSAGE, il ne se devine pas : `card_id` décide (M16), et le
			// message non classé va aux « Non classés » plutôt que de rester sans dossier.
			const dossier = await lireDossierDuMessage(clientCrm, demandeInitiale)
			if (!vivant) return
			// UN IDENTIFIANT INCONNU N'EST PAS UNE ERREUR (§15) : la boîte s'ouvre sans sélection, et
			// aucun bandeau ne signale l'échec — un refus ne se distingue pas d'une absence.
			if (dossier === null) return
			setSelection(dossier)
			setIdOuvert(demandeInitiale)
			// SOUS 1024 PX, ON ARRIVE SUR LE MESSAGE, pas sur les dossiers : l'utilisateur a demandé
			// un message précis, et lui rendre la pile au premier étage lui ferait refaire à la main
			// les deux pas que l'adresse venait de lui épargner.
			setEtage('message')
		})()
		return () => {
			vivant = false
		}
	}, [demandeInitiale, setParametresUrl])

	const arbre = useArborescence(clientCrm)
	const liste = useMessages(clientCrm, selection)
	const message = useMessage(clientCrm, idOuvert)
	const fils = useFilsEndormis(clientCrm)

	// UN SEUL INSTANT PAR RENDU DE LISTE, partagé par le filtre, les pastilles de ligne et celle du
	// message ouvert (§16.15.4). Il est recalculé quand la liste ou l'état des fils est relu — donc
	// après chaque geste —, jamais à chaque ligne : sinon une échéance franchie pendant le rendu
	// marquerait une ligne et pas sa voisine.
	const maintenant = useMemo(() => new Date(), [liste.etat, fils.etat])

	const filsEndormis = fils.etat.statut === 'pret' ? fils.etat.donnees : new Map<string, string>()

	// LE FIL DU MESSAGE OUVERT EST CALCULÉ SUR LA PAGE COURANTE, et il alimente le SEUL sélecteur
	// du §16.16.4. Il n'est PAS relu au serveur : la page porte déjà les messages du fil qu'elle a
	// rapportés, et une seconde lecture ferait diverger ce que la liste montre de ce que le
	// sélecteur propose — un fil de la page pourrait alors offrir un message que la liste ignore.
	//
	// LA CONSÉQUENCE EST ASSUMÉE ET ÉCRITE (§16.16.3) : un fil dont la page ne porte qu'une partie
	// des messages n'en propose que cette partie. C'est la même borne que celle du compte affiché,
	// et la mention « la liste est tronquée » la signale déjà.
	const messagesDuFil = useMemo(() => {
		if (liste.etat.statut !== 'pret') return []
		return filDuMessage(grouperEnFils(liste.etat.donnees.messages), idOuvert)?.messages ?? []
	}, [liste.etat, idOuvert])

	// APRÈS UN GESTE DE SOMMEIL, l'état des fils est relu — c'est LUI qui décide de la pastille et
	// du filtre —, et la liste ne l'est pas : elle n'a pas changé côté serveur (mesure G), et la
	// relire ferait clignoter l'écran pour rien.
	const apresSommeil = useCallback(
		(issue: 'endormi' | 'reveille') => {
			setAnnonce(issue === 'endormi' ? t('inbox.sleep.announce.slept') : t('inbox.sleep.announce.woken'))
			fils.recharger()
		},
		[fils],
	)

	const choisirDossier = useCallback(
		(choix: Selection) => {
			setSelection((precedent) => (MEME_SELECTION(precedent, choix) ? precedent : choix))
			setIdOuvert(null)
			setEtage('liste')
		},
		[],
	)

	const ouvrirMessage = useCallback((lu: MessageListe) => {
		setIdOuvert(lu.id)
		setEtage('message')
	}, [])

	// APRÈS UN CLASSEMENT, TOUT CE QUI A CHANGÉ EST RELU : les compteurs de l'arbre, la liste des
	// non classés d'où le message sort, et le message lui-même, qui porte désormais une affaire.
	const apresClassement = useCallback(() => {
		setAnnonce(t('inbox.classify.done'))
		arbre.recharger()
		liste.recharger()
		message.recharger()
	}, [arbre, liste, message])

	const titreArbre = useMemo(
		() => (arbre.etat.statut === 'pret' ? arbre.etat.donnees.nonClasses : 0),
		[arbre.etat],
	)

	return (
		<div className="flex flex-col h-full min-h-0" data-testid="route-inbox">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-border lg:hidden">
				<Inbox aria-hidden="true" size={18} className="text-brand" />
				<span className="font-medium">{t('route.inbox.title')}</span>
				<span className="text-sm text-text-3">
					{t('inbox.folders.unclassified')} : {titreArbre}
				</span>
			</div>
			<div className="flex flex-1 min-h-0 flex-col lg:flex-row">
				<PanneauDossiers
					etat={arbre.etat}
					selection={selection}
					onChoisir={choisirDossier}
					onReprise={arbre.reprendre}
					visible={etage === 'dossiers'}
				/>
				<PanneauListe
					etat={liste.etat}
					selection={selection}
					idOuvert={idOuvert}
					onOuvrir={ouvrirMessage}
					onRetour={() => setEtage('dossiers')}
					onReprise={liste.reprendre}
					visible={etage === 'liste'}
					fils={filsEndormis}
					mode={mode}
					onMode={setMode}
					maintenant={maintenant}
				/>
				<PanneauMessage
					etat={message.etat}
					onRetour={() => setEtage('liste')}
					onReprise={message.reprendre}
					onClasse={apresClassement}
					onRepondu={apresClassement}
					visible={etage === 'message'}
					fils={filsEndormis}
					maintenant={maintenant}
					onSommeil={apresSommeil}
					messagesDuFil={messagesDuFil}
					onOuvrir={ouvrirMessage}
				/>
			</div>
			<LiveRegion libelle={t('route.inbox.title')} message={annonce} />
		</div>
	)
}

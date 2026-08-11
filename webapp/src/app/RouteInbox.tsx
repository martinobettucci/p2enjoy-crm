// @spec CRM-057 (docs/BACKLOG.md) — inbox globale : trois panneaux, arborescence, non classés
// @spec docs/SPEC-mail-subsystem.md §18.3 (les trois panneaux), §18.4 (jamais le HTML d'un
//       expéditeur), §18.5 (la pièce jointe saine), §18.1 (les compteurs sont ceux de l'appelant)
// @spec docs/DESIGN_SYSTEM.md §5.4 (inbox), §5.8 (états systématiques), §7 (responsive), §10
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
// @spec docs/JOURNAL.md décision 327
//
// TROIS PANNEAUX SUR GRAND ÉCRAN, UNE PILE EN DESSOUS DE 1024 PX — et la pile est une vraie pile,
// non trois colonnes rétrécies : à cette largeur, trois colonnes ne montreraient ni un objet, ni un
// expéditeur, ni un corps. Un bouton « Retour » remonte d'un cran.
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. Les compteurs, la liste et le message sont ce que la RLS laisse
// passer (§18.1) ; l'écran ne filtre rien et ne devine rien.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Inbox, Paperclip, Download } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	MEME_SELECTION,
	classerMessage,
	lireCardsClassables,
	lireCheminCard,
	urlPieceJointe,
	useArborescence,
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
import { clientCrm } from '../lib/supabase'

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
}: {
	readonly etat: EtatAsync<PageMessages>
	readonly selection: Selection | null
	readonly idOuvert: string | null
	readonly onOuvrir: (message: MessageListe) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly visible: boolean
}) {
	return (
		<Panneau
			id="liste"
			titre={t('inbox.list.title')}
			visible={visible}
			classe="lg:w-[var(--size-inbox-list)] lg:shrink-0 lg:border-r lg:border-border w-full"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.folders')}
				</Button>
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
				etat.donnees.messages.length === 0 ? (
					<EtatVide titre={t('inbox.list.empty.title')} corps={t('inbox.list.empty.body')} />
				) : (
					<>
						<ul aria-label={t('inbox.list.aria')}>
							{etat.donnees.messages.map((message) => (
								<li key={message.id}>
									<button
										type="button"
										data-testid="inbox-message"
										aria-current={message.id === idOuvert ? 'true' : undefined}
										onClick={() => onOuvrir(message)}
										className={[
											'w-full text-left px-3 py-2 border-b border-border',
											'min-h-[var(--size-target)]',
											'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
											message.id === idOuvert ? 'bg-brand-soft' : 'hover:bg-hover',
										].join(' ')}
									>
										<span className="block truncate text-sm text-text-2">{message.expediteur}</span>
										<span className="block truncate font-medium text-ink">{message.objet}</span>
										<span className="block text-sm text-text-3">{dateLisible(message.recuLe)}</span>
									</button>
								</li>
							))}
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

function FormulaireClassement({
	message,
	onClasse,
}: {
	readonly message: MessageComplet
	readonly onClasse: () => void
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
			<Button variante="primaire" onClick={() => setOuvert(true)} data-testid="inbox-classer">
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

function PanneauMessage({
	etat,
	onRetour,
	onReprise,
	onClasse,
	visible,
}: {
	readonly etat: EtatAsync<MessageComplet | null>
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly onClasse: () => void
	readonly visible: boolean
}) {
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
						<p className="text-sm text-text-3">
							{t('inbox.message.received')} {dateLisible(etat.donnees.recuLe)}
						</p>
					</header>

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
							<PiluleCard idCard={etat.donnees.cardId} />
						) : (
							<div className="flex flex-col gap-2">
								<p className="text-sm text-text-2">{t('inbox.message.unclassified')}</p>
								<FormulaireClassement message={etat.donnees} onClasse={onClasse} />
							</div>
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

	const arbre = useArborescence(clientCrm)
	const liste = useMessages(clientCrm, selection)
	const message = useMessage(clientCrm, idOuvert)

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
				/>
				<PanneauMessage
					etat={message.etat}
					onRetour={() => setEtage('liste')}
					onReprise={message.reprendre}
					onClasse={apresClassement}
					visible={etage === 'message'}
				/>
			</div>
			<LiveRegion libelle={t('route.inbox.title')} message={annonce} />
		</div>
	)
}

// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : la liste des pièces d'un courrier et l'aperçu d'une pièce, partagés par
//       l'inbox et le fil de l'affaire ; la portée couvre tout le fichier
// @spec docs/DESIGN_SYSTEM.md §5.80 (la ligne d'une pièce, le panneau dans le flux, l'image, le PDF, le texte extrait et
//       ses états), §5.4 (une pièce non saine n'a pas de lien), §5.28 (un seul panneau ouvert), §5.3 bis (la copie)
// @spec docs/SPEC-pieces-jointes.md §5, §5.2 révisé par la décision 791 ; docs/SPEC-mail-subsystem.md §18.5
// @spec CRM-057 (docs/BACKLOG.md) — la pièce saine téléchargeable, déplacée ici depuis RouteInbox (§18.5)
//
// LE PANNEAU EST DANS LE FLUX, SOUS LA PIÈCE — jamais une modale (décision 791). Le fichier est lu par le client de
// stockage, sous la session, et montré depuis une adresse locale dont le type est forcé : Caddy envoie
// `X-Frame-Options: DENY` sur toute réponse, et c'est ce qui permet d'encadrer un PDF sans l'assouplir.

import { Copy, Download, Paperclip, ScanEye } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { tailleLisible } from '../lib/envoi'
import { urlPieceJointe, type PieceJointe } from '../lib/inbox'
import {
	formeApercu,
	lireFichierPiece,
	lireTextePiece,
	typeForce,
	type FormeApercu,
	type TextePiece,
} from '../lib/pieces-jointes'
import type { ClientCrm } from '../lib/supabase'

/**
 * Le libellé d'un statut d'analyse, avec un repli **documenté** (§18.5).
 *
 * `av_status` est une colonne `text` sous contrainte `CHECK`, non une énumération : un statut inconnu est affiché comme
 * inconnu — et surtout **sans commande** : le repli ne doit jamais glisser du côté permissif.
 */
const LIBELLE_STATUT: Readonly<Record<string, CleTraduction>> = {
	pending: 'inbox.attachments.status.pending',
	infected: 'inbox.attachments.status.infected',
	skipped: 'inbox.attachments.status.skipped',
}

const libelleStatut = (statut: string): CleTraduction => LIBELLE_STATUT[statut] ?? 'inbox.attachments.status.unknown'

const PHRASE_TEXTE: Readonly<Record<Exclude<TextePiece['statut'], 'extracted'>, CleTraduction>> = {
	pending: 'inbox.attachments.text.pending',
	empty: 'inbox.attachments.text.empty',
	unsupported: 'inbox.attachments.text.unsupported',
	failed: 'inbox.attachments.text.failed',
}

/** Les pièces d'un courrier : une ligne par pièce, un seul aperçu ouvert à la fois (§5.28). */
export function ListePiecesJointes({
	pieces,
	client,
	compacte = false,
}: {
	readonly pieces: readonly PieceJointe[]
	readonly client: ClientCrm | null
	readonly compacte?: boolean
}) {
	const [ouverte, setOuverte] = useState<string | null>(null)
	return (
		<ul className={compacte ? 'flex flex-col gap-1 text-sm' : 'flex flex-col'} data-testid="pieces-jointes">
			{pieces.map((piece) => (
				<LignePieceJointe
					key={piece.id}
					piece={piece}
					client={client}
					ouverte={ouverte === piece.id}
					onBasculer={() => setOuverte((courante) => (courante === piece.id ? null : piece.id))}
					onFermer={() => setOuverte(null)}
				/>
			))}
		</ul>
	)
}

function LignePieceJointe({
	piece,
	client,
	ouverte,
	onBasculer,
	onFermer,
}: {
	readonly piece: PieceJointe
	readonly client: ClientCrm | null
	readonly ouverte: boolean
	readonly onBasculer: () => void
	readonly onFermer: () => void
}) {
	const [echec, setEchec] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	const forme = formeApercu(piece)
	const idPanneau = `apercu-${piece.id}`

	const telecharger = useCallback(async () => {
		const url = await urlPieceJointe(client, piece.chemin)
		if (url === null) {
			setEchec(true)
			return
		}
		setEchec(false)
		window.open(url, '_blank', 'noopener,noreferrer')
	}, [client, piece.chemin])

	// LA COMMANDE RESTE MONTÉE ET PORTE `aria-expanded` (§5.80, §5.43) : le focus lui revient sans différé.
	const fermer = useCallback(() => {
		onFermer()
		commande.current?.focus()
	}, [onFermer])

	const echap = (evenement: KeyboardEvent<HTMLLIElement>) => {
		if (evenement.key === 'Escape' && ouverte) {
			evenement.stopPropagation()
			fermer()
		}
	}

	return (
		<li className="py-1" data-testid="inbox-piece-jointe" data-piece={piece.nom} onKeyDown={echap}>
			<div className="flex flex-wrap items-center gap-x-2">
				<Paperclip aria-hidden="true" size={16} className="shrink-0 text-text-3" />
				<span className="min-w-0 truncate" title={piece.nom}>
					{piece.nom}
				</span>
				<span className="shrink-0 text-sm text-text-2 tabular-nums" data-testid="taille-piece">
					{tailleLisible(piece.taille)}
				</span>
				{/* UNE PIÈCE NON SAINE N'A PAS DE COMMANDE, elle a un statut en toutes lettres (§5.4). */}
				{piece.statutAnalyse === 'clean' ? (
					<span className="flex basis-full flex-wrap items-center gap-x-1 md:basis-auto">
						{forme === null ? null : (
							<Button
								ref={commande}
								variante="discret"
								taille="compacte"
								aria-expanded={ouverte}
								aria-controls={idPanneau}
								aria-label={t('inbox.attachments.preview.name', { nom: piece.nom })}
								onClick={onBasculer}
								data-testid="apercu-piece"
							>
								<ScanEye aria-hidden="true" size={14} />
								{t('inbox.attachments.preview')}
							</Button>
						)}
						<Button
							variante="discret"
							taille="compacte"
							aria-label={t('inbox.attachments.download.name', { nom: piece.nom })}
							onClick={() => void telecharger()}
						>
							<Download aria-hidden="true" size={14} />
							{t('inbox.attachments.download')}
						</Button>
					</span>
				) : (
					<span className="text-sm text-text-3">{t(libelleStatut(piece.statutAnalyse))}</span>
				)}
			</div>
			{echec ? <p className="text-sm text-danger">{t('inbox.attachments.unavailable')}</p> : null}
			{ouverte && forme !== null ? (
				<ApercuPieceJointe
					id={idPanneau}
					piece={piece}
					forme={forme}
					client={client}
					onTelecharger={() => void telecharger()}
					onFermer={fermer}
				/>
			) : null}
		</li>
	)
}

type EtatFichier = { readonly etat: 'chargement' } | { readonly etat: 'pret'; readonly url: string } | { readonly etat: 'erreur' }
type EtatTexte = { readonly etat: 'chargement' } | { readonly etat: 'pret'; readonly texte: TextePiece } | { readonly etat: 'erreur' }

function ApercuPieceJointe({
	id,
	piece,
	forme,
	client,
	onTelecharger,
	onFermer,
}: {
	readonly id: string
	readonly piece: PieceJointe
	readonly forme: FormeApercu
	readonly client: ClientCrm | null
	readonly onTelecharger: () => void
	readonly onFermer: () => void
}) {
	const [fichier, setFichier] = useState<EtatFichier>({ etat: 'chargement' })
	const [texte, setTexte] = useState<EtatTexte>({ etat: 'chargement' })
	const [tentative, setTentative] = useState(0)

	// LE FICHIER, pour une image et un PDF : lu sous la session, montré depuis une adresse locale au type FORCÉ, libérée
	// à la fermeture (§5.80).
	useEffect(() => {
		if (forme === 'texte') return
		let vivant = true
		let url: string | null = null
		setFichier({ etat: 'chargement' })
		void lireFichierPiece(client, piece.chemin).then((blob) => {
			if (!vivant) return
			if (blob === null) {
				setFichier({ etat: 'erreur' })
				return
			}
			url = URL.createObjectURL(new Blob([blob], { type: typeForce(forme, piece) }))
			setFichier({ etat: 'pret', url })
		})
		return () => {
			vivant = false
			if (url !== null) URL.revokeObjectURL(url)
		}
	}, [client, forme, piece, tentative])

	// LE TEXTE, pour un PDF et un fichier Office, sous la RLS de la pièce.
	useEffect(() => {
		if (forme === 'image') return
		let vivant = true
		setTexte({ etat: 'chargement' })
		void lireTextePiece(client, piece.id).then((lu) => {
			if (vivant) setTexte(lu === null ? { etat: 'erreur' } : { etat: 'pret', texte: lu })
		})
		return () => {
			vivant = false
		}
	}, [client, forme, piece.id, tentative])

	const titre = t('inbox.attachments.preview.name', { nom: piece.nom })
	return (
		<section
			id={id}
			aria-label={titre}
			className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
			data-testid="apercu-panneau"
		>
			<div className="flex flex-wrap items-center gap-2">
				<p className="min-w-0 basis-full break-words font-medium text-ink md:flex-1 md:basis-auto">{piece.nom}</p>
				<Button variante="secondaire" taille="compacte" onClick={onTelecharger}>
					<Download aria-hidden="true" size={14} />
					{t('inbox.attachments.download')}
				</Button>
				<Button variante="secondaire" taille="compacte" onClick={onFermer} data-testid="apercu-fermer">
					{t('inbox.attachments.preview.close')}
				</Button>
			</div>

			{forme === 'texte' ? null : fichier.etat === 'chargement' ? (
				<div
					role="status"
					aria-label={t('inbox.attachments.preview.loading')}
					className="h-[60vh] animate-pulse rounded-sm bg-hover md:h-[min(70vh,720px)]"
					data-testid="apercu-chargement"
				/>
			) : fichier.etat === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft p-3 text-danger-on-soft">
					<span>{t('inbox.attachments.preview.error')}</span>
					<Button variante="secondaire" taille="compacte" onClick={() => setTentative((n) => n + 1)}>
						{t('inbox.attachments.preview.retry')}
					</Button>
				</div>
			) : forme === 'image' ? (
				<div className="flex justify-center rounded-sm bg-hover p-2">
					<img
						src={fichier.url}
						alt={titre}
						className="max-h-[min(70vh,720px)] max-w-full object-contain"
						data-testid="apercu-image"
					/>
				</div>
			) : (
				<iframe
					src={fichier.url}
					title={titre}
					className="h-[60vh] w-full rounded-sm border border-border md:h-[min(70vh,720px)]"
					data-testid="apercu-pdf"
				/>
			)}

			{forme === 'image' ? null : <TexteExtrait piece={piece} etat={texte} onReessayer={() => setTentative((n) => n + 1)} />}
		</section>
	)
}

function TexteExtrait({
	piece,
	etat,
	onReessayer,
}: {
	readonly piece: PieceJointe
	readonly etat: EtatTexte
	readonly onReessayer: () => void
}) {
	const [copie, setCopie] = useState<'copie' | 'echec' | null>(null)
	const zone = useRef<HTMLDivElement>(null)

	const copier = async (texte: string) => {
		try {
			await navigator.clipboard.writeText(texte)
			setCopie('copie')
		} catch {
			// L'ÉCHEC EST DIT (§5.3 bis), et le texte est sélectionné pour une copie au clavier.
			setCopie('echec')
			const selection = window.getSelection()
			if (zone.current !== null && selection !== null) {
				const plage = document.createRange()
				plage.selectNodeContents(zone.current)
				selection.removeAllRanges()
				selection.addRange(plage)
			}
		}
	}

	return (
		<div className="flex flex-col gap-2" data-testid="texte-extrait">
			<p className="text-sm font-medium text-text-2">{t('inbox.attachments.text.title')}</p>
			{etat.etat === 'chargement' ? (
				<p className="text-sm text-text-3">{t('inbox.attachments.text.loading')}</p>
			) : etat.etat === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
					<span>{t('inbox.attachments.text.error')}</span>
					<Button variante="secondaire" taille="compacte" onClick={onReessayer}>
						{t('inbox.attachments.preview.retry')}
					</Button>
				</div>
			) : etat.texte.statut !== 'extracted' ? (
				<p className="text-sm text-text-2" data-testid="texte-etat">
					{t(PHRASE_TEXTE[etat.texte.statut])}
				</p>
			) : (
				<>
					<div
						ref={zone}
						tabIndex={0}
						role="region"
						aria-label={t('inbox.attachments.text.region', { nom: piece.nom })}
						className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-hover p-3 text-text"
						data-testid="texte-contenu"
					>
						{etat.texte.texte}
					</div>
					{etat.texte.tronque ? <p className="text-sm text-text-2">{t('inbox.attachments.text.truncated')}</p> : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variante="secondaire"
							taille="compacte"
							onClick={() => void copier(etat.texte.statut === 'extracted' ? etat.texte.texte : '')}
						>
							<Copy aria-hidden="true" size={14} />
							{t('inbox.attachments.text.copy')}
						</Button>
						<span role="status" className="text-sm text-text-2">
							{copie === 'copie'
								? t('inbox.attachments.text.copied')
								: copie === 'echec'
									? t('inbox.attachments.text.copyFailed')
									: ''}
						</span>
					</div>
				</>
			)}
		</div>
	)
}

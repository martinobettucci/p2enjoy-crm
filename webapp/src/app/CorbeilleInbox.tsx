// @spec CRM-138 (docs/BACKLOG.md) — tranche T3 : la corbeille de l'inbox — « Effacer » dans la rangée de commandes du message
//       ouvert et sa confirmation dans le flux, la case « boîte mail » offerte selon la capacité rendue par la base, l'entrée
//       de tête « Corbeille », sa liste plate avec l'état du déplacement IMAP et « Restaurer » sans confirmation
// @spec docs/DESIGN_SYSTEM.md §5.102 (précisé avant le code de T3 : pas de troisième panneau), §5.16 (la phrase de rétention,
//       « Auteur inconnu », « Inconnue », restaurer sans confirmation), §5.13 (le focus ne va jamais sur ce qui disparaît),
//       §5.96 (la case native de 24 px, libellé pour cible étendue) ; docs/SPEC-mail-subsystem.md §29.1, §29.3 à §29.5 ;
//       docs/JOURNAL.md décisions 878, 917, 920 et 921
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. « Effacer » est toujours offert ; la case ne paraît que sur la capacité `true` rendue par la
// base (`mailbox_trash_permitted`) ; la corbeille est ce que `trashed_messages` rend ; chaque geste est une fonction de la
// base, qui refuse de toute façon, et son refus est traduit par un dictionnaire fermé.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArchiveRestore, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	effacerMessage,
	restaurerMessage,
	type MessageEnCorbeille,
	type MotifDeplacement,
	type RefusCorbeille,
} from '../lib/corbeille-inbox'
import { clientCrm } from '../lib/supabase'
import { Panneau } from './PanneauInbox'

const dateCourte = (iso: string): string => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'short' })

/** Le dictionnaire fermé des refus d'un effacement (§5.102), clé par clé : le contrôle des clés les voit toutes. */
const REFUS_EFFACEMENT: Readonly<Record<RefusCorbeille, CleTraduction>> = {
	introuvable: 'inbox.trash.refus.introuvable',
	refuse: 'inbox.trash.refus.refuse',
	aucune_boite: 'inbox.trash.refus.aucune_boite',
	reseau: 'inbox.trash.refus.reseau',
	inconnu: 'inbox.trash.refus.inconnu',
}

/** Ceux d'une restauration : `aucune_boite` n'y est pas atteignable, et se dit comme un refus inconnu. */
const REFUS_RESTAURATION: Readonly<Record<RefusCorbeille, CleTraduction>> = {
	introuvable: 'inbox.trash.restore.refus.introuvable',
	refuse: 'inbox.trash.restore.refus.refuse',
	aucune_boite: 'inbox.trash.restore.refus.inconnu',
	reseau: 'inbox.trash.restore.refus.reseau',
	inconnu: 'inbox.trash.restore.refus.inconnu',
}

const PHRASE_MOTIF: Readonly<Record<MotifDeplacement, CleTraduction>> = {
	no_trash_folder: 'inbox.trash.motif.no_trash_folder',
	move_unsupported: 'inbox.trash.motif.move_unsupported',
	account_not_found: 'inbox.trash.motif.account_not_found',
	auth_failed: 'inbox.trash.motif.auth_failed',
	timeout: 'inbox.trash.motif.timeout',
	tls_failed: 'inbox.trash.motif.tls_failed',
	connection_failed: 'inbox.trash.motif.connection_failed',
	inconnu: 'inbox.trash.motif.inconnu',
}

// =================================================================================================
// Le message ouvert — la rangée de commandes et la confirmation d'« Effacer »
// =================================================================================================

/**
 * La rangée de commandes du message ouvert (§5.102) : `commandes` — le sommeil, puis la lecture —, puis « Effacer ». La
 * confirmation vit DANS LE FLUX, sous la rangée, jamais en modale (décision 921). Montée avec la clé du message, elle se
 * referme et décoche sa case d'un message à l'autre.
 */
export function RangeeCommandesMessage({
	idMessage,
	objet,
	effacableDansBoite,
	retention,
	commandes,
	onEfface,
}: {
	readonly idMessage: string
	readonly objet: string
	/** La capacité rendue par la base ; seule `true` rend la case (§29.1). */
	readonly effacableDansBoite: boolean
	readonly retention: EtatAsync<number>
	readonly commandes: ReactNode
	readonly onEfface: () => void
}) {
	const [ouverte, setOuverte] = useState(false)
	const [aussiBoite, setAussiBoite] = useState(false)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<RefusCorbeille | null>(null)
	const refEffacer = useRef<HTMLButtonElement | null>(null)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idQuestion = useId()
	const idAide = useId()

	// LE FOCUS ENTRE SUR « Annuler » (§5.102) : la touche Entrée d'un geste trop rapide n'efface rien.
	useEffect(() => {
		if (ouverte) refAnnuler.current?.focus()
	}, [ouverte])

	const abandonner = useCallback(() => {
		setOuverte(false)
		setRefus(null)
		// LE FOCUS REVIENT À LA COMMANDE QUI A OUVERT LA CONFIRMATION (§5.13).
		requestAnimationFrame(() => refEffacer.current?.focus())
	}, [])

	const confirmer = useCallback(async () => {
		setEnVol(true)
		setRefus(null)
		const resultat = await effacerMessage(clientCrm, idMessage, effacableDansBoite && aussiBoite)
		setEnVol(false)
		if (resultat !== null) {
			// LE BLOC RESTE OUVERT (§5.102) : il est le seul endroit où lire la cause.
			setRefus(resultat)
			return
		}
		setOuverte(false)
		onEfface()
	}, [aussiBoite, effacableDansBoite, idMessage, onEfface])

	return (
		<div className="flex flex-col gap-2">
			{/* LA RANGÉE PASSE À LA LIGNE SOUS `md` (§5.102), cibles de 40 px conservées : `flex-wrap`. `items-start` : une
			    secondaire compacte ne s'étire pas (§5.3 septies). */}
			<div className="flex flex-wrap items-start gap-2" data-testid="inbox-commandes-message">
				{commandes}
				<Button
					ref={refEffacer}
					taille="compacte"
					aria-expanded={ouverte}
					disabled={enVol}
					onClick={() => {
						setRefus(null)
						// DÉCOCHÉE À CHAQUE OUVERTURE (§5.102) : effacer dans la boîte se décide à chaque fois.
						setAussiBoite(false)
						setOuverte(true)
					}}
					data-testid="inbox-effacer"
				>
					<Trash2 aria-hidden="true" size={16} />
					{t('inbox.trash.delete')}
				</Button>
			</div>
			{ouverte ? (
				<div
					role="group"
					aria-label={t('inbox.trash.confirm.group')}
					aria-describedby={idQuestion}
					data-testid="inbox-effacer-confirmation"
					className="flex flex-col gap-3 rounded-sm border border-border p-3"
					onKeyDown={(evenement) => {
						if (evenement.key === 'Escape' && !enVol) {
							evenement.stopPropagation()
							abandonner()
						}
					}}
				>
					<div id={idQuestion} className="flex flex-col gap-1">
						<p className="font-medium break-words">{t('inbox.trash.confirm.question', { objet })}</p>
						<p className="text-sm text-text-2">
							{retention.statut === 'pret'
								? t('inbox.trash.confirm.retention', { n: String(retention.donnees) })
								: t('inbox.trash.confirm.retentionUnknown')}
						</p>
					</div>
					{/* ABSENTE, ET NON DÉSACTIVÉE, QUAND LA BASE NE L'OFFRE PAS (§5.102) : il n'y a pas de boîte à nommer. */}
					{effacableDansBoite ? (
						<div className="flex flex-col gap-1">
							<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									data-testid="inbox-effacer-boite"
									checked={aussiBoite}
									disabled={enVol}
									onChange={(evenement) => setAussiBoite(evenement.target.checked)}
									aria-describedby={idAide}
									className="size-6 shrink-0 accent-brand"
								/>
								{t('inbox.trash.confirm.mailbox')}
							</label>
							<p id={idAide} className="text-sm text-text-2">
								{t('inbox.trash.confirm.mailboxHelp')}
							</p>
						</div>
					) : null}
					{refus !== null ? (
						<p
							role="alert"
							data-testid="inbox-effacer-refus"
							className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
						>
							{t(REFUS_EFFACEMENT[refus])}
						</p>
					) : null}
					{/* SOUS `md`, L'UN SOUS L'AUTRE, LE DESTRUCTIF EN DERNIER (§5.102). */}
					<div className="flex flex-col gap-2 md:flex-row">
						<Button
							ref={refAnnuler}
							disabled={enVol}
							onClick={abandonner}
							data-testid="inbox-effacer-annuler"
						>
							{t('inbox.trash.confirm.cancel')}
						</Button>
						<Button
							variante="destructif"
							disabled={enVol}
							aria-busy={enVol ? 'true' : undefined}
							onClick={() => void confirmer()}
							data-testid="inbox-effacer-confirmer"
						>
							<Trash2 aria-hidden="true" size={16} />
							{enVol ? t('inbox.trash.confirm.pending') : t('inbox.trash.confirm.submit')}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	)
}

// =================================================================================================
// Panneau 1 — l'entrée « Corbeille »
// =================================================================================================

/**
 * La dernière entrée de tête (§5.102) : le patron `BoutonDossier`, `Trash2`, son compte en `--color-text-3`, sans pastille
 * — une corbeille n'attend aucun geste. Toujours rendue, à zéro compris ; le compte n'est pas rendu pendant la lecture ni
 * sur son échec, la liste dira l'erreur (§5.98).
 */
export function EntreeCorbeille({
	nombre,
	choisie,
	onChoisir,
	refBouton,
}: {
	readonly nombre: number | null
	readonly choisie: boolean
	readonly onChoisir: () => void
	readonly refBouton: React.RefObject<HTMLButtonElement | null>
}) {
	return (
		<ul className="border-t border-border mt-1 pt-1">
			<li>
				<button
					ref={refBouton}
					type="button"
					aria-current={choisie ? 'true' : undefined}
					aria-label={
						nombre === null
							? t('inbox.trash.folder.aria.lecture')
							: nombre === 1
								? t('inbox.trash.folder.aria.one')
								: t('inbox.trash.folder.aria.many', { n: String(nombre) })
					}
					onClick={onChoisir}
					data-testid="inbox-corbeille"
					className={[
						'w-full min-w-0 flex items-center justify-between gap-2 text-left',
						'min-h-[var(--size-target)] pl-3 pr-3 py-1',
						'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
						choisie ? 'bg-brand-soft text-brand font-medium' : 'text-ink hover:bg-hover',
					].join(' ')}
				>
					<span className="flex items-center gap-2 min-w-0">
						<Trash2 aria-hidden="true" size={16} className="shrink-0" />
						<span className="truncate min-w-0">{t('inbox.trash.folder')}</span>
					</span>
					{nombre === null ? null : (
						<span aria-hidden="true" className="shrink-0 text-sm text-text-3 tabular-nums font-normal">
							{nombre}
						</span>
					)}
				</button>
			</li>
		</ul>
	)
}

// =================================================================================================
// Panneau 2 — la liste de la corbeille
// =================================================================================================

/** L'état du déplacement IMAP en toutes lettres (§29.5) ; rien sans déplacement demandé. */
function EtatDuDeplacement({ message }: { readonly message: MessageEnCorbeille }) {
	if (message.deplacement === 'aucun') return null
	if (message.deplacement === 'echec') {
		return (
			<span className="flex items-start gap-1 text-sm text-danger-on-soft" data-testid="inbox-corbeille-deplacement">
				<TriangleAlert aria-hidden="true" size={14} className="shrink-0 mt-[3px]" />
				<span className="break-words">
					{t('inbox.trash.move.failed', { motif: t(PHRASE_MOTIF[message.motifDeplacement ?? 'inconnu']) })}
				</span>
			</span>
		)
	}
	return (
		<span className="text-sm text-text-2" data-testid="inbox-corbeille-deplacement">
			{message.deplacement === 'fait' ? t('inbox.trash.move.done') : t('inbox.trash.move.pending')}
		</span>
	)
}

function LigneCorbeille({
	message,
	onRestaure,
	refLigne,
}: {
	readonly message: MessageEnCorbeille
	readonly onRestaure: (id: string) => void
	readonly refLigne: (element: HTMLLIElement | null) => void
}) {
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<RefusCorbeille | null>(null)
	const restaurer = useCallback(async () => {
		setEnVol(true)
		setRefus(null)
		const resultat = await restaurerMessage(clientCrm, message.id)
		setEnVol(false)
		if (resultat !== null) {
			setRefus(resultat)
			return
		}
		onRestaure(message.id)
	}, [message.id, onRestaure])
	return (
		<li
			ref={refLigne}
			tabIndex={-1}
			data-testid="inbox-corbeille-ligne"
			data-message={message.id}
			className="flex flex-col gap-1 border-b border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
		>
			<span className="font-medium break-words">{message.objet}</span>
			<span className="text-sm text-text-2 break-words">{message.expediteur}</span>
			<span className="text-sm text-text-2">
				{t('inbox.trash.deletedBy', {
					date: dateCourte(message.effaceLe),
					auteur: message.effacePar ?? t('inbox.trash.unknownAuthor'),
				})}
			</span>
			<span className="text-sm text-text-2">
				{t('inbox.trash.purgeOn', {
					date: message.purgeLe === null ? t('inbox.trash.unknownDate') : dateCourte(message.purgeLe),
				})}
			</span>
			<EtatDuDeplacement message={message} />
			{refus !== null ? (
				<p
					role="alert"
					data-testid="inbox-corbeille-refus"
					className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					{t(REFUS_RESTAURATION[refus])}
				</p>
			) : null}
			<div className="flex">
				{/* SANS CONFIRMATION (§5.16) : c'est le geste qui répare. */}
				<Button
					taille="compacte"
					disabled={enVol}
					aria-busy={enVol ? 'true' : undefined}
					aria-label={t('inbox.trash.restore.aria', { objet: message.objet })}
					onClick={() => void restaurer()}
					data-testid="inbox-corbeille-restaurer"
				>
					<ArchiveRestore aria-hidden="true" size={16} />
					{enVol ? t('inbox.trash.restore.pending') : t('inbox.trash.restore')}
				</Button>
			</div>
		</li>
	)
}

/**
 * La corbeille, dans la place des deuxième et troisième panneaux (§5.102, précisé avant le code) : un message effacé ne
 * s'ouvre pas, il se restaure. La phrase de rétention et, pour qui n'administre pas l'espace, celle de la portée, en tête,
 * au-dessus des lignes et de l'état vide (§5.16).
 */
export function PanneauCorbeille({
	etat,
	retention,
	personnelle,
	mention,
	onRestaure,
	onRetour,
	onReprise,
	visible,
	refVide,
	refsLignes,
}: {
	readonly etat: EtatAsync<readonly MessageEnCorbeille[]>
	readonly retention: EtatAsync<number>
	/** Vrai quand la base rend refusée l'administration de l'espace : la personne ne voit que ses messages. */
	readonly personnelle: boolean
	/** La mention de succès de la dernière restauration, en `role="status"` ; vide sinon. */
	readonly mention: string
	readonly onRestaure: (id: string) => void
	readonly onRetour: () => void
	readonly onReprise: () => void
	readonly visible: boolean
	readonly refVide: React.RefObject<HTMLDivElement | null>
	readonly refsLignes: React.RefObject<Map<string, HTMLLIElement>>
}) {
	return (
		<Panneau
			id="corbeille"
			titre={t('inbox.trash.folder')}
			visible={visible}
			classe="flex-1 w-full min-w-0"
			entete={
				<Button variante="discret" taille="compacte" className="lg:hidden" onClick={onRetour}>
					{t('inbox.back.folders')}
				</Button>
			}
		>
			<div className="flex flex-col gap-1 px-3 py-2 border-b border-border">
				{/* SA LECTURE EN ÉCHEC RETIRE LA PHRASE SANS RIEN INVENTER (§5.16). */}
				{retention.statut === 'pret' ? (
					<p className="text-sm text-text-2">{t('inbox.trash.retention', { n: String(retention.donnees) })}</p>
				) : null}
				{personnelle ? <p className="text-sm text-text-2">{t('inbox.trash.personal')}</p> : null}
				<p role="status" className="text-sm text-text-2 empty:hidden" data-testid="inbox-corbeille-mention">
					{mention}
				</p>
			</div>
			{etat.statut === 'chargement' ? <SkeletonListe lignes={3} libelle={t('state.loading.aria')} /> : null}
			{etat.statut === 'erreur' ? (
				<div role="alert">
					<EtatErreur
						titre={t('inbox.trash.error')}
						corps={t('state.error.unknown')}
						libelleReprise={t('state.error.retry')}
						onReprise={onReprise}
					/>
				</div>
			) : null}
			{etat.statut === 'pret' && etat.donnees.length === 0 ? (
				// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION (§5.16) ; il reçoit le focus quand la dernière ligne part (§5.13).
				<div ref={refVide} tabIndex={-1} data-testid="inbox-corbeille-vide" className="focus-visible:outline-2 focus-visible:outline-brand">
					<EtatVide titre={t('inbox.trash.empty')} corps="" />
				</div>
			) : null}
			{etat.statut === 'pret' && etat.donnees.length > 0 ? (
				<ul aria-label={t('inbox.trash.list.aria')} data-testid="inbox-corbeille-liste">
					{etat.donnees.map((message) => (
						<LigneCorbeille
							key={message.id}
							message={message}
							onRestaure={onRestaure}
							refLigne={(element) => {
								if (element === null) refsLignes.current.delete(message.id)
								else refsLignes.current.set(message.id, element)
							}}
						/>
					))}
				</ul>
			) : null}
		</Panneau>
	)
}

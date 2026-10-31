// @spec CRM-073 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Webhooks — lister, créer, modifier, régénérer le secret,
//       supprimer ; l'historique des remises et le renvoi
// @spec docs/SPEC-webhooks.md §3 (pas d'événement de contact sous filtre de channel), §4.1 (secret rendu une fois), §5.3,
//       §6 (l'hôte seul en liste ; données personnelles), §7, §12 ; docs/DESIGN_SYSTEM.md §5.79 (l'écran), §5.73 et §5.71
//       (la forme reprise), §5.59 (capacité d'administrer), §5.27 (bloc dans une ligne de tableau), §5.8 (états)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : refusée par la base, la capacité d'administrer ferme l'écran ; la
//       RLS et les fonctions de la base restent seules juges de chaque écriture, et leurs refus sont traduits

import { Copy, PencilLine, Plus, Redo2, RotateCw, ScrollText, Trash2, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import { grouperChannelsParTrack, lireChannelsLiables, type ChannelLiable } from '../lib/objectifs-ecriture'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import {
	creerWebhook,
	EVENEMENTS_AFFAIRE,
	EVENEMENTS_CONTACT,
	LIMITE_HISTORIQUE,
	lireRemises,
	lireWebhooks,
	modifierWebhook,
	regenererSecret,
	renvoyerRemise,
	supprimerWebhook,
	type EtatRemise,
	type EvenementWebhook,
	type MotifRemise,
	type NatureRefusWebhook,
	type Remise,
	type Webhook,
} from '../lib/webhooks'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'
const CLASSES_REFUS = 'flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]'

export const CLES_EVENEMENT: Readonly<Record<EvenementWebhook, CleTraduction>> = {
	'card.created': 'admin.webhooks.event.cardCreated',
	'card.step_changed': 'admin.webhooks.event.cardStepChanged',
	'card.owner_changed': 'admin.webhooks.event.cardOwnerChanged',
	'card.archived': 'admin.webhooks.event.cardArchived',
	'card.trashed': 'admin.webhooks.event.cardTrashed',
	'card.restored': 'admin.webhooks.event.cardRestored',
	'contact.created': 'admin.webhooks.event.contactCreated',
	'contact.updated': 'admin.webhooks.event.contactUpdated',
	'contact.deleted': 'admin.webhooks.event.contactDeleted',
}

const CLES_MOTIF: Readonly<Record<MotifRemise, CleTraduction>> = {
	timeout: 'admin.webhooks.motif.timeout',
	connection_refused: 'admin.webhooks.motif.connectionRefused',
	address_forbidden: 'admin.webhooks.motif.addressForbidden',
	tls_error: 'admin.webhooks.motif.tls',
	dns_error: 'admin.webhooks.motif.dns',
	network_error: 'admin.webhooks.motif.network',
}

const CLES_REFUS: Readonly<Record<NatureRefusWebhook, CleTraduction>> = {
	adresse: 'admin.webhooks.refus.adresse',
	nom: 'admin.webhooks.refus.nom',
	evenements: 'admin.webhooks.refus.evenements',
	channel: 'admin.webhooks.refus.channel',
	'en-attente': 'admin.webhooks.refus.enAttente',
	desactive: 'admin.webhooks.refus.desactive',
	forbidden: 'admin.webhooks.refus.forbidden',
	introuvable: 'admin.webhooks.refus.introuvable',
	network: 'admin.webhooks.refus.panne',
	unknown: 'admin.webhooks.refus.panne',
}

const dateCourte = (iso: string) =>
	new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly webhooks: readonly Webhook[] }

type Ouverture =
	| { readonly type: 'creation' }
	| { readonly type: 'modification'; readonly webhook: Webhook }
	| { readonly type: 'historique'; readonly webhook: Webhook }
	| { readonly type: 'rotation'; readonly webhook: Webhook }
	| { readonly type: 'suppression'; readonly webhook: Webhook }
	| { readonly type: 'secret'; readonly nom: string; readonly secret: string; readonly idRetour: string }
	| null

export type ProprietesReglagesWebhooks = { readonly client?: ClientCrm | null }

export function ReglagesWebhooks({ client = clientCrm }: ProprietesReglagesWebhooks = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [channels, setChannels] = useState<readonly ChannelLiable[]>([])
	const [tentative, setTentative] = useState(0)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert le bloc (§5.13), ou à « Nouveau webhook » quand sa ligne a disparu (§5.29).
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null || administration === 'en-lecture' || administration === 'refusee') return
		const r = ++rang.current
		void lireWebhooks(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', webhooks: lu.donnees })
		})
	}, [client, idWorkspace, administration, tentative])

	useEffect(() => {
		if (client === null || idWorkspace === null || administration === 'en-lecture' || administration === 'refusee') return
		void lireChannelsLiables(client, idWorkspace).then((lu) => {
			if (lu.statut === 'pret') setChannels(lu.donnees)
		})
	}, [client, idWorkspace, administration])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		const cible =
			document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`) ??
			document.querySelector<HTMLElement>('[data-retour-focus="nouveau"]')
		cible?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.webhooks.noworkspace')} />
	}
	if (administration === 'refusee' || (lecture.statut === 'erreur' && lecture.nature === 'forbidden')) {
		return <EtatRefus titre={t('admin.webhooks.forbidden.title')} corps={t('admin.webhooks.forbidden.body')} />
	}

	const fermer = () => setOuverture(null)
	const relire = () => setTentative((n) => n + 1)
	const ouvrir = (suivante: Exclude<Ouverture, null>, idRetour: string) => {
		retourFocus.current = idRetour
		setAnnonce('')
		setOuverture(suivante)
	}
	const nomChannel = (idChannel: string | null) => {
		if (idChannel === null) return null
		const channel = channels.find((c) => c.id === idChannel)
		if (channel === undefined) return null
		return channel.track === null ? channel.nom : `${channel.track.nom} › ${channel.nom}`
	}

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-webhooks">
			<h2 className="text-h3">{t('admin.webhooks.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.webhooks.intro')}</p>
			{ouverture?.type === 'creation' ? null : (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variante="primaire"
						data-retour-focus="nouveau"
						data-testid="nouveau-webhook"
						onClick={() => ouvrir({ type: 'creation' }, 'nouveau')}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.webhooks.new')}
					</Button>
				</div>
			)}
			<p role="status" className="sr-only" data-testid="annonce-webhooks">
				{annonce}
			</p>

			{ouverture?.type === 'creation' ? (
				<FicheWebhook
					client={client}
					idWorkspace={idWorkspace}
					webhook={null}
					channels={channels}
					onFermer={fermer}
					onCree={(nom, secret, id) => {
						setAnnonce(t('admin.webhooks.created', { nom }))
						retourFocus.current = `historique-${id}`
						setOuverture({ type: 'secret', nom, secret, idRetour: `historique-${id}` })
						relire()
					}}
					onModifie={() => undefined}
				/>
			) : null}
			{ouverture?.type === 'secret' ? (
				<BlocSecret
					nom={ouverture.nom}
					secret={ouverture.secret}
					onFermer={() => {
						retourFocus.current = ouverture.idRetour
						fermer()
					}}
				/>
			) : null}

			{lecture.statut === 'chargement' || administration === 'en-lecture' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.webhooks.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : lecture.webhooks.length === 0 ? (
				ouverture?.type === 'creation' || ouverture?.type === 'secret' ? null : (
					<EtatVide titre={t('admin.webhooks.empty.title')} corps={t('admin.webhooks.empty.body')} />
				)
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-webhooks">
					{lecture.webhooks.map((webhook) => {
						const ouvert = ouverture !== null && 'webhook' in ouverture && ouverture.webhook.id === webhook.id ? ouverture : null
						if (ouvert?.type === 'modification') {
							return (
								<li key={webhook.id} className="p-3 border-b border-border last:border-b-0">
									<FicheWebhook
										client={client}
										idWorkspace={idWorkspace}
										webhook={webhook}
										channels={channels}
										onFermer={fermer}
										onCree={() => undefined}
										onModifie={(nom) => {
											setAnnonce(t('admin.webhooks.saved', { nom }))
											fermer()
											relire()
										}}
									/>
								</li>
							)
						}
						return (
							<li
								key={webhook.id}
								data-testid="ligne-webhook"
								data-webhook={webhook.id}
								className="flex flex-col gap-2 px-4 py-2 border-b border-border last:border-b-0"
							>
								<LigneWebhook
									webhook={webhook}
									nomChannel={nomChannel(webhook.idChannel)}
									ouvert={ouvert?.type ?? null}
									onHistorique={() =>
										ouvert?.type === 'historique'
											? fermer()
											: ouvrir({ type: 'historique', webhook }, `historique-${webhook.id}`)
									}
									onModifier={() => ouvrir({ type: 'modification', webhook }, `modifier-${webhook.id}`)}
									onRegenerer={() => ouvrir({ type: 'rotation', webhook }, `regenerer-${webhook.id}`)}
									onSupprimer={() => ouvrir({ type: 'suppression', webhook }, `supprimer-${webhook.id}`)}
								/>
								{ouvert?.type === 'historique' ? (
									<HistoriqueWebhook client={client} webhook={webhook} onFermer={fermer} onRenvoyee={relire} />
								) : null}
								{ouvert?.type === 'rotation' ? (
									<Confirmation
										testid="confirmation-rotation"
										question={t('admin.webhooks.rotate.question', { nom: webhook.nom })}
										consequence={t('admin.webhooks.rotate.consequence')}
										libelle={t('admin.webhooks.rotate.confirm')}
										libelleEnCours={t('admin.webhooks.rotate.pending')}
										onAnnuler={fermer}
										onConfirmer={async () => {
											const issue = await regenererSecret(client, webhook.id)
											if (issue.statut === 'refus') return issue.nature
											setAnnonce(t('admin.webhooks.rotated', { nom: webhook.nom }))
											setOuverture({ type: 'secret', nom: webhook.nom, secret: issue.valeur, idRetour: `regenerer-${webhook.id}` })
											return null
										}}
									/>
								) : null}
								{ouvert?.type === 'suppression' ? (
									<Confirmation
										testid="confirmation-suppression"
										question={t('admin.webhooks.delete.question', { nom: webhook.nom })}
										consequence={t('admin.webhooks.delete.consequence')}
										libelle={t('admin.webhooks.delete.confirm')}
										libelleEnCours={t('admin.webhooks.delete.pending')}
										onAnnuler={fermer}
										onConfirmer={async () => {
											const issue = await supprimerWebhook(client, webhook.id)
											if (issue.statut === 'refus') return issue.nature
											setAnnonce(t('admin.webhooks.deleted', { nom: webhook.nom }))
											retourFocus.current = 'nouveau'
											fermer()
											relire()
											return null
										}}
									/>
								) : null}
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

function LigneWebhook({
	webhook,
	nomChannel,
	ouvert,
	onHistorique,
	onModifier,
	onRegenerer,
	onSupprimer,
}: {
	readonly webhook: Webhook
	readonly nomChannel: string | null
	readonly ouvert: string | null
	readonly onHistorique: () => void
	readonly onModifier: () => void
	readonly onRegenerer: () => void
	readonly onSupprimer: () => void
}) {
	const evenements = webhook.evenements.map((e) => t(CLES_EVENEMENT[e])).join(', ')
	const nombre = webhook.evenements.length
	const derniere = webhook.derniere
	const enBloc = ouvert !== null && ouvert !== 'historique'
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 md:flex-1">
				<span className="font-medium text-ink">{webhook.nom}</span>
				<code className="text-sm text-text-2">{webhook.hote}</code>
				<span className="text-sm text-text-2" title={evenements} aria-label={t('admin.webhooks.events.aria', { liste: evenements })}>
					{t(nombre === 1 ? 'admin.webhooks.events.one' : 'admin.webhooks.events.many', { n: String(nombre) })}
				</span>
				{nomChannel === null ? null : <Badge ton="neutre">{nomChannel}</Badge>}
				<Badge ton={webhook.actif ? 'success' : 'neutre'}>{t(webhook.actif ? 'admin.webhooks.active' : 'admin.webhooks.inactive')}</Badge>
				{derniere === null ? (
					<span className="text-sm text-text-2">{t('admin.webhooks.last.none')}</span>
				) : (
					<span aria-label={t('admin.webhooks.last.aria', { etat: t(CLES_DERNIERE[derniere.etat]), date: dateCourte(derniere.le) })}>
						<Badge ton={derniere.etat === 'delivered' ? 'success' : derniere.etat === 'failed' ? 'danger' : 'neutre'}>
							{t(CLES_DERNIERE[derniere.etat])}
						</Badge>
					</span>
				)}
			</span>
			<span className="flex flex-wrap gap-1">
				<Button
					variante="discret"
					taille="compacte"
					data-retour-focus={`historique-${webhook.id}`}
					aria-expanded={ouvert === 'historique'}
					aria-label={t('admin.webhooks.history.aria', { nom: webhook.nom })}
					onClick={onHistorique}
				>
					<ScrollText aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.webhooks.history')}
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					data-retour-focus={`modifier-${webhook.id}`}
					aria-label={t('admin.webhooks.edit.aria', { nom: webhook.nom })}
					onClick={onModifier}
				>
					<PencilLine aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.webhooks.edit')}
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					disabled={enBloc}
					data-retour-focus={`regenerer-${webhook.id}`}
					aria-label={t('admin.webhooks.rotate.aria', { nom: webhook.nom })}
					onClick={onRegenerer}
				>
					<RotateCw aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.webhooks.rotate')}
				</Button>
				<Button
					variante="discret"
					taille="compacte"
					disabled={enBloc}
					data-retour-focus={`supprimer-${webhook.id}`}
					aria-label={t('admin.webhooks.delete.aria', { nom: webhook.nom })}
					onClick={onSupprimer}
				>
					<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.webhooks.delete')}
				</Button>
			</span>
		</div>
	)
}

const CLES_DERNIERE: Readonly<Record<EtatRemise, CleTraduction>> = {
	delivered: 'admin.webhooks.last.delivered',
	failed: 'admin.webhooks.last.failed',
	pending: 'admin.webhooks.last.pending',
}

/** La fiche d'un webhook, dans le flux (§5.79) : un webhook nouveau en tête, un existant à la place de sa ligne. */
function FicheWebhook({
	client,
	idWorkspace,
	webhook,
	channels,
	onFermer,
	onCree,
	onModifie,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly webhook: Webhook | null
	readonly channels: readonly ChannelLiable[]
	readonly onFermer: () => void
	readonly onCree: (nom: string, secret: string, id: string) => void
	readonly onModifie: (nom: string) => void
}) {
	const id = useId()
	const [nom, setNom] = useState(webhook?.nom ?? '')
	const [url, setUrl] = useState(webhook?.url ?? 'https://')
	const [idChannel, setIdChannel] = useState<string | null>(webhook?.idChannel ?? null)
	const [evenements, setEvenements] = useState<readonly EvenementWebhook[]>(webhook?.evenements ?? [])
	const [actif, setActif] = useState(webhook?.actif ?? true)
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusWebhook | null>(null)
	const champNom = useRef<HTMLInputElement | null>(null)
	const champUrl = useRef<HTMLInputElement | null>(null)
	// §3 : sous un filtre de channel, les événements de contact ne sont pas proposés — et ne partent pas.
	const retenus = idChannel === null ? evenements : evenements.filter((e) => e.startsWith('card.'))
	const incomplet = nom.trim() === '' || url.trim() === '' || retenus.length === 0

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	const basculer = (evenement: EvenementWebhook, coche: boolean) =>
		setEvenements((avant) => (coche ? [...avant, evenement] : avant.filter((e) => e !== evenement)))

	const envoyer = async () => {
		if (incomplet || enCours) return
		setRefus(null)
		setEnCours(true)
		const saisie = { nom, url, evenements: retenus, idChannel, actif }
		if (webhook === null) {
			const issue = await creerWebhook(client, idWorkspace, saisie)
			setEnCours(false)
			if (issue.statut === 'applique') return onCree(nom.trim(), issue.valeur.secret, issue.valeur.id)
			setRefus(issue.nature)
			;(issue.nature === 'adresse' ? champUrl : champNom).current?.focus()
			return
		}
		const issue = await modifierWebhook(client, webhook.id, saisie)
		setEnCours(false)
		if (issue.statut === 'applique') return onModifie(nom.trim())
		setRefus(issue.nature)
		;(issue.nature === 'adresse' ? champUrl : champNom).current?.focus()
	}

	const groupes = grouperChannelsParTrack(channels)
	const groupeEvenements = (titre: CleTraduction, liste: readonly EvenementWebhook[], eteints: boolean) => (
		<div className="flex flex-col gap-1">
			<span className="text-sm font-medium text-ink">{t(titre)}</span>
			<div className="grid gap-x-4 md:grid-cols-2">
				{liste.map((evenement) => (
					<label key={evenement} className="inline-flex min-h-[var(--size-target)] items-center gap-3 text-base">
						<input
							type="checkbox"
							data-testid="webhook-evenement"
							data-evenement={evenement}
							className="size-6 accent-[var(--color-brand)]"
							disabled={eteints}
							checked={!eteints && evenements.includes(evenement)}
							onChange={(e) => basculer(evenement, e.target.checked)}
						/>
						{t(CLES_EVENEMENT[evenement])}
					</label>
				))}
			</div>
		</div>
	)

	return (
		<form
			data-testid="fiche-webhook"
			aria-label={t(webhook === null ? 'admin.webhooks.form.new' : 'admin.webhooks.form.edit')}
			noValidate
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape' || enCours) return
				evenement.preventDefault()
				evenement.stopPropagation()
				onFermer()
			}}
		>
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-nom`} className={CLASSES_LIBELLE}>
					{t('admin.webhooks.field.name')}
				</label>
				<input
					id={`${id}-nom`}
					ref={champNom}
					data-testid="webhook-nom"
					type="text"
					autoComplete="off"
					value={nom}
					onChange={(e) => setNom(e.target.value)}
					className={CLASSES_CHAMP}
				/>
			</div>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-url`} className={CLASSES_LIBELLE}>
					{t('admin.webhooks.field.url')}
				</label>
				<input
					id={`${id}-url`}
					ref={champUrl}
					data-testid="webhook-url"
					type="url"
					autoComplete="off"
					aria-describedby={`${id}-url-aide`}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					className={`${CLASSES_CHAMP} font-mono`}
				/>
				<p id={`${id}-url-aide`} className="text-sm text-text-3">
					{t('admin.webhooks.field.url.help')}
				</p>
			</div>
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-channel`} className={CLASSES_LIBELLE}>
					{t('admin.webhooks.field.channel')}
				</label>
				<select
					id={`${id}-channel`}
					data-testid="webhook-channel"
					value={idChannel ?? ''}
					onChange={(e) => setIdChannel(e.target.value === '' ? null : e.target.value)}
					className={CLASSES_CHAMP}
				>
					<option value="">{t('admin.webhooks.field.channel.all')}</option>
					{groupes.map((groupe) => (
						<optgroup key={groupe.idTrack ?? ''} label={groupe.nomTrack ?? t('admin.webhooks.field.channel.noTrack')}>
							{groupe.channels.map((channel) => (
								<option key={channel.id} value={channel.id}>
									{groupe.nomTrack === null ? channel.nom : `${groupe.nomTrack} — ${channel.nom}`}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</div>
			<fieldset className="flex flex-col gap-2" aria-describedby={`${id}-donnees`}>
				<legend className="mb-1 text-sm font-medium text-ink">{t('admin.webhooks.field.events')}</legend>
				{groupeEvenements('admin.webhooks.field.events.cards', EVENEMENTS_AFFAIRE, false)}
				{groupeEvenements('admin.webhooks.field.events.contacts', EVENEMENTS_CONTACT, idChannel !== null)}
				{idChannel === null ? null : (
					<p className="text-sm text-text-2" data-testid="webhook-contacts-eteints">
						{t('admin.webhooks.field.events.contactsOff')}
					</p>
				)}
				<p id={`${id}-donnees`} className="text-sm text-text-3">
					{t('admin.webhooks.field.events.personalData')}
				</p>
			</fieldset>
			<label className="inline-flex min-h-[var(--size-target)] items-center gap-3 text-base">
				<input
					type="checkbox"
					data-testid="webhook-actif"
					className="size-6 accent-[var(--color-brand)]"
					checked={actif}
					onChange={(e) => setActif(e.target.checked)}
				/>
				{t('admin.webhooks.field.active')}
			</label>
			{refus === null ? null : (
				<p role="alert" data-testid="refus-webhook" data-refus={refus} className={CLASSES_REFUS}>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{t(CLES_REFUS[refus])}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button variante="primaire" type="submit" disabled={incomplet || enCours} data-testid="webhook-enregistrer">
					{t(enCours ? 'admin.webhooks.pending' : 'admin.webhooks.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="webhook-annuler" onClick={onFermer}>
					{t('admin.webhooks.cancel')}
				</Button>
			</div>
		</form>
	)
}

/** Le secret, montré une seule fois (§4.1, §5.79). */
function BlocSecret({ nom, secret, onFermer }: { readonly nom: string; readonly secret: string; readonly onFermer: () => void }) {
	const id = useId()
	const champ = useRef<HTMLInputElement | null>(null)
	const titre = useRef<HTMLHeadingElement | null>(null)
	const [copie, setCopie] = useState<'aucune' | 'faite' | 'echec'>('aucune')

	useEffect(() => {
		titre.current?.focus()
	}, [])

	const copier = async () => {
		try {
			await navigator.clipboard.writeText(secret)
			setCopie('faite')
		} catch {
			setCopie('echec')
			champ.current?.select()
		}
	}

	return (
		<section
			data-testid="bloc-secret"
			aria-labelledby={`${id}-titre`}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 max-w-[80ch]"
		>
			<div role="status" className="flex items-start gap-2 rounded-sm bg-accent-soft text-accent-on-soft p-3 text-sm">
				<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
				<span>
					<span className="block font-medium">
						<h3 id={`${id}-titre`} ref={titre} tabIndex={-1} className="inline">
							{t('admin.webhooks.secret.title')}
						</h3>
					</span>
					{t('admin.webhooks.secret.body', { nom })}
				</span>
			</div>
			<label htmlFor={`${id}-secret`} className={CLASSES_LIBELLE}>
				{t('admin.webhooks.secret.label')}
			</label>
			<input
				id={`${id}-secret`}
				ref={champ}
				data-testid="webhook-secret"
				readOnly
				value={secret}
				onFocus={(e) => e.target.select()}
				className={`${CLASSES_CHAMP} font-mono text-sm`}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Button variante="secondaire" data-testid="webhook-copier-secret" onClick={() => void copier()}>
					<Copy aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.webhooks.secret.copy')}
				</Button>
				<span role="status" className="text-sm text-text-2" data-testid="webhook-copie-etat">
					{copie === 'faite' ? t('admin.webhooks.secret.copied') : copie === 'echec' ? t('admin.webhooks.secret.copyFailed') : ''}
				</span>
			</div>
			<div>
				<Button variante="primaire" data-testid="webhook-secret-fermer" onClick={onFermer}>
					{t('admin.webhooks.secret.done')}
				</Button>
			</div>
		</section>
	)
}

/** Une confirmation dans le flux, sous la ligne (§5.13, §5.40) : sa question, sa conséquence, un bouton destructif. */
function Confirmation({
	testid,
	question,
	consequence,
	libelle,
	libelleEnCours,
	onAnnuler,
	onConfirmer,
}: {
	readonly testid: string
	readonly question: string
	readonly consequence: string
	readonly libelle: string
	readonly libelleEnCours: string
	readonly onAnnuler: () => void
	readonly onConfirmer: () => Promise<NatureRefusWebhook | null>
}) {
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusWebhook | null>(null)
	const bouton = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		bouton.current?.focus()
	}, [])
	return (
		<div
			data-testid={testid}
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 max-w-[72ch]"
			onKeyDown={(e) => {
				if (e.key !== 'Escape' || enCours) return
				e.preventDefault()
				onAnnuler()
			}}
		>
			<p className="font-medium text-ink">{question}</p>
			<p className="text-sm text-text-2">{consequence}</p>
			{refus === null ? null : (
				<p role="alert" className={CLASSES_REFUS} data-testid="refus-webhook" data-refus={refus}>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{t(CLES_REFUS[refus])}</span>
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					ref={bouton}
					variante="destructif"
					disabled={enCours}
					data-testid={`${testid}-confirmer`}
					onClick={async () => {
						setEnCours(true)
						const issue = await onConfirmer()
						setEnCours(false)
						setRefus(issue)
					}}
				>
					{enCours ? libelleEnCours : libelle}
				</Button>
				<Button variante="secondaire" disabled={enCours} onClick={onAnnuler}>
					{t('admin.webhooks.cancel')}
				</Button>
			</div>
		</div>
	)
}

/** L'historique des remises d'un webhook, sous sa ligne (§5.79). */
function HistoriqueWebhook({
	client,
	webhook,
	onFermer,
	onRenvoyee,
}: {
	readonly client: ClientCrm
	readonly webhook: Webhook
	readonly onFermer: () => void
	readonly onRenvoyee: () => void
}) {
	const id = useId()
	const [remises, setRemises] = useState<readonly Remise[] | 'chargement' | NatureErreur>('chargement')
	const [tentative, setTentative] = useState(0)
	const [corpsOuvert, setCorpsOuvert] = useState<string | null>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [message, setMessage] = useState<{ readonly role: 'status' | 'alert'; readonly texte: string } | null>(null)

	useEffect(() => {
		let actif = true
		void lireRemises(client, webhook.id).then((lu) => {
			if (!actif) return
			if (lu.statut === 'erreur') setRemises(lu.erreur.nature)
			else if (lu.statut === 'pret') setRemises(lu.donnees)
		})
		return () => {
			actif = false
		}
	}, [client, webhook.id, tentative])

	const renvoyer = async (remise: Remise) => {
		setEnCours(remise.id)
		setMessage(null)
		const issue = await renvoyerRemise(client, remise.id)
		setEnCours(null)
		if (issue.statut === 'refus') {
			setMessage({ role: 'alert', texte: t(CLES_REFUS[issue.nature]) })
			return
		}
		setMessage({ role: 'status', texte: t('admin.webhooks.history.resent') })
		setTentative((n) => n + 1)
		onRenvoyee()
	}

	return (
		<section
			data-testid="historique-webhook"
			aria-labelledby={`${id}-titre`}
			className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
			onKeyDown={(e) => {
				if (e.key !== 'Escape') return
				e.preventDefault()
				onFermer()
			}}
		>
			<h3 id={`${id}-titre`} className="text-sm font-medium text-ink">
				{t('admin.webhooks.history.title', { nom: webhook.nom })}
			</h3>
			{remises === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : typeof remises === 'string' ? (
				<EtatErreur
					titre={t('admin.webhooks.history.error')}
					corps={t(remises === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : remises.length === 0 ? (
				<p className="text-sm text-text-2">{t('admin.webhooks.history.empty')}</p>
			) : (
				<div className="indique-debordement-x overflow-x-auto">
					<table className="w-full text-sm" data-testid="table-remises">
						<thead>
							<tr className="border-b border-border text-text-2">
								<th scope="col" className="px-2 py-2 text-right font-normal whitespace-nowrap">{t('admin.webhooks.history.col.date')}</th>
								<th scope="col" className="px-2 py-2 text-left font-normal whitespace-nowrap">{t('admin.webhooks.history.col.event')}</th>
								<th scope="col" className="px-2 py-2 text-left font-normal whitespace-nowrap">{t('admin.webhooks.history.col.state')}</th>
								<th scope="col" className="px-2 py-2 text-right font-normal whitespace-nowrap">{t('admin.webhooks.history.col.attempts')}</th>
								<th scope="col" className="px-2 py-2 text-left font-normal whitespace-nowrap">{t('admin.webhooks.history.col.result')}</th>
								<th scope="col" className="px-2 py-2 text-left font-normal whitespace-nowrap">{t('admin.webhooks.history.col.commands')}</th>
							</tr>
						</thead>
						<tbody>
							{remises.map((remise) => (
								<Fragment key={remise.id}>
									<tr className="h-[var(--size-target)] border-b border-border" data-testid="ligne-remise" data-remise={remise.id}>
										<td className="px-2 text-right font-mono tabular-nums whitespace-nowrap">{dateCourte(remise.le)}</td>
										<td className="px-2 whitespace-nowrap">{t(CLES_EVENEMENT[remise.evenement])}</td>
										<td className="px-2 whitespace-nowrap">
											<Badge ton={remise.etat === 'delivered' ? 'success' : remise.etat === 'failed' ? 'danger' : 'neutre'}>
												{t(
													remise.etat === 'delivered'
														? 'admin.webhooks.history.state.delivered'
														: remise.etat === 'failed'
															? 'admin.webhooks.history.state.failed'
															: 'admin.webhooks.history.state.pending',
												)}
											</Badge>
										</td>
										<td className="px-2 text-right tabular-nums whitespace-nowrap">
											{t('admin.webhooks.history.attempts', { n: String(remise.essais) })}
										</td>
										<td className="px-2 whitespace-nowrap" data-testid="resultat-remise">
											{remise.codeHttp !== null ? (
												<code>{remise.codeHttp}</code>
											) : remise.motif !== null ? (
												t(CLES_MOTIF[remise.motif])
											) : null}
										</td>
										<td className="px-2 whitespace-nowrap">
											<span className="flex gap-1">
												<Button
													variante="discret"
													taille="compacte"
													aria-expanded={corpsOuvert === remise.id}
													aria-label={t('admin.webhooks.history.body.aria', { date: dateCourte(remise.le) })}
													onClick={() => setCorpsOuvert(corpsOuvert === remise.id ? null : remise.id)}
												>
													{t('admin.webhooks.history.body')}
												</Button>
												{remise.etat === 'pending' ? null : (
													<Button
														variante="discret"
														taille="compacte"
														disabled={enCours !== null}
														data-testid="renvoyer-remise"
														aria-label={t('admin.webhooks.history.resend.aria', { date: dateCourte(remise.le) })}
														onClick={() => void renvoyer(remise)}
													>
														<Redo2 aria-hidden="true" size={16} strokeWidth={2} />
														{t('admin.webhooks.history.resend')}
													</Button>
												)}
											</span>
										</td>
									</tr>
									{corpsOuvert === remise.id ? (
										<tr>
											<td colSpan={6} className="px-2 py-2">
												<pre
													data-testid="corps-remise"
													className="sticky left-0 max-w-[calc(100vw-4rem)] overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-hover p-3 font-mono text-xs"
												>
													{JSON.stringify(remise.corps, null, 2)}
												</pre>
											</td>
										</tr>
									) : null}
								</Fragment>
							))}
						</tbody>
					</table>
				</div>
			)}
			{Array.isArray(remises) && remises.length === LIMITE_HISTORIQUE ? (
				<p className="text-xs text-text-3">{t('admin.webhooks.history.truncated', { n: String(LIMITE_HISTORIQUE) })}</p>
			) : null}
			{message === null ? null : (
				<p
					role={message.role}
					data-testid="message-historique"
					className={message.role === 'alert' ? CLASSES_REFUS : 'text-sm text-text-2'}
				>
					{message.texte}
				</p>
			)}
			<div>
				<Button variante="secondaire" taille="compacte" onClick={onFermer}>
					{t('admin.webhooks.history.close')}
				</Button>
			</div>
		</section>
	)
}
